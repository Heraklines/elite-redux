import { globalScene } from "#app/global-scene";
import {
  bitsetToErShinyLabAvailableSet,
  decodeErShinyLabLoadout,
  decodeErShinyLabParams,
  encodeErShinyLabLoadout,
  encodeErShinyLabParams,
  encodeErShinyLabPreset,
  ER_SHINY_LAB_CATEGORIES,
  ER_SHINY_LAB_EFFECTS_BY_CATEGORY,
  erShinyLabAvailableSetToBitset,
  type ErShinyLabCategory,
  type ErShinyLabConfig,
  type ErShinyLabEffect,
  type ErShinyLabLoadout,
  type ErShinyLabParams,
  type ErShinyLabSaveData,
  getErShinyLabDiscountedEffects,
  getErShinyLabEarnedTier,
  getErShinyLabEffectCost,
  getErShinyLabOwnedSet,
  normalizeErShinyLabPresets,
  sanitizeErShinyLabLoadout,
  setErShinyLabOwnedBit,
} from "#data/elite-redux/er-shiny-lab-effects";
import type { StarterDataEntry } from "#types/save-data";
import { getPokemonSpecies } from "#utils/pokemon-utils";

function ensureShinyLabSave(entry: StarterDataEntry): ErShinyLabSaveData {
  return (entry.erShinyLab ??= {});
}

function saveSystem(): void {
  globalScene.gameData.saveSystem().then(success => {
    if (!success) {
      return globalScene.reset(true);
    }
  });
}

function toAvailableSet(): Set<string> {
  return bitsetToErShinyLabAvailableSet(globalScene.gameData.erShinyLabAvailableEffects);
}

export function grantErShinyLabEffectAvailability(effectId: string): boolean {
  const available = toAvailableSet();
  const before = available.size;
  available.add(effectId);
  if (available.size === before) {
    return false;
  }
  globalScene.gameData.erShinyLabAvailableEffects = erShinyLabAvailableSetToBitset(available);
  saveSystem();
  return true;
}

function pricedEffectsForCategory(args: {
  speciesId: number;
  category: ErShinyLabCategory;
  owned: Record<ErShinyLabCategory, Set<string>>;
  available: Set<string>;
}): ErShinyLabEffect[] {
  const { speciesId, category, owned, available } = args;
  const discounts = getErShinyLabDiscountedEffects(speciesId, category);
  const ownedCount = owned[category].size;
  return ER_SHINY_LAB_EFFECTS_BY_CATEGORY[category].map(def => ({
    id: def.id,
    label: def.label,
    category,
    rarity: def.rarity,
    minTier: def.minTier,
    accent: def.accent,
    ...(def.lockHint ? { lockHint: def.lockHint } : {}),
    cost: getErShinyLabEffectCost({
      definition: def,
      ownedCount,
      globallyAvailable: available.has(def.id),
      speciesDiscounted: discounts.has(def.id),
    }),
  }));
}

function applyPricedEffects(config: ErShinyLabConfig): void {
  for (const category of ER_SHINY_LAB_CATEGORIES) {
    config.effects[category] = pricedEffectsForCategory({
      speciesId: config.speciesId,
      category,
      owned: config.owned,
      available: config.available,
    });
  }
}

function persistConfig(
  entry: StarterDataEntry,
  config: ErShinyLabConfig,
  loadout: ErShinyLabLoadout,
  params: ErShinyLabParams,
): void {
  const save = ensureShinyLabSave(entry);
  const owned = config.owned;
  save.l = encodeErShinyLabLoadout(sanitizeErShinyLabLoadout(loadout, owned));
  save.q = encodeErShinyLabParams(params);
  save.r = config.presets.map(p => (p ? encodeErShinyLabPreset(p) : null)).slice(0, 5);
  saveSystem();
}

export function buildErShinyLabConfig(speciesId: number): ErShinyLabConfig {
  const gameData = globalScene.gameData;
  const species = getPokemonSpecies(speciesId);
  const rootId = gameData.getRootStarterSpeciesId(speciesId);
  const entry = gameData.getStarterDataEntry(speciesId);
  const save = ensureShinyLabSave(entry);
  const dexEntry = gameData.dexData[rootId] ?? gameData.dexData[speciesId];
  const earnedTier = getErShinyLabEarnedTier(dexEntry?.caughtAttr ?? 0n, !!entry.erBlackShiny);
  const available = toAvailableSet();
  const owned: Record<ErShinyLabCategory, Set<string>> = {
    palette: getErShinyLabOwnedSet(save, "palette"),
    surface: getErShinyLabOwnedSet(save, "surface"),
    around: getErShinyLabOwnedSet(save, "around"),
  };

  const equipped = sanitizeErShinyLabLoadout(decodeErShinyLabLoadout(save.l), owned);
  const params = decodeErShinyLabParams(save.q);
  const config: ErShinyLabConfig = {
    speciesId,
    speciesName: species.name,
    earnedTier,
    candy: entry.candyCount,
    effects: { palette: [], surface: [], around: [] },
    owned,
    available,
    equipped,
    params,
    presets: normalizeErShinyLabPresets(save.r),
  };

  applyPricedEffects(config);

  config.onBuy = (category, effect) => {
    const def = ER_SHINY_LAB_EFFECTS_BY_CATEGORY[category].find(e => e.id === effect.id);
    if (!def) {
      return;
    }
    entry.candyCount = Math.max(0, config.candy);
    setErShinyLabOwnedBit(save, category, def.index);
    applyPricedEffects(config);
    persistConfig(entry, config, config.equipped, config.params);
  };
  config.onChange = (loadout, nextParams) => {
    config.equipped = sanitizeErShinyLabLoadout(loadout, config.owned);
    config.params = { ...nextParams };
    persistConfig(entry, config, config.equipped, config.params);
  };

  return config;
}
