import type { DirectorClient } from "#system/llm-director/director-client";
import type { BeatHistoryEntry, LLMDirectorState } from "#system/llm-director/director-state";

/**
 * Beat-history compaction. When `beatHistory` grows past `HISTORY_COMPACT_THRESHOLD`
 * entries, summarize everything except the trailing `HISTORY_KEEP_VERBATIM`
 * entries down to per-beat 2-line digest strings via one Kimi call. The
 * verbatim payload is dropped on each compacted entry; the digest is kept
 * so future envelopes can include compressed memory of the run so far.
 *
 * One round-trip per compaction (typically every ~30 beats), with a fallback
 * placeholder digest if the LLM response is unparseable so we never block
 * the run on this background task.
 */

export const HISTORY_COMPACT_THRESHOLD = 30;
export const HISTORY_KEEP_VERBATIM = 20;

const DEFAULT_MODEL = "moonshotai/kimi-k2.6";
const DEFAULT_TIMEOUT_MS = 20_000;

const COMPACTION_SYSTEM_PROMPT =
  "You are summarizing beat-history entries for a 200-wave Pokémon roguelike run "
  + "so the Director LLM can keep them in context. For EACH beat the user provides, "
  + "produce a 2-line digest (under 200 characters) preserving the key choice, "
  + "outcome, and named entities. Return STRICT JSON of shape: "
  + '{"digests": { "<beatId>": "<digest>", ... }}.';

const FENCE_REGEX = /^```(?:json)?\s*([\s\S]*?)\s*```$/m;

interface CompactionResponse {
  digests?: Record<string, string>;
}

function parseLooseJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = FENCE_REGEX.exec(trimmed);
  const raw = fenced ? fenced[1] : trimmed;
  return JSON.parse(raw);
}

function placeholderDigest(entry: BeatHistoryEntry): string {
  const intro = entry.verbatim?.introText ?? "(no intro)";
  return intro.slice(0, 180);
}

function buildUserPayload(entries: BeatHistoryEntry[]): string {
  const lines = entries.map(e => {
    const intro = e.verbatim?.introText ?? "";
    const choice = e.playerChoice?.optionLabel ? ` chose=${e.playerChoice.optionLabel}` : "";
    return `${e.beatId} (wave ${e.wave}, ${e.beatType})${choice}: ${intro}`;
  });
  return `Beats to digest (one per line):\n${lines.join("\n")}\n\nReturn the digests JSON object.`;
}

function asCompactionResponse(parsed: unknown): CompactionResponse | null {
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const maybe = (parsed as { digests?: unknown }).digests;
  if (typeof maybe !== "object" || maybe === null) {
    return null;
  }
  const digests: Record<string, string> = {};
  for (const [k, v] of Object.entries(maybe)) {
    if (typeof v === "string") {
      digests[k] = v;
    }
  }
  return { digests };
}

export interface CompactHistoryOptions {
  model?: string;
  timeoutMs?: number;
}

export async function compactHistory(
  state: LLMDirectorState,
  client: DirectorClient,
  opts: CompactHistoryOptions = {},
): Promise<void> {
  if (state.beatHistory.length <= HISTORY_COMPACT_THRESHOLD) {
    return;
  }

  const cutoff = state.beatHistory.length - HISTORY_KEEP_VERBATIM;
  const head = state.beatHistory.slice(0, cutoff);
  const toCompact = head.filter(e => e.verbatim && !e.digest);

  let digests: Record<string, string> = {};
  if (toCompact.length > 0) {
    try {
      const result = await client.complete({
        model: opts.model ?? DEFAULT_MODEL,
        messages: [
          { role: "system", content: COMPACTION_SYSTEM_PROMPT },
          { role: "user", content: buildUserPayload(toCompact) },
        ],
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        responseFormat: "json_object",
      });
      const parsed = parseLooseJson(result.content);
      digests = asCompactionResponse(parsed)?.digests ?? {};
    } catch (err) {
      console.warn(
        "[llm-director] compactHistory: LLM call failed, using placeholder digests:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Apply: for each entry in the head, replace verbatim with digest.
  state.beatHistory = state.beatHistory.map((entry, idx) => {
    if (idx >= cutoff) {
      return entry;
    }
    if (!entry.verbatim) {
      return entry;
    }
    const digest = digests[entry.beatId] ?? entry.digest ?? placeholderDigest(entry);
    const compacted: BeatHistoryEntry = {
      beatId: entry.beatId,
      wave: entry.wave,
      beatType: entry.beatType,
      digest,
    };
    if (entry.playerChoice) {
      compacted.playerChoice = entry.playerChoice;
    }
    return compacted;
  });
}
