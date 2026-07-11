/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown PS-format text codec - the grammar matrix (P2). Round-trip byte-stability, tolerant
// PS-paste import (EVs / Level / IVs / Happiness silently skipped), precise per-mon/per-line error
// reporting, ER Stage/Shiny tag parsing + missing-tag defaults, both hyphen and en-dash bullets, and
// the import -> validate handoff. Boots a real GameManager so the species / move / ability / item /
// nature NAME tables are populated (like the search-matrix test).
// =============================================================================

import { speciesStarterCosts } from "#balance/starters";
import { allAbilities } from "#data/data-lists";
import { listMegaStages } from "#data/elite-redux/showdown/showdown-evolutions";
import { SHOWDOWN_ITEM_POOL } from "#data/elite-redux/showdown/showdown-item-pool";
import {
  _resetShowdownCodecCaches,
  exportShowdownSet,
  exportShowdownTeam,
  importShowdownSet,
  importShowdownTeam,
} from "#data/elite-redux/showdown/showdown-set-codec";
import {
  MEGA_STONE_ITEM,
  type ShowdownMonManifest,
  validateShowdownTeam,
} from "#data/elite-redux/showdown/showdown-team";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** A canonical Garchomp-line manifest (real moves/ability/nature) shaped exactly as the codec reconstructs. */
function garchompMon(over: Partial<ShowdownMonManifest> = {}): ShowdownMonManifest {
  return {
    speciesId: SpeciesId.GARCHOMP,
    formIndex: 0,
    level: 100,
    shiny: false,
    variant: 0,
    abilityIndex: 0,
    nature: Nature.JOLLY,
    ivs: [31, 31, 31, 31, 31, 31],
    moveset: [MoveId.EARTHQUAKE, MoveId.OUTRAGE, MoveId.SWORDS_DANCE, MoveId.STONE_EDGE],
    item: "LEFTOVERS",
    rootSpeciesId: SpeciesId.GIBLE,
    erBlackShiny: false,
    baseCost: speciesStarterCosts[SpeciesId.GIBLE] ?? 4,
    ...over,
  };
}

describe.runIf(RUN)("showdown set codec", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    // eslint-disable-next-line no-new
    new GameManager(phaserGame); // boots ER init -> the data-list NAME tables are populated
    _resetShowdownCodecCaches();
  });
  afterAll(() => phaserGame.destroy(true));

  it("exports the documented PS grammar with the ER tags always written", () => {
    const text = exportShowdownSet(garchompMon());
    const lines = text.split("\n");
    expect(lines[0]).toBe("Garchomp @ Leftovers  [Stage: Base]");
    // The ability is the fielded species' active slot 0 (ER's own dex value, whatever it is).
    const ability0 = allAbilities[getPokemonSpecies(SpeciesId.GARCHOMP).ability1].name;
    expect(lines[1]).toBe(`Ability: ${ability0}`);
    expect(lines[2]).toMatch(/^Nature: Jolly/);
    expect(lines.slice(3)).toEqual(["- Earthquake", "- Outrage", "- Swords Dance", "- Stone Edge"]);
  });

  it("round-trips a set byte-for-byte AND field-for-field (export -> import -> export)", () => {
    const mon = garchompMon();
    const text = exportShowdownSet(mon);
    const parsed = importShowdownSet(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.manifest).not.toBeNull();
    // RED-PROOF (codec byte-stability): re-exporting the imported manifest reproduces the SAME text.
    // Break the deterministic header (drop a tag / change the two-space join) and this diverges.
    expect(exportShowdownSet(parsed.manifest!)).toBe(text);
    // And the wire fields survive the round-trip identically (hash parity).
    expect(parsed.manifest).toEqual(mon);
  });

  it("parses the [Stage] + [Shiny] tags and forces the mega item slot", () => {
    const mega = listMegaStages(SpeciesId.GIBLE)[0];
    const mon = garchompMon({
      speciesId: mega.speciesId,
      formIndex: mega.formIndex,
      item: MEGA_STONE_ITEM,
      shiny: true,
      variant: 2,
    });
    const text = exportShowdownSet(mon);
    // A mega omits the "@ item" (stage implies the locked stone) and carries its full form name + shiny tier.
    expect(text.split("\n")[0]).toBe(`Garchomp  [Stage: ${mega.formName}] [Shiny: 2]`);
    const parsed = importShowdownSet(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.manifest!.speciesId).toBe(mega.speciesId);
    expect(parsed.manifest!.formIndex).toBe(mega.formIndex);
    expect(parsed.manifest!.item).toBe(MEGA_STONE_ITEM);
    expect(parsed.manifest!.shiny).toBe(true);
    expect(parsed.manifest!.variant).toBe(2);
  });

  it("applies missing-tag defaults: base stage, not shiny", () => {
    const parsed = importShowdownSet(["Garchomp @ Leftovers", "Nature: Jolly", "- Earthquake"].join("\n"));
    expect(parsed.manifest!.formIndex).toBe(0);
    expect(parsed.manifest!.speciesId).toBe(SpeciesId.GARCHOMP);
    expect(parsed.manifest!.shiny).toBe(false);
    expect(parsed.manifest!.variant).toBe(0);
  });

  it("imports a real PS paste (EVs / Level / IVs / Happiness / Tera lines skipped silently)", () => {
    const paste = [
      "Garchomp @ Leftovers",
      "Ability: Sand Veil",
      "Level: 100",
      "Shiny: Yes",
      "Happiness: 255",
      "EVs: 252 Atk / 4 Def / 252 Spe",
      "Jolly Nature",
      "IVs: 0 SpA",
      "Tera Type: Ground",
      "- Earthquake",
      "- Outrage",
    ].join("\n");
    const parsed = importShowdownSet(paste);
    expect(parsed.errors).toEqual([]); // every unknown LINE was skipped, nothing reported
    expect(parsed.manifest!.moveset).toEqual([MoveId.EARTHQUAKE, MoveId.OUTRAGE]);
    expect(parsed.manifest!.item).toBe("LEFTOVERS");
    expect(parsed.manifest!.shiny).toBe(true); // the bare `Shiny: Yes` PS line is honored
    // "Jolly Nature" (PS's own nature line form) is NOT the "Nature:" key we read, so nature falls to the
    // default - proving the import never crashes on a PS field it doesn't model.
    expect(parsed.manifest!.nature).toBe(Nature.HARDY);
  });

  it("accepts both hyphen and en-dash / em-dash move bullets", () => {
    const parsed = importShowdownSet(["Garchomp @ Leftovers", "- Earthquake", "– Outrage", "— Stone Edge"].join("\n"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.manifest!.moveset).toEqual([MoveId.EARTHQUAKE, MoveId.OUTRAGE, MoveId.STONE_EDGE]);
  });

  it("resolves names separator- and case-insensitively (uturn, stone edge with odd spacing)", () => {
    const parsed = importShowdownSet(["garchomp @ LEFTOVERS", "-  u-turn", "- STONEEDGE", "- swordsdance"].join("\n"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.manifest!.moveset).toEqual([MoveId.U_TURN, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE]);
    expect(parsed.manifest!.item).toBe("LEFTOVERS");
  });

  it("reports an unknown SPECIES per-mon (fatal: no manifest)", () => {
    const parsed = importShowdownSet(["Notamon @ Leftovers", "- Earthquake"].join("\n"));
    expect(parsed.manifest).toBeNull();
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].message).toContain("unknown species 'Notamon'");
  });

  it("reports a PRECISE per-line unknown MOVE and keeps the legal moves", () => {
    const text = ["Garchomp @ Leftovers", "Nature: Jolly", "- Earthquake", "- Fooblast", "- Outrage"].join("\n");
    const parsed = importShowdownSet(text);
    // RED-PROOF (import validation): the error names the exact line + move. Drop the `line N:` prefix in
    // parseSetBlock's move branch and this exact-string assertion goes red.
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].message).toBe("line 4: unknown move 'Fooblast'");
    expect(parsed.errors[0].line).toBe(4);
    // The mon is still built with the two legal moves (tolerant import).
    expect(parsed.manifest!.moveset).toEqual([MoveId.EARTHQUAKE, MoveId.OUTRAGE]);
  });

  it("imports a blank-line-separated TEAM with line-accurate per-mon errors", () => {
    const team = [
      "Garchomp @ Leftovers", // lines 1-3
      "Nature: Jolly",
      "- Earthquake",
      "", // line 4
      "Tyranitar @ Shell Bell", // line 5 (a curated-pool item)
      "- Bogusmove", // line 6 -> precise error
    ].join("\n");
    const result = importShowdownTeam(team);
    expect(result.manifests).toHaveLength(2);
    expect(result.manifests[0].speciesId).toBe(SpeciesId.GARCHOMP);
    expect(result.manifests[1].speciesId).toBe(SpeciesId.TYRANITAR);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe("line 6: unknown move 'Bogusmove'");
  });

  it("team export is blank-line separated and round-trips", () => {
    const team = [
      garchompMon(),
      garchompMon({
        speciesId: SpeciesId.TYRANITAR,
        rootSpeciesId: SpeciesId.LARVITAR,
        moveset: [MoveId.CRUNCH],
        item: SHOWDOWN_ITEM_POOL[0],
        baseCost: speciesStarterCosts[SpeciesId.LARVITAR] ?? 4,
      }),
    ];
    const text = exportShowdownTeam(team);
    expect(text).toContain("\n\n"); // PS blank-line separator
    const back = importShowdownTeam(text);
    expect(back.errors).toEqual([]);
    expect(exportShowdownTeam(back.manifests)).toBe(text);
  });

  it("feeds imported manifests into the shared validator (import -> validate handoff)", () => {
    // Two Garchomps: a duplicate-species team. Import cleanly, then the shared rule engine flags it.
    const team = ["Garchomp @ Leftovers", "- Earthquake", "", "Garchomp @ Life Orb", "- Outrage"].join("\n");
    const result = importShowdownTeam(team);
    expect(result.manifests).toHaveLength(2);
    const permissive = {
      isRootUnlocked: () => true,
      isShinyUnlocked: () => true,
      isAbilityUnlocked: () => true,
      isNatureUnlocked: () => true,
      isMoveLegal: () => true,
      isSpeciesInLine: () => true,
    };
    const violations = validateShowdownTeam(result.manifests, permissive, () => false);
    expect(violations.some(v => v.rule === "duplicate")).toBe(true);
  });
});
