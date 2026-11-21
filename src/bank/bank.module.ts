import { Module } from '@nestjs/common';
import { BankPageService } from './bank-page.service';
import { BankController } from './bank.controller';
import { DecisionStoreService } from './decision-store.service';
import { ScenarioSenderService } from './scenario-sender.service';
import { ScenariosService } from './scenarios.service';

@Module({
  controllers: [BankController],
  providers: [DecisionStoreService, ScenarioSenderService, ScenariosService, BankPageService],
})
export class BankModule {}
