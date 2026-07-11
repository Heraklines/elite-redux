# Handoff: W2e remediation cycle + keystone (2026-07-10)

**Audience:** the external review agent. This documents everything done in response to the
second review (the W2e P0 findings + the two preliminary gate/reconnect findings), so it can
be verified independently and continued from. Written by the coordinating agent; every claim
below is attributed to a commit and a test you can re-run.

**Tree state:** all work is integrated on **local** `feat/elite-redux-port` (this checkout).
NOTHING here is pushed or deployed — remote staging remains at `0991a8e1d` (pre-W2e).
The final combined 4-lane gate verdict is recorded at the bottom of this file.

Contract doc: `docs/plans/2026-07-10-coop-authoritative-run-state-migration.md`
(§8.6 = W2e-R remediation notes, §8.7 = keystone notes — both added today).

---

## 1. Review finding → disposition matrix

| Reviewer finding | Disposition | Where (code / commits) | Proof (tests) |
|---|---|---|---|
| **P0-1: journal can ACK without mutating** ("report a desync as healed without applying the mutation") | **FIXED** (mechanism) + **first production materializer** (keystone) | Tri-state `CoopApplyOutcome` ("applied"/"duplicate"/"rejected"); `CoopDurabilityManager.receiveOp` gates `markApplied`+`coopAck` on it; thrown apply → `rejected` → no ACK, retriable; live-mutation seam `registerCoopOperationLiveSink`/`routeCoopOperationToLiveSink` in `coop-operation-journal.ts`. Commits `be13fd57a` (RED), `32d1e297a` (fix), `28fb0d1f1`, `97d797970` (docs). Keystone registers the FIRST production sink: `materializeCoopWaveAdvanceFromOp` → `pendingWaveAdvance` safe-boundary queue (`8c419ca1b`). | `coop-operation-durability-remediation.test.ts` T1/T2/T2b/T3; convergence suite rewritten to assert **live state** primary, journal history secondary; `coop-wave-operation-durability.test.ts` (journal→sink live materialization, 7 tests) |
| **P0-2: dual exactly-once ledgers** (relay watcher vs journal guest) | **PARTIAL — deliberate.** Wave surface (keystone) is the first **single-ledger** surface. Biome/ME/reward keep the split ON PURPOSE: unifying before their materializers exist makes the live relay-adopt see the journal's operationId as already-applied → deterministic fallback → **wrong biome** (a live desync, the §8.5 hazard). Documented §8.6. | `coop-wave-operation.ts` (one `CoopOperationGuest`, build gate = `lastResolvedWave` not the ledger) | wave duo suites; §8.6 rationale |
| **P0-3: producer revision resets to 0 on cold resume** (restored receiver at N discards post-resume ops as stale) | **FIXED** | `revisionFloor` + `setCoopXOperationRevisionFloor` per surface (biome/ME/reward/wave), wired from `applyCoopControlPlaneSaveData` keyed by op class. Choice: **monotonic continue** (revision floor), NOT epoch bump — W2b persistence already continues counter+high-water monotonically (§1.4/§4.6); an epoch bump would require receiver-ledger reset, contradicting that design. | Remediation T4 (RED: producer emitted rev 1, receiver at N=5 dropped it; GREEN: continues at N+1); T8 (mid-stream reward loss stays ordinal-aligned) |
| **Item 4: recovery completeness** (snapshot fast-forward, overflow resync, send retry, intent loss) | **FIXED at the durability layer**; two production-wiring residuals (below) | W2e-R2: `adoptSnapshot` (I2), overflow deep-gap → `sendFullSnapshot` escalation, no unusable partial tail (I3), `commit()` guards a throwing send — op stays journaled/retriable (I4). 11 commits `70e76a76f..a93b72cfb`, failure-first red→green each. | `coop-operation-durability-recovery.test.ts` (6) |
| **Item 5: pre-commit intent loss** | **DOES-NOT-EXIST for double-apply** — `operationId` is a pure function of the slot, so re-send/late-original collide on the same id and `CoopOperationHost` dedupes (reack). Contract established by tests. **Residual:** the re-send *trigger* is not wired (lives in surface adapters). | same batch | `coop-operation-precommit-intent-loss.test.ts` (4) |
| **Item 6: checkpoint not loaded on resume** | **Half already closed, half fixed.** I6a: `applyCoopControlPlaneSaveData` → `durability.restore(marks, marks)` was already wired (verified, test-proven). I6b (real residual found): committer's peer-ACK map wasn't restored → spurious escalation after converged resume → `CoopJournal.restoreAcked` added. | `cee25e54f` | I6 tests in recovery suite |
| **Prelim A: gate weaker than green** (prod-fidelity soak skipped + non-gating; hard invariant after wave 1 still passes) | **FIXED** — new gating **LANE P** (12-wave production-fidelity, `SoakInvariantError` uncaught → exit 1 → GATE RED; asserts wavesCompleted==WAVES, findings==[], assertions==0). Red path proven by probe. Both mechanisms documented (gate never set SOAK_FIDELITY; the evidence test caught `SoakInvariantError` and logged it). #891 re-triage: **both old findings FIXED-SINCE** (money = benign renderer lag re-synced at wave start; shop strand not reproduced over 20 waves). | `scripts/run-coop-gate.mjs` (LANE P), `coop-soak-fidelity-gate.test.ts`. Commits `6e914396a`, `75c3faaee` | `--lane P` green/red-probe evidence in #897 report; CLAUDE.md gate docs updated |
| **Prelim B: reconnect asymmetry** (guest-only reconnect; first op of a class lost forever) | **FIXED (#898)** — class-agnostic `{t:"coopResyncAll"}` wire arm; committer proactively resends its full committed-but-unacked tail (covers never-seen classes without per-class enumeration). Both convergence suites migrated from both-sided reconnect to the **production guest-only** topology. | `914a063a3` (+RED `70e76a76f`) | recovery suite I1; migrated convergence DIRECTION 2 |
| **Unnegotiated protocol** (flag/version-inferred activation) | **FIXED** — negotiated capability-bit handshake: `coop-capabilities.ts`, intersection of both peers' advertised sets, fail-closed both directions, absent field = legacy peer = all off, hot-rejoin preserves / re-pair renegotiates, no protocol bump (additive optional field on hello/rosterSync). Surfaces gate on `enabled && !isCoopSurfaceCapabilityBlocked(cap)`. `renderer.allowlistEnforce` capability ready for the enforce flip. | `25b14cc43`, `a4046587d`, `a4d40c8e6` | `coop-capabilities.test.ts` (14), `coop-capability-handshake.test.ts` (9) |

Reviewer failure-first tests 1–10 → T1–T4+T8 in `coop-operation-durability-remediation.test.ts`;
5,6,7,9,10 in `coop-operation-durability-recovery.test.ts` + `coop-operation-precommit-intent-loss.test.ts`.
Every RED was committed before its fix with the failure reason documented (verify via `git log` order).

## 2. Keystone (W2f): host-stated WAVE_ADVANCE — landed

The guest no longer self-derives the wave-advance tail on the migrated path: the host STATES
the transition (`WAVE_VICTORY`/`WAVE_FLEE`/`GAME_OVER` ops), the guest materializes from the
committed op. First surface with: a production live sink (proves a journal-delivered op can
LIVE-materialize — the reviewer's central demand), ONE ledger, `opSurface.wave` negotiated
capability, `op:wave` revision floor. Flag `COOP_WAVE_OP` (default ON), full legacy fallback.
STRICT-TAILS renderer-gate sub-flag remains observe-only.
Commits `65d144ddd`..`427ee944e` (8). Proof: 28 engine-free + 7 durability-seam +
per-transition-class duo 5/5 (wild/trainer/biome@10/ME/game-over) + multiwave duo 5/5 in
BOTH flag states + its own worktree 4-lane gate ALL GREEN (incl. lane P solo).

## 3. #899 LANE P rendezvous queued-arrival race — fixed in continuation

A LANE P red ("NO-PARK wave 2, enemies never all fainted") on the shared checkout was
bisect-proven to be a **load-dependent harness flake, not a regression** — identical trees
flip green/red under load. Mechanism (file:line in task #899): `coop-rendezvous.ts`
`VITEST_DEFAULT_WAIT_MS = 50` raw `setTimeout` backstop races the single-threaded two-engine
pump; host "PROCEEDS without partner" while the guest's arrival is ALREADY BUFFERED; guest
scene drifts; production-fidelity command sourcing reads the drifted guest scene → `-1`
targets → 60-turn cap. Fix direction: event-driven release (honor the buffered arrival);
do NOT weaken the invariant. Note the irony worth reviewing: the backstop-fires→unilateral-
proceed→drift shape is a miniature of the exact production class this migration kills, and
LANE P caught it in the harness's own machinery on its second run. Tier-4 solo work and all
co-op commits are exonerated; the parallel agent's WIP is exonerated.

Continuation closure: `coop-rendezvous.test.ts` now locks the deterministic race where the partner queues
its real loopback arrival and the injected vitest timeout fires before the delivery microtask. Previously
the timeout deleted the waiter and proceeded unilaterally; the real arrival landed immediately afterward
as an unusable buffer hit. Commit `4202d3beb` captures the RED and `2bced4b35` fixes it by giving queued
transport events one delivery microtask before committing the timeout, then rechecking `partnerArrived`.
Dead-partner and dropped-wire backstops stay loud and bounded. Proof: rendezvous primitive 10/10,
production-wired pacing/biome boundary duo suites 8/8, and gating Lane P (12 waves) PASS in 111s. The hard
invariant was not weakened.

## 4. Commit ledger (local feat, today, in order)

- `6e914396a` + `75c3faaee` — LANE P gating lane + honesty evidence + CLAUDE.md (#897/#891)
- `25b14cc43` + `a4046587d` + `a4d40c8e6` — capability negotiation (#896 part)
- `be13fd57a` + `32d1e297a` + `28fb0d1f1` + `97d797970` — W2e-R P0 remediation (#895/#890)
- `70e76a76f`..`a93b72cfb` (11) — W2e-R2 recovery batch (#896/#898)
- `65d144ddd`..`427ee944e` (8) — keystone W2f (#894)

Interleaved non-co-op commits (tier-4/5 ability audits, e.g. `da5f5e522`, `4f29a65d6`) are a
parallel solo agent's work — out of scope here, exonerated by the #899 bisect.

## 5. Verification runbook (for the reviewer)

- Full gate: `node scripts/run-coop-gate.mjs` (lanes A/B/C/P gating; QUARANTINE non-gating,
  known-fail `coop-shop-continuation-orphan` = pre-existing mock defect, task #892).
- Suites named above run solo: `npx vitest run <file> --no-isolate` (engine-free) — heavy duo
  files need `--isolate` and a quiet box.
- tsc baseline: ~293–301 pre-existing errors on this branch (none in co-op files except 4
  pre-existing test-file errors listed in #890 history; CLAUDE.md's "277" is stale). Verify
  zero NEW: errors in files touched today = 0.
- Lane P caveat: a wave-2 NO-PARK red under heavy machine load is #899, not a code regression.
  Re-run solo on a quiet box before attributing.
- Failure-first audit: for each fix commit, check the immediately preceding test commit
  documents the exact red reason.

## 6. Where to continue (ordered, per the standing "complete the spec" directive)

1. **#899** — event-driven rendezvous release for the vitest pump (gate robustness; P1
   because until fixed, lane P reds on loaded boxes cost triage time).
2. **Per-surface live sinks + ledger unification** for biome/ME/reward (pattern now proven by
   the wave surface; kills the remaining P0-2 splits + makes journal recovery live-material
   on all migrated surfaces).
3. **I5 re-send trigger** — wire owner re-send on relay timeout in the surface adapters
   (mechanism already exactly-once-safe).
4. **adoptSnapshot / sendFullSnapshot production wiring** — snapshot-adopt path calls
   `adoptSnapshot(cls, head)` per class (DATA-plane follow-up per §4.4).
5. **Remaining spec surfaces** (§2 order): bargain / colosseum / ability-picker; then the
   per-mon batch (faint-switch, revival, learn-move, catch-full, stormglass); lobby/resume LAST.
6. **Enforce flip**: renderer allowlist + STRICT-TAILS to enforce, gated on the negotiated
   `renderer.allowlistEnforce` capability + zero WOULD-BLOCK live evidence.
7. **Wave-3**: real-browser duo tests, model-based fuzz, forced-surface 200-wave campaign.
8. Housekeeping: #892 quarantine mock fix, #893 stash purge/ban, #878 statStages transient.

## 7. Final combined gate verdict (2026-07-10 16:30)

Full `node scripts/run-coop-gate.mjs` on the fully integrated tree (commit `427ee944e` + this doc):

- **LANE A: PASS** (59 files, 72s) — includes all new engine-free suites.
- **LANE B: 85/86 PASS**; the single failure (`coop-duo-mystery.test.ts`, host-owned
  DEPARTMENT_STORE_SALE lockstep leg) **re-ran 6/6 GREEN solo** immediately after on a quiet
  box. Failure shape: `PhaseInterceptor.to("PostMysteryEncounterPhase")` waitUntil timeout with
  the run already AT that phase — the same load-sensitivity class as #899 (two-engine tests
  under multi-worker contention), not a code regression. The same file was green in both the
  W2e-R gate and the keystone worktree gate.
- **LANE C: PASS** (8 files, 412s).
- **LANE P: PASS** (112s) — the production-fidelity soak passes on the fully combined tree
  in the same full-gate run (i.e. not only solo).
- QUARANTINE: known pre-existing fail, non-gating (#892).

Reviewer note: the two flake events observed today (lane P NO-PARK under load, lane B
interceptor timeout under load) are both the #899 scheduling-race class in the TEST HARNESS,
bisect-exonerated from all product commits. Re-run any suspicious lane solo before attributing
a red to code. Fixing #899 (event-driven rendezvous release + possibly a load-aware
interceptor budget) will remove this triage tax.

## 8. Continuation evidence (authoritative-surface live materializers)

Work resumed on the same branch after this handoff. Claims below are intentionally limited to the
surface tests run; the full four-lane gate and final long soak have **not** yet been rerun.

| Surface | Failure-first RED | GREEN implementation | Live-state proof |
|---|---|---|---|
| Biome travel / crossroads | `5d14d7296` | `c0bad7aeb` | `coop-duo-biome-operation.test.ts`: `DURABILITY: dropping only biomePick still materializes the committed op through the real guest travel path` (2/2 file green). The journal and relay now share one `CoopOperationGuest`; the production sink feeds the receiver's real biome/crossroads relay safe path. |
| Reward + biome market | `fe8c5d60f` | `17db58d40` | `coop-duo-reward-operation.test.ts`: dropped reward relay still applies the committed party-target action/sub-pick (5/5 file green). `coop-duo-biome-market-continuation.test.ts`: dropped `biomeShop` buy + leave relays materialize the two-operation ordinal stream, money/party target, continuation pin, and terminal (2/2 file green). |
| Mystery encounter | `8dc29c648`, `e7c4c9adc`, `a0c806100`, `fbf9830f8` | `b37467df9`, `f39eaa677`, `4d1267563`, `771fecbb4` | `coop-duo-me-operation.test.ts`: dropping the legacy 9M terminal or top-level `mePresent` still settles the real replay phase and adopts the host presentation (7/7 file green). Ordered top-level/repeated/subprompt presentations carry their complete host-rendered payload; raw and journal outcome carriers dedupe whichever order wins. Catch-full and yes/no helpers commit accepted guest `ME_SUB` proposals at the authority (`coop-me-catch-full-subprompt` 7/7; sibling channel/durability batch 14/14). The journal and live watcher now share one ME operation ledger. |

Shared regression evidence for these commits: `coop-interaction-relay`, `coop-interaction-kind-validation`,
`coop-operation-durability-remediation`, and `coop-operation-durability-convergence` = 29/29 green;
`tsc --noEmit` produced zero errors in touched files. Mystery-specific regression batches added 7/7 duo,
24/24 relay/durability, 7/7 catch-full, and 14/14 sibling channel/durability passes. The full four-lane gate
and final long soak remain intentionally unclaimed. Next is #899; all later work items in section 6 remain open.

## 9. Continuation evidence (I5 intent recovery + production snapshots)

The next two recovery residuals from section 6 are now closed with failure-first commits. Claims remain
limited to the named suites; the full four-lane gate and final long soak have not yet been rerun.

- **I5 guest proposal resend:** `48544e564` records the RED (a lost guest-owned ME proposal never
  retransmitted); `33d928b49` wires a lifecycle-bounded one-second retry for top-level ME picks and ME
  sub-picks. Every retry reuses the same deterministic operation address; the authority's committed
  envelope cancels it, including the cross-carrier duplicate case, and session reset clears all timers.
  Earlier seam commits `c7e325b84` / `59552c093` expose the stable operation id. Proof:
  `coop-operation-precommit-intent-loss.test.ts` 6/6 and the adjacent durability remediation suite 6/6.
- **Snapshot revision adoption:** `acd822544` records the RED (a full `stateSync` discarded the operation
  heads it already subsumed); `f2617bf04` stamps every production full snapshot with `journalHighWater`
  and fast-forwards/ACKs every stamped class after the ME-boundary, stall-recovery, and hot-rejoin apply
  paths. Proof: recovery suite I2/I2b.
- **Deep-gap production carrier:** `d37710d51` records the RED (overflow escalation had no live snapshot
  carrier); `3a2d33615` wires `sendFullSnapshot` to a reserved `stateSync` push, applies the heavy snapshot
  on the guest, then ACKs the evicted range. The wire semantic is guarded by protocol version
  `er-coop-13`, preventing mixed-build silent fallback. Proof: recovery I3/I3b, battle-stream 31/31,
  capability/WebRTC 34/34. Touched-file TypeScript diagnostics: zero.

The next implementation item is the checkpoint replay loader: `test/tools/coop-duo-harness.ts` must
restore `trace.checkpoint` (mutated party, inventory, wave, money, and RNG state) instead of rebuilding
every replay from the original launch roster. Journal coverage sweep and the remaining operation surfaces
also remain open; no final “no gaps” claim is made.

## 10. Continuation evidence (authoritative checkpoint replay)

The checkpoint replay-loader residual is closed. `c4490fd4d` is the failure-first RED: a deep-window
co-op trace booted from its original Pikachu/Abra launch roster instead of the caught, leveled, and
move-modified Snorlax/Gengar party captured at wave 7. `910c3d528` makes the checkpoint the replay boot
authority: it pins the checkpoint seed immediately before `EncounterPhase` generates the battle, starts
at the captured wave, reconstructs the full `PokemonData` party and moves, restores persistent modifiers,
money, and ball inventory, and mirrors that exact state into the guest before replaying any event. It also
disables the test launcher's global moveset override before restoration; otherwise every
`Pokemon.getMoveset()` read silently mutated the checkpoint party back to the fixture moves.

Proof: `coop-duo-replay.test.ts` 5/5, including the production capture-to-replay round trip and the new
deep-window checkpoint case; touched-file TypeScript diagnostics are zero and Biome reports no errors
(two pre-existing harness complexity notices remain). The full four-lane gate and final long soak have
still not been rerun, so they remain unclaimed.

Next: perform the non-cosmetic journal coverage sweep, then migrate the remaining contract section 2
surfaces in order (Giratina bargain, colosseum, ability picker; per-mon operations; lobby/resume last).
Renderer allowlist enforcement, quarantine closure, expanded soak coverage, and the final drop-every-class
campaign remain open. There is still no justified “no gaps” claim.

## 11. Continuation evidence (journal coverage sweep: Giratina bargain)

The non-cosmetic wire audit found the first post-keystone hole in Giratina's bargain: its one terminal
`interactionOutcome` was classified and queued as durable transport traffic, but no committed operation
journal retained it. `e3f51b41b` is the failure-first RED: drop only that legacy outcome and the real guest
watcher remains parked in `TheBargainPhase`. `0021292d5` adds the negotiated `opSurface.bargain`
capability, typed `BARGAIN` outcome, `op:bargain` journal class, cold-resume revision floor, one guest
operation ledger, and a production live sink that feeds the committed outcome into the existing safe
outcome waiter. The legacy relay remains the flag-off fallback.

Proof: the two-engine exploration probe passes with the operation enabled while the legacy bargain frame
is actually dropped, and passes with the operation disabled on the pure legacy carrier (2/2). Capability,
handshake, durability, and recovery suites pass 54/54; touched-file TypeScript diagnostics are zero and
Biome reports no errors (only pre-existing warnings/notices in the large runtime and exploration files).

The journal sweep is not complete. Colosseum and ability-picker are next in the contract's order, followed
by the per-mon in-battle classes. The full gate and long soak remain unclaimed.

## 12. Continuation evidence (journal coverage sweep: colosseum)

The repeated colosseum board stream is now migrated. `cf6a95de8` and `a06c89c34` are the failure-first
RED commits: dropping only the host's `coloBoard` presentation or `coloPick` decision left the guest's
real outcome/choice FIFO empty. `50693e5ab` adds the negotiated `opSurface.colosseum` capability,
multi-action `COLO_PICK` payload, ordinal-addressed `op:colosseum` journal class, resume revision floor,
and production materializers for repeated board/decision pairs. The flag-off legacy path remains tested.

The opposite direction had a separate pre-commit hole. `8ee06a641` proves a dropped guest-owned
`coloPick` made the host time out; `5a443b6ab` adds lifecycle-bounded owner resend, reusing the same
decision until the host's committed envelope returns and cancels it. Guest-owner confirmations are not
fed back into the same pinned choice FIFO, preventing a prior round's confirmation from poisoning the
next round.

Proof: `coop-colosseum-board.test.ts` 13/13, covering repeated round loops, both ownership directions,
both raw-carrier drops, guest-intent loss, and flag-off fallback. Capability/handshake/recovery regression
suites remain green; touched-file TypeScript diagnostics are zero. Biome reports no new errors (existing
complexity/no-void notices remain). The full gate and long soak remain unclaimed.

Next journal surface: ability picker. Per-mon in-battle operations, lobby/resume, enforcement, quarantine,
expanded soak coverage, and the final drop-every-class campaign remain open.

## 13. Continuation evidence (journal coverage sweep: ability picker)

All three ER ability-consumable picker phases now share one durable `ABILITY_PICK` operation path.
`dfc49559c` is the first failure-first RED: dropping the host-owned legacy `abilityPicker` frame left the
guest FIFO empty. `31578436e` is the second RED: with both normal carriers present, the journal materialized
one choice and the later raw echo buffered a phantom second purchase. The behavior-neutral carrier seam was
introduced in `1ad54d7b7`; `438876b4e` adds the negotiated `opSurface.abilityPicker` capability,
ordinal-addressed `op:ability` journal, resume revision floor, one watcher ledger, production materializer,
guest-owned intent retry/cancellation, and ability-scoped raw/journal echo suppression in both delivery
orders. The flag-off path remains the byte-compatible legacy relay.

The watcher gate is wired into Ability Capsule, Greater Ability Capsule, and Greater Ability Randomizer,
including journal-first materialization markers so a committed envelope wakes the real phase without a
second mutation. Malformed payloads reject without ACK; lifecycle reset clears operation state and retry
timers. Echo suppression is intentionally enabled only for `abilityPicker`: a broader payload-only rollout
briefly regressed repeated reward/ME sequence semantics, and was removed. Other surfaces must opt in only
with their own identity-aware ordering regressions.

Proof: ability-picker + interaction-relay suites pass 31/31, including host-carrier loss, guest-intent loss,
normal dual-carrier exactly-once, raw-first/journal-first order, all literal payloads, and flag-off fallback.
The combined ability/relay/capability/handshake/recovery batch passes 81/81. The real two-engine #789 probe
passes (Ability Capsule applied to the partner's mon converges on both engines); colosseum remains 13/13;
the gated reward end-to-end and ME battle-handoff regressions pass after the ability-only echo scope.
Touched-file TypeScript diagnostics are zero. Biome reports no errors (only pre-existing complexity/no-void
notices in large legacy files).

Next: contract section 2.5 item 6, beginning with faint-switch, then revival, learn-move/batch, catch-full,
and stormglass. Lobby/resume remains last. Renderer enforcement, quarantine/stat-stage cleanup, expanded
model/soak coverage, the final drop-every-class campaign, and the full four-lane/final-long-soak gate all
remain open; there is still no justified “no gaps” claim.

## 14. Continuation evidence (per-mon operations: faint-switch)

The first section 2.5 item 6 surface is migrated. `a05061889` centralizes the authoritative guest
faint-replacement carrier without changing behavior. `19fca613e` is the failure-first RED: dropping the
guest's one-shot `switch` intent made the host waiter resolve null, which would silently auto-pick a
different bench mon. `a5fde83fc` adds the negotiated `opSurface.faintSwitch` capability, typed
`FAINT_SWITCH` payload, `op:faintSwitch` durability class under `TURN_RESOLVE`, resume revision floor,
stable wave/turn/field/final-party-slot addressing, lifecycle-bounded guest intent retry, and committed
envelope cancellation.

The authority journals the resolved replacement only after the existing species-identity and legality
checks. Therefore a party-order repair or illegal/stale proposal records the actual authoritative fallback,
not the rejected raw cursor. Host-owned replacements are journaled for trace completeness. Guest rendering
still materializes the summoned mon from the existing out-of-band authoritative replacement checkpoint;
the operation is the decision/confirmation plane and does not create a second party-mutation path. The
no-legal-bench sentinel retries under the same stable event address, and session reset clears all timers.

Proof: the focused operation suite and faulted real two-engine faint-switch path pass 4/4. In the real path,
the first guest frame is actually dropped; the host still summons the guest-selected Charizard rather than
its Lapras fallback, the guest materializes and commands it, party order converges, and forced-resync count
stays zero. The malicious cross-owner switch guard, switch matrix, capability/handshake, and recovery batch
passes 44/44; the gated half-wipe and simultaneous-double-faint suites remain green. Flag-off legacy relay
behavior is covered. Touched-file TypeScript diagnostics are zero and Biome reports no errors.

Next per-mon surface: Revival Blessing (`REVIVAL`), followed by learn-move/batch, catch-full, and stormglass.
The full gate, final long soak, and architecture residuals listed in section 13 remain open.

## 15. Continuation evidence (per-mon operations: Revival Blessing)

Revival Blessing is now migrated across both halves of its control path. `052e97a7e` is the
failure-first carrier-loss suite; `ad2b1cfc2` adds the negotiated `opSurface.revival` capability,
typed prompt/decision `REVIVAL` stream, `op:revival` durability class under `TURN_RESOLVE`, cold-resume
revision floor, journal-first prompt commit, identity-tagged raw-prompt echo suppression, and
lifecycle-bounded guest decision retry. The host commits the final species-resolved, legality-checked
target (including its deterministic fallback), so traces state what actually mutated rather than an
untrusted cursor. Host-owned local decisions are journaled for trace completeness. The flag-off path
remains the original raw prompt/choice behavior.

The existing two-engine probe contained a test-harness false negative: it deliberately parked the
completed `CoopGuestRevivalPhase` ahead of `CoopFinalizeTurnPhase`, then asserted bench state before the
normal turn authoritative state had applied. `216876617` records that apparent RED; `393fe355b` retires
the completed picker exactly as production does and proves the unified per-turn authoritative state
already carries the revived bench member. No redundant checkpoint schema was added.

Proof: `coop-revival-operation.test.ts` passes 4/4 (flag-off fallback, raw-prompt loss, dual-carrier
exactly-once, guest-choice loss/retry/cancellation). Capability, handshake, and recovery regression
suites pass 27/27. The corrected real two-engine owner-pick probe passes with the guest-selected second
fainted mon alive at identical HP on both engines, the first fainted fallback untouched, no phantom
summon, matching checksum, and zero forced resyncs. Touched-file TypeScript diagnostics are zero; the
repository-wide typecheck still reports unrelated pre-existing errors. Biome reports no errors.

Next per-mon surfaces: learn-move and learn-move-batch, then catch-full and stormglass. Lobby/resume,
renderer enforcement, quarantine/stat-stage cleanup, expanded model/soak coverage, the final
drop-every-class campaign, and the full four-lane/final-long-soak gate remain open.

## 16. Continuation evidence (per-mon operations: move learning)

Per-move and batch move learning now share one durable operation stream. `86911ae43` first centralizes
the two forward-presentation listeners into the interaction relay so raw and journal carriers reach the
same opener. `247c3f01f` is the five-channel failure-first RED; `dbb5d5c45` adds negotiated
`opSurface.learnMove`, typed `LEARN_MOVE` / `LEARN_MOVE_BATCH` prompt and decision payloads, the shared
`op:learnMove` journal class, resume revision floor, monotonic operation addresses, and lifecycle-bounded
exact-payload retries.

Coverage includes the host's per-move forward prompt, the guest's forget/decline decision, the batch
forward panel, the host-owned batch terminal used to close the guest watcher, and the guest-owned batch
terminal applied by host authority. Host decisions are journaled before their low-latency raw carrier;
guest decisions retry until the committed envelope confirms the exact assignment set. The host commits
the decoded/fallback result it actually applies, and the journal/raw batch terminal is consumed exactly
once. Existing empty-slot deterministic learns still converge through the unified authoritative state.

Proof: the new operation matrix passes 5/5, capability/handshake regression passes 28/28, the legacy
forward suite passes 5/5, and the real two-engine batch suite passes both guest-owned and host-owned
flows with both panels closing and movesets converging. Biome reports no errors and touched-file
TypeScript diagnostics are zero. The repository-wide typecheck retains unrelated pre-existing failures.

Starting with this checkpoint, every completed migration slice is kept staging-safe: focused operation
and two-engine regressions, formatting/type diagnostics, commit, push, and staging workflow dispatch occur
before the next unfinished surface begins. Production remains explicitly forbidden without maintainer
approval.

Next per-mon surfaces: catch-full and stormglass. Lobby/resume, renderer enforcement,
quarantine/stat-stage cleanup, expanded model/soak coverage, the final drop-every-class campaign, and the
full four-lane/final-long-soak gate remain open.

## 17. Continuation evidence (per-mon operations: wild catch-full)

The guest-catcher wild full-party keep/release path is now migrated. `af9625330` is the failure-first
carrier-loss suite; `6015216c3` adds negotiated `opSurface.catchFull`, typed prompt/decision
`CATCH_FULL` operations, the `op:catchFull` journal class under `TURN_RESOLVE`, cold-resume revision
floor, journal-first presentation, identity-tagged raw-prompt echo suppression, and lifecycle-bounded
guest decision retry. The flag-off path remains the original prompt/choice relay.

The authority journals the validated replacement slot it actually applies, or the explicit `-1` decline
when the guest cancels, disconnects, sends an invalid slot, or times out. The committed decision therefore
both stops owner retries and leaves a replayable explanation of whether the captured mon was kept. Retry
cancellation keys on the exact species/slot decision rather than local wave/turn coordinates, so a renderer
that is already behind cannot keep retransmitting after the authority has resolved the catch. The existing
capture-party checkpoint remains the sole mutation/materialization plane; the operation does not splice a
second party copy on the renderer.

Proof: `coop-catch-full-operation.test.ts` passes 4/4 (flag-off fallback, dropped raw prompt recovery,
dual-carrier exactly-once, dropped owner choice with mismatched local coordinates, committed trace, and
retry cancellation). The catch-full seam plus capability/handshake batch passes 24/24, with the gated duo
file intentionally skipped in that batch. With `ER_SCENARIO=1`, the real two-engine catch-full suite passes
2/2: guest-thrown replacement converges across both engines and host-thrown behavior remains unchanged.
Biome reports no new errors; the repository-wide TypeScript check retains unrelated failures and reports
zero diagnostics in touched files.

Next per-mon surface: stormglass. Lobby/resume, renderer enforcement, quarantine/stat-stage cleanup,
expanded model/soak coverage, the final drop-every-class campaign, and the full four-lane/final-long-soak
gate remain open. The slice is ready for the staging sync/deploy checkpoint before stormglass begins.
