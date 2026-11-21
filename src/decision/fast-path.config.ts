/** The bank's fast-path settings, amounts in AED major units (as in config/<bank>.yaml). */
export interface FastPathConfig {
  fastAllow: {
    maxAmount: number;
    daily: { maxTotal: number; maxCount: number };
  };
  fastAllowStoppers: {
    newDeviceHours: number;
    accessResetHours: number;
    tor: boolean;
    failedLoginsHour: number;
  };
}

export const DEFAULT_FAST_PATH_CONFIG: FastPathConfig = {
  fastAllow: { maxAmount: 10000, daily: { maxTotal: 20000, maxCount: 5 } },
  fastAllowStoppers: {
    newDeviceHours: 24,
    accessResetHours: 24,
    tor: true,
    failedLoginsHour: 3,
  },
};
