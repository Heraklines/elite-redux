"""Remote actual-source qualification of unboosted normal-Classic party XP planning."""
import difflib
import hashlib
import json
import os
import re
from pathlib import Path
import signal
import subprocess
import time

BASE = "e11c3e338d0871af34bf72f9701aa7a2563d12be"
MODULE = "rust/crates/er-progression/src/current_party_experience.rs"
TEST = "m9e_party_experience"
CI = [".github/workflows/m9e-party-xp-focused.yml", "scripts/ci/m9e_party_xp.py", "scripts/ci/m9e_party_xp_oracle.mjs"]
IDS = ["actual_pinned_source_matrix_matches_every_phase_binary64_argument","balance_redistributes_without_share_and_preserves_fractional_phase_arguments","living_at_cap_friendship_and_full_participant_denominator_preserve_source_order","invalid_input_and_overflow_do_not_produce_a_partial_plan"]
ROOT = Path.cwd().resolve()
RUNNER = Path(os.environ["RUNNER_TEMP"]).resolve()
OUT = RUNNER / "m9e-party-xp"
TARGET = RUNNER / "m9e-party-xp-target"
START = float(os.environ["M9E_STARTED_AT"])
DEADLINE = START + 1800
COMMANDS = []
PRODUCTS = {"rust/crates/er-progression/src/current_party_experience.rs":"26b3e17d7940314cae10ce1bc6d29e5f20dfe65928830c7263cfea819a6e3cb2","rust/crates/er-progression/src/lib.rs":"1fd6db5158d66252849626e858fc70191ff1b28f2ced468a58ab13a090c177a0","rust/crates/er-progression/tests/m9e_party_experience.rs":"9a863002c9700645a480b148582c2e4a8aa951157965757b20a0386ce6c1c27d"}

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
              "scope": "actual applyPartyExp unboosted normal Classic boundary only; no pending-owner settlement or gameplay activation"}
    original = None
    try:
        require(git("rev-parse", "HEAD").decode().strip() == result["source_sha"], "exact candidate")
        require(sorted(git("diff", "--name-only", BASE, "HEAD").decode().splitlines()) == sorted([*PRODUCTS, *CI]), "exact six-file source delta")
        for path, expected in PRODUCTS.items():
            require(sha((ROOT / path).read_bytes()) == expected, "reviewed product source " + path)
        old_lib = git("show", BASE + ":rust/crates/er-progression/src/lib.rs")
        require(sha(old_lib) == "265e001706c1ad6b009389dbce3eaf158685ef075192819314c68f63030af993", "prior whole progression library")
        require((ROOT / "rust/crates/er-progression/src/lib.rs").read_bytes().replace(b"pub mod current_party_experience;\n", b"") == old_lib, "all original progression source preserved")
        dependencies = ["src/battle-scene.ts", "src/data/balance/starters.ts", "src/modifier/modifier.ts", "pnpm-lock.yaml", "package.json",
                        "rust/Cargo.toml", "rust/Cargo.lock", "rust/rust-toolchain.toml", "rust/crates/er-progression/Cargo.toml",
                        "rust/crates/er-progression/src/current_experience.rs", "rust/crates/er-kernel/src/game_kernel_v7.rs"]
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
        run("pnpm-install", ["npm", "install", "--global", "pnpm@10.33.2"])
        run("dependencies", ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"])
        oracle_path = OUT / "diagnostics/source-cases.tsv"
        oracle = json.loads(run("source-oracle", ["node", "--disable-warning=ExperimentalWarning", CI[2], str(oracle_path)]))
        require(oracle["cases"] == 144 and oracle["runtime"] == "v24.9.0" and oracle["phaser_version"] == "3.90.0", "actual pinned source matrix")
        require(oracle["function_sha256"] == "37f19d82a8772ad0edddd7724a70994b0a11aa03b8901bfd10a29ed334d6e96c" and oracle["function_bytes"] == 4977, "entire actual source method")
        require(oracle["output_sha256"] == sha(oracle_path.read_bytes()) and oracle["output_bytes"] == oracle_path.stat().st_size <= 65536, "actual bounded source cases")
        result["oracle"] = oracle
        os.environ["M9E_PARTY_XP_ORACLE"] = str(oracle_path)
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
        before = b"*amount = (target - *amount) * (0.2 * f64::from(stacks)) + *amount;"
        after = b"*amount = ((target - *amount) * (0.2 * f64::from(stacks)) + *amount).floor();"
        require(original.count(before) == 1, "unique causal premature rounding mutation")
        (ROOT / MODULE).write_bytes(original.replace(before, after))
        executable, result["negative_binary"] = build("negative")
        require(result["negative_binary"]["sha256"] != result["positive_binary"]["sha256"], "actual changed mutant executable")
        execute("negative-execute", executable, 2, 2)
        result["negative"] = {"passed": 2, "failed": 2, "mutation": "premature floor of fractional Exp Balance phase argument"}
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
