import { Module } from '@nestjs/common';
import { BankPageService } from './bank-page.service';
import { BankController } from './bank.controller';
import { DecisionStoreService } from './decision-store.service';
import { TransactionSenderService } from './transaction-sender.service';
import { CustomersService } from './customers.service';

@Module({
  controllers: [BankController],
  providers: [DecisionStoreService, TransactionSenderService, CustomersService, BankPageService],
})
export class BankModule {}
