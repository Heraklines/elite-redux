/*
 * Regression tests for the rare-move dex-parity fixes (audit 2026-07):
 *   - secondary-effect chance corrections (Shot Put/Ball Toss/Spread Bomb/Saber Slashes)
 *   - Prism Blast reliable accuracy drop (effectChanceOverride)
 *   - Blazing Arrow +1 crit, Depletion Beam 3-PP cut
 *   - Merculight paralyzing protect, Party Favors user+ally heal
 *
 * Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-rare-move-fixes.test.ts
 */

import { allMoves } from "#data/data-lists";
import type { Move } from "#data/moves/move";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
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

describe.skipIf(!RUN)("ER rare-move dex-parity fixes", () => {
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

  it("wiring: secondary chances + attrs match the ER dex", async () => {
    // A boot is required so ER custom-move init runs and patches allMoves.
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    // ---- secondary-effect chance corrections ----
    expect(byName("Shot Put").chance, "Shot Put 30% speed drop").toBe(30);
    expect(byName("Ball Toss").chance, "Ball Toss 20% flinch").toBe(20);
    expect(byName("Spread Bomb").chance, "Spread Bomb 30% burn").toBe(30);
    expect(byName("Saber Slashes").chance, "Saber Slashes 20% flinch").toBe(20);

    // ---- Prism Blast: accuracy drop is RELIABLE (effectChanceOverride 100), not the 10% confuse gate ----
    const prism = byName("Prism Blast");
    const accDrop = prism.getAttrs("StatStageChangeAttr").find(a => a.stats.includes(Stat.ACC) && a.stages < 0);
    expect(accDrop, "Prism Blast has an accuracy-drop attr").toBeDefined();
    expect(accDrop?.effectChanceOverride, "accuracy drop is forced to 100%").toBe(100);

    // ---- Blazing Arrow +1 crit; Depletion Beam 3-PP cut ----
    expect(byName("Blazing Arrow").hasAttr("HighCritAttr"), "Blazing Arrow +1 crit").toBe(true);
    expect(byName("Depletion Beam").hasAttr("AttackReducePpMoveAttr"), "Depletion Beam PP cut").toBe(true);

    // ---- Merculight paralyzing protect; Party Favors user+ally heal ----
    const merc = byName("Merculight");
    const mercTag = merc.getAttrs("AddBattlerTagAttr").some(a => a.tagType === BattlerTagType.ER_PARALYZING_SHIELD);
    expect(mercTag, "Merculight applies ER_PARALYZING_SHIELD").toBe(true);
    const pf = byName("Party Favors").attrs.some(a => a.constructor.name === "HealUserAndAllyAttr");
    expect(pf, "Party Favors heals user+ally").toBe(true);
  }, 120_000);

  it("Merculight: protects the user AND paralyzes a contact attacker", async () => {
    const tackleId = allMoves.find(m => m?.name === "Tackle")!.id;
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(tackleId) // a CONTACT move so the protect's paralyze can trigger
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    const hp0 = player.hp;
    // ER enemies keep their innates active; this Magikarp carries a Limber-like
    // paralysis-immunity innate. Suppress its abilities so the paralyze-on-contact
    // effect is observable (a Limber mon correctly resisting is separate, expected behavior).
    enemy.summonData.abilitySuppressed = true;

    game.move.use(byName("Merculight").id, 0); // +4 priority protect, goes first
    await game.move.forceEnemyMove(tackleId);
    await game.toNextTurn();

    expect(player.hp, "protected: took no damage").toBe(hp0);
    expect(enemy.status?.effect, "contact attacker is paralyzed").toBe(StatusEffect.PARALYSIS);
  }, 120_000);

  it("Party Favors: damages the foe and heals the user + its ally by 25%", async () => {
    game.override
      .battleStyle("double")
      .startingLevel(50)
      .enemyLevel(50)
      // Bulky, ASLEEP foes: they take Party Favors' hit (so its heal fires) but
      // cannot counter-attack, so the players' HP moves only by the heal and the
      // reading is clean. They also survive (Blissey's offense is tiny), so the
      // wave doesn't end into the reward shop. NB: ER rebalances many "do nothing"
      // moves into real attacks (Splash and Growl both damage), so a sleeping foe
      // is the reliable way to get a no-counterattack turn here.
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyStatusEffect(StatusEffect.SLEEP)
      .enemyMoveset(byName("Tackle").id) // unused while asleep
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.CHANSEY);
    const [user, ally] = game.scene.getPlayerField();
    // Wound both so a heal is observable.
    user.hp = Math.floor(user.getMaxHp() * 0.4);
    ally.hp = Math.floor(ally.getMaxHp() * 0.4);
    const userHp0 = user.hp;
    const allyHp0 = ally.hp;

    const enemyIdx = game.scene.getEnemyField()[0].getBattlerIndex();
    game.move.use(byName("Party Favors").id, 0, enemyIdx);
    game.move.use(allMoves.find(m => m?.name === "Protect")!.id, 1); // ally: inert self-move
    await game.toNextTurn();

    const heal = Math.floor(user.getMaxHp() * 0.25);
    expect(user.hp, "user healed ~25%").toBeGreaterThanOrEqual(userHp0 + heal - 1);
    expect(ally.hp, "ally healed ~25%").toBeGreaterThanOrEqual(allyHp0 + Math.floor(ally.getMaxHp() * 0.25) - 1);
  }, 120_000);
});
