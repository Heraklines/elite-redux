import gzip
import json
import tempfile
import unittest
from collections import Counter
from pathlib import Path

from curate_contract_v4 import (
    CurationConfig,
    DeterministicGzipWriter,
    analyze_episode,
    curate,
    select_policy,
    source_split,
)


def source_for(split: str, offset: int = 0) -> str:
    found = 0
    index = 0
    while True:
        source = f"source-{split}-{index}"
        if source_split(source) == split:
            if found == offset:
                return source
            found += 1
        index += 1


def mon(species: int) -> dict:
    return {
        "species": species,
        "form": 0,
        "originalSpecies": species,
        "originalForm": 0,
        "moves": [{"moveId": species + 10}],
        "abilities": [{"abilityId": species + 20, "source": "active", "slot": None}],
        "heldItems": [],
        "nativeTypes": [1],
        "boss": {"segments": 0},
        "transformation": {"formChanged": False, "terastallized": False},
    }


def decision(
    episode_id: str,
    index: int,
    source: str,
    species: int,
    *,
    chosen: int | None = None,
    candidate_count: int = 2,
    policy_source: str = "human-v1",
    action_kind: str = "move",
) -> dict:
    candidates = []
    features = []
    tokens = []
    for candidate_index in range(candidate_count):
        candidate_id = f"candidate-{episode_id}-{index}-{candidate_index}"
        candidate = {"id": candidate_id, "kind": action_kind, "actorSlot": 0}
        if action_kind == "move":
            candidate.update({"moveId": candidate_index + 1, "tera": False})
        else:
            candidate.update({"partyIndex": candidate_index + 1, "transfer": "normal"})
        candidates.append(candidate)
        features.append(
            {
                "candidateId": candidate_id,
                "values": [float(candidate_index), float(index), float(species)],
            }
        )
        tokens.append(
            {
                "candidateId": candidate_id,
                "groups": {
                    "actor": [f"species:{species}"],
                    "targets": [],
                    "destination": [],
                    "field": [],
                    "action": [f"action:{candidate_index}"],
                },
            }
        )
    selected = index % max(1, candidate_count) if chosen is None else chosen
    return {
        "kind": "combat_decision",
        "schemaVersion": 4,
        "featureSchemaVersion": 4,
        "buildSha": "build-a",
        "dexHash": "dex-a",
        "dictionaryHash": "dictionary-a",
        "episodeId": episode_id,
        "sourcePartitionId": source,
        "jointActionId": f"{episode_id}:1:battle~0:{index + 1}",
        "decisionId": f"decision-{episode_id}-{index}",
        "policySource": policy_source,
        "policyTarget": policy_source == "human-v1",
        "observation": {
            "wave": 1,
            "turn": index + 1,
            "battleType": 1,
            "format": 1,
            "selfParty": [mon(species)],
            "opponentActive": [],
            "mechanics": [],
            "fieldEffects": [],
            "positionalEffects": [],
        },
        "candidates": candidates,
        "candidateFeatures": features,
        "candidateTokenGroups": tokens,
        "chosenCandidateId": candidates[selected]["id"],
    }


def episode(
    episode_id: str,
    source: str,
    seed: str,
    species: int,
    *,
    decisions: list[dict] | None = None,
    run_outcome: str = "player-wiped",
    completed: bool = True,
) -> dict:
    rows = decisions or [decision(episode_id, 0, source, species)]
    transitions = [
        {
            "kind": "combat_transition",
            "schemaVersion": 4,
            "buildSha": "build-a",
            "dexHash": "dex-a",
            "dictionaryHash": "dictionary-a",
            "episodeId": episode_id,
            "transitionId": f"transition-{row['decisionId']}",
            "decisionIds": [row["decisionId"]],
            "battleTerminal": "victory",
        }
        for row in rows
    ]
    battle_id = rows[0]["jointActionId"].rsplit(":", 1)[0]
    return {
        "episodeId": episode_id,
        "sourcePartitionId": source,
        "split": source_split(source),
        "envelope": {"seed": seed, "difficulty": "hell", "gameModeId": 0},
        "decisions": rows,
        "auxiliaryDecisions": [],
        "transitions": transitions,
        "battleTerminals": [{"battleId": battle_id, "outcome": "victory"}],
        "runTerminals": [{"outcome": run_outcome}] if completed else [],
        "result": {"hardQuarantined": False, "completedOutcomeEligible": completed},
    }


class ContractV4CurationTest(unittest.TestCase):
    def test_curated_writer_rotates_on_record_boundaries(self) -> None:
        records = [{"episodeId": f"episode-{index}", "payload": "x" * 80} for index in range(5)]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            writer = DeterministicGzipWriter(root / "policy-all-train.jsonl.gz", max_uncompressed_bytes=180)
            for record in records:
                writer.write(record)
            descriptors = writer.close()

            restored = []
            for descriptor in descriptors:
                self.assertLess(descriptor["bytes"], 300 * 1024 * 1024)
                with gzip.open(root / descriptor["name"], "rt", encoding="utf-8") as handle:
                    restored.extend(json.loads(line) for line in handle)
            self.assertEqual(restored, records)
            self.assertGreater(len(descriptors), 1)

    def test_cross_split_run_lineage_is_quarantined_before_policy_selection(self) -> None:
        train = episode("train-clone", source_for("train"), "copied-seed", 10)
        validation = episode("validation-clone", source_for("validation"), "copied-seed", 11)
        unique = episode("train-unique", source_for("train", 1), "unique-seed", 12)
        exclusions: Counter[str] = Counter()
        metas = [analyze_episode(row, exclusions) for row in (train, validation, unique)]
        selected, _identity, conflicts = select_policy(metas, CurationConfig(wild_keep_rate=1), exclusions)
        self.assertIn("train-clone", conflicts)
        self.assertIn("validation-clone", conflicts)
        self.assertEqual({episode_id for episode_id, _decision_id in selected}, {"train-unique"})
        self.assertEqual(exclusions["cross_split_lineage_or_exact_roster"], 2)

    def test_near_duplicate_cross_split_rosters_are_quarantined(self) -> None:
        train = episode("near-train", source_for("train"), "seed-a", 20)
        validation = episode("near-validation", source_for("validation"), "seed-b", 20)
        for offset in range(1, 5):
            train["decisions"][0]["observation"]["selfParty"].append(mon(20 + offset))
            validation["decisions"][0]["observation"]["selfParty"].append(mon(20 + offset))
        validation["decisions"][0]["observation"]["selfParty"].append(mon(99))
        exclusions: Counter[str] = Counter()
        metas = [analyze_episode(row, exclusions) for row in (train, validation)]
        selected, _identity, conflicts = select_policy(metas, CurationConfig(wild_keep_rate=1), exclusions)
        self.assertEqual(selected, {})
        self.assertEqual(conflicts, {"near-train", "near-validation"})

    def test_aborted_forced_and_non_human_actions_never_enter_policy(self) -> None:
        source = source_for("train")
        rows = [
            decision("filters", 0, source, 30),
            decision("filters", 1, source, 30, candidate_count=1),
            decision("filters", 2, source, 30, policy_source="engine-hardest-v1"),
            decision("filters", 3, source, 30),
        ]
        fixture = episode("filters", source, "seed-filters", 30, decisions=rows)
        fixture["transitions"] = fixture["transitions"][:-1]
        exclusions: Counter[str] = Counter()
        meta = analyze_episode(fixture, exclusions)
        self.assertEqual([row.decision_id for row in meta.policy_candidates], [rows[0]["decisionId"]])
        self.assertEqual(exclusions["one_legal_action"], 1)
        self.assertEqual(exclusions["non_human_policy_target"], 1)
        self.assertEqual(exclusions["aborted_or_ambiguous_commitment"], 1)

    def test_state_action_and_source_caps_are_deterministic(self) -> None:
        source = source_for("train")
        fixtures = []
        for index in range(5):
            row = decision(f"duplicate-{index}", 0, source, 40)
            row["candidateFeatures"][0]["values"] = [0.0, 0.0, 40.0]
            row["candidateFeatures"][1]["values"] = [1.0, 0.0, 40.0]
            fixtures.append(episode(f"duplicate-{index}", source, f"seed-{index}", 40 + index, decisions=[row]))
        exclusions: Counter[str] = Counter()
        metas = [analyze_episode(row, exclusions) for row in fixtures]
        selected, _identity, _conflicts = select_policy(
            metas,
            CurationConfig(max_policy_per_source=1, max_state_action_repeats=2, wild_keep_rate=1),
            exclusions,
        )
        self.assertEqual(len(selected), 1)
        self.assertEqual(exclusions["duplicate_state_action_cap"], 3)
        self.assertEqual(exclusions["per_source_cap"], 1)

    def test_identical_model_inputs_cannot_cross_source_splits(self) -> None:
        fixtures = []
        for split in ("train", "validation"):
            source = source_for(split)
            row = decision(f"state-{split}", 0, source, 70)
            if split == "validation":
                row["observation"]["selfParty"] = [mon(71)]
            fixtures.append(episode(f"state-{split}", source, f"seed-{split}", 70, decisions=[row]))
        exclusions: Counter[str] = Counter()
        metas = [analyze_episode(row, exclusions) for row in fixtures]
        selected, _identity, _conflicts = select_policy(
            metas,
            CurationConfig(wild_keep_rate=1),
            exclusions,
        )
        self.assertEqual(selected, {})
        self.assertEqual(exclusions["cross_split_model_input"], 2)

    def test_private_shards_and_sanitized_report_are_materialized(self) -> None:
        fixtures = [
            episode(f"episode-{split}", source_for(split), f"seed-{split}", 100 + index)
            for index, split in enumerate(("train", "validation", "test"))
        ]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            input_path = root / "episodes.jsonl.gz"
            with input_path.open("wb") as output:
                for row in fixtures:
                    output.write(gzip.compress(f"{json.dumps(row)}\n".encode(), mtime=0))
            report_path = root / "report.json"
            report = curate(
                input_path,
                root / "private",
                report_path,
                CurationConfig(wild_keep_rate=1),
            )
            encoded_report = report_path.read_text(encoding="utf-8")
            self.assertTrue(report["passed"])
            self.assertTrue(all(report["policy"][split]["decisions"] == 1 for split in ("train", "validation", "test")))
            self.assertFalse(any(row["sourcePartitionId"] in encoded_report for row in fixtures))
            self.assertFalse(any(row["episodeId"] in encoded_report for row in fixtures))
            self.assertTrue((root / "private" / "manifest.json").is_file())
            with gzip.open(root / "private" / "policy-all-train.jsonl.gz", "rt", encoding="utf-8") as shard:
                self.assertEqual(json.loads(shard.readline())["decisionId"], "decision-episode-train-0")


if __name__ == "__main__":
    unittest.main()
