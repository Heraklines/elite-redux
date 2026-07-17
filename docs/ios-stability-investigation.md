# iOS boot-stability investigation

**Branch:** `feat/type-nativization` (measured at `f6bb7ea32`, clean)
**Reported symptom:** "On mobile the game crashes a lot on load. Very unstable on
iOS. People have been using Safari or Discord [in-app browser]."
**Nature:** crashes happen *before/around boot*; no iOS dev-logs exist because our
capture never ran on those devices and never recorded device info.

This is a measured investigation. Every number below is from the production build
(`npx vite build`, exit 0) and the local `../er-assets` asset checkout — not
estimated from memory. The one shipped code change (boot diagnostics) is described
at the end; all *mitigations* are proposals for maintainer approval, not applied.

---

## TL;DR — ranked root-cause hypotheses

| # | Hypothesis | Measured evidence | iOS mechanism | Confidence |
|---|-----------|-------------------|---------------|-----------|
| 1 | **Boot decodes ~189 MB of BGM to PCM in RAM** | 11 BGM files decoded at boot → ~189 MB float32 PCM (menu 39 MB, victory_gym 41 MB, victory_team_plasma 32 MB, evolution 30 MB, victory_trainer 22 MB, victory_champion 21 MB) | WKWebView (Discord) jetsam limit is well under Safari's ~1–1.5 GB; +190 MB of decoded audio on top of JS heap + textures pushes past the per-tab cap → page killed | **High** |
| 2 | **A single 6.16 MB JS chunk parses on the black screen before the loading bar** | `battle-DTT_VePb.js` = 6,161,255 B raw (gzip 944 KB); statically imported by the entry **and** by `loading-scene` | WebKit parses + JIT-compiles the whole chunk synchronously before first paint; bytecode + heap for a 6 MB module is large and spikes memory exactly in the pre-title crash window | **High** |
| 3 | **~12 MB of JS on the boot-critical path total** | entry 1.04 MB + BBCodeText 1.38 MB + battle-scene 1.72 MB + loading-scene 1.77 MB + battle 6.16 MB ≈ **11.7 MB raw / ~2.5 MB gzip** parsed before the title | Cumulative parse memory + main-thread block; on a slow A-series device the block can exceed the WebKit watchdog and the network fetch can stall in the Discord webview | **Med-High** |
| 4 | **Synchronous `initializeGame()` inside `preload()`** | `initializeGame()` (src/init/init.ts) is called synchronously from `LoadingScene.preload()`; it registers **881 ER-custom species** + custom moves + abilities on the main thread in one blocking pass | A multi-hundred-ms main-thread block during boot; on iOS a long unyielded block during page load raises the odds of a watchdog kill / "page reloaded" | **Med** |
| 5 | **~1,850+ CDN requests fired at boot** | 881 ER-custom + 45 newcomer icon atlases × (png+json) ≈ 1,852 requests, plus 203 arena PNGs, ~200 UI PNGs, 11 BGM, 39 SE, fonts | The Discord in-app browser throttles/*stalls* large parallel request fans; a stalled connection pool during boot can wedge the loader (mitigated only by the 15 s per-file timeout) | **Med** |
| 6 | **No WebGL safety flags on a high-res fixed canvas** | Phaser `type: WEBGL`, `scale 1920×1080 FIT`, no `powerPreference` / `failIfMajorPerformanceCaveat` / `maxTextures` / `pixelArt` | On a GPU-poor / backgrounded iOS tab the context can be refused or lost; nothing degrades gracefully | **Low-Med** |

Textures are **not** a top suspect: the boot texture set is ~75 MB of GPU RAM and
**no boot texture exceeds 2048 px** (largest is 630×630), so the hard iOS WebGL
`MAX_TEXTURE_SIZE` limit (4096 on older devices) is never hit.

---

## (a) Build profile

Command: `npx vite build` → exit 0, built in 16.6 s. `dist/` total **26 MB**.

**JS: 14.27 MB raw across 31 chunks.** The bundle is *split* (31 chunks) but has
one monolithic core. Largest chunks:

| Chunk | Raw | gzip | On boot path? |
|-------|-----|------|---------------|
| `battle-DTT_VePb.js` | **6,161 KB** | 944 KB | **Yes** — imported by entry + loading-scene |
| `loading-scene-C4pYIE7h.js` | 1,772 KB | 454 KB | Yes |
| `battle-scene-DmaemCki.js` | 1,725 KB | 482 KB | Yes |
| `BBCodeText-C9IaWY3F.js` | 1,382 KB | 373 KB | Yes — modulepreloaded in index.html |
| `index-YOsI5fu_.js` (entry) | 1,045 KB | 260 KB | Yes |
| `coop-runtime-DRHFYAlI.js` | 747 KB | 182 KB | No — co-op only |
| `er-ghost-teams-lJMLlusx.js` | 606 KB | 176 KB | No — lazy |
| `test-suite-DNqqy266.js` | 509 KB | 164 KB | No — dev/staging only (registry gate) |
| `ajv-DPFkHYT5.js` | 120 KB | 34 KB | No |

**Boot-critical JS total ≈ 11.7 MB raw / ~2.5 MB gzip** (the first five rows).

**Why the 6 MB chunk exists:** `vite.config.ts` defines **no `manualChunks`**, and
`chunkSizeWarningLimit: 10000` (10 MB) *suppresses* the warning that would normally
flag a 6 MB chunk. Rolldown packs the entire game-data/core graph (species, moves,
abilities, battle logic — everything `init.ts` and `battle-scene` transitively pull)
into one chunk. Because `loading-scene` statically imports `initializeGame`, this
6 MB chunk is on the dependency graph of the loading scene itself, so it is fetched
and parsed **before the loading bar can render** — i.e. during the initial black
screen, the exact window testers describe.

## (b) Boot-time asset footprint

Loaded during the 0–100 % `LoadingScene` preload (src/loading-scene.ts):

**Textures — ~75 MB GPU RAM, no oversized atlas.**
Sum of `w×h×4` over the boot-loaded PNG set ≈ **75 MB** (RGBA, uncompressed as WebGL
uploads it). Nothing exceeds 2048 px; largest boot textures:

| Texture | Dims | GPU |
|---------|------|-----|
| `pokemon_icons_1v.png` | 630×630 | 1.51 MB |
| `pokemon_icons_3v.png` / `5v.png` | 600×600 | 1.37 MB each |
| `effects/shiny*.png` (×3) | 455×539 | 0.94 MB each |
| `egg/egg_lightrays.png` | 638×360 | 0.88 MB |

The 881 + 45 ER-custom icon atlases are each only 32×64 (~8 KB GPU) — negligible
memory, but see request-count below.

**Audio — ~189 MB decoded PCM RAM (the headline).**
`loadBgm` queues 11 BGM tracks; Phaser's `WebAudioSoundManager` calls
`decodeAudioData` on each at load, holding the *decompressed* float32 PCM (≈ 0.34 MB
per stereo second at 44.1 kHz) in memory for the whole session:

| BGM | mp3 | ~duration | ~PCM |
|-----|-----|-----------|------|
| menu.mp3 | 1.81 MB | 116 s | **39 MB** |
| bw/victory_gym.mp3 | 1.92 MB | 123 s | **41 MB** |
| bw/victory_team_plasma.mp3 | 1.48 MB | 94 s | 32 MB |
| bw/evolution.mp3 | 1.37 MB | 88 s | 30 MB |
| bw/victory_trainer.mp3 | 1.01 MB | 64 s | 22 MB |
| bw/victory_champion.mp3 | 0.95 MB | 61 s | 21 MB |
| 5 fanfares/heal | small | 2–6 s | ~6 MB total |
| **Total** | **8.6 MB mp3** | | **~189 MB PCM** |

Plus 39 short SE (`loadSe`) — small individually but all decoded too. **Only
`menu.mp3` is needed at the title.** The 6 victory/evolution tracks (≈150 MB of the
189 MB) are not used until deep into a run, yet they are decoded and resident from
the first second.

## (c) Known iOS footguns in the code

- **Phaser config** (src/main.ts): `type: Phaser.WEBGL` (no AUTO/canvas fallback),
  `scale 1920×1080 FIT`, `antialias: false`, `dom.createContainer: true`
  (single canvas — no multi-canvas problem). **Not set:** `powerPreference`,
  `failIfMajorPerformanceCaveat`, `maxTextures`, `pixelArt`. So there is no graceful
  path if the GL context is refused/lost — the page just dies.
- **Service worker:** intentionally *disabled* and self-healing (index.html
  unregisters any stale SW + purges caches, one-time reload). This is **not** a
  footgun; it is correct. The one-shot `window.location.reload()` only fires when a
  stale worker exists.
- **localStorage at boot:** the save layer writes through `trySetLocalStorageItem`
  (src/system/game-data.ts) which is `try/catch` + quota-aware, so private-mode /
  quota throws are handled. **Not** a primary suspect.
- **Synchronous boot work:** `initializeGame()` runs *synchronously* inside
  `LoadingScene.preload()` and registers 881 ER-custom species + moves + abilities
  in one main-thread pass (hypothesis #4). This never yields to the event loop.

## (d) Delta analysis — what recent patches added to BOOT

- **Confirmed safe:** newcomer/ER-custom *battle atlases* (front/back sheets, the
  large sprites) are **not** boot-loaded — they stream on demand per battle. The
  loading scene only boot-loads the small `er_icon__<slug>` *icon* atlases
  (`loadEliteReduxCustomIcons`).
- **Regression introduced by data growth:** every ER-custom species icon **is**
  boot-loaded — `for … ER_SPRITE_MANIFEST … speciesId ≥ 1026 → loadAtlas(er_icon__…)`
  = **881** atlases, plus **45** newcomer icons. Each is a png+json pair, so the ER
  icon set alone adds **~1,852 CDN requests** to boot. Memory cost is small (icons
  are tiny); the cost is the **request fan** (hypothesis #5), which grows every time
  species are added. No single newcomer asset is oversized, but the *count* is now a
  boot liability on constrained mobile networks / the Discord webview.

---

## Mitigation plan (proposals — not applied)

Ordered by impact ÷ effort. Numbers are the measured savings from §(a)/(b).

### P1 — Lazy-decode non-title BGM  ·  ~150 MB RAM  ·  low effort
Remove the 6 victory/evolution BGM from the `LoadingScene` preload and load+decode
them on first use (they are already loaded on demand elsewhere via
`battle-scene.ts loadBgm`). Keep only `menu.mp3` (+ the tiny fanfares if a title
flow needs them) at boot. **Frees ~150 MB of resident PCM** — the single biggest win
and the most likely direct cause of the WKWebView kills. Effort: delete ~6 lines
from `loading-scene.ts`, verify the deferred `playBgm` path still loads them.
Risk: a brief first-play decode hitch on those tracks (acceptable).

### P2 — Split the 6.16 MB `battle` chunk  ·  parse-memory + first-paint  ·  med effort
Add `build.rollupOptions.output.manualChunks` (or `advancedChunks` for Rolldown) to
break the monolith along seams that are already lazy-ish: species/forms data, moves
data, abilities data, mystery-encounters. Target: no chunk > ~1.5 MB. Also lower
`chunkSizeWarningLimit` to ~2000 so this can't silently regress. **Reduces the
synchronous parse spike on the pre-title black screen.** Effort: iterate on a
`manualChunks` map + re-measure; medium because the graph is tangled (keep
`strictExecutionOrder` + the rex-plugin timing constraint in mind).

### P3 — Defer / chunk the boot icon-atlas fan  ·  ~1,850 fewer boot requests  ·  med effort
The ER-custom icons are preloaded so starter-select / save-slot grids don't flash
blank. Options: (a) load them in the `LoadingScene.create()`/post-title idle instead
of the blocking preload; or (b) pack the 881 icons into a handful of combined
atlases (build-time TexturePacker step) so it's ~5 requests, not ~1,850. (b) is the
durable fix and also cuts per-request overhead. Effort: medium (needs an asset build
step or a load-phase move); coordinate with the er-assets pipeline.

### P4 — Yield during `initializeGame()`  ·  main-thread block  ·  med effort
Break the 881-species registration into `await`-yielded batches (or move it off the
synchronous `preload()` into an async init that yields every N species) so the event
loop can breathe during boot. Effort: medium; must preserve init ordering
(`initSpecies` → `initEliteReduxSpecies` → custom species → …).

### P5 — Add WebGL safety flags  ·  graceful failure  ·  low effort
Set `powerPreference: "default"` (or `"low-power"`) and consider a
context-lost handler that shows a "reload" prompt instead of a dead page. Low effort,
low but nonzero payoff. Do **not** switch to `Phaser.AUTO` (canvas fallback would be
unplayably slow); keep WEBGL but fail loudly.

### P6 — Audio format  ·  RAM + download  ·  low-med effort
If P1 is not enough, the resident PCM for whatever stays at boot can be halved by
mono where acceptable, or shortened loop points. Secondary to P1.

**Expected combined effect:** P1 alone removes ~150 MB of the ~189 MB audio RAM;
P1+P2 together attack both the RAM ceiling (hypothesis #1) and the parse spike
(#2/#3), which are the two high-confidence causes. That should materially reduce the
iOS/WKWebView jetsam kills without any gameplay change.

---

## Shipped in this pass — boot diagnostics (so the NEXT report is triage-able)

The mitigations above need maintainer sign-off. What *did* ship (committed, not
pushed) is a diagnostics patch so the next iOS crash report actually carries the
missing evidence:

- **New module** `src/data/elite-redux/er-boot-diagnostics.ts` — captures a device
  fingerprint (`userAgent` / `platform` / `screen` + `devicePixelRatio` /
  `navigator.deviceMemory`) and a **boot-milestone breadcrumb trail**
  (`boot-start` → `loading-complete` → `title-shown`) **persisted to localStorage**.
  On the next load it reads the previous session's trail *before* overwriting it, so
  a crash-then-reload reports `lastSess: crashed after <milestone>`. Fully
  feature-detected + `try/catch` (private-mode / quota / headless safe) — it can
  never itself break boot.
- **Wired** at `main.ts` (boot-start), `loading-scene` COMPLETE (loading-complete),
  and `TitlePhase.start` (title-shown); **rendered** in both the in-game bug-report
  header (`er-bug-report.ts`) and the dev-tools "Send Logs" header
  (`test-suite/index.ts`).
- **Tests** extended in `test/tests/elite-redux/data/er-bug-report.test.ts` (5/5
  green). `tsc` = 295 (baseline unchanged), biome clean on changed files.

With this, the next mobile report will show exactly which device model class it was
(via UA + deviceMemory + DPR) and **which milestone the crashed session died after** —
turning "crashes on load" into "crashed after loading-complete on a 3 GB device,"
which points straight at hypothesis #1/#2.
