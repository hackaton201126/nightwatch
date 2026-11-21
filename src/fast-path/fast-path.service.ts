import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { LoginHistoryService } from '../login-history/login-history.service';
import { CheckFastPathOptions, FastPathAllowResponse, FastPathRequest, FastPathResult } from './fast-path.types';

const HOUR_MS = 3_600_000;


@Injectable()
export class FastPathService {
  constructor(
    private readonly config: AppConfigService,
    private readonly history: LoginHistoryService,
  ) {}

  /** Decides whether the transfer is small and clean enough to skip the model. Never throws on bad data. */
  check(options: CheckFastPathOptions): FastPathResult {
    const { request, now, decisionId } = options;
    const tx = request.transaction;
    const amount = tx?.amount_policy_minor;
    const amountOk = typeof amount === 'number' && Number.isInteger(amount);
    const limitsNotMet = this.findLimitsNotMet(request);
    const stoppers = this.findStoppers(request);
    if (limitsNotMet.length > 0 || stoppers.length > 0 || !tx || !amountOk) {
      return { shortcut: false, limitsNotMet, stoppers };
    }
    return { shortcut: true, response: this.buildAllow(request, now, decisionId) };
  }

  /** Names of the amount and daily limits the transfer breaks, or whose data is missing. */
  findLimitsNotMet(request: FastPathRequest): string[] {
    const { fastAllow } = this.config.fastPath();
    const limitsNotMet: string[] = [];
    const amount = request.transaction?.amount_policy_minor;
    const amountOk = typeof amount === 'number' && Number.isInteger(amount);
    if (!amountOk || amount >= fastAllow.maxAmount * 100) limitsNotMet.push('amount');

    const window = request.history?.windows?.['24h'];
    if (
      !window ||
      typeof window.attempted_count !== 'number' ||
      typeof window.attempted_amount_policy_minor !== 'number'
    ) {
      limitsNotMet.push('daily_window_missing');
    } else if (amountOk) {
      const count = window.attempted_count + 1;
      const total = window.attempted_amount_policy_minor + amount;
      if (count > fastAllow.daily.maxCount) limitsNotMet.push('daily_count');
      if (total > fastAllow.daily.maxTotal * 100) limitsNotMet.push('daily_total');
    }
    if (this.history.parseTime(request.transaction?.requested_at) === null) limitsNotMet.push('requested_at_missing');
    return limitsNotMet;
  }

  /** Names of the takeover stoppers that forbid the shortcut. */
  findStoppers(request: FastPathRequest): string[] {
    const { fastAllowStoppers: st } = this.config.fastPath();
    const stoppers: string[] = [];
    const session = request.session;
    const requestedAt = this.history.parseTime(request.transaction?.requested_at);

    // device age: unknown first-seen time cannot show the device is old, so no shortcut
    const firstSeen = this.history.parseTime(session?.device_first_seen_at);
    if (firstSeen === null) {
      stoppers.push('device_first_seen_unknown');
    } else if (requestedAt !== null && requestedAt - firstSeen < st.newDeviceHours * HOUR_MS) {
      stoppers.push('new_device');
    }

    // a never-changed password or MFA is null: not a stopper
    if (this.isRecent(session?.last_password_reset_at, requestedAt, st.accessResetHours)) {
      stoppers.push('recent_password_reset');
    }
    if (this.isRecent(session?.last_mfa_change_at, requestedAt, st.accessResetHours)) {
      stoppers.push('recent_mfa_change');
    }
    if (st.tor && session?.network?.anonymizer === 'tor') stoppers.push('tor');

    const authAt = this.history.parseTime(session?.authenticated_at);
    if (authAt === null) {
      stoppers.push('authenticated_at_unknown');
    } else {
      const attempts = this.history.recentAttempts(request, requestedAt) ?? [];
      if (this.history.failedBefore(attempts, authAt) >= st.failedLoginsHour) stoppers.push('failed_logins');
    }
    return stoppers;
  }

  /** True when the timestamp is within `hours` before the transfer. */
  isRecent(value: unknown, requestedAt: number | null, hours: number): boolean {
    const t = this.history.parseTime(value);
    return t !== null && requestedAt !== null && requestedAt - t < hours * HOUR_MS;
  }

  formatAed(minor: number): string {
    return `AED ${(minor / 100).toFixed(2)}`;
  }

  /** The fast_path allow response; call only for a request that passed every limit and stopper. */
  buildAllow(request: FastPathRequest, now: Date, decisionId: string): FastPathAllowResponse {
    const { fastAllow, fastAllowStoppers: st } = this.config.fastPath();
    const amount = request.transaction?.amount_policy_minor as number;
    const window = request.history?.windows?.['24h'];
    const count = (window?.attempted_count ?? 0) + 1;
    const total = (window?.attempted_amount_policy_minor ?? 0) + amount;
    const aed = (minor: number) => this.formatAed(minor);
    return {
      schema_version: '1.0',
      decision_id: decisionId,
      transaction_id: request.transaction?.transaction_id ?? '',
      decided_at: now.toISOString(),
      decision: 'allow',
      final: true,
      decided_by: 'fast_path',
      risk: { score: 0, level: 'low' },
      classification: null,
      reasons: [{ code: 'small_amount', detail: `${aed(amount)}; 24h with this transfer: ${count} tx, ${aed(total)}` }],
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
    };
  }
}


