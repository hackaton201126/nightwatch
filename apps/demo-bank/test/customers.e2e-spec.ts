import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { riskRequestSchema } from '@app/contracts';

interface Hit {
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

const decision = (transactionId: string) => ({
  schema_version: '1.0',
  decision_id: 'dec_c1',
  transaction_id: transactionId,
  decided_at: '2026-11-21T02:00:20+04:00',
  decision: 'step_up',
  final: false,
  decided_by: 'devin',
  risk: { score: 55, level: 'medium' },
  classification: { takeover_probability: 0.5, label: 'uncertain', confidence: 0.6, recommended_decision: 'step_up' },
  reasons: [{ code: 'ip_country_unusual' }],
  actions: ['request_step_up'],
  step_up: { channel: 'push', challenge_id: 'ch_1', expires_at: '2026-11-21T03:00:20Z' },
  explanation: { customer: 'Please confirm.', analyst: '<script>alert(1)</script> new country' },
  case_id: null,
  latency_ms: 900,
  model: { provider: 'devin', name: 'devin' },
});

describe('demo bank customers (e2e)', () => {
  let app: INestApplication;
  let webhook: http.Server;
  let hits: Hit[];
  const SECRET = 's3cret-value';

  const startApp = async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  };

  beforeEach(() => {
    hits = [];
  });

  afterEach(async () => {
    delete process.env.NIGHTWATCH_WEBHOOK_URL;
    delete process.env.NIGHTWATCH_WEBHOOK_SECRET;
    await app.close();
    if (webhook?.listening) await new Promise((r) => webhook.close(r));
  });

  describe('configured', () => {
    beforeEach(async () => {
      webhook = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          hits.push({ headers: req.headers, body: JSON.parse(raw) });
          res.end('{}');
        });
      });
      await new Promise<void>((r) => webhook.listen(0, '127.0.0.1', r));
      process.env.NIGHTWATCH_WEBHOOK_URL = `http://127.0.0.1:${(webhook.address() as AddressInfo).port}/hook`;
      process.env.NIGHTWATCH_WEBHOOK_SECRET = SECRET;
      await startApp();
    });

    it('a customer button sends one schema-valid POST with the secret and shows it as accepted', async () => {
      const res = await request(app.getHttpServer()).post('/bank/customers/cus_omar/transactions/devin');
      expect(res.status).toBe(303);
      expect(res.headers.location).toBe('/bank');
      expect(hits).toHaveLength(1);
      expect(hits[0].headers['x-webhook-secret']).toBe(SECRET);
      const parsed = riskRequestSchema.parse(hits[0].body);
      expect(parsed.customer.customer_id).toBe('cus_omar');
      const page = await request(app.getHttpServer()).get('/bank');
      expect(page.text).toContain(parsed.transaction.transaction_id);
      expect(page.text).toContain('accepted');
      expect(page.text).not.toContain('not accepted');
      expect(page.text).not.toContain(SECRET);
      expect(page.text.match(/<button/g)).toHaveLength(12);
      expect(page.text).not.toMatch(/<button[^>]*disabled/);
    });

    it('a decision for a sent transaction shows the customer name, decision and decided_by, escaped', async () => {
      await request(app.getHttpServer()).post('/bank/customers/cus_maria/transactions/jev');
      const id = (hits[0].body as { transaction: { transaction_id: string } }).transaction.transaction_id;
      const post = await request(app.getHttpServer()).post('/bank/decisions').send(decision(id));
      expect(post.status).toBe(202);
      const page = await request(app.getHttpServer()).get('/bank');
      const row = page.text.split('<tbody>')[2];
      expect(row).toContain('Maria');
      expect(row).toContain('class="badge step_up">step_up');
      expect(row).toContain('class="chip">devin');
      expect(row).toContain('&lt;script&gt;');
      expect(page.text).not.toContain('<script>');
    });

    it('answers 404 for an unknown customer or path and sends nothing', async () => {
      expect((await request(app.getHttpServer()).post('/bank/customers/nobody/transactions/fast')).status).toBe(404);
      expect((await request(app.getHttpServer()).post('/bank/customers/cus_alice/transactions/nope')).status).toBe(404);
      expect(hits).toHaveLength(0);
    });
  });

  describe('not configured', () => {
    beforeEach(startApp);

    it('shows 12 disabled buttons with a note and answers 503 without sending', async () => {
      const page = await request(app.getHttpServer()).get('/bank');
      expect(page.text).toContain('NIGHTWATCH_WEBHOOK_URL');
      expect(page.text.match(/<button[^>]*disabled/g)).toHaveLength(12);
      const res = await request(app.getHttpServer()).post('/bank/customers/cus_alice/transactions/fast');
      expect(res.status).toBe(503);
      expect(hits).toHaveLength(0);
    });
  });
});
