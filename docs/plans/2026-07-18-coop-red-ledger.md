# Co-op red-test ledger

## Stabilization-staging waiver policy (2026-07-19)

An aggregate red remains a real signal. It may be waived only for a **stabilization-only staging**
checkpoint when the exact failure is proved to be a harness/test defect rather than a player-path defect.
Every active waiver must name:

1. exact promotion SHA, test name, run, job, and artifact;
2. the demonstrated harness-only mechanism;
3. the exact production call chain or exact-SHA public-browser evidence that rules out the corresponding
   player failure;
4. the owner/removal action and the next requalification run.

Unknown or flaky-but-unexplained reds are not harness reds. Product, public-browser, static, mutation,
corruption, security, save, pairing, and transport reds are never waivable. A waiver leaves the aggregate
visibly red, never applies to production, and expires on the next product-code change touching that surface.

**Active stabilization waivers: none.** The B7/B9 failures from run `29674799408` are being repaired at
their test mechanisms instead of being added as permanent exceptions.

## Historical Authority-V2 freeze ledger

The table below records the old fold at `3f94c36a1` / gate run `29617543966`. It is historical evidence,
not an active staging waiver. Several listed mechanisms were subsequently fixed or replaced and must be
re-proved at the exact promotion SHA before any current classification is inferred from them.

Classification per the authority-v2 build directive: these reds are catalogued, NOT
repeatedly repaired during the architecture build. Blocking classes remain: compile/type
failure, data corruption, security, and the new authority-v2 sentinel suite.

| Test | Current failure | Classification | Replacement v2 contract | Removal milestone |
|---|---|---|---|---|
| coop-duo-faint-switch.test.ts:255 (B10) | idle-picker fallback variant parks pre-CommandPhase | legacy-contract | REPLACEMENT_COMMIT entry + nextControl(COMMAND) retirement | Migration B cutover |
| coop-final-boss-stage-one.test.ts:64 (B10) | stage-one geometry assertion (red since gate 4) | legacy-contract | WAVE_ADVANCE/TERMINAL_COMMIT states stage geometry | Migration C cutover |
| showdown-versus-faint.test.ts a/g/b/c2 (S4) | parked at StatStageChangePhase (unsettled-mutator tripwire region - do NOT weaken the blacklist; verify whether the hold is correct) | legacy-contract | TURN_COMMIT mutation-token barrier + REPLACEMENT_COMMIT | Migration A+B cutover |
| ability-popup park FAMILY: coop-duo-exploration:607 (B1) + coop-duo-double-faint:126 (B7) FLAKY, same class as S4 | parked at ShowAbilityPhase/HideAbilityPhase during faint crossings (milestone-1 run 29624520778; green on fold gate 13 - timing-dependent presentation-phase park, not an integration regression; v2 wiring is additive/default-off) | legacy-contract | presentation-decoupled retirement (presentationSettled never gates liveness) via TURN_COMMIT/REPLACEMENT_COMMIT | Migration A+B cutover |
| coop-soak-journey.test.ts:101 (C1) | NO-PARK breach wave 14 ER_HOT_SPRING guest-owned ME drive (SOAK_SEED=828633) | legacy-contract | INTERACTION_COMMIT + nextControl(MYSTERY) | Interactions wave |
| campaign 4 lanes (run 29617544985) | evidence preserved; drive-layer hardening landed 17bc83b3d..3f94c36a1; not re-triaged post-freeze | harness-fidelity | v2 simulator + sentinel suite carry protocol acceptance; campaign re-baselined at milestone cutovers | Milestone 1 |

Prior classified-and-fixed classes (for bisecting): sparse FAINT_SWITCH payload (fold-introduced,
fixed), not-ready-sink deferral, timer/ctx ownership + preemption-save (harness), boundary verdicts
under owning runtime, reciprocity point cmd:turn+1 (test), replacement submenu drive (harness).
