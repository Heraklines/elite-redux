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
- The external gate is the default checkpoint gate: Lane A and Lane P each use one GitHub-hosted runner, Lane B uses eight historically weighted shards, and Lane C uses three shards. Preserve the production-like checkout, including recursive asset submodules. Prefer one Vitest controller per shard with `--pool=forks --isolate --no-file-parallelism` only after an aggregate canary proves it returns the same green result as the isolated-process baseline; reuse Vite transforms without sharing test module state. If grouped execution exposes cross-file state that `--isolate` cannot contain, split only those incompatible files into fresh processes instead of reverting every file. Green run `29177743451` measured 5.4-6.5 minute B shards with one CLI per file, while the first grouped canary completed B shards in roughly 2-3 minutes but was invalidated by an omitted asset checkout. Keep the slowest valid shard near four minutes by rebalancing from green-run evidence, never by weakening coverage or environment fidelity.
- Run or inspect one deterministic shard with `node scripts/run-coop-gate.mjs --lane <A|B|C|P> --shard <index>/<total>`. Use `--list` to see its exact files.
- Do not replace external sharding with many concurrent local Vitest processes. Separate runners provide the speedup without recreating CPU/memory contention.
- Keep `fail-fast: false` so every shard returns evidence. Download the per-shard log artifact, fix all reproducible failures in one batch, and let the next pushed checkpoint rerun the matrix.
- A red shard blocks staging promotion. A green focused test is useful during development but does not replace the checkpoint gate.
- Deploy only to staging unless the user explicitly authorizes production. Keep intermediate staging checkpoints functional for multiplayer testers.

When changing the lane composition or shard count, preserve deterministic, exhaustive file assignment and verify with `--list` that every file appears in exactly one shard. Use historical-duration balancing when timing data is available, fall back to stable deterministic weighting when it is not, and keep the resulting assignment reproducible. Optimize the slowest shard rather than merely increasing concurrency, and do not weaken assertions or omit scenarios to make a shard faster.
