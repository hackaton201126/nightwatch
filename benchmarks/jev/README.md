# Jev evaluation and benchmark

The test suite and fixtures run with Python 3.11 or newer. The scripts use the standard library and the system IANA time-zone database.

## Run offline

Run these commands from the repository root.

```sh
python3 -m unittest discover -s benchmarks/jev -v
python3 benchmarks/jev/run.py --dry-run normal vpn-and-access-changes
python3 benchmarks/jev/compare.py --dry-run
python3 benchmarks/jev/compare_multi.py --dry-run --questions 5
```

- [Single-question fixtures](requests/) cover 18 synthetic sign-ins across six scenarios.
- [Multi-question fixtures](multi-cases.json) cover 12 labelled synthetic cases. The [five checks](questions/behavior-anomalies.json) cover rapid country changes, unusual sign-in hours, new devices, recent credential changes, and bursts of failed sign-ins.
- [Unit tests](test_compare_multi.py) check that strategies receive equivalent evidence, controls isolate individual signals, responses are validated, and incomplete parallel runs preserve the answers and usage received.

## Run against provider APIs

Set credentials in the shell environment before running the corresponding command.

| Command | Credentials | What it runs |
| --- | --- | --- |
| `python3 benchmarks/jev/run.py positive negative` | `TYPESAFE_API_KEY` | Jev smoke tests with expected probability ranges. |
| `python3 benchmarks/jev/compare.py` | `TYPESAFE_API_KEY`, `OPENAI_API_KEY`, and `DEVIN_PAT` or `DEVIN_API_KEY` | Single-question comparison across Jev, OpenAI, and Devin Cloud. Set `DEVIN_ORG_ID` if the script cannot infer your organization. |
| `python3 benchmarks/jev/compare_multi.py --questions 3` | `TYPESAFE_API_KEY` and `OPENAI_API_KEY` | Jev and OpenAI on the first three checks. Use `--questions 5` for the full question set. |

These runs can incur provider charges. They save outputs under `benchmarks/jev/responses/`, which Git ignores. Use `--help` for model, timeout, and repeat options.

## Measurements behind slide 6

The [measurements CSV](slide-6-measurements.csv) records both historical runs on the same 18 synthetic sign-ins. Jev 1.14.0 and GPT‑6 Luna each answered one question per call. The Luna runs used Chat Completions with Structured Outputs on the standard tier. The current comparison runners use the OpenAI Responses API.

| Historical run | Jev median | Luna median | Jev estimated USD per million calls | Luna estimated USD per million calls |
| --- | ---: | ---: | ---: | ---: |
| Luna cache disabled (`compare-t0qr66tt`) | 297.54 ms | 1,707.57 ms | $78.87 | $197.98 |
| Luna default cache (`compare-80hti35t`) | 284.87 ms | 1,913.73 ms | $78.87 | $76.29 |

Latency measures time to a valid JSON answer under the benchmark's concurrency of three requests per provider. Both models returned valid answers on all 18 cases and met all six predefined ranges in each run. Luna recorded zero cache reads and writes in the first run and hit the cache on 17 of 18 calls in the replay. Blank cache fields indicate that the response supplied no counter.

Cost estimates apply the list rates recorded on 21 November 2026 to observed token usage, including Luna's reasoning tokens and any reported cache reads and writes. The projection uses the sample mean cost per call. The benchmark measures model-call behavior on synthetic fixtures. The bank's end-to-end latency, operating cost, and detection performance would require separate pilot measurements. [Jev pricing](https://help.typesafe.ai/articles/5187202169-how-much-does-jev-cost) · [GPT‑6 Luna pricing](https://developers.openai.com/api/docs/models/gpt-6-luna)
