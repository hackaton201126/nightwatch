import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { FactsModule } from '../facts/facts.module';
import { FastPathModule } from '../fast-path/fast-path.module';
import { JevModule } from '../jev/jev.module';
import { DecisionService } from './decision.service';

@Module({
  imports: [ConfigModule, FastPathModule, FactsModule, JevModule],
  providers: [DecisionService],
  exports: [DecisionService],
})
export class DecisionModule {}
