import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import type { Battle } from "#app/battle";
import { PLAYER_PARTY_MAX_SIZE, WEIGHT_INCREMENT_ON_SPAWN_MISS } from "#app/constants";
import { consumePendingDevEnemyParty, type DevEnemyMonSpec } from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import Overrides from "#app/overrides";
import { handleTutorial, Tutorial } from "#app/tutorial";
import { initEncounterAnims, loadEncounterAnimAssets } from "#data/battle-anims";
import { fieldPositionForSlot, formatById } from "#data/battle-format";
import { getCharVariantFromDialogue } from "#data/dialogue";
import { isCoopV2InteractionCutoverActive } from "#data/elite-redux/coop/authority-v2/cutover-interaction";
import {
  applyCoopAuthoritativeBattleState,
  applyCoopEnemies,
  captureCoopAuthoritativeBattleState,
  captureCoopDexBaseline,
  captureCoopEnemies,
  coopWaveStartEntryEffectSignature,
  normalizeCoopHpBoundsAtAuthorityBoundary,
} from "#data/elite-redux/coop/coop-battle-engine";
import { COOP_WAVE_NO_ME } from "#data/elite-redux/coop/coop-battle-stream";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { buildCoopEnemy } from "#data/elite-redux/coop/coop-enemy-builder";
import {
  settleCoopFieldPresentation,
  settleCoopFieldPresentationReady,
  settleCoopTrainerIntroTrays,
} from "#data/elite-redux/coop/coop-field-presentation";
import { clearCoopAuthoritativeGuestPlayerTrainer } from "#data/elite-redux/coop/coop-presentation";
import {
  coopSessionGeneration,
  failCoopSharedSession,
  getCoopBattleStreamer,
  getCoopController,
  getCoopNetcodeMode,
  getCoopRuntime,
  isAuthoritativeBattleSession,
  isCoopAuthoritativeGuest,
  isVersusSession,
  maybeBeginReplayRecording,
} from "#data/elite-redux/coop/coop-runtime";
import { captureCoopTrainerVictoryBoundary } from "#data/elite-redux/coop/coop-trainer-victory-boundary";
import type {
  CoopEncounterAuthority,
  CoopSerializedEnemy,
  CoopSerializedTrainer,
} from "#data/elite-redux/coop/coop-transport";
import { erRecordAchievementShinyEncounter } from "#data/elite-redux/er-achievement-tracker";
import { erBiomeForcedTerrain, erBiomeForcedWeather } from "#data/elite-redux/er-biome-rules";
import { getErFinalBossSpecies, isErFinalBossSpecies } from "#data/elite-redux/er-final-boss";
import { consumeErCarriedWeather } from "#data/elite-redux/er-map-nodes";
import {
  erApplyCovenantHeal,
  erLookoutPreviewEnemy,
  erQuartermasterTick,
  erStormglassApplyChosenWeather,
  getStormglassWeather,
  hasErRelic,
} from "#data/elite-redux/er-relics";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { buildTrainerEntranceTween, TRAINER_ENTRANCE_SLIDE_X } from "#data/elite-redux/er-trainer-fx";
import { CASCOON_ANGELS_WRATH_MOVES } from "#data/elite-redux/init-elite-redux-movesets";
import {
  maybeBeginSinglePlayerReplayRecording,
  maybeCaptureReplayCheckpoint,
} from "#data/elite-redux/replay-single-recording";
import { getNatureName } from "#data/nature";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import type { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PlayerGender } from "#enums/player-gender";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import type { TrainerType } from "#enums/trainer-type";
import type { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import type { WeatherType } from "#enums/weather-type";
import { EncounterPhaseEvent } from "#events/battle-scene";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import {
  BoostBugSpawnModifier,
  IvScannerModifier,
  overrideHeldItems,
  overrideModifiers,
  TurnHeldItemTransferModifier,
} from "#modifiers/modifier";
import { regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { getEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { doTrainerExclamation } from "#mystery-encounters/encounter-phase-utils";
import { getGoldenBugNetSpecies } from "#mystery-encounters/encounter-pokemon-utils";
import { BattlePhase } from "#phases/battle-phase";
import { achvs } from "#system/achv";
import { trainerConfigs } from "#trainers/trainer-config";
import { randSeedInt, randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

/**
 * Transitional launch containment for an authoritative co-op guest. The host's launch
 * snapshot is captured before its summon chain, so session restore leaves every player mon loaded
 * but invisible/off-field. Running SummonPhase here is forbidden because its tail derives shared
 * PostSummon effects. This helper still changes structural field membership and runs fieldSetup; it
 * must be replaced by applying an explicit host field-seat manifest at an immutable launch boundary.
 * Exported as a narrow test seam for the two-engine launch regression.
 */
export function materializeCoopLoadedPlayerField(): number {
  const battle = globalScene.currentBattle;
  if (battle == null) {
    return 0;
  }
  const capacity = battle.arrangement.playerCapacity;
  const seats = globalScene
    .getPlayerParty()
    .slice(0, capacity)
    .map((pokemon, slot) => ({ pokemon, slot }));
  return settleCoopFieldPresentation({
    side: "player",
    seats,
    capacity,
    boundary: "launch-ready",
    desired: "visible",
    hideStale: true,
    trainerDisposition: "hide-player",
  });
}

/**
 * Launch/next-wave continuation gate for the authoritative renderer. Unlike the synchronous repair seam,
 * this does not resolve until every active player seat is backed by its real loaded atlas and UI surface.
 */
export async function materializeCoopLoadedPlayerFieldReady(
  remainsCurrent: () => boolean = () => true,
): Promise<number> {
  const battle = globalScene.currentBattle;
  if (battle == null) {
    return 0;
  }
  const capacity = battle.arrangement.playerCapacity;
  const seats = globalScene
    .getPlayerParty()
    .slice(0, capacity)
    .map((pokemon, slot) => ({ pokemon, slot }));
  return settleCoopFieldPresentationReady(
    {
      side: "player",
      seats,
      capacity,
      boundary: "launch-ready",
      desired: "visible",
      hideStale: true,
      trainerDisposition: "hide-player",
    },
    remainsCurrent,
  );
}

/**
 * Transitional field containment for the authoritative guest's adopted trainer party. Trainer
 * encounters normally reveal enemies through SummonPhase, but that phase also runs fieldSetup and
 * post-summon resolution and is therefore correctly blocked by the renderer allowlist. The old path
 * still hid the trainer and queued those blocked phases, leaving the adopted enemy objects invisible
 * (and sometimes leaving the trainer sprite covering the field).
 *
 * This avoids fieldSetup, ability rolls, modifier generation, and RNG, but seating the objects and marking
 * them seen is still structural state. The durable replacement is an authoritative field-seat manifest
 * followed by a checksum-neutral render projection. Exported as a narrow regression-test seam.
 */
export function materializeCoopAdoptedEnemyField(): number {
  if (!isCoopAuthoritativeGuest()) {
    return 0;
  }
  const battle = globalScene.currentBattle;
  if (battle == null) {
    return 0;
  }
  const capacity = battle.arrangement.enemyCapacity;
  const seats = globalScene
    .getEnemyParty()
    .slice(0, capacity)
    .map((pokemon, slot) => ({ pokemon, slot }));
  // The guest intentionally replaces the two SummonPhase instances that normally hide these trainer-intro
  // trays. Establish that omitted phase's visual postcondition here, before EncounterPhase can open Command.
  settleCoopTrainerIntroTrays();
  return settleCoopFieldPresentation({
    side: "enemy",
    seats,
    capacity,
    boundary: "encounter-summon",
    desired: "visible",
    hideStale: true,
    trainerDisposition: "hide-enemy",
  });
}

/**
 * Dev scenario builder (staging only): construct one staged enemy mon for slot
 * `e`. Mirrors the LLM director's wild-encounter override construction. Returns
 * null when the spec's species doesn't resolve (falls through to normal gen).
 */
function buildDevEnemy(spec: DevEnemyMonSpec, fallbackLevel: number, trainerBattle: boolean): EnemyPokemon | null {
  const species = getPokemonSpecies(spec.speciesId);
  if (!species) {
    return null;
  }
  const level = Math.max(1, Math.floor(spec.level ?? fallbackLevel));
  const enemy = globalScene.addEnemyPokemon(
    species,
    level,
    trainerBattle ? TrainerSlot.TRAINER : TrainerSlot.NONE,
    !!spec.isBoss,
  );
  if (spec.formIndex) {
    enemy.formIndex = spec.formIndex;
    enemy.calculateStats();
    enemy.generateName();
  }
  if (spec.moveIds && spec.moveIds.length > 0) {
    const moves = spec.moveIds.slice(0, 4).map(id => new PokemonMove(id));
    enemy.moveset = moves;
    enemy.summonData.moveset = moves.slice();
  }
  if (spec.abilitySlot !== undefined) {
    enemy.abilityIndex = Math.max(0, Math.min(2, spec.abilitySlot));
  }
  if (spec.shiny) {
    enemy.shiny = true;
  }
  return enemy;
}

/**
 * How long a co-op GUEST waits for the host's enemy party before falling back to
 * generating its own (#633, LIVE-D6). Generous: the host only knows its enemies
 * after a human clears its save-slot screen, which can take a while.
 */
const COOP_ENEMY_PARTY_WAIT_MS = 120_000;
const COOP_ENEMY_PARTY_CONFIRM_WAIT_MS = 180_000;
/**
 * `awaitEnemyPartyWithRetry` already performs six addressed re-requests before it rejects. Permit one
 * explicit reconnect-and-confirm retry after that bounded recovery, then move both peers to the shared
 * terminal supervisor. This is deliberately finite: a synchronous/headless confirmation callback must
 * never recurse forever after teardown, and a live client must never remain parked on this surface forever.
 */
const COOP_ENEMY_PARTY_CONFIRM_RETRIES = 1;

function captureCoopTrainer(trainer: Trainer): CoopSerializedTrainer {
  return {
    trainerType: trainer.config.trainerType,
    variant: trainer.variant,
    partyTemplateIndex: trainer.partyTemplateIndex,
    ...(trainer.nameKey ? { nameKey: trainer.nameKey } : {}),
    ...(trainer.partnerNameKey ? { partnerNameKey: trainer.partnerNameKey } : {}),
    ...(trainer.name ? { name: trainer.name } : {}),
    ...(trainer.partnerName ? { partnerName: trainer.partnerName } : {}),
    nameWithTitle: trainer.getName(TrainerSlot.NONE, true),
    renderNames: {
      none: trainer.getName(TrainerSlot.NONE, false),
      noneWithTitle: trainer.getName(TrainerSlot.NONE, true),
      trainer: trainer.getName(TrainerSlot.TRAINER, false),
      trainerWithTitle: trainer.getName(TrainerSlot.TRAINER, true),
      partner: trainer.getName(TrainerSlot.TRAINER_PARTNER, false),
      partnerWithTitle: trainer.getName(TrainerSlot.TRAINER_PARTNER, true),
    },
    encounterMessages: [...trainer.getEncounterMessages()],
    victoryMessages: [...trainer.getVictoryMessages()],
    defeatMessages: [...trainer.getDefeatMessages()],
    ...(trainer.erGhostApproach ? { erGhostApproach: trainer.erGhostApproach } : {}),
    ...(trainer.erGhostAura ? { erGhostAura: trainer.erGhostAura } : {}),
    ...(trainer.erGhostFxSpeed === undefined ? {} : { erGhostFxSpeed: trainer.erGhostFxSpeed }),
    ...(trainer.erGhostFxIntensity === undefined ? {} : { erGhostFxIntensity: trainer.erGhostFxIntensity }),
  };
}

/** Host: capture every encounter branch the guest must adopt before rendering this wave. */
export function captureCoopEncounterAuthority(battle: Battle): CoopEncounterAuthority {
  return {
    battleType: battle.battleType,
    mysteryEncounterType: battle.mysteryEncounter?.encounterType ?? COOP_WAVE_NO_ME,
    formatId: battle.format.id,
    enemyLevels: [...(battle.enemyLevels ?? [])],
    ...(battle.trainer == null ? {} : { trainer: captureCoopTrainer(battle.trainer) }),
  };
}

/**
 * Co-op HOST (#920): RE-BROADCAST the wave-start authoritative state AFTER the on-entry ability chain
 * (PostSummonPhase) has settled and BEFORE the host's first CommandPhase, so the pure-renderer guest -
 * which never runs summon/PostSummon and only ADOPTS host state - picks up EVERY on-entry effect (terrain,
 * weather, entry-hazard/screen arena tags, entry FORM changes) at its own turn-1 belt-and-suspenders adopt
 * (command-phase `tryCoopCheckpointSync` -> {@linkcode applyCoopAuthoritativeBattleState}) rather than at the
 * turn-1 END checkpoint - after it already commanded with stale state (#920 wave-1 GRASSY_SURGE desync).
 *
 * The wave-start enemyPartySync ({@linkcode broadcastCoopEnemyParty}) captures its authoritativeState at the
 * PRE-summon encounter boundary, STRICTLY before any entry ability fires, so its terrain/weather/tags/forms
 * are stale. This reuses the SAME carrier (NO new wire type): re-send the enemyPartySync with a POST-PostSummon
 * re-capture, and the guest's already-existing arena/form adopt applies it.
 *
 * IDEMPOTENT / NO-OP: fires the re-send ONLY when the live post-PostSummon entry-effect signature DIFFERS
 * from the one already broadcast for this wave (no entry effect -> no re-send at all). A double-battle's
 * second turn-1 CommandPhase self-latches: the first re-send updated the retained SENT state, so the
 * signatures then match. Host-only + co-op/showdown-only, gated exactly like {@linkcode broadcastCoopEnemyParty}
 * (isAuthoritativeBattleSession + host role); solo / guest / non-host are a hard no-op. It does NOT wait on
 * the interaction counter (plain `transport.send`), so it cannot re-introduce the wave-1 -> wave-2 command
 * rendezvous deadlock the sole-publication comment in {@linkcode broadcastCoopEnemyParty} warns against.
 */
export function rebroadcastCoopWaveStartAuthorityAfterEntryEffects(): void {
  if (!isAuthoritativeBattleSession()) {
    return;
  }
  const controller = getCoopController();
  const streamer = getCoopBattleStreamer();
  if (controller == null || streamer == null || controller.role !== "host") {
    return;
  }
  try {
    const battle = globalScene.currentBattle;
    if (battle == null) {
      return;
    }
    const wave = battle.waveIndex;
    const sentState = streamer.peekSentEnemyPartyAuthoritativeState(wave);
    if (sentState === undefined) {
      // No wave-start authoritative state was published for this wave; there is nothing to refresh.
      return;
    }
    const liveSignature = coopWaveStartEntryEffectSignature();
    if (liveSignature === "" || liveSignature === coopWaveStartEntryEffectSignature(sentState)) {
      // No on-entry effect mutated arena/forms after the pre-summon capture: a true no-op.
      return;
    }
    const enemies = captureCoopEnemies();
    const authoritativeState = captureCoopAuthoritativeBattleState(battle.turn);
    if (authoritativeState == null) {
      return;
    }
    const encounter = captureCoopEncounterAuthority(battle);
    // Re-publish the SAME carrier with the post-summon re-capture. The encounter descriptor is re-sent so
    // this passes the monotonic-authority guard (a party-only downgrade would be ignored); the guest's
    // turn-1 belt-and-suspenders re-consumes the buffers and adopts terrain/weather/tags/forms.
    streamer.sendEnemyParty(
      wave,
      enemies,
      battle.mysteryEncounter?.encounterType ?? COOP_WAVE_NO_ME,
      battle.battleType,
      authoritativeState,
      encounter,
    );
    coopLog(
      "replay",
      `host RE-BROADCAST wave-start authority wave=${wave} after post-summon entry effects settled (#920)`,
    );
  } catch (error) {
    // A re-broadcast failure must never break the host's turn; the guest still heals at the turn-1 END
    // checkpoint (its prior, slower behavior), so this is strictly best-effort.
    coopWarn("stream", "host failed to re-broadcast post-summon wave-start authority", error);
  }
}

function buildAuthoritativeTrainer(data: CoopSerializedTrainer): Trainer {
  if (
    !Number.isInteger(data.trainerType)
    || !Object.hasOwn(trainerConfigs, data.trainerType)
    || !Number.isInteger(data.variant)
    || !Number.isInteger(data.partyTemplateIndex)
    || data.partyTemplateIndex < 0
  ) {
    throw new Error("Malformed authoritative trainer descriptor");
  }
  const trainer = new Trainer(
    data.trainerType as TrainerType,
    data.variant as TrainerVariant,
    data.partyTemplateIndex,
    data.nameKey,
    data.partnerNameKey,
  );
  if (data.name !== undefined) {
    trainer.name = data.name;
  }
  if (data.partnerName !== undefined) {
    trainer.partnerName = data.partnerName;
  }
  if (data.renderNames !== undefined) {
    const names = { ...data.renderNames };
    trainer.getName = (slot: TrainerSlot = TrainerSlot.NONE, includeTitle = false): string => {
      if (slot === TrainerSlot.TRAINER_PARTNER) {
        return includeTitle ? names.partnerWithTitle : names.partner;
      }
      if (slot === TrainerSlot.TRAINER) {
        return includeTitle ? names.trainerWithTitle : names.trainer;
      }
      return includeTitle ? names.noneWithTitle : names.none;
    };
  } else if (data.nameWithTitle !== undefined) {
    const plainName = data.name ?? trainer.name;
    const titledName = data.nameWithTitle;
    trainer.getName = (_slot: TrainerSlot = TrainerSlot.NONE, includeTitle = false): string =>
      includeTitle ? titledName : plainName;
  }
  if (data.encounterMessages !== undefined) {
    const messages = [...data.encounterMessages];
    trainer.getEncounterMessages = () => [...messages];
  }
  if (data.victoryMessages !== undefined) {
    const messages = [...data.victoryMessages];
    trainer.getVictoryMessages = () => [...messages];
  }
  if (data.defeatMessages !== undefined) {
    const messages = [...data.defeatMessages];
    trainer.getDefeatMessages = () => [...messages];
  }
  trainer.erGhostApproach = data.erGhostApproach as Trainer["erGhostApproach"];
  trainer.erGhostAura = data.erGhostAura;
  trainer.erGhostFxSpeed = data.erGhostFxSpeed;
  trainer.erGhostFxIntensity = data.erGhostFxIntensity;
  return trainer;
}

/** Guest: atomically replace every locally-derived encounter branch with the host descriptor. */
export function applyCoopEncounterAuthority(battle: Battle, authority: CoopEncounterAuthority): void {
  const format = formatById(authority.formatId);
  const validBattleType =
    authority.battleType === BattleType.WILD
    || authority.battleType === BattleType.TRAINER
    || authority.battleType === BattleType.MYSTERY_ENCOUNTER;
  const levelsValid =
    Array.isArray(authority.enemyLevels) && authority.enemyLevels.every(level => Number.isFinite(level) && level >= 1);
  if (!validBattleType || format == null || !levelsValid) {
    throw new Error("Malformed authoritative encounter descriptor");
  }
  const isMystery = authority.battleType === BattleType.MYSTERY_ENCOUNTER;
  if (isMystery === (authority.mysteryEncounterType === COOP_WAVE_NO_ME)) {
    throw new Error("Authoritative encounter mystery verdict contradicts battle type");
  }
  if ((authority.battleType === BattleType.TRAINER) !== (authority.trainer != null)) {
    throw new Error("Authoritative encounter trainer descriptor contradicts battle type");
  }

  // Construct first so an invalid trainer cannot partially mutate the live battle.
  const replacementTrainer = authority.trainer == null ? null : buildAuthoritativeTrainer(authority.trainer);
  const oldTrainer = battle.trainer;
  battle.battleType = authority.battleType as BattleType;
  battle.mysteryEncounterType = isMystery ? (authority.mysteryEncounterType as MysteryEncounterType) : undefined;
  battle.mysteryEncounter = undefined;
  battle.setFormat(format);
  const commandSlots = battle.arrangement.activeIndices();
  battle.turnCommands = Object.fromEntries(commandSlots.map(index => [index, null]));
  battle.preTurnCommands = Object.fromEntries(commandSlots.map(index => [index, null]));
  battle.enemyLevels = [...authority.enemyLevels];
  // Never preserve a locally pre-populated encounter override or an extra slot from the wrong format.
  // The caller installs the carrier's complete party immediately after this descriptor is accepted.
  battle.enemyParty = [];
  battle.trainer = replacementTrainer;
  if (oldTrainer != null && oldTrainer !== replacementTrainer) {
    globalScene.field.remove(oldTrainer, false);
    oldTrainer.destroy();
  }
  if (replacementTrainer != null) {
    globalScene.field.add(replacementTrainer);
    // Retain the exact host-authored trainer reward/presentation identity while this source-wave Battle is
    // still installed. A delayed retained victory may run only after NewBattle speculatively installed the
    // next (possibly wild) Battle, at which point `currentBattle.trainer` is not the defeated trainer.
    captureCoopTrainerVictoryBoundary(globalScene, battle);
  }
}

export class EncounterPhase extends BattlePhase {
  // Union type is necessary as this is subclassed, and typescript will otherwise complain
  public readonly phaseName: "EncounterPhase" | "NextEncounterPhase" | "NewBiomeEncounterPhase" = "EncounterPhase";

  private readonly loaded: boolean;

  /** Co-op GUEST (#633): set when this client adopted the host's enemy party verbatim
   *  (incl. host-streamed held items), so {@linkcode runEncounter} skips its own enemy
   *  modifier generation - otherwise the held items would double / diverge. */
  private coopAdoptedEnemyParty = false;

  /**
   * The immutable host manifest retained until local field setup and pre-summon hooks finish. Those hooks can
   * recalculate stats from guest-local context after {@linkcode buildCoopEnemy} initially applied `maxHp`, so
   * the manifest must be reasserted at the final encounter seam before the first command/checksum is exposed.
   */
  private coopEnemyAuthority: CoopSerializedEnemy[] | null = null;

  /** Immutable lifetime of the ordinary authoritative carrier wait. */
  private coopEnemyAdoptionBoundary: {
    readonly generation: number;
    readonly scene: typeof globalScene;
    readonly battle: Battle;
    readonly runtime: NonNullable<ReturnType<typeof getCoopRuntime>>;
    readonly streamer: NonNullable<ReturnType<typeof getCoopBattleStreamer>>;
  } | null = null;
  private coopEnemyAdoptionInFlight = false;
  private coopEnemyAdoptionComplete = false;
  private coopEnemyAdoptionFailures = 0;
  private coopEnemyRecoveryPromptOpen = false;
  private coopEnemyRecoveryPromptTimer: ReturnType<typeof setTimeout> | null = null;
  /** Prevent duplicate encounter tails while the authoritative launch presentation awaits real assets. */
  private coopPresentationEndStarted = false;

  constructor(loaded = false) {
    super();

    this.loaded = loaded;
  }

  start() {
    super.start();

    // ReturnPhase is structural and therefore neutralized on the authoritative guest.
    // Its subsequent player SummonPhase never owns ShowTrainerPhase's exit there, so clear
    // the unmatched throw sprite before any async enemy-authority wait. This base seam covers
    // ordinary, next-wave, and new-biome encounters.
    clearCoopAuthoritativeGuestPlayerTrainer();

    // #record-replay (Phase 2): begin recording this run's replay trace at the first EncounterPhase
    // (seed + the starting party are both established here). Two mutually-exclusive, idempotent enables:
    //  - CO-OP: begin on the authoritative host (hard no-op off the live co-op host / already recording).
    //  - SINGLE-PLAYER: begin for a classic SOLO run (hard no-op in co-op / non-classic / already recording).
    // Exactly one fires per run (gated by mode), so the same passive command + interaction taps feed
    // whichever recording is live. Both are behavior-preserving passive observers.
    maybeBeginReplayRecording();
    maybeBeginSinglePlayerReplayRecording();
    // #record-replay (checkpoint): capture a session-save-grade CHECKPOINT at THIS wave boundary so a
    // recorded trace can boot from the run's ACTUAL state at the ring-buffer window start (not the
    // original header roster). Wave-boundary-only (the perf guard) + a no-op unless recording + guarded.
    maybeCaptureReplayCheckpoint();
    // #801 run-scoped acquisition sharing: snapshot the dex/starter baseline at the CO-OP run's
    // first encounter so the shared blob only ever carries RUN acquisitions (catches, unlocks) -
    // never the host's whole account dex ("they get all of my pokemon" live report). Idempotent
    // per wave-1; harmless in solo (the blob is only sent in co-op).
    if (globalScene.gameMode.isCoop && globalScene.currentBattle?.waveIndex === 1) {
      captureCoopDexBaseline();
    }

    // Co-op GUEST (#633, LIVE-D6): adopt the host's authoritative enemy party BEFORE
    // generating our own, so both clients fight byte-identical enemies (species
    // included). The host only knows its enemies after it clears its own save-slot
    // screen, so the guest waits behind a replaying authority boundary. A timeout fails
    // closed; it never permits normal generation. Solo / host / loaded runs go straight to runEncounter()
    // synchronously below - byte-for-byte unchanged from before.
    if (this.shouldAdoptCoopEnemyParty()) {
      void this.runEncounterAfterCoopAdopt();
      return;
    }

    this.runEncounter();
  }

  /** Whether THIS client must wait for + adopt the host's enemy party (co-op GUEST only). */
  private shouldAdoptCoopEnemyParty(): boolean {
    // Showdown-versus (F1, 2026-07-08): the versus guest NEVER adopts - its whole world (both
    // parties, side-SWAPPED to its local orientation) comes from the launch snapshot; the
    // enemyPartySync payload is authoritative-oriented (the guest's OWN team) and adopting it
    // would overwrite the swapped enemy side with the wrong party (the double-launch bug).
    if (this.loaded || !isAuthoritativeBattleSession() || isVersusSession()) {
      return false;
    }
    const controller = getCoopController();
    const streamer = getCoopBattleStreamer();
    if (controller == null || streamer == null || controller.role !== "guest") {
      return false;
    }
    const battle = globalScene.currentBattle;
    if (getCoopNetcodeMode() === "authoritative") {
      // Co-op AUTHORITATIVE netcode (#633, TRACK-2 Phase B): the GUEST is a pure renderer -
      // it NEVER rolls its own enemies for ANY battle type. It awaits + adopts the host's
      // authoritative party for wild AND trainer AND mystery-encounter battles (the host
      // serializes + streams the generated party regardless of type), pre-filling
      // battle.enemyParty so the encounter's own generation loop SKIPS (its `!enemyParty[e]`
      // guard). The trainer object / ME encounter the guest still builds locally for
      // RENDERING only - the MONS are the host's.
      return battle != null;
    }
    // LOCKSTEP netcode (#633): adopt only for WILD and TRAINER battles (the 778b192dd gate).
    // Wild parties roll a random species; trainer parties roll unseeded gender / double-
    // battle flags and an unseeded species-pool pick (the latent wave-4 trainer desync).
    // Ghost waves are BattleType.TRAINER, so they're covered here too. Mystery encounters
    // are excluded (handled elsewhere) by the guard.
    if (battle == null || battle.isBattleMysteryEncounter()) {
      return false;
    }
    return battle.battleType === BattleType.WILD || battle.battleType === BattleType.TRAINER;
  }

  private bindCoopEnemyAdoptionBoundary(): NonNullable<typeof this.coopEnemyAdoptionBoundary> | null {
    if (this.coopEnemyAdoptionBoundary != null) {
      return this.coopEnemyAdoptionBoundary;
    }
    const runtime = getCoopRuntime();
    const streamer = getCoopBattleStreamer();
    const battle = globalScene.currentBattle;
    if (runtime == null || streamer == null || battle == null) {
      return null;
    }
    this.coopEnemyAdoptionBoundary = {
      generation: coopSessionGeneration(),
      scene: globalScene,
      battle,
      runtime,
      streamer,
    };
    return this.coopEnemyAdoptionBoundary;
  }

  private isCoopEnemyAdoptionBoundaryLive(): boolean {
    const boundary = this.coopEnemyAdoptionBoundary;
    return (
      boundary != null
      && coopSessionGeneration() === boundary.generation
      && getCoopRuntime() === boundary.runtime
      && getCoopBattleStreamer() === boundary.streamer
      && globalScene === boundary.scene
      && boundary.scene.currentBattle === boundary.battle
      && boundary.scene.phaseManager.getCurrentPhase() === this
    );
  }

  /** Co-op guest: wait for + adopt the host's enemy party, then run the encounter. */
  private async runEncounterAfterCoopAdopt(): Promise<void> {
    if (this.coopEnemyAdoptionComplete || this.coopEnemyAdoptionInFlight || this.coopEnemyRecoveryPromptOpen) {
      return;
    }
    const boundary = this.bindCoopEnemyAdoptionBoundary();
    if (boundary == null) {
      coopWarn("stream", "ordinary-wave authoritative enemy adoption had no immutable runtime boundary");
      failCoopSharedSession("The next encounter lost its authoritative battle carrier.");
      return;
    }
    if (!this.isCoopEnemyAdoptionBoundaryLive()) {
      coopWarn("stream", `ignored stale ordinary-wave carrier callback for wave ${boundary.battle.waveIndex}`);
      return;
    }

    this.coopEnemyAdoptionInFlight = true;
    let failure: unknown = null;
    try {
      await this.adoptCoopHostEnemyParty(() => this.isCoopEnemyAdoptionBoundaryLive());
      if (!this.isCoopEnemyAdoptionBoundaryLive()) {
        return;
      }
      try {
        this.runEncounter();
        this.coopEnemyAdoptionComplete = true;
      } catch (error) {
        coopWarn("stream", "ordinary-wave authoritative encounter materialization failed closed", error);
        failCoopSharedSession(
          `Could not materialize the authoritative encounter at wave ${boundary.battle.waveIndex}.`,
          {
            boundary: "surface",
            reasonCode: "continuation-failed",
            wave: boundary.battle.waveIndex,
          },
        );
        return;
      }
    } catch (error) {
      failure = error;
    } finally {
      this.coopEnemyAdoptionInFlight = false;
    }

    // A teardown, phase replacement, battle replacement, or runtime swap owns this late continuation now.
    // Do not open UI on another scene and, critically, do not let a synchronous test confirmation recurse.
    if (failure == null || !this.isCoopEnemyAdoptionBoundaryLive()) {
      if (failure != null) {
        coopWarn("stream", `ignored superseded ordinary-wave carrier failure for wave ${boundary.battle.waveIndex}`);
      }
      return;
    }

    this.coopEnemyAdoptionFailures++;
    coopWarn("stream", "ordinary-wave authoritative enemy adoption failed closed", failure);
    if (this.coopEnemyAdoptionFailures > COOP_ENEMY_PARTY_CONFIRM_RETRIES) {
      failCoopSharedSession(`Could not recover the authoritative enemy party for wave ${boundary.battle.waveIndex}.`, {
        boundary: "recovery",
        reasonCode: "recovery-exhausted",
        wave: boundary.battle.waveIndex,
      });
      return;
    }

    this.coopEnemyRecoveryPromptOpen = true;
    this.coopEnemyRecoveryPromptTimer = setTimeout(() => {
      this.coopEnemyRecoveryPromptTimer = null;
      if (!this.coopEnemyRecoveryPromptOpen || !this.isCoopEnemyAdoptionBoundaryLive()) {
        return;
      }
      this.coopEnemyRecoveryPromptOpen = false;
      failCoopSharedSession(`Recovery confirmation expired for the enemy party at wave ${boundary.battle.waveIndex}.`, {
        boundary: "recovery",
        reasonCode: "recovery-exhausted",
        wave: boundary.battle.waveIndex,
      });
    }, COOP_ENEMY_PARTY_CONFIRM_WAIT_MS);
    // Node-based engine runners must not be kept alive solely by a superseded human-confirmation timer.
    (this.coopEnemyRecoveryPromptTimer as unknown as { unref?: () => void }).unref?.();
    try {
      boundary.scene.ui.showText(
        "Could not recover your partner's battle state. Reconnect, then confirm to retry.",
        null,
        () => {
          if (this.coopEnemyRecoveryPromptTimer != null) {
            clearTimeout(this.coopEnemyRecoveryPromptTimer);
            this.coopEnemyRecoveryPromptTimer = null;
          }
          this.coopEnemyRecoveryPromptOpen = false;
          if (this.isCoopEnemyAdoptionBoundaryLive()) {
            void this.runEncounterAfterCoopAdopt();
          }
        },
        null,
        true,
      );
    } catch (error) {
      if (this.coopEnemyRecoveryPromptTimer != null) {
        clearTimeout(this.coopEnemyRecoveryPromptTimer);
        this.coopEnemyRecoveryPromptTimer = null;
      }
      this.coopEnemyRecoveryPromptOpen = false;
      coopWarn("stream", "ordinary-wave recovery prompt could not open", error);
      failCoopSharedSession(
        `Could not open recovery for the authoritative enemy party at wave ${boundary.battle.waveIndex}.`,
        {
          boundary: "recovery",
          reasonCode: "recovery-exhausted",
          wave: boundary.battle.waveIndex,
        },
      );
    }
  }

  /**
   * Authoritative-renderer entry seam for boundary subclasses. It adopts the complete retained host carrier
   * and prepares only already-authoritative visual objects. It deliberately bypasses EncounterPhase.start /
   * runEncounter: no initSession, encounter event, ME initialization, RNG, abilities, AI, relics, weather,
   * save, dex, or shared modifier hooks run here.
   */
  protected async prepareCoopAuthoritativeGuestPresentationOnly(onReady: () => void | Promise<void>): Promise<void> {
    const scene = globalScene;
    const runtime = getCoopRuntime();
    const streamer = getCoopBattleStreamer();
    const generation = coopSessionGeneration();
    const wave = scene.currentBattle?.waveIndex ?? -1;
    const battle = scene.currentBattle;
    const stillCurrent = (): boolean =>
      globalScene === scene
      && getCoopRuntime() === runtime
      && getCoopBattleStreamer() === streamer
      && coopSessionGeneration() === generation
      && scene.currentBattle === battle
      && scene.currentBattle?.waveIndex === wave
      && scene.phaseManager.getCurrentPhase() === this;
    super.start();
    if (battle == null || !stillCurrent()) {
      throw new Error("Authoritative encounter presentation boundary was already stale");
    }
    // The carrier is immutable and one-shot at the streamer boundary, while asset loading and visual
    // materialization below are deliberately retryable. A presentation failure after a successful adopt
    // must therefore resume from the retained, already-built party instead of awaiting the consumed frame
    // again (which parks NewBiomeEncounterPhase forever with an empty queue).
    if (!this.coopAdoptedEnemyParty) {
      await this.adoptCoopHostEnemyParty(stillCurrent);
    }
    if (!stillCurrent()) {
      throw new Error("Authoritative encounter carrier arrived after boundary replacement");
    }
    if (globalScene.currentBattle !== battle) {
      throw new Error("Authoritative encounter disappeared before presentation");
    }
    const loads = battle.enemyParty.map(enemy => enemy.loadAssets());
    if (battle.trainer != null) {
      loads.push(
        battle.trainer.loadAssets().then(() => {
          battle.trainer?.initSprite();
        }),
      );
    }
    await Promise.all(loads);
    if (!stillCurrent()) {
      throw new Error("Authoritative encounter assets arrived after boundary replacement");
    }
    await materializeCoopLoadedPlayerFieldReady(stillCurrent);
    materializeCoopAdoptedEnemyField();
    globalScene.updateGameInfo();
    if (!stillCurrent()) {
      throw new Error("Authoritative encounter presentation was superseded");
    }
    await onReady();
  }

  /** Presentation-only terminal: shift exactly once without EncounterPhase.end's shared mutation hooks. */
  protected shiftCoopAuthoritativeGuestPresentationOnly(): void {
    super.end();
  }

  /**
   * Co-op GUEST (#633, LIVE-D6): pull the host's authoritative enemy party off the
   * stream and pre-populate `battle.enemyParty` from it, so {@linkcode runEncounter}'s
   * generation loop SKIPS rolling our own (its `!battle.enemyParty[e]` guard) and we
   * fight the host's exact mons. The whole party is adopted atomically; missing or malformed
   * authority fails the transition closed instead of letting the guest generate a different battle.
   */
  private async adoptCoopHostEnemyParty(isCurrent?: () => boolean): Promise<void> {
    const streamer = getCoopBattleStreamer();
    const scene = globalScene;
    const battle = scene.currentBattle;
    if (streamer == null || battle == null) {
      throw new Error("Authoritative enemy carrier unavailable");
    }
    // Ordered WebRTC cannot guarantee a one-shot frame sent across an SCTP abort, suspended tab, or
    // reconnect generation. Keep the boundary closed and re-request the exact wave until the ceiling.
    const enemies = await streamer.awaitEnemyPartyWithRetry(
      battle.waveIndex,
      wave => streamer.requestEnemyParty(wave),
      { timeoutMs: COOP_ENEMY_PARTY_WAIT_MS },
    );
    if (enemies == null) {
      throw new Error(`Authoritative enemy party unavailable for wave ${battle.waveIndex}; refusing local derivation`);
    }
    if ((isCurrent != null && !isCurrent()) || scene.currentBattle !== battle) {
      throw new Error(`Authoritative enemy carrier for wave ${battle.waveIndex} arrived after phase replacement`);
    }
    const encounter = streamer.consumeEnemyPartyEncounter(battle.waveIndex);
    if (encounter == null) {
      throw new Error(`Authoritative encounter descriptor unavailable for wave ${battle.waveIndex}`);
    }
    if ((isCurrent != null && !isCurrent()) || scene.currentBattle !== battle) {
      throw new Error(`Authoritative encounter descriptor for wave ${battle.waveIndex} became stale`);
    }
    applyCoopEncounterAuthority(battle, encounter);
    if (battle.battleType !== BattleType.MYSTERY_ENCOUNTER && enemies.length === 0) {
      throw new Error(`Authoritative enemy party was empty at wave ${battle.waveIndex}`);
    }
    if (battle.battleType === BattleType.MYSTERY_ENCOUNTER && enemies.length > 0) {
      throw new Error(`Mystery encounter carried an unexpected ordinary enemy party at wave ${battle.waveIndex}`);
    }
    const levels = battle.enemyLevels ?? [];
    // Trainer enemies belong in TrainerSlot.TRAINER; wild enemies in NONE.
    const trainerSlot = battle.battleType === BattleType.TRAINER ? TrainerSlot.TRAINER : TrainerSlot.NONE;
    const rebuilt: EnemyPokemon[] = [];
    for (const entry of enemies) {
      if (!Number.isInteger(entry.fieldIndex) || entry.fieldIndex < 0 || rebuilt[entry.fieldIndex] != null) {
        throw new Error(`Invalid authoritative enemy field index ${entry.fieldIndex} at wave ${battle.waveIndex}`);
      }
      const built = buildCoopEnemy(entry.data, levels[entry.fieldIndex] ?? 1, trainerSlot);
      if (built == null) {
        throw new Error(
          `Could not reconstruct authoritative enemy slot ${entry.fieldIndex} at wave ${battle.waveIndex}`,
        );
      }
      rebuilt[entry.fieldIndex] = built;
    }
    if (battle.battleType === BattleType.MYSTERY_ENCOUNTER) {
      if (rebuilt.length > 0) {
        throw new Error(`Mystery encounter rebuilt an unexpected enemy party at wave ${battle.waveIndex}`);
      }
    } else if (rebuilt.length !== enemies.length || rebuilt[0] == null || rebuilt.some(enemy => enemy == null)) {
      throw new Error(`Authoritative enemy party was incomplete at wave ${battle.waveIndex}`);
    }
    battle.enemyParty = rebuilt;
    // The generation loop must not roll modifiers over the verbatim party; that would double held items.
    this.coopAdoptedEnemyParty = true;
    this.coopEnemyAuthority = enemies;
    // The enemy handoff is the first coherent presentation boundary of the new wave. Apply the host's
    // complete state here, but RETAIN it for CommandPhase: summon/entry presentation can mutate stages,
    // abilities and forms after this point, and the last pre-input funnel must reassert or replace it.
    applyCoopAuthoritativeBattleState(streamer.peekEnemyPartyState(battle.waveIndex), true);
  }

  /**
   * Co-op HOST (#633, LIVE-D6): broadcast the just-generated enemy party so the guest
   * (which paused its own encounter to wait) adopts these exact mons. No-op for solo /
   * non-host. Best-effort + guarded - never blocks or breaks the host's encounter.
   */
  private broadcastCoopEnemyParty(): void {
    // Showdown-versus (C5): the host broadcasts the enemy party (the guest's team it built from
    // the manifest) so the guest adopts these exact mons. Co-op OR showdown; solo/non-host no-op.
    if (!isAuthoritativeBattleSession()) {
      return;
    }
    const controller = getCoopController();
    const streamer = getCoopBattleStreamer();
    if (controller == null || streamer == null || controller.role !== "host") {
      return;
    }
    try {
      const wave = globalScene.currentBattle.waveIndex;
      const enemies = captureCoopEnemies();
      const authoritativeState = captureCoopAuthoritativeBattleState(globalScene.currentBattle.turn);
      const encounter = captureCoopEncounterAuthority(globalScene.currentBattle);
      // The complete carrier is immutable, wave-keyed and retained for replay. Publish it as soon as
      // encounter construction is coherent: an early guest only buffers it and cannot apply it until its
      // own NextEncounterPhase reaches this wave. Do NOT wait on the interaction counter here. Reward
      // selection starts NewBattlePhase synchronously before its terminal interaction increment; capturing
      // that old generation made this sole publication wait forever while the host reached CommandPhase
      // (live wave-1 -> wave-2 deadlock). Command rendezvous remains the gameplay barrier.
      // #862: the wave-start sync ALWAYS states the ME verdict - the encounter type when the host rolled
      // an ME, the explicit NO-ME sentinel otherwise.
      streamer.sendEnemyParty(
        wave,
        enemies,
        globalScene.currentBattle?.mysteryEncounter?.encounterType ?? COOP_WAVE_NO_ME,
        // #867: state the host-authoritative WILD-vs-TRAINER verdict so the guest adopts it in
        // newBattle instead of re-deriving via isWaveTrainer (the wave-42 saveDataDigest split).
        globalScene.currentBattle?.battleType,
        authoritativeState ?? undefined,
        encounter,
      );
    } catch (error) {
      // Keep the host playable, but make the failed authoritative boundary explicit in diagnostics; the
      // guest stays closed and re-requests rather than constructing a different encounter.
      coopWarn("stream", "host failed to publish complete ordinary-wave authority", error);
    }
  }

  /**
   * Mandatory authoritative boundary immediately before encounter presentation dispatch. This must live
   * ABOVE the virtual {@linkcode doEncounter} call: NextEncounterPhase overrides that method, which let
   * every wave after wave 1 generate enemies and reach CommandPhase without ever publishing its carrier.
   */
  private finalizeCoopEncounterAuthority(): void {
    // This is the final stat-bearing encounter hook. Serialize only after it so held-item/stat recalculation
    // cannot make the first visible frame differ from the retained carrier.
    globalScene.updateModifiers(false);
    normalizeCoopHpBoundsAtAuthorityBoundary();
    if (this.coopAdoptedEnemyParty && this.coopEnemyAuthority != null) {
      applyCoopEnemies(this.coopEnemyAuthority);
    }
    if (!this.loaded) {
      this.broadcastCoopEnemyParty();
    }
  }

  /** Finalize the shared authority, then dispatch the subtype-specific presentation. */
  private enterEncounterPresentation(): void {
    this.finalizeCoopEncounterAuthority();
    this.doEncounter();
  }

  /**
   * Co-op HOST (#633 M4 push-snapshot launch): the instant the host's session is COHERENT at a
   * launch encounter (enemy party + arena + weather/terrain all set), serialize the FULL session
   * (`getSessionSaveData()` - the same complete serializer cloud-save + resume ride on) and PUSH it
   * to the guest, which BOOTS from it rolling nothing of its own (§3.6). This is the "launch = the
   * first snapshot" mechanism: it replaces the guest re-deriving its enemy/arena from the seed (a
   * latent desync surface) with adopting the host's authoritative bytes. Launch-only for now
   * (`this.phaseName === "EncounterPhase"`); NextEncounter/NewBiome waves keep the per-wave
   * enemy-adopt. No-op for solo / guest / loaded. Best-effort + guarded - never breaks the host.
   */
  private broadcastCoopLaunchSnapshot(committedSessionJson?: string): void {
    // Showdown-versus (C5): the host pushes the full launch snapshot so the guest boots its render
    // from the host's authoritative bytes. Co-op OR showdown; solo/guest/non-EncounterPhase no-op.
    if (!isAuthoritativeBattleSession() || this.phaseName !== "EncounterPhase") {
      return;
    }
    const controller = getCoopController();
    const streamer = getCoopBattleStreamer();
    if (controller == null || streamer == null || controller.role !== "host") {
      return;
    }
    try {
      // Fresh co-op releases the exact bytes already committed locally, in host cloud, and through
      // the guest checkpoint ACK. Showdown has no persistence transaction and uses the coherent
      // in-memory serializer as before.
      const json =
        committedSessionJson
        ?? JSON.stringify(globalScene.gameData.getSessionSaveData(), (_k, v: unknown) =>
          typeof v === "bigint" ? v.toString() : v,
        );
      streamer.sendLaunchSnapshot(globalScene.currentBattle.waveIndex, json);
    } catch {
      /* a serialize/send failure must never break the host; the guest remains at its recovery boundary */
    }
  }

  private runEncounter() {
    globalScene.updateGameInfo();

    globalScene.initSession();

    globalScene.eventTarget.dispatchEvent(new EncounterPhaseEvent());

    // Failsafe if players somehow skip floor 200 in classic mode
    if (globalScene.gameMode.isClassic && globalScene.currentBattle.waveIndex > 200) {
      globalScene.phaseManager.unshiftNew("GameOverPhase");
    }

    const loadEnemyAssets: Promise<void>[] = [];

    const battle = globalScene.currentBattle;
    const encounterScene = globalScene;
    const encounterRuntime = getCoopRuntime();
    const encounterController = getCoopController();
    const encounterGeneration = coopSessionGeneration();
    const encounterSessionEpoch = encounterController?.sessionEpoch ?? -1;
    const encounterBoundaryIsLive = (): boolean =>
      globalScene === encounterScene
      && encounterScene.currentBattle === battle
      && encounterScene.phaseManager.getCurrentPhase() === this
      && getCoopRuntime() === encounterRuntime
      && getCoopController() === encounterController
      && coopSessionGeneration() === encounterGeneration
      && (encounterController == null || encounterController.sessionEpoch === encounterSessionEpoch)
      && this.isEncounterPresentationBoundaryLive();

    // Generate and Init Mystery Encounter
    if (battle.isBattleMysteryEncounter() && !battle.mysteryEncounter) {
      globalScene.executeWithSeedOffset(() => {
        const currentSessionEncounterType = battle.mysteryEncounterType;
        battle.mysteryEncounter = globalScene.getMysteryEncounter(currentSessionEncounterType);
      }, battle.waveIndex * 16);
    }
    const mysteryEncounter = battle.mysteryEncounter;
    if (mysteryEncounter) {
      // If ME has an onInit() function, call it
      // Usually used for calculating rand data before initializing anything visual
      // Also prepopulates any dialogue tokens from encounter/option requirements
      globalScene.executeWithSeedOffset(() => {
        if (mysteryEncounter.onInit) {
          mysteryEncounter.onInit();
        }
        mysteryEncounter.populateDialogueTokensFromRequirements();
      }, battle.waveIndex);

      // Add any special encounter animations to load
      if (mysteryEncounter.encounterAnimations && mysteryEncounter.encounterAnimations.length > 0) {
        loadEnemyAssets.push(
          initEncounterAnims(mysteryEncounter.encounterAnimations).then(() => loadEncounterAnimAssets(true)),
        );
      }

      // Add intro visuals for mystery encounter
      mysteryEncounter.initIntroVisuals();
      globalScene.field.add(mysteryEncounter.introVisuals!);
    }

    let totalBst = 0;

    // Dev scenario builder (staging only): a fully custom enemy party staged
    // for this wave. Consumed ONCE; null in production builds.
    const devEnemyParty = this.loaded ? null : consumePendingDevEnemyParty();

    // Multi-format (triple+): the enemy-gen loop below is bounded by enemyLevels.length, which
    // can come up short of the side's capacity (a small trainer party, or new-battle-phase
    // resizing it for a wild override) - that fielded fewer than 3 foes in-game ("3v1"). Pad
    // it to enemyCapacity here, AFTER all prior resizes, so the field always fills. Binary
    // (cap <= 2) is a no-op.
    const enemyCapacity = battle.arrangement.enemyCapacity;
    if (!this.loaded && battle.enemyLevels && battle.enemyLevels.length < enemyCapacity) {
      const fill = battle.enemyLevels.at(-1) ?? battle.enemyLevels[0] ?? 1;
      while (battle.enemyLevels.length < enemyCapacity) {
        battle.enemyLevels.push(fill);
      }
    }

    battle.enemyLevels?.every((level, e) => {
      if (battle.isBattleMysteryEncounter()) {
        // Skip enemy loading for MEs, those are loaded elsewhere
        return false;
      }
      // The LLM Director can pre-populate battle.enemyParty[e] via
      // NewBattlePhase.applyWildEncounterOverride for narrative-driven
      // wild encounters (a specific Pelipper, a feral Houndoom). When
      // that's the case, skip the standard generation so the LLM's
      // choices stick.
      if (devEnemyParty?.[e] && !this.loaded && !battle.enemyParty[e]) {
        const devEnemy = buildDevEnemy(devEnemyParty[e], level, battle.battleType === BattleType.TRAINER);
        if (devEnemy) {
          battle.enemyParty[e] = devEnemy;
        }
      }
      if (!this.loaded && !battle.enemyParty[e]) {
        if (battle.battleType === BattleType.TRAINER) {
          battle.enemyParty[e] = battle.trainer?.genPartyMember(e)!; // TODO:: is the bang correct here?
        } else {
          let enemySpecies = globalScene.randomSpecies(battle.waveIndex, level, true);
          // Elite Redux: on Elite/Hell the classic final boss (Eternatus) is
          // replaced by a two-phase Cascoon → Primal Cascoon encounter.
          if (battle.isClassicFinalBoss) {
            // Ace keeps the canonical Eternatus finale. Do not fall through to randomSpecies:
            // co-op's double format exposed that fallback as random segmented enemies at wave 200.
            enemySpecies = getErFinalBossSpecies() ?? getPokemonSpecies(SpeciesId.ETERNATUS);
          }
          // If player has golden bug net, rolls 10% chance to replace non-boss wave wild species from the golden bug net bug pool
          if (
            globalScene.findModifier(m => m instanceof BoostBugSpawnModifier)
            && !globalScene.gameMode.isBoss(battle.waveIndex)
            && globalScene.arena.biomeId !== BiomeId.END
            && randSeedInt(10) === 0
          ) {
            enemySpecies = getGoldenBugNetSpecies(level);
          }
          battle.enemyParty[e] = globalScene.addEnemyPokemon(
            enemySpecies,
            level,
            TrainerSlot.NONE,
            !!globalScene.getEncounterBossSegments(battle.waveIndex, level, enemySpecies),
          );
          if (globalScene.currentBattle.isClassicFinalBoss) {
            battle.enemyParty[e].ivs.fill(31);
          }
          globalScene
            .getPlayerParty()
            .slice(0, battle.arrangement.playerCapacity)
            .reverse()
            .forEach(playerPokemon => {
              applyAbAttrs("SyncEncounterNatureAbAttr", { pokemon: playerPokemon, target: battle.enemyParty[e] });
            });
        }
      }
      const enemyPokemon = globalScene.getEnemyParty()[e];
      if (e < battle.arrangement.enemyCapacity) {
        enemyPokemon.setX(-66 + enemyPokemon.getFieldPositionOffset()[0]);
        enemyPokemon.fieldSetup(true);
      }

      if (!this.loaded) {
        globalScene.gameData.setPokemonSeen(
          enemyPokemon,
          true,
          battle.battleType === BattleType.TRAINER
            || battle?.mysteryEncounter?.encounterMode === MysteryEncounterMode.TRAINER_BATTLE,
        );
      }

      if (battle.isClassicFinalBoss && isErFinalBossSpecies(enemyPokemon.species.speciesId)) {
        // Elite Redux final boss: set up phase-1 boss segments the same way
        // the vanilla Eternatus final boss does. On HELL the fight STARTS as
        // PRIMAL Cascoon (form 1) — stage 2 is its Black Shiny form (#349).
        if (getErDifficulty() === "hell") {
          enemyPokemon.formIndex = 1;
          enemyPokemon.updateScale();
        }
        enemyPokemon.setBoss();
        // ER (#380): the finale boss runs the FULL Angel's Wrath kit - all 7
        // transformed moves at once (boss-only extended moveset; the enemy AI
        // iterates the whole moveset, and the Battle Info moves page has a
        // compressed layout for >5 rows). Applies to BOTH stages.
        enemyPokemon.moveset = CASCOON_ANGELS_WRATH_MOVES.map(([, moveId]) => new PokemonMove(moveId));
      } else if (enemyPokemon.species.speciesId === SpeciesId.ETERNATUS) {
        if (battle.isClassicFinalBoss) {
          enemyPokemon.setBoss();
        } else if (!(battle.waveIndex % 1000)) {
          enemyPokemon.formIndex = 1;
          enemyPokemon.updateScale();
        }
      }

      totalBst += enemyPokemon.getSpeciesForm().baseTotal;

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
      for (const move of enemyPokemon.getMoveset()) {
        // Defend against invalid move ids in the moveset (id-map drift).
        const resolved = move.getMove();
        moveset.push(resolved ? resolved.name : `?moveId=${move.moveId}`);
      }

      console.log(
        `Pokemon: ${getPokemonNameWithAffix(enemyPokemon)}`,
        `| Species ID: ${enemyPokemon.species.speciesId}`,
        `| Level: ${enemyPokemon.level}`,
        `| Nature: ${getNatureName(enemyPokemon.nature, true, true, true)}`,
      );
      console.log(`Stats (IVs): ${stats}`);
      console.log(
        `Ability: ${enemyPokemon.getAbility().name}`,
        `| Passive Ability${enemyPokemon.hasPassive() ? "" : " (inactive)"}: ${enemyPokemon.getPassiveAbility().name}`,
        `${enemyPokemon.isBoss() ? `| Boss Bars: ${enemyPokemon.bossSegments}` : ""}`,
      );
      console.log("Moveset:", moveset);
      return true;
    });

    // Co-op HOST (#633): the enemy party's IDENTITY is generated here, but its HELD ITEMS
    // are not attached until generateEnemyModifiers() runs in the loadEnemyAssets.then()
    // block below. So the broadcast (which must carry the host's held items so the guest
    // doesn't roll its own) is deferred to AFTER that generation - see below.

    if (globalScene.getPlayerParty().filter(p => p.isShiny()).length === PLAYER_PARTY_MAX_SIZE) {
      globalScene.validateAchv(achvs.SHINY_PARTY);
    }

    if (battle.battleType === BattleType.TRAINER) {
      loadEnemyAssets.push(battle.trainer?.loadAssets().then(() => battle.trainer?.initSprite())!); // TODO: is this bang correct?
    } else if (battle.isBattleMysteryEncounter()) {
      if (battle.mysteryEncounter?.introVisuals) {
        loadEnemyAssets.push(
          battle.mysteryEncounter.introVisuals
            .loadAssets()
            .then(() => battle.mysteryEncounter!.introVisuals!.initSprite()),
        );
      }
      if (battle.mysteryEncounter?.loadAssets && battle.mysteryEncounter.loadAssets.length > 0) {
        loadEnemyAssets.push(...battle.mysteryEncounter.loadAssets);
      }
      // Load Mystery Encounter Exclamation bubble and sfx
      loadEnemyAssets.push(
        new Promise<void>(resolve => {
          globalScene
            .loadSe("GEN8- Exclaim", "battle_anims", "GEN8- Exclaim.wav")
            .loadImage("encounter_exclaim", "mystery-encounters");
          globalScene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
          if (!globalScene.load.isLoading()) {
            globalScene.load.start();
          }
        }),
      );
    } else {
      const overridedBossSegments = Overrides.ENEMY_HEALTH_SEGMENTS_OVERRIDE > 1;
      // for double battles, reduce the health segments for boss Pokemon unless there is an override
      if (!overridedBossSegments && battle.enemyParty.filter(p => p.isBoss()).length > 1) {
        for (const enemyPokemon of battle.enemyParty) {
          // If the enemy pokemon is a boss and wasn't populated from data source, then update the number of segments
          if (enemyPokemon.isBoss() && !enemyPokemon.isPopulatedFromDataSource) {
            enemyPokemon.setBoss(
              true,
              Math.ceil(enemyPokemon.bossSegments * (enemyPokemon.getSpeciesForm().baseTotal / totalBst)),
            );
            enemyPokemon.initBattleInfo();
          }
        }
      }
    }

    void Promise.all(loadEnemyAssets)
      .then(() => {
        if (!encounterBoundaryIsLive()) {
          return;
        }
        battle.enemyParty.every((enemyPokemon, e) => {
          if (battle.isBattleMysteryEncounter()) {
            return false;
          }
          if (e < battle.arrangement.enemyCapacity) {
            if (battle.battleType === BattleType.WILD) {
              for (const pokemon of globalScene.getField()) {
                applyAbAttrs("PreSummonAbAttr", { pokemon });
              }
              globalScene.field.add(enemyPokemon);
              battle.seenEnemyPartyMemberIds.add(enemyPokemon.id);
              const playerPokemon = globalScene.getPlayerPokemon();
              if (playerPokemon?.isOnField()) {
                globalScene.field.moveBelow(enemyPokemon as Pokemon, playerPokemon);
              }
              enemyPokemon.tint(0, 0.5);
            } else if (battle.battleType === BattleType.TRAINER) {
              enemyPokemon.setVisible(false);
              globalScene.currentBattle.trainer?.tint(0, 0.5);
            }
            // Multi-format: position each on-field enemy by slot (LEFT/CENTER/RIGHT for 3).
            if (battle.arrangement.enemyCapacity > 1) {
              enemyPokemon.setFieldPosition(fieldPositionForSlot(e, battle.arrangement.enemyCapacity));
            }
          }
          return true;
        });

        // Co-op GUEST (#633): when we adopted the host's enemy party verbatim, its held items
        // were already reconstructed from the host's stream (buildCoopEnemy). Rolling our own
        // here would DOUBLE / diverge them (a fresh seeded modifier roll on top of the adopted
        // set), so skip the whole generation block. Solo / host / non-adopt runs are unchanged.
        if (!this.loaded && battle.battleType !== BattleType.MYSTERY_ENCOUNTER && !this.coopAdoptedEnemyParty) {
          // generate modifiers for MEs, overriding prior ones as applicable
          regenerateModifierPoolThresholds(
            globalScene.getEnemyField(),
            battle.battleType === BattleType.TRAINER ? ModifierPoolType.TRAINER : ModifierPoolType.WILD,
          );
          globalScene.generateEnemyModifiers();
          overrideModifiers(false);

          for (const enemy of globalScene.getEnemyField()) {
            overrideHeldItems(enemy, false);
          }
        }

        if (battle.battleType === BattleType.TRAINER && globalScene.currentBattle.trainer) {
          globalScene.currentBattle.trainer.genAI(globalScene.getEnemyParty());
        }

        if (!battle.isBattleMysteryEncounter()) {
          // ER relics (#439): Lookout - queue a scout report of the lead enemy's
          // types before the fight (message-only, no-op unless the relic is held).
          erLookoutPreviewEnemy();
          // Quartermaster - on every 10th wave (skipped on a mid-wave reload so it
          // can't re-copy), the slot 5 mon copies one held item from slot 4 or 6.
          if (!this.loaded) {
            erQuartermasterTick();
            // Covenant of Rest - full team heal every 7th wave (skips the 10-wave
            // cadence so it never double-fires with the normal biome heal).
            erApplyCovenantHeal();
          }
        }

        return globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
          if (!encounterBoundaryIsLive()) {
            return;
          }
          if (this.loaded) {
            this.enterEncounterPresentation();
            globalScene.resetSeed();
          } else {
            // Set weather and terrain before session gets saved
            this.trySetWeatherIfNewBiome();
            this.trySetTerrainIfNewBiome();
            // ER relics (#439/#130): Stormglass - force the player's chosen weather for
            // 5 turns at the start of EVERY battle. Runs AFTER the biome's ambient weather
            // so the chosen weather wins (mirrors #486's carried-weather override). On a
            // reload (this.loaded) the arena weather is restored from the save, so no
            // re-apply is needed. The FIRST time a held Stormglass has no chosen weather
            // yet, enqueue the one-time weather PICKER instead (it prompts, records the
            // pick via setStormglassWeather, then applies it - so the choice takes effect
            // this same battle). Path-independent: this single chokepoint fires no matter
            // how the relic was granted, so no per-grant-site prompt is needed.
            if (
              hasErRelic("stormglass")
              && getStormglassWeather() == null
              && !(isCoopAuthoritativeGuest() && isCoopV2InteractionCutoverActive())
            ) {
              globalScene.phaseManager.unshiftNew("ErStormglassPickerPhase");
            } else {
              erStormglassApplyChosenWeather();
            }
            if (isCoopAuthoritativeGuest()) {
              // The host is the sole persistence owner for a shared run. An authoritative guest deliberately
              // has no host persistence context, so saveAll() would correctly return false; treating that as
              // an account-save failure below resets the guest to Login/SelectGender/Title between waves.
              // Continue the already-adopted encounter locally without writing or broadcasting a launch save.
              globalScene.disableMenu = false;
              this.enterEncounterPresentation();
              globalScene.resetSeed();
            } else if (globalScene.gameMode.isShowdown) {
              // Showdown 1v1 (B7 item 5): a versus match is EPHEMERAL - it NEVER writes a session
              // (no localStorage slot, no cloud `updateAll` push). Skip the per-wave saveAll entirely
              // and boot the encounter directly. The guest already boots from the host's launch
              // snapshot (the `this.loaded` branch above), so only the host reaches here.
              this.broadcastCoopLaunchSnapshot();
              globalScene.disableMenu = false;
              this.enterEncounterPresentation();
              globalScene.resetSeed();
            } else {
              globalScene.gameData
                .saveAll(true, battle.waveIndex % 20 === 1 || (globalScene.lastSavePlayTime ?? 0) >= 1200)
                .then(async success => {
                  if (!encounterBoundaryIsLive()) {
                    coopWarn("launch", "discarding stale first-save continuation after co-op runtime replacement");
                    return;
                  }
                  globalScene.disableMenu = false;
                  if (!success) {
                    return globalScene.reset(true);
                  }
                  const launchConsumption = await globalScene.gameData.consumeCommittedFreshCoopLaunchSession(
                    battle.waveIndex,
                  );
                  if (!encounterBoundaryIsLive()) {
                    coopWarn("launch", "discarding stale launch-commit continuation after co-op runtime replacement");
                    return;
                  }
                  if (launchConsumption.kind === "invalid") {
                    globalScene.disableMenu = false;
                    globalScene.reset(true);
                    return;
                  }
                  this.broadcastCoopLaunchSnapshot(
                    launchConsumption.kind === "committed" ? launchConsumption.sessionJson : undefined,
                  );
                  this.enterEncounterPresentation();
                  globalScene.resetSeed();
                })
                .catch(error => {
                  if (!encounterBoundaryIsLive()) {
                    coopWarn("launch", "discarding stale first-save failure after co-op runtime replacement", error);
                    return;
                  }
                  // Last-resort terminal path: saveAll itself emits the retained launch abort while its
                  // exact claim is still available. Never leave the guest waiting if an unexpected
                  // serializer/storage/API exception escapes the transaction.
                  coopWarn("launch", "first-save transaction threw before launch release", error);
                  globalScene.gameData.cancelPendingFreshCoopSessionSlot();
                  globalScene.disableMenu = false;
                  globalScene.reset(true);
                });
            }
          }
        });
      })
      .catch(error => {
        if (!encounterBoundaryIsLive()) {
          coopWarn("runtime", "discarding stale encounter asset/UI failure after boundary replacement", error);
          return;
        }
        globalScene.disableMenu = false;
        if (encounterRuntime != null && encounterController?.netcodeMode === "authoritative") {
          coopWarn("runtime", "authoritative encounter asset/UI continuation failed closed", error);
          failCoopSharedSession(`Could not finish the authoritative encounter launch at wave ${battle.waveIndex}.`, {
            boundary: "surface",
            reasonCode: "continuation-failed",
            wave: battle.waveIndex,
          });
          return;
        }
        // The old chain rejected without a handler and permanently stranded the phase. Solo retains its
        // existing reset-to-title recovery semantics, but the rejection is now contained.
        coopWarn("runtime", "encounter asset/UI continuation failed; resetting the local run", error);
        globalScene.reset(true);
      });
  }

  private incrementMysteryEncounterChance(): void {
    const { battleType, waveIndex } = globalScene.currentBattle;
    if (
      globalScene.isMysteryEncounterValidForWave(battleType, waveIndex)
      && !globalScene.currentBattle.isBattleMysteryEncounter()
    ) {
      // Increment ME spawn chance if an ME could have spawned but did not
      // Only do this AFTER session has been saved to avoid duplicating increments
      globalScene.mysteryEncounterSaveData.encounterSpawnChance += WEIGHT_INCREMENT_ON_SPAWN_MISS;
    }
  }

  protected doEncounter(): void {
    globalScene.playBgm(undefined, true);
    globalScene.setFieldScale(1);

    for (const pokemon of globalScene.getPlayerParty()) {
      // Currently, a new wave is not considered a new battle if there is no arena reset
      // Therefore, we only reset wave data here
      if (pokemon) {
        pokemon.resetWaveData();
      }
    }

    const enemyField = globalScene.getEnemyField();
    // The enemy trainer is split OUT of this shared slide so it can have its own
    // entrance tween (chosen by the equipped Ghost Trainer FX entrance effect).
    // The remaining field slides the vanilla +/-300 (enemy side +, player side -).
    globalScene.tweens.add({
      targets: [globalScene.arenaEnemy, enemyField, globalScene.arenaPlayer, globalScene.trainer].flat(),
      x: (_target, _key, value, fieldIndex: number) => (fieldIndex < 1 + enemyField.length ? value + 300 : value - 300),
      duration: 2000,
      onComplete: () => {
        if (globalScene.currentBattle.isClassicFinalBoss) {
          this.displayFinalBossDialogue();
        } else {
          this.doEncounterCommon();
        }
      },
    });

    // Enemy trainer's own entrance. Default (and every non-ghost trainer) keeps
    // the vanilla +300 slide; a ghost trainer with an equipped entrance effect
    // arrives differently but always settles at the same final state. Runs as a
    // parallel fire-and-forget tween (the field tween above drives the reveal).
    const enemyTrainer = globalScene.currentBattle.trainer;
    if (enemyTrainer) {
      const arrival = { x: enemyTrainer.x + TRAINER_ENTRANCE_SLIDE_X, y: enemyTrainer.y, alpha: 1 };
      globalScene.tweens.add(
        buildTrainerEntranceTween(enemyTrainer, enemyTrainer.erGhostApproach, arrival, {
          speed: enemyTrainer.erGhostFxSpeed,
          intensity: enemyTrainer.erGhostFxIntensity,
        }),
      );
    }

    const encounterIntroVisuals = globalScene.currentBattle?.mysteryEncounter?.introVisuals;
    if (encounterIntroVisuals) {
      const enterFromRight = encounterIntroVisuals.enterFromRight;
      if (enterFromRight) {
        encounterIntroVisuals.x += 500;
      }
      globalScene.tweens.add({
        targets: encounterIntroVisuals,
        x: enterFromRight ? "-=200" : "+=300",
        duration: 2000,
      });
    }
  }

  getEncounterMessage(): string {
    const enemyField = globalScene.getEnemyField();

    if (globalScene.currentBattle.isClassicFinalBoss) {
      return i18next.t("battle:bossAppeared", {
        bossName: getPokemonNameWithAffix(enemyField[0]),
      });
    }

    if (globalScene.currentBattle.battleType === BattleType.TRAINER) {
      if (globalScene.currentBattle.double) {
        return i18next.t("battle:trainerAppearedDouble", {
          trainerName: globalScene.currentBattle.trainer?.getName(TrainerSlot.NONE, true),
        });
      }
      return i18next.t("battle:trainerAppeared", {
        trainerName: globalScene.currentBattle.trainer?.getName(TrainerSlot.NONE, true),
      });
    }

    return enemyField.length === 1
      ? i18next.t("battle:singleWildAppeared", {
          pokemonName: enemyField[0].getNameToRender(),
        })
      : i18next.t("battle:multiWildAppeared", {
          pokemonName1: enemyField[0].getNameToRender(),
          pokemonName2: enemyField[1].getNameToRender(),
        });
  }

  doEncounterCommon(
    showEncounterMessage = true,
    remainsCurrent: () => boolean = () => true,
    setInteractiveWaiting: (waiting: boolean) => void = () => {},
  ) {
    const isCurrent = (): boolean => {
      try {
        return remainsCurrent();
      } catch {
        return false;
      }
    };
    const beginInteractiveWait = (): void => {
      if (isCurrent()) {
        setInteractiveWaiting(true);
      }
    };
    const finishInteractiveWait = (): boolean => {
      if (!isCurrent()) {
        return false;
      }
      setInteractiveWaiting(false);
      return true;
    };
    if (!isCurrent()) {
      return;
    }
    this.incrementMysteryEncounterChance();

    const enemyField = globalScene.getEnemyField();

    if (globalScene.currentBattle.battleType === BattleType.WILD) {
      for (const enemyPokemon of enemyField) {
        enemyPokemon.untint(100, "Sine.easeOut");
        enemyPokemon.cry();
        enemyPokemon.showInfo();
        if (enemyPokemon.isShiny()) {
          globalScene.validateAchv(achvs.SEE_SHINY);
          erRecordAchievementShinyEncounter();
        }
      }
      globalScene.updateFieldScale();
      if (showEncounterMessage) {
        beginInteractiveWait();
        try {
          globalScene.ui.showText(
            this.getEncounterMessage(),
            null,
            () => {
              if (finishInteractiveWait()) {
                this.end();
              }
            },
            1500,
          );
        } catch (error) {
          setInteractiveWaiting(false);
          throw error;
        }
      } else {
        this.end();
      }
    } else if (globalScene.currentBattle.battleType === BattleType.TRAINER) {
      const trainer = globalScene.currentBattle.trainer;
      trainer?.untint(100, "Sine.easeOut");
      trainer?.playAnim();
      // ER Ghost Trainer FX: now that the trainer is revealed, start its equipped
      // aura overlay (no-op unless the uploader equipped one with showAuraInBattle).
      trainer?.applyErGhostAuraFx();

      const doSummon = () => {
        if (!isCurrent()) {
          return;
        }
        globalScene.currentBattle.started = true;
        globalScene.playBgm(undefined);
        globalScene.pbTray.showPbTray(globalScene.getPlayerParty());
        globalScene.pbTrayEnemy.showPbTray(globalScene.getEnemyParty());
        const doTrainerSummon = () => {
          if (!isCurrent()) {
            return;
          }
          this.hideEnemyTrainer();
          if (isCoopAuthoritativeGuest()) {
            // SummonPhase is intentionally default-denied on the pure renderer. Transitional containment
            // materializes the already-adopted enemy objects and ends the intro with the trainer hidden;
            // no fieldSetup/on-summon/RNG is run locally. The current presenter can still change field
            // membership, so replace this local seat derivation with an explicit host field manifest before
            // calling launch authority complete.
            materializeCoopAdoptedEnemyField();
            this.end();
            return;
          }
          const availablePartyMembers = globalScene.getEnemyParty().filter(p => !p.isFainted()).length;
          // Summon one enemy per on-field slot (1 single / 2 double / 3 triple), so EVERY fielded
          // trainer mon gets a real SummonPhase - its send-out animation/message + on-summon
          // abilities (Intimidate etc.) fire. Was `double`-gated, so a triple's 3rd mon filled the
          // field but never truly summoned. Binary is unchanged (enemyCapacity is 1/2 there).
          const enemyFieldSlots = globalScene.currentBattle.arrangement?.enemyCapacity ?? 1;
          globalScene.phaseManager.unshiftNew("SummonPhase", 0, false);
          for (let i = 1; i < enemyFieldSlots && i < availablePartyMembers; i++) {
            globalScene.phaseManager.unshiftNew("SummonPhase", i, false);
          }
          this.end();
        };
        if (showEncounterMessage) {
          beginInteractiveWait();
          try {
            globalScene.ui.showText(
              this.getEncounterMessage(),
              null,
              () => {
                if (finishInteractiveWait()) {
                  doTrainerSummon();
                }
              },
              1500,
              true,
            );
          } catch (error) {
            setInteractiveWaiting(false);
            throw error;
          }
        } else {
          doTrainerSummon();
        }
      };

      const encounterMessages = trainer?.getEncounterMessages() ?? [];

      if (encounterMessages.length === 0) {
        doSummon();
      } else {
        let message = "";
        globalScene.executeWithSeedOffset(
          () => (message = randSeedItem(encounterMessages)),
          globalScene.currentBattle.waveIndex,
        );
        const showDialogueAndSummon = () => {
          if (!isCurrent()) {
            return;
          }
          beginInteractiveWait();
          try {
            globalScene.ui.showDialogue(message, trainer?.getName(TrainerSlot.NONE, true), null, () => {
              if (!isCurrent()) {
                return;
              }
              void globalScene.charSprite
                .hide()
                .then(() => {
                  if (!isCurrent()) {
                    return;
                  }
                  return globalScene.hideFieldOverlay(250);
                })
                .then(() => {
                  if (finishInteractiveWait()) {
                    doSummon();
                  }
                })
                .catch(error => {
                  if (!isCurrent()) {
                    return;
                  }
                  coopWarn(
                    "runtime",
                    "trainer encounter overlay cleanup failed; continuing current presentation",
                    error,
                  );
                  if (finishInteractiveWait()) {
                    doSummon();
                  }
                });
            });
          } catch (error) {
            setInteractiveWaiting(false);
            throw error;
          }
        };
        if (trainer?.config.hasCharSprite && !globalScene.ui.shouldSkipDialogue(message)) {
          beginInteractiveWait();
          void globalScene
            .showFieldOverlay(500)
            .then(() => {
              if (!isCurrent()) {
                return;
              }
              return globalScene.charSprite.showCharacter(
                trainer.getKey()!,
                getCharVariantFromDialogue(encounterMessages[0]),
              );
            })
            .then(() => {
              if (isCurrent()) {
                showDialogueAndSummon();
              }
            })
            .catch(error => {
              if (!isCurrent()) {
                return;
              }
              coopWarn("runtime", "trainer encounter character intro failed; falling back to dialogue", error);
              showDialogueAndSummon();
            }); // TODO: is this bang correct?
        } else {
          showDialogueAndSummon();
        }
      }
    } else if (globalScene.currentBattle.isBattleMysteryEncounter() && globalScene.currentBattle.mysteryEncounter) {
      const encounter = globalScene.currentBattle.mysteryEncounter;
      const introVisuals = encounter.introVisuals;
      introVisuals?.playAnim();

      if (encounter.onVisualsStart) {
        encounter.onVisualsStart();
      } else if (encounter.spriteConfigs && introVisuals) {
        // If the encounter doesn't have any special visual intro, show sparkle for shiny Pokemon
        introVisuals.playShinySparkles();
      }

      const doEncounter = () => {
        if (!isCurrent()) {
          return;
        }
        const doShowEncounterOptions = () => {
          if (!finishInteractiveWait()) {
            return;
          }
          globalScene.ui.clearText();
          globalScene.ui.getMessageHandler().hideNameText();

          globalScene.phaseManager.unshiftNew("MysteryEncounterPhase");
          this.end();
        };

        const introDialogue = encounter.dialogue.intro;
        if (showEncounterMessage && introDialogue) {
          const FIRST_DIALOGUE_PROMPT_DELAY = 750;
          let i = 0;
          const showNextDialogue = () => {
            if (!isCurrent()) {
              return;
            }
            const nextAction = i === introDialogue.length - 1 ? doShowEncounterOptions : showNextDialogue;
            const dialogue = introDialogue[i];
            const title = getEncounterText(dialogue?.speaker);
            const text = getEncounterText(dialogue.text)!;
            i++;
            if (title) {
              globalScene.ui.showDialogue(text, title, null, nextAction, 0, i === 1 ? FIRST_DIALOGUE_PROMPT_DELAY : 0);
            } else {
              globalScene.ui.showText(text, null, nextAction, i === 1 ? FIRST_DIALOGUE_PROMPT_DELAY : 0, true);
            }
          };

          if (introDialogue.length > 0) {
            beginInteractiveWait();
            showNextDialogue();
          }
        } else {
          doShowEncounterOptions();
        }
      };

      const encounterMessage = i18next.t("battle:mysteryEncounterAppeared");

      if (encounterMessage) {
        doTrainerExclamation();
        beginInteractiveWait();
        try {
          globalScene.ui.showDialogue(encounterMessage, "???", null, () => {
            if (!isCurrent()) {
              return;
            }
            void globalScene.charSprite
              .hide()
              .then(() => {
                if (!isCurrent()) {
                  return;
                }
                return globalScene.hideFieldOverlay(250);
              })
              .then(() => doEncounter())
              .catch(error => {
                if (!isCurrent()) {
                  return;
                }
                coopWarn("runtime", "mystery encounter overlay cleanup failed; continuing current presentation", error);
                doEncounter();
              });
          });
        } catch (error) {
          setInteractiveWaiting(false);
          throw error;
        }
      } else {
        doEncounter();
      }
    }
  }

  /** Subclasses with retained authority may narrow the asynchronous launch/presentation lifetime. */
  protected isEncounterPresentationBoundaryLive(): boolean {
    return true;
  }

  end() {
    const authoritativeGuest = isCoopAuthoritativeGuest();
    if (authoritativeGuest) {
      if (this.coopPresentationEndStarted) {
        return;
      }
      this.coopPresentationEndStarted = true;
    }
    const presentationScene = globalScene;
    const presentationBattle = presentationScene.currentBattle;
    const presentationRuntime = getCoopRuntime();
    const presentationGeneration = coopSessionGeneration();
    const presentationBoundaryIsLive = (): boolean =>
      globalScene === presentationScene
      && presentationScene.currentBattle === presentationBattle
      && getCoopRuntime() === presentationRuntime
      && coopSessionGeneration() === presentationGeneration
      && presentationScene.phaseManager.getCurrentPhase() === this;
    let playerPresentationReady: Promise<number> | null = null;
    const enemyField = globalScene.getEnemyField();

    enemyField.forEach((enemyPokemon, e) => {
      if (enemyPokemon.isShiny(true)) {
        globalScene.phaseManager.unshiftNew("ShinySparklePhase", globalScene.currentBattle.arrangement.enemyOffset + e);
      }
      /** This sets Eternatus' held item to be untransferrable, preventing it from being stolen */
      if (
        enemyPokemon.species.speciesId === SpeciesId.ETERNATUS
        && (globalScene.gameMode.isBattleClassicFinalBoss(globalScene.currentBattle.waveIndex)
          || globalScene.gameMode.isEndlessMajorBoss(globalScene.currentBattle.waveIndex))
      ) {
        const enemyMBH = globalScene.findModifier(
          m => m instanceof TurnHeldItemTransferModifier,
          false,
        ) as TurnHeldItemTransferModifier;
        if (enemyMBH) {
          globalScene.removeModifier(enemyMBH, true);
          enemyMBH.setTransferrableFalse();
          globalScene.addEnemyModifier(enemyMBH);
        }
      }
    });

    if (![BattleType.TRAINER, BattleType.MYSTERY_ENCOUNTER].includes(globalScene.currentBattle.battleType)) {
      const ivScannerModifier = globalScene.findModifier(m => m instanceof IvScannerModifier);
      if (ivScannerModifier) {
        enemyField.map(p => globalScene.phaseManager.pushNew("ScanIvsPhase", p.getBattlerIndex()));
      }
    }

    if (this.loaded) {
      // RELOAD (loaded): the lead is already restored to the field, but the NON-lead field slots
      // are not - on a >1-wide format only the leftmost mon reappeared, so a triple came back
      // "1v3". Place each additional on-field slot DIRECTLY (no re-summon, so on-summon abilities
      // like Intimidate never re-fire). Starts at slot 1 so binary singles are a no-op, and the
      // `isOnField` guard keeps it idempotent for any slot already present (e.g. a restored double).
      const playerCapacity = globalScene.currentBattle.arrangement.playerCapacity;
      const party = globalScene.getPlayerParty();
      // Launch/resume snapshots are captured before the host's summon chain. That is true for classic co-op
      // and Showdown: a versus guest also starts with no local lead in the field container. An authoritative
      // renderer must never repair this by running SummonPhase/ToggleDoublePositionPhase because their tails
      // derive abilities, hazards and battle RNG. Materialize the already-adopted active seats for every
      // authoritative guest; the versus launch ingress has already flipped the parties into local orientation.
      if (authoritativeGuest) {
        playerPresentationReady = materializeCoopLoadedPlayerFieldReady(presentationBoundaryIsLive);
      } else {
        for (let i = 1; i < playerCapacity && i < party.length; i++) {
          const pokemon = party[i];
          if (!pokemon || pokemon.isFainted() || pokemon.isOnField()) {
            continue;
          }
          globalScene.field.add(pokemon);
          pokemon.fieldSetup();
          pokemon.setFieldPosition(fieldPositionForSlot(i, playerCapacity));
          pokemon.setVisible(true);
          pokemon.showInfo();
        }
      }
    } else if (authoritativeGuest && !isVersusSession()) {
      // Later waves enter with `loaded=false`, but the replayable encounter carrier has already installed the
      // host's party/topology. Re-running the ordinary summon/recenter/return/check-switch branch creates
      // renderer-denied structural phases (the exact two ToggleDoublePositionPhase leaks in the three-wave
      // journey) and can derive local mechanics. Reassert only the adopted co-op field projection. Showdown
      // keeps its fresh-versus intro path; its loaded launch still uses the presentation-only branch above.
      playerPresentationReady = materializeCoopLoadedPlayerFieldReady(presentationBoundaryIsLive);
    } else {
      const availablePartyMembers = globalScene.getPokemonAllowedInBattle();
      // Multi-format: the local player side's capacity drives how many leads summon /
      // get a switch prompt. Binary -> 1 (single) or 2 (double); triple -> 3.
      const playerCapacity = globalScene.currentBattle.arrangement.playerCapacity;
      const multiFormat = playerCapacity > 1;

      if (!availablePartyMembers[0].isOnField()) {
        globalScene.phaseManager.pushNew("SummonPhase", 0);
      }

      // Multi-format transition: a mon still on the field from a WIDER previous format (a triple
      // collapsing to a single/double on this wave) sits on a slot the new format cannot hold -
      // recall EACH such orphaned slot, or its back sprite + info bar linger into this intro
      // (report #2: player slots 1-2 "don't move away" after a triple). This generalizes the old
      // hardcoded `ReturnPhase(1)` (which only ever recalled the doubles-era 2nd slot).
      // `getPlayerField()`/`getFieldIndex()` are sized by the NEW (narrower) capacity, so the
      // orphans are invisible to them - enumerate the PARTY by index. `ReturnPhase` is
      // party-indexed (PartyMemberPokemonPhase.getPokemon -> party[i]), so it recalls the correct
      // mon regardless of the new arrangement.
      const party = globalScene.getPlayerParty();
      for (let i = playerCapacity; i < party.length; i++) {
        if (party[i]?.isOnField()) {
          globalScene.phaseManager.pushNew("ReturnPhase", i);
        }
      }

      if (multiFormat) {
        if (availablePartyMembers.length > 1) {
          globalScene.phaseManager.pushNew("ToggleDoublePositionPhase", true);
          // Summon every additional on-field slot the side can hold (2nd, 3rd, ...).
          for (let i = 1; i < playerCapacity; i++) {
            if (availablePartyMembers.length > i && !availablePartyMembers[i].isOnField()) {
              globalScene.phaseManager.pushNew("SummonPhase", i);
            }
          }
        }
      } else {
        globalScene.phaseManager.pushNew("ToggleDoublePositionPhase", false);
      }

      if (
        globalScene.currentBattle.battleType !== BattleType.TRAINER
        && (globalScene.currentBattle.waveIndex > 1 || !globalScene.gameMode.isDaily)
        && availablePartyMembers.length > playerCapacity
      ) {
        for (let i = 0; i < playerCapacity; i++) {
          globalScene.phaseManager.pushNew("CheckSwitchPhase", i, multiFormat);
        }
      }
    }
    const tutorialReady = handleTutorial(Tutorial.ACCESS_MENU);
    if (playerPresentationReady == null) {
      tutorialReady.then(() => this.completeEncounterEnd());
    } else {
      void Promise.all([tutorialReady, playerPresentationReady])
        .then(() => {
          if (presentationBoundaryIsLive()) {
            this.completeEncounterEnd();
          }
        })
        .catch(error => {
          if (!presentationBoundaryIsLive()) {
            coopWarn("renderer", "ignored superseded authoritative launch presentation failure", error);
            return;
          }
          coopWarn("renderer", "authoritative player launch presentation failed closed", error);
          failCoopSharedSession("Could not render both co-op player battlers before opening commands.", {
            boundary: "surface",
            reasonCode: "continuation-failed",
            wave: presentationBattle?.waveIndex,
          });
        });
    }

    // InitEncounterPhase derives PostSummon effects. The authoritative guest rendered the adopted launch
    // above and must wait for host state instead; constructing it only trips the default-deny renderer gate.
    if (!authoritativeGuest) {
      globalScene.phaseManager.pushNew("InitEncounterPhase");
    }
  }

  /** Actual queue-shift seam, overridable by exact authoritative boundary subclasses. */
  protected completeEncounterEnd(): void {
    super.end();
  }

  protected displayFinalBossDialogue(): void {
    const { gameData, ui } = globalScene;
    const enemy = globalScene.getEnemyPokemon();

    ui.showText(
      this.getEncounterMessage(),
      null,
      () => {
        const localizationKey = "battleSpecDialogue:encounter";
        if (ui.shouldSkipDialogue(localizationKey)) {
          // Logging mirrors logging found in dialogue-ui-handler
          console.log(`Dialogue ${localizationKey} skipped`);
          this.doEncounterCommon(false);
        } else {
          const count = 5643853 + gameData.gameStats.classicSessionsPlayed;
          // The line below checks if an English ordinal is necessary or not based on whether an entry for encounterLocalizationKey exists in the language or not.
          const ordinalUsed =
            !i18next.exists(localizationKey, { fallbackLng: [] }) || i18next.resolvedLanguage === "en"
              ? i18next.t("battleSpecDialogue:key", {
                  count,
                  ordinal: true,
                })
              : "";
          const cycleCount = count.toLocaleString() + ordinalUsed;
          const cycleCountNoOrdinal = count.toLocaleString();
          const genderIndex = gameData.gender ?? PlayerGender.UNSET;
          const genderStr = PlayerGender[genderIndex].toLowerCase();
          const encounterDialogue = i18next.t(localizationKey, {
            context: genderStr,
            cycleCount,
            cycleCountNoOrdinal,
          });
          if (!gameData.getSeenDialogues()[localizationKey]) {
            gameData.saveSeenDialogue(localizationKey);
          }
          ui.showDialogue(encounterDialogue, enemy?.species.name, null, () => {
            this.doEncounterCommon(false);
          });
        }
      },
      1500,
      true,
    );
  }

  /**
   * Set biome weather if and only if this encounter is the start of a new biome.
   * @remarks
   * By using function overrides, this should happen if and only if this phase
   * is exactly a `NewBiomeEncounterPhase` or an `EncounterPhase` (to account for
   * Wave 1 of a Daily Run), but NOT `NextEncounterPhase` (which starts the next
   * wave in the same biome).
   */
  protected trySetWeatherIfNewBiome(): void {
    // ER biome identity (#439 §3): some biomes FORCE a baseline weather instead
    // of rolling the vanilla pool (e.g. Desert/Badlands sandstorm, Ice Cave snow,
    // Graveyard fog). No `user` -> permanent (turnsLeft 0), so it persists across
    // the biome's waves like any ambient biome weather.
    // ER (#486) The Storm: a weather the player chose to carry into THIS biome
    // overrides the biome's own ambient, applied once on entry. null = none.
    const carried = consumeErCarriedWeather();
    if (carried != null) {
      globalScene.arena.trySetWeather(carried as WeatherType);
      return;
    }
    const forced = erBiomeForcedWeather(globalScene.arena.biomeId);
    if (forced != null) {
      globalScene.arena.trySetWeather(forced);
      return;
    }
    globalScene.arena.setBiomeWeather();
  }

  /**
   * Set biome terrain if and only if this encounter is the start of a new biome.
   * @remarks
   * By using function overrides, this should happen if and only if this phase
   * is exactly a `NewBiomeEncounterPhase` or an `EncounterPhase` (to account for
   * Wave 1 of a Daily Run), but NOT `NextEncounterPhase` (which starts the next
   * wave in the same biome).
   */
  protected trySetTerrainIfNewBiome(): void {
    // ER biome identity (#439 §3): vanilla terrainPools are all empty, so biome
    // terrain only exists via this override (Power Plant electric, Grass/Jungle
    // grassy, Space psychic). turnsOverride 0 -> permanent, persists across waves.
    const forced = erBiomeForcedTerrain(globalScene.arena.biomeId);
    if (forced != null) {
      globalScene.arena.trySetTerrain(forced, false, undefined, 0);
      return;
    }
    globalScene.arena.setBiomeTerrain();
  }
}
