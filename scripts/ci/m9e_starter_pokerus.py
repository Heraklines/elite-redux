"""Remote explicit starter-state preservation; no profile eligibility or XP payment claim."""
import difflib
import hashlib
import json
import os
import re
from pathlib import Path
import signal
import subprocess
import time
BASE = "0e0f07d0081a4b604b880796b905c4919958eac1"
MODULE = "rust/crates/er-game/src/m9e_new_run_v6.rs"
TEST = "m9e_battle_participation"
TEST_PATH = "rust/crates/er-game/tests/" + TEST + ".rs"
CI = [".github/workflows/m9e-starter-pokerus-focused.yml", "scripts/ci/m9e_starter_pokerus.py", "scripts/ci/m9e_starter_pokerus_oracle.mjs"]
NEW_IDS = ["selected_pokerus_preserves_all_other_natural_state_and_distinguishes_unknown", "selected_pokerus_rejects_missing_reordered_and_mismatched_whole_selections", "selected_pokerus_reaches_pending_experience_and_survives_real_save_replay", "pending_experience_rejects_pokerus_changes_and_unknown_substitution"]
ROOT = Path.cwd().resolve()
RUNNER = Path(os.environ["RUNNER_TEMP"]).resolve()
OUT = RUNNER / "m9e-starter-pokerus"
TARGET = RUNNER / "m9e-starter-pokerus-target"
START = float(os.environ["M9E_STARTED_AT"])
DEADLINE = START + 1800
COMMANDS = []
PRODUCTS = {"rust/crates/er-ai/src/party_snapshots.rs":"726684368f6ca8700f0bd490b9c6646b577796cf7cfc8ac104c48ccff57fa057","rust/crates/er-game/src/m9_new_run.rs":"a7735adfa50ccb22acbd8a8e4d4ad1837ce38e9ee1480a4044261e6c98d75a60","rust/crates/er-game/src/m9e_new_run_v6.rs":"0492d70d097430519514f2b195ca31483e4dc019ab474d48b1fe7a016ce49dea","rust/crates/er-game/tests/m9e_battle_participation.rs":"8b862761f97f1b5266cc93923936287c0aa03bbf004531f3eb3acc46b4034159","rust/crates/er-scenario/src/party_requirements.rs":"f934ed4ca9d6c795861153962e5260b962bbf45f06ce8af896cc5e43de2751d9","rust/crates/er-scenario/src/training_session.rs":"0abbdc41aaf29d0a65eb3f95ca9c5f050e1eb1ebd3ac1bf31c8ac56ac50ef335","rust/crates/er-state/src/current_experience_owner.rs":"d7db6989ed6af104467d739091d372e13d8ef737f39c3b28642ab716f87e59ef","rust/crates/er-state/src/m7_state.rs":"ad81d248a296b3f584388df5509cc5c45f31533b78fc29007b09bb053fa70f33","rust/crates/er-testkit/tests/m7_system_proof.rs":"70cf678f079f019fb050338f57284e1b3831bf1fd14260f8067c7695f3c00f26"}

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
    result = {"status":"failed", "source_sha":os.environ["GITHUB_SHA"], "run_id":os.environ["GITHUB_RUN_ID"], "run_attempt":os.environ["GITHUB_RUN_ATTEMPT"], "base_sha":BASE, "commands":COMMANDS, "profile_eligibility_qualified":False, "pending_experience_settlement_qualified":False}
    original = None
    try:
        require(git("rev-parse", "HEAD").decode().strip() == result["source_sha"], "exact candidate")
        require(sorted(git("diff", "--name-only", BASE, "HEAD").decode().splitlines()) == sorted([*PRODUCTS,*CI]), "exact nine Rust and three CI paths")
        for path, expected in PRODUCTS.items():
            require(sha((ROOT/path).read_bytes()) == expected, "reviewed product source " + path)
        previous_test = git("show", BASE + ":" + TEST_PATH)
        require((ROOT/TEST_PATH).read_bytes().startswith(previous_test), "entire original test source retained")
        old_ids = re.findall(r"(?m)^#\[test\]\nfn ([a-z0-9_]+)", previous_test.decode())
        require(len(old_ids) == 11 and not set(old_ids).intersection(NEW_IDS), "all eleven original tests")
        ids = old_ids + NEW_IDS
        dependencies = ["src/field/pokemon.ts", "src/phases/select-starter-phase.ts", "rust/Cargo.toml", "rust/Cargo.lock", "rust/rust-toolchain.toml", "rust/crates/er-game/Cargo.toml", "rust/crates/er-game/src/m9e_runtime_v6.rs", "rust/crates/er-game/src/m9e_material_v6.rs", "rust/crates/er-state/src/current_battle_participation.rs"]
        result["source_hashes"] = {path:sha((ROOT/path).read_bytes()) for path in [*PRODUCTS,*CI,*dependencies]}
        for path in dependencies:
            require(sha(git("show", BASE+":"+path)) == result["source_hashes"][path], "unchanged dependency " + path)
        original = (ROOT/MODULE).read_bytes()
        run("toolchain-install", ["rustup","toolchain","install","1.97.1","--profile","minimal","--component","rustfmt","--component","clippy"])
        result["rustc"] = run("rustc-version", ["rustc","-Vv"], ROOT/"rust").decode()
        require("release: 1.97.1\n" in result["rustc"], "pinned toolchain")
        originals = {path:(ROOT/path).read_bytes() for path in PRODUCTS}
        run("format", ["rustfmt","--edition","2024","--config","skip_children=true",*PRODUCTS])
        patch = b""
        changes = []
        for path, before in originals.items():
            after = (ROOT/path).read_bytes()
            if before != after:
                patch += "".join(difflib.unified_diff(before.decode().splitlines(True),after.decode().splitlines(True),fromfile="a/"+path,tofile="b/"+path)).encode()
                changes.append({"path":path,"before_sha256":sha(before),"after_sha256":sha(after)})
        if patch:
            require(len(patch) <= 262144, "bounded formatting patch")
            (OUT/"diagnostics/format.patch").write_bytes(patch)
            result["format_patch"] = {"bytes":len(patch),"sha256":sha(patch),"files":changes}
            raise RuntimeError("remote formatting correction required")
        cases = OUT/"diagnostics/source-cases.tsv"
        oracle = json.loads(run("source-oracle", ["node",CI[2],str(cases)]))
        require(oracle["cases"] == 4 and oracle["runtime"] == "v24.9.0" and oracle["whole_constructor"] is False and oracle["profile_eligibility_qualified"] is False, "actual bounded assignment witness only")
        require(oracle["source_hashes"] == {path:result["source_hashes"][path] for path in dependencies[:2]}, "source witness binding")
        require(oracle["output_bytes"] == cases.stat().st_size <= 4096 and oracle["output_sha256"] == sha(cases.read_bytes()), "actual source cases")
        result["oracle"] = oracle
        os.environ["M9E_STARTER_POKERUS_ORACLE"] = str(cases)
        run("constructor-consumers-check", ["cargo","check","--locked","-p","er-ai","-p","er-scenario","-p","er-testkit","--tests"], ROOT/"rust")
        run("clippy", ["cargo","clippy","--locked","-p","er-game","--test",TEST,"--","-D","warnings"], ROOT/"rust")
        def build(label):
            raw = run(label+"-build", ["cargo","test","--locked","-p","er-game","--test",TEST,"--no-run","--message-format=json"], ROOT/"rust")
            records = [json.loads(line) for line in raw.splitlines() if line.startswith(b"{")]
            records = [value for value in records if value.get("reason") == "compiler-artifact" and value.get("target",{}).get("name") == TEST and value.get("executable")]
            require(len(records) == 1, "unique actual test executable")
            exe = Path(records[0]["executable"]).resolve()
            require(exe.is_relative_to(TARGET) and exe.is_file() and not exe.is_symlink(), "fresh binary")
            return exe, {"bytes":exe.stat().st_size,"sha256":sha(exe.read_bytes())}
        def execute(label, exe, failures):
            raw = run(label, [str(exe),"--test-threads=1"], expected_codes=(101,) if failures else (0,))
            passed = 15-len(failures)
            expected = f"test result: {'FAILED' if failures else 'ok'}. {passed} passed; {len(failures)} failed; 0 ignored; 0 measured; 0 filtered out;".encode()
            require(expected in raw and b"running 15 tests" in raw, "all fifteen current tests executed")
            for test_id in ids:
                status = "FAILED" if test_id in failures else "ok"
                require(f"test {test_id} ... {status}".encode() in raw, "exact test outcome " + test_id)
        exe,result["positive_binary"] = build("positive")
        listed = run("whole-list", [str(exe),"--list"]).decode().splitlines()
        require(sorted(line[:-6] for line in listed if line.endswith(": test")) == sorted(ids), "whole exact test inventory")
        execute("positive-execute",exe,[])
        result["positive_tests"] = 15
        before = b"pokemon.pokerus = Some(starter.pokerus);"
        require(original.count(before) == 1, "unique lost-selected-flag mutation")
        (ROOT/MODULE).write_bytes(original.replace(before,b"pokemon.pokerus = Some(false);"))
        exe,result["negative_binary"] = build("negative")
        require(result["negative_binary"] != result["positive_binary"], "actual mutant binary")
        failures = [NEW_IDS[0],NEW_IDS[2],NEW_IDS[3]]
        execute("negative-execute",exe,failures)
        result["negative"] = {"passed":12,"failed":3,"failed_ids":failures,"mutation":"discard the selected source flag"}
        (ROOT/MODULE).write_bytes(original)
        exe,result["restored_binary"] = build("restored")
        execute("restored-execute",exe,[])
        require(result["positive_binary"] == result["restored_binary"], "exact binary restoration")
        require(all(sha((ROOT/path).read_bytes()) == value for path,value in result["source_hashes"].items()), "all source restored")
        result.update(status="passed",restored_tests=15,original_tests_per_state=11,source_unchanged=True)
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
