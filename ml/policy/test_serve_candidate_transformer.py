from __future__ import annotations

import json
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path

import torch
from safetensors.torch import save_file

from candidate_transformer import CandidateSetTransformer, CandidateTransformerConfig
from build_candidate_ensemble import build_manifest
from serve_candidate_transformer import load_bundle, load_ensemble, score_candidates


class CandidateTransformerSidecarTests(unittest.TestCase):
    def make_bundle(self, root: Path) -> CandidateSetTransformer:
        config = CandidateTransformerConfig(feature_count=4, d_model=8, layers=1, heads=2, feedforward=16)
        model = CandidateSetTransformer(config)
        save_file({key: value.detach().contiguous() for key, value in model.state_dict().items()}, str(root / "model.safetensors"))
        (root / "config.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "model": "er-candidate-set-transformer-v1",
                    "featureSchemaVersion": 1,
                    "architecture": asdict(config),
                    "weights": "model.safetensors",
                }
            ),
            encoding="utf-8",
        )
        return model

    def test_loads_bundle_and_scores_each_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            self.make_bundle(root)
            model = load_bundle(root)
            scores, value = score_candidates(model, [[0.0, 1.0, 2.0, 3.0], [3.0, 2.0, 1.0, 0.0]])
            self.assertEqual(len(scores), 2)
            self.assertGreaterEqual(value, 0.0)
            self.assertLessEqual(value, 1.0)

    def test_rejects_wrong_feature_width(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            self.make_bundle(root)
            model = load_bundle(root)
            with self.assertRaisesRegex(ValueError, "4 values"):
                score_candidates(model, [[0.0, 1.0]])

    def test_builds_and_loads_seed_ensemble(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            for seed in (1, 2):
                member = root / f"seed-{seed}"
                member.mkdir()
                self.make_bundle(member)
            manifest = build_manifest(root)
            models = load_ensemble(root)
            scores, value = score_candidates(models, [[0.0, 1.0, 2.0, 3.0], [3.0, 2.0, 1.0, 0.0]])
            self.assertEqual(manifest["members"], ["seed-1", "seed-2"])
            self.assertEqual(len(models), 2)
            self.assertEqual(len(scores), 2)
            self.assertGreaterEqual(value, 0.0)
            self.assertLessEqual(value, 1.0)


if __name__ == "__main__":
    unittest.main()
