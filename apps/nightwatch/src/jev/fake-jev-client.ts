import { JevClient } from './jev-client';
import { AskJevOptions, JevAnswer } from './jev.types';

/** An in-memory Jev for specs: answers what it is told and keeps the calls it got. */
export class FakeJevClient extends JevClient {
  calls: AskJevOptions[] = [];
  answer: JevAnswer = { ok: false, timedOut: false };

  ask(options: AskJevOptions): Promise<JevAnswer> {
    this.calls.push(options);
    return Promise.resolve(this.answer);
  }

  says(p: number, label: 'legitimate' | 'account_takeover' | 'uncertain', confidence: number): this {
    this.answer = { ok: true, p, label, confidence };
    return this;
  }
}
