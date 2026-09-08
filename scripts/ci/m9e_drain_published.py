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

BASE = "ce47447f26eef093866f3424aa1377b64bde2ae3"
SOURCE = "rust/crates/er-game/tests/m9e_move_drains.rs"
CI = [".github/workflows/m9e-drain-published-focused.yml", "scripts/ci/m9e_drain_published.py"]
DELTAS = json.loads(r'''{"before":{"rust/crates/er-battle/src/m6/routine_executor.rs":"7e8803fbdce6d0f8413cd2d5bbd706c983313511eb56d71ed2dbd876c9edabcd","rust/crates/er-battle/src/m7_resolver.rs":"db8b2ed1e6152e6b4401663273ced1550cdd6fc8a6bdc0e10fe0bcd24c654e57","rust/crates/er-content-compiler/src/lib.rs":"6540d342bfa247de0b1aa34f6a580f1fe24b82c01c223207bf97952fa5b4a8f2","rust/crates/er-content-compiler/src/m9e_full_content.rs":"1ed03123f0f76d0be480836d067cab7a88e59ca6c7be7630b8ac60a16abb0808"},"after":{"rust/crates/er-battle/src/m6/routine_executor.rs":"6a2a63d103f4063e220294b51a06f2ec1daf8e3e5aa6e84b4db23b9b77296987","rust/crates/er-battle/src/m7_resolver.rs":"b95871b86145daa99b7e6e6b98c13943c7bc59a45706df3574a5f7b7bd874d9a","rust/crates/er-content-compiler/src/lib.rs":"f12b5faa7e62d84d70d038ec82e0f3151eabd47c845e4853ffe4b5d39a316d83","rust/crates/er-content-compiler/src/m9e_full_content.rs":"6f30654dc6f188e9940d6b014959622e26228e4b3a9f655587f7ef41a8c2ff50","rust/crates/er-content-compiler/src/m9e_move_drains.rs":"faaa210ca40488a80ddd36de7fa7c5af07011f0bc2e9b7f9d1a4262a83bf9630","rust/crates/er-game/tests/m9e_move_drains.rs":"95e29923db0f0237272516f30fef425a560acd9695204b2c812f4f1ee990a9d0"}}''')
QUALIFIED_PRODUCTION = json.loads(r'''{"rust/crates/er-battle/src/m7_resolver.rs":"b95871b86145daa99b7e6e6b98c13943c7bc59a45706df3574a5f7b7bd874d9a","rust/crates/er-content-compiler/src/lib.rs":"f12b5faa7e62d84d70d038ec82e0f3151eabd47c845e4853ffe4b5d39a316d83","rust/crates/er-content-compiler/src/m9e_full_content.rs":"6f30654dc6f188e9940d6b014959622e26228e4b3a9f655587f7ef41a8c2ff50","rust/crates/er-content-compiler/src/m9e_move_drains.rs":"faaa210ca40488a80ddd36de7fa7c5af07011f0bc2e9b7f9d1a4262a83bf9630","rust/crates/er-battle/src/m6/routine_executor.rs":"6a2a63d103f4063e220294b51a06f2ec1daf8e3e5aa6e84b4db23b9b77296987"}''')
PUBLISHED = json.loads(r'''{"rust/fixtures/m9/engineering/complete-progression-definitions-v1.json":{"bytes":3724089,"git_blob":"9d8a49da2746c5e5cf3b3eeddafdf67d7d23c7aa","sha256":"bba00376cae18feae56bebe38c5be0f1bb3aae3fd9a6e99e3ec7fa60a15de08f"},"rust/fixtures/m9/engineering/game-content-bundle-v2-manifest.json":{"bytes":1219,"git_blob":"062fcdc9016d38a29932c1852e70379859f05c1b","sha256":"793ac4bc98a74232850f7a1c124fd876c212a18e7db0afa2c15a65e33108502f"},"rust/fixtures/m9/engineering/game-content-bundle-v2.json":{"bytes":16335369,"git_blob":"cabb11ce9bc146b3a615bf334d5342d7b67528da","sha256":"a42bf206c6e9a848df5774e58c1f0190f562ceefb90f4dc07e97125eaf0ae6af"},"rust/fixtures/m9/engineering/progression-content-pack-v2.json":{"bytes":3576205,"git_blob":"e9c7ed41d2fa5be32d279a8cd9524a720e5f1665","sha256":"1864120e3130162bdd11c9370ae436140b0896a062fa10da9100445776bad17b"},"rust/fixtures/m9/engineering/progression-oracle-report-v2.json":{"bytes":510,"git_blob":"96ecd22adee9d85269d7f5cfe57927fd539aaa12","sha256":"64b4b759c46a897720230ffa0c87d73158d6ff69c2e18f4bdfb2d9c64408bec7"},"rust/fixtures/m9/engineering/battle-content-pack-v3.json":{"bytes":8093947,"git_blob":"a3cb39b2a30a404e799e04dfaacfee910a2eae0d","sha256":"19d02806cfd82a59814a8786a00a2d0e783b064651b74271d1d2bc8a685f2b5e"},"rust/fixtures/m9/engineering/run-content-pack-v3.json":{"bytes":1845,"git_blob":"6ca98567b96ce029c834a6e4adb1bc9880014077","sha256":"7286f3aa5e17189c46a70d9e6e46e51760efd7b577e120c0501c106e8a411004"}}''')
ROOT = Path.cwd().resolve()
RUNNER = Path(os.environ["RUNNER_TEMP"]).resolve()
OUT = RUNNER / "m9e-drain-published"
TARGET = RUNNER / "m9e-drain-published-target"
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


def main():
    require(re.fullmatch(r"[0-9]{10}", os.environ["M9E_STARTED_AT"]) and 0 <= time.time() - START < 1780, "precheckout shared budget required")
    require(os.name == "posix" and os.uname().machine == "x86_64", "Ubuntu x64 runner required")
    require(OUT.parent == RUNNER and TARGET.parent == RUNNER and not OUT.exists()
            and not TARGET.exists(), "fresh owned runner directories required")
    (OUT / "compact").mkdir(parents=True)
    (OUT / "diagnostics").mkdir()
    TARGET.mkdir()
    os.environ["CARGO_TARGET_DIR"] = str(TARGET)
    result = {"status": "failed", "qualification": "five whole drain tests on published source-generated content and current difficulty runtime; ordinary drains only, not full M9",
              "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
              "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": BASE,
              "tests_executed": 0, "commands": COMMANDS}
    try:
        require(git("rev-parse", "HEAD").decode().strip() == result["source_sha"], "candidate HEAD differs")
        require(git("rev-parse", BASE + "^{commit}").decode().strip() == BASE, "exact current difficulty integration base required")
        paths = git("diff", "--name-only", BASE, "HEAD").decode().splitlines()
        require(sorted(paths) == sorted([*DELTAS["after"], *CI, *[path for path in PUBLISHED if path.endswith(("battle-content-pack-v3.json", "run-content-pack-v3.json", "game-content-bundle-v2.json", "game-content-bundle-v2-manifest.json"))]]), "exact reviewed source delta required")
        for path, expected in DELTAS["before"].items():
            require(sha(git("show", BASE + ":" + path)) == expected, "baseline source differs: " + path)
        for path, expected in {**DELTAS["after"], **QUALIFIED_PRODUCTION}.items():
            require(sha((ROOT / path).read_bytes()) == expected, "reviewed source differs: " + path)
        # The exact delta allows only four audited published fixture replacements. Retain
        # exact fixture tree metadata without reading any generated body here.
        result["fixture_tree_sha256"] = sha(git("ls-tree", "-r", "HEAD", "--", "rust/fixtures/m9/engineering"))
        require({path for path in paths if path.startswith("rust/fixtures/")} <= set(PUBLISHED), "only exact published fixture paths may change")
        pins = [*DELTAS["after"], *QUALIFIED_PRODUCTION, *CI, "rust/Cargo.toml", "rust/Cargo.lock", "rust/rust-toolchain.toml",
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
        for key in ("M9E_DRAIN_BUNDLE", "M9E_DRAIN_BATTLE_PACK", "M9E_DRAIN_EXPORT"):
            require(not os.environ.get(key), "published fixture must load without override")
        published = {}
        for path, expected in PUBLISHED.items():
            file = ROOT / path
            require(file.is_file() and not file.is_symlink() and file.stat().st_size == expected["bytes"], "regular exact published fixture required")
            data = file.read_bytes()
            require(sha(data) == expected["sha256"] and hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest() == expected["git_blob"], "audited published content differs")
            published[path] = expected
        result["published_content"] = {"source_sha":"32a5c987c9767c9c6e87ff57e2bce6dced0ffb46", "files":published,
            "loaded_without_override":True, "whole_target_expected":5}
        raw = run("proposal-build", ["cargo", "test", "--locked", *selector, "--no-run", "--message-format=json"], ROOT / "rust")
        rows = [json.loads(line) for line in raw.splitlines() if line.startswith(b"{")]
        require([row.get("success") for row in rows if row.get("reason") == "build-finished"] == [True], "complete successful Cargo artifact stream required")
        targets = json.loads(r'''{"m9e_move_drains":["actual_drain_minimum_one_and_maximum_hp_are_preserved","actual_drain_uses_capped_hp_loss_and_source_fraction","full_health_drain_does_not_emit_spurious_actor_hp_changes","immune_drain_neither_heals_nor_consumes_damage_variance","source_compiler_admits_twelve_unconditional_drains_and_preserves_other_units"]}''')
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
        resolver = ROOT / "rust/crates/er-battle/src/m7_resolver.rs"
        positive = resolver.read_bytes()
        needle = b"actor.hp += u32::try_from(amount).map_err(|_| BattleV5Error::Overflow)?;"
        require(positive.count(needle) == 1, "one exact drain HP update required")
        negative = positive.replace(needle, b"actor.hp += 0 * u32::try_from(amount).map_err(|_| BattleV5Error::Overflow)?;")
        result["negative_control"] = {
            "mutation": "disable only the actual drain HP increment",
            "path": str(resolver.relative_to(ROOT)),
            "positive_source_sha256": sha(positive), "negative_source_sha256": sha(negative),
            "expected_failed_ids": ["actual_drain_minimum_one_and_maximum_hp_are_preserved",
                                    "actual_drain_uses_capped_hp_loss_and_source_fraction"],
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
                output = run(mode + "-execute", [str(binary), "--format", "terse"], ROOT / "rust/crates/er-game", maximum=16384,
                             expected_codes=(101,) if mode == "negative" else (0,))
                expected = [(b"3", b"2", b"0", b"0", b"0")] if mode == "negative" else [(b"5", b"0", b"0", b"0", b"0")]
                require(re.findall(rb"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output) == expected, "exact whole control result required")
                failures = sorted(value.decode() for value in re.findall(rb"^([A-Za-z][A-Za-z0-9_:]+) --- FAILED$", output, re.M))
                require(failures == (result["negative_control"]["expected_failed_ids"] if mode == "negative" else []), "only causal healing assertions may fail")
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
        for path, expected in PUBLISHED.items():
            require(sha((ROOT / path).read_bytes()) == expected["sha256"], "published fixture changed during execution")
        result["status"] = "passed"
    except Exception as error:
        result["first_failure"] = str(error)[:2048]
    finally:
        require(TARGET.resolve().parent == RUNNER and TARGET.name == "m9e-drain-published-target",
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
