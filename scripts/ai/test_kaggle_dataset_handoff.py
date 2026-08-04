import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from kaggle.api.kaggle_api_extended import ApiDatasetNewFile


SCRIPT_ROOT = Path(__file__).parent


def load_module(name: str):
    path = SCRIPT_ROOT / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


STAGE = load_module("stage_kaggle_dataset_handoff")
FINALIZE = load_module("finalize_kaggle_dataset_handoff")


class FakeStageApi:
    CONFIG_NAME_USER = "username"
    config_values = {"username": "owner"}

    @staticmethod
    def get_dataset_metadata_file(folder: str) -> str:
        return str(Path(folder) / "dataset-metadata.json")

    @staticmethod
    def validate_resources(_folder: str, _resources) -> None:
        return None

    @staticmethod
    def upload_files(request, _resources, *_args, **_kwargs) -> None:
        uploaded = ApiDatasetNewFile()
        uploaded.token = "opaque-upload-token"
        request.files.append(uploaded)


class FakeDatasetClient:
    def __init__(self) -> None:
        self.request = None

    def create_dataset(self, request):
        self.request = request
        return SimpleNamespace(status="pending", error=None)


class FakeKaggleClient:
    def __init__(self, dataset_client: FakeDatasetClient) -> None:
        self.datasets = SimpleNamespace(dataset_api_client=dataset_client)

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        return None


class FakeFinalizeApi:
    def __init__(self) -> None:
        self.dataset_client = FakeDatasetClient()

    def build_kaggle_client(self) -> FakeKaggleClient:
        return FakeKaggleClient(self.dataset_client)

    @staticmethod
    def with_retry(function):
        return function


class KaggleDatasetHandoffTest(unittest.TestCase):
    def test_stages_and_finalizes_only_the_opaque_request(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "dataset"
            source.mkdir()
            (source / "dataset-metadata.json").write_text(
                json.dumps({
                    "id": "owner/private-training-data",
                    "title": "Private Training Data",
                    "licenses": [{"name": "other"}],
                }),
                encoding="utf-8",
            )
            (source / "large-private-blob.zip").write_bytes(b"not-read-by-the-finalizer")
            handoff = root / "handoff.json"

            summary = STAGE.stage_handoff(source, handoff, FakeStageApi())
            self.assertEqual(summary["uploadedFiles"], 1)
            self.assertNotIn("not-read-by-the-finalizer", handoff.read_text(encoding="utf-8"))

            api = FakeFinalizeApi()
            result = FINALIZE.finalize_handoff(
                handoff,
                "owner/private-training-data",
                api,
            )
            self.assertEqual(result["status"], "pending")
            self.assertEqual(api.dataset_client.request.files[0].token, "opaque-upload-token")
            self.assertFalse(handoff.exists())

    def test_rejects_mismatched_dataset_before_finalization(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            handoff = Path(directory) / "handoff.json"
            handoff.write_text(
                json.dumps({
                    "schemaVersion": 1,
                    "operation": "create-private-dataset",
                    "datasetId": "owner/expected-data",
                    "request": {},
                }),
                encoding="utf-8",
            )
            api = FakeFinalizeApi()
            with self.assertRaisesRegex(ValueError, "identity mismatch"):
                FINALIZE.finalize_handoff(handoff, "owner/other-data", api)
            self.assertIsNone(api.dataset_client.request)


if __name__ == "__main__":
    unittest.main()
