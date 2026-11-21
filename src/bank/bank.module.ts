import { Module } from '@nestjs/common';
import { BankController } from './bank.controller';
import { DecisionStore } from './decision-store';

@Module({ controllers: [BankController], providers: [DecisionStore] })
export class BankModule {}
