"""Remote-only actual CLI fresh account entry qualification; no battle settlement claim."""
import base64
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import urllib.request

BASE = "40a59698400da73aa15fe883538b7135b69ee51e"
BRANCH = "codex/m9e-cli-fresh-profile-20260909"
CI = [".github/workflows/m9e-cli-fresh-profile-focused.yml", "scripts/ci/m9e_cli_fresh_profile_focused.py"]
DELTAS = {"before":{"rust/crates/er-cli/tests/m9e_current_entry.rs":"38825b9628ce99e97458ee3c55b5f049b07b64bb6d88a5c68611fd7d9111a580","rust/crates/er-cli/src/current_commands.rs":"b55422878ef013515e76ee54f5434d17ff8bf86edf4f493f5f509c4e4767c5d7","rust/crates/er-cli/src/current_agent.rs":"7b8f300ae710549892a91ae97bab2dc25f2bb77372eb50690c247e9ce9368ead"},"after":{"rust/crates/er-cli/tests/m9e_current_entry.rs":"1348729fdc129794ca93330d3e84ec0ea1200063f99b1ccd611ae463aef969c9","rust/crates/er-cli/src/current_commands.rs":"30200f63c5d0bef1a82127b06eb2068114671e13d2b0ee67c6b991f032d24cc8","rust/crates/er-cli/src/current_agent.rs":"1c4b35fa9f44425330d7914c6559c183b44aa048e985d1440c8e2783eb0f3f0b"}}
TARGETS = {"m9e_current_entry":{"ids":["current_session_rolls_back_when_adapter_completion_rejects","new_run_fresh_profile_is_explicit_and_rejects_nonpristine_accounts","new_run_fresh_profile_process_owns_catalog_and_resumes_exactly","normal_commands_report_v2_content_and_reject_historical_state_injection","normal_new_run_resume_and_simulate_use_current_session_events","public_agent_fork_time_restore_and_close_preserve_current_session_identity","public_agent_fresh_profile_forks_and_rejects_invalid_creation_atomically","public_agent_natural_start_owns_v7_content_and_raw_controls","public_agent_rejected_external_results_do_not_commit_partial_state","public_agent_rejects_old_snapshot_schema_without_replacing_current_session"],"crate":"er-cli"},"m9e_fresh_friendship_profile":{"crate":"er-cli","ids":["fresh_catalog_requires_qualified_complete_progression_not_only_oracle_sha","fresh_owner_restore_rejects_catalog_and_schema_forgery_transactionally","fresh_title_accounts_survive_natural_state_save_and_captured_replay","unknown_profile_restore_does_not_create_accounts_or_erase_legacy_bytes"]}}
BASE_PINS = {"rust/crates/er-game/src/m72_bootstrap.rs":"b771ff1a3bc4c1bf145539094d4ee80de6e5d3807199a879332af0fe735db442","rust/crates/er-game/src/m9e_content_v2.rs":"d38878172aa5c9b2bbee4ce5a572fc8291cfbfd125d2d81eae72cde6c46b1dc5","rust/crates/er-game/src/m9e_material_v6.rs":"af37672dbb96ea7253995ec6f129cede823ced28914893660c6dc33ee193ffe1","rust/crates/er-kernel/src/game_kernel_v7.rs":"d04e1f07ea0e414a8a518cd4fbff46abea58b907d14b764d2e72d359eaba5400","rust/crates/er-kernel/tests/m9e_snapshot_v7.rs":"61bf667ffb72247c98d6f5bc3131c376635368c6426eab006de84794eaa209cd","rust/crates/er-game/tests/m9e_runtime_v6.rs":"b60e14c71c62ec58b827ab503b51d1566078b66809034bd1c9afc7dbdb9d6cf4","rust/crates/er-game/tests/m9e_content_v2.rs":"3b4477542ec3b435b756786f12a647d3421d7eda4c73de61d6c92d9a9c1f3f59","rust/crates/er-env/src/current.rs":"ec99d6fa36ceae1401b5a0521718b5220100fdd0fafb5a29dbb171f3b128a2b3","rust/crates/er-game/src/current_friendship_profile.rs":"25fce82adf01165204dc88a087c85eeddb034cd7814ed5bce546c50ba307e8dc","rust/crates/er-game/src/m9e_new_run_v6.rs":"883f8ddadf13a63ba7c1dfbfb2b338598e41458267cc0b17182d90b5bf83bd31","rust/crates/er-game/tests/m9e_material_v6.rs":"6e336a593e67e6c3bfa9804eafc63cf2ed384592fd188fac163dc4b2333e14b5","rust/crates/er-save/src/m9e_save_v2.rs":"17f4b9ac328c4efa4054ab1253b85bfbcdffd22fcb6a28b0b6d5885976d846f7","rust/crates/er-state/src/lib.rs":"31982cf02e13bc26e4d8d79fee0cc4851cb0e9dc7f10637539c1f6fc33a80cfa","rust/crates/er-state/src/m9e_state_v6.rs":"6e9c98f67f695a4828c558748b7b4c73c1700fdea5930b1013bda385580e9909","rust/crates/er-kernel/tests/m9e_material_retention_v7.rs":"29bbf74b5d2202e7325dab930f8ed71bd4b5b4c63952b0a60cc3e6d9c1d11c84","rust/crates/er-game/tests/m9e_material_retention.rs":"493f575642d93202e2396387f4daa6bfa2d8d85e9176ef0f43744bcba563fe1d","rust/crates/er-state/src/current_friendship_profile.rs":"5f9c0aa04d50048cc9f251cfe8d88a31162474d5bda2b2e396dc02d15ff6d032","rust/crates/er-game/src/m9e_runtime_v6.rs":"7f17ad6dc294dbaa525d27f79684c363a755bf9956a2c1a8bb403753b5cfe46c","rust/crates/er-cli/tests/m9e_fresh_friendship_profile.rs":"8ee9dbea17cc2e54ec88581b040c70003edbee963d1a861ada2619fb5828c3c6","rust/crates/er-kernel/src/snapshot_v7.rs":"2f799081973a0c4286c6ea7b3ffa58f9c2ab8a12395176b7592785494593dd6e","rust/crates/er-game/src/lib.rs":"c0e376b0449c9daa27972e5942fb65c02ca3c0d1ca1a9e6d2565f6de3e892e4c"}
ROOT = Path(__file__).resolve().parents[2]
RUNNER = Path(os.environ["RUNNER_TEMP"]).resolve()
OUT = RUNNER / "m9e-cli-fresh-profile"
TARGET = RUNNER / "m9e-cli-fresh-profile-target"
START = float(os.environ["M9E_STARTED_AT"])
DEADLINE = START + 1800
COMMANDS = []

def require(value, message):
    if not value:
        raise RuntimeError(message)

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def bounded_write(path, value, maximum):
    raw = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    require(len(raw) <= maximum, "compact result exceeds retained bound")
    path.write_bytes(raw)

def run(name, argv, cwd=ROOT, maximum=8 << 20):
    remaining = DEADLINE - 20 - time.time()
    require(remaining > 0, "shared deadline exhausted before " + name)
    seconds = min(600, remaining)
    log = OUT / "diagnostics" / (name + ".log")
    started = time.monotonic()
    with log.open("wb") as output:
        process = subprocess.Popen(argv, cwd=cwd, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
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
    COMMANDS.append(dict(name=name, argv=argv, cwd=str(cwd.relative_to(ROOT)) or ".", limit_seconds=seconds,
                         elapsed_ms=int((time.monotonic()-started)*1000), returncode=process.returncode,
                         log_bytes=len(raw), log_sha256=sha(raw)))
    require(reason is None and process.returncode == 0 and len(raw) <= maximum, reason or name + " failed")
    require(time.time() <= DEADLINE-20, "reserved cleanup deadline exhausted")
    return raw

def git(*args):
    return run("git-"+str(len(COMMANDS)), ["git", *args])

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def source_oracle():
    """Independent source-derived projection, not a full TS GameData execution."""
    pins = {
        "src/data/balance/starters.ts": "21bd9442711f1f7381f5e7e5c4a51dac43db0584272fd5b4767493f8a68e39ef",
        "src/enums/species-id.ts": "6323f21fd3dfb859b6ae682f2f94507ad140ceeff811fdee43289779cf6665ba",
        "src/enums/passive.ts": "f4a2b339a018fe01700fb42586bb7b72006a2922d87fdf5d213a385758b310b6",
    }
    for path, digest in pins.items():
        require(sha((ROOT/path).read_bytes()) == digest, "pinned literal source differs: "+path)
    oid = "b88d78bbcf0e36c937af4fa30e45e73d7e5aea90"
    try:
        request = urllib.request.Request("https://api.github.com/repos/Heraklines/elite-redux/git/blobs/"+oid,
            headers={"Authorization": "Bearer "+os.environ["GITHUB_TOKEN"], "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "m9e-fresh-account-source"})
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            require(response.status == 200, "source HTTP status")
            body = response.read(524289)
        require(len(body) <= 524288, "single immutable source response bound")
        value = json.loads(body)
        require(value.get("sha") == oid and value.get("encoding") == "base64" and type(value.get("size")) is int and value["size"] == 325510, "source blob metadata")
        raw = base64.b64decode("".join(value["content"].splitlines()), validate=True)
        require(len(raw) == 325510 and sha(raw) == "16a69ee97d552e16ab6bb6bb2504d358a05fcf1ca80a6d53c38a4f3d1910e89f"
                and hashlib.sha1(f"blob {len(raw)}\0".encode()+raw).hexdigest() == oid, "source blob identity")
    except Exception:
        raise RuntimeError("bounded pinned GameData source retrieval/validation failed") from None
    init = "\n".join(raw.decode().splitlines()[6884:6919])
    require(all(token in init for token in ("Object.keys(speciesStarterCosts)", "species.speciesId >= 10000", "candyCount: 0", "friendship: 0", "passiveAttr: 0")), "exact reviewed constructor semantics")
    ids, next_id = {}, 0
    enum_text = (ROOT/"src/enums/species-id.ts").read_text()
    entries = re.findall(r"^  ([A-Z][A-Z0-9_]*)(?: = ([0-9]+))?,\s*$", enum_text, re.M)
    require(len(entries) == len(re.findall(r"^  [A-Z].*$", enum_text, re.M)) == 1082, "complete numeric enum source")
    for name, explicit in entries:
        if explicit:
            next_id = int(explicit)
        ids[name] = next_id
        next_id += 1
    block = re.search(r"export const speciesStarterCosts = \{(.*?)\n\};", (ROOT/"src/data/balance/starters.ts").read_text(), re.S).group(1)
    entries = re.findall(r"^  \[SpeciesId\.([A-Z0-9_]+)\]: ([0-9]+),\s*$", block, re.M)
    require(len(entries) == len([line for line in block.splitlines() if line.strip()]) == 570, "complete starter cost literals")
    expected_table = [(ids[name], int(cost), name) for name, cost in entries]
    rust = (ROOT/"rust/crates/er-game/src/current_friendship_profile.rs").read_text()
    actual_table = [(int(species), int(cost), name) for species, cost, name in re.findall(r"^\s*\(([0-9]+), ([0-9]+)\),[ \t]+// ([A-Z0-9_]+)$", rust, re.M)]
    require(actual_table == expected_table, "every Rust table row must match actual pinned source")
    definitions_path = ROOT/"rust/fixtures/m9/engineering/complete-progression-definitions-v1.json"
    definitions_raw = definitions_path.read_bytes()
    require(len(definitions_raw) == 3724089 and sha(definitions_raw) == "bba00376cae18feae56bebe38c5be0f1bb3aae3fd9a6e99e3ec7fa60a15de08f", "qualified complete allSpecies export")
    definitions = json.loads(definitions_raw)
    species = definitions["species"]
    require(len(species) == 3384 and all(type(row["species_id"]) is int and row["species_id"] > 0 for row in species), "complete source species definitions")
    custom = {row["species_id"] for row in species if row["species_id"] >= 10000}
    keys = sorted({entry[0] for entry in expected_table} | custom)
    require(len(keys) > 570 and len(keys) <= 4096, "complete bounded fresh account closure")
    path = OUT/"diagnostics/fresh-account-oracle.json"
    bounded_write(path, keys, 65536)
    proof = dict(qualification="source-derived complete seed-set comparison; not full TypeScript execution",
        oracle_sha="399d5d368f0b5642ebf8f45bd8a5e73350fa4de7", source_hashes=pins,
        game_data_blob=oid, game_data_bytes=len(raw), game_data_sha256=sha(raw), constructor_excerpt_sha256=sha(init.encode()),
        starter_rows=570, custom_species=len(custom), source_definition_rows=3384, total_accounts=len(keys),
        definitions_sha256=sha(definitions_raw), oracle_bytes=path.stat().st_size, oracle_sha256=sha(path.read_bytes()))
    print(json.dumps(proof, sort_keys=True, separators=(",", ":")))

def main():
    require(os.environ.get("GITHUB_REPOSITORY") == "Heraklines/elite-redux" and os.environ.get("GITHUB_REF") == "refs/heads/"+BRANCH, "isolated source branch required")
    require(re.fullmatch(r"[0-9]{10}", os.environ["M9E_STARTED_AT"]) and 0 <= time.time()-START < 1780, "precheckout shared budget")
    require(os.name == "posix" and os.uname().machine == "x86_64", "Ubuntu x64")
    require(OUT.parent == RUNNER and TARGET.parent == RUNNER and not OUT.exists() and not TARGET.exists(), "fresh owned directories")
    (OUT/"compact").mkdir(parents=True)
    (OUT/"diagnostics").mkdir()
    TARGET.mkdir()
    os.environ["CARGO_TARGET_DIR"] = str(TARGET)
    result = dict(status="failed", qualification="actual CLI fresh-account entry and resume; no XP settlement or full M9 qualification",
        source_sha=os.environ["GITHUB_SHA"], run_id=os.environ["GITHUB_RUN_ID"], run_attempt=os.environ["GITHUB_RUN_ATTEMPT"], base_sha=BASE, tests_executed=0, commands=COMMANDS)
    try:
        require(git("rev-parse", "HEAD").decode().strip() == result["source_sha"], "actual source HEAD")
        paths = git("diff", "--name-only", BASE, "HEAD").decode().splitlines()
        require(sorted(paths) == sorted([*DELTAS["after"], *CI]), "exact reviewed source delta")
        for path, expected in DELTAS["before"].items():
            require(sha(git("show", BASE+":"+path)) == expected, "base source differs: "+path)
        for path, expected in DELTAS["after"].items():
            require(sha((ROOT/path).read_bytes()) == expected, "reviewed source differs: "+path)
        for path, expected in BASE_PINS.items():
            require(sha(git("show", BASE+":"+path)) == expected and sha((ROOT/path).read_bytes()) == expected, "qualified profile base source changed: "+path)
        pins = sorted(set([*BASE_PINS, *DELTAS["after"], *CI, "rust/Cargo.toml", "rust/Cargo.lock", "rust/rust-toolchain.toml",
            *["rust/crates/"+crate+"/Cargo.toml" for crate in ("er-state", "er-game", "er-save", "er-kernel", "er-env", "er-cli", "er-repro")],
            "rust/crates/er-cli/src/main.rs", "rust/crates/er-repro/src/current.rs", "test/kernel-fixtures/m9/export-progression-content.ts",
            "src/data/balance/starters.ts", "src/enums/species-id.ts", "src/enums/passive.ts"]))
        result["source_hashes"] = {path: sha((ROOT/path).read_bytes()) for path in pins}
        result["fixture_tree_sha256"] = sha(git("ls-tree", "-r", "HEAD", "--", "rust/fixtures/m9/engineering"))
        result["source_oracle"] = json.loads(run("source-oracle", [sys.executable, str(Path(__file__).resolve()), "--source-oracle"], maximum=65536))
        os.environ["ER_M9E_FRESH_ACCOUNT_ORACLE"] = str(OUT/"diagnostics/fresh-account-oracle.json")
        run("toolchain-install", ["rustup", "toolchain", "install", "1.97.1", "--profile", "minimal", "--component", "rustfmt", "--component", "clippy"])
        rustc = run("rustc-version", ["rustc", "-Vv"], ROOT/"rust").decode()
        require("release: 1.97.1\n" in rustc and "host: x86_64-unknown-linux-gnu\n" in rustc, "pinned actual compiler")
        result["rustc"] = rustc
        originals = {path: (ROOT/path).read_bytes() for path in DELTAS["after"] if path.endswith(".rs")}
        run("rustfmt", ["rustfmt", "--edition", "2024", "--config", "skip_children=true", *originals])
        patch, format_rows = b"", []
        for path, original in originals.items():
            formatted = (ROOT/path).read_bytes()
            if formatted != original:
                patch += "".join(difflib.unified_diff(original.decode().splitlines(True), formatted.decode().splitlines(True), fromfile="a/"+path, tofile="b/"+path)).encode()
                format_rows.append(dict(path=path, before_sha256=sha(original), after_sha256=sha(formatted)))
        if patch:
            require(len(patch) <= 262144, "named format patch bound")
            (OUT/"diagnostics/format.patch").write_bytes(patch)
            result["format_patch"] = dict(bytes=len(patch), sha256=sha(patch), files=format_rows)
            raise RuntimeError("exact remote formatter patch required before qualification")
        profile_keys = ["CARGO_PROFILE_"+mode+"_"+field for mode in ("DEV", "TEST") for field in ("OPT_LEVEL", "DEBUG_ASSERTIONS", "OVERFLOW_CHECKS", "DEBUG")]
        result["profile_environment"] = {key: os.environ.get(key) for key in profile_keys}
        require(all(value == ("true" if key.endswith(("DEBUG_ASSERTIONS", "OVERFLOW_CHECKS")) else "0") for key, value in result["profile_environment"].items()), "ordinary correctness profile")
        require(not any(os.environ.get(key) for key in ("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUST_MIN_STACK", "RUST_TEST_THREADS")), "no ambient flags or execution overrides")
        run("proposal-clippy", ["cargo", "clippy", "--locked", "-p", "er-state", "-p", "er-game", "-p", "er-kernel", "-p", "er-save", "-p", "er-env", "-p", "er-cli", "--tests", "--no-deps", "--", "-D", "warnings"], ROOT/"rust")
        selector = ["-p", "er-cli"] + [argument for name in TARGETS for argument in ("--test", name)]
        raw = run("proposal-build", ["cargo", "test", "--locked", *selector, "--no-run", "--message-format=json"], ROOT/"rust")
        rows = [json.loads(line) for line in raw.splitlines() if line.startswith(b"{")]
        require([row.get("success") for row in rows if row.get("reason") == "build-finished"] == [True], "complete successful Cargo stream")
        artifacts = [row for row in rows if row.get("reason") == "compiler-artifact" and row.get("executable")]
        hosts = [row for row in artifacts if not row["profile"]["test"]]
        require(len(hosts) == 1 and hosts[0]["target"]["name"] == "er-cli" and hosts[0]["target"]["kind"] == ["bin"], "one CLI process artifact")
        host = hosts[0]
        host_binary = Path(host["executable"])
        host_profile = host["profile"]
        require(host["manifest_path"] == str(ROOT/"rust/crates/er-cli/Cargo.toml") and host["target"]["src_path"] == str(ROOT/"rust/crates/er-cli/src/main.rs")
            and host.get("features") == [] and host_profile["test"] is False and host_profile["opt_level"] == "0"
            and host_profile["debug_assertions"] is True and host_profile["overflow_checks"] is True and host_profile["debuginfo"] == 0
            and host_binary == TARGET/"debug/er-cli" and host_binary.is_file() and not host_binary.is_symlink() and host_binary.resolve() == host_binary
            and 0 < host_binary.stat().st_size <= 128 << 20, "actual CLI process source/profile")
        result["cli_process_binary"] = dict(target=host["target"], profile=host_profile, manifest_path=host["manifest_path"], path=str(host_binary), bytes=host_binary.stat().st_size, sha256=sha(host_binary.read_bytes()), invoked_by="m9e_current_entry; real Command processes")
        tests = [row for row in artifacts if row["profile"]["test"]]
        require(len(tests) == 2 and {row["target"]["name"] for row in tests} == set(TARGETS), "two complete native targets")
        result["artifacts"] = []
        for artifact in sorted(tests, key=lambda row: row["target"]["name"]):
            name = artifact["target"]["name"]
            crate, ids = TARGETS[name]["crate"], TARGETS[name]["ids"]
            profile = artifact["profile"]
            binary = Path(artifact["executable"])
            require(artifact["manifest_path"] == str(ROOT/("rust/crates/"+crate+"/Cargo.toml")) and artifact["target"]["src_path"] == str(ROOT/("rust/crates/"+crate+"/tests/"+name+".rs"))
                and artifact["target"]["kind"] == ["test"] and artifact.get("features") == [] and profile["test"] is True and profile["opt_level"] == "0"
                and profile["debug_assertions"] is True and profile["overflow_checks"] is True and profile["debuginfo"] == 0
                and binary.is_absolute() and binary.parent == TARGET/"debug/deps" and binary.is_file() and not binary.is_symlink() and binary.resolve() == binary
                and re.fullmatch(re.escape(name)+r"-[0-9a-f]{16}", binary.name) and 0 < binary.stat().st_size <= 128 << 20, "actual artifact/source/profile identity")
            listing = run(name+"-list", [str(binary), "--list", "--format", "terse"], ROOT/("rust/crates/"+crate), maximum=16384)
            require(listing == "".join(test+": test\n" for test in ids).encode(), "exact whole target IDs")
            digest = sha(binary.read_bytes())
            output = run(name+"-execute", [str(binary), "--format", "terse"], ROOT/("rust/crates/"+crate), maximum=32768)
            require(re.findall(rb"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output) == [(str(len(ids)).encode(), b"0", b"0", b"0", b"0")], "every whole-target test must pass")
            require(sha(binary.read_bytes()) == digest, "executed artifact changed")
            result["artifacts"].append(dict(target=artifact["target"], profile=profile, manifest_path=artifact["manifest_path"], path=str(binary), bytes=binary.stat().st_size, sha256=digest, ids=ids, listing_bytes=len(listing), listing_sha256=sha(listing)))
            result["tests_executed"] += len(ids)
        require(result["tests_executed"] == 14, "all eleven retained plus three new tests")
        require(sha(host_binary.read_bytes()) == result["cli_process_binary"]["sha256"], "CLI process artifact changed")
        require(sha((OUT/"diagnostics/fresh-account-oracle.json").read_bytes()) == result["source_oracle"]["oracle_sha256"], "independent source oracle changed")
        for path, digest in result["source_hashes"].items():
            require(sha((ROOT/path).read_bytes()) == digest, "source changed during execution: "+path)
        result["status"] = "passed"
    except Exception as error:
        result["first_failure"] = str(error)[:2048]
    finally:
        require(TARGET.resolve().parent == RUNNER and TARGET.name == "m9e-cli-fresh-profile-target", "cleanup ownership")
        begun = time.monotonic()
        try:
            cleanup = subprocess.run([sys.executable, "-c", "import shutil,sys; shutil.rmtree(sys.argv[1])", str(TARGET)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20, check=False)
            okay = cleanup.returncode == 0
        except (subprocess.TimeoutExpired, OSError):
            okay = False
        result["cleanup"] = dict(target_removed=not TARGET.exists(), success=okay, limit_seconds=20, elapsed_ms=int((time.monotonic()-begun)*1000))
        result["elapsed_seconds"] = time.time()-START
        if not okay or TARGET.exists() or time.time() > DEADLINE:
            result["status"] = "failed"
            result["first_failure"] = "cleanup or shared deadline failed"
        if result["status"] != "passed":
            failure = (result.get("first_failure", "qualification failed")+"\n").encode()
            if COMMANDS:
                failure += (OUT/"diagnostics"/(COMMANDS[-1]["name"]+".log")).read_bytes()[-22000:]
            (OUT/"compact/failure.txt").write_bytes(failure[:24576])
        bounded_write(OUT/"compact/summary.json", result, 32768)
    raise SystemExit(0 if result["status"] == "passed" else 1)

if __name__ == "__main__":
    if sys.argv[1:] == ["--source-oracle"]:
        source_oracle()
    else:
        require(not sys.argv[1:], "no unsupported producer arguments")
        main()
