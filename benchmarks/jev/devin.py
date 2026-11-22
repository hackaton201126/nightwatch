from http.client import HTTPException
from time import perf_counter, sleep
from urllib.error import HTTPError
from urllib.parse import quote

import run

API_URL = "https://api.devin.ai/v3"
MODEL = "swe-2-flash-medium"
REQUEST_TIMEOUT_SECONDS = 30
SESSION_TIMEOUT_SECONDS = 180
POLL_INTERVAL_SECONDS = 1


def sessions_url(api_key, org_id):
    if not org_id:
        identity = run.request_json(
            f"{API_URL}/self", api_key, timeout=REQUEST_TIMEOUT_SECONDS
        )
        org_id = identity.get("devin_sessions_org_id") or identity.get("org_id")
    if not isinstance(org_id, str) or not org_id.startswith("org-"):
        raise ValueError("Set DEVIN_ORG_ID to the Devin organization ID (org-…)")
    return f"{API_URL}/organizations/{quote(org_id, safe='')}/sessions"


def session_payload(case, prompt, schema):
    return {
        "title": f"Nightwatch benchmark · {case} · Flash Medium",
        "devin_mode": MODEL,
        "prompt": (
            f"{prompt}\n"
            "Submit one final structured output without using other tools."
        ),
        "structured_output_schema": schema,
        "structured_output_required": True,
        "memory_enabled": False,
        "resumable": False,
    }


def measure(endpoint, payload, api_key, read_probability):
    model = MODEL
    probability = response = error = None
    started = perf_counter()
    deadline = started + SESSION_TIMEOUT_SECONDS
    try:
        response = run.request_json(
            endpoint, api_key, timeout=REQUEST_TIMEOUT_SECONDS, payload=payload
        )
        session_id = quote(response["session_id"], safe="")
        session_url = f"{endpoint}/{session_id}"
        while (remaining := deadline - perf_counter()) > 0:
            response = run.request_json(
                session_url, api_key, timeout=min(remaining, REQUEST_TIMEOUT_SECONDS)
            )
            selected_model = response.get("selected_devin_mode") or response.get("devin_mode")
            if selected_model:
                model = selected_model
                if model != MODEL:
                    raise ValueError(f"Devin selected {model}, expected {MODEL}")

            result = response.get("structured_output")
            if result is not None:
                if selected_model != MODEL:
                    raise ValueError(f"Devin did not confirm the requested model {MODEL}")
                probability = read_probability(result)
                break

            status, detail = response["status"], response.get("status_detail")
            if status in {"error", "exit", "suspended"} or detail in {
                "finished", "waiting_for_user", "waiting_for_approval",
            }:
                raise ValueError(f"Devin session {status}/{detail} without structured output")
            sleep(max(0, min(POLL_INTERVAL_SECONDS, deadline - perf_counter())))
        else:
            raise TimeoutError(
                f"Devin did not return structured output in {SESSION_TIMEOUT_SECONDS} s"
            )
    except HTTPError as exc:
        error = f"HTTP {exc.code}"
        exc.close()
    except (OSError, HTTPException, ValueError, LookupError, TypeError, AttributeError) as exc:
        error = str(exc) or type(exc).__name__

    elapsed_ms = (perf_counter() - started) * 1000
    return run.Measurement(model, elapsed_ms, probability, error, response)
