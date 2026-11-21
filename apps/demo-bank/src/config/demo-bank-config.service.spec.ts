import { Test } from '@nestjs/testing';
import { DEMO_BANK_ENVIRONMENT, DemoBankConfigService } from './demo-bank-config.service';

describe('DemoBankConfigService', () => {
  it('gives the webhook URL and secret from the environment', async () => {
    const env: Record<string, string | undefined> = { NIGHTWATCH_WEBHOOK_URL: 'https://h.test/x', NIGHTWATCH_WEBHOOK_SECRET: 's' };
    const moduleRef = await Test.createTestingModule({
      providers: [DemoBankConfigService, { provide: DEMO_BANK_ENVIRONMENT, useValue: env }],
    }).compile();
    const config = moduleRef.get(DemoBankConfigService);
    expect(config.webhook()).toEqual({ url: 'https://h.test/x', secret: 's' });
    expect(config.isConfigured()).toBe(true);
  });

  it('is unconfigured when either is missing, and re-reads on each call', async () => {
    const env: Record<string, string | undefined> = { NIGHTWATCH_WEBHOOK_URL: 'https://h.test/x' };
    const moduleRef = await Test.createTestingModule({
      providers: [DemoBankConfigService, { provide: DEMO_BANK_ENVIRONMENT, useValue: env }],
    }).compile();
    const config = moduleRef.get(DemoBankConfigService);
    expect(config.isConfigured()).toBe(false);
    env.NIGHTWATCH_WEBHOOK_SECRET = 's';
    expect(config.isConfigured()).toBe(true);
    delete env.NIGHTWATCH_WEBHOOK_URL;
    expect(config.webhook()).toBeNull();
  });
});
