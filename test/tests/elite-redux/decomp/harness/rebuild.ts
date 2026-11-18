/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Rebuilds ability A as A' from its own decomposed blocks (spec section 4, L2 item 1).
//
// Every attr that has a declaration is rebuilt by `recomposeAttr` (fresh instance, real constructor,
// library conditions from the bindings). An attr without a declaration, or whose bindings are missing,
// is CARRIED over unchanged and listed, so a twin run never pretends a half-decomposed ability was
// verified: the result says how many attrs were really rebuilt.
//
// A' lives under a test-only shadow id in the 29000-29999 band (blueprints use 20000-29999, the test
// shadows stay at the top of it) and takes the original's name and description, so trigger messages
// compare equal.

import type { AbAttr } from "#abilities/ab-attrs";
import { AbBuilder, type Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import type { CondInput } from "#data/elite-redux/ability-studio/build-attr";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import type { DeclRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { ParamValues } from "#data/elite-redux/ability-studio/vocabulary/params";
import { AbilityId } from "#enums/ability-id";

export const SHADOW_ID_BASE = 29000;

export interface AttrOverride {
  readonly params?: ParamValues;
  readonly conds?: Readonly<Record<string, CondInput>>;
  /** Replace the rebuilt attr by this one (used by self-tests to inject a deliberately altered rebuild). */
  readonly replaceWith?: (original: AbAttr) => AbAttr;
}

export interface RebuildOptions {
  readonly registry: DeclRegistry;
  /** Per attr index overrides. */
  readonly overrides?: Readonly<Record<number, AttrOverride>>;
  /** Drop the attr at these indices (self-tests). */
  readonly drop?: readonly number[];
}

export interface RebuildResult {
  readonly ability: Ability;
  /** attr indices rebuilt from declarations. */
  readonly rebuilt: readonly number[];
  /** attr indices carried over: no declaration, or the declaration could not be applied. */
  readonly carried: readonly { readonly attrIndex: number; readonly className: string; readonly reason: string }[];
}

function builderFlagsOf(ability: Ability): number {
  return (ability as unknown as { flags: number }).flags;
}

/** Builds A' under `shadowId`. Does not register it; see `registerShadow`. */
export function rebuildAbility(original: Ability, shadowId: number, options: RebuildOptions): RebuildResult {
  const builder = new AbBuilder(shadowId as AbilityId, original.generation, original.postSummonPriority);
  builder.flags = builderFlagsOf(original);
  builder.conditions.push(...original.conditions);
  const rebuilt: number[] = [];
  const carried: { attrIndex: number; className: string; reason: string }[] = [];
  original.attrs.forEach((attr, attrIndex) => {
    if (options.drop?.includes(attrIndex)) {
      return;
    }
    const override = options.overrides?.[attrIndex];
    if (override?.replaceWith !== undefined) {
      builder.attrs.push(override.replaceWith(attr));
      rebuilt.push(attrIndex);
      return;
    }
    const module = options.registry.get(attr.constructor.name);
    if (module === undefined) {
      carried.push({ attrIndex, className: attr.constructor.name, reason: "the class has no declaration" });
      builder.attrs.push(attr);
      return;
    }
    try {
      builder.attrs.push(
        recomposeAttr(module, attr, original.id, attrIndex, {
          ...(override?.params === undefined ? {} : { params: override.params }),
          ...(override?.conds === undefined ? {} : { conds: override.conds }),
        }),
      );
      rebuilt.push(attrIndex);
    } catch (error) {
      carried.push({ attrIndex, className: attr.constructor.name, reason: (error as Error).message });
      builder.attrs.push(attr);
    }
  });
  const ability = builder.build();
  Object.defineProperty(ability, "name", { value: original.name, configurable: true, enumerable: true });
  Object.defineProperty(ability, "description", {
    value: original.description,
    configurable: true,
    enumerable: true,
  });
  return { ability, rebuilt, carried };
}

const registered = new Map<number, Ability | undefined>();

/** Puts A' into the live ability list. Pair with `unregisterShadows` in afterEach. */
export function registerShadow(shadowId: number, ability: Ability): void {
  const list = allAbilities as Ability[];
  if (!registered.has(shadowId)) {
    registered.set(shadowId, list[shadowId]);
  }
  list[shadowId] = ability;
  (AbilityId as unknown as Record<number, string>)[shadowId] = `SHADOW_${shadowId}`;
}

export function unregisterShadows(): void {
  const list = allAbilities as Ability[];
  for (const [id, previous] of registered) {
    if (previous === undefined) {
      delete list[id];
    } else {
      list[id] = previous;
    }
    delete (AbilityId as unknown as Record<number, string>)[id];
  }
  registered.clear();
}
