"""Focused, source-bound remote Rust qualification for the Town selector and shell."""

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
TEST_IDS = ["entire_town_day_pool_and_actual_wave_two_source_draw_match",
            "naturally_admitted_day_seed_matches_pinned_postreward_enemy",
            "source_single_width_successor_with_matching_natural_opening",
            "source_single_width_town_successor_matches_pinned_shell",
            "source_town_opening_shell_matches_classic_level_five_trace"]
SOURCE_GENDER_SHA256 = "a27f86e31feccd821f35aecaf9eb496faf120127e3df3d2c7c0b14f6593928fb"
SOURCE_FORM_FLAGS_SHA256 = "e03db62cf3982e03fbb5a25045e15407abd12010aefcbca8fa8cf5585881f446"
SOURCE_ABILITY_SLOTS_SHA256 = "c7564ac254fee378288b8cd8a10a1ca27dda01c6775045871feb3f6799a5f558"
SOURCE_FORM_TYPES_SHA256 = "d66c5e26ecc920e50bdcc680479dfab9913103435f975ee5b4d0447d65373fcb"
SOURCE_FORM_STATS_SHA256 = "8ce7ebeb1062ee505b89bf1400b90be9a9273fe7e4130aa2ede2b0821d65a526"
SOURCE_LEVEL_TWO_FORMS_SHA256 = "63cd454d9e74ae2d77e59327b02a391e8c196edc60bc030cc26037589c6dfd78"
SOURCE_LEVEL_TWO_META_SHA256 = "86b764e17e26ec5db4bd201cc7f95950975aa134960eae2a0570a8b5a7201a80"
SOURCE_LEVEL_TWO_MOVEGEN_SHA256 = "5369a09a00d1e10bd67025ce6c8ff8079dd5fe05cec45a5e40c0617950cd6575"
SOURCE_LEVEL_TWO_ABILITIES_SHA256 = "69c24f1b15c8888fd2ae7ec9c1565562135d8f9dc0eefb56774f1a919ca1e013"
SOURCE_LEVEL_TWO_ABILITY_POWERS_SHA256 = "5bf870bd3df95ce6e723585a1aec1c008c4bec81082e04f4032f15695b861f9c"
SOURCE_LEVEL_TWO_SIGNATURES_SHA256 = "a7d37de2698ddfa3b4e3b4c67d0c66cbf876784185eaf12ef0407f577f6042a9"
SOURCE_LEVEL_TWO_USELESS_SHA256 = "308dde1bb4a40500b0762ba676763aefb1a3ffc365f26bc5a3d18818487b7e89"
SOURCE_MOVEGEN_STAGE_SHA256 = "de404f12a5cfffcaf71d41f01b6e5daae821faa57b9d4e3012293fc0260aac29"
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
              "scope": "Ace/Town/day wave-one root and wave-two full-root, constructor prefix, level-two ability-profile moveset and pinned single/double successor shells; no enemy settlement or next-wave receipt",
              "commands": COMMANDS}
    try:
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        status = subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT).strip()
        if head != SHA or status:
            raise RuntimeError("exact clean source candidate required")
        files = ["rust/crates/er-game/src/current_town_wild_spawn.rs",
                 "rust/crates/er-game/src/current_source_starter.rs",
                 "rust/crates/er-game/src/m9e_new_run_v6.rs",
                 "rust/crates/er-cli/src/current_agent.rs",
                 "rust/crates/er-cli/tests/m9e_current_entry.rs",
                 "rust/crates/er-game/src/current_town_level_two_forms.json",
                 "rust/crates/er-game/src/current_town_level_two_meta.json",
                 "rust/crates/er-game/src/current_town_level_two_movegen.json",
                 "rust/crates/er-game/src/current_town_level_two_abilities.json",
                 "rust/crates/er-game/src/current_town_level_two_ability_powers.json",
                 "rust/crates/er-game/src/current_town_level_two_signatures.json",
                 "rust/crates/er-game/src/current_town_level_two_useless.json",
                 "rust/crates/er-game/src/lib.rs",
                 "rust/crates/er-game/src/m9_new_run.rs",
                 "rust/crates/er-game/src/material.rs",
                 "rust/crates/er-game/tests/m9e_current_town_wild_spawn.rs",
                 "rust/crates/er-state/src/m9e_state_v6.rs",
                 "rust/crates/er-rng/src/audit.rs",
                 "rust/crates/er-rng/src/battle.rs",
                 "rust/crates/er-rng/tests/m3_rng.rs",
                 "rust/fixtures/m9/engineering/town-gender-v1.json",
                 "rust/fixtures/m9/engineering/town-form-flags-v1.json",
                 "rust/fixtures/m9/engineering/town-ability-slots-v1.json",
                 "rust/fixtures/m9/engineering/town-form-types-v1.json",
                 "rust/fixtures/m9/engineering/town-form-stats-v1.json",
                 "rust/fixtures/m9/engineering/town-movegen-stage-v1.json",
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
            "form_types": ("rust/fixtures/m9/engineering/town-form-types-v1.json", SOURCE_FORM_TYPES_SHA256),
            "form_stats": ("rust/fixtures/m9/engineering/town-form-stats-v1.json", SOURCE_FORM_STATS_SHA256),
            "level_two_forms": ("rust/crates/er-game/src/current_town_level_two_forms.json", SOURCE_LEVEL_TWO_FORMS_SHA256),
            "level_two_meta": ("rust/crates/er-game/src/current_town_level_two_meta.json", SOURCE_LEVEL_TWO_META_SHA256),
            "level_two_movegen": ("rust/crates/er-game/src/current_town_level_two_movegen.json", SOURCE_LEVEL_TWO_MOVEGEN_SHA256),
            "level_two_abilities": ("rust/crates/er-game/src/current_town_level_two_abilities.json", SOURCE_LEVEL_TWO_ABILITIES_SHA256),
            "level_two_ability_powers": ("rust/crates/er-game/src/current_town_level_two_ability_powers.json", SOURCE_LEVEL_TWO_ABILITY_POWERS_SHA256),
            "level_two_signatures": ("rust/crates/er-game/src/current_town_level_two_signatures.json", SOURCE_LEVEL_TWO_SIGNATURES_SHA256),
            "level_two_useless": ("rust/crates/er-game/src/current_town_level_two_useless.json", SOURCE_LEVEL_TWO_USELESS_SHA256),
            "movegen_stage": ("rust/fixtures/m9/engineering/town-movegen-stage-v1.json", SOURCE_MOVEGEN_STAGE_SHA256),
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
        if ids != TEST_IDS:
            raise RuntimeError("whole Town selector test inventory differs")
        output = run("execute", base + ["--format", "terse"], 900)
        counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
        if counts != [("5", "0", "0", "0", "0")]:
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
        result["tests"] = {"passed": 30, "failed": 0, "ignored": 0,
                           "town_ids": TEST_IDS, "rng_ids": rng_ids}
        result["status"] = "passed"
    except Exception as error:
        result["first_failure"] = str(error)[:1024]
        if result["first_failure"] == "format failed":
            subprocess.run(["cargo", "fmt", "--manifest-path", "Cargo.toml", "--all"],
                           cwd=RUST, timeout=120, check=False)
            patch = subprocess.check_output(["git", "diff", "--", files[0],
                                             "rust/crates/er-game/src/current_source_starter.rs",
                                             "rust/crates/er-cli/src/current_agent.rs",
                                             "rust/crates/er-cli/tests/m9e_current_entry.rs",
                                             "rust/crates/er-game/tests/m9e_current_town_wild_spawn.rs",
                                             "rust/crates/er-state/src/m9e_state_v6.rs",
                                             "rust/crates/er-game/tests/m9e_town_seed_search.rs",
                                             "rust/crates/er-kernel/tests/m9e_current_phase_execution.rs"], cwd=ROOT)
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
