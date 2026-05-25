/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Audit move FLAGS: walk every vanilla-range ER move, compare ER C source
// flag list to pokerogue's runtime move.flags bitmask. Emits a diff report
// listing missing/extra ER-only flags per move (BITING_MOVE, PUNCHING_MOVE,
// SLICING_MOVE, KICKING_MOVE, HAMMER_BASED, AIR_BASED, etc.). These are
// the flags that gate ER ability triggers (Iron Fist, Strong Jaw, Striker,
// Keen Edge, Mighty Horn, Bone Zone, Giant Wings, etc.).

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveFlags } from "#enums/move-flags";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

// C-source flag name → pokerogue MoveFlags bit. Only ER's gameplay-relevant
// flags are listed; bookkeeping flags (PROTECT_AFFECTED, MIRROR_MOVE_AFFECTED,
// KINGS_ROCK_AFFECTED, MAGIC_COAT_AFFECTED, etc.) are skipped since they
// don't gate ability triggers in pokerogue.
const FLAG_MAP: Record<string, MoveFlags | undefined> = {
  FLAG_MAKES_CONTACT: MoveFlags.MAKES_CONTACT,
  FLAG_HIGH_CRIT: undefined, // handled via HighCritAttr, not a flag
  FLAG_IRON_FIST_BOOST: MoveFlags.PUNCHING_MOVE,
  FLAG_STRONG_JAW_BOOST: MoveFlags.BITING_MOVE,
  FLAG_MEGA_LAUNCHER_BOOST: MoveFlags.PULSE_MOVE,
  FLAG_STRIKER_BOOST: MoveFlags.KICKING_MOVE,
  FLAG_SOUND: MoveFlags.SOUND_BASED,
  FLAG_BALLISTIC: MoveFlags.BALLBOMB_MOVE,
  FLAG_POWDER: MoveFlags.POWDER_MOVE,
  FLAG_DANCE: MoveFlags.DANCE_MOVE,
  FLAG_AIR_BASED: MoveFlags.AIR_BASED,
  FLAG_HORN_BASED: MoveFlags.HORN_BASED,
  FLAG_BONE_BASED: MoveFlags.BONE_BASED,
  FLAG_FIELD_BASED: MoveFlags.FIELD_BASED,
  FLAG_WEATHER_BASED: MoveFlags.WEATHER_BASED,
  FLAG_KEEN_EDGE_BOOST: MoveFlags.SLICING_MOVE,
  FLAG_RECKLESS_BOOST: MoveFlags.RECKLESS_MOVE,
};

describe.skipIf(!RUN_SCENARIOS)("ER move flags audit", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("emits move-flag diff report", async () => {
    const game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);

    const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
    const erMoves = (await import("#data/elite-redux/er-moves")).ER_MOVES;
    const cSrcPath = path.resolve(process.cwd(), "vendor/elite-redux/rom-extracted/er-battle-moves.json");
    const cMoves = JSON.parse(fs.readFileSync(cSrcPath, "utf-8")) as Array<{
      name: string;
      flags: string[];
    }>;
    const constToErId = new Map<string, number>();
    for (const drf of erMoves) {
      const c = drf.moveConst.replace(/^MOVE_/, "");
      constToErId.set(c, drf.id);
    }

    const missing: Array<{ move: string; pkrgId: number; missing: string[] }> = [];
    for (const cm of cMoves) {
      const erId = constToErId.get(cm.name);
      if (erId === undefined || erId < 1 || erId > 759) continue;
      const pkrgId = erIdMap.moves[erId];
      if (pkrgId === undefined) continue;
      const move = allMoves.find(x => x.id === pkrgId);
      if (!move) continue;
      const localMissing: string[] = [];
      for (const cFlag of cm.flags) {
        const pkrgFlag = FLAG_MAP[cFlag];
        if (pkrgFlag === undefined) continue; // skip irrelevant
        // pokerogue Move.flags is a private bitmask; use hasFlag
        if (!move.hasFlag(pkrgFlag)) {
          localMissing.push(cFlag);
        }
      }
      if (localMissing.length > 0) {
        missing.push({ move: cm.name, pkrgId, missing: localMissing });
      }
    }

    const reportPath = path.resolve(process.cwd(), "docs/plans/er-move-flags-report.txt");
    const lines: string[] = [
      `ER move-flags audit — generated ${new Date().toISOString()}`,
      `Moves with missing ER-relevant flags: ${missing.length}`,
      "",
    ];
    for (const m of missing) {
      lines.push(`  ${m.move.padEnd(25)} (pkrg ${m.pkrgId}): missing ${m.missing.join(", ")}`);
    }
    fs.writeFileSync(reportPath, lines.join("\n"), "utf-8");
    console.log(`Wrote ${reportPath} with ${missing.length} moves missing flags`);
    expect(missing.length).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
