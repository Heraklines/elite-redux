"""Remote focused proof of independent Title setup across real Workers and RTC."""
import base64
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import time

from m9e_current_cost import run_bounded

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-rtc-rebind-regression-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
OUTPUT = REPORT / "web"
START = int(os.environ["M9E_FOCUS_STARTED_AT"])
DEADLINE = time.monotonic() + 1780 - (time.time() - START)
EXAMPLE = "rust/crates/er-web/examples/m9e_v7_coop_startup.rs"
SPEC = "test/browser/rust-browser/m9e-v7-rebind-rtc-owner.spec.ts"
CASE_IDS = {
    "m9e-v7-coop-startup.spec.ts": [
        "natural cooperative Title through two Workers and RTC host ready first",
        "natural cooperative Title through two Workers and RTC guest ready first",
        "owned natural co-op public retry recovers a pending proposal after disconnected snapshot restore through six Workers"],
    "m9e-v7-worker-rtc.spec.ts": [
        "two current Workers exchange real RTC proposals and converge one natural checkpoint turn",
        "current RTC identity mismatch and stalled presentation teardown settle owned work"],
    "m9e-v7-rebind.spec.ts": ["current V7 Workers replay owned generation two rebind and continue natural gameplay"],
    "m9e-v7-rebind-rtc.spec.ts": ["current V7 Workers physically reconnect RTC generation two and replay continued natural gameplay"],
    "m9e-v7-rebind-rtc-transport.spec.ts": ["current V7 generation-bound RTC transport reconnects and replays natural Worker gameplay"],
    "m9e-v7-rebind-rtc-owner.spec.ts": ["current V7 RTC owner automatically rebinds and continues natural gameplay across fresh connections"],
}
SPECS = ["test/browser/rust-browser/" + name for name in CASE_IDS]
IDS = sorted(title for titles in CASE_IDS.values() for title in titles)
SOURCES = [EXAMPLE, SPEC, "scripts/ci/m9e_rtc_rebind_regression.py", ".github/workflows/m9e-rtc-rebind-regression-focused.yml",
           "src/rust-browser/contracts/browser-contracts-v2.ts", "src/rust-browser/contracts/browser-contracts.ts",
           "src/rust-browser/routes/rust-current-rtc-entry.ts", "src/rust-browser/adapters/current-rtc-transport.ts",
           "src/rust-browser/routes/rust-current-worker-entry.ts", "src/rust-browser/routes/browser-effects-v2.ts",
           "src/rust-browser/host/current-rust-browser-host.ts",
           "src/rust-browser/worker/current-rust-kernel-worker.ts", "src/rust-browser/worker/rust-wasm-loader.ts",
           "scripts/build-kernel-m9e-v7-web.mjs", "rust/crates/er-web/examples/m9e_v7_browser_fixtures.rs",
           "rust/crates/er-web/src/contracts_v2.rs", "rust/crates/er-web/src/host_v2.rs",
           "rust/crates/er-kernel/src/current_coop_setup_v7.rs", "rust/crates/er-kernel/src/game_kernel_v7.rs",
           "rust/crates/er-kernel/src/snapshot_v7.rs", "rust/crates/er-kernel/src/current_proposal_v7.rs",
           "rust/crates/er-game/src/m9e_new_run_v6.rs",
           "rust/crates/er-game/src/m72_bootstrap.rs", "rust/crates/er-env/src/current.rs",
           "rust/crates/er-repro/src/current.rs", "rust/rust-toolchain.toml", "rust/Cargo.lock", "rust/Cargo.toml",
           "rust/crates/er-web/Cargo.toml", "pnpm-lock.yaml", "package.json", ".nvmrc",
           "playwright.rust-browser.config.ts", "scripts/ci/m9e_current_cost.py"]
SOURCES += ["rust/crates/er-state/src/m9e_state_v6.rs", "rust/crates/er-game/src/m9e_runtime_v6.rs", "rust/crates/er-game/src/m9e_material_v6.rs"]
SOURCES += ["rust/crates/er-battle/src/m7_resolver.rs", "test/browser/rust-browser/m9e-v7-rebind.spec.ts", "rust/crates/er-kernel/src/current_coop_rebind_v7.rs", "src/rust-browser/adapters/current-rtc-transport-v2.ts", "test/browser/rust-browser/m9e-v7-rebind-rtc.spec.ts", "src/rust-browser/routes/rust-current-rtc-rebind-entry.ts", "test/browser/rust-browser/m9e-v7-rebind-rtc-transport.spec.ts"]
SOURCES = list(dict.fromkeys([*SOURCES, *SPECS, *["rust/crates/er-ai/src/lib.rs","rust/crates/er-ai/src/m9e_standard_attack_score.rs","rust/crates/er-ai/tests/m9e_standard_attack_score.rs","rust/crates/er-game/src/lib.rs","rust/crates/er-game/src/m9e_ai_score_query.rs","rust/crates/er-game/tests/m9e_damage_query.rs","scripts/ci/m9e_standard_score_oracle.mjs"]]))
QUALIFIED_COMPOSITION = {"scripts/build-kernel-m9e-v7-web.mjs":"77b07ef5a2380f2e77d142e55c76d50518feea9ee6f494e3d3f04c31bea71a40","src/rust-browser/adapters/current-rtc-transport-v2.ts":"c68e2841a9253d20999d8fd2953f80dff10a331e90dc59bba945382e18d80583","src/rust-browser/routes/rust-current-rtc-entry.ts":"fac80f7f8187b4402f0f301f77b6b704e03c30caba5009ec3fb43d11b34116ce","src/rust-browser/routes/rust-current-rtc-rebind-entry.ts":"25c761e8ce7a7bcb952705bbc7349a2c51753359ca5bcea1ec8da28d49660246","test/browser/rust-browser/m9e-v7-rebind-rtc.spec.ts":"e885cebed362131d3855b96045618318a697430db17c698542950c17c1ee6ad4","test/browser/rust-browser/m9e-v7-rebind-rtc-transport.spec.ts":"fcb5a647eb519e5283015d11e11b26bb5077654d0e31209bf97dbc093d240bec","test/browser/rust-browser/m9e-v7-rebind-rtc-owner.spec.ts":"1006b81a1ac367ca94eb9988fcbc864c5fd22981c0bff3ca3c80d2444386225f","rust/crates/er-ai/src/lib.rs":"074580cf161ef7068fe45b9e57ed4ea7d4967873c8d3111cae62ded358d59d27","rust/crates/er-ai/src/m9e_standard_attack_score.rs":"de8ee5e4b81fdc20137f3a451350d7dca06364acc600d57762059fb53e9754ea","rust/crates/er-ai/tests/m9e_standard_attack_score.rs":"c6f4c624b218f87c16693aa2ae549dc5d822339ea6fac7adfa01807100c5999a","rust/crates/er-game/src/lib.rs":"eb7889d78ded4c5d86bda24e85d99ac8b767e5d938512dcbbcbf85d9543ef15e","rust/crates/er-game/src/m9e_ai_score_query.rs":"6b5b008bd60607ae1ae9de2c1fc508968fe585c42e390ae75cb38b18ef2f49fa","rust/crates/er-game/tests/m9e_damage_query.rs":"8a248df5313aecaa109c582d63cd9014f7223c9a45e85cda772073183e1d1996","scripts/ci/m9e_standard_score_oracle.mjs":"9aca9f070392b1f442face1ea9d9df6832cc81c7b79d0ef93d990206dccdf513"}
logs = {}
failed_log = None


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(args, name, seconds=900, bound=16 << 20):
    global failed_log
    output = FULL / f"{len(logs) + 1:03d}-{name}.log"
    try:
        result = run_bounded(args, cwd=ROOT, environment=dict(os.environ), output=output,
                             seconds=seconds, byte_limit=bound, global_deadline=DEADLINE)
    except Exception:
        failed_log = output
        raise
    logs[name] = {key: result[key] for key in ("bytes", "sha256", "elapsed_seconds")}
    return output


def asset(path, maximum):
    if path.is_symlink() or not path.is_file() or path.resolve().parent != OUTPUT.resolve() or not 0 < path.stat().st_size <= maximum:
        raise RuntimeError("bounded contained actual asset required")
    return {"bytes": path.stat().st_size, "sha256": digest(path)}


def main(summary):
    sha = os.environ["GITHUB_SHA"]
    if run(["git", "rev-parse", "HEAD"], "identity", 30, 16384).read_text().strip() != sha:
        raise RuntimeError("exact candidate required")
    changes = run(["git", "diff", "--name-only", "0d117f5942289c4ca906f9dd345ca0378b14c72a", "HEAD"], "source-delta", 30, 16384).read_text().splitlines()
    if sorted(changes) != sorted([".github/workflows/m9e-rtc-rebind-regression-focused.yml","scripts/build-kernel-m9e-v7-web.mjs","scripts/ci/m9e_rtc_rebind_regression.py","src/rust-browser/adapters/current-rtc-transport-v2.ts","src/rust-browser/routes/rust-current-rtc-entry.ts","src/rust-browser/routes/rust-current-rtc-rebind-entry.ts","test/browser/rust-browser/m9e-v7-rebind-rtc-owner.spec.ts","test/browser/rust-browser/m9e-v7-rebind-rtc-transport.spec.ts","test/browser/rust-browser/m9e-v7-rebind-rtc.spec.ts"]):
        raise RuntimeError("only seven qualified RTC sources and two focused CI sources may change")
    summary["base_sha"] = "0d117f5942289c4ca906f9dd345ca0378b14c72a"
    summary["source_hashes"] = {path: digest(ROOT / path) for path in SOURCES}
    if any(summary["source_hashes"].get(path) != expected for path, expected in QUALIFIED_COMPOSITION.items()):
        raise RuntimeError("qualified RTC and AI source composition differs")
    summary["source_tree"] = run(["git", "rev-parse", "HEAD^{tree}"], "tree", 30, 16384).read_text().strip()
    formatter = ["rustfmt", "+1.97.1", "--edition", "2024", "--config", "skip_children=true"]
    try:
        run([*formatter, "--check", EXAMPLE], "format", 60, 262144)
    except Exception:
        run([*formatter, EXAMPLE], "format-repair", 60, 262144)
        patch = run(["git", "diff", "--binary", "--", EXAMPLE], "format-patch", 30, 262144)
        shutil.copyfile(patch, FULL / "format.patch")
        summary["formatted_hashes"] = {EXAMPLE: digest(ROOT / EXAMPLE)}
        summary["format_patch_bytes"] = patch.stat().st_size
        summary["format_patch_sha256"] = digest(patch)
        raise RuntimeError("remote pinned formatting required; no qualification")
    run(["cargo", "clippy", "--manifest-path", "rust/Cargo.toml", "--locked", "-p", "er-web",
         "--example", "m9e_v7_coop_startup", "--no-deps", "--", "-D", "warnings"], "clippy")
    run(["pnpm", "install", "--frozen-lockfile"], "dependencies")
    run(["pnpm", "exec", "tsc", "--ignoreConfig", "--noEmit", "--skipLibCheck", "--strict", "--target", "ESNext", "--module", "ESNext",
         "--moduleResolution", "bundler", "--lib", "ESNext,DOM", "--types", "node,vite/client",
         "src/rust-browser/routes/rust-current-rtc-entry.ts", *SPECS], "typecheck", 120)
    if shutil.which("wasm-bindgen") is None:
        run(["cargo", "install", "wasm-bindgen-cli", "--version", "0.2.127", "--locked"], "wasm-tools")
    if run(["wasm-bindgen", "--version"], "wasm-version", 30, 16384).read_text().strip() != "wasm-bindgen 0.2.127":
        raise RuntimeError("pinned Wasm CLI required")
    os.environ.update({"M9E_BUILD_CURRENT_WORKER": "1", "M9E_BUILD_CURRENT_RTC": "1"})
    run(["node", "scripts/build-kernel-m9e-v7-web.mjs", "--out-dir", str(OUTPUT)], "platform-build")
    execute_prepared(summary)


def execute_prepared(summary, *, install_chromium=True):
    """Same assertions and actual journeys for F and same-candidate integration."""
    sha = os.environ["GITHUB_SHA"]
    run(["cargo", "run", "--manifest-path", "rust/Cargo.toml", "--locked", "-p", "er-web", "--example",
         "m9e_v7_coop_startup", "--", str(OUTPUT)], "natural-inputs")
    setup = {"schema_version": 1, "source_sha": sha, "assets": {
        name: asset(OUTPUT / name, 65536) for name in ("coop-host-initialization.json", "coop-guest-initialization.json")}}
    (OUTPUT / "m9e-v7-coop-startup-assets.json").write_text(json.dumps(setup, sort_keys=True) + "\n")
    summary["initializations"] = setup
    summary["setup_manifest_sha256"] = digest(OUTPUT / "m9e-v7-coop-startup-assets.json")
    manifests = {}
    for name in ("m9e-v7-web-assets.json", "m9e-v7-rtc-assets.json", "m9e-v7-worker-assets.json"):
        asset(OUTPUT / name, 16384)
        value = json.loads((OUTPUT / name).read_text())
        if value.get("source_sha") != sha or value.get("schema_version") != 1:
            raise RuntimeError("actual platform manifest source mismatch")
        for path, metadata in value["assets"].items():
            if Path(path).name != path or asset(OUTPUT / path, 32 << 20) != {key: metadata[key] for key in ("bytes", "sha256")}:
                raise RuntimeError("actual platform asset mismatch")
        if any(digest(ROOT / path) != expected for path, expected in value.get("source_hashes", {}).items()):
            raise RuntimeError("actual bundle source mismatch")
        manifests[name] = value
        shutil.copyfile(OUTPUT / name, FULL / name)
    rtc = manifests["m9e-v7-rtc-assets.json"]
    summary["platform"] = {"manifest_sha256": digest(OUTPUT / "m9e-v7-rtc-assets.json"), "worker": rtc["worker"],
                            "assets": rtc["assets"], "cohort": rtc["cohort"], "source_sha": sha}
    retained = {path.name: digest(path) for path in OUTPUT.iterdir() if path.is_file()}
    if install_chromium:
        run(["pnpm", "exec", "playwright", "install", "--with-deps", "chromium"], "chromium")
    os.environ["M9E_V7_WEB_DIR"] = str(OUTPUT)
    os.environ["PLAYWRIGHT_JSON_OUTPUT_FILE"] = str(FULL / "browser-results.json")
    run(["pnpm", "exec", "playwright", "test", "--config", "playwright.rust-browser.config.ts", "--project=chromium",
         *SPECS, "--workers=2", "--reporter=line,json"], "browser", 900)
    report = json.loads((FULL / "browser-results.json").read_text())
    specs = []
    def collect(suite):
        specs.extend(suite.get("specs", []))
        for child in suite.get("suites", []):
            collect(child)
    for suite in report.get("suites", []):
        collect(suite)
    if report.get("errors") or len(specs) != 9 or sorted(spec["title"] for spec in specs) != IDS:
        raise RuntimeError("all nine exact RTC/rebind cases required")
    stats = report["stats"]
    if stats.get("expected") != 9 or any(stats.get(key) != 0 for key in ("unexpected", "flaky", "skipped")):
        raise RuntimeError("whole regression must pass without retries or skips")
    evidence = []
    for spec in specs:
        filename = Path(spec["file"]).name
        if filename not in CASE_IDS or spec["title"] not in CASE_IDS[filename] or len(spec.get("tests", [])) != 1:
            raise RuntimeError("exact whole source/test mapping required")
        test = spec["tests"][0]
        results = test.get("results", [])
        if test.get("expectedStatus") != "passed" or test.get("status") != "expected" or test.get("projectName") != "chromium" or len(results) != 1 or results[0].get("status") != "passed" or results[0].get("retry") != 0:
            raise RuntimeError("sole actual successful Chromium execution required")
        result = results[0]
        attachments = []
        for attachment in result.get("attachments", []):
            if set(attachment) != {"name", "contentType", "body"} or attachment["contentType"] not in ("application/json", "application/octet-stream"):
                raise RuntimeError("complete bounded inline case attachment required")
            raw = base64.b64decode(attachment["body"], validate=True)
            if not 0 < len(raw) <= 131072:
                raise RuntimeError("individual runtime attachment exceeds128KiB")
            attachments.append({"name": attachment["name"], "content_type": attachment["contentType"],
                                "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
        if not attachments:
            raise RuntimeError("every actual case must emit its existing receipt")
        evidence.append({"file": filename, "title": spec["title"], "duration_ms": result["duration"], "attachments": attachments})
    if any(digest(OUTPUT / path) != expected for path, expected in retained.items()):
        raise RuntimeError("actual platform inputs changed during regression")
    if any(digest(ROOT / path) != expected for path, expected in summary["source_hashes"].items()):
        raise RuntimeError("source changed during regression")
    summary["browser_report"] = {"bytes": (FULL / "browser-results.json").stat().st_size,
                                 "sha256": digest(FULL / "browser-results.json")}
    summary["browser_evidence"] = evidence
    summary["tests"] = {"passed": 9, "failed": 0, "skipped": 0, "ids": IDS}


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "qualification": "all nine existing RTC and rebind cases on unchanged qualified owner products; focused cross-case regression, not full M9 qualification"}
    try:
        main(summary)
        if time.monotonic() > DEADLINE:
            raise RuntimeError("global deadline exceeded")
        summary["status"] = "passed"
    except Exception as error:
        summary["failure"] = str(error)
        tail = b""
        if failed_log is not None and failed_log.is_file():
            with failed_log.open("rb") as stream:
                stream.seek(max(0, failed_log.stat().st_size - 24000))
                tail = stream.read(24000)
        (FULL / "failure.txt").write_text(str(error) + "\nBounded tail; complete logs remain remote.\n" + tail.decode("utf-8", errors="replace"))
    finally:
        summary["logs"] = logs
        summary["elapsed_seconds_including_checkout"] = time.time() - START
        summary["run_attempt"] = os.environ["GITHUB_RUN_ATTEMPT"]
        raw = json.dumps(summary, sort_keys=True, separators=(",", ":")).encode() + b"\n"
        if len(raw) > 32768:
            raise RuntimeError("compact result exceeds32KiB")
        (COMPACT / "summary.json").write_bytes(raw)
    raise SystemExit(0 if summary["status"] == "passed" else 1)
