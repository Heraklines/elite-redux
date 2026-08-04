import copy
import unittest

import numpy as np
import torch
from torch.utils.data import DataLoader

from candidate_transformer import CandidateSetTransformer, CandidateTransformerConfig
from train_candidate_transformer import (
    DecisionDataset,
    DecisionExample,
    capture_training_resume_state,
    collate,
    evaluate,
    restore_training_resume_state,
    set_determinism,
    train_epoch,
)


FEATURE_COUNT = 4
CANDIDATE_COUNT = 4
EXAMPLE_COUNT = 512


def examples_for_labels(labels: np.ndarray, *, remove_state: bool = False) -> list[DecisionExample]:
    examples = []
    for index, label in enumerate(labels.tolist()):
        features = np.zeros((CANDIDATE_COUNT, FEATURE_COUNT), dtype=np.float32)
        if not remove_state:
            features[label, 0] = 1.0
            features[:, 1] = np.arange(CANDIDATE_COUNT, dtype=np.float32) / CANDIDATE_COUNT
            features[:, 2] = (index % 17) / 17
            features[:, 3] = 1.0
        token_ids = [
            [np.asarray([1], dtype=np.int64) for _group in range(5)]
            for _candidate in range(CANDIDATE_COUNT)
        ]
        examples.append(
            DecisionExample(
                decision_id=f"decision-{index}",
                episode_id=f"episode-{index}",
                split_group_id=f"group-{index}",
                source_partition_id=f"source-{index}",
                features=features,
                feature_presence=None,
                feature_indices=None,
                full_feature_count=FEATURE_COUNT,
                token_ids=token_ids,
                chosen_index=label,
                domain_id=0,
                terminal_value=None,
                policy_weight=1.0,
                history=(),
            )
        )
    return examples


def model_and_optimizer(seed: int) -> tuple[CandidateSetTransformer, torch.optim.Optimizer]:
    set_determinism(seed)
    model = CandidateSetTransformer(
        CandidateTransformerConfig(
            feature_count=FEATURE_COUNT,
            token_vocabulary_size=2,
            d_model=16,
            layers=1,
            heads=2,
            feedforward=32,
            dropout=0.0,
            history_length=0,
            trajectory_layers=1,
        )
    )
    return model, torch.optim.AdamW(model.parameters(), lr=1e-2, weight_decay=0.0)


def loader(examples: list[DecisionExample], generator: torch.Generator, *, shuffle: bool) -> DataLoader:
    return DataLoader(
        DecisionDataset(examples),
        batch_size=64,
        shuffle=shuffle,
        collate_fn=collate,
        generator=generator,
        num_workers=0,
    )


def run_epochs(
    model: CandidateSetTransformer,
    optimizer: torch.optim.Optimizer,
    train_loader: DataLoader,
    scaler: torch.amp.GradScaler,
    count: int,
) -> list[dict[str, float]]:
    return [
        train_epoch(model, train_loader, optimizer, torch.device("cpu"), 0.0, 1.0, False, scaler)
        for _epoch in range(count)
    ]


class CandidateLearningSanityTest(unittest.TestCase):
    def test_overfits_512_clean_decisions_and_state_removal_collapses(self) -> None:
        labels = np.arange(EXAMPLE_COUNT, dtype=np.int64) % CANDIDATE_COUNT
        clean = examples_for_labels(labels)
        generator = torch.Generator().manual_seed(41)
        model, optimizer = model_and_optimizer(41)
        scaler = torch.amp.GradScaler("cpu", enabled=False)
        run_epochs(model, optimizer, loader(clean, generator, shuffle=True), scaler, 8)
        metrics = evaluate(model, loader(clean, torch.Generator().manual_seed(1), shuffle=False), torch.device("cpu"))
        self.assertGreaterEqual(metrics["top1"], 0.99)

        state_free = examples_for_labels(labels, remove_state=True)
        state_free_model, state_free_optimizer = model_and_optimizer(43)
        state_free_scaler = torch.amp.GradScaler("cpu", enabled=False)
        run_epochs(
            state_free_model,
            state_free_optimizer,
            loader(state_free, torch.Generator().manual_seed(43), shuffle=True),
            state_free_scaler,
            4,
        )
        state_free_metrics = evaluate(
            state_free_model,
            loader(state_free, torch.Generator().manual_seed(1), shuffle=False),
            torch.device("cpu"),
        )
        self.assertLessEqual(state_free_metrics["top1"], 0.26)

    def test_shuffled_labels_fall_to_candidate_chance(self) -> None:
        visible_labels = np.arange(EXAMPLE_COUNT, dtype=np.int64) % CANDIDATE_COUNT
        shuffled_labels = visible_labels.copy()
        np.random.default_rng(47).shuffle(shuffled_labels)
        train_examples = examples_for_labels(shuffled_labels)
        for index, example in enumerate(train_examples):
            example.features[:, :] = examples_for_labels(visible_labels[index : index + 1])[0].features

        model, optimizer = model_and_optimizer(47)
        scaler = torch.amp.GradScaler("cpu", enabled=False)
        run_epochs(model, optimizer, loader(train_examples, torch.Generator().manual_seed(47), shuffle=True), scaler, 8)

        validation_labels = visible_labels.copy()
        np.random.default_rng(53).shuffle(validation_labels)
        validation = examples_for_labels(validation_labels)
        for index, example in enumerate(validation):
            example.features[:, :] = examples_for_labels(visible_labels[index : index + 1])[0].features
        metrics = evaluate(model, loader(validation, torch.Generator().manual_seed(1), shuffle=False), torch.device("cpu"))
        self.assertLess(metrics["top1"], 0.4)

    def test_epoch_boundary_resume_is_exact(self) -> None:
        labels = np.arange(128, dtype=np.int64) % CANDIDATE_COUNT
        examples = examples_for_labels(labels)

        full_generator = torch.Generator().manual_seed(59)
        full_model, full_optimizer = model_and_optimizer(59)
        full_scaler = torch.amp.GradScaler("cpu", enabled=False)
        full_losses = run_epochs(
            full_model,
            full_optimizer,
            loader(examples, full_generator, shuffle=True),
            full_scaler,
            4,
        )

        split_generator = torch.Generator().manual_seed(59)
        split_model, split_optimizer = model_and_optimizer(59)
        split_scaler = torch.amp.GradScaler("cpu", enabled=False)
        split_loader = loader(examples, split_generator, shuffle=True)
        split_losses = run_epochs(split_model, split_optimizer, split_loader, split_scaler, 2)
        resume_state = capture_training_resume_state(
            split_model,
            split_optimizer,
            split_scaler,
            split_generator,
        )

        resumed_generator = torch.Generator().manual_seed(999)
        resumed_model, resumed_optimizer = model_and_optimizer(999)
        resumed_scaler = torch.amp.GradScaler("cpu", enabled=False)
        restore_training_resume_state(
            copy.deepcopy(resume_state),
            resumed_model,
            resumed_optimizer,
            resumed_scaler,
            resumed_generator,
        )
        split_losses.extend(
            run_epochs(
                resumed_model,
                resumed_optimizer,
                loader(examples, resumed_generator, shuffle=True),
                resumed_scaler,
                2,
            )
        )

        self.assertEqual(full_losses, split_losses)
        for name, expected in full_model.state_dict().items():
            torch.testing.assert_close(resumed_model.state_dict()[name], expected, rtol=0, atol=0)


if __name__ == "__main__":
    unittest.main()
