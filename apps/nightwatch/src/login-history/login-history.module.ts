import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { LoginHistoryService } from './login-history.service';

@Module({ imports: [ConfigModule], providers: [LoginHistoryService], exports: [LoginHistoryService] })
export class LoginHistoryModule {}
