import { Test } from '@nestjs/testing';
import { riskRequestSchema, RiskRequest } from '@app/contracts';
import { CUSTOMERS, FORM_COUNTRIES } from './customers.constants';
import { CustomChoices, CustomersService } from './customers.service';

const NOW = new Date('2026-11-21T10:30:00Z'); // 14:30 Dubai
const ms = (s: string) => Date.parse(s);

const networks: Pick<CustomChoices, 'network' | 'country'>[] = [
  { network: 'home', country: '' },
  { network: 'vpn', country: '' },
  ...FORM_COUNTRIES.map((country) => ({ network: 'country' as const, country })),
];
const combos = CUSTOMERS.flatMap((c) =>
  (['known', 'new'] as const).flatMap((beneficiary) =>
    (['usual', 'new'] as const).flatMap((device) =>
      networks.flatMap((n) => (['now', 'night'] as const).map((loginTime) => ({ id: c.id, beneficiary, device, loginTime, ...n }))),
    ),
  ),
);

describe('CustomersService.buildCustom', () => {
  let svc: CustomersService;
  beforeEach(async () => {
    svc = (await Test.createTestingModule({ providers: [CustomersService] }).compile()).get(CustomersService);
  });
  const build = (o: Partial<CustomChoices> & { id?: string }, now = NOW): RiskRequest =>
    svc.buildCustom(svc.find(o.id ?? 'cus_alice')!, { amountMinor: 123456, beneficiary: 'known', device: 'usual', network: 'home', country: '', loginTime: 'now', ...o }, now);

  it('every combination of the form passes the request schema, with the chosen amount', () => {
    for (const { id, ...rest } of combos) {
      const r = build({ id, amountMinor: 250050, ...rest });
      expect(riskRequestSchema.safeParse(r).success).toBe(true);
      expect(r.transaction.amount.minor_units).toBe(250050);
      expect(r.transaction.amount_policy_minor).toBe(250050);
      expect(r.customer.customer_id).toBe(id);
    }
  });

  it.each(['now', 'night'] as const)('new device (%s): first seen 2 min before login, login 20 s before transfer', (loginTime) => {
    const r = build({ device: 'new', loginTime });
    expect(ms(r.session.authenticated_at!) - ms(r.session.device_first_seen_at!)).toBe(120_000);
    expect(ms(r.transaction.requested_at) - ms(r.session.authenticated_at!)).toBe(20_000);
    expect(r.session.device_id).not.toBe('dev_alice_iphone');
  });

  it('usual device keeps the customer device and logs in a few minutes before', () => {
    const r = build({ device: 'usual' });
    expect(r.session.device_id).toBe('dev_alice_iphone');
    const gap = ms(r.transaction.requested_at) - ms(r.session.authenticated_at!);
    expect(gap).toBeGreaterThanOrEqual(120_000);
    expect(gap).toBeLessThanOrEqual(600_000);
  });

  it('network: home keeps usual, vpn is home country with vpn, country sets ip_country', () => {
    expect(build({ id: 'cus_dmitry', network: 'home' }).session.network!).toMatchObject({ ip_country: 'AE', anonymizer: 'vpn' });
    expect(build({ network: 'home' }).session.network!).toMatchObject({ ip_country: 'AE', anonymizer: 'none_detected' });
    expect(build({ network: 'vpn' }).session.network!).toMatchObject({ ip_country: 'AE', anonymizer: 'vpn' });
    expect(build({ network: 'country', country: 'TR' }).session.network!.ip_country).toBe('TR');
  });

  it('login time: now puts the transfer at now; night puts the login at 02:00 local, not after now', () => {
    expect(ms(build({ loginTime: 'now' }).transaction.requested_at)).toBe(NOW.getTime());
    for (const device of ['usual', 'new'] as const) {
      for (const now of [NOW, new Date('2026-11-20T22:00:30Z') /* 02:00:30 Dubai */]) {
        const r = build({ loginTime: 'night', device }, now);
        expect(r.session.authenticated_at!.slice(11, 19)).toBe('02:00:00');
        expect(ms(r.transaction.requested_at)).toBeLessThanOrEqual(now.getTime());
      }
    }
  });

  it('beneficiary: new is marked new with a fresh id, known reuses a paid one', () => {
    const a = build({ beneficiary: 'new' }).transaction.beneficiary;
    const b = build({ beneficiary: 'new' }).transaction.beneficiary;
    expect(a.is_new_for_customer).toBe(true);
    expect(a.beneficiary_id).not.toBe(b.beneficiary_id);
    const known = build({ beneficiary: 'known' }).transaction.beneficiary;
    expect(known.is_new_for_customer).toBe(false);
    expect(known.beneficiary_id).toBe('ben_alice_cafe');
  });
});
