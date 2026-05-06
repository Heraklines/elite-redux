import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import type { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { UiMode } from "#enums/ui-mode";
import { buildContextEnvelope, type EnvelopePartyMember } from "#system/llm-director/context-envelope";
import { logBiomeSwitch, logFallbackToClassic } from "#system/llm-director/director-log";
import {
  clearPendingBible,
  ensurePendingBible,
  getDirectorRuntime,
  getPendingBible,
} from "#system/llm-director/director-runtime";
import { generateBeat } from "#system/llm-director/generate-beat";
import { generateStoryBible } from "#system/llm-director/generate-story-bible";
import i18next from "i18next";

/**
 * Wave-1 beat takes longer than mid-run beats: queue.kickOff(1) only just
 * fired (vs. mid-run waves where the beat has been pre-generating during
 * the prior 2 waves of battles). Give it a generous 90s window so a slow
 * NanoGPT response doesn't fall through to the filler beat on wave 1.
 */
const FIRST_BEAT_TAKE_TIMEOUT_MS = 90_000;

/**
 * Awaits the pending story-bible generation kicked off by
 * `LLMDirectorStartPhase`, applies it to game state, and kicks off the
 * first Director beat (wave 3 by default).
 *
 * If the pending bible is already resolved (because LLM generation finished
 * during starter selection) this phase ends in <50ms with no overlay. If
 * the bible is still in flight, the phase shows a "Preparing your story…"
 * overlay until generation completes.
 *
 * On any failure (missing env config, generation error) the run silently
 * falls back to Classic mode — the player still gets a playable run.
 *
 * Cache: clears the pending bible once consumed, so the next Director pick
 * rolls a fresh seed.
 */
export class LLMDirectorBiblePhase extends Phase {
  public readonly phaseName = "LLMDirectorBiblePhase";

  /** Wave for the first generated beat. v3 default = 1 (forced wave-1
   * mystery event so testing/playtest sees the system engage immediately). */
  private readonly firstBeatWave: number;

  public constructor(firstBeatWave = 1) {
    super();
    this.firstBeatWave = firstBeatWave;
  }

  public override async start(): Promise<void> {
    super.start();

    const runtime = getDirectorRuntime();
    if (!runtime) {
      logFallbackToClassic("missing-env-config (VITE_NANOGPT_API_KEY or VITE_NANOGPT_BASE_URL)");
      this.fallbackToClassic();
      return;
    }

    // If StartPhase didn't run (or we lost the entry to a HMR reset), make
    // sure a generation is in flight before we await.
    let pending = getPendingBible();
    if (!pending) {
      pending = ensurePendingBible(seed => generateStoryBible(runtime.client, { seedText: seed.text }));
    }

    // Only show the overlay if the bible isn't already resolved. If the
    // player took >17s on starter select, no overlay flashes at all.
    const needsOverlay = !pending.resolved;
    if (needsOverlay) {
      this.showPreparingOverlay();
    }

    let success = false;
    try {
      const bible = pending.resolved ?? (await pending.promise);
      const state = globalScene.gameData.llmDirectorState;
      state.storyBible = bible;
      // Initialize faction reputations from the bible's seeded values so the
      // first beat's prompt is grounded.
      for (const faction of bible.factions) {
        if (state.factionRep[faction.name] === undefined) {
          state.factionRep[faction.name] = faction.initialRep;
        }
      }
      // Wire the queue to the real beat generator now that we have a bible.
      runtime.queue.reset();
      runtime.queue.setGenerator(wave => this.runBeatGeneration(wave));
      runtime.queue.kickOff(this.firstBeatWave);
      success = true;
      // Cache consumed — next Director pick rolls a fresh seed.
      clearPendingBible();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logFallbackToClassic(`bible-gen-failed: ${msg}`);
      // Bad cache; clear so the next attempt isn't poisoned by the same error.
      clearPendingBible();
    }

    if (success) {
      this.renderIntroThenEnd();
    } else {
      this.fallbackToClassic();
    }
  }

  /**
   * Show the player intro + opening scene from the freshly-loaded bible
   * before the first wave's encounter phase fires.
   *
   * The previous version of this code rendered text but the player got
   * stuck because Enter wasn't routed to the message handler. The active
   * UiMode after SelectStarterPhase ends is whatever was left over —
   * not MESSAGE — so the message handler renders the text but doesn't
   * receive ACTION input. Calling `setMode(UiMode.MESSAGE)` BEFORE
   * queueing makes the message handler the active input handler so
   * Enter advances pages.
   */
  private renderIntroThenEnd(): void {
    const bible = globalScene.gameData.llmDirectorState.storyBible;
    if (!bible) {
      this.end();
      return;
    }
    const pages: string[] = [];
    if (bible.themeName) {
      pages.push(`— ${bible.themeName} —`);
    }
    const intro = clip(bible.playerIntro, 120);
    const scene = clip(bible.openingScene, 120);
    if (intro) {
      pages.push(intro);
    }
    if (scene) {
      pages.push(scene);
    }
    if (pages.length === 0) {
      this.end();
      return;
    }
    // Route input to the message handler — the missing piece that was
    // breaking Enter-to-advance. setMode is sync; subsequent MessagePhases
    // queued below will run with MESSAGE as the active mode.
    void globalScene.ui.setMode(UiMode.MESSAGE);
    // Each unshift puts the new phase at the FRONT of the queue. Doing them
    // in this order produces final queue:
    //   [theme, intro, scene, SwitchBiome, BeatPhase(wave 1), ...rest]
    // i.e. messages run first, then biome swap, then the forced wave-1
    // mystery beat, THEN the wave-1 EncounterPhase that was already queued
    // by the run start. So the player reads the intro, lands in the right
    // biome, makes a story decision, and only then walks into wave 1.
    globalScene.phaseManager.unshiftNew("LLMDirectorBeatPhase", this.firstBeatWave, FIRST_BEAT_TAKE_TIMEOUT_MS);
    const firstAct = globalScene.gameData.llmDirectorState.storyBible?.acts[0];
    if (firstAct && typeof firstAct.biomeId === "number" && globalScene.arena?.biomeId !== firstAct.biomeId) {
      logBiomeSwitch("bible-first-act", globalScene.arena?.biomeId, firstAct.biomeId, firstAct.name);
      globalScene.phaseManager.unshiftNew("SwitchBiomePhase", firstAct.biomeId as BiomeId);
    }
    // queueMessage unshifts (adds to front), so iterating in reverse here
    // means the messages run in source order: theme → intro → scene.
    for (let i = pages.length - 1; i >= 0; i--) {
      globalScene.phaseManager.queueMessage(pages[i], null, true);
    }
    this.end();
  }

  /**
   * Build a context envelope for `wave` and run the beat generator. Pulls
   * party state from `globalScene` lazily so each kick-off picks up the
   * latest party (after evolutions, faints, etc.).
   */
  private async runBeatGeneration(wave: number) {
    const runtime = getDirectorRuntime();
    if (!runtime) {
      throw new Error("DirectorRuntime unavailable mid-run");
    }
    const envelope = buildContextEnvelope({
      state: globalScene.gameData.llmDirectorState,
      playerParty: snapshotPlayerParty(),
      currentWaveIndex: wave,
    });
    return generateBeat(runtime.client, { envelope });
  }

  private showPreparingOverlay(): void {
    globalScene.ui.showText(i18next.t("llmDirector:preparingStory"), null, undefined, null, false);
  }

  private fallbackToClassic(): void {
    globalScene.ui.showText(
      i18next.t("llmDirector:directorUnavailable"),
      null,
      () => {
        globalScene.gameMode = getGameMode(GameModes.CLASSIC);
        this.end();
      },
      null,
      true,
    );
  }
}

/** Hard cap for the intro/scene strings — defense-in-depth. */
function clip(text: string | undefined, max: number): string {
  if (!text) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  const head = text.slice(0, max);
  const lastSentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  return lastSentence > max * 0.6 ? head.slice(0, lastSentence + 1) : `${head.trimEnd()}…`;
}

/**
 * Read-only snapshot of the player's party for the envelope.
 */
function snapshotPlayerParty(): EnvelopePartyMember[] {
  const party = globalScene.getPlayerParty?.() ?? [];
  return party.map(p => ({
    species: p.species?.name ?? "unknown",
    level: p.level ?? 1,
    types: (p.getTypes?.() ?? []).map(String),
    ability: p.getAbility?.()?.name ?? "unknown",
    moves: (p.getMoveset?.() ?? []).filter(Boolean).map(m => m?.getName?.() ?? "unknown"),
    hpPct: p.getHpRatio ? p.getHpRatio() : 1,
  }));
}
