import { BadRequestException, Body, Controller, Get, Header, HttpCode, Post } from '@nestjs/common';
import { riskResponseSchema, RiskResponse } from '../contracts';
import { renderBankPage } from './bank-page';
import { DecisionStore } from './decision-store';

@Controller('bank')
export class BankController {
  constructor(private readonly store: DecisionStore) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(): string {
    return renderBankPage(this.store.list());
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
