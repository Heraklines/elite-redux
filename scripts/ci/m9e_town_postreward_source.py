"""Two fresh pinned-source observations of an actual reward-to-next-wave path."""

import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".m9e-town-postreward-source-store"
OUT = Path(os.environ["RUNNER_TEMP"]) / "m9e-town-postreward-source"
COMPACT = OUT / "compact"
PIN = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7"
BRANCH = "codex/m9e-town-postreward-source-20260923"
HELPER = "test/kernel-fixtures/m9/observe-town-postreward.ts"
INJECTED = "test/kernel-fixtures/m9-observe-town-postreward.test.ts"
UI_HELPER = "test/kernel-fixtures/m9/observe-town-starter-ui.ts"
UI_INJECTED = "test/kernel-fixtures/m9-observe-town-starter-ui.test.ts"
ASSET_COMMIT = "d5f67989d02b7082ca32e7eaddf3b9421916ff12"
ASSET_PATH = "battle-anims/tackle.json"
START = time.monotonic()
COMMANDS = []


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def run(name, argv, *, cwd, seconds=600, env=None):
    remaining = min(seconds, 1680 - int(time.monotonic() - START))
    require(remaining > 0, "shared source deadline")
    completed = subprocess.run(
        argv, cwd=cwd, env=env, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, timeout=remaining, check=False,
    )
    raw = completed.stdout
    require(len(raw) <= 8 << 20, name + " log bound")
    COMMANDS.append({
        "name": name, "exit": completed.returncode,
        "bytes": len(raw), "sha256": sha(raw),
    })
    if completed.returncode:
        excerpt = raw[:4096] + (
            b"\n...[middle omitted]...\n" + raw[-8192:] if len(raw) > 12288
            else raw[4096:]
        )
        if name.startswith("source-"):
            report = OUT / ("vitest-" + name.removeprefix("source-") + ".json")
            if report.is_file() and report.stat().st_size <= 1 << 20:
                parsed = json.loads(report.read_bytes())
                messages = [parsed.get("testExecError"), *[
                    suite.get("message") for suite in parsed.get("testResults", [])
                ], *[
                    assertion.get("failureMessages")
                    for suite in parsed.get("testResults", [])
                    for assertion in suite.get("assertionResults", [])
                ]]
                excerpt += b"\nVitest JSON failure messages:\n" + json.dumps(
                    [message for message in messages if message],
                    separators=(",", ":"),
                ).encode()[:12288]
        if name.startswith("source-ui-"):
            stage = OUT / ("starter-ui-stage-" + name.removeprefix("source-ui-") + ".json")
            if stage.is_file() and stage.stat().st_size <= 256:
                excerpt += b"\nLast starter UI stage:\n" + stage.read_bytes()
        (COMPACT / "failure.txt").write_bytes(name.encode() + b" failed\n" + excerpt)
        raise RuntimeError(name + " failed")
    return raw


def asset():
    url = (
        "https://api.github.com/repos/Heraklines/er-assets/contents/"
        + ASSET_PATH + "?ref=" + ASSET_COMMIT
    )
    request = urllib.request.Request(
        url, headers={"Accept": "application/vnd.github+json",
                      "User-Agent": "m9e-town-postreward-source",
                      "Authorization": "Bearer " + os.environ["GITHUB_TOKEN"]},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        require(response.status == 200 and response.geturl() == url, "pinned asset HTTP")
        raw = response.read((256 << 10) + 1)
    require(0 < len(raw) <= 256 << 10, "asset response bound")
    row = json.loads(raw)
    require(
        row.get("path") == ASSET_PATH and row.get("type") == "file"
        and row.get("encoding") == "base64",
        "asset identity",
    )
    content = base64.b64decode("".join(row["content"].split()), validate=True)
    require(
        len(content) == row.get("size")
        and hashlib.sha1(f"blob {len(content)}\0".encode() + content).hexdigest()
        == row.get("sha"),
        "asset Git blob",
    )
    path = SOURCE / "assets" / ASSET_PATH
    require(not path.exists(), "fresh asset path")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return {"commit": ASSET_COMMIT, "path": ASSET_PATH,
            "bytes": len(content), "sha256": sha(content)}


def main():
    COMPACT.mkdir(parents=True, exist_ok=False)
    result = {
        "schema": 1, "status": "failed", "source_pin": PIN,
        "candidate_sha": os.environ["GITHUB_SHA"],
        "scope": "two fresh explicit-starter and two fresh actual-UI reward-to-wave-two observations plus two alternate-seed starter UI observations; no Rust settlement qualification",
        "commands": COMMANDS,
    }
    try:
        require(os.environ["GITHUB_REF_NAME"] == BRANCH, "exact source-probe branch")
        require(
            run("candidate-head", ["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip()
            == result["candidate_sha"],
            "candidate HEAD",
        )
        require(
            run("source-head", ["git", "rev-parse", "HEAD"], cwd=SOURCE).decode().strip()
            == PIN,
            "pinned source HEAD",
        )
        candidate_status = run(
            "candidate-status", ["git", "status", "--porcelain"], cwd=ROOT,
        ).decode().splitlines()
        require(
            candidate_status in ([], ["?? .m9e-town-postreward-source-store/"]),
            "candidate changed outside the pinned nested checkout",
        )
        require(
            not run("source-status", ["git", "status", "--porcelain"], cwd=SOURCE),
            "clean pinned source",
        )
        injected = SOURCE / INJECTED
        ui_injected = SOURCE / UI_INJECTED
        require(not injected.exists() and not ui_injected.exists(),
                "fresh additive probe paths")
        injected.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / HELPER, injected)
        shutil.copyfile(ROOT / UI_HELPER, ui_injected)
        result["probe_sha256"] = sha(injected.read_bytes())
        result["ui_probe_sha256"] = sha(ui_injected.read_bytes())
        result["asset"] = asset()
        run("pinned-dependencies", ["pnpm", "install", "--frozen-lockfile"],
            cwd=SOURCE, seconds=700)
        observations = []
        for ordinal in ("one", "two"):
            report = OUT / ("vitest-" + ordinal + ".json")
            environment = os.environ.copy()
            environment["M9_TOWN_POSTREWARD_OUTPUT"] = str(OUT)
            environment["M9_TOWN_POSTREWARD_ORDINAL"] = ordinal
            run(
                "source-" + ordinal,
                ["pnpm", "exec", "vitest", "run", INJECTED, "--pool=forks",
                 "--isolate", "--no-file-parallelism", "--reporter=json",
                 "--outputFile=" + str(report)],
                cwd=SOURCE, seconds=300, env=environment,
            )
            vitest = json.loads(report.read_bytes())
            require(
                all(vitest.get(key) == value for key, value in {
                    "numTotalTests": 1, "numPassedTests": 1,
                    "numFailedTests": 0, "numPendingTests": 0,
                    "numTodoTests": 0, "success": True,
                }.items()),
                "one complete source test: " + ordinal,
            )
            path = OUT / ("observation-" + ordinal + ".json")
            raw = path.read_bytes()
            require(0 < len(raw) <= 8192, "bounded source observation")
            value = json.loads(raw)
            require(
                raw == (json.dumps(value, separators=(",", ":")) + "\n").encode()
                and value["source"] == PIN and value["first"]["attacking_turns"] > 0
                and isinstance(value["first"]["selections"], list)
                and len(value["first"]["selections"]) <= 8
                and value["reward"]["new_battle_calls"] == 1
                and isinstance(value.get("wave_cycle_offset"), int)
                and value["wave_cycle_offset"] in range(0, 40, 5)
                and value["current_time"] == value["effective_pool_time"] == 1
                and value["next"]["wave"] == 2
                and isinstance(value["next"]["battle_double"], bool)
                and value["next"]["enemy_party_count"] == len(value["next"]["enemy_species"])
                and value["next"]["enemy_party_count"] in (1, 2)
                and value["next"]["enemy_species"][0] == value["next"]["species"],
                "canonical causal observation",
            )
            observations.append(raw)
            result[ordinal] = {"bytes": len(raw), "sha256": sha(raw),
                               "next_species": value["next"]["species"],
                               "first_species": value["first"]["species"],
                               "first_attacking_turns": value["first"]["attacking_turns"]}
        require(observations[0] == observations[1], "two fresh source observations differ")
        (COMPACT / "observation.json").write_bytes(observations[0])
        ui_observations = []
        for ordinal in ("one", "two"):
            report = OUT / ("vitest-ui-" + ordinal + ".json")
            environment = os.environ.copy()
            environment["M9_TOWN_STARTER_UI_OUTPUT"] = str(OUT)
            environment["M9_TOWN_STARTER_UI_ORDINAL"] = ordinal
            run(
                "source-ui-" + ordinal,
                ["pnpm", "exec", "vitest", "run", UI_INJECTED, "--pool=forks",
                 "--isolate", "--no-file-parallelism", "--reporter=json",
                 "--outputFile=" + str(report)],
                cwd=SOURCE, seconds=300, env=environment,
            )
            vitest = json.loads(report.read_bytes())
            require(
                all(vitest.get(key) == value for key, value in {
                    "numTotalTests": 1, "numPassedTests": 1,
                    "numFailedTests": 0, "numPendingTests": 0,
                    "numTodoTests": 0, "success": True,
                }.items()),
                "one complete starter UI source test: " + ordinal,
            )
            path = OUT / ("starter-ui-" + ordinal + ".json")
            raw = path.read_bytes()
            require(0 < len(raw) <= 8192, "bounded starter UI observation")
            (COMPACT / "starter-ui-candidate.json").write_bytes(raw)
            value = json.loads(raw)
            require(
                raw == (json.dumps(value, separators=(",", ":")) + "\n").encode()
                and value["source"] == PIN and value["seed"] == "m9e-town-handoff-5042"
                and value["path"] == "title-starter-select-confirm-save-slot-encounter"
                and len(value["constructor"]) == 1
                and value["constructor"][0]["input"]["species"] == value["player"]["species"]
                and value["constructor"][0]["input"]["level"] == value["player"]["level"]
                and value["constructor"][0]["input"]["ivs"] == value["player"]["ivs"]
                and not value["constructor"][0]["input"]["has_data_source"]
                and isinstance(value["ui_draw_count"], int)
                and value["ui_draw_count"] >= len(value["ui_draws"])
                and len(value["ui_draws"]) <= 16
                and len(value["constructor_draws"]) <= 8
                and value["player"]["species"] == 1
                and value["player"]["level"] == 5
                and isinstance(value["pending_routes_ready"], bool)
                and isinstance(value["pending_routes"], list)
                and len(value["pending_routes"]) <= 16
                and value["successor"]["wave"] == 2
                and value["successor"]["player_id"] == value["player"]["id"]
                and value["successor"]["enemy_species"] == 504
                and value["successor"]["enemy_id"] == 3273058121
                and value["successor"]["vine_whip_pp_after"]
                    == value["successor"]["vine_whip_pp_before"] + 1,
                "canonical starter UI observation",
            )
            ui_observations.append(raw)
        require(ui_observations[0] == ui_observations[1],
                "two fresh starter UI observations differ")
        (COMPACT / "starter-ui-observation.json").write_bytes(ui_observations[0])
        (COMPACT / "starter-ui-candidate.json").unlink()
        result["starter_ui"] = {"bytes": len(ui_observations[0]),
                                "sha256": sha(ui_observations[0])}
        alternate_ui = []
        for ordinal in ("alt-one", "alt-two"):
            report = OUT / ("vitest-ui-" + ordinal + ".json")
            environment = os.environ.copy()
            environment["M9_TOWN_STARTER_UI_OUTPUT"] = str(OUT)
            environment["M9_TOWN_STARTER_UI_ORDINAL"] = ordinal
            environment["M9_TOWN_STARTER_UI_SEED"] = "m9e-town-handoff-774"
            run(
                "source-ui-" + ordinal,
                ["pnpm", "exec", "vitest", "run", UI_INJECTED, "--pool=forks",
                 "--isolate", "--no-file-parallelism", "--reporter=json",
                 "--outputFile=" + str(report)],
                cwd=SOURCE, seconds=300, env=environment,
            )
            vitest = json.loads(report.read_bytes())
            require(
                all(vitest.get(key) == value for key, value in {
                    "numTotalTests": 1, "numPassedTests": 1,
                    "numFailedTests": 0, "numPendingTests": 0,
                    "numTodoTests": 0, "success": True,
                }.items()),
                "one alternate starter UI source test: " + ordinal,
            )
            raw = (OUT / ("starter-ui-" + ordinal + ".json")).read_bytes()
            require(0 < len(raw) <= 8192, "bounded alternate starter UI observation")
            (COMPACT / "starter-ui-alternate-candidate.json").write_bytes(raw)
            value = json.loads(raw)
            require(
                raw == (json.dumps(value, separators=(",", ":")) + "\n").encode()
                and value["source"] == PIN
                and value["seed"] == "m9e-town-handoff-774"
                and len(value["constructor"]) == 1
                and value["player"]["species"] == 1
                and value["player"]["id"] == value["constructor"][0]["id"]
                and "successor" not in value,
                "canonical alternate starter UI observation",
            )
            alternate_ui.append(raw)
        require(alternate_ui[0] == alternate_ui[1],
                "two fresh alternate starter UI observations differ")
        (COMPACT / "starter-ui-alternate-observation.json").write_bytes(alternate_ui[0])
        (COMPACT / "starter-ui-alternate-candidate.json").unlink()
        result["starter_ui_alternate"] = {"bytes": len(alternate_ui[0]),
                                          "sha256": sha(alternate_ui[0])}
        result["status"] = "passed"
    except Exception as error:
        result["first_failure"] = str(error)[:1024]
    finally:
        result["elapsed_seconds"] = round(time.monotonic() - START, 1)
        encoded = (json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n").encode()
        require(len(encoded) <= 16384, "summary bound")
        (COMPACT / "summary.json").write_bytes(encoded)
    require(result["status"] == "passed", result.get("first_failure", "source failed"))


if __name__ == "__main__":
    main()
