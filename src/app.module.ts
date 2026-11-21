import { Module } from '@nestjs/common';
import { BankModule } from './bank/bank.module';
import { HealthController } from './health.controller';

@Module({
  imports: [BankModule],
  controllers: [HealthController],
})
export class AppModule {}
