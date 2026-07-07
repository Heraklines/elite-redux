/**
 * Showdown move-legality: the SINGLE source of truth for which moves a fielded
 * showdown mon may carry, shared by BOTH the teambuilder's move-swap picker (the UI
 * source) AND `buildUnlockSnapshot.isMoveLegal` (the validator predicate) so the two
 * can never drift - a move the picker offers is exactly a move the validator accepts.
 *
 * Widened for B7 item 3 (maintainer: "all attacks learnable via level-up, TMs, tutor
 * must be pickable"). The legal set for a fielded STAGE is:
 *   - every LEVEL-UP move (any level) of the fielded species AND its pre-evolutions
 *     (mainline games let an evolved mon carry its pre-evo learnsets), plus its
 *     FORM level-up moves (mega/regional forms), and the ER-mega base's learnset;
 *   - every TM / tutor move of those species (`speciesTmMoves` already merges ER's
 *     universal tutor pool into the TM map at init) - free, no unlock;
 *   - PLUS the UNLOCKED egg moves, which stay unlock-gated (the maintainer listed
 *     level/TM/tutor as free; egg moves remain earned).
 *
 * PURE over the static balance tables (no engine / Phaser imports), so it is
 * unit-testable with no boot. Egg-move UNLOCK state is passed in by the caller (the
 * validator reads it from the local save; the UI from the starter-data entry) - this
 * module never touches `gameData`.
 */
import { speciesEggMoves } from "#balance/moves/egg-moves";
import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { pokemonFormLevelMoves, pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { speciesTmMoves } from "#balance/tms";
import { erMegaTargetToBaseSpeciesId } from "#data/elite-redux/er-generic-pool-bans";
import type { MoveId } from "#enums/move-id";

/** Egg-move bitmask width (four egg-move slots per starter line). */
const EGG_MOVE_SLOTS = 4;

/**
 * Add the FREE (non-egg) learnset of ONE concrete species to `out`: every level-up
 * move (any level > 0), every form level-up move (all forms, permissively), and every
 * TM / tutor move. Form-specific TM entries `[formKey, moveId]` contribute their move.
 */
function addSpeciesFreeMoves(speciesId: number, out: Set<MoveId>): void {
  const levelMoves = pokemonSpeciesLevelMoves[speciesId];
  if (levelMoves) {
    for (const [level, moveId] of levelMoves) {
      if (level > 0) {
        out.add(moveId);
      }
    }
  }
  const formMoves = pokemonFormLevelMoves[speciesId];
  if (formMoves) {
    for (const form of Object.values(formMoves)) {
      for (const [level, moveId] of form) {
        if (level > 0) {
          out.add(moveId);
        }
      }
    }
  }
  const tmMoves = speciesTmMoves[speciesId];
  if (tmMoves) {
    for (const entry of tmMoves) {
      out.add(Array.isArray(entry) ? entry[1] : entry);
    }
  }
}

/**
 * The FREE legal move set for a fielded stage: the fielded species' full learnset
 * (level-up any level + TM/tutor), inherited down through its pre-evolutions to the
 * root, plus the ER-mega base's learnset (an ER custom mega resolves to its base).
 * Egg moves are NOT included here (they are unlock-gated - see
 * {@linkcode collectShowdownLegalMoves}).
 */
export function collectShowdownFreeMoves(rootSpeciesId: number, fieldedSpeciesId: number): Set<MoveId> {
  const out = new Set<MoveId>();
  const visited = new Set<number>();
  // Walk a line from `start` down through pre-evolutions, stopping at the claimed root
  // (or when the chain ends / loops). Each species contributes its full free learnset.
  const walk = (start: number): void => {
    let cur: number | undefined = start;
    while (cur !== undefined && !visited.has(cur)) {
      visited.add(cur);
      addSpeciesFreeMoves(cur, out);
      if (cur === rootSpeciesId) {
        break;
      }
      cur = pokemonPrevolutions[cur];
    }
  };
  walk(fieldedSpeciesId);
  // An ER-custom mega species carries its learnset under the base it targets; fold it in.
  const megaBase = erMegaTargetToBaseSpeciesId(fieldedSpeciesId);
  if (megaBase !== undefined) {
    walk(megaBase);
  }
  return out;
}

/**
 * The unlocked egg moves for a line: `speciesEggMoves[rootSpeciesId]` masked by the
 * per-line unlock bits (`starterData[root].eggMoves`). Empty when the line has no egg
 * moves. The caller supplies the bits so this module stays save-state-free.
 */
export function collectUnlockedEggMoves(rootSpeciesId: number, eggMoveBits: number): MoveId[] {
  const eggMoves = speciesEggMoves[rootSpeciesId];
  if (!eggMoves) {
    return [];
  }
  const out: MoveId[] = [];
  for (let slot = 0; slot < EGG_MOVE_SLOTS; slot++) {
    if (eggMoveBits & (1 << slot)) {
      out.push(eggMoves[slot]);
    }
  }
  return out;
}

/**
 * The FULL legal move set for a fielded showdown stage: the free learnset (level-up /
 * TM / tutor, with pre-evo inheritance) UNION the caller-supplied unlocked egg moves.
 * This is exactly what the validator accepts and what the picker offers.
 */
export function collectShowdownLegalMoves(
  rootSpeciesId: number,
  fieldedSpeciesId: number,
  unlockedEggMoves: Iterable<MoveId> = [],
): Set<MoveId> {
  const out = collectShowdownFreeMoves(rootSpeciesId, fieldedSpeciesId);
  for (const moveId of unlockedEggMoves) {
    out.add(moveId);
  }
  return out;
}
