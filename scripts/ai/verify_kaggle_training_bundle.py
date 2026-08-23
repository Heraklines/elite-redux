#!/usr/bin/env python3

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any
from zipfile import ZipFile


REQUIRED_PACKAGING_SOURCES = {
    "ml/policy/build_candidate_ensemble.py",
    "ml/policy/serve_candidate_transformer.py",
}


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def is_training_source(path: str) -> bool:
    return path.startswith("ml/policy/")


def verify_contents(
    bundle_name: str,
    read_bytes: Any,
    repository_root: Path,
) -> dict[str, Any]:
    manifest = json.loads(read_bytes("bundle-manifest.json"))
    manifest_files = {
        entry["path"]: entry
        for entry in manifest.get("files", [])
        if isinstance(entry, dict) and isinstance(entry.get("path"), str)
    }
    source_paths = sorted(path for path in manifest_files if is_training_source(path))
    if not source_paths:
        raise ValueError("training bundle manifest contains no model sources")
    missing_packaging_sources = sorted(REQUIRED_PACKAGING_SOURCES.difference(source_paths))
    if missing_packaging_sources:
        raise ValueError(
            "training bundle is missing ensemble packaging sources: "
            + ", ".join(missing_packaging_sources)
        )
    for archived_path, entry in manifest_files.items():
        archived = read_bytes(archived_path)
        if sha256(archived) != entry.get("sha256"):
            raise ValueError(f"bundle manifest hash mismatch: {archived_path}")
        if len(archived) != entry.get("bytes"):
            raise ValueError(f"bundle manifest byte count mismatch: {archived_path}")
    for source_path in source_paths:
        local_path = repository_root / source_path
        if not local_path.is_file():
            raise ValueError(f"checked-out training source is missing: {source_path}")
        archived = read_bytes(source_path)
        archived_sha = sha256(archived)
        if archived_sha != sha256(local_path.read_bytes()):
            raise ValueError(f"private dataset contains stale training source: {source_path}")
    return {
        "bundle": bundle_name,
        "trainingProfile": manifest.get("trainingProfile"),
        "sourceFiles": len(source_paths),
        "decisionShards": manifest.get("decisionShards"),
        "featureSchemaVersion": manifest.get("featureSchemaVersion"),
    }


def verify_bundle(bundle_path: Path, repository_root: Path) -> dict[str, Any]:
    if bundle_path.is_dir():
        manifests = list(bundle_path.rglob("bundle-manifest.json"))
        if len(manifests) != 1:
            raise ValueError(f"expected one extracted bundle manifest, found {manifests}")
        bundle_root = manifests[0].parent
        return verify_contents(
            bundle_root.name,
            lambda path: (bundle_root / path).read_bytes(),
            repository_root,
        )
    with ZipFile(bundle_path) as archive:
        return verify_contents(bundle_path.name, archive.read, repository_root)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle", type=Path)
    parser.add_argument("repository_root", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    print(json.dumps(verify_bundle(args.bundle, args.repository_root), sort_keys=True))


if __name__ == "__main__":
    main()
