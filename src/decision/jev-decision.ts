import { JevDecisionConfig } from './jev-decision.config';

/** The computed facts, exactly the fields of state.facts in docs/examples. */
export interface Facts {
  device_age_minutes: number | null;
  hours_since_password_reset: number | null;
  hours_since_mfa_change: number | null;
  anonymizer: string | null;
  country_seen_in_successful_logins: boolean | null;
  failed_logins_1h_before: number | null;
  login_hour_local: number | null;
  hour_seen_in_successful_logins: boolean | null;
  seconds_login_to_transfer: number | null;
  successful_logins_in_history: number | null;
  thin_history: boolean | null;
}

export type JevLabel = 'legitimate' | 'account_takeover' | 'uncertain';
export type JevDecision = 'allow' | 'step_up' | 'hold';
export type EscalationReason = 'low_confidence' | 'conflict' | 'jev_failed' | 'jev_timeout';

export interface JevInfo {
  probability: number | null;
  label: JevLabel | null;
  confidence: number | null;
  latency_ms: number;
  timed_out: boolean;
}

type ReasonCode =
  | 'new_device'
  | 'recent_password_reset'
  | 'recent_mfa_change'
  | 'failed_login_attempts'
  | 'anonymizer_network'
  | 'ip_country_unusual'
  | 'off_hours'
  | 'login_to_transfer_fast'
  | 'thin_history'
  | 'model_assessment';

export interface JevDecisionResponse {
  schema_version: '1.0';
  decision_id: string;
  transaction_id: string;
  decided_at: string;
  decision: JevDecision;
  final: boolean;
  decided_by: 'jev';
  risk: { score: number; level: 'low' | 'medium' | 'high' };
  classification: {
    label: JevLabel;
    confidence: number;
    takeover_probability: number;
    recommended_decision: JevDecision;
  };
  reasons: { code: ReasonCode; detail?: string }[];
  actions: string[];
  step_up?: { channel: 'in_app'; challenge_id: string; expires_at: string };
  hold?: { expires_at: string; on_timeout: 'block'; confirmation_channel: 'push' };
  explanation: { customer: string; analyst: string };
  latency_ms: number;
  model: { provider: 'typesafe'; name: string; latency_ms: number; timed_out: false };
}

export type JevDecisionResult =
  | { escalate: false; response: JevDecisionResponse }
  | { escalate: true; reason: EscalationReason; jev: JevInfo };

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';

const QUESTIONS = {
  takeover: {
    type: 'noul',
    instructions:
      'Is this banking session most likely operated by someone other than the account owner (account takeover)? Judge the current login in `request.session` against the owner\'s past logins in `request.history.recent_login_attempts`, using the precomputed `facts`.',
  },
  pattern: {
    type: 'choice',
    instructions: 'Which reading of this login fits best?',
    criteria: {
      legitimate: 'The owner logging in as usual, maybe on a new phone or while travelling.',
      account_takeover:
        'Someone else logged in with stolen credentials, a hijacked session or a deepfaked check.',
      uncertain: 'The evidence does not support either reading.',
    },
  },
};

const LABELS: JevLabel[] = ['legitimate', 'account_takeover', 'uncertain'];
const isUnit = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

function band(p: number, c: JevDecisionConfig): JevDecision {
  if (p < c.jev.thresholds.stepUp) return 'allow';
  return p < c.jev.thresholds.hold ? 'step_up' : 'hold';
}

function reasonsFrom(f: Facts, p: number, label: JevLabel): JevDecisionResponse['reasons'] {
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

function txId(request: unknown): string {
  const id = (request as { transaction?: { transaction_id?: unknown } } | null)?.transaction
    ?.transaction_id;
  return typeof id === 'string' ? id : '';
}

async function askJev(
  request: unknown,
  facts: Facts,
  config: JevDecisionConfig,
  apiKey: string,
): Promise<{ ok: true; p: number; label: JevLabel; confidence: number } | { ok: false; timedOut: boolean; p?: number }> {
  const ctl = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      ctl.abort();
      resolve('timeout');
    }, config.jev.timeoutMs);
  });
  const call = (async () => {
    const res = await fetch(JEV_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: config.jev.model,
        state: { request, facts },
        questions: QUESTIONS,
      }),
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  })().catch(() => null);
  try {
    const out = await Promise.race([call, timeout]);
    if (out === 'timeout') return { ok: false, timedOut: true };
    const a = (out as { answers?: any } | null)?.answers;
    const p = a?.takeover?.noul;
    const label = a?.pattern?.choice;
    const conf = a?.pattern?.confidence;
    if (!isUnit(p) || !LABELS.includes(label) || !isUnit(conf)) return { ok: false, timedOut: false };
    return { ok: true, p, label, confidence: conf };
  } finally {
    clearTimeout(timer);
  }
}

/** Asks Jev and decides by its takeover probability, or says the case must go to Devin. Never rejects. */
export async function decideByJev(
  request: unknown,
  facts: Facts,
  config: JevDecisionConfig,
  now: Date,
  decisionId: string,
  apiKey: string,
): Promise<JevDecisionResult> {
  const started = Date.now();
  let answer: Awaited<ReturnType<typeof askJev>>;
  try {
    answer = await askJev(request, facts, config, apiKey);
  } catch {
    answer = { ok: false, timedOut: false };
  }
  const latency = Math.max(0, Date.now() - started);
  const info = (p: number | null, label: JevLabel | null, confidence: number | null, timed_out: boolean): JevInfo => ({
    probability: p, label, confidence, latency_ms: latency, timed_out,
  });
  if (!answer.ok) {
    return {
      escalate: true,
      reason: answer.timedOut ? 'jev_timeout' : 'jev_failed',
      jev: info(null, null, null, answer.timedOut),
    };
  }
  const { p, label, confidence } = answer;
  const jev = info(p, label, confidence, false);
  if (confidence < config.escalate.minLabelConfidence) return { escalate: true, reason: 'low_confidence', jev };
  const { stepUp, hold } = config.jev.thresholds;
  if ((p >= hold && label === 'legitimate') || (p < stepUp && label === 'account_takeover'))
    return { escalate: true, reason: 'conflict', jev };

  const decision = band(p, config);
  const minutes = config.confirmation.timeoutMinutes;
  const expires = new Date(now.getTime() + minutes * 60_000).toISOString();
  const score = Math.round(p * 100);
  const response: JevDecisionResponse = {
    schema_version: '1.0',
    decision_id: decisionId,
    transaction_id: txId(request),
    decided_at: now.toISOString(),
    decision,
    final: decision !== 'hold',
    decided_by: 'jev',
    risk: { score, level: decision === 'allow' ? 'low' : decision === 'step_up' ? 'medium' : 'high' },
    classification: { label, confidence, takeover_probability: p, recommended_decision: decision },
    reasons: reasonsFrom(facts, p, label),
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
        reasonsFrom(facts, p, label)
          .filter((x) => x.code !== 'model_assessment')
          .map((x) => x.code)
          .join(', ') || 'none'
      }.`.slice(0, 800),
    },
    latency_ms: latency,
    model: { provider: 'typesafe', name: config.jev.model, latency_ms: latency, timed_out: false },
  };
  if (decision === 'step_up') {
    response.step_up = { channel: 'in_app', challenge_id: `${decisionId}-challenge`, expires_at: expires };
  } else if (decision === 'hold') {
    response.hold = { expires_at: expires, on_timeout: 'block', confirmation_channel: 'push' };
  }
  return { escalate: false, response };
}
