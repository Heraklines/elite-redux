import type { Battle } from "#app/battle";
import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { BASE_HIDDEN_ABILITY_RATE, BASE_SHINY_CHANCE } from "#balance/rates";
import { initMoveAnim, loadMoveAnimAssets } from "#data/battle-anims";
import { modifierTypes } from "#data/data-lists";
import type { IEggOptions } from "#data/egg";
import { Egg } from "#data/egg";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { buildCoopEnemy } from "#data/elite-redux/coop/coop-enemy-builder";
import {
  commitMeAuthorityGuestIntent,
  commitMeOwnerIntent,
  isCoopMeOperationEnabled,
  isCoopMeOperationJournalActive,
  nextCoopMePresentationStep,
} from "#data/elite-redux/coop/coop-me-operation";
import {
  coopMeInProgress,
  coopMeInteractionStartValue,
  setCoopMeActivePresentation,
} from "#data/elite-redux/coop/coop-me-pin-state";
import {
  coopGuestAwaitMeBattleParty,
  coopGuestShouldAdoptMeBattleParty,
  coopHostStreamMeBattleParty,
  coopMeOwnerRelayBattleHandoff,
  coopSessionGeneration,
  failCoopSharedSession,
  getCoopController,
  getCoopInteractionRelay,
  getCoopNetcodeMode,
  getCoopRuntime,
  isCoopAuthoritativeGuest,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_ME_PUMP_SEQ_BASE, COOP_ME_SUB_CHOICE_KINDS } from "#data/elite-redux/coop/coop-seq-registry";
import type { CoopInteractionOutcome } from "#data/elite-redux/coop/coop-transport";
import type { Gender } from "#data/gender";
import { getNatureName } from "#data/nature";
import type { CustomPokemonData } from "#data/pokemon-data";
import type { PokemonSpecies } from "#data/pokemon-species";
import { Status } from "#data/status-effect";
import type { AiType } from "#enums/ai-type";
import { BattleType } from "#enums/battle-type";
import type { BattlerTagType } from "#enums/battler-tag-type";
import { FieldPosition } from "#enums/field-position";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import type { MoveId } from "#enums/move-id";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { Nature } from "#enums/nature";
import { PokemonType } from "#enums/pokemon-type";
import { StatusEffect } from "#enums/status-effect";
import { TrainerSlot } from "#enums/trainer-slot";
import type { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { EnemyPokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import type { CustomModifierSettings, ModifierType } from "#modifiers/modifier-type";
import {
  getPartyLuckValue,
  ModifierTypeGenerator,
  ModifierTypeOption,
  regenerateModifierPoolThresholds,
} from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import type { Variant } from "#sprites/variant";
import type { PokemonData } from "#system/pokemon-data";
import type { TrainerConfig } from "#trainers/trainer-config";
import { trainerConfigs } from "#trainers/trainer-config";
import type { HeldModifierConfig } from "#types/held-modifier-config";
import type { RandomEncounterParams } from "#types/pokemon-common";
import type { OptionSelectConfig, OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import type { PartyOption, PokemonSelectFilter } from "#ui/party-ui-handler";
import { PartyUiMode } from "#ui/party-ui-handler";
import { coerceArray } from "#utils/array";
import { BooleanHolder, randSeedInt, randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

// =============================================================================
// Co-op authoritative non-battle ME sub-prompt forwarding (#633, ADD-2b / ADD-2c). When the HOST
// runs the sole engine for a GUEST-OWNED ME, its `selectPokemonForOption` sub-prompt (party target /
// secondary menu) must await the GUEST's relayed pick instead of opening a LOCAL host party screen.
// The host streams a `subPrompt` descriptor (which capture screen to open) and awaits the slot /
// secondary index on the guest->host pick channel (`seq_me`). Every await has the disconnect-ceiling
// null-end routing to the not-selected / default branch (no host hang).
// =============================================================================
// #840: COOP_ME_PUMP_SEQ_BASE imported from the seq registry (was re-declared locally in 4 files).
/** Disconnect ceiling for every host<->guest ME await; steady state resolves on the relayed pick. */
const COOP_ME_REPLAY_WAIT_MS = 1_200_000;

interface CoopMeWaitBoundary {
  scene: typeof globalScene;
  runtime: ReturnType<typeof getCoopRuntime>;
  controller: ReturnType<typeof getCoopController>;
  generation: number;
  pinned: number;
  wave: number;
  phase: unknown;
}

function captureCoopMeWaitBoundary(): CoopMeWaitBoundary {
  return {
    scene: globalScene,
    runtime: getCoopRuntime(),
    controller: getCoopController(),
    generation: coopSessionGeneration(),
    pinned: coopMeInteractionStartValue(),
    wave: globalScene.currentBattle?.waveIndex ?? -1,
    phase: globalScene.phaseManager.getCurrentPhase(),
  };
}

function coopMeWaitBoundaryLive(boundary: CoopMeWaitBoundary): boolean {
  return (
    globalScene === boundary.scene
    && getCoopRuntime() === boundary.runtime
    && getCoopController() === boundary.controller
    && coopSessionGeneration() === boundary.generation
    && coopMeInteractionStartValue() === boundary.pinned
    && (globalScene.currentBattle?.waveIndex ?? -1) === boundary.wave
    && globalScene.phaseManager.getCurrentPhase() === boundary.phase
  );
}

/** Commit then publish one host-owned presentation. Journal mode never uses raw as correctness carrier. */
function commitAndPublishMePresentation(
  relay: ReturnType<typeof getCoopInteractionRelay>,
  seq: number,
  presentation: Extract<CoopInteractionOutcome, { k: "mePresent" }>,
): boolean {
  const pinned = coopMeInteractionStartValue();
  const operationId = commitMeOwnerIntent({
    kind: "ME_PRESENT",
    seq,
    pinned,
    step: nextCoopMePresentationStep(pinned),
    payload: { present: true, presentation },
    localRole: getCoopController()?.role ?? "host",
    wave: globalScene.currentBattle?.waveIndex ?? -1,
    turn: 0,
  });
  if (operationId == null && isCoopMeOperationEnabled()) {
    failCoopSharedSession(`Mystery presentation ${seq} could not enter authoritative control`);
    return false;
  }
  if (isCoopMeOperationJournalActive()) {
    setCoopMeActivePresentation(presentation);
  } else {
    relay?.sendInteractionOutcome(seq, "mePresent", presentation);
  }
  return true;
}

/** Consume duplicates without allowing an old retry to satisfy the next sub-picker. */
async function awaitCommittedGuestMeSubPick(
  relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>,
  seq: number,
  boundary: CoopMeWaitBoundary,
  label: string,
): Promise<number | null> {
  while (coopMeWaitBoundaryLive(boundary)) {
    const pick = await relay.awaitInteractionChoice(seq, COOP_ME_REPLAY_WAIT_MS, COOP_ME_SUB_CHOICE_KINDS);
    if (!coopMeWaitBoundaryLive(boundary)) {
      return null;
    }
    if (pick == null) {
      getCoopRuntime()?.durability?.reconnect();
      failCoopSharedSession(`${label} ${seq} unavailable after bounded wait`);
      return null;
    }
    if (!isCoopMeOperationEnabled()) {
      return pick.choice;
    }
    const step = pick.data?.[0];
    if (!Number.isSafeInteger(step) || (step as number) < 0) {
      failCoopSharedSession(`${label} ${seq} arrived without an exact operation step`);
      return null;
    }
    const result = commitMeAuthorityGuestIntent({
      kind: "ME_SUB",
      seq,
      pinned: boundary.pinned,
      step: step as number,
      value: pick.choice,
      wave: boundary.wave,
      turn: 0,
    });
    if (result.kind === "duplicate") {
      continue;
    }
    if (result.kind !== "committed") {
      failCoopSharedSession(`${label} ${seq}/${String(step)} could not commit (${result.kind})`);
      return null;
    }
    return pick.choice;
  }
  return null;
}
/**
 * Co-op authoritative non-battle ME (#633, ADD-2c; #818/#827 mirrored): MEs whose selected-option chain
 * pushes a BESPOKE interactive sub-PHASE (ErQuizPhase) that does NOT route through the generic
 * `selectPokemonForOption` party screen + secondary menu (the two sites ADD-2b relays). On a GUEST-OWNED
 * ME of one of these the host has no PARTY/SECONDARY relay site, but it does NOT safe-degrade: #818 co-op
 * quiz MIRRORING streams the whole ErQuizPhase session so BOTH clients run it (the guest owner drives its
 * own answers over the quiz relay), so the host input gate must STAY UP. Enumerated from grepping the
 * encounters - the 8 ErQuizPhase MEs:
 *    TRACKS_IN_THE_SNOW / GUESSING_BOOTH / SCRAMBLED_POKEDEX / SEALED_DOOR / SALVAGE_YARD / LAKE_SPIRIT
 *    / FROZEN_SHAPES / DORMANT_GUARDIAN.
 * #827: CLOWNING_AROUND (a bespoke yes/no OPTION_SELECT via displayYesNoOptions) LEFT this set - it now
 * relays its yes/no as a `{ kind: "secondary" }` sub-prompt through {@linkcode coopHostStreamSecondaryAwaitIndex}
 * exactly like the party->secondary path, so it needs no bespoke handling and falls through to the normal
 * relayed option apply. NOT an open deferral - a closed list; the host always reaches a terminal.
 */
export const COOP_AUTHORITATIVE_BESPOKE_SUB_ME: ReadonlySet<MysteryEncounterType> = new Set([
  MysteryEncounterType.ER_TRACKS_IN_THE_SNOW,
  MysteryEncounterType.ER_GUESSING_BOOTH,
  MysteryEncounterType.ER_SCRAMBLED_POKEDEX,
  MysteryEncounterType.ER_SEALED_DOOR,
  MysteryEncounterType.ER_SALVAGE_YARD,
  MysteryEncounterType.ER_LAKE_SPIRIT,
  MysteryEncounterType.ER_FROZEN_SHAPES,
  MysteryEncounterType.ER_DORMANT_GUARDIAN,
]);

/**
 * Co-op authoritative non-battle ME (#633, ADD-2b; #827): is THIS client the HOST running the sole engine
 * on a GUEST-OWNED ME? Then a `selectPokemonForOption` sub-prompt (party target / secondary menu) - and the
 * bespoke yes/no sub-prompt (#827, {@linkcode coopHostStreamSecondaryAwaitIndex}) - must await the guest's
 * relayed pick (not open a local host screen). Hard `false` off the live authoritative host, when the host
 * OWNS this ME (it drives off local input), and in solo / lockstep - so those paths are byte-identical.
 * Exported so the bespoke yes/no wrapper (clowning-around-encounter) reuses the EXACT predicate rather than
 * re-deriving it.
 */
export function coopHostAwaitsGuestSubPick(): boolean {
  return (
    globalScene.gameMode.isCoop
    && getCoopNetcodeMode() === "authoritative"
    && getCoopController()?.role === "host"
    && coopMeInProgress()
    && !(getCoopController()?.isLocalOwnerAtCounter(coopMeInteractionStartValue()) ?? true)
  );
}

/**
 * Co-op authoritative non-battle ME (#827): stream a bespoke yes/no (or any small labelled choice) as a
 * `{ kind: "secondary", labels }` sub-prompt on `seq_me` and await the guest owner's relayed index -
 * REUSING the EXACT sender + awaiter + disconnect ceiling the party->secondary sub-prompt path
 * ({@linkcode selectPokemonForOption}) already uses. The guest's `CoopReplayMePhase.openSubPickCapture`
 * opens a REAL local OPTION_SELECT with these labels, relays the chosen index, and the caller maps it back
 * onto its handlers. Resolves to:
 *  - the guest's 0-based index over `labels` on a live pick (`labels.length` == the guest's appended cancel
 *    / an out-of-range "not selected" sentinel), or
 *  - `null` when the guest disconnected / the await hit its ceiling (the caller RESCUES with the local UI).
 * The caller MUST have gated on {@linkcode coopHostAwaitsGuestSubPick} first - this opens no local UI and is
 * a bare relay off the awaiting host, so solo / host-owned never reach it and stay byte-identical.
 */
export function coopHostStreamSecondaryAwaitIndex(labels: string[]): Promise<number | null> {
  const seqMe = COOP_ME_PUMP_SEQ_BASE + coopMeInteractionStartValue();
  const relay = getCoopInteractionRelay();
  const prompt: CoopInteractionOutcome = {
    k: "mePresent",
    tokens: {},
    meetsReqs: [],
    labels: [],
    subPrompt: { kind: "secondary", labels },
  };
  coopLog("me", "host streams bespoke yes/no secondary sub-prompt + awaits guest index (#827)", {
    seq: seqMe,
    labels: labels.length,
  });
  if (relay == null || !commitAndPublishMePresentation(relay, seqMe, prompt)) {
    failCoopSharedSession(`Mystery secondary presentation ${seqMe} unavailable`);
    return Promise.resolve(null);
  }
  const boundary = captureCoopMeWaitBoundary();
  return awaitCommittedGuestMeSubPick(relay, seqMe, boundary, "Mystery secondary choice").then(idx => {
    if (idx == null || !coopMeWaitBoundaryLive(boundary)) {
      return null;
    }
    coopLog("me", "host received guest bespoke yes/no sub-pick (#827)", {
      seq: seqMe,
      idx,
      fromNull: false,
    });
    return idx;
  });
}

/**
 * Co-op authoritative non-battle ME (#855): an ME GRANTED a mon while the party is full, so the
 * replace-or-skip picker is the ME OWNER's (the guest's) decision - not the sole-engine host's. Stream a
 * `catchFull` sub-prompt on `seq_me` (the guest opens the REAL picker + relays the chosen party slot) and
 * await the guest's slot, REUSING the exact sender + awaiter + disconnect ceiling the party/secondary
 * sub-prompt path ({@linkcode coopHostStreamSecondaryAwaitIndex} / {@linkcode selectPokemonForOption})
 * already uses. Resolves to:
 *  - the guest's 0-based party slot to REPLACE (0..partySize-1) on a live pick, or
 *  - `null` when the guest cancelled (an out-of-range slot), disconnected, or the await hit its ceiling -
 *    in every case the caller LOUDLY declines the grant (the mon is not added), never hangs.
 * The caller MUST have gated on {@linkcode coopHostAwaitsGuestSubPick} first - this opens no local UI and
 * is a bare relay off the awaiting host, so solo / host-owned never reach it and stay byte-identical.
 */
export function coopHostStreamCatchFullAwaitSlot(pokemonName: string): Promise<number | null> {
  const seqMe = COOP_ME_PUMP_SEQ_BASE + coopMeInteractionStartValue();
  const relay = getCoopInteractionRelay();
  const prompt: CoopInteractionOutcome = {
    k: "mePresent",
    tokens: {},
    meetsReqs: [],
    labels: [],
    subPrompt: { kind: "catchFull", pokemonName },
  };
  coopLog("me", "host streams catch-FULL replace-or-skip sub-prompt + awaits guest slot (#855)", { seq: seqMe });
  if (relay == null || !commitAndPublishMePresentation(relay, seqMe, prompt)) {
    failCoopSharedSession(`Mystery catch-full presentation ${seqMe} unavailable`);
    return Promise.resolve(null);
  }
  const boundary = captureCoopMeWaitBoundary();
  return awaitCommittedGuestMeSubPick(relay, seqMe, boundary, "Mystery catch-full choice").then(slot => {
    if (slot == null || !coopMeWaitBoundaryLive(boundary)) {
      return null;
    }
    const partySize = globalScene.getPlayerParty().length;
    if (slot == null || slot < 0 || slot >= partySize) {
      coopWarn("me", "host: catch-full guest declined/out-of-range/timeout; the granted mon is NOT added (#855)", {
        seq: seqMe,
        slot,
        partySize,
        fromNull: false,
      });
      return null;
    }
    coopLog("me", "host received guest catch-full replace slot (#855)", { seq: seqMe, slot });
    return slot;
  });
}

/**
 * Animates exclamation sprite over trainer's head at start of encounter
 * @param scene
 */
export function doTrainerExclamation(): void {
  const exclamationSprite = globalScene.add.sprite(0, 0, "encounter_exclaim");
  exclamationSprite.setName("exclamation");
  globalScene.field.add(exclamationSprite);
  globalScene.field.moveTo(exclamationSprite, globalScene.field.getAll().length - 1);
  exclamationSprite.setVisible(true);
  exclamationSprite.setPosition(110, 68);
  globalScene.tweens.add({
    targets: exclamationSprite,
    y: "-=25",
    ease: "Cubic.easeOut",
    duration: 300,
    yoyo: true,
    onComplete: () => {
      globalScene.time.delayedCall(800, () => {
        globalScene.field.remove(exclamationSprite, true);
      });
    },
  });

  globalScene.playSound("battle_anims/GEN8- Exclaim", { volume: 0.7 });
}

export interface EnemyPokemonConfig {
  species: PokemonSpecies;
  isBoss: boolean;
  nickname?: string;
  bossSegments?: number;
  bossSegmentModifier?: number; // Additive to the determined segment number
  customPokemonData?: CustomPokemonData;
  formIndex?: number;
  abilityIndex?: number;
  level?: number;
  gender?: Gender;
  passive?: boolean;
  moveSet?: MoveId[];
  nature?: Nature;
  ivs?: [number, number, number, number, number, number];
  shiny?: boolean;
  /** Is only checked if Pokemon is shiny */
  variant?: Variant;
  /** Can set just the status, or pass a timer on the status turns */
  status?: StatusEffect | [StatusEffect, number];
  mysteryEncounterBattleEffects?: (pokemon: Pokemon) => void;
  modifierConfigs?: HeldModifierConfig[];
  tags?: BattlerTagType[];
  dataSource?: PokemonData;
  tera?: PokemonType;
  aiType?: AiType;
  friendship?: number;
}

export interface EnemyPartyConfig {
  /** Formula for enemy level: level += waveIndex / 10 * levelAdditiveModifier */
  levelAdditiveModifier?: number;
  doubleBattle?: boolean;
  /** Generates trainer battle solely off trainer type */
  trainerType?: TrainerType;
  /** More customizable option for configuring trainer battle */
  trainerConfig?: TrainerConfig;
  pokemonConfigs?: EnemyPokemonConfig[];
  /** `true` for female trainer, false for male */
  female?: boolean;
  /** `true` will prevent player from switching */
  disableSwitch?: boolean;
  /** `true` or leaving undefined will increment dex seen count for the encounter battle, `false` will not */
  countAsSeen?: boolean;
}

/**
 * Generates an enemy party for a mystery encounter battle
 * This will override and replace any standard encounter generation logic
 * Useful for tailoring specific battles to mystery encounters
 * @param partyConfig Can pass various customizable attributes for the enemy party, see EnemyPartyConfig
 */
export async function initBattleWithEnemyConfig(partyConfig: EnemyPartyConfig): Promise<void> {
  const loaded: boolean = false;
  const loadEnemyAssets: Promise<void>[] = [];

  const battle: Battle = globalScene.currentBattle;

  let doubleBattle: boolean = partyConfig?.doubleBattle ?? false;

  // Trainer
  const trainerType = partyConfig?.trainerType;
  const partyTrainerConfig = partyConfig?.trainerConfig;
  let trainerConfig: TrainerConfig;
  if (trainerType != null || partyTrainerConfig) {
    globalScene.currentBattle.mysteryEncounter!.encounterMode = MysteryEncounterMode.TRAINER_BATTLE;
    if (globalScene.currentBattle.trainer) {
      globalScene.currentBattle.trainer.setVisible(false);
      globalScene.currentBattle.trainer.destroy();
    }

    trainerConfig = partyTrainerConfig ? partyTrainerConfig : trainerConfigs[trainerType!];

    let doubleTrainer = trainerConfig.doubleOnly || (trainerConfig.hasDouble && !!partyConfig.doubleBattle);
    // Co-op (#818): every fight fields BOTH players, so ME trainer battles are DOUBLE.
    // A party config with fewer than 2 scripted mons is fine - the generation loop fills
    // the extra slot from the trainer's own party template (genPartyMember), per the
    // maintainer's spec ("for trainer battles we can just send out another mon").
    if (globalScene.gameMode?.isCoop === true) {
      doubleTrainer = true;
    }
    doubleBattle = doubleTrainer;
    const trainerFemale = partyConfig.female == null ? !!randSeedInt(2) : partyConfig.female;
    const newTrainer = new Trainer(
      trainerConfig.trainerType,
      doubleTrainer ? TrainerVariant.DOUBLE : trainerFemale ? TrainerVariant.FEMALE : TrainerVariant.DEFAULT,
      undefined,
      undefined,
      undefined,
      trainerConfig,
    );
    newTrainer.x += 300;
    newTrainer.setVisible(false);
    globalScene.field.add(newTrainer);
    globalScene.currentBattle.trainer = newTrainer;
    loadEnemyAssets.push(newTrainer.loadAssets().then(() => newTrainer.initSprite()));

    const generatedLevels = globalScene.currentBattle.trainer.getPartyLevels(globalScene.currentBattle.waveIndex);
    const configuredParty = partyConfig.pokemonConfigs;
    if (configuredParty && configuredParty.length > 0) {
      // An explicit ME party is an authoritative structural statement, not a prefix for the
      // generic trainer template. Iterating the template's party length used to append unrelated
      // generated mons (and truncate configs longer than that template), so Still Waters could
      // mirror a two-mon party as three enemies. Preserve the one scripted exception required by
      // co-op doubles: a single config gets one generated partner for the second field slot.
      const partySize = Math.max(configuredParty.length, doubleTrainer ? 2 : 1);
      battle.enemyLevels = Array.from(
        { length: partySize },
        (_, index) => configuredParty[index]?.level ?? generatedLevels[index] ?? battle.getLevelForWave(),
      );
    } else {
      battle.enemyLevels = generatedLevels;
    }
  } else {
    // Wild
    globalScene.currentBattle.mysteryEncounter!.encounterMode = MysteryEncounterMode.WILD_BATTLE;
    // Co-op (#818): every fight fields BOTH players. Scripted 1v1 encounters conflict with
    // that, so per the maintainer's spec the single scripted mon is DUPLICATED into a true
    // 2v2 (same species/level/boss flags; dataSource stripped so the copy rolls its own
    // identity/IVs - two mons must never share a pokemon id). No configs = two random wilds,
    // exactly like a normal co-op double. Runs on the HOST only (the guest adopts the party
    // verbatim via the ME battle handoff stream, which now carries both mons).
    if (globalScene.gameMode?.isCoop === true) {
      doubleBattle = true;
      if (partyConfig?.pokemonConfigs?.length === 1) {
        const { dataSource: _omitted, ...copy } = partyConfig.pokemonConfigs[0];
        partyConfig.pokemonConfigs.push(copy);
      }
    }
    const numEnemies =
      partyConfig?.pokemonConfigs && partyConfig.pokemonConfigs.length > 0
        ? partyConfig?.pokemonConfigs?.length
        : doubleBattle
          ? 2
          : 1;
    battle.enemyLevels = new Array(numEnemies).fill(null).map(() => globalScene.currentBattle.getLevelForWave());
  }

  globalScene.getEnemyParty().forEach(enemyPokemon => {
    enemyPokemon.leaveField(true, true, true);
  });
  battle.enemyParty = [];
  // `Battle.double` is a read-only derived view of the format arrangement; write the battle mode
  // through the supported `setDouble` API (rebuilds the arrangement) instead of assigning the getter.
  battle.setDouble(doubleBattle);

  // ME levels are modified by an additive value that scales with wave index
  // Base scaling: Every 10 waves, modifier gets +1 level
  // This can be amplified or counteracted by setting levelAdditiveModifier in config
  // levelAdditiveModifier value of 0.5 will halve the modifier scaling, 2 will double it, etc.
  // Leaving null/undefined will disable level scaling
  const mult = partyConfig.levelAdditiveModifier ?? 0;
  const additive = Math.max(Math.round((globalScene.currentBattle.waveIndex / 10) * mult), 0);
  battle.enemyLevels = battle.enemyLevels.map(level => level + additive);

  battle.enemyLevels.forEach((level, e) => {
    let enemySpecies: PokemonSpecies | undefined;
    let dataSource: PokemonData | undefined;
    let isBoss = false;
    if (!loaded) {
      if ((trainerType != null || trainerConfig) && battle.trainer) {
        // Allows overriding a trainer's pokemon to use specific species/data
        if (partyConfig?.pokemonConfigs && e < partyConfig.pokemonConfigs.length) {
          const config = partyConfig.pokemonConfigs[e];
          level = config.level ? config.level : level;
          dataSource = config.dataSource;
          enemySpecies = config.species;
          isBoss = config.isBoss;
          battle.enemyParty[e] = globalScene.addEnemyPokemon(
            enemySpecies,
            level,
            TrainerSlot.TRAINER,
            isBoss,
            false,
            dataSource,
          );
        } else {
          battle.enemyParty[e] = battle.trainer.genPartyMember(e);
        }
      } else {
        if (partyConfig?.pokemonConfigs && e < partyConfig.pokemonConfigs.length) {
          const config = partyConfig.pokemonConfigs[e];
          level = config.level ? config.level : level;
          dataSource = config.dataSource;
          enemySpecies = config.species;
          isBoss = config.isBoss;
          if (isBoss) {
            globalScene.currentBattle.mysteryEncounter!.encounterMode = MysteryEncounterMode.BOSS_BATTLE;
          }
        } else {
          enemySpecies = globalScene.randomSpecies(battle.waveIndex, level, true);
        }

        battle.enemyParty[e] = globalScene.addEnemyPokemon(
          enemySpecies,
          level,
          TrainerSlot.NONE,
          isBoss,
          false,
          dataSource,
        );
      }
    }

    const enemyPokemon = globalScene.getEnemyParty()[e];

    // Make sure basic data is clean
    enemyPokemon.hp = enemyPokemon.getMaxHp();
    enemyPokemon.status = null;
    enemyPokemon.passive = false;

    if (e < (doubleBattle ? 2 : 1)) {
      enemyPokemon.setX(-66 + enemyPokemon.getFieldPositionOffset()[0]);
      enemyPokemon.resetSummonData();
    }

    if ((!loaded && partyConfig.countAsSeen == null) || partyConfig.countAsSeen) {
      globalScene.gameData.setPokemonSeen(enemyPokemon, true, !!(trainerType || trainerConfig));
    }

    if (partyConfig?.pokemonConfigs && e < partyConfig.pokemonConfigs.length) {
      const config = partyConfig.pokemonConfigs[e];

      // Set form
      if (config.nickname != null) {
        enemyPokemon.nickname = btoa(unescape(encodeURIComponent(config.nickname)));
      }

      // Generate new id, reset status and HP in case using data source
      if (config.dataSource) {
        enemyPokemon.id = randSeedInt(4294967296);
      }

      // Set form
      if (config.formIndex != null) {
        enemyPokemon.formIndex = config.formIndex;
      }

      // Set shiny
      if (config.shiny != null) {
        enemyPokemon.shiny = config.shiny;
      }

      // Set Variant
      if (enemyPokemon.shiny && config.variant != null) {
        enemyPokemon.variant = config.variant;
      }

      // Set custom mystery encounter data fields (such as sprite scale, custom abilities, types, etc.)
      if (config.customPokemonData != null) {
        enemyPokemon.customPokemonData = config.customPokemonData;
      }

      // Set Boss
      if (config.isBoss) {
        let segments =
          config.bossSegments
          ?? globalScene.getEncounterBossSegments(globalScene.currentBattle.waveIndex, level, enemySpecies, true);
        if (config.bossSegmentModifier != null) {
          segments += config.bossSegmentModifier;
        }
        enemyPokemon.setBoss(true, segments);
      }

      // Set Passive
      if (config.passive) {
        enemyPokemon.passive = true;
      }

      // Set Nature
      if (config.nature) {
        enemyPokemon.nature = config.nature;
      }

      // Set IVs
      if (config.ivs) {
        enemyPokemon.ivs = config.ivs;
      }

      // Set Status
      const statusEffects = config.status;
      if (statusEffects) {
        // Default to cureturn 3 for sleep
        const status = Array.isArray(statusEffects) ? statusEffects[0] : statusEffects;
        const cureTurn = Array.isArray(statusEffects)
          ? statusEffects[1]
          : statusEffects === StatusEffect.SLEEP
            ? 3
            : undefined;
        enemyPokemon.status = new Status(status, 0, cureTurn);
      }

      // Set ability
      if (config.abilityIndex != null) {
        enemyPokemon.abilityIndex = config.abilityIndex;
      }

      // Set gender
      if (config.gender != null) {
        enemyPokemon.gender = config.gender!;
        enemyPokemon.summonData.gender = config.gender;
      }

      // Set AI type
      if (config.aiType != null) {
        enemyPokemon.aiType = config.aiType;
      }

      // Set friendship
      if (config.friendship != null) {
        enemyPokemon.friendship = config.friendship;
      }

      // Set moves
      if (config?.moveSet && config.moveSet.length > 0) {
        const moves = config.moveSet.map(m => new PokemonMove(m));
        enemyPokemon.moveset = moves;
        enemyPokemon.summonData.moveset = moves;
      }

      // Set tags
      if (config.tags && config.tags.length > 0) {
        const tags = config.tags;
        tags.forEach(tag => enemyPokemon.addTag(tag));
      }

      // Set tera
      if (config.tera && config.tera !== PokemonType.UNKNOWN) {
        enemyPokemon.teraType = config.tera;
        if (battle.trainer) {
          battle.trainer.config.setInstantTera(e);
        }
      }

      // mysteryEncounterBattleEffects will only be used if MYSTERY_ENCOUNTER_POST_SUMMON tag is applied
      if (config.mysteryEncounterBattleEffects) {
        enemyPokemon.mysteryEncounterBattleEffects = config.mysteryEncounterBattleEffects;
      }

      if (enemyPokemon.isShiny() && !enemyPokemon["shinySparkle"]) {
        enemyPokemon.initShinySparkle();
      }
      enemyPokemon.initBattleInfo();
      enemyPokemon.getBattleInfo().initInfo(enemyPokemon);
      enemyPokemon.generateName();
    }

    loadEnemyAssets.push(enemyPokemon.loadAssets());

    const stats: string[] = [
      `HP: ${enemyPokemon.stats[0]} (${enemyPokemon.ivs[0]})`,
      ` Atk: ${enemyPokemon.stats[1]} (${enemyPokemon.ivs[1]})`,
      ` Def: ${enemyPokemon.stats[2]} (${enemyPokemon.ivs[2]})`,
      ` Spatk: ${enemyPokemon.stats[3]} (${enemyPokemon.ivs[3]})`,
      ` Spdef: ${enemyPokemon.stats[4]} (${enemyPokemon.ivs[4]})`,
      ` Spd: ${enemyPokemon.stats[5]} (${enemyPokemon.ivs[5]})`,
    ];
    const moveset: string[] = [];
    enemyPokemon.getMoveset().forEach(move => {
      moveset.push(move!.getName()); // TODO: remove `!` after moveset-null removal PR
    });

    console.log(
      `Pokemon: ${getPokemonNameWithAffix(enemyPokemon)}`,
      `| Species ID: ${enemyPokemon.species.speciesId}`,
      `| Level: ${enemyPokemon.level}`,
      `| Nature: ${getNatureName(enemyPokemon.nature, true, true, true)}`,
      `| Friendship: ${enemyPokemon.friendship}`,
    );
    console.log(`Stats (IVs): ${stats}`);
    console.log(
      `Ability: ${enemyPokemon.getAbility().name}`,
      `| Passive Ability${enemyPokemon.hasPassive() ? "" : " (inactive)"}: ${enemyPokemon.getPassiveAbility().name}`,
      `${enemyPokemon.isBoss() ? `| Boss Bars: ${enemyPokemon.bossSegments}` : ""}`,
    );
    console.log("Moveset:", moveset);
  });

  // Co-op AUTHORITATIVE ME battle handoff (#633): the ME interaction is owner-alternated but the
  // SPAWNED battle must be HOST-AUTHORITATIVE. The HOST streams the boss party it just generated
  // (keyed by the ME interaction) + the OWNER tells the watcher's pump to end without leaving the
  // encounter; the GUEST discards its own locally-rolled party and adopts the host's verbatim, so
  // the boss is identical on both clients. Hard no-op in solo / lockstep / non-coop. Done BEFORE the
  // battle phase is pushed so the adopted mons' assets load below.
  // Co-op (#818) safety net: if the forced double still yielded ONE enemy (e.g. a 1-mon
  // trainer template that genPartyMember could not extend), degrade back to the classic
  // single shape - a playable 1v1 beats the #385-class 2v1 freeze. Streamed AFTER, so the
  // guest adopts whatever shape actually stands.
  if (globalScene.gameMode?.isCoop === true && battle.double && battle.enemyParty.length < 2) {
    console.warn(`[er-coop] ME battle: forced double degraded to single (party=${battle.enemyParty.length})`);
    battle.setDouble(false);
  }
  coopHostStreamMeBattleParty();
  if (
    !(await coopMeOwnerRelayBattleHandoff({
      encounterMode: battle.mysteryEncounter?.encounterMode,
      disableSwitch: partyConfig.disableSwitch ?? false,
    }))
  ) {
    return;
  }
  if (coopGuestShouldAdoptMeBattleParty()) {
    await adoptCoopMeBattleParty(battle, loadEnemyAssets);
  }

  globalScene.phaseManager.pushNew("MysteryEncounterBattlePhase", partyConfig.disableSwitch);

  await Promise.all(loadEnemyAssets);
  battle.enemyParty.forEach((enemyPokemon_2, e_1) => {
    if (e_1 < (doubleBattle ? 2 : 1)) {
      enemyPokemon_2.setVisible(false);
      if (battle.double) {
        enemyPokemon_2.setFieldPosition(e_1 ? FieldPosition.RIGHT : FieldPosition.LEFT);
      }
      // Spawns at current visible field instead of on "next encounter" field (off screen to the left)
      enemyPokemon_2.x += 300;
    }
  });
  if (!loaded) {
    regenerateModifierPoolThresholds(
      globalScene.getEnemyField(),
      battle.battleType === BattleType.TRAINER ? ModifierPoolType.TRAINER : ModifierPoolType.WILD,
    );
    const customModifierTypes = partyConfig?.pokemonConfigs
      ?.filter(config => config?.modifierConfigs)
      .map(config => config.modifierConfigs!);
    globalScene.generateEnemyModifiers(customModifierTypes);
  }
}

/**
 * Co-op AUTHORITATIVE GUEST (#633 ME battle handoff): await the host's authoritative ME-spawned-
 * battle party and REBUILD `battle.enemyParty` from it, replacing the guest's locally-rolled mons
 * so both clients fight the host's exact boss. Mirrors {@linkcode buildCoopEnemy}'s adopt path
 * (used at wave start) but keyed by the ME interaction since the battle spawns mid-wave. Fully
 * guarded: transport loss is replayed by key; a missing or malformed authority payload aborts this
 * transition instead of retaining locally generated enemies. Pushes adopted asset loads to the caller.
 */
async function adoptCoopMeBattleParty(battle: Battle, loadEnemyAssets: Promise<void>[]): Promise<void> {
  const enemies = await coopGuestAwaitMeBattleParty();
  if (enemies == null || enemies.length === 0) {
    throw new Error("Authoritative co-op mystery battle party was empty");
  }
  const trainerSlot = battle.battleType === BattleType.TRAINER ? TrainerSlot.TRAINER : TrainerSlot.NONE;
  const rebuilt: EnemyPokemon[] = [];
  for (const entry of enemies) {
    const fallbackLevel = battle.enemyParty[entry.fieldIndex]?.level ?? battle.enemyLevels?.[entry.fieldIndex] ?? 1;
    let built: EnemyPokemon | null = null;
    try {
      built = buildCoopEnemy(entry.data, fallbackLevel, trainerSlot);
    } catch {
      built = null;
    }
    if (built != null) {
      rebuilt[entry.fieldIndex] = built;
    }
  }
  if (rebuilt[0] == null || rebuilt.filter(Boolean).length !== enemies.length) {
    throw new Error("Authoritative co-op mystery battle party could not be reconstructed completely");
  }
  // Tear the locally-rolled mons off the field, then install the host's verbatim.
  for (const local of battle.enemyParty) {
    if (local != null && !rebuilt.includes(local)) {
      try {
        local.leaveField(true, true, true);
      } catch {
        /* a stray local mon failing to leave must not abort the adopt */
      }
    }
  }
  battle.enemyParty = rebuilt.filter((m): m is EnemyPokemon => m != null);
  // Replace the stale local load promises with the adopted mons' (the caller awaits these).
  loadEnemyAssets.length = 0;
  for (const enemy of battle.enemyParty) {
    enemy.hp = enemy.getMaxHp();
    enemy.status = null;
    loadEnemyAssets.push(enemy.loadAssets());
  }
}

/**
 * Load special move animations/sfx for hard-coded encounter-specific moves that a pokemon uses at the start of an encounter
 * @see {@linkcode MysteryEncounter.startOfBattleEffects}
 * @remarks
 * This promise does not need to be awaited if called in an encounter's `onInit` (will just load lazily)
 * @param moves
 */
export async function loadCustomMovesForEncounter(moves: MoveId | MoveId[]): Promise<void> {
  const movesArray: MoveId[] = coerceArray(moves);
  return Promise.all(movesArray.map((move: MoveId) => initMoveAnim(move))).then(() => loadMoveAnimAssets(movesArray));
}

/**
 * @param moneyAmount - The amount of money being added; negative values remove money
 * @param playSound - (Default `true`) Whether to play a sound afterward
 * @param showMessage - (Default `true`) Whether to show a message afterward
 */
export function updatePlayerMoney(moneyAmount: number, playSound = true, showMessage = true): void {
  globalScene.money = Phaser.Math.Clamp(globalScene.money + moneyAmount, 0, Number.MAX_SAFE_INTEGER);
  globalScene.updateMoneyText();
  const isIncrease = moneyAmount >= 0;
  globalScene.animateMoneyChanged(isIncrease);

  if (playSound) {
    globalScene.playSound("se/buy");
  }

  if (showMessage) {
    const i18nKey = isIncrease ? "receive" : "paid";
    const amount = isIncrease ? moneyAmount : -moneyAmount;
    globalScene.phaseManager.queueMessage(
      i18next.t(`mysteryEncounterMessages:${i18nKey}Money`, { amount }),
      null,
      true,
    );
  }
}

/**
 * Converts modifier bullshit to an actual item
 * @param modifier
 * @param pregenArgs Can specify BerryType for berries, TM for TMs, AttackBoostType for item, etc.
 */
export function generateModifierType(modifier: () => ModifierType, pregenArgs?: any[]): ModifierType | null {
  const modifierId = Object.keys(modifierTypes).find(k => modifierTypes[k] === modifier);
  if (!modifierId) {
    return null;
  }

  let result: ModifierType = modifierTypes[modifierId]();

  // Populates item id and tier (order matters)
  result = result
    .withIdFromFunc(modifierTypes[modifierId])
    .withTierFromPool(ModifierPoolType.PLAYER, globalScene.getPlayerParty());

  return result instanceof ModifierTypeGenerator
    ? result.generateType(globalScene.getPlayerParty(), pregenArgs)
    : result;
}

/**
 * Converts modifier bullshit to an actual item
 * @param modifier
 * @param pregenArgs - can specify BerryType for berries, TM for TMs, AttackBoostType for item, etc.
 */
export function generateModifierTypeOption(
  modifier: () => ModifierType,
  pregenArgs?: any[],
): ModifierTypeOption | null {
  const result = generateModifierType(modifier, pregenArgs);
  if (result) {
    return new ModifierTypeOption(result, 0);
  }
  return result;
}

/**
 * This function is intended for use inside onPreOptionPhase() of an encounter option
 * @param onPokemonSelected - Any logic that needs to be performed when Pokemon is chosen
 * If a second option needs to be selected, onPokemonSelected should return a OptionSelectItem[] object
 * @param onPokemonNotSelected - Any logic that needs to be performed if no Pokemon is chosen
 * @param selectablePokemonFilter
 */
export function selectPokemonForOption(
  // biome-ignore lint/suspicious/noConfusingVoidType: Takes a function that either returns void or an array of OptionSelectItem
  onPokemonSelected: (pokemon: PlayerPokemon) => void | OptionSelectItem[],
  onPokemonNotSelected?: () => void,
  selectablePokemonFilter?: PokemonSelectFilter,
): Promise<boolean> {
  return new Promise(resolve => {
    const modeToSetOnExit = globalScene.ui.getMode();
    const boundScene = globalScene;
    const boundRuntime = getCoopRuntime();
    const boundController = getCoopController();
    const boundGeneration = coopSessionGeneration();
    const boundPin = coopMeInteractionStartValue();
    const coopFence =
      coopMeInProgress() && boundRuntime != null && boundController != null
        ? () =>
            globalScene === boundScene
            && getCoopRuntime() === boundRuntime
            && getCoopController() === boundController
            && coopSessionGeneration() === boundGeneration
            && coopMeInteractionStartValue() === boundPin
        : undefined;
    const setMode = (mode: UiMode, ...args: unknown[]) =>
      coopFence == null
        ? globalScene.ui.setMode(mode, ...args)
        : globalScene.ui.setModeBoundedWhen(mode, 2_000, coopFence, ...args);

    // Co-op AUTHORITATIVE host on a GUEST-OWNED ME (#633, ADD-2b): the host runs the sole engine, so
    // the party target + any secondary index come from the GUEST's relayed picks, NOT a local host
    // party screen. Stream the `subPrompt` descriptor (which capture screen the guest opens) and
    // await each pick on `seq_me` (FIFO). Each await null-ends to the not-selected / default branch
    // (disconnect ceiling only - steady state resolves on the human pick), so the host never hangs.
    if (coopHostAwaitsGuestSubPick()) {
      const seqMe = COOP_ME_PUMP_SEQ_BASE + coopMeInteractionStartValue();
      const relay = getCoopInteractionRelay();
      const partyPrompt: CoopInteractionOutcome = {
        k: "mePresent",
        tokens: {},
        meetsReqs: [],
        labels: [],
        subPrompt: { kind: "party" },
      };
      coopLog("me", "host streams PARTY sub-prompt + awaits guest slot", { seq: seqMe });
      if (relay == null || !commitAndPublishMePresentation(relay, seqMe, partyPrompt)) {
        failCoopSharedSession(`Mystery party presentation ${seqMe} unavailable`);
        return;
      }
      const boundary = captureCoopMeWaitBoundary();
      void awaitCommittedGuestMeSubPick(relay, seqMe, boundary, "Mystery party choice").then(async slotIndex => {
        if (slotIndex == null || !coopMeWaitBoundaryLive(boundary)) {
          return;
        }
        coopLog("me", "host received guest party sub-pick", {
          seq: seqMe,
          slotIndex,
          fromNull: false,
        });
        if (slotIndex >= globalScene.getPlayerParty().length) {
          coopWarn("me", "host: party sub-pick out of range; not-selected branch", {
            seq: seqMe,
            slotIndex,
            partySize: globalScene.getPlayerParty().length,
          });
          onPokemonNotSelected?.();
          resolve(false);
          return;
        }
        const pokemon = globalScene.getPlayerParty()[slotIndex];
        const secondaryOptions = onPokemonSelected(pokemon);
        if (!secondaryOptions) {
          coopLog("me", "host applied guest party pick (no secondary)", { seq: seqMe, slotIndex });
          globalScene.currentBattle.mysteryEncounter!.setDialogueToken("selectedPokemon", pokemon.getNameToRender());
          resolve(true);
          return;
        }
        // Secondary menu: stream its labels, then await the guest's secondary index (another P1b).
        const secondaryPrompt: CoopInteractionOutcome = {
          k: "mePresent",
          tokens: {},
          meetsReqs: [],
          labels: [],
          subPrompt: { kind: "secondary", labels: secondaryOptions.map(o => o.label) },
        };
        coopLog("me", "host streams SECONDARY sub-prompt + awaits guest index", {
          seq: seqMe,
          slotIndex,
          labels: secondaryOptions.length,
        });
        if (!commitAndPublishMePresentation(relay, seqMe, secondaryPrompt)) {
          return;
        }
        void awaitCommittedGuestMeSubPick(relay, seqMe, boundary, "Mystery secondary choice").then(idx => {
          if (idx == null || !coopMeWaitBoundaryLive(boundary)) {
            return;
          }
          globalScene.currentBattle.mysteryEncounter!.setDialogueToken("selectedPokemon", pokemon.getNameToRender());
          coopLog("me", "host received guest secondary sub-pick", {
            seq: seqMe,
            idx,
            applied: idx >= 0 && idx < secondaryOptions.length,
          });
          if (idx >= 0 && idx < secondaryOptions.length) {
            secondaryOptions[idx].handler();
          }
          resolve(true);
        });
      });
      return; // do NOT open the local host UiMode.PARTY
    }

    // Open party screen to choose pokemon
    setMode(
      UiMode.PARTY,
      PartyUiMode.SELECT,
      -1,
      async (slotIndex: number, _option: PartyOption) => {
        if (coopFence != null && !coopFence()) {
          return;
        }
        await setMode(modeToSetOnExit);
        if (coopFence != null && !coopFence()) {
          return;
        }
        if (slotIndex >= globalScene.getPlayerParty().length) {
          onPokemonNotSelected?.();
          resolve(false);
          return;
        }

        const pokemon = globalScene.getPlayerParty()[slotIndex];
        const secondaryOptions = onPokemonSelected(pokemon);
        if (!secondaryOptions) {
          globalScene.currentBattle.mysteryEncounter!.setDialogueToken("selectedPokemon", pokemon.getNameToRender());
          resolve(true);
          return;
        }

        // There is a second option to choose after selecting the Pokemon
        await setMode(UiMode.MESSAGE);
        if (coopFence != null && !coopFence()) {
          return;
        }
        // TODO: fix this
        const displayOptions = () => {
          // Always appends a cancel option to bottom of options
          const fullOptions = secondaryOptions
            .map(option => {
              // Update handler to resolve promise
              const onSelect = option.handler;
              option.handler = () => {
                if (coopFence != null && !coopFence()) {
                  return false;
                }
                onSelect();
                globalScene.currentBattle.mysteryEncounter!.setDialogueToken(
                  "selectedPokemon",
                  pokemon.getNameToRender(),
                );
                resolve(true);
                return true;
              };
              return option;
            })
            .concat({
              label: i18next.t("menu:cancel"),
              handler: () => {
                if (coopFence != null && !coopFence()) {
                  return false;
                }
                globalScene.ui.clearText();
                setMode(modeToSetOnExit);
                resolve(false);
                return true;
              },
              onHover: () => {
                showEncounterText(i18next.t("mysteryEncounterMessages:cancelOption"), 0, 0, false);
              },
            });

          const config: OptionSelectConfig = {
            options: fullOptions,
            maxOptions: 7,
            yOffset: 0,
            supportHover: true,
          };

          // Do hover over the starting selection option
          if (fullOptions[0]?.onHover) {
            fullOptions[0].onHover();
          }
          if (coopFence == null) {
            globalScene.ui.setModeWithoutClear(UiMode.OPTION_SELECT, config, null, true);
          } else {
            globalScene.ui.setModeBoundedWhen(UiMode.OPTION_SELECT, 2_000, coopFence, config, null, true);
          }
        };

        const textPromptKey = globalScene.currentBattle.mysteryEncounter?.selectedOption?.dialogue?.secondOptionPrompt;
        if (textPromptKey) {
          await showEncounterText(textPromptKey);
        }
        displayOptions();
      },
      selectablePokemonFilter,
    );
  });
}

interface PokemonAndOptionSelected {
  selectedPokemonIndex: number;
  selectedOptionIndex: number;
}

/**
 * This function is intended for use inside `onPreOptionPhase()` of an encounter option
 *
 * If a second option needs to be selected, `onPokemonSelected` should return a {@linkcode OptionSelectItem}`[]` object
 * @param options
 * @param optionSelectPromptKey
 * @param selectablePokemonFilter
 * @param onHoverOverCancelOption
 */
export function selectOptionThenPokemon(
  options: OptionSelectItem[],
  optionSelectPromptKey: string,
  selectablePokemonFilter?: PokemonSelectFilter,
  onHoverOverCancelOption?: () => void,
): Promise<PokemonAndOptionSelected | null> {
  return new Promise<PokemonAndOptionSelected | null>(resolve => {
    const modeToSetOnExit = globalScene.ui.getMode();
    const boundScene = globalScene;
    const boundRuntime = getCoopRuntime();
    const boundController = getCoopController();
    const boundGeneration = coopSessionGeneration();
    const boundPin = coopMeInteractionStartValue();
    const coopFence =
      coopMeInProgress() && boundRuntime != null && boundController != null
        ? () =>
            globalScene === boundScene
            && getCoopRuntime() === boundRuntime
            && getCoopController() === boundController
            && coopSessionGeneration() === boundGeneration
            && coopMeInteractionStartValue() === boundPin
        : undefined;
    const setMode = (mode: UiMode, ...args: unknown[]) =>
      coopFence == null
        ? globalScene.ui.setMode(mode, ...args)
        : globalScene.ui.setModeBoundedWhen(mode, 2_000, coopFence, ...args);

    const displayOptions = async (config: OptionSelectConfig) => {
      await setMode(UiMode.MESSAGE);
      if (coopFence != null && !coopFence()) {
        return;
      }
      if (optionSelectPromptKey) {
        showEncounterText(optionSelectPromptKey);
      }
      // Do hover over the starting selection option
      if (fullOptions[0]?.onHover) {
        fullOptions[0].onHover();
      }
      setMode(UiMode.OPTION_SELECT, config);
    };

    const selectPokemonAfterOption = (selectedOptionIndex: number) => {
      // Open party screen to choose a Pokemon
      setMode(
        UiMode.PARTY,
        PartyUiMode.SELECT,
        -1,
        (slotIndex: number, _option: PartyOption) => {
          if (coopFence != null && !coopFence()) {
            return;
          }
          if (slotIndex < globalScene.getPlayerParty().length) {
            // Pokemon and option selected
            setMode(modeToSetOnExit).then(() => {
              if (coopFence != null && !coopFence()) {
                return;
              }
              const result: PokemonAndOptionSelected = {
                selectedPokemonIndex: slotIndex,
                selectedOptionIndex,
              };
              resolve(result);
            });
          } else {
            // Back to first option select screen
            displayOptions(config);
          }
        },
        selectablePokemonFilter,
      );
    };

    // Always appends a cancel option to bottom of options
    const fullOptions = options
      .map((option, index) => {
        // Update handler to resolve promise
        const onSelect = option.handler;
        option.handler = () => {
          if (coopFence != null && !coopFence()) {
            return false;
          }
          onSelect();
          selectPokemonAfterOption(index);
          return true;
        };
        return option;
      })
      .concat({
        label: i18next.t("menu:cancel"),
        handler: () => {
          if (coopFence != null && !coopFence()) {
            return false;
          }
          globalScene.ui.clearText();
          setMode(modeToSetOnExit);
          resolve(null);
          return true;
        },
        onHover: () => {
          if (onHoverOverCancelOption) {
            onHoverOverCancelOption();
          }
          showEncounterText(i18next.t("mysteryEncounterMessages:cancelOption"), 0, 0, false);
        },
      });

    const config: OptionSelectConfig = {
      options: fullOptions,
      maxOptions: 7,
      yOffset: 0,
      supportHover: true,
    };

    displayOptions(config);
  });
}

/**
 * Will initialize reward phases to follow the mystery encounter
 * Can have shop displayed or skipped
 * @param customShopRewards - adds a shop phase with the specified rewards / reward tiers
 * @param eggRewards
 * @param preRewardsCallback - can execute an arbitrary callback before the new phases if necessary (useful for updating items/party/injecting new phases before {@linkcode MysteryEncounterRewardsPhase})
 */
export function setEncounterRewards(
  customShopRewards?: CustomModifierSettings,
  eggRewards?: IEggOptions[],
  preRewardsCallback?: () => void,
): void {
  globalScene.currentBattle.mysteryEncounter!.doEncounterRewards = () => {
    if (preRewardsCallback) {
      preRewardsCallback();
    }

    if (customShopRewards) {
      globalScene.phaseManager.unshiftNew("SelectModifierPhase", 0, undefined, customShopRewards);
    } else {
      globalScene.phaseManager.removeAllPhasesOfType("MysteryEncounterRewardsPhase");
    }

    if (eggRewards) {
      eggRewards.forEach(eggOptions => {
        const egg = new Egg(eggOptions);
        egg.addEggToGameData();
      });
    }

    return true;
  };
}

/**
 * Will initialize exp phases into the phase queue (these are in addition to any combat or other exp earned)
 * Exp Share and Exp Balance will still function as normal
 * @param participantId - id/s of party pokemon that get full exp value. Other party members will receive Exp Share amounts
 * @param baseExpValue - gives exp equivalent to a pokemon of the wave index's level.
 *
 * Guidelines:
 * ```md
 * 36 - Sunkern (lowest in game)
 * 62-64 - regional starter base evos
 * 100 - Scyther
 * 170 - Spiritomb
 * 250 - Gengar
 * 290 - trio legendaries
 * 340 - box legendaries
 * 608 - Blissey (highest in game)
 * ```
 * https://bulbapedia.bulbagarden.net/wiki/List_of_Pok%C3%A9mon_by_effort_value_yield_(Generation_IX)
 * @param useWaveIndex - set to false when directly passing the the full exp value instead of baseExpValue
 */
export function setEncounterExp(participantId: number | number[], baseExpValue: number, useWaveIndex = true) {
  const participantIds = coerceArray(participantId);

  globalScene.currentBattle.mysteryEncounter!.doEncounterExp = () => {
    globalScene.phaseManager.unshiftNew("PartyExpPhase", baseExpValue, useWaveIndex, new Set(participantIds));

    return true;
  };
}

export class OptionSelectSettings {
  hideDescription?: boolean;
  slideInDescription?: boolean;
  overrideTitle?: string;
  overrideDescription?: string;
  overrideQuery?: string;
  overrideOptions?: MysteryEncounterOption[];
  startingCursorIndex?: number;
}

/**
 * Can be used to queue a new series of Options to select for an Encounter
 * MUST be used only in onOptionPhase, will not work in onPreOptionPhase or onPostOptionPhase
 * @param optionSelectSettings
 */
export function initSubsequentOptionSelect(optionSelectSettings: OptionSelectSettings): void {
  globalScene.phaseManager.pushNew("MysteryEncounterPhase", optionSelectSettings);
}

/**
 * Can be used to exit an encounter without any battles or followup
 * Will skip any shops and rewards, and queue the next encounter phase as normal
 * @param addHealPhase - when true, will add a shop phase to end of encounter with 0 rewards but healing items are available
 * @param encounterMode - Can set custom encounter mode if necessary (may be required for forcing Pokemon to return before next phase)
 */
export function leaveEncounterWithoutBattle(
  addHealPhase = false,
  encounterMode: MysteryEncounterMode = MysteryEncounterMode.NO_BATTLE,
): void {
  globalScene.currentBattle.mysteryEncounter!.encounterMode = encounterMode;
  globalScene.phaseManager.clearPhaseQueue(true);
  handleMysteryEncounterVictory(addHealPhase);
}

/**
 *
 * @param addHealPhase - Adds an empty shop phase to allow player to purchase healing items
 * @param doNotContinue - default `false`. If set to true, will not end the battle and continue to next wave
 */
export function handleMysteryEncounterVictory(addHealPhase = false, doNotContinue = false): void {
  const allowedPkm = globalScene.getPlayerParty().filter(pkm => pkm.isAllowedInBattle());

  if (allowedPkm.length === 0) {
    globalScene.phaseManager.clearPhaseQueue(true);
    globalScene.phaseManager.unshiftNew("GameOverPhase");
    return;
  }

  // If in repeated encounter variant, do nothing
  // Variant must eventually be swapped in order to handle "true" end of the encounter
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (encounter.continuousEncounter || doNotContinue) {
    return;
  }
  if (encounter.encounterMode === MysteryEncounterMode.NO_BATTLE) {
    globalScene.phaseManager.pushNew("MysteryEncounterRewardsPhase", addHealPhase);
    globalScene.phaseManager.pushNew("EggLapsePhase");
  } else if (
    !globalScene
      .getEnemyParty()
      .find(p =>
        encounter.encounterMode === MysteryEncounterMode.TRAINER_BATTLE ? !p?.isFainted(true) : p.isOnField(),
      )
  ) {
    const queueRewards =
      globalScene.gameMode.isEndless || !globalScene.gameMode.isWaveFinal(globalScene.currentBattle.waveIndex);
    const trainerVictory = encounter.encounterMode === MysteryEncounterMode.TRAINER_BATTLE;
    const continuation = encounter.doContinueEncounter ? "encounter" : queueRewards ? "rewards" : "none";
    if (globalScene.gameMode.isCoop && continuation === "none") {
      failCoopSharedSession("A final-wave Mystery battle has no retained GameOver continuation in protocol 34.");
      return;
    }
    globalScene.phaseManager.pushNew("BattleEndPhase", true, null, {
      result: "victory",
      continuation,
      trainerVictory,
      addHeal: continuation === "rewards" && addHealPhase,
      eggLapse: continuation === "rewards",
    });
    // The retained battle-settled terminal constructs every following guest phase only after its complete
    // post-BattleEnd DATA image applies. Never pre-queue a locally-derived reward tail on the renderer.
    if (isCoopAuthoritativeGuest()) {
      return;
    }
    if (trainerVictory) {
      globalScene.phaseManager.pushNew("TrainerVictoryPhase");
    }
    if (queueRewards) {
      globalScene.phaseManager.pushNew("MysteryEncounterRewardsPhase", addHealPhase);
      if (!encounter.doContinueEncounter) {
        // Only lapse eggs once for multi-battle encounters
        globalScene.phaseManager.pushNew("EggLapsePhase");
      }
    }
  }
}

/**
 * Similar to {@linkcode handleMysteryEncounterVictory}, but for cases where the player lost a battle or failed a challenge
 * @param addHealPhase
 */
export function handleMysteryEncounterBattleFailed(addHealPhase = false, doNotContinue = false): void {
  const allowedPkm = globalScene.getPlayerParty().filter(pkm => pkm.isAllowedInBattle());

  if (allowedPkm.length === 0) {
    globalScene.phaseManager.clearPhaseQueue(true);
    globalScene.phaseManager.unshiftNew("GameOverPhase");
    return;
  }

  // If in repeated encounter variant, do nothing
  // Variant must eventually be swapped in order to handle "true" end of the encounter
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (encounter.continuousEncounter || doNotContinue) {
    return;
  }
  if (encounter.encounterMode !== MysteryEncounterMode.NO_BATTLE) {
    const continuation = encounter.doContinueEncounter ? "encounter" : "rewards";
    globalScene.phaseManager.pushNew("BattleEndPhase", false, null, {
      result: "failure",
      continuation,
      trainerVictory: false,
      addHeal: continuation === "rewards" && addHealPhase,
      eggLapse: continuation === "rewards",
    });
    if (isCoopAuthoritativeGuest()) {
      return;
    }
  }

  globalScene.phaseManager.pushNew("MysteryEncounterRewardsPhase", addHealPhase);

  if (!encounter.doContinueEncounter) {
    // Only lapse eggs once for multi-battle encounters
    globalScene.phaseManager.pushNew("EggLapsePhase");
  }
}

/**
 *
 * @param hide - If true, performs ease out and hide visuals. If false, eases in visuals. Defaults to true
 * @param destroy - If true, will destroy visuals ONLY ON HIDE TRANSITION. Does nothing on show. Defaults to true
 * @param duration
 */
export function transitionMysteryEncounterIntroVisuals(hide = true, destroy = true, duration = 750): Promise<boolean> {
  return new Promise(resolve => {
    const introVisuals = globalScene.currentBattle.mysteryEncounter!.introVisuals;
    const enemyPokemon = globalScene.getEnemyField();
    if (enemyPokemon) {
      globalScene.currentBattle.enemyParty = [];
    }
    if (introVisuals) {
      if (!hide) {
        // Make sure visuals are in proper state for showing
        introVisuals.setVisible(true);
        introVisuals.x = 244;
        introVisuals.y = 60;
        introVisuals.alpha = 0;
      }

      // Transition
      globalScene.tweens.add({
        targets: [introVisuals, enemyPokemon],
        x: `${hide ? "+" : "-"}=16`,
        y: `${hide ? "-" : "+"}=16`,
        alpha: hide ? 0 : 1,
        ease: "Sine.easeInOut",
        duration,
        onComplete: () => {
          if (hide && destroy) {
            globalScene.field.remove(introVisuals, true);

            enemyPokemon.forEach(pokemon => {
              pokemon.leaveField(true, true, true);
            });

            // #863(b): the co-op #862 phantom-ME drop fires this teardown then nulls
            // currentBattle.mysteryEncounter synchronously, so this tween's onComplete can run after the
            // encounter is gone. Guard the deref (the normal leave path always has it present -> no-op there).
            if (globalScene.currentBattle?.mysteryEncounter) {
              globalScene.currentBattle.mysteryEncounter.introVisuals = undefined;
            }
          }
          resolve(true);
        },
      });
    } else {
      resolve(true);
    }
  });
}

/**
 * Will queue moves for any pokemon to use before the first CommandPhase of a battle
 * Mostly useful for allowing {@linkcode MysteryEncounter} enemies to "cheat" and use moves before the first turn
 */
export function handleMysteryEncounterBattleStartEffects(): void {
  const encounter = globalScene.currentBattle.mysteryEncounter;
  if (
    globalScene.currentBattle.isBattleMysteryEncounter()
    && encounter
    && encounter.encounterMode !== MysteryEncounterMode.NO_BATTLE
    && !encounter.startOfBattleEffectsComplete
  ) {
    const effects = encounter.startOfBattleEffects;
    effects.forEach(effect => {
      const source = effect.sourcePokemon ?? globalScene.getField()[effect.sourceBattlerIndex ?? 0];
      globalScene.phaseManager.pushNew("MovePhase", source, effect.targets, effect.move, effect.useMode);
    });

    // Pseudo turn end phase to reset flinch states, Endure, etc.
    globalScene.phaseManager.pushNew("MysteryEncounterBattleStartCleanupPhase");

    encounter.startOfBattleEffectsComplete = true;
  }
}

/**
 * Can queue extra phases or logic during {@linkcode TurnInitPhase}
 * Should mostly just be used for injecting custom phases into the battle system on turn start
 * @returns boolean - if true, will skip the remainder of the {@linkcode TurnInitPhase}
 */
export function handleMysteryEncounterTurnStartEffects(): boolean {
  const encounter = globalScene.currentBattle.mysteryEncounter;
  if (globalScene.currentBattle.isBattleMysteryEncounter() && encounter && encounter.onTurnStart) {
    return encounter.onTurnStart();
  }

  return false;
}

/**
 * Helper function for encounters such as {@linkcode UncommonBreedEncounter} which call for a random species including event encounters.
 * If the mon is from the event encounter list, it may do an extra shiny or HA roll.
 * @param params - The {@linkcode RandomEncounterParams} used to configure the encounter
 * @returns The generated {@linkcode EnemyPokemon} for the requested encounter
 */
export function getRandomEncounterPokemon(params: RandomEncounterParams): EnemyPokemon {
  let {
    level,
    speciesFunction,
    isBoss = false,
    includeSubLegendary = true,
    includeLegendary = true,
    includeMythical = true,
    eventChance = 50,
    hiddenRerolls = 0,
    shinyRerolls = 0,
    eventHiddenRerolls = 0,
    eventShinyRerolls = 0,
    hiddenAbilityChance = BASE_HIDDEN_ABILITY_RATE,
    shinyChance = BASE_SHINY_CHANCE,
    maxShinyChance = 0,
    speciesFilter = () => true,
    isEventEncounter = new BooleanHolder(false),
  } = params;
  let bossSpecies: PokemonSpecies;
  const eventEncounters = timedEventManager.getAllValidEventEncounters(
    includeSubLegendary,
    includeLegendary,
    includeMythical,
    speciesFilter,
  );
  let formIndex: number | undefined;

  if (eventChance && eventEncounters.length > 0 && (eventChance === 100 || randSeedInt(100) < eventChance)) {
    const eventEncounter = randSeedItem(eventEncounters);
    const levelSpecies = getPokemonSpecies(eventEncounter.species).getWildSpeciesForLevel(
      level,
      !eventEncounter.blockEvolution,
      isBoss,
      globalScene.gameMode,
    );
    if (params.isEventEncounter) {
      params.isEventEncounter.value = true;
    }
    bossSpecies = getPokemonSpecies(levelSpecies);
    formIndex = eventEncounter.formIndex;
  } else if (speciesFunction) {
    bossSpecies = speciesFunction();
  } else {
    bossSpecies = globalScene.arena.randomSpecies(
      globalScene.currentBattle.waveIndex,
      level,
      0,
      getPartyLuckValue(globalScene.getPlayerParty()),
      isBoss,
    );
  }
  const ret = new EnemyPokemon(bossSpecies, level, TrainerSlot.NONE, isBoss);
  if (formIndex) {
    ret.formIndex = formIndex;
  }

  if (isEventEncounter.value) {
    hiddenRerolls += eventHiddenRerolls;
    shinyRerolls += eventShinyRerolls;
  }

  while (shinyRerolls > 0) {
    ret.trySetShinySeed(shinyChance, true, maxShinyChance);
    shinyRerolls--;
  }

  while (hiddenRerolls > 0 && ret.abilityIndex !== 2) {
    ret.tryRerollHiddenAbilitySeed(hiddenAbilityChance);
    hiddenRerolls--;
  }

  return ret;
}
