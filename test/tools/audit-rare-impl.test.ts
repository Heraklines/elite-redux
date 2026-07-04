/*
 * AUDIT - for the rare abilities (on 1 mon) and rare moves (<=4 mons), dump each
 * item's ER dex text NEXT TO its actual runtime implementation (attached attrs +
 * archetype classification), so approximations / partial / orphaned (no-op)
 * implementations surface. Reads the id lists from dev-logs/audit-{abilities,moves}.json
 * (produced from the histogram). ER wires behavior via archetype dispatchers with a
 * `bespoke` bucket that is left as NO-OP placeholders — an item with a substantive dex
 * description but zero/greedy-generic attrs is the target.
 *
 * Run: ER_SCENARIO=1 npx vitest run test/tools/audit-rare-impl.test.ts
 * Writes dev-logs/audit-impl-abilities.json + dev-logs/audit-impl-moves.json.
 */

import { allAbilities, allMoves } from "#data/data-lists";
import { ER_ABILITIES } from "#data/elite-redux/er-abilities";
import { ER_ABILITY_ARCHETYPES } from "#data/elite-redux/er-ability-archetypes";
import { getErAbilityRomDescription } from "#data/elite-redux/er-ability-descriptions";
import { ER_MOVE_ARCHETYPES } from "#data/elite-redux/er-move-archetypes";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { readFileSync, writeFileSync } from "node:fs";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const CUSTOM_CUTOFF = 5000;
const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

describe.skipIf(!RUN)("audit: rare ability & move implementations vs ER dex", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("dumps dex-text vs implementation for rare abilities & moves", async () => {
    game = new GameManager(phaserGame);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    // canonical ability name -> detailed archetype kind (via ER draft id)
    const abArchByName = new Map<string, string>();
    for (const d of ER_ABILITIES) {
      const arch = ER_ABILITY_ARCHETYPES[d.id]?.archetype;
      if (arch) {
        abArchByName.set(canon(d.name), arch);
      }
    }
    // canonical move name -> {archetype, longDescription}
    const mvByName = new Map<string, { arch: string; long: string }>();
    for (const d of ER_MOVES) {
      mvByName.set(canon(d.name), {
        arch: ER_MOVE_ARCHETYPES[d.id]?.archetype ?? "?",
        long: d.longDescription ?? "",
      });
    }

    const abIds: { id: number; name: string; species: string[] }[] = JSON.parse(
      readFileSync("dev-logs/audit-abilities.json", "utf8"),
    );
    const mvIds: { id: number; name: string; count: number; species: string[] }[] = JSON.parse(
      readFileSync("dev-logs/audit-moves.json", "utf8"),
    );

    // ---- ABILITIES ----
    const abilityRows = abIds.map(row => {
      const ab = allAbilities[row.id];
      const name = ab?.name ?? row.name;
      const attrs = (ab?.attrs ?? []).map(a => a.constructor.name);
      const isCustom = row.id >= CUSTOM_CUTOFF;
      const arch = abArchByName.get(canon(name)) ?? (isCustom ? "?" : "vanilla");
      const desc = ab?.description ?? "";
      const rom = getErAbilityRomDescription(name) ?? "";
      // Heuristic verdict:
      //  - ORPHANED: custom, has a real dex description, but 0 attached attrs (no-op).
      //  - BESPOKE-UNWIRED: archetype flagged bespoke/composite AND 0 attrs.
      //  - WIRED: has attrs (needs desc-vs-attr judgement -> "review").
      const meaningfulDesc = (rom || desc).replace(/[^a-z]/gi, "").length > 8;
      let verdict: string;
      if (!isCustom) {
        verdict = "vanilla-impl"; // uses pokerogue's real ability impl
      } else if (attrs.length === 0) {
        verdict = meaningfulDesc ? "ORPHANED-NOOP" : "noop-trivial";
      } else if (arch === "bespoke" || arch === "composite-vanilla-mashup") {
        verdict = "review-bespoke-wired";
      } else {
        verdict = "review-archetype";
      }
      return {
        id: row.id,
        key: row.name,
        name,
        isCustom,
        archetype: arch,
        attrCount: attrs.length,
        attrs,
        erDesc: desc,
        romDesc: rom,
        species: row.species,
        verdict,
      };
    });

    // ---- MOVES ----
    const moveRows = mvIds.map(row => {
      const mv = allMoves[row.id];
      const name = mv?.name ?? row.name;
      const attrs = (mv?.attrs ?? []).map(a => a.constructor.name);
      const isCustom = row.id >= CUSTOM_CUTOFF;
      const meta = mvByName.get(canon(name));
      const arch = meta?.arch ?? (isCustom ? "?" : "vanilla");
      const desc = mv?.description ?? "";
      const long = meta?.long ?? "";
      const category = mv ? (MoveCategory[mv.category] ?? String(mv.category)) : "?";
      const type = mv ? (PokemonType[mv.type] ?? String(mv.type)) : "?";
      // For moves, 0 special attrs is only suspicious when the dex text promises a
      // secondary effect (status/stat/heal/switch/etc.). Flag those; a pure "deals
      // damage" move with 0 attrs is fine.
      const promisesEffect =
        /chance|lower|raise|boost|heal|drain|recoil|flinch|status|burn|paraly|freez|poison|sleep|confus|switch|trap|priorit|weather|terrain|barrier|shield|screen|protect|crit|charg|two turn|recharge|steal|sets?\b/i.test(
          long || desc,
        );
      let verdict: string;
      if (!isCustom) {
        verdict = "vanilla-impl";
      } else if (attrs.length === 0) {
        verdict = promisesEffect ? "ORPHANED-EFFECT-MISSING" : "damage-only-ok";
      } else if (arch === "bespoke") {
        verdict = "review-bespoke-wired";
      } else {
        verdict = "review-archetype";
      }
      return {
        id: row.id,
        key: row.name,
        name,
        isCustom,
        archetype: arch,
        category,
        type,
        power: mv?.power,
        accuracy: mv?.accuracy,
        attrCount: attrs.length,
        attrs,
        erDesc: desc,
        longDesc: long,
        species: row.species,
        verdict,
      };
    });

    writeFileSync("dev-logs/audit-impl-abilities.json", JSON.stringify(abilityRows, null, 2));
    writeFileSync("dev-logs/audit-impl-moves.json", JSON.stringify(moveRows, null, 2));

    // ---- console triage ----
    const byVerdict = <T extends { verdict: string }>(rows: T[]) => {
      const m: Record<string, number> = {};
      for (const r of rows) {
        m[r.verdict] = (m[r.verdict] ?? 0) + 1;
      }
      return m;
    };
    console.log("\n===== ABILITY verdicts:", JSON.stringify(byVerdict(abilityRows)));
    console.log("===== MOVE verdicts:   ", JSON.stringify(byVerdict(moveRows)), "\n");

    const orphanAb = abilityRows.filter(r => r.verdict === "ORPHANED-NOOP");
    console.log(`----- ORPHANED ABILITIES (custom, real dex text, ZERO attrs) : ${orphanAb.length} -----`);
    for (const r of orphanAb) {
      console.log(
        `  ${r.name} [${r.species[0]}] arch=${r.archetype}\n      dex: ${(r.romDesc || r.erDesc).slice(0, 140)}`,
      );
    }

    const orphanMv = moveRows.filter(r => r.verdict === "ORPHANED-EFFECT-MISSING");
    console.log(`\n----- MOVES: dex promises an effect but ZERO attrs : ${orphanMv.length} -----`);
    for (const r of orphanMv) {
      console.log(
        `  ${r.name} [${r.species[0]}] ${r.category}/${r.type} pow=${r.power}\n      dex: ${(r.longDesc || r.erDesc).slice(0, 140)}`,
      );
    }

    const bespokeAb = abilityRows.filter(r => r.verdict === "review-bespoke-wired");
    console.log(
      `\n----- ABILITIES wired despite bespoke/composite archetype (verify parity) : ${bespokeAb.length} -----`,
    );
    for (const r of bespokeAb) {
      console.log(`  ${r.name} [${r.species[0]}] attrs=[${r.attrs.join(",")}]`);
    }

    console.log("\nFull data: dev-logs/audit-impl-abilities.json  dev-logs/audit-impl-moves.json\n");
    expect(abilityRows.length).toBeGreaterThan(100);
    expect(moveRows.length).toBe(40);
  }, 180_000);
});
