/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op GUEST enemy RECONSTRUCTOR (#633). Rebuilds ONE live EnemyPokemon from the
// host's serialized identity so the guest fights the host's EXACT mon (species /
// form / level / ability / nature / gender / IVs / moveset / held items) instead of
// rolling its own from a diverged RNG.
//
// Extracted into its own module so BOTH the wave-start adopt (`encounter-phase.ts`)
// AND the mid-wave ME battle handoff adopt (`encounter-phase-utils.ts`) can import it
// WITHOUT an import cycle (encounter-phase imports encounter-phase-utils, so the
// utils file can't import back from encounter-phase).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { fieldPositionForSlot } from "#data/battle-format";
import { applyCoopEnemies, applyCoopEnemyHeldItems } from "#data/elite-redux/coop/coop-battle-engine";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopSerializedEnemy, CoopSerializedPokemon } from "#data/elite-redux/coop/coop-transport";
import type { Gender } from "#data/gender";
import { BattleType } from "#enums/battle-type";
import type { BiomeId } from "#enums/biome-id";
import type { Nature } from "#enums/nature";
import { Stat } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import type { EnemyPokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** Read a number field from an opaque serialized blob, or undefined if absent/wrong type. */
function coopNum(blob: CoopSerializedPokemon, key: string): number | undefined {
  const v = blob[key];
  return typeof v === "number" ? v : undefined;
}

/**
 * Co-op GUEST (#633, LIVE-D6): reconstruct ONE enemy from the host's serialized
 * identity so the guest fights the host's EXACT mon (species / form / level /
 * ability / nature / gender / IVs / moveset) instead of rolling its own from a
 * diverged RNG. Mirrors `buildDevEnemy`. Returns null when the species doesn't
 * resolve, so the caller leaves the slot for normal generation.
 */
export function buildCoopEnemy(
  data: CoopSerializedPokemon,
  fallbackLevel: number,
  trainerSlot: TrainerSlot = TrainerSlot.NONE,
): EnemyPokemon | null {
  const serializedTrainerSlot = coopNum(data, "trainerSlot");
  const authoritativeTrainerSlot =
    serializedTrainerSlot === TrainerSlot.NONE
    || serializedTrainerSlot === TrainerSlot.TRAINER
    || serializedTrainerSlot === TrainerSlot.TRAINER_PARTNER
      ? serializedTrainerSlot
      : trainerSlot;
  const speciesId = coopNum(data, "speciesId");
  if (speciesId === undefined) {
    // Fallback: no species in the host blob -> caller rolls its own (divergence risk). Warn so the
    // log shows the guest did NOT adopt the host's mon here.
    coopWarn("enemy", `buildCoopEnemy FALLBACK bi=${trainerSlot} reason=no-speciesId (guest rolls own)`);
    return null;
  }
  const species = getPokemonSpecies(speciesId);
  if (!species) {
    coopWarn("enemy", `buildCoopEnemy FALLBACK bi=${trainerSlot} reason=species-unresolved speciesId=${speciesId}`);
    return null;
  }
  const level = Math.max(1, Math.floor(coopNum(data, "level") ?? fallbackLevel));
  const enemy = globalScene.addEnemyPokemon(species, level, authoritativeTrainerSlot, false);
  const id = coopNum(data, "id");
  if (id !== undefined) {
    enemy.id = id >>> 0;
  }
  const formIndex = coopNum(data, "formIndex");
  if (formIndex !== undefined) {
    enemy.formIndex = formIndex;
  }
  const abilityIndex = coopNum(data, "abilityIndex");
  if (abilityIndex !== undefined) {
    enemy.abilityIndex = abilityIndex;
  }
  const nature = coopNum(data, "nature");
  if (nature !== undefined) {
    enemy.nature = nature as Nature;
  }
  const gender = coopNum(data, "gender");
  if (gender !== undefined) {
    enemy.gender = gender as Gender;
  }
  // Adopt the host's authoritative shiny + variant (#633): the constructor already
  // rolled its own from a divergent RNG cursor, so override it here - BEFORE the
  // encounter loop calls loadAssets() - and both clients render (and catch) the same
  // mon. `typeof === "boolean"` so an explicit `false` still overrides a rolled shiny.
  if (typeof data.shiny === "boolean") {
    enemy.shiny = data.shiny;
  }
  const variant = coopNum(data, "variant");
  if (variant !== undefined) {
    enemy.variant = variant as 0 | 1 | 2;
  }
  if (typeof data.isTerastallized === "boolean") {
    enemy.isTerastallized = data.isTerastallized;
  }
  const teraType = coopNum(data, "teraType");
  if (teraType !== undefined) {
    enemy.teraType = teraType as EnemyPokemon["teraType"];
  }
  if (Array.isArray(data.ivs)) {
    const ivs = (data.ivs as unknown[]).filter((n): n is number => typeof n === "number").slice(0, 6);
    if (ivs.length === 6) {
      enemy.ivs = ivs;
    }
  }
  if (Array.isArray(data.moveset)) {
    const moveIds = (data.moveset as unknown[]).filter((n): n is number => typeof n === "number");
    if (moveIds.length > 0) {
      const moves = moveIds.map(id => new PokemonMove(id));
      enemy.moveset = moves;
      enemy.summonData.moveset = moves.slice();
    }
  }
  // Form / nature / IVs changed -> recompute as a backwards-compatible fallback. Modern manifests carry
  // the host's finished six-stat array because ER generation hooks can make local reconstruction differ.
  enemy.calculateStats();
  if (Array.isArray(data.stats)) {
    const stats = (data.stats as unknown[]).filter((n): n is number => typeof n === "number").slice(0, 6);
    if (stats.length === 6 && stats.every(stat => Number.isFinite(stat) && stat > 0)) {
      enemy.stats = stats.map(stat => Math.trunc(stat));
    }
  }
  if (Array.isArray(data.statStages)) {
    const stages = (data.statStages as unknown[])
      .filter((stage): stage is number => typeof stage === "number" && Number.isFinite(stage))
      .slice(0, 7);
    if (stages.length === 7) {
      const liveStages = enemy.getStatStages();
      for (let index = 0; index < 7 && index < liveStages.length; index++) {
        liveStages[index] = Math.max(-6, Math.min(6, Math.trunc(stages[index])));
      }
    }
  }
  enemy.generateName();
  // Boss adopt (#633, A/BLOCKING-2): boss state lives ONLY on EnemyPokemon and `addEnemyPokemon`
  // reconstructs with boss hardcoded `false`, so an adopted boss renders normal bars. Re-assert the
  // host's authoritative boss state AFTER calculateStats (so getMaxHp/segment-size are right) and
  // BEFORE the hp clamp below. Pass the EXPLICIT host segment count to setBoss so the
  // `?? getEncounterBossSegments` fallback can NEVER re-roll segments from the guest's diverged wave
  // RNG, then restore the host's bossSegmentIndex (the count alone renders the wrong shield dividers)
  // and initBattleInfo() so the segmented bar renders. Self-gating: only fires when the host streamed
  // bossSegments>0 (solo never produces it), so no extra authoritative gate is needed here.
  const bossSegments = coopNum(data, "bossSegments");
  if (bossSegments !== undefined && bossSegments > 0) {
    enemy.setBoss(true, bossSegments);
    const bsi = coopNum(data, "bossSegmentIndex");
    if (bsi !== undefined) {
      enemy.bossSegmentIndex = bsi;
    }
    enemy.initBattleInfo();
    coopLog(
      "replay",
      `guest adopt enemy trainerSlot=${authoritativeTrainerSlot} isBoss segments=${bossSegments} index=${enemy.bossSegmentIndex}`,
    );
  } else if (data.isBoss === false || bossSegments === 0) {
    // Modern host manifests state the neutral boss value explicitly.  Re-assert it just as deliberately
    // as the positive branch so a same-object/future constructor path can never retain stale boss bars.
    // This is RNG-free: setBoss(false) only writes the canonical numeric neutral state (0/0).
    enemy.setBoss(false);
  }
  // The serialized maxHp is authoritative state, not merely an hp clamp. ER modifiers and per-client
  // constructor context can make an otherwise identical species/level/IV reconstruction calculate a
  // different HP stat (the continuous ME+biome journey caught host=40, guest=42). Force the host ceiling
  // before assigning current hp, exactly like the full-snapshot materializer, so the first visible frame
  // of a wave is already converged rather than waiting for a later checksum heal.
  const maxHp = coopNum(data, "maxHp");
  if (maxHp !== undefined && maxHp > 0 && enemy.getMaxHp() !== Math.trunc(maxHp)) {
    coopWarn("enemy", `buildCoopEnemy maxHp authority host=${Math.trunc(maxHp)} guest=${enemy.getMaxHp()} -> applied`);
    enemy.setStat(Stat.HP, Math.trunc(maxHp));
  }
  const hp = coopNum(data, "hp");
  if (hp !== undefined) {
    const ceiling = maxHp !== undefined && maxHp > 0 ? maxHp : enemy.getMaxHp();
    enemy.hp = Math.max(0, Math.min(hp, ceiling));
  }
  // Held items (#633): reconstruct the host's serialized held modifiers onto THIS enemy
  // (remapping pokemonId to the live id). The adopt path suppresses the guest's own
  // generateEnemyModifiers for these enemies, so this is the sole source of their items.
  applyCoopEnemyHeldItems(enemy.id, data.heldItems);
  // Per-enemy adopt summary (per-wave-ish, not a tight loop): the host-authoritative identity the
  // guest reconstructed, so a divergence (wrong species/form/ability/level/hp on the guest) is
  // visible. heldItems summarized by count (the full reconcile logs in applyCoopEnemyHeldItems).
  coopLog(
    "enemy",
    `buildCoopEnemy ADOPT trainerSlot=${authoritativeTrainerSlot} species=${speciesId} form=${enemy.formIndex} lv=${enemy.level} abilityIdx=${enemy.abilityIndex} nature=${enemy.nature} gender=${enemy.gender} shiny=${enemy.shiny} tera=${enemy.isTerastallized ? 1 : 0}:${enemy.teraType} hp=${enemy.hp}/${enemy.getMaxHp()} moves=${enemy.moveset.length} heldItems=${Array.isArray(data.heldItems) ? data.heldItems.length : 0}`,
  );
  return enemy;
}

/**
 * Co-op GUEST (#818): STRUCTURAL enemy-party adopt. `applyCoopEnemies` below is a
 * field-CORRECTOR - it fixes stats on a same-species mon and SKIPS a slot that is empty
 * or holds a different species. That skip was the seam for mid-wave ME-SPAWNED battles
 * (the encounter engine rolls the party on the HOST only; the guest's local slot is its
 * own unrelated wave roll or empty), so the guest silently fought DIFFERENT mons. This
 * function guarantees the guest's party IS the streamed party: mismatched/missing slots
 * are REBUILT verbatim via buildCoopEnemy, extra local slots are dropped, and (for WILD
 * battles) the double flag follows the authoritative count - the guest derives its battle
 * SHAPE from the stream, never from its own assumptions. Ends with the field-corrector
 * pass so matching slots converge exactly.
 */
export function adoptCoopEnemiesStructural(enemies: CoopSerializedEnemy[]): void {
  try {
    const battle = globalScene.currentBattle;
    if (battle == null || enemies.length === 0) {
      return;
    }
    // Protocol 29: adopt an ME option's pre-battle biome transition before constructing/summoning the
    // streamed enemies. Without this, combat state could stay synchronized while the guest rendered the
    // previous arena and entered the next wave from a different biome.
    const authoritativeBiome = coopNum(enemies[0].data, "coopArenaBiomeId");
    if (authoritativeBiome !== undefined && globalScene.arena.biomeId !== authoritativeBiome) {
      coopLog(
        "me",
        `ME battle arena authority biome ${globalScene.arena.biomeId} -> ${authoritativeBiome} before summon`,
      );
      globalScene.newArena(authoritativeBiome as BiomeId);
    }
    const isTrainer = battle.battleType === BattleType.TRAINER;
    const trainerSlot = isTrainer ? TrainerSlot.TRAINER : TrainerSlot.NONE;
    let rebuilt = 0;
    for (const entry of enemies) {
      const existing = battle.enemyParty[entry.fieldIndex];
      // A retained state image can make the locally rolled enemy active before the final turn-one
      // enemyParty carrier replaces it with the host's immutable identity. Remember that exact live
      // occupancy before leaveField removes the old object. Pre-summon ME/colosseum adoption has no
      // active object, so it deliberately stays inactive and still follows its ordinary SummonPhase.
      const activeFieldIndex = existing == null ? -1 : globalScene.field.getIndex(existing);
      const wantSpecies = coopNum(entry.data, "speciesId");
      if (existing != null && (wantSpecies === undefined || existing.species.speciesId === wantSpecies)) {
        continue; // same mon - the corrector pass below converges its state
      }
      const level = coopNum(entry.data, "level") ?? existing?.level ?? battle.enemyLevels?.[entry.fieldIndex] ?? 1;
      const built = buildCoopEnemy(entry.data, level, trainerSlot);
      if (built == null) {
        continue; // unresolvable blob - leave the local mon (corrector will warn on mismatch)
      }
      try {
        existing?.leaveField(true, true, true);
      } catch {
        /* stale sprite teardown must not block the adopt */
      }
      battle.enemyParty[entry.fieldIndex] = built;
      if (activeFieldIndex >= 0) {
        built.setFieldPosition(fieldPositionForSlot(entry.fieldIndex, battle.arrangement.enemyCapacity));
        // Preserve the old object's display-list depth as well as its mechanical field membership. A
        // plain add would make commands legal again but could render the rebuilt enemy over trainers/UI.
        globalScene.field.addAt(built, Math.min(activeFieldIndex, globalScene.field.length));
        built.setVisible(true);
        built.getSprite().setVisible(true);
      }
      // #836 SPRITE: a REBUILT slot is a brand-new EnemyPokemon that never went through the
      // encounter-phase asset load (buildCoopEnemy deliberately leaves loadAssets to "the
      // encounter loop", but the structural adopt paths - the ME-battle boot in
      // CoopReplayMePhase.finishWithoutLeaving + the colosseum round boot - drive their summon
      // through MysteryEncounterBattlePhase's SummonPhase, which does NOT load assets). Without
      // this its real sprite atlas is never requested, so it renders the substitute-doll
      // placeholder for the whole fight (the live "I just saw two SUBSTITUTES" report). Kick the
      // real load now (fire-and-forget, mirroring applyCoopEnemies + adoptCoopMeBattleParty): the
      // #205 placeholder swaps to the real sprite when loadAssets completes, even after the mon is
      // already fielded. loadAssets internally queues its atlas + waits its own COMPLETE, so a
      // per-mon call is the same shape the encounter-phase enemy load uses (#154/#140 loader
      // pattern); the guest draws no RNG here (loadAssets is pure asset I/O).
      void built.loadAssets();
      rebuilt++;
    }
    if (!isTrainer) {
      // Drop local extras beyond the authoritative count (a leftover local wild roll).
      while (battle.enemyParty.length > enemies.length) {
        const extra = battle.enemyParty.pop();
        try {
          extra?.leaveField(true, true, true);
        } catch {
          /* ditto */
        }
        rebuilt++;
      }
      // WILD battle shape follows the authoritative party (trainer field size is variant-
      // driven and its sync carries the FULL bench, so count>=2 must not force double there).
      const wantDouble = enemies.length >= 2;
      if (battle.double !== wantDouble) {
        coopLog("enemy", `structural adopt: shape align double ${battle.double} -> ${wantDouble} (#818)`);
        battle.setDouble(wantDouble);
      }
    }
    if (rebuilt > 0) {
      coopLog("enemy", `structural adopt: REBUILT ${rebuilt} enemy slot(s) from the host stream (#818)`);
    }
    applyCoopEnemies(enemies);
  } catch (e) {
    coopWarn("enemy", "structural enemy adopt failed (falling back to corrector)", e);
    applyCoopEnemies(enemies);
  }
}
