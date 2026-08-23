import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from prepare_curated_transformer_corpus import assemble


IDENTITY = {"buildSha": "build-a", "dexHash": "dex-a", "dictionaryHash": "dictionary-a"}


def write_gzip_jsonl(path: Path, rows: list[dict]) -> dict:
    with path.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
            for row in rows:
                compressed.write(f"{json.dumps(row)}\n".encode())
    payload = path.read_bytes()
    return {"name": path.name, "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest(), "records": len(rows)}


def decision(split: str, suffix: str, completed: bool) -> dict:
    episode_id = f"episode-{split}-{suffix}"
    battle = f"{episode_id}:1:battle"
    return {
        "kind": "combat_decision",
        "schemaVersion": 4,
        "featureSchemaVersion": 4,
        **IDENTITY,
        "episodeId": episode_id,
        "sourcePartitionId": f"source-{split}-{suffix}",
        "jointActionId": f"{battle}:1",
        "decisionId": f"decision-{split}-{suffix}",
        "policySource": "human-v1",
        "policyTarget": True,
        "completed": completed,
    }


class PrepareCuratedTransformerCorpusTest(unittest.TestCase):
    def test_combines_human_policy_with_only_matching_completed_battle_terminals(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            curated = Path(temporary) / "curated"
            output = Path(temporary) / "output"
            curated.mkdir()
            files = []
            for split in ("train", "validation", "test"):
                decisions = [decision(split, "complete", True), decision(split, "open", False)]
                for dataset in ("policy-all", "policy-battle-wins", "policy-run-wins"):
                    rows = decisions if dataset == "policy-all" else decisions[:1]
                    files.append(write_gzip_jsonl(curated / f"{dataset}-{split}.jsonl.gz", rows))
                complete = decisions[0]
                battle_id = complete["jointActionId"].rsplit(":", 1)[0]
                episode = {
                    "episodeId": complete["episodeId"],
                    "sourcePartitionId": complete["sourcePartitionId"],
                    "battleTerminals": [{"battleId": battle_id, "outcome": "victory"}],
                }
                files.append(write_gzip_jsonl(curated / f"critic-all-outcomes-{split}.jsonl.gz", [episode]))
            files.append(
                write_gzip_jsonl(
                    curated / "policy-all-train-part-00001.jsonl.gz",
                    [decision("train", "part", False)],
                )
            )
            manifest = {
                "datasetId": "a" * 24,
                "contractVersion": 4,
                "featureSchemaVersion": 4,
                "identity": IDENTITY,
                "files": files,
            }
            (curated / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

            report = assemble(curated, output)

            self.assertEqual(report["policyDecisions"], 5)
            self.assertEqual(report["sourcePartitions"], 5)
            self.assertEqual(report["selectedBattles"], 5)
            self.assertEqual(report["matchedBattleTerminals"], 2)
            self.assertEqual(report["unknownOutcomeBattles"], 3)
            self.assertFalse(report["heldOutSplitIncluded"])
            self.assertFalse((output / "policy-all-test.jsonl.gzpack").exists())
            self.assertTrue((output / "policy-all-train-part-00001.jsonl.gzpack").exists())
            packed_splits = {}
            for split in ("train", "validation"):
                rows = []
                for shard in sorted(output.glob(f"policy-all-{split}*.jsonl.gzpack")):
                    with gzip.open(shard, "rt", encoding="utf-8") as handle:
                        rows.extend(json.loads(line) for line in handle)
                self.assertTrue(rows)
                self.assertTrue(all(row["curationSplit"] == split for row in rows))
                packed_splits[split] = {row["sourcePartitionId"] for row in rows}
            self.assertFalse(packed_splits["train"].intersection(packed_splits["validation"]))
            with gzip.open(output / "completed-battle-terminals.jsonl.gzpack", "rt", encoding="utf-8") as handle:
                terminals = [json.loads(line) for line in handle]
            self.assertEqual(len(terminals), 2)
            self.assertTrue(all(row["kind"] == "battle_terminal" for row in terminals))
            self.assertTrue(all(row["buildSha"] == "build-a" for row in terminals))


if __name__ == "__main__":
    unittest.main()
