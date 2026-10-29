"""Bridge tests with a fake agent: python3 -m unittest discover bridge/laya"""

import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from server import UnexpectedAnswer, answer, make_handler, normalize_answer

QUESTIONS = {
    "rotate": {"type": "choice", "instructions": "?", "criteria": {"left": "L", "none": "H", "right": "R"}},
    "throttle": {"type": "score", "instructions": "?", "criteria": ["Off", "Low", "Medium", "High", "Full"]},
}


class FakeAgent:
    def predict(self, state, questions):
        return {
            "answers": {
                "rotate": {"choice": "none", "probabilities": {"left": 0.1, "none": 0.8, "right": 0.1}},
                # Keyed by criterion text, the shape we are least sure of.
                "throttle": {"score": 2.1, "probabilities": {"Off": 0.05, "Low": 0.1, "Medium": 0.6, "High": 0.2, "Full": 0.05}},
            },
            "usage": {"input_tokens": 412},
        }


class NormalizeTest(unittest.TestCase):
    def test_orders_score_probabilities_by_level(self):
        for probs in ({"0": 0.1, "1": 0.9}, {0: 0.1, 1: 0.9}, {"Off": 0.1, "On": 0.9}):
            out = normalize_answer({"type": "score", "criteria": ["Off", "On"]}, {"probabilities": probs})
            self.assertEqual(out["probabilities"], [0.1, 0.9])

    def test_raises_when_no_key_matches(self):
        with self.assertRaises(UnexpectedAnswer):
            normalize_answer({"type": "score", "criteria": ["Off. Long text", "On"]}, {"probabilities": {"Off": 0.1, "On": 0.9}})

    def test_leaves_choice_answers_alone(self):
        a = {"probabilities": {"left": 1.0}}
        self.assertIs(normalize_answer(QUESTIONS["rotate"], a), a)

    def test_rejects_missing_state(self):
        with self.assertRaises(ValueError):
            answer(FakeAgent(), "m", {"questions": QUESTIONS})


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(FakeAgent(), "laya-test"))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def post(self, body):
        req = urllib.request.Request(f"{self.url}/v1/systemone", data=json.dumps(body).encode(), headers={"content-type": "application/json"})
        return urllib.request.urlopen(req)

    def test_answers_in_system_one_shape(self):
        with self.post({"model": "ignored", "state": "altitude: 40 m", "questions": QUESTIONS}) as res:
            body = json.loads(res.read())
            upstream_ms = float(res.headers["x-upstream-ms"])
        self.assertEqual(body["model"], "laya-test")
        self.assertEqual(body["answers"]["throttle"]["probabilities"], [0.05, 0.1, 0.6, 0.2, 0.05])
        self.assertEqual(body["usage"], {"input_tokens": 412, "output_tokens": 0})
        self.assertGreaterEqual(upstream_ms, 0)

    def test_bad_body_is_400(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.post({"state": "", "questions": QUESTIONS})
        self.assertEqual(ctx.exception.code, 400)
        ctx.exception.close()


if __name__ == "__main__":
    unittest.main()
