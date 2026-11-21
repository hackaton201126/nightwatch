import { randomUUID } from 'crypto';
import { RiskRequest } from '../contracts';

export const SCENARIO_IDS = ['dinner', 'rent', 'attack', 'disputed'] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export const SCENARIO_LABELS: Record<ScenarioId, string> = {
  dinner: 'Dinner AED 85',
  rent: 'Rent AED 15 000',
  attack: 'Attack AED 450 000',
  disputed: 'Disputed login',
};

const DUBAI_OFFSET_MS = 4 * 3600 * 1000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Formats an instant as ISO 8601 in Dubai time (+04:00, no DST). */
export const dubai = (ms: number): string =>
  new Date(ms + DUBAI_OFFSET_MS).toISOString().replace('Z', '+04:00');

/**
 * The latest moment not after `now` whose Dubai wall-clock time is hh:mm:ss.
 * Whole-day steps from now keep the wall-clock time of the scenario.
 */
export function latestDubaiTime(now: Date, hh: number, mm: number, ss: number): number {
  const dayStart = Math.floor((now.getTime() + DUBAI_OFFSET_MS) / DAY) * DAY - DUBAI_OFFSET_MS;
  const target = dayStart + hh * HOUR + mm * MINUTE + ss * SECOND;
  return target <= now.getTime() ? target : target - DAY;
}

const NET_HOME = (ref: string) => ({ ip_ref: ref, ip_country: 'AE', anonymizer: 'none_detected' as const });
const KNOWN_DEVICE = 'dev_7f3a';

/** Alice's past logins on her own phone, one or two a day, at her usual hours (8–21 Dubai). */
function aliceHistory(transferAt: number, newestAt: number) {
  const dayStart = Math.floor((transferAt + DUBAI_OFFSET_MS) / DAY) * DAY - DUBAI_OFFSET_MS;
  const hours = [[8.6, 13.4], [9.4, 20.9], [12.7, 19.1], [13.1, 21.3], [8.9, 12.4]];
  const out: { occurred_at: string; outcome: 'success'; device_id: string; network: ReturnType<typeof NET_HOME> }[] = [];
  for (let d = 1; d <= 30; d++) {
    for (const h of hours[d % hours.length]) {
      const at = dayStart - d * DAY + Math.round(h * HOUR);
      if (at < newestAt) out.push({ occurred_at: dubai(at), outcome: 'success', device_id: KNOWN_DEVICE, network: NET_HOME(`ipr_h${d}_${Math.round(h)}`) });
    }
  }
  return out.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
}

interface Spec {
  transferAt: number;
  amountMinor: number;
  loginBefore: number;
  deviceId: string;
  deviceFirstSeenBefore: number;
  network: { ip_ref: string; ip_country: string; anonymizer: 'none_detected' | 'vpn' };
}

function build(id: ScenarioId, s: Spec): RiskRequest {
  const t = s.transferAt;
  const loginAt = t - s.loginBefore;
  const history = aliceHistory(t, loginAt);
  const currentLogin = {
    occurred_at: dubai(loginAt),
    outcome: 'success' as const,
    device_id: s.deviceId,
    network: s.network,
  };
  return {
    schema_version: '1.0',
    as_of: dubai(t),
    transaction: {
      transaction_id: `tx_demo_${id}_${randomUUID().slice(0, 8)}`,
      requested_at: dubai(t),
      channel: 'mobile',
      initiator_id: 'cus_alice',
      source_account_id: 'acc_1',
      amount: { currency: 'AED', minor_units: s.amountMinor },
      amount_policy_minor: s.amountMinor,
      authorization: 'authorized',
      beneficiary: {
        beneficiary_id: id === 'dinner' ? 'ben_restaurant' : 'ben_x9',
        country: 'AE',
        is_new_for_customer: id !== 'dinner',
        cross_border: false,
        fraud_link_status: 'unknown',
      },
    },
    customer: { customer_id: 'cus_alice', timezone: 'Asia/Dubai', kyc_status: 'verified' },
    session: {
      session_id: `ses_demo_${randomUUID().slice(0, 8)}`,
      authenticated_at: dubai(loginAt),
      auth_factors: ['password', 'face_id'],
      device_id: s.deviceId,
      device_first_seen_at: dubai(t - s.deviceFirstSeenBefore),
      last_password_reset_at: null,
      last_mfa_change_at: null,
      network: s.network,
    },
    history: {
      recent_login_attempts: [currentLogin, ...history],
      recent_outgoing_requests: [],
      windows: { '24h': { attempted_count: 0, attempted_amount_policy_minor: 0 } },
    },
    policy: {
      currency: 'AED',
      fast_path_budget: {
        window_seconds: 21600,
        effective_max_count: 5,
        effective_max_total_policy_minor: 200000,
        effective_max_single_policy_minor: 100000,
        used_count: 0,
        used_total_policy_minor: 0,
      },
    },
  };
}

const OWN_DEVICE_AGE = 400 * DAY;

/** Builds the scenario's request with the transfer at the moment that fits it relative to `now`. */
export function buildScenario(id: ScenarioId, now: Date = new Date()): RiskRequest {
  switch (id) {
    case 'dinner':
    case 'rent':
      return build(id, {
        transferAt: now.getTime(),
        amountMinor: id === 'dinner' ? 8500 : 1500000,
        loginBefore: 3 * MINUTE,
        deviceId: KNOWN_DEVICE,
        deviceFirstSeenBefore: OWN_DEVICE_AGE,
        network: NET_HOME('ipr_96d0cc5f'),
      });
    case 'attack':
      return build(id, {
        transferAt: latestDubaiTime(now, 2, 0, 20),
        amountMinor: 45000000,
        loginBefore: 20 * SECOND,
        deviceId: 'dev_e91b',
        deviceFirstSeenBefore: 2 * MINUTE,
        network: { ip_ref: 'ipr_9c11e2aa', ip_country: 'AE', anonymizer: 'vpn' },
      });
    case 'disputed':
      return build(id, {
        transferAt: latestDubaiTime(now, 20, 5, 0),
        amountMinor: 1200000,
        loginBefore: 3 * MINUTE,
        deviceId: KNOWN_DEVICE,
        deviceFirstSeenBefore: OWN_DEVICE_AGE,
        network: { ip_ref: 'ipr_ge41b7c2', ip_country: 'GE', anonymizer: 'none_detected' },
      });
  }
}

export const isScenarioId = (id: string): id is ScenarioId => (SCENARIO_IDS as readonly string[]).includes(id);
