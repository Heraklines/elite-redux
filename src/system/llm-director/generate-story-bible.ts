import { type StoryBible, validateStoryBible } from "#data/llm-director/beat-schema";
import { STORY_BIBLE_SYSTEM_PROMPT } from "#data/llm-director/system-prompts";
import type { DirectorClient } from "#system/llm-director/director-client";
import {
  logBibleParsed,
  logBibleRequest,
  logBibleResponse,
  logBibleValidationFail,
} from "#system/llm-director/director-log";

/**
 * One DeepSeek call → validated StoryBible. On schema failure
 * we retry up to 3 times with the validation error appended to the next prompt
 * so the model self-corrects. After 3 failures we throw and let the caller
 * fall back (typically to Classic mode + apology text).
 */

export interface GenerateStoryBibleOptions {
  seedText: string;
  /**
   * Primary model for bible generation. Defaults to deepseek/deepseek-v4-flash
   * (~11s observed for a full bible, same model used for beats — proven reliable).
   */
  model?: string;
  /**
   * Ordered fallback chain. If the primary model errors (network / timeout /
   * hang), each fallback is tried in order until one succeeds. Validation
   * errors break out without falling back — they're model-agnostic.
   */
  fallbackModels?: readonly string[];
  /** Defaults to 3. */
  maxRetries?: number;
  /** Per-call timeout, default 150s — long enough to forgive a slow model
   *  before falling back to the next in the chain. DeepSeek finishes in ~11s,
   *  MiniMax ~28s, GLM ~95s; 150s gives them all headroom. */
  timeoutMs?: number;
}

/**
 * Bible-generation model chain (primary first, then fallbacks). All measured
 * against the same bible prompt:
 *
 *   deepseek/deepseek-v4-flash : ~11s, valid JSON ✓
 *   minimax/minimax-latest     : ~28s, valid JSON (wraps in markdown fences,
 *                                parseLooseJson handles that) ✓
 *   zai-org/glm-latest         : ~95s, valid JSON ✓
 *   moonshotai/kimi-k2.6       : hangs on bible-sized prompts as of
 *                                2026-05; kept as last resort in case the
 *                                provider stabilises. Reserved for the
 *                                optional prose-pass on beats where its
 *                                voice strengths actually matter.
 */
const DEFAULT_BIBLE_MODEL = "deepseek/deepseek-v4-flash";
const DEFAULT_BIBLE_FALLBACK_CHAIN: readonly string[] = [
  "minimax/minimax-latest",
  "zai-org/glm-latest",
  "moonshotai/kimi-k2.6",
];
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 150_000;

const FENCE_REGEX = /^```(?:json)?\s*([\s\S]*?)\s*```$/m;

/**
 * Strip optional markdown code fences and parse JSON. Models occasionally wrap
 * structured output in fences despite system-prompt instructions; we accept it
 * silently rather than retrying.
 */
function parseLooseJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = FENCE_REGEX.exec(trimmed);
  const raw = fenced ? fenced[1] : trimmed;
  return JSON.parse(raw);
}

export async function generateStoryBible(client: DirectorClient, opts: GenerateStoryBibleOptions): Promise<StoryBible> {
  const primaryModel = opts.model ?? DEFAULT_BIBLE_MODEL;
  const fallbackChain = opts.fallbackModels ?? DEFAULT_BIBLE_FALLBACK_CHAIN;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  logBibleRequest(opts.seedText);

  // Build the ordered list to try: primary, then each fallback (deduped).
  // We try the WHOLE retry budget on each model before moving on — the
  // model decides when to abandon (network/timeout error breaks out
  // immediately so we don't burn all retries on a hung server).
  const seen = new Set<string>();
  const modelsToTry: string[] = [];
  for (const m of [primaryModel, ...fallbackChain]) {
    if (m && !seen.has(m)) {
      seen.add(m);
      modelsToTry.push(m);
    }
  }

  let lastError = "";
  for (const model of modelsToTry) {
    let lastWasValidationError = false;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const userContent =
        attempt === 1
          ? `Theme seed: ${opts.seedText}\n\nGenerate the story bible.`
          : `Theme seed: ${opts.seedText}\n\nYour previous output failed validation: ${lastError}\nRe-emit valid JSON.`;

      let result: { content: string; latencyMs: number };
      try {
        result = await client.complete({
          model,
          messages: [
            { role: "system", content: STORY_BIBLE_SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          timeoutMs,
          responseFormat: "json_object",
          maxTokens: 2500,
        });
      } catch (err) {
        // Network / timeout / server error — break out to try the next
        // model in the chain instead of burning all retries on a hung
        // server.
        lastError = err instanceof Error ? err.message : String(err);
        logBibleValidationFail(`${model}: ${lastError}`, attempt);
        lastWasValidationError = false;
        break;
      }
      logBibleResponse(result.content, result.latencyMs);

      let parsed: unknown;
      try {
        parsed = parseLooseJson(result.content);
      } catch (err) {
        lastError = `JSON parse error: ${err instanceof Error ? err.message : String(err)}`;
        logBibleValidationFail(`${model}: ${lastError}`, attempt);
        lastWasValidationError = true;
        continue;
      }
      const validation = validateStoryBible(parsed);
      if (validation.ok) {
        logBibleParsed(parsed);
        return parsed as StoryBible;
      }
      lastError = validation.error;
      logBibleValidationFail(`${model}: ${lastError}`, attempt);
      lastWasValidationError = true;
    }
    // If we exhausted retries on validation errors, the model can produce
    // output but not valid output — switching models is unlikely to help.
    // Surface the error.
    if (lastWasValidationError) {
      break;
    }
    // Otherwise (network/timeout) try the next model in the chain.
  }
  throw new Error(
    `generateStoryBible: validation failed after ${maxRetries} attempts across ${modelsToTry.length} model(s): ${lastError}`,
  );
}
