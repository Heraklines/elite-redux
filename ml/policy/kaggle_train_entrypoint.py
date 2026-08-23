#!/usr/bin/env python3
"""Run an ER candidate-transformer training profile inside a private Kaggle kernel."""

from __future__ import annotations

import json
import hashlib
import os
import shutil
import subprocess
import sys
import traceback
import zipfile
from collections import deque
from pathlib import Path

# Variable candidate/history shapes otherwise fragment the P100 allocator between batches.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

import torch


PASCAL_COMPATIBLE_TORCH_VERSION = "2.11.0"
PASCAL_COMPATIBLE_TORCH_INDEX = "https://download.pytorch.org/whl/cu126"
TORCH_RUNTIME_REPAIR_ENV = "ER_AI_TORCH_RUNTIME_REPAIRED"


PROFILES = {
    "smoke": {
        "d_model": 64,
        "layers": 2,
        "heads": 4,
        "feedforward": 128,
        "epochs": 2,
        "patience": 2,
        "batch_size": 8,
        "resume_batch_size": 8,
        "gradient_accumulation_steps": 1,
        "history_length": 8,
        "trajectory_layers": 1,
        "transfer_pretrain_epochs": 1,
    },
    "baseline": {
        "d_model": 320,
        "layers": 4,
        "heads": 8,
        "feedforward": 960,
        "epochs": 60,
        "patience": 8,
        "batch_size": 32,
        "resume_batch_size": 16,
        "gradient_accumulation_steps": 4,
        "history_length": 8,
        "trajectory_layers": 2,
        "transfer_pretrain_epochs": 4,
    },
    "large": {
        "d_model": 704,
        "layers": 8,
        "heads": 16,
        "feedforward": 2816,
        "epochs": 80,
        "patience": 10,
        "batch_size": 32,
        "resume_batch_size": 8,
        "gradient_accumulation_steps": 4,
        "history_length": 8,
        "trajectory_layers": 4,
        "transfer_pretrain_epochs": 8,
    },
}


def cuda_architecture_supported(capability: tuple[int, int], compiled_arches: list[str]) -> bool:
    architecture = f"sm_{capability[0]}{capability[1]}"
    return architecture in compiled_arches


def compatible_torch_install_command() -> list[str]:
    return [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--no-cache-dir",
        "--force-reinstall",
        f"torch=={PASCAL_COMPATIBLE_TORCH_VERSION}",
        "--index-url",
        PASCAL_COMPATIBLE_TORCH_INDEX,
    ]


def ensure_cuda_runtime_compatible() -> None:
    if not torch.cuda.is_available():
        raise RuntimeError("Kaggle GPU training requested, but torch.cuda.is_available() is false")
    capability = torch.cuda.get_device_capability(0)
    compiled_arches = torch.cuda.get_arch_list()
    if cuda_architecture_supported(capability, compiled_arches):
        return
    architecture = f"sm_{capability[0]}{capability[1]}"
    if os.environ.get(TORCH_RUNTIME_REPAIR_ENV) == "1":
        raise RuntimeError(
            f"installed PyTorch {torch.__version__} still lacks {architecture}; compiled arches: {compiled_arches}"
        )
    print(
        json.dumps(
            {
                "event": "repair-cuda-runtime",
                "device": torch.cuda.get_device_name(0),
                "requiredArchitecture": architecture,
                "currentTorch": torch.__version__,
                "compiledArchitectures": compiled_arches,
                "installTorch": PASCAL_COMPATIBLE_TORCH_VERSION,
                "installIndex": PASCAL_COMPATIBLE_TORCH_INDEX,
            }
        ),
        flush=True,
    )
    subprocess.run(compatible_torch_install_command(), check=True)
    repaired_environment = os.environ.copy()
    repaired_environment[TORCH_RUNTIME_REPAIR_ENV] = "1"
    os.execvpe(sys.executable, [sys.executable, *sys.argv], repaired_environment)


def prove_cuda_runtime() -> None:
    probe = torch.ones(1, device="cuda") * 2
    torch.cuda.synchronize()
    if probe.item() != 2:
        raise RuntimeError("CUDA runtime probe returned an invalid result")


def required_environment(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None or not value.strip():
        raise RuntimeError(f"missing required environment variable {name}")
    return value.strip()


def temporary_bundle_root() -> Path:
    return Path(required_environment("ER_AI_TEMP_PATH", "/tmp")) / "er-ai-training-bundle"


def find_training_source(input_root: Path) -> tuple[str, Path]:
    archives = sorted(input_root.rglob("er-ai-training-bundle.zip"))
    manifests = sorted(input_root.rglob("bundle-manifest.json"))
    sources = [("archive", path) for path in archives] + [("directory", path.parent) for path in manifests]
    if len(sources) != 1:
        raise RuntimeError(
            f"expected exactly one packed or unpacked ER AI training bundle under {input_root}, found {len(sources)}"
        )
    return sources[0]


def verify_bundle(bundle_root: Path) -> dict[str, object]:
    manifest_path = bundle_root / "bundle-manifest.json"
    if not manifest_path.is_file():
        raise RuntimeError("training bundle is missing bundle-manifest.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected_versions = {
        "schemaVersion": 1,
        "dictionarySchemaVersion": 3,
        "neuralArtifactSchemaVersion": 4,
    }
    for key, expected in expected_versions.items():
        if manifest.get(key) != expected:
            raise RuntimeError(f"training bundle {key} must be {expected}, got {manifest.get(key)!r}")
    contract_identity = (manifest.get("contractSchemaVersion"), manifest.get("featureSchemaVersion"))
    if contract_identity not in {(3, 2), (4, 4)}:
        raise RuntimeError(f"unsupported training bundle contract identity {contract_identity}")
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise RuntimeError("training bundle manifest has no files")
    for entry in files:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            raise RuntimeError("training bundle manifest contains an invalid file entry")
        relative_path = Path(entry["path"])
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise RuntimeError(f"training bundle manifest contains an unsafe path: {relative_path}")
        file_path = bundle_root / relative_path
        if not file_path.is_file():
            raise RuntimeError(f"training bundle is missing {relative_path}")
        digest = hashlib.sha256()
        with file_path.open("rb") as input_file:
            while chunk := input_file.read(1024 * 1024):
                digest.update(chunk)
        if digest.hexdigest() != entry.get("sha256"):
            raise RuntimeError(f"training bundle checksum mismatch for {relative_path}")
        if file_path.stat().st_size != entry.get("bytes"):
            raise RuntimeError(f"training bundle byte count mismatch for {relative_path}")
    return manifest


def materialize_training_bundle(input_root: Path, bundle_root: Path) -> tuple[dict[str, object], str]:
    source_kind, source_path = find_training_source(input_root)
    shutil.rmtree(bundle_root, ignore_errors=True)
    if source_kind == "archive":
        bundle_root.mkdir(parents=True)
        with zipfile.ZipFile(source_path) as archive:
            for member in archive.infolist():
                member_path = Path(member.filename)
                if member_path.is_absolute() or ".." in member_path.parts:
                    raise RuntimeError(f"training bundle archive contains an unsafe path: {member.filename}")
            archive.extractall(bundle_root)
    else:
        shutil.copytree(source_path, bundle_root)
    return verify_bundle(bundle_root), f"{source_kind}:{source_path}"


def build_training_command(
    bundle_root: Path,
    output_root: Path,
    profile: dict[str, int],
    seed: int,
    transfer_data: Path | None = None,
    transfer_pretrain_epochs: int | None = None,
    token_vocabulary: Path | None = None,
    init_model_dir: Path | None = None,
) -> list[str]:
    dictionary = bundle_root / "dictionary" / "er-combat-data-dictionary.json"
    dictionary_supplement = bundle_root / "dictionary" / "runtime-item-dictionary-supplement.json"
    data_dir = bundle_root / "data"
    trainer = bundle_root / "ml" / "policy" / "train_candidate_transformer.py"
    seed_output = output_root / f"seed-{seed}"
    batch_size = effective_batch_size(profile, init_model_dir is not None)
    command = [
        sys.executable,
        str(trainer),
        "--data",
        str(data_dir),
        "--dictionary",
        str(dictionary),
        "--output-dir",
        str(seed_output),
        "--elite-rollouts",
        "--device",
        "cuda",
        "--seed",
        str(seed),
        "--epochs",
        str(profile["epochs"]),
        "--patience",
        str(profile["patience"]),
        "--batch-size",
        str(batch_size),
        "--gradient-accumulation-steps",
        str(profile["gradient_accumulation_steps"]),
        "--d-model",
        str(profile["d_model"]),
        "--layers",
        str(profile["layers"]),
        "--heads",
        str(profile["heads"]),
        "--feedforward",
        str(profile["feedforward"]),
        "--history-length",
        str(profile["history_length"]),
        "--trajectory-layers",
        str(profile["trajectory_layers"]),
        "--loss-policy-weight",
        "1",
        "--unknown-policy-weight",
        "1",
        "--numeric-feature-profile",
        "semantic",
        "--fast-kernels",
    ]
    if dictionary_supplement.is_file():
        command.extend(["--dictionary-supplement", str(dictionary_supplement)])
    if init_model_dir is None:
        command.append("--amp")
    if transfer_data is not None:
        command.extend(
            [
                "--transfer-data",
                str(transfer_data),
                "--transfer-mode",
                "pretrain",
                "--transfer-pretrain-epochs",
                str(
                    profile["transfer_pretrain_epochs"]
                    if transfer_pretrain_epochs is None
                    else transfer_pretrain_epochs
                ),
            ]
        )
    if token_vocabulary is not None:
        command.extend(["--token-vocabulary", str(token_vocabulary)])
    if init_model_dir is not None:
        command.extend(["--init-model-dir", str(init_model_dir)])
    return command


def effective_batch_size(profile: dict[str, int], checkpoint_resume: bool) -> int:
    if checkpoint_resume:
        return min(profile["batch_size"], profile.get("resume_batch_size", profile["batch_size"]))
    return profile["batch_size"]


def run_checked_streaming(command: list[str], cwd: Path, tail_lines: int = 200) -> None:
    """Stream child output live while retaining a bounded diagnostic tail."""
    process = subprocess.Popen(
        command,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    tail: deque[str] = deque(maxlen=tail_lines)
    assert process.stdout is not None
    for line in process.stdout:
        print(line, end="", flush=True)
        tail.append(line.rstrip())
    process.stdout.close()
    return_code = process.wait()
    if return_code:
        command_name = Path(command[1] if len(command) > 1 else command[0]).name
        rendered_tail = "\n".join(tail)
        raise RuntimeError(
            f"{command_name} exited with status {return_code}; last child output:\n{rendered_tail}"
        )


def run_training(
    bundle_root: Path,
    output_root: Path,
    profile_name: str,
    seeds: list[int],
    transfer_pretrain_epochs: int | None = None,
) -> None:
    profile = PROFILES.get(profile_name)
    if profile is None:
        raise RuntimeError(f"unknown ER_AI_PROFILE {profile_name!r}; expected one of {sorted(PROFILES)}")
    dictionary = bundle_root / "dictionary" / "er-combat-data-dictionary.json"
    data_dir = bundle_root / "data"
    trainer = bundle_root / "ml" / "policy" / "train_candidate_transformer.py"
    transfer_data = bundle_root / "transfer-data"
    token_vocabulary = bundle_root / "vocabulary" / "token-vocabulary.json"
    init_model_dir = bundle_root / "initial-model"
    has_transfer_data = transfer_data.is_dir() and any(
        path.name.endswith(".jsonl")
        or path.name.endswith(".jsonl.gz")
        or path.name.endswith(".jsonl.gzpack")
        for path in transfer_data.rglob("*")
        if path.is_file()
    )
    has_er_data = any(
        path.name.endswith(".jsonl")
        or path.name.endswith(".jsonl.gz")
        or path.name.endswith(".jsonl.gzpack")
        for path in data_dir.rglob("*")
        if path.is_file()
    )
    if not dictionary.is_file() or not trainer.is_file() or not has_er_data:
        raise RuntimeError("training bundle is missing its dictionary, trainer, or JSONL decisions")

    for seed in seeds:
        seed_output = output_root / f"seed-{seed}"
        command = build_training_command(
            bundle_root,
            output_root,
            profile,
            seed,
            transfer_data if has_transfer_data else None,
            transfer_pretrain_epochs,
            token_vocabulary if token_vocabulary.is_file() else None,
            init_model_dir if (init_model_dir / "config.json").is_file() else None,
        )
        run_checked_streaming(command, bundle_root)
        report = json.loads((seed_output / "report.json").read_text(encoding="utf-8"))
        if not str(report.get("device", "")).startswith("cuda"):
            raise RuntimeError(f"seed {seed} did not train on CUDA")

    if len(seeds) > 1:
        run_checked_streaming(
            [
                sys.executable,
                str(bundle_root / "ml" / "policy" / "build_candidate_ensemble.py"),
                "--root",
                str(output_root),
            ],
            bundle_root,
        )


def main() -> None:
    ensure_cuda_runtime_compatible()
    prove_cuda_runtime()
    input_root = Path(required_environment("KAGGLE_INPUT_PATH", "/kaggle/input"))
    working_root = Path(required_environment("KAGGLE_WORKING_PATH", "/kaggle/working"))
    bundle_root = temporary_bundle_root()
    output_root = working_root / "er-ai-candidate-transformer"
    shutil.rmtree(output_root, ignore_errors=True)
    output_root.mkdir(parents=True)
    manifest, bundle_source = materialize_training_bundle(input_root, bundle_root)
    profile = required_environment("ER_AI_PROFILE", manifest.get("trainingProfile", "large"))
    profile_config = PROFILES.get(profile)
    if profile_config is None:
        raise RuntimeError(f"unknown ER_AI_PROFILE {profile!r}; expected one of {sorted(PROFILES)}")
    default_seeds = ",".join(str(seed) for seed in manifest.get("seeds", [20260730, 20260731, 20260732]))
    seeds = [int(value) for value in required_environment("ER_AI_SEEDS", default_seeds).split(",")]
    if len(set(seeds)) != len(seeds):
        raise RuntimeError("ER_AI_SEEDS must be unique")
    transfer_pretrain_epochs = int(
        required_environment(
            "ER_AI_TRANSFER_PRETRAIN_EPOCHS",
            str(manifest.get("transferPretrainEpochs", profile_config["transfer_pretrain_epochs"])),
        )
    )
    if transfer_pretrain_epochs < 0:
        raise RuntimeError("ER_AI_TRANSFER_PRETRAIN_EPOCHS must be non-negative")
    checkpoint_resume = (bundle_root / "initial-model" / "config.json").is_file()
    batch_size = effective_batch_size(profile_config, checkpoint_resume)
    amp_enabled = not checkpoint_resume

    print(
        json.dumps(
            {
                "cuda": torch.cuda.get_device_name(0),
                "profile": profile,
                "seeds": seeds,
                "bundle": bundle_source,
                "transferPretrainEpochs": transfer_pretrain_epochs,
                "batchSize": batch_size,
                "checkpointResume": checkpoint_resume,
                "amp": amp_enabled,
                "policyObjective": "all-human-behavior-cloning",
                "lossPolicyWeight": 1.0,
                "unknownOutcomePolicyWeight": 1.0,
            }
        ),
        flush=True,
    )
    run_training(bundle_root, output_root, profile, seeds, transfer_pretrain_epochs)
    (output_root / "kaggle-run.json").write_text(
        json.dumps(
            {
                "profile": profile,
                "seeds": seeds,
                "cudaDevice": torch.cuda.get_device_name(0),
                "torchVersion": torch.__version__,
                "transferPretrainEpochs": transfer_pretrain_epochs,
                "batchSize": batch_size,
                "checkpointResume": checkpoint_resume,
                "amp": amp_enabled,
                "policyObjective": "all-human-behavior-cloning",
                "lossPolicyWeight": 1.0,
                "unknownOutcomePolicyWeight": 1.0,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def run_with_failure_report() -> None:
    try:
        main()
    except Exception as error:
        working_root = Path(os.environ.get("KAGGLE_WORKING_PATH", "/kaggle/working"))
        output_root = working_root / "er-ai-candidate-transformer"
        output_root.mkdir(parents=True, exist_ok=True)
        (output_root / "failure.json").write_text(
            json.dumps(
                {
                    "exceptionType": type(error).__name__,
                    "message": str(error),
                    "traceback": traceback.format_exc().splitlines()[-120:],
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        raise


if __name__ == "__main__":
    run_with_failure_report()
