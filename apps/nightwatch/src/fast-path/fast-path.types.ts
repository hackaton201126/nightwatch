/** The parts of the risk request the fast path reads; everything optional, nothing is trusted. */
export interface FastPathRequest {
  transaction?: {
    transaction_id?: string;
    requested_at?: string;
    amount_policy_minor?: number;
  } | null;
  session?: {
    authenticated_at?: string | null;
    device_first_seen_at?: string | null;
    last_password_reset_at?: string | null;
    last_mfa_change_at?: string | null;
    network?: { anonymizer?: string | null } | null;
  } | null;
  history?: {
    recent_login_attempts?: { occurred_at?: string; outcome?: string }[] | null;
    windows?: {
      '24h'?: {
        attempted_count?: number;
        attempted_amount_policy_minor?: number;
      } | null;
    } | null;
  } | null;
}

export interface FastPathAllowResponse {
  schema_version: '1.0';
  decision_id: string;
  transaction_id: string;
  decided_at: string;
  decision: 'allow';
  final: true;
  decided_by: 'fast_path';
  risk: { score: 0; level: 'low' };
  classification: null;
  reasons: { code: 'small_amount'; detail: string }[];
  actions: ['execute'];
  explanation: { customer: string; analyst: string };
  latency_ms: number;
  model: null;
}

export type FastPathResult =
  | { shortcut: true; response: FastPathAllowResponse }
  | { shortcut: false; limitsNotMet: string[]; stoppers: string[] };

export interface CheckFastPathOptions {
  request: FastPathRequest;
  now: Date;
  decisionId: string;
}
