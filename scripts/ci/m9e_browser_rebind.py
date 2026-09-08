"""Actual current-source seven-Worker rebind proof for full integration.

Validation helpers retain the independently qualified a22b focused assertions.
This module consumes this platform job's already built Worker and natural setup.
"""
import base64
import hashlib
import json
import os
import re
from pathlib import Path

SPEC = "test/browser/rust-browser/m9e-v7-rebind.spec.ts"
TEST_ID = "current V7 Workers replay owned generation two rebind and continue natural gameplay"
HELPER_PATH = "scripts/ci/m9e_browser_rebind.py"
ROOT = Path(__file__).resolve().parents[2]
FULL = ROOT
REPORT = ROOT
WEB = ROOT


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


SOURCE_PATHS = ["rust/crates/er-repro/src/current.rs","rust/crates/er-web/src/contracts_v2.rs","rust/crates/er-web/src/host_v2.rs","rust/crates/er-web/src/host_v2/rebind_transaction_tests.rs","src/rust-browser/contracts/browser-contracts-v2.ts","src/rust-browser/host/current-rust-browser-host.ts","test/browser/rust-browser/m9e-v7-rebind.spec.ts","test/browser/rust-browser/m9e-v7-worker.spec.ts","test/node/rust-browser/engineering/current-worker-codec.test.ts","scripts/ci/m9e_browser_rebind.py","rust/crates/er-web/examples/m9e_v7_coop_startup.rs","rust/rust-toolchain.toml","rust/Cargo.lock",".nvmrc","pnpm-lock.yaml","package.json"]

def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise RuntimeError("duplicate JSON field")
            result[key] = value
        return result
    def constant(_):
        raise RuntimeError("nonfinite JSON number")
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def bounded_file(path, root, maximum):
    if (not path.is_absolute() or path.is_symlink() or not path.is_file()
            or path.resolve() != path or not path.is_relative_to(root)
            or not 0 < path.stat().st_size <= maximum):
        raise RuntimeError("regular bounded file escapes owned root: " + str(path))
    return path.read_bytes()


def asset(name, maximum):
    if not re.fullmatch(r"[a-zA-Z0-9_.-]+", name):
        raise RuntimeError("flat emitted asset name required")
    raw = bounded_file(WEB / name, WEB, maximum)
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def validate_rebind(value, worker, source_sha, setup_hash):
    manifest = worker["manifest"]
    common = {"schema_version", "source_sha", "manifest_sha256", "entry_sha256", "worker_sha256", "worker_path",
              "glue_sha256", "wasm_sha256", "content_sha256", "browser_worker_protocol_version", "observed_worker_count"}
    extra = {"setup_manifest_sha256", "actual_workers", "disposed_workers", "generation", "transcript_controls",
             "startup_handoff_snapshots", "startup_handoff_verified",
             "raw_inputs", "presentations", "rebind_attempts", "known_rejections", "final_snapshot_sha256",
             "capsule_sha256", "proposal_sha256", "receipt_sha256", "midphase_replay", "final_replay",
             "deleted_control_rejected", "duplicate_receipt_exact", "retry_snapshot_conserved"}
    if not isinstance(value, dict) or set(value) != common | extra:
        raise RuntimeError("exact full rebind attachment fields required")
    for key, expected in (("schema_version", 1), ("browser_worker_protocol_version", 2),
                          ("observed_worker_count", 7), ("actual_workers", 7), ("disposed_workers", 7),
                          ("generation", 2), ("transcript_controls", 8), ("known_rejections", 1)):
        if type(value[key]) is not int or value[key] != expected:
            raise RuntimeError("actual rebind counts differ: " + key)
    expected_hashes = {"manifest_sha256": worker["manifest_sha256"], "setup_manifest_sha256": setup_hash,
                       "entry_sha256": manifest["assets"][manifest["entry"]]["sha256"],
                       "worker_sha256": manifest["assets"][manifest["worker"]]["sha256"], **manifest["cohort"]}
    if (value["source_sha"] != source_sha or value["worker_path"] != manifest["worker"]
            or any(value[key] != expected for key, expected in expected_hashes.items())):
        raise RuntimeError("rebind attachment built cohort/source differs")
    if (value["rebind_attempts"] != [10, 9] or not isinstance(value["rebind_attempts"], list)
            or any(type(count) is not int for count in value["rebind_attempts"])):
        raise RuntimeError("ordered authority/replica rebind attempts differ")
    for key in ("raw_inputs", "presentations"):
        if (not isinstance(value[key], list) or len(value[key]) != 2
                or any(type(count) is not int or not 1 <= count <= (1 << 53) - 1 for count in value[key])):
            raise RuntimeError("actual two-peer causal counters differ")
    for key in ("final_snapshot_sha256", "capsule_sha256", "startup_handoff_snapshots"):
        if (not isinstance(value[key], list) or len(value[key]) != 2
                or any(not isinstance(item, str) or not re.fullmatch(r"[0-9a-f]{64}", item) for item in value[key])):
            raise RuntimeError("actual two-peer checkpoint/capsule hashes differ")
    for key in ("proposal_sha256", "receipt_sha256"):
        if not isinstance(value[key], str) or not re.fullmatch(r"[0-9a-f]{64}", value[key]):
            raise RuntimeError("actual raw wire SHA256 missing")
    for key in ("midphase_replay", "final_replay", "deleted_control_rejected", "duplicate_receipt_exact", "retry_snapshot_conserved", "startup_handoff_verified"):
        if value[key] is not True:
            raise RuntimeError("actual rebind conservation assertion missing: " + key)


def playwright_result(path, spec, expected, attachments):
    raw = bounded_file(path, FULL, 1 << 20)
    report = strict_json(raw)
    found = []
    def walk(suites):
        for suite in suites:
            for case in suite.get("specs", []):
                found.append(case)
            walk(suite.get("suites", []))
    walk(report.get("suites", []))
    if report.get("errors") or [case.get("title") for case in found] != expected:
        raise RuntimeError("complete exact Playwright case inventory differs")
    values = []
    for case, (attachment_name, maximum) in zip(found, attachments, strict=True):
        if case.get("file") not in (spec, Path(spec).name, str(ROOT / spec)) or case.get("ok") is not True:
            raise RuntimeError("actual browser case source or outcome differs")
        tests = case.get("tests", [])
        if len(tests) != 1:
            raise RuntimeError("one browser project result required")
        test = tests[0]
        results = test.get("results", [])
        if (test.get("projectName") != "chromium" or test.get("status") != "expected"
                or len(results) != 1):
            raise RuntimeError("one unretired passing Chromium result required")
        result = results[0]
        if (result.get("status") != "passed" or result.get("retry") != 0
                or type(result.get("duration")) is not int or not 0 <= result["duration"] <= 300000
                or result.get("error") or result.get("errors")):
            raise RuntimeError("actual browser result/cap differs")
        parts = result.get("attachments", [])
        if len(parts) != 1 or parts[0].get("name") != attachment_name or parts[0].get("contentType") != "application/json":
            raise RuntimeError("sole exact source-defined attachment required")
        part = parts[0]
        if "body" in part and "path" not in part:
            encoded = part["body"]
            if not isinstance(encoded, str) or len(encoded) > ((maximum + 2) // 3) * 4:
                raise RuntimeError("bounded attachment base64 required")
            payload = base64.b64decode(encoded, validate=True)
            if base64.b64encode(payload).decode() != encoded:
                raise RuntimeError("canonical attachment base64 required")
        elif "path" in part and "body" not in part:
            payload = bounded_file(Path(part["path"]), REPORT, maximum)
        else:
            raise RuntimeError("one actual attachment representation required")
        if not 0 < len(payload) <= maximum:
            raise RuntimeError("browser attachment exceeds unchanged cap")
        values.append({"id": case["title"], "source": spec, "source_sha256": digest(ROOT / spec),
                       "duration_ms": result["duration"], "attachment": attachment_name,
                       "attachment_bytes": len(payload), "attachment_sha256": hashlib.sha256(payload).hexdigest(),
                       "evidence": strict_json(payload)})
    return {"source": spec, "ids": expected, "passed": len(expected), "failed": 0, "skipped": 0,
            "report_sha256": hashlib.sha256(raw).hexdigest(), "report_bytes": len(raw), "cases": values}


def source_binding(root, source_sha):
    if not re.fullmatch(r"[0-9a-f]{40}", source_sha):
        raise RuntimeError("exact current Browser source required")
    return {"source_sha": source_sha,
            "source_hashes": {name: digest(Path(root) / name) for name in SOURCE_PATHS}}


def execute_platform(feedback, summary):
    global ROOT, FULL, REPORT, WEB
    ROOT = feedback.ROOT
    FULL = feedback.FULL / "browser-rebind"
    FULL.mkdir(exist_ok=False)
    REPORT = FULL
    WEB = Path(os.environ["RUNNER_TEMP"]) / "m9e-v7-web"
    identity = summary["identity"]
    binding = summary["plan"]["current_browser_rebind_binding"]
    if source_binding(ROOT, identity["product_sha"]) != binding:
        raise RuntimeError("current Browser source changed before execution")
    worker = summary["browser_worker_assets"]
    setup = summary["current_coop_rtc"]
    setup_raw = bounded_file(WEB / "m9e-v7-coop-startup-assets.json", WEB, 16384)
    if (strict_json(setup_raw) != setup["initializations"]
            or hashlib.sha256(setup_raw).hexdigest() != setup["setup_manifest_sha256"]):
        raise RuntimeError("same-run natural cooperative setup required")
    manifests = {"m9e-v7-coop-startup-assets.json": setup["setup_manifest_sha256"],
                 "m9e-v7-worker-assets.json": worker["manifest_sha256"]}
    assets = {**summary["browser_assets"]["assets"], **worker["manifest"]["assets"],
              **setup["initializations"]["assets"]}

    def rehash():
        for name, expected in assets.items():
            if asset(name, 32 << 20) != {key: expected[key] for key in ("bytes", "sha256")}:
                raise RuntimeError("actual current Browser asset changed")
        for name, expected in manifests.items():
            if digest(WEB / name) != expected:
                raise RuntimeError("actual current Browser manifest changed")

    rehash()
    feedback.run(["pnpm", "exec", "tsc", "--ignoreConfig", "--noEmit", "--skipLibCheck", "--strict",
                  "--target", "ESNext", "--module", "ESNext", "--moduleResolution", "bundler",
                  "--lib", "ESNext,DOM", "--types", "node,vite/client", SPEC],
                 "browser-rebind-typecheck", ROOT)
    report = FULL / "browser.json"
    environment = dict(os.environ, M9E_V7_WEB_DIR=str(WEB), PLAYWRIGHT_JSON_OUTPUT_FILE=str(report))
    argv = ["pnpm", "exec", "playwright", "test", "--config", "playwright.rust-browser.config.ts",
            "--project=chromium", "--workers=1", "--retries=0", "--reporter=json",
            "--output", str(REPORT / "results"), SPEC]
    feedback.run(argv, "browser-rebind-journey", ROOT, environment)
    tests = playwright_result(report, SPEC, [TEST_ID], [("m9e-current-browser-rebind", 16384)])
    validate_rebind(tests["cases"][0]["evidence"], worker, identity["product_sha"],
                    setup["setup_manifest_sha256"])
    rehash()
    if source_binding(ROOT, identity["product_sha"]) != binding:
        raise RuntimeError("current Browser source changed during execution")
    return {"status": "passed", "source_sha": identity["product_sha"], "run_id": identity["run_id"],
            "run_attempt": identity["run_attempt"], "source_binding": binding, "tests": tests,
            "execution_argv": argv, "worker_manifest_sha256": worker["manifest_sha256"],
            "setup_manifest_sha256": setup["setup_manifest_sha256"], "assets_rehashed": True}


def validate_platform(proof, native, root):
    required = native["plan"].get("requires_current_browser_rebind", False)
    expected = bool(native["plan"].get("requires_owned_foundations")
                    and native["plan"].get("current_recovery_integration"))
    if required is not expected:
        raise RuntimeError("complete owned integration cannot omit actual Browser rebind")
    value = proof.get("current_browser_rebind")
    if not required:
        if value is not None or native["plan"].get("current_browser_rebind_binding") is not None:
            raise RuntimeError("unrequested current Browser rebind evidence")
        return
    if (native["plan"].get("requires_browser_worker") is not True
            or native["plan"].get("requires_current_coop_startup") is not True):
        raise RuntimeError("actual Worker and natural co-op prerequisites required")
    identity = native["identity"]
    binding = native["plan"].get("current_browser_rebind_binding")
    if (binding != source_binding(root, identity["product_sha"]) or not isinstance(value, dict)
            or set(value) != {"status", "source_sha", "run_id", "run_attempt", "source_binding", "tests",
                              "execution_argv", "worker_manifest_sha256", "setup_manifest_sha256", "assets_rehashed"}
            or value["status"] != "passed" or value["source_binding"] != binding
            or value["assets_rehashed"] is not True
            or any(value[key] != identity[target] for key, target in
                   (("source_sha", "product_sha"), ("run_id", "run_id"), ("run_attempt", "run_attempt")))):
        raise RuntimeError("same-run current Browser rebind identity differs")
    worker = proof["browser_worker_assets"]
    setup_hash = proof["current_coop_rtc"]["setup_manifest_sha256"]
    if value["worker_manifest_sha256"] != worker["manifest_sha256"] or value["setup_manifest_sha256"] != setup_hash:
        raise RuntimeError("current Browser rebind cohort differs")
    tests = value["tests"]
    if (not isinstance(tests, dict)
            or set(tests) != {"source", "ids", "passed", "failed", "skipped", "report_sha256", "report_bytes", "cases"}
            or tests["source"] != SPEC or tests["ids"] != [TEST_ID]
            or any(type(tests[key]) is not int or tests[key] != expected
                   for key, expected in (("passed", 1), ("failed", 0), ("skipped", 0)))
            or type(tests["report_bytes"]) is not int or not 0 < tests["report_bytes"] <= 1 << 20
            or not isinstance(tests["report_sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", tests["report_sha256"])
            or not isinstance(tests["cases"], list) or len(tests["cases"]) != 1):
        raise RuntimeError("one whole actual current Browser rebind case required")
    case = tests["cases"][0]
    if (set(case) != {"id", "source", "source_sha256", "duration_ms", "attachment", "attachment_bytes",
                     "attachment_sha256", "evidence"}
            or case["id"] != TEST_ID or case["source"] != SPEC
            or case["source_sha256"] != binding["source_hashes"][SPEC]
            or case["attachment"] != "m9e-current-browser-rebind"
            or type(case["duration_ms"]) is not int or not 0 <= case["duration_ms"] <= 300000
            or type(case["attachment_bytes"]) is not int or not 0 < case["attachment_bytes"] <= 16384
            or not isinstance(case["attachment_sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", case["attachment_sha256"])):
        raise RuntimeError("actual whole rebind case source, timing or attachment differs")
    argv = value["execution_argv"]
    expected_prefix = ["pnpm", "exec", "playwright", "test", "--config", "playwright.rust-browser.config.ts",
                       "--project=chromium", "--workers=1", "--retries=0", "--reporter=json", "--output"]
    if (not isinstance(argv, list) or len(argv) != 13 or argv[:11] != expected_prefix
            or not isinstance(argv[11], str) or not Path(argv[11]).is_absolute() or argv[12] != SPEC):
        raise RuntimeError("whole unfiltered original-cap rebind execution required")
    validate_rebind(case["evidence"], worker, identity["product_sha"], setup_hash)
