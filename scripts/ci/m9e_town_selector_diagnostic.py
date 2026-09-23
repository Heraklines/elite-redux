"""Focused, source-bound remote Rust qualification for the Town root selector."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
RUST = ROOT / "rust"
OUT = Path(os.environ["RUNNER_TEMP"]) / "m9e-town-selector"
COMPACT = OUT / "compact"
SHA = os.environ["GITHUB_SHA"]
TARGET = "m9e_current_town_wild_spawn"
TEST_ID = "entire_town_day_pool_and_actual_wave_two_source_draw_match"
START = time.monotonic()
COMMANDS = []


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def run(name, argv, seconds=600):
    remaining = min(seconds, 1320 - int(time.monotonic() - START))
    if remaining <= 0:
        raise RuntimeError("shared Town selector deadline")
    completed = subprocess.run(argv, cwd=RUST, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, timeout=remaining, check=False)
    raw = completed.stdout
    if len(raw) > 8 << 20:
        raise RuntimeError(name + " exceeded remote log bound")
    COMMANDS.append({"name": name, "exit": completed.returncode,
                     "bytes": len(raw), "sha256": digest(raw)})
    (OUT / (name + ".log")).write_bytes(raw)
    if completed.returncode:
        excerpt = raw[:4096] + (b"\n...[middle omitted]...\n" + raw[-12288:] if len(raw) > 16384 else raw[4096:])
        (COMPACT / "failure.txt").write_bytes((name + " failed\n").encode() + excerpt)
        raise RuntimeError(name + " failed")
    return raw.decode("utf-8", errors="replace")


def main():
    COMPACT.mkdir(parents=True, exist_ok=False)
    result = {"schema": 1, "status": "failed", "source_sha": SHA,
              "scope": "Ace/Town/day wave-two full-root selection and source RNG; no enemy construction or next-wave receipt",
              "commands": COMMANDS}
    try:
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        status = subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT).strip()
        if head != SHA or status:
            raise RuntimeError("exact clean source candidate required")
        files = ["rust/crates/er-game/src/current_town_wild_spawn.rs",
                 "rust/crates/er-game/src/lib.rs",
                 "rust/crates/er-game/tests/m9e_current_town_wild_spawn.rs",
                 "scripts/ci/m9e_town_selector_diagnostic.py",
                 ".github/workflows/m9e-town-content-probe.yml"]
        result["source_hashes"] = {name: digest((ROOT / name).read_bytes()) for name in files}
        fixture = RUST / "fixtures/m9/engineering/game-content-bundle-v2.json"
        result["fixture"] = {"bytes": fixture.stat().st_size,
                             "sha256": digest(fixture.read_bytes())}
        run("format", ["cargo", "fmt", "--manifest-path", "Cargo.toml", "--all", "--", "--check"], 120)
        base = ["cargo", "test", "--locked", "-p", "er-game", "--test", TARGET, "--"]
        listing = run("list", base + ["--list", "--format", "terse"])
        ids = re.findall(r"^([A-Za-z0-9_:]+): test$", listing, re.M)
        if ids != [TEST_ID]:
            raise RuntimeError("whole Town selector test inventory differs")
        output = run("execute", base + ["--format", "terse"], 900)
        counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
        if counts != [("1", "0", "0", "0", "0")]:
            raise RuntimeError("Town selector result count differs")
        run("clippy", ["cargo", "clippy", "--locked", "-p", "er-game", "--test", TARGET,
                       "--no-deps", "--", "-D", "warnings"], 300)
        result["tests"] = {"passed": 1, "failed": 0, "ignored": 0, "id": TEST_ID}
        result["status"] = "passed"
    except Exception as error:
        result["first_failure"] = str(error)[:1024]
        if result["first_failure"] == "format failed":
            subprocess.run(["cargo", "fmt", "--manifest-path", "Cargo.toml", "--all"],
                           cwd=RUST, timeout=120, check=False)
            patch = subprocess.check_output(["git", "diff", "--", "rust/crates/er-game/src/current_town_wild_spawn.rs",
                                             "rust/crates/er-game/src/lib.rs",
                                             "rust/crates/er-game/tests/m9e_current_town_wild_spawn.rs"], cwd=ROOT)
            if len(patch) <= 32768:
                (OUT / "format.patch").write_bytes(patch)
    finally:
        result["elapsed_seconds"] = round(time.monotonic() - START, 1)
        encoded = (json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n").encode()
        if len(encoded) > 16384:
            raise RuntimeError("Town selector summary bound")
        (COMPACT / "summary.json").write_bytes(encoded)
    if result["status"] != "passed":
        raise RuntimeError(result["first_failure"])


if __name__ == "__main__":
    main()
