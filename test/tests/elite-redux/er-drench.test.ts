/*
 * Regression tests for the ER DRENCH status (2.65 dex).
 *
 * DRENCH = the ER_DRENCHED battler tag: while present the holder moves LAST
 * within its move-priority bracket (respecting priority brackets) for 2 turns.
 * Applied by the Water-move drench chances (Water Gun, Hydro Pump, Surf,
 * Whirlpool, Dive, Water Spout, Wave Crash, Splash, Rapid River, Waterlog).
 * Blocked by DrenchImmunityAbAttr (Amphibious / Old Mariner).
 *
 * Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-drench.test.ts
 */

import { allMoves } from "#data/data-lists";
import type { Move } from "#data/moves/move";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { MovePriorityInBracket } from "#enums/move-priority-in-bracket";
import { PokemonType } from "#enums/pokemon-type";
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

/** The ErDrenchAttr on a move, if any (read its effective chance in clear weather). */
const drenchAttrOf = (name: string): { effectChanceOverride: number } | undefined =>
  byName(name).attrs.find(a => a.constructor.name === "ErDrenchAttr") as { effectChanceOverride: number } | undefined;

describe.skipIf(!RUN)("ER DRENCH status", () => {
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

  it("wiring: every drench-carrying move applies ER_DRENCHED at its dex chance", async () => {
    // A boot is required so ER custom-move init + vanilla patches run.
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    // Vanilla Water moves that gain a drench rider (chance from the 2.65 dex).
    expect(drenchAttrOf("Water Gun")?.effectChanceOverride, "Water Gun 10%").toBe(10);
    expect(drenchAttrOf("Hydro Pump")?.effectChanceOverride, "Hydro Pump 30%").toBe(30);
    expect(drenchAttrOf("Surf")?.effectChanceOverride, "Surf 20%").toBe(20);
    expect(drenchAttrOf("Whirlpool")?.effectChanceOverride, "Whirlpool 30%").toBe(30);
    expect(drenchAttrOf("Dive")?.effectChanceOverride, "Dive 10%").toBe(10);
    expect(drenchAttrOf("Water Spout")?.effectChanceOverride, "Water Spout 10%").toBe(10);
    expect(drenchAttrOf("Wave Crash")?.effectChanceOverride, "Wave Crash 10%").toBe(10);
    expect(drenchAttrOf("Splash")?.effectChanceOverride, "Splash (ER Heavy-Slam) 20%").toBe(20);

    // ER-custom moves whose archetype row emits DRENCH — the fixed-chance rider
    // replaces the generic move.chance-gated applier, and the move keeps its body.
    expect(drenchAttrOf("Rapid River")?.effectChanceOverride, "Rapid River 10%").toBe(10);
    expect(byName("Rapid River").hasAttr("MultiHitAttr"), "Rapid River still hits twice").toBe(true);

    const waterlog = byName("Waterlog");
    expect(drenchAttrOf("Waterlog")?.effectChanceOverride, "Waterlog 20% (clear weather)").toBe(20);
    expect(waterlog.hasAttr("ForceLastAttr"), "Waterlog makes the target move last (Quash)").toBe(true);
  }, 120_000);

  it("mechanic: a drenched mon moves LAST in its priority bracket", async () => {
    await game.classicMode.startBattle(SpeciesId.JOLTEON);
    const player = game.scene.getPlayerPokemon()!;
    const tackle = byName("Tackle");

    // Baseline: no in-bracket penalty.
    expect(tackle.getPriorityModifier(player, true)).toBe(MovePriorityInBracket.NORMAL);

    // Drenched -> forced last within the bracket.
    player.addTag(BattlerTagType.ER_DRENCHED);
    expect(player.getTag(BattlerTagType.ER_DRENCHED), "tag applied").toBeDefined();
    expect(tackle.getPriorityModifier(player, true)).toBe(MovePriorityInBracket.LAST);
  }, 120_000);

  it("battle: a fast drenched mon is out-sped by a slower foe (same bracket)", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.MUNCHLAX) // base speed 5 — much slower than Jolteon (130)
      .enemyMoveset(byName("Tackle").id)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    // 2-mon party so the lead fainting just prompts a bench send (no game over).
    await game.classicMode.startBattle(SpeciesId.JOLTEON, SpeciesId.SNORLAX);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;

    // Both on death's door: whoever moves first this turn KOs the other.
    player.hp = 1;
    enemy.hp = 1;
    // Jolteon (130 spe) would normally out-speed Munchlax (5 spe) and win the KO
    // race — drench flips it, so the foe strikes first and Jolteon faints.
    player.addTag(BattlerTagType.ER_DRENCHED);

    game.move.use(byName("Tackle").id, 0);
    await game.move.forceEnemyMove(byName("Tackle").id);
    // When the drenched lead faints mid-turn, auto-send the bench mon so the
    // turn resolves instead of hanging on the switch prompt.
    game.doSelectPartyPokemon(1, "SwitchPhase");
    await game.toNextTurn();

    expect(player.isFainted(), "drenched Jolteon moved last and fainted").toBe(true);
    expect(enemy.isFainted(), "slower foe struck first and survived").toBe(false);
  }, 120_000);

  it("application: Hydro Pump drenches the target when the chance procs", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.SNORLAX) // bulky — survives the hit so we can read its tag
      .enemyMoveset(byName("Splash").id)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    // The framework clamps battle rolls to MAX, so a 30% proc never fires on its
    // own. Force the user's secondary-effect roll low so the drench lands.
    vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0);

    game.move.use(byName("Hydro Pump").id, 0);
    await game.toNextTurn();

    expect(enemy.getTag(BattlerTagType.ER_DRENCHED), "target became drenched").toBeDefined();
  }, 120_000);

  it("immunity: an Amphibious mon can't become drenched", async () => {
    // Rattata (Normal) so the immunity is isolated to the ability, not typing.
    game.override.ability(ErAbilityId.AMPHIBIOUS as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.RATTATA);
    const player = game.scene.getPlayerPokemon()!;
    expect(player.hasAbilityWithAttr("DrenchImmunityAbAttr"), "Amphibious grants drench immunity").toBe(true);

    const added = player.addTag(BattlerTagType.ER_DRENCHED);
    expect(added, "addTag rejected by canAdd").toBe(false);
    expect(player.getTag(BattlerTagType.ER_DRENCHED), "no drench tag present").toBeUndefined();
  }, 120_000);

  it("immunity: a Water-type mon can't become drenched", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP); // pure Water
    const player = game.scene.getPlayerPokemon()!;
    expect(player.isOfType(PokemonType.WATER), "Magikarp is Water-type").toBe(true);

    const added = player.addTag(BattlerTagType.ER_DRENCHED);
    expect(added, "Water type rejected by canAdd").toBe(false);
    expect(player.getTag(BattlerTagType.ER_DRENCHED), "no drench tag present").toBeUndefined();
  }, 120_000);

  it("immunity: a water-immune ability (Water Absorb) blocks drench", async () => {
    // Snorlax (Normal, not Water) with Water Absorb: immune via the ability path.
    game.override.ability(AbilityId.WATER_ABSORB);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.scene.getPlayerPokemon()!;
    expect(player.isOfType(PokemonType.WATER), "Snorlax is not Water-type").toBe(false);

    const added = player.addTag(BattlerTagType.ER_DRENCHED);
    expect(added, "Water Absorb rejected by canAdd").toBe(false);
    expect(player.getTag(BattlerTagType.ER_DRENCHED), "no drench tag present").toBeUndefined();
  }, 120_000);
});
