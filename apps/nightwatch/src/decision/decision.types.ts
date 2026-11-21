import { Facts } from '../facts/facts.types';
import { FastPathAllowResponse } from '../fast-path/fast-path.types';
import { EscalationReason, JevDecisionResponse, JevInfo } from '../jev/jev.types';

/** A case Devin must decide: the item the preflight hands to a session. */
export interface Escalation {
  transactionId: string;
  reason: EscalationReason;
  facts: Facts | null;
  jev: JevInfo;
  replyUrl: string;
}

export type DecisionResult =
  | { escalate: false; response: FastPathAllowResponse | JevDecisionResponse }
  | ({ escalate: true } & Escalation);
