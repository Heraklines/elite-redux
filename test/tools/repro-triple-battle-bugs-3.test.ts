/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// REPRO - the maintainer-reported TRIPLE-battle bugs, round 3 (2026-07-07).
// Each block reproduces one report FIRST, then asserts the fixed behavior; a
// block FAILS while its bug is present and PASSES once fixed.
//
//   #5 enemy replacement "sometimes" fails - KO a WING (slot 2) foe / KO TWO foes
//      in one turn in a triple TRAINER battle with reserves -> every vacated slot
//      must be refilled ("4-mon trainer resumes as a 2v3" report).
//   #6 lone-survivor reachability - a triple that collapses to lone-player-vs-
//      lone-foe in OPPOSITE wings must still be able to fight: the visual
//      recenter (faint-phase) must be reflected in the targeting adjacency
//      ("one pokemon left and you can't hit it" report).
//   #7 Helping Hand in a triple - a wing can help the centre and the centre can
//      help a wing; the tag actually lands ("Helping hand doesn't work in 3v3").
//   #8 command B-backout - cancelling from the THIRD slot's command prompt must
//      re-queue ALL THREE slots, not just 0+1 ("press b to back up to the first
//      mon again, it skips your third mons move entirely").
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-triple-battle-bugs-3.test.ts
// =============================================================================

import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { TrainerType } from "#enums/trainer-type";
import { Trainer } from "#field/trainer";
import { getMoveTargets } from "#moves/move-utils";
import type { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Which of the three field slots have a pending CommandPhase queued. */
function queuedCommandPhaseSlots(): number[] {
  return [0, 1, 2].filter(slot =>
    globalScene.phaseManager.hasPhaseOfType("CommandPhase", p => (p as CommandPhase).getFieldIndex() === slot),
  );
}

describe.skipIf(!RUN)("repro: triple-battle bugs round 3 (2026-07-07 report)", () => {
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

  // ---------------------------------------------------------------------------
  // #5a - KO the RIGHT-WING (fieldIndex 2) foe: the reserve must still come in.
  // ---------------------------------------------------------------------------
  it("#5a enemy: KO the slot-2 foe in a triple TRAINER battle -> the reserve fills the wing", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER })
      .battleStyle("triple")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(50)
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.TACKLE, MoveId.HARDEN])
      .ability(AbilityId.SHADOW_TAG)
      .enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX, SpeciesId.SNORLAX);

    const field = globalScene.getEnemyField();
    expect(field.length, "triple trainer battle fields three foes").toBe(3);
    const battle = globalScene.currentBattle;
    battle.enemyParty.length = 3;
    const reserve = globalScene.addEnemyPokemon(getPokemonSpecies(SpeciesId.SHUCKLE), 50, field[0].trainerSlot);
    battle.enemyParty.push(reserve);
    expect(reserve.isOnField()).toBe(false);

    // My slot-2 mon KOs the slot-2 foe (direct face-off, adjacent); the others self-buff.
    const enemyIdx = field.map(e => e.getBattlerIndex());
    field[2].hp = 1;
    game.move.select(MoveId.HARDEN, 0);
    game.move.select(MoveId.HARDEN, 1);
    game.move.select(MoveId.TACKLE, 2, enemyIdx[2]);
    await game.toNextTurn();

    const living = globalScene.getEnemyField(true);
    console.log(`#5a: after wing KO -> ${living.length} living; reserve onField=${reserve.isOnField()}`);
    expect(field[2].isFainted(), "the wing foe fainted").toBe(true);
    expect(living.length, "the vacated WING slot was refilled").toBe(3);
    expect(reserve.isOnField(), "the reserve was summoned").toBe(true);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // #5b - KO TWO foes in ONE turn with TWO reserves: both slots must be refilled.
  // ---------------------------------------------------------------------------
  it("#5b enemy: KO two foes in one turn with two reserves -> both slots are refilled", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER })
      .battleStyle("triple")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(50)
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.TACKLE, MoveId.HARDEN])
      .ability(AbilityId.SHADOW_TAG)
      .enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX, SpeciesId.SNORLAX);

    const field = globalScene.getEnemyField();
    expect(field.length).toBe(3);
    const battle = globalScene.currentBattle;
    battle.enemyParty.length = 3;
    const reserveA = globalScene.addEnemyPokemon(getPokemonSpecies(SpeciesId.SHUCKLE), 50, field[0].trainerSlot);
    const reserveB = globalScene.addEnemyPokemon(getPokemonSpecies(SpeciesId.CATERPIE), 50, field[0].trainerSlot);
    battle.enemyParty.push(reserveA, reserveB);

    const enemyIdx = field.map(e => e.getBattlerIndex());
    field[0].hp = 1;
    field[1].hp = 1;
    game.move.select(MoveId.TACKLE, 0, enemyIdx[0]);
    game.move.select(MoveId.TACKLE, 1, enemyIdx[1]);
    game.move.select(MoveId.HARDEN, 2);
    await game.toNextTurn();

    const living = globalScene.getEnemyField(true);
    console.log(
      `#5b: after double KO -> ${living.length} living; reserves onField=${reserveA.isOnField()},${reserveB.isOnField()}`,
    );
    // NB the trainer AI may legally SWITCH a 1-HP foe to safety instead of letting it
    // faint (observed in this exact setup) - so don't assert who fainted, only the
    // report's invariant: the field never stays short-handed while reserves exist.
    expect(living.length, "the enemy field is back to full strength (never a lasting 2v3)").toBe(3);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // #5c - a SPREAD move KOs two foes in the SAME move (two simultaneous FaintPhases):
  //       both vacated slots must still be refilled from the two reserves.
  // ---------------------------------------------------------------------------
  it("#5c enemy: a spread move KOs two foes at once -> both slots are refilled", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER })
      .battleStyle("triple")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(50)
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.EARTHQUAKE, MoveId.HARDEN])
      .ability(AbilityId.SHADOW_TAG)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyHasPassiveAbility(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIDGEOT, SpeciesId.PIDGEOT);

    const field = globalScene.getEnemyField();
    expect(field.length).toBe(3);
    const battle = globalScene.currentBattle;
    battle.enemyParty.length = 3;
    const reserveA = globalScene.addEnemyPokemon(getPokemonSpecies(SpeciesId.SHUCKLE), 50, field[0].trainerSlot);
    const reserveB = globalScene.addEnemyPokemon(getPokemonSpecies(SpeciesId.CATERPIE), 50, field[0].trainerSlot);
    battle.enemyParty.push(reserveA, reserveB);

    // The CENTRE quakes (hits all adjacent); the two WING foes sit at 1 HP and faint in
    // the SAME MoveEffectPhase. My Pidgeot wings are airborne (Earthquake immune) and
    // just Harden. Keep the center foe Ground-immune so later damage-table changes cannot
    // turn this two-KO replacement regression into an unrelated full-field wipe.
    field[0].hp = 1;
    field[2].hp = 1;
    game.field.mockAbility(field[1], AbilityId.LEVITATE);
    game.move.select(MoveId.HARDEN, 0);
    game.move.select(MoveId.EARTHQUAKE, 1);
    game.move.select(MoveId.HARDEN, 2);
    await game.toNextTurn();

    const living = globalScene.getEnemyField(true);
    console.log(
      `#5c: after spread double-KO -> ${living.length} living; reserves onField=${reserveA.isOnField()},${reserveB.isOnField()}`,
    );
    expect(living.length, "BOTH simultaneously vacated slots were refilled").toBe(3);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // #5d - a foe faints from POISON at END of turn: the slot must still be refilled.
  // ---------------------------------------------------------------------------
  it("#5d enemy: an end-of-turn poison faint in a triple TRAINER battle is still replaced", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER })
      .battleStyle("triple")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(50)
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.TOXIC, MoveId.HARDEN])
      .ability(AbilityId.SHADOW_TAG)
      .enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX, SpeciesId.SNORLAX);

    const field = globalScene.getEnemyField();
    expect(field.length).toBe(3);
    const battle = globalScene.currentBattle;
    battle.enemyParty.length = 3;
    const reserve = globalScene.addEnemyPokemon(getPokemonSpecies(SpeciesId.SHUCKLE), 50, field[0].trainerSlot);
    battle.enemyParty.push(reserve);

    const enemyIdx = field.map(e => e.getBattlerIndex());
    // Toxic the slot-0 foe at 1 HP: it survives the move and faints from poison at turn end.
    field[0].hp = 2;
    game.move.select(MoveId.TOXIC, 0, enemyIdx[0]);
    game.move.select(MoveId.HARDEN, 1);
    game.move.select(MoveId.HARDEN, 2);
    await game.toNextTurn();

    const living = globalScene.getEnemyField(true);
    console.log(
      `#5d: after poison faint -> ${living.length} living; slot0 fainted=${field[0].isFainted()}; reserve onField=${reserve.isOnField()}`,
    );
    expect(living.length, "the poison-fainted slot was refilled").toBe(3);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // #5e - LIVE 2026-07-09 report: the trainer voluntarily switches one active
  //       while a DIFFERENT active faints in the same turn. Earlier coverage
  //       tested KOs and switches separately, never their shared party reorder.
  // ---------------------------------------------------------------------------
  it("#5e enemy: AI switch plus a different-slot KO in one turn still refills all 3 slots", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER })
      .battleStyle("triple")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(50)
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.TACKLE, MoveId.HARDEN])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX, SpeciesId.SNORLAX);

    const field = globalScene.getEnemyField();
    expect(field.length).toBe(3);
    const battle = globalScene.currentBattle;
    battle.enemyParty.length = 3;
    const switchIn = globalScene.addEnemyPokemon(getPokemonSpecies(SpeciesId.SHUCKLE), 50, field[0].trainerSlot);
    const faintReserve = globalScene.addEnemyPokemon(getPokemonSpecies(SpeciesId.CATERPIE), 50, field[0].trainerSlot);
    battle.enemyParty.push(switchIn, faintReserve);

    // Deterministically force only the first EnemyCommandPhase to choose party[3].
    // Later enemy command phases use the real scorer, so this models exactly one
    // voluntary AI switch rather than corrupting all three commands with one target.
    const realScores = Trainer.prototype.getPartyMemberMatchupScores;
    let scoreCalls = 0;
    vi.spyOn(Trainer.prototype, "getPartyMemberMatchupScores").mockImplementation(function (
      this: Trainer,
      trainerSlot,
      forSwitch,
      useBestMove,
    ) {
      scoreCalls++;
      if (scoreCalls === 1) {
        return [[3, 1_000_000]];
      }
      if (scoreCalls <= 3) {
        return []; // the other two active enemies stay in; exactly one voluntary switch
      }
      return realScores.call(this, trainerSlot, forSwitch, useBestMove); // faint replacement uses real AI
    });

    // Slot 0 switches to Shuckle before moves resolve. A player in slot 1 KOs the
    // DIFFERENT enemy slot 1; the faint replacement must account for the party swap
    // and use the remaining healthy reserve without collapsing to a lasting 3v2.
    const enemyIdx = field.map(e => e.getBattlerIndex());
    const koTarget = field[1];
    koTarget.hp = 1;
    game.move.select(MoveId.HARDEN, 0);
    game.move.select(MoveId.TACKLE, 1, enemyIdx[1]);
    game.move.select(MoveId.HARDEN, 2);
    await game.toNextTurn();

    const living = globalScene.getEnemyField(true);
    console.log(
      `#5e: living=${living.length}; switchIn=${switchIn.isOnField()}; faintReserve=${faintReserve.isOnField()}; field=[${living.map(p => p.name).join(",")}]`,
    );
    expect(switchIn.isOnField(), "the voluntary switch completed").toBe(true);
    expect(koTarget.isFainted(), "a different active enemy fainted in the same turn").toBe(true);
    expect(living.length, "the trainer returns to three live field slots").toBe(3);
    expect(faintReserve.isOnField(), "the remaining reserve fills the fainted slot").toBe(true);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // #6 - lone survivor vs lone survivor in opposite wings: both must stay able to
  //      fight (the visual recenter must count for targeting adjacency).
  // ---------------------------------------------------------------------------
  it("#6 reachability: lone player (slot 0) vs lone foe (slot 2) -> both can target each other", async () => {
    game.override
      .battleStyle("triple")
      .battleType(BattleType.WILD)
      .disableTrainerWaves()
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.TACKLE, MoveId.HARDEN, MoveId.MEMENTO])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(60)
      .enemyLevel(5)
      .criticalHits(false);
    // Exactly three mons - when two faint, no bench exists and slot 0 is the lone survivor.
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);

    const foes = globalScene.getEnemyField();
    const enemyIdx = foes.map(e => e.getBattlerIndex());

    // Turn 1: my slots 1+2 self-faint via Memento (deterministic); slot 0 Hardens.
    game.move.select(MoveId.HARDEN, 0);
    game.move.select(MoveId.MEMENTO, 1, enemyIdx[1]);
    game.move.select(MoveId.MEMENTO, 2, enemyIdx[2]);
    await game.toNextTurn();
    expect(globalScene.getPlayerField().filter(p => p.isActive(true)).length, "player is down to one mon").toBe(1);

    // Turn 2 + 3: the lone slot-0 mon KOs the two foes it can reach (slots 0 then 1).
    foes[0].hp = 1;
    game.move.select(MoveId.TACKLE, 0, enemyIdx[0]);
    await game.toNextTurn();
    foes[1].hp = 1;
    game.move.select(MoveId.TACKLE, 0, enemyIdx[1]);
    await game.toNextTurn();

    const player = globalScene.getPlayerField().find(p => p.isActive(true));
    const lastFoe = globalScene.getEnemyField(true);
    expect(player, "the lone player mon is still standing").toBeDefined();
    expect(lastFoe.length, "exactly one foe remains").toBe(1);
    console.log(
      `#6: lone player battlerIndex=${player?.getBattlerIndex()} vs lone foe battlerIndex=${lastFoe[0].getBattlerIndex()}`,
    );

    // The report: "there's one pokemon left and you can't hit it". Both lone survivors are
    // visually recentered - targeting must agree.
    const playerTargets = getMoveTargets(player!, MoveId.TACKLE);
    const foeTargets = getMoveTargets(lastFoe[0], MoveId.TACKLE);
    console.log(
      `#6: player Tackle targets=${JSON.stringify(playerTargets.targets)}; foe Tackle targets=${JSON.stringify(foeTargets.targets)}`,
    );
    expect(playerTargets.targets, "the lone player mon can target the last foe").toContain(
      lastFoe[0].getBattlerIndex(),
    );
    expect(foeTargets.targets, "the last foe can target the lone player mon").toContain(player!.getBattlerIndex());
  }, 120_000);

  // ---------------------------------------------------------------------------
  // #7 - Helping Hand works in a triple (wing -> centre and centre -> wing).
  // ---------------------------------------------------------------------------
  it("#7 helping hand: a WING helps the CENTRE - the tag lands on the ally", async () => {
    game.override
      .battleStyle("triple")
      .battleType(BattleType.WILD)
      .disableTrainerWaves()
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.HELPING_HAND, MoveId.TACKLE, MoveId.HARDEN])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(60)
      .enemyLevel(5);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);

    const centre = globalScene.getPlayerField()[1];
    const enemyIdx = globalScene.getEnemyField().map(e => e.getBattlerIndex());
    // Slot 0 (wing) helps the centre; centre attacks; slot 2 Hardens. Helping Hand is +5
    // priority, so the tag must be on the centre when its own move executes.
    game.move.select(MoveId.HELPING_HAND, 0, centre.getBattlerIndex());
    game.move.select(MoveId.TACKLE, 1, enemyIdx[1]);
    game.move.select(MoveId.HARDEN, 2);

    await game.phaseInterceptor.to("MoveEndPhase");
    const tagged = !!centre.getTag(BattlerTagType.HELPING_HAND);
    console.log(`#7 wing->centre: HELPING_HAND tag on centre after first MoveEnd = ${tagged}`);
    expect(tagged, "Helping Hand's tag landed on the centre ally").toBe(true);
    await game.toNextTurn();
  }, 120_000);

  it("#7 helping hand: the CENTRE helps a WING - the tag lands on the chosen wing", async () => {
    game.override
      .battleStyle("triple")
      .battleType(BattleType.WILD)
      .disableTrainerWaves()
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.HELPING_HAND, MoveId.TACKLE, MoveId.HARDEN])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(60)
      .enemyLevel(5);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);

    const wing0 = globalScene.getPlayerField()[0];
    const enemyIdx = globalScene.getEnemyField().map(e => e.getBattlerIndex());
    game.move.select(MoveId.TACKLE, 0, enemyIdx[0]);
    game.move.select(MoveId.HELPING_HAND, 1, wing0.getBattlerIndex());
    game.move.select(MoveId.HARDEN, 2);

    await game.phaseInterceptor.to("MoveEndPhase");
    const tagged = !!wing0.getTag(BattlerTagType.HELPING_HAND);
    console.log(`#7 centre->wing: HELPING_HAND tag on wing after first MoveEnd = ${tagged}`);
    expect(tagged, "Helping Hand's tag landed on the chosen wing ally").toBe(true);
    await game.toNextTurn();
  }, 120_000);

  // ---------------------------------------------------------------------------
  // #8 - B-backout from the THIRD slot's command re-queues ALL slots (0,1,2).
  // ---------------------------------------------------------------------------
  it("#8 command backout: cancelling from slot 2 re-queues slots 0,1 AND 2 - the third mon still acts", async () => {
    game.override
      .battleStyle("triple")
      .battleType(BattleType.WILD)
      .disableTrainerWaves()
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.HARDEN])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(60)
      .enemyLevel(5);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);

    const mon2 = globalScene.getPlayerField()[2];
    const enemyIdx = globalScene.getEnemyField().map(e => e.getBattlerIndex());

    // Commit slots 0 + 1, then CANCEL (the B press) from slot 2's prompt exactly once.
    let cancelled = false;
    let slotsAfterCancel: number[] | null = null;
    game.move.select(MoveId.TACKLE, 0, enemyIdx[0]);
    game.move.select(MoveId.TACKLE, 1, enemyIdx[1]);
    game.onNextPrompt("CommandPhase", 2 /* UiMode.COMMAND */, () => {
      const phase = globalScene.phaseManager.getCurrentPhase() as CommandPhase;
      if (phase.getFieldIndex() !== 2 || cancelled) {
        return;
      }
      cancelled = true;
      phase.cancel();
      slotsAfterCancel = queuedCommandPhaseSlots();
      // Re-commit all three slots after the backout (what the player then does).
      game.move.select(MoveId.TACKLE, 0, enemyIdx[0]);
      game.move.select(MoveId.TACKLE, 1, enemyIdx[1]);
      game.move.select(MoveId.HARDEN, 2);
    });
    await game.toNextTurn();

    console.log(`#8: pending CommandPhases right after the slot-2 cancel = ${JSON.stringify(slotsAfterCancel)}`);
    expect(cancelled, "the slot-2 command prompt was reached and cancelled").toBe(true);
    expect(slotsAfterCancel ?? [], "the backout re-queued the THIRD slot too").toContain(2);
    // And behaviorally: the third mon still got to act this turn (its Harden landed).
    expect(mon2.getStatStage(Stat.DEF), "the third mon's move was not skipped").toBe(1);
  }, 120_000);
});
