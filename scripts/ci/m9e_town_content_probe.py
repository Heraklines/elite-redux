"""Observe the compiled V2 Town pool on a remote runner without local fixtures."""

import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ["RUNNER_TEMP"]) / "m9e-town-content"
FIXTURE = ROOT / "rust/fixtures/m9/engineering/game-content-bundle-v2.json"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    OUT.mkdir(parents=True, exist_ok=False)
    result = {"schema": 1, "source_sha": os.environ["GITHUB_SHA"], "status": "failed"}
    try:
        actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        if actual != result["source_sha"] or subprocess.check_output(
            ["git", "status", "--porcelain"], cwd=ROOT
        ).strip():
            raise RuntimeError("exact clean source checkout required")
        raw = FIXTURE.read_bytes()
        if not 0 < len(raw) < (24 << 20):
            raise RuntimeError("unexpected bounded V2 fixture size")
        bundle = json.loads(raw)
        world = bundle["world"]
        biomes = world["biomes"]
        if not isinstance(biomes, list) or not 1 <= len(biomes) <= 512:
            raise RuntimeError("unexpected V2 biome inventory")
        town = [row for row in biomes if row.get("key") == "biome/0"]
        if len(town) != 1 or not isinstance(town[0].get("pokemon_pools"), list):
            raise RuntimeError("unique prepared Town pool absent")
        pools = town[0]["pokemon_pools"]
        if not 1 <= len(pools) <= 128:
            raise RuntimeError("unexpected Town pool count")
        rows = []
        for pool in pools:
            species = pool["species"]
            if (not isinstance(species, list) or len(species) > 256
                    or any(type(value) is not int or value < 1 for value in species)):
                raise RuntimeError("unsupported bounded Town species shape")
            rows.append({"tier": pool["tier"], "time": pool["time_of_day"], "species": species})
        result.update({
            "status": "passed", "fixture_bytes": len(raw), "fixture_sha256": sha(raw),
            "world_oracle_sha": world.get("oracle_sha"), "town_id": town[0]["id"],
            "town_pools": rows, "source_bindings": {
                "workflow_sha256": sha((ROOT / ".github/workflows/m9e-town-content-probe.yml").read_bytes()),
                "harness_sha256": sha(Path(__file__).read_bytes()),
            },
        })
    except Exception as error:
        result["first_failure"] = str(error)[:512]
    encoded = (json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if len(encoded) > 16384:
        raise RuntimeError("Town observation exceeds compact bound")
    (OUT / "summary.json").write_bytes(encoded)
    if result["status"] != "passed":
        raise RuntimeError(result["first_failure"])


if __name__ == "__main__":
    main()
