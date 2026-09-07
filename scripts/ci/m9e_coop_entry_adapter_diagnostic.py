"""Remote F for the actual integration entry adapter, with unchanged command caps."""
import json
import os
from pathlib import Path
import time
import traceback

REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-coop-entry-adapter"
os.environ["M9E_REPORT_DIR"] = str(REPORT)
os.environ["M9E_NATIVE_LANE"] = "a"
import m9e_feedback as feedback
import m9e_phases as phases
import m9e_coop_startup as coop

FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
FULL.mkdir(parents=True, exist_ok=False)
COMPACT.mkdir(parents=True, exist_ok=False)
feedback.FULL.mkdir(parents=True, exist_ok=True)
started = time.monotonic()
summary = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"],
           "run_id": os.environ["GITHUB_RUN_ID"], "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"],
           "qualification": "actual integration adapter and both entry regressions; no full integration qualification"}
try:
    identity = phases.identity(feedback)
    summary["identity"] = identity
    binding = coop.source_binding(feedback.ROOT, identity["product_sha"])
    summary["source_binding"] = binding
    summary["adapter_sources"] = {name: coop.digest(feedback.ROOT / name) for name in (
        "scripts/ci/m9e_coop_entry_adapter_diagnostic.py", ".github/workflows/m9e-coop-entry-focused.yml")}
    summary["entry"] = coop.execute_entry(feedback.ROOT, FULL, identity, binding, coop.ENTRY_IDS, started + 900)
    coop.validate_entry(summary["entry"], identity, binding, feedback.ROOT)
    if phases.identity(feedback) != identity or any(coop.digest(feedback.ROOT / name) != value for name, value in summary["adapter_sources"].items()):
        raise RuntimeError("adapter source changed")
    if time.monotonic() - started > 900:
        raise RuntimeError("adapter exceeded unchanged command ceiling")
    summary["status"] = "passed"
except Exception as error:
    summary["failure"] = str(error)
    details = traceback.format_exc().encode()
    if len(details) > 65536:
        details = b"TRUNCATED: complete producer logs remain remote.\n" + details[-65000:]
    (FULL / "adapter-failure.txt").write_bytes(details)
summary["elapsed_seconds"] = time.monotonic() - started
encoded = (json.dumps(summary, sort_keys=True, indent=2) + "\n").encode()
if len(encoded) > 16384:
    raise RuntimeError("adapter summary exceeds unchanged compact bound")
(COMPACT / "summary.json").write_bytes(encoded)
print(json.dumps({key: summary[key] for key in ("status", "source_sha", "run_id")}))
raise SystemExit(0 if summary["status"] == "passed" else 1)
