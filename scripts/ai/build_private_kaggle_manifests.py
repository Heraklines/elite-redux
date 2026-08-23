#!/usr/bin/env python3
"""Build private Kaggle dataset and GPU-kernel manifests for production-v4 research."""

from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path


DATASET_NAME = "er-ai-production-v4-human-20260803"
KERNEL_NAME = "er-ai-production-v4-human-baseline-gpu-20260803"
SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")


def write_json(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    if len(sys.argv) not in (3, 5):
        print(
            "usage: build_private_kaggle_manifests.py OUTPUT_ROOT KAGGLE_USERNAME "
            "[DATASET_NAME KERNEL_NAME]",
            file=sys.stderr,
        )
        return 2
    output_root = Path(sys.argv[1]).resolve()
    username = sys.argv[2].strip()
    if not username or "/" in username or "\\" in username:
        raise RuntimeError("invalid Kaggle username")
    dataset_name = sys.argv[3].strip() if len(sys.argv) == 5 else DATASET_NAME
    kernel_name = sys.argv[4].strip() if len(sys.argv) == 5 else KERNEL_NAME
    if not SLUG_RE.fullmatch(dataset_name):
        raise RuntimeError("invalid Kaggle dataset name")
    if not SLUG_RE.fullmatch(kernel_name):
        raise RuntimeError("invalid Kaggle kernel name")

    repository_root = Path(__file__).resolve().parents[2]
    dataset_slug = f"{username}/{dataset_name}"
    kernel_slug = f"{username}/{kernel_name}"
    dataset_root = output_root / "ai-kaggle-dataset"
    kernel_root = output_root / "ai-kaggle-kernel"
    kernel_root.mkdir(parents=True, exist_ok=True)
    shutil.copy2(repository_root / "ml/policy/kaggle_train_entrypoint.py", kernel_root)

    write_json(
        dataset_root / "dataset-metadata.json",
        {
            "title": dataset_name.replace("-", " ").title(),
            "id": dataset_slug,
            "licenses": [{"name": "other"}],
        },
    )
    write_json(
        kernel_root / "kernel-metadata.json",
        {
            "id": kernel_slug,
            "title": kernel_name.replace("-", " ").title(),
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
