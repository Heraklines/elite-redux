/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #449 / #453 - Ability-boost move-flag coverage vs the ER 2.65 Pokedex (the
// authoritative source). The dex tags every ability-boosted move class with an
// "<X> boost" line in its long description (Keen Edge, Mega Launcher, Iron Fist,
// Strong Jaw, Mighty Horn, Striker, Archer). Several moves - Dire Claw plus many
// ER customs - shipped with an empty `flags: [0]` array, so they never got the
// matching MoveFlags bit and the abilities (Sweeping Edge/Sharpness, Mega
// Launcher, Iron Fist, Strong Jaw, Roundhouse/Striker, ...) silently skipped
// them. The c-source corrections now derive the flag straight from the dex
// text. This test is the standing audit: every dex-declared boost move must
// carry its flag. ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const BOOST_PHRASE_FLAGS: readonly [string, MoveFlags, string][] = [
  ["keen edge boost", MoveFlags.SLICING_MOVE, "SLICING_MOVE"],
  ["mega launcher boost", MoveFlags.PULSE_MOVE, "PULSE_MOVE"],
  ["iron fist boost", MoveFlags.PUNCHING_MOVE, "PUNCHING_MOVE"],
  ["strong jaw boost", MoveFlags.BITING_MOVE, "BITING_MOVE"],
  ["mighty horn boost", MoveFlags.HORN_BASED, "HORN_BASED"],
  ["striker boost", MoveFlags.KICKING_MOVE, "KICKING_MOVE"],
  ["archer boost", MoveFlags.ARROW_BASED, "ARROW_BASED"],
];

describe.skipIf(!RUN)("ER ability-boost move flags match the 2.65 dex (#449/#453)", () => {
  let phaserGame: Phaser.Game;
  // biome-ignore lint/correctness/noUnusedVariables: constructing it runs ER init
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    game = new GameManager(phaserGame);
  });

  it("Dire Claw is a slicing move (#449 repro)", () => {
    expect(allMoves[MoveId.DIRE_CLAW]?.hasFlag(MoveFlags.SLICING_MOVE)).toBe(true);
  });

  it("EVERY dex-declared boost move carries its ability flag", () => {
    const movesMap = ER_ID_MAP.moves as Record<number, number>;
    const offenders: string[] = [];
    let checked = 0;
    for (const drf of ER_MOVES) {
      const text = (drf as { longDescription?: string }).longDescription?.toLowerCase() ?? "";
      const pkrgId = movesMap[drf.id];
      const move = pkrgId === undefined ? undefined : allMoves[pkrgId];
      if (!move) {
        continue; // unresolved ER custom (not injected) - skip
      }
      for (const [phrase, flag, flagName] of BOOST_PHRASE_FLAGS) {
        if (text.includes(phrase)) {
          checked++;
          if (!move.hasFlag(flag)) {
            offenders.push(`${(drf as { moveConst?: string }).moveConst ?? drf.id} missing ${flagName}`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });
});
