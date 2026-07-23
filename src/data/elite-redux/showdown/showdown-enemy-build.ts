/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 PvP (C3): ENGINE-side enemy-party construction. The host fields the
// OPPONENT's team as a TRAINER (so the 6-mon party switches, can't be caught, and wins on
// wipe - the exact 1v1 shape) whose members are built VERBATIM from the manifest.
//
// Reuse: the opponent trainer is flagged {@linkcode markTrainerAsShowdown} (mirroring the
// ghost-trainer flag) and its `Trainer.genPartyMember` is intercepted by
// {@linkcode applyShowdownOverride} (hooked next to the ghost override in trainer.ts). Each
// member is built with `globalScene.addEnemyPokemon` and its identity restored from the manifest
// (species / form / level / ability / nature / IVs / moveset / shiny). Built DIRECTLY (not via
// the co-op enemy reconstructor) so this module does NOT drag the heavy coop-battle-engine into
// battle-scene / trainer's module-load graph (that edge tripped a load-order cycle).
//
// Verbatim (no wave-scaling): the showdown branch is EXEMPTED from `enforceErEliteBstCurve`
// (er-trainer-runtime-hook.ts), so a level-100 team is fielded exactly as built (no wave-1 BST
// swap / devolve). Megas keep their `formIndex` (permamega; built at TrainerSlot.TRAINER so the
// wild-mega reset never fires - it is NONE-only). The MEGA_STONE sentinel maps to NO runtime
// modifier (the form carries the stats); a whitelist item is granted as its held-item modifier.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { normalizeErShinyLabSavedLook } from "#data/elite-redux/er-shiny-lab-effects";
import { getShowdownFieldOpponentManifest } from "#data/elite-redux/showdown/showdown-battle-state";
import { showdownHeldItemKey } from "#data/elite-redux/showdown/showdown-enemy";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { Nature } from "#enums/nature";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { TrainerSlot } from "#enums/trainer-slot";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import type { Trainer } from "#field/trainer";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { PokemonMove } from "#moves/pokemon-move";
import type { Variant } from "#sprites/variant";
import { TrainerPartyTemplate } from "#trainers/trainer-party-template";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** Trainers flagged as the showdown OPPONENT (their party is the opponent manifest). */
const SHOWDOWN_TRAINERS = new WeakSet<Trainer>();

/**
 * Flag `trainer` as the showdown opponent and shadow its party template so it fields exactly
 * `teamSize` mons (capped at 6). Mirrors {@linkcode markTrainerAsGhost}: the shared trainer
 * config is untouched; only this instance's team size + override hook change.
 */
export function markTrainerAsShowdown(trainer: Trainer, teamSize: number): void {
  SHOWDOWN_TRAINERS.add(trainer);
  const size = Math.max(1, Math.min(teamSize, 6));
  trainer.getPartyTemplate = () => new TrainerPartyTemplate(size, PartyMemberStrength.STRONGER);
}

/** Whether `trainer` is a showdown opponent (its members come from the manifest). */
export function isShowdownTrainer(trainer: Trainer): boolean {
  return SHOWDOWN_TRAINERS.has(trainer);
}

/**
 * Build the whitelist held-item modifier for `pokemon` from its manifest mon, or `null` when
 * NO runtime modifier applies (the `MEGA_STONE` sentinel / an empty item / an unknown key).
 *
 * SHARED by the opponent-side enemy build AND the player-side own-party attach (B7 item 6), so
 * BOTH sides field a BYTE-EQUAL held-item set - your own party carries exactly what the
 * opponent's client fields for you from your manifest. The registry key is pinned as the
 * modifier type id so the modifier serializes with a resolvable `typeId`
 * (`getModifierTypeFuncById`): the guest boots the host's session snapshot + authoritative turn
 * stream, which would otherwise DROP an id-less held item. ER item factories already pin their
 * own (equal) id, so the guard only fills the vanilla items.
 */
export function buildShowdownHeldItem(pokemon: Pokemon, mon: ShowdownMonManifest): PokemonHeldItemModifier | null {
  const itemKey = showdownHeldItemKey(mon);
  if (itemKey == null) {
    return null;
  }
  const factory = modifierTypes[itemKey as keyof typeof modifierTypes];
  if (factory == null) {
    return null;
  }
  const type = factory();
  if (!type.id) {
    type.id = itemKey;
  }
  return (type.newModifier(pokemon) as PokemonHeldItemModifier | null) ?? null;
}

/** Build ONE showdown enemy from a manifest mon, verbatim (BST-curve exempt), at `slot`. */
function buildShowdownEnemy(mon: ShowdownMonManifest, slot: TrainerSlot): EnemyPokemon {
  const species = getPokemonSpecies(mon.speciesId);
  // No dataSource: the constructor rolls a moveset/shiny we override below. Showdown is exempt
  // from enforceErEliteBstCurve, so the species is NOT swapped/devolved at wave 1.
  const enemy = globalScene.addEnemyPokemon(species, mon.level, slot);
  // Restore the manifest identity. Megas: TrainerSlot.TRAINER never triggers the wild-mega reset.
  if (mon.formIndex >= 0 && mon.formIndex < (enemy.species.forms?.length ?? 1)) {
    enemy.formIndex = mon.formIndex;
  }
  enemy.abilityIndex = mon.abilityIndex;
  // Showdown fairness (2026-07-10): the manifest's FREE nature. Optional on the wire — a manifest that
  // omits it (legacy/older client) falls back to a FIXED default (never the constructor's random roll,
  // which would desync the two clients' checksums).
  enemy.nature = (mon.nature ?? Nature.HARDY) as Nature;
  enemy.shiny = mon.shiny;
  enemy.variant = mon.variant as Variant;
  // Task C7: restore the owner's per-mon Shiny Lab look, shiny-gated exactly like the ghost apply
  // (applyErGhostOverride). `erShinyLabSuppressLocal` blocks this client's own equipped look from
  // leaking onto the opponent's mon; the normalized look (byte-clamped) is applied only when shiny.
  // Black shinies are banned from showdown teams (B6), so the black tier is irrelevant here.
  enemy.customPokemonData.erShinyLabSuppressLocal = true;
  enemy.customPokemonData.erShinyLab = mon.shiny ? normalizeErShinyLabSavedLook(mon.erShinyLab) : undefined;
  // Showdown fairness (2026-07-10): IVs are FORCED to a perfect [31 x6] for both players — the
  // manifest's own ivs are ignored on the wire. IDENTICAL forcing on the host's own party
  // (select-starter-phase initBattle), so the two sides' recalculated stats — and thus the turn
  // checksum — match. `calculateStats()` below applies them.
  enemy.ivs = [31, 31, 31, 31, 31, 31];
  if (mon.moveset.length > 0) {
    const moves = mon.moveset.map(id => new PokemonMove(id));
    enemy.moveset = moves;
    enemy.summonData.moveset = moves.slice();
  }
  enemy.calculateStats();
  enemy.generateName();
  enemy.hp = enemy.getMaxHp();
  return enemy;
}

/**
 * Build the showdown opponent's member for `index` from the stashed opponent manifest, or `null`
 * when this is not a showdown trainer / the index is beyond the team (so the caller falls through
 * to its normal generation). Hooked into `Trainer.genPartyMember` beside the ghost override.
 */
export function applyShowdownOverride(trainer: Trainer, index: number): EnemyPokemon | null {
  if (!SHOWDOWN_TRAINERS.has(trainer)) {
    return null;
  }
  const manifest = getShowdownFieldOpponentManifest();
  if (manifest == null || index >= manifest.length) {
    return null;
  }
  try {
    const mon = manifest[index];
    // Double-battle trainers alternate the slot; a 1v1 single fields TrainerSlot.TRAINER for all.
    const slot = !trainer.isDouble() || !(index % 2) ? TrainerSlot.TRAINER : TrainerSlot.TRAINER_PARTNER;
    const enemy = buildShowdownEnemy(mon, slot);
    // The whitelist held item (MEGA_STONE / empty -> none), granted verbatim via the SHARED
    // builder the player-side attach also uses (byte-equal item set on both sides).
    const held = buildShowdownHeldItem(enemy, mon);
    if (held != null) {
      void globalScene.addEnemyModifier(held, true);
    }
    return enemy;
  } catch {
    return null;
  }
}
