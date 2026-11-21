# Nightwatch

Nightwatch is a SaaS a bank puts in front of its back office: before the bank executes an outgoing
transaction it asks Nightwatch synchronously, and Nightwatch answers allow, step-up, hold or block
from the customer's behaviour and context, never trusting that biometrics, KYC and login passed.
See `docs/plan.md`.

Layout (Nest CLI monorepo): `apps/nightwatch` is the production app, `apps/demo-bank` the test app
that stands in for a bank, `libs/contracts` the request/response contract both use (`@app/contracts`).

Install: `npm ci`. Test: `npm test` (unit specs, e2e of both apps, preflight). Build: `npm run build`.
Start: `npm start` runs Nightwatch, `npm run start:demo-bank` the demo bank (both listen on `PORT`,
default 3000; `GET /health` answers `{"status":"ok"}`). The demo bank reads `NIGHTWATCH_WEBHOOK_URL`
and `NIGHTWATCH_WEBHOOK_SECRET`.
