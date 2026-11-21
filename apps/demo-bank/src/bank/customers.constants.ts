export const PATH_IDS = ['fast', 'jev', 'devin'] as const;
export type PathId = (typeof PATH_IDS)[number];

export const PATH_LABELS: Record<PathId, string> = {
  fast: 'Passes at once',
  jev: 'Jev decides',
  devin: 'Devin decides',
};

export type Anonymizer = 'none_detected' | 'vpn';

export interface PastTransfer {
  /** Minutes before the transfer being built. */
  agoMinutes: number;
  amountMinor: number;
}

export interface CustomerProfile {
  id: string;
  name: string;
  city: string;
  deviceId: string;
  deviceLabel: string;
  /** How long ago the usual device was first seen. */
  deviceAgeDays: number;
  /** Local hours of the usual successful logins. */
  hours: number[];
  hoursLabel: string;
  /** Explicit logins (days back, local hour) for a customer with a short history. */
  fixedLogins?: { daysAgo: number; hour: number }[];
  homeCountry: string;
  /** Anonymizer of the usual logins. */
  anonymizer: Anonymizer;
  /** Days back during which logins came from another country. */
  travel?: { country: string; fromDay: number; toDay: number }[];
  failures: { daysAgo: number; hour: number }[];
  outgoing: PastTransfer[];
  fast: { hour: number; amountMinor: number; beneficiaryId: string };
  jev: {
    hour: number;
    amountMinor: number;
    anonymizer: Anonymizer;
    /** Extra takeover signs: login from a country never seen, a fresh password reset and failed attempts before the login. */
    takeover?: { country: string };
  };
  devin: { hour: number; amountMinor: number; country: string };
}

export const CUSTOMERS: CustomerProfile[] = [
  {
    id: 'cus_alice',
    name: 'Alice',
    city: 'Dubai',
    deviceId: 'dev_alice_iphone',
    deviceLabel: 'iPhone 15',
    deviceAgeDays: 400,
    hours: [9, 13, 19, 21],
    hoursLabel: '09–21',
    homeCountry: 'AE',
    anonymizer: 'none_detected',
    failures: [
      { daysAgo: 6, hour: 13 },
      { daysAgo: 17, hour: 9 },
    ],
    outgoing: [
      { agoMinutes: 300, amountMinor: 45000 },
      { agoMinutes: 900, amountMinor: 120000 },
    ],
    fast: { hour: 13, amountMinor: 18000, beneficiaryId: 'ben_alice_cafe' },
    jev: { hour: 2, amountMinor: 4500000, anonymizer: 'vpn' },
    devin: { hour: 19, amountMinor: 1200000, country: 'GE' },
  },
  {
    id: 'cus_omar',
    name: 'Omar',
    city: 'Abu Dhabi',
    deviceId: 'dev_omar_pixel',
    deviceLabel: 'Pixel 8',
    deviceAgeDays: 220,
    hours: [7, 8, 12, 18, 22],
    hoursLabel: '07–22',
    homeCountry: 'AE',
    anonymizer: 'none_detected',
    travel: [
      { country: 'GB', fromDay: 8, toDay: 13 },
      { country: 'GB', fromDay: 22, toDay: 25 },
    ],
    failures: [
      { daysAgo: 4, hour: 22 },
      { daysAgo: 11, hour: 7 },
    ],
    outgoing: [
      { agoMinutes: 200, amountMinor: 250000 },
      { agoMinutes: 600, amountMinor: 90000 },
      { agoMinutes: 1100, amountMinor: 300000 },
    ],
    fast: { hour: 12, amountMinor: 60000, beneficiaryId: 'ben_omar_grocer' },
    jev: { hour: 2, amountMinor: 8000000, anonymizer: 'vpn' },
    devin: { hour: 18, amountMinor: 2500000, country: 'TR' },
  },
  {
    id: 'cus_maria',
    name: 'Maria',
    city: 'Sharjah',
    deviceId: 'dev_maria_galaxy',
    deviceLabel: 'Galaxy S24',
    deviceAgeDays: 9,
    hours: [10, 18, 20],
    hoursLabel: '10–20',
    fixedLogins: [
      { daysAgo: 3, hour: 18 },
      { daysAgo: 5, hour: 10 },
      { daysAgo: 8, hour: 20 },
    ],
    homeCountry: 'AE',
    anonymizer: 'none_detected',
    failures: [],
    outgoing: [],
    fast: { hour: 18, amountMinor: 25000, beneficiaryId: 'ben_maria_salon' },
    jev: { hour: 2, amountMinor: 3000000, anonymizer: 'vpn' },
    devin: { hour: 20, amountMinor: 1500000, country: 'IN' },
  },
  {
    id: 'cus_dmitry',
    name: 'Dmitry',
    city: 'Dubai',
    deviceId: 'dev_dmitry_macbook',
    deviceLabel: 'MacBook Pro',
    deviceAgeDays: 600,
    hours: [22, 23, 0, 1, 2],
    hoursLabel: '22–02, VPN',
    homeCountry: 'AE',
    anonymizer: 'vpn',
    failures: [
      { daysAgo: 9, hour: 23 },
      { daysAgo: 20, hour: 0 },
    ],
    outgoing: [{ agoMinutes: 400, amountMinor: 80000 }],
    fast: { hour: 23, amountMinor: 95000, beneficiaryId: 'ben_dmitry_delivery' },
    // Night and VPN are normal for him: the unusual signs are a daytime login without VPN.
    jev: { hour: 14, amountMinor: 6000000, anonymizer: 'none_detected', takeover: { country: 'RU' } },
    devin: { hour: 22, amountMinor: 1800000, country: 'KZ' },
  },
];

export const FORM_COUNTRIES = ['GB', 'TR', 'GE', 'IN', 'KZ', 'RU', 'US'] as const;

export const CUSTOM_LABEL = 'Custom transaction';
