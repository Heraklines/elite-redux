# Rust-kernel baseline methodology

This baseline is an evidence ledger for the PokéRogue Redux game source at one
exact oracle SHA. The v1 fixture binds that oracle to
`3b534099919efae827019d4a3f3c4ab0ecd6d67b` and protocol `er-coop-47`. It is not
a claim that the current engine is already isolated
from Phaser or that the measured paths are Rust-only. The manifest is
`rust/fixtures/v1/baseline-manifest.json`; the coordinator is
`scripts/benchmark-kernel-baseline.mjs`.

## Scope and scenario classes

The manifest has six records, kept in a stable order:

| Record | Execution class | Input being measured |
| --- | --- | --- |
| `authority-v2-node-suite` | `node-pure` | The complete explicit 28-file Authority V2 argv set under `test/node/authority-v2-*.test.ts`, excluding the separately attributed simulator file. |
| `authority-v2-protocol-simulator` | `node-pure` | `test/node/authority-v2-simulator.test.ts`: 200 randomized schedules, 60 branch-coverage schedules, six directed cases, and nine sentinels as declared by the source. |
| `headless-single-wave` | `headless-phaser` | One deterministic scenario driven through `test/tools/run-scenario.test.ts`. |
| `headless-ten-wave` | `headless-phaser` | The same kind of direct scenario harness with `ER_RUN_WAVES=10`. |
| `headless-two-engine` | `headless-two-engine-phaser` | The selected `DUO 3-wave` test in `coop-duo-multiwave.test.ts`, with both headless engines and the loopback transport. |
| `browser-two-context-webrtc` | `browser-native-webrtc` | `scripts/run-coop-browser-transport.mjs`, which creates the isolated host and guest browser contexts and exercises handshake, chunk restart, and rejoin. |

The node-pure records are the closest current protocol baseline. They still run
the repository's TypeScript/Vitest test environment. The headless records are
intentionally labelled separately: `run-scenario.mjs` launches Vitest and
`test/tools/run-scenario.test.ts` imports `Phaser`, `BattleScene`, and
`GameManager`. The two-engine harness likewise imports Phaser and constructs two
real `BattleScene` instances in one process. Therefore these records must not be
described as isolated Rust-kernel measurements or as browser presentation
measurements. The browser record is the separate native-WebRTC evidence path.

The existing `scripts/run-scenario.mjs` convenience wrapper uses
`spawnSync("npx", ..., { shell: process.platform === "win32" })`. The baseline
manifest instead invokes Vitest directly as an argv array with the same test
input and environment. The Authority V2 record passes an explicit, alphabetized
file list; it does not rely on shell glob expansion, and
`authority-v2-simulator.test.ts` appears only in the simulator record. That keeps
this coordinator's process execution shell-free and makes the command it
records exact; it does not change the existing headless harness.

## Execution modes

```text
node scripts/benchmark-kernel-baseline.mjs --mode metadata
node scripts/benchmark-kernel-baseline.mjs --mode dry-run
node scripts/benchmark-kernel-baseline.mjs --mode measure
```

`metadata` resolves the manifest digest, oracle SHA, and stable runner metadata.
`dry-run` emits the same command/env records with the explicit `dry_run` status.
Neither mode launches a scenario process. They are the only modes intended for
local development and are safe to run twice for byte-identical comparison.

`measure` requires both `GITHUB_ACTIONS=true` and
`RUNNER_ENVIRONMENT=github-hosted`. On any other machine it emits blocked
records with null measurements and exits nonzero without launching a benchmark.
The external workflow should install dependencies, provide the checked-out
assets, and invoke this mode on a dedicated GitHub-hosted runner. A local
`--mode measure` run is not a supported fallback.

Every command is passed to `child_process.spawn` with an argv array and
`shell:false`. Manifest environment values are passed as environment entries;
they are never interpolated into a shell command. Exit codes, signals, spawn
errors, and timeouts remain visible in the record. A nonzero scenario is not
converted into a pass merely because it produced a duration.

The default oracle SHA comes from `rust/source-lock.toml` when that immutable
lock is present, otherwise from the manifest's pinned `oracle_game_sha`. It
never defaults to `GITHUB_SHA`: that value identifies the later candidate or
integration commit and is emitted separately as `candidate_game_sha`.
`--oracle-game-sha` is an explicit override for a reviewed oracle input. An
unavailable candidate SHA is `null` with its source marked `unavailable`; the
oracle fixture itself is rejected if its pinned SHA is missing or malformed.
Timestamps, hostnames, and random IDs are deliberately absent from the JSON so
metadata/dry-run output remains deterministic.

## Measurement fields

Each scenario record contains these fields even when a value is unavailable:

- `setup_build_ms`: the summed wall time of the manifest's setup commands. It is
  `null` when no setup/build command is defined or setup fails; no zero is used
  for “not applicable”.
- `cold_start_ms`: the duration of the first complete, successful scenario
  process run, measured from the child's spawn event through process close.
- `warm_start_ms`: the median duration of later complete, successful scenario
  process runs, using the same start/end points. It is `null` when no later
  complete run exists.
- `spawn_latency_ms`: the median time from the spawn request to the child's
  spawn event. This is retained separately so process-launch latency is not
  confused with cold/warm scenario execution.
- `execution_ms`: the aggregate median duration of all complete, successful
  scenario process runs. It remains separate from the first-run and later-run
  views above. Failed or timed-out processes do not become complete samples just
  because a wall duration was observed.
- `peak_rss_bytes`: the maximum parsed GNU `/usr/bin/time -f %M` value across
  complete scenario samples on Linux. `%M` is reported in KiB and converted to
  bytes. If GNU `time` is absent, its output is unparseable, or no complete
  process supplies a value, this field is `null` with a reason.
- `scenario_size`: the manifest's semantic size descriptor. The Authority V2
  file count is pinned to the explicit 28-file argv set; a future inventory
  change requires a manifest review rather than implicit shell expansion.
- `sample_count`: the number of complete, successful scenario samples. The separate
  `requested_sample_count` and `attempted_sample_count` fields prevent a
  failed/blocked run from being mistaken for a zero-sample success.
- `command`, `execution_class`, `status`, and `reason`: the exact argv input,
  classification, outcome, and causal explanation.

Successful node-pure records request three samples. The one-wave headless
record requests two so it has a first and later complete observation; the
ten-wave, two-engine, and browser journeys request one because repeating those full
journeys would multiply the expensive end-to-end workload without creating an
isolated later-run metric. Their `warm_start_ms` is therefore explicitly null
with a reason. A future calibration can change the requested counts in the
manifest, but it must preserve the meaning of each field.

The status values are intentionally small and fail-closed:

| Status | Meaning |
| --- | --- |
| `not_measured` | Metadata mode; no scenario process was launched. |
| `dry_run` | Dry-run mode; commands were described but not launched. |
| `blocked` | Measurement was refused, currently because the runner was not GitHub-hosted. |
| `passed` | All requested samples and setup commands exited successfully. |
| `failed` | A setup or scenario process exited nonzero or could not be started. |
| `timeout` | A bounded process timeout fired. |

Unknown or unmeasured values are always JSON `null` and accompanied by
`metric_reasons` or the record `reason`. In particular, unavailable peak RSS,
an unisolatable setup, and a missing warm sample are not encoded as zero.

## Hosted measurement procedure

1. Check out the exact candidate SHA with recursive assets and run the
   repository dependency setup used by the co-op workflow.
2. Run the manifest in `--mode measure` on GitHub-hosted Linux. Keep the node
   suite and simulator as node-pure records, and keep the Phaser/Vitest and
   browser records as their declared classes.
3. Preserve the emitted JSON and the runner log as the baseline artifact. The
   JSON's immutable `oracle_game_sha`, separate `candidate_game_sha`, protocol
   version, and `manifest_sha256` bind the result to its inputs.
4. Compare like-for-like records only. A missing RSS value is an unavailable
   measurement, not a zero-memory claim; a changed scenario size or command is
   a methodology/input change and needs a new manifest review.

The browser setup mirrors the existing workflow's production bundle path: install
Chrome, build the sealed co-op bundle with the V2 flags, seal it, then run the
two-context transport script. The script itself verifies the artifact before
serving it. This remains a hosted-only browser measurement; no local browser,
Vite, or co-op Vitest process is part of the validation for this baseline
deliverable.

## Local verification boundary

The safe local checks for this deliverable are:

```text
node --check scripts/benchmark-kernel-baseline.mjs
node scripts/benchmark-kernel-baseline.mjs --mode metadata
node scripts/benchmark-kernel-baseline.mjs --mode dry-run
node -e "JSON.parse(require('node:fs').readFileSync('rust/fixtures/v1/baseline-manifest.json','utf8'))"
node -e "const fs=require('node:fs'); const needle=Buffer.from('PokéRogue Redux','utf8'); for (const file of ['rust/fixtures/v1/baseline-manifest.json','docs/plans/rust-kernel/baseline-methodology.md']) { if (!fs.readFileSync(file).includes(needle)) throw new Error(file+' is not UTF-8'); }"
git diff --check
```

Do not run a local co-op Vitest file, the headless scenario, Phaser, Vite, or
Chromium as part of this baseline task. The calibrated co-op gate and browser
journey belong on their external GitHub-hosted runners. This boundary is part
of the methodology, not an omitted benchmark result.
