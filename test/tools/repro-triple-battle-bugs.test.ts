/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// REPRO - the four maintainer-reported TRIPLE-battle bugs (staging Town waves 1-10).
// Each block reproduces one report FIRST, then asserts the fixed behavior; a block
// FAILS (or exposes the wrong state) if its bug is present and PASSES once fixed.
//
//   #1 enemy side - "a fainted mon in a triple is never replaced": KO one foe in a
//      triple TRAINER battle -> a bench reserve must be summoned into the slot. (The
//      wild triple has no reserves, so no replacement there - the intended behavior.)
//   #1 player side - KO a player mon with a bench -> the faint-switch must bring a
//      replacement into the correct slot.
//   #2 lingering UI - WIN a triple TRAINER battle -> on the NEXT wave the previous
//      battle's foes must be off-field + invisible and their battle-infos hidden
//      (the "stale sprites + info bars persist into the next intro" report).
//   #3 pokeball crash (VERIFY the already-landed fix) - throwing a ball from a later
//      triple slot when an EARLIER slot's command is null (a fainted/empty slot)
//      must NOT crash ("Cannot set properties of null (setting 'skip')", tester izumi
//      2026-07-01); and throwing at a trainer's mon is rejected with the right message.
//
// (#4 "backsprites not showing" is a render-tier check - see the `battle-field-triples`
//  recipe in test/tools/render-ui-page.test.ts, not a headless-logic repro.)
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-triple-battle-bugs.test.ts
// =============================================================================

import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { Command } from "#enums/command";
import { FieldPosition } from "#enums/field-position";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import type { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/**
 * Read a Pokemon's PROTECTED `battleInfo.visible` through the codebase's typed double-cast
 * pattern (as in test/tests/ui/summary-ui-3-passive-slots.test.ts), NOT `as any`.
 */
function infoVisible(mon: object): boolean | undefined {
  return (mon as unknown as { battleInfo?: { visible: boolean } | null }).battleInfo?.visible;
}

function infoScale(mon: object): number | undefined {
  return (mon as unknown as { battleInfo?: { scaleX: number } | null }).battleInfo?.scaleX;
}

describe.skipIf(!RUN)("repro: triple-battle bugs (staging report)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterEach(() => {
    // Restore the battleStyle("triple") spy so the format override doesn't leak into the
    // next ER file's battles (isolate:false; mocks don't auto-reset).
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // #1 (enemy side) - a KO'd foe in a triple TRAINER battle IS replaced.
  // ---------------------------------------------------------------------------
  it("#1 enemy: KO one foe in a triple TRAINER battle -> a bench reserve is summoned into the slot", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER })
      .battleStyle("triple")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(50)
      .enemyMoveset(MoveId.HARDEN) // foes only buff themselves - they never damage me
      .moveset([MoveId.TACKLE, MoveId.HARDEN])
      // Shadow Tag traps the foes so the trainer AI can't VOLUNTARILY switch the doomed mon out
      // to safety (it does, otherwise) - we need it to actually FAINT, which is the report's case.
      .ability(AbilityId.SHADOW_TAG)
      .enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX, SpeciesId.SNORLAX);

    expect(globalScene.currentBattle.arrangement.enemyCapacity, "triple = 3 enemy slots").toBe(3);
    const field = globalScene.getEnemyField();
    console.log(`#1 enemy: trainer fielded ${field.length} foes (need 3 for a triple trainer battle)`);
    expect(field.length, "the triple trainer battle must field three foes").toBe(3);

    // Pin a clean bench: keep the three front mons, then add ONE reserve. That reserve is
    // the mon the replacement switch must bring in when a front foe faints.
    const battle = globalScene.currentBattle;
    battle.enemyParty.length = 3;
    const reserve = globalScene.addEnemyPokemon(getPokemonSpecies(SpeciesId.SHUCKLE), 50, field[0].trainerSlot);
    battle.enemyParty.push(reserve);
    expect(globalScene.getEnemyParty()).toHaveLength(4);
    expect(reserve.isOnField(), "the reserve starts on the bench").toBe(false);

    // KO exactly the slot-0 foe (hp 1 + my slot-0 Tackle); my other two slots Harden (self-buff,
    // no target, no KO), so only one foe faints and one bench reserve must fill the vacated slot.
    const enemyIdx = field.map(e => e.getBattlerIndex());
    field[0].hp = 1;
    game.move.select(MoveId.TACKLE, 0, enemyIdx[0]);
    game.move.select(MoveId.HARDEN, 1);
    game.move.select(MoveId.HARDEN, 2);
    console.log(
      `#1 enemy: pre-turn foes -> ${field.map(e => `${e.name}#${e.getBattlerIndex()}[hp=${e.hp}]`).join(" ")}; targeting ${enemyIdx[0]}`,
    );
    await game.toNextTurn();

    const afterField = globalScene.getEnemyField(true);
    console.log(
      `#1 enemy: after KO -> field=${afterField.length} living; reserve onField=${reserve.isOnField()} fainted=${reserve.isFainted()}`,
    );
    expect(field[0].isFainted(), "the targeted front foe fainted").toBe(true);
    expect(afterField.length, "the vacated slot was refilled (3 living foes again)").toBe(3);
    expect(reserve.isOnField(), "the bench reserve was summoned into the field").toBe(true);
    expect(reserve.isFainted()).toBe(false);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // #1 (wild) - a KO'd foe in a WILD triple is NOT replaced (intended: no reserves).
  // ---------------------------------------------------------------------------
  it("#1 wild: KO one foe in a WILD triple -> it is NOT replaced (documented intended behavior)", async () => {
    game.override
      .battleStyle("triple")
      .battleType(BattleType.WILD)
      .disableTrainerWaves()
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.HARDEN) // harmless self-buff (ER "Splash"/"Growl" spreads/attacks confound a triple)
      .moveset([MoveId.TACKLE, MoveId.HARDEN])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(50)
      .enemyLevel(5);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);

    const field = globalScene.getEnemyField();
    expect(field.length, "wild triple fields three foes").toBe(3);
    const enemyIdx = field.map(e => e.getBattlerIndex());
    field[0].hp = 1;
    // Only slot 0 attacks (its facing foe); slots 1-2 Harden (self, no target, no KO).
    game.move.select(MoveId.TACKLE, 0, enemyIdx[0]);
    game.move.select(MoveId.HARDEN, 1);
    game.move.select(MoveId.HARDEN, 2);
    console.log(
      `#1 wild: pre-turn foes -> ${field.map(e => `${e.name}[hp=${e.hp}]`).join(" ")}; targeting ${enemyIdx[0]}`,
    );
    await game.toNextTurn();

    const afterField = globalScene.getEnemyField(true);
    console.log(`#1 wild: after KO -> ${afterField.length} living foes (expected 2, no reserves in the wild)`);
    expect(field[0].isFainted(), "the targeted wild foe fainted").toBe(true);
    // Intended: a wild triple has no reserve party, so the slot is simply vacated - two foes remain.
    expect(afterField.length, "a wild triple has no reserve to summon (intended)").toBe(2);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // #1 (player side) - a fainted PLAYER mon with a bench IS replaced into its slot.
  // ---------------------------------------------------------------------------
  it("#1 player: a PLAYER mon faints with a bench -> the faint-switch fills its slot", async () => {
    game.override
      .battleStyle("triple")
      .battleType(BattleType.WILD)
      .disableTrainerWaves()
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.HARDEN) // harmless: nobody but my own lead faints this turn
      .moveset([MoveId.MEMENTO, MoveId.HARDEN])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(60)
      .enemyLevel(20)
      .criticalHits(false);
    // 4 mons: three leads + one bench replacement.
    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.SNORLAX, SpeciesId.SNORLAX, SpeciesId.BLISSEY);
    expect(globalScene.getPlayerParty()).toHaveLength(4);
    expect(globalScene.currentBattle.getBattlerCount()).toBe(3);

    const bench = globalScene.getPlayerParty()[3];
    const lead0 = globalScene.getPlayerField()[0];
    expect(bench.isOnField(), "the bench mon starts benched").toBe(false);

    // Slot 0 self-faints with Memento (deterministic, no dependence on enemy AI/targeting);
    // slots 1-2 Harden. Only the slot-0 lead faints -> its slot must be refilled from the bench.
    const enemyIdx = globalScene.getEnemyField().map(e => e.getBattlerIndex());
    game.move.select(MoveId.MEMENTO, 0, enemyIdx[0]);
    game.move.select(MoveId.HARDEN, 1);
    game.move.select(MoveId.HARDEN, 2);
    // Answer the faint-switch prompt by sending in the bench mon (party slot 3).
    game.doSelectPartyPokemon(3, "SwitchPhase");
    await game.toNextTurn();

    const field0 = globalScene.getPlayerField()[0];
    console.log(
      `#1 player: lead0 fainted=${lead0.isFainted()}; bench onField=${bench.isOnField()} fieldIndex=${bench.getFieldIndex?.()}; slot0 now=${field0?.name}`,
    );
    expect(lead0.isFainted(), "the 1-HP lead fainted").toBe(true);
    expect(bench.isOnField(), "the bench replacement was summoned onto the field").toBe(true);
    expect(bench.isFainted()).toBe(false);
    expect(field0, "the bench replacement occupies the vacated slot 0").toBe(bench);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // #2 (enemy side) - after WINNING a triple TRAINER battle, the previous foes leave
  //      the field and their battle-infos are hidden on the next wave. (This side was
  //      already correct; kept as a regression guard.)
  // ---------------------------------------------------------------------------
  it("#2 enemy: winning a triple TRAINER battle clears the FOES + their info bars for the next wave", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER })
      .battleStyle("triple")
      .criticalHits(false)
      .startingLevel(200) // OHKO every foe so the battle is won in one turn
      .enemyLevel(20)
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.TACKLE])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX, SpeciesId.SNORLAX);

    const battle = globalScene.currentBattle;
    battle.enemyParty.length = 3; // exactly 3, NO reserves -> KO all three = victory
    const oldFoes = globalScene.getEnemyField().slice();
    expect(oldFoes.length, "the triple trainer battle must field three foes").toBe(3);
    const enemyIdx = oldFoes.map(e => e.getBattlerIndex());
    for (const e of oldFoes) {
      e.hp = 1;
    }
    game.move.select(MoveId.TACKLE, 0, enemyIdx[0]);
    game.move.select(MoveId.TACKLE, 1, enemyIdx[1]);
    game.move.select(MoveId.TACKLE, 2, enemyIdx[2]);
    await game.toNextWave();

    console.log(
      `#2 enemy: next wave (wave ${globalScene.currentBattle.waveIndex}). old foes: `
        + oldFoes.map(f => `${f.name}[on=${f.isOnField()},vis=${f.visible},info=${infoVisible(f)}]`).join(" "),
    );
    for (const foe of oldFoes) {
      expect(foe.isFainted(), `${foe.name} was KO'd`).toBe(true);
      expect(foe.isOnField(), `${foe.name} must have left the field before the next wave`).toBe(false);
      expect(foe.visible, `${foe.name}'s sprite must be hidden`).toBe(false);
      expect(infoVisible(foe), `${foe.name}'s battle-info bar must be hidden`).toBe(false);
    }
  }, 120_000);

  // ---------------------------------------------------------------------------
  // #2 (PLAYER side - the CORRECTED report) - after a triple TRAINER battle, when the
  //      next wave's format is NARROWER (single/double) the player's leftover field slots
  //      (2nd + 3rd back sprites AND their info bars) must be recalled - they lingered on
  //      screen through the next intro ("the UI doesn't change, doesn't move away").
  // ---------------------------------------------------------------------------

  it("#2 player: triple TRAINER -> SINGLE next wave recalls the leftover 2nd + 3rd player slots", async () => {
    // A trainer next wave => resetArenaState => exercises the doPostBattleCleanup recall (root fix).
    game.override
      .battleStyle("triple")
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER })
      .criticalHits(false)
      .startingLevel(200) // OHKO every foe -> win wave 1 in one turn
      .enemyLevel(20)
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.TACKLE])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX, SpeciesId.SNORLAX);
    const oldLeads = globalScene.getPlayerField().slice();
    expect(oldLeads.length, "wave 1 is a triple (3 player leads on field)").toBe(3);
    const foes = globalScene.getEnemyField();
    globalScene.currentBattle.enemyParty.length = foes.length; // no reserves -> KO all = victory
    const enemyIdx = foes.map(e => e.getBattlerIndex());
    for (const e of foes) {
      e.hp = 1;
    }
    game.move.select(MoveId.TACKLE, 0, enemyIdx[0]);
    game.move.select(MoveId.TACKLE, 1, enemyIdx[1]);
    game.move.select(MoveId.TACKLE, 2, enemyIdx[2]);
    // Re-point the NEXT wave's format: the override is read fresh in resolveBattleFormat at
    // newBattle time, so this only affects wave 2 (wave 1 was already built as a triple).
    game.override.battleStyle("single");
    await game.toNextWave();

    expect(globalScene.currentBattle.arrangement.playerCapacity, "wave 2 is a single").toBe(1);
    console.log(
      "#2 player triple->single: leads -> "
        + oldLeads
          .map((p, i) => `slot${i} ${p.name}[on=${p.isOnField()},vis=${p.visible},info=${infoVisible(p)}]`)
          .join(" "),
    );
    // Slot 0 remains (the single lead); slots 1 and 2 must be fully recalled.
    expect(oldLeads[0].isOnField(), "the single lead (old slot 0) stays on the field").toBe(true);
    expect(oldLeads[0].fieldPosition, "the retained lead returns to the single CENTER lane").toBe(FieldPosition.CENTER);
    expect(infoScale(oldLeads[0]), "the retained lead's info bar returns to binary scale").toBe(1);
    for (const slot of [1, 2]) {
      const p = oldLeads[slot];
      expect(p.isOnField(), `old triple slot ${slot} must have left the field`).toBe(false);
      expect(p.visible, `old triple slot ${slot}'s back sprite must be hidden`).toBe(false);
      expect(infoVisible(p), `old triple slot ${slot}'s info bar must be hidden`).toBe(false);
    }
  }, 120_000);

  it("#2 player: triple -> DOUBLE next wave restores LEFT/RIGHT lanes and binary bars", async () => {
    game.override.startingWave(3);
    game.override
      .battleStyle("triple")
      .battleType(BattleType.WILD)
      .disableTrainerWaves()
      .enemySpecies(SpeciesId.MAGIKARP)
      .criticalHits(false)
      .startingLevel(200)
      .enemyLevel(5)
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.TACKLE])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX, SpeciesId.SNORLAX);
    const oldLeads = globalScene.getPlayerField().slice();
    const foes = globalScene.getEnemyField();
    globalScene.currentBattle.enemyParty.length = foes.length;
    for (const foe of foes) {
      foe.hp = 1;
    }
    const enemyIdx = foes.map(e => e.getBattlerIndex());
    game.move.select(MoveId.TACKLE, 0, enemyIdx[0]);
    game.move.select(MoveId.TACKLE, 1, enemyIdx[1]);
    game.move.select(MoveId.TACKLE, 2, enemyIdx[2]);
    game.override.battleStyle("double");
    await game.toNextWave();

    expect(globalScene.currentBattle.arrangement.playerCapacity, "wave 2 is a double").toBe(2);
    expect(oldLeads[0].isOnField()).toBe(true);
    expect(oldLeads[1].isOnField()).toBe(true);
    expect(oldLeads[2].isOnField(), "old triple slot 2 was recalled").toBe(false);
    expect(oldLeads[0].fieldPosition).toBe(FieldPosition.LEFT);
    expect(oldLeads[1].fieldPosition, "old triple CENTER becomes the double RIGHT lane").toBe(FieldPosition.RIGHT);
    expect(infoScale(oldLeads[0])).toBe(1);
    expect(infoScale(oldLeads[1])).toBe(1);
  }, 120_000);

  it("#2 player: triple WILD -> SINGLE next wave (non-reset) also recalls the leftover slots", async () => {
    // A wild same-biome next wave does NOT resetArenaState, so this exercises the encounter-phase
    // recall net (not the doPostBattleCleanup path).
    game.override.startingWave(3); // wave 3 -> 4, both inside biome 1 (no new-biome reset)
    game.override
      .battleStyle("triple")
      .battleType(BattleType.WILD)
      .disableTrainerWaves()
      .enemySpecies(SpeciesId.MAGIKARP)
      .criticalHits(false)
      .startingLevel(200)
      .enemyLevel(5)
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.TACKLE])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX, SpeciesId.SNORLAX);
    const oldLeads = globalScene.getPlayerField().slice();
    expect(oldLeads.length).toBe(3);
    const foes = globalScene.getEnemyField();
    globalScene.currentBattle.enemyParty.length = foes.length;
    const enemyIdx = foes.map(e => e.getBattlerIndex());
    for (const e of foes) {
      e.hp = 1;
    }
    game.move.select(MoveId.TACKLE, 0, enemyIdx[0]);
    game.move.select(MoveId.TACKLE, 1, enemyIdx[1]);
    game.move.select(MoveId.TACKLE, 2, enemyIdx[2]);
    game.override.battleStyle("single");
    await game.toNextWave();

    console.log(
      "#2 player wild->single: leads -> "
        + oldLeads.map((p, i) => `slot${i} ${p.name}[on=${p.isOnField()},vis=${p.visible}]`).join(" "),
    );
    expect(oldLeads[0].isOnField(), "the single lead (old slot 0) stays on the field").toBe(true);
    for (const slot of [1, 2]) {
      const p = oldLeads[slot];
      expect(p.isOnField(), `old triple slot ${slot} must have left the field`).toBe(false);
      expect(p.visible, `old triple slot ${slot}'s back sprite must be hidden`).toBe(false);
      expect(infoVisible(p), `old triple slot ${slot}'s info bar must be hidden`).toBe(false);
    }
  }, 120_000);

  it("#2 player: triple -> TRIPLE next wave keeps all three leads on the field (no over-recall)", async () => {
    game.override
      .battleStyle("triple")
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER })
      .criticalHits(false)
      .startingLevel(200)
      .enemyLevel(20)
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.TACKLE])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX, SpeciesId.SNORLAX);
    const oldLeads = globalScene.getPlayerField().slice();
    expect(oldLeads.length).toBe(3);
    const foes = globalScene.getEnemyField();
    globalScene.currentBattle.enemyParty.length = foes.length;
    const enemyIdx = foes.map(e => e.getBattlerIndex());
    for (const e of foes) {
      e.hp = 1;
    }
    game.move.select(MoveId.TACKLE, 0, enemyIdx[0]);
    game.move.select(MoveId.TACKLE, 1, enemyIdx[1]);
    game.move.select(MoveId.TACKLE, 2, enemyIdx[2]);
    await game.toNextWave(); // stays triple

    console.log(
      "#2 player triple->triple: leads -> "
        + oldLeads.map((p, i) => `slot${i} ${p.name}[on=${p.isOnField()},vis=${p.visible}]`).join(" "),
    );
    expect(globalScene.currentBattle.arrangement.playerCapacity, "wave 2 is still a triple").toBe(3);
    for (const slot of [0, 1, 2]) {
      const p = oldLeads[slot];
      expect(p.isOnField(), `triple lead ${slot} remains on the field`).toBe(true);
      expect(p.visible, `triple lead ${slot}'s back sprite is shown`).toBe(true);
    }
  }, 120_000);

  // ---------------------------------------------------------------------------
  // #3 - throwing a ball in a triple. VERIFICATION of the already-landed null-safe
  //      skip-loop fix (command-phase.ts / select-target-phase.ts) + the trainer
  //      rejection message. Do NOT re-fix; this only guards the fix.
  // ---------------------------------------------------------------------------
  it("#3 crash: throwing a ball from a later triple slot past an EMPTY earlier slot does not crash", async () => {
    game.override
      .battleStyle("triple")
      .battleType(BattleType.WILD)
      .disableTrainerWaves()
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.GROWL)
      .moveset([MoveId.GROWL, MoveId.TACKLE])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(50)
      .enemyLevel(5);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);
    globalScene.pokeballCounts[PokeballType.POKEBALL] = 10;

    // A ball is only throwable at a SINGLE live foe (the `noPokeballMulti` guard), so faint two
    // of the three foes; then throwing from the LAST slot walks past the earlier slots' commands.
    const foes = globalScene.getEnemyField();
    foes[1].hp = 0;
    foes[2].hp = 0;
    expect(globalScene.getEnemyField(true).length, "one live foe remains (ball is throwable)").toBe(1);

    // Slots 0 + 1 commit a harmless Growl (writes turnCommands[0], [1]); slot 2 throws the ball.
    game.move.select(MoveId.GROWL, 0);
    game.move.select(MoveId.GROWL, 1);

    const result: { threw: unknown; accepted: boolean | null; skipped1: boolean } = {
      threw: null,
      accepted: null,
      skipped1: false,
    };
    game.onNextPrompt("CommandPhase", UiMode.COMMAND, () => {
      const phase = globalScene.phaseManager.getCurrentPhase() as CommandPhase;
      if (phase.getFieldIndex() !== 2) {
        return;
      }
      // Mirror the tester's crash state: an EARLIER triple slot's command is null because that
      // mon had fainted (its CommandPhase never ran). Pre-fix the throw did
      // `turnCommands[fieldIndex - 1]!.skip = true` -> "Cannot set properties of null".
      globalScene.currentBattle.turnCommands[0] = null;
      try {
        result.accepted = phase.handleCommand(Command.BALL, PokeballType.POKEBALL);
        result.skipped1 = globalScene.currentBattle.turnCommands[1]?.skip === true;
      } catch (e) {
        result.threw = e;
      }
    });
    // Advancing fires slot 2's command-phase prompt; downstream capture resolution is irrelevant here.
    await game.phaseInterceptor.to("TurnStartPhase", false).catch(() => {});

    console.log(
      `#3 crash: threw=${result.threw == null ? "no" : String(result.threw)} accepted=${result.accepted} skippedEarlierSlot=${result.skipped1}`,
    );
    expect(result.threw, "throwing a ball past an empty triple slot must not crash").toBeNull();
    expect(result.accepted, "the ball throw is accepted at a single live foe").toBe(true);
    expect(result.skipped1, "an earlier committed slot's command is skipped (null-safe over ALL earlier slots)").toBe(
      true,
    );
  }, 120_000);

  it("#3 trainer: throwing a ball at a trainer's Pokemon is rejected (no throw, no crash, right message)", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER })
      .battleStyle("triple")
      .startingLevel(100)
      .enemyLevel(50)
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.GROWL, MoveId.TACKLE])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX, SpeciesId.SNORLAX);
    globalScene.pokeballCounts[PokeballType.POKEBALL] = 10;

    const showText = vi.spyOn(globalScene.ui, "showText");
    const phase = globalScene.phaseManager.getCurrentPhase() as CommandPhase;
    expect(phase.phaseName, "we start at the player's command phase").toBe("CommandPhase");

    let threw: unknown = null;
    let accepted: boolean | null = null;
    try {
      accepted = phase.handleCommand(Command.BALL, PokeballType.POKEBALL);
    } catch (e) {
      threw = e;
    }

    const rejected = showText.mock.calls.some(c => c[0] === i18next.t("battle:noPokeballTrainer"));
    console.log(
      `#3 trainer: threw=${threw == null ? "no" : String(threw)} accepted=${accepted} rejectMsgShown=${rejected}`,
    );
    expect(threw, "rejecting a ball throw at a trainer must not crash").toBeNull();
    expect(accepted, "the ball throw is rejected in a trainer battle").toBe(false);
    expect(globalScene.currentBattle.turnCommands[0]?.command, "no BALL command was committed").not.toBe(Command.BALL);
    expect(rejected, "the 'can't catch a trainer's Pokemon' message was shown").toBe(true);
  }, 120_000);
});
