"""Remote qualification of source-generated static damage recoils and actual turn resolution."""
import difflib
import hashlib
import json
import os
import re
from pathlib import Path
import signal
import subprocess
import time

BASE = "339af2ce53399d1f5e3aec6ff045c71292946293"
SOURCE = "rust/crates/er-game/tests/m9e_move_recoil.rs"
CI = [".github/workflows/m9e-recoil-baseline-focused.yml", "scripts/ci/m9e_recoil_baseline.py"]
DELTAS = json.loads(r'''{"before":{"rust/crates/er-game/tests/m9e_move_recoil.rs":"34d43c19eee89efb99ac218e615613ebea64b3ace0f46c853b7caf59990bd9ea"},"after":{"rust/crates/er-game/tests/m9e_move_recoil.rs":"fce4396029cbf1ff576efc0220524fe392c636d7dd42936a80fb56d390d29102"}}''')
ROOT = Path.cwd().resolve()
RUNNER = Path(os.environ["RUNNER_TEMP"]).resolve()
OUT = RUNNER / "m9e-recoil-baseline"
TARGET = RUNNER / "m9e-recoil-baseline-target"
START = float(os.environ["M9E_STARTED_AT"])
DEADLINE = START + 1800
COMMANDS = []


def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def bounded_write(path, value, maximum):
    raw = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    require(len(raw) <= maximum, "compact result exceeds unchanged bound")
    path.write_bytes(raw)


def run(name, argv, cwd=ROOT, maximum=8 << 20, expected_codes=(0,)):
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
    require(reason is None and process.returncode in expected_codes, reason or name + " failed")
    require(time.time() <= DEADLINE, "shared deadline exhausted after " + name)
    return raw


def git(*args):
    name = "git-" + str(len(COMMANDS))
    return run(name, ["git", *args])


def export_facts(directory):
    names = ["battle-content-pack-v3.json", "run-content-pack-v3.json",
             "game-content-bundle-v2.json", "game-content-bundle-v2-manifest.json"]
    require(directory.is_dir() and sorted(path.name for path in directory.iterdir()) == sorted(names), "exact four serialized export files")
    files = {}
    decoded = {}
    for name in names:
        path = directory / name
        require(path.is_file() and not path.is_symlink() and 0 < path.stat().st_size <= 32 << 20, "bounded actual export")
        raw = path.read_bytes()
        files[name] = {"bytes": len(raw), "sha256": sha(raw),
                       "git_blob": hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()}
        decoded[name] = json.loads(raw)
    bundle = decoded["game-content-bundle-v2.json"]
    require(decoded["battle-content-pack-v3.json"] == bundle["battle"] and decoded["run-content-pack-v3.json"] == bundle["run"], "exported components match complete serialized bundle")
    manifest = decoded["game-content-bundle-v2-manifest.json"]
    require(manifest["content_hash"] == bundle["content_hash"] and manifest["components"]["battle"] == bundle["battle"]["content_hash"] and manifest["components"]["run"] == bundle["run"]["content_hash"], "actual complete bundle manifest cross-binding")
    return {"files": files, "identity": {"bundle_hash": bundle["content_hash"], "battle_hash": bundle["battle"]["content_hash"],
            "run_hash": bundle["run"]["content_hash"], "progression_hash": bundle["progression"]["content_hash"]}}

def main():
    require(re.fullmatch(r"[0-9]{10}", os.environ["M9E_STARTED_AT"]) and 0 <= time.time() - START < 1780, "precheckout shared budget required")
    require(os.name == "posix" and os.uname().machine == "x86_64", "Ubuntu x64 runner required")
    require(OUT.parent == RUNNER and TARGET.parent == RUNNER and not OUT.exists()
            and not TARGET.exists(), "fresh owned runner directories required")
    (OUT / "compact").mkdir(parents=True)
    (OUT / "diagnostics").mkdir()
    TARGET.mkdir()
    os.environ["CARGO_TARGET_DIR"] = str(TARGET)
    result = {"status": "failed", "qualification": "five whole source-generated static recoil tests; six binary-exact ordinary recoil admissions only; decimal/HP-based variants, ability/item interactions, and full M9 remain unqualified",
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
        pins = [*DELTAS["after"], *CI,
                "rust/crates/er-battle/src/m7_resolver.rs", "rust/crates/er-content-compiler/src/lib.rs",
                "rust/crates/er-content-compiler/src/m9e_full_content.rs", "rust/crates/er-content-compiler/src/m9e_move_recoil.rs", "rust/Cargo.toml", "rust/Cargo.lock", "rust/rust-toolchain.toml",
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
        selector = ["-p", "er-game", "--test", "m9e_move_recoil"]
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
        source_units = [unit for unit in semantic["behavior_units"] if unit["semantic"]["effect"].get("attribute") == "RecoilAttr"]
        require(len(source_units) == 14, "all fourteen damage/stat recoil source units required")
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
        require(len(compiled["programs"]) == 3697 and len(compiled["classifications"]) == 9411, "exact static recoil program admissions required")
        result["generated_content"] = {"battle_bytes": len(generated_bytes), "battle_sha256": sha(generated_bytes),
            "semantic_bytes": len(semantic_bytes), "semantic_sha256": sha(semantic_bytes), "definitions_sha256": sha(definitions.read_bytes()),
            "bespoke_sha256": sha(bespoke_file.read_bytes()), "source_units": [{"id": unit["id"], "operands": unit["semantic"]["operands"]} for unit in source_units],
            "generator_sha256": sha(executable.read_bytes()), "generator_bytes": executable.stat().st_size, "generator_profile": generator["profile"],
            "programs": 3697, "classifications": 9411, "parser_version": "6.0.3"}
        os.environ["M9E_RECOIL_BATTLE_PACK"] = str(generated)
        os.environ["M9E_RECOIL_BASELINE_EXPORT"] = str(OUT / "compact/recoil-baseline.json")
        os.environ["M9E_RECOIL_EXPORT"] = str(OUT / "exports")
        raw = run("proposal-build", ["cargo", "test", "--locked", *selector, "--no-run", "--message-format=json"], ROOT / "rust")
        rows = [json.loads(line) for line in raw.splitlines() if line.startswith(b"{")]
        require([row.get("success") for row in rows if row.get("reason") == "build-finished"] == [True], "complete successful Cargo artifact stream required")
        targets = json.loads(r'''{"m9e_move_recoil":["actual_recoil_minimum_one_and_actor_faint_are_preserved","actual_recoil_uses_capped_hp_loss_and_source_fraction","immune_recoil_neither_hurts_nor_consumes_damage_variance","recoil_damage_queries_preserve_actual_turn_and_borrowed_state","source_compiler_admits_six_exact_recoils_and_preserves_all_prior_units"]}''')
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
        require(result["tests_executed"] == 5, "all five whole recoil tests required")
        result["tests"] = {"passed": 5, "failed": 0, "ignored": 0, "filtered": 0}
        os.environ.pop("M9E_RECOIL_BASELINE_EXPORT")
        baseline_raw = (OUT / "compact/recoil-baseline.json").read_bytes()
        require(0 < len(baseline_raw) <= 32768, "bounded durable baseline metadata")
        baseline = json.loads(baseline_raw)
        require(baseline["program_count"] == 3691 and baseline["classification_count"] == 9411 and len(baseline["admitted_classifications"]) == 6, "actual complete original baseline")
        result["baseline_metadata"] = {"bytes": len(baseline_raw), "sha256": sha(baseline_raw)}
        result["serialized_exports"] = export_facts(OUT / "exports")
        os.environ.pop("M9E_RECOIL_BATTLE_PACK")
        os.environ["M9E_RECOIL_BUNDLE"] = str(OUT / "exports/game-content-bundle-v2.json")
        os.environ["M9E_RECOIL_EXPORT"] = str(TARGET / "export-full-bundle")
        full_output = run("full-bundle-execute", [str(binary), "--format", "terse"], ROOT / "rust/crates/er-game", maximum=16384)
        require(re.findall(rb"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", full_output) == [(b"5", b"0", b"0", b"0", b"0")], "all five actual serialized full-bundle tests")
        require(export_facts(TARGET / "export-full-bundle") == result["serialized_exports"] and sha(binary.read_bytes()) == binary_hash, "same full-bundle byte images and executable")
        result["full_bundle_execution"] = {"tests": 5, "failed": 0, "skipped": 0, "battle_pack_override": False,
            "output_bytes": len(full_output), "output_sha256": sha(full_output), "artifact_sha256": binary_hash,
            "bundle_sha256": result["serialized_exports"]["files"]["game-content-bundle-v2.json"]["sha256"]}
        resolver = ROOT / "rust/crates/er-battle/src/m7_resolver.rs"
        positive = resolver.read_bytes()
        needle = b"actor.hp -= u32::try_from(amount).map_err(|_| BattleV5Error::Overflow)?;"
        require(positive.count(needle) == 1, "one exact recoil HP update required")
        negative = positive.replace(needle, b"actor.hp -= 0 * u32::try_from(amount).map_err(|_| BattleV5Error::Overflow)?;")
        result["negative_control"] = {
            "mutation": "disable only the actual recoil HP decrement",
            "path": str(resolver.relative_to(ROOT)),
            "positive_source_sha256": sha(positive), "negative_source_sha256": sha(negative),
            "expected_failed_ids": ["actual_recoil_minimum_one_and_actor_faint_are_preserved",
                                    "actual_recoil_uses_capped_hp_loss_and_source_fraction"],
        }
        resolver.write_bytes(negative)
        try:
            for mode in ("negative", "restored"):
                if mode == "restored":
                    resolver.write_bytes(positive)
                build = run(mode + "-build", ["cargo", "test", "--locked", *selector, "--no-run", "--message-format=json"], ROOT / "rust")
                stream = [json.loads(line) for line in build.splitlines() if line.startswith(b"{")]
                require([row.get("success") for row in stream if row.get("reason") == "build-finished"] == [True], "complete control build required")
                control_artifacts = [row for row in stream if row.get("reason") == "compiler-artifact" and row.get("executable")]
                require(len(control_artifacts) == 1, "one actual control executable required")
                actual = control_artifacts[0]
                reference = result["artifacts"][0]
                require(actual["target"] == reference["target"] and actual["profile"] == reference["profile"]
                        and actual["manifest_path"] == reference["manifest_path"]
                        and actual["executable"] == reference["path"] and actual["features"] == [], "control source/profile/target differs")
                binary = Path(actual["executable"])
                require(binary.resolve().is_relative_to(TARGET.resolve()) and 0 < binary.stat().st_size <= 128 << 20, "bounded control executable required")
                binary_hash = sha(binary.read_bytes())
                listing = run(mode + "-list", [str(binary), "--list", "--format", "terse"], ROOT / "rust/crates/er-game", maximum=16384)
                require(sha(listing) == reference["listing_sha256"] and len(listing) == reference["listing_bytes"], "all five unchanged control IDs required")
                os.environ["M9E_RECOIL_EXPORT"] = str(TARGET / ("export-" + mode))
                output = run(mode + "-execute", [str(binary), "--format", "terse"], ROOT / "rust/crates/er-game", maximum=16384,
                             expected_codes=(101,) if mode == "negative" else (0,))
                require(export_facts(TARGET / ("export-" + mode)) == result["serialized_exports"], "actual four exports conserved across runtime mutation and restoration")
                expected = [(b"3", b"2", b"0", b"0", b"0")] if mode == "negative" else [(b"5", b"0", b"0", b"0", b"0")]
                require(re.findall(rb"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output) == expected, "exact whole control result required")
                failures = sorted(value.decode() for value in re.findall(rb"^([A-Za-z][A-Za-z0-9_:]+) --- FAILED$", output, re.M))
                require(failures == (result["negative_control"]["expected_failed_ids"] if mode == "negative" else []), "only causal recoil assertions may fail")
                require(sha(binary.read_bytes()) == binary_hash, "control executable changed during execution")
                require((binary_hash != reference["sha256"]) if mode == "negative" else (binary_hash == reference["sha256"]), "control/restoration binary identity differs")
                result["negative_control"][mode] = {"artifact_sha256": binary_hash, "artifact_bytes": binary.stat().st_size,
                    "profile": actual["profile"], "source_sha256": sha(resolver.read_bytes()), "ids": reference["ids"],
                    "failed_ids": failures, "tests_executed": 5, "output_bytes": len(output), "output_sha256": sha(output)}
            result["negative_control"]["status"] = "passed"
        finally:
            resolver.write_bytes(positive)
        require(sha((ROOT / SOURCE).read_bytes()) == DELTAS["after"][SOURCE], "lint changed reviewed source")
        for path, expected in result["source_hashes"].items():
            require(sha((ROOT / path).read_bytes()) == expected,
                    "bound source changed during lint: " + path)
        result["status"] = "passed"
    except Exception as error:
        result["first_failure"] = str(error)[:2048]
    finally:
        require(TARGET.resolve().parent == RUNNER and TARGET.name == "m9e-recoil-baseline-target",
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
