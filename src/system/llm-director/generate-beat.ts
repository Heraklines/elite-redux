import { type Beat, validateBeat } from "#data/llm-director/beat-schema";
import { BEAT_PROSE_SYSTEM_PROMPT, BEAT_SKELETON_SYSTEM_PROMPT } from "#data/llm-director/system-prompts";
import type { ContextEnvelope } from "#system/llm-director/context-envelope";
import type { DirectorClient } from "#system/llm-director/director-client";
import {
  logBeatParsed,
  logBeatRequest,
  logBeatResponse,
  logBeatValidationFail,
} from "#system/llm-director/director-log";

/**
 * Two-phase beat generation:
 *
 *   1. Skeleton — DeepSeek emits structured JSON. This is the
 *      authoritative pass for trainer composition, choice trees, etc.
 *   2. Prose (optional) — Kimi rewrites the human-facing text fields with
 *      better voice. v1 ships skeleton-only; the prose phase is wired but only
 *      runs when `withProsePass: true`.
 *
 * Schema validation on every response. On persistent failure we synthesize a
 * `narrative_only` fallback so the run never blocks.
 */

export interface GenerateBeatOptions {
  envelope: ContextEnvelope;
  /**
   * Primary skeleton model. Default minimax/minimax-latest (~24s on a real
   * beat prompt; richer prose, broader variety vs deepseek-flash which
   * over-indexes on stock phrasings and item picks).
   */
  skeletonModel?: string;
  /**
   * Ordered fallback chain. Each is tried in order on network/timeout
   * errors. Validation errors break out — they're model-agnostic.
   */
  fallbackSkeletonModels?: readonly string[];
  /** Defaults to moonshotai/kimi-k2.6 (better prose voice, used only when withProsePass is on). */
  proseModel?: string;
  /** Default 3. */
  maxRetries?: number;
  /** Default 90s — comfortable for the slower-but-better primary; pre-gen
   *  buffer is 3 waves ahead so up to 90s feels instant to the player. */
  timeoutMs?: number;
  /** v1 default false; turn on once costs are characterized. */
  withProsePass?: boolean;
}

/**
 * Beat-generation model chain. Probed against a real beat prompt:
 *
 *   minimax/minimax-latest      : ~24s, varied prose + items, schema-clean ✓
 *   deepseek/deepseek-v4-flash  : ~5s, but heavy repetition across beats
 *   zai-org/glm-latest          : works but slow (~90s)
 *   moonshotai/kimi-k2.6        : hangs on beat prompts (>150s no response) ✗
 *
 * MiniMax primary for quality. DeepSeek-flash fallback for the hot path
 * if MiniMax is unavailable / hangs. GLM as last resort.
 */
const DEFAULT_SKELETON_MODEL = "minimax/minimax-latest";
const DEFAULT_SKELETON_FALLBACK_CHAIN: readonly string[] = ["deepseek/deepseek-v4-flash", "zai-org/glm-latest"];
const DEFAULT_PROSE_MODEL = "moonshotai/kimi-k2.6";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 90_000;

const FENCE_REGEX = /^```(?:json)?\s*([\s\S]*?)\s*```$/m;

function parseLooseJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = FENCE_REGEX.exec(trimmed);
  const raw = fenced ? fenced[1] : trimmed;
  return JSON.parse(raw);
}

function buildUserPrompt(envelope: ContextEnvelope, prevError?: string): string {
  const base = `Envelope:\n${JSON.stringify(envelope, null, 2)}\n\nGenerate ONE beat as JSON.`;
  if (prevError) {
    return `${base}\n\nYour previous output failed validation: ${prevError}\nRe-emit valid JSON.`;
  }
  return base;
}

function fallbackBeat(envelope: ContextEnvelope): Beat {
  return {
    beatId: `fallback-${envelope.currentWaveIndex}-${Date.now()}`,
    type: "narrative_only",
    introText: "The road continues.",
    bodyText: "You press on, the silence between things louder than usual.",
  };
}

async function runSkeletonPhase(
  client: DirectorClient,
  envelope: ContextEnvelope,
  primaryModel: string,
  fallbackModels: readonly string[],
  maxRetries: number,
  timeoutMs: number,
): Promise<Beat | null> {
  const wave = envelope.currentWaveIndex;
  const envelopeBytes = JSON.stringify(envelope).length;
  logBeatRequest(wave, envelopeBytes / 1024);

  // Build dedup'd model chain: primary first, then fallbacks.
  const seen = new Set<string>();
  const modelsToTry: string[] = [];
  for (const m of [primaryModel, ...fallbackModels]) {
    if (m && !seen.has(m)) {
      seen.add(m);
      modelsToTry.push(m);
    }
  }

  let lastError = "";
  for (const model of modelsToTry) {
    let lastWasValidationError = false;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let parsed: unknown;
      try {
        const result = await client.complete({
          model,
          messages: [
            { role: "system", content: BEAT_SKELETON_SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(envelope, attempt > 1 ? lastError : undefined) },
          ],
          timeoutMs,
          responseFormat: "json_object",
          // 4000 tokens lets the LLM emit a full beat + 2 inter-beat overrides
          // without truncation.
          maxTokens: 4000,
        });
        logBeatResponse(wave, result.content, result.latencyMs);
        parsed = parseLooseJson(result.content);
      } catch (err) {
        // Network / timeout / server error — break out of retries and try
        // the next model in the chain (don't burn retries on a hung model).
        lastError = err instanceof Error ? err.message : String(err);
        logBeatValidationFail(wave, `${model}: ${lastError}`, attempt);
        lastWasValidationError = false;
        break;
      }
      const validation = validateBeat(parsed);
      if (!validation.ok) {
        lastError = validation.error;
        logBeatValidationFail(wave, `${model}: ${lastError}`, attempt);
        lastWasValidationError = true;
        continue;
      }
      // First-beat semantic check: dialogue_choice with at least one
      // non-custom effect on each option AND at least one option with a
      // non-empty consequence.items[] (rewards-shop menu).
      if (envelope.isFirstBeat) {
        const semanticErr = validateFirstBeatSemantics(parsed as Beat);
        if (semanticErr) {
          lastError = `first-beat semantic check: ${semanticErr}`;
          logBeatValidationFail(wave, `${model}: ${lastError}`, attempt);
          lastWasValidationError = true;
          continue;
        }
      }
      logBeatParsed(wave, parsed);
      return parsed as Beat;
    }
    // Validation errors burned all retries — switching models won't help
    // since the schema/semantic constraints are model-agnostic.
    if (lastWasValidationError) {
      break;
    }
    // Network/timeout — try next model in the chain.
  }
  return null;
}

function validateFirstBeatSemantics(beat: Beat): string | null {
  if (beat.type !== "dialogue_choice") {
    return `must be dialogue_choice, got "${beat.type}"`;
  }
  for (let i = 0; i < beat.options.length; i++) {
    const opt = beat.options[i];
    const effects = opt.consequence.effects ?? [];
    const hasNonCustom = effects.some(e => e.type !== "custom");
    if (!hasNonCustom) {
      return `options[${i}] must have at least one non-custom effect`;
    }
  }
  const anyHasItems = beat.options.some(o => (o.consequence.items?.length ?? 0) > 0);
  if (!anyHasItems) {
    return "at least one option must have non-empty consequence.items[] (a 2-3 entry rewards-shop menu)";
  }
  return null;
}

async function runProsePhase(client: DirectorClient, beat: Beat, model: string, timeoutMs: number): Promise<Beat> {
  let parsed: unknown;
  try {
    const result = await client.complete({
      model,
      messages: [
        { role: "system", content: BEAT_PROSE_SYSTEM_PROMPT },
        { role: "user", content: `Skeleton:\n${JSON.stringify(beat, null, 2)}\n\nReturn the polished beat as JSON.` },
      ],
      timeoutMs,
      responseFormat: "json_object",
      maxTokens: 1500,
    });
    parsed = parseLooseJson(result.content);
  } catch {
    return beat;
  }
  const validation = validateBeat(parsed);
  return validation.ok ? (parsed as Beat) : beat;
}

export async function generateBeat(client: DirectorClient, opts: GenerateBeatOptions): Promise<Beat> {
  const skeletonModel = opts.skeletonModel ?? DEFAULT_SKELETON_MODEL;
  const fallbackSkeletonModels = opts.fallbackSkeletonModels ?? DEFAULT_SKELETON_FALLBACK_CHAIN;
  const proseModel = opts.proseModel ?? DEFAULT_PROSE_MODEL;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const skeleton = await runSkeletonPhase(
    client,
    opts.envelope,
    skeletonModel,
    fallbackSkeletonModels,
    maxRetries,
    timeoutMs,
  );
  if (!skeleton) {
    return fallbackBeat(opts.envelope);
  }
  if (!opts.withProsePass) {
    return skeleton;
  }
  return runProsePhase(client, skeleton, proseModel, timeoutMs);
}
