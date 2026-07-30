#!/usr/bin/env python3
"""Train the ER candidate-set transformer on versioned combat JSONL artifacts."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import random
import sys
import time
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
from safetensors.torch import save_file
from torch import Tensor, nn
from torch.utils.data import DataLoader, Dataset

POLICY_DIR = Path(__file__).resolve().parent
BASELINE_DIR = POLICY_DIR.parent / "baselines"
sys.path.insert(0, str(BASELINE_DIR))

from train_candidate_baselines import (  # noqa: E402
    FEATURE_SCHEMA_VERSION,
    SCHEMA_VERSION,
    embedded_candidate_features,
    load_records,
    record_split_group,
    select_elite_rollouts,
    split_groups,
)

from candidate_transformer import (  # noqa: E402
    CandidateSetTransformer,
    CandidateTransformerConfig,
    parameter_count,
)

WIN_OUTCOMES = {"victory", "max-waves"}
LOSS_OUTCOMES = {"player-wiped"}


@dataclass(frozen=True)
class DecisionExample:
    decision_id: str
    episode_id: str
    split_group_id: str
    features: np.ndarray
    chosen_index: int
    terminal_value: float | None
    policy_weight: float


class DecisionDataset(Dataset[DecisionExample]):
    def __init__(self, examples: list[DecisionExample]) -> None:
        self.examples = examples

    def __len__(self) -> int:
        return len(self.examples)

    def __getitem__(self, index: int) -> DecisionExample:
        return self.examples[index]


def terminal_value(terminal: dict[str, Any]) -> float | None:
    if terminal.get("outcome") in WIN_OUTCOMES:
        return 1.0
    if terminal.get("outcome") in LOSS_OUTCOMES:
        return 0.0
    return None


def make_examples(
    decisions: list[dict[str, Any]],
    terminals: list[dict[str, Any]],
    loss_policy_weight: float,
) -> list[DecisionExample]:
    terminal_by_episode = {terminal["episodeId"]: terminal for terminal in terminals}
    examples: list[DecisionExample] = []
    for decision in decisions:
        candidates = decision["candidates"]
        features = np.asarray(
            [embedded_candidate_features(decision, candidate) for candidate in candidates],
            dtype=np.float32,
        )
        chosen_index = next(
            index for index, candidate in enumerate(candidates) if candidate["id"] == decision["chosenCandidateId"]
        )
        value = terminal_value(terminal_by_episode[decision["episodeId"]])
        weight = 1.0 if value == 1.0 else loss_policy_weight if value == 0.0 else 0.5
        examples.append(
            DecisionExample(
                decision_id=decision["decisionId"],
                episode_id=decision["episodeId"],
                split_group_id=record_split_group(decision),
                features=features,
                chosen_index=chosen_index,
                terminal_value=value,
                policy_weight=weight,
            )
        )
    return examples


def collate(examples: list[DecisionExample]) -> dict[str, Any]:
    max_candidates = max(example.features.shape[0] for example in examples)
    feature_count = examples[0].features.shape[1]
    features = torch.zeros((len(examples), max_candidates, feature_count), dtype=torch.float32)
    mask = torch.zeros((len(examples), max_candidates), dtype=torch.bool)
    chosen = torch.zeros(len(examples), dtype=torch.long)
    values = torch.zeros(len(examples), dtype=torch.float32)
    value_mask = torch.zeros(len(examples), dtype=torch.bool)
    policy_weights = torch.zeros(len(examples), dtype=torch.float32)
    for index, example in enumerate(examples):
        count = example.features.shape[0]
        features[index, :count] = torch.from_numpy(example.features)
        mask[index, :count] = True
        chosen[index] = example.chosen_index
        policy_weights[index] = example.policy_weight
        if example.terminal_value is not None:
            values[index] = example.terminal_value
            value_mask[index] = True
    return {
        "features": features,
        "mask": mask,
        "chosen": chosen,
        "values": values,
        "valueMask": value_mask,
        "policyWeights": policy_weights,
        "decisionIds": [example.decision_id for example in examples],
    }


def feature_normalization(examples: list[DecisionExample]) -> tuple[Tensor, Tensor]:
    rows = np.concatenate([example.features for example in examples], axis=0)
    return torch.from_numpy(rows.mean(axis=0)), torch.from_numpy(rows.std(axis=0).clip(min=1e-6))


def set_determinism(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
        torch.backends.cuda.enable_flash_sdp(False)
        torch.backends.cuda.enable_mem_efficient_sdp(False)
        torch.backends.cuda.enable_math_sdp(True)
    torch.use_deterministic_algorithms(True)


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
) -> dict[str, float]:
    model.eval()
    logits: list[Tensor] = []
    chosen: list[Tensor] = []
    masks: list[Tensor] = []
    values: list[Tensor] = []
    value_targets: list[Tensor] = []
    with torch.inference_mode():
        for batch in loader:
            batch_logits, batch_values = model(batch["features"].to(device), batch["mask"].to(device))
            logits.append(batch_logits.cpu())
            chosen.append(batch["chosen"])
            masks.append(batch["mask"])
            selected = batch["valueMask"]
            if selected.any():
                values.append(batch_values.cpu()[selected])
                value_targets.append(batch["values"][selected])
    max_candidates = max(tensor.shape[1] for tensor in logits)
    padded_logits = [nn.functional.pad(tensor, (0, max_candidates - tensor.shape[1]), value=-1e9) for tensor in logits]
    padded_masks = [nn.functional.pad(tensor, (0, max_candidates - tensor.shape[1]), value=False) for tensor in masks]
    result = policy_metrics(torch.cat(padded_logits), torch.cat(chosen), torch.cat(padded_masks))
    if values:
        predictions = torch.sigmoid(torch.cat(values))
        targets = torch.cat(value_targets)
        result["valueBrier"] = float(torch.mean((predictions - targets) ** 2))
        result["valueAccuracy"] = float(((predictions >= 0.5) == (targets >= 0.5)).float().mean())
    return result


def train_epoch(
    model: CandidateSetTransformer,
    loader: DataLoader[DecisionExample],
    optimizer: torch.optim.Optimizer,
    device: torch.device,
    value_weight: float,
    gradient_clip: float,
) -> dict[str, float]:
    model.train()
    totals = Counter()
    for batch in loader:
        features = batch["features"].to(device)
        mask = batch["mask"].to(device)
        chosen = batch["chosen"].to(device)
        policy_weights = batch["policyWeights"].to(device)
        logits, value_logits = model(features, mask)
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
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), gradient_clip)
        optimizer.step()
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
    set_determinism(args.seed)
    decisions, terminals = load_records(args.data)
    rollout_selection: dict[str, Any] | None = None
    if args.elite_rollouts:
        decisions, rollout_selection = select_elite_rollouts(decisions, terminals)
        selected_episodes = {decision["episodeId"] for decision in decisions}
        terminals = [terminal for terminal in terminals if terminal["episodeId"] in selected_episodes]
    examples = make_examples(decisions, terminals, args.loss_policy_weight)
    train_group_ids, validation_group_ids = split_groups(
        [example.split_group_id for example in examples],
        args.seed,
    )
    train_examples = [example for example in examples if example.split_group_id in train_group_ids]
    validation_examples = [example for example in examples if example.split_group_id in validation_group_ids]
    if not train_examples or not validation_examples:
        raise ValueError("both train and validation examples are required")
    feature_mean, feature_std = feature_normalization(train_examples)
    feature_count = train_examples[0].features.shape[1]
    config = CandidateTransformerConfig(
        feature_count=feature_count,
        d_model=args.d_model,
        layers=args.layers,
        heads=args.heads,
        feedforward=args.feedforward,
        dropout=args.dropout,
    )
    device = torch.device(args.device if args.device != "auto" else "cuda" if torch.cuda.is_available() else "cpu")
    model = CandidateSetTransformer(config, feature_mean, feature_std).to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=args.learning_rate,
        weight_decay=args.weight_decay,
    )
    generator = torch.Generator().manual_seed(args.seed)
    train_loader = DataLoader(
        DecisionDataset(train_examples),
        batch_size=args.batch_size,
        shuffle=True,
        collate_fn=collate,
        generator=generator,
        num_workers=0,
    )
    validation_loader = DataLoader(
        DecisionDataset(validation_examples),
        batch_size=args.batch_size,
        shuffle=False,
        collate_fn=collate,
        num_workers=0,
    )
    history: list[dict[str, Any]] = []
    best_state: dict[str, Tensor] | None = None
    best_nll = math.inf
    stale_epochs = 0
    started = time.perf_counter()
    for epoch in range(1, args.epochs + 1):
        train_metrics = train_epoch(
            model,
            train_loader,
            optimizer,
            device,
            args.value_weight,
            args.gradient_clip,
        )
        validation_metrics = evaluate(model, validation_loader, device)
        history.append({"epoch": epoch, "train": train_metrics, "validation": validation_metrics})
        print(
            f"epoch {epoch:03d}: loss={train_metrics['loss']:.4f} "
            f"val_nll={validation_metrics['candidateNll']:.4f} "
            f"top1={validation_metrics['top1']:.4f}",
            flush=True,
        )
        if validation_metrics["candidateNll"] < best_nll - args.min_delta:
            best_nll = validation_metrics["candidateNll"]
            best_state = copy.deepcopy({key: value.detach().cpu() for key, value in model.state_dict().items()})
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
            "model": "er-candidate-set-transformer-v1",
            "schemaVersion": "1",
            "featureSchemaVersion": str(FEATURE_SCHEMA_VERSION),
        },
    )
    identity = {
        key: sorted({record[key] for record in decisions})
        for key in ("buildSha", "dexHash", "dictionaryHash")
    }
    report = {
        "schemaVersion": 1,
        "model": "er-candidate-set-transformer-v1",
        "contractSchemaVersion": SCHEMA_VERSION,
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
        "architecture": asdict(config),
        "parameters": parameter_count(model),
        "seed": args.seed,
        "device": str(device),
        "trainSeconds": time.perf_counter() - started,
        "bestEpoch": min(history, key=lambda row: row["validation"]["candidateNll"])["epoch"],
        "objective": {
            "policy": "listwise candidate cross entropy",
            "lossEpisodePolicyWeight": args.loss_policy_weight,
            "value": "battle terminal binary cross entropy",
            "valueWeight": args.value_weight,
        },
        "data": {
            "decisions": len(examples),
            "trainDecisions": len(train_examples),
            "validationDecisions": len(validation_examples),
            "episodes": len({example.episode_id for example in examples}),
            "trainSplitGroups": len(train_group_ids),
            "validationSplitGroups": len(validation_group_ids),
            "sourcePolicies": dict(Counter(decision["sourcePolicy"] for decision in decisions)),
            "terminalOutcomes": dict(Counter(terminal["outcome"] for terminal in terminals)),
            "rolloutSelection": rollout_selection,
            "identity": identity,
            "jsonlSha256": dataset_hash(sorted(args.data.rglob("*.jsonl"))),
        },
        "validation": final_metrics,
        "history": history,
        "artifacts": {"weights": weights_path.name, "config": "config.json", "report": "report.json"},
    }
    config_payload = {
        "schemaVersion": 1,
        "model": report["model"],
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
        "architecture": asdict(config),
        "weights": weights_path.name,
    }
    (args.output_dir / "config.json").write_text(json.dumps(config_payload, indent=2) + "\n", encoding="utf-8")
    (args.output_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"validation": final_metrics, "parameters": report["parameters"], "device": str(device)}))
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
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
    parser.add_argument("--loss-policy-weight", type=float, default=0.25)
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
    return parser.parse_args()


if __name__ == "__main__":
    train(parse_args())
