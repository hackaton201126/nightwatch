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
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
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

    def run_script(self, event, jev_url=None, reply_url=None):
        ev, out = os.path.join(self.tmp.name, "event.json"), os.path.join(self.tmp.name, "out.json")
        json.dump(event, open(ev, "w"))
        if os.path.exists(out):
            os.remove(out)
        env = dict(os.environ, EVENT_FILE=ev, OUTPUT_FILE=out, TYPESAFE_API_KEY="test-key",
                   NIGHTWATCH_JEV_URL=jev_url or self.fake.base + "/jev",
                   NIGHTWATCH_REPLY_URL=reply_url or self.fake.base + "/reply")
        started = time.monotonic()
        proc = subprocess.run([sys.executable, SCRIPT], env=env, capture_output=True, text=True, timeout=20)
        self.elapsed = time.monotonic() - started
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.load(open(out))

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


class EscalationTests(PreflightCase):
    def escalated(self, out, reason):
        self.assertEqual(list(out), ["items"], out)
        (item,) = out["items"]
        self.assertEqual(item["id"], "tx_5501")
        self.assertEqual(item["title"], "Nightwatch: decide tx_5501")
        self.assertEqual(item["reply_url"], self.fake.base + "/reply")
        self.assertEqual(item["jev"]["escalation_reason"], reason)
        self.assertEqual(self.fake.bank_posts, [])
        return item

    def test_unsure_cases(self):
        body = example("jev-attack")["state"]["request"]
        for name, args, reason in [
            ("low confidence", (0.5, "uncertain", 0.4), "low_confidence"),
            ("legitimate yet high", (0.7, "legitimate", 0.9), "conflict"),
            ("takeover yet low", (0.1, "account_takeover", 0.9), "conflict"),
        ]:
            with self.subTest(name):
                self.fake.jev_says(*args)
                item = self.escalated(self.run_script(self.event(body)), reason)["jev"]
                self.assertEqual((item["probability"], item["label"], item["confidence"]), args)
        self.assertIsNotNone(self.run_script(self.event(body))["items"][0]["facts"])

    def test_jev_refused(self):
        item = self.escalated(self.run_script(self.event(example("jev-attack")["state"]["request"]),
                                              jev_url="http://127.0.0.1:1/jev"), "jev_failed")
        self.assertIsNotNone(item["jev"]["error"])

    def test_jev_non_2xx_and_malformed(self):
        body = example("jev-attack")["state"]["request"]
        self.fake.jev_status, self.fake.jev_body = 500, {"error": "x"}
        self.escalated(self.run_script(self.event(body)), "jev_failed")
        self.fake.jev_status, self.fake.jev_body = 200, {"answers": {"takeover": {"noul": 7}}}
        self.escalated(self.run_script(self.event(body)), "jev_failed")

    def test_jev_timeout_within_budget(self):
        self.fake.jev_says(0.05, "legitimate", 0.9)
        self.fake.jev_delay = 4
        item = self.escalated(self.run_script(self.event(example("jev-attack")["state"]["request"])), "jev_timeout")
        self.assertIs(item["jev"]["timed_out"], True)
        self.assertLess(self.elapsed, 10)

    def test_truncated_payload(self):
        out = self.run_script(self.event(example("jev-attack")["state"]["request"], _truncated=True))
        self.assertEqual(len(out["items"]), 1)
        self.assertEqual(out["items"][0]["jev"]["escalation_reason"], "jev_failed")
        self.assertIn("truncat", out["items"][0]["jev"]["error"])
        self.assertEqual((self.fake.jev_calls, self.fake.bank_posts), ([], []))


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
