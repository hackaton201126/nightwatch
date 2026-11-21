import { BadRequestException, Body, Controller, Get, Header, HttpCode, NotFoundException, Param, Post, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { riskResponseSchema, RiskResponse } from '../contracts';
import { renderBankPage } from './bank-page';
import { DecisionStore } from './decision-store';
import { ScenarioSender } from './scenario-sender';
import { isScenarioId } from './scenarios';

@Controller('bank')
export class BankController {
  constructor(
    private readonly store: DecisionStore,
    private readonly sender: ScenarioSender,
  ) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(): string {
    return renderBankPage(this.store.list(), { configured: this.sender.isConfigured(), sends: this.sender.list() });
  }

  @Post('scenarios/:id')
  async scenario(@Param('id') id: string, @Res() res: Response): Promise<void> {
    if (!isScenarioId(id)) throw new NotFoundException('unknown scenario');
    if (!this.sender.isConfigured()) throw new ServiceUnavailableException('webhook is not configured');
    await this.sender.send(id);
    res.redirect(303, '/bank');
  }

  @Get('decisions')
  decisions(): RiskResponse[] {
    return this.store.list();
  }

  @Post('decisions')
  @HttpCode(202)
  receive(@Body() body: unknown): { accepted: true } {
    const parsed = riskResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    this.store.add(parsed.data);
    return { accepted: true };
  }
}
