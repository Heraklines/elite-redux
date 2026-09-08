"""Remote-only qualification of two complete proposal ownership tests after stack-lifetime refactoring."""
import difflib
import hashlib
import json
import os
import re
from pathlib import Path
import signal
import subprocess
import time

BASE = "fa2525cdb158a5cfd0ab2f07c9b67719fa6d2c15"
SOURCE = "rust/crates/er-kernel/tests/m9e_current_proposal_v7.rs"
BEFORE = "0dd6491e64bac378e947f9f0faa4e1080a421b57f1ffb8261b42ad04083da36f"
AFTER = "0e8c3d8aa0e6083ccedb9529f797cedcda3dd8a163ca8f46310d484b1a497646"
CI = [".github/workflows/m9e-owned-proposal-stack-focused.yml",
      "scripts/ci/m9e_owned_proposal_stack_diagnostic.py"]
ROOT = Path.cwd().resolve()
RUNNER = Path(os.environ["RUNNER_TEMP"]).resolve()
OUT = RUNNER / "m9e-owned-proposal-stack"
TARGET = RUNNER / "m9e-owned-proposal-stack-target"
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
    result = {"status": "failed", "qualification": "two whole current proposal ownership tests; no complete M9 qualification",
              "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
              "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": BASE,
              "tests_executed": 0, "commands": COMMANDS}
    try:
        require(git("rev-parse", "HEAD").decode().strip() == result["source_sha"], "candidate HEAD differs")
        require(git("rev-parse", BASE + "^{commit}").decode().strip() == BASE, "exact failed full base required")
        paths = git("diff", "--name-only", BASE, "HEAD").decode().splitlines()
        require(sorted(paths) == sorted([SOURCE, *CI]), "candidate delta must be exactly repair plus two CI files")
        require(sha(git("show", BASE + ":" + SOURCE)) == BEFORE, "actual failed source differs")
        require(sha((ROOT / SOURCE).read_bytes()) == AFTER, "reviewed one-file repair differs")
        # The whole-tree delta already forbids every fixture modification. Retain
        # exact fixture tree metadata without reading any generated body here.
        result["fixture_tree_sha256"] = sha(git("ls-tree", "-r", "HEAD", "--", "rust/fixtures/m9/engineering"))
        require(not any(path.startswith("rust/fixtures/") for path in paths), "fixture source changed")
        pins = [SOURCE, *CI, "rust/Cargo.toml", "rust/Cargo.lock", "rust/rust-toolchain.toml",
                "rust/crates/er-kernel/Cargo.toml", "rust/crates/er-kernel/src/lib.rs"]
        result["source_hashes"] = {path: sha((ROOT / path).read_bytes()) for path in pins}
        for path in pins:
            if path not in [SOURCE, *CI]:
                require(sha(git("show", BASE + ":" + path)) == result["source_hashes"][path],
                        "unchanged compiler/source prerequisite differs: " + path)
        result["source_tree_sha256"] = sha(git("ls-tree", "-r", "HEAD", "--", "rust/crates/er-kernel"))
        run("toolchain-install", ["rustup", "toolchain", "install", "1.97.1", "--profile", "minimal",
                                  "--component", "rustfmt", "--component", "clippy"])
        rustc = run("rustc-version", ["rustc", "-Vv"], ROOT / "rust").decode()
        require("release: 1.97.1\n" in rustc and "host: x86_64-unknown-linux-gnu\n" in rustc,
                "actual pinned compiler/host differs")
        result["rustc"] = rustc
        original = (ROOT / SOURCE).read_bytes()
        run("rustfmt", ["rustfmt", "--edition", "2024", SOURCE])
        formatted = (ROOT / SOURCE).read_bytes()
        if original != formatted:
            patch = "".join(difflib.unified_diff(original.decode().splitlines(True),
                                                  formatted.decode().splitlines(True),
                                                  fromfile="a/" + SOURCE, tofile="b/" + SOURCE)).encode()
            require(len(patch) <= 262144, "named format patch exceeds bound")
            (OUT / "diagnostics/format.patch").write_bytes(patch)
            result["format_patch"] = {"bytes": len(patch), "sha256": sha(patch), "path": SOURCE,
                                      "before_sha256": sha(original), "after_sha256": sha(formatted)}
            raise RuntimeError("exact remote formatting correction required before lint qualification")
        profile_keys = ["CARGO_PROFILE_" + mode + "_" + field
                        for mode in ("DEV", "TEST")
                        for field in ("OPT_LEVEL", "DEBUG_ASSERTIONS", "OVERFLOW_CHECKS", "DEBUG")]
        result["profile_environment"] = {key: os.environ.get(key) for key in profile_keys}
        for key, value in result["profile_environment"].items():
            require(value == ("true" if key.endswith(("DEBUG_ASSERTIONS", "OVERFLOW_CHECKS")) else "0"),
                    "ordinary correctness profile differs")
        require(not os.environ.get("RUSTFLAGS") and not os.environ.get("CARGO_ENCODED_RUSTFLAGS"),
                "ambient compiler flags prohibited")
        selector = ["-p", "er-kernel", "--test", "m9e_current_proposal_v7"]
        run("proposal-clippy", ["cargo", "clippy", "--locked", *selector, "--no-deps", "--", "-D", "warnings"], ROOT / "rust")
        raw = run("proposal-build", ["cargo", "test", "--locked", *selector, "--no-run", "--message-format=json"], ROOT / "rust")
        rows = [json.loads(line) for line in raw.splitlines() if line.startswith(b"{")]
        require([row.get("success") for row in rows if row.get("reason") == "build-finished"] == [True], "complete successful Cargo artifact stream required")
        artifacts = [row for row in rows if row.get("reason") == "compiler-artifact" and row.get("target", {}).get("name") == "m9e_current_proposal_v7"]
        require(len(artifacts) == 1, "exact complete proposal artifact required")
        artifact = artifacts[0]
        profile = artifact["profile"]
        binary = Path(artifact.get("executable") or "")
        require(artifact.get("manifest_path") == str(ROOT / "rust/crates/er-kernel/Cargo.toml")
                and artifact["target"]["src_path"] == str(ROOT / SOURCE)
                and artifact["target"]["kind"] == ["test"] and artifact.get("features") == []
                and profile["test"] is True and profile["opt_level"] == "0"
                and profile["debug_assertions"] is True and profile["overflow_checks"] is True
                and profile["debuginfo"] == 0
                and binary.is_absolute() and binary.parent == TARGET / "debug/deps"
                and binary.is_file() and not binary.is_symlink() and binary.resolve() == binary
                and re.fullmatch(r"m9e_current_proposal_v7-[0-9a-f]{16}", binary.name)
                and 0 < binary.stat().st_size <= 128 << 20, "actual proposal artifact/source/profile differs")
        ids = ["current_proposal_publication_receipt_and_snapshot_conserve_ownership",
               "current_proposal_rejection_duplicate_and_terminal_are_transactional"]
        listing = run("proposal-list", [str(binary), "--list", "--format", "terse"], ROOT / "rust/crates/er-kernel", maximum=16384)
        require(listing == "".join(name + ": test\n" for name in ids).encode(), "two exact unfiltered target IDs required")
        binary_hash = sha(binary.read_bytes())
        result["artifact"] = {"profile": profile, "target": artifact["target"], "manifest_path": artifact["manifest_path"],
                              "path": str(binary), "bytes": binary.stat().st_size, "sha256": binary_hash,
                              "ids": ids, "listing_bytes": len(listing), "listing_sha256": sha(listing)}
        output = run("proposal-execute", [str(binary), "--format", "terse", "--nocapture", "--test-threads=1"], ROOT / "rust/crates/er-kernel", maximum=16384)
        require(re.findall(rb"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output) == [(b"2", b"0", b"0", b"0", b"0")], "both complete proposal tests must pass")
        require(sha(binary.read_bytes()) == binary_hash, "executed artifact changed")
        result["tests_executed"] = 2
        result["tests"] = {"passed": 2, "failed": 0, "ignored": 0, "filtered": 0}
        require(sha((ROOT / SOURCE).read_bytes()) == AFTER, "lint changed repaired source")
        for path, expected in result["source_hashes"].items():
            require(sha((ROOT / path).read_bytes()) == expected,
                    "bound source changed during lint: " + path)
        result["status"] = "passed"
    except Exception as error:
        result["first_failure"] = str(error)[:2048]
    finally:
        require(TARGET.resolve().parent == RUNNER and TARGET.name == "m9e-owned-proposal-stack-target",
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
