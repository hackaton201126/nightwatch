import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** The parts of the risk request the history reads; everything optional, nothing is trusted. */
export interface HistoryRequest {
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

export interface LoginAttempt {
  at: number;
  success: boolean;
  failure: boolean;
  country: string | null;
}

@Injectable()
export class LoginHistoryService {
  constructor(private readonly config: AppConfigService) {}

  /** Epoch ms of an ISO timestamp, or null when it is not one. */
  parseTime(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }

  /** Every parseable attempt of the request, in input order, with no age or count limit. */
  allAttempts(request: HistoryRequest): LoginAttempt[] {
    const list = request?.history?.recent_login_attempts;
    if (!Array.isArray(list)) return [];
    const attempts: LoginAttempt[] = [];
    for (const a of list) {
      const at = this.parseTime(a?.occurred_at);
      if (at === null) continue;
      const country = a?.network?.ip_country;
      attempts.push({
        at,
        success: a?.outcome === 'success',
        failure: a?.outcome === 'failure',
        country: typeof country === 'string' ? country : null,
      });
    }
    return attempts;
  }

  /**
   * The newest attempts (at most the configured count) within the configured days before the transfer,
   * newest first; null when the history or the transfer time is unusable.
   */
  recentAttempts(request: HistoryRequest, requestedAt: number | null): LoginAttempt[] | null {
    if (!Array.isArray(request?.history?.recent_login_attempts) || requestedAt === null) return null;
    const { loginLookbackDays, maxLoginAttempts } = this.config.facts();
    const since = requestedAt - loginLookbackDays * DAY_MS;
    return this.allAttempts(request)
      .filter((a) => a.at >= since)
      .sort((x, y) => y.at - x.at)
      .slice(0, maxLoginAttempts);
  }

  /** Failed attempts in the configured window up to and including the login. */
  failedBefore(attempts: LoginAttempt[], authAt: number): number {
    const from = authAt - this.config.facts().failedLoginsWindowMinutes * MINUTE_MS;
    return attempts.filter((a) => a.failure && a.at >= from && a.at <= authAt).length;
  }

  /** Successful logins other than the current one, which is the success at the session's own instant. */
  otherSuccesses(attempts: LoginAttempt[], authAt: number | null): LoginAttempt[] {
    return attempts.filter((a) => a.success && a.at !== authAt);
  }
}
