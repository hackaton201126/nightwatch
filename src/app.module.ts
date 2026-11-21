import { Module } from '@nestjs/common';
import { BankModule } from './bank/bank.module';
import { ConfigModule } from './config/config.module';
import { ContractsModule } from './contracts/contracts.module';
import { DecisionModule } from './decision/decision.module';
import { FactsModule } from './facts/facts.module';
import { FastPathModule } from './fast-path/fast-path.module';
import { HealthModule } from './health/health.module';
import { JevModule } from './jev/jev.module';
import { LoginHistoryModule } from './login-history/login-history.module';

@Module({
  imports: [
    ConfigModule,
    ContractsModule,
    HealthModule,
    LoginHistoryModule,
    FastPathModule,
    FactsModule,
    JevModule,
    DecisionModule,
    BankModule,
  ],
})
export class AppModule {}
