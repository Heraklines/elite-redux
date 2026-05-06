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
  /** Defaults to deepseek/deepseek-v4-flash (~7s — fastest non-thinking subscription model). */
  skeletonModel?: string;
  /** Defaults to moonshotai/kimi-k2.6 (better prose voice, used only when withProsePass is on). */
  proseModel?: string;
  /** Default 3. */
  maxRetries?: number;
  /** Default 30s — comfortably above the ~7s typical for the fast skeleton model. */
  timeoutMs?: number;
  /** v1 default false; turn on once costs are characterized. */
  withProsePass?: boolean;
}

const DEFAULT_SKELETON_MODEL = "deepseek/deepseek-v4-flash";
const DEFAULT_PROSE_MODEL = "moonshotai/kimi-k2.6";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30_000;

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
  model: string,
  maxRetries: number,
  timeoutMs: number,
): Promise<Beat | null> {
  let lastError = "";
  const wave = envelope.currentWaveIndex;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let parsed: unknown;
    try {
      if (attempt === 1) {
        const envelopeBytes = JSON.stringify(envelope).length;
        logBeatRequest(wave, envelopeBytes / 1024);
      }
      const result = await client.complete({
        model,
        messages: [
          { role: "system", content: BEAT_SKELETON_SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(envelope, attempt > 1 ? lastError : undefined) },
        ],
        timeoutMs,
        responseFormat: "json_object",
        // 4000 tokens lets the LLM emit a full beat + 2 inter-beat overrides
        // (preBattleText for next 2 waves) without truncation. The previous
        // 1200 cap was cutting off mid-JSON on rich beats.
        maxTokens: 4000,
      });
      logBeatResponse(wave, result.content, result.latencyMs);
      parsed = parseLooseJson(result.content);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logBeatValidationFail(wave, lastError, attempt);
      continue;
    }
    const validation = validateBeat(parsed);
    if (validation.ok) {
      logBeatParsed(wave, parsed);
      return parsed as Beat;
    }
    lastError = validation.error;
    logBeatValidationFail(wave, lastError, attempt);
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
  const proseModel = opts.proseModel ?? DEFAULT_PROSE_MODEL;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const skeleton = await runSkeletonPhase(client, opts.envelope, skeletonModel, maxRetries, timeoutMs);
  if (!skeleton) {
    return fallbackBeat(opts.envelope);
  }
  if (!opts.withProsePass) {
    return skeleton;
  }
  return runProsePhase(client, skeleton, proseModel, timeoutMs);
}
