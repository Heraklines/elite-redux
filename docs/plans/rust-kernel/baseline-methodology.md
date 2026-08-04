# Rust-kernel baseline methodology

This baseline is an evidence ledger for the PokéRogue Redux game source at one
exact oracle SHA. The v1 fixture binds that oracle to
`3b534099919efae827019d4a3f3c4ab0ecd6d67b`, branch
`ci/coop/v2-showdown-command-coordinate-20260720`, and protocol `er-coop-47`.
It is not a claim that the current engine is already isolated
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

The integration-owned `rust/source-lock.toml` must use this exact flat shape;
the coordinator rejects tables, duplicate keys, extra fields, missing fields,
and any value that differs from the manifest:

```toml
oracle_game_sha = "3b534099919efae827019d4a3f3c4ab0ecd6d67b"
oracle_branch = "ci/coop/v2-showdown-command-coordinate-20260720"
protocol_version = "er-coop-47"
schema_version = 1
input_repeat_delay_ms = 250
input_repeat_interval_ms = 250
```

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
`RUNNER_ENVIRONMENT=github-hosted`, the exact
`RUST_KERNEL_BASELINE_ATTESTATION=rust-kernel-baseline-v1:measure:github-hosted`
value, and credible GitHub run metadata (`GITHUB_SERVER_URL`,
`GITHUB_REPOSITORY`, `GITHUB_WORKFLOW`, `GITHUB_JOB`, `GITHUB_REF`,
`GITHUB_SHA`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, and
`GITHUB_RUN_NUMBER`). On any other machine or with incomplete metadata it emits
blocked records with null measurements and exits nonzero without launching a
benchmark. This is an accidental-safety policy gate, not a cryptographic trust
boundary: it reduces accidental local execution but cannot prove who supplied
the environment variables. The external workflow must pass these values
explicitly and invoke this mode on a dedicated GitHub-hosted runner. A local
`--mode measure` run is not a supported fallback.

Every command is passed to `child_process.spawn` with an argv array and
`shell:false`. Manifest environment values are passed as environment entries;
they are never interpolated into a shell command. Exit codes, signals, spawn
errors, and timeouts remain visible in the record. A nonzero scenario is not
converted into a pass merely because it produced a duration.

Measured children receive only the platform/process variables in the explicit
allowlist emitted as `environment_policy.inherited_allowlist`, plus the
scenario's normalized variables declared in the manifest. Arbitrary parent
`NODE_OPTIONS`, `NODE_PATH`, `ER_*`, `COOP_*`, and `VITE_*` values are
never inherited; the latter prefixes are present only when a scenario explicitly
declares the exact variable. Each scenario and setup record emits its
`effective_environment` and `effective_environment_sha256`, so the actual
child input is auditable without relying on the ambient process environment.

`rust/source-lock.toml` is mandatory for every mode. It is the only oracle
source and must contain exactly the six flat fields shown above:
`oracle_game_sha`, `oracle_branch`, `protocol_version`, `schema_version`,
`input_repeat_delay_ms`, and `input_repeat_interval_ms`. Each value must
exactly match the manifest; a missing, malformed, extra, table-shaped, or
mismatched lock fails closed. `--oracle-game-sha` is accepted only when it is
a 40-character lowercase SHA that exactly matches both the lock and manifest;
it never selects a different source. `GITHUB_SHA` identifies the later
candidate and is emitted separately as `candidate_game_sha`. Timestamps,
hostnames, and random IDs are absent from the JSON, while the effective child
environment is emitted and digested because it is runner-dependent.

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
- `environment`: the normalized variables declared by the manifest for the
  scenario; setup records carry their own declared values.
- `effective_environment` and `effective_environment_sha256`: the exact
  allowlisted-plus-declared child environment and its stable digest. These are
  emitted even for metadata and dry-run records.
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
| `blocked` | Measurement was refused because the hosted-runner, attestation, or credible GitHub metadata gate failed; no scenario process was launched. |
| `passed` | All requested samples and setup commands exited successfully. |
| `failed` | A setup or scenario process exited nonzero or could not be started. |
| `timeout` | A bounded process timeout fired. |

Unknown or unmeasured values are always JSON `null` and accompanied by
`metric_reasons` or the record `reason`. In particular, unavailable peak RSS,
an unisolatable setup, and a missing warm sample are not encoded as zero.

## Hosted measurement procedure

1. Check out the exact candidate SHA with recursive assets and run the
   repository dependency setup used by the co-op workflow.
2. Pass the exact script attestation and GitHub run metadata from the workflow,
   then run the manifest in `--mode measure` on GitHub-hosted Linux. Keep the
   node suite and simulator as node-pure records, and keep the Phaser/Vitest and
   browser records as their declared classes.
3. Preserve the emitted JSON and the runner log as the baseline artifact. The
   JSON's immutable `oracle_game_sha`, separate `candidate_game_sha`, protocol
   version, `oracle_branch`, both input-repeat values,
   `manifest_sha256`, `source_lock_sha256`, and effective environment
   digests bind the result to its inputs.
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
node -e "JSON.parse(require('node:fs').readFileSync('rust/fixtures/v1/baseline-manifest.json','utf8'))"
node -e "const m=require('./rust/fixtures/v1/baseline-manifest.json'); if (m.scenarios.length!==6 || m.input_repeat_delay_ms!==250 || m.input_repeat_interval_ms!==250) throw new Error('baseline binding mismatch');"
git diff --check
```

Because the integration-owned source lock is intentionally absent from an
isolated benchmark worktree, metadata/dry-run behavior can be checked only from
a throwaway staging copy that supplies the canonical lock shape above. Do not
create or commit a substitute lock in this worktree. Those modes launch no
scenario process; `--mode measure` remains forbidden on the workstation.

Do not run a local co-op Vitest file, the headless scenario, Phaser, Vite, or
Chromium as part of this baseline task. The calibrated co-op gate and browser
journey belong on their external GitHub-hosted runners. This boundary is part
of the methodology, not an omitted benchmark result.
