import { Global, Module } from '@nestjs/common';
import { DemoBankConfigService } from './demo-bank-config.service';

@Global()
@Module({ providers: [DemoBankConfigService], exports: [DemoBankConfigService] })
export class DemoBankConfigModule {}
