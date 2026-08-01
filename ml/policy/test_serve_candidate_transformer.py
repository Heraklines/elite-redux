from __future__ import annotations

import json
import hashlib
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
        config = CandidateTransformerConfig(
            feature_count=4,
            token_vocabulary_size=4,
            d_model=8,
            layers=1,
            heads=2,
            feedforward=16,
        )
        model = CandidateSetTransformer(config)
        vocabulary = ["<PAD>", "<UNK>", "action:move", "move:1"]
        vocabulary_hash = hashlib.sha256(
            json.dumps(vocabulary, ensure_ascii=True, separators=(",", ":")).encode()
        ).hexdigest()
        save_file({key: value.detach().contiguous() for key, value in model.state_dict().items()}, str(root / "model.safetensors"))
        (root / "config.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 4,
                    "model": "er-domain-candidate-transformer-v4",
                    "contractSchemaVersion": 3,
                    "featureSchemaVersion": 2,
                    "architecture": asdict(config),
                    "dictionaryHash": "a" * 64,
                    "tokenGroups": ["actor", "targets", "destination", "field", "action"],
                    "domains": ["elite-redux", "showdown"],
                    "tokenVocabulary": vocabulary,
                    "tokenVocabularySha256": vocabulary_hash,
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
            groups = [{"actor": [], "targets": [], "destination": [], "field": [], "action": ["action:move"]}] * 2
            scores, value = score_candidates(
                model,
                [[0.0, 1.0, 2.0, 3.0], [3.0, 2.0, 1.0, 0.0]],
                groups,
            )
            self.assertEqual(len(scores), 2)
            self.assertGreaterEqual(value, 0.0)
            self.assertLessEqual(value, 1.0)

    def test_rejects_wrong_feature_width(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            self.make_bundle(root)
            model = load_bundle(root)
            with self.assertRaisesRegex(ValueError, "4 values"):
                score_candidates(
                    model,
                    [[0.0, 1.0]],
                    [{"actor": [], "targets": [], "destination": [], "field": [], "action": ["action:move"]}],
                )

    def test_scores_with_chosen_action_history(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            self.make_bundle(root)
            model = load_bundle(root)
            groups = [{"actor": [], "targets": [], "destination": [], "field": [], "action": ["action:move"]}] * 2
            scores, value = score_candidates(
                model,
                [[0.0, 1.0, 2.0, 3.0], [3.0, 2.0, 1.0, 0.0]],
                groups,
                [
                    {
                        "candidateFeatures": [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0]],
                        "candidateTokenGroups": groups,
                        "chosenIndex": 1,
                    }
                ],
            )
            self.assertEqual(len(scores), 2)
            self.assertGreaterEqual(value, 0.0)
            self.assertLessEqual(value, 1.0)

    def test_accepts_masked_showdown_features_without_treating_unknown_values_as_zero(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            self.make_bundle(root)
            model = load_bundle(root)
            groups = [{"actor": [], "targets": [], "destination": [], "field": [], "action": ["action:move"]}]
            first = score_candidates(model, [[1.0, 2.0, 3.0, 4.0]], groups, feature_presence=[[True, False, True, False]], domain="showdown")
            second = score_candidates(model, [[1.0, 2000.0, 3.0, -4000.0]], groups, feature_presence=[[True, False, True, False]], domain="showdown")
            self.assertEqual(first, second)

    def test_builds_and_loads_seed_ensemble(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            for seed in (1, 2):
                member = root / f"seed-{seed}"
                member.mkdir()
                self.make_bundle(member)
            manifest = build_manifest(root)
            models = load_ensemble(root)
            groups = [{"actor": [], "targets": [], "destination": [], "field": [], "action": ["action:move"]}] * 2
            scores, value = score_candidates(
                models,
                [[0.0, 1.0, 2.0, 3.0], [3.0, 2.0, 1.0, 0.0]],
                groups,
            )
            self.assertEqual(manifest["members"], ["seed-1", "seed-2"])
            self.assertEqual(len(models), 2)
            self.assertEqual(len(scores), 2)
            self.assertGreaterEqual(value, 0.0)
            self.assertLessEqual(value, 1.0)


if __name__ == "__main__":
    unittest.main()
