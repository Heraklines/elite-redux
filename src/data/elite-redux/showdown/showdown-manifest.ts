/**
 * Showdown manifest handoff: turn the starter-select {@linkcode Starter}s into the wire
 * {@linkcode ShowdownMonManifest}s, and snapshot the local collection into the six
 * {@linkcode UnlockSnapshot} predicates `validateShowdownTeam` checks against.
 *
 * The predicates read real save state (`dexData` caught/nature bits, `starterData`
 * ability/egg-move bits) but resolve line membership + move legality against the static
 * balance tables - so this module is unit-testable with a small stubbed `gameData` shape
 * and no engine boot. Move legality MIRRORS EXACTLY what starter-select lets a player
 * assemble: the species' early level-up moves (levels 1-5) plus its unlocked egg moves.
 * The fork exposes no TMs in starter select, so none are legal here.
 */
import { speciesEggMoves } from "#balance/moves/egg-moves";
import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { speciesStarterCosts } from "#balance/starters";
import { erMegaTargetToBaseSpeciesId } from "#data/elite-redux/er-generic-pool-bans";
import { SHOWDOWN_ITEM_POOL } from "#data/elite-redux/showdown/showdown-item-pool";
import type { ShowdownMonManifest, UnlockSnapshot } from "#data/elite-redux/showdown/showdown-team";
import { DexAttr } from "#enums/dex-attr";
import type { Starter } from "#types/save-data";

/** Every showdown mon is fielded at level 100 (the 6v6 format is fixed-level). */
const SHOWDOWN_LEVEL = 100;
/** Item fielded when the player never picked one - the first curated pool entry. */
const DEFAULT_ITEM = SHOWDOWN_ITEM_POOL[0];
/** Egg-move bitmask width (four egg-move slots per starter). */
const EGG_MOVE_SLOTS = 4;
/** Starter select auto-selects + lets the player assemble level-up moves up to this level. */
const MAX_STARTER_MOVE_LEVEL = 5;

/**
 * The slice of `GameData` the snapshot reads. The real `globalScene.gameData` satisfies this
 * structurally; tests pass a hand-built stub with just these fields.
 */
export interface ShowdownUnlockGameData {
  dexData: Record<number, { caughtAttr: bigint; natureAttr: number }>;
  starterData: Record<number, { abilityAttr: number; eggMoves: number }>;
}

/**
 * Map a built {@linkcode Starter} to its wire manifest. The grid pick is the root
 * (`rootSpeciesId`); the fielded species/form come from the showdown stage fields, falling
 * back to the base when the player never opened the stage picker. Level is always 100 and
 * the item defaults to the first pool entry when unset. `_gameData` is accepted for a
 * stable call signature with {@linkcode buildUnlockSnapshot}; the mapping needs no lookups.
 */
export function starterToManifest(starter: Starter, _gameData: ShowdownUnlockGameData): ShowdownMonManifest {
  return {
    speciesId: starter.showdownSpeciesId ?? starter.speciesId,
    formIndex: starter.showdownFormIndex ?? starter.formIndex,
    level: SHOWDOWN_LEVEL,
    shiny: starter.shiny,
    variant: starter.variant,
    abilityIndex: starter.abilityIndex,
    nature: starter.nature,
    ivs: [...starter.ivs],
    moveset: [...(starter.moveset ?? [])],
    item: starter.showdownItem ?? DEFAULT_ITEM,
    rootSpeciesId: starter.speciesId,
    // Task B6: whether this mon was picked as a Black Shiny (field-illegal; stakes unaffected).
    erBlackShiny: starter.erBlackShiny ?? false,
    // Task B6: the LINE's BASE starter cost from the raw table (grid pick == root == starter.speciesId).
    // Deliberately NOT `getSpeciesStarterValue` (which applies candy reductions) so a reduced cost
    // can't dodge the cost bracket. `?? 4` mirrors getSpeciesStarterValue's ER-custom fallback.
    baseCost: speciesStarterCosts[starter.speciesId] ?? 4,
    // Task C7: the owner's per-mon Shiny Lab look, mirroring the ghost capture's serializeShinyLabLook
    // semantics: only on a SHINY mon, and only the carried look (stamped at build via the equipped
    // look). A non-shiny (or lookless) mon carries no look, so the field is dropped entirely.
    erShinyLab: starter.shiny && starter.erShinyLab ? [...starter.erShinyLab] : undefined,
  };
}

/**
 * Build the six-predicate {@linkcode UnlockSnapshot} from the local collection. Bit math
 * mirrors the accessors in `GameData` (`getNaturesForAttr`, `getStarterSpeciesDefaultAbilityIndex`,
 * the caught/variant DexAttr bits) so the gate accepts exactly what the player owns.
 */
export function buildUnlockSnapshot(gameData: ShowdownUnlockGameData): UnlockSnapshot {
  // Memoize the per-root legal-move set: `isMoveLegal` is called once per move on the
  // team, so without this the level-move + egg-move tables are rescanned for every move.
  const moveCache = new Map<number, Set<number>>();
  const collectStarterMoves = (rootSpeciesId: number): Set<number> => {
    const cached = moveCache.get(rootSpeciesId);
    if (cached) {
      return cached;
    }
    const pool = new Set<number>();
    for (const [level, moveId] of pokemonSpeciesLevelMoves[rootSpeciesId] ?? []) {
      if (level > 0 && level <= MAX_STARTER_MOVE_LEVEL) {
        pool.add(moveId);
      }
    }
    const eggMoves = speciesEggMoves[rootSpeciesId];
    if (eggMoves) {
      const eggBits = gameData.starterData[rootSpeciesId]?.eggMoves ?? 0;
      for (let slot = 0; slot < EGG_MOVE_SLOTS; slot++) {
        if (eggBits & (1 << slot)) {
          pool.add(eggMoves[slot]);
        }
      }
    }
    moveCache.set(rootSpeciesId, pool);
    return pool;
  };

  return {
    isRootUnlocked(rootSpeciesId) {
      return (gameData.dexData[rootSpeciesId]?.caughtAttr ?? 0n) !== 0n;
    },
    isShinyUnlocked(rootSpeciesId, variant) {
      const caughtAttr = gameData.dexData[rootSpeciesId]?.caughtAttr ?? 0n;
      if ((caughtAttr & DexAttr.SHINY) === 0n) {
        return false;
      }
      const variantBit = DexAttr.DEFAULT_VARIANT << BigInt(variant);
      return (caughtAttr & variantBit) !== 0n;
    },
    isAbilityUnlocked(rootSpeciesId, abilityIndex) {
      // AbilityAttr: ABILITY_1=1<<0, ABILITY_2=1<<1, ABILITY_HIDDEN=1<<2.
      const abilityAttr = gameData.starterData[rootSpeciesId]?.abilityAttr ?? 0;
      return (abilityAttr & (1 << abilityIndex)) !== 0;
    },
    isNatureUnlocked(rootSpeciesId, nature) {
      // natureAttr stores nature n in bit (n + 1), matching getNaturesForAttr.
      const natureAttr = gameData.dexData[rootSpeciesId]?.natureAttr ?? 0;
      return (natureAttr & (1 << (nature + 1))) !== 0;
    },
    isMoveLegal(rootSpeciesId, _speciesId, moveId) {
      return collectStarterMoves(rootSpeciesId).has(moveId);
    },
    isSpeciesInLine(rootSpeciesId, speciesId) {
      // An ER custom mega-form species resolves to its base before walking the line.
      let cur = erMegaTargetToBaseSpeciesId(speciesId) ?? speciesId;
      if (cur === rootSpeciesId) {
        return true;
      }
      const seen = new Set<number>();
      while (pokemonPrevolutions[cur] !== undefined && !seen.has(cur)) {
        seen.add(cur);
        cur = pokemonPrevolutions[cur];
        if (cur === rootSpeciesId) {
          return true;
        }
      }
      return false;
    },
  };
}
