"""Metadata/runner-contract tests using five tiny byte vectors, never game fixtures."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import m9e_feedback as feedback
import m9e_generated_xp as generated
from m9e_current_proposal import merge_targets


class GeneratedXpTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="m9e-generated-metadata-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.original_files = copy.deepcopy(generated.FILES)
        self.small = {}
        self.bytes = {}
        for index, relative in enumerate(generated.PATHS):
            data = f"small verifier vector {index}\n".encode()
            self.bytes[relative] = data
            self.small[relative] = {
                "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                "git_blob": hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()}
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.config = {generated.POLICY_KEY: copy.deepcopy(generated.POLICY)}
        config_path = self.root / "scripts/ci/m9e-targets.json"
        config_path.parent.mkdir(parents=True)
        config_path.write_text(json.dumps(self.config))

    def capture(self, args, cwd):
        self.assertEqual(args, ["git", "ls-tree", "-r", "HEAD", "--", *generated.PATHS])
        self.assertEqual(cwd, self.root)
        return "\n".join(f"100644 blob {row['git_blob']}\t{path}" for path, row in self.small.items())

    def small_files(self):
        return patch.object(generated, "FILES", self.small)

    def plan(self):
        return {"packages": ["er-game"], "execution_scope": {"er-game": ["existing"]},
                "required_native_targets": {"er-game": ["existing"]},
                "required_native_test_ids": {"er-game:existing": ["old_witness"]}}

    def native(self):
        plan = self.plan()
        generated.apply_plan(self.config, plan, self.root, self.capture, merge_targets)
        identity = {"files": {"content": generated.FILES[generated.MANIFEST]["sha256"]},
                    "generated_fixture_inputs": generated.bind(self.root, self.capture)}
        inventory = [{"crate": key.split(":")[0], "target": key.split(":")[1],
                      "ids": list(ids), "historical_excluded_ids": []}
                     for key, ids in generated.PACK_IDS.items()]
        return plan, identity, inventory

    def test_published_five_policy_rejects_missing_foreign_mixed_and_wrong_typed_metadata(self):
        self.assertEqual(len(generated.PATHS), 7)
        self.assertEqual(len(set(generated.PATHS)), 7)
        self.assertTrue(generated.enabled(self.config))
        self.assertFalse(generated.enabled({}))
        for path in generated.PATHS:
            for field, bad in (("bytes", True), ("bytes", 1.0), ("bytes", 1),
                               ("sha256", "0" * 64), ("git_blob", "0" * 40)):
                value = copy.deepcopy(self.config)
                value[generated.POLICY_KEY]["files"][path][field] = bad
                with self.subTest(path=path, field=field, bad=bad), self.assertRaises(RuntimeError):
                    generated.enabled(value)
            value = copy.deepcopy(self.config)
            del value[generated.POLICY_KEY]["files"][path]
            with self.assertRaises(RuntimeError):
                generated.enabled(value)
        for field, bad in (("schema_version", True), ("publication_commit", "0" * 40),
                           ("publication_tree", "0" * 40), ("export_run", "other"),
                           ("extra", "unreviewed")):
            value = copy.deepcopy(self.config)
            value[generated.POLICY_KEY][field] = bad
            with self.assertRaises(RuntimeError):
                generated.enabled(value)
        receipt = generated.expected_binding()
        self.assertLessEqual(len(generated.encoded(receipt)), 192)
        generated.validate_binding(receipt)
        receipt["verification"] = "metadata-only"
        with self.assertRaises(RuntimeError):
            generated.validate_binding(receipt)

    def test_exact_generated_47_cut_preserves_legacy_42_and_rejects_partial_or_extra_paths(self):
        legacy = {"current_recovery_integration": copy.deepcopy(feedback.RECOVERY_POLICY)}
        self.assertEqual(feedback.select_recovery_scope(legacy, feedback.RECOVERY_PATHS), (True, True))
        paths = [*feedback.RECOVERY_PATHS, *generated.PATHS]
        config = {**copy.deepcopy(legacy), **copy.deepcopy(self.config)}
        config["current_recovery_integration"]["paths"] = paths
        self.assertEqual(len(paths), 111)
        self.assertEqual(len(set(paths)), 111)
        self.assertEqual(feedback.select_recovery_scope(config, paths), (True, True))
        for changed in (feedback.RECOVERY_PATHS, paths[:-1], [*paths[:-1], paths[0]],
                        [*paths, "rust/fixtures/m9/engineering/foreign.json"], *[[path] for path in generated.PATHS]):
            with self.assertRaises(RuntimeError):
                feedback.select_recovery_scope(config, changed)
        with self.assertRaises(RuntimeError):
            feedback.select_recovery_scope(legacy, paths)

    def test_streamed_candidate_tree_and_actual_bytes_produce_exact_bounded_receipt(self):
        with self.small_files():
            receipt = generated.bind(self.root, self.capture)
            generated.validate_binding(receipt)
            cohort = {**generated.POLICY, "files": self.small}
            self.assertEqual(receipt["cohort_sha256"], hashlib.sha256(generated.encoded(cohort)).hexdigest())
            self.assertEqual(receipt["verified_files"], 7)
            for field, value in (("cohort_sha256", "0" * 64), ("verified_files", 4),
                                 ("verified_files", 7.0), ("verified_files", True),
                                 ("schema_version", True), ("extra", "unbound")):
                changed = {**receipt, field: value}
                with self.subTest(field=field, value=value), self.assertRaises(RuntimeError):
                    generated.validate_binding(changed)
            for path in self.small:
                for field in ("bytes", "sha256", "git_blob"):
                    changed = copy.deepcopy(cohort)
                    changed["files"][path][field] = 0
                    self.assertNotEqual(receipt["cohort_sha256"], hashlib.sha256(generated.encoded(changed)).hexdigest())
            receipt["cohort_sha256"] = "0" * 64
            self.assertNotEqual(receipt, generated.expected_binding())
            self.assertEqual(self.small[generated.PATHS[0]]["bytes"], len(self.bytes[generated.PATHS[0]]))

    def test_tree_rejects_omissions_duplicate_entries_modes_foreign_paths_and_old_blobs(self):
        tree = self.capture(["git", "ls-tree", "-r", "HEAD", "--", *generated.PATHS], self.root)
        lines = tree.splitlines()
        cases = ["\n".join(lines[:-1]), tree + "\n" + lines[0],
                 tree.replace("100644 blob", "120000 blob", 1),
                 tree.replace(generated.PATHS[0], "rust/fixtures/foreign.json", 1),
                 tree.replace(self.small[generated.PATHS[0]]["git_blob"], "0" * 40, 1),
                 "x" * 4097, "malformed"]
        with self.small_files():
            for value in cases:
                with self.subTest(value=value[:80]), self.assertRaises(RuntimeError):
                    generated.bind(self.root, lambda args, cwd: value)

    def test_actual_same_length_mutation_missing_oversize_and_directory_fixtures_fail(self):
        relative = generated.PATHS[0]
        path = self.root / relative
        original = self.bytes[relative]
        with self.small_files():
            for data in (b"x" * len(original), original + b"extra", original[:-1]):
                path.write_bytes(data)
                with self.assertRaises(RuntimeError):
                    generated.bind(self.root, self.capture)
                path.write_bytes(original)
            path.unlink()
            with self.assertRaises(RuntimeError):
                generated.bind(self.root, self.capture)
            path.mkdir()
            with self.assertRaises(RuntimeError):
                generated.bind(self.root, self.capture)
            path.rmdir()
            path.write_bytes(original)
            generated.bind(self.root, self.capture)

    def test_complete_compiler_plan_preserves_old_targets_and_detaches_returned_ids(self):
        plan = self.plan()
        original = copy.deepcopy(plan)
        with self.small_files():
            generated.apply_plan({}, plan, self.root, self.capture, merge_targets)
            self.assertEqual(plan, original)
            generated.apply_plan(self.config, plan, self.root, self.capture, merge_targets)
            self.assertTrue(plan["requires_generated_xp_fixtures"])
            self.assertEqual(plan["required_native_targets"]["er-game"], ["existing"])
            self.assertEqual(plan["required_native_test_ids"]["er-game:existing"], ["old_witness"])
            self.assertEqual(plan["execution_scope"]["er-game"], ["existing"])
            for key, ids in generated.PACK_IDS.items():
                crate, target = key.split(":")
                self.assertEqual(plan["required_native_targets"][crate].count(target), 1)
                self.assertEqual(plan["execution_scope"][crate].count(target), 1)
                self.assertEqual(plan["required_native_test_ids"][key], ids)
            key = next(iter(generated.PACK_IDS))
            plan["required_native_test_ids"][key].append("foreign")
            self.assertNotIn("foreign", generated.PACK_IDS[key])

    def test_native_requires_actual_current_receipt_and_each_complete_compiler_identity(self):
        with self.small_files():
            plan, identity, inventory = self.native()
            generated.validate_native(plan, identity, inventory)
            for changed_plan, changed_identity in (
                    ({**plan, "requires_generated_xp_fixtures": False}, identity),
                    ({**plan, "requires_generated_xp_fixtures": 1}, identity),
                    ({**plan, "generated_fixture_inputs": None}, identity),
                    (plan, {"files": identity["files"]}),
                    (plan, {**identity, "files": {"content": "0" * 64}})):
                with self.assertRaises(RuntimeError):
                    generated.validate_native(changed_plan, changed_identity, inventory)
            for index in range(len(inventory)):
                with self.assertRaises(RuntimeError):
                    generated.validate_native(plan, identity, inventory[:index] + inventory[index + 1:])
                for change in ("missing", "renamed", "duplicate", "excluded"):
                    rows = copy.deepcopy(inventory)
                    if change == "missing":
                        rows[index]["ids"].pop()
                    elif change == "renamed":
                        rows[index]["ids"][0] = "foreign"
                    elif change == "duplicate":
                        rows[index]["ids"].append(rows[index]["ids"][0])
                    else:
                        rows[index]["historical_excluded_ids"].append("foreign")
                    with self.assertRaises(RuntimeError):
                        generated.validate_native(plan, identity, rows)

    def test_platform_rejects_old_content_even_with_successful_native_or_forged_receipt(self):
        with self.small_files():
            plan, identity, _ = self.native()
            proof = {"identity": identity, "browser_assets": {"assets": {
                "game-content-bundle-v2.json": {"sha256": self.small[generated.BUNDLE]["sha256"]}}}}
            generated.validate_platform(proof, {"plan": plan})
            for changed in ({"identity": {}, "browser_assets": proof["browser_assets"]},
                            {"identity": identity, "browser_assets": {"assets": {
                                "game-content-bundle-v2.json": {"sha256": "0" * 64}}}}):
                with self.assertRaises(RuntimeError):
                    generated.validate_platform(changed, {"plan": plan})

    def test_completion_rehash_detects_late_fixture_mutation_and_removed_policy(self):
        with self.small_files():
            identity = generated.identity_fields(self.root, self.capture)
            generated.verify_completion(self.root, self.capture, identity)
            path = self.root / generated.PATHS[-1]
            original = path.read_bytes()
            path.write_bytes(b"x" * len(original))
            with self.assertRaises(RuntimeError):
                generated.verify_completion(self.root, self.capture, identity)
            path.write_bytes(original)
            config_path = self.root / "scripts/ci/m9e-targets.json"
            config_path.write_text("{}")
            with self.assertRaises(RuntimeError):
                generated.verify_completion(self.root, self.capture, identity)

class AggregateEnvelopeTests(unittest.TestCase):
    def setUp(self):
        import m9e_phases
        self.phases = m9e_phases
        self.temporary = tempfile.TemporaryDirectory(prefix="m9e-aggregate-metadata-")
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "phase-summary.json"

    def proof(self):
        return {"phase": "aggregate", "status": "passed", "qualification": "passed",
                "identity": {"files": {"source": "a" * 64}},
                "tests": {"selected": 759, "executed": 759, "passed": 759, "failed": 0, "skipped": 0},
                "browser_tests": {"exact_facts": ["retained" * 40] * 200},
                "browser_worker_codec": {"passed": 3, "selected_test_ids": ["one", "two", "three"]},
                "required_native_target_counts": {"er-content-compiler:m9e_bundle": 1}}

    def envelope(self, raw):
        import base64
        import zlib
        return {"encoding": self.phases.AGGREGATE_ENCODING, "decoded_bytes": len(raw),
                "data": base64.b64encode(zlib.compress(raw, level=9)).decode("ascii")}

    def test_lossless_aggregate_wire_and_decoded_hashes_preserve_all_facts_and_old_raw_receipts(self):
        original = self.proof()
        frozen = copy.deepcopy(original)
        wire_hash = self.phases.write_bounded(self.path, original)
        wire = self.path.read_bytes()
        envelope = json.loads(wire)
        self.assertEqual(set(envelope), {"encoding", "decoded_bytes", "data"})
        self.assertEqual(envelope["encoding"], self.phases.AGGREGATE_ENCODING)
        self.assertEqual(wire_hash, hashlib.sha256(wire).hexdigest())
        self.assertLessEqual(len(wire), 65536)
        self.assertLessEqual(envelope["decoded_bytes"], 196608)
        self.assertEqual(self.phases.read_bounded(self.path, wire_hash), frozen)
        self.assertEqual(original, frozen)
        with self.assertRaises(RuntimeError):
            self.phases.read_bounded(self.path, "0" * 64)
        raw = self.phases.encoded(frozen)
        self.path.write_bytes(raw)
        self.assertLessEqual(len(raw), 65536)
        self.assertEqual(self.phases.read_bounded(self.path, hashlib.sha256(raw).hexdigest()), frozen)
        for value in ({"phase": "platform", "metadata": "x" * 60000},
                      {"phase": "native"}, {"phase": "aggregate", "tests": {"passed": 1}}):
            self.assertIs(self.phases.pack_aggregate_proof(value), value)
        with self.assertRaises(RuntimeError):
            self.phases.write_bounded(self.path, {"phase": "platform", "metadata": "x" * 65536})

    def test_aggregate_envelope_rejects_field_type_size_unknown_version_and_base64_mutations(self):
        good = self.envelope(self.phases.encoded(self.proof()))
        cases = [{**good, "extra": 1}, {key: value for key, value in good.items() if key != "data"}]
        cases += [{**good, "decoded_bytes": bad} for bad in (True, 1.0, 0, -1, 196609, good["decoded_bytes"] - 1)]
        cases += [{**good, "data": bad} for bad in (None, "", "!", good["data"] + "\n", "a" * 65537)]
        for bad in cases:
            with self.subTest(value=str(bad)[:80]), self.assertRaises(RuntimeError):
                self.phases.unpack_aggregate_proof(bad)
        bad = {**good, "encoding": "aggregate-proof-zlib-v99"}
        self.path.write_bytes(self.phases.encoded(bad))
        with self.assertRaises(RuntimeError):
            self.phases.read_bounded(self.path, hashlib.sha256(self.path.read_bytes()).hexdigest())

    def test_aggregate_inflation_rejects_bombs_truncation_trailing_streams_and_noncanonical_json(self):
        import base64
        import zlib
        raw = self.phases.encoded(self.proof())
        good = self.envelope(raw)
        compressed = base64.b64decode(good["data"])
        for payload in (compressed[:-1], compressed + b"junk", compressed + zlib.compress(b"second")):
            bad = {**good, "data": base64.b64encode(payload).decode("ascii")}
            with self.assertRaises(RuntimeError):
                self.phases.unpack_aggregate_proof(bad)
        bomb = self.envelope(b"x" * 196609)
        bomb["decoded_bytes"] = 196608
        with self.assertRaises(RuntimeError):
            self.phases.unpack_aggregate_proof(bomb)
        bad_json = (b'{"phase":"aggregate","phase":"aggregate"}\n',
                    b'{ "phase": "aggregate" }\n', b'{"phase":"aggregate"}',
                    b'{"phase":"aggregate","stat":NaN}\n',
                    b'not-json', b'\xff', b'{"phase":"platform"}\n',
                    self.phases.encoded({"phase": "aggregate", "encoding": "nested"}))
        for payload in bad_json:
            with self.subTest(raw=payload[:80]), self.assertRaises(RuntimeError):
                self.phases.unpack_aggregate_proof(self.envelope(payload))

    def test_aggregate_semantic_and_incompressible_wire_limits_fail_before_writing(self):
        import base64
        import random
        for value in ({"phase": "aggregate", "encoding": "nested"},
                      {"phase": "aggregate", "facts": "x" * 196608},
                      {"phase": "aggregate", "facts": base64.b64encode(random.Random(17).randbytes(80000)).decode("ascii")}):
            with self.assertRaises(RuntimeError):
                self.phases.write_bounded(self.path, value)
            self.assertFalse(self.path.exists())
        self.assertEqual(self.phases.MANIFEST_LIMIT, 65536)
        self.assertEqual(self.phases.AGGREGATE_DECODED_LIMIT, 196608)

    def test_compact_field_references_use_wire_hash_and_separate_decoded_digest_without_mutating_proof(self):
        proof = self.proof()
        frozen = copy.deepcopy(proof)
        wire_hash = self.phases.write_bounded(self.path, proof)
        compact = self.phases.compact_summary(proof, wire_hash, {})
        self.assertEqual(compact["phase_summary_sha256"], wire_hash)
        self.assertEqual(compact["phase_summary_decoded_sha256"], hashlib.sha256(self.phases.encoded(proof)).hexdigest())
        self.assertNotEqual(compact["phase_summary_decoded_sha256"], wire_hash)
        self.assertLessEqual(len(self.phases.encoded(compact)), 16000)
        self.assertEqual(compact["browser_tests"], {"file": "phase-summary.json", "sha256": wire_hash, "field": "browser_tests"})
        for key in ("identity", "tests", "required_native_target_counts"):
            self.assertEqual(compact[key], proof[key])
        self.assertEqual(self.phases.read_bounded(self.path, compact["browser_tests"]["sha256"])["browser_tests"], frozen["browser_tests"])
        self.assertEqual(proof, frozen)
