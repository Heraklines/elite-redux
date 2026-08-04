import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


MODULE_PATH = Path(__file__).with_name("verify_kaggle_training_bundle.py")
SPEC = importlib.util.spec_from_file_location("verify_kaggle_training_bundle", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class VerifyKaggleTrainingBundleTest(unittest.TestCase):
    def test_rejects_stale_private_dataset_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository = root / "repository"
            source_path = repository / "ml/policy/train_candidate_transformer.py"
            source_path.parent.mkdir(parents=True)
            source = b'parser.add_argument("--gradient-accumulation-steps")\n'
            source_path.write_bytes(source)
            packaging_sources = {
                "ml/policy/build_candidate_ensemble.py": b"from serve_candidate_transformer import load_bundle\n",
                "ml/policy/serve_candidate_transformer.py": b"def load_bundle(): pass\n",
            }
            for relative_path, payload in packaging_sources.items():
                (repository / relative_path).write_bytes(payload)
            manifest_files = [{
                "path": "ml/policy/train_candidate_transformer.py",
                "bytes": len(source),
                "sha256": hashlib.sha256(source).hexdigest(),
            }]
            manifest_files.extend(
                {
                    "path": relative_path,
                    "bytes": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
                for relative_path, payload in packaging_sources.items()
            )
            manifest = {
                "trainingProfile": "baseline",
                "decisionShards": 3,
                "featureSchemaVersion": 4,
                "files": manifest_files,
            }
            bundle = root / "er-ai-training-bundle.zip"
            with ZipFile(bundle, "w", ZIP_DEFLATED) as archive:
                archive.writestr("bundle-manifest.json", json.dumps(manifest))
                archive.writestr("ml/policy/train_candidate_transformer.py", source)
                for relative_path, payload in packaging_sources.items():
                    archive.writestr(relative_path, payload)

            report = MODULE.verify_bundle(bundle, repository)
            self.assertEqual(report["sourceFiles"], 3)
            self.assertEqual(report["featureSchemaVersion"], 4)

            extracted = root / "extracted"
            with ZipFile(bundle) as archive:
                archive.extractall(extracted)
            extracted_report = MODULE.verify_bundle(extracted, repository)
            self.assertEqual(extracted_report["sourceFiles"], 3)

            source_path.write_text("stale = True\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "stale training source"):
                MODULE.verify_bundle(bundle, repository)

    def test_rejects_bundle_without_ensemble_serving_dependency(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repository = root / "repository"
            build_path = repository / "ml/policy/build_candidate_ensemble.py"
            build_path.parent.mkdir(parents=True)
            build_source = b"from serve_candidate_transformer import load_bundle\n"
            build_path.write_bytes(build_source)
            bundle = root / "er-ai-training-bundle.zip"
            manifest = {
                "files": [{
                    "path": "ml/policy/build_candidate_ensemble.py",
                    "bytes": len(build_source),
                    "sha256": hashlib.sha256(build_source).hexdigest(),
                }],
            }
            with ZipFile(bundle, "w", ZIP_DEFLATED) as archive:
                archive.writestr("bundle-manifest.json", json.dumps(manifest))
                archive.writestr("ml/policy/build_candidate_ensemble.py", build_source)

            with self.assertRaisesRegex(ValueError, "serve_candidate_transformer.py"):
                MODULE.verify_bundle(bundle, repository)


if __name__ == "__main__":
    unittest.main()
