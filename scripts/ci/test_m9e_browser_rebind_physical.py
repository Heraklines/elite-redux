"""Causal rejection tests over the complete actual qualified RTC attachments."""
import copy
import hashlib
import json
from pathlib import Path
import unittest

import m9e_browser_rebind_physical as physical


class PhysicalRebindProofTests(unittest.TestCase):
    def setUp(self):
        raw = (Path(__file__).parent / "fixtures/m9e-browser-rebind-physical-proof.json").read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), "e584f12674caa61cf5dac327266c73ff8cd62444bb6bd13dcba152c3e268ba97")
        self.fixture = json.loads(raw)
        self.assertEqual(self.fixture["source_sha"], "962ea0eebd06a901559450219238176d0b681b64")
        self.assertEqual(self.fixture["run_id"], "34300289574")
        self.assertEqual(self.fixture["report_sha256"], "22f64a8e0be7c2bfe763f000318516eeef2b21b3022f75d70ae8a22bff3da2b3")

    def validate(self, spec, value):
        physical.validate_attachment(spec, value, self.fixture["worker"], self.fixture["rtc"],
                                     self.fixture["source_sha"], self.fixture["setup_hash"])

    def test_all_three_actual_complete_qualified_receipts_are_accepted(self):
        self.assertEqual(set(self.fixture["cases"]), set(physical.CASES))
        import m9e_phases
        self.assertEqual(set(m9e_phases.RTC_SOURCE_PATHS),
                         set(self.fixture["rtc"]["manifest"]["source_hashes"]))
        for spec, value in self.fixture["cases"].items():
            with self.subTest(spec=spec):
                before = copy.deepcopy(value)
                self.validate(spec, value)
                self.assertEqual(value, before)

    def test_replay_control_removal_or_wrong_generation_is_rejected_in_every_case(self):
        for spec, original in self.fixture["cases"].items():
            for key, changed in (("deleted_control_rejected", False), ("generation", 1), ("duplicate_receipt_exact", False)):
                with self.subTest(spec=spec, key=key), self.assertRaises(RuntimeError):
                    self.validate(spec, {**original, key: changed})

    def test_missing_wire_delivery_or_unclosed_physical_pair_is_rejected(self):
        for spec in (path for path in physical.CASES if path != physical.OWNER):
            for key, value in (("received", [5, 6]), ("sent", [6, 5]), ("closed", False), ("selected_pairs", 1)):
                changed = copy.deepcopy(self.fixture["cases"][spec])
                changed["physical_carriers"][1][key] = value
                with self.subTest(spec=spec, key=key), self.assertRaises(RuntimeError):
                    self.validate(spec, changed)

    def test_transport_teardown_must_settle_every_queue_and_deliver_every_frame(self):
        for key, value in (("sendPending", 1), ("receivePending", 1), ("sendBytes", 1), ("receiveBytes", 1),
                           ("bufferedAmount", 1), ("kernelDeliveredFrames", 5), ("receivedFrames", 5),
                           ("sentFrames", 5), ("closed", False), ("maximumObservedFrameBytes", 262145)):
            changed = copy.deepcopy(self.fixture["cases"][physical.TRANSPORT])
            changed["transport_evidence"][1]["endpoints"][0][key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                self.validate(physical.TRANSPORT, changed)

    def test_owner_requires_automatic_routing_and_all_lifecycle_conservation(self):
        for key, value in (("automatic_rebind_controls", [4, 3]), ("connected_callbacks", [1, 0]),
                           ("disconnected_callbacks", [1, 0]), ("live_begin_rejected", False),
                           ("checkpoint_handoff_exact", False), ("full_replay", False),
                           ("duplicate_receipt_delivered", False), ("final_lifecycle_equal", False)):
            changed = {**self.fixture["cases"][physical.OWNER], key: value}
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                self.validate(physical.OWNER, changed)

    def test_owner_and_transport_evidence_cannot_mix_source_or_built_cohorts(self):
        for spec, original in self.fixture["cases"].items():
            for key in ("source_sha", "manifest_sha256", "worker_sha256", "content_sha256", "setup_manifest_sha256"):
                with self.subTest(spec=spec, key=key), self.assertRaises(RuntimeError):
                    self.validate(spec, {**original, key: "0" * len(original[key])})
        for key in ("rtc_manifest_sha256", "owner_worker_path"):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                self.validate(physical.OWNER, {**self.fixture["cases"][physical.OWNER], key: "wrong"})

    def test_boolean_or_extra_counter_fields_cannot_impersonate_actual_numbers(self):
        changed = copy.deepcopy(self.fixture["cases"][physical.TRANSPORT])
        changed["transport_evidence"][0]["endpoints"][0]["sendPending"] = False
        with self.assertRaises(RuntimeError):
            self.validate(physical.TRANSPORT, changed)
        changed = copy.deepcopy(self.fixture["cases"][physical.OWNER])
        changed["connected_callbacks"] = [True, True]
        with self.assertRaises(RuntimeError):
            self.validate(physical.OWNER, changed)
        changed = {**self.fixture["cases"][physical.OWNER], "ignored_failure": True}
        with self.assertRaises(RuntimeError):
            self.validate(physical.OWNER, changed)
