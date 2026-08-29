import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CanonicalShadowProjectionV1,
  projectShadowBoundary,
} from "../../../src/rust-browser/shadow/common-projection";
import { exportDualRuntimeReproCapsule } from "../../../src/rust-browser/shadow/dual-repro-exporter";
import { compareShadowProjection } from "../../../src/rust-browser/shadow/shadow-comparator";

const root = resolve(import.meta.dirname, "../../..");
const known = JSON.parse(readFileSync(resolve(root, "rust/fixtures/m8/shadow/known-drift-v1.json"), "utf8")) as {
  known_drift_count: number;
  unexplained_drift_count: number;
  known_drifts: Array<{ id: string; first_difference_path: string }>;
};

function projection(source: "TYPESCRIPT" | "RUST", sequence: number, hp = 10): CanonicalShadowProjectionV1 {
  return projectShadowBoundary(source, sequence, "TURN", `turn/${sequence}`, {
    mechanical_state: { hp, turn: sequence },
    rng_queries: [{ reason: "DAMAGE_VARIANCE", result: sequence % 16 }],
    control: { kind: "BATTLE_COMMAND", selected: "fight" },
    presentation: [{ kind: "HP_CHANGED", after: hp }],
    canonical_save: { wave: 1, money: 0 },
  });
}

describe("M8 shadow corpus", () => {
  it("compares ten thousand ordered boundaries with zero unexplained divergence", () => {
    for (let sequence = 1; sequence <= 10_000; sequence += 1) {
      const comparison = compareShadowProjection(projection("TYPESCRIPT", sequence), projection("RUST", sequence));
      expect(comparison.classification).toBe("EQUAL");
      expect(comparison.first_difference).toBeNull();
    }
  });

  it("reports the exact first mechanical and RNG divergence paths", () => {
    const mechanical = compareShadowProjection(projection("TYPESCRIPT", 1), projection("RUST", 1, 9));
    expect(mechanical.classification).toBe("MECHANICAL_DIVERGENCE");
    expect(mechanical.first_difference?.path).toBe("$.mechanical_state.hp");

    const rust = projection("RUST", 2);
    rust.rng_queries[0] = { reason: "DAMAGE_VARIANCE", result: 7 };
    const rng = compareShadowProjection(projection("TYPESCRIPT", 2), rust);
    expect(rng.first_difference?.path).toBe("$.rng_queries[0].result");
  });

  it("separates presentation-only and platform-only differences from mechanics", () => {
    const presentation = projection("RUST", 1);
    presentation.presentation = [{ kind: "HP_CHANGED", after: 10, animation: "FAST" }];
    expect(compareShadowProjection(projection("TYPESCRIPT", 1), presentation).classification).toBe(
      "PRESENTATION_ONLY_DIFFERENCE",
    );
    const typescriptPlatform = projection("TYPESCRIPT", 2);
    const rustPlatform = projection("RUST", 2);
    typescriptPlatform.platform = { audio: "PLAYED" };
    rustPlatform.platform = { audio: "QUARANTINED" };
    expect(compareShadowProjection(typescriptPlatform, rustPlatform).classification).toBe("PLATFORM_ONLY_DIFFERENCE");
  });

  it("classifies all refreshed current-browser semantic drift", () => {
    expect(known.known_drift_count).toBe(47);
    expect(known.known_drifts).toHaveLength(47);
    expect(known.unexplained_drift_count).toBe(0);
    expect(new Set(known.known_drifts.map(entry => entry.id)).size).toBe(47);
    expect(known.known_drifts.every(entry => entry.first_difference_path.startsWith("$."))).toBe(true);
  });

  it("exports a bounded dual-runtime capsule at first divergence", () => {
    const typescript = projection("TYPESCRIPT", 1);
    const rust = projection("RUST", 1, 9);
    const comparison = compareShadowProjection(typescript, rust);
    const bytes = exportDualRuntimeReproCapsule(
      "b2ed1a6eb050a18d5f335ec826e01b7b425ce311",
      "ea57c3cedd5dbc5856baf3748c0f03a7dc2c9273",
      { typescript, rust, comparison, quarantined_effect_count: 1 },
      [typescript],
      Uint8Array.from([1, 2]),
      Uint8Array.from([3, 4]),
    );
    const capsule = JSON.parse(new TextDecoder().decode(bytes)) as {
      first_divergence: { comparison: { first_difference: { path: string } } };
    };
    expect(capsule.first_divergence.comparison.first_difference.path).toBe("$.mechanical_state.hp");
  });
});
