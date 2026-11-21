import { Injectable } from '@nestjs/common';
import { JEV_LABELS } from './jev.constants';
import { JevAnswer, JevLabel } from './jev.types';

@Injectable()
export class JevAnswerParserService {
  isUnit(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  }

  /** The probability, label and confidence of Jev's JSON, or a failure when any is missing or out of range. */
  parse(raw: unknown): JevAnswer {
    const answers = (raw as { answers?: any } | null)?.answers;
    const p = answers?.takeover?.noul;
    const label = answers?.pattern?.choice;
    const confidence = answers?.pattern?.confidence;
    if (!this.isUnit(p) || !JEV_LABELS.includes(label) || !this.isUnit(confidence)) {
      return { ok: false, timedOut: false };
    }
    return { ok: true, p, label: label as JevLabel, confidence };
  }
}
