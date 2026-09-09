"""One instrumented actual guest-first RTC journey; diagnostic, never qualification."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-rtc-startup-journal"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
OUTPUT = REPORT / "web"
BASE = "edb3a8d1677b271f992b54c56b46b79de18016a4"
SPEC = "test/browser/rust-browser/m9e-v7-coop-startup.spec.ts"
PRODUCER = "scripts/ci/m9e_rtc_startup_journal.py"
WORKFLOW = ".github/workflows/m9e-rtc-startup-journal-focused.yml"
TEST = "natural cooperative Title through two Workers and RTC guest ready first"
START_TEXT = os.environ.get("M9E_FOCUS_STARTED_AT", "")
if re.fullmatch(r"[0-9]{10}", START_TEXT) is None:
    raise RuntimeError("strict pre-checkout timestamp required")
START = int(START_TEXT)
ELAPSED = time.time() - START
if not 0 <= ELAPSED < 1780:
    raise RuntimeError("invalid elapsed time")
DEADLINE = time.monotonic() + 1780 - ELAPSED
FINAL_DEADLINE = DEADLINE + 20
BASE_SOURCES = {
  ".nvmrc": [
    "ca60797658d7260e78179fff372eda677f04040820d398ccbebb2934e85dc16f",
    7
  ],
  "package.json": [
    "b29655956a73f24aaff59781b9352f937598123900589d055abf1a10fd12f903",
    6588
  ],
  "playwright.rust-browser.config.ts": [
    "27e17af1a4ae26ec6c4a705891f8448fa0616875ce1643fcb1a7c2595a27e68e",
    742
  ],
  "pnpm-lock.yaml": [
    "dcbcaf6df44509c71b28becffdd70b33a7410a0873f5b1297ede84150a6effff",
    145307
  ],
  "rust/Cargo.lock": [
    "9e7f2e2a96e9b191015b567c4bb1bd7f3457b0dbebc563394e354f5f132c65dc",
    32083
  ],
  "rust/Cargo.toml": [
    "fdefad8953caa82922a4f3e86560d3543f9d1ef69edada7bc1dcc16ae3a5ade9",
    1615
  ],
  "rust/crates/er-battle/src/m7_resolver.rs": [
    "6df83bf311d6eb5e5f6d68e1b0d60be27020ea962e901e11304b67f769deb72b",
    48524
  ],
  "rust/crates/er-cli/tests/m9e_current_coop_rebind.rs": [
    "517ccae76abd95ec23ebffd226dc82ec6c74a27c6466e13c44c6fe2a3bed4330",
    32914
  ],
  "rust/crates/er-env/src/current.rs": [
    "44f79c9ec052de14e977c97588fdf2fe30cc04e7fc94fad524a5622ef8d3e574",
    14593
  ],
  "rust/crates/er-game/src/m72_bootstrap.rs": [
    "54369e34edc90a194f425e677a21e3ba7ce64dff46a4af9b688e4821a511dccc",
    30759
  ],
  "rust/crates/er-game/src/m9e_material_v6.rs": [
    "7ebefdf8fd78878154564554a1d566b02246578a6d22198e9540a7a0f6add835",
    24238
  ],
  "rust/crates/er-game/src/m9e_new_run_v6.rs": [
    "0492d70d097430519514f2b195ca31483e4dc019ab474d48b1fe7a016ce49dea",
    39662
  ],
  "rust/crates/er-game/src/m9e_runtime_v6.rs": [
    "b910e8a9a708942ea4df944106204817f9664dae83c320fa7eb962a00a1e6327",
    114036
  ],
  "rust/crates/er-kernel/src/current_coop_rebind_v7.rs": [
    "73f8f76e5ce3181682f519170599023ee41584dc95f1e00db47e3ca45393b086",
    36143
  ],
  "rust/crates/er-kernel/src/current_coop_setup_v7.rs": [
    "c4e8dbeef2a41d4e316d5aac6082feff132348a4e8cd8cbb0620bab1682b37b7",
    29287
  ],
  "rust/crates/er-kernel/src/current_proposal_v7.rs": [
    "98cd877c1d54e3e2a7d9f388423b14e63a2ce89fcb42514f59e6ac48fa2ffa1e",
    24802
  ],
  "rust/crates/er-kernel/src/game_kernel_v7.rs": [
    "0a8cd79f25bae24a589bd6c38682708fa8816787241c83e534f746b707ce5ae0",
    161847
  ],
  "rust/crates/er-kernel/src/snapshot_v7.rs": [
    "e247dbf85f7d473f9d02d54b08f0b86d5630aa37bfd39e5645ef7b3366449e7a",
    22224
  ],
  "rust/crates/er-kernel/tests/m9e_current_proposal_v7.rs": [
    "0e8c3d8aa0e6083ccedb9529f797cedcda3dd8a163ca8f46310d484b1a497646",
    50543
  ],
  "rust/crates/er-kernel/tests/m9e_snapshot_v7.rs": [
    "1ad4f345710c3ee4bd8333ce5b5d089a4838a5338efce32d37cf6ef8c249b70f",
    8741
  ],
  "rust/crates/er-repro/src/current.rs": [
    "f10b89069fb1b77df738490e5336e1ebd5f342f35afd7bcf1e1eba69e3359c74",
    38113
  ],
  "rust/crates/er-state/src/m9e_state_v6.rs": [
    "6e0937529780f4cb50c65122173a68820c4823bdfb9569ff8b46583cf9d8e9fb",
    16401
  ],
  "rust/crates/er-web/Cargo.toml": [
    "5f42905bb819359deae3b08998cc80a5576e501cd5be23e25c7d6dad39b8f613",
    852
  ],
  "rust/crates/er-web/examples/m9e_v7_browser_fixtures.rs": [
    "643660849fd654c41f3820e509d5be3760680f9378d1bededc607ffa8fc56f5c",
    8614
  ],
  "rust/crates/er-web/examples/m9e_v7_coop_startup.rs": [
    "04aa90df973ee798f94f8de41652d54a93da4d4d4010f45bba6b44699d14a262",
    6231
  ],
  "rust/crates/er-web/src/contracts_v2.rs": [
    "132fc40b4d16a1b7edc99f506361c0e979bbd19b50e38a222b14979b637a5aaf",
    7593
  ],
  "rust/crates/er-web/src/host_v2.rs": [
    "ede1c513d7fc80e06736f595e83b971c68ea0011bb728df51055589a7b5e572a",
    51582
  ],
  "rust/rust-toolchain.toml": [
    "0241de2190a0c1959d4ad182dfa6943b7ab9bd577dc8ef9b0fe7502d191835ec",
    123
  ],
  "scripts/build-kernel-m9e-v7-web.mjs": [
    "77b07ef5a2380f2e77d142e55c76d50518feea9ee6f494e3d3f04c31bea71a40",
    7663
  ],
  "scripts/ci/m9e_current_cost.py": [
    "5a25e98778cc7103375a5342600c4bc6e5a22252935f435f847e6434f00e7cd8",
    38620
  ],
  "src/rust-browser/adapters/current-rtc-transport-v2.ts": [
    "c68e2841a9253d20999d8fd2953f80dff10a331e90dc59bba945382e18d80583",
    14802
  ],
  "src/rust-browser/adapters/current-rtc-transport.ts": [
    "2aaa23b786063bac10fe0863e894f8fb682e7fc1f6b6ae0347512d860e0195ce",
    14594
  ],
  "src/rust-browser/contracts/browser-contracts-v2.ts": [
    "38d33611663354f6665d6bc32840628a4e563e3e8db68e5692a2db9a9103b50c",
    10574
  ],
  "src/rust-browser/contracts/browser-contracts.ts": [
    "b630f4964adf81b822d35f3718e0629f1111697922a414cf56d29adb19cfeaf3",
    4539
  ],
  "src/rust-browser/host/current-rust-browser-host.ts": [
    "43d193bedf86093e5eda2d48e9cb3dad6b5e2695aae569c0ea7afa37d5817de8",
    10245
  ],
  "src/rust-browser/routes/browser-effects-v2.ts": [
    "88e233f9025c5de3b201f37656687a2f161ac4b7ec916dd1a4e215a71e5556d2",
    3426
  ],
  "src/rust-browser/routes/rust-current-rtc-entry.ts": [
    "fac80f7f8187b4402f0f301f77b6b704e03c30caba5009ec3fb43d11b34116ce",
    22852
  ],
  "src/rust-browser/routes/rust-current-rtc-rebind-entry.ts": [
    "25c761e8ce7a7bcb952705bbc7349a2c51753359ca5bcea1ec8da28d49660246",
    26096
  ],
  "src/rust-browser/routes/rust-current-worker-entry.ts": [
    "1295712d83ec1a4f4352b392eba71d3f260cda988cea302720b5c560da1502bc",
    898
  ],
  "src/rust-browser/worker/current-rust-kernel-worker.ts": [
    "3baf6c8745fb7f8665af29d0907ef1054428ae382e19ff41518c9666d708042a",
    6039
  ],
  "src/rust-browser/worker/rust-wasm-loader.ts": [
    "181e66b054197461ec178263597e236ed3866ccbb44de5d6e3d4e03ac1dd4a15",
    7555
  ],
  "test/browser/rust-browser/m9e-v7-coop-startup.spec.ts": [
    "c6d2ef1026b4b61acdf3f71e35dea511d9d576d404e4c64c1adb23b8faa49ae8",
    46657
  ],
  "test/browser/rust-browser/m9e-v7-rebind.spec.ts": [
    "c78de6931901a072c18743af440d24abc5a7436636212899a28ca676cb5925d1",
    25532
  ]
}
SPEC_PREFIX_SHA256 = "c6d2ef1026b4b61acdf3f71e35dea511d9d576d404e4c64c1adb23b8faa49ae8"
logs = {}
run_bounded = None


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(argv, name, seconds=600, cap=16 << 20):
    path = FULL / f"{len(logs) + 1:03d}-{name}.log"
    receipt = {"argv": argv, "seconds_cap": seconds, "byte_cap": cap}
    started = time.monotonic()
    try:
        result = run_bounded(argv, cwd=ROOT, environment=dict(os.environ), output=path,
                             seconds=seconds, byte_limit=cap, global_deadline=DEADLINE)
        receipt.update({key: result[key] for key in ("bytes", "sha256", "elapsed_seconds")})
        receipt["passed"] = True
    except Exception:
        receipt.update({"passed": False, "elapsed_seconds": time.monotonic() - started})
        if path.is_file():
            receipt.update({"bytes": path.stat().st_size, "sha256": digest(path)})
        raise
    finally:
        logs[name] = receipt
    return path


def asset(name, maximum):
    path = OUTPUT / name
    if Path(name).name != name or path.is_symlink() or not path.is_file() or path.resolve().parent != OUTPUT.resolve():
        raise RuntimeError("contained asset required")
    if not 0 < path.stat().st_size <= maximum:
        raise RuntimeError("bounded asset required")
    return {"bytes": path.stat().st_size, "sha256": digest(path)}


def read_report(summary):
    path = FULL / "browser-results.json"
    if not path.is_file() or not 0 < path.stat().st_size <= 262144:
        raise RuntimeError("bounded single-case report required")
    report = json.loads(path.read_bytes())
    specs = []
    def walk(suite):
        specs.extend(suite.get("specs", []))
        for child in suite.get("suites", []):
            walk(child)
    for suite in report.get("suites", []):
        walk(suite)
    if len(specs) != 1 or specs[0]["title"] != TEST or len(specs[0]["tests"]) != 1:
        raise RuntimeError("exact single guest-first case required")
    test = specs[0]["tests"][0]
    results = test.get("results", [])
    if test.get("expectedStatus") != "passed" or len(results) != 1 or results[0].get("retry") != 0:
        raise RuntimeError("one actual execution and no retry required")
    result = results[0]
    summary["browser"] = {"id": TEST, "status": result["status"], "retry": 0,
        "duration_ms": result["duration"], "report_bytes": path.stat().st_size,
        "report_sha256": digest(path), "errors": [str(error.get("message", ""))[:1024] for error in result.get("errors", [])[:2]]}
    attachments = [value for value in result.get("attachments", []) if value.get("name") == "m9e-rtc-startup-kind-journal"]
    if len(attachments) != 1 or attachments[0].get("contentType") != "application/json":
        raise RuntimeError("sole actual startup journal required")
    raw = base64.b64decode(attachments[0]["body"], validate=True)
    if not 0 < len(raw) <= 32768:
        raise RuntimeError("bounded journal required")
    journal = json.loads(raw)
    if journal.get("schema_version") != 1 or journal.get("source_sha") != os.environ["GITHUB_SHA"] or len(journal.get("journals", [])) != 2:
        raise RuntimeError("exact journal source/two peers required")
    for peer in journal["journals"]:
        if peer.get("overflow") is not False or not 1 <= len(peer.get("journal", [])) <= 96:
            raise RuntimeError("complete bounded journal required")
        for event in peer["journal"]:
            if set(event) - {"t", "event", "owner", "kind", "q", "a"}:
                raise RuntimeError("non-scalar journal field")
            if not isinstance(event["event"], str) or len(event["event"]) > 64:
                raise RuntimeError("bounded event label required")
    summary["journal"] = journal
    summary["journal_sha256"] = hashlib.sha256(raw).hexdigest()
    summary["journal_bytes"] = len(raw)
    (FULL / "startup-journal.json").write_bytes(raw)


def main(summary):
    global run_bounded
    helper = ROOT / "scripts/ci/m9e_current_cost.py"
    if helper.is_symlink() or helper.resolve() != helper or helper.stat().st_size != BASE_SOURCES["scripts/ci/m9e_current_cost.py"][1] or digest(helper) != BASE_SOURCES["scripts/ci/m9e_current_cost.py"][0] or "m9e_current_cost" in sys.modules:
        raise RuntimeError("trusted runner source required before import")
    import m9e_current_cost
    if Path(m9e_current_cost.__file__).resolve() != helper:
        raise RuntimeError("runner import mismatch")
    run_bounded = m9e_current_cost.run_bounded
    sha = os.environ["GITHUB_SHA"]
    if run(["git", "rev-parse", "HEAD"], "identity", 30, 16384).read_text().strip() != sha:
        raise RuntimeError("candidate mismatch")
    delta = run(["git", "diff", "--name-only", BASE, "HEAD"], "delta", 30, 16384).read_text().splitlines()
    if sorted(delta) != sorted([SPEC, PRODUCER, WORKFLOW]):
        raise RuntimeError("only test instrumentation and two CI sources may differ")
    summary["source_tree"] = run(["git", "rev-parse", "HEAD^{tree}"], "tree", 30, 16384).read_text().strip()
    summary["source_hashes"] = {}
    for path, (expected, size) in BASE_SOURCES.items():
        actual = ROOT / path
        if actual.is_symlink() or actual.resolve() != actual or not actual.is_file() or actual.stat().st_size > 4 << 20:
            raise RuntimeError("bounded source required")
        if path != SPEC and (digest(actual) != expected or actual.stat().st_size != size):
            raise RuntimeError("unchanged production source differs: " + path)
        summary["source_hashes"][path] = digest(actual)
    for path in (PRODUCER, WORKFLOW):
        summary["source_hashes"][path] = digest(ROOT / path)
    run(["pnpm", "install", "--frozen-lockfile"], "dependencies")
    run(["pnpm", "exec", "tsc", "--ignoreConfig", "--noEmit", "--skipLibCheck", "--strict", "--target", "ESNext", "--module", "ESNext", "--moduleResolution", "bundler", "--lib", "ESNext,DOM", "--types", "node,vite/client", SPEC], "typecheck", 120)
    if shutil.which("wasm-bindgen") is None:
        run(["cargo", "install", "wasm-bindgen-cli", "--version", "0.2.127", "--locked"], "wasm-tools")
    if run(["wasm-bindgen", "--version"], "wasm-version", 30, 16384).read_text().strip() != "wasm-bindgen 0.2.127":
        raise RuntimeError("pinned Wasm CLI required")
    os.environ.update({"M9E_BUILD_CURRENT_WORKER": "1", "M9E_BUILD_CURRENT_RTC": "1"})
    run(["node", "scripts/build-kernel-m9e-v7-web.mjs", "--out-dir", str(OUTPUT)], "platform-build")
    run(["cargo", "run", "--manifest-path", "rust/Cargo.toml", "--locked", "-p", "er-web", "--example", "m9e_v7_coop_startup", "--", str(OUTPUT)], "natural-inputs")
    setup = {"schema_version": 1, "source_sha": sha, "assets": {name: asset(name, 65536) for name in ("coop-host-initialization.json", "coop-guest-initialization.json")}}
    (OUTPUT / "m9e-v7-coop-startup-assets.json").write_text(json.dumps(setup, sort_keys=True) + "\n")
    summary["initializations"] = setup
    summary["manifests"] = {}
    for name in ("m9e-v7-web-assets.json", "m9e-v7-worker-assets.json", "m9e-v7-rtc-assets.json"):
        asset(name, 16384)
        value = json.loads((OUTPUT / name).read_bytes())
        if value.get("source_sha") != sha or value.get("schema_version") != 1:
            raise RuntimeError("actual candidate asset manifest required")
        for path, metadata in value["assets"].items():
            if asset(path, 32 << 20) != {key: metadata[key] for key in ("bytes", "sha256")}:
                raise RuntimeError("actual asset hash mismatch")
        if any(digest(ROOT / path) != expected for path, expected in value.get("source_hashes", {}).items()):
            raise RuntimeError("actual bundled source differs")
        summary["manifests"][name] = {"sha256": digest(OUTPUT / name), "bytes": (OUTPUT / name).stat().st_size}
        shutil.copyfile(OUTPUT / name, FULL / name)
    retained = {path.name: digest(path) for path in OUTPUT.iterdir() if path.is_file()}
    run(["pnpm", "exec", "playwright", "install", "--with-deps", "chromium"], "chromium")
    os.environ["M9E_V7_WEB_DIR"] = str(OUTPUT)
    os.environ["PLAYWRIGHT_JSON_OUTPUT_FILE"] = str(FULL / "browser-results.json")
    try:
        run(["pnpm", "exec", "playwright", "test", "--config", "playwright.rust-browser.config.ts", "--project=chromium", SPEC, "--grep", TEST + "$", "--workers=1", "--retries=0", "--reporter=line,json"], "browser", 600)
    finally:
        read_report(summary)
        if any(digest(OUTPUT / path) != expected for path, expected in retained.items()):
            raise RuntimeError("asset changed during actual diagnostic")
        if any(digest(ROOT / path) != expected for path, expected in summary["source_hashes"].items()):
            raise RuntimeError("source changed during actual diagnostic")


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"schema_version": 1, "status": "failed", "qualification": False, "source_sha": os.environ["GITHUB_SHA"], "base_sha": BASE, "run_id": os.environ["GITHUB_RUN_ID"], "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "single_journey_requested": True}
    try:
        main(summary)
        if time.monotonic() > DEADLINE:
            raise RuntimeError("shared work deadline exceeded")
        summary["status"] = "passed"
    except Exception as error:
        summary["failure"] = str(error)[:2048]
        (FULL / "failure.txt").write_text(str(error)[:2048] + "\n")
    finally:
        try:
            for owned, parent in ((ROOT / "rust/target", ROOT / "rust"), (OUTPUT, REPORT)):
                if owned.parent != parent or owned.is_symlink() or owned.resolve() != owned:
                    raise RuntimeError("contained cleanup owner required")
                if owned.exists():
                    shutil.rmtree(owned)
                if owned.exists():
                    raise RuntimeError("cleanup incomplete")
            if time.monotonic() > FINAL_DEADLINE:
                raise RuntimeError("cleanup deadline exceeded")
            summary["cleanup"] = {"contained": True, "removed": True, "deadline_checked": True}
        except Exception as error:
            summary["status"] = "failed"
            summary["cleanup_failure"] = str(error)[:512]
        summary["logs"] = logs
        summary["elapsed_seconds_including_checkout"] = time.time() - START
        summary["limits"] = {"command_seconds": 600, "work_seconds": 1780, "cleanup_seconds": 20, "summary_bytes": 32768, "journal_bytes": 32768, "report_bytes": 262144}
        raw = json.dumps(summary, sort_keys=True, separators=(",", ":")).encode() + b"\n"
        if len(raw) > 32768:
            raise RuntimeError("summary exceeds32KiB")
        (COMPACT / "summary.json").write_bytes(raw)
    raise SystemExit(0 if summary["status"] == "passed" else 1)
