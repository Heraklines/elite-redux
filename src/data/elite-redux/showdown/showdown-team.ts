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

/**
 * Sentinel item value marking a mega mon's locked item slot.
 * MUST never collide with a real `modifierTypes` key (a `ShowdownItemKey`), or a
 * real item would be misread as the mega lock. The pool test asserts this holds.
 */
export const MEGA_STONE_ITEM = "MEGA_STONE";

// B7 item 10 (maintainer-decided): a team may field 1 to 6 mons (was exactly 6), so a player
// can start a versus match with a partial team. Every OTHER rule (duplicate species, one-mega,
// cost brackets, per-mon legality) is unchanged.
const MIN_TEAM_SIZE = 1;
const MAX_TEAM_SIZE = 6;
const REQUIRED_LEVEL = 100;
const IV_COUNT = 6;
const IV_MIN = 0;
const IV_MAX = 31;
const MIN_MOVES = 1;
const MAX_MOVES = 4;
/**
 * Field-legality cost brackets (Task B6, maintainer-decided). `baseCost` is the
 * LINE's BASE `speciesStarterCosts` value (candy reductions are deliberately NOT
 * applied — the manifest populates it from the raw table so a reduced candy cost
 * can't dodge the bracket).
 *  - baseCost >= COST_CAP: banned entirely.
 *  - baseCost in [HIGH_COST_MIN, COST_CAP): "high-cost"; at most one per team.
 *  - all others (baseCost < HIGH_COST_MIN): unrestricted.
 */
export const COST_CAP = 10;
export const HIGH_COST_MIN = 8;
export const MAX_HIGH_COST = 1;

/**
 * Player-facing field-legality messages (Task B6). SINGLE SOURCE for both the pick-time UI
 * gate (`showdownAddRejection`) and the validator; the validator may APPEND slot detail. The
 * two cost strings derive from the threshold constants so a threshold change updates the text
 * too. Accented "Pokémon" everywhere.
 */
export const SHOWDOWN_BLACK_SHINY_MESSAGE = "Black Shinies can't enter Showdown.";
export const SHOWDOWN_COST_CAP_MESSAGE = `Cost-${COST_CAP} Pokémon can't enter Showdown.`;
export const SHOWDOWN_HIGH_COST_MESSAGE = `Only one Pokémon of cost ${HIGH_COST_MIN} or higher is allowed.`;

/**
 * PURE field-legality verdict for ONE candidate mon (Task B6) — the single source of truth
 * shared by the pick-time UI gate and (via the same thresholds/strings) the validator. Returns
 * the exact player-facing message, or null when the mon may be fielded. Order matches the
 * validator's precedence: black shiny, then the hard cost cap, then the one-per-team high-cost
 * bracket. `baseCost` MUST be the LINE's raw `speciesStarterCosts` value (candy-reduction-agnostic).
 * `partyAlreadyHasHighCost` = the rest of the team already fields a cost-8/9 mon.
 */
export function showdownFieldLegalityReason(
  baseCost: number,
  erBlackShiny: boolean,
  partyAlreadyHasHighCost: boolean,
): string | null {
  if (erBlackShiny) {
    return SHOWDOWN_BLACK_SHINY_MESSAGE;
  }
  if (baseCost >= COST_CAP) {
    return SHOWDOWN_COST_CAP_MESSAGE;
  }
  if (baseCost >= HIGH_COST_MIN && partyAlreadyHasHighCost) {
    return SHOWDOWN_HIGH_COST_MESSAGE;
  }
  return null;
}

export interface ShowdownMonManifest {
  speciesId: number;
  formIndex: number;
  level: number;
  shiny: boolean;
  variant: number;
  abilityIndex: number;
  /**
   * Showdown fairness (2026-07-10): the FREE nature. OPTIONAL — like `erShinyLab`, a new optional
   * field must be OMITTED when absent (never carried as `undefined`), so the transport-canonical
   * team hash stays byte-stable across the JSON round-trip both clients hash. `starterToManifest`
   * always populates it (from the rolled nature; the Set Editor overwrites it with the player's
   * pick), so it is present in every production manifest; the build/validate sites tolerate absence
   * (a legacy/older-client manifest) by falling back to a deterministic default and skipping the
   * nature collection check.
   */
  nature?: number | undefined;
  ivs: number[];
  moveset: number[];
  item: string;
  rootSpeciesId: number;
  /** Task B6: this mon was picked as a Black Shiny — barred from being fielded. */
  erBlackShiny: boolean;
  /**
   * Task B6: the LINE's BASE `speciesStarterCosts` value (candy-reduction-agnostic;
   * the manifest reads the raw table so a reduction can't dodge the cost bracket).
   */
  baseCost: number;
  /**
   * Task C7: the owner's per-mon Shiny Lab look (the encoded `ErShinyLabSavedLook` tuple) when the
   * mon is shiny AND a custom look is equipped; absent otherwise. Structurally a `number[]` so the
   * pure rule engine imports no shiny-lab type; the opponent's client re-normalizes it (byte-clamped)
   * before applying. Mirrors the ghost snapshot's `GhostMember.erShinyLab`.
   */
  erShinyLab?: number[] | undefined;
}

export interface UnlockSnapshot {
  isRootUnlocked(rootSpeciesId: number): boolean;
  isShinyUnlocked(rootSpeciesId: number, variant: number): boolean;
  isAbilityUnlocked(rootSpeciesId: number, abilityIndex: number): boolean;
  isNatureUnlocked(rootSpeciesId: number, nature: number): boolean;
  isMoveLegal(rootSpeciesId: number, speciesId: number, moveId: number): boolean;
  /** True iff `speciesId` genuinely belongs to the claimed `rootSpeciesId` starter line. */
  isSpeciesInLine(rootSpeciesId: number, speciesId: number): boolean;
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
  | "moves"
  | "blackShiny"
  | "costCap"
  | "highCostLimit"
  | "malformed";

export interface ShowdownRuleViolation {
  rule: ShowdownRuleId;
  /** 0-based team slot where applicable. */
  slot?: number;
  /** Human-readable, used for the rejection toast. */
  message: string;
}

const ITEM_POOL = new Set<string>(SHOWDOWN_ITEM_POOL as readonly ShowdownItemKey[]);

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/**
 * Structural precheck for ONE mon of untrusted (deserialized) JSON. Because
 * `validateShowdownTeam` runs on the OPPONENT's manifest, a hostile/corrupt slot
 * (e.g. `ivs: null`, `moveset: "abc"`, non-string `item`) must be REJECTED, never
 * throw. Returns null when the slot is structurally sound; otherwise a reason.
 * NB `formIndex` validity beyond "is an integer" stays delegated to `isMegaForm`
 * and later engine-side construction — this layer only guards shape/types.
 */
function malformedReason(mon: unknown): string | null {
  if (typeof mon !== "object" || mon === null) {
    return "not an object";
  }
  const m = mon as Record<string, unknown>;
  if (!isInt(m.speciesId)) {
    return "speciesId must be an integer";
  }
  if (!isInt(m.rootSpeciesId)) {
    return "rootSpeciesId must be an integer";
  }
  if (!isInt(m.formIndex)) {
    return "formIndex must be an integer";
  }
  if (typeof m.level !== "number") {
    return "level must be a number";
  }
  if (typeof m.shiny !== "boolean") {
    return "shiny must be a boolean";
  }
  if (!isInt(m.variant)) {
    return "variant must be an integer";
  }
  if (!isInt(m.abilityIndex)) {
    return "abilityIndex must be an integer";
  }
  // nature is OPTIONAL (showdown fairness = free nature; a manifest may omit it and fall back to a
  // deterministic default at build). When present it must still be an integer; absent is valid.
  if (m.nature !== undefined && !isInt(m.nature)) {
    return "nature must be an integer";
  }
  if (typeof m.item !== "string") {
    return "item must be a string";
  }
  if (!Array.isArray(m.ivs) || m.ivs.some(iv => typeof iv !== "number")) {
    return "ivs must be an array of numbers";
  }
  if (!Array.isArray(m.moveset) || m.moveset.some(mv => typeof mv !== "number")) {
    return "moveset must be an array of numbers";
  }
  if (typeof m.erBlackShiny !== "boolean") {
    return "erBlackShiny must be a boolean";
  }
  if (!isInt(m.baseCost)) {
    return "baseCost must be an integer";
  }
  // erShinyLab is OPTIONAL (cosmetic); when present it must be an array of numbers. The apply
  // side re-normalizes (byte-clamps) it, so we only guard the shape here, never the values.
  if (m.erShinyLab !== undefined && (!Array.isArray(m.erShinyLab) || m.erShinyLab.some(n => typeof n !== "number"))) {
    return "erShinyLab must be an array of numbers when present";
  }
  return null;
}

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
  // Anti-spoof: the concrete speciesId must actually belong to the claimed line,
  // else a hostile client pairs an unlocked weak root with an arbitrary strong mon.
  if (!unlocks.isSpeciesInLine(mon.rootSpeciesId, mon.speciesId)) {
    out.push({
      rule: "collection",
      slot,
      message: `Species ${mon.speciesId} is not in claimed starter line ${mon.rootSpeciesId} (slot ${slot}).`,
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
  // Nature is collection-gated only when the manifest carries one — a free-pick manifest may omit it.
  if (mon.nature !== undefined && !unlocks.isNatureUnlocked(mon.rootSpeciesId, mon.nature)) {
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
 * blackShiny (Task B6): a mon picked as a Black Shiny can never be FIELDED. This is a
 * field-legality rule ONLY — black shinies remain fully stakeable in the ante system.
 */
function checkBlackShiny(mon: ShowdownMonManifest, slot: number, out: ShowdownRuleViolation[]): void {
  if (mon.erBlackShiny) {
    out.push({
      rule: "blackShiny",
      slot,
      message: `${SHOWDOWN_BLACK_SHINY_MESSAGE} (slot ${slot})`,
    });
  }
}

/**
 * costCap (Task B6): a mon whose LINE base cost is COST_CAP (10) or higher is banned
 * outright. Uses the raw `speciesStarterCosts` base value, NOT the candy-reduced value.
 */
function checkCostCap(mon: ShowdownMonManifest, slot: number, out: ShowdownRuleViolation[]): void {
  if (mon.baseCost >= COST_CAP) {
    out.push({
      rule: "costCap",
      slot,
      message: `${SHOWDOWN_COST_CAP_MESSAGE} (slot ${slot} is cost ${mon.baseCost})`,
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
  fieldWidth = 1,
): ShowdownRuleViolation[] {
  // Structural guard: the team may be untrusted deserialized JSON. A non-array
  // input is unrecoverable — reject outright rather than throwing on `.length`.
  if (!Array.isArray(team)) {
    return [{ rule: "malformed", message: "Team must be an array of Pokemon." }];
  }

  const violations: ShowdownRuleViolation[] = [];

  // teamSize: 1 to 6 mons (B7 item 10).
  if (team.length < MIN_TEAM_SIZE || team.length > MAX_TEAM_SIZE) {
    violations.push({
      rule: "teamSize",
      message: `Team must have ${MIN_TEAM_SIZE}-${MAX_TEAM_SIZE} Pokemon (has ${team.length}).`,
    });
  }

  // formatSize (tournament doubles/triples): a match fields `fieldWidth` mons per side at once, so the
  // team must carry AT LEAST that many fieldable mons (black shinies are already barred from a team by
  // checkBlackShiny, so team.length is the fieldable count). A doubles team needs >= 2, triples >= 3;
  // singles (width 1) is a no-op. Without this a short team boots a doubles field with an empty slot.
  if (fieldWidth > 1 && team.length < fieldWidth) {
    violations.push({
      rule: "teamSize",
      message: `A ${fieldWidth}-wide match needs at least ${fieldWidth} Pokemon (has ${team.length}).`,
    });
  }

  const seenSpecies = new Set<number>();
  let megaCount = 0;
  // Task B6: mons whose BASE cost is 8 or 9 (the [HIGH_COST_MIN, COST_CAP) bracket);
  // a team may field at most MAX_HIGH_COST of them. Cost >= COST_CAP is banned outright
  // by checkCostCap and does NOT count here.
  let highCostCount = 0;

  for (let slot = 0; slot < team.length; slot++) {
    const mon = team[slot];

    // Per-mon structural guard: a malformed slot is rejected and its other
    // per-mon checks are SKIPPED (they'd throw), but team-wide checks still run.
    const malformed = malformedReason(mon);
    if (malformed !== null) {
      violations.push({
        rule: "malformed",
        slot,
        message: `Malformed Pokemon (slot ${slot}): ${malformed}.`,
      });
      continue;
    }

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
    if (mon.baseCost >= HIGH_COST_MIN && mon.baseCost < COST_CAP) {
      highCostCount++;
    }

    checkLevel(mon, slot, violations);
    checkItem(mon, slot, isMega, violations);
    checkCollection(mon, slot, unlocks, violations);
    checkIvs(mon, slot, violations);
    checkMoves(mon, slot, unlocks, violations);
    checkBlackShiny(mon, slot, violations);
    checkCostCap(mon, slot, violations);
  }

  // megaLimit: at most one mega/primal per team.
  if (megaCount > 1) {
    violations.push({
      rule: "megaLimit",
      message: `A team may include at most one Mega/Primal Pokemon (has ${megaCount}).`,
    });
  }

  // highCostLimit: at most one mon of base cost 8 or 9 per team (team-wide).
  if (highCostCount > MAX_HIGH_COST) {
    violations.push({
      rule: "highCostLimit",
      message: `${SHOWDOWN_HIGH_COST_MESSAGE} (has ${highCostCount})`,
    });
  }

  return violations;
}
