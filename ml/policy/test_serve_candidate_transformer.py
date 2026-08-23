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
    def make_bundle(
        self,
        root: Path,
        contract_identity: tuple[int, int] = (3, 2),
    ) -> CandidateSetTransformer:
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
                    "contractSchemaVersion": contract_identity[0],
                    "featureSchemaVersion": contract_identity[1],
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

    def test_loads_contract_v4_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            self.make_bundle(root, (4, 4))
            bundle = load_bundle(root)
            self.assertEqual((bundle.contract_schema_version, bundle.feature_schema_version), (4, 4))

    def test_compact_model_selects_features_from_full_runtime_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            self.make_bundle(root, (4, 4))
            config_path = root / "config.json"
            config = json.loads(config_path.read_text(encoding="utf-8"))
            config["contractFeatureCount"] = 6
            config["inputFeatureIndices"] = [0, 2, 4, 5]
            config_path.write_text(json.dumps(config), encoding="utf-8")

            bundle = load_bundle(root)
            groups = [{"actor": [], "targets": [], "destination": [], "field": [], "action": ["action:move"]}]
            scores, value = score_candidates(
                bundle,
                [[0.0, 1000.0, 2.0, -1000.0, 4.0, 5.0]],
                groups,
                [{
                    "candidateFeatures": [[1.0, 1000.0, 3.0, -1000.0, 5.0, 6.0]],
                    "candidateTokenGroups": groups,
                    "chosenIndex": 0,
                }],
            )
            self.assertEqual(bundle.contract_feature_count, 6)
            self.assertEqual(bundle.input_feature_indices, (0, 2, 4, 5))
            self.assertEqual(len(scores), 1)
            self.assertGreaterEqual(value, 0.0)
            self.assertLessEqual(value, 1.0)

    def test_rejects_unsupported_contract_pair(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            self.make_bundle(root, (4, 2))
            with self.assertRaisesRegex(ValueError, "unsupported contract/feature schema pair"):
                load_bundle(root)

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
            self.assertEqual(
                (manifest["contractSchemaVersion"], manifest["featureSchemaVersion"]),
                (3, 2),
            )
            self.assertEqual(len(models), 2)
            self.assertEqual(len(scores), 2)
            self.assertGreaterEqual(value, 0.0)
            self.assertLessEqual(value, 1.0)


if __name__ == "__main__":
    unittest.main()
