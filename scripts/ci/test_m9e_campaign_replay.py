import copy
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import m9e_campaign_replay as replay


class CampaignReplayEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        for path in [*replay.SOURCES, replay.BUNDLE]:
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(path)
        self.identity = {"product_sha": "a" * 40, "run_id": "123", "run_attempt": "1", "toolchain": "rustc test"}
        self.evidence = {"status": "passed", "source_sha": "a" * 40, "run_id": "123", "run_attempt": "1",
                         "toolchain": "rustc test", "owned_target_removed": True,
                         "source_hashes": {path: replay.digest(self.root / path) for path in replay.SOURCES},
                         "bundle_sha256": replay.digest(self.root / replay.BUNDLE),
                         "tests": {"executed": 1, "passed": 1, "failed": 0, "skipped": 0},
                         "test_artifact": {"sha256": "b" * 64, "bytes": 1234, "ids": replay.IDS,
                             "source_sha256": replay.digest(self.root / replay.TEST),
                             "profile": {"opt_level": "1", "test": True, "debug_assertions": True, "overflow_checks": True}},
                         "logs": {name: {"sha256": "c" * 64, "bytes": 1234, "elapsed_seconds": 250}
                                  for name in ("build", "execute")},
                         "campaign_replay": {"events": 7085, "segments": 3610, "presentations": 905}}
        self.proof = {"identity": self.identity, "lane": "d", "natural_campaign_replay": self.evidence,
                      "plan": {"requires_natural_campaign_witnesses": True,
                               "required_native_targets": {replay.TARGET[0]: [replay.TARGET[1]]},
                               "required_native_test_ids": {":".join(replay.TARGET): replay.IDS}},
                      "inventory": [{"crate": replay.TARGET[0], "target": replay.TARGET[1], "ids": replay.IDS,
                                     "historical_excluded_ids": []}]}

    @staticmethod
    def partition(inventory):
        return {"d": [list(replay.TARGET)]}

    def test_complete_evidence_is_conserved(self):
        original = copy.deepcopy(self.proof)
        replay.validate_lane(self.proof, self.root, self.partition)
        self.assertEqual(self.proof, original)
        other = copy.deepcopy(self.proof)
        other["lane"] = "b"
        del other["natural_campaign_replay"]
        replay.validate_lane(other, self.root, self.partition)

    def test_wrong_profile_and_artifact_are_rejected(self):
        for key, value in (("opt_level", "0"), ("test", False), ("debug_assertions", False), ("overflow_checks", False)):
            with self.subTest(key=key):
                evidence = copy.deepcopy(self.evidence)
                evidence["test_artifact"]["profile"][key] = value
                with self.assertRaisesRegex(RuntimeError, "artifact"):
                    replay.validate_evidence(evidence, self.identity, self.root)
        for key, value in (("ids", []), ("bytes", True), ("sha256", "bad"), ("source_sha256", "f" * 64)):
            evidence = copy.deepcopy(self.evidence)
            evidence["test_artifact"][key] = value
            with self.assertRaisesRegex(RuntimeError, "artifact"):
                replay.validate_evidence(evidence, self.identity, self.root)

    def test_wrong_run_source_and_cleanup_are_rejected(self):
        for key, value in (("source_sha", "f" * 40), ("run_id", "124"), ("run_attempt", "2"),
                           ("toolchain", "other"), ("owned_target_removed", False), ("status", "failed")):
            evidence = copy.deepcopy(self.evidence)
            evidence[key] = value
            with self.assertRaisesRegex(RuntimeError, "identity"):
                replay.validate_evidence(evidence, self.identity, self.root)
        (self.root / replay.TEST).write_text("changed after build")
        with self.assertRaisesRegex(RuntimeError, "source/content"):
            replay.validate_evidence(self.evidence, self.identity, self.root)

    def test_missing_extra_and_wrong_lane_proofs_are_rejected(self):
        for mutate in (lambda proof: proof.pop("natural_campaign_replay"),
                       lambda proof: proof.update(lane="b"),
                       lambda proof: proof["plan"].update(requires_natural_campaign_witnesses=False),
                       lambda proof: proof["plan"].update(requires_natural_campaign_witnesses="true"),
                       lambda proof: proof["inventory"][0].update(ids=[]),
                       lambda proof: proof["inventory"][0].update(historical_excluded_ids=["hidden"]),
                       lambda proof: proof["plan"]["required_native_targets"].clear(),
                       lambda proof: proof["plan"]["required_native_test_ids"].clear()):
            proof = copy.deepcopy(self.proof)
            mutate(proof)
            with self.assertRaises(RuntimeError):
                replay.validate_lane(proof, self.root, self.partition)
        with self.assertRaisesRegex(RuntimeError, "ownership"):
            replay.validate_lane(self.proof, self.root, lambda inventory: {"d": []})

    def test_incomplete_or_over_budget_execution_is_rejected(self):
        for key, value in (("bytes", 16385), ("bytes", True), ("sha256", "bad"), ("elapsed_seconds", 601), ("elapsed_seconds", 0)):
            evidence = copy.deepcopy(self.evidence)
            evidence["logs"]["execute"][key] = value
            with self.assertRaisesRegex(RuntimeError, "log"):
                replay.validate_evidence(evidence, self.identity, self.root)
        for key, value in (("events", 800), ("segments", 10), ("presentations", 0), ("events", True)):
            evidence = copy.deepcopy(self.evidence)
            evidence["campaign_replay"][key] = value
            with self.assertRaisesRegex(RuntimeError, "coverage"):
                replay.validate_evidence(evidence, self.identity, self.root)

    def test_override_rejects_non_owner_before_launch(self):
        for lane, phase, ids in (("b", "native", replay.IDS), ("d", "platform", replay.IDS), ("d", "native", [])):
            with mock.patch.dict("os.environ", {"M9E_NATIVE_LANE": lane, "M9E_PHASE": phase}):
                with mock.patch("m9e_current_cost.run_bounded") as launch:
                    with self.assertRaisesRegex(RuntimeError, "native D"):
                        replay.execute(self.root, self.root, self.identity, ids, 0)
                    launch.assert_not_called()
