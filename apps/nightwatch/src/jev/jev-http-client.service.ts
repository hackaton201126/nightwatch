import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { JevAnswerParserService } from './jev-answer-parser.service';
import { JevClient } from './jev-client';
import { JEV_URL } from './jev.constants';
import { AskJevOptions, JevAnswer } from './jev.types';

@Injectable()
export class JevHttpClient extends JevClient {
  constructor(
    private readonly config: AppConfigService,
    private readonly parser: JevAnswerParserService,
  ) {
    super();
  }

  async ask(options: AskJevOptions): Promise<JevAnswer> {
    const { body, apiKey } = options;
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve('timeout');
      }, this.config.jev().jev.timeoutMs);
    });
    const call = (async () => {
      const res = await fetch(JEV_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      return (await res.json()) as unknown;
    })().catch(() => null);
    try {
      const out = await Promise.race([call, timeout]);
      if (out === 'timeout') return { ok: false, timedOut: true };
      return this.parser.parse(out);
    } catch {
      return { ok: false, timedOut: false };
    } finally {
      clearTimeout(timer);
    }
  }
}
