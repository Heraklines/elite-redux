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


if __name__ == "__main__":
    unittest.main()
