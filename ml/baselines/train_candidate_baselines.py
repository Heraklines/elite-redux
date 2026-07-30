#!/usr/bin/env python3
"""Train inexpensive candidate rankers on versioned ER combat-decision JSONL."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pickle
import re
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

try:
    from lightgbm import LGBMClassifier, LGBMRanker
except ModuleNotFoundError:  # The core sklearn ladder remains locally runnable without the optional wheel.
    LGBMClassifier = None
    LGBMRanker = None

SCHEMA_VERSION = 2
FEATURE_SCHEMA_VERSION = 1
EPSILON = 1e-9
ROLLOUT_POLICY = "epsilon-tree-v1"
SUCCESSFUL_ROLLOUT_OUTCOMES = {"victory", "max-waves"}


def jsonl_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    return sorted(file for file in path.rglob("*.jsonl") if file.is_file())


def load_records(path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    decisions: list[dict[str, Any]] = []
    terminals: list[dict[str, Any]] = []
    for file in jsonl_files(path):
        with file.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                if not line.strip():
                    continue
                record = json.loads(line)
                if record.get("schemaVersion") != SCHEMA_VERSION:
                    raise ValueError(f"{file}:{line_number}: unsupported schema version")
                if record.get("kind") == "combat_decision":
                    validate_decision(record, file, line_number)
                    decisions.append(record)
                elif record.get("kind") == "episode_terminal":
                    terminals.append(record)
                else:
                    raise ValueError(f"{file}:{line_number}: unknown record kind")
    if not decisions:
        raise ValueError(f"no combat decisions found under {path}")
    validate_dataset(decisions, terminals)
    return decisions, terminals


def validate_decision(record: dict[str, Any], file: Path, line_number: int) -> None:
    candidates = record.get("candidates", [])
    ids = [candidate.get("id") for candidate in candidates]
    chosen = record.get("chosenCandidateId")
    prefix = f"{file}:{line_number}"
    if record.get("candidateScope") != "combat-command":
        raise ValueError(f"{prefix}: unsupported candidate scope")
    if len(ids) != len(set(ids)):
        raise ValueError(f"{prefix}: duplicate candidate ids")
    if ids.count(chosen) != 1:
        raise ValueError(f"{prefix}: chosen label does not map exactly once")
    if not record.get("episodeId") or not record.get("decisionId"):
        raise ValueError(f"{prefix}: missing episode/decision identity")
    feature_rows = record.get("candidateFeatures", [])
    feature_ids = [row.get("candidateId") for row in feature_rows]
    if record.get("featureSchemaVersion") != FEATURE_SCHEMA_VERSION:
        raise ValueError(f"{prefix}: unsupported feature schema")
    if len(feature_ids) != len(ids) or len(set(feature_ids)) != len(ids) or set(feature_ids) != set(ids):
        raise ValueError(f"{prefix}: candidate features do not map one-to-one")
    if any(not row.get("values") or not all(math.isfinite(float(value)) for value in row["values"]) for row in feature_rows):
        raise ValueError(f"{prefix}: candidate features must be finite and non-empty")
    for opponent in record.get("observation", {}).get("opponentActive", []):
        if opponent.get("heldItems") is not None:
            raise ValueError(f"{prefix}: opponent held items crossed the Battle Info visibility boundary")


def validate_dataset(decisions: list[dict[str, Any]], terminals: list[dict[str, Any]]) -> None:
    decision_ids = [record["decisionId"] for record in decisions]
    if len(decision_ids) != len(set(decision_ids)):
        raise ValueError("dataset contains duplicate decision ids")

    decision_episodes = Counter(record["episodeId"] for record in decisions)
    terminal_episodes = Counter(record.get("episodeId") for record in terminals)
    missing = sorted(set(decision_episodes) - set(terminal_episodes))
    extra = sorted(set(terminal_episodes) - set(decision_episodes))
    duplicated = sorted(episode for episode, count in terminal_episodes.items() if count != 1)
    if missing or extra or duplicated:
        raise ValueError(
            "episode terminal mismatch: "
            f"missing={missing}, extra={extra}, non_unique={duplicated}"
        )

    for identity in ("buildSha", "dexHash", "dictionaryHash"):
        values = {record.get(identity) for record in decisions + terminals}
        if len(values) != 1 or None in values or "unknown" in values:
            raise ValueError(f"dataset must have one known {identity}, found {sorted(map(str, values))}")

    groups_by_episode: dict[str, set[str]] = defaultdict(set)
    for record in decisions + terminals:
        groups_by_episode[record["episodeId"]].add(record_split_group(record))
    inconsistent = sorted(episode for episode, groups in groups_by_episode.items() if len(groups) != 1)
    if inconsistent:
        raise ValueError(f"episodes map to multiple split groups: {inconsistent}")


def validate_data_dictionary(path: Path, decisions: list[dict[str, Any]]) -> dict[str, int | str]:
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    dictionary = json.loads(raw)
    if dictionary.get("schemaVersion") != 2:
        raise ValueError(f"unsupported combat data dictionary schema {dictionary.get('schemaVersion')}")
    recorded_hashes = {record.get("dictionaryHash") for record in decisions}
    if recorded_hashes != {digest}:
        raise ValueError(f"dictionary hash mismatch: records={sorted(map(str, recorded_hashes))}, file={digest}")

    known_moves = {int(value) for value in dictionary.get("moves", {})}
    known_abilities = {int(value) for value in dictionary.get("abilities", {})}
    known_items = set(dictionary.get("items", {}))
    referenced_moves: set[int] = set()
    referenced_abilities: set[int] = set()
    referenced_items: set[str] = set()
    for decision in decisions:
        observation = decision["observation"]
        for pokemon in observation["selfParty"] + observation["opponentActive"]:
            ability = pokemon.get("ability")
            if ability is not None:
                referenced_abilities.add(int(ability))
            referenced_abilities.update(int(value) for value in pokemon.get("innates", []) if value is not None)
            referenced_moves.update(int(move["moveId"]) for move in pokemon.get("moves", []))
            held_items = pokemon.get("heldItems")
            if isinstance(held_items, list):
                referenced_items.update(str(value) for value in held_items)
        referenced_moves.update(
            int(candidate["moveId"])
            for candidate in decision["candidates"]
            if candidate.get("kind") == "move"
        )

    missing = {
        "moves": sorted(referenced_moves - known_moves),
        "abilities": sorted(referenced_abilities - known_abilities),
        "items": sorted(referenced_items - known_items),
    }
    if any(missing.values()):
        raise ValueError(f"combat data dictionary misses recorded runtime ids: {missing}")
    return {
        "sha256": digest,
        "moves": len(known_moves),
        "abilities": len(known_abilities),
        "items": len(known_items),
        "referencedMoves": len(referenced_moves),
        "referencedAbilities": len(referenced_abilities),
        "referencedItems": len(referenced_items),
    }


def select_elite_rollouts(
    decisions: list[dict[str, Any]], terminals: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    terminal_by_episode = {record["episodeId"]: record for record in terminals}
    rollout_episodes = {
        record["episodeId"] for record in decisions if record["sourcePolicy"] == ROLLOUT_POLICY
    }
    successful = {
        episode
        for episode in rollout_episodes
        if terminal_by_episode[episode]["outcome"] in SUCCESSFUL_ROLLOUT_OUTCOMES
    }
    selected = [
        record
        for record in decisions
        if record["sourcePolicy"] != ROLLOUT_POLICY or record["episodeId"] in successful
    ]
    if not selected:
        raise ValueError("elite rollout selection removed every decision")
    return selected, {
        "episodes": len(rollout_episodes),
        "successfulEpisodes": len(successful),
        "successRate": len(successful) / len(rollout_episodes) if rollout_episodes else None,
        "decisionsBeforeSelection": len(decisions),
        "decisionsAfterSelection": len(selected),
    }


def active_mon(observation: dict[str, Any], slot: int) -> dict[str, Any]:
    for mon in observation["selfParty"]:
        if mon.get("activeSlot") == slot:
            return mon
    raise ValueError(f"no active self mon for slot {slot}")


def embedded_candidate_features(decision: dict[str, Any], candidate: dict[str, Any]) -> list[float]:
    by_id = {row["candidateId"]: row["values"] for row in decision["candidateFeatures"]}
    return [float(value) for value in by_id[candidate["id"]]]


def record_split_group(record: dict[str, Any]) -> str:
    explicit = record.get("splitGroupId")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    episode_id = record["episodeId"]
    legacy_pilot = re.fullmatch(r"pilot-(\d+)", episode_id)
    if legacy_pilot:
        return f"pilot-pair-{int(legacy_pilot.group(1)) // 2}"
    return episode_id


def make_rows(
    decisions: list[dict[str, Any]],
) -> tuple[np.ndarray, np.ndarray, list[str], list[str], list[str], list[int]]:
    x_rows: list[list[float]] = []
    labels: list[int] = []
    decision_ids: list[str] = []
    episodes: list[str] = []
    split_groups: list[str] = []
    candidate_counts: list[int] = []
    for decision in decisions:
        candidates = decision["candidates"]
        candidate_counts.append(len(candidates))
        for candidate in candidates:
            x_rows.append(embedded_candidate_features(decision, candidate))
            labels.append(int(candidate["id"] == decision["chosenCandidateId"]))
            decision_ids.append(decision["decisionId"])
            episodes.append(decision["episodeId"])
            split_groups.append(record_split_group(decision))
    feature_counts = {len(row) for row in x_rows}
    if len(feature_counts) != 1:
        raise ValueError(f"dataset contains inconsistent feature counts: {sorted(feature_counts)}")
    return (
        np.asarray(x_rows, dtype=np.float32),
        np.asarray(labels),
        decision_ids,
        episodes,
        split_groups,
        candidate_counts,
    )


def split_groups(groups: list[str], seed: int) -> tuple[set[str], set[str]]:
    unique = sorted(set(groups))
    if len(unique) < 2:
        raise ValueError("at least two matchup groups are required for a leakage-safe split")
    rng = np.random.default_rng(seed)
    rng.shuffle(unique)
    test_count = max(1, int(round(len(unique) * 0.34)))
    return set(unique[test_count:]), set(unique[:test_count])


def ordered_group_sizes(decision_ids: list[str]) -> list[int]:
    sizes: list[int] = []
    seen: set[str] = set()
    previous: str | None = None
    for decision_id in decision_ids:
        if decision_id != previous:
            if decision_id in seen:
                raise ValueError(f"candidate rows for decision {decision_id} are not contiguous")
            seen.add(decision_id)
            sizes.append(0)
            previous = decision_id
        sizes[-1] += 1
    return sizes


def row_weights(labels: np.ndarray, decision_ids: list[str]) -> np.ndarray:
    sizes = Counter(decision_ids)
    return np.asarray(
        [0.5 if label else 0.5 / max(1, sizes[decision_id] - 1) for label, decision_id in zip(labels, decision_ids)],
        dtype=np.float64,
    )


def ranking_metrics(scores: np.ndarray, labels: np.ndarray, decision_ids: list[str]) -> dict[str, float]:
    groups: dict[str, list[int]] = defaultdict(list)
    for index, decision_id in enumerate(decision_ids):
        groups[decision_id].append(index)
    ranks: list[int] = []
    losses: list[float] = []
    for indices in groups.values():
        group_scores = scores[indices]
        group_labels = labels[indices]
        chosen = int(np.flatnonzero(group_labels == 1)[0])
        order = np.argsort(-group_scores, kind="stable")
        rank = int(np.flatnonzero(order == chosen)[0]) + 1
        ranks.append(rank)
        shifted = group_scores - np.max(group_scores)
        probabilities = np.exp(np.clip(shifted, -50, 50))
        probabilities /= probabilities.sum()
        losses.append(-math.log(max(EPSILON, float(probabilities[chosen]))))
    return {
        "decisions": len(groups),
        "top1": float(np.mean(np.asarray(ranks) <= 1)),
        "top3": float(np.mean(np.asarray(ranks) <= 3)),
        "mrr": float(np.mean(1 / np.asarray(ranks))),
        "candidateNll": float(np.mean(losses)),
    }


def heuristic_scores(decisions: list[dict[str, Any]]) -> list[float]:
    scores: list[float] = []
    for decision in decisions:
        for order, candidate in enumerate(decision["candidates"]):
            if candidate["kind"] != "move":
                value = -10.0
            else:
                actor = active_mon(decision["observation"], decision["actorSlot"])
                move = next(
                    (move for move in actor["moves"] if move["slot"] == candidate["moveSlot"]),
                    {"category": 2},
                )
                value = -1.0 if move["category"] == 2 else float(candidate.get("baseTypeMultiplier", 1))
            scores.append(value - order * 1e-9)
    return scores


def evaluate_named_scores(
    decisions: list[dict[str, Any]], scores: list[float]
) -> dict[str, float]:
    labels: list[int] = []
    decision_ids: list[str] = []
    for decision in decisions:
        for candidate in decision["candidates"]:
            labels.append(int(candidate["id"] == decision["chosenCandidateId"]))
            decision_ids.append(decision["decisionId"])
    if len(scores) != len(labels):
        raise ValueError("named score count does not match candidate row count")
    return ranking_metrics(np.asarray(scores), np.asarray(labels), decision_ids)


def load_generation_metrics(path: Path) -> dict[str, float | int]:
    results: list[dict[str, Any]] = []
    for file in sorted(path.rglob("result-*.json")) if path.is_dir() else []:
        results.append(json.loads(file.read_text(encoding="utf-8")))
    total_ms = sum(int(result.get("totalMs", 0)) for result in results)
    episodes: list[dict[str, Any]] = []
    for result in results:
        batch_results = result.get("results")
        if isinstance(batch_results, list):
            episodes.extend(entry for entry in batch_results if isinstance(entry, dict))
            continue
        # Compatibility with the original full-run result shape, where each wave
        # represented one independently recorded combat episode.
        waves = result.get("waves")
        if isinstance(waves, list):
            episodes.extend(entry for entry in waves if isinstance(entry, dict))

    total_episodes = len(episodes)
    total_turns = sum(int(episode.get("turns", 0)) for episode in episodes)
    total_combat_ms = sum(int(episode.get("combatMs", 0)) for episode in episodes)
    boot_samples = [int(episode.get("bootMs", 0)) for episode in episodes if "bootMs" in episode]
    if not boot_samples:
        boot_samples = [int(result.get("bootMs", 0)) for result in results if "bootMs" in result]
    return {
        "shards": len(results),
        "episodes": total_episodes,
        "turns": total_turns,
        "runnerComputeSeconds": total_ms / 1000,
        "parallelEngineWallSeconds": max((int(result.get("totalMs", 0)) for result in results), default=0) / 1000,
        "meanRunnerMsPerEpisode": total_ms / max(1, total_episodes),
        "meanCombatMsPerEpisode": total_combat_ms / max(1, total_episodes),
        "meanTurnsPerEpisode": total_turns / max(1, total_episodes),
        "meanBootMs": float(np.mean(boot_samples)) if boot_samples else 0.0,
    }


def leaf_node(value: float) -> dict[str, Any]:
    return {"feature": -1, "threshold": 0.0, "left": -1, "right": -1, "value": float(value)}


def hist_gradient_artifact(name: str, model: HistGradientBoostingClassifier, feature_count: int) -> dict[str, Any]:
    trees: list[list[dict[str, Any]]] = []
    for iteration in model._predictors:  # sklearn has no public neutral tree export for HGB.
        source = iteration[0].nodes
        nodes: list[dict[str, Any]] = []
        for node in source:
            if bool(node["is_leaf"]):
                nodes.append(leaf_node(float(node["value"])))
            else:
                if bool(node["is_categorical"]):
                    raise ValueError("categorical HGB splits are unsupported by the neutral runtime")
                nodes.append(
                    {
                        "feature": int(node["feature_idx"]),
                        "threshold": float(node["num_threshold"]),
                        "left": int(node["left"]),
                        "right": int(node["right"]),
                        "defaultLeft": bool(node["missing_go_to_left"]),
                    }
                )
        trees.append(nodes)
    return {
        "schemaVersion": 1,
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
        "featureCount": feature_count,
        "modelName": name,
        "modelType": "sklearn_hist_gradient_boosting",
        "aggregation": "sum_logit",
        "baseScore": float(np.ravel(model._baseline_prediction)[0]),
        "trees": trees,
    }


def lightgbm_artifact(
    name: str,
    model: Any,
    feature_count: int,
    aggregation: str = "sum_logit",
) -> dict[str, Any]:
    dumped = model.booster_.dump_model()
    trees: list[list[dict[str, Any]]] = []

    def flatten(source: dict[str, Any], nodes: list[dict[str, Any]]) -> int:
        index = len(nodes)
        nodes.append(leaf_node(0.0))
        if "leaf_value" in source:
            nodes[index] = leaf_node(float(source["leaf_value"]))
            return index
        if source.get("decision_type") not in ("<=", "<"):
            raise ValueError(f"unsupported LightGBM decision type {source.get('decision_type')}")
        left = flatten(source["left_child"], nodes)
        right = flatten(source["right_child"], nodes)
        nodes[index] = {
            "feature": int(source["split_feature"]),
            "threshold": float(source["threshold"]),
            "left": left,
            "right": right,
            "defaultLeft": bool(source.get("default_left", True)),
        }
        return index

    for tree in dumped["tree_info"]:
        nodes: list[dict[str, Any]] = []
        flatten(tree["tree_structure"], nodes)
        trees.append(nodes)
    return {
        "schemaVersion": 1,
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
        "featureCount": feature_count,
        "modelName": name,
        "modelType": "lightgbm",
        "aggregation": aggregation,
        "baseScore": 0.0,
        "trees": trees,
    }


def export_tree_artifact(name: str, model: Any, feature_count: int) -> dict[str, Any] | None:
    if isinstance(model, (RandomForestClassifier, ExtraTreesClassifier)):
        # Keep these as CPU baselines. Their literal JSON exports are hundreds of
        # megabytes and made every runner download the same non-selected models.
        return None
    if isinstance(model, HistGradientBoostingClassifier):
        return hist_gradient_artifact(name, model, feature_count)
    if LGBMRanker is not None and isinstance(model, LGBMRanker):
        return lightgbm_artifact(name, model, feature_count, "sum_raw")
    if LGBMClassifier is not None and isinstance(model, LGBMClassifier):
        return lightgbm_artifact(name, model, feature_count)
    return None


def artifact_scores(artifact: dict[str, Any], x: np.ndarray) -> np.ndarray:
    def tree_score(nodes: list[dict[str, Any]], row: np.ndarray) -> float:
        index = 0
        for _ in range(len(nodes) + 1):
            node = nodes[index]
            if "value" in node:
                return float(node["value"])
            value = float(row[node["feature"]])
            go_left = node.get("defaultLeft", True) if math.isnan(value) else value <= node["threshold"]
            index = node["left"] if go_left else node["right"]
        raise ValueError("neutral tree traversal exceeded node count")

    result = []
    for row in x:
        values = [tree_score(tree, row) for tree in artifact["trees"]]
        if artifact["aggregation"] == "mean":
            result.append(float(np.mean(values)))
        elif artifact["aggregation"] == "sum_logit":
            raw = artifact["baseScore"] + sum(values)
            result.append(1.0 / (1.0 + math.exp(-max(-50.0, min(50.0, raw)))))
        else:
            result.append(artifact["baseScore"] + sum(values))
    return np.asarray(result)


def model_specs(seed: int) -> list[tuple[str, Any, bool, bool]]:
    specs = [
        ("logistic", LogisticRegression(max_iter=1000, class_weight=None, random_state=seed), True, False),
        (
            "random_forest",
            RandomForestClassifier(n_estimators=250, min_samples_leaf=2, n_jobs=-1, random_state=seed),
            False,
            False,
        ),
        (
            "extra_trees",
            ExtraTreesClassifier(n_estimators=250, min_samples_leaf=2, n_jobs=-1, random_state=seed),
            False,
            False,
        ),
        ("hist_gradient_boosting", HistGradientBoostingClassifier(max_iter=200, random_state=seed), False, False),
    ]
    if LGBMClassifier is not None:
        specs.append(
            (
                "lightgbm",
                LGBMClassifier(
                    n_estimators=250,
                    learning_rate=0.04,
                    num_leaves=31,
                    n_jobs=-1,
                    random_state=seed,
                    verbosity=-1,
                ),
                False,
                False,
            )
        )
        specs.append(
            (
                "lightgbm_lambdarank",
                LGBMRanker(
                    objective="lambdarank",
                    n_estimators=300,
                    learning_rate=0.04,
                    num_leaves=31,
                    min_child_samples=20,
                    n_jobs=-1,
                    random_state=seed,
                    verbosity=-1,
                ),
                False,
                True,
            )
        )
    return specs


def outcome_weighted_model_specs(seed: int) -> list[tuple[str, Any]]:
    specs: list[tuple[str, Any]] = [
        (
            "outcome_weighted_hist_gradient_boosting",
            HistGradientBoostingClassifier(max_iter=250, random_state=seed),
        )
    ]
    if LGBMClassifier is not None:
        specs.append(
            (
                "outcome_weighted_lightgbm",
                LGBMClassifier(
                    n_estimators=300,
                    learning_rate=0.04,
                    num_leaves=31,
                    n_jobs=-1,
                    random_state=seed,
                    verbosity=-1,
                ),
            )
        )
    return specs


def train(args: argparse.Namespace) -> dict[str, Any]:
    if not 0.0 <= args.loss_episode_weight <= 1.0:
        raise ValueError("loss episode weight must be between 0 and 1")
    all_decisions, terminals = load_records(args.data)
    dictionary_coverage = validate_data_dictionary(args.dictionary, all_decisions)
    decisions, rollout_selection = (
        select_elite_rollouts(all_decisions, terminals)
        if args.elite_rollouts
        else (
            all_decisions,
            {
                "episodes": 0,
                "successfulEpisodes": 0,
                "successRate": None,
                "decisionsBeforeSelection": len(all_decisions),
                "decisionsAfterSelection": len(all_decisions),
            },
        )
    )
    x, y, decision_ids, episodes, split_group_ids, candidate_counts = make_rows(decisions)
    train_groups, test_groups = split_groups(split_group_ids, args.seed)
    train_mask = np.asarray([group in train_groups for group in split_group_ids])
    test_mask = np.asarray([group in test_groups for group in split_group_ids])
    train_episodes = {episode for episode, selected in zip(episodes, train_mask) if selected}
    test_episodes = {episode for episode, selected in zip(episodes, test_mask) if selected}
    weights = row_weights(y, decision_ids)
    terminal_by_episode = {terminal["episodeId"]: terminal for terminal in terminals}
    successful_rows = np.asarray(
        [terminal_by_episode[episode]["outcome"] in SUCCESSFUL_ROLLOUT_OUTCOMES for episode in episodes]
    )
    outcome_weights = np.asarray(
        [1.0 if successful else args.loss_episode_weight for successful in successful_rows],
        dtype=np.float64,
    )
    scaler = StandardScaler().fit(x[train_mask])

    test_decisions = [decision for decision in decisions if decision["episodeId"] in test_episodes]
    random_metrics = {
        "decisions": len(test_decisions),
        "top1": float(np.mean([1 / len(row["candidates"]) for row in test_decisions])),
        "top3": float(np.mean([min(3, len(row["candidates"])) / len(row["candidates"]) for row in test_decisions])),
        "mrr": float(
            np.mean([sum(1 / rank for rank in range(1, len(row["candidates"]) + 1)) / len(row["candidates"]) for row in test_decisions])
        ),
        "candidateNll": float(np.mean([math.log(len(row["candidates"])) for row in test_decisions])),
    }
    leaderboard: list[dict[str, Any]] = [
        {"model": "random_legal_expected", **random_metrics, "trainSeconds": 0.0, "modelBytes": 0},
        {
            "model": "smart_default_heuristic",
            **evaluate_named_scores(test_decisions, heuristic_scores(test_decisions)),
            "trainSeconds": 0.0,
            "modelBytes": 0,
        },
    ]
    artifacts: dict[str, dict[str, Any]] = {}
    for name, model, scale, ranker in model_specs(args.seed):
        train_x = scaler.transform(x[train_mask]) if scale else x[train_mask]
        test_x = scaler.transform(x[test_mask]) if scale else x[test_mask]
        started = time.perf_counter()
        if ranker:
            train_decision_ids = [
                decision_id for decision_id, selected in zip(decision_ids, train_mask) if selected
            ]
            model.fit(
                train_x,
                y[train_mask],
                group=ordered_group_sizes(train_decision_ids),
                sample_weight=weights[train_mask],
            )
        else:
            model.fit(train_x, y[train_mask], sample_weight=weights[train_mask])
        train_seconds = time.perf_counter() - started
        infer_started = time.perf_counter()
        scores = model.predict(test_x) if ranker else model.predict_proba(test_x)[:, 1]
        infer_seconds = time.perf_counter() - infer_started
        metrics = ranking_metrics(
            scores,
            y[test_mask],
            [decision_id for decision_id, selected in zip(decision_ids, test_mask) if selected],
        )
        artifact = export_tree_artifact(name, model, x.shape[1])
        parity_error = None
        if artifact is not None:
            neutral_scores = artifact_scores(artifact, x[test_mask])
            parity_error = float(np.max(np.abs(scores - neutral_scores)))
            if parity_error > 1e-5:
                raise ValueError(f"{name} neutral artifact parity error {parity_error}")
            artifacts[name] = artifact
        leaderboard.append(
            {
                "model": name,
                **metrics,
                "trainSeconds": train_seconds,
                "inferenceMsPerDecision": 1000 * infer_seconds / max(1, metrics["decisions"]),
                "modelBytes": len(pickle.dumps({"model": model, "scaler": scaler if scale else None})),
                "neutralArtifactMaxError": parity_error,
            }
        )

    successful_test_mask = test_mask & successful_rows
    outcome_artifacts: dict[str, dict[str, Any]] = {}
    for name, model in outcome_weighted_model_specs(args.seed):
        started = time.perf_counter()
        model.fit(x[train_mask], y[train_mask], sample_weight=weights[train_mask] * outcome_weights[train_mask])
        train_seconds = time.perf_counter() - started
        infer_started = time.perf_counter()
        scores = model.predict_proba(x[test_mask])[:, 1]
        infer_seconds = time.perf_counter() - infer_started
        metrics = ranking_metrics(
            scores,
            y[test_mask],
            [decision_id for decision_id, selected in zip(decision_ids, test_mask) if selected],
        )
        successful_metrics = (
            ranking_metrics(
                model.predict_proba(x[successful_test_mask])[:, 1],
                y[successful_test_mask],
                [decision_id for decision_id, selected in zip(decision_ids, successful_test_mask) if selected],
            )
            if successful_test_mask.any()
            else None
        )
        artifact = export_tree_artifact(name, model, x.shape[1])
        if artifact is None:
            raise ValueError(f"{name} cannot be exported to the neutral runtime")
        neutral_scores = artifact_scores(artifact, x[test_mask])
        parity_error = float(np.max(np.abs(scores - neutral_scores)))
        if parity_error > 1e-5:
            raise ValueError(f"{name} neutral artifact parity error {parity_error}")
        artifacts[name] = artifact
        outcome_artifacts[name] = artifact
        leaderboard.append(
            {
                "model": name,
                **metrics,
                "successfulEpisodeMetrics": successful_metrics,
                "trainingObjective": f"loss episodes weighted {args.loss_episode_weight}",
                "trainSeconds": train_seconds,
                "inferenceMsPerDecision": 1000 * infer_seconds / max(1, metrics["decisions"]),
                "modelBytes": len(pickle.dumps({"model": model, "scaler": None})),
                "neutralArtifactMaxError": parity_error,
            }
        )

    learned_rows = [
        row for row in leaderboard if row["model"] in artifacts and row["model"] not in outcome_artifacts
    ]
    selected = sorted(learned_rows, key=lambda row: (-row["top1"], row["candidateNll"], row["model"]))[0]["model"]
    outcome_rows = [row for row in leaderboard if row["model"] in outcome_artifacts]
    outcome_selected = sorted(
        outcome_rows,
        key=lambda row: (
            -(row["successfulEpisodeMetrics"] or row)["top1"],
            (row["successfulEpisodeMetrics"] or row)["candidateNll"],
            row["model"],
        ),
    )[0]["model"]
    if args.models_dir is not None:
        args.models_dir.mkdir(parents=True, exist_ok=True)
        for name, artifact in artifacts.items():
            (args.models_dir / f"{name}.json").write_text(json.dumps(artifact, separators=(",", ":")) + "\n", encoding="utf-8")
        (args.models_dir / "selected-model.json").write_text(
            json.dumps(artifacts[selected], separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        (args.models_dir / "outcome-selected-model.json").write_text(
            json.dumps(outcome_artifacts[outcome_selected], separators=(",", ":")) + "\n",
            encoding="utf-8",
        )

    hashes = {
        key: sorted({record[key] for record in decisions})
        for key in ("buildSha", "dexHash", "dictionaryHash")
    }
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "metricScope": "offline imitation of the recorded source policy; not battle win rate",
        "selectedBattlePolicy": selected,
        "selectedOutcomeWeightedPolicy": outcome_selected,
        "lossEpisodeWeight": args.loss_episode_weight,
        "seed": args.seed,
        "data": {
            "decisions": len(decisions),
            "candidateRows": len(y),
            "episodes": len(set(episodes)),
            "successfulEpisodes": len({episode for episode, successful in zip(episodes, successful_rows) if successful}),
            "trainEpisodes": sorted(train_episodes),
            "testEpisodes": sorted(test_episodes),
            "trainSplitGroups": sorted(train_groups),
            "testSplitGroups": sorted(test_groups),
            "meanCandidates": float(np.mean(candidate_counts)),
            "p95Candidates": float(np.percentile(candidate_counts, 95)),
            "sourcePolicies": Counter(record["sourcePolicy"] for record in decisions),
            "formats": Counter(record["observation"]["format"] for record in decisions),
            "terminalOutcomes": Counter(record["outcome"] for record in terminals),
            "identity": hashes,
            "dictionaryCoverage": dictionary_coverage,
        },
        "generation": load_generation_metrics(args.data),
        "rolloutSelection": rollout_selection,
        "leaderboard": sorted(leaderboard, key=lambda row: (-row["top1"], row["candidateNll"])),
    }
    return json.loads(json.dumps(report))


def markdown(report: dict[str, Any]) -> str:
    lines = [
        "# ER combat candidate baseline",
        "",
        "> These are offline imitation metrics against the recorded source policy, not battle win rates.",
        "> A model must still pass a fixed-seed real-engine gauntlet before any gameplay comparison.",
        "",
        f"Decisions: {report['data']['decisions']} across {report['data']['episodes']} episodes; "
        f"mean candidates: {report['data']['meanCandidates']:.2f}.",
        f"Generation: {report['generation']['shards']} runner shards, "
        f"{report['generation']['episodes']} battle episodes, "
        f"{report['generation']['meanRunnerMsPerEpisode']:.0f} runner ms/episode, "
        f"{report['generation']['meanCombatMsPerEpisode']:.0f} combat ms/episode.",
        (
            f"Exploratory rollouts: {report['rolloutSelection']['successfulEpisodes']}/"
            f"{report['rolloutSelection']['episodes']} reached their requested horizon; "
            f"{report['rolloutSelection']['decisionsAfterSelection']}/"
            f"{report['rolloutSelection']['decisionsBeforeSelection']} decisions retained."
        ),
        "",
        "| Model | Top-1 | Top-3 | MRR | Candidate NLL | Train s | ms/decision | Size KiB |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in report["leaderboard"]:
        lines.append(
            f"| {row['model']} | {row['top1']:.3f} | {row['top3']:.3f} | {row['mrr']:.3f} | "
            f"{row['candidateNll']:.3f} | {row['trainSeconds']:.2f} | "
            f"{row.get('inferenceMsPerDecision', 0):.3f} | {row['modelBytes'] / 1024:.1f} |"
        )
    outcome_rows = [row for row in report["leaderboard"] if row.get("successfulEpisodeMetrics")]
    if outcome_rows:
        lines.extend(
            [
                "",
                f"Outcome-weighted selector: `{report['selectedOutcomeWeightedPolicy']}`. "
                f"Loss-episode decisions carry {report['lossEpisodeWeight']:.2f}x training weight.",
                "",
                "| Outcome-weighted model | Successful-episode Top-1 | Successful-episode NLL |",
                "| --- | ---: | ---: |",
            ]
        )
        for row in outcome_rows:
            metrics = row["successfulEpisodeMetrics"]
            lines.append(f"| {row['model']} | {metrics['top1']:.3f} | {metrics['candidateNll']:.3f} |")
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--dictionary", type=Path, required=True)
    parser.add_argument("--report-json", type=Path, required=True)
    parser.add_argument("--report-md", type=Path, required=True)
    parser.add_argument("--models-dir", type=Path)
    parser.add_argument(
        "--elite-rollouts",
        action="store_true",
        help="retain epsilon-tree decisions only from episodes that reached their requested horizon",
    )
    parser.add_argument("--seed", type=int, default=20260728)
    parser.add_argument("--loss-episode-weight", type=float, default=0.1)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = train(args)
    args.report_json.parent.mkdir(parents=True, exist_ok=True)
    args.report_md.parent.mkdir(parents=True, exist_ok=True)
    args.report_json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    args.report_md.write_text(markdown(report), encoding="utf-8")
    print(markdown(report))


if __name__ == "__main__":
    main()
