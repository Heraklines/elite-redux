# Co-op integration process addendum (2026-07-22)

Codified after two same-day merge regressions and one premature attribution during the V2
campaign convergence. Binding for the integration owner and every fix agent on this line.

## 1. No attribution without the trace

Never classify a red run's failure ("that's the known X deadlock", "same family as Y") from the
error string or the lane name alone. Every attribution — including "pre-existing" and "expected" —
requires the signature line PLUS its surrounding trace context (the preceding parked/committed/
recovery markers) quoted from the artifact or job log. A correct-but-unverified attribution is
treated as wrong: verify it anyway before assigning ownership. (Instance: dirty's launch-stage
`resumeStartNew` regression was initially mislabeled as the known command-open deadlock;
mystery's `material could not be applied exactly` was correctly attributed only AFTER trace
verification.)

## 2. Pre-merge checklist for PRODUCT-BEHAVIOR changes

A change that alters runtime behavior (not tests/harness/docs) must clear, before merging to the
working branch:
- tsc delta 0 vs the branch's own measured baseline;
- `pnpm test:node` fully green;
- red-first evidence for the mechanism, or an explicit gate-only-proof note naming what only CI
  can prove;
- `npx biome check --write` on every touched file (the formatter is gate-blocking; a node-test
  pass does NOT imply format-clean — instance: the gate-contract re-pin);
- a one-line blast-radius note in the merge message: which lanes/flows the change can affect and
  which gate/campaign/journey signal would falsify it. If the change is gated on a runtime flag
  (e.g. `!moveAnimations`), name the lanes where the gate is ACTIVE — those lanes' next-run
  failures are presumed-caused-by-this-change until the trace says otherwise (instance: the
  replay-pacing fast-forward broke the fresh-run confirm on exactly the animations-skipped lanes).

## 3. One behavioral change per measurement roll

When a roll's purpose is measurement (per-wave cost, lane feasibility), it must carry at most ONE
new behavioral change. This is what made the pacing regression's fingerprint unambiguous; keep it
deliberate rather than accidental.

## 4. Journey/campaign dispatch discipline

- Journeys share ONE concurrency group across refs; pushes to `ci/coop/**` auto-dispatch journeys
  that CANCEL active runs. During qualification: freeze pushes while rolls run; one journey
  dispatcher at a time.
- Campaign artifacts: download compact variants only (`-p "*<lane>*compact*"`), delete after use
  (the 100%-disk incident).

## 5. Agent-fleet hygiene

- Never run a worktree purge while agents are live (a purge pass raced a working agent once).
- Resume dropped agents with commit-first directives; commit+push per verified piece is mandatory
  in every agent brief.
- Zero-tool anomalous agent returns: discard the text, never act on it, resume with an explicit
  execute directive. (5 instances to date, all recovered cleanly.)
