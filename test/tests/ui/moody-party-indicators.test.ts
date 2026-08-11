import type { MoodyBoonInstance } from "#data/elite-redux/moody/moody-types";
import { buildMoodyPartySlotPresentation, getMoodyPartySlotPresentation } from "#ui/handlers/party-ui-handler";
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
});
