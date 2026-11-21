import { Module } from '@nestjs/common';
import { BankController } from './bank.controller';
import { ScenarioSender } from './scenario-sender';
import { DecisionStore } from './decision-store';

@Module({ controllers: [BankController], providers: [DecisionStore, ScenarioSender] })
export class BankModule {}
