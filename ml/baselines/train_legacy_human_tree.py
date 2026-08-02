#!/usr/bin/env python3
"""Train a move-ranking tree from legacy schema-v1 human telemetry."""

from __future__ import annotations

import argparse
import json
import math
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from scipy import sparse
from sklearn.ensemble import ExtraTreesClassifier, RandomForestClassifier

FEATURE_SCHEMA_VERSION = 2
ARTIFACT_SCHEMA_VERSION = 1
EXPECTED_POLICY_SOURCE = "human-v1"
EXPECTED_SPLITS = {"train", "validation", "test"}


def read_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as source:
        for line_number, line in enumerate(source, 1):
            if line.strip():
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as error:
                    raise ValueError(f"{path}:{line_number}: invalid JSON") from error


def fnv1a(token: str) -> int:
    value = 2166136261
    encoded = token.encode("utf-16le")
    for index in range(0, len(encoded), 2):
        value ^= int.from_bytes(encoded[index : index + 2], "little")
        value = (value * 16777619) & 0xFFFFFFFF
    return value


def ratio(value: Any, scale: float) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 0.0
    return numeric / scale if math.isfinite(numeric) and scale > 0 else 0.0


@dataclass(frozen=True)
class MaterializedDecision:
    decision_id: str
    source_partition: str
    split: str
    candidate_features: tuple[dict[int, float], ...]
    chosen_index: int


class LegacyFeatureEncoder:
    def __init__(self, dictionary: dict[str, Any]) -> None:
        features = dictionary.get("features", {})
        if features.get("schemaVersion") != FEATURE_SCHEMA_VERSION:
            raise ValueError(f"dictionary has unsupported feature schema {features.get('schemaVersion')}")
        self.feature_names = list(features.get("names", []))
        if not self.feature_names:
            raise ValueError("dictionary has no runtime feature names")
        self.runtime_index = {name: index for index, name in enumerate(self.feature_names)}
        self.moves = {int(key): value for key, value in dictionary.get("moves", {}).items()}
        self.species = dictionary.get("speciesForms", {})
        selected_prefixes = (
            "format_",
            "weather_",
            "terrain_",
            "actor_stage_",
            "actor_type_",
            "actor_species_hash_",
            "actor_ability_hash_",
            "actor_item_hash_",
            "move_category_",
            "move_type_",
            "move_id_hash_",
        )
        selected_names = {
            "wave_ratio",
            "turn_ratio",
            "opponent_active_alive_ratio",
            "opponent_mean_hp_ratio",
            "actor_hp_ratio",
            "actor_statused",
            "actor_level_ratio",
            "actor_held_item_count_ratio",
            "actor_innate_count_ratio",
            "actor_active_ability_count_ratio",
            "action_move",
            "move_power_ratio",
            "move_accuracy_ratio",
            "move_priority_ratio",
            "move_pp_remaining_ratio",
            "move_current_stab",
        }
        selected_names.update(name for name in self.feature_names if name.startswith(selected_prefixes))
        self.compact_runtime_indices = tuple(
            index for index, name in enumerate(self.feature_names) if name in selected_names
        )
        self.compact_by_runtime = {
            runtime_index: compact_index
            for compact_index, runtime_index in enumerate(self.compact_runtime_indices)
        }

    def _put(self, row: dict[int, float], name: str, value: float) -> None:
        runtime_index = self.runtime_index.get(name)
        compact_index = self.compact_by_runtime.get(runtime_index) if runtime_index is not None else None
        if compact_index is not None and value != 0 and math.isfinite(value):
            row[compact_index] = float(value)

    def _hash(self, row: dict[int, float], prefix: str, token: str, buckets: int) -> None:
        self._put(row, f"{prefix}_{fnv1a(token) % buckets}", 1.0)

    def _species_types(self, mon: dict[str, Any]) -> set[int]:
        entry = self.species.get(f"{mon.get('species')}:{mon.get('form', 0)}", {})
        return {int(value) for value in entry.get("types", [])}

    def base(self, event: dict[str, Any], actor: dict[str, Any]) -> dict[int, float]:
        state = event["state"]
        row: dict[int, float] = {}
        self._put(row, "wave_ratio", ratio(state.get("wave", event.get("wave")), 200))
        self._put(row, "turn_ratio", ratio(state.get("turn"), 50))
        format_index = max(0, min(2, len(state.get("player", [])) - 1))
        self._put(row, f"format_{format_index}", 1.0)
        self._put(row, f"weather_{int(state.get('weather') or 0)}", 1.0)
        self._put(row, f"terrain_{int(state.get('terrain') or 0)}", 1.0)
        enemies = [mon for mon in state.get("enemy", []) if not mon.get("fainted", False)]
        self._put(row, "opponent_active_alive_ratio", ratio(len(enemies), max(1, len(state.get("enemy", [])))))
        if enemies:
            mean_hp = np.mean([ratio(mon.get("hp"), max(1, mon.get("maxHp", 1))) for mon in enemies])
            self._put(row, "opponent_mean_hp_ratio", float(mean_hp))
        self._put(row, "actor_hp_ratio", ratio(actor.get("hp"), max(1, actor.get("maxHp", 1))))
        self._put(row, "actor_statused", float(actor.get("status") is not None))
        self._put(row, "actor_level_ratio", ratio(actor.get("level"), 200))
        self._put(row, "actor_held_item_count_ratio", ratio(len(actor.get("heldItems", [])), 12))
        innates = [ability for ability in actor.get("innates", []) if ability is not None]
        self._put(row, "actor_innate_count_ratio", ratio(len(innates), 6))
        self._put(row, "actor_active_ability_count_ratio", ratio(1 + len(innates), 6))
        for index, stage in enumerate(actor.get("statStages", [])[:7]):
            self._put(row, f"actor_stage_{index}", ratio(stage, 6))
        types = self._species_types(actor)
        for type_id in types:
            self._put(row, f"actor_type_{type_id}", 1.0)
        self._hash(row, "actor_species_hash", f"{actor.get('species')}:{actor.get('form', 0)}", 256)
        self._hash(row, "actor_ability_hash", f"active:-1:{actor.get('ability')}", 256)
        for slot, ability in enumerate(actor.get("innates", [])):
            if ability is not None:
                source = "gift" if slot >= 3 else "innate"
                self._hash(row, "actor_ability_hash", f"{source}:{slot}:{ability}", 256)
        for item in actor.get("heldItems", []):
            self._hash(row, "actor_item_hash", str(item), 128)
        return row

    def candidate(self, base: dict[int, float], actor: dict[str, Any], move: dict[str, Any]) -> dict[int, float]:
        row = dict(base)
        move_id = int(move["move"])
        definition = self.moves.get(move_id, {})
        move_type = int(move.get("type", definition.get("types", [0])[0] if definition.get("types") else 0))
        self._put(row, "action_move", 1.0)
        self._put(row, "move_power_ratio", ratio(move.get("power", definition.get("power")), 250))
        self._put(row, "move_accuracy_ratio", ratio(definition.get("accuracy"), 100))
        self._put(row, "move_priority_ratio", ratio(definition.get("priority"), 7))
        remaining = max(0, int(move.get("maxPp", 0)) - int(move.get("ppUsed", 0)))
        self._put(row, "move_pp_remaining_ratio", ratio(remaining, max(1, move.get("maxPp", 1))))
        if "split" in definition:
            self._put(row, f"move_category_{int(definition['split'])}", 1.0)
        self._put(row, f"move_type_{move_type}", 1.0)
        self._hash(row, "move_id_hash", str(move_id), 256)
        self._put(row, "move_current_stab", float(move_type in self._species_types(actor)))
        return row


def validate_record(record: dict[str, Any], expected_environment: str) -> None:
    if record.get("sourceEnvironment") != expected_environment:
        raise ValueError("telemetry source environment does not match the requested environment")
    if record.get("policySource") != EXPECTED_POLICY_SOURCE or record.get("policyTarget") is not True:
        raise ValueError("legacy behavior-cloning input must contain human-v1 policy targets")
    if record.get("terminalOutcomeKnown") is not False or record.get("terminalOutcome") != "unknown":
        raise ValueError("legacy records must remain terminal-outcome-unknown")
    if record.get("sourceSplit") not in EXPECTED_SPLITS:
        raise ValueError("legacy record has no deterministic source split")
    if record.get("sourcePartitionId") != record.get("splitGroupId"):
        raise ValueError("legacy record split group must be its playerIdHash partition")


def materialize_record(
    record: dict[str, Any], encoder: LegacyFeatureEncoder
) -> tuple[MaterializedDecision | None, str | None]:
    event = record.get("event", {})
    action = event.get("action", {})
    if action.get("kind") != "move":
        return None, str(action.get("kind", "invalid"))
    players = event.get("state", {}).get("player", [])
    actor_slot = int(event.get("slotFieldIndex", -1))
    if actor_slot < 0 or actor_slot >= len(players):
        return None, "missing-actor"
    actor = players[actor_slot]
    moves = actor.get("moves", [])
    chosen_slot = int(action.get("moveIndex", -1))
    if chosen_slot < 0 or chosen_slot >= len(moves) or int(moves[chosen_slot].get("move", -1)) != int(
        action.get("moveId", -2)
    ):
        matches = [index for index, move in enumerate(moves) if int(move.get("move", -1)) == int(action.get("moveId", -2))]
        if len(matches) != 1:
            return None, "unmatched-move"
        chosen_slot = matches[0]
    legal_slots = [
        index
        for index, move in enumerate(moves)
        if index == chosen_slot or int(move.get("maxPp", 0)) - int(move.get("ppUsed", 0)) > 0
    ]
    if chosen_slot not in legal_slots:
        return None, "unmatched-move"
    base = encoder.base(event, actor)
    features = tuple(encoder.candidate(base, actor, moves[index]) for index in legal_slots)
    return (
        MaterializedDecision(
            decision_id=str(record["decisionId"]),
            source_partition=str(record["sourcePartitionId"]),
            split=str(record["sourceSplit"]),
            candidate_features=features,
            chosen_index=legal_slots.index(chosen_slot),
        ),
        None,
    )


def to_matrix(
    decisions: list[MaterializedDecision], feature_count: int
) -> tuple[sparse.csr_matrix, np.ndarray, np.ndarray, list[str]]:
    data: list[float] = []
    columns: list[int] = []
    row_offsets = [0]
    labels: list[int] = []
    weights: list[float] = []
    decision_ids: list[str] = []
    for decision in decisions:
        negative_count = max(1, len(decision.candidate_features) - 1)
        for candidate_index, features in enumerate(decision.candidate_features):
            for column, value in sorted(features.items()):
                columns.append(column)
                data.append(value)
            row_offsets.append(len(data))
            chosen = candidate_index == decision.chosen_index
            labels.append(int(chosen))
            weights.append(0.5 if chosen and len(decision.candidate_features) > 1 else (1.0 if chosen else 0.5 / negative_count))
            decision_ids.append(decision.decision_id)
    matrix = sparse.csr_matrix(
        (np.asarray(data, dtype=np.float32), np.asarray(columns), np.asarray(row_offsets)),
        shape=(len(labels), feature_count),
        dtype=np.float32,
    )
    return matrix, np.asarray(labels, dtype=np.int8), np.asarray(weights, dtype=np.float64), decision_ids


def ranking_metrics(scores: np.ndarray, labels: np.ndarray, decision_ids: list[str]) -> dict[str, float | int]:
    grouped: dict[str, list[int]] = defaultdict(list)
    for index, decision_id in enumerate(decision_ids):
        grouped[decision_id].append(index)
    top1 = 0
    reciprocal_ranks: list[float] = []
    nll: list[float] = []
    for indices in grouped.values():
        selected = next(index for index in indices if labels[index] == 1)
        ordered = sorted(indices, key=lambda index: (-scores[index], index))
        rank = ordered.index(selected) + 1
        top1 += int(rank == 1)
        reciprocal_ranks.append(1 / rank)
        logits = scores[indices] - np.max(scores[indices])
        probabilities = np.exp(logits) / np.exp(logits).sum()
        nll.append(-math.log(max(1e-12, probabilities[indices.index(selected)])))
    count = len(grouped)
    return {
        "decisions": count,
        "top1": top1 / max(1, count),
        "mrr": float(np.mean(reciprocal_ranks)) if reciprocal_ranks else 0.0,
        "candidateNll": float(np.mean(nll)) if nll else 0.0,
    }


def export_forest(
    name: str,
    model: Any,
    runtime_feature_indices: tuple[int, ...],
    runtime_feature_count: int,
) -> dict[str, Any]:
    trees = []
    for estimator in model.estimators_:
        tree = estimator.tree_
        nodes = []
        for index in range(tree.node_count):
            if tree.children_left[index] < 0:
                values = np.asarray(tree.value[index]).reshape(-1)
                total = float(values.sum())
                value = float(values[-1] / total) if total > 0 else 0.0
                nodes.append({"feature": -1, "threshold": 0.0, "left": -1, "right": -1, "value": value})
            else:
                nodes.append(
                    {
                        "feature": runtime_feature_indices[int(tree.feature[index])],
                        "threshold": float(tree.threshold[index]),
                        "left": int(tree.children_left[index]),
                        "right": int(tree.children_right[index]),
                    }
                )
        trees.append(nodes)
    return {
        "schemaVersion": ARTIFACT_SCHEMA_VERSION,
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
        "featureCount": runtime_feature_count,
        "modelName": name,
        "modelType": "sklearn_forest",
        "aggregation": "mean",
        "baseScore": 0.0,
        "trees": trees,
        "trainingRole": "policy-target",
        "policySource": EXPECTED_POLICY_SOURCE,
        "trainingDataSchema": "legacy-v1",
        "terminalOutcomeKnown": False,
        "candidateScope": "move-only",
    }


def models(seed: int, jobs: int) -> list[tuple[str, Any]]:
    common = {
        "n_estimators": 160,
        "max_depth": 20,
        "min_samples_leaf": 4,
        "max_features": "sqrt",
        "n_jobs": jobs,
        "random_state": seed,
    }
    return [
        ("legacy_human_random_forest", RandomForestClassifier(**common)),
        ("legacy_human_extra_trees", ExtraTreesClassifier(**common)),
    ]


def train(args: argparse.Namespace) -> dict[str, Any]:
    dictionary = json.loads(args.dictionary.read_text(encoding="utf-8"))
    encoder = LegacyFeatureEncoder(dictionary)
    decisions: list[MaterializedDecision] = []
    exclusions: Counter[str] = Counter()
    source_splits: dict[str, str] = {}
    input_records = 0
    for record in read_jsonl(args.decisions):
        input_records += 1
        validate_record(record, args.environment)
        source = str(record["sourcePartitionId"])
        split = str(record["sourceSplit"])
        if source in source_splits and source_splits[source] != split:
            raise ValueError(f"source partition {source} appears in multiple splits")
        source_splits[source] = split
        decision, exclusion = materialize_record(record, encoder)
        if decision is None:
            exclusions[exclusion or "invalid"] += 1
        else:
            decisions.append(decision)
    if not decisions:
        raise ValueError("no legacy human move decisions were materialized")
    by_split = {split: [decision for decision in decisions if decision.split == split] for split in EXPECTED_SPLITS}
    if not by_split["train"] or not by_split["validation"] or not by_split["test"]:
        raise ValueError("train, validation, and test must all contain move decisions")

    matrices = {
        split: to_matrix(rows, len(encoder.compact_runtime_indices)) for split, rows in by_split.items()
    }
    leaderboard = []
    artifacts = {}
    train_x, train_y, train_weights, _ = matrices["train"]
    for name, model in models(args.seed, args.jobs):
        started = time.perf_counter()
        model.fit(train_x, train_y, sample_weight=train_weights)
        train_seconds = time.perf_counter() - started
        split_metrics = {}
        for split in ("validation", "test"):
            matrix, labels, _, decision_ids = matrices[split]
            scores = model.predict_proba(matrix)[:, 1]
            split_metrics[split] = ranking_metrics(scores, labels, decision_ids)
        artifact = export_forest(
            name,
            model,
            encoder.compact_runtime_indices,
            len(encoder.feature_names),
        )
        artifacts[name] = artifact
        leaderboard.append({"model": name, "trainSeconds": train_seconds, **split_metrics})
    selected = sorted(
        leaderboard,
        key=lambda row: (
            -row["validation"]["top1"],
            row["validation"]["candidateNll"],
            row["model"],
        ),
    )[0]["model"]
    args.out.mkdir(parents=True, exist_ok=True)
    for name, artifact in artifacts.items():
        (args.out / f"{name}.json").write_text(json.dumps(artifact, separators=(",", ":")) + "\n", encoding="utf-8")
    (args.out / "selected-model.json").write_text(
        json.dumps(artifacts[selected], separators=(",", ":")) + "\n", encoding="utf-8"
    )
    report = {
        "schemaVersion": 1,
        "metricScope": "offline human move-choice imitation; not battle win rate",
        "trainingRole": "policy-target",
        "policySource": EXPECTED_POLICY_SOURCE,
        "sourceEnvironment": args.environment,
        "inputRecords": input_records,
        "materializedMoveDecisions": len(decisions),
        "excludedActions": dict(exclusions),
        "terminalOutcomeKnown": False,
        "candidateScope": "move-only",
        "limitations": [
            "legacy v1 has no legal-candidate set",
            "legacy v1 has no bench snapshots, so switch destinations are not trained",
            "legacy v1 target context is not used because candidate target sets cannot be reconstructed safely",
            "no victory, defeat, terminal value, or winner-only label is inferred",
        ],
        "runtimeFeatureSchemaVersion": FEATURE_SCHEMA_VERSION,
        "runtimeFeatureCount": len(encoder.feature_names),
        "trainedFeatureCount": len(encoder.compact_runtime_indices),
        "sourcePartitions": Counter(source_splits.values()),
        "decisionsBySplit": {split: len(rows) for split, rows in by_split.items()},
        "selectedModel": selected,
        "leaderboard": leaderboard,
    }
    (args.out / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return json.loads(json.dumps(report))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--decisions", type=Path, required=True)
    parser.add_argument("--dictionary", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--environment", choices=("staging", "production"), required=True)
    parser.add_argument("--seed", type=int, default=20260801)
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    print(json.dumps(train(args), indent=2))


if __name__ == "__main__":
    main()
