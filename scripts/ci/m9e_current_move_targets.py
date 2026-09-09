import difflib
import hashlib
import json
import os
import re
from pathlib import Path
import signal
import subprocess
import time
BASE = "edb3a8d1677b271f992b54c56b46b79de18016a4"
MODULE = "rust/crates/er-battle/src/current_move_targets.rs"
TEST = "m9e_current_move_targets"
CI = [".github/workflows/m9e-current-move-targets-focused.yml", "scripts/ci/m9e_current_move_targets.py", "scripts/ci/m9e_current_move_targets_oracle.mjs"]
IDS = ["whole_source_targeting_matches_all_twenty_categories_and_owner_call_order", "source_spread_promotion_keeps_adjacency_and_multihit_exception", "source_random_draw_precedes_alive_filter_and_other_never_falls_back_to_ally", "invalid_owner_context_fails_without_inventing_rng_or_callback_results"]
ROOT = Path.cwd().resolve()
OUT = Path(os.environ["RUNNER_TEMP"]).resolve() / "m9e-current-move-targets"
TARGET = Path(os.environ["RUNNER_TEMP"]).resolve() / "m9e-current-move-targets-target"
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



PRODUCTS = {"rust/crates/er-battle/src/current_move_targets.rs":"bbacf5979e0ae788bd2e69edc18df9859a075f05b6b54cbf2903902a69e433f6","rust/crates/er-battle/src/lib.rs":"e3b035c6ee1fa52237dc64945d0e42f897d0118e0479a769190c81164c77ed75","rust/crates/er-battle/tests/m9e_current_move_targets.rs":"d8b6b7234443cf24e4e3060701e574356861b7e7e7518edbaf30b61af41bc6b8"}

def main():
    require(os.name == "posix" and os.uname().machine == "x86_64", "remote Ubuntu x64 required")
    require(0 <= time.time() - START < 1780, "shared precheckout deadline")
    require(not OUT.exists() and not TARGET.exists(), "fresh outputs")
    (OUT / "compact").mkdir(parents=True)
    (OUT / "diagnostics").mkdir()
    TARGET.mkdir()
    os.environ["CARGO_TARGET_DIR"] = str(TARGET)
    result = {"status":"failed", "source_sha":os.environ["GITHUB_SHA"], "run_id":os.environ["GITHUB_RUN_ID"], "run_attempt":os.environ["GITHUB_RUN_ATTEMPT"], "base_sha":BASE, "commands":COMMANDS, "battle_execution_qualified":False, "resolved_owner_inputs_only":True}
    original = None
    try:
        require(git("rev-parse", "HEAD").decode().strip() == result["source_sha"], "exact candidate")
        require(sorted(git("diff", "--name-only", BASE, "HEAD").decode().splitlines()) == sorted([*PRODUCTS,*CI]), "exact three Rust and three CI paths")
        for path, expected in PRODUCTS.items():
            require(sha((ROOT/path).read_bytes()) == expected, "reviewed product source " + path)
        lib = "rust/crates/er-battle/src/lib.rs"
        previous = git("show", BASE+":"+lib)
        require((ROOT/lib).read_bytes() == previous.replace(b"pub mod critical;", b"pub mod critical;\npub mod current_move_targets;"), "entire old crate surface preserved")
        original = (ROOT/MODULE).read_bytes()
        result["source_hashes"] = {path:sha((ROOT/path).read_bytes()) for path in [*PRODUCTS,*CI]}
        run("toolchain-install", ["rustup","toolchain","install","1.97.1","--profile","minimal","--component","rustfmt","--component","clippy"])
        result["rustc"] = run("rustc-version", ["rustc","-Vv"], ROOT/"rust").decode()
        require("release: 1.97.1\n" in result["rustc"], "pinned toolchain")
        originals = {path:(ROOT/path).read_bytes() for path in PRODUCTS}
        run("format", ["rustfmt","--edition","2024","--config","skip_children=true",*PRODUCTS])
        patch = b""
        for path, before in originals.items():
            after = (ROOT/path).read_bytes()
            if before != after:
                patch += "".join(difflib.unified_diff(before.decode().splitlines(True),after.decode().splitlines(True),fromfile="a/"+path,tofile="b/"+path)).encode()
        if patch:
            require(len(patch) <= 262144, "bounded formatting patch")
            (OUT/"diagnostics/format.patch").write_bytes(patch)
            result["format_patch"] = {"bytes":len(patch),"sha256":sha(patch)}
            raise RuntimeError("remote formatting correction required")
        cases = OUT/"diagnostics/source-cases.jsonl"
        oracle = json.loads(run("source-oracle", ["node",CI[2],str(cases)]))
        require(oracle["cases"] == 200 and oracle["runtime"] == "v24.9.0" and oracle["whole_target_function"] is True and oracle["whole_line_adjacency"] is True and oracle["resolved_owner_inputs_only"] is True, "whole current target source")
        require(oracle["output_bytes"] == cases.stat().st_size <= 262144 and oracle["output_sha256"] == sha(cases.read_bytes()), "complete source observations")
        for path, expected in oracle["source_hashes"].items():
            require(sha((ROOT/path).read_bytes()) == expected and sha(git("show",BASE+":"+path)) == expected, "whole unchanged dependency")
        result["oracle"] = oracle
        os.environ["M9E_CURRENT_MOVE_TARGETS_ORACLE"] = str(cases)
        run("clippy", ["cargo","clippy","--locked","-p","er-battle","--test",TEST,"--","-D","warnings"], ROOT/"rust")
        def build(label):
            raw = run(label+"-build", ["cargo","test","--locked","-p","er-battle","--test",TEST,"--no-run","--message-format=json"], ROOT/"rust")
            records = [json.loads(line) for line in raw.splitlines() if line.startswith(b"{")]
            records = [value for value in records if value.get("reason") == "compiler-artifact" and value.get("target",{}).get("name") == TEST and value.get("executable")]
            require(len(records) == 1, "unique test executable")
            exe = Path(records[0]["executable"]).resolve()
            require(exe.is_relative_to(TARGET) and exe.is_file() and not exe.is_symlink(), "fresh binary")
            return exe, {"bytes":exe.stat().st_size,"sha256":sha(exe.read_bytes())}
        def execute(label, exe, failures):
            raw = run(label, [str(exe),"--test-threads=1"], expected_codes=(101,) if failures else (0,))
            expected = f"test result: {'FAILED' if failures else 'ok'}. {4-len(failures)} passed; {len(failures)} failed; 0 ignored; 0 measured; 0 filtered out;".encode()
            require(expected in raw and b"running 4 tests" in raw, "whole four-case target")
            for test_id in IDS:
                require(f"test {test_id} ... {'FAILED' if test_id in failures else 'ok'}".encode() in raw, "exact named outcome")
        exe,result["positive_binary"] = build("positive")
        listed = run("whole-list", [str(exe),"--list"]).decode().splitlines()
        require(sorted(line[:-6] for line in listed if line.endswith(": test")) == sorted(IDS), "whole test inventory")
        execute("positive-execute",exe,[])
        result["positive_tests"] = 4
        before = b"kind = AllNearEnemies;"
        require(original.count(before) == 1, "unique omitted spread mutation")
        (ROOT/MODULE).write_bytes(original.replace(before,b"kind = NearEnemy;"))
        exe,result["negative_binary"] = build("negative")
        require(result["negative_binary"] != result["positive_binary"], "actual mutant binary")
        failures = IDS[:2]
        execute("negative-execute",exe,failures)
        result["negative"] = {"passed":2,"failed":2,"failed_ids":failures,"mutation":"omit current ability spread promotion"}
        (ROOT/MODULE).write_bytes(original)
        exe,result["restored_binary"] = build("restored")
        execute("restored-execute",exe,[])
        require(result["positive_binary"] == result["restored_binary"], "exact binary restoration")
        require(all(sha((ROOT/path).read_bytes()) == value for path,value in result["source_hashes"].items()), "all source restored")
        result.update(status="passed",restored_tests=4,source_unchanged=True)
    except Exception as error:
        result["error"] = type(error).__name__+": "+str(error)
    finally:
        if original is not None:
            (ROOT/MODULE).write_bytes(original)
        result["elapsed_seconds_including_checkout"] = round(time.time()-START,3)
        bounded_write(OUT/"compact/summary.json",result,65536)
    return 0 if result["status"] == "passed" else 1

if __name__ == "__main__":
    raise SystemExit(main())