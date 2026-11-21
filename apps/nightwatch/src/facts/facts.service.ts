import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { LoginHistoryService } from '../login-history/login-history.service';
import { Facts, FactsRequest } from './facts.types';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

@Injectable()
export class FactsService {
  constructor(
    private readonly config: AppConfigService,
    private readonly history: LoginHistoryService,
  ) {}

  /** Computes the facts Jev reads from a risk request. Never throws: what cannot be computed is null. */
  compute(request: FactsRequest): Facts {
    try {
      return this.computeFacts(request ?? {});
    } catch {
      return this.emptyFacts();
    }
  }

  emptyFacts(): Facts {
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

  /** Whole units from `from` to `to`, rounded down. */
  elapsed(from: number | null, to: number | null, unit: number): number | null {
    return from === null || to === null ? null : Math.floor((to - from) / unit);
  }

  /** The hour of day (0-23) of an instant in a time zone, or null when either is unusable. */
  localHour(at: number | null, timezone: unknown): number | null {
    if (at === null || typeof timezone !== 'string') return null;
    try {
      const part = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' })
        .formatToParts(new Date(at))
        .find((p) => p.type === 'hour');
      return part ? Number(part.value) : null;
    } catch {
      return null;
    }
  }

  computeFacts(request: FactsRequest): Facts {
    const { minSuccessfulLogins } = this.config.facts();
    const time = (v: unknown) => this.history.parseTime(v);
    const requestedAt = time(request.transaction?.requested_at);
    const session = request.session;
    const authAt = time(session?.authenticated_at);
    const hour = this.localHour(authAt, request.customer?.timezone);
    const anonymizer = session?.network?.anonymizer;
    const country = session?.network?.ip_country;

    const facts = this.emptyFacts();
    facts.device_age_minutes = this.elapsed(time(session?.device_first_seen_at), requestedAt, MINUTE_MS);
    facts.hours_since_password_reset = this.elapsed(time(session?.last_password_reset_at), requestedAt, HOUR_MS);
    facts.hours_since_mfa_change = this.elapsed(time(session?.last_mfa_change_at), requestedAt, HOUR_MS);
    facts.anonymizer = typeof anonymizer === 'string' ? anonymizer : null;
    facts.login_hour_local = hour;
    facts.seconds_login_to_transfer = this.elapsed(authAt, requestedAt, 1000);

    const attempts = this.history.recentAttempts(request, requestedAt);
    if (attempts === null) return facts;
    if (authAt !== null) facts.failed_logins_1h_before = this.history.failedBefore(attempts, authAt);

    const others = this.history.otherSuccesses(attempts, authAt);
    facts.successful_logins_in_history = others.length;
    facts.thin_history = others.length < minSuccessfulLogins;
    if (!facts.thin_history) {
      if (typeof country === 'string') {
        facts.country_seen_in_successful_logins = others.some((a) => a.country === country);
      }
      if (hour !== null) {
        const timezone = request.customer?.timezone;
        facts.hour_seen_in_successful_logins = others.some((a) => this.localHour(a.at, timezone) === hour);
      }
    }
    return facts;
  }
}
