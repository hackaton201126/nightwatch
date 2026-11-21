import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { JevAnswerParserService } from './jev-answer-parser.service';
import { JevClient } from './jev-client';
import { JevDecisionService } from './jev-decision.service';
import { JevHttpClient } from './jev-http-client.service';
import { JevMappingService } from './jev-mapping.service';
import { JevRequestBuilderService } from './jev-request-builder.service';

@Module({
  imports: [ConfigModule],
  providers: [
    JevAnswerParserService,
    JevRequestBuilderService,
    JevMappingService,
    JevDecisionService,
    { provide: JevClient, useClass: JevHttpClient },
  ],
  exports: [JevDecisionService, JevRequestBuilderService],
})
export class JevModule {}
