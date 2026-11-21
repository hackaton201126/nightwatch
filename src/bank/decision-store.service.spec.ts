import { Test } from '@nestjs/testing';
import { RiskResponse } from '../contracts';
import { DecisionStoreService } from './decision-store.service';

const decision = (i: number) => ({ transaction_id: `tx_${i}` }) as RiskResponse;

describe('DecisionStoreService', () => {
  it('keeps the latest 50, newest first, after 51 decisions', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [DecisionStoreService] }).compile();
    const store = moduleRef.get(DecisionStoreService);
    for (let i = 1; i <= 51; i++) store.add(decision(i));
    const ids = store.list().map((d) => d.transaction_id);
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe('tx_51');
    expect(ids[49]).toBe('tx_2');
  });
});
