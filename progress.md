Original prompt: Build a true two-real-browser public-UI game-over journey that proves the retained terminal race end-to-end using only keyboard/DOM input after boot, with an exact build-time production-call-chain fixture, workflow dispatch, exact evidence, ownership, and remote proof.

- Based isolated branch `ci/coop/p33-gameover-public-ui` on integration SHA `abb57b17c1c6b5bcad3309cb242359b089c1e816`.
- Added exact build+URL-gated visible Memento starter fixture and retained `WAVE_ADVANCE(gameOver)` RTC delay.
- Added public journey assertions for raw-hint rejection, retained journal bootstrap, phantom replay unpark, terminal continuation, paired GameOver, and host authority release.
- Folded in the EN/DE first-login finding from runs 29525427102 and 29525427691: localized gender option labels are now admitted through stable semantic phase/surface/readiness facts.
- Local public boundary, Node syntax, 24 static contract tests, scoped Biome (baseline warnings/info only), and `git diff --check` are green. No local Vitest, TypeScript compile, or gameplay process was run.
- The repository pre-commit hook reaches green scoped Biome, then fails on the pre-existing out-of-ownership ls-lint path `test/tests/elite-redux/er-sectionA-dex-residuals.test.ts`; commit must preserve that baseline rather than mutate another lane.
- First EN/DE remote runs `29527340256` and `29527331642` passed build/static gates and the locale-independent gender detector, then correctly failed closed before stable-seat binding because translated names leak into the functional fingerprint (`moveMap,movesets`). The DE client also exposes 64 missing-locale fallback 404s. Both issues were handed to the cross-locale integration owner.
- The dedicated GameOver lane now deliberately runs EN/EN to isolate the retained terminal ordering oracle from that separately-owned cross-locale compatibility gate; all other public journeys retain EN/DE coverage.
- Same-locale run `29528562272` reached the real reciprocal Memento turn and both production faint events, but fresh-account 1x animation chains exceeded the bounded six-minute post-turn budget. The journey now visibly selects and observer-attests 10x speed through each client's real Settings UI before pairing.
- Run `29530476924` proved blind timing is not a valid Settings driver: all twelve keys were delivered but the title selection never opened Settings. The speed driver now uses the same semantic public navigation contract as pairing, attests the initial rendered speed, computes the real right-press count, proves 10x, closes Settings, and semantically restores New Game.
- Run `29531580579` proved Title's coarse `title-menu` projection does not republish cursor changes and therefore cannot support the strict semantic option navigator. The oracle no longer depends on changing account settings. Instead, only this intentionally long terminal fixture receives a bounded, progress-sensitive 15-minute ceiling (three-minute causal-progress allowance); normal post-turn waits retain their six-minute ceiling.
- Run `29532700073` reached the real retained terminal and exposed the missing production case. The host committed GameOver at `20:51:27`; the guest admitted the journal envelope with ACK withheld at `20:51:33` while a `CoopStatStageReplayPhase` was active, so the same-turn `CoopReplayTurnPhase` continuation was still queued and the active replay aborter correctly returned false. That continuation later opened and waited forever because GameOver interrupts the host before a normal `turnResolution` is emitted. Host PostGameOver teardown closed WebRTC; guest recovery then expired. This was a real causal softlock, not a browser timeout.
- Narrow fix: retain the authority envelope's settled turn on the pending GameOver transaction. After the replay pump drains every already-ordered live event, but before it installs `awaitTurnOrLiveEvent`, the exact same-wave GameOver predicate treats that retained commit as the missing resolution fence and ends into the already-appended boundary. Wrong-wave and pre-settled-turn replays remain ineligible; the immediate active same-turn abort remains forbidden, preserving presentation.
- Reduced only the exact build+URL game-over fixture delay from 4s to 250ms. This still guarantees the separately-sent raw hint arrives before the retained envelope while avoiding the fixture itself exhausting delivery retries before the real safe-boundary continuation can ACK.
- Added the existing two-engine `coop-duo-wave-operation` regression to this workflow's remote build gate, plus static ordering/negative contracts and updated public evidence for journal bootstrap -> boundary queued -> same-turn replay released -> continuation ready -> host release -> paired GameOver.
- Exact replacement run `29535322352` proved the first closure was necessary but not sufficient. The guest opened `CoopReplayTurnPhase(1)` and installed its authority wait at `21:36:53.435`, while the retained GameOver envelope was admitted only at `21:36:56.956`. The pump predicate had already passed, and the active aborter still rejected the same settled turn, so the impossible normal `turnResolution` wait remained parked until host teardown/recovery expiry.
- Narrow second-race fix: a retained terminal may dissolve its own settled-turn replay only while that replay reports `isAwaitingAuthority()`. That state is published only after contiguous ordered live events are drained and the exact authority waiter is installed. A future terminal still cannot abort an earlier replay; speculative later-turn replays retain the existing eligibility. The public oracle accepts and causally orders both legitimate race closures: active waiter unpark (`unparkedReplay=1`) or queued continuation pump fence (`unparkedReplay=0`).
- Exact run `29537574725` passed owned type/format, all static contracts, and the real two-engine regression. Its two-browser artifact then proved the production fix succeeded through the `unparkedReplay=0` branch: journal bootstrap at `22:15:14.874`, replay fence at `22:15:19.817`, guest GameOver plus retained WAVE_ADVANCE `continuationReady` at `22:15:19.835-836`, paired GameOver proof at `22:15:19.876`, and host contiguous authority release at `22:15:21.001`.
- That run nevertheless failed because the GameOver oracle also invoked the generic normal-turn `assertRetainedContinuation`, waiting for `guest ACK turn stage=continuationReady`. GameOver intentionally interrupts before a normal turn-resolution carrier and instead completes through the exact WAVE_ADVANCE DATA/continuation proof already asserted above. The extra two-minute wait was impossible and allowed normal PostGameOver peer teardown to produce a secondary heartbeat 401 console error. Removed only that inapplicable generic turn assertion and added a static contract forbidding its return to the GameOver driver; exact operation-level bootstrap, continuation, host release, paired terminal, and ordering assertions remain mandatory.
- Replacement run `29539423095` attempts 1-3 never executed code: each failed at the authenticated GitHub API lookup for `er-assets/main` while that exact endpoint returned 503/HTML; the public Git ref remained healthy and resolved `384b79bde00b0a412e2fd0cac5fe2ff01d89026d`. The bundle job now retries the API three times, then resolves the same immutable 40-hex `refs/heads/main` commit via `git ls-remote`, with a static contract for both lookup paths and the unchanged final SHA validation.
- Local Node/static suite is green (35/35), both public-driver boundaries are green, syntax and `git diff --check` are green. No local Vitest, TypeScript compile, or gameplay/browser process was run; those remain remote-only per root policy.
- TODO: push and dispatch the fixed exact-SHA `game-over` journey, then inspect both terminal screenshots and the retained-race trace.
- Run `29539836415` reached paired GameOver and host release but exposed a distinct protocol-37 durability gap: retained WAVE_ADVANCE was safely staged for ~12s with its ACK intentionally withheld, so the host exhausted its delivery retry window even though the later material/presentation/continuation chain converged. Existing unit coverage advanced only the guest's manual scheduler; the host retry clock remained real and the false green never exercised this production path.
- Protocol 38 freezes an operation-only `journalAdmitted` stage. The exact canonical staged envelope publishes admission immediately (and republishes it on an incomplete duplicate), stopping only delivery retransmission. Material barriers remain pending and journal authority remains retained until the existing ordered `materialApplied -> presentationReady -> continuationReady` chain.
- Deterministic in-game regression scenario: start a two-player co-op wave with a retained WAVE_ADVANCE, hold the guest before BattleEnd DATA/destination readiness for longer than the full host retry budget, and require one admission ACK, zero later delivery retransmits, an unresolved host material barrier, and retained authority. Then open the exact boundary and require the three later stages plus contiguous host release. A second fault case drops the first admission, requires one exact envelope retry and admission re-ACK, then proves retries stop without early release. Wrong-address and admission-with-continuation frames remain fail-closed.
- The terminal browser oracle now preserves the immediate paired GameOver race screenshot and also waits for both real `PostGameOverPhase` boundaries before a second stable screenshot. This distinguishes causal terminal entry from the completed fade/public terminal projection and catches asymmetric teardown/save tails that an immediate phase-start capture could miss.
- Rebased the complete GameOver/oracle and protocol-38 journal-admission series onto current feature tip `1c0a237ba99436dbf7411f4e928e99ff126cb6f1`. The newer locale-ID and lazy authenticated-host public harness contracts were preserved during composition. Local public-driver contracts are 100/100 green, the public boundary is green, scoped Biome has no errors, and `git diff --check` is green. Co-op Vitest and real browsers remain remote-only per `AGENTS.md`.
- TODO: commit the recomposed freeze, force-update only `feat/coop-protocol-38-journal-admission`, dispatch the exact `game-over` journey and full sharded gate at the same SHA, then inspect the immediate and stable paired screenshots plus causal retained-operation trace before handoff.
- Recomposition was committed and pushed as `09ae460054a36b11916cf0963e1c8afbb26229ae`. Exact run `29542465632` passed build/seal, owned type/format, all four retained-operation regressions, and every static public contract; its two-browser primary GameOver journey is still running. Full sharded run `29542466889` passed 32/33 shards and failed only B7's pre-existing guest-renderer GameOver assertion.
- B7 proved the production retained terminal took the intended safe-boundary path, but the test manually started a detached `CoopReplayTurnPhase`. Its `end()` therefore shifted an unrelated fixture phase instead of the already-appended retained boundary, and the helper stopped before `GameOverPhase` was queued. The renderer helper now inserts/selects replay through the real phase tree before starting it, and the assertion names the retained transaction rather than the non-authoritative raw cue.
- The exact GameOver workflow now runs `coop-guest-renderer.test.ts` alongside the journal/two-engine regressions, with a static wiring contract and ownership entry, so this phase-queue closure cannot hide until the full B shard. Local public contracts are 101/101 green, the public boundary and `git diff --check` are green; no local co-op Vitest or browser execution was used.
- TODO: commit/push this B7 harness closure, dispatch replacement exact GameOver and full sharded runs at the same new SHA, then inspect immediate/stable screenshots and all signed gate verdicts before handoff.
- 2026-07-17 final closure: exact focused run `29562158510` is green at `44730cf11`. Prior real-browser artifacts proved two remaining oracle gaps: `SelectTargetPhase` was emitted as fatal `unclassified` and never driven when its animation-delayed prompt opened; after a successful faint replacement both browsers reached the reward shop, but the sequential-command wait did not allow that structural reward frontier to supersede nonexistent next owners.
- In progress: publish an address-bound `command:target` semantic surface, drive its selected visible target through Space in both sequential-command and post-turn waits, reset the command evidence floor after replacement, and allow paired reward/GameOver surfaces to supersede command-owner collection. Verify only through remote browser/static gates per `AGENTS.md`.
- Run `29543126051` cleared static type/format, immutable browser build, and public contracts, but B7 reproduced the same assertion at the corrected queue topology. Its timestamped log exposed the second stale assumption: `driveReplayTurn` checked the queue after one zero-delay timer, exited while the async replay pump was still current, and only then logged its shift into the retained boundary. The helper now uses bounded `vi.waitUntil` causal phase-change proofs for replay and every drained presentation/finalize phase; arbitrary timer turns are no longer accepted as completion.
- Run `29543369023` showed the causal wait completed but still stopped on an unrelated static phase left by `startCoopGuest()` ahead of the retained boundary. Because this legacy test manually drives replay rather than advancing the whole fixture, it now clears setup's static tail before admission and asserts the retained `CoopFinalizeTurnPhase` wake is the sole queued continuation. The helper remains strict: it will not skip arbitrary phases to manufacture a pass.
- 2026-07-17 architecture-closure evidence at `2eda14589`: exact focused gate `29562982130`, full 45-job sharded gate `29563165659`, fresh/resume public browser `29562982121`, and faint-replacement public browser `29563001498` passed. The 30-wave depth, Mystery, animations-on, and three deep god-soak profiles exposed four independent frontier defects instead of qualifying the checkpoint.
- Deep god-soak failures at waves 126/130/178 all carried an exact host `bossSegmentIndex=0` while the guest re-derived `1` from HP. Authoritative apply now preserves the carrier's explicit finite/clamped index; HP derivation remains only backward compatibility for older carriers that omit it.
- Nightly soak completion is now fail-closed. Only an observed `GameOverPhase` or `TitlePhase` is a verified early terminal; a missing battle, fainted party, host-half exhaustion, or thrown crossing remains a NO-PARK failure. The release workflow freezes one SHA/seed, runs exactly six calibrated profiles, verifies per-profile attestations and four current-run coverage ledgers, and requires their union to cover all ten critical formerly-probabilistic surfaces.
- The Mystery campaign failure was watcher-first evidence: one browser projected the remote-owned semantic surface before the actual owner finished narration. Any semantic projection without an actionable self-owner is now provisional and cannot fall through to the legacy role heuristic; once every browser projects the surface without a self-owner, strict mode still fails as malformed.
- The fresh-wave-2 and animations-on traces showed the 10 Hz observer's full mechanical digest starving constrained Chromium below human-playable frame rates. Only the expensive digest is cached for one second and invalidated on semantic/address/selection transitions; readiness and input-health observations remain live.
- The depth failure was a real cross-retention race: the guest had visibly applied the faint replacement, then admitted and completed the newer WAVE_ADVANCE DATA/continuation before the independently retained replacement checkpoint arrived. The late checkpoint could neither safely reopen presentation nor obtain its ACK chain, so the host retried to its retention deadline. A completed exact WAVE_ADVANCE now causally retires only same-session, non-older replacements with a strictly older state tick, emitting the ordered material/presentation/continuation ACK evidence without reopening UI. Wrong epoch, equal tick, older address, and pre-release calls remain ineligible.
- Local static evidence: public browser boundary green; 44/44 campaign/workflow source contracts green; 10/10 ownership-guard contracts green; no TypeScript diagnostics in dirty TypeScript files (repository baseline 225); `git diff --check` green. Local Biome itself crashes with a Windows Rust-worker stack overflow even on the workflow file, so formatting and every co-op Vitest/browser execution remain mandatory remote gates under `AGENTS.md`.
- TODO: push the exact closure checkpoint; require focused regressions plus Mystery/depth/animations-on real-browser profiles; inspect their artifacts; then require one exact-SHA 45-job sharded gate and the calibrated six-profile soak before feature integration or staging promotion.
- 2026-07-17 retained replacement closure: checkpoint `f0d3406a6` fixed the production wave-2 guest-picker timeout race by retaining the old-address FAINT_SWITCH terminal and parking host summon/checkpoint progression behind peer material apply. Exact focused run `29568880462` correctly went red on two outdated field-wide retry tests, one obsolete host-only timeout-success assertion, and two import-order assists; mutation assurance `29568880567` passed.
- Follow-up in progress: bind every raw faint proposal/retry to the same immutable epoch/pinned address as its durable operation, cancel retries by exact operation ID, withhold material ACK until the real guest modal transition/phase shift finishes, and port the retained terminal/material barrier to Showdown timeouts. Add true two-engine normal and Showdown timeout regressions before re-running remote gates.
- 2026-07-17 evidence correction: nightly `me-asym` proved `FaintPhase` emitted at wave/turn 1:1 but the delayed host `SwitchPhase` did not start until ambient turn 1:2. The faint source is now captured exactly once at the event, carried as one immutable `{wave,turn}` value through host and replay phases, and kept distinct from each async phase's later liveness fence. The two-engine idle-picker regression deliberately advances guest ambient turn before opening the real picker.
- Faint proposal retry identity is the immutable `{epoch,wave,turn,field}` window, not the proposed party slot. A species remap or authority fallback can therefore close the proposal without leaking a stale resend timer, while a later same-field turn remains isolated.
- Nightly `god-b` wave 190 exposed a real inert-phase tripwire: an enemy Xerneas faint queued a delayed `QuietFormChangePhase` after TurnEnd even though that phase later no-ops off-field. Authoritative recording now omits only that inert enemy revert; player reverts remain material and run inside the faint subtree before commit. The harness separately destination-schedules `authorityFailure`, preventing a guest handler from reading the host's already-incremented global turn in the shared-process fixture.
- The depth browser artifact proved `LearnMovePhase` exposed actionable `learn-move:confirm`, while the campaign wrongly required `learn-move-batch`. Single confirmation and batch learning now have distinct phase/surface policies and a static dispatch contract.
- Focused CI no longer truncates a larger affected set with `.slice(0, 5)`. It fails closed with the complete candidate list and requires the full sharded gate; faint/replacement implementation changes explicitly impact C/S/T in addition to generic A/B/P coverage.
- Local static checkpoint: TypeScript remains at the 225-error repository baseline with zero changed-path diagnostics. No local co-op Vitest or browser execution was used.
- 2026-07-17 replacement/command closure: the representative soak no longer calls `rendezvous.reannounce()` to manufacture the guest side of every command barrier. It now starts the real guest `CommandPhase` before the host and reserves the one-owner path for exact classic-final-boss stage-one geometry; the product `CommandPhase` publishes an arrive-only boundary for that same spectator case.
- Faint replacement identity now includes the authority stream's per-turn faint occurrence. Raw proposals, retries, retained operations, picker terminals, and replay phases all carry `{epoch,wave,turn,occurrence,field,party}`, so two faints in the same field slot and turn cannot consume or cancel each other. The collision-free numeric budget supports 90,000 waves, 99,999 turns per battle, 9,999 faint events per turn, and fails closed outside it.
- Guest-owned, half-wiped, Showdown, and host-owned replacement paths now withhold progression until their exact material/UI boundary is complete. Bounded MESSAGE transitions are session/runtime/phase/address fenced; a superseded transition fails the shared session instead of publishing a summon/checkpoint from stale state. Missing authoritative relays fail closed.
- Focused CI maps faint/replay changes to C/S/T as well as A/B/P and fails closed with the complete candidate list when more than five shards are affected. Local deterministic Node contracts are 25/25 green; repository TypeScript remains at the 225-error baseline with no changed-path diagnostics. Co-op Vitest and browsers remain remote-only under `AGENTS.md`.
- Remaining release evidence: commit/push the exact closure SHA, run the complete sharded gate and six-profile nightly matrix, inspect the real two-browser campaign/Mystery artifacts, and fix every red shard before staging. A dedicated public-browser wave-200/final-boss journey and the phase-two 2v1 format/save migration remain explicit architecture work; do not label the checkpoint fully bulletproof until those are implemented and green.
- 2026-07-19 Authority V2 continuation: exact gate `29706218761` at `9605e5287` proved the log-revision fence fixed B8 and Showdown S4; static, contracts, mutations, browser WebRTC, and 30/33 engine shards were green. Remaining B3 and S5 artifacts both showed a one-process destination-context defect at retained wave/replacement crossings, while B7 showed a FileReader task outliving its test and contaminating the next test's UI. The harness now destination-schedules the complete wave-to-reward and Showdown replacement crossings, uses the strict post-replacement materializer, and bounds the actual public import callback. Local scoped Biome and `git diff --check` are clean; co-op Vitest/browser proof remains remote-only.
- Architecture TODO: do not enable or advertise `authority.v2interaction` from the current draft. It still emits blanket `nextControl: null`, reuses the legacy operation revision/admission clock, and lacks address-exact projectors for all registered interaction surfaces. Complete the typed successor/control registry and single-log material apply path first, then qualify focused contracts and one full deterministic gate before public-browser campaigns.
- 2026-07-20 Authority V2 projection closure in progress: all twelve executable shared-interaction families now decode an immutable entry into a closed recovery projection plan; the global control ledger retains the exact source entry, and recovery refuses address-only interaction reconstruction. Reward/market result entries carry complete continuation generations, including concrete market subclass and exact remaining stock instead of the old guest-side stock guess.
- Mystery/quiz address audit: `ME_PRESENT` now advances a long-lived replay shell to every newer ordered presentation address. Host `ErQuizPhase` receives the exact operation ID returned by its committed quiz-session presentation, watcher `ErQuizPhase` inherits that same ID from `CoopReplayMePhase`, and every successfully opened Mystery/quiz handler republishes address-exact readiness. This closes the correct-screen-but-frozen-input class for quiz and repeated-round Mystery surfaces.
- Local verification remains static-only under `AGENTS.md`: scoped Biome has no errors, `git diff --check` is clean, and the full TypeScript rerun has zero diagnostics in touched paths (213 unrelated baseline diagnostics remain). Checkpoint `b0aa8f1bf` was committed/pushed and its full remote gate plus public two-browser campaign were dispatched before any staging decision.
- Exact-SHA gate `29733824162` exposed a projection-contract import-boundary failure before running the new tests: the engine-free decoder/test imported operation-address stride constants from engine-bearing operation modules and pulled Phaser into Node (`window is not defined`). The strides now live in a pure leaf module and the operation modules re-export them for compatibility; this is a harness architecture fix, not a relaxed assertion. The same gate and campaign must be rerun on the child SHA after static verification.
- Public two-browser campaign `29733824000` paired and reached the first real shared command in all four profiles, then failed at wave 1. Depth/dirty/mystery captured the same live architecture fault: the TURN_COMMIT parked at source turn 1, automatic victory settlement captured complete WAVE_ADVANCE state at engine turn 2, and the global V2 log rejected that immediate successor as an unauthorized coordinate. This was not transport divergence or a lobby failure.
- In progress: preserve the closed successor graph while modeling that real engine boundary. Only the exact five-kind wait emitted by the TURN_COMMIT adapter may admit WAVE_ADVANCE/TERMINAL_COMMIT at N or N+1; replacement/interaction waits remain exact and N+2 is rejected. A node-pure AuthorityLog contract covers both settlement kinds and both negative cases. After static verification, push the checkpoint and rerun both the exact-SHA sharded gate and all public campaign profiles remotely.
- Exact child gate `29736100049` proves the bounded settlement successor works: wave 1 now reaches and applies WAVE_ADVANCE revision 3, opens the real reward phase, and commits REWARD_PRESENT revision 4. The next live fault is an authority-local reservation refusal when the first REWARD result tries to consume that presentation.
- Root cause: REWARD_PRESENT/SHOP_PRESENT is synchronously retained before its caller can assign the returned operation ID to the concrete phase, while the real owner UI opens only after an async rendezvous. The initial authority projector correctly defers, but the reward and market public-ready callbacks notified only the wave transaction and never retried the global interaction ledger. In progress: have both reward and market readiness edges publish the same address-exact V2 interaction proof used by ordinary delivery and recovery, after the actual MODIFIER_SELECT/BIOME_SHOP or watcher MESSAGE handler is active.
- 2026-07-20 interaction-terminal compatibility closure: the exact phase-terminal ledger is now runtime-owned in both negotiated V2 and legacy-journal fallback. Mixed-capability sessions immediately retry only their deferred `op:global` result after the real phase terminal; V2 retry/projection remains cutover-gated. This closes the fallback Stormglass/Revival/Catch-Full failure introduced when strict materializers began requiring terminal proof, without treating raw carriers or queued UI as completion. Lane-A fixtures now model the same terminal edge, and reward fixtures include the complete market terminal result and ordered Mystery reward-surface identity. Local scoped Biome and `git diff --check` are green; TypeScript remains at 213 unrelated diagnostics with zero in touched paths. No local co-op Vitest or browser execution was used.
2026-07-20 — Authority V2 exact-terminal gate follow-up

- Triaged exact-SHA full gate `29737684710` at `bd891e77f`: Lane A fell from 11 failures to 4 (1157/1161 green).
- Closed a real two-runtime ownership seam in the Stormglass result materializer: operation-specific terminal
  proof is now read from the receiving runtime binding, never the ambient process-global runtime.
- Updated the remaining failure-first fixtures to exercise the real ordered lifecycle: complete Mystery
  terminal state, catch-full prompt/decision addresses, and Stormglass result delivery before phase terminal.
- Scoped Biome is clean apart from the known runtime baseline, `git diff --check` is clean, and TypeScript
  remains at 213 unrelated diagnostics with zero in touched paths. No local co-op Vitest/browser execution;
  remote gate requalification remains required by `AGENTS.md`.

2026-07-20 — Authority V2 campaign frontier closure

- Exact two-browser campaign `29737686349` showed one common mechanical divergence in surface, depth, and
  dirty: all digest components matched except the renderer remained one turn behind at the reward boundary.
  Generic state application intentionally excludes the control cursor, but a winning TURN has WAVE_ADVANCE
  rather than a command successor, so nothing adopted the authenticated TurnEnd cursor. WAVE_ADVANCE now
  permits only an already-settled cursor, the exact one-turn settlement, or the stated next wave at turn 1;
  every larger/wrong-wave move fails closed.
- The same campaign's mystery lane exposed a live host-owned replacement picker whose keys were permanently
  frozen. PartyUiHandler inherits MessageUiHandler for incidental text, and the V2 projector mistakenly used
  inherited message-prompt readiness as the contract for an ordinary party cursor. UI handlers now publish
  an explicit V2 actionability method: message prompts require an armed continuation, party/options/Mystery
  surfaces include their real prompt/debounce gates, and the projector consumes only that explicit proof.
- Gate `29738401566` also exposed forced/custom reward options with an unstamped tier and ordered N/N+1
  delivery gaps. Reward serialization now infers/stamps a finite canonical tier, and predecessor quorum
  immediately republishes only the retained N+1 entry. The shared-process duo harness pumps both real client
  inboxes during reward waits instead of manufacturing a sub-retry-window hang.
- Local static-only verification per `AGENTS.md`: scoped Biome clean on all 16 touched files,
  `git diff --check` clean, and TypeScript remains at 213 unrelated diagnostics with zero in touched paths.
  No local co-op Vitest or browser process was run. Remote exact-SHA contracts, full gate, and four-profile
  two-browser campaign remain required before any staging decision.

2026-07-20 — Authority V2 representative initial-control closure

- Exact full gate `29740495798` at `78179cd7f` passed planner/static/browser build, Lane A 1161/1161,
  multiple S/T shards, and mutation coverage, but every B/C shard plus P1/P2 and S4/S5 went red behind one
  synthetic-boot defect. The host adopted and committed the already-open wave-1 command boundary while the
  second in-process scene remained in Login/Title, so revision 1 stayed at `1/1/0` awaiting the guest's real
  CommandPhase proof; all later entries were correctly rejected as gaps. This was a harness lifecycle mismatch,
  not evidence for dozens of independent production failures.
- `buildDuo` now crosses the omitted guest TurnInit -> real guest-owned CommandPhase lifecycle, starts that
  public control, records its address-exact proof, then re-enters only the verified pre-pair host CommandPhase
  once so the reciprocal pacing arrival omitted before runtime construction is emitted. Public move driving no
  longer restarts an already-actionable guest command.
- A real production liveness seam was closed at the same proof edge: completing all local command proofs now
  schedules one coalesced microtask retry of retained replica entries under the destination runtime. This avoids
  recursive application before the original CONTROL_COMMIT records `materialApplied`, while removing reliance
  on the authority's later 250 ms redelivery timer.
- Static contracts pin both causal orders. The focused Node contract is 7/7 green, scoped Biome has no new
  errors after formatting, `git diff --check` is clean, and the prior full TypeScript run remains at 213
  unrelated diagnostics with zero in touched paths. No local co-op Vitest/browser execution was used.
- The older exact-SHA two-browser campaign `29740497493` remains in flight and is intentionally preserved:
  its real browser boot does not share the in-process fixture defect and therefore remains useful independent
  production evidence. Next: push the child checkpoint, rerun the complete gate, and triage only survivors.

2026-07-20 — Authority V2 wave-1 reward-result diagnosis

- The Mystery profile from real-browser campaign `29740497493` proved the initial command fix is unrelated to
  its live wave-1 failure. The guest successfully applied and proved `REWARD_PRESENT` at state tick 16, opened
  the exact read-only reward watcher, then rejected the owner's terminal Leave `INTERACTION_COMMIT` at tick 17
  before the reward adapter ran. Its mechanical browser digest had not changed.
- The central V2 interaction transaction now drains and logs the existing structured state-apply accumulator
  with incoming/accepted ticks and the live phase when such a material rejection occurs. This preserves the
  fail-closed behavior while turning the next smallest remote reproduction into causal evidence instead of
  another opaque `materialRejected` digest.
- Local verification is static-only per `AGENTS.md`; the diagnostic checkpoint requires a remote real-browser
  Mystery rerun. No staging or production deployment is authorized.

2026-07-20 — Authority V2 wire-image and successor closure

- Exact-SHA public campaign `29742878562` reproduced the terminal reward rejection at revision 5, but the new
  transaction diagnostic did not fire. That proves rejection preceded the DATA transaction. The retained
  result was a Leave payload with optional `undefined` fields: the interaction digest canonicalizer hashed
  those fields as explicit nulls, while JSON/WebRTC removed the object properties. The replica therefore
  decoded a different material image and failed closed before state application. Interaction entries now
  JSON-freeze the exact wire image before deriving their digest, operation identity, and typed successor;
  a failure-first terminal-Leave contract round-trips the entry through JSON and requires replica decode.
- Terminal reward/market and explicit biome continuations may now authorize only exact wave N+1, turn 1
  successors. Every `AWAIT_SUCCESSOR` states that permission explicitly, its value participates in the
  control identity, and malformed/missing permissions fail central validation. Static review caught and
  corrected an initial validator placement error that would have applied the new field to
  `SHARED_INTERACTION`; a direct negative contract now pins the distinction.
- The full-V2 raw interaction channel remains mechanically closed while preserving the one exact account-only
  dex merge (`COOP_DEX_SYNC_SEQ` + `dexSync` kind/payload) from authority to replica. The carrier cannot enter
  the phase FIFO or advance progression. `lockModifierTiers`, which changes reward/reroll mechanics, is now
  included in both normal and Showdown checksums and in the replication contract.
- Local verification remains static-only under `AGENTS.md`: scoped Biome has no errors (baseline warnings/info
  only), and the full TypeScript rerun remains at 213 unrelated diagnostics with zero in touched paths.
  The complete batch still requires exact-SHA remote contracts/gate and public two-browser campaign proof.

2026-07-20 — Authority V2 Showdown command-coordinate closure

- Exact gate `29756285702` at `125f6edb2` made the directly mirrored Showdown guest open its real initial
  `CommandPhase`. That exposed a production deadlock rather than a synthetic replay fault: the guest's
  reflected local player field is `f0`, while the authenticated mechanical frontier remains host-canonical
  (`f2` for the same guest-owned Pokémon). Whole-frontier equality therefore parked the real phase after
  material apply and left revision 1 at `controlDeferred`.
- Replica command admission now maps a real Showdown phase back to its exact host-canonical
  `{ownerSeatId, fieldIndex, pokemonId}` target. It accepts only an authenticated, material-applied frontier
  at the same epoch/wave/turn containing that target. Deferred starts retain the canonical target and epoch,
  so the inverse race—phase first, entry second—releases the same phase generation without coordinate drift.
- A node-pure failure-first contract pins guest-local `f0` -> canonical enemy `f2`; the existing S4/S5
  two-engine journeys remain the end-to-end proof. Local scoped Biome has no errors (repository-baseline
  warnings/info only), `git diff --check` is clean, and full TypeScript has zero touched-path diagnostics.
  No local co-op Vitest or browser process was run. Exact-SHA remote contract/Showdown qualification remains
  required before merging the checkpoint.

2026-07-20 â€” Authority V2 encounter-to-command presentation ordering

- Exact-SHA two-browser campaign `29753502613` exposed a production speed race after the wave-1 reward:
  the guest adopted wave 2 and started `NextEncounterPhase`, while the faster authority reached command
  control and delivered revision 6. Applying that command image invoked the absolute field projector during
  the guest's two-second encounter slide. The projector correctly killed battler tweens, but Phaser thereby
  discarded the slide's progression-owning completion callback; no local `CommandPhase` could ever be
  created, so the retained entry stayed at `6/6/5` awaiting its real proof.
- A command-open entry now remains admitted but material-deferred while `EncounterPhase`,
  `NewBiomeEncounterPhase`, or `NextEncounterPhase` owns the structural route to command control. When the
  real local `CommandPhase` starts, its address-exact boundary schedules an immediate coalesced retry of that
  same immutable entry; no timeout, transport resend, or locally guessed successor participates.
- A node-pure policy contract covers all three progression-owning encounter phases and proves ordinary
  `CoopFinalizeTurnPhase` and `CommandPhase` application remain available for the post-turn release path.
  Scoped Biome and remote exact-SHA qualification are required; no local co-op Vitest or browser process is
  permitted by `AGENTS.md`.

2026-07-20 â€” Public two-browser Authority V2 qualification wiring

- Exact-SHA public journey `29758213547` negotiated only `authority.v2shadow`; its browser build omitted every
  `VITE_COOP_AUTHORITY_V2_*` cutover flag even though the sharded gate, campaign workflow, staging workflow,
  and `AGENTS.md` require the complete release architecture. The journey consequently exercised legacy
  progression plus shadow telemetry and could not qualify V2 regardless of its gameplay verdict.
- The public journey bundle now enables turn, replacement, wave, interaction, and recovery V2 together,
  changes anywhere below `src/data/elite-redux/coop/authority-v2/**` trigger that workflow, and the workflow
  runs the architecture contract before building.
- The architecture contract now inspects the public-journey workflow in addition to gate, campaign, and
  staging. A future flag omission therefore fails before Chrome starts instead of producing a misleading
  multi-minute legacy campaign.

2026-07-20 — Authority V2 Showdown replacement fixture ordering

- Exact-SHA full gate `29760814283` proved S4's replacement fixtures still asserted against the speculative
  live-event `CoopGuestFaintSwitchPhase`. Under V2 that first object must retire unopened until the settled
  `TURN_COMMIT` applies; production then reconstructs the same address as a fresh picker generation.
- The common Showdown guest-pick driver now advances the real queued reconstruction after replay/finalize,
  and the idle-fallback race explicitly proves the speculative generation exposes no input before opening
  exactly one ordered picker. No production authority rule or timeout was relaxed.
- S5 failed for the reciprocal harness error: replacement material had already advanced the guest to its
  real `TurnInitPhase`, but `materializeGuestInputAfterReplacement` rejected that valid successor and tried
  to synthesize another boot edge. The helper now preserves the existing production phase for the ordinary
  phase-queue driver to start exactly once; arbitrary gameplay queues still fail closed.
- Local verification remains static-only under `AGENTS.md`; exact-SHA remote S4 qualification is required.

2026-07-20 — Public-browser wave-start and human-control lease closure

- Exact all-V2 browser campaign `29761110643` separated three production mechanisms from one noisy journey
  assertion. Mystery correctly captured `ME_PRESENT` at wave N+1/turn 0, but the reward terminal's explicit
  next-wave wait admitted only turn 1 and rejected the complete immutable interaction before its adapter ran.
  A wait that explicitly grants both the wave crossing and `INTERACTION_COMMIT` now admits only that pre-turn
  interaction; command, replacement, wave, and terminal material remain turn-1-only.
- Surface and dirty profiles installed an exact V2 `REPLACEMENT` control on both seats, then the real owner
  spent 43 seconds in the public PARTY picker. The legacy-only stall exemption could not see that control and
  launched asymmetric recovery at 20 seconds, fencing the valid replacement result and ending the session.
  The stall watchdog now recognizes the runtime ledger's installed REPLACEMENT as the authoritative human
  deliberation lease; the replacement scheduler's own 60-second lease remains the liveness bound.
- Depth exposed a distinct Authority V2 cycle after taking Rare Candy: the immutable reward result applied,
  but its same-address `LevelUpPhase` action-only presentation was frozen by the ordered successor wait while
  the guest advanced to wave 2. The explicit terminal-result crossing permission now grants only the
  same-address actionable LevelUp message and the N+1/t1 actionable NextEncounter intro. It grants no choice
  surface or arbitrary MessagePhase.
- Public journey `29760764684` did mechanically apply/ack reward terminal revision 6, install its ordered
  successor, and reach wave-2 command. Its assertion still searched for the removed legacy log word
  `JOURNAL`; the production V2 path emits `materialize retained`. The harness, unit fixture, and static
  boundary contract now require the current semantic proof.
- Local validation remains static-only per `AGENTS.md`; no co-op Vitest or browser game was run locally.
  Exact-SHA remote contracts, full gate, and focused public browser profiles remain required.

2026-07-20 — Authority V2 Mystery DATA/control projection deadlock

- Exact-SHA two-browser mystery campaign `29765183668` reached wave 2 with both engines mechanically
  converged, then retained global revision 6 forever at frontier `6/5/5`. The authority had committed a
  complete `ME_PRESENT`, while the replica remained in `NextEncounterPhase`. Its registered DATA
  materializer required an already-live `CoopReplayMePhase`, but that phase was the entry's stated successor
  and could only be projected after `materialApplied`: each stage waited on the other.
- `ME_PRESENT` DATA now transactionally establishes its authenticated interaction pin, records the immutable
  presentation, and seeds the addressed relay without consulting any phase. The ordinary V2 control
  projector can then reconstruct the exact `CoopReplayMePhase` capsule from the retained entry, supersede
  only the stale `NextEncounterPhase`/`MysteryEncounterPhase` predecessor, and wait for the real Mystery
  handler before signing `controlInstalled`.
- A static architecture contract prevents the phase dependency from returning and requires the immutable
  ordinary projection edge. Local validation remains static-only; the exact-SHA mystery browser campaign is
  the required production-fidelity regression proof.

2026-07-20 — Authority V2 immediate-replacement finalizer release

- Exact-SHA depth evidence from public campaign `29765183668` showed a second production cycle at wave 3:
  the guest's live faint presentation correctly retired its speculative replacement picker, the settled
  `TURN_COMMIT` revision 12 applied and reconstructed the exact picker, but that wake was queued behind the
  still-current `CoopFinalizeTurnPhase`. The finalizer then parked waiting for the picker it itself blocked;
  the authority timed out the unseen human surface and the replica eventually terminalized.
- The finalizer now accepts one address-exact installed-control edge. The same TURN revision can arm only its
  own immutable `REPLACEMENT`; a later edge must be exactly revision N+1 and permitted by the TURN's explicit
  `AWAIT_SUCCESSOR`. If the wake arrives during receipt completion it is retained until the park decision;
  if it arrives after parking it releases immediately. The picker wake is always queued before that release,
  while a non-owner remains parked until the authoritative `REPLACEMENT_COMMIT` carrier exists.
- The same race-safe latch now covers a deferred shared-interaction `CONTROL_COMMIT`, closing the equivalent
  fast-buffered ordering hole. A static contract pins reconstruction-before-release and both early/late race
  orders. Scoped Biome and 9/9 architecture contracts are clean; full TypeScript reports no touched-path
  diagnostics. Exact-SHA remote depth/surface/dirty campaigns remain the production-fidelity proof.
- Compact evidence from both the `cbeef84c7` depth and Mystery lanes independently reproduced this same
  wave-1 edge: the immutable turn reached `2/2/1`, the cosmetic picker had retired, the finalizer parked, and
  the exact replacement surface never became public. The resulting recovery terminal was secondary.
- Ordinary replacement projection no longer requires that cosmetic faint replay side token at all. If the
  real replay already staged the exact wake, the projector adopts it; otherwise, while the authenticated
  finalizer is current, it reconstructs `CoopGuestFaintSwitchPhase` solely from the retained V2 control and
  only then releases the predecessor. The real PARTY handler remains the only `controlInstalled` proof.
  Recovery and hard-epoch reset clear the construction guard. The architecture contract is now 10/10.

2026-07-20 - Showdown fresh-session binding admission

- The paired staging captures at `2026-07-20T17-03-19-161Z` and
  `2026-07-20T17-03-35-539Z` on build `7fc28604c` isolated the reported wave-1
  safety abort. Team and wager rendezvous completed, but the authority entered
  the battle at epoch `1827396545435366` / run
  `df99272d-907c-424a-810c-a7dd52616476` while the replica remained at epoch
  `0` with no run. The replica consequently rejected every battle event as
  cross-addressed and every turn resolution as unawaited. This was a real
  production admission defect, not a renderer or language mismatch.
- Showdown remains ephemeral and performs no save discovery, loading, or
  persistence. It now crosses the same atomic fresh-run boundary as ordinary
  co-op: functional compatibility, the authority's durable
  `resumeStartNew` epoch/run commitment, and an acknowledged P33 seat-map
  binding. Both seats fail closed if that exact gameplay address cannot be
  proved before team selection.
- `CoopSessionController.awaitGameplayBinding` is the bounded shared proof. A
  P33 session opens only from complete exact binding axes after the peer ACK;
  legacy opens only with a positive epoch and valid run identity. Disconnect,
  disposal, P33 rejection, protocol violation, and timeout close the barrier.
- The P33 behavior regression proves neither the authority's provisional epoch
  nor the replica's epoch-zero state can open gameplay, then proves both peers
  expose the same committed frame epoch after binding. The architecture
  contract prevents the Showdown title path from bypassing compatibility,
  fresh identity commitment, or binding proof while also preventing save
  discovery from leaking into the ephemeral mode.
- Local verification remained static-only per `AGENTS.md`: architecture
  contracts are 11/11, scoped Biome made only formatting changes and reports
  repository-baseline warnings, `git diff --check` is clean, and full
  TypeScript reports 589 baseline lines with zero diagnostics in touched
  paths. The P33 behavior test and Showdown end-to-end journey require
  exact-SHA GitHub-hosted qualification.

2026-07-20 - Showdown two-real-browser admission regression

- The existing exact-SHA public-browser matrix never selected Showdown, so it
  could not observe the tester's host-positive/guest-zero epoch split even
  though its ordinary co-op journeys were green. The mode also lacked stable
  title/team/wager option identities, leaving any attempted driver dependent
  on translated labels or blind cursor counts.
- A dedicated `showdown-battle` journey now registers two fresh EN/DE accounts
  and drives only the public title menu, legal preset selection, confirmation,
  lobby request/accept, Friendly wager, and battle keys. Its one-mon
  Bulbasaur/Tackle preset is available only when both the sealed build identity
  and per-page URL fixture agree; it is never persisted or auto-selected.
- Before either browser may lock the wager, the harness now requires both
  authenticated bindings to carry the same positive gameplay epoch and records
  the exact role/seat/revision/generation evidence. It then proves the shared
  wave-1 command frontier, executes one reciprocal turn, and requires the next
  exact command frontier plus retained V2 continuation retirement.
- Showdown team and wager handlers now expose read-only stable semantic option
  IDs. Wager ownership is correctly modeled as reciprocal local input rather
  than the alternating shared-interaction owner used by shops and Mystery
  encounters. Workflow path filters include the full Showdown stack so future
  changes cannot bypass this journey.
- Local validation remained static-only per `AGENTS.md`: 21/21 architecture,
  workflow, and Showdown source contracts pass; the public-driver boundary is
  green; scoped Biome has no errors; full TypeScript reports 222 repository
  baseline diagnostics and zero in the touched TypeScript paths. The exact-SHA
  two-browser journey and complete sharded co-op gate remain remote-only.

2026-07-20 - Latest-binding proof and ordered replacement result

- Exact-SHA Showdown journey `29773713537` proved the production admission fix:
  both real browsers reached the Friendly wager surface with the same final
  positive gameplay epoch. The red verdict was evidence-layer only. The
  authority emitted its permitted provisional binding before the fresh-run P33
  transaction completed, and the harness compared that first event with the
  replica's final event.
- Pairing proof now observes each browser's latest authenticated binding until
  host/guest, seats `0/1`, and one positive gameplay epoch converge. It retains
  the hard deadline and fails closed on a real mismatch. A source contract pins
  latest-event selection so the harness cannot regress to first-event latching.
- Compact surface evidence from campaign `29770309511` exposed a separate real
  ordered-control defect. A settled `TURN_COMMIT` installed executable
  `REPLACEMENT`, and the globally-next exact `REPLACEMENT_COMMIT` arrived, but
  the turn finalizer recognized later results only behind `AWAIT_SUCCESSOR`.
  The immutable replacement checkpoint was consequently buffered forever and
  recovery rejected it because the live replica still carried the prior turn.
- The finalizer now accepts only the exact operation-addressed, globally-next
  replacement result for its executable replacement control. It does not treat
  picker installation as progression permission. Local static validation is
  11/11 Authority V2 contracts, 5/5 Showdown evidence contracts, a green public
  browser boundary, clean scoped Biome, and zero TypeScript diagnostics in the
  touched co-op paths. Remote exact-SHA requalification remains required.

2026-07-20 - Exact Crossroads and chained-map Authority V2 coordinates

- Full-gate C1/P1 evidence showed `CONTROL_COMMIT` revision 26 correctly open a
  Crossroads control at wave 5, turn 2. Both the host-owned and guest-owned
  result paths nevertheless built their operation envelopes with the old
  between-wave `turn: 0` sentinel. The mechanical log correctly rejected the
  otherwise valid `INTERACTION_COMMIT` as a wrong-coordinate successor, then
  legacy receipt retries exhausted and terminalized the session.
- Crossroads now carries its immutable construction turn through owner intent,
  authority watcher adoption, ordinary projection, and recovery projection.
  The V2 projector passes the authority-stated turn explicitly instead of
  relying on whichever `currentBattle` happens to be ambient.
- The same audit found the immediately chained World Map picker would otherwise
  repeat the defect on Crossroads Leave. `SelectBiomePhase` now captures or
  receives the exact source turn and uses it for owner, watcher, and
  deterministic biome results. Its V2 projector supplies and revalidates the
  stated turn.
- A node-pure log regression proves executable shared interaction results are
  admitted only for the exact operation ID and wave/turn, and source contracts
  prevent either live phase from restoring the turn-zero sentinel. Local
  static architecture coverage is 13/13; remote node and real-engine shards
  remain the behavioral qualification.

2026-07-20 - Replacement public-proof timing and atomic double-KO ordering

- Exact-SHA S4 evidence at `b1f4e0e9d` reproduced the tester-facing safety abort
  on a single guest faint. Revision 2 had applied the complete turn and opened
  the reconstructed PARTY picker, but its readiness callback ran in an earlier
  microtask than asynchronous `setMode`. The replica therefore remained at
  `2/2/1`; the exact replacement revision 3 was a permanent gap even while the
  human successfully chose a mon.
- The replacement phase now retains the actual `setMode` completion and retries
  V2 projection only after the real PARTY handler exists. A phase token or UI
  request alone still cannot prove `controlInstalled`.
- The same shard exposed the independent double-KO abort. Both replacement
  choices and summons were already complete when the post-summon transaction
  committed its two result entries, yet occurrence 0 stated a second executable
  replacement picker. The authority-local ledger correctly refused occurrence
  1 because that already-spent picker could never be installed.
- Same-carrier replacement results now chain through an exact
  `AWAIT_SUCCESSOR` restricted to the expected next `REPLACEMENT_COMMIT`
  operation. No UI lease is granted and no local continuation is guessed; the
  final result alone states the real command or terminal successor. Node and
  source contracts pin both invariants. Remote S4 and browser qualification are
  required; no co-op engine test was run locally.
- The same async proof defect existed on the authority owner's vanilla
  `SwitchPhase`. Its V2 notification is now also chained to the real PARTY
  `setMode` completion, with a fail-closed rejection path. This covers the
  host-owned-faint C5 timeout as well as guest-owned replacement projection.
- Closed the missing mid-turn interaction edge exposed by C2. An exact
  registered `TURN_RESOLVE` prompt (learn move/batch, revival, or catch-full)
  may now consume same-address command control, while decisions, wrong phases,
  wrong kinds, and mismatched operation ids remain fail-closed. Their committed
  decisions explicitly authorize the same-address `TURN_COMMIT`, so the
  authoritative turn can finish without falling back to local phase order.
- Reclassified the two remaining S4 reds at `47b825cfd` from their retained
  traces: neither contains the tester-facing safety abort. The one-process
  fixture was synthesizing input before pumping the peer-owned V2 successor,
  and later tried to drive an already-actionable CommandPhase toward an older
  finalizer. The Showdown test now pumps both destination contexts before input
  and treats an already-installed exact CommandPhase as success.
- The exact-SHA Showdown browser run at `47b825cfd` also proved a harness cursor
  race, not a product failure: both screenshots visibly showed Friendly wager
  and the trace emitted `surfaceId=wager`, but one browser emitted it while the
  harness was still verifying its peer's seat. The wager cursor is now captured
  before that concurrent binding transition, so the one-shot public surface
  cannot fall just behind the observer window.

2026-07-20 - Installed mid-turn command successor and phase-addressed Crossroads open

- Exact-SHA C2 learn-move evidence at `68ec6ea2e` proved the prompt/result edge
  itself now commits, then exposed the next closed-graph gap: the authority's
  locally queued same-turn `CommandPhase` reached its admission boundary while
  the exact `SHARED_INTERACTION` still owned control. Treating that ordinary
  engine scheduling race as invalid authority aborted the session.
- A same-address authority `CommandPhase` now parks behind that executable
  interaction. Only the committed decision's installed
  `AWAIT_SUCCESSOR(CONTROL_COMMIT)` retries one real phase; that phase authors
  the aggregate immutable command frontier, whose commit releases the remaining
  addressed starts. A `TURN_RESOLVE` wait is distinguished by its explicit
  `TURN_COMMIT` permission and alone admits same-turn `command-open`; ordinary
  interaction waits still require the next turn.
- Exact-SHA C5 traces corrected the remaining Crossroads diagnosis. The live
  phase had captured wave 5/turn 1, but it did not start until the ambient battle
  advanced to turn 2. Its `CONTROL_COMMIT` therefore opened
  `SHARED_INTERACTION(w5/t2)`, while the correctly phase-bound result used
  `INTERACTION_COMMIT(w5/t1)`. The log rejected that impossible predecessor
  edge by design.
- `enterCoopV2CrossroadsControlBoundary` now requires the immutable phase
  `sourceTurn`, captures its complete state at that coordinate, and uses the
  same address for control, result, ordinary projection, and recovery. The
  architecture contract now checks both sides of the edge rather than checking
  only the result path.
- Local validation remained static-only per `AGENTS.md`: the Authority V2
  architecture contract is 15/15, `git diff --check` is clean, scoped Biome has
  no new errors (repository-baseline diagnostics only), and full TypeScript
  remains at 584 baseline output lines with zero touched-path diagnostics.
  Runtime co-op behavior remains GitHub-hosted qualification only.
- The completed Showdown browser artifact independently showed both real wager
  surfaces were healthy, but each was emitted before `pair()` finished its
  fingerprint/checkpoint work. The prior observer fix sampled at
  `startShowdownBattle`, which was still too late. Wager observation now reuses
  the pre-lobby-request cursor, while command evidence takes a fresh cursor
  immediately before the two real wager submissions.
- S4 then exposed a real post-replacement wake omission without a safety abort.
  Revision 3 already stated the complete turn-2 `COMMAND_FRONTIER`; the guest's
  real `CommandPhase` correctly parked while revision 3's checkpoint material
  was still applying. Material completion marked the control ready but only
  `CONTROL_COMMIT` paths released deferred command starts, so the phase waited
  for a second command-open entry that could never legally exist. Every
  non-control entry that itself states `COMMAND_FRONTIER` now releases only its
  exact addressed starts at the shared material-terminal seam.

2026-07-20 - Settlement-address closure and perspective-canonical Showdown proof

- Exact-SHA C1/C5 evidence at `768133771` showed the terminal reward result
  correctly installed `AWAIT_SUCCESSOR` at wave 5/turn 2, while Victory had
  constructed the subsequent Crossroads capsule at the still-live battle turn
  1. The phase consistently used its immutable address, so its otherwise-valid
  `CONTROL_COMMIT` was rejected as a backwards successor. Victory now freezes
  Crossroads at the one post-TurnEnd settlement coordinate (`turn + 1`) shared
  with the terminal reward; control, result, ordinary projection, and recovery
  retain that exact address.
- C2's learn-move soak had been reporting object-level moveset convergence
  without completing the production UI-to-relay chain. It started an async
  host watcher under a short-lived ambient client context, sent two unchecked
  synchronous guest inputs, and rebuilt combat even though no guest decision
  terminal entered the V2 log. The representative seam now schedules every
  delivery onto its destination client, proves the exact replay phase and real
  handler, accepts both public inputs individually, and waits for the
  relay/authority terminal before rebuilding the synthetic combat boundary.
- The dedicated Showdown artifact rendered both wave-1 battle menus but rejected
  their command proof. At turn 1 the only digest difference was account-local
  save state; after the first reciprocal turn the two party and field digests
  were exact perspective swaps. The browser observer now excludes Showdown-only
  account state and canonicalizes both teams by authenticated seat. Ordinary
  co-op retains its previous player/enemy and battler-index digest semantics.
- Local validation remains static-only: 23/23 Authority/Showdown source
  contracts pass, scoped Biome reports no errors, `git diff --check` is clean,
  and full TypeScript remains at 584 baseline lines with zero touched-path
  diagnostics. Exact-SHA GitHub-hosted Showdown and sharded-gate runs are the
  required behavioral proof.
- The same SHA's S4 artifact was 85/86 green. Its only red had already reached
  a real post-replacement `CommandPhase` with `UiMode.COMMAND`; the test started
  searching for the older finalizer just before the peer pump installed that
  successor and then classified the healthy supersession as a hang. The oracle
  now accepts either the finalizer or its ordered actionable Command successor
  during that pump, while the following assertions still require the exact
  converged field, party, phase, and single replacement carrier.
- C5's host-owned-faint trace likewise showed the complete production path:
  PARTY opened, the legal host bench was summoned, `REPLACEMENT_COMMIT` was
  emitted, and the next `CommandPhase` started. The test called
  `phaseInterceptor.to("CommandPhase")` with its default `runTarget=true`, so
  the one-sided fixture consumed the very boundary it meant to assert and later
  compared the inert `TitlePhase` tail to Command. It now stops before running
  that successor; a source contract prevents this false-red pattern returning.
- Requalification at `c4a7f972d` proved the first Crossroads correction fixed
  the authority but exposed the reciprocal retained-tail error. The authority
  opened `CROSSROADS_PICK` at wave 5/turn 2; the guest had already applied that
  settlement turn, then its reconstructed Victory added one again and parked a
  wave 5/turn 3 phase behind the turn-2 control. `settledTurn` was already in
  the V2 wave transaction but was discarded by `consumeCoopPendingWaveAdvance`.
  It now reaches the retained Victory constructor explicitly. That exact turn
  is passed to both Crossroads and the natural World Map successor, while only
  the locally-resolved authority/solo path computes the single TurnEnd advance.
- The stricter C2 learn-move seam also produced the intended diagnostic instead
  of its former false green. Revision 15 installed the exact
  `CoopReplayLearnMoveBatchPhase` over the guest CommandPhase, but the engine
  test's `PhaseInterceptor` intentionally disables
  `PhaseManager.startCurrentPhase`; production browsers would start the
  override immediately, while the driver waited for a UI that only `start()`
  can create. The driver now first proves the exact retained phase, starts that
  one phase to model the production dispatcher, then proves and drives the real
  handler and still requires the full authority terminal.

2026-07-20 - Actionability-before-result closure

- Requalification at `892021b33` proved the retained settlement coordinate:
  the guest now constructed Crossroads at the authority's exact wave 5/turn 2
  address. It also exposed the next independent race. Revision 26's
  `CONTROL_COMMIT` applied its material while the real option handler was still
  inside its 500 ms input delay. The guest emitted the Leave result as revision
  27 before revision 26 reached `controlInstalled`; the replica correctly held
  27 as a gap and remained on `ErCrossroadsPhase`.
- Crossroads no longer publishes readiness merely because OPTION_SELECT is
  visible. The owner phase re-enters its own runtime and polls the exact active
  handler's `isCoopV2InputActionable()` proof. Only then does it publish
  `controlInstalled` and the wave-continuation receipt. A source contract pins
  the required ordering so no future delayed menu can regress to
  visibility-as-authority.
- The same gate caught a nullable learn-move harness reference statically. The
  failed exact-phase proof now exits before dereference. Scoped Biome is clean
  apart from repository-baseline warnings, the Authority source contracts are
  18/18, and runtime qualification remains remote-only.

2026-07-20 - Chained World Map control-proof closure

- Exact-tip C1 proved the Crossroads actionability fix itself: revision 26 did
  not retire until the delayed OPTION_SELECT handler became actionable, and
  the guest's Leave result then applied in order as revision 27. That result's
  typed successor was the chained `BIOME_PICK`; both real World Map handlers
  opened, but `SelectBiomePhase` published only the older retained-wave lease.
  The V2 replica therefore correctly retained revision 27 at
  `materialApplied`, and the host rejected the attempted map result as a
  concurrent authority-local successor reservation.
- The owner and watcher map paths now share one runtime-bound proof that checks
  the exact live ER_MAP handler, retires the V2 `BIOME_PICK` control first, and
  only then releases the retained wave continuation. The source contract pins
  that order and requires both map paths to use it. Static validation is 18/18
  Authority contracts, scoped Biome has baseline diagnostics only, and the
  runtime fix awaits exact-SHA GitHub-hosted qualification.
- Exact-SHA requalification then proved that complete sequence through
  Crossroads revision 27 and World Map result revision 28. The ensuing guest
  `SwitchBiomePhase` nevertheless lost its already-applied one-shot permit.
  This was the two-engine fixture's async context isolation: Mystery pins had a
  monotonic save-owner token, while browser-local biome state did not, so an
  older overlapping scope could overwrite a newer permit snapshot. Biome state
  now uses the same save-generation fence in synchronous and asynchronous
  client windows.
- C2 independently exposed another fixture-only authority violation. The
  learn-move leg started a detached host `LearnMoveBatchPhase` while
  `CommandPhase` remained current, making its visible watcher handler
  ineligible to own the authority-local control lease. The soak now installs
  that exact host phase via `overridePhase` before starting it, matching the
  production queue identity. Static Authority contracts are 19/19; both fixes
  await the next remote C1/C2 qualification.

2026-07-20 - Reentrant control and pre-materialized biome closure

- Exact-SHA `f616ea69f` disproved the first C1 hypothesis without weakening the
  fail-closed path: the biome permit no longer disappeared. Revision 28 armed
  it on both clients, but applying the complete BIOME_PICK result had already
  changed each live arena from source biome 0 to destination biome 1.
  `SwitchBiomePhase` then required the old source because the permit had not
  previously been adopted and terminated both clients. First adoption now
  accepts that exact same-wave, exact-destination pre-materialized ordering;
  it still requires the immutable permit identity and records history from the
  permit's source rather than the already-updated arena.
- C2 completed the real guest-owned learn-move UI, committed its terminal as
  revision 16, and installed the ordered successor wait. Rebuilding the same
  command turn then exposed a global-ledger defect: revision 14's command
  address remained indexed after being superseded by the modal, so the legal
  revision 17 command lease was rejected solely because its semantic address
  was identical. The ledger now replaces only an older *superseded* claim with
  a newer revision; duplicate delivery remains idempotent and any live address
  conflict still fails closed.
- S4's sole red was another strict-oracle mismatch. V2 had already installed
  the desired post-replacement `CommandPhase`, with a cosmetic replay tail
  queued behind it. The helper treated that healthy frontier as an untouched
  boot scene and tried to reconstruct it, then failed loudly. It now preserves
  the already-current command boundary before considering the mirrored-boot
  fallback.
- Local validation remains static-only: Authority source contracts are 22/22,
  scoped formatting has no errors, `git diff --check` is clean, and full
  TypeScript has 222 repository-baseline diagnostics with zero touched-path
  diagnostics. Behavioral qualification remains GitHub-hosted.

2026-07-20 - Mystery projector recursion and stale readiness oracle

- Exact-SHA gate `29787230444` exposed a real V2 Mystery defect in B7, B9, C1,
  and C3. While constructing a `CoopReplayMePhase` from the immutable
  `ME_PRESENT` capsule, `installCoopV2MePresentation` synchronously announced
  surface readiness. The phase was not current and
  `v2ProjectedInteractionControlId` had not yet been installed, so the
  announcement recursively re-entered the same projector until
  `Maximum call stack size exceeded`. Downstream null-battle failures were
  consequences of that destroyed projection, not independent Mystery bugs.
- Presentation installation is now data-only. The sole readiness edge remains
  `openV2MysterySurface`: after the exact phase is current, its bounded
  `MYSTERY_ENCOUNTER` handler has opened, the phase/runtime/generation fence is
  still live, and the operation ID is bound. A source contract forbids
  construction-time attestation and pins the real handler edge.
- A1's only failure was a stale string oracle. Production owner and watcher
  World Map paths already delegated to
  `publishCoopBiomeSurfaceWhenActionable`, which proves exact ER_MAP mode,
  active handler, and executable input before releasing V2 interaction and
  retained-wave authority. The contract now verifies that centralized proof
  instead of searching each path for the retired direct notifier.
- Local static validation is 23/23 Authority contracts, scoped formatting has
  no errors, and `git diff --check` is clean. Runtime qualification remains
  GitHub-hosted.

2026-07-20 - Atomic Mystery successor and biome-market actionability closure

- Exact-SHA C1 at `ea93f7d1f` proved the recursion fix through eleven complete
  waves, then isolated a second Mystery authority seam at wave 12. The
  authenticated `ME_PRESENT` projector queued `CoopReplayMePhase` and invoked
  the obsolete `MysteryEncounterPhase.end()`. That legacy async terminal still
  derived a local `CommandPhase`, producing the visible "battle could not be
  synced" abort when the ordered Mystery control and local battle frontier
  disagreed.
- Authority V2 now destructively replaces the exact current classifier with
  its authenticated successor. The replacement discards every locally inferred
  queue and standby phase, starts the ordered generation directly, and never
  invokes the predecessor terminal. While V2 interaction cutover is active, the
  guest Mystery classifier also holds instead of locally creating its old
  replay successor. The legacy fallback remains available only outside cutover.
- P2's exact oracle independently proved that an inactive biome-market watcher
  could attest continuation. Market readiness now remains bound to its runtime,
  wave, pin, and exact live phase; owners require an active actionable
  `BIOME_SHOP` handler, while watchers require both materialized stock and an
  active actionable `MESSAGE` terminal. Visibility alone can no longer retire
  the interaction or wave lease.
- Source contracts pin both invariants, including the ban on invoking the
  replaced Mystery predecessor. Runtime qualification remains GitHub-hosted.
- The first remote C1 result at `99314d790` confirmed the replacement itself:
  its failure reported that no replay was "created" while its exact current
  phase was already `CoopReplayMePhase`. The two-engine observer still depended
  on the legacy synchronous factory tap, but V2 constructs during retained-log
  delivery after that tap is removed. It now accepts the exact directly
  installed current object and still starts only that production-created phase.

2026-07-20 - Mystery transaction-coordinate closure

- Exact-SHA C1 at `6469ae153` crossed the directly installed Mystery replay and
  exposed the next production authority fault at wave 12. `ME_PRESENT` and both
  `ME_PICK` entries correctly occupied the transaction's pre-battle turn-zero
  coordinate, but the battle and reward settlement paths borrowed the ambient
  `Battle.turn` when constructing `ME_TERMINAL`. Authority V2 correctly rejected
  that result as an unauthorized successor, and the deliberate fail-closed
  teardown surfaced later as a null session read in the harness.
- All Mystery entries now use one exported `COOP_ME_AUTHORITY_TURN` coordinate.
  The actual battle turn remains immutable destination payload material, but it
  can no longer change the mechanical log address. A source contract covers the
  presentation, both pick owners, the no-battle result, both battle settlement
  paths, the relay handoff, and the guest continuation proof so another
  ambient-turn leak cannot silently reopen this graph hole.

2026-07-21 - Representative Mystery input-causality closure

- Exact-SHA C1 at `9ff36d960` proved the Mystery transaction-coordinate fix:
  revision 64 `ME_PRESENT` admitted and materialized without any unauthorized
  predecessor fault. It then exposed a harness-only causality violation. The
  one-process driver injected the guest's `ME_PICK` immediately after starting
  `CoopReplayMePhase`, while the real `MYSTERY_ENCOUNTER` handler was still in
  its deliberate one-second input-blocked presentation window. Consequently no
  `controlInstalled` proof existed and the production log correctly refused to
  retain the later terminal.
- The context-safe split remains necessary because arming its async outcome race
  under the host's process globals corrupts the two-engine fixture. It can no
  longer bypass human timing, however: every guest-owned Mystery path first
  waits for the exact active actionable handler, and the split itself crosses
  `isCoopV2InteractionHumanInputFrozen`, the same projector/ledger gate used by
  a physical input, before it may construct an owner intent or send a packet.
  A source contract inventories all three split call sites and pins this order.
- The two host-owned C3 failures had the symmetric cause: the shared encounter
  utility deliberately unblocked and called its handler directly before the
  real presentation delay. Both the battle and non-battle owner paths now open
  and await the exact public handler, then cross the same V2 physical-input
  projector before invoking that context-preserving helper. AuthorityLog may
  retain a successor while a slower replica is still proving presentation, but
  the local owner can no longer consume a control that its own ledger never
  installed.
- That stronger oracle immediately found the corresponding production wiring
  omission: `MysteryEncounterPhase` did not carry the operation ID returned by
  its committed `ME_PRESENT`. Authority-local projection therefore had no
  address-exact phase token to install when a real host keypress retried it;
  only direct handler tests appeared to work. The live phase now binds that
  immutable address before exposing its selector. A source contract fixes the
  required commit -> bind -> public-handler order.

2026-07-21 - Same-generation Mystery dialogue input lease

- The public failure screen is a generic fail-closed terminal and deliberately
  omits its internal reason, but the V2 surface inventory exposed a concrete
  production-only input freeze hidden by direct-handler tests. A selected
  Mystery option moves its still-live `MysteryEncounterPhase` from
  `MYSTERY_ENCOUNTER` to `MESSAGE`; a quiz answer similarly moves its still-live
  `ErQuizPhase` from `ER_QUIZ` to a `MESSAGE` verdict. Both transitions preserve
  the exact authoritative operation and phase generation, yet their proof
  contracts rejected `MESSAGE`, so a real keypress could never install the new
  handler token and remained correctly-but-permanently frozen.
- `ME_PRESENT` and `QUIZ_ANSWER` now admit `MESSAGE` only for their already
  registered exact phase classes. The control ledger still requires the same
  phase token for a handler rebind and the physical input gate still requires
  the exact newly installed handler token, operation ID, owner seat, and active
  actionable handler. No cross-phase or address inheritance was added.
 - The Authority source contract now pins both real mode transitions and the
  ledger's same-generation/exact-handler invariants so direct helper coverage
  cannot mask this public-input path again.

2026-07-21 - Public post-turn liveness budget correction

- Exact-SHA public run 29792007134 did not expose a V2 desync or shared
  terminal. At the apparent failure, both browsers were replaying the same wave
  1 turn and the host was still appending unique authoritative events. The old
  six-minute total-time ceiling fired at 01:34:28; event sequences 19 and 20
  arrived afterward, both replicas received them, and `TURN_COMMIT` admitted
  and applied at 01:34:59. The failure screenshots were therefore transient
  host/renderer positions inside one ordered stream.
- The 90-second no-progress watchdog remains unchanged and is still refreshed
  only by new phases, authoritative sequence numbers, renderer sequence
  numbers, or unique semantic surfaces. Repeated semantic projections,
  heartbeats, and transport retries still buy no time. The independent
  absolute circuit breaker is now fifteen minutes so a severely CPU-dilated
  but causally advancing turn is not misreported as a production softlock; the
  workflow keeps its separate 35-minute supervisor.
- The source-pure budget contract now proves that real authority and renderer
  progress can cross the former short wall-clock boundary while remaining
  bounded by the separate absolute ceiling.

2026-07-21 - Stormglass gate migration to a real V2 surface

- Gate 29792022305 B7 did not find a product Stormglass failure. Its test built
  a complete actionable V2 command frontier and then started a detached
  `ErStormglassPickerPhase`; the ledger correctly rejected the impossible
  `COMMAND_FRONTIER -> STORMGLASS_PRESENT` edge, so no options were exposed.
- The test now makes Stormglass the real current phase before pairing, matching
  EncounterPhase's production insertion point. `buildDuo` therefore does not
  install an unrelated command control, the authority presentation is the
  first retained interaction boundary, and the replica receives its picker
  through the ordinary V2 projector. The test no longer constructs or starts a
  second detached guest picker after the retained result.
- This is the migration rule for the remaining broad-gate fanout: establish a
  real phase/predecessor boundary in the two-engine rig; never relax
  `controlAllowsSuccessorEntry` or silently bless a legacy direct-handler call.

2026-07-21 - Public boundary guard follows liveness semantics

- The first `b16133de0` browser job stopped before building because its
  source-string boundary guard required the deleted
  `POST_TURN_HARD_CEILING_MS = 360_000` spelling. It therefore provided no
  browser verdict and was a pure guard-maintenance red.
- The guard now independently pins the 90-second causal-stall allowance, the
  15-minute absolute circuit breaker, and the budget's use of that breaker. It
  can no longer demand the exact false-abort implementation that the regression
  contract deliberately replaced.

2026-07-21 - Mystery terminal primitive follows the transaction coordinate

- Gate 29792022305 A's sole red was stale test input, not a failed settlement:
  the terminal-cursor test still authored `ME_TERMINAL` at ambient battle turn
  3. The production primitive correctly rejected it because every Mystery
  presentation, pick, settlement, and final leave now occupies the exported
  turn-zero transaction coordinate.
- The test now uses `COOP_ME_AUTHORITY_TURN` for both terminal entries while its
  embedded authoritative battle state deliberately retains battle turn 3. This
  preserves the important distinction between mechanical log address and
  immutable destination payload.

2026-07-21 - Stormglass test preserves the real Authority V2 input surface

- Exact-SHA gate 29794324283 proved that the phase-driven Stormglass migration
  reached its real V2 presentation, but the test then replaced `ui.setMode` with
  a capture-only stub. That left no active OPTION_SELECT handler, so the
  address-exact control ledger correctly refused the decision successor and the
  shared session failed closed.
- The test now delegates through the production `setMode` while observing its
  options. The commit must therefore earn the same real phase, UI mode, active
  handler, and actionable-input proof required in a browser.

2026-07-21 - Mystery terminal state no longer collapses onto its transaction address

- Exact gate 29794324283 reached a real guest-owned no-battle Mystery pick, then
  failed closed with `Mystery no-battle reward settlement could not be
  retained`. The terminal operation is addressed at the Mystery transaction
  coordinate (wave N / turn 0), while its immutable post-effect state correctly
  retained the live battle turn. The generic operation context discarded that
  supplied state because its turn did not equal the operation address; the V2
  wrapper then rejected the resulting envelope because its common state no
  longer matched the typed terminal outcome.
- Mystery terminal construction now preserves a complete supplied state at its
  own coordinate while leaving the operation address at turn 0. V2 admission
  and replica application recognize only this registered ME_TERMINAL exception;
  every other interaction still requires state and operation addresses to
  match exactly.
- The terminal's typed successor wait is installed at the resulting state
  coordinate rather than turn 0, so a same-wave reward or later control entry
  can legally succeed it. A focused contract proves the entry stays addressed
  at wave 12 / turn 0, retains state wave 12 / turn 3, and authorizes the next
  ordered boundary at wave 12 / turn 3.

2026-07-21 - Guest-owned Mystery gets an address-exact authority ingress lease

- Exact gate run 29795779477 proved the state-coordinate correction worked:
  the guest-owned `ME_PRESENT` admitted/applied and the host executed the
  relayed pick. The next `ME_TERMINAL` then failed at
  `authority-local successor reservation refused`. The host had accepted a
  guest proposal while its global control ledger still had no installed
  predecessor: the guest owned the public picker, while the host's real
  actionable surface was an unmodelled relay waiter.
- Added a distinct authority proposal-wait proof to the one global V2 control
  ledger. It binds the immutable opening operation, derived relay sequence,
  closed accepted-kind set, and one opaque live waiter generation. It grants no
  local human input. Timeout/cancel/supersession revokes only that exact token;
  a consumed proposal preserves the proof until the next ordered entry
  atomically consumes it.
- The host's top-level Mystery wait now carries the phase-owned `ME_PRESENT`
  control address into the relay. Buffered early proposals and live network
  waits cross the same projector; the existing authority commit seam continues
  to validate the proposal's owner, pinned counter, step, sequence, option, and
  operation construction.
- The authority's cosmetic Mystery phase can no longer overwrite this stronger
  ingress proof with a watcher UI token. No wire/schema change was required:
  the ingress address is local authority state derived from the already
  authenticated immutable entry, preserving the frozen P33 transport schema.
- Local static evidence: public source contract 29/29 green, scoped formatting
  clean, `git diff --check` clean, and full TypeScript reports zero diagnostics
  in touched files (repository baseline remains non-zero). Co-op Vitest and
  browser execution remain remote-only.
- TODO: push the checkpoint, run the focused Authority V2 node contract plus
  C1/P1 Mystery shards remotely, inspect causal artifacts, then rerun the exact
  production/public journeys. Extend the same proposal-ingress descriptor to
  every other remote-owned registered interaction before treating six-seat
  ownership as complete.

2026-07-21 - Retried reward and market proposals are identity-idempotent

- A fresh architecture audit found that the guest proposal lease retained an
  exact operation ID locally but retried only raw `seq/kind/choice/data`.
  Because shops reuse one sequence for multiple actions, a retry buffered after
  action N could be consumed under the host's newly advanced ordinal N+1 and
  execute the same purchase, reroll, lock, transfer, or check twice.
- The frozen interaction carrier now transports the already-retained proposal
  ID through its existing optional exact-ID slot; no transport union or
  protocol-version change was made. A session-scoped, bounded authority
  admission ledger records one immutable fingerprint per ID. Same-ID/same-
  fingerprint retries are dropped before the FIFO, conflicting reuse fails the
  shared session, and capacity exhaustion fails closed rather than evicting
  exactly-once history.
- The reward/market authority adapter independently requires that identity to
  equal the exact operation ID derived for the current surface ordinal.
  Therefore a retry that survives a relay recreation still cannot become the
  next action. Reward actions, market purchases, and market leave now all carry
  and retain the same ID; V2 market buys also gained the proposal lease they
  previously lacked.
- Added a pure admission-ledger contract and a production-relay regression that
  sends repeated action-N proposals while result delivery is delayed, opens
  the same-sequence action-N+1 waiter, proves it remains parked, then admits a
  byte-identical real action only under the next operation ID. Conflicting
  material for one ID is also proven fail-closed.
- Local permitted evidence: public source contract 30/30 green, scoped Biome
  clean, ownership guard green, `git diff --check` clean, and zero TypeScript
  diagnostics in touched files (repository baseline remains non-zero). The
  Vitest regression is intentionally reserved for GitHub-hosted co-op shards.

2026-07-21 - Stable proposal identity is mandatory across the V2 interaction registry

- The reward/market exactly-once fix was still surface-local. Ability pickers,
  learn-move and batch learn, catch-full, Revival Blessing, Colosseum, biome and
  Crossroads, Mystery picks/sub-picks, and quiz answers could retain a retry but
  omit its operation ID from the raw guest-to-authority carrier. A delayed retry
  could therefore enter a later same-sequence waiter as a second human action.
- `CoopInteractionRelay` now rejects every unidentified V2 guest decision before
  send and again before authority FIFO admission. The only explicit exceptions
  are faint replacement, which has a separate typed proposal protocol, and the
  non-retrying Mystery presentation button pump, which remains a named V2
  compatibility debt rather than an accidental exception.
- Every retrying guest-owned production surface above now sends the exact result
  operation ID derived from its immutable presentation or deterministic surface
  address. Host adoption additionally compares the carrier ID with its expected
  address before mutation for reward/market, biome/Crossroads, Mystery,
  Colosseum, ability, learn-move, batch learn, catch-full, and revival decisions.
  Timeouts or unidentified fallbacks no longer become locally invented V2
  results on those surfaces.
- Added relay regressions proving a missing ID fails locally without sending and
  a forged raw frame fails at authority before it can resolve or buffer into a
  waiter. Expanded the public source contract so future interaction surfaces
  cannot silently remove the send/receive guards or the exact Mystery/biome
  checks.
- Local permitted evidence: public Authority V2 contract 30/30 green, scoped
  Biome clean, `git diff --check` clean, and zero TypeScript diagnostics in all
  touched files. Full TypeScript remains at the unrelated 222-error repository
  baseline. Co-op Vitest/browser evidence remains remote-only.
- TODO: push this isolated checkpoint, run the exact-SHA remote gate, then
  continue with recovery reconstruction for wave-owned controls and the
  multi-target command-frontier fence.

2026-07-21 - Resume discovery waits for the complete authenticated status response

- The compact two-browser artifact from run 29798984367 proved that the fresh
  run reached wave 2 and both clients had persisted the same co-op checkpoint.
  On cold reopen, the host received slot 0 with HTTP 200 and the run-status
  endpoint returned the exact active run, revision, and digest.
- The persistence wrapper nevertheless expired at five seconds while the
  CPU-starved browser was still consuming and validating that successful
  response body. The active status became a synthetic transient failure, the
  marker and scan both appeared unavailable, and the next public Space press
  selected start-new. This was a production timeout inversion, not a battle
  desync and not a missing save.
- The complete persistence request budget is now 15 seconds. The trace measured
  about 8.3 seconds from request to validated status view, so the new value keeps
  a bounded fail-closed path while covering observed response-body latency.
  The resume source contract rejects any future regression below that floor.
- Local permitted evidence: the resume source contract is green. Co-op Vitest
 and the exact two-browser replay remain remote-only.

2026-07-21 - Recovery reconstructs wave-owned control and command frontiers

- The current audit correctly identified two correlated-recovery holes. A
  recovered WAVE_ADVANCE or TERMINAL_COMMIT adopted its control ledger entry
  without rebuilding the runtime-owned wave transaction, so wave/terminal
  projection could never prove its immutable material. Aggregate local command
  frontiers also required every CommandPhase to start while the recovery fence
  deliberately allowed only the first phase, creating a control-proof cycle.
- Recovery now rebuilds the exact wave transaction from the retained final V2
  entry after the full snapshot applies. It marks only the already-covered data
  stages and never replays BattleEnd or consults the ambient legacy wave latch.
  Terminal recovery requires that transaction and queues the exact GameOver or
  final-boss terminal phase.
- Multi-target command recovery constructs every local phase from the immutable
  frontier under one runtime-owned bootstrap. The whole ordered target list must
  match and the first real CommandPhase must cross the ordinary address-exact
  proof edge before the aggregate controller can release recovery. Ordinary live
  delivery retains the stronger all-target proof.
- Local permitted evidence: public source contracts 33/33 green before the
  replacement-ordering addition, scoped Biome clean, `git diff --check` clean,
  and zero TypeScript diagnostics in touched files against the unrelated
  222-error repository baseline. Co-op engine/browser execution remains remote.

2026-07-21 - Replacement material is applied before the next command frontier

- Two-browser journey 29800890533 exposed a real wave-1 production divergence,
  not a driver miss. After a host-owned faint and replacement, one browser still
  rendered an empty allied slot and full-health enemies while the authority
  rendered the replacement and post-turn enemy HP. The later
  `turn-2-first-move` owner timeout only detected that earlier divergence.
- The trace showed REPLACEMENT_COMMIT revision 3 admitted with its complete
  checkpoint, then remaining forever `materialDeferred`. Releasing the settled
  turn ran replica TurnInit, whose CommandPhase precedes TurnStart/replay. That
  CommandPhase correctly fenced on unapplied V2 material and blocked the only
  replay phase capable of applying it: a closed queue dependency.
- Under V2 replacement cutover, TurnInit now probes only the exact current/N+1
  retained replacement address. It resets local input ephemera and routes that
  carrier through the real replay/apply/checksum/presentation transaction before
  queuing any command. The transaction itself then opens only the command slot
  named by the committed successor.
- The failure-first host-faint soak now continues the replica through its next
  real CommandPhase and compares the complete four-slot field across both
  engines. The old test stopped at the authority's CommandPhase and therefore
  could never observe the replica's stale field, which is exactly why the soak
  previously reported green while the public journey failed.
- Local permitted evidence: public source contracts 34/34 green, scoped Biome
  clean, `git diff --check` clean, and zero TypeScript diagnostics in production
  files against the unrelated 222-error repository baseline. The expanded
  two-engine soak and public-browser reproduction are reserved for the exact-SHA
 remote gates.

2026-07-21 - Node fixtures obey the closed Authority V2 successor graph

- Full gate 29802833582 reached the fast node-pure Authority V2 contracts and
  exposed seven stale fixtures, while all 177 public source/evidence contracts
  passed. The failures were test-model debt rather than permission to weaken the
  production log: fixtures still committed unrelated or repeated operations
  after controls that did not authorize them.
- The first remote correction showed a second, important distinction: the old
  adapter-shaped material entries are not live `OPERATION_ENVELOPE_V1` entries,
  so they cannot legally be chained through any V2 successor control. Mystery
  subsumption now tests an explicit retained-material frontier, while ordinary
  log-order retirement remains covered by the live envelope suites. The
  timer-leak checks commit and retire one independently valid adapter entry.
- Interaction parity now uses independent mechanical logs for its matching and
  divergent statements; conflicting or later direct-adapter entries cannot be
  smuggled past the predecessor graph. Stormglass teardown likewise retires one
  valid entry. Wave waits still bind the real predecessor operation ID and
  transition turn.
- Local permitted evidence: scoped Biome clean, `git diff --check` clean, and
  zero TypeScript diagnostics in the four touched fixture files against the
  unrelated 222-error repository baseline. All co-op Vitest execution remains
  reserved for GitHub-hosted runners.

2026-07-21 - Shared-process Mystery proposals preserve exact V2 identity

- Exhaustive gate 29803881361 showed the representative Mystery soak ending at
  wave 12 because the guest was deliberately failed closed for a proposal with
  no immutable operation ID. This was a harness defect, not a production
  Mystery handler defect: `relayGuestMeOptionIndexOnly` minted the retained
  ME_PICK ID but omitted it from both its initial packet and retry closure.
- The context-split helper now mirrors the production handler's `let`-bound
  resend pattern and carries the exact ID on every send. Its source contract
  explicitly rejects anonymous first sends and retries, preventing strict V2
  proposal admission from being misdiagnosed as a gameplay regression again.
- Local permitted evidence: all 32 Authority V2 public source contracts pass,
  scoped Biome is clean apart from pre-existing informational complexity notes,
  and `git diff --check` is clean. Engine and soak execution remains remote-only.

2026-07-21 - Authority V2 retires the dead raw Mystery button carrier

- Fresh tracing corrected the prior audit hypothesis: ordinary `meBtn` frames are
  not an Authority V2 control and have no consumer. Exact `ME_PICK` / `ME_SUB`
  proposals own decisions, the sole host engine advances its own dialogue, and
  the immutable `ME_TERMINAL` owns closure. Guest-origin `meBtn` traffic was only
  accumulating in the unused 8M choice FIFO; retrying it would enlarge legacy
  authority rather than close it.
- `CoopInteractionRelay` now suppresses `meBtn` at every V2 sender and rejects a
  stale/mixed peer's raw frame before any waiter/admission/FIFO seam. The legacy
  rollback path remains byte-identical when the V2 interaction cutover is off.
  A failure-first relay regression proves both local suppression and forged-frame
  rejection; the public Authority V2 contract pins both guards.
- The public-driver boundary no longer hard-codes the obsolete 90-second source
  literal. It requires the named bounded progress budget, while the executable
  node contract owns the measured 95-second Explosion gap and independent
  15-minute circuit breaker. This lets behavior corrections reach Chromium
  instead of failing on implementation spelling.
- Local permitted evidence: public boundary green; Authority V2 plus progress
  contracts 63/63 green; scoped Biome has no errors (only existing warnings/info);
  `git diff --check` green. Co-op Vitest and browser execution remain remote-only.
- TODO: push the exact checkpoint, inspect the remote relay/static and public
  two-browser runs, then triage the live biome/market retained-control gap from
  gate 29803881361 without relaxing the six-lane focused planner.

2026-07-21 - Wave DATA installs its ordered successor before presentation N+1

- Full-gate P2 evidence at both `1076908f8` and `9cb288e37` proved a real
  Authority V2 cycle at the wave-10 market boundary. Replica revision N applied
  its complete WAVE_ADVANCE image, but its `AWAIT_SUCCESSOR` remained at
  `controlInstalled=false`; SHOP_PRESENT revision N+1 was therefore admitted as
  a gap. The only retry edge lived behind `BiomeShopPhase` watcher actionability,
  which itself depended on N+1 materializing.
- The safe BattleEnd DATA edge now immediately paces the already-admitted entry
  through the ordinary replica ledger. The ledger chooses the durable resume
  stage, installs the non-UI `AWAIT_SUCCESSOR`, and only then can the queued
  market/reward/Mystery presentation commit. No revision is skipped and DATA is
  never applied outside the ordered pipeline.
- The two-engine biome test now asserts that `continuationReady` belongs to the
  ordered wait before any market presentation exists. An inactive legacy watcher
  is proven unable to replace or recreate that completed boundary. A fast public
  source contract pins apply-before-retry ordering.
- Exact-SHA gate 29807248279 also separated remaining work: P1 still has two
  Mystery-chain stalls; B1 contains stale legacy exploration probes plus a real
  double-KO replacement stall; C5 exposed one wave-3 field mismatch; the native
  browser lane failed before gameplay because its sealed page bridge never
  became ready. Those are independent follow-up tracks, not reasons to weaken
  this ordered wait.
- Local permitted evidence: Authority V2 contract 32/32 green; scoped Biome has
  no errors; `git diff --check` green; zero TypeScript diagnostics mention the
  touched files against the unchanged 584-line repository baseline. Co-op Vitest
  and all browser execution remain remote-only.

2026-07-21 - Mystery public input cannot outrun its V2 control proof

- P1 artifact tracing found the guest visibly entered the immutable
  `ME_PRESENT` selector, chose an option, and received later `ME_TERMINAL` and
  `REWARD_PRESENT` commits while the presentation entry still reported
  `controlInstalled=false`. The sole readiness edge was a Promise continuation
  after `setModeBoundedWhen`; a synchronous public input could therefore outrun
  the proof and strand every later revision as a gap.
- `CoopReplayMePhase` now attempts the exact readiness proof in the same call
  stack that opens the handler, while retaining its settled retry for genuinely
  asynchronous UI installation. The notifier itself remains fail-closed on the
  exact phase, operation ID, mode, handler, and actionability, so the eager edge
  cannot fabricate control.
- The source contract now proves construction still cannot recursively attest,
  the immediate proof occurs only after opening begins, and the asynchronous
  retry remains wired. Local permitted evidence: Authority V2 contract 32/32
 green, scoped Biome has no errors (existing warnings/info only), and
 `git diff --check` is green. The failure-first P1 engine reproduction remains
 remote-only.

2026-07-21 - Same-turn multi-faints become an ordered V2 replacement chain

- The supplied branch audit was 58 integration commits stale. Its proposal
  retry, broad wave-control, wave recovery, and multi-command recovery findings
  are closed on the current line. The remaining exact-shape failure in full-gate
  B1 was different: a TURN_COMMIT exposed one executable REPLACEMENT head, while
  the host deferred authority until every same-turn summon completed and then
  sorted the whole staged batch. If the active picker was not the first sorted
  item, the log correctly rejected the earlier result as unauthorized; the
  second picker could never receive a committed predecessor.
- REPLACEMENT control now carries one executable head plus an immutable ordered
  tail. Each completed summon commits its own complete post-summon image. That
  entry installs the next head; only the final entry installs COMMAND_FRONTIER
  or an explicit terminal wait. The guest applies and acknowledges intermediate
  carriers without deriving or demanding a premature command. Full-V2
  `no-pending` capture now fails closed instead of reviving a legacy checkpoint.
- V2 successor metadata rides beside the compatibility checkpoint only for the
  local renderer. ACK/finalization canonicalization strips it, preventing a
  valid material proof from conflicting with the immutable carrier admitted on
  the wire. Deferred picker matching uses the executable head identity rather
  than the changing tail-bearing control ID.
- The two-engine harness now tags every party member with both textual and
  numeric alternating ownership. Its double-KO driver remains armed until the
  first committed replacement actually opens the second seat's public PARTY
  handler, so it no longer pre-injects an answer before V2 control exists.
- Local permitted evidence: public Authority V2 source contract 32/32 green,
  scoped Biome has no errors (repository-baseline warnings/info only), and full
  TypeScript output contains no touched co-op path. Exact-SHA remote node,
  two-engine, and public-browser qualification is required after push.

2026-07-21 - Raw legacy turn carriers cannot race Authority V2 application

- Exact-SHA full gate 29810940065 reproduced the same-turn double-faint stall after the ordered replacement
  chain landed. The host committed TURN_COMMIT revision 2 with guest then host replacement controls and
  subsequently committed both replacements. The guest nevertheless parked in replay/finalization while the
  V2 projector waited for the first replacement surface.
- Host/guest logs identified a mixed-authority race: the unretained raw `turnResolution` compatibility copy
  arrived first and entered the ordinary mechanical inbox without the global V2 revision or typed successor.
  Finalization therefore derived and queued a local command path. When the retained TURN_COMMIT arrived, its
  identical material image could not retroactively attach the ordered replacement successor to the already
  consumed carrier; later revisions remained gaps.
- Under negotiated turn cutover, transport-origin raw `turnResolution` frames are now ignored mechanically.
  Only `ingestAuthoritativeV2Turn()` may reconstruct and admit the complete carrier with its global revision
  and typed successor. The host also terminalizes if a V2 turn commit is refused; per-turn legacy fallback is
  forbidden because it would let network timing choose the progression authority.
- Added failure-first coverage proving the raw copy cannot settle `awaitTurn`, while the matching V2 entry
  settles it with the exact REPLACEMENT control and revision. A public source contract pins both guest
  suppression and fail-closed host behavior.
- Local permitted evidence: public Authority V2 source contracts 33/33 green, scoped Biome has no errors
  (baseline warnings/info only), `git diff --check` clean, and zero TypeScript diagnostics mention touched
  files against the unchanged 584-line repository baseline. Co-op Vitest and browser verification remain
  remote-only.

2026-07-21 - Two-engine replay driver follows the authenticated post-finalize replacement

- Exact-SHA gate B6 after the raw-turn retirement proved that the cosmetic carrier no longer wins: the
  replica ignored it, admitted TURN_COMMIT revision 2, rendered all 13 events, applied the matching state
  image, and released the finalizer through the typed REPLACEMENT successor.
- The remaining reported hang was a harness lifecycle error. Authority V2 intentionally retires the early
  faint-event picker and reconstructs its exact addressed `CoopGuestFaintSwitchPhase` after
  `CoopFinalizeTurnPhase`. Vitest's PhaseInterceptor disables automatic phase starts, but
  `driveGuestReplayTurn` returned immediately after the finalizer. It therefore left the real picker current
  but unstarted; the next synthetic replay driver overwrote it and manufactured a turn-2 replay hang while
  the host auto-picked both replacements.
- The driver now continues through only that authenticated post-finalize replacement phase. All other
  post-finalize surfaces remain caller-owned boundaries. This restores the production ordering instead of
  moving the picker back before the authoritative material fence.
- Local permitted evidence: scoped Biome has no errors (repository-baseline complexity infos only) and
  `git diff --check` is clean. The existing failure-first double-faint engine test remains the remote proof;
  no co-op Vitest was run locally.

2026-07-21 - Replacement fixtures prove the real public PARTY surface before choosing

- Exact-SHA gate 29813767501 showed the post-finalize driver correction was effective: the reconstructed
  guest-owned picker opened, selected the intended bench member, and sent its exact proposal. Revision 2
  nevertheless remained `controlDeferred`, correctly blocking revisions 3-4, because the focused tests'
  `setMode(PARTY)` stubs invoked the callback synchronously and returned without ever installing a PARTY
  handler. That ordering cannot occur from a browser keypress and made the V2 projector reject fake control.
- The double-faint and guest-faint fixtures now call the real `setMode`, wait for its completion, and defer
  the synthetic public choice one additional microtask so the phase's exact actionability proof runs first.
  The replay driver also stops as soon as that authenticated picker shifts instead of draining a later turn
  outside the call's requested scope. Production fail-closed semantics are unchanged; only the non-browser
  fixture now respects the public UI-to-relay ordering.

2026-07-21 - A completed wave transaction remains valid victory-seal evidence

- Exact-SHA gate 29814526120 exposed the real cause hidden behind several downstream `TitlePhase` soak
  errors. The replica admitted and applied WAVE_ADVANCE revision 3, installed its explicit
  `AWAIT_SUCCESSOR`, and therefore correctly moved the transaction from the live projector map into the
  bounded completed-evidence cache. The later `CoopVictorySealPhase` still looked only in the live map,
  declared the already-proven transaction "missing," and terminalized the session before revision 4's
  reward presentation could apply.
- Both BattleEnd's defensive check and the post-victory seal now resolve the exact transaction from the live
  map or its read-only completed cache. Completed evidence cannot replay material or install control; it only
  proves the immutable wave/turn/image that the seal already requires. A fast source contract pins this
  lifecycle so future projector cleanup cannot again invalidate a later engine-owned seal.

2026-07-21 - Post-battle phases retain the active completed V2 wave identity

- Exact-SHA gate 29815079402 proved the victory-seal repair removed the prior fatal and advanced repeated
  reward chains through wave 5. TrainerVictoryPhase then terminalized because the shared retained-continuation
  resolver still enumerated only live V2 wave transactions. Installing AWAIT_SUCCESSOR had already moved the
  exact current transaction into the bounded completed-evidence cache, so the resolver reported candidates=[].
- The resolver now adds only the completed transaction named by activeGuestWaveTransition to its candidate
  set. It never enumerates historical completed waves, preserving strict ambiguity detection while allowing
  TrainerVictory, reward, and biome tails to prove the same immutable current-wave source after projector
  retirement.
- Local permitted evidence: Authority V2 public source contracts 35/35 green, scoped Biome has no errors
 (repository-baseline warnings/info only), and git diff --check is clean. Co-op engine/browser execution
 remains remote-only.

2026-07-21 - Every relay-driven remote interaction requires an exact V2 proposal ingress

- The authority-side proposal proof was previously phase-wired only for Mystery. Other guest-owned
  interaction waiters could consume the same retained proposal carrier without proving that their sequence,
  accepted kind set, and nested reward surface came from the active immutable SHARED_INTERACTION capsule.
- The relay now centrally asks the runtime to resolve every wait. The runtime has an exhaustive derivation
  for ability, biome, crossroads, catch-full, colosseum, learn-move, learn-move-batch, Mystery, revival,
  reward, market, and Stormglass projection plans. Nested Mystery reward waits additionally bind the exact
  reward-surface ordinal and ID.
- A remote-owned V2 control now fails closed before buffering or parking if that exact address cannot be
  derived; it cannot silently fall back to legacy consumption. The global control ledger binds the proof to
  one waiter generation and rejects a changed reward surface under the same token.
- Bargain is deliberately not claimed by this change: it still sends one comprehensive operation outcome,
  not an interaction-choice proposal, and needs a V2-native operation-proposal lease. Embedded Market also
  remains under audit until its nested reward-surface identity is carried at every real phase wait.
- Local permitted evidence: public Authority V2 source contracts 36/36 green before the final fail-closed
  assertion was added, scoped Biome reported only repository-baseline warnings/info after formatting, and
  `git diff --check` was clean. Co-op Vitest and browser verification remain remote-only.

2026-07-21 - Retained V2 delivery cannot re-enter its own material application

- Exact-SHA gate 29815603950 reached wave 12 in the heterogeneous Mystery journey, then revision 65's
  ME_TERMINAL materializer synchronously triggered another retained delivery before the outer application
  recorded materialApplied. The nested attempt completed the revision; the outer attempt then re-applied the
  terminal and treated the already-advanced ledger as `materialRejected`, entering a terminal/redelivery loop.
- The V2 replica now has a per-revision in-flight guard around the complete admission/application attempt.
  Same-revision synchronous delivery is deferred to the existing authority lease instead of entering the
  materializer twice; `finally` releases the guard on success, healthy deferral, rejection, and throws.
- Added a node-pure failure-first test whose live materializer synchronously re-delivers its own frame. It
  proves exactly one material application, no protocol violation, one completed revision, and authority
  retirement. A fast source contract pins the guard independently of the remote Vitest lane.
- Local permitted evidence: public Authority V2 source contracts 37/37 green, scoped Biome has no errors
  (two repository-baseline complexity infos), `git diff --check` is clean, and zero TypeScript diagnostics
  mention the touched files against the unchanged 584-line repository baseline.
2026-07-21: Exact gate run 29817600158 proved the remaining Mystery P1 hang was an actionability-edge wiring bug, not duplicate ME_PRESENT material. CoopReplayMePhase opened MYSTERY_ENCOUNTER while its one-second click-through guard was active; both readiness probes correctly refused controlInstalled, but MysteryEncounterUiHandler.unblockInput() never retried the V2 proof. Wired that false-to-true edge to notifyCoopV2InteractionSurfaceReady and added a source contract. Local allowed authority-v2 contract is 38/38 green; remote P1 requalification still required.
2026-07-21: Completed the Bargain V2 remote-result ingress seam. Guest full-state outcomes now carry a stable non-mechanical proposal ID, are admitted only against the exact active BARGAIN_PRESENT address, deduplicate before any phase waiter, and are committed solely by the host. The guest owner no longer ends into its ambient queue after proposal send; it parks on TheBargainPhase until the exact committed BARGAIN result materially applies. Added exact relay regression and static closure contracts. Local static contract 38/38, Biome has no errors, tsc remains baseline-only (584 lines, zero touched-file diagnostics); remote Vitest/gate required.

2026-07-21 - Repeated Mystery presentations hand off their exact V2 address at the FIFO edge

- Gate 29819650683 proved the one-second actionability fix: revision 7's initial ME_PRESENT now installs and
  the journey reaches its terminal/reward tail. Its repeated-delve case exposed the next real defect:
  revision 8 materially entered the relay while the live CoopReplayMePhase still carried revision 7's
  operation ID, so the fresh public selector could never prove its new address.
- The replay outcome consumer now recovers the immutable operation ID paired with each journal-delivered
  mePresent and binds that ID before rendering the new top-level round or sub-prompt. The runtime projector
  deliberately does not relabel the old handler: doing so could attest the previous round's still-actionable
  selector before the new options render. A journal presentation without its exact address fails closed.
- Local permitted evidence: Authority V2 source contracts 39/39 green, scoped Biome has no errors
  (repository-baseline warnings/info only), git diff check is clean, and TypeScript remains the unchanged
  584-line baseline with zero diagnostics in either touched file. Remote P1/full-gate requalification is next.

2026-07-21 - Nested Mystery reward return and repeated presentation identity are explicit V2 edges

- Exact-SHA gate 29820804036 confirmed the initial Mystery selector is now actionable and the real browser
  WebRTC checkpoint, static gate, fast Authority V2 contracts, and every mutation shard remain green. P1
  then exposed two independent product defects rather than a harness-only red.
- A terminal embedded Mystery reward is authored at wave N / turn 1, while the enclosing ME_TERMINAL is
  intentionally authored at wave N / turn 0. The generic same-turn successor wait rejected that return and
  terminalized both clients. AWAIT_SUCCESSOR can now state an additional exact interaction address including
  surface, operation kind, wave, and turn. Only a validated ordered Mystery reward grants the precise
  `op:me / ME_TERMINAL / N / 0` edge; the ordinary same-turn and cross-wave rules are unchanged.
- The repeated-delve artifact also showed the relay used `seq + JSON presentation` as event identity. One
  retained entry redelivery therefore queued the same operation twice, while two legitimate rounds with
  byte-identical options collided in a single operation-ID slot. Committed outcome materialization now
  deduplicates by immutable operation ID, rejects same-ID/different-material redelivery, and retains a FIFO
  of distinct operation IDs for identical presentation payloads.
- Added node-pure admission/validation/identity tests plus an engine relay regression for duplicate versus
  byte-identical-new presentation events. Local permitted evidence: scoped Biome has no errors (baseline
  warnings/info only), git diff check is clean, Authority V2 source contracts remain 39/39 green, and the
  unchanged 584-line TypeScript baseline contains zero diagnostics in any touched file. Remote P1 and full
  aggregate requalification are required for this checkpoint.

2026-07-21 - The Mystery transition gate observes Authority V2 rather than retired op:global traffic

- Exact-SHA gate 29822824694 proved both prior product defects closed: the one-round and three-round Mystery
  journeys each reached wave 13 with matching battle type, biome, party, enemy image, checksum, and durability
  frontier, with zero fallback remirror and no shared terminal. Their only assertions still expected
  ME_PRESENT/ME_PICK/ME_TERMINAL through legacy `envelope.pendingOperation`, so both reported an empty set
  after the intentional interaction-authority cutover.
- The test now decodes and validates the real `authorityEntry` INTERACTION_COMMIT material for observation,
  fault injection, retransmission counting, terminal payloads, and the embedded guest-owned reward. It also
  asserts that ME_PICK remains proposal telemetry and consumes no mechanical global revision, matching the
  closed V2 design instead of resurrecting a legacy correctness carrier.
- Local permitted evidence: scoped Biome has no errors (one repository-baseline complexity info), git diff
  check is clean, and the unchanged 584-line TypeScript baseline contains zero diagnostics in the touched
  test. Remote P1 requalification is required; no co-op engine test was run locally.

2026-07-21 - Exact Mystery requalification and Showdown replacement-frontier triage

- Exact-SHA full gate 29823424795 requalified P1 green after the test migration. The Mystery transition lane
  now observes the mechanical Authority V2 entries end to end; static/build, all mutation shards, browser
  WebRTC/rejoin, and T1-T4 also remain green. The aggregate remains red on separately classified legacy-test
  migration debt and real P2/C/S defects, so this is not a promotion candidate.
- Showdown S4's guest-faint cases exposed a harness control inversion. The shared replay pump started the exact
  post-finalize `CoopGuestFaintSwitchPhase`, then kept pumping the intentionally open human-input phase until
  declaring it stuck; the caller could not press PARTY until the pump returned. Public-input callers can now
  opt into returning only after that address-exact picker is started. Default engine-fixture auto-pick behavior
  and ordinary replay stall detection remain unchanged.
- Showdown S5 proved a separate production defect. A host-side faint in Showdown published AWAIT_SUCCESSOR
  because replacement discovery required classic co-op per-mon ownership tags on the host party. The later
  post-summon carrier found no active REPLACEMENT head, correctly failed closed, and reset both clients to
  TitlePhase. The canonical mapper now recognizes the explicitly owned enemy field as the human-vs-human
  marker and treats both Showdown parties as side-owned; classic co-op still requires exact per-mon ownership,
  preserving the future multi-seat boundary. A failure-first node contract covers the previously missing
  host-side Showdown replacement.
- Local permitted evidence: Authority V2 public source contracts remain 39/39 green, scoped Biome has no
  formatting errors (repository-baseline warnings/info only), `git diff --check` is clean, and the unchanged
  584-line TypeScript baseline contains zero diagnostics in any touched file. Co-op Vitest/Showdown/browser
  execution remains remote-only.

2026-07-21 - Showdown authority picker proof and enemy-manifest Tera state

- Exact-SHA gate 29824797416 proved the previous Showdown host-faint discovery fix: TURN_COMMIT revision 2
  now states the exact host-side REPLACEMENT address and the guest installs it. The next deterministic abort
  was authority-local: Showdown uses vanilla SwitchPhase because gameMode.isCoop is false, so its visible
  PARTY picker had neither the V2 operation address nor the post-setMode actionability notification. The
  post-summon REPLACEMENT_COMMIT therefore correctly refused to consume an uninstalled predecessor and both
  clients showed the shared synchronization terminal. The vanilla Showdown path now binds that exact address
  and publishes proof only after the real asynchronous PARTY handler opens. The strict reservation is unchanged.
- C5 artifacts exposed a separate pre-command state overwrite. The guest first applied the authority's exact
  command-open image, then NextEncounterPhase rebuilt the same enemy from enemyPartySync. That manifest omitted
  `isTerastallized` and `teraType`, so construction rolled a local Tera type and overwrote the newer V2 image
  until a later heal happened to repair it. Enemy capture, reconstruction, and same-species adoption now carry
  both Tera fields; the launch round-trip regression assigns deliberately distinct values and checks them exactly.
- The fast source contract now pins Showdown's address-before-open and handler-ready-after-open ordering.
  Local permitted evidence: Authority V2 source contracts 39/39 green, scoped Biome has no errors (repository-
  baseline warnings/info only), `git diff --check` is clean, and the unchanged 584-line TypeScript baseline has
  zero diagnostics in all touched files. Remote S5/C5 and full-matrix requalification are required.

2026-07-21 - V2 biome receipts and production-faithful interactive harness scheduling

- Exact-SHA gate 29825687971 requalified every Showdown shard S1-S8 green, including the previously failing
  S4 double-KO and S5 host-faint routes. C5 also went green, proving the enemy-manifest Tera fields survive the
  real reconstruction path. Browser-native WebRTC/rejoin, static/build, fast contracts, all four mutation
  shards, T1-T4, and P1 remained green. The aggregate is still red on separately classified A/B/C/P debt and
  is not a promotion candidate.
- C1's wave-20 artifact exposed a real V2/legacy ordering seam. The guest validated and materialized the exact
  CROSSROADS_PICK entry, then `adoptBiomeWatcherChoice` required the retired `CoopOperationGuest` ledger to
  also report that V2 operation as applied. V2 deliberately bypasses that legacy revision/dedup clock, so the
  already-authoritative result was rejected until recovery exhausted and the shared session terminalized.
  The address-exact V2 materialization receipt is now the live-consumption permit; the legacy ledger is only a
  duplicate detector after the receipt is released. A fast source contract pins that ordering.
- P2's guest-owned Crossroads failure was a scheduled-harness deadlock: each `drainLoopback` pumps only the
  currently installed browser context. After the guest sent its reciprocal rendezvous arrival, the driver
  waited on guest UI without ever running the host inbox, so the host could not cross the barrier and author
  the required V2 interaction-open entry. The driver now pumps both independent contexts before waiting.
- C3's Mystery soak similarly called `PhaseInterceptor.to("MysteryEncounterPhase")` and awaited completion of
  an intentionally interactive target before it could drive the visible selector. The harness now starts the
  already-reached real phase and returns to the public-input driver, matching two independently running
  browsers; no product timeout or authority fallback was added.
- Local permitted evidence: Authority V2 source contracts 40/40 green, scoped Biome has no errors (repository-
  baseline warnings/info only), `git diff --check` is clean, and the unchanged 584-line TypeScript baseline has
 zero diagnostics in all four touched files. Remote C1/C3/P2 and affected B/A requalification is required.

2026-07-21 - Interactive target arrival and post-biome command scheduling

- Exact-SHA gate 29827146085 proved the first Mystery harness correction was incomplete. At wave 15/24 the
  predecessor synchronously shifted into MysteryEncounterPhase and opened MYSTERY_ENCOUNTER before returning.
  PromptHandler therefore marked PhaseInterceptor interrupted while the requested stop-before target was
  already current; `to(target, false)` checked interruption first and waited forever on the visible selector.
- PhaseInterceptor now recognizes an already-current target before applying the interrupted wait rule for
  stop-before and branch-target calls. Run-target callers retain the existing wait-for-human-input behavior.
  Unit regressions cover both `to(..., false)` and `toFirst(...)` with a synchronously opened target. The soak
  driver also avoids starting MysteryEncounterPhase twice when that real UI is already actionable.
- P2's remaining Crossroads journey reached wave 11 correctly but then asked the single-process driver to skip
  the guest replica's parked host-owned CommandPhase before the host had authored command-open. The revised
  schedule starts that exact replica, proves input remains closed, starts the host authority phase, then crosses
  to and opens the guest-owned phase. This models two concurrently running browsers without bypassing V2.
- Local permitted evidence: scoped Biome reports no errors (repository-baseline warnings/info only) and the
  semantic diff is limited to test infrastructure plus the two affected drivers. Remote C1/C3/P2 qualification
  is required; no co-op Vitest/browser workload was run locally.

2026-07-21 - Public-browser post-replacement command address

- Exact-SHA public journey 29825674638 reached a real wave-1 faint, opened the remote-owned PARTY picker,
  applied the selected replacement, and then entered the shared synchronization terminal at turn 2. The
  authority diagnostic was exact: `command-open predecessor does not authorize CONTROL_COMMIT after
  RC/e1827464803163990/w1/t1/o23/f1/s1`.
- This was a production defect, not a harness timeout. `CoopPushReplacementCheckpointPhase` sealed the
  complete post-summon material before `TurnInitPhase`, so the carrier still said turn N. The replacement
  cutover copied that mutable carrier turn into `COMMAND_FRONTIER`; `TurnInitPhase` then opened the real
  `CommandPhase` at N+1, and the strict V2 predecessor check correctly rejected the mismatched address.
- A replacement's immutable faint source defines this transition. Whether its complete carrier happens to
  be captured before or after `TurnInitPhase`, the final replacement resumes command control at source turn
  N+1. The cutover now derives that address from `source.turn + 1`; it still accepts only carrier N or N+1,
  and all command actors continue to come from the complete post-summon authority image.
- Added a node-pure regression for the exact public failure shape: a turn-N post-summon carrier must commit
  a turn-N+1 command frontier. The existing N+1-carrier case remains unchanged. Local permitted evidence:
  scoped Biome clean, Authority V2 source contracts 40/40 green, `git diff --check` clean, and the unchanged
  584-line TypeScript baseline contains zero diagnostics in either touched file. Remote contract and public
  two-browser requalification are required; no co-op Vitest/browser workload was run locally.

2026-07-21 - PhaseInterceptor invocation-local arrival proof

- Exact-SHA gate 29827973780 still left C1/C3 parked on an already-visible MysteryEncounterPhase with the
  interceptor marked `interrupted`. The previous ordering fix was necessary but still read the mutable
  PromptHandler routing slot (`this.target`) when deciding whether the original `to()` request had arrived.
  A nested/asynchronous request can replace that slot while the first call is unwinding, causing the first
  call to ignore the exact interactive phase it requested and wait until timeout.
- Each `to()` invocation now uses its immutable argument for arrival, diagnostics, and logging; the shared
  slot remains only for PromptHandler routing. A failure-first unit regression models the slot being replaced
  after the target opens and proves the original stop-before call regains control.
- Remote C1/C3 qualification is required. No co-op Vitest/browser workload was run locally.

2026-07-21 - Stop-before timeout-boundary proof and gate wiring

- Exact-SHA C1 replay 29829817225 disproved the first interceptor correction as sufficient. The journey
  repeatedly crossed Mystery screens correctly, but at wave 24 an overlapping asynchronous harness scope
  settled on the exact requested MysteryEncounterPhase/UI in the timer turn that expired `waitUntil`.
- Stop-before arrival now compares the immutable phase name directly and performs one final exact-phase
  observation before classifying a timeout as a softlock. Run-target calls remain fail-closed. Failure
  diagnostics now include the requested run mode and the mutable PromptHandler routing target.
- The PhaseInterceptor unit regression file was not present in any full-gate lane, so neither of the earlier
  regressions actually ran in the aggregate workflow. It is now explicit Lane B inventory and will execute
  isolated on hosted runners. This closes the coverage-wiring defect instead of merely adding another inert
  test file.
- Remote unit/C1/C3 qualification is required. No co-op Vitest/browser workload was run locally.

2026-07-23 - Public-lobby asynchronous prompt ownership

- Exact-SHA two-browser campaign 29962958374 failed both completed co-op profiles before starter select.
  The transport was connected, the P33 binding and fingerprints matched, and all five cloud-slot reads
  completed, but the screenshot remained on `Connected! Checking for a co-op save...`; twelve real Space
  presses produced no `SEND resumeStartNew`.
- The resume scan completed asynchronously while the earlier lobby MessagePhase still owned its timer and
  keyboard callback. The no-save and saved-run branches called `showText` directly, unlike the already-fixed
  conflict branch, so their visible decision could be stale/inert. Both host decision surfaces now await a
  MESSAGE transition, re-check exact-session identity, reset the mode chain, and install their callback with
  zero delay as one atomic UI boundary.
- Failure-first evidence is the real-browser dirty/depth artifact pair from run 29962958374. Local scoped
  Biome and `git diff --check` are clean; repository TypeScript completes with zero diagnostics. No local
  co-op Vitest/browser workload was run. The superseded campaign was cancelled once this shared signature
  was attributed; exact-SHA remote requalification is required.
2026-07-23 - Showdown summon and environment presentation stream completion (unqualified working tree)

- The authoritative renderer already converged mechanically, but its ordered turn stream had no ability-flyout
  event, never emitted its declared weather/terrain events, and opened recording only at TurnStart after lead
  and switch-in presentation could already run. Protocol 44 now carries an immutable Pokemon/ability identity
  plus host-resolved environment animation cues; the guest resolves localized names without executing ability
  mechanics or RNG.
- Showdown's authority opens the recorder at SummonPhase and the recorder preserves a same-turn prefix when
  TurnStart reopens it at the exact same session-epoch/wave scope. Repeated numeric turns across waves or
  sessions replace stale material. Classic co-op's initial summon path is unchanged, preventing duplicate lead flyouts.
  Side swapping remaps the ability battler index while stable Pokemon/ability IDs remain untouched.
- The replay phase follows the ordinary ability-bar hide/requeue discipline, locates an off-field switch-in by
  immutable Pokemon ID before its checkpoint, and is guarded by the shared five-second presentation watchdog.
  Weather/terrain reuse the authority's resolved CommonAnim cue while their mechanical state remains checkpoint-
  owned.
- The dedicated two-real-browser Showdown journey now fails unless the authority visibly enters its ordinary
  ability phase, the renderer visibly enters the new streamed replay phase, and both browsers execute the same
  resolved environment animation over the same weather/terrain state. Silent checkpoint convergence is no longer
  sufficient evidence for this feature.
- Permitted local validation is green: TypeScript reports zero diagnostics in every touched-file filter,
  scoped Biome reports no errors (repository-baseline warnings/info only), and `git diff --check` is clean. Runtime
  TypeScript still has the documented unrelated repository baseline. Co-op/Showdown runtime validation
  remains remote-only and will be dispatched only after the currently frozen resume-prompt browser campaign.
# 2026-07-23 — dirty-account co-op launch: read-only solo classification

- Exact two-browser dirty-account evidence on `a4ce1a3e6` showed all five cloud slot reads and migrations completing, followed by no resume decision while the host remained in `TitlePhase/MESSAGE`.
- Removed the unrelated cloud-solo local-cache write from co-op resume discovery. A full cloud account is now classified from its immutable read result without encryption, local mutation, or waiting behind the account-wide persistence Web Lock; ordinary solo loading still owns cache population.
- Added a failure-first DUO contract that holds the Web Lock forever and proves five cloud-only solo slots still classify, leave local storage untouched, and never request the lock.

# 2026-07-23 — stale-audit closure and exact-SHA qualification

- Rechecked the `a4ce1a3e6` deep audit against current source. Its three P0 mechanisms were genuine on that
  anchor: Mystery battle lacked an exact same-turn command edge, V2 replacement settlement left the precise
  guest proposal retry alive, and recovery claimed `controlInstalled` before the reconstructed handler was
  actionable. All three are now isolated commits with failure-first contracts. Recovery reuses the ordinary
  control proof and keeps revision N pending while N+1 remains a gap.
- The audit also exposed a nested immutability consequence it did not name: AuthorityLog's shallow successor
  clone would deep-freeze caller-owned address arrays after the new Mystery edge. Retention now structured-
  clones the complete successor, with a regression proving caller mutation cannot rewrite or be frozen by it.
- Focused resume-scan journey `29967750608` is green on exact SHA `f96f7840d`; the read-only cloud discovery
  correction is no longer merely source-plausible. Current integrated tip `af55ebe49` is under full sharded
  gate `29969525053`, mutation run `29969439789`, and public journey `29969439764`.
- The automatic focused gate is a known invalid signal for this long-lived integration branch: its original
  narrow-task manifest is 71 files behind the branch's actual integration delta and categorically forbids the
  protocol file that `er-coop-44` must change. Keep the full sharded gate authoritative for this SHA, then
  reroute or version the focused ownership contract instead of waiving real product shards.

# 2026-07-23 - current feat integration and full-gate signal audit

- Merged current `heraklines/feat/elite-redux-port` (`f689fce1e`) into the V2 worktree as `b3d8eb987`, resolving
  fourteen overlap conflicts without restoring legacy progression ownership. The merge preserves V2 ordered
  control/proof, feat's doubles/triples targeting and side swaps, Commander and biome fixes, and shared
  Greater Ability Randomizer choice caching. The obsolete localized-name Showdown ability replay was removed
  in favor of the exact ID/slot presentation stream.
- The merged feat's GIFT ability sources can use slots above 2, so the presentation validator now accepts a
  bounded numeric source slot rather than rejecting mechanically valid shared abilities. Exact folder clearing
  and tournament fixtures were also corrected in `b07408dfd`; touched co-op/Showdown paths have zero TypeScript
  diagnostics and scoped Biome has no errors. The repository still has a separate large feat typecheck baseline.
- Full gate `29969525053` on pre-merge `af55ebe49` is not a release verdict: 21 jobs passed and 111 distinct
  engine tests failed. Two fast Mystery fixtures and one real Showdown stream type defect are corrected locally.
  Most remaining failures are tests that enable mandatory all-V2 authority while still constructing legacy
  relay fixtures or asserting retired carriers. They must be migrated, not waived wholesale; only a mechanism-
  proven harness failure may be classified out of a staging decision.
- Public journey `29969439764` remains active on `af55ebe49`; no branch push is permitted until its shared
  journey slot exits. Focused resume journey `29967750608` already proves the cloud resume/lobby callback chain.

# 2026-07-23 - direct-mirror Showdown harness restores skipped production boundaries

- Thirteen Showdown engine failures shared one setup mechanism. Their host finished Encounter and Summon while
  still solo, then `buildShowdownDuo` installed the pair and restarted CommandPhase. Mandatory presentation
  authority correctly failed because the fixture had neither Encounter's retained wave-start carrier nor
  Summon's open recorder; the guest subsequently waited in `CoopReplayTurnPhase` for material the fixture could
  never publish.
- The direct-mirror adapter now publishes the complete carrier from the already-settled immutable host state,
  opens the exact epoch/wave-scoped recorder, drains delivery, and only then re-enters CommandPhase. It seals an
  intentionally empty presentation prefix because the prior summon events cannot be reconstructed honestly.
  Exact ability/weather/terrain event identity remains owned by the two-real-browser launch journey, which runs
  the real Encounter/Summon chain rather than this abbreviated fixture.
- Permitted local evidence: scoped TypeScript reports no diagnostics for `coop-duo-harness.ts`, Biome has no
  errors (repository-baseline complexity infos only), and `git diff --check` is clean. Runtime proof remains the
  remote Showdown shards after the active public journey releases the no-push freeze.

# 2026-07-23 - interaction terminal proofs are runtime-owned

- Public two-browser journey `29969439764` completed green on exact SHA `af55ebe49`: fresh login, pairing,
  save discovery, shared launch, and resume all crossed only public UI in two isolated Chromium processes.
  This closes the earlier lobby/resume uncertainty and releases the shared-journey no-push freeze.
- The dominant reward/market failures in full-gate B1/B3/B10 were not incomplete state captures. Their exact
  Authority V2 verdict was `authority-local successor reservation refused`: after an async UI transition,
  `SelectModifierPhase` proved settlement through the process-global active runtime instead of the runtime that
  constructed the phase. In the two-engine harness this could settle the replica while the authority attempted
  the commit and correctly refused an unproved result.
- Reward, Bargain, Mystery terminal, and the three ability-picker watcher paths now publish their phase terminal
  through an explicitly captured owning runtime. This matches the already-correct Learn Move, Revival,
  Colosseum, Crossroads, Biome, Catch Full, and Stormglass implementations and removes one ambient authority seam.
- Permitted local evidence: all touched-file TypeScript filters report zero diagnostics, semantic diffs are
  narrow, and `git diff --check` is clean. Remote S shards plus affected B/C/P shards are required before this
  failure cluster is considered closed.

# 2026-07-23 - post-merge public static gate and move-runtime cycle closure

- Exact-SHA public journey `29971204535` did not launch Chromium. Its build job failed in the owned-file
  Biome step with seven `noImportCycles` errors, so it is CI/static evidence rather than a co-op runtime
  regression. All seven reports shared the feat-merge path `field/pokemon -> newcomer signature mechanics ->
  scripted move util -> move -> coop-runtime`.
- The only direct move-to-runtime dependency was the forced-wild-flee wave-resolution notification. It now
  crosses a tiny late-bound bridge installed by `coop-runtime`; the move engine fails loudly in co-op if that
  production bridge is ever absent instead of silently stranding the guest. The existing #838 two-engine
  wild-flee regression continues to own the behavioral boundary on hosted runners.
- The public workflow now typechecks and lints both the bridge and universal move engine explicitly. In a
  clean LF exact-SHA mirror with `CI=true`, the complete 46-file public static slice is zero-error. The three
  touched TypeScript files also have zero diagnostics against the repository's documented unrelated baseline.
- The integration ownership manifest is now version 2 and owns this exact post-`593b6dd2f` correction set;
  no frozen P33 schema file is modified. Full gate `29971229403` on the parent SHA remains red and supplies
  the next runtime/fixture triage corpus; a corrected exact-SHA public journey and gate are still required.

# 2026-07-23 - exact successor whitelists and focused-gate classification

- Parent full gate `29971229403` exposed a node-pure defect in the newly added Mystery battle successor:
  an exact wrong-turn `command-open` missed `allowedControlAddresses` and then fell through to the generic
  N+1 command rule. Exact interaction/control alternatives are now closed whitelists for their entry class,
  so a stated same-turn Mystery command cannot accidentally authorize the generic next-turn command.
- The focused run on `9849815d8` found all six cross-lane representatives and intentionally refused to omit
  one behind its five-shard cap. Root `AGENTS.md` reserves focused branches for 1-5 shards and requires an
  integration-sized cross-lane batch to escalate to the complete gate; the planner red is therefore policy
  evidence, not a product or harness failure. The cap remains unchanged.
- Permitted local evidence is green: repository TypeScript completes with zero diagnostics, scoped Biome
  lint has zero errors, and `git diff --check` is clean. Co-op Vitest/browser proof remains remote-only. Public journey
  `29972091501` on parent `9849815d8` was still active during this batch, so no push occurred while it owned
  the shared browser-journey concurrency slot.
- Lane T3's only parent-gate failure was a fixture false red, not a triple refill defect. The spread attack
  produced the intended two wing KOs and both reserves reported `onField=true`; a randomly generated Stunky's
  ER Aftermath then forced Explosion, creating an unintended third KO with no third reserve. The focused #5c
  setup now pins the enemy passive to inert Ball Fetch, so it measures exactly two simultaneous vacancies.
- Lane S8's three multi-slot Showdown failures shared another fixture boundary: its bootstrap let the first
  host `CommandPhase` run before `buildShowdownDuo` installed mandatory versus authority. Production correctly
  terminalized that orphan command; the test then saw zero host fields or a null battle. The fixture now stops
  before CommandPhase, matching the already-correct Showdown duo/faint/summon harnesses, and lets the paired
  builder install both runtimes before opening input.
