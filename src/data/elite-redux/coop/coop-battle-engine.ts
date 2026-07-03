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
import { EntryHazardTag } from "#data/arena-tag";
import { isCoopAuthoritativeGuestGated } from "#data/elite-redux/coop/coop-authoritative-gate";
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
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type {
  CoopBattleCheckpoint,
  CoopExpDelta,
  CoopFullBattleSnapshot,
  CoopFullMonSnapshot,
  CoopInteractionOutcome,
  CoopRole,
  CoopSerializedArenaTag,
  CoopSerializedEnemy,
} from "#data/elite-redux/coop/coop-transport";
import { resolveErModifierClass } from "#data/elite-redux/er-persistent-modifiers";
import type { Gender } from "#data/gender";
import { Status } from "#data/status-effect";
import type { TerrainType } from "#data/terrain";
import type { AbilityId } from "#enums/ability-id";
import type { ArenaTagSide } from "#enums/arena-tag-side";
import type { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { BiomeId } from "#enums/biome-id";
import { FieldPosition } from "#enums/field-position";
import type { MoveId } from "#enums/move-id";
import type { Nature } from "#enums/nature";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { WeatherType } from "#enums/weather-type";
import { EnemyPokemon, type PlayerPokemon, type Pokemon } from "#field/pokemon";
// biome-ignore lint/performance/noNamespaceImport: held-item reconstruction resolves the modifier class by serialized name (`Modifier[className]`), exactly like the save-load path in game-data.ts.
import * as Modifier from "#modifiers/modifier";
import { PersistentModifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { PokemonMove } from "#moves/pokemon-move";
import { ModifierData } from "#system/modifier-data";
import { PokemonData } from "#system/pokemon-data";
import type { StarterDataEntry } from "#types/save-data";
import { compressToBase64, decompressFromBase64 } from "lz-string";

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
    // #798 PP sync: carry each slot's [moveId, ppUsed] so the guest's PP converges via the
    // checkpoint (it never runs MovePhase) instead of via a forced FULL resync every turn.
    moves: (mon.moveset ?? []).map(m => ({ id: m?.moveId ?? 0, ppUsed: m?.ppUsed ?? 0 })),
    // #804: the authoritative owner tag (player-side mons only; enemies have none).
    ...((mon as { coopOwner?: CoopRole }).coopOwner === undefined
      ? {}
      : { coopOwner: (mon as { coopOwner?: CoopRole }).coopOwner }),
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

/**
 * Read the arena's weather + terrain + tags into the pure checkpoint view (#633 GAP 1). ALWAYS
 * sets `arenaTags` (an empty array when the arena has none) - a NEW host that supports arena-tag
 * sync signals it by carrying the array, so the guest can converge to the EMPTY set (remove a
 * screen the host cleared), not just gain tags. An OLDER host omits the field entirely, and the
 * guest then leaves its tags alone (the `undefined` skip in {@linkcode reconcileArenaTags}).
 */
function readArenaView(): CoopArenaView {
  const arena = globalScene.arena;
  return {
    weather: arena.weather?.weatherType ?? 0,
    weatherTurnsLeft: arena.weather?.turnsLeft ?? 0,
    terrain: arena.terrain?.terrainType ?? 0,
    terrainTurnsLeft: arena.terrain?.turnsLeft ?? 0,
    arenaTags: readArenaTagViews(),
  };
}

/**
 * Read the arena's tags into the rich checkpoint view (#633 GAP 1). Carries `(tagType, side)` -
 * the identity the checksum hashes - PLUS `turnCount` + entry-hazard `layers` so the guest can
 * FORCE-SET them (turn counts are intentionally NOT hashed, so carrying them here can never
 * re-introduce a false desync; they only make a host-refreshed screen / multi-layer Spikes
 * render correctly). Sorted by `(tagType, side)` for a stable wire order. Fully guarded.
 */
function readArenaTagViews(): CoopSerializedArenaTag[] {
  try {
    return globalScene.arena.tags
      .map(
        (t): CoopSerializedArenaTag => ({
          tagType: t.tagType as unknown as string,
          side: t.side as unknown as number,
          turnCount: t.turnCount,
          layers: t instanceof EntryHazardTag ? t.layers : 1,
        }),
      )
      .sort((a, b) => (a.tagType < b.tagType ? -1 : a.tagType > b.tagType ? 1 : a.side - b.side));
  } catch {
    return [];
  }
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
    // Carry the host's authoritative money in EVERY per-turn checkpoint (#633/#698 money transient): the
    // pure-renderer guest never runs the host-only money mutations (between-wave reward-shop BUY, in-battle
    // Pay Day / scattered-money pickup), so without this its money lags the host until the next full resync
    // heals it - the visible "host=824 guest=1000" transient. The guest force-sets it (gated), so the first
    // turn of the wave after a shop spend snaps money. Read live + guarded so a bad read can't break capture.
    let money: number | undefined;
    try {
      money = globalScene.money;
    } catch {
      money = undefined;
    }
    const checkpoint = buildCheckpoint(mons, readArenaView(), money);
    // Per-turn-HOT: build the summary only when debug is on. Reads the just-built checkpoint, never mutates.
    if (isCoopDebug()) {
      coopLog(
        "checkpoint",
        `host capture field=${checkpoint.field.length} weather=${checkpoint.weather} terrain=${checkpoint.terrain} `
          + `money=${checkpoint.money ?? "none"} `
          + `arenaTags=${checkpoint.arenaTags?.length ?? 0} mons=[${checkpoint.field
            .map(f => `bi${f.bi}:sp${f.speciesId}/hp${f.hp}-${f.maxHp}/st${f.status}/fnt${f.fainted ? 1 : 0}`)
            .join(" ")}]`,
      );
    }
    return checkpoint;
  } catch {
    // Never let a capture failure break the host's turn.
    return null;
  }
}

/**
 * GUEST (#633): side-effect-free field removal of one mon - zero hp so it reads as fainted, stamp the
 * FAINT status (VictoryPhase / isFainted(true) checks the status, not just hp - mirrors the host
 * FaintPhase, see #633 trainer-victory deadlock), then leaveField (NO FaintPhase / SwitchPhase /
 * resolution pipeline - that would re-introduce the engine divergence authoritative mode exists to
 * prevent). Shared by the player/enemy reconcile PASS 1 + the non-optional post-PASS-2 orphan sweep.
 * Fully guarded so one bad removal can't break the rest of the reconcile.
 */
function coopRemoveFromField(mon: Pokemon): void {
  try {
    mon.hp = 0;
    mon.doSetStatus(StatusEffect.FAINT);
    mon.leaveField(true, true, false);
  } catch {
    /* one removal failed; leave it and continue the reconcile */
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
      // Side-effect-free removal via the shared helper (#633 trainer-victory deadlock): it stamps
      // doSetStatus(FAINT) before leaveField exactly like the host FaintPhase, so the off-field KOd
      // enemy reads isFainted(true)===true - VictoryPhase's win guard checks the STATUS, not just hp.
      coopRemoveFromField(enemy);
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
    // C.2 (#633, MAJOR-3) - NON-OPTIONAL post-PASS-2 orphan sweep: PASS 2's swap (and the incoming-vacate
    // inside summonCoopEnemyField) can leave a fresh on-field orphan at an enemy slot the host reports
    // NOT alive. PASS 1 only saw the pre-PASS-2 state, so re-run the removal for any on-field guest enemy
    // whose bi is not in the host's alive set.
    for (const enemy of globalScene.getEnemyField(true)) {
      if (enemy == null || !enemy.isActive() || !enemy.isOnField()) {
        continue;
      }
      const bi = enemy.getBattlerIndex();
      if (bi < BattlerIndex.ENEMY || hostAliveEnemies.has(bi)) {
        continue;
      }
      coopLog("field", `enemy post-PASS2 orphan sweep removing bi=${bi} speciesId=${enemy.species?.speciesId ?? 0}`);
      coopRemoveFromField(enemy);
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
    // #633 ("sprites shifting right / superimposing on switch-in"): the coop summon has no pokeball-throw
    // to land the incoming mon's ABSOLUTE position, and resetSummonData() does NOT reset x/y/fieldPosition,
    // so without re-seating it the incoming sprite renders at a stale offset on top of the on-field mon.
    // Capture the VACATED slot's exact placement now (before any mutation) and copy it onto the incoming.
    const slotX = outgoing.x;
    const slotY = outgoing.y;
    const slotFieldPosition = outgoing.fieldPosition;
    // C.2 (#633, "switched in on top"): if the incoming mon is currently on-field at a DIFFERENT slot,
    // VACATE that slot first - the swap below moves it to `fieldIndex` but leaves its OLD field slot
    // pointing at a still-on-field sprite (a stale occupant). Side-effect-free (no FaintPhase /
    // SwitchPhase). The post-PASS-2 removal sweep in reconcileCoopEnemyField clears any orphan it leaves.
    if (incoming.isOnField() && party.indexOf(incoming) !== partySlot) {
      try {
        incoming.leaveField(true, true, false);
      } catch {
        /* vacating the incoming's old slot failed; the post-PASS-2 sweep still clears the orphan */
      }
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
    // Re-seat at the vacated slot's exact position + field-position (setFieldPosition is RELATIVE and
    // no-ops when the position already matches, so set the public field directly + place the container)
    // - without this the sprite keeps its stale x and lands shifted-right, superimposed on the old mon.
    incoming.fieldPosition = slotFieldPosition;
    incoming.setPosition(slotX, slotY);
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
export function reconcileCoopPlayerField(
  hostField: { bi: number; fainted: boolean; speciesId?: number; partyIndex?: number }[],
): void {
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
      // Side-effect-free removal (no FaintPhase / resolution pipeline - that would re-introduce the
      // engine divergence authoritative mode exists to prevent).
      coopRemoveFromField(mon);
    }
    // PASS 2 - SWAP/SUMMON: REPOSITION the host's reported mon onto each player field slot (#633:
    // mirror a host partner REPLACEMENT from the bench AND repair a field/party-order divergence -
    // e.g. a guest SELF-SWITCH that was dropped, leaving the right mon ON-FIELD but at the WRONG
    // slot). For each player bi the host reports ALIVE with a `speciesId`, if the guest's mon at that
    // field slot is a DIFFERENT species, find the matching member ANYWHERE in the guest party
    // (bench OR on-field at the wrong slot) and REPOSITION it to the slot via the side-effect-free
    // swap - REPOSITION, never remove-then-resummon (a failed resummon would softlock the field).
    // Duplicate species are DISAMBIGUATED by the host's serialized `partyIndex` (the stable party-slot
    // identity the checksum hashes), not first-species-wins, so two same-species mons can't be crossed.
    // speciesId 0 / absent (an older payload or an enemy slot) is skipped.
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
      // No-op if the correct species is already on this field slot (idempotent re-apply). When the host
      // disambiguates by partyIndex, also require the SAME party-slot identity so a same-species
      // duplicate at this slot is still repositioned to the host's exact member.
      const hostPartyIndex = typeof entry.partyIndex === "number" ? entry.partyIndex : -1;
      if (
        current != null
        && current.species?.speciesId === speciesId
        && (hostPartyIndex < 0 || party.indexOf(current) === hostPartyIndex)
      ) {
        continue;
      }
      // Find the matching member ANYWHERE in the party (bench OR on-field at the wrong slot), so a mon
      // that is on-field-but-mis-slotted is repositioned (the dropped-self-switch case), not just a
      // bench replacement. Prefer the host's exact partyIndex slot to disambiguate duplicate species;
      // fall back to the first species match (older payloads without a usable partyIndex).
      let partySlot = -1;
      if (
        hostPartyIndex >= 0
        && hostPartyIndex !== fieldSlot
        && party[hostPartyIndex]?.species?.speciesId === speciesId
      ) {
        partySlot = hostPartyIndex;
      } else {
        partySlot = party.findIndex((p, i) => p != null && i !== fieldSlot && p.species?.speciesId === speciesId);
      }
      if (partySlot < 0) {
        continue;
      }
      // C.1 diagnostic (#633): PASS 2 is repositioning this mon to a DIFFERENT slot than where it
      // currently sits (partySlot -> fieldSlot). Logged so a future capture shows whether PASS 2 ever
      // DISAGREES with the eager self-switch swap in turn-start-phase (if it never logs for the guest's
      // own switch, the eager swap already matched the host and the orphan fix below is the real cure).
      coopLog(
        "field",
        `player PASS2 reposition speciesId=${speciesId} from=${partySlot} to=${fieldSlot} bi=${entry.bi}`,
      );
      summonCoopPlayerField(fieldSlot, partySlot);
    }
    // C.2 (#633, MAJOR-3) - NON-OPTIONAL post-PASS-2 orphan sweep: PASS 2's repositioning swap (and the
    // incoming-vacate inside summonCoopPlayerField) can leave a fresh on-field orphan at a slot the host
    // reports NOT alive - the "switched in on top" stale sprite. PASS 1 only saw the pre-PASS-2 state, so
    // re-run the removal for any on-field guest player mon whose bi is not in the host's alive set.
    for (const mon of globalScene.getPlayerField(true)) {
      if (mon == null || !mon.isActive() || !mon.isOnField()) {
        continue;
      }
      const bi = mon.getBattlerIndex();
      if (bi >= BattlerIndex.ENEMY || hostAlivePlayers.has(bi)) {
        continue;
      }
      coopLog("field", `player post-PASS2 orphan sweep removing bi=${bi} speciesId=${mon.species?.speciesId ?? 0}`);
      coopRemoveFromField(mon);
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
    // #633 ("sprites shifting right / superimposing on switch-in"): the coop summon has no pokeball-throw
    // to land the incoming mon's ABSOLUTE position, and resetSummonData() does NOT reset x/y/fieldPosition,
    // so without re-seating it the incoming sprite renders at a stale offset on top of the on-field mon.
    // Capture the VACATED slot's exact placement now (before any mutation) and copy it onto the incoming.
    const slotX = outgoing.x;
    const slotY = outgoing.y;
    const slotFieldPosition = outgoing.fieldPosition;
    // C.2 (#633, "switched in on top"): if the incoming mon is currently on-field at a DIFFERENT slot,
    // VACATE that slot first - the swap below moves it to `fieldIndex` but leaves its OLD field slot
    // pointing at a still-on-field sprite, the stale occupant the player sees "switched in on top of"
    // their mon's position. Side-effect-free (no FaintPhase / SwitchPhase). The post-PASS-2 removal
    // sweep in reconcileCoopPlayerField then force-clears any orphan this leaves.
    if (incoming.isOnField() && party.indexOf(incoming) !== partySlot) {
      try {
        incoming.leaveField(true, true, false);
      } catch {
        /* vacating the incoming's old slot failed; the post-PASS-2 sweep still clears the orphan */
      }
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
    // #791 (live "the UI is placed on top of the other"): the OUTGOING capture is unreliable
    // after a FAINT - the drop animation tweened that container low, so seating the incoming at
    // outgoing.x/y parked the new sprite over the bottom UI. Derive the side's CANONICAL base
    // from a LIVE ally when one exists (its x/y minus its own slot offset); fall back to the
    // outgoing capture minus the slot's offset otherwise. Then seat via the REAL
    // setFieldPosition (duration 0): it applies the slot offset AND the battle-info seating
    // (setMini + setSlotOffset) that the old direct fieldPosition write bypassed - which is why
    // the new mon's HP bar rendered full-size ON TOP of the ally's bar.
    incoming.fieldPosition = slotFieldPosition;
    const slotOffset = incoming.getFieldPositionOffset();
    let baseX = slotX - slotOffset[0];
    let baseY = slotY - slotOffset[1];
    const liveAlly = globalScene
      .getPlayerField(true)
      .find(p => p != null && p !== incoming && p !== outgoing && p.isActive() && p.isOnField());
    if (liveAlly != null) {
      const allyOffset = liveAlly.getFieldPositionOffset();
      baseX = liveAlly.x - allyOffset[0];
      baseY = liveAlly.y - allyOffset[1];
    }
    incoming.fieldPosition = FieldPosition.CENTER;
    incoming.setPosition(baseX, baseY);
    void incoming.setFieldPosition(slotFieldPosition, 0);
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
 * GUEST: reconcile the live arena tags to exactly the host's set (#633 GAP 1). Hazards / screens
 * / tailwind (Stealth Rock, Spikes, Reflect, Light Screen, Tailwind, ...) are set by host
 * MoveEffectPhases the pure-renderer guest never runs, so the guest never gains them and the
 * per-turn checksum (which hashes `(tagType, side)`) resync-loops forever. This matches the guest's
 * `arena.tags` to the host's by `(tagType, side)`:
 *  - ADD any host tag the guest lacks (`arena.addTag`, then force the host's `turnCount`; for a
 *    multi-layer entry hazard, replay `onOverlap` up to the host's layer count).
 *  - REMOVE any guest tag the host doesn't have (`arena.removeTagOnSide`).
 *  - For a tag present on BOTH, force the host's `turnCount` (a screen the host refreshed) without
 *    touching anything the checksum hashes - turn counts are excluded by design, so this only fixes
 *    rendering and can never trip a false desync.
 * Idempotent (re-applying the same set is a no-op once converged). The `addTag` / `removeTagOnSide`
 * APIs may queue an on-add / on-remove message + animation; that is acceptable for a renderer. Fully
 * guarded so one bad tag can't break the rest of the heal. A `null`/`undefined` `hostTags` (an older
 * payload that never carried tags) is a hard skip - the guest's tags are left exactly as they were.
 */
export function reconcileArenaTags(hostTags: CoopSerializedArenaTag[] | undefined): void {
  if (hostTags == null) {
    return;
  }
  try {
    const arena = globalScene.arena;
    // Key a tag by (tagType, side) - the checksum's identity. The host set is the source of truth.
    const keyOf = (tagType: string, side: number): string => `${tagType}|${side}`;
    const wanted = new Map<string, CoopSerializedArenaTag>();
    for (const t of hostTags) {
      if (typeof t.tagType === "string") {
        wanted.set(keyOf(t.tagType, t.side), t);
      }
    }
    // REMOVE: drop every guest tag the host no longer has (iterate a snapshot - removal mutates the array).
    for (const tag of [...arena.tags]) {
      const k = keyOf(tag.tagType as unknown as string, tag.side as unknown as number);
      if (!wanted.has(k)) {
        coopWarn("heal", `arenaTag REMOVE tagType=${tag.tagType} side=${tag.side} (host lacks it) -> removed`);
        try {
          arena.removeTagOnSide(tag.tagType, tag.side, true);
        } catch {
          /* one tag removal failed; continue */
        }
      }
    }
    // ADD / REFRESH: ensure every host tag exists with the host's turnCount + layers.
    for (const want of wanted.values()) {
      try {
        const tagType = want.tagType as unknown as ArenaTagType;
        const side = want.side as unknown as ArenaTagSide;
        let existing = arena.getTagOnSide(tagType, side);
        if (existing == null) {
          coopWarn(
            "heal",
            `arenaTag ADD tagType=${want.tagType} side=${want.side} layers=${want.layers} turnCount=${want.turnCount} (guest lacked it) -> added`,
          );
          // Side-effect-quiet add (no source move / id needed for a render of an already-resolved tag).
          arena.addTag(tagType, Math.max(0, Math.trunc(want.turnCount)), undefined as unknown as MoveId, 0, side, true);
          existing = arena.getTagOnSide(tagType, side);
          // Replay overlaps to reach the host's entry-hazard layer count (Spikes / Toxic Spikes).
          if (existing instanceof EntryHazardTag) {
            for (let i = existing.layers; i < want.layers; i++) {
              existing.onOverlap();
            }
          }
        }
        // Force the host's turnCount (a refreshed screen / pinch-restored hazard). Excluded from
        // the hash, so this only corrects rendering and never causes a false desync.
        if (existing != null) {
          existing.turnCount = Math.max(0, Math.trunc(want.turnCount));
        }
      } catch {
        /* one tag add/refresh failed; continue with the rest */
      }
    }
  } catch {
    // A malformed arena-tag set must never crash the guest's battle.
  }
}

/**
 * GUEST: snap the live field + arena to the host's authoritative `checkpoint`. Applied
 * at a turn boundary. Conservative + fully guarded: corrects numeric state only, and a
 * per-mon failure is swallowed so one bad entry can't break the rest of the battle.
 */
export function applyCoopCheckpoint(checkpoint: CoopBattleCheckpoint): void {
  try {
    coopLog(
      "checkpoint",
      `guest apply field=${checkpoint.field?.length ?? 0} weather=${checkpoint.weather} terrain=${checkpoint.terrain} arenaTags=${checkpoint.arenaTags?.length ?? 0}`,
    );
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
          if (isCoopDebug()) {
            const wantHp = Math.min(state.hp, mon.getMaxHp());
            const guestStatus = mon.status?.effect ?? 0;
            if (mon.hp !== wantHp || guestStatus !== (state.status ?? 0)) {
              coopWarn(
                "checkpoint",
                `mon bi=${mon.getBattlerIndex()} hp host=${wantHp} guest=${mon.hp} status host=${state.status ?? 0} guest=${guestStatus} -> applied`,
              );
            }
          }
          mon.hp = Math.min(state.hp, mon.getMaxHp());
          mon.status = state.status ? new Status(state.status as StatusEffect) : null;
          const stages = mon.getStatStages();
          for (let i = 0; i < 7 && i < stages.length; i++) {
            stages[i] = state.statStages[i];
          }
          repairErTags(mon, state.erTags);
          // #798 PP sync: adopt the host's ppUsed PER MATCHING MOVE ID. Deliberately
          // conservative - never adds/removes/reorders moves (learn-move has its own relay);
          // an id mismatch skips that slot and the resync backstop still heals it.
          // #804 slot-ownership heal: adopt the host-resolved owner tag on PLAYER mons,
          // GUARDED (never clear on undefined - same rule as applyFullMon). Divergent tags
          // made both clients resolve a slot as the partner's (the ME battle deadlock);
          // per-turn adoption keeps command routing agreed on both engines.
          if (state.coopOwner !== undefined && mon.isPlayer()) {
            const cur = (mon as { coopOwner?: "host" | "guest" }).coopOwner;
            if (cur !== state.coopOwner) {
              coopWarn(
                "checkpoint",
                `mon bi=${mon.getBattlerIndex()} coopOwner host=${state.coopOwner} guest=${cur ?? "-"} -> adopted (#804)`,
              );
              (mon as { coopOwner?: "host" | "guest" }).coopOwner = state.coopOwner;
            }
          }
          if (state.moves !== undefined && Array.isArray(mon.moveset)) {
            for (const wire of state.moves) {
              const slot = mon.moveset.find(m => m?.moveId === wire.id);
              if (slot != null && slot.ppUsed !== wire.ppUsed) {
                slot.ppUsed = Math.max(0, Math.trunc(wire.ppUsed));
              }
            }
          }
          void mon.updateInfo();
        }
      } catch {
        /* one mon's correction failed; leave it and continue */
      }
    }
    // Correct weather / terrain type if it drifted (turn counts are approximate).
    const arena = globalScene.arena;
    if ((arena.weather?.weatherType ?? 0) !== checkpoint.weather) {
      coopWarn("checkpoint", `weather host=${checkpoint.weather} guest=${arena.weather?.weatherType ?? 0} -> applied`);
      arena.trySetWeather(checkpoint.weather as WeatherType);
    }
    if ((arena.terrain?.terrainType ?? 0) !== checkpoint.terrain) {
      coopWarn("checkpoint", `terrain host=${checkpoint.terrain} guest=${arena.terrain?.terrainType ?? 0} -> applied`);
      arena.trySetTerrain(checkpoint.terrain as TerrainType, true);
    }
    // Reconcile arena tags (#633 GAP 1): add hazards/screens/tailwind the guest's MoveEffectPhases
    // never set, remove ones the host cleared. This is the top resync-loop fix - the checksum hashes
    // `(tagType, side)`, so converging the SET is what makes it stop diverging every turn.
    reconcileArenaTags(checkpoint.arenaTags);
    // Mirror the host's authoritative MONEY (#633/#698 money transient). The pure-renderer guest never
    // runs the host-only money mutations (between-wave reward-shop BUY, in-battle Pay Day / scattered-money
    // pickup), so its money lags until a full resync heals it. Force-SETTING the host's value every turn
    // mirrors it continuously, so the visible "host=824 guest=1000" transient never shows (the first turn
    // of the wave after a shop spend snaps it). GATED to the authoritative GUEST so solo / host / lockstep
    // never touch money here (the host owns + computes its own money; only the renderer adopts it). Additive:
    // an older host omits `money` (undefined) and the guest leaves its money alone (no regression).
    if (checkpoint.money !== undefined && isCoopAuthoritativeGuestGated() && globalScene.money !== checkpoint.money) {
      coopWarn("checkpoint", `money host=${checkpoint.money} guest=${globalScene.money} -> applied`);
      globalScene.money = checkpoint.money;
      globalScene.updateMoneyText();
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
        // Boss adopt (#633, A/BLOCKING-2): boss state lives ONLY on EnemyPokemon and is hardcoded
        // `false` on the guest's `addEnemyPokemon` reconstruct, so an adopted boss renders normal
        // bars. Carry the host's authoritative segment count + current index + maxHp ceiling so the
        // guest can `setBoss` with the EXPLICIT count (never re-rolling from its diverged wave RNG)
        // and render the right shield dividers. Additive: solo never streams this.
        isBoss: enemy.isBoss(),
        bossSegments: enemy.bossSegments,
        bossSegmentIndex: enemy.bossSegmentIndex,
        maxHp: enemy.getMaxHp(),
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
 * HOST: serialize ONE live mon's held-item modifiers as plain `ModifierData` blobs (#633). Reads the
 * mon's OWN side list (player list when `mon.isPlayer()`, else the enemy list) filtered to this mon by
 * `pokemonId`. Each entry survives the JSON transport as a flat object; the guest reconstructs it via
 * {@linkcode ModifierData.toModifier}. Used for both the enemy adopt (via {@linkcode captureEnemyHeldItems})
 * and the on-field player/enemy resync snapshot (#633 RISKY #1/#2/#3).
 */
function captureCoopHeldItems(mon: Pokemon): Record<string, unknown>[] {
  try {
    return globalScene
      .findModifiers(m => m instanceof PokemonHeldItemModifier && m.pokemonId === mon.id, mon.isPlayer())
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
 * HOST: serialize one enemy's held-item modifiers as plain `ModifierData` blobs (#633). Thin wrapper
 * over {@linkcode captureCoopHeldItems} so {@linkcode captureCoopEnemies} stays byte-identical (an enemy's
 * `isPlayer()` is false -> the enemy list, exactly as before).
 */
function captureEnemyHeldItems(enemy: ReturnType<typeof globalScene.getEnemyParty>[number]): Record<string, unknown>[] {
  return captureCoopHeldItems(enemy);
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

/**
 * GUEST (authoritative resync): set a LIVE on-field mon's held items to exactly the host's snapshot
 * set (#633 RISKY #1/#2/#3). Removes the mon's current held items, then re-attaches the host's.
 * Hardened vs {@linkcode applyCoopEnemyHeldItems} (which only runs on a fresh enemy): operates on a LIVE
 * mon that may already hold items, so it (a) verifies each remove before re-adding to avoid a silent
 * incrementStack MERGE, (b) sets stackCount explicitly from the blob, (c) NEVER re-attaches a
 * `PokemonFormChangeItemModifier` (the form is authoritative via `snap.formIndex`; re-firing its apply()
 * on the player side would trigger a spurious form change), and (d) uses ignoreUpdate so no per-mon bar
 * re-render / "bag full" toast. Returns true if it changed anything (so the caller refreshes the right
 * bar once). Fully guarded.
 */
function applyCoopHeldItemsForMon(mon: Pokemon, heldItems: unknown): boolean {
  if (!Array.isArray(heldItems)) {
    return false;
  }
  let changed = false;
  // Per-mon diagnostic accumulators (#633): which held-item typeIds we removed/re-added on this mon, so
  // a tester reading the log sees the EXACT held-item rebind a Knock-Off / Grip-Claw / Covet desync caused.
  const debug = isCoopDebug();
  const removedTypeIds: string[] = [];
  const addedTypeIds: string[] = [];
  try {
    const isPlayer = mon.isPlayer();
    // 1) remove existing held items on this mon (each guarded by the removeModifier return). Track the
    // GENUINE SURVIVORS - items whose removeModifier returned FALSE (never spliced from the list) - by
    // object identity. Those, and ONLY those, are the pre-existing held items a re-add in step 2 must
    // not re-introduce a duplicate of. An item this heal pass itself re-adds is NEVER a survivor, so it
    // can never block a later same-type-id add (the #698 BERRY,BERRY drop). PokeRogue's PersistentModifier.
    // add() already merges by matchType() (BerryModifier keys on berryType, AttackTypeBoosterModifier on
    // moveType, etc.), so two DISTINCT same-type-id items (two different berries) are each pushed, while
    // two truly-identical items arrive from the host as ONE blob with stackCount and are added once.
    const survivors: PokemonHeldItemModifier[] = [];
    for (const m of globalScene.findModifiers(
      x => x instanceof PokemonHeldItemModifier && x.pokemonId === mon.id,
      isPlayer,
    )) {
      if (globalScene.removeModifier(m, !isPlayer)) {
        if (debug) {
          removedTypeIds.push(m.type.id);
        }
        changed = true;
      } else {
        // removeModifier returned false: this item was NOT in the list / not spliced -> a genuine
        // pre-existing survivor that the host's set must not duplicate.
        survivors.push(m as PokemonHeldItemModifier);
      }
    }
    // 2) re-attach the host's set.
    for (const raw of heldItems) {
      if (raw == null || typeof raw !== "object") {
        continue;
      }
      try {
        const data = new ModifierData(raw as Record<string, unknown>, false);
        const modifier = data.toModifier(
          Modifier[data.className as keyof typeof Modifier] ?? resolveErModifierClass(data.className),
        );
        // Held items ONLY; never re-fire a form-change item's apply() (the form is healed by snap.formIndex).
        if (!(modifier instanceof PokemonHeldItemModifier)) {
          continue;
        }
        if (modifier instanceof Modifier.PokemonFormChangeItemModifier) {
          continue;
        }
        // The serialized id is the HOST's runtime id; remap to THIS client's live mon id.
        modifier.pokemonId = mon.id;
        // stackCount from the blob (toModifier already restores it; re-assert defensively).
        if (typeof data.stackCount === "number") {
          modifier.stackCount = data.stackCount;
        }
        // Skip ONLY if a GENUINE SURVIVOR (an item step 1 could not remove) MATCH-TYPES this new item -
        // i.e. addModifier would silently MERGE into it (a stack drift) instead of binding a fresh copy.
        // Crucially this is matchType (the same predicate addModifier merges on), NOT type.id, so a second
        // DISTINCT same-type-id item (the #698 two-berries case) is no longer falsely dropped, and an item
        // THIS pass already re-added is never in `survivors` so it can never block a later same-type add.
        const collidesSurvivor = survivors.some(s => modifier.matchType(s));
        if (collidesSurvivor) {
          continue;
        }
        if (isPlayer) {
          void globalScene.addModifier(modifier, true, false, false);
        } else {
          void globalScene.addEnemyModifier(modifier, true);
        }
        if (debug) {
          addedTypeIds.push(modifier.type.id);
        }
        changed = true;
      } catch {
        /* one item failed to reconstruct; keep the rest */
      }
    }
  } catch {
    /* never break the heal */
  }
  if (debug && changed) {
    coopWarn(
      "heal",
      `heldItems monId=${mon.id} bi=${mon.getBattlerIndex()} removed=[${removedTypeIds.join(",")}] added=[${addedTypeIds.join(",")}] -> applied`,
    );
  }
  return changed;
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
        // Boss adopt mirror (#633, A/MINOR-2): the mid-wave by-index overwrite must ALSO re-assert
        // boss state, with the EXPLICIT host count (never the diverged-RNG `getEncounterBossSegments`
        // fallback) + the host's index. This path runs at the wave's first-turn boundary with the bar
        // ALREADY SHOWN, so `initBattleInfo()` (which, on an existing battleInfo, dispatches to
        // `updateBossSegments` rather than rebuilding) re-renders the segmented bar in place.
        const bossSegments = num(d, "bossSegments");
        if (bossSegments !== undefined && bossSegments > 0) {
          enemy.setBoss(true, bossSegments);
          const bsi = num(d, "bossSegmentIndex");
          if (bsi !== undefined) {
            enemy.bossSegmentIndex = bsi;
          }
          enemy.initBattleInfo();
        }
        const hp = num(d, "hp");
        if (hp !== undefined) {
          const maxHp = num(d, "maxHp");
          const ceiling = maxHp !== undefined && maxHp > 0 ? maxHp : enemy.getMaxHp();
          enemy.hp = Math.max(0, Math.min(hp, ceiling));
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

/**
 * HOST: serialize the player-wide PERSISTENT modifiers as plain `ModifierData` blobs (#698 / #633
 * BUG 2). These are the NON-held-item `PersistentModifier`s on `globalScene.modifiers` (relics, EXP /
 * temp-stat-stage boosters, lures, candy jar, ...). Carried in the resync so the gated guest heal can
 * RECONSTRUCT one it is missing - the `[typeId, stackCount]` digest can't (a temp stat booster needs
 * its stat arg, an attack-type booster its type). Held items are EXCLUDED (they ride per-mon in
 * `field[].heldItems`); `PokemonFormChangeItemModifier`s are EXCLUDED too (healed via snap.formIndex).
 * Mirrors the held-item / enemy ModifierData serialization (`new ModifierData(m, false)`). Fully guarded.
 */
export function captureCoopPlayerModifiers(): Record<string, unknown>[] {
  try {
    return globalScene.modifiers
      .filter(
        m =>
          m instanceof PersistentModifier
          && !(m instanceof PokemonHeldItemModifier)
          && !(m instanceof Modifier.PokemonFormChangeItemModifier),
      )
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
 * ON-FIELD per-mon held-item identity digest as `[bi, typeId, stackCount]`, sorted (#633 RISKY #2/#3).
 * Iterates the SAME `getField(true)` set the checksum already hashes (and the snapshot can heal), reading
 * each mon's held items by `pokemonId` on that mon's OWN side list - so detection and heal cover identical
 * mons (no detect-but-can't-heal loop; BENCH items are deliberately excluded). Deterministic: only `bi`,
 * `type.id` (a stable string), and `stackCount` - never the per-client `pokemonId` or any RNG.
 */
function readHeldItemDigest(): [number, string, number][] {
  try {
    const out: [number, string, number][] = [];
    for (const mon of globalScene.getField(true)) {
      if (mon == null) {
        continue;
      }
      const bi = mon.getBattlerIndex();
      for (const m of globalScene.findModifiers(
        x => x instanceof PokemonHeldItemModifier && x.pokemonId === mon.id,
        mon.isPlayer(),
      )) {
        out.push([bi, m.type.id, m.stackCount]);
      }
    }
    return out.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] - b[2]));
  } catch {
    return [];
  }
}

/** Ball inventory as `[ballType, count]`, sorted by ballType (#633 RISKY #4). Plain ints, no RNG. */
function readPokeballCounts(): [number, number][] {
  try {
    return Object.entries(globalScene.pokeballCounts)
      .map(([k, v]) => [Number(k), Number(v)] as [number, number])
      .sort((a, b) => a[0] - b[0]);
  } catch {
    return [];
  }
}

/**
 * Read a live mon's boss state (#633, A/BLOCKING-2): `[bossSegments, bossSegmentIndex]`. Player mons
 * (and any non-enemy) read `[0, 0]` - boss state lives only on `EnemyPokemon`. Carried in the checksum
 * + the resync so a missing/diverged-boss guest is detectable + healable.
 */
function readBossState(mon: Pokemon): { bossSegments: number; bossSegmentIndex: number } {
  try {
    if (mon instanceof EnemyPokemon) {
      return { bossSegments: mon.bossSegments ?? 0, bossSegmentIndex: mon.bossSegmentIndex ?? 0 };
    }
  } catch {
    /* fall through to the non-boss default */
  }
  return { bossSegments: 0, bossSegmentIndex: 0 };
}

/** Read a live mon's Tera state (#633 GAP 7): whether Terastallized + the tera type (0 on error). */
function readTeraState(mon: Pokemon): { isTerastallized: boolean; teraType: number } {
  try {
    return { isTerastallized: mon.isTerastallized === true, teraType: (mon.teraType as unknown as number) ?? 0 };
  } catch {
    return { isTerastallized: false, teraType: 0 };
  }
}

/** Build the canonical checksum view of ONE live field mon. */
function readChecksumMon(mon: Pokemon): CoopChecksumMon {
  const tera = readTeraState(mon);
  const boss = readBossState(mon);
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
    // Tera state (#633 GAP 7): a dropped Tera command is now a hashed identity divergence.
    isTerastallized: tera.isTerastallized,
    teraType: tera.teraType,
    // Boss state (#633, A/BLOCKING-2): a missing/diverged boss (count OR index) is now detectable.
    bossSegments: boss.bossSegments,
    bossSegmentIndex: boss.bossSegmentIndex,
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
    // Party LEVELS in slot order (#633 B4): detect a bench-mon level drift the speciesId-only
    // `party` list misses (the live revive-in-shop desync). Settled at the CommandPhase boundary.
    partyLevels: globalScene.getPlayerParty().map(p => p.level),
    money: globalScene.money,
    modifiers: readModifiers(),
    // On-field per-mon held-item digest (#633 RISKY #2/#3): a stack change (Bug-Bite/Knock-Off) or a
    // wrong-holder rebind (Grip Claw/Covet) among on-field mons - same global total, invisible to the
    // aggregate `modifiers` digest - is now a hashed divergence the snapshot held-item heal can close.
    heldItems: readHeldItemDigest(),
    // Ball inventory (#633 RISKY #4): the host decrements it host-only in AttemptCapturePhase (which the
    // pure-renderer guest never runs), so its inventory drifts; hashing it makes that drift detectable.
    pokeballCounts: readPokeballCounts(),
    // Active biome (B7): an independent biome re-roll (a seed/waveIndex drift that landed the two
    // clients in DIFFERENT biomes) is otherwise invisible to the field-only checkpoint. Settled at
    // the turn boundary (SwitchBiomePhase's newArena blocks the next checksum until it ends).
    biomeId: arena.biomeId ?? 0,
    // Run seed (B8): the master determinism input. runConfig-pinned identical across healthy clients;
    // only setSeed mutates it (never mid-turn), so it differs ONLY on a real seed split.
    seed: globalScene.seed ?? "",
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
    const state = captureCoopChecksumState();
    const digest = checksumState(state);
    // Per-turn-HOT: guard the whole summary build so the (large) key=value string is only ever
    // assembled when debug logging is on. Reads `state` only - never mutates it. This lets the two
    // clients' captures be eyeballed side-by-side in the log to find WHICH field fed a divergent hash.
    if (isCoopDebug()) {
      coopLog(
        "checksum",
        `capture digest=${digest} `
          + `field=${state.field.length} biome=${state.biomeId} seed=${state.seed} `
          + `weather=${state.weather} terrain=${state.terrain} money=${state.money} `
          + `party=[${state.party.join(",")}] partyLevels=[${state.partyLevels.join(",")}] `
          + `arenaTags=${state.arenaTags.length} modifiers=${state.modifiers.length} `
          + `heldItemsDigest=${state.heldItems.length} pokeballs=[${state.pokeballCounts.map(([t, c]) => `${t}:${c}`).join(",")}] `
          + `mons=[${state.field
            .map(
              m =>
                `bi${m.bi}:sp${m.speciesId}/hp${m.hp}-${m.maxHp}/st${m.status}/ab${m.abilityId}/form${m.formIndex}`
                + `/tera${m.isTerastallized ? 1 : 0}:${m.teraType}/boss${m.bossSegments}:${m.bossSegmentIndex}`,
            )
            .join(" ")}]`,
      );
    }
    return digest;
  } catch {
    coopWarn("checksum", "captureCoopChecksum read failed -> sentinel (comparison skipped)");
    return COOP_CHECKSUM_SENTINEL;
  }
}

/** Build ONE field mon's full resync snapshot (superset of the checkpoint). */
function readFullMon(mon: Pokemon): CoopFullMonSnapshot {
  const tera = readTeraState(mon);
  const boss = readBossState(mon);
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
    // Tera state (#633 GAP 7): forced in the snapshot apply so a dropped Tera command heals.
    isTerastallized: tera.isTerastallized,
    teraType: tera.teraType,
    // Authoritative level + exp (#633, B): forced TOGETHER on the guest so the stat recompute uses the
    // authoritative base (closes maxHp at root). `levelExp` is a derived getter, so no stale field.
    level: mon.level,
    exp: mon.exp,
    // Boss state (#633, A/BLOCKING-2): re-asserted on resync so boss bars + shield dividers heal.
    bossSegments: boss.bossSegments,
    bossSegmentIndex: boss.bossSegmentIndex,
    moves: readMoves(mon),
    tags: readTagTypes(mon),
    // On-field held items (#633 RISKY #1/#2/#3): the heavy ModifierData blobs the compact checksum
    // digest can't carry; the gated guest heal sets the live mon's items to this exact set.
    heldItems: captureCoopHeldItems(mon),
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
      // Rich arena tags (#633 GAP 1): the resync path reconciles the guest's arena identically to
      // the per-turn checkpoint (hazards / screens / tailwind), carrying turnCount + layers.
      arenaTags: readArenaTagViews(),
      party: globalScene.getPlayerParty().map(p => p.species.speciesId),
      money: globalScene.money,
      modifiers: readModifiers(),
      // Player-wide persistent modifier BLOBS (#698 / #633 BUG 2): the full ModifierData of the
      // NON-held-item PersistentModifiers, so the gated guest heal can RECONSTRUCT a player-wide
      // modifier it is MISSING (a temp stat booster, an EXP charm, ...) - the `[typeId, stackCount]`
      // `modifiers` digest above can only fix a stack / remove an extra, never re-create one with args.
      // Captured UNCONDITIONALLY (additive); only READ inside the gated authoritative heal.
      playerModifiers: captureCoopPlayerModifiers(),
      // Ball inventory (#633 RISKY #4): carried in the resync so the gated guest heal restores the
      // host-only AttemptCapturePhase decrement the pure-renderer guest never applied.
      pokeballCounts: readPokeballCounts(),
      // Full per-mon PokemonData for the WHOLE party (#633 B4): the resync now carries bench-mon
      // level / exp / form / friendship / moveset (+ a host off-field evolution's species) so the
      // revive-in-shop desync heals - the on-field-only `field` + speciesId-only `party` cannot.
      // Reuses the capture-handshake serialize; applied (gated guest-only) in applyCoopFullSnapshot.
      benchParty: captureCoopCaptureParty(),
      // Biome + run seed (B7/B8): the guest heals a biome split (newArena) + re-pins the run seed /
      // wave seed on ANY resync. `?? ""` / `?? 0` so the literal never carries an explicit undefined
      // into a `?: T` field (exactOptional safety); the apply's length-guard skips an empty seed.
      biomeId: arena.biomeId ?? 0,
      seed: globalScene.seed ?? "",
      waveSeed: globalScene.waveSeed ?? "",
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

/**
 * GUEST: rebuild a mon's moveset from the host's move IDs when they STRUCTURALLY differ (#633
 * GAP 7), preserving the host's ppUsed per slot. Mirrors how {@linkcode applyCoopEnemies} rebuilds
 * an enemy moveset. A pure ppUsed-only divergence is left to the per-slot align below (no rebuild).
 * Returns true when it rebuilt (so the caller skips the per-slot ppUsed align). Fully guarded.
 */
function rebuildMovesetIfStructurallyDiverged(mon: Pokemon, snapMoves: [number, number][]): boolean {
  try {
    const localIds = mon.getMoveset().map(m => m.moveId);
    const hostIds = snapMoves.map(([id]) => id).filter(id => typeof id === "number" && id > 0);
    if (hostIds.length === 0) {
      return false;
    }
    const sameStructure = localIds.length === hostIds.length && localIds.every((id, i) => id === hostIds[i]);
    if (sameStructure) {
      return false;
    }
    // Move IDs differ - rebuild from the host's list (not just align PP), then set each ppUsed.
    mon.moveset = snapMoves
      .filter(([id]) => typeof id === "number" && id > 0)
      .map(([id, ppUsed]) => {
        const pm = new PokemonMove(id);
        pm.ppUsed = Math.max(0, Math.trunc(ppUsed ?? 0));
        return pm;
      });
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply ONE full mon snapshot onto a live mon (ability/form/tera/level FIRST, then stats, then hp,
 * then boss). `authoritativeGuest` (#633): the {@linkcode isCoopAuthoritativeGuest} gate result,
 * computed by the cycle-free caller (the engine must NOT import the runtime - that would create an
 * import cycle) and threaded down; the level/exp + boss re-assert branches fire ONLY when true, so
 * solo / host / lockstep stay byte-identical. `suppressResummon` (#633, MINOR-1): when a divergence
 * has failed to heal twice in a row on the same dimensions, skip the heavy boss bar rebuild (keep the
 * cheap scalar writes) so an unclosable boss divergence degrades to a static wrong-bar instead of a
 * per-turn re-render storm.
 */
function applyFullMon(
  mon: Pokemon,
  snap: CoopFullMonSnapshot,
  authoritativeGuest: boolean,
  suppressResummon = false,
): void {
  try {
    // Authoritative level + exp (#633, B): the guest is a pure renderer; adopt the host's level/exp
    // so the stat recompute below uses the authoritative base (closes maxHp at ROOT, not just masked
    // by the setStat force below). Forced TOGETHER + ONLY when level differs: `levelExp` is a derived
    // getter (exp - getLevelTotalExp(level)), so setting both consistent values keeps it consistent
    // and the guest never independently levels (it runs no ExpPhase, so no spurious LevelUpPhase).
    if (authoritativeGuest && typeof snap.level === "number" && snap.level > 0 && mon.level !== snap.level) {
      coopWarn("resync", `level force bi=${snap.bi} host=${snap.level} guest=${mon.level}`);
      mon.level = snap.level;
      if (typeof snap.exp === "number") {
        mon.exp = snap.exp;
      }
    }
    // Ability / form first so a stat recompute uses the authoritative values.
    if (mon.formIndex !== snap.formIndex) {
      coopWarn("heal", `formIndex bi=${snap.bi} host=${snap.formIndex} guest=${mon.formIndex} -> applied`);
      mon.formIndex = snap.formIndex;
    }
    // Active ability: if the host's authoritative active ability differs from what this
    // mon currently resolves, pin it via the summon-data override slot so getAbility()
    // returns the host's value exactly (0 = unreadable on the host -> leave ours alone).
    if (snap.abilityId !== 0 && mon.getAbility().id !== snap.abilityId) {
      coopWarn("heal", `abilityId bi=${snap.bi} host=${snap.abilityId} guest=${mon.getAbility().id} -> applied`);
      mon.summonData.ability = snap.abilityId as AbilityId;
    }
    // Tera state (#633 GAP 7): force the host's authoritative Tera state so a dropped/extra Tera
    // command heals (it changes the mon's type/STAB, which the per-turn checkpoint can't carry).
    // Set BEFORE calculateStats so a tera-driven stat path uses the authoritative flag.
    if (snap.isTerastallized !== undefined) {
      if (mon.isTerastallized !== snap.isTerastallized) {
        coopWarn(
          "heal",
          `tera bi=${snap.bi} host=${snap.isTerastallized ? 1 : 0} guest=${mon.isTerastallized ? 1 : 0} -> applied`,
        );
      }
      mon.isTerastallized = snap.isTerastallized;
    }
    if (snap.teraType !== undefined) {
      if ((mon.teraType as unknown as number) !== snap.teraType) {
        coopWarn("heal", `teraType bi=${snap.bi} host=${snap.teraType} guest=${mon.teraType} -> applied`);
      }
      mon.teraType = snap.teraType as unknown as Pokemon["teraType"];
    }
    // Moveset: REBUILD from the host's move IDs when they structurally differ (#633 GAP 7); else
    // only align ppUsed per slot (the lockstep-identical common case).
    const rebuilt = rebuildMovesetIfStructurallyDiverged(mon, snap.moves);
    if (!rebuilt) {
      const moveset = mon.getMoveset();
      for (let i = 0; i < moveset.length && i < snap.moves.length; i++) {
        const [, ppUsed] = snap.moves[i];
        if (moveset[i] != null && typeof ppUsed === "number") {
          moveset[i].ppUsed = Math.max(0, ppUsed);
        }
      }
    }
    reconcileTags(mon, snap.tags);
    // On-field held-item heal (#633 RISKY #1/#2/#3): set the live mon's held items to exactly the host's
    // snapshot set BEFORE calculateStats so a stat-affecting item (e.g. Eviolite) is present for the
    // recompute. Gated authoritative (solo / host / lockstep never run it); the per-mon bar refresh is
    // deferred to ONE updateModifiers call after the field loop in applyCoopFullSnapshot (C4).
    if (authoritativeGuest && snap.heldItems !== undefined) {
      const heldChanged = applyCoopHeldItemsForMon(mon, snap.heldItems);
      if (heldChanged) {
        const hostTypeIds = Array.isArray(snap.heldItems)
          ? snap.heldItems
              .map(h => (h != null && typeof h === "object" ? (h as Record<string, unknown>).typeId : undefined))
              .filter((t): t is string => typeof t === "string")
          : [];
        coopWarn("heal", `heldItems bi=${snap.bi} host=[${hostTypeIds.join(",")}] -> applied (rewrote to host set)`);
      }
    }
    mon.calculateStats();
    // maxHp force (#633 GAP 3): the checkpoint clamps hp to the LOCAL getMaxHp(); if maxHp itself
    // diverged (IV / level / form / stat-calc mismatch) hp clamps to the wrong ceiling and the
    // snapshot only setting hp leaves a permanent loop. After the recompute, if our maxHp still
    // differs from the host's, FORCE the HP stat to the host value so getMaxHp() matches and hp
    // clamps correctly. A loud warn surfaces the UPSTREAM stat divergence for a later root-cause fix
    // (forcing maxHp stops the loop but MASKS the real cause; the log makes it findable).
    if (typeof snap.maxHp === "number" && snap.maxHp > 0 && mon.getMaxHp() !== Math.trunc(snap.maxHp)) {
      coopWarn("resync", `maxhp divergence bi=${snap.bi} host=${Math.trunc(snap.maxHp)} guest=${mon.getMaxHp()}`);
      mon.setStat(Stat.HP, Math.trunc(snap.maxHp));
    }
    // Status.
    const prevStatus = mon.status?.effect ?? 0;
    if (prevStatus !== (snap.status ?? 0)) {
      coopWarn("heal", `status bi=${snap.bi} host=${snap.status ?? 0} guest=${prevStatus} -> applied`);
    }
    mon.status = snap.status ? new Status(snap.status as StatusEffect) : null;
    // Stat stages (7).
    const stages = mon.getStatStages();
    if (isCoopDebug()) {
      const wantStages = Array.from({ length: 7 }, (_, i) =>
        Math.max(-6, Math.min(6, Math.trunc(snap.statStages[i] ?? 0))),
      );
      const prevStages = [...stages].slice(0, 7);
      if (wantStages.some((v, i) => v !== prevStages[i])) {
        coopWarn(
          "heal",
          `statStages bi=${snap.bi} host=[${wantStages.join(",")}] guest=[${prevStages.join(",")}] -> applied`,
        );
      }
    }
    for (let i = 0; i < 7 && i < stages.length; i++) {
      stages[i] = Math.max(-6, Math.min(6, Math.trunc(snap.statStages[i] ?? 0)));
    }
    // HP last, clamped to the (now host-forced) max.
    const prevHp = mon.hp;
    const wantHp = Math.max(0, Math.min(Math.trunc(snap.hp), mon.getMaxHp()));
    if (prevHp !== wantHp) {
      coopWarn("heal", `hp bi=${snap.bi} host=${wantHp} guest=${prevHp} (maxHp=${mon.getMaxHp()}) -> applied`);
    }
    mon.hp = wantHp;
    // Boss re-assert (#633, A/BLOCKING-2), AFTER hp so the index derives from the correct hp. The host
    // decrements bossSegmentIndex as shields break, but the guest sets hp by direct assignment (never
    // via damage()), so its index would freeze and the dividers render wrong + the dimension loops
    // forever. Re-assert the EXPLICIT host segment COUNT (never the diverged-RNG getEncounterBossSegments
    // fallback), then DERIVE the index from the now-correct hp via getBossSegmentIndex() so the boss
    // dimension STOPS diverging each apply instead of looping. Gated authoritative; enemy-only.
    if (authoritativeGuest && mon instanceof EnemyPokemon && typeof snap.bossSegments === "number") {
      const want = snap.bossSegments;
      if (mon.bossSegments !== want) {
        coopWarn("resync", `boss divergence bi=${snap.bi} host.segments=${want} guest.segments=${mon.bossSegments}`);
      }
      mon.setBoss(want > 0, want > 0 ? want : undefined);
      if (want > 0) {
        // Derive the index from hp (self-correcting), not the host's raw index (which can lag a turn).
        mon.bossSegmentIndex = mon.getBossSegmentIndex();
        // Re-render the segmented bar UNLESS we're in give-up mode (a persistent divergence shouldn't
        // re-render every turn). initBattleInfo() on an existing bar dispatches to updateBossSegments.
        if (!suppressResummon) {
          mon.initBattleInfo();
        }
      }
    }
    void mon.updateInfo();
  } catch {
    /* one mon's heal failed; leave it and continue */
  }
}

/**
 * GUEST: reconcile player persistent-modifier STACK COUNTS to the host's (#633 GAP 2). A
 * relic / persistent-modifier stack-count divergence is hashed (`[typeId, stackCount]`), so it
 * is a permanent `still-diverged` resync-loop the per-turn checkpoint can't fix. This heals the
 * SAFE subset mid-battle:
 *  - For each non-held-item player persistent modifier (relics, EXP charms, lures, candy jar, ...),
 *    match by `type.id` to the host's `[typeId, stackCount]` and SET our `stackCount` to the host's.
 *    Persistent-modifier effects read `stackCount` at apply time (they don't accumulate on a set),
 *    so a direct set is side-effect-free - it never double-applies an effect.
 *  - REMOVE a non-held modifier the host no longer has (stackCount 0 / absent typeId).
 *
 * INTENTIONALLY skips `PokemonHeldItemModifier`s: they are `pokemonId`-bound and the snapshot's
 * aggregate `[typeId, stackCount]` carries NO pokemonId, so a mid-battle re-bind would corrupt the
 * binding. On-field per-mon held items are now healed separately + precisely by
 * {@linkcode applyCoopHeldItemsForMon} (#633 RISKY #1/#2/#3, keyed by battler index, not the aggregate
 * count); BENCH held-item structure still converges at the wave boundary via the enemy/party adopt. Here
 * we only touch the count-only global modifiers that the GAP-2 divergence is actually about. Does NOT
 * ADD a brand-new global modifier mid-battle (rebuilding a generator-typed modifier from a bare
 * typeId can need pregen RNG); a genuinely-missing global modifier is a wave-boundary adopt. After
 * any change, `updateModifiers` refreshes the bar. Fully guarded.
 */
export function reconcileCoopModifierStacks(hostModifiers: [string, number][] | undefined): void {
  if (hostModifiers == null) {
    return;
  }
  try {
    // Host stack count per typeId (the snapshot pre-sorts; an item may appear once with its count).
    const wantByType = new Map<string, number>();
    for (const [typeId, stackCount] of hostModifiers) {
      if (typeof typeId === "string") {
        wantByType.set(typeId, Math.max(0, Math.trunc(stackCount)));
      }
    }
    let changed = false;
    // Iterate a snapshot of the player modifier list (a removal mutates it).
    for (const modifier of [...globalScene.modifiers]) {
      // Held items are pokemonId-bound - never reconcile them from the aggregate count here.
      if (modifier instanceof PokemonHeldItemModifier || !(modifier instanceof PersistentModifier)) {
        continue;
      }
      const want = wantByType.get(modifier.type.id);
      if (want === undefined || want <= 0) {
        coopWarn(
          "heal",
          `modifier REMOVE typeId=${modifier.type.id} host=0/absent guest.stack=${modifier.stackCount} -> removed`,
        );
        // The host no longer has this global modifier -> drop it (count-only, side-effect-free).
        if (globalScene.removeModifier(modifier)) {
          changed = true;
        }
        continue;
      }
      if (modifier.stackCount !== want) {
        coopWarn(
          "heal",
          `modifier stack typeId=${modifier.type.id} host=${want} guest=${modifier.stackCount} -> applied`,
        );
        modifier.stackCount = want;
        changed = true;
      }
    }
    if (changed) {
      globalScene.updateModifiers(true);
    }
  } catch {
    // A malformed modifier list must never crash the guest's battle.
  }
}

/**
 * GUEST (authoritative resync): reconcile the player-wide PERSISTENT modifiers to the host's FULL blob
 * set (#698 / #633 BUG 2). The stack-only {@linkcode reconcileCoopModifierStacks} can fix a stack count
 * or remove an extra, but it can NEVER CREATE a host modifier the guest is missing - so a host-only
 * player-wide modifier (`TEMP_STAT_STAGE_BOOSTER`, `SUPER_EXP_CHARM`, ...) that needs args to rebuild
 * stayed permanently `<absent>` on the guest, diverging the checksum every turn. This heals the WHOLE
 * list the same proven way per-mon held items heal ({@linkcode applyCoopHeldItemsForMon}):
 *  - ADD: for each host blob with no matching guest modifier (by `type.id`), RECONSTRUCT it via
 *    {@linkcode ModifierData.toModifier} (the same reconstruct path the held-item heal uses) and
 *    `addModifier` it (ignoreUpdate; the caller refreshes the bar once).
 *  - STACK: a guest modifier that matches a host blob's `type.id` has its `stackCount` SET to the host's
 *    (persistent-modifier effects read stackCount at apply time, so a direct set is side-effect-free).
 *  - REMOVE: a guest player-wide persistent modifier the host's blob set lacks is dropped.
 *
 * NEVER touches `PokemonHeldItemModifier` (per-mon, healed elsewhere) or `PokemonFormChangeItemModifier`
 * (form healed via snap.formIndex) - the host already excludes both from the blob set, and we re-guard
 * here so a guest-only one is never removed by this path. Gated authoritative by the caller. Returns true
 * if it changed anything (so the caller refreshes the bar once). Fully guarded.
 */
export function reconcileCoopPlayerModifiers(hostBlobs: Record<string, unknown>[] | undefined): boolean {
  if (!Array.isArray(hostBlobs)) {
    return false;
  }
  let changed = false;
  try {
    // Whether a live modifier is one this path is allowed to own (player-wide, non-held, non-form).
    const isOwned = (m: PersistentModifier): boolean =>
      m instanceof PersistentModifier
      && !(m instanceof PokemonHeldItemModifier)
      && !(m instanceof Modifier.PokemonFormChangeItemModifier);
    // Host wanted stack per typeId (the host pre-filtered to owned modifiers).
    const wantStackByType = new Map<string, number>();
    for (const raw of hostBlobs) {
      if (raw != null && typeof raw === "object") {
        const typeId = (raw as Record<string, unknown>).typeId;
        const stack = (raw as Record<string, unknown>).stackCount;
        if (typeof typeId === "string") {
          wantStackByType.set(typeId, typeof stack === "number" ? Math.max(0, Math.trunc(stack)) : 1);
        }
      }
    }
    // 1) REMOVE / STACK: iterate a snapshot of the guest's owned player-wide modifiers.
    const haveTypeIds = new Set<string>();
    for (const modifier of [...globalScene.modifiers]) {
      if (!isOwned(modifier)) {
        continue;
      }
      const want = wantStackByType.get(modifier.type.id);
      if (want === undefined || want <= 0) {
        coopWarn(
          "heal",
          `playerModifier REMOVE typeId=${modifier.type.id} host=0/absent guest.stack=${modifier.stackCount} -> removed`,
        );
        if (globalScene.removeModifier(modifier)) {
          changed = true;
        }
        continue;
      }
      haveTypeIds.add(modifier.type.id);
      if (modifier.stackCount !== want) {
        coopWarn(
          "heal",
          `playerModifier stack typeId=${modifier.type.id} host=${want} guest=${modifier.stackCount} -> applied`,
        );
        modifier.stackCount = want;
        changed = true;
      }
    }
    // 2) ADD: reconstruct any host blob the guest is missing (by type.id), via the same ModifierData
    // path the per-mon held-item heal uses. This is the BUG 2 fix - the missing-modifier case.
    for (const raw of hostBlobs) {
      if (raw == null || typeof raw !== "object") {
        continue;
      }
      const typeId = (raw as Record<string, unknown>).typeId;
      if (typeof typeId !== "string" || haveTypeIds.has(typeId)) {
        continue;
      }
      try {
        const data = new ModifierData(raw as Record<string, unknown>, false);
        const modifier = data.toModifier(
          Modifier[data.className as keyof typeof Modifier] ?? resolveErModifierClass(data.className),
        );
        // Re-guard: only a player-wide, non-held, non-form persistent modifier may be added by this path.
        if (
          !(modifier instanceof PersistentModifier)
          || modifier instanceof PokemonHeldItemModifier
          || modifier instanceof Modifier.PokemonFormChangeItemModifier
        ) {
          continue;
        }
        if (typeof data.stackCount === "number") {
          modifier.stackCount = data.stackCount;
        }
        coopWarn(
          "heal",
          `playerModifier ADD typeId=${modifier.type.id} stack=${modifier.stackCount} (guest lacked it) -> added`,
        );
        globalScene.addModifier(modifier, true, false, false);
        changed = true;
      } catch {
        /* one player-wide modifier failed to reconstruct; keep the rest */
      }
    }
    if (changed) {
      globalScene.updateModifiers(true);
    }
  } catch {
    // A malformed player-wide modifier set must never crash the guest's battle.
  }
  return changed;
}

/**
 * GUEST (wave boundary): adopt the host's player-party ORDER (#633 GAP 4). The checksum hashes
 * `party = getPlayerParty().map(speciesId)` in slot order, so a party-order divergence (e.g. the
 * two clients merged the shared roster in a slightly different bench order) is a permanent
 * resync-loop. Mirrors the enemy `adoptCoopHostEnemyParty` reorder-by-identity pattern, but is
 * deliberately OFF-FIELD ONLY + run at a WAVE BOUNDARY (a mid-battle reorder of on-field mons is
 * unsafe): it permutes ONLY the BENCH slots (>= the on-field count) so the resulting full speciesId
 * sequence best matches the host's, never touching the on-field leads (those are the field
 * reconcile's job). Stable identity is `speciesId`; ties keep the first-available bench mon. A
 * party whose on-field leads already differ from the host is left to the field reconcile. Fully
 * guarded so a malformed order can never crash the guest. Returns true if it reordered anything.
 */
export function adoptCoopHostPlayerPartyOrder(hostParty: number[] | undefined): boolean {
  if (!Array.isArray(hostParty) || hostParty.length === 0) {
    return false;
  }
  try {
    const party = globalScene.getPlayerParty() as Pokemon[];
    if (party.length <= 1) {
      return false;
    }
    // #799 (live Wingull/Chinchou transposition): the old guard skipped ALL slots below the
    // on-field count, so in a co-op DOUBLE array slot 1 was permanently untouchable - a
    // transposition involving a lead ARRAY slot could NEVER heal (the field reconcile fixes
    // sprites/field state, not an array slot whose occupant is not even on the field, e.g. at
    // a wave boundary). New rule: pin ONLY mons that are genuinely ON FIELD right now (moving
    // those is the field reconcile's job); every other slot - including a lead-index slot whose
    // occupant is benched - is reorderable by identity to the host's exact sequence.
    const pinned = new Set<number>();
    for (let i = 0; i < party.length; i++) {
      const mon = party[i];
      if (mon != null && mon.isOnField() && mon.isActive()) {
        pinned.add(i);
      }
    }
    // Pool = every non-pinned mon; assign each non-pinned slot the host's species at that index.
    const remaining: Pokemon[] = [];
    for (let i = 0; i < party.length; i++) {
      if (!pinned.has(i) && party[i] != null) {
        remaining.push(party[i]);
      }
    }
    const desired: (Pokemon | null)[] = Array.from({ length: party.length }, () => null);
    for (let i = 0; i < party.length && i < hostParty.length; i++) {
      if (pinned.has(i)) {
        continue;
      }
      const wantSpecies = hostParty[i];
      const idx = remaining.findIndex(p => (p.species?.speciesId ?? -1) === wantSpecies);
      if (idx >= 0) {
        desired[i] = remaining[idx];
        remaining.splice(idx, 1);
      }
    }
    // Any unmatched pool mons fill the remaining non-pinned holes in order (defensive; keeps all).
    for (let i = 0; i < party.length; i++) {
      if (!pinned.has(i) && desired[i] == null && remaining.length > 0) {
        desired[i] = remaining.shift() ?? null;
      }
    }
    let changed = false;
    for (let i = 0; i < party.length; i++) {
      if (!pinned.has(i) && desired[i] != null && party[i] !== desired[i]) {
        party[i] = desired[i] as Pokemon;
        changed = true;
      }
    }
    if (changed) {
      coopLog(
        "resync",
        `adoptCoopHostPlayerPartyOrder reordered to host sequence (pinnedOnField=[${[...pinned].join(",")}])`,
      );
    }
    return changed;
  } catch {
    // A malformed party order must never crash the guest's run.
    return false;
  }
}

/**
 * GUEST: adopt the host's full authoritative snapshot wholesale to HEAL a desync (#633,
 * TRACK-2). Applies field mons (ability/form before stat recompute), then arena weather /
 * terrain / TAGS (#633 GAP 1), then money, then the SAFE subset of persistent-modifier stack
 * counts (#633 GAP 2) - field-by-field onto the LIVE objects (never a session reload, which
 * would tear down the running battle). ON-FIELD per-mon held-item structure IS now rewritten to the
 * host's set (#633 RISKY #1/#2/#3, {@linkcode applyCoopHeldItemsForMon}, gated authoritative) and the
 * ball inventory healed (#633 RISKY #4); BENCH held items still converge at the wave boundary via the
 * enemy/party adopt. The player party ORDER is adopted OFF-FIELD ONLY here (#633 GAP 4,
 * {@linkcode adoptCoopHostPlayerPartyOrder} - bench-only, safe at any boundary). Fully guarded so a
 * malformed snapshot can never crash the guest.
 *
 * `authoritativeGuest` (#633): the {@linkcode isCoopAuthoritativeGuest} gate result, computed by the
 * cycle-free CALLER (the engine must not import the runtime - that is an import cycle) and threaded to
 * {@linkcode applyFullMon} so the level/exp + boss re-assert branches stay guest-only (solo / host /
 * lockstep are byte-identical). Defaults `false` so a non-gated call can never fire a guest branch.
 */
export function applyCoopFullSnapshot(
  snapshot: CoopFullBattleSnapshot,
  authoritativeGuest = false,
  suppressResummon = false,
): void {
  try {
    coopLog(
      "resync",
      `guest applyFullSnapshot field=${snapshot.field?.length ?? 0} weather=${snapshot.weather} terrain=${snapshot.terrain} arenaTags=${snapshot.arenaTags?.length ?? 0} modifiers=${snapshot.modifiers?.length ?? 0} party=${snapshot.party?.length ?? 0} money=${snapshot.money} suppressResummon=${suppressResummon}`,
    );
    // Biome heal (B7): a hashed biome split (a seed/waveIndex drift that landed the clients in
    // DIFFERENT biomes) is healed by rebuilding the arena to the host's biome. MUST run BEFORE the
    // weather/terrain/arenaTags reconcile below (a fresh Arena has none) so they land on the right
    // arena; its position vs. the field re-summon is immaterial (newArena swaps only globalScene.arena
    // DATA, never globalScene.field sprites). newArena is heavy, so gate to a genuine mismatch - a
    // no-op (and same arena object identity) when biome already matches, the overwhelmingly common case.
    // NOTE: newArena does NOT call arena.init(), so the visible background is not refreshed until the
    // next real SwitchBiomePhase; the checksum reads only arena.biomeId (data), which this DOES fix.
    if (typeof snapshot.biomeId === "number" && (globalScene.arena?.biomeId ?? -1) !== snapshot.biomeId) {
      coopWarn("resync", `biome force host=${snapshot.biomeId} guest=${globalScene.arena?.biomeId}`);
      globalScene.newArena(snapshot.biomeId as BiomeId);
    }
    // MINOR-1 (#633, converge-or-give-up): when a divergence has failed to heal twice on the same
    // dimensions, SKIP the heavy field-composition re-summon (it isn't closing the gap and a per-turn
    // teardown/rebuild is a flicker + asset-reload storm). The cheap per-mon scalar writes still run.
    if (!suppressResummon) {
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
    }
    const byIndex = new Map(
      globalScene
        .getField(true)
        .filter((m): m is Pokemon => m != null)
        .map(m => [m.getBattlerIndex(), m]),
    );
    for (const snap of snapshot.field) {
      const mon = byIndex.get(snap.bi);
      if (mon != null) {
        applyFullMon(mon, snap, authoritativeGuest, suppressResummon);
      }
    }
    // On-field held-item bar refresh (#633 RISKY #1/#2/#3, C4): applyFullMon healed each mon's held items
    // with ignoreUpdate (no per-mon re-render); refresh BOTH modifier bars ONCE here when the gated heal
    // could have run (idempotent, gated authoritative; reconcileCoopModifierStacks refreshes the player
    // bar separately on a stack change).
    if (authoritativeGuest && snapshot.field.some(s => s.heldItems !== undefined)) {
      globalScene.updateModifiers(true);
      globalScene.updateModifiers(false);
    }
    const arena = globalScene.arena;
    if ((arena.weather?.weatherType ?? 0) !== snapshot.weather) {
      coopWarn("heal", `weather host=${snapshot.weather} guest=${arena.weather?.weatherType ?? 0} -> applied`);
      arena.trySetWeather(snapshot.weather as WeatherType);
    }
    if ((arena.terrain?.terrainType ?? 0) !== snapshot.terrain) {
      coopWarn("heal", `terrain host=${snapshot.terrain} guest=${arena.terrain?.terrainType ?? 0} -> applied`);
      arena.trySetTerrain(snapshot.terrain as TerrainType, true);
    }
    // Reconcile arena tags (#633 GAP 1): the full snapshot now HEALS hazards / screens / tailwind,
    // not just the per-turn checkpoint - so a guest that resyncs on a mismatch converges its arena.
    reconcileArenaTags(snapshot.arenaTags);
    if (globalScene.money !== snapshot.money) {
      coopWarn("heal", `money host=${snapshot.money} guest=${globalScene.money} -> applied`);
    }
    globalScene.money = snapshot.money;
    // Ball-inventory heal (#633 RISKY #4): the host decrements the ball count host-only in
    // AttemptCapturePhase (which the pure-renderer guest never runs), so the guest's inventory drifts
    // up; force the host's authoritative counts. Gated authoritative (solo / host / lockstep skip it -
    // lockstep both decrement on their own AttemptCapturePhase, so the vector already matches).
    if (authoritativeGuest && snapshot.pokeballCounts !== undefined) {
      for (const [type, count] of snapshot.pokeballCounts) {
        if (typeof type === "number" && typeof count === "number") {
          const want = Math.max(0, Math.trunc(count));
          const guestCount = globalScene.pokeballCounts[type];
          if (guestCount !== want) {
            coopWarn("heal", `pokeballCounts ballType=${type} host=${want} guest=${guestCount} -> applied`);
          }
          globalScene.pokeballCounts[type] = want;
        }
      }
    }
    // Reconcile player-wide persistent modifiers (#698 / #633 GAP 2 + BUG 2): the FULL-blob reconcile
    // (add missing / remove extra / fix stacks) heals a host-only player-wide modifier the guest is
    // MISSING (a temp stat booster, an EXP charm, ...) - the root divergence the stack-only path could
    // never close. Gated authoritative + only when the (newer) host carried the blobs; an OLDER host
    // (playerModifiers undefined) FALLS BACK to the proven stack-only reconcile (no regression). Held
    // items stay per-mon (healed above); both paths skip them.
    if (authoritativeGuest && snapshot.playerModifiers !== undefined) {
      reconcileCoopPlayerModifiers(snapshot.playerModifiers);
    } else {
      reconcileCoopModifierStacks(snapshot.modifiers);
    }
    // Run-seed heal (B8): the hashed master determinism input is now healed on ANY resync, not only at
    // an ME terminal (where applyCoopMeOutcome re-pins it separately + idempotently). Length-guarded so
    // an empty "" seed is never pinned; re-pinning the same seed is a no-op, safe in the common case.
    if (typeof snapshot.seed === "string" && snapshot.seed.length > 0) {
      if (globalScene.seed !== snapshot.seed) {
        coopWarn("heal", `seed host=${snapshot.seed} guest=${globalScene.seed} -> applied`);
      }
      globalScene.setSeed(snapshot.seed);
    }
    if (typeof snapshot.waveSeed === "string" && snapshot.waveSeed.length > 0) {
      if (globalScene.waveSeed !== snapshot.waveSeed) {
        coopWarn("heal", `waveSeed host=${snapshot.waveSeed} guest=${globalScene.waveSeed} -> applied`);
      }
      globalScene.waveSeed = snapshot.waveSeed;
      Phaser.Math.RND.sow([snapshot.waveSeed]);
    }
    // Adopt the host's player party ORDER (#633 GAP 4): OFF-FIELD-only bench reorder (safe at any
    // boundary) so the hashed `party` speciesId sequence converges. On-field leads are untouched.
    const reordered = adoptCoopHostPlayerPartyOrder(snapshot.party);
    if (reordered) {
      coopWarn(
        "heal",
        `party-order adopt host=[${(snapshot.party ?? []).join(",")}] guest=[${globalScene
          .getPlayerParty()
          .map(p => p.species?.speciesId ?? 0)
          .join(",")}] -> reordered bench`,
      );
    }
    // B4 (#633): heal bench-mon level / exp / form / friendship / moveset (+ a host off-field
    // evolution's species) by reconciling the WHOLE party to the host's PokemonData (the live
    // revive-in-shop desync: the host shows a bench mon fainted, the guest shows it alive). Reuses
    // the capture-handshake reconcile (preserves on-field leads + matched objects + held items,
    // constructs new mons, releases removed). GUEST-ONLY: gated on the `authoritativeGuest` param
    // (false for host / solo / lockstep), so those paths never run it. Runs LAST so its full per-mon
    // field-apply is the authoritative final word over the speciesId-only order-adopt above.
    if (authoritativeGuest && Array.isArray(snapshot.benchParty) && snapshot.benchParty.length > 0) {
      coopLog(
        "heal",
        `benchParty reconcile host=${snapshot.benchParty.length} mons guest=${globalScene.getPlayerParty().length} -> applyCaptureParty`,
      );
      applyCoopCaptureParty(snapshot.benchParty);
    }
    coopLog(
      "resync",
      `guest applyFullSnapshot DONE authoritativeGuest=${authoritativeGuest} suppressResummon=${suppressResummon}`,
    );
  } catch {
    // A malformed snapshot must never crash the guest's battle.
  }
}

/**
 * HOST (#633 M2): capture ONLY the on-field mons' COMPLETE per-mon snapshot (the same `readFullMon`
 * view the resync uses), so the per-turn stream can heal the on-field state the numeric checkpoint
 * OMITS - moveset+PP / tera / boss segments / held items / non-ER tags / ability / form - IN-LINE every
 * turn, instead of only via a checksum-mismatch resync round-trip. FIELD-ONLY (no bench / player-modifier
 * / arena payload: those do not change within a battle turn and stay on the resync). Sorted by `bi` for a
 * stable wire order. Returns `null` on an empty field or a read failure (never breaks the host's turn).
 */
export function captureCoopFieldSnapshot(): CoopFullMonSnapshot[] | null {
  try {
    const field = getCoopSerializableField()
      .map(readFullMon)
      .sort((a, b) => a.bi - b.bi);
    return field.length === 0 ? null : field;
  } catch {
    return null;
  }
}

/**
 * GUEST (#633 M2): apply the host's COMPLETE per-mon field snapshot at the turn boundary, healing each
 * on-field mon's ability / form / tera / moveset+PP / tags / held items IN-LINE (the numeric checkpoint
 * carries only hp / status / stages, so those otherwise wait for a checksum-mismatch resync). Reuses the
 * proven {@linkcode applyFullMon} per mon, matched by battler index. The field-COMPOSITION reconcile (drop
 * a fainted mon / mirror a switch) is already done by the per-turn checkpoint apply, so it is intentionally
 * NOT repeated here. Gated authoritative-guest BY THE CALLER (solo / host / lockstep pass `false` and this
 * is a no-op via the loop's applyFullMon gates); the held-item bar is refreshed ONCE after the loop
 * (mirrors applyCoopFullSnapshot's deferral). Fully guarded - a malformed field can never break the turn.
 */
export function applyCoopFieldSnapshot(field: CoopFullMonSnapshot[] | undefined, authoritativeGuest: boolean): void {
  if (!Array.isArray(field) || field.length === 0) {
    return;
  }
  try {
    const byIndex = new Map(
      globalScene
        .getField(true)
        .filter((m): m is Pokemon => m != null)
        .map(m => [m.getBattlerIndex(), m]),
    );
    for (const snap of field) {
      const mon = byIndex.get(snap.bi);
      if (mon != null) {
        applyFullMon(mon, snap, authoritativeGuest);
      }
    }
    // Deferred single bar refresh (mirrors applyCoopFullSnapshot C4): applyFullMon healed held items
    // with ignoreUpdate; refresh both modifier bars ONCE here when the gated held-item heal could run.
    if (authoritativeGuest && field.some(s => s.heldItems !== undefined)) {
      globalScene.updateModifiers(true);
      globalScene.updateModifiers(false);
    }
  } catch {
    /* a malformed field snapshot must never crash the guest's turn */
  }
}

// =============================================================================
// Co-op authoritative EXP (#633 B5). The HOST is the sole battle engine: it computes
// exp/level/evolution; the GUEST's own applyPartyExp is gated OFF (victory-phase.ts).
// After the wave's whole exp/level/evolution chain has DRAINED (in the host's
// BattleEndPhase), the host captures each party slot's SETTLED exp/level/moveset and
// streams it; the guest SETS them verbatim so both clients' VictoryPhase -> LevelUp ->
// LearnMove target the SAME mon (the live learn-move-on-the-wrong-mon desync, rooted in
// the guest independently computing a DIVERGENT exp -> a different level/evolution path).
// =============================================================================

/**
 * HOST (#633 B5): capture each party slot's SETTLED post-exp exp / level / moveset. Called from the
 * host's `BattleEndPhase.start()` - AFTER the wave's `ExpPhase` / `ShowPartyExpBarPhase` /
 * `LevelUpPhase` / `EvolutionPhase` chain has fully drained (those phases are unshifted ahead of the
 * pushed `BattleEndPhase`), so the values are the fully-credited authoritative ones, NOT the pre-wave
 * snapshot (`applyPartyExp` only QUEUES the exp phases; the mutation happens later inside them). Keyed
 * by STABLE party-SLOT index + validated by speciesId on apply. Fully guarded (a read failure yields
 * an empty list = a no-op on the guest).
 */
export function captureCoopExpDeltas(): CoopExpDelta[] {
  try {
    return globalScene.getPlayerParty().map((p, slot) => ({
      slot,
      speciesId: p.species?.speciesId ?? 0,
      exp: p.exp,
      level: p.level,
      moveset: (p.moveset ?? [])
        .filter((m): m is PokemonMove => m != null)
        .map(m => ({ moveId: m.moveId, ppUsed: m.ppUsed, ppUp: m.ppUp })),
    }));
  } catch {
    return [];
  }
}

/**
 * GUEST (#633 B5): adopt the host's settled per-slot exp / level / moveset ({@linkcode captureCoopExpDeltas}).
 * Called from the guest's `BattleEndPhase.start()`. For each delta it matches the slot by index +
 * GUARDS on speciesId: a slot whose guest species disagrees is SKIPPED (e.g. a host-evolved mon the
 * guest has not evolved - writing the host's evolved exp onto a pre-evolution mon would be wrong; that
 * slot heals via the resync `benchParty` instead). Sets level + exp + moveset (the moveset carries the
 * level-up moves the guest never learned, since it runs no `LevelUpPhase`), then recomputes stats so
 * the derived `levelExp` getter + maxHp stay consistent. Mirrors {@linkcode applyCoopMeMonFields}'s
 * "set level+exp+moveset then calculateStats" shape. Fully guarded - a malformed delta is a no-op.
 */
export function applyCoopExpDeltas(deltas: CoopExpDelta[] | undefined): void {
  if (!Array.isArray(deltas)) {
    return;
  }
  try {
    const party = globalScene.getPlayerParty();
    for (const d of deltas) {
      const mon = party[d.slot];
      if (mon == null || (mon.species?.speciesId ?? -1) !== d.speciesId) {
        coopLog(
          "progression",
          `expDelta SKIP slot=${d.slot} hostSpecies=${d.speciesId} guestSpecies=${mon?.species?.speciesId ?? -1} (left for benchParty heal)`,
        );
        continue; // slot / species disagreement -> leave for the resync benchParty heal.
      }
      if (typeof d.level === "number" && d.level > 0) {
        if (mon.level !== d.level) {
          coopWarn(
            "progression",
            `expDelta level slot=${d.slot} sp=${d.speciesId} host=${d.level} guest=${mon.level} -> applied`,
          );
        }
        mon.level = d.level;
      }
      if (typeof d.exp === "number") {
        if (mon.exp !== d.exp) {
          coopLog(
            "progression",
            `expDelta exp slot=${d.slot} sp=${d.speciesId} host=${d.exp} guest=${mon.exp} -> applied`,
          );
        }
        mon.exp = d.exp;
      }
      // Adopt the host moveset (covers the level-up moves the guest never learned - it runs no
      // LevelUpPhase). Only rebuild when the host actually sent one (an empty list leaves ours alone).
      if (Array.isArray(d.moveset) && d.moveset.length > 0) {
        mon.moveset = d.moveset.map(m => {
          const pm = new PokemonMove(m.moveId);
          pm.ppUsed = Math.max(0, Math.trunc(m.ppUsed ?? 0));
          pm.ppUp = Math.max(0, Math.trunc(m.ppUp ?? 0));
          return pm;
        });
      }
      mon.calculateStats();
      void mon.updateInfo();
    }
  } catch {
    /* malformed exp deltas must never crash the guest's run */
  }
}

// =============================================================================
// Co-op authoritative non-battle ME outcome (#633, CHANGE-4 / P4). In authoritative
// co-op the HOST is the SOLE non-battle-ME engine: every side effect (party changes,
// ME-save tier weighting, RNG advance, dex / starter unlocks) lands ONLY on the host.
// At the ME terminal the host captures a COMPREHENSIVE resync blob and streams it; the
// guest applies it FIELD-BY-FIELD onto its LIVE objects so its run converges with the
// host's, exactly as the per-turn checkpoint heals battle drift. Pure JSON / scalars on
// the wire (bigint dex fields round-trip via string); every apply is fully guarded so a
// bad blob can never hang or crash the guest.
// =============================================================================

/**
 * HOST: serialize the WHOLE `gameData.dexData` + `starterData` into a compact, bigint-safe
 * blob (#633 MAJOR-2). `DexEntry.seenAttr` / `caughtAttr` are `bigint`, which JSON cannot carry,
 * so they are string-encoded via `.toString()` (decoded with `BigInt(...)` on apply). The whole
 * dex is serialized (a per-species "touched" diff is a future optimization; a full blob is correct
 * and small after lz-string). `starterData` is plain scalars / arrays, carried as-is. Fully guarded.
 */
/**
 * #801 run-scoped acquisition sharing: per-species dex fingerprints + the starterData JSON
 * captured at the CO-OP RUN START. The delta blob only carries entries that CHANGED since -
 * run catches, shiny unlocks, grants - never the host's whole account (live report: "they get
 * all of my pokemon instead of theirs" - the un-scoped blob union-merged the host's entire
 * dex onto the guest's account). No baseline captured -> EMPTY blob (share nothing, never
 * overshare); the next run start re-arms it.
 */
let coopDexBaseline: Map<number, string> | null = null;
let coopStarterBaseline: Map<number, string> | null = null;

/** Fingerprint one dex entry (cheap string compare basis). */
function dexEntryFingerprint(e: {
  seenAttr: bigint;
  caughtAttr: bigint;
  natureAttr: number;
  seenCount: number;
  caughtCount: number;
  hatchedCount: number;
}): string {
  return `${e.seenAttr}|${e.caughtAttr}|${e.natureAttr}|${e.seenCount}|${e.caughtCount}|${e.hatchedCount}`;
}

/** Capture the run-start acquisition baseline (call at the co-op run's first encounter). */
export function captureCoopDexBaseline(): void {
  try {
    const dex = new Map<number, string>();
    for (const [id, e] of Object.entries(globalScene.gameData.dexData)) {
      dex.set(Number(id), dexEntryFingerprint(e));
    }
    const starter = new Map<number, string>();
    for (const [id, e] of Object.entries(globalScene.gameData.starterData)) {
      starter.set(Number(id), JSON.stringify(e));
    }
    coopDexBaseline = dex;
    coopStarterBaseline = starter;
    coopLog("shop", `dex baseline captured (species=${dex.size} starters=${starter.size}) - deltas are run-scoped`);
  } catch {
    coopDexBaseline = null;
    coopStarterBaseline = null;
  }
}

/** Test/teardown hook: drop the baseline (a delta request then shares NOTHING). */
export function clearCoopDexBaseline(): void {
  coopDexBaseline = null;
  coopStarterBaseline = null;
}

export function captureCoopDexDelta(): string {
  try {
    // #801: without a run-start baseline, share NOTHING (an un-scoped blob would clone the
    // host's whole account dex onto the partner - the live "all of my pokemon" report).
    if (coopDexBaseline == null || coopStarterBaseline == null) {
      return "";
    }
    const dex: Record<
      number,
      {
        seenAttr: string;
        caughtAttr: string;
        natureAttr: number;
        seenCount: number;
        caughtCount: number;
        hatchedCount: number;
        ivs: number[];
      }
    > = {};
    for (const [id, e] of Object.entries(globalScene.gameData.dexData)) {
      if (coopDexBaseline.get(Number(id)) === dexEntryFingerprint(e)) {
        continue; // unchanged since run start - not a run acquisition, never shared
      }
      dex[Number(id)] = {
        seenAttr: e.seenAttr.toString(),
        caughtAttr: e.caughtAttr.toString(),
        natureAttr: e.natureAttr,
        seenCount: e.seenCount,
        caughtCount: e.caughtCount,
        hatchedCount: e.hatchedCount,
        ivs: [...e.ivs],
      };
    }
    // #801: starterData is scoped identically - only entries that changed since run start
    // (run shiny/black unlocks, candy from run catches), never the whole account table.
    const starter: Record<number, unknown> = {};
    for (const [id, e] of Object.entries(globalScene.gameData.starterData)) {
      if (coopStarterBaseline.get(Number(id)) !== JSON.stringify(e)) {
        starter[Number(id)] = e;
      }
    }
    return compressToBase64(JSON.stringify({ dex, starter }));
  } catch {
    // A dex read failure must never break the outcome send; an empty blob is a no-op on apply.
    return "";
  }
}

/**
 * GUEST: merge the host's dex / starter blob ({@linkcode captureCoopDexDelta}) onto the local
 * `gameData` (#633 MAJOR-2). Decodes the bigint `seenAttr` / `caughtAttr` via `BigInt(...)`,
 * sets the numeric counts, and merges `starterData`. Fully guarded so a malformed / empty blob
 * is a no-op (the per-turn checksum + the next ME terminal re-sync any residual drift).
 */
export function applyCoopDexDelta(blob: string): void {
  if (typeof blob !== "string" || blob.length === 0) {
    return;
  }
  try {
    const decompressed = decompressFromBase64(blob);
    if (decompressed == null || decompressed.length === 0) {
      return;
    }
    const parsed = JSON.parse(decompressed) as {
      dex?: Record<
        string,
        {
          seenAttr: string;
          caughtAttr: string;
          natureAttr: number;
          seenCount: number;
          caughtCount: number;
          hatchedCount: number;
          ivs: number[];
        }
      >;
      starter?: Record<string, StarterDataEntry>;
    };
    // #801 CRITICAL ("i overwrote all my guest's pokemon... it seems permanent"): the old apply
    // wholesale-SET each dex field and spread-OVERWROTE starter entries with the host's values -
    // the partner's own attrs, candy counts, and unlocks were REPLACED (destroyed) by whatever
    // the host had. The apply is now a strict GAIN-ONLY UNION: bitmasks OR, counts max, objects
    // gain new keys only. The receiving account can never lose anything from a co-op session.
    const dexData = globalScene.gameData.dexData;
    for (const [id, e] of Object.entries(parsed.dex ?? {})) {
      const entry = dexData[Number(id)];
      if (entry == null) {
        continue;
      }
      entry.seenAttr |= BigInt(e.seenAttr);
      entry.caughtAttr |= BigInt(e.caughtAttr);
      entry.natureAttr |= e.natureAttr;
      entry.seenCount = Math.max(entry.seenCount, e.seenCount);
      entry.caughtCount = Math.max(entry.caughtCount, e.caughtCount);
      entry.hatchedCount = Math.max(entry.hatchedCount, e.hatchedCount);
      if (Array.isArray(e.ivs) && Array.isArray(entry.ivs)) {
        for (let i = 0; i < entry.ivs.length && i < e.ivs.length; i++) {
          entry.ivs[i] = Math.max(entry.ivs[i], e.ivs[i]);
        }
      }
    }
    const BITMASK_STARTER_FIELDS = new Set(["eggMoves", "abilityAttr", "passiveAttr"]);
    const starterData = globalScene.gameData.starterData;
    for (const [id, sIn] of Object.entries(parsed.starter ?? {})) {
      if (sIn == null || typeof sIn !== "object") {
        continue;
      }
      const key = Number(id);
      const local = (starterData[key] ?? {}) as unknown as Record<string, unknown>;
      for (const [field, incoming] of Object.entries(sIn as unknown as Record<string, unknown>)) {
        const cur = local[field];
        if (typeof incoming === "number" && typeof cur === "number") {
          local[field] = BITMASK_STARTER_FIELDS.has(field) ? cur | incoming : Math.max(cur, incoming);
        } else if (typeof incoming === "boolean") {
          local[field] = cur === true || incoming;
        } else if (incoming != null && typeof incoming === "object" && !Array.isArray(incoming)) {
          // Objects (e.g. erShinyLab saved looks): gain NEW keys, local values win on conflict.
          local[field] = { ...(incoming as Record<string, unknown>), ...((cur as Record<string, unknown>) ?? {}) };
        } else if (cur === undefined) {
          local[field] = incoming;
        }
      }
      starterData[key] = local as unknown as (typeof starterData)[number];
    }
  } catch {
    // A malformed dex blob must never crash the guest; the checksum / next ME terminal re-sync.
  }
}

/**
 * GUEST: reconcile the player party from the host's serialized {@linkcode PokemonData} list
 * (#633 MAJOR-2). Applies the per-mon SCALAR fields FIELD-BY-FIELD onto the matched LIVE
 * `PlayerPokemon` (NOT a wholesale new-object swap, which would break the phase / UI references
 * that hold the live mon), then recomputes stats. A mon the host added that the guest does not
 * have (e.g. a gift ME) is the ONLY case that constructs a new object - appended at the BENCH
 * TAIL, where a fresh mon has no dangling references. Matching is by party INDEX (the host and
 * guest party order is kept permutation-identical by the order-adopt / checkpoint paths). Fully
 * guarded so a malformed entry can never crash the guest.
 */
export function applyCoopMePartyFromData(serializedParty: string[]): void {
  if (!Array.isArray(serializedParty)) {
    return;
  }
  try {
    // Widen to Pokemon[] (the existing engine reads do the same): the field-apply takes a Pokemon
    // and a freshly-constructed player mon (`toPokemon` -> a PlayerPokemon) appends type-cleanly.
    const party = globalScene.getPlayerParty() as Pokemon[];
    for (let i = 0; i < serializedParty.length; i++) {
      let data: PokemonData;
      try {
        data = new PokemonData(JSON.parse(serializedParty[i]));
      } catch {
        continue; // one bad blob entry; leave that slot and keep going.
      }
      const live = party[i];
      if (live != null && (live.species?.speciesId ?? -1) === data.species) {
        applyCoopMeMonFields(live, data);
      } else if (live == null) {
        // A NEW mon the host added (gift ME): construct from data and append at the bench tail.
        // A fresh mon has no dangling phase / UI references, so construction is safe here only.
        try {
          const added = data.toPokemon();
          party.push(added);
        } catch {
          // A construction failure must never crash the guest; the wave-boundary adopt re-syncs.
        }
      }
      // A species MISMATCH at an existing slot is left to the wave-boundary order-adopt /
      // field reconcile (a mid-ME swap of an existing live mon is unsafe).
    }
    // #633 M-1: a release / sacrifice / trade ME SHRINKS the host party. The append-only pass above
    // never drops a stale live mon, so without this the guest party ends LONGER than the host's - a
    // party-length divergence that breaks the per-turn replay (index alignment). Truncate the live
    // party back to the host's length, releasing each surplus BENCH mon via the canonical removal
    // path (which also detaches its held-item modifiers). Safe here: a non-battle ME terminal resync
    // runs OFF-FIELD, so every surplus mon is a bench mon with no live phase / field reference. We
    // never trim BELOW the on-field count (a defensive floor; the host party can't be shorter than
    // the shared on-field leads at an off-field ME terminal).
    const onFieldFloor = globalScene.getPlayerField(false).length;
    const targetLen = Math.max(serializedParty.length, onFieldFloor);
    // Remove from the tail inward so each splice keeps the lower indices stable.
    while (globalScene.getPlayerParty().length > targetLen) {
      const live = globalScene.getPlayerParty();
      const surplus = live.at(-1);
      if (surplus == null) {
        break;
      }
      coopLog(
        "party",
        `meParty TRUNCATE release bench sp=${surplus.species?.speciesId ?? 0} (host len=${serializedParty.length} guest len=${live.length})`,
      );
      globalScene.removePokemonFromPlayerParty(surplus, true);
    }
  } catch {
    // A malformed party list must never crash the guest's run.
  }
}

/** Apply ONE mon's host-authoritative SCALAR fields onto a LIVE mon (no object swap). */
function applyCoopMeMonFields(mon: Pokemon, data: PokemonData): void {
  try {
    mon.formIndex = data.formIndex;
    mon.abilityIndex = data.abilityIndex;
    mon.shiny = data.shiny;
    mon.variant = data.variant;
    mon.level = data.level;
    mon.exp = data.exp;
    mon.gender = data.gender;
    mon.nature = data.nature;
    mon.luck = data.luck;
    mon.friendship = data.friendship;
    mon.pauseEvolutions = data.pauseEvolutions;
    mon.pokerus = data.pokerus;
    // Co-op (#633 B2): mirror the host's per-account attribution so the per-player 3-cap, switch
    // legality, and field-slot ownership stay identical on both clients. Never CLEAR a tag with an
    // undefined (a solo-saved mon would have none); only adopt a host-resolved owner. `coopOwner`
    // lives on PlayerPokemon and this reconcile only ever runs on the player party.
    if (data.coopOwner !== undefined) {
      (mon as PlayerPokemon).coopOwner = data.coopOwner;
    }
    mon.metLevel = data.metLevel;
    mon.metBiome = data.metBiome;
    mon.metSpecies = data.metSpecies;
    mon.metWave = data.metWave;
    mon.usedTMs = [...data.usedTMs];
    if (Array.isArray(data.ivs)) {
      mon.ivs = [...data.ivs];
    }
    if (typeof data.nickname === "string") {
      mon.nickname = data.nickname;
    }
    // Moveset: adopt the host's moves + per-slot ppUsed (an ME can teach / overwrite a move).
    if (Array.isArray(data.moveset) && data.moveset.length > 0) {
      mon.moveset = data.moveset.map(m => {
        const pm = new PokemonMove(m.moveId);
        pm.ppUsed = Math.max(0, Math.trunc(m.ppUsed ?? 0));
        pm.ppUp = Math.max(0, Math.trunc(m.ppUp ?? 0));
        return pm;
      });
    }
    // Stats last (uses the now-authoritative level / form / ivs / nature), then hp + status.
    mon.calculateStats();
    if (Array.isArray(data.stats) && data.stats.length > 0) {
      mon.stats = [...data.stats];
    }
    mon.status = data.status
      ? new Status(data.status.effect, data.status.toxicTurnCount, data.status.sleepTurnsRemaining)
      : null;
    mon.hp = Math.max(0, Math.min(Math.trunc(data.hp), mon.getMaxHp()));
    void mon.updateInfo();
  } catch {
    // One mon's reconcile failed; leave it and continue (the checksum re-syncs residual drift).
  }
}

/**
 * HOST (#633 B1/B2/B3 capture handshake): serialize the FULL post-catch player party as
 * {@linkcode PokemonData} JSON. Rides the `waveResolved("capture")` signal so the GUEST - a pure
 * renderer that never runs `AttemptCapturePhase` and so never grows its party on a catch - can
 * reconcile its party to match (add the caught mon, mirror its `coopOwner`, release any party-full
 * casualty) and credit the catch to its OWN gameData. Guarded so a serialize failure is a no-op
 * (the next wave-boundary adopt + per-turn checksum re-sync any residual party drift).
 */
export function captureCoopCaptureParty(): string[] {
  try {
    return globalScene.getPlayerParty().map(p => JSON.stringify(new PokemonData(p)));
  } catch {
    return [];
  }
}

/**
 * GUEST (#633 B1/B2/B3): adopt the host's post-catch player party ({@linkcode captureCoopCaptureParty}).
 * A capture only ever touches the BENCH - it adds the caught mon and, when the catcher's half was
 * full, releases one bench mon; the two on-field leads are never moved. So we reconcile by matching
 * each host mon to an existing LIVE mon by species (+ `coopOwner`), which:
 *  - PRESERVES every unchanged mon's object + its held-item modifiers (a matched reuse, not a rebuild),
 *  - leaves a matched ON-FIELD lead fully untouched (its combat state is owned by the per-turn
 *    checkpoint - we never field-apply or tear down a live field sprite here),
 *  - CONSTRUCTS the genuinely-new caught mon (no live match) with the host-resolved `coopOwner` (B2),
 *  - RELEASES any live BENCH mon the host no longer has (the party-full casualty), never an on-field mon.
 * Each freshly-constructed mon is then credited to the GUEST's OWN `gameData` via `setPokemonCaught`
 * (idempotent on the dex bitfield, #689 "credit both accounts") - silent, since the guest renders the
 * host's catch narration from the battle-event stream, not a second toast. Fully guarded.
 *
 * CAVEAT (pre-existing authoritative-model limitation, not introduced here): `captureParty` carries
 * only `PokemonData`, so the wild mon's transferred held items are NOT synced onto the guest's caught
 * mon at THIS handshake. Mid-battle ON-FIELD held-item drift is now healed via the snapshot path
 * ({@linkcode applyCoopHeldItemsForMon}, #633 RISKY #1/#2/#3); the wild-mon-transfer-at-capture case (the
 * caught mon lands on the bench) remains deferred - it converges at the next wave-boundary adopt.
 */
export function applyCoopCaptureParty(serializedParty: string[]): void {
  if (!Array.isArray(serializedParty) || serializedParty.length === 0) {
    return;
  }
  try {
    const target: PokemonData[] = [];
    for (const s of serializedParty) {
      try {
        target.push(new PokemonData(JSON.parse(s)));
      } catch {
        // A corrupt party blob: do NOTHING rather than half-apply (the wave-boundary adopt re-syncs).
        return;
      }
    }
    const party = globalScene.getPlayerParty();
    const onField = new Set<Pokemon>(globalScene.getPlayerField(false));
    const unclaimed: PlayerPokemon[] = [...party];
    const result: PlayerPokemon[] = [];
    const constructed: PlayerPokemon[] = [];
    for (const t of target) {
      // Prefer a same-species + same-owner live mon (preserves its object + held items); relax to
      // species-only so a give-to-partner re-attribution still matches the same physical mon.
      let idx = unclaimed.findIndex(m => (m.species?.speciesId ?? -1) === t.species && m.coopOwner === t.coopOwner);
      if (idx === -1) {
        idx = unclaimed.findIndex(m => (m.species?.speciesId ?? -1) === t.species);
      }
      if (idx >= 0) {
        const mon = unclaimed.splice(idx, 1)[0];
        // A matched ON-FIELD lead stays untouched (per-turn checkpoint owns its live state); only a
        // BENCH mon is field-applied so its scalar fields + owner match the host.
        if (!onField.has(mon)) {
          applyCoopMeMonFields(mon, t);
        }
        result.push(mon);
      } else {
        // No live match = the freshly caught mon (or an ME gift). Construct it with the host owner.
        try {
          const added = t.toPokemon() as PlayerPokemon;
          if (t.coopOwner !== undefined) {
            added.coopOwner = t.coopOwner;
          }
          added.setVisible(false);
          result.push(added);
          constructed.push(added);
        } catch {
          // One construction failure must not abort the reconcile; the wave-boundary adopt re-syncs.
        }
      }
    }
    // Matched (kept) live mons = everything claimed off `unclaimed` that landed in `result` minus the
    // freshly-constructed ones. Snapshot it before the release pass mutates `result`.
    const keptCount = result.length - constructed.length;
    // Release mons the host no longer has (a party-full release during the catch). NEVER an on-field mon.
    let releasedCount = 0;
    let keptOnFieldSafety = 0;
    for (const m of unclaimed) {
      if (onField.has(m)) {
        result.push(m); // safety: a live on-field mon is never torn down here.
        keptOnFieldSafety++;
      } else {
        coopLog(
          "party",
          `captureParty RELEASE bench sp=${m.species?.speciesId ?? 0} owner=${m.coopOwner} (host dropped it)`,
        );
        globalScene.removePokemonFromPlayerParty(m, true);
        releasedCount++;
      }
    }
    // Rebuild the party in the host's order (the on-field leads stay at the FRONT because the host
    // keeps them there and we iterate `target` in order).
    party.length = 0;
    party.push(...result);
    // B3 (#689): credit the GUEST's OWN gameData for each freshly caught mon - registers the species
    // (caughtAttr + candy + starter unlock), idempotent on the dex bitfield. `showMessage=false`: the
    // guest renders the host's catch narration from the battle-event stream, not a second toast. The
    // `.catch` is REQUIRED - setPokemonCaught is async + fire-and-forget here, so a rejection would
    // escape the surrounding try (which only catches synchronous throws) as an unhandled rejection.
    // We deliberately do NOT call updateSpeciesDexIvs: it routes through validateAchv -> the ER
    // candy-reward + candy-bar UI, side-effects that don't belong on a silent wave-advance reconcile
    // (and the species registration above is what B3 needs; the per-species best-IV record is a
    // non-synced cosmetic dex detail).
    // #801 ROOT (live 'starters still being given to me'): this crediting predates the scoped
    // #794 share and ran for EVERY reconstructed mon - including the PARTNER'S OWN starters and
    // bench whenever the matcher rebuilt them (launch, wave adopts, resyncs) - silently
    // registering the partner's account species onto ours on every session. Credit ONLY mons WE
    // own; a partner's genuine catch reaches this account through the run-scoped dexSync stream.
    // This apply runs ONLY on the authoritative-guest renderer (cycle-free role derivation:
    // importing the controller from coop-runtime here would create an import cycle).
    const localRole: CoopRole = "guest";
    for (const mon of constructed) {
      if ((mon as { coopOwner?: CoopRole }).coopOwner === localRole) {
        void globalScene.gameData.setPokemonCaught(mon, true, false, false).catch(() => {});
      } else {
        coopLog(
          "party",
          `adopt SKIP account credit for partner-owned constructed mon sp=${mon.species?.speciesId} (#801)`,
        );
      }
    }
    coopLog(
      "party",
      `guest applied capture party: ${party.length} mons (kept=${keptCount} added=${constructed.length} released=${releasedCount} onFieldSafety=${keptOnFieldSafety}, host target=${target.length})`,
    );
  } catch {
    // A malformed capture party must never crash the guest's run.
  }
}

/**
 * HOST: capture the comprehensive non-battle-ME terminal resync (#633, P4). Bundles the existing
 * full-battle snapshot (field / arena / money / modifier counts), the FULL per-mon party as
 * serialized {@linkcode PokemonData} JSON, the ME-save tier-weighting events, the run-RNG cursor
 * (`seed` / `waveSeed`), and the bigint-safe dex / starter blob. ME-terminal-only - it does NOT
 * bloat the per-turn snapshot. The guest adopts it via {@linkcode applyCoopMeOutcome}.
 */
export function captureCoopMeOutcome(): Extract<CoopInteractionOutcome, { k: "meResync" }> {
  return {
    k: "meResync",
    base: captureCoopFullSnapshot(),
    party: globalScene.getPlayerParty().map(p => JSON.stringify(new PokemonData(p))),
    meSaveData: JSON.stringify(globalScene.mysteryEncounterSaveData.encounteredEvents),
    seed: globalScene.seed,
    waveSeed: globalScene.waveSeed,
    dex: captureCoopDexDelta(),
  };
}

/**
 * GUEST: adopt the host's comprehensive ME-terminal resync (#633, P4). Applies the full-battle
 * snapshot (existing covered fields), then reconciles the party FIELD-BY-FIELD onto live objects,
 * replaces the ME-save events wholesale (plain data), restores the RNG cursor so the guest's seed
 * pointer matches after the host alone consumed `randSeedInt`, and merges the dex / starter blob.
 * Fully guarded as a WHOLE so a partial-blob apply can never hang or crash the guest - the per-turn
 * checksum re-syncs any residual drift.
 *
 * DEFERRED (#633 RISKY B4): this calls {@linkcode applyCoopFullSnapshot}`(o.base)` with `authoritativeGuest`
 * defaulting to `false` (the engine must NOT import the runtime to compute the gate - that is an import
 * cycle), so the new ON-FIELD held-item heal (#1/#2/#3) and ball-count heal (#4) do NOT fire at the ME
 * terminal; they heal on the NEXT per-turn checkpoint resync instead. Threading an `authoritativeGuest`
 * param through here from a cycle-free caller is a separate follow-up, not this batch.
 */
export function applyCoopMeOutcome(o: Extract<CoopInteractionOutcome, { k: "meResync" }>): void {
  try {
    if (o.base != null) {
      applyCoopFullSnapshot(o.base);
    }
    applyCoopMePartyFromData(o.party);
    // mysteryEncounterSaveData: replace encounteredEvents wholesale (it is plain data).
    if (typeof o.meSaveData === "string" && o.meSaveData.length > 0) {
      globalScene.mysteryEncounterSaveData.encounteredEvents = JSON.parse(o.meSaveData);
    }
    // RNG cursor: restore so the guest's seed pointer matches after the host alone advanced it.
    if (typeof o.seed === "string") {
      globalScene.setSeed(o.seed);
    }
    if (typeof o.waveSeed === "string") {
      globalScene.waveSeed = o.waveSeed;
      Phaser.Math.RND.sow([o.waveSeed]);
    }
    applyCoopDexDelta(o.dex);
  } catch {
    // A resync apply failure must NEVER hang or crash the guest; the per-turn checksum re-syncs.
  }
}
