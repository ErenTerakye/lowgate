#!/usr/bin/env python3
"""Stages the Laya v4 release and records its hashes. Uploads nothing.

  python3 bridge/laya/prepare_release.py                          build bridge/laya/release/ and the manifest
  python3 bridge/laya/prepare_release.py --verify                 check the staged files against the manifest
  python3 bridge/laya/prepare_release.py --published REPO REV     record where the release was uploaded

The manifest (repro/laya-descent-v4-release.json) is committed; the 1.7 GB of model files are not. Standard library only.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LAYA = ROOT / "bridge/laya"
STAGE = LAYA / "release"
MANIFEST = ROOT / "repro/laya-descent-v4-release.json"
# TypeScript ships the unmodified Apache-2.0 text, which the release must carry with it.
APACHE = ROOT / "node_modules/typescript/LICENSE"

SOURCES = {
    "torch": LAYA / "models/laya-descent-v4",
    "mlx": LAYA / "models/laya-descent-v4-mlx",
    "data/f3-dagger1": LAYA / "data/f3-dagger1",
}

BASE_REVISION = "7b928d828b7b0e022f929d9bd2e44165aa270148"

PROVENANCE = {
    "base": {
        "repo": "convaiinnovations/laya",
        "revision": BASE_REVISION,
        "license": "apache-2.0",
        "revisionNote": "The newest revision on the Hub when v4 was trained (2026-10-30); the download was not pinned at the time.",
    },
    "encoderConfig": "answerdotai/ModernBERT-large (apache-2.0), as named by torch/rl_agent_config.json",
    "dataset": {
        "files": "data/f3-dagger1/",
        "split": "train: courses 1000-1119 autopilot states plus 3000-3029 DAgger states; eval: courses 9000-9011",
        "features": "prompt f3",
        "build": ["pnpm laya-dataset --prompt f3", "pnpm laya-dagger (flies the v3 checkpoint; the published train.jsonl removes the need to)"],
    },
    "training": {
        "notebook": "bridge/laya/finetune_colab.ipynb",
        "laya": "0.4.17",
        "hardware": "Google Colab A100",
        "seed": 42,
        "report": "torch/train_report.json",
        "reportCaveat": "2 of the 2,728 eval items overlap training, so laya labels the run overlapping_eval rather than strictly held out.",
    },
    "benchmarkBuild": {
        "files": "mlx/",
        "convert": "laya-mlx convert --model <torch> --output <mlx>",
        "environment": "M3 MacBook Pro, 16 GB; laya-mlx 0.6.0, mlx 0.32.4, Node v24.21.0",
    },
    "results": {
        "engine": "descent-3",
        "recordings": "bench/laya/5001.json to 5020.json",
        "firstCommitted": "a5915e8",
        "command": "pnpm bench --check",
        "landed": "142/160",
    },
    "crossBuildCheck": {
        "notebook": "bridge/laya/repro_colab.ipynb",
        "report": "repro/laya-torch-g4.json",
        "commit": "d7c6a54",
        "command": "pnpm agree --lane laya --courses 5001-5020 --label torch-g4",
        "samePick": "5795/5801",
    },
}

CARD = """---
license: apache-2.0
library_name: laya
base_model: convaiinnovations/laya
tags: [laya, system-one, decision-model, imitation-learning, benchmark-artifact]
---

# laya-descent-v4

The Laya checkpoint flown in the [Low Gate](https://github.com/ErenTerakye/lowgate) lunar-lander benchmark, fine-tuned from
[`convaiinnovations/laya`](https://huggingface.co/convaiinnovations/laya) at revision `{revision}` to copy a hand-written
autopilot. It is a benchmark artifact for one game and its prompt, not a general-purpose model.

| Path | Contents |
| --- | --- |
| `torch/` | PyTorch checkpoint and the original `train_report.json` |
| `mlx/` | The MLX conversion that flew the benchmark |
| `data/f3-dagger1/` | Training and evaluation data for this checkpoint |
| `SHA256SUMS` | A hash for every file above |

**Results.** Landed 142 of 160 benchmark levels on courses 5001-5020, none used in tuning or training. The PyTorch build picked
the same manoeuvre as the MLX build at 5,795 of 5,801 recorded states.

**Caveats.** 2 of the 2,728 evaluation items overlap training, so the training report labels the run `overlapping_eval`. The
cross-build check is open loop: it compares answers at recorded states and does not fly new courses.

**Licence.** Apache-2.0, as is the base model. This is a modified version: the weights were fine-tuned with `laya` 0.4.17 and
temperatures refitted. See `NOTICE`.
"""

NOTICE = """laya-descent-v4
Derived from convaiinnovations/laya (Apache-2.0), revision {revision}; encoder architecture answerdotai/ModernBERT-large (Apache-2.0).
Modifications: weights fine-tuned on Low Gate lander data and calibration temperatures refitted; mlx/ converted with laya-mlx.
"""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def staged_files() -> list[Path]:
    return sorted(p for p in STAGE.rglob("*") if p.is_file() and p.name not in {"SHA256SUMS", ".DS_Store"})


def place(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, target)  # The models are 800 MB each: share the bytes instead of copying them.
    except OSError:
        shutil.copy2(source, target)


def build() -> None:
    if STAGE.exists():
        shutil.rmtree(STAGE)
    for prefix, source in SOURCES.items():
        if not source.is_dir():
            sys.exit(f"Missing {source}")
        for path in sorted(source.rglob("*")):
            if path.is_file() and path.name != ".DS_Store":
                place(path, STAGE / prefix / path.relative_to(source))
    if not APACHE.is_file() or "Apache License" not in APACHE.read_text()[:200]:
        sys.exit(f"Apache-2.0 text not found at {APACHE}: run pnpm install")
    shutil.copy2(APACHE, STAGE / "LICENSE")
    (STAGE / "README.md").write_text(CARD.format(revision=BASE_REVISION))
    (STAGE / "NOTICE").write_text(NOTICE.format(revision=BASE_REVISION))

    files = {str(p.relative_to(STAGE)): {"bytes": p.stat().st_size, "sha256": sha256(p)} for p in staged_files()}
    (STAGE / "SHA256SUMS").write_text("".join(f"{v['sha256']}  {k}\n" for k, v in files.items()))
    hub = json.loads(MANIFEST.read_text())["hub"] if MANIFEST.exists() else {"repo": None, "revision": None}
    manifest = {"release": "laya-descent-v4", "license": "apache-2.0", "hub": hub, "provenance": PROVENANCE, "files": files}
    write_manifest(manifest)
    print(f"Staged {len(files)} files, {sum(v['bytes'] for v in files.values()) / 1e9:.2f} GB, in {STAGE.relative_to(ROOT)}")
    print(f"Wrote {MANIFEST.relative_to(ROOT)}")


def write_manifest(manifest: dict) -> None:
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")


def verify() -> None:
    manifest = json.loads(MANIFEST.read_text())
    found = {str(p.relative_to(STAGE)) for p in staged_files()}
    expected = set(manifest["files"])
    bad = sorted(found ^ expected)
    bad += [k for k, v in manifest["files"].items() if k in found and sha256(STAGE / k) != v["sha256"]]
    if bad:
        sys.exit("Does not match the manifest: " + ", ".join(bad))
    print(f"All {len(expected)} staged files match {MANIFEST.relative_to(ROOT)}")


def publish(repo: str, revision: str) -> None:
    if len(revision) != 40:
        sys.exit("Give the full 40-character commit hash the upload created.")
    manifest = json.loads(MANIFEST.read_text())
    manifest["hub"] = {"repo": repo, "revision": revision}
    write_manifest(manifest)
    print(f"Recorded {repo}@{revision}. repro_colab.ipynb now downloads from there.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--published", nargs=2, metavar=("REPO", "REVISION"))
    args = parser.parse_args()
    if args.published:
        publish(*args.published)
    elif args.verify:
        verify()
    else:
        build()
