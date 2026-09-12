#!/usr/bin/env python3
"""Bounded whole-file qualification of current browser external-input adapters."""
import hashlib
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ["RUNNER_TEMP"]) / "m9e-current-phase-js"
START = int(os.environ["M9E_JS_STARTED_AT"])
DEADLINE = START + 580  # 600 seconds including checkout/setup, 20 reserved for cleanup.
LIMIT = 262144
FILES = {
    "test/node/rust-browser/engineering/browser-effects-v2.test.ts": 2,
    "test/node/rust-browser/engineering/current-worker-codec.test.ts": 5,
    "test/node/rust-browser/engineering/current-storage-owner.test.ts": 11,
}
SUMMARY = {"schema_version": 1, "success": False, "source_sha": os.environ["GITHUB_SHA"],
           "started_at": START, "deadline_seconds": 600, "cleanup_reserve_seconds": 20,
           "commands": [], "files": FILES}
FAILURE = bytearray()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(args, label, capture=False):
    require(time.time() < DEADLINE, "shared JS deadline exhausted before " + label)
    started = time.time()
    process = subprocess.Popen(args, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               start_new_session=True)
    data = bytearray()
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    try:
        while selector.get_map():
            require(time.time() < DEADLINE, "shared JS deadline exhausted during " + label)
            for key, _ in selector.select(timeout=min(0.25, max(0, DEADLINE - time.time()))):
                chunk = os.read(key.fileobj.fileno(), 16384)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                require(len(data) + len(chunk) <= LIMIT, label + " output exceeds 256 KiB")
                data.extend(chunk)
        code = process.wait(timeout=max(0.01, DEADLINE - time.time()))
        SUMMARY["commands"].append({"label": label, "exit_code": code,
            "seconds": round(time.time() - started, 3), "output_bytes": len(data),
            "output_sha256": hashlib.sha256(data).hexdigest()})
        require(code == 0, label + " failed with exit " + str(code))
        return bytes(data) if capture else None
    except BaseException:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
        FAILURE.extend(("\n" + label + "\n").encode())
        FAILURE.extend(data[-min(len(data), LIMIT - 1024):])
        raise
    finally:
        selector.close()
        process.stdout.close()


def inventory():
    # Hash every tracked file that can supply the node-only test graph/configuration;
    # compare actual bytes with the exact published commit, then again after install/test.
    raw = run(["git", "ls-files", "-z", "src", "test/node", "scripts/ci/m9e_current_phase_js_diagnostic.py",
               ".github/workflows/m9e-current-phase-focused.yml",
               "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ".nvmrc",
               "tsconfig.json", "tsconfig.*.json", "patches"], "source-inventory", True)
    paths = [x.decode() for x in raw.split(b"\0") if x]
    require(paths and len(paths) == len(set(paths)), "source inventory is empty or duplicated")
    digest = hashlib.sha256()
    for relative in sorted(paths):
        path = ROOT / relative
        require(path.is_file() and not path.is_symlink(), "source input missing or linked: " + relative)
        value = hashlib.sha256(path.read_bytes()).hexdigest()
        digest.update(relative.encode() + b"\0" + value.encode() + b"\n")
    return {"count": len(paths), "sha256": digest.hexdigest()}


def main():
    require(0 <= time.time() - START < 580, "invalid shared JS start time")
    require(run(["git", "rev-parse", "HEAD"], "head", True).decode().strip() == SUMMARY["source_sha"],
            "checkout is not the exact dispatched commit")
    require(not run(["git", "status", "--porcelain", "--untracked-files=no"], "clean-before", True).strip(),
            "tracked source dirty before qualification")
    require(run(["node", "--version"], "node-version", True).decode().strip() == "v24.9.0", "Node version drift")
    require(run(["pnpm", "--version"], "pnpm-version", True).decode().strip() == "10.33.2", "pnpm version drift")
    before = inventory()
    SUMMARY["inputs_before"] = before
    require(not (ROOT / "node_modules").exists(), "checkout is not source-only")
    run(["pnpm", "install", "--frozen-lockfile", "--ignore-scripts", "--reporter=append-only"], "frozen-dependencies")
    report = OUT / "vitest.json"
    run(["pnpm", "exec", "vitest", "run", "--config", "test/node/vitest.config.ts", *FILES,
         "--no-file-parallelism", "--reporter=json", "--outputFile=" + str(report)], "whole-browser-targets")
    require(report.is_file() and not report.is_symlink() and report.stat().st_size <= LIMIT,
            "missing or oversized Vitest report")
    data = json.loads(report.read_bytes())
    require(data.get("success") is True, "Vitest did not report success")
    for key in ("numFailedTests", "numPendingTests", "numTodoTests", "numFailedTestSuites", "numPendingTestSuites"):
        require(data.get(key, 0) == 0, "non-passing Vitest count: " + key)
    require(data.get("numTotalTests") == sum(FILES.values()) == data.get("numPassedTests"), "whole-test inventory changed")
    observed = {}
    for suite in data["testResults"]:
        name = Path(suite["name"]).resolve().relative_to(ROOT).as_posix()
        require(name in FILES and name not in observed and suite["status"] == "passed", "unexpected or failed target")
        assertions = suite["assertionResults"]
        require(len(assertions) == FILES[name] and all(a["status"] == "passed" for a in assertions), "skipped or filtered target")
        names = [a["fullName"] for a in assertions]
        require(len(names) == len(set(names)), "duplicate assertion identity")
        observed[name] = names
    require(set(observed) == set(FILES), "whole-target file missing")
    require(not run(["git", "status", "--porcelain", "--untracked-files=no"], "clean-after", True).strip(),
            "dependency installation/test changed tracked source")
    after = inventory()
    require(before == after, "input source hash changed")
    SUMMARY.update(success=True, inputs_after=after, passed_tests=observed,
                   report_bytes=report.stat().st_size, report_sha256=hashlib.sha256(report.read_bytes()).hexdigest())


OUT.mkdir(parents=True, exist_ok=False)
try:
    main()
except BaseException as error:
    SUMMARY["failure"] = str(error)[:2048]
    FAILURE.extend(("\n" + str(error) + "\n").encode())
    report = OUT / "vitest.json"
    if report.is_file() and not report.is_symlink() and report.stat().st_size <= LIMIT:
        try:
            failed = json.loads(report.read_bytes())
            for suite in failed.get("testResults", []):
                for assertion in suite.get("assertionResults", []):
                    if assertion.get("status") != "passed":
                        excerpt = json.dumps({"file": suite.get("name"), "test": assertion.get("fullName"),
                                              "status": assertion.get("status"),
                                              "failureMessages": assertion.get("failureMessages")})
                        FAILURE.extend(("\n" + excerpt + "\n").encode()[:LIMIT])
                        FAILURE = FAILURE[-LIMIT:]
        except (ValueError, TypeError, KeyError):
            FAILURE.extend(b"\nVitest report could not be decoded\n")
finally:
    if "inputs_before" in SUMMARY and "inputs_after" not in SUMMARY:
        try:
            SUMMARY["inputs_after"] = inventory()
            require(SUMMARY["inputs_before"] == SUMMARY["inputs_after"], "source drift on failed qualification")
        except BaseException as error:
            SUMMARY["success"] = False
            SUMMARY["post_failure_inventory_error"] = str(error)[:1024]
    SUMMARY["elapsed_seconds"] = round(time.time() - START, 3)
    # Only compact declared members survive. No source/dependency/full-log artifact.
    (OUT / "vitest.json").unlink(missing_ok=True)
    encoded = json.dumps(SUMMARY, sort_keys=True, separators=(",", ":")).encode()
    require(len(encoded) <= 65536, "compact summary exceeds 64 KiB")
    (OUT / "summary.json").write_bytes(encoded)
    (OUT / "failure.txt").write_bytes(bytes(FAILURE[-LIMIT:]))
raise SystemExit(0 if SUMMARY["success"] else 1)
