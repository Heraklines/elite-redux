/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `coward-once-protect` archetype.
//
// PostSummon hook that adds the PROTECTED battler tag to the holder once
// per battle. ER's Coward ability ("Sets up Protect on switch-in. Only
// works once") needs this single-use semantics — a naive PostSummon
// would re-fire on every switch-in.
//
// We track the "used" state via a Symbol on the pokemon instance (so it
// survives switch-out/in but is reset on a new battle/wave when the
// pokemon is reconstructed). For runs that persist through saves, this
// resets on session reload — matches ER's "once per battle" intent
// closely enough that the UI/effect parity feels right.
// =============================================================================

import { type AbAttrBaseParams, PostSummonAbAttr } from "#abilities/ab-attrs";
import { BattlerTagType } from "#enums/battler-tag-type";

const USED_FLAG = Symbol("CowardOnceProtect.used");

export class CowardOnceProtectAbAttr extends PostSummonAbAttr {
  constructor() {
    super(true);
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return !((pokemon as unknown as Record<symbol, boolean>)[USED_FLAG]);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    (pokemon as unknown as Record<symbol, boolean>)[USED_FLAG] = true;
    pokemon.addTag(BattlerTagType.PROTECTED, 1);
  }
}
