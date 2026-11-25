/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PostSummonAbAttr, PostTurnAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";
import { toDmgValue } from "#utils/common";

export interface FirstEntryPartyHealOptions {
  /** Stable per-ability key used by the once-per-battle tracker. */
  readonly key: string;
  readonly healFraction: number;
}

function validateHealFraction(owner: string, fraction: number): void {
  if (!(fraction > 0 && fraction <= 1)) {
    throw new Error(`[${owner}] healFraction must be in (0, 1]; got ${fraction}`);
  }
}

function partyFor(pokemon: Pokemon): Pokemon[] {
  return pokemon.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
}

function isLivingAndDamaged(pokemon: Pokemon): boolean {
  return !pokemon.isFainted() && pokemon.hp > 0 && !pokemon.isFullHp();
}

function queueOrApplyHeal(target: Pokemon, amount: number): void {
  if (target.isOnField() && target.isActive(true)) {
    globalScene.phaseManager.unshiftNew("PokemonHealPhase", target.getBattlerIndex(), amount, null, true);
    return;
  }

  target.heal(amount);
  target.updateInfo();
}

/** Heals the whole party on the holder's first switch-in of the battle. */
export class FirstEntryPartyHealAbAttr extends PostSummonAbAttr {
  private readonly key: string;
  private readonly healFraction: number;

  constructor(options: FirstEntryPartyHealOptions) {
    super(true);
    if (options.key.trim().length === 0) {
      throw new Error("[FirstEntryPartyHealAbAttr] key must be non-empty");
    }
    validateHealFraction("FirstEntryPartyHealAbAttr", options.healFraction);
    this.key = `ability-upgrade:first-entry-party-heal:${options.key}`;
    this.healFraction = options.healFraction;
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: AbAttrBaseParams) => boolean) | undefined;

  /** Tier B split (ability studio spec 3.1): the whole original `canApply` is the replaceable gate; no guards, no residual. */
  override canApply(params: AbAttrBaseParams): boolean {
    return gatedCanApply<AbAttrBaseParams>(this, params);
  }

  /** The replaceable condition: this ability has not fired its first-entry heal yet this wave. Moved verbatim from the old `canApply`. */
  public gate({ pokemon }: AbAttrBaseParams): boolean {
    return !pokemon.waveData.entryEffectsFired.has(this.key);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    // With a compiled gate (`gateOverride`) the memory belongs to the gate: its commit has already written the key by the
    // time this runs, so testing the key a second time here would swallow the heal. Without one, behaviour is unchanged.
    if (simulated || (this.gateOverride === undefined && pokemon.waveData.entryEffectsFired.has(this.key))) {
      return;
    }

    pokemon.waveData.entryEffectsFired.add(this.key);
    for (const member of partyFor(pokemon)) {
      if (!isLivingAndDamaged(member)) {
        continue;
      }
      queueOrApplyHeal(member, toDmgValue(member.getMaxHp() * this.healFraction));
    }
  }
}

/** End-of-turn recovery for the holder and each adjacent ally while active. */
export class HolderAndAlliesRecoveryAbAttr extends PostTurnAbAttr {
  private readonly healFraction: number;

  constructor(healFraction: number) {
    super(false);
    validateHealFraction("HolderAndAlliesRecoveryAbAttr", healFraction);
    this.healFraction = healFraction;
  }

  private targets(pokemon: Pokemon): Pokemon[] {
    return [pokemon, ...pokemon.getAdjacentAllies()].filter(isLivingAndDamaged);
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return this.targets(pokemon).length > 0;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }

    for (const target of this.targets(pokemon)) {
      globalScene.phaseManager.unshiftNew(
        "PokemonHealPhase",
        target.getBattlerIndex(),
        toDmgValue(target.getMaxHp() * this.healFraction),
        null,
        true,
      );
    }
  }
}
