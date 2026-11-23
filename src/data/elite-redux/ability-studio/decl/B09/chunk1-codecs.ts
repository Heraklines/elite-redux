/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B09 chunk 1. Codecs for EntryTrapOnFoeSideAbAttr (a helper, not a declaration: the registry only collects `*.decl.ts` and
// `bindings.ts`). The class takes a BattlerTagType name and the string "foe" or "self"; staff see plain words.
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { BattlerTagType } from "#enums/battler-tag-type";

/** Battle effects a trap can hand to the Pokemon it catches, by the words a player uses. */
export const TRAP_EFFECT_CHOICES: Readonly<Record<string, BattlerTagType>> = {
  Infestation: BattlerTagType.INFESTATION,
  Confusion: BattlerTagType.CONFUSED,
  Taunt: BattlerTagType.TAUNT,
  Torment: BattlerTagType.TORMENT,
  "Heal Block": BattlerTagType.HEAL_BLOCK,
  Drowsiness: BattlerTagType.DROWSY,
};

export const TRAP_EFFECT_OPTIONS: readonly string[] = Object.keys(TRAP_EFFECT_CHOICES);

/** appliedTag (BattlerTagType name) <-> "Infestation". A value outside the list is not representable (undefined). */
export const trapEffectCodec: ParamCodec = {
  toCtor: value => {
    const resolved = TRAP_EFFECT_CHOICES[String(value)];
    if (resolved === undefined) {
      throw new Error(`"${String(value)}" is not a battle effect a trap can give`);
    }
    return resolved;
  },
  fromInstance: raw => Object.keys(TRAP_EFFECT_CHOICES).find(name => TRAP_EFFECT_CHOICES[name] === raw),
};

export const TRAP_SIDE_FOE = "The opposing side";
export const TRAP_SIDE_SELF = "My own side";
export const TRAP_SIDE_OPTIONS: readonly string[] = [TRAP_SIDE_FOE, TRAP_SIDE_SELF];

/** side ("foe" | "self") <-> "The opposing side" | "My own side". */
export const trapSideCodec: ParamCodec = {
  toCtor: value => {
    if (value === TRAP_SIDE_FOE) {
      return "foe";
    }
    if (value === TRAP_SIDE_SELF) {
      return "self";
    }
    throw new Error(`"${String(value)}" is not a side the trap can be laid on`);
  },
  fromInstance: raw => (raw === "foe" ? TRAP_SIDE_FOE : raw === "self" ? TRAP_SIDE_SELF : undefined),
};
