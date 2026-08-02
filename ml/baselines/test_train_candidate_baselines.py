import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier

from train_candidate_baselines import (
    artifact_scores,
    fit_stacked_tree_ensemble,
    is_policy_target,
    load_winner_policy_records,
    ordered_group_sizes,
    record_split_group,
    record_source_partition,
    select_training_decisions,
    select_elite_rollouts,
    split_groups,
    validate_data_dictionary,
)


class CandidateBaselineContractTest(unittest.TestCase):
    def test_engine_and_heuristic_rows_are_not_policy_targets(self) -> None:
        self.assertFalse(is_policy_target({"policySource": "engine-hardest-v1", "policyTarget": False}))
        self.assertFalse(is_policy_target({"policySource": "smart-default-v1", "policyTarget": True}))
        self.assertTrue(is_policy_target({"policySource": "human-v1", "policyTarget": True}))
        self.assertTrue(is_policy_target({"policySource": "search-relabel-v1", "policyTarget": True}))

    def test_diagnostic_imitation_is_explicit_and_never_creates_policy_targets(self) -> None:
        excluded = [
            {"policySource": "smart-default-v1", "policyTarget": False},
            {"policySource": "engine-hardest-v1", "policyTarget": False},
        ]
        with self.assertRaisesRegex(ValueError, "no policy-target decisions"):
            select_training_decisions(excluded, False)
        decisions, policy_decisions, diagnostic_only = select_training_decisions(excluded, True)
        self.assertEqual(decisions, excluded)
        self.assertEqual(policy_decisions, [])
        self.assertTrue(diagnostic_only)

        human = {"policySource": "human-v1", "policyTarget": True}
        decisions, policy_decisions, diagnostic_only = select_training_decisions([*excluded, human], True)
        self.assertEqual(decisions, [human])
        self.assertEqual(policy_decisions, [human])
        self.assertFalse(diagnostic_only)

    def test_winner_only_loader_streams_only_victorious_policy_targets(self) -> None:
        def decision(episode: str, source: str, target: bool) -> dict:
            candidate_id = f"move:{episode}"
            return {
                "schemaVersion": 3,
                "featureSchemaVersion": 2,
                "kind": "combat_decision",
                "candidateScope": "combat-command",
                "episodeId": episode,
                "decisionId": f"decision:{episode}",
                "buildSha": "build",
                "dexHash": "dex",
                "dictionaryHash": "dictionary",
                "policySource": source,
                "policyTarget": target,
                "candidates": [{"id": candidate_id}],
                "chosenCandidateId": candidate_id,
                "candidateFeatures": [{"candidateId": candidate_id, "values": [0.0]}],
                "candidateTokenGroups": [{
                    "candidateId": candidate_id,
                    "groups": {
                        "actor": [],
                        "targets": [],
                        "destination": [],
                        "field": [],
                        "action": [candidate_id],
                    },
                }],
                "observation": {"opponentActive": [], "opponentKnownParty": [], "modifiers": []},
            }

        rows = [
            decision("winner", "checkpoint-neural-v4", True),
            decision("loser", "checkpoint-neural-v4", True),
            decision("engine", "engine-hardest-v1", False),
            decision("heuristic", "smart-default-v1", True),
        ]
        outcomes = {
            "winner": "victory",
            "loser": "player-wiped",
            "engine": "victory",
            "heuristic": "victory",
        }
        rows.extend({
            "schemaVersion": 3,
            "kind": "episode_terminal",
            "episodeId": episode,
            "outcome": outcome,
            "buildSha": "build",
            "dexHash": "dex",
            "dictionaryHash": "dictionary",
        } for episode, outcome in outcomes.items())

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "decisions.jsonl"
            path.write_text("".join(f"{json.dumps(row)}\n" for row in rows), encoding="utf-8")
            selected, terminals, report = load_winner_policy_records(path)

        self.assertEqual([row["episodeId"] for row in selected], ["winner"])
        self.assertEqual([row["episodeId"] for row in terminals], ["winner"])
        self.assertEqual(report["inputDecisions"], 4)
        self.assertEqual(report["policyTargetDecisions"], 2)
        self.assertEqual(report["retainedDecisions"], 1)

    def test_runtime_dictionary_must_cover_recorded_ids_and_match_hash(self) -> None:
        payload = {
            "schemaVersion": 3,
            "features": {"schemaVersion": 2, "names": ["f0"]},
            "moves": {"1": {}},
            "abilities": {"2": {}, "3": {}},
            "items": {"LEFTOVERS": {}},
            "modifiers": {"LEFTOVERS": {}},
            "speciesForms": {"6:0": {}},
            "relics": {},
            "battlerTags": [],
            "arenaTags": [],
            "positionalTags": [],
            "mechanicNamespaces": ["ability-state"],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "dictionary.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            decision = {
                "dictionaryHash": digest,
                "observation": {
                    "selfParty": [{
                        "species": 6,
                        "form": 0,
                        "abilities": [{"abilityId": 2}, {"abilityId": 3}],
                        "moves": [{"moveId": 1}],
                        "heldItems": [{"itemId": "LEFTOVERS"}],
                        "tags": [],
                        "mechanics": [{"effectId": "ability-state:foul-harvest"}],
                    }],
                    "opponentActive": [],
                    "fieldEffects": [],
                    "positionalEffects": [],
                    "modifiers": [],
                },
                "candidates": [{"kind": "move", "moveId": 1}],
                "candidateFeatures": [{"values": [0.0]}],
            }
            coverage = validate_data_dictionary(path, [decision])
            self.assertEqual(coverage["referencedMoves"], 1)
            self.assertEqual(coverage["referencedMechanicNamespaces"], 1)
            decision["observation"]["selfParty"][0]["mechanics"][0]["effectId"] = "unknown-state:test"
            with self.assertRaisesRegex(ValueError, "misses recorded runtime ids"):
                validate_data_dictionary(path, [decision])
            decision["observation"]["selfParty"][0]["mechanics"][0]["effectId"] = "ability-state:foul-harvest"
            decision["observation"]["selfParty"][0]["abilities"][0]["abilityId"] = 4
            with self.assertRaisesRegex(ValueError, "misses recorded runtime ids"):
                validate_data_dictionary(path, [decision])

    def test_inverse_pilot_legs_share_a_legacy_split_group(self) -> None:
        self.assertEqual(record_split_group({"episodeId": "pilot-20"}), "pilot-pair-10")
        self.assertEqual(record_split_group({"episodeId": "pilot-21"}), "pilot-pair-10")
        self.assertEqual(
            record_split_group({"episodeId": "pilot-20", "splitGroupId": "explicit"}),
            "explicit",
        )
        self.assertEqual(
            record_source_partition(
                {"episodeId": "pilot-20", "splitGroupId": "pair", "sourcePartitionId": "roster-fold"}
            ),
            "roster-fold",
        )
        self.assertEqual(record_source_partition({"episodeId": "pilot-20", "splitGroupId": "pair"}), "pair")

    def test_group_split_has_no_matchup_overlap(self) -> None:
        train, test = split_groups(["a", "a", "b", "b", "c", "c"], 7)
        self.assertFalse(train & test)
        self.assertEqual(train | test, {"a", "b", "c"})

    def test_ranker_group_rows_must_be_contiguous(self) -> None:
        self.assertEqual(ordered_group_sizes(["a", "a", "b", "b", "b"]), [2, 3])
        with self.assertRaisesRegex(ValueError, "not contiguous"):
            ordered_group_sizes(["a", "b", "a"])

    def test_raw_tree_artifact_preserves_ranker_scores(self) -> None:
        artifact = {
            "aggregation": "sum_raw",
            "baseScore": 0.25,
            "trees": [[
                {"feature": 0, "threshold": 0.5, "left": 1, "right": 2},
                {"value": -0.5},
                {"value": 1.0},
            ]],
        }
        scores = artifact_scores(artifact, np.asarray([[0.0], [1.0]], dtype=np.float32))
        np.testing.assert_allclose(scores, [-0.25, 1.25])

    def test_stacked_tree_artifact_combines_standardized_member_scores(self) -> None:
        first = {
            "schemaVersion": 1,
            "aggregation": "sum_raw",
            "baseScore": 0.0,
            "trees": [[{"value": 1.0}]],
        }
        second = {
            "schemaVersion": 1,
            "aggregation": "sum_raw",
            "baseScore": 0.0,
            "trees": [[
                {"feature": 0, "threshold": 0.5, "left": 1, "right": 2},
                {"value": 0.0},
                {"value": 4.0},
            ]],
        }
        stack = {
            "schemaVersion": 2,
            "members": [first, second],
            "memberMeans": [0.5, 2.0],
            "memberScales": [0.5, 1.0],
            "weights": [2.0, -0.5],
            "intercept": 0.25,
        }
        scores = artifact_scores(stack, np.asarray([[0.0], [1.0]], dtype=np.float32))
        np.testing.assert_allclose(scores, [3.25, 1.25])

    def test_stacked_tree_training_uses_group_fold_predictions(self) -> None:
        x = np.asarray([[candidate, group] for group in range(8) for candidate in (0.0, 1.0)], dtype=np.float32)
        y = np.asarray([0, 1] * 8)
        decision_ids = [f"decision-{group}" for group in range(8) for _ in range(2)]
        split_groups = [f"pair-{group}" for group in range(8) for _ in range(2)]
        train_mask = np.asarray([group < 6 for group in range(8) for _ in range(2)])
        test_mask = ~train_mask
        weights = np.full(len(y), 0.5)
        templates = {
            "first": (HistGradientBoostingClassifier(max_iter=3, max_leaf_nodes=2, min_samples_leaf=1), False),
            "second": (HistGradientBoostingClassifier(max_iter=4, max_leaf_nodes=3, min_samples_leaf=1), False),
        }
        member = {
            "schemaVersion": 1,
            "featureSchemaVersion": 1,
            "featureCount": 2,
            "modelName": "member",
            "modelType": "sklearn_hist_gradient_boosting",
            "aggregation": "sum_raw",
            "baseScore": 0.0,
            "trees": [[
                {"feature": 0, "threshold": 0.5, "left": 1, "right": 2},
                {"value": -1.0},
                {"value": 1.0},
            ]],
        }
        result = fit_stacked_tree_ensemble(
            templates,
            {"first": member, "second": {**member, "modelName": "member-2"}},
            x,
            y,
            decision_ids,
            split_groups,
            train_mask,
            test_mask,
            weights,
        )
        self.assertIsNotNone(result)
        artifact, scores, _seconds, names = result
        self.assertEqual(names, ["first", "second"])
        self.assertEqual(artifact["schemaVersion"], 2)
        self.assertEqual(scores.shape, (4,))
        self.assertTrue(np.isfinite(scores).all())

    def test_stacked_tree_training_excludes_zero_weight_loss_rows(self) -> None:
        x = np.asarray([[candidate, group] for group in range(8) for candidate in (0.0, 1.0)], dtype=np.float32)
        y = np.asarray([0, 1] * 8)
        decision_ids = [f"decision-{group}" for group in range(8) for _ in range(2)]
        source_partitions = [f"partition-{group}" for group in range(8) for _ in range(2)]
        train_mask = np.asarray([group < 6 for group in range(8) for _ in range(2)])
        test_mask = ~train_mask
        weights = np.asarray([
            0.5 if group in (0, 1, 2) else 0.0
            for group in range(8)
            for _ in range(2)
        ])
        templates = {
            "first": (HistGradientBoostingClassifier(max_iter=3, max_leaf_nodes=2, min_samples_leaf=1), False),
            "second": (HistGradientBoostingClassifier(max_iter=4, max_leaf_nodes=3, min_samples_leaf=1), False),
        }
        member = {
            "schemaVersion": 1,
            "featureSchemaVersion": 1,
            "featureCount": 2,
            "modelName": "member",
            "modelType": "sklearn_hist_gradient_boosting",
            "aggregation": "sum_raw",
            "baseScore": 0.0,
            "trees": [[{"value": 1.0}]],
        }
        result = fit_stacked_tree_ensemble(
            templates,
            {"first": member, "second": {**member, "modelName": "member-2"}},
            x,
            y,
            decision_ids,
            source_partitions,
            train_mask,
            test_mask,
            weights,
            "winner-only-test",
        )
        self.assertIsNotNone(result)
        artifact, scores, _seconds, _names = result
        self.assertEqual(artifact["modelName"], "winner-only-test")
        self.assertTrue(np.isfinite(scores).all())

    def test_stacked_tree_training_reports_insufficient_positive_weight_data(self) -> None:
        x = np.asarray([[0.0], [1.0], [0.0], [1.0]], dtype=np.float32)
        y = np.asarray([0, 1, 0, 1])
        result = fit_stacked_tree_ensemble(
            {
                "first": (HistGradientBoostingClassifier(max_iter=2, min_samples_leaf=1), False),
                "second": (HistGradientBoostingClassifier(max_iter=3, min_samples_leaf=1), False),
            },
            {
                "first": {"aggregation": "sum_raw", "baseScore": 0.0, "trees": [[{"value": 0.0}]]},
                "second": {"aggregation": "sum_raw", "baseScore": 0.0, "trees": [[{"value": 0.0}]]},
            },
            x,
            y,
            ["a", "a", "b", "b"],
            ["a", "a", "b", "b"],
            np.asarray([True, True, False, False]),
            np.asarray([False, False, True, True]),
            np.zeros(4),
        )
        self.assertIsNone(result)

    def test_elite_rollouts_retain_only_successful_exploration(self) -> None:
        decisions = [
            {"episodeId": "won", "sourcePolicy": "epsilon-tree-v1"},
            {"episodeId": "lost", "sourcePolicy": "epsilon-tree-v1"},
            {"episodeId": "expert", "sourcePolicy": "smart-default-v1"},
        ]
        terminals = [
            {"episodeId": "won", "outcome": "victory"},
            {"episodeId": "lost", "outcome": "player-wiped"},
            {"episodeId": "expert", "outcome": "player-wiped"},
        ]
        selected, report = select_elite_rollouts(decisions, terminals)
        self.assertEqual([row["episodeId"] for row in selected], ["won", "expert"])
        self.assertEqual(report["successfulEpisodes"], 1)


if __name__ == "__main__":
    unittest.main()
