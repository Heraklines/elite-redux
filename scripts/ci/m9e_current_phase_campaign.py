"""Complete natural campaigns on the exact current-phase qualification SHA."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

import m9e_current_phase_diagnostic as diagnostic

BASE = diagnostic.BASE
BRANCH = diagnostic.BRANCH
OWNED = set(diagnostic.DELTAS["after"]) | set(diagnostic.CI)
CASES = {
    "coop": (
        "er-kernel",
        "m9e_natural_coop_campaign_v7",
        "natural_owned_cooperative_campaign_reaches_wave_200_victory",
    ),
    "replay": (
        "er-repro",
        "m9e_natural_campaign_replay",
        "natural_current_campaign_replays_every_external_input_and_resumes_to_wave_200",
    ),
}
ROOT = Path(__file__).resolve().parents[2]
START = float(os.environ["M9E_STARTED_AT"])
DEADLINE = START + 1980
COMMANDS = []


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def run(name, argv, out, cwd=ROOT, maximum_seconds=600):
    remaining = DEADLINE - time.time() - 30
    require(remaining > 0, "shared campaign deadline")
    begun = time.monotonic()
    try:
        completed = subprocess.run(
            argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            timeout=min(maximum_seconds, remaining), check=False,
        )
        output, code = completed.stdout, completed.returncode
    except subprocess.TimeoutExpired as error:
        output, code = error.stdout or b"", -1
    require(len(output) <= 8 << 20, name + " exceeded bounded remote log")
    row = {
        "name": name, "argv": argv, "returncode": code,
        "elapsed_ms": int((time.monotonic() - begun) * 1000),
        "log_bytes": len(output), "log_sha256": sha(output),
    }
    COMMANDS.append(row)
    (out / "diagnostics" / (name + ".log")).write_bytes(output)
    return output, row


def main(case):
    out = Path(os.environ["RUNNER_TEMP"]).resolve() / ("m9e-current-phase-" + case)
    (out / "compact").mkdir(parents=True)
    (out / "diagnostics").mkdir()
    result = {
        "status": "failed", "case": case, "source_sha": os.environ["GITHUB_SHA"],
        "base_sha": BASE, "branch": os.environ["GITHUB_REF_NAME"],
        "scope": "one complete natural campaign target on the integrated candidate SHA; aggregate requires every parallel job",
        "commands": COMMANDS, "test_passed": False,
        "harness_sha256": sha(Path(__file__).read_bytes()),
    }
    try:
        require(case in CASES, "unknown campaign case")
        require(os.environ["GITHUB_REPOSITORY"] == "Heraklines/elite-redux", "repository")
        require(os.environ["GITHUB_REF"] == "refs/heads/" + BRANCH, "isolated source branch")
        require(os.environ["GITHUB_EVENT_NAME"] == "push", "push identity")
        require(0 <= time.time() - START < 1780, "precheckout campaign budget")
        require(os.name == "posix" and os.uname().machine == "x86_64", "Ubuntu x64")
        require(not any(os.environ.get(key) for key in (
            "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUST_MIN_STACK", "RUST_TEST_THREADS",
        )), "ambient Rust flags")
        head, row = run("head", ["git", "rev-parse", "HEAD"], out)
        require(row["returncode"] == 0 and head.decode().strip() == result["source_sha"], "exact HEAD")
        fetched, row = run("base-fetch", ["git", "fetch", "--no-tags", "--depth=1", "origin", BASE], out)
        require(row["returncode"] == 0, "exact baseline source fetch")
        delta, row = run("delta", ["git", "diff", "--name-only", BASE, "HEAD"], out)
        require(row["returncode"] == 0 and set(delta.decode().splitlines()) == OWNED, "exact reviewed source delta")
        for path, expected in diagnostic.DELTAS["before"].items():
            raw = subprocess.check_output(["git", "show", BASE + ":" + path], cwd=ROOT)
            require(sha(raw) == expected, "baseline source differs: " + path)
        for path, expected in diagnostic.DELTAS["after"].items():
            require(sha((ROOT / path).read_bytes()) == expected, "reviewed source differs: " + path)
        profile_keys = ["CARGO_PROFILE_" + mode + "_" + field for mode in ("DEV", "TEST") for field in ("OPT_LEVEL", "DEBUG_ASSERTIONS", "OVERFLOW_CHECKS", "DEBUG")]
        require(all(os.environ.get(key) == ("true" if key.endswith(("DEBUG_ASSERTIONS", "OVERFLOW_CHECKS")) else "0") for key in profile_keys), "ordinary correctness profile")
        bundle = ROOT / "rust/fixtures/m9/engineering/game-content-bundle-v2.json"
        result["content_bytes"] = bundle.stat().st_size
        result["content_sha256"] = sha(bundle.read_bytes())
        version, row = run("toolchain", ["rustup", "toolchain", "install", "1.97.1", "--profile", "minimal"], out)
        require(row["returncode"] == 0, "pinned toolchain install")
        version, row = run("rustc", ["rustc", "-Vv"], out)
        require(row["returncode"] == 0 and b"release: 1.97.1\n" in version, "pinned compiler")
        os.environ["CARGO_TARGET_DIR"] = str(out / "target")
        crate, target, test = CASES[case]
        args = ["cargo", "test", "--locked", "-p", crate, "--test", target, "--"]
        listing, row = run("whole-target-list", args + ["--list", "--format", "terse"], out, ROOT / "rust", 900)
        require(row["returncode"] == 0, "complete target build/list")
        ids = re.findall(rb"^([A-Za-z0-9_:]+): test$", listing, re.M)
        require(ids == [test.encode()], "exact whole test inventory")
        result["listing_sha256"] = row["log_sha256"]
        output, row = run("whole-target-execute", args + ["--format", "terse"], out, ROOT / "rust", 1900)
        counts = re.findall(
            rb"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out",
            output,
        )
        result["reported_counts"] = [[int(value) for value in values] for values in counts]
        result["execution_returncode"] = row["returncode"]
        result["execution_sha256"] = row["log_sha256"]
        require(row["returncode"] == 0 and counts == [(b"1", b"0", b"0", b"0", b"0")], "whole campaign failed")
        result["test_passed"] = True
        result["status"] = "passed"
    except Exception as error:
        result["first_failure"] = str(error)[:2048]
    finally:
        target_dir = out / "target"
        begun = time.monotonic()
        try:
            cleanup = subprocess.run(
                [sys.executable, "-c", "import shutil,sys; shutil.rmtree(sys.argv[1], ignore_errors=True)", str(target_dir)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20, check=False,
            )
            cleaned = cleanup.returncode == 0 and not target_dir.exists()
        except (OSError, subprocess.TimeoutExpired):
            cleaned = False
        result["cleanup"] = {"success": cleaned, "elapsed_ms": int((time.monotonic() - begun) * 1000)}
        result["elapsed_seconds"] = time.time() - START
        if not cleaned or time.time() > DEADLINE:
            result["status"] = "failed"
            result.setdefault("first_failure", "cleanup or deadline failed")
        raw = (json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n").encode()
        require(len(raw) <= 65536, "compact summary bound")
        (out / "compact/summary.json").write_bytes(raw)
        if result["status"] != "passed":
            failed = [row for row in COMMANDS if row["returncode"] != 0]
            tail = b""
            if failed:
                tail = (out / "diagnostics" / (failed[-1]["name"] + ".log")).read_bytes()[-22000:]
            (out / "compact/failure.txt").write_bytes(
                (result.get("first_failure", "qualification failed") + "\n").encode() + tail
            )
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) == 2 else ""))
