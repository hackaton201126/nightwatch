"""Runs preflight/nightwatch_preflight.py as Devin does, with Jev and the bank faked by a local HTTP server."""
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRIPT = os.path.join(HERE, "nightwatch_preflight.py")
SCHEMA = json.load(open(os.path.join(ROOT, "docs", "nightwatch-risk-response.schema.json")))


def example(name):
    return json.load(open(os.path.join(ROOT, "docs", "examples", name + ".json")))


# ---- minimal JSON-schema check (draft-07 subset the response schema uses) ----------------------
def validate(value, schema, root=SCHEMA, path="$"):
    errs = []
    if "$ref" in schema:
        node = root
        for part in schema["$ref"].lstrip("#/").split("/"):
            node = node[part]
        return validate(value, node, root, path)
    if "const" in schema and value != schema["const"]:
        errs.append("%s: not const %r" % (path, schema["const"]))
    if "enum" in schema and value not in schema["enum"]:
        errs.append("%s: %r not in enum" % (path, value))
    t = schema.get("type")
    if t:
        types = t if isinstance(t, list) else [t]
        pymap = {"string": str, "integer": int, "number": (int, float), "boolean": bool,
                 "object": dict, "array": list, "null": type(None)}
        ok = any(isinstance(value, pymap[x]) and not (isinstance(value, bool) and x in ("integer", "number")) for x in types)
        if not ok:
            return errs + ["%s: %r is not %s" % (path, value, t)]
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errs.append("%s: below minimum" % path)
        if "maximum" in schema and value > schema["maximum"]:
            errs.append("%s: above maximum" % path)
    if isinstance(value, str):
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            errs.append("%s: too long" % path)
        if schema.get("format") == "date-time" and not re.match(r"^\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:\d\d)$", value):
            errs.append("%s: bad date-time" % path)
    if isinstance(value, list):
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errs.append("%s: too many items" % path)
        if schema.get("uniqueItems") and len({json.dumps(v, sort_keys=True) for v in value}) != len(value):
            errs.append("%s: items not unique" % path)
        if "items" in schema:
            for i, v in enumerate(value):
                errs += validate(v, schema["items"], root, "%s[%d]" % (path, i))
    if isinstance(value, dict):
        for k in schema.get("required", []):
            if k not in value:
                errs.append("%s: missing %s" % (path, k))
        props = schema.get("properties", {})
        for k, v in value.items():
            if k in props:
                errs += validate(v, props[k], root, "%s.%s" % (path, k))
            elif schema.get("additionalProperties") is False:
                errs.append("%s: unexpected %s" % (path, k))
    for sub in schema.get("allOf", []):
        errs += validate(value, sub, root, path)
    if "anyOf" in schema and not any(not validate(value, s, root, path) for s in schema["anyOf"]):
        errs.append("%s: matches no anyOf" % path)
    if "if" in schema and not validate(value, schema["if"], root, path):
        errs += validate(value, schema.get("then", {}), root, path)
    return errs


# ---- fake Jev + bank ------------------------------------------------------------------------------
class Fake:
    def __init__(self):
        self.jev_calls, self.bank_posts = [], []
        self.jev_status, self.jev_body, self.jev_delay = 200, None, 0
        self.bank_status = 200
        self.devin_calls = []  # (method, path, body, authorization)
        self.devin_create_status = 200
        self.devin_output = None  # structured_output returned by GET; None = never answers
        self.devin_get_delay = 0
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def reply(self, status, out):
                try:
                    data = json.dumps(out).encode()
                    self.send_response(status)
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                except OSError:
                    pass

            def devin(self, body):
                fake.devin_calls.append((self.command, self.path, body, self.headers.get("Authorization")))
                if self.command == "POST":
                    return self.reply(fake.devin_create_status, {"session_id": "devin-s1"} if fake.devin_create_status < 300 else {"error": "no"})
                if self.command == "GET":
                    time.sleep(fake.devin_get_delay)
                    return self.reply(200, {"session_id": "devin-s1", "status": "running", "structured_output": fake.devin_output})
                self.reply(200, {})

            def do_GET(self):
                self.devin(None)

            def do_DELETE(self):
                self.devin(None)

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                if self.path.startswith("/v3/"):
                    return self.devin(body)
                if self.path == "/jev":
                    fake.jev_calls.append((body, self.headers.get("Authorization")))
                    time.sleep(fake.jev_delay)
                    status, out = fake.jev_status, fake.jev_body
                else:
                    fake.bank_posts.append(body)
                    status, out = fake.bank_status, {"ok": True}
                try:
                    data = json.dumps(out).encode() if not isinstance(out, bytes) else out
                    self.send_response(status)
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                except OSError:
                    pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.server.daemon_threads = True
        self.base = "http://127.0.0.1:%d" % self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def jev_says(self, p, label, conf):
        self.jev_body = {"answers": {"takeover": {"noul": p}, "pattern": {"choice": label, "confidence": conf}}}


class PreflightCase(unittest.TestCase):
    def setUp(self):
        self.fake = Fake()
        self.addCleanup(self.fake.server.shutdown)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def run_script(self, event, jev_url=None, reply_url=None, devin_url=None, devin_key="devin-key"):
        ev, out = os.path.join(self.tmp.name, "event.json"), os.path.join(self.tmp.name, "out.json")
        json.dump(event, open(ev, "w"))
        if os.path.exists(out):
            os.remove(out)
        env = dict(os.environ, EVENT_FILE=ev, OUTPUT_FILE=out, TYPESAFE_API_KEY="test-key",
                   DEVIN_API_KEY=devin_key, DEVIN_ORG_ID="org1", DEVIN_API_URL=devin_url or self.fake.base,
                   NIGHTWATCH_DEVIN_TIMEOUT_S="3", NIGHTWATCH_DEVIN_POLL_S="0.2",
                   NIGHTWATCH_JEV_URL=jev_url or self.fake.base + "/jev",
                   NIGHTWATCH_REPLY_URL=reply_url or self.fake.base + "/reply")
        started = time.monotonic()
        proc = subprocess.run([sys.executable, SCRIPT], env=env, capture_output=True, text=True, timeout=20)
        self.elapsed = time.monotonic() - started
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = json.load(open(out))
        self.assertEqual(set(result), {"run", "reason"}, result)
        self.assertIs(result["run"], False)
        return result

    def event(self, body, **payload):
        return {"event_type": "webhook", "source": "nightwatch", "received_at": "2026-11-21T02:00:21+04:00",
                "payload": dict({"body": body, "method": "POST", "_truncated": False}, **payload)}

    def assert_posts_valid(self):
        for p in self.fake.bank_posts:
            self.assertEqual(validate(p, SCHEMA), [], p)


def small_body(**session):
    body = example("jev-normal")["state"]["request"]
    body["transaction"]["amount_policy_minor"] = 8500
    body["transaction"]["amount"]["minor_units"] = 8500
    body["session"].update(session)
    return body


class ShortcutTests(PreflightCase):
    def test_small_transfer_allowed_without_jev(self):
        out = self.run_script(self.event(small_body()))
        self.assertIs(out["run"], False)
        self.assertTrue(out["reason"].startswith("allow:"), out)
        self.assertEqual(self.fake.jev_calls, [])
        self.assertEqual(len(self.fake.bank_posts), 1)
        self.assertEqual(self.fake.bank_posts[0]["decided_by"], "fast_path")
        self.assertEqual(self.fake.bank_posts[0]["decision"], "allow")
        self.assert_posts_valid()

    def test_body_as_json_string(self):
        out = self.run_script(self.event(json.dumps(small_body())))
        self.assertTrue(out["reason"].startswith("allow:"), out)

    def stopped(self, body):
        self.fake.jev_says(0.05, "legitimate", 0.9)
        out = self.run_script(self.event(body))
        self.assertEqual(len(self.fake.jev_calls), 1, "Jev must be asked when the shortcut is stopped")
        self.assertEqual(self.fake.bank_posts[-1]["decided_by"], "jev")
        return out

    def test_stoppers_block_shortcut(self):
        cases = {
            "new device": small_body(device_first_seen_at="2026-11-21T01:00:00+04:00"),
            "password reset": small_body(last_password_reset_at="2026-11-21T00:00:00+04:00"),
            "tor": small_body(network={"ip_ref": "x", "ip_country": "AE", "anonymizer": "tor"}),
        }
        failed = small_body()
        auth = "2026-11-21T13:01:00+04:00"
        failed["history"]["recent_login_attempts"] += [
            {"occurred_at": "2026-11-21T12:%02d:00+04:00" % m, "outcome": "failure", "device_id": "d",
             "network": {"ip_ref": "x", "ip_country": "AE", "anonymizer": "none_detected"}} for m in (30, 40, 50)]
        self.assertEqual(failed["session"]["authenticated_at"], auth)
        cases["3 failed logins"] = failed
        for name, body in cases.items():
            with self.subTest(name):
                self.fake.jev_calls.clear()
                self.stopped(body)

    def test_over_24h_cap_blocks_shortcut(self):
        body = small_body()
        body["history"]["windows"]["24h"] = {"attempted_count": 1, "attempted_amount_policy_minor": 1_995_000}
        self.stopped(body)


class JevTests(PreflightCase):
    def test_attack_is_held(self):
        self.fake.jev_says(0.65, "account_takeover", 0.6)
        body = example("jev-attack")["state"]["request"]
        out = self.run_script(self.event(body))
        self.assertIs(out["run"], False)
        self.assertTrue(out["reason"].startswith("hold:"), out)
        post = self.fake.bank_posts[0]
        self.assertEqual((post["decision"], post["decided_by"], post["final"]), ("hold", "jev", False))
        self.assertEqual(post["transaction_id"], "tx_5501")
        self.assert_posts_valid()

    def test_normal_login_allowed_by_jev(self):
        self.fake.jev_says(0.05, "legitimate", 0.91)
        body = example("jev-normal")["state"]["request"]
        out = self.run_script(self.event(body))
        self.assertTrue(out["reason"].startswith("allow:"), out)
        self.assertEqual(self.fake.bank_posts[0]["decided_by"], "jev")
        self.assert_posts_valid()

    def test_step_up_band_is_valid(self):
        self.fake.jev_says(0.4, "uncertain", 0.7)
        out = self.run_script(self.event(example("jev-attack")["state"]["request"]))
        self.assertTrue(out["reason"].startswith("step_up:"), out)
        self.assertIn("step_up", self.fake.bank_posts[0])
        self.assert_posts_valid()

    def test_request_to_jev(self):
        self.fake.jev_says(0.05, "legitimate", 0.91)
        ex = example("jev-attack")
        self.run_script(self.event(ex["state"]["request"]))
        sent, auth = self.fake.jev_calls[0]
        self.assertEqual(auth, "Bearer test-key")
        self.assertEqual(sent["model"], ex["model"])
        self.assertEqual(sent["questions"], ex["questions"])
        self.assertEqual(sent["state"]["request"], ex["state"]["request"])
        self.assertEqual(set(sent["state"]["facts"]), set(ex["state"]["facts"]))
        f = sent["state"]["facts"]
        self.assertEqual((f["device_age_minutes"], f["anonymizer"], f["login_hour_local"], f["seconds_login_to_transfer"]),
                         (2, "vpn", 2, 20))
        self.assertIs(f["hour_seen_in_successful_logins"], False)
        self.assertIs(f["country_seen_in_successful_logins"], True)

    def test_facts_exclude_current_login_and_thin_history(self):
        self.fake.jev_says(0.05, "legitimate", 0.91)
        body = example("jev-attack")["state"]["request"]
        # the only 02:xx success is the current login itself: must not count as "hour seen"
        self.run_script(self.event(body))
        f = self.fake.jev_calls[0][0]["state"]["facts"]
        n = sum(1 for a in body["history"]["recent_login_attempts"] if a["outcome"] == "success")
        self.assertEqual(f["successful_logins_in_history"], n - 1)
        self.assertIs(f["hour_seen_in_successful_logins"], False)
        # thin history: current login plus 2 older successes
        body["history"]["recent_login_attempts"] = body["history"]["recent_login_attempts"][:3]
        self.run_script(self.event(body))
        f = self.fake.jev_calls[1][0]["state"]["facts"]
        self.assertEqual((f["successful_logins_in_history"], f["thin_history"]), (2, True))
        self.assertIsNone(f["country_seen_in_successful_logins"])
        self.assertIsNone(f["hour_seen_in_successful_logins"])


def verdict(**over):
    v = {"decision": "hold", "label": "account_takeover", "confidence": 0.8, "takeover_probability": 0.75,
         "reasons": ["new_device", "ip_country_unusual"], "customer_explanation": "We paused this transfer.",
         "analyst_explanation": "New device and an unseen country."}
    v.update(over)
    return v


class DevinTests(PreflightCase):
    def setUp(self):
        super().setUp()
        self.body = example("jev-attack")["state"]["request"]
        self.fake.jev_says(0.5, "uncertain", 0.4)  # low confidence: Jev is unsure

    def only_post(self):
        self.assertEqual(len(self.fake.bank_posts), 1)
        self.assert_posts_valid()
        return self.fake.bank_posts[0]

    def methods(self):
        return [c[0] for c in self.fake.devin_calls]

    def test_session_created_polled_and_deleted(self):
        self.fake.devin_output = verdict()
        out = self.run_script(self.event(self.body))
        self.assertTrue(out["reason"].startswith("hold:"), out)
        self.assertEqual(self.methods()[0], "POST")
        self.assertIn("GET", self.methods())
        self.assertEqual(self.methods()[-1], "DELETE")
        method, path, create, auth = self.fake.devin_calls[0]
        self.assertEqual((path, auth), ("/v3/organizations/org1/sessions", "Bearer devin-key"))
        self.assertEqual(create["structured_output_required"], True)
        self.assertEqual((create["devin_mode"], create["max_acu_limit"]), ("fast", 1))
        self.assertEqual((create["resumable"], create["memory_enabled"]), (False, False))
        self.assertEqual(create["tags"], ["nightwatch", "tx_5501"])
        schema = create["structured_output_schema"]
        self.assertEqual(schema["$schema"], "http://json-schema.org/draft-07/schema#")
        self.assertEqual(schema["type"], "object")
        self.assertEqual(sorted(schema["required"]), sorted(schema["properties"]))
        self.assertEqual(len(schema["required"]), 7)
        self.assertNotIn("$ref", json.dumps(schema))
        self.assertEqual(self.fake.devin_calls[-1][1], "/v3/organizations/org1/sessions/devin-s1")

    def test_prompt_carries_request_facts_and_jev_answer(self):
        self.fake.devin_output = verdict()
        self.run_script(self.event(self.body))
        prompt = self.fake.devin_calls[0][2]["prompt"]
        self.assertIn(json.dumps(self.body, indent=2), prompt)
        self.assertIn('"thin_history"', prompt)
        self.assertIn('"escalation_reason": "low_confidence"', prompt)
        self.assertIn("never answer block", prompt.lower())

    def test_hold_verdict_reaches_bank(self):
        self.fake.devin_output = verdict()
        self.run_script(self.event(self.body))
        post = self.only_post()
        self.assertEqual((post["decision"], post["decided_by"], post["final"]), ("hold", "devin", False))
        self.assertEqual(post["model"]["provider"], "devin")
        self.assertEqual(post["classification"], {"label": "account_takeover", "confidence": 0.8,
                                                  "takeover_probability": 0.75, "recommended_decision": "hold"})
        self.assertEqual([r["code"] for r in post["reasons"]], ["new_device", "ip_country_unusual"])
        self.assertEqual(post["risk"], {"score": 75, "level": "high"})
        decided = time.mktime(time.strptime(post["decided_at"][:19], "%Y-%m-%dT%H:%M:%S"))
        expires = time.mktime(time.strptime(post["hold"]["expires_at"][:19], "%Y-%m-%dT%H:%M:%S"))
        self.assertEqual(expires - decided, 15 * 60)

    def test_step_up_verdict_reaches_bank(self):
        self.fake.devin_output = verdict(decision="step_up", label="uncertain", takeover_probability=0.4)
        out = self.run_script(self.event(self.body))
        self.assertTrue(out["reason"].startswith("step_up:"), out)
        post = self.only_post()
        self.assertEqual((post["decision"], post["decided_by"], post["final"]), ("step_up", "devin", True))
        self.assertEqual(post["step_up"]["channel"], "in_app")
        self.assertNotIn("hold", post)

    def test_no_answer_in_time_falls_back_to_hold(self):
        out = self.run_script(self.event(self.body))
        self.assertTrue(out["reason"].startswith("hold:"), out)
        post = self.only_post()
        self.assertEqual((post["decision"], post["decided_by"], post["final"]), ("hold", "fallback", False))
        self.assertIn("no verdict", post["explanation"]["analyst"])
        self.assertEqual(self.methods()[-1], "DELETE")
        self.assertLess(self.elapsed, 3 + 5)

    def test_invalid_verdicts_fall_back_to_hold(self):
        bad = {
            "block": verdict(decision="block"),
            "unknown reason": verdict(reasons=["telepathy"]),
            "probability out of range": verdict(takeover_probability=1.5),
            "missing field": {k: v for k, v in verdict().items() if k != "label"},
        }
        for name, v in bad.items():
            with self.subTest(name):
                self.fake.devin_calls.clear()
                self.fake.bank_posts.clear()
                self.fake.devin_output = v
                self.run_script(self.event(self.body))
                post = self.only_post()
                self.assertEqual((post["decision"], post["decided_by"]), ("hold", "fallback"))
                self.assertIn("invalid verdict", post["explanation"]["analyst"])
                self.assertEqual(self.methods()[-1], "DELETE")

    def test_create_refused_falls_back_and_states_failure(self):
        self.fake.devin_create_status = 500
        self.run_script(self.event(self.body))
        post = self.only_post()
        self.assertEqual((post["decision"], post["decided_by"]), ("hold", "fallback"))
        self.assertIn("HTTP 500", post["explanation"]["analyst"])
        self.assertEqual(self.methods(), ["POST"])

    def test_devin_unreachable_and_unconfigured(self):
        out = self.run_script(self.event(self.body), devin_url="http://127.0.0.1:1")
        self.assertTrue(out["reason"].startswith("hold:"), out)
        self.assertEqual(self.only_post()["decided_by"], "fallback")
        self.fake.bank_posts.clear()
        self.run_script(self.event(self.body), devin_key="")
        post = self.only_post()
        self.assertIn("DEVIN_API_KEY", post["explanation"]["analyst"])
        self.assertEqual(self.fake.devin_calls, [])

    def test_jev_failures_go_to_devin(self):
        self.fake.devin_output = verdict(decision="allow", label="legitimate", takeover_probability=0.05)
        self.fake.jev_status, self.fake.jev_body = 500, {"error": "x"}
        self.run_script(self.event(self.body))
        self.assertEqual(self.only_post()["decided_by"], "devin")
        self.assertIn('"escalation_reason": "jev_failed"', self.fake.devin_calls[0][2]["prompt"])

    def test_jev_timeout_then_devin_timeout_stays_in_budget(self):
        self.fake.jev_delay = 4
        self.fake.devin_get_delay = 30
        self.run_script(self.event(self.body))
        self.assertEqual(self.only_post()["decided_by"], "fallback")
        self.assertLess(self.elapsed, 2 + 3 + 5 + 4)

    def test_unreadable_body_holds_without_devin(self):
        out = self.run_script(self.event(self.body, _truncated=True))
        self.assertIn("truncat", out["reason"])
        post = self.only_post()
        self.assertEqual((post["decision"], post["decided_by"]), ("hold", "fallback"))
        self.assertEqual((self.fake.jev_calls, self.fake.devin_calls), ([], []))

    def test_clear_cases_do_not_call_devin(self):
        self.run_script(self.event(small_body()))
        self.fake.jev_says(0.05, "legitimate", 0.9)
        self.run_script(self.event(self.body))
        self.fake.jev_says(0.7, "account_takeover", 0.9)
        self.run_script(self.event(self.body))
        self.assertEqual(len(self.fake.bank_posts), 3)
        self.assertEqual(self.fake.devin_calls, [])


class BankFailureTests(PreflightCase):
    def test_bank_refuses(self):
        out = self.run_script(self.event(small_body()), reply_url="http://127.0.0.1:1/reply")
        self.assertIs(out["run"], False)
        self.assertTrue(out["reason"].startswith("allow:"), out)
        self.assertIn("failed", out["reason"])

    def test_bank_non_2xx(self):
        self.fake.bank_status = 503
        out = self.run_script(self.event(small_body()))
        self.assertIs(out["run"], False)
        self.assertIn("503", out["reason"])


if __name__ == "__main__":
    unittest.main()
