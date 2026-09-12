import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { ER_ACHIEVEMENT_REWARDS, resolveAchievementRewardTeam } from "#data/elite-redux/er-achievement-rewards";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { getErShinyLabEffectsForAchv } from "#data/elite-redux/er-shiny-lab-effects";
import { Egg } from "#data/egg";
import { BattleStyle } from "#enums/battle-style";
import { BiomeId } from "#enums/biome-id";
import { SpeciesId } from "#enums/species-id";
import { achvs, LevelAchv } from "#system/achv";
import { vouchers } from "#system/voucher";
import { GameData } from "#system/game-data";
import { NumberHolder } from "#utils/common";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import Phaser from "phaser";
import { afterAll, expect, test, vi } from "vitest";

const PIN = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
const KEYS = ["LV_100", "LV_250", "LV_1000", "REALISTIC_FLASH_IS_BORING", "MAX_FRIENDSHIP"] as const;
let game: Phaser.Game | undefined;
let manager: GameManager | undefined;
afterAll(() => {
  vi.restoreAllMocks();
  manager?.promptHandler.clearPrompts();
  if (PromptHandler.runInterval != null) {
    clearInterval(PromptHandler.runInterval);
    PromptHandler.runInterval = undefined;
  }
  game?.destroy(true);
});

test("observe actual level and Flash achievement descendants", async () => {
  const output = process.env.M9_ACHIEVEMENT_DESCENDANTS_OUTPUT;
  if (!output) throw new Error("M9_ACHIEVEMENT_DESCENDANTS_OUTPUT required");
  expect(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(PIN);
  game = new Phaser.Game({ type: Phaser.HEADLESS, seed: ["m9e-achievement-descendants"] });
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  manager = new GameManager(game);
  manager.override.disableShinies = false;
  manager.override.normalizeIVs = false;
  manager.override.normalizeNatures = false;
  manager.override.shiny(null).enemyShiny(null).playerIVs(null).enemyIVs(null)
    .nature(null).enemyNature(null).battleStyle(BattleStyle.SET)
    .startingBiome(BiomeId.TOWN).startingWave(1).seed("m9e-achievement-descendants");
  await manager.classicMode.startBattle(SpeciesId.BULBASAUR);
  const scene = globalScene;
  expect(scene.gameMode.isClassic).toBe(true);
  expect(Boolean(scene.gameMode.isCoop)).toBe(false);
  expect(Boolean(scene.gameMode.isFun)).toBe(false);
  expect(scene.currentBattle.isBattleMysteryEncounter()).toBe(false);
  expect(Overrides.ACHIEVEMENTS_REUNLOCK_OVERRIDE).toBe(false);
  expect(vi.isMockFunction(scene.validateAchv)).toBe(false);
  expect(vi.isMockFunction(scene.validateAchvs)).toBe(false);
  expect(vi.isMockFunction(Egg.prototype.addEggToGameData)).toBe(false);
  const originalAccount = scene.gameData;
  const account = new GameData(true);
  expect(vi.isMockFunction(account.addStarterCandy)).toBe(false);
  const rng = Phaser.Math.RND.state();
  const randomValues: number[] = [];
  const clockValues: number[] = [];
  const toastKinds: string[] = [];
  const seededDraws: { min: number; max: number; result: number }[] = [];
  const integerInRange = Phaser.Math.RND.integerInRange.bind(Phaser.Math.RND);
  const seeded = vi.spyOn(Phaser.Math.RND, "integerInRange").mockImplementation((min, max) => {
    const result = integerInRange(min, max);
    seededDraws.push({ min, max, result });
    return result;
  });
  const seedScope = vi.spyOn(scene, "executeWithSeedOffset");
  let clock = 1783641600000;
  // External nondeterminism only. Achievement, reward, Egg and candy methods
  // remain actual source. Rendering is a leaf observation, not reward logic.
  const random = vi.spyOn(Math, "random").mockImplementation(() => {
    const choices = [0, 0.125, 0.5, 0.875, 1 - Number.EPSILON];
    const value = choices[randomValues.length % choices.length];
    randomValues.push(value);
    return value;
  });
  const now = vi.spyOn(Date, "now").mockImplementation(() => {
    const value = clock++;
    clockValues.push(value);
    return value;
  });
  const toast = vi.spyOn(scene.ui.achvBar, "showAchv").mockImplementation(achv => {
    toastKinds.push(achv.constructor.name + ":" + (achv.id ?? ""));
  });
  const grantCalls: unknown[] = [];
  const addCandy = account.addStarterCandy.bind(account);
  const candy = vi.spyOn(account, "addStarterCandy").mockImplementation((...args) => {
    const result = addCandy(...args);
    grantCalls.push({ kind: "candy", args, result });
    return result;
  });
  const addEgg = Egg.prototype.addEggToGameData;
  const eggGrant = vi.spyOn(Egg.prototype, "addEggToGameData").mockImplementation(function(this: Egg) {
    const result = addEgg.call(this);
    grantCalls.push({ kind: "egg", id: this.id, timestamp: this.timestamp });
    return result;
  });
  const team = resolveAchievementRewardTeam(scene.getPlayerParty(), undefined);
  const roots = [...new Set(team.map(mon => account.getRootStarterSpeciesId(mon.species.speciesId)))];
  const snapshot = () => ({
    unlocks: { ...account.achvUnlocks }, voucher_unlocks: { ...account.voucherUnlocks },
    voucher_counts: { ...account.voucherCounts },
    candy: roots.map(root => ({ root, count: account.starterData[root].candyCount })),
    eggs: account.eggs.map(egg => ({ id: egg.id, tier: egg.tier, source: egg.sourceType,
      hatch_waves: egg.hatchWaves, timestamp: egg.timestamp, species: egg.species,
      shiny: egg.isShiny, variant: egg.variantTier, egg_move: egg.eggMoveIndex,
      hidden_ability: egg.overrideHiddenAbility })),
  });
  const observe = (name: string, action: () => unknown) => {
    const before = snapshot();
    const randomStart = randomValues.length;
    const clockStart = clockValues.length;
    const toastStart = toastKinds.length;
    const grantStart = grantCalls.length;
    const seededStart = seededDraws.length;
    const scopeStart = seedScope.mock.calls.length;
    const result = action();
    return { name, result: result ?? null, before, after: snapshot(),
      random_values: randomValues.slice(randomStart), clock_values: clockValues.slice(clockStart),
      grant_calls: grantCalls.slice(grantStart),
      seeded_draws: seededDraws.slice(seededStart),
      seed_scopes: seedScope.mock.calls.slice(scopeStart).map(args => ({ offset: args[1], seed: args[2] })),
      toasts: toastKinds.slice(toastStart), battle_rng_unchanged: Phaser.Math.RND.state() === rng };
  };
  try {
    scene.gameData = account;
    const cases = [];
    for (const level of [99, 100, 250, 1000, 1000]) {
      cases.push(observe(`level-${level}`, () => scene.validateAchvs(LevelAchv, new NumberHolder(level))));
    }
    cases.push(observe("flash-first", () => scene.validateAchv(achvs.REALISTIC_FLASH_IS_BORING)));
    cases.push(observe("flash-repeat", () => scene.validateAchv(achvs.REALISTIC_FLASH_IS_BORING)));
    clock = 0;
    cases.push(observe("max-first-at-zero", () => scene.validateAchv(achvs.MAX_FRIENDSHIP)));
    cases.push(observe("max-repeat-after-zero", () => scene.validateAchv(achvs.MAX_FRIENDSHIP)));
    expect(cases.every(row => row.battle_rng_unchanged)).toBe(true);
    const bytes = Buffer.from(JSON.stringify({ schema_version: 1, source_sha: PIN,
      scope: "actual initialized validateAchv/validateAchvs and Egg/reward descendants; no battle win or hatching claim",
      difficulty: getErDifficulty(), team: team.map(mon => ({ species: mon.species.speciesId,
        root: account.getRootStarterSpeciesId(mon.species.speciesId) })),
      definitions: KEYS.map(key => ({ key, id: achvs[key].id, recipe: ER_ACHIEVEMENT_REWARDS[key],
        voucher: Object.hasOwn(vouchers, achvs[key].id), effects: getErShinyLabEffectsForAchv(key) })), cases,
    }) + "\n");
    expect(bytes.length).toBeLessThanOrEqual(32768);
    writeFileSync(output, bytes);
  } finally {
    toast.mockRestore(); now.mockRestore(); random.mockRestore(); seeded.mockRestore(); seedScope.mockRestore(); candy.mockRestore(); eggGrant.mockRestore();
    scene.gameData = originalAccount;
    expect(Phaser.Math.RND.state()).toBe(rng);
  }
});
