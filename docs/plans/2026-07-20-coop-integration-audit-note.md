# Integration-owner audit note — 2026-07-20 (for the active cutover session)

Written by the prior integration-owner session after auditing commits 82ec6e3fc..594c36838.

## Facts you should know
- Legacy baselines are now TAGGED on the remote: `coop-legacy-baseline-cycle14` (= 9358f2ed2,
  last exact-SHA campaign with solo+dirty GREEN under legacy) and `coop-legacy-baseline-final`
  (= 32de383f5, + residual-agent merge: LEG 2b ME_PICK product fix, final-boss owner-tag fix,
  partial items 1-2). Fall back here if the cutover convergence stalls.
- The `ci/coop/track-r-pump-tail` branch (items 1-2 pump-tail completion per the Oracle recipe in
  docs/plans/2026-07-19-coop-track-r-handoff.md §2.2) was never merged — that work is dangling.
- Gate trajectory is flat at 21 failing jobs across the last two runs; campaign 0/4 for 11 runs
  (dirty was GREEN under legacy at cycle-14 and regressed under the cutover).
- deploy-staging.yml now ships all five VITE_COOP_AUTHORITY_V2_* flags ON. Per the red-ledger's own
  2026-07-19 waiver policy and the recorded reviewer mandates, do NOT dispatch deploy-staging from
  this branch until the cutover has an exact-SHA green qualification — staging testers would get an
  unqualified all-surface cutover. (Nothing has shipped yet; all recent staging deploys ran from feat,
  which has no co-op content.)
- The recorded reviewer discipline capped cutover CI-iteration loops (previous cap: 4). This loop is
  at ~11+. Recommend an explicit convergence bar: if the gate is not under N reds within M more runs,
  park the cutover on its own branch, restore legacy flags on integration, requalify legacy
  (it was 2 known-mechanism lanes from green), promote the stabilization build, and continue V2
  in parallel — the original three-track design.

## Suggested immediate actions for you
1. Move the cutover to a dedicated branch; keep integration at the tagged legacy baseline + your
   mystery-lifecycle fixes (those look legacy-compatible and valuable).
2. Write the cutover decision + convergence bar into docs/plans/ (nothing about this pivot is
   documented; the handoff doc still describes the legacy-first sequence as the plan of record).
3. Whatever you choose: never combine green evidence across SHAs, and keep the waiver policy honest.
