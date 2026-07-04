/*
 * Regression tests for the tier-2 rare-move orphan fixes (audit 2026-07):
 *   - Diamond Arrow: "Cuts through foe's stat changes" -> IgnoreOpponentStatStagesAttr
 *   - Rider Kick: "ignores the foe's ability. Can't miss." -> ignoresAbilities + accuracy -1
 *   - Asteroid Shot: "Cannot miss." -> accuracy -1
 *
 * Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-tier2-move-fixes.test.ts
 */

import { allMoves } from "#data/data-lists";
import type { Move } from "#data/moves/move";
import { MoveFlags } from "#enums/move-flags";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const byName = (name: string): Move => {
  const m = allMoves.find(mv => mv?.name === name);
  if (!m) {
    throw new Error(`move not found: ${name}`);
  }
  return m;
};

describe.skipIf(!RUN)("ER tier-2 rare-move orphan fixes", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("wiring: orphaned effects now implemented", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    expect(byName("Diamond Arrow").hasAttr("IgnoreOpponentStatStagesAttr"), "Diamond Arrow ignores stat changes").toBe(
      true,
    );

    const rk = byName("Rider Kick");
    expect(rk.hasFlag(MoveFlags.IGNORE_ABILITIES), "Rider Kick ignores the foe's ability").toBe(true);
    expect(rk.accuracy, "Rider Kick can't miss").toBe(-1);

    expect(byName("Asteroid Shot").accuracy, "Asteroid Shot can't miss").toBe(-1);
  }, 120_000);
});
