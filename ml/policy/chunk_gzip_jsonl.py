#!/usr/bin/env python3
"""Split private gzip JSONL into deterministic upload-sized members."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
from typing import BinaryIO


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


class ChunkWriter:
    def __init__(self, output_dir: Path, prefix: str, max_uncompressed_bytes: int) -> None:
        self.output_dir = output_dir
        self.prefix = prefix
        self.max_uncompressed_bytes = max_uncompressed_bytes
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.files: list[dict[str, int | str]] = []
        self.raw: BinaryIO | None = None
        self.compressed: gzip.GzipFile | None = None
        self.path: Path | None = None
        self.uncompressed_bytes = 0
        self.records = 0

    def _open(self) -> None:
        index = len(self.files)
        self.path = self.output_dir / f"{self.prefix}-part-{index:05d}.jsonl.gz"
        self.raw = self.path.open("wb")
        self.compressed = gzip.GzipFile(filename="", mode="wb", fileobj=self.raw, mtime=0)
        self.uncompressed_bytes = 0
        self.records = 0

    def _close(self) -> None:
        assert self.path is not None and self.raw is not None and self.compressed is not None
        self.compressed.close()
        self.raw.close()
        self.files.append(
            {
                "name": self.path.name,
                "sha256": file_sha256(self.path),
                "bytes": self.path.stat().st_size,
                "uncompressedBytes": self.uncompressed_bytes,
                "records": self.records,
            }
        )

    def write(self, line: bytes) -> None:
        if not line.endswith(b"\n"):
            line += b"\n"
        if self.compressed is None:
            self._open()
        if self.records and self.uncompressed_bytes + len(line) > self.max_uncompressed_bytes:
            self._close()
            self._open()
        assert self.compressed is not None
        self.compressed.write(line)
        self.uncompressed_bytes += len(line)
        self.records += 1

    def close(self) -> list[dict[str, int | str]]:
        if self.compressed is not None:
            self._close()
        return self.files


def chunk(
    source: Path,
    output_dir: Path,
    prefix: str,
    max_uncompressed_bytes: int,
    report_path: Path,
    max_compressed_bytes: int = 300 * 1024 * 1024,
) -> dict:
    if max_uncompressed_bytes < 1:
        raise ValueError("max_uncompressed_bytes must be positive")
    if max_compressed_bytes < 1:
        raise ValueError("max_compressed_bytes must be positive")
    writer = ChunkWriter(output_dir, prefix, max_uncompressed_bytes)
    records = 0
    with gzip.open(source, "rb") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"{source.name}:{line_number}: invalid JSON") from error
            if not isinstance(record, dict) or not record.get("episodeId"):
                raise ValueError(f"{source.name}:{line_number}: private episode row omitted episodeId")
            writer.write(line)
            records += 1
    files = writer.close()
    oversized_records = sum(
        1
        for row in files
        if row["records"] == 1 and row["uncompressedBytes"] > max_uncompressed_bytes
    )
    report = {
        "reportVersion": 1,
        "gate": "private-gzip-jsonl-upload-chunks",
        "passed": all(row["bytes"] < max_compressed_bytes for row in files),
        "privacy": {"rawIdentifiersIncluded": False, "rawRecordsIncluded": False},
        "records": records,
        "oversizedRecords": oversized_records,
        "maxUncompressedBytes": max_uncompressed_bytes,
        "maxCompressedBytes": max_compressed_bytes,
        "files": files,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(f"{json.dumps(report, indent=2, sort_keys=True)}\n", encoding="utf-8")
    if not report["passed"]:
        raise RuntimeError("private upload chunk gate failed")
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--max-uncompressed-bytes", type=int, default=128 * 1024 * 1024)
    parser.add_argument("--max-compressed-bytes", type=int, default=300 * 1024 * 1024)
    parser.add_argument("--report", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = chunk(
        args.input,
        args.output_dir,
        args.prefix,
        args.max_uncompressed_bytes,
        args.report,
        args.max_compressed_bytes,
    )
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
