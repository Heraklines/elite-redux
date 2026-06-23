/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// REPRO: Retribution Blow (ER 407) auto-fires a 150 BP Hyper Beam when a foe
// boosts; per the dex it has NO recharge. Players report the holder is still
// locked into a recharge turn. Check: after the foe boosts (Swords Dance) and
// the triggered Hyper Beam fires, does the holder get the RECHARGING tag?
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-retribution-blow.test.ts

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("repro: Retribution Blow recharge", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("holder must NOT get RECHARGING after the triggered Hyper Beam", async () => {
    const retributionBlow = ER_ID_MAP.abilities[407];
    console.log(`Retribution Blow (407) -> pkrg ability id ${retributionBlow}`);
    expect(retributionBlow, "ER ability 407 must map to a pokerogue id").toBeDefined();

    const game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(retributionBlow as AbilityId)
      .enemySpecies(SpeciesId.SCIZOR)
      .enemyMoveset(MoveId.SWORDS_DANCE)
      .enemyAbility(AbilityId.BALL_FETCH)
      .moveset([MoveId.BODY_SLAM])
      .startingLevel(60)
      .enemyLevel(60)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const player = game.field.getPlayerPokemon();
    console.log(`player ability: ${player.getAbility()?.name}`);

    // Turn 1: player Body Slams; enemy Swords Dance -> should trigger the auto
    // Hyper Beam from Retribution Blow.
    game.move.use(MoveId.BODY_SLAM);
    await game.toEndOfTurn();

    const recharging = player.getTag(BattlerTagType.RECHARGING);
    const moves = player.getMoveHistory().map(m => `${MoveId[m.move]}(${m.result})`);
    console.log(`player move history: [${moves.join(", ")}]`);
    console.log(
      `player RECHARGING tag present: ${!!recharging}  ${recharging ? "<<< BUG (locked into recharge)" : "(ok)"}`,
    );

    expect(!!recharging, "holder should not be locked into recharge by the triggered Hyper Beam").toBe(false);
  }, 120_000);
});
