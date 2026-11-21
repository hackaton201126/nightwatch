import { Body, Controller, Get, Header, HttpCode, NotFoundException, Param, Post, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { riskResponseSchema, RiskResponse, ZodValidationPipe } from '@app/contracts';
import { DemoBankConfigService } from '../config/demo-bank-config.service';
import { BankPageService } from './bank-page.service';
import { DecisionStoreService } from './decision-store.service';
import { TransactionSenderService } from './transaction-sender.service';
import { CustomersService } from './customers.service';

@Controller('bank')
export class BankController {
  constructor(
    private readonly store: DecisionStoreService,
    private readonly sender: TransactionSenderService,
    private readonly customers: CustomersService,
    private readonly page: BankPageService,
    private readonly config: DemoBankConfigService,
  ) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  render(): string {
    const now = new Date();
    return this.page.render(this.store.list(), {
      configured: this.config.isConfigured(),
      sends: this.sender.list(),
      customers: this.customers.list().map((c) => this.customers.card(c, now)),
    });
  }

  @Post('customers/:customerId/transactions/:path')
  async send(@Param('customerId') customerId: string, @Param('path') path: string, @Res() res: Response): Promise<void> {
    const customer = this.customers.find(customerId);
    if (!customer || !this.customers.isPath(path)) throw new NotFoundException('unknown customer or path');
    if (!this.config.isConfigured()) throw new ServiceUnavailableException('webhook is not configured');
    await this.sender.send(customer, path);
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
