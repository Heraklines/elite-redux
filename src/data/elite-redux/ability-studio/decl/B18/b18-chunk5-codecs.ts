/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Hand-written codec for the B18 chunk 5 declaration (AbilityStudioSourceAbilityAbAttr). Staff pick the NAME of a built-in ability;
// the constructor wants its id number. The 40 abilities are the ones the game reads by identity (ABILITY_STUDIO_DIRECT_SOURCE_ABILITY_IDS);
// a test checks this list against that set, so a new identity-checked ability makes it fail instead of going missing.
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { AbilityId } from "#enums/ability-id";

export interface SourceAbilityPick {
  readonly id: number;
  readonly word: string;
}

export const SOURCE_ABILITY_PICKS: readonly SourceAbilityPick[] = [
  { id: AbilityId.AURA_BREAK, word: "Aura Break" },
  { id: AbilityId.BATTLE_BOND, word: "Battle Bond" },
  { id: AbilityId.BERSERK, word: "Berserk" },
  { id: AbilityId.COMATOSE, word: "Comatose" },
  { id: AbilityId.COMMANDER, word: "Commander" },
  { id: AbilityId.DARK_AURA, word: "Dark Aura" },
  { id: AbilityId.FAIRY_AURA, word: "Fairy Aura" },
  { id: AbilityId.FLOWER_GIFT, word: "Flower Gift" },
  { id: AbilityId.FORECAST, word: "Forecast" },
  { id: AbilityId.GULP_MISSILE, word: "Gulp Missile" },
  { id: AbilityId.GUTS, word: "Guts" },
  { id: AbilityId.HEAVY_METAL, word: "Heavy Metal" },
  { id: AbilityId.ICE_FACE, word: "Ice Face" },
  { id: AbilityId.ILLUMINATE, word: "Illuminate" },
  { id: AbilityId.KLUTZ, word: "Klutz" },
  { id: AbilityId.LEVITATE, word: "Levitate" },
  { id: AbilityId.MIMICRY, word: "Mimicry" },
  { id: AbilityId.MINUS, word: "Minus" },
  { id: AbilityId.MULTITYPE, word: "Multitype" },
  { id: AbilityId.OVERCOAT, word: "Overcoat" },
  { id: AbilityId.PLUS, word: "Plus" },
  { id: AbilityId.POISON_HEAL, word: "Poison Heal" },
  { id: AbilityId.PRANKSTER, word: "Prankster" },
  { id: AbilityId.PROTOSYNTHESIS, word: "Protosynthesis" },
  { id: AbilityId.QUARK_DRIVE, word: "Quark Drive" },
  { id: AbilityId.QUICK_DRAW, word: "Quick Draw" },
  { id: AbilityId.RKS_SYSTEM, word: "RKS System" },
  { id: AbilityId.SAND_FORCE, word: "Sand Force" },
  { id: AbilityId.SHADOW_TAG, word: "Shadow Tag" },
  { id: AbilityId.SHEER_FORCE, word: "Sheer Force" },
  { id: AbilityId.SNOW_WARNING, word: "Snow Warning" },
  { id: AbilityId.SOLAR_POWER, word: "Solar Power" },
  { id: AbilityId.STANCE_CHANGE, word: "Stance Change" },
  { id: AbilityId.STENCH, word: "Stench" },
  { id: AbilityId.TRUANT, word: "Truant" },
  { id: AbilityId.UNBURDEN, word: "Unburden" },
  { id: AbilityId.WANDERING_SPIRIT, word: "Wandering Spirit" },
  { id: AbilityId.WIND_POWER, word: "Wind Power" },
  { id: AbilityId.WIND_RIDER, word: "Wind Rider" },
  { id: AbilityId.WONDER_GUARD, word: "Wonder Guard" },
];

export const SOURCE_ABILITY_OPTIONS: readonly string[] = SOURCE_ABILITY_PICKS.map(pick => pick.word);

export const sourceAbilityCodec: ParamCodec = {
  toCtor: value => {
    const found = SOURCE_ABILITY_PICKS.find(entry => entry.word === value);
    if (found === undefined) {
      throw new Error(`"${String(value)}" is not one of the abilities whose game rules staff can copy here`);
    }
    return found.id;
  },
  fromInstance: raw => SOURCE_ABILITY_PICKS.find(entry => entry.id === raw)?.word,
};

/** The class stores "<name> linked runtime behavior" in componentLabel; the constructor wants only the name. */
const LABEL_SUFFIX = " linked runtime behavior";

export const shownNameCodec: ParamCodec = {
  toCtor: value => String(value),
  fromInstance: raw =>
    typeof raw === "string" && raw.endsWith(LABEL_SUFFIX) ? raw.slice(0, raw.length - LABEL_SUFFIX.length) : undefined,
};
