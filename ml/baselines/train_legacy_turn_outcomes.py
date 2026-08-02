#!/usr/bin/env python3
"""Train immediate turn-transition models from legacy schema-v1 telemetry."""

from __future__ import annotations

import argparse
import json
import math
import pickle
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.metrics import accuracy_score, mean_absolute_error, mean_squared_error, roc_auc_score

EXPECTED_SPLITS = {"train", "validation", "test"}
DIFFICULTIES = ("youngster", "ace", "elite", "hell")
WEATHER_COUNT = 14
TERRAIN_COUNT = 6
MOVE_TYPE_COUNT = 19
MOVE_HASH_BUCKETS = 64


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


def safe_ratio(value: Any, scale: Any) -> float:
    try:
        numerator = float(value)
        denominator = float(scale)
    except (TypeError, ValueError):
        return 0.0
    return numerator / denominator if math.isfinite(numerator) and math.isfinite(denominator) and denominator > 0 else 0.0


def side_summary(mons: list[dict[str, Any]]) -> list[float]:
    if not mons:
        return [0.0] * 13
    hp = [safe_ratio(mon.get("hp"), max(1, mon.get("maxHp", 1))) for mon in mons]
    stages = [mon.get("statStages", []) for mon in mons]
    return [
        len(mons) / 3,
        sum(not mon.get("fainted", False) for mon in mons) / max(1, len(mons)),
        float(np.mean(hp)),
        float(np.min(hp)),
        sum(mon.get("status") is not None for mon in mons) / len(mons),
        float(np.mean([safe_ratio(mon.get("level"), 200) for mon in mons])),
        *[
            float(np.mean([safe_ratio(stage[index] if index < len(stage) else 0, 6) for stage in stages]))
            for index in range(7)
        ],
    ]


def state_hp(state: dict[str, Any], side: str) -> float:
    mons = state.get(side, [])
    return float(np.mean([safe_ratio(mon.get("hp"), max(1, mon.get("maxHp", 1))) for mon in mons])) if mons else 0.0


def feature_names() -> list[str]:
    names = ["wave_ratio", "turn_ratio"]
    names.extend(f"difficulty_{name}" for name in DIFFICULTIES)
    names.extend(f"weather_{index}" for index in range(WEATHER_COUNT))
    names.extend(f"terrain_{index}" for index in range(TERRAIN_COUNT))
    for side in ("player", "enemy"):
        names.extend(
            [
                f"{side}_count_ratio",
                f"{side}_alive_ratio",
                f"{side}_mean_hp",
                f"{side}_min_hp",
                f"{side}_status_ratio",
                f"{side}_mean_level_ratio",
                *(f"{side}_mean_stage_{index}" for index in range(7)),
            ]
        )
    names.extend(["action_move_count", "action_switch_count", "action_ball_count", "action_run_count"])
    names.extend(["chosen_move_mean_power_ratio", "chosen_move_max_power_ratio"])
    names.extend(f"chosen_move_type_{index}" for index in range(MOVE_TYPE_COUNT))
    names.extend(f"chosen_move_hash_{index}" for index in range(MOVE_HASH_BUCKETS))
    return names


FEATURE_NAMES = feature_names()


def turn_features(state: dict[str, Any], actions: list[dict[str, Any]], difficulty: str) -> np.ndarray:
    values: list[float] = [safe_ratio(state.get("wave"), 200), safe_ratio(state.get("turn"), 50)]
    values.extend(float(difficulty == name) for name in DIFFICULTIES)
    weather = int(state.get("weather") or 0)
    terrain = int(state.get("terrain") or 0)
    values.extend(float(weather == index) for index in range(WEATHER_COUNT))
    values.extend(float(terrain == index) for index in range(TERRAIN_COUNT))
    values.extend(side_summary(state.get("player", [])))
    values.extend(side_summary(state.get("enemy", [])))
    kinds = Counter(action.get("kind", "invalid") for action in actions)
    values.extend(float(kinds[kind]) for kind in ("move", "switch", "ball", "run"))
    chosen_moves = [action for action in actions if action.get("kind") == "move"]
    powers: list[float] = []
    move_types = [0.0] * MOVE_TYPE_COUNT
    move_hashes = [0.0] * MOVE_HASH_BUCKETS
    player = state.get("player", [])
    for action in chosen_moves:
        actor_slot = int(action.get("actorSlot", 0))
        move_index = int(action.get("moveIndex", -1))
        actor = player[actor_slot] if 0 <= actor_slot < len(player) else None
        moves = actor.get("moves", []) if actor else []
        move = moves[move_index] if 0 <= move_index < len(moves) else None
        if move:
            powers.append(safe_ratio(move.get("power"), 250))
            move_type = int(move.get("type", 0))
            if 0 <= move_type < MOVE_TYPE_COUNT:
                move_types[move_type] = 1.0
        move_hashes[fnv1a(str(action.get("moveId", -1))) % MOVE_HASH_BUCKETS] = 1.0
    values.extend([float(np.mean(powers)) if powers else 0.0, max(powers, default=0.0)])
    values.extend(move_types)
    values.extend(move_hashes)
    if len(values) != len(FEATURE_NAMES):
        raise ValueError(f"turn feature count mismatch: {len(values)}/{len(FEATURE_NAMES)}")
    return np.asarray(values, dtype=np.float32)


def validate_imported_record(record: dict[str, Any], environment: str) -> None:
    if record.get("sourceEnvironment") != environment:
        raise ValueError("turn outcome source environment mismatch")
    if record.get("sourceSplit") not in EXPECTED_SPLITS:
        raise ValueError("turn outcome has no deterministic source split")
    if record.get("sourcePartitionId") != record.get("splitGroupId"):
        raise ValueError("turn outcome is not partitioned by playerIdHash")
    if record.get("terminalOutcomeKnown") is not False or record.get("terminalOutcome") != "unknown":
        raise ValueError("legacy turn outcomes must remain terminal-outcome-unknown")


def turn_key(record: dict[str, Any]) -> tuple[str, int, int]:
    event = record["event"]
    state = event["state"]
    return str(record["sessionId"]), int(event.get("wave", state.get("wave", -1))), int(state.get("turn", event.get("turn", -1)))


def materialize_transitions(
    decisions_path: Path, outcomes_path: Path, environment: str
) -> tuple[dict[str, tuple[np.ndarray, np.ndarray]], dict[str, Any]]:
    turns: dict[tuple[str, int, int], dict[str, Any]] = {}
    source_splits: dict[str, str] = {}
    for record in read_jsonl(decisions_path):
        validate_imported_record(record, environment)
        source = str(record["sourcePartitionId"])
        split = str(record["sourceSplit"])
        if source in source_splits and source_splits[source] != split:
            raise ValueError(f"source partition {source} appears in multiple splits")
        source_splits[source] = split
        event = record["event"]
        key = turn_key(record)
        turn = turns.setdefault(
            key,
            {
                "source": source,
                "split": split,
                "difficulty": record.get("difficulty", "unknown"),
                "state": event["state"],
                "actions": [],
            },
        )
        action = dict(event.get("action", {}))
        action["actorSlot"] = event.get("slotFieldIndex", 0)
        turn["actions"].append(action)

    rows: dict[str, list[np.ndarray]] = defaultdict(list)
    targets: dict[str, list[np.ndarray]] = defaultdict(list)
    unmatched = 0
    for record in read_jsonl(outcomes_path):
        validate_imported_record(record, environment)
        key = turn_key(record)
        pre = turns.get(key)
        if pre is None:
            unmatched += 1
            continue
        event = record["event"]
        post_state = event["state"]
        faints = event.get("faints", [])
        rows[pre["split"]].append(turn_features(pre["state"], pre["actions"], pre["difficulty"]))
        targets[pre["split"]].append(
            np.asarray(
                [
                    state_hp(post_state, "player") - state_hp(pre["state"], "player"),
                    state_hp(post_state, "enemy") - state_hp(pre["state"], "enemy"),
                    sum(str(faint).startswith("p") for faint in faints),
                    sum(str(faint).startswith("e") for faint in faints),
                ],
                dtype=np.float32,
            )
        )
    materialized = {
        split: (
            np.stack(rows[split]) if rows[split] else np.empty((0, len(FEATURE_NAMES)), dtype=np.float32),
            np.stack(targets[split]) if targets[split] else np.empty((0, 4), dtype=np.float32),
        )
        for split in EXPECTED_SPLITS
    }
    report = {
        "matchedTransitions": sum(len(values) for values in rows.values()),
        "unmatchedTurnOutcomes": unmatched,
        "transitionsBySplit": {split: len(rows[split]) for split in EXPECTED_SPLITS},
        "sourcePartitionsBySplit": dict(Counter(source_splits.values())),
    }
    return materialized, report


def regression_metrics(target: np.ndarray, prediction: np.ndarray, train_mean: float) -> dict[str, float]:
    baseline = np.full_like(target, train_mean)
    return {
        "mae": float(mean_absolute_error(target, prediction)),
        "rmse": float(math.sqrt(mean_squared_error(target, prediction))),
        "meanBaselineMae": float(mean_absolute_error(target, baseline)),
    }


def train(args: argparse.Namespace) -> dict[str, Any]:
    materialized, data_report = materialize_transitions(args.decisions, args.outcomes, args.environment)
    train_x, train_y = materialized["train"]
    if len(train_x) == 0 or any(len(materialized[split][0]) == 0 for split in ("validation", "test")):
        raise ValueError("train, validation, and test must all contain matched transitions")
    targets = ("playerHpDelta", "enemyHpDelta", "playerFaints", "enemyFaints")
    models: dict[str, Any] = {}
    leaderboard: dict[str, Any] = {}
    started = time.perf_counter()
    for target_index, target_name in enumerate(targets):
        model = HistGradientBoostingRegressor(
            max_iter=180,
            learning_rate=0.06,
            max_leaf_nodes=31,
            l2_regularization=0.2,
            random_state=args.seed + target_index,
        )
        model.fit(train_x, train_y[:, target_index])
        models[target_name] = model
        leaderboard[target_name] = {}
        for split in ("validation", "test"):
            split_x, split_y = materialized[split]
            prediction = model.predict(split_x)
            leaderboard[target_name][split] = regression_metrics(
                split_y[:, target_index], prediction, float(np.mean(train_y[:, target_index]))
            )
    for side, target_index in (("playerAnyFaint", 2), ("enemyAnyFaint", 3)):
        train_labels = (train_y[:, target_index] > 0).astype(np.int8)
        if len(np.unique(train_labels)) < 2:
            continue
        model = HistGradientBoostingClassifier(
            max_iter=140,
            learning_rate=0.06,
            max_leaf_nodes=31,
            l2_regularization=0.2,
            random_state=args.seed + target_index + 100,
        )
        model.fit(train_x, train_labels)
        models[side] = model
        leaderboard[side] = {}
        for split in ("validation", "test"):
            split_x, split_y = materialized[split]
            labels = (split_y[:, target_index] > 0).astype(np.int8)
            probability = model.predict_proba(split_x)[:, 1]
            leaderboard[side][split] = {
                "accuracy": float(accuracy_score(labels, probability >= 0.5)),
                "rocAuc": float(roc_auc_score(labels, probability)) if len(np.unique(labels)) > 1 else None,
                "positiveRate": float(np.mean(labels)),
            }
    train_seconds = time.perf_counter() - started
    args.out.mkdir(parents=True, exist_ok=True)
    with (args.out / "legacy-turn-outcome-model.pkl").open("wb") as destination:
        pickle.dump(
            {
                "schemaVersion": 1,
                "trainingDataSchema": "legacy-v1",
                "terminalOutcomeKnown": False,
                "featureNames": FEATURE_NAMES,
                "models": models,
            },
            destination,
        )
    report = {
        "schemaVersion": 1,
        "metricScope": "immediate turn-transition prediction; not terminal value or battle win rate",
        "sourceEnvironment": args.environment,
        "terminalOutcomeKnown": False,
        "terminalLabelsInferred": False,
        "trainSeconds": train_seconds,
        "featureCount": len(FEATURE_NAMES),
        "data": data_report,
        "leaderboard": leaderboard,
    }
    (args.out / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return json.loads(json.dumps(report))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--decisions", type=Path, required=True)
    parser.add_argument("--outcomes", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--environment", choices=("staging", "production"), required=True)
    parser.add_argument("--seed", type=int, default=20260801)
    args = parser.parse_args()
    print(json.dumps(train(args), indent=2))


if __name__ == "__main__":
    main()
