/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Hand-written codecs for the B18 chunk 4 declarations. Staff see and type player words ("Attack, Sp. Atk", "Ball and bomb moves",
// "Feint attack"); the classes want enum numbers. Every parser throws a plain-language error for text it does not understand, and
// every reader returns undefined for a value that no player word stands for (the harness then shows nothing instead of a wrong word).
import { playerName } from "#data/elite-redux/ability-studio/decl-naming";
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";

/** Lower case letters only, so "Sp. Atk", "sp atk" and "SPATK" all read the same. */
const squash = (text: string): string => text.toLowerCase().replace(/[^a-z]/g, "");

function splitList(value: unknown): string[] {
  return String(value)
    .split(",")
    .map(part => part.trim())
    .filter(part => part.length > 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Which stats change (OnceLowHpStatRaiseAbAttr). The order is kept: the class hands the list to one stat change in that order.

const STAT_WORDS = [
  { word: playerName("ATK"), stat: Stat.ATK },
  { word: playerName("DEF"), stat: Stat.DEF },
  { word: playerName("SPATK"), stat: Stat.SPATK },
  { word: playerName("SPDEF"), stat: Stat.SPDEF },
  { word: playerName("SPD"), stat: Stat.SPD },
  { word: playerName("ACC"), stat: Stat.ACC },
  { word: playerName("EVA"), stat: Stat.EVA },
] as const;

/** The seven stats, as the words staff type. */
export const STAT_LIST_OPTIONS: readonly string[] = STAT_WORDS.map(entry => entry.word);

export const statListCodec: ParamCodec = {
  toCtor: value => {
    const parts = splitList(value);
    if (parts.length === 0) {
      throw new Error("pick at least one stat (Attack, Defense, Sp. Atk, Sp. Def, Speed, Accuracy, Evasion)");
    }
    return parts.map(part => {
      const found = STAT_WORDS.find(
        entry => squash(entry.word) === squash(part) || squash(Stat[entry.stat]) === squash(part),
      );
      if (found === undefined) {
        throw new Error(`"${part}" is not a stat (use Attack, Defense, Sp. Atk, Sp. Def, Speed, Accuracy, Evasion)`);
      }
      return found.stat;
    });
  },
  fromInstance: raw => {
    if (!Array.isArray(raw) || raw.length === 0) {
      return;
    }
    const words = raw.map(item => STAT_WORDS.find(entry => entry.stat === item)?.word);
    return words.every((word): word is string => word !== undefined) ? words.join(", ") : undefined;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Which move properties are blocked (MoveFlagImmunityAbAttr). The class keeps an array of MoveFlags bits in the order given.

const FLAG_WORDS: readonly (readonly [keyof typeof MoveFlags, string])[] = [
  ["MAKES_CONTACT", "Contact moves"],
  ["SOUND_BASED", "Sound moves"],
  ["BITING_MOVE", "Biting moves"],
  ["PULSE_MOVE", "Pulse moves"],
  ["PUNCHING_MOVE", "Punching moves"],
  ["SLICING_MOVE", "Slicing moves"],
  ["RECKLESS_MOVE", "Reckless moves"],
  ["BALLBOMB_MOVE", "Ball and bomb moves"],
  ["POWDER_MOVE", "Powder moves"],
  ["DANCE_MOVE", "Dance moves"],
  ["WIND_MOVE", "Wind moves"],
  ["TRIAGE_MOVE", "Triage moves"],
  ["AIR_BASED", "Air and wing moves"],
  ["ARROW_BASED", "Arrow moves"],
  ["BONE_BASED", "Bone moves"],
  ["DRILL_BASED", "Drill moves"],
  ["FIELD_BASED", "Field moves"],
  ["HAMMER_BASED", "Hammer moves"],
  ["HORN_BASED", "Horn moves"],
  ["KICKING_MOVE", "Kicking moves"],
  ["LUNAR_MOVE", "Lunar moves"],
  ["THROW_BASED", "Throwing moves"],
  ["WEATHER_BASED", "Weather moves"],
];

const flagTable = MoveFlags as unknown as Record<string, number>;

/** Every move property staff can block, as player words. */
export const MOVE_PROPERTY_OPTIONS: readonly string[] = FLAG_WORDS.map(([, word]) => word);

export const movePropertyListCodec: ParamCodec = {
  toCtor: value => {
    const parts = splitList(value);
    if (parts.length === 0) {
      throw new Error("pick at least one move property to block");
    }
    return parts.map(part => {
      const found = FLAG_WORDS.find(([name, word]) => squash(word) === squash(part) || squash(name) === squash(part));
      if (found === undefined) {
        throw new Error(`"${part}" is not a move property staff can pick here`);
      }
      const bit = flagTable[found[0]];
      if (typeof bit !== "number") {
        throw new Error(`the game has no move property called "${part}"`);
      }
      return bit;
    });
  },
  fromInstance: raw => {
    if (!Array.isArray(raw) || raw.length === 0) {
      return;
    }
    const words = raw.map(item => FLAG_WORDS.find(([name]) => flagTable[name] === item)?.[1]);
    return words.every((word): word is string => word !== undefined) ? words.join(", ") : undefined;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Which moves may steal (ChancePostAttackStealHeldItemAbAttr). Empty text means "any move" and leaves the option out.

const moveTable = MoveId as unknown as Record<string, number>;

export const moveNameListCodec: ParamCodec = {
  toCtor: value => {
    const parts = splitList(value);
    if (parts.length === 0) {
      return;
    }
    return parts.map(part => {
      const key = Object.keys(moveTable).find(name => Number.isNaN(Number(name)) && squash(name) === squash(part));
      if (key === undefined) {
        throw new Error(`"${part}" is not the name of a move`);
      }
      return moveTable[key];
    });
  },
  fromInstance: raw => {
    if (raw === undefined) {
      return "";
    }
    if (!Array.isArray(raw)) {
      return;
    }
    const names = raw.map(item => {
      const key = typeof item === "number" ? MoveId[item] : undefined;
      return key === undefined ? undefined : playerName(key);
    });
    return names.every((name): name is string => name !== undefined) ? names.join(", ") : undefined;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// What happens to the Pokemon that knocked me out (OnDirectFaintRetaliationAbAttr). The class takes one of two move ids.

const RETALIATIONS = [
  { word: "Stop it using the same move twice in a row", moveId: MoveId.TORMENT },
  { word: "Switch off its ability", moveId: MoveId.GASTRO_ACID },
] as const;

export const RETALIATION_OPTIONS: readonly string[] = RETALIATIONS.map(entry => entry.word);

export const retaliationCodec: ParamCodec = {
  toCtor: value => {
    const found = RETALIATIONS.find(entry => entry.word === value);
    if (found === undefined) {
      throw new Error(`"${String(value)}" is not one of: ${RETALIATION_OPTIONS.join("; ")}`);
    }
    return found.moveId;
  },
  fromInstance: raw => RETALIATIONS.find(entry => entry.moveId === raw)?.word,
};

// ---------------------------------------------------------------------------------------------------------------
// A pick from a fixed list of (player words, constructor text) pairs, for the runtime-role marker (AbilityStudioRuntimeCapabilityAbAttr).
// The constructor takes the role's own id text ("levitate-float"); staff pick the sentence that says what the role does.

export interface RolePick {
  readonly id: string;
  readonly word: string;
}

export function rolePickCodec(picks: readonly RolePick[]): ParamCodec {
  return {
    toCtor: value => {
      const found = picks.find(entry => entry.word === value);
      if (found === undefined) {
        throw new Error(`"${String(value)}" is not one of the game rules staff can pick here`);
      }
      return found.id;
    },
    fromInstance: raw => picks.find(entry => entry.id === raw)?.word,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// A field effect on my own side (the two Snow Cloak classes). ArenaTagType is a string enum, so the staff value and the constructor
// value are the same text; an unknown name is refused.

const FIELD_EFFECT_NAMES = ["AURORA_VEIL", "REFLECT", "LIGHT_SCREEN", "TAILWIND", "MIST", "SAFEGUARD"].filter(
  name => name in ArenaTagType,
);

/** The field effects staff can pick for a side. */
export const FIELD_EFFECT_OPTIONS: readonly string[] = FIELD_EFFECT_NAMES;

export const fieldEffectCodec: ParamCodec = {
  toCtor: value => {
    const name = String(value);
    if (!FIELD_EFFECT_NAMES.includes(name)) {
      throw new Error(`"${name}" is not a field effect staff can pick here`);
    }
    return ArenaTagType[name as keyof typeof ArenaTagType];
  },
  fromInstance: raw => (typeof raw === "string" && FIELD_EFFECT_NAMES.includes(raw) ? raw : undefined),
};
