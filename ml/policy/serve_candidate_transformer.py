#!/usr/bin/env python3
"""Persistent JSONL inference sidecar for the test-only ER combat harness."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch
from safetensors.torch import load_file

POLICY_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(POLICY_DIR))

from candidate_transformer import (  # noqa: E402
    CandidateSetTransformer,
    CandidateTransformerConfig,
    load_compatible_state_dict,
)

MODEL_NAME = "er-domain-candidate-transformer-v4"
ENSEMBLE_NAME = "er-domain-candidate-transformer-ensemble-v4"
SUPPORTED_CONTRACTS = {(3, 2), (4, 4)}
TOKEN_GROUP_NAMES = ("actor", "targets", "destination", "field", "action")
DOMAIN_NAMES = ("elite-redux", "showdown")


@dataclass(frozen=True)
class CandidatePolicyBundle:
    model: CandidateSetTransformer
    token_vocabulary: tuple[str, ...]
    token_to_id: dict[str, int]
    dictionary_hash: str
    domains: tuple[str, ...]
    contract_schema_version: int
    feature_schema_version: int
    contract_feature_count: int
    input_feature_indices: tuple[int, ...]


def load_bundle(model_dir: Path) -> CandidatePolicyBundle:
    config_path = model_dir / "config.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    if config.get("schemaVersion") != 4 or config.get("model") != MODEL_NAME:
        raise ValueError(f"unsupported neural policy config: {config_path}")
    contract_identity = (config.get("contractSchemaVersion"), config.get("featureSchemaVersion"))
    if contract_identity not in SUPPORTED_CONTRACTS:
        raise ValueError(f"unsupported contract/feature schema pair: {contract_identity}")
    architecture = config.get("architecture")
    if not isinstance(architecture, dict):
        raise ValueError("neural policy config is missing architecture")
    model_config = CandidateTransformerConfig(**architecture)
    contract_feature_count = config.get("contractFeatureCount", model_config.feature_count)
    input_feature_indices = config.get("inputFeatureIndices", list(range(model_config.feature_count)))
    if (
        not isinstance(contract_feature_count, int)
        or contract_feature_count < model_config.feature_count
        or not isinstance(input_feature_indices, list)
        or len(input_feature_indices) != model_config.feature_count
        or any(not isinstance(index, int) or index < 0 or index >= contract_feature_count for index in input_feature_indices)
        or len(set(input_feature_indices)) != len(input_feature_indices)
    ):
        raise ValueError("neural policy config has an invalid numeric feature selection")
    token_vocabulary = config.get("tokenVocabulary")
    if (
        not isinstance(token_vocabulary, list)
        or token_vocabulary[:2] != ["<PAD>", "<UNK>"]
        or any(not isinstance(token, str) or not token for token in token_vocabulary)
        or len(set(token_vocabulary)) != len(token_vocabulary)
    ):
        raise ValueError("neural policy config has an invalid token vocabulary")
    if len(token_vocabulary) != model_config.token_vocabulary_size:
        raise ValueError("token vocabulary size does not match architecture")
    vocabulary_payload = json.dumps(token_vocabulary, ensure_ascii=True, separators=(",", ":")).encode()
    vocabulary_digest = hashlib.sha256(vocabulary_payload).hexdigest()
    if config.get("tokenVocabularySha256") != vocabulary_digest:
        raise ValueError("token vocabulary hash mismatch")
    if config.get("tokenGroups") != list(TOKEN_GROUP_NAMES):
        raise ValueError("token group contract mismatch")
    if config.get("domains") != list(DOMAIN_NAMES) or model_config.domain_count != len(DOMAIN_NAMES):
        raise ValueError("neural policy domain contract mismatch")
    dictionary_hash = config.get("dictionaryHash")
    if not isinstance(dictionary_hash, str) or len(dictionary_hash) != 64:
        raise ValueError("neural policy config is missing its dictionary hash")
    weights_name = config.get("weights")
    if not isinstance(weights_name, str) or Path(weights_name).name != weights_name:
        raise ValueError("neural policy weights must be a local filename")
    model = CandidateSetTransformer(model_config)
    load_compatible_state_dict(model, load_file(str(model_dir / weights_name), device="cpu"))
    model.eval()
    return CandidatePolicyBundle(
        model=model,
        token_vocabulary=tuple(token_vocabulary),
        token_to_id={token: index for index, token in enumerate(token_vocabulary)},
        dictionary_hash=dictionary_hash,
        domains=DOMAIN_NAMES,
        contract_schema_version=contract_identity[0],
        feature_schema_version=contract_identity[1],
        contract_feature_count=contract_feature_count,
        input_feature_indices=tuple(input_feature_indices),
    )


def load_ensemble(model_dir: Path) -> list[CandidatePolicyBundle]:
    ensemble_path = model_dir / "ensemble.json"
    if not ensemble_path.exists():
        return [load_bundle(model_dir)]
    payload = json.loads(ensemble_path.read_text(encoding="utf-8"))
    members = payload.get("members")
    if payload.get("schemaVersion") != 4 or payload.get("model") != ENSEMBLE_NAME:
        raise ValueError(f"unsupported neural ensemble config: {ensemble_path}")
    if not isinstance(members, list) or len(members) < 2:
        raise ValueError("neural ensemble requires at least two member directories")
    models = []
    for member in members:
        if not isinstance(member, str) or Path(member).name != member:
            raise ValueError("neural ensemble members must be local directory names")
        models.append(load_bundle(model_dir / member))
    feature_counts = {bundle.model.config.feature_count for bundle in models}
    if len(feature_counts) != 1:
        raise ValueError(f"neural ensemble feature counts differ: {sorted(feature_counts)}")
    vocabularies = {bundle.token_vocabulary for bundle in models}
    dictionary_hashes = {bundle.dictionary_hash for bundle in models}
    if len(vocabularies) != 1 or len(dictionary_hashes) != 1:
        raise ValueError("neural ensemble members use different token vocabularies or dictionaries")
    configurations = {bundle.model.config for bundle in models}
    if len(configurations) != 1:
        raise ValueError("neural ensemble members use different architectures")
    numeric_contracts = {(bundle.contract_feature_count, bundle.input_feature_indices) for bundle in models}
    if len(numeric_contracts) != 1:
        raise ValueError("neural ensemble members use different numeric feature selections")
    contract_identities = {
        (bundle.contract_schema_version, bundle.feature_schema_version) for bundle in models
    }
    if len(contract_identities) != 1:
        raise ValueError("neural ensemble members use different contract schemas")
    contract_schema_version, feature_schema_version = next(iter(contract_identities))
    if (
        payload.get("contractSchemaVersion") != contract_schema_version
        or payload.get("featureSchemaVersion") != feature_schema_version
    ):
        raise ValueError("neural ensemble manifest contract identity does not match its members")
    return models


def encode_token_groups(bundle: CandidatePolicyBundle, candidate_groups: Any) -> tuple[torch.Tensor, torch.Tensor]:
    if not isinstance(candidate_groups, list) or not candidate_groups:
        raise ValueError("candidateTokenGroups must be a non-empty array")
    encoded: list[list[list[int]]] = []
    for groups in candidate_groups:
        if not isinstance(groups, dict) or set(groups) != set(TOKEN_GROUP_NAMES):
            raise ValueError("candidate token groups have an invalid role set")
        encoded.append([
            [bundle.token_to_id.get(token, 1) for token in groups[group]]
            for group in TOKEN_GROUP_NAMES
        ])
    max_tokens = max(1, max(len(tokens) for candidate in encoded for tokens in candidate))
    token_ids = torch.zeros((1, len(encoded), len(TOKEN_GROUP_NAMES), max_tokens), dtype=torch.long)
    token_mask = torch.zeros_like(token_ids, dtype=torch.bool)
    for candidate_index, candidate in enumerate(encoded):
        for group_index, tokens in enumerate(candidate):
            if tokens:
                token_ids[0, candidate_index, group_index, :len(tokens)] = torch.tensor(tokens, dtype=torch.long)
                token_mask[0, candidate_index, group_index, :len(tokens)] = True
    return token_ids, token_mask


def score_candidates(
    bundle_or_bundles: CandidatePolicyBundle | list[CandidatePolicyBundle],
    rows: Any,
    candidate_groups: Any,
    history: Any = None,
    feature_presence: Any = None,
    domain: Any = "elite-redux",
) -> tuple[list[float], float]:
    bundles = bundle_or_bundles if isinstance(bundle_or_bundles, list) else [bundle_or_bundles]
    if not bundles:
        raise ValueError("neural ensemble is empty")
    if not isinstance(rows, list) or not rows:
        raise ValueError("candidateFeatures must be a non-empty array")
    bundle = bundles[0]
    feature_count = bundle.model.config.feature_count
    contract_feature_count = bundle.contract_feature_count
    if any(not isinstance(row, list) or len(row) != contract_feature_count for row in rows):
        raise ValueError(f"every candidate feature row must contain {contract_feature_count} values")
    compact_rows = [[row[index] for index in bundle.input_feature_indices] for row in rows]
    features = torch.tensor(compact_rows, dtype=torch.float32).unsqueeze(0)
    if not bool(torch.isfinite(features).all()):
        raise ValueError("candidate features must be finite")
    mask = torch.ones((1, len(rows)), dtype=torch.bool)
    if feature_presence is None:
        feature_presence = [[True] * contract_feature_count for _ in rows]
    if (
        not isinstance(feature_presence, list)
        or len(feature_presence) != len(rows)
        or any(
            not isinstance(row, list)
            or len(row) != contract_feature_count
            or any(not isinstance(value, bool) for value in row)
            for row in feature_presence
        )
    ):
        raise ValueError("featurePresence must be a boolean matrix matching candidateFeatures")
    compact_presence = [[row[index] for index in bundle.input_feature_indices] for row in feature_presence]
    presence = torch.tensor(compact_presence, dtype=torch.bool).unsqueeze(0)
    if domain not in bundles[0].domains:
        raise ValueError(f"unknown policy domain {domain}")
    domain_ids = torch.tensor([bundles[0].domains.index(domain)], dtype=torch.long)
    if not isinstance(candidate_groups, list) or len(candidate_groups) != len(rows):
        raise ValueError("candidateTokenGroups must match candidateFeatures")
    token_ids, token_mask = encode_token_groups(bundles[0], candidate_groups)
    (
        history_features,
        history_candidate_mask,
        history_token_ids,
        history_token_mask,
        history_chosen,
        history_step_mask,
        history_feature_presence,
        history_domain_ids,
    ) = encode_history(bundles[0], history, domain)
    with torch.inference_mode():
        outputs = [
            bundle.model(
                features,
                mask,
                token_ids,
                token_mask,
                history_features,
                history_candidate_mask,
                history_token_ids,
                history_token_mask,
                history_chosen,
                history_step_mask,
                presence,
                domain_ids,
                history_feature_presence,
                history_domain_ids,
            )
            for bundle in bundles
        ]
        logits = torch.stack([output[0] for output in outputs]).mean(dim=0)
        value_logit = torch.stack([output[1] for output in outputs]).mean(dim=0)
    scores = [float(value) for value in logits[0].tolist()]
    value = float(torch.sigmoid(value_logit[0]))
    if any(not math.isfinite(score) for score in scores) or not math.isfinite(value):
        raise ValueError("model returned non-finite output")
    return scores, value


def encode_history(
    bundle: CandidatePolicyBundle,
    history: Any,
    default_domain: str = "elite-redux",
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    if history is None:
        history = []
    if not isinstance(history, list):
        raise ValueError("history must be an array")
    retained = history[-bundle.model.config.history_length:] if bundle.model.config.history_length else []
    if any(not isinstance(step, dict) for step in retained):
        raise ValueError("every history step must be an object")
    feature_count = bundle.model.config.feature_count
    contract_feature_count = bundle.contract_feature_count
    max_candidates = max(1, max((len(step.get("candidateFeatures", [])) for step in retained), default=0))
    encoded_steps: list[tuple[torch.Tensor, torch.Tensor, int, torch.Tensor, int, torch.Tensor]] = []
    for step in retained:
        rows = step.get("candidateFeatures")
        groups = step.get("candidateTokenGroups")
        chosen_index = step.get("chosenIndex")
        step_presence = step.get("featurePresence")
        step_domain = step.get("domain", default_domain)
        if not isinstance(rows, list) or not rows:
            raise ValueError("history candidateFeatures must be a non-empty array")
        if any(not isinstance(row, list) or len(row) != contract_feature_count for row in rows):
            raise ValueError(f"every history candidate feature row must contain {contract_feature_count} values")
        compact_rows = [[row[index] for index in bundle.input_feature_indices] for row in rows]
        row_tensor = torch.tensor(compact_rows, dtype=torch.float32)
        if not bool(torch.isfinite(row_tensor).all()):
            raise ValueError("history candidate features must be finite")
        if not isinstance(chosen_index, int) or chosen_index < 0 or chosen_index >= len(rows):
            raise ValueError("history chosenIndex is outside the candidate set")
        if step_presence is None:
            step_presence = [[True] * contract_feature_count for _ in rows]
        if (
            not isinstance(step_presence, list)
            or len(step_presence) != len(rows)
            or any(
                not isinstance(row, list)
                or len(row) != contract_feature_count
                or any(not isinstance(value, bool) for value in row)
                for row in step_presence
            )
        ):
            raise ValueError("history featurePresence must match candidateFeatures")
        if step_domain not in bundle.domains:
            raise ValueError(f"unknown history policy domain {step_domain}")
        step_token_ids, step_token_mask = encode_token_groups(bundle, groups)
        encoded_steps.append(
            (
                step_token_ids,
                step_token_mask,
                chosen_index,
                torch.tensor(
                    [[row[index] for index in bundle.input_feature_indices] for row in step_presence],
                    dtype=torch.bool,
                ),
                bundle.domains.index(step_domain),
                row_tensor,
            )
        )

    max_tokens = max(1, max((int(tokens.shape[-1]) for tokens, _, _, _, _, _ in encoded_steps), default=0))
    history_length = bundle.model.config.history_length
    features = torch.zeros((1, history_length, max_candidates, feature_count), dtype=torch.float32)
    feature_presence = torch.zeros_like(features, dtype=torch.bool)
    candidate_mask = torch.zeros((1, history_length, max_candidates), dtype=torch.bool)
    token_ids = torch.zeros(
        (1, history_length, max_candidates, len(TOKEN_GROUP_NAMES), max_tokens),
        dtype=torch.long,
    )
    token_mask = torch.zeros_like(token_ids, dtype=torch.bool)
    chosen = torch.zeros((1, history_length), dtype=torch.long)
    step_mask = torch.zeros((1, history_length), dtype=torch.bool)
    domain_ids = torch.zeros((1, history_length), dtype=torch.long)
    offset = history_length - len(retained)
    for index, (step, encoded) in enumerate(zip(retained, encoded_steps), offset):
        step_tokens, step_token_mask, chosen_index, step_presence, domain_id, rows = encoded
        count = rows.shape[0]
        features[0, index, :count] = rows
        candidate_mask[0, index, :count] = True
        feature_presence[0, index, :count] = step_presence
        token_count = step_tokens.shape[-1]
        token_ids[0, index, :count, :, :token_count] = step_tokens[0]
        token_mask[0, index, :count, :, :token_count] = step_token_mask[0]
        chosen[0, index] = chosen_index
        step_mask[0, index] = True
        domain_ids[0, index] = domain_id
    return features, candidate_mask, token_ids, token_mask, chosen, step_mask, feature_presence, domain_ids


def serve(model_dir: Path) -> None:
    torch.set_num_threads(max(1, min(4, torch.get_num_threads())))
    models = load_ensemble(model_dir)
    print(
        json.dumps(
            {
                "type": "ready",
                "model": MODEL_NAME if len(models) == 1 else ENSEMBLE_NAME,
                "members": len(models),
                "featureSchemaVersion": models[0].feature_schema_version,
                "featureCount": models[0].contract_feature_count,
                "modelFeatureCount": models[0].model.config.feature_count,
                "historyLength": models[0].model.config.history_length,
                "contractSchemaVersion": models[0].contract_schema_version,
                "tokenGroups": list(TOKEN_GROUP_NAMES),
                "domains": list(models[0].domains),
                "dictionaryHash": models[0].dictionary_hash,
            }
        ),
        flush=True,
    )
    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        request_id: Any = None
        try:
            request = json.loads(raw_line)
            request_id = request.get("id")
            if not isinstance(request_id, int):
                raise ValueError("request id must be an integer")
            scores, value = score_candidates(
                models,
                request.get("candidateFeatures"),
                request.get("candidateTokenGroups"),
                request.get("history"),
                request.get("featurePresence"),
                request.get("domain", "elite-redux"),
            )
            response = {"id": request_id, "scores": scores, "value": value}
        except Exception as error:  # Protocol errors must be returned to the waiting caller.
            response = {"id": request_id, "error": f"{type(error).__name__}: {error}"}
        print(json.dumps(response, separators=(",", ":")), flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, required=True)
    return parser.parse_args()


if __name__ == "__main__":
    serve(parse_args().model_dir)
