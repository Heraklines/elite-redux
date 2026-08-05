#!/usr/bin/env python3
"""Run a bounded memorization gate on real contract-v4 policy decisions."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
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
    capture_training_resume_state,
    collate,
    evaluate,
    feature_normalization,
    make_examples,
    model_forward,
    restore_training_resume_state,
    set_determinism,
    train_epoch,
)


SPLIT_SEED = "er-human-telemetry-split-v1"
SAMPLE_SEED = "er-real-learning-sanity-v1"
ACTION_ONLY_FEATURES = {
    "action_move",
    "action_switch",
    "action_shift",
    "move_power_ratio",
    "move_accuracy_ratio",
    "move_priority_ratio",
    "move_tera",
    "move_target_count_ratio",
    "move_random_target",
    "move_status_chance",
    "move_has_drain",
    "move_drain_fraction",
    "move_has_recoil",
    "move_recoil_fraction",
    "move_forces_recharge",
    "move_creates_lock",
    "switch_baton",
    "shift_distance_ratio",
}
ACTION_ONLY_FEATURE_PREFIXES = ("move_category_", "move_type_", "move_id_hash_")
ACTION_ONLY_TOKEN_PREFIXES = (
    "action:",
    "move:",
    "move-type:",
    "move-category:",
    "move-target-mode:",
    "move-tera:",
    "move-drain:",
    "move-recoil:",
    "move-recharge:",
    "move-lock:",
    "move-attr:",
    "switch-transfer:",
    "shift-distance:",
)


def source_split(source_partition_id: str) -> str:
    digest = hashlib.sha256(f"{SPLIT_SEED}:{source_partition_id}".encode()).digest()
    bucket = int.from_bytes(digest[:4], "big") / 2**32
    return "train" if bucket < 0.7 else "validation" if bucket < 0.85 else "test"


def sample_key(decision_id: str) -> str:
    return hashlib.sha256(f"{SAMPLE_SEED}:{decision_id}".encode()).hexdigest()


def candidate_model_input(candidate_id: str, decision: dict[str, Any]) -> dict[str, Any]:
    feature_rows = {row["candidateId"]: row for row in decision["candidateFeatures"]}
    token_rows = {row["candidateId"]: row for row in decision["candidateTokenGroups"]}
    feature = feature_rows[candidate_id]
    groups = token_rows[candidate_id]["groups"]
    return {
        "values": feature["values"],
        "presence": feature.get("presence"),
        "tokens": {name: sorted(groups[name]) for name in ("actor", "targets", "destination", "field", "action")},
    }


def model_input_identity(decision: dict[str, Any]) -> tuple[str, str, bool]:
    candidate_inputs = {
        candidate["id"]: candidate_model_input(candidate["id"], decision)
        for candidate in decision["candidates"]
    }
    canonical_candidates = sorted(
        json.dumps(value, sort_keys=True, separators=(",", ":"))
        for value in candidate_inputs.values()
    )
    state_hash = hashlib.sha256("\n".join(canonical_candidates).encode()).hexdigest()
    chosen_input = json.dumps(
        candidate_inputs[decision["chosenCandidateId"]],
        sort_keys=True,
        separators=(",", ":"),
    )
    return (
        state_hash,
        hashlib.sha256(chosen_input.encode()).hexdigest(),
        len(set(canonical_candidates)) != len(canonical_candidates),
    )


def iter_records(path: Path) -> Iterable[tuple[dict[str, Any], Path, int]]:
    files = [path] if path.is_file() else sorted(path.rglob("*.jsonl"))
    for file in files:
        with file.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                if line.strip():
                    yield json.loads(line), file, line_number


def select_decisions(
    path: Path,
    count: int,
    max_per_source: int,
    *,
    split: str = "train",
    selected_identity: tuple[str, str, str] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if split not in {"train", "validation", "test"}:
        raise ValueError(f"unsupported source split {split}")
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
        if not isinstance(source, str) or not source or source_split(source) != split:
            reasons[f"non_{split}_source"] += 1
            continue
        if len(record.get("candidates", [])) < 2:
            reasons["forced_action"] += 1
            continue
        identity = tuple(str(record.get(name) or "") for name in ("buildSha", "dexHash", "dictionaryHash"))
        if any(not value or value == "unknown" for value in identity):
            reasons["missing_identity"] += 1
            continue
        if selected_identity is None or identity == selected_identity:
            identities[identity] += 1

    if not identities:
        raise ValueError("no eligible contract-v4 human training decisions found")
    resolved_identity, identity_decisions = max(identities.items(), key=lambda item: (item[1], item[0]))
    input_counts: Counter[str] = Counter()
    labels_by_input: dict[str, set[str]] = {}
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
            or source_split(source) != split
            or len(record.get("candidates", [])) < 2
        ):
            continue
        identity = tuple(str(record.get(name) or "") for name in ("buildSha", "dexHash", "dictionaryHash"))
        if identity != resolved_identity:
            continue
        input_identity, chosen_identity, ambiguous_candidates = model_input_identity(record)
        if ambiguous_candidates:
            reasons["indistinguishable_candidates"] += 1
            continue
        input_counts[input_identity] += 1
        labels_by_input.setdefault(input_identity, set()).add(chosen_identity)

    duplicate_inputs = {identity for identity, count in input_counts.items() if count > 1}
    conflicting_inputs = {
        identity for identity, labels in labels_by_input.items() if len(labels) > 1
    }
    reasons["duplicate_model_input"] = sum(
        input_counts[identity] for identity in duplicate_inputs - conflicting_inputs
    )
    reasons["conflicting_model_input"] = sum(input_counts[identity] for identity in conflicting_inputs)
    clean_decisions = sum(count for identity, count in input_counts.items() if identity not in duplicate_inputs)

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
            or source_split(source) != split
            or len(record.get("candidates", [])) < 2
        ):
            continue
        identity = tuple(str(record.get(name) or "") for name in ("buildSha", "dexHash", "dictionaryHash"))
        if identity != resolved_identity:
            continue
        input_identity, _, ambiguous_candidates = model_input_identity(record)
        if ambiguous_candidates or input_identity in duplicate_inputs:
            continue
        candidates = per_source_candidates.setdefault(source, [])
        candidates.append((sample_key(record["decisionId"]), record))
        candidates.sort(key=lambda item: item[0])
        if len(candidates) > max_per_source:
            candidates.pop()
    bounded = [candidate for candidates in per_source_candidates.values() for candidate in candidates]
    selected = [record for _, record in sorted(bounded, key=lambda item: item[0])[:count]]
    reasons["per_source_cap"] = clean_decisions - len(bounded)
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
        "sourceSplit": split,
        "eligibleInSelectedIdentity": identity_decisions,
        "uniqueModelInputs": clean_decisions,
        "sourcePartitions": len({record["sourcePartitionId"] for record in selected}),
        "maxPerSource": max_per_source,
        "featureCount": next(iter(feature_widths)),
        "buildSha": resolved_identity[0],
        "dexHash": resolved_identity[1],
        "dictionaryHash": resolved_identity[2],
        "excluded": dict(sorted(reasons.items())),
    }


def make_loader(
    examples: list,
    seed: int,
    *,
    shuffle: bool,
    batch_size: int,
    generator: torch.Generator | None = None,
) -> DataLoader:
    return DataLoader(
        DecisionDataset(examples),
        batch_size=batch_size,
        shuffle=shuffle,
        collate_fn=partial(collate, history_length=0),
        generator=generator if generator is not None else torch.Generator().manual_seed(seed),
        num_workers=0,
    )


def identity_from_sample(sample: dict[str, Any]) -> tuple[str, str, str]:
    return tuple(str(sample[name]) for name in ("buildSha", "dexHash", "dictionaryHash"))


def shuffled_labels(decisions: list[dict[str, Any]], seed: int) -> list[dict[str, Any]]:
    shuffled: list[dict[str, Any]] = []
    for decision in decisions:
        clone = copy.deepcopy(decision)
        candidates = clone["candidates"]
        digest = hashlib.sha256(f"{seed}:{clone['decisionId']}".encode()).digest()
        clone["chosenCandidateId"] = candidates[int.from_bytes(digest[:8], "big") % len(candidates)]["id"]
        shuffled.append(clone)
    return shuffled


def action_only_decisions(
    decisions: list[dict[str, Any]],
    feature_names: list[str],
) -> tuple[list[dict[str, Any]], list[int]]:
    action_feature_indices = [
        index
        for index, name in enumerate(feature_names)
        if name in ACTION_ONLY_FEATURES or name.startswith(ACTION_ONLY_FEATURE_PREFIXES)
    ]
    if not action_feature_indices:
        raise ValueError("data dictionary does not identify any action-only features")
    keep = set(action_feature_indices)
    stripped: list[dict[str, Any]] = []
    for decision in decisions:
        clone = copy.deepcopy(decision)
        for row in clone["candidateFeatures"]:
            values = row["values"]
            if len(values) != len(feature_names):
                raise ValueError("decision feature width does not match dictionary feature names")
            row["values"] = [value if index in keep else 0.0 for index, value in enumerate(values)]
            row["presence"] = [index in keep for index in range(len(values))]
        for row in clone["candidateTokenGroups"]:
            for group in ("actor", "targets", "destination", "field"):
                row["groups"][group] = []
            row["groups"]["action"] = [
                token for token in row["groups"]["action"] if token.startswith(ACTION_ONLY_TOKEN_PREFIXES)
            ]
        stripped.append(clone)
    return stripped, action_feature_indices


def build_examples(
    training_decisions: list[dict[str, Any]],
    evaluation_decisions: list[dict[str, Any]],
    dictionary: dict[str, Any],
) -> tuple[list, list, list[str]]:
    vocabulary, token_to_id = build_token_vocabulary(training_decisions, dictionary)
    training_examples = make_examples(
        training_decisions,
        [],
        loss_policy_weight=0.0,
        token_to_id=token_to_id,
        history_length=0,
        terminal_scope="episode",
        unknown_policy_weight=1.0,
    )
    evaluation_examples = make_examples(
        evaluation_decisions,
        [],
        loss_policy_weight=0.0,
        token_to_id=token_to_id,
        history_length=0,
        terminal_scope="episode",
        unknown_policy_weight=1.0,
    )
    return training_examples, evaluation_examples, vocabulary


def compact_config(feature_count: int, vocabulary_size: int) -> CandidateTransformerConfig:
    return CandidateTransformerConfig(
        feature_count=feature_count,
        token_vocabulary_size=vocabulary_size,
        d_model=128,
        layers=2,
        heads=4,
        feedforward=384,
        dropout=0.0,
        history_length=0,
        trajectory_layers=1,
    )


def train_policy(
    training_decisions: list[dict[str, Any]],
    evaluation_decisions: list[dict[str, Any]],
    dictionary: dict[str, Any],
    *,
    seed: int,
    epochs: int,
    batch_size: int,
    target_top1: float | None = None,
) -> tuple[dict[str, Any], CandidateSetTransformer, list]:
    training_examples, evaluation_examples, vocabulary = build_examples(
        training_decisions,
        evaluation_decisions,
        dictionary,
    )
    feature_mean, feature_std = feature_normalization(training_examples)
    config = compact_config(training_examples[0].full_feature_count, len(vocabulary))
    set_determinism(seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = CandidateSetTransformer(config, feature_mean, feature_std).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=0.0)
    scaler = torch.amp.GradScaler(device.type, enabled=device.type == "cuda")
    train_loader = make_loader(training_examples, seed, shuffle=True, batch_size=batch_size)
    evaluation_loader = make_loader(evaluation_examples, seed + 1, shuffle=False, batch_size=batch_size)
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
        if target_top1 is not None and final_metrics["top1"] is not None and final_metrics["top1"] >= target_top1:
            break
    return (
        {
            "epochsRun": len(history),
            "final": final_metrics,
            "curve": history,
            "device": device.type,
            "parameters": parameter_count(model),
            "architecture": asdict(config),
            "tokenVocabularySize": len(vocabulary),
        },
        model,
        evaluation_examples,
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
    metrics, model, _ = train_policy(
        decisions,
        decisions,
        dictionary,
        seed=seed,
        epochs=epochs,
        batch_size=batch_size,
        target_top1=target_top1,
    )
    final_metrics = metrics["final"]
    return (
        {
            **metrics,
            "passed": bool(final_metrics.get("top1") is not None and final_metrics["top1"] >= target_top1),
            "targetTop1": target_top1,
        },
        model,
    )


def inference_contract_checks(
    model: CandidateSetTransformer,
    examples: list,
    *,
    tolerance: float = 1e-5,
    relative_tolerance: float = 1e-5,
) -> dict[str, Any]:
    device = next(model.parameters()).device
    batch = collate(examples[: min(16, len(examples))], history_length=0)
    model.eval()
    with torch.inference_mode():
        baseline_logits, baseline_values = model_forward(model, batch, device)

        batch_size, candidate_count = batch["mask"].shape
        permutations = []
        for row in batch["mask"]:
            real_count = int(row.sum())
            permutations.append([*reversed(range(real_count)), *range(real_count, candidate_count)])
        permutation = torch.tensor(permutations, dtype=torch.long)
        permuted = dict(batch)
        for key in ("features", "featurePresence"):
            gather = permutation[:, :, None].expand_as(batch[key])
            permuted[key] = batch[key].gather(1, gather)
        for key in ("mask",):
            permuted[key] = batch[key].gather(1, permutation)
        for key in ("tokenIds", "tokenMask"):
            gather = permutation[:, :, None, None].expand_as(batch[key])
            permuted[key] = batch[key].gather(1, gather)
        permuted_logits, permuted_values = model_forward(model, permuted, device)
        expected_permuted_logits = baseline_logits.gather(1, permutation.to(device))
        order_logit_difference = float((permuted_logits - expected_permuted_logits).abs().max().cpu())
        order_value_difference = float((permuted_values - baseline_values).abs().max().cpu())
        baseline_probabilities = torch.softmax(baseline_logits, dim=-1)
        permuted_probabilities = torch.softmax(permuted_logits, dim=-1)
        expected_permuted_probabilities = baseline_probabilities.gather(1, permutation.to(device))
        order_probability_difference = float(
            (permuted_probabilities - expected_permuted_probabilities).abs().max().cpu()
        )
        selected_candidate_mismatches = int(
            (permuted_logits.argmax(dim=-1) != expected_permuted_logits.argmax(dim=-1)).sum().cpu()
        )
        order_logits_close = bool(
            torch.allclose(
                permuted_logits,
                expected_permuted_logits,
                atol=tolerance,
                rtol=relative_tolerance,
            )
        )
        order_probabilities_close = bool(
            torch.allclose(
                permuted_probabilities,
                expected_permuted_probabilities,
                atol=tolerance,
                rtol=relative_tolerance,
            )
        )
        order_values_close = bool(
            torch.allclose(
                permuted_values,
                baseline_values,
                atol=tolerance,
                rtol=relative_tolerance,
            )
        )

        padded = dict(batch)
        padded["features"] = torch.cat(
            [batch["features"], torch.full_like(batch["features"][:, :1], 12345.0)],
            dim=1,
        )
        padded["featurePresence"] = torch.cat(
            [batch["featurePresence"], torch.ones_like(batch["featurePresence"][:, :1])],
            dim=1,
        )
        padded["mask"] = torch.cat(
            [batch["mask"], torch.zeros_like(batch["mask"][:, :1])],
            dim=1,
        )
        padding_tokens = torch.full_like(batch["tokenIds"][:, :1], max(1, model.config.token_vocabulary_size - 1))
        padded["tokenIds"] = torch.cat([batch["tokenIds"], padding_tokens], dim=1)
        padded["tokenMask"] = torch.cat(
            [batch["tokenMask"], torch.ones_like(batch["tokenMask"][:, :1])],
            dim=1,
        )
        padded_logits, padded_values = model_forward(model, padded, device)
        padding_logit_difference = float(
            (padded_logits[:, :candidate_count] - baseline_logits).abs().max().cpu()
        )
        padding_value_difference = float((padded_values - baseline_values).abs().max().cpu())
        probabilities = torch.softmax(padded_logits, dim=-1)
        illegal_maximum = float(probabilities.masked_select(~padded["mask"].to(device)).max().cpu())
        padding_logits_close = bool(
            torch.allclose(
                padded_logits[:, :candidate_count],
                baseline_logits,
                atol=tolerance,
                rtol=relative_tolerance,
            )
        )
        padding_values_close = bool(
            torch.allclose(
                padded_values,
                baseline_values,
                atol=tolerance,
                rtol=relative_tolerance,
            )
        )

    passed = (
        order_logits_close
        and order_probabilities_close
        and order_values_close
        and selected_candidate_mismatches == 0
        and padding_logits_close
        and padding_values_close
        and illegal_maximum <= 1e-12
    )
    return {
        "passed": passed,
        "absoluteTolerance": tolerance,
        "relativeTolerance": relative_tolerance,
        "candidateOrder": {
            "maximumLogitDifference": order_logit_difference,
            "maximumProbabilityDifference": order_probability_difference,
            "maximumValueDifference": order_value_difference,
            "logitsWithinTolerance": order_logits_close,
            "probabilitiesWithinTolerance": order_probabilities_close,
            "valuesWithinTolerance": order_values_close,
            "selectedCandidateMismatches": selected_candidate_mismatches,
        },
        "padding": {
            "maximumLogitDifference": padding_logit_difference,
            "maximumValueDifference": padding_value_difference,
            "logitsWithinTolerance": padding_logits_close,
            "valuesWithinTolerance": padding_values_close,
        },
        "illegalCandidateMaximumProbability": illegal_maximum,
    }


def deterministic_resume_check(
    decisions: list[dict[str, Any]],
    dictionary: dict[str, Any],
    *,
    seed: int,
    batch_size: int,
) -> dict[str, Any]:
    examples, _, vocabulary = build_examples(decisions, decisions, dictionary)
    examples = examples[: min(128, len(examples))]
    feature_mean, feature_std = feature_normalization(examples)
    config = CandidateTransformerConfig(
        feature_count=examples[0].full_feature_count,
        token_vocabulary_size=len(vocabulary),
        d_model=32,
        layers=1,
        heads=4,
        feedforward=96,
        dropout=0.0,
        history_length=0,
        trajectory_layers=1,
    )
    device = torch.device("cpu")
    set_determinism(seed)
    uninterrupted = CandidateSetTransformer(config, feature_mean, feature_std).to(device)
    uninterrupted_optimizer = torch.optim.AdamW(uninterrupted.parameters(), lr=1e-3, weight_decay=0.0)
    uninterrupted_scaler = torch.amp.GradScaler("cpu", enabled=False)
    uninterrupted_generator = torch.Generator().manual_seed(seed)
    uninterrupted_loader = make_loader(
        examples,
        seed,
        shuffle=True,
        batch_size=min(batch_size, len(examples)),
        generator=uninterrupted_generator,
    )
    train_epoch(
        uninterrupted,
        uninterrupted_loader,
        uninterrupted_optimizer,
        device,
        0.0,
        1.0,
        False,
        uninterrupted_scaler,
    )
    resume_state = capture_training_resume_state(
        uninterrupted,
        uninterrupted_optimizer,
        uninterrupted_scaler,
        uninterrupted_generator,
    )
    expected_losses = train_epoch(
        uninterrupted,
        uninterrupted_loader,
        uninterrupted_optimizer,
        device,
        0.0,
        1.0,
        False,
        uninterrupted_scaler,
    )

    set_determinism(seed + 1)
    resumed = CandidateSetTransformer(config, feature_mean, feature_std).to(device)
    resumed_optimizer = torch.optim.AdamW(resumed.parameters(), lr=1e-3, weight_decay=0.0)
    resumed_scaler = torch.amp.GradScaler("cpu", enabled=False)
    resumed_generator = torch.Generator()
    restore_training_resume_state(
        resume_state,
        resumed,
        resumed_optimizer,
        resumed_scaler,
        resumed_generator,
    )
    resumed_loader = make_loader(
        examples,
        seed,
        shuffle=True,
        batch_size=min(batch_size, len(examples)),
        generator=resumed_generator,
    )
    actual_losses = train_epoch(
        resumed,
        resumed_loader,
        resumed_optimizer,
        device,
        0.0,
        1.0,
        False,
        resumed_scaler,
    )
    evaluation_batch = collate(examples, history_length=0)
    uninterrupted.eval()
    resumed.eval()
    with torch.inference_mode():
        expected_predictions = model_forward(uninterrupted, evaluation_batch, device)
        actual_predictions = model_forward(resumed, evaluation_batch, device)
    prediction_difference = max(
        float((expected - actual).abs().max())
        for expected, actual in zip(expected_predictions, actual_predictions)
    )
    parameter_difference = max(
        float((uninterrupted.state_dict()[name] - resumed.state_dict()[name]).abs().max())
        for name in uninterrupted.state_dict()
    )
    loss_difference = max(abs(expected_losses[key] - actual_losses[key]) for key in expected_losses)
    passed = loss_difference == 0.0 and prediction_difference == 0.0 and parameter_difference == 0.0
    return {
        "passed": passed,
        "examples": len(examples),
        "maximumLossDifference": loss_difference,
        "maximumPredictionDifference": prediction_difference,
        "maximumParameterDifference": parameter_difference,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--dictionary", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--sample-out", type=Path)
    parser.add_argument("--select-only", action="store_true")
    parser.add_argument("--decisions", type=int, default=512)
    parser.add_argument("--validation-decisions", type=int, default=256)
    parser.add_argument("--max-per-source", type=int, default=8)
    parser.add_argument("--epochs", type=int, default=120)
    parser.add_argument("--shuffled-epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--seed", type=int, default=20260804)
    parser.add_argument("--target-top1", type=float, default=0.99)
    parser.add_argument("--chance-tolerance", type=float, default=0.10)
    parser.add_argument("--state-collapse-delta", type=float, default=0.15)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if (
        args.decisions < 1
        or args.validation_decisions < 1
        or args.max_per_source < 1
        or args.epochs < 1
        or args.shuffled_epochs < 1
        or args.batch_size < 1
    ):
        raise ValueError("decision, source-cap, epoch, and batch-size values must be positive")
    if not 0 < args.target_top1 <= 1:
        raise ValueError("target top-1 must be in (0, 1]")
    if not 0 <= args.chance_tolerance < 1 or not 0 < args.state_collapse_delta < 1:
        raise ValueError("chance tolerance and state-collapse delta must be probabilities")
    decisions, training_sample = select_decisions(args.data, args.decisions, args.max_per_source)
    validation_decisions, validation_sample = select_decisions(
        args.data,
        args.validation_decisions,
        args.max_per_source,
        split="validation",
        selected_identity=identity_from_sample(training_sample),
    )
    if args.sample_out is not None:
        sample_path = args.sample_out.resolve()
        report_root = args.report.resolve().parent
        if sample_path == args.report.resolve() or sample_path.is_relative_to(report_root):
            raise ValueError("private sample output must be outside the sanitized report directory")
        sample_path.parent.mkdir(parents=True, exist_ok=True)
        sample_path.write_text(
            "".join(
                f"{json.dumps(record, separators=(',', ':'))}\n"
                for record in [*decisions, *validation_decisions]
            ),
            encoding="utf-8",
        )
    if args.select_only:
        report = {
            "reportVersion": 2,
            "gate": "real-contract-v4-sample-selection",
            "privacy": {
                "rawRecordsIncluded": False,
                "rawIdentifiersIncluded": False,
                "privateSampleWritten": args.sample_out is not None,
            },
            "samples": {
                "training": training_sample,
                "validation": validation_sample,
            },
        }
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2, sort_keys=True))
        return
    if args.dictionary is None:
        raise ValueError("--dictionary is required unless --select-only is used")
    dictionary = json.loads(args.dictionary.read_text(encoding="utf-8"))
    dictionary_hash = hashlib.sha256(args.dictionary.read_bytes()).hexdigest()
    if dictionary_hash != training_sample["dictionaryHash"]:
        raise ValueError(
            f"dictionary hash mismatch: selected {training_sample['dictionaryHash']}, received {dictionary_hash}"
        )
    feature_names = dictionary.get("features", {}).get("names")
    if (
        dictionary.get("features", {}).get("schemaVersion") != 4
        or not isinstance(feature_names, list)
        or not all(isinstance(name, str) for name in feature_names)
        or len(feature_names) != training_sample["featureCount"]
    ):
        raise ValueError("dictionary does not contain the selected contract-v4 feature names")
    memorization, trained_model = train_to_memorization(
        decisions,
        dictionary,
        seed=args.seed,
        epochs=args.epochs,
        batch_size=args.batch_size,
        target_top1=args.target_top1,
    )
    _, trained_examples, _ = build_examples(decisions, decisions, dictionary)
    inference_contract = inference_contract_checks(trained_model, trained_examples)

    shuffled_metrics, _, _ = train_policy(
        shuffled_labels(decisions, args.seed),
        validation_decisions,
        dictionary,
        seed=args.seed + 10,
        epochs=args.shuffled_epochs,
        batch_size=args.batch_size,
    )
    chance_top1 = sum(1.0 / len(decision["candidates"]) for decision in validation_decisions) / len(
        validation_decisions
    )
    shuffled_top1 = shuffled_metrics["final"].get("top1")
    shuffled_gate = {
        **shuffled_metrics,
        "chanceTop1": chance_top1,
        "tolerance": args.chance_tolerance,
        "passed": bool(
            shuffled_top1 is not None
            and math.isfinite(shuffled_top1)
            and shuffled_top1 <= chance_top1 + args.chance_tolerance
        ),
    }

    action_only, retained_action_features = action_only_decisions(decisions, feature_names)
    action_only_metrics, _, _ = train_policy(
        action_only,
        action_only,
        dictionary,
        seed=args.seed + 20,
        epochs=memorization["epochsRun"],
        batch_size=args.batch_size,
    )
    clean_top1 = memorization["final"].get("top1")
    action_only_top1 = action_only_metrics["final"].get("top1")
    collapse = (
        clean_top1 - action_only_top1
        if clean_top1 is not None and action_only_top1 is not None
        else None
    )
    state_ablation = {
        **action_only_metrics,
        "retainedActionFeatureCount": len(retained_action_features),
        "removedStateFeatureCount": len(feature_names) - len(retained_action_features),
        "top1Collapse": collapse,
        "requiredCollapse": args.state_collapse_delta,
        "passed": bool(collapse is not None and collapse >= args.state_collapse_delta),
    }
    resume = deterministic_resume_check(
        decisions,
        dictionary,
        seed=args.seed + 30,
        batch_size=args.batch_size,
    )
    gates = {
        "memorization": memorization["passed"],
        "shuffledLabels": shuffled_gate["passed"],
        "stateAblation": state_ablation["passed"],
        "inferenceContract": inference_contract["passed"],
        "deterministicResume": resume["passed"],
    }
    report = {
        "reportVersion": 2,
        "gate": "real-contract-v4-learning-sanity",
        "privacy": {
            "rawRecordsIncluded": False,
            "rawIdentifiersIncluded": False,
        },
        "samples": {
            "training": training_sample,
            "validation": validation_sample,
        },
        "memorization": memorization,
        "shuffledLabels": shuffled_gate,
        "stateAblation": state_ablation,
        "inferenceContract": inference_contract,
        "deterministicResume": resume,
        "gates": gates,
        "passed": all(gates.values()),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    if not report["passed"]:
        failed = ", ".join(name for name, passed in gates.items() if not passed)
        raise SystemExit(f"real-data learning sanity gates failed: {failed}")


if __name__ == "__main__":
    main()
