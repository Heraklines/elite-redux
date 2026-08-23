from __future__ import annotations

import gzip
import json
import tempfile
import unittest
from pathlib import Path

from chunk_gzip_jsonl import chunk


class ChunkGzipJsonlTest(unittest.TestCase):
    def test_splits_only_at_episode_boundaries_and_preserves_order(self) -> None:
        episodes = [{"episodeId": f"episode-{index}", "payload": "x" * 80} for index in range(5)]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.jsonl.gz"
            with source.open("wb") as raw:
                for episode in episodes:
                    raw.write(gzip.compress(f"{json.dumps(episode)}\n".encode(), mtime=0))

            report = chunk(source, root / "chunks", "2026-08-03", 180, root / "report.json")

            restored = []
            for descriptor in report["files"]:
                self.assertLess(descriptor["uncompressedBytes"], 181)
                with gzip.open(root / "chunks" / descriptor["name"], "rt", encoding="utf-8") as handle:
                    restored.extend(json.loads(line) for line in handle)
            self.assertEqual(restored, episodes)
            self.assertEqual(report["records"], len(episodes))
            self.assertGreater(len(report["files"]), 1)
            self.assertTrue(report["passed"])

    def test_keeps_one_oversized_episode_in_a_dedicated_compressed_chunk(self) -> None:
        episodes = [
            {"episodeId": "small-before", "payload": "a" * 8},
            {"episodeId": "long-run", "payload": "b" * 512},
            {"episodeId": "small-after", "payload": "c" * 8},
        ]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.jsonl.gz"
            with gzip.open(source, "wt", encoding="utf-8") as handle:
                for episode in episodes:
                    handle.write(f"{json.dumps(episode)}\n")

            report = chunk(source, root / "chunks", "2026-08-06", 128, root / "report.json")

            self.assertEqual(report["oversizedRecords"], 1)
            self.assertEqual([row["records"] for row in report["files"]], [1, 1, 1])
            self.assertGreater(report["files"][1]["uncompressedBytes"], 128)
            self.assertTrue(report["passed"])

    def test_rejects_a_chunk_that_exceeds_the_compressed_upload_limit(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.jsonl.gz"
            with gzip.open(source, "wt", encoding="utf-8") as handle:
                handle.write(f'{json.dumps({"episodeId": "episode-0", "payload": "x" * 512})}\n')

            with self.assertRaisesRegex(RuntimeError, "private upload chunk gate failed"):
                chunk(
                    source,
                    root / "chunks",
                    "2026-08-06",
                    128,
                    root / "report.json",
                    max_compressed_bytes=8,
                )

            report = json.loads((root / "report.json").read_text(encoding="utf-8"))
            self.assertFalse(report["passed"])


if __name__ == "__main__":
    unittest.main()
