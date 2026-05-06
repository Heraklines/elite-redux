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
  /** Defaults to moonshotai/kimi-k2.6 (non-thinking; 17-55s observed for bible-shaped output). */
  model?: string;
  /** Defaults to 3. */
  maxRetries?: number;
  /** Per-call timeout, default 120s — bible latency varies (17s best case, 55s observed worst). */
  timeoutMs?: number;
}

const DEFAULT_BIBLE_MODEL = "moonshotai/kimi-k2.6";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 120_000;

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
  const model = opts.model ?? DEFAULT_BIBLE_MODEL;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError = "";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const userContent =
      attempt === 1
        ? `Theme seed: ${opts.seedText}\n\nGenerate the story bible.`
        : `Theme seed: ${opts.seedText}\n\nYour previous output failed validation: ${lastError}\nRe-emit valid JSON.`;

    if (attempt === 1) {
      logBibleRequest(opts.seedText);
    }
    const result = await client.complete({
      model,
      messages: [
        { role: "system", content: STORY_BIBLE_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      timeoutMs,
      responseFormat: "json_object",
      maxTokens: 2500,
    });
    logBibleResponse(result.content, result.latencyMs);

    let parsed: unknown;
    try {
      parsed = parseLooseJson(result.content);
    } catch (err) {
      lastError = `JSON parse error: ${err instanceof Error ? err.message : String(err)}`;
      logBibleValidationFail(lastError, attempt);
      continue;
    }
    const validation = validateStoryBible(parsed);
    if (validation.ok) {
      logBibleParsed(parsed);
      return parsed as StoryBible;
    }
    lastError = validation.error;
    logBibleValidationFail(lastError, attempt);
  }
  throw new Error(`generateStoryBible: validation failed after ${maxRetries} attempts: ${lastError}`);
}
