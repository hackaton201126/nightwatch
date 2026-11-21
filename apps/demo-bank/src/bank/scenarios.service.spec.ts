import { Test } from '@nestjs/testing';
import { riskRequestSchema } from '@app/contracts';
import { SCENARIO_IDS, ScenarioId } from './scenarios.constants';
import { ScenariosService } from './scenarios.service';

const ms = (s: string) => Date.parse(s);
const dubaiHour = (s: string) => Number(s.slice(11, 13));
const timestamps = (v: unknown): string[] => {
  if (typeof v === 'string') return /^\d{4}-\d\d-\d\dT/.test(v) ? [v] : [];
  if (Array.isArray(v)) return v.flatMap(timestamps);
  if (v && typeof v === 'object') return Object.values(v).flatMap(timestamps);
  return [];
};

const NOW = new Date('2026-11-21T10:30:00Z'); // 14:30 Dubai

let scenarios: ScenariosService;
beforeEach(async () => {
  const moduleRef = await Test.createTestingModule({ providers: [ScenariosService] }).compile();
  scenarios = moduleRef.get(ScenariosService);
});
const buildScenario = (id: ScenarioId, now: Date) => scenarios.buildScenario(id, now);

describe('ScenariosService', () => {
  it.each(SCENARIO_IDS)('%s builds a schema-valid request with as_of at the transfer', (id) => {
    const req = buildScenario(id, NOW);
    expect(riskRequestSchema.safeParse(req).success).toBe(true);
    expect(req.as_of).toBe(req.transaction.requested_at);
    expect(ms(req.transaction.requested_at)).toBeLessThanOrEqual(NOW.getTime());
  });

  it.each(['dinner', 'rent'] as ScenarioId[])('%s transfers exactly now from Alice\'s known device without VPN', (id) => {
    const req = buildScenario(id, NOW);
    expect(ms(req.transaction.requested_at)).toBe(NOW.getTime());
    expect(req.session.device_id).toBe('dev_7f3a');
    expect(req.session.network?.anonymizer).toBe('none_detected');
    expect(req.transaction.amount.minor_units).toBe(id === 'dinner' ? 8500 : 1500000);
  });

  it('attack: AED 450 000 at 02:00:20 Dubai, new device 2 min old, login 20 s before, VPN', () => {
    const req = buildScenario('attack', NOW);
    expect(req.transaction.requested_at).toBe('2026-11-21T02:00:20.000+04:00');
    expect(req.transaction.amount.minor_units).toBe(45000000);
    const t = ms(req.transaction.requested_at);
    expect(t - ms(req.session.authenticated_at as string)).toBe(20_000);
    expect(t - ms(req.session.device_first_seen_at as string)).toBe(120_000);
    expect(req.session.network?.anonymizer).toBe('vpn');
  });

  it('attack: before 02:00:20 Dubai it uses the previous day, at it exactly now', () => {
    const before = buildScenario('attack', new Date('2026-11-20T21:59:00Z')); // 01:59 Dubai
    expect(before.transaction.requested_at).toBe('2026-11-20T02:00:20.000+04:00');
    const at = buildScenario('attack', new Date('2026-11-20T22:00:20Z'));
    expect(at.transaction.requested_at).toBe('2026-11-21T02:00:20.000+04:00');
  });

  it('disputed: login from a new country, no anonymizer, evening, amount over the shortcut', () => {
    const req = buildScenario('disputed', NOW);
    const country = req.session.network?.ip_country;
    const past = req.history.recent_login_attempts.slice(1);
    expect(country).toBeTruthy();
    expect(past.some((l) => l.network?.ip_country === country)).toBe(false);
    expect(req.session.network?.anonymizer).toBe('none_detected');
    const hour = dubaiHour(req.session.authenticated_at as string);
    expect(hour).toBeGreaterThanOrEqual(18);
    expect(hour).toBeLessThanOrEqual(22);
    expect(req.transaction.amount.minor_units).toBeGreaterThanOrEqual(1000000);
  });

  it.each(SCENARIO_IDS)('%s: shifting by whole days keeps every gap as in the source', (id) => {
    const a = buildScenario(id, NOW);
    const b = buildScenario(id, new Date(NOW.getTime() + 3 * 86_400_000));
    const ta = timestamps(a).map(ms);
    const tb = timestamps(b).map(ms);
    expect(tb).toHaveLength(ta.length);
    const shift = tb[0] - ta[0];
    expect(shift).toBe(3 * 86_400_000);
    tb.forEach((v, i) => expect(v - ta[i]).toBe(shift));
  });

  it.each(SCENARIO_IDS)('%s: gaps between timestamps do not depend on the time of day', (id) => {
    const gaps = (now: Date) => {
      const ts = timestamps(buildScenario(id, now)).map(ms);
      return ts.map((v) => v - ts[0]);
    };
    const base = gaps(NOW);
    for (const minutes of [37, 5 * 60 + 11, 13 * 60 + 2]) {
      expect(gaps(new Date(NOW.getTime() + minutes * 60_000))).toEqual(base);
    }
  });

  it('gives two builds of the same scenario different transaction ids', () => {
    for (const id of SCENARIO_IDS) {
      expect(buildScenario(id, NOW).transaction.transaction_id).not.toBe(buildScenario(id, NOW).transaction.transaction_id);
    }
  });
});
