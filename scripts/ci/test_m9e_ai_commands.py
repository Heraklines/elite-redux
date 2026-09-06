"""Fail-closed selection policy for complete AI command ownership regressions."""
import copy
import unittest

import m9e_feedback as feedback


class AiCommandPolicyTests(unittest.TestCase):
    def setUp(self):
        self.config = {"current_ai_command_transaction_focus": copy.deepcopy(feedback.AI_COMMAND_POLICY)}

    def test_exact_product_and_partial_followup_scopes_preserve_policy(self):
        before = copy.deepcopy(self.config)
        for changed in (feedback.AI_COMMAND_PATHS, [feedback.AI_COMMAND_PATHS[0]], [feedback.AI_COMMAND_PATHS[1]]):
            self.assertEqual(feedback.select_ai_command_scope(self.config, changed), (True, True))
        self.assertEqual(self.config, before)

    def test_installed_policy_survives_unrelated_scope_without_claiming_focus(self):
        self.assertEqual(feedback.select_ai_command_scope(self.config, []), (False, True))
        self.assertEqual(feedback.select_ai_command_scope(self.config, ["rust/crates/er-web/src/host_v2.rs"]), (False, True))

    def test_changed_witness_cannot_bypass_missing_policy(self):
        self.assertEqual(feedback.select_ai_command_scope({}, [feedback.AI_COMMAND_PATHS[0]]), (False, False))
        with self.assertRaisesRegex(RuntimeError, "unmapped"):
            feedback.select_ai_command_scope({}, [feedback.AI_COMMAND_PATHS[1]])

    def test_mixed_product_delta_is_not_admitted(self):
        with self.assertRaisesRegex(RuntimeError, "unmapped"):
            feedback.select_ai_command_scope(self.config, [*feedback.AI_COMMAND_PATHS, "rust/crates/er-ai/src/authority_v2.rs"])

    def test_policy_rejects_missing_reordered_and_extra_source_or_test_ids(self):
        mutations = [lambda policy: policy["paths"].pop(),
                     lambda policy: policy["paths"].reverse(),
                     lambda policy: policy["exact_test_ids"].pop(),
                     lambda policy: policy["exact_test_ids"].reverse(),
                     lambda policy: policy["exact_test_ids"].append("unexecuted"),
                     lambda policy: policy.update(unchecked=True)]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                changed = copy.deepcopy(self.config)
                mutate(changed["current_ai_command_transaction_focus"])
                with self.assertRaisesRegex(RuntimeError, "identities"):
                    feedback.select_ai_command_scope(changed, feedback.AI_COMMAND_PATHS)
