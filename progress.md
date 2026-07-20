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
