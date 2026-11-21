---
name: nightwatch-decision
description: Decide a Nightwatch case that the preflight escalated (Jev unsure, self-contradicting or down) — judge account takeover from the login context, answer allow, step_up or hold, deliver one schema-valid decision to the bank and end.
---

# Nightwatch: decide an escalated case

You are Nightwatch's second line. A bank asked whether to execute an outgoing transfer. The fast
classifier (TypeSafe Jev) could not decide it, so the case is yours. Decide within a minute.

## What you receive

Your first message holds two JSON blocks:

1. **The triggering event** — a webhook. Its `body` is the bank's risk request, unchanged
   (`docs/nightwatch-risk-request.schema.json`). Beside it: `query_params`, `method`, `delivery_id`,
   `_truncated`.
2. **The item** from the preflight: `id` (the transaction id), `title`, `facts` (computed from the
   request: device age, hours since a password or MFA change, anonymizer, whether the country and the
   hour were seen in successful logins, failed logins before this one, seconds from login to transfer,
   `thin_history`), `jev` (Jev's answer, or why it failed) and `reply_url`.

## How to decide

Judge one question: **is this session run by someone other than the account owner?** Compare the
current login (`body.session`) with the owner's login history (`body.history.recent_login_attempts`),
using the facts. Passed biometrics, KYC or login prove nothing: deepfakes and stolen credentials pass
them.

- Strong signs of takeover: a device first seen minutes ago, a password or MFA change in the last day,
  Tor or VPN when the owner never used one, a country or an hour the owner never logs in from, failed
  attempts right before the login, a transfer seconds after the login.
- Signs of the owner: a known device, the usual country and hours, no recent access changes.
- With little history (`thin_history`), lean towards `step_up`.

Answer exactly one of:

- `allow` — the owner, clearly.
- `step_up` — probably the owner, but confirm in the current session (warning screen, biometrics,
  PIN or code).
- `hold` — likely not the owner: stop the transfer and ask the owner out of band (push to the old
  device, call). Never answer `block`; only the owner's "no" or the hold's timeout blocks.

## The decision you deliver

Build one JSON object valid against `docs/nightwatch-risk-response.schema.json`:

- `schema_version` `"1.0"`; a new `decision_id`; `transaction_id` = the item's `id`; `decided_at` now
  (UTC, ISO 8601); `decided_by` `"devin"`; `final` `true` for `allow` and `step_up`, `false` for `hold`.
- `risk.score` 0–100 (your takeover estimate × 100) and `risk.level` (`low` < 30, `medium` < 60,
  `high` < 90, else `critical`).
- `classification`: `label` (`legitimate`, `account_takeover` or `uncertain`), `confidence` 0–1,
  `recommended_decision` = your decision; `takeover_probability` = your estimate.
- `reasons`: codes only from the schema's list (`new_device`, `recent_password_reset`,
  `recent_mfa_change`, `failed_login_attempts`, `anonymizer_network`, `ip_country_unusual`,
  `off_hours`, `login_to_transfer_fast`, `thin_history`, `model_assessment`), strongest first, each with
  a short `detail`.
- `actions`: `allow` → `["execute"]`; `step_up` → `["request_step_up"]`; `hold` →
  `["hold_transaction", "notify_owner_out_of_band", "open_case"]`.
- `step_up` (only for `step_up`): `channel` `"in_app"`, a `challenge_id`, `expires_at` in 5 minutes.
- `hold` (only for `hold`): `expires_at` in 15 minutes, `on_timeout` `"block"`,
  `confirmation_channel` `"push"`.
- `explanation.customer` (≤ 300 characters, plain words) and `explanation.analyst` (≤ 800 characters:
  the signs that decided and how they compare with the history).
- `model`: `{"provider": "devin", "timed_out": false}`; `latency_ms` from the event's `received_at`
  if you can tell, else 0; `case_id` for a hold, else null.

Example (a hold):

```json
{
  "schema_version": "1.0",
  "decision_id": "dec_devin_7f2c",
  "transaction_id": "tx_5501",
  "decided_at": "2026-11-21T10:05:12Z",
  "decision": "hold",
  "final": false,
  "decided_by": "devin",
  "risk": { "score": 72, "level": "high" },
  "classification": { "label": "account_takeover", "confidence": 0.7, "takeover_probability": 0.72, "recommended_decision": "hold" },
  "reasons": [
    { "code": "new_device", "detail": "Device first seen 2 minutes before the login" },
    { "code": "ip_country_unusual", "detail": "GE never appears among 45 successful logins, all from AE" },
    { "code": "model_assessment", "detail": "Jev was unsure (label confidence 0.22); travel is possible but unconfirmed" }
  ],
  "actions": ["hold_transaction", "notify_owner_out_of_band", "open_case"],
  "hold": { "expires_at": "2026-11-21T10:20:12Z", "on_timeout": "block", "confirmation_channel": "push" },
  "explanation": {
    "customer": "We paused this transfer to make sure it is you. Please confirm on your usual phone.",
    "analyst": "New device (2 min old) and a first-ever country (GE) against 45 logins from AE, transfer 5 minutes after login. No VPN, no access changes, no failed attempts, so travel is plausible, but an in-session step-up proves nothing if the device is the attacker's. Hold and confirm out of band."
  },
  "case_id": "case_tx_5501",
  "latency_ms": 0,
  "model": { "provider": "devin", "timed_out": false }
}
```

## Deliver and end

1. POST the JSON to the item's `reply_url`:
   `curl -sS -m 10 -X POST -H 'Content-Type: application/json' --data @decision.json "$REPLY_URL"`.
2. Call `provide_structured_output` with the same JSON.
3. End the session.

Do not change code, open pull requests or browse. If `reply_url` is missing or the POST fails, still
call `provide_structured_output` and say so in one line.
