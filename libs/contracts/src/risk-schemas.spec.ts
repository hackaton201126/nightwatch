import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { readFileSync } from 'fs';
import { join } from 'path';
import { riskRequestSchema, riskResponseSchema } from './index';

const docs = (f: string) => JSON.parse(readFileSync(join(__dirname, '../../../docs', f), 'utf8'));

const responseAjv = new Ajv({ strict: false });
addFormats(responseAjv);
const jsonResponse = responseAjv.compile(docs('nightwatch-risk-response.schema.json'));

const requestAjv = new Ajv2020({ strict: false });
addFormats(requestAjv);
const jsonRequest = requestAjv.compile(docs('nightwatch-risk-request.schema.json'));

const fastPath = () => ({
  schema_version: '1.0',
  decision_id: 'dec_1',
  transaction_id: 'tx_1',
  decided_at: '2026-11-21T02:00:20+04:00',
  decision: 'allow',
  final: true,
  decided_by: 'fast_path',
  risk: { score: 0, level: 'low' },
  classification: null,
  reasons: [{ code: 'small_amount', detail: 'AED 85.00' }],
  actions: ['execute'],
  explanation: { customer: 'ok', analyst: 'small' },
  case_id: null,
  latency_ms: 3,
  model: null,
});

const jevHold = () => ({
  ...fastPath(),
  decision: 'hold',
  final: false,
  decided_by: 'jev',
  risk: { score: 97, level: 'critical' },
  classification: { takeover_probability: 0.97, label: 'account_takeover', confidence: 0.9, recommended_decision: 'hold' },
  hold: { expires_at: '2026-11-21T03:00:20Z', on_timeout: 'block', confirmation_channel: 'push' },
  actions: ['hold_transaction', 'open_case'],
  model: { provider: 'typesafe', name: 'jev-latest', latency_ms: 120, timed_out: false },
});

const stepUp = () => ({
  ...fastPath(),
  decision: 'step_up',
  actions: ['request_step_up'],
  step_up: { channel: 'push', challenge_id: 'ch_1', expires_at: '2026-11-21T03:00:20.5Z' },
});

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const without = (o: Obj, k: string) => {
  const c = { ...o };
  delete c[k];
  return c;
};

const validResponses: Record<string, Obj> = {
  fast_path: fastPath(),
  jev_hold: jevHold(),
  step_up: stepUp(),
  no_classification_key: without(fastPath(), 'classification'),
  fallback_hold: { ...jevHold(), decided_by: 'fallback' },
  block: { ...fastPath(), decision: 'block', actions: [] },
};

const invalidResponses: Record<string, Obj> = {
  missing_decision_id: without(fastPath(), 'decision_id'),
  missing_latency: without(fastPath(), 'latency_ms'),
  extra_property: { ...fastPath(), extra: 1 },
  extra_in_risk: { ...fastPath(), risk: { score: 0, level: 'low', x: 1 } },
  bad_decision_enum: { ...fastPath(), decision: 'maybe' },
  bad_decided_by: { ...fastPath(), decided_by: 'human' },
  bad_reason_code: { ...fastPath(), reasons: [{ code: 'invented' }] },
  score_too_high: { ...fastPath(), risk: { score: 101, level: 'low' } },
  score_negative: { ...fastPath(), risk: { score: -1, level: 'low' } },
  score_fraction: { ...fastPath(), risk: { score: 1.5, level: 'low' } },
  probability_over_one: { ...jevHold(), classification: { ...jevHold().classification, takeover_probability: 1.2 } },
  bad_timestamp: { ...fastPath(), decided_at: 'yesterday' },
  date_only_timestamp: { ...fastPath(), decided_at: '2026-11-21' },
  duplicate_actions: { ...fastPath(), actions: ['execute', 'execute'] },
  too_many_reasons: { ...fastPath(), reasons: Array.from({ length: 11 }, () => ({ code: 'off_hours' })) },
  analyst_too_long: { ...fastPath(), explanation: { customer: 'a', analyst: 'x'.repeat(801) } },
  hold_without_hold: without(jevHold(), 'hold'),
  hold_final_true: { ...jevHold(), final: true },
  step_up_without_step_up: without(stepUp(), 'step_up'),
  jev_without_classification: without(jevHold(), 'classification'),
  devin_without_model: { ...without(jevHold(), 'model'), decided_by: 'devin' },
  wrong_schema_version: { ...fastPath(), schema_version: '2.0' },
  not_an_object: 'text' as unknown as Obj,
};

describe('risk response: Zod agrees with the JSON schema', () => {
  it.each(Object.entries(validResponses))('accepts %s in both', (_n, body) => {
    expect(jsonResponse(body)).toBe(true);
    expect(riskResponseSchema.safeParse(body).success).toBe(true);
  });

  it.each(Object.entries(invalidResponses))('rejects %s in both', (_n, body) => {
    expect(jsonResponse(body)).toBe(false);
    expect(riskResponseSchema.safeParse(body).success).toBe(false);
  });
});

const example = (f: string) => docs(`examples/${f}`).state.request as Obj;
const clone = (o: Obj): Obj => JSON.parse(JSON.stringify(o));
const mutate = (fn: (r: Obj) => void): Obj => {
  const r = clone(example('jev-normal.json'));
  fn(r);
  return r;
};

const validRequests: Record<string, Obj> = {
  attack_example: example('jev-attack.json'),
  normal_example: example('jev-normal.json'),
  extra_property_allowed: mutate((r) => (r.extra = 1)),
};

const invalidRequests: Record<string, Obj> = {
  missing_policy: mutate((r) => delete r.policy),
  missing_transaction_id: mutate((r) => delete r.transaction.transaction_id),
  bad_authorization: mutate((r) => (r.transaction.authorization = 'maybe')),
  zero_amount: mutate((r) => (r.transaction.amount.minor_units = 0)),
  bad_currency: mutate((r) => (r.transaction.amount.currency = 'aed')),
  bad_timestamp: mutate((r) => (r.as_of = 'noon')),
  bad_window_seconds: mutate((r) => (r.policy.fast_path_budget.window_seconds = 60)),
  negative_used_count: mutate((r) => (r.policy.fast_path_budget.used_count = -1)),
  bad_outcome: mutate((r) => (r.history.recent_login_attempts = [{ occurred_at: '2026-11-21T01:00:00Z', outcome: 'maybe' }])),
  bad_ip: mutate((r) => (r.session.network = { ip_ref: 'a', ip_address: 'not-an-ip' })),
  network_without_ip_ref: mutate((r) => (r.session.network = { ip_country: 'AE' })),
  bad_baseline_hour: mutate((r) => (r.history.baseline = { typical_active_local_hours: [24] })),
};

describe('risk request: Zod agrees with the JSON schema', () => {
  it.each(Object.entries(validRequests))('accepts %s in both', (_n, body) => {
    expect(jsonRequest(body)).toBe(true);
    expect(riskRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each(Object.entries(invalidRequests))('rejects %s in both', (_n, body) => {
    expect(jsonRequest(body)).toBe(false);
    expect(riskRequestSchema.safeParse(body).success).toBe(false);
  });
});
