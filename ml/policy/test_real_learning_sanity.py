import json
import tempfile
import unittest
from pathlib import Path

from run_real_learning_sanity import select_decisions, source_split


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


if __name__ == "__main__":
    unittest.main()
