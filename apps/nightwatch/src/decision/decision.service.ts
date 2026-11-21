import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppConfigService } from '../config/app-config.service';
import { FactsService } from '../facts/facts.service';
import { FactsRequest } from '../facts/facts.types';
import { FastPathService } from '../fast-path/fast-path.service';
import { FastPathRequest } from '../fast-path/fast-path.types';
import { JevDecisionService } from '../jev/jev-decision.service';
import { JevRequestBuilderService } from '../jev/jev-request-builder.service';
import { DecisionResult } from './decision.types';

@Injectable()
export class DecisionService {
  constructor(
    private readonly config: AppConfigService,
    private readonly fastPath: FastPathService,
    private readonly facts: FactsService,
    private readonly jev: JevDecisionService,
    private readonly builder: JevRequestBuilderService,
  ) {}

  /**
   * Fast path, then facts, then Jev: a response valid against the response schema, or an escalation for
   * Devin. Never rejects; it does not deliver the response, the caller does.
   */
  async decide(request: unknown, now: Date): Promise<DecisionResult> {
    const decisionId = `dec_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    try {
      const fast = this.fastPath.check({ request: (request ?? {}) as FastPathRequest, now, decisionId });
      if (fast.shortcut) return { escalate: false, response: fast.response };
      const facts = this.facts.compute((request ?? {}) as FactsRequest);
      const result = await this.jev.decide({
        request,
        facts,
        now,
        decisionId,
        apiKey: this.config.jevApiKey(),
      });
      if (!result.escalate) return result;
      return {
        escalate: true,
        transactionId: this.builder.transactionId(request),
        reason: result.reason,
        facts,
        jev: result.jev,
        replyUrl: this.config.replyUrl(),
      };
    } catch {
      return {
        escalate: true,
        transactionId: this.builder.transactionId(request),
        reason: 'jev_failed',
        facts: null,
        jev: { probability: null, label: null, confidence: null, latency_ms: 0, timed_out: false },
        replyUrl: this.config.replyUrl(),
      };
    }
  }
}
