/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - "tactical" held items (Expert Belt / Covert Cloak / Red Card /
// Eject Button).
//
// Mainline items ER uses (or that the maintainers approved) that PokeRogue
// didn't have:
//   - Expert Belt   - passive: the holder's super-effective moves deal x1.2
//                     damage (ER battle_util.c: >= 2.0 effectiveness -> 1.2).
//                     Never consumed. ER trainers carry it natively (id 314).
//   - Covert Cloak  - passive: protects the HOLDER from the additional effects
//                     of damaging moves (an item Shield Dust). Not in ER's GBA
//                     item enum - distribution is roguelite-side only.
//   - Red Card      - reactive: when the holder is hit by a damaging move and
//                     survives, the ATTACKER is dragged out and replaced by a
//                     random eligible party member. Single use (ER id 335).
//   - Eject Button  - reactive: when the holder is hit by a damaging move and
//                     survives, the HOLDER switches out (its player picks the
//                     replacement). Single use (ER id 338).
//
// Wired exactly like er-reactive-items.ts / er-elemental-gems.ts (the audited
// held-item template): self-contained class + runtime ModifierType factory with
// a PINNED type id (persistence from every grant path), getArgs() kind
// round-trip, er-persistent-modifiers registration for the save/coop loaders,
// standalone er-assets icons (er_expert_belt etc.) drawn holder-first on the
// item bar, PreventItemUseAbAttr (As One) + ER_ITEM_DISABLED gates on the
// consumable procs, and a Fetch lostItems tap when a single-use item fires.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { erIsHeldItemDisabled } from "#data/battler-tags";
import { BattleType } from "#enums/battle-type";
import { ModifierTier } from "#enums/modifier-tier";
import { SwitchType } from "#enums/switch-type";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import { type Modifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { ModifierType, PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { type NumberHolder, toDmgValue } from "#utils/common";

export type ErTacticalKind = "expertBelt" | "covertCloak" | "redCard" | "ejectButton";

/** ER battle_util.c HOLD_EFFECT_EXPERT_BELT: x1.2 when effectiveness >= 2.0. */
export const ER_EXPERT_BELT_MULTIPLIER = 1.2;

interface ErTacticalConfig {
  name: string;
  description: string;
  /** Standalone texture key (ROM / PokeAPI sprite hosted on er-assets, loaded in loading-scene). */
  icon: string;
  /** Rarity tier for distribution (shops / reward pools). */
  tier: ModifierTier;
  /** Consumed when its effect fires (Red Card / Eject Button). */
  singleUse: boolean;
}

export const ER_TACTICAL_CONFIG: Readonly<Record<ErTacticalKind, ErTacticalConfig>> = {
  expertBelt: {
    // ER dex: "A belt that boosts the power of super effective moves."
    name: "Expert Belt",
    description: "Boosts the power of the holder's super-effective moves by 20%.",
    icon: "er_expert_belt",
    tier: ModifierTier.ULTRA,
    singleUse: false,
  },
  covertCloak: {
    name: "Covert Cloak",
    description: "Protects the holder from the additional effects of moves.",
    icon: "er_covert_cloak",
    tier: ModifierTier.ROGUE,
    singleUse: false,
  },
  redCard: {
    // ER dex: "Switches out the foe if they hit the holder."
    name: "Red Card",
    description: "When the holder is hit by an attack, the attacker is switched out. Single use.",
    icon: "er_red_card",
    tier: ModifierTier.ULTRA,
    singleUse: true,
  },
  ejectButton: {
    // ER dex: "Switches out the user if they're hit by the foe."
    name: "Eject Button",
    description: "When the holder is hit by an attack, it switches out. Single use.",
    icon: "er_eject_button",
    tier: ModifierTier.GREAT,
    singleUse: true,
  },
};

/** A tactical held item (self-contained; see the header for per-kind effects). */
export class ErTacticalItemModifier extends PokemonHeldItemModifier {
  public readonly kind: ErTacticalKind;

  constructor(type: ModifierType, pokemonId: number, kind: ErTacticalKind, stackCount?: number) {
    super(type, pokemonId, stackCount);
    this.kind = kind;
  }

  /** Persist the tactical kind so the held item round-trips on save/load. */
  override getArgs(): unknown[] {
    return [...super.getArgs(), this.kind];
  }

  override matchType(modifier: Modifier): boolean {
    return modifier instanceof ErTacticalItemModifier && modifier.kind === this.kind;
  }

  override clone(): ErTacticalItemModifier {
    return new ErTacticalItemModifier(this.type, this.pokemonId, this.kind, this.stackCount);
  }

  override apply(): boolean {
    return true; // effects fire at their engine hooks, not via this channel
  }

  override getMaxHeldItemCount(): number {
    return 1;
  }

  override getIcon(forSummary?: boolean): Phaser.GameObjects.Container {
    if (forSummary) {
      return super.getIcon(forSummary);
    }
    // Item-bar layout matching the elemental gems / reactive items: the HOLDER's
    // Pokemon icon on the left, THEN the item's standalone er-assets sprite (it
    // is NOT in the items atlas, so draw it directly rather than via super).
    const container = globalScene.add.container(0, 0);
    const pokemon = this.getPokemon();
    if (pokemon) {
      const pokemonIcon = globalScene.addPokemonIcon(pokemon, -2, 10, 0, 0.5, undefined, true);
      container.add(pokemonIcon);
      container.setName(pokemon.id.toString());
    }
    const item = globalScene.add.sprite(16, 16, ER_TACTICAL_CONFIG[this.kind].icon);
    item.setScale(0.5);
    item.setOrigin(0, 0.5);
    container.add(item);
    const stackText = this.getIconStackText();
    if (stackText) {
      container.add(stackText);
    }
    return container;
  }
}

/** Build a runtime ModifierType for a tactical item (no load-order cycle). */
export function erTacticalItemType(kind: ErTacticalKind): ModifierType {
  const cfg = ER_TACTICAL_CONFIG[kind];
  const type = new PokemonHeldItemModifierType(
    "",
    cfg.icon,
    (t, args) => new ErTacticalItemModifier(t, (args[0] as Pokemon).id, kind),
  );
  // Pin the modifierTypeInitObj id so the item persists from EVERY grant path
  // (off-pool grants keep id="" -> typeId="" -> dropped on reload). See the gem
  // fix in er-elemental-gems.ts. "expertBelt" -> "ER_EXPERT_BELT".
  type.id = `ER_${kind.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
  Object.defineProperty(type, "name", { get: () => cfg.name, configurable: true });
  type.getDescription = () => cfg.description;
  // Pin the tier so the reward UI renders a ball sprite (undefined tier -> blank).
  type.setTier(cfg.tier);
  return type;
}

/** The holder's tactical item of `kind`, or undefined. */
function heldTacticalItem(holder: Pokemon, kind: ErTacticalKind): ErTacticalItemModifier | undefined {
  return holder
    .getHeldItems()
    .find((m): m is ErTacticalItemModifier => m instanceof ErTacticalItemModifier && m.kind === kind);
}

/**
 * Expert Belt hook (called from getAttackDamage beside the elemental-gem hook):
 * if the attacker holds an Expert Belt and this hit is super-effective
 * (effectiveness >= 2, mirroring ER's UQ_4_12(2.0) check), multiply the damage.
 * Passive - never consumed - so it applies to simulated calcs too (the AI sees
 * the boost it will actually deal, like Life Orb).
 */
export function erTryApplyExpertBelt(source: Pokemon, typeMultiplier: number, damage: NumberHolder): void {
  if (damage.value <= 0 || typeMultiplier < 2) {
    return;
  }
  const belt = heldTacticalItem(source, "expertBelt");
  if (!belt || erIsHeldItemDisabled(source, belt.type?.id)) {
    return;
  }
  damage.value = toDmgValue(damage.value * ER_EXPERT_BELT_MULTIPLIER);
}

/**
 * Covert Cloak check (consulted from Move.getMoveChance beside Shield Dust and
 * from the held-item flinch check): `true` when `target` holds a working Covert
 * Cloak, i.e. every additional effect a damaging move would inflict ON the
 * holder is suppressed. Passive - never consumed.
 */
export function erCovertCloakGuards(target: Pokemon): boolean {
  const cloak = heldTacticalItem(target, "covertCloak");
  return cloak != null && !erIsHeldItemDisabled(target, cloak.type?.id);
}

/**
 * Fire Red Card / Eject Button on the TARGET after it survives a damaging hit.
 * Called from the move-effect phase beside the reactive-item hook, on the LAST
 * strike of a multi-hit move only. Eject Button outprioritizes Red Card when
 * (in theory) both could fire on the same hit.
 */
export function erApplyTacticalSwitchOnHit(user: Pokemon, target: Pokemon, dealsDamage: boolean): void {
  if (!dealsDamage || !target.isActive(true) || user.turnData.hitsLeft > 1) {
    return;
  }
  // As One (Calyrex riders) prevents opponents from consuming held items - the
  // same gate the reactive items and gems use.
  if (target.getOpponents().some(opp => opp.hasAbilityWithAttr("PreventItemUseAbAttr"))) {
    return;
  }

  // --- Eject Button: the HOLDER leaves the field; its side picks the switch-in.
  const ejectButton = heldTacticalItem(target, "ejectButton");
  if (ejectButton && !erIsHeldItemDisabled(target, ejectButton.type?.id) && queueHolderEject(target)) {
    consumeTacticalItem(target, ejectButton);
    return; // Eject Button outprioritizes Red Card; only one switch effect fires
  }

  // --- Red Card: the ATTACKER is dragged out for a random eligible replacement.
  const redCard = heldTacticalItem(target, "redCard");
  if (
    redCard
    && !erIsHeldItemDisabled(target, redCard.type?.id)
    && user.isActive(true)
    && !user.hasAbilityWithAttr("ForceSwitchOutImmunityAbAttr")
    && queueAttackerDragOut(user)
  ) {
    consumeTacticalItem(target, redCard);
  }
}

/** Consume a fired single-use tactical item (+ Fetch lostItems ledger tap). */
function consumeTacticalItem(holder: Pokemon, item: ErTacticalItemModifier): void {
  globalScene.removeModifier(item, !holder.isPlayer());
  globalScene.updateModifiers(holder.isPlayer());
  // ER Fetch (er move 969) ledger: a consumed single-use item is a "lost item",
  // recorded by typeId so Fetch can rebuild it (same tap as the shattered gems).
  holder.battleData.lostItems.push({ typeId: item.type?.id ?? "" });
  globalScene.phaseManager.queueMessage(`${holder.getNameToRender()}'s ${ER_TACTICAL_CONFIG[item.kind].name} activated!`);
}

/**
 * Eject Button switch: the holder returns and its side chooses the replacement
 * (modal SwitchPhase for players, next-summon index for enemy trainers). Wild
 * holders have no bench - the button cannot fire (kept, not consumed).
 * Mirrors ForceSwitchOutHelper(SwitchType.SWITCH).switchOutLogic.
 */
function queueHolderEject(holder: Pokemon): boolean {
  if (holder.isPlayer()) {
    if (globalScene.getPlayerParty().filter(p => p.isAllowedInBattle() && !p.isOnField()).length === 0) {
      return false;
    }
    globalScene.phaseManager.queueDeferred("SwitchPhase", SwitchType.SWITCH, holder.getFieldIndex(), true, true);
    return true;
  }
  if (globalScene.currentBattle.battleType === BattleType.WILD) {
    return false; // a wild holder has nothing to switch into
  }
  if (globalScene.getEnemyParty().filter(p => p.isAllowedInBattle() && !p.isOnField()).length === 0) {
    return false;
  }
  const summonIndex = globalScene.currentBattle.trainer
    ? globalScene.currentBattle.trainer.getNextSummonIndex((holder as EnemyPokemon).trainerSlot)
    : 0;
  globalScene.phaseManager.queueDeferred(
    "SwitchSummonPhase",
    SwitchType.SWITCH,
    holder.getFieldIndex(),
    summonIndex,
    false,
    false,
  );
  return true;
}

/**
 * Red Card drag-out: the attacker is replaced by a RANDOM eligible party
 * member (seeded roll). Mirrors ForceSwitchOutAttr's FORCE_SWITCH branches,
 * including the co-op #811 own-bench restriction so a dragged player keeps
 * owning a field slot. A wild attacker is unaffected (mainline fleeing would
 * end the wave and eat its rewards - deliberately out of scope).
 */
function queueAttackerDragOut(attacker: Pokemon): boolean {
  if (attacker.isPlayer()) {
    const party = globalScene.getPlayerParty();
    const eligible: number[] = [];
    party.forEach((pokemon, index) => {
      if (pokemon.isAllowedInBattle() && !pokemon.isOnField()) {
        eligible.push(index);
      }
    });
    if (eligible.length === 0) {
      return false;
    }
    // Co-op (#811): restrict the forced roll to the dragged player's OWN bench
    // when possible, so one player never ends up owning both slots.
    let pool = eligible;
    if (globalScene.gameMode?.isCoop && attacker.coopOwner != null) {
      const sameOwner = eligible.filter(i => party[i].coopOwner === attacker.coopOwner);
      if (sameOwner.length > 0) {
        pool = sameOwner;
      }
    }
    const slotIndex = pool[attacker.randBattleSeedInt(pool.length)];
    globalScene.phaseManager.queueDeferred(
      "SwitchSummonPhase",
      SwitchType.FORCE_SWITCH,
      attacker.getFieldIndex(),
      slotIndex,
      false,
      true,
    );
    return true;
  }
  if (globalScene.currentBattle.battleType === BattleType.WILD) {
    return false;
  }
  const isPartnerTrainer = globalScene.currentBattle.trainer?.isPartner();
  const eligible: number[] = [];
  globalScene.getEnemyParty().forEach((pokemon, index) => {
    if (
      pokemon.isAllowedInBattle()
      && !pokemon.isOnField()
      && (!isPartnerTrainer || pokemon.trainerSlot === (attacker as EnemyPokemon).trainerSlot)
    ) {
      eligible.push(index);
    }
  });
  if (eligible.length === 0) {
    return false;
  }
  const slotIndex = eligible[attacker.randBattleSeedInt(eligible.length)];
  globalScene.phaseManager.queueDeferred(
    "SwitchSummonPhase",
    SwitchType.FORCE_SWITCH,
    attacker.getFieldIndex(),
    slotIndex,
    false,
    false,
  );
  return true;
}
