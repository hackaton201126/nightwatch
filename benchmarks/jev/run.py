import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from http.client import HTTPException
from pathlib import Path
from tempfile import mkdtemp
from time import perf_counter
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parent
REQUESTS_DIR = ROOT / "requests"
VARIANTS_DIR = REQUESTS_DIR / "variants"
CASE_ALIASES = {"positive": "vpn-and-access-changes", "negative": "normal"}
EXPECTED_PROBABILITY_RANGES = {
    CASE_ALIASES["positive"]: (0.70, 1.0),
    CASE_ALIASES["negative"]: (0.0, 0.30),
}
API_URL = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-1.14.0"
QUESTION_ID = "login_compromise_indicators"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def request_path(argument):
    path = Path(argument)
    if argument == path.name and not path.suffix:
        name = CASE_ALIASES.get(argument, argument)
        variant = VARIANTS_DIR / f"{name}.json"
        if variant.is_file():
            return variant
        return REQUESTS_DIR / f"{name}.json"
    return path


def case_scenario(path):
    if path.resolve().parent == VARIANTS_DIR:
        return path.stem.rsplit("-", 1)[0]
    return path.stem


def expected_probability_range(path):
    path = path.resolve()
    if path.parent in {REQUESTS_DIR, VARIANTS_DIR}:
        return EXPECTED_PROBABILITY_RANGES.get(case_scenario(path))
    return None


def parse_time(value):
    if not isinstance(value, str):
        raise TypeError("Expected a login timestamp with a UTC offset")
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError(f"Timestamp must include a UTC offset: {value}")
    return parsed.astimezone(UTC)


def minutes_before(login_at, value):
    if value is None:
        return None
    elapsed = (login_at - parse_time(value)).total_seconds()
    return int(elapsed // 60) if elapsed >= 0 else None


def network(event):
    return event.get("network") or {}


def login_facts(bank_request):
    session = bank_request["session"]
    login_at = parse_time(session.get("authenticated_at"))
    attempts = bank_request["history"]["recent_login_attempts"]
    if not isinstance(attempts, list) or not attempts:
        raise ValueError("history.recent_login_attempts must contain the current login")

    current = attempts[-1]
    if (
        current["outcome"] != "success"
        or parse_time(current["occurred_at"]) != login_at
    ):
        raise ValueError(
            "history.recent_login_attempts[-1] must be the successful login at session.authenticated_at"
        )

    current_network = network(current)
    session_network = network(session)
    for field, actual, expected in (
        ("device_id", current.get("device_id"), session.get("device_id")),
        (
            "network.ip_ref",
            current_network.get("ip_ref"),
            session_network.get("ip_ref"),
        ),
    ):
        if actual is not None and expected is not None and actual != expected:
            raise ValueError(f"Final login {field} differs from session.{field}")

    prior = [(parse_time(entry["occurred_at"]), entry) for entry in attempts[:-1]]
    if any(at > login_at for at, _ in prior):
        raise ValueError(
            "Entries before the final login must be at or before session.authenticated_at"
        )

    window_start = login_at - timedelta(days=30)
    prior = sorted(prior, key=lambda entry: entry[0], reverse=True)
    recent = [(at, entry) for at, entry in prior if at >= window_start][:50]
    successes = [(at, entry) for at, entry in recent if entry["outcome"] == "success"]

    try:
        customer_timezone = ZoneInfo(bank_request["customer"]["timezone"])
    except (ZoneInfoNotFoundError, ValueError):
        customer_timezone = None
    country = current_network.get("ip_country") or session_network.get("ip_country")
    historical_countries = [network(entry).get("ip_country") for _, entry in successes]
    historical_countries = [code for code in historical_countries if code]
    failure_window_start = login_at - timedelta(hours=1)

    local_hour = None
    hour_seen = None
    nearest_hour_distance = None
    if customer_timezone is not None:
        local_hour = login_at.astimezone(customer_timezone).hour
        if len(successes) >= 5:
            historical_hours = [
                at.astimezone(customer_timezone).hour for at, _ in successes
            ]
            hour_seen = local_hour in historical_hours
            hour_differences = [abs(local_hour - hour) for hour in historical_hours]
            nearest_hour_distance = min(
                min(delta, 24 - delta) for delta in hour_differences
            )

    previous_success = None
    if successes:
        at, entry = successes[0]
        previous_network = network(entry)
        previous_success = {
            "ip_country": previous_network.get("ip_country"),
            "anonymizer": previous_network.get("anonymizer", "unknown"),
            "seconds_before_current_login": int((login_at - at).total_seconds()),
        }

    return {
        "login_hour_local": local_hour,
        "hour_seen_in_successful_logins": hour_seen,
        "distance_to_nearest_seen_hour": nearest_hour_distance,
        "ip_country": country,
        "country_seen_in_successful_logins": (
            country in historical_countries
            if country and len(historical_countries) >= 5
            else None
        ),
        "anonymizer": current_network.get(
            "anonymizer", session_network.get("anonymizer", "unknown")
        ),
        "previous_successful_login": previous_success,
        "successful_logins_in_history": len(successes),
        "thin_history": len(successes) < 5,
        "device_age_minutes": minutes_before(
            login_at, session.get("device_first_seen_at")
        ),
        "minutes_since_password_reset": minutes_before(
            login_at, session.get("last_password_reset_at")
        ),
        "minutes_since_mfa_change": minutes_before(
            login_at, session.get("last_mfa_change_at")
        ),
        "failed_logins_1h_before": sum(
            entry["outcome"] == "failure" and at >= failure_window_start
            for at, entry in recent
        ),
    }


def payload_for(bank_request, questions):
    return {
        "model": MODEL,
        "state": {"request": bank_request, "facts": login_facts(bank_request)},
        "questions": questions,
    }


def request_json(url, api_key, *, timeout, payload=None):
    if not api_key.isascii() or any(character.isspace() for character in api_key):
        raise ValueError("The API key must be a single ASCII token")
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(url, data=data, headers={"Content-Type": "application/json"})
    request.add_unredirected_header("Authorization", f"Bearer {api_key}")
    with urlopen(request, timeout=timeout) as response:
        return json.load(response)


def is_probability(value):
    return type(value) in (int, float) and 0 <= value <= 1


def jev_probability(result):
    answer = result["answers"][QUESTION_ID]
    probability = answer["noul"]
    if answer["type"] != "noul" or not is_probability(probability):
        raise ValueError(f"TypeSafe returned an invalid Noul answer for {QUESTION_ID}")
    return probability


@dataclass(frozen=True)
class Measurement:
    model: str
    elapsed_ms: float
    probability_yes: float | None
    error: str | None
    response: object

    def passed(self, expected):
        if self.error is not None or not is_probability(self.probability_yes):
            return False
        if expected is None:
            return True
        lower, upper = expected
        return lower <= self.probability_yes <= upper


def measure(url, payload, api_key, read_probability, *, timeout):
    model = payload["model"]
    probability = response = error = None
    started = perf_counter()
    try:
        response = request_json(url, api_key, timeout=timeout, payload=payload)
        returned_model = response["model"]
        if not isinstance(returned_model, str) or not returned_model:
            raise ValueError("Missing model ID in the response")
        model = returned_model
        probability = read_probability(response)
    except HTTPError as exc:
        error = f"HTTP {exc.code}"
        exc.close()
    except (
        OSError,
        HTTPException,
        ValueError,
        LookupError,
        TypeError,
        AttributeError,
    ) as exc:
        error = str(exc) or type(exc).__name__
    elapsed_ms = (perf_counter() - started) * 1000
    return Measurement(model, elapsed_ms, probability, error, response)


def main():
    parser = argparse.ArgumentParser(
        description="Ask Jev about the final login in a Nightwatch request"
    )
    parser.add_argument(
        "requests",
        metavar="CASE_OR_FILE",
        nargs="*",
        type=request_path,
        help="Scenario names or paths to bank JSON files. Defaults to all scenarios.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print one TypeSafe request per line without sending it.",
    )
    parser.add_argument(
        "--list-cases", action="store_true", help="List built-in scenarios and aliases."
    )
    parser.add_argument(
        "--verbose", action="store_true", help="Show model IDs and response paths."
    )
    args = parser.parse_intermixed_args()
    fixtures = sorted(REQUESTS_DIR.glob("*.json"))
    if args.list_cases:
        for fixture in fixtures:
            print(fixture.stem)
        for alias, scenario in CASE_ALIASES.items():
            print(f"{alias} -> {scenario}")
        return 0

    paths = args.requests or fixtures
    api_key = os.environ.get("TYPESAFE_API_KEY")
    if not args.dry_run and not api_key:
        print("❌ Set TYPESAFE_API_KEY to call TypeSafe", file=sys.stderr)
        return 2

    questions = read_json(ROOT / "questions" / "login-compromise.json")
    run_dir = None
    failed = False
    for index, path in enumerate(paths, start=1):
        try:
            payload = payload_for(read_json(path), questions)
            if args.dry_run:
                print(json.dumps(payload, ensure_ascii=False))
                continue

            expected = expected_probability_range(path)
            measurement = measure(
                API_URL, payload, api_key, jev_probability, timeout=10
            )
            if measurement.error is not None:
                print(
                    f"❌ {path.stem} · {measurement.elapsed_ms:.0f} ms · TypeSafe {measurement.error}",
                    file=sys.stderr,
                )
                failed = True
                continue

            if run_dir is None:
                responses_dir = ROOT / "responses"
                responses_dir.mkdir(exist_ok=True)
                run_dir = Path(mkdtemp(prefix="run-", dir=responses_dir))
            response_file = run_dir / f"{index:02d}-{path.stem}.json"
            response_file.write_text(
                json.dumps(measurement.response, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            passed = measurement.passed(expected)
            badge = "✅" if passed else "❌"
            print(
                f"{badge} {path.stem} · p(yes)={measurement.probability_yes:.2%}"
                f" · {measurement.elapsed_ms:.0f} ms",
                flush=True,
            )
            if args.verbose:
                print(f"  {measurement.model}  {response_file}")
            failed = failed or not passed
        except (OSError, ValueError, LookupError, TypeError, AttributeError) as error:
            print(f"❌ {path.stem} · {error}", file=sys.stderr)
            failed = True
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
