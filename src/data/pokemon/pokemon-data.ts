import type { BattlerTag } from "#data/battler-tags";
import { loadBattlerTag, SerializableBattlerTag } from "#data/battler-tags";
import {
  type ErShinyLabSavedLook,
  normalizeErShinyLabSavedLook,
  sanitizeErShinyLabPresetName,
} from "#data/elite-redux/er-shiny-lab-effects";
import type { Gender } from "#data/gender";
import { PokemonMove } from "#data/moves/pokemon-move";
import type { PokemonSpeciesForm } from "#data/pokemon-species";
import type { TypeDamageMultiplier } from "#data/type";
import type { AbilityId } from "#enums/ability-id";
import type { BerryType } from "#enums/berry-type";
import type { MoveId } from "#enums/move-id";
import type { Nature } from "#enums/nature";
import type { PokemonType } from "#enums/pokemon-type";
import type { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type { AttackMoveResult } from "#types/attack-move-result";
import type { IllusionData } from "#types/illusion-data";
import type { SerializedSpeciesForm } from "#types/pokemon-common";
import type { TurnMove } from "#types/turn-move";
import type { CoerceNullPropertiesToUndefined } from "#types/type-helpers";
import { getPokemonSpecies, getPokemonSpeciesForm } from "#utils/pokemon-utils";

/**
 * Permanent data that can customize a Pokemon in non-standard ways from its Species.
 * Includes abilities, nature, changed types, etc.
 */
export class CustomPokemonData {
  // TODO: Change the default value for all these from -1 to something a bit more sensible
  /**
   * The scale at which to render this Pokemon's sprite.
   */
  public spriteScale = -1;
  public ability: AbilityId | -1;
  public passive: AbilityId | -1;
  /**
   * Persistent overrides for the ER 2nd/3rd innate (passive) slots. `passive`
   * above overrides innate slot 0; these override slots 1 and 2. Each is an
   * {@linkcode AbilityId} or `-1` for "no override (use species-derived)".
   * Currently set by the ER "Ability Randomizer" consumable.
   */
  public passive2: AbilityId | -1;
  public passive3: AbilityId | -1;
  public nature: Nature | -1;
  /**
   * Extra move slots granted by ER's "5th move slot" consumable. Added on top
   * of the base cap of 4 (see {@linkcode Pokemon.getMaxMoveCount}). Defaults to
   * `0`; the consumable raises it to `1`.
   */
  public bonusMoveSlots = 0;
  /**
   * When `true`, the per-Pokémon ability/passive overrides above apply even
   * while the Pokémon is in a form that normally derives its abilities from the
   * form's species data (mega / G-max — see
   * {@linkcode Pokemon.usesFormDerivedAbilities}). Set by the ER Ability
   * Randomizer when it is used on a Pokémon that is currently in such a form, so
   * the reroll actually takes effect on (and is visible for) that form instead
   * of being silently shadowed by the form's native ability. Defaults to
   * `false` (legacy behaviour: overrides only show in the base form).
   */
  public abilityOverridesForm = false;
  // TODO: Change default value from `PokemonType.UNKNOWN` to `null` for easier checking;
  public types: PokemonType[];
  /** Deprecated but needed for session save migration */
  // TODO: Remove this once pre-session migration is implemented
  public hitsRecCount: number | null = null;
  /**
   * ER Black Shiny (#349). When `true` this mon is the t4 ultra-rare tier:
   * its normal ability + innates are untouched, but it carries the GIFT — a
   * 5th ability slot. `erGiftAbilities` holds the 3 switchable pool choices,
   * `erGiftIndex` the active one (shared with on-field allies). The Ability
   * Randomizer can never touch the gift.
   */
  public erBlackShiny = false;
  public erGiftAbilities: number[] = [];
  public erGiftIndex = 0;
  /**
   * ER Shiny Lab: an optional carried cosmetic look for cross-player ghosts.
   * Permanent starter unlocks still live in starterData; this compact tuple is
   * copied onto rebuilt ghost Pokemon so viewers see the owner's equipped look.
   */
  public erShinyLab?: ErShinyLabSavedLook | undefined;
  /**
   * ER Shiny Lab: the player-chosen PRESET NAME equipped with the carried look. When set, it
   * prefixes the Pokemon's displayed name everywhere (e.g. "Glittering Rayquaza"). Travels the
   * same channels as {@linkcode erShinyLab} (save round-trip + ghost/co-op serialization), so a
   * cross-player ghost shows the original owner's label. Empty/undefined => no prefix.
   */
  public erShinyLabName?: string | undefined;
  /**
   * When true, do not fall back to this client's starterData Shiny Lab look.
   * Ghost Pokemon use this so malformed or absent owner payloads become plain.
   */
  public erShinyLabSuppressLocal = false;
  /**
   * ER Innate Shrine (#514): when `true`, this Pokemon's ER innate slots are all
   * unlocked for the rest of the run (no candy purchase needed), as if it had
   * attuned at the Temple shrine. Run-scoped (serialized with the session), not a
   * permanent account unlock. Checked in {@linkcode Pokemon.canApplyAbility}.
   */
  public erInnateShrineUnlocked = false;
  /**
   * ER Bog Witch curse (#508): a permanent "anti-vitamin" curse. Holds the
   * {@linkcode Stat} index (0=HP..5=SPD) of the base stat permanently lowered by
   * 10%, or `-1` for "uncursed". Applied in {@linkcode Pokemon.calculateBaseStats}
   * and lifted at the Cleansing Font (#515). Run-scoped (serialized).
   */
  public erCursedStat = -1;
  /**
   * ER Giratina's Bargain - Curiosity (#544 8th deal): the ability slots this mon
   * has LOCKED (disabled) for the rest of the run as the cost of the Curiosity
   * gamble. Each entry is an ER ability-slot index matching
   * {@linkcode Pokemon.getAbilitySlots} (0 = active ability, 1-3 = innate slots).
   * A locked slot's ability never fires in battle (gated in
   * {@linkcode Pokemon.canApplyAbility}) and reads "Locked" on the ability panels.
   * Run-scoped (serialized with the session), NEVER an account unlock - the
   * candy-unlocked ability stays unlocked in starter-select and future runs.
   */
  public erLockedAbilitySlots: number[] = [];
  /**
   * ER Ability Capsule run-unlock (maintainer request): the innate ability slots a
   * player has FORCE-UNLOCKED for the rest of the run via the capsule's "unlock an
   * innate for the run" option. The INVERSE of {@linkcode erLockedAbilitySlots}: each
   * entry is an ER ability-slot index matching {@linkcode Pokemon.getAbilitySlots}
   * (only innate slots 1-3 are ever stored here; slot 0 is the active ability and is
   * never run-unlocked). A run-unlocked innate fires in battle even without the candy
   * `passiveAttr` unlock (OR-ed into the candy gate in {@linkcode Pokemon.canApplyAbility}),
   * but a {@linkcode erLockedAbilitySlots | Curiosity-locked} slot still wins and stays
   * dead. Run-scoped (serialized with the session), NEVER an account unlock - the
   * permanent candy unlock (`starterData[...].passiveAttr`) is untouched, so the innate
   * still reads LOCKED in starter-select and future runs.
   */
  public erRunUnlockedAbilitySlots: number[] = [];
  /**
   * Co-op (#633 Fix #3): the OWNER's per-account innate-unlock snapshot for this mon, one
   * `passiveAttr` bitmask per ER innate slot (0,1,2). On a merged co-op party every client
   * would otherwise gate a SHARED mon's active innates by ITS OWN candy unlocks (a divergent
   * per-account state), so this captures the owning player's unlocks at merge time and the
   * battle-time gate reads from here instead of local `starterData`. `undefined` => not a
   * co-op-snapshotted mon (every solo / non-merged mon), so all other modes are untouched.
   */
  public coopPassiveAttr?: number[] | undefined;
  /**
   * Co-op (#633 Fix #3): the OWNER's canonical luck for this mon, captured at merge time.
   * `Pokemon.getLuck()` reads it in co-op so a shared party's total luck (which drives the
   * reward-pool upgrade odds + other rolls) is identical on both clients, instead of each
   * deriving the partner mon's luck from ITS OWN dex unlocks. `undefined` => not snapshotted.
   */
  public coopLuck?: number | undefined;

  constructor(data?: CustomPokemonData | Partial<CustomPokemonData>) {
    this.spriteScale = data?.spriteScale ?? -1;
    this.ability = data?.ability ?? -1;
    this.passive = data?.passive ?? -1;
    this.passive2 = data?.passive2 ?? -1;
    this.passive3 = data?.passive3 ?? -1;
    this.nature = data?.nature ?? -1;
    this.bonusMoveSlots = data?.bonusMoveSlots ?? 0;
    this.abilityOverridesForm = data?.abilityOverridesForm ?? false;
    this.types = data?.types ?? [];
    this.hitsRecCount = data?.hitsRecCount ?? null;
    this.erBlackShiny = data?.erBlackShiny ?? false;
    this.erGiftAbilities = data?.erGiftAbilities ?? [];
    this.erGiftIndex = data?.erGiftIndex ?? 0;
    this.erShinyLab = normalizeErShinyLabSavedLook(data?.erShinyLab);
    this.erShinyLabName = sanitizeErShinyLabPresetName(data?.erShinyLabName) || undefined;
    this.erShinyLabSuppressLocal = data?.erShinyLabSuppressLocal ?? false;
    this.erInnateShrineUnlocked = data?.erInnateShrineUnlocked ?? false;
    this.erCursedStat = data?.erCursedStat ?? -1;
    this.erLockedAbilitySlots = data?.erLockedAbilitySlots ?? [];
    this.erRunUnlockedAbilitySlots = data?.erRunUnlockedAbilitySlots ?? [];
    this.coopPassiveAttr = data?.coopPassiveAttr ?? undefined;
    this.coopLuck = data?.coopLuck ?? undefined;
  }
}

/**
 * Deserialize a pokemon species form from an object containing `id` and `formIdx` properties.
 * @param value - The value to deserialize
 * @returns The `PokemonSpeciesForm` or `null` if the fields could not be properly discerned
 */
function deserializePokemonSpeciesForm(value: SerializedSpeciesForm | PokemonSpeciesForm): PokemonSpeciesForm | null {
  // @ts-expect-error: We may be deserializing a PokemonSpeciesForm, but we catch later on
  let { id, formIdx } = value;

  if (id == null || formIdx == null) {
    // @ts-expect-error: Typescript doesn't know that in block, `value` must be a PokemonSpeciesForm
    id = value.speciesId;
    // @ts-expect-error: Same as above (plus we are accessing a protected property)
    formIdx = value._formIndex;
  }
  // If for some reason either of these fields are null/undefined, we cannot reconstruct the species form
  if (id == null || formIdx == null) {
    return null;
  }
  return getPokemonSpeciesForm(id, formIdx);
}

interface SerializedIllusionData extends Omit<IllusionData, "fusionSpecies"> {
  /** The id of the illusioned fusion species, or `undefined` if not a fusion */
  fusionSpecies?: SpeciesId | undefined;
}

interface SerializedPokemonSummonData {
  statStages: number[];
  moveQueue: TurnMove[];
  tags: BattlerTag[];
  abilitySuppressed: boolean;
  abilitiesApplied: AbilityId[];
  speciesForm?: SerializedSpeciesForm | undefined;
  fusionSpeciesForm?: SerializedSpeciesForm | undefined;
  ability?: AbilityId | undefined;
  passiveAbility?: AbilityId | undefined;
  /**
   * ER 3-passive transform override. When set (non-null), `getPassiveAbilities()`
   * uses this triple in place of the species-derived passives. Each slot is an
   * `AbilityId` or `undefined` for "no override on this slot" (the species
   * derivation still applies for that slot). Set by {@linkcode Pokemon.setTempPassives}
   * (called from `PokemonTransformPhase` so a transformed Pokemon takes the
   * target's full passive set, not just its active ability).
   */
  passiveAbilities?: (AbilityId | undefined)[] | undefined;
  gender?: Gender | undefined;
  fusionGender?: Gender | undefined;
  stats: number[];
  moveset?: PokemonMove[] | undefined;
  types: PokemonType[];
  addedType?: PokemonType | undefined;
  illusion?: SerializedIllusionData | undefined;
  berriesEatenLast: BerryType[];
  moveHistory: TurnMove[];
}

/**
 * Persistent in-battle data for a {@linkcode Pokemon}.
 * Resets on switch or new battle.
 *
 * @sealed
 */
// TODO: Change these `null`s into `undefined`s to save on storage space (or use custom serialization to skip them entirely)
export class PokemonSummonData {
  /** [Atk, Def, SpAtk, SpDef, Spd, Acc, Eva] */
  public statStages: number[] = [0, 0, 0, 0, 0, 0, 0];
  /**
   * A queue of moves yet to be executed, used by charging, recharging and frenzy moves.
   * @remarks
   * So long as this array is non-empty, this Pokemon's corresponding `CommandPhase`
   * will be skipped over entirely in favor of using the queued move.
   */
  // TODO: Clean up a lot of the code surrounding the move queue.
  public moveQueue: TurnMove[] = [];
  public tags: BattlerTag[] = [];
  public abilitySuppressed = false;
  public abilitiesApplied: Set<AbilityId> = new Set();
  /**
   * Whether this Pokémon's ER {@linkcode AbilityId.CHUCKSTER} (864) has already
   * spent its once-per-ENTRY charge (the contact-hit 50% damage reduction). As
   * part of `summonData` it resets each send-out, matching "once per entry".
   */
  public chuckusterReductionUsed = false;

  /**
   * Whether this Pokémon's ER attacker-out signature (Restraining Order 690 /
   * Chuckster 864) has already forced an attacker out this ENTRY. As part of
   * `summonData` it resets each send-out, matching the dex's "once each
   * switch-in".
   */
  public forceAttackerOutUsed = false;

  /**
   * Whether this Pokemon has already been made {@linkcode BattlerTagType.ER_COMMANDED}
   * (by ER Puppet Strings) since its current send-out. As part of `summonData` it
   * resets each switch-in, enforcing the dex's "once per switch-in" rule — a target
   * cured/expired of Commanded cannot be re-Commanded until it switches out and back in.
   */
  public erCommandedUsedThisSwitchIn = false;

  // Overrides for transform and company.
  // TODO: Move these into a separate class & add rage fist hit count
  public speciesForm: PokemonSpeciesForm | null = null;
  public fusionSpeciesForm: PokemonSpeciesForm | null = null;
  public ability: AbilityId | undefined;
  public passiveAbility: AbilityId | undefined;
  /**
   * ER 3-passive transform override. When non-null, replaces the species-derived
   * passive triple slot-by-slot in {@linkcode Pokemon.getPassiveAbilities}. Entries
   * are `AbilityId`s; an `undefined` slot means "no override for this slot".
   * Populated by {@linkcode Pokemon.setTempPassives} (used by transform).
   */
  public passiveAbilities: (AbilityId | undefined)[] | undefined;
  public gender: Gender | undefined;
  public fusionGender: Gender | undefined;
  public stats: number[] = [0, 0, 0, 0, 0, 0];
  public moveset: PokemonMove[] | null;

  /**
   * An array containing any temporary {@link https://bulbapedia.bulbagarden.net/wiki/Type_change | typing overrides}
   * the user has been inflicted with, barring any added types from Forest's Curse or Trick-or-Treat.
   */
  // TODO: Review all instances where this is used to ensure that they interact with type-change moves correctly
  public types: PokemonType[] = [];
  /** The "third" type added from Trick-or-Treat or Forest's Curse, if present. */
  public addedType: PokemonType | null = null;

  /** Data pertaining to this pokemon's Illusion, if it has one. */
  public illusion: IllusionData | null = null;
  /** Array containing all berries eaten in the last turn; used by {@linkcode AbilityId.CUD_CHEW} */
  public berriesEatenLast: BerryType[] = [];

  /**
   * An array of all moves this pokemon has used since entering the battle.
   * Used for most moves and abilities that check prior move usage or copy already-used moves.
   */
  // TODO: Rework this into a sort of "global move history" that also allows checking execution order (for Fusion Bolt/Flare)
  public moveHistory: TurnMove[] = [];

  constructor(source?: PokemonSummonData | SerializedPokemonSummonData) {
    if (source == null) {
      return;
    }

    // TODO: Rework this into an actual generic function for use elsewhere
    for (const [key, value] of Object.entries(source)) {
      if (value == null && Object.hasOwn(this, key)) {
        continue;
      }

      if (key === "speciesForm" || key === "fusionSpeciesForm") {
        this[key] = deserializePokemonSpeciesForm(value);
        continue;
      }

      if (key === "illusion" && typeof value === "object") {
        // Make a copy so as not to mutate provided value
        const illusionData = {
          ...value,
        };
        if (illusionData.fusionSpecies != null) {
          switch (typeof illusionData.fusionSpecies) {
            case "object":
              illusionData.fusionSpecies = getPokemonSpecies(illusionData.fusionSpecies.speciesId);
              break;
            case "number":
              illusionData.fusionSpecies = getPokemonSpecies(illusionData.fusionSpecies);
              break;
            default:
              illusionData.fusionSpecies = undefined;
          }
        }
        this[key] = illusionData as IllusionData;
        continue;
      }

      if (key === "moveset") {
        this.moveset = value?.map((m: any) => PokemonMove.loadMove(m));
        continue;
      }

      if (key === "tags" && Array.isArray(value)) {
        // load battler tags, discarding any that are not serializable
        this.tags = value
          .map((t: SerializableBattlerTag) => loadBattlerTag(t))
          .filter((t): t is SerializableBattlerTag => t instanceof SerializableBattlerTag);
        continue;
      }

      if (key === "abilitiesApplied") {
        for (const a of value) {
          this.abilitiesApplied.add(a);
        }
        continue;
      }

      this[key] = value;
    }
  }

  /**
   * Serialize this PokemonSummonData to JSON, converting {@linkcode PokemonSpeciesForm} and {@linkcode IllusionData.fusionSpecies}
   * into simpler types instead of serializing all of their fields.
   *
   * @remarks
   * - `IllusionData.fusionSpecies` is serialized as just the species ID
   * - `PokemonSpeciesForm` and `PokemonSpeciesForm.fusionSpeciesForm` are converted into {@linkcode SerializedSpeciesForm} objects
   */
  public toJSON(): SerializedPokemonSummonData {
    // Pokemon species forms are never saved, only the species ID.
    const illusion = this.illusion;
    const speciesForm = this.speciesForm;
    const fusionSpeciesForm = this.fusionSpeciesForm;
    const illusionSpeciesForm = illusion?.fusionSpecies;
    const t = {
      // the "as omit" is required to avoid TS resolving the overwritten properties to "never"
      // We coerce null to undefined in the type, as the for loop below replaces `null` with `undefined`
      ...(this as Omit<
        CoerceNullPropertiesToUndefined<PokemonSummonData>,
        "speciesForm" | "fusionSpeciesForm" | "illusion"
      >),
      speciesForm: speciesForm == null ? undefined : { id: speciesForm.speciesId, formIdx: speciesForm.formIndex },
      fusionSpeciesForm:
        fusionSpeciesForm == null
          ? undefined
          : { id: fusionSpeciesForm.speciesId, formIdx: fusionSpeciesForm.formIndex },
      illusion:
        illusion == null
          ? undefined
          : {
              ...(this.illusion as Omit<typeof illusion, "fusionSpecies">),
              fusionSpecies: illusionSpeciesForm?.speciesId,
            },
      abilitiesApplied: [...this.abilitiesApplied.values()],
    };
    // Replace `null` with `undefined`, as `undefined` never gets serialized
    for (const [key, value] of Object.entries(t)) {
      if (value === null) {
        t[key] = undefined;
      }
    }
    return t;
  }
}

// TODO: Merge this inside `summmonData` but exclude from save if/when a save data serializer is added
export class PokemonTempSummonData {
  /**
   * The number of turns this pokemon has spent without switching out.
   * Only currently used for positioning the battle cursor.
   */
  turnCount = 1;
  /**
   * The number of turns this pokemon has spent in the active position since the start of the wave
   * without switching out.
   * Reset on switch and new wave, but not stored in `SummonData` to avoid being written to the save file.

   * Used to evaluate "first turn only" conditions such as
   * {@linkcode MoveId.FAKE_OUT | Fake Out} and {@linkcode MoveId.FIRST_IMPRESSION | First Impression}).
   */
  waveTurnCount = 1;
}

/**
 * Persistent data for a {@linkcode Pokemon}.
 * Resets at the start of a new battle (but not on switch).
 */
export class PokemonBattleData {
  /** Counter tracking direct hits this Pokemon has received during this battle; used for {@linkcode MoveId.RAGE_FIST} */
  public hitCount = 0;
  /** Whether this Pokemon has eaten a berry this battle; used for {@linkcode MoveId.BELCH} */
  public hasEatenBerry = false;
  /** Array containing all berries eaten and not yet recovered during this current battle; used by {@linkcode AbilityId.HARVEST} */
  public berriesEaten: BerryType[] = [];
  /**
   * Whether this Pokémon's ER {@linkcode AbilityId.ANTICIPATION} has already
   * spent its once-per-battle "dodge the first super-effective hit" charge.
   * Resets with the rest of the per-battle data; transient (not serialized).
   */
  public anticipationDodgeUsed = false;
  /**
   * Whether this Pokémon's ER {@linkcode AbilityId.RUDE_AWAKENING} has already
   * fired its once-per-battle on-wake trigger (+1 all stats, then permanent
   * sleep immunity for the rest of the battle). While `false` the holder is NOT
   * sleep-immune (so it can be put to sleep the first time); once it wakes this
   * flips `true`, granting the omniboost and gating the sleep immunity on.
   * Resets with the rest of the per-battle data; transient (not serialized).
   */
  public rudeAwakeningTriggered = false;
  /**
   * Whether this Pokémon's ER {@linkcode AbilityId.COWARD} has already set up its
   * once-per-battle Protect on switch-in. Lives on the per-battle data (cleared by
   * `resetBattleAndWaveData` each new battle) so Coward re-arms every battle/trainer,
   * instead of a flag on the persistent instance that would survive the whole run.
   * Transient (not serialized).
   */
  public cowardProtectUsed = false;
  /**
   * ER Fetch (er move 969) consumed-item ledger: NON-BERRY, re-grantable held
   * items this Pokémon lost in battle (knocked off, a consumed one-time item, a
   * shattered elemental Gem), most-recent last. Fetch retrieves the last entry
   * as a fresh held item, then self-switches. Berries have their own ledger
   * ({@linkcode berriesEaten}, shared with Harvest). Resets each battle; carries
   * `gemType` for Gems so the exact Gem can be rebuilt. Serialized so it
   * round-trips on a mid-battle save.
   */
  public lostItems: LostHeldItemRecord[] = [];

  constructor(source?: PokemonBattleData | Partial<PokemonBattleData>) {
    if (source != null) {
      this.hitCount = source.hitCount ?? 0;
      this.hasEatenBerry = source.hasEatenBerry ?? false;
      this.berriesEaten = source.berriesEaten ?? [];
      this.anticipationDodgeUsed = source.anticipationDodgeUsed ?? false;
      this.rudeAwakeningTriggered = source.rudeAwakeningTriggered ?? false;
      this.cowardProtectUsed = source.cowardProtectUsed ?? false;
      this.lostItems = source.lostItems ?? [];
    }
  }
}

/**
 * A single {@linkcode PokemonBattleData.lostItems} entry: the modifier-type id of
 * a lost held item, plus (for elemental Gems, which are generator-built) the
 * {@linkcode PokemonType} the Gem boosts, so Fetch can rebuild the exact item.
 */
export interface LostHeldItemRecord {
  readonly typeId: string;
  readonly gemType?: number;
}

/**
 * Temporary data for a {@linkcode Pokemon}.
 * Resets on new wave/battle start (but not on switch).
 */
export class PokemonWaveData {
  /** Whether the pokemon has endured due to a {@linkcode BattlerTagType.ENDURE_TOKEN} */
  public endured = false;
  /**
   * A set of all the abilities this {@linkcode Pokemon} has used in this wave.
   * Used to track once per battle conditions, as well as (hopefully) by the updated AI for move effectiveness.
   */
  public abilitiesApplied: Set<AbilityId> = new Set<AbilityId>();
  /** Whether the pokemon's ability has been revealed or not */
  // TODO: this doesn't account for passives
  public abilityRevealed = false;
  /**
   * Keys of "once per battle" on-entry effects that have already fired this
   * wave for this Pokémon. Used by ER's once-per-battle entry effects (e.g.
   * Royal Decree's "Glare on entry once per battle") to avoid re-firing when
   * the holder switches out and back in during the same encounter. Resets with
   * the rest of the wave data; transient (not serialized).
   */
  public entryEffectsFired: Set<string> = new Set<string>();
  /**
   * Whether a "consume on first defend" ability (ER Drakelp Head 932) has already
   * spent its one-shot this battle — it weakens only the FIRST damaging hit taken
   * and drops that attacker's Attack once, then is inert for the rest of the
   * encounter. Resets with the rest of the wave data (per-battle); transient (not
   * serialized).
   */
  public firstDefendConsumed = false;
}

/**
 * Temporary data for a {@linkcode Pokemon}.
 * Resets at the start of a new turn, as well as on switch.
 */
export class PokemonTurnData {
  // #region Move usage-related properties
  // All of these properties can likely go inside a "move-in-flight" object later

  /** How many times the current move should hit the target(s) */
  public hitCount = 0;
  /**
   * - `-1`: Calculate how many hits are left
   * - `0`: Move is finished
   * - `>0`: Move is in process of hitting targets
   * @defaultValue `-1`
   */
  public hitsLeft = -1;
  public totalDamageDealt = 0;
  public singleHitDamageDealt = 0;
  public damageTaken = 0;
  /**
   * An array containing data about attacks received this turn, in FIFO order.
   */
  public attacksReceived: AttackMoveResult[] = [];
  public statStagesIncreased = false;
  public statStagesDecreased = false;
  public moveEffectiveness: TypeDamageMultiplier | null = null;
  public combiningPledge?: MoveId;
  public failedRunAway = false;
  public joinedRound = false;

  // #endregion Move usage-related properties

  public acted = false;
  public order: number;
  /** The Pokemon was brought in this turn by a switch action (not an intial encounter/summon) */
  public switchedInThisTurn = false;
  public summonedThisTurn = false;

  // TODO: This effectively only exists for castform/cherrim and is really ugly;
  // revisit after form change rework
  /**
   * Tracker for what abilities have been applied due to form changes during this turn. \
   * Used to prevent infinite loops from form change abilities triggering their own transformation conditions.
   */
  public formChangeAbilitiesApplied = new Set<AbilityId>();

  /**
   * Tracker for a pending status effect.
   *
   * @remarks
   * Set whenever {@linkcode Pokemon#trySetStatus} succeeds in order to prevent subsequent status effects
   * from being applied. \
   * Necessary because the status is not actually set until the {@linkcode ObtainStatusEffectPhase} runs,
   * which may not happen before another status effect is attempted to be applied.
   * @defaultValue `StatusEffect.NONE`
   */
  public pendingStatus: StatusEffect = StatusEffect.NONE;
  /**
   * All berries eaten by this pokemon in this turn.
   * Saved into {@linkcode PokemonSummonData | SummonData} by {@linkcode AbilityId.CUD_CHEW} on turn end.
   * @see {@linkcode PokemonSummonData.berriesEatenLast}
   */
  public berriesEaten: BerryType[] = [];
}
