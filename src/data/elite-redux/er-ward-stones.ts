/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Ward Stones (#358) — charge-based "legendary resistance" held items.
//
// A Ward Stone INSTANTLY blocks crowd control before it lands (unlike a Lum
// Berry, which cures retroactively): externally-inflicted status conditions
// (sleep / paralysis / burn / poison / toxic), the ER statuses (Frostbite /
// Bleed / Fear), flinches, confusion and infatuation. Each block consumes one
// charge ("...the Ward Stone blocked it!").
//
// Tiers (maintainer spec, June 10):
//   - MINOR  Ward Stone: 1 charge max; an empty stone recharges its single
//     charge after 10 won waves. Trainer mons: 20% roll.
//   - GREATER Ward Stone: 2 charges max; an empty stone gains BOTH charges at
//     once after 15 won waves (never one-then-the-other). Trainer mons: 5%
//     roll, 25% on boss mons.
//   - PRIME  Ward Stone: 3 charges; BOSS-ONLY and NOT stealable. Guaranteed
//     (with all 3 charges) on the Primal Cascoon finale.
//
// Spawn gate: Hell from wave 100, Elite from wave 150, never in Ace. Enemy
// stones always spawn FULL. Minor/Greater are stealable like any held item,
// but a stone stolen onto a player's mon arrives EMPTY and must charge up
// (see BattleScene.tryTransferHeldItemModifier). Player stones (incl. their
// charge progress) persist via the session-save side channel, like the resist
// berries.
//
// Visuals: reskinned mega-stone icon at normal held-item size — Minor a pale
// translucent marble, Greater brighter/brilliant, Prime a pure ruby red.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { BattlerTagType } from "#enums/battler-tag-type";
import { StatusEffect } from "#enums/status-effect";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import { type Modifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { PokemonHeldItemModifierType } from "#modifiers/modifier-type";

export type ErWardStoneTier = "minor" | "greater" | "prime";

interface WardStoneConfig {
  name: string;
  maxCharges: number;
  /** Won waves an EMPTY stone needs before it refills (player-held only). */
  rechargeWaves: number;
  /** Items-atlas frame (a mega stone reskinned via tint). */
  icon: string;
  tint: number;
  alpha: number;
  stealable: boolean;
}

export const ER_WARD_STONE_CONFIG: Readonly<Record<ErWardStoneTier, WardStoneConfig>> = {
  minor: {
    name: "Minor Ward Stone",
    maxCharges: 1,
    rechargeWaves: 10,
    icon: "absolite",
    tint: 0xbfe8ff, // pale translucent ice-blue marble
    alpha: 0.92,
    stealable: true,
  },
  greater: {
    name: "Greater Ward Stone",
    maxCharges: 2,
    rechargeWaves: 15,
    icon: "absolite",
    tint: 0x52e8ff, // brighter, more brilliant cyan
    alpha: 1,
    stealable: true,
  },
  prime: {
    name: "Prime Ward Stone",
    maxCharges: 3,
    rechargeWaves: 20,
    icon: "absolite",
    tint: 0xff2746, // pure ruby red
    alpha: 1,
    stealable: false,
  },
};

const TIER_ORDER: readonly ErWardStoneTier[] = ["minor", "greater", "prime"];

/** Spawn gate per difficulty: earliest wave Ward Stones may appear (never in Ace). */
const SPAWN_FROM_WAVE: Readonly<Record<string, number>> = { hell: 100, elite: 150 };

/**
 * CC battler tags a Ward Stone blocks: vanilla volatile CC (flinch, confusion,
 * infatuation), move-locking CC (Encore / Taunt / Disable / Torment) and the
 * ER statuses (Frostbite / Bleed / Fear). Trapping (Wrap/Bind) is deliberately
 * NOT blocked — chip-damage binds would waste charges on non-disabling effects.
 */
export const ER_WARD_BLOCKED_TAGS: ReadonlySet<BattlerTagType> = new Set([
  BattlerTagType.FLINCHED,
  BattlerTagType.CONFUSED,
  BattlerTagType.INFATUATED,
  BattlerTagType.ENCORE,
  BattlerTagType.TAUNT,
  BattlerTagType.DISABLED,
  BattlerTagType.TORMENT,
  BattlerTagType.ER_FROSTBITE,
  BattlerTagType.ER_BLEED,
  BattlerTagType.ER_FEAR,
]);

/**
 * Held-item modifier with charges. `charges`/`waveProgress` are mutable run
 * state (serialised through the ER session side channel for player mons).
 */
export class ErWardStoneModifier extends PokemonHeldItemModifier {
  public readonly tier: ErWardStoneTier;
  public charges: number;
  public waveProgress: number;

  constructor(
    type: PokemonHeldItemModifierType,
    pokemonId: number,
    tier: ErWardStoneTier,
    charges?: number,
    waveProgress?: number,
    stackCount?: number,
  ) {
    super(type, pokemonId, stackCount);
    this.tier = tier;
    const cfg = ER_WARD_STONE_CONFIG[tier];
    this.charges = charges ?? cfg.maxCharges;
    this.waveProgress = waveProgress ?? 0;
    this.isTransferable = cfg.stealable;
  }

  matchType(modifier: Modifier): boolean {
    return modifier instanceof ErWardStoneModifier && modifier.tier === this.tier;
  }

  clone(): ErWardStoneModifier {
    return new ErWardStoneModifier(
      this.type as PokemonHeldItemModifierType,
      this.pokemonId,
      this.tier,
      this.charges,
      this.waveProgress,
      this.stackCount,
    );
  }

  override getArgs(): unknown[] {
    return [...super.getArgs(), this.tier, this.charges, this.waveProgress];
  }

  /** No passive battle effect — charges are consumed via consumeCharge(). */
  override apply(): boolean {
    return true;
  }

  getMaxHeldItemCount(): number {
    return 1;
  }

  /** A freshly stolen stone arrives empty and must charge over won waves. */
  drainCharges(): void {
    this.charges = 0;
    this.waveProgress = 0;
  }

  /** Spend one charge; returns false when empty. */
  consumeCharge(): boolean {
    if (this.charges <= 0) {
      return false;
    }
    this.charges--;
    return true;
  }

  /** Tier reskin: tint the mega-stone sprite + show remaining charges. */
  override getIcon(forSummary?: boolean): Phaser.GameObjects.Container {
    const container = super.getIcon(forSummary);
    const cfg = ER_WARD_STONE_CONFIG[this.tier];
    for (const child of container.list) {
      if (child instanceof Phaser.GameObjects.Sprite && child.texture?.key === "items") {
        child.setTint(cfg.tint);
        child.setAlpha(cfg.alpha);
      }
    }
    if (!forSummary) {
      // Remaining charges, drawn like a stack count (green = charged, red = empty).
      const chargeText = globalScene.add.bitmapText(10, 15, "item-count", `${this.charges}`, 11);
      chargeText.letterSpacing = -0.5;
      chargeText.setOrigin(0, 0);
      chargeText.setTint(this.charges > 0 ? 0x90f8a0 : 0xf89890);
      container.add(chargeText);
    }
    return container;
  }
}

/** Build the ModifierType for a Ward Stone tier (live name/description). */
export function erWardStoneModifierType(tier: ErWardStoneTier): PokemonHeldItemModifierType {
  const cfg = ER_WARD_STONE_CONFIG[tier];
  const mt = new PokemonHeldItemModifierType(
    "",
    cfg.icon,
    (type, args) => new ErWardStoneModifier(type as PokemonHeldItemModifierType, (args[0] as Pokemon).id, tier),
  );
  // ER items live outside the i18n catalogue — pin the live strings (same
  // pattern as the resist berries / recreated items).
  Object.defineProperty(mt, "name", { get: () => cfg.name, configurable: true });
  mt.getDescription = () =>
    `Instantly blocks status, flinches and confusion before they land — 1 charge per block. `
    + (tier === "greater"
      ? `Holds up to ${cfg.maxCharges} charges; an empty stone regains BOTH after ${cfg.rechargeWaves} waves.`
      : `Holds up to ${cfg.maxCharges} charge${cfg.maxCharges > 1 ? "s" : ""}; an empty stone recharges over ${cfg.rechargeWaves} waves.`);
  return mt;
}

/** Find a mon's ward stone (its side's modifier list). */
export function findErWardStone(pokemon: Pokemon): ErWardStoneModifier | undefined {
  try {
    return globalScene.findModifier(
      m => m instanceof ErWardStoneModifier && m.pokemonId === pokemon.id,
      pokemon.isPlayer(),
    ) as ErWardStoneModifier | undefined;
  } catch {
    return undefined;
  }
}

/**
 * CC-block hook: when `pokemon` is about to be statused/flinched/confused by
 * something OTHER than itself, a charged Ward Stone eats the effect (and one
 * charge) and this returns true. `what` is the player-facing label of the
 * blocked effect.
 */
export function applyErWardStoneBlock(pokemon: Pokemon, what: string): boolean {
  // Item suppression (ER Frisk's held-item lock etc.) disables the stone too.
  try {
    if (pokemon.getTag(BattlerTagType.ER_ITEM_DISABLED)) {
      return false;
    }
  } catch {
    // Tag lookup must never break the status pipeline.
  }
  const stone = findErWardStone(pokemon);
  if (!stone || !stone.consumeCharge()) {
    return false;
  }
  try {
    globalScene.updateModifiers(pokemon.isPlayer());
    globalScene.phaseManager.queueMessage(
      `${pokemon.getNameToRender()}'s ${stone.type.name} blocked the ${what}! (${stone.charges} charge${stone.charges === 1 ? "" : "s"} left)`,
    );
  } catch {
    // Message/UI failures must not undo the (already-applied) block.
  }
  return true;
}

/** The label used for a blocked non-volatile status effect. */
export function erWardStoneStatusLabel(effect: StatusEffect): string {
  switch (effect) {
    case StatusEffect.SLEEP:
      return "sleep";
    case StatusEffect.PARALYSIS:
      return "paralysis";
    case StatusEffect.BURN:
      return "burn";
    case StatusEffect.POISON:
    case StatusEffect.TOXIC:
      return "poison";
    case StatusEffect.FREEZE:
      return "freeze";
    default:
      return "status";
  }
}

/** The label used for a blocked CC battler tag. */
export function erWardStoneTagLabel(tagType: BattlerTagType): string {
  switch (tagType) {
    case BattlerTagType.FLINCHED:
      return "flinch";
    case BattlerTagType.CONFUSED:
      return "confusion";
    case BattlerTagType.INFATUATED:
      return "infatuation";
    case BattlerTagType.ENCORE:
      return "encore";
    case BattlerTagType.TAUNT:
      return "taunt";
    case BattlerTagType.DISABLED:
      return "disable";
    case BattlerTagType.TORMENT:
      return "torment";
    case BattlerTagType.ER_FROSTBITE:
      return "frostbite";
    case BattlerTagType.ER_BLEED:
      return "bleed";
    case BattlerTagType.ER_FEAR:
      return "fear";
    default:
      return "effect";
  }
}

// -----------------------------------------------------------------------------
// Trainer/boss assignment — how Ward Stones enter the game.
// -----------------------------------------------------------------------------

/** True when this enemy is the Primal Cascoon finale (guaranteed Prime stone). */
function isPrimalCascoonFinale(enemy: EnemyPokemon): boolean {
  try {
    const species = enemy.species;
    const formKey = species?.forms?.[enemy.formIndex]?.formKey ?? "";
    return species?.name?.toLowerCase().includes("cascoon") === true && /primal/.test(formKey.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Per-mon Ward Stone roll, called from applyErTrainerHeldItems for trainer
 * parties AND from the boss path. Gate: Hell wave 100+ / Elite wave 150+;
 * never Ace. Rolls (seeded): boss mons — Prime 10% / Greater 25%; regular
 * trainer mons — Greater 5% / Minor 20%. Primal Cascoon always gets a full
 * Prime stone. Enemy stones spawn FULL. Never throws.
 */
export function maybeAssignErWardStone(enemy: EnemyPokemon): void {
  try {
    if (findErWardStone(enemy)) {
      return;
    }
    if (isPrimalCascoonFinale(enemy)) {
      addWardStone(enemy, "prime");
      return;
    }
    const fromWave = SPAWN_FROM_WAVE[getErDifficulty()];
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    if (fromWave === undefined || wave < fromWave) {
      return;
    }
    const isBoss = enemy.isBoss();
    if (!isBoss && !globalScene.currentBattle?.trainer) {
      return; // regular wild mons never hold one
    }
    const roll = enemy.randBattleSeedInt(100);
    if (isBoss) {
      if (roll < 10) {
        addWardStone(enemy, "prime");
      } else if (roll < 35) {
        addWardStone(enemy, "greater");
      }
      return;
    }
    if (roll < 5) {
      addWardStone(enemy, "greater");
    } else if (roll < 25) {
      addWardStone(enemy, "minor");
    }
  } catch {
    // Stone assignment must never break enemy generation.
  }
}

function addWardStone(enemy: EnemyPokemon, tier: ErWardStoneTier): void {
  const modifier = erWardStoneModifierType(tier).newModifier(enemy) as PokemonHeldItemModifier | null;
  if (modifier) {
    void globalScene.addEnemyModifier(modifier, true, true);
  }
}

// -----------------------------------------------------------------------------
// Wave charging — player-held stones refill over won waves.
// -----------------------------------------------------------------------------

/**
 * Called once per WON wave (BattleEndPhase): every player-held stone that is
 * not full accrues progress; at the tier's threshold it refills COMPLETELY
 * (per spec the Greater stone gains both charges at once, never one by one).
 */
export function advanceErWardStoneCharges(): void {
  try {
    const stones = globalScene.findModifiers(m => m instanceof ErWardStoneModifier, true) as ErWardStoneModifier[];
    for (const stone of stones) {
      const cfg = ER_WARD_STONE_CONFIG[stone.tier];
      if (stone.charges >= cfg.maxCharges) {
        stone.waveProgress = 0;
        continue;
      }
      stone.waveProgress++;
      if (stone.waveProgress >= cfg.rechargeWaves) {
        stone.charges = cfg.maxCharges;
        stone.waveProgress = 0;
      }
    }
  } catch {
    // Charging is cosmetic-adjacent — never break the battle-end flow.
  }
}

// -----------------------------------------------------------------------------
// Session persistence — player stones (incl. charge state) survive reload via
// the ER side channel, like the resist berries.
// -----------------------------------------------------------------------------

/** [pokemonId, tierIndex, charges, waveProgress] per player-owned stone. */
export function getErWardStoneEntries(): [number, number, number, number][] {
  try {
    const stones = globalScene.findModifiers(m => m instanceof ErWardStoneModifier, true) as ErWardStoneModifier[];
    return stones.map(s => [s.pokemonId, TIER_ORDER.indexOf(s.tier), s.charges, s.waveProgress]);
  } catch {
    return [];
  }
}

/** Re-attach saved player stones after a session load (additive, validated). */
export function restoreErWardStones(entries: readonly [number, number, number, number][] | undefined): void {
  if (!entries) {
    return;
  }
  try {
    for (const [pokemonId, tierIndex, charges, waveProgress] of entries) {
      const tier = TIER_ORDER[tierIndex];
      if (!tier) {
        continue;
      }
      const already = globalScene.findModifier(
        m => m instanceof ErWardStoneModifier && m.pokemonId === pokemonId,
        true,
      );
      if (already) {
        continue;
      }
      const cfg = ER_WARD_STONE_CONFIG[tier];
      const mt = erWardStoneModifierType(tier);
      const stone = new ErWardStoneModifier(
        mt,
        pokemonId,
        tier,
        Math.max(0, Math.min(cfg.maxCharges, charges | 0)),
        Math.max(0, waveProgress | 0),
      );
      globalScene.addModifier(stone, true);
    }
    globalScene.updateModifiers(true);
  } catch {
    // Best-effort: a malformed save entry must not break session load.
  }
}
