import { readFileSync } from 'fs';
import { join } from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { Test } from '@nestjs/testing';
import { AppConfigService, ENVIRONMENT } from '../config/app-config.service';
import { FactsService } from '../facts/facts.service';
import { FastPathService } from '../fast-path/fast-path.service';
import { LoginHistoryService } from '../login-history/login-history.service';
import { FakeJevClient } from '../jev/fake-jev-client';
import { JevClient } from '../jev/jev-client';
import { JevDecisionService } from '../jev/jev-decision.service';
import { JevMappingService } from '../jev/jev-mapping.service';
import { JevRequestBuilderService } from '../jev/jev-request-builder.service';
import { DecisionService } from './decision.service';

const docs = (f: string) => JSON.parse(readFileSync(join(__dirname, '../../../../docs', f), 'utf8'));
const attack = docs('examples/jev-attack.json');
const normal = docs('examples/jev-normal.json');
const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validate = ajv.compile(docs('nightwatch-risk-response.schema.json'));

const NOW = new Date('2026-11-21T02:00:20+04:00');

let jev: FakeJevClient;
let service: DecisionService;
beforeEach(async () => {
  jev = new FakeJevClient();
  const moduleRef = await Test.createTestingModule({
    providers: [
      DecisionService,
      FastPathService,
      FactsService,
      LoginHistoryService,
      JevDecisionService,
      JevMappingService,
      JevRequestBuilderService,
      AppConfigService,
      { provide: ENVIRONMENT, useValue: { NIGHTWATCH_REPLY_URL: 'https://bank.test/decisions', TYPESAFE_API_KEY: 'KEY' } },
      { provide: JevClient, useValue: jev },
    ],
  }).compile();
  service = moduleRef.get(DecisionService);
});

const decide = (src: { state: { request: unknown } }) => service.decide(src.state.request, NOW);

describe('DecisionService', () => {
  it('lets a small clean transfer through as a fast_path allow without calling Jev', async () => {
    const request = JSON.parse(JSON.stringify(normal.state.request));
    request.transaction.amount_policy_minor = 8500;
    request.history.windows = { '24h': { attempted_count: 0, attempted_amount_policy_minor: 0 } };
    request.session.device_first_seen_at = '2025-01-01T00:00:00Z';
    request.session.last_password_reset_at = null;
    request.session.last_mfa_change_at = null;
    request.session.network = { ...request.session.network, anonymizer: 'none_detected' };
    const result = await service.decide(request, NOW);
    expect(result.escalate).toBe(false);
    if (result.escalate) return;
    expect(result.response).toMatchObject({ decision: 'allow', decided_by: 'fast_path', final: true });
    expect(validate(result.response)).toBe(true);
    expect(jev.calls).toHaveLength(0);
  });

  it('holds the attack example when Jev reads a takeover, valid against the response schema', async () => {
    jev.says(0.95, 'account_takeover', 0.9);
    const result = await decide(attack);
    expect(result.escalate).toBe(false);
    if (result.escalate) return;
    expect(result.response).toMatchObject({ decision: 'hold', decided_by: 'jev', final: false });
    expect(validate(result.response)).toBe(true);
    expect(jev.calls[0].apiKey).toBe('KEY');
    expect(jev.calls[0].body.state.facts).toEqual(attack.state.facts);
  });

  it('allows the normal example when Jev reads a legitimate login', async () => {
    jev.says(0.05, 'legitimate', 0.9);
    const result = await decide(normal);
    expect(result.escalate).toBe(false);
    if (result.escalate) return;
    expect(result.response).toMatchObject({ decision: 'allow', decided_by: 'jev' });
    expect(validate(result.response)).toBe(true);
  });

  it('escalates with reason, facts, Jev info and reply URL when Jev has low confidence', async () => {
    jev.says(0.4, 'uncertain', 0.3);
    const result = await decide(attack);
    expect(result).toMatchObject({
      escalate: true,
      reason: 'low_confidence',
      transactionId: 'tx_5501',
      facts: attack.state.facts,
      jev: { probability: 0.4, label: 'uncertain', confidence: 0.3, timed_out: false },
      replyUrl: 'https://bank.test/decisions',
    });
  });

  it('escalates with jev_failed when Jev is down and jev_timeout when it times out, never rejects', async () => {
    jev.answer = { ok: false, timedOut: false };
    await expect(decide(attack)).resolves.toMatchObject({ escalate: true, reason: 'jev_failed' });
    jev.answer = { ok: false, timedOut: true };
    await expect(decide(attack)).resolves.toMatchObject({
      escalate: true,
      reason: 'jev_timeout',
      jev: { timed_out: true },
    });
    jev.ask = () => Promise.reject(new Error('down'));
    await expect(decide(attack)).resolves.toMatchObject({ escalate: true, reason: 'jev_failed' });
  });

  it('escalates instead of rejecting on a request that is not an object', async () => {
    await expect(service.decide(null, NOW)).resolves.toMatchObject({ escalate: true, transactionId: '' });
  });
});
