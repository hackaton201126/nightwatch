import { FastPathConfig } from './fast-path.config';

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

const HOUR_MS = 3_600_000;

function ms(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function aed(minor: number): string {
  return `AED ${(minor / 100).toFixed(2)}`;
}

export function checkFastPath(
  request: FastPathRequest,
  config: FastPathConfig,
  now: Date,
  decisionId: string,
): FastPathResult {
  const limitsNotMet: string[] = [];
  const stoppers: string[] = [];
  const tx = request.transaction;
  const session = request.session;
  const requestedAt = ms(tx?.requested_at);
  const amount = tx?.amount_policy_minor;
  const window = request.history?.windows?.['24h'];
  const { fastAllow, fastAllowStoppers: st } = config;

  const amountOk = typeof amount === 'number' && Number.isInteger(amount);
  if (!amountOk || amount >= fastAllow.maxAmount * 100) limitsNotMet.push('amount');

  let count = 0;
  let total = 0;
  if (
    !window ||
    typeof window.attempted_count !== 'number' ||
    typeof window.attempted_amount_policy_minor !== 'number'
  ) {
    limitsNotMet.push('daily_window_missing');
  } else if (amountOk) {
    count = window.attempted_count + 1;
    total = window.attempted_amount_policy_minor + amount;
    if (count > fastAllow.daily.maxCount) limitsNotMet.push('daily_count');
    if (total > fastAllow.daily.maxTotal * 100) limitsNotMet.push('daily_total');
  }

  if (requestedAt === null) limitsNotMet.push('requested_at_missing');

  // device age: unknown first-seen time cannot show the device is old, so no shortcut
  const firstSeen = ms(session?.device_first_seen_at);
  if (firstSeen === null) {
    stoppers.push('device_first_seen_unknown');
  } else if (requestedAt !== null && requestedAt - firstSeen < st.newDeviceHours * HOUR_MS) {
    stoppers.push('new_device');
  }

  // a never-changed password or MFA is null: not a stopper
  const recent = (v: unknown) => {
    const t = ms(v);
    return t !== null && requestedAt !== null && requestedAt - t < st.accessResetHours * HOUR_MS;
  };
  if (recent(session?.last_password_reset_at)) stoppers.push('recent_password_reset');
  if (recent(session?.last_mfa_change_at)) stoppers.push('recent_mfa_change');

  if (st.tor && session?.network?.anonymizer === 'tor') stoppers.push('tor');

  const authAt = ms(session?.authenticated_at);
  if (authAt === null) {
    stoppers.push('authenticated_at_unknown');
  } else {
    const failed = (request.history?.recent_login_attempts ?? []).filter((a) => {
      const t = ms(a?.occurred_at);
      return a?.outcome === 'failure' && t !== null && t >= authAt - HOUR_MS && t <= authAt;
    }).length;
    if (failed >= st.failedLoginsHour) stoppers.push('failed_logins');
  }

  if (limitsNotMet.length > 0 || stoppers.length > 0 || !tx || !amountOk) {
    return { shortcut: false, limitsNotMet, stoppers };
  }

  const detail = `${aed(amount)}; 24h with this transfer: ${count} tx, ${aed(total)}`;
  return {
    shortcut: true,
    response: {
      schema_version: '1.0',
      decision_id: decisionId,
      transaction_id: tx.transaction_id ?? '',
      decided_at: now.toISOString(),
      decision: 'allow',
      final: true,
      decided_by: 'fast_path',
      risk: { score: 0, level: 'low' },
      classification: null,
      reasons: [{ code: 'small_amount', detail }],
      actions: ['execute'],
      explanation: {
        customer: 'Small transfer, processed immediately.',
        analyst:
          `Fast path: amount ${aed(amount)} is below the ${aed(fastAllow.maxAmount * 100)} limit. ` +
          `24h totals including this transfer: ${count} transactions (limit ${fastAllow.daily.maxCount}), ` +
          `${aed(total)} (limit ${aed(fastAllow.daily.maxTotal * 100)}). ` +
          'No takeover stopper: known device, no recent password/MFA change, no Tor, fewer than ' +
          `${st.failedLoginsHour} failed logins in the hour before login. No model was asked.`,
      },
      latency_ms: 0,
      model: null,
    },
  };
}
