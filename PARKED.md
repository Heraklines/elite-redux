# Wave-2f KEYSTONE — ✅ UNPARKED + INTEGRATED (W2e-R applier remediation is live)

> **RESOLVED 2026-07-10.** The W2e-R transactional-applier remediation landed on
> `feat/elite-redux-port` (`97d797970`); the keystone was rebased onto it and RE-TARGETED onto the
> remediated seam. The wave surface is now the FIRST with a registered production live-mutation sink
> + ONE ledger — the proof a journal-delivered op can LIVE-materialize. See `docs/plans/…-migration.md`
> §8.7 for the authoritative writeup. Integration commits: `8c419ca1b` (feat), `db5b4dff9` (durability
> proof test), `d136e80d5` (§8.7). All 5 parked-era applier assumptions below were re-validated and
> resolved as noted inline. This file is retained as the design-decision record; the sections below
> describe the ORIGINAL parked state and remain accurate as history.

The original park record follows.

---

Parked per orchestrator directive: an external review found P0 defects in the Wave-2e
operation/durability **applier** layer that this keystone commits through. This file records
exactly where the work stands so the resumed effort knows what is valid and what must be revisited.

Commit with the work: `dfad95161` (`WIP(coop): Wave-2f keystone WAVE_ADVANCE op - PARKED …`).

---

## What the remediation changes underneath me (why I stopped)

The orchestrator reported three P0s in the layer my ops ride on:

1. **Dual appliers don't mutate + unconditional ACK.** The journal appliers record sidecar history
   but do NOT apply game state, and the durability receiver ACKs after a void hook — so an op can be
   "applied/ACKed" with zero mutation.
2. **Separate exactly-once ledgers per surface** (legacy relay vs journal) block a mutating journal.
3. **Producer-revision-0 after cold resume**: operation hosts restart at revision 0 while the
   restored receiver ledger sits at N, so post-resume ops read as duplicates.

Remediation = ONE transactional **mutating applier** whose success result gates `markApplied`/ACK,
a **shared dedup ledger**, and **producer-revision restore**. **WAVE_ADVANCE must commit through
THAT applier, not the current `CoopOperationHost`/`CoopOperationGuest` pair.**

My design + payload reading remain valid. Only the commit/apply **plumbing** underneath changes.

---

## Design decisions made so far

- **The wave-advance is HOST-DRIVEN, not owner-alternated** (unlike biome/ME/reward). The host is the
  sole engine that resolves a wave, so: owner is ALWAYS the host seat (0); the host commits at its own
  wave-end (`broadcastCoopWaveResolved`); the guest is ALWAYS the watcher (never mints/commits). This
  makes the adapter structurally the SIMPLEST of the four surfaces — no guest-side mint, no per-kind
  owner resolution.
- **Pinned on the WAVE INDEX** (one advance per wave). `operationId = ${epoch}:0:${wave}`. Cross-wave
  stale ordering is therefore structural and is the **typed successor of the legacy `lastResolvedWave`
  double-advance guard**: a WAVE_ADVANCE for wave N when the guest already adopted N+1 is rejected
  (`N < lastAppliedWave`).
- **Local reconstruction, no new wire message** (matches Wave-2a/2c/2d). The DATA still rides the
  existing `waveResolved`/`waveEndState` messages (dual-run). The guest RECONSTRUCTS the payload from
  the received `pending` (`consumeCoopPendingWaveAdvance`) + its adopted battle context (battleType is
  host-authoritative per #867; `isNewBiome()` is deterministic). `outcome` is the host-relayed control
  bit; the extra fields derive from already-adopted host state.
- **Same phases, selected by ADOPTION not DERIVATION.** The guest's tail switch is now keyed on the
  adopted op's `payload.outcome` (== `pending.outcome`), so the built phases are byte-identical to
  legacy; the SELECTION is op-gated (idempotent, stale-rejected). Capture data (`captureParty`,
  `capturePresentation`) still comes from `pending`.
- **FAIL-LOUD, not derive** (§2.5 item 4): under flag-ON, an op that fails to adopt for a NON-stale
  reason (fail-closed unknown kind / guest-applier gap) logs LOUD and does NOT silently derive. A
  stale/dup rejection is a legitimate skip (the wave already advanced). Only flag-OFF derives.
- **STRICT-TAILS is a SEPARATE observe-only sub-flag** (default OFF), never enforcing (§6.3). The op
  PUSHES its sanctioned tail set into the gate (`setCoopWaveTailSanction`) on adopt — keeping the gate
  a cycle-free leaf. An unsanctioned boundary tail logs `[coop:gate] TAIL WOULD-BLOCK` and still RUNS.
- **ME-boundary is left on the Wave-2c ME operation.** The ME-spawned battle victory
  (`queueCoopMeBattleVictoryTail`) does NOT flow through `broadcastCoopWaveResolved` (VictoryPhase's
  isMysteryEncounter branch returns before it), so no WAVE_ADVANCE is committed for ME battles. The
  payload carries `meBoundary` for schema completeness + sanction accounting, but standard waves state
  `meBoundary: "none"`. Routing the ME victory tail through WAVE_ADVANCE would conflict with the
  ME_TERMINAL `battle` op — deliberately NOT done.

## The WAVE_ADVANCE payload shape I settled on

Declared in `coop-operation-envelope.ts` as `CoopWaveAdvancePayload`:

```ts
{
  wave: number;                 // the wave that RESOLVED — the op pin + double-advance guard key
  outcome: "win" | "capture" | "flee" | "gameOver";  // successor of CoopWaveOutcome
  nextLogicalPhase: CoopLogicalPhase;  // WAVE_VICTORY | WAVE_FLEE | GAME_OVER — makes logicalPhase host-authoritative
  nextWave: number;             // wave+1 normally; == wave on game-over
  biomeChange: boolean;         // crosses a biome boundary (SelectBiomePhase / #863/#864)
  eggLapse: boolean;            // an egg-lapse fires (EggLapsePhase)
  meBoundary: "none" | "battle-victory";  // ME-spawned battle victory routes its own tail (#847)
  victoryKind?: "wild" | "trainer";  // for win/capture — drives TrainerVictoryPhase; absent for flee/gameOver
}
```

Host builder: `buildCoopWaveAdvancePayload(outcome, wave)` in `coop-runtime.ts` (exported; the guest
reuses it to reconstruct). Also added `CoopWaveVictoryKind` + `CoopWaveMeBoundary` type aliases and
`"WAVE_ADVANCE"` to `CoopOperationKind` + `KNOWN_OPERATION_KINDS`.

## Transition classes — status

| Class | Code path | Status |
|-------|-----------|--------|
| WILD win → NewBattle | `maybeRunCoopWaveAdvance` win/capture arm | **DONE** (op-gated + engine-free tests) |
| Trainer victory | same arm, `victoryKind: "trainer"` | **DONE** (payload + sanction; engine-free tests) |
| Biome boundary | `biomeChange` field + flee/win biome cascade | **DONE** (payload + sanction; engine-free tests) |
| Game-over | gameOver arm | **DONE** (payload + sanction; engine-free tests) |
| Flee | flee arm | DONE (payload + sanction) |
| ME-boundary | `queueCoopMeBattleVictoryTail` | **UNTOUCHED** by design — stays on the Wave-2c ME_TERMINAL op |

"DONE" = wired + covered by the engine-free lifecycle spec (`coop-wave-operation.test.ts`, 21/21
green). **NOT yet done: the two-engine duo regressions** (one per class + adversarial) — deferred
because they must drive the real commit/apply path, which the remediation is replacing.

## Assumptions about the applier I baked in (REVISIT on resume)

1. **`CoopOperationHost.submit` commits + advances a surface-local revision, and `onApplied` is where
   the legacy counter/state advance hooks in.** WAVE_ADVANCE currently passes NO `onApplied` (host-
   driven, no legacy counter to lockstep). The mutating applier must decide whether wave-advance needs
   an apply hook that gates markApplied on the tail actually being constructed.
2. **`CoopOperationGuest.applyEnvelope` at `revision = last+1` always returns "applied" for a fresh op
   id** (I feed it a surface-local dense revision). Under the shared dedup ledger + producer-revision
   restore, the guest applier's revision source changes — the wave-op's `g.getLastAppliedRevision()+1`
   must move to the shared ledger, and cold-resume must restore `lastAppliedWave` (not restart at -1).
3. **The op is currently a control-only bookkeeping layer** — `authoritativeState` is a placeholder the
   applier never reads; the real tail construction happens in `maybeRunCoopWaveAdvance`, NOT in the
   applier. Under the transactional mutating applier, the tail construction (or its success signal)
   should gate `markApplied`/ACK so an op cannot ACK without the tail being built.
4. **Stale/dup gating is on `lastAppliedWave` (module-local) + `guest().hasApplied(opId)`.** These must
   consolidate into the shared dedup ledger so the wave-op and the journal agree on exactly-once.
5. **Epoch is constant (1) per session; cold resume restarts `lastAppliedWave` at -1.** The producer-
   revision-restore fix means a cold resume must instead RESTORE the wave pin so post-resume advances
   aren't read as duplicates (the exact P0 #3 shape, applied to the wave surface).

## Files touched (all in `dfad95161`)

- `src/data/elite-redux/coop/coop-operation-envelope.ts` — kind + payload + KNOWN set (additive).
- `src/data/elite-redux/coop/coop-wave-operation.ts` — NEW adapter (host-commit + watcher-adopt + flag).
- `src/data/elite-redux/coop/coop-runtime.ts` — host commit in `broadcastCoopWaveResolved`,
  `buildCoopWaveAdvancePayload`, reset wiring in assemble/clearCoopRuntime.
- `src/phases/coop-replay-phases.ts` — guest adopt in `maybeRunCoopWaveAdvance` (op-selected tail).
- `src/data/elite-redux/coop/coop-renderer-gate.ts` — STRICT-TAILS observe sub-flag + sanction push.
- `test/tests/elite-redux/coop/coop-wave-operation.test.ts` — NEW engine-free lifecycle spec (21/21).

## Verification captured at park time

- `tsc --noEmit`: **301 errors, ZERO new vs parent** (parent baseline 301 on tip `0991a8e1d`).
- `coop-wave-operation.test.ts`: **21/21 green**.
- NOT yet run (deferred until the applier lands): `node scripts/run-coop-gate.mjs` full gate, the duo
  wave regressions (not written yet), the SOAK_SEED=20260709 both-flag-state soaks, coop-soak-me /
  coop-soak-resume. The doc §8.6 keystone notes + §3 transitional-allowance updates are also not yet
  written (deferred so they document the FINAL applier-targeted shape).
