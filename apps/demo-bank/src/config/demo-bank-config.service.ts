import { Inject, Injectable, Optional } from '@nestjs/common';

/** The environment the settings are read from; replaced in specs. */
export const DEMO_BANK_ENVIRONMENT = 'DEMO_BANK_ENVIRONMENT';

export interface WebhookSettings {
  url: string;
  secret: string;
}

@Injectable()
export class DemoBankConfigService {
  constructor(@Optional() @Inject(DEMO_BANK_ENVIRONMENT) private readonly injected?: Record<string, string | undefined>) {}

  /** The webhook URL and secret, or null when either is missing; read per call so the environment can change without a restart. */
  webhook(): WebhookSettings | null {
    const env = this.injected ?? process.env;
    const url = env.NIGHTWATCH_WEBHOOK_URL;
    const secret = env.NIGHTWATCH_WEBHOOK_SECRET;
    return url && secret ? { url, secret } : null;
  }

  isConfigured(): boolean {
    return this.webhook() !== null;
  }
}
