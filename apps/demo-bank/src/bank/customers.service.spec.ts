import { Test } from '@nestjs/testing';
import { riskRequestSchema, RiskRequest } from '@app/contracts';
import { CUSTOMERS, PATH_IDS, PathId } from './customers.constants';
import { CustomersService } from './customers.service';

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
    expect(ms(r.as_of) - ms(r.session.device_first_seen_at!)).toBe(120000);
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
    expect(past(r).map((a) => a.network?.anonymizer)).not.toContain(r.session.network?.anonymizer);
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
