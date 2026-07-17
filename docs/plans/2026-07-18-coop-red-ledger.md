# Co-op red-test ledger (frozen fold 3f94c36a1, gate 13 = run 29617543966)

Classification per the authority-v2 build directive: these reds are catalogued, NOT
repeatedly repaired during the architecture build. Blocking classes remain: compile/type
failure, data corruption, security, and the new authority-v2 sentinel suite.

| Test | Current failure | Classification | Replacement v2 contract | Removal milestone |
|---|---|---|---|---|
| coop-duo-faint-switch.test.ts:255 (B10) | idle-picker fallback variant parks pre-CommandPhase | legacy-contract | REPLACEMENT_COMMIT entry + nextControl(COMMAND) retirement | Migration B cutover |
| coop-final-boss-stage-one.test.ts:64 (B10) | stage-one geometry assertion (red since gate 4) | legacy-contract | WAVE_ADVANCE/TERMINAL_COMMIT states stage geometry | Migration C cutover |
| showdown-versus-faint.test.ts a/g/b/c2 (S4) | parked at StatStageChangePhase (unsettled-mutator tripwire region - do NOT weaken the blacklist; verify whether the hold is correct) | legacy-contract | TURN_COMMIT mutation-token barrier + REPLACEMENT_COMMIT | Migration A+B cutover |
| coop-soak-journey.test.ts:101 (C1) | NO-PARK breach wave 14 ER_HOT_SPRING guest-owned ME drive (SOAK_SEED=828633) | legacy-contract | INTERACTION_COMMIT + nextControl(MYSTERY) | Interactions wave |
| campaign 4 lanes (run 29617544985) | evidence preserved; drive-layer hardening landed 17bc83b3d..3f94c36a1; not re-triaged post-freeze | harness-fidelity | v2 simulator + sentinel suite carry protocol acceptance; campaign re-baselined at milestone cutovers | Milestone 1 |

Prior classified-and-fixed classes (for bisecting): sparse FAINT_SWITCH payload (fold-introduced,
fixed), not-ready-sink deferral, timer/ctx ownership + preemption-save (harness), boundary verdicts
under owning runtime, reciprocity point cmd:turn+1 (test), replacement submenu drive (harness).
