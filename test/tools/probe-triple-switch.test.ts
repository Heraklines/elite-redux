/*
 * PROBE (temporary) - reproduce the reported TRIPLE-battle manual-switch bug:
 * "manually switching in a Pokemon: it doesn't really switch out and comes out fainted."
 *
 * Run: ER_SCENARIO=1 npx vitest run test/tools/probe-triple-switch.test.ts
 */

import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import type { CommandUiHandler } from "#ui/handlers/command-ui-handler";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("probe: triple manual switch", () => {
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

  // A) Voluntary switch on slot 0, allies do a harmless self-buff (NO spread). Isolates
  //    the switch from friendly fire. The bench mon must come in ALIVE at full HP, the
  //    switched-out mon must go to the bench alive, and no duplicate/ghost on field.
  it("A: switch slot 0 -> bench mon, allies Harden (no friendly fire)", async () => {
    game.override
      .battleStyle("triple")
      .battleType(BattleType.WILD)
      .disableTrainerWaves()
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.HARDEN])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(50)
      .enemyLevel(5)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.SNORLAX, SpeciesId.BLISSEY, SpeciesId.CHANSEY);
    expect(globalScene.getPlayerParty()).toHaveLength(4);
    expect(globalScene.currentBattle.getBattlerCount()).toBe(3);

    const lead0 = globalScene.getPlayerField()[0];
    const bench = globalScene.getPlayerParty()[3]; // CHANSEY
    expect(bench.isOnField()).toBe(false);
    const benchFullHp = bench.getMaxHp();

    game.doSwitchPokemon(3); // slot 0 -> party[3]
    game.move.select(MoveId.HARDEN, 1);
    game.move.select(MoveId.HARDEN, 2);
    await game.toNextTurn();

    const field = globalScene.getPlayerField();
    console.log(
      `A: field=[${field.map((p, i) => `${i}:${p?.name}[hp=${p?.hp}/${p?.getMaxHp()},faint=${p?.isFainted()}]`).join(" ")}]`,
    );
    console.log(
      `A: lead0(${lead0.name}) onField=${lead0.isOnField()} fainted=${lead0.isFainted()}; bench(${bench.name}) onField=${bench.isOnField()} hp=${bench.hp}/${benchFullHp} fainted=${bench.isFainted()}`,
    );

    expect(bench.isOnField(), "switched-in bench mon is on the field").toBe(true);
    expect(bench.isFainted(), "switched-in bench mon must NOT be fainted").toBe(false);
    expect(bench.hp, "switched-in bench mon comes in at full HP").toBe(benchFullHp);
    expect(lead0.isOnField(), "switched-out mon left the field").toBe(false);
    expect(lead0.isFainted(), "switched-out mon is not fainted").toBe(false);
    // No duplicate: the three field slots are distinct live mons.
    const ids = new Set(field.map(p => p?.id));
    expect(ids.size, "three distinct mons on the field (no ghost/duplicate)").toBe(3);
  }, 120_000);

  // A2) Switch a NON-ZERO slot (slot 2) -> the newcomer must land at slot 2, not slot 0.
  //     The recent triple "position by field slot" rework is the regression-prone area.
  it("A2: switch slot 2 -> bench mon must land at slot 2 (not mis-slotted to 0)", async () => {
    game.override
      .battleStyle("triple")
      .battleType(BattleType.WILD)
      .disableTrainerWaves()
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.HARDEN])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(50)
      .enemyLevel(5)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.SNORLAX, SpeciesId.BLISSEY, SpeciesId.CHANSEY);
    const slot2Mon = globalScene.getPlayerField()[2]; // BLISSEY
    const bench = globalScene.getPlayerParty()[3]; // CHANSEY

    // Command slot 0 + 1 to Harden, slot 2 switches to party[3].
    game.move.select(MoveId.HARDEN, 0);
    game.move.select(MoveId.HARDEN, 1);
    game.onNextPrompt("CommandPhase", UiMode.COMMAND, () => {
      const phase = globalScene.phaseManager.getCurrentPhase() as CommandPhase;
      if (phase.getFieldIndex() !== 2) {
        return;
      }
      (globalScene.ui.getHandler() as CommandUiHandler).setCursor(2);
      (globalScene.ui.getHandler() as CommandUiHandler).processInput(Button.ACTION);
    });
    game.doSelectPartyPokemon(3, "CommandPhase");
    await game.toNextTurn();

    const field = globalScene.getPlayerField();
    console.log(
      `A2: field=[${field.map((p, i) => `${i}:${p?.name}`).join(" ")}]; bench(${bench.name}) fieldIndex=${bench.getFieldIndex?.()} onField=${bench.isOnField()}; slot2Mon(${slot2Mon.name}) onField=${slot2Mon.isOnField()}`,
    );
    expect(bench.isOnField(), "switched-in mon is on the field").toBe(true);
    expect(bench.getFieldIndex?.(), "switched-in mon landed at slot 2 (the slot it was switched into)").toBe(2);
    expect(field[2]?.id, "slot 2 now holds the switched-in mon").toBe(bench.id);
    expect(slot2Mon.isOnField(), "the switched-out slot-2 mon left the field").toBe(false);
  }, 120_000);

  // B) Reproduce the log: center slot (1) uses SURF (spread) the same turn slot 0 switches
  //    a bench mon in. Does the player's own Surf hit the freshly switched-in mon?
  it("B: switch slot 0 in, center uses SURF (spread) same turn -> does friendly fire hit the newcomer?", async () => {
    game.override
      .battleStyle("triple")
      .battleType(BattleType.WILD)
      .disableTrainerWaves()
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.SURF, MoveId.HARDEN])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(80)
      .enemyLevel(5)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.SNORLAX, SpeciesId.MAGIKARP, SpeciesId.SOLOSIS);
    const bench = globalScene.getPlayerParty()[3]; // SOLOSIS (like the log)
    const benchFullHp = bench.getMaxHp();

    game.doSwitchPokemon(3); // slot 0 -> SOLOSIS
    game.move.select(MoveId.SURF, 1); // center spread
    game.move.select(MoveId.HARDEN, 2);
    await game.toNextTurn().catch(() => {});

    console.log(
      `B: SOLOSIS onField=${bench.isOnField()} slot=${bench.getFieldIndex?.()} hp=${bench.hp}/${benchFullHp} fainted=${bench.isFainted()}`,
    );
    // Not an assertion of correctness - a diagnostic to see whether the newcomer took Surf.
    expect(true).toBe(true);
  }, 120_000);
});
