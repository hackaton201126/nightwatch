/** The bank's fast-path settings, amounts in AED major units. */
export interface FastPathConfig {
  fastAllow: { maxAmount: number; daily: { maxTotal: number; maxCount: number } };
  fastAllowStoppers: { newDeviceHours: number; accessResetHours: number; tor: boolean; failedLoginsHour: number };
}

/** How the login facts and the login history read the attempts; defaults from docs/plan.md. */
export interface FactsConfig {
  maxLoginAttempts: number;
  loginLookbackDays: number;
  minSuccessfulLogins: number;
  failedLoginsWindowMinutes: number;
}

/** The bank's Jev settings. */
export interface JevConfig {
  jev: { model: string; timeoutMs: number; thresholds: { stepUp: number; hold: number } };
  escalate: { minLabelConfidence: number };
  confirmation: { timeoutMinutes: number };
}
