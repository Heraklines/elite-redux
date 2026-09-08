import copy
import unittest

import m9e_feedback as feedback


class RecoveryIntegrationPolicyTests(unittest.TestCase):
    def setUp(self):
        self.config = {"current_recovery_integration": copy.deepcopy(feedback.RECOVERY_POLICY)}

    def test_owned_foundations_exact_generated_composition_preserves_all66_paths(self):
        import m9e_generated_xp as generated
        config = copy.deepcopy(self.config)
        config[generated.POLICY_KEY] = copy.deepcopy(generated.POLICY)
        paths = [*feedback.RECOVERY_PATHS, *generated.PATHS]
        config["current_recovery_integration"]["paths"] = paths
        original = copy.deepcopy(config)
        self.assertEqual(len(paths), 93)
        self.assertEqual(len(set(paths)), 92)
        self.assertTrue(set(feedback.OWNED_FOUNDATION_PATHS).issubset(paths))
        for changed in (paths, list(reversed(paths))):
            self.assertEqual(feedback.select_recovery_scope(config, changed), (True, True))
        self.assertEqual(config, original)

    def test_owned_foundation_new_sources_reject_partial_extra_and_duplicate_scope(self):
        for path in feedback.OWNED_FOUNDATION_PATHS:
            for changed in ([name for name in feedback.RECOVERY_PATHS if name != path],
                            [*feedback.RECOVERY_PATHS, path], [*feedback.RECOVERY_PATHS, "rust/unreviewed.rs"]):
                with self.subTest(path=path, changed=len(changed)):
                    with self.assertRaisesRegex(RuntimeError, "unmapped"):
                        feedback.select_recovery_scope(self.config, changed)

    def test_owned_foundation_sources_cannot_hide_inside_legacy_lint_overlap(self):
        for path in ("rust/crates/er-state/src/current_experience_owner.rs",
                     "rust/crates/er-progression/src/current_friendship.rs",
                     "rust/crates/er-kernel/src/current_coop_rebind_v7.rs"):
            for legacy in (feedback.AI_COMMAND_PATHS, feedback.AI_DAMAGE_QUERY_LINT_REPAIR_PATHS):
                with self.subTest(path=path):
                    with self.assertRaisesRegex(RuntimeError, "unmapped"):
                        feedback.select_recovery_scope(self.config, [*legacy, path])

    def test_owned_foundation_policy_rejects_each_missing_duplicate_or_substituted_id(self):
        for key, ids in feedback.OWNED_FOUNDATION_TEST_IDS.items():
            for replacement in (ids[:-1], [*ids, ids[0]], ["unreviewed", *ids[1:]]):
                config = copy.deepcopy(self.config)
                config["current_recovery_integration"]["owned_foundation_test_ids"][key] = replacement
                with self.assertRaisesRegex(RuntimeError, "identities"):
                    feedback.select_recovery_scope(config, feedback.RECOVERY_PATHS)

    def test_exact_thirty_one_path_composition_preserves_policy(self):
        original = copy.deepcopy(self.config)
        for paths in (feedback.RECOVERY_PATHS, list(reversed(feedback.RECOVERY_PATHS))):
            self.assertEqual(feedback.select_recovery_scope(self.config, paths), (True, True))
        self.assertEqual(self.config, original)

    def test_unrelated_followup_keeps_installed_replacement_obligation(self):
        for paths in ([], feedback.AI_COMMAND_PATHS, ["rust/crates/er-game/src/m9e_runtime_v6.rs"]):
            self.assertEqual(feedback.select_recovery_scope(self.config, paths), (False, True))

    def test_new_replacement_witness_cannot_bypass_complete_integration(self):
        for paths in ([feedback.RECOVERY_PATHS[3]], feedback.RECOVERY_PATHS[:-1],
                      [*feedback.RECOVERY_PATHS, feedback.RECOVERY_PATHS[0]],
                      [*feedback.RECOVERY_PATHS, "rust/unrelated.rs"]):
            with self.assertRaisesRegex(RuntimeError, "unmapped"):
                feedback.select_recovery_scope(self.config, paths)

    def test_missing_policy_rejects_new_witness(self):
        with self.assertRaisesRegex(RuntimeError, "unmapped"):
            feedback.select_recovery_scope({}, feedback.RECOVERY_PATHS)
        self.assertEqual(feedback.select_recovery_scope({}, feedback.AI_COMMAND_PATHS), (False, False))

    def test_policy_rejects_missing_reordered_or_extra_source_and_test_ids(self):
        for key in ("paths", "replacement_test_ids", "progression_test_ids", "checkpoint_test_ids", "canonical_test_ids", "struggle_test_ids", "campaign_test_ids", "rng_test_ids", "coop_campaign_test_ids", "coop_receipt_test_ids"):
            for operation in ("pop", "reverse", "append"):
                changed = copy.deepcopy(self.config)
                values = changed["current_recovery_integration"][key]
                if isinstance(values, dict):
                    values = values["er_rng" if key == "rng_test_ids" else "er-progression"]
                if operation == "reverse" and len(values) == 1:
                    values[0] = "unverified"
                elif operation == "append":
                    values.append("unverified")
                else:
                    getattr(values, operation)()
                with self.assertRaisesRegex(RuntimeError, "identities"):
                    feedback.select_recovery_scope(changed, feedback.RECOVERY_PATHS)

    def test_new_progression_witness_cannot_bypass_complete_integration(self):
        for config in ({}, self.config):
            for paths in ([feedback.PROGRESSION_PATHS[1]], feedback.PROGRESSION_PATHS,
                          [*feedback.RECOVERY_PATHS, "rust/unrelated.rs"],
                          feedback.RECOVERY_PATHS[:-2] + feedback.PROGRESSION_PATHS[1:]):
                with self.assertRaisesRegex(RuntimeError, "unmapped"):
                    feedback.select_recovery_scope(config, paths)

    def test_new_checkpoint_witness_cannot_bypass_complete_integration(self):
        for config in ({}, self.config):
            for paths in ([feedback.CHECKPOINT_PATHS[1]], feedback.CHECKPOINT_PATHS,
                          [*feedback.RECOVERY_PATHS, "rust/unrelated.rs"]):
                with self.assertRaisesRegex(RuntimeError, "unmapped"):
                    feedback.select_recovery_scope(config, paths)

    def test_new_struggle_witness_cannot_bypass_complete_integration(self):
        for config in ({}, self.config):
            for paths in ([feedback.STRUGGLE_PATHS[3]], feedback.STRUGGLE_PATHS,
                          [*feedback.RECOVERY_PATHS, "rust/unrelated.rs"]):
                with self.assertRaisesRegex(RuntimeError, "unmapped"):
                    feedback.select_recovery_scope(config, paths)

    def test_campaign_witnesses_cannot_bypass_complete_integration(self):
        for config in ({}, self.config):
            for paths in ([path] for path in [*feedback.CAMPAIGN_PATHS[2:6], feedback.CAMPAIGN_PATHS[7], feedback.COOP_CAMPAIGN_PATH]):
                with self.assertRaisesRegex(RuntimeError, "unmapped"):
                    feedback.select_recovery_scope(config, paths)
            with self.assertRaisesRegex(RuntimeError, "unmapped"):
                feedback.select_recovery_scope(config, [*feedback.RECOVERY_PATHS, "rust/unrelated.rs"])

    def test_rng_sources_cannot_bypass_complete_integration(self):
        for config in ({}, self.config):
            for path in feedback.RNG_PATHS:
                with self.assertRaisesRegex(RuntimeError, "unmapped"):
                    feedback.select_recovery_scope(config, [path])

    def test_rng_policy_cannot_omit_or_duplicate_any_target_identity(self):
        for target in feedback.RNG_TEST_IDS:
            for operation in ("remove_target", "remove_id", "duplicate_id"):
                config = copy.deepcopy(self.config)
                ids = config["current_recovery_integration"]["rng_test_ids"]
                if operation == "remove_target":
                    del ids[target]
                elif operation == "remove_id":
                    ids[target].pop()
                else:
                    ids[target].append(ids[target][0])
                with self.assertRaisesRegex(RuntimeError, "identities"):
                    feedback.select_recovery_scope(config, feedback.RECOVERY_PATHS)

    def test_receipt_witness_cannot_bypass_complete_integration(self):
        for config in ({}, self.config):
            for paths in ([feedback.COOP_RECEIPT_PATH], feedback.RECOVERY_PATHS[:-1],
                          [*feedback.RECOVERY_PATHS, "rust/unrelated.rs"]):
                with self.assertRaisesRegex(RuntimeError, "unmapped"):
                    feedback.select_recovery_scope(config, paths)

    def test_receipt_policy_rejects_missing_duplicate_or_renamed_ids(self):
        for ids in ([], feedback.COOP_RECEIPT_IDS[:1],
                    [feedback.COOP_RECEIPT_IDS[0]] * 2,
                    [feedback.COOP_RECEIPT_IDS[0], "unverified"],
                    [feedback.COOP_RECEIPT_IDS[0]] * 3,
                    [*feedback.COOP_RECEIPT_IDS[:2], "unverified"]):
            config = copy.deepcopy(self.config)
            config["current_recovery_integration"]["coop_receipt_test_ids"] = ids
            with self.assertRaisesRegex(RuntimeError, "identities"):
                feedback.select_recovery_scope(config, feedback.RECOVERY_PATHS)

    def test_xp_sources_cannot_bypass_complete_reviewed_composition(self):
        self.assertEqual(len(feedback.XP_PATHS), len(set(feedback.XP_PATHS)))
        for config in ({}, self.config):
            for path in feedback.XP_PATHS:
                with self.assertRaisesRegex(RuntimeError, "unmapped"):
                    feedback.select_recovery_scope(config, [path])
            for paths in (feedback.RECOVERY_PATHS[:-1],
                          [*feedback.RECOVERY_PATHS[:-1], feedback.RECOVERY_PATHS[0]],
                          [*feedback.RECOVERY_PATHS, "test/kernel-fixtures/m9/unreviewed.ts"]):
                with self.assertRaisesRegex(RuntimeError, "unmapped"):
                    feedback.select_recovery_scope(config, paths)

        legacy_pair = ["rust/crates/er-battle/src/m7_resolver.rs",
                       "rust/crates/er-game/tests/m9e_damage_query.rs"]
        shared = set(feedback.XP_PATHS) & set(feedback.AI_DAMAGE_QUERY_LINT_REPAIR_PATHS)
        self.assertEqual(shared, {"rust/crates/er-content-compiler/src/m9e_progression.rs"})
        for config in ({}, self.config):
            for path in set(feedback.XP_PATHS) - shared:
                for legacy in (legacy_pair, feedback.AI_DAMAGE_QUERY_LINT_REPAIR_PATHS):
                    with self.assertRaisesRegex(RuntimeError, "unmapped"):
                        feedback.select_recovery_scope(config, [*legacy, path])
            # Returning False defers validation; it never admits a recovery cut.
            self.assertFalse(feedback.select_recovery_scope(config, [*legacy_pair, *shared])[0])
            self.assertFalse(feedback.select_recovery_scope(config, feedback.AI_DAMAGE_QUERY_LINT_REPAIR_PATHS)[0])

    def test_xp_policy_rejects_omitted_renamed_or_duplicated_target_identities(self):
        for target, required in feedback.XP_TEST_IDS.items():
            for operation in ("target", "id", "rename", "duplicate"):
                config = copy.deepcopy(self.config)
                maps = config["current_recovery_integration"]["xp_test_ids"]
                if operation == "target":
                    del maps[target]
                elif operation == "id":
                    maps[target].pop()
                elif operation == "rename":
                    maps[target][0] = "unverified_xp_identity"
                else:
                    maps[target].append(required[0])
                with self.assertRaisesRegex(RuntimeError, "identities"):
                    feedback.select_recovery_scope(config, feedback.RECOVERY_PATHS)
