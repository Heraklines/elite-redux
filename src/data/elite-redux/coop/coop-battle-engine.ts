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
import {
  COOP_CHECKSUM_SENTINEL,
  type CoopChecksumMon,
  type CoopChecksumState,
  checksumState,
} from "#data/elite-redux/coop/coop-battle-checksum";
import type {
  CoopBattleCheckpoint,
  CoopFullBattleSnapshot,
  CoopFullMonSnapshot,
  CoopSerializedEnemy,
} from "#data/elite-redux/coop/coop-transport";
import { resolveErModifierClass } from "#data/elite-redux/er-persistent-modifiers";
import type { Gender } from "#data/gender";
import { Status } from "#data/status-effect";
import type { TerrainType } from "#data/terrain";
import type { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { Nature } from "#enums/nature";
import type { StatusEffect } from "#enums/status-effect";
import type { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
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

// =============================================================================
// Per-turn state CHECKSUM + full-state RESYNC (#633, TRACK-2). The host stamps a
// 64-bit fingerprint of its FULL authoritative state on each turn; the guest
// recomputes the same fingerprint over its own state and, on a MISMATCH, requests a
// full snapshot the host serializes here and the guest adopts field-by-field. This
// makes ANY divergence (incl. the ability/form/PP/tag drift the numeric checkpoint
// can't carry) detectable + self-healing. The hash/canonicalize logic is the pure
// `coop-battle-checksum.ts`; this file just READS the live engine into its view.
// =============================================================================

/** Read a live field mon's active ability id (0 if unreadable). */
function readAbilityId(mon: Pokemon): number {
  try {
    return mon.getAbility().id;
  } catch {
    return 0;
  }
}

/** Read a live mon's moveset as `[moveId, ppUsed]` in slot order. */
function readMoves(mon: Pokemon): [number, number][] {
  try {
    return mon.getMoveset().map(m => [m.moveId, m.ppUsed]);
  } catch {
    return [];
  }
}

/** Read a live mon's battler-tag TYPE ids, sorted ascending (identity only, no counters). */
function readTagTypes(mon: Pokemon): number[] {
  try {
    return mon.summonData.tags.map(t => t.tagType as unknown as number).sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** Read the arena's tag identities as `[tagType, side]`, sorted (turn counts excluded). */
function readArenaTags(): [number, number][] {
  try {
    return globalScene.arena.tags
      .map(t => [t.tagType as unknown as number, t.side as unknown as number] as [number, number])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  } catch {
    return [];
  }
}

/** Read the player's persistent modifiers as `[typeId, stackCount]`, sorted by id. */
function readModifiers(): [string, number][] {
  try {
    return globalScene.modifiers
      .map(m => [m.type.id, m.stackCount] as [string, number])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  } catch {
    return [];
  }
}

/** Build the canonical checksum view of ONE live field mon. */
function readChecksumMon(mon: Pokemon): CoopChecksumMon {
  return {
    bi: mon.getBattlerIndex(),
    hp: mon.hp,
    maxHp: mon.getMaxHp(),
    status: mon.status?.effect ?? 0,
    statStages: [...mon.getStatStages()],
    fainted: mon.isFainted(),
    abilityId: readAbilityId(mon),
    formIndex: mon.formIndex ?? 0,
    moves: readMoves(mon),
    tags: readTagTypes(mon),
  };
}

/**
 * Capture the full authoritative battle state into its canonical checksum view. Read
 * ONLY at a stable turn boundary (start of CommandPhase) - never mid-resolution - so
 * both clients hash the same logical instant. Field mons are sorted by battler index.
 */
function captureCoopChecksumState(): CoopChecksumState {
  const arena = globalScene.arena;
  const field = globalScene
    .getField(true)
    .filter((m): m is Pokemon => m != null)
    .map(readChecksumMon)
    .sort((a, b) => a.bi - b.bi);
  return {
    field,
    weather: arena.weather?.weatherType ?? 0,
    terrain: arena.terrain?.terrainType ?? 0,
    arenaTags: readArenaTags(),
    party: globalScene.getPlayerParty().map(p => p.species.speciesId),
    money: globalScene.money,
    modifiers: readModifiers(),
  };
}

/**
 * HOST + GUEST: the 64-bit fingerprint of the full authoritative battle state. The host
 * stamps it on each turn/checkpoint; the guest recomputes + compares. Returns the
 * read-failure sentinel on any error so the comparison is SKIPPED (never a resync on a
 * transient read failure).
 */
export function captureCoopChecksum(): string {
  try {
    return checksumState(captureCoopChecksumState());
  } catch {
    return COOP_CHECKSUM_SENTINEL;
  }
}

/** Build ONE field mon's full resync snapshot (superset of the checkpoint). */
function readFullMon(mon: Pokemon): CoopFullMonSnapshot {
  return {
    bi: mon.getBattlerIndex(),
    hp: mon.hp,
    maxHp: mon.getMaxHp(),
    status: mon.status?.effect ?? 0,
    statStages: [...mon.getStatStages()],
    fainted: mon.isFainted(),
    abilityId: readAbilityId(mon),
    formIndex: mon.formIndex ?? 0,
    moves: readMoves(mon),
    tags: readTagTypes(mon),
  };
}

/**
 * HOST: serialize the FULL authoritative battle state to heal a guest desync (#633,
 * TRACK-2). Carries every detail the per-turn checkpoint can't: ability, form, per-move
 * PP, battler tags, arena tags, party order, money, modifier stacks. Returns null when
 * there is no live field (defensive). The guest adopts it via {@linkcode applyCoopFullSnapshot}.
 */
export function captureCoopFullSnapshot(): CoopFullBattleSnapshot | null {
  try {
    const arena = globalScene.arena;
    const field = globalScene
      .getField(true)
      .filter((m): m is Pokemon => m != null)
      .map(readFullMon)
      .sort((a, b) => a.bi - b.bi);
    if (field.length === 0) {
      return null;
    }
    return {
      field,
      weather: arena.weather?.weatherType ?? 0,
      weatherTurnsLeft: arena.weather?.turnsLeft ?? 0,
      terrain: arena.terrain?.terrainType ?? 0,
      terrainTurnsLeft: arena.terrain?.turnsLeft ?? 0,
      arenaTags: readArenaTags(),
      party: globalScene.getPlayerParty().map(p => p.species.speciesId),
      money: globalScene.money,
      modifiers: readModifiers(),
    };
  } catch {
    return null;
  }
}

/** Reconcile a live mon's battler tags to exactly the snapshot's tag-type set. */
function reconcileTags(mon: Pokemon, wantTagTypes: number[]): void {
  try {
    const want = new Set(wantTagTypes);
    const have = new Set(mon.summonData.tags.map(t => t.tagType as unknown as number));
    // Drop tags the host no longer has.
    for (const have_t of [...have]) {
      if (!want.has(have_t)) {
        mon.removeTag(have_t as unknown as BattlerTagType);
      }
    }
    // Add tags the host has that we don't (best-effort: identity only, no source-move).
    for (const want_t of want) {
      if (!have.has(want_t)) {
        mon.addTag(want_t as unknown as BattlerTagType);
      }
    }
  } catch {
    /* tag reconciliation is best-effort; never break the heal */
  }
}

/** Apply ONE full mon snapshot onto a live mon (ability/form FIRST, then stats, then hp). */
function applyFullMon(mon: Pokemon, snap: CoopFullMonSnapshot): void {
  try {
    // Ability / form first so a stat recompute uses the authoritative values.
    if (mon.formIndex !== snap.formIndex) {
      mon.formIndex = snap.formIndex;
    }
    // Active ability: if the host's authoritative active ability differs from what this
    // mon currently resolves, pin it via the summon-data override slot so getAbility()
    // returns the host's value exactly (0 = unreadable on the host -> leave ours alone).
    if (snap.abilityId !== 0 && mon.getAbility().id !== snap.abilityId) {
      mon.summonData.ability = snap.abilityId as AbilityId;
    }
    // Per-move PP: align ppUsed on the matching slot (moveset structure already matches
    // in lockstep; we only correct the used count, never rebuild the moveset).
    const moveset = mon.getMoveset();
    for (let i = 0; i < moveset.length && i < snap.moves.length; i++) {
      const [, ppUsed] = snap.moves[i];
      if (moveset[i] != null && typeof ppUsed === "number") {
        moveset[i].ppUsed = Math.max(0, ppUsed);
      }
    }
    reconcileTags(mon, snap.tags);
    mon.calculateStats();
    // Status.
    mon.status = snap.status ? new Status(snap.status as StatusEffect) : null;
    // Stat stages (7).
    const stages = mon.getStatStages();
    for (let i = 0; i < 7 && i < stages.length; i++) {
      stages[i] = Math.max(-6, Math.min(6, Math.trunc(snap.statStages[i] ?? 0)));
    }
    // HP last, clamped to the (recomputed) max.
    mon.hp = Math.max(0, Math.min(Math.trunc(snap.hp), mon.getMaxHp()));
    void mon.updateInfo();
  } catch {
    /* one mon's heal failed; leave it and continue */
  }
}

/**
 * GUEST: adopt the host's full authoritative snapshot wholesale to HEAL a desync (#633,
 * TRACK-2). Applies field mons (ability/form before stat recompute), then arena weather /
 * terrain, then money - field-by-field onto the LIVE objects (never a session reload, which
 * would tear down the running battle). Party order + modifier stacks are intentionally NOT
 * rewritten here (structural changes mid-battle are unsafe); they converge at the next wave
 * boundary's normal sync. Fully guarded so a malformed snapshot can never crash the guest.
 */
export function applyCoopFullSnapshot(snapshot: CoopFullBattleSnapshot): void {
  try {
    const byIndex = new Map(
      globalScene
        .getField(true)
        .filter((m): m is Pokemon => m != null)
        .map(m => [m.getBattlerIndex(), m]),
    );
    for (const snap of snapshot.field) {
      const mon = byIndex.get(snap.bi);
      if (mon != null) {
        applyFullMon(mon, snap);
      }
    }
    const arena = globalScene.arena;
    if ((arena.weather?.weatherType ?? 0) !== snapshot.weather) {
      arena.trySetWeather(snapshot.weather as WeatherType);
    }
    if ((arena.terrain?.terrainType ?? 0) !== snapshot.terrain) {
      arena.trySetTerrain(snapshot.terrain as TerrainType, true);
    }
    globalScene.money = snapshot.money;
  } catch {
    // A malformed snapshot must never crash the guest's battle.
  }
}
