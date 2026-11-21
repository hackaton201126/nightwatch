import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { Facts } from '../facts/facts.types';
import { JevRequestBuilderService } from './jev-request-builder.service';
import { BuildResponseOptions, JevDecision, JevDecisionResponse, JevLabel } from './jev.types';

@Injectable()
export class JevMappingService {
  constructor(
    private readonly config: AppConfigService,
    private readonly builder: JevRequestBuilderService,
  ) {}

  /** The decision for a takeover probability: below step_up allow, below hold step_up, else hold. */
  band(p: number): JevDecision {
    const { stepUp, hold } = this.config.jev().jev.thresholds;
    if (p < stepUp) return 'allow';
    return p < hold ? 'step_up' : 'hold';
  }

  /** True when the label contradicts the probability band and the case must go to Devin. */
  isConflict(p: number, label: JevLabel): boolean {
    const { stepUp, hold } = this.config.jev().jev.thresholds;
    return (p >= hold && label === 'legitimate') || (p < stepUp && label === 'account_takeover');
  }

  /** The reasons that explain the decision, the model assessment last. */
  reasonsFrom(f: Facts, p: number, label: JevLabel): JevDecisionResponse['reasons'] {
    const r: JevDecisionResponse['reasons'] = [];
    if (f.device_age_minutes !== null && f.device_age_minutes < 24 * 60)
      r.push({ code: 'new_device', detail: `device first seen ${f.device_age_minutes} min ago` });
    if (f.hours_since_password_reset !== null && f.hours_since_password_reset < 24)
      r.push({ code: 'recent_password_reset', detail: `password reset ${f.hours_since_password_reset} h ago` });
    if (f.hours_since_mfa_change !== null && f.hours_since_mfa_change < 24)
      r.push({ code: 'recent_mfa_change', detail: `MFA changed ${f.hours_since_mfa_change} h ago` });
    if (f.failed_logins_1h_before !== null && f.failed_logins_1h_before > 0)
      r.push({ code: 'failed_login_attempts', detail: `${f.failed_logins_1h_before} failed logins in the hour before` });
    if (f.anonymizer !== null && f.anonymizer !== 'none_detected')
      r.push({ code: 'anonymizer_network', detail: `network: ${f.anonymizer}` });
    if (f.country_seen_in_successful_logins === false)
      r.push({ code: 'ip_country_unusual', detail: 'country not seen in earlier successful logins' });
    if (f.hour_seen_in_successful_logins === false)
      r.push({ code: 'off_hours', detail: `login hour ${f.login_hour_local} not seen in earlier logins` });
    if (f.seconds_login_to_transfer !== null && f.seconds_login_to_transfer < 60)
      r.push({ code: 'login_to_transfer_fast', detail: `${f.seconds_login_to_transfer} s from login to transfer` });
    if (f.thin_history === true)
      r.push({ code: 'thin_history', detail: `${f.successful_logins_in_history} successful logins in history` });
    r.push({ code: 'model_assessment', detail: `takeover probability ${p.toFixed(2)}, reading: ${label}` });
    return r.slice(-10);
  }

  /** The response for a clear Jev answer, valid against the response schema. */
  buildResponse(options: BuildResponseOptions): JevDecisionResponse {
    const { request, facts, now, decisionId, latencyMs: latency } = options;
    const { p, label, confidence } = options.answer;
    const { jev, confirmation } = this.config.jev();
    const decision = this.band(p);
    const expires = new Date(now.getTime() + confirmation.timeoutMinutes * 60_000).toISOString();
    const score = Math.round(p * 100);
    const reasons = this.reasonsFrom(facts, p, label);
    const response: JevDecisionResponse = {
      schema_version: '1.0',
      decision_id: decisionId,
      transaction_id: this.builder.transactionId(request),
      decided_at: now.toISOString(),
      decision,
      final: decision !== 'hold',
      decided_by: 'jev',
      risk: { score, level: decision === 'allow' ? 'low' : decision === 'step_up' ? 'medium' : 'high' },
      classification: { label, confidence, takeover_probability: p, recommended_decision: decision },
      reasons,
      actions:
        decision === 'allow'
          ? ['execute']
          : decision === 'step_up'
            ? ['request_step_up']
            : ['hold_transaction', 'notify_owner_out_of_band'],
      explanation: {
        customer:
          decision === 'allow'
            ? 'Transfer processed.'
            : decision === 'step_up'
              ? 'Please confirm this transfer once more to continue.'
              : 'For your safety this transfer is on hold. We will ask you to confirm it on your registered device.',
        analyst: `Jev: takeover probability ${p.toFixed(2)} (score ${score}), reading ${label} with confidence ${confidence.toFixed(2)} -> ${decision}. Signals: ${
          reasons
            .filter((x) => x.code !== 'model_assessment')
            .map((x) => x.code)
            .join(', ') || 'none'
        }.`.slice(0, 800),
      },
      latency_ms: latency,
      model: { provider: 'typesafe', name: jev.model, latency_ms: latency, timed_out: false },
    };
    if (decision === 'step_up') {
      response.step_up = { channel: 'in_app', challenge_id: `${decisionId}-challenge`, expires_at: expires };
    } else if (decision === 'hold') {
      response.hold = { expires_at: expires, on_timeout: 'block', confirmation_channel: 'push' };
    }
    return response;
  }
}
