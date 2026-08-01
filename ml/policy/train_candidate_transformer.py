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
from collections import Counter
from dataclasses import asdict, dataclass
from functools import partial
from pathlib import Path
from typing import Any

import numpy as np
import torch
from safetensors.torch import load_file, save_file
from torch import Tensor, nn
from torch.utils.data import DataLoader, Dataset

POLICY_DIR = Path(__file__).resolve().parent
BASELINE_DIR = POLICY_DIR.parent / "baselines"
sys.path.insert(0, str(BASELINE_DIR))

from train_candidate_baselines import (  # noqa: E402
    FEATURE_SCHEMA_VERSION,
    SCHEMA_VERSION,
    TOKEN_GROUP_NAMES,
    embedded_candidate_features,
    is_policy_target,
    jsonl_files,
    load_records,
    record_policy_source,
    record_split_group,
    record_source_partition,
    select_elite_rollouts,
    split_groups,
    validate_data_dictionary,
)

from candidate_transformer import (  # noqa: E402
    CandidateSetTransformer,
    CandidateTransformerConfig,
    parameter_count,
)

WIN_OUTCOMES = {"victory", "max-waves"}
LOSS_OUTCOMES = {"player-wiped"}
PAD_TOKEN = "<PAD>"
UNKNOWN_TOKEN = "<UNK>"
DOMAIN_NAMES = ("elite-redux", "showdown")
DOMAIN_TO_ID = {name: index for index, name in enumerate(DOMAIN_NAMES)}
TRANSFER_SCHEMA_VERSION = 1


@dataclass(frozen=True)
class DecisionState:
    features: np.ndarray
    feature_presence: np.ndarray
    feature_indices: np.ndarray
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
    feature_presence: np.ndarray
    feature_indices: np.ndarray
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
    model.load_state_dict(load_file(str(weights_path), device="cpu"), strict=True)
    return {
        "modelDir": str(model_dir),
        "weightsSha256": hashlib.sha256(weights_path.read_bytes()).hexdigest(),
        "configSha256": hashlib.sha256((model_dir / "config.json").read_bytes()).hexdigest(),
    }


def make_examples(
    decisions: list[dict[str, Any]],
    terminals: list[dict[str, Any]],
    loss_policy_weight: float,
    token_to_id: dict[str, int],
    history_length: int = 8,
    full_feature_count: int | None = None,
) -> list[DecisionExample]:
    if history_length < 0:
        raise ValueError("history_length must be non-negative")
    terminal_by_episode = {terminal["episodeId"]: terminal for terminal in terminals}
    examples: list[DecisionExample] = []
    history_by_episode: dict[str, list[DecisionState]] = {}
    for decision in decisions:
        candidates = decision["candidates"]
        feature_rows = {row["candidateId"]: row for row in decision["candidateFeatures"]}
        features = np.asarray([feature_rows[candidate["id"]]["values"] for candidate in candidates], dtype=np.float32)
        feature_presence = np.asarray(
            [feature_rows[candidate["id"]].get("presence", [True] * features.shape[1]) for candidate in candidates],
            dtype=np.bool_,
        )
        resolved_feature_count = full_feature_count if full_feature_count is not None else features.shape[1]
        feature_indices = np.asarray(
            decision.get("trainingFeatureIndices", list(range(features.shape[1]))),
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
        value = terminal_value(terminal_by_episode[decision["episodeId"]])
        outcome_weight = 1.0 if value == 1.0 else loss_policy_weight if value == 0.0 else 0.5
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
        episode_history = history_by_episode.setdefault(decision["episodeId"], [])
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
                history=tuple(episode_history[-history_length:]) if history_length else (),
            )
        )
        episode_history.append(state)
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
        columns = torch.from_numpy(example.feature_indices)
        features[index, :count].index_copy_(1, columns, torch.from_numpy(example.features))
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
            history_columns = torch.from_numpy(state.feature_indices)
            history_features[index, history_index, :history_count].index_copy_(
                1,
                history_columns,
                torch.from_numpy(state.features),
            )
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
        present_values = example.features * example.feature_presence
        indices = example.feature_indices
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
) -> dict[str, float]:
    model.train()
    totals = Counter()
    for batch in loader:
        features = batch["features"].to(device)
        mask = batch["mask"].to(device)
        chosen = batch["chosen"].to(device)
        policy_weights = batch["policyWeights"].to(device)
        optimizer.zero_grad(set_to_none=True)
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
        scaler.scale(loss).backward()
        scaler.unscale_(optimizer)
        nn.utils.clip_grad_norm_(model.parameters(), gradient_clip)
        scaler.step(optimizer)
        scaler.update()
        count = features.shape[0]
        totals["examples"] += count
        totals["loss"] += float(loss.detach()) * count
        totals["policyLoss"] += float(policy_loss.detach()) * count
        totals["valueLoss"] += float(value_loss.detach()) * count
    count = max(1, totals["examples"])
    return {key: float(value / count) for key, value in totals.items() if key != "examples"}


def dataset_hash(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def train(args: argparse.Namespace) -> dict[str, Any]:
    if args.transfer_pretrain_epochs < 0:
        raise ValueError("--transfer-pretrain-epochs must be non-negative")
    set_determinism(args.seed, args.fast_kernels)
    er_decisions, er_terminals = load_records(args.data)
    dictionary_coverage = validate_data_dictionary(args.dictionary, er_decisions)
    dictionary = json.loads(args.dictionary.read_text(encoding="utf-8"))
    feature_names = dictionary["features"]["names"]
    rollout_selection: dict[str, Any] | None = None
    if args.elite_rollouts:
        er_decisions, rollout_selection = select_elite_rollouts(er_decisions, er_terminals)
        selected_episodes = {decision["episodeId"] for decision in er_decisions}
        er_terminals = [terminal for terminal in er_terminals if terminal["episodeId"] in selected_episodes]
    feature_count = len(er_decisions[0]["candidateFeatures"][0]["values"])
    if feature_count != len(feature_names):
        raise ValueError("ER decision width does not match the dictionary feature-name contract")
    transfer_decisions: list[dict[str, Any]] = []
    transfer_terminals: list[dict[str, Any]] = []
    if args.transfer_data is not None:
        transfer_decisions, transfer_terminals = load_transfer_records(args.transfer_data, feature_names)
    decisions = er_decisions + transfer_decisions
    terminals = er_terminals + transfer_terminals
    required_vocabulary, _ = build_token_vocabulary(decisions, dictionary)
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
    examples = make_examples(
        decisions,
        terminals,
        args.loss_policy_weight,
        token_to_id,
        args.history_length,
        feature_count,
    )
    er_examples = [example for example in examples if example.domain_id == DOMAIN_TO_ID["elite-redux"]]
    transfer_examples = [example for example in examples if example.domain_id != DOMAIN_TO_ID["elite-redux"]]
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
            "contractSchemaVersion": str(SCHEMA_VERSION),
            "featureSchemaVersion": str(FEATURE_SCHEMA_VERSION),
            "tokenVocabularySha256": token_vocabulary_sha256,
        },
    )
    identity = {
        key: sorted({record[key] for record in er_decisions})
        for key in ("buildSha", "dexHash", "dictionaryHash")
    }
    report = {
        "schemaVersion": 4,
        "model": "er-domain-candidate-transformer-v4",
        "contractSchemaVersion": SCHEMA_VERSION,
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
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
        "trainSeconds": time.perf_counter() - started,
        "bestEpoch": best_epoch,
        "checkpointSelection": {"metric": selection_metric_name, "best": best_metric},
        "objective": {
            "policy": "trajectory-conditioned listwise candidate cross entropy",
            "lossEpisodePolicyWeight": args.loss_policy_weight,
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
            "sourcePolicies": dict(Counter(record_policy_source(decision) for decision in decisions)),
            "policyTargetDecisions": sum(is_policy_target(decision) for decision in decisions),
            "excludedPolicyDecisions": sum(not is_policy_target(decision) for decision in decisions),
            "terminalOutcomes": dict(
                Counter(terminal.get("outcome", f'value:{terminal.get("value")}') for terminal in terminals)
            ),
            "rolloutSelection": rollout_selection,
            "identity": identity,
            "dictionaryCoverage": dictionary_coverage,
            "erJsonlSha256": dataset_hash(jsonl_files(args.data)),
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
        "contractSchemaVersion": SCHEMA_VERSION,
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
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
