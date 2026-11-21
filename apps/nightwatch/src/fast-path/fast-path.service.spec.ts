import { readFileSync } from 'fs';
import { join } from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { Test } from '@nestjs/testing';
import { AppConfigService, ENVIRONMENT } from '../config/app-config.service';
import { LoginHistoryService } from '../login-history/login-history.service';
import { FastPathService } from './fast-path.service';
import { FastPathRequest } from './fast-path.types';

const NOW = new Date('2026-05-01T12:00:00Z');
const REQUESTED = '2026-05-01T12:00:00Z';
const ago = (h: number) => new Date(Date.parse(REQUESTED) - h * 3_600_000).toISOString();

function req(over: {
  amount?: number;
  window?: any;
  session?: any;
  attempts?: any[];
} = {}): FastPathRequest {
  return {
    transaction: {
      transaction_id: 'tx-1',
      requested_at: REQUESTED,
      amount_policy_minor: over.amount ?? 8500,
    },
    session: {
      authenticated_at: ago(0.1),
      device_first_seen_at: ago(24 * 30),
      last_password_reset_at: null,
      last_mfa_change_at: null,
      network: { anonymizer: 'none_detected' },
      ...over.session,
    },
    history: {
      recent_login_attempts: over.attempts ?? [],
      windows: {
        '24h': 'window' in over ? over.window : { attempted_count: 1, attempted_amount_policy_minor: 50000 },
      },
    },
  };
}

let service: FastPathService;
const useEnv = async (env: Record<string, string> = {}) => {
  const moduleRef = await Test.createTestingModule({
    providers: [FastPathService, LoginHistoryService, AppConfigService, { provide: ENVIRONMENT, useValue: env }],
  }).compile();
  service = moduleRef.get(FastPathService);
};
beforeEach(() => useEnv());

const run = (r: FastPathRequest) => service.check({ request: r, now: NOW, decisionId: 'dec-1' });
const allowed = (r: FastPathRequest) => run(r).shortcut;
const stoppers = (r: FastPathRequest) => {
  const res = run(r);
  return res.shortcut ? [] : res.stoppers;
};
const failures = (n: number, atHoursBefore = 0.5) =>
  Array.from({ length: n }, () => ({ occurred_at: ago(0.1 + atHoursBefore), outcome: 'failure' }));

describe('FastPathService', () => {
  it('lets a small clean transfer through with the fast_path allow', () => {
    const res = run(req());
    expect(res.shortcut).toBe(true);
    if (!res.shortcut) return;
    expect(res.response).toMatchObject({
      decision: 'allow',
      final: true,
      decided_by: 'fast_path',
      risk: { score: 0, level: 'low' },
      reasons: [{ code: 'small_amount' }],
      transaction_id: 'tx-1',
    });
  });

  it('produces a response valid against the response schema, naming amount and 24h totals', () => {
    const schema = JSON.parse(
      readFileSync(join(__dirname, '../../../../docs/nightwatch-risk-response.schema.json'), 'utf8'),
    );
    const ajv = new Ajv({ strict: false });
    addFormats(ajv);
    const res = run(req());
    if (!res.shortcut) throw new Error('expected shortcut');
    const validate = ajv.compile(schema);
    expect(validate(res.response)).toBe(true);
    expect(validate.errors).toBeNull();
    expect(res.response.explanation.analyst).toContain('AED 85.00');
    expect(res.response.explanation.analyst).toContain('2 transactions');
    expect(res.response.explanation.analyst).toContain('AED 585.00');
  });

  it('treats AED 10 000 as not small and AED 9 999.99 as small', () => {
    const window = { attempted_count: 0, attempted_amount_policy_minor: 0 };
    expect(allowed(req({ amount: 1_000_000, window }))).toBe(false);
    expect(allowed(req({ amount: 999_999, window }))).toBe(true);
  });

  it('allows the 5th transaction in 24h, not the 6th', () => {
    expect(allowed(req({ window: { attempted_count: 4, attempted_amount_policy_minor: 1000 } }))).toBe(true);
    expect(allowed(req({ window: { attempted_count: 5, attempted_amount_policy_minor: 1000 } }))).toBe(false);
  });

  it('allows a 24h total of exactly AED 20 000, not one fil more', () => {
    expect(allowed(req({ amount: 500_000, window: { attempted_count: 1, attempted_amount_policy_minor: 1_500_000 } }))).toBe(true);
    expect(allowed(req({ amount: 500_001, window: { attempted_count: 1, attempted_amount_policy_minor: 1_500_000 } }))).toBe(false);
  });

  it('a device first seen under 24h ago alone blocks; exactly 24h does not', () => {
    expect(stoppers(req({ session: { device_first_seen_at: ago(23.9) } }))).toEqual(['new_device']);
    expect(allowed(req({ session: { device_first_seen_at: ago(24) } }))).toBe(true);
  });

  it('a recent password change, and an MFA change, each alone block and are named', () => {
    expect(stoppers(req({ session: { last_password_reset_at: ago(2) } }))).toEqual(['recent_password_reset']);
    expect(stoppers(req({ session: { last_mfa_change_at: ago(2) } }))).toEqual(['recent_mfa_change']);
    expect(allowed(req({ session: { last_mfa_change_at: ago(30) } }))).toBe(true);
  });

  it('tor alone blocks; vpn does not', () => {
    expect(stoppers(req({ session: { network: { anonymizer: 'tor' } } }))).toEqual(['tor']);
    expect(allowed(req({ session: { network: { anonymizer: 'vpn' } } }))).toBe(true);
    expect(allowed(req({ session: { network: null } }))).toBe(true);
  });

  it('3 failed logins in the hour before authentication block; 2 or 3 outside the hour do not', () => {
    expect(stoppers(req({ attempts: failures(3) }))).toEqual(['failed_logins']);
    expect(allowed(req({ attempts: failures(2) }))).toBe(true);
    expect(allowed(req({ attempts: failures(3, 2) }))).toBe(true);
    expect(allowed(req({ attempts: [...failures(2), { occurred_at: ago(0.5), outcome: 'success' }] }))).toBe(true);
  });

  it.each([
    ['missing 24h window', req({ window: undefined })],
    ['null 24h window', req({ window: null })],
    ['missing device_first_seen_at', req({ session: { device_first_seen_at: undefined } })],
    ['null device_first_seen_at', req({ session: { device_first_seen_at: null } })],
    ['null authenticated_at', req({ session: { authenticated_at: null } })],
    ['no history at all', { transaction: req().transaction }],
    ['empty request', {}],
  ])('never allows on %s', (_name, r) => {
    expect(() => run(r)).not.toThrow();
    expect(allowed(r)).toBe(false);
  });

  it('counts failed logins over every attempt, not only the newest 50 within 30 days', () => {
    const successes = Array.from({ length: 50 }, () => ({ occurred_at: ago(0.05), outcome: 'success' }));
    const failed = Array.from({ length: 3 }, () => ({ occurred_at: ago(0.1 + 0.67), outcome: 'failure' }));
    expect(stoppers(req({ attempts: [...successes, ...failed] }))).toEqual(['failed_logins']);
  });

  it('reads limits from the injected config service', async () => {
    const r = req({ amount: 500_000, window: { attempted_count: 0, attempted_amount_policy_minor: 0 } });
    expect(allowed(r)).toBe(true);
    await useEnv({
      NIGHTWATCH_FAST_MAX_AMOUNT: '1000',
      NIGHTWATCH_FAST_DAILY_MAX_TOTAL: '2000',
      NIGHTWATCH_FAST_DAILY_MAX_COUNT: '1',
    });
    expect(allowed(r)).toBe(false);
    await useEnv({ NIGHTWATCH_STOPPER_TOR: 'false' });
    expect(allowed(req({ session: { network: { anonymizer: 'tor' } } }))).toBe(true);
  });
});
