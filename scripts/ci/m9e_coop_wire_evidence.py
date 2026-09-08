"""Remote packet evidence from two previously qualified, immutable browser cohorts.

This supplements the full run; it does not claim a fresh Wasm build or full M9.
The original three-case spec is restored after adding two byte attachments only.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time
import urllib.request

run_bounded = None

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-coop-wire-evidence"
FULL = REPORT / "diagnostics"
PACKETS = REPORT / "packets"
COMPACT = REPORT / "compact"
START = int(os.environ["M9E_FOCUS_STARTED_AT"])
DEADLINE = time.monotonic() + 1800 - (time.time() - START)
SPEC = ROOT / "test/browser/rust-browser/m9e-v7-coop-startup.spec.ts"
INPUT = ROOT / "scripts/ci/m9e_coop_wire_inputs.json"
ORIGINAL = SPEC.read_bytes()
LOGS = {}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def bounded(path, maximum):
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= maximum:
        raise RuntimeError("bounded regular input required: " + path.name)
    return path.read_bytes()


def run(args, name, seconds, environment=None):
    result = run_bounded(args, cwd=ROOT, environment=environment or dict(os.environ),
                         output=FULL / (name + ".log"), seconds=seconds,
                         byte_limit=1 << 20, global_deadline=DEADLINE - 20)
    LOGS[name] = {key: result[key] for key in ("bytes", "sha256", "elapsed_seconds")}


def api(path):
    request = urllib.request.Request("https://api.github.com/repos/Heraklines/elite-redux/" + path,
                                    headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"],
                                             "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(65537)
    if len(data) > 65536:
        raise RuntimeError("bounded service metadata required")
    return json.loads(data)


def check_assets(cohort):
    directory = REPORT / "inputs" / cohort["name"]
    if directory.is_symlink() or directory.resolve().parent != (REPORT / "inputs").resolve():
        raise RuntimeError("contained cohort directory required")
    service = api("actions/runs/" + str(cohort["run_id"]))
    artifact = api("actions/artifacts/" + str(cohort["artifact_id"]))
    if (service["head_sha"] != cohort["source_sha"] or service["conclusion"] != "success"
            or service["status"] != "completed" or service["run_attempt"] != 1
            or artifact["workflow_run"]["id"] != cohort["run_id"]
            or artifact["workflow_run"]["head_sha"] != cohort["source_sha"]
            or artifact["size_in_bytes"] != cohort["archive_bytes"] or artifact["expired"]
            or artifact["name"] != "m9e-browser-assets-" + cohort["source_sha"]):
        raise RuntimeError("actual successful source/run/asset identity differs")
    retained = {}
    for name, expected in cohort["manifests"].items():
        raw = bounded(directory / name, 16384)
        if digest(raw) != expected:
            raise RuntimeError("exact original platform manifest differs")
        manifest = json.loads(raw)
        if manifest["source_sha"] != cohort["source_sha"] or manifest["schema_version"] != 1:
            raise RuntimeError("original manifest source differs")
        retained[name] = digest(raw)
        for path, fact in manifest["assets"].items():
            if not re.fullmatch(r"[a-zA-Z0-9_.-]+", path) or path in (".", ".."):
                raise RuntimeError("flat asset path required")
            data = bounded(directory / path, 32 << 20)
            if len(data) != fact["bytes"] or digest(data) != fact["sha256"]:
                raise RuntimeError("actual original asset bytes differ")
            retained[path] = digest(data)
    return directory, retained


def cases(suites):
    for suite in suites:
        for spec in suite.get("specs", []):
            yield spec
        yield from cases(suite.get("suites", []))


def main(summary):
    global run_bounded
    inputs = json.loads(bounded(INPUT, 16384))
    if not 0 <= time.time() - START < 1780:
        raise RuntimeError("precheckout deadline exhausted before producer")
    for name, fact in inputs["source_pins"].items():
        data = bounded(ROOT / name, 4 << 20)
        if len(data) != fact["bytes"] or digest(data) != fact["sha256"]:
            raise RuntimeError("pinned execution dependency differs: " + name)
    import m9e_current_cost
    if Path(m9e_current_cost.__file__).resolve() != ROOT / "scripts/ci/m9e_current_cost.py":
        raise RuntimeError("bounded helper imported from wrong path")
    run_bounded = m9e_current_cost.run_bounded
    if (digest(ORIGINAL) != inputs["spec_sha256"] or inputs["spec"] != str(SPEC.relative_to(ROOT))
            or [item["name"] for item in inputs["cohorts"]] != ["old", "current"]):
        raise RuntimeError("exact unchanged qualified spec and both cohorts required")
    original_text = ORIGINAL.decode("utf-8")
    anchor = '      })) });\n    } finally {'
    if original_text.count(anchor) != 1:
        raise RuntimeError("exact post-assertion attachment insertion point required")
    extra = '''      await info.attach("m9e-coop-wire-choices", {
        body: Buffer.from(sentGuest), contentType: "application/octet-stream" });
      await info.attach("m9e-coop-wire-started", {
        body: Buffer.from(sentHost), contentType: "application/octet-stream" });
'''
    instrumented = original_text.replace(anchor, '      })) });\n' + extra + '    } finally {').encode("utf-8")
    summary.update(original_spec_sha256=digest(ORIGINAL), instrumented_spec_sha256=digest(instrumented),
                   inputs_sha256=digest(INPUT.read_bytes()), reused_original_builds=True)
    run(["pnpm", "install", "--frozen-lockfile"], "dependencies", 600)
    run(["pnpm", "exec", "playwright", "install", "--with-deps", "chromium"], "chromium", 600)
    SPEC.write_bytes(instrumented)
    summary["cohorts"] = []
    for cohort in inputs["cohorts"]:
        directory, retained = check_assets(cohort)
        report_path = FULL / (cohort["name"] + "-browser-results.json")
        environment = dict(os.environ)
        environment.update(GITHUB_SHA=cohort["source_sha"], M9E_V7_WEB_DIR=str(directory),
                           PLAYWRIGHT_JSON_OUTPUT_FILE=str(report_path))
        run(["pnpm", "exec", "playwright", "test", "--config", "playwright.rust-browser.config.ts",
             "--project=chromium", inputs["spec"], "--workers=1", "--reporter=line,json"],
            cohort["name"] + "-browser", 660, environment)
        raw_report = bounded(report_path, 1 << 20)
        report = json.loads(raw_report)
        specs = list(cases(report["suites"]))
        if len(specs) != 3 or report.get("errors"):
            raise RuntimeError("all three original browser cases required")
        wires = []
        for spec in specs:
            if len(spec["tests"]) != 1:
                raise RuntimeError("one Chromium result per original case required")
            test = spec["tests"][0]
            if test["status"] != "expected" or len(test["results"]) != 1:
                raise RuntimeError("no retries or skipped cases allowed")
            result = test["results"][0]
            if result["status"] != "passed" or result["duration"] > 300000:
                raise RuntimeError("original bounded browser case failed")
            attachments = result.get("attachments", [])
            startup = [a for a in attachments if a["name"] == "m9e-natural-coop-startup"]
            if not startup:
                if len(attachments) != 1 or attachments[0]["name"] != "m9e-natural-coop-public-retry":
                    raise RuntimeError("exact third original retry case attachment required")
                continue
            if len(startup) != 1 or len(attachments) != 3:
                raise RuntimeError("original startup plus two exact wire attachments required")
            evidence = json.loads(base64.b64decode(startup[0]["body"], validate=True))
            expected = [case for case in cohort["cases"] if case["order"] == evidence["order"]]
            if len(expected) != 1 or evidence["source_sha"] != cohort["source_sha"]:
                raise RuntimeError("actual journey and original cohort binding differ")
            for kind in ("choices", "started"):
                selected = [a for a in attachments if a["name"] == "m9e-coop-wire-" + kind]
                if len(selected) != 1 or selected[0]["contentType"] != "application/octet-stream":
                    raise RuntimeError("actual raw packet attachment required")
                data = base64.b64decode(selected[0]["body"], validate=True)
                if (not 0 < len(data) <= 65536 or len(data) != expected[0][kind + "_bytes"]
                        or digest(data) != expected[0][kind + "_sha256"]
                        or digest(data) != evidence[kind + "_sha256"]):
                    raise RuntimeError("actual packet bytes differ from original full run")
                name = cohort["name"] + "-" + evidence["order"] + "-" + kind + ".json"
                (PACKETS / name).write_bytes(data)
                wires.append({"file": name, "bytes": len(data), "sha256": digest(data)})
        if len(wires) != 4 or len({row["file"] for row in wires}) != 4:
            raise RuntimeError("both readiness orders and both actual packets required")
        if any(digest(bounded(directory / name, 32 << 20)) != value for name, value in retained.items()):
            raise RuntimeError("original reused assets changed")
        summary["cohorts"].append({"source_sha": cohort["source_sha"], "run_id": cohort["run_id"],
                                   "artifact_id": cohort["artifact_id"], "manifests": cohort["manifests"],
                                   "tests": 3, "packets": wires, "report_sha256": digest(raw_report)})
    if SPEC.read_bytes() != instrumented:
        raise RuntimeError("instrumented source changed during actual execution")
    summary["tests"] = {"passed": 6, "failed": 0, "skipped": 0}


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    PACKETS.mkdir(exist_ok=False)
    COMPACT.mkdir(exist_ok=False)
    summary = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"],
               "run_id": os.environ["GITHUB_RUN_ID"], "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"],
               "qualification": "Supplemental exact packet bytes from two previously qualified cohorts; no fresh build or full M9 claim"}
    try:
        main(summary)
        summary["status"] = "passed"
    except Exception as error:
        summary["failure"] = str(error)[:2048]
        raise
    finally:
        SPEC.write_bytes(ORIGINAL)
        inputs_directory = REPORT / "inputs"
        if inputs_directory.is_symlink() or inputs_directory.resolve().parent != REPORT.resolve():
            raise RuntimeError("cleanup containment differs")
        if inputs_directory.exists():
            shutil.rmtree(inputs_directory)
        summary.update(logs=LOGS, original_source_restored=SPEC.read_bytes() == ORIGINAL,
                       owned_inputs_removed=not inputs_directory.exists(), elapsed_seconds_including_checkout=time.time() - START)
        if time.monotonic() > DEADLINE:
            summary["status"] = "failed"
            summary["failure"] = "shared1800 deadline including cleanup exceeded"
        encoded = (json.dumps(summary, sort_keys=True) + "\n").encode()
        if len(encoded) > 16384:
            raise RuntimeError("compact evidence exceeds16KiB")
        (COMPACT / "summary.json").write_bytes(encoded)
        if summary["status"] != "passed":
            raise RuntimeError(summary.get("failure", "packet qualification failed"))
