#!/usr/bin/env python3
"""Train inexpensive candidate rankers on versioned ER combat-decision JSONL."""

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
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

try:
    from lightgbm import LGBMClassifier
except ModuleNotFoundError:  # The core sklearn ladder remains locally runnable without the optional wheel.
    LGBMClassifier = None

SCHEMA_VERSION = 1
EPSILON = 1e-9


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


def ratio(value: float, scale: float) -> float:
    return float(value) / scale if scale else 0.0


def hp_ratio(mon: dict[str, Any] | None) -> float:
    if not mon:
        return 0.0
    return ratio(mon.get("hp", 0), max(1, mon.get("maxHp", 0)))


def active_mon(observation: dict[str, Any], slot: int) -> dict[str, Any]:
    for mon in observation["selfParty"]:
        if mon.get("activeSlot") == slot:
            return mon
    raise ValueError(f"no active self mon for slot {slot}")


def entity(observation: dict[str, Any], entity_id: int) -> dict[str, Any] | None:
    return next(
        (mon for mon in observation["selfParty"] + observation["opponentActive"] if mon["entityId"] == entity_id),
        None,
    )


def padded(values: Iterable[float], size: int) -> list[float]:
    result = list(values)[:size]
    return result + [0.0] * (size - len(result))


def candidate_features(decision: dict[str, Any], candidate: dict[str, Any]) -> list[float]:
    obs = decision["observation"]
    actor = active_mon(obs, decision["actorSlot"])
    opponents = obs["opponentActive"]
    candidate_kind = candidate["kind"]
    features = [
        ratio(obs["wave"], 200),
        ratio(obs["turn"], 50),
        ratio(obs["format"], 3),
        ratio(obs.get("weather") or 0, 20),
        ratio(obs.get("terrain") or 0, 10),
        ratio(obs.get("playerTerasUsed", 0), 3),
        hp_ratio(actor),
        float(actor.get("status") is not None),
        ratio(actor.get("level", 0), 200),
        ratio(sum(not mon.get("fainted", False) for mon in obs["selfParty"]), 6),
        ratio(sum(not mon.get("fainted", False) for mon in opponents), 3),
        min((hp_ratio(mon) for mon in opponents), default=0.0),
        sum(hp_ratio(mon) for mon in opponents) / max(1, len(opponents)),
        float(candidate_kind == "move"),
        float(candidate_kind == "switch"),
        float(candidate_kind == "shift"),
    ]
    features.extend(ratio(stage, 6) for stage in padded(actor.get("statStages", []), 7))
    features.extend(ratio(type_id, 20) for type_id in padded(actor.get("types", []), 3))

    move_features = [0.0] * 14
    switch_features = [0.0] * 7
    shift_features = [0.0] * 2
    if candidate_kind == "move":
        move = next(
            (move for move in actor.get("moves", []) if move.get("slot") == candidate.get("moveSlot")),
            None,
        )
        if move is None and candidate.get("moveSlot") != -1:
            raise ValueError(f"missing move slot for candidate {candidate['id']}")
        targets = [entity(obs, target["entityId"]) for target in candidate.get("targets", [])]
        target = next((mon for mon in targets if mon is not None), None)
        move_features = [
            ratio((move or {}).get("power", 0), 250),
            ratio((move or {}).get("accuracy", 0), 100),
            ratio((move or {}).get("priority", 0), 7),
            ratio((move or {}).get("category", 0), 3),
            ratio((move or {}).get("type", 0), 20),
            ratio((move or {}).get("ppUsed", 0), max(1, (move or {}).get("maxPp", 0))),
            float(candidate.get("tera", False)),
            float(candidate.get("currentStab", False)),
            min(4.0, float(candidate.get("baseTypeMultiplier", 1))) / 4.0,
            ratio(len(candidate.get("targets", [])), 6),
            float(candidate.get("targetMode") == "random"),
            hp_ratio(target),
            ratio((target or {}).get("types", [0])[0] if (target or {}).get("types") else 0, 20),
            float((target or {}).get("status") is not None),
        ]
    elif candidate_kind == "switch":
        destination = obs["selfParty"][candidate["partyIndex"]]
        switch_features = [
            hp_ratio(destination),
            ratio(destination.get("level", 0) - actor.get("level", 0), 200),
            float(destination.get("status") is not None),
            ratio(destination.get("types", [0])[0] if destination.get("types") else 0, 20),
            ratio(destination.get("types", [0, 0])[1] if len(destination.get("types", [])) > 1 else 0, 20),
            float(candidate.get("transfer") == "baton"),
            ratio(candidate.get("partyIndex", 0), 6),
        ]
    elif candidate_kind == "shift":
        shift_features = [
            ratio(abs(candidate["targetActorSlot"] - candidate["actorSlot"]), 2),
            ratio(candidate["targetActorSlot"], 3),
        ]
    return features + move_features + switch_features + shift_features


def make_rows(decisions: list[dict[str, Any]]) -> tuple[np.ndarray, np.ndarray, list[str], list[str], list[int]]:
    x_rows: list[list[float]] = []
    labels: list[int] = []
    decision_ids: list[str] = []
    episodes: list[str] = []
    candidate_counts: list[int] = []
    for decision in decisions:
        candidates = decision["candidates"]
        candidate_counts.append(len(candidates))
        for candidate in candidates:
            x_rows.append(candidate_features(decision, candidate))
            labels.append(int(candidate["id"] == decision["chosenCandidateId"]))
            decision_ids.append(decision["decisionId"])
            episodes.append(decision["episodeId"])
    return np.asarray(x_rows, dtype=np.float32), np.asarray(labels), decision_ids, episodes, candidate_counts


def split_episodes(episodes: list[str], seed: int) -> tuple[set[str], set[str]]:
    unique = sorted(set(episodes))
    if len(unique) < 2:
        raise ValueError("at least two episodes are required for a leakage-safe split")
    rng = np.random.default_rng(seed)
    rng.shuffle(unique)
    test_count = max(1, int(round(len(unique) * 0.34)))
    return set(unique[test_count:]), set(unique[:test_count])


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
    total_waves = sum(len(result.get("waves", [])) for result in results)
    return {
        "shards": len(results),
        "waves": total_waves,
        "runnerComputeSeconds": total_ms / 1000,
        "parallelEngineWallSeconds": max((int(result.get("totalMs", 0)) for result in results), default=0) / 1000,
        "meanEngineMsPerWave": total_ms / max(1, total_waves),
        "meanBootMs": float(np.mean([result.get("bootMs", 0) for result in results])) if results else 0.0,
    }


def model_specs(seed: int) -> list[tuple[str, Any, bool]]:
    specs = [
        ("logistic", LogisticRegression(max_iter=1000, class_weight=None, random_state=seed), True),
        (
            "random_forest",
            RandomForestClassifier(n_estimators=250, min_samples_leaf=2, n_jobs=-1, random_state=seed),
            False,
        ),
        (
            "extra_trees",
            ExtraTreesClassifier(n_estimators=250, min_samples_leaf=2, n_jobs=-1, random_state=seed),
            False,
        ),
        ("hist_gradient_boosting", HistGradientBoostingClassifier(max_iter=200, random_state=seed), False),
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
            )
        )
    return specs


def train(args: argparse.Namespace) -> dict[str, Any]:
    decisions, terminals = load_records(args.data)
    x, y, decision_ids, episodes, candidate_counts = make_rows(decisions)
    train_episodes, test_episodes = split_episodes(episodes, args.seed)
    train_mask = np.asarray([episode in train_episodes for episode in episodes])
    test_mask = np.asarray([episode in test_episodes for episode in episodes])
    weights = row_weights(y, decision_ids)
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
    for name, model, scale in model_specs(args.seed):
        train_x = scaler.transform(x[train_mask]) if scale else x[train_mask]
        test_x = scaler.transform(x[test_mask]) if scale else x[test_mask]
        started = time.perf_counter()
        model.fit(train_x, y[train_mask], sample_weight=weights[train_mask])
        train_seconds = time.perf_counter() - started
        infer_started = time.perf_counter()
        scores = model.predict_proba(test_x)[:, 1]
        infer_seconds = time.perf_counter() - infer_started
        metrics = ranking_metrics(
            scores,
            y[test_mask],
            [decision_id for decision_id, selected in zip(decision_ids, test_mask) if selected],
        )
        leaderboard.append(
            {
                "model": name,
                **metrics,
                "trainSeconds": train_seconds,
                "inferenceMsPerDecision": 1000 * infer_seconds / max(1, metrics["decisions"]),
                "modelBytes": len(pickle.dumps({"model": model, "scaler": scaler if scale else None})),
            }
        )

    hashes = {
        key: sorted({record[key] for record in decisions})
        for key in ("buildSha", "dexHash", "dictionaryHash")
    }
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "metricScope": "offline imitation of the recorded source policy; not battle win rate",
        "seed": args.seed,
        "data": {
            "decisions": len(decisions),
            "candidateRows": len(y),
            "episodes": len(set(episodes)),
            "trainEpisodes": sorted(train_episodes),
            "testEpisodes": sorted(test_episodes),
            "meanCandidates": float(np.mean(candidate_counts)),
            "p95Candidates": float(np.percentile(candidate_counts, 95)),
            "sourcePolicies": Counter(record["sourcePolicy"] for record in decisions),
            "formats": Counter(record["observation"]["format"] for record in decisions),
            "terminalOutcomes": Counter(record["outcome"] for record in terminals),
            "identity": hashes,
        },
        "generation": load_generation_metrics(args.data),
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
        f"Generation: {report['generation']['shards']} runner shards, {report['generation']['waves']} waves, "
        f"{report['generation']['meanEngineMsPerWave']:.0f} engine ms/wave.",
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
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--report-json", type=Path, required=True)
    parser.add_argument("--report-md", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=20260728)
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
