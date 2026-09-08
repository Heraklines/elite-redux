"""Remote-only qualification of actual captured run difficulty across runtime boundaries."""
import difflib
import hashlib
import json
import os
import re
from pathlib import Path
import signal
import subprocess
import time

BASE = "af3e7824ba7c204a48a5ba9d1123f37736cadd8c"
SOURCE = "rust/crates/er-game/tests/m9e_run_difficulty.rs"
CI = [".github/workflows/m9e-run-difficulty-focused.yml", "scripts/ci/m9e_run_difficulty_diagnostic.py"]
DELTAS = json.loads(r'''{"after":{"rust/crates/er-game/src/m9e_material_v6.rs":"7ebefdf8fd78878154564554a1d566b02246578a6d22198e9540a7a0f6add835","rust/crates/er-game/src/m9e_new_run_v6.rs":"0dbd2ace8ff9e6d4b064b0279bfc90bbb587051e37782a8837760de1de63ec44","rust/crates/er-game/src/m9e_runtime_v6.rs":"b910e8a9a708942ea4df944106204817f9664dae83c320fa7eb962a00a1e6327","rust/crates/er-game/tests/m9e_material_retention.rs":"7ae7c17c0be080b5f6bfe19d5012c04369003a22e2dfa4d2794b76d0f804db5b","rust/crates/er-game/tests/m9e_run_difficulty.rs":"4856b0ffa97c572dee0a22f05c4d01b51a161e9c30f7693050db22653447acb7","rust/crates/er-game/tests/m9e_runtime_v6.rs":"f8d05269eb16f3d017ced44f8b70c03dd2a9dd7d2522077127535aa853130ff7","rust/crates/er-kernel/tests/m9e_material_retention_v7.rs":"96d5746d55c11dbda1e14e6ce94d2e918aadf15d3d2773c14c43e1b78585bd74","rust/crates/er-kernel/tests/m9e_snapshot_v7.rs":"1ad4f345710c3ee4bd8333ce5b5d089a4838a5338efce32d37cf6ef8c249b70f","rust/crates/er-save/src/m9e_save_v2.rs":"4ce731b6dff6078339c7fa1ceb624f505ed961720ed00005389253d09865b5f8","rust/crates/er-state/src/m9e_state_v6.rs":"6e0937529780f4cb50c65122173a68820c4823bdfb9569ff8b46583cf9d8e9fb","rust/crates/er-game/tests/m9e_material_v6.rs":"346b30f656a1934e250aa217585139ad8d816b4a5b99c7c5f7e183498b068135","rust/crates/er-game/tests/m9e_content_v2.rs":"949be46f3f140e7250ac87b97b12552560533d4e1e4d61e4e363f2143a78fe47"},"before":{"rust/crates/er-state/src/m9e_state_v6.rs":"c14440b7e248256288f65712c9f660cb1f69a572666ede9597f271d2f54e627f","rust/crates/er-game/src/m9e_new_run_v6.rs":"b854bdc3decbecce6d3f75eee194d1f187facf3a79c5edc2cd0fa6e2a3ac1478","rust/crates/er-game/src/m9e_runtime_v6.rs":"8b7915641190ab9de735a42c3cf2e67a95e9abad4fc9b778dc3e6180350f7ed6","rust/crates/er-game/src/m9e_material_v6.rs":"923b991279112c390c787768a44860f1ac57174f59782e5a39387ebca836ad0f","rust/crates/er-game/tests/m9e_runtime_v6.rs":"97f208d8d77d6afb99c7bee19c8d36914c700fc4c20b82fa60d1f695f4f05c34","rust/crates/er-game/tests/m9e_material_retention.rs":"33cdf461523dbe13ca38582f73e8175d64cd62cf367682af3c1d6168aa0c38f4","rust/crates/er-save/src/m9e_save_v2.rs":"cabb1d0de57778aa82aa77423f73e2156987296d0e2e849f38ae334026f37b5b","rust/crates/er-kernel/tests/m9e_material_retention_v7.rs":"48599e1eef12df8fc3e418f5dd619c8aab96a5d37fd0096b915288781e72f7de","rust/crates/er-kernel/tests/m9e_snapshot_v7.rs":"be5f4fbe18665b09b36e5a53f10ea5d38140e200ec0604577f29affed322de1c","rust/crates/er-game/tests/m9e_material_v6.rs":"bff3f3c6e3d4365e3ab9522d842cbd6191b03214d1f6cd6bd1438e20c467ba51","rust/crates/er-game/tests/m9e_content_v2.rs":"c7a2278f7cb8bdaa4699168bfe5ea64f76e9e00898791891cd9154c3b1d6c1b2"}}''')
ROOT = Path.cwd().resolve()
RUNNER = Path(os.environ["RUNNER_TEMP"]).resolve()
OUT = RUNNER / "m9e-run-difficulty"
TARGET = RUNNER / "m9e-run-difficulty-target"
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
    result = {"status": "failed", "qualification": "four natural run difficulty ownership tests; not complete M9 qualification",
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
                "rust/crates/er-game/Cargo.toml", "rust/crates/er-game/src/lib.rs"]
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
        result["state_literal_sources"] = sorted(str(path.relative_to(ROOT)) for path in (ROOT / "rust/crates").rglob("*.rs") if b"GameStateV6 {" in path.read_bytes())
        originals = {path: (ROOT / path).read_bytes() for path in DELTAS["after"] if path.endswith(".rs")}
        run("rustfmt", ["rustfmt", "--edition", "2024", *originals])
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
        selector = ["-p", "er-game", "--test", "m9e_run_difficulty"]
        run("proposal-clippy", ["cargo", "clippy", "--locked", "-p", "er-game", "--tests", "--no-deps", "--", "-D", "warnings"], ROOT / "rust")
        raw = run("proposal-build", ["cargo", "test", "--locked", *selector, "--no-run", "--message-format=json"], ROOT / "rust")
        rows = [json.loads(line) for line in raw.splitlines() if line.startswith(b"{")]
        require([row.get("success") for row in rows if row.get("reason") == "build-finished"] == [True], "complete successful Cargo artifact stream required")
        artifacts = [row for row in rows if row.get("reason") == "compiler-artifact" and row.get("target", {}).get("name") == "m9e_run_difficulty"]
        require(len(artifacts) == 1, "exact complete proposal artifact required")
        artifact = artifacts[0]
        profile = artifact["profile"]
        binary = Path(artifact.get("executable") or "")
        require(artifact.get("manifest_path") == str(ROOT / "rust/crates/er-game/Cargo.toml")
                and artifact["target"]["src_path"] == str(ROOT / "rust/crates/er-game/tests/m9e_run_difficulty.rs")
                and artifact["target"]["kind"] == ["test"] and artifact.get("features") == []
                and profile["test"] is True and profile["opt_level"] == "0"
                and profile["debug_assertions"] is True and profile["overflow_checks"] is True
                and profile["debuginfo"] == 0
                and binary.is_absolute() and binary.parent == TARGET / "debug/deps"
                and binary.is_file() and not binary.is_symlink() and binary.resolve() == binary
                and re.fullmatch(r"m9e_run_difficulty-[0-9a-f]{16}", binary.name)
                and 0 < binary.stat().st_size <= 128 << 20, "actual proposal artifact/source/profile differs")
        ids = ["historical_absence_remains_unknown_and_canonical_on_save_restore", "malformed_completed_selection_and_wrong_run_ownership_are_rejected", "natural_choices_survive_material_save_restore_and_continued_dispatch", "same_run_material_cannot_change_erase_or_invent_difficulty"]
        listing = run("proposal-list", [str(binary), "--list", "--format", "terse"], ROOT / "rust/crates/er-game", maximum=16384)
        require(listing == "".join(name + ": test\n" for name in ids).encode(), "four exact unfiltered target IDs required")
        binary_hash = sha(binary.read_bytes())
        result["artifact"] = {"profile": profile, "target": artifact["target"], "manifest_path": artifact["manifest_path"],
                              "path": str(binary), "bytes": binary.stat().st_size, "sha256": binary_hash,
                              "ids": ids, "listing_bytes": len(listing), "listing_sha256": sha(listing)}
        output = run("proposal-execute", [str(binary), "--format", "terse"], ROOT / "rust/crates/er-game", maximum=16384)
        require(re.findall(rb"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output) == [(b"4", b"0", b"0", b"0", b"0")], "all four whole difficulty target tests must pass")
        require(sha(binary.read_bytes()) == binary_hash, "executed artifact changed")
        result["tests_executed"] = 4
        result["tests"] = {"passed": 4, "failed": 0, "ignored": 0, "filtered": 0}
        require(sha((ROOT / SOURCE).read_bytes()) == DELTAS["after"][SOURCE], "lint changed reviewed source")
        for path, expected in result["source_hashes"].items():
            require(sha((ROOT / path).read_bytes()) == expected,
                    "bound source changed during lint: " + path)
        result["status"] = "passed"
    except Exception as error:
        result["first_failure"] = str(error)[:2048]
    finally:
        require(TARGET.resolve().parent == RUNNER and TARGET.name == "m9e-run-difficulty-target",
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
