import { Test } from '@nestjs/testing';
import { AppConfigService, ENVIRONMENT } from './app-config.service';

const build = async (env: Record<string, string | undefined>) => {
  const moduleRef = await Test.createTestingModule({
    providers: [AppConfigService, { provide: ENVIRONMENT, useValue: env }],
  }).compile();
  return moduleRef.get(AppConfigService);
};

describe('AppConfigService', () => {
  it('gives today\'s defaults with no environment', async () => {
    const config = await build({});
    expect(config.fastPath()).toEqual({
      fastAllow: { maxAmount: 10000, daily: { maxTotal: 20000, maxCount: 5 } },
      fastAllowStoppers: { newDeviceHours: 24, accessResetHours: 24, tor: true, failedLoginsHour: 3 },
    });
    expect(config.facts()).toEqual({
      maxLoginAttempts: 50,
      loginLookbackDays: 30,
      minSuccessfulLogins: 5,
      failedLoginsWindowMinutes: 60,
    });
    expect(config.jev()).toEqual({
      jev: { model: 'jev-latest', timeoutMs: 2000, thresholds: { stepUp: 0.2, hold: 0.6 } },
      escalate: { minLabelConfidence: 0.5 },
      confirmation: { timeoutMinutes: 15 },
    });
    expect(config.replyUrl()).toBe('https://bank.example/nightwatch/decisions');
    expect(config.jevApiKey()).toBe('');
  });

  it('takes the environment value when its variable is set', async () => {
    const config = await build({
      NIGHTWATCH_REPLY_URL: 'https://bank.test/decisions',
      NIGHTWATCH_FAST_MAX_AMOUNT: '500',
      NIGHTWATCH_STOPPER_TOR: 'false',
      NIGHTWATCH_JEV_MODEL: 'jev-x',
      NIGHTWATCH_JEV_TIMEOUT_MS: '50',
      NIGHTWATCH_JEV_HOLD: '0.9',
      TYPESAFE_API_KEY: 'KEY',
    });
    expect(config.replyUrl()).toBe('https://bank.test/decisions');
    expect(config.fastPath().fastAllow.maxAmount).toBe(500);
    expect(config.fastPath().fastAllowStoppers.tor).toBe(false);
    expect(config.jev().jev).toMatchObject({ model: 'jev-x', timeoutMs: 50, thresholds: { stepUp: 0.2, hold: 0.9 } });
    expect(config.jevApiKey()).toBe('KEY');
  });

  it('falls back to the default for a value that is not a number', async () => {
    const config = await build({ NIGHTWATCH_FAST_MAX_AMOUNT: 'lots' });
    expect(config.fastPath().fastAllow.maxAmount).toBe(10000);
  });
});
