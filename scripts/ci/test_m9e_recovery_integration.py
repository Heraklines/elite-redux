import copy
import unittest

import m9e_feedback as feedback


class RecoveryIntegrationPolicyTests(unittest.TestCase):
    def setUp(self):
        self.config = {"current_recovery_integration": copy.deepcopy(feedback.RECOVERY_POLICY)}

    def test_exact_six_path_composition_preserves_policy(self):
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
        for key in ("paths", "replacement_test_ids"):
            for operation in ("pop", "reverse", "append"):
                changed = copy.deepcopy(self.config)
                values = changed["current_recovery_integration"][key]
                if operation == "append":
                    values.append("unverified")
                else:
                    getattr(values, operation)()
                with self.assertRaisesRegex(RuntimeError, "identities"):
                    feedback.select_recovery_scope(changed, feedback.RECOVERY_PATHS)
