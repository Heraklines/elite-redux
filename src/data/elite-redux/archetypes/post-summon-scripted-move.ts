/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-summon-scripted-move` archetype.
//
// On switch-in (PostSummon hook), enqueue a scripted move targeting an
// available opponent. Used by abilities like:
//   - 479 Dust Cloud — "Attacks with Sand Attack on switch-in."
//   - 521 Phantom Thief — "Attacks with 40BP Spectral Thief on switch-in."
//   - 717 Wildfire — "Attacks with Fire Spin on entry."
//   - 718 Jumpscare — "Attacks with Astonish on first switch-in."
//   - 745 Sand Pit — "Attacks with 20BP Sand Tomb on switch-in."
//
// The "first switch-in" qualifier (Jumpscare) is enforced via PostSummonAbAttr's
// natural lifecycle — PostSummon fires once per send-out.
// =============================================================================

import { PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import type { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";

export interface PostSummonScriptedMoveOptions {
  /** Move to enqueue against an opponent on switch-in. */
  readonly moveId: MoveId;
  /**
   * Optional ER-specified base-power override (e.g. Phantom Thief's "40 BP
   * Spectral Thief"). Omit to use the move's registered full power.
   */
  readonly power?: number;
  /**
   * When `true`, the scripted move targets the HOLDER itself (and the on-entry
   * effect fires even with no opponent on the field). Required for self-side
   * buffs cast on entry — e.g. Air Blower's Tailwind — which would otherwise
   * never trigger when the holder is sent out first (no opponent yet).
   */
  readonly targetsSelf?: boolean;
  /**
   * When `true` (and not {@linkcode targetsSelf}), the scripted move is cast at
   * EVERY non-fainted opponent in a single MovePhase (spread), not just the
   * leftmost foe. Required for on-entry moves the ER dex says hit ALL opponents
   * — e.g. Web Spinner's String Shot ("harshly lowering the Speed of ALL
   * opponents by 2 stages"), which in doubles must lower both foes. No effect in
   * singles (there is only one opponent). Other users default to the historic
   * single-foe behavior.
   */
  readonly allOpponents?: boolean;
  /**
   * When `true`, the scripted cast bypasses the accuracy check (accuracy -1,
   * Swift/Aerial-Ace style) so it cannot miss or be evaded. Required for on-entry
   * moves the ER dex says "cannot miss / ignores accuracy checks" — e.g. Sand Pit
   * 745's Sand Tomb. Forwarded to {@linkcode scriptedPokemonMove}'s `alwaysHit`.
   */
  readonly alwaysHit?: boolean;
  readonly oncePerBattleKey?: string;
  /**
   * Cap the number of casts this battle (per wave). Requires
   * {@linkcode oncePerBattleKey} as the counter key. Used by Wishmaker
   * ("Uses Wish on switch-in. Three uses per battle." -> maxUsesPerBattle 3).
   */
  readonly maxUsesPerBattle?: number;
  /**
   * When `true`, strip {@linkcode MoveFlags.REFLECTABLE} from the scripted cast
   * so a Magic Bounce / Magic Coat opponent does NOT bounce it back onto the
   * holder. The ability forced this move onto the opponent — it must not behave
   * like a holder-chosen reflectable move. Used by Telekinetic (on-entry
   * Telekinesis): without this, a Magic-Bounce target reflected the real
   * Telekinesis back, levitating + always-hit-flagging the holder instead.
   */
  readonly nonReflectable?: boolean;
}

export class PostSummonScriptedMoveAbAttr extends PostSummonAbAttr {
  constructor(private readonly opts: PostSummonScriptedMoveOptions) {
    // showAbility = true (default): casting a scripted move on switch-in is a
    // discrete, player-visible activation, so the ability banner must flash —
    // matching vanilla convention for on-entry abilities (see the popup-display
    // defect class fixed alongside the counter-attack archetype).
    super();
  }

  /** The move this ability casts on switch-in. */
  public getMoveId(): MoveId {
    return this.opts.moveId;
  }

  /** The base-power override for the cast move, or `undefined` for the move's full power. */
  public getPower(): number | undefined {
    return this.opts.power;
  }

  /** Whether the on-entry cast targets EVERY opponent (Web Spinner) vs the leftmost foe. */
  public targetsAllOpponents(): boolean {
    return this.opts.allOpponents ?? false;
  }

  /** How many times this ability has cast (this wave), for the count-capped variant. */
  private countUses(pokemon: Pokemon): number {
    const prefix = `${this.opts.oncePerBattleKey}#`;
    let used = 0;
    for (const k of pokemon.waveData.entryEffectsFired) {
      if (k.startsWith(prefix)) {
        used++;
      }
    }
    return used;
  }

  override canApply(params: AbAttrBaseParams): boolean {
    const { pokemon, simulated } = params;
    if (simulated) {
      return true;
    }
    if (this.opts.oncePerBattleKey !== undefined) {
      // Count-capped variant (Wishmaker: 3/battle): count `key#N` markers.
      if (this.opts.maxUsesPerBattle !== undefined) {
        if (this.countUses(pokemon) >= this.opts.maxUsesPerBattle) {
          return false;
        }
      } else if (pokemon.waveData.entryEffectsFired.has(this.opts.oncePerBattleKey)) {
        return false;
      }
    }
    // Self-targeting buffs (Tailwind) fire regardless of who's on the field.
    if (this.opts.targetsSelf) {
      return true;
    }
    // Offensive on-entry moves need an opposing target on the field.
    const opponents = pokemon.getOpponents().filter(o => !o.isFainted());
    return opponents.length > 0;
  }

  override apply(params: AbAttrBaseParams): void {
    const { pokemon, simulated } = params;
    if (simulated) {
      return;
    }
    let targets: number[];
    if (this.opts.targetsSelf) {
      // Self-side move (e.g. Tailwind) — cast at the holder so it always lands,
      // even when the holder is sent out before any opponent.
      targets = [pokemon.getBattlerIndex()];
    } else {
      const opponents = pokemon.getOpponents().filter(o => !o.isFainted());
      if (opponents.length === 0) {
        return;
      }
      // ALL-opponents variant (Web Spinner) hits every living foe in one spread
      // cast; the default picks the first available opponent (leftmost in doubles).
      targets = this.opts.allOpponents ? opponents.map(o => o.getBattlerIndex()) : [opponents[0].getBattlerIndex()];
    }
    if (this.opts.oncePerBattleKey !== undefined) {
      if (this.opts.maxUsesPerBattle === undefined) {
        pokemon.waveData.entryEffectsFired.add(this.opts.oncePerBattleKey);
      } else {
        pokemon.waveData.entryEffectsFired.add(`${this.opts.oncePerBattleKey}#${this.countUses(pokemon)}`);
      }
    }
    // Self-targeting on-entry SET-UP casts (Air Blower's Tailwind, Let's Roll's
    // Defense Curl, …) must land regardless of flinch: they are ability-driven
    // entry effects, not the holder's chosen turn-move, so an opponent's own
    // on-entry flinch move (e.g. Jumpscare's Astonish, when it goes first) must NOT
    // be able to cancel them. INDIRECT is NOT ignore-status, so its MovePhase runs
    // firstFailureCheck()'s FLINCHED cancel; FOLLOW_UP IS ignore-status, skipping
    // that pre-move cancellation while still applying the move's effect. Offensive
    // on-entry casts keep INDIRECT (they target the foe; flinch on the holder may
    // legitimately interrupt an attack).
    const useMode = this.opts.targetsSelf ? MoveUseMode.FOLLOW_UP : MoveUseMode.INDIRECT;
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      pokemon,
      targets,
      scriptedPokemonMove(this.opts.moveId, this.opts.power, {
        nonReflectable: this.opts.nonReflectable ?? false,
        alwaysHit: this.opts.alwaysHit ?? false,
      }),
      useMode,
    );
  }
}
