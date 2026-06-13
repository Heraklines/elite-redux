/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #449 - Keen Edge (slicing) flag coverage. The ER 2.65 Pokedex (authoritative)
// marks slicing moves with a "Keen Edge boost" line in their long description.
// Several moves - Dire Claw plus many ER customs - shipped with an empty
// `flags: [0]` array in er-moves.ts, so they never got the SLICING_MOVE flag and
// the Keen Edge abilities (Sweeping Edge never-miss + spread, Sharpness / Keen
// Edge 1.5x, Pinnacle Blade protect-break) silently skipped them. The c-source
// corrections now derive SLICING_MOVE straight from the dex text. ER_SCENARIO=1.
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

describe.skipIf(!RUN)("ER Keen Edge moves carry SLICING_MOVE (#449)", () => {
  let phaserGame: Phaser.Game;
  // biome-ignore lint/correctness/noUnusedVariables: constructing it runs ER init
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    // GameManager construction runs the full ER init incl. the c-source corrections.
    game = new GameManager(phaserGame);
  });

  it("Dire Claw is a slicing move (its dex line says 'Keen Edge boost')", () => {
    expect(allMoves[MoveId.DIRE_CLAW]?.hasFlag(MoveFlags.SLICING_MOVE)).toBe(true);
  });

  it("EVERY move whose ER 2.65 dex says 'Keen Edge boost' has the slicing flag", () => {
    const movesMap = ER_ID_MAP.moves as Record<number, number>;
    const offenders: string[] = [];
    let checked = 0;
    for (const drf of ER_MOVES) {
      const text = (drf as { longDescription?: string }).longDescription?.toLowerCase() ?? "";
      if (!text.includes("keen edge boost")) {
        continue;
      }
      const pkrgId = movesMap[drf.id];
      const move = pkrgId === undefined ? undefined : allMoves[pkrgId];
      if (!move) {
        continue; // unresolved ER custom - not injected into allMoves, skip
      }
      checked++;
      if (!move.hasFlag(MoveFlags.SLICING_MOVE)) {
        offenders.push((drf as { moveConst?: string }).moveConst ?? String(drf.id));
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });
});
