/** The bank's Jev settings (as in config/<bank>.yaml). */
export interface JevDecisionConfig {
  jev: {
    model: string;
    timeoutMs: number;
    thresholds: { stepUp: number; hold: number };
  };
  escalate: { minLabelConfidence: number };
  confirmation: { timeoutMinutes: number };
}

export const DEFAULT_JEV_DECISION_CONFIG: JevDecisionConfig = {
  jev: { model: 'jev-latest', timeoutMs: 2000, thresholds: { stepUp: 0.2, hold: 0.6 } },
  escalate: { minLabelConfidence: 0.5 },
  confirmation: { timeoutMinutes: 15 },
};
