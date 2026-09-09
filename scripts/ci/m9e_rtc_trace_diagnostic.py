"""Read one existing failed trace remotely; emit timing metadata, never trace bodies."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

RUN = 34371019325
PRODUCT = "edb3a8d1677b271f992b54c56b46b79de18016a4"
ARTIFACT = 10114093345
ARCHIVE_BYTES = 2206367
ARCHIVE_SHA256 = "d2504592ba2d9948e27cd8efdb1d0cb698286d4105cff3ef35f62e1febfb0eb1"
TRACE_SUFFIX = "m9e-v7-coop-startup-natura-ab2ef-s-and-RTC-guest-ready-first-chromium/trace.zip"
ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-rtc-startup-trace"
START = os.environ.get("M9E_FOCUS_STARTED_AT", "")
if not re.fullmatch(r"[0-9]{10}", START) or not 0 <= time.time() - int(START) < 1780:
    raise RuntimeError("strict pre-checkout shared budget required")
DEADLINE = time.monotonic() + 1780 - (time.time() - int(START))


def remaining():
    value = DEADLINE - time.monotonic()
    if value <= 0:
        raise RuntimeError("metadata diagnostic deadline exhausted")
    return min(value, 30)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def request(url, cap, authenticated=False):
    headers = {"User-Agent": "M9E-bounded-trace-metadata", "Accept": "application/vnd.github+json"}
    if authenticated:
        if not url.startswith("https://api.github.com/repos/Heraklines/elite-redux/"):
            raise RuntimeError("authenticated origin differs")
        headers["Authorization"] = "Bearer " + os.environ["GH_TOKEN"]
    response = urllib.request.build_opener(NoRedirect()).open(urllib.request.Request(url, headers=headers), timeout=remaining())
    with response:
        if response.status != 200:
            raise RuntimeError("unexpected bounded response")
        length = response.headers.get("Content-Length")
        if length is not None and int(length) > cap:
            raise RuntimeError("response exceeds named bound")
        chunks = []
        count = 0
        while True:
            remaining()
            chunk = response.read(min(65536, cap + 1 - count))
            if not chunk:
                break
            count += len(chunk)
            if count > cap:
                raise RuntimeError("response exceeded byte bound")
            chunks.append(chunk)
        return b"".join(chunks)


def api(path):
    return json.loads(request("https://api.github.com/repos/Heraklines/elite-redux/" + path, 32768, True))


def kind(event):
    params = event.get("params", {})
    expression = str(params.get("expression", ""))
    if "peer.offer()" in expression:
        return "offer"
    if "peer.answer(offer)" in expression:
        return "answer"
    if "peer.accept(answer)" in expression:
        return "accept"
    if "peer.ready()" in expression:
        return "ready"
    if "__naturalCoop =" in expression:
        return "initialize-natural-worker"
    return ""


def read_trace(archive, info):
    if info.flag_bits & 1 or not 0 < info.file_size <= 4 << 20:
        raise RuntimeError("named trace stream bound differs")
    result = {}
    event_types = {}
    console = []
    count = 0
    total = 0
    with archive.open(info) as stream:
        while True:
            remaining()
            line = stream.readline((256 << 10) + 1)
            if not line:
                break
            total += len(line)
            count += 1
            if len(line) > 256 << 10 or total > 4 << 20 or count > 20000:
                raise RuntimeError("trace event bounds exceeded")
            event = json.loads(line)
            typ = event.get("type", "unknown")
            event_types[typ] = event_types.get(typ, 0) + 1
            call = event.get("callId")
            if typ == "before" and isinstance(call, str):
                if len(result) >= 128:
                    raise RuntimeError("bounded trace call inventory exceeded")
                result[call] = {"call": call[:96], "page": str(event.get("pageId", ""))[:96],
                    "api": str(event.get("apiName", ""))[:96], "method": str(event.get("method", ""))[:64],
                    "start_ms": event.get("startTime"), "phase": kind(event)}
            elif typ == "after" and call in result:
                item = result[call]
                item["end_ms"] = event.get("endTime")
                if isinstance(item["start_ms"], (int, float)) and isinstance(item["end_ms"], (int, float)):
                    item["duration_ms"] = item["end_ms"] - item["start_ms"]
                error = event.get("error")
                if error:
                    item["error"] = str(error.get("message", ""))[:768]
            elif typ in ("console", "event"):
                # Do not emit arbitrary page payloads, evaluated arguments, SDP,
                # resource bodies, screenshots, source text or network responses.
                label = str(event.get("method", event.get("messageType", "")))
                if label in ("pageError", "pageerror", "error") and len(console) < 8:
                    console.append({"type": typ, "label": label[:64], "time": event.get("time")})
    return {"path": info.filename, "bytes": total, "events": count, "event_types": event_types,
            "calls": list(result.values()), "error_events": console}


def main():
    run = api(f"actions/runs/{RUN}")
    if run.get("head_sha") != PRODUCT or run.get("status") != "completed" or run.get("conclusion") != "failure" or run.get("run_attempt") != 1:
        raise RuntimeError("exact failed original run required")
    metadata = api(f"actions/artifacts/{ARTIFACT}")
    if (metadata.get("id") != ARTIFACT or metadata.get("name") != "m9e-platform-diagnostics-" + PRODUCT
            or metadata.get("size_in_bytes") != ARCHIVE_BYTES or metadata.get("digest") != "sha256:" + ARCHIVE_SHA256
            or metadata.get("expired") is not False or metadata.get("workflow_run", {}).get("id") != RUN):
        raise RuntimeError("exact retained artifact identity differs")
    try:
        request(f"https://api.github.com/repos/Heraklines/elite-redux/actions/artifacts/{ARTIFACT}/zip", 0, True)
    except urllib.error.HTTPError as error:
        if error.code != 302:
            raise
        location = error.headers.get("Location", "")
        parsed = urllib.parse.urlsplit(location)
        if parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith(".blob.core.windows.net"):
            raise RuntimeError("artifact storage origin differs") from None
        error.close()
    else:
        raise RuntimeError("artifact API must redirect to isolated unauthenticated storage")
    raw = request(location, ARCHIVE_BYTES)
    if len(raw) != ARCHIVE_BYTES or hashlib.sha256(raw).hexdigest() != ARCHIVE_SHA256:
        raise RuntimeError("actual named artifact byte identity differs")
    with zipfile.ZipFile(io.BytesIO(raw)) as outer:
        if len(outer.infolist()) > 512:
            raise RuntimeError("outer artifact inventory cap")
        matches = [item for item in outer.infolist() if item.filename.endswith(TRACE_SUFFIX)]
        if len(matches) != 1 or matches[0].flag_bits & 1 or not 0 < matches[0].file_size <= 4 << 20:
            raise RuntimeError("exact bounded failed-case nested trace required")
        trace = outer.read(matches[0])
    with zipfile.ZipFile(io.BytesIO(trace)) as inner:
        if len(inner.infolist()) > 1024:
            raise RuntimeError("inner trace directory cap")
        streams = [item for item in inner.infolist() if item.filename.endswith(".trace") and "/" not in item.filename]
        if not 1 <= len(streams) <= 8:
            raise RuntimeError("bounded event trace inventory required")
        records = [read_trace(inner, item) for item in streams]
    return {"schema_version": 1, "status": "passed", "source_sha": os.environ["GITHUB_SHA"],
        "run_id": os.environ["GITHUB_RUN_ID"], "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"],
        "original_run": RUN, "original_product": PRODUCT, "artifact_id": ARTIFACT,
        "archive_bytes": len(raw), "archive_sha256": hashlib.sha256(raw).hexdigest(),
        "nested_trace": {"bytes": len(trace), "sha256": hashlib.sha256(trace).hexdigest()},
        "trace_streams": records, "elapsed_seconds_including_checkout": time.time() - int(START),
        "resources_read": False, "project_workloads_executed": False,
        "source_hashes": {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in
            ["scripts/ci/m9e_rtc_trace_diagnostic.py", ".github/workflows/m9e-rtc-startup-trace-focused.yml"]}}


REPORT.mkdir(parents=True, exist_ok=False)
try:
    summary = main()
except Exception as error:
    summary = {"status": "failed", "error": str(error)[:2048], "source_sha": os.environ["GITHUB_SHA"],
               "run_id": os.environ["GITHUB_RUN_ID"], "original_run": RUN}
encoded = (json.dumps(summary, sort_keys=True, separators=(",", ":")) + "\n").encode()
if len(encoded) > 32768:
    raise RuntimeError("metadata-only summary exceeds32KiB")
(REPORT / "summary.json").write_bytes(encoded)
raise SystemExit(0 if summary["status"] == "passed" else 1)
