# Project agent instructions

## Co-op verification and staging

For co-op architecture or gameplay work, use the repository's calibrated gate instead of running the full co-op directory with Vitest's default parallel scheduler. The tests share heavyweight Phaser/module state, so saturating one workstation creates contention and nondeterministic false failures.

This smart-sharded workflow is the standing default for all future co-op checkpoints; agents do not need to ask whether to use it again. Keep quick, focused verification local, and move exhaustive checkpoint verification to independent external runners. A checkpoint is deployable only when the aggregate sharded gate is green.

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
- Before declaring a co-op checkpoint deployable, push `feat/elite-redux-port` and require the `Co-op Gate (Sharded)` workflow (`.github/workflows/coop-gate-sharded.yml`) to finish green.
- The same external workflow must also pass its independent TypeScript and Biome static job. A green
  13-shard test matrix with a red static job is not deployable.
- The external gate is the default checkpoint gate: Lane A and Lane P each use one GitHub-hosted runner, Lane B uses eight historically weighted shards, and Lane C uses three shards. Preserve the production-like checkout, including recursive asset submodules. The proven default is one Vitest controller per shard with `--pool=forks --isolate --no-file-parallelism`, reusing Vite transforms while keeping test module state isolated. Only `coop-duo-multiwave.test.ts` and `coop-duo-reward-subpickers.test.ts` are measured fresh-process exceptions; do not expand that list without a green grouped-vs-solo reproduction. Full green run `29179820092` covered all 166 co-op files plus static at exact SHA `12b1a9465`: Lane B completed in 158-270 seconds (versus 5.4-6.5 minutes under one CLI per file), Lane C in 106-129 seconds, Lane P in 90 seconds, and static in 147 seconds. Treat this layout as the standing workflow, rebalancing the slowest shard from green-run timing evidence rather than weakening coverage or environment fidelity.
- The same workflow runs a browser-native WebRTC checkpoint on its own GitHub-hosted Chrome runner. It must prove two isolated browser contexts complete protocol/fingerprint/identity negotiation and replace a dropped RTCDataChannel through hot rejoin. Keep it separate from the engine shards: the continuous two-engine journey proves gameplay, while this job proves the real browser transport those engines use.
- Run or inspect one deterministic shard with `node scripts/run-coop-gate.mjs --lane <A|B|C|P> --shard <index>/<total>`. Use `--list` to see its exact files.
- Do not replace external sharding with many concurrent local Vitest processes. Separate runners provide the speedup without recreating CPU/memory contention.
- Keep `fail-fast: false` so every shard returns evidence. Download the per-shard log artifact, fix all reproducible failures in one batch, and let the next pushed checkpoint rerun the matrix.
- A red shard blocks staging promotion. A green focused test is useful during development but does not replace the checkpoint gate.
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

## Critical rules (mirror of CLAUDE.md)

`CLAUDE.md` at the repo root is the authoritative project brief; this file mirrors the rules most likely to bite non-Claude (e.g. Codex) agents. When the two disagree, CLAUDE.md wins. Read it.

## Kaggle / ML training compute (combat-AI program)

Context for the combat-AI work fed by the player-telemetry pipeline. Full plan: `docs/plans/combat-ai-roadmap.md` (+ the telemetry design in `docs/plans/player-telemetry-schema-v1.md`).

- **Kaggle is the training substrate** (~30h/wk free GPU + TPU) where model training / fine-tuning runs. Self-play GAME GENERATION is CPU-only and runs on free GitHub Actions public-repo runners (the engine is CPU-only), not on Kaggle.
- **Credential = pointer only.** The Kaggle API token lives at `~/.kaggle/kaggle.json` (also noted in `Desktop/api-keys.md`). Reference it by PATH; **never copy the key into the repo, a notebook, a commit, or any log.**
- **Notebooks are ephemeral** — their filesystem is wiped between sessions. Persistence is via **Kaggle Datasets**: inputs (telemetry exports, per-build data dictionaries) and outputs (**checkpoints saved as new dataset VERSIONS**) live there; resume from the latest checkpoint version each weekly quota window.
- 🔴 **HARD RULE — bulk data NEVER routes through the maintainer's machine or connection.** All large transfers are **cloud-to-cloud only**: R2 <-> Kaggle over S3-compatible R2 keys stored as **Kaggle secrets** (not in the repo); generation + upload happen on GitHub runners. Do not download a telemetry/self-play corpus locally to re-upload it — wire the two clouds directly.
