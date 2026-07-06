/**
 * Showdown team manifest + the PURE rule engine.
 *
 * `validateShowdownTeam` is engine-free: both clients run it on their OWN team
 * at ready-up and on the OPPONENT's incoming manifest. It has no Phaser / engine
 * imports so it stays unit-testable; collection legality is checked against an
 * injected `UnlockSnapshot`, and mega-form detection against an injected predicate.
 *
 * Format: 6v6 singles, all level 100, one held item per mon from
 * `SHOWDOWN_ITEM_POOL`. At most one mega/primal per team; a mega mon's item slot
 * is force-locked to the `MEGA_STONE_ITEM` sentinel (the fork's megas are
 * permanent-by-form, so the stone is a slot-cost, not a runtime modifier).
 */
import { SHOWDOWN_ITEM_POOL, type ShowdownItemKey } from "#app/data/elite-redux/showdown/showdown-item-pool";

/** Sentinel item value marking a mega mon's locked item slot. */
export const MEGA_STONE_ITEM = "MEGA_STONE";

const TEAM_SIZE = 6;
const REQUIRED_LEVEL = 100;
const IV_COUNT = 6;
const IV_MIN = 0;
const IV_MAX = 31;
const MIN_MOVES = 1;
const MAX_MOVES = 4;

export interface ShowdownMonManifest {
  speciesId: number;
  formIndex: number;
  level: number;
  shiny: boolean;
  variant: number;
  abilityIndex: number;
  nature: number;
  ivs: number[];
  moveset: number[];
  item: string;
  rootSpeciesId: number;
}

export interface UnlockSnapshot {
  isRootUnlocked(rootSpeciesId: number): boolean;
  isShinyUnlocked(rootSpeciesId: number, variant: number): boolean;
  isAbilityUnlocked(rootSpeciesId: number, abilityIndex: number): boolean;
  isNatureUnlocked(rootSpeciesId: number, nature: number): boolean;
  isMoveLegal(rootSpeciesId: number, speciesId: number, moveId: number): boolean;
}

export type ShowdownRuleId =
  | "teamSize"
  | "level"
  | "item"
  | "megaLimit"
  | "megaItem"
  | "collection"
  | "duplicate"
  | "ivs"
  | "moves";

export interface ShowdownRuleViolation {
  rule: ShowdownRuleId;
  /** 0-based team slot where applicable. */
  slot?: number;
  /** Human-readable, used for the rejection toast. */
  message: string;
}

const ITEM_POOL = new Set<string>(SHOWDOWN_ITEM_POOL as readonly ShowdownItemKey[]);

/** level: exactly 100. */
function checkLevel(mon: ShowdownMonManifest, slot: number, out: ShowdownRuleViolation[]): void {
  if (mon.level !== REQUIRED_LEVEL) {
    out.push({
      rule: "level",
      slot,
      message: `Every Pokemon must be level ${REQUIRED_LEVEL} (slot ${slot} is ${mon.level}).`,
    });
  }
}

/** item + megaItem: pool/sentinel membership and the mega ⇄ sentinel lock. */
function checkItem(mon: ShowdownMonManifest, slot: number, isMega: boolean, out: ShowdownRuleViolation[]): void {
  // item: in pool OR the mega-stone sentinel. Empty/unknown → violation.
  if (mon.item !== MEGA_STONE_ITEM && !ITEM_POOL.has(mon.item)) {
    out.push({
      rule: "item",
      slot,
      message: `Item "${mon.item}" is not allowed in Showdown (slot ${slot}).`,
    });
  }

  // megaItem: mega ⇒ must carry sentinel; non-mega ⇒ must NOT carry sentinel.
  if (isMega && mon.item !== MEGA_STONE_ITEM) {
    out.push({
      rule: "megaItem",
      slot,
      message: `Mega Pokemon must occupy its item slot with the Mega Stone (slot ${slot}).`,
    });
  } else if (!isMega && mon.item === MEGA_STONE_ITEM) {
    out.push({
      rule: "megaItem",
      slot,
      message: `Non-mega Pokemon cannot carry the Mega Stone (slot ${slot}).`,
    });
  }
}

/** collection: root unlocked; shiny variant unlocked; ability + nature unlocked. */
function checkCollection(
  mon: ShowdownMonManifest,
  slot: number,
  unlocks: UnlockSnapshot,
  out: ShowdownRuleViolation[],
): void {
  if (!unlocks.isRootUnlocked(mon.rootSpeciesId)) {
    out.push({
      rule: "collection",
      slot,
      message: `Species line ${mon.rootSpeciesId} is not unlocked (slot ${slot}).`,
    });
  }
  if (mon.shiny && !unlocks.isShinyUnlocked(mon.rootSpeciesId, mon.variant)) {
    out.push({
      rule: "collection",
      slot,
      message: `Shiny variant ${mon.variant} is not unlocked (slot ${slot}).`,
    });
  }
  if (!unlocks.isAbilityUnlocked(mon.rootSpeciesId, mon.abilityIndex)) {
    out.push({
      rule: "collection",
      slot,
      message: `Ability ${mon.abilityIndex} is not unlocked (slot ${slot}).`,
    });
  }
  if (!unlocks.isNatureUnlocked(mon.rootSpeciesId, mon.nature)) {
    out.push({
      rule: "collection",
      slot,
      message: `Nature ${mon.nature} is not unlocked (slot ${slot}).`,
    });
  }
}

/** ivs: exactly 6 integer values in [0, 31]. */
function checkIvs(mon: ShowdownMonManifest, slot: number, out: ShowdownRuleViolation[]): void {
  if (mon.ivs.length !== IV_COUNT || mon.ivs.some(iv => !Number.isInteger(iv) || iv < IV_MIN || iv > IV_MAX)) {
    out.push({
      rule: "ivs",
      slot,
      message: `IVs must be ${IV_COUNT} integers in ${IV_MIN}-${IV_MAX} (slot ${slot}).`,
    });
  }
}

/** moves: 1-4 moves, no duplicates, every move legal. */
function checkMoves(
  mon: ShowdownMonManifest,
  slot: number,
  unlocks: UnlockSnapshot,
  out: ShowdownRuleViolation[],
): void {
  if (mon.moveset.length < MIN_MOVES || mon.moveset.length > MAX_MOVES) {
    out.push({
      rule: "moves",
      slot,
      message: `Moveset must have ${MIN_MOVES}-${MAX_MOVES} moves (slot ${slot} has ${mon.moveset.length}).`,
    });
  } else if (new Set(mon.moveset).size !== mon.moveset.length) {
    out.push({
      rule: "moves",
      slot,
      message: `Duplicate move in moveset (slot ${slot}).`,
    });
  } else if (mon.moveset.some(moveId => !unlocks.isMoveLegal(mon.rootSpeciesId, mon.speciesId, moveId))) {
    out.push({
      rule: "moves",
      slot,
      message: `Illegal move for this Pokemon (slot ${slot}).`,
    });
  }
}

/**
 * Validate a showdown team against the format rules and the player's collection.
 * Returns EVERY violation (never stops at the first). Per-mon violations carry a
 * 0-based `slot`.
 */
export function validateShowdownTeam(
  team: ShowdownMonManifest[],
  unlocks: UnlockSnapshot,
  isMegaForm: (speciesId: number, formIndex: number) => boolean,
): ShowdownRuleViolation[] {
  const violations: ShowdownRuleViolation[] = [];

  // teamSize: exactly 6 mons.
  if (team.length !== TEAM_SIZE) {
    violations.push({
      rule: "teamSize",
      message: `Team must have exactly ${TEAM_SIZE} Pokemon (has ${team.length}).`,
    });
  }

  const seenSpecies = new Set<number>();
  let megaCount = 0;

  for (let slot = 0; slot < team.length; slot++) {
    const mon = team[slot];

    // duplicate: no two mons share speciesId.
    if (seenSpecies.has(mon.speciesId)) {
      violations.push({
        rule: "duplicate",
        slot,
        message: `Duplicate species: ${mon.speciesId} appears more than once (Species Clause).`,
      });
    }
    seenSpecies.add(mon.speciesId);

    const isMega = isMegaForm(mon.speciesId, mon.formIndex);
    if (isMega) {
      megaCount++;
    }

    checkLevel(mon, slot, violations);
    checkItem(mon, slot, isMega, violations);
    checkCollection(mon, slot, unlocks, violations);
    checkIvs(mon, slot, violations);
    checkMoves(mon, slot, unlocks, violations);
  }

  // megaLimit: at most one mega/primal per team.
  if (megaCount > 1) {
    violations.push({
      rule: "megaLimit",
      message: `A team may include at most one Mega/Primal Pokemon (has ${megaCount}).`,
    });
  }

  return violations;
}
