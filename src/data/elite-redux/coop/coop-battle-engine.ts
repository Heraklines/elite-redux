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
import { BattlerIndex } from "#enums/battler-index";
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
const COOP_REPAIRABLE_ER_TAGS = [BattlerTagType.ER_BLEED, BattlerTagType.ER_FROSTBITE, BattlerTagType.ER_FEAR] as const;

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

/**
 * STABLE party-slot identity of a field mon (#633, enemy-switch mirror). The host's enemy
 * switch swaps `party[fieldIndex]` <-> a bench slot, keeping the same battler index but bringing
 * a DIFFERENT party member on-field; the streamed `bi` is only a POSITION, so this carries the
 * mon's index in its OWNING party (enemy -> `getEnemyParty()`, player -> `getPlayerParty()`) so
 * the guest can DETECT the switch + mirror it. NOT `mon.id` (per-client random + remapped). A
 * mon not found in its party serializes as -1 (defensive; the guest treats it as no-switch).
 */
function readPartyIndex(mon: Pokemon): number {
  try {
    const party = mon.isPlayer()
      ? (globalScene.getPlayerParty() as Pokemon[])
      : (globalScene.getEnemyParty() as Pokemon[]);
    return party.indexOf(mon);
  } catch {
    return -1;
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
    partyIndex: readPartyIndex(mon),
    speciesId: mon.species?.speciesId ?? 0,
    hp: mon.hp,
    maxHp: mon.getMaxHp(),
    status: mon.status?.effect ?? 0,
    // getStatStages() returns the live 7-length array; clone so the checkpoint never aliases it.
    statStages: [...mon.getStatStages()],
    fainted: mon.isFainted(),
    ...(erTags.length > 0 ? { erTags } : {}),
  };
}

/**
 * HOST: the field mons to SERIALIZE for the guest (#633, faint-field reconcile fix). The
 * naive `getField(true)` drops fainted mons (its `.filter(p => p.isActive())` -> isAllowedInBattle
 * -> `!isFainted()`), so a mon the host KOs mid-turn vanishes from every payload and the guest -
 * which only matches by battler index off its OWN live field and never removes - keeps that mon
 * ALIVE forever (a turn-1 field-composition desync the resync can't heal). The fix: serialize BOTH
 * sides as the SLOT-PRESENT slices (no isActive filter) - `getPlayerField(false)` for the player
 * side and `getEnemyField(false)` for the enemy side - so a just-fainted mon on EITHER side still
 * appears in the payload with `fainted:true` + hp 0. That fainted entry is what DRIVES the guest's
 * field reconcile ({@linkcode reconcileCoopEnemyField} for enemy slots, {@linkcode reconcileCoopPlayerField}
 * for player slots). A co-op partner faint (a player mon at bi 0/1 in the forced double) was the
 * gap that broke field composition from the first move; the player side now matches the enemy
 * side's slot-present capture so it propagates too.
 */
function getCoopSerializableField(): Pokemon[] {
  // Both accessors return non-null arrays (their own `.filter`/`.slice` guarantees it): each is
  // the slot-present party slice (no isActive filter), so a just-fainted mon on either side is
  // still included with hp 0 / fainted:true and drives the guest's field reconcile.
  const playerField = globalScene.getPlayerField(false);
  const enemyField = globalScene.getEnemyField(false);
  return [...playerField, ...enemyField];
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
    // Serialize player ACTIVE mons + enemy SLOT-PRESENT mons (incl. just-fainted ones) so a
    // foe the host KOd this turn still rides the payload with fainted:true (#633 enemy-field
    // reconcile) - that entry drives the guest's removal of the dead enemy.
    const mons = getCoopSerializableField()
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
 * GUEST: reconcile the live ENEMY field to the host's authoritative composition (#633
 * enemy-field reconcile fix). The host serializes player-active + enemy-SLOT-PRESENT mons (so a
 * just-fainted foe rides the payload with `fainted:true`), but the guest's per-mon numeric apply
 * only matches by battler index and never REMOVES. So a foe the host KOd mid-turn stays ALIVE on
 * the guest forever - a turn-1 field-composition desync. This helper closes that gap: from the
 * host's serialized `hostField` it computes the set of ENEMY battler indices (bi >= ENEMY, i.e.
 * 2/3) the host reports PRESENT-AND-ALIVE (`!fainted`), then for every enemy currently ON the
 * guest's active field whose `bi` is NOT in that set, it does a side-effect-free field removal
 * (set hp 0 then {@linkcode Pokemon.leaveField} - visual removal + `field.remove` + switchOutStatus,
 * NO FaintPhase / VictoryPhase / SwitchPhase, so the engine resolution pipeline is never re-entered).
 *
 * STRICTLY enemy slots (bi >= ENEMY); player faints (bi 0/1) are a separate relayed switch flow and
 * are never touched here. Idempotent: a mon already not `isActive()` / not `isOnField()` is skipped,
 * so re-applying the same checkpoint (or the resync mirror) can never double-remove. Fully guarded so
 * one bad removal can't break the rest of the heal.
 */
export function reconcileCoopEnemyField(hostField: { bi: number; fainted: boolean; speciesId?: number }[]): void {
  try {
    // Enemy battler indices the host reports PRESENT-AND-ALIVE (slot present, not fainted).
    const hostAliveEnemies = new Set<number>();
    for (const entry of hostField) {
      if (entry.bi >= BattlerIndex.ENEMY && !entry.fainted) {
        hostAliveEnemies.add(entry.bi);
      }
    }
    // PASS 1 - REMOVE: drop every guest enemy that is on-field-and-active but NOT alive on the host.
    for (const enemy of globalScene.getEnemyField(true)) {
      if (enemy == null) {
        continue;
      }
      const bi = enemy.getBattlerIndex();
      if (bi < BattlerIndex.ENEMY) {
        continue;
      }
      // Idempotency guard: already off-field / inactive -> nothing to remove (re-apply safe).
      if (!enemy.isActive() || !enemy.isOnField()) {
        continue;
      }
      if (hostAliveEnemies.has(bi)) {
        continue;
      }
      try {
        // Side-effect-free removal: zero hp so it reads as fainted, then leaveField (no
        // FaintPhase / resolution pipeline - that would re-introduce the engine divergence
        // authoritative mode exists to prevent).
        enemy.hp = 0;
        enemy.leaveField(true, true, false);
      } catch {
        /* one enemy removal failed; leave it and continue the reconcile */
      }
    }
    // PASS 2 - SWAP/SUMMON: mirror a host ENEMY SWITCH (#633, enemy-switch mirror). For each enemy
    // bi the host reports ALIVE with a `speciesId`, if the guest's mon at that field slot is a
    // DIFFERENT species (a switch happened), summon the matching adopted party member onto the slot
    // (the guest's enemy party is in the SAME encounter order as the host, so the species identifies
    // which member). speciesId 0 / absent (an older payload or a player slot) is skipped. The
    // `partyIndex` stream field can NOT drive this - for an on-field mon it always equals the field
    // slot, so it carries no switch info (Oracle-verified); species is the robust signal.
    for (const entry of hostField) {
      if (entry.bi < BattlerIndex.ENEMY || entry.fainted) {
        continue;
      }
      const speciesId = entry.speciesId ?? 0;
      if (speciesId <= 0) {
        continue;
      }
      const fieldSlot = entry.bi - BattlerIndex.ENEMY;
      const party = globalScene.getEnemyParty();
      const current = party[fieldSlot];
      // No-op if the correct species is already on this field slot (idempotent re-apply).
      if (current != null && current.species?.speciesId === speciesId) {
        continue;
      }
      // Bench starts after the on-field slots (getEnemyField is party.slice(0, double?2:1)).
      const onFieldCount = globalScene.getEnemyField(false).length;
      // Find the adopted party member of the host's reported species that is NOT already on-field
      // (a bench slot), so we bring in the switched-in mon, not re-place an on-field duplicate.
      const partySlot = party.findIndex((p, i) => p != null && i >= onFieldCount && p.species?.speciesId === speciesId);
      if (partySlot < 0) {
        continue;
      }
      summonCoopEnemyField(fieldSlot, partySlot);
    }
  } catch {
    // A malformed host field must never crash the guest's battle.
  }
}

/**
 * GUEST: place the enemy party member at `partySlot` onto enemy field slot `fieldIndex`, mirroring
 * the host's switch (#633, enemy-switch mirror). Side-effect-free + idempotent: it does the SAME
 * array swap the host's `SwitchSummonPhase` does (`party[fieldIndex] <-> party[partySlot]`, so the
 * guest's `getEnemyParty()` stays PERMUTATION-IDENTICAL to the host across subsequent turns) and the
 * VISUAL placement subset of `summonWild` (NOT the pokeball-throw `summon`, NOT switch-summon's
 * ability/hazard/baton pipeline - that would re-enter the resolution engine authoritative mode
 * exists to bypass). `loadAssets` is fire-and-forget (the sprite pops in a frame late - fine for a
 * renderer; mirrors the existing `void enemy.loadAssets(false)` adopt path). Fully guarded.
 */
export function summonCoopEnemyField(fieldIndex: number, partySlot: number): void {
  try {
    const party = globalScene.getEnemyParty();
    const incoming = party[partySlot];
    const outgoing = party[fieldIndex];
    // Guard: both party entries must exist and the slots must differ.
    if (incoming == null || outgoing == null || partySlot === fieldIndex) {
      return;
    }
    // Idempotency: if the correct mon is already on-field at this slot, nothing to do.
    if (party[fieldIndex] === incoming) {
      return;
    }
    // SWAP the guest's enemy party array EXACTLY like the host (switch-summon-phase.ts:223-224),
    // so getEnemyParty() index alignment stays permutation-identical to the host next turn.
    [party[fieldIndex], party[partySlot]] = [party[partySlot], party[fieldIndex]];
    // Remove the outgoing mon from the field, side-effect-free (no FaintPhase / SwitchPhase).
    try {
      outgoing.leaveField(true, true, false);
    } catch {
      /* leaving the outgoing mon failed; continue and still place the incoming one */
    }
    // Place the incoming mon: reset summon data, (re)load its sprite (fire-and-forget), add it to
    // the field below the player's mon, show its info + sprite, then field-setup (clears
    // switchOutStatus so it reads as ON-FIELD). Mirrors the summonWild placement subset.
    incoming.resetSummonData();
    void incoming.loadAssets(true);
    globalScene.field.add(incoming);
    // Cast to the common base so `moveBelow<T>` (which constrains both args to one T) accepts an
    // EnemyPokemon below a PlayerPokemon - exactly as summon-phase.ts does for the wild summon.
    const playerPokemon: Pokemon | undefined = globalScene.getPlayerPokemon();
    if (playerPokemon != null) {
      globalScene.field.moveBelow(incoming as Pokemon, playerPokemon);
    }
    incoming.showInfo();
    incoming.setVisible(true);
    incoming.getSprite()?.setVisible(true);
    incoming.fieldSetup(true);
    globalScene.updateFieldScale();
  } catch {
    // A malformed switch mirror must never crash the guest's battle.
  }
}

/**
 * GUEST: reconcile the live PLAYER field to the host's authoritative composition (#633
 * partner-death sync). The mirror of {@linkcode reconcileCoopEnemyField} for the PLAYER side: in
 * the authoritative co-op double a partner's mon (a player mon at battler index 0/1) can FAINT on
 * the host, but the per-mon numeric apply only matches by battler index and never REMOVES, so the
 * just-fainted partner stays ALIVE on the guest forever - a field-composition desync from the
 * first move. With the host now serializing the player side SLOT-PRESENT (so a just-fainted partner
 * rides the checkpoint with `fainted:true`), this helper closes the gap: from the host's serialized
 * `hostField` it computes the set of PLAYER battler indices (bi < ENEMY, i.e. 0/1) the host reports
 * PRESENT-AND-ALIVE (`!fainted`), then for every player mon currently ON the guest's active field
 * whose `bi` is NOT in that set, it does a side-effect-free field removal (set hp 0 then
 * {@linkcode Pokemon.leaveField} - NO FaintPhase / SwitchPhase, so the engine resolution pipeline is
 * never re-entered).
 *
 * STRICTLY player slots (bi < ENEMY); enemy faints (bi 2/3) are the enemy reconcile's job and are
 * never touched here. Idempotent: a mon already not `isActive()` / not `isOnField()` is skipped, so
 * re-applying the same checkpoint (or the resync mirror) can never double-remove. PASS 2 mirrors a
 * host REPLACEMENT (a partner's bench mon sent in for a fainted slot - HALF B's host auto-pick): a
 * different `speciesId` now at a player bi -> summon the matching party member. Fully guarded so one
 * bad removal/summon can't break the rest of the heal.
 */
export function reconcileCoopPlayerField(hostField: { bi: number; fainted: boolean; speciesId?: number }[]): void {
  try {
    // Player battler indices the host reports PRESENT-AND-ALIVE (slot present, not fainted).
    const hostAlivePlayers = new Set<number>();
    for (const entry of hostField) {
      if (entry.bi < BattlerIndex.ENEMY && !entry.fainted) {
        hostAlivePlayers.add(entry.bi);
      }
    }
    // PASS 1 - REMOVE: drop every guest player mon that is on-field-and-active but NOT alive on the host.
    for (const mon of globalScene.getPlayerField(true)) {
      if (mon == null) {
        continue;
      }
      const bi = mon.getBattlerIndex();
      if (bi >= BattlerIndex.ENEMY) {
        continue;
      }
      // Idempotency guard: already off-field / inactive -> nothing to remove (re-apply safe).
      if (!mon.isActive() || !mon.isOnField()) {
        continue;
      }
      if (hostAlivePlayers.has(bi)) {
        continue;
      }
      try {
        // Side-effect-free removal: zero hp so it reads as fainted, then leaveField (no
        // FaintPhase / resolution pipeline - that would re-introduce the engine divergence
        // authoritative mode exists to prevent).
        mon.hp = 0;
        mon.leaveField(true, true, false);
      } catch {
        /* one player removal failed; leave it and continue the reconcile */
      }
    }
    // PASS 2 - SWAP/SUMMON: mirror a host partner REPLACEMENT (#633 partner-death sync, HALF B). For
    // each player bi the host reports ALIVE with a `speciesId`, if the guest's mon at that field slot
    // is a DIFFERENT species (a replacement happened), summon the matching player party member onto the
    // slot (the merged party is in the SAME order on both clients, so the species identifies which
    // member). speciesId 0 / absent (an older payload or an enemy slot) is skipped.
    for (const entry of hostField) {
      if (entry.bi >= BattlerIndex.ENEMY || entry.fainted) {
        continue;
      }
      const speciesId = entry.speciesId ?? 0;
      if (speciesId <= 0) {
        continue;
      }
      const fieldSlot = entry.bi;
      const party = globalScene.getPlayerParty();
      const current = party[fieldSlot];
      // No-op if the correct species is already on this field slot (idempotent re-apply).
      if (current != null && current.species?.speciesId === speciesId) {
        continue;
      }
      // Bench starts after the on-field slots (getPlayerField is party.slice(0, double?2:1)).
      const onFieldCount = globalScene.getPlayerField(false).length;
      // Find the party member of the host's reported species that is NOT already on-field (a bench
      // slot), so we bring in the replacement mon, not re-place an on-field duplicate.
      const partySlot = party.findIndex((p, i) => p != null && i >= onFieldCount && p.species?.speciesId === speciesId);
      if (partySlot < 0) {
        continue;
      }
      summonCoopPlayerField(fieldSlot, partySlot);
    }
  } catch {
    // A malformed host field must never crash the guest's battle.
  }
}

/**
 * GUEST: place the player party member at `partySlot` onto player field slot `fieldIndex`, mirroring
 * the host's partner replacement (#633 partner-death sync, HALF B). The PLAYER-side mirror of
 * {@linkcode summonCoopEnemyField}: side-effect-free + idempotent, it does the SAME array swap the
 * host's `SwitchSummonPhase` does (`party[fieldIndex] <-> party[partySlot]`, so the guest's
 * `getPlayerParty()` stays PERMUTATION-IDENTICAL to the host across subsequent turns) and the VISUAL
 * placement subset of a summon (NO FaintPhase / SwitchSummonPhase resolution pipeline - that would
 * re-enter the engine authoritative mode exists to bypass). Unlike the enemy mirror it OMITS the
 * `field.moveBelow(...)` z-order call: a player mon renders on TOP and its back sprite is automatic
 * for a PlayerPokemon via `loadAssets`, so no extra ordering flag is needed. `loadAssets` is
 * fire-and-forget (the sprite pops in a frame late - fine for a renderer). Fully guarded.
 */
export function summonCoopPlayerField(fieldIndex: number, partySlot: number): void {
  try {
    const party = globalScene.getPlayerParty();
    const incoming = party[partySlot];
    const outgoing = party[fieldIndex];
    // Guard: both party entries must exist and the slots must differ.
    if (incoming == null || outgoing == null || partySlot === fieldIndex) {
      return;
    }
    // Idempotency: if the correct mon is already on-field at this slot, nothing to do.
    if (party[fieldIndex] === incoming) {
      return;
    }
    // SWAP the guest's player party array EXACTLY like the host (switch-summon-phase.ts:223-224),
    // so getPlayerParty() index alignment stays permutation-identical to the host next turn.
    [party[fieldIndex], party[partySlot]] = [party[partySlot], party[fieldIndex]];
    // Remove the outgoing mon from the field, side-effect-free (no FaintPhase / SwitchPhase).
    try {
      outgoing.leaveField(true, true, false);
    } catch {
      /* leaving the outgoing mon failed; continue and still place the incoming one */
    }
    // Place the incoming mon: reset summon data, (re)load its sprite (fire-and-forget; the back
    // sprite is automatic for a PlayerPokemon), add it to the field, show its info + sprite, then
    // field-setup (clears switchOutStatus so it reads as ON-FIELD). No moveBelow - the player mon
    // renders on top.
    incoming.resetSummonData();
    void incoming.loadAssets(true);
    globalScene.field.add(incoming);
    incoming.showInfo();
    incoming.setVisible(true);
    incoming.getSprite()?.setVisible(true);
    incoming.fieldSetup(true);
    globalScene.updateFieldScale();
  } catch {
    // A malformed replacement mirror must never crash the guest's battle.
  }
}

/**
 * GUEST: snap the live field + arena to the host's authoritative `checkpoint`. Applied
 * at a turn boundary. Conservative + fully guarded: corrects numeric state only, and a
 * per-mon failure is swallowed so one bad entry can't break the rest of the battle.
 */
export function applyCoopCheckpoint(checkpoint: CoopBattleCheckpoint): void {
  try {
    // Reconcile the enemy field COMPOSITION to the host's FIRST (#633): drop any guest enemy the
    // host KOd this turn (it rides the checkpoint with fainted:true) AND mirror any host enemy
    // SWITCH (a different species now at a slot -> summon the matching adopted member). Done BEFORE
    // the per-mon numeric apply below so the freshly-summoned switched-in mon at a slot RECEIVES the
    // host's hp/status/stages for that bi (otherwise the numeric state writes onto the wrong, pre-swap
    // mon - Oracle ordering). Strictly enemy slots; side-effect-free; idempotent.
    reconcileCoopEnemyField(checkpoint.field);
    // ...and the PLAYER field COMPOSITION too (#633 partner-death sync): drop any guest partner the
    // host KOd this turn (it rides the checkpoint with fainted:true) AND mirror a host partner
    // REPLACEMENT (a different species now at a player slot -> summon the matching member). Same
    // BEFORE-the-numeric-apply ordering as the enemy reconcile so the freshly-summoned replacement
    // RECEIVES the host's hp/status/stages for that bi. Strictly player slots; side-effect-free; idempotent.
    reconcileCoopPlayerField(checkpoint.field);
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
    partyIndex: readPartyIndex(mon),
    speciesId: mon.species?.speciesId ?? 0,
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
export function captureCoopChecksumState(): CoopChecksumState {
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
    partyIndex: readPartyIndex(mon),
    speciesId: mon.species?.speciesId ?? 0,
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
    // Same survivors-plus-fainted-enemy serialization as the per-turn checkpoint (#633 enemy-field
    // reconcile): the resync payload must also carry a just-fainted enemy so a guest healing via the
    // snapshot removes the dead foe, not just the per-turn checkpoint path.
    const field = getCoopSerializableField()
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
    // Heal the enemy-field COMPOSITION first (#633): drop any just-fainted enemy (fainted:true) and
    // mirror any host enemy SWITCH (a different species now at a slot). Done BEFORE the per-mon heal
    // below so the freshly-summoned switched-in mon is the one the snapshot's per-bi state lands on.
    // Side-effect-free, idempotent, enemy slots only.
    reconcileCoopEnemyField(snapshot.field);
    // ...and the PLAYER-field COMPOSITION (#633 partner-death sync): drop any just-fainted partner
    // (fainted:true) and mirror a host partner REPLACEMENT (a different species now at a player
    // slot). Done BEFORE the per-mon heal below so the freshly-summoned replacement is the one the
    // snapshot's per-bi state lands on. Side-effect-free, idempotent, player slots only.
    reconcileCoopPlayerField(snapshot.field);
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
