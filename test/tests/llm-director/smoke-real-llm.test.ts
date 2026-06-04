/**
 * Real-LLM smoke test, opt-in. Hits the live NanoGPT proxy via env-vars and
 * is gated on `RUN_LLM_SMOKE=1` so it stays out of the default suite (and
 * out of CI). Used during plan tasks 13, 22, 24 to verify auth, latency and
 * end-to-end story-bible / beat generation against the real backend.
 *
 *   RUN_LLM_SMOKE=1 pnpm test test/tests/llm-director/smoke-real-llm.test.ts
 *
 * The env vars are read from `import.meta.env` exactly the same way the
 * production runtime reads them, so a passing smoke proves both the keys
 * and the fetch wiring are working.
 */

import { THEME_SEEDS } from "#data/llm-director/theme-seeds";
import { buildContextEnvelope } from "#system/llm-director/context-envelope";
import { DirectorClient } from "#system/llm-director/director-client";
import { defaultDirectorState } from "#system/llm-director/director-state";
import { generateBeat } from "#system/llm-director/generate-beat";
import { generateStoryBible } from "#system/llm-director/generate-story-bible";
import { http, passthrough } from "msw";
import { beforeAll, describe, expect, it } from "vitest";

// biome-ignore lint/style/noProcessEnv: opt-in test gate, not runtime config
const enabled = process.env.RUN_LLM_SMOKE === "1";
const describeSmoke = enabled ? describe : describe.skip;

describeSmoke("LLM smoke (real NanoGPT)", () => {
  const apiKey = import.meta.env.VITE_NANOGPT_API_KEY ?? "";
  const baseUrl = import.meta.env.VITE_NANOGPT_BASE_URL ?? "";

  beforeAll(() => {
    // The vitest setup installs MSW with `onUnhandledRequest: "error"`. We
    // explicitly let nano-gpt traffic through here so the smoke hits the
    // real backend.
    global.server.use(http.all("https://nano-gpt.com/*", () => passthrough()));
  });

  it("has env vars set", () => {
    expect(apiKey.length, "VITE_NANOGPT_API_KEY must be set").toBeGreaterThan(0);
    expect(baseUrl.length, "VITE_NANOGPT_BASE_URL must be set").toBeGreaterThan(0);
  });

  it("generates a story bible from a sample seed", async () => {
    const client = new DirectorClient({ apiKey, baseUrl });
    const seed = THEME_SEEDS[0];
    const t0 = performance.now();
    const bible = await generateStoryBible(client, { seedText: seed.text });
    const ms = performance.now() - t0;
    expect(bible.themeName.length).toBeGreaterThan(0);
    expect(bible.acts.length).toBeGreaterThan(0);
    console.log(`[smoke] story bible latency: ${ms.toFixed(0)}ms, theme=${bible.themeName}`);
    // Reasonable upper bound — flag if generation regresses dramatically.
    expect(ms).toBeLessThan(120_000);
  }, 180_000);

  it("generates a beat from a sample bible", async () => {
    const client = new DirectorClient({ apiKey, baseUrl });
    const bible = await generateStoryBible(client, { seedText: THEME_SEEDS[0].text });
    const state = defaultDirectorState();
    state.storyBible = bible;
    const envelope = buildContextEnvelope({
      state,
      playerParty: [
        {
          species: "Pikachu",
          level: 5,
          types: ["electric"],
          ability: "static",
          moves: ["thunder-shock"],
          hpPct: 1,
        },
      ],
      currentWaveIndex: 3,
    });
    const t0 = performance.now();
    const beat = await generateBeat(client, { envelope });
    const ms = performance.now() - t0;
    expect(beat.beatId.length).toBeGreaterThan(0);
    expect(beat.introText.length).toBeGreaterThan(0);
    console.log(`[smoke] beat latency: ${ms.toFixed(0)}ms, type=${beat.type}, id=${beat.beatId}`);
    expect(ms).toBeLessThan(120_000);
  }, 300_000);
});
