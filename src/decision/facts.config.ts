/** How the login facts read the history; defaults from docs/plan.md. */
export interface FactsConfig {
  maxLoginAttempts: number;
  loginLookbackDays: number;
  minSuccessfulLogins: number;
  failedLoginsWindowMinutes: number;
}

export const DEFAULT_FACTS_CONFIG: FactsConfig = {
  maxLoginAttempts: 50,
  loginLookbackDays: 30,
  minSuccessfulLogins: 5,
  failedLoginsWindowMinutes: 60,
};
