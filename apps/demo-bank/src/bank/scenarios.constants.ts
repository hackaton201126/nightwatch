export const SCENARIO_IDS = ['dinner', 'rent', 'attack', 'disputed'] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export const SCENARIO_LABELS: Record<ScenarioId, string> = {
  dinner: 'Dinner AED 85',
  rent: 'Rent AED 15 000',
  attack: 'Attack AED 450 000',
  disputed: 'Disputed login',
};
