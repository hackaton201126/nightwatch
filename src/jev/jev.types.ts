import { Facts } from '../facts/facts.types';

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

export type ReasonCode =
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

/** What Jev answered: the parsed numbers, or a failure (timed out or anything else). */
export type JevAnswer =
  | { ok: true; p: number; label: JevLabel; confidence: number }
  | { ok: false; timedOut: boolean };

export interface JevBody {
  model: string;
  state: { request: unknown; facts: Facts };
  questions: unknown;
}

export interface AskJevOptions {
  body: JevBody;
  apiKey: string;
}

export interface DecideByJevOptions {
  request: unknown;
  facts: Facts;
  now: Date;
  decisionId: string;
  apiKey: string;
}

export interface BuildResponseOptions {
  request: unknown;
  facts: Facts;
  now: Date;
  decisionId: string;
  answer: { p: number; label: JevLabel; confidence: number };
  latencyMs: number;
}
