import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import type { ThemeSeed } from "#data/llm-director/theme-seeds";
import { GameModes } from "#enums/game-modes";
import { buildContextEnvelope, type EnvelopePartyMember } from "#system/llm-director/context-envelope";
import { getDirectorRuntime } from "#system/llm-director/director-runtime";
import { generateBeat } from "#system/llm-director/generate-beat";
import { generateStoryBible } from "#system/llm-director/generate-story-bible";
import i18next from "i18next";

/**
 * Generates the run's story bible from the player-picked theme seed, then
 * kicks off pre-generation of the first Director beat (wave 3 by default).
 *
 * On any failure (missing env config, network error, validation exhausted)
 * the run silently falls back to Classic mode rather than blocking — the
 * player still gets a playable run.
 *
 * The phase shows a brief "Preparing your story…" overlay while the LLM
 * call is in flight. Player input during this phase is intentionally
 * ignored so the phase advances cleanly.
 */
export class LLMDirectorBiblePhase extends Phase {
  public readonly phaseName = "LLMDirectorBiblePhase";

  private readonly seed: ThemeSeed;
  /** Wave for the first generated beat. Director cadence is every 3 waves. */
  private readonly firstBeatWave: number;

  public constructor(seed: ThemeSeed, firstBeatWave = 3) {
    super();
    this.seed = seed;
    this.firstBeatWave = firstBeatWave;
  }

  public override async start(): Promise<void> {
    super.start();

    const runtime = getDirectorRuntime();
    if (!runtime) {
      this.fallbackToClassic();
      return;
    }

    this.showPreparingOverlay();

    let success = false;
    try {
      const bible = await generateStoryBible(runtime.client, { seedText: this.seed.text });
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
    } catch (err) {
      // Don't include any auth/key material in the log surface. The error
      // message from DirectorClient already redacts the request body.
      console.warn("[llm-director] Story bible generation failed:", err instanceof Error ? err.message : String(err));
    }

    if (success) {
      this.end();
    } else {
      this.fallbackToClassic();
    }
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
    // Use the message handler to surface the loading text. The phase ends
    // before the player needs to dismiss it — no input handling required.
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

/**
 * Read-only snapshot of the player's party for the envelope. Names use the
 * species name verbatim; types/abilities/moves are coerced to strings since
 * the LLM consumes them as descriptive text.
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
