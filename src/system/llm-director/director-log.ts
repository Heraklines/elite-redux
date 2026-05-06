/**
 * Centralized verbose logger for the LLM Director. Every important step
 * — bible generation, beat generation, beat application, biome/trainer
 * overrides, fallback paths — emits `console.info("[llm-director] ...")`
 * lines so the player can open DevTools and audit exactly what the
 * model emitted vs what the game applied.
 *
 * Designed for diagnosis, not user-facing output. Tagged for easy grep
 * in the browser console.
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

export function logBibleRequest(seedText: string): void {
  console.info(`${TAG} bible-request`, { seedText });
}

export function logBibleResponse(rawContent: string, latencyMs: number): void {
  console.info(`${TAG} bible-response (${latencyMs.toFixed(0)}ms)`, pretty(rawContent, 1200));
}

export function logBibleParsed(bible: unknown): void {
  console.info(`${TAG} bible-parsed`, pretty(bible, 1500));
}

export function logBibleValidationFail(error: string, attempt: number): void {
  console.warn(`${TAG} bible-validation-fail (attempt ${attempt})`, error);
}

export function logBeatRequest(wave: number, envelopeSizeKb: number): void {
  console.info(`${TAG} beat-request wave=${wave} envelope=${envelopeSizeKb.toFixed(1)}KB`);
}

export function logBeatResponse(wave: number, rawContent: string, latencyMs: number): void {
  console.info(`${TAG} beat-response wave=${wave} (${latencyMs.toFixed(0)}ms)`, pretty(rawContent, 800));
}

export function logBeatParsed(wave: number, beat: unknown): void {
  console.info(`${TAG} beat-parsed wave=${wave}`, pretty(beat, 1000));
}

export function logBeatValidationFail(wave: number, error: string, attempt: number): void {
  console.warn(`${TAG} beat-validation-fail wave=${wave} attempt=${attempt}`, error);
}

export function logBeatDispatched(wave: number, beatType: string, beatId: string): void {
  console.info(`${TAG} beat-dispatched wave=${wave} type=${beatType} id=${beatId}`);
}

export function logBeatRendered(wave: number, beatType: string, pages: number): void {
  console.info(`${TAG} beat-rendered wave=${wave} type=${beatType} pages=${pages}`);
}

export function logChoiceMade(beatId: string, optionLabel: string, consequenceSummary: object): void {
  console.info(`${TAG} choice-made beat=${beatId} option="${optionLabel}"`, consequenceSummary);
}

export function logBiomeSwitch(reason: string, from: number | undefined, to: number, actName?: string): void {
  console.info(`${TAG} biome-switch reason=${reason} ${from ?? "?"} -> ${to}${actName ? ` (act: ${actName})` : ""}`);
}

export function logTrainerOverride(wave: number, override: unknown): void {
  console.info(`${TAG} trainer-override wave=${wave}`, pretty(override, 400));
}

export function logUnderrun(wave: number): void {
  console.warn(`${TAG} underrun wave=${wave}: queue empty, falling to filler beat`);
}

export function logFallbackToClassic(reason: string): void {
  console.warn(`${TAG} fallback-to-classic reason="${reason}"`);
}
