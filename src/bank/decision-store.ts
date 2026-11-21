import { Injectable } from '@nestjs/common';
import { RiskResponse } from '../contracts';

export const MAX_DECISIONS = 50;

@Injectable()
export class DecisionStore {
  private readonly items: RiskResponse[] = [];

  add(decision: RiskResponse): void {
    this.items.unshift(decision);
    if (this.items.length > MAX_DECISIONS) this.items.length = MAX_DECISIONS;
  }

  /** Newest received first. */
  list(): RiskResponse[] {
    return [...this.items];
  }
}
