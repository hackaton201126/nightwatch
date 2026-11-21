import { z } from 'zod';

const timestamp = z.iso.datetime({ offset: true });
const optionalTimestamp = timestamp.nullable();
const currency = z.string().regex(/^[A-Z]{3}$/);
const nonNegInt = z.number().int().min(0);
const nullableStr = z.string().nullable();
const nullableBool = z.boolean().nullable();

const money = z.object({ currency, minor_units: z.number().int().min(1) });

const network = z
  .object({
    ip_ref: z.string(),
    ip_address: z.union([z.ipv4(), z.ipv6()]).optional(),
    ip_country: nullableStr.optional(),
    ip_city: nullableStr.optional(),
    anonymizer: z.enum(['none_detected', 'vpn', 'tor', 'proxy', 'unknown']).optional(),
  })
  .nullable();

const activityWindow = z
  .object({
    attempted_count: nonNegInt,
    attempted_amount_policy_minor: nonNegInt,
    distinct_new_beneficiaries: nonNegInt.optional(),
    near_limit_attempt_count: nonNegInt.optional(),
  })
  .nullable();

// Like the JSON schema, objects here allow properties beyond the listed ones.
export const riskRequestSchema = z.object({
  schema_version: z.literal('1.0'),
  as_of: timestamp,
  transaction: z.object({
    transaction_id: z.string(),
    requested_at: timestamp,
    channel: z.enum(['mobile', 'web', 'api', 'branch', 'other']).optional(),
    initiator_id: z.string(),
    source_account_id: z.string(),
    amount: money,
    amount_policy_minor: nonNegInt,
    source_account_available_balance_policy_minor: z.number().int().nullable().optional(),
    authorization: z.enum(['authorized', 'unauthorized', 'unknown']),
    beneficiary: z.object({
      beneficiary_id: z.string(),
      country: nullableStr.optional(),
      is_new_for_customer: nullableBool.optional(),
      cross_border: nullableBool.optional(),
      fraud_link_status: z.enum(['confirmed', 'suspected', 'none_detected', 'unknown']).optional(),
    }),
  }),
  customer: z.object({
    customer_id: z.string(),
    timezone: z.string(),
    kyc_status: z.enum(['verified', 'unverified', 'unknown']).optional(),
  }),
  session: z.object({
    session_id: nullableStr.optional(),
    authenticated_at: optionalTimestamp.optional(),
    auth_factors: z.array(z.string()).optional(),
    device_id: nullableStr.optional(),
    device_first_seen_at: optionalTimestamp.optional(),
    last_password_reset_at: optionalTimestamp.optional(),
    last_mfa_change_at: optionalTimestamp.optional(),
    network: network.optional(),
  }),
  history: z.object({
    recent_login_attempts: z.array(
      z.object({
        occurred_at: timestamp,
        outcome: z.enum(['success', 'failure']),
        device_id: nullableStr.optional(),
        network: network.optional(),
      }),
    ),
    recent_outgoing_requests: z.array(
      z.object({
        transaction_id: z.string(),
        requested_at: timestamp,
        source_account_id: z.string().optional(),
        beneficiary_id: z.string().optional(),
        beneficiary_country: nullableStr.optional(),
        beneficiary_is_new: nullableBool.optional(),
        amount: money,
        status: z.enum(['pending', 'held', 'executed', 'declined', 'cancelled']),
      }),
    ),
    windows: z.object({
      '10m': activityWindow.optional(),
      '1h': activityWindow.optional(),
      '6h': activityWindow.optional(),
      '24h': activityWindow.optional(),
    }),
    baseline: z
      .object({
        lookback_days: z.number().int().min(1).optional(),
        median_outgoing_amount_policy_minor: z.number().int().nullable().optional(),
        p95_daily_outgoing_amount_policy_minor: z.number().int().nullable().optional(),
        typical_active_local_hours: z.array(z.number().int().min(0).max(23)).optional(),
      })
      .nullable()
      .optional(),
  }),
  policy: z.object({
    currency,
    fast_path_budget: z.object({
      window_seconds: z.literal(21600),
      effective_max_count: nonNegInt,
      effective_max_total_policy_minor: nonNegInt,
      effective_max_single_policy_minor: nonNegInt,
      used_count: nonNegInt,
      used_total_policy_minor: nonNegInt,
    }),
  }),
});

export type RiskRequest = z.infer<typeof riskRequestSchema>;
