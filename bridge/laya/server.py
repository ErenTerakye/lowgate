"""
Serves a local Laya model over the System One HTTP shape, so the arena's
SystemOneClient talks to it like any hosted lane.

    python -m pip install -r bridge/laya/requirements.txt
    python bridge/laya/server.py                            # fine-tuned model if present
    python bridge/laya/server.py --model aac6fef/laya-mlx   # base model from Hugging Face

POST /v1/systemone  {model, state, questions}  ->  {model, answers, usage}
GET  /health        ->  {ok, model}

Listens on 127.0.0.1 only: it has no auth and is meant for recording runs
on this machine. The public site plays Laya from replays.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Protocol

MAX_BODY_BYTES = 64 * 1024
BASE_MODEL = "aac6fef/laya-mlx"
# Made by finetune_colab.ipynb and `laya-mlx convert` (docs/lanes.md); not in git. Newest first.
FINE_TUNED = [Path(__file__).parent / "models" / name for name in ("laya-descent-v4-mlx", "laya-descent-v3-mlx", "laya-descent-v2-mlx")]


class UnexpectedAnswer(Exception):
    """Laya answered, but not in a shape we can map to System One."""


class Agent(Protocol):
    def predict(self, state: str, questions: dict[str, Any]) -> dict[str, Any]: ...


def normalize_answer(question: dict[str, Any], answer: dict[str, Any]) -> dict[str, Any]:
    """
    Puts score probabilities in level order (a list, lowest first), whether
    Laya keys them by index or by the criterion text. Choice answers keep
    their option keys. Raises rather than guessing when no key matches.
    """
    probs = answer.get("probabilities")
    if question.get("type") != "score" or not isinstance(probs, dict):
        return answer
    criteria = list(question.get("criteria", []))
    ordered = []
    for i, text in enumerate(criteria):
        for key in (str(i), i, text):
            if key in probs:
                ordered.append(float(probs[key]))
                break
        else:
            raise UnexpectedAnswer(f"score answer has no probability for level {i}; keys were {list(probs)[:5]}")
    return {**answer, "probabilities": ordered}


def answer(agent: Agent, model: str, body: dict[str, Any]) -> dict[str, Any]:
    state = body.get("state")
    questions = body.get("questions")
    if not isinstance(state, str) or not state:
        raise ValueError("state must be a non-empty string")
    if not isinstance(questions, dict) or not questions:
        raise ValueError("questions must be a non-empty object")
    result = agent.predict(state, questions)
    answers = {qid: normalize_answer(questions[qid], a) for qid, a in result.get("answers", {}).items() if qid in questions}
    usage = result.get("usage") or {}
    return {
        "model": model,
        "answers": answers,
        # Local runs cost nothing; tokens are still reported when Laya gives them.
        "usage": {"input_tokens": int(usage.get("input_tokens", 0)), "output_tokens": 0},
    }


def make_handler(agent: Agent, model: str) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def _reply(self, status: int, payload: dict[str, Any], extra: dict[str, str] | None = None) -> None:
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            for key, value in (extra or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:
            if self.path == "/health":
                self._reply(200, {"ok": True, "model": model})
            else:
                self._reply(404, {"detail": "Not found"})

        def do_POST(self) -> None:
            if self.path != "/v1/systemone":
                self._reply(404, {"detail": "Not found"})
                return
            length = int(self.headers.get("content-length") or 0)
            if length <= 0 or length > MAX_BODY_BYTES:
                self._reply(400, {"detail": f"Body must be 1 to {MAX_BODY_BYTES} bytes"})
                return
            try:
                body = json.loads(self.rfile.read(length))
                started = time.perf_counter()
                payload = answer(agent, model, body)
                elapsed = (time.perf_counter() - started) * 1000
            except (ValueError, json.JSONDecodeError) as err:
                self._reply(400, {"detail": str(err)})
                return
            except UnexpectedAnswer as err:
                self._reply(502, {"detail": f"Laya answered in an unexpected shape: {err}"})
                return
            except Exception as err:  # noqa: BLE001 - any model failure becomes a 500 the lane can show
                self._reply(500, {"detail": f"Laya failed: {err}"})
                return
            self._reply(200, payload, {"x-upstream-ms": f"{elapsed:.3f}"})

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - stdlib signature
            pass

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", help=f"Hugging Face id or local path of an MLX checkpoint (default: the newest of {', '.join(p.name for p in FINE_TUNED)} present, else {BASE_MODEL})")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    import laya_mlx  # imported here so the tests run without MLX installed

    model = args.model or next((str(p) for p in FINE_TUNED if p.is_dir()), BASE_MODEL)
    # A local checkpoint is reported by its folder name, which is what the arena's catalog pins.
    served = Path(model).name if Path(model).is_dir() else model
    agent = laya_mlx.load(model)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(agent, served))
    print(f"Laya bridge serving {served} on http://127.0.0.1:{args.port}/v1/systemone")
    server.serve_forever()


if __name__ == "__main__":
    main()
