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
SOURCE_GENDER_SHA256 = "a27f86e31feccd821f35aecaf9eb496faf120127e3df3d2c7c0b14f6593928fb"
SOURCE_FORM_FLAGS_SHA256 = "e03db62cf3982e03fbb5a25045e15407abd12010aefcbca8fa8cf5585881f446"
SOURCE_ABILITY_SLOTS_SHA256 = "c7564ac254fee378288b8cd8a10a1ca27dda01c6775045871feb3f6799a5f558"
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
              "scope": "Ace/Town/day wave-two full-root and source constructor prefix through nature; no moveset, enemy settlement or next-wave receipt",
              "commands": COMMANDS}
    try:
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        status = subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT).strip()
        if head != SHA or status:
            raise RuntimeError("exact clean source candidate required")
        files = ["rust/crates/er-game/src/current_town_wild_spawn.rs",
                 "rust/crates/er-game/src/lib.rs",
                 "rust/crates/er-game/src/m9_new_run.rs",
                 "rust/crates/er-game/src/material.rs",
                 "rust/crates/er-game/tests/m9e_current_town_wild_spawn.rs",
                 "rust/crates/er-rng/src/audit.rs",
                 "rust/crates/er-rng/src/battle.rs",
                 "rust/crates/er-rng/tests/m3_rng.rs",
                 "rust/fixtures/m9/engineering/town-gender-v1.json",
                 "rust/fixtures/m9/engineering/town-form-flags-v1.json",
                 "rust/fixtures/m9/engineering/town-ability-slots-v1.json",
                 "scripts/ci/m9e_town_selector_diagnostic.py",
                 ".github/workflows/m9e-town-content-probe.yml"]
        result["source_hashes"] = {name: digest((ROOT / name).read_bytes()) for name in files}
        fixture = RUST / "fixtures/m9/engineering/game-content-bundle-v2.json"
        result["fixture"] = {"bytes": fixture.stat().st_size,
                             "sha256": digest(fixture.read_bytes())}
        source_fixtures = {
            "gender": ("rust/fixtures/m9/engineering/town-gender-v1.json", SOURCE_GENDER_SHA256),
            "form_flags": ("rust/fixtures/m9/engineering/town-form-flags-v1.json", SOURCE_FORM_FLAGS_SHA256),
            "ability_slots": ("rust/fixtures/m9/engineering/town-ability-slots-v1.json", SOURCE_ABILITY_SLOTS_SHA256),
        }
        for name, (path, expected) in source_fixtures.items():
            actual = digest((ROOT / path).read_bytes())
            if actual != expected:
                raise RuntimeError("pinned source fixture differs: " + name)
        result["source_fixtures"] = {name: {"path": path, "sha256": expected}
                                     for name, (path, expected) in source_fixtures.items()}
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
        rng_base = ["cargo", "test", "--locked", "-p", "er-rng", "--test", "m3_rng", "--"]
        rng_listing = run("rng-list", rng_base + ["--list", "--format", "terse"])
        rng_ids = re.findall(r"^([A-Za-z0-9_:]+): test$", rng_listing, re.M)
        if len(rng_ids) != 25 or len(set(rng_ids)) != 25 or "source_run_float_is_exact_and_rejects_a_forged_audit" not in rng_ids:
            raise RuntimeError("whole RNG test inventory differs")
        rng_output = run("rng-execute", rng_base + ["--format", "terse"], 900)
        rng_counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", rng_output)
        if rng_counts != [("25", "0", "0", "0", "0")]:
            raise RuntimeError("whole RNG result count differs")
        run("clippy", ["cargo", "clippy", "--locked", "-p", "er-game", "--test", TARGET,
                       "--no-deps", "--", "-D", "warnings"], 300)
        run("rng-clippy", ["cargo", "clippy", "--locked", "-p", "er-rng", "--test", "m3_rng",
                           "--no-deps", "--", "-D", "warnings"], 300)
        result["tests"] = {"passed": 26, "failed": 0, "ignored": 0,
                           "town_id": TEST_ID, "rng_ids": rng_ids}
        result["status"] = "passed"
    except Exception as error:
        result["first_failure"] = str(error)[:1024]
        if result["first_failure"] == "format failed":
            subprocess.run(["cargo", "fmt", "--manifest-path", "Cargo.toml", "--all"],
                           cwd=RUST, timeout=120, check=False)
            patch = subprocess.check_output(["git", "diff", "--", *files[:8]], cwd=ROOT)
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
