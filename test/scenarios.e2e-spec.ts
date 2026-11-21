import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { riskRequestSchema } from '../src/contracts';

interface Hit {
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

describe('demo bank scenarios (e2e)', () => {
  let app: INestApplication;
  let webhook: http.Server;
  let hits: Hit[];
  let status: number;
  const SECRET = 's3cret-value';

  const startWebhook = async () => {
    webhook = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        hits.push({ headers: req.headers, body: JSON.parse(raw) });
        res.statusCode = status;
        res.end('{}');
      });
    });
    await new Promise<void>((r) => webhook.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(webhook.address() as AddressInfo).port}/hook`;
  };

  const startApp = async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  };

  beforeEach(() => {
    hits = [];
    status = 200;
  });

  afterEach(async () => {
    delete process.env.NIGHTWATCH_WEBHOOK_URL;
    delete process.env.NIGHTWATCH_WEBHOOK_SECRET;
    await app.close();
    if (webhook?.listening) await new Promise((r) => webhook.close(r));
  });

  describe('configured', () => {
    beforeEach(async () => {
      process.env.NIGHTWATCH_WEBHOOK_URL = await startWebhook();
      process.env.NIGHTWATCH_WEBHOOK_SECRET = SECRET;
      await startApp();
    });

    it('sends one schema-valid POST with the secret header and shows it as accepted', async () => {
      const res = await request(app.getHttpServer()).post('/bank/scenarios/attack');
      expect(res.status).toBe(303);
      expect(res.headers.location).toBe('/bank');
      expect(hits).toHaveLength(1);
      expect(hits[0].headers['x-webhook-secret']).toBe(SECRET);
      const parsed = riskRequestSchema.parse(hits[0].body);
      const page = await request(app.getHttpServer()).get('/bank');
      expect(page.text).toContain(parsed.transaction.transaction_id);
      expect(page.text).toContain('accepted');
      expect(page.text).not.toContain('not accepted');
      expect(page.text).not.toContain(SECRET);
      expect(page.text).not.toMatch(/<button[^>]*disabled/);
    });

    it('shows a non-2xx webhook as not accepted and keeps working', async () => {
      status = 500;
      const res = await request(app.getHttpServer()).post('/bank/scenarios/dinner');
      expect(res.status).toBe(303);
      const page = await request(app.getHttpServer()).get('/bank');
      expect(page.status).toBe(200);
      expect(page.text).toContain('not accepted');
      expect(page.text).toContain('HTTP 500');
    });

    it('shows an unreachable webhook as not accepted', async () => {
      await new Promise((r) => webhook.close(r));
      const res = await request(app.getHttpServer()).post('/bank/scenarios/rent');
      expect(res.status).toBe(303);
      const page = await request(app.getHttpServer()).get('/bank');
      expect(page.text).toContain('not accepted');
      expect(page.text).not.toContain(SECRET);
    });

    it('answers 404 for an unknown scenario and sends nothing', async () => {
      const res = await request(app.getHttpServer()).post('/bank/scenarios/nope');
      expect(res.status).toBe(404);
      expect(hits).toHaveLength(0);
    });
  });

  describe('not configured', () => {
    beforeEach(startApp);

    it('shows disabled buttons with a note and answers 503 without sending', async () => {
      const page = await request(app.getHttpServer()).get('/bank');
      expect(page.text).toContain('NIGHTWATCH_WEBHOOK_URL');
      expect(page.text.match(/<button[^>]*disabled/g)).toHaveLength(4);
      const res = await request(app.getHttpServer()).post('/bank/scenarios/dinner');
      expect(res.status).toBe(503);
      expect(hits).toHaveLength(0);
    });
  });
});
