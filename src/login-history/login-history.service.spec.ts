import { Test } from '@nestjs/testing';
import { AppConfigService, ENVIRONMENT } from '../config/app-config.service';
import { LoginHistoryService } from './login-history.service';

const REQUESTED = Date.parse('2026-11-21T02:00:20+04:00');
const H = 3_600_000;
const D = 24 * H;
const iso = (offset: number) => new Date(REQUESTED + offset).toISOString();
const attempt = (offset: number, outcome = 'success') => ({ occurred_at: iso(offset), outcome });

const build = async (env: Record<string, string> = {}) => {
  const moduleRef = await Test.createTestingModule({
    providers: [LoginHistoryService, AppConfigService, { provide: ENVIRONMENT, useValue: env }],
  }).compile();
  return moduleRef.get(LoginHistoryService);
};

describe('LoginHistoryService', () => {
  it('keeps the newest 50 attempts within 30 days whatever the input order', async () => {
    const service = await build();
    const fresh = Array.from({ length: 50 }, (_, i) => attempt(-D - i * H));
    const older = [attempt(-20 * D), attempt(-31 * D), attempt(-40 * D)];
    const forward = service.recentAttempts({ history: { recent_login_attempts: [...older, ...fresh] } }, REQUESTED);
    const backward = service.recentAttempts({ history: { recent_login_attempts: [...fresh, ...older].reverse() } }, REQUESTED);
    expect(forward).toHaveLength(50);
    expect(backward).toEqual(forward);
    expect(forward?.[0].at).toBe(REQUESTED - D);
    expect(forward?.every((a) => a.at >= REQUESTED - 30 * D)).toBe(true);
  });

  it('drops attempts older than 30 days even when fewer than 50 remain', async () => {
    const service = await build();
    const got = service.recentAttempts(
      { history: { recent_login_attempts: [attempt(-D), attempt(-31 * D)] } },
      REQUESTED,
    );
    expect(got).toHaveLength(1);
  });

  it('reads the limits from the config', async () => {
    const service = await build({ NIGHTWATCH_MAX_LOGIN_ATTEMPTS: '2', NIGHTWATCH_LOGIN_LOOKBACK_DAYS: '1' });
    const list = [attempt(-H), attempt(-2 * H), attempt(-3 * H), attempt(-2 * D)];
    expect(service.recentAttempts({ history: { recent_login_attempts: list } }, REQUESTED)).toHaveLength(2);
  });

  it('is null for a missing history or transfer time and skips bad entries', async () => {
    const service = await build();
    expect(service.recentAttempts({}, REQUESTED)).toBeNull();
    expect(service.recentAttempts({ history: { recent_login_attempts: [] } }, null)).toBeNull();
    const bad = [null, { occurred_at: 'bad' }, attempt(-H)] as never;
    expect(service.recentAttempts({ history: { recent_login_attempts: bad } }, REQUESTED)).toHaveLength(1);
  });

  it('excludes the current login from successful logins', async () => {
    const service = await build();
    const attempts = service.recentAttempts(
      { history: { recent_login_attempts: [attempt(-20_000), attempt(-D), attempt(-2 * D), attempt(-D, 'failure')] } },
      REQUESTED,
    ) as NonNullable<ReturnType<typeof service.recentAttempts>>;
    expect(service.otherSuccesses(attempts, REQUESTED - 20_000)).toHaveLength(2);
  });

  it('counts failures only in the window before the login', async () => {
    const service = await build();
    const authAt = REQUESTED - 20_000;
    const attempts = service.recentAttempts(
      {
        history: {
          recent_login_attempts: [
            attempt(-20_000 - 1000, 'failure'),
            attempt(-20_000 - H, 'failure'),
            attempt(-20_000 - H - 1, 'failure'),
            attempt(-20_000 + 1000, 'failure'),
          ],
        },
      },
      REQUESTED,
    ) as NonNullable<ReturnType<typeof service.recentAttempts>>;
    expect(service.failedBefore(attempts, authAt)).toBe(2);
  });
});
