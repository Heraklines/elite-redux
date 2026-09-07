import { timedEventManager } from "#app/global-event-manager";
import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { getStarterValueFriendshipCap, speciesStarterCosts } from "#balance/starters";
import { modifierTypes } from "#data/data-lists";
import { erBalanceArr } from "#data/elite-redux/er-balance-tuning";
import { isFunDebugModeActive } from "#data/elite-redux/er-fun-mode";
import { getCurrentErRewardRates } from "#data/elite-redux/er-reward-rates";
import { getMoodyModeState } from "#data/elite-redux/moody/moody-state";
import { BattleStyle } from "#enums/battle-style";
import { BiomeId } from "#enums/biome-id";
import { SpeciesId } from "#enums/species-id";
import { PokemonFriendshipBoosterModifier } from "#modifiers/modifier";
import { achvs } from "#system/achv";
import { RibbonData } from "#system/ribbons/ribbon-data";
import { getRibbonOwnerSpeciesId } from "#system/ribbons/ribbon-methods";
import { GameManager } from "#test/framework/game-manager";
import { getModifierType } from "#utils/modifier-utils";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import Phaser from "phaser";
import { afterAll, expect, test, vi } from "vitest";

// DRAFT: source reviewed only. This calls source methods on controlled actual
// GameManager objects. It is not a gameplay-phase, browser, or persistent-profile proof.
const ORACLE_SHA = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
const SEED = "m9-source-friendship-candy-v1";
const CASE_IDS = [
  "negative_loss", "zero", "rare_cap", "above_rare_cap", "max", "repeated_max",
  "threshold", "candy_saturated", "boosted_threshold", "boosted_capped",
  "shared_fusion_threshold", "direct_saturation", "direct_egg", "direct_zero", "direct_negative",
] as const;
let game: Phaser.Game | null = null;
let manager: GameManager | null = null;

afterAll(async () => {
  await manager?.scene.candyBar.hide();
  manager = null;
  game?.destroy(true);
  game = null;
});

function f64(value: number) {
  if (!Number.isFinite(value)) throw new Error("non-finite source observation");
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  return { value, bits_be: view.getBigUint64(0, false).toString(16).padStart(16, "0") };
}

test("export actual pinned friendship and candy method observations", async () => {
  const outputPath = process.env.M9_FRIENDSHIP_ORACLE_OUTPUT;
  if (!outputPath) throw new Error("M9_FRIENDSHIP_ORACLE_OUTPUT is required");
  expect(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(ORACLE_SHA);
  game = new Phaser.Game({ type: Phaser.HEADLESS, seed: [SEED] });
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  manager = new GameManager(game);
  manager.override.disableShinies = false;
  manager.override.normalizeIVs = false;
  manager.override.normalizeNatures = false;
  manager.override.shiny(null).enemyShiny(null).playerIVs(null).enemyIVs(null)
    .nature(null).enemyNature(null).battleStyle(BattleStyle.SET)
    .startingBiome(BiomeId.TOWN).startingWave(1).seed(SEED);
  await manager.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.BULBASAUR);
  const scene = manager.scene;
  const [probe, donor] = scene.getPlayerParty();
  if (!probe || !donor) throw new Error("two actual starter Pokemon required; fusion cannot be skipped");
  expect(probe.id).not.toBe(donor.id);
  expect(scene.getPlayerParty()).toHaveLength(2);
  const data = scene.gameData;
  const sourceRoot = probe.species.getRootSpeciesId();
  const candyRoot = data.getRootStarterSpeciesId(sourceRoot);
  // The API may lazily create an account; setup records that fact. No fake entry is substituted.
  const accountExisted = Object.hasOwn(data.starterData, candyRoot);
  const account = data.getStarterDataEntry(sourceRoot);
  expect(data.starterData[sourceRoot]).toBe(account);
  expect(sourceRoot).toBe(candyRoot);
  const cap = getStarterValueFriendshipCap(speciesStarterCosts[sourceRoot]);
  expect(Number.isSafeInteger(cap) && cap > 1).toBe(true);

  for (const method of [probe.addFriendship, probe.fuse, data.addStarterCandy,
    data.getStarterDataEntry, data.getRootStarterSpeciesId, scene.addModifier,
    scene.applyModifier, PokemonFriendshipBoosterModifier.prototype.apply,
    getCurrentErRewardRates, timedEventManager.getClassicFriendshipMultiplier,
    timedEventManager.areFusionsBoosted]) {
    expect(vi.isMockFunction(method)).toBe(false);
  }

  const ribbonIds: SpeciesId[] = [];
  let ribbonId: SpeciesId | undefined = getRibbonOwnerSpeciesId(probe.species.speciesId);
  while (ribbonId != null) {
    if (ribbonIds.includes(ribbonId) || ribbonIds.length >= 8) throw new Error("invalid ribbon source lineage");
    ribbonIds.push(ribbonId);
    ribbonId = pokemonPrevolutions[ribbonId];
  }
  const accounts = () => Object.entries(data.starterData)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, entry]) => ({ id: Number(id), friendship: entry.friendship ?? null, candy: entry.candyCount }));
  const state = () => ({
    friendship: f64(probe.friendship),
    accounts: accounts(),
    ribbons: ribbonIds.map(id => ({ id, friendship: data.dexData[id].ribbons.has(RibbonData.FRIENDSHIP) })),
    // Actual timestamps are intentionally excluded from the deterministic arithmetic data.
    max_friendship_unlocked: Object.hasOwn(data.achvUnlocks, achvs.MAX_FRIENDSHIP.id),
  });
  const environment = () => {
    const moody = getMoodyModeState();
    const event = timedEventManager.activeEvent();
    expect(scene.gameMode.isClassic).toBe(true);
    expect(scene.gameMode.isFun).toBe(false);
    expect(isFunDebugModeActive(scene.gameMode.isFun)).toBe(false);
    expect(moody).toBeNull();
    // GameWrapper disables timed events; this is an explicit harness limitation.
    expect(Reflect.get(timedEventManager, "disabled")).toBe(true);
    expect(event).toBeUndefined();
    return {
      mode_id: scene.gameMode.modeId, classic: scene.gameMode.isClassic, fun: scene.gameMode.isFun,
      fun_debug: isFunDebugModeActive(scene.gameMode.isFun), moody: null,
      timed_events_disabled_by_harness: true, active_event: null,
      classic_multiplier: f64(timedEventManager.getClassicFriendshipMultiplier()),
      fusions_boosted: timedEventManager.areFusionsBoosted(),
      reward_rates: getCurrentErRewardRates(),
      cap_registry: [...erBalanceArr("vanilla.friendship.capByCost")],
      sources: [probe.species, ...(probe.fusionSpecies ? [probe.fusionSpecies] : [])].map(species => {
        const root = species.getRootSpeciesId();
        return { species: species.speciesId, source_root: root, candy_root: data.getRootStarterSpeciesId(root),
          cost: speciesStarterCosts[root], cap: getStarterValueFriendshipCap(speciesStarterCosts[root]) };
      }),
      held_boosters: probe.getHeldItems().filter(item => item instanceof PokemonFriendshipBoosterModifier)
        .map(item => ({ type: item.type.id, stack: item.getStackCount(), belongs_to_probe: item.pokemonId === probe.id })),
    };
  };
  expect(environment().held_boosters).toHaveLength(0);
  expect(vi.isMockFunction(scene.validateAchv)).toBe(false);
  expect(vi.isMockFunction(scene.candyBar.showStarterSpeciesCandy)).toBe(false);
  // Default spies call through to the actual side-effect methods. No implementation is replaced.
  const achievementSpy = vi.spyOn(scene, "validateAchv");
  const candyBarSpy = vi.spyOn(scene.candyBar, "showStarterSpeciesCandy");
  const observations: unknown[] = [];
  const ids: string[] = [];

  const observe = async (id: string, request: object, invoke: () => void | boolean) => {
    await scene.candyBar.hide();
    achievementSpy.mockClear();
    candyBarSpy.mockClear();
    const context = environment();
    const before = state();
    const result = invoke();
    // Await actual headless UI promises; rejection is a failure, never swallowed.
    for (const call of candyBarSpy.mock.results) {
      if (call.type !== "return") throw new Error("actual candy bar did not return normally");
      await call.value;
    }
    const after = state();
    const beforeById = new Map(before.accounts.map(entry => [entry.id, entry]));
    const afterById = new Map(after.accounts.map(entry => [entry.id, entry]));
    const changed = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort((a, b) => a - b)
      .filter(id => JSON.stringify(beforeById.get(id)) !== JSON.stringify(afterById.get(id)));
    if (changed.length > 16) throw new Error("unexpected broad account mutation");
    const touched = [...new Set([sourceRoot, candyRoot, ...changed])].sort((a, b) => a - b);
    const compact = (snapshot: ReturnType<typeof state>) => ({ ...snapshot,
      accounts: snapshot.accounts.filter(entry => touched.includes(entry.id)) });
    observations.push({ id, request, context, before: compact(before), after: compact(after),
      account_inventory_count_before: before.accounts.length, account_inventory_count_after: after.accounts.length,
      changed_account_ids: changed, returned: result ?? null,
      achievements: achievementSpy.mock.calls.map(([achievement], index) => ({
        id: achievement.id, is_max_friendship: achievement === achvs.MAX_FRIENDSHIP,
        returned: achievementSpy.mock.results[index].type === "return" ? achievementSpy.mock.results[index].value : null,
      })),
      candy_bar_calls: candyBarSpy.mock.calls.map(([root, count]) => ({ root, count: f64(count) })),
      candy_bar_shown_after: scene.candyBar.shown,
    });
    ids.push(id);
    await scene.candyBar.hide();
  };
  const friendship = async (id: string, before: number, amount: number, capped = false, progress = 0, candy = 0) => {
    probe.friendship = before;
    account.friendship = progress;
    account.candyCount = candy;
    await observe(id, { kind: "friendship", amount: f64(amount), capped }, () => probe.addFriendship(amount, capped));
  };
  try {
    await friendship("negative_loss", 5, -5);
    await friendship("zero", 5, 0);
    await friendship("rare_cap", 199, 6, true);
    await friendship("above_rare_cap", 240, 6, true);
    await friendship("max", 254, 3);
    await friendship("repeated_max", 255, 3);
    await friendship("threshold", 50, 3, false, cap - 1);
    await friendship("candy_saturated", 50, 3, false, cap - 1, 9999);
    const bell = getModifierType(modifierTypes.SOOTHE_BELL).newModifier(probe);
    expect(bell).toBeInstanceOf(PokemonFriendshipBoosterModifier);
    expect(scene.addModifier(bell, false)).toBe(true);
    expect(environment().held_boosters).toEqual([{ type: "SOOTHE_BELL", stack: 1, belongs_to_probe: true }]);
    await friendship("boosted_threshold", 50, 3, false, cap - 1);
    await friendship("boosted_capped", 199, 3, true);
    const originalIdsDistinct = probe.id !== donor.id;
    expect(donor.species.getRootSpeciesId()).toBe(sourceRoot);
    expect(donor.getHeldItems()).toHaveLength(0);
    probe.fuse(donor);
    expect(probe.isFusion()).toBe(true);
    expect(scene.getPlayerParty()).toHaveLength(1);
    expect(scene.getPlayerParty()[0]).toBe(probe);
    expect(probe.fusionSpecies?.getRootSpeciesId()).toBe(sourceRoot);
    const fusionSource = probe.fusionSpecies;
    if (!fusionSource) throw new Error("actual fusion species is required");
    expect(data.starterData[fusionSource.getRootSpeciesId()]).toBe(account);
    expect(environment().held_boosters).toEqual([{ type: "SOOTHE_BELL", stack: 1, belongs_to_probe: true }]);
    await friendship("shared_fusion_threshold", 50, 3, false, cap - 1);
    const direct = async (id: string, before: number, count: number, egg: boolean) => {
      account.candyCount = before;
      await observe(id, { kind: "candy", species: sourceRoot, count: f64(count), from_egg: egg, show_bar: true },
        () => data.addStarterCandy(sourceRoot, count, egg, true));
    };
    await direct("direct_saturation", 9998, 2, false);
    await direct("direct_egg", 1, 2, true);
    await direct("direct_zero", 5, 0, false);
    await direct("direct_negative", 5, -2, false);
    expect(ids).toEqual(CASE_IDS);
    const output = { schema_version: 1, oracle_sha: ORACLE_SHA, requested_seed: SEED, actual_scene_seed: scene.seed,
      qualification: "actual source methods on controlled GameManager objects; remote execution required",
      setup: { source_root: sourceRoot, candy_root: candyRoot, account_existed: accountExisted,
        distinct_pokemon_before_fusion: originalIdsDistinct, same_source_root_fusion: true,
        friendship_booster_probe_reexecuted: false, captured_boosted_holder: false,
        side_effect_spies: "default call-through only", timestamps_exported: false },
      cases: observations };
    const encoded = `${JSON.stringify(output)}\n`;
    if (Buffer.byteLength(encoded, "utf8") > 32768) throw new Error("oracle exceeds 32 KiB");
    writeFileSync(outputPath, encoded, { encoding: "utf8", flag: "wx" });
  } finally {
    achievementSpy.mockRestore();
    candyBarSpy.mockRestore();
    await scene.candyBar.hide();
  }
});
