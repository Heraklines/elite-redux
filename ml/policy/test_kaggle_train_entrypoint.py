import hashlib
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

from kaggle_train_entrypoint import (
    PASCAL_COMPATIBLE_TORCH_INDEX,
    PASCAL_COMPATIBLE_TORCH_VERSION,
    PROFILES,
    build_training_command,
    compatible_torch_install_command,
    cuda_architecture_supported,
    effective_batch_size,
    find_training_source,
    materialize_training_bundle,
    run_with_failure_report,
)


class KaggleTrainingEntrypointTest(unittest.TestCase):
    def test_detects_missing_pascal_architecture(self) -> None:
        self.assertFalse(cuda_architecture_supported((6, 0), ["sm_70", "sm_75", "sm_80"]))
        self.assertTrue(cuda_architecture_supported((6, 0), ["sm_60", "sm_70", "sm_75"]))

    def test_runtime_repair_uses_official_pascal_compatible_wheel(self) -> None:
        command = compatible_torch_install_command()
        self.assertIn(f"torch=={PASCAL_COMPATIBLE_TORCH_VERSION}", command)
        self.assertEqual(command[command.index("--index-url") + 1], PASCAL_COMPATIBLE_TORCH_INDEX)

    def test_large_profile_requires_cuda_trajectory_training(self) -> None:
        command = build_training_command(Path("bundle"), Path("output"), PROFILES["large"], 17)
        self.assertEqual(command[command.index("--device") + 1], "cuda")
        self.assertEqual(command[command.index("--history-length") + 1], "8")
        self.assertEqual(command[command.index("--trajectory-layers") + 1], "4")
        self.assertIn("--elite-rollouts", command)
        self.assertIn("--amp", command)
        self.assertIn("--fast-kernels", command)
        self.assertEqual(command[command.index("--loss-policy-weight") + 1], "0")

    def test_baseline_batch_is_unchanged_without_checkpoint_resume(self) -> None:
        command = build_training_command(Path("bundle"), Path("output"), PROFILES["baseline"], 17)
        self.assertEqual(command[command.index("--batch-size") + 1], "128")
        self.assertEqual(effective_batch_size(PROFILES["baseline"], False), 128)

    def test_transfer_bundle_enables_masked_domain_pretraining(self) -> None:
        command = build_training_command(
            Path("bundle"),
            Path("output"),
            PROFILES["large"],
            17,
            Path("bundle/transfer-data"),
            0,
        )
        self.assertEqual(command[command.index("--transfer-data") + 1], str(Path("bundle/transfer-data")))
        self.assertEqual(command[command.index("--transfer-mode") + 1], "pretrain")
        self.assertEqual(command[command.index("--transfer-pretrain-epochs") + 1], "0")

    def test_fixed_vocabulary_is_forwarded_without_transfer_training_rows(self) -> None:
        vocabulary = Path("bundle/vocabulary/token-vocabulary.json")
        command = build_training_command(
            Path("bundle"),
            Path("output"),
            PROFILES["large"],
            17,
            token_vocabulary=vocabulary,
        )
        self.assertEqual(command[command.index("--token-vocabulary") + 1], str(vocabulary))
        self.assertNotIn("--transfer-data", command)

    def test_initial_checkpoint_is_forwarded_for_er_finetuning(self) -> None:
        initial_model = Path("bundle/initial-model")
        command = build_training_command(
            Path("bundle"),
            Path("output"),
            PROFILES["baseline"],
            17,
            init_model_dir=initial_model,
        )
        self.assertEqual(command[command.index("--init-model-dir") + 1], str(initial_model))
        self.assertEqual(command[command.index("--batch-size") + 1], "32")
        self.assertEqual(effective_batch_size(PROFILES["baseline"], True), 32)
        self.assertNotIn("--amp", command)
        self.assertNotIn("--transfer-data", command)

    def write_bundle(self, root: Path, contract_identity: tuple[int, int] = (3, 2)) -> None:
        payload = root / "data" / "decisions.jsonl"
        payload.parent.mkdir(parents=True)
        payload.write_text('{"decisionId":"one"}\n', encoding="utf-8")
        content = payload.read_bytes()
        (root / "bundle-manifest.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "contractSchemaVersion": contract_identity[0],
                    "featureSchemaVersion": contract_identity[1],
                    "dictionarySchemaVersion": 3,
                    "neuralArtifactSchemaVersion": 4,
                    "trainingProfile": "smoke",
                    "seeds": [1],
                    "files": [
                        {
                            "path": "data/decisions.jsonl",
                            "bytes": len(content),
                            "sha256": hashlib.sha256(content).hexdigest(),
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

    def test_materializes_kaggle_unpacked_dataset(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "input" / "dataset"
            self.write_bundle(source)
            manifest, description = materialize_training_bundle(root / "input", root / "working")
            self.assertEqual(manifest["trainingProfile"], "smoke")
            self.assertTrue(description.startswith("directory:"))
            self.assertTrue((root / "working" / "data" / "decisions.jsonl").is_file())

    def test_materializes_contract_v4_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "input" / "dataset"
            self.write_bundle(source, (4, 4))
            manifest, _ = materialize_training_bundle(root / "input", root / "working")
            self.assertEqual(
                (manifest["contractSchemaVersion"], manifest["featureSchemaVersion"]),
                (4, 4),
            )

    def test_forwards_runtime_dictionary_supplement(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            bundle = Path(temp)
            supplement = bundle / "dictionary" / "runtime-item-dictionary-supplement.json"
            supplement.parent.mkdir(parents=True)
            supplement.write_text("{}\n", encoding="utf-8")
            command = build_training_command(bundle, bundle / "output", PROFILES["smoke"], 17)
            self.assertEqual(command[command.index("--dictionary-supplement") + 1], str(supplement))

    def test_materializes_raw_zip_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            self.write_bundle(source)
            archive_path = root / "input" / "er-ai-training-bundle.zip"
            archive_path.parent.mkdir()
            with zipfile.ZipFile(archive_path, "w") as archive:
                for path in source.rglob("*"):
                    if path.is_file():
                        archive.write(path, path.relative_to(source))
            manifest, description = materialize_training_bundle(root / "input", root / "working")
            self.assertEqual(manifest["seeds"], [1])
            self.assertTrue(description.startswith("archive:"))

    def test_rejects_ambiguous_sources(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.write_bundle(root / "input" / "dataset")
            (root / "input" / "er-ai-training-bundle.zip").touch()
            with self.assertRaisesRegex(RuntimeError, "found 2"):
                find_training_source(root / "input")

    def test_rejects_checksum_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "input" / "dataset"
            self.write_bundle(source)
            (source / "data" / "decisions.jsonl").write_text("tampered\n", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "checksum mismatch"):
                materialize_training_bundle(root / "input", root / "working")

    @mock.patch("kaggle_train_entrypoint.main", side_effect=RuntimeError("diagnostic marker"))
    def test_persists_failure_report_before_reraising(self, _main: mock.Mock) -> None:
        with tempfile.TemporaryDirectory() as temp:
            with mock.patch.dict(os.environ, {"KAGGLE_WORKING_PATH": temp}):
                with self.assertRaisesRegex(RuntimeError, "diagnostic marker"):
                    run_with_failure_report()
            report = json.loads(
                (Path(temp) / "er-ai-candidate-transformer" / "failure.json").read_text(encoding="utf-8")
            )
            self.assertEqual(report["exceptionType"], "RuntimeError")
            self.assertEqual(report["message"], "diagnostic marker")
            self.assertTrue(any("diagnostic marker" in line for line in report["traceback"]))


if __name__ == "__main__":
    unittest.main()
