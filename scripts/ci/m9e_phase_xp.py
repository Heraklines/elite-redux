"""Remote actual-source qualification of resolved field and bench XP phase amounts."""
import difflib
import hashlib
import json
import os
import re
from pathlib import Path
import signal
import subprocess
import time

BASE = "d8a76353e5b912b39e729d2371f3088fe4a330ed"
MODULE = "rust/crates/er-progression/src/current_phase_experience.rs"
TEST = "m9e_phase_experience"
CI = [".github/workflows/m9e-phase-xp-focused.yml", "scripts/ci/m9e_phase_xp.py", "scripts/ci/m9e_phase_xp_oracle.mjs"]
IDS = ["whole_actual_phase_matrix_matches_every_add_exp_argument", "global_boosters_floor_each_application_and_preserve_order", "field_product_and_bench_ability_follow_distinct_source_paths", "invalid_context_and_unsafe_arithmetic_fail_without_an_award"]
ROOT = Path.cwd().resolve()
RUNNER = Path(os.environ["RUNNER_TEMP"]).resolve()
OUT = RUNNER / "m9e-phase-xp"
TARGET = RUNNER / "m9e-phase-xp-target"
START = float(os.environ["M9E_STARTED_AT"])
DEADLINE = START + 1800
COMMANDS = []
PRODUCTS = {"rust/crates/er-progression/src/current_phase_experience.rs":"074c8927cfb96430524022168496c1b61fd7d18c9843f8d84573ae08457d0468","rust/crates/er-progression/src/lib.rs":"4672b76d5335be4268e8cb6eda85decc9c2d937e5535975055ebef90229b6c5e","rust/crates/er-progression/tests/m9e_phase_experience.rs":"2ddccf134219fb0640a16c48be8b9a296f188a40bf6ba403c3f9199ac7af6355"}

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
    require(os.name == "posix" and os.uname().machine == "x86_64", "remote Ubuntu x64 required")
    require(0 <= time.time() - START < 1780, "precheckout shared deadline")
    require(not OUT.exists() and not TARGET.exists(), "fresh runner output and target")
    (OUT / "compact").mkdir(parents=True)
    (OUT / "diagnostics").mkdir()
    TARGET.mkdir()
    os.environ["CARGO_TARGET_DIR"] = str(TARGET)
    result = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"],
              "run_id": os.environ["GITHUB_RUN_ID"], "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"],
              "base_sha": BASE, "commands": COMMANDS,
              "scope": "actual whole field/bench phase classes and ExpBoosterModifier; resolved consumer/addExp boundaries, no pending-owner settlement or gameplay activation"}
    original = None
    try:
        require(git("rev-parse", "HEAD").decode().strip() == result["source_sha"], "exact candidate")
        require(sorted(git("diff", "--name-only", BASE, "HEAD").decode().splitlines()) == sorted([*PRODUCTS, *CI]), "exact six-file source delta")
        for path, expected in PRODUCTS.items():
            require(sha((ROOT / path).read_bytes()) == expected, "reviewed product source " + path)
        old_lib = git("show", BASE + ":rust/crates/er-progression/src/lib.rs")
        require(sha(old_lib) == "1fd6db5158d66252849626e858fc70191ff1b28f2ced468a58ab13a090c177a0", "prior whole progression library")
        require((ROOT / "rust/crates/er-progression/src/lib.rs").read_bytes().replace(b"pub mod current_phase_experience;\n", b"") == old_lib, "all original progression source preserved")
        dependencies = ["src/phases/exp-phase.ts", "src/phases/show-party-exp-bar-phase.ts", "src/modifier/modifier.ts",
                        "rust/Cargo.toml", "rust/Cargo.lock", "rust/rust-toolchain.toml", "rust/crates/er-progression/Cargo.toml",
                        "rust/crates/er-progression/src/current_experience.rs", "rust/crates/er-progression/src/current_party_experience.rs",
                        "rust/crates/er-state/src/current_experience_owner.rs", "rust/crates/er-game/src/m9e_runtime_v6.rs"]
        pins = [*PRODUCTS, *CI, *dependencies]
        result["source_hashes"] = {path: sha((ROOT / path).read_bytes()) for path in pins}
        for path in dependencies:
            require(sha(git("show", BASE + ":" + path)) == result["source_hashes"][path], "unchanged owner/source dependency " + path)
        original = (ROOT / MODULE).read_bytes()
        run("toolchain-install", ["rustup", "toolchain", "install", "1.97.1", "--profile", "minimal", "--component", "rustfmt", "--component", "clippy"])
        result["rustc"] = run("rustc-version", ["rustc", "-Vv"], ROOT / "rust").decode()
        require("release: 1.97.1\n" in result["rustc"], "pinned Rust compiler")
        originals = {path: (ROOT / path).read_bytes() for path in PRODUCTS}
        run("format", ["rustfmt", "--edition", "2024", "--config", "skip_children=true", *PRODUCTS])
        patch = b""
        changed = []
        for path, before in originals.items():
            after = (ROOT / path).read_bytes()
            if before != after:
                patch += "".join(difflib.unified_diff(before.decode().splitlines(True), after.decode().splitlines(True), fromfile="a/" + path, tofile="b/" + path)).encode()
                changed.append({"path": path, "before_sha256": sha(before), "after_sha256": sha(after)})
        if patch:
            require(len(patch) <= 262144, "bounded exact formatting patch")
            (OUT / "diagnostics/format.patch").write_bytes(patch)
            result["format_patch"] = {"bytes": len(patch), "sha256": sha(patch), "files": changed}
            raise RuntimeError("remote formatting correction required")
        oracle_path = OUT / "diagnostics/source-cases.tsv"
        oracle = json.loads(run("source-oracle", ["node", "--disable-warning=ExperimentalWarning", CI[2], str(oracle_path)]))
        require(oracle["cases"] == 336 and oracle["runtime"] == "v24.9.0" and oracle["phase_call_order_checked"] is True, "actual pinned whole phase matrix and callback order")
        require(oracle["source_hashes"] == {path: result["source_hashes"][path] for path in dependencies[:3]}, "whole actual reference source pins")
        require(oracle["output_sha256"] == sha(oracle_path.read_bytes()) and oracle["output_bytes"] == oracle_path.stat().st_size <= 65536, "actual bounded source cases")
        result["oracle"] = oracle
        os.environ["M9E_PHASE_XP_ORACLE"] = str(oracle_path)
        run("clippy", ["cargo", "clippy", "--locked", "-p", "er-progression", "--test", TEST, "--", "-D", "warnings"], ROOT / "rust")
        def build(label):
            raw = run(label + "-build", ["cargo", "test", "--locked", "-p", "er-progression", "--test", TEST, "--no-run", "--message-format=json"], ROOT / "rust")
            artifacts = [json.loads(line) for line in raw.splitlines() if line.startswith(b"{")]
            artifacts = [row for row in artifacts if row.get("reason") == "compiler-artifact" and row.get("target", {}).get("name") == TEST and row.get("executable")]
            require(len(artifacts) == 1, "unique actual test executable")
            executable = Path(artifacts[0]["executable"]).resolve()
            require(executable.is_relative_to(TARGET) and executable.is_file() and not executable.is_symlink(), "fresh actual target binary")
            return executable, {"bytes": executable.stat().st_size, "sha256": sha(executable.read_bytes())}
        def execute(label, executable, passed, failed):
            raw = run(label, [str(executable), "--test-threads=1"], expected_codes=(0,) if failed == 0 else (101,))
            expected = f"test result: {'ok' if failed == 0 else 'FAILED'}. {passed} passed; {failed} failed; 0 ignored; 0 measured; 0 filtered out;".encode()
            require(expected in raw and b"running 4 tests" in raw, "whole four-case execution")
        executable, result["positive_binary"] = build("positive")
        listed = run("whole-list", [str(executable), "--list"]).decode().splitlines()
        require(sorted(line[:-6] for line in listed if line.endswith(": test")) == sorted(IDS), "exact complete four-case inventory")
        execute("positive-execute", executable, 4, 0)
        result["positive_tests"] = 4
        before = b"amount = (amount * (1.0 + f64::from(booster.stacks) * multiplier)).floor();"
        after = b"amount = amount * (1.0 + f64::from(booster.stacks) * multiplier);"
        require(original.count(before) == 1, "unique causal missing per-booster rounding mutation")
        (ROOT / MODULE).write_bytes(original.replace(before, after))
        executable, result["negative_binary"] = build("negative")
        require(result["negative_binary"]["sha256"] != result["positive_binary"]["sha256"], "actual changed mutant executable")
        execute("negative-execute", executable, 2, 2)
        result["negative"] = {"passed": 2, "failed": 2, "mutation": "missing source floor after each global booster"}
        (ROOT / MODULE).write_bytes(original)
        executable, result["restored_binary"] = build("restored")
        execute("restored-execute", executable, 4, 0)
        require(result["positive_binary"] == result["restored_binary"], "exact original executable restoration")
        require(all(sha((ROOT / path).read_bytes()) == value for path, value in result["source_hashes"].items()), "all source bytes unchanged")
        result.update(status="passed", restored_tests=4, source_unchanged=True)
    except Exception as error:
        result["error"] = type(error).__name__ + ": " + str(error)
    finally:
        if original is not None:
            (ROOT / MODULE).write_bytes(original)
        result["elapsed_seconds_including_checkout"] = round(time.time() - START, 3)
        bounded_write(OUT / "compact/summary.json", result, 65536)
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
