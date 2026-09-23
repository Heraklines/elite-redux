#!/usr/bin/env python3
"""Bounded, exact-SHA native/Wasm eventwise parity witness for M9E."""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time


ROOT = Path(__file__).resolve().parents[2]
RUST = ROOT / "rust"
OUT = Path(os.environ["RUNNER_TEMP"]) / "m9e-wasm-parity"
COMPACT = OUT / "compact"
DIAGNOSTICS = OUT / "diagnostics"
SHA = os.environ["GITHUB_SHA"]
START = time.monotonic()
DEADLINE_SECONDS = 48 * 60
EXPECTED = {
    "native": {"native_replays_v7_raw_inputs_eventwise", "native_replays_v7_held_timers_eventwise"},
    "wasm": {"wasm_replays_v7_raw_inputs_eventwise", "wasm_replays_v7_held_timers_eventwise"},
}


def execute(label: str, command: list[str], env: dict[str, str], seconds: int) -> str:
    remaining = int(DEADLINE_SECONDS - (time.monotonic() - START))
    if remaining <= 0:
        raise RuntimeError(f"shared deadline expired before {label}")
    log = OUT / f"{label}.log"
    with log.open("wb") as output:
        result = subprocess.run(command, cwd=RUST, env=env, stdout=output,
                                stderr=subprocess.STDOUT, timeout=min(seconds, remaining), check=False)
    raw = log.read_bytes()
    # The artifact carries a bounded excerpt even when an upstream tool is noisy.
    excerpt = raw[:4096] + (b"\n...[middle omitted]...\n" + raw[-12288:] if len(raw) > 16384 else raw[4096:])
    (DIAGNOSTICS / f"{label}.txt").write_bytes(excerpt)
    if result.returncode:
        raise RuntimeError(f"{label} exited {result.returncode}; inspect its bounded excerpt")
    return raw.decode("utf-8", errors="replace")


def evidence(platform: str, output: str) -> dict:
    expected = EXPECTED[platform]
    prefix = "native" if platform == "native" else "wasm"
    names = re.findall(rf"\btest (?:[A-Za-z0-9_]+::)*({prefix}_replays_v7_[A-Za-z0-9_]+)", output)
    counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored;", output)
    if len(names) != 2 or set(names) != expected or counts != [("2", "0", "0")]:
        raise RuntimeError(f"{platform} test identities/counts disagree: names={names}, counts={counts}")
    digests = {}
    for kind in ("RAW", "TIMER"):
        found = re.findall(rf"M9E_{kind}_PARITY_DIGEST=([^\s]+)", output)
        if len(found) != 1 or not re.fullmatch(r"[0-9a-f]{64}", found[0]):
            raise RuntimeError(f"{platform} {kind} full-record digest missing, duplicated or malformed")
        digests[kind.lower()] = found[0]
    return {"passed": 2, "failed": 0, "ignored": 0, "test_ids": sorted(expected), "report_digests": digests}


def wasm_single_evidence(output: str, test_id: str, marker: str) -> str:
    names = re.findall(r"\btest (?:[A-Za-z0-9_]+::)*(wasm_replays_v7_[A-Za-z0-9_]+)", output)
    counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored;", output)
    digests = re.findall(rf"M9E_{marker}_PARITY_DIGEST=([^\s]+)", output)
    if names != [test_id] or counts != [("1", "0", "0")] or len(digests) != 1 or not re.fullmatch(r"[0-9a-f]{64}", digests[0]):
        raise RuntimeError(f"Wasm {test_id} identity, count or full-record digest disagrees")
    return digests[0]


def main() -> None:
    COMPACT.mkdir(parents=True, exist_ok=True)
    DIAGNOSTICS.mkdir(parents=True, exist_ok=True)
    summary: dict = {"schema": 1, "source_sha": SHA, "status": "failed",
                     "scope": "existing V7 controlled raw-input and held-timer eventwise native/Wasm parity"}
    try:
        if not re.fullmatch(r"[0-9a-f]{40}", SHA):
            raise RuntimeError("invalid exact source SHA")
        actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        if actual != SHA:
            raise RuntimeError("checked-out source does not match workflow SHA")
        forbidden = ("RUST_MIN_STACK", "RUST_TEST_THREADS", "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS")
        present = [key for key in forbidden if key in os.environ]
        if present:
            raise RuntimeError(f"ambient test/compiler flags are forbidden: {present}")
        fixture = RUST / "fixtures/m9/engineering/game-content-bundle-v2.json"
        summary["content_fixture"] = {"bytes": fixture.stat().st_size,
                                      "sha256": hashlib.sha256(fixture.read_bytes()).hexdigest()}
        env = os.environ.copy()
        env["CARGO_TARGET_DIR"] = str(RUST / "target")
        native = execute("native", ["cargo", "test", "--locked", "-p", "er-wasm", "--test",
                                    "m9e_parity", "--", "--nocapture"], env, 1500)
        summary["native"] = evidence("native", native)
        version = subprocess.run(["wasm-bindgen", "--version"], cwd=RUST,
                                 capture_output=True, text=True, check=False) if shutil.which("wasm-bindgen") else None
        if version is None or version.returncode != 0 or version.stdout.strip() != "wasm-bindgen 0.2.127":
            execute("wasm-tools", ["cargo", "install", "wasm-bindgen-cli", "--version",
                                   "0.2.127", "--locked", "--force"], env, 900)
        env["CARGO_TARGET_DIR"] = str(Path(os.environ["RUNNER_TEMP"]) / "m9e-wasm-target")
        env["CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER"] = "wasm-bindgen-test-runner"
        command = ["cargo", "test", "--locked", "-p", "er-wasm", "--test", "m9e_parity",
                   "--target", "wasm32-unknown-unknown", "--"]
        held = execute("wasm-held", command + ["wasm_replays_v7_held_timers_eventwise", "--nocapture"], env, 1500)
        held_digest = wasm_single_evidence(held, "wasm_replays_v7_held_timers_eventwise", "TIMER")
        summary["wasm_held_digest"] = held_digest
        raw = execute("wasm-raw", command + ["wasm_replays_v7_raw_inputs_eventwise", "--nocapture"], env, 1500)
        raw_digest = wasm_single_evidence(raw, "wasm_replays_v7_raw_inputs_eventwise", "RAW")
        summary["wasm"] = {"passed": 2, "failed": 0, "ignored": 0,
                           "test_ids": sorted(EXPECTED["wasm"]),
                           "report_digests": {"timer": held_digest, "raw": raw_digest}}
        if summary["native"]["report_digests"] != summary["wasm"]["report_digests"]:
            raise RuntimeError("native/Wasm full-record report digests disagree")
        summary["status"] = "passed"
    except Exception as error:
        summary["first_failure"] = str(error)[:1024]
    finally:
        summary["elapsed_seconds"] = round(time.monotonic() - START, 1)
        (COMPACT / "summary.json").write_text(json.dumps(summary, sort_keys=True, separators=(",", ":")) + "\n")
    if summary["status"] != "passed":
        raise RuntimeError(summary["first_failure"])


if __name__ == "__main__":
    main()
