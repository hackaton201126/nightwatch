import { readFileSync } from 'fs';
import { join } from 'path';
import { computeFacts, DEFAULT_FACTS_CONFIG, FactsRequest } from './index';

const ex = (n: string) => JSON.parse(readFileSync(join(__dirname, '../../docs/examples', n), 'utf8'));

const REQUESTED = '2026-11-21T02:00:20+04:00';
const AUTH = '2026-11-21T02:00:00+04:00'; // 22:00Z, local hour 2 in Asia/Dubai
const AUTH_MS = Date.parse(AUTH);
const at = (offsetMs: number) => new Date(AUTH_MS + offsetMs).toISOString();
const H = 3_600_000;
const D = 24 * H;

type Attempt = { occurred_at?: string; outcome: string; network?: { ip_country: string } };
const ok = (occurred_at: string, ip_country = 'AE'): Attempt => ({ occurred_at, outcome: 'success', network: { ip_country } });
const fail = (occurred_at: string): Attempt => ({ occurred_at, outcome: 'failure' });

function req(attempts: Attempt[], extra: Partial<FactsRequest> = {}): FactsRequest {
  return {
    transaction: { requested_at: REQUESTED },
    customer: { timezone: 'Asia/Dubai' },
    session: { authenticated_at: AUTH, network: { anonymizer: 'none_detected', ip_country: 'AE' } },
    history: { recent_login_attempts: [ok(AUTH), ...attempts] },
    ...extra,
  };
}
/** n successes before the current login, spaced 1h apart from 1 day back. */
const successes = (n: number) => Array.from({ length: n }, (_, i) => ok(at(-D - i * H)));

describe('computeFacts', () => {
  it.each(['jev-attack.json', 'jev-normal.json'])('matches state.facts of %s', (name) => {
    const example = ex(name);
    expect(computeFacts(example.state.request)).toEqual(example.state.facts);
  });

  it('rounds durations down', () => {
    const facts = computeFacts(
      req([], {
        session: {
          authenticated_at: AUTH,
          device_first_seen_at: new Date(Date.parse(REQUESTED) - 119_999).toISOString(),
          last_password_reset_at: new Date(Date.parse(REQUESTED) - (2 * H - 1)).toISOString(),
          last_mfa_change_at: new Date(Date.parse(REQUESTED) - 5 * H).toISOString(),
        },
      }),
    );
    expect(facts.device_age_minutes).toBe(1);
    expect(facts.hours_since_password_reset).toBe(1);
    expect(facts.hours_since_mfa_change).toBe(5);
    expect(facts.seconds_login_to_transfer).toBe(20);
  });

  it('uses only the newest attempts whatever the input order, and ignores an older 51st success', () => {
    const base = successes(49); // + current = 50 attempts
    const old = ok(at(-20 * D), 'FR'); // oldest, a 51st attempt, in a new country
    const facts = computeFacts(req([old, ...base].reverse()));
    expect(facts.successful_logins_in_history).toBe(49);
    expect(facts.country_seen_in_successful_logins).toBe(true);
    expect(computeFacts(req(base))).toEqual(facts);
    expect(DEFAULT_FACTS_CONFIG.maxLoginAttempts).toBe(50);
  });

  it('ignores attempts older than the lookback in every count and comparison', () => {
    const facts = computeFacts(req([...successes(5), ok(at(-31 * D), 'FR'), ok(at(-31 * D)), fail(at(-31 * D))]));
    expect(facts.successful_logins_in_history).toBe(5);
    const onlyOld = computeFacts(req([...successes(4), ok(at(-31 * D))]));
    expect(onlyOld.successful_logins_in_history).toBe(4);
    expect(onlyOld.thin_history).toBe(true);
  });

  it('does not count the current login', () => {
    // five logins at local hours 10..14, none at the current login's hour 2 or country FR
    const filler = [10, 11, 12, 13, 14].map((h) => ok(`2026-11-19T${String(h - 4).padStart(2, '0')}:30:00Z`));
    const facts = computeFacts(req(filler, { session: { authenticated_at: AUTH, network: { ip_country: 'FR' } } }));
    expect(facts.successful_logins_in_history).toBe(5);
    expect(facts.country_seen_in_successful_logins).toBe(false);
    expect(facts.hour_seen_in_successful_logins).toBe(false);
  });

  it('marks thin history below 5 successes and nulls the comparisons', () => {
    const thin = computeFacts(req(successes(4)));
    expect(thin).toMatchObject({
      successful_logins_in_history: 4,
      thin_history: true,
      country_seen_in_successful_logins: null,
      hour_seen_in_successful_logins: null,
    });
    const enough = computeFacts(req(successes(5)));
    expect(enough.thin_history).toBe(false);
    expect(enough.country_seen_in_successful_logins).toBe(true);
  });

  it('counts failures only in the window before authentication', () => {
    const facts = computeFacts(
      req([
        fail(at(-1000)),
        fail(at(-60 * 60_000)),
        fail(at(-60 * 60_000 - 1)),
        fail(at(1000)),
        fail(at(-5 * H)),
      ]),
    );
    expect(facts.failed_logins_1h_before).toBe(2);
  });

  it('takes the local hour in the customer timezone, not UTC', () => {
    // five logins at local hours 10..14 (06Z..10Z), none at local 2
    const filler = [10, 11, 12, 13, 14].map((h) => ok(`2026-11-19T${String(h - 4).padStart(2, '0')}:30:00Z`));
    const none = computeFacts(req(filler));
    expect(none.login_hour_local).toBe(2);
    expect(none.hour_seen_in_successful_logins).toBe(false);
    // 22:30Z is local 2: matches although its UTC hour differs from the filler's
    expect(computeFacts(req([...filler, ok('2026-11-19T22:30:00Z')])).hour_seen_in_successful_logins).toBe(true);
    // 02:30Z shares no local hour (6) but a UTC-hour comparison with 02Z-something would wrongly match
    expect(computeFacts(req([...filler, ok('2026-11-19T02:30:00Z')])).hour_seen_in_successful_logins).toBe(false);
  });

  it('gives null and throws nothing on missing or bad data', () => {
    const empty = computeFacts({});
    expect(Object.values(empty).every((v) => v === null)).toBe(true);
    expect(() => computeFacts(null as unknown as FactsRequest)).not.toThrow();
    const bad = computeFacts({
      transaction: { requested_at: 'nope' },
      customer: { timezone: 'Mars/Base' },
      session: { authenticated_at: 'x', device_first_seen_at: 5 as unknown as string },
      history: { recent_login_attempts: [null, { occurred_at: 'bad' }] as unknown as Attempt[] },
    });
    expect(Object.values(bad).every((v) => v === null)).toBe(true);
    const badZone = computeFacts(req(successes(5), { customer: { timezone: 'Mars/Base' } }));
    expect(badZone.login_hour_local).toBeNull();
    expect(badZone.hour_seen_in_successful_logins).toBeNull();
  });
});
