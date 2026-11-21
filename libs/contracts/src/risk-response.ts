import { z } from 'zod';

const timestamp = z.iso.datetime({ offset: true });
const decisionEnum = z.enum(['allow', 'step_up', 'hold', 'block']);
const nonNegInt = z.number().int().min(0);
const unit = z.number().min(0).max(1);

export const reasonCode = z.enum([
  'small_amount',
  'new_device',
  'recent_password_reset',
  'recent_mfa_change',
  'failed_login_attempts',
  'anonymizer_network',
  'ip_country_unusual',
  'off_hours',
  'login_to_transfer_fast',
  'thin_history',
  'model_assessment',
]);

const actionEnum = z.enum([
  'execute',
  'request_step_up',
  'hold_transaction',
  'notify_owner_out_of_band',
  'terminate_session',
  'revoke_device',
  'freeze_outgoing',
  'open_case',
]);

export const riskResponseSchema = z
  .strictObject({
    schema_version: z.literal('1.0'),
    decision_id: z.string(),
    transaction_id: z.string(),
    decided_at: timestamp,
    decision: decisionEnum,
    final: z.boolean(),
    decided_by: z.enum(['fast_path', 'jev', 'devin', 'fallback']),
    risk: z.strictObject({
      score: z.number().int().min(0).max(100),
      level: z.enum(['low', 'medium', 'high', 'critical']),
    }),
    classification: z
      .strictObject({
        takeover_probability: unit.optional(),
        label: z.enum(['legitimate', 'account_takeover', 'uncertain']),
        confidence: unit,
        recommended_decision: decisionEnum,
      })
      .nullable()
      .optional(),
    reasons: z
      .array(z.strictObject({ code: reasonCode, detail: z.string().max(200).optional() }))
      .max(10),
    actions: z.array(actionEnum).refine((a) => new Set(a).size === a.length, 'actions must be unique'),
    step_up: z
      .strictObject({
        channel: z.enum(['in_app', 'push', 'sms', 'call']),
        challenge_id: z.string(),
        expires_at: timestamp,
      })
      .nullable()
      .optional(),
    hold: z
      .strictObject({
        expires_at: timestamp,
        on_timeout: z.enum(['block', 'release']),
        confirmation_channel: z.enum(['push', 'sms', 'call', 'trusted_contact', 'none']),
      })
      .nullable()
      .optional(),
    explanation: z.strictObject({
      customer: z.string().max(300),
      analyst: z.string().max(800),
    }),
    case_id: z.string().nullable().optional(),
    latency_ms: nonNegInt,
    model: z
      .strictObject({
        provider: z.enum(['typesafe', 'devin']),
        name: z.string().nullable().optional(),
        latency_ms: nonNegInt.optional(),
        timed_out: z.boolean().optional(),
      })
      .nullable()
      .optional(),
  })
  .superRefine((v, ctx) => {
    const need = (key: string, why: string) => {
      if ((v as Record<string, unknown>)[key] === undefined) {
        ctx.addIssue({ code: 'custom', path: [key], message: `required when ${why}` });
      }
    };
    if (v.decision === 'hold') {
      if (v.final !== false) ctx.addIssue({ code: 'custom', path: ['final'], message: 'must be false when decision is hold' });
      need('hold', 'decision is hold');
    }
    if (v.decision === 'step_up') need('step_up', 'decision is step_up');
    if (v.decided_by === 'jev' || v.decided_by === 'devin') {
      need('classification', `decided_by is ${v.decided_by}`);
      need('model', `decided_by is ${v.decided_by}`);
    }
  });

export type RiskResponse = z.infer<typeof riskResponseSchema>;
