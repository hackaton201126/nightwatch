import { Body, Controller, Get, Header, HttpCode, NotFoundException, Param, Post, Query, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { riskResponseSchema, RiskResponse, ZodValidationPipe } from '@app/contracts';
import { DemoBankConfigService } from '../config/demo-bank-config.service';
import { FORM_COUNTRIES } from './customers.constants';
import { BankPageService } from './bank-page.service';
import { DecisionStoreService } from './decision-store.service';
import { TransactionSenderService } from './transaction-sender.service';
import { CustomChoices, CustomersService } from './customers.service';

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
  render(@Query('formError') formError?: string): string {
    return this.view(typeof formError === 'string' ? formError.slice(0, 120) : undefined);
  }

  private view(formError?: string): string {
    const now = new Date();
    return this.page.render(this.store.list(), {
      configured: this.config.isConfigured(),
      sends: this.sender.list(),
      customers: this.customers.list().map((c) => this.customers.card(c, now)),
      formError,
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

  @Post('transactions')
  async sendCustom(@Body() body: Record<string, unknown>, @Res() res: Response): Promise<void> {
    if (!this.config.isConfigured()) throw new ServiceUnavailableException('webhook is not configured');
    const parsed = this.parseForm(body ?? {});
    if (typeof parsed === 'string') {
      res.redirect(303, `/bank?formError=${encodeURIComponent(parsed)}`);
      return;
    }
    await this.sender.sendCustom(parsed.customer, parsed.choices);
    res.redirect(303, '/bank');
  }

  private parseForm(body: Record<string, unknown>): string | { customer: NonNullable<ReturnType<CustomersService['find']>>; choices: CustomChoices } {
    const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
    const customer = this.customers.find(str('customerId'));
    if (!customer) return 'Unknown customer.';
    const amount = str('amountAed');
    if (!/^\d{1,9}([.,]\d{1,2})?$/.test(amount)) return 'Enter the amount in AED as a positive number.';
    const amountMinor = Math.round(Number(amount.replace(',', '.')) * 100);
    if (amountMinor < 1) return 'Enter the amount in AED as a positive number.';
    const pick = <T extends string>(k: string, allowed: readonly T[]): T | undefined => allowed.find((a) => a === str(k));
    const beneficiary = pick('beneficiary', ['known', 'new'] as const);
    const device = pick('device', ['usual', 'new'] as const);
    const network = pick('network', ['home', 'vpn', 'country'] as const);
    const loginTime = pick('loginTime', ['now', 'night'] as const);
    if (!beneficiary || !device || !network || !loginTime) return 'Unknown choice in the form.';
    const country = pick('country', FORM_COUNTRIES) ?? '';
    if (network === 'country' && !country) return 'Choose a country.';
    return { customer, choices: { amountMinor, beneficiary, device, network, country, loginTime } };
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
