#!/usr/bin/env python3
"""Merge private date-sharded contract-v4 episodes with bounded memory."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import sqlite3
import tempfile
from pathlib import Path
from typing import Any, Iterable, TextIO


def iter_episodes(path: Path) -> Iterable[dict[str, Any]]:
    if path.stat().st_size == 0:
        return
    with gzip.open(path, mode="rt", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            episode = json.loads(line)
            episode_id = episode.get("episodeId") if isinstance(episode, dict) else None
            if not isinstance(episode_id, str) or not episode_id:
                raise ValueError(f"{path.name}:{line_number} omitted episodeId")
            yield episode


def write_episode(handle: TextIO, episode: dict[str, Any]) -> None:
    handle.write(json.dumps(episode, sort_keys=True, separators=(",", ":")))
    handle.write("\n")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def merge(
    inputs: list[Path],
    output: Path,
    report_path: Path,
    delete_inputs: bool = False,
) -> dict[str, Any]:
    ordered_inputs = sorted(path.resolve() for path in inputs)
    if not ordered_inputs or any(not path.is_file() for path in ordered_inputs):
        raise ValueError("all input episode shards must exist")
    if output.resolve() in ordered_inputs or report_path.resolve() in ordered_inputs:
        raise ValueError("merge output and report must not overwrite an input shard")
    output.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="er-v4-episode-merge-") as scratch:
        database = sqlite3.connect(Path(scratch) / "episode-counts.sqlite3")
        database.execute("CREATE TABLE episodes (episode_id TEXT PRIMARY KEY, records INTEGER NOT NULL)")
        input_records = 0
        for path in ordered_inputs:
            for episode in iter_episodes(path):
                input_records += 1
                database.execute(
                    "INSERT INTO episodes (episode_id, records) VALUES (?, 1) "
                    "ON CONFLICT(episode_id) DO UPDATE SET records = records + 1",
                    (episode["episodeId"],),
                )
        database.commit()
        unique_episode_ids, duplicate_episode_ids, duplicate_records = database.execute(
            "SELECT COUNT(*), "
            "SUM(CASE WHEN records > 1 THEN 1 ELSE 0 END), "
            "SUM(CASE WHEN records > 1 THEN records ELSE 0 END) FROM episodes"
        ).fetchone()

        output_records = 0
        with output.open("wb") as raw:
            with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
                with io.TextIOWrapper(compressed, encoding="utf-8", newline="\n") as text:
                    for path in ordered_inputs:
                        for episode in iter_episodes(path):
                            count = database.execute(
                                "SELECT records FROM episodes WHERE episode_id = ?",
                                (episode["episodeId"],),
                            ).fetchone()[0]
                            if count == 1:
                                write_episode(text, episode)
                                output_records += 1
                        if delete_inputs:
                            path.unlink()
        database.close()

    report = {
        "reportVersion": 1,
        "gate": "contract-v4-date-shard-merge",
        "passed": output_records > 0,
        "privacy": {"rawIdentifiersIncluded": False, "rawRecordsIncluded": False},
        "inputShards": len(ordered_inputs),
        "inputRecords": input_records,
        "uniqueEpisodeIds": int(unique_episode_ids or 0),
        "duplicateEpisodeIdsExcluded": int(duplicate_episode_ids or 0),
        "duplicateRecordsExcluded": int(duplicate_records or 0),
        "outputEpisodes": output_records,
        "inputShardsDeleted": len(ordered_inputs) if delete_inputs else 0,
        "output": {
            "sha256": file_sha256(output),
            "bytes": output.stat().st_size,
        },
    }
    report_path.write_text(f"{json.dumps(report, indent=2, sort_keys=True)}\n", encoding="utf-8")
    if not report["passed"]:
        raise RuntimeError("merged episode corpus is empty")
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inputs", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--delete-inputs", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = merge(args.inputs, args.output, args.report, args.delete_inputs)
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
