# Rust kernel M4 — iteration policy

This file is the durable iteration reminder for `arch/rust-kernel-m4`. The frozen contracts under `rust/contracts/m4-*` and the repository-wide co-op rules remain normative.

## Fast development loop

Do not use the six-job aggregate as a typo/format checker. Most elapsed time is GitHub runner startup, duplicate checkout/build work, the complete M1–M3 regressions, and the two-process Phaser oracle export.

1. **Work on a focused branch.** Use `ci/rust-m4/<topic>` or the contract-owned `wrk/rk-m4-*` branch from the latest hosted-green integration SHA. The branch-aware M4 workflow runs Rust formatting, workspace compilation, and focused M4 tests without the oracle or complete regressions.
2. **Validate locally before every push.** Free disk space first. Use the repository toolchain from `rust/rust-toolchain.toml`, then run:
   - `cargo fmt --all -- --check`
   - `cargo check -p <affected-crate> --all-targets`
   - `cargo test -p <affected-crate> --test <affected-m4-test>`
   - Use `cargo check --workspace --all-targets` before an integration checkpoint.
   Do not run co-op Vitest locally; that standing workstation prohibition is unchanged.
3. **Batch diagnostic fixes.** Download the complete failed-job artifact, classify every compiler/test/rustfmt failure, fix the full batch, format once, and push once. Never push one commit per compiler error.
4. **Keep expensive evidence targeted.** Rust-only edits must not launch the TypeScript oracle. Exporter/capture/source changes may run the oracle without launching full Rust regressions.
5. **Reserve aggregate qualification for checkpoints.** Pushes to `arch/rust-kernel-m4` run source/contract checks plus only the affected Rust or oracle surface. Dispatch `Rust Kernel M4 Gate` manually on the exact checkpoint SHA to run the full foundation, M1–M3 regressions, and two-process oracle aggregate.
6. **Preserve exact-SHA evidence.** A focused green run proves only its declared affected surface. G14/G15 and promotion require the manually dispatched aggregate to be all green at the integration SHA.

## Cache and cleanup

- Rust caches are keyed by toolchain plus `Cargo.lock`; focused CI can restore compatible foundation artifacts.
- Delete downloaded `.omp-*` diagnostics and installers after extracting the causal evidence. Never commit them.
- Remove inactive clean worktrees and reinstallable build directories after accepting a handoff.

## Hosted workflow split

- `.github/workflows/rust-kernel-m4.yml` is branch-aware. Pushes to `ci/rust-m4/**` and `wrk/rk-m4-*` run focused Rust qualification; Rust-only integration pushes skip the oracle; oracle-only integration pushes skip Rust foundation work.
- Full M1–M3 regressions and the complete oracle/foundation aggregate run only on manual checkpoint dispatch. If a standalone focused workflow is later added to the default branch, remove the worker-branch triggers from the aggregate workflow to avoid duplicate runs.
