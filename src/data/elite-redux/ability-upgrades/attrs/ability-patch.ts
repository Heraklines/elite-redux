/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { AbAttr } from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";

const APPLIED_PATCH_KEYS = Symbol.for("elite-redux/ability-upgrades/applied-patch-keys");

type PatchableAbility = Ability & {
  attrs: AbAttr[];
  [APPLIED_PATCH_KEYS]?: Set<string>;
};

export type AbilityAttrFactory = () => AbAttr;

function getAppliedPatchKeys(ability: PatchableAbility): Set<string> {
  const current = ability[APPLIED_PATCH_KEYS];
  if (current) {
    return current;
  }

  const keys = new Set<string>();
  Object.defineProperty(ability, APPLIED_PATCH_KEYS, {
    configurable: false,
    enumerable: false,
    value: keys,
    writable: false,
  });
  return keys;
}

function buildPatchAttrs(factories: readonly AbilityAttrFactory[]): AbAttr[] {
  return factories.map(factory => factory());
}

/** Append an ability upgrade once under a stable patch key. */
export function appendAbilityAttrsOnce(
  ability: Ability,
  patchKey: string,
  factories: readonly AbilityAttrFactory[],
): boolean {
  const target = ability as PatchableAbility;
  const keys = getAppliedPatchKeys(target);
  if (keys.has(patchKey)) {
    return false;
  }

  const attrs = buildPatchAttrs(factories);
  target.attrs.push(...attrs);
  keys.add(patchKey);
  return true;
}

/** Replace an ability's attributes once under a stable patch key. */
export function replaceAbilityAttrsOnce(
  ability: Ability,
  patchKey: string,
  factories: readonly AbilityAttrFactory[],
): boolean {
  const target = ability as PatchableAbility;
  const keys = getAppliedPatchKeys(target);
  if (keys.has(patchKey)) {
    return false;
  }

  const attrs = buildPatchAttrs(factories);
  target.attrs.splice(0, target.attrs.length, ...attrs);
  keys.add(patchKey);
  return true;
}

/** Replace the first matching ability attribute once under a stable patch key. */
export function replaceMatchingAbilityAttrOnce(
  ability: Ability,
  patchKey: string,
  predicate: (attr: AbAttr) => boolean,
  factory: AbilityAttrFactory,
): boolean {
  const target = ability as PatchableAbility;
  const keys = getAppliedPatchKeys(target);
  if (keys.has(patchKey)) {
    return false;
  }

  const index = target.attrs.findIndex(predicate);
  if (index < 0) {
    return false;
  }

  target.attrs[index] = factory();
  keys.add(patchKey);
  return true;
}
