import { globalScene } from "#app/global-scene";
import {
  applyErCustomTrainerDisplayName,
  applyErCustomTrainerPresentation,
  buildErCustomTrainerMember,
  clearErCustomTrainerDevForce,
  erCustomTrainerHeldModifierConfigs,
  getErCustomTrainerDevForce,
  markErCustomTrainerUsed,
  resolveErCustomTrainerMoveIds,
  resolveErCustomTrainerParty,
  selectErCustomTrainerForWave,
  setErCustomTrainerBstBypass,
} from "#data/elite-redux/er-custom-trainers";
import { BattleType } from "#enums/battle-type";
import { TrainerSlot } from "#enums/trainer-slot";
import type { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import type { EnemyPokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import type { PersistentModifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { trainerConfigs } from "#trainers/trainer-config";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/**
 * Elite Redux: if a staff-authored custom trainer (er-custom-trainers.json) is
 * eligible for the CURRENT wave, install it — convert the wave into a trainer
 * battle with the authored sprite/name and field the EXACT authored party
 * (species/form/level/moveset/ability/fusion + held items), bypassing the #419
 * elite BST cap. Gated by the active difficulty, floor range/endless and
 * challenge-exclusivity in {@linkcode selectErCustomTrainerForWave}.
 *
 * Runs after `newBattle()` has built the wave but before EncounterPhase's
 * `genPartyMember`, so the wave can be rewritten into the authored trainer. It is
 * driven from TWO call sites:
 *   - {@linkcode NewBattlePhase} for every wave transition (wave 2 onward), and
 *   - the initial `newBattle()` in SelectStarterPhase, but ONLY when a DEV FORCE
 *     is armed (staff picking a trainer from the in-game Dev Scenarios picker) —
 *     the first wave of a run never runs NewBattlePhase, so a forced pick would
 *     otherwise drop into a normal wild/trainer battle instead of the trainer.
 *
 * SOLO PATH ONLY. Co-op sessions are skipped: custom-trainer adoption into a
 * co-op run needs the host-authoritative selection/relay seam and must not touch
 * `src/data/elite-redux/coop/**`. That is a documented future seam.
 *
 * The bypass flag is always reset here first, so a wave WITHOUT a custom trainer
 * never leaks a previous wave's bypass. A successful DEV-FORCED install clears the
 * force override (one-shot), so subsequent battles in the run are normal.
 */
export function installErCustomTrainerForCurrentWave(): void {
  // Clear any prior wave's BST-cap bypass before deciding this wave.
  setErCustomTrainerBstBypass(false);
  const battle = globalScene.currentBattle;
  if (!battle) {
    return;
  }
  // Solo path only — co-op adoption is a documented future seam.
  if (globalScene.gameMode.isCoop) {
    return;
  }
  const wave = battle.waveIndex;
  // Never hijack scripted content: mystery encounters, fixed battles, or the
  // canonical boss waves (`% 10 === 0`) keep their vanilla/ER progression.
  if (
    battle.battleType === BattleType.MYSTERY_ENCOUNTER
    || globalScene.gameMode.isFixedBattle(wave)
    || wave % 10 === 0
  ) {
    return;
  }
  // Captured BEFORE selection so a forced install can clear the one-shot override.
  const forcedKey = getErCustomTrainerDevForce();
  const resolved = selectErCustomTrainerForWave(wave);
  if (!resolved) {
    return;
  }
  try {
    // Tear down any pre-rolled trainer / wild party; we rebuild from scratch.
    if (battle.battleType === BattleType.TRAINER && battle.trainer) {
      globalScene.field.remove(battle.trainer, false);
      battle.trainer.destroy();
      battle.trainer = null;
    }
    // Field the authored gendered sprite: FEMALE for a class that ships both an
    // `_m`/`_f` sprite (`hasGenders`); the Trainer ctor silently demotes FEMALE
    // to the base sprite for a single-sprite class, so a bad pairing never breaks.
    // The authored name (assigned next) survives the variant (see getName).
    const variant = resolved.gender === "f" ? TrainerVariant.FEMALE : TrainerVariant.DEFAULT;
    const baseConfig = trainerConfigs[resolved.trainerType as TrainerType];
    const configOverride = resolved.trainerSpriteKey && baseConfig ? baseConfig.clone() : undefined;
    if (configOverride) {
      const spriteKey = resolved.trainerSpriteKey;
      const gendered = resolved.trainerSpriteGenders;
      configOverride.hasGenders = gendered;
      configOverride.getSpriteKey = female => `${spriteKey}${gendered ? `_${female ? "f" : "m"}` : ""}`;
    }
    const trainer = new Trainer(
      resolved.trainerType as TrainerType,
      variant,
      undefined,
      undefined,
      undefined,
      configOverride,
    );
    applyErCustomTrainerDisplayName(trainer, resolved.name);
    // Per-trainer BATTLE MUSIC (this battle only). trainerConfigs[type] is a
    // SHARED singleton, so we must NOT mutate config.battleBgm — instead we
    // shadow the INSTANCE getters (exactly how a ghost battle overrides its
    // theme to the Cynthia piano; see markTrainerAsGhost in er-ghost-teams.ts).
    // playBgm lazily loads an unknown key from audio/bgm/<key>.mp3. Because a
    // fresh Trainer is built every wave, the override never leaks to the next
    // wave — same clean-reset discipline as the #419 BST-bypass flag below.
    // BOTH getters: getBattleBgm serves only the GEN-5 music preference; the
    // DEFAULT preference routes through getMixedBattleBgm (the #403 lesson).
    if (resolved.battleBgm) {
      const bgm = resolved.battleBgm;
      trainer.getBattleBgm = () => bgm;
      trainer.getMixedBattleBgm = () => bgm;
    }
    // Per-trainer INTRO BLURB (this battle only): shown as the encounter line at
    // battle start via the instance-level encounterMessagesOverride seam (the same
    // one the LLM director uses), so it never mutates the shared class config. The
    // player-facing "Skip custom trainer intros" setting suppresses it entirely,
    // in which case the trainer keeps its default class encounter line.
    if (resolved.introDialogue && !globalScene.skipCustomTrainerIntros) {
      trainer.encounterMessagesOverride = [resolved.introDialogue];
    }
    // Per-trainer VICTORY / DEFEAT lines + TRAINER-SPRITE aura effect (this battle
    // only). These reuse the ghost dialogue + aura seams EXACTLY (getVictoryMessages
    // / getDefeatMessages instance overrides + erGhostAura, rendered by the existing
    // applyErGhostAuraFx overlay in encounter-phase). Instance-level, so the shared
    // trainerConfigs singleton is never mutated and nothing leaks to the next wave.
    applyErCustomTrainerPresentation(trainer, resolved);
    globalScene.field.add(trainer);
    battle.trainer = trainer;
    battle.battleType = BattleType.TRAINER;
    battle.enemyParty = [];
    battle.setDouble(resolved.isDouble);

    // Resolve the FINAL fielded party for this run (seed-deterministic): per
    // authored slot roll slot-fill (slot 1 always fills), and for a filled slot
    // pick one weighted variant. An empty-rolled slot is simply omitted, so the
    // party can shrink below the authored size — enemyLevels + the party template
    // size below must both match this FINAL fielded count.
    const seed = globalScene.seed ?? "";
    const fielded = resolveErCustomTrainerParty(seed, resolved);
    // Per-fielded-member moves resolved once (seeded RLA/RLNA tokens -> concrete
    // legal moves), keyed by the AUTHORED slot index so the salt is stable.
    const fieldedMoveIds = fielded.map(f => resolveErCustomTrainerMoveIds(seed, resolved.key, f.slotIndex, f.member));

    // Per-index levels: authored explicit level, else the wave curve baseline.
    const baseLevels = battle.enemyLevels ?? [];
    const baseLevel = baseLevels[0] ?? Math.max(5, wave);
    const finalLevels = fielded.map((f, i) => f.member.level ?? baseLevels[i] ?? baseLevel);
    battle.enemyLevels = finalLevels;

    // Resize the party template so genPartyMember stops at the fielded size.
    const template = trainer.getPartyTemplate();
    template.size = fielded.length;

    // Field the exact authored party. The BST-cap bypass is on for the whole
    // battle (set below) so the EnemyPokemon constructor won't devolve them.
    trainer.config.partyMemberFuncs = {};
    fielded.forEach((f, idx) => {
      trainer.config.partyMemberFuncs[idx] = (level, _strength) => {
        const enemy = buildErCustomTrainerMember(
          f.member,
          idx,
          f.member.level ?? level,
          resolved.isDouble,
          fieldedMoveIds[idx],
        );
        // Fallback: an unresolvable species yields a vanilla-rolled slot mon
        // rather than a crash (validation already dropped bad entries).
        return enemy ?? globalScene.addEnemyPokemon(getPokemonSpecies(1), f.member.level ?? level, TrainerSlot.TRAINER);
      };
    });

    // Attach the authored held items per slot (enemy-legal pool).
    const heldByIndex = fielded.map(f => erCustomTrainerHeldModifierConfigs(f.member));
    trainer.config.genModifiersFunc = (party: readonly EnemyPokemon[]): PersistentModifier[] => {
      const out: PersistentModifier[] = [];
      party.forEach((enemy, i) => {
        for (const cfg of heldByIndex[i] ?? []) {
          let modifier: PokemonHeldItemModifier;
          if (cfg.modifier instanceof PokemonHeldItemModifierType) {
            modifier = cfg.modifier.newModifier(enemy);
          } else {
            modifier = cfg.modifier;
            modifier.pokemonId = enemy.id;
          }
          modifier.stackCount = cfg.stackCount ?? 1;
          modifier.isTransferable = cfg.isTransferable ?? modifier.isTransferable;
          out.push(modifier);
        }
      });
      return out;
    };

    // Staff intent wins: exempt this whole battle from the #419 BST cap.
    setErCustomTrainerBstBypass(true);
    markErCustomTrainerUsed(resolved.key);
    // A DEV-FORCED pick is one-shot: clear the force now that it has installed so
    // the rest of the run fields normal (density-driven) battles, not this trainer.
    if (forcedKey && forcedKey === resolved.key) {
      clearErCustomTrainerDevForce();
    }
    // TODO(#902): triple battles are not yet supported; a trainer authored as
    // a triple falls back to a DOUBLE here until triples support lands.
    const tripleNote = resolved.isTriplePending ? " (triple pending #902 -> double)" : "";
    console.info(
      `[er-custom-trainers] installed "${resolved.name}" (${resolved.key}) wave=${wave} type=${resolved.trainerType} double=${resolved.isDouble} team=${fielded.length}/${resolved.slots.length}${tripleNote}`,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[er-custom-trainers] install failed wave=${wave} reason=${reason}`);
    setErCustomTrainerBstBypass(false);
  }
}
