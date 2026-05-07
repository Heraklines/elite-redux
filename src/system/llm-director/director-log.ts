/**
 * Centralized verbose logger for the LLM Director.
 *
 * Two outputs per event:
 *   1. `console.info("[llm-director] ...")` for live DevTools auditing
 *   2. POST to `/api/llm-log` (Vite dev plugin) which appends to
 *      `<repo>/llm-director-trace.jsonl` so the player can `tail -f` the
 *      file during a run and audit exactly what the model emitted vs
 *      what the game applied without scrolling 1000 console lines.
 *
 * NEVER logs the API key or request headers — only the prompt content,
 * model, latency, response body, and game-state deltas.
 */

const TAG = "[llm-director]";

function pretty(value: unknown, max = 600): string {
  try {
    const json = typeof value === "string" ? value : JSON.stringify(value);
    if (json.length <= max) {
      return json;
    }
    return `${json.slice(0, max)}…<+${json.length - max} chars>`;
  } catch {
    return String(value);
  }
}

interface LogEvent {
  event: string;
  timestamp: number;
  [key: string]: unknown;
}

/**
 * Send the structured event to the dev-server log endpoint. Fire-and-forget;
 * a network error never breaks gameplay. Only attempts in browser context.
 */
function persist(event: LogEvent): void {
  if (typeof globalThis === "undefined" || typeof globalThis.fetch !== "function") {
    return;
  }
  // Don't block on logging — fire and forget. Errors are silent.
  globalThis
    .fetch("/api/llm-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    })
    .catch(() => {
      /* dev-only logging; ignore failures */
    });
}

function emit(event: string, data: Record<string, unknown>, level: "info" | "warn" = "info"): void {
  const payload: LogEvent = { event, timestamp: Date.now(), ...data };
  if (level === "warn") {
    console.warn(`${TAG} ${event}`, data);
  } else {
    console.info(`${TAG} ${event}`, data);
  }
  persist(payload);
}

// ─── Bible ────────────────────────────────────────────────────────────────

export function logBibleRequest(seedText: string): void {
  emit("bible-request", { seedText });
}

export function logBibleResponse(rawContent: string, latencyMs: number): void {
  emit("bible-response", { latencyMs, rawContent: pretty(rawContent, 1500), rawFull: rawContent });
}

export function logBibleParsed(bible: unknown): void {
  emit("bible-parsed", { bible });
}

export function logBibleValidationFail(error: string, attempt: number): void {
  emit("bible-validation-fail", { attempt, error }, "warn");
}

// ─── Beat ─────────────────────────────────────────────────────────────────

export function logBeatRequest(wave: number, envelopeSizeKb: number): void {
  emit("beat-request", { wave, envelopeSizeKb: Number(envelopeSizeKb.toFixed(1)) });
}

export function logBeatResponse(wave: number, rawContent: string, latencyMs: number, model?: string): void {
  emit("beat-response", { wave, model, latencyMs, rawContent: pretty(rawContent, 1000), rawFull: rawContent });
}

export function logBeatParsed(wave: number, beat: unknown, model?: string): void {
  emit("beat-parsed", { wave, model, beat });
}

export function logBeatValidationFail(wave: number, error: string, attempt: number): void {
  emit("beat-validation-fail", { wave, attempt, error }, "warn");
}

export function logBeatDispatched(wave: number, beatType: string, beatId: string): void {
  emit("beat-dispatched", { wave, beatType, beatId });
}

export function logBeatRendered(wave: number, beatType: string, pages: number): void {
  emit("beat-rendered", { wave, beatType, pages });
}

// ─── Choice + applied state changes ───────────────────────────────────────

export function logChoiceMade(beatId: string, optionLabel: string, consequence: unknown): void {
  emit("choice-made", { beatId, optionLabel, consequence });
}

/**
 * What the game ACTUALLY applied for a choice. Lets the player diff this
 * against the LLM's emitted consequence to see what landed vs what was
 * silently dropped (unknown modifierType, unknown effect type, target
 * resolution failed, etc.).
 */
export function logConsequenceApplied(args: {
  beatId: string;
  alignmentBefore: number;
  alignmentAfter: number;
  factionRepBefore: Record<string, number>;
  factionRepAfter: Record<string, number>;
  itemsGranted: Array<{ modifierType: string; qty: number }>;
  moneyDelta: number;
  effectsAttempted: number;
  effectsApplied: number;
  effectsStubbed: string[];
  effectsFailed: Array<{ type: string; reason: string }>;
}): void {
  emit("consequence-applied", args);
}

export function logEffectApplied(beatId: string, effectType: string, ok: boolean, detail?: unknown): void {
  emit(ok ? "effect-applied" : "effect-failed", { beatId, effectType, detail });
}

// ─── Biome / trainer ──────────────────────────────────────────────────────

export function logBiomeSwitch(reason: string, from: number | undefined, to: number, actName?: string): void {
  emit("biome-switch", { reason, from, to, actName });
}

export function logTrainerOverride(wave: number, override: unknown): void {
  emit("trainer-override", { wave, override });
}

/**
 * Records that an LLM-authored preBattleText was queued for a wave's
 * vanilla trainer encounter. Lets the player verify the override fired.
 */
export function logTrainerNarrationApplied(wave: number, text: string): void {
  emit("trainer-narration-applied", { wave, text });
}

export function logAuthoredTeamInstalled(wave: number, teamSize: number, levels: number[]): void {
  emit("authored-team-installed", { wave, teamSize, levels });
}

// ─── Failures ─────────────────────────────────────────────────────────────

export function logUnderrun(wave: number): void {
  emit("underrun", { wave }, "warn");
}

export function logFallbackToClassic(reason: string): void {
  emit("fallback-to-classic", { reason }, "warn");
}
