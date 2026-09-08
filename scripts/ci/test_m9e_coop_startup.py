import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import m9e_coop_startup as coop


class CoopPolicyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.config = {"current_coop_startup_focus": copy.deepcopy(coop.POLICY)}
        self.sha = "a" * 40

    def install(self):
        for index, path in enumerate([*coop.PRODUCT_PATHS, coop.HELPER, coop.ENTRY_PRODUCER, coop.RTC_PRODUCER]):
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(f"bounded synthetic source {index}\n")

    def test_complete_scope_is_exact_and_preserves_policy(self):
        self.install()
        before = copy.deepcopy(self.config)
        self.assertEqual(coop.select_scope(self.config, coop.PRODUCT_PATHS, self.root), (True, True))
        self.assertEqual(coop.select_scope(self.config, [], self.root), (False, True))
        with self.assertRaisesRegex(RuntimeError, "unmapped"):
            coop.select_scope(self.config, [*coop.PRODUCT_PATHS, "rust/unrelated.rs"], self.root)
        self.assertEqual(self.config, before)

    def test_missing_partial_or_changed_policy_never_admits_new_coop(self):
        self.assertEqual(coop.select_scope(self.config, ["rust/crates/er-cli/src/current_agent.rs"], self.root), (False, False))
        with self.assertRaisesRegex(RuntimeError, "complete installed"):
            coop.select_scope(self.config, coop.TRIGGERS, self.root)
        self.install()
        with self.assertRaisesRegex(RuntimeError, "complete installed"):
            coop.select_scope({}, coop.PRODUCT_PATHS, self.root)
        (self.root / coop.TRIGGERS[0]).unlink()
        with self.assertRaisesRegex(RuntimeError, "complete installed"):
            coop.select_scope(self.config, [], self.root)
        changed = copy.deepcopy(self.config)
        changed["current_coop_startup_focus"]["exact_test_ids"][":".join(coop.ENTRY_TARGET)].pop()
        with self.assertRaisesRegex(RuntimeError, "policy differs"):
            coop.select_scope(changed, [], self.root)

    def test_dependency_guard_accepts_only_direct_cli_protocol_edge(self):
        manifest = '[package]\nname="er-cli"\n[dependencies]\ner-env={path="../er-env"}\n'
        after = manifest + 'er-protocol={path="../er-protocol"}\n'
        lock = 'version=4\n[[package]]\nname="er-cli"\nversion="0.1.0"\ndependencies=["er-env"]\n[[package]]\nname="er-env"\nversion="0.1.0"\n'
        next_lock = lock.replace('["er-env"]', '["er-env","er-protocol"]')
        proof = coop.dependency_guard(manifest, after, lock, next_lock)
        self.assertEqual(proof["dependency"], "er-protocol")
        for altered_manifest, altered_lock in ((after + 'serde="1"\n', next_lock), (after, next_lock.replace('version="0.1.0"', 'version="0.2.0"'))):
            with self.assertRaisesRegex(RuntimeError, "beyond"):
                coop.dependency_guard(manifest, altered_manifest, lock, altered_lock)
        with self.assertRaisesRegex(RuntimeError, "new direct"):
            coop.dependency_guard(after, after, next_lock, next_lock)

    def test_both_native_targets_and_real_platform_prerequisites_remain_mandatory(self):
        self.install()
        inventory = [{"crate": target[0], "target": target[1], "ids": list(ids), "historical_excluded_ids": []}
                     for target, ids in ((coop.KERNEL_TARGET, coop.KERNEL_IDS), (coop.ENTRY_TARGET, coop.ENTRY_IDS))]
        plan = {"requires_current_coop_startup": True, "current_coop_startup_binding": coop.source_binding(self.root, self.sha),
                "required_native_test_ids": copy.deepcopy(coop.NATIVE_IDS), "required_native_targets": copy.deepcopy(coop.NATIVE_TARGETS),
                **{key: True for key in ("requires_browser", "requires_wasm", "requires_browser_worker", "requires_browser_rtc", "requires_cli_executable", "requires_worker_executable")}}
        coop.validate_inventory(plan, inventory, self.sha)
        import m9e_phases as phases
        proof = {"plan": plan, "inventory": inventory, "identity": {"product_sha": self.sha}, "lane": "d"}
        coop.validate_lane(proof, self.root, phases.partition)
        assigned = phases.partition(inventory)
        for target, owner in ((coop.ENTRY_TARGET, "a"), (coop.KERNEL_TARGET, "d")):
            for wrong_lane in (lane for lane in assigned if lane != owner):
                moved = copy.deepcopy(assigned)
                moved[owner].remove(list(target))
                moved[wrong_lane].append(list(target))
                with self.assertRaisesRegex(RuntimeError, "exact native A entry and D kernel"):
                    coop.validate_lane(proof, self.root, lambda _: moved)
                duplicate = copy.deepcopy(assigned)
                duplicate[wrong_lane].append(list(target))
                with self.assertRaisesRegex(RuntimeError, "exact native A entry and D kernel"):
                    coop.validate_lane(proof, self.root, lambda _: duplicate)
            missing = copy.deepcopy(assigned)
            missing[owner].remove(list(target))
            with self.assertRaisesRegex(RuntimeError, "exact native A entry and D kernel"):
                coop.validate_lane(proof, self.root, lambda _: missing)
        for flag in ("requires_current_coop_startup", "requires_browser_rtc", "requires_worker_executable"):
            changed = copy.deepcopy(plan)
            changed[flag] = False
            with self.assertRaises(RuntimeError):
                coop.validate_inventory(changed, inventory, self.sha)
        for index in (0, 1):
            changed = copy.deepcopy(inventory)
            changed[index]["ids"].pop()
            with self.assertRaisesRegex(RuntimeError, "identities"):
                coop.validate_inventory(plan, changed, self.sha)
        with self.assertRaisesRegex(RuntimeError, "prerequisites"):
            coop.validate_inventory(plan, inventory[:1], self.sha)

    def test_source_binding_covers_every_product_and_producer(self):
        self.install()
        proof = coop.source_binding(self.root, self.sha)
        self.assertEqual(proof["source_sha"], self.sha)
        self.assertEqual(set(proof["source_hashes"]), set([*coop.PRODUCT_PATHS, coop.HELPER, coop.ENTRY_PRODUCER, coop.RTC_PRODUCER]))
        for path, actual in proof["source_hashes"].items():
            self.assertEqual(actual, hashlib.sha256((self.root / path).read_bytes()).hexdigest())
        target = self.root / coop.PRODUCT_PATHS[0]
        target.write_text("changed synthetic source\n")
        self.assertNotEqual(coop.source_binding(self.root, self.sha), proof)

    def entry_fixture(self):
        self.install()
        for path in coop.ENTRY_SOURCES:
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                target.write_text("synthetic source\n")
        bundle = self.root / "rust/fixtures/m9/engineering/game-content-bundle-v2.json"
        bundle.write_text("synthetic content\n")
        identity = {"product_sha": self.sha, "run_id": "17", "run_attempt": "1",
                    "target": "synthetic-target", "toolchain": "rustc 1.97.1 (synthetic)"}
        binding = coop.source_binding(self.root, self.sha)
        proof = {"source_sha": self.sha, "run_id": "17", "run_attempt": "1", "status": "passed",
                 "toolchain": identity["toolchain"], "executed_test_ids": list(coop.ENTRY_IDS),
                 "tests": {"executed": 2, "passed": 2, "failed": 0, "skipped": 0},
                 "source_hashes": {path: coop.digest(self.root / path) for path in coop.ENTRY_SOURCES},
                 "bundle_sha256": coop.digest(bundle), "logs": {name: {"sha256": "b" * 64, "bytes": 125, "elapsed_seconds": 25.0}
                    for name in ("build", "worker-build", "execute-1", "execute-2")}}
        for name in ("worker_artifact", "cli_artifact", "test_artifact"):
            proof[name] = {"sha256": "c" * 64, "bytes": 100, "profile": {"opt_level": "1", "debug_assertions": True,
                          "overflow_checks": True, "test": name == "test_artifact"}}
        proof["worker_artifact"].update({"source_sha": self.sha, "host": identity["target"]})
        proof["test_artifact"].update({"ids": list(coop.ENTRY_IDS), "source_sha256": proof["source_hashes"][coop.PRODUCT_PATHS[13]]})
        return proof, identity, binding

    def test_entry_rejects_cross_run_missing_backend_and_wrong_build_profiles(self):
        proof, identity, binding = self.entry_fixture()
        coop.validate_entry(proof, identity, binding, self.root)
        mutations = [lambda value: value.update(run_id="18"),
                     lambda value: value["executed_test_ids"].pop(),
                     lambda value: value["worker_artifact"]["profile"].update(opt_level="0"),
                     lambda value: value["cli_artifact"]["profile"].update(overflow_checks=False),
                     lambda value: value["test_artifact"].update(source_sha256="d" * 64),
                     lambda value: value["logs"]["execute-2"].update(elapsed_seconds=600.01),
                     lambda value: value["source_hashes"].pop(coop.ENTRY_PRODUCER)]
        for mutate in mutations:
            changed = copy.deepcopy(proof)
            mutate(changed)
            with self.assertRaises(RuntimeError):
                coop.validate_entry(changed, identity, binding, self.root)
        (self.root / coop.PRODUCT_PATHS[13]).write_text("changed test after execution\n")
        with self.assertRaisesRegex(RuntimeError, "conservation"):
            coop.validate_entry(proof, identity, binding, self.root)

    def public_retry_fixture(self, rtc, setup_hash):
        # Observed v2 six-Worker shape; only candidate/asset bindings are synthetic.
        value = json.loads(r'''{"actual_workers":6,"content_sha256":"640dcf079ae133fdcfb013c99109844ebbd1744cd397f705f959314c68b696e4","disposed_workers":6,"generation":1,"glue_sha256":"626ea916ae25a7e83ba1ba76094fa92fdd1b0806d702293c011f2256306ebddc","peers":[{"after_bytes":112069,"after_sha256":"2f5ea21be2eb3d2e361ed0a6ca3c3013074ac2bc3324e4523f04fe0ee4f17d15","before_bytes":112069,"before_sha256":"2f5ea21be2eb3d2e361ed0a6ca3c3013074ac2bc3324e4523f04fe0ee4f17d15","checkpoint_bytes":112148,"checkpoint_sha256":"1f020c2e8f0f5a0cb9a543a3d74d15a49c2d4c691729b8c82a5342b20501ee41","exact_frames":true,"frame_bytes":61417,"host_snapshot_conserved":true,"ledger_sha256":"b4e9dd08087ab16b007587455dde0a79d9ced884c7118000541573f88451fbe8","lifecycle_sha256":"73acf7233cda2fc1ca637ca3c24c4027a395dfd3ad980121def729935991189f","original_presentations":3,"original_raw_inputs":1444,"ownership_verified":true,"presentations":0,"proposal_bytes":314,"proposal_sha256":"8a75fc694931d558043e6d8b4e87b759813671513179b050bfb6ca6a74dae1e3","receipt_bytes":61103,"receipt_sha256":"47049fcd785a21b2d85aa207ff285ee80fda3898cc6bd368cec5f46e34b91256","received":1,"restored_raw_inputs":0,"role":"AUTHORITY","sent":1,"stages":[{"exact_restore":true,"phase":"checkpoint","preconnection_retry_rejected":true},{"exact_restore":true,"phase":"disconnected_restore","preconnection_retry_rejected":true}]},{"after_bytes":51483,"after_sha256":"c7ffbe4e9e0b12a74dcf2e44341e8f0a5d5f6462897ce1b9eb78032e879483d6","before_bytes":57204,"before_sha256":"f9719b44f7c36c311efd948fe8786ca8c4978cdd64b7276d061d41e965db3928","checkpoint_bytes":57283,"checkpoint_sha256":"a3969c481ff6e48339fc4934c83fa6b0a483b445fcb317ddfaae4a414d4aa1f8","exact_frames":true,"frame_bytes":61417,"host_snapshot_conserved":false,"ledger_sha256":"b4e9dd08087ab16b007587455dde0a79d9ced884c7118000541573f88451fbe8","lifecycle_sha256":"73acf7233cda2fc1ca637ca3c24c4027a395dfd3ad980121def729935991189f","original_presentations":3,"original_raw_inputs":1450,"ownership_verified":true,"presentations":1,"proposal_bytes":314,"proposal_sha256":"8a75fc694931d558043e6d8b4e87b759813671513179b050bfb6ca6a74dae1e3","receipt_bytes":61103,"receipt_sha256":"47049fcd785a21b2d85aa207ff285ee80fda3898cc6bd368cec5f46e34b91256","received":1,"restored_raw_inputs":0,"role":"REPLICA","sent":1,"stages":[{"exact_restore":true,"phase":"checkpoint","preconnection_retry_rejected":true},{"exact_restore":true,"phase":"disconnected_restore","preconnection_retry_rejected":true}]}],"recovery":"genuine_pending_and_committed_checkpoints_then_actual_disconnected_restore","schema_version":1,"settled_retry_noop":true,"setup_manifest_sha256":"db0a72a71dbdfeb785a38e5d254899d0a64f27dffdabf17c5caee8de8104e5ea","source_sha":"1da62ee6195673ebe7088b2b10cd5569bb12b26f","wasm_sha256":"005664a6b9cc0e9b65a0a6997fe68396b436cfeea33b7af4c57c4e0a10021388","worker_sha256":"8e43211f0fbfeea791733141a6ed0293bd00bca97041228be2f8595cd40a8674"}''')
        value.update({"source_sha": self.sha, "worker_sha256": rtc["assets"][rtc["worker"]]["sha256"],
                      "setup_manifest_sha256": setup_hash, **rtc["cohort"]})
        return value

    def platform_fixture(self):
        self.install()
        for path in coop.RTC_SOURCES:
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                target.write_text("synthetic source\n")
        identity = {"product_sha": self.sha, "run_id": "17", "run_attempt": "1"}
        native = {"identity": identity, "plan": {"requires_current_coop_startup": True,
                  "current_coop_startup_binding": coop.source_binding(self.root, self.sha)}}
        rtc = {"worker": "worker.js", "assets": {"worker.js": {"bytes": 100, "sha256": "c" * 64, "role": "worker"}},
               "cohort": {key: "b" * 64 for key in ("content_sha256", "glue_sha256", "wasm_sha256")}}
        setup = {"schema_version": 1, "source_sha": self.sha, "assets": {name: {"bytes": 99, "sha256": "d" * 64}
                 for name in ("coop-host-initialization.json", "coop-guest-initialization.json")}}
        setup_hash = hashlib.sha256((json.dumps(setup, sort_keys=True) + "\n").encode()).hexdigest()
        evidence = {"source_sha": self.sha, "run_id": "17", "run_attempt": "1", "status": "passed",
                    "tests": {"passed": 3, "failed": 0, "skipped": 0, "ids": list(coop.BROWSER_IDS)},
                    "source_hashes": {path: coop.digest(self.root / path) for path in coop.RTC_SOURCES},
                    "platform": {**rtc, "manifest_sha256": "e" * 64, "source_sha": self.sha},
                    "initializations": setup, "setup_manifest_sha256": setup_hash,
                    "logs": {"browser": {"sha256": "f" * 64, "bytes": 100, "elapsed_seconds": 300.0}}, "browser_evidence": []}
        for index, seat in enumerate(("host", "guest")):
            evidence["browser_evidence"].append({"source_sha": self.sha, "order": seat, "actual_workers": 2,
                "worker_sha256": "c" * 64, "setup_manifest_sha256": setup_hash, **rtc["cohort"],
                "host_choices": [1], "guest_choices": [7, 10], "party_owners": [1, 2, 2], "raw_inputs": [1440, 1446],
                "received": ([2, 3], [3, 3])[index], "delayed_offer_ms": (12000, 0)[index],
                "retry_preserved_snapshots": True, "presentations": 1, "choices_bytes": 1416,
                "started_bytes": 32318, "choices_sha256": "a" * 64, "started_sha256": "b" * 64,
                "replay_workers": 2, "replay": [
                    {"bytes": 2000000, "sha256": seat * 64, "live_snapshot_preserved": True,
                     "full_replay_equal": True, "reexport_equal": True, "disposed": True} for seat in ("a", "b")]})
        evidence["browser_evidence"].append(self.public_retry_fixture(rtc, setup_hash))
        return {"current_coop_rtc": evidence, "browser_rtc_assets": {"manifest_sha256": "e" * 64, "manifest": rtc}}, native

    def test_entry_source_reference_preserves_all_validation_and_rejects_rebinding(self):
        proof, identity, binding = self.entry_fixture()
        identity["files"] = {"rule_workspace": coop.digest(self.root / "rust/Cargo.toml"),
                             "rule_toolchain": coop.digest(self.root / "rust/rust-toolchain.toml"),
                             "content": coop.digest(self.root / "rust/fixtures/m9/engineering/game-content-bundle-v2-manifest.json")}
        before = copy.deepcopy(proof)
        retained = coop.reference_entry_sources(proof, identity, binding, self.root)
        self.assertEqual(proof, before)
        self.assertLess(len(json.dumps(retained)), len(json.dumps(proof)))
        coop.validate_entry(retained, identity, binding, self.root)
        self.assertNotIn("rust/Cargo.toml", retained["source_hashes"])
        other_identity = copy.deepcopy(identity)
        other_identity["files"]["content"] = "f" * 64
        with self.assertRaisesRegex(RuntimeError, "conservation"):
            coop.validate_entry(retained, other_identity, binding, self.root)
        rebound = copy.deepcopy(binding)
        rebound["source_hashes"][coop.PRODUCT_PATHS[0]] = "f" * 64
        with self.assertRaisesRegex(RuntimeError, "source reference"):
            coop.validate_entry(retained, identity, rebound, self.root)
        retained["logs"]["execute-2"]["elapsed_seconds"] = 601
        with self.assertRaisesRegex(RuntimeError, "bounded"):
            coop.validate_entry(retained, identity, binding, self.root)

    def test_balanced_partition_preserves_whole_query_and_coop_targets(self):
        import m9e_phases as phases
        rows = [{"crate": crate, "target": target, "ids": list(ids), "historical_excluded_ids": []}
                for (crate, target), ids in ((coop.ENTRY_TARGET, coop.ENTRY_IDS), (coop.KERNEL_TARGET, coop.KERNEL_IDS),
                    *phases.STATE_QUERY_IDENTITIES.items(), (phases.CONTROL_QUERY_TARGET, phases.CONTROL_QUERY_TEST_IDS))]
        before = copy.deepcopy(rows)
        assignment = phases.partition(rows)
        self.assertEqual(rows, before)
        self.assertEqual(assignment["c"], [])
        self.assertEqual(assignment["d"], [list(coop.KERNEL_TARGET)])
        self.assertEqual(assignment["e"], [list(phases.STATE_QUERY_TARGET)])
        self.assertEqual(assignment["b"], [list(phases.STATE_QUERY_WORKER_TARGET)])
        self.assertEqual(assignment["a"], [list(coop.ENTRY_TARGET), list(phases.CONTROL_QUERY_TARGET)])
        self.assertEqual(len({tuple(pair) for targets in assignment.values() for pair in targets}), len(rows))
        self.assertEqual(sum(len(row["ids"]) for row in rows), 14)

    def test_platform_rejects_foreign_assets_incomplete_journeys_and_changed_material(self):
        proof, native = self.platform_fixture()
        coop.validate_platform(proof, native, self.root)
        mutations = [lambda value: value["current_coop_rtc"].update(run_attempt="2"),
                     lambda value: value["current_coop_rtc"]["platform"].update(manifest_sha256="a" * 64),
                     lambda value: value["current_coop_rtc"]["browser_evidence"].pop(),
                     lambda value: value["current_coop_rtc"]["browser_evidence"][1].update(raw_inputs=[1, 1]),
                     lambda value: value["current_coop_rtc"]["browser_evidence"][0].update(delayed_offer_ms=0),
                     lambda value: value["current_coop_rtc"]["browser_evidence"][1].update(choices_sha256="c" * 64),
                     lambda value: value["current_coop_rtc"]["initializations"]["assets"]["coop-host-initialization.json"].update(bytes=1)]
        for mutate in mutations:
            changed = copy.deepcopy(proof)
            mutate(changed)
            with self.assertRaises(RuntimeError):
                coop.validate_platform(changed, native, self.root)
        native["plan"]["requires_current_coop_startup"] = False
        with self.assertRaisesRegex(RuntimeError, "unrequested"):
            coop.validate_platform(proof, native, self.root)

    def test_entry_adapter_uses_the_existing_runner_cap_with_a_real_child(self):
        import os
        import time
        from unittest.mock import patch
        full = self.root / "full"
        full.mkdir()
        runner = self.root / "runner"
        runner.mkdir()
        producer = self.root / "stub-coop-producer.py"
        producer.write_text("print('co-op bounded child reached', flush=True)\nraise SystemExit(7)\n")
        before = dict(os.environ)
        with patch.dict(os.environ, {"RUNNER_TEMP": str(runner), "M9E_NATIVE_LANE": "a"}), \
                patch.object(coop, "ENTRY_PRODUCER", producer.name):
            with self.assertRaisesRegex(RuntimeError, "command exited 7"):
                coop.execute_entry(self.root, full, {}, {}, coop.ENTRY_IDS, time.monotonic() + 30)
        self.assertEqual((full / "coop-entry-producer.log").read_text(), "co-op bounded child reached\n")
        self.assertFalse((runner / "m9e-coop-entry-focused").exists())
        self.assertEqual(dict(os.environ), before)

    def test_platform_requires_complete_replay_for_both_peers_and_both_orders(self):
        proof, native = self.platform_fixture()
        coop.validate_platform(proof, native, self.root)
        for order in range(2):
            for peer in range(2):
                for field in ("live_snapshot_preserved", "full_replay_equal", "reexport_equal", "disposed"):
                    changed = copy.deepcopy(proof)
                    changed["current_coop_rtc"]["browser_evidence"][order]["replay"][peer][field] = False
                    with self.assertRaisesRegex(RuntimeError, "capsule replay"):
                        coop.validate_platform(changed, native, self.root)
                for bad in (0, 4194305, True):
                    changed = copy.deepcopy(proof)
                    changed["current_coop_rtc"]["browser_evidence"][order]["replay"][peer]["bytes"] = bad
                    with self.assertRaisesRegex(RuntimeError, "capsule replay"):
                        coop.validate_platform(changed, native, self.root)
            changed = copy.deepcopy(proof)
            changed["current_coop_rtc"]["browser_evidence"][order]["replay"].pop()
            with self.assertRaisesRegex(RuntimeError, "two fresh replay Workers"):
                coop.validate_platform(changed, native, self.root)

    def test_platform_binds_export_router_source_and_rejects_missing_capsule_hash(self):
        proof, native = self.platform_fixture()
        self.assertEqual(len(coop.RTC_SOURCES), 34)
        router = "src/rust-browser/routes/browser-effects-v2.ts"
        self.assertIn(router, coop.RTC_SOURCES)
        changed = copy.deepcopy(proof)
        changed["current_coop_rtc"]["source_hashes"].pop(router)
        with self.assertRaisesRegex(RuntimeError, "source conservation"):
            coop.validate_platform(changed, native, self.root)
        for order in range(2):
            for peer in range(2):
                changed = copy.deepcopy(proof)
                changed["current_coop_rtc"]["browser_evidence"][order]["replay"][peer].pop("sha256")
                with self.assertRaisesRegex(RuntimeError, "capsule replay"):
                    coop.validate_platform(changed, native, self.root)

    def test_public_retry_policy_requires_all_three_exact_browser_identities(self):
        self.install()
        self.assertEqual(len(coop.BROWSER_IDS), 3)
        self.assertEqual(coop.BROWSER_IDS[-1], coop.PUBLIC_RETRY_ID)
        self.assertEqual(coop.select_scope(self.config, [], self.root), (False, True))
        for ids in (coop.BROWSER_IDS[:2], [*coop.BROWSER_IDS[:2], "renamed public retry"],
                    [*coop.BROWSER_IDS[:2], coop.BROWSER_IDS[0]], list(reversed(coop.BROWSER_IDS))):
            changed = copy.deepcopy(self.config)
            changed["current_coop_startup_focus"]["browser_ids"] = ids
            with self.assertRaisesRegex(RuntimeError, "policy differs"):
                coop.select_scope(changed, [], self.root)

    def test_three_browser_journeys_preserve_full_and_compact_proof_references(self):
        proof, native = self.platform_fixture()
        before = copy.deepcopy(proof)
        coop.validate_platform(proof, native, self.root)
        native["current_coop_entry"] = {"retained": "independently validated entry proof"}
        compact = coop.aggregate_reference(native, proof, "1" * 64, "2" * 64)["current_coop_startup"]
        self.assertEqual(proof, before)
        self.assertEqual((compact["kernel_tests"], compact["entry_tests"], compact["rtc_tests"],
                          compact["replay_workers"], compact["public_retry_workers"]), (8, 2, 3, 4, 6))
        self.assertEqual(compact["native_manifest_sha256"], "1" * 64)
        self.assertEqual(compact["platform_manifest_sha256"], "2" * 64)
        self.assertEqual(compact["entry_evidence_sha256"], coop.object_hash(native["current_coop_entry"]))
        self.assertEqual(compact["rtc_evidence_sha256"], coop.object_hash(proof["current_coop_rtc"]))
        self.assertEqual(compact["public_retry_evidence_sha256"],
                         coop.object_hash(proof["current_coop_rtc"]["browser_evidence"][2]))
        self.assertLess(len(json.dumps(compact)), 1024)
        self.assertLess(len(json.dumps(proof)), 65536)

    def test_platform_rejects_every_missing_or_renamed_browser_journey(self):
        proof, native = self.platform_fixture()
        for index in range(3):
            changed = copy.deepcopy(proof)
            changed["current_coop_rtc"]["browser_evidence"].pop(index)
            with self.assertRaises(RuntimeError):
                coop.validate_platform(changed, native, self.root)
            changed = copy.deepcopy(proof)
            changed["current_coop_rtc"]["tests"]["ids"][index] += " renamed"
            with self.assertRaises(RuntimeError):
                coop.validate_platform(changed, native, self.root)
        for field, bad in (("passed", 2), ("passed", True), ("failed", 1), ("skipped", 1)):
            changed = copy.deepcopy(proof)
            changed["current_coop_rtc"]["tests"][field] = bad
            with self.assertRaises(RuntimeError):
                coop.validate_platform(changed, native, self.root)

    def test_public_retry_rejects_foreign_bindings_and_non_strict_top_level_facts(self):
        proof, native = self.platform_fixture()
        fields = ("source_sha", "worker_sha256", "glue_sha256", "wasm_sha256",
                  "content_sha256", "setup_manifest_sha256")
        mutations = [lambda value, field=field: value.update({field: "0" * 64}) for field in fields]
        mutations += [lambda value, field=field, bad=bad: value.update({field: bad})
                      for field, bad in (("actual_workers", 5), ("actual_workers", True),
                          ("disposed_workers", 5), ("disposed_workers", 6.0), ("generation", True),
                          ("generation", 2), ("schema_version", True), ("settled_retry_noop", False),
                          ("recovery", "synthetic_restore"))]
        mutations += [lambda value: value.pop("peers"), lambda value: value.update(extra=True)]
        for mutate in mutations:
            changed = copy.deepcopy(proof)
            mutate(changed["current_coop_rtc"]["browser_evidence"][2])
            with self.assertRaises(RuntimeError):
                coop.validate_platform(changed, native, self.root)

    def test_public_retry_requires_both_actual_restore_stages_for_each_peer(self):
        proof, native = self.platform_fixture()
        for peer in range(2):
            for stage in range(2):
                for field, bad in (("exact_restore", False), ("preconnection_retry_rejected", False),
                                   ("phase", "renamed"), ("exact_restore", 1)):
                    changed = copy.deepcopy(proof)
                    changed["current_coop_rtc"]["browser_evidence"][2]["peers"][peer]["stages"][stage][field] = bad
                    with self.assertRaises(RuntimeError):
                        coop.validate_platform(changed, native, self.root)
                changed = copy.deepcopy(proof)
                changed["current_coop_rtc"]["browser_evidence"][2]["peers"][peer]["stages"].pop(stage)
                with self.assertRaises(RuntimeError):
                    coop.validate_platform(changed, native, self.root)

    def test_public_retry_rejects_wire_snapshot_and_raw_input_conservation_mutants(self):
        proof, native = self.platform_fixture()
        for peer in range(2):
            for field, bad in (("checkpoint_bytes", 0), ("before_bytes", 16777217),
                               ("after_bytes", True), ("proposal_bytes", 16385),
                               ("receipt_bytes", 1048577), ("frame_bytes", 1),
                               ("sent", True), ("received", 0), ("original_raw_inputs", 3),
                               ("restored_raw_inputs", 2), ("original_presentations", 0),
                               ("presentations", 4), ("exact_frames", False), ("ownership_verified", False),
                               ("host_snapshot_conserved", peer == 1), ("proposal_sha256", "bad"),
                               ("receipt_sha256", "0" * 64), ("lifecycle_sha256", "0" * 64),
                               ("ledger_sha256", "0" * 64), ("role", "renamed")):
                changed = copy.deepcopy(proof)
                changed["current_coop_rtc"]["browser_evidence"][2]["peers"][peer][field] = bad
                with self.assertRaises(RuntimeError):
                    coop.validate_platform(changed, native, self.root)
            changed = copy.deepcopy(proof)
            row = changed["current_coop_rtc"]["browser_evidence"][2]["peers"][peer]
            row["checkpoint_sha256"] = row["before_sha256"]
            with self.assertRaises(RuntimeError):
                coop.validate_platform(changed, native, self.root)
        for peer, key in ((0, "0" * 64), (1, proof["current_coop_rtc"]["browser_evidence"][2]["peers"][1]["before_sha256"])):
            changed = copy.deepcopy(proof)
            changed["current_coop_rtc"]["browser_evidence"][2]["peers"][peer]["after_sha256"] = key
            with self.assertRaises(RuntimeError):
                coop.validate_platform(changed, native, self.root)

    def test_public_retry_binds_current_proposal_source_and_detects_post_execution_changes(self):
        proof, native = self.platform_fixture()
        path = "rust/crates/er-kernel/src/current_proposal_v7.rs"
        self.assertIn(path, coop.RTC_SOURCES)
        self.assertEqual(len(coop.RTC_SOURCES), len(set(coop.RTC_SOURCES)))
        for missing in (True, False):
            changed = copy.deepcopy(proof)
            if missing:
                changed["current_coop_rtc"]["source_hashes"].pop(path)
            else:
                changed["current_coop_rtc"]["source_hashes"][path] = "0" * 64
            with self.assertRaisesRegex(RuntimeError, "source conservation"):
                coop.validate_platform(changed, native, self.root)
        (self.root / path).write_text("changed actual proposal owner after execution\n")
        with self.assertRaisesRegex(RuntimeError, "source conservation"):
            coop.validate_platform(proof, native, self.root)

    def test_platform_adapter_rejects_old_producer_before_running_or_mutating_state(self):
        import os
        import sys
        from types import SimpleNamespace
        from unittest.mock import patch
        before = dict(os.environ)
        for ids, sources in ((coop.BROWSER_IDS[:2], coop.RTC_SOURCES),
                             ([*coop.BROWSER_IDS[:2], "renamed"], coop.RTC_SOURCES),
                             (coop.BROWSER_IDS, coop.RTC_SOURCES[:-1]),
                             (coop.BROWSER_IDS, [*coop.RTC_SOURCES[:-1], coop.RTC_SOURCES[0]])):
            producer = SimpleNamespace(IDS=list(ids), SOURCES=list(sources), ROOT="unchanged")
            with patch.dict(sys.modules, {"m9e_coop_rtc_diagnostic": producer}):
                with self.assertRaisesRegex(RuntimeError, "exact three browser identities or source inventory"):
                    coop.execute_platform(None, {}, {})
            self.assertEqual(producer.ROOT, "unchanged")
            self.assertFalse(hasattr(producer, "FULL"))
            self.assertEqual(dict(os.environ), before)

    def test_existing_fifth_lane_owns_whole_query_and_campaign_with_exact_disjoint_membership(self):
        import m9e_phases as phases
        import m9e_coop_campaign as campaign
        inventory = [{"crate": crate, "target": target, "ids": list(ids), "historical_excluded_ids": []}
                     for (crate, target), ids in ((phases.STATE_QUERY_TARGET, phases.STATE_QUERY_TEST_IDS[:1]),
                         (phases.STATE_QUERY_WORKER_TARGET, phases.STATE_QUERY_TEST_IDS[1:]),
                         (campaign.TARGET, campaign.IDS), (("er-other", phases.STATE_QUERY_TARGET[1]), ["decoy"]))]
        import m9e_feedback as feedback
        for crate, target in (("er-cli", "m9e_current_coop_rebind"), ("er-lab", "current_worker_rebind_v2")):
            inventory.append({"crate": crate, "target": target,
                              "ids": list(feedback.OWNED_FOUNDATION_TEST_IDS[crate + ":" + target]),
                              "historical_excluded_ids": []})
        original = copy.deepcopy(inventory)
        expected_e = {phases.STATE_QUERY_TARGET, campaign.TARGET,
                      ("er-cli", "m9e_current_coop_rebind")}
        self.assertEqual(phases.LANE_E_TARGETS, expected_e)
        self.assertNotIn(phases.STATE_QUERY_TARGET, phases.LANE_D_TARGETS)
        for rows in (inventory, list(reversed(inventory))):
            assignment = phases.partition(rows)
            self.assertEqual(set(map(tuple, assignment["e"])), expected_e)
            self.assertEqual(assignment["c"], [])
            self.assertEqual(assignment["d"], [])
            self.assertEqual(set(map(tuple, assignment["b"])), {phases.STATE_QUERY_WORKER_TARGET, ("er-lab", "current_worker_rebind_v2")})
            self.assertEqual(assignment["a"], [["er-other", phases.STATE_QUERY_TARGET[1]]])
            flat = [tuple(pair) for targets in assignment.values() for pair in targets]
            self.assertEqual(len(flat), len(set(flat)))
            self.assertEqual(set(flat), {(row["crate"], row["target"]) for row in rows})
        self.assertEqual(inventory, original)
        with self.assertRaisesRegex(RuntimeError, "duplicated"):
            phases.partition([*inventory, copy.deepcopy(inventory[0])])
        invalid = copy.deepcopy(inventory)
        invalid[0]["ids"].append(invalid[0]["ids"][0])
        with self.assertRaisesRegex(RuntimeError, "duplicated"):
            phases.partition(invalid)
