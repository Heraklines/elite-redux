import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { GameModes } from "#enums/game-modes";
import { buildContextEnvelope, type EnvelopePartyMember } from "#system/llm-director/context-envelope";
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

  /** Wave for the first generated beat. Director cadence is every 3 waves. */
  private readonly firstBeatWave: number;

  public constructor(firstBeatWave = 3) {
    super();
    this.firstBeatWave = firstBeatWave;
  }

  public override async start(): Promise<void> {
    super.start();

    const runtime = getDirectorRuntime();
    if (!runtime) {
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
      console.warn("[llm-director] Story bible generation failed:", err instanceof Error ? err.message : String(err));
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
   * before the first wave's encounter phase fires. This grounds the player
   * (who am I, where am I) so subsequent beats land in context.
   *
   * Why chain `showText` per page instead of one big call: PokéRogue's
   * `showText` does NOT auto-paginate text that exceeds the dialog box
   * height — it just renders into the box, overflows, and the "▼" advance
   * prompt disappears, leaving the player stuck. Each call below shows ONE
   * bounded page, waits for the player to advance, and chains to the next.
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
    // 120 chars per page is the conservative ceiling for the standard
    // PokéRogue text box at default font scale. Going over starts wrapping
    // off the bottom.
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
    this.showPageChain(pages, 0);
  }

  private showPageChain(pages: string[], index: number): void {
    if (index >= pages.length) {
      this.end();
      return;
    }
    globalScene.ui.showText(pages[index], null, () => this.showPageChain(pages, index + 1), null, true);
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
