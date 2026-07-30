import unittest

import numpy as np

from train_candidate_baselines import (
    artifact_scores,
    ordered_group_sizes,
    record_split_group,
    select_elite_rollouts,
    split_groups,
)


class CandidateBaselineContractTest(unittest.TestCase):
    def test_inverse_pilot_legs_share_a_legacy_split_group(self) -> None:
        self.assertEqual(record_split_group({"episodeId": "pilot-20"}), "pilot-pair-10")
        self.assertEqual(record_split_group({"episodeId": "pilot-21"}), "pilot-pair-10")
        self.assertEqual(
            record_split_group({"episodeId": "pilot-20", "splitGroupId": "explicit"}),
            "explicit",
        )

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
