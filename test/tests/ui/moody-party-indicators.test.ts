import type { MoodyBoonInstance } from "#data/elite-redux/moody/moody-types";
import {
  buildMoodyPartySlotPresentation,
  getMoodyPartySlotPresentation,
  resolveMoodyPartyMessageLayout,
  resolvePartySlotY,
} from "#ui/handlers/party-ui-handler";
import { describe, expect, it } from "vitest";

function boon(boonId: string, acquiredAtWave: number, rank: 1 | 2 | 3 = 1, evolutionId?: string): MoodyBoonInstance {
  return {
    instanceId: `${boonId}-${acquiredAtWave}`,
    boonId,
    rank,
    acquiredAtWave,
    ...(evolutionId == null ? {} : { evolutionId }),
  };
}

describe("Moody party-card indicators", () => {
  it("has no presentation when Moody Mode is disabled", () => {
    expect(getMoodyPartySlotPresentation(1, 0, false)).toBeNull();
  });

  it("orders compact markers by rarity and aggregates overflow", () => {
    const presentation = buildMoodyPartySlotPresentation([
      boon("crowned-vanguard", 10),
      boon("echo-seat", 20),
      boon("sanctuary-seat", 30),
      boon("bastion-seat", 40),
      boon("relay-seat", 50),
    ]);

    expect(presentation?.indicators.map(indicator => indicator.rarity)).toEqual(["master", "ultra", "great"]);
    expect(presentation?.overflow).toBe(2);
    expect(presentation?.borderColor).toBe(presentation?.indicators[0].color);
    expect(presentation?.summary).toContain("Sanctuary Seat");
    expect(presentation?.summary).toContain("+3");
    expect(presentation?.effectLabels).toEqual([
      "Sanctuary Seat",
      "Echo Seat",
      "Crowned Vanguard",
      "Bastion Seat",
      "Relay Seat",
    ]);
  });

  it("keeps dormant effects visible and marks their compact presentation", () => {
    const dormant = { ...boon("crowned-vanguard", 10), dormant: true };
    const presentation = buildMoodyPartySlotPresentation([dormant]);

    expect(presentation?.indicators[0]).toMatchObject({ dormant: true });
    expect(presentation?.summary).toContain("[Dormant]");
  });

  it("uses rank and evolution labels from the catalog", () => {
    expect(buildMoodyPartySlotPresentation([boon("crowned-vanguard", 10, 2)])?.summary).toContain(
      "Crowned Vanguard II",
    );
    expect(buildMoodyPartySlotPresentation([boon("crowned-vanguard", 10, 3, "royal-vanguard")])?.summary).toContain(
      "Royal Vanguard",
    );
  });

  it("surfaces live boon counters in the selected Pokemon detail", () => {
    const mithridatism = {
      ...boon("mithridatism", 10),
      progress: { counters: { "cures.poison": 1 } },
    };
    expect(buildMoodyPartySlotPresentation([mithridatism])?.effectLabels).toContain(
      "Mithridatism - Poison: 1/3 cures - Resistance I at 3 (50% prevention)",
    );
  });

  it("centers a lone reserve and keeps a full five-reserve column within the viewport", () => {
    expect(resolvePartySlotY(3, 3, 4, false, false)).toBe(-115);
    const fiveReserveYs = Array.from({ length: 5 }, (_, index) => resolvePartySlotY(index + 3, 3, 8, false, false));
    expect(fiveReserveYs[0]).toBe(-168);
    expect(fiveReserveYs.at(-1)).toBe(-62);
  });

  it("keeps all three compact active cards above the Moody details box", () => {
    expect(Array.from({ length: 3 }, (_, index) => resolvePartySlotY(index, 3, 4, false, false))).toEqual([
      -164, -127, -90,
    ]);
  });

  it("grows and densifies the Moody detail box only as effect content increases", () => {
    const short = resolveMoodyPartyMessageLayout(1, 20);
    const dense = resolveMoodyPartyMessageLayout(10, 420);
    expect(Number.parseInt(short.fontSize)).toBeGreaterThan(Number.parseInt(dense.fontSize));
    expect(short.boxHeight).toBeLessThan(dense.boxHeight);
    expect(dense.visibleEffects).toBe(12);
  });
});
