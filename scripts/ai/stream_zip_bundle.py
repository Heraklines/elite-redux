#!/usr/bin/env python3
"""Create a deterministic ZIP64 bundle without loading source files into memory."""

from __future__ import annotations

import json
import os
import shutil
import sys
import zipfile
from pathlib import Path, PurePosixPath


COPY_BUFFER_BYTES = 1024 * 1024


def validated_archive_path(value: object) -> str:
    if not isinstance(value, str) or not value:
        raise RuntimeError("archive entry has no path")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or "\\" in value:
        raise RuntimeError(f"unsafe archive path: {value!r}")
    return path.as_posix()


def add_file(archive: zipfile.ZipFile, source: Path, archive_path: str) -> None:
    if not source.is_file():
        raise RuntimeError(f"archive source is not a file: {source}")
    info = zipfile.ZipInfo(archive_path, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    with source.open("rb") as input_file, archive.open(info, "w", force_zip64=True) as output_file:
        shutil.copyfileobj(input_file, output_file, length=COPY_BUFFER_BYTES)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: stream_zip_bundle.py SPEC_JSON", file=sys.stderr)
        return 2
    spec_path = Path(sys.argv[1]).resolve()
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    output = Path(spec["output"]).resolve()
    compression_level = int(spec.get("compressionLevel", 9))
    if compression_level < 0 or compression_level > 9:
        raise RuntimeError(f"invalid ZIP compression level: {compression_level}")
    entries = spec.get("entries")
    if not isinstance(entries, list) or not entries:
        raise RuntimeError("ZIP bundle has no entries")

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_output = output.with_name(f".{output.name}.{os.getpid()}.tmp")
    temporary_output.unlink(missing_ok=True)
    seen_paths: set[str] = set()
    try:
        with zipfile.ZipFile(
            temporary_output,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=compression_level,
            allowZip64=True,
        ) as archive:
            for entry in entries:
                if not isinstance(entry, dict):
                    raise RuntimeError("invalid ZIP entry")
                archive_path = validated_archive_path(entry.get("archivePath"))
                if archive_path in seen_paths:
                    raise RuntimeError(f"duplicate archive path: {archive_path}")
                seen_paths.add(archive_path)
                add_file(archive, Path(entry["source"]).resolve(), archive_path)
        os.replace(temporary_output, output)
    finally:
        temporary_output.unlink(missing_ok=True)
    print(json.dumps({"output": str(output), "entries": len(entries), "bytes": output.stat().st_size}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
