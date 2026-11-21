# Nightwatch

Nightwatch catches an account being drained through a bank's API at 2 AM, freezes it,
finds the flaw in the bank's code with a code graph, and has Devin write the fix and a
test that replays the attack. The team demos it live.

The repository holds two NestJS 11 apps side by side:

- `bank/` — "Oasis Bank", the deliberately vulnerable banking API (demo target). Default port 3001.
- `sentinel/` — Nightwatch itself: ingest, detection, response, root cause, auto-fix, dashboard. Default port 3002.

## Running

Each app is its own npm package:

```sh
cd bank && npm ci && npm run build && PORT=3001 npm start
cd sentinel && npm ci && npm run build && PORT=3002 npm start
```

`PORT` is optional; each app has its default (3001 for bank, 3002 for sentinel).

Each app answers `GET /health` with `{"status":"ok","app":"bank"|"sentinel"}`.

## Checks

In each app directory: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
