import { type StoryBible, validateStoryBible } from "#data/llm-director/beat-schema";
import type { DirectorClient } from "#system/llm-director/director-client";
import {
  logBibleParsed,
  logBibleRequest,
  logBibleResponse,
  logBibleValidationFail,
} from "#system/llm-director/director-log";
import type { LLMDirectorState } from "#system/llm-director/director-state";

/**
 * Bible refinement: a periodic re-check that lets a different model
 * read the original bible + recent player decisions + current state and
 * propose a refined bible that stays consistent with what's happened so
 * far in the run.
 *
 * Why a different model: the primary bible model (DeepSeek) is fast and
 * structured, great for the initial generation. The refinement uses a
 * model with a different strength profile (Kimi for prose voice; MiniMax
 * for steady reasoning) so the bible's continued narration benefits from
 * a second perspective rather than the same model retreading its own
 * output.
 *
 * Trigger cadence: act boundaries by default. The director runtime calls
 * `refineStoryBible` whenever the player enters a new act's wave range.
 * Refinements are append-only: factions/NPCs from the original bible
 * stay (their memoryKeys are referenced by past beats); refinements may
 * adjust act summaries, faction descriptions, NPC dispositions, and the
 * blurb. Acts' wave ranges are LOCKED — changing them mid-run would
 * break beat history references.
 *
 * Validation failures fall back to the unrefined bible so the run
 * never breaks; the refinement is opportunistic, not mandatory.
 */

const REFINE_SYSTEM_PROMPT = `You are the Director's editor for an in-progress 200-wave Pokemon roguelike run. The original story bible has been driving beats so far; the player has made choices that have shifted alignment, faction reputations, and flagged story state. Your job is to read what happened and re-emit a REFINED version of the same bible that stays consistent with the run-so-far.

LOCKED FIELDS (do NOT change):
- themeName
- acts[].name, acts[].waveStart, acts[].waveEnd, acts[].biomeId — past beats reference these
- factions[].name, recurringNPCs[].memoryKey — past beats reference these (you may rename a faction's display "name" only if the player's choices clearly justify it; the memoryKey-equivalent is the position in the array, so don't reorder)
- moralSpectrum.goodLabel, moralSpectrum.evilLabel

REFINABLE FIELDS:
- blurb — update to reflect where the run actually is now
- playerIntro, openingScene — usually leave alone unless badly off-tone
- tonalKeywords — adjust if the run has clearly drifted (e.g., player has consistently picked "ruthless" options on a "wholesome" seed)
- acts[].summary — may sharpen or shift focus based on what happened
- factions[].description — update if the player's actions have reshaped the faction
- factions[].initialRep — leave alone (initial means initial; current rep is in state.factionRep)
- recurringNPCs[].role — may sharpen based on how the NPC has appeared in beats
- recurringNPCs[].initialDisposition — leave alone

Output the FULL refined bible as STRICT JSON matching the original schema. Same shape, no added or removed fields. No prose, no markdown.`;

export interface RefineStoryBibleOptions {
  bible: StoryBible;
  state: LLMDirectorState;
  /** Default deepseek/deepseek-v4-flash so refinement is fast even on slow primary. */
  model?: string;
  /** Default 60s — refinement is opportunistic, don't block runs on slow responses. */
  timeoutMs?: number;
  /** Default 2 — fewer than bible-gen because we tolerate falling back to unrefined. */
  maxRetries?: number;
}

const DEFAULT_REFINE_MODEL = "deepseek/deepseek-v4-flash";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;

const FENCE_REGEX = /^```(?:json)?\s*([\s\S]*?)\s*```$/m;

function parseLooseJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = FENCE_REGEX.exec(trimmed);
  const raw = fenced ? fenced[1] : trimmed;
  return JSON.parse(raw);
}

/**
 * Run a refinement pass over the bible. Returns the refined bible on
 * success, or `null` on any failure (caller keeps using the original).
 *
 * Locked-field invariants are enforced post-validation: if the model
 * accidentally changes act wave ranges, faction order, or memoryKeys,
 * the refinement is rejected.
 */
export async function refineStoryBible(
  client: DirectorClient,
  opts: RefineStoryBibleOptions,
): Promise<StoryBible | null> {
  const model = opts.model ?? DEFAULT_REFINE_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;

  const userContext = {
    originalBible: opts.bible,
    runState: {
      alignment: opts.state.alignment,
      factionRep: opts.state.factionRep,
      flags: opts.state.flags,
      npcMemory: opts.state.npcMemory,
    },
    recentBeats: opts.state.beatHistory.slice(-15).map(entry => {
      const beat = entry.verbatim;
      const introText = beat ? (beat as { introText?: string }).introText : (entry.digest ?? "");
      const speakerName = beat?.type === "dialogue_choice" ? beat.speaker?.name : undefined;
      return {
        wave: entry.wave,
        type: entry.beatType,
        digest: speakerName ? `${speakerName}: ${introText}` : introText,
        playerChoice: entry.playerChoice
          ? {
              label: entry.playerChoice.optionLabel,
              alignment: entry.playerChoice.consequenceApplied.alignment ?? 0,
              factionRep: entry.playerChoice.consequenceApplied.factionRep ?? {},
            }
          : null,
      };
    }),
  };

  logBibleRequest(`refinement: ${opts.bible.themeName}`);

  let lastError = "";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let result: { content: string; latencyMs: number };
    try {
      result = await client.complete({
        model,
        messages: [
          { role: "system", content: REFINE_SYSTEM_PROMPT },
          {
            role: "user",
            content:
              attempt === 1
                ? `${JSON.stringify(userContext, null, 2)}\n\nProduce the refined bible as JSON.`
                : `${JSON.stringify(userContext, null, 2)}\n\nYour previous output failed: ${lastError}\nRe-emit valid JSON.`,
          },
        ],
        timeoutMs,
        responseFormat: "json_object",
        maxTokens: 2500,
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logBibleValidationFail(`refine: ${lastError}`, attempt);
      continue;
    }
    logBibleResponse(result.content, result.latencyMs);

    let parsed: unknown;
    try {
      parsed = parseLooseJson(result.content);
    } catch (err) {
      lastError = `JSON parse error: ${err instanceof Error ? err.message : String(err)}`;
      logBibleValidationFail(`refine: ${lastError}`, attempt);
      continue;
    }
    const validation = validateStoryBible(parsed);
    if (!validation.ok) {
      lastError = validation.error;
      logBibleValidationFail(`refine: ${lastError}`, attempt);
      continue;
    }
    const refined = parsed as StoryBible;
    const lockedErr = checkLockedInvariants(opts.bible, refined);
    if (lockedErr) {
      lastError = lockedErr;
      logBibleValidationFail(`refine locked-field: ${lockedErr}`, attempt);
      continue;
    }
    logBibleParsed({ refined: true, themeName: refined.themeName });
    return refined;
  }
  // Refinement is opportunistic — caller keeps the original bible.
  console.warn(`[llm-director] bible refinement failed (${maxRetries} attempts): ${lastError}; keeping original`);
  return null;
}

/**
 * Verify the refined bible didn't change locked structural fields. Past
 * beats reference act wave ranges and NPC memoryKeys — changing these
 * mid-run would break consistency.
 */
function checkLockedInvariants(original: StoryBible, refined: StoryBible): string | null {
  if (refined.themeName !== original.themeName) {
    return "themeName changed";
  }
  if (refined.acts.length !== original.acts.length) {
    return `act count changed (${original.acts.length} -> ${refined.acts.length})`;
  }
  for (let i = 0; i < original.acts.length; i++) {
    const a = original.acts[i];
    const b = refined.acts[i];
    if (a.name !== b.name) {
      return `acts[${i}].name changed`;
    }
    if (a.waveStart !== b.waveStart || a.waveEnd !== b.waveEnd) {
      return `acts[${i}] wave range changed`;
    }
    if (a.biomeId !== b.biomeId) {
      return `acts[${i}].biomeId changed`;
    }
  }
  if (refined.recurringNPCs.length !== original.recurringNPCs.length) {
    return "NPC count changed";
  }
  for (let i = 0; i < original.recurringNPCs.length; i++) {
    if (refined.recurringNPCs[i].memoryKey !== original.recurringNPCs[i].memoryKey) {
      return `NPC[${i}] memoryKey changed`;
    }
  }
  if (refined.factions.length !== original.factions.length) {
    return "faction count changed";
  }
  if (
    refined.moralSpectrum.goodLabel !== original.moralSpectrum.goodLabel
    || refined.moralSpectrum.evilLabel !== original.moralSpectrum.evilLabel
  ) {
    return "moralSpectrum labels changed";
  }
  return null;
}
