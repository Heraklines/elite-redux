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
                    "tests": {"passed": 2, "failed": 0, "skipped": 0, "ids": list(coop.BROWSER_IDS)},
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
                "started_bytes": 32318, "choices_sha256": "a" * 64, "started_sha256": "b" * 64})
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
        self.assertEqual(assignment["c"], [list(phases.STATE_QUERY_TARGET)])
        self.assertEqual(assignment["b"], [list(phases.STATE_QUERY_WORKER_TARGET)])
        self.assertEqual(assignment["a"], [list(coop.ENTRY_TARGET), list(coop.KERNEL_TARGET), list(phases.CONTROL_QUERY_TARGET)])
        self.assertEqual(len({tuple(pair) for targets in assignment.values() for pair in targets}), len(rows))
        self.assertEqual(sum(len(row["ids"]) for row in rows), 10)

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
