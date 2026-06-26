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
  CoopInteractionOutcome,
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
import type { MoveId } from "#enums/move-id";
import type { Nature } from "#enums/nature";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
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
        // Also stamp the FAINT status (#633 trainer-victory deadlock): the host's real FaintPhase
        // calls doSetStatus(FAINT) before leaveField, so on the host a KOd enemy reads
        // isFainted(true)===true. VictoryPhase's win-branch guard is `!getEnemyParty().find(p =>
        // !p.isFainted(true))` - it checks the STATUS, not just hp. Without this the off-field KOd
        // enemy (still in getEnemyParty) reads isFainted(true)===false on the guest, so the find
        // returns it, the guard is false, and the guest's VictoryPhase SKIPS the entire trainer
        // reward chain + SelectModifierPhase (the deadlock: the host parks as the reward WATCHER
        // waiting for the guest/OWNER's picks the guest never makes). doSetStatus(FAINT) is a pure
        // field assignment (no phase / RNG), so it stays side-effect-free like the rest of the removal.
        enemy.doSetStatus(StatusEffect.FAINT);
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
      try {
        // Side-effect-free removal: zero hp so it reads as fainted, then leaveField (no
        // FaintPhase / resolution pipeline - that would re-introduce the engine divergence
        // authoritative mode exists to prevent).
        mon.hp = 0;
        // Stamp FAINT status for the same reason as the enemy side (#633 trainer-victory deadlock):
        // VictoryPhase / isFainted(true) checks the status, not just hp. Mirrors the host FaintPhase.
        mon.doSetStatus(StatusEffect.FAINT);
        mon.leaveField(true, true, false);
      } catch {
        /* one player removal failed; leave it and continue the reconcile */
      }
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
    // Reconcile arena tags (#633 GAP 1): add hazards/screens/tailwind the guest's MoveEffectPhases
    // never set, remove ones the host cleared. This is the top resync-loop fix - the checksum hashes
    // `(tagType, side)`, so converging the SET is what makes it stop diverging every turn.
    reconcileArenaTags(checkpoint.arenaTags);
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
  const tera = readTeraState(mon);
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
      // Rich arena tags (#633 GAP 1): the resync path reconciles the guest's arena identically to
      // the per-turn checkpoint (hazards / screens / tailwind), carrying turnCount + layers.
      arenaTags: readArenaTagViews(),
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

/** Apply ONE full mon snapshot onto a live mon (ability/form/tera FIRST, then stats, then hp). */
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
    // Tera state (#633 GAP 7): force the host's authoritative Tera state so a dropped/extra Tera
    // command heals (it changes the mon's type/STAB, which the per-turn checkpoint can't carry).
    // Set BEFORE calculateStats so a tera-driven stat path uses the authoritative flag.
    if (snap.isTerastallized !== undefined) {
      mon.isTerastallized = snap.isTerastallized;
    }
    if (snap.teraType !== undefined) {
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
    mon.calculateStats();
    // maxHp force (#633 GAP 3): the checkpoint clamps hp to the LOCAL getMaxHp(); if maxHp itself
    // diverged (IV / level / form / stat-calc mismatch) hp clamps to the wrong ceiling and the
    // snapshot only setting hp leaves a permanent loop. After the recompute, if our maxHp still
    // differs from the host's, FORCE the HP stat to the host value so getMaxHp() matches and hp
    // clamps correctly. A loud warn surfaces the UPSTREAM stat divergence for a later root-cause fix
    // (forcing maxHp stops the loop but MASKS the real cause; the log makes it findable).
    if (typeof snap.maxHp === "number" && snap.maxHp > 0 && mon.getMaxHp() !== Math.trunc(snap.maxHp)) {
      console.warn(`[coop-maxhp] divergence bi=${snap.bi} host=${Math.trunc(snap.maxHp)} guest=${mon.getMaxHp()}`);
      mon.setStat(Stat.HP, Math.trunc(snap.maxHp));
    }
    // Status.
    mon.status = snap.status ? new Status(snap.status as StatusEffect) : null;
    // Stat stages (7).
    const stages = mon.getStatStages();
    for (let i = 0; i < 7 && i < stages.length; i++) {
      stages[i] = Math.max(-6, Math.min(6, Math.trunc(snap.statStages[i] ?? 0)));
    }
    // HP last, clamped to the (now host-forced) max.
    mon.hp = Math.max(0, Math.min(Math.trunc(snap.hp), mon.getMaxHp()));
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
 * binding. Held-item structure converges at the wave boundary via the enemy/party adopt; here we
 * only touch the count-only global modifiers that the GAP-2 divergence is actually about. Does NOT
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
        // The host no longer has this global modifier -> drop it (count-only, side-effect-free).
        if (globalScene.removeModifier(modifier)) {
          changed = true;
        }
        continue;
      }
      if (modifier.stackCount !== want) {
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
    // Number of on-field leads (a single in singles, two in a double): never reordered here.
    const onFieldCount = globalScene.getPlayerField(false).length;
    if (party.length <= onFieldCount + 1) {
      return false; // 0 or 1 bench mon -> nothing to reorder.
    }
    // Build the desired BENCH order from the host's speciesId sequence at slots >= onFieldCount,
    // matching each against the guest's actual bench mons by speciesId (first-available wins).
    const bench = party.slice(onFieldCount);
    const remaining = [...bench];
    const desired: Pokemon[] = [];
    for (let i = onFieldCount; i < hostParty.length; i++) {
      const wantSpecies = hostParty[i];
      const idx = remaining.findIndex(p => (p.species?.speciesId ?? -1) === wantSpecies);
      if (idx >= 0) {
        desired.push(remaining[idx]);
        remaining.splice(idx, 1);
      }
    }
    // Append any guest bench mons the host order didn't account for (defensive; keeps every mon).
    desired.push(...remaining);
    // No change? (already aligned) -> done.
    const changed = desired.some((p, i) => p !== bench[i]);
    if (!changed) {
      return false;
    }
    // Write the reordered bench back in place (on-field leads untouched at the head).
    for (let i = 0; i < desired.length; i++) {
      party[onFieldCount + i] = desired[i];
    }
    return true;
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
 * would tear down the running battle). Held-item structure is intentionally NOT rewritten
 * mid-battle (it converges at the wave boundary via the enemy/party adopt); the player party
 * ORDER is adopted OFF-FIELD ONLY here (#633 GAP 4, {@linkcode adoptCoopHostPlayerPartyOrder} -
 * bench-only, safe at any boundary). Fully guarded so a malformed snapshot can never crash the guest.
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
    // Reconcile arena tags (#633 GAP 1): the full snapshot now HEALS hazards / screens / tailwind,
    // not just the per-turn checkpoint - so a guest that resyncs on a mismatch converges its arena.
    reconcileArenaTags(snapshot.arenaTags);
    globalScene.money = snapshot.money;
    // Reconcile persistent modifier / relic stacks (#633 GAP 2): a stack-count divergence is hashed
    // -> a permanent still-diverged loop; heal it by adopting the host's stack counts (safe subset).
    reconcileCoopModifierStacks(snapshot.modifiers);
    // Adopt the host's player party ORDER (#633 GAP 4): OFF-FIELD-only bench reorder (safe at any
    // boundary) so the hashed `party` speciesId sequence converges. On-field leads are untouched.
    adoptCoopHostPlayerPartyOrder(snapshot.party);
  } catch {
    // A malformed snapshot must never crash the guest's battle.
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
export function captureCoopDexDelta(): string {
  try {
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
    return compressToBase64(JSON.stringify({ dex, starter: globalScene.gameData.starterData }));
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
    const dexData = globalScene.gameData.dexData;
    for (const [id, e] of Object.entries(parsed.dex ?? {})) {
      const entry = dexData[Number(id)];
      if (entry == null) {
        continue;
      }
      entry.seenAttr = BigInt(e.seenAttr);
      entry.caughtAttr = BigInt(e.caughtAttr);
      entry.natureAttr = e.natureAttr;
      entry.seenCount = e.seenCount;
      entry.caughtCount = e.caughtCount;
      entry.hatchedCount = e.hatchedCount;
      if (Array.isArray(e.ivs)) {
        entry.ivs = [...e.ivs];
      }
    }
    // Merge starter entries field-by-field onto the live starterData (candy / friendship / egg
    // moves / ability+passive unlocks an ME can grant), leaving any local-only entry alone.
    const starterData = globalScene.gameData.starterData;
    for (const [id, s] of Object.entries(parsed.starter ?? {})) {
      if (s != null && typeof s === "object") {
        const key = Number(id);
        starterData[key] = { ...(starterData[key] ?? {}), ...s };
      }
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
      const surplus = live[live.length - 1];
      if (surplus == null) {
        break;
      }
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
