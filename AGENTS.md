# Project agent instructions

## Co-op verification and staging

For co-op architecture or gameplay work, use the repository's calibrated gate instead of running the full co-op directory with Vitest's default parallel scheduler. The tests share heavyweight Phaser/module state, so saturating one workstation creates contention and nondeterministic false failures.

- During implementation, run the smallest relevant files locally with `ER_SCENARIO=1`, one worker, and the lane's isolation setting.
- Before declaring a co-op checkpoint deployable, push `feat/elite-redux-port` and require the `Co-op Gate (Sharded)` workflow (`.github/workflows/coop-gate-sharded.yml`) to finish green.
- The external gate is the default checkpoint gate: Lane A and Lane P each use one GitHub-hosted runner, Lane B uses eight shards, and Lane C uses three shards. Each shard stays sequential internally.
- Run or inspect one deterministic shard with `node scripts/run-coop-gate.mjs --lane <A|B|C|P> --shard <index>/<total>`. Use `--list` to see its exact files.
- Do not replace external sharding with many concurrent local Vitest processes. Separate runners provide the speedup without recreating CPU/memory contention.
- Keep `fail-fast: false` so every shard returns evidence. Download the per-shard log artifact, fix all reproducible failures in one batch, and let the next pushed checkpoint rerun the matrix.
- A red shard blocks staging promotion. A green focused test is useful during development but does not replace the checkpoint gate.
- Deploy only to staging unless the user explicitly authorizes production. Keep intermediate staging checkpoints functional for multiplayer testers.

When changing the lane composition or shard count, preserve deterministic, exhaustive file assignment and verify with `--list` that every file appears in exactly one shard. Prefer historical-duration balancing when enough CI timing data is available; do not weaken assertions to make a shard faster.
