#!/usr/bin/env python3
"""Upload a Kaggle dataset blob and seal its small finalization request."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from kaggle.api.kaggle_api_extended import (
    ApiBlobType,
    ApiCreateDatasetRequest,
    KaggleApi,
    ResumableUploadContext,
)


HANDOFF_SCHEMA_VERSION = 1


def build_create_request(api: KaggleApi, folder: Path) -> tuple[str, ApiCreateDatasetRequest]:
    metadata_path = Path(api.get_dataset_metadata_file(str(folder)))
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    dataset_id = metadata.get("id")
    title = metadata.get("title")
    licenses = metadata.get("licenses")
    if not isinstance(dataset_id, str) or dataset_id.count("/") != 1:
        raise ValueError("dataset metadata must contain an owner/slug id")
    if not isinstance(title, str) or not 6 <= len(title) <= 50:
        raise ValueError("dataset title must contain 6 to 50 characters")
    if not isinstance(licenses, list) or len(licenses) != 1 or not isinstance(licenses[0], dict):
        raise ValueError("dataset metadata must specify exactly one license")
    license_name = licenses[0].get("name")
    if not isinstance(license_name, str) or not license_name:
        raise ValueError("dataset metadata license is missing its name")

    owner_slug, dataset_slug = dataset_id.split("/", 1)
    configured_owner = api.config_values.get(api.CONFIG_NAME_USER)
    if configured_owner != owner_slug:
        raise ValueError("dataset owner does not match the authenticated Kaggle user")
    if not 6 <= len(dataset_slug) <= 50:
        raise ValueError("dataset slug must contain 6 to 50 characters")

    request = ApiCreateDatasetRequest()
    request.title = title
    request.slug = dataset_slug
    request.owner_slug = owner_slug
    request.license_name = license_name
    request.subtitle = metadata.get("subtitle")
    request.description = metadata.get("description")
    request.files = []
    request.is_private = True
    request.category_ids = metadata.get("keywords", [])
    resources = metadata.get("resources")
    if resources:
        api.validate_resources(str(folder), resources)

    with ResumableUploadContext() as upload_context:
        api.upload_files(
            request,
            resources,
            str(folder),
            ApiBlobType.DATASET,
            upload_context,
            quiet=False,
            dir_mode="skip",
            ignore_patterns=None,
        )
    if not request.files:
        raise ValueError("Kaggle handoff did not upload any dataset files")
    return dataset_id, request


def stage_handoff(folder: Path, output: Path, api: KaggleApi) -> dict[str, Any]:
    dataset_id, request = build_create_request(api, folder)
    envelope: dict[str, Any] = {
        "schemaVersion": HANDOFF_SCHEMA_VERSION,
        "operation": "create-private-dataset",
        "datasetId": dataset_id,
        "request": request.to_dict(),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(envelope, separators=(",", ":")) + "\n", encoding="utf-8")
    output.chmod(0o600)
    return {
        "schemaVersion": HANDOFF_SCHEMA_VERSION,
        "operation": envelope["operation"],
        "datasetId": dataset_id,
        "uploadedFiles": len(request.files),
        "handoffBytes": output.stat().st_size,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    parser.add_argument("output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    api = KaggleApi()
    api.authenticate()
    summary = stage_handoff(args.folder.resolve(), args.output.resolve(), api)
    print(json.dumps(summary, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
