# Project agent instructions

## Co-op verification and staging

For co-op architecture or gameplay work, use the repository's calibrated gate instead of running the full co-op directory with Vitest's default parallel scheduler. The tests share heavyweight Phaser/module state, so saturating one workstation creates contention and nondeterministic false failures.

This smart-sharded workflow is the standing default for all future co-op checkpoints; agents do not need to ask whether to use it again. Keep quick, focused verification local, and move exhaustive checkpoint verification to independent external runners. Production/release candidates require a green aggregate sharded gate. A stabilization-only staging checkpoint may carry an explicitly ratified harness-only red under the narrow exception below.

- Do not run co-op Vitest files locally on this workstation. Even focused engine-free files have been
  observed importing the heavyweight Phaser graph, exceeding 500 MB, and surviving their command wrapper.
  Keep local verification to Biome/formatting, `git diff --check`, deterministic `--list` inventory checks,
  and other non-Vitest static inspection. Run the smallest relevant test files on an isolated GitHub-hosted
  runner, then run the aggregate sharded gate before staging.
- Keep all co-op verification off the user's workstation. Never run focused co-op Vitest files,
  `coop-soak*.test.ts`, Lane B/C/P shards, the full co-op gate, or multi-campaign production-fidelity tests
  locally; dispatch them to GitHub Actions and inspect their per-shard artifacts. If a co-op test process is
  started accidentally, terminate its whole process tree promptly and move the reproduction to an isolated
  external runner.
- Before declaring a normal staging checkpoint or any release candidate deployable, push
  `feat/elite-redux-port` and require the `Co-op Gate (Sharded)` workflow
  (`.github/workflows/coop-gate-sharded.yml`) to finish green. The only exception is a stabilization-only
  staging checkpoint carrying an exact, active harness-only waiver under the rules below.
- The same external workflow must always pass its independent TypeScript and Biome static job; static is
  never waivable. A red aggregate is eligible only for the exact stabilization exception below, never for
  a normal staging checkpoint or release candidate.
- The external gate is the default checkpoint gate. Its current planner-derived integration layout is
  A1/B13/C5/P2/S8/T4 (33 test shards), plus parallel static, browser, contract, and mutation jobs that can
  fill the account's 40 concurrent hosted-runner slots: Lane A stays process-global, Lane B is historically
  weighted, Lane C owns soak campaigns, each
  Lane P production-fidelity file owns a runner, Lane S covers Showdown, and Lane T covers triples/topology.
  Preserve the production-like checkout, including recursive asset submodules. The proven controller model
  is `--pool=forks --isolate --no-file-parallelism`, reusing Vite transforms while keeping test module state
  isolated. Only `coop-duo-multiwave.test.ts` and `coop-duo-reward-subpickers.test.ts` are measured
  fresh-process exceptions; do not expand that list without a green grouped-vs-solo reproduction. Full green
  run `29179820092` covered the earlier 166-file A/B/C/P layout, and expanded run `29213259047` covered 246
  files at exact SHA `50531b460` with A1/B8/C3/P1/S3/T1 plus browser/static in 4m19s. The second Lane P
  runner is the in-flight T2 addition and must be calibrated by the next exact-SHA aggregate gate. Rebalance
  the slowest shard from green-run timing evidence rather than weakening coverage or environment fidelity.
- The fast-contract runner must execute both the keyboard/DOM public-browser driver contracts and every
  `test/node/authority-v2-*.test.ts` file under the isolated node-pure Vitest config. Authority V2 admission,
  material, control, receipt, recovery, and cutover contracts are deploy-blocking; never rely on Lane A to
  cover them, and never move them into Lane A's process-global module state.
- The complete real-engine matrix must run with `COOP_AUTHORITY_V2_TURN=on`. Authority V2 is the playable
  architecture being qualified, not an optional focused experiment. Never silence a cutover failure by
  turning the full matrix back to legacy. Keep any legacy/capability-fallback checks explicit and narrowly
  named; every gameplay, transition, Showdown, topology, and production-fidelity lane qualifies V2.
- The same workflow runs a browser-native WebRTC checkpoint on its own GitHub-hosted Chrome runner. It must prove two isolated browser contexts complete protocol/fingerprint/identity negotiation and replace a dropped RTCDataChannel through hot rejoin. Keep it separate from the engine shards: the continuous two-engine journey proves gameplay, while this job proves the real browser transport those engines use.
- Run or inspect one deterministic shard with `node scripts/run-coop-gate.mjs --lane <A|B|C|P|S|T> --shard <index>/<total>`. Use `--list` to see its exact files. Authority V2 node-pure contracts are a separate named step on the fast-contract runner rather than a numbered engine shard.
- Do not replace external sharding with many concurrent local Vitest processes. Separate runners provide the speedup without recreating CPU/memory contention.
- Keep `fail-fast: false` so every shard returns evidence. Download the per-shard log artifact, fix all reproducible failures in one batch, and let the next pushed checkpoint rerun the matrix.
- A red shard blocks staging by default. A stabilization-only staging checkpoint may waive a red test only
  when all of the following are recorded in `docs/plans/2026-07-18-coop-red-ledger.md`: the exact test and
  promotion SHA; exact failing run/artifact; a demonstrated harness-only mechanism; the production call
  chain or exact-SHA public-browser evidence proving the corresponding player path; and a named removal
  action. Unknown, flaky/unclassified, product, browser-observed, static, mutation, corruption, security,
  save, pairing, or transport failures are never waivable. The aggregate remains visibly red, the deploy
  must be labeled STABILIZATION, and the waiver never applies to production. Fix or retire a waived noisy
  test promptly; a ledger is not permission to accumulate permanent false alarms.
- For a deterministic long-campaign regression, dispatch `Focused Co-op Soak Replay` once per affected
  profile so unrelated 200-wave campaigns do not delay diagnosis. Different profiles may run concurrently
  on independent GitHub-hosted runners. A focused green replay does not replace the six-profile Nightly
  Co-op Soak release milestone.
- For an architecture-completion or release-confidence milestone, also require the external `Nightly Co-op
  Soak` matrix to pass at the checkpoint SHA. Its standing matrix uses six independent runners: three
  deterministic 200-wave god campaigns with widely separated seeds, the faint-heavy level campaign, the
  Mystery/asymmetric campaign, and the thirteen-event continuous journey with repeated biome transitions.
  Ordinary intermediate staging checkpoints may use the sharded gate alone so testers can keep working, but
  they must not be described as full-run architecture assurance until this expanded matrix is green.
- Deploy only to staging unless the user explicitly authorizes production. Keep intermediate staging checkpoints functional for multiplayer testers.

When changing the lane composition or shard count, preserve deterministic, exhaustive file assignment and verify with `--list` that every file appears in exactly one shard. Use historical-duration balancing when timing data is available, fall back to stable deterministic weighting when it is not, and keep the resulting assignment reproducible. Optimize the slowest shard rather than merely increasing concurrency, and do not weaken assertions or omit scenarios to make a shard faster.

## Parallel co-op development and CI capacity

Parallel work is the default when file ownership and protocol dependencies permit it, but parallel writers
must never share one worktree. Each writer gets an isolated worktree based on the same integration SHA and
an exclusive owned-file manifest. Only the integration owner may merge/cherry-pick into
`feat/elite-redux-port`, freeze or change the co-op wire schema, stage the integration index, push the
integration branch, dispatch the complete gate, or promote staging. Read-only auditors may inspect any
worktree. A surface branch must not invent a private wire message; freeze the shared schema first, then give
surface adapters and tests to separate owners. Require every worker handoff to include its branch, exact
SHA, owned files, static checks, and known fixture/dependency requirements.

Use GitHub-hosted runners as the external compute pool. The account permits up to 40 concurrent standard
jobs, but keep the ordinary full checkpoint target near 35 so five slots remain available for focused agent
checks and unrelated workflows. Do not increase sharding merely to consume all 40 slots: repeated checkout,
dependency setup, Vite transforms, browser startup, and artifact uploads can make finer shards slower.

- The last proven expanded checkpoint (`50531b460`, run `29213259047`) used 17 test shards
  (A1/B8/C3/P1/S3/T1) plus browser and static jobs and completed in 4m19s. The in-flight T2 expansion gives
  Lane P two production-fidelity files, one per runner. Preserve that calibrated layout as the fallback
  until a faster layout is green at an exact integration SHA.
- The target everyday layout after startup/artifact improvements is 35 concurrent jobs:
  browser 1, static 1, A1, P2, B13, C5, S8, and T4. Recalculate the exact allocation from tracked-file
  inventory and green-run p90 timings; keep A as one job because it intentionally shares process-global
  state. Use a 40-job layout only for measured release experiments when the extra five jobs reduce the
  critical path.
- Build the immutable production browser bundle once, then fan public-UI/browser scenarios across isolated
  runners against that exact artifact. Do not make every browser scenario rebuild source-mode Vite. Engine
  shards still use their calibrated isolated Vitest controllers and must not share process-global Phaser
  state across files unless a green grouped-vs-solo calibration proves it safe.
- Generate and commit/reproduce shard assignment from p90 timing evidence. Optimize the slowest bin, verify
  exhaustive exactly-once assignment with `--list`, and fall back to stable deterministic weights for new
  files. Never reduce assertions, fidelity, seeds, events, or transitions to meet a wall-clock target.
- Use shallow checkout for static work whenever its comparison base can be fetched explicitly. Cache safe
  immutable dependencies/transforms, but never reuse mutable test state across runners or SHAs.
- Artifact storage is a constrained resource. Green development shards should upload only a compact
  manifest/summary and essential causal evidence. Upload complete logs, screenshots, traces, and replay
  schedules on failure and at release-confidence checkpoints. Keep `fail-fast: false`; all shards still
  return status even when heavy success artifacts are omitted.
- Branch-focused CI should trigger from `ci/coop/**` branches with concurrency scoped by the full branch ref,
  for example `coop-focused-${{ github.ref }}`, so agents cannot cancel each other's checks. Each agent
  pushes only its exact isolated-worktree commit and dispatches the smallest 1-5 affected shards. The same
  focused workflow must run its dedicated static job against the ownership planner's exact declared train
  base, so every surface handoff includes branch-scoped TypeScript and Biome evidence without launching the
  full checkpoint matrix. A focused green run never replaces the complete integration gate or its independent
  static job; the full gate remains exclusive to the integration/staging checkpoint.
- Do not depend on a `workflow_dispatch`-only workflow that exists only off the default branch; GitHub will
  not register it for dispatch. Until the focused workflow is present on the default branch, use a push
  trigger on `ci/coop/**` or dispatch an existing registered workflow against the exact branch SHA.
- After a worker handoff is accepted, remove clean inactive worktrees and their reinstallable dependency
  directories so parallel work does not accumulate avoidable disk and filesystem-watcher load. Prefer sparse
  worktrees or worktrees without `node_modules` when the owned-file set and validation commands permit it.
  Never delete a dirty worktree or delete a branch as part of automated cleanup; preserve it for explicit
  integration-owner review.
