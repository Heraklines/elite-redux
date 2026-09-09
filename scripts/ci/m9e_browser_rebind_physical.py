"""Same-run physical RTC replacement, V2 transport, and application-owner proof.

The three whole specs are the independently qualified regression sources. The
original seven-Worker browser proof remains independently mandatory.
"""
import base64
import hashlib
import os
from pathlib import Path
import re

import m9e_browser_rebind as original

HELPER = "scripts/ci/m9e_browser_rebind_physical.py"
CASES = {
    "test/browser/rust-browser/m9e-v7-rebind-rtc.spec.ts": (
        "current V7 Workers physically reconnect RTC generation two and replay continued natural gameplay",
        "m9e-current-browser-physical-rebind"),
    "test/browser/rust-browser/m9e-v7-rebind-rtc-transport.spec.ts": (
        "current V7 generation-bound RTC transport reconnects and replays natural Worker gameplay",
        "m9e-current-browser-transport-rebind"),
    "test/browser/rust-browser/m9e-v7-rebind-rtc-owner.spec.ts": (
        "current V7 RTC owner automatically rebinds and continues natural gameplay across fresh connections",
        "m9e-current-rtc-owner-rebind"),
}
SOURCE_PATHS = [HELPER, "scripts/build-kernel-m9e-v7-web.mjs",
                "src/rust-browser/adapters/current-rtc-transport-v2.ts",
                "src/rust-browser/routes/rust-current-rtc-entry.ts",
                "src/rust-browser/routes/rust-current-rtc-rebind-entry.ts", *CASES]
OWNER = "test/browser/rust-browser/m9e-v7-rebind-rtc-owner.spec.ts"
TRANSPORT = "test/browser/rust-browser/m9e-v7-rebind-rtc-transport.spec.ts"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def source_binding(root, source_sha):
    require(isinstance(source_sha, str) and re.fullmatch(r"[0-9a-f]{40}", source_sha),
            "exact physical RTC source required")
    return {"source_sha": source_sha,
            "source_hashes": {path: original.digest(Path(root) / path) for path in SOURCE_PATHS}}


def counts(value, expected):
    return isinstance(value, list) and value == expected and all(type(item) is int for item in value)


def sha256(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def validate_attachment(spec, value, worker, rtc, source_sha, setup_hash):
    require(isinstance(value, dict), "actual physical RTC attachment required")
    if spec != OWNER:
        extensions = {"physical_connections", "physical_carriers"}
        if spec == TRANSPORT:
            extensions.add("transport_evidence")
        require(extensions <= set(value), "physical carrier evidence missing")
        original.validate_rebind({key: item for key, item in value.items() if key not in extensions},
                                 worker, source_sha, setup_hash)
        require(type(value["physical_connections"]) is int and value["physical_connections"] == 4
                and isinstance(value["physical_carriers"], list) and len(value["physical_carriers"]) == 2,
                "two actual replacement connection pairs required")
        for generation, carrier in enumerate(value["physical_carriers"], 1):
            count = 1 if generation == 1 else 6
            require(isinstance(carrier, dict)
                    and set(carrier) == {"generation", "sent", "received", "closed", "selected_pairs"}
                    and type(carrier["generation"]) is int and carrier["generation"] == generation
                    and type(carrier["selected_pairs"]) is int and carrier["selected_pairs"] == 2
                    and carrier["closed"] is True
                    and counts(carrier["sent"], [count, count])
                    and counts(carrier["received"], [count, count]), "actual complete physical wire delivery required")
        if spec == TRANSPORT:
            transports = value["transport_evidence"]
            require(isinstance(transports, list) and len(transports) == 2, "two generation-bound transports required")
            for generation, transport in enumerate(transports, 1):
                require(isinstance(transport, dict)
                        and set(transport) == {"generation", "connected", "disconnected", "wrong_generation_rejected", "endpoints"}
                        and type(transport["generation"]) is int and transport["generation"] == generation
                        and counts(transport["connected"], [1, 1]) and counts(transport["disconnected"], [1, 1])
                        and transport["wrong_generation_rejected"] is True
                        and isinstance(transport["endpoints"], list) and len(transport["endpoints"]) == 2,
                        "transport callbacks and generation rejection required")
                for endpoint in transport["endpoints"]:
                    keys = {"closed", "connected", "reason", "sendPending", "receivePending", "sendBytes", "receiveBytes",
                            "sentFrames", "receivedFrames", "kernelDeliveredFrames", "maximumFrameBytes",
                            "maximumObservedFrameBytes", "bufferedAmount"}
                    require(isinstance(endpoint, dict) and set(endpoint) == keys and endpoint["closed"] is True
                            and endpoint["connected"] is False and endpoint["reason"] == "current RTC channel closed",
                            "closed transport endpoint required")
                    for key in ("sendPending", "receivePending", "sendBytes", "receiveBytes", "bufferedAmount"):
                        require(type(endpoint[key]) is int and endpoint[key] == 0, "transport work must settle")
                    for key in ("sentFrames", "receivedFrames", "kernelDeliveredFrames"):
                        require(type(endpoint[key]) is int and endpoint[key] == (1 if generation == 1 else 6),
                                "actual transport and kernel delivery counts required")
                    require(type(endpoint["maximumFrameBytes"]) is int and endpoint["maximumFrameBytes"] == 262144
                            and type(endpoint["maximumObservedFrameBytes"]) is int
                            and 0 < endpoint["maximumObservedFrameBytes"] <= 262144, "bounded actual transport frames required")
        return
    keys = {"schema_version", "source_sha", "manifest_sha256", "entry_sha256", "worker_sha256", "worker_path",
            "content_sha256", "glue_sha256", "wasm_sha256", "browser_worker_protocol_version", "observed_worker_count",
            "setup_manifest_sha256", "rtc_manifest_sha256", "owner_worker_path", "actual_workers", "disposed_workers",
            "generation", "automatic_rebind_controls", "successful_signaling_pairs", "raw_inputs", "presentations",
            "connected_callbacks", "disconnected_callbacks", "live_begin_rejected", "checkpoint_handoff_exact",
            "full_replay", "deleted_control_rejected", "duplicate_receipt_exact", "duplicate_receipt_delivered",
            "final_lifecycle_equal", "proposal_sha256", "receipt_sha256", "capsule_sha256"}
    require(set(value) == keys, "exact complete RTC owner evidence required")
    manifest = worker["manifest"]
    expected_hashes = {"manifest_sha256": worker["manifest_sha256"], "setup_manifest_sha256": setup_hash,
                       "rtc_manifest_sha256": rtc["manifest_sha256"],
                       "entry_sha256": manifest["assets"][manifest["entry"]]["sha256"],
                       "worker_sha256": manifest["assets"][manifest["worker"]]["sha256"], **manifest["cohort"]}
    require(value["source_sha"] == source_sha and value["worker_path"] == manifest["worker"]
            and value["owner_worker_path"] == rtc["manifest"]["worker"]
            and all(value[key] == expected for key, expected in expected_hashes.items()), "current owner built cohort differs")
    for key, expected in (("schema_version", 1), ("browser_worker_protocol_version", 2), ("generation", 2),
                          ("actual_workers", 6), ("disposed_workers", 6), ("observed_worker_count", 6),
                          ("successful_signaling_pairs", 2)):
        require(type(value[key]) is int and value[key] == expected, "actual owner lifecycle count differs")
    require(counts(value["automatic_rebind_controls"], [4, 4])
            and counts(value["connected_callbacks"], [1, 1]) and counts(value["disconnected_callbacks"], [1, 1]),
            "automatic owner routing and lifecycle callbacks required")
    for key in ("raw_inputs", "presentations"):
        require(isinstance(value[key], list) and len(value[key]) == 4
                and all(type(item) is int and 0 < item < 1 << 53 for item in value[key]), "all four owner causal counters required")
    for key in ("live_begin_rejected", "checkpoint_handoff_exact", "full_replay", "deleted_control_rejected",
                "duplicate_receipt_exact", "duplicate_receipt_delivered", "final_lifecycle_equal"):
        require(value[key] is True, "actual owner conservation and causal rejection required")
    require(sha256(value["proposal_sha256"]) and sha256(value["receipt_sha256"])
            and isinstance(value["capsule_sha256"], list) and len(value["capsule_sha256"]) == 2
            and all(sha256(item) for item in value["capsule_sha256"]), "complete actual owner wire and replay hashes required")


def execute_platform(feedback, summary):
    root = feedback.ROOT
    full = feedback.FULL / "browser-rebind-physical"
    full.mkdir(exist_ok=False)
    web = Path(os.environ["RUNNER_TEMP"]) / "m9e-v7-web"
    identity = summary["identity"]
    binding = summary["plan"]["current_browser_rebind_physical_binding"]
    require(source_binding(root, identity["product_sha"]) == binding, "physical RTC sources changed before execution")
    for field, filename in (("browser_worker_assets", "m9e-v7-worker-assets.json"),
                            ("browser_rtc_assets", "m9e-v7-rtc-assets.json")):
        published = summary[field]
        raw_manifest = original.bounded_file(web / filename, web, 16384)
        require(hashlib.sha256(raw_manifest).hexdigest() == published["manifest_sha256"]
                and original.strict_json(raw_manifest) == published["manifest"], "same-run physical RTC manifest required")
        for name, expected in published["manifest"]["assets"].items():
            require(re.fullmatch(r"[A-Za-z0-9_.-]+", name), "flat RTC asset name required")
            data = original.bounded_file(web / name, web, 32 << 20)
            require(len(data) == expected["bytes"] and hashlib.sha256(data).hexdigest() == expected["sha256"],
                    "same-run physical RTC asset required")
    retained = {path.name: original.digest(path) for path in web.iterdir() if path.is_file()}
    feedback.run(["pnpm", "exec", "tsc", "--ignoreConfig", "--noEmit", "--skipLibCheck", "--strict",
                  "--target", "ESNext", "--module", "ESNext", "--moduleResolution", "bundler", "--lib", "ESNext,DOM",
                  "--types", "node,vite/client", *CASES], "browser-rebind-physical-typecheck", root)
    report_path = full / "browser.json"
    environment = dict(os.environ, M9E_V7_WEB_DIR=str(web), PLAYWRIGHT_JSON_OUTPUT_FILE=str(report_path))
    argv = ["pnpm", "exec", "playwright", "test", "--config", "playwright.rust-browser.config.ts",
            "--project=chromium", "--workers=2", "--retries=0", "--reporter=json",
            "--output", str(full / "results"), *CASES]
    feedback.run(argv, "browser-rebind-physical-journeys", root, environment)
    raw = original.bounded_file(report_path, full, 262144)
    report = original.strict_json(raw)
    found = []
    def collect(suites):
        for suite in suites:
            found.extend(suite.get("specs", []))
            collect(suite.get("suites", []))
    collect(report.get("suites", []))
    stats = report.get("stats", {})
    require(not report.get("errors") and len(found) == 3 and stats.get("expected") == 3
            and all(stats.get(key) == 0 for key in ("unexpected", "flaky", "skipped"))
            and report.get("config", {}).get("workers") == 2, "all three whole physical RTC cases must pass")
    seen = set()
    cases = []
    for case in found:
        paths = [path for path in CASES if case.get("file") in (path, Path(path).name, str(root / path))]
        require(len(paths) == 1, "exact physical RTC test source required")
        path = paths[0]
        title, attachment_name = CASES[path]
        require(path not in seen and case.get("title") == title and case.get("ok") is True,
                "one whole source-bound physical RTC case required")
        seen.add(path)
        tests = case.get("tests", [])
        require(len(tests) == 1, "one Chromium execution required")
        test = tests[0]
        results = test.get("results", [])
        require(test.get("expectedStatus") == "passed" and test.get("status") == "expected"
                and test.get("projectName") == "chromium" and len(results) == 1, "actual expected Chromium result required")
        result = results[0]
        attachments = result.get("attachments", [])
        require(result.get("status") == "passed" and type(result.get("retry")) is int and result["retry"] == 0
                and type(result.get("duration")) is int and 0 < result["duration"] <= 300000
                and len(attachments) == 1, "bounded passing case without retries required")
        attachment = attachments[0]
        require(set(attachment) == {"name", "contentType", "body"} and attachment["name"] == attachment_name
                and attachment["contentType"] == "application/json", "exact inline physical RTC receipt required")
        data = base64.b64decode(attachment["body"], validate=True)
        require(0 < len(data) <= 32768 and base64.b64encode(data).decode("ascii") == attachment["body"],
                "bounded canonical physical RTC receipt required")
        evidence = original.strict_json(data)
        validate_attachment(path, evidence, summary["browser_worker_assets"], summary["browser_rtc_assets"],
                            identity["product_sha"], summary["current_coop_rtc"]["setup_manifest_sha256"])
        cases.append({"source": path, "id": title, "source_sha256": binding["source_hashes"][path],
                      "duration_ms": result["duration"], "attachment": attachment_name,
                      "attachment_bytes": len(data), "attachment_sha256": hashlib.sha256(data).hexdigest(), "evidence": evidence})
    require(all(original.digest(web / path) == expected for path, expected in retained.items())
            and source_binding(root, identity["product_sha"]) == binding, "physical RTC inputs changed during execution")
    return {"status": "passed", "source_sha": identity["product_sha"], "run_id": identity["run_id"],
            "run_attempt": identity["run_attempt"], "source_binding": binding,
            "tests": {"passed": 3, "failed": 0, "skipped": 0, "report_bytes": len(raw),
                      "report_sha256": hashlib.sha256(raw).hexdigest(), "cases": cases},
            "execution_argv": argv, "assets_rehashed": True}


def validate_platform(proof, native, root):
    plan = native["plan"]
    expected = bool(plan.get("requires_current_browser_rebind")
                    and (Path(root) / "src/rust-browser/adapters/current-rtc-transport-v2.ts").is_file())
    require(plan.get("requires_current_browser_rebind_physical", False) is expected,
            "complete RTC owner integration cannot omit physical browser proof")
    value = proof.get("current_browser_rebind_physical")
    if not expected:
        require(value is None and plan.get("current_browser_rebind_physical_binding") is None,
                "unselected physical RTC evidence is not qualification")
        return
    identity = native["identity"]
    binding = source_binding(root, identity["product_sha"])
    require(isinstance(value, dict)
            and set(value) == {"status", "source_sha", "run_id", "run_attempt", "source_binding", "tests", "execution_argv", "assets_rehashed"}
            and value.get("status") == "passed" and value.get("assets_rehashed") is True
            and value.get("source_sha") == identity["product_sha"] and value.get("run_id") == identity["run_id"]
            and value.get("run_attempt") == identity["run_attempt"] and value.get("source_binding") == binding
            and plan.get("current_browser_rebind_physical_binding") == binding, "same-run physical RTC proof binding required")
    tests = value.get("tests", {})
    require(isinstance(tests, dict) and set(tests) == {"passed", "failed", "skipped", "report_bytes", "report_sha256", "cases"}
            and all(type(tests.get(key)) is int for key in ("passed", "failed", "skipped"))
            and tests.get("passed") == 3 and tests.get("failed") == 0 and tests.get("skipped") == 0
            and type(tests.get("report_bytes")) is int and 0 < tests["report_bytes"] <= 262144
            and sha256(tests.get("report_sha256")) and isinstance(tests.get("cases"), list)
            and len(tests["cases"]) == 3, "complete physical RTC browser proof required")
    prefix = ["pnpm", "exec", "playwright", "test", "--config", "playwright.rust-browser.config.ts",
              "--project=chromium", "--workers=2", "--retries=0", "--reporter=json", "--output"]
    argv = value.get("execution_argv")
    require(isinstance(argv, list) and len(argv) == 15 and argv[:11] == prefix
            and isinstance(argv[11], str) and Path(argv[11]).is_absolute() and argv[12:] == list(CASES),
            "whole unfiltered physical RTC execution required")
    seen = set()
    for case in tests["cases"]:
        require(isinstance(case, dict) and set(case) == {"source", "id", "source_sha256", "duration_ms", "attachment",
                                                       "attachment_bytes", "attachment_sha256", "evidence"},
                "exact actual physical RTC case fields required")
        path = case["source"]
        require(path in CASES and path not in seen and (case["id"], case["attachment"]) == CASES[path]
                and case["source_sha256"] == binding["source_hashes"][path]
                and type(case["duration_ms"]) is int and 0 < case["duration_ms"] <= 300000
                and type(case["attachment_bytes"]) is int and 0 < case["attachment_bytes"] <= 32768
                and sha256(case["attachment_sha256"]), "unique source-bound complete physical RTC case required")
        seen.add(path)
        validate_attachment(path, case["evidence"], proof["browser_worker_assets"], proof["browser_rtc_assets"],
                            identity["product_sha"], proof["current_coop_rtc"]["setup_manifest_sha256"])
