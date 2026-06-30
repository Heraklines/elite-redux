import { globalScene } from "#app/global-scene";
import {
  bitsetToErShinyLabAvailableSet,
  decodeErShinyLabLoadout,
  decodeErShinyLabParams,
  encodeErShinyLabLoadout,
  encodeErShinyLabParams,
  encodeErShinyLabPreset,
  ER_SHINY_LAB_CATEGORIES,
  ER_SHINY_LAB_EFFECT_ACHV,
  ER_SHINY_LAB_EFFECTS_BY_CATEGORY,
  ER_SHINY_LAB_NAME_FX_CANDY_COST,
  ER_SHINY_LAB_SEED_REROLL_CANDY_COST,
  erShinyLabAvailableSetToBitset,
  type ErShinyLabCategory,
  type ErShinyLabConfig,
  type ErShinyLabEffect,
  type ErShinyLabLoadout,
  type ErShinyLabParams,
  type ErShinyLabSaveData,
  claimErShinyLabCompletionRewards,
  getErShinyLabDiscountedEffects,
  getErShinyLabEarnedTier,
  getErShinyLabEffectCost,
  getErShinyLabCompletion,
  getErShinyLabOwnedSet,
  isErShinyLabNameFxUnlocked,
  normalizeErShinyLabPresets,
  sanitizeErShinyLabLoadout,
  sanitizeErShinyLabPresetName,
  setErShinyLabOwnedBit,
  spendErShinyLabSeedRerollToken,
  unlockErShinyLabNameFx,
} from "#data/elite-redux/er-shiny-lab-effects";
import type { StarterDataEntry } from "#types/save-data";
import { randSeedInt } from "#utils/common";
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

export function grantErShinyLabEffectAvailability(effectId: string, persist = true): boolean {
  const available = toAvailableSet();
  const before = available.size;
  available.add(effectId);
  if (available.size === before) {
    return false;
  }
  globalScene.gameData.erShinyLabAvailableEffects = erShinyLabAvailableSetToBitset(available);
  if (persist) {
    saveSystem();
  }
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

function sanitizeParams(params: ErShinyLabParams, earnedTier: number, nameFxUnlocked: boolean): ErShinyLabParams {
  return {
    ...params,
    protectBlack: !!params.protectBlack,
    protectWhite: !!params.protectWhite,
    nameFx: earnedTier >= 3 && nameFxUnlocked && !!params.nameFx,
  };
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
  save.q = encodeErShinyLabParams(sanitizeParams(params, config.earnedTier, !!config.nameFxUnlocked));
  save.r = config.presets
    .map(p =>
      p
        ? encodeErShinyLabPreset({
            ...p,
            params: sanitizeParams(p.params, config.earnedTier, !!config.nameFxUnlocked),
          })
        : null,
    )
    .slice(0, 5);
  const presetNames = config.presets.map(p => (p?.name ? sanitizeErShinyLabPresetName(p.name) || null : null)).slice(0, 5);
  if (presetNames.some(Boolean)) {
    save.rn = presetNames;
  } else {
    delete save.rn;
  }
  const equippedName = sanitizeErShinyLabPresetName(config.equippedName);
  if (equippedName) {
    save.ln = equippedName;
  } else {
    delete save.ln;
  }
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
  // Retroactive + additive: any effect whose gate achievement is already unlocked
  // becomes BUYABLE on lab-open. Computed live from achvUnlocks, so it needs no
  // migration and never touches the persisted granted bitset / wild-catch / candy
  // paths. (Cosmetic-only: this does NOT re-pay the one-time candy/egg/shiny grants
  // in er-achievement-rewards, which stay event-gated.)
  const achvUnlocks = gameData.achvUnlocks;
  for (const effectId in ER_SHINY_LAB_EFFECT_ACHV) {
    if (achvUnlocks[ER_SHINY_LAB_EFFECT_ACHV[effectId]] != null) {
      available.add(effectId);
    }
  }
  const owned: Record<ErShinyLabCategory, Set<string>> = {
    palette: getErShinyLabOwnedSet(save, "palette"),
    surface: getErShinyLabOwnedSet(save, "surface"),
    around: getErShinyLabOwnedSet(save, "around"),
  };

  const equipped = sanitizeErShinyLabLoadout(decodeErShinyLabLoadout(save.l), owned);
  const nameFxUnlocked = isErShinyLabNameFxUnlocked(save);
  const params = sanitizeParams(decodeErShinyLabParams(save.q), earnedTier, nameFxUnlocked);
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
    equippedName: sanitizeErShinyLabPresetName(save.ln),
    presets: normalizeErShinyLabPresets(save.r, save.rn),
    completion: getErShinyLabCompletion(save),
    nameFxUnlocked,
    nameFxCost: ER_SHINY_LAB_NAME_FX_CANDY_COST,
    seedRerollCost: ER_SHINY_LAB_SEED_REROLL_CANDY_COST,
    seedRerollTokens: save.t ?? 0,
  };

  applyPricedEffects(config);

  config.onBuy = (category, effect) => {
    const def = ER_SHINY_LAB_EFFECTS_BY_CATEGORY[category].find(e => e.id === effect.id);
    if (!def) {
      return;
    }
    entry.candyCount = Math.max(0, config.candy);
    setErShinyLabOwnedBit(save, category, def.index);
    claimErShinyLabCompletionRewards(save);
    config.seedRerollTokens = save.t ?? 0;
    config.completion = getErShinyLabCompletion(save);
    applyPricedEffects(config);
    persistConfig(entry, config, config.equipped, config.params);
  };
  config.onChange = (loadout, nextParams) => {
    config.equipped = sanitizeErShinyLabLoadout(loadout, config.owned);
    config.params = sanitizeParams(nextParams, config.earnedTier, !!config.nameFxUnlocked);
    persistConfig(entry, config, config.equipped, config.params);
  };
  config.onSetEquippedName = name => {
    config.equippedName = sanitizeErShinyLabPresetName(name);
    persistConfig(entry, config, config.equipped, config.params);
  };
  config.onBuyNameFx = () => {
    if (config.earnedTier < 3 || config.nameFxUnlocked || entry.candyCount < ER_SHINY_LAB_NAME_FX_CANDY_COST) {
      return false;
    }
    entry.candyCount = Math.max(0, entry.candyCount - ER_SHINY_LAB_NAME_FX_CANDY_COST);
    unlockErShinyLabNameFx(save);
    config.nameFxUnlocked = true;
    config.candy = entry.candyCount;
    config.params = sanitizeParams({ ...config.params, nameFx: true }, config.earnedTier, true);
    persistConfig(entry, config, config.equipped, config.params);
    return true;
  };
  config.onRerollSeed = currentParams => {
    if (!spendErShinyLabSeedRerollToken(save)) {
      if (entry.candyCount < ER_SHINY_LAB_SEED_REROLL_CANDY_COST) {
        return null;
      }
      entry.candyCount = Math.max(0, entry.candyCount - ER_SHINY_LAB_SEED_REROLL_CANDY_COST);
    }
    const nextParams = sanitizeParams(
      { ...currentParams, seed: randSeedInt(256) },
      config.earnedTier,
      !!config.nameFxUnlocked,
    );
    config.candy = entry.candyCount;
    config.seedRerollTokens = save.t ?? 0;
    config.params = nextParams;
    persistConfig(entry, config, config.equipped, nextParams);
    return nextParams;
  };

  return config;
}
