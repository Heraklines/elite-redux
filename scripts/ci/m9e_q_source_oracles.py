"""Prepare the pinned source-derived inputs used by the full M9 Rust shards."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
# label, generator hash, output hash, number of independently observed cases
ORACLES = {
    "standard-score": (
        "m9e_standard_score_oracle.mjs",
        "9aca9f070392b1f442face1ea9d9df6832cc81c7b79d0ef93d990206dccdf513",
        "f39e0d878f2a93b49654dce7432d66ff04a3cf45f7d4800d81793d4e6770bcdd", 1280,
    ),
    "party-xp": (
        "m9e_party_xp_oracle.mjs",
        "fde49b764fb994551eb8bf2128f175f63edcee9fdeb16b46d9a36046848774bb",
        "80658168c8fa7638b481a97e370ff5e8b7cb383342c6374bd31a7037e225b0da", 144,
    ),
    "current-move-targets": (
        "m9e_current_move_targets_oracle.mjs",
        "8bf5b940e404061769d6da25e1a5b22217354d3e85db5c9c6be2f88291d85cf1",
        "a907b43f1411c093ba91e3ecfd2537384acdafd51ca8dcf650c53a3b1773c031", 200,
    ),
    "starter-pokerus": (
        "m9e_starter_pokerus_oracle.mjs",
        "e78726b93b24e5b2d3b96d3305f65facf58357a90d099403c07581ff5b7f2fb4",
        "9adc63e729ec0dd3bbe020254a9f5769fb6dd05046cf707dab9bb4f2bce81ccf", 4,
    ),
    "phase-tree": (
        "m9e_phase_tree_oracle.mjs",
        "5bbf7fb65b4e2ccb884759401b13f3bc008c7cde9b73226e823d8e0f57640283",
        "990c841e87d3224092011b3ad1c256acbae782b08324d6bfd5adadf9ab6854a2", 64,
    ),
    "phase-tree-queries": (
        "m9e_phase_tree_queries_oracle.mjs",
        "60fb414013144cb5a8491013ea454506243ca63ad99d0cda41a91bbae14dbc90",
        "36688bb3ca23174aa75f4bb837174b045dd13a488c9c00129254dcb5219aa1b3", 64,
    ),
    "phase-xp": (
        "m9e_phase_xp_oracle.mjs",
        "3ed5c17839b010e5f90fa6325b5c6bc3f2fdacdbf0b9a8ae9bbf39ec30eac768",
        "2ed825e0157992c7aab24bfe7552fa055e024a3410137bdbfa0e4d3f48c9edbf", 336,
    ),
    "held-xp": (
        "m9e_held_xp_oracle.mjs",
        "7161541ef0510c118bf77cb5de26d1b6f4a0db53b0a115627ef3b0a8e7e4b9a3",
        "6d606819d2100cb5ddeefa76108c1866a73ea72efa495d80123b6279f78a2603", 288,
    ),
}


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("expected an output directory")
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=False)
    rows = {}
    for label, (script_name, script_sha, output_sha, cases) in ORACLES.items():
        script = ROOT / "scripts/ci" / script_name
        if sha(script.read_bytes()) != script_sha:
            raise RuntimeError(f"{label} generator differs from its qualified source")
        directory = output / label
        directory.mkdir()
        target = directory / "source-cases.tsv"
        result = subprocess.run(
            ["node", "--disable-warning=ExperimentalWarning", str(script), str(target)],
            cwd=ROOT, check=True, capture_output=True, timeout=180,
        )
        receipt = json.loads(result.stdout)
        raw = target.read_bytes()
        if (receipt.get("runtime") != "v24.9.0" or receipt.get("cases") != cases
                or receipt.get("output_bytes") != len(raw) or not 0 < len(raw) <= 262144
                or receipt.get("output_sha256") != output_sha or sha(raw) != output_sha):
            raise RuntimeError(f"{label} source observations differ")
        rows[label] = {"cases": cases, "bytes": len(raw), "sha256": output_sha}
    (output / "manifest.json").write_text(json.dumps(rows, sort_keys=True) + "\n")
    print(json.dumps(rows, sort_keys=True))


if __name__ == "__main__":
    main()
