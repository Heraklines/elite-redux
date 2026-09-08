"""Remote whole-target qualification of the audited published-recoil content report change."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-recoil-golden"
FULL, COMPACT = REPORT / "diagnostics", REPORT / "compact"
STARTED_AT = None
DEADLINE = None
run_bounded = None
BASE = "b4862e9db04455732673bf3e75478f2ef9f63e75"
TEST_SOURCE = "rust/crates/er-wasm/tests/m9e_parity.rs"
BUNDLE_PATH = "rust/fixtures/m9/engineering/game-content-bundle-v2.json"
WASM_IDS = ["wasm_replays_v7_held_timers_eventwise", "wasm_replays_v7_raw_inputs_eventwise"]
OLD_IDS = ["native_replays_v7_held_timers_eventwise", "native_replays_v7_raw_inputs_eventwise"]
COHORTS = {
    "old": {"commit": "9fbb9fa2a624f8341974ce27e18260a21063751f", "bytes": 15810979,
            "git_blob": "6b435b78bc4d62c7f492142752c91610b914a071",
            "sha256": "640dcf079ae133fdcfb013c99109844ebbd1744cd397f705f959314c68b696e4",
            "bundle_hash": "blake3-v1:9de581e0d922874eaf17b8a9c355e4d154b051b34935fad60d5779c70de68429",
            "progression_hash": "751643168aa2c2405d700c13b6438b10dec901d969de2c6b1048663b421b2695",
            "report_digest": "42da262041f8b58b7c0bf95253e5560cfd1b4c2b571b46419555df6df94278f4"},
    "new": {"commit": "b4862e9db04455732673bf3e75478f2ef9f63e75", "bytes": 16340147,
            "git_blob": "6bd2537b440de33974642c4565e0d275ef3b3624",
            "sha256": "f11ed4151b9157f1f7f296c6b2801ffaed02a3c43b6a31816e5145a478175913",
            "bundle_hash": "blake3-v1:e0f6c983166996dff2c0ee4ba3fcf88a262d0b89477f1d02c2c4a19298be4a8c",
            "progression_hash": "b167ad856885c95dab4f1e9cdf1456dd4924f6c4dbc8443e12918f232215192e",
            "report_digest": "288686469e4022f1a2c64cf9bfd5f074acc7ee39545dca878af536224a458017"},
}
PROFILE = {"RUSTUP_TOOLCHAIN": "1.97.1", "CARGO_INCREMENTAL": "0", "CARGO_PROFILE_TEST_OPT_LEVEL": "0",
           "CARGO_PROFILE_TEST_DEBUG_ASSERTIONS": "true", "CARGO_PROFILE_TEST_OVERFLOW_CHECKS": "true",
           "CARGO_PROFILE_TEST_DEBUG": "0", "CARGO_PROFILE_DEV_DEBUG": "0",
           "CARGO_PROFILE_DEV_OPT_LEVEL": "0", "CARGO_PROFILE_DEV_DEBUG_ASSERTIONS": "true", "CARGO_PROFILE_DEV_OVERFLOW_CHECKS": "true"}
SOURCES = [TEST_SOURCE, "rust/crates/er-game/src/m9e_material_v6.rs", "rust/crates/er-wasm/src/m9e_parity.rs", "rust/crates/er-wasm/src/lib.rs",
           "rust/crates/er-wasm/Cargo.toml", "rust/crates/er-kernel/src/game_kernel_v7.rs",
           "rust/crates/er-kernel/src/snapshot_v7.rs", "rust/crates/er-kernel/src/snapshot.rs",
           "rust/crates/er-kernel/src/lib.rs", "rust/crates/er-game/src/m9e_runtime_v6.rs",
           "rust/crates/er-game/src/m9e_content_v2.rs", "rust/crates/er-game/src/m9e_new_run_v6.rs",
           "rust/crates/er-state/src/m9e_state_v6.rs", "rust/crates/er-progression/src/progression.rs",
           "rust/crates/er-progression/src/content_v2.rs", "rust/crates/er-canonical/src/lib.rs",
           "rust/Cargo.toml", "rust/Cargo.lock", "rust/rust-toolchain.toml", "scripts/ci/m9e_current_cost.py",
           "scripts/ci/m9e_recoil_golden.py", ".github/workflows/m9e-recoil-golden-focused.yml"]
RECOIL_CONSTANT = r'''const RECOIL_METADATA_PARITY: (&str, &str, usize, &str) = (
    "blake3-v1:e0f6c983166996dff2c0ee4ba3fcf88a262d0b89477f1d02c2c4a19298be4a8c",
    "b167ad856885c95dab4f1e9cdf1456dd4924f6c4dbc8443e12918f232215192e",
    16_340_147,
    "288686469e4022f1a2c64cf9bfd5f074acc7ee39545dca878af536224a458017",
);

'''
BASE_TREE = "6c71c8c3f0580bdadfdc1240769654b96cfe2ad7"
BASE_SOURCES = json.loads(r'''{"rust/crates/er-game/src/m9e_material_v6.rs":["7ebefdf8fd78878154564554a1d566b02246578a6d22198e9540a7a0f6add835",24238],"rust/Cargo.lock":["9e7f2e2a96e9b191015b567c4bb1bd7f3457b0dbebc563394e354f5f132c65dc",32083],"rust/Cargo.toml":["fdefad8953caa82922a4f3e86560d3543f9d1ef69edada7bc1dcc16ae3a5ade9",1615],"rust/crates/er-canonical/src/lib.rs":["2c80cb375cbc7aaf5018a4abacd67c74e584451347cac253448cc96238d12a3b",98923],"rust/crates/er-game/src/m9e_content_v2.rs":["e287b251a98cab8e170ac92fc4b253bc0908a2f6155929f35978680dff3fda5b",24460],"rust/crates/er-game/src/m9e_new_run_v6.rs":["0dbd2ace8ff9e6d4b064b0279bfc90bbb587051e37782a8837760de1de63ec44",37584],"rust/crates/er-game/src/m9e_runtime_v6.rs":["b910e8a9a708942ea4df944106204817f9664dae83c320fa7eb962a00a1e6327",114036],"rust/crates/er-kernel/src/game_kernel_v7.rs":["0a8cd79f25bae24a589bd6c38682708fa8816787241c83e534f746b707ce5ae0",161847],"rust/crates/er-kernel/src/lib.rs":["4c04cb699d70a2de1aff23a86a3dfbc41a13db5142984623d8bad48441812e76",1085],"rust/crates/er-kernel/src/snapshot_v7.rs":["e247dbf85f7d473f9d02d54b08f0b86d5630aa37bfd39e5645ef7b3366449e7a",22224],"rust/crates/er-kernel/src/snapshot.rs":["13073f49f7598ee4ba20dff446fbfac50d87cea04ece523679e7258d552ca2f2",55220],"rust/crates/er-progression/src/content_v2.rs":["60b2aeb5bf55e05119830a50d175b254e8ceb4382ba023d658e5c13d4e91007c",18196],"rust/crates/er-progression/src/progression.rs":["842400cd68f24a2f431c62c64813c3600735e86dd8acdeea42dc6ba10d7baacd",27646],"rust/crates/er-state/src/m9e_state_v6.rs":["6e0937529780f4cb50c65122173a68820c4823bdfb9569ff8b46583cf9d8e9fb",16401],"rust/crates/er-wasm/Cargo.toml":["bc664365f8987e882b5433ac980c06ad61f64759c9280c0d6b164258e14d0de6",756],"rust/crates/er-wasm/src/lib.rs":["236e35c52a0bc6eb29752c47dde2f5b8f0070a05a05b269365e20c1baa76312c",14866],"rust/crates/er-wasm/src/m9e_parity.rs":["8a8c0272c89486be88f931045bbef41ab7bc1aed799f100528028467f486dfbb",5818],"rust/crates/er-wasm/tests/m9e_parity.rs":["872a38b8774ef72e2e16c18c085d71a8714f8d54d9a7306d3cadfb48f231e977",29848],"rust/rust-toolchain.toml":["0241de2190a0c1959d4ad182dfa6943b7ab9bd577dc8ef9b0fe7502d191835ec",123],"scripts/ci/m9e_current_cost.py":["5a25e98778cc7103375a5342600c4bc6e5a22252935f435f847e6434f00e7cd8",38620]}''')
CHANGED_SOURCES = [TEST_SOURCE, "scripts/ci/m9e_recoil_golden.py", ".github/workflows/m9e-recoil-golden-focused.yml"]
logs, sequence, failed_log = {}, 0, None


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def run(args, name, *, cwd=None, seconds=600, bound=16 << 20):
    global sequence, failed_log
    if not 0 < seconds <= 600 or DEADLINE is None or run_bounded is None:
        raise RuntimeError("fixed600-second command ceiling and pre-checkout budget required")
    sequence += 1
    output = FULL / f"{sequence:03d}-{name}.log"
    try:
        result = run_bounded(args, cwd=cwd or ROOT / "rust", environment=dict(os.environ),
                             output=output, seconds=seconds, byte_limit=bound, global_deadline=DEADLINE - 20)
    except Exception:
        failed_log = output
        raise
    logs[name] = {key: result[key] for key in ("bytes", "sha256", "elapsed_seconds")}
    logs[name].update(argv=args, cwd=str((cwd or ROOT / "rust").relative_to(ROOT)), limit_seconds=seconds, returncode=0)
    return output


def verify_bundle(path, cohort):
    if path.is_symlink() or not path.is_file() or path.stat().st_size != cohort["bytes"]:
        raise RuntimeError("exact regular cohort file size required")
    blob = hashlib.sha1(f"blob {cohort['bytes']}\0".encode())
    sha = hashlib.sha256()
    total = 0
    with path.open("rb") as stream:
        while chunk := stream.read(65536):
            total += len(chunk)
            if total > cohort["bytes"]:
                raise RuntimeError("cohort stream exceeded exact bound")
            sha.update(chunk)
            blob.update(chunk)
    if total != cohort["bytes"] or sha.hexdigest() != cohort["sha256"] or blob.hexdigest() != cohort["git_blob"]:
        raise RuntimeError("actual cohort SHA256/Git blob identity differs")


def artifact_from_build(build, target, wasm=False):
    rows = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    if [row.get("success") for row in rows if row.get("reason") == "build-finished"] != [True]:
        raise RuntimeError("complete successful artifact stream required")
    matches = [row for row in rows if row.get("reason") == "compiler-artifact" and row.get("target", {}).get("name") == "m9e_parity"]
    if len(matches) != 1:
        raise RuntimeError("unique actual parity executable required")
    artifact = matches[0]
    binary = Path(artifact.get("executable") or "")
    profile = artifact.get("profile", {})
    parent = target / ("wasm32-unknown-unknown/debug/deps" if wasm else "debug/deps")
    pattern = r"m9e_parity-[0-9a-f]{16}\.wasm" if wasm else r"m9e_parity-[0-9a-f]{16}"
    if (artifact.get("manifest_path") != str(ROOT / "rust/crates/er-wasm/Cargo.toml")
            or artifact.get("features") != [] or artifact.get("target", {}).get("kind") != ["test"]
            or artifact["target"].get("src_path") != str(ROOT / TEST_SOURCE)
            or profile.get("test") is not True or profile.get("debug_assertions") is not True
            or profile.get("overflow_checks") is not True
            or profile.get("opt_level") != "0" or profile.get("debuginfo") != 0
            or not binary.is_absolute() or binary.is_symlink() or not binary.is_file()
            or binary.resolve() != binary or binary.parent != parent or not re.fullmatch(pattern, binary.name)
            or (not wasm and not os.access(binary, os.X_OK)) or not 0 < binary.stat().st_size <= 128 << 20):
        raise RuntimeError("actual parity source/profile/artifact differs")
    if wasm:
        with binary.open("rb") as stream:
            if stream.read(8) != b"\x00asm\x01\x00\x00\x00":
                raise RuntimeError("actual Wasm module header required")
    return binary, {"sha256": digest(binary), "bytes": binary.stat().st_size,
                    "profile": profile, "overflow_checks": True, "source_path": TEST_SOURCE,
                    "target": "wasm32-unknown-unknown" if wasm else "native"}


def marker(text, name):
    values = re.findall(name + r"=([^\s]+)", text)
    if len(values) != 1 or not re.fullmatch(r"[0-9a-f]{64}", values[0]):
        raise RuntimeError("one exact actual parity digest marker required: " + name)
    return values[0]


def execute_cohort(name, summary):
    target = REPORT / ("target-" + name)
    os.environ["CARGO_TARGET_DIR"] = str(target)
    verify_bundle(ROOT / BUNDLE_PATH, COHORTS[name])
    run(["cargo", "clippy", "--locked", "-p", "er-wasm", "--test", "m9e_parity", "--no-deps", "--", "-D", "warnings"], name + "-clippy")
    build = run(["cargo", "test", "--locked", "-p", "er-wasm", "--test", "m9e_parity", "--no-run", "--message-format=json"], name + "-build")
    binary, artifact = artifact_from_build(build, target)
    listing = run([str(binary), "--list", "--format", "terse"], name + "-list", seconds=30, bound=16384)
    if listing.read_text() != "".join(value + ": test\n" for value in OLD_IDS):
        raise RuntimeError("both unchanged native test IDs required")
    output = run([str(binary), "--format", "terse", "--nocapture"], name + "-execute",
                 cwd=ROOT / "rust/crates/er-wasm", seconds=600, bound=16384)
    text = output.read_text()
    counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", text)
    if counts != [("2", "0", "0", "0", "0")]:
        raise RuntimeError("complete ordinary native target must pass both tests without filtering")
    execution = [{"ids": OLD_IDS, "passed": 2, "failed": 0, "ignored": 0, "filtered_out": 0}]
    raw_digest = marker(text, "M9E_RAW_PARITY_DIGEST")
    timer_digest = marker(text, "M9E_TIMER_PARITY_DIGEST")
    if raw_digest != COHORTS[name]["report_digest"] or digest(binary) != artifact["sha256"]:
        raise RuntimeError("executed native full report/cohort or binary differs")
    verify_bundle(ROOT / BUNDLE_PATH, COHORTS[name])
    artifact.update(ids=OLD_IDS, listing_sha256=digest(listing))
    summary["cohorts"][name] = {"source_input": COHORTS[name], "artifact": artifact,
        "executions": execution, "raw_report_digest": raw_digest, "timer_report_digest": timer_digest}


def execute_new_wasm(summary):
    verify_bundle(ROOT / BUNDLE_PATH, COHORTS["new"])
    os.environ["CARGO_TARGET_DIR"] = str(REPORT / "target-tools")
    run(["cargo", "install", "wasm-bindgen-cli", "--version", "0.2.127", "--locked", "--force"], "wasm-tools")
    if run(["wasm-bindgen", "--version"], "wasm-version", seconds=30, bound=16384).read_text().strip() != "wasm-bindgen 0.2.127":
        raise RuntimeError("exact pinned Wasm runner toolchain required")
    runner = Path(shutil.which("wasm-bindgen-test-runner") or "")
    if not runner.is_absolute() or runner.is_symlink() or not runner.is_file() or not 0 < runner.stat().st_size <= 128 << 20:
        raise RuntimeError("bounded actual installed Wasm runner required")
    runner_hash = digest(runner)
    node = run(["node", "--version"], "node-version", seconds=30, bound=16384).read_text().strip()
    if not re.fullmatch(r"v\d+\.\d+\.\d+", node):
        raise RuntimeError("actual Node Wasm runtime version required")
    target = REPORT / "target-wasm"
    os.environ["CARGO_TARGET_DIR"] = str(target)
    os.environ["CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER"] = str(runner)
    run(["cargo", "clippy", "--locked", "-p", "er-wasm", "--test", "m9e_parity", "--target", "wasm32-unknown-unknown", "--no-deps", "--", "-D", "warnings"], "wasm-clippy")
    build = run(["cargo", "test", "--locked", "-p", "er-wasm", "--test", "m9e_parity", "--target", "wasm32-unknown-unknown", "--no-run", "--message-format=json"], "wasm-build")
    binary, artifact = artifact_from_build(build, target, wasm=True)
    output = run([str(runner), str(binary), "--nocapture"], "wasm-execute", cwd=ROOT / "rust/crates/er-wasm", bound=32768)
    text = output.read_text()
    counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored;", text)
    names = re.findall(r"\btest (?:[A-Za-z0-9_]+::)*(wasm_replays_v7_[A-Za-z0-9_]+)", text)
    if counts != [("2", "0", "0")] or len(names) != 2 or sorted(names) != WASM_IDS:
        raise RuntimeError("all two existing actual Wasm IDs must execute once and pass")
    raw_digest = marker(text, "M9E_RAW_PARITY_DIGEST")
    timer_digest = marker(text, "M9E_TIMER_PARITY_DIGEST")
    if (raw_digest != COHORTS["new"]["report_digest"]
            or raw_digest != summary["cohorts"]["new"]["raw_report_digest"]
            or timer_digest != summary["cohorts"]["new"]["timer_report_digest"]
            or digest(binary) != artifact["sha256"] or digest(runner) != runner_hash):
        raise RuntimeError("actual new native/Wasm raw/timer reports or executable hashes differ")
    verify_bundle(ROOT / BUNDLE_PATH, COHORTS["new"])
    artifact["ids"] = WASM_IDS
    summary["wasm"] = {"source_input": COHORTS["new"], "artifact": artifact,
        "executed_ids": sorted(names), "passed": 2, "failed": 0, "ignored": 0,
        "raw_report_digest": raw_digest, "timer_report_digest": timer_digest,
        "runner_sha256": runner_hash, "runner_bytes": runner.stat().st_size,
        "wasm_bindgen_version": "0.2.127", "node_version": node}

def cleanup_owned_targets():
    paths = []
    for name in ("new", "wasm", "tools"):
        path = REPORT / ("target-" + name)
        if path.is_symlink() or path.resolve().parent != REPORT.resolve():
            raise RuntimeError("owned target containment differs")
        paths.append(str(path))
    subprocess.run([sys.executable, "-c",
                    "import shutil,sys;[shutil.rmtree(p) for p in sys.argv[1:] if __import__('os').path.exists(p)]",
                    *paths], timeout=20, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if any(Path(path).exists() for path in paths):
        raise RuntimeError("owned target cleanup incomplete")

def source_conservation(summary, phase):
    if STARTED_AT is None or not 0 <= time.time() - STARTED_AT <= 1800:
        raise RuntimeError("pre-checkout shared budget absent or exhausted")
    tree = run(["git", "rev-parse", BASE + "^{tree}"], "base-tree-" + phase,
               cwd=ROOT, seconds=30, bound=16384).read_text().strip()
    if tree != BASE_TREE:
        raise RuntimeError("exact difficulty base base tree required")
    changes = run(["git", "diff", "--name-status", "--no-renames", "--no-ext-diff", "--no-textconv", BASE, "HEAD", "--"],
                  "base-delta-" + phase, cwd=ROOT, seconds=30, bound=16384).read_text().splitlines()
    expected = sorted(("M" if name == TEST_SOURCE else "A") + "\t" + name for name in CHANGED_SOURCES)
    if sorted(changes) != expected:
        raise RuntimeError("only exact parity test repair and two new CI paths may differ from difficulty base")
    status = run(["git", "status", "--porcelain", "--untracked-files=no"], "clean-" + phase,
                 cwd=ROOT, seconds=30, bound=16384).read_text()
    if status:
        raise RuntimeError("tracked candidate source/fixtures differ from committed bytes")
    for name in SOURCES:
        path = ROOT / name
        if path.is_symlink() or not path.is_file() or path.resolve() != path or not 0 < path.stat().st_size <= 4 << 20:
            raise RuntimeError("small source containment/size differs")
        if name in BASE_SOURCES and name != TEST_SOURCE:
            expected_hash, expected_bytes = BASE_SOURCES[name]
            if path.stat().st_size != expected_bytes or digest(path) != expected_hash:
                raise RuntimeError("unchanged dependency source differs from exact difficulty base: " + name)
    summary["base_conservation"] = {"tree": BASE_TREE, "changed_paths": CHANGED_SOURCES,
                                    "unchanged_small_sources": len(BASE_SOURCES) - 1, "phase": phase}

def main(summary):
    global STARTED_AT, DEADLINE, run_bounded
    epoch = os.environ.get("M9E_FOCUS_STARTED_AT", "")
    if not re.fullmatch(r"[0-9]{10}", epoch):
        raise RuntimeError("exact pre-checkout workflow timestamp required")
    elapsed = time.time() - int(epoch)
    if not 0 <= elapsed < 1780:
        raise RuntimeError("negative elapsed or setup exhausted shared budget/cleanup reserve")
    STARTED_AT = int(epoch)
    DEADLINE = time.monotonic() + 1800 - elapsed
    helper = ROOT / "scripts/ci/m9e_current_cost.py"
    helper_hash, helper_bytes = BASE_SOURCES["scripts/ci/m9e_current_cost.py"]
    if (helper.is_symlink() or not helper.is_file() or helper.resolve() != helper
            or helper.stat().st_size != helper_bytes or digest(helper) != helper_hash
            or "m9e_current_cost" in sys.modules):
        raise RuntimeError("pinned bounded helper differs or was preloaded")
    import m9e_current_cost
    if Path(m9e_current_cost.__file__).resolve() != helper:
        raise RuntimeError("bounded helper imported from wrong path")
    run_bounded = m9e_current_cost.run_bounded
    for key in ("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUST_MIN_STACK", "RUST_TEST_THREADS"):
        if os.environ.get(key):
            raise RuntimeError("ordinary default stack/threads and no injected compiler flags required")
    exact_test = (ROOT / TEST_SOURCE).read_bytes()
    if len(exact_test) != 30186 or hashlib.sha256(exact_test).hexdigest() != "b505ddf65cc96fb1ba08b5766ec09b3480f00d1895890f674bd24872d0390418":
        raise RuntimeError("exact audited fourth content cohort source required")
    addition = RECOIL_CONSTANT.encode()
    if exact_test.count(addition) != 1:
        raise RuntimeError("exact single added recoil cohort required")
    original = exact_test.replace(addition, b"").replace(b"        RECOIL_METADATA_PARITY,\n", b"")
    if hashlib.sha256(original).hexdigest() != "872a38b8774ef72e2e16c18c085d71a8714f8d54d9a7306d3cadfb48f231e977":
        raise RuntimeError("all original request, reference assertions, and prior constants must remain exact")
    os.environ.update(PROFILE)
    os.environ["GIT_NO_LAZY_FETCH"] = "1"
    summary["started_at"] = STARTED_AT
    summary["elapsed_before_producer_seconds"] = elapsed
    summary["limits"] = {"command_seconds": 600, "cohort_target_seconds": 600,
                         "shared_seconds_including_checkout": 1800, "cleanup_reserve_seconds": 20,
                         "compact_bytes": 32768, "failure_bytes": 24576, "format_patch_bytes": 262144}
    if not re.fullmatch(r"[0-9a-f]{40}", summary["source_sha"]):
        raise RuntimeError("exact candidate SHA required")
    if run(["git", "rev-parse", "HEAD"], "head", cwd=ROOT, seconds=30, bound=16384).read_text().strip() != summary["source_sha"]:
        raise RuntimeError("exact candidate source required")
    summary["source_tree"] = run(["git", "rev-parse", "HEAD^{tree}"], "tree", cwd=ROOT, seconds=30, bound=16384).read_text().strip()
    source_conservation(summary, "before")
    summary["source_hashes"] = {path: digest(ROOT / path) for path in SOURCES}
    test = (ROOT / TEST_SOURCE).read_bytes()
    setup = test[test.index(b"fn safe("):test.index(b"const PRE_METADATA_PARITY:")]
    timers = test[test.index(b"fn timer_request("):]
    conserved = {
        "setup": (setup, 9701, "eb0fba9628cab497308ba175583a59cd9b9cecaa0a3ce1c8d8af92b50d0401ae"),
        "timers": (timers, 8721, "ee423bd0b2d618997877f16cd5476252cac79d3e00dbd226a3c35c697ad8b589"),
    }
    summary["preserved_original_source"] = {}
    for name, (body, size, expected) in conserved.items():
        if len(body) != size or hashlib.sha256(body).hexdigest() != expected:
            raise RuntimeError("unchanged original setup/timer source differs: " + name)
        summary["preserved_original_source"][name] = {"bytes": size, "sha256": expected}
    summary["compiler_configuration"] = dict(PROFILE)
    formatter = ["rustfmt", "+1.97.1", "--edition", "2024", "--config", "skip_children=true"]
    try:
        run([*formatter, "--check", str(ROOT / TEST_SOURCE)], "format", seconds=60, bound=262144)
    except Exception:
        run([*formatter, str(ROOT / TEST_SOURCE)], "format-repair", seconds=60, bound=262144)
        patch = run(["git", "diff", "--binary", "--", TEST_SOURCE], "format-patch", cwd=ROOT, seconds=30, bound=262144)
        shutil.copyfile(patch, FULL / "format.patch")
        summary.update(format_patch_bytes=patch.stat().st_size, format_patch_sha256=digest(patch), formatted_source_sha256=digest(ROOT / TEST_SOURCE))
        raise RuntimeError("remote formatting required; no parity qualification executed")
    tree = run(["git", "ls-tree", "-l", "HEAD", "--", BUNDLE_PATH], "new-cohort-tree", cwd=ROOT, seconds=30, bound=16384).read_text().split()
    if tree != ["100644", "blob", COHORTS["new"]["git_blob"], str(COHORTS["new"]["bytes"]), BUNDLE_PATH]:
        raise RuntimeError("candidate must contain exact published new bundle")
    verify_bundle(ROOT / BUNDLE_PATH, COHORTS["new"])
    execute_cohort("new", summary)
    if any(digest(ROOT / path) != value for path, value in summary["source_hashes"].items()):
        raise RuntimeError("actual source changed during diagnostic")
    source_conservation(summary, "after")
    execute_new_wasm(summary)
    if any(digest(ROOT / path) != value for path, value in summary["source_hashes"].items()):
        raise RuntimeError("actual source changed during Wasm qualification")
    source_conservation(summary, "after-wasm")
    summary["qualified_invocations"] = {"new_native": 2, "new_wasm": 2}


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": BASE, "cohorts": {},
               "preimage_diagnostic": {"source_sha": "d9d92af3e28dd9b7f5cedd5f89fe6abcfcf16ffa", "run_id": "34283489737",
                   "summary_sha256": "91200a0ac4d655779dc9282de15f353b18c08b0070286a392ffb502ca717e23d",
                   "actual_events": 30, "decoded_materials_per_cohort": 6, "difference_paths": 31, "omitted_paths": 0},
               "qualification": "current published content: complete two native and two Wasm parity tests; historical old-content constants unchanged and not requalified; not full M9"}
    try:
        main(summary)
        summary["status"] = "passed"
    except Exception as error:
        summary["failure"] = str(error)[:2048]
    finally:
        try:
            cleanup_owned_targets()
            summary["cleanup"] = {"owned_targets_removed": True, "contained": True}
            if DEADLINE is None or time.monotonic() > DEADLINE:
                raise RuntimeError("final owned cleanup exceeded pre-checkout shared deadline")
            summary["post_cleanup_deadline_checked"] = True
        except Exception as error:
            summary["status"] = "failed"
            summary["cleanup_failure"] = str(error)[:2048]
    if summary["status"] != "passed":
        message = (summary.get("failure", summary.get("cleanup_failure", "diagnostic failed")) + "\nBounded tail; complete qualification logs remain remote.\n").encode()[:4096]
        tail = b""
        if failed_log is not None and failed_log.is_file():
            with failed_log.open("rb") as stream:
                allowance = 24576 - len(message)
                stream.seek(max(0, failed_log.stat().st_size - allowance))
                tail = stream.read(allowance)
        (COMPACT / "failure.txt").write_bytes(message + tail)
    summary["logs"] = logs
    summary["elapsed_seconds_including_checkout"] = None if STARTED_AT is None else time.time() - STARTED_AT
    data = encoded(summary) + b"\n"
    if len(data) > 32768:
        raise RuntimeError("qualification receipt exceeds32KiB")
    (COMPACT / "summary.json").write_bytes(data)
    raise SystemExit(0 if summary["status"] == "passed" else 1)
