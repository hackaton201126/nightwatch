import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { JevClient } from './jev-client';
import { JevMappingService } from './jev-mapping.service';
import { JevRequestBuilderService } from './jev-request-builder.service';
import { DecideByJevOptions, JevAnswer, JevDecisionResult, JevInfo } from './jev.types';

@Injectable()
export class JevDecisionService {
  constructor(
    private readonly config: AppConfigService,
    private readonly client: JevClient,
    private readonly builder: JevRequestBuilderService,
    private readonly mapping: JevMappingService,
  ) {}

  /** Asks Jev and decides by its takeover probability, or says the case must go to Devin. Never rejects. */
  async decide(options: DecideByJevOptions): Promise<JevDecisionResult> {
    const { request, facts, now, decisionId, apiKey } = options;
    const started = Date.now();
    let answer: JevAnswer;
    try {
      answer = await this.client.ask({ body: this.builder.build(request, facts), apiKey });
    } catch {
      answer = { ok: false, timedOut: false };
    }
    const latency_ms = Math.max(0, Date.now() - started);
    if (!answer.ok) {
      const jev: JevInfo = { probability: null, label: null, confidence: null, latency_ms, timed_out: answer.timedOut };
      return { escalate: true, reason: answer.timedOut ? 'jev_timeout' : 'jev_failed', jev };
    }
    const { p, label, confidence } = answer;
    const jev: JevInfo = { probability: p, label, confidence, latency_ms, timed_out: false };
    if (confidence < this.config.jev().escalate.minLabelConfidence) {
      return { escalate: true, reason: 'low_confidence', jev };
    }
    if (this.mapping.isConflict(p, label)) return { escalate: true, reason: 'conflict', jev };
    const response = this.mapping.buildResponse({ request, facts, now, decisionId, answer, latencyMs: latency_ms });
    return { escalate: false, response };
  }
}
