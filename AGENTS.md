# Project agent instructions

## Co-op verification and staging

For co-op architecture or gameplay work, use the repository's calibrated gate instead of running the full co-op directory with Vitest's default parallel scheduler. The tests share heavyweight Phaser/module state, so saturating one workstation creates contention and nondeterministic false failures.

This smart-sharded workflow is the standing default for all future co-op checkpoints; agents do not need to ask whether to use it again. Keep quick, focused verification local, and move exhaustive checkpoint verification to independent external runners. A checkpoint is deployable only when the aggregate sharded gate is green.

- During implementation, run the smallest relevant files locally with `ER_SCENARIO=1`, one worker, and the lane's isolation setting.
- Keep heavyweight verification off the user's workstation. Never run `coop-soak*.test.ts`, Lane B/C/P shards, the full co-op gate, or multi-campaign production-fidelity tests locally; dispatch them to GitHub Actions and inspect their per-shard artifacts. Local verification is limited to small, focused non-soak files. If a supposedly focused local process grows unexpectedly or stops producing useful progress, terminate it promptly and move that reproduction to an isolated external runner.
- Before declaring a co-op checkpoint deployable, push `feat/elite-redux-port` and require the `Co-op Gate (Sharded)` workflow (`.github/workflows/coop-gate-sharded.yml`) to finish green.
- The external gate is the default checkpoint gate: Lane A and Lane P each use one GitHub-hosted runner, Lane B uses eight shards, and Lane C uses three shards. Each shard stays sequential internally. Heavy B/C/P files run one at a time in fresh Vitest processes on that runner so Phaser heaps and leaked scene timers cannot accumulate across files; do not collapse them back into one long-lived worker. Treat this 13-shard layout as the baseline, not a permanent ceiling: rebalance or split shards when CI timing evidence shows a material critical-path improvement.
- Run or inspect one deterministic shard with `node scripts/run-coop-gate.mjs --lane <A|B|C|P> --shard <index>/<total>`. Use `--list` to see its exact files.
- Do not replace external sharding with many concurrent local Vitest processes. Separate runners provide the speedup without recreating CPU/memory contention.
- Keep `fail-fast: false` so every shard returns evidence. Download the per-shard log artifact, fix all reproducible failures in one batch, and let the next pushed checkpoint rerun the matrix.
- A red shard blocks staging promotion. A green focused test is useful during development but does not replace the checkpoint gate.
- Deploy only to staging unless the user explicitly authorizes production. Keep intermediate staging checkpoints functional for multiplayer testers.

When changing the lane composition or shard count, preserve deterministic, exhaustive file assignment and verify with `--list` that every file appears in exactly one shard. Use historical-duration balancing when timing data is available, fall back to stable deterministic weighting when it is not, and keep the resulting assignment reproducible. Optimize the slowest shard rather than merely increasing concurrency, and do not weaken assertions or omit scenarios to make a shard faster.
