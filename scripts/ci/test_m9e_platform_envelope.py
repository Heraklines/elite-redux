"""Platform proof encoding retains all evidence under the unchanged wire cap."""
import base64
import copy
import hashlib
import json
from pathlib import Path
import random
import tempfile
import unittest
import zlib

import m9e_phases as phases


class PlatformEnvelopeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="m9e-platform-proof-")
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "platform.json"

    def proof(self):
        return {"phase": "platform", "status": "passed", "identity": {"source": "a" * 40},
                "old_browser_facts": ["preserved" * 40] * 160,
                "current_browser_rebind_physical": {"all_actual_receipts": ["receipt" * 40] * 90}}

    def envelope(self, raw):
        return {"encoding": phases.PLATFORM_ENCODING, "decoded_bytes": len(raw),
                "data": base64.b64encode(zlib.compress(raw, level=9)).decode("ascii")}

    def test_full_platform_roundtrip_preserves_all_old_and_new_evidence_and_raw_compatibility(self):
        proof = self.proof()
        frozen = copy.deepcopy(proof)
        self.assertGreater(len(phases.encoded(proof)), 65536)
        wire_hash = phases.write_bounded(self.path, proof)
        raw = self.path.read_bytes()
        self.assertLessEqual(len(raw), 65536)
        self.assertEqual(json.loads(raw)["encoding"], phases.PLATFORM_ENCODING)
        self.assertEqual(wire_hash, hashlib.sha256(raw).hexdigest())
        self.assertEqual(phases.read_bounded(self.path, wire_hash), frozen)
        self.assertEqual(proof, frozen)
        with self.assertRaises(RuntimeError):
            phases.read_bounded(self.path, "0" * 64)
        old = {"phase": "platform", "old_facts": "x" * 60000}
        self.assertIs(phases.pack_platform_proof(old), old)
        old_hash = phases.write_bounded(self.path, old)
        self.assertEqual(self.path.read_bytes(), phases.encoded(old))
        self.assertEqual(phases.read_bounded(self.path, old_hash), old)
        for other in ({"phase": "native"}, {"phase": "aggregate"}):
            self.assertIs(phases.pack_platform_proof(other), other)

    def test_platform_envelope_rejects_identity_type_size_and_base64_tampering(self):
        good = self.envelope(phases.encoded(self.proof()))
        values = [{**good, "extra": 1}, {key: value for key, value in good.items() if key != "data"}]
        values += [{**good, "decoded_bytes": value} for value in (True, 1.0, 0, -1, 196609, good["decoded_bytes"] - 1)]
        values += [{**good, "data": value} for value in (None, "", "!", good["data"] + "\n", "a" * 65537)]
        for value in values:
            with self.subTest(value=str(value)[:50]), self.assertRaises(RuntimeError):
                phases.unpack_platform_proof(value)
        wrong_version = {**good, "encoding": "platform-proof-zlib-v99"}
        self.path.write_bytes(phases.encoded(wrong_version))
        with self.assertRaises(RuntimeError):
            phases.read_bounded(self.path, hashlib.sha256(self.path.read_bytes()).hexdigest())

    def test_platform_inflation_rejects_truncation_trailing_streams_and_bombs(self):
        good = self.envelope(phases.encoded(self.proof()))
        compressed = base64.b64decode(good["data"])
        for payload in (compressed[:-1], compressed + b"junk", compressed + zlib.compress(b"second")):
            with self.subTest(payload_bytes=len(payload)), self.assertRaises(RuntimeError):
                phases.unpack_platform_proof({**good, "data": base64.b64encode(payload).decode("ascii")})
        bomb = self.envelope(b"x" * 196609)
        bomb["decoded_bytes"] = 196608
        with self.assertRaises(RuntimeError):
            phases.unpack_platform_proof(bomb)
        for value in ({"phase": "platform", "facts": "x" * 196608},
                      {"phase": "platform", "facts": base64.b64encode(random.Random(19).randbytes(80000)).decode("ascii")}):
            with self.assertRaises(RuntimeError):
                phases.write_bounded(self.path, value)
            self.assertFalse(self.path.exists())
        self.assertEqual(phases.MANIFEST_LIMIT, 65536)
        self.assertEqual(phases.PLATFORM_DECODED_LIMIT, 196608)

    def test_platform_decode_rejects_nested_duplicate_noncanonical_or_wrong_phase_json(self):
        invalid = (b'{"phase":"platform","phase":"platform"}\n', b'{ "phase": "platform" }\n',
                   b'{"phase":"platform"}', b'{"phase":"platform","stat":NaN}\n', b'not-json', b'\xff',
                   b'{"phase":"aggregate"}\n', phases.encoded({"phase": "platform", "encoding": "nested"}))
        for raw in invalid:
            with self.subTest(raw=raw[:50]), self.assertRaises(RuntimeError):
                phases.unpack_platform_proof(self.envelope(raw))
        with self.assertRaises(RuntimeError):
            phases.pack_platform_proof({"phase": "platform", "encoding": "nested"})
