import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import compare
import compare_multi as multi
import run


class CompareMultiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.questions = run.read_json(run.ROOT / "questions" / "behavior-anomalies.json")

    def test_payloads_share_evidence_and_use_the_same_questions(self):
        _, state, expected = multi.load_cases(self.questions, ["combined-signals"])[0]
        for count in (3, 5):
            questions = dict(list(self.questions.items())[:count])
            strategies = multi.strategies_for(state, questions, multi.OPENAI_MODELS, "none")
            self.assertEqual(strategies["Jev"][0]["state"], state)
            self.assertEqual(strategies["Jev"][0]["questions"], questions)
            self.assertTrue(all(expected[key] == "yes" for key in questions))
            for model in multi.OPENAI_MODELS:
                for mode, calls in (("batch", 1), ("parallel", count)):
                    payloads = strategies[f"{model} {mode}"]
                    self.assertEqual(len(payloads), calls)
                    ids = []
                    for payload in payloads:
                        self.assertEqual(json.loads(payload["input"]), state)
                        self.assertEqual(payload["reasoning"], {"effort": "none"})
                        schema = payload["text"]["format"]["schema"]
                        ids.extend(schema["properties"]["answers"]["required"])
                    self.assertEqual(ids, list(questions))

    def test_single_signal_cases_flip_only_the_claim_under_test(self):
        cases = {name: (state, expected) for name, state, expected in multi.load_cases(self.questions, [])}
        baseline, _ = cases["routine"]
        controls = {
            "rapid-country-change": ("geo", "rapid_ip_country_change"),
            "unusual-hour": ("time", "unusual_login_hour"),
            "new-device": ("device", "new_login_device"),
            "password-reset": ("credentials", "recent_credential_change"),
            "mfa-change": ("credentials", "recent_credential_change"),
            "failure-burst": ("failures", "failed_login_burst"),
        }
        for name, (group, signal) in controls.items():
            state, expected = cases[name]
            self.assertEqual([key for key in state if state[key] != baseline[key]], [group])
            self.assertEqual(expected, dict.fromkeys(self.questions, "no") | {signal: "yes"})
        self.assertEqual(set(cases["missing-telemetry"][1].values()), {"unknown"})

    def test_probability_bands_and_invalid_responses(self):
        for score, expected in ((0.30, "no"), (0.31, "unknown"), (0.69, "unknown"), (0.70, "yes")):
            self.assertEqual(multi.observation(score), expected)
        keys = {"device", "time"}
        device = {"type": "noul", "noul": 0.1}
        with self.assertRaisesRegex(ValueError, "answer IDs"):
            multi.scores_from({"answers": {"device": device}}, keys)
        with self.assertRaisesRegex(ValueError, "Invalid Noul"):
            multi.scores_from({"answers": {"device": device, "time": {"type": "noul", "noul": True}}}, keys)
        self.assertEqual(multi.scores_from({"answers": {"device": device}}, {"device"}), {"device": 0.1})

    def test_incomplete_parallel_transaction_keeps_partial_scores_and_usage(self):
        response = {
            "model": "gpt-6-luna",
            "status": "completed",
            "service_tier": "default",
            "output": [{
                "type": "message",
                "content": [{
                    "type": "output_text",
                    "text": json.dumps({"answers": {"new_login_device": {"type": "noul", "noul": 0.93}}}),
                }],
            }],
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
        questions = {key: self.questions[key] for key in ("new_login_device", "unusual_login_hour")}
        expected = {"new_login_device": "yes", "unusual_login_hour": "no"}
        payloads = multi.strategies_for({}, questions, ["gpt-6-luna"], "none")["gpt-6-luna parallel"]
        with patch.object(run, "request_json", return_value=response), ThreadPoolExecutor(max_workers=2) as pool:
            result = multi.measure_transaction(
                lambda payload: multi.measure_call("openai", payload, "test-key", 1),
                payloads, expected, pool,
            )
        self.assertFalse(result["complete"])
        self.assertEqual(result["observed"], {"new_login_device": "yes"})
        summary = multi.summarize([{"expected": expected, "results": {"parallel": result}}], ["parallel"])
        self.assertEqual(summary["parallel"]["priced_calls"], 2)
        self.assertEqual(summary["parallel"]["missing_answers"], 1)
        self.assertEqual(summary["parallel"]["correct"], 1)
        self.assertIsNone(summary["parallel"]["paired_latency_ms"])

    def test_legacy_openai_decoder_still_returns_one_probability(self):
        answer = {"answers": {run.QUESTION_ID: {"type": "noul", "noul": 0.25}}}
        response = {"status": "completed", "output": [{
            "type": "message", "content": [{"type": "output_text", "text": json.dumps(answer)}],
        }]}
        self.assertEqual(compare.openai_probability(response), 0.25)

    def test_openai_decoder_validates_final_answer_after_commentary(self):
        response = {"status": "completed", "output": [
            {"type": "message", "phase": "commentary", "content": [
                {"type": "output_text", "text": "Checking the recorded device age."},
            ]},
            {"type": "message", "phase": "final_answer", "content": [
                {"type": "output_text", "text": '{"answers":{"new_login_device":{"type":"noul","noul":0.95}}}'},
            ]},
        ]}
        self.assertEqual(multi.scores_from(compare.openai_answers(response), {"new_login_device"}),
                         {"new_login_device": 0.95})


if __name__ == "__main__":
    unittest.main()
