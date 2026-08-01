import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from train_candidate_transformer import (
    DecisionDataset,
    TOKEN_GROUP_NAMES,
    build_token_vocabulary,
    checkpoint_selection_metric,
    collate,
    evaluate,
    load_fixed_token_vocabulary,
    load_transfer_records,
    make_examples,
)


class CandidateTransformerTrainingPipelineTest(unittest.TestCase):
    def test_fixed_vocabulary_preserves_extra_transfer_tokens_and_validates_hash(self) -> None:
        required = ["<PAD>", "<UNK>", "action:move"]
        fixed = [*required, "domain:showdown", "showdown-move:thunderbolt"]
        payload = json.dumps({
            "tokenVocabulary": fixed,
            "tokenVocabularySha256": hashlib.sha256(
                json.dumps(fixed, ensure_ascii=True, separators=(",", ":")).encode()
            ).hexdigest(),
        })
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "vocabulary.json"
            path.write_text(payload, encoding="utf-8")
            self.assertEqual(load_fixed_token_vocabulary(path, required), fixed)

            path.write_text(json.dumps({"tokenVocabulary": fixed, "tokenVocabularySha256": "bad"}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "hash does not match"):
                load_fixed_token_vocabulary(path, required)

    def test_validation_excludes_non_policy_targets_from_imitation_metrics(self) -> None:
        candidates = [{"id": "move:a", "kind": "move"}, {"id": "move:b", "kind": "move"}]
        groups = {"actor": [], "targets": [], "destination": [], "field": [], "action": []}
        decisions = []
        for index, (source, target) in enumerate((("human-v1", True), ("engine-hardest-v1", False))):
            decisions.append({
                "decisionId": f"decision-{index}",
                "episodeId": f"episode-{index}",
                "policySource": source,
                "policyTarget": target,
                "candidates": candidates,
                "candidateFeatures": [
                    {"candidateId": "move:a", "values": [1.0]},
                    {"candidateId": "move:b", "values": [0.0]},
                ],
                "candidateTokenGroups": [
                    {"candidateId": candidate["id"], "groups": groups} for candidate in candidates
                ],
                "chosenCandidateId": "move:a",
            })
        _, token_to_id = build_token_vocabulary(decisions, {})
        examples = make_examples(
            decisions,
            [
                {"episodeId": "episode-0", "outcome": "victory"},
                {"episodeId": "episode-1", "outcome": "player-wiped"},
            ],
            loss_policy_weight=0.25,
            token_to_id=token_to_id,
        )

        class FixedModel(torch.nn.Module):
            def forward(self, *args):
                device = args[0].device
                return torch.tensor([[10.0, 0.0], [0.0, 10.0]], device=device), torch.zeros(2, device=device)

        metrics = evaluate(
            FixedModel(),
            DataLoader(DecisionDataset(examples), batch_size=2, collate_fn=collate),
            torch.device("cpu"),
        )
        self.assertEqual(metrics["decisions"], 1.0)
        self.assertEqual(metrics["top1"], 1.0)
        self.assertEqual(checkpoint_selection_metric(metrics)[0], "candidateNll")

    def test_value_metric_selects_checkpoint_when_policy_targets_are_absent(self) -> None:
        metric, value = checkpoint_selection_metric({"decisions": 0.0, "candidateNll": None, "valueBrier": 0.2})
        self.assertEqual(metric, "valueBrier")
        self.assertEqual(value, 0.2)

    def test_engine_baseline_keeps_value_target_but_has_zero_policy_weight(self) -> None:
        candidate = {"id": "move:a", "kind": "move"}
        decision = {
            "decisionId": "engine-decision",
            "episodeId": "engine-episode",
            "policySource": "engine-hardest-v1",
            "policyTarget": False,
            "candidates": [candidate],
            "candidateFeatures": [{"candidateId": "move:a", "values": [1.0]}],
            "candidateTokenGroups": [{
                "candidateId": "move:a",
                "groups": {
                    "actor": [], "targets": [], "destination": [], "field": [], "action": ["action:move"]
                },
            }],
            "chosenCandidateId": "move:a",
        }
        _, token_to_id = build_token_vocabulary([decision], {})
        examples = make_examples(
            [decision],
            [{"episodeId": "engine-episode", "outcome": "victory"}],
            loss_policy_weight=0.25,
            token_to_id=token_to_id,
        )
        self.assertEqual(examples[0].policy_weight, 0.0)
        batch = collate(examples)
        self.assertEqual(batch["policyWeights"].tolist(), [0.0])
        self.assertEqual(batch["valueMask"].tolist(), [True])
        self.assertEqual(batch["values"].tolist(), [1.0])

    def test_human_loss_retains_configured_policy_weight(self) -> None:
        decision = {
            "decisionId": "human-decision",
            "episodeId": "human-episode",
            "policySource": "human-v1",
            "policyTarget": True,
            "candidates": [{"id": "move:a", "kind": "move"}],
            "candidateFeatures": [{"candidateId": "move:a", "values": [1.0]}],
            "candidateTokenGroups": [{
                "candidateId": "move:a",
                "groups": {
                    "actor": [], "targets": [], "destination": [], "field": [], "action": ["action:move"]
                },
            }],
            "chosenCandidateId": "move:a",
        }
        _, token_to_id = build_token_vocabulary([decision], {})
        example = make_examples(
            [decision],
            [{"episodeId": "human-episode", "outcome": "player-wiped"}],
            loss_policy_weight=0.25,
            token_to_id=token_to_id,
        )[0]
        self.assertEqual(example.policy_weight, 0.25)

    def test_v3_role_tokens_survive_vocabulary_example_and_collation(self) -> None:
        candidates = [
            {"id": "move:a", "kind": "move"},
            {"id": "switch:b", "kind": "switch"},
        ]
        token_rows = [
            {
                "candidateId": "move:a",
                "groups": {
                    "actor": [
                        "species:6:0",
                        "effect:mechanic:ability-state:foul-harvest",
                        "effect:mechanic:ability-state:foul-harvest:state:charges:2",
                    ],
                    "targets": ["species:479:0", "ability:26"],
                    "destination": [],
                    "field": ["weather:12", "modifier:ER_RELIC_TEST"],
                    "action": ["action:move", "move:89", "move-immunity:engine-preview-zero"],
                },
            },
            {
                "candidateId": "switch:b",
                "groups": {
                    "actor": ["species:6:0"],
                    "targets": [],
                    "destination": ["species:143:0", "item:LEFTOVERS"],
                    "field": ["weather:12"],
                    "action": ["action:switch", "switch-transfer:normal"],
                },
            },
        ]
        decision = {
            "decisionId": "decision-1",
            "episodeId": "episode-1",
            "splitGroupId": "pair-1",
            "sourcePartitionId": "roster-1",
            "candidates": candidates,
            "candidateFeatures": [
                {"candidateId": "move:a", "values": [0.1, 0.2, 0.3]},
                {"candidateId": "switch:b", "values": [0.4, 0.5, 0.6]},
            ],
            "candidateTokenGroups": token_rows,
            "chosenCandidateId": "move:a",
        }
        dictionary = {
            "speciesForms": {"6:0": {}, "479:0": {}, "143:0": {}},
            "abilities": {"26": {"attributes": ["TypeImmunityAbAttr"]}},
            "moves": {"89": {"attributes": []}},
            "items": {"LEFTOVERS": {"className": "LeftoversModifier"}},
            "modifiers": {"ER_RELIC_TEST": {"className": "ErRelicModifier"}},
        }
        vocabulary, token_to_id = build_token_vocabulary([decision], dictionary)
        self.assertIn("effect:mechanic:ability-state:foul-harvest:state:charges:2", vocabulary)
        examples = make_examples(
            [decision],
            [{"episodeId": "episode-1", "outcome": "victory"}],
            loss_policy_weight=0.0,
            token_to_id=token_to_id,
        )
        batch = collate(examples)
        self.assertEqual(tuple(batch["tokenIds"].shape[:3]), (1, 2, len(TOKEN_GROUP_NAMES)))
        self.assertGreater(int(batch["tokenMask"].sum()), 0)
        self.assertEqual(int(batch["chosen"][0]), 0)
        self.assertEqual(float(batch["policyWeights"][0]), 1.0)
        self.assertEqual(tuple(batch["historyFeatures"].shape[:2]), (1, 0))
        self.assertTrue(bool(batch["featurePresence"].all()))
        self.assertEqual(batch["domainIds"].tolist(), [0])

    def test_episode_order_becomes_bounded_history(self) -> None:
        candidates = [{"id": "move:a", "kind": "move"}, {"id": "move:b", "kind": "move"}]
        token_rows = [
            {
                "candidateId": candidate["id"],
                "groups": {"actor": [], "targets": [], "destination": [], "field": [], "action": [candidate["id"]]},
            }
            for candidate in candidates
        ]
        decisions = [
            {
                "decisionId": f"decision-{index}",
                "episodeId": "episode-1",
                "splitGroupId": "pair-1",
                "sourcePartitionId": "roster-1",
                "candidates": candidates,
                "candidateFeatures": [
                    {"candidateId": "move:a", "values": [float(index), 0.0]},
                    {"candidateId": "move:b", "values": [0.0, float(index)]},
                ],
                "candidateTokenGroups": token_rows,
                "chosenCandidateId": "move:b" if index % 2 else "move:a",
            }
            for index in range(3)
        ]
        dictionary = {"speciesForms": {}, "abilities": {}, "moves": {}, "items": {}, "modifiers": {}}
        _, token_to_id = build_token_vocabulary(decisions, dictionary)
        examples = make_examples(
            decisions,
            [{"episodeId": "episode-1", "outcome": "victory"}],
            loss_policy_weight=0.0,
            token_to_id=token_to_id,
            history_length=2,
        )
        self.assertEqual([len(example.history) for example in examples], [0, 1, 2])
        batch = collate(examples, history_length=2)
        self.assertEqual(tuple(batch["historyFeatures"].shape), (3, 2, 2, 2))
        self.assertEqual(batch["historyStepMask"].tolist(), [[False, False], [False, True], [True, True]])
        self.assertEqual(batch["historyChosen"].tolist(), [[0, 0], [0, 0], [0, 1]])

    def test_transfer_loader_preserves_domain_and_feature_presence(self) -> None:
        groups = {"actor": ["domain:showdown"], "targets": [], "destination": [], "field": [], "action": ["action:move"]}
        record = {
            "schemaVersion": 1,
            "kind": "candidate_transfer_decision",
            "domain": "showdown",
            "episodeId": "showdown:one",
            "decisionId": "showdown:one:0",
            "splitGroupId": "showdown:one",
            "sourcePartitionId": "showdown-player:one",
            "featureNames": ["feature-a", "feature-c"],
            "candidates": [{"id": "showdown:move:0", "kind": "move"}],
            "candidateFeatures": [{"candidateId": "showdown:move:0", "values": [0.5, 0.25], "presence": [True, True]}],
            "candidateTokenGroups": [{"candidateId": "showdown:move:0", "groups": groups}],
            "chosenCandidateId": "showdown:move:0",
            "terminalValue": 1.0,
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "transfer.jsonl.gz"
            with gzip.open(path, "wt", encoding="utf-8") as handle:
                handle.write(json.dumps(record) + "\n")
            decisions, terminals = load_transfer_records(path, ["feature-a", "feature-b", "feature-c"])
        _, token_to_id = build_token_vocabulary(decisions, {"speciesForms": {}, "abilities": {}, "moves": {}, "items": {}, "modifiers": {}})
        examples = make_examples(decisions, terminals, 0.0, token_to_id, full_feature_count=3)
        batch = collate(examples)
        self.assertEqual(batch["domainIds"].tolist(), [1])
        self.assertEqual(batch["featurePresence"].tolist(), [[[True, False, True]]])
        self.assertEqual(batch["features"].tolist(), [[[0.5, 0.0, 0.25]]])


if __name__ == "__main__":
    unittest.main()
