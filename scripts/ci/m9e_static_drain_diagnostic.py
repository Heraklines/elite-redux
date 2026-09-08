"""Remote qualification of source-generated static damage drains and actual turn resolution."""
import difflib
import hashlib
import json
import os
import re
from pathlib import Path
import signal
import subprocess
import time

BASE = "51841a90c9c1f5599d1fc980cd4531b4c6c1c9ab"
SOURCE = "rust/crates/er-game/tests/m9e_move_drains.rs"
CI = [".github/workflows/m9e-static-drain-focused.yml", "scripts/ci/m9e_static_drain_diagnostic.py"]
DELTAS = json.loads(r'''{"before":{"rust/crates/er-battle/src/m7_resolver.rs":"db8b2ed1e6152e6b4401663273ced1550cdd6fc8a6bdc0e10fe0bcd24c654e57","rust/crates/er-content-compiler/src/lib.rs":"6540d342bfa247de0b1aa34f6a580f1fe24b82c01c223207bf97952fa5b4a8f2","rust/crates/er-content-compiler/src/m9e_full_content.rs":"1ed03123f0f76d0be480836d067cab7a88e59ca6c7be7630b8ac60a16abb0808"},"after":{"rust/crates/er-battle/src/m7_resolver.rs":"123adc6260134d0fc6e574d6b43faf0176b8b421f8f5d7a178288d8eb4b0000e","rust/crates/er-content-compiler/src/lib.rs":"f12b5faa7e62d84d70d038ec82e0f3151eabd47c845e4853ffe4b5d39a316d83","rust/crates/er-content-compiler/src/m9e_full_content.rs":"6f30654dc6f188e9940d6b014959622e26228e4b3a9f655587f7ef41a8c2ff50","rust/crates/er-content-compiler/src/m9e_move_drains.rs":"faaa210ca40488a80ddd36de7fa7c5af07011f0bc2e9b7f9d1a4262a83bf9630","rust/crates/er-game/tests/m9e_move_drains.rs":"85296cdfec5fb0c89a85cf09048784e748bb943477b674c9c340e406a12b2787"}}''')
ROOT = Path.cwd().resolve()
RUNNER = Path(os.environ["RUNNER_TEMP"]).resolve()
OUT = RUNNER / "m9e-static-drain"
TARGET = RUNNER / "m9e-static-drain-target"
START = float(os.environ["M9E_STARTED_AT"])
DEADLINE = START + 1800
COMMANDS = []


def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def bounded_write(path, value, maximum):
    raw = (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()
    require(len(raw) <= maximum, "compact result exceeds unchanged bound")
    path.write_bytes(raw)


def run(name, argv, cwd=ROOT, maximum=8 << 20):
    remaining = DEADLINE - 20 - time.time()
    require(remaining > 0, "shared deadline exhausted before " + name)
    seconds = min(600, remaining)
    log = OUT / "diagnostics" / (name + ".log")
    started = time.monotonic()
    with log.open("wb") as output:
        process = subprocess.Popen(argv, cwd=cwd, stdout=output, stderr=subprocess.STDOUT,
                                   start_new_session=True)
        limit = started + seconds
        reason = None
        while process.poll() is None:
            if time.monotonic() >= limit or log.stat().st_size > maximum:
                reason = "deadline or diagnostic log bound exceeded"
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
                break
            time.sleep(0.1)
    raw = log.read_bytes()
    COMMANDS.append({"name": name, "argv": argv, "cwd": str(cwd.relative_to(ROOT)) or ".",
                     "limit_seconds": seconds, "elapsed_ms": int((time.monotonic() - started) * 1000),
                     "returncode": process.returncode, "log_bytes": len(raw), "log_sha256": sha(raw)})
    require(reason is None and process.returncode == 0, reason or name + " failed")
    require(time.time() <= DEADLINE, "shared deadline exhausted after " + name)
    return raw


def git(*args):
    name = "git-" + str(len(COMMANDS))
    return run(name, ["git", *args])


def main():
    require(re.fullmatch(r"[0-9]{10}", os.environ["M9E_STARTED_AT"]) and 0 <= time.time() - START < 1780, "precheckout shared budget required")
    require(os.name == "posix" and os.uname().machine == "x86_64", "Ubuntu x64 runner required")
    require(OUT.parent == RUNNER and TARGET.parent == RUNNER and not OUT.exists()
            and not TARGET.exists(), "fresh owned runner directories required")
    (OUT / "compact").mkdir(parents=True)
    (OUT / "diagnostics").mkdir()
    TARGET.mkdir()
    os.environ["CARGO_TARGET_DIR"] = str(TARGET)
    result = {"status": "failed", "qualification": "five whole source-generated static drain tests; ordinary drain only, not complete ability/item interactions or M9 qualification",
              "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
              "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": BASE,
              "tests_executed": 0, "commands": COMMANDS}
    try:
        require(git("rev-parse", "HEAD").decode().strip() == result["source_sha"], "candidate HEAD differs")
        require(git("rev-parse", BASE + "^{commit}").decode().strip() == BASE, "exact failed full base required")
        paths = git("diff", "--name-only", BASE, "HEAD").decode().splitlines()
        require(sorted(paths) == sorted([*DELTAS["after"], *CI]), "exact reviewed source delta required")
        for path, expected in DELTAS["before"].items():
            require(sha(git("show", BASE + ":" + path)) == expected, "baseline source differs: " + path)
        for path, expected in DELTAS["after"].items():
            require(sha((ROOT / path).read_bytes()) == expected, "reviewed source differs: " + path)
        # The whole-tree delta already forbids every fixture modification. Retain
        # exact fixture tree metadata without reading any generated body here.
        result["fixture_tree_sha256"] = sha(git("ls-tree", "-r", "HEAD", "--", "rust/fixtures/m9/engineering"))
        require(not any(path.startswith("rust/fixtures/") for path in paths), "fixture source changed")
        pins = [*DELTAS["after"], *CI, "rust/Cargo.toml", "rust/Cargo.lock", "rust/rust-toolchain.toml",
                "rust/crates/er-game/Cargo.toml", "rust/crates/er-game/src/lib.rs",
                "rust/crates/er-game/src/m7_content.rs", "rust/crates/er-game/src/m9e_content_v2.rs",
                "rust/crates/er-battle/Cargo.toml", "rust/crates/er-battle/src/lib.rs",
                "rust/crates/er-content-compiler/Cargo.toml", "rust/crates/er-content-compiler/src/bin/m9e-content.rs",
                "rust/crates/er-content-compiler/src/m6/moves.rs", "rust/crates/er-content-compiler/src/m6/pipeline.rs",
                "rust/crates/er-content-compiler/src/m6/routine.rs", "rust/crates/er-mechanics/src/selector_operation_v2.rs",
                "scripts/export-kernel-m5-source-catalog.mjs", "scripts/export-kernel-m6-semantic-catalog.mjs"]
        result["source_hashes"] = {path: sha((ROOT / path).read_bytes()) for path in pins}
        for path in pins:
            if path not in [*DELTAS["after"], *CI]:
                require(sha(git("show", BASE + ":" + path)) == result["source_hashes"][path],
                        "unchanged compiler/source prerequisite differs: " + path)
        result["source_tree_sha256"] = sha(git("ls-tree", "-r", "HEAD", "--", "rust/crates/er-game"))
        run("toolchain-install", ["rustup", "toolchain", "install", "1.97.1", "--profile", "minimal",
                                  "--component", "rustfmt", "--component", "clippy"])
        rustc = run("rustc-version", ["rustc", "-Vv"], ROOT / "rust").decode()
        require("release: 1.97.1\n" in rustc and "host: x86_64-unknown-linux-gnu\n" in rustc,
                "actual pinned compiler/host differs")
        result["rustc"] = rustc
        originals = {path: (ROOT / path).read_bytes() for path in DELTAS["after"] if path.endswith(".rs")}
        run("rustfmt", ["rustfmt", "--edition", "2024", "--config", "skip_children=true", *originals])
        patch = b""
        format_rows = []
        for path, original in originals.items():
            formatted = (ROOT / path).read_bytes()
            if original != formatted:
                patch += "".join(difflib.unified_diff(original.decode().splitlines(True), formatted.decode().splitlines(True), fromfile="a/" + path, tofile="b/" + path)).encode()
                format_rows.append({"path": path, "before_sha256": sha(original), "after_sha256": sha(formatted)})
        if patch:
            require(len(patch) <= 262144, "named format patch bound")
            (OUT / "diagnostics/format.patch").write_bytes(patch)
            result["format_patch"] = {"bytes": len(patch), "sha256": sha(patch), "files": format_rows}
            raise RuntimeError("exact remote formatting correction required before qualification")
        profile_keys = ["CARGO_PROFILE_" + mode + "_" + field
                        for mode in ("DEV", "TEST")
                        for field in ("OPT_LEVEL", "DEBUG_ASSERTIONS", "OVERFLOW_CHECKS", "DEBUG")]
        result["profile_environment"] = {key: os.environ.get(key) for key in profile_keys}
        for key, value in result["profile_environment"].items():
            require(value == ("true" if key.endswith(("DEBUG_ASSERTIONS", "OVERFLOW_CHECKS")) else "0"),
                    "ordinary correctness profile differs")
        require(not os.environ.get("RUSTFLAGS") and not os.environ.get("CARGO_ENCODED_RUSTFLAGS"),
                "ambient compiler flags prohibited")
        require(not os.environ.get("RUST_MIN_STACK") and not os.environ.get("RUST_TEST_THREADS"),
                "ordinary default stack and libtest execution required")
        selector = ["-p", "er-game", "--test", "m9e_move_drains"]
        run("proposal-clippy", ["cargo", "clippy", "--locked", "-p", "er-game", "-p", "er-battle", "-p", "er-content-compiler", "--tests", "--no-deps", "--", "-D", "warnings"], ROOT / "rust")
        require(run("oracle-head", ["git", "-C", "oracle", "rev-parse", "HEAD"]).decode().strip()
                == "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7", "frozen TypeScript source required")
        parser = TARGET / "parser"
        run("parser-install", ["npm", "install", "--prefix", str(parser), "--ignore-scripts", "--no-audit", "--no-fund", "typescript@6.0.3"])
        require(json.loads((parser / "node_modules/typescript/package.json").read_bytes())["version"] == "6.0.3", "exact parser required")
        os.environ["M5_TYPESCRIPT_ROOT"] = str(parser)
        os.environ["M6_TYPESCRIPT_ROOT"] = str(parser)
        raw_catalog = TARGET / "raw.json"
        semantic_dir = TARGET / "semantic"
        common = ["--oracle-root", str(ROOT / "oracle"), "--oracle-sha", "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7"]
        run("source-catalog", ["node", "scripts/export-kernel-m5-source-catalog.mjs", *common, "--output", str(raw_catalog)])
        run("semantic-catalog", ["node", "scripts/export-kernel-m6-semantic-catalog.mjs", *common, "--raw-catalog", str(raw_catalog), "--output-root", str(semantic_dir)])
        semantic_file = semantic_dir / "semantic-catalog-v1.json"
        bespoke_file = semantic_dir / "bespoke-clusters-v1.json"
        semantic_bytes = semantic_file.read_bytes()
        require(0 < len(semantic_bytes) <= 32 << 20, "complete semantic source bound")
        semantic = json.loads(semantic_bytes)
        require(len(semantic["behavior_units"]) == 9411 and semantic["oracle_sha"] == "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7", "complete source catalog identity differs")
        source_units = [unit for unit in semantic["behavior_units"] if unit["semantic"]["effect"].get("attribute") == "HitHealAttr"]
        require(len(source_units) == 14, "all fourteen damage/stat drain source units required")
        definitions = ROOT / "rust/fixtures/m9/engineering/complete-battle-definitions-v1.json"
        generator_stream = run("generator-build", ["cargo", "build", "--locked", "-p", "er-content-compiler", "--bin", "m9e-content", "--message-format=json"], ROOT / "rust")
        generator_rows = [json.loads(line) for line in generator_stream.splitlines() if line.startswith(b"{")]
        require([row.get("success") for row in generator_rows if row.get("reason") == "build-finished"] == [True], "complete compiler build required")
        generators = [row for row in generator_rows if row.get("reason") == "compiler-artifact" and row.get("executable")]
        require(len(generators) == 1, "one actual source compiler executable required")
        generator = generators[0]
        executable = Path(generator["executable"])
        require(generator["target"]["name"] == "m9e-content" and generator["target"]["kind"] == ["bin"]
                and generator["profile"]["opt_level"] == "0" and generator["profile"]["test"] is False
                and generator["profile"]["debug_assertions"] is True and generator["profile"]["overflow_checks"] is True
                and executable.parent == TARGET / "debug" and executable.is_file() and not executable.is_symlink(), "source compiler artifact/profile differs")
        generated = TARGET / "battle-content-pack-v3.json"
        run("compile-full-battle", [str(executable), str(definitions), str(semantic_file), str(bespoke_file), str(generated)])
        generated_bytes = generated.read_bytes()
        require(0 < len(generated_bytes) <= 32 << 20, "actual compiled battle pack bound")
        compiled = json.loads(generated_bytes)
        require(len(compiled["programs"]) == 3691 and len(compiled["classifications"]) == 9411, "exact static drain program admissions required")
        result["generated_content"] = {"battle_bytes": len(generated_bytes), "battle_sha256": sha(generated_bytes),
            "semantic_bytes": len(semantic_bytes), "semantic_sha256": sha(semantic_bytes), "definitions_sha256": sha(definitions.read_bytes()),
            "bespoke_sha256": sha(bespoke_file.read_bytes()), "source_units": [{"id": unit["id"], "operands": unit["semantic"]["operands"]} for unit in source_units],
            "generator_sha256": sha(executable.read_bytes()), "generator_bytes": executable.stat().st_size, "generator_profile": generator["profile"],
            "programs": 3691, "classifications": 9411, "parser_version": "6.0.3"}
        os.environ["M9E_DRAIN_BATTLE_PACK"] = str(generated)
        raw = run("proposal-build", ["cargo", "test", "--locked", *selector, "--no-run", "--message-format=json"], ROOT / "rust")
        rows = [json.loads(line) for line in raw.splitlines() if line.startswith(b"{")]
        require([row.get("success") for row in rows if row.get("reason") == "build-finished"] == [True], "complete successful Cargo artifact stream required")
        targets = json.loads(r'''{"m9e_move_drains":["actual_drain_minimum_one_and_maximum_hp_are_preserved","actual_drain_uses_capped_hp_loss_and_source_fraction","full_health_drain_does_not_emit_spurious_actor_hp_changes","immune_drain_neither_heals_nor_consumes_damage_variance","source_compiler_admits_thirteen_static_drains_and_preserves_original_programs"]}''')
        artifacts = [row for row in rows if row.get("reason") == "compiler-artifact" and row.get("executable")]
        require(len(artifacts) == 1 and {row["target"]["name"] for row in artifacts} == set(targets), "one exact whole target executable required")
        result["artifacts"] = []
        for artifact in sorted(artifacts, key=lambda row: row["target"]["name"]):
            name = artifact["target"]["name"]
            ids = targets[name]
            crate = "er-game"
            profile = artifact["profile"]
            binary = Path(artifact.get("executable") or "")
            require(artifact.get("manifest_path") == str(ROOT / ("rust/crates/" + crate + "/Cargo.toml"))
                    and artifact["target"]["src_path"] == str(ROOT / ("rust/crates/" + crate + "/tests/" + name + ".rs"))
                    and artifact["target"]["kind"] == ["test"] and artifact.get("features") == []
                    and profile["test"] is True and profile["opt_level"] == "0"
                    and profile["debug_assertions"] is True and profile["overflow_checks"] is True and profile["debuginfo"] == 0
                    and binary.is_absolute() and binary.parent == TARGET / "debug/deps"
                    and binary.is_file() and not binary.is_symlink() and binary.resolve() == binary
                    and re.fullmatch(re.escape(name) + r"-[0-9a-f]{16}", binary.name)
                    and 0 < binary.stat().st_size <= 128 << 20, "actual whole artifact/source/profile differs")
            listing = run(name + "-list", [str(binary), "--list", "--format", "terse"], ROOT / ("rust/crates/" + crate), maximum=16384)
            require(listing == "".join(test + ": test\n" for test in ids).encode(), "exact unfiltered target IDs required")
            binary_hash = sha(binary.read_bytes())
            result["artifacts"].append({"profile": profile, "target": artifact["target"], "manifest_path": artifact["manifest_path"],
                                       "path": str(binary), "bytes": binary.stat().st_size, "sha256": binary_hash,
                                       "ids": ids, "listing_bytes": len(listing), "listing_sha256": sha(listing)})
            output = run(name + "-execute", [str(binary), "--format", "terse"], ROOT / ("rust/crates/" + crate), maximum=16384)
            require(re.findall(rb"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
                    == [(str(len(ids)).encode(), b"0", b"0", b"0", b"0")], "every whole-target test must pass")
            require(sha(binary.read_bytes()) == binary_hash, "executed artifact changed")
            result["tests_executed"] += len(ids)
        require(result["tests_executed"] == 5, "all five whole drain tests required")
        result["tests"] = {"passed": 5, "failed": 0, "ignored": 0, "filtered": 0}
        require(sha((ROOT / SOURCE).read_bytes()) == DELTAS["after"][SOURCE], "lint changed reviewed source")
        for path, expected in result["source_hashes"].items():
            require(sha((ROOT / path).read_bytes()) == expected,
                    "bound source changed during lint: " + path)
        result["status"] = "passed"
    except Exception as error:
        result["first_failure"] = str(error)[:2048]
    finally:
        require(TARGET.resolve().parent == RUNNER and TARGET.name == "m9e-static-drain-target",
                "cleanup escaped owned runner root")
        cleanup_started = time.monotonic()
        try:
            cleanup = subprocess.run(
                ["python3", "-c", "import shutil,sys; shutil.rmtree(sys.argv[1])", str(TARGET)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20, check=False,
            )
            cleanup_ok = cleanup.returncode == 0
        except (subprocess.TimeoutExpired, OSError):
            cleanup_ok = False
        result["cleanup"] = {"target_removed": not TARGET.exists(), "success": cleanup_ok,
                             "limit_seconds": 20, "elapsed_ms": int((time.monotonic() - cleanup_started) * 1000)}
        result["elapsed_seconds"] = time.time() - START
        if not cleanup_ok or not result["cleanup"]["target_removed"] or time.time() > DEADLINE:
            result["status"] = "failed"
            result["first_failure"] = "cleanup or shared deadline failed"
        if result["status"] != "passed":
            failure = (result.get("first_failure", "lint qualification failed") + "\n").encode()
            if COMMANDS:
                failure += (OUT / "diagnostics" / (COMMANDS[-1]["name"] + ".log")).read_bytes()[-22000:]
            (OUT / "compact/failure.txt").write_bytes(failure[:24576])
        bounded_write(OUT / "compact/summary.json", result, 32768)
    raise SystemExit(0 if result["status"] == "passed" else 1)


if __name__ == "__main__":
    main()
