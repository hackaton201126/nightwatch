import { readFileSync } from 'fs';
import { join } from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { DEFAULT_JEV_DECISION_CONFIG, decideByJev, Facts, JevDecisionConfig } from './index';

const ex = (n: string) => JSON.parse(readFileSync(join(__dirname, '../../docs/examples', n), 'utf8'));
const attack = ex('jev-attack.json');
const normal = ex('jev-normal.json');
const schema = JSON.parse(readFileSync(join(__dirname, '../../docs/nightwatch-risk-response.schema.json'), 'utf8'));
const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const NOW = new Date('2026-11-21T02:00:20Z');
const cfg = DEFAULT_JEV_DECISION_CONFIG;

const jevAnswer = (p: unknown, choice: unknown, confidence: unknown) => ({
  answers: { takeover: { noul: p }, pattern: { choice, confidence } },
});
const okFetch = (body: unknown, status = 200) =>
  jest.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));

let fetchMock: jest.Mock;
function fake(f: jest.Mock) {
  fetchMock = f;
  global.fetch = f as unknown as typeof fetch;
}
const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

const run = (c: JevDecisionConfig = cfg, src = attack) =>
  decideByJev(src.state.request, src.state.facts as Facts, c, NOW, 'dec-1', 'KEY');
const withAnswer = (p: unknown, choice: unknown, conf: unknown, c?: JevDecisionConfig, src = attack) => {
  fake(okFetch(jevAnswer(p, choice, conf)));
  return run(c, src);
};

describe('decideByJev', () => {
  it('sends the example body to Jev with the key', async () => {
    await withAnswer(0.65, 'account_takeover', 0.6);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer KEY');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.model).toBe(attack.model);
    expect(body.state.request).toEqual(attack.state.request);
    expect(body.state.facts).toEqual(attack.state.facts);
    expect(body.questions).toEqual(attack.questions);
  });

  it.each([
    [0.19, 'legitimate', 'allow'],
    [0.2, 'uncertain', 'step_up'],
    [0.59, 'uncertain', 'step_up'],
    [0.6, 'account_takeover', 'hold'],
  ])('probability %s gives %s', async (p, label, decision) => {
    const r = await withAnswer(p, label, 0.9);
    expect(r.escalate).toBe(false);
    if (!r.escalate) expect(r.response.decision).toBe(decision);
  });

  it('takes thresholds from the config', async () => {
    const c = { ...cfg, jev: { ...cfg.jev, thresholds: { stepUp: 0.5, hold: 0.9 } } };
    const r = await withAnswer(0.6, 'uncertain', 0.9, c);
    expect(!r.escalate && r.response.decision).toBe('step_up');
  });

  it('takes the timeout from the config', async () => {
    fake(jest.fn(() => new Promise(() => undefined)));
    const t = Date.now();
    const r = await run({ ...cfg, jev: { ...cfg.jev, timeoutMs: 50 } });
    expect(r).toMatchObject({ escalate: true, reason: 'jev_timeout', jev: { timed_out: true } });
    expect(Date.now() - t).toBeLessThan(500);
  });

  it('escalates on low label confidence whatever the probability', async () => {
    for (const p of [0.05, 0.4, 0.9]) {
      const r = await withAnswer(p, 'uncertain', 0.49);
      expect(r).toMatchObject({ escalate: true, reason: 'low_confidence' });
    }
    const r = await withAnswer(0.4, 'uncertain', 0.7, { ...cfg, escalate: { minLabelConfidence: 0.8 } });
    expect(r).toMatchObject({ escalate: true, reason: 'low_confidence' });
  });

  it.each([
    [0.6, 'legitimate'],
    [0.19, 'account_takeover'],
  ])('escalates on conflict %s / %s', async (p, label) => {
    const r = await withAnswer(p, label, 0.9);
    expect(r).toMatchObject({ escalate: true, reason: 'conflict', jev: { probability: p, label } });
  });

  it.each([
    ['non-2xx', okFetch({ error: 'x' }, 500)],
    ['non-JSON', okFetch('<html>')],
    ['network error', jest.fn(async () => { throw new Error('down'); })],
    ['no answers', okFetch({})],
    ['missing probability', okFetch(jevAnswer(undefined, 'uncertain', 0.9))],
    ['probability > 1', okFetch(jevAnswer(1.5, 'uncertain', 0.9))],
    ['probability string', okFetch(jevAnswer('0.5', 'uncertain', 0.9))],
    ['unknown label', okFetch(jevAnswer(0.5, 'fraud', 0.9))],
    ['missing confidence', okFetch(jevAnswer(0.5, 'uncertain', undefined))],
    ['confidence < 0', okFetch(jevAnswer(0.5, 'uncertain', -0.1))],
  ])('escalates with jev_failed on %s', async (_n, f) => {
    fake(f);
    await expect(run()).resolves.toMatchObject({ escalate: true, reason: 'jev_failed' });
  });

  describe('decision', () => {
    it.each([
      [0.19, 'legitimate', normal],
      [0.45, 'uncertain', attack],
      [0.65, 'account_takeover', attack],
    ])('validates against the response schema (%s)', async (p, label, src) => {
      const r = await withAnswer(p, label, 0.8, cfg, src);
      expect(r.escalate).toBe(false);
      if (!r.escalate) {
        expect(validate(r.response)).toBe(true);
        expect(r.response.decided_by).toBe('jev');
        expect(r.response.risk.score).toBe(Math.round(p * 100));
        expect(r.response.classification).toEqual({
          label, confidence: 0.8, takeover_probability: p, recommended_decision: r.response.decision,
        });
        expect(r.response.model).toMatchObject({ provider: 'typesafe', name: 'jev-latest' });
        expect(r.response.transaction_id).toBe('tx_5501');
      }
    });

    it('hold: not final, expires after the confirmation timeout, blocks, push', async () => {
      const r = await withAnswer(0.65, 'account_takeover', 0.8);
      if (r.escalate) throw new Error('escalated');
      expect(r.response.final).toBe(false);
      expect(r.response.hold).toEqual({
        expires_at: '2026-11-21T02:15:20.000Z', on_timeout: 'block', confirmation_channel: 'push',
      });
      expect(r.response.risk.level).toBe('high');
    });

    it('step_up: in_app challenge expiring after the timeout; allow is final', async () => {
      const s = await withAnswer(0.4, 'uncertain', 0.8);
      if (s.escalate) throw new Error('escalated');
      expect(s.response.step_up).toMatchObject({ channel: 'in_app', expires_at: '2026-11-21T02:15:20.000Z' });
      expect(s.response.final).toBe(true);
      const a = await withAnswer(0.1, 'legitimate', 0.8, cfg, normal);
      if (a.escalate) throw new Error('escalated');
      expect(a.response).toMatchObject({ final: true, actions: ['execute'] });
    });

    it('reasons come from the takeover facts plus model_assessment', async () => {
      const r = await withAnswer(0.65, 'account_takeover', 0.8);
      if (r.escalate) throw new Error('escalated');
      expect(r.response.reasons.map((x) => x.code)).toEqual([
        'new_device', 'anonymizer_network', 'off_hours', 'login_to_transfer_fast', 'model_assessment',
      ]);
      const n = await withAnswer(0.1, 'legitimate', 0.8, cfg, normal);
      if (n.escalate) throw new Error('escalated');
      expect(n.response.reasons.map((x) => x.code)).toEqual(['model_assessment']);
    });

    it('lists every other takeover fact', async () => {
      const facts: Facts = {
        ...attack.state.facts,
        hours_since_password_reset: 2, hours_since_mfa_change: 3, failed_logins_1h_before: 4,
        country_seen_in_successful_logins: false, thin_history: true, successful_logins_in_history: 2,
      };
      fake(okFetch(jevAnswer(0.7, 'account_takeover', 0.9)));
      const r = await decideByJev(attack.state.request, facts, cfg, NOW, 'd', 'K');
      if (r.escalate) throw new Error('escalated');
      expect(validate(r.response)).toBe(true);
      expect(r.response.reasons.map((x) => x.code)).toEqual(expect.arrayContaining([
        'recent_password_reset', 'recent_mfa_change', 'failed_login_attempts', 'ip_country_unusual', 'thin_history',
      ]));
    });
  });

  const live = process.env.TYPESAFE_API_KEY ? it : it.skip;
  live('live: asks the real Jev', async () => {
    global.fetch = realFetch;
    const r = await decideByJev(attack.state.request, attack.state.facts, cfg, NOW, 'live', process.env.TYPESAFE_API_KEY as string);
    expect(r.escalate === true || validate(r.response)).toBeTruthy();
  });
});
