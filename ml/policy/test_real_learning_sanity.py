import copy
import json
import tempfile
import unittest
from pathlib import Path

from candidate_transformer import CandidateSetTransformer, CandidateTransformerConfig
from run_real_learning_sanity import (
    action_only_decisions,
    build_examples,
    deterministic_resume_check,
    inference_contract_checks,
    select_decisions,
    shuffled_labels,
    source_split,
)


def train_sources(count: int) -> list[str]:
    sources = []
    index = 0
    while len(sources) < count:
        source = f"source-{index}"
        if source_split(source) == "train":
            sources.append(source)
        index += 1
    return sources


def decision(index: int, source: str, build: str = "build-a") -> dict:
    candidate_ids = [f"move:{index}:0", f"move:{index}:1"]
    return {
        "kind": "combat_decision",
        "schemaVersion": 4,
        "featureSchemaVersion": 4,
        "candidateScope": "combat-command",
        "episodeId": f"episode-{source}",
        "decisionId": f"decision-{index}",
        "sourcePartitionId": source,
        "policySource": "human-v1",
        "policyTarget": True,
        "buildSha": build,
        "dexHash": "dex-a",
        "dictionaryHash": "dictionary-a",
        "chosenCandidateId": candidate_ids[index % 2],
        "candidates": [{"id": candidate_id} for candidate_id in candidate_ids],
        "candidateFeatures": [
            {"candidateId": candidate_id, "values": [float(candidate_index), float(index)]}
            for candidate_index, candidate_id in enumerate(candidate_ids)
        ],
        "candidateTokenGroups": [
            {
                "candidateId": candidate_id,
                "groups": {
                    "actor": [f"actor:{source}"],
                    "targets": [],
                    "destination": [],
                    "field": [],
                    "action": [candidate_id],
                },
            }
            for candidate_id in candidate_ids
        ],
        "observation": {},
    }


class RealLearningSanitySelectionTest(unittest.TestCase):
    def test_source_split_matches_contract_auditor_vectors(self) -> None:
        self.assertEqual(source_split("source-0"), "train")
        self.assertEqual(source_split("source-7"), "validation")
        self.assertEqual(source_split("source-16"), "test")

    def test_selection_is_order_independent_and_source_bounded(self) -> None:
        sources = train_sources(5)
        records = [
            decision(index * 10 + offset, source)
            for index, source in enumerate(sources)
            for offset in range(3)
        ]
        records.extend(decision(100 + index, sources[index], build="build-b") for index in range(2))

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            forward = root / "forward.jsonl"
            reverse = root / "reverse.jsonl"
            forward.write_text("".join(f"{json.dumps(record)}\n" for record in records), encoding="utf-8")
            reverse.write_text("".join(f"{json.dumps(record)}\n" for record in reversed(records)), encoding="utf-8")

            selected, report = select_decisions(forward, count=5, max_per_source=1)
            reversed_selected, reversed_report = select_decisions(reverse, count=5, max_per_source=1)

        self.assertEqual([row["decisionId"] for row in selected], [row["decisionId"] for row in reversed_selected])
        self.assertEqual(report, reversed_report)
        self.assertEqual(report["buildSha"], "build-a")
        self.assertEqual(report["sourcePartitions"], 5)
        self.assertEqual(len({row["sourcePartitionId"] for row in selected}), 5)
        self.assertEqual(report["excluded"]["per_source_cap"], 10)

    def test_validation_selection_is_source_disjoint_and_identity_bound(self) -> None:
        validation_sources = []
        index = 0
        while len(validation_sources) < 3:
            source = f"validation-source-{index}"
            if source_split(source) == "validation":
                validation_sources.append(source)
            index += 1
        records = [decision(index, source) for index, source in enumerate(validation_sources)]
        records.append(decision(99, validation_sources[0], build="build-b"))
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "records.jsonl"
            path.write_text("".join(f"{json.dumps(record)}\n" for record in records), encoding="utf-8")
            selected, report = select_decisions(
                path,
                count=3,
                max_per_source=1,
                split="validation",
                selected_identity=("build-a", "dex-a", "dictionary-a"),
            )
        self.assertEqual(report["sourceSplit"], "validation")
        self.assertEqual(report["buildSha"], "build-a")
        self.assertTrue(all(source_split(row["sourcePartitionId"]) == "validation" for row in selected))

    def test_label_shuffle_is_deterministic_and_state_ablation_retains_only_action_inputs(self) -> None:
        records = [decision(index, f"source-{index}") for index in range(4)]
        first = shuffled_labels(records, seed=7)
        second = shuffled_labels(records, seed=7)
        self.assertEqual(
            [row["chosenCandidateId"] for row in first],
            [row["chosenCandidateId"] for row in second],
        )
        stripped, retained = action_only_decisions(records, ["actor_hp_ratio", "action_move"])
        self.assertEqual(retained, [1])
        for row in stripped:
            for feature_row in row["candidateFeatures"]:
                self.assertEqual(feature_row["values"][0], 0.0)
                self.assertEqual(feature_row["presence"], [False, True])
            for token_row in row["candidateTokenGroups"]:
                self.assertEqual(token_row["groups"]["actor"], [])
                self.assertNotEqual(token_row["groups"]["action"], [])

    def test_selection_removes_duplicate_and_conflicting_model_inputs(self) -> None:
        sources = train_sources(6)
        records = [decision(index, source) for index, source in enumerate(sources)]
        duplicate = copy.deepcopy(records[0])
        duplicate["decisionId"] = "duplicate-decision"
        duplicate["sourcePartitionId"] = sources[4]
        duplicate["episodeId"] = f"episode-{sources[4]}"
        conflict = copy.deepcopy(records[1])
        conflict["decisionId"] = "conflicting-decision"
        conflict["sourcePartitionId"] = sources[5]
        conflict["episodeId"] = f"episode-{sources[5]}"
        conflict["chosenCandidateId"] = conflict["candidates"][0]["id"]
        records.extend((duplicate, conflict))
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "records.jsonl"
            path.write_text("".join(f"{json.dumps(record)}\n" for record in records), encoding="utf-8")
            selected, report = select_decisions(path, count=4, max_per_source=1)
        self.assertEqual(len(selected), 4)
        self.assertEqual(report["excluded"]["duplicate_model_input"], 2)
        self.assertEqual(report["excluded"]["conflicting_model_input"], 2)
        self.assertEqual(report["uniqueModelInputs"], 4)

    def test_resume_gate_reproduces_the_next_epoch_exactly(self) -> None:
        records = [decision(index, f"source-{index}") for index in range(8)]
        dictionary = {
            "features": {"schemaVersion": 4, "names": ["actor_hp_ratio", "action_move"]},
            "speciesForms": {},
            "abilities": {},
            "moves": {},
            "items": {},
            "modifiers": {},
        }
        result = deterministic_resume_check(records, dictionary, seed=17, batch_size=4)
        self.assertTrue(result["passed"], result)
        self.assertEqual(result["maximumLossDifference"], 0.0)
        self.assertEqual(result["maximumPredictionDifference"], 0.0)

    def test_real_batch_inference_contract_is_order_and_padding_invariant(self) -> None:
        records = [decision(index, f"source-{index}") for index in range(4)]
        dictionary = {
            "speciesForms": {},
            "abilities": {},
            "moves": {},
            "items": {},
            "modifiers": {},
        }
        examples, _, vocabulary = build_examples(records, records, dictionary)
        model = CandidateSetTransformer(CandidateTransformerConfig(
            feature_count=2,
            token_vocabulary_size=len(vocabulary),
            d_model=8,
            layers=1,
            heads=2,
            feedforward=16,
            history_length=0,
            trajectory_layers=1,
        ))
        result = inference_contract_checks(model, examples)
        self.assertTrue(result["passed"], result)
        self.assertEqual(result["illegalCandidateMaximumProbability"], 0.0)


if __name__ == "__main__":
    unittest.main()
