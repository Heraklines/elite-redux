import copy
import hashlib
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
