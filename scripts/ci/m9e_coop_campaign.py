"""Exactly owned optimized correctness soak; ordinary native profiles stay unchanged."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time

TARGET = ("er-kernel", "m9e_natural_coop_campaign_v7")
IDS = ["natural_owned_cooperative_campaign_reaches_wave_200_victory"]
HELPER = "scripts/ci/m9e_coop_campaign.py"
PRODUCER = "scripts/ci/m9e_natural_coop_diagnostic.py"
TEST = "rust/crates/er-kernel/tests/m9e_natural_coop_campaign_v7.rs"
BUNDLE = "rust/fixtures/m9/engineering/game-content-bundle-v2.json"
SOURCES = ["rust/Cargo.lock","rust/Cargo.toml","rust/crates/er-battle/src/m7_resolver.rs","rust/crates/er-game/Cargo.toml","rust/crates/er-game/src/m72_bootstrap.rs","rust/crates/er-game/src/m9e_new_run_v6.rs","rust/crates/er-game/src/m9e_runtime_v6.rs","rust/crates/er-kernel/Cargo.toml","rust/crates/er-kernel/src/current_coop_setup_v7.rs","rust/crates/er-kernel/src/game_kernel_v7.rs","rust/crates/er-kernel/src/snapshot_v7.rs","rust/crates/er-kernel/tests/m9e_ai_command_transaction_v7.rs","rust/crates/er-kernel/tests/m9e_game_kernel_v7.rs","rust/crates/er-kernel/tests/m9e_natural_coop_campaign_v7.rs","rust/crates/er-kernel/tests/m9e_natural_replacement_v7.rs","rust/crates/er-kernel/tests/m9e_snapshot_v7.rs","rust/crates/er-progression/src/current_growth_pow.rs","rust/crates/er-progression/src/progression.rs","rust/crates/er-rng/src/battle.rs","rust/crates/er-rng/src/phaser.rs","rust/crates/er-state/src/m7_state.rs","rust/crates/er-state/src/m9e_state_v6.rs","rust/crates/er-types/src/m72_bootstrap.rs","rust/fixtures/m9/engineering/game-content-bundle-v2-manifest.json","rust/rust-toolchain.toml","scripts/ci/m9e_current_cost.py","scripts/ci/m9e_coop_campaign.py","scripts/ci/m9e_natural_coop_diagnostic.py",".github/workflows/m9e-natural-coop-campaign-focused.yml"]


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def valid_hash(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def validate_evidence(evidence, identity, root):
    if (not isinstance(evidence, dict) or evidence.get("status") != "passed"
            or any(evidence.get(key) != identity[target] for key, target in (
                ("source_sha", "product_sha"), ("run_id", "run_id"), ("run_attempt", "run_attempt"), ("toolchain", "toolchain")))
            or evidence.get("tests") != {"executed": 1, "passed": 1, "failed": 0, "skipped": 0}
            or evidence.get("owned_target_removed") is not True):
        raise RuntimeError("cooperative campaign exact completion, cleanup or same-run identity differs")
    hashes = evidence.get("source_hashes", {})
    if (set(hashes) != set(SOURCES) or any(not valid_hash(value) or digest(Path(root) / path) != value for path, value in hashes.items())
            or evidence.get("bundle_sha256") != digest(Path(root) / BUNDLE)):
        raise RuntimeError("cooperative campaign source/content binding differs")
    artifact = evidence.get("test_artifact", {})
    profile = artifact.get("profile", {})
    if (artifact.get("ids") != IDS or artifact.get("source_sha256") != hashes[TEST]
            or not valid_hash(artifact.get("sha256")) or type(artifact.get("bytes")) is not int
            or not 0 < artifact["bytes"] <= 128 << 20 or profile.get("opt_level") != "1"
            or any(profile.get(key) is not True for key in ("test", "debug_assertions", "overflow_checks"))):
        raise RuntimeError("cooperative campaign actual optimized debug artifact differs")
    for name, limit, bound in (("build", 900, 16 << 20), ("execute", 600, 16384)):
        record = evidence.get("logs", {}).get(name, {})
        seconds = record.get("elapsed_seconds")
        if (not valid_hash(record.get("sha256")) or type(record.get("bytes")) is not int
                or not 0 < record["bytes"] <= bound or type(seconds) not in (int, float) or not 0 < seconds <= limit):
            raise RuntimeError("cooperative campaign complete bounded build/execution log required")
    coverage = evidence.get("natural_cooperative_campaign", {})
    if (set(coverage) != {"decisions", "proposals", "materials", "presentations", "rewards", "progression"}
            or any(type(coverage.get(key)) is not int or coverage[key] <= limit
                   for key, limit in (("decisions", 0), ("proposals", 199), ("materials", 399), ("presentations", 399), ("rewards", 198), ("progression", 198)))):
        raise RuntimeError("cooperative campaign complete contiguous coverage required")


def validate_lane(proof, root, partition):
    plan = proof["plan"]
    required = plan.get("requires_natural_coop_campaign", False)
    rows = [row for row in proof["inventory"] if (row["crate"], row["target"]) == TARGET]
    if type(required) is not bool or (rows and not required):
        raise RuntimeError("cooperative campaign obligation absent or not boolean")
    if required:
        if (len(rows) != 1 or rows[0]["ids"] != IDS or rows[0]["historical_excluded_ids"]
                or plan.get("required_native_targets", {}).get(TARGET[0], []).count(TARGET[1]) != 1
                or plan.get("required_native_test_ids", {}).get(":".join(TARGET)) != IDS
                or list(TARGET) not in partition(proof["inventory"])["e"]):
            raise RuntimeError("cooperative campaign exact inventory or native E ownership differs")
        if proof["lane"] == "e":
            validate_evidence(proof.get("natural_cooperative_campaign"), proof["identity"], root)
    if "natural_cooperative_campaign" in proof and (not required or proof["lane"] != "e"):
        raise RuntimeError("unrequested or non-owning cooperative campaign evidence")


def execute(root, full, identity, ids, global_deadline):
    from m9e_current_cost import run_bounded
    if ids != IDS or os.environ.get("M9E_NATIVE_LANE") != "e" or os.environ.get("M9E_PHASE") != "native":
        raise RuntimeError("cooperative campaign requires exactly-once native E execution")
    root, full = Path(root), Path(full)
    owned = Path(os.environ["RUNNER_TEMP"]) / "m9e-natural-coop-campaign-focused"
    if owned.exists():
        raise RuntimeError("cooperative campaign owned output already exists")
    environment = dict(os.environ)
    environment.update({"RUSTUP_TOOLCHAIN": "1.97.1", "CARGO_INCREMENTAL": "0", "CARGO_PROFILE_DEV_DEBUG": "0",
                        "CARGO_PROFILE_TEST_DEBUG": "0", "CARGO_PROFILE_TEST_OPT_LEVEL": "1",
                        "CARGO_PROFILE_TEST_DEBUG_ASSERTIONS": "true", "CARGO_PROFILE_TEST_OVERFLOW_CHECKS": "true"})
    try:
        run_bounded([sys.executable, PRODUCER], cwd=root, environment=environment,
                    output=full / "coop-campaign-producer.log", seconds=900, byte_limit=65536,
                    global_deadline=global_deadline)
        path = owned / "compact/summary.json"
        if not 0 < path.stat().st_size <= 16384 or (owned / "target").exists():
            raise RuntimeError("cooperative campaign bounded proof or owned cleanup differs")
        evidence = json.loads(path.read_text())
        validate_evidence(evidence, identity, root)
        matches = list((owned / "diagnostics").glob("*-execute.log"))
        if len(matches) != 1 or digest(matches[0]) != evidence["logs"]["execute"]["sha256"]:
            raise RuntimeError("cooperative campaign actual execution log digest differs")
        output = matches[0].read_text()
        counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
        coverage = re.findall(r"M9E_NATURAL_COOP_CAMPAIGN wave=200 outcome=Victory decisions=(\d+) proposals=(\d+) materials=(\d+) presentations=(\d+) rewards=(\d+) progression=(\d+)", output)
        if (counts != [("1", "0", "0", "0", "0")] or len(coverage) != 1
                or dict(zip(("decisions", "proposals", "materials", "presentations", "rewards", "progression"), map(int, coverage[0]))) != evidence["natural_cooperative_campaign"]
                or time.monotonic() > global_deadline):
            raise RuntimeError("cooperative campaign actual complete log or shared deadline differs")
        return evidence
    finally:
        if (owned / "diagnostics").is_dir():
            shutil.copytree(owned / "diagnostics", full / "coop-campaign")
        if (owned / "compact/summary.json").is_file():
            shutil.copyfile(owned / "compact/summary.json", full / "coop-campaign-summary.json")
        if (owned / "target").exists():
            shutil.rmtree(owned / "target")


def aggregate_reference(native, native_hash):
    if not native["plan"].get("requires_natural_coop_campaign"):
        return {}
    evidence = native["natural_cooperative_campaign"]
    return {"natural_cooperative_campaign": {"status": "passed", "tests": 1,
            "profile": "opt1-debug-assertions-overflow-checks", "wave": 200, "outcome": "Victory",
            **evidence["natural_cooperative_campaign"], "native_manifest_sha256": native_hash,
            "evidence_sha256": hashlib.sha256((json.dumps(evidence, sort_keys=True, separators=(",", ":")) + "\n").encode()).hexdigest()}}
