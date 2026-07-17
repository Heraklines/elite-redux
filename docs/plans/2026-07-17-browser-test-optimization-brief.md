# Browser + test-speed optimization — executable engineering brief

Date: 2026-07-17. Status: APPROVED SPEC (three-round adversarial review, converged).
Goal: 2-4x wall-clock reduction across the co-op browser lanes and the local test
loop **without weakening any fidelity lane**. This brief is the single source of
truth; the fidelity contract section is non-negotiable.

## Fidelity contract (unchanged, restated)

Exact app/assets SHA; real staging APIs; native Chromium WebRTC; **two isolated
browser processes** (one per seat — never one process for both players; prior
renderer-starvation incident); public-VISIBLE user input with no scene mutation
(the R1 boundary definition — scene input is real keys; visibly-focused DOM
credential fields may take human-equivalent bulk insertion); read-only observation;
per-transition mechanical convergence; headed animation coverage. Optimization
removes REPEATED PROOF and DEAD WAITING, never steps.

## Measured baseline (2026-07-16/17)

| Surface | Cost | Dominant cause |
| --- | --- | --- |
| Save-mutation journey | 24m42s | input pacing, cold reloads, evidence I/O, screenshots |
| Campaign profile | ~12m; ~9m before wave 1 (6.5m login/onboarding) | cold boot, credential typing, no cache seed |
| Evidence volume | ~48k events / ~45k response records per journey | one serialized `appendFile` PER EVENT (evidence.mjs:841); every static response recorded (evidence.mjs:1083); waiters rescan growing arrays |
| Focus arbitration | >2m per journey | ONE xvfb display for both Chromiums (campaign.yml:407) + module-global input queue (public-ui-harness.mjs:420); same-page fronting skip exists but seats ALTERNATE in duo, so the alternation case is the common case |
| HTTP | ~7,500 responses per cold seat | preview server `Cache-Control: no-store` on sealed files AND exact-SHA CDN redirects (preview-server.mjs:144); fresh incognito contexts discard cache |
| Observer | 6 observers on a 100ms setInterval incl. full mechanical digests (coop-browser-entry.ts:1061) | polling, not revision-driven |
| Transport gate | boots the ENTIRE game twice via `await import("../src/main")` (coop-browser-transport-entry.ts:12) | no connector factory |
| Local vitest | ~57s/invocation, tests=~5s | boot+transform+ER init per run; `watch:false` in config; er-species.ts (4.7MB TS) = 1.26s esbuild per worker (measured) |
| tsc | 3-7min per check | no `incremental` |
| Sharded-gate browser-build | full prod Vite build every push | NO bundle cache (the CAMPAIGN workflow already has the correct source-keyed cache + re-seal pattern at coop-public-ui-campaign.yml:184 — copy it, do not reinvent) |

## Requirements (all binding)

### R1. Input: event-acknowledged pacing + per-seat isolation
- Two persistent Chromium processes, one per seat, **separate Xvfb displays**,
  per-seat input queues. Processes reused across scenarios; NEVER one process
  or one display for both seats. Separate displays remove CROSS-SEAT focus
  competition, not all fronting: each seat still performs its own focus
  establishment after opening/replacing a page — the target state is per-seat
  focus management with NO global arbitration.
- Replace fixed key cadence with per-input-CLASS acknowledgments: selected
  option changed / surface generation changed / expected phase opened /
  addressed command rendezvous completed. A generic "evidence cursor advanced"
  is NOT an acceptable ack (unrelated events would satisfy it → racy passes).
  Keep `COOP_UI_ACTION_DELAY_MS` as a fallback override for triage.
- Input boundary DEFINITION (supersedes a literal "keyboard only" reading):
  public-VISIBLE user input with no scene mutation. Registration already uses a
  visible canvas pointer click, and event-acks cannot accelerate
  `keyboard.type()` into DOM credential fields — so human-equivalent bulk
  paste/IME insertion into a VISIBLY FOCUSED credential field is permitted,
  verified by field LENGTH (never recorded values), submitted with a real key.
  This removes the measured 2-3min of credential typing without touching scene
  input fidelity.
- NOTE: campaign already runs fast cadence (70/70, settle 300 — campaign.yml:389);
  the biggest pacing wins are the normal-cadence journeys and credential typing.

### R2. Evidence: bounded-loss buffered stream
- Batched writes every 100-250ms or 64KiB, whichever first (PERIODIC guarantee —
  hooks alone cannot protect hang→SIGKILL; only the final sub-second batch may
  be lost).
- Await stream drain at transitions and checkpoints; bounded flush + `fdatasync`
  on failure, SIGINT, SIGTERM, uncaught exception.
- **`current-waits.json` sidecar**: a bounded ACTIVE-WAIT MAP (host and guest
  waits overlap; a single overwritten value is insufficient). Per entry: unique
  wait id + seat, expected event/surface/address, starting evidence cursor,
  start time + deadline, last observed progress. No credentials or request
  bodies. Updated ATOMICALLY (temp-file + rename, or tiny synchronous
  replacement) on wait start/progress/completion — a kill during truncation
  must never leave torn/misleading evidence. Survives SIGKILL and preserves the
  "AWAIT → network-wait" fingerprint when the final batch is lost.
- Indexed event waiters (no `slice(from)` rescans of growing arrays).
- Successful static responses: ONE deterministic inventory digest + aggregate
  counts, not per-response events. Network telemetry must measure ACTUAL
  transferred bytes, not just `response.fromCache()`: record CDP
  `encodedDataLength` (or Resource Timing transfer size) + provenance, with
  DISTINCT classifications for network / disk-cache / revalidated (304) /
  service-worker responses. Complete records stay for API calls and errors.

### R3. Screenshots: semantic checkpoints by default
- Semantic/digest checkpoints everywhere; small compositor-health capture per
  wave; full PNG once per distinct surface/render profile; full captures from
  BOTH seats on every failure. Screenshot-every-checkpoint + full DOM/cookie
  dumps + Chrome tracing only in diagnostic mode (reproductions / failed
  reruns). EXCEPTION: structured SANITIZED cookie/storage METADATA (names,
  scopes, counts — never values) is retained at authentication, context
  replacement, and final save boundaries — it is part of the isolation PROOF,
  not diagnostics.

### R4. Observer: four-trigger digest, FIXED detection SLA
Full digest is recomputed on: (1) every transition/rendezvous boundary,
(2) revision/phase/surface-generation change, (3) every acknowledged public
input, (4) a FIXED 1-second watchdog while parked on a synchronized interactive
surface. Revision-only gating is FORBIDDEN — the oracle exists to catch
mutations that DON'T bump a tracked revision. The cheap surface detector stays
at 100ms.
**Detection latency is an SLA, not a tunable**: record digest duration and
enforce a p95 digest-cost budget. A digest exceeding the budget is a
PERFORMANCE FAILURE of the run (optimize or offload the digest) — it must NEVER
silently widen the detection interval. Adaptive widening is forbidden: a slow
runner would receive weaker desync detection exactly when timing problems are
most likely.

### R5. Caching: immutable where production is immutable
- Preview server: `index.html` stays no-store; hashed chunks and exact-SHA CDN
  redirects become `immutable` (this is MORE production-faithful — prod serves
  content-addressed assets as immutable).
- Two persistent per-seat profiles; clear account/site storage between
  scenarios WITHOUT clearing HTTP cache — FOR JOURNEYS THAT DO NOT TEST CONTEXT
  REPLACEMENT. The save-mutation journey's brand-new `BrowserContext` + visible
  re-login is a deliberate cold-context PROOF and is retained as-is; persistent
  profiles never substitute for it.
- **NEVER clone a logged-in profile** (credentials/cookies). Seeds allowed:
  pre-auth HTTP-cache seed, or sanitized settings-only localStorage seed
  (settings location confirmed: game-data.ts:1495). Pre-provisioned accounts +
  visible login for gameplay journeys; registration stays covered by the cold
  canary.

### R6. Transport: three-tier coverage (all three required)
1. Fast minimal bundle using the EXACT production connector factory (extracted,
   UI-independent) — real signaling, protocol, fingerprinting, chunker,
   reconnection, Chromium WebRTC. Test body < 1min.
2. Full-application canary proving `src/main` wires THAT SAME factory (the
   runCoopInteraction lesson: extracted primitive green while production wiring
   rots).
3. Public-UI lane proving lobby/identity/save/gameplay integration.

### R7. CI caches (copy the campaign's existing pattern)
- Source-keyed browser-bundle cache for the sharded gate + journey workflows,
  copied from coop-public-ui-campaign.yml:184 INCLUDING its key completeness
  (src/**, public/**, entries, sealer, vite config, lockfile, the workflow
  itself) and its mandatory RE-SEAL step (restored bundle re-stamped with
  current SHA; bad reuse fails loudly at manifest verification).
- `~/.cache/puppeteer` cached, keyed on OS + architecture + resolved browser
  build id (or the lockfile identity that pins it), restored BEFORE the install
  step so the install becomes a no-op on hit.
- `tsc --incremental` + `.tsbuildinfo` cached with a key of compiler version +
  tsconfig identity and a BRANCH RESTORE-KEYS PREFIX (an exact-source key gives
  zero incremental reuse after any edit — the prefix restore is the entire
  point). tsc still RUNS every time; only its warm-start state is cached.

### R8. Local loop
- Document `pnpm exec vitest --watch <file>` as the dev loop (config sets
  `watch:false`, so the flag is required). Boot paid once; leaf re-runs are
  seconds; shared-setup changes invalidate more (expected).
- Node-only vitest project (strictly import-bounded: no jsdom/Phaser/setup
  files) for pure-logic tests — protocol reducers, persistence round-trips,
  resolvers. Ranks ABOVE the JSON experiment.

### R9. ER JSON conversion = isolated benchmark branch, not a committed win
Gate on ALL of: canonical data equality, type behavior, bundle size, Vite build
time, Vitest cold time, production boot time. Motivation stands (4.7MB TS,
1.26s/worker esbuild measured; Vite 8 large-JSON stringification) but species
construction/ER init may dominate parsing.

## Acceptance metrics — four distinct measures, budgeted separately

| Scenario | Test body | CI job | Workflow critical path | Local warm / cold |
| --- | --- | --- | --- | --- |
| Transport gate | < 1min | body + runner/checkout/deps/artifact/Chrome overhead (report separately) | — | — |
| Cold e2e canary | 3-5min | +overhead | — | — |
| Ordinary duo journey | 3-6min | +overhead | — | — |
| Save-mutation journey | 6-10min | +overhead | — | — |
| 30-wave depth campaign | 8-15min | +overhead | — | — |
| Full gate | — | — | measure before/after; budget after stage-timing data | — |
| Single vitest file | — | — | — | 2-5s warm (watch) / cold: MEASURE after Layer-0 + JSON A/B (no committed number — the only direct measurement is 1.26s/worker transform) |

Stage-timing instrumentation (per-stage timestamps in evidence) lands FIRST so
every later change is measured against real budgets, not estimates.

## Ownership — BY FILE, not by concept (amendment 4)

Two efforts, hard file boundaries, sequential commits where a file is shared:

**Effort A — harness/runtime (coop seat, one coordinated implementation):**
- test/browser/coop-public-ui/public-ui-harness.mjs (R1)
- test/browser/coop-public-ui/evidence.mjs (R2, R3)
- test/browser/coop-public-ui/preview-server.mjs (R5)
- test/browser/coop-public-ui/campaign*.mjs, config.mjs (R1, R3, stage timing)
- scripts/coop-browser-entry.ts (R4)
- scripts/coop-browser-transport-entry.ts + new connector factory module (R6)
- .github/workflows/coop-public-ui-campaign.yml, coop-public-ui-journey.yml
  (R1 displays, R7 for journey)

**Effort B — pipeline (this seat):**
- .github/workflows/coop-gate-sharded.yml — ONLY the browser-build cache + the
  puppeteer cache steps (R7). SEQUENCED: land after/around Effort A's workflow
  edits or via coordinated single commit — this file is shared.
- tsconfig.json (+CI cache step) (R7 tsc)
- vitest config/projects for the Node-only lane (R8) — new project file; the
  shared vitest.config.ts edit is a 3-line include and must be its own commit.
- CLAUDE.md (watch-mode + budget docs)
- Isolated benchmark branch for R9 (touches er-species/er-moves + a wrapper;
  NO merge without the six-gate benchmark result).

**Shared-file register (the honest overlap — "pipeline" is NOT fully outside
co-op territory):**

| File | Touched by | Rule |
| --- | --- | --- |
| .github/workflows/coop-gate-sharded.yml | B (caches) + A (browser lane) | B lands FIRST (small steps-only diff), A rebases |
| scripts/run-coop-gate.mjs + lane inventory | B (Node-only lane classification) + A (timing) | B lands FIRST, A rebases |
| vitest.config.ts | B only (3-line project include, own commit) | single-owner |
| test inventory / timing manifests | A (stage timing) + B (Node lane entries) | B's entries land FIRST |
| campaign/journey workflows | A only | single-owner |
| harness/evidence/preview/observer/entries | A only | single-owner |
| tsconfig.json, CLAUDE.md, benchmark branch | B only | single-owner |

Sequencing rule: ALL of Effort B's shared-file commits land before Effort A
begins on those files; A rebases once. No concurrent edits to any file in this
register, ever.

## Execution order (resolves the instrumentation-vs-ownership sequencing)

1. ONE designated instrumentation-only commit lands first (stage timestamps in
   evidence + workflow timing surfaces; NO optimization in it). This commit may
   touch shared timing files and is the pre-B baseline both efforts build on.
2. Capture BASELINE runs against that commit (all acceptance-table scenarios).
3. Effort B shared-file commits (gate caches, run-coop-gate Node-lane entries)
   — small, land quickly.
4. Effort A rebases once onto B's shared-file state, then begins harness
   optimization: R1 + R5, then R2/R3, then R4, then R6 — each stage validated
   against the step-2 baselines.
5. Effort B single-owner items (tsconfig, vitest project, docs) in parallel
   with 4.
6. R9 benchmark branch in parallel; merge only on a clean six-gate result
   (canonical equality, types, bundle size, Vite build, Vitest cold, prod boot).

## Frozen final contracts (review round 5)

1. FIXED 1s digest-detection latency + p95 digest-cost budget; breach = loud
   performance failure, never silent widening.
2. Atomic bounded `current-waits.json` (concurrent-wait map, temp+rename).
3. Actual transferred-byte telemetry (encodedDataLength + provenance classes).
4. Exact file ownership per the register above; B-before-A on shared files.
5. Stage timing lands before any optimization.
