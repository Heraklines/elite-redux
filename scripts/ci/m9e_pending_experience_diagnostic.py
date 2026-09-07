"""Remote observation-owner F; twenty-six real target tests, no XP award or production entry claim."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-pending-experience-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
TARGET = REPORT / "target"
DEADLINE = None
run_bounded = None
BASE_SHA = "9fbb9fa2a624f8341974ce27e18260a21063751f"
BASE_TREE = "e025db5e75c65ee152821a36e31c9eb5eeb6960c"
HELPER_SHA = "22285aefe9c4588f5abbc9500801cbaececaef31646646d7f947975ecff9ce75"
# Original base leaves for the exact19 product and5 generated paths; None means
# the path did not exist at the base. Candidate product hashes remain explicit
# in the compact source receipt and independent reviewed formatting-chain audit.
BASE_LEAVES = json.loads(r'''{
  "rust/crates/er-battle/src/m7_resolver.rs": [
    "100644",
    "994c1f8fb95b7664ecb36d2676336cd5197fd1ff"
  ],
  "rust/crates/er-game/src/m9e_content_v2.rs": [
    "100644",
    "5233fc1678b8c81034c54a1f182d962c5887390f"
  ],
  "rust/crates/er-game/src/m9e_material_v6.rs": [
    "100644",
    "e3070c4020f65f0453bdb21f663ffbafe1d1496f"
  ],
  "rust/crates/er-game/src/m9e_new_run_v6.rs": [
    "100644",
    "975b6c08b0c9e5e22f9e3a9b77beb13781fab700"
  ],
  "rust/crates/er-game/src/m9e_runtime_v6.rs": [
    "100644",
    "aa29a748ae0339fcdbdc3dddac1093833f60af90"
  ],
  "rust/crates/er-game/tests/m9e_battle_participation.rs": null,
  "rust/crates/er-game/tests/m9e_content_v2.rs": [
    "100644",
    "cb413059757fcba920052c108b56028d3c1525f3"
  ],
  "rust/crates/er-game/tests/m9e_material_retention.rs": [
    "100644",
    "611c1f536c4bc2d03818562a977f8a269dc844d3"
  ],
  "rust/crates/er-game/tests/m9e_material_v6.rs": [
    "100644",
    "9cb550e050b06dcd96a63a1e42b1604aca3cd3f0"
  ],
  "rust/crates/er-game/tests/m9e_runtime_v6.rs": [
    "100644",
    "781342bb6d4f38ec436596719741e9e96efd946c"
  ],
  "rust/crates/er-kernel/tests/m9e_material_retention_v7.rs": [
    "100644",
    "3528a8425e359a66f40b20318d1f095cd071b60b"
  ],
  "rust/crates/er-kernel/tests/m9e_snapshot_v7.rs": [
    "100644",
    "c1a916a735d52915b4e138182756b2a40ccb1349"
  ],
  "rust/crates/er-progression/src/content_v2.rs": [
    "100644",
    "bbb2f3f2d487ca583aa8ca57d0bb38291e160924"
  ],
  "rust/crates/er-progression/tests/m9e_content_v2.rs": [
    "100644",
    "7b40115ba0c097c00452b23a11f628c8a793751d"
  ],
  "rust/crates/er-save/src/m9e_save_v2.rs": [
    "100644",
    "3b383fce0483af4937991ecca2c4930912888ce0"
  ],
  "rust/crates/er-state/src/current_battle_participation.rs": null,
  "rust/crates/er-state/src/current_experience_owner.rs": null,
  "rust/crates/er-state/src/lib.rs": [
    "100644",
    "742ffd8688b940b552351c2b548755d22efeb336"
  ],
  "rust/crates/er-state/src/m9e_state_v6.rs": [
    "100644",
    "c0f7fcf02055cbf91cf1d92d59a514266142f402"
  ],
  "rust/fixtures/m9/engineering/complete-progression-definitions-v1.json": [
    "100644",
    "34c5fbad7ae887bdb550f2e619e61d363743c1ee"
  ],
  "rust/fixtures/m9/engineering/game-content-bundle-v2-manifest.json": [
    "100644",
    "3e539d67aa3e1d0b5bcb5cd0407cc06e47ba84b3"
  ],
  "rust/fixtures/m9/engineering/game-content-bundle-v2.json": [
    "100644",
    "6b435b78bc4d62c7f492142752c91610b914a071"
  ],
  "rust/fixtures/m9/engineering/progression-content-pack-v2.json": [
    "100644",
    "9563affbe667ea9082f0e8005a17b57368328e66"
  ],
  "rust/fixtures/m9/engineering/progression-oracle-report-v2.json": [
    "100644",
    "50eb6080b8da77720e7630a65845ed3a1f3731a0"
  ]
}''')
TARGETS = [
  [
    "er-game",
    "m9e_battle_participation",
    "rust/crates/er-game/tests/m9e_battle_participation.rs",
    [
      "current_faint_membership_uses_stable_ids_and_removes_player_after_recording",
      "historical_owner_absence_preserves_canonical_bytes",
      "malformed_evidence_capacity_and_counter_failures_roll_back",
      "natural_bootstrap_switch_and_ko_preserve_legacy_gameplay",
      "natural_enemy_faint_owns_unresolved_experience_without_applying_amount",
      "next_natural_battle_retains_occurrence_highwater",
      "observed_save_snapshot_and_material_replay_preserve_ownership",
      "pending_experience_counter_exhaustion_rolls_back_real_enemy_faint",
      "pending_experience_restore_rejects_source_policy_and_frontier_forgeries",
      "pending_experience_survives_real_save_replay_and_rejects_owner_stripping_material",
      "pending_experience_unsettled_tail_rejects_actions_and_next_encounter"
    ]
  ],
  [
    "er-game",
    "m9e_new_run_v6",
    "rust/crates/er-game/tests/m9e_new_run_v6.rs",
    [
      "complete_bootstrap_builds_a_deterministic_playable_v6_state"
    ]
  ],
  [
    "er-kernel",
    "m9e_snapshot_v7",
    "rust/crates/er-kernel/tests/m9e_snapshot_v7.rs",
    [
      "active_snapshot_round_trips_at_a_quiescent_boundary",
      "quiescent_v6_snapshot_migrates_without_gameplay_side_effects",
      "terminal_lifecycle_requires_complete_control_and_terminal_identity",
      "typed_pending_effects_cross_validate_allocator_and_content"
    ]
  ],
  [
    "er-kernel",
    "m9e_material_retention_v7",
    "rust/crates/er-kernel/tests/m9e_material_retention_v7.rs",
    [
      "v7_material_rollover_restores_pending_effects_and_continues_exact_snapshots",
      "v7_restore_rejects_historical_gapped_evidence_and_continues_a_valid_suffix"
    ]
  ],
  [
    "er-progression",
    "m9e_content_v2",
    "rust/crates/er-progression/tests/m9e_content_v2.rs",
    [
      "compiled_experience_bridge_never_reinterprets_species_rows",
      "compiled_experience_bridge_requires_metadata_and_exact_no_form_identity",
      "experience_classes_are_closed_and_every_metadata_field_is_hashed",
      "historical_species_bytes_and_missing_experience_remain_explicit",
      "inconsistent_experience_cohorts_and_classifications_fail_validation",
      "signed_special_learnset_levels_are_preserved",
      "source_form_lookup_distinguishes_species_row_and_first_form",
      "unknown_move_reference_fails_closed"
    ]
  ]
]
RUST_SOURCES = [
  "rust/crates/er-battle/src/m7_resolver.rs",
  "rust/crates/er-game/src/m9e_content_v2.rs",
  "rust/crates/er-game/src/m9e_material_v6.rs",
  "rust/crates/er-game/src/m9e_new_run_v6.rs",
  "rust/crates/er-game/src/m9e_runtime_v6.rs",
  "rust/crates/er-game/tests/m9e_battle_participation.rs",
  "rust/crates/er-game/tests/m9e_content_v2.rs",
  "rust/crates/er-game/tests/m9e_material_retention.rs",
  "rust/crates/er-game/tests/m9e_material_v6.rs",
  "rust/crates/er-game/tests/m9e_runtime_v6.rs",
  "rust/crates/er-kernel/tests/m9e_material_retention_v7.rs",
  "rust/crates/er-kernel/tests/m9e_snapshot_v7.rs",
  "rust/crates/er-progression/src/content_v2.rs",
  "rust/crates/er-progression/tests/m9e_content_v2.rs",
  "rust/crates/er-save/src/m9e_save_v2.rs",
  "rust/crates/er-state/src/current_battle_participation.rs",
  "rust/crates/er-state/src/current_experience_owner.rs",
  "rust/crates/er-state/src/lib.rs",
  "rust/crates/er-state/src/m9e_state_v6.rs"
]
FIXTURE_INPUTS = {
  "rust/fixtures/m9/engineering/complete-progression-definitions-v1.json": [
    3724089,
    "9d8a49da2746c5e5cf3b3eeddafdf67d7d23c7aa",
    "bba00376cae18feae56bebe38c5be0f1bb3aae3fd9a6e99e3ec7fa60a15de08f"
  ],
  "rust/fixtures/m9/engineering/game-content-bundle-v2-manifest.json": [
    1219,
    "76c320db3187e35ba64eccecf382fb7473209f8d",
    "63bf9531e080c09ea47b12b328af0a09abe7333e5c0d228dd45fa666f239bb2e"
  ],
  "rust/fixtures/m9/engineering/game-content-bundle-v2.json": [
    16325821,
    "778d0bd4f31fac16c2823ad1ad0c6a8761fede68",
    "9afce9fd3bc6e05e2159f19e8578ff64fc342b8a5974bec5f15648b0799d74d2"
  ],
  "rust/fixtures/m9/engineering/progression-content-pack-v2.json": [
    3576205,
    "e9c7ed41d2fa5be32d279a8cd9524a720e5f1665",
    "1864120e3130162bdd11c9370ae436140b0896a062fa10da9100445776bad17b"
  ],
  "rust/fixtures/m9/engineering/progression-oracle-report-v2.json": [
    510,
    "96ecd22adee9d85269d7f5cfe57927fd539aaa12",
    "64b4b759c46a897720230ffa0c87d73158d6ff69c2e18f4bdfb2d9c64408bec7"
  ]
}
SOURCES = [
  ".github/workflows/m9e-pending-experience-focused.yml",
  "rust/Cargo.lock",
  "rust/Cargo.toml",
  "rust/crates/er-battle/Cargo.toml",
  "rust/crates/er-battle/src/lib.rs",
  "rust/crates/er-battle/src/m7_resolver.rs",
  "rust/crates/er-game/Cargo.toml",
  "rust/crates/er-game/src/lib.rs",
  "rust/crates/er-game/src/m72_bootstrap.rs",
  "rust/crates/er-game/src/m9e_content_v2.rs",
  "rust/crates/er-game/src/m9e_material_v6.rs",
  "rust/crates/er-game/src/m9e_new_run_v6.rs",
  "rust/crates/er-game/src/m9e_runtime_v6.rs",
  "rust/crates/er-game/tests/m9e_battle_participation.rs",
  "rust/crates/er-game/tests/m9e_content_v2.rs",
  "rust/crates/er-game/tests/m9e_material_retention.rs",
  "rust/crates/er-game/tests/m9e_material_v6.rs",
  "rust/crates/er-game/tests/m9e_new_run_v6.rs",
  "rust/crates/er-game/tests/m9e_runtime_v6.rs",
  "rust/crates/er-kernel/Cargo.toml",
  "rust/crates/er-kernel/src/current_coop_setup_v7.rs",
  "rust/crates/er-kernel/src/current_proposal_v7.rs",
  "rust/crates/er-kernel/src/game_kernel_v7.rs",
  "rust/crates/er-kernel/src/snapshot_v7.rs",
  "rust/crates/er-kernel/tests/m9e_material_retention_v7.rs",
  "rust/crates/er-kernel/tests/m9e_snapshot_v7.rs",
  "rust/crates/er-progression/Cargo.toml",
  "rust/crates/er-progression/src/content_v2.rs",
  "rust/crates/er-progression/src/lib.rs",
  "rust/crates/er-progression/tests/m9e_content_v2.rs",
  "rust/crates/er-save/Cargo.toml",
  "rust/crates/er-save/src/lib.rs",
  "rust/crates/er-save/src/m9e_save_v2.rs",
  "rust/crates/er-state/Cargo.toml",
  "rust/crates/er-state/src/current_battle_participation.rs",
  "rust/crates/er-state/src/current_experience_owner.rs",
  "rust/crates/er-state/src/lib.rs",
  "rust/crates/er-state/src/m7_state.rs",
  "rust/crates/er-state/src/m9e_state_v6.rs",
  "rust/crates/er-types/src/battle_ids.rs",
  "rust/crates/er-types/src/run_ids.rs",
  "rust/rust-toolchain.toml",
  "scripts/ci/m9e_pending_experience_diagnostic.py",
  "scripts/ci/m9e_current_cost.py"
]
PROFILE = {"RUSTUP_TOOLCHAIN": "1.97.1", "CARGO_INCREMENTAL": "0",
           "CARGO_PROFILE_TEST_OPT_LEVEL": "0", "CARGO_PROFILE_TEST_DEBUG_ASSERTIONS": "true",
           "CARGO_PROFILE_TEST_OVERFLOW_CHECKS": "true", "CARGO_PROFILE_TEST_DEBUG": "0",
           "CARGO_PROFILE_DEV_DEBUG": "0",
           "CARGO_ENCODED_RUSTFLAGS": "-Copt-level=0\x1f-Cdebug-assertions=yes\x1f-Coverflow-checks=yes"}
os.environ.update(PROFILE)
os.environ["CARGO_TARGET_DIR"] = str(TARGET)
sequence = 0
logs = {}
failed_log = None


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(args, name, *, cwd=None, seconds=600, bound=16 << 20):
    global sequence, failed_log
    sequence += 1
    output = FULL / f"{sequence:03d}-{name}.log"
    try:
        result = run_bounded(args, cwd=ROOT / "rust" if cwd is None else cwd,
                             environment=dict(os.environ), output=output, seconds=seconds,
                             byte_limit=bound, global_deadline=DEADLINE - 20)
    except Exception:
        failed_log = output
        raise
    logs[name] = {key: result[key] for key in ("bytes", "sha256", "elapsed_seconds")}
    return output


def cleanup_target():
    if TARGET.is_symlink() or TARGET.resolve().parent != REPORT.resolve():
        raise RuntimeError("owned target containment differs")
    if TARGET.exists():
        shutil.rmtree(TARGET)
    if TARGET.exists():
        raise RuntimeError("owned target cleanup incomplete")
    return {"removed": True, "path": str(TARGET)}


def enforce_source_conservation(summary):
    inventory = run(["git", "ls-tree", "-rz", "HEAD"], "source-inventory", cwd=ROOT,
                    seconds=30, bound=4 << 20)
    leaves = {}
    for record in inventory.read_bytes().split(b"\0"):
        if not record:
            continue
        header, encoded_path = record.split(b"\t", 1)
        mode, kind, oid = header.decode("ascii").split(" ")
        path = encoded_path.decode("utf-8")
        if (path in leaves or path.startswith("/") or ".." in path.split("/")
                or mode not in ("100644", "100755", "120000", "160000")
                or kind != ("commit" if mode == "160000" else "blob")
                or not re.fullmatch("[0-9a-f]{40}", oid)):
            raise RuntimeError("candidate Git tree entry differs")
        leaves[path] = (mode, oid)
    def tree_oid(values):
        directories = {"": {}}
        for path, entry in values.items():
            parts = path.split("/")
            parent = ""
            for part in parts[:-1]:
                child = parent + "/" + part if parent else part
                directories.setdefault(parent, {})[part] = ("40000", child)
                directories.setdefault(child, {})
                parent = child
            if parts[-1] in directories[parent]:
                raise RuntimeError("duplicate reconstructed tree entry")
            directories[parent][parts[-1]] = entry
        def encode(directory):
            rows = directories[directory]
            payload = bytearray()
            for name in sorted(rows, key=lambda item: item.encode() + (b"/" if rows[item][0] == "40000" else b"")):
                mode, value = rows[name]
                oid = encode(value) if mode == "40000" else value
                payload.extend(mode.encode() + b" " + name.encode() + b"\0" + bytes.fromhex(oid))
            return hashlib.sha1(b"tree " + str(len(payload)).encode() + b"\0" + payload).hexdigest()
        return encode("")
    if tree_oid(leaves) != summary["source_tree"]:
        raise RuntimeError("candidate full Git tree reconstruction differs")
    ci_paths = ["scripts/ci/m9e_pending_experience_diagnostic.py",
                ".github/workflows/m9e-pending-experience-focused.yml"]
    if set(BASE_LEAVES) != set(RUST_SOURCES) | set(FIXTURE_INPUTS):
        raise RuntimeError("exact19 product and5 fixture normalization paths required")
    normalized = dict(leaves)
    for path in [*BASE_LEAVES, *ci_paths]:
        if leaves.get(path, (None,))[0] != "100644":
            raise RuntimeError("exact regular candidate source/fixture path absent")
        original = BASE_LEAVES.get(path)
        if original is None:
            del normalized[path]
        else:
            normalized[path] = tuple(original)
    if tree_oid(normalized) != BASE_TREE:
        raise RuntimeError("candidate changed outside exact19 product,5 fixture and2 CI paths")
    blobs = {}
    for path in SOURCES:
        file = ROOT / path
        if file.is_symlink() or not file.is_file() or file.resolve() != file or file.stat().st_size > 524288:
            raise RuntimeError("bounded contained source differs")
        data = file.read_bytes()
        oid = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if leaves.get(path) != ("100644", oid):
            raise RuntimeError("raw source differs from candidate Git blob: " + path)
        blobs[path] = oid
    summary["source_conservation"] = {"base_tree": BASE_TREE, "normalized_tree": BASE_TREE,
        "product_paths": list(RUST_SOURCES), "fixture_paths": sorted(FIXTURE_INPUTS), "ci_paths": ci_paths,
        "inventory_bytes": inventory.stat().st_size, "inventory_sha256": digest(inventory),
        "source_git_blobs": blobs}


def fixture_inputs(phase):
    result = {}
    for index, (name, (length, expected_blob, expected_sha)) in enumerate(FIXTURE_INPUTS.items(), 1):
        path = ROOT / name
        if path.is_symlink() or not path.is_file() or path.resolve() != path or path.stat().st_size != length:
            raise RuntimeError("exact audited regenerated fixture size/containment differs")
        actual_sha = digest(path)
        if expected_sha is not None and actual_sha != expected_sha:
            raise RuntimeError("audited regenerated export SHA256 differs")
        tree = run(["git", "ls-tree", "-l", "HEAD", "--", name], f"fixture-{phase}-tree-{index}",
                   cwd=ROOT, seconds=30, bound=16384).read_text()
        if tree.split() != ["100644", "blob", expected_blob, str(length), name]:
            raise RuntimeError("actual candidate fixture tree differs from published generated cohort")
        blob = run(["git", "hash-object", "--", name], f"fixture-{phase}-blob-{index}",
                   cwd=ROOT, seconds=30, bound=16384).read_text().strip()
        if blob != expected_blob:
            raise RuntimeError("actual fixture bytes differ from unchanged committed blob")
        result[name] = {"bytes": length, "sha256": actual_sha, "git_blob": blob, "publication_sha": "24beac2761fec35131380ba4b64fc5bd2cf4129d"}
    return result


def execute_target(summary, crate, test_target, test_source, test_ids):
    label = crate + "-" + test_target
    run(["cargo", "clippy", "--locked", "-p", crate, "--test", test_target,
         "--no-deps", "--", "-D", "warnings"], label + "-clippy")
    build = run(["cargo", "test", "--locked", "-p", crate, "--test", test_target,
                 "--no-run", "--message-format=json"], label + "-build")
    rows = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    if [row.get("success") for row in rows if row.get("reason") == "build-finished"] != [True]:
        raise RuntimeError("complete successful Cargo artifact stream required")
    matches = [row for row in rows if row.get("reason") == "compiler-artifact"
               and row.get("target", {}).get("name") == test_target]
    if len(matches) != 1:
        raise RuntimeError("exact participation or compatibility test artifact required")
    artifact = matches[0]
    binary = Path(artifact.get("executable") or "")
    if (artifact.get("manifest_path") != str(ROOT / f"rust/crates/{crate}/Cargo.toml")
            or artifact.get("features") != [] or artifact.get("target", {}).get("kind") != ["test"]
            or artifact["target"].get("src_path") != str(ROOT / test_source)
            or artifact.get("profile", {}).get("test") is not True
            or artifact["profile"].get("debug_assertions") is not True
            or artifact["profile"].get("opt_level") != "0" or artifact["profile"].get("debuginfo") != 0
            or not binary.is_absolute() or binary.is_symlink() or not binary.is_file()
            or binary.resolve() != binary or binary.parent != TARGET / "debug/deps"
            or not re.fullmatch(test_target + "-[0-9a-f]{16}", binary.name)
            or not os.access(binary, os.X_OK) or not 0 < binary.stat().st_size <= 128 << 20):
        raise RuntimeError("actual test source/profile/artifact binding differs")
    binary_hash = digest(binary)
    listing = run([str(binary), "--list", "--format", "terse"], label + "-list", seconds=30, bound=16384)
    if listing.read_text() != "".join(name + ": test\n" for name in test_ids):
        raise RuntimeError("exact complete sorted target test IDs required")
    receipt = {"crate": crate, "target": test_target, "sha256": binary_hash, "bytes": binary.stat().st_size,
               "profile": artifact["profile"], "source_sha256": summary["source_hashes"][test_source],
               "ids": list(test_ids), "listing_bytes": listing.stat().st_size, "listing_sha256": digest(listing)}
    output = run([str(binary), "--format", "terse", "--nocapture", "--test-threads=1"], label + "-execute",
                 cwd=ROOT / f"rust/crates/{crate}", seconds=600, bound=16384).read_text()
    counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
    if counts != [(str(len(test_ids)), "0", "0", "0", "0")]:
        raise RuntimeError("all actual target tests must pass without ignored or filtered cases")
    if digest(binary) != binary_hash:
        raise RuntimeError("executed artifact changed")
    receipt["tests"] = {"executed": len(test_ids), "passed": len(test_ids), "failed": 0, "skipped": 0}
    return receipt

def main(summary):
    global DEADLINE, run_bounded
    epoch = os.environ["M9E_FOCUSED_START_EPOCH"]
    if not re.fullmatch("[0-9]{10}", epoch):
        raise RuntimeError("exact workflow shared start timestamp required")
    elapsed = time.time() - int(epoch)
    if not 0 <= elapsed < 1780:
        raise RuntimeError("checkout/setup exhausted shared1800s budget")
    DEADLINE = time.monotonic() + 1800 - elapsed
    summary["elapsed_before_producer_seconds"] = elapsed
    helper = ROOT / "scripts/ci/m9e_current_cost.py"
    if helper.is_symlink() or helper.resolve() != helper or digest(helper) != HELPER_SHA or "m9e_current_cost" in sys.modules:
        raise RuntimeError("pinned bounded-run helper differs or is preloaded")
    import m9e_current_cost
    if Path(m9e_current_cost.__file__).resolve() != helper:
        raise RuntimeError("bounded-run helper imported from wrong path")
    run_bounded = m9e_current_cost.run_bounded
    sha = os.environ["GITHUB_SHA"]
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise RuntimeError("exact Git candidate identity required")
    if run(["git", "rev-parse", "HEAD"], "identity", cwd=ROOT, seconds=30, bound=16384).read_text().strip() != sha:
        raise RuntimeError("candidate identity differs")
    summary["source_tree"] = run(["git", "rev-parse", "HEAD^{tree}"], "tree", cwd=ROOT, seconds=30, bound=16384).read_text().strip()
    enforce_source_conservation(summary)
    summary["source_hashes"] = {name: digest(ROOT / name) for name in SOURCES}
    summary["compiler_configuration"] = dict(PROFILE)
    summary["fixture_inputs"] = fixture_inputs("before")
    formatter = ["rustfmt", "+1.97.1", "--edition", "2024", "--config", "skip_children=true"]
    try:
        run([*formatter, "--check", *[str(ROOT / name) for name in RUST_SOURCES]], "format", seconds=60, bound=262144)
    except Exception:
        run([*formatter, *[str(ROOT / name) for name in RUST_SOURCES]], "format-patch-producer", seconds=60, bound=262144)
        paths = run(["git", "diff", "--name-only", "-z"], "format-changed-paths", cwd=ROOT,
                    seconds=30, bound=16384).read_text().strip("\0").split("\0")
        if not paths or not set(paths) <= set(RUST_SOURCES):
            raise RuntimeError("formatter changed outside exact19 Rust paths")
        patch = run(["git", "diff", "--binary", "--", *RUST_SOURCES], "format-patch", cwd=ROOT, seconds=30, bound=262144)
        if not 0 < patch.stat().st_size <= 262144:
            raise RuntimeError("bounded nonempty format patch required")
        shutil.copyfile(patch, FULL / "format.patch")
        summary.update(formatted_hashes={name: digest(ROOT / name) for name in RUST_SOURCES},
                       format_patch_bytes=patch.stat().st_size, format_patch_sha256=digest(patch),
                       format_patch_paths=paths)
        raise RuntimeError("pinned formatting changes required; no pending-owner qualification")
    compiler = run(["rustc", "--version"], "compiler", seconds=30, bound=16384).read_text()
    versions = re.findall(r"^rustc 1\.97\.1 \([^\n]+\)$", compiler, re.M)
    if len(versions) != 1:
        raise RuntimeError("pinned compiler identity differs")
    summary["toolchain"] = versions[0]
    summary["test_artifacts"] = {}
    for crate, test_target, test_source, test_ids in TARGETS:
        summary["test_artifacts"][crate + ":" + test_target] = execute_target(
            summary, crate, test_target, test_source, test_ids)
    # These existing literal constructors must still type-check. They are not claimed as executed tests.
    compile_only = ["m9e_content_v2", "m9e_material_retention", "m9e_material_v6", "m9e_runtime_v6"]
    run(["cargo", "test", "--locked", "-p", "er-game",
         *[part for name in compile_only for part in ("--test", name)], "--no-run"], "historical-game-constructors-build")
    run(["cargo", "test", "--locked", "-p", "er-save", "--lib", "--no-run"], "save-inline-constructors-build")
    summary["compile_only_targets"] = [*["er-game:" + name for name in compile_only], "er-save:lib"]
    if any(digest(ROOT / name) != expected for name, expected in summary["source_hashes"].items()):
        raise RuntimeError("actual source changed during execution")
    if fixture_inputs("after") != summary["fixture_inputs"]:
        raise RuntimeError("audited regenerated fixture inputs changed during execution")
    ids = sorted(name for _, _, _, test_ids in TARGETS for name in test_ids)
    summary["tests"] = {"executed": len(ids), "passed": len(ids), "failed": 0, "skipped": 0, "ids": ids}


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"status": "failed", "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": BASE_SHA,
               "qualification": "twenty-six complete current observation, pending-owner, compiled-source bridge and compatibility tests; actual regenerated source bundle; no XP amounts, eligibility, settlement, production CLI/browser ingress or TS asynchronous phase-order qualification"}
    try:
        main(summary)
        summary["status"] = "passed"
    except Exception as error:
        summary["failure"] = str(error)[:2048]
    finally:
        try:
            summary["cleanup"] = cleanup_target()
            if DEADLINE is None or time.monotonic() > DEADLINE:
                raise RuntimeError("final owned cleanup exceeded shared deadline")
            summary["post_cleanup_deadline_checked"] = True
        except Exception as error:
            summary["status"] = "failed"
            summary["cleanup_failure"] = str(error)[:2048]
    if summary["status"] != "passed":
        message = (summary.get("failure", summary.get("cleanup_failure", "focused run failed"))
                   + "\nBounded tail; complete logs remain remote.\n").encode()[:4096]
        tail = b""
        if failed_log is not None and failed_log.is_file():
            with failed_log.open("rb") as stream:
                allowance = 24576 - len(message)
                stream.seek(max(0, failed_log.stat().st_size - allowance))
                tail = stream.read(allowance)
        (FULL / "failure.txt").write_bytes(message + tail)
    summary["logs"] = logs
    encoded = (json.dumps(summary, sort_keys=True, indent=2) + "\n").encode()
    if len(encoded) > 32768:
        raise RuntimeError("focused compact result exceeds32KiB")
    (COMPACT / "summary.json").write_bytes(encoded)
    raise SystemExit(0 if summary["status"] == "passed" else 1)
