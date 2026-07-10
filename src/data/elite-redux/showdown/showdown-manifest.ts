/**
 * Showdown manifest handoff: turn the starter-select {@linkcode Starter}s into the wire
 * {@linkcode ShowdownMonManifest}s, and snapshot the local collection into the six
 * {@linkcode UnlockSnapshot} predicates `validateShowdownTeam` checks against.
 *
 * The predicates read real save state (`dexData` caught/nature bits, `starterData`
 * ability/egg-move bits) but resolve line membership + move legality against the static
 * balance tables - so this module is unit-testable with a small stubbed `gameData` shape
 * and no engine boot. Move legality (B7 item 3) is the FIELDED stage's FULL legal
 * learnset - every level-up move (any level, incl. pre-evolution inheritance), every
 * TM / tutor move - plus the line's UNLOCKED egg moves, computed by the shared
 * {@linkcode collectShowdownLegalMoves} helper the teambuilder's move picker also uses.
 */
import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { speciesStarterCosts } from "#balance/starters";
import { erMegaTargetToBaseSpeciesId } from "#data/elite-redux/er-generic-pool-bans";
import { SHOWDOWN_ITEM_POOL } from "#data/elite-redux/showdown/showdown-item-pool";
import { collectShowdownLegalMoves, collectUnlockedEggMoves } from "#data/elite-redux/showdown/showdown-legal-moves";
import type { ShowdownMonManifest, UnlockSnapshot } from "#data/elite-redux/showdown/showdown-team";
import { DexAttr } from "#enums/dex-attr";
import { Nature } from "#enums/nature";
import type { Variant } from "#sprites/variant";
import type { Starter, StarterMoveset } from "#types/save-data";

/** Every showdown mon is fielded at level 100 (the 6v6 format is fixed-level). */
const SHOWDOWN_LEVEL = 100;
/** Item fielded when the player never picked one - the first curated pool entry. */
const DEFAULT_ITEM = SHOWDOWN_ITEM_POOL[0];

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
    // look). A non-shiny (or lookless) mon carries no look, so the KEY IS OMITTED ENTIRELY -
    // an `erShinyLab: undefined` entry would be dropped by the real transport's JSON framing
    // but kept by Object.keys locally, poisoning the team hash (ready-gate void on every
    // real match; loopback tests can't see it because they pass objects by reference).
    ...(starter.shiny && starter.erShinyLab ? { erShinyLab: [...starter.erShinyLab] } : {}),
  };
}

/**
 * INVERSE of {@linkcode starterToManifest}: rebuild the engine {@linkcode Starter} a stored preset
 * manifest was serialized from. The Team Menu's "enter lobby with this preset" path (Phase D) skips
 * the interactive grid+editor teambuild, so it reconstructs `Starter`s from the saved manifests and
 * feeds them into the EXISTING negotiate/wager/battle pipeline unchanged.
 *
 * RULE (hash parity - the load-bearing property): `starterToManifest(manifestToStarter(m))` MUST be
 * BYTE-IDENTICAL to `m`, because both clients hash the wire manifest at the ready gate. So the fielded
 * species/form/item go into the `showdown*` fields (the manifest reads those first), the grid root is
 * `rootSpeciesId`, and the omit-when-absent optionals (`nature` is always present from the editor;
 * `erShinyLab` only on a shiny with a look) are reconstructed with the SAME presence discipline -
 * a spurious `erShinyLab`/`nature` here would poison the hash exactly like the erShinyLab:undefined void.
 * The `_gameData` param mirrors {@linkcode buildUnlockSnapshot}'s call signature; no lookups are needed
 * (baseCost is recomputed from the raw table by `starterToManifest`, so it round-trips for free).
 */
export function manifestToStarter(mon: ShowdownMonManifest): Starter {
  const starter: Starter = {
    // The grid pick is the LINE ROOT; the fielded stage goes in the showdown* fields below.
    speciesId: mon.rootSpeciesId,
    shiny: mon.shiny,
    variant: mon.variant as Variant,
    // Base grid form (0); the fielded form is carried by showdownFormIndex, which the manifest reads first.
    formIndex: 0,
    female: false,
    abilityIndex: mon.abilityIndex,
    passive: false,
    nature: (mon.nature ?? Nature.HARDY) as Nature,
    moveset: (mon.moveset.length > 0 ? [...mon.moveset] : undefined) as StarterMoveset | undefined,
    pokerus: false,
    ivs: [...mon.ivs],
    erBlackShiny: mon.erBlackShiny,
    showdownSpeciesId: mon.speciesId,
    showdownFormIndex: mon.formIndex,
    showdownItem: mon.item,
    // Match starterToManifest's presence discipline: the look rides ONLY on a shiny mon that carries one.
    // The manifest stores the look as a plain number[]; the Starter field is the fixed-length tuple alias.
    ...(mon.shiny && mon.erShinyLab ? { erShinyLab: [...mon.erShinyLab] as unknown as Starter["erShinyLab"] } : {}),
  };
  return starter;
}

/**
 * Build the six-predicate {@linkcode UnlockSnapshot} from the local collection. Bit math
 * mirrors the accessors in `GameData` (`getNaturesForAttr`, `getStarterSpeciesDefaultAbilityIndex`,
 * the caught/variant DexAttr bits) so the gate accepts exactly what the player owns.
 */
export function buildUnlockSnapshot(gameData: ShowdownUnlockGameData): UnlockSnapshot {
  // B7 item 7 (live blocker): ability + egg-move unlocks are POOLED under the evolution
  // line's absolute root in `starterData`, exactly as `GameData.getStarterDataEntry` does
  // (`getRootStarterSpeciesId` -> ER-mega base -> `getRootSpeciesId()` walk to the baby root),
  // so a line whose grid starter is NOT its own pooling root (a baby pre-evo like Pichu /
  // Cleffa, or an ER-mega base) keeps its ability unlocks under a DIFFERENT `starterData` key.
  // Reading `starterData[rootSpeciesId]` raw (the grid pick) then finds an empty entry and
  // false-rejects a legitimately-owned ability ("Ability N is not unlocked"). Normalize the
  // `starterData` key to the same pooling root the picker read from. Pure: mirrors the walk
  // over `pokemonPrevolutions` (+ the ER-mega base hop) with no engine lookup. (The AbilityAttr
  // BIT mapping `1 << abilityIndex` is already canonical - `PokemonSpecies` normalizes an empty
  // second ability slot to a duplicate of ability 1, so the hidden ability always sits at index
  // 2 with the ABILITY_HIDDEN bit, and the encoder in `setPokemonCaught` stores `1 << index`.)
  const starterRootCache = new Map<number, number>();
  const starterRoot = (rootSpeciesId: number): number => {
    const cached = starterRootCache.get(rootSpeciesId);
    if (cached !== undefined) {
      return cached;
    }
    let cur = erMegaTargetToBaseSpeciesId(rootSpeciesId) ?? rootSpeciesId;
    const seen = new Set<number>();
    while (pokemonPrevolutions[cur] !== undefined && !seen.has(cur)) {
      seen.add(cur);
      cur = pokemonPrevolutions[cur];
    }
    starterRootCache.set(rootSpeciesId, cur);
    return cur;
  };

  // Memoize the per-(root, fielded-species) legal-move set: `isMoveLegal` is called once
  // per move on the team, so without this the full learnset + egg tables are rescanned for
  // every move. Keyed by BOTH ids because legality now depends on the FIELDED stage's
  // learnset (level-up/TM/tutor) plus the ROOT's unlocked egg moves (B7 item 3).
  const moveCache = new Map<string, Set<number>>();
  const legalMovesFor = (rootSpeciesId: number, fieldedSpeciesId: number): Set<number> => {
    const key = `${rootSpeciesId}:${fieldedSpeciesId}`;
    const cached = moveCache.get(key);
    if (cached) {
      return cached;
    }
    const eggBits = gameData.starterData[rootSpeciesId]?.eggMoves ?? 0;
    const pool = collectShowdownLegalMoves(
      rootSpeciesId,
      fieldedSpeciesId,
      collectUnlockedEggMoves(rootSpeciesId, eggBits),
    );
    moveCache.set(key, pool);
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
      // AbilityAttr: ABILITY_1=1<<0, ABILITY_2=1<<1, ABILITY_HIDDEN=1<<2. Read the entry under
      // the POOLING root (see `starterRoot`), where the game stores the unlock, not the raw grid pick.
      const abilityAttr = gameData.starterData[starterRoot(rootSpeciesId)]?.abilityAttr ?? 0;
      return (abilityAttr & (1 << abilityIndex)) !== 0;
    },
    isNatureUnlocked(rootSpeciesId, nature) {
      // natureAttr stores nature n in bit (n + 1), matching getNaturesForAttr.
      const natureAttr = gameData.dexData[rootSpeciesId]?.natureAttr ?? 0;
      return (natureAttr & (1 << (nature + 1))) !== 0;
    },
    isMoveLegal(rootSpeciesId, speciesId, moveId) {
      return legalMovesFor(rootSpeciesId, speciesId).has(moveId);
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
