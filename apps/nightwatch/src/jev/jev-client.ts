import { AskJevOptions, JevAnswer } from './jev.types';

/** The Jev call as an injectable: specs replace it with a fake. Resolves, never rejects. */
export abstract class JevClient {
  abstract ask(options: AskJevOptions): Promise<JevAnswer>;
}
