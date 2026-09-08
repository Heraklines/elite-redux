"""Remote source-oracle qualification of the ordinary standard AI numeric helper."""
import difflib
import hashlib
import json
import os
import re
from pathlib import Path
import signal
import subprocess
import time

BASE = "d06182e6f094fdc0974ce0bf8d563aa3d1133aee"
MODULE = "rust/crates/er-game/src/m9e_ai_score_query.rs"
TEST = "m9e_damage_query"
CI = [".github/workflows/m9e-ai-query-score-focused.yml", "scripts/ci/m9e_ai_query_score.py"]
IDS = ["current_damage_query_distinguishes_equal_power_by_physical_and_special_bulk","current_damage_queries_preserve_full_turn_and_rng_audit_after_reordering","current_damage_query_honors_pp_up_and_override_bounds_without_mutation","current_damage_query_zero_and_inactive_inputs_leave_state_unchanged","current_immune_turn_preserves_hp_and_skips_only_damage_variance","current_immunity_queries_preserve_zero_minimum_damage_and_typeless_struggle","current_ordinary_ai_score_uses_actual_damage_bulk_and_knockout_boundary","current_ordinary_ai_score_queries_preserve_full_turn_and_rng_audit"]
ROOT = Path.cwd().resolve()
RUNNER = Path(os.environ["RUNNER_TEMP"]).resolve()
OUT = RUNNER / "m9e-ai-query-score"
TARGET = RUNNER / "m9e-ai-query-score-target"
START = float(os.environ["M9E_STARTED_AT"])
DEADLINE = START + 1800
COMMANDS = []
PRODUCTS = {"rust/crates/er-game/src/lib.rs":"eb7889d78ded4c5d86bda24e85d99ac8b767e5d938512dcbbcbf85d9543ef15e","rust/crates/er-game/src/m9e_ai_score_query.rs":"6b5b008bd60607ae1ae9de2c1fc508968fe585c42e390ae75cb38b18ef2f49fa","rust/crates/er-game/tests/m9e_damage_query.rs":"8a248df5313aecaa109c582d63cd9014f7223c9a45e85cda772073183e1d1996"}

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
    require(not OUT.exists() and not TARGET.exists(), "fresh runner-owned output and target")
    (OUT / "compact").mkdir(parents=True)
    (OUT / "diagnostics").mkdir()
    TARGET.mkdir()
    os.environ["CARGO_TARGET_DIR"] = str(TARGET)
    result = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"],
              "run_id": os.environ["GITHUB_RUN_ID"], "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"],
              "base_sha": BASE, "commands": COMMANDS,
              "scope": "ordinary score query over actual current damage resolver, full turn and RNG conservation; no authority/profile activation qualification"}
    original = None
    try:
        require(git("rev-parse", "HEAD").decode().strip() == result["source_sha"], "exact candidate")
        require(sorted(git("diff", "--name-only", BASE, "HEAD").decode().splitlines()) == sorted([*PRODUCTS, *CI]), "exact five-file source delta")
        for path, expected in PRODUCTS.items():
            require(sha((ROOT / path).read_bytes()) == expected, "reviewed product source " + path)
        old_lib = git("show", BASE + ":rust/crates/er-game/src/lib.rs")
        require(sha(old_lib) == "1556eb98ba18424c6824bdb840be20dafd99c06d8c6ec1ab7b1e21bca15ab1cf", "qualified prior AI library")
        require((ROOT / "rust/crates/er-game/src/lib.rs").read_bytes().replace(b"pub mod m9e_ai_score_query;\n", b"") == old_lib, "all original AI library source preserved")
        pins = [*PRODUCTS, *CI, "src/data/elite-redux/er-enemy-ai.ts", "rust/Cargo.toml", "rust/Cargo.lock",
                "rust/rust-toolchain.toml", "rust/crates/er-ai/Cargo.toml", "rust/crates/er-ai/src/authority_v2.rs",
                "rust/crates/er-ai/src/full_surface.rs", "rust/crates/er-kernel/src/game_kernel_v7.rs", "rust/crates/er-battle/src/m7_resolver.rs", "rust/crates/er-ai/src/m9e_standard_attack_score.rs", "rust/crates/er-game/Cargo.toml"]
        result["source_hashes"] = {path: sha((ROOT / path).read_bytes()) for path in pins}
        for path in pins:
            if path not in [*PRODUCTS, *CI]:
                require(sha(git("show", BASE + ":" + path)) == result["source_hashes"][path], "unchanged owner/source dependency " + path)
        previous_test = git("show", BASE + ":rust/crates/er-game/tests/m9e_damage_query.rs")
        require(sha(previous_test) == "605d8603af9e64cd73c80e51d7e7623492c9023c2073f1d3d4b779fdd352061d", "qualified previous six-case query source")
        require((ROOT / "rust/crates/er-game/tests/m9e_damage_query.rs").read_bytes().startswith(previous_test), "all six original tests remain byte-for-byte")
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
        run("clippy", ["cargo", "clippy", "--locked", "-p", "er-game", "--test", TEST, "--", "-D", "warnings"], ROOT / "rust")
        def build(label):
            raw = run(label + "-build", ["cargo", "test", "--locked", "-p", "er-game", "--test", TEST, "--no-run", "--message-format=json"], ROOT / "rust")
            artifacts = [json.loads(line) for line in raw.splitlines() if line.startswith(b"{")]
            artifacts = [row for row in artifacts if row.get("reason") == "compiler-artifact" and row.get("target", {}).get("name") == TEST and row.get("executable")]
            require(len(artifacts) == 1, "unique actual test executable")
            executable = Path(artifacts[0]["executable"]).resolve()
            require(executable.is_relative_to(TARGET) and executable.is_file() and not executable.is_symlink(), "actual fresh target binary")
            return executable, {"bytes": executable.stat().st_size, "sha256": sha(executable.read_bytes())}
        def execute(label, executable, passed, failed):
            raw = run(label, [str(executable), "--test-threads=1"], expected_codes=(0,) if failed == 0 else (101,))
            expected = f"test result: {'ok' if failed == 0 else 'FAILED'}. {passed} passed; {failed} failed; 0 ignored; 0 measured; 0 filtered out;".encode()
            require(expected in raw and b"running 8 tests" in raw, "whole four-case execution and exact negative result")
        executable, result["positive_binary"] = build("positive")
        listed = run("whole-list", [str(executable), "--list"]).decode().splitlines()
        require(sorted(line[:-6] for line in listed if line.endswith(": test")) == sorted(IDS), "exact four-case inventory")
        execute("positive-execute", executable, 8, 0)
        result["positive_tests"] = 8
        mutant = original.replace(b"standard_attack_score(damage,", b"standard_attack_score(50,")
        require(original.count(b"standard_attack_score(damage,") == 1 and mutant != original, "exact causal KO-weight mutant")
        (ROOT / MODULE).write_bytes(mutant)
        executable, result["negative_binary"] = build("negative")
        require(result["negative_binary"]["sha256"] != result["positive_binary"]["sha256"], "actual changed mutant executable")
        execute("negative-execute", executable, 6, 2)
        result["negative"] = {"passed": 6, "failed": 2, "mutation": "substitute constant power proxy for simulated damage in score only"}
        (ROOT / MODULE).write_bytes(original)
        executable, result["restored_binary"] = build("restored")
        execute("restored-execute", executable, 8, 0)
        require(all(sha((ROOT / path).read_bytes()) == value for path, value in result["source_hashes"].items()), "all source bytes restored")
        result.update(status="passed", restored_tests=8, source_unchanged=True)
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
