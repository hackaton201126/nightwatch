import { readFileSync } from 'fs';
import { join } from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { Test } from '@nestjs/testing';
import { AppConfigService, ENVIRONMENT } from '../config/app-config.service';
import { Facts } from '../facts/facts.types';
import { FakeJevClient } from './fake-jev-client';
import { JevAnswerParserService } from './jev-answer-parser.service';
import { JevClient } from './jev-client';
import { JevDecisionService } from './jev-decision.service';
import { JevHttpClient } from './jev-http-client.service';
import { JevMappingService } from './jev-mapping.service';
import { JevRequestBuilderService } from './jev-request-builder.service';

const ex = (n: string) => JSON.parse(readFileSync(join(__dirname, '../../../../docs/examples', n), 'utf8'));
const attack = ex('jev-attack.json');
const normal = ex('jev-normal.json');
const schema = JSON.parse(readFileSync(join(__dirname, '../../../../docs/nightwatch-risk-response.schema.json'), 'utf8'));
const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const NOW = new Date('2026-11-21T02:00:20Z');

let jev: FakeJevClient;
let service: JevDecisionService;
const useEnv = async (env: Record<string, string> = {}) => {
  jev = new FakeJevClient();
  const moduleRef = await Test.createTestingModule({
    providers: [
      JevDecisionService,
      JevMappingService,
      JevRequestBuilderService,
      AppConfigService,
      { provide: ENVIRONMENT, useValue: env },
      { provide: JevClient, useValue: jev },
    ],
  }).compile();
  service = moduleRef.get(JevDecisionService);
};
beforeEach(() => useEnv());

const run = (src = attack, facts: Facts = src.state.facts) =>
  service.decide({ request: src.state.request, facts, now: NOW, decisionId: 'dec-1', apiKey: 'KEY' });
const withAnswer = (p: number, label: 'legitimate' | 'account_takeover' | 'uncertain', conf: number, src = attack) => {
  jev.says(p, label, conf);
  return run(src);
};

describe('JevDecisionService', () => {
  it('sends the example body to Jev with the key', async () => {
    await withAnswer(0.65, 'account_takeover', 0.6);
    expect(jev.calls).toHaveLength(1);
    const { body, apiKey } = jev.calls[0];
    expect(apiKey).toBe('KEY');
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
  ] as const)('probability %s gives %s', async (p, label, decision) => {
    const r = await withAnswer(p, label, 0.9);
    expect(r.escalate).toBe(false);
    if (!r.escalate) expect(r.response.decision).toBe(decision);
  });

  it('takes thresholds from the injected config service', async () => {
    await useEnv({ NIGHTWATCH_JEV_STEP_UP: '0.5', NIGHTWATCH_JEV_HOLD: '0.9' });
    const r = await withAnswer(0.6, 'uncertain', 0.9);
    expect(!r.escalate && r.response.decision).toBe('step_up');
  });

  it('escalates on low label confidence whatever the probability', async () => {
    for (const p of [0.05, 0.4, 0.9]) {
      expect(await withAnswer(p, 'uncertain', 0.49)).toMatchObject({ escalate: true, reason: 'low_confidence' });
    }
    await useEnv({ NIGHTWATCH_MIN_LABEL_CONFIDENCE: '0.8' });
    expect(await withAnswer(0.4, 'uncertain', 0.7)).toMatchObject({ escalate: true, reason: 'low_confidence' });
  });

  it.each([
    [0.6, 'legitimate'],
    [0.19, 'account_takeover'],
  ] as const)('escalates on conflict %s / %s', async (p, label) => {
    expect(await withAnswer(p, label, 0.9)).toMatchObject({
      escalate: true,
      reason: 'conflict',
      jev: { probability: p, label },
    });
  });

  it('escalates with jev_failed when Jev failed and jev_timeout when it timed out', async () => {
    jev.answer = { ok: false, timedOut: false };
    expect(await run()).toMatchObject({ escalate: true, reason: 'jev_failed', jev: { timed_out: false } });
    jev.answer = { ok: false, timedOut: true };
    expect(await run()).toMatchObject({ escalate: true, reason: 'jev_timeout', jev: { timed_out: true } });
  });

  it('never rejects when the client itself throws', async () => {
    jev.ask = () => Promise.reject(new Error('boom'));
    await expect(run()).resolves.toMatchObject({ escalate: true, reason: 'jev_failed' });
  });

  describe('decision', () => {
    it.each([
      [0.19, 'legitimate', normal],
      [0.45, 'uncertain', attack],
      [0.65, 'account_takeover', attack],
    ] as const)('validates against the response schema (%s)', async (p, label, src) => {
      const r = await withAnswer(p, label, 0.8, src);
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
      const a = await withAnswer(0.1, 'legitimate', 0.8, normal);
      if (a.escalate) throw new Error('escalated');
      expect(a.response).toMatchObject({ final: true, actions: ['execute'] });
    });

    it('the confirmation timeout comes from the config', async () => {
      await useEnv({ NIGHTWATCH_CONFIRMATION_TIMEOUT_MINUTES: '30' });
      const r = await withAnswer(0.65, 'account_takeover', 0.8);
      if (r.escalate) throw new Error('escalated');
      expect(r.response.hold?.expires_at).toBe('2026-11-21T02:30:20.000Z');
    });

    it('reasons come from the takeover facts plus model_assessment', async () => {
      const r = await withAnswer(0.65, 'account_takeover', 0.8);
      if (r.escalate) throw new Error('escalated');
      expect(r.response.reasons.map((x) => x.code)).toEqual([
        'new_device', 'anonymizer_network', 'off_hours', 'login_to_transfer_fast', 'model_assessment',
      ]);
      const n = await withAnswer(0.1, 'legitimate', 0.8, normal);
      if (n.escalate) throw new Error('escalated');
      expect(n.response.reasons.map((x) => x.code)).toEqual(['model_assessment']);
    });

    it('lists every other takeover fact', async () => {
      const facts: Facts = {
        ...attack.state.facts,
        hours_since_password_reset: 2, hours_since_mfa_change: 3, failed_logins_1h_before: 4,
        country_seen_in_successful_logins: false, thin_history: true, successful_logins_in_history: 2,
      };
      jev.says(0.7, 'account_takeover', 0.9);
      const r = await run(attack, facts);
      if (r.escalate) throw new Error('escalated');
      expect(validate(r.response)).toBe(true);
      expect(r.response.reasons.map((x) => x.code)).toEqual(expect.arrayContaining([
        'recent_password_reset', 'recent_mfa_change', 'failed_login_attempts', 'ip_country_unusual', 'thin_history',
      ]));
    });
  });
});

describe('JevHttpClient', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  const fake = (f: jest.Mock) => {
    fetchMock = f;
    global.fetch = f as unknown as typeof fetch;
  };
  const okFetch = (body: unknown, status = 200) =>
    jest.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
  const answer = (p: unknown, choice: unknown, confidence: unknown) => ({
    answers: { takeover: { noul: p }, pattern: { choice, confidence } },
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  const build = async (env: Record<string, string> = {}) => {
    const moduleRef = await Test.createTestingModule({
      providers: [JevHttpClient, JevAnswerParserService, AppConfigService, JevRequestBuilderService, { provide: ENVIRONMENT, useValue: env }],
    }).compile();
    const client = moduleRef.get(JevHttpClient);
    const builder = moduleRef.get(JevRequestBuilderService);
    const body = builder.build(attack.state.request, attack.state.facts);
    return { ask: () => client.ask({ body, apiKey: 'KEY' }), body };
  };

  it('posts the body to Jev with the key and returns the parsed answer', async () => {
    fake(okFetch(answer(0.65, 'account_takeover', 0.6)));
    const { ask, body } = await build();
    expect(await ask()).toEqual({ ok: true, p: 0.65, label: 'account_takeover', confidence: 0.6 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer KEY');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(JSON.parse(JSON.stringify(body)));
    expect(JSON.parse(init.body).questions).toEqual(attack.questions);
  });

  it('takes the timeout from the config and reports it', async () => {
    fake(jest.fn(() => new Promise(() => undefined)));
    const { ask } = await build({ NIGHTWATCH_JEV_TIMEOUT_MS: '50' });
    const t = Date.now();
    expect(await ask()).toEqual({ ok: false, timedOut: true });
    expect(Date.now() - t).toBeLessThan(500);
  });

  it.each([
    ['non-2xx', okFetch({ error: 'x' }, 500)],
    ['non-JSON', okFetch('<html>')],
    ['network error', jest.fn(async () => { throw new Error('down'); })],
    ['no answers', okFetch({})],
    ['missing probability', okFetch(answer(undefined, 'uncertain', 0.9))],
    ['probability > 1', okFetch(answer(1.5, 'uncertain', 0.9))],
    ['probability string', okFetch(answer('0.5', 'uncertain', 0.9))],
    ['unknown label', okFetch(answer(0.5, 'fraud', 0.9))],
    ['missing confidence', okFetch(answer(0.5, 'uncertain', undefined))],
    ['confidence < 0', okFetch(answer(0.5, 'uncertain', -0.1))],
  ])('resolves a failure, not a rejection, on %s', async (_n, f) => {
    fake(f);
    const { ask } = await build();
    expect(await ask()).toEqual({ ok: false, timedOut: false });
  });

  const live = process.env.TYPESAFE_API_KEY ? it : it.skip;
  live('live: asks the real Jev', async () => {
    const { body } = await build({ NIGHTWATCH_JEV_TIMEOUT_MS: '20000' });
    const moduleRef = await Test.createTestingModule({
      providers: [JevHttpClient, JevAnswerParserService, AppConfigService, { provide: ENVIRONMENT, useValue: { NIGHTWATCH_JEV_TIMEOUT_MS: '20000' } }],
    }).compile();
    const r = await moduleRef.get(JevHttpClient).ask({ body, apiKey: process.env.TYPESAFE_API_KEY as string });
    expect(typeof r.ok).toBe('boolean');
  });
});
