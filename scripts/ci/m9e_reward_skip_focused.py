"""Compact remote feedback for the complete current-phase witness target."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
RUST = ROOT / "rust"
OUT = Path(os.environ["RUNNER_TEMP"]) / "m9e-reward-skip" / "compact"
START = time.monotonic()
COMMANDS = []


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(name, args, seconds=300):
    remaining = min(seconds, 1100 - int(time.monotonic() - START))
    require(remaining > 0, "shared reward-skip deadline")
    completed = subprocess.run(
        args, cwd=RUST, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        timeout=remaining, check=False,
    )
    raw = completed.stdout
    require(len(raw) <= 8 << 20, name + " log bound")
    COMMANDS.append({"name": name, "exit": completed.returncode,
                     "bytes": len(raw), "sha256": sha(raw)})
    if completed.returncode:
        excerpt = raw[:4096]
        if len(raw) > 12288:
            excerpt += b"\n...[middle omitted]...\n" + raw[-8192:]
        else:
            excerpt += raw[4096:]
        (OUT / "failure.txt").write_bytes(name.encode() + b" failed\n" + excerpt)
        raise RuntimeError(name + " failed")
    return raw.decode("utf-8", errors="replace")


def main():
    OUT.mkdir(parents=True, exist_ok=False)
    result = {"schema": 1, "status": "failed", "sha": os.environ["GITHUB_SHA"],
              "scope": "whole current-phase target on one reward-skip branch SHA; no full M9 qualification",
              "commands": COMMANDS}
    try:
        require(os.environ["GITHUB_REF_NAME"] == "codex/m9e-reward-skip-focused-20260923",
                "exact feedback branch")
        require(subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT,
                                        text=True).strip() == result["sha"], "exact HEAD")
        require(not subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT),
                "clean source checkout")
        run("format", ["cargo", "fmt", "--manifest-path", "Cargo.toml", "--all", "--", "--check"], 120)
        target = ["cargo", "test", "--locked", "-p", "er-kernel", "--test",
                  "m9e_current_phase_execution", "--"]
        listing = run("list", target + ["--list", "--format", "terse"], 600)
        ids = re.findall(r"^([A-Za-z0-9_:]+): test$", listing, re.M)
        require(len(ids) == 4 and len(set(ids)) == 4
                and "controlled_early_ko_flash_owns_clock_egg_candy_and_canceled_suffix" in ids,
                "whole phase target inventory")
        output = run("execute", target + ["--format", "terse"], 600)
        counts = re.findall(
            r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out",
            output,
        )
        require(counts == [("4", "0", "0", "0", "0")], "whole phase target result")
        for crate, flags in (("er-state", ["--lib"]), ("er-game", ["--lib"]),
                             ("er-kernel", ["--test", "m9e_current_phase_execution"])):
            run("clippy-" + crate,
                ["cargo", "clippy", "--locked", "-p", crate, *flags,
                 "--no-deps", "--", "-D", "warnings"], 300)
        result["tests"] = {"passed": 4, "failed": 0, "ids": ids}
        result["status"] = "passed"
    except Exception as error:
        result["first_failure"] = str(error)[:1024]
    finally:
        result["elapsed_seconds"] = round(time.monotonic() - START, 1)
        (OUT / "summary.json").write_text(json.dumps(result, sort_keys=True,
                                                       separators=(",", ":")) + "\n")
    require(result["status"] == "passed", result.get("first_failure", "focused run failed"))


if __name__ == "__main__":
    main()
