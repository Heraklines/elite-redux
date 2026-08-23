import { globalScene } from "#app/global-scene";
import { getCoopController } from "#data/elite-redux/coop/coop-runtime";
import { erBalanceArr, erBalanceNum } from "#data/elite-redux/er-balance-tuning";
import { isErEndlessContinuationActive } from "#data/elite-redux/er-endless-continuation";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { getErRunPacingProfile } from "#data/elite-redux/er-run-pacing";

export interface ErTrainingCacheSaveData {
  version: 1;
  segmentStartEquivalentWave: number;
  presenceByPokemonId: Record<string, number>;
  claimedMilestones: number[];
}

export interface ErTrainingCacheAward {
  pokemonName: string;
  candy: number;
}

const MILESTONES = [50, 100, 150, 200] as const;

function freshState(equivalentWave = 0): ErTrainingCacheSaveData {
  return {
    version: 1,
    segmentStartEquivalentWave: Math.floor(Math.max(0, equivalentWave) / 50) * 50,
    presenceByPokemonId: {},
    claimedMilestones: [],
  };
}

let state = freshState();

export function resetErTrainingCacheState(): void {
  state = freshState();
}

export function getErTrainingCacheSaveData(): ErTrainingCacheSaveData {
  return structuredClone(state);
}

export function restoreErTrainingCacheState(saved?: ErTrainingCacheSaveData, runWave = 0): void {
  const equivalentWave = runWave * getErRunPacingProfile().progressionScale;
  if (saved?.version !== 1) {
    state = freshState(equivalentWave);
    return;
  }
  state = {
    version: 1,
    segmentStartEquivalentWave: Math.max(0, Math.floor(saved.segmentStartEquivalentWave)),
    presenceByPokemonId: Object.fromEntries(
      Object.entries(saved.presenceByPokemonId ?? {})
        .filter(([id, value]) => id.length > 0 && Number.isSafeInteger(value) && value >= 0)
        .map(([id, value]) => [id, Math.floor(value)]),
    ),
    claimedMilestones: [...new Set(saved.claimedMilestones ?? [])]
      .filter(value => MILESTONES.includes(value as (typeof MILESTONES)[number]))
      .sort((a, b) => a - b),
  };
}

function locallyOwnedParty() {
  const party = globalScene.getPlayerParty().slice(0, 6);
  if (!globalScene.gameMode.isCoop) {
    return party;
  }
  const role = getCoopController()?.role;
  return role == null ? [] : party.filter(pokemon => pokemon.coopOwner === role);
}

/** Record one completed winning wave and settle a due Hell Training Cache once. */
export function recordErTrainingCacheWave(runWave: number): ErTrainingCacheAward[] {
  if (getErDifficulty() !== "hell" || isErEndlessContinuationActive()) {
    return [];
  }

  const progressionScale = getErRunPacingProfile().progressionScale;
  const equivalentWave = Math.max(0, Math.floor(runWave)) * progressionScale;
  const party = locallyOwnedParty();
  for (const pokemon of party) {
    const id = String(pokemon.id);
    state.presenceByPokemonId[id] = (state.presenceByPokemonId[id] ?? 0) + progressionScale;
  }

  const milestoneIndex = MILESTONES.indexOf(equivalentWave as (typeof MILESTONES)[number]);
  if (milestoneIndex < 0 || state.claimedMilestones.includes(equivalentWave)) {
    return [];
  }

  // Claim before presentation so a reload cannot replay account rewards.
  state.claimedMilestones.push(equivalentWave);
  state.claimedMilestones.sort((a, b) => a - b);
  const requiredPresence = erBalanceNum("er.rewards.hellTrainingPresenceRequired");
  const candy = erBalanceArr("er.rewards.hellTrainingCache")[milestoneIndex] ?? 0;
  const awards: ErTrainingCacheAward[] = [];
  for (const pokemon of party) {
    if ((state.presenceByPokemonId[String(pokemon.id)] ?? 0) < requiredPresence || candy <= 0) {
      continue;
    }
    if (globalScene.gameData.addStarterCandy(pokemon.species.speciesId, candy, true, false)) {
      awards.push({ pokemonName: pokemon.getNameToRender(), candy });
    }
  }

  state = {
    version: 1,
    segmentStartEquivalentWave: equivalentWave,
    presenceByPokemonId: {},
    claimedMilestones: state.claimedMilestones,
  };
  return awards;
}
