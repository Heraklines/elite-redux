# LLM Director Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a new game mode (`LLM_DIRECTOR`) where an LLM generates per-run story arcs, beats every 3 waves, themed trainers, dialogue choices, biome transitions, and consequences — with pre-generation so the player never sees a loading delay.

**Architecture:** Two-LLM split via NanoGPT (`https://nano-gpt.com/api/v1`, OpenAI-compatible): DeepSeek-V4-Pro:thinking for structured outputs (story bible, JSON skeletons), Kimi K2.6 for prose. Beats are a TypeScript discriminated union, validated with AJV on every response. A pre-generation queue runs LLM calls in the background while the player plays vanilla wave content, so beats are ready when needed. Save state is additive on `SystemSaveData` (no migration of existing saves needed).

**Tech Stack:** TypeScript, Phaser 3, vitest, biome, lefthook, AJV (schema validation, already in deps), i18next. NanoGPT proxy via `fetch`.

**Reference design:** `docs/plans/2026-05-05-llm-director-design.md` — read it first.

**Branch:** `feat/llm-director` — branch off `beta` (NOT off `feat/egg-qol`, which is a sibling feature). The egg-qol branch can be merged independently later.

**Test runner:** `pnpm test path/to/file.test.ts` for one file, `pnpm test:silent` for the suite. Lint: `pnpm biome`. Typecheck: `pnpm typecheck`.

**Pre-commit:** Lefthook runs biome on staged files. If a commit fails the hook, fix the underlying issue (no `--no-verify`).

**Hard rules:**
- No `as any`, `@ts-ignore`, `@ts-expect-error` (one allowed: accessing private statics in tests).
- No deleting failing tests to make them pass.
- No commits without explicit user approval — but the user has approved the standard TDD-with-commits flow for this plan.

---

## Setup — Task 0

### Task 0: Create branch + env

**Files:**
- Branch: `feat/llm-director` from `beta`
- Modify: `.env.development`

**Step 0.1: Branch off beta**

```
git checkout beta && git checkout -b feat/llm-director
```

**Step 0.2: Add API key to `.env.development`**

Append at end of `.env.development`:
```
VITE_NANOGPT_API_KEY=REDACTED-MOVED-TO-DOTENV-LOCAL
VITE_NANOGPT_BASE_URL=https://nano-gpt.com/api/v1
```

(Vite needs the `VITE_` prefix to expose to client code. The key is dev-mode only; the build-mode strategy is v2.)

**Step 0.3: Sanity check**

```
git status   # should show .env.development modified, branch feat/llm-director
```

No commit yet.

---

## Phase 1 — Pure data + schemas (no UI, no LLM)

### Task 1: Beat schema types and AJV validators (TDD)

**Files:**
- Create: `src/data/llm-director/beat-schema.ts`
- Test: `test/tests/llm-director/beat-schema.test.ts`

**Step 1.1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { validateBeat, type Beat, type DialogueChoiceBeat } from "#data/llm-director/beat-schema";

describe("validateBeat", () => {
  it("accepts a valid dialogue_choice beat", () => {
    const beat: DialogueChoiceBeat = {
      beatId: "b1", type: "dialogue_choice",
      introText: "An old man waves you over.",
      speaker: { name: "Old Man" },
      options: [{ label: "Listen", consequence: { alignment: 1, epilogueText: "He nods." } }],
    };
    expect(validateBeat(beat)).toEqual({ ok: true });
  });
  it("rejects beat missing required fields", () => {
    const bad = { type: "dialogue_choice", options: [] };
    const r = validateBeat(bad as any);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/required|missing/i);
  });
  it("rejects unknown beat type", () => {
    const bad = { beatId: "x", type: "weird_type", introText: "x" };
    expect(validateBeat(bad as any).ok).toBe(false);
  });
  it("clamps consequence.alignment within -10..+10 (validation only, no mutation)", () => {
    const beat = {
      beatId: "b2", type: "dialogue_choice", introText: "x",
      options: [{ label: "y", consequence: { alignment: 999 } }],
    };
    expect(validateBeat(beat as any).ok).toBe(false);
  });
});
```

**Step 1.2: Run — must fail** (file doesn't exist)

```
pnpm test test/tests/llm-director/beat-schema.test.ts
```

**Step 1.3: Implement**

`src/data/llm-director/beat-schema.ts` — full TS interfaces from the design doc + AJV schema. Use AJV's `compile()` once at module load. Export `validateBeat(beat: unknown): { ok: true } | { ok: false; error: string }`.

Schema mirrors the design doc § "Beat types (discriminated union)" — copy that block verbatim into both TS interfaces and JSON Schema. Constrain `alignment` to `{type: "integer", minimum: -10, maximum: 10}`. Require `beatId`, `type`, `introText` on all beat types.

**Step 1.4: Run — must pass all 4**

**Step 1.5: Commit**

```
git add src/data/llm-director/beat-schema.ts test/tests/llm-director/beat-schema.test.ts
git commit -m "feat(llm-director): beat schema types + AJV validator"
```

---

### Task 2: Consequence applier (pure, TDD)

**Files:**
- Create: `src/system/llm-director/beat-applier.ts`
- Test: `test/tests/llm-director/beat-applier.test.ts`

**Step 2.1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { applyConsequence, type DirectorState } from "#system/llm-director/beat-applier";

const baseState = (): DirectorState => ({
  storyBible: {} as any, beatHistory: [],
  factionRep: {}, alignment: 0, flags: {}, npcMemory: {},
  lossRiskBudget: { used: 0, target: 0.15 },
});

describe("applyConsequence", () => {
  it("clamps alignment to [-100, 100]", () => {
    const s = baseState(); s.alignment = 95;
    applyConsequence(s, { alignment: 20 });
    expect(s.alignment).toBe(100);
  });
  it("merges factionRep deltas", () => {
    const s = baseState(); s.factionRep = { rebels: 10 };
    applyConsequence(s, { factionRep: { rebels: 5, mafias: -3 } });
    expect(s.factionRep).toEqual({ rebels: 15, mafias: -3 });
  });
  it("sets flags", () => {
    const s = baseState();
    applyConsequence(s, { flags: { trustedMariner: true } });
    expect(s.flags.trustedMariner).toBe(true);
  });
  it("returns runEnd info if present (caller is responsible for ending the run)", () => {
    const s = baseState();
    const r = applyConsequence(s, { runEnd: { reason: "betrayed", epilogueText: "..." } });
    expect(r.runEnd).toBeDefined();
  });
});
```

**Step 2.2: Run — must fail**

**Step 2.3: Implement** — pure mutation of state, with clamping at -100..+100 for alignment and factionRep values, setting flags via Object.assign, optional return of runEnd info if present.

**Step 2.4: Run — must pass**

**Step 2.5: Commit**

```
git add src/system/llm-director/beat-applier.ts test/tests/llm-director/beat-applier.test.ts
git commit -m "feat(llm-director): pure consequence applier with clamping"
```

---

### Task 3: Balance rails clamper (TDD)

**Files:**
- Create: `src/data/llm-director/balance-rails.ts`
- Test: `test/tests/llm-director/balance-rails.test.ts`

**Step 3.1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { clampTrainerBattle } from "#data/llm-director/balance-rails";
import type { TrainerBattleBeat } from "#data/llm-director/beat-schema";

describe("clampTrainerBattle", () => {
  const baseBeat = (overrides: Partial<TrainerBattleBeat> = {}): TrainerBattleBeat => ({
    beatId: "t1", type: "trainer_battle",
    introText: "x", trainerName: "Rival", trainerType: 0 as any,
    preBattleText: "x", postWinText: "x", ...overrides,
  });

  it("clamps levelDelta to ±3 by default", () => {
    expect(clampTrainerBattle(baseBeat({ levelDelta: 99 }), { recentFaints: 0 }).levelDelta).toBe(3);
    expect(clampTrainerBattle(baseBeat({ levelDelta: -99 }), { recentFaints: 0 }).levelDelta).toBe(-3);
  });
  it("allows up to +10 when difficultyTag=brutal AND recentFaints==0", () => {
    expect(clampTrainerBattle(baseBeat({ levelDelta: 10, difficultyTag: "brutal" }), { recentFaints: 0 }).levelDelta).toBe(10);
  });
  it("rolls back brutal to ±3 when player is already struggling", () => {
    expect(clampTrainerBattle(baseBeat({ levelDelta: 10, difficultyTag: "brutal" }), { recentFaints: 2 }).levelDelta).toBe(3);
  });
  it("trims species swaps beyond 2", () => {
    const swaps = [1, 2, 3, 4, 5] as any;
    expect(clampTrainerBattle(baseBeat({ speciesSwaps: swaps }), { recentFaints: 0 }).speciesSwaps).toHaveLength(2);
  });
});
```

**Step 3.2-3.5: Implement, run, pass, commit.**

```
git commit -m "feat(llm-director): trainer balance rails (level/species clamping)"
```

---

### Task 4: Theme seed table (data file, no test)

**Files:**
- Create: `src/data/llm-director/theme-seeds.ts`

**Step 4.1: Implement**

Static array of ~50 1-line theme seeds (start with 50, grow later). Each `{ id: string, text: string, tones: string[] }`. Cover variety: light, dark, comedic, tragic, mature, surreal, mystery, political, etc.

Examples to seed the file (the implementer should add ~50 total):

```ts
export const THEME_SEEDS = [
  { id: "underground-fixed-tournament", text: "Underground Pokémon tournament where every match is fixed except yours.", tones: ["mafia","tense"] },
  { id: "saint-with-a-price", text: "A forgotten saint walks among the towers, healing the ill — for a price.", tones: ["religious","ambiguous"] },
  { id: "league-collapse-mafias", text: "The League collapsed; rival mafias now run the gym circuit.", tones: ["dystopian","political"] },
  { id: "forest-cult", text: "The forests have a new religion. The Pokémon are its prophets.", tones: ["mystery","occult"] },
  { id: "haunted-lighthouse", text: "A coastal lighthouse where the tides bring back the dead.", tones: ["horror","melancholy"] },
  { id: "interdimensional-circus", text: "An interdimensional traveling circus stops in this region for one week.", tones: ["surreal","whimsical"] },
  { id: "war-of-the-clans", text: "Five rival clans fight a generations-old feud over a sacred Pokémon.", tones: ["political","tragic"] },
  { id: "champion-mystery", text: "The reigning Champion has gone missing. Someone is impersonating them.", tones: ["mystery","investigative"] },
  // ... 42 more
] as const;

export type ThemeSeed = typeof THEME_SEEDS[number];
```

**Step 4.2: Commit**

```
git commit -m "feat(llm-director): theme seed table (50 entries)"
```

---

### Task 5: Director state save data shape (TDD round-trip)

**Files:**
- Modify: `src/system/game-data.ts`
- Modify: `src/@types/save-data.ts`
- Create: `src/system/llm-director/director-state.ts`
- Test: `test/tests/llm-director/director-state-save.test.ts`

**Step 5.1: Write failing test** — round-trip save/load like `auto-egg-restock-save.test.ts` does. Default state when missing from save; persisted state restored on reload.

**Step 5.2-5.5:** add `llmDirectorState?: LLMDirectorState` to `SystemSaveData`, default factory in `director-state.ts`, serialize in `getSystemSaveData()`, restore in `initParsedSystem()` / load.

```
git commit -m "feat(llm-director): persist director state in system save data"
```

---

## Phase 2 — LLM client + generation

### Task 6: NanoGPT director client (TDD with mocked fetch)

**Files:**
- Create: `src/system/llm-director/director-client.ts`
- Test: `test/tests/llm-director/director-client.test.ts`

**Step 6.1: Write failing test**

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DirectorClient } from "#system/llm-director/director-client";

describe("DirectorClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("calls the OpenAI-compatible chat completions endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "{\"ok\":true}" } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new DirectorClient({ apiKey: "test", baseUrl: "https://x/api/v1" });
    const r = await client.complete({ model: "TEE/kimi-k2.6", messages: [{ role: "user", content: "hi" }] });
    expect(r.content).toBe("{\"ok\":true}");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://x/api/v1/chat/completions",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer test" }) }),
    );
  });

  it("times out after timeoutMs", async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const client = new DirectorClient({ apiKey: "test", baseUrl: "https://x/api/v1" });
    await expect(client.complete({ model: "x", messages: [], timeoutMs: 50 })).rejects.toThrow(/timeout/i);
  });

  it("retries on 5xx up to maxRetries times", async () => {
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      calls++;
      if (calls < 3) return Promise.resolve(new Response("err", { status: 503 }));
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: {} }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new DirectorClient({ apiKey: "test", baseUrl: "https://x/api/v1", maxRetries: 3, retryDelayMs: 1 });
    const r = await client.complete({ model: "x", messages: [] });
    expect(r.content).toBe("ok");
    expect(calls).toBe(3);
  });
});
```

**Step 6.2-6.4:** implement client with `AbortController` for timeout, exponential backoff retry on 5xx and network errors, returns `{ content, latencyMs, inputTokens, outputTokens }`.

**Step 6.5: Commit**

```
git commit -m "feat(llm-director): NanoGPT client (timeout, retry, telemetry)"
```

---

### Task 7: Context envelope builder (TDD pure)

**Files:**
- Create: `src/system/llm-director/context-envelope.ts`
- Test: `test/tests/llm-director/context-envelope.test.ts`

**Step 7.1: Write failing test**

Test that `buildContextEnvelope({state, scene})` returns an object with all required fields (storyBible, beatHistory, playerParty, factionRep, alignment, flags, npcMemory, recentPressure, lossRiskBudget, currentWaveIndex, currentAct, gameBalanceCard).

**Step 7.2-7.5:** Pure function reading from director state + globalScene. Compresses beatHistory older than 30 entries to digests (placeholder: just slice for v1; real summarization deferred to Task 21).

```
git commit -m "feat(llm-director): context envelope builder"
```

---

### Task 8: Story bible generator (TDD, mock client)

**Files:**
- Create: `src/system/llm-director/generate-story-bible.ts`
- Test: `test/tests/llm-director/generate-story-bible.test.ts`

**Step 8.1: Write failing test** — mock client returns canned story bible JSON; generator parses, validates, returns. Schema violation → 3 retries with error feedback; final fallback throws or returns null (caller's responsibility).

**Step 8.2-8.5:** Calls `TEE/deepseek-v4-pro:thinking` with a system prompt from `system-prompts.ts` and the chosen seed. Validates result against story-bible schema (extend AJV from Task 1). Returns `StoryBible` or throws after retries exhausted.

```
git commit -m "feat(llm-director): story bible generator"
```

---

### Task 9: Beat generator (TDD, mock client)

**Files:**
- Create: `src/system/llm-director/generate-beat.ts`
- Create: `src/data/llm-director/system-prompts.ts`
- Test: `test/tests/llm-director/generate-beat.test.ts`

**Step 9.1-9.5:** Two-phase generation: optionally call DeepSeek-thinking for structural skeleton (when type is `trainer_battle` — needs balanced team picks) → then Kimi K2.6 for prose-filling. Returns validated `Beat`. Handles retry-with-feedback on schema fail. Falls back to `narrative_only` after exhausting retries.

```
git commit -m "feat(llm-director): beat generator (deepseek skeleton + kimi prose)"
```

---

### Task 10: Director queue (pre-generation pipeline, TDD)

**Files:**
- Create: `src/system/llm-director/director-queue.ts`
- Test: `test/tests/llm-director/director-queue.test.ts`

**Step 10.1: Write failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { DirectorQueue } from "#system/llm-director/director-queue";

describe("DirectorQueue", () => {
  it("generates beat in background; tryTake returns it once ready", async () => {
    const generate = vi.fn().mockResolvedValue({ beatId: "b1", type: "narrative_only", introText: "x", bodyText: "y" });
    const q = new DirectorQueue({ generate });
    q.kickOff(3);
    await new Promise(r => setTimeout(r, 0));
    const b = await q.tryTake(3, { timeoutMs: 50 });
    expect(b?.beatId).toBe("b1");
  });
  it("tryTake times out and returns null if not ready", async () => {
    const generate = vi.fn().mockImplementation(() => new Promise(() => {}));
    const q = new DirectorQueue({ generate });
    q.kickOff(3);
    const b = await q.tryTake(3, { timeoutMs: 30 });
    expect(b).toBeNull();
  });
  it("ignores duplicate kickOff for same wave", () => {
    const generate = vi.fn().mockResolvedValue({} as any);
    const q = new DirectorQueue({ generate });
    q.kickOff(3); q.kickOff(3);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
```

**Step 10.2-10.5:** Implement Map-based queue with `kickOff(wave)`, `tryTake(wave, {timeoutMs})`, `cancel()`. Promise-based.

```
git commit -m "feat(llm-director): pre-generation queue (1-ahead buffer)"
```

---

## Phase 3 — Game mode integration

### Task 11: Register `GameModes.LLM_DIRECTOR`

**Files:**
- Modify: `src/enums/game-modes.ts`
- Modify: `src/game-mode.ts`

**Step 11.1: Add enum entry** `LLM_DIRECTOR`. Find next available numeric value (read existing entries first).

**Step 11.2:** Register in the `gameModes` map in `game-mode.ts` with properties: inherits Classic's starter selection, level curve, wave count 200; sets `nonDeterministic: true` (add this property to `GameMode` type if not present).

**Step 11.3:** Typecheck only — no runtime behavior yet.

```
pnpm typecheck
git commit -m "feat(llm-director): register LLM_DIRECTOR game mode"
```

---

### Task 12: Theme picker UI handler

**Files:**
- Create: `src/ui/handlers/llm-director-theme-picker-ui-handler.ts`
- Modify: `src/enums/ui-mode.ts` (`LLM_DIRECTOR_THEME_PICKER`)
- Modify: `src/ui/ui.ts` (register handler)
- Create: `locales/en/llm-director.json`

**Step 12.1: Add UI mode + register handler** — same pattern as `auto-egg-restock-ui-handler.ts` from feat/egg-qol.

**Step 12.2: Implement handler** — windowed UI showing the rolled seed text. ACTION on "Re-roll" picks another from `THEME_SEEDS`. ACTION on "Accept" emits an event/callback with the chosen seed and reverts mode.

**Step 12.3:** Manual smoke (deferred — wired to flow in Task 19).

```
git commit -m "feat(llm-director): theme picker UI handler"
```

---

### Task 13: Story bible phase + overlay

**Files:**
- Create: `src/phases/llm-director-bible-phase.ts`

**Step 13.1: Implement phase** — shows a Phaser overlay "Preparing your story...", calls `generateStoryBible(seed)`, on success writes to `gameData.llmDirectorState.storyBible`, kicks off `directorQueue.kickOff(3)` for first beat, then `this.end()`. On failure (after retries): error overlay with "Director unavailable. Falling back to Classic mode." + actually fall back (set mode to CLASSIC).

**Step 13.2: Commit**

```
git commit -m "feat(llm-director): story bible generation phase"
```

---

### Task 14: Beat phase scaffold (router)

**Files:**
- Create: `src/phases/llm-director-beat-phase.ts`

**Step 14.1: Implement** — phase that pulls beat from `directorQueue.tryTake(currentWave)`, switch on `beat.type`:
- `narrative_only` → show text, end
- `dialogue_choice` → push `LlmDirectorBeatUiHandler` mode (Task 15)
- `trainer_battle` → wire into existing battle flow (Task 16)
- `biome_transition` → wire into biome select (Task 17)
- `item_event` → grant items, show text
- Buffer underrun (tryTake returns null) → log, fire vanilla mystery encounter or trainer wave

**Step 14.2: Commit**

```
git commit -m "feat(llm-director): beat phase router scaffold"
```

---

### Task 15: Beat UI handler — dialogue / narrative / item event

**Files:**
- Create: `src/ui/handlers/llm-director-beat-ui-handler.ts`
- Modify: `src/enums/ui-mode.ts`
- Modify: `src/ui/ui.ts`

**Step 15.1: Implement** — windowed dialogue handler. Renders speaker name, intro text via `showDialogue`/`showText` API. For `dialogue_choice`, renders 2-3 option labels; ACTION on selected option fires the callback with chosen consequence. For `narrative_only`, just shows text and ACTION ends. For `item_event`, shows text and resolves consequence.

**Step 15.2:** Manual smoke (in Task 19's end-to-end).

```
git commit -m "feat(llm-director): dialogue/narrative/item beat UI"
```

---

### Task 16: Beat UI integration — trainer battle

**Files:**
- Modify: `src/phases/llm-director-beat-phase.ts`
- Modify: `src/data/mystery-encounters/utils/encounter-phase-utils.ts` (only if needed — likely just import `initBattleWithEnemyConfig`)

**Step 16.1: Implement** — for `trainer_battle` beats: build an `EnemyPartyConfig` from `beat.trainerType + speciesSwaps + levelDelta` (clamped via `clampTrainerBattle`), call `initBattleWithEnemyConfig`. Show `preBattleText` first.

**Step 16.2: Commit**

```
git commit -m "feat(llm-director): trainer_battle beat wiring"
```

---

### Task 17: Beat UI — biome transition

**Files:**
- Modify: `src/phases/llm-director-beat-phase.ts`
- Modify: `src/ui/handlers/llm-director-beat-ui-handler.ts`

**Step 17.1: Implement** — for `biome_transition` beats: render N biome options with flavor text. ACTION on selected option triggers existing biome-change flow (find existing biome-select handler reference; wire similarly).

**Step 17.2: Commit**

```
git commit -m "feat(llm-director): biome_transition beat wiring"
```

---

### Task 18: Inter-beat trainer override pipeline

**Files:**
- Modify: `src/phases/new-battle-phase.ts`
- Modify: `src/system/llm-director/director-queue.ts` (add inter-beat override storage)

**Step 18.1: Implement** — during `NewBattlePhase`, if `gameMode === LLM_DIRECTOR` and there's a pending `interBeatOverride` for the current wave (set by the most recent fired beat), apply it to the trainer generation step before `executeWithSeedOffset`. Override drops `speciesSwaps` and `levelDelta` into the trainer config.

**Step 18.2: Commit**

```
git commit -m "feat(llm-director): apply interBeatOverrides during NewBattlePhase"
```

---

### Task 19: Wave-cadence hook (every 3 waves fire beat phase)

**Files:**
- Modify: `src/battle-scene.ts` (in `newBattle()` or its callers, after wave advance)
- Modify: `src/phases/new-battle-phase.ts` or wherever wave advance lands

**Step 19.1: Implement** — on wave advance in Director mode, if `(waveIndex % 3 === 0)`, push `LLMDirectorBeatPhase` before any vanilla wave content. Otherwise vanilla flow continues.

**Step 19.2: Manual end-to-end smoke** — start a Director run, confirm: theme picker fires, bible loads, beat at wave 3 renders, choice applies consequence, wave 4-5 vanilla, beat at wave 6 renders.

**Step 19.3: Commit**

```
git commit -m "feat(llm-director): wave cadence hook (beat every 3 waves)"
```

---

### Task 20: Game mode select UI integration

**Files:**
- Modify: `src/ui/handlers/game-mode-select-ui-handler.ts` (or wherever modes are listed)
- Modify: `locales/en/game-mode.json`

**Step 20.1: Add Director mode to the list** with title + blurb.

**Step 20.2: Wire start-flow** — selecting Director routes through theme picker → bible phase → first wave (instead of straight to wave 1 like Classic).

**Step 20.3: Manual smoke** — pick mode from the menu, confirm full flow.

**Step 20.4: Commit**

```
git commit -m "feat(llm-director): mode select integration + start flow"
```

---

## Phase 4 — Failure paths + polish

### Task 21: Filler prefab beats + queue underrun handling

**Files:**
- Create: `src/data/llm-director/filler-beats.ts`
- Modify: `src/phases/llm-director-beat-phase.ts`

**Step 21.1: Implement** — array of ~5 generic prefab `narrative_only` beats. When `directorQueue.tryTake` returns null (underrun), pick a prefab beat at random, render it, log telemetry. Game continues.

**Step 21.2: Commit**

```
git commit -m "feat(llm-director): filler prefabs + queue underrun fallback"
```

---

### Task 22: Beat history compaction

**Files:**
- Create: `src/system/llm-director/compact-history.ts`
- Test: `test/tests/llm-director/compact-history.test.ts`

**Step 22.1: TDD** — when `beatHistory` length > 30, summarize entries older than the last 20 via one Kimi call into 2-line `digest` strings, replace verbatim entries with digest entries.

**Step 22.2: Commit**

```
git commit -m "feat(llm-director): beat history compaction (Kimi summarize)"
```

---

### Task 23: Debug overlay

**Files:**
- Create: `src/ui/handlers/llm-director-debug-overlay.ts`
- Modify: `src/configs/inputs/cfg-keyboard-qwerty.ts` (bind a key, e.g. `KEY_F12` to toggle)

**Step 23.1: Implement** — toggle-able overlay showing last 10 LLM calls (model, latency, tokens, status). Off by default.

**Step 23.2: Commit**

```
git commit -m "feat(llm-director): toggleable debug telemetry overlay"
```

---

### Task 24: End-to-end manual smoke + final lint/typecheck

**Step 24.1: Full suite**

```
pnpm test:silent
pnpm typecheck
pnpm biome    # changed files only
```

All must pass.

**Step 24.2: Real end-to-end run**

Set `VITE_NANOGPT_API_KEY` correctly, `pnpm start:dev`. Run a full 30-wave Director run. Verify:
- Theme picker rolls and accepts
- Story bible generates within ~10s
- First beat fires at wave 3, has choices, applies consequence
- Vanilla waves play between beats
- Next beat ready in time at wave 6, 9, 12, ...
- Trainer battles use generated overrides
- Save mid-run, reload, continue — director state intact
- Kill network mid-run; vanilla fallback fires; reconnect; generation resumes

**Step 24.3: Final commit**

If any cleanup needed:
```
git commit -m "chore(llm-director): final cleanup"
```

---

## Implementation notes

- **TaskCreate todos**: maintain a TaskCreate item per task as you go.
- **Branch hygiene**: stay on `feat/llm-director`. Don't merge into `feat/egg-qol`.
- **Cost is not a constraint** — user has prepaid the proxy. Don't optimize cache aggressively in v1.
- **Skip tests**: every Phase 1 + 2 task should have unit tests. Phase 3 is integration (manual smoke OK). Phase 4 has at least one TDD task (compaction).
- **Schema-first**: never trust LLM output. Validate with AJV. On failure, retry with the validation error appended. Final fallback always available.
- **Pre-generation timing**: first beat (wave 3) generation kicks off during starter selection + waves 1-2. Subsequent beat generations are kicked off the moment the previous beat resolves. Buffer is always 1-ahead.
- **Determinism**: Director runs are flagged `nonDeterministic: true` so daily-seed code skips them. Don't try to seed the LLM.
- **Out-of-scope for v1** (deferred to v2): brutal trainer overrides beyond +3, custom seed input, in-game settings panel, runEnd consequences, escape predicate DSL, Director personality picker.
