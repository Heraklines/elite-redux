/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-damage-force-attacker-out` archetype.
//
// Forces the ATTACKER out when the holder is hit by an attacking move, once per
// switch-in. This is distinct from vanilla Wimp Out / Emergency Exit
// (PostDamageForceSwitchAbAttr), which switches the HOLDER out - the bug behind
// the live report that Gooschase's signature "acts like Wimp Out".
//
// Wires (ER 2.65 dex):
//   - 690 Restraining Order — "Forces the attacker out when hit, once each
//     switch-in." (Gooschase signature)
//   - 864 Chuckster — "...force out the attacker." (paired with its once-per-
//     entry contact damage reduction, wired separately in the dispatcher).
//
// The once-per-switch-in gate lives on `summonData.forceAttackerOutUsed`, which
// resets on every send-out (matching "once each switch-in").
// =============================================================================

import { ForceSwitchOutHelper, PostDamageAbAttr, type PostDamageAbAttrParams } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { SwitchType } from "#enums/switch-type";

export class PostDamageForceAttackerOutAbAttr extends PostDamageAbAttr implements GatedAttr<PostDamageAbAttrParams> {
  private readonly helper = new ForceSwitchOutHelper(SwitchType.SWITCH);

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostDamageAbAttrParams) => boolean) | undefined;

  // contactRequired gates the force-out to CONTACT moves only (Chuckster 864).
  // Restraining Order (690) leaves it false - it forces out on ANY hit.
  constructor(private readonly contactRequired = false) {
    super();
  }

  /**
   * Tier B split (ability studio spec 3.1), in the original clause order: `guards` (a living foe hit me, once per
   * switch-in, the damage came from its attack), `gate` (the move makes contact, when `contactRequired`), `residual` (the
   * attacker can be switched out). No `prepare`, no random draw.
   */
  override canApply(params: PostDamageAbAttrParams): boolean {
    return gatedCanApply<PostDamageAbAttrParams>(this, params);
  }

  /** Safety rules that come first. Moved verbatim out of the old `canApply`. */
  public guards({ pokemon, source }: PostDamageAbAttrParams): boolean {
    // Need a living opposing attacker, and the holder must still be on the field.
    if (!source || source === pokemon || source.isFainted() || pokemon.isFainted()) {
      return false;
    }
    if (!pokemon.isOpponent(source)) {
      return false;
    }
    // Once per switch-in.
    if (pokemon.summonData.forceAttackerOutUsed) {
      return false;
    }
    // Only react to the attacker's own offensive move - not weather, hazards,
    // status DoT, or the holder's self-inflicted damage.
    const lastMove = source.getLastXMoves()[0];
    if (!lastMove || lastMove.move === MoveId.NONE || allMoves[lastMove.move]?.category === MoveCategory.STATUS) {
      return false;
    }
    return true;
  }

  /**
   * The replaceable condition. Chuckster (contactRequired): only the first CONTACT hit per entry forces
   * out - non-contact attacks must not trigger it. Its damage-halving half is
   * likewise contact-gated, so the two fire together on that same hit.
   */
  public gate({ pokemon, source }: PostDamageAbAttrParams): boolean {
    const lastMove = source?.getLastXMoves()[0];
    if (
      this.contactRequired
      && !allMoves[lastMove?.move as MoveId]?.doesFlagEffectApply({
        flag: MoveFlags.MAKES_CONTACT,
        user: source as NonNullable<typeof source>,
        target: pokemon,
      })
    ) {
      return false;
    }
    return true;
  }

  /**
   * Feasibility that stays in the class: respect the standard force-switch eligibility (trapping, last mon, etc.) -
   * here the ATTACKER is the one being switched out.
   */
  public residual({ pokemon, source }: PostDamageAbAttrParams): boolean {
    return this.helper.getSwitchOutCondition(source as NonNullable<typeof source>, pokemon);
  }

  override apply({ pokemon, source, simulated }: PostDamageAbAttrParams): void {
    if (simulated || !source) {
      return;
    }
    pokemon.summonData.forceAttackerOutUsed = true;
    this.helper.switchOutLogic(source);
  }
}
