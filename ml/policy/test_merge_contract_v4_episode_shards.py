from __future__ import annotations

import gzip
import json
import tempfile
import unittest
from pathlib import Path

from merge_contract_v4_episode_shards import merge


def write_shard(path: Path, episodes: list[dict[str, object]]) -> None:
    with gzip.open(path, mode="wt", encoding="utf-8") as handle:
        for episode in episodes:
            handle.write(json.dumps(episode))
            handle.write("\n")


class MergeContractV4EpisodeShardsTest(unittest.TestCase):
    def test_excludes_every_copy_of_cross_shard_episode(self) -> None:
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            first = root / "2026-08-03.jsonl.gz"
            second = root / "2026-08-04.jsonl.gz"
            output = root / "merged.jsonl.gz"
            report_path = root / "report.json"
            write_shard(first, [{"episodeId": "a", "value": 1}, {"episodeId": "cross", "value": 2}])
            write_shard(second, [{"episodeId": "cross", "value": 3}, {"episodeId": "b", "value": 4}])

            report = merge([second, first], output, report_path)

            with gzip.open(output, mode="rt", encoding="utf-8") as handle:
                records = [json.loads(line) for line in handle if line.strip()]
            self.assertEqual([record["episodeId"] for record in records], ["a", "b"])
            self.assertEqual(report["inputRecords"], 4)
            self.assertEqual(report["duplicateEpisodeIdsExcluded"], 1)
            self.assertEqual(report["duplicateRecordsExcluded"], 2)
            self.assertEqual(report["outputEpisodes"], 2)
            self.assertFalse(report["privacy"]["rawIdentifiersIncluded"])

    def test_accepts_empty_gzip_member_shard(self) -> None:
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            empty = root / "empty.jsonl.gz"
            populated = root / "populated.jsonl.gz"
            output = root / "merged.jsonl.gz"
            with gzip.open(empty, mode="wb"):
                pass
            write_shard(populated, [{"episodeId": "only"}])

            report = merge([empty, populated], output, root / "report.json")

            self.assertEqual(report["inputShards"], 2)
            self.assertEqual(report["outputEpisodes"], 1)


if __name__ == "__main__":
    unittest.main()
