"""Remote actual-source planner preflight; no native/browser qualification."""
import json
import os
from pathlib import Path
os.environ["M9E_REPORT_DIR"] = str(Path(os.environ["RUNNER_TEMP"]) / "m9e-preflight/planner")
import m9e_feedback as feedback
import m9e_coop_startup as coop
import m9e_generated_xp as generated
from m9e_coop_preflight import BASELINE_TARGETS

# Deliberate composition ancestor; latest audited checkpoint is b27ce85f/34089719925.
QUALIFIED_BASELINE = "79ba483d35f0559b2d2413f6f46ef48f62ba6061"


def main():
    feedback.FULL.mkdir(parents=True, exist_ok=True)
    plan = feedback.plan()
    if (plan["base_sha"] != QUALIFIED_BASELINE
            or plan.get("current_ai_command_transaction_focus") is not True
            or plan.get("requires_ai_command_transaction") is not True
            or plan.get("current_coop_startup_focus") is not True
            or plan.get("current_recovery_integration") is not True
            or plan.get("requires_natural_replacement") is not True
            or plan.get("requires_natural_progression") is not True
            or plan.get("requires_checkpoint_healing") is not True
            or plan.get("requires_natural_campaign_witnesses") is not True
            or plan.get("requires_struggle") is not True
            or plan.get("requires_canonical_value_digest") is not True
            or plan["unknown_paths"] or plan["boundary_paths"]):
        raise RuntimeError("combined recovery source plan is not its exact qualified scope")
    previous = [*BASELINE_TARGETS, list(coop.KERNEL_TARGET), list(coop.ENTRY_TARGET), ["er-game", "m9e_new_run_v6"]]
    if len(previous) != 79 or len({tuple(target) for target in previous}) != 79:
        raise RuntimeError("qualified baseline target inventory differs")
    for crate, target in previous:
        scope = plan["execution_scope"].get(crate, [])
        if crate not in plan["packages"] or not ("*" in scope or target in scope):
            raise RuntimeError(f"previously qualified target omitted: {crate}:{target}")
    owned_inventory = feedback.owned_foundation_inventory()
    feedback.validate_owned_foundation_inventory(plan, owned_inventory)
    for row in owned_inventory:
        scope = plan["execution_scope"].get(row["crate"], [])
        if row["crate"] not in plan["packages"] or not ("*" in scope or row["target"] in scope):
            raise RuntimeError("complete786 inventory has an unselected target: " + row["crate"] + ":" + row["target"])
    feedback.validate_owned_foundation_sources(feedback.ROOT)
    if feedback.digest(feedback.ROOT / "rust/crates/er-wasm/tests/m9e_parity.rs") != "95c09508d4ac63e3a401d2abd1a14725de8d85b1d5405f4de9d0e1999032ee6c":
        raise RuntimeError("reviewed generated-cohort parity source differs")
    key = "er-kernel:" + feedback.AI_COMMAND_TARGET
    if (plan["required_native_targets"].get("er-kernel", []).count(feedback.AI_COMMAND_TARGET) != 1
            or plan["required_native_test_ids"].get(key) != feedback.AI_COMMAND_IDS):
        raise RuntimeError("all three exact AI transaction identities must remain mandatory")
    replacement = "er-kernel:" + feedback.REPLACEMENT_TARGET
    if (plan["required_native_targets"].get("er-kernel", []).count(feedback.REPLACEMENT_TARGET) != 1
            or plan["required_native_test_ids"].get(replacement) != feedback.REPLACEMENT_IDS):
        raise RuntimeError("both exact natural replacement identities must remain mandatory")
    progression = "er-kernel:" + feedback.PROGRESSION_TARGET
    if (plan["required_native_targets"].get("er-kernel", []).count(feedback.PROGRESSION_TARGET) != 1
            or plan["required_native_test_ids"].get(progression) != feedback.PROGRESSION_IDS):
        raise RuntimeError("exact natural progression identity must remain mandatory")
    checkpoint = "er-kernel:" + feedback.CHECKPOINT_TARGET
    if (plan["required_native_targets"].get("er-kernel", []).count(feedback.CHECKPOINT_TARGET) != 1
            or plan["required_native_test_ids"].get(checkpoint) != feedback.CHECKPOINT_IDS):
        raise RuntimeError("both exact default checkpoint identities must remain mandatory")
    struggle = "er-kernel:" + feedback.STRUGGLE_TARGET
    if (plan["required_native_targets"].get("er-kernel", []).count(feedback.STRUGGLE_TARGET) != 1
            or plan["required_native_test_ids"].get(struggle) != feedback.STRUGGLE_IDS):
        raise RuntimeError("both exact Struggle regressions must remain mandatory")
    canonical = "er-canonical:" + feedback.CANONICAL_TARGET
    if (plan["required_native_targets"].get("er-canonical", []).count(feedback.CANONICAL_TARGET) != 1
            or plan["required_native_test_ids"].get(canonical) != feedback.CANONICAL_IDS
            or len(feedback.CANONICAL_IDS) != 32
            or plan["execution_scope"].get("er-canonical") != [feedback.CANONICAL_TARGET]):
        raise RuntimeError("the complete canonical library and both new digest tests must remain mandatory")
    for crate, target in feedback.CAMPAIGN_TARGETS.items():
        if (plan["required_native_targets"].get(crate, []).count(target) != 1
                or plan["required_native_test_ids"].get(crate + ":" + target) != feedback.CAMPAIGN_TEST_IDS[crate]
                or target not in plan["execution_scope"].get(crate, []) or crate not in plan["packages"]):
            raise RuntimeError("all growth, natural 200-wave and replay witnesses must remain mandatory")
    if plan.get("requires_current_rng_witnesses") is not True:
        raise RuntimeError("current RNG compatibility obligation missing")
    for target, ids in feedback.RNG_TEST_IDS.items():
        if (plan["required_native_targets"].get("er-rng", []).count(target) != 1
                or plan["required_native_test_ids"].get("er-rng:" + target) != ids
                or target not in plan["execution_scope"].get("er-rng", []) or "er-rng" not in plan["packages"]):
            raise RuntimeError("all30 exact RNG test identities must remain mandatory")
    if (plan.get("requires_natural_coop_campaign") is not True
            or plan["required_native_targets"].get("er-kernel", []).count(feedback.COOP_CAMPAIGN_TARGET) != 1
            or plan["required_native_test_ids"].get("er-kernel:" + feedback.COOP_CAMPAIGN_TARGET) != feedback.COOP_CAMPAIGN_IDS
            or feedback.COOP_CAMPAIGN_TARGET not in plan["execution_scope"].get("er-kernel", [])):
        raise RuntimeError("complete natural co-op campaign must remain mandatory")
    if (plan.get("requires_coop_lost_receipt") is not True
            or plan["required_native_targets"].get("er-kernel", []).count(feedback.COOP_RECEIPT_TARGET) != 1
            or plan["required_native_test_ids"].get("er-kernel:" + feedback.COOP_RECEIPT_TARGET) != feedback.COOP_RECEIPT_IDS
            or feedback.COOP_RECEIPT_TARGET not in plan["execution_scope"].get("er-kernel", [])):
        raise RuntimeError("all three exact lost authority reply witnesses must remain mandatory")
    guard = plan.get("current_recovery_dependency_guard")
    if (guard is None or guard.get("status") != "verified" or guard.get("baseline_sha") != QUALIFIED_BASELINE
            or guard.get("dev_dependencies") != feedback.RECOVERY_DEV_EDGES
            or guard.get("manifests") != [f"rust/crates/{crate}/Cargo.toml" for crate in feedback.RECOVERY_DEV_EDGES]
            or guard.get("lock") != "rust/Cargo.lock"):
        raise RuntimeError("exact three test dependencies require a complete verified guard")
    product = [path for path in plan["changed_paths"] if path not in json.loads((feedback.ROOT / "scripts/ci/m9e-targets.json").read_bytes())["infrastructure_paths"]
               and not any(path.startswith(prefix) for prefix in json.loads((feedback.ROOT / "scripts/ci/m9e-targets.json").read_bytes())["documentation_prefixes"])]
    if len(product) != 67 or set(product) != set([*feedback.RECOVERY_PATHS, *generated.PATHS]):
        raise RuntimeError("combined product source must be exactly the67 reviewed paths")
    # All fourteen focused XP IDs were newly selected: three source-existing
    # tests had not belonged to the actual prior93-target/741-ID inventory.
    if plan.get("requires_current_xp_metadata") is not True:
        raise RuntimeError("installed XP calculation/content metadata obligation missing")
    expected_xp_counts = {"er-progression:m9e_current_experience": 5,
                           "er-progression:m9e_content_v2": 8, "er-content-compiler:m9e_progression": 3}
    for key, count in expected_xp_counts.items():
        crate, target = key.split(":")
        if (len(feedback.XP_TEST_IDS[key]) != count
                or plan["required_native_test_ids"].get(key) != feedback.XP_TEST_IDS[key]
                or plan["required_native_targets"].get(crate, []).count(target) != 1
                or target not in plan["execution_scope"].get(crate, []) or crate not in plan["packages"]):
            raise RuntimeError("whole source-qualified XP target omitted or altered")
    if (sum(map(len, plan["required_native_targets"].values())) != 57
            or len(plan["required_native_test_ids"]) != 51):
        raise RuntimeError("complete prior plus XP required target/identity inventory differs")
    owned_receipt = {"qualification": "source and planned inventory conservation only; combined execution pending",
                     "candidate_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
                     "selected_tests": 786, "selected_targets": 101, "prior_preserved_tests": 759,
                     "required_targets": 57, "required_identity_maps": 51, "composition_paths": 67,
                     "inventory_sha256": feedback.OWNED_FOUNDATION_INVENTORY_SHA256,
                     "sources": {**feedback.OWNED_FOUNDATION_SOURCES,
                         "rust/crates/er-wasm/tests/m9e_parity.rs": ["5ca9785d1263803f4227be939f57bdb46b4f99cb",
                             "95c09508d4ac63e3a401d2abd1a14725de8d85b1d5405f4de9d0e1999032ee6c"]}}
    owned_bytes = (json.dumps(owned_receipt, sort_keys=True) + "\n").encode()
    if len(owned_bytes) > 16384:
        raise RuntimeError("owned foundation source receipt exceeds16KiB")
    (Path(os.environ["RUNNER_TEMP"]) / "m9e-preflight/compact/owned-source-conservation.json").write_bytes(owned_bytes)
    xp_inventory = [(key.split(":")[0], key.split(":")[1], list(ids)) for key, ids in feedback.XP_TEST_IDS.items()]
    feedback.require_native_test_ids(feedback.XP_TEST_IDS, xp_inventory)
    import hashlib
    xp_qualified = {"rust/crates/er-progression/src/lib.rs":["86ddc67dbb657ee67cf319226eb8e36dc538b306","dc8e1c8cec42e138e3b27e19ba1a6aa1216c57e96d9e253f4f6b5190b4217fc7"],"rust/crates/er-progression/src/current_experience.rs":["86ddc67dbb657ee67cf319226eb8e36dc538b306","bdde28ba1326a834765223ad9558e2f067dc550fb891aebb90870be387d4192c"],"rust/crates/er-progression/tests/m9e_current_experience.rs":["86ddc67dbb657ee67cf319226eb8e36dc538b306","0c5ff471df5861b54288a71dc68b4df929f3de2479f469a64d099a6855f2a93d"],"rust/crates/er-progression/src/content_v2.rs":["aac81fe2b2d09ac891f1dbf14acf3c4daea53f52","39d14bb3d7b4760261a6c2053be68ee987b61f3e916389bfc1cb03a066b976c9"],"rust/crates/er-progression/tests/m9e_content_v2.rs":["aac81fe2b2d09ac891f1dbf14acf3c4daea53f52","955454d2fdd8f4203defa5c48d95b1bbe3674a07dc0ef6fb386acc350890d8a5"],"rust/crates/er-content-compiler/src/m9e_progression.rs":["aac81fe2b2d09ac891f1dbf14acf3c4daea53f52","2b9cf6bbcfffc3e582f5ab11c0f235f8ae29b2670d4e00be3cfd5b1869642b27"],"rust/crates/er-content-compiler/tests/m9e_progression.rs":["aac81fe2b2d09ac891f1dbf14acf3c4daea53f52","4e7c6630f7d7f8ca26b821bad432326be7d385ae5c90806389b9b72f38a14a50"],"test/kernel-fixtures/m9/export-progression-content.ts":["aac81fe2b2d09ac891f1dbf14acf3c4daea53f52","d094dd23a3b23b9afdb7b2bd49b1d9d63764a18e893bc20b1a823905f615898e"]}
    xp_qualified = feedback.supersede_owned_xp_sources(xp_qualified)
    if set(xp_qualified) != set(feedback.XP_PATHS):
        raise RuntimeError("exact eight qualified XP product source bindings required")
    for source_path, (_, source_hash) in xp_qualified.items():
        if hashlib.sha256((feedback.ROOT / source_path).read_bytes()).hexdigest() != source_hash:
            raise RuntimeError("XP source differs from its independently qualified focused candidate")
    xp_receipt = {"qualification": "source conservation only; no exporter, regenerated data or runtime XP qualification",
                  "candidate_sha": os.environ["GITHUB_SHA"], "focused_test_counts": {"foundation": 5, "metadata": 9},
                  "sources": xp_qualified}
    (Path(os.environ["RUNNER_TEMP"]) / "m9e-preflight/compact/xp-source-conservation.json").write_text(
        json.dumps(xp_receipt, sort_keys=True) + "\n")
    if plan.get("requires_generated_xp_fixtures") is not True:
        raise RuntimeError("actual generated XP fixture obligation missing")
    generated.validate_binding(plan.get("generated_fixture_inputs"))
    if plan["generated_fixture_inputs"] != generated.bind(feedback.ROOT, feedback.capture):
        raise RuntimeError("generated XP fixture source changed across actual planning")
    generated_inventory = [{"crate": key.split(":")[0], "target": key.split(":")[1],
                            "ids": list(ids), "historical_excluded_ids": []}
                           for key, ids in generated.PACK_IDS.items()]
    generated.validate_native(plan, {"generated_fixture_inputs": plan["generated_fixture_inputs"],
        "files": {"content": generated.FILES[generated.MANIFEST]["sha256"]}}, generated_inventory)
    for key in generated.PACK_IDS:
        crate, target = key.split(":")
        if target not in plan["execution_scope"].get(crate, []):
            raise RuntimeError("complete bundle/compiler fixture witness absent from execution")
    (Path(os.environ["RUNNER_TEMP"]) / "m9e-preflight/compact/generated-fixture-source.json").write_text(
        json.dumps({"qualification": "actual source metadata only; current runtime compatibility pending",
                    "candidate_sha": os.environ["GITHUB_SHA"],
                    "fixture_inputs": plan["generated_fixture_inputs"]}, sort_keys=True) + "\n")
    configured_coop = json.loads((feedback.ROOT / "scripts/ci/m9e-targets.json").read_bytes())["current_coop_startup_focus"]
    if (configured_coop["browser_ids"] != coop.BROWSER_IDS or len(coop.BROWSER_IDS) != 3
            or coop.BROWSER_IDS[-1] != coop.PUBLIC_RETRY_ID or len(coop.RTC_SOURCES) != 34):
        raise RuntimeError("three exact cooperative browser journeys and complete RTC source binding required")
    inventory = [{"crate": crate, "target": target, "ids": list(ids), "historical_excluded_ids": []}
                 for (crate, target), ids in ((coop.KERNEL_TARGET, coop.KERNEL_IDS), (coop.ENTRY_TARGET, coop.ENTRY_IDS))]
    coop.validate_inventory(plan, inventory, os.environ["GITHUB_SHA"])
    if (plan["current_coop_startup_binding"] != coop.source_binding(feedback.ROOT, os.environ["GITHUB_SHA"])
            or plan.get("current_coop_dependency_guard") is not None):
        raise RuntimeError("retained co-op binding or unchanged dependency scope differs")
    for flag in ("requires_current_cost_probe", "requires_current_control_query", "requires_current_state_query",
                 "requires_current_proposal", "requires_read_rebind", "requires_ai_max_pp", "requires_title_storage",
                 "requires_title_retirement", "requires_worker_storage", "requires_current_storage",
                 "requires_current_coop_startup", "requires_browser", "requires_wasm", "requires_browser_worker",
                 "requires_browser_rtc", "requires_cli_executable", "requires_worker_executable"):
        if plan.get(flag) is not True:
            raise RuntimeError(f"previously qualified capability omitted: {flag}")
    if not plan.get("rule_worker") or not plan.get("timer_mutant") or not plan.get("replica_mutant"):
        raise RuntimeError("previously qualified rule or mutant evidence omitted")
    (Path(os.environ["RUNNER_TEMP"]) / "m9e-preflight/diagnostics/integration-plan.json").write_text(json.dumps(plan, sort_keys=True) + "\n")
    # A structural projection checks the real serializer's byte bound before a
    # costly combined run. These substituted fields are never game evidence.
    import copy
    import hashlib
    import m9e_phases as phases
    query_and_campaign = [
        {"crate": phases.STATE_QUERY_TARGET[0], "target": phases.STATE_QUERY_TARGET[1],
         "ids": list(phases.STATE_QUERY_IDENTITIES[phases.STATE_QUERY_TARGET]), "historical_excluded_ids": []},
        {"crate": "er-kernel", "target": feedback.COOP_CAMPAIGN_TARGET,
         "ids": list(feedback.COOP_CAMPAIGN_IDS), "historical_excluded_ids": []},
    ]
    assigned = phases.partition(query_and_campaign)
    if (assigned["e"] != [list(phases.STATE_QUERY_TARGET), ["er-kernel", feedback.COOP_CAMPAIGN_TARGET]]
            or any(assigned[lane] for lane in ("a", "b", "c", "d"))):
        raise RuntimeError("existing E must own the whole ordinary query and distinct campaign targets")
    retained = list((Path(os.environ["RUNNER_TEMP"]) / "m9e-retained-aggregate").rglob("phase-summary.json"))
    if len(retained) != 1:
        raise RuntimeError("one qualified retained aggregate required")
    raw = retained[0].read_bytes()
    if len(raw) != 64706 or hashlib.sha256(raw).hexdigest() != "5e00dd3ceffef9f2e49d011d2ddfcefad6f5ea161093807390f6114ad825d96d":
        raise RuntimeError("retained aggregate bytes differ")
    projected = phases.read_bounded(retained[0], hashlib.sha256(raw).hexdigest())
    if projected["product_sha"] != "9fbb9fa2a624f8341974ce27e18260a21063751f" or projected["identity"]["run_id"] != "34130111706":
        raise RuntimeError("retained aggregate identity differs")
    projected["identity"] = phases.identity(feedback)
    projected["product_sha"] = os.environ["GITHUB_SHA"]
    projected["current_coop_startup"]["replay_workers"] = 4
    projected["current_coop_startup"]["rtc_tests"] = 3
    projected["current_coop_startup"]["public_retry_workers"] = 6
    projected["current_coop_startup"]["kernel_tests"] = 8
    projected["required_native_target_counts"]["er-kernel:m9e_coop_choices_v7"] = 8
    for target, ids in ((feedback.AI_COMMAND_TARGET, feedback.AI_COMMAND_IDS),
                        (feedback.REPLACEMENT_TARGET, feedback.REPLACEMENT_IDS),
                        (feedback.PROGRESSION_TARGET, feedback.PROGRESSION_IDS),
                        (feedback.CHECKPOINT_TARGET, feedback.CHECKPOINT_IDS),
                        (feedback.STRUGGLE_TARGET, feedback.STRUGGLE_IDS)):
        projected["required_native_target_counts"]["er-kernel:" + target] = len(ids)
    projected["required_native_target_counts"]["er-canonical:" + feedback.CANONICAL_TARGET] = 32
    for crate, target in feedback.CAMPAIGN_TARGETS.items():
        projected["required_native_target_counts"][crate + ":" + target] = len(feedback.CAMPAIGN_TEST_IDS[crate])
    projected_test_count = sum(len(row["ids"]) for row in owned_inventory)
    if projected_test_count != 786 or len(owned_inventory) != 101:
        raise RuntimeError("actual prior759 plus27 owned foundation identity accounting differs")
    projected["tests"] = {"selected": projected_test_count, "executed": projected_test_count, "passed": projected_test_count, "failed": 0, "skipped": 0}
    projected["required_native_target_counts"].update({key: len(ids) for key, ids in feedback.XP_TEST_IDS.items()})
    projected["required_native_target_counts"].update({key: len(ids) for key, ids in generated.PACK_IDS.items()})
    projected["required_native_target_counts"].update({key: len(ids) for key, ids in feedback.OWNED_FOUNDATION_TEST_IDS.items()})
    for target, ids in feedback.RNG_TEST_IDS.items():
        projected["required_native_target_counts"]["er-rng:" + target] = len(ids)
    projected["required_native_target_counts"]["er-kernel:" + feedback.COOP_CAMPAIGN_TARGET] = 1
    projected["required_native_target_counts"]["er-kernel:" + feedback.COOP_RECEIPT_TARGET] = 3
    projected["native_e_manifest_sha256"] = "0" * 64
    projected["natural_cooperative_campaign"] = {"status": "passed", "tests": 1, "wave": 200, "outcome": "Victory", "profile": "opt1-debug-assertions-overflow-checks", "decisions": 2188, "proposals": 258, "materials": 1675, "presentations": 3352, "rewards": 199, "progression": 950, "native_manifest_sha256": "0" * 64, "evidence_sha256": "0" * 64}
    # Qualified v2 fact shape is a structural projection only. No snapshots,
    # Workers or game events execute here, and these values never enter a proof.
    public_retry = json.loads(r'''{"actual_workers":6,"content_sha256":"640dcf079ae133fdcfb013c99109844ebbd1744cd397f705f959314c68b696e4","disposed_workers":6,"generation":1,"glue_sha256":"626ea916ae25a7e83ba1ba76094fa92fdd1b0806d702293c011f2256306ebddc","peers":[{"after_bytes":112069,"after_sha256":"2f5ea21be2eb3d2e361ed0a6ca3c3013074ac2bc3324e4523f04fe0ee4f17d15","before_bytes":112069,"before_sha256":"2f5ea21be2eb3d2e361ed0a6ca3c3013074ac2bc3324e4523f04fe0ee4f17d15","checkpoint_bytes":112148,"checkpoint_sha256":"1f020c2e8f0f5a0cb9a543a3d74d15a49c2d4c691729b8c82a5342b20501ee41","exact_frames":true,"frame_bytes":61417,"host_snapshot_conserved":true,"ledger_sha256":"b4e9dd08087ab16b007587455dde0a79d9ced884c7118000541573f88451fbe8","lifecycle_sha256":"73acf7233cda2fc1ca637ca3c24c4027a395dfd3ad980121def729935991189f","original_presentations":3,"original_raw_inputs":1444,"ownership_verified":true,"presentations":0,"proposal_bytes":314,"proposal_sha256":"8a75fc694931d558043e6d8b4e87b759813671513179b050bfb6ca6a74dae1e3","receipt_bytes":61103,"receipt_sha256":"47049fcd785a21b2d85aa207ff285ee80fda3898cc6bd368cec5f46e34b91256","received":1,"restored_raw_inputs":0,"role":"AUTHORITY","sent":1,"stages":[{"exact_restore":true,"phase":"checkpoint","preconnection_retry_rejected":true},{"exact_restore":true,"phase":"disconnected_restore","preconnection_retry_rejected":true}]},{"after_bytes":51483,"after_sha256":"c7ffbe4e9e0b12a74dcf2e44341e8f0a5d5f6462897ce1b9eb78032e879483d6","before_bytes":57204,"before_sha256":"f9719b44f7c36c311efd948fe8786ca8c4978cdd64b7276d061d41e965db3928","checkpoint_bytes":57283,"checkpoint_sha256":"a3969c481ff6e48339fc4934c83fa6b0a483b445fcb317ddfaae4a414d4aa1f8","exact_frames":true,"frame_bytes":61417,"host_snapshot_conserved":false,"ledger_sha256":"b4e9dd08087ab16b007587455dde0a79d9ced884c7118000541573f88451fbe8","lifecycle_sha256":"73acf7233cda2fc1ca637ca3c24c4027a395dfd3ad980121def729935991189f","original_presentations":3,"original_raw_inputs":1450,"ownership_verified":true,"presentations":1,"proposal_bytes":314,"proposal_sha256":"8a75fc694931d558043e6d8b4e87b759813671513179b050bfb6ca6a74dae1e3","receipt_bytes":61103,"receipt_sha256":"47049fcd785a21b2d85aa207ff285ee80fda3898cc6bd368cec5f46e34b91256","received":1,"restored_raw_inputs":0,"role":"REPLICA","sent":1,"stages":[{"exact_restore":true,"phase":"checkpoint","preconnection_retry_rejected":true},{"exact_restore":true,"phase":"disconnected_restore","preconnection_retry_rejected":true}]}],"recovery":"genuine_pending_and_committed_checkpoints_then_actual_disconnected_restore","schema_version":1,"settled_retry_noop":true,"setup_manifest_sha256":"db0a72a71dbdfeb785a38e5d254899d0a64f27dffdabf17c5caee8de8104e5ea","source_sha":"1da62ee6195673ebe7088b2b10cd5569bb12b26f","wasm_sha256":"005664a6b9cc0e9b65a0a6997fe68396b436cfeea33b7af4c57c4e0a10021388","worker_sha256":"8e43211f0fbfeea791733141a6ed0293bd00bca97041228be2f8595cd40a8674"}''')
    public_retry["source_sha"] = os.environ["GITHUB_SHA"]
    public_rtc = {"worker": "projection-worker", "assets": {"projection-worker": {"sha256": public_retry["worker_sha256"]}},
                  "cohort": {key: public_retry[key] for key in ("glue_sha256", "wasm_sha256", "content_sha256")}}
    coop.validate_public_retry(public_retry, {"setup_manifest_sha256": public_retry["setup_manifest_sha256"]},
                               public_rtc, os.environ["GITHUB_SHA"])
    if len(phases.encoded(public_retry)) > 16384:
        raise RuntimeError("projected actual public retry fact shape exceeds unchanged evidence bound")
    projected["current_coop_startup"]["public_retry_evidence_sha256"] = coop.object_hash(public_retry)
    for key in generated.PACK_IDS:
        projected["native_target_timing_ms"][key] = 600000
    for key in feedback.OWNED_FOUNDATION_TEST_IDS:
        projected["native_target_timing_ms"][key] = 600000
    frozen = copy.deepcopy(projected)
    projection_path = Path(os.environ["RUNNER_TEMP"]) / "m9e-preflight/diagnostics/projected-aggregate.json"
    digest = phases.write_bounded(projection_path, projected)
    wire = projection_path.read_bytes()
    decoded_digest = hashlib.sha256(phases.encoded(projected)).hexdigest()
    if (len(wire) > 65536 or len(phases.encoded(projected)) > 196608
            or phases.read_bounded(projection_path, digest) != frozen
            or digest != hashlib.sha256(wire).hexdigest()):
        raise RuntimeError("bounded aggregate wire roundtrip discarded full evidence")
    compact = phases.compact_summary(projected, digest, {})
    if (compact["phase_summary_sha256"] != digest
            or compact.get("phase_summary_decoded_sha256") != decoded_digest):
        raise RuntimeError("aggregate wire and decoded proof digest identities disagree")
    if projected != frozen or len(phases.encoded(compact)) > 16000:
        raise RuntimeError("projected compact bound or full metadata conservation failed")
    for key in ("identity", "tests", "current_coop_startup"):
        if compact[key] != projected[key]:
            raise RuntimeError("projected compact discarded required identity")
    for key in ("required_native_target_counts", "timer_mutant", "replica_mutant"):
        if compact[key] != projected[key] and compact[key] != {
                "file": "phase-summary.json", "sha256": digest, "field": key}:
            raise RuntimeError("projected compact target/control reference differs")
    receipt = {"status": "passed", "qualification": "structural compaction projection only; no native or platform qualification",
               "source_sha": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
               "compact_bytes": len(phases.encoded(compact)), "aggregate_wire_bytes": len(wire),
               "aggregate_decoded_bytes": len(phases.encoded(projected)), "wire_sha256": digest,
               "decoded_sha256": decoded_digest, "projected_tests": projected_test_count,
               "retained_sha256": hashlib.sha256(raw).hexdigest()}
    (Path(os.environ["RUNNER_TEMP"]) / "m9e-preflight/compact/compaction-projection.json").write_text(json.dumps(receipt, sort_keys=True) + "\n")
    print("Passed: exact66-path source composition, all759 prior IDs/exclusions and27 additions across101 targets, qualified28 product sources, and retained co-op/platform/cost/rule/mutant obligations. No native/platform qualification.")


if __name__ == "__main__":
    main()
