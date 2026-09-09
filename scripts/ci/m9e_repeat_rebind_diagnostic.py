"""Remote repeated current rebind F: real native gameplay, no physical-browser claim."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
REPORT = Path(os.environ["RUNNER_TEMP"]) / "m9e-repeat-rebind-focused"
FULL = REPORT / "diagnostics"
COMPACT = REPORT / "compact"
TARGET = REPORT / "target"
STARTED_AT = None
DEADLINE = None
run_bounded = None
BASE_SHA = "d9a6391a94cae965eaa2c5af5f910002631d5254"
BASE_TREE = "5d6e96b5a1968c73ceb3d6f1accc93d61e98ba6d"
TARGETS = [[
  "er-kernel",
  "m9e_current_coop_rebind_v7",
  "rust/crates/er-kernel/tests/m9e_current_coop_rebind_v7.rs",
  [
    "equal_frontier_native_rebind_commits_two_atomically_without_gameplay",
    "every_rebind_phase_restores_and_retries_exact_control_without_advancing_replay",
    "malformed_rebind_controls_and_generation_bypasses_preserve_full_snapshot",
    "open_rebind_executes_actual_owned_gameplay_and_retries_strict_v2_receipt",
    "open_rebind_receipt_and_owner_mutations_reject_with_complete_state_conservation",
    "open_rebind_replaces_original_v1_reply_atomically_at_capacity_one",
    "rebind_begin_and_replay_exhaustion_reject_without_retiring_existing_owners",
    "rebind_restore_checks_decision_binding_and_preserves_unrelated_scheduler_pause",
    "repeated_rebind_natural_three_generations_preserve_old_receipt_and_execute_new_gameplay",
    "repeated_rebind_retains_one_receipt_witness_across_idle_epochs_and_rejects_forged_history"
  ]
]]
KERNEL_TEST_TARGETS = [
  "m1_keyboard_menu",
  "m2_protocol_menu",
  "m3_authority_commands",
  "m3_battle_presentation",
  "m3_battle_ui",
  "m3_material_apply",
  "m3_tail_proof_routing",
  "m3_terminal_protocol",
  "m4_snapshot_v3",
  "m9e_ai_command_transaction_v7",
  "m9e_checkpoint_healing_v7",
  "m9e_coop_choices_v7",
  "m9e_coop_lost_receipt_v7",
  "m9e_coop_v7",
  "m9e_current_coop_rebind_v7",
  "m9e_current_proposal_v7",
  "m9e_domain_journeys_v7",
  "m9e_game_kernel_v7",
  "m9e_material_retention_v7",
  "m9e_natural_campaign_v7",
  "m9e_natural_coop_campaign_v7",
  "m9e_natural_progression_v7",
  "m9e_natural_replacement_v7",
  "m9e_snapshot_v7",
  "m9e_struggle_v7",
  "m9e_timers_v7",
  "m9e_title_storage"
]
BASE_SOURCES = {
  "rust/Cargo.lock": [
    "9e7f2e2a96e9b191015b567c4bb1bd7f3457b0dbebc563394e354f5f132c65dc",
    32083
  ],
  "rust/Cargo.toml": [
    "fdefad8953caa82922a4f3e86560d3543f9d1ef69edada7bc1dcc16ae3a5ade9",
    1615
  ],
  "rust/crates/er-game/Cargo.toml": [
    "b70213bb098d0723abe81d944583620938f607237800354f66f401b058e99fb4",
    691
  ],
  "rust/crates/er-game/src/m72_bootstrap.rs": [
    "54369e34edc90a194f425e677a21e3ba7ce64dff46a4af9b688e4821a511dccc",
    30759
  ],
  "rust/crates/er-game/src/m9e_content_v2.rs": [
    "e287b251a98cab8e170ac92fc4b253bc0908a2f6155929f35978680dff3fda5b",
    24460
  ],
  "rust/crates/er-game/src/m9e_material_v6.rs": [
    "7ebefdf8fd78878154564554a1d566b02246578a6d22198e9540a7a0f6add835",
    24238
  ],
  "rust/crates/er-game/src/m9e_new_run_v6.rs": [
    "0492d70d097430519514f2b195ca31483e4dc019ab474d48b1fe7a016ce49dea",
    39662
  ],
  "rust/crates/er-game/src/m9e_runtime_v6.rs": [
    "b910e8a9a708942ea4df944106204817f9664dae83c320fa7eb962a00a1e6327",
    114036
  ],
  "rust/crates/er-kernel/Cargo.toml": [
    "2b244502f54359df2852f5f05051a149154629a131f7b862c33a72c12f5aaabd",
    706
  ],
  "rust/crates/er-kernel/src/current_coop_rebind_v7.rs": [
    "73f8f76e5ce3181682f519170599023ee41584dc95f1e00db47e3ca45393b086",
    36143
  ],
  "rust/crates/er-kernel/src/current_coop_setup_v7.rs": [
    "c4e8dbeef2a41d4e316d5aac6082feff132348a4e8cd8cbb0620bab1682b37b7",
    29287
  ],
  "rust/crates/er-kernel/src/current_proposal_v7.rs": [
    "98cd877c1d54e3e2a7d9f388423b14e63a2ce89fcb42514f59e6ac48fa2ffa1e",
    24802
  ],
  "rust/crates/er-kernel/src/game_kernel_v7.rs": [
    "0a8cd79f25bae24a589bd6c38682708fa8816787241c83e534f746b707ce5ae0",
    161847
  ],
  "rust/crates/er-kernel/src/lib.rs": [
    "4c04cb699d70a2de1aff23a86a3dfbc41a13db5142984623d8bad48441812e76",
    1085
  ],
  "rust/crates/er-kernel/src/snapshot_v7.rs": [
    "e247dbf85f7d473f9d02d54b08f0b86d5630aa37bfd39e5645ef7b3366449e7a",
    22224
  ],
  "rust/crates/er-kernel/tests/m1_keyboard_menu.rs": [
    "7b15c0a80e2304aa762cc0f4c27ee392c81c6defa3fe07914b37cdedac872b69",
    32009
  ],
  "rust/crates/er-kernel/tests/m2_protocol_menu.rs": [
    "63cc13fe66902a85c6e9756dfad99185d612edaa6da4ba47c06105319f1b1d95",
    76805
  ],
  "rust/crates/er-kernel/tests/m3_authority_commands.rs": [
    "aa732121b9837ccd40711d20ca53c9f2bf428d9a2eefb81a890a237176d9aacd",
    80236
  ],
  "rust/crates/er-kernel/tests/m3_battle_presentation.rs": [
    "fb65522eaaa660bbaec2f2fdfd3cc7650b8bb0e50a5ee6a4da082a82d761a193",
    17610
  ],
  "rust/crates/er-kernel/tests/m3_battle_ui.rs": [
    "a8ef189f40f240b41eff755706005818129e38b1d35babe90c3084b3662283d4",
    16266
  ],
  "rust/crates/er-kernel/tests/m3_material_apply.rs": [
    "bfc616e0b5c84dbfb8fb505c7835c046a1fb77d22e051fc7b0d0c9bc2b712d15",
    40057
  ],
  "rust/crates/er-kernel/tests/m3_tail_proof_routing.rs": [
    "fa9cd6800f3a8023809587215bb5a191e9d4d9396b9e58f0afedfa32ce44d187",
    28505
  ],
  "rust/crates/er-kernel/tests/m3_terminal_protocol.rs": [
    "355293d686c8c0a010adeecb583d6f451e9b697aedbc11a922bb2428b507123e",
    8156
  ],
  "rust/crates/er-kernel/tests/m4_snapshot_v3.rs": [
    "a606a52d6fa38a0c76d191c5e5b6c2abe65fce8c2578a95fa3dee24d78cc713c",
    4296
  ],
  "rust/crates/er-kernel/tests/m9e_ai_command_transaction_v7.rs": [
    "5a9f9d63f6d9da822acfd7e18e1eb3d379f1b681bf52f73a080aacde83a4b5bf",
    10393
  ],
  "rust/crates/er-kernel/tests/m9e_checkpoint_healing_v7.rs": [
    "ab8cbf4659108014f64938cee608b809c2c386ce9353e31205ae3abaaa69900d",
    12065
  ],
  "rust/crates/er-kernel/tests/m9e_coop_choices_v7.rs": [
    "34618941e4434159c8f05061550ee322b4aa434604f3b31c0d2c9e7697426243",
    53838
  ],
  "rust/crates/er-kernel/tests/m9e_coop_lost_receipt_v7.rs": [
    "e6dfd7a462127f25a3917a1ff71693f2788f9c0aacce0a30b9647e4fe08b85c4",
    38819
  ],
  "rust/crates/er-kernel/tests/m9e_coop_v7.rs": [
    "6f41a6eb991dca0a6291cf89f61cbd648f1875c559b6f77e55a8eb190e252d74",
    43882
  ],
  "rust/crates/er-kernel/tests/m9e_current_coop_rebind_v7.rs": [
    "fc20a2a6985d47144e0a4012b7488895887874df8d452d5ea0e71f3d1a7c750c",
    47847
  ],
  "rust/crates/er-kernel/tests/m9e_current_proposal_v7.rs": [
    "0e8c3d8aa0e6083ccedb9529f797cedcda3dd8a163ca8f46310d484b1a497646",
    50543
  ],
  "rust/crates/er-kernel/tests/m9e_domain_journeys_v7.rs": [
    "d75d0c0eb020374b15b699fcaecc2c5296c572d7d5f1f5ed6b814bcdcf27f1a9",
    37523
  ],
  "rust/crates/er-kernel/tests/m9e_game_kernel_v7.rs": [
    "d94674d5c5fc749b0bb3806872e1f3510cd60ca16070ae939e3d2111216223f6",
    63376
  ],
  "rust/crates/er-kernel/tests/m9e_material_retention_v7.rs": [
    "96d5746d55c11dbda1e14e6ce94d2e918aadf15d3d2773c14c43e1b78585bd74",
    14024
  ],
  "rust/crates/er-kernel/tests/m9e_natural_campaign_v7.rs": [
    "b3b9e5e0da0555ec32fbff4b980d7578c97a943f278b38affac63d0525e90574",
    15618
  ],
  "rust/crates/er-kernel/tests/m9e_natural_coop_campaign_v7.rs": [
    "0947cbff52edeb3568817ff18c0bc3282458740326782b2f54874d22c4639b1d",
    29980
  ],
  "rust/crates/er-kernel/tests/m9e_natural_progression_v7.rs": [
    "a0b106af6876c3c22d88a2544df9bd68aa7352b0c172562894e9151a06c38ad8",
    12099
  ],
  "rust/crates/er-kernel/tests/m9e_natural_replacement_v7.rs": [
    "180e442c42a35bbd241069489521dd3e20ce292f4be91fbcdd6a7ac81f335c13",
    12944
  ],
  "rust/crates/er-kernel/tests/m9e_snapshot_v7.rs": [
    "1ad4f345710c3ee4bd8333ce5b5d089a4838a5338efce32d37cf6ef8c249b70f",
    8741
  ],
  "rust/crates/er-kernel/tests/m9e_struggle_v7.rs": [
    "65bcd144b8a98ad339a3d79a58386d455238717302df1ceeb989e13f4ef1078c",
    10067
  ],
  "rust/crates/er-kernel/tests/m9e_timers_v7.rs": [
    "7f786caf7ee5cb5984a8a8e8717fad02ce12d422884cba39d6287852478b0a02",
    26431
  ],
  "rust/crates/er-kernel/tests/m9e_title_storage.rs": [
    "00c5ab22dc12f88a27cfee37206d1c82a09d197c2938615e09493d509283743c",
    33229
  ],
  "rust/crates/er-protocol/Cargo.toml": [
    "c6c67ea6f4dff5dc520b9b039fe7606004fab00d1f9726195abf41e20d9f8e2e",
    327
  ],
  "rust/crates/er-protocol/src/authority_log.rs": [
    "92ea98e773b970cfc555ec99a48fec7c7c60c5c89df2aca57856de013398fbd1",
    77197
  ],
  "rust/crates/er-protocol/src/proposal.rs": [
    "b3d0c01bb30c4d6c5a232579d68b135eed6e6a12a101b0ec264f765d70fe1f4b",
    75784
  ],
  "rust/crates/er-protocol/src/recovery.rs": [
    "962061f0abdbd7adcfa2a91a9cd2826f0328fcfd612db733a91e91a705154cea",
    100044
  ],
  "rust/crates/er-protocol/src/scheduler.rs": [
    "20bf9f4f4ea38fbac7fd92043e34e647a4cd2b2fdb46a66102b93091b0a35559",
    23095
  ],
  "rust/crates/er-protocol/src/snapshot.rs": [
    "83705fbec76a1f705e0b0ec51a1217223e7638bdf5280e51a9a70e09d4f2455b",
    58540
  ],
  "rust/crates/er-state/src/m9e_state_v6.rs": [
    "6e0937529780f4cb50c65122173a68820c4823bdfb9569ff8b46583cf9d8e9fb",
    16401
  ],
  "rust/rust-toolchain.toml": [
    "0241de2190a0c1959d4ad182dfa6943b7ab9bd577dc8ef9b0fe7502d191835ec",
    123
  ],
  "scripts/ci/m9e_current_cost.py": [
    "5a25e98778cc7103375a5342600c4bc6e5a22252935f435f847e6434f00e7cd8",
    38620
  ],
  "scripts/ci/m9e_generated_xp.py": [
    "e5a85427e00586715e373090fbe7532d85138eff38b166db4283fe87b8f5ea63",
    10394
  ]
}
RUST_SOURCES = [
  "rust/crates/er-kernel/src/current_coop_rebind_v7.rs",
  "rust/crates/er-kernel/src/current_coop_setup_v7.rs",
  "rust/crates/er-kernel/src/current_proposal_v7.rs",
  "rust/crates/er-kernel/src/game_kernel_v7.rs",
  "rust/crates/er-kernel/tests/m9e_current_coop_rebind_v7.rs"
]
CI_SOURCES = ["scripts/ci/m9e_repeat_rebind_diagnostic.py", ".github/workflows/m9e-repeat-rebind-focused.yml"]
CHANGED_SOURCES = sorted(RUST_SOURCES + CI_SOURCES)
FIXTURE_INPUTS = {
  "rust/fixtures/m9/engineering/game-content-bundle-v2.json": [
    16340147,
    "6bd2537b440de33974642c4565e0d275ef3b3624",
    "f11ed4151b9157f1f7f296c6b2801ffaed02a3c43b6a31816e5145a478175913"
  ]
}
SOURCES = sorted(set(BASE_SOURCES) | set(CHANGED_SOURCES))
PROFILE = {"RUSTUP_TOOLCHAIN": "1.97.1", "CARGO_INCREMENTAL": "0",
           "CARGO_PROFILE_TEST_OPT_LEVEL": "0", "CARGO_PROFILE_TEST_DEBUG_ASSERTIONS": "true",
           "CARGO_PROFILE_TEST_OVERFLOW_CHECKS": "true", "CARGO_PROFILE_TEST_DEBUG": "0",
           "CARGO_PROFILE_DEV_DEBUG": "0",
           "CARGO_ENCODED_RUSTFLAGS": "-Copt-level=0\x1f-Cdebug-assertions=yes\x1f-Coverflow-checks=yes"}
sequence = 0
logs = {}
failed_log = None


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(args, name, *, cwd=None, seconds=600, bound=16 << 20, expected_exit=None):
    global sequence, failed_log
    if not 0 < seconds <= 600 or DEADLINE is None or run_bounded is None:
        raise RuntimeError("command exceeds fixed 600-second ceiling")
    sequence += 1
    output = FULL / f"{sequence:03d}-{name}.log"
    started = time.monotonic()
    try:
        result = run_bounded(args, cwd=ROOT / "rust" if cwd is None else cwd,
                             environment=dict(os.environ), output=output, seconds=seconds,
                             byte_limit=bound, global_deadline=DEADLINE - 20)
    except Exception as error:
        if (expected_exit is None or str(error) != "current cost evidence: command exited " + str(expected_exit)
                or time.monotonic() > min(started + seconds, DEADLINE - 20)
                or not output.is_file() or not 0 < output.stat().st_size <= bound):
            failed_log = output
            raise
        result = {"bytes": output.stat().st_size, "sha256": digest(output), "elapsed_seconds": time.monotonic() - started}
    else:
        if expected_exit is not None:
            raise RuntimeError("causal negative unexpectedly succeeded")
    logs[name] = {key: result[key] for key in ("bytes", "sha256", "elapsed_seconds")}
    logs[name].update(argv=list(args), cwd=str(ROOT / "rust" if cwd is None else cwd), seconds_cap=seconds, byte_cap=bound)
    return output


def cleanup_target():
    if TARGET.is_symlink() or TARGET.resolve().parent != REPORT.resolve():
        raise RuntimeError("owned target containment differs")
    if TARGET.exists():
        shutil.rmtree(TARGET)
    if TARGET.exists():
        raise RuntimeError("owned target cleanup incomplete")


def source_conservation(summary, phase):
    if not 0 <= time.time() - STARTED_AT <= 1800:
        raise RuntimeError("pre-checkout shared deadline absent or exhausted")
    tree = run(["git", "rev-parse", BASE_SHA + "^{tree}"], "base-tree-" + phase,
               cwd=ROOT, seconds=30, bound=16384).read_text().strip()
    if tree != BASE_TREE:
        raise RuntimeError("exact unchanged base tree required")
    changes = run(["git", "diff", "--name-status", "--no-renames", BASE_SHA, "HEAD", "--"],
                  "base-delta-" + phase, cwd=ROOT, seconds=30, bound=16384).read_text().splitlines()
    expected = sorted(("M" if name in BASE_SOURCES else "A") + "\t" + name for name in CHANGED_SOURCES)
    if sorted(changes) != expected:
        raise RuntimeError("only exact five product and two additive CI paths may differ from d9a6391a")
    status = run(["git", "status", "--porcelain", "--untracked-files=no"], "clean-" + phase,
                 cwd=ROOT, seconds=30, bound=16384).read_text()
    if status:
        raise RuntimeError("tracked candidate bytes differ from committed source")
    for name in SOURCES:
        path = ROOT / name
        if (path.is_symlink() or not path.is_file() or path.resolve() != path
                or not 0 < path.stat().st_size <= 4 << 20):
            raise RuntimeError("named small source containment/size differs")
        if name in BASE_SOURCES and name not in RUST_SOURCES:
            expected_hash, expected_bytes = BASE_SOURCES[name]
            if path.stat().st_size != expected_bytes or digest(path) != expected_hash:
                raise RuntimeError("unchanged source differs from guarded cached d9a6391a bytes: " + name)
    actual_tests = run(["git", "ls-tree", "-r", "--name-only", "HEAD", "--", "rust/crates/er-kernel/tests"],
                       "kernel-inventory-" + phase, cwd=ROOT, seconds=30, bound=16384).read_text().splitlines()
    if actual_tests != ["rust/crates/er-kernel/tests/" + name + ".rs" for name in KERNEL_TEST_TARGETS]:
        raise RuntimeError("complete kernel source target inventory differs")
    test_bytes = (ROOT / "rust/crates/er-kernel/tests/m9e_current_coop_rebind_v7.rs").read_bytes()
    if (len(test_bytes) <= 47847 or hashlib.sha256(test_bytes[:47847]).hexdigest()
            != "fc20a2a6985d47144e0a4012b7488895887874df8d452d5ea0e71f3d1a7c750c"):
        raise RuntimeError("complete original eight-test raw prefix changed")
    summary["original_test_prefix"] = {"bytes": 47847, "sha256": "fc20a2a6985d47144e0a4012b7488895887874df8d452d5ea0e71f3d1a7c750c", "tests": 8}
    summary["base_conservation"] = {"tree": BASE_TREE, "changed_paths": CHANGED_SOURCES,
                                    "unchanged_small_sources": len(BASE_SOURCES) - 5,
                                    "phase": phase}


def compile_kernel_constructors(summary):
    # All 27 integration harnesses plus the library harness must really compile.
    # Only the separately discovered/executed ten-test rebind target qualifies behavior.
    build = run(["cargo", "test", "--locked", "-p", "er-kernel", "--tests", "--no-run",
                 "--message-format=json"], "all-kernel-constructors-build")
    rows = [json.loads(line) for line in build.read_text().splitlines() if line.startswith("{")]
    if [row.get("success") for row in rows if row.get("reason") == "build-finished"] != [True]:
        raise RuntimeError("complete constructor Cargo artifact stream required")
    artifacts = [row for row in rows if row.get("reason") == "compiler-artifact"
                 and row.get("manifest_path") == str(ROOT / "rust/crates/er-kernel/Cargo.toml")
                 and row.get("executable") is not None]
    names = [row.get("target", {}).get("name") for row in artifacts]
    if sorted(names) != sorted([*KERNEL_TEST_TARGETS, "er_kernel"]):
        raise RuntimeError("all 27 kernel integration artifacts and library harness required exactly once")
    executed = {row[1] for row in TARGETS}
    receipts = {}
    for artifact in artifacts:
        name = artifact["target"]["name"]
        source = ("rust/crates/er-kernel/src/lib.rs" if name == "er_kernel"
                  else "rust/crates/er-kernel/tests/" + name + ".rs")
        binary = Path(artifact["executable"])
        if (artifact.get("features") != []
                or artifact["target"].get("kind") != (["lib"] if name == "er_kernel" else ["test"])
                or artifact["target"].get("src_path") != str(ROOT / source)
                or artifact.get("profile", {}).get("test") is not True
                or artifact["profile"].get("debug_assertions") is not True
                or artifact["profile"].get("opt_level") != "0" or artifact["profile"].get("debuginfo") != 0
                or not binary.is_absolute() or binary.is_symlink() or not binary.is_file()
                or binary.resolve() != binary or binary.parent != TARGET / "debug/deps"
                or not re.fullmatch(name + "-[0-9a-f]{16}", binary.name)
                or not os.access(binary, os.X_OK) or not 0 < binary.stat().st_size <= 128 << 20):
            raise RuntimeError("actual compile-only source/profile/artifact binding differs")
        if name in executed:
            prior = summary["test_artifacts"]["er-kernel:" + name]
            if digest(binary) != prior["sha256"] or binary.stat().st_size != prior["bytes"]:
                raise RuntimeError("constructor compile changed an already executed artifact")
        else:
            receipts["er-kernel:" + ("lib" if name == "er_kernel" else name)] = {
                "binary": binary.name, "bytes": binary.stat().st_size, "sha256": digest(binary),
                "profile": artifact["profile"], "source": source,
                "source_sha256": summary["source_hashes"][source], "executed": False}
    if len(receipts) != 27:
        raise RuntimeError("exact 27 compile-only kernel harnesses required")
    return receipts


def fixture_inputs(phase):
    result = {}
    for index, (name, (length, expected_blob, expected_sha)) in enumerate(FIXTURE_INPUTS.items(), 1):
        path = ROOT / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size != length:
            raise RuntimeError("exact unchanged historical fixture size/containment differs")
        actual_sha = digest(path)
        if expected_sha is not None and actual_sha != expected_sha:
            raise RuntimeError("known historical export SHA256 differs")
        tree = run(["git", "ls-tree", "-l", "HEAD", "--", name], f"fixture-{phase}-tree-{index}",
                   cwd=ROOT, seconds=30, bound=16384).read_text()
        if tree.split() != ["100644", "blob", expected_blob, str(length), name]:
            raise RuntimeError("actual candidate fixture tree differs from unchanged base")
        blob = run(["git", "hash-object", "--", name], f"fixture-{phase}-blob-{index}",
                   cwd=ROOT, seconds=30, bound=16384).read_text().strip()
        if blob != expected_blob:
            raise RuntimeError("actual fixture bytes differ from unchanged committed blob")
        result[name] = {"bytes": length, "sha256": actual_sha, "git_blob": blob, "base_sha": BASE_SHA}
    return result


def execute_target(summary, crate, test_target, test_source, test_ids, *, expected_failures=None, restored=False):
    label = crate + "-" + test_target + ("-negative" if expected_failures else "-restored" if restored else "-positive")
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
        raise RuntimeError("exact native rebind or compatibility test artifact required")
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
               "profile": artifact["profile"], "source": test_source, "binary": binary.name, "source_sha256": summary["source_hashes"][test_source],
               "ids": list(test_ids), "listing_bytes": listing.stat().st_size, "listing_sha256": digest(listing)}
    output = run([str(binary), "--format", "terse", "--nocapture", "--test-threads=1"], label + "-execute",
                 cwd=ROOT / f"rust/crates/{crate}", seconds=600, bound=16384, expected_exit=101 if expected_failures else None).read_text()
    counts = re.findall(r"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
    failed = len(expected_failures or [])
    if counts != [(str(len(test_ids) - failed), str(failed), "0", "0", "0")]:
        raise RuntimeError("actual complete target positive/negative counts differ")
    if expected_failures:
        markers = re.findall(r"^\s*([a-z0-9_]+) --- FAILED$", output, re.M)
        if sorted(markers) != sorted(expected_failures):
            raise RuntimeError("exact repeated-entry negative failures differ")
    if digest(binary) != binary_hash:
        raise RuntimeError("executed artifact changed")
    receipt["tests"] = {"executed": len(test_ids), "passed": len(test_ids) - failed, "failed": failed, "skipped": 0}
    return receipt


def causal_negative(summary):
    path = ROOT / "rust/crates/er-kernel/src/current_coop_rebind_v7.rs"
    original = path.read_bytes()
    old = b'''        if self.has_current_coop_rebind() {
            let owner = self.rebind_owner()?;
            if owner.phase != CurrentCoopRebindPhaseV1::Open || owner.candidate_connected {
                return self.retry_current_coop_rebind_v1();
            }
        }'''
    replacement = b'''        if self.has_current_coop_rebind() {
            return self.retry_current_coop_rebind_v1();
        }'''
    if original.count(old) != 1:
        raise RuntimeError("reviewed Begin rollover mutation anchor differs")
    changed = original.replace(old, replacement)
    crate, target, source, ids = TARGETS[0]
    expected_failures = [name for name in ids if name.startswith("repeated_rebind_")]
    if len(expected_failures) != 2:
        raise RuntimeError("exact repeated-entry negative IDs required")
    positive = summary["test_artifacts"][crate + ":" + target]
    try:
        path.write_bytes(changed)
        result = execute_target(summary, crate, target, source, ids, expected_failures=expected_failures)
        if result["sha256"] == positive["sha256"] or digest(path) != hashlib.sha256(changed).hexdigest():
            raise RuntimeError("negative actual binary/source unchanged or mutated further")
        summary["causal_negative"] = {"mutation": "restore-existing-owner-Begin-retry", "source": str(path.relative_to(ROOT)),
                                      "before_sha256": hashlib.sha256(original).hexdigest(), "after_sha256": digest(path),
                                      "test_source_sha256": digest(ROOT / source), "artifact": result,
                                      "old_tests_passed": 8, "new_tests_failed": expected_failures}
    finally:
        path.write_bytes(original)
    restored = execute_target(summary, crate, target, source, ids, restored=True)
    if restored["sha256"] != positive["sha256"] or digest(path) != summary["source_hashes"][str(path.relative_to(ROOT))]:
        raise RuntimeError("exact positive source and actual binary were not restored")
    summary["restored_positive"] = restored


def main(summary):
    global STARTED_AT, DEADLINE, run_bounded
    epoch = os.environ.get("M9E_FOCUS_STARTED_AT", "")
    if not re.fullmatch(r"[0-9]{10}", epoch):
        raise RuntimeError("exact pre-checkout workflow timestamp required")
    elapsed = time.time() - int(epoch)
    if not 0 <= elapsed < 1780:
        raise RuntimeError("invalid elapsed time or checkout/setup exhausted shared budget and cleanup reserve")
    STARTED_AT = int(epoch)
    DEADLINE = time.monotonic() + 1800 - elapsed
    summary["elapsed_before_producer_seconds"] = elapsed
    helper = ROOT / "scripts/ci/m9e_current_cost.py"
    helper_hash, helper_bytes = BASE_SOURCES["scripts/ci/m9e_current_cost.py"]
    if (helper.is_symlink() or not helper.is_file() or helper.resolve() != helper
            or helper.stat().st_size != helper_bytes or digest(helper) != helper_hash
            or "m9e_current_cost" in sys.modules):
        raise RuntimeError("pinned bounded-run helper differs or is preloaded")
    import m9e_current_cost
    if Path(m9e_current_cost.__file__).resolve() != helper:
        raise RuntimeError("bounded-run helper imported from wrong path")
    run_bounded = m9e_current_cost.run_bounded
    os.environ.update(PROFILE)
    os.environ["CARGO_TARGET_DIR"] = str(TARGET)
    if os.environ.get("GITHUB_REF_NAME") != "codex/m9e-repeat-rebind-focused-20260909":
        raise RuntimeError("focused branch identity differs")
    sha = os.environ["GITHUB_SHA"]
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise RuntimeError("exact Git candidate identity required")
    if run(["git", "rev-parse", "HEAD"], "identity", cwd=ROOT, seconds=30, bound=16384).read_text().strip() != sha:
        raise RuntimeError("candidate identity differs")
    summary["source_tree"] = run(["git", "rev-parse", "HEAD^{tree}"], "tree", cwd=ROOT, seconds=30, bound=16384).read_text().strip()
    source_conservation(summary, "before")
    summary["source_hashes"] = {name: digest(ROOT / name) for name in SOURCES}
    summary["source_bytes"] = {name: (ROOT / name).stat().st_size for name in SOURCES}
    summary["limits"] = {"command_seconds": 600, "shared_seconds_including_checkout": 1800,
                         "cleanup_reserve_seconds": 20,
                         "compact_bytes": 65536, "formatter_patch_bytes": 262144,
                         "command_log_bytes": 16 << 20, "test_output_bytes": 16384,
                         "test_binary_bytes": 128 << 20}
    summary["started_at"] = STARTED_AT
    summary["compiler_configuration"] = dict(PROFILE)
    summary["fixture_inputs"] = fixture_inputs("before")
    formatter = ["rustfmt", "+1.97.1", "--edition", "2024", "--config", "skip_children=true"]
    try:
        run([*formatter, "--check", *[str(ROOT / name) for name in RUST_SOURCES]], "format", seconds=60, bound=262144)
    except Exception:
        run([*formatter, *[str(ROOT / name) for name in RUST_SOURCES]], "format-patch-producer", seconds=60, bound=262144)
        patch = run(["git", "diff", "--binary", "--", *RUST_SOURCES], "format-patch", cwd=ROOT, seconds=30, bound=262144)
        shutil.copyfile(patch, FULL / "format.patch")
        summary.update(formatted_hashes={name: digest(ROOT / name) for name in RUST_SOURCES},
                       format_patch_bytes=patch.stat().st_size, format_patch_sha256=digest(patch))
        raise RuntimeError("pinned formatting changes required; no native rebind qualification")
    compiler = run(["rustc", "--version"], "compiler", seconds=30, bound=16384).read_text()
    versions = re.findall(r"^rustc 1\.97\.1 \([^\n]+\)$", compiler, re.M)
    if len(versions) != 1:
        raise RuntimeError("pinned compiler identity differs")
    summary["toolchain"] = versions[0]
    summary["test_artifacts"] = {}
    for crate, test_target, test_source, test_ids in TARGETS:
        summary["test_artifacts"][crate + ":" + test_target] = execute_target(
            summary, crate, test_target, test_source, test_ids)
    summary["compile_only_artifacts"] = compile_kernel_constructors(summary)
    # Compile/lint default-feature reverse consumers and exhaustive enum matches.
    # This is source compatibility, not execution of their behavioral suites.
    run(["cargo", "check", "--locked", "--workspace", "--all-targets"], "workspace-reverse-check")
    run(["cargo", "clippy", "--locked", "--workspace", "--all-targets", "--no-deps", "--", "-D", "warnings"], "workspace-reverse-clippy")
    summary["reverse_consumers"] = {"scope": "workspace-default-features-all-targets", "compiled": True, "linted": True, "behavior_executed": False}
    causal_negative(summary)
    if any(digest(ROOT / name) != expected for name, expected in summary["source_hashes"].items()):
        raise RuntimeError("actual source changed during execution")
    if fixture_inputs("after") != summary["fixture_inputs"]:
        raise RuntimeError("unchanged historical fixture inputs changed during execution")
    source_conservation(summary, "after")
    ids = sorted(name for _, _, _, test_ids in TARGETS for name in test_ids)
    summary["tests"] = {"executed": len(ids), "passed": len(ids), "failed": 0, "skipped": 0, "ids": ids}


if __name__ == "__main__":
    FULL.mkdir(parents=True, exist_ok=False)
    COMPACT.mkdir(parents=True, exist_ok=False)
    summary = {"schema_version": 1, "branch": os.environ["GITHUB_REF_NAME"], "status": "failed", "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"], "base_sha": BASE_SHA,
               "qualification": "10 complete native tests: all eight existing owned rebind tests plus two actual repeated-generation witnesses; 27 other kernel harnesses compile-only and default workspace reverse targets compile/lint; no physical browser or unequal-frontier claim"}
    try:
        main(summary)
        summary["status"] = "passed"
    except Exception as error:
        summary["failure"] = str(error)[:2048]
    finally:
        try:
            cleanup_target()
            summary["cleanup"] = {"owned_target_removed": not TARGET.exists(), "contained": True}
            if DEADLINE is None or time.monotonic() > DEADLINE:
                raise RuntimeError("final owned cleanup exceeded pre-checkout shared deadline")
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
    summary["elapsed_seconds_including_checkout"] = None if STARTED_AT is None else time.time() - STARTED_AT
    encoded = (json.dumps(summary, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if len(encoded) > 65536:
        raise RuntimeError("focused compact result exceeds64KiB")
    (COMPACT / "summary.json").write_bytes(encoded)
    raise SystemExit(0 if summary["status"] == "passed" else 1)
