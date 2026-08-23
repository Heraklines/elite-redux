#!/usr/bin/env python3
"""Train the ER candidate-set transformer on versioned combat JSONL artifacts."""

from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import math
import random
import sys
import time
from collections import Counter, defaultdict, deque
from dataclasses import asdict, dataclass
from functools import partial
from pathlib import Path
from typing import Any, Iterable, Iterator

import numpy as np
import torch
from safetensors.torch import load_file, save_file
from torch import Tensor, nn
from torch.utils.data import DataLoader, Dataset

POLICY_DIR = Path(__file__).resolve().parent
BASELINE_DIR = POLICY_DIR.parent / "baselines"
sys.path.insert(0, str(BASELINE_DIR))

from train_candidate_baselines import (  # noqa: E402
    ROLLOUT_POLICY,
    SUCCESSFUL_ROLLOUT_OUTCOMES,
    SUPPORTED_SCHEMA_VERSIONS,
    TOKEN_GROUP_NAMES,
    accumulate_dictionary_references,
    empty_dictionary_references,
    is_policy_target,
    record_battle_id,
    record_policy_source,
    record_split_group,
    record_source_partition,
    split_groups,
    validate_data_dictionary_summary,
    validate_decision,
)

from candidate_transformer import (  # noqa: E402
    CandidateSetTransformer,
    CandidateTransformerConfig,
    load_compatible_state_dict,
    parameter_count,
)

WIN_OUTCOMES = {"victory", "max-waves"}
LOSS_OUTCOMES = {"defeat", "player-wiped"}
PAD_TOKEN = "<PAD>"
UNKNOWN_TOKEN = "<UNK>"
DOMAIN_NAMES = ("elite-redux", "showdown")
DOMAIN_TO_ID = {name: index for index, name in enumerate(DOMAIN_NAMES)}
TRANSFER_SCHEMA_VERSION = 1


@dataclass(frozen=True)
class DecisionState:
    features: np.ndarray
    feature_presence: np.ndarray | None
    feature_indices: np.ndarray | None
    full_feature_count: int
    token_ids: list[list[np.ndarray]]
    chosen_index: int
    domain_id: int


@dataclass(frozen=True)
class DecisionExample:
    decision_id: str
    episode_id: str
    split_group_id: str
    source_partition_id: str
    features: np.ndarray
    feature_presence: np.ndarray | None
    feature_indices: np.ndarray | None
    full_feature_count: int
    token_ids: list[list[np.ndarray]]
    chosen_index: int
    domain_id: int
    terminal_value: float | None
    policy_weight: float
    history: tuple[DecisionState, ...]


class DecisionDataset(Dataset[DecisionExample]):
    def __init__(self, examples: list[DecisionExample]) -> None:
        self.examples = examples

    def __len__(self) -> int:
        return len(self.examples)

    def __getitem__(self, index: int) -> DecisionExample:
        return self.examples[index]


def terminal_value(terminal: dict[str, Any]) -> float | None:
    explicit = terminal.get("value")
    if isinstance(explicit, (int, float)) and math.isfinite(float(explicit)):
        return float(explicit)
    if terminal.get("outcome") in WIN_OUTCOMES:
        return 1.0
    if terminal.get("outcome") in LOSS_OUTCOMES:
        return 0.0
    return None


@dataclass(frozen=True)
class ErCorpusSummary:
    decision_count: int
    terminals: list[dict[str, Any]]
    terminal_scope: str
    contract_schema_version: int
    feature_schema_version: int
    feature_count: int
    dictionary_hashes: set[Any]
    dictionary_references: dict[str, set[Any]]
    rollout_trajectory_ids: set[str]
    successful_rollout_trajectory_ids: set[str]


@dataclass(frozen=True)
class ErSelectionSummary:
    decision_count: int
    terminals: list[dict[str, Any]]
    observed_tokens: set[str]
    episode_ids: set[str]
    source_policies: Counter[str]
    policy_target_decisions: int
    identity: dict[str, list[str]]
    rollout_selection: dict[str, Any] | None


def er_jsonl_files(path: Path) -> list[Path]:
    candidates = [path] if path.is_file() else path.rglob("*")
    return sorted(
        candidate
        for candidate in candidates
        if candidate.is_file()
        and (candidate.name.endswith(".jsonl") or candidate.name.endswith(".jsonl.gz"))
    )


def iter_er_jsonl_records(path: Path) -> Iterator[tuple[dict[str, Any], Path, int]]:
    for file in er_jsonl_files(path):
        input_handle = (
            gzip.open(file, "rt", encoding="utf-8")
            if file.name.endswith(".gz")
            else file.open("r", encoding="utf-8")
        )
        with input_handle as handle:
            for line_number, line in enumerate(handle, 1):
                if line.strip():
                    yield json.loads(line), file, line_number


def scan_er_corpus(path: Path) -> ErCorpusSummary:
    decision_count = 0
    decision_ids: set[str] = set()
    decision_episodes: Counter[str] = Counter()
    schema_versions: set[int] = set()
    feature_versions: set[int] = set()
    feature_counts: set[int] = set()
    identity_values = {name: set() for name in ("buildSha", "dexHash", "dictionaryHash")}
    groups_by_episode: dict[str, set[str]] = defaultdict(set)
    partitions_by_episode: dict[str, set[str]] = defaultdict(set)
    decisions_by_battle: dict[str, set[str]] = defaultdict(set)
    missing_battle_identity: list[str] = []
    run_terminals: list[dict[str, Any]] = []
    battle_terminals: list[dict[str, Any]] = []
    references = empty_dictionary_references()
    rollout_trajectory_ids: set[str] = set()

    for record, file, line_number in iter_er_jsonl_records(path):
        if record.get("schemaVersion") not in SUPPORTED_SCHEMA_VERSIONS:
            raise ValueError(f"{file}:{line_number}: unsupported schema version")
        kind = record.get("kind")
        if kind == "combat_decision":
            validate_decision(record, file, line_number)
            decision_id = record["decisionId"]
            if decision_id in decision_ids:
                raise ValueError("dataset contains duplicate decision ids")
            decision_ids.add(decision_id)
            decision_count += 1
            episode_id = record["episodeId"]
            decision_episodes[episode_id] += 1
            schema_versions.add(int(record["schemaVersion"]))
            feature_versions.add(int(record["featureSchemaVersion"]))
            feature_counts.update(len(row["values"]) for row in record["candidateFeatures"])
            groups_by_episode[episode_id].add(record_split_group(record))
            partitions_by_episode[episode_id].add(record_source_partition(record))
            for name in identity_values:
                identity_values[name].add(record.get(name))
            accumulate_dictionary_references(record, references)
            battle_id = record_battle_id(record)
            if battle_id is not None:
                decisions_by_battle[battle_id].add(episode_id)
            else:
                missing_battle_identity.append(decision_id)
            if record_policy_source(record) == ROLLOUT_POLICY:
                rollout_trajectory_ids.add(battle_id or episode_id)
        elif kind in ("episode_terminal", "run_terminal"):
            run_terminals.append(record)
        elif kind == "battle_terminal":
            battle_terminals.append(record)
        elif kind in ("combat_auxiliary_decision", "combat_transition"):
            continue
        else:
            raise ValueError(f"{file}:{line_number}: unknown record kind")

    if not decision_count:
        raise ValueError(f"no combat decisions found under {path}")
    if len(schema_versions) != 1 or not schema_versions.issubset(SUPPORTED_SCHEMA_VERSIONS):
        raise ValueError(f"dataset must contain one supported contract schema, found {sorted(schema_versions)}")
    if len(feature_versions) != 1 or min(feature_versions) < 1:
        raise ValueError(f"dataset must contain one positive feature schema, found {sorted(feature_versions)}")
    if len(feature_counts) != 1:
        raise ValueError(f"dataset contains inconsistent feature widths: {sorted(feature_counts)}")
    inconsistent_groups = sorted(episode for episode, groups in groups_by_episode.items() if len(groups) != 1)
    if inconsistent_groups:
        raise ValueError(f"episodes map to multiple split groups: {inconsistent_groups}")
    inconsistent_partitions = sorted(
        episode for episode, partitions in partitions_by_episode.items() if len(partitions) != 1
    )
    if inconsistent_partitions:
        raise ValueError(f"episodes map to multiple source partitions: {inconsistent_partitions}")

    if battle_terminals:
        terminal_scope = "battle"
        terminals = battle_terminals
        if missing_battle_identity:
            raise ValueError(f"decision {missing_battle_identity[0]} has no stable battle identity")
        terminal_by_battle = {record_battle_id(record): record for record in battle_terminals}
        if None in terminal_by_battle or len(terminal_by_battle) != len(battle_terminals):
            raise ValueError("dataset contains missing or duplicate battle terminal ids")
        missing_battle_ids = sorted(
            decision_id for decision_id, episodes in decisions_by_battle.items() if not decision_id or len(episodes) != 1
        )
        if missing_battle_ids:
            raise ValueError(f"battle ids map to multiple episodes: {missing_battle_ids}")
        mismatched = sorted(
            battle_id
            for battle_id, terminal in terminal_by_battle.items()
            if battle_id in decisions_by_battle and terminal.get("episodeId") not in decisions_by_battle[battle_id]
        )
        if mismatched:
            raise ValueError(f"battle terminal episode mismatch: {mismatched}")
    else:
        terminal_scope = "episode"
        terminals = run_terminals
        terminal_episodes = Counter(record.get("episodeId") for record in run_terminals)
        missing = sorted(set(decision_episodes) - set(terminal_episodes))
        extra = sorted(set(terminal_episodes) - set(decision_episodes))
        duplicated = sorted(episode for episode, count in terminal_episodes.items() if count != 1)
        if missing or extra or duplicated:
            raise ValueError(
                "episode terminal mismatch: "
                f"missing={missing}, extra={extra}, non_unique={duplicated}"
            )
        for terminal in run_terminals:
            episode_id = terminal["episodeId"]
            groups_by_episode[episode_id].add(record_split_group(terminal))
            partitions_by_episode[episode_id].add(record_source_partition(terminal))
        inconsistent_groups = sorted(episode for episode, groups in groups_by_episode.items() if len(groups) != 1)
        if inconsistent_groups:
            raise ValueError(f"episodes map to multiple split groups: {inconsistent_groups}")
        inconsistent_partitions = sorted(
            episode for episode, partitions in partitions_by_episode.items() if len(partitions) != 1
        )
        if inconsistent_partitions:
            raise ValueError(f"episodes map to multiple source partitions: {inconsistent_partitions}")

    for terminal in terminals:
        for name in identity_values:
            identity_values[name].add(terminal.get(name))
    for name, values in identity_values.items():
        if len(values) != 1 or None in values or "unknown" in values:
            raise ValueError(f"dataset must have one known {name}, found {sorted(map(str, values))}")

    def trajectory_id(record: dict[str, Any]) -> str | None:
        return record.get("episodeId") if terminal_scope == "episode" else record_battle_id(record)

    terminal_by_trajectory = {trajectory_id(record): record for record in terminals}
    successful_rollouts = {
        trajectory_id
        for trajectory_id in rollout_trajectory_ids
        if trajectory_id in terminal_by_trajectory
        and terminal_by_trajectory[trajectory_id].get("outcome") in SUCCESSFUL_ROLLOUT_OUTCOMES
    }
    return ErCorpusSummary(
        decision_count=decision_count,
        terminals=terminals,
        terminal_scope=terminal_scope,
        contract_schema_version=next(iter(schema_versions)),
        feature_schema_version=next(iter(feature_versions)),
        feature_count=next(iter(feature_counts)),
        dictionary_hashes=identity_values["dictionaryHash"],
        dictionary_references=references,
        rollout_trajectory_ids=rollout_trajectory_ids,
        successful_rollout_trajectory_ids=successful_rollouts,
    )


def selected_er_decision(
    decision: dict[str, Any],
    corpus: ErCorpusSummary,
    elite_rollouts: bool,
) -> bool:
    if not elite_rollouts or record_policy_source(decision) != ROLLOUT_POLICY:
        return True
    trajectory_id = (
        decision["episodeId"]
        if corpus.terminal_scope == "episode"
        else record_battle_id(decision)
    )
    return trajectory_id in corpus.successful_rollout_trajectory_ids


def iter_selected_er_decisions(
    path: Path,
    corpus: ErCorpusSummary,
    elite_rollouts: bool,
) -> Iterator[dict[str, Any]]:
    for record, _, _ in iter_er_jsonl_records(path):
        if record.get("kind") == "combat_decision" and selected_er_decision(record, corpus, elite_rollouts):
            yield record


def scan_selected_er_decisions(
    path: Path,
    corpus: ErCorpusSummary,
    elite_rollouts: bool,
) -> ErSelectionSummary:
    observed_tokens: set[str] = set()
    episode_ids: set[str] = set()
    selected_terminal_ids: set[str] = set()
    source_policies: Counter[str] = Counter()
    policy_target_decisions = 0
    identity_values = {name: set() for name in ("buildSha", "dexHash", "dictionaryHash")}
    decision_count = 0
    for decision in iter_selected_er_decisions(path, corpus, elite_rollouts):
        decision_count += 1
        episode_ids.add(decision["episodeId"])
        source_policies[record_policy_source(decision)] += 1
        policy_target_decisions += int(is_policy_target(decision))
        for row in decision["candidateTokenGroups"]:
            for group in TOKEN_GROUP_NAMES:
                observed_tokens.update(row["groups"][group])
        for name in identity_values:
            identity_values[name].add(str(decision[name]))
        terminal_id = (
            decision["episodeId"]
            if corpus.terminal_scope == "episode"
            else record_battle_id(decision)
        )
        if terminal_id is not None:
            selected_terminal_ids.add(terminal_id)
    if not decision_count:
        raise ValueError("elite rollout selection removed every decision")
    terminals = [
        terminal
        for terminal in corpus.terminals
        if (
            terminal.get("episodeId")
            if corpus.terminal_scope == "episode"
            else record_battle_id(terminal)
        )
        in selected_terminal_ids
    ]
    rollout_selection = (
        {
            "terminalScope": corpus.terminal_scope,
            "episodes": len(corpus.rollout_trajectory_ids),
            "successfulEpisodes": len(corpus.successful_rollout_trajectory_ids),
            "successRate": (
                len(corpus.successful_rollout_trajectory_ids) / len(corpus.rollout_trajectory_ids)
                if corpus.rollout_trajectory_ids
                else None
            ),
            "decisionsBeforeSelection": corpus.decision_count,
            "decisionsAfterSelection": decision_count,
        }
        if elite_rollouts
        else None
    )
    return ErSelectionSummary(
        decision_count=decision_count,
        terminals=terminals,
        observed_tokens=observed_tokens,
        episode_ids=episode_ids,
        source_policies=source_policies,
        policy_target_decisions=policy_target_decisions,
        identity={name: sorted(values) for name, values in identity_values.items()},
        rollout_selection=rollout_selection,
    )


def transfer_jsonl_files(path: Path) -> list[Path]:
    candidates = [path] if path.is_file() else path.rglob("*")
    return sorted(
        candidate
        for candidate in candidates
        if candidate.is_file()
        and (
            candidate.name.endswith(".jsonl")
            or candidate.name.endswith(".jsonl.gz")
            or candidate.name.endswith(".jsonl.gzpack")
        )
    )


def load_transfer_records(path: Path, feature_names: list[str]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Load domain-adapter rows without pretending they satisfy the ER runtime contract."""
    decisions: list[dict[str, Any]] = []
    terminal_values: dict[str, float] = {}
    feature_indices = {name: index for index, name in enumerate(feature_names)}
    for file in transfer_jsonl_files(path):
        input_handle = (
            gzip.open(file, "rt", encoding="utf-8")
            if file.name.endswith(".gz") or file.name.endswith(".gzpack")
            else file.open("r", encoding="utf-8")
        )
        with input_handle as handle:
            for line_number, line in enumerate(handle, 1):
                if not line.strip():
                    continue
                record = json.loads(line)
                prefix = f"{file}:{line_number}"
                if record.get("schemaVersion") != TRANSFER_SCHEMA_VERSION or record.get("kind") != "candidate_transfer_decision":
                    raise ValueError(f"{prefix}: unsupported transfer record")
                domain = record.get("domain")
                if domain not in DOMAIN_TO_ID or domain == "elite-redux":
                    raise ValueError(f"{prefix}: transfer domain must be one of {DOMAIN_NAMES[1:]}")
                candidates = record.get("candidates")
                feature_rows = record.get("candidateFeatures")
                token_rows = record.get("candidateTokenGroups")
                transfer_feature_names = record.get("featureNames")
                if (
                    not isinstance(transfer_feature_names, list)
                    or not transfer_feature_names
                    or len(set(transfer_feature_names)) != len(transfer_feature_names)
                    or any(name not in feature_indices for name in transfer_feature_names)
                ):
                    raise ValueError(f"{prefix}: transfer featureNames must be a unique subset of the ER contract")
                compact_feature_count = len(transfer_feature_names)
                if not isinstance(candidates, list) or not candidates:
                    raise ValueError(f"{prefix}: candidates must be a non-empty array")
                candidate_ids = [candidate.get("id") for candidate in candidates]
                if len(set(candidate_ids)) != len(candidate_ids) or candidate_ids.count(record.get("chosenCandidateId")) != 1:
                    raise ValueError(f"{prefix}: candidates must be unique and contain the chosen candidate exactly once")
                if not isinstance(feature_rows, list) or {row.get("candidateId") for row in feature_rows} != set(candidate_ids):
                    raise ValueError(f"{prefix}: candidateFeatures do not map one-to-one")
                for row in feature_rows:
                    values = row.get("values")
                    presence = row.get("presence")
                    if (
                        not isinstance(values, list)
                        or len(values) != compact_feature_count
                        or not all(isinstance(value, (int, float)) and math.isfinite(float(value)) for value in values)
                        or not isinstance(presence, list)
                        or len(presence) != compact_feature_count
                        or not all(isinstance(value, bool) for value in presence)
                    ):
                        raise ValueError(
                            f"{prefix}: every transfer feature row needs {compact_feature_count} finite values and booleans"
                        )
                if not isinstance(token_rows, list) or {row.get("candidateId") for row in token_rows} != set(candidate_ids):
                    raise ValueError(f"{prefix}: candidateTokenGroups do not map one-to-one")
                for row in token_rows:
                    groups = row.get("groups")
                    if (
                        not isinstance(groups, dict)
                        or set(groups) != set(TOKEN_GROUP_NAMES)
                        or not groups["action"]
                        or any(
                            not isinstance(groups[group], list)
                            or any(not isinstance(token, str) or not token for token in groups[group])
                            for group in TOKEN_GROUP_NAMES
                        )
                    ):
                        raise ValueError(f"{prefix}: invalid transfer token groups")
                episode_id = record.get("episodeId")
                decision_id = record.get("decisionId")
                value = record.get("terminalValue")
                if not isinstance(episode_id, str) or not episode_id or not isinstance(decision_id, str) or not decision_id:
                    raise ValueError(f"{prefix}: missing episode/decision identity")
                if not isinstance(value, (int, float)) or not math.isfinite(float(value)) or not 0 <= float(value) <= 1:
                    raise ValueError(f"{prefix}: terminalValue must be finite and in [0, 1]")
                previous = terminal_values.setdefault(episode_id, float(value))
                if previous != float(value):
                    raise ValueError(f"{prefix}: episode has inconsistent terminal values")
                decisions.append(
                    {
                        **{key: value for key, value in record.items() if key != "featureNames"},
                        "policySource": record.get("policySource", "showdown-transfer-v1"),
                        "policyTarget": bool(record.get("policyTarget", True)),
                        "trainingDomain": domain,
                        "trainingFeatureIndices": [feature_indices[name] for name in transfer_feature_names],
                    }
                )
    if not decisions:
        raise ValueError(f"no transfer decisions found under {path}")
    decision_ids = [decision["decisionId"] for decision in decisions]
    if len(set(decision_ids)) != len(decision_ids):
        raise ValueError("transfer dataset contains duplicate decision ids")
    terminals = [
        {"episodeId": episode_id, "value": value}
        for episode_id, value in sorted(terminal_values.items())
    ]
    return decisions, terminals


def build_token_vocabulary(
    decisions: list[dict[str, Any]],
    dictionary: dict[str, Any],
) -> tuple[list[str], dict[str, int]]:
    """Build a deterministic, dictionary-bound vocabulary with observed dynamic state tokens."""
    tokens: set[str] = set()
    for decision in decisions:
        for row in decision["candidateTokenGroups"]:
            for group in TOKEN_GROUP_NAMES:
                tokens.update(row["groups"][group])
    return build_token_vocabulary_from_tokens(tokens, dictionary)


def build_token_vocabulary_from_tokens(
    observed_tokens: set[str],
    dictionary: dict[str, Any],
) -> tuple[list[str], dict[str, int]]:
    tokens = set(observed_tokens)
    for identity in dictionary.get("speciesForms", {}):
        tokens.add(f"species:{identity}")
        tokens.add(f"original-species:{identity}")
    for ability_id, ability in dictionary.get("abilities", {}).items():
        tokens.add(f"ability:{ability_id}")
        tokens.update(f"ability-attr:{name}" for name in ability.get("attributes", []))
    for move_id, move in dictionary.get("moves", {}).items():
        tokens.add(f"move:{move_id}")
        tokens.update(f"move-attr:{name}" for name in move.get("attributes", []))
    for item_id, item in dictionary.get("items", {}).items():
        tokens.add(f"item:{item_id}")
        class_name = item.get("className")
        if class_name:
            tokens.add(f"item-class:{class_name}")
    for modifier_id, modifier in dictionary.get("modifiers", {}).items():
        tokens.add(f"modifier:{modifier_id}")
        class_name = modifier.get("className")
        if class_name:
            tokens.add(f"modifier-class:{class_name}")
    vocabulary = [PAD_TOKEN, UNKNOWN_TOKEN, *sorted(tokens - {PAD_TOKEN, UNKNOWN_TOKEN})]
    return vocabulary, {token: index for index, token in enumerate(vocabulary)}


def vocabulary_hash(vocabulary: list[str]) -> str:
    payload = json.dumps(vocabulary, ensure_ascii=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()


def load_fixed_token_vocabulary(
    path: Path,
    required_vocabulary: list[str],
    allow_unknown_tokens: bool = False,
) -> list[str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    vocabulary = payload.get("tokenVocabulary") if isinstance(payload, dict) else payload
    if not isinstance(vocabulary, list) or not all(isinstance(token, str) for token in vocabulary):
        raise ValueError("fixed token vocabulary must be a string list or config containing tokenVocabulary")
    if len(vocabulary) != len(set(vocabulary)):
        raise ValueError("fixed token vocabulary contains duplicate tokens")
    if vocabulary[:2] != [PAD_TOKEN, UNKNOWN_TOKEN]:
        raise ValueError(f"fixed token vocabulary must begin with {PAD_TOKEN!r}, {UNKNOWN_TOKEN!r}")
    missing = sorted(set(required_vocabulary) - set(vocabulary))
    if missing and not allow_unknown_tokens:
        raise ValueError(f"fixed token vocabulary is missing {len(missing)} required tokens: {missing[:5]}")
    if isinstance(payload, dict) and payload.get("tokenVocabularySha256"):
        actual_hash = vocabulary_hash(vocabulary)
        if payload["tokenVocabularySha256"] != actual_hash:
            raise ValueError("fixed token vocabulary hash does not match its contents")
    return vocabulary


def load_initial_model_config(model_dir: Path) -> dict[str, Any]:
    config_path = model_dir / "config.json"
    if not config_path.is_file():
        raise ValueError(f"initial model is missing {config_path}")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    if config.get("schemaVersion") != 4 or config.get("model") != "er-domain-candidate-transformer-v4":
        raise ValueError("initial model is not an ER candidate-transformer-v4 checkpoint")
    weights = config.get("weights")
    if not isinstance(weights, str) or Path(weights).name != weights or not (model_dir / weights).is_file():
        raise ValueError("initial model config does not reference one local weights file")
    return config


def initialize_from_checkpoint(
    model: CandidateSetTransformer,
    model_dir: Path,
    initial_config: dict[str, Any],
    dictionary_hash: str,
    token_vocabulary: list[str],
) -> dict[str, Any]:
    expected_architecture = asdict(model.config)
    if initial_config.get("architecture") != expected_architecture:
        raise ValueError(
            f"initial model architecture mismatch: expected {expected_architecture}, "
            f"got {initial_config.get('architecture')}"
        )
    if initial_config.get("dictionaryHash") != dictionary_hash:
        raise ValueError("initial model dictionary hash does not match the training data dictionary")
    if initial_config.get("tokenVocabulary") != token_vocabulary:
        raise ValueError("initial model token vocabulary does not exactly match the resumed vocabulary")
    weights_path = model_dir / initial_config["weights"]
    target_feature_mean = model.feature_mean.detach().clone()
    target_feature_std = model.feature_std.detach().clone()
    compatibility_projection_added = load_compatible_state_dict(model, load_file(str(weights_path), device="cpu"))
    normalization = rebase_feature_normalization(model, target_feature_mean, target_feature_std)
    return {
        "modelDir": str(model_dir),
        "weightsSha256": hashlib.sha256(weights_path.read_bytes()).hexdigest(),
        "configSha256": hashlib.sha256((model_dir / "config.json").read_bytes()).hexdigest(),
        "compatibilityProjectionAdded": compatibility_projection_added,
        "normalization": normalization,
    }


def rebase_feature_normalization(
    model: CandidateSetTransformer,
    target_mean: Tensor,
    target_std: Tensor,
) -> dict[str, int]:
    """Adopt new corpus statistics without changing the checkpoint function."""
    if target_mean.shape != model.feature_mean.shape or target_std.shape != model.feature_std.shape:
        raise ValueError("target feature normalization must match the checkpoint feature width")
    old_mean = model.feature_mean.detach().clone()
    old_std = model.feature_std.detach().clone()
    target_mean = target_mean.to(device=old_mean.device, dtype=old_mean.dtype)
    target_std = target_std.to(device=old_std.device, dtype=old_std.dtype).clamp_min(1e-6)
    old_input_weight = model.input_projection[0].weight.detach().clone()
    scale = target_std / old_std
    presence_offset = (target_mean - old_mean) / old_std
    with torch.no_grad():
        model.input_projection[0].weight.mul_(scale.unsqueeze(0))
        model.normalization_presence_projection.weight.add_(old_input_weight * presence_offset.unsqueeze(0))
        model.feature_mean.copy_(target_mean)
        model.feature_std.copy_(target_std)
    changed = (~torch.isclose(old_mean, target_mean) | ~torch.isclose(old_std, target_std)).sum()
    return {
        "featureCount": int(old_mean.numel()),
        "changedFeatures": int(changed.item()),
    }


def make_examples(
    decisions: Iterable[dict[str, Any]],
    terminals: list[dict[str, Any]],
    loss_policy_weight: float,
    token_to_id: dict[str, int],
    history_length: int = 8,
    full_feature_count: int | None = None,
    terminal_scope: str = "episode",
    unknown_policy_weight: float = 0.0,
) -> list[DecisionExample]:
    if history_length < 0:
        raise ValueError("history_length must be non-negative")
    if terminal_scope not in ("episode", "battle"):
        raise ValueError(f"unsupported terminal scope {terminal_scope}")
    if not 0.0 <= unknown_policy_weight <= 1.0:
        raise ValueError("unknown policy weight must be between 0 and 1")
    terminal_by_key: dict[str, dict[str, Any]] = {}
    for terminal in terminals:
        key = terminal.get("episodeId") if terminal_scope == "episode" else record_battle_id(terminal)
        if not isinstance(key, str) or not key or key in terminal_by_key:
            raise ValueError(f"terminal dataset has a missing or duplicate {terminal_scope} identity")
        terminal_by_key[key] = terminal
    examples: list[DecisionExample] = []
    history_by_trajectory: dict[str, deque[DecisionState]] = {}
    for decision in decisions:
        candidates = decision["candidates"]
        feature_rows = {row["candidateId"]: row for row in decision["candidateFeatures"]}
        features = np.asarray([feature_rows[candidate["id"]]["values"] for candidate in candidates], dtype=np.float32)
        has_explicit_presence = any("presence" in feature_rows[candidate["id"]] for candidate in candidates)
        feature_presence = (
            np.asarray(
                [feature_rows[candidate["id"]].get("presence", [True] * features.shape[1]) for candidate in candidates],
                dtype=np.bool_,
            )
            if has_explicit_presence
            else None
        )
        resolved_feature_count = full_feature_count if full_feature_count is not None else features.shape[1]
        explicit_feature_indices = decision.get("trainingFeatureIndices")
        if explicit_feature_indices is None and features.shape[1] == resolved_feature_count:
            feature_indices = None
        else:
            feature_indices = np.asarray(
                explicit_feature_indices if explicit_feature_indices is not None else range(features.shape[1]),
                dtype=np.int64,
            )
            if (
                feature_indices.shape != (features.shape[1],)
                or len(set(feature_indices.tolist())) != len(feature_indices)
                or np.any(feature_indices < 0)
                or np.any(feature_indices >= resolved_feature_count)
            ):
                raise ValueError(f"decision {decision['decisionId']} has invalid training feature indices")
        domain_name = decision.get("trainingDomain", "elite-redux")
        if domain_name not in DOMAIN_TO_ID:
            raise ValueError(f"unsupported training domain {domain_name}")
        domain_id = DOMAIN_TO_ID[domain_name]
        chosen_index = next(
            index for index, candidate in enumerate(candidates) if candidate["id"] == decision["chosenCandidateId"]
        )
        trajectory_key = (
            decision["episodeId"]
            if terminal_scope == "episode"
            else record_battle_id(decision)
        )
        if not isinstance(trajectory_key, str) or not trajectory_key:
            raise ValueError(f"decision {decision['decisionId']} has no {terminal_scope} identity")
        terminal = terminal_by_key.get(trajectory_key)
        value = terminal_value(terminal) if terminal is not None else None
        outcome_weight = (
            1.0
            if value == 1.0
            else loss_policy_weight
            if value == 0.0
            else unknown_policy_weight
        )
        weight = outcome_weight if is_policy_target(decision) else 0.0
        tokens_by_candidate = {row["candidateId"]: row["groups"] for row in decision["candidateTokenGroups"]}
        candidate_token_ids = [
            [
                np.asarray(
                    [token_to_id.get(token, token_to_id[UNKNOWN_TOKEN]) for token in tokens_by_candidate[candidate["id"]][group]],
                    dtype=np.int64,
                )
                for group in TOKEN_GROUP_NAMES
            ]
            for candidate in candidates
        ]
        state = DecisionState(
            features=features,
            feature_presence=feature_presence,
            feature_indices=feature_indices,
            full_feature_count=resolved_feature_count,
            token_ids=candidate_token_ids,
            chosen_index=chosen_index,
            domain_id=domain_id,
        )
        trajectory_history = history_by_trajectory.setdefault(
            trajectory_key,
            deque(maxlen=history_length or 1),
        )
        examples.append(
            DecisionExample(
                decision_id=decision["decisionId"],
                episode_id=decision["episodeId"],
                split_group_id=record_split_group(decision),
                source_partition_id=record_source_partition(decision),
                features=features,
                feature_presence=feature_presence,
                feature_indices=feature_indices,
                full_feature_count=resolved_feature_count,
                token_ids=candidate_token_ids,
                chosen_index=chosen_index,
                domain_id=domain_id,
                terminal_value=value,
                policy_weight=weight,
                history=tuple(trajectory_history) if history_length else (),
            )
        )
        trajectory_history.append(state)
    return examples


def collate(examples: list[DecisionExample], history_length: int | None = None) -> dict[str, Any]:
    max_candidates = max(example.features.shape[0] for example in examples)
    feature_counts = {example.full_feature_count for example in examples}
    if len(feature_counts) != 1:
        raise ValueError("examples in one batch must share the full feature contract")
    feature_count = next(iter(feature_counts))
    features = torch.zeros((len(examples), max_candidates, feature_count), dtype=torch.float32)
    feature_presence = torch.zeros_like(features, dtype=torch.bool)
    mask = torch.zeros((len(examples), max_candidates), dtype=torch.bool)
    domain_ids = torch.zeros(len(examples), dtype=torch.long)
    chosen = torch.zeros(len(examples), dtype=torch.long)
    values = torch.zeros(len(examples), dtype=torch.float32)
    value_mask = torch.zeros(len(examples), dtype=torch.bool)
    policy_weights = torch.zeros(len(examples), dtype=torch.float32)
    max_tokens = max(
        1,
        max(len(group) for example in examples for candidate in example.token_ids for group in candidate),
    )
    token_ids = torch.zeros(
        (len(examples), max_candidates, len(TOKEN_GROUP_NAMES), max_tokens),
        dtype=torch.long,
    )
    token_mask = torch.zeros_like(token_ids, dtype=torch.bool)
    retained_history = max(len(example.history) for example in examples) if history_length is None else history_length
    if retained_history < 0:
        raise ValueError("history_length must be non-negative")
    max_history_candidates = max(
        1,
        max(
            (state.features.shape[0] for example in examples for state in example.history[-retained_history:]),
            default=0,
        ),
    )
    max_history_tokens = max(
        1,
        max(
            (
                len(group)
                for example in examples
                for state in example.history[-retained_history:]
                for candidate in state.token_ids
                for group in candidate
            ),
            default=0,
        ),
    )
    history_features = torch.zeros(
        (len(examples), retained_history, max_history_candidates, feature_count),
        dtype=torch.float32,
    )
    history_feature_presence = torch.zeros_like(history_features, dtype=torch.bool)
    history_candidate_mask = torch.zeros(
        (len(examples), retained_history, max_history_candidates),
        dtype=torch.bool,
    )
    history_token_ids = torch.zeros(
        (
            len(examples),
            retained_history,
            max_history_candidates,
            len(TOKEN_GROUP_NAMES),
            max_history_tokens,
        ),
        dtype=torch.long,
    )
    history_token_mask = torch.zeros_like(history_token_ids, dtype=torch.bool)
    history_chosen = torch.zeros((len(examples), retained_history), dtype=torch.long)
    history_step_mask = torch.zeros((len(examples), retained_history), dtype=torch.bool)
    history_domain_ids = torch.zeros((len(examples), retained_history), dtype=torch.long)
    for index, example in enumerate(examples):
        count = example.features.shape[0]
        if example.feature_indices is None:
            features[index, :count] = torch.from_numpy(example.features)
            if example.feature_presence is None:
                feature_presence[index, :count] = True
            else:
                feature_presence[index, :count] = torch.from_numpy(example.feature_presence)
        else:
            columns = torch.from_numpy(example.feature_indices)
            features[index, :count].index_copy_(1, columns, torch.from_numpy(example.features))
            if example.feature_presence is None:
                feature_presence[index, :count, columns] = True
            else:
                feature_presence[index, :count].index_copy_(1, columns, torch.from_numpy(example.feature_presence))
        mask[index, :count] = True
        domain_ids[index] = example.domain_id
        chosen[index] = example.chosen_index
        policy_weights[index] = example.policy_weight
        for candidate_index, candidate_groups in enumerate(example.token_ids):
            for group_index, group in enumerate(candidate_groups):
                token_count = len(group)
                if token_count > 0:
                    token_ids[index, candidate_index, group_index, :token_count] = torch.from_numpy(group)
                    token_mask[index, candidate_index, group_index, :token_count] = True
        if example.terminal_value is not None:
            values[index] = example.terminal_value
            value_mask[index] = True
        retained = example.history[-retained_history:] if retained_history else ()
        history_offset = retained_history - len(retained)
        for history_index, state in enumerate(retained, history_offset):
            history_count = state.features.shape[0]
            if state.feature_indices is None:
                history_features[index, history_index, :history_count] = torch.from_numpy(state.features)
                if state.feature_presence is None:
                    history_feature_presence[index, history_index, :history_count] = True
                else:
                    history_feature_presence[index, history_index, :history_count] = torch.from_numpy(
                        state.feature_presence
                    )
            else:
                history_columns = torch.from_numpy(state.feature_indices)
                history_features[index, history_index, :history_count].index_copy_(
                    1,
                    history_columns,
                    torch.from_numpy(state.features),
                )
                if state.feature_presence is None:
                    history_feature_presence[index, history_index, :history_count, history_columns] = True
                else:
                    history_feature_presence[index, history_index, :history_count].index_copy_(
                        1,
                        history_columns,
                        torch.from_numpy(state.feature_presence),
                    )
            history_candidate_mask[index, history_index, :history_count] = True
            history_chosen[index, history_index] = state.chosen_index
            history_step_mask[index, history_index] = True
            history_domain_ids[index, history_index] = state.domain_id
            for candidate_index, candidate_groups in enumerate(state.token_ids):
                for group_index, group in enumerate(candidate_groups):
                    token_count = len(group)
                    if token_count > 0:
                        history_token_ids[
                            index,
                            history_index,
                            candidate_index,
                            group_index,
                            :token_count,
                        ] = torch.from_numpy(group)
                        history_token_mask[
                            index,
                            history_index,
                            candidate_index,
                            group_index,
                            :token_count,
                        ] = True
    return {
        "features": features,
        "featurePresence": feature_presence,
        "mask": mask,
        "domainIds": domain_ids,
        "chosen": chosen,
        "values": values,
        "valueMask": value_mask,
        "policyWeights": policy_weights,
        "tokenIds": token_ids,
        "tokenMask": token_mask,
        "historyFeatures": history_features,
        "historyFeaturePresence": history_feature_presence,
        "historyCandidateMask": history_candidate_mask,
        "historyTokenIds": history_token_ids,
        "historyTokenMask": history_token_mask,
        "historyChosen": history_chosen,
        "historyStepMask": history_step_mask,
        "historyDomainIds": history_domain_ids,
        "decisionIds": [example.decision_id for example in examples],
    }


def feature_normalization(examples: list[DecisionExample]) -> tuple[Tensor, Tensor]:
    feature_counts = {example.full_feature_count for example in examples}
    if len(feature_counts) != 1:
        raise ValueError("examples must share the full feature contract")
    feature_count = next(iter(feature_counts))
    counts = np.zeros(feature_count, dtype=np.float64)
    sums = np.zeros(feature_count, dtype=np.float64)
    squared_sums = np.zeros(feature_count, dtype=np.float64)
    for example in examples:
        indices = example.feature_indices if example.feature_indices is not None else slice(None)
        if example.feature_presence is None:
            counts[indices] += example.features.shape[0]
            sums[indices] += example.features.sum(axis=0)
            squared_sums[indices] += np.square(example.features).sum(axis=0)
        else:
            present_values = example.features * example.feature_presence
            counts[indices] += example.feature_presence.sum(axis=0)
            sums[indices] += present_values.sum(axis=0)
            squared_sums[indices] += np.square(present_values).sum(axis=0)
    safe_counts = counts.clip(min=1)
    means = sums / safe_counts
    variances = np.maximum(0, squared_sums / safe_counts - np.square(means))
    return torch.from_numpy(means.astype(np.float32)), torch.from_numpy(np.sqrt(variances).clip(min=1e-6).astype(np.float32))


def set_determinism(seed: int, fast_kernels: bool = False) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
        torch.backends.cuda.enable_flash_sdp(fast_kernels)
        torch.backends.cuda.enable_mem_efficient_sdp(fast_kernels)
        torch.backends.cuda.enable_math_sdp(True)
    torch.use_deterministic_algorithms(not fast_kernels)


def model_forward(model: CandidateSetTransformer, batch: dict[str, Any], device: torch.device) -> tuple[Tensor, Tensor]:
    return model(
        batch["features"].to(device),
        batch["mask"].to(device),
        batch["tokenIds"].to(device),
        batch["tokenMask"].to(device),
        batch["historyFeatures"].to(device),
        batch["historyCandidateMask"].to(device),
        batch["historyTokenIds"].to(device),
        batch["historyTokenMask"].to(device),
        batch["historyChosen"].to(device),
        batch["historyStepMask"].to(device),
        batch["featurePresence"].to(device),
        batch["domainIds"].to(device),
        batch["historyFeaturePresence"].to(device),
        batch["historyDomainIds"].to(device),
    )


def policy_metrics(logits: Tensor, chosen: Tensor, mask: Tensor) -> dict[str, float]:
    probabilities = torch.softmax(logits, dim=-1)
    chosen_probability = probabilities.gather(1, chosen.unsqueeze(1)).squeeze(1).clamp_min(1e-9)
    order = torch.argsort(logits, dim=-1, descending=True, stable=True)
    ranks = (order == chosen.unsqueeze(1)).to(torch.int64).argmax(dim=1) + 1
    return {
        "decisions": float(logits.shape[0]),
        "top1": float((ranks <= 1).float().mean()),
        "top3": float((ranks <= 3).float().mean()),
        "mrr": float((1.0 / ranks.float()).mean()),
        "candidateNll": float((-torch.log(chosen_probability)).mean()),
        "meanCandidates": float(mask.sum(dim=1).float().mean()),
    }


def evaluate(
    model: CandidateSetTransformer,
    loader: DataLoader[DecisionExample],
    device: torch.device,
) -> dict[str, float | None]:
    model.eval()
    logits: list[Tensor] = []
    chosen: list[Tensor] = []
    masks: list[Tensor] = []
    values: list[Tensor] = []
    value_targets: list[Tensor] = []
    with torch.inference_mode():
        for batch in loader:
            batch_logits, batch_values = model_forward(model, batch, device)
            policy_selected = batch["policyWeights"] > 0
            if policy_selected.any():
                logits.append(batch_logits.cpu()[policy_selected])
                chosen.append(batch["chosen"][policy_selected])
                masks.append(batch["mask"][policy_selected])
            selected = batch["valueMask"]
            if selected.any():
                values.append(batch_values.cpu()[selected])
                value_targets.append(batch["values"][selected])
    if logits:
        max_candidates = max(tensor.shape[1] for tensor in logits)
        padded_logits = [
            nn.functional.pad(tensor, (0, max_candidates - tensor.shape[1]), value=-1e9) for tensor in logits
        ]
        padded_masks = [
            nn.functional.pad(tensor, (0, max_candidates - tensor.shape[1]), value=False) for tensor in masks
        ]
        result: dict[str, float | None] = policy_metrics(
            torch.cat(padded_logits), torch.cat(chosen), torch.cat(padded_masks)
        )
    else:
        result = {
            "decisions": 0.0,
            "top1": None,
            "top3": None,
            "mrr": None,
            "candidateNll": None,
            "meanCandidates": None,
        }
    if values:
        predictions = torch.sigmoid(torch.cat(values))
        targets = torch.cat(value_targets)
        result["valueBrier"] = float(torch.mean((predictions - targets) ** 2))
        result["valueAccuracy"] = float(((predictions >= 0.5) == (targets >= 0.5)).float().mean())
    return result


def checkpoint_selection_metric(metrics: dict[str, float | None]) -> tuple[str, float]:
    candidate_nll = metrics.get("candidateNll")
    if metrics.get("decisions", 0.0) and candidate_nll is not None and math.isfinite(candidate_nll):
        return "candidateNll", candidate_nll
    value_brier = metrics.get("valueBrier")
    if value_brier is not None and math.isfinite(value_brier):
        return "valueBrier", value_brier
    raise ValueError("validation requires an eligible policy target or a terminal value target")


def train_epoch(
    model: CandidateSetTransformer,
    loader: DataLoader[DecisionExample],
    optimizer: torch.optim.Optimizer,
    device: torch.device,
    value_weight: float,
    gradient_clip: float,
    amp_enabled: bool,
    scaler: torch.amp.GradScaler,
    gradient_accumulation_steps: int = 1,
) -> dict[str, float]:
    model.train()
    totals = Counter()
    optimizer.zero_grad(set_to_none=True)
    batch_count = len(loader)
    for batch_index, batch in enumerate(loader):
        features = batch["features"].to(device)
        mask = batch["mask"].to(device)
        chosen = batch["chosen"].to(device)
        policy_weights = batch["policyWeights"].to(device)
        with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=amp_enabled):
            logits, value_logits = model_forward(model, batch, device)
            per_example_policy = nn.functional.cross_entropy(logits, chosen, reduction="none")
            policy_loss = (per_example_policy * policy_weights).sum() / policy_weights.sum().clamp_min(1e-6)
            value_mask = batch["valueMask"].to(device)
            if value_mask.any():
                value_loss = nn.functional.binary_cross_entropy_with_logits(
                    value_logits[value_mask],
                    batch["values"].to(device)[value_mask],
                )
            else:
                value_loss = torch.zeros((), device=device)
            loss = policy_loss + value_weight * value_loss
        if not bool(torch.isfinite(loss)):
            raise FloatingPointError(
                f"non-finite training loss: policy={float(policy_loss.detach())}, value={float(value_loss.detach())}"
            )
        window_start = (batch_index // gradient_accumulation_steps) * gradient_accumulation_steps
        window_size = min(gradient_accumulation_steps, batch_count - window_start)
        scaler.scale(loss / window_size).backward()
        if (batch_index + 1) % gradient_accumulation_steps == 0 or batch_index + 1 == batch_count:
            scaler.unscale_(optimizer)
            nn.utils.clip_grad_norm_(model.parameters(), gradient_clip)
            scaler.step(optimizer)
            scaler.update()
            optimizer.zero_grad(set_to_none=True)
        count = features.shape[0]
        totals["examples"] += count
        totals["loss"] += float(loss.detach()) * count
        totals["policyLoss"] += float(policy_loss.detach()) * count
        totals["valueLoss"] += float(value_loss.detach()) * count
    count = max(1, totals["examples"])
    return {key: float(value / count) for key, value in totals.items() if key != "examples"}


def capture_training_resume_state(
    model: CandidateSetTransformer,
    optimizer: torch.optim.Optimizer,
    scaler: torch.amp.GradScaler,
    data_generator: torch.Generator,
) -> dict[str, Any]:
    """Capture the state that can change the next optimizer update."""
    return {
        "model": copy.deepcopy(model.state_dict()),
        "optimizer": copy.deepcopy(optimizer.state_dict()),
        "scaler": copy.deepcopy(scaler.state_dict()),
        "dataGenerator": data_generator.get_state().clone(),
        "torchRng": torch.get_rng_state().clone(),
        "cudaRng": [state.clone() for state in torch.cuda.get_rng_state_all()] if torch.cuda.is_available() else [],
    }


def restore_training_resume_state(
    state: dict[str, Any],
    model: CandidateSetTransformer,
    optimizer: torch.optim.Optimizer,
    scaler: torch.amp.GradScaler,
    data_generator: torch.Generator,
) -> None:
    """Restore an exact epoch-boundary state captured by capture_training_resume_state."""
    required = {"model", "optimizer", "scaler", "dataGenerator", "torchRng", "cudaRng"}
    if set(state) != required:
        raise ValueError(f"training resume state must contain exactly {sorted(required)}")
    model.load_state_dict(state["model"])
    optimizer.load_state_dict(state["optimizer"])
    scaler.load_state_dict(state["scaler"])
    data_generator.set_state(state["dataGenerator"])
    torch.set_rng_state(state["torchRng"])
    if torch.cuda.is_available():
        cuda_rng = state["cudaRng"]
        if len(cuda_rng) != torch.cuda.device_count():
            raise ValueError("training resume state CUDA RNG count does not match the current device count")
        torch.cuda.set_rng_state_all(cuda_rng)


def dataset_hash(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode())
        with path.open("rb") as handle:
            while chunk := handle.read(8 * 1024 * 1024):
                digest.update(chunk)
    return digest.hexdigest()


def train(args: argparse.Namespace) -> dict[str, Any]:
    if args.transfer_pretrain_epochs < 0:
        raise ValueError("--transfer-pretrain-epochs must be non-negative")
    if args.gradient_accumulation_steps < 1:
        raise ValueError("--gradient-accumulation-steps must be positive")
    set_determinism(args.seed, args.fast_kernels)
    if not 0.0 <= args.unknown_policy_weight <= 1.0:
        raise ValueError("--unknown-policy-weight must be between 0 and 1")
    print(json.dumps({"stage": "scan-er-corpus", "status": "started"}), flush=True)
    er_corpus = scan_er_corpus(args.data)
    contract_schema_version = er_corpus.contract_schema_version
    feature_schema_version = er_corpus.feature_schema_version
    if er_corpus.feature_count < 1:
        raise ValueError("ER dataset contains inconsistent feature widths")
    dictionary_coverage = validate_data_dictionary_summary(
        args.dictionary,
        feature_schema_version,
        {er_corpus.feature_count},
        er_corpus.dictionary_hashes,
        er_corpus.dictionary_references,
        args.dictionary_supplement,
    )
    dictionary = json.loads(args.dictionary.read_text(encoding="utf-8"))
    feature_names = dictionary["features"]["names"]
    print(
        json.dumps(
            {
                "stage": "scan-er-corpus",
                "status": "completed",
                "decisions": er_corpus.decision_count,
                "terminals": len(er_corpus.terminals),
                "featureCount": er_corpus.feature_count,
            }
        ),
        flush=True,
    )
    print(json.dumps({"stage": "scan-selected-policy", "status": "started"}), flush=True)
    er_selection = scan_selected_er_decisions(args.data, er_corpus, args.elite_rollouts)
    rollout_selection = er_selection.rollout_selection
    er_terminals = er_selection.terminals
    er_terminal_scope = er_corpus.terminal_scope
    feature_count = er_corpus.feature_count
    if feature_count != len(feature_names):
        raise ValueError("ER decision width does not match the dictionary feature-name contract")
    transfer_decisions: list[dict[str, Any]] = []
    transfer_terminals: list[dict[str, Any]] = []
    if args.transfer_data is not None:
        transfer_decisions, transfer_terminals = load_transfer_records(args.transfer_data, feature_names)
    transfer_tokens: set[str] = set()
    for decision in transfer_decisions:
        for row in decision["candidateTokenGroups"]:
            for group in TOKEN_GROUP_NAMES:
                transfer_tokens.update(row["groups"][group])
    required_vocabulary, _ = build_token_vocabulary_from_tokens(
        er_selection.observed_tokens | transfer_tokens,
        dictionary,
    )
    initial_config = load_initial_model_config(args.init_model_dir) if args.init_model_dir is not None else None
    fixed_vocabulary_path = (
        args.token_vocabulary
        if args.token_vocabulary is not None
        else args.init_model_dir / "config.json"
        if args.init_model_dir is not None
        else None
    )
    token_vocabulary = (
        load_fixed_token_vocabulary(
            fixed_vocabulary_path,
            required_vocabulary,
            allow_unknown_tokens=args.init_model_dir is not None,
        )
        if fixed_vocabulary_path is not None
        else required_vocabulary
    )
    token_to_id = {token: index for index, token in enumerate(token_vocabulary)}
    token_vocabulary_sha256 = vocabulary_hash(token_vocabulary)
    print(
        json.dumps(
            {
                "stage": "materialize-compact-examples",
                "status": "started",
                "decisions": er_selection.decision_count,
            }
        ),
        flush=True,
    )
    er_examples = make_examples(
        iter_selected_er_decisions(args.data, er_corpus, args.elite_rollouts),
        er_terminals,
        args.loss_policy_weight,
        token_to_id,
        args.history_length,
        feature_count,
        terminal_scope=er_terminal_scope,
        unknown_policy_weight=args.unknown_policy_weight,
    )
    transfer_examples = (
        make_examples(
            transfer_decisions,
            transfer_terminals,
            args.loss_policy_weight,
            token_to_id,
            args.history_length,
            feature_count,
            terminal_scope="episode",
            unknown_policy_weight=args.unknown_policy_weight,
        )
        if transfer_decisions
        else []
    )
    print(
        json.dumps(
            {
                "stage": "materialize-compact-examples",
                "status": "completed",
                "erExamples": len(er_examples),
                "transferExamples": len(transfer_examples),
            }
        ),
        flush=True,
    )
    examples = er_examples + transfer_examples
    train_partition_ids, validation_partition_ids = split_groups(
        [example.source_partition_id for example in er_examples],
        args.seed,
    )
    er_train_examples = [example for example in er_examples if example.source_partition_id in train_partition_ids]
    validation_examples = [
        example for example in er_examples if example.source_partition_id in validation_partition_ids
    ]
    train_examples = er_train_examples + (transfer_examples if args.transfer_mode == "joint" else [])
    if not er_train_examples or not validation_examples:
        raise ValueError("both train and validation examples are required")
    feature_mean, feature_std = feature_normalization(er_train_examples + transfer_examples)
    config = CandidateTransformerConfig(
        feature_count=feature_count,
        token_vocabulary_size=len(token_vocabulary),
        token_group_count=len(TOKEN_GROUP_NAMES),
        domain_count=len(DOMAIN_NAMES),
        d_model=args.d_model,
        layers=args.layers,
        heads=args.heads,
        feedforward=args.feedforward,
        dropout=args.dropout,
        history_length=args.history_length,
        trajectory_layers=args.trajectory_layers,
    )
    device = torch.device(args.device if args.device != "auto" else "cuda" if torch.cuda.is_available() else "cpu")
    amp_enabled = args.amp and device.type == "cuda"
    if args.amp and not amp_enabled:
        raise ValueError("--amp requires a CUDA device")
    model = CandidateSetTransformer(config, feature_mean, feature_std).to(device)
    initialized_from = (
        initialize_from_checkpoint(
            model,
            args.init_model_dir,
            initial_config,
            str(dictionary_coverage["sha256"]),
            token_vocabulary,
        )
        if args.init_model_dir is not None and initial_config is not None
        else None
    )
    model.to(device)

    def make_optimizer() -> torch.optim.Optimizer:
        return torch.optim.AdamW(
            model.parameters(),
            lr=args.learning_rate,
            weight_decay=args.weight_decay,
        )

    optimizer = make_optimizer()
    generator = torch.Generator().manual_seed(args.seed)
    train_loader = DataLoader(
        DecisionDataset(train_examples),
        batch_size=args.batch_size,
        shuffle=True,
        collate_fn=partial(collate, history_length=args.history_length),
        generator=generator,
        num_workers=0,
    )
    validation_loader = DataLoader(
        DecisionDataset(validation_examples),
        batch_size=args.batch_size,
        shuffle=False,
        collate_fn=partial(collate, history_length=args.history_length),
        num_workers=0,
    )
    pretrain_loader = (
        DataLoader(
            DecisionDataset(transfer_examples),
            batch_size=args.batch_size,
            shuffle=True,
            collate_fn=partial(collate, history_length=args.history_length),
            generator=torch.Generator().manual_seed(args.seed + 1),
            num_workers=0,
        )
        if transfer_examples and args.transfer_mode == "pretrain"
        else None
    )
    history: list[dict[str, Any]] = []
    pretrain_history: list[dict[str, float | int]] = []
    best_state: dict[str, Tensor] | None = None
    best_metric = math.inf
    selection_metric_name: str | None = None
    best_epoch: int | None = None
    stale_epochs = 0
    started = time.perf_counter()
    scaler = torch.amp.GradScaler("cuda", enabled=amp_enabled)
    if pretrain_loader is not None:
        for epoch in range(1, args.transfer_pretrain_epochs + 1):
            metrics = train_epoch(
                model,
                pretrain_loader,
                optimizer,
                device,
                args.value_weight,
                args.gradient_clip,
                amp_enabled,
                scaler,
                args.gradient_accumulation_steps,
            )
            pretrain_history.append({"epoch": epoch, **metrics})
            print(f"transfer epoch {epoch:03d}: loss={metrics['loss']:.4f}", flush=True)
        optimizer = make_optimizer()
        scaler = torch.amp.GradScaler("cuda", enabled=amp_enabled)
    initial_validation: dict[str, float | None] | None = None
    if initialized_from is not None:
        initial_validation = evaluate(model, validation_loader, device)
        selection_metric_name, best_metric = checkpoint_selection_metric(initial_validation)
        best_state = copy.deepcopy({key: value.detach().cpu() for key, value in model.state_dict().items()})
        best_epoch = 0
    for epoch in range(1, args.epochs + 1):
        train_metrics = train_epoch(
            model,
            train_loader,
            optimizer,
            device,
            args.value_weight,
            args.gradient_clip,
            amp_enabled,
            scaler,
            args.gradient_accumulation_steps,
        )
        validation_metrics = evaluate(model, validation_loader, device)
        current_metric_name, current_metric = checkpoint_selection_metric(validation_metrics)
        if selection_metric_name is None:
            selection_metric_name = current_metric_name
        elif selection_metric_name != current_metric_name:
            raise RuntimeError(
                f"validation checkpoint metric changed from {selection_metric_name} to {current_metric_name}"
            )
        history.append({"epoch": epoch, "train": train_metrics, "validation": validation_metrics})
        validation_nll = validation_metrics["candidateNll"]
        policy_summary = (
            f"val_nll={validation_nll:.4f} top1={validation_metrics['top1']:.4f}"
            if validation_nll is not None
            else "val_nll=n/a top1=n/a"
        )
        print(
            f"epoch {epoch:03d}: loss={train_metrics['loss']:.4f} "
            f"{policy_summary} selection_{current_metric_name}={current_metric:.4f}",
            flush=True,
        )
        if current_metric < best_metric - args.min_delta:
            best_metric = current_metric
            best_state = copy.deepcopy({key: value.detach().cpu() for key, value in model.state_dict().items()})
            best_epoch = epoch
            stale_epochs = 0
        else:
            stale_epochs += 1
            if stale_epochs >= args.patience:
                break
    if best_state is None:
        raise RuntimeError("training did not produce a checkpoint")
    model.load_state_dict(best_state)
    model.to(device)
    final_metrics = evaluate(model, validation_loader, device)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    weights_path = args.output_dir / "model.safetensors"
    contiguous_state = {key: value.detach().cpu().contiguous() for key, value in model.state_dict().items()}
    save_file(
        contiguous_state,
        str(weights_path),
        metadata={
            "model": "er-domain-candidate-transformer-v4",
            "schemaVersion": "4",
            "contractSchemaVersion": str(contract_schema_version),
            "featureSchemaVersion": str(feature_schema_version),
            "tokenVocabularySha256": token_vocabulary_sha256,
        },
    )
    identity = er_selection.identity
    transfer_source_policies = Counter(record_policy_source(decision) for decision in transfer_decisions)
    source_policies = er_selection.source_policies + transfer_source_policies
    policy_target_decisions = er_selection.policy_target_decisions + sum(
        is_policy_target(decision) for decision in transfer_decisions
    )
    report = {
        "schemaVersion": 4,
        "model": "er-domain-candidate-transformer-v4",
        "contractSchemaVersion": contract_schema_version,
        "featureSchemaVersion": feature_schema_version,
        "architecture": asdict(config),
        "tokenGroups": list(TOKEN_GROUP_NAMES),
        "domains": list(DOMAIN_NAMES),
        "tokenVocabularySize": len(token_vocabulary),
        "tokenVocabularySha256": token_vocabulary_sha256,
        "tokenVocabularySource": "fixed" if fixed_vocabulary_path is not None else "derived",
        "parameters": parameter_count(model),
        "seed": args.seed,
        "device": str(device),
        "mixedPrecision": amp_enabled,
        "fastKernels": args.fast_kernels,
        "batchSize": args.batch_size,
        "gradientAccumulationSteps": args.gradient_accumulation_steps,
        "effectiveBatchSize": args.batch_size * args.gradient_accumulation_steps,
        "trainSeconds": time.perf_counter() - started,
        "bestEpoch": best_epoch,
        "checkpointSelection": {"metric": selection_metric_name, "best": best_metric},
        "objective": {
            "policy": "trajectory-conditioned listwise candidate cross entropy",
            "lossEpisodePolicyWeight": args.loss_policy_weight,
            "unknownOutcomePolicyWeight": args.unknown_policy_weight,
            "erTerminalScope": er_terminal_scope,
            "transferMode": args.transfer_mode if transfer_examples else None,
            "transferPretrainEpochs": args.transfer_pretrain_epochs if pretrain_loader is not None else 0,
            "value": "battle terminal binary cross entropy",
            "valueWeight": args.value_weight,
        },
        "data": {
            "decisions": len(examples),
            "trainDecisions": len(train_examples),
            "erTrainDecisions": len(er_train_examples),
            "transferDecisions": len(transfer_examples),
            "validationDecisions": len(validation_examples),
            "episodes": len({example.episode_id for example in examples}),
            "trainSourcePartitions": sorted(train_partition_ids),
            "validationSourcePartitions": sorted(validation_partition_ids),
            "trainSplitGroups": len({example.split_group_id for example in train_examples}),
            "validationSplitGroups": len({example.split_group_id for example in validation_examples}),
            "domains": dict(Counter(DOMAIN_NAMES[example.domain_id] for example in examples)),
            "sourcePolicies": dict(source_policies),
            "policyTargetDecisions": policy_target_decisions,
            "excludedPolicyDecisions": len(examples) - policy_target_decisions,
            "terminalOutcomes": dict(
                Counter(
                    terminal.get("outcome", f'value:{terminal.get("value")}')
                    for terminal in er_terminals + transfer_terminals
                )
            ),
            "rolloutSelection": rollout_selection,
            "identity": identity,
            "dictionaryCoverage": dictionary_coverage,
            "erJsonlSha256": dataset_hash(er_jsonl_files(args.data)),
            "transferJsonlSha256": dataset_hash(transfer_jsonl_files(args.transfer_data)) if args.transfer_data else None,
        },
        "validation": final_metrics,
        "initialValidation": initial_validation,
        "initializedFrom": initialized_from,
        "pretrainHistory": pretrain_history,
        "history": history,
        "artifacts": {"weights": weights_path.name, "config": "config.json", "report": "report.json"},
    }
    config_payload = {
        "schemaVersion": 4,
        "model": report["model"],
        "contractSchemaVersion": contract_schema_version,
        "featureSchemaVersion": feature_schema_version,
        "architecture": asdict(config),
        "dictionaryHash": dictionary_coverage["sha256"],
        "tokenGroups": list(TOKEN_GROUP_NAMES),
        "domains": list(DOMAIN_NAMES),
        "tokenVocabulary": token_vocabulary,
        "tokenVocabularySha256": token_vocabulary_sha256,
        "weights": weights_path.name,
    }
    (args.output_dir / "config.json").write_text(json.dumps(config_payload, indent=2) + "\n", encoding="utf-8")
    (args.output_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"validation": final_metrics, "parameters": report["parameters"], "device": str(device)}))
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument(
        "--transfer-data",
        type=Path,
        help="optional schema-v1 candidate_transfer_decision JSONL from another battle domain",
    )
    parser.add_argument("--transfer-mode", choices=("pretrain", "joint"), default="pretrain")
    parser.add_argument("--transfer-pretrain-epochs", type=int, default=8)
    parser.add_argument("--dictionary", type=Path, required=True)
    parser.add_argument(
        "--dictionary-supplement",
        type=Path,
        help="hash-bound runtime dictionary additions for generated combat ids",
    )
    parser.add_argument(
        "--token-vocabulary",
        type=Path,
        help="optional fixed vocabulary/config used to keep transfer ablations architecture-matched",
    )
    parser.add_argument(
        "--init-model-dir",
        type=Path,
        help="strictly resume a compatible v4 checkpoint; unseen dynamic tokens map to UNK",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=20260730)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--patience", type=int, default=6)
    parser.add_argument("--min-delta", type=float, default=1e-4)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--gradient-accumulation-steps", type=int, default=1)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--weight-decay", type=float, default=1e-3)
    parser.add_argument("--gradient-clip", type=float, default=1.0)
    parser.add_argument("--value-weight", type=float, default=0.2)
    parser.add_argument(
        "--loss-policy-weight",
        type=float,
        default=0.0,
        help="policy loss weight for losing episodes; losses still train the value head",
    )
    parser.add_argument(
        "--unknown-policy-weight",
        type=float,
        default=0.0,
        help="policy loss weight for incomplete, capture, flee, or otherwise unlabelled battles",
    )
    parser.add_argument(
        "--elite-rollouts",
        action="store_true",
        help="retain epsilon-tree decisions only from successful combat episodes",
    )
    parser.add_argument("--d-model", type=int, default=320)
    parser.add_argument("--layers", type=int, default=4)
    parser.add_argument("--heads", type=int, default=8)
    parser.add_argument("--feedforward", type=int, default=960)
    parser.add_argument("--dropout", type=float, default=0.0)
    parser.add_argument("--history-length", type=int, default=8)
    parser.add_argument("--trajectory-layers", type=int, default=2)
    parser.add_argument("--amp", action="store_true", help="use CUDA fp16 autocast with gradient scaling")
    parser.add_argument(
        "--fast-kernels",
        action="store_true",
        help="allow nondeterministic fused CUDA kernels for scaled training",
    )
    return parser.parse_args()


if __name__ == "__main__":
    train(parse_args())
