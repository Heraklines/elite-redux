/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER custom held-item persistence registry.
//
// The save LOAD path (GameData -> ModifierData.toModifier) reconstructs every
// held item with `Modifier[className]` - a lookup in the `#modifiers/modifier`
// module's exports. ER's custom held-item classes live OUTSIDE that module, so
// that lookup returned `undefined`, `Reflect.construct(undefined, ...)` threw,
// and the item was silently dropped: ER gems / terrain seeds / reactive items /
// resist berries / ward stones / recreated Life Orb, Assault Vest, Rocky Helmet
// all VANISHED on a refresh or Continue (held on a mon AND on enemies).
//
// Register the classes here so the loader can resolve them by name. (Each class
// must also serialize its extra ctor args via getArgs() to round-trip - the
// classes with custom fields do.)
//
// NOTE: Resist Berries (#357) and Ward Stones (#358) are deliberately NOT here -
// they already restore via dedicated session side-channels (restoreErResistBerries
// / restoreErWardStones in GameData). Adding them here too would double-attach
// them on load.
// =============================================================================

import { ErGemModifier } from "#data/elite-redux/er-elemental-gems";
import { ErReactiveItemModifier } from "#data/elite-redux/er-reactive-items";
import { ErAssaultVestModifier, ErLifeOrbModifier, ErRockyHelmetModifier } from "#data/elite-redux/er-recreated-items";
import { ErSeedModifier } from "#data/elite-redux/er-terrain-seeds";
import type { PersistentModifier } from "#modifiers/modifier";

/** ER custom PersistentModifier subclasses, keyed by class name. */
const ER_PERSISTENT_MODIFIER_CLASSES: Record<string, new (...args: any[]) => PersistentModifier> = {
  ErGemModifier,
  ErReactiveItemModifier,
  ErSeedModifier,
  ErLifeOrbModifier,
  ErAssaultVestModifier,
  ErRockyHelmetModifier,
};

/**
 * Resolve an ER custom held-item class by its serialized class name, for the
 * save load path. Returns `undefined` for non-ER class names (the caller falls
 * back to the vanilla `Modifier[className]` lookup).
 */
export function resolveErModifierClass(className: string): (new (...args: any[]) => PersistentModifier) | undefined {
  return ER_PERSISTENT_MODIFIER_CLASSES[className];
}
