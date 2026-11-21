import { Inject, Injectable, Optional } from '@nestjs/common';
import { FactsConfig, FastPathConfig, JevConfig } from './config.types';

/** The environment the configuration is read from; replaced in specs. */
export const ENVIRONMENT = 'NIGHTWATCH_ENVIRONMENT';

export const DEFAULT_REPLY_URL = 'https://bank.example/nightwatch/decisions';

@Injectable()
export class AppConfigService {
  private readonly env: Record<string, string | undefined>;

  constructor(@Optional() @Inject(ENVIRONMENT) env?: Record<string, string | undefined>) {
    this.env = env ?? process.env;
  }

  /** A number from the variable, or the default when it is unset or not a finite number. */
  number(name: string, fallback: number): number {
    const raw = this.env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  fastPath(): FastPathConfig {
    const torRaw = this.env.NIGHTWATCH_STOPPER_TOR;
    return {
      fastAllow: {
        maxAmount: this.number('NIGHTWATCH_FAST_MAX_AMOUNT', 10000),
        daily: {
          maxTotal: this.number('NIGHTWATCH_FAST_DAILY_MAX_TOTAL', 20000),
          maxCount: this.number('NIGHTWATCH_FAST_DAILY_MAX_COUNT', 5),
        },
      },
      fastAllowStoppers: {
        newDeviceHours: this.number('NIGHTWATCH_STOPPER_NEW_DEVICE_HOURS', 24),
        accessResetHours: this.number('NIGHTWATCH_STOPPER_ACCESS_RESET_HOURS', 24),
        tor: torRaw === undefined || torRaw === '' ? true : torRaw !== 'false',
        failedLoginsHour: this.number('NIGHTWATCH_STOPPER_FAILED_LOGINS_HOUR', 3),
      },
    };
  }

  facts(): FactsConfig {
    return {
      maxLoginAttempts: this.number('NIGHTWATCH_MAX_LOGIN_ATTEMPTS', 50),
      loginLookbackDays: this.number('NIGHTWATCH_LOGIN_LOOKBACK_DAYS', 30),
      minSuccessfulLogins: this.number('NIGHTWATCH_MIN_SUCCESSFUL_LOGINS', 5),
      failedLoginsWindowMinutes: this.number('NIGHTWATCH_FAILED_LOGINS_WINDOW_MINUTES', 60),
    };
  }

  jev(): JevConfig {
    return {
      jev: {
        model: this.env.NIGHTWATCH_JEV_MODEL || 'jev-latest',
        timeoutMs: this.number('NIGHTWATCH_JEV_TIMEOUT_MS', 2000),
        thresholds: {
          stepUp: this.number('NIGHTWATCH_JEV_STEP_UP', 0.2),
          hold: this.number('NIGHTWATCH_JEV_HOLD', 0.6),
        },
      },
      escalate: { minLabelConfidence: this.number('NIGHTWATCH_MIN_LABEL_CONFIDENCE', 0.5) },
      confirmation: { timeoutMinutes: this.number('NIGHTWATCH_CONFIRMATION_TIMEOUT_MINUTES', 15) },
    };
  }

  /** Where the bank receives decisions. */
  replyUrl(): string {
    return this.env.NIGHTWATCH_REPLY_URL || DEFAULT_REPLY_URL;
  }

  jevApiKey(): string {
    return this.env.TYPESAFE_API_KEY ?? '';
  }
}
