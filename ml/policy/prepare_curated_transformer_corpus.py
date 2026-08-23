#!/usr/bin/env python3
"""Assemble source-disjoint curated v4 shards for candidate training."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
from typing import Any, Iterator


SPLITS = ("train", "validation")
POLICY_DATASETS = ("policy-all", "policy-battle-wins", "policy-run-wins")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def iter_gzip_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            record = json.loads(line)
            if not isinstance(record, dict):
                raise ValueError(f"{path}:{line_number}: JSONL row must be an object")
            yield record


def verify_manifest(curated_dir: Path) -> dict[str, Any]:
    manifest_path = curated_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("contractVersion") != 4 or manifest.get("featureSchemaVersion") != 4:
        raise ValueError("curated dataset must use combat contract v4 / feature schema v4")
    dataset_id = manifest.get("datasetId")
    if not isinstance(dataset_id, str) or len(dataset_id) != 24:
        raise ValueError("curated dataset has an invalid datasetId")
    identity = manifest.get("identity")
    if not isinstance(identity, dict) or any(not identity.get(key) for key in ("buildSha", "dexHash", "dictionaryHash")):
        raise ValueError("curated dataset has an incomplete runtime identity")
    entries = manifest.get("files")
    if not isinstance(entries, list) or not entries:
        raise ValueError("curated dataset manifest has no files")
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("name"), str):
            raise ValueError("curated dataset manifest has an invalid file entry")
        path = curated_dir / entry["name"]
        if not path.is_file():
            raise ValueError(f"curated dataset is missing {entry['name']}")
        if path.stat().st_size != entry.get("bytes"):
            raise ValueError(f"curated dataset byte count mismatch for {entry['name']}")
        if sha256_file(path) != entry.get("sha256"):
            raise ValueError(f"curated dataset checksum mismatch for {entry['name']}")
    return manifest


def battle_id(record: dict[str, Any]) -> str | None:
    explicit = record.get("battleId")
    if isinstance(explicit, str) and explicit:
        return explicit
    joint_action_id = record.get("jointActionId")
    if isinstance(joint_action_id, str) and ":" in joint_action_id:
        return joint_action_id.rsplit(":", 1)[0]
    return None


def normalize_terminal(
    terminal: dict[str, Any],
    episode: dict[str, Any],
    identity: dict[str, str],
) -> dict[str, Any]:
    normalized = dict(terminal)
    normalized.setdefault("kind", "battle_terminal")
    normalized.setdefault("schemaVersion", 4)
    normalized.setdefault("featureSchemaVersion", 4)
    normalized.setdefault("episodeId", episode.get("episodeId"))
    normalized.setdefault("sourcePartitionId", episode.get("sourcePartitionId"))
    normalized.setdefault("splitGroupId", episode.get("episodeId"))
    for name, value in identity.items():
        normalized.setdefault(name, value)
    if normalized.get("kind") != "battle_terminal":
        raise ValueError("critic episode contains a non-battle terminal")
    if not battle_id(normalized):
        raise ValueError("critic episode contains a battle terminal without a stable battleId")
    return normalized


def assemble(
    curated_dir: Path,
    output_dir: Path,
    policy_dataset: str = "policy-all",
) -> dict[str, Any]:
    if policy_dataset not in POLICY_DATASETS:
        raise ValueError(f"unsupported policy dataset {policy_dataset!r}")
    manifest = verify_manifest(curated_dir)
    identity = manifest["identity"]
    output_dir.mkdir(parents=True, exist_ok=True)

    decision_count = 0
    source_partitions: set[str] = set()
    selected_battles: set[str] = set()
    policy_outputs: list[str] = []
    for split in SPLITS:
        source = curated_dir / f"{policy_dataset}-{split}.jsonl.gz"
        destination = output_dir / f"{source.name}pack"
        policy_outputs.append(destination.name)
        with destination.open("wb") as raw:
            with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
                for decision in iter_gzip_jsonl(source):
                    if decision.get("kind") != "combat_decision":
                        raise ValueError(f"{source} contains a non-decision policy row")
                    if decision.get("policySource") != "human-v1" or decision.get("policyTarget") is not True:
                        raise ValueError(f"{source} contains a non-human policy target")
                    if any(decision.get(name) != value for name, value in identity.items()):
                        raise ValueError(f"{source} contains a mixed runtime identity")
                    stable_battle_id = battle_id(decision)
                    if stable_battle_id is None:
                        raise ValueError(f"decision {decision.get('decisionId')} has no stable battleId")
                    selected_battles.add(stable_battle_id)
                    source_partition = decision.get("sourcePartitionId")
                    if not isinstance(source_partition, str) or not source_partition:
                        raise ValueError(f"decision {decision.get('decisionId')} has no source partition")
                    source_partitions.add(source_partition)
                    decision_count += 1
                    packed = {**decision, "curationSplit": split}
                    compressed.write(
                        f"{json.dumps(packed, sort_keys=True, separators=(',', ':'))}\n".encode()
                    )

    terminals: dict[str, dict[str, Any]] = {}
    completed_episodes = 0
    for split in SPLITS:
        source = curated_dir / f"critic-all-outcomes-{split}.jsonl.gz"
        for episode in iter_gzip_jsonl(source):
            completed_episodes += 1
            for terminal in episode.get("battleTerminals", []):
                normalized = normalize_terminal(terminal, episode, identity)
                stable_battle_id = battle_id(normalized)
                assert stable_battle_id is not None
                if stable_battle_id not in selected_battles:
                    continue
                previous = terminals.setdefault(stable_battle_id, normalized)
                if previous != normalized:
                    raise ValueError(f"conflicting terminal records for battle {stable_battle_id}")

    terminal_path = output_dir / "completed-battle-terminals.jsonl.gzpack"
    with terminal_path.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
            for stable_battle_id in sorted(terminals):
                compressed.write(
                    f"{json.dumps(terminals[stable_battle_id], sort_keys=True, separators=(',', ':'))}\n".encode()
                )

    report = {
        "schemaVersion": 1,
        "datasetId": manifest["datasetId"],
        "identity": identity,
        "policyDataset": policy_dataset,
        "includedSplits": list(SPLITS),
        "policyDecisions": decision_count,
        "sourcePartitions": len(source_partitions),
        "selectedBattles": len(selected_battles),
        "completedCriticEpisodes": completed_episodes,
        "matchedBattleTerminals": len(terminals),
        "unknownOutcomeBattles": len(selected_battles.difference(terminals)),
        "files": policy_outputs + [terminal_path.name],
        "heldOutSplitIncluded": False,
        "rawIdentifiersIncluded": False,
    }
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--curated-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--policy-dataset", choices=POLICY_DATASETS, default="policy-all")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = assemble(args.curated_dir, args.out, args.policy_dataset)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(f"{json.dumps(report, indent=2, sort_keys=True)}\n", encoding="utf-8")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
