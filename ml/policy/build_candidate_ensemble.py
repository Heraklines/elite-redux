#!/usr/bin/env python3
"""Build a path-safe manifest for independently trained policy seeds."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from serve_candidate_transformer import ENSEMBLE_NAME, load_bundle, load_ensemble


def build_manifest(root: Path) -> dict[str, object]:
    members = sorted(path.name for path in root.glob("seed-*") if (path / "config.json").is_file())
    if len(members) < 2:
        raise ValueError(f"expected at least two seed bundles under {root}, found {members}")
    bundles = [load_bundle(root / member) for member in members]
    contract_identities = {
        (bundle.contract_schema_version, bundle.feature_schema_version) for bundle in bundles
    }
    if len(contract_identities) != 1:
        raise ValueError("neural ensemble members use different contract schemas")
    contract_schema_version, feature_schema_version = next(iter(contract_identities))
    payload: dict[str, object] = {
        "schemaVersion": 4,
        "model": ENSEMBLE_NAME,
        "contractSchemaVersion": contract_schema_version,
        "featureSchemaVersion": feature_schema_version,
        "members": members,
    }
    (root / "ensemble.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    load_ensemble(root)
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    return parser.parse_args()


if __name__ == "__main__":
    print(json.dumps(build_manifest(parse_args().root)))
