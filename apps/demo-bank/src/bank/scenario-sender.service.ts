import { Injectable } from '@nestjs/common';
import { riskRequestSchema } from '@app/contracts';
import { DemoBankConfigService, WebhookSettings } from '../config/demo-bank-config.service';
import { ScenarioId } from './scenarios.constants';
import { ScenariosService } from './scenarios.service';

export const MAX_SENDS = 20;

export interface SendOutcome {
  scenario: ScenarioId;
  transactionId: string;
  accepted: boolean;
  /** Webhook HTTP status, or an error text when it was unreachable. */
  detail: string;
  at: string;
}

@Injectable()
export class ScenarioSenderService {
  private readonly outcomes: SendOutcome[] = [];

  constructor(
    private readonly scenarios: ScenariosService,
    private readonly config: DemoBankConfigService,
  ) {}

  list(): SendOutcome[] {
    return [...this.outcomes];
  }

  async send(id: ScenarioId): Promise<SendOutcome> {
    const { url, secret } = this.config.webhook() as WebhookSettings;
    const now = new Date();
    const body = riskRequestSchema.parse(this.scenarios.buildScenario(id, now));
    const outcome: SendOutcome = {
      scenario: id,
      transactionId: body.transaction.transaction_id,
      accepted: false,
      detail: '',
      at: now.toISOString(),
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': secret },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      outcome.accepted = res.ok;
      outcome.detail = `HTTP ${res.status}`;
    } catch (e) {
      outcome.detail = `error: ${e instanceof Error ? e.message : 'request failed'}`;
    }
    this.outcomes.unshift(outcome);
    if (this.outcomes.length > MAX_SENDS) this.outcomes.length = MAX_SENDS;
    return outcome;
  }
}
