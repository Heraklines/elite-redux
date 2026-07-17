# Protocol-33 mutation-assurance lane

The ordinary co-op gate proves the implementation and tests agree when every protection is present. This
lane adds the inverse proof: each named protection is removed from an isolated checkout and its behavioral
victim must turn red for the expected causal reason.

The lane is mandatory in `Co-op Gate (Sharded)`: its reusable workflow result is included in the required
aggregate. It also runs directly on `ci/coop/**` pushes so an isolated agent branch can calibrate changes
before integration. It never mutates the integration worktree or an ordinary test runner's checkout.

## Mutation inventory

| Mutation ID | Protection deliberately removed | Behavioral consequence required |
| --- | --- | --- |
| `p33-full-address-wave` | `wave` in the `epoch/wave/turn/revision` authority key | Equal revisions in adjacent waves alias and the second authority is refused. |
| `p33-retain-until-continuation` | retention through `continuationReady` | A material-only ACK prematurely makes exact replacement retransmission impossible. |
| `p33-staged-ack-order` | `materialApplied -> presentationReady -> continuationReady` ordering | A first-stage `continuationReady` ACK is incorrectly accepted. |
| `p33-atomic-control-rollback` | exact control-ledger rollback | A failed transaction leaves staged journal marks visible. |
| `p33-ui-registry-authority` | mirrored registration of reward UI | An authoritative reward surface becomes local-only. |
| `p33-renderer-seat-postcondition` | missing-seat renderer postcondition | Authority becomes presentation-ready despite a required seat being absent. |

Every victim lives in `coop-p33-mutation-victims.test.ts` and exercises production behavior. No victim reads
source text, mutation IDs, environment flags, or generated patches.

## Execution contract

For each assigned mutation, the runner:

1. runs the selected victim against the original exact-SHA checkout and requires green;
2. replaces an exact production-source anchor and records the source patch and before/after SHA-256;
3. reruns only that victim with isolated Vitest fork settings;
4. requires nonzero Vitest status, exactly one failed targeted test, and its mutation-specific
   `P33_MUTATION_CAUGHT[...]` assertion reason;
5. restores the source bytes in `finally`, with a workflow `git diff --exit-code` backstop.

A compiler error, dependency failure, missing test, unrelated failing test, mutation that still passes, or
failure without the expected assertion marker all make the lane red.

`node scripts/run-coop-mutation-gate.mjs --check` validates the six unique IDs, six required protection
classes, exact source anchors, and complete victim inventory without executing Vitest. `--list` prints the
deterministic exactly-once assignment; `--list --json` produces the Actions matrix.

The calibrated default uses four external runners, leaving capacity beside the 35-job everyday co-op gate.
Two lightweight mutations share a runner where setup/transform reuse is cheaper than another checkout.
`fail-fast: false` preserves evidence from every shard. Successful jobs upload only the summary and small
source patches; complete test logs are uploaded on failure.
