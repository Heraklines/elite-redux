/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 4: the player words that stand for engine values in the declarations of this chunk. Not a declaration, so the
// registry (which only collects `*.decl.ts` and `bindings.ts`) does not load it.
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import { wordsCodec } from "./chunk2-codecs";

/** The stats a Pokemon attacks with or defends with, in player words. */
export const OFFENSE_STAT_WORDS = {
  Attack: Stat.ATK,
  Defense: Stat.DEF,
  "Sp. Atk": Stat.SPATK,
  "Sp. Def": Stat.SPDEF,
  Speed: Stat.SPD,
} as const;

export const offenseStatCodec = wordsCodec(OFFENSE_STAT_WORDS, "stat");

/** "Every stat" is how staff say "no single protected stat" (the class stores `undefined`). */
export const EVERY_STAT = "Every stat";

const STAT_WORDS_WITH_ACCURACY = {
  Attack: Stat.ATK,
  Defense: Stat.DEF,
  "Sp. Atk": Stat.SPATK,
  "Sp. Def": Stat.SPDEF,
  Speed: Stat.SPD,
  Accuracy: Stat.ACC,
  Evasion: Stat.EVA,
} as const;

export const PROTECTED_STAT_CHOICES: readonly string[] = [EVERY_STAT, ...Object.keys(STAT_WORDS_WITH_ACCURACY)];

/** "Every stat" <-> undefined, otherwise one stat by its player name. */
export const protectedStatCodec: ParamCodec = {
  toCtor: value => {
    if (value === EVERY_STAT) {
      return;
    }
    if (!Object.hasOwn(STAT_WORDS_WITH_ACCURACY, String(value))) {
      throw new Error(`"${String(value)}" is not a known stat`);
    }
    return STAT_WORDS_WITH_ACCURACY[String(value) as keyof typeof STAT_WORDS_WITH_ACCURACY];
  },
  fromInstance: raw => {
    if (raw === undefined || raw === null) {
      return EVERY_STAT;
    }
    return Object.keys(STAT_WORDS_WITH_ACCURACY).find(
      word => STAT_WORDS_WITH_ACCURACY[word as keyof typeof STAT_WORDS_WITH_ACCURACY] === raw,
    );
  },
};

/** Which of my two attacking stats decides the category: the class stores a boolean (`useHigherStat`). */
export const LOWER_STAT = "The lower one";
export const HIGHER_STAT = "The higher one";
export const lowerOrHigherCodec = wordsCodec({ [LOWER_STAT]: false, [HIGHER_STAT]: true }, "choice");

/** "Surf", "surf", "Mud Bomb", "MUD_BOMB" all name a move; the class wants the move id. */
function moveKey(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
}

function titleOf(key: string): string {
  const words = key.toLowerCase().split("_");
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(" ");
}

export const moveNameCodec: ParamCodec = {
  toCtor: value => {
    const resolved = (MoveId as unknown as Record<string, string | number>)[moveKey(String(value))];
    if (typeof resolved !== "number" || resolved === MoveId.NONE) {
      throw new Error(`"${String(value)}" is not a known move name`);
    }
    return resolved;
  },
  fromInstance: raw => {
    if (typeof raw !== "number") {
      return;
    }
    const key = Object.keys(MoveId).find(name => Number.isNaN(Number(name)) && (MoveId as never)[name] === raw);
    return key === undefined ? undefined : titleOf(key);
  },
};
