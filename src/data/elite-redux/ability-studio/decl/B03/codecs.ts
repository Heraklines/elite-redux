/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 2: codecs shared by the declarations of this chunk. The registry only collects `*.decl.ts` and
// `bindings.ts`, so a helper file with another name is not mistaken for a declaration.
//
//  - `statListCodec`: a list of battle stats shown as names ("ATK,DEF") for constructors that take `BattleStat[]`.
//  - `stringEnumCodec` / `stringEnumListCodec`: ArenaTagType and BattlerTagType are STRING enums whose member name
//    equals the value, so these only check that the name is real (a typo would otherwise be silently passed on).
//  - `ANNOUNCEMENTS`: the built-in "when I enter" announcements of PostSummonMessageAbAttr, each rebuilt as the same
//    translation call the ability file writes inline (the closures live in init-abilities.ts and cannot be imported).
import { getPokemonNameWithAffix } from "#app/messages";
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { getStatKey, Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import i18next from "i18next";

export const BATTLE_STAT_NAMES = ["ATK", "DEF", "SPATK", "SPDEF", "SPD", "ACC", "EVA"] as const;
const STATS = Stat as unknown as Readonly<Record<string, number | string>>;

/** "ATK,DEF" <-> `[Stat.ATK, Stat.DEF]`. The constructor always gets an array, like every user passes one. */
export const statListCodec: ParamCodec = {
  toCtor: value => {
    const stats = String(value)
      .split(",")
      .map(part => part.trim())
      .filter(part => part.length > 0)
      .map(part => {
        const resolved = STATS[part];
        if (typeof resolved !== "number" || !(BATTLE_STAT_NAMES as readonly string[]).includes(part)) {
          throw new Error(`"${part}" is not a stat that has stages`);
        }
        return resolved;
      });
    if (stats.length === 0) {
      throw new Error("pick at least one stat");
    }
    return stats;
  },
  fromInstance: raw => {
    if (!Array.isArray(raw)) {
      return;
    }
    const names = raw.map(item => (typeof item === "number" ? STATS[item] : undefined));
    return names.every((name): name is string => typeof name === "string") ? names.join(",") : undefined;
  },
};

type StringEnum = Readonly<Record<string, string>>;

function checkedName(table: StringEnum, raw: string, what: string): string {
  const resolved = table[raw];
  if (typeof resolved !== "string") {
    throw new Error(`"${raw}" is not a known ${what}`);
  }
  return resolved;
}

function nameOfValue(table: StringEnum, raw: unknown): string | undefined {
  return typeof raw === "string" ? Object.keys(table).find(key => table[key] === raw) : undefined;
}

export function stringEnumCodec(table: StringEnum, what: string): ParamCodec {
  return {
    toCtor: value => checkedName(table, String(value).trim(), what),
    fromInstance: raw => nameOfValue(table, raw),
  };
}

export function stringEnumListCodec(table: StringEnum, what: string): ParamCodec {
  return {
    toCtor: value => {
      const items = String(value)
        .split(",")
        .map(part => part.trim())
        .filter(part => part.length > 0)
        .map(part => checkedName(table, part, what));
      if (items.length === 0) {
        throw new Error(`pick at least one ${what}`);
      }
      return items;
    },
    fromInstance: raw => {
      if (!Array.isArray(raw)) {
        return;
      }
      const names = raw.map(item => nameOfValue(table, item));
      return names.every((name): name is string => name !== undefined) ? names.join(",") : undefined;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Announcements

const ABILITY_TRIGGERS = "abilityTriggers:";

function simpleAnnouncement(key: string): (pokemon: Pokemon) => string {
  return pokemon => i18next.t(`${ABILITY_TRIGGERS}${key}`, { pokemonNameWithAffix: getPokemonNameWithAffix(pokemon) });
}

function ruinAnnouncement(key: string, stat: Stat): (pokemon: Pokemon) => string {
  return pokemon =>
    i18next.t(`${ABILITY_TRIGGERS}${key}`, {
      pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
      statName: i18next.t(getStatKey(stat)),
    });
}

/** Choice name to the translation key it shows and the function the constructor receives. */
export const ANNOUNCEMENTS: Readonly<
  Record<string, { readonly key: string; readonly build: () => (pokemon: Pokemon) => string }>
> = {
  PRESSURE: { key: "postSummonPressure", build: () => simpleAnnouncement("postSummonPressure") },
  MOLD_BREAKER: { key: "postSummonMoldBreaker", build: () => simpleAnnouncement("postSummonMoldBreaker") },
  ANTICIPATION: { key: "postSummonAnticipation", build: () => simpleAnnouncement("postSummonAnticipation") },
  TURBOBLAZE: { key: "postSummonTurboblaze", build: () => simpleAnnouncement("postSummonTurboblaze") },
  TERAVOLT: { key: "postSummonTeravolt", build: () => simpleAnnouncement("postSummonTeravolt") },
  DARK_AURA: { key: "postSummonDarkAura", build: () => simpleAnnouncement("postSummonDarkAura") },
  FAIRY_AURA: { key: "postSummonFairyAura", build: () => simpleAnnouncement("postSummonFairyAura") },
  AURA_BREAK: { key: "postSummonAuraBreak", build: () => simpleAnnouncement("postSummonAuraBreak") },
  TWO_ABILITIES_GLASTRIER: {
    key: "postSummonAsOneGlastrier",
    build: () => simpleAnnouncement("postSummonAsOneGlastrier"),
  },
  TWO_ABILITIES_SPECTRIER: {
    key: "postSummonAsOneSpectrier",
    build: () => simpleAnnouncement("postSummonAsOneSpectrier"),
  },
  VESSEL_OF_RUIN: {
    key: "postSummonVesselOfRuin",
    build: () => ruinAnnouncement("postSummonVesselOfRuin", Stat.SPATK),
  },
  SWORD_OF_RUIN: { key: "postSummonSwordOfRuin", build: () => ruinAnnouncement("postSummonSwordOfRuin", Stat.DEF) },
  TABLETS_OF_RUIN: {
    key: "postSummonTabletsOfRuin",
    build: () => ruinAnnouncement("postSummonTabletsOfRuin", Stat.ATK),
  },
  BEADS_OF_RUIN: { key: "postSummonBeadsOfRuin", build: () => ruinAnnouncement("postSummonBeadsOfRuin", Stat.SPDEF) },
};

/** The one announcement that cannot be rebuilt: it also writes a per-battle memory only init-abilities.ts can reach. */
export const ZERO_TO_HERO = "ZERO_TO_HERO_TRANSFORMATION";
