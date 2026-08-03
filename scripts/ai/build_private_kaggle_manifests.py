#!/usr/bin/env python3
"""Build private Kaggle dataset and GPU-kernel manifests for production-v4 research."""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path


DATASET_NAME = "er-ai-production-v4-human-20260803"
KERNEL_NAME = "er-ai-production-v4-human-baseline-20260803"


def write_json(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: build_private_kaggle_manifests.py OUTPUT_ROOT KAGGLE_USERNAME", file=sys.stderr)
        return 2
    output_root = Path(sys.argv[1]).resolve()
    username = sys.argv[2].strip()
    if not username or "/" in username or "\\" in username:
        raise RuntimeError("invalid Kaggle username")

    repository_root = Path(__file__).resolve().parents[2]
    dataset_slug = f"{username}/{DATASET_NAME}"
    kernel_slug = f"{username}/{KERNEL_NAME}"
    dataset_root = output_root / "ai-kaggle-dataset"
    kernel_root = output_root / "ai-kaggle-kernel"
    kernel_root.mkdir(parents=True, exist_ok=True)
    shutil.copy2(repository_root / "ml/policy/kaggle_train_entrypoint.py", kernel_root)

    write_json(
        dataset_root / "dataset-metadata.json",
        {
            "title": "ER AI Production V4 Human Training 20260803",
            "id": dataset_slug,
            "licenses": [{"name": "other"}],
        },
    )
    write_json(
        kernel_root / "kernel-metadata.json",
        {
            "id": kernel_slug,
            "title": "ER AI Production V4 Human Baseline GPU 20260803",
            "code_file": "kaggle_train_entrypoint.py",
            "language": "python",
            "kernel_type": "script",
            "is_private": "true",
            "enable_gpu": "true",
            "enable_tpu": "false",
            "enable_internet": "true",
            "dataset_sources": [dataset_slug],
            "competition_sources": [],
            "kernel_sources": [],
            "model_sources": [],
        },
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
