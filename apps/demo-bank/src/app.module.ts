import { Module } from '@nestjs/common';
import { ContractsModule } from '@app/contracts';
import { BankModule } from './bank/bank.module';
import { DemoBankConfigModule } from './config/demo-bank-config.module';
import { HealthModule } from './health/health.module';

@Module({ imports: [DemoBankConfigModule, ContractsModule, HealthModule, BankModule] })
export class AppModule {}
