import { Body, Controller, Get, Header, HttpCode, NotFoundException, Param, Post, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { riskResponseSchema, RiskResponse, ZodValidationPipe } from '@app/contracts';
import { DemoBankConfigService } from '../config/demo-bank-config.service';
import { BankPageService } from './bank-page.service';
import { DecisionStoreService } from './decision-store.service';
import { ScenarioSenderService } from './scenario-sender.service';
import { ScenariosService } from './scenarios.service';

@Controller('bank')
export class BankController {
  constructor(
    private readonly store: DecisionStoreService,
    private readonly sender: ScenarioSenderService,
    private readonly scenarios: ScenariosService,
    private readonly page: BankPageService,
    private readonly config: DemoBankConfigService,
  ) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  render(): string {
    return this.page.render(this.store.list(), { configured: this.config.isConfigured(), sends: this.sender.list() });
  }

  @Post('scenarios/:id')
  async scenario(@Param('id') id: string, @Res() res: Response): Promise<void> {
    if (!this.scenarios.isScenarioId(id)) throw new NotFoundException('unknown scenario');
    if (!this.config.isConfigured()) throw new ServiceUnavailableException('webhook is not configured');
    await this.sender.send(id);
    res.redirect(303, '/bank');
  }

  @Get('decisions')
  decisions(): RiskResponse[] {
    return this.store.list();
  }

  @Post('decisions')
  @HttpCode(202)
  receive(@Body(new ZodValidationPipe(riskResponseSchema)) decision: RiskResponse): { accepted: true } {
    this.store.add(decision);
    return { accepted: true };
  }
}
