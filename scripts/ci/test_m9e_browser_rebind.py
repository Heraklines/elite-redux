"""Reject incomplete or substituted current Browser qualification evidence."""
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import m9e_browser_rebind as rebind


class BrowserRebindEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.fixture = json.loads((Path(__file__).with_name("fixtures") / "m9e-browser-rebind-proof.json").read_text())
        self.sha = self.fixture["provenance"]["source_sha"]
        self.value = self.fixture["tests"]["cases"][0]["evidence"]

    def check(self, value):
        rebind.validate_rebind(value, self.fixture["worker"], self.sha, self.fixture["setup_manifest_sha256"])

    def test_real_seven_worker_fixture_requires_every_disposal_handoff_and_replay(self):
        self.check(self.value)
        for key in ("observed_worker_count", "actual_workers", "disposed_workers", "transcript_controls"):
            for replacement in (0, True, self.value[key] - 1):
                with self.subTest(key=key, replacement=replacement):
                    value = copy.deepcopy(self.value)
                    value[key] = replacement
                    with self.assertRaises(RuntimeError):
                        self.check(value)
        for key in ("midphase_replay", "final_replay", "deleted_control_rejected", "duplicate_receipt_exact",
                    "retry_snapshot_conserved", "startup_handoff_verified"):
            for replacement in (False, 1, None):
                with self.subTest(key=key, replacement=replacement):
                    value = copy.deepcopy(self.value)
                    value[key] = replacement
                    with self.assertRaises(RuntimeError):
                        self.check(value)

    def test_peer_frontiers_and_current_built_cohort_cannot_be_substituted(self):
        for key, replacement in (("source_sha", "0" * 40), ("setup_manifest_sha256", "0" * 64),
                                 ("worker_sha256", "0" * 64), ("content_sha256", "0" * 64),
                                 ("rebind_attempts", [9, 10]), ("rebind_attempts", [10, True]),
                                 ("startup_handoff_snapshots", []), ("raw_inputs", [0, 1]),
                                 ("generation", 1), ("known_rejections", False)):
            with self.subTest(key=key):
                value = copy.deepcopy(self.value)
                value[key] = replacement
                with self.assertRaises(RuntimeError):
                    self.check(value)
        value = copy.deepcopy(self.value)
        del value["final_replay"]
        with self.assertRaises(RuntimeError):
            self.check(value)

    def proof(self):
        binding = {"source_sha": self.sha, "source_hashes": {
            rebind.SPEC: self.fixture["tests"]["cases"][0]["source_sha256"]}}
        identity = {"product_sha": self.sha, "run_id": "current-test-run", "run_attempt": "1"}
        plan = {"requires_owned_foundations": True, "current_recovery_integration": True,
                "requires_current_browser_rebind": True, "current_browser_rebind_binding": binding,
                "requires_browser_worker": True, "requires_current_coop_startup": True}
        value = {"status": "passed", "source_sha": self.sha, "run_id": identity["run_id"], "run_attempt": "1",
                 "source_binding": binding, "tests": copy.deepcopy(self.fixture["tests"]),
                 "execution_argv": ["pnpm", "exec", "playwright", "test", "--config", "playwright.rust-browser.config.ts",
                                    "--project=chromium", "--workers=1", "--retries=0", "--reporter=json", "--output",
                                    "/tmp/browser-rebind-test/results", rebind.SPEC],
                 "worker_manifest_sha256": self.fixture["worker"]["manifest_sha256"],
                 "setup_manifest_sha256": self.fixture["setup_manifest_sha256"], "assets_rehashed": True}
        proof = {"current_browser_rebind": value, "browser_worker_assets": self.fixture["worker"],
                 "current_coop_rtc": {"setup_manifest_sha256": self.fixture["setup_manifest_sha256"]}}
        return proof, {"identity": identity, "plan": plan}, binding

    def test_complete_integration_cannot_drop_requirement_or_actual_witness(self):
        proof, native, binding = self.proof()
        with patch.object(rebind, "source_binding", return_value=binding):
            rebind.validate_platform(proof, native, Path("/tmp"))
            for key in ("requires_current_browser_rebind", "requires_browser_worker", "requires_current_coop_startup"):
                changed = copy.deepcopy(native)
                changed["plan"][key] = False
                with self.subTest(key=key), self.assertRaises(RuntimeError):
                    rebind.validate_platform(proof, changed, Path("/tmp"))
            changed = copy.deepcopy(proof)
            del changed["current_browser_rebind"]
            with self.assertRaises(RuntimeError):
                rebind.validate_platform(changed, native, Path("/tmp"))

    def test_current_run_identity_whole_case_and_original_cap_are_mandatory(self):
        proof, native, binding = self.proof()
        for field, replacement in (("run_id", "old-run"), ("run_attempt", "2"),
                                   ("source_sha", "0" * 40), ("assets_rehashed", False),
                                   ("execution_argv", ["pnpm", "exec", "playwright", "test", "--grep", "partial"])):
            changed = copy.deepcopy(proof)
            changed["current_browser_rebind"][field] = replacement
            with patch.object(rebind, "source_binding", return_value=binding), self.subTest(field=field), self.assertRaises(RuntimeError):
                rebind.validate_platform(changed, native, Path("/tmp"))
        for field, replacement in (("duration_ms", 300001), ("source_sha256", "0" * 64), ("attachment_bytes", 16385)):
            changed = copy.deepcopy(proof)
            changed["current_browser_rebind"]["tests"]["cases"][0][field] = replacement
            with patch.object(rebind, "source_binding", return_value=binding), self.subTest(field=field), self.assertRaises(RuntimeError):
                rebind.validate_platform(changed, native, Path("/tmp"))

    def test_duplicate_json_keys_and_nonfinite_evidence_fail_closed(self):
        for raw in (b'{"generation":1,"generation":2}', b'{"count":NaN}', b'{"count":Infinity}'):
            with self.subTest(raw=raw), self.assertRaises(RuntimeError):
                rebind.strict_json(raw)


if __name__ == "__main__":
    unittest.main()
