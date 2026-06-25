/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op battle ENGINE adapter (#633, LIVE-D). The thin, engine-COUPLED bridge
// between the live game and the pure checkpoint core: read the live field + arena
// into a `CoopBattleCheckpoint` (host), and apply a received checkpoint onto the
// live field (guest). Kept separate from the pure `coop-battle-checkpoint.ts` (which
// does the clamping/shape) so the data logic stays unit-testable; this file is the
// `globalScene`/`Pokemon` touch layer.
//
// The guest applies a checkpoint at a SAFE turn boundary (start of its command phase,
// field stable - never mid-resolution). It is a CONSERVATIVE numeric correction: hp,
// status, stat stages, weather/terrain - the visible outcome state. It does NOT force
// structural faints/switches (those follow from the relayed commands resolving the
// same way); it only snaps numeric drift so both screens show the same hp/damage. All
// of it is wrapped so a bad/partial checkpoint can never crash the guest's battle.
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  buildCheckpoint,
  type CoopArenaView,
  type CoopFieldMonView,
  monStateByIndex,
  normalizeMonState,
} from "#data/elite-redux/coop/coop-battle-checkpoint";
import type { CoopBattleCheckpoint, CoopSerializedEnemy } from "#data/elite-redux/coop/coop-transport";
import { resolveErModifierClass } from "#data/elite-redux/er-persistent-modifiers";
import type { Gender } from "#data/gender";
import { Status } from "#data/status-effect";
import type { TerrainType } from "#data/terrain";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { Nature } from "#enums/nature";
import type { StatusEffect } from "#enums/status-effect";
import type { WeatherType } from "#enums/weather-type";
// biome-ignore lint/performance/noNamespaceImport: held-item reconstruction resolves the modifier class by serialized name (`Modifier[className]`), exactly like the save-load path in game-data.ts.
import * as Modifier from "#modifiers/modifier";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import { PokemonMove } from "#moves/pokemon-move";
import { ModifierData } from "#system/modifier-data";

/**
 * ER BattlerTags carried in the co-op checkpoint (#633 Fix #4h). These are BattlerTags, not
 * StatusEffects, so the checkpoint's `status` field can't repair them - without this the three
 * ER conditions could never be re-synced once anything drifts. Bleed is HP chip; frostbite /
 * fear are flag-bearing tags. Held as a literal list so the read + repair stay narrow + cheap.
 */
const COOP_REPAIRABLE_ER_TAGS = [
  BattlerTagType.ER_BLEED,
  BattlerTagType.ER_FROSTBITE,
  BattlerTagType.ER_FEAR,
] as const;

/** Read the ER bleed/frost/fear tags currently on a mon into the checkpoint shape. */
function readErTags(mon: ReturnType<typeof globalScene.getField>[number]): { type: string; turns: number }[] {
  const out: { type: string; turns: number }[] = [];
  for (const type of COOP_REPAIRABLE_ER_TAGS) {
    const tag = mon.getTag(type);
    if (tag != null) {
      out.push({ type, turns: tag.turnCount });
    }
  }
  return out;
}

/**
 * GUEST: repair the three ER bleed/frost/fear tags to match the host's checkpoint (#633 Fix
 * #4h). For each repairable tag: add it if the host has it and we don't; remove it if the
 * host doesn't and we do. Only these three tags are touched - every other BattlerTag is left
 * exactly as the lockstep engine computed it. Fully guarded by the caller.
 */
function repairErTags(
  mon: ReturnType<typeof globalScene.getField>[number],
  erTags: { type: string; turns: number }[] | undefined,
): void {
  const wanted = new Map<string, number>((erTags ?? []).map(t => [t.type, t.turns]));
  for (const type of COOP_REPAIRABLE_ER_TAGS) {
    const has = mon.getTag(type) != null;
    const want = wanted.has(type);
    if (want && !has) {
      mon.addTag(type, wanted.get(type) ?? 0);
    } else if (!want && has) {
      mon.removeTag(type);
    }
  }
}

/** Read a live field mon into the pure checkpoint view. */
function readMonView(mon: ReturnType<typeof globalScene.getField>[number]): CoopFieldMonView | null {
  if (mon == null) {
    return null;
  }
  const erTags = readErTags(mon);
  return {
    bi: mon.getBattlerIndex(),
    hp: mon.hp,
    maxHp: mon.getMaxHp(),
    status: mon.status?.effect ?? 0,
    // getStatStages() returns the live 7-length array; clone so the checkpoint never aliases it.
    statStages: [...mon.getStatStages()],
    fainted: mon.isFainted(),
    ...(erTags.length > 0 ? { erTags } : {}),
  };
}

/** Read the arena's weather + terrain into the pure checkpoint view. */
function readArenaView(): CoopArenaView {
  const arena = globalScene.arena;
  return {
    weather: arena.weather?.weatherType ?? 0,
    weatherTurnsLeft: arena.weather?.turnsLeft ?? 0,
    terrain: arena.terrain?.terrainType ?? 0,
    terrainTurnsLeft: arena.terrain?.turnsLeft ?? 0,
  };
}

/**
 * HOST: snapshot the current (post-turn) authoritative battle state. Returns null if
 * there is no live battle field to read (defensive).
 */
export function captureCoopCheckpoint(): CoopBattleCheckpoint | null {
  try {
    const mons = globalScene
      .getField(true)
      .map(readMonView)
      .filter((v): v is CoopFieldMonView => v != null);
    if (mons.length === 0) {
      return null;
    }
    return buildCheckpoint(mons, readArenaView());
  } catch {
    // Never let a capture failure break the host's turn.
    return null;
  }
}

/**
 * GUEST: snap the live field + arena to the host's authoritative `checkpoint`. Applied
 * at a turn boundary. Conservative + fully guarded: corrects numeric state only, and a
 * per-mon failure is swallowed so one bad entry can't break the rest of the battle.
 */
export function applyCoopCheckpoint(checkpoint: CoopBattleCheckpoint): void {
  try {
    for (const mon of globalScene.getField(true)) {
      if (mon == null) {
        continue;
      }
      const raw = monStateByIndex(checkpoint, mon.getBattlerIndex());
      if (raw == null) {
        continue;
      }
      const state = normalizeMonState(raw);
      try {
        // hp is pre-clamped to [0, maxHp]; only the surviving (still-active) mons are
        // corrected - a 0-hp host mon the guest hasn't fainted is left for the relayed
        // commands to resolve, not force-fainted here.
        if (!mon.isFainted()) {
          mon.hp = Math.min(state.hp, mon.getMaxHp());
          mon.status = state.status ? new Status(state.status as StatusEffect) : null;
          const stages = mon.getStatStages();
          for (let i = 0; i < 7 && i < stages.length; i++) {
            stages[i] = state.statStages[i];
          }
          repairErTags(mon, state.erTags);
          void mon.updateInfo();
        }
      } catch {
        /* one mon's correction failed; leave it and continue */
      }
    }
    // Correct weather / terrain type if it drifted (turn counts are approximate).
    const arena = globalScene.arena;
    if ((arena.weather?.weatherType ?? 0) !== checkpoint.weather) {
      arena.trySetWeather(checkpoint.weather as WeatherType);
    }
    if ((arena.terrain?.terrainType ?? 0) !== checkpoint.terrain) {
      arena.trySetTerrain(checkpoint.terrain as TerrainType, true);
    }
  } catch {
    // A malformed checkpoint must never crash the guest's battle.
  }
}

/**
 * HOST: serialize the generated enemy party's identity (#633, LIVE-D6). Species /
 * level / IVs already match across clients (deterministic wave gen from the shared
 * seed); what diverged live was the rolled ABILITY (and potentially moveset). We send
 * the identity fields the guest overwrites so its enemies behave identically - by
 * party index, NOT a full Pokemon reconstruction (sprites/loading stay intact).
 */
export function captureCoopEnemies(): CoopSerializedEnemy[] {
  try {
    return globalScene.getEnemyParty().map((enemy, index) => ({
      fieldIndex: index,
      data: {
        speciesId: enemy.species.speciesId,
        formIndex: enemy.formIndex,
        level: enemy.level,
        abilityIndex: enemy.abilityIndex,
        nature: enemy.nature,
        gender: enemy.gender,
        ivs: [...enemy.ivs],
        moveset: enemy.getMoveset().map(m => m.moveId),
        hp: enemy.hp,
        // Shiny + variant are rolled in the Pokemon constructor from the wave RNG,
        // but the guest's adopt path (buildCoopEnemy) consumes the RNG in a different
        // order than the host's normal generation, so its independent roll diverged -
        // one client saw a shiny wild mon, the other a normal one (and a caught mon
        // then carried the wrong shininess into that player's save). Carry the host's
        // authoritative roll so the guest renders + catches the EXACT same mon.
        shiny: enemy.shiny,
        variant: enemy.variant,
        // Held items (#633): for TRAINER waves the host's `trainer.genModifiers` (and the
        // wild held-item roll) attach held modifiers the guest would otherwise regenerate
        // from its own RNG (double/divergent items). Serialize each as a `ModifierData`
        // (plain-JSON, the same shape the save system round-trips) so the guest rebuilds
        // the EXACT same items and suppresses its own roll. `pokemonId` is the host's
        // runtime id - the guest remaps it to its own enemy id on reconstruction.
        heldItems: captureEnemyHeldItems(enemy),
      },
    }));
  } catch {
    return [];
  }
}

/**
 * HOST: serialize one enemy's held-item modifiers as plain `ModifierData` blobs (#633).
 * Reads the enemy modifier list (player=false) filtered to this mon. Each entry survives
 * the JSON transport as a flat object; the guest reconstructs it via {@linkcode ModifierData.toModifier}.
 */
function captureEnemyHeldItems(enemy: ReturnType<typeof globalScene.getEnemyParty>[number]): Record<string, unknown>[] {
  try {
    return globalScene
      .findModifiers(m => m instanceof PokemonHeldItemModifier && m.pokemonId === enemy.id, false)
      .map(m => {
        const data = new ModifierData(m, false);
        return {
          typeId: data.typeId,
          className: data.className,
          args: data.args,
          stackCount: data.stackCount,
          ...(data.typePregenArgs === undefined ? {} : { typePregenArgs: data.typePregenArgs }),
        };
      });
  } catch {
    return [];
  }
}

/**
 * GUEST: reconstruct + attach the host's serialized held-item modifiers onto an adopted
 * enemy (#633). Mirrors the save-load path (game-data.ts): resolve the class from the
 * vanilla `Modifier` namespace (or the ER fallback), rebuild via {@linkcode ModifierData.toModifier},
 * remap `pokemonId` to THIS client's enemy id, then `addEnemyModifier`. Fully guarded per item
 * so one bad entry can't break the encounter. `enemyId` is the live `EnemyPokemon.id`.
 */
export function applyCoopEnemyHeldItems(enemyId: number, heldItems: unknown): void {
  if (!Array.isArray(heldItems)) {
    return;
  }
  for (const raw of heldItems) {
    if (raw == null || typeof raw !== "object") {
      continue;
    }
    try {
      const data = new ModifierData(raw, false);
      const modifier = data.toModifier(
        Modifier[data.className as keyof typeof Modifier] ?? resolveErModifierClass(data.className),
      );
      if (modifier instanceof PokemonHeldItemModifier) {
        // The serialized id is the HOST's runtime id; this client's enemy has its own id.
        modifier.pokemonId = enemyId;
        void globalScene.addEnemyModifier(modifier, true);
      }
    } catch {
      /* one held item failed to reconstruct; skip it, keep the rest */
    }
  }
}

/** Read a number field from an opaque serialized blob, or undefined if absent/wrong type. */
function num(blob: Record<string, unknown>, key: string): number | undefined {
  const v = blob[key];
  return typeof v === "number" ? v : undefined;
}

/**
 * GUEST: overwrite each already-generated enemy's identity with the host's, by party
 * index (#633, LIVE-D6). Only corrects a mon of the SAME species (never rewrites a
 * structurally different one); sets ability / nature / gender / IVs / moveset, then
 * recomputes stats and clamps hp. Fully guarded per-enemy so one bad entry can't break
 * the encounter. Applied at the wave's first turn boundary, before any move resolves.
 */
export function applyCoopEnemies(enemies: CoopSerializedEnemy[]): void {
  try {
    const party = globalScene.getEnemyParty();
    for (const entry of enemies) {
      const enemy = party[entry.fieldIndex];
      if (enemy == null) {
        continue;
      }
      const d = entry.data;
      // Sanity: only correct a same-species mon (don't fight a structural mismatch).
      if (num(d, "speciesId") !== undefined && enemy.species.speciesId !== num(d, "speciesId")) {
        continue;
      }
      try {
        const abilityIndex = num(d, "abilityIndex");
        if (abilityIndex !== undefined) {
          enemy.abilityIndex = abilityIndex;
        }
        if (Array.isArray(d.ivs)) {
          enemy.ivs = (d.ivs as unknown[]).filter((n): n is number => typeof n === "number").slice(0, 6);
        }
        const nature = num(d, "nature");
        if (nature !== undefined) {
          enemy.nature = nature as Nature;
        }
        const gender = num(d, "gender");
        if (gender !== undefined) {
          enemy.gender = gender as Gender;
        }
        // Adopt the host's authoritative shiny + variant (#633). This corrector runs
        // at the wave's first turn boundary (sprite already summoned), so if the
        // shininess actually changed, reload the sprite so the rendered mon matches.
        const prevShiny = enemy.shiny;
        const prevVariant = enemy.variant;
        if (typeof d.shiny === "boolean") {
          enemy.shiny = d.shiny;
        }
        const variant = num(d, "variant");
        if (variant !== undefined) {
          enemy.variant = variant as 0 | 1 | 2;
        }
        if (enemy.shiny !== prevShiny || enemy.variant !== prevVariant) {
          void enemy.loadAssets(false);
        }
        if (Array.isArray(d.moveset)) {
          const moveIds = (d.moveset as unknown[]).filter((n): n is number => typeof n === "number");
          if (moveIds.length > 0) {
            enemy.moveset = moveIds.map(id => new PokemonMove(id));
          }
        }
        // IVs / nature changed -> recompute stats, then align current hp.
        enemy.calculateStats();
        const hp = num(d, "hp");
        if (hp !== undefined) {
          enemy.hp = Math.max(0, Math.min(hp, enemy.getMaxHp()));
        }
        void enemy.updateInfo();
      } catch {
        /* one enemy's correction failed; leave it and continue */
      }
    }
  } catch {
    // A malformed enemy-party message must never break the encounter.
  }
}
