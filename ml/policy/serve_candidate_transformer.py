#!/usr/bin/env python3
"""Persistent JSONL inference sidecar for the test-only ER combat harness."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import torch
from safetensors.torch import load_file

POLICY_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(POLICY_DIR))

from candidate_transformer import CandidateSetTransformer, CandidateTransformerConfig  # noqa: E402

MODEL_NAME = "er-candidate-set-transformer-v1"
ENSEMBLE_NAME = "er-candidate-set-transformer-ensemble-v1"
FEATURE_SCHEMA_VERSION = 1


def load_bundle(model_dir: Path) -> CandidateSetTransformer:
    config_path = model_dir / "config.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    if config.get("schemaVersion") != 1 or config.get("model") != MODEL_NAME:
        raise ValueError(f"unsupported neural policy config: {config_path}")
    if config.get("featureSchemaVersion") != FEATURE_SCHEMA_VERSION:
        raise ValueError(
            f"feature schema mismatch: expected {FEATURE_SCHEMA_VERSION}, got {config.get('featureSchemaVersion')}"
        )
    architecture = config.get("architecture")
    if not isinstance(architecture, dict):
        raise ValueError("neural policy config is missing architecture")
    model_config = CandidateTransformerConfig(**architecture)
    weights_name = config.get("weights")
    if not isinstance(weights_name, str) or Path(weights_name).name != weights_name:
        raise ValueError("neural policy weights must be a local filename")
    model = CandidateSetTransformer(model_config)
    model.load_state_dict(load_file(str(model_dir / weights_name), device="cpu"), strict=True)
    model.eval()
    return model


def load_ensemble(model_dir: Path) -> list[CandidateSetTransformer]:
    ensemble_path = model_dir / "ensemble.json"
    if not ensemble_path.exists():
        return [load_bundle(model_dir)]
    payload = json.loads(ensemble_path.read_text(encoding="utf-8"))
    members = payload.get("members")
    if payload.get("schemaVersion") != 1 or payload.get("model") != ENSEMBLE_NAME:
        raise ValueError(f"unsupported neural ensemble config: {ensemble_path}")
    if not isinstance(members, list) or len(members) < 2:
        raise ValueError("neural ensemble requires at least two member directories")
    models = []
    for member in members:
        if not isinstance(member, str) or Path(member).name != member:
            raise ValueError("neural ensemble members must be local directory names")
        models.append(load_bundle(model_dir / member))
    feature_counts = {model.config.feature_count for model in models}
    if len(feature_counts) != 1:
        raise ValueError(f"neural ensemble feature counts differ: {sorted(feature_counts)}")
    return models


def score_candidates(
    model_or_models: CandidateSetTransformer | list[CandidateSetTransformer], rows: Any
) -> tuple[list[float], float]:
    models = model_or_models if isinstance(model_or_models, list) else [model_or_models]
    if not models:
        raise ValueError("neural ensemble is empty")
    if not isinstance(rows, list) or not rows:
        raise ValueError("candidateFeatures must be a non-empty array")
    feature_count = models[0].config.feature_count
    if any(not isinstance(row, list) or len(row) != feature_count for row in rows):
        raise ValueError(f"every candidate feature row must contain {feature_count} values")
    features = torch.tensor(rows, dtype=torch.float32).unsqueeze(0)
    if not bool(torch.isfinite(features).all()):
        raise ValueError("candidate features must be finite")
    mask = torch.ones((1, len(rows)), dtype=torch.bool)
    with torch.inference_mode():
        outputs = [model(features, mask) for model in models]
        logits = torch.stack([output[0] for output in outputs]).mean(dim=0)
        value_logit = torch.stack([output[1] for output in outputs]).mean(dim=0)
    scores = [float(value) for value in logits[0].tolist()]
    value = float(torch.sigmoid(value_logit[0]))
    if any(not math.isfinite(score) for score in scores) or not math.isfinite(value):
        raise ValueError("model returned non-finite output")
    return scores, value


def serve(model_dir: Path) -> None:
    torch.set_num_threads(max(1, min(4, torch.get_num_threads())))
    models = load_ensemble(model_dir)
    print(
        json.dumps(
            {
                "type": "ready",
                "model": MODEL_NAME if len(models) == 1 else ENSEMBLE_NAME,
                "members": len(models),
                "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
                "featureCount": models[0].config.feature_count,
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
            scores, value = score_candidates(models, request.get("candidateFeatures"))
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
