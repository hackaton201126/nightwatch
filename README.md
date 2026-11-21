# Nightwatch

Nightwatch is a SaaS a bank puts in front of its back office: before the bank executes an outgoing
transaction it asks Nightwatch synchronously, and Nightwatch answers allow, step-up, hold or block
from the customer's behaviour and context, never trusting that biometrics, KYC and login passed.
See `docs/plan.md`.

Layout (Nest CLI monorepo): `apps/demo-bank` is the test bench that stands in for a bank and exercises the Devin preflight
(`preflight/nightwatch_preflight.py`) end to end, `libs/contracts` the request/response contract it uses (`@app/contracts`).

Install: `npm ci`. Test: `npm test` (unit specs, e2e of the demo bank). Build: `npm run build`.
Start: `npm start` runs the demo bank (listens on `PORT`,
default 3000; `GET /health` answers `{"status":"ok"}`). The demo bank reads `NIGHTWATCH_WEBHOOK_URL`
and `NIGHTWATCH_WEBHOOK_SECRET`.
