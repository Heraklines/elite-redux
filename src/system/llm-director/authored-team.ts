import type { AuthoredPokemon } from "#data/llm-director/beat-schema";
import type { PokemonSpecies } from "#data/pokemon-species";
import type { MoveId } from "#enums/move-id";
import type { EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import type { HeldModifierConfig } from "#types/held-modifier-config";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/**
 * Build helpers for LLM-authored trainer teams (v2 Phase A).
 *
 * - clampAuthoredTeam: enforces server-side balance rails (level cap, team
 *   size, moveset size) before the team reaches the battle engine.
 * - authoredTeamToEnemyConfigs: maps the LLM's `AuthoredPokemon` shape to
 *   the canonical `EnemyPokemonConfig` shape from mystery-encounter utils.
 *
 * Both are pure (no globalScene access) so they can be unit-tested.
 */

const MAX_TEAM_SIZE = 6;
const MAX_MOVES = 4;
const MAX_HELD_ITEMS = 6;
const DEFAULT_LEVEL_CAP = 3;
const BRUTAL_LEVEL_CAP = 5;
const BRUTAL_FAINT_THRESHOLD = 1;

export interface AuthoredTeamContext {
  /** Wave-curve baseline level for this trainer encounter. Used to clamp
   * authored levels back into the wave's tolerance window. */
  baseLevel: number;
  /** Faints across the last ~10 waves; gates the brutal-difficulty upgrade. */
  recentFaints: number;
  /** "brutal" expands the level cap to ±5 IF the player is fresh; otherwise
   * stays at the default ±3. Other values use the default cap. */
  difficultyTag?: "easy" | "normal" | "hard" | "brutal";
}

/**
 * Apply server-side balance rails to an LLM-authored team. Returns a copy:
 * - team trimmed to MAX_TEAM_SIZE entries
 * - per-Pokémon level clamped to baseLevel ± cap (cap is 5 for brutal-fresh,
 *   else 3); also enforced into [1, 200]
 * - per-Pokémon moveIds trimmed to MAX_MOVES
 * - per-Pokémon heldItemKeys trimmed to MAX_HELD_ITEMS
 *
 * The LLM may emit ids/keys we don't recognize (typos, hallucinations); we
 * leave validation of those to the apply step (so the rails layer stays
 * data-pure and unit-testable without globalScene).
 */
export function clampAuthoredTeam(team: AuthoredPokemon[], ctx: AuthoredTeamContext): AuthoredPokemon[] {
  const struggling = ctx.recentFaints >= BRUTAL_FAINT_THRESHOLD;
  const brutalAllowed = ctx.difficultyTag === "brutal" && !struggling;
  const cap = brutalAllowed ? BRUTAL_LEVEL_CAP : DEFAULT_LEVEL_CAP;

  const minLevel = Math.max(1, ctx.baseLevel - cap);
  const maxLevel = Math.min(200, ctx.baseLevel + cap);

  return team.slice(0, MAX_TEAM_SIZE).map(entry => {
    const out: AuthoredPokemon = { speciesId: entry.speciesId };
    if (typeof entry.level === "number") {
      out.level = Math.max(minLevel, Math.min(maxLevel, Math.round(entry.level)));
    }
    if (typeof entry.abilityId === "number" && entry.abilityId >= 0) {
      out.abilityId = entry.abilityId;
    }
    if (Array.isArray(entry.moveIds) && entry.moveIds.length > 0) {
      out.moveIds = entry.moveIds.slice(0, MAX_MOVES);
    }
    if (Array.isArray(entry.heldItemKeys) && entry.heldItemKeys.length > 0) {
      out.heldItemKeys = entry.heldItemKeys.slice(0, MAX_HELD_ITEMS);
    }
    if (entry.isBoss) {
      out.isBoss = true;
    }
    if (entry.shiny) {
      out.shiny = true;
    }
    if (typeof entry.nickname === "string" && entry.nickname.length > 0) {
      out.nickname = entry.nickname;
    }
    return out;
  });
}

/**
 * Resolve `abilityId` to a 0/1/2 slot index on the species. Returns the slot
 * matching the requested ability, or `undefined` if the species doesn't carry
 * that ability (the engine then keeps the default ability roll).
 */
function resolveAbilityIndex(species: PokemonSpecies, abilityId: number | undefined): number | undefined {
  if (typeof abilityId !== "number") {
    return;
  }
  if (species.ability1 === abilityId) {
    return 0;
  }
  if (species.ability2 === abilityId) {
    return 1;
  }
  if (species.abilityHidden === abilityId) {
    return 2;
  }
  return;
}

/**
 * Resolver for a held-item string key → `HeldModifierConfig`. Injectable so
 * unit tests can stub it without spinning up `globalScene`. Returns `null`
 * when the key isn't a known held-item modifier — caller drops the entry.
 */
export type HeldItemResolver = (key: string) => HeldModifierConfig | null;

export interface MapTeamFailure {
  reason: string;
}

export interface MapTeamSuccess {
  configs: EnemyPokemonConfig[];
}

export type MapTeamResult = MapTeamSuccess | MapTeamFailure;

export function isMapTeamFailure(r: MapTeamResult): r is MapTeamFailure {
  return (r as MapTeamFailure).reason !== undefined;
}

/**
 * Convert an LLM-authored team to canonical `EnemyPokemonConfig[]` ready for
 * the battle engine. Returns a structured failure when the team is
 * unmappable (e.g., bad species id, all entries dropped) so the caller can
 * fall back to vanilla generation and log a single line.
 *
 * Unknown ability ids and unknown move ids produce per-field drops (silent),
 * not whole-team failures: the LLM gets graceful degradation instead of a
 * "bad team kills the wave" footgun.
 *
 * `heldItemResolver` is the bridge between LLM-authored string keys and
 * PokéRogue's modifier system. The runtime path passes a resolver backed by
 * `generateModifierType`; tests pass a stub.
 */
export function authoredTeamToEnemyConfigs(
  team: AuthoredPokemon[],
  heldItemResolver?: HeldItemResolver,
): MapTeamResult {
  if (!Array.isArray(team) || team.length === 0) {
    return { reason: "empty-team" };
  }
  const configs: EnemyPokemonConfig[] = [];
  for (const entry of team) {
    if (!Number.isInteger(entry.speciesId) || entry.speciesId <= 0) {
      return { reason: `invalid-speciesId:${entry.speciesId}` };
    }
    const species = getPokemonSpecies(entry.speciesId);
    if (!species) {
      return { reason: `unknown-speciesId:${entry.speciesId}` };
    }
    const cfg: EnemyPokemonConfig = {
      species,
      isBoss: entry.isBoss === true,
    };
    if (typeof entry.level === "number") {
      cfg.level = entry.level;
    }
    const abilityIndex = resolveAbilityIndex(species, entry.abilityId);
    if (abilityIndex !== undefined) {
      cfg.abilityIndex = abilityIndex;
    }
    if (Array.isArray(entry.moveIds) && entry.moveIds.length > 0) {
      cfg.moveSet = entry.moveIds.slice(0, MAX_MOVES) as MoveId[];
    }
    if (Array.isArray(entry.heldItemKeys) && entry.heldItemKeys.length > 0 && heldItemResolver) {
      const heldConfigs: HeldModifierConfig[] = [];
      for (const key of entry.heldItemKeys.slice(0, MAX_HELD_ITEMS)) {
        const built = heldItemResolver(key);
        if (built) {
          heldConfigs.push(built);
        }
      }
      if (heldConfigs.length > 0) {
        cfg.modifierConfigs = heldConfigs;
      }
    }
    if (entry.shiny) {
      cfg.shiny = true;
    }
    if (entry.nickname) {
      cfg.nickname = entry.nickname;
    }
    configs.push(cfg);
  }
  if (configs.length === 0) {
    return { reason: "no-mappable-entries" };
  }
  return { configs };
}
