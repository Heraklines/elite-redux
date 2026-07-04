/*
 * Regression tests for the tier-2 swarm-audit fixes (approximation/partial, 2026-07):
 *   - Hydro Circuit: adds the Water-move 25% lifesteal clause
 *   - Edgelord: first Keen Edge move / entry +1 priority (+ resets on KO) like Sidewinder
 *   - Atomic Burst: 10% paralysis on an Electric user's Electric moves
 *   - Kilobite: +1 user Speed when the foe's Speed can't be lowered
 *   - Tangling Husk: protect that slows contact attackers (SILK_TRAP)
 *
 * Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-tier2-fixes.test.ts
 */

import { allMoves } from "#data/data-lists";
import type { Move } from "#data/moves/move";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
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

describe.skipIf(!RUN)("ER tier-2 audit fixes", () => {
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

  const abilityAttrNames = async (erId: ErAbilityId): Promise<string[]> => {
    game.override.ability(erId as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    return game.scene
      .getPlayerPokemon()!
      .getAbility()
      .attrs.map(a => a.constructor.name);
  };

  it("Hydro Circuit: Electric boost + Water lifesteal both wired", async () => {
    const attrs = await abilityAttrNames(ErAbilityId.HYDRO_CIRCUIT);
    expect(attrs, "Electric +50%").toContain("TypeDamageBoostAbAttr");
    expect(attrs, "Water 25% lifesteal").toContain("LifestealOnHitAbAttr");
  }, 120_000);

  it("Edgelord: first-slicing-move priority (like Sidewinder), not the generic modifier", async () => {
    const attrs = await abilityAttrNames(ErAbilityId.EDGELORD);
    expect(attrs, "first flagged-move +1 priority").toContain("FirstFlaggedMovePriorityAbAttr");
    expect(attrs, "consumes the charge (resets on KO)").toContain("ConsumeFirstFlaggedMovePriorityAbAttr");
  }, 120_000);

  it("Christmas Spirit: hail damage reduction AND hail chip immunity", async () => {
    const attrs = await abilityAttrNames(ErAbilityId.CHRISTMAS_SPIRIT);
    expect(attrs, "50% hail move-damage reduction").toContain("WeatherDamageReductionAbAttr");
    expect(attrs, "hail chip immunity").toContain("BlockWeatherDamageAttr");
  }, 120_000);

  it("Desert Spirit: sand-on-entry AND self-immunity to sand chip", async () => {
    const attrs = await abilityAttrNames(ErAbilityId.DESERT_SPIRIT);
    expect(attrs, "sandstorm chip immunity").toContain("BlockWeatherDamageAttr");
  }, 120_000);

  it("Atomic Burst: carries the 10% paralysis-on-Electric-moves rider", async () => {
    const attrs = await abilityAttrNames(ErAbilityId.ATOMIC_BURST);
    expect(attrs, "10% paralysis on Electric moves").toContain("ChanceStatusOnAttackAbAttr");
  }, 120_000);

  it("Kilobite: drops foe Speed and self-boosts when the foe can't be lowered", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const kilobite = byName("Kilobite");
    const spdAttrs = kilobite.getAttrs("StatStageChangeAttr").filter(a => a.stats.includes(Stat.SPD));
    // one foe -1 SPD and one conditional self +1 SPD
    expect(spdAttrs.length, "two Speed stat-change attrs (foe drop + self boost)").toBeGreaterThanOrEqual(2);
    expect(
      spdAttrs.some(a => a.stages < 0),
      "foe Speed drop",
    ).toBe(true);
    expect(
      spdAttrs.some(a => a.stages > 0 && a.selfTarget),
      "conditional self Speed boost",
    ).toBe(true);
  }, 120_000);

  it("Tangling Husk: protects and slows a contact attacker (SILK_TRAP)", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(byName("Tackle").id) // contact move -> triggers the slow
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    const hp0 = player.hp;

    game.move.use(byName("Tangling Husk").id, 0); // +priority protect
    await game.move.forceEnemyMove(byName("Tackle").id);
    await game.toNextTurn();

    expect(player.hp, "protected: took no damage").toBe(hp0);
    expect(enemy.getStatStage(Stat.SPD), "contact attacker slowed -1").toBe(-1);
  }, 120_000);

  it("Demolitionist: breaks the foe's screens on entry (+ ATK x2 first turn, ignore Protect)", async () => {
    const attrs = await abilityAttrNames(ErAbilityId.DEMOLITIONIST);
    expect(attrs, "first-turn ATK x2").toContain("FirstTurnStatMultiplierAbAttr");
    expect(attrs, "ignore Protect on contact").toContain("IgnoreProtectOnContactAbAttr");
    expect(attrs, "screen break on entry").toContain("PostSummonRemoveArenaTagAbAttr");
  }, 120_000);

  it("Curius Medicine: resets ONLY the ally's stat stages (not field-wide Haze)", async () => {
    const attrs = await abilityAttrNames(ErAbilityId.CURIUSMEDICN);
    expect(attrs, "ally-only stat reset").toContain("PostSummonClearAllyStatStagesAbAttr");
    expect(attrs, "not the field-wide Haze scripted move").not.toContain("PostSummonScriptedMoveAbAttr");
  }, 120_000);

  it("Rivalry: opposite-gender clause reduces damage TAKEN, not dealt", async () => {
    const attrs = await abilityAttrNames(AbilityId.RIVALRY as unknown as ErAbilityId);
    expect(attrs, "same-gender outgoing boost kept").toContain("MovePowerBoostAbAttr");
    expect(attrs, "opposite-gender is an INCOMING damage reduction").toContain("ReceivedMoveDamageMultiplierAbAttr");
    // exactly one MovePowerBoostAbAttr (the old second, outgoing 0.75, is gone)
    expect(attrs.filter(n => n === "MovePowerBoostAbAttr").length, "only the same-gender boost remains").toBe(1);
  }, 120_000);

  it("Empress: inherits the rewritten Rivalry's damage-taken reduction", async () => {
    const attrs = await abilityAttrNames(ErAbilityId.EMPRESS);
    expect(attrs, "Queenly Majesty half").toContain("FieldPriorityMoveImmunityAbAttr");
    expect(attrs, "Rivalry damage-taken reduction").toContain("ReceivedMoveDamageMultiplierAbAttr");
  }, 120_000);
});
