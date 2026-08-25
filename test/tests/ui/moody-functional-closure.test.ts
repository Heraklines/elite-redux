import { formatMoodyCursedStackLine, parseMoodyItemStackId } from "#data/elite-redux/moody/moody-live-ui-bridge";
import type { MoodyRuntimeCommand } from "#data/elite-redux/moody/moody-runtime-field";
import { buildMoodyFinalDraftChoiceModel } from "#phases/moody-formation-choice-phase";
import { buildMoodyRuntimeChoiceModel } from "#phases/moody-runtime-choice-phase";
import { buildMoodyActiveBattlerOverlays } from "#ui/moody/moody-runtime-ui";
import { describe, expect, it, vi } from "vitest";

vi.mock("#app/global-scene", () => ({ globalScene: {} }));
vi.mock("#app/phase", () => ({ Phase: class {} }));
vi.mock("#constants/app-constants", () => ({ isDev: false }));
vi.mock("#data/data-lists", () => ({ allMoves: [] }));
vi.mock("#data/elite-redux/er-fun-mode", () => ({
  getFunModeConfig: () => ({ moodyMode: false }),
  isFunDebugModeActive: () => false,
}));
vi.mock("#data/elite-redux/moody/moody-enemy", () => ({ getMoodyEnemyBoonLoadout: () => null }));
vi.mock("#data/elite-redux/moody/moody-formation-game-adapter", () => ({
  getMoodyFormationHudSnapshot: () => ({ activePlayer: [] }),
}));
vi.mock("#data/elite-redux/moody/moody-runtime-field-adapter", () => ({
  deserializeMoodyRuntimeFieldState: () => ({ numbers: {} }),
}));
vi.mock("#data/elite-redux/moody/moody-runtime-live-adapter", () => ({
  consumeCurrentMoodyLiveProjection: () => null,
  getCurrentMoodyLiveProjection: () => null,
}));
vi.mock("#data/elite-redux/moody/moody-state", () => ({
  getMoodyModeState: () => null,
  MOODY_BOON_BY_ID: new Map(),
  MOODY_CURSE_BY_ID: new Map(),
}));
vi.mock("#phases/moody-section-report-phase", () => ({ MoodySectionReportPhase: class {} }));
vi.mock("#ui/moody/moody-battle-hud", () => ({ createMoodyBattleHud: vi.fn() }));

describe("Moody functional UI closure", () => {
  it("builds descriptive, queued runtime choices", () => {
    const command: MoodyRuntimeCommand = {
      kind: "request-weather-choice",
      effectId: "microclimate",
      subjectId: 7,
      options: ["rain", "sandstorm"],
      durationTurns: 3,
      data: { queueIndex: 2, queueTotal: 3 },
    };

    const model = buildMoodyRuntimeChoiceModel(command, "Castform");
    expect(model).toMatchObject({ title: "MICROCLIMATE", queueLabel: "Decision 2 / 3", cancellable: false });
    expect(model.prompt).toContain("Castform");
    expect(model.options[0]).toMatchObject({ id: "rain", label: "Rain" });
    expect(model.options[0].description).toContain("3 turns");
    expect(model.options[0].costLine).toContain("replaces the current weather");
  });

  it("describes both rank-two Final Draft effects and Director's Cut consequence", () => {
    const model = buildMoodyFinalDraftChoiceModel(["climax", "precision", "revision"], 2, 0, true);

    expect(model.queueLabel).toBe("Decision 1 / 2");
    expect(model.options.find(option => option.id === "climax")?.description).toContain("130% power");
    expect(model.options.find(option => option.id === "precision")?.description).toContain("20% power");
    expect(model.options.find(option => option.id === "revision")?.costLine).toContain("15% maximum HP");
    expect(model.options.every(option => option.costLine?.includes("unusable for this battle") === true)).toBe(true);
  });

  it("models formation and field overlays for every active battler with exact debt timing", () => {
    const overlays = buildMoodyActiveBattlerOverlays(
      [
        { pokemonId: 1, name: "Alpha" },
        { pokemonId: 2, name: "Beta" },
        { pokemonId: 3, name: "Gamma" },
      ],
      {
        "field:runtime-barrier:pokemon:1:amount": 12,
        "persistent:deferred-pain:pokemon:2:debt": 30,
        "persistent:deferred-pain:pokemon:2:due": 8,
      },
      [
        { pokemonId: 1, barrier: 8, marks: { "1:formation:charged": true } },
        { pokemonId: 2, barrier: 0, marks: {} },
        { pokemonId: 3, barrier: 4, marks: {} },
      ],
      { "3": [0.5] },
      6,
    );

    expect(overlays).toHaveLength(3);
    expect(overlays[0].hpOverlay.barrier).toBe(20);
    expect(overlays[1].hpOverlay).toMatchObject({ damageDebt: 30, debtDueLabel: "due in 2 turns" });
    expect(overlays[2].tracker.value).toContain("APEX x1");
  });

  it("turns cursed inventory stack IDs into player-facing report labels", () => {
    expect(parseMoodyItemStackId("42:LEFTOVERS")).toEqual({ pokemonId: "42", itemTypeId: "LEFTOVERS" });
    expect(formatMoodyCursedStackLine("Eevee", "Leftovers")).toBe("Leftovers disabled on Eevee");
  });
});
