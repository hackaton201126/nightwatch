import request from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';

describe('production app has no demo bank (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 404 on every /bank route', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get('/bank')).status).toBe(404);
    expect((await request(server).get('/bank/decisions')).status).toBe(404);
    expect((await request(server).post('/bank/decisions').send({})).status).toBe(404);
    expect((await request(server).post('/bank/scenarios/any')).status).toBe(404);
  });

  it('still answers GET /health', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
