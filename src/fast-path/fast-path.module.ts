import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { LoginHistoryModule } from '../login-history/login-history.module';
import { FastPathService } from './fast-path.service';

@Module({
  imports: [ConfigModule, LoginHistoryModule],
  providers: [FastPathService],
  exports: [FastPathService],
})
export class FastPathModule {}
