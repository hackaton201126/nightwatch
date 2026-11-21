import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { LoginHistoryModule } from '../login-history/login-history.module';
import { FactsService } from './facts.service';

@Module({ imports: [ConfigModule, LoginHistoryModule], providers: [FactsService], exports: [FactsService] })
export class FactsModule {}
