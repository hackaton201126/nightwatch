import request from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';

const decision = (over: Record<string, unknown> = {}) => ({
  schema_version: '1.0',
  decision_id: 'dec_1',
  transaction_id: 'tx_e2e_1',
  decided_at: '2026-11-21T02:00:20+04:00',
  decision: 'hold',
  final: false,
  decided_by: 'jev',
  risk: { score: 97, level: 'critical' },
  classification: { takeover_probability: 0.97, label: 'account_takeover', confidence: 0.9, recommended_decision: 'hold' },
  reasons: [{ code: 'new_device' }],
  actions: ['hold_transaction'],
  hold: { expires_at: '2026-11-21T03:00:20Z', on_timeout: 'block', confirmation_channel: 'push' },
  explanation: { customer: 'We paused this transfer.', analyst: 'New device after a password reset.' },
  case_id: null,
  latency_ms: 120,
  model: { provider: 'typesafe', name: 'jev-latest' },
  ...over,
});

describe('demo bank decisions (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('shows an accepted decision in the JSON list and on the page', async () => {
    const body = decision();
    const post = await request(app.getHttpServer()).post('/bank/decisions').send(body);
    expect(post.status).toBe(202);

    const list = await request(app.getHttpServer()).get('/bank/decisions');
    expect(list.status).toBe(200);
    expect(list.body).toEqual([body]);

    const page = await request(app.getHttpServer()).get('/bank');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.text).not.toMatch(/\p{Script=Cyrillic}/u);
    for (const text of ['tx_e2e_1', 'class="badge hold">Hold', 'class="chip">Jev', '0.97', 'New device after a password reset.', '2026-11-21T02:00:20+04:00']) {
      expect(page.text).toContain(text);
    }
  });

  it('empty page is English with the three path buttons on each card', async () => {
    const page = await request(app.getHttpServer()).get('/bank');
    expect(page.text).not.toMatch(/\p{Script=Cyrillic}/u);
    for (const t of ['Passes at once', 'Jev decides', 'Devin decides']) expect(page.text).toContain(t);
  });

  it.each([
    ['allow', 'fast_path', 'allow', 'Allow', 'Fast path'],
    ['step_up', 'jev', 'step_up', 'Step-up', 'Jev'],
    ['hold', 'devin', 'hold', 'Hold', 'Devin'],
    ['block', 'fallback', '', 'Block', 'Fallback'],
  ])('shows %s by %s as a labelled row keeping its badge class', async (raw, by, cls, label, byLabel) => {
    const post = await request(app.getHttpServer())
      .post('/bank/decisions')
      .send(decision({
          transaction_id: 'tx_lbl',
          decision: raw,
          decided_by: by,
          ...(raw === 'step_up'
            ? { hold: undefined, step_up: { channel: 'push', challenge_id: 'ch_1', expires_at: '2026-11-21T03:00:20Z' } }
            : {}),
        }));
    expect(post.status).toBe(202);
    const page = await request(app.getHttpServer()).get('/bank');
    const row = page.text.split('<tbody>')[2];
    expect(row).toContain(`class="badge ${cls}">${label}</span>`);
    expect(row).toContain(`class="chip">${byLabel}</span>`);
    const list = await request(app.getHttpServer()).get('/bank/decisions');
    expect(list.body[0]).toMatchObject({ decision: raw, decided_by: by });
  });

  it('rejects an invalid decision with 400 and keeps it off the list and the page', async () => {
    const post = await request(app.getHttpServer())
      .post('/bank/decisions')
      .send(decision({ transaction_id: 'tx_bad', decision: 'maybe' }));
    expect(post.status).toBe(400);
    expect(post.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'decision' })]));

    const list = await request(app.getHttpServer()).get('/bank/decisions');
    expect(list.body).toEqual([]);
    const page = await request(app.getHttpServer()).get('/bank');
    expect(page.text).not.toContain('tx_bad');
  });

  it('lists newest received first', async () => {
    for (const id of ['tx_a', 'tx_b']) {
      await request(app.getHttpServer()).post('/bank/decisions').send(decision({ transaction_id: id }));
    }
    const list = await request(app.getHttpServer()).get('/bank/decisions');
    expect(list.body.map((d: { transaction_id: string }) => d.transaction_id)).toEqual(['tx_b', 'tx_a']);
  });

  it('shows decision text escaped, never as markup', async () => {
    await request(app.getHttpServer())
      .post('/bank/decisions')
      .send(decision({ explanation: { customer: 'x', analyst: '<script>alert(1)</script>' } }))
      .expect(202);
    const page = await request(app.getHttpServer()).get('/bank');
    expect(page.text).not.toContain('<script>alert');
    expect(page.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('tells the browser to refresh every 2 seconds', async () => {
    const page = await request(app.getHttpServer()).get('/bank');
    expect(page.text).toMatch(/<meta http-equiv="refresh" content="2">/);
  });
});
