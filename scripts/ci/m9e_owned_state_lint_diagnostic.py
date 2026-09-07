"""Remote-only, source-bound lint repair qualification; executes no native tests."""
import difflib
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time

BASE = "2ece328920b4eaf30ce1a94e903d55b74e1607b8"
SOURCE = "rust/crates/er-state/src/m9e_state_v6.rs"
BEFORE = "ed7781bb1bf2a1c59fe96f7fe6916ee023ea3d5397ecdc06e98ef8a3e832e37e"
AFTER = "c14440b7e248256288f65712c9f660cb1f69a572666ede9597f271d2f54e627f"
CI = [".github/workflows/m9e-owned-state-lint-focused.yml",
      "scripts/ci/m9e_owned_state_lint_diagnostic.py"]
ROOT = Path.cwd().resolve()
RUNNER = Path(os.environ["RUNNER_TEMP"]).resolve()
OUT = RUNNER / "m9e-owned-state-lint"
TARGET = RUNNER / "m9e-owned-state-lint-target"
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


def run(name, argv, cwd=ROOT):
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
            if time.monotonic() >= limit or log.stat().st_size > 8 * 1024 * 1024:
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
    require(os.name == "posix" and os.uname().machine == "x86_64", "Ubuntu x64 runner required")
    require(OUT.parent == RUNNER and TARGET.parent == RUNNER and not OUT.exists()
            and not TARGET.exists(), "fresh owned runner directories required")
    (OUT / "compact").mkdir(parents=True)
    (OUT / "diagnostics").mkdir()
    TARGET.mkdir()
    os.environ["CARGO_TARGET_DIR"] = str(TARGET)
    result = {"status": "failed", "qualification": "focused source lint only; no native or platform execution",
              "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
              "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": BASE,
              "tests_executed": 0, "commands": COMMANDS}
    try:
        require(git("rev-parse", "HEAD").decode().strip() == result["source_sha"], "candidate HEAD differs")
        require(git("rev-parse", "HEAD^").decode().strip() == BASE, "exact failed full parent required")
        paths = git("diff", "--name-only", BASE, "HEAD").decode().splitlines()
        require(sorted(paths) == sorted([SOURCE, *CI]), "candidate delta must be exactly repair plus two CI files")
        require(sha(git("show", BASE + ":" + SOURCE)) == BEFORE, "actual failed source differs")
        require(sha((ROOT / SOURCE).read_bytes()) == AFTER, "reviewed one-file repair differs")
        # The whole-tree delta already forbids every fixture modification. Retain
        # exact fixture tree metadata without reading any generated body here.
        result["fixture_tree_sha256"] = sha(git("ls-tree", "-r", "HEAD", "--", "rust/fixtures/m9/engineering"))
        require(not any(path.startswith("rust/fixtures/") for path in paths), "fixture source changed")
        pins = [SOURCE, *CI, "rust/Cargo.toml", "rust/Cargo.lock", "rust/rust-toolchain.toml",
                "rust/crates/er-state/Cargo.toml", "rust/crates/er-state/src/lib.rs"]
        result["source_hashes"] = {path: sha((ROOT / path).read_bytes()) for path in pins}
        for path in pins:
            if path not in [SOURCE, *CI]:
                require(sha(git("show", BASE + ":" + path)) == result["source_hashes"][path],
                        "unchanged compiler/source prerequisite differs: " + path)
        result["source_tree_sha256"] = sha(git("ls-tree", "-r", "HEAD", "--", "rust/crates/er-state"))
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
        raw = run("state-all-targets-clippy", ["cargo", "clippy", "--locked", "--all-targets", "--no-deps",
                                              "-p", "er-state", "--message-format=json", "--", "-D", "warnings"],
                  ROOT / "rust")
        artifacts = []
        for line in raw.splitlines():
            if not line.startswith(b"{"):
                continue
            message = json.loads(line)
            if message.get("reason") == "compiler-artifact" and message.get("target", {}).get("name") == "er_state":
                profile = message["profile"]
                require(profile["opt_level"] == "0" and profile["debug_assertions"] is True,
                        "actual er-state compiler artifact profile differs")
                artifacts.append({"target": message["target"], "profile": profile,
                                  "package_id": message["package_id"]})
        require(artifacts and any(item["profile"]["test"] for item in artifacts), "actual all-target er-state artifacts absent")
        result["compiler_artifacts"] = artifacts
        require(sha((ROOT / SOURCE).read_bytes()) == AFTER, "lint changed repaired source")
        for path, expected in result["source_hashes"].items():
            require(sha((ROOT / path).read_bytes()) == expected,
                    "bound source changed during lint: " + path)
        result["status"] = "passed"
    except Exception as error:
        result["first_failure"] = str(error)[:2048]
    finally:
        require(TARGET.resolve().parent == RUNNER and TARGET.name == "m9e-owned-state-lint-target",
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
