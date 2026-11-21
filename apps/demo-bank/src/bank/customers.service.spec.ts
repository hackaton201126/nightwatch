import { Test } from '@nestjs/testing';
import { riskRequestSchema, RiskRequest } from '@app/contracts';
import { CUSTOMERS, PATH_IDS, PathId } from './customers.constants';
import { CustomChoices, CustomersService } from './customers.service';

const NOW = new Date('2026-11-21T10:30:00Z'); // 14:30 Dubai
const NIGHT_OWL = 'cus_dmitry';
const NEW_CUSTOMER = 'cus_maria';
const ms = (s: string) => Date.parse(s);
const hour = (s: string) => Number(s.slice(11, 13));

const make = async () => (await Test.createTestingModule({ providers: [CustomersService] }).compile()).get(CustomersService);
const cases = CUSTOMERS.flatMap((c) => PATH_IDS.map((p) => [c.id, p] as [string, PathId]));

describe('CustomersService', () => {
  let svc: CustomersService;
  beforeEach(async () => {
    svc = await make();
  });
  const build = (id: string, path: PathId, now = NOW): RiskRequest => svc.build(svc.find(id)!, path, now);
  const past = (r: RiskRequest) => r.history.recent_login_attempts.slice(1);
  const successHours = (r: RiskRequest) => past(r).filter((a) => a.outcome === 'success').map((a) => hour(a.occurred_at));

  it.each(cases)('%s %s: schema-valid, as_of equals requested_at, not later than now', (id, path) => {
    const r = build(id, path);
    expect(riskRequestSchema.safeParse(r).success).toBe(true);
    expect(r.as_of).toBe(r.transaction.requested_at);
    expect(ms(r.as_of)).toBeLessThanOrEqual(NOW.getTime());
  });

  it.each(CUSTOMERS.map((c) => c.id))('%s: history identical across two instances, transaction ids differ', async (id) => {
    const other = await make();
    const a = build(id, 'jev');
    const b = other.build(other.find(id)!, 'jev', NOW);
    expect(b.history).toEqual(a.history);
    expect(b.transaction.transaction_id).not.toBe(a.transaction.transaction_id);
  });

  it.each(cases)('%s %s: attempts newest first, current first, within 30 days, at most 50', (id, path) => {
    const r = build(id, path);
    const at = r.history.recent_login_attempts.map((a) => ms(a.occurred_at));
    expect(at[0]).toBe(ms(r.session.authenticated_at!));
    expect(at.length).toBeLessThanOrEqual(50);
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeLessThan(at[i - 1]);
    expect(at[at.length - 1]).toBeGreaterThan(ms(r.as_of) - 30 * 86400000);
  });

  it.each(CUSTOMERS.filter((c) => c.id !== NEW_CUSTOMER).map((c) => c.id))('%s: 30–50 attempts with a few failures', (id) => {
    const a = build(id, 'fast').history.recent_login_attempts;
    expect(a.length).toBeGreaterThanOrEqual(30);
    const failures = a.filter((x) => x.outcome === 'failure').length;
    expect(failures).toBeGreaterThanOrEqual(1);
    expect(failures).toBeLessThan(3);
  });

  it('the new customer has under 5 successful logins', () => {
    const a = build(NEW_CUSTOMER, 'fast').history.recent_login_attempts;
    expect(a.filter((x) => x.outcome === 'success').length).toBeLessThan(5);
  });

  it.each(CUSTOMERS.map((c) => c.id))('%s fast: small amount, window within limits, no stopper', (id) => {
    const r = build(id, 'fast');
    const w = r.history.windows['24h']!;
    expect(r.transaction.amount_policy_minor).toBeLessThan(1000000);
    expect(w.attempted_count + 1).toBeLessThanOrEqual(5);
    expect(w.attempted_amount_policy_minor + r.transaction.amount_policy_minor).toBeLessThanOrEqual(2000000);
    expect(ms(r.as_of) - ms(r.session.device_first_seen_at!)).toBeGreaterThan(86400000);
    expect(r.session.network?.anonymizer).not.toBe('tor');
    expect(r.session.last_password_reset_at).toBeNull();
    expect(r.history.recent_login_attempts.filter((a) => a.outcome === 'failure').length).toBeLessThan(3);
  });

  it.each(CUSTOMERS.map((c) => c.id))('%s jev: large, device 2 min old, login 20 s before', (id) => {
    const r = build(id, 'jev');
    expect(r.transaction.amount_policy_minor).toBeGreaterThan(1000000);
    // The takeover customer's device is first seen 2 minutes before the login, the others' before the transfer.
    const from = id === NIGHT_OWL ? ms(r.session.authenticated_at!) : ms(r.as_of);
    expect(from - ms(r.session.device_first_seen_at!)).toBe(120000);
    expect(ms(r.as_of) - ms(r.session.authenticated_at!)).toBe(20000);
  });

  it.each(CUSTOMERS.filter((c) => c.id !== NIGHT_OWL).map((c) => c.id))('%s jev: VPN and 02:00 local login, hour unseen', (id) => {
    const r = build(id, 'jev');
    expect(r.session.network?.anonymizer).toBe('vpn');
    expect(hour(r.session.authenticated_at!)).toBe(2);
    expect(successHours(r)).not.toContain(2);
  });

  it('jev for the VPN/night customer: login hour and anonymizer unseen in his history', () => {
    const r = build(NIGHT_OWL, 'jev');
    const h = hour(r.session.authenticated_at!);
    expect(successHours(r)).not.toContain(h);
    // The failed attempts right before the login come from the login's own network; the earlier history never does.
    const earlier = past(r).filter((a) => ms(r.session.authenticated_at!) - ms(a.occurred_at) > 30 * 60000);
    expect(earlier.map((a) => a.network?.anonymizer)).not.toContain(r.session.network?.anonymizer);
  });

  describe("Dmitry's jev takeover request", () => {
    const login = (r: RiskRequest) => ms(r.session.authenticated_at!);
    const recent = (r: RiskRequest) => past(r).filter((a) => login(r) - ms(a.occurred_at) <= 30 * 60000);
    const earlier = (r: RiskRequest) => past(r).filter((a) => login(r) - ms(a.occurred_at) > 30 * 60000);

    it('passes the schema', () => {
      expect(riskRequestSchema.safeParse(build(NIGHT_OWL, 'jev')).success).toBe(true);
    });
    it('password reset is exactly 1 hour before the login', () => {
      const r = build(NIGHT_OWL, 'jev');
      expect(login(r) - ms(r.session.last_password_reset_at!)).toBe(3600000);
    });
    it('has exactly 3 failures in the 30 minutes before the login, from its country, not before the device appeared', () => {
      const r = build(NIGHT_OWL, 'jev');
      const f = recent(r);
      expect(f).toHaveLength(3);
      for (const a of f) {
        expect(a.outcome).toBe('failure');
        expect(a.network?.ip_country).toBe(r.session.network?.ip_country);
        if (a.device_id === r.session.device_id) expect(ms(a.occurred_at)).toBeGreaterThanOrEqual(ms(r.session.device_first_seen_at!));
      }
    });
    it('uses a new device first seen 2 minutes before the login', () => {
      const r = build(NIGHT_OWL, 'jev');
      expect(r.session.device_id).not.toBe(svc.find(NIGHT_OWL)!.deviceId);
      expect(login(r) - ms(r.session.device_first_seen_at!)).toBe(120000);
    });
    it('has no VPN and a country absent from the earlier history', () => {
      const r = build(NIGHT_OWL, 'jev');
      expect(r.session.network?.anonymizer).toBe('none_detected');
      expect(earlier(r).map((a) => a.network?.ip_country)).not.toContain(r.session.network?.ip_country);
    });
    it('logs in at 14:00 Dubai, an unseen hour, and transfers 20 s later', () => {
      const r = build(NIGHT_OWL, 'jev');
      expect(r.session.authenticated_at!.slice(11, 19)).toBe('14:00:00');
      expect(successHours(r)).not.toContain(14);
      expect(ms(r.as_of) - login(r)).toBe(20000);
    });
    it('is a large amount to a new beneficiary', () => {
      const r = build(NIGHT_OWL, 'jev');
      expect(r.transaction.amount_policy_minor).toBeGreaterThan(1000000);
      expect(r.transaction.beneficiary.is_new_for_customer).toBe(true);
    });
    it('keeps the history deterministic, newest first, current login first', async () => {
      const other = await make();
      const a = build(NIGHT_OWL, 'jev');
      const b = other.build(other.find(NIGHT_OWL)!, 'jev', NOW);
      expect(b.history).toEqual(a.history);
      expect(b.session.last_password_reset_at).toBe(a.session.last_password_reset_at);
    });
  });

  describe('unchanged requests (snapshot at a fixed now, random ids normalised)', () => {
    const normalise = (r: RiskRequest) =>
      JSON.parse(
        JSON.stringify(r)
          .replace(/(tx_demo_[a-z]+_[a-z]+_)[0-9a-f]{8}/g, '$1<id>')
          .replace(/ses_demo_[0-9a-f]{8}/g, 'ses_demo_<id>')
          .replace(/ben_new_[0-9a-f]{6}/g, 'ben_new_<id>')
          .replace(/(dev_new_[a-z]+_)[0-9a-f]{6}/g, '$1<id>'),
      );
    const unchanged = cases.filter(([id, path]) => !(id === NIGHT_OWL && path === 'jev'));
    it.each(unchanged)('%s %s request is unchanged', (id, path) => {
      expect(normalise(build(id, path))).toMatchSnapshot();
    });

    const choices: CustomChoices[] = [
      { amountMinor: 500000, beneficiary: 'known', device: 'usual', network: 'home', country: 'GB', loginTime: 'now' },
      { amountMinor: 5000000, beneficiary: 'new', device: 'new', network: 'vpn', country: 'GB', loginTime: 'night' },
      { amountMinor: 2000000, beneficiary: 'new', device: 'usual', network: 'country', country: 'TR', loginTime: 'now' },
    ];
    const customCases = CUSTOMERS.flatMap((c) => choices.map((ch, i) => [c.id, i, ch] as [string, number, CustomChoices]));
    it.each(customCases)('%s custom form request #%i is unchanged', (id, _i, ch) => {
      expect(normalise(svc.buildCustom(svc.find(id)!, ch, NOW))).toMatchSnapshot();
    });
  });

  it.each(CUSTOMERS.filter((c) => c.id !== NIGHT_OWL).map((c) => c.id))('%s jev: no takeover extras', (id) => {
    const r = build(id, 'jev');
    expect(r.session.last_password_reset_at).toBeNull();
    expect(r.history.recent_login_attempts.filter((a) => a.outcome === 'failure').length).toBeLessThan(3);
  });

  it.each(CUSTOMERS.map((c) => c.id))('%s devin: large, usual device and hour, country never seen', (id) => {
    const r = build(id, 'devin');
    expect(r.transaction.amount_policy_minor).toBeGreaterThan(1000000);
    expect(r.session.device_id).toBe(svc.find(id)!.deviceId);
    expect(successHours(r)).toContain(hour(r.session.authenticated_at!));
    expect(past(r).map((a) => a.network?.ip_country)).not.toContain(r.session.network?.ip_country);
  });

  it('card summarises the customer', () => {
    const c = svc.card(svc.find('cus_alice')!, NOW);
    expect(c).toMatchObject({ name: 'Alice', sent24hCount: 2, sent24hAmountMinor: 165000 });
    expect(c.loginsInHistory).toBeGreaterThan(29);
  });
});
