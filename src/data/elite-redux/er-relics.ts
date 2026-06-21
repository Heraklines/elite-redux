/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Relics (#439 biome overhaul) - PERMANENT, run-scoped, team-wide "buff"
// items that grant OUT-OF-COMBAT passive effects. Unlike held items they are
// not attached to a single Pokemon: they sit in the player's modifier list as
// relic icons (no pokemonId) and are queried by battle/egg hooks. This mirrors
// the er-community-items pattern, but team-wide.
//
// The modifier class `ErRelicModifier` lives in #modifiers/modifier and the
// ModifierType factory `erRelicModifierType` in #modifiers/modifier-type (both
// REQUIRED there so the vanilla save serializer can round-trip the relics).
//
// First relics:
//   - Field Medic     : every 3 turns, the benched player Pokemon in party
//                       slots 2 and 3 (the reserves) recover 1/12 of their max
//                       HP (a slow healing spring tending the back row).
//   - Warm Incubator  : all carried eggs hatch faster (an extra hatch-wave of
//                       progress each wave, applied to every egg).
//
// Icons: existing items-atlas frames + runtime tint (community-item precedent -
// no new atlas frames needed). PokeAPI-sourced bespoke icons are a later polish.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { erBattleEntrantOrdinal, erBattleOnce } from "#data/elite-redux/er-relic-battle-state";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import type { SpeciesId } from "#enums/species-id";
import type { BattleStat } from "#enums/stat";
import { BATTLE_STATS } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { ErRelicModifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { toDmgValue } from "#utils/common";

export type ErRelicKind =
  | "fieldMedic"
  | "warmIncubator"
  | "coinPurse"
  | "mysteryCharm"
  | "moraleBanner"
  | "secondWind"
  | "twinLink"
  | "anchor"
  | "scrapMagnet"
  | "weathervane"
  | "bondedCharm"
  | "collectorsAlbum"
  | "quartermaster"
  | "lookout"
  | "moltenCore"
  | "capacitor"
  | "pharaohAnkh"
  | "covenant"
  | "cursedIdol";

export interface ErRelicConfig {
  name: string;
  description: string;
  /** Items-atlas frame used as the summary/fallback icon (tinted). */
  icon: string;
  tint: number;
  maxStack: number;
  /** Standalone er-assets texture key (PokeAPI sprite) for the bar icon; omit to
   * use the tinted items-atlas frame above. */
  texture?: string;
}

export const ER_RELIC_CONFIG: Readonly<Record<ErRelicKind, ErRelicConfig>> = {
  fieldMedic: {
    name: "Field Medic",
    description: "Every 3 turns, your benched Pokémon in slots 2 and 3 recover 1/12 of their max HP.",
    icon: "healing_charm",
    tint: 0x88f0b0,
    maxStack: 1,
    texture: "er_field_medic",
  },
  warmIncubator: {
    name: "Warm Incubator",
    description: "All of your eggs hatch faster - every egg gains an extra wave of progress each wave.",
    icon: "charcoal",
    tint: 0xffb060,
    maxStack: 1,
    texture: "er_warm_incubator",
  },
  coinPurse: {
    name: "Coin Purse",
    description: "You earn 20% more money from all sources.",
    icon: "amulet_coin",
    tint: 0xf8d030,
    maxStack: 1,
  },
  mysteryCharm: {
    name: "Mystery Charm",
    description: "Mystery encounters appear far more often while you hold this charm (about one every 5 waves).",
    // A purple-tinted Ability Charm (the hidden-ability charm), recolored for MEs.
    icon: "ability_charm",
    tint: 0xc080f8,
    maxStack: 1,
  },
  moraleBanner: {
    name: "Morale Banner",
    description: "While no Pokémon has fainted this biome, your whole team deals 15% more damage.",
    icon: "wide_lens",
    tint: 0xf85858,
    maxStack: 1,
  },
  secondWind: {
    name: "Second Wind",
    description: "Once per biome, the first of your Pokémon that would faint instead survives at 1 HP.",
    icon: "focus_band",
    tint: 0xf0e060,
    maxStack: 1,
  },
  twinLink: {
    name: "Twin Link",
    description: "If your party slots 2 and 3 share a type, your team's moves of that type deal 15% more damage.",
    icon: "soul_dew",
    tint: 0x80c0f8,
    maxStack: 1,
  },
  moltenCore: {
    name: "Molten Core",
    description: "The Caldera's heart. Your team's Fire-type moves deal 20% more damage.",
    icon: "charcoal",
    tint: 0xf85020,
    maxStack: 1,
  },
  capacitor: {
    name: "Capacitor",
    description: "Stored reactor charge. Your team's Electric-type moves deal 20% more damage.",
    icon: "magnet",
    tint: 0x70d0f8,
    maxStack: 1,
  },
  pharaohAnkh: {
    name: "Pharaoh's Ankh",
    description: "Once per battle, when any of your Pokémon would faint, it instead clings to life at 1 HP.",
    icon: "reviver_seed",
    tint: 0xf8d040,
    maxStack: 1,
  },
  anchor: {
    name: "Anchor",
    description: "Once per biome, the first time your slot 6 Pokémon becomes your last one standing, it is fully healed.",
    icon: "big_root",
    tint: 0x9090a8,
    maxStack: 1,
  },
  scrapMagnet: {
    name: "Scrap Magnet",
    description: "Trainer battles have a 25% chance to drop one extra item reward.",
    icon: "metal_coat",
    tint: 0xb0b0c0,
    maxStack: 1,
  },
  weathervane: {
    name: "Weathervane",
    description: "Your Pokémon take no residual damage from sandstorm or hail.",
    icon: "never_melt_ice",
    tint: 0xc0d8f0,
    maxStack: 1,
  },
  bondedCharm: {
    name: "Bonded Charm",
    description: "When you switch a Pokémon out, the one coming in keeps the lead's positive stat boosts.",
    icon: "binding_band",
    tint: 0xf8a8d8,
    maxStack: 1,
  },
  collectorsAlbum: {
    name: "Collector's Album",
    description: "Every 3rd new species you catch this run grants a small batch of candy for that species.",
    icon: "relic_gold",
    tint: 0xf8d860,
    maxStack: 1,
  },
  quartermaster: {
    name: "Quartermaster",
    description: "Every 10 waves, your slot 5 Pokémon copies one held item from slot 4 or slot 6.",
    icon: "berry_pouch",
    tint: 0xc0a070,
    maxStack: 1,
  },
  lookout: {
    name: "Lookout",
    description: "Before each battle, scout the lead enemy and report its types.",
    icon: "scope_lens",
    tint: 0x90d0c0,
    maxStack: 1,
  },
  covenant: {
    name: "Covenant of Rest",
    description: "A pact struck in the dark. Your whole team is fully healed every 7th wave.",
    // TODO art-polish: bespoke icon. Reuse the heal-charm frame, tinted abyssal violet.
    icon: "healing_charm",
    tint: 0x9060d0,
    maxStack: 1,
  },
  cursedIdol: {
    name: "Cursed Idol",
    description:
      "A leering effigy. Each battle, the first Pokémon you switch in gains a free Substitute, but the next to enter arrives at half HP.",
    // TODO art-polish: bespoke idol icon. Reuse the soul-dew frame, tinted abyssal violet.
    icon: "soul_dew",
    tint: 0x7030a0,
    maxStack: 1,
  },
};

/** Every relic kind, in display order (used by the type registry). */
export const ER_RELIC_KINDS: readonly ErRelicKind[] = ["fieldMedic", "warmIncubator"];

/** Field Medic: heal cadence (every N turns) and heal fraction (1/denominator). */
const FIELD_MEDIC_TURN_CADENCE = 3;
const FIELD_MEDIC_HEAL_DENOM = 12;
/** Warm Incubator: extra hatch-wave progress per wave, per stack. */
const WARM_INCUBATOR_WAVES_PER_STACK = 1;
/** Coin Purse: percent money bonus per stack. */
const COIN_PURSE_PERCENT_PER_STACK = 20;
/** Mystery Charm: added to the anti-variance ME RUN TARGET per stack. A flat
 * spawn-weight bonus would be fought by the anti-variance mechanic (which pulls
 * the run back toward its target count), so instead the charm raises the target
 * itself: +20 takes the run target 16 -> 36 over the 179-wave ME span, i.e. an ME
 * ~every 5 waves (vs ~11 without). Because it lifts the whole target, every tier
 * - including the rare ULTRA/ROGUE events - scales up commensurately. */
const MYSTERY_CHARM_TARGET_PER_STACK = 20;
/** Morale Banner: percent damage bonus while the team is faint-free this biome. */
const MORALE_BANNER_PERCENT = 15;
/** Twin Link: percent damage bonus for moves of the slot 2/3 shared type. */
const TWIN_LINK_PERCENT = 15;
/** Scrap Magnet: chance (out of 100) of an extra trainer-battle reward option. */
const SCRAP_MAGNET_CHANCE_PCT = 25;
/** Collector's Album: grant the candy trickle on every Nth unique species caught. */
const COLLECTORS_ALBUM_CADENCE = 3;
/** Collector's Album: candy units granted on each cadence hit. */
const COLLECTORS_ALBUM_CANDY = 3;
/** Quartermaster: copy one held item to slot 5 every N waves. */
const QUARTERMASTER_WAVE_CADENCE = 10;

/** Total stacks of the given relic the player currently holds (team-wide). */
export function getErRelicStacks(kind: ErRelicKind): number {
  let stacks = 0;
  for (const mod of globalScene?.findModifiers(
    m => m instanceof ErRelicModifier && (m as ErRelicModifier).kind === kind,
    true,
  ) ?? []) {
    stacks += (mod as ErRelicModifier).getStackCount();
  }
  return stacks;
}

/** True when the player currently holds at least one of the given relic. */
export function hasErRelic(kind: ErRelicKind): boolean {
  return getErRelicStacks(kind) > 0;
}

/**
 * Field Medic (relic): called ONCE per turn from TurnEndPhase. On every
 * {@linkcode FIELD_MEDIC_TURN_CADENCE}-th turn, heal the BENCHED player mons in
 * party slots 2 and 3 (array indices 1 and 2 - the reserves, never the active
 * mon on the field) for 1/12 of their max HP each. No-op when the relic isn't
 * held. Each reserve is skipped if it is missing, fainted, or already full.
 *
 * Benched mons are off-field, so the battler-index-keyed PokemonHealPhase does
 * not apply; we heal them directly via {@linkcode Pokemon.heal} (the same
 * hp-clamping mutation a party-targeted Potion uses) and refresh their info bar.
 */
export function erApplyFieldMedic(): void {
  if (!hasErRelic("fieldMedic")) {
    return;
  }
  const turn = globalScene.currentBattle?.turn ?? 0;
  if (turn < 1 || turn % FIELD_MEDIC_TURN_CADENCE !== 0) {
    return;
  }
  const party = globalScene.getPlayerParty();
  // Slots 2 and 3 only (party indices 1 and 2) - the back-row reserves.
  for (const index of [1, 2]) {
    const pokemon = party[index];
    if (!pokemon || pokemon.isFainted() || pokemon.isFullHp()) {
      continue;
    }
    const healed = pokemon.heal(toDmgValue(pokemon.getMaxHp() / FIELD_MEDIC_HEAL_DENOM));
    if (healed > 0) {
      pokemon.updateInfo();
      // ER custom relic - English-only (shared locales submodule). Silent on the
      // field log would be fine for a benched mon, but a brief named note helps
      // testers see the heal fire.
      globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()} was tended by the Field Medic!`);
    }
  }
}

/**
 * Warm Incubator (relic): extra hatch-wave progress to apply to EVERY egg this
 * wave, on top of the normal -1. Returns 0 when the relic isn't held. Called
 * from EggLapsePhase.
 */
export function erWarmIncubatorBonus(): number {
  return getErRelicStacks("warmIncubator") * WARM_INCUBATOR_WAVES_PER_STACK;
}

/** Coin Purse (relic): percent money bonus applied to every money gain. */
export function erCoinPurseBonusPercent(): number {
  return getErRelicStacks("coinPurse") * COIN_PURSE_PERCENT_PER_STACK;
}

/** Mystery Charm (relic): bonus added to the anti-variance Mystery-Encounter run
 * target (raises the per-run ME count to ~every 5 waves at 1 stack). */
export function erMysteryCharmTargetBonus(): number {
  return getErRelicStacks("mysteryCharm") * MYSTERY_CHARM_TARGET_PER_STACK;
}

// =============================================================================
// Per-RUN transient relic state (NOT saved, NOT reset per biome - lives for the
// whole run). Collector's Album counts the DISTINCT root species the player has
// caught this run; a mid-run reload re-zeroes it (player-friendly: it can only
// give MORE candy, never softlock), matching the per-biome flags' "not in the
// save schema" stance.
// =============================================================================

/** Root species ids the player has caught this run (Collector's Album). */
const COLLECTORS_ALBUM_SEEN: Set<SpeciesId> = new Set();

/**
 * Collector's Album (relic): record a freshly-caught Pokémon. When the catch is
 * a NEW root species this run AND that pushes the unique-species count to a
 * multiple of {@linkcode COLLECTORS_ALBUM_CADENCE}, grant a small batch of candy
 * for that species' starter line. No-op when the relic isn't held, the species
 * was already caught this run, or the candy store is already capped.
 *
 * Called from AttemptCapturePhase's catch-success path with the caught mon's
 * root species id. Always records the species (so the run-unique count stays
 * accurate even when the relic is later acquired), but only grants while held.
 */
export function erCollectorsAlbumRecordCatch(rootSpeciesId: SpeciesId): void {
  if (COLLECTORS_ALBUM_SEEN.has(rootSpeciesId)) {
    return;
  }
  COLLECTORS_ALBUM_SEEN.add(rootSpeciesId);
  if (!hasErRelic("collectorsAlbum")) {
    return;
  }
  if (COLLECTORS_ALBUM_SEEN.size % COLLECTORS_ALBUM_CADENCE !== 0) {
    return;
  }
  // addStarterCandy clamps at MAX_STARTER_CANDY_COUNT and returns false when the
  // store is already full; only announce when candy was actually granted.
  const granted = globalScene.gameData.addStarterCandy(rootSpeciesId, COLLECTORS_ALBUM_CANDY);
  if (granted) {
    // ER custom relic - English-only (shared locales submodule).
    globalScene.phaseManager.queueMessage(
      `The Collector's Album rewarded you with candy for filling in ${COLLECTORS_ALBUM_SEEN.size} species!`,
    );
  }
}

// =============================================================================
// Per-biome transient relic state (NOT saved - reset on every biome entry).
//
// Several relics are "once per biome" or "while a condition holds this biome".
// We track that in module-scoped flags that {@linkcode resetErRelicBiomeState}
// clears each time the player enters a new arena (called from
// `BattleScene.newArena`, the single choke-point for biome transitions). These
// flags are deliberately NOT serialised: a mid-biome reload re-arms the relic,
// which is the player-friendly direction and avoids touching the save schema.
// =============================================================================

/** True once any player Pokémon has fainted in the CURRENT biome (Morale Banner). */
let MORALE_BANNER_BROKEN = false;
/** True once Second Wind has saved a Pokémon in the CURRENT biome (one-shot). */
let SECOND_WIND_USED = false;
/** True once Anchor's last-stand full heal has fired in the CURRENT biome (one-shot). */
let ANCHOR_USED = false;
/** waveIndex -> rolled Scrap Magnet extra-reward result, cached so rerolls/copies are stable. */
let SCRAP_MAGNET_ROLLED_WAVE = -1;
let SCRAP_MAGNET_ROLL_RESULT = false;

/** Clear all per-biome relic flags. Called from `BattleScene.newArena`. */
export function resetErRelicBiomeState(): void {
  MORALE_BANNER_BROKEN = false;
  SECOND_WIND_USED = false;
  ANCHOR_USED = false;
  SCRAP_MAGNET_ROLLED_WAVE = -1;
  SCRAP_MAGNET_ROLL_RESULT = false;
}

/**
 * Record a player faint for the relic system. Breaks the Morale Banner's
 * faint-free condition for the rest of this biome. Called from FaintPhase for
 * player Pokémon (no-op for enemies / when no relevant relic is held).
 */
export function erRelicRecordPlayerFaint(): void {
  MORALE_BANNER_BROKEN = true;
}

/**
 * Morale Banner (relic): team-wide attack multiplier. Returns 1.15 while the
 * relic is held and NO player Pokémon has fainted yet this biome, else 1.
 * Queried from {@linkcode Pokemon.getAttackDamage} for player attackers.
 */
export function erMoraleBannerMultiplier(): number {
  if (MORALE_BANNER_BROKEN || !hasErRelic("moraleBanner")) {
    return 1;
  }
  return 1 + MORALE_BANNER_PERCENT / 100;
}

/**
 * The type shared by the player party's slot 2 and slot 3 mons (array indices
 * 1 and 2), or null if those slots don't exist or share no type. Twin Link's
 * bonus applies to moves of this type.
 */
function erTwinLinkSharedType(): PokemonType | null {
  const party = globalScene?.getPlayerParty?.() ?? [];
  const second = party[1];
  const third = party[2];
  if (!second || !third) {
    return null;
  }
  const secondTypes = second.getTypes(false, false, true);
  const thirdTypes = third.getTypes(false, false, true);
  for (const t of secondTypes) {
    if (thirdTypes.includes(t)) {
      return t;
    }
  }
  return null;
}

/**
 * Twin Link (relic): team-wide attack multiplier for moves of the type shared
 * by party slots 2 and 3. Returns 1.15 for matching move types while the relic
 * is held, else 1. Queried from {@linkcode Pokemon.getAttackDamage}.
 */
export function erTwinLinkMultiplier(moveType: PokemonType): number {
  if (!hasErRelic("twinLink")) {
    return 1;
  }
  const shared = erTwinLinkSharedType();
  if (shared === null || shared !== moveType) {
    return 1;
  }
  return 1 + TWIN_LINK_PERCENT / 100;
}

/**
 * Molten Core (relic): the Caldera's heart. Team-wide +20% damage on FIRE-type
 * moves while held. Queried from {@linkcode Pokemon.getAttackDamage}.
 */
export function erMoltenCoreFireMultiplier(moveType: PokemonType): number {
  return moveType === PokemonType.FIRE && hasErRelic("moltenCore") ? 1.2 : 1;
}

/**
 * Capacitor (relic): stored reactor charge. Team-wide +20% damage on ELECTRIC-type
 * moves while held. Queried from {@linkcode Pokemon.getAttackDamage}.
 */
export function erCapacitorElectricMultiplier(moveType: PokemonType): number {
  return moveType === PokemonType.ELECTRIC && hasErRelic("capacitor") ? 1.2 : 1;
}

/**
 * Second Wind (relic): when a player Pokémon is about to take lethal damage,
 * returns true (consuming the once-per-biome charge) so the caller clamps it to
 * survive at 1 HP. Returns false if the relic isn't held, already used this
 * biome, or the Pokémon isn't a player mon at >=1 HP. Called from
 * {@linkcode Pokemon.damage}.
 */
export function erTrySecondWind(pokemon: Pokemon): boolean {
  if (SECOND_WIND_USED || !pokemon.isPlayer() || pokemon.hp < 1 || !hasErRelic("secondWind")) {
    return false;
  }
  SECOND_WIND_USED = true;
  // ER custom relic - English-only (shared locales submodule).
  globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()} held on with its Second Wind!`);
  return true;
}

/**
 * Pharaoh's Ankh (relic): once per BATTLE, when ANY player Pokémon would faint it
 * instead clings to life at 1 HP. Re-arms each battle and survives a reload via
 * the persisted per-battle relic state (so a mid-battle Continue can't grant a
 * second revive). Called from {@linkcode Pokemon.damage} after Second Wind.
 */
export function erTryPharaohAnkh(pokemon: Pokemon): boolean {
  if (!pokemon.isPlayer() || pokemon.hp < 1 || !hasErRelic("pharaohAnkh")) {
    return false;
  }
  if (!erBattleOnce("pharaohAnkh")) {
    return false; // already saved a mon this battle (persists across reload)
  }
  globalScene.phaseManager.queueMessage(
    `${pokemon.getNameToRender()} was pulled back from the brink by the Pharaoh's Ankh!`,
  );
  return true;
}

/**
 * Anchor (relic): called from FaintPhase after a player faint resolves. If the
 * relic is held, hasn't fired yet this biome, and the ONLY surviving legal
 * player Pokémon is the slot 6 mon (party index 5), fully heal that mon (a last
 * stand). One-shot per biome. No-op otherwise.
 */
export function erTryAnchorLastStand(): void {
  if (ANCHOR_USED || !hasErRelic("anchor")) {
    return;
  }
  const party = globalScene.getPlayerParty();
  const anchorMon = party[5];
  if (!anchorMon || anchorMon.isFainted()) {
    return;
  }
  const survivors = party.filter(p => !p.isFainted());
  if (survivors.length !== 1 || survivors[0] !== anchorMon) {
    return;
  }
  ANCHOR_USED = true;
  anchorMon.hp = anchorMon.getMaxHp();
  anchorMon.resetStatus(true);
  anchorMon.updateInfo();
  // ER custom relic - English-only (shared locales submodule).
  globalScene.phaseManager.queueMessage(`${anchorMon.getNameToRender()} made its last stand, fully restored by the Anchor!`);
}

/**
 * Scrap Magnet (relic): how many EXTRA reward options to add to the reward
 * screen after a trainer battle. Rolls once per wave (cached so rerolls and the
 * copy phase stay consistent) with a {@linkcode SCRAP_MAGNET_CHANCE_PCT}% chance
 * of +1. Returns 0 when the relic isn't held or the result was a miss. The
 * caller is responsible for only invoking this on trainer-battle rewards.
 */
export function erScrapMagnetExtraRewards(): number {
  if (!hasErRelic("scrapMagnet")) {
    return 0;
  }
  const wave = globalScene.currentBattle?.waveIndex ?? -1;
  if (wave !== SCRAP_MAGNET_ROLLED_WAVE) {
    SCRAP_MAGNET_ROLLED_WAVE = wave;
    SCRAP_MAGNET_ROLL_RESULT = globalScene.randBattleSeedInt(100) < SCRAP_MAGNET_CHANCE_PCT;
  }
  return SCRAP_MAGNET_ROLL_RESULT ? 1 : 0;
}

/**
 * Weathervane (relic): true when the player holds the relic, meaning player
 * Pokémon ignore residual sandstorm/hail chip damage. Queried from
 * WeatherEffectPhase's per-Pokémon immunity check (gated on isPlayer there).
 */
export function erWeathervaneBlocksWeatherDamage(): boolean {
  return hasErRelic("weathervane");
}

/** A captured set of positive stat stages, carried across a Bonded Charm switch. */
export type ErBondedCharmSnapshot = [BattleStat, number][];

/**
 * Bonded Charm (relic) - STEP 1 of the "soft baton pass". Snapshot the OUTGOING
 * lead's POSITIVE stat stages. MUST be called from SwitchSummonPhase BEFORE the
 * outgoing mon's `leaveField()` runs - leaveField(clearEffects=true) calls
 * `resetSummonData()`, which zeroes the stages, so reading them after that point
 * always returns 0 (this was the bug: the stages were read post-leaveField and
 * nothing ever carried). Returns [] when the relic isn't held or the outgoing
 * mon isn't the player's, so the caller can apply unconditionally.
 */
export function erBondedCharmSnapshot(outgoing: Pokemon): ErBondedCharmSnapshot {
  if (!hasErRelic("bondedCharm") || !outgoing.isPlayer()) {
    return [];
  }
  const snapshot: ErBondedCharmSnapshot = [];
  for (const stat of BATTLE_STATS) {
    const stage = outgoing.getStatStage(stat);
    if (stage > 0) {
      snapshot.push([stat, stage]);
    }
  }
  return snapshot;
}

/**
 * Bonded Charm (relic) - STEP 2 of the "soft baton pass". Apply a snapshot taken
 * by {@linkcode erBondedCharmSnapshot} onto the INCOMING mon. MUST be called
 * AFTER the incoming mon's `fieldSetup(true)` (which re-runs `resetSummonData`,
 * zeroing its stages) so the carried stages survive. Gated to a PLAYER, VOLUNTARY
 * switch (Command.POKEMON) by the caller - NOT faint replacement, U-turn/forced
 * switch, or the opening lead. No-op for an empty snapshot.
 */
export function erBondedCharmApply(incoming: Pokemon, snapshot: ErBondedCharmSnapshot): void {
  if (snapshot.length === 0 || !incoming.isPlayer()) {
    return;
  }
  for (const [stat, stage] of snapshot) {
    incoming.setStatStage(stat, stage);
  }
  // ER custom relic - English-only (shared locales submodule).
  globalScene.phaseManager.queueMessage(
    `${incoming.getNameToRender()} inherited the lead's momentum through the Bonded Charm!`,
  );
}

/** waveIndex on which Quartermaster last fired its copy (guards against re-firing). */
let QUARTERMASTER_LAST_WAVE = -1;

/**
 * Quartermaster (relic): every {@linkcode QUARTERMASTER_WAVE_CADENCE} waves, the
 * slot 5 player mon (party index 4) copies ONE transferable held item from slot
 * 4 (index 3) or slot 6 (index 5). A brand-new modifier instance (stack count 1)
 * is added to slot 5 via the normal modifier path, so save round-trips for free.
 *
 * Runaway-stacking guards: at most ONE item is copied per trigger; the slot 5
 * mon's existing stack of that item must be BELOW its per-mon cap (else we skip
 * that candidate and try the next), and the trigger fires at most once per wave.
 * No-op when the relic isn't held, slot 5 is missing/fainted, or no eligible
 * source item exists. Called from EncounterPhase once the party is loaded.
 */
export function erQuartermasterTick(): void {
  if (!hasErRelic("quartermaster")) {
    return;
  }
  const wave = globalScene.currentBattle?.waveIndex ?? -1;
  if (wave < 1 || wave % QUARTERMASTER_WAVE_CADENCE !== 0 || wave === QUARTERMASTER_LAST_WAVE) {
    return;
  }
  const party = globalScene.getPlayerParty();
  const recipient = party[4];
  if (!recipient || recipient.isFainted()) {
    return;
  }
  // Candidate source mons: slot 4 (index 3) and slot 6 (index 5), in order.
  for (const sourceIndex of [3, 5]) {
    const source = party[sourceIndex];
    if (!source) {
      continue;
    }
    const heldItems = globalScene.findModifiers(
      m =>
        m instanceof PokemonHeldItemModifier && (m as PokemonHeldItemModifier).pokemonId === source.id && m.isTransferable,
      true,
    ) as PokemonHeldItemModifier[];
    for (const item of heldItems) {
      const clone = item.clone() as PokemonHeldItemModifier;
      clone.pokemonId = recipient.id;
      clone.stackCount = 1;
      // Respect the recipient's per-mon stack cap for this item: skip if it's
      // already maxed, so the copy never tips into the "stack full" fallback.
      const existing = globalScene.findModifier(
        m =>
          m instanceof PokemonHeldItemModifier
          && (m as PokemonHeldItemModifier).matchType(item)
          && (m as PokemonHeldItemModifier).pokemonId === recipient.id,
        true,
      ) as PokemonHeldItemModifier | undefined;
      const cap = clone.getMaxStackCount();
      if (cap < 1 || (existing && existing.getStackCount() >= cap)) {
        continue;
      }
      if (globalScene.addModifier(clone, false, false)) {
        QUARTERMASTER_LAST_WAVE = wave;
        // ER custom relic - English-only (shared locales submodule). Deferred so
        // the note plays after the encounter setup instead of mid-sequence.
        globalScene.phaseManager.queueMessage(
          `The Quartermaster issued ${recipient.getNameToRender()} a copy of ${item.type.name}!`,
          null,
          true,
          null,
          true,
        );
        return;
      }
    }
  }
}

/** Convert a {@linkcode PokemonType} enum value to a display label (e.g. "Fire"). */
function erTypeLabel(type: PokemonType): string {
  const raw = PokemonType[type];
  if (!raw) {
    return "Unknown";
  }
  return raw.charAt(0) + raw.slice(1).toLowerCase();
}

/**
 * Lookout (relic): queue a short "scout report" naming the lead enemy and its
 * types before the battle begins (message-only, no new UI). No-op when the relic
 * isn't held or there is no enemy on the field. Called from EncounterPhase after
 * the enemy party is built. Previews the lead foe of the battle you are about to
 * enter (the next fight from the player's standpoint).
 */
export function erLookoutPreviewEnemy(): void {
  if (!hasErRelic("lookout")) {
    return;
  }
  const lead = globalScene.getEnemyParty()?.[0];
  if (!lead) {
    return;
  }
  const types = lead.getTypes(false, false, true).map(erTypeLabel).join(" / ");
  // ER custom relic - English-only (shared locales submodule). Deferred so the
  // scout report plays after the encounter setup instead of mid-sequence.
  globalScene.phaseManager.queueMessage(
    `Lookout report: ${lead.getNameToRender()} ahead, a ${types} type!`,
    null,
    true,
    null,
    true,
  );
}

/** Covenant of Rest: heal cadence (every Nth wave). */
const COVENANT_WAVE_CADENCE = 7;
/** waveIndex on which Covenant last fired (guards against re-firing in a wave). */
let COVENANT_LAST_WAVE = -1;

/**
 * Covenant of Rest (relic, Abyss "Seven Sins" deal): a pact struck with Giratina.
 * Every {@linkcode COVENANT_WAVE_CADENCE}th wave, fully heal the whole party.
 * Skips the every-10 cadence waves so it never double-fires with the normal
 * biome heal (which already heals on those). Called once per wave from
 * EncounterPhase, alongside {@linkcode erQuartermasterTick}.
 */
export function erApplyCovenantHeal(): void {
  if (!hasErRelic("covenant")) {
    return;
  }
  const wave = globalScene.currentBattle?.waveIndex ?? 0;
  if (wave < COVENANT_WAVE_CADENCE || wave % COVENANT_WAVE_CADENCE !== 0 || wave % 10 === 0) {
    return;
  }
  if (wave === COVENANT_LAST_WAVE) {
    return;
  }
  COVENANT_LAST_WAVE = wave;
  globalScene.phaseManager.unshiftNew("PartyHealPhase", false);
  // ER custom relic - English-only (shared locales submodule).
  globalScene.phaseManager.queueMessage("The Covenant of Rest mends your team.", null, true, null, true);
}

// =============================================================================
// Cursed Idol (relic, Abyss "Seven Sins" deal): the double-edged "Void Gaze".
// Each BATTLE, the FIRST player Pokemon sent out gains a FREE Substitute (the
// normal 1/4-HP cost is waived - we add the tag directly, whose onAdd builds the
// doll without deducting HP), but the NEXT player Pokemon to enter arrives at
// half its current HP. Send-out order is tracked per wave (re-arms each battle,
// like Pharaoh's Ankh) and resets when the wave changes.
// =============================================================================

/**
 * Cursed Idol (relic): called from PostSummonPhase for every Pokemon that enters.
 * No-op for enemies or when the relic isn't held. The first player mon out this
 * battle gets a free Substitute; the second gets its HP halved. Subsequent
 * entrants are unaffected.
 *
 * Send-out order is tracked in the persisted, per-mon-idempotent per-battle relic
 * state (er-relic-battle-state): it re-arms each battle AND survives a reload, so
 * a Continue mid-battle doesn't re-count and re-halve an already-processed mon
 * (the reported "Cursed Idol -50% applies again if I rejoin" bug).
 */
export function erApplyCursedIdol(pokemon: Pokemon): void {
  if (!hasErRelic("cursedIdol") || !pokemon.isPlayer()) {
    return;
  }
  const { ordinal, firstTime } = erBattleEntrantOrdinal("cursedIdol", pokemon.id);
  if (!firstTime) {
    return; // already processed this mon this battle (e.g. a reload re-summon)
  }

  if (ordinal === 1) {
    // Free Substitute: add the tag directly so onAdd builds the doll (hp = maxHp/4)
    // WITHOUT the move's normal HP cost. Source is the mon itself.
    if (!pokemon.getTag(BattlerTagType.SUBSTITUTE)) {
      pokemon.addTag(BattlerTagType.SUBSTITUTE, 0, MoveId.SUBSTITUTE, pokemon.id);
      // ER custom relic - English-only (shared locales submodule).
      globalScene.phaseManager.queueMessage(`The Cursed Idol shrouds ${pokemon.getNameToRender()} in a free Substitute!`);
    }
  } else if (ordinal === 2) {
    const drained = Math.max(1, Math.floor(pokemon.hp / 2));
    if (pokemon.hp > drained) {
      pokemon.hp = drained;
      pokemon.updateInfo();
      // ER custom relic - English-only (shared locales submodule).
      globalScene.phaseManager.queueMessage(`The Cursed Idol drains ${pokemon.getNameToRender()} as it enters!`);
    }
  }
}
