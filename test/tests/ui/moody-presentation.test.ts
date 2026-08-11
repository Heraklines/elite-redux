import { MOODY_BOON_BY_ID } from "#data/elite-redux/moody/moody-state";
import type { MoodyBoonInstance, MoodyBoonOffer, MoodyModeSaveData } from "#data/elite-redux/moody/moody-types";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import {
  buildMoodyBadge,
  buildMoodyBarrierLayout,
  buildMoodyEnemyPanelRows,
  buildMoodyFeed,
  buildMoodyHistoryRows,
  buildMoodyOfferCard,
  buildMoodyOverviewRows,
  buildMoodyTransitionReport,
  groupMoodyBadges,
  inferMoodyCadence,
  MOODY_CADENCE_LABEL,
  MOODY_LEDGER_TABS,
  MOODY_SCOPE_GLYPH,
  MOODY_STATE_GLYPH,
  MOODY_TARGET_LABEL,
  moodyClampScroll,
  moodyOptionRowText,
  moodyPageCount,
  moodyPairEmblem,
  moodyProgressLines,
  moodyTargetSummary,
  moodyWrapText,
  orderMoodyTrackerChips,
} from "#ui/moody/moody-presentation";
import { describe, expect, it } from "vitest";

function boon(boonId: string, wave: number, extra: Partial<MoodyBoonInstance> = {}): MoodyBoonInstance {
  return { instanceId: `t-${boonId}-${wave}`, boonId, rank: 1, acquiredAtWave: wave, ...extra };
}

function state(boons: MoodyBoonInstance[] = []): MoodyModeSaveData {
  return {
    version: 1,
    seed: 1,
    acquisitionRolls: boons.length,
    draftIndex: 0,
    boons,
    curses: [],
    recentThreat: [],
  };
}

describe("Moody presentation: scope/state glyph + text parity", () => {
  it("every target kind has a glyph AND a label (no color-only scope)", () => {
    for (const definition of MOODY_BOON_BY_ID.values()) {
      expect(MOODY_SCOPE_GLYPH[definition.targetKind], definition.id).toBeTruthy();
      expect(MOODY_TARGET_LABEL[definition.targetKind], definition.id).toMatch(/^TARGET: /);
    }
  });

  it("every effect state has a glyph distinct from its label", () => {
    const glyphs = Object.values(MOODY_STATE_GLYPH);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("cadence inference covers battle/biome/run text", () => {
    const bastion = MOODY_BOON_BY_ID.get("bastion-seat")!;
    expect(inferMoodyCadence(bastion)).toBe("battle");
    expect(MOODY_CADENCE_LABEL[inferMoodyCadence(bastion)]).toBe("ONCE / BATTLE");
  });
});

describe("Moody presentation: effect badges", () => {
  it("dormant boons render the dormant state with moon glyph", () => {
    const badge = buildMoodyBadge(boon("bastion-seat", 10, { dormant: true, target: { partySlots: [0] } }));
    expect(badge.state).toBe("dormant");
    expect(badge.badgeText).toContain("☾");
    expect(badge.detail).toContain("Mood Swing");
  });

  it("targeted boons without a binding render invalid", () => {
    const badge = buildMoodyBadge(boon("bastion-seat", 10));
    expect(badge.state).toBe("invalid");
  });

  it("counter progress surfaces on the badge", () => {
    const badge = buildMoodyBadge(
      boon("chosen-one", 10, { target: { pokemonIds: [1] }, progress: { counters: { glory: 8 } } }),
    );
    expect(badge.state).toBe("progress");
    expect(badge.progressText).toContain("8");
  });

  it("cooldown overrides take precedence over save data", () => {
    const badge = buildMoodyBadge(boon("bastion-seat", 10, { target: { partySlots: [0] } }), {
      state: "cooldown",
      cooldownTurns: 2,
    });
    expect(badge.state).toBe("cooldown");
    expect(badge.progressText).toBe("2 turns");
  });

  it("groups badges with a +N overflow", () => {
    const group = groupMoodyBadges(
      [
        boon("crowned-vanguard", 10, { target: { partySlots: [0] } }),
        boon("echo-seat", 20, { target: { partySlots: [0] } }),
        boon("sanctuary-seat", 30, { target: { partySlots: [0] } }),
        boon("bastion-seat", 40, { target: { partySlots: [0] } }),
        boon("relay-seat", 50, { target: { partySlots: [0] } }),
      ],
      3,
    );
    expect(group.badges).toHaveLength(3);
    expect(group.overflow).toBe(2);
    // Highest rarity first (master sanctuary-seat leads).
    expect(group.badges[0].name).toBe("Sanctuary Seat");
  });
});

describe("Moody presentation: offer cards", () => {
  it("hidden (cursed draft) cards leak no rarity/scope/target info", () => {
    const offer: MoodyBoonOffer = { offerId: "x", kind: "new", boonId: "bastion-seat", hidden: true };
    const card = buildMoodyOfferCard(offer);
    expect(card.cardState).toBe("hidden");
    expect(card.title).toBe("???");
    expect(card.rarity).toBeUndefined();
    expect(card.scopeGlyph).toBe("?");
    expect(card.targetLabel).toBe("TARGET: ?");
  });

  it("rank-up cards show only the concise upgrade delta", () => {
    const offer: MoodyBoonOffer = { offerId: "x", kind: "rank-up", boonId: "bastion-seat" };
    const card = buildMoodyOfferCard(offer);
    expect(card.cardStateLabel).toBe("RANK UP");
    expect(card.description).toBe("RANK I -> RANK II");
    expect(card.deltaLines).toHaveLength(1);
    expect(card.deltaLines[0]).toContain("UPGRADE ->");
    expect(card.deltaLines[0]).not.toContain("Rank I:");
  });

  it("replace cards explain the 12-line discard", () => {
    const offer: MoodyBoonOffer = { offerId: "x", kind: "replace", boonId: "bastion-seat" };
    const card = buildMoodyOfferCard(offer);
    expect(card.cardStateLabel).toBe("REPLACE REQUIRED");
    expect(card.deltaLines.join(" ")).toContain("12");
  });
});

describe("Moody presentation: quantified progress", () => {
  it("shows Mithridatism cure thresholds and active percentages", () => {
    const base = boon("mithridatism", 10, { progress: { counters: { "cures.poison": 2 } } });
    expect(moodyProgressLines(base)).toEqual(["Poison: 2/3 cures - Resistance I at 3 (50% prevention)"]);

    const resistant = boon("mithridatism", 10, { progress: { counters: { "cures.poison": 4 } } });
    expect(moodyProgressLines(resistant)).toEqual(["Poison: 4/6 cures - Resistance I active (50% prevention)"]);

    const evolved = boon("mithridatism", 10, {
      rank: 3,
      evolutionId: "weaponized-affliction",
      progress: { counters: { "cures.poison": 6 } },
    });
    expect(moodyProgressLines(evolved)).toEqual([
      "Poison: 6 cures - Resistance II, +25% damage, 20% damage reduction while afflicted",
    ]);
  });

  it("never exposes serialized runtime metadata as boon progress", () => {
    const instance = boon("chosen-one", 10, {
      progress: { counters: { glory: 4 }, values: { __moodyRuntimeValuesV1: "{}", in: "RXfyMEy4B0h0iAPpM3lziqGA2" } },
    });
    expect(moodyProgressLines(instance)).toEqual(["Glory: 4"]);
  });
});

describe("Moody presentation: paging math", () => {
  it("pageCount clamps to >= 1", () => {
    expect(moodyPageCount(0, 6)).toBe(1);
    expect(moodyPageCount(7, 6)).toBe(2);
    expect(moodyPageCount(6, 6)).toBe(1);
  });

  it("clampScroll keeps the cursor inside the window", () => {
    expect(moodyClampScroll(0, 3, 20, 6)).toBe(0);
    expect(moodyClampScroll(9, 3, 20, 6)).toBe(4);
    expect(moodyClampScroll(5, 3, 20, 6)).toBe(3);
    expect(moodyClampScroll(19, 30, 20, 6)).toBe(14);
  });

  it("wrapText breaks on word boundaries", () => {
    const lines = moodyWrapText("the quick brown fox jumps over", 11);
    expect(lines).toEqual(["the quick", "brown fox", "jumps over"]);
  });
});

describe("Moody presentation: Barrier HP geometry", () => {
  it("uses max HP and occupies the terminal part of the filled HP bar", () => {
    expect(buildMoodyBarrierLayout(40, 200, 0.75)).toEqual({
      hpRatio: 0.75,
      barrierRatio: 0.2,
      startRatio: 0.55,
    });
  });

  it("never paints beyond the current HP fill", () => {
    expect(buildMoodyBarrierLayout(80, 100, 0.25)).toEqual({
      hpRatio: 0.25,
      barrierRatio: 0.25,
      startRatio: 0,
    });
  });
});

describe("Moody presentation: target summaries and option rows", () => {
  it("renders slot + move + type summaries", () => {
    expect(moodyTargetSummary({ partySlots: [1], moveIds: [MoveId.FLAMETHROWER] })).toBe("slot 2 · Flamethrower");
    expect(moodyTargetSummary({ pokemonType: PokemonType.DRAGON })).toBe("Dragon foes");
    expect(moodyTargetSummary(undefined)).toBe("team");
  });

  it("ineligible options always carry the reason in their row text", () => {
    const row = moodyOptionRowText({ id: 1, label: "Pikachu", eligible: false, ineligibleReason: "already bound" });
    expect(row).toContain("already bound");
  });
});

describe("Moody presentation: feed and chips", () => {
  it("collapses simultaneous bursts into a summary while keeping order", () => {
    const feed = buildMoodyFeed(
      [4, 1, 3, 2, 5].map(order => ({ order, label: `effect ${order}` })),
      2,
    );
    expect(feed.visible.map(entry => entry.order)).toEqual([1, 2]);
    expect(feed.collapsed).toBe(3);
    expect(feed.summaryLabel).toBe("5 Moody effects activated");
  });

  it("pinned trackers render before contextual ones, capped at three pins", () => {
    const chips = orderMoodyTrackerChips(
      [
        { id: "a", label: "a", value: "1", urgency: "normal", pinned: false },
        { id: "b", label: "b", value: "2", urgency: "normal", pinned: true },
        { id: "c", label: "c", value: "3", urgency: "normal", pinned: true },
        { id: "d", label: "d", value: "4", urgency: "normal", pinned: true },
        { id: "e", label: "e", value: "5", urgency: "normal", pinned: true },
      ],
      3,
    );
    expect(chips.map(chip => chip.id)).toEqual(["b", "c", "d", "a", "e"]);
  });
});

describe("Moody presentation: enemy panel", () => {
  it("hides unobserved boons under Fog of War but keeps the roll count", () => {
    const boons = [boon("toxic-bloom", 10), boon("bastion-seat", 10, { target: { partySlots: [2] } })];
    const rows = buildMoodyEnemyPanelRows(boons, {
      rosterSize: 8,
      fogOfWar: true,
      observedInstanceIds: new Set([boons[0].instanceId]),
    });
    const header = rows[0];
    expect(header.label).toContain("Lines: 2");
    const unseen = rows.find(row => row.label.includes("unseen boon"));
    expect(unseen).toBeDefined();
    expect(rows.some(row => row.label.includes("Bastion Seat"))).toBe(false);
  });

  it("never reveals hidden reserve species and renders slot silhouettes", () => {
    const boons = [boon("bastion-seat", 10, { target: { partySlots: [2] } })];
    const rows = buildMoodyEnemyPanelRows(boons, { rosterSize: 8, hiddenReserves: true });
    const slotRow = rows.find(row => row.kind === "slot" && row.label.includes("SLOT 3"));
    expect(slotRow?.label).toContain("Unknown reserve");
  });

  it("debug mode adds rarity and targeting detail", () => {
    const boons = [boon("toxic-bloom", 10)];
    const rows = buildMoodyEnemyPanelRows(boons, { rosterSize: 6, debug: true });
    expect(rows.some(row => row.label.includes("[ROGUE · team"))).toBe(true);
  });
});

describe("Moody presentation: ledger tabs", () => {
  it("has the five required tabs", () => {
    expect(MOODY_LEDGER_TABS).toEqual(["OVERVIEW", "BINDINGS", "PROGRESS", "HISTORY", "CODEX"]);
  });

  it("overview shows build count and curse rows", () => {
    const rows = buildMoodyOverviewRows(
      {
        ...state([boon("bastion-seat", 10, { target: { partySlots: [0] } })]),
        curses: [{ curseId: "type-tax", acquiredAtWave: 1 }],
      },
      23,
    );
    expect(rows.some(row => row.label.includes("1 / 12"))).toBe(true);
    expect(rows.some(row => row.label.includes("Type Tax"))).toBe(true);
    expect(rows.some(row => row.label.includes("wave 30"))).toBe(true);
  });

  it("history records acquisitions chronologically with dormancy events", () => {
    const rows = buildMoodyHistoryRows(
      state([
        boon("bastion-seat", 10, { target: { partySlots: [0] } }),
        boon("echo-seat", 20, { target: { partySlots: [1] }, dormant: true }),
      ]),
    );
    expect(rows[0].label).toContain("Wave 10");
    expect(rows.some(row => row.label.includes("Mood Swing disabled Echo Seat"))).toBe(true);
  });

  it("pair emblems cycle Roman numerals", () => {
    expect(moodyPairEmblem(0)).toBe("I");
    expect(moodyPairEmblem(1)).toBe("II");
    expect(moodyPairEmblem(6)).toBe("I");
  });
});

describe("Moody presentation: transition report", () => {
  it("drops empty sections and reports emptiness", () => {
    expect(buildMoodyTransitionReport([{ title: "A", lines: [] }]).isEmpty).toBe(true);
    const report = buildMoodyTransitionReport([
      { title: "A", lines: [] },
      { title: "B", lines: ["line"] },
    ]);
    expect(report.isEmpty).toBe(false);
    expect(report.sections).toHaveLength(1);
    expect(report.sections[0].title).toBe("B");
  });
});
