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
            manifest = {
                "trainingProfile": "baseline",
                "decisionShards": 3,
                "featureSchemaVersion": 4,
                "files": [{
                    "path": "ml/policy/train_candidate_transformer.py",
                    "bytes": len(source),
                    "sha256": hashlib.sha256(source).hexdigest(),
                }],
            }
            bundle = root / "er-ai-training-bundle.zip"
            with ZipFile(bundle, "w", ZIP_DEFLATED) as archive:
                archive.writestr("bundle-manifest.json", json.dumps(manifest))
                archive.writestr("ml/policy/train_candidate_transformer.py", source)

            report = MODULE.verify_bundle(bundle, repository)
            self.assertEqual(report["sourceFiles"], 1)
            self.assertEqual(report["featureSchemaVersion"], 4)

            extracted = root / "extracted"
            with ZipFile(bundle) as archive:
                archive.extractall(extracted)
            extracted_report = MODULE.verify_bundle(extracted, repository)
            self.assertEqual(extracted_report["sourceFiles"], 1)

            source_path.write_text("stale = True\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "stale training source"):
                MODULE.verify_bundle(bundle, repository)


if __name__ == "__main__":
    unittest.main()
