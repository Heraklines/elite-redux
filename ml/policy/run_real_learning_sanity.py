#!/usr/bin/env python3
"""Run a bounded memorization gate on real contract-v4 policy decisions."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter
from dataclasses import asdict
from functools import partial
from pathlib import Path
from typing import Any, Iterable

import torch
from torch.utils.data import DataLoader

BASELINE_DIR = Path(__file__).resolve().parents[1] / "baselines"
sys.path.insert(0, str(BASELINE_DIR))

from candidate_transformer import CandidateSetTransformer, CandidateTransformerConfig, parameter_count
from train_candidate_baselines import is_policy_target, validate_decision  # noqa: E402
from train_candidate_transformer import (
    DecisionDataset,
    build_token_vocabulary,
    collate,
    evaluate,
    feature_normalization,
    make_examples,
    set_determinism,
    train_epoch,
)


SPLIT_SEED = "er-human-telemetry-split-v1"
SAMPLE_SEED = "er-real-learning-sanity-v1"


def source_split(source_partition_id: str) -> str:
    digest = hashlib.sha256(f"{SPLIT_SEED}:{source_partition_id}".encode()).digest()
    bucket = int.from_bytes(digest[:4], "big") / 2**32
    return "train" if bucket < 0.7 else "validation" if bucket < 0.85 else "test"


def sample_key(decision_id: str) -> str:
    return hashlib.sha256(f"{SAMPLE_SEED}:{decision_id}".encode()).hexdigest()


def iter_records(path: Path) -> Iterable[tuple[dict[str, Any], Path, int]]:
    files = [path] if path.is_file() else sorted(path.rglob("*.jsonl"))
    for file in files:
        with file.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                if line.strip():
                    yield json.loads(line), file, line_number


def select_decisions(path: Path, count: int, max_per_source: int) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    identities: Counter[tuple[str, str, str]] = Counter()
    reasons: Counter[str] = Counter()
    for record, file, line_number in iter_records(path):
        if record.get("kind") != "combat_decision":
            continue
        validate_decision(record, file, line_number)
        if record.get("schemaVersion") != 4 or record.get("featureSchemaVersion") != 4:
            reasons["unsupported_schema"] += 1
            continue
        if record.get("policySource") != "human-v1" or not is_policy_target(record):
            reasons["non_human_target"] += 1
            continue
        source = record.get("sourcePartitionId")
        if not isinstance(source, str) or not source or source_split(source) != "train":
            reasons["non_train_source"] += 1
            continue
        if len(record.get("candidates", [])) < 2:
            reasons["forced_action"] += 1
            continue
        identity = tuple(str(record.get(name) or "") for name in ("buildSha", "dexHash", "dictionaryHash"))
        if any(not value or value == "unknown" for value in identity):
            reasons["missing_identity"] += 1
            continue
        identities[identity] += 1

    if not identities:
        raise ValueError("no eligible contract-v4 human training decisions found")
    selected_identity, identity_decisions = max(identities.items(), key=lambda item: (item[1], item[0]))
    per_source_candidates: dict[str, list[tuple[str, dict[str, Any]]]] = {}
    for record, file, line_number in iter_records(path):
        if record.get("kind") != "combat_decision":
            continue
        validate_decision(record, file, line_number)
        source = record.get("sourcePartitionId")
        if (
            record.get("schemaVersion") != 4
            or record.get("featureSchemaVersion") != 4
            or record.get("policySource") != "human-v1"
            or not is_policy_target(record)
            or not isinstance(source, str)
            or not source
            or source_split(source) != "train"
            or len(record.get("candidates", [])) < 2
        ):
            continue
        identity = tuple(str(record.get(name) or "") for name in ("buildSha", "dexHash", "dictionaryHash"))
        if identity != selected_identity:
            continue
        candidates = per_source_candidates.setdefault(source, [])
        candidates.append((sample_key(record["decisionId"]), record))
        candidates.sort(key=lambda item: item[0])
        if len(candidates) > max_per_source:
            candidates.pop()
    bounded = [candidate for candidates in per_source_candidates.values() for candidate in candidates]
    selected = [record for _, record in sorted(bounded, key=lambda item: item[0])[:count]]
    reasons["per_source_cap"] = identity_decisions - len(bounded)
    if len(selected) != count:
        raise ValueError(
            f"requested {count} decisions but selected {len(selected)} after source caps from identity with "
            f"{identity_decisions} eligible decisions"
        )
    feature_widths = {
        len(row["values"])
        for decision in selected
        for row in decision["candidateFeatures"]
    }
    if len(feature_widths) != 1:
        raise ValueError(f"selected sample mixes feature widths: {sorted(feature_widths)}")
    return selected, {
        "requested": count,
        "selected": len(selected),
        "eligibleInSelectedIdentity": identity_decisions,
        "sourcePartitions": len({record["sourcePartitionId"] for record in selected}),
        "maxPerSource": max_per_source,
        "featureCount": next(iter(feature_widths)),
        "buildSha": selected_identity[0],
        "dexHash": selected_identity[1],
        "dictionaryHash": selected_identity[2],
        "excluded": dict(sorted(reasons.items())),
    }


def make_loader(examples: list, seed: int, *, shuffle: bool, batch_size: int) -> DataLoader:
    return DataLoader(
        DecisionDataset(examples),
        batch_size=batch_size,
        shuffle=shuffle,
        collate_fn=partial(collate, history_length=0),
        generator=torch.Generator().manual_seed(seed),
        num_workers=0,
    )


def train_to_memorization(
    decisions: list[dict[str, Any]],
    dictionary: dict[str, Any],
    *,
    seed: int,
    epochs: int,
    batch_size: int,
    target_top1: float,
) -> tuple[dict[str, Any], CandidateSetTransformer]:
    vocabulary, token_to_id = build_token_vocabulary(decisions, dictionary)
    examples = make_examples(
        decisions,
        [],
        loss_policy_weight=0.0,
        token_to_id=token_to_id,
        history_length=0,
        terminal_scope="episode",
        unknown_policy_weight=1.0,
    )
    feature_mean, feature_std = feature_normalization(examples)
    config = CandidateTransformerConfig(
        feature_count=examples[0].full_feature_count,
        token_vocabulary_size=len(vocabulary),
        d_model=128,
        layers=2,
        heads=4,
        feedforward=384,
        dropout=0.0,
        history_length=0,
        trajectory_layers=1,
    )
    set_determinism(seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = CandidateSetTransformer(config, feature_mean, feature_std).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=0.0)
    scaler = torch.amp.GradScaler(device.type, enabled=device.type == "cuda")
    train_loader = make_loader(examples, seed, shuffle=True, batch_size=batch_size)
    evaluation_loader = make_loader(examples, seed + 1, shuffle=False, batch_size=batch_size)
    history: list[dict[str, Any]] = []
    final_metrics: dict[str, float | None] = {}
    for epoch in range(1, epochs + 1):
        losses = train_epoch(model, train_loader, optimizer, device, 0.0, 1.0, device.type == "cuda", scaler)
        final_metrics = evaluate(model, evaluation_loader, device)
        history.append(
            {
                "epoch": epoch,
                "policyLoss": losses["policyLoss"],
                "top1": final_metrics["top1"],
                "candidateNll": final_metrics["candidateNll"],
            }
        )
        if final_metrics["top1"] is not None and final_metrics["top1"] >= target_top1:
            break
    return (
        {
            "passed": bool(final_metrics.get("top1") is not None and final_metrics["top1"] >= target_top1),
            "targetTop1": target_top1,
            "epochsRun": len(history),
            "final": final_metrics,
            "curve": history,
            "device": device.type,
            "parameters": parameter_count(model),
            "architecture": asdict(config),
            "tokenVocabularySize": len(vocabulary),
        },
        model,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--dictionary", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--sample-out", type=Path)
    parser.add_argument("--select-only", action="store_true")
    parser.add_argument("--decisions", type=int, default=512)
    parser.add_argument("--max-per-source", type=int, default=8)
    parser.add_argument("--epochs", type=int, default=120)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--seed", type=int, default=20260804)
    parser.add_argument("--target-top1", type=float, default=0.99)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.decisions < 1 or args.max_per_source < 1 or args.epochs < 1 or args.batch_size < 1:
        raise ValueError("decision, source-cap, epoch, and batch-size values must be positive")
    if not 0 < args.target_top1 <= 1:
        raise ValueError("target top-1 must be in (0, 1]")
    decisions, sample = select_decisions(args.data, args.decisions, args.max_per_source)
    if args.sample_out is not None:
        sample_path = args.sample_out.resolve()
        report_root = args.report.resolve().parent
        if sample_path == args.report.resolve() or sample_path.is_relative_to(report_root):
            raise ValueError("private sample output must be outside the sanitized report directory")
        sample_path.parent.mkdir(parents=True, exist_ok=True)
        sample_path.write_text("".join(f"{json.dumps(record, separators=(',', ':'))}\n" for record in decisions), encoding="utf-8")
    if args.select_only:
        report = {
            "reportVersion": 1,
            "gate": "real-contract-v4-sample-selection",
            "privacy": {
                "rawRecordsIncluded": False,
                "rawIdentifiersIncluded": False,
                "privateSampleWritten": args.sample_out is not None,
            },
            "sample": sample,
        }
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2, sort_keys=True))
        return
    if args.dictionary is None:
        raise ValueError("--dictionary is required unless --select-only is used")
    dictionary = json.loads(args.dictionary.read_text(encoding="utf-8"))
    dictionary_hash = hashlib.sha256(args.dictionary.read_bytes()).hexdigest()
    if dictionary_hash != sample["dictionaryHash"]:
        raise ValueError(
            f"dictionary hash mismatch: selected {sample['dictionaryHash']}, received {dictionary_hash}"
        )
    memorization, _ = train_to_memorization(
        decisions,
        dictionary,
        seed=args.seed,
        epochs=args.epochs,
        batch_size=args.batch_size,
        target_top1=args.target_top1,
    )
    report = {
        "reportVersion": 1,
        "gate": "real-contract-v4-learning-sanity",
        "privacy": {
            "rawRecordsIncluded": False,
            "rawIdentifiersIncluded": False,
        },
        "sample": sample,
        "memorization": memorization,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    if not memorization["passed"]:
        raise SystemExit(
            f"real-data memorization gate failed: top1={memorization['final'].get('top1')}, "
            f"target={args.target_top1}"
        )


if __name__ == "__main__":
    main()
