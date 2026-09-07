import copy
import unittest

import m9e_feedback as feedback


class RecoveryIntegrationPolicyTests(unittest.TestCase):
    def setUp(self):
        self.config = {"current_recovery_integration": copy.deepcopy(feedback.RECOVERY_POLICY)}

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
        for key in ("paths", "replacement_test_ids", "progression_test_ids", "checkpoint_test_ids", "canonical_test_ids", "struggle_test_ids", "campaign_test_ids", "rng_test_ids", "coop_campaign_test_ids"):
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
