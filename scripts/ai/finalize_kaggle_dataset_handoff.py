#!/usr/bin/env python3
"""Finalize a remotely uploaded Kaggle dataset without reading its blob locally."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from kaggle.api.kaggle_api_extended import ApiCreateDatasetRequest, KaggleApi

HANDOFF_SCHEMA_VERSION = 1


def load_handoff(path: Path, expected_dataset_id: str) -> dict[str, Any]:
    envelope = json.loads(path.read_text(encoding="utf-8"))
    if envelope.get("schemaVersion") != HANDOFF_SCHEMA_VERSION:
        raise ValueError("unsupported Kaggle dataset handoff schema")
    if envelope.get("operation") != "create-private-dataset":
        raise ValueError("unsupported Kaggle dataset handoff operation")
    if envelope.get("datasetId") != expected_dataset_id:
        raise ValueError("Kaggle dataset handoff identity mismatch")
    request_data = envelope.get("request")
    if not isinstance(request_data, dict):
        raise ValueError("Kaggle dataset handoff is missing its request")
    return request_data


def finalize_handoff(path: Path, expected_dataset_id: str, api: KaggleApi) -> dict[str, Any]:
    request = ApiCreateDatasetRequest.from_dict(load_handoff(path, expected_dataset_id))
    owner_slug, dataset_slug = expected_dataset_id.split("/", 1)
    if request.owner_slug != owner_slug or request.slug != dataset_slug:
        raise ValueError("Kaggle dataset request identity mismatch")
    if request.is_private is not True:
        raise ValueError("Kaggle dataset handoff must remain private")
    if not request.files:
        raise ValueError("Kaggle dataset handoff contains no uploaded files")

    with api.build_kaggle_client() as kaggle:
        response = api.with_retry(kaggle.datasets.dataset_api_client.create_dataset)(request)
    error = getattr(response, "error", None)
    if error:
        raise RuntimeError(f"Kaggle rejected the dataset finalization: {error}")
    path.unlink(missing_ok=True)
    return {
        "datasetId": expected_dataset_id,
        "status": str(getattr(response, "status", "submitted")),
        "uploadedFiles": len(request.files),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("handoff", type=Path)
    parser.add_argument("expected_dataset_id")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    api = KaggleApi()
    api.authenticate()
    result = finalize_handoff(args.handoff.resolve(), args.expected_dataset_id, api)
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
