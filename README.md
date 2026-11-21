# Nightwatch

Nightwatch is a SaaS a bank puts in front of its back office: before the bank executes an outgoing
transaction it asks Nightwatch synchronously, and Nightwatch answers allow, step-up, hold or block
from the customer's behaviour and context, never trusting that biometrics, KYC and login passed.
See `docs/plan.md`.

Install: `npm ci`. Test: `npm test` (unit specs, then e2e). Start: `npm run build && npm start`
(listens on `PORT`, default 3000; `GET /health` answers `{"status":"ok"}`).
