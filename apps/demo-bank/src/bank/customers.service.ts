import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RiskRequest } from '@app/contracts';
import { CUSTOMERS, CustomerProfile, PathId, PATH_IDS } from './customers.constants';

const OFFSET_MS = 4 * 3600 * 1000; // Asia/Dubai, no DST
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MAX_ATTEMPTS = 50;

type Net = { ip_ref: string; ip_country: string; anonymizer: 'none_detected' | 'vpn' };
type Attempt = { occurred_at: string; outcome: 'success' | 'failure'; device_id: string; network: Net };

/** Small deterministic generator: the same seed gives the same sequence. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CustomerCard {
  id: string;
  name: string;
  city: string;
  deviceLabel: string;
  hoursLabel: string;
  loginsInHistory: number;
  sent24hCount: number;
  sent24hAmountMinor: number;
}

@Injectable()
export class CustomersService {
  list(): CustomerProfile[] {
    return CUSTOMERS;
  }

  find(id: string): CustomerProfile | undefined {
    return CUSTOMERS.find((c) => c.id === id);
  }

  isPath(path: string): path is PathId {
    return (PATH_IDS as readonly string[]).includes(path);
  }

  iso(ms: number): string {
    return new Date(ms + OFFSET_MS).toISOString().replace('Z', '+04:00');
  }

  /** The latest moment not after `now` whose local wall-clock time is hh:mm:ss. */
  latestLocalTime(now: Date, hh: number, mm: number, ss: number): number {
    const dayStart = Math.floor((now.getTime() + OFFSET_MS) / DAY) * DAY - OFFSET_MS;
    const target = dayStart + hh * HOUR + mm * MINUTE + ss * SECOND;
    return target <= now.getTime() ? target : target - DAY;
  }

  card(profile: CustomerProfile, now: Date = new Date()): CustomerCard {
    const fast = this.build(profile, 'fast', now);
    const w = fast.history.windows['24h'];
    return {
      id: profile.id,
      name: profile.name,
      city: profile.city,
      deviceLabel: profile.deviceLabel,
      hoursLabel: profile.hoursLabel,
      loginsInHistory: fast.history.recent_login_attempts.length - 1,
      sent24hCount: w?.attempted_count ?? 0,
      sent24hAmountMinor: w?.attempted_amount_policy_minor ?? 0,
    };
  }

  private seed(profile: CustomerProfile): number {
    return [...profile.id].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7);
  }

  private homeNet(profile: CustomerProfile, ref: string, country = profile.homeCountry): Net {
    return { ip_ref: ref, ip_country: country, anonymizer: profile.anonymizer };
  }

  /** Past logins on a fixed local-time grid anchored to `now`, so the history does not move between paths. */
  private pastAttempts(profile: CustomerProfile, now: Date, loginAt: number, asOf: number): Attempt[] {
    const rand = mulberry32(this.seed(profile));
    const todayStart = Math.floor((now.getTime() + OFFSET_MS) / DAY) * DAY - OFFSET_MS;
    const slots: { at: number; outcome: 'success' | 'failure'; daysAgo: number }[] = [];
    if (profile.fixedLogins) {
      for (const l of profile.fixedLogins) {
        slots.push({ at: todayStart - l.daysAgo * DAY + l.hour * HOUR + Math.floor(rand() * 50) * MINUTE, outcome: 'success', daysAgo: l.daysAgo });
      }
    } else {
      const n = profile.hours.length;
      for (let k = 0; k <= 31; k++) {
        const count = k % 2 === 0 ? 2 : 1;
        for (let j = 0; j < count; j++) {
          const hour = profile.hours[(k + j) % n];
          const local = hour + (rand() * 50) / 60;
          // Hours after midnight (0–2) of a night owl belong to the next calendar day of the evening session.
          slots.push({ at: todayStart - k * DAY + Math.floor(local * 60) * MINUTE, outcome: 'success', daysAgo: k });
        }
      }
    }
    for (const f of profile.failures) {
      slots.push({ at: todayStart - f.daysAgo * DAY + f.hour * HOUR + 55 * MINUTE, outcome: 'failure', daysAgo: f.daysAgo });
    }
    return slots
      .filter((s) => s.at < loginAt - MINUTE && s.at <= now.getTime() && s.at > asOf - 30 * DAY)
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_ATTEMPTS - 1)
      .map((s) => {
        const travel = profile.travel?.find((t) => s.daysAgo >= t.fromDay && s.daysAgo <= t.toDay);
        return {
          occurred_at: this.iso(s.at),
          outcome: s.outcome,
          device_id: profile.deviceId,
          network: this.homeNet(profile, `ipr_${profile.id.slice(4)}_${s.at.toString(36)}`, travel?.country),
        };
      });
  }

  /** Builds the customer's request for a path, with the transfer at the moment that fits it relative to `now`. */
  build(profile: CustomerProfile, path: PathId, now: Date = new Date()): RiskRequest {
    let transferAt: number;
    let loginBefore: number;
    let amountMinor: number;
    let deviceId = profile.deviceId;
    let deviceFirstSeenAt = now.getTime() - profile.deviceAgeDays * DAY;
    let network: Net;
    let beneficiary: { beneficiary_id: string; is_new: boolean };
    const newBeneficiary = `ben_new_${randomUUID().slice(0, 6)}`;

    if (path === 'fast') {
      transferAt = this.latestLocalTime(now, profile.fast.hour, 30, 0);
      loginBefore = 3 * MINUTE;
      amountMinor = profile.fast.amountMinor;
      network = this.homeNet(profile, `ipr_${profile.id.slice(4)}_now`);
      beneficiary = { beneficiary_id: profile.fast.beneficiaryId, is_new: false };
    } else if (path === 'jev') {
      transferAt = this.latestLocalTime(now, profile.jev.hour, 0, 20);
      loginBefore = 20 * SECOND;
      amountMinor = profile.jev.amountMinor;
      deviceId = `dev_new_${profile.id.slice(4)}`;
      deviceFirstSeenAt = transferAt - 2 * MINUTE;
      network = { ip_ref: `ipr_${profile.id.slice(4)}_jev`, ip_country: profile.homeCountry, anonymizer: profile.jev.anonymizer };
      beneficiary = { beneficiary_id: newBeneficiary, is_new: true };
    } else {
      transferAt = this.latestLocalTime(now, profile.devin.hour, 30, 0);
      loginBefore = 3 * MINUTE;
      amountMinor = profile.devin.amountMinor;
      network = { ip_ref: `ipr_${profile.id.slice(4)}_devin`, ip_country: profile.devin.country, anonymizer: profile.anonymizer };
      beneficiary = { beneficiary_id: newBeneficiary, is_new: true };
    }

    const loginAt = transferAt - loginBefore;
    const past = this.pastAttempts(profile, now, loginAt, transferAt);
    const currentLogin: Attempt = { occurred_at: this.iso(loginAt), outcome: 'success', device_id: deviceId, network };

    const outgoing = profile.outgoing.map((o, i) => ({
      transaction_id: `tx_hist_${profile.id.slice(4)}_${i + 1}`,
      requested_at: this.iso(transferAt - o.agoMinutes * MINUTE),
      source_account_id: `acc_${profile.id.slice(4)}`,
      beneficiary_id: `ben_hist_${i + 1}`,
      beneficiary_country: profile.homeCountry,
      beneficiary_is_new: false,
      amount: { currency: 'AED', minor_units: o.amountMinor },
      status: 'executed' as const,
    }));
    const sum = (xs: { amountMinor: number }[]) => xs.reduce((s, x) => s + x.amountMinor, 0);
    const within = (minutes: number) => profile.outgoing.filter((o) => o.agoMinutes <= minutes);
    const used = within(360);
    const cid = profile.id;

    return {
      schema_version: '1.0',
      as_of: this.iso(transferAt),
      transaction: {
        transaction_id: `tx_demo_${path}_${cid.slice(4)}_${randomUUID().slice(0, 8)}`,
        requested_at: this.iso(transferAt),
        channel: 'mobile',
        initiator_id: cid,
        source_account_id: `acc_${cid.slice(4)}`,
        amount: { currency: 'AED', minor_units: amountMinor },
        amount_policy_minor: amountMinor,
        authorization: 'authorized',
        beneficiary: {
          beneficiary_id: beneficiary.beneficiary_id,
          country: profile.homeCountry,
          is_new_for_customer: beneficiary.is_new,
          cross_border: false,
          fraud_link_status: 'unknown',
        },
      },
      customer: { customer_id: cid, timezone: 'Asia/Dubai', kyc_status: 'verified' },
      session: {
        session_id: `ses_demo_${randomUUID().slice(0, 8)}`,
        authenticated_at: this.iso(loginAt),
        auth_factors: ['password', 'face_id'],
        device_id: deviceId,
        device_first_seen_at: this.iso(deviceFirstSeenAt),
        last_password_reset_at: null,
        last_mfa_change_at: null,
        network,
      },
      history: {
        recent_login_attempts: [currentLogin, ...past],
        recent_outgoing_requests: outgoing,
        windows: { '24h': { attempted_count: profile.outgoing.length, attempted_amount_policy_minor: sum(profile.outgoing) } },
      },
      policy: {
        currency: 'AED',
        fast_path_budget: {
          window_seconds: 21600,
          effective_max_count: 5,
          effective_max_total_policy_minor: 200000,
          effective_max_single_policy_minor: 100000,
          used_count: used.length,
          used_total_policy_minor: sum(used),
        },
      },
    };
  }
}
