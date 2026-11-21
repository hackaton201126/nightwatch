import { DEFAULT_FACTS_CONFIG, FactsConfig } from './facts.config';
import { Facts } from './jev-decision';

/** The parts of the risk request the facts read; everything optional, nothing is trusted. */
export interface FactsRequest {
  transaction?: { requested_at?: string | null } | null;
  customer?: { timezone?: string | null } | null;
  session?: {
    authenticated_at?: string | null;
    device_first_seen_at?: string | null;
    last_password_reset_at?: string | null;
    last_mfa_change_at?: string | null;
    network?: { anonymizer?: string | null; ip_country?: string | null } | null;
  } | null;
  history?: {
    recent_login_attempts?:
      | {
          occurred_at?: string | null;
          outcome?: string | null;
          network?: { ip_country?: string | null } | null;
        }[]
      | null;
  } | null;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function time(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/** Whole units from `from` to `to`, rounded down. */
function elapsed(from: number | null, to: number | null, unit: number): number | null {
  return from === null || to === null ? null : Math.floor((to - from) / unit);
}

function localHour(at: number | null, timezone: unknown): number | null {
  if (at === null || typeof timezone !== 'string') return null;
  try {
    const part = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(at))
      .find((p) => p.type === 'hour');
    return part ? Number(part.value) : null;
  } catch {
    return null;
  }
}

interface Attempt {
  at: number;
  success: boolean;
  failure: boolean;
  country: string | null;
}

function attemptsOf(request: FactsRequest, requestedAt: number | null, config: FactsConfig) {
  const list = request.history?.recent_login_attempts;
  if (!Array.isArray(list) || requestedAt === null) return null;
  const since = requestedAt - config.loginLookbackDays * DAY_MS;
  const attempts: Attempt[] = [];
  for (const a of list) {
    const at = time(a?.occurred_at);
    if (at === null || at < since) continue;
    const country = a?.network?.ip_country;
    attempts.push({
      at,
      success: a?.outcome === 'success',
      failure: a?.outcome === 'failure',
      country: typeof country === 'string' ? country : null,
    });
  }
  return attempts.sort((x, y) => y.at - x.at).slice(0, config.maxLoginAttempts);
}

/** Computes the facts Jev reads from a risk request. Never throws: what cannot be computed is null. */
export function computeFacts(
  request: FactsRequest,
  config: FactsConfig = DEFAULT_FACTS_CONFIG,
): Facts {
  try {
    return compute(request ?? {}, config);
  } catch {
    return emptyFacts();
  }
}

function emptyFacts(): Facts {
  return {
    device_age_minutes: null,
    hours_since_password_reset: null,
    hours_since_mfa_change: null,
    anonymizer: null,
    country_seen_in_successful_logins: null,
    failed_logins_1h_before: null,
    login_hour_local: null,
    hour_seen_in_successful_logins: null,
    seconds_login_to_transfer: null,
    successful_logins_in_history: null,
    thin_history: null,
  };
}

function compute(request: FactsRequest, config: FactsConfig): Facts {
  const requestedAt = time(request.transaction?.requested_at);
  const session = request.session;
  const authAt = time(session?.authenticated_at);
  const hour = localHour(authAt, request.customer?.timezone);
  const anonymizer = session?.network?.anonymizer;
  const country = session?.network?.ip_country;

  const facts = emptyFacts();
  facts.device_age_minutes = elapsed(time(session?.device_first_seen_at), requestedAt, MINUTE_MS);
  facts.hours_since_password_reset = elapsed(time(session?.last_password_reset_at), requestedAt, HOUR_MS);
  facts.hours_since_mfa_change = elapsed(time(session?.last_mfa_change_at), requestedAt, HOUR_MS);
  facts.anonymizer = typeof anonymizer === 'string' ? anonymizer : null;
  facts.login_hour_local = hour;
  facts.seconds_login_to_transfer = elapsed(authAt, requestedAt, 1000);

  const attempts = attemptsOf(request, requestedAt, config);
  if (attempts === null) return facts;

  if (authAt !== null) {
    const from = authAt - config.failedLoginsWindowMinutes * MINUTE_MS;
    facts.failed_logins_1h_before = attempts.filter(
      (a) => a.failure && a.at >= from && a.at <= authAt,
    ).length;
  }

  // The current login is the successful attempt at the session's own instant.
  const others = attempts.filter((a) => a.success && a.at !== authAt);
  facts.successful_logins_in_history = others.length;
  facts.thin_history = others.length < config.minSuccessfulLogins;
  if (!facts.thin_history) {
    if (typeof country === 'string') {
      facts.country_seen_in_successful_logins = others.some((a) => a.country === country);
    }
    if (hour !== null) {
      const timezone = request.customer?.timezone;
      facts.hour_seen_in_successful_logins = others.some((a) => localHour(a.at, timezone) === hour);
    }
  }
  return facts;
}
