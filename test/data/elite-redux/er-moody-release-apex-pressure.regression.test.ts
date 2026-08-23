import {
  applyMoodyRuntimeStateDeltas,
  type MoodyRuntimeState,
  resolveMoodyRuntimeEffect,
} from "#data/elite-redux/moody/moody-runtime-meta";
import { buildMoodyActiveBattlerOverlays } from "#ui/moody/moody-runtime-ui";
import { describe, expect, it } from "vitest";

function segmentedBoss(state: MoodyRuntimeState = {}) {
  const result = resolveMoodyRuntimeEffect(
    "apex-plunder",
    "segment-hoard",
    { kind: "segmented-boss-defeated", seed: 1, data: { pokemonId: "7" } },
    state,
  );
  return { result, state: applyMoodyRuntimeStateDeltas(state, result.stateDeltas) };
}

describe("Moody release blocker: Apex Plunder accumulation", () => {
  it("adds one Segment Hoard charge per segmented boss defeat", () => {
    const first = segmentedBoss();
    expect(first.result.commands[0].data).toMatchObject({ pokemonId: "7", segments: 1, hpFractions: [0.25] });
    expect(first.state.values?.apexSegments).toEqual([0.25]);

    const second = segmentedBoss(first.state);
    expect(second.state.values?.apexSegments).toEqual([0.25, 0.25]);
  });

  it("does not overwrite or exceed two stored Segment Hoard charges", () => {
    const full: MoodyRuntimeState = { values: { apexSegments: [0.25, 0.25] } };
    const result = segmentedBoss(full);
    expect(result.result.commands).toEqual([]);
    expect(result.state.values?.apexSegments).toEqual([0.25, 0.25]);
  });
});

describe("Moody release blocker: Pressure Valve accumulation and HUD", () => {
  it("converts cumulative Overpressure stages into a queued move charge", () => {
    const previous: MoodyRuntimeState = { counters: { overflowStages: 2 } };
    const result = resolveMoodyRuntimeEffect(
      "pressure-valve",
      "overpressure",
      {
        kind: "positive-stat-overflow",
        seed: 1,
        data: { pokemonId: "7", overflowStages: 1, selectedValve: "barrier", mostUsefulValve: "barrier" },
      },
      previous,
    );
    const next = applyMoodyRuntimeStateDeltas(previous, result.stateDeltas);

    expect(result.commands).toContainEqual({ kind: "queue-next-move-power", data: { multiplier: 1.5, charges: 1 } });
    expect(next.counters?.overflowStages).toBe(0);
  });

  it("preserves the remainder when one event crosses multiple cumulative thresholds", () => {
    const previous: MoodyRuntimeState = { counters: { overflowStages: 2 } };
    const result = resolveMoodyRuntimeEffect(
      "pressure-valve",
      "overpressure",
      {
        kind: "positive-stat-overflow",
        seed: 1,
        data: { pokemonId: "7", overflowStages: 5, selectedValve: "barrier", mostUsefulValve: "barrier" },
      },
      previous,
    );
    const next = applyMoodyRuntimeStateDeltas(previous, result.stateDeltas);

    expect(result.commands).toContainEqual({ kind: "queue-next-move-power", data: { multiplier: 1.5, charges: 2 } });
    expect(next.counters?.overflowStages).toBe(1);
  });

  it("includes coordinator Pressure Valve barriers in the active HP overlay", () => {
    const build = buildMoodyActiveBattlerOverlays as unknown as (
      active: readonly { pokemonId: number; name: string }[],
      fieldNumbers: Readonly<Record<string, number>>,
      formation: readonly unknown[],
      apex: Readonly<Record<string, readonly number[]>>,
      turn: number,
      coordinatorBarriers: Readonly<Record<string, number>>,
    ) => ReturnType<typeof buildMoodyActiveBattlerOverlays>;
    const overlays = build([{ pokemonId: 7, name: "Eevee" }], {}, [], {}, 1, { "7": 24 });

    expect(overlays).toHaveLength(1);
    expect(overlays[0].hpOverlay.barrier).toBe(24);
    expect(overlays[0].tracker.value).toContain("barrier 24");
  });
});
