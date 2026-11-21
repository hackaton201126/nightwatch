#!/usr/bin/env python3
"""Nightwatch preflight for a Devin automation: Python 3, standard library only, one file.

Reads the trigger event from $EVENT_FILE, decides the bank's webhook (small-amount shortcut, then
Jev) and writes exactly one decision to $OUTPUT_FILE. A clear case is POSTed to the bank and the
output is {"run": false, ...}; an unsure one becomes one item for a Devin session. Always exits 0.
Port of the TypeScript core in src/decision.
"""
import json
import math
import os
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

# ---- configuration (values as in docs/plan.md; amounts in AED major units) -------------------
CONFIG = {
    "reply_url": "https://bank.example/nightwatch/decisions",
    "input": {"max_login_attempts": 50, "login_lookback_days": 30, "min_successful_logins": 5},
    "fast_allow": {"max_amount": 10000, "daily": {"max_total": 20000, "max_count": 5}},
    "stoppers": {"new_device_hours": 24, "access_reset_hours": 24, "tor": True, "failed_logins_hour": 3},
    "facts": {"failed_logins_window_minutes": 60},
    "jev": {"model": "jev-latest", "timeout_s": 2.0, "thresholds": {"step_up": 0.2, "hold": 0.6}},
    "escalate": {"min_label_confidence": 0.5},
    "confirmation": {"timeout_minutes": 15},
    "bank_post_timeout_s": 4.0,
}
JEV_URL = "https://api.typesafe.ai/v1/systemone"

QUESTIONS = {
    "takeover": {
        "type": "noul",
        "instructions": "Is this banking session most likely operated by someone other than the account owner (account takeover)? Judge the current login in `request.session` against the owner's past logins in `request.history.recent_login_attempts`, using the precomputed `facts`.",
    },
    "pattern": {
        "type": "choice",
        "instructions": "Which reading of this login fits best?",
        "criteria": {
            "legitimate": "The owner logging in as usual, maybe on a new phone or while travelling.",
            "account_takeover": "Someone else logged in with stolen credentials, a hijacked session or a deepfaked check.",
            "uncertain": "The evidence does not support either reading.",
        },
    },
}
LABELS = ("legitimate", "account_takeover", "uncertain")
HOUR_MS = 3_600_000


# ---- helpers ------------------------------------------------------------------------------------
def ms(value):
    """ISO timestamp -> epoch milliseconds, or None."""
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        return None
    return int(dt.timestamp() * 1000)


def aed(minor):
    return "AED %.2f" % (minor / 100)


def get(obj, *path):
    for key in path:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(key)
    return obj


def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def is_unit(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and 0 <= v <= 1


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# ---- small-amount shortcut ----------------------------------------------------------------------
def check_fast_path(request, config, now, decision_id):
    limits, stoppers = [], []
    tx = request.get("transaction") if isinstance(request.get("transaction"), dict) else None
    session = get(request, "session") or {}
    requested_at = ms(get(tx, "requested_at"))
    amount = get(tx, "amount_policy_minor")
    window = get(request, "history", "windows", "24h")
    fa, st = config["fast_allow"], config["stoppers"]

    amount_ok = is_int(amount)
    if not amount_ok or amount >= fa["max_amount"] * 100:
        limits.append("amount")

    count = total = 0
    if (
        not isinstance(window, dict)
        or not is_int(window.get("attempted_count"))
        or not is_int(window.get("attempted_amount_policy_minor"))
    ):
        limits.append("daily_window_missing")
    elif amount_ok:
        count = window["attempted_count"] + 1
        total = window["attempted_amount_policy_minor"] + amount
        if count > fa["daily"]["max_count"]:
            limits.append("daily_count")
        if total > fa["daily"]["max_total"] * 100:
            limits.append("daily_total")
    if requested_at is None:
        limits.append("requested_at_missing")

    first_seen = ms(get(session, "device_first_seen_at"))
    if first_seen is None:
        stoppers.append("device_first_seen_unknown")
    elif requested_at is not None and requested_at - first_seen < st["new_device_hours"] * HOUR_MS:
        stoppers.append("new_device")

    def recent(v):
        t = ms(v)
        return t is not None and requested_at is not None and requested_at - t < st["access_reset_hours"] * HOUR_MS

    if recent(get(session, "last_password_reset_at")):
        stoppers.append("recent_password_reset")
    if recent(get(session, "last_mfa_change_at")):
        stoppers.append("recent_mfa_change")
    if st["tor"] and get(session, "network", "anonymizer") == "tor":
        stoppers.append("tor")

    auth_at = ms(get(session, "authenticated_at"))
    if auth_at is None:
        stoppers.append("authenticated_at_unknown")
    elif failed_logins(request, auth_at, config) >= st["failed_logins_hour"]:
        stoppers.append("failed_logins")

    if limits or stoppers or tx is None or not amount_ok:
        return {"shortcut": False, "limits_not_met": limits, "stoppers": stoppers}

    detail = "%s; 24h with this transfer: %d tx, %s" % (aed(amount), count, aed(total))
    return {
        "shortcut": True,
        "response": {
            "schema_version": "1.0",
            "decision_id": decision_id,
            "transaction_id": tx.get("transaction_id") if isinstance(tx.get("transaction_id"), str) else "",
            "decided_at": iso(now),
            "decision": "allow",
            "final": True,
            "decided_by": "fast_path",
            "risk": {"score": 0, "level": "low"},
            "classification": None,
            "reasons": [{"code": "small_amount", "detail": detail}],
            "actions": ["execute"],
            "explanation": {
                "customer": "Small transfer, processed immediately.",
                "analyst": (
                    "Fast path: amount %s is below the %s limit. 24h totals including this transfer: "
                    "%d transactions (limit %d), %s (limit %s). No takeover stopper: known device, no recent "
                    "password/MFA change, no Tor, fewer than %d failed logins in the hour before login. "
                    "No model was asked."
                )
                % (
                    aed(amount), aed(fa["max_amount"] * 100), count, fa["daily"]["max_count"],
                    aed(total), aed(fa["daily"]["max_total"] * 100), st["failed_logins_hour"],
                ),
            },
            "latency_ms": 0,
            "model": None,
        },
    }


def failed_logins(request, auth_at, config):
    window = config["facts"]["failed_logins_window_minutes"] * 60_000
    n = 0
    for a in get(request, "history", "recent_login_attempts") or []:
        t = ms(get(a, "occurred_at"))
        if get(a, "outcome") == "failure" and t is not None and auth_at - window <= t <= auth_at:
            n += 1
    return n


# ---- facts ----------------------------------------------------------------------------------------
def compute_facts(request, config):
    """Facts from the request alone. The current login (success at authenticated_at) is left out of
    every comparison with history; thin history sets the country and hour facts to null."""
    from zoneinfo import ZoneInfo

    session = get(request, "session") or {}
    requested_at = ms(get(request, "transaction", "requested_at"))
    auth_at = ms(get(session, "authenticated_at"))

    def hours_since(v):
        t = ms(v)
        if t is None or requested_at is None:
            return None
        return int((requested_at - t) // HOUR_MS)

    first_seen = ms(get(session, "device_first_seen_at"))
    device_age = None
    if first_seen is not None and requested_at is not None:
        device_age = int((requested_at - first_seen) // 60_000)

    lookback = config["input"]["login_lookback_days"] * 24 * HOUR_MS
    attempts = [a for a in (get(request, "history", "recent_login_attempts") or []) if isinstance(a, dict)]
    attempts = attempts[: config["input"]["max_login_attempts"]]
    successes = []
    for a in attempts:
        t = ms(a.get("occurred_at"))
        if a.get("outcome") != "success" or t is None:
            continue
        if auth_at is not None and t == auth_at:
            continue  # the current login
        if requested_at is not None and t < requested_at - lookback:
            continue
        successes.append(a)

    tz = None
    try:
        tz = ZoneInfo(get(request, "customer", "timezone"))
    except Exception:
        tz = None

    def local_hour(t):
        if t is None or tz is None:
            return None
        return datetime.fromtimestamp(t / 1000, tz).hour

    thin = len(successes) < config["input"]["min_successful_logins"]
    country = get(session, "network", "ip_country")
    cur_hour = local_hour(auth_at)
    country_seen = hour_seen = None
    if not thin:
        if isinstance(country, str):
            country_seen = any(get(a, "network", "ip_country") == country for a in successes)
        if cur_hour is not None:
            hour_seen = any(local_hour(ms(a.get("occurred_at"))) == cur_hour for a in successes)

    anonymizer = get(session, "network", "anonymizer")
    return {
        "device_age_minutes": device_age,
        "hours_since_password_reset": hours_since(get(session, "last_password_reset_at")),
        "hours_since_mfa_change": hours_since(get(session, "last_mfa_change_at")),
        "anonymizer": anonymizer if isinstance(anonymizer, str) else None,
        "country_seen_in_successful_logins": country_seen,
        "failed_logins_1h_before": failed_logins(request, auth_at, config) if auth_at is not None else None,
        "login_hour_local": cur_hour,
        "hour_seen_in_successful_logins": hour_seen,
        "seconds_login_to_transfer": (
            int((requested_at - auth_at) // 1000) if auth_at is not None and requested_at is not None else None
        ),
        "successful_logins_in_history": len(successes),
        "thin_history": thin,
    }


# ---- Jev ------------------------------------------------------------------------------------------
def http_post_json(url, body, headers, timeout):
    """POST JSON; returns (status, parsed_json_or_None). Raises on connection errors."""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read()
            status = res.status
    except urllib.error.HTTPError as e:
        return e.code, None
    try:
        return status, json.loads(raw)
    except ValueError:
        return status, None


def ask_jev(request, facts, config, api_key, url):
    """Returns {"ok": True, p, label, confidence} or {"ok": False, timed_out, error}. Hard 2 s cap."""
    box = {}

    def work():
        try:
            status, out = http_post_json(
                url,
                {"model": config["jev"]["model"], "state": {"request": request, "facts": facts}, "questions": QUESTIONS},
                {"Authorization": "Bearer " + api_key},
                config["jev"]["timeout_s"],
            )
            box["result"] = (status, out)
        except Exception as e:  # noqa: BLE001 - any failure is a Jev failure
            box["error"] = "%s: %s" % (type(e).__name__, e)

    th = threading.Thread(target=work, daemon=True)
    th.start()
    th.join(config["jev"]["timeout_s"])
    if th.is_alive():
        return {"ok": False, "timed_out": True, "error": "Jev did not answer within %.1f s" % config["jev"]["timeout_s"]}
    if "error" in box:
        timed_out = "timed out" in box["error"]
        return {"ok": False, "timed_out": timed_out, "error": box["error"]}
    status, out = box["result"]
    if not 200 <= status < 300:
        return {"ok": False, "timed_out": False, "error": "Jev answered HTTP %d" % status}
    a = get(out, "answers")
    p, label, conf = get(a, "takeover", "noul"), get(a, "pattern", "choice"), get(a, "pattern", "confidence")
    if not is_unit(p) or label not in LABELS or not is_unit(conf):
        return {"ok": False, "timed_out": False, "error": "malformed Jev answer"}
    return {"ok": True, "p": p, "label": label, "confidence": conf}


def band(p, config):
    t = config["jev"]["thresholds"]
    if p < t["step_up"]:
        return "allow"
    return "step_up" if p < t["hold"] else "hold"


def reasons_from(f, p, label):
    r = []
    if f["device_age_minutes"] is not None and f["device_age_minutes"] < 24 * 60:
        r.append({"code": "new_device", "detail": "device first seen %d min ago" % f["device_age_minutes"]})
    if f["hours_since_password_reset"] is not None and f["hours_since_password_reset"] < 24:
        r.append({"code": "recent_password_reset", "detail": "password reset %d h ago" % f["hours_since_password_reset"]})
    if f["hours_since_mfa_change"] is not None and f["hours_since_mfa_change"] < 24:
        r.append({"code": "recent_mfa_change", "detail": "MFA changed %d h ago" % f["hours_since_mfa_change"]})
    if f["failed_logins_1h_before"]:
        r.append({"code": "failed_login_attempts", "detail": "%d failed logins in the hour before" % f["failed_logins_1h_before"]})
    if f["anonymizer"] is not None and f["anonymizer"] != "none_detected":
        r.append({"code": "anonymizer_network", "detail": "network: %s" % f["anonymizer"]})
    if f["country_seen_in_successful_logins"] is False:
        r.append({"code": "ip_country_unusual", "detail": "country not seen in earlier successful logins"})
    if f["hour_seen_in_successful_logins"] is False:
        r.append({"code": "off_hours", "detail": "login hour %s not seen in earlier logins" % f["login_hour_local"]})
    if f["seconds_login_to_transfer"] is not None and f["seconds_login_to_transfer"] < 60:
        r.append({"code": "login_to_transfer_fast", "detail": "%d s from login to transfer" % f["seconds_login_to_transfer"]})
    if f["thin_history"] is True:
        r.append({"code": "thin_history", "detail": "%d successful logins in history" % f["successful_logins_in_history"]})
    r.append({"code": "model_assessment", "detail": "takeover probability %.2f, reading: %s" % (p, label)})
    return r[-10:]


def decide_by_jev(request, facts, config, now, decision_id, api_key, url):
    """Returns {"escalate": False, "response"} or {"escalate": True, "reason", "jev"}."""
    started = time.monotonic()
    answer = ask_jev(request, facts, config, api_key, url)
    latency = max(0, int((time.monotonic() - started) * 1000))

    def info(p, label, conf, timed_out, error, reason):
        return {"probability": p, "label": label, "confidence": conf, "latency_ms": latency,
                "timed_out": timed_out, "error": error, "escalation_reason": reason}

    if not answer["ok"]:
        reason = "jev_timeout" if answer["timed_out"] else "jev_failed"
        return {"escalate": True, "reason": reason, "jev": info(None, None, None, answer["timed_out"], answer["error"], reason)}
    p, label, conf = answer["p"], answer["label"], answer["confidence"]
    if conf < config["escalate"]["min_label_confidence"]:
        return {"escalate": True, "reason": "low_confidence", "jev": info(p, label, conf, False, None, "low_confidence")}
    t = config["jev"]["thresholds"]
    if (p >= t["hold"] and label == "legitimate") or (p < t["step_up"] and label == "account_takeover"):
        return {"escalate": True, "reason": "conflict", "jev": info(p, label, conf, False, None, "conflict")}

    decision = band(p, config)
    expires = iso(now + timedelta(minutes=config["confirmation"]["timeout_minutes"]))
    score = int(math.floor(p * 100 + 0.5))
    reasons = reasons_from(facts, p, label)
    signals = ", ".join(x["code"] for x in reasons if x["code"] != "model_assessment") or "none"
    tx_id = get(request, "transaction", "transaction_id")
    response = {
        "schema_version": "1.0",
        "decision_id": decision_id,
        "transaction_id": tx_id if isinstance(tx_id, str) else "",
        "decided_at": iso(now),
        "decision": decision,
        "final": decision != "hold",
        "decided_by": "jev",
        "risk": {"score": score, "level": {"allow": "low", "step_up": "medium", "hold": "high"}[decision]},
        "classification": {"label": label, "confidence": conf, "takeover_probability": p, "recommended_decision": decision},
        "reasons": reasons,
        "actions": {"allow": ["execute"], "step_up": ["request_step_up"],
                    "hold": ["hold_transaction", "notify_owner_out_of_band"]}[decision],
        "explanation": {
            "customer": {
                "allow": "Transfer processed.",
                "step_up": "Please confirm this transfer once more to continue.",
                "hold": "For your safety this transfer is on hold. We will ask you to confirm it on your registered device.",
            }[decision],
            "analyst": ("Jev: takeover probability %.2f (score %d), reading %s with confidence %.2f -> %s. Signals: %s."
                        % (p, score, label, conf, decision, signals))[:800],
        },
        "latency_ms": latency,
        "model": {"provider": "typesafe", "name": config["jev"]["model"], "latency_ms": latency, "timed_out": False},
    }
    if decision == "step_up":
        response["step_up"] = {"channel": "in_app", "challenge_id": decision_id + "-challenge", "expires_at": expires}
    elif decision == "hold":
        response["hold"] = {"expires_at": expires, "on_timeout": "block", "confirmation_channel": "push"}
    return {"escalate": False, "response": response}


# ---- the run ----------------------------------------------------------------------------------------
def load_body(event):
    """(body_or_None, error_or_None) from the event's webhook wrapper."""
    payload = event.get("payload") if isinstance(event, dict) else None
    if not isinstance(payload, dict):
        return None, "event has no payload"
    if payload.get("_truncated") is True:
        return None, "payload truncated by Devin: the webhook body exceeded its size limit"
    body = payload.get("body")
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except ValueError:
            return None, "payload.body is not valid JSON"
    if not isinstance(body, dict):
        return None, "payload.body is not a JSON object"
    return body, None


def escalate_item(body, facts, reply_url, jev):
    tx_id = get(body, "transaction", "transaction_id")
    tx_id = tx_id if isinstance(tx_id, str) else ""
    return {"items": [{
        "id": tx_id,
        "title": "Nightwatch: decide %s" % tx_id,
        "facts": facts,
        "jev": jev,
        "reply_url": reply_url,
    }]}


def failure_jev(reason, error, timed_out=False):
    return {"probability": None, "label": None, "confidence": None, "latency_ms": 0,
            "timed_out": timed_out, "error": error, "escalation_reason": reason}


def deliver(response, reply_url, config):
    """POST the decision to the bank; returns None on success or a failure text."""
    try:
        status, _ = http_post_json(reply_url, response, {}, config["bank_post_timeout_s"])
    except Exception as e:  # noqa: BLE001
        return "%s: %s" % (type(e).__name__, e)
    if not 200 <= status < 300:
        return "bank answered HTTP %d" % status
    return None


def run(event, env, config=CONFIG, now=None):
    now = now or datetime.now(timezone.utc)
    reply_url = env.get("NIGHTWATCH_REPLY_URL") or config["reply_url"]
    jev_url = env.get("NIGHTWATCH_JEV_URL") or JEV_URL
    body, error = load_body(event)
    if body is None:
        return escalate_item({}, None, reply_url, failure_jev("jev_failed", error))

    decision_id = "dec_" + uuid.uuid4().hex[:16]
    fast = check_fast_path(body, config, now, decision_id)
    if fast["shortcut"]:
        response = fast["response"]
        why = response["reasons"][0]["detail"]
    else:
        try:
            facts = compute_facts(body, config)
        except Exception as e:  # noqa: BLE001
            return escalate_item(body, None, reply_url, failure_jev("jev_failed", "facts failed: %s" % e))
        result = decide_by_jev(body, facts, config, now, decision_id, env.get("TYPESAFE_API_KEY", ""), jev_url)
        if result["escalate"]:
            return escalate_item(body, facts, reply_url, result["jev"])
        response = result["response"]
        why = response["reasons"][-1]["detail"]

    failure = deliver(response, reply_url, config)
    reason = "%s: %s" % (response["decision"], why)
    if failure:
        reason += " (POST to the bank failed: %s)" % failure
    return {"run": False, "reason": reason}


def main():
    try:
        with open(os.environ["EVENT_FILE"], encoding="utf-8") as f:
            event = json.load(f)
    except Exception as e:  # noqa: BLE001
        event = {"_error": str(e)}
    try:
        out = run(event, os.environ)
    except Exception as e:  # noqa: BLE001 - never leave Devin without a decision
        out = {"run": False, "reason": "preflight crashed: %s: %s" % (type(e).__name__, e)}
    with open(os.environ["OUTPUT_FILE"], "w", encoding="utf-8") as f:
        json.dump(out, f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
