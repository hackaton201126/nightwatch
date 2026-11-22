# Nightwatch

**Second place at THE CIS SPRINT · Two Shawarma Team**

Nightwatch is a hackathon prototype for screening outgoing bank transfers. The demo bank sends a transfer for assessment and receives an allow, step-up, hold or block recommendation through a callback. Nightwatch applies deterministic rules first, asks TypeSafe's Jev to assess sign-in signals when needed, and escalates uncertain cases to Devin. The bank decides whether to release the transfer.

## Final presentation

- [View or download the seven-slide PDF](docs/presentation/nightwatch.pdf).
- [Interactive presentation source](docs/presentation/). Open `docs/presentation/index.html` from a local checkout. Use the arrow keys to navigate, **Speaker notes** for the talk track, and **Play message flow** on slide 3.

## Run the tests

Install the demo bank dependencies with `npm ci`. Run `npm test` for the unit and end-to-end tests and `npm run build` to build the demo bank.

The Jev benchmark has a separate suite that runs with Python 3.11 or newer and uses no API keys.

```sh
python3 -m unittest discover -s benchmarks/jev -v
```

The [benchmark guide](benchmarks/jev/) includes the synthetic scenarios, dry-run commands, and the measurements behind slide 6.

## Run the demo bank

After building, run `npm start` and open `http://localhost:3000/bank`. The demo bank listens on `PORT`, which defaults to `3000`. `GET /health` returns `{"status":"ok"}`. Set `NIGHTWATCH_WEBHOOK_URL` and `NIGHTWATCH_WEBHOOK_SECRET` to connect the live screening workflow.

- [Demo bank](apps/demo-bank/) provides the synthetic transfers and receives assessment callbacks.
- [Preflight](preflight/nightwatch_preflight.py) implements rules, Jev screening, and escalation.
- [Contracts](libs/contracts/) define the risk request and response. See also the [request schema](docs/nightwatch-risk-request.schema.json) and [response schema](docs/nightwatch-risk-response.schema.json).
