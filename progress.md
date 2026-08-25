Original prompt: Build a true two-real-browser public-UI game-over journey that proves the retained terminal race end-to-end using only keyboard/DOM input after boot, with an exact build-time production-call-chain fixture, workflow dispatch, exact evidence, ownership, and remote proof.

- 2026-08-25 Fun Debug modifier: Fun Mode can opt into a progression-free debug run with a 999-point starter budget and a copy-only starter overlay that temporarily exposes every species/form, nature, IV, ability/innate slot, egg move, and shiny tier. Debug runs suppress catches/seen/shiny counters, candy, vouchers, achievements and their rewards, ribbons, unlocks, eggs, run history, ghost uploads, community outcomes, and last-team/preference writes. An immutable full account baseline is used for every system save and restored exactly on return to title, while the debug session itself remains resumable. No local tests were run; targeted Biome and `git diff --check` pass, with GitHub Actions verification pending. Staging and production remain untouched.
- 2026-08-25 Community-editor eligibility repair: the 82-of-164 Redux-only threshold remains exact, but eligibility no longer depends solely on the client's best-effort post-save achievement report. The authenticated endpoint now reads the account's current `achvUnlocks` directly from its system save (including legacy GZ1 rows), filters against the generated Redux-only catalog, and unions those ids with denormalized report rows. Existing qualified accounts become eligible immediately after the Worker update without another game save. Focused parser and Worker-route regressions cover vanilla-id exclusion and the previously broken no-report path. No local tests were run; targeted Biome and `git diff --check` pass. Staging and production remain untouched.

- 2026-08-19 Black-Shiny Shiny-Lab presentation fix: the authored Black atlases intentionally use negative trim offsets so their baked halo can extend beyond the original source box. The CPU Shiny-Lab overlay now preserves that overflow while anchoring against the original source box, preventing the old 16 px battle float and summary offset. Black source animation frames refresh at their native 10 FPS in every battle format while the expensive surface/aura time channel keeps the existing 125/250/500 ms singles/doubles/triples cadence. Effects, atlas frames, animation speed, and the separate triple send-out optimizations remain intact. A focused GitHub Actions run passed all seven pacing/geometry tests; the full repository run passed shards 1/4/5 while the existing oversized shards 2/3 hit their 10-minute limit. Staging and production remain untouched.

- 2026-08-19 Triple/Black-Shiny send-out performance: authored Black Shinies no longer decode the invisible underlying epic/red atlas before their dedicated black front/back atlases; cry and custom-icon loading remain intact. CPU-rendered Shiny Lab surface/aura refreshes keep their existing visual cadence but their six triple-battle slots begin on separate 24 ms frame offsets, preventing simultaneous pixel rendering and canvas texture uploads. The previously unbounded raw source-frame pixel cache is now a 192-frame LRU, preventing long runs with animated six-mon fields from retaining every encountered frame indefinitely. No effects, animation frames, mechanics, AI, or battle presentation were removed. GitHub verification and staging deployment are pending; production remains untouched.

- 2026-08-19 Endless breadth/scaling fix: the shared worker already considered every completed, non-Endless run across every difficulty, but its response was silently capped at 20 teams while deep-Endless danger weighting could favor one team 21:1. Endless now requests a diverse 240-team batch, refreshes every 40 ghost encounters up to a bounded 600-team in-memory pool, never performs the old per-wave fetch, and limits danger preference to 3:1. Exact-team, uploader, and semantic-team cooldowns remain active; only victorious teams with saved held items qualify. The existing independent depth-based enemy-boon curve and Rift pulse/target curve remain intact. Only the old health milestone is replaced: every 15 Normal/7 Sprint Endless waves adds one seed-stable pressure package consisting of one extra enemy boon roll, one randomly distributed health segment, or two additional active Rift slots. Each seed-randomized group of three milestones contains one of every package, slowing health growth without allowing reloads or unlucky health-only streaks; wild and trainer encounters use the same scaling. Boss encounters receive twice the complete enemy-boon budget and twice the mixed milestone's segment budget. Every 50-depth raid slot and reserve is a strongest-form boss selected from the top 20 cost-10+ starter lines (with Primal Cascoon retained and Moltres EX forced to Mega), carries exactly twice the health segments an ordinary wild boss would receive at that wave, a Prime Ward Stone, every applicable resist berry, normal generated items, and a protected real 10+-stack completed-ghost inventory. Ghost snapshots retain normal generated Hell berries, wards, held items, and boss layers before saved inventory is added. Enemy relic modifiers/icons clear at the next encounter boundary. Ordinary Endless Avalanche rolls are serialized per Pokemon and append without rerolling earlier slots; the explicit Avalanche Reroll Rift temporarily rerolls the full added list each battle without overwriting that canonical saved list. GitHub Actions verified the new boss-pool, raid-item, segment-scaling, Avalanche-serialization, and 80-team worker-breadth tests; the aggregate run remains non-green because the repository's existing lint/test baseline exceeds the workflow's 10-minute shard limit. Production remains untouched.

- 2026-08-19 Endless Ability Avalanche performance pass: passive construction now deduplicates through one ID set, Fun Avalanche selection is cached, rotating-Avalanche indexing is O(1), active-source eligibility reuses resolved ability objects, attribute dispatch carries resolved source/Avalanche metadata into rift hooks, and abilities lazily index attrs by trigger type. Turning Display -> Ability Trigger Banners Off now bypasses Show/Hide phase creation entirely in ordinary solo play while co-op/showdown retain their ordered presentation events. Mechanics, Avalanche counts, rift rules, and AI quality are unchanged. Remote GitHub verification is pending; production remains untouched.

- 2026-08-17 Endless staging launch root cause: the authenticated staging log proves the full Hell team and Cascoon are created, then `EncounterPhase` receives `false` from its mandatory pre-presentation `saveAll()` and immediately resets to title. The previous local browser proof used offline persistence and could not expose this. `Endless: final boss auto-KO` now opts into a dev-run-scoped encounter-persistence bypass, cleared whenever title is rebuilt. This preserves the visible wave-200 fight, first-move-triggered self-KO, Endless prompt, and wave-201 continuation without changing persistence for any normal run or other scenario. Remote CI and staging deployment are pending; production remains untouched.

- 2026-08-17 Endless final-boss scenario correction: `Endless: final boss auto-KO` now restores the full six-Pokemon completed-Hell team, enters a visible/playable wave-200 Primal Cascoon battle, and waits until the player commits the first move before a consume-once dev-only callback self-KOs the boss. The browser harness proved the ordered journey: living boss command screen -> Fight -> move accepted -> boss faint -> Endless offer -> opening Rift -> playable wave 201. Production boss behavior is untouched; staging deployment remains pending.

- 2026-08-17 reward economy/UI work in `codex/reward-rate-panel-20260817`: centralized integer depth tables for Shiny/Candy/Voucher across Normal/Sprint/Favour/Endless, batched trainer voucher payout, persisted Hell Training Cache, and a fixed-size three-row panel under Luck with per-row breakdown tooltips, WebGL aura, reduced-motion behavior, and Canvas fallback. Local test execution remains forbidden; remote GitHub Actions and headless visual verification are pending. Production remains untouched.

- 2026-08-17 Endless dev routing follow-up: dev scenarios now reset leaked Normal/Sprint pacing, and `Endless: final boss auto-KO` additionally pins Normal pacing before creating its wave-200 finale. Previously, entering this scenario after any Sprint run made wave 200 fail `isWaveFinal`, so the ordinary game-over router skipped `EndlessOfferPhase` and cleaned the run back to title. Real run selection and saved-run pacing are unchanged. Remote Tests run `31986138337` passed all five execution shards, including `er-run-pacing` 12/12 and `endless-dev-scenarios` 4/4; the final aggregate report still reproduces the shared branch's unrelated baseline failures.

- 2026-08-17 Endless dev launch follow-up: the final-boss handoff no longer aborts run creation when its legacy completed-Hell fixture cannot reconstruct every old generated held-item subtype. It restores every resolvable saved item/relic, records the exact restored/expected count as a dev warning, and continues into the wave-200 fight. The generic one-shot dev party-setup seam is also guarded and consumed even on failure, preventing any dev fixture callback from ejecting the player back to title. Production encounter and boss behavior are unchanged. Remote Tests run `31983465143` executed all five shards successfully; its final report merge remains red only on the repository's unrelated pre-existing move-data expectations, TM compatibility exception, and empty source-audit files.

- 2026-08-17 Endless dev handoff correction: the visible Dev Scenarios picker now contains only Scenario Builder, Custom Trainers, and `Endless: final boss auto-KO`. That final scenario materializes the sanitized six-mon completed-Hell snapshot as the PLAYER party, including recorded forms/moves/IVs/natures/ability slots/passives/shiny data, all resolvable saved held-item entries, Blood Pact, and Second Wind. Its lethal call remains a consume-once `onBattleStart` callback guarded by `currentBattle.isClassicFinalBoss`; no production boss path contains the auto-KO. The historical scenario catalog remains available only to focused automated repro tooling and is no longer registered in the staff picker. No staging or production deployment.

- 2026-08-14 Sprint/Fun Ability reroll fixes: Sprint's first choose-two reward pool now excludes every party-target item as well as explicit nested continuation rewards, including after rerolls, so the first selection always resolves in-place and preserves the second pick. The initial Fun Ability review now moves focus from REROLL ALL to START after reroll, so the next confirm launches the run. Verification: real-handler ability callback 1/1, public Sprint reroll -> first pick -> second pick journey 1/1, Upgraded Map rearm 1/1, real render harness with inspected START-selected PNG 1/1, `git diff --check`, and the no-telemetry standalone Cloudflare payload build pass. No staging or production deployment.

- 2026-08-13 local regression fixes: Challenge mode now shares Classic's Normal/Sprint selector and all Sprint mechanics gates; Sprint rerolls retain the five-option/two-free-pick state; Fun Mega stones can be moved through player item management without becoming battle-stealable, arrive inactive, and deactivation restores base evolution eligibility. Verification: Sprint pacing 11/11, Fun Mega lifecycle/transfer 4/4, reward phase 11/11 implemented tests (2 existing TODOs), `git diff --check`, and the production Vite build pass. No staging or production deployment.

- 2026-08-13 Fun Mode selection follow-up: fresh Fun Mode configuration now starts with every modifier OFF. `ACTION`/Space continues to rotate or toggle the highlighted rule; `SUBMIT`/Enter moves focus directly to literal START and only confirms when START is already focused, including when a saved setup exists. Saved configurations remain opt-in through Last Setup. Verification: 28/28 Fun Mode logic tests, 4/4 real handler input tests, visual render harness inspection for OFF defaults and START focus, and the standalone Cloudflare payload build all pass. Do not deploy to staging yet.

- 2026-08-13 Sprint staging work: Classic now offers Normal/Sprint after difficulty on dev/staging. Sprint keeps real save/RNG waves 1-100, doubles progression/EXP/friendship/egg cadence, uses five-wave checkpoints and markets, a single five-option choose-two reward screen, compressed fixed battles/gyms/ghosts, progression-depth ghost eligibility, chapter-aligned biomes, fractional vouchers, and persisted pacing. Challenge-specific heal replacement still applies at Sprint checkpoints. Production remains untouched; the focused pacing suite passes 10/10 and the staging-mode standalone/Cloudflare payload build passes. Repository-wide typecheck remains blocked by existing unrelated ER archetype and test typing errors; no reported error points to a Sprint-touched file. Staging deployment is pending.

- 2026-08-11 Moody banner refinement in `codex/fun-mega-mode-20260809`: removed the redundant TRAINER BOON/CURSE label, switched the reused ability bar to a true violet tint fill, vertically centered the single effect name, preserved the full untrimmed enemy trainer frame, and aligned its upper-half cut edge with the banner. Browser verification is complete; production and normal staging remain untouched.

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
- Focused planning had a separate structural noise source: the required declarative ownership JSON matched
  the generic `.github` infrastructure rule, so every otherwise narrow task update manufactured a six-lane
  impact and tripped the five-shard cap. Ownership metadata is now excluded from runtime impact only; actual
  workflows/actions still select all lanes. A node-pure contract proves this batch's product paths resolve to
  A/B/P/S/T while a workflow edit continues to require A/B/C/P/S/T.
# 2026-07-23 - exact Showdown versus wave-start orientation

- Exact full-gate S8 evidence on `ff838fee8` showed the direct-mirror versus guest booting with its own
  team on both sides (`host=[Munchlax,Blastoise]/[Snorlax,Lapras]`, guest egress
  `[Snorlax,Lapras]/[Snorlax,Lapras]`). The retained ordinary `enemyPartySync` fallback applied the host's
  ENEMY manifest to the versus guest's LOCAL ENEMY side after the complete side-swapped launch snapshot.
- `CommandPhase.tryCoopCheckpointSync()` now consumes that retained carrier for ordering but preserves the
  complete Showdown launch parties/encounter. The carrier's complete authoritative state still applies via
  the existing side-swap adapter before input opens.
- The same exact rerun disproved the first T3 classification: the pinned passive removed the random
  Aftermath path, but Earthquake still KO'd all three generated foes. The #5c fixture now gives the centre
  foe an explicit high HP reserve so it deterministically owns exactly two vacancies and two reserves.
- No local Showdown/triples/co-op Vitest run (repository policy). Static/ownership checks only; remote S8/T3
  requalification required after the active public journey releases the branch push lock.
# 2026-07-23 - public fresh/resume timeout contract and stale malformed-event fixture

- Public journey `29972091501` did not deadlock: at GitHub cancellation both browsers were connected,
  assertion-clean, and advancing wave-2 entry phases. The driver's adaptive progress deadline had extended
  to ~48 minutes, but the outer fresh/resume job still killed it at 35 minutes.
- The fresh/resume job ceiling is now 55 minutes, matching the driver's bounded hard ceiling plus artifact
  cleanup. This removes a deterministic infrastructure false red; it does not waive a driver assertion or
  production terminal.
- Full-gate A1's sole red was stale validation debt: passive ability source slots now intentionally support
  up to 31, while the malformed-event test still used slot 3 as invalid. The negative fixture now uses 32;
  production's strict validator remains unchanged.
- No local co-op/browser Vitest run. YAML/static/ownership verification only; exact remote qualification is
  required after the active public journey releases the branch push lock.

# 2026-07-23 - exact final Mystery-turn terminal successor

- Full-gate C1 on `ff838fee8` remained checksum-converged through wave 32 and successfully crossed the newly
  exact `ME_TERMINAL -> command-open` edge. Its inverse edge then failed: the final embedded-battle
  `TURN_COMMIT` parked on a generic turn-N wait, while the retained Mystery settlement is deliberately
  addressed as `ME_TERMINAL` at the same wave/turn 0. Authority V2 correctly rejected that unstated edge and
  terminated the session before the reward tail.
- The turn adapter now accepts only a bound, typed `AWAIT_SUCCESSOR` override in addition to command or
  replacement control, rejects conflicting/mis-addressed successor inputs, and preserves the exact closed
  Mystery terminal address. The authority engine explicitly supplies the Mystery-battle identity at the turn
  capture boundary; the engine-free streamer no longer infers it from ambient phase state.
- Process note: an accidental local node-pure invocation completed 80/80 before the current no-local-co-op
  rule in `AGENTS.md` was re-read; it exited normally and was not repeated. Scoped Biome has no new errors,
  and repository TypeScript reports only the unrelated feat integration baseline with no touched-path
  diagnostic. All valid C1/contract/full-gate proof remains remote-only after the active public journey
  releases the branch push lock.

# 2026-07-23 - replacement-owned Mystery terminal edge and exact staging-noise classification

- The same final Mystery victory can cross through `REPLACEMENT_COMMIT` instead of `TURN_COMMIT` when a
  surviving player faints on the winning turn. Replacement now supports an operation-bound ordered wait;
  the runtime emits the exact `op:me / ME_TERMINAL / same wave / turn 0` successor only when the phase is an
  actual Mystery battle, the retained handoff names that wave, the immutable enemy image is defeated, and a
  player remains alive. Ordinary replacement, wave victory, and GameOver successors are unchanged.
- Public journey `29973852644` on `ff838fee8` completed the product path through fresh registration, lobby
  pairing, two live turns, reward, wave-2 checkpoint, full reload, re-pair, resume admission, and resumed
  wave-2 command control in both real browsers. Its final 3+3 fatal events were the exact optional
  `/tournament/list` 404 emitted because that service is not mounted on the staging save Worker. Evidence now
  excuses only that status/path on the exact staging hostname; production, other paths/statuses, and browser
  exceptions remain fatal.
- Local verification stayed within the current policy: scoped Biome formatting/checking has no new error,
  repository TypeScript emitted no diagnostic, `git diff --check` is clean, and the ownership manifest
  validates. Co-op node/browser tests were not run locally; the new adapter/cutover negative contracts and
  exact two-browser journey require hosted qualification.

# 2026-07-23 - no-reward Mystery terminal chain and current feat integration

- Reconciled the stale `a4ce1a3e6` audit against the current line. Its Mystery same-turn command edge,
  exact faint-proposal retry retirement, recovery pending-control frontier, and protocol-compatibility
  findings were valid for that snapshot but are all closed by isolated production fixes and failure-first
  contracts; the wire protocol is now `er-coop-44`.
- Full-gate C1 evidence on `d69346fea` found a later real product edge at wave 39. `ER_CLEANSING_FONT`
  committed `ME_TERMINAL reward-settled` with no reward operations, then immediately authored the final
  transaction `leave`; the settled image waited at engine turn 1 while the terminal transaction remained
  addressed at turn 0, so the generic interaction rule rejected the legitimate step-1 entry.
- A settled Mystery terminal with an empty reward surface now states only the exact next terminal operation:
  `op:me`, `ME_TERMINAL`, same wave, turn 0, and the predictable pinned sequence plus one. Negative contracts
  reject the wrong operation id, kind, or turn. Other reward and multi-surface paths retain their existing
  predecessor graph. Runtime proof remains hosted-only.
- The same `d69346fea` qualification proved the separate P33 mutation job, native browser WebRTC/hot-rejoin,
  public UI plus all Authority V2 contracts, lane A, all triple/topology lanes, and Showdown S1/S2/S4-S7.
  Its remaining gate reds are mixed: many still construct retired raw carriers, while each unresolved engine
  mechanism must remain individually triaged rather than waived by shard.
- Merged current `heraklines/feat/elite-redux-port` (`e325c2b46`) into the local integration candidate. This
  adds the confirmed divergent-save overwrite repair, bounded/restored triple layouts and summon behavior,
  forced-format/map fixes, and their regressions without changing Authority V2 ownership. No push occurs
  until public journey `29975873789` releases the shared browser accounts.

# 2026-07-23 - staged normal victory owns the final turn successor

- Public fresh/resume journey `29975873789` completed green on `d69346fea`: both real browsers registered,
  paired, played through wave 1, crossed the reward boundary, reached wave-2 command, reloaded, re-paired,
  resumed, and installed live command control. The compact evidence is assertion-clean and both final
  screenshots show the same double battle/command frontier in the peers' different locales.
- Full-gate C5 on the same SHA exposed a separate real product defect at wave 4. VictoryPhase had already
  staged a normal retained win while the material turn was recording, but its checkpoint transiently kept
  one enemy at positive HP. The TURN adapter re-guessed from that ambiguous image, emitted COMMAND_FRONTIER,
  and the log correctly rejected the later WAVE_ADVANCE. Earlier fully-fainted waves took the non-command
  path and passed, which is why this appeared only when X Attack produced that exact double-battle ordering.
- The immutable turn boundary now captures the active runtime's exact deferred-win identity and treats it as
  stronger than snapshot inference. It states only WAVE_ADVANCE at the already-defined BattleEnd settlement
  coordinate (same wave, resolving turn + 1), suppresses replacement/command derivation, and fails closed if
  the marker loses its staged transition or conflicts with a Mystery battle. The intentional wild co-faint
  case remains COMMAND when no victory was staged.
- Focused contracts cover the exact N+1 WAVE wait, reject N/N+2 and broadened kinds, and cover the marker's
  null/conflicting shapes. Per repository policy no co-op Vitest ran locally. Scoped Biome has no errors,
  `git diff --check` is clean, and full TypeScript still reports the inherited ability/feat baseline (581
  lines) with zero diagnostic in the six touched implementation/test paths. Hosted C5/full qualification is
  required on the pushed candidate.

# 2026-07-23 - live turn-successor parity and stale staged ACK idempotency

- Exact public fresh/resume `29977644679` proved the staged-victory marker reached production, then exposed
  a live-consumer split: the pure TURN adapter correctly authored its WAVE-only `AWAIT_SUCCESSOR` at turn
  N+1, while `CoopFinalizeTurnPhase` still hard-coded every ordered wait to turn N and terminalized both real
  browsers at wave 1. The adapter now exports one canonical successor-address validator used by both entry
  construction and the renderer; staged victory, normal wait, replacement, and command rules cannot drift
  independently again.
- Full-gate C5 `29977670560` found a second at-least-once boundary. Both randomized and X Attack soaks applied
  turn material, reached `presentationReady`, then revisited the exact `materialApplied` stage while the V2
  entry was still retained. A lower exact stage is stale evidence, not a new authority claim: the monotonic
  ledger now ignores it while still failing skipped-forward stages and same-stage conflicting bytes. The live
  finalizer also reads its exact emitted-stage cursor and resumes after material/presentation instead of
  reapplying an already-proven stage.
- Failure-first stream coverage recreates `materialApplied -> presentationReady -> materialApplied`, proves
  neither peer terminalizes and retention remains live until `continuationReady`. Full repository TypeScript
  remains on the unrelated ability/feat baseline with no diagnostic in the four implementation/test files
  touched here; scoped Biome has no new error and `git diff --check` is clean. Co-op tests remain hosted-only.

# 2026-07-23 - mutation victim keeps its causal marker at every ACK boundary

- Mutation run `29978609820` still killed the `full-address-wave` mutant, but the new monotonic ACK path made
  the final `continuationReady` assertion expose the deliberate cross-wave key collision before the victim's
  earlier marked assertion. The mutation runner therefore reported `targetedFailure=true` but `marker=false`.
- Every second-wave ACK assertion now carries the same `P33_MUTATION_CAUGHT[full-address]` causal marker. This
  does not weaken or reclassify the victim: removing `wave` must still fail the exact targeted test, and the
  runner can now recognize the protection whichever ACK stage first observes the collision.

# 2026-07-23 - Showdown command-open follows the complete entry image

- Hosted S3 evidence showed the replica accepting the Showdown post-summon wave-start image at tick 5, then
  rejecting Authority V2's older command-open image at tick 4 and terminalizing. `CommandPhase` had authored
  the V2 frontier before its host-only post-summon seal/rebroadcast. The authority now publishes that final
  entry state first; replica ordering remains gated, so command-open is always at least as new as the carrier
  a guest can have applied.
- Hosted S8 also exposed a direct-fixture-only multi-format gap: mirrored doubles/triples started only the
  first real guest CommandPhase although the seat-owned V2 frontier required two/three address proofs. The
  fixture now crosses every real sequential local CommandPhase, advances only intermediate renderer phases
  with inert skips (the test relay still owns commands), and leaves the final public surface actionable.
- S1's remaining red was an obsolete expectation: its trace shows the TURN_COMMIT replacement successor
  material-applied and projected before the first picker starts, yet the test expected that authorized phase
  to retire as "speculative" and a duplicate generation to open. It now requires exactly one public PARTY
  surface bound to the immutable `RC/...` operation and retains all close/material-order assertions.

# 2026-07-23 - public journey trigger covers gameplay phase boundaries

- The public two-browser workflow previously watched only three named phase files. A production authority
  fix in `CommandPhase` therefore would not automatically receive player-path qualification on branch push,
  despite changing the exact boundary where command control becomes actionable.
- The push filter now covers `src/phases/**`. Co-op authority is deliberately distributed through ordinary
  gameplay phases, and future screens or migrated interactions must not silently bypass the production-built,
  keyboard-only two-browser journey because a workflow allowlist was not updated in parallel.
- The journey's owned static slice now includes `CommandPhase` as well, so this exact ordering repair cannot
  build into browser evidence while a TypeScript or Biome defect in its production boundary is being ignored.
- A node-pure workflow contract pins both guarantees: the broad phase trigger and `CommandPhase`'s owned
  TypeScript/Biome slice. CI wiring can no longer drift back to the blind spot without a causal fast-gate red.
- The focused gate treats this branch as the integration train and therefore requires each push manifest to
  anchor at `github.event.before`, not at the train's older batch origin. Its previous red stopped in ownership
  planning before any test ran (`declared base d69346f... does not match resolved train base ff57332...`). The
  next exact batch is re-anchored to the current remote tip `8d7cedd34`; this preserves fail-closed ownership
  while allowing the planner to qualify only the new seven-file delta.

# 2026-07-23 - exact qualification context repairs after the presentation audit

- Full-gate `30005118269` on `e0cce81bd` exposed two non-product blockers: the focused shards had run without
  any `COOP_AUTHORITY_V2_*` process flags, and `coop-duo-fault.test.ts` returned a numeric watcher token from
  callbacks whose contract is `Promise<void>`. The focused engine job now enables turn, replacement, wave,
  interaction, and recovery exactly like the aggregate gate; a source contract pins all five flags. The
  watcher callbacks now await the token internally without leaking it through their return type.
- Showdown journey `30005117992` never exercised Showdown. Both final screenshots showed the intentional
  title message `Temporarily disabled. It will be back soon.` because the exact-SHA driver supplied its sealed
  fixture but omitted the existing public `enableShowdown=1` override. Only the dedicated Showdown journey now
  appends that query parameter; ordinary players remain disabled. A source contract scopes the override to the
  exact journey before navigation.
- Permitted local evidence: 15/15 public/workflow source contracts green, touched-path TypeScript filter empty,
  scoped Biome has no errors (repository-baseline complexity infos only), and `git diff --check` clean. Co-op
  engine and browser qualification remain GitHub-hosted per `AGENTS.md`.

# 2026-07-23 - switch, replacement, and status presentation become host-authored

- The presentation audit found that `switch` and `status` were declared wire events with no production
  producer, the guest predicted its own voluntary switch from local command state, and a V2 replacement
  could acknowledge `presentationReady` after only snapping the final sprite. Switch/roar/pivot paths could
  therefore be mechanically converged while visibly incomplete or positionally wrong.
- Every resolved `SwitchSummonPhase` now records an immutable identity-bearing switch event. The guest uses a
  presentation-only replay phase that performs the recall/ball/summon visuals and side-effect-free party
  placement without hazards, abilities, RNG, or local turn resolution. The guest-side predictive self-switch
  path is removed. Status acquisition and cure now produce absolute presentation events at the state mutation.
- Post-faint replacements carry their exact summon result inside `REPLACEMENT_COMMIT`; missing presentation
  material fails entry construction/decoding. The renderer drains that exact event before applying the
  replacement checkpoint and watermarks the global V2 revision so redelivery re-proves material without
  replaying the animation. Protocol `er-coop-45` rejects older renderers that would silently snap this boundary.
- Showdown run `30007414806` reached a real reciprocal battle but correctly found no Drizzle presentation:
  the dedicated fixture selected Pelipper ability slot 1 (Elite Redux Retriever) while claiming it selected
  Drizzle. The fixture now selects slot 0, so its ability/environment oracle measures production presentation
  instead of waiting for an impossible event.
- Full gate `30007412687` proved public/V2 contracts, build, native WebRTC, mutation, and all gameplay shards
  green; its sole upstream red was the static job comparing against the last all-green full gate and therefore
  classifying months of unrelated branch changes as this candidate's delta. Full static now uses the exact push
  base, or the checked-out first parent for manual dispatch, while retaining the full-repository diagnostic
  ratchet and global co-op-scope enforcement.
- The first post-push bypass audit caught the new replay phase missing from the default-enforced renderer
  allowlist. That would have replaced it with `CoopInertPhase` and left a replacement presentation watermark
  unopened. The phase is now present in the production allowlist, the empirical observed-phase contract, and
  the two-engine replay driver; the fast source contract also requires that wiring for every future edit.
- The public-browser push trigger was also too narrow: changes to the battle stream, transport, renderer gate,
  field event producers, phase manager, or a new UI could skip the real-browser journey. On `ci/coop/**` it now
  covers the whole co-op and Showdown cores plus field, phases, and UI; a source contract pins that breadth.

# 2026-07-23 - migrate command tests to the production optional-target branch

- Current objective: finish the legacy co-op test migration and close Showdown/combat presentation gaps using
  hosted engine shards and the keyboard-only two-browser journey as the release oracle.
- Showdown browser run `30023709176` completed two reciprocal turns with exact ability, weather, damage, message,
  move, and HP presentation receipts on both browsers. Its final screenshots were visually inspected and show
  the correct reciprocal Pelipper battlefield; this is strong evidence for the covered path, not yet proof of
  voluntary switch, forced switch, faint replacement, Tera, or form-change presentation.
- The shared duo command driver now follows the production branch where one legal target submits immediately;
  T2 biome and Mystery tests no longer manufacture a nonexistent `SelectTargetPhase`. The remaining battle-end
  journey used the same stale assumption for the host, so it now accepts either the real target picker or the
  already-open `CoopTurnCommitPhase` and still asserts the exact authoritative target.
- Focused run `30026154754` is the current hosted diagnostic for canonical trainer launch-state divergence. The
  strengthened assertion compares the complete checksum material before its opaque digest, so the next failure
  identifies the actual diverging field instead of presenting matching summaries plus two unexplained hashes.
- That run identified the exact missing material: an entry effect left the authority enemy at stat stage `-1`
  while the renderer's same enemy reopened command at `0`. The enemy manifest now carries and reapplies all
  seven live stages in both same-species correction and structural reconstruction, making the manifest pass
  monotonic with the complete wave-start image instead of allowing reconstruction to zero later battle math.

# 2026-07-23 - entry-effect authority carrier and fixture migration

- Remote B8 evidence identified a real post-entry state loss: the complete authority state applied an
  entry ability's enemy stat stage, then the structural enemy-manifest corrector reconstructed/recalculated
  the battler from a manifest which did not carry that live stage. The manifest now carries and validates
  all seven stages in both its in-place and reconstruction paths.
- Migrated the Cheap Tactics regression away from an invalid post-seal rewrite. Wave-entry authority is
  immutable; the test now proves the actual sealed carrier already contains the automatic entry damage and
  that the guest has applied it before command control opens.
- The remaining optional-target command fixture now accepts both valid production paths: an explicit target
  picker when multiple targets exist, and the direct replay commit when only one legal target exists.

# 2026-07-23 - early-command implicit-target race

- P2's real public command driver exposed a product failure hidden behind its biome label: the guest could
  submit its move before receiving the authority's legal offer. When its renderer omitted the only implicit
  numeric target, the authority validated the raw `targets=[]` command before its existing unambiguous-target
  repair, rejected it, and waited forever after both players had already chosen.
- Validation now repairs only FIGHT geometry before checking the authority offer; non-FIGHT commands stay raw
  through validation so malformed extra fields cannot be normalized away. Both the pre-wait buffered race and
  the already-live waiter have failure-first regression coverage which also proves no rejection/default path ran.

# 2026-07-23 - V2 biome test migration

- Tail-focused SwitchBiome fault tests no longer manufacture a second interaction commit behind the live V2
  command predecessor. They install the exact already-committed transition permit and continue testing only
  tail parking, idempotence, materialization, and bounded recovery.
- Removed the detached market-owner retention half from the production phase suite because it violated the
  closed V2 predecessor graph and duplicated the operation/durability retain-before-publish contract. The
  unique watcher assertion remains: a missing exact terminal must never be treated as LEAVE.

# 2026-07-23 - battle-control fixture migration

- Full gate `30028133952` showed two remaining battle-control assumptions rather than a production regression.
  The host-menu test was starting a second synthetic V2 command entry against a deliberately legacy spoof peer;
  it now observes the real command surface which `startBattle()` already opened.
- The two-engine EXP journey now distinguishes the public renderer's valid targetless sole-target intent from
  the authority's normalized committed command. It accepts either raw UI shape at the transport edge but still
  requires the host's committed guest command to contain exactly `ENEMY_2` before the turn can execute.
- The full soak's wave-20 Tera red was a harness omission: `CoopTeraReplayPhase` was allowlisted in production
  but absent from the shared replay drain set, so the driver declared a strand while the animation child was
  validly ahead of `CoopFinalizeTurnPhase`. The shared pump now drains it.
- Journey and Mystery soaks no longer use a 50 ms command-rendezvous ceiling. The failing seed showed the guest
  actively draining 22 immutable entry ability/stat events while seven 50 ms retries exhausted on the host.
  A two-second test ceiling remains bounded but represents the production ordering guarantee.

# 2026-07-23 - Showdown voluntary-switch presentation oracle

- The real two-browser Showdown journey no longer stops at a one-mon, attack-only happy path. Its sealed fixture
  now carries a legal Gyarados bench on both clients; both players navigate the ordinary command grid, party list,
  and SEND OUT submenu exclusively with public keys before two further attack rounds.
- The CI observer now gives the command grid locale-independent semantic identities, including conditional Tera
  and dev-only Reset entries, without mutating the game. The switch round requires two completed `switch`,
  `showAbility`, and `statStage` entries in the exact authority-versus-renderer ledger before command can reopen.

# 2026-07-23 - B8 reward fixtures migrated to Authority V2 evidence

- The live-shop resync journey still drives the real owner surface through public `CANCEL -> CONFIRM`, but no
  longer expects the intentionally retired legacy `op:global` UI trace. It now proves that exact input chain
  advances the host's one mechanical Authority V2 log by exactly one entry, then retains its waiter,
  interaction-counter, and full checksum convergence assertions.
- Two focused reward commit fixtures bypassed `SelectModifierPhase.start()` and therefore left `typeOptions`
  undefined. They now install the same valid empty authoritative option image that a started phase owns before
  invoking the private terminal/result seam; this removes fixture crashes without changing production code.

# 2026-07-23 - trainer lanes become immutable authority material

- B8 exposed a real trainer-battle divergence: the guest reconstructed every streamed trainer enemy with
  `TrainerSlot.TRAINER`, while the authority's partnered lead and reserve correctly used
  `TrainerSlot.TRAINER_PARTNER`. The enemy manifest and complete battle image now carry the exact live lane;
  initial reconstruction and later full-state application both restore it before AI or switch selection.
- The trainer-switch and rapid faint-chain journeys now opt into the harness's existing address-exact next-turn
  command proof. Previously they asked for turn N+1 while the pure renderer was validly parked at turn N's
  finalize phase, producing a harness-only `host=11:2, guest=11:1` red before testing the switch itself.

# 2026-07-23 - Showdown clocks no longer outrun mandatory presentation

- Exact two-browser run `30030175748` proved the authority and renderer produced the same entry weather,
  ability, and message ledger, but its oracle waited for both command surfaces while the first seat's real 60s
  clock was already running. At ~3 fps both seats auto-picked before the driver attempted its voluntary switch.
- The public driver now acts on the first CURRENT owned command surface immediately and requires the complete
  ordered renderer ledger before admitting the reciprocal choice. Historical command surfaces superseded by
  presentation are fail-closed, with a failure-first source regression for the exact stale-surface sequence.
- The remote-command relay now has three minutes of bounded renderer grace in addition to the player's 60s
  input clock. A peer cannot be replaced by AI while mandatory authoritative presentation prevents its menu
  from opening, while disconnect and the combined four-minute ceiling still guarantee liveness.

# 2026-07-23 - biome journey public-input migration and terminal isolation

- The T2 biome journey no longer follows its guest public UI choice with a private host `move.select` call.
  The shared duo driver can now submit both seats' Tackle choices through the real Command, Fight, and
  conditional target handlers, preserving the exact reciprocal command and V2 commit chain.
- Harness context restoration no longer reactivates a runtime whose transport was closed by a fail-closed
  terminal inside the scoped callback. Duo teardown now disposes both client runtimes even after closing the
  first endpoint closes its peer; transport state was not proof that the peer's timers/listeners were retired.
- A source contract pins both rules: the production-transition journey contains no private move selection,
  and closed runtimes cannot be skipped or resurrected by the shared-process scheduler.

# 2026-07-23 - Showdown public switch submenu synchronization

- Exact two-browser run `30032611935` proved the first-seat command is now acted on before its clock expires;
  the host reached the real Gyarados action menu with SEND OUT visibly selected. The driver nevertheless read
  its preceding party-slot observation and declared SEND OUT unavailable before the newer frame arrived.
- The voluntary-switch oracle now waits for a post-submit party observation whose actual option set contains
  SEND OUT, then navigates from that exact surface. This is an observer pacing fix; the screenshot and semantic
  trace prove production had already opened the correct public menu.

# 2026-07-23 - Mystery transition command migration

- Focused P1 on `41c5c4948` exposed the same mixed-input seam as the biome journey: the guest chose through
  production UI, then a private host `move.select` bypassed the reciprocal command surface and left the host
  parked at MESSAGE. Both Mystery journey variants now submit both seats through the shared public UI driver.
- The source migration contract now covers both long production-transition suites, preventing a future helper
  refactor from silently restoring private battle input to either biome or Mystery coverage.

# 2026-07-23 - Mystery reward-handoff peer pump

- B9's first Mystery failure showed the replica had correctly installed ME_PRESENT, buffered later revisions,
  and sent a tail request while its replay waited for the embedded reward successor. The one-process helper
  pumped only the guest, so the queued request never reached the host and it declared the replay stranded.
- `startGuestMeShopOwner` now derives the registered authority context and services that peer between guest
  drains by default. This models the two independent browser event loops and closes the documented pumpPeer
  tail without requiring every caller to remember bespoke wiring.

# 2026-07-23 - public post-turn contract migration

- Full gate `30034310659` found one remaining fake-browser fixture which followed a current MESSAGE surface
  with only the retired `CommandPhase -> LOCAL UI` console string. Production intentionally refuses to
  resurrect an older command while a newer semantic surface is visible, so that fixture could never prove the
  next public frontier.
- The fixture now publishes the same current, owned, address-bearing `command:command` semantic observation as
  a real browser after each narration confirm. The fast gate therefore validates the production ownership rule
  instead of relying on its legacy console fallback.

# 2026-07-23 - Showdown renderer presentation cannot close command collection

- Exact two-browser run `30033867894` showed the authority submitting its real voluntary switch while the
  renderer was still consuming entry weather, message, and ability events. The driver's generic same-address
  `MessagePhase` test incorrectly declared command collection closed and skipped the renderer 52 seconds before
  its real command menu opened; both production clients were still healthy and converging.
- Battle-progress collection-close proof is now authority-only (structural rewards remain role-independent).
  A failure-first delayed-renderer regression proves an ordinary guest `MessagePhase` cannot skip that player,
  the complete presentation ledger is checked, and the renderer's eventual public command is submitted.

# 2026-07-23 - Showdown authority wait is not command collection closure

- Exact two-browser run `30035702783` advanced past the renderer-message false close and proved the guest
  replayed weather, text, and ability. It then exposed the companion authority-side seam: the host's
  `EnemyCommandPhase` is the live rendezvous which requests and waits for the opponent command, not evidence
  that the reciprocal command owner does not exist.
- The sequential public driver now keeps collection open across that exact addressed authority wait. Its
  failure-first regression publishes both the authority `EnemyCommandPhase` and renderer presentation before
  the delayed peer command, and proves presentation is checked before the real second command is submitted.

# 2026-07-23 - Learn-move and Revival fixtures follow V2 control

- The isolated batch learn-move tests now retire their real boot `COMMAND_FRONTIER` through a complete
  `TURN_COMMIT -> AWAIT_SUCCESSOR` before opening the interaction. They no longer ask the V2 log to accept an
  impossible direct `COMMAND -> LEARN_MOVE_BATCH` edge.
- The Revival Blessing journey now installs its input hook before the immutable prompt arrives and drives the
  current, operation-addressed `CoopGuestRevivalPhase` projected by V2. It no longer searches or manually
  starts the retired legacy queued phase after the real public picker has already opened.

# 2026-07-23 - Biome-operation fixtures use the global V2 log

- Isolated wave-11 biome cases now boot at wave 11 and retire their real initial command into an ordered
  successor wait before opening the map. Mutating `waveIndex` after a wave-1 command had left the fixture's
  interaction address outside the authority graph.
- The stale-proposal adapter supplies the mandatory immutable operation identity under V2. The durability
  leg now drops one `authorityEntry` and requires its retained redelivery, instead of expecting a raw
  `biomePick` result carrier that the cutover correctly suppresses.

# 2026-07-23 - Ordinary V2 interaction projection closes modal presentation gaps

- Ordinary replica delivery now reconstructs Revival and both Move Learn surfaces directly from the same
  immutable projection capsule recovery uses. Those mid-turn modals no longer depend on a suppressed raw
  prompt or process-global listener timing before they can become actionable and publish `controlInstalled`.
- The isolated-boundary helper now drives the replica through the committed synthetic turn and requires the
  ordered `AWAIT_SUCCESSOR` to be active, not merely admitted. This prevents later fixture entries from
  appearing as revision gaps while the prior turn is still waiting for its real replay/finalize proof.

# 2026-07-23 - Showdown presentation evidence starts before command execution

- Exact two-browser run `30037468361` reached the synchronized second-turn command and recorded identical
  authority/renderer switch, ability, message, and stat-stage entries on both browsers. Its post-turn oracle
  nevertheless sliced from cursors captured after command submission, so every causal presentation entry was
  outside the evidence window and the healthy ledger was reported as empty.
- Each sequential real-player round now preserves a dedicated evidence cursor immediately before its first
  public command is submitted. Switch and attack presentation are compared from that causal boundary while
  the later outcome cursors remain reserved for finding the next frontier. The deterministic dual-Intimidate
  requirement remains strict; the corrected run must expose any real missing ability instead of hiding it.

# 2026-07-23 - Showdown presentation fixture uses symmetric active abilities

- The prior switch fixture described Gyarados slot 0 as Intimidate, but Elite Redux places Intimidate in
  Gyarados's first innate slot. Player innates are account-unlock gated while opponent innates are active,
  so an identical versus manifest produced only the opponent flyout/stat drop and could never satisfy the
  intended two-sided presentation proof.
- The guarded browser-only preset now switches both seats to active-slot-0 Intimidate Arcanine. Both ability
  flyouts and both stat-stage animations are therefore required without depending on either disposable CI
  account's candy unlocks; the oracle remains strict instead of treating missing combat presentation as noise.

# 2026-07-23 - Authority V2 modals replace stale renderer overrides

- Full gate `30039243371` showed learn-move and Revival commits applying their immutable DATA but remaining
  `controlDeferred`: the renderer already occupied PhaseManager's single generic standby slot, so both the
  legacy inline opener and the new ordinary V2 projector silently failed to install the real modal.
- PhaseManager now has a narrow authenticated-modal replacement primitive. It discards the superseded local
  standby, preserves the exact current ordered predecessor as the modal return target, and starts the V2 phase.
  Ordinary Move Learn and Revival projection uses this path, so an unrelated renderer override can no longer
  suppress a committed combat UI or resurrect an old CommandPhase when that modal closes.

# 2026-07-23 - Wave and biome suites use legal V2 predecessors

- The wave matrix no longer boots its synthetic renderer at final wave 200/LoginPhase and then asks an
  uninstalled command to retire. It boots a playable addressed command and exercises finality through the
  production `isWaveFinal` predicate; its adversarial replay is now turn 2 rather than reopening consumed turn 1.
- Biome/Crossroads interaction cases now boot at their tested source wave and retire the real initial command
  into `AWAIT_SUCCESSOR` before opening a picker. They no longer mutate a wave-1 authority address after the
  fact. Raw `biomePick` emission and legacy durability are no longer treated as correctness: the public map
  probe requires an `INTERACTION_COMMIT`, and retained checks read the global V2 log.

# 2026-07-23 - Co-op test migration owns the complete integration directory

- Focused run `30040452427` stopped in planning because the ownership manifest enumerated individual co-op
  suites and did not yet include the newly migrated biome-choice suite. No test or product assertion ran.
- This task is explicitly migrating the complete co-op suite to Authority V2, so the manifest now owns the
  co-op integration-test directory. Subsequent migration batches can fan out immediately while production
  ownership and the frozen protocol-schema guard remain unchanged.

# 2026-07-23 - Turn and Revive durability regressions use V2 carriers

- The hand-assembled two-engine turn spike no longer requires the suppressed raw `turnResolution` message.
  Under cutover it requires no raw correctness carrier, an applied V2 entry, converged battle state, and the
  real ordered victory continuation; the legacy fallback keeps its original assertion.
- The lost-Revive regression now drops the first reward `INTERACTION_COMMIT`, opens the real watcher before
  the owner commits, advances the authority-log lease, and requires retained redelivery to revive the guest
  exactly once. It no longer faults an unproduced `interactionChoice` or manually invokes snapshot recovery.
- The reciprocal biome-runtime isolation case retains its suite-standard bounded timeout instead of inheriting
  Vitest's 20-second default, which had expired during a healthy heavyweight duo boot on a shared runner.

# 2026-07-23 - Stormglass regression follows installed public V2 control

- The Stormglass suite no longer invokes a captured option callback before `setMode` has installed the real
  actionable control. It waits for the public option handler and selects Sandstorm with DOWN/DOWN/ACTION.
- The assertion now requires the raw `interactionChoice` carrier to be absent under V2 while both engines
  apply the immutable result. The prior fault assertion demanded a carrier the cutover intentionally suppresses.
- Focused static evidence also corrected the biome-choice suite's V2-shadow accessor import to the runtime
  facade that owns it; run `30041271018` had caught that migration typo before executing a deployable checkpoint.

# 2026-07-23 - Authority V2 boundary-fixture predecessor migration

- The full sharded gate exposed a shared legacy-fixture seam: isolated wave/interaction suites booted a real
  V2 `COMMAND_FRONTIER`, then attempted to commit their target boundary directly. The global log correctly
  rejects that impossible edge; mutating `waveIndex` after command-open also changes no ordered address.
- The duo harness now has one narrow non-journey helper which captures complete turn authority and commits a
  real `TURN_COMMIT` into an exact `AWAIT_SUCCESSOR`. The wave-operation matrix boots at each tested wave and
  follows `COMMAND -> TURN_COMMIT -> WAVE_ADVANCE/TERMINAL_COMMIT`; UI journey suites remain public-input only.
- The public duo command helper's legacy `restartAlreadyOpenHost` option is now idempotent. `buildDuo` already
  adopts and re-enters the pre-pair host command; starting that live menu again after guest arrival reset it to
  MESSAGE and manufactured the shared P1/P2/reward/multiwave “stuck at CommandPhase” signature.

# 2026-07-23 - Showdown reciprocal-switch renderer lifetime closure

- Exact two-browser Showdown run `30039682544` at `52fa909b3` proved the authoritative presentation stream
  delivered the complete ordered sequence on the replica: weather, message, ability, switch, ability,
  message, stat-stage, switch (seq 0-7). The authority then raised `Cannot read properties of null (reading
  'x')` in `SpritePipeline.onBind` while its second `SwitchSummonPhase` temporarily detached a sprite from
  the field container. The host screenshot had lost the local battler/HUD while the guest showed both
  Arcanine and the Intimidate message.
- `SpritePipeline` now treats a temporarily detached sprite as already expressed in its own coordinates and
  applies no field-relative offset for that batch. A fast Showdown source contract forbids reintroducing an
  unconditional `field.x`/`field.y` dereference. The contract is 10/10 green; scoped Biome has only existing
  informational findings and `git diff --check` is clean.
- Next: dispatch the exact two-browser `showdown-battle` journey on the fixed SHA and visually inspect both
  post-switch screenshots. Co-op Vitest and browsers remain remote-only under `AGENTS.md`.

# 2026-07-23 - Presentation completion is outcome-driven for identity events

- The fresh source audit correctly found that queue drainage was being reported as successful rendering even
  when an ability, Tera, switch, or replacement presentation resolved the wrong actor, threw, or expired its
  watchdog. Replacement presentation watermarks could therefore advance after a failed visual operation.
- Identity-bearing replay phases now settle a first-writer-wins outcome token. Ability and Tera require the
  exact side, battler, party slot, and Pokemon id; switch additionally requires the exact species. Failed or
  pending outcomes prevent a modern turn from publishing presentation-ready, and replacement watermarks only
  advance after rendered or explicit animations-disabled outcomes.
- Exact-browser receipts now carry rendered, intentionally-skipped, or failed outcomes (including reason and
  actor fingerprint) instead of inferring success from queue position. Static contracts reject malformed
  failure evidence and a focused engine regression proves a late animation callback cannot overwrite a
  watchdog failure. Remaining non-identity events will adopt the same outcome contract in the next slice.

# 2026-07-23 - Showdown next-command proof rejects the submitted address

- Exact run `30042537289` on the detached-sprite fix completed all twelve ordered authority/renderer events
  without a page error, proving the renderer crash was closed. The oracle then matched a transient command
  re-open at the already-submitted turn-1 address while the real turn-2 frontier arrived later.
- Every Showdown round now derives the exact numeric successor from the submitted public command address and
  requires both browsers to converge there before slicing its presentation ledger. Same-wave or same-address
  command observations can no longer produce an early false red or a false next-turn proof.

# 2026-07-23 - Transition and ME-shop fixtures consume public V2 authority

- The remaining T2 biome and Mystery transition drivers no longer restart `buildDuo`'s already-live host
  CommandPhase; both submit the real host and guest commands through the shared public command helper.
- The ME owner-override fixture now decodes retained `authorityEntry` commits for ME, reward, and terminal
  assertions instead of requiring the suppressed legacy envelope carrier.
- The biome-choice static assertion now compares the committed receipt to the global authority frontier's
  operation identity. `CoopV2AuthorityFrontier` intentionally exposes no duplicate entry-kind field.

# 2026-07-23 - Headless mirrors install the real active field

- Focused run `30044901272` proved the migrated public Mystery and launch journeys reached real Command/Fight
  input, but the guest Gengar computed zero legal Tackle targets. Its early empty command was then correctly
  rejected against the authority's two-target offer, leaving the host on its partner CommandPhase.
- The mirror had queried `getEnemyField()` before attaching cloned enemies to `scene.field`. Since enemy
  activity is defined by that attachment, the query was circular and always omitted the guest enemy leads.
  It now captures the host's exact live player/enemy Pokemon identities before cloning and installs those
  identities, in field order, on the guest (with the Showdown perspective swap preserved).
- The shared public command driver now asserts that the mirrored handler sees at least one live enemy before
  accepting keyboard input. The canonical empty command slot is also asserted as `null`, matching Battle's
  initialized command substrate rather than the obsolete pre-initialization `undefined` fixture.

# 2026-07-23 - Turn-one enemy adoption preserves live targets and fixtures use V2 semantics

- Focused run `30045700301` proved the direct mirror now installs the initial field, then exposed the later
  production seam: a retained state could make local enemies active before `enemyPartySync` structurally
  replaced them. Replacement removed the active local object but never fielded its host-authored successor,
  so a valid public Command/Fight surface had zero legal targets. Structural adoption now preserves the exact
  active field slot and display depth; pre-summon mystery/colosseum adoption remains intentionally inactive.
- The mystery-shop owner probe no longer demands that `ME_PICK` consume a mechanical Authority V2 revision.
  It proves the public proposal relay and host application, while the immutable `ME_TERMINAL` results remain
  the ordered mechanical entries. This matches the cutover's closed telemetry/mechanical distinction.
- The Stormglass probe now constructs its picker after the live runtime exists, following the real
  `COMMAND -> TURN_COMMIT -> AWAIT_SUCCESSOR -> STORMGLASS_PRESENT` graph. The old pre-pair phase captured a
  null owning runtime and correctly failed its durable terminal. The T2 suite also clears a retired shared
  runtime before booting the next Phaser-reused test scene, preventing a fresh solo bootstrap from entering
  the previous replica's replay wait.

# 2026-07-23 - Showdown ability receipts and retained enemy identities follow observable production state

- Exact two-browser Showdown run `30044520244` reached converged public command control without a desync or
  softlock, but rejected its presentation ledger because the exact guest ability flyout was visibly present
  while its throttled tween promise remained unresolved until the watchdog. Ability replay now records the
  rendered outcome at AbilityBar's synchronous visible/text installation boundary; its promise/watchdog still
  bounds phase liveness, so a slow tween cannot produce either a false failed receipt or a queue softlock.
- Focused run `30046428284` showed that encounter material can replace `battle.enemyParty[index]` before the
  retained state field object is replaced. Structural adoption now locates that displayed object by the
  host's immutable Pokemon id, removes it, and installs the rebuilt party member at the same depth. A focused
  regression models the distinct party-reference/display-identity race rather than only the simple same-object
  case.
- The Stormglass fixture explicitly starts the installed override because PhaseInterceptor suppresses the
  production PhaseManager auto-start in engine tests. The T2 suite also clears any runtime restored while its
  reused Phaser scene resets, closing the remaining cross-test replica bootstrap leak.

# 2026-07-24 - Exact gate roots: displayed identity, stale actor addresses, and V2 fixture semantics

- Full exact-SHA gate `30047250004` on `6169779e7` kept the public V2 contracts, all mutation shards, native
  WebRTC, lane A, every turn shard, and Showdown S1-S7 green. Its C4 resume artifact exposed a real renderer
  defect rather than a harness stall: authoritative apply could rebuild `enemyParty[index]` while a distinct
  same-id/same-species Pokemon remained in Phaser's field, so HP/faint replay mutated an invisible object and
  final presentation proof aborted despite a matching mechanical checksum.
- Structural enemy adoption now treats party/display identity separation as a required rebuild and performs
  projection-only stale removal (no `leaveField` mechanics). Replay resolves a detached logical party member
  back to the actually displayed immutable id. Failure-first regressions cover both same-species adoption and
  HP replay against a split identity.
- Showdown S8 had already converged mechanically before clearing itself on presentation failure. Replay had a
  hard-coded binary battler-index ceiling and trusted stale party-derived indices after in-turn reordering;
  ability/Tera now resolve their immutable Pokemon ids across both parties/actual field, triples use the live
  arrangement, and a uniquely identified legacy faint uses its resolved local field slot for the per-seat
  replacement picker.
- Forty-eight B/C/P failures shared one obsolete fixture assertion: it required an `AWAIT_SUCCESSOR` ordered
  permit to become an active human control and queried an authority head that may already be receipt-compacted.
  The helper now proves the actual committed predecessor, exact guest wait address, and absence of a fabricated
  active surface. Seventeen more failures required RIGHT to select a nonexistent second target; the public input
  helper now confirms the default legal target and leaves cursor-navigation coverage to its dedicated suites.
- B13's sole red also modeled an impossible ability bar: `isVisible=true` before phase entry exercised the
  hide-and-requeue path while expecting the new flyout synchronously. It now models closed-before-show and
  visible-after-show, preserving the throttled-tween regression without a false signal.

# 2026-07-24 - Cold-resume entry carrier and exact combat-presentation proof

- Public two-browser run `30047074787` proved fresh co-op through wave 2, then reproduced the live cold-resume
  abort before its first resumed command. Both seats loaded the same wave-2 snapshot, but
  `EncounterPhase(loaded=true)` suppressed the authority's retained enemy/entry carrier. The guest correctly
  waited for that carrier while the host eventually terminalized with "could not publish its complete entry
  presentation." Loaded authority encounters now publish through the same idempotent carrier seam; the method
  remains a hard no-op for solo and replica seats. A failure-first wiring assertion protects the exact seam,
  while the repeated public fresh/resume browser journey is the behavioral proof.
- Every combat event whose battler coordinate can become stale now carries an additive stable
  `{ side, pokemonId }` actor identity; move targets carry an aligned exact identity list. Producers cover
  move use, HP/healing, faint, stat stage, status, ability, Tera, and switch. Strict transport validation
  checks the new addresses, and Showdown's side projector flips both source and target identities.
- Replay resolves new entries by exact side-local identity and fails closed when that actor is not displayed;
  it only retains battler-index/species fallback for already-retained older entries. HP chains are keyed by
  stable actor identity, avoiding visual state reuse when a switch or faint reassigns a field coordinate.
- Move, HP, stat, status, faint, weather, and terrain replay now contribute presentation outcome tokens just
  like ability, Tera, and switch. Render callbacks settle success, disabled animations settle an explicit
  intentional skip, and missing actors, throws, rejected redraws, or watchdog expiry settle failure. The V2
  finalizer therefore cannot report `controlInstalled` after silently losing a mechanical presentation.
- Engine fixtures now execute the real replay phase implementations with animations disabled instead of
  mocking `start()` into a synthetic `end()`, so they exercise the same presentation-proof contract as the
  browser. Static verification is clean (`Biome`, `git diff --check`, and zero TypeScript diagnostics in
  changed files against the branch's 222-error baseline); co-op engine/browser qualification remains
  remote-only per `AGENTS.md` and is the next exact-SHA step.

# 2026-07-24 - Headless presentation migration and rebuilt field-container ownership

- Exact-SHA mutation qualification `30050966176` is fully green on `be00c5a59`. Full gate `30050984912`
  then proved the presentation ledger was fail-closed: Phaser.HEADLESS cannot execute production tweens, so
  legacy two-engine fixtures with animations implicitly enabled terminalized with `hp-watchdog-expired`
  instead of continuing behind unobserved presentation. The shared DUO engine fixture now explicitly selects
  the supported animations-disabled contract on both seats. It continues to prove real replay dispatch,
  immutable material, exact intentional-skip receipts, and V2 liveness; only the sealed two-real-browser
  journey is allowed to claim rendered-animation evidence, and it keeps production animations enabled.
- The same gate exposed a second, independent product/harness identity defect left by the structural adoption
  repair: a newly constructed Pokemon is not registered with Phaser's display list. Structural replay now
  follows SummonPhase's `add.existing` ownership step before seating the rebuilt identity at the preserved
  field depth. This closes the observed party/display split where public commands saw no legal rendered enemy.
- Faint replay now tests actual field-container membership instead of `Pokemon.isOnField()`. An interrupted
  switch can leave the exact visible actor with `switchOutStatus=true`; the authoritative faint must still
  animate and remove that displayed identity rather than silently reporting an off-field no-op.

# 2026-07-24 - Presentation watchdogs measure renderer progress, not assumed GPU speed

- Real two-browser run `30050966246` reached exact shared command control and streamed the complete first
  turn, then failed presentation proof on valid Growl/stat animations. The trace showed both renderers
  visible, focused, input-healthy, and advancing, but SwiftShader produced roughly 0.5 game-loop frames per
  wall second. The fixed five-second Phaser watchdog therefore expired after only a handful of actual
  animation frames; it was a false terminal, not a mechanical desync or missing event.
- Outcome-gated Tera, move, HP, stat, switch, status, and faint replay now use a progress-aware bounded
  watchdog. Each observation renews only after a newer renderer frame, the real animation completion
  callback remains the sole `rendered` receipt, a no-progress interval still fails closed, and a 120-second
  wall ceiling prevents an advancing-but-broken callback from becoming an indefinite hold. Ability keeps
  its synchronous visible-bar receipt and capture retains its independent hardened completion fallback.
- A failure-first engine regression proves one advancing frame renews the presentation observation while a
  subsequent no-progress interval releases the phase as failed. This preserves softlock protection without
  encoding the CI software renderer's frame rate into production correctness.

# 2026-07-24 - Engine presentation contracts are explicit and structural adoption uses proven seating

- Full exact-SHA gate `30053022023` kept static checks, public/V2 contracts, all mutation shards, native
  WebRTC, and twenty matrix shards green. Its twenty-four red matrix shards retained the same precise roots
  exposed by the earlier selected artifacts: animation-disabled two-engine fixtures still resolved exact
  display actors before recording their intentional skip, while B7's three direct retained-adoption proofs
  showed `Container.addAt` had not seated the rebuilt Pokemon at all.
- Presentation-only move and Tera replay now short-circuit the explicit animations-disabled contract before
  querying Phaser display actors. HP, stat, status, and faint treat an absent actor as an intentional skip only
  in that contract; animations-enabled browsers remain exact-identity and fail-closed. Faint's skip uses its
  normal finalizer so the address-exact replacement picker/relay is not accidentally bypassed.
- The independent Showdown two-engine rig now selects the same animations-disabled engine contract as the
  ordinary duo rig. Its real V2 mechanics and replay dispatch remain exercised, while rendered animation is
  claimed only by the sealed two-browser campaign.
- Structural enemy adoption now follows SummonPhase's proven `field.add` membership path, verifies membership,
  then restores the old display depth with `moveTo`. This replaces the failing direct `addAt` insertion without
  weakening the three existing B7 failure-first identity/same-species/retained-state regressions.

# 2026-07-24 - Exact field identity/depth and V2 fixture predecessor correction

- Exact-SHA gate `30053818956` moved every Showdown shard green and eliminated the broad missing-actor failure
  cluster. The remaining matrix failures are now dominated by legacy fixtures that mutate or commit after the
  immutable initial COMMAND entry, rather than a hidden presentation-success fallback.
- Exact presentation actor lookup now reads the real Phaser field container by immutable id and side without an
  `instanceof` realm dependency. Animations-enabled lanes still fail closed on missing/duplicate identities;
  the explicit animations-disabled engine contract remains an intentional skip rather than rendered evidence.
- Structural enemy adoption restores the displaced child's depth against a stable relative anchor and verifies
  the exact postcondition. This replaces an unverified numeric `moveTo` that left rebuilt battlers appended in
  all three retained-state identity regressions.
- The boundary-fixture retirement helper now recognizes `AWAIT_SUCCESSOR` as the active ordered permit the V2
  ledger deliberately installs. Requiring `activeControl=null` contradicted the production ledger and made
  already-converged interaction/wave fixtures fail before reaching their tested successor.
- The Commander regression now installs its entry-effect relationship before the initial immutable COMMAND
  entry is published. Its prior shape rewrote state after `buildDuo` had already admitted that control, which a
  closed authority graph must reject rather than rebroadcast as a compatibility mutation.

# 2026-07-24 - Environment presentation joins the renderer-progress contract

- Public two-browser run `30053005380` is green on `09eaad657`: two independent Chromium clients paired,
  completed wave 1 with rendered combat, reached wave 2, persisted the run, re-paired, resumed, and both
  returned to the same actionable wave-2 command surface in 27 minutes without a desync or softlock.
- Weather and terrain replay no longer use a fixed five-second wall-clock timeout. They share the same
  frame-progress-aware, 120-second hard-bounded watchdog as move/HP/stat/status/faint/switch/Tera replay, so
  healthy software-rendered environment animations cannot false-terminal a session at sub-1-FPS rates.
- Animations-disabled two-engine lanes now settle environment events as explicit `intentionally-skipped`
  outcomes before resolving a source actor or starting `CommonBattleAnim`. A direct regression proves those
  mechanical lanes never claim rendered pixels; animations-enabled browser lanes remain callback-proven and
  fail closed on stalls or throws.

# 2026-07-24 - Structural adoption reads the real Phaser child count

- Exact-SHA B7 evidence from gate `30054897928` proved the remaining structural-adoption failure was not a
  relative-reordering defect: every diagnostic reported `expected=NaN`. `Phaser.GameObjects.Container` does
  not expose its child count through `.length`, so the renderer always threw after seating the rebuilt actor
  and entered the compatibility corrector.
- The adopter now snapshots `field.getAll().length` after removing the stale identity and before adding the
  rebuild. Its anchor, insertion index, and verified postcondition therefore use the actual renderer order;
  this also prevents the fallback from leaving duplicate/stale display identities that can poison later
  exact-actor HP/faint presentation.

# 2026-07-24 - Ability presentation follows immutable display identity through material replacement

- Gate `30054897928` showed real two-engine turns terminalizing on `ability-actor-identity-mismatch` after
  an authoritative material apply detached the logical party object from the still-visible battler. Ability
  replay alone searched only party arrays, so its banner disappeared even though the exact immutable actor
  remained seated in Phaser's field.
- Ability replay now resolves an exact side/id first from the authoritative party and then from the exact
  displayed identity, matching HP/faint's material/presentation separation without introducing a slot or
  same-species fallback. A direct regression replaces the party reference while retaining the visible enemy
  and proves the authority-selected ability flyout still renders for that object.

# 2026-07-24 - The headless Phaser container now models real ordering and index zero

- B7 on exact SHA `f8addf531` replaced the earlier `NaN` diagnostic with valid expected indices but still
  left every rebuild appended. The production code was correct to expect Phaser reordering; the shared
  `MockContainer` implemented `moveTo`, `moveAbove`, and `moveBelow` as no-ops and returned `-1` for a real
  child at index zero (`index || -1`). This was a harness-fidelity defect that manufactured field ghosts and
  drove production toward unnecessary compatibility paths.
- The mock now implements Phaser's uniqueness, ordered movement, top/back movement, and exact `getIndex`
  semantics. Structural adoption uses the real `Container.addAt` primitive with the real child count and
  retains its exact postcondition, so the same code path is exercised in headless gates and browsers.

# 2026-07-24 - Detached presentation prefers pixels and tests preserve the unique-id premise

- Gate `30056004206` collapsed the matrix from twenty-four red jobs to three early reds after the container
  repair. Its remaining HP identity regression reused a deterministic Pokemon id already held by an old
  field child in the shared headless scene; the exact resolver correctly refused multiple distinct display
  objects instead of guessing. The fixture now establishes the production invariant that an immutable id is
  unique within the battle before creating its detached material object.
- Ability replay now prefers the exact displayed identity before an exact logical-party replacement. The
  detached regression proves `revealAbility` runs on the seated actor and never on the invisible replacement,
  closing a false-green assertion that previously checked only whether some flyout was requested.

# 2026-07-24 - Remaining structural fixtures and public target selection match production

- The two retained enemy-adoption regressions now establish the same battle-local Pokemon-id uniqueness
  invariant as production before recording display depth. This prevents a stale headless field child from
  impersonating the authoritative actor while preserving the renderer's exact-id, fail-closed lookup.
- The public duo command driver can now select the second enemy through the real TARGET UI. The two-engine
  victory progression regression uses that option so host and guest intentionally defeat distinct targets;
  default-target journeys and single-target production behavior remain unchanged.

# 2026-07-24 - Exact target proof observes the authority consumption boundary

- Focused run `30056574097` proved the guest's public TARGET UI emitted `ENEMY_2`, but the victory fixture
  inspected the host command array before its partner-slot `CommandPhase` had consumed that asynchronous
  proposal. The assertion now runs at the real pre-commit boundary, where both authoritative commands exist.
- New display-identity fixtures now cross Phaser's generic `GameObject` type through `unknown` explicitly;
  this preserves the runtime identity check while restoring the branch-scoped static contract.

# 2026-07-24 - Exploration relays stop asserting retired symmetric authority

- The isolated biome-market and Giratina durability probes now retire the real initial COMMAND into an
  ordered `AWAIT_SUCCESSOR` before opening their target interaction. They no longer splice a market or
  bargain directly after an unrelated turn whose immutable successor permits only wave advancement.
- The old simultaneous raw-choice probe now exercises Authority V2's actual direction: identified guest
  proposals enter the authority once, retries cannot poison the next same-sequence waiter, and a new stable
  operation id remains a distinct human action. The mixed legacy Giratina variant was retired from the
  all-V2 matrix; its compatibility echo is still faulted to prove it has no correctness ownership.

# 2026-07-24 - Exploration input now crosses the real V2 control gate

- Focused run `30057075418` reduced B1 to five failures and exposed one common fixture mechanism: reward,
  market, bargain, replacement, and learn-move tests invoked captured callbacks or sent raw choices before
  their public handler had installed the immutable predecessor control. The production ledger correctly
  rejected those impossible browser orderings with `authority-local successor reservation refused`.
- The shared party-reward driver now traverses the real MODIFIER_SELECT and PARTY handlers via public input.
  Ability Capsule, biome market, Giratina bargain, both sides of a double replacement, and guest-owned
  learn-move coverage likewise wait for their exact actionable surface and submit through the production UI
  adapter. No fixture can false-green by bypassing the UI-to-relay/V2-lease chain in these paths.
- The guest learn-move probe now retires COMMAND legally, consumes the host's immutable prompt in a real
  `CoopReplayLearnMovePhase`, and chooses the forgotten move through SUMMARY. Unidentified pre-buffered raw
  proposals are no longer treated as valid Authority V2 behavior.

# 2026-07-24 - Bargain readiness is an exact V2 control edge

- Focused run `30057944792` kept static, A1, and all eight Showdown shards green. Its B1 evidence separated
  five migrated-fixture defects from one live interaction fault: Giratina's Bargain made its owner handler
  visible during a 600 ms carried-input guard, while the replica never rendered the immutable offer. Neither
  side could therefore publish the exact actionable/active surface needed for `controlInstalled`, and the
  UI gate rejected every owner keypress that might otherwise have advanced it.
- The Bargain now renders the same host-authored immutable offer on both clients. The watcher receives no-op
  mechanics callbacks, so mirrored cursor presentation cannot mutate local state; only the owner retains the
  real callbacks. The handler's existing debounce is now part of `isCoopV2InputActionable()` and publishes
  its false-to-true edge against the exact owning runtime, with generation checks and teardown cancellation.
- The B1 exploration probes now traverse the real reward, market, double-replacement, learn-move, and Bargain
  controls instead of calling captured callbacks or asserting suppressed legacy echoes. The two LEG2 Mystery
  variants likewise submit through the retained public helper rather than manually constructing raw relay
  traffic. Local Biome and diff checks are clean; the branch-focused remote matrix owns runtime verification.

# 2026-07-24 - Reward results resume under their phase-owned runtime

- Audit and B3 fault evidence identified a product ownership race after a guest-owned reward proposal: the
  host watcher decoded the terminal action after an asynchronous relay wait, but ambient runtime state could
  belong to the guest when it decided whether to commit. Proposal retention/deduplication then worked while
  the one authoritative result was silently never created.
- Reward option adoption, owner-screen reopening, watcher result application, guest result projection, and
  both material-barrier outcomes now re-enter the runtime and scene captured by the exact reward phase. A
  rebound scene or replaced phase is dropped explicitly; no post-network continuation may rediscover its
  authority from the other in-process client or a replacement session.
- Exact-SHA focused run `30058835013` on the preceding tip kept static, A1, and its selected Showdown shard
  green. It reduced B1 to five independently classified migration failures; B5 now names six Mystery fixture
  failures plus four reward sub-picker terminals, and P1 isolates one legacy transition driver parked in
  `CoopReplayTurnPhase`. These remain red and are not being treated as release evidence.

# 2026-07-24 - Entry presentation is proved before command control opens

- The retained turn-one entry path previously queued ability, weather, terrain, stat, switch, and Tera cues,
  immediately advanced the shared render watermark, and ended into CommandPhase. Unlike ordinary turn replay,
  it never inspected the concrete presentation outcome tokens, so a failed/watchdog-expired ability flyout
  could still authorize player input.
- `CoopFinalizeEntryPresentationPhase` now drains last on the same phase-tree level, inspects every concrete
  outcome, and only then advances the exact wave/turn watermark and releases the queued command surface.
  Pending or failed outcomes emit a correlated shared authority failure; a replaced runtime cannot terminate
  or mutate its successor session.
- Failure-first engine coverage proves rendered prefixes advance exactly once while pending/failed prefixes do
  not advance or end. The static architecture guard now forbids direct post-queue watermark advancement and
  was repaired to follow the current outcome-token, actor-aware switch/Tera, and browser-ledger APIs; all 11
  source-contract checks pass locally. Co-op engine execution remains hosted-only per `AGENTS.md`.

# 2026-07-24 - Presentation liveness and turn capture stay bound to their authority runtime

- Presentation watchdogs now capture the exact scene, stream, and session generation that armed them. Their
  checks use the stream's injected wall-clock scheduler rather than Phaser's scene clock, so a paused or
  destroyed renderer cannot also pause its own liveness deadline; callbacks from replaced runtimes/scenes are
  retired without touching the successor session.
- `CoopTurnCommitPhase` now separates legitimate guest/solo exits from an authoritative host failure. A host
  that reaches the immutable commit boundary without its recording broadcasts a correlated turn failure and
  keeps progression closed; an orphaned valid recording in a shared mode likewise enters shared-terminal
  handling instead of silently becoming local mechanics.
- Failure-first engine cases cover host fail-close and guest no-op behavior, while the static architecture
  suite forbids the old umbrella early return; all 13 source-contract checks pass locally. Exact-SHA focused
  run `30060087357` for the preceding entry-proof commit was a planner refusal (six affected shard candidates
  exceeded its five-shard cap), not a runtime red; its public-browser journey remains queued separately.

# 2026-07-24 - Protocol 47 closes transient presentation identity fallback

- Exact-SHA focused run `30060653934` proved the preceding watchdog/turn-capture batch in static, A1, B13,
  and Showdown S4. Its sole red, P1, is the already-classified three-round Mystery fixture parked in
  `CoopReplayTurnPhase`; the production-fidelity soak in that lane remained green.
- The live wire now advertises `er-coop-47`. Every identity-bearing battle event requires immutable side +
  Pokemon ID material, move targets are emitted only as aligned battler/actor pairs, and Showdown reflects
  both the coordinate and stable identity. Protocol-46 cached clients therefore cannot pair and silently
  restore the old battler-index fallback.
- V2 replacement material now carries the replacement seat side through commit construction and strict
  decoding. All synthetic presentation fixtures were migrated to the current wire shape; missing actor or
  target-identity material is covered as malformed authority rather than a replay fallback.
- Public journey `30060653903` on the preceding tip stopped in a stale source-regex contract after the entry
  finalizer renamed its queued log. The contract now proves both queueing and the new outcome finalizer/proof
  instead of requiring the retired `installed` text; no browser process had started in that failed run.

# 2026-07-24 - Retired move targets are omitted at the recording boundary

- Public two-browser evidence on both seat orientations reproduced a deterministic presentation terminal:
  a target fainted and left the Phaser field, then a later queued `moveUsed` event retained that party object
  and serialized its immutable id. The renderer correctly rejected the now-absent target as
  `move-target-not-displayed`.
- `MovePhase.showMoveText()` now omits a target when its exact object is no longer a member of the displayed
  field. Failure-first B13 run `30063910939` observed the stale `[2]`; focused qualification
  `30064368046` is fully green, including the exact regression and all selected static/Showdown coverage.
- Exact-SHA two-real-browser run `30064059318` is still active against the production fix. Its result owns
  the claim that the public turn-2 frontier is repaired; do not infer browser success from the engine shard.

# 2026-07-24 - Batch learn fixtures cross the real V2 input boundary

- B11 showed both batch-learn cases inspecting the replica after one transport drain: the immutable prompt
  was admitted and material-applied, but its queue-owned panel had not completed `setMode` or
  `controlInstalled`. That was an impossible human-input schedule, not evidence for weakening projection.
- The fixture now makes the host batch phase the real current phase, alternates both destination runtimes,
  requires both exact active handlers, and verifies the owner's V2 input lease before pressing public UI.
  Local Biome and diff checks are green; runtime verification remains hosted-only per `AGENTS.md`.

# 2026-07-24 - Revival Blessing fixture uses the public PARTY surface

- The remaining Revival Blessing owner-pick fixture replaced `ui.setMode` and invoked the PARTY handler's
  private completion callback while the V2 projection was still being installed. That schedule could not be
  produced by a player and bypassed the exact input lease the test was meant to prove.
- The fixture now alternates both destination runtimes until the immutable REVIVAL entry has installed the
  real current `CoopGuestRevivalPhase`, active/actionable PARTY handler, and guest-owner input lease. It then
  navigates to the intended fainted party member and chooses Revive solely with ordinary public key input.
- Local Biome and diff checks are green. The focused B11 runtime proof will run on hosted Actions only.

# 2026-07-24 - Headless V2 surfaces reproduce the production scheduler edge

- Focused run `30064735002` showed that the first batch migration correctly refused premature input but
  never emitted its interaction entry. Both headless phase schedulers deliberately replace
  `PhaseManager.startCurrentPhase`; `overridePhase()` therefore established the right current object without
  invoking its `start()`. Production does invoke that scheduler edge.
- Batch learn and Revival Blessing now start only the already-installed current V2 phase once, tracked by
  object identity. They still cannot construct a detached surface, replace `setMode`, or call a private UI
  completion callback. Batch input is split into two accepted public key presses with a destination pump
  between them so the UI -> relay -> authoritative result chain is observable.

# 2026-07-24 - Stale audit reconciliation and public biome fixture cutover

- The audit anchored at `22e047ca5` remains useful only as a hardening-debt register. Its P0 reward watcher,
  protocol-47 identity, entry-presentation proof, runtime-owned watchdog, turn-commit fail-close, and B2
  target-consumption findings are closed on this line. Its production mutation-ledger, bounded immutable
  history, side-effect-free extra-enemy removal, and invalid-enemy recovery findings remain source-valid.
- Focused run `30065201578` proves the batch-learn migration worked: both batch failures disappeared while
  static and Showdown S1 stayed green. B11 now has ten failures: five stale biome-choice schedules, the
  automatic-victory SwitchSummon renderer crash, enemy-switch/half-wipe downstream frontiers, Revival
  entering after a contaminated Title state, and one obsolete wave-terminal expectation.
- The Crossroads and world-map production-facing cases no longer construct detached phases, replace
  `setMode`, capture option callbacks, pre-arrive one side, or press before control installation. They now
  retire the synthetic command predecessor, install the exact current phase on both engines, reproduce the
  deliberately-inert headless scheduler edge once, wait for both real handlers plus the owner's V2 input
  lease, and use only public `Button` input. Authority-loss and orphan probes now begin from the same paired
  projected ER_MAP surface before faulting the result path.

# 2026-07-24 - Biome duo frames run under their destination browser context

- Exact-SHA public journey `30064059318` is green. Its final host/guest screenshots were inspected: both
  render the same Town wave, Chikorita/Endivie ally pair, and Pidove/Abra opponents; the apparent labels and
  species-name differences are the intentionally mixed English/German localization and seat perspective.
- Focused run `30065825747` kept static and Showdown S2 green and confirmed the five biome cases reached the
  real owner handler. Their watcher remained in MESSAGE because the one-process loopback resumed reciprocal
  rendezvous callbacks while the sender's `globalScene` was installed. That schedule cannot occur between
  browser processes and is the same destination-context class already documented by the duo harness.
- Paired Crossroads and natural-map fixtures now enable destination-context delivery before either phase
  starts. Every control/rendezvous frame is therefore applied only while `pumpDuoDestinations` has installed
  the receiving scene, runtime, operation state, and module-let snapshot together; public handler and input
  assertions remain unchanged.

# 2026-07-24 - Trainer presentation damage cannot strand SwitchSummon

- Focused run `30066471551` confirms the destination-context repair: ordinary Crossroads Stay and the
  authority-loss map case are now green, reducing B11 from eleven failures to nine while static and Showdown
  S7 remain green. The surviving biome reds now reach their public surfaces and expose narrower successor,
  orphan, and legacy-carrier contracts instead of false watcher-start failures.
- The automatic-victory journey still reproduced a wave-1 hard exception in `BattlePhase.showEnemyTrainer`:
  after both enemy leads fainted, a reserve `SwitchSummonPhase` indexed a missing positional trainer layer
  and wrote `.x` on `undefined`. A cosmetic Phaser child therefore stranded the mechanical phase forever.
- Trainer reveal now treats each main/tint child as a recoverable presentation layer. Every surviving layer
  is positioned and revealed, an exact missing-layer diagnostic is emitted, and the authoritative queue is
  allowed to continue to its next checkpoint instead of softlocking. The same ten-wave production-fidelity
  journey remains the remote regression and will identify the upstream missing layer in its next artifact.

# 2026-07-24 - V2 biome results no longer wait on a legacy relay twin

- B11's public Crossroads Leave path exposed a real dual-authority race. The immutable `BIOME_PICK` reached
  the replica and published its exact journal receipt, but `SelectBiomePhase` still waited for an
  `interactionChoice` compatibility twin before reading that receipt. A fast owner could therefore commit
  while the renderer was opening ER_MAP, leaving the V2 entry retained at `materialDeferred` behind a
  pre-waiter legacy FIFO entry.
- Commit-required Crossroads and map watchers now wait directly on their immutable operation receipt. Under
  the negotiated V2 cutover, biome materialization publishes only that receipt and no longer buffers a
  second raw choice; the old relay wait remains solely on the legacy fallback path.
- Two harness assertions were also corrected without weakening coverage: destination-addressed orphan
  delivery pumps the receiving client, and the raw-carrier probe observes actual transport frames rather
  than treating invocation of the production suppression seam as a network send.

# 2026-07-24 - Reused Phaser suites retire both destination runtimes

- P2 run `30066807301` failed only tests 2, 7, and 12 before those tests constructed their own duo. Each
  inherited a peerless `CoopReplayTurnPhase` from the preceding fixture because `clearCoopRuntime()` can
  dispose only the ambient destination; toggling module-let isolation could leave its partner registered.
- The duo harness now exposes one idempotent all-rig teardown, and the long biome-transition suite invokes
  it before each reused-scene bootstrap and before disabling destination isolation. This preserves the same
  production two-process lifetime while preventing a completed test's runtime from manufacturing a softlock
  in the next case.
- P2 exact-SHA rerun `30067284356` proved explicit runtime disposal alone was insufficient: the same three
  every-fifth cases still inherited a replay phase. Existing raw-timeout closures and Phaser delayed events
  retained their destination-context wrapper after the rig registry was cleared. Every pinned callback now
  carries a rig-lifetime fence, old scene clock events are removed during teardown, and an outstanding
  interceptor cannot start another phase after disposal.

# 2026-07-24 - Enemy structural projection is mechanics-free and fail-closed

- The stale audit's two residual enemy-adopter findings were still source-valid. Truncating an extra local
  wild slot called `Pokemon.leaveField()`, allowing pre-leave abilities and form mechanics to run on the
  renderer, while an undecodable authority identity preserved the guest's locally rolled opponent.
- Structural replacement and truncation now share one direct Phaser-container removal primitive that never
  enters battle mechanics. An immutable enemy identity that cannot be reconstructed synchronously freezes
  the shared membership and enters the retained terminal transaction instead of continuing with local
  derived state.
- Engine regressions cover both invariants: no `leaveField` call for an extra display child, and immediate
  terminal fencing for an authority blob without a reconstructable species identity.

# 2026-07-24 - Turn capture uses a runtime-owned mutation ledger

- Each assembled co-op runtime now owns an independent mutation ledger. PhaseManager acquires one labelled
  token immediately before every real phase start and releases it only when that exact phase leaves the
  scheduler, including async/UI-interrupted phases and modal predecessors. The headless PhaseInterceptor
  crosses the same production hook instead of bypassing it.
- `CoopTurnCommitPhase` requires zero active tokens and an unchanged ledger generation across complete
  carrier serialization. The historical six-phase scan remains diagnostic only; it no longer owns the
  fully-settled invariant. The V2 adapter also receives the real pending-token count as defense in depth.
- Node-pure ledger coverage proves idempotent settlement, destination-runtime ownership, and teardown
  invalidation. Engine failure-first coverage proves an active callback token produces a correlated shared
  terminal and emits no partial turn image. Hosted co-op shards remain the required runtime qualification.

# 2026-07-24 - Completed battle authority compacts to bounded tombstones

- Guest turn and replacement admission now retain complete immutable payloads only while their staged
  material, presentation, or continuation transaction can still perform work. `continuationReady` compacts
  each payload to `{address, revision, operationId, digest}` in a bounded 64-entry per-boundary window.
- A monotonic retired-through `(epoch, wave, turn, revision)` frontier permanently rejects older carriers
  after their tombstone ages out without conflating equal state revisions at different wave addresses.
  Identical carriers still inside the window re-ACK without replay; conflicting bytes still enter the shared
  fatal contract. Active, unretired admission is capped at the existing authority-retention limit.
- Failure-first stream coverage drives 66 completed turns and 66 completed replacements, proves retained
  history stays bounded, proves aged-out frames cannot reopen, and proves both in-window replay and conflict
  behavior. Host-issued failure-authentication keys are now bounded tails as well. A repeated newer wave
  proof can republish a compacted replacement's exact final ACK from its bounded tombstone/evidence pair,
  without retaining or resurrecting the full checkpoint.
# 2026-07-24 - Exact B1 evidence separates public control from one-process scheduling

- Exact-SHA gate `30079308415` confirmed the production-fidelity P1 red was only a mis-imported
  rendezvous timeout seam; the test now imports it from `coop-rendezvous`, matching every other transition
  suite. The same run kept fast V2 contracts, mutation assurance, and the completed S shards green.
- B1's market probe no longer equates a visible BIOME_SHOP handler with usable human control. It now waits
  for the handler's public actionability and the exact V2 input lease before sending ordinary grid keys.
- The Giratina probe latches the exact projected phase returned by the V2 queue driver and waits for both
  owner and watcher surfaces; it can no longer miss a real projection merely because owner readiness wins
  the first polling round.
- The double-KO replacement tail now switches to destination-addressed scheduled delivery before either
  replacement commit closes a modal. Its old synchronous loopback resumed a guest MESSAGE transition while
  the host process-global context was installed, an impossible two-browser schedule that correctly caused
  the production boundary fence to terminate the synthetic session.

# 2026-07-24 - B1 drives real transition time and the correct Bargain V2 result lane

- Exact-SHA gate `30079891780` proves static, fast V2 contracts, browser bundle, the corrected 2-second P1
  budget, and Showdown S6 green. B1's three remaining failures were inspected from their exact host/guest
  logs; T4 remains the inherited Elite Redux ghost/triples roll-test debt owned by the aggregate repair train.
- BIOME_SHOP was already mechanically correct but its test performed 80 relay-only zero-delay pumps while
  the real 250ms fade plus 100ms Phaser hand-off had not run. The probe now holds each independent client
  context across that real visual transition before demanding an actionable V2 input lease.
- The double-KO log proved the guest chose Charizard and the host accepted the exact addressed choice, then
  the one-process fixture let the guest modal-close promise resume after leaving the guest context. The
  probe now keeps the guest browser installed while pumping the host authority and the returning terminal,
  so the production boundary fence is tested under a schedule two separate browsers can actually produce.
- The Bargain failure contained one real V2 lane bug: a guest watching a host-owned offer called the
  authority-only proposal waiter and therefore failed closed immediately instead of awaiting the committed
  result materialized by the V2 log. Host watchers still consume guest proposals; guest watchers now await
  the ordinary committed-result FIFO. Its armed legacy-outcome detector now requires zero transport sends,
  proving convergence uses only the immutable entry rather than passing because a compatibility twin won.
  The test also observes the real phase-manager departure because the
  production owner terminal deliberately calls `super.end()` and cannot be intercepted by overriding
  `phase.end` on the fixture instance.

# 2026-07-24 - Exact B1 follow-up binds transition tails to their owning runtime

- Exact-SHA gate `30080760906` reduced B1 from three failures to two and proved the Bargain V2-only path
  green with zero legacy fault injection. Its remaining market and double-KO artifacts were both
  one-process destination-context schedules, not weakened authority or missing immutable material.
- The market test previously staged both browsers before either mock-Phaser delayed hand-off finished,
  then waited under each context after the promise continuation had already captured the wrong ambient
  runtime. Each real phase now keeps its owner installed for the timer and microtask tail before the other
  browser is staged; the 1.3-second blanket sleeps are removed.
- `CoopGuestFaintSwitchPhase` now reactivates its captured runtime around the asynchronous MESSAGE-close
  continuation, matching the existing host replacement fence. Generation, runtime identity, phase token,
  wave, and turn remain mandatory; the change does not loosen the fail-closed material boundary. In two
  actual browsers this is a no-op, while the duo harness can no longer terminate a valid guest picker merely
  because the host was ambient when the shared JavaScript microtask ran.

# 2026-07-24 - Exact B1 evidence closes the internal transition-predicate schedule

- Exact-SHA gate `30081518757` showed both residual B1 failures reached their intended public surfaces, but
  the market's real 350ms Phaser transition had not completed within the attempted 25ms owner hold and the
  replacement UI's internal bounded predicate still consulted the peer-ambient runtime before its fenced
  promise tail could reactivate the guest.
- The market fixture now holds each owner across the already-proven 650ms transition budget before staging
  the peer. The replacement transition separately distinguishes captured-scene material presence from the
  runtime identity required to mutate: generation, exact phase token, wave, and turn fence the UI promise;
  its continuation then re-enters and requires the captured runtime before settlement or phase shift.
- No authority, successor, timeout, or failure policy was relaxed. This is the same schedule as two isolated
  browser realms, expressed explicitly in the single-realm engine harness.

# 2026-07-24 - Market coverage uses the real phase-manager boundary

- Exact-SHA gate `30081880339` proved the replacement correction: double-KO and all twelve other active B1
  probes passed. Its only red was the market fixture, whose helper constructed a detached `BiomeShopPhase`,
  manually called `start()`, and monkeypatched the phase's production liveness check to always return true.
- The central V2 projector correctly refused to install human control for that impossible state because the
  phase manager still owned another phase. The helper now clears the synthetic tail, queues the real market,
  shifts it into the current slot through `PhaseManager`, and asserts object identity before public UI input.
  No production check is bypassed; the test now covers the actual UI -> phase -> projector -> relay chain.

# 2026-07-24 - Final aggregate reds are classified at their real ownership boundary

- Exact gate `30082231271` made B1 fully green, including all real market, Bargain, and double-KO public
  chains. B5 then exposed two impossible reward-subpicker cadences: the old helper treated semantic
  `PartyOption` values as cursor counts and skipped DNA Splicer's two explicit confirmation steps. The
  helper now sends only public party inputs after each actionable sub-surface is observable.
- C3 proved `dexSync` reached the guest's validated interaction relay but never reached the account merger.
  The account-only carrier was split across a runtime-owned relay plus a second module-global transport
  listener. It is now applied directly at the relay's exact address/payload/remote-authority boundary and
  bound to the captured guest runtime, removing the one-process receiver seam without putting account
  telemetry into the mechanical V2 log.
- B7 caught one real fail-closed gap: a missing species identity could match an existing local enemy because
  the structural projector compared the local roll before invoking the strict builder. Species identity is
  now validated before any compatibility match; invalid authority synchronously freezes membership and the
  phase manager. The adjacent structural cleanup assertion now checks authoritative identity and visible
  projection instead of deep-comparing Phaser renderer internals.
- T4 remains unrelated pre-existing Elite Redux ghost/triples probability debt. It does not touch co-op or
  Showdown mechanics and is intentionally left to its existing owner under the staging false-red policy.

# 2026-07-24 - The aggregate exposes a missing ordered Bargain projection and the real fusion-preview cadence

- Exact gate `30083386840` reached the post-turn Giratina boundary with revision 3 admitted and its complete
  `BARGAIN_PRESENT` material applied, but the guest remained parked in `CoopFinalizeTurnPhase`. Ordinary V2
  delivery had a decoder and recovery constructor for Bargain while its live projector still returned false,
  implicitly waiting for the pure renderer to reproduce the authority's local event schedule. Bargain is now
  projected behind that exact settled-turn fence and may release it only with the source entry's verified
  successor claim; handler readiness still owns `controlInstalled`.
- B5's DNA-Splicer failure was the opposite category: the production fusion-preview UI intentionally fuses
  when ACTION selects the partner, so there is no later SPLICE option menu. The public test driver now sends
  the real three confirmations (base, APPLY, partner) instead of waiting for a nonexistent fourth input. That
  stale wait had left the completed PARTY surface mounted and caused the later shared-process fixture cascade.
- The focused-gate manifest now advances its integration-batch base on every push as required by
  `docs/coop-task-ownership.md`; run `30083562237` proves the previously noisy self-train ownership gate green.

# 2026-07-24 - Public Showdown installs lockstep before capability negotiation

- Real-browser Showdown run `30083388351` reached wave 1 but stranded the guest after the host's first
  voluntary switch. Its trace showed the public title route selected Showdown while `connectCoopSession`
  still logged `netcode=authoritative`, negotiated the full Authority V2 capability set, and deferred the
  guest's command-open commit because no V2 engine consumer exists in Showdown's dual-engine flow.
- The route constant was already correctly `lockstep`; the bug was ordering. The P33 and legacy connectors
  constructed and connected the runtime (sending the opening hello) before `TitlePhase.onConnected` mutated
  the controller. Netcode and session kind now travel through the lobby and connector into runtime assembly,
  before capability advertisement or any transport frame. The late mutation is deleted and replaced by a
  fail-closed route/runtime assertion.
- Legacy and authenticated P33 lobby contracts both prove that `lockstep` plus `versus` reaches the connector
  in its construction options. The fix changes launch wiring only; no Authority V2 mechanical rule is
  weakened and ordinary co-op continues to construct as `authoritative` plus `coop`.

# 2026-07-24 - Public Mystery tests and Showdown evidence follow the active authority model

- Exact gate `30084867160` proves the static, public UI/Authority V2 contracts, mutation shards, sealed
  browser bundle, browser-native WebRTC/rejoin, and the large majority of A/B/C/P/S/T lanes green at
  `3b5ee4432`. B5/B9/B10/B11 remain evidence-bearing reds; T4 remains the separately owned Elite Redux
  ghost/triples probability debt.
- B5's first Mystery failure was a test-authority violation: the shared helper called the active handler
  directly while `ME_PRESENT` had not installed an actionable V2 control lease. The UI mutation therefore
  bypassed the freeze/relay chain and the following `ME_TERMINAL` correctly failed closed when it could not
  reserve the promised successor. All Mystery navigation now enters through public `UI.processInput`, and
  the alternating-realm replay helper crosses the production handler's one-second unblock/readiness edge
  before guest-owned input. This tests UI -> lease -> relay -> V2 commit instead of manufacturing local state.
- Two-browser Showdown run `30084868893` proves the launch fix: both seats negotiate `netcode=lockstep`,
  reach wave 1, exchange voluntary-switch commands, render identical switched-Arcanine ability material
  (`abilityId=22`), and continue through the resulting stat change. The red was an obsolete oracle predicate
  that still required the guest's authoritative-co-op `CoopShowAbilityReplayPhase`; lockstep correctly runs
  ordinary `ShowAbilityPhase` on both engines. The oracle now requires that ordinary phase on each seat and
  retains its exact payload, presentation-ledger, and before-command ordering comparisons.
- The branch-wide typecheck still reports the repository's known unrelated baseline. It reports no error in
  any file changed by this batch; owned-file formatting and `git diff --check` remain clean.

# 2026-07-24 - B5 Mystery durability migrates from the retired journal to Authority V2

- Exact full gate `30086274421` left five B5 failures in `coop-duo-me-operation`. Four asserted mechanisms
  intentionally removed by the V2 cutover: dropping a legacy `envelope`, failing the independent durability
  journal, and releasing progression through `notifyOperationContinuationSurface`. The fixtures now fault
  the exact `INTERACTION_COMMIT` authority entry or `controlInstalled` receipt, advance the deterministic V2
  lease clock, and require immutable revision/operation redelivery plus exactly-once material application.
- The guest-owned narration proof now observes the exact ME_PICK `controlInstalled` receipt instead of a
  legacy `sharedInput` continuation. Its remaining end-to-end assertions still require both real engines to
  reach the next public command surface with lockstep counters.
- The battle-handoff red was a one-process scheduling artifact with direct evidence: revision 2 arrived while
  revision 1's receipt callback was executing under the guest's ambient scene, then the guest-only drain loop
  never let the host publish the successor. The test now uses the existing destination-context scheduler and
  pumps both real client contexts until the retained ME_PRESENT -> ME_PICK -> ME_TERMINAL chain settles.

# 2026-07-24 - Mystery integration drivers keep both Authority V2 event loops alive

- Exact B5 run `30087618381` proved every migrated packet-loss fixture crossed the V2 entry/receipt seams;
  three stopped only after the ordered terminal handed control to the guest's real PostMysteryEncounter tail,
  and the battle handoff exhausted the old immediate 16-drain guest-only loop. The canonical duo driver now
  alternates complete host and guest destination contexts until each receipt-triggered successor publishes,
  then drives the real queued final-leave continuation with the same bounded two-browser pump.
- B5 and the B9 Mystery/battle-reward fixtures use that shared driver instead of assuming all retained entries
  were already buffered before the guest ran. This models two independent browser event loops and preserves
  the existing fail-loud phase/timeout diagnostics; it does not add a production bypass or synthetic result.
- Authority V2 commits now retain the public UI -> operation trace edge before returning around the deleted
  `op:global` journal path. The Hot Spring contract therefore proves its real `UI.processInput` reaches an
  `op:me` V2 commit, rather than looking for a raw `interactionChoice` carrier the cutover suppresses.

# 2026-07-24 - Real two-browser wave-one faint replay exposed a blocked renderer prompt

- Exact public-UI run `30086203224` reached a real fresh two-browser battle, then timed out with the host at
  turn 2 and the guest still at turn 1. The guest had admitted `TURN_COMMIT` revision 2 but left its material
  pending; the following replacement entry arrived as a revision gap. This is a production-reachable
  softlock, not a campaign-oracle or shared-process harness failure.
- The causal phase trace ended in the guest's localized faint `MessagePhase` with `awaitingActionInput=true`
  while authoritative renderer input was correctly blocked. `coopNarrateFaint` had incorrectly passed
  `prompt=true` to `queueMessage`, so no legal public input could dismiss the cosmetic narration and finish
  the turn material.
- Guest faint narration now uses an ordinary auto-dismissing message. The localization regression captures
  the real queue call and requires the faint line to remain guest-localized while never requesting an ACTION
  prompt. No authority, timing, or input gate is relaxed.

# 2026-07-24 - Mystery lifecycle surfaces eagerly resume their already-admitted V2 entries

- Focused B5 run `30089029513` reduced its exact red to four cases in one Mystery file. Three reached the
  guest's real `PostMysteryEncounterPhase` with the final `ME_TERMINAL` already parked at
  `materialDeferred`; the battle-handoff case reached the real `MysteryEncounterPhase` after `ME_PRESENT`
  had already materialized. Both surfaces were correct but waited for a later authority retransmission
  before revisiting the central projector.
- Both phase-start boundaries now issue the existing eager V2 retry/projector signal. The replica ledger
  still owns ordering, deduplication, material application, and control proof; the authority log still owns
  retention. The wake only removes network-backoff timing from a real engine surface that has just become
  actionable, matching the established command, wave, and interaction proof-edge pattern.

# 2026-07-24 - V2 wave material waits for the started BattleEnd release boundary

- Exact C1 journey `30089977550` played through wave 35 before the guest parked forever on
  `BattleEndPhase` while the host opened the reward shop. Revision 197's immutable wave state had applied
  and the V2 frontier reached `197/197/197`, but the expected `GUEST retained WAVE_ADVANCE BattleEnd
  release wave=35` edge never occurred; the next retry reported that the already-completed transaction was
  missing.
- The authority redelivery arrived after PhaseManager exposed `BattleEndPhase` as current but before that
  phase's `start()` installed `pendingSettledWaveBoundary`. The material applier trusted the class name,
  applied and retired revision 197, and its no-op release found no callback. The later real phase then held
  against a transaction that could no longer wake it.
- Wave DATA now requires both the exact BattleEnd phase/wave and its runtime-owned source-wave release
  callback before material application. The terminal finalizer retains its separate exact proof. A public
  Authority V2 contract pins that ordering so a queued-but-not-started phase can never again consume and
  retire its own wake source.

# 2026-07-24 - Crossroads replica control no longer re-derives authority from a speculative battle

- Exact B11 evidence showed the replica had admitted and materialized the host's Crossroads CONTROL_COMMIT
  at wave 5, while its renderer had already exposed the speculative wave-6 battle. The Crossroads boundary
  nevertheless compared the local ambient battle to wave 5 before consulting the V2 ledger, failed the
  session, and left the watcher on Title. The replica now validates the immutable control address directly
  against its materialized global ledger; only the authority must capture an exact current-wave state before
  authoring a new control.
- The adjacent biome-operation fixture no longer expects independent legacy surface cursors to accept raw
  watcher choices after the V2 cutover. It retains the useful captured-runtime role fence in both directions;
  public UI and durability tests in the same file continue to prove real V2 adoption.

# 2026-07-24 - Half-wiped seats retain an explicit Authority V2 replacement head

- B11's real two-engine half-wipe reproduced a production fail-closed terminal: the turn successor withheld
  COMMAND because the engine would run SwitchPhase, then the replacement resolver omitted that same phase
  because the fainted seat had no same-owner bench. The phase correctly staged an explicit null selection,
  but no REPLACEMENT head existed for its checkpoint commit.
- Replacement extraction now follows the engine boundary: when the shared side has any living off-field
  reserve, every fainted human seat receives an ordered replacement address. A wiped owner can therefore
  commit the typed empty-slot result; when the whole side has no reserve, no transaction is invented because
  SwitchPhase is skipped. Node-pure contracts pin both sides of this distinction.
- The enemy-switch renderer fixture now proves the guest's real next command boundary before asking the host
  to cross the trainer send-out. Its render/checksum assertions are unchanged; the edit removes a synthetic
  one-process scheduling assumption already absent from the stronger trainer-mirror fixture.

# 2026-07-24 - Biome receipt continuations resume on their bound two-engine runtime

- Exact B11 evidence showed the Crossroads result was admitted, materialized, and published into the guest's
  live biome journal, yet the guest counter never advanced and the V2 result stayed `materialDeferred`.
  The receipt promise had resumed while the host was the process-global active engine, so the guest phase read
  the host scene and silently rejected its own still-live boundary.
- Crossroads and World Map receipt consumers now schedule every post-await boundary check and terminal apply
  back onto the runtime captured by the phase. The map teardown continuations use the same fence before they
  install the selected biome or release the retained receipt. Single-browser production remains synchronous;
  the change removes only shared-process scheduler order as a source of false liveness decisions.
- The existing real two-engine biome-choice scenarios remain the failure-first coverage. No legacy relay,
  timeout, authority bypass, or synthetic result was added.

# 2026-07-24 - Half-wiped replacement commits prove their non-interactive V2 control

- Exact B11 diagnostics showed the new half-wipe REPLACEMENT head existed and its explicit null result was
  staged, but the authority log refused that result because no PARTY picker had installed the predecessor.
  Opening a picker would be incorrect: the owning seat has no legal same-owner reserve and the menu cannot
  be completed or cancelled.
- The global control ledger now has a dedicated automatic-replacement proof which never grants human input
  and cannot replace an existing picker proof. The authority runtime accepts it only from the exact current
  SwitchPhase, at the immutable replacement address, after independently rechecking the owner's full bench.
- SwitchPhase installs that proof before retaining its typed empty-slot result. Normal selectable
  replacements still require the existing exact PARTY phase/handler proof; Showdown and Tournament paths
  are unchanged.
- Full-gate static run `30093196764` found one narrow TypeScript cast-overlap diagnostic in the phase-token
  read. The token is deliberately opaque at the ledger boundary; the explicit `unknown` bridge now records
  that intent without weakening any runtime predicate.

# 2026-07-24 - B11 fixtures follow the completed Authority V2 boundary

- Exact gate `30093196764` proves the half-wipe fix: the former replacement hang is green and the node-pure
  automatic-control contract passes. Its remaining B11 reds sampled legacy or impossible fixture states.
- The retained-terminal test now supplies an actually later settled turn. The biome public-input probe
  observes the immutable `INTERACTION_COMMIT` wire entry instead of a compatibility receipt that is released
  after V2 retirement, and the chained Crossroads journey lets both receipt continuations install before it
  samples the replica pin.
- Revival Blessing now crosses the guest's real command/replay boundary before the mid-turn picker, so the
  final turn material has a live consumer. The trainer-switch render probe removes the replica reserve before
  command authority is authored instead of corrupting it after projection; its visible-field, exact identity,
  checksum, and zero-resync assertions remain unchanged.

# 2026-07-24 - B10/B11 journeys retain real browser event-loop and public-control semantics

- Focused B11 run `30094170734` reduced the shard to two evidence-bearing failures. The World Map watcher
  had admitted its immutable BIOME_PICK but the fixture spun only transport microtasks while the real
  setMode/timer continuation remained pending. The journey now keeps the watcher browser's timer queue alive
  until its exact SwitchBiome projection appears; the chosen-biome and single-terminal assertions are unchanged.
- Revival Blessing admitted and applied the guest owner's REVIVAL result, then left its projected PARTY phase
  current while the fixture advanced only the host. The test now uses the destination-scheduled transport,
  proves the initial guest command even when both mirrored battle addresses already match, waits for the real
  picker to close, and settles host resolution while pumping both browser contexts.
- The B10 feasibility, heavy-faint seating, and party-transposition fixtures no longer inject synthetic guest
  command authority or author an impossible WAVE successor directly from REPLACEMENT. They drive public
  COMMAND/FIGHT/PARTY/TARGET handlers, use the real ordered replacement and battle-end boundaries, and keep
  automatic scheduled delivery boot-only so no guest callback can execute against the host's global scene.

# 2026-07-24 - Trainer-switch fixtures cross public command controls

- The B8 trainer mirror and rapid enemy faint-chain tests no longer wire a synthetic guest command responder
  or inject host moves through `game.move.select`. Each turn now drives both engines' real COMMAND/FIGHT/TARGET
  handlers, preserving the asymmetric KO/hold targets while exercising the same relay and V2 frontier as players.
- The shared public driver accepts captured move slots or MoveIds and navigates the real two-column fight menu
  with directional input. Existing Tackle callers remain unchanged; replay and trainer tests can cover arbitrary
  move positions without reinstating a direct engine shortcut.

# 2026-07-24 - B10 replay and replacement fixtures use real ordered controls

- Full-gate run `30096737312` proved the Roar/flee production fix end-to-end: the guest admitted and applied
  the exact WAVE_ADVANCE, released its real BattleEnd boundary, and reached wave 2. Its remaining red was an
  obsolete assertion that expected the already-completed wave transaction to remain unready until the separate
  next COMMAND control opened; the test now asserts that COMMAND cannot regress completed readiness.
- The party-transposition fixture no longer increments the guest turn or creates a replay waiter for a host
  result that does not exist. It follows the projected replacement's ordinary TurnInit -> guest CommandPhase
  successor, preserving the exact V2 graph under test.
- Trace replay no longer answers the guest relay directly or calls `game.move.select`. Both captured moves are
  navigated through the real COMMAND/FIGHT/TARGET handlers, including nonzero move slots and either enemy target.
  Unsupported Phase-1 command kinds fail loudly instead of silently substituting a move.
- A window checkpoint is now installed before the real SummonPhase runs. Its reconstructed Pokemon are therefore
  actually seated in `scene.field` when the first V2 frontier is captured; the old post-Command party splice
  produced zero presented actors and was correctly rejected by Authority V2.

# 2026-07-24 - Staged flee/capture turns and destination-scene continuations stay in the V2 graph

- Focused run `30095336690` made the remaining mechanisms exact: B10 reached 50/57 with the full heavy-faint
  replacement journey green, while B11 reached 65/68. The residual reds were no longer broad architectural
  unknowns; each retained its immutable entry and stopped at one specific engine or browser-context edge.
- A successful Roar staged the host's complete `flee` wave transition before the resolving TURN_COMMIT, but
  turn successor classification recognized only staged wins. That turn therefore stated a generic successor
  and the following exact WAVE_ADVANCE was correctly refused. Win, capture, and flee now all state the same
  address-exact WAVE_ADVANCE wait; win retains its stricter deferred-carrier identity check.
- `runWhenCoopRuntimeActive` now requires both the captured runtime and that runtime's bound scene. An async
  Crossroads/World Map receipt can no longer consume its one-shot callback in the shared-process sliver where
  the guest runtime pointer and host `globalScene` disagree. The existing public B11 journeys prove the exact
  symptom: guest counter/SwitchBiome must complete after the immutable result is admitted.
- Replay checkpoint restoration treats an omitted HP field as a fresh full-HP roster entry while preserving
  an explicit zero. Scheduled replay delivery is boot-only, and reward owner/watcher flows now run concurrently
  through destination contexts instead of sequentially deadlocking reciprocal readiness.
- Revival Blessing now submits both guest Revival Blessing and host Tackle through public COMMAND/FIGHT/TARGET
  inputs before proving the projected PARTY picker. Party transposition uses non-ally-damaging Rock Slide for
  its second win so the test exercises the intended replacement-to-wave graph rather than creating an unrelated
  second ally faint. The one-shot raw turn-resolution twin remains asserted only as cosmetic compatibility;
  V2 material/projection assertions continue to own correctness.

# 2026-07-24 - Reward journeys cross the same public command frontier as players

- The interaction-counter and Pokeball reward journeys no longer inject moves through `game.move.select`,
  answer `onCommandRequest` directly, or manufacture a wave-two command boundary with a harness remirror.
  Both seats now traverse the real COMMAND/FIGHT/TARGET handlers before the host reaches its retained turn.
- Wave two is reached through the preceding authoritative reward and wave transition. The tests assert both
  engines adopted that wave at the public command frontier, so a queued replay or missing command release is
  visible as the same hang a player would encounter instead of being bypassed by synthetic state mutation.
- The shared public driver also models the browser concurrency at a non-command turn successor: when the
  renderer is parked on `CoopFinalizeTurnPhase`, it lets the authority run its real replacement tail only as
  far as the next `CommandPhase`. That emits the ordered V2 successor before either side supplies input and
  prevents a one-process fixture from starving the authority while it waits on the renderer first.

# 2026-07-24 - Faint and won-wave regressions follow ordered V2 successors

- The barrier-deadlock, guest faint-switch, and won-wave replacement journeys now submit both seats through
  the real COMMAND/FIGHT/TARGET handlers. They no longer install a guest command responder or mutate the
  host's move selections behind the UI.
- Replacement choices wait until the real PARTY handler is actionable, which installs the address-exact V2
  proof before the callback runs. The idle-picker case uses the replay driver's authenticated replacement
  frontier instead of creating a detached duplicate replay and advancing mutable `scene.turn` first.
- The public command driver now models concurrent browsers across every between-command retained boundary,
  including NextEncounter: it advances the authority without input only to its real next CommandPhase, then
  lets the emitted WAVE/REPLACEMENT/CONTROL successor release the renderer before either player chooses.
- The barrier regression no longer invents turn N+1 and waits for a result the authority never authored.
  It asserts the retained replacement carrier installs the real command successor with no leaked request or
  retry timer—the invariant Authority V2 now owns.

# 2026-07-24 - B9 retains fast observations and real browser execution contexts

- Exact focused run `30099373184` reduced B9 again: barrier-deadlock and the first public faint journey are
  green. Its remaining Mystery evidence isolated one production timing hole and two one-process scheduler
  errors instead of an undifferentiated interaction failure.
- A fast host may answer an embedded Mystery quiz after the replica has admitted and materially applied its
  exact ME_PRESENT claim but before the replica renderer starts ErQuizPhase. The answer is non-mechanical
  presentation data, so it is now authenticated against that latest material claim and buffered by its exact
  operation address; it still cannot install control, consume a global revision, or mutate state.
- The repeated-delve fixture now proves the selected Mystery phase object retires before asking the
  interceptor for its same-named successor. The old helper immediately matched the prior round, switched the
  process-global scene during its async option callback, and consequently never authored round two.
- ME checksum recovery and between-wave public-command driving enable destination-context delivery before
  the authority sends the response/successor. This mirrors separate browser event loops and prevents a valid
  recovery bundle or WAVE/CONTROL entry from applying against the sender's scene.
- The battle-handoff reward and replay-pacing fixtures install their asynchronous settlement/replay phases as
  real phase-manager boundaries. The faint fallback assertion now observes the real REPLACEMENT_COMMIT wire
  entry rather than the deliberately retired shadow diagnostics surface.

# 2026-07-24 - Mutual-KO victories retain their executable replacement edge

- Exact B9 artifacts from `30099373184` showed the authority already knew the wave was won when it retained
  TURN_COMMIT, so it stated `TURN -> WAVE_ADVANCE` and suppressed the simultaneously-required replacement
  control. The engine then performed its real SwitchPhase and correctly failed closed when the post-summon
  REPLACEMENT_COMMIT had no active predecessor.
- A staged wave destination no longer erases a replacement that the immutable turn image and event stream
  prove is executable. The graph is now `TURN -> REPLACEMENT`; after the final summon, the replacement
  adapter's existing terminal wait admits the retained WAVE_ADVANCE (or TERMINAL_COMMIT) at N/N+1. Surviving
  battles still receive their command frontier, and a won wave cannot open a phantom next-turn command.

# 2026-07-24 - Faint evidence reads the canonical V2 wire body

- Exact full-gate run `30100787579` found two compile-only failures in the migrated faint journey: its
  replacement assertions inspected a nonexistent `entry` property on an `authorityEntry` envelope.
- Both assertions now inspect the canonical `body.kind`. This changes no runtime behavior; it restores typed
  evidence that the real post-summon carrier emitted a `REPLACEMENT_COMMIT` at the public replacement edge.

# 2026-07-24 - Public two-client migrations preserve production timing and V2 ownership

- Exact full run `30100787579` and focused B9 run `30101100165` showed several migrated journeys still
  inherited Vitest's 50 ms rendezvous default. Their first public turn was green; the next valid V2 control
  was then terminalized before the replica renderer completed retained material and successor projection.
  Trainer-switch, faint-chain, Mystery, Pokeball, and party-transposition journeys now retain the 60 s live
  budget while their own bounded phase drivers continue to fail actual stalls quickly.
- Trace replay no longer reconstructs each later wave with `remirrorWave`. The ordinary retained
  WAVE_ADVANCE projector owns the next battle; a synthetic remirror could race its legal no-currentBattle
  transition and hide the production successor under test.
- The Mystery checksum regression now proves the negotiated V2 recovery request/bundle/applied-proof and
  common fence reopening. It enables destination scheduling before the checksum is sent, replacing its stale
  assertion against the retired legacy `applyCoopFullSnapshot` correctness path.
- The idle faint fallback alternates both browser realms while rev-3 replacement delivery requests and fills
  its retained rev-2 tail. The previous guest-only pump synchronously handled the tail request under the wrong
  scene and manufactured a gap-release terminal impossible across independent browsers.
- Party transposition installs and verifies its deterministic enemy HP under the host realm, and replay pacing
  rereads the field after immutable material may reconstruct Pokemon identities instead of asserting against
  stale pre-apply objects.

# 2026-07-24 - Public B11 surfaces keep production timing and runtime ownership

- The biome public-input suite no longer gives ordinary retained receipts a global 20 ms deadline. It keeps
  a production-like 60 s budget; the two explicit exhaustion regressions still opt into their own 10 ms
  deadlines, so failure behavior remains fast and deliberate.
- Revival Blessing now closes both its Party UI and exact queue-owned phase under the runtime captured when
  the surface was created. An asynchronous UI continuation can no longer resume under the peer scene and
  leave the real owner's immutable-result watcher open.

# 2026-07-24 - The public command driver runs reciprocal browsers concurrently

- Exact focused run `30102553515` showed trainer replacement and Pokeball journeys reach the next host
  CommandPhase, emit its V2 control, and then wait for the guest rendezvous while the single-process phase
  interceptor still owned the host callback. The guest was never allowed to execute, although independent
  browsers would run concurrently.
- The public driver now stops before that host CommandPhase, starts it without waiting for menu completion,
  and advances the guest event loop to install the same CONTROL entry and return the reciprocal arrival. It
  still uses only the production phase scheduler, public input handlers, and destination-context delivery.

# 2026-07-24 - Mystery battle settlement now exercises the real V2 turn predecessor

- Exact B9 evidence from `30102553515` proved the retained battle handoff was valid, but the old regression
  then set both engines directly to turn 3 and manually constructed Victory/BattleEnd. It omitted every
  intervening V2 turn entry, so the sole global log correctly rejected the orphan turn-3 ME settlement.
- The journey now gives the authoritative enemies one HP, submits both seats through the production
  Command/Fight/Target handlers, records the real turn commit, replays its immutable faint checkpoint, and
  reaches the renderer and authority Victory/BattleEnd phases through their ordinary schedulers. The test
  still proves the guest parks at the exact BattleEnd until the post-preparation settlement arrives.

# 2026-07-24 - Entry presentation belongs to the ordered command-open boundary

- Focused B9 run `30104106099` proved the embedded Mystery battle reached the real guest TurnInit, then
  parked forever awaiting the legacy wave-keyed entry-presentation carrier. Embedded battles correctly do
  not publish an ordinary `enemyPartySync` wave-start transaction, so the missing ability/summon replay was
  a production Authority V2 ownership gap rather than a campaign-driver problem.
- Turn-one `CONTROL_COMMIT(command-open)` now carries the complete sealed Summon/PostSummon presentation
  prefix beside its post-entry authoritative state. The prefix is strict-union validated, bounded, and
  covered by the same immutable material digest and global revision; later turns carry an explicit empty
  prefix.
- A guest entry-only `CoopReplayTurnPhase` is now the address-exact consumer for that CONTROL entry. It can
  make the entry materially admissible, receives the prefix only after the state image is applied, renders
  it before command input, and retires the old wave-keyed copy as compatibility data. Ordinary waves and
  embedded Mystery battles therefore share one collision-free command boundary without synthesizing fake
  wave transitions or allowing local phase order to choose progression.
- The co-op wire protocol is now `er-coop-48`; mixed builds fail negotiation instead of accepting a command
  material shape whose presentation contract they cannot understand.

# 2026-07-24 - B10 replay fixtures preserve authoritative adoption and live UI surfaces

- Party transposition now installs its deterministic one-HP enemy state after the reciprocal public-command
  driver has completed any legitimate immutable host-image adoption. The old ordering silently restored the
  full enemy HP and changed the intended replacement-to-wave proof into an unrelated later-turn battle.
- Window replay checkpoint Pokemon now receive the same stateful headless `battleInfo` surface as every other
  mirrored live Pokemon before real SummonPhase runs. The fixture can therefore exercise production summon,
  info refresh, and V2 material application instead of crashing on an object the harness reconstructed only
  halfway.
- The focused ownership train was rebased to exact qualified predecessor `99b2fe918` so the next external run
  covers both B9's embedded-battle command boundary and B10's repaired replay fixtures.

# 2026-07-24 - Command-open presentation types remain explicit at phase boundaries

- Focused run `30106371311` reached its intended B9/B10 shards, but its independent static job found two
  missing type-only `CoopBattleEvent` imports introduced when the sealed prefix was threaded through
  CommandPhase and the replay successor claim. Both phase modules now import that wire type explicitly;
  no runtime behavior changed.

# 2026-07-24 - Exact-SHA B9 proves V2 entry presentation and exposes the next finite seams

- Focused run `30106371311` proved the production embedded-Mystery path: after applying command-open
  revision 3 and state tick 8, the guest rendered and proved all 15 ordered entry events—including ability,
  narration, stat-stage, and move-used events—before exposing the real CommandPhase.
- The broad red fan-out shared one harness cause: the post-pair direct-mirror bridge still constructed a
  turn-one command frontier without the newly mandatory entry prefix. It now seals the deliberately empty
  observed prefix through the same recorder API as production instead of bypassing the material invariant.
- The same run exposed a real non-battle Mystery seam: an entry-only replay waiter aborted by ME_TERMINAL was
  not registered in the legacy streamer's pending waits, so it remained current ahead of the ordered reward
  successor. Entry-only V2 consumers now retire themselves directly whether their prefix is waiting or
  already buffered; the detached async continuation sees `aborted`/`ended` and cannot shift a newer phase.
- The ME victory fixture now observes VictoryPhase's synchronous transition correctly: the retained
  BattleEnd is already current, not still queued. This changes only the assertion/driver, not production.

# 2026-07-24 - Recovery engine verbs retain their destination browser context

- Exact B9 recovery evidence from `30106371311` showed the guest accepted a correlated Mystery recovery
  bundle but never entered `CoopApplyResyncPhase` or returned `recoveryApplied`. The transaction resumed from
  its awaited response after the single-process duo harness had restored the peer's ambient scene.
- The recovery transaction now routes snapshot apply, ordinary-ledger frontier preparation, and every
  control projection attempt through one injected destination-runtime executor. Recovery release and shared
  terminal hooks use the same executor. Production remains synchronous in its one-runtime browser; the duo
  harness queues each independent verb until the captured runtime and its bound scene are installed.
- The #839 Mystery regression now enforces the Authority V2 model: recovery destroys the stale selector
  generation, reconstructs a different `CoopReplayMePhase` from the immutable frontier, proves the same exact
  operation address, and completes through that new public UI. It no longer blesses the retired advisory
  stateSync behavior of preserving an old phase object.
- A node-pure contract asserts that material apply, frontier preparation, and control projection all cross
  the runtime executor. Local TypeScript, targeted Biome, ownership resolution, and diff checks are clean;
  co-op behavioral verification remains external-only per `AGENTS.md`.

# 2026-07-24 - Remaining synthetic replay fixtures enter through Authority V2

- Replay fast-forward tests no longer inject raw `turnResolution` traffic, which is cosmetic after the full
  cutover. They begin at the already-authenticated V2 material boundary and provide the exact next command
  frontier, preserving their renderer-pacing scope without granting legacy traffic mechanical authority.
- Compact replay-window Pokemon data now normalizes missing gender and Tera type at its trace loader boundary.
  Real saved windows already carry those fields; the normalization prevents a hand-authored compatibility
  fixture from crashing the real game-info projection before it can exercise replay recovery.

# 2026-07-24 - Full-gate migration tail uses real phase and V2 boundaries

- Exact full-gate run `30108391403` showed that several older duo fixtures erased the command frontier that
  `buildDuo` had already installed and proved, then manufactured a second entry-only replay for the same
  retired CONTROL_COMMIT. Those post-build queue resets are removed; launch, reward, multiwave, transition,
  interaction-counter, wild-flee, and save journeys now begin at the real one-shot command frontier.
- Remaining renderer tests no longer inject raw legacy turn traffic, start detached replay objects twice, or
  keep single-engine host/spoof journeys that cannot exercise the Authority V2 graph. Their mechanics enter
  through V2 material, their replay phase is queue-owned, and exact two-engine public journeys now own the
  command, presentation, localization, faint, reward, and convergence assertions.
- Recovery's node contract now uses a typed destination executor and advances its fake clock only after the
  retry scheduler is armed. Biome and Revival public-surface tests retain production runtime ownership and
  enough runner time to observe their exact UI completion without changing product deadlines.

# 2026-07-24 - Turn-one replacement cannot recreate retired entry presentation

- B9's barrier-deadlock artifact exposed a production lifecycle bug, not harness noise. After the guest
  selected an own-faint replacement, its picker could close before the host authored REPLACEMENT_COMMIT.
  TurnInit then re-entered while the local battle cursor was still numerically turn one and queued a second
  entry-presentation-only replay. The original CONTROL_COMMIT had already been materially consumed and
  retired, so that replay waited forever in front of the replacement carrier and the turn-two rendezvous.
- The battle stream now exposes its exact-once consumed entry-presentation watermark, and authoritative guest
  TurnInit consults that stream-owned fact rather than treating `turn === 1` as sufficient authority to
  create a consumer. A legitimate first wave-start replay is unchanged; replacement-era re-entry proceeds
  directly to the pending replacement/command graph without waiting for retired material.
- Local TypeScript, formatting, ownership inventory, and diff checks cover this batch. Co-op behavioral
  verification remains external-only; the existing exact barrier-deadlock journey is the failure-first
  regression for the production seam.

# 2026-07-24 - B10 replay transitions and transposition scope stay production-shaped

- The trace replay driver now treats a temporarily absent `currentBattle` as the expected in-flight
  WAVE_ADVANCE state and drives the real NewBattle/Encounter successor to the requested command address.
  It no longer dereferences the deliberately cleared battle between waves, so recorded multi-wave traces
  continue through the same transition a browser uses rather than requiring a synthetic remirror.
- Party transposition still uses the level-100 Rock Slide to force its first-turn host-owned faint and real
  PARTY replacement. After that replacement is proven, the already-existing foes receive Splash for the
  focused replacement-to-wave turn; an unrelated second KO can no longer open another host PARTY picker and
  prevent the test from reaching its intended identity/order/EXP assertions.
- Local TypeScript, targeted Biome, and diff checks are clean. B10 remains remotely qualified only.

# 2026-07-24 - Single-scene presentation fixtures cross the real V2 turn boundary

- Full-gate run `30110836606` proved that replay-pacing, localization, and battle-event fixtures were
  feeding `ingestAuthoritativeV2Turn` into a runtime whose CPU spoof had correctly negotiated every V2
  capability off. Those tests therefore exercised neither the V2 suppression rules nor the live turn
  cutover and observed unchanged field state/presentation queues.
- The shared single-scene fixture now explicitly replaces the spoof negotiation with the minimal
  `authority.v2shadow` + `authority.v2turn` pair and builds the production turn cutover after the local
  engine has adopted the guest seat. This seam is limited to renderer tests that begin after authenticated
  admission; all protocol/progression tests continue to require two real runtimes.
- The P3 battle-control test imports the V2 harness accessor from its actual runtime owner, repairing the
  independent static-gate failure without weakening its exact two-engine assertions.

# 2026-07-24 - Async account credit and Revival input retain real browser ownership

- Full-gate run `30110836606` reached wave 3's successful catch with converged party and ball state, but the
  delayed `setPokemonCaught().then(...)` callback ran while the other synthetic browser owned the ambient
  runtime. The host dex broadcast therefore classified itself as the authoritative guest and returned. The
  acquisition call now captures its owning runtime, re-enters that exact runtime before serializing the dex
  image, and throttles independently per runtime. Production remains one-runtime; the representative
  two-engine harness now models that browser ownership instead of dropping the account-local merge.
- The Revival Blessing regression no longer assumes two RIGHT presses identify Splash. It reads the live
  public FIGHT cursor and navigates to Splash's actual move slot through ordinary UI input, preserving the
  owner-pick journey while removing a layout-dependent false red.
- Local targeted Biome completed with only the repository's existing informational complexity diagnostics;
  `git diff --check` is clean. Behavioral qualification remains GitHub-hosted only per `AGENTS.md`.

# 2026-07-24 - Remaining renderer and replay fixtures follow executable V2 edges

- Single-scene presentation fixtures now replace their current predecessor through the phase manager's
  destructive co-op-authoritative transition. They no longer clear and shift a fabricated local queue, an
  invalid post-cutover edge that could leave CommandPhase current while the detached replay never ran.
- The Yawn presentation regression waits for the real delayed `ObtainStatusEffectPhase` mutation before
  capturing immutable state, matching the turn barrier rather than sampling during TurnEnd.
- Multi-wave trace replay waits for the projected two-client command frontier before reading `currentBattle`;
  the V2 wave projector deliberately leaves that field absent while NewBattle/Encounter installs the next
  battle. The recorder likewise stops synthesizing an extra post-wave interceptor transition.
- Party transposition makes the already-proven enemies harmless before EnemyCommandPhase selects their
  second-turn moves. Changing the moveset after the public driver was too late and could open an unrelated
  second replacement picker.
- Behavioral checks remain external-only. The next exact-SHA aggregate gate is the qualification evidence
  for these B4/B9/B10/B13 fixture migrations and for any remaining product seam.

# 2026-07-24 - Retained replacement close uses its immutable source address

- B9's idle-picker artifact proved a real fail-closed false positive: the host could legitimately advance
  `currentBattle.turn` before the retained fallback reached the guest's still-current picker. Its close
  fence then treated that mutable cursor as lost authority and terminated an otherwise healthy session.
- The picker already owns an address-exact registered terminal, immutable faint source turn, exact phase
  token, session generation, runtime identity, and wave fence. Its bounded modal close now uses those facts
  instead of requiring the live turn cursor to remain frozen. A stale picker still cannot mutate a new
  phase, runtime, session, or wave.

# 2026-07-24 - Intercepted renderer fixtures start the installed replay boundary

- Exact B13 run `30114806245` proved the authoritative phase replacement succeeded but the test scheduler
  stopped before starting its newly-current `CoopReplayTurnPhase`. The manual drain allowlist began only at
  its children, so no renderer or checkpoint work ran.
- The three single-scene renderer drivers now include that real initial replay phase in their controlled
  drain. This preserves the destructive V2 transition while accounting for PhaseInterceptor's deliberate
  no-auto-start behavior; no production path changes.

# 2026-07-24 - Replay and owner-pick fixtures preserve one-browser ownership

- Exact B10 evidence showed the shared-realm guest recording its own public command into the host-owned
  replay buffer, then the host recording the same committed partner command again. Recorder taps now require
  the active authoritative host runtime, matching the separate module instances of two production browsers.
- The replay loader no longer starts the next host CommandPhase twice around the same command rendezvous.
  The next wave loop owns the single transition, so a valid first waiter is not superseded into bounded
  recovery by a duplicate harness start.
- Party transposition installs harmless enemy moves only after the reciprocal command-open adoption, which
  previously restored the original enemy objects. The Revival owner-pick journey uses Protect rather than
  Elite Redux's damaging Splash, keeping both tests focused on their intended authoritative boundaries.
- The remaining biome material deferral now reports the guest browser's active exact transition permit in
  its failure assertion. Its fail-closed semantics are unchanged; the next isolated B11 artifact will
  distinguish a leaked browser context from a real same-session transition conflict.

# 2026-07-24 - Exact qualification closes the ordinary interaction projector

- Exact full-gate run `30116210471` at `60c74d7c` made B4/B13 green and reduced co-op reds to B9, B10, and
  B11. Exact public-UI journey `30116066293` completed its full two-real-browser fresh/resume route green.
  T4 is a non-co-op topology lane and remains outside this branch's scope.
- B9's quiz trace exposed a production Authority V2 gap: after ME_TERMINAL, REWARD_PRESENT material applied
  while the replica's speculative CommandPhase remained current. Ordinary delivery now projects every
  registered interaction from its immutable plan. Ability, catch-full, colosseum, learn-move, revival, and
  stormglass use exact modal replacement; bargain, biome, crossroads, Mystery, reward, and market
  destructively replace obsolete local progression. Recovery and ordinary delivery therefore share the same
  constructors, and no registered surface depends on a local phase tree to decide what opens next.
- B9's other reds were representative-fixture defects: destination pumping now yields one receiver-owned
  event-loop turn under each exact client context; command opening waits for that reciprocal crossing; replay
  pacing waits for causal phase changes instead of re-entering animation-enabled phases; idle replacement
  accepts an already-installed typed Command successor; and the ME reward regression no longer treats the
  retired cross-point rendezvous escape hatch as a V2 correctness contract.
- B10's transposition enemy override now updates the active summon moveset that EnemyCommandPhase reads.
  B11's Revival fixture uses harmless Protect instead of Elite Redux's damaging Splash, and chained biome
  phases rebind their owning runtime at the address-exact start boundary instead of retaining a peer runtime
  captured by an asynchronous predecessor.
- Local static interaction contracts are 45/45 green and `git diff --check` is clean. Co-op behavioral
  verification remains external-only; the next exact-SHA aggregate gate must qualify this finite batch.

# 2026-07-24 - Exact live reward and market generations bind without replacement

- Exact full-gate run `30120777523` at `8e201ebec` rejected the first complete ordinary projector in B/C/P.
  The logs consistently showed a natural `SelectModifierPhase` or market phase already current at the exact
  generation when its immutable presentation arrived. Destructively replacing that same-class phase left
  its already-armed async watcher and owner continuation attached to the obsolete object, producing the
  stale-shop drop and reward/market hangs observed across exploration, Mystery, and production-fidelity
  tests. This is a production lifecycle defect, not a fixture timeout.
- Ordinary projection now first asks an already-current reward or exact market class to install the immutable
  operation, pin, reroll, surface, and stock in place. The phase installers reject a different constructor
  address, operation, reward surface, or market kind. Only an obsolete/wrong predecessor takes the existing
  destructive Authority V2 replacement path, preserving the required quiz-to-reward transition.
- Relay options are materialized only after an installer accepts the generation, so a rejected phase cannot
  publish stock for control it does not own. The static gate contract requires both in-place paths to precede
  the destructive fallback and pins their constructor-address validation. Behavioral proof remains the next
  exact-SHA GitHub-hosted aggregate gate and public two-browser journey; no local co-op Vitest or browser was
  run.

# 2026-07-24 - Exact qualification retains live markets, chained biome pins, and Mystery shells

- Exact full-gate run `30121803791` at `10e1a2314` showed that the initial reward lifecycle repair was
  correct, but exposed three more instances of incomplete ordinary projection. Biome markets intentionally
  retain legacy `phaseName=SelectModifierPhase`; their concrete V2 identity is `coopV2ProofPhaseName`, so
  checking `Phase.is(BiomeShopPhase)` could never bind a live market. Ordinary projection now validates that
  explicit identity before installing immutable stock in place.
- A guest-owned Crossroads Leave authored the correct future `BIOME_PICK` operation, but destructive V2
  projection replaced `ErCrossroadsPhase` before its legacy callback copied the interaction pin into the
  chained map. The closed biome projection plan now derives that pin from the immutable future operation ID,
  and `SelectBiomePhase` installs it together with wave, turn, and operation address. The executable map no
  longer depends on an obsolete predecessor callback.
- Repeated Mystery rounds keep one live `CoopReplayMePhase` and bind each new operation address only after
  its FIFO waiter consumes the corresponding presentation. The ordinary projector had replaced that live
  shell in the same delivery stack, orphaning its async continuation and causing a rendered selector whose
  ACTION input was rejected. It now retains the address-exact live boundary and lets the consumer perform
  the already-contracted handoff before publishing readiness.
- The remaining Mystery-transition red was a stale fixture order: it demanded that the guest reach its
  post-encounter phase before permitting the host to author the final leave entry. The migrated journey now
  installs its retained-delivery fault first, drives the real host terminal, then observes the guest's
  projected successor. Contract coverage pins all three product lifecycle rules. Behavioral co-op execution
  remains GitHub-hosted only; no local co-op Vitest or browser was run.

# 2026-07-25 - Later market generations retain one consumer and biome proofs become phase-local

- Exact gate `30123654540` at `7b6d6e1b` exposed one real market lifecycle bug: SHOP_BUY DATA woke the
  already-current watcher's FIFO, then the ordinary projector replaced that phase because its control ID
  still named SHOP_PRESENT. A later buy/leave generation now validates and retains the exact live market
  class, pin, immutable catalog, runtime, and actionable owner/armed watcher without relabelling it. The
  consumer that applies the complete post-action state remains the only code allowed to bind and prove the
  new operation; the projector neither replaces the phase nor republishes stock into the next generation.
- The same run's C/P/automatic-seal reds all reported `host=5 guest=-1` while the guest's exact projected
  `SelectBiomePhase` was current. This was a shared-process module-leaf observation artifact, but also
  revealed an avoidable ambient dependency. The immutable V2 pin is now installed directly on the phase,
  mechanics keep it over a legacy global snapshot, and the soak inspects that authority-owned coordinate.
- P2 stopped on a stale wave-10 CommandPhase after both engines had reached wave 11. Its representative
  driver now requires the destination wave while draining the real queue, so it dissolves obsolete commands
  exactly as production PhaseManager does before asserting post-summon convergence.
- Public journey `30123636515` reached a healthy owner reward confirmation and a healthy read-only watcher,
  then waited 17 minutes for the unchanged watcher browser to emit a second semantic event after an
  owner-only keypress. The proof now searches from the pre-reward frontier and still requires the exact
  owner, address, handler, and non-actionable input state. Static Authority V2 contracts are 46/46 green,
  the public-boundary inventory is green, `tsc --noEmit` is clean, and no local co-op behavioral test ran.

# 2026-07-25 - Projected Mystery rewards retain their ordered terminal fence

- Exact B5/B6/B9 evidence showed `ME_TERMINAL(reward-settled)` followed by a destructively projected
  `SelectModifierPhase`, after which the final Mystery leave parked in `CoopReplayTurnPhase` with
  `leaveSurfaceReady=false`. The replacement was correct, but it discarded the local
  `MysteryEncounterRewardsPhase` before that obsolete tree could queue `PostMysteryEncounterPhase`, so the
  final authoritative terminal had no exact lifecycle fence to consume it.
- A destructively projected reward now derives a one-shot Mystery-finalizer marker exclusively from its
  immutable `rewardSurface`. `SelectModifierPhase.start()` consumes that marker and queues the journal-aware
  finalizer before any option await or empty-surface exit. The finalizer cannot choose progression under V2;
  it only exposes the exact surface on which the already-ordered `ME_TERMINAL` installs its typed successor.
- Static contracts require the immutable marker, pre-await queue order, and one-shot consumption. The task
  manifest advances to the reviewed `f285a8d48` checkpoint so remote qualification measures only this delta;
  no local co-op behavioral test or browser was run.

# 2026-07-25 - Projected biome tails consume their exact destination carrier

- Focused run `30135430021` proved the Mystery finalizer repair: six former B5 final-leave hangs passed. Its
  remaining B5 red attached the replay factory observer after a buffered `ME_PRESENT` had already projected
  the runtime-owned replay, and P1 required a transient `PostMysteryEncounterPhase` even when the ordered
  terminal had already advanced the browser to `NextEncounterPhase`. Both drivers now prefer durable V2
  evidence instead of recreating or latching a transient local phase.
- The independent P1 soak exposed a real progression gap after guest-owned Crossroads -> BIOME_PICK. The V2
  projector correctly destroyed the replica's speculative queue and queued `SwitchBiomePhase`, but that tail
  ended before the wave-6 command carrier applied. Its empty queue fell through to `TurnInitPhase` on the
  completed wave-5 battle and stranded the renderer in `CoopReplayTurnPhase`.
- `SwitchBiomePhase` is now the address-exact DATA consumer for that one destination `CONTROL_COMMIT`. It
  validates the immutable permit, source/destination waves, epoch, turn-one command frontier, and sealed
  entry presentation. Only after the carrier installs the complete N+1 battle does it queue the sanctioned
  `NewBiomeEncounterPhase` and end. A static contract pins the validation and queue order; Authority V2
  contracts are 47/47 green, formatting and TypeScript are clean, and behavioral execution remains remote.

# 2026-07-25 - The destination carrier closes the projected biome permit without a circular precondition

- Focused run `30135914696` at `4bf89c80e` showed the first post-biome consumer was still too strict. The
  wave-6 command carrier arrived while the replica was correctly parked in `SwitchBiomePhase`, but pre-DATA
  admission required `historyRecorded`, `switchPrepared`, and the destination arena. Those are exactly the
  renderer-local facts that the complete destination carrier permits the parked phase to finish, so the
  carrier remained deferred and Phaser manufactured a stale wave-5 `TurnInitPhase` / `CoopReplayTurnPhase`.
- Pre-DATA admission now remains exact on session epoch, operation kind, source/destination permit, source and
  destination waves, turn-one command frontier, current phase, and entry presentation, without requiring
  post-DATA renderer stages. After the immutable N+1 state is applied, release records the committed source
  history, marks the installed carrier image as the prepared switch, materializes only the destination arena
  presentation, then opens `NewBiomeEncounterPhase`. It never rolls or replaces the host-owned routes,
  reveals, biome structure, party, field, or battle carried by Authority V2.
- The static contract now rejects reintroduction of the circular preconditions and fixes the post-DATA stage
  order. All 47 Authority V2 contracts pass, targeted Biome reports no errors, TypeScript is clean, and no
  local co-op behavioral test or browser was run.

# 2026-07-25 - Crossroads and World Map continuations stay in their owning runtime

- B11 diagnostics from exact run `30135436500` showed both public biome surfaces opening actionably on the
  owner while the watcher stayed in `MESSAGE`. The rendezvous itself completed on both sides; its promise
  continuation ran while the peer engine was ambient in the one-process duo topology, so the watcher's
  `boundaryStillLive` check read the peer scene and silently abandoned its owner/watcher split.
- Crossroads and World Map now return the raw rendezvous result without consulting scene/controller globals
  after the await. The complete result validation and owner/watcher split are queued onto the phase's bound
  runtime and scene. Their bounded UI-open continuations and legacy relay completions use the same binding,
  so no asynchronous surface can apply, prove, retry, or close against the peer engine's globals.
- The source contract pins rendezvous, post-UI watcher, and post-relay binding for both surfaces. Authority V2
  contracts are 48/48 green and targeted formatting is clean. The exact `9e7c29589` focused P2 evidence also
  identified a separate remaining guest-owned Leave seam: after its BIOME_PICK receipt the replica advances
  its interaction counter but enters stale wave-10 turn replay instead of the projected biome tail. This
  runtime-binding commit does not claim to fix that next root. No local co-op behavioral test or browser ran.

# 2026-07-25 - Destructively projected biome switches retain the destination carrier boundary

- Focused P2 run `30137027624` at `3572a8caa` reproduced the remaining guest-owned Crossroads Leave failure:
  the BIOME_PICK result and interaction counter both converged, and the wave-11 command carrier arrived, but
  the replica had already ended its projected `SwitchBiomePhase`. With no speculative `NewBattlePhase` behind
  that destructively projected tail, PhaseManager manufactured a source-wave `TurnInitPhase` and parked in
  `CoopReplayTurnPhase`; revision 9 then had no exact carrier consumer. The independent C1 journey stopped at
  wave 5 for the same reason when its wave-6 carrier found `SwitchBiomePhase` and was later dissolved.
- Only a switch constructed by an immutable authoritative projection now carries an explicit
  `coopAwaitDestinationCarrier` marker. It retains the exact permit and remains current until the N+1
  `CONTROL_COMMIT` invokes its existing address-exact release path. An eager pending-authority retry covers a
  carrier admitted in the same delivery stack; later delivery remains owned by normal Authority V2 retention.
  Legacy and locally authored switches keep their existing preparation path and cannot wait for a capability
  they did not negotiate.
- The P2 stale-rendezvous fixture is migrated to the new runtime-bound contract: transport waits return raw
  carriers, while the owning-runtime acceptance step proves that a replaced phase remains closed. The static
  contract pins the projection marker and requires the carrier park/retry to precede all local transition
  preparation. Authority V2 contracts remain 48/48 green; behavioral execution remains GitHub-hosted only.

# 2026-07-25 - Projected biome carriers seal the destination Battle shell and retain live map generations

- Focused P2 run `30137409101` at `db5ce7677` proved the projected switch now remains current, admits the
  exact wave-11 `CONTROL_COMMIT`, and applies its tick-26 DATA. It still parked afterward because the state
  transaction deliberately reconciles party, field, arena, and run material without replacing the scene's
  `Battle` identity: the live object remained wave 10 turn 2, so the wave-11 turn-1 release proof correctly
  refused it. The exact failure artifact is
  `dev-logs/ci/run-30137409101/coop-focused-P-2-of-2-failure/dev-logs/coop-duo/transition-t2-biome-1784941069411`.
- Command-open materialization now has one address-exact pre-DATA structural hook. Only a destructively
  projected `SwitchBiomePhase` whose session, source permit, immediately-next destination, and signed
  turn-one frontier all match can create the missing destination `Battle` shell. Immutable V2 DATA then
  lands once on that correct shell; the phase stays lifetime-valid through release, prepares only its
  renderer permit/arena, and queues `NewBiomeEncounterPhase`. Ordinary `CommandPhase` consumers and every
  other screen retain their existing no-preparation path.
- The same full-gate evidence exposed an independent lifecycle defect in B11: an exact live Crossroads or
  World Map phase had already entered its reciprocal rendezvous when the immutable interaction-open arrived.
  Replacing that same constructor generation orphaned the only continuation able to open the watcher. The
  ordinary projector now binds the V2 operation and pin onto that live, source-address-matched phase before
  its destructive obsolete-predecessor fallback, matching the already-proven reward/market lifecycle rule.
- Source contracts pin pre-DATA shell ordering, exact next-wave validation, destination lifetime fencing,
  and both in-place biome-surface binds. All 48 Authority V2 contracts and targeted Biome checks are green;
  no co-op Vitest or browser behavior ran locally. Focused P2/B11 and aggregate qualification remain remote.

# 2026-07-25 - A projected battle shell cannot derive a competing encounter successor

- Aggregate run `30137992708` proved that the exact destination shell and immutable wave-6 state now install,
  but its C3/C5/P1/P2 artifacts exposed two encounter tails. The shell called ordinary `newBattle()`, whose
  guest cleanup derived `NextEncounterPhase` from the still-visible source biome; the V2 release then installed
  its sanctioned `NewBiomeEncounterPhase`. The first consumed the one-shot enemy carrier and the second
  re-requested it, leaving the renderer in `CoopReplayTurnPhase` before any real destination command control.
- `BattleScene` now exposes a guest-only projected-battle constructor that shares battle construction but
  explicitly suppresses local post-battle cleanup and its successor derivation. `SwitchBiomePhase` may use it
  only after its exact session/permit/immediately-next turn-one carrier admission. The V2 projector remains the
  sole owner of the ensuing encounter tail; ordinary, solo, host, save-resume, and legacy battle creation keep
  their complete cleanup path unchanged.
- The source contract requires the projected constructor, its authoritative-renderer guard, and cleanup-free
  delegation. All 48 Authority V2 contracts, targeted Biome checks, `git diff --check`, and TypeScript pass;
  no co-op Vitest or browser behavior ran locally. The next focused/full qualification must prove the duplicate
  enemy-carrier consumption and destination `CoopReplayTurnPhase` stall are gone.

# 2026-07-25 - The party-transposition fixture uses a genuinely non-damaging enemy move

- Aggregate B10 at `e04f47ce8` failed after its second-turn fixture replaced both enemies' moves with Splash
  and asserted that no additional player could faint. In Elite Redux, Splash is a 40-power attack; the log
  shows it fainting Snorlax and Fennekin, after which production correctly opened two new replacement pickers
  that the narrowly scripted test did not drive. The resulting PARTY wait was a false gate signal.
- The fixture now installs Growl, a real `StatusMove` already used by co-op no-damage scenarios, preserving its
  intended replacement-to-victory coverage without changing production behavior or relaxing any assertion.
  Static checks only ran locally; the exact B10 behavior remains GitHub-hosted per repository policy.

# 2026-07-25 - Projected biome switches preserve an ordered wave-to-Mystery battle carrier

- Aggregate P1 at `e04f47ce8` exposed a destination that never opens a command frontier. After wave 11's
  authoritative victory, its `WAVE_ADVANCE` already sanctioned and queued one `NewBattlePhase`; BIOME_PICK
  then projected the biome switch, but the new command-carrier wait parked before that battle tail. The host
  correctly created a wave-12 Mystery battle while the guest remained on wave 11 indefinitely.
- A projected switch now waits for a command-built shell only when no `WAVE_ADVANCE`-sanctioned NewBattle is
  already queued. One ordered battle carrier is preserved because it can resolve to either combat command or
  Mystery interaction authority; more than one fails closed. Crossroads/interaction-only biome travel still
  has no sanctioned battle tail and therefore retains the exact command-carrier shell path.
- Static contracts pin the sanction, the zero-carrier wait rule, and ambiguous-successor refusal. Behavioral
  T2 Mystery and ordinary Crossroads/soak qualification remain remote; no co-op test ran locally.

# 2026-07-25 - Zero-event command presentations remain complete destination carriers

- Focused P2 run `30138491184` at `0e2e11e08` proved the duplicate encounter tail is gone: the projected
  Crossroads Leave switch remained current with an empty queue and revision 9 repeatedly reached the exact
  command-material consumer. Admission still refused it only because its valid entry presentation contained
  zero cosmetic events. The destination state, session, permit, wave, turn, and command address all matched.
- `SwitchBiomePhase` now requires the decoded presentation field to be an array but does not require it to be
  non-empty. A quiet battle entrance is mechanically complete authority; animation count cannot gate battle
  identity or progression. The contract both permits zero events and prevents the length check returning.
- Authority V2 source contracts, targeted formatting, and diff checks pass locally. P2 and the aggregate
  behavioral matrix remain remote-only.

# 2026-07-25 - Material-applied command entries retain their presentation release edge

- Aggregate C1/C3/C5 artifacts at `0e2e11e08` prove the projected destination state and encounter now
  converge, but exposed an ordered two-consumer lifecycle. `SwitchBiomePhase` consumed the command entry's
  first exact release to construct `NewBiomeEncounterPhase`; after that intro, the real turn-one
  `CoopReplayTurnPhase` waited for the same entry's 14-event presentation prefix. Because the entry was
  already material-applied, retries resumed in `projectControl` and never revisited `applyMaterial`'s
  one-shot release call. The legacy wave-keyed compatibility prefix was intentionally retired, leaving the
  V2 renderer waiting forever while the immutable V2 entry remained control-pending.
- Command projection now re-presents a materially applied `CONTROL_COMMIT` source entry to the exact current
  phase before checking aggregate CommandPhase proofs. Existing phase-owned session/address predicates still
  decide admission: the transition can spend the structural edge, unrelated phases remain inert, and the
  later replay phase receives the immutable prefix exactly once. Presentation rendering and its outcome fence
  remain mandatory before any command target can prove control installed.
- A source contract pins the retained-source lookup, material-applied and entry-kind gates, and ordering before
  command-proof evaluation. Behavioral C-lane verification remains GitHub-hosted only.

# 2026-07-25 - The duo Mystery driver starts an interceptor-installed V2 replay exactly once

- Focused B5 run `30138638196` failed only the LEG 3 battle-handoff fixture. Its artifact shows the V2
  `ME_PRESENT` material applying and atomically replacing inert `LoginPhase` with the exact
  `CoopReplayMePhase`, followed by 20 seconds of pending-control redelivery with no `guest diverted` start
  line. Production `PhaseManager` starts this phase immediately; the test `PhaseInterceptor` deliberately
  suppresses `startCurrentPhase`, while `driveDuoGuestMeReplay` incorrectly treated a merely-current
  projected object as already started.
- The representative duo driver now starts that exact current object only when the runtime active-replay
  pointer proves it has not crossed the scheduler edge. Already-active projected replays remain untouched,
  and absence of any V2 projection still uses the existing legacy divert. This changes no production code
  and removes a false B5 red without relaxing the retained terminal or public-surface assertions.
- The static contract requires scheduler ownership and runtime ownership to disagree before the harness may
  call `start()`. Behavioral B5 verification remains GitHub-hosted only.

# 2026-07-25 - The normal soak preserves a realistic command-presentation rendezvous budget

- Aggregate C5 at `839d137eb` reached wave 6 with both engines mechanically converged and the guest correctly
  rendering the immutable 16-event biome-entry presentation. The host nevertheless exhausted seven command
  rendezvous attempts because Vitest's generic 50 ms shortcut compressed the live seven-by-60-second budget
  to only 350 ms, then entered the shared terminal before the healthy renderer could announce its command.
- The normal soak now uses the same bounded two-second rendezvous interval already justified by its
  production-fidelity sibling. This preserves the real public presentation chain while retaining a finite
  14-second worst-case command failure inside the NO-PARK budget. Both files restore the test-aware default
  with `resetCoopRendezvousWaitMs()`, preventing an explicit 60-second value from leaking into later files in
  the shared-module shard.
- This is harness timing only: the production interval remains 60 seconds and no production source changed.
  Behavioral C5 execution remains GitHub-hosted only.

# 2026-07-25 - A projected Mystery phase cannot inherit its predecessor's handler proof

- Aggregate C1 at `839d137eb` reached its wave-39 Cleansing Font with the complete `ME_PRESENT` and both
  terminal entries ordered, but the guest admitted the first terminal before its projected
  `CoopReplayMePhase.start()` ran. `replaceWithCoopAuthoritativePhase` had made the new object current while
  the obsolete local Mystery handler remained active in the same UI mode; the generic observer therefore
  signed `controlInstalled` for a phase which had not crossed its scheduler edge.
- Interaction observation now honors an optional phase-owned readiness fence. `CoopReplayMePhase` refuses
  proof until that exact instance is active, runtime/scene/generation/pin-bound, has consumed its initial
  immutable presentation, and owns the handler token being recorded. The following terminal consequently
  remains gap-retained until the real replay opens and its existing readiness notifier retries the ordered
  log; a queued/current object or stale same-mode handler can no longer advance authority.
- This closes the architectural `phase queued != controlInstalled` invariant on Mystery without weakening
  any other interaction proof. Behavioral C1 and Mystery qualification remain GitHub-hosted only.

# 2026-07-25 - The party-transposition fixture checks the move it actually installs

- Aggregate B10 at `839d137eb` did not reach the replacement invariant it named: the fixture replaced both
  enemy movesets with `GROWL`, then immediately required every move to remain `SPLASH`. That stale expectation
  became unconditional when the harmless move was migrated from Splash to Growl in `63b1b082d`.
- The assertion now requires the installed Growl moveset. Its surrounding one-HP, actionable-command, reciprocal
  adoption, replacement, victory, and transposition checks are unchanged, so the test again exercises the
  production behavior instead of failing on its own setup.
- This is a test-only false-signal repair. Behavioral B10 execution remains GitHub-hosted only.

# 2026-07-25 - Ordered replacement fallback subsumes its unresolved picker

- Exact aggregate `30139608002` was green in every co-op lane except B9/B10 (plus the independently owned
  triples T4 shard). Browser-native WebRTC, both production-browser lanes, all five soak shards, fast V2
  contracts, and all P33 mutation shards passed. B9 exposed a real log-order deadlock: turn revision N had
  materially applied but its guest replacement picker was not actionable; the authority's retained fallback
  arrived as N+1, yet the replica called it a gap forever even though N+1 explicitly resolved the same
  replacement operation.
- AuthorityLog and both ledgers now implement the existing protocol rule that exact N+1 may retire unfinished
  N only when `subsumes` names N and the pending typed control authorizes that exact successor kind/address.
  Replacement commits derive that supersession from the retained matching replacement control, and the
  replica drops the retired pending image before applying the complete fallback material. Focused node
  contracts cover log admission, control-lease retirement, and the production replacement tap.
- The remaining old B9/B10 failures were evidence-backed harness defects: ER Growl is damaging, so that
  fixture now uses genuinely harmless Helping Hand; the replay
  fixture omitted PhaseInterceptor's production auto-start edge, the Mystery operation-id expectation omitted
  its pinned suffix, recovery left an atomically installed apply phase unstarted for the same interceptor
  reason, and a fixed two-pump command assertion sampled before the receiver event loop became actionable.
  The two-browser harness also restored a stale outer snapshot after re-entering the same client from a
  scheduled callback, erasing that browser's Mystery pin. Same-client nesting now preserves the newest client
  state; real cross-client returns still restore the captured peer exactly.
- Local verification is static only per `AGENTS.md`: TypeScript passes with zero errors, targeted Biome has no
  blocking diagnostic, `git diff --check` passes, and B9/B10 inventories are deterministic. The next checkpoint
  is the focused remote branch gate (Authority V2 contracts plus selected engine shards); no staging or
  production deploy is authorized by this checkpoint.

# 2026-07-25 - Focused B9/B10 reds now assert the real V2 lifecycle

- Focused run `30140668279` at exact `dac607752` proved the superseding replacement fallback itself: the
  replica admitted the N+1 `REPLACEMENT_COMMIT`, retired its unresolved picker, installed the checkpoint, and
  reached frontier `3/3/3`. Its remaining B9 failure came from the fixture changing only the legacy string
  owner while leaving the numeric six-seat owner on seat 0, so the committed next frontier correctly assigned
  both field actors to the host. The fixture now changes both ownership representations.
- The other B9 reds were precise harness lifecycle omissions, not production waits to lengthen. A settled
  Mystery handoff now claims the live guest pin generation before an older nested scope can restore it;
  recovery starts the newly projected address-exact replay that `PhaseInterceptor` intentionally leaves
  unstarted; public command driving tracks whether each concrete phase object crossed `start()` instead of
  trusting a stale UI mode from its predecessor; and the won-wave regression recognizes the retained V2
  `WAVE_ADVANCE` supersession path rather than requiring a retired local-derivation log line.
- The replay-pacing unit did apply the authoritative checkpoint exactly, then asked Phaser.HEADLESS to prove
  production GPU atlas/sprite readiness. That correctly entered the shared terminal and erased the scene,
  producing a misleading checksum failure. It now uses the shared semantic headless projection oracle for
  stable-id membership, visibility, and battle-info readiness; rendered pixels remain release-blocking in the
  two-real-browser lane.
- B10's turn material and victory path completed successfully, but its assertion sampled the shadow's
  synchronous callback counter. Deferred live finalization advances the log frontier without incrementing
  that counter, so diagnostics now expose the log's received/material/control frontiers and the test requires
  `appliedThrough` to advance. No mechanical requirement was weakened.
- Local checks remain static-only: targeted Biome and diff checks pass; the inherited TypeScript snapshot is
  202 diagnostics with zero in these changed files. Ownership verification runs on the committed exact SHA
  before focused dispatch. No local co-op Vitest or browser test ran.

# 2026-07-25 - Exact V2 Mystery generations no longer depend on a second legacy carrier

- Focused run `30141295191` at exact `a329688d8` reduced B9/B10/P1 to one shared bootstrap failure plus two
  independent Mystery defects. The initial adopted command objects had already crossed their scheduler edge,
  but their reciprocal continuation could resolve while the other synthetic browser realm was ambient. A
  one-use re-entry permit now applies only to those two adopted bootstrap identities; every newly-created
  command phase remains strictly start-once even when it inherits a stale COMMAND/FIGHT mode.
- A fast ordered `ME_PRESENT` can replace LoginPhase before the guest's local Mystery classifier runs. The V2
  material path already established the canonical Mystery pin, but omitted its equivalent runtime battle pin,
  so a retained battle handoff appeared outside an ME. The complete, validated presentation transaction now
  establishes both pins; rejected material still restores without leaking either boundary.
- Correlated recovery successfully applied its atomic image and created a fresh address-exact
  `CoopReplayMePhase`, but that phase waited for a second copy of the already-consumed compatibility outcome.
  Recovery-created generations now consume the immutable presentation installed directly by the V2 projector.
  Ordinary delivery deliberately continues consuming its relay copy, so it cannot leave a duplicate selector
  payload queued ahead of the next Mystery result.
- Local verification remains static-only per `AGENTS.md`. The existing B9 Mystery recovery and battle-handoff
  journeys are the failure-first behavioral coverage; focused remote qualification must prove their public
  handlers, correlated proof, and ensuing combat boundary.

# 2026-07-25 - Replica gap delivery is retained until its exact predecessor completes

- Aggregate run `30141774968` reached wave 39 in the continuous Mystery soak, then exposed a real ordering
  liveness defect. The guest had admitted `ME_PRESENT` revision 230 but was still proving its real selector
  when terminal revisions 231 and 232 arrived. Both authenticated frames were classified as gaps and dropped;
  the synchronous tail response could only repeat 230 at that instant, so later progress depended on a lease
  timer redelivering frames the replica had already received.
- The V2 replica now owns a bounded 64-entry delivery reorder buffer. Future authenticated revisions remain
  mechanically inert until `AuthorityLog` reports their contiguous predecessor complete, then enter the same
  ordinary admit/material/project/receipt pipeline immediately and in order. Duplicate buffered revisions
  must match operation, kind, digest, successor, and subsumption identity; conflicts or overflow enter the
  protocol-violation terminal. Hot rejoin drops old-generation buffered frames before synchronous replacement-
  channel redelivery, with transactional restoration if rebind itself fails.
- Node-pure failure-first coverage pins three entries arriving while revision one is material-deferred and
  requires all three to apply in order without a clock advance. B9 harness repairs follow the active exact
  Mystery replay generation after correlated recovery, assert the actual chained V2 double-faint successor,
  and let the idle-fallback command driver run the peer's real CommandPhase scheduler edge. The stale public
  source contract now checks the one-use adopted-command re-entry lifecycle rather than an obsolete expression.
- Local verification remains static-only: TypeScript is green, targeted Biome has no blocking diagnostics,
  and `git diff --check` passes. Behavioral B6/B9/C1 and node/public contracts remain GitHub-hosted only.
- Focused planner run `30142625726` stopped before test selection because the manifest omitted the directly
  changed double-faint regression file. The integration diff itself was valid; the next metadata-only push
  adds that exact path and advances the declared CAS base to `74358a22a`.

# 2026-07-25 - Gap-buffer contracts preserve the real successor graph

- Aggregate fast-contract job `89638704954` proved all 521 pre-existing node-pure contracts except one stale
  replacement fixture, and rejected the first gap-buffer fixture before it could exercise the replica. The
  fixture had authored three same-address `TURN_COMMIT`s; Authority V2 correctly refused revision two because
  revision one's `COMMAND_FRONTIER` authorizes the next turn, not another copy of the resolved turn.
- The failure-first gap regression now authors turns N, N+1, and N+2 with exact command-frontier succession.
  Revision one remains material-deferred on the replica while the authority validly commits revisions two and
  three, preserving the intended proof that authenticated future delivery is buffered and drained in order.
- The older replacement supersession test omitted the source wave/turn from its turn capture after exact
  successor validation became mandatory. Its fixture now carries wave 8 / turn 4, matching the replacement
  address it asserts; production code remains unchanged by this false-signal repair.
- Local verification remains static-only per `AGENTS.md`: targeted Biome and `git diff --check` pass. The
  corrected node contracts will run only on GitHub-hosted runners.

# 2026-07-25 - Projected reward terminals retain their signed next-wave bridge

- Aggregate run `30142642490` exposed one common real wave-2 race in every C lane and P1 after the new replica
  gap buffer correctly delivered `REWARD_PRESENT` immediately behind `WAVE_ADVANCE`. The guest projected that
  exact reward while `EggLapsePhase` was current; the destructive projector cleared the V2-sanctioned
  `NewBattlePhase`, and the terminal reward later let an empty PhaseManager queue manufacture source-wave
  `TurnInitPhase -> CoopReplayTurnPhase`. The next command carrier was valid but could never find its N+1
  Battle consumer.
- A destructively projected reward/market now arms the terminal result's immutable `AWAIT_SUCCESSOR` before
  its operation applier runs. The real phase-owned terminal proof queues one signed `NewBattlePhase` before
  teardown. Natural reward queues and Mystery reward finalizers remain unchanged; a rejected or incomplete
  result cannot queue the bridge.
- The projected `NewBattlePhase` is an inert ordered wait. It requires the exact N+1/t1 `CONTROL_COMMIT`,
  constructs only the renderer Battle identity through `newCoopV2ProjectedBattle`, lets the V2 runtime install
  the complete immutable command state, and only then releases to `NextEncounterPhase`. A later interaction
  entry may still supersede the wait destructively, so biome/crossroads/Mystery successors retain global-log
  ownership.
- The public source contract pins all three boundaries: arm before terminal apply, queue before phase end, and
  prepare/release only under the exact command carrier. Local verification stayed static-only: TypeScript is
  zero-error, targeted Biome/error diagnostics are clean, and `git diff --check` passes. The common C/P race
  and focused Authority V2 contracts remain GitHub-hosted failure-first verification.

## 2026-07-25 — exact replica binding for projected reward terminal proofs

- Full gate `30143437210` proved the signed bridge itself: the guest now queued and parked on the addressed
  `NewBattlePhase` instead of falling through into the stale wave. P1 still exposed revision 5 retained at
  `materialDeferred` while revision 6 was correctly held as a gap.
- The terminal reward phase did execute its real completion edge, but `coopProveV2RewardOperationComplete`
  settled the runtime captured by the phase constructor. A destructively projected phase can be constructed
  while the other duo client owns the process-global runtime, so that capture can point at the wrong V2
  ledger. The admitted guest revision consequently never observed its own proof.
- `prepareCoopV2InteractionTerminalSuccessor` now installs an operation-specific settlement closure bound to
  the exact `CoopRuntime` applying the immutable terminal entry. The phase queues its signed structural wait
  first, then invokes that closure; the constructor runtime remains only a legacy/natural-phase fallback.
- The fast Authority V2 source contract now pins both sides of that identity handoff so future terminal
  surfaces cannot regress to ambient-runtime settlement.

## 2026-07-25 — terminal proof recording is synchronous; only projection retry is scene-bound

- Exact-SHA full gate `30143762480` showed the first runtime-binding draft still parked C4 at wave 2. The
  guest phase queued the signed wait and invoked its bound closure, but revision 6 remained
  `materialDeferred`: the closure had queued the proof itself behind `runWhenCoopRuntimeActive`.
- The immutable applier must observe its exact terminal proof in the same stack. Proof recording is only a
  write to `runtime.v2SettledInteractionOperations`, so it is now synchronous and independent of the
  process-global scene. Only the follow-up durability/replica/projector retry is rebound through
  `runWhenCoopRuntimeActive`.
- This preserves production's synchronous behavior, makes the two-engine topology safe, and prevents an
  admitted result from waiting for a context activation that cannot occur until its own successor releases.

## 2026-07-25 — exact-SHA terminal-proof instrumentation

- Exact-SHA gate `30143925511` remained at the same wave-2 frontier: terminal reward revision 6 stayed
  `materialDeferred`, revision 7 stayed correctly gapped, and the guest parked on its signed
  `NewBattlePhase` bridge. Static and fast Authority V2 contracts were green.
- The existing trace proves the phase queued the immutable wait, but it cannot distinguish a skipped phase
  settlement callback from a callback writing a different runtime ledger. Add bounded diagnostics at the
  phase callback and exact runtime-ledger write before making another behavioral change.

## 2026-07-25 — picked-item terminal proves before phase teardown

- Instrumented exact-SHA gate `30144247279` showed the runtime binding is correct. Skip/leave terminals
  recorded the guest proof and advanced cleanly; the resume soak moved from wave 2 to wave 4.
- Wave 3 picked a terminal item instead of leaving. That projection-only callback called `super.end()`
  before `coopProveV2RewardOperationComplete`, exposing `TurnInitPhase` to the immediate replica retry.
  The entry therefore failed terminal-phase reinstallation even though its exact proof was then recorded.
- Record the proof (which also queues the signed `NewBattlePhase` bridge) before ending the phase. Also
  treat an already-recorded address-exact proof as monotonic: later redelivery no longer requires the retired
  phase to exist merely to reinstall the same callback.

## 2026-07-25 - Crossroads campaign driver follows real browser scheduling

- Exact-SHA gate `30144376074` proves the terminal-reward repair: C2 and C4 are green, including resume and
  learn-move paths that previously parked at waves 2/4. C1, C5, and P1 all reached the same later frontier at
  wave 6: the guest correctly retained `NewBattlePhase` after reward revision 25 while waiting for the next
  typed entry, but the driver withheld the authority's already-current `ErCrossroadsPhase.start()` and then
  waited for the guest to reach Crossroads. No interaction-open revision could exist in that order.
- The soak driver now schedules this boundary like two independent browsers: start the authority's real
  queued Crossroads phase first, let it author the exact `CONTROL_COMMIT/interaction-open`, then drive the
  replica. The existing central V2 projector may consequently replace its battle-shaped ordered-wait carrier
  with the immutable Crossroads generation; both real OPTION_SELECT handlers are still required before input.
- This is a harness false red, not a production bypass. No product authority path changed, no private choice
  was injected, and the public Crossroads owner still supplies Stay/Leave through UI input. Behavioral proof
  remains GitHub-hosted only under `AGENTS.md`; local verification is static-only.

## 2026-07-25 - Reward UI completion is bound to its owning browser

- B1 on exact SHA `be65ee4d3` showed a continuation reward fully committed revisions 5-7, including both
  authority and replica terminal proofs, while the guest's real `SelectModifierPhase` never exited. The
  asynchronous `setMode(MESSAGE).then(finish)` resumed while the host was ambient in the shared-process duo
  scheduler: proof was phase/runtime-bound, but `super.end()` still targeted ambient `globalScene`.
- The transition now starts on the phase's construction-time scene and re-enters its exact runtime before
  executing the completion callback. This preserves single-browser production behavior while making the
  ownership invariant explicit: terminal proof, result commit, and phase teardown all belong to one browser.
- The fast source contract pins the complete UI-promise-to-runtime-to-phase-manager call chain. No co-op
  behavioral test ran locally; aggregate/focused proof remains on GitHub-hosted runners only.

## 2026-07-25 - Authority V2 Crossroads drops its circular legacy barrier

- The exact-`5c8da12c8` rerun proved that starting the authority's queued Crossroads before driving the
  replica was necessary but not sufficient. The authority reached `xroads:5` and awaited the legacy
  reciprocal rendezvous; the replica remained correctly parked in the signed wave-5-to-6 NewBattle carrier,
  waiting for the authority's V2 interaction-open. Teardown then aborted the unreleased rendezvous.
- That is an authority cycle, not a pacing timeout: host waits for guest legacy phase arrival, while guest
  waits for host ordered control. A runtime with the complete V2 control cutover now uses only the immutable
  predecessor/order plus interaction-open entry as its boundary. Legacy/non-cutover sessions retain the #858
  rendezvous unchanged.
- The public source contract pins both sides of the safety boundary: the bypass consults the phase's exact
  construction-time runtime, and only a runtime registered in the complete control-cutover map can bypass the
  legacy barrier. Behavioral proof remains remote-only under `AGENTS.md`.

## 2026-07-25 - Exact phase ownership and interceptor-start parity

- Exact-SHA aggregate gate `30144988831` at `e346261186` separated four independent mechanisms instead of
  treating every red as a production desync. B1 exposed a real late-parent teardown bug: a free-reward
  `SelectModifierPhase` committed an Ability Capsule child, then its delayed MESSAGE callback shifted that
  already-current child out of the queue. Terminal teardown now requires exact current-phase identity, so an
  obsolete parent cannot orphan an authoritative sub-picker.
- Ability-result delivery also had a real two-engine destination-binding defect. The raw carrier woke the
  guest picker while settlement lookup and materialization credit consulted the ambient host operation state.
  Both checks are now explicitly bound to the receiving runtime and its durability journal.
- C1/C3/C5/P1 and the related B11 evidence proved the production Crossroads projector installed the exact
  signed `ErCrossroadsPhase`. The engine-test `PhaseInterceptor` deliberately suppresses
  `PhaseManager.startCurrentPhase()`, but the soak driver treated the projected operation ID as start proof and
  left the guest at MESSAGE. The driver now starts that exact returned object when its public OPTION_SELECT UI
  is not open; it still requires both public handlers and never injects a private choice.
- B8/B11 expectations are migrated from the obsolete `xroads:<wave>` rendezvous to shared, exact V2 operation
  identity and explicitly prove that complete V2 cutover does not enter the circular legacy barrier. The B9
  correlated-recovery test now drives the fresh recovered replay object instead of its destroyed predecessor.
  The one-process duo command driver grants a one-use re-entry only to an already-started, exact-current command
  object stranded outside COMMAND/FIGHT by a peer-realm Promise continuation; real newly-created commands
  remain start-once.
- The Stormglass assertion now reads the guest's journal under the guest runtime rather than the ambient host.
  Local verification is static-only per `AGENTS.md`: TypeScript is green, targeted Biome is clean,
  `node --check` passes for the browser contract, and `git diff --check` passes. All behavioral proof remains
  on GitHub-hosted runners.

## 2026-07-25 - Exact-SHA `3f990395c` five-shard closure batch

- Aggregate gate `30145585898` left five co-op shards red while static, browser-native WebRTC, fast public UI,
  Authority V2 contracts, and mutation jobs were green. The artifacts separated two product defects from
  three shared-process test contradictions; Showdown/Tournament T4 remains explicitly outside this co-op task.
- Projection-only reward and reroll terminals now resume under their construction-time browser runtime and
  end only their exact current parent. A delayed reward callback can no longer shift an Ability Capsule child
  or a newly queued reroll phase out of the scheduler.
- A final replacement's committed `COMMAND_FRONTIER` now owns input unconditionally. The replica clears only
  the addressed actor's stale command/turn ephemera before opening its public CommandPhase instead of letting
  a legacy `turnCommands` cell veto the signed successor.
- Encounter adoption now preserves identity-matched enemy objects when an already-applied V2 state tick
  dominates the raw enemy manifest. The legacy carrier can still supply encounter presentation, but it cannot
  rebuild the party and erase richer V2 tags, held items, forms, or other authoritative state.
- The ability-picker fixture explicitly activates the receiving runtime between consecutive operations; the
  double-faint test proves the designed same-chain subsumption from wire entries instead of demanding that an
  intermediate revision render separately; and the duo public-command driver spends its receiver-realm
  re-entry only after peer arrival, matching two independent browser loops.
- Local verification remains static-only per `AGENTS.md`: TypeScript is zero-error and the public source
  contract parses. The five affected behavioral shards and aggregate qualification remain GitHub-hosted.

## 2026-07-25 - Exact-SHA `0031a7045` residual co-op triage

- Aggregate run `30146420792` reduced the co-op failures to A1, B9, and B11; T4 remains excluded by the
  co-op-only scope. Ability-picker migration, reward ownership, double-faint succession, every mutation job,
  the fast public/Authority V2 contracts, and all other co-op shards were green.
- A1 reached the exact post-replacement `COMMAND_FRONTIER` and then failed only because its hand-written fake
  player objects predated the production `resetTurnData()` invariant. The fixture now implements that public
  actor seam; the production reset remains mandatory.
- B11 proved the V2 tick 183 field image had already installed Aqua Ring, then EncounterPhase accepted the
  older tick 181 compatibility manifest. `applyCoopEncounterAuthority` cleared `battle.enemyParty` before the
  preservation check, making that check impossible. Adoption now snapshots the preprojected objects, verifies
  every existing field/id/species against the manifest, preserves those richer active objects, and reconstructs
  only missing bench members. An identity or tick ambiguity still falls back to a complete fail-closed rebuild.
- B9 retired the exact V2 command revision and crossed both reciprocal arrivals, but its public menu remained
  at MESSAGE. The assertion now records the exact current phase, command cell, and move queue on failure so the
  next isolated shard distinguishes a stale generated/forced command from another shared-realm continuation;
  no timeout or player-facing assertion was weakened.
- This child train is declared against exact base `0031a7045`. Local checks remain static-only: targeted Biome
  error diagnostics, formatting, `git diff --check`, and JS parsing are clean. A1/B9/B11 behavioral proof runs
  only on GitHub-hosted focused shards.

## 2026-07-25 - Exact-SHA `821020756` B9/B11 residual closure

- A1 is green after the fixture migration. B11 confirms the newer V2 enemy objects now survive the encounter
  descriptor reset, but the final compatibility corrector was still applied to those same objects and removed
  Aqua Ring from the post-PostSummon image. The corrector is now retained only for slots actually reconstructed
  from the older manifest; V2-reused slots cannot be overwritten at finalization.
- B9's expanded diagnostic proved there was no stale command cell or move queue. The exact guest command control
  was installed, but the production V2 release could start and open the target CommandPhase while the harness
  was still draining its predecessor. The driver then started that already-actionable exact object a second
  time and advanced it to TurnStart without public input. The lifecycle helper now adopts an already-open
  COMMAND/FIGHT handler into its identity ledger and never re-enters it; non-actionable parked phases retain the
  existing one-use receiver-realm re-entry rule.
- The child train is declared against exact base `821020756`. Behavioral validation remains remote-only.

## 2026-07-25 - Exact-SHA `4b197f3f7` retained continuation and summon-state closure

- Aggregate gate `30147455257` left only co-op B9 and B11 red while static, A1, P1/P2, browser-native WebRTC,
  mutation, and the remaining completed co-op shards were green; T4 remains outside this co-op-only task.
- B9 proved the guest's own command phase reached its reciprocal barrier, yet the guest phase tree advanced to
  `TurnStartPhase` before public input. The authority host's barrier Promise was resuming while the other
  in-process runtime was ambient. Its continuation is now captured to the originating runtime and exact phase;
  a late peer arrival cannot mutate a superseding or peer phase tree.
- B11 proved the raw final corrector was no longer touching preserved V2 objects, but ordinary encounter setup
  still called `fieldSetup(true)` on them. That rebuilt `summonData` and deleted the accepted Aqua Ring tag.
  Preserved V2 field identities now receive render setup without resetting their authoritative summon state;
  compatibility-reconstructed enemies retain the full ordinary reset.
- This child train is declared against exact base `4b197f3f7`. Behavioral validation remains GitHub-hosted.

## 2026-07-25 - Exact-SHA `bfe2b3b01` public-command harness correction

- Aggregate gate `30147942377` remotely proved the production changes: B9 is green after binding the reciprocal
  command continuation to its originating runtime/phase, and B11's automatic-victory seal now passes with Aqua
  Ring intact through the next encounter. All four Authority V2 mutation shards and the focused qualification
  are green; Showdown/Tournament T4 remains outside this co-op-only task.
- B11's remaining red was a different engine-test-only contradiction. `arriveGuestCommandBoundary` started a
  real guest-owned CommandPhase, then expected that actionable human-input surface to reach ReplayTurn without
  any public input. The old cross-client continuation bug had accidentally supplied that impossible advance.
  The helper now stops at the exact open command frontier (or an already-routed ReplayTurn), rejects any other
  phase, and leaves the later wired replay driver to consume the command. No production timeout, authority,
  presentation, or player-facing assertion is weakened.
- Local validation remains static-only per `AGENTS.md`: targeted Biome has no errors, `git diff --check` is
  clean, and all behavioral requalification remains on GitHub-hosted runners.

## 2026-07-25 - Exact-SHA `313c5fba0` authoritative arena-duration closure

- The completed `bfe2b3b01` aggregate added a late B6 failure after the earlier shard snapshot. Its Stormglass
  result was mechanically real: V2 state tick 13 carried the host's chosen Sandstorm and remaining duration,
  but `applyCoopAuthoritativeBattleStateInternal` installed only weather identity. The guest's user-less
  `trySetWeather` therefore created the right weather with zero turns while the host retained five.
- Complete V2 state application now installs signed weather and terrain remaining-turn counters after their
  identities exist, and raises the visible `maxDuration` floor to the signed result. The existing Stormglass
  duo regression now asserts both `turnsLeft` and `maxDuration` on host and guest. Per-turn checksum counters
  remain intentionally excluded; this changes only immutable authoritative material projection.
- The superseded aggregate was cancelled before consuming the full matrix. Static-only local qualification
  precedes a new exact-SHA focused and aggregate dispatch.

## 2026-07-25 - Release-soak Authority V2 migration

- Exact aggregate `30148515719` is green across every in-scope co-op shard at `cae9c0e23`; its only red is the
  explicitly excluded Showdown/Tournament T4 lane. B6, B9, B11, browser-native WebRTC, static contracts, and
  all mutation shards pass together.
- Nightly run `30148771892` exposed two apparent failures, but its negotiated capability log proved the six
  release profiles were still exercising legacy operation authority: none of the workflow steps enabled the
  five Authority V2 build flags. The level profile then stranded a legacy `FAINT_SWITCH` transaction after a
  wave-2 guest faint, and the journey deliberately aborted when the legacy operation cursor rejected the
  first guest-owned `ME_PICK`. These are valid legacy findings but not qualification of staging's V2 graph.
- `nightly-coop-soak.yml`, `coop-soak-focused.yml`, and the public GameOver journey's two-engine prerequisite
  now enable turn, replacement, wave, interaction, and recovery V2 together. A source contract reads all three
  exact job/step blocks and fails if any surface is absent or explicitly downgraded.
- Next proof: replay the exact level seed `20260725` and fixed journey seed `828633` remotely under V2. Only a
  reproduced V2 failure authorizes a product/harness patch; green means the obsolete legacy failures remain
  diagnostic evidence while release qualification proceeds on the intended architecture.

## 2026-07-25 — Public campaign semantic command repair

- Replaced the solo campaign's retired `cursor:0` command target with the live mirror's stable `command:fight` identity.
- Added a fail-closed source contract so future command-surface refactors cannot silently restore numeric cursor navigation and create a false campaign red.
- Replaced the fresh/resume lobby's fixed 12-key pulse window with a handler-ready `TitlePhase` message proof. Fresh runs now choose semantic `no` when a retained resume exists; resume runs choose semantic `yes` only after the real confirmation is actionable.

## 2026-07-25 - Presentation-ledger render-profile correction

- Mystery-gauntlet campaign `30148771212` reached the shared wave-1 turn-2 command frontier with an exact,
  ordered guest receipt for every authority-recorded event. The oracle nevertheless rejected the run because
  the explicitly animation-free profile correctly reported typed `renderer-skipped` / `animations-disabled`
  outcomes for move/HP/stat/status animation phases.
- Renderer-ledger proof now permits that single typed skip only when both independent real browsers' latest
  public Settings attestations say move animations are disabled. Animation-on runs remain completion-only;
  a failed receipt, unknown skip reason, wrong role, missing attestation, or split browser setting remains red.
  Canonical event count, order, address, and payload comparison is unchanged for skipped events.
- A node-pure policy contract covers animation-on strictness, the exact animation-off exception, rejection of
  failed/unknown receipts, and latest-attestation ownership. Local validation remains static-only; the public
  campaign and fast-contract behavioral proof run on GitHub-hosted runners.

## 2026-07-25 - Final-turn faint successor correction

- The first all-V2 six-profile nightly (`30149104406`) proved the asymmetric Mystery and thirteen-event
  journey profiles green. God A, God B, and the level profile all exposed the same product defect at waves
  112, 162, and 2: a player fainted on the winning turn, TURN_COMMIT reserved a replacement picker, but the
  real host engine had already selected BattleEnd and advanced directly to victory settlement. The ordered
  WAVE_ADVANCE was correctly rejected behind the impossible replacement control.
- A runtime-staged win/capture/flee now supersedes same-turn player replacement derivation and states the exact
  deferred WAVE_ADVANCE wait. Surviving battles still derive and require the complete replacement chain. A
  failure-first stream regression uses the recorded wave-112 shape and proves both halves of that distinction.
- God C reached wave 190 before finding a separate missing staged replacement carrier. That frontier remains
  independently red and will be diagnosed after this shared terminal-successor correction requalifies.

## 2026-07-25 - Recorder-owned faint replacement address

- God C's wave-190 trace proved the remaining replacement failure was an address split, not a missing player
  choice: the turn recorder assigned faint sequence 14 to source turn 6, but delayed `FaintPhase` combined that
  immutable occurrence with the already-incremented ambient turn 7. The host therefore staged
  `w190/t7/o14` while Authority V2 correctly waited for `w190/t6/o14`, and the compatibility carrier refused
  to invent an unlogged checkpoint.
- Faint identity is now consumed atomically as `{ turn, occurrence }` from the same open authority recording.
  `FaintPhase` uses both recorder-owned fields and consults mutable battle turn only when no authoritative
  recording exists. No checkpoint matching or successor validation was relaxed.
- A failure-first recorder regression preserves a prefix event, records the faint at turn 6, and proves the
  delayed consumer receives exactly turn 6 plus the faint's sequence. Remote qualification will replay the
  all-V2 gate and six-profile soak; local validation remains static-only per `AGENTS.md`.

## 2026-07-25 - Presentation-oracle source-contract migration

- Public journey `30149919732` never reached a browser: its build-time source contract still required the
  retired inline `entry.stage !== "renderer-completed"` expression after receipt validation moved into the
  node-tested presentation-ledger policy. That was test drift, not a Showdown or co-op runtime failure.
- The contract now proves the harness reads both browsers' latest render-profile attestations and delegates
  every renderer receipt to the strict policy. The policy's separate executable tests retain animation-on
  completion-only behavior and permit only the exact `renderer-skipped/animations-disabled` exception when
  both real browsers independently attest animations off. No production Showdown/Tournament code changed.

## 2026-07-26 - Typed winning-turn replacement-open control

- Gate B9 and all-V2 level artifact `30149955471` exposed both legal timings of final-turn faint ownership.
  The turn-level result must not invent a replacement and block the won wave, but the real engine can run
  its SwitchPhase either during same-wave settlement or retain it through rewards and execute it at the next
  wave before Encounter. With no typed successor for either real picker, the host timed out a guest choice
  and the post-summon carrier correctly aborted because no active replacement head authorized it.
- `CONTROL_COMMIT` now has a third complete capsule, `replacement-open`, alongside command-open and
  interaction-open. Only the authority's real SwitchPhase may author it at one of those two closed timings
  from an ordered wait that explicitly permits CONTROL_COMMIT. It carries complete state plus the exact
  replacement control; replicas defer material until the stated battle address exists and project the owner
  picker from the immutable entry. Every unrelated missing replacement head remains fail-closed.
- A pre-encounter replacement result states exact alternatives: another replacement-open for a second
  fainted slot, command-open after Encounter, or ME_PRESENT at turn zero when the destination is a Mystery
  wave. This preserves multi-faint serialization without local queue derivation and keeps the empty-enemy
  carrier valid. Adapter Vitest covers build, digest,
  same/cross-wave admission, decode, address drift, and tamper rejection; the node-pure source contract pins
  the phase-owned runtime wiring. Real-engine proof stays on the remote B9 and browser campaign shards.
- A same-wave replacement result likewise states a closed tail: another replacement-open at the identical
  settlement address or WAVE_ADVANCE. This prevents the first simultaneous faint from consuming the only
  permit and leaving a second real SwitchPhase unaddressable in doubles/triples.
- Migrated the public faint-replacement evidence oracle from its stale `const` local faint address to the V2
  contract: the real SwitchPhase must establish, fail/defer safely, and then rebind to the immutable committed
  replacement address before any owner/watcher relay may use it.

## 2026-07-26 - Retained reward authority and fresh no-save launch completion

- Closed the valid reward-liveness finding from the latest external audit: an elapsed watcher wait under
  Authority V2 now requests durability recovery and re-arms the same live shop with bounded backoff. It never
  invents `LEAVE`, closes the mirror, or advances the interaction counter without an immutable commit. The
  legacy fallback remains unchanged while cutover is inactive.
- Two-browser run `30183490216` proved transport, negotiation, and cross-language compatibility healthy, then
  showed the host receive five typed missing cloud-save responses without ever publishing the fresh no-save
  decision. The observation-complete path now returns an empty snapshot immediately when all five authoritative
  cloud reads and all five exact account-scoped local keys are absent. It performs no save mutation or inference.
- Added launch milestones around the cloud scan, snapshot, and discovery result so any remaining lobby stall has
  an exact boundary. Local static qualification is clean: targeted Biome, `git diff --check`, and all 232
  public node contracts pass. Behavioral proof remains remote-only per `AGENTS.md` and is the next exact-SHA run.

## 2026-07-26 - One-process wave-transition realm fidelity

- Full gate `30183504627` put every common soak shard on the same synthetic freeze: the host was left in
  `NextEncounterPhase` or `NewBiomeEncounterPhase` after the driver restored ambient globals before the host's
  enemy-asset/UI Promise continuation settled. The production lifetime guard correctly rejected that
  continuation when it observed the guest realm; two separate Chromium realms cannot create this state.
- The soak now retains the host as the outer client scope for the whole structural crossing. Replica service
  remains live through nested destination pumps, which always restore the authority scope before returning.
  A node-pure source contract prevents future refactors from releasing the host before `settleDuoPromise`.
- No production phase or guard was weakened. Remote focused/common shards are the behavioral proof; local
  targeted Biome and the 62-test Authority V2 source-contract suite pass.

## 2026-07-26 - Bounded fresh-launch decision surface

- Real two-browser journey `30184226482` proved the all-empty save scan correction itself: the elected host
  received five typed cloud-missing results, proved all five exact local keys absent, and classified the pair as
  `no-save`. It then remained visually on `Connected! Checking for a co-op save...` and never published an
  actionable prompt. The failure was therefore the following Phaser UI transition, not save discovery or WebRTC.
- Every asynchronous co-op save-decision screen now crosses into `MESSAGE` through the existing bounded,
  exact-session transition seam. A lost fade is forced after two seconds; a replaced session is superseded and
  cannot install a stale callback. The fresh path also updates the visible lobby status and logs the transition
  verdict before arming the human prompt. Resume and isolated-conflict prompts receive the same protection.
- A failure-first node source contract rejects an unbounded fresh decision transition and pins the order:
  bounded open, exact-session fence, mode-chain reset, actionable callback. The 63-test Authority V2 contract
  suite and `git diff --check` pass locally; the real two-browser journey remains the behavioral proof.

## 2026-07-26 - One-process Phaser callback ownership

- Exact full gate `30184390240` reduced B11, C3, C5, and P1 to the same synthetic freeze across unrelated
  profiles and waves: the authority entered `NextEncounterPhase`, the replica entered `NewBattlePhase`, and
  the authority's tween completion evaluated an exact battle/phase guard while the replica's process-global
  scene was installed. The guard correctly returned; in two browsers the other scene cannot occupy that global.
- The duo harness now binds every Phaser tween callback family (`add`, `addCounter`, and nested `chain`
  configurations) to the browser context that scheduled it. This covers synchronous GameWrapper callbacks and
  deferred scene variants, restores wrappers during rig teardown, and does not weaken production phase guards.
- A failure-first node contract pins both authority and replica managers plus the exact `withClientSync` dispatch.
  The 64-test Authority V2 source-contract suite and targeted staged Biome checks pass locally. The first remote
  static pass then caught exact-optional restoration assignments; teardown now narrows the originally present
  optional Phaser methods before restoring them. Remote B11 and common-soak shards remain the behavioral proof.

## 2026-07-26 - Exact fresh-launch handler generation

- Real two-browser journey `30184824386` proved the bounded transition and all-empty scan, but the elected host
  still never exposed an actionable semantic message. The lobby status changed to `Press to start co-op` while
  the underlying `MESSAGE` handler retained its prior generation, so the driver correctly refused to press.
- Host save decisions now rebuild the concrete same-mode handler after the bounded exact-session transition,
  install the callback synchronously, and prove that ordinary physical ACTION input is consumable. Failure to
  establish that proof terminates the shared launch instead of displaying an inert prompt. Fresh, resume, and
  isolated-conflict decisions all use the same seam.
- The source contract now pins clear, reopen, prompt publication, actionability proof, and fail-closed terminal
  ordering. This is a production input-liveness correction; the browser driver remains keyboard-only and does
  not infer readiness from localized text or timing.

## 2026-07-26 - Retired tween-pin pass-through

- Focused P2 run `30185398599` passed static, A1, and B6 but timed out 12 later tests in the same reused
  Phaser scene after its first duo test passed. That first test spies on the pinned tween method; teardown
  therefore cannot replace the spy, and Vitest later restores the retired wrapper it originally observed.
- A retired wrapper now passes every newly scheduled tween config directly to the original manager. Callback
  objects wrapped while the duo rig was live still retain their disposed lifetime fence, so late old-rig
  completions remain inert while the next solo/duo test cannot lose its own tween completions.
- The node-pure source contract pins this distinction. Behavioral requalification remains remote-only.
2026-07-26 — focused P1 wave-6 biome-permit failure triage and harness realm fix
- Audited hosted focused run `30185663757`: the god soak did not wipe. Both clients completed waves 1-5 with zero findings/assertions/resyncs, committed guest-owned `CROSSROADS_PICK` rev 29 and `BIOME_PICK` rev 30, then the authority entered wave-6 `NewBiomeEncounterPhase` without its exact transition permit and failed closed.
- Root cause is one-process realm persistence, not a missing production V2 commit. `SelectBiomePhase` settles/publishes the guest-owned V2 result first (nested guest context), then `commitBiomeAuthoritativeResult` arms the host-local permit. The nested delivery advances `biomeStateSaveGeneration`; when the resumed outer host scope later exits, the equality-only save fence discards the newly armed permit and retains the pre-publication null snapshot. Separate browser processes cannot lose a module-local permit this way.
- `withClient` and `withClientSync` now save a generation-invalidated biome snapshot only when the exact same `ClientCtx`, scene, and runtime have been restored. Truly overlapping/out-of-order scopes still fail that identity proof and remain fenced. Added a failure-first T2 regression reproducing nested guest delivery followed by host permit arming, plus a source contract for both sync/async paths.
- The earlier retired-tween transparency fix remains at `4673683113`; this change also puts `coop-transition-t2-biome.test.ts` back in the focused planner so hosted P2 will prove that regression rather than relying on source inspection.
2026-07-26 — real-browser fresh-launch false red closed at the observer boundary
- Downloaded and inspected public journey `30185347201` (exact product SHA `6fffcfa98`). Production paired correctly, proved all five slots missing, completed the asynchronous save decision transition, and logged `host decision installed mode=MESSAGE active=true actionable=true`. The journey nevertheless timed out without pressing the prompt.
- Root cause was test instrumentation: `scripts/coop-browser-entry.ts` unconditionally suppressed every `TitlePhase` + `MESSAGE` semantic surface, although its comment intended to suppress only the unbound epoch-0 narration. The host's real launch decision is deliberately that same Title/MESSAGE surface after a positive active co-op epoch. The pair helper also completed fingerprint/checkpoint work after the stable prompt was already installed, then sampled a cursor too late to see the one emitted semantic transition.
- The observer now suppresses Title/MESSAGE only before a positive session epoch. Fresh and resume journeys scan from `pairRoleCursors` (captured before connection), so both valid orderings—prompt before or after `pair()` returns—are deterministic. Product input remains keyboard-only; this only repairs the read-only gold oracle.

2026-07-26 - Same-browser authority-publication realm fidelity
- Focused P2 `30185964266` proved the earlier biome-realm regression but still reproduced the real Crossroads Leave journey: the host committed `BIOME_PICK` revision 8, then its `NewBiomeEncounterPhase` found no exact permit. The earlier regression had the lifecycle order backwards. Production `commitBiomeAuthoritativeResult` arms the host permit before `retainEnvelope` publishes and synchronously delivers guest/ACK callbacks.
- The one-process harness persisted live state only when switching to the other synthetic browser. A callback re-entering the already-installed host instead loaded the host ctx's older exit-time snapshot and erased the permit that had just been armed. Two real browser processes cannot reload an old module realm at callback entry.
- Sync and async client windows now persist any installed browser, including same-browser re-entry, before loading their callback window. The failure-first regression uses the real order: arm the permit, re-enter the host for an ACK callback, then deliver to the guest. The source contract rejects the old cross-client-only condition. Production co-op code and permit validation are unchanged.

2026-07-26 - Scene-bound authoritative mutation ledger
- Revalidated the remaining code-level finding from the stale audit: phase mutation acquisition still used a nullable process-global ledger selector, so a temporarily missing selector let an authoritative phase start without a token. The audit's reward-timeout finding is already closed by retained V2 recovery; this ledger seam was the valid architectural tail.
- Each `PhaseManager` now owns the exact `CoopMutationLedger` bound by its runtime. Authoritative runtime installation makes that binding mandatory; phase start fails closed if it is absent. Runtime teardown clears the scene binding, and solo/lockstep execution remains nullable as before.
- The source contract proves direct binding, authoritative requirement, exact phase acquisition, and ordinary shift settlement. The focused contract passes locally; behavioral and branch-scoped type proof remain on hosted runners per `AGENTS.md`.

2026-07-26 - Exact headless Phaser clock ownership
- Focused B11 run `30186315475` passed 66/67 tests twice and reproduced one identical synthetic stall: all retained V2 work through reward revision 7 was applied and both counters advanced to 1, but the authority remained in `NextEncounterPhase` while the replica waited in `NewBattlePhase`.
- The one-process clock pin trusted only the repeated `host`/`guest` string label. Nested async scopes can have another scene/runtime installed under the same label lifetime, so a MockClock tick could promote or execute an authority timer in the replica realm. Independent browsers cannot create that state.
- MockClock `preUpdate` and `update` now both run under an exact `ClientCtx + scene + runtime` identity. The no-park invariant remains strict; the 64-test Authority V2 source contract pins both halves of the clock and rejects label-only ownership. Hosted B11 is the behavioral proof.

## 2026-07-26 - Human-equivalent post-faint prompt driving

- Real two-browser journey `30186100483` paired, created a fresh run, submitted both public commands, and rendered the complete authoritative turn on both clients through matching status, HP, and faint event receipts. It then timed out with the host visibly parked on the actionable `Chikorita fainted!` MessagePhase while the guest correctly waited in `CoopReplayTurnPhase`.
- This was a browser-oracle omission, not a production desync: TurnEnd had advanced the public address to turn 2 before FaintPhase opened the turn-1 faint narration, while the prompt advancer admitted only the submitted turn-1 address (and the separately proven BattleEnd cleanup exception). No keyboard input was sent despite the semantic surface proving `handlerActive` and `awaitingActionInput`.
- The prompt driver now admits that exact N+1 MessagePhase only when the same browser observed a structural FaintPhase since the scan floor. Epoch and wave must match and the turn must be exactly one ahead; arbitrary future messages remain fail-closed. A failure-first node contract proves both rejection without FaintPhase and one-action consumption after it.

## 2026-07-26 - Stable-actor common battle VFX presentation

- The structured stream already covered move, HP, faint, stat/status, ability, Tera, weather/terrain, and switch
  presentation, but plain `CommonAnimPhase` cues remained authority-only. Berry use, confusion, attract, powder,
  curse, trapping, salt cure, pledge residuals, and ability-triggered item VFX could therefore be visibly absent on
  the renderer even while mechanics and checksums stayed exact.
- Exact plain common phases now author one `commonAnim` event at queue insertion, before their associated state
  mutations can overtake the cue. Source and target carry stable side/Pokemon identities as well as coordinates;
  the renderer resolves only those displayed identities and reports a typed rendered/skipped/failed outcome.
  Environment phases retain their richer weather/terrain event, and `PokemonHealPhase` retains the existing HP/heal
  cue, so neither path double-renders.
- Protocol advances to `er-coop-49`; older builds fail pairing rather than silently omitting the new presentation.
  Source contracts cover the central enqueue seam, strict validator, exhaustive replay switch, and stable identities;
  the focused hosted shard owns behavioral/type proof before this checkpoint can advance.

## 2026-07-26 - Public journey recognizes explicit V2 supersession retirement

- Exact two-browser journey `30187298248` completed three command rounds, two public faint replacements, matching
  mechanical digests, and reached the same actionable reward shop on both seats. Its red verdict was narrower: the
  oracle waited for turn revision 6 to retire through its own `controlInstalled` receipt even though ordered
  `WAVE_ADVANCE` revision 7 explicitly subsumed it after the replica admitted the complete successor image.
- Authority-log supersession was already the intended mechanical behavior: every required peer admitting the exact
  successor retires each listed predecessor and cancels its lease. The receipt verdict/trace now exposes precisely
  which retained revisions that authenticated quorum retired.
- The public continuation proof accepts either the turn's own exact terminal receipt or an exact N+1 receipt whose
  authority verdict names N in `subsumed=[...]`. It still fails closed on an unrelated later entry, missing
  supersession, or a non-adjacent revision, eliminating the false red without weakening retention coverage.

## 2026-07-26 - Common VFX targets use canonical battler coordinates

- Review of the protocol-49 common-animation slice found that `CommonAnimPhase` callers provide global
  `BattlerIndex` values, while the phase had interpreted an explicit target as an index into the opposite side's
  compact field. A player self-effect could therefore bind its authority event to an enemy, and enemy/triple
  self-effects could resolve no target and disappear from both host presentation and the co-op stream.
- Source and target now resolve through the canonical flat field used by `PokemonPhase`. This is presentation-only:
  it changes no move, damage, RNG, or checkpoint material. The node-pure presentation contract pins the flat-index
  lookup so future doubles/triples refactors cannot reintroduce the side-local interpretation.
- The hosted engine fixture no longer blesses the obsolete opposite-side target. It records both player and enemy
  self-effects twice, requires exactly one event per queued phase, and proves each source/target pair retains the
  same stable actor identity. Enemy indices exercise the non-zero side offset that previously disappeared.
- Local permitted evidence: the presentation source suite is 15/15, targeted Biome is clean, and `git diff --check`
  passes. Hosted focused/type and two-browser proof remain required before integration.

## 2026-07-26 - Authority-authored form and Transform presentation

- The renderer's checkpoints already converged ordinary form indexes and most Transform material, but no ordered
  event refreshed those appearances at the host's actual combat boundary. `QuietFormChangePhase` and
  `PokemonTransformPhase` were blocked as mechanical phases, so their sound, sprite refresh, and form narration
  could exist only on the host until a later snapshot silently changed the guest.
- Protocol 50 adds exact stable-actor `formChange` and `transform` events. Dedicated guest replay phases install
  only the immutable authority result, refresh the selected actor's assets/info, and own typed liveness outcomes;
  the original mechanical phases remain forbidden on the renderer. Direct quiet-form narration now enters the
  same ordered stream instead of bypassing the PhaseManager message tap.
- The audit also exposed a material omission: `CoopMonTransform` did not carry Elite Redux's temporary passive
  identities even though production Transform copies them. The full snapshot and presentation result now include
  those exact passive IDs and apply them without running guest ability attributes or RNG.
- Local permitted evidence: the presentation source suite is 16/16, targeted Biome and `git diff --check` pass,
  and the baseline TypeScript scan reports no diagnostics in the changed co-op/form files. Behavioral proof is
  delegated to the focused hosted shard per `AGENTS.md`.

## 2026-07-26 - Representative replay drain and biome-intro input

- Exact full gate `30191375428` on protocol-50 checkpoint `74a4f3297` proved the new production presentation
  schema/build and most shards, then exposed two fixture omissions rather than new mechanical divergence. B4,
  B8, B11, and one catch path all stopped before finalize on a production-queued common/form/Transform replay
  phase that the headless `REPLAY_DRAIN_PHASES` allowlist had never learned to start. The production browser
  naturally starts those phases; the fixture threw before doing so. The drain set now includes all three, and a
  source contract derives every immutable replay phase from the production replay switch so a future event cannot
  be added without the headless harness learning it.
- Continuous and production-fidelity soaks reached real actionable `NextEncounterPhase` /
  `NewBiomeEncounterPhase` MESSAGE prompts at biome crossings, but their dual-event-loop settlement callback only
  drove replacement PARTY input. They therefore labelled a legitimate human dialogue wait as a softlock. The
  reciprocal pump now submits `Button.ACTION` through the public UI only when the exact message handler reports an
  armed prompt, once per prompt generation on each simulated browser. It refuses all authority recovery prompts,
  preserving fail-closed diagnosis instead of auto-healing a genuine product failure.
- The fast resume contract was also stale: production correctly replaced an unbounded `setMode` / mode-chain reset
  with lifetime-fenced `setModeBoundedWhen` and `installHostLaunchDecision`, while the source test still required
  the removed implementation. The contract now pins the safer session-fenced sequence.
- Local permitted evidence: both source suites pass 19/19, `git diff --check` is clean, and the baseline TypeScript
  scan reports no diagnostic in any changed file. Hosted engine/soak shards remain the required behavioral proof.

## 2026-07-26 - Exact campaign frontier triage after protocol 51

- Exact-SHA public Journey `30206941316` and animations-on campaign surface passed. The remaining campaign reds
  separated into three mechanisms instead of one generic stall.
- Depth exposed a real ordering gap at host-owned learn-move: the replica entered the next wave before the exact
  result and overlaid a replay summary there. Host-owned V2 learn-move now retains the real same-wave watcher,
  waits for the exact result, settles it, and only then releases progression. The public driver now proves the
  intentionally asymmetric owner-confirm/watcher-summary surface and drives the owner's two-step decline flow.
- Mystery was a harness false red: the replica had reached the addressed embedded-battle command watcher while
  the authority was still completing the Mystery intro. That exact watcher is now provisional for the existing
  bounded 20-second command-frontier window; it becomes loud again if orphaned beyond the budget.
- Dirty wave 3 revealed a real N/N+1 replay-address bug. A replacement checkpoint advanced the replica cursor
  from turn 2 to turn 3 and opened the correct turn-3 command, but queued its follow-up replay with stale
  `this.turn` (2). After the human submitted the command, that stale finalized replay ended and TurnInit opened a
  duplicate turn-3 command. The duplicate target picker then blocked TURN_COMMIT 18 and REPLACEMENT_COMMIT 19
  forever while the authority advanced to turn 4. The pivot now captures the post-checkpoint live command turn
  and uses it for both the replacement continuation and follow-up replay. A source contract rejects the stale
  pre-checkpoint address.
- Local permitted evidence: 103/103 public Node contracts pass, targeted Biome is clean, and `git diff --check`
  passes. The dirty/depth/Mystery browser behavior still requires exact-SHA hosted requalification; no local co-op
  Vitest or browser campaign was run under the repository policy.
- A second depth-ordering review closed the opposite prompt timing too. A reward result may have queued the
  guest's real `LearnMovePhase` before its V2 prompt is projected, without that phase having become current yet.
  The prompt projector now binds its immutable operation address directly to that exact queued phase. When the
  phase starts it becomes the sole same-wave watcher. Level-up learns, which intentionally have no guest
  `LearnMovePhase`, still use `CoopReplayLearnMovePhase`. This prevents a replay phase from consuming the result
  first and leaving a later reward-continuation copy waiting on an already-settled operation.

## 2026-07-26 - Exact protocol-51 requalification and campaign frontier closure

- The supplied audit targeted the older `ci/coop/v2-showdown-command-coordinate-20260720` line. Its reward-timeout
  P1 is already closed on this line: V2 reward watchers return `recover`, reconnect, and preserve their exact
  surface/counter; the focused barrier contract includes a 20-minute elapsed timeout proof. Its mutation-ledger
  P1 is likewise stale: `PhaseManager` owns the exact scene-bound ledger and authoritative lookup fails closed.
  The audit's promotion-manifest and asset-integrity points remain useful process hardening, but are not evidence
  of a live gameplay defect and no staging or production deploy is part of this checkpoint.
- Exact SHA `ab4dc045d4a82f7f27d70f94f77078d9dafde01e` focused run `30209480381` proved B2. Full gate
  `30209489051` completed 39 jobs green; its Lane-A red was an obsolete fixture expecting a replacement
  continuation to reuse turn 1 after the checkpoint had authoritatively advanced to turn 2. The fixture now
  requires the live turn-2 continuation and rejects the stale address. Remaining static and T4 reds are inherited
  Showdown/Tournament diagnostics outside this co-op-only workstream.
- Journey `30209503511` proved the primary real two-browser fresh/resume path. Its optional reverse fan-out was
  manually enabled without alternate-account secrets, so that dispatch error is not a product verdict; the final
  journey must run with reverse fan-out disabled.
- Campaign `30209490237` split four reds into exact mechanisms. Dirty setup raced a delayed title rebuild while
  walking to Settings; the driver now selects Settings/New Game by semantic option ID, waits for a fresh title
  surface after close, and uses the already-proven four-second per-reaction budget. Mystery reached its embedded
  command after 56 seconds, but the harness recognized the real inactive `CoopReplayTurnPhase` watcher for only
  20 seconds. A watcher is now passive only while it remains the client's current semantic surface and the
  immutable outer deadline diagnoses a genuinely orphaned one.
- Depth exposed a production presentation-ordering hole. On wave 3 turn 2 the authority recorded Sticky Web
  switch-in/stat narration during two replacement phases, then opened command input before the renderer had any
  ordered consumer for those later-turn events. Every `CONTROL_COMMIT` now carries the complete pre-command
  prefix (empty on an ordinary turn); the renderer consumes it before command, proves every typed outcome, and
  deduplicates by the exact control operation ID rather than the collision-prone wave/turn pair. The existing
  turn stream shares the same render watermark, so it cannot display the prefix twice.
- The animations-on surface lane exposed the companion V2 lease cycle. A terminal reward installed
  `AWAIT_SUCCESSOR`; the next wave's priority enemy move fainted a lead before the first command, and the exact
  actionable `MessagePhase` was frozen because the bridge named only `NextEncounterPhase`. `allowNextWaveStart`
  now leases every action-only MESSAGE handler at exact N+1/turn-1 until the command entry can be authored. It
  still rejects non-actionable handlers, choice UI modes, wrong epochs/waves, and later turns. The newly sealed
  command prefix then makes the renderer finish those abilities, attacks, damage, and faint cues before input.
- Permitted local evidence for the pre-command/mystery/dirty batch: 121/121 source/browser Node contracts green,
  targeted Biome clean, `git diff --check` clean, and the repository TypeScript baseline is 216 diagnostics with
  zero in the changed files. The pure V2 lease contract was added to the remote Node suite and must be proven by
  the hosted focused shard; no co-op Vitest, browser, soak, or campaign was run locally.
- The first hosted push correctly refused focused execution because this cross-cutting batch mapped to six engine
  shards, exceeding the five-shard safety cap, so complete gate `30211957153` owns engine qualification. Its fast
  browser contracts exposed one mechanical test migration: the source now proves every *pre-command* prefix, but
  `showdown-browser-evidence` still matched the retired `entry presentation PROVED` log text. The assertion now
  names the generalized fence; no Showdown/Tournament gameplay code changed. Static remains red only on the two
  inherited Showdown/Tournament TypeScript diagnostics that are explicitly outside this co-op-only workstream.

## 2026-07-26 - Command presentation fence follows its actual V2 source entry

- Exact full gate `30211957153` exposed one common product hang across B6, B9, every continuous soak, and P1. The
  replica applied a `TURN_COMMIT` whose typed successor was the next `COMMAND_FRONTIER`, then `TurnInit` queued an
  entry-only replay waiting for a separate `CONTROL_COMMIT`. That second entry is forbidden: the turn entry already
  owns the command. Logs showed revision 2 materially applied with the exact turn-2 control while
  `CoopReplayTurnPhase` remained on `awaiting retained entry presentation` forever.
- Command presentation inspection is now a closed three-way result. A genuine command-open `CONTROL_COMMIT`
  requires its immutable prefix and exact operation watermark; a TURN/REPLACEMENT/interaction result that directly
  states command is `covered-by-source` because its own ordered renderer/finalizer already drained its presentation;
  only a genuinely absent source creates a speculative wait. This removes the impossible carrier assumption without
  weakening presentation proof or using a timeout.
- Both delivery races are closed. When the source is already retained, `TurnInit` does not manufacture the second
  fence. When an early `TurnInit` is already parked as the non-control entry applies, material completion releases
  that exact wave/turn fence with an empty address-bound prefix before waking deferred CommandPhases. A real
  `CONTROL_COMMIT` still cannot release without complete command-open material and every concrete outcome proof.
- Permitted local evidence: presentation + public V2 source contracts pass 87/87, formatting is clean, and
  `git diff --check` passes. Hosted focused engine/type and exact campaign/gate proof remain required; no co-op
  Vitest, browser, soak, or campaign was run locally.

## 2026-07-26 - Public keyboard input is sampled at real frame cadence

- Campaign `30211958410` did not reach co-op in any profile. Every lane failed at the same title-menu Settings
  walk: Chromium's capture listener counted each ArrowUp, focus and visibility were healthy, and Phaser's frame
  counter advanced, but the selected option never changed. The browser was progressing at roughly three FPS
  while `PublicUiClient.press()` held a key for at most 100 ms, allowing the entire tap to occur between game
  updates. The former post-release input echo could diagnose this but could not make the input representative.
- Public input now uses the identical DOM keyboard path while holding each key across two actual animation
  frames, then releases it in `finally`. The frame wait is compositor-only and bounded at five seconds; it reads
  no scene, handler, runtime, storage, or bridge state. A non-rendering focused page fails explicitly rather than
  being misreported as a semantic navigation stall. Input-echo pacing remains the post-action proof.
- A node-pure source contract rejects the old fixed sub-frame tap and pins the down/frame/up sequence. The existing
  public-driver boundary still enforces keyboard/DOM-only mutation: the reusable wait lives in evidence alongside
  screenshot frame settling and exposes no private game state.

## 2026-07-26 - Replacement control cannot become a command-presentation wait

- Full product gate `30212674952` on `3cbd74af0` proved the source-aware command-presentation fix across all five
  campaign shards, both production-fidelity shards, WebRTC/rejoin, mutation assurance, and 31/33 gameplay shards.
  Its sole co-op Lane-B failure was `coop-duo-barrier-deadlock`: after a guest-owned faint replacement, the guest
  remained in `CoopReplayTurnPhase` with its real `CommandPhase` queued behind it. Static remains the inherited
  Showdown/Tournament diagnostics outside this co-op-only workstream; T4 is being classified separately.
- Exact logs showed the remaining race. The settled `TURN_COMMIT` had installed a typed `REPLACEMENT` control, the
  test deliberately dropped the first `REPLACEMENT_COMMIT`, and `TurnInitPhase` treated the absence of a command
  frontier as absence of a command *source*. It therefore queued an entry-presentation-only replay at turn N. That
  phase cannot consume a replacement checkpoint, and the replacement successor authorizes turn N+1, so no legal
  entry could release the mismatched wait.
- Command-presentation inspection now returns a closed `awaiting-replacement-carrier` state for an exact live
  replacement control. `TurnInitPhase` routes that state through the ordinary checkpoint-consuming replay before
  any command phase is created, just as it already did when the carrier happened to be buffered. This covers both
  carrier race orders without a timer, guessed command, or local successor derivation.
- The source contract pins both halves: a typed replacement can never degrade to `awaiting-source`, and an in-flight
  replacement is routed through the non-entry replay transaction. Permitted local evidence is 17/17 presentation
  contracts, targeted Biome, and `git diff --check`; the exact B9 engine proof remains GitHub-hosted per policy.
- Exact-SHA public campaign `30212900164` and Journey `30212894219` on `92cbd7b0` completed red after the frame-held
  keyboard change. Their artifacts still need separate triage before any release verdict; no local browser run was
  used and no staging/production deployment occurred.

## 2026-07-26 - Public key holds are synchronized to Phaser, not Chromium's compositor

- The `92cbd7b0` campaign artifacts resolve the remaining title navigation failure precisely. Every ArrowUp reached
  the capture-phase DOM listener, the page stayed visible and focused, and Chromium rendered many compositor frames,
  yet the semantic title selection remained on New Game. The prior nested `requestAnimationFrame` fix used the wrong
  clock: Chromium may composite at roughly 60 FPS while the CPU-dilated Phaser loop advances at roughly 3 FPS, so a
  down/two-rAF/up sequence can still fit entirely between game updates.
- The read-only browser observer now tracks the raw keys that are currently held, records Phaser's exact frame at DOM
  keydown, and emits input-health evidence on each actual Phaser frame advance while a key remains down.
  `PublicUiClient.press()` holds the same public Playwright keyboard input until a later Phaser frame overlaps that
  exact keydown. It never evaluates, inspects, or mutates private game state; idle pages remain telemetry-silent.
- The behavior contract deliberately inserts a key-up gap and proves it cannot satisfy the wait. The source contract
  rejects compositor `requestAnimationFrame` pacing and pins the observer/evidence/keyboard chain. This repairs the
  harness primitive shared by solo setup, both co-op seats, Mystery, market, rewards, and battle commands rather than
  special-casing the title menu.
- Journey `30213355412` on `ecfb5812` never launched Chromium because the fast V2 preflight required the retained
  replacement probe to spell out its stale epoch/wave/turn rejection. The B9 product fix used an equivalent positive
  predicate, so the test failed on source shape rather than behavior. The probe is again written as explicit
  fail-closed guards without changing its result, restoring that release contract for the next exact-SHA run.
- Permitted local evidence: 76/76 Authority V2/browser contracts, 17/17 presentation-authority contracts, both public
  driver boundary checks, targeted Biome, and `git diff --check` pass. The repository-wide TypeScript baseline remains
  red on inherited files, with no diagnostic in this batch's changed files. Real Chromium and B9 engine qualification
  remain GitHub-hosted under `AGENTS.md`; no local co-op Vitest/browser run or deployment occurred.

## 2026-07-26 - Input proof follows the exact keydown frame through asynchronous UI transitions

- Journey `30214133225` proved that the Phaser-clock direction was correct but its first implementation was stricter
  than a human input. Both registration Enter presses were accepted, both UIs changed to Loading, and both account
  APIs returned 200. The driver still failed because it demanded a second held-key health sample after the first
  accepted frame; the asynchronous login transition delayed that sample until after release. This was a false red
  after successful public input, not a product or registration failure.
- The capture listener now records Phaser's frame on the exact raw DOM keydown. A press releases after one strictly
  later Phaser frame is observed while that same keydown count remains held. A same-frame sample cannot pass, a later
  keydown cannot substitute, and an observed key-up permanently invalidates the proof. This is the minimal exact
  overlap invariant and remains entirely on the public keyboard plus read-only console-evidence boundary.
- Permitted local evidence: 77/77 V2/browser contracts, both public driver boundary checks, targeted Biome, changed-file
  TypeScript filtering, and `git diff --check` pass. The correction still requires exact-SHA hosted Chromium evidence.

## 2026-07-26 - Public input proof handles synchronous handlers and descendant focus changes

- Campaign `30214547132` exposed the final observer mistake in the registration path. The capture listener attached a
  `blur` handler to `window`, so the descendant registration input blurring on submit cleared `heldDomKeys` even though
  the physical Enter key was still down. The trace showed the exact impossible-looking combination: keydown frame 409,
  game-side Loading echo at frame 411, but `downKeys: 0`. The listener now observes only a real window blur.
- Input consumers are not uniform. Menu navigation polls Phaser state on a later frame, while forms and some UI handlers
  react synchronously to the DOM keyboard callback in the keydown frame. The public driver now accepts either proof:
  a changed game-side input echo while the exact key remains down, or a strictly later Phaser frame while it remains
  down. Compositor frames, released keys, later keydowns, and descendant element blur cannot satisfy the wait.
- Permitted local evidence: 78/78 V2/browser contracts, both public driver boundaries, targeted Biome, changed-file
  TypeScript filtering, and `git diff --check` pass. Exact browser proof remains GitHub-hosted.

## 2026-07-27 - Dex Nav authority cutover and browser-failure closure candidate

- Exact `d5dc8194d` qualification established a clean mechanical baseline: the full 44-job co-op gate, focused
  Authority V2 gate, mutation gate, and fresh/resume journey all passed. The remaining public-browser reds were
  individually classified from screenshots, semantic surfaces, ordered V2 logs, and state digests.
- The depth lane found the remaining real interaction seam: `ErDexNavPhase` locally derived a biome pool and the
  watcher skipped rather than participating in the ordered nested interaction. Dex Nav now uses `ABILITY_PRESENT`
  with an immutable authority-owned candidate set, an address-exact owner/watcher phase, a literal result, the
  captured reward return plan, and the ordinary V2 settlement/proof path. Only the item owner writes its account dex.
- Mystery's stale narration ACK lease is retired at the exact ordered ME terminal even when the main pin correctly
  survives into a battle/reward successor. The faint journeys now use self-targeting Healing Wish plus two reserves;
  the old Memento fixture could lose its live target after the attacking partner cleared the field and never faint.
- Four harness false reds were repaired without relaxing state convergence: reward watchers prove explicit input
  blocking; solo CheckSwitch accepts its actual interaction owner model; paired GameOver permits at most two
  post-latch heartbeat/leave refusals; and sequential command scans clone caller cursors so a replacement cannot
  erase a retained frontier proof. The animations-on between-wave ceiling is still progress-gated and immutable,
  but now reuses the measured dense-turn SwiftShader budget after two runs reached command 22-44 seconds late.
- Local policy-compliant evidence is clean: TypeScript, changed-file Biome, `git diff --check`, and the source/evidence
  Node suites. No local co-op Vitest, Chromium, or soak was run; no staging/production deployment occurred. The next
  action is one exact-SHA hosted qualification across depth, Mystery, surface, market, save, GameOver, and both faint
  ownership journeys, followed by the full gate.

## 2026-07-27 - Dex Nav watcher gate uses a live co-op fixture

- Exact full gate `30247099159` on `2eeab52a2` passed static/type, fast public contracts, all Authority V2 mutation
  shards, browser-native WebRTC/rejoin, and 32/33 engine shards. Its sole red was the new Dex Nav owner-gate test:
  the watcher fixture used `coopSeq=-1` with no runtime or relay, which correctly takes the explicit non-co-op end
  path, while the assertion expected a live co-op watcher to remain parked for authority.
- The fixture now installs a real authoritative guest runtime and holds its real interaction relay pending. It still
  requires the watcher to remain parked, never derive the local biome pool, and never open owner OPTION_SELECT input.
  No production behavior or authority rule changed. Hosted B11/focused proof remains required; local co-op Vitest was
  not run under the repository policy.

## 2026-07-27 - Public battle fallback cannot spill into a successor command

- Focused run `30248008171` proved the corrected live Dex Nav watcher fixture and B11 shard green. Full run
  `30247099159` therefore has compositional green evidence for all 44 jobs: its only red was the stale fixture.
- Market journey `30246932430` was mechanically converged at the same authoritative turn address and digest in both
  browsers. Its public evidence showed the authority browser already inside the next Fight submenu while a fallback
  key from the previous turn was still being delivered. Under severe runner dilation the first fallback key had
  visibly entered the turn, but the remaining three keys were queued as an indivisible sequence and crossed the
  authoritative boundary. The sequential command driver then correctly refused to resurrect the superseded menu.
- Battle fallback now rechecks public turn-progress evidence before every individual key. Once any retry visibly
  succeeds, it records the suppressed tail and stops, matching a human who stops retrying when the next turn appears.
  The failure-first contract recreates the successor CommandPhase after the first key and proves the remaining three
  keys cannot open its Fight submenu.
- Policy-compliant local evidence passes: 137/137 public source/evidence contracts and both sealed public-driver
  boundaries. Exact two-browser market proof remains GitHub-hosted; no local Chromium or co-op Vitest was run and no
  deployment occurred.

## 2026-07-27 - Mystery reward retains its semantic confirmation boundary

- Mystery campaign `30246925309` reached the same wave-2 reward address, options, owner, and mechanical digest in both
  browsers. The final screenshots showed the owner in the real `reward:confirm` Yes/No dialog and the watcher parked
  on its blocked reward replica; this was not a production divergence or softlock.
- The Mystery checkpoint returned only a target-wave boolean. Its caller therefore discarded the already-proven
  owner boundary and sent `Backspace, Space` as one blind reward macro, opening the confirmation but never driving it.
  Paired Mystery checkpoints now return their actionable owner event and watcher events as a mechanical boundary.
  Reward surfaces retain that boundary and route through the ordinary address/digest-exact confirmation barrier.
- A behavior contract proves the boundary is selected from the actual owner even when the watcher event arrives first,
  and the campaign source contract proves the Mystery result is wired into semantic leave. The focused Mystery Node
  suite passes 30/30 and the sealed public-driver boundary passes. Hosted Chromium replay remains required; no local
  browser or co-op Vitest run and no deployment occurred.

## 2026-07-27 - Remote replacement and recovered wave tails remain in one ordered V2 chain

- The failed fresh journey's public guest trace exposed one continuous production failure, not a generic timeout. Its
  parked TURN revision 3 admitted a remote-owned replacement CONTROL revision 4, but the renderer had no local picker
  and therefore never retained that intermediate control. The immutable REPLACEMENT revision 5 was then two revisions
  beyond the parked turn and could not release it. Recovery eventually installed wave DATA and its exact reward, but
  left the obsolete pending wave bootstrap alive; after the reward an unsigned local NewBattle tail fell through an
  empty queue, repeatedly manufactured TurnInit/Replay against the retained won wave, and overflowed the call stack.
- A remote-owned replacement CONTROL is now an authenticated intermediate bridge: the parked finalizer retains its
  exact operation and releases only for the consecutive matching REPLACEMENT_COMMIT. The runtime presents that control
  to the finalizer even though no renderer-owned picker exists. A phase-level regression proves the open does not shift
  and the exact immutable result shifts once.
- Completing an exactly projected wave transaction now retires the matching one-shot pending bootstrap, so recovery
  cannot later replay the resolved Victory boundary. Every ordinary reward/market terminal, including a recovery-
  restored phase, also removes unsigned NewBattle tails and installs the committed V2 next-wave wait before teardown.
- Policy-compliant local evidence is clean: all 280/280 public source/evidence contracts (including 86/86 Authority V2
  contracts), both sealed public-driver boundaries, targeted Biome, `git diff --check`, and changed-file TypeScript
  filtering. The repository TypeScript baseline remains inherited-red with no diagnostic in this batch's files. Co-op
  Vitest and real Chromium qualification remain GitHub-hosted; no deployment occurred.

## 2026-07-27 - Signed Mystery wave entry and repeated-presentation ordering

- Lane P proved that a terminal reward's signed N+1 wait could create a destination Battle only for a command control.
  A legitimate Mystery-first wave therefore parked forever: the retained `ME_PRESENT` carried complete state, but the
  guest correctly refused to apply wave-N+1 DATA to wave N and no local classifier was allowed to choose the successor.
  The same exact wait now admits a non-battle `INTERACTION_COMMIT`, creates only the destination Battle identity through
  `newCoopV2ProjectedBattle()`, and leaves all mechanical mutation and presentation authority to that ordered entry.
- The Mystery engine fixture now follows the production graph: authority publishes `ME_PRESENT`, then the renderer
  consumes the projected replay. It no longer advances the guest's local NewBattle tree until the guest independently
  rolls a Mystery phase, which had hidden the missing V2 bridge from the gate.
- A repeated Mystery campaign exposed a separate false desync. The legacy `meChecksum` is transported immediately before
  the retained V2 presentation, but predecessor teardown can delay applying that entry across multiple Phaser frames.
  The verifier now waits for a newer accepted V2 state tick under a bounded 15-second ceiling before escalating; an
  already-applied genuine mismatch still takes the correlated recovery path immediately in the focused test.
- Market evidence found a public-driver spill rather than product divergence: both browsers had reached the exact next
  command address after the old TurnStart line fell outside the evidence cursor, and the remaining fallback keys opened
  the successor's Ball menu. Only an exact same-epoch/wave, turn+1 owned command suppresses the retry; same-address
  re-emission remains pending.
- Policy-compliant local evidence is clean: 123/123 focused Node source/evidence contracts, changed-file Biome,
  formatting, and `git diff --check` pass. The inherited TypeScript baseline remains 575 diagnostic lines with none in
  this batch's changed TypeScript files. Co-op Vitest and real Chromium qualification remain GitHub-hosted; no deployment
  occurred.

## 2026-07-27 - A remote replacement control cannot release its own source turn

- The exact `06b7be4de` dirty-account campaign reached wave 2 mechanically converged, then exposed a real V2 control
  error. TURN_COMMIT revision 8 correctly stated a host-owned replacement and the host opened its actionable PARTY
  picker. On the renderer, the safe-boundary retry presented that same TURN_COMMIT back to its parked finalizer; the
  finalizer mistook the executable control for the replacement answer, ended, and synchronously regenerated
  TurnInit/CoopReplayTurn 959 times until the stack overflowed. The later immutable result had not yet been chosen.
- Remote replacement opens are now retained for both legitimate shapes: a replacement stated directly by TURN_COMMIT
  and a later CONTROL_COMMIT after an ordered wait. The renderer has no local picker wake, so only the consecutive,
  operation-exact REPLACEMENT_COMMIT may release its finalizer. Local-owned replacement control still releases into its
  real projected PARTY picker, preserving input actionability.
- A failure-first engine regression models the exact revision-8 TURN source, asserts zero phase shifts while the remote
  picker is open, then proves revision-9 immutable material advances the live turn cursor and releases exactly once.
  The fast source contract also pins both control-open entry kinds.
- The prior candidate's real two-browser faint/replacement journey `30251023444` passed end-to-end. The new dirty-lane
  failure is therefore narrower than generic replacement handling and was found only because the campaign exercised a
  surviving-wave, remote-owned faint while the dedicated faint journey covered a different replacement topology.

## 2026-07-27 - Mystery identity and completed-wave interaction material are address-exact

- Exact gate `30254593293` proved the signed Mystery bridge creates the correct destination Battle and replay phase,
  but also exposed that `ME_PRESENT` carried labels and a battle checkpoint without the host-selected encounter type.
  The renderer therefore had no authoritative identity from which to render the event. Every host presentation now
  carries that immutable descriptor; V2 rejects an absent descriptor before revision construction, and the guest
  installs only the type without constructing a second local Mystery mechanics engine.
- The same gate caught the opposite wave race at Crossroads. A result retains its completed source-wave address while
  the renderer can already expose the next Battle object. Cross-wave admission now accepts that older result only when
  the live Crossroads/Map phase proves the exact operation ID and exact retained source wave. Arbitrary stale entries,
  replaced phase generations, wider gaps, and all other interaction kinds remain fail-closed.
- Local work remains policy-limited to source/evidence, formatting, ownership, and changed-file type checks. Co-op
  Vitest and two-browser qualification are dispatched only on GitHub-hosted runners; no deployment occurred.
- The old-tip faint journey `30254602335` also proved all 16 current-epoch combat presentation events matched exactly
  (host authority and guest renderer, sequence 0 through 15), but its oracle sliced the two browsers at unrelated
  wall-clock evidence cursors and reported only the guest's final two receipts. Shared-command proofs now compare the
  complete canonical current-epoch prefix, which is stronger and insensitive to independent renderer scheduling.
- The depth lane in campaign `30254595511` exposed the same invalid shared-clock assumption in its continuation proof:
  the exact `TURN/e.../w4/t1` receipt and retirement were present and the guest reached the identical reward at V2
  frontier 25/25/25, but the receipt preceded the host's local cursor while the renderer ACK followed the guest's.
  Exact V2 operation IDs are epoch-unique, so those two identity proofs now scan the complete host trace.
- The dirty lane in that campaign exposed a real wave-win deadlock. BattleEnd inserted the actionable scattered-money
  MessagePhase (`You picked up ₽400!`) at wave 3/turn 3 ahead of `CoopVictorySealPhase`, while the preceding turn's
  exact AWAIT_SUCCESSOR froze that presentation and made its explicitly allowed WAVE_ADVANCE unreachable. That ordered
  wait now leases only an actionable same-wave, exact-next-turn MessagePhase when WAVE_ADVANCE is named; wrong phase,
  wrong address, non-actionable, and no-wave waits remain frozen.

## 2026-07-27 - Complete V2 command state retires split compatibility wave carriers

- Exact Mystery campaign `30265192044` reached Gentle Giant at wave 2 and exposed a real authority inversion. The host's
  complete V2 command-open state tick 29 carried both Torterra with SLEEP and five turns remaining, and the guest applied
  it successfully. An older `enemyPartySync` tick 27 had already donated its state half to presentation, so the later
  CommandPhase could no longer compare that tick; it consumed the remaining legacy enemy manifest and rebuilt both
  enemies without status, producing the only mechanical digest difference.
- After a complete command-open state applies, the runtime now atomically retires every split enemy/encounter/state
  compatibility carrier at or below that authoritative tick before marking material applied or releasing public input.
  The existing per-wave floor rejects delayed dominated replays while preserving strictly newer same-wave carriers.
- Failure-first coverage consumes the old carrier's state half before retirement, then proves its manifest and encounter
  descriptor cannot survive or reappear. The fast source contract pins complete-state apply -> retirement -> material
  proof -> command release ordering. Policy-compliant local evidence is 93/93 contracts, targeted Biome, and
  `git diff --check`; the stream regression and real two-browser Mystery proof remain GitHub-hosted.

## 2026-07-27 - Split wave-carrier provenance replaces premature global retirement

- Focused gate `30267802784` disproved the first retirement boundary. The complete V2 state correctly materialized wave
  2, but deleting the raw carrier immediately also removed the permit that `NextEncounterPhase` still consumes before it
  may advance. Host replays stayed below the new retirement floor, so P1 and C3 parked forever on the wave-2 transition.
- The runtime no longer globally retires compatibility material when command-open applies. Instead, the party projection
  retains its immutable source tick even after presentation consumes the carrier's state projection. `CommandPhase`
  atomically consumes the remainder and skips its lossy rebuild when that source tick is lower than or equal to the
  already-applied complete V2 state. This preserves the encounter permit while fencing the Gentle Giant status overwrite.
- The failure-first stream regression now proves the source tick survives split consumption, and the fast contract pins
  provenance-based rejection plus the absence of premature control-apply retirement. Local policy-safe evidence is
  93/93 Authority V2 contracts; engine and two-browser proof remain remote-only.

## 2026-07-27 - Retired waits retract stale stall claims

- Focused gate `30269276702` validates the provenance correction across every selected runtime shard: static, B7, S5,
  P1, T4, and C1 are green, including the previously stuck wave-2 transition. Lane A passed 116/117 tests; its only red
  was a new optional-encounter assertion whose fixture had not supplied an encounter. The regression now supplies and
  verifies the complete immutable descriptor rather than expecting transport to invent one.
- The exact faint journey `30265194132` was mechanically and visually synchronized through the wave-2 command screen,
  but exposed a watchdog false positive. The guest retired its replacement wait, committed the wave and reward, and
  opened the shop; one second later the host interpreted the guest's last positive beat from the retired wait as proof
  of a mutual deadlock. The guest's shop rendezvous arrived three milliseconds after that recovery diagnosis.
- A positive stall beat is now explicitly retracted with a zero beat whenever its local wait resolves, falls below the
  reporting threshold, or becomes a protected V2 human-input lease. Mutual recovery also requires the condition to
  persist across two watchdog samples, so a timer may no longer join two unrelated waits into a false deadlock. A
  failure-first fake-timer regression recreates the crossing exactly while preserving normal confirmed-deadlock
  recovery. Co-op Vitest and the exact two-browser faint replay remain remote-only; no deployment occurred.

## 2026-07-27 - Future-wave replacements are ordered before the encounter

- Exact baseline qualification is green at `dfbba16b7`: focused gate `30270057315` passed and all 45 jobs in sharded
  gate `30271119785` passed. The calibrated release soak `30271751644` then found a common real-engine frontier in the
  level and god-a lanes while journey and Mystery-asymmetry remained green.
- The host entered wave N+1 with a fainted lead, committed the complete N+1/t1 `REPLACEMENT_COMMIT`, and only then
  committed command-open. The renderer correctly deferred that future-wave replacement while still on wave N, but its
  signed `NewBattlePhase` accepted only command or interaction successors. Revision N+1 therefore stayed
  `materialDeferred`, revision N+2 stayed behind the gap, and the UI parked forever on `NewBattlePhase` with
  `CoopPartnerSyncPhase` queued.
- A complete replacement is now a typed first-class next-wave successor. The parked phase validates its exact epoch,
  operation, address, successor wait, and positive state tick; creates only the signed destination Battle shell; and
  routes the retained checkpoint through the ordinary replay transaction. Switch/post-summon presentation and checksum
  proof complete before `NextEncounterPhase` starts. Chained local- and remote-owned replacements preserve the same
  continuation until every field slot is settled.
- Policy-safe local evidence is clean: the Authority V2 source contract passes 93/93, changed-file Biome and
  `git diff --check` pass, and TypeScript reports 215 inherited errors with zero in the changed files. Engine and
  two-browser replay proof remain GitHub-hosted; no deployment occurred.

## 2026-07-27 - V2 guest command control cannot deadlock on sequential field ownership

- The exact market-wide-lens browser artifacts reproduced the testers' live "partner is choosing a move" stall after
  a successful guest-owned Mystery. Both replicas had applied the complete wave-2/t1 command frontier at revision 10,
  but the encounter assigned the guest to field 0 and the host to field 1. The guest parked its already-proven field-0
  CommandPhase on the legacy reciprocal rendezvous; the host could not reach its later field-1 arrival until it received
  the guest's field-0 command. That dependency cycle is why the common host-field-0 fixture and prior soaks missed it.
- Under the complete Authority V2 control cutover, the authoritative guest now announces the exact command rendezvous
  point without awaiting it. This happens only after the command ledger has proven the stated owner, actor, wave, turn,
  and real installed CommandPhase. Host-side waiting remains intact for replacement/presentation pacing, so the #839
  protection is preserved in both ownership layouts while the obsolete guest wait can no longer seal its own command.
- A source contract pins ARRIVE-ONLY before every reciprocal await path. Policy-compliant local verification remains
  source/static only; the exact reversed-ownership engine and two-browser replays are dispatched to GitHub-hosted
  runners, with no local co-op Vitest/browser execution and no deployment.
- The preceding replacement candidate's focused gate passed static and every selected shard except lane A. Its sole
  failure was a stale transaction assertion: production intentionally added the explicit `command-or-wait`
  continuation argument, while the test still expected the old five-argument replay constructor. The contract now
  asserts the complete six-argument call; no production behavior was changed for that gate-only correction.
- The baseline depth campaign was also a harness false red after four fully synchronized waves. Both replicas proved
  wave 5/t1 at the same address and digest, with an actionable owner and a passive `command:watcher`; classification
  nevertheless required both replicas to publish the legacy v1 owner observation. Passive watchers intentionally emit
  only the V2 semantic surface. Battle-kind classification now consumes every current owner observation that exists,
  still rejects disagreement between multiple owners, and relies on the immediately preceding shared-frontier proof
  for the passive replica. Focused behavior tests cover both the owner/watcher layout and real divergence.

## 2026-07-27 - Authoritative NONE clears suppressed terrain state

- Calibrated soak `30271751644` god-b remained mechanically synchronized through wave 61, then exposed a real
  non-convergent terrain split at wave 62: the host's complete state carried terrain NONE while the guest retained
  terrain 5. Every checkpoint and full-state retry logged the clear as applied, but the next checksum still read 5,
  eventually terminalizing an otherwise healthy session after the recovery deadline.
- ER Clueless suppresses the effective `Arena.terrainType` getter to NONE while intentionally retaining the underlying
  Terrain object. Terrain management also used that effective getter, so authoritative `trySetTerrain(NONE)` mistook
  the stored terrain for an already-clear arena and performed no mutation. `canSetTerrain`, the Toxic protection gate,
  and the clear-message source now use the stored terrain identity; gameplay effect queries keep using the suppressed
  getter as designed.
- A failure-first real-engine regression creates a five-turn stored terrain, activates the Clueless suppression view,
  applies a complete signed NONE state, and requires the underlying object to be removed. The regression and the exact
  god-b soak remain GitHub-hosted under the co-op test policy; no deployment occurred.

## 2026-07-27 - Commander auto-skip attests its real pre-start command boundary

- Focused gate `30276032723` ran 82/83 lane-B tests green. Its only failure was fixture ordering: `buildDuo`
  started the real guest-owned CommandPhase, drained its effects, and only then attempted to mark that phase as the
  public command boundary. Commander correctly installs an automatic skip and can finish synchronously, so the current
  phase had already advanced to TurnStartPhase even though the real queued CommandPhase had just executed.
- The harness now attests the exact current, address-matched CommandPhase immediately before starting it. Normal input
  phases and synchronous automatic commands share the same proof edge; production code is unchanged, and a healthy
  Commander transition can no longer produce a timing-dependent gate red.

## 2026-07-27 - Guest-owned biome transitions retain their committed encounter tail

- Calibrated god-c soak seed `20470486` remained synchronized through wave 169, then stalled after the wave-170 World
  Map result: the host reached `PartyHealPhase`, while the guest retained revision 1128 in `materialDeferred` and stayed
  in `SelectBiomePhase`. The relevant earlier boundary was wave 160, where the guest owned the natural map pick.
- That wave-160 result correctly installed and prepared the guest's exact BIOME_PICK permit, but the already-signed
  `NewBattlePhase` always queued `NextEncounterPhase`. It therefore skipped `NewBiomeEncounterPhase`, never finalized
  the one-shot permit, and still appeared healthy for nine more waves. The next BIOME_PICK correctly refused to replace
  that apparently unfinished permit, producing the delayed softlock.
- A signed destination command now selects `NewBiomeEncounterPhase` only when the current scene has the exact complete
  permit for that epoch, destination wave, destination arena, and all switch-preparation stages. Ordinary transitions
  retain `NextEncounterPhase`. The natural guest-owned real-engine regression now drives through wave-11 actionable
  command and requires both browser-scoped permits to be finalized, closing the coverage gap that stopped at the
  interaction counter.
- Co-op engine and browser proof remain remote-only. Local verification is limited to source/static/type policy checks;
  no deployment occurred.

## 2026-07-27 - Pre-encounter replacement control creates its signed destination shell

- Diagnostic soak `30276550644` separated two real progression failures from two stale coverage reds. The level lane
  parked at wave 3 and god-a parked at wave 34 with `NewBattlePhase` current and `CoopPartnerSyncPhase` queued. In both
  traces, revision N was a complete pre-encounter `replacement-open` CONTROL_COMMIT for wave N+1/turn 1 while the
  renderer still owned wave N. Revision N+1 was its REPLACEMENT_COMMIT, so deferring N until N+1 created a strict
  global-log cycle that no timeout or redelivery could resolve.
- The signed `NewBattlePhase` wait now recognizes only an exact same-epoch, pre-encounter replacement-open addressed to
  its N+1/turn-1 destination. It creates only the projected Battle identity before the complete immutable state applies.
  A local owner releases into the exact replacement picker; a remote owner retains the structural phase until the
  consecutive REPLACEMENT_COMMIT supplies the chosen checkpoint and presentation. Unrelated phases, wider wave gaps,
  settled-wave replacements, invalid state ticks, and mismatched control addresses remain fail-closed.
- The same diagnostic proved god-b and god-c mechanically completed all requested 70 waves. Their only red was
  `operation:op:wave` coverage: Authority V2 correctly suppresses the legacy operation journal that the coverage tap
  still consulted. The tap now maps final INTERACTION, REPLACEMENT, WAVE, and TERMINAL entries to the existing semantic
  operation registry, preserving the coverage requirement without demanding a retired legacy carrier.
- Policy-safe local evidence is the 94/94 Authority V2 source contract plus formatting/static/type checks. The real
  level/god-a reproductions and complete focused gate remain GitHub-hosted; no deployment occurred.

## 2026-07-27 - A no-choice replacement remains parked until its immutable result

- The animations-off depth campaign reached wave 3, committed turn 1, and opened guest-owned replacement control for
  a fainted field slot whose owner had no legal bench. The replica correctly published one addressed `NONE`
  observation, but `CoopGuestFaintSwitchPhase` then shifted locally. Its empty queue inferred `TurnInitPhase`, which
  recursively opened a stale turn-1 replay until the browser stack overflowed and the shared session terminated.
- A `NONE` proposal is now only an observation for the authority. The no-choice phase exposes no PARTY surface and
  remains as a passive, scene-current structural wait. It accepts only the same-generation, same-epoch, exact-operation
  `REPLACEMENT_COMMIT`; the runtime has already retained that entry's complete replacement carrier before this release,
  so the following TurnInit consumes DATA instead of deriving progression.
- The source contract now rejects any local shift/end in the no-choice observation branch and proves that only the
  exact immutable result can release it. Local policy-safe evidence is 94/94 Authority V2 contracts, Biome clean,
  `git diff --check` clean, and no changed-file TypeScript diagnostics. Browser/engine qualification remains remote.

## 2026-07-27 - Soak replacement driver recognizes an already-installed immutable successor

- Diagnostic soak `30279420456` proved `god-b`, `god-c`, the 45-wave journey, and asymmetric Mystery/faint green. Its
  `level` and `god-a` reds both ended with synchronized fields, Authority V2 frontiers fully applied, and both clients
  on the exact destination `CommandPhase`; the one-process reciprocal helper nevertheless spent five seconds searching
  for the preceding `CoopGuestFaintSwitchPhase`, which the committed replacement had correctly superseded.
- The reciprocal driver now treats that picker as superseded only when the guest is on the requested destination
  wave/turn, the current CommandPhase owns the guest field index, and the public UI is already COMMAND/FIGHT. A stale,
  wrong-slot, wrong-address, or non-actionable CommandPhase still fails closed.
- The source contract requires this exact successor proof before any picker search. Local policy-safe evidence is
  95/95 Authority V2 contracts, formatting clean (only inherited complexity notices), `git diff --check` clean, and no
  changed-file TypeScript diagnostics. The deterministic level/god-a reproductions remain remote-only.

## 2026-07-27 - Authority move animation callbacks are mechanically bounded

- The animations-on surface lane in campaign `30275884200` recorded Lovely Bite (`moveId=5008`) and its immutable
  `moveAnim` event, then left the authority in `MoveEffectPhase` indefinitely. The renderer was correctly waiting for
  later signed material; the mechanics host alone still trusted `MoveAnim.play()` to invoke every target callback.
- Authoritative co-op move animation now uses the same frame-progress wall-clock watchdog as the replay presentation
  phases. Normal completion removes it, a start throw settles only that target, and a lost callback advances mechanics
  exactly once. The guard is restricted to authoritative co-op, leaving solo, Showdown, and tournament behavior
  unchanged. Late animation callbacks cannot double-apply the move.

## 2026-07-27 - Embedded Mystery battles expose their exact next-wave presentation

- Campaign `30275884200` also proved both browsers had already left the wave-2 Mystery battle and installed the same
  wave-3/turn-1 `NextEncounterPhase` (epoch, membership, connection generation, encounter type, and state digest all
  matched). The browser driver knew only reward, wipe, faint, and command outcomes, so it called that healthy direct
  transition a wave-2 softlock and never pressed the already-visible wave-3 prompt.
- The outcome oracle now accepts only a paired, current, exact-next-wave `battle:message` presentation with identical
  immutable identity on both browsers. It preserves the submitted-turn evidence floor so the between-wave driver can
  consume a prompt that was already visible before battle classification returned; any digest/address mismatch stays
  red. Failure-first browser-unit coverage proves both acceptance and rejection.

## 2026-07-27 - Replacement supersession is recognized throughout the bounded picker pump

- Exact diagnostic soak `30280934116` made the earlier replacement harness correction more precise. Level wave 3 and
  god-a wave 34 reached the exact actionable guest `CommandPhase` while the bounded picker search was already running.
  The pre-search supersession probe happened a few milliseconds too early, and the pump then rejected the healthy
  CommandPhase because its match predicate still accepted only the retired replacement picker.
- The exact destination command proof is now shared by both the initial probe and every pump iteration. A late command
  match exits without starting it as a replacement phase. Wrong field, wave, turn, mode, or phase remain rejected.

## 2026-07-27 - A consumed biome permit cannot block a later ordered World Map result

- The same soak's god-b lane played mechanically synchronized through wave 35, then a guest-owned Crossroads -> World
  Map choice remained parked. The payload was valid (`choice=0`, Temple `biomeId=29`); `biome=undefined` in the log was
  only obsolete reverse-enum formatting. The host's exact refusal was `host-permit-slot-busy`.
- A wave-30 transition had reached `encounterAdopted` and gameplay continued for five waves, but a displaced encounter
  finalizer left that fully consumed permit as a tombstone. The renderer gate already allows a later same-session,
  ordered permit and performs the real revision check after commit. The earlier revision-less reservation preflight
  now mirrors that narrow rule instead of rejecting the proposal before it can receive a V2 revision. Unconsumed,
  cross-session, and earlier-wave permits remain fail-closed.
- A two-engine regression constructs the consumed tombstone and requires the later guest-owned map proposal to retain
  for authoritative commit. Local policy-safe evidence is 182/182 fast architecture/browser contracts,
  `git diff --check`, TypeScript's 215 inherited diagnostics with zero in changed files, and scoped formatting. The
  pre-existing `coop-biome-operation.ts` import-cycle diagnostic is unchanged. Engine, soak, and two-browser proof
  remain GitHub-hosted; no deployment occurred.

## 2026-07-28 - Exact campaign/soak evidence closes four retained progression stalls

- Exact level soak `30283625218` reached synchronized wave-3 CommandPhase on both engines after replacement revision
  12 and command revision 13. The generic duo driver had sampled that same phase before its frontier became actionable
  and never sampled it again. Its bounded wait now re-evaluates the full address predicate after local continuation work
  and peer delivery; phase-name shortcuts remain forbidden.
- God-b's wave-62 host/guest terrain split was a real material-application bug: the guest received authoritative NONE,
  but its local Stench/Toxic-protection belief vetoed the clear. Checkpoint, complete-state, and heal-snapshot installers
  now bypass gameplay-only terrain persistence only after their immutable material has validated. Ordinary gameplay
  still protects Toxic Terrain, and direct field faint state now prevents stale party data from publishing impossible
  command actors.
- Dirty campaign revision 19 exposed the corresponding wiped-seat control edge. A replica with no living local actor
  now retires the finalized faint-turn pump into an exact entry-prefix watcher for the adopted next turn. It can apply
  and receipt the global command without inventing a CommandPhase, then waits for the surviving partner's real turn.
- Depth exposed an acknowledged Mystery prompt whose old host handler was structurally superseded before its 50ms
  actionability retry. A new host-authored narration may retire that prior lease only after its exact guest
  acknowledgement; its stale retry is cancelled before the successor is installed. An unacknowledged overlap remains
  a shared terminal. The Mystery browser checkpoint now waits for the guest to project the host's exact immutable
  surface rather than treating one transient host-ahead frame as divergence.
- The exact-browser bundle no longer replaces production's 120-second presentation hard wall with a 576-second
  per-callback CI value. Surface qualification therefore exercises staging semantics. Local policy-safe evidence is
  118/118 architecture/presentation contracts, zero changed-file TypeScript diagnostics, scoped formatting, and
  `git diff --check`; real
  engine, soak, and two-browser qualification remain GitHub-hosted. No deployment occurred.

## 2026-07-28 - Final-boss presentation, form ordering, actionable soak sampling, and campaign frontiers

- God-b/god-c reached wave 200 with the exact final-boss entrance presentation already committed, but
  `NewBattlePhase` retired the direct renderer buffer before the late `CoopReplayTurnPhase` consumer installed. The
  replay phase now reads the exact retained `COMMAND_FRONTIER` presentation prefix from the Authority V2 ledger,
  validates its address/control, and renders it normally; it does not skip entrance abilities, messages, or stat
  changes.
- God-a wave 115 exposed a delayed enemy `QuietFormChangePhase` recreated by `leaveField()` after the turn's causal
  recorder closed. Co-op recording now suppresses only that inert enemy revert and makes material summon/switch form
  changes causal while the recorder is open. Player material changes remain recorded; solo, Showdown, tournament, and
  lockstep retain their previous phase ordering.
- The one-process soak driver used `UiMode.COMMAND` as a proxy for human actionability and could sample a wave after
  only one owned command proof. It now requires the live exact handler, its V2 actionability/phase-ready proof, carrier
  application through the authoritative tick, and a guest-owned command proof. Natural peer delivery is pumped before
  recovery, and recovery cannot erase a persistent unexpected wave-start mismatch.
- Browser-campaign Mystery narration and dirty one-sided command edges are now treated as bounded provisional work
  only with exact current semantic evidence. Historical proof may be reused only at the same address/digest with the
  explicit repeat fence. Stale semantic-only reward targets no longer mask newer real surfaces.
- Depth wave 2 proved a real nested-reward retry seam. Declining a TM learn correctly reopened the copied reward pool
  at the same interaction pin, but terminal idempotency was scoped only by pin/stream, so the new human action reused
  an already-committed operation. Terminal identity and watcher late fences now include the ordered presentation
  generation: same-generation transport retries remain idempotent and stale, while a strictly newer copied
  presentation receives the next deterministic operation ordinal and remains executable on both owner and authority
  watcher. The failure-first engine regression proves both halves.
- The animations-on surface campaign still covers entry, move, damage, faint, replacement, and both reward-owner
  directions, but now targets two waves and receives an explicit 65-minute job budget. Its prior three-wave red was a
  lifecycle kill during continuous healthy animation progress, not a gameplay stall.
- Policy-safe local evidence: 60/60 focused browser/source contracts and syntax checks green, formatting and
  `git diff --check` clean. Co-op Vitest, Chromium, deterministic soak, and full sharded qualification remain remote by
  repository policy. No staging or production deployment occurred.

## 2026-07-28 - Retained command presentation carries its complete V2 state image

- Focused C 2/5 on `4fd7dda61` delivered turn-one `CONTROL_COMMIT` while the guest fixture was still leaving
  `LoginPhase`, so Authority V2 correctly deferred DATA until a real engine consumer existed. The later
  `CoopReplayTurnPhase` recovered the retained presentation and its tick 3 watermark, but only applied the older tick 2
  enemy-party compatibility carrier; it then failed closed with `requires state tick 3, applied 2`.
- The immutable V2 presentation prefix now includes the complete command-open state that authored its events. Both the
  direct parked-phase release and the late ledger fallback carry that image. The exact address-checked replay phase
  installs it only when its applied tick is behind, before any entrance ability/message/stat presentation is queued.
  A final-boss consumer already at the signed tick performs no reapply, while an early-admitted/deferred command-open
  now has a legitimate material consumer instead of terminating the shared session.
- This remains co-op Authority V2 code only. Showdown and tournament are untouched; their old lockstep architecture
  keeps its existing behavior. Engine and full browser qualification remain remote-only; no deployment occurred.

## 2026-07-28 - The pre-command fence reasserts state mutated by the encounter shell

- Calibrated level soak `30326953423` found one real wave-31 field divergence: the host's Honedge entered with signed
  HP/max-HP 58 while the guest exposed 56. The tick-571 command state had applied successfully during
  `SwitchBiomePhase`, but the renderer's subsequent `NewBiomeEncounterPhase` shell recalculated the guest object's
  derived stats. The old presentation fence saw that tick 571 was already accepted and treated the matching carrier as
  proof without restoring its contents.
- The exact address-checked pre-command presentation fence now reasserts an equal accepted tick after all local
  encounter-shell setup and before rendering the retained entrance events. A strictly newer accepted tick still
  supersedes the older carrier, so delayed compatibility presentation cannot roll state backward. This closes the
  authoritative-state-to-real-CommandPhase mutation window rather than teaching the soak to ignore it.
- Showdown and tournament remain untouched. Engine, calibrated soak, and two-browser qualification remain remote-only;
  no deployment occurred.

## 2026-07-28 - Entry presentation cannot leak intermediate mechanics into command control

- Exact god-c soak `30327843809` reached wave 114 with both replicas on the same signed tick 2338, then found one
  real stat-stage divergence: Eternatus was authoritative attack stage 0 on the host, while the guest retained +2.
  The guest log proved the tick-2338 state applied and reasserted before presentation; one of the 31 retained entrance
  cues then set the live stage to the streamed intermediate +2. A later host-only mechanical reset had no visual cue,
  so presentation left that intermediate value behind when command control opened.
- The single retained-prefix proof fence now receives the complete immutable command-open image and reinstalls it
  after every ability/stat/HP/field cue has drained, but before advancing the rendered watermark or consuming the V2
  command carrier. Equal ticks are transactionally reasserted, a missing V2 image fails closed, and a strictly newer
  accepted tick still supersedes the older cosmetic prefix. Visuals remain complete while mechanics are exact.
- A real-engine regression mutates a live stat stage after accepting the signed image and requires the finalizer to
  restore it before control retirement. Local policy-safe evidence is 306/306 browser/source contracts, clean full
  TypeScript, scoped formatting, and `git diff --check`. The exact god-c seed and full remote qualification remain the
  required proof; wave 140's later recursion/no-park red stays independently owned unless the clean rerun removes it.
  Showdown and tournament remain untouched; no deployment occurred.

## 2026-07-28 - Embedded Mystery markets become typed retained V2 destinations

- Exact Mystery gauntlet `30327840863` failed at wave 2 on Import Bazaar with `A no-battle Mystery reward callback
  had no typed reward-surface plan.` This was a production fail-closed result, not harness noise: Import Bazaar, Exotic
  Trader, and Black Market were the only encounters still assigning raw `doEncounterRewards` callbacks after a pick.
  The host could open those shops, but the retained P36 settlement could neither name nor reconstruct them.
- The closed reward projection now has a validated `market` arm carrying the exact curated subtype. One shared mapping
  resolves that subtype to its concrete phase for ordinary V2 projection, recovery, proof, host opening, and guest
  reconstruction. All three encounters use the typed adapter; raw callbacks remain rejected rather than silently
  falling back to locally inferred UI. Modifier and egg reward behavior is unchanged.
- The wire contract advances to `er-coop-53`, so an older client cannot pair and misdecode the new mechanical arm.
  Focused source coverage requires all three encounter callsites, rejects unknown market kinds, and proves the exact
  guest phase is derived from retained authority. Local policy-safe evidence is clean full TypeScript, the updated
  presentation contract green, scoped formatting, and `git diff --check`. Real Mystery and two-browser proof remain
  remote-only; Showdown and tournament are untouched, and no deployment occurred.

## 2026-07-28 - Sacrificial spread moves retain one completion-safe global animation

- Exact animations-on campaign `30327840863` recorded Self-Destruct (`moveId=120`) with the same three targets on both
  browsers. The host started three concurrent `MoveAnim` instances and hit its 120-second production hard wall; the
  guest replayed the same fan-out and failed with `move-watchdog-expired`. Mechanics and identities were synchronized,
  but concurrent animations contended for shared actor sprites and did not provide every completion callback.
- In Authority V2 co-op only, a move with `SacrificialAttr` now authors one exact presentation target. Its `moveUsed`,
  HP, faint, checkpoint, and move-effect mechanics still retain and apply every target. The guest consumes the narrower
  `moveAnim` target list verbatim and does not infer the move class. Ordinary multi-target animation, solo play, and the
  old Showdown/tournament lockstep paths are unchanged.
- The production 120-second hard wall remains unchanged and fail-closed for the renderer. Exact remote Focused,
  animations-on campaign, and broader qualification are still required; no local co-op engine/browser run and no
  deployment occurred.

## 2026-07-28 - Mental Pollution active-source lookup cannot recurse between holders

- Exact god-c soak `30327843809` crossed 139 waves, then wave 140 raised repeated `RangeError: Maximum call stack size
  exceeded` from `canApplyAbility -> hasAbilityWithAttr -> collectAbilitySources`. Two fielded holders could each ask
  whether the other's Mental Pollution was active while evaluating the same suppression gate, producing unbounded
  mutual recursion. This was a production battle-mechanics crash, not a V2 divergence or harness artifact.
- Mental Pollution now resolves through the ordinary active-source gates while explicitly skipping only its own field
  suppression edge. Holders remain mutually exempt as the dex requires; unlock, faint, Neutralizing Gas, transform,
  requested-suppression, and condition gates still apply. A direct two-enraged-holder regression covers the former
  recursive composition.
- The exact god-c seed and full remote qualification remain required. No local co-op engine/browser execution and no
  deployment occurred.
- Focused run `30330864879` also found two stale tests from the preceding retained-market migration: the malformed-kind
  negative fixture relied on a now-invalid direct union assertion, and registry completeness still demanded direct
  concrete shop-phase calls. The negative now crosses `unknown` explicitly, while completeness requires all three
  encounters to call `setEncounterMarketReward` with one of the closed retained subtypes.
- Follow-up gate tracing found the new Mental Pollution regression was `ER_SCENARIO`-gated but outside every co-op gate
  discovery path, so ordinary CI would skip it and the co-op engine lane would never run it. The explicit engine
  inventory now includes both this exact soak-exposed mechanics regression and the existing PhaseInterceptor contract;
  a source-level gate test prevents either from silently falling out of Lane B.

## 2026-07-28 - Shared exact-SHA asset proxy for non-surface browser campaigns

- The sealed preview keeps its existing immutable 302 behavior by default. An explicit
  `COOP_UI_PROXY_PRODUCTION_ASSETS=1` enables one cache shared by both browser processes; only the depth,
  Mystery, and dirty-account campaign matrix entries opt in, while the animation-surface oracle stays direct-CDN.
- Proxy targets can be derived only from `_redirects` rules validated against the sealed manifest's exact 40-hex
  er-assets SHA. Upstream redirects, non-200 responses, invalid sizes, and fetch failures fail closed without a local
  asset or 302 fallback. The response retains the upstream content type and immutable cache semantics.
- Simultaneous misses for the same URL share one promise. The settled LRU is capped at 256 MiB / 8,192 entries;
  individual assets are capped at 32 MiB and eight concurrent streamed misses give a documented 768 MiB maximum
  cache-plus-download working set. The current er-assets checkout's largest file is 6,030,909 bytes.
- Node contracts cover closed-by-default config, manifest-SHA validation, unchanged proxy-off 302s, two-seat
  deduplication, MIME/cache headers, byte/entry eviction, oversized streaming bodies, URL admission, and fail-closed
  errors. Browser/co-op Vitest execution remains remote-only per `AGENTS.md`; no deployment occurred.

## 2026-07-28 - Off-field HP mutations have an exact nonvisual presentation contract

- The animation-on surface oracle reached wave 2 with mechanics and Authority V2 revisions converged, then failed the
  presentation ledger when Regenerator healed an outgoing Pokemon after its switch animation removed that actor from
  the field. The old generic HP replay correctly rejected a missing displayed actor, but the event had no way to say
  that this particular mutation was causally off-field.
- Protocol 60 adds one closed `presentation: "off-field"` HP discriminator. The authority emits it only when the
  universal heal seam observes that the exact actor is no longer fielded. The renderer consumes it at the event's
  ordered position, after the preceding switch drains: an absent exact actor receives a typed nonvisual receipt, while
  a still-displayed actor remains a hard ordering/material failure. Generic missing-actor HP events are unchanged.
- Exact-browser receipt policy accepts that skip only when the immutable HP event carries the matching discriminator;
  animation-disabled policy remains separate. Node/source contracts, full TypeScript, scoped formatting, and diff
  checks are green. Engine and two-browser qualification remain remote-only; no deployment occurred.

## 2026-07-28 - Browser feedback and guest replacement ownership use causal progress

- A healthy animation-on run took about 100 seconds for the guest to drain an exact retained `WAVE_ADVANCE` after the
  host reward surface opened. The public driver now recognizes only that typed replay phase/entry as causal wave
  progress and grants a 150-second sliding window under the unchanged 360-second hard ceiling. Generic keepalives
  still cannot extend the wait.
- The first shared-asset proxy CI attempt exposed a harness-only test race: it released the first upstream request
  before proving the second request had joined the in-flight promise. The contract now waits for the claimed
  `inFlightHits=1` condition; focused run `30394408935` is green at `3762ab6b`.
- The live guest-owned `SwitchPhase` fallback no longer starts its 60-second decision window during replay/setup. Under
  Authority V2 it waits for the exact peer `controlInstalled` proof, then arms the runtime-owned human-input lease.
  Only that lease's own deadline may auto-pick; cancellation, disposal, supersession, or a missing proof fail the
  shared boundary closed. Legacy behavior remains isolated outside V2.
- Integration tip `7bdd300fb` is TypeScript-clean, 104/104 source contracts green, and ownership-exact. Depth and
  Mystery campaigns continue at `3762ab6b`; surface, focused shards, fresh-wave2, and guest-owned faint replacement
  are qualifying remotely at `7bdd300fb`. No local co-op engine/browser execution and no deployment occurred.

## 2026-07-28 - Short Mystery feedback runs validate the exact requested prefix

- Three-wave Mystery run `30394475044` successfully cleared its requested depth, completed exact retained encounters
  at waves 2 and 3 with alternating owners, reached wave 4, and recorded zero shared-asset proxy failures. It was
  falsely marked red because the final oracle always demanded the complete ten-wave schedule.
- The schedule, distinct-event minimum, wave-7 ghost proof, and wave-8 segmented-boss proof are now bounded by the
  requested target. The default ten-wave milestone still requires the complete exact schedule; shorter diagnostic
  runs require the exact prefix and cannot claim milestone qualification.
- The full and focused gates now explicitly run all `test/scripts/coop-*.test.mjs`, all node-pure
  `authority-v2-*.test.ts`, and all node-pure `coop-*.test.ts`. The focused aggregate requires this parallel contract
  job, closing the gap where presentation and migration-completeness contracts were never executed by CI.

## 2026-07-28 - Reward successors no longer depend on the legacy interaction counter

- Ordinary reward completion still queued `CoopPartnerSyncPhase` after a valid V2 result, leaving a raw
  `interaction/__turn__` counter as a second progression authority. A lost/stale counter could therefore strand or
  terminate a mechanically converged session.
- Under active Authority V2, both replicas now derive the persisted alternation cursor locally from the immutable
  commit and return before broadcasting or waiting on the legacy counter. The typed successor/projector alone releases
  progression. Legacy sessions keep the existing broadcast and PartnerSync behavior.
- The failure-first remote regression drops every counter broadcast/request after real reward `controlInstalled` and
  requires both engines to reach the next command through the signed successor.

## 2026-07-28 - Catch-full and Revival fallback clocks begin at actionable control

- Catch-full and guest-owned Revival no longer spend their 60-second human-decision allowance while the owner is
  replaying, projecting, or waiting for its exact shared-interaction control. Authority V2 first proves the source
  entry's peer `controlInstalled` stage, then arms one address-owned runtime `humanInput` lease.
- Only that lease's own expiry can authorize the deterministic fallback. Runtime teardown, recovery fencing,
  supersession, relay cancellation, or loss of address currentness aborts the wait and fails the shared boundary
  closed. The non-owning Revival watcher has runtime cancellation but no independent V2 decision clock. Legacy paths
  retain their prior bounded waits.
- The common proof-gated helper now also rechecks replacement currentness at the timer edge. Source contracts cover
  a 180-second pre-proof delay with no timer consumption, a fresh post-proof window, cancellation, and supersession.
  Browser/co-op engine qualification remains remote-only; no deployment occurred.

## 2026-07-28 - Current exact-browser evidence

- Depth run `30394475090` cleared three requested waves at `3762ab6b`; animation-on surface run `30395226190` cleared
  two full waves at `7bdd300f`, including ordered switch/off-field HP presentation, and integrated guest-owned faint
  replacement run `30395226264` is green.
- Surface screenshots show matching battle geometry, HP/status state, trainer/background cleanup, and an ordered
  Flame Body ability popup. Per-seat prompt/active-Pokemon differences are expected ownership views, not divergence.
- Mystery run `30394475044` mechanically cleared its requested three-wave prefix with two exact retained encounters
  and zero proxy failures. A later screenshot at the same wave-2 interaction address exposed a transient HUD label
  discrepancy (`Town 1` versus `Town 2`); this remains a presentation-proof item even though both replicas later
  converged on `Town 4`.

## 2026-07-28 - Guest-owned Bargain releases only from its immutable V2 result

- A guest-owned Giratina Bargain still waited up to the legacy 20-minute raw-outcome domain after proposing its
  result, even though the Authority V2 interaction commit already carried complete state and a typed successor.
  Losing the compatibility FIFO could park the real phase indefinitely.
- The guest owner now parks the exact runtime/operation/phase identity. Only the admitted `BARGAIN`
  `INTERACTION_COMMIT`, after complete state apply and an address-matching `AWAIT_SUCCESSOR` control claim, can invoke
  the phase terminal and publish its material proof. Raw relay material, stale IDs, and ambient phases cannot release
  progression. Host-owned watcher compatibility and all non-V2 behavior remain unchanged.
- A failure-first DUO case swallows the old raw result materializer and requires both the real phase terminal and its
  exact installed successor. The engine row runs remotely in Lane B; no local co-op engine/browser execution or
  deployment occurred.

## 2026-07-28 - A fainted omitted seat no longer creates an impossible browser ACK wait

- Corrected Mystery run `30396716542` exposed a harness-only false red after healthy wave-2 mechanics: the guest's
  final active Pokemon fainted with no legal bench, and the authority installed the exact turn-6 command frontier for
  seat 0 alone. The public oracle correctly proved seat 1 was omitted by an authoritative `FaintPhase` collection
  close, yet then unconditionally waited for that omitted seat's turn-5 `continuationReady` ACK until timeout.
- The retained-continuation proof now accepts guest omission only from that exact command partition and only under
  Authority V2. It proves the predecessor turn's exact authenticated retirement/subsumption instead of starting an
  impossible ACK wait. Legacy retains the mandatory ACK, and an ACK that does exist must match the retained turn
  address.
- Source contracts are 105/105 green. This changes only the observer/driver verdict; production progression and the
  strict authoritative collection-close proof are unchanged.

## 2026-07-28 - Gate 30400079428 closure: Bargain and catch-full order their real control edges

- Lane B1 proved a production ordering bug: a guest-owned Bargain advanced the legacy interaction counter before the
  authority retained its immutable result, so the V2 successor reservation was correctly refused. V2 Bargain owners
  and watchers now rotate only after the complete result commit/applied callback; legacy sessions keep their prior
  local/broadcast rotation.
- Lane B9 was a harness-impossible click: its synthetic PARTY callback fired synchronously from `setMode`, before the
  returned promise could install the exact `controlInstalled` proof. The fixture now waits for that public surface
  continuation before clicking. The common proof publisher also rebinds an async continuation to its exact runtime
  and scene, preventing a two-engine microtask from attesting the peer handler.
- Local-safe TypeScript, scoped Biome, and node-pure source contracts are green. The engine regressions remain
  remote-only; no deployment occurred.

## 2026-07-29 - Exact gate 30403366964 artifact corrections

- The first Bargain correction removed premature V2 rotation but the failure-first duo still exposed an async realm
  bug: its guest UI terminal resumed while the host was ambient and consulted the process-global controller. Bargain
  now binds owner terminal, watcher outcome, UI closure, relay, controller, and rotation to the phase's captured
  runtime/scene. A guest proposal can no longer be mistaken for a host-local commit in the in-process topology.
- The host-first double-faint row now reaches both ordered replacements. Its final assertion was over-specific: when
  the first replacement receives its real `controlInstalled` receipt before the second commits, it is already retired
  and must not also appear in `subsumes`. The proof now accepts exactly normal retirement or explicit supersession.
- The initial scheduled-Mystery harness rewrite fixed the late biome predecessor but disturbed existing ME reward
  tails. It was reverted. The replacement is targeted: retain the original host crossing, then drive only the exact
  guest `SelectBiomePhase` predecessor before the ME mirror can replace that battle.
- Gate `30403366964` remains historical evidence for these mechanisms. The next exact-SHA qualification must prove
  B1, B6, C1/C3, and static together. No local engine/browser execution and no deployment occurred.

## 2026-07-29 - Batch move learning releases only from its immutable V2 decision

- Guest-owned batch move proposals now retain their exact projected phase and visible panel until the authority
  commits the complete assignment/fallback result. The legacy raw-choice FIFO, 20-minute timeout, and legacy retry
  counter cannot close or advance an Authority V2 batch surface.
- Host-owned and guest-owned results close both real panels only after the retained `INTERACTION_COMMIT` material,
  exact `AWAIT_SUCCESSOR`, real UI closure, and terminal proof agree. Wrong-address, wrong same-address material,
  duplicate delivery, dropped legacy echoes, and fallback-to-per-move paths fail closed or advance at most once.
- Legacy behavior remains unchanged. The focused Node source contract is green; co-op engine/browser validation stays
  remote-only under `AGENTS.md`, and no deployment occurred.

## 2026-07-29 - Ordinary player form changes retain their full cutscene

- Protocol 61 distinguishes field-local form flashes from the full evolution-style player form cutscene and
  carries the exact pre/post form indexes. `FormChangePhase` now emits that immutable event once, immediately
  after its real mechanical result materializes.
- The renderer creates a detached old-form cosmetic Pokemon, routes a dedicated
  `CoopFormChangeCutsceneReplayPhase` through the production renderer gate, and uses the ordinary cutscene's
  exact sound/background/tint/scale/tween/cry/narration chain. Only the signed target form is installed on the
  live actor; no form trigger, ability, stat, modifier, achievement, or dex mechanic is re-executed.
- The presentation token settles only after `revertMode()` closes the UI. A progress watchdog fails the shared
  boundary instead of releasing control on a stuck callback. The detached preimage makes recovery safe even
  when the live actor already contains the target form; rendered watermarks retain duplicate suppression.
- Local policy-safe verification: the source contract is green (22/22), changed production files have no
  TypeScript diagnostics beyond the repository baseline, scoped formatting is clean apart from existing
  informational debt, and `git diff --check` is green. The added co-op engine regression remains remote-only.

## 2026-07-29 - Floating common VFX enter the authoritative presentation ledger

- A focused combat-presentation audit found that forced switch variants already converge through one immutable
  `switch` event, active and innate ability flyouts carry their exact ability/source identities, and their concrete
  replay outcomes are fenced before the renderer receipt. The uncovered breadth gap was three direct
  `CommonBattleAnim` seams that never construct `CommonAnimPhase`: single-target Protect, team protection such as
  Quick/Wide Guard, and recurring poison/toxic/burn ticks.
- One presentation-only adapter now records those immediate/floating cues as the existing exact-actor `commonAnim`
  event immediately before the authority's unchanged local animation. The ordinary renderer phase, watchdog,
  outcome token, ordered receipt, duplicate watermark, and recovery behavior are reused without a wire or protocol
  change. Status acquisition and Terastallization deliberately remain excluded because their richer typed events
  already own the same visual; recording a generic cue there would display it twice.
- Failure-first source coverage inventories all three bypasses and the richer-event exclusions. Remote engine
  coverage exercises both real Protect call chains and requires exactly two immutable events while the authority
  still plays exactly two local VFX. Local permitted evidence is 23/23 source contracts, scoped Biome, ownership
  guard, and `git diff --check`; full TypeScript retains unrelated baseline diagnostics and reports none in the
  changed files. No local co-op engine/browser execution and no deployment occurred.
- Remaining independent presentation debt from this audit: enemy trainer switches are mechanically and sprite
  synchronized, but `CoopSwitchReplayPhase` does not yet reproduce or explicitly settle the authority's trainer/tray
  reveal-hide grammar. That is the next bounded visual cleanup; Showdown and tournament were not touched.

## 2026-07-29 - Enemy trainer switches retain and retire their complete presentation

- `CoopSwitchReplayPhase` now reproduces the ordinary trainer switch grammar: exact format-aware trainer portrait
  and Pokeball-tray reveal, 750 ms pre-switch delay, 1500 ms visible hold, exit, narration, and immutable ball/sprite
  replay. The trainer-slot resolver is shared with `SwitchSummonPhase`; only partnered doubles select the partner,
  so triple slots can no longer display or name a nonexistent second trainer.
- Every new timer and nested tween continuation is bound to the originating scene, runtime, and session generation.
  Success, failure, watchdog expiry, destructive phase retirement, and already-projected recovery all cancel owned
  delays and settle the trainer plus tray before the presentation outcome can release its exact watermark.
- Pokeball-tray callbacks now have their own presentation generation, and `settleHidden` restores fresh hidden
  geometry. A delayed hide from an older switch therefore cannot blank a newer tray entrance.
- Failure-first source coverage proves the timing, ownership, cleanup ordering, and triple-safe resolver. The existing
  two-engine enemy-switch reconstruction scenario now requires positive guest trainer/tray replay and absolute final
  cleanup, while real two-browser campaigns correlate every switch they encounter to the exact guest receipt.
  Co-op engine/browser execution remains remote-only; no Showdown, tournament, wire schema, or mechanics changed.

## 2026-07-29 - Switch and form replay are now presentation-only and lifecycle-owned

- The switch audit found that the renderer still called the ordinary summon helpers, which re-entered
  `leaveField`, `resetSummonData`, and `fieldSetup` on the guest. The replay now uses one exact structural projector
  that validates scene/side/slot/id/species, installs only the signed party permutation and Phaser field membership,
  and never runs abilities, form triggers, hazards, substitute setup, summon phases, or other battle mechanics.
- Switch failure/retirement now settles the ball, actor body/main/tint/info/EXP-mask, trainer, and Pokeball tray on
  the creating scene. A failed, retired, wrong-side, wrong-identity, or wrong-runtime replay cannot positively reveal
  an actor. Initial trainer send-out also shares the partnered-double resolver, keeping triple slots on the primary
  trainer.
- The first full form-lifecycle gate exposed three compile failures and two two-engine context regressions that its
  isolated report missed. Form and Transform appearance continuations now queue through the destination runtime's
  activation ledger and both phases shift only their bound phase manager. The in-process duo tests explicitly install
  the destination browser to flush that ledger, matching two concurrently installed real browser realms.
- The rich form cutscene owns every shared animation counter, recursive cycle tween, infinite particle timer, and
  spawned particle through an opt-in `AnimationResourceScope`. Success, failure, recovery, and retirement cancel that
  scope; late callbacks cannot recurse or mutate a recovered scene. Ordinary non-co-op animation callers retain the
  previous unowned behavior.
- Local policy-safe evidence: all 55 co-op source/orchestration contracts and all 347 node-pure public-browser
  contracts pass, scoped Biome and `git diff --check` are clean, and full TypeScript has zero diagnostics in changed
  files. Co-op engine, gate, and real Chromium qualification remain remote-only; no deployment occurred.

## 2026-07-29 - B9 catch-full gate reproduces the production phase-ownership edge

- Gate `30412975989` did not lose the guest's first `CATCH_FULL:2` proposal. Its first host-endpoint delivery was
  captured in the guest-side log because that realm was ambient in the one-process rig, and the authority buffered
  it once. The later host-log lines are legitimate retry deduplication.
- The fixture directly started a picker that remained detached in `phaseQueue` while `CommandPhase` was still the
  manager-owned current phase. Authority V2 correctly refused `controlInstalled`, so the host never armed the exact
  proposal waiter that would consume the buffered decision.
- The duo scenario now installs the queued picker by atomically replacing its exact current predecessor, proves the
  manager owns it, waits for the address-matching active V2 control, and only then invokes the public PARTY callback.
  A node source contract forbids returning to detached-phase plus one-microtask actionability evidence.
- Local policy-safe evidence: the focused node contract is 3/3 green, scoped Biome and `git diff --check` are clean,
  and full TypeScript reports no diagnostics in the changed files. The engine regression remains remote-only.

## 2026-07-29 - Async presentation and single-move UI tails re-enter their exact browser

- The final gate exposed two callbacks that still crossed an asynchronous boundary through an ambient streamer or
  bare promise continuation. A form cutscene asset load could therefore consume its continuation while the peer
  engine owned the process globals, and a host-owned single-move decline could open its next confirmation there.
- Rich form replay now dispatches every V2 promise tail through its captured runtime activation ledger, retaining the
  streamer timer only for the legacy streamer-only compatibility binding. Single-move prompt, decline, forget, and
  terminal narration steps use the same exact runtime/current-phase fence; losing that address fails the shared
  session instead of mutating the peer UI.
- Both phase types cancellation-own queued activations. Destructive recovery removes them before the obsolete phase
  can touch a replacement surface. A torn cosmetic field-scale promise is also handled after switch structure is
  installed, so presentation failure cannot become a detached unhandled rejection.
- Local policy-safe evidence: presentation authority is 25/25 and single-move release is 4/4. Engine/browser
  verification remains remote-only; Showdown, tournament, deployment, and production were not touched.

## 2026-07-29 - Batch move results decode and retire through the V2 envelope

- The B11/C2 gate artifacts showed a valid batch decision at revision 15 remaining `materialDeferred` on every
  delivery. The projected batch phase was passing the wrapped `INTERACTION_COMMIT` to the retired raw-material
  decoder, which necessarily returned null; neither real panel could close and no terminal proof could publish.
- Batch result settlement now validates the complete V2 interaction envelope, exact applied `LEARN_MOVE_BATCH`
  operation, immutable assignment/fallback payload, global successor, phase, scene, and runtime. Authority and
  replica UI/result continuations re-enter that captured browser and cancellation-own every queued activation.
- The existing two-engine owner, watcher, fallback, refusal-to-retire, and soak cases remain the remote failure-first
  proof. The focused source contract is 5/5 green locally; no local engine/browser test or deployment occurred.

## 2026-07-29 - Final B1/B9/B11 gate reds reduced to harness proof defects

- Exact run `30416229019` left only B1, B9, and B11 red while static, build, source contracts, C2 batch
  learn-move, B10 form presentation, and every other shard passed. Its two-real-browser public journey
  `30416219940` also completed successfully from fresh start through wave 2.
- B1 reached and completed the first single-move confirmation. The test then waited for a different
  `ConfirmUiHandler` object, but Phaser intentionally reuses that singleton across prompts. The proof now requires
  a strictly newer public surface generation on the same actionable handler, so it distinguishes real prompt
  reincarnations without relying on object allocation.
- B9 atomically installed the exact catch-full picker through `replaceWithCoopAuthoritativePhase`, which starts the
  successor synchronously, and then started the same phase a second time. The duplicate manual start is removed and
  the source contract now forbids it between manager installation and control-ledger proof.
- B11's sole remaining error was Vitest `iterableEquality` recursively traversing live Phaser GameObjects in
  `toMatchObject`; the switch projector itself returned the correct exact actors. The engine assertion now proves
  incoming/outgoing identity and projection state directly, with a source guard against the unsafe deep matcher.
- Local policy-safe evidence for these corrections is 32/32 source contracts, scoped Biome error-clean, and
  `git diff --check`. The three engine regressions remain remote-only; no deployment, Showdown, or tournament work
  occurred.

## 2026-07-29 - Catch-full raw prompt can no longer compete with its V2 commit

- Exact gate `30417425993` proved the reusable CONFIRM generation correction in B1 and the direct Phaser actor
  identity proof in B11; both shards are green. B9 then exposed the next real boundary rather than repeating its
  prior detached/double-start harness failures.
- A guest catch-full decision emitted both its compatibility `catchFullPrompt` and its retained
  `INTERACTION_COMMIT`. The raw callback queued a legacy picker while the V2 projector installed a second exact
  modal from the command frontier. The engine test selected the stale queued copy; production could likewise reopen
  that unaddressed picker after the authoritative modal ended.
- With the interaction cutover active, the raw prompt is now observational only and cannot create UI. The ordinary
  V2 projector is the sole phase constructor and successor owner. Legacy sessions retain the old callback behavior.
  Exact gate `30418003889` then proved the duplicate was gone and the retained projector installed the correct
  current phase. Its one-process fixture deliberately suppresses `startCurrentPhase`, so the test now restores that
  single known harness edge only after proving manager ownership and no queued duplicate, then waits for exact
  `controlInstalled` before driving the public PARTY callback. This matches the established Revival fixture model.
- Local policy-safe evidence: the catch/revival source contract is 3/3, scoped formatting is clean, raw TypeScript
  has zero diagnostics in the changed runtime/test files, and `git diff --check` passes. Engine/browser execution
  remains remote-only; no deployment, Showdown, or tournament code changed.

## 2026-07-29 - Raw Revival prompt obeys the same V2-only UI invariant

- Auditing the only other runtime prompt callback found the analogous Revival compatibility seam. Reliable FIFO
  usually delivered its V2 commit first, allowing the raw callback to rebind the already-projected phase, but the
  fallback branch could still construct and override UI from a raw message during reconnect/redelivery timing.
- With V2 active, `revivalPrompt` is now observational only. The retained `INTERACTION_COMMIT` projector is the
  sole phase constructor and recovery owner; legacy sessions preserve their existing create/override behavior.
  The Revival two-engine scenario already drives the V2-projected current phase, so its comments now state the
  actual authority model and the source contract forbids both raw-prompt UI constructors.
- Local policy-safe evidence: catch/revival contracts are 3/3, scoped Biome is error-clean, raw TypeScript reports
  zero changed-file diagnostics, and `git diff --check` passes. Remote engine and Chromium qualification remain
  required; no deployment or non-co-op mode changed.

## 2026-07-29 - Catch-full fixture now proves the real public input chain

- Exact gate `30418430318` advanced B9 past manager projection and opened the projected catch-full phase, but the
  fixture's replacement `setMode` returned a callback without installing a PARTY handler. Authority V2 correctly
  refused to certify that nonexistent surface, so the remaining timeout was a harness false red rather than a
  production progression defect.
- The two-engine scenario now mirrors the already-green Revival pattern: it starts only the manager-owned projected
  phase suppressed by the headless scheduler, dismisses the real MESSAGE through public ACTION input, waits for the
  real actionable PARTY handler plus address-exact `controlInstalled`, and drives slot navigation/selection entirely
  through public keyboard input. Callback-only UI stubs are forbidden by the source contract.
- No production source changed in this correction. Local policy-safe evidence is green: all 58 co-op source
  contracts, all 347 public-browser node contracts, scoped Biome, and `git diff --check`; raw TypeScript retains its
  571-line baseline with zero diagnostics in the changed test. Remote engine qualification remains required;
  Showdown, tournament, staging, and production remain untouched.

## 2026-07-29 - Deep campaign now drives queue-owned learn-move pickers

- Exact campaign `30419517140` reached wave 2 with matching Authority V2 revision 14 fully installed on both
  browsers, then waited in `LearnMovePhase` for the guest-owned move-forget picker. Transport, state digest, and
  receipt frontiers remained healthy; the campaign stopped issuing input because its read-only observer labeled
  both byte-identical SUMMARY screens `learn-move:summary`.
- Stable Pokemon ownership was already resolved correctly as guest seat 1. The observer now performs the missing
  late refinement: a queue-owned `LearnMovePhase` SUMMARY is `learn-move:confirm` only on that exact owner and
  `learn-move:summary` on its watcher. The existing public driver can therefore exercise the intended Back/confirm
  sequence without privileged callbacks or guessing from the alternating interaction counter.
- The focused public-browser contract is 37/37 green, scoped Biome and `git diff --check` are clean, and raw
  TypeScript retains its 571-line baseline with zero diagnostics in the changed observer. Remote campaign
  requalification remains required; production, staging, Showdown, and tournament were not touched.

## 2026-07-29 - Obsolete Mystery callbacks cannot reopen a completed encounter

- The exact Mystery campaign completed two encounters and entered the wave-4 embedded battle with matching
  Authority V2 state. Revision 23 installed command control on the host, but the guest remained deferred because a
  late dialogue callback from the completed encounter queued a second `MysteryEncounterPhase` after the ordered
  `ME_PRESENT` sequence had already ended. That unauthorized phase waited forever for a successor that could not
  exist, even though transport, state, receipts, and battle replay were healthy.
- `EncounterPhase.doEncounterCommon()` now defaults its nested continuations to the exact live phase instance. All
  existing callback guards therefore discard obsolete work after progression changes the current phase. Explicit
  callers such as biome transitions retain their stricter supplied predicate, while ordinary solo behavior is
  unchanged for a still-current encounter.
- The source-level Authority V2 regression contract is 107/107 green, all 347 public-browser node contracts are
  green, scoped Biome and `git diff --check` are clean, and raw TypeScript retains its 571-line baseline with zero
  diagnostics in the changed production file. Remote engine and campaign qualification remain required; staging,
  production, Showdown, and tournament were not touched.

## 2026-07-29 - Voluntary switch replay no longer detaches a visible shadow actor

- The animations-on surface lane reached wave 2 turn 2 and exercised a real guest voluntary switch. Its WebGL
  renderer then threw `Cannot read properties of null (reading 'scale')` inside `SpritePipeline.batchQuad`, froze
  on `CoopSwitchReplayPhase`, and left the incoming Pokeball visible. The trace and screenshot show this was a
  production presentation crash, not a campaign timeout or Authority V2 state mismatch.
- The structural switch projector removed the outgoing Pokemon from Phaser's exclusive field container while it
  was still visible. Phaser promoted that actor to the scene display list, but its shadow sprite requires the
  Pokemon's parent container to be the field; the promoted actor therefore rendered with a null field. The
  projector now settles the outgoing actor hidden before removal. Future authoritative projection remains solely
  responsible for revealing it again.
- A source-level contract pins hide-before-detach ordering. The Authority V2 contract is 107/107 green, scoped
  Biome and `git diff --check` are clean, and raw TypeScript reports zero changed-file diagnostics. Remote engine
  and animations-on requalification remain required; staging, production, Showdown, and tournament were not
  touched.

## 2026-07-29 - Mystery selectors may carry authoritative encounter-owned Pokemon

- Exact Mystery campaign `30421151514` completed `ER_GENTLE_GIANT`, reached wave 3
  `DANCING_LESSONS`, and received the host's exact one-Pokemon `enemyPartySync`. The guest then rejected that
  valid carrier solely because an obsolete encounter-adoption invariant required every Mystery party to be empty;
  after two retries it terminalized an otherwise healthy session.
- Mystery selectors such as Dancing Lessons legitimately create a Pokemon for their presentation and later option
  material. Authoritative adoption now accepts both an empty selector carrier and a dense non-empty one. Ordinary
  WILD/TRAINER carriers still require slot zero and can never be accepted empty; every carrier still rejects holes,
  duplicate/invalid indexes, missing species, or incomplete reconstruction.
- The production-path engine regression sends a real Dancing Lessons carrier through the loopback transport,
  builds the guest's next Mystery battle, invokes the same encounter adoption boundary, and proves the exact host
  id/species/level survives. A source contract also forbids reinstating either obsolete empty-only rejection.
  Local policy-safe evidence is green: Authority V2 source contracts 107/107, scoped Biome has no errors,
  `git diff --check` passes, and TypeScript reports zero changed-file diagnostics. Engine and exact two-browser
  Mystery requalification remain remote-only; no deployment or non-co-op mode changed.

## 2026-07-29 - One canvas-dead browser gets one evidence-visible startup retry

- Mystery requalification `30422749774` never reached gameplay: the guest Chromium initialized Phaser and Login,
  while the host emitted only navigation/PWA-banner evidence and timed out without ever creating `#app canvas`.
  No co-op runtime, transport, V2, or game surface existed, so this was a strict harness/infrastructure false red.
- Duo initialization now retries exactly that narrow shape in the same isolated context: one client has resolved its
  real canvas, exactly one peer failed with Puppeteer's canvas-selector timeout, and the failed seat receives one
  ordinary cold-page reopen. The retry is recorded in JSONL evidence. Navigation errors, page errors retained by the
  evidence sink, two failed clients, and a repeated canvas failure remain fatal.
- Node-pure lifecycle coverage is 10/10 and explicitly proves the only retryable shape plus the non-retry cases;
  scoped Biome has no errors and `git diff --check` passes. The exact Mystery rerun is `30423057616`. This is harness
  code only; no production, staging, Showdown, or tournament behavior changed.

## 2026-07-29 - Depth qualification now measures an achievable hosted-runner milestone

- Exact depth run `30421149617` remained causally healthy for its full immutable 45-minute budget: it cleared four
  consecutive waves and four reward surfaces, exercised a real faint, replacement, and fallback turn, then entered
  wave 5. It failed only when the lifecycle ceiling expired (`finalWave: 5`); no desync, terminal, softlock, page
  error, asset failure, or stalled frontier was reported.
- The single-job release depth target is now four waves, matching measured capacity instead of guaranteeing a false
  red at the old 30-wave target. Manual dispatch can still request a larger diagnostic run. True sequential 30-wave
  qualification remains a separate save-handoff sharding project; raising one runner's timeout is not accepted as
  coverage or as a development-speed solution.
- The workflow source contract pins both the four-wave visible default and every event fallback, and forbids the old
  8/30-wave implicit targets. This changes CI classification only; no production game or co-op behavior changed.

## 2026-07-29 - Real animations-on surface closes the switch-render crash

- Exact campaign `30421735171` passed two complete waves in two independent Chromiums with move animations enabled
  and the production asset redirect path (`assetProxy.enabled: false`). Both reward-owner directions completed.
- The evidence contains authority/renderer move events and the formerly crashing voluntary-switch presentation on
  both clients (`authoritySwitchEventIndex: 5043`, `rendererSwitchEventIndex: 5368`). It finished at wave 3 with no
  error after 33m23s, proving the outgoing actor is hidden before detach under the real WebGL renderer.

## 2026-07-29 - Commander journey becomes the deterministic co-op entry-presentation oracle

- The ordinary campaign already compares every authority-recorded event with the replica's concrete renderer
  outcome, but random starter and encounter rolls did not guarantee an ability event occurred. A green campaign
  therefore proved exact delivery of the events it encountered without proving the previously reported missing
  co-op ability flyout in a real Chromium pair.
- The existing Commander journey already supplies the production PostSummon path needed to close that gap. At its
  first addressed co-op command frontier it now compares the complete canonical authority/renderer ledger and
  requires a real `showAbility`, `pokemonAnim`, and `statStage` event. Those are Commander’s ability bar, Tatsugiri
  sprite transition, and Dondozo boosts; all must complete on the replica before public command input opens.
- This reuses an existing two-browser journey and both ownership parities instead of adding another build/job, so
  the stronger combat-presentation proof adds negligible wall-clock cost. All 350 public-browser node contracts
  pass; scoped formatting is clean apart from pre-existing complexity notices. No production, Showdown, tournament,
  staging, or deployment behavior changed.

## 2026-07-29 - Retained wave progression has an exact authority-to-renderer ledger

- Turn presentation already had exact ordered receipts, but post-battle EXP, level-up, and evolution cues live in
  the separate retained `WAVE_ADVANCE` transaction. A mechanically converged browser could therefore omit one of
  those visuals and still pass every campaign presentation check.
- The authority now emits a read-only receipt for each immutable progression event, while the replica emits either
  `renderer-completed` or a typed `renderer-failed` receipt at the same wave/sequence coordinate. Fresh journeys
  and every campaign battle compare those ledgers exactly and require real EXP presentation before accepting the
  reward frontier; state equality alone can no longer certify this boundary.
- Non-evolution UI waits are watchdog-bounded and fence every late callback. Evolution retains its stronger abort-
  and-join contract, so its temporary Pokemon, tweens, recursive cycle, timers, and mode restoration settle before
  DATA may apply. Destructive authoritative replacement now retires the replay phase through its real `retire()`
  lifecycle, aborts its current renderer, and prevents any later event from starting against the replacement UI.
- Local policy-safe evidence is green: all 352 public-browser node contracts and all 25 presentation-authority
  contracts pass, scoped Biome is error-clean apart from pre-existing warnings/notices, `git diff --check` passes,
  and full TypeScript retains its 571-line baseline with zero diagnostics in changed production files. Engine and
  real-Chromium qualification remain remote-only; no staging, production, Showdown, or tournament code changed.

## 2026-07-29 - Co-op checkpoints preserve nested ghost teams without false session corruption

- Mystery campaign `30423057616` cleared six waves and reached the exact shared V2 GameOver terminal after a real
  party wipe. It had no transport loss, recovery, desync, or stalled control frontier, but correctly failed browser
  cleanliness when the wave-7 resume checkpoint logged three unloadable party members.
- The checkpoint itself was valid. `parseSessionData()` applied its key-only JSON reviver to every nested `party`
  property, so the scripted ghost trainer's three `GhostMember` rows (`speciesId`) were misread as top-level
  `PokemonData` rows (`species`) and dropped. The parser now constructs save classes only for properties whose
  parent is the actual SessionSaveData root; nested ghost/material payloads remain immutable plain data.
- A failure-first real-engine regression reproduces the three-member Mystery ghost carrier, requires its exact
  round trip with no unloadable-member error, and remains in co-op gate lane B as a critical engine dependency.
  The lane-discovery source contract is 14/14 green, scoped Biome and `git diff --check` are clean, and full
  TypeScript reports zero diagnostics in the changed parser/test. Engine and browser requalification are remote;
  no deployment or non-co-op mode behavior changed.

## 2026-07-29 - Enemy trainer cleanup is proven after real renderer frames

- The Mystery campaign's final guest screenshot exposed a real presentation-only regression: after an enemy
  replacement with animations disabled, the Mystery Challenger portrait reappeared behind the enemy field even
  though the matching host was clean. Transport, V2 state, and the shared terminal remained converged.
- The switch replay completed the trainer entrance tween synchronously and wrote alpha zero, but left that tween
  registered; Phaser's next renderer update wrote alpha one again. Trainer settlement now removes the completed
  tween before establishing the absolute hidden state.
- The CI browser bundle now inspects the exact trainer container two real animation frames after every guest switch
  receipt. A visible nonzero-alpha trainer is a fatal browser error, and campaigns correlate each authoritative
  switch with that exact post-frame proof. This closes the next-frame behavior the synchronous headless assertion
  could not observe. No Showdown, tournament, staging, or production deployment behavior changed.

## 2026-07-29 - Retained EXP presentation no longer asks the replica for authority

- Fresh journey `30424848828` mechanically completed wave 1, but every retained EXP cue failed its renderer
  watchdog. The replay opened a normal human-confirm prompt while the pending V2 WAVE_ADVANCE correctly froze
  replica input, so the prompt had no legal owner.
- Retained EXP and level-up narration now render without creating a second human control lease. Field gauges still
  update; level-up stat increments and totals still appear, then their already-authorized presentation callbacks
  advance after a bounded lifecycle-owned dwell. Animations-disabled profiles collapse only that dwell.
- AbortSignal fences every added text callback and runtime-wall delay. Recovery/retirement therefore cannot leave a
  late replica prompt or timer behind the succeeding authoritative state.

## 2026-07-29 - Two-player co-op cannot construct a triple battle

- The two-seat Authority V2 graph now has a matching battle-topology invariant: after Showdown's independent
  negotiation, co-op resolves only the already-selected legacy single/double format before the Triples Only
  challenge, developer override, or natural ER triple roll can run.
- Ordinary two-player co-op battles remain doubles, and intentional single-only boundaries remain singles. This
  removes the unsupported third command/replacement seat without changing Showdown, tournament, or solo triples.
- Failure-first engine coverage pins both previously open entry paths: a forced triple override and a leaked
  Triples Only challenge must resolve to a binary co-op format. This scope reduction does not require a new full
  browser campaign; it will ride the next ordinary exact-SHA qualification.

## 2026-07-29 - Mystery qualification measures synchronization instead of random survival

- Exact campaign `30428007443` completed three consecutive alternating-owner Mystery encounters, their retained
  rewards, and real faint replacements without a desync or softlock, then failed through one synchronized party
  wipe at wave 5. This was a noisy harness result, not a co-op failure.
- The unexpected trainer at wave 5 exposed a separate schedule precedence defect: Classic's fixed wave-5 battle
  was selected before the Mystery Gauntlet override could run. An active gauntlet now owns every fresh generated
  wave; saved battles remain exact, while fixed Classic encounters remain unchanged outside the dev-only Mystery
  difficulty.
- Only the exact campaign bundle plus the exact Mystery-profile URL can visibly seed a durable, ordinary
  point-legal three-mon team per seat. Both browsers still submit it through public keys, while surface, depth, and
  dirty profiles keep natural fresh-account selection. The ten-wave lane can now judge five MEs, ghost, boss,
  Bargain, battle/replacement, and reward synchronization rather than early-party RNG.

## 2026-07-29 - Mystery profile propagation and Authority V2 ability UI coverage

- Exact Mystery run `30430258572` failed before gameplay because both browser URLs omitted
  `coopfixture=campaign-survival`; its paired final screenshots showed the ordinary empty Bulbasaur starter grid.
  `loadConfig()` parsed `COOP_UI_RENDER_PROFILE` but did not return `renderProfile`, so `PublicUiClient.open()` could
  never satisfy the exact Mystery build+profile URL gate. The shared config now carries the parsed value, with a
  failure-first source contract that pins the wiring.
- The parent depth artifact independently exposed `ErAbilityCapsulePhase` as an actionable owner surface with an
  inert watcher, but the campaign had no registered ability driver. The read-only browser observer now projects
  phase-specific ability `option`, `party`, `choice`, and `message` surfaces for all four production registry phases,
  pins ownership to the phase's exact `coopSeq`, and exposes the immutable target party slot.
- The same registry audit found that Greater Capsule and Greater Randomizer watchers announced readiness while still
  inheriting the reward handler instead of installing their registered passive `MESSAGE` control surface. Both now
  install that surface before retrying the projector, matching regular Capsule and Dex Nav; a source contract covers
  all four workflows so a future reward-handler inheritance regression cannot silently strand control proof.
- The public-key campaign now proves one exclusively actionable owner, one exact-address/mechanical-digest MESSAGE
  watcher, then drives the real visible option. Nested PARTY flows navigate to the phase-owned mon and a stable
  ability slot; Dex Nav publishes an ordered surface generation so its second real picker cannot be suppressed as
  the first appearance. Ability party screens also block stale narration advancers from pressing through them.
- Local policy-safe evidence: 50/50 focused node-pure browser contracts green, public browser boundary green,
  scoped Biome clean, zero TypeScript diagnostics in the changed files (repository baseline currently reports 215),
  and `git diff --check` clean. No local co-op engine/browser execution was used. Next: commit/push, then dispatch exact
  Mystery and depth browser campaigns remotely and inspect both screenshots plus semantic traces before changing
  further production behavior.

## 2026-07-29 - Late two-seat target picker remains driveable after fallback

- Re-triaged the exact surface artifact from campaign `30428007443`. At wave 2 turn 2 the guest opened and publicly
  submitted its `command:target` surface, then entered `CoopReplayTurnPhase`. The host's target picker opened 30s
  later only after the bounded command fallback reached it; its observer proved `SelectTargetPhase`, active
  `TARGET_SELECT`, address `1828154092343565:2:2`, and the same mechanical digest as the guest. No desync occurred.
- The campaign's primary outcome wait drove targets, but both longer causal waits dropped that callback. Thus fallback
  could open a target picker and the harness would leave it untouched for the rest of the run. Both waits now retain
  the same exact-address, consumed-instance-protected driver. A failure-first source contract requires all three
  post-command waits to keep that public UI-to-relay chain armed.

## 2026-07-29 - Mystery survival fixture obeys the real per-seat co-op budget

- Exact Mystery run `30489511688` reached both ordinary starter screens with the correct exact-build fixture URL,
  then timed out before launch. Its semantic trace proved that the production UI accepted only Dondozo: the fixture
  requested a `4 + 4 + 1` team while two-player co-op correctly limits each seat to five starter points.
- The exact-only fixture now fields Seel, Castform, and Spinda. All three are real one-point starters and retain the
  fixture's deterministic Water Spout/31-IV setup, giving each browser three replacement-capable party members while
  staying two points below the same five-point limit a human co-op player sees.
- The node-pure campaign contract now checks both the exact fixture/harness roster and each member's real starter-cost
  declaration, so a future balance or roster edit cannot quietly turn setup into a misleading gameplay red. Focused
  evidence is 40/40 green, the public-browser boundary is green, scoped Biome is error-clean apart from the existing
  informational complexity diagnostics, and `git diff --check` is clean. No local engine or Chromium execution was
  used; the corrected exact Mystery campaign remains remote-only.

## 2026-07-29 - Revival and Stormglass are registered public-browser authority surfaces

- The registry audit found that the read-only browser observer still classified Revival Blessing's PARTY picker as a
  generic local party screen and Stormglass as generic message/option UI. That hid their stable authoritative owner
  and prevented the real two-browser campaign from proving or driving either registered interaction.
- The observer now emits exact `revival:party`, `stormglass:message`, and `stormglass:option` surfaces. Revival derives
  its stable owner from the registered phase/user state, Stormglass remains host-owned, and both retain their exact
  interaction address instead of falling back to local UI parity.
- The campaign proves one exclusively actionable owner and one input-inert watcher at the same V2 address and
  mechanical digest. Revival chooses a real fainted party slot and then the visible revive submenu action;
  Stormglass chooses the visible stable option ordinal. Revival PARTY also blocks stale narration advancement.
- Stormglass's initial MESSAGE is intentionally a known transition rather than a fabricated human control surface:
  production passes a callback without `prompt`, so the typewriter completes it automatically. An earlier production
  retry idea was disproved by the real `MessageUiHandler` contract and fully reverted before this checkpoint.
- Local policy-safe evidence is green: 42/42 focused node contracts, the public-browser boundary, scoped Biome, and
  `git diff --check`. Full TypeScript still reports the repository's unrelated baseline and no diagnostic in the six
  changed files. No local engine or Chromium execution was used. Exact remote browser qualification is next; dedicated
  deterministic browser fixtures are still required before Revival and Stormglass occurrence coverage can be claimed.

## 2026-07-29 - Registered interactions now have a deterministic real-browser occurrence oracle

- Revival Blessing exposed a representativeness hole: the registered-surface driver ran only between waves, while the
  production PARTY choice opens inside a live turn after both commands. Every causal post-command wait now keeps an
  exact, appearance-ledger-protected Revival driver armed, including fallback and animation-extended waits.
- The exact `registered-interactions` bundle seeds a point-legal public starter roster that self-faints, replaces into
  a one-PP Revival user, and retains a damaging move. A build+URL+runtime-host+wave-1 gate grants one ordinary
  Stormglass before the first authoritative command checkpoint, so its real picker opens at wave 2 on both browsers.
- The workflow reaches both surfaces through normal keyboard/DOM input, prefers Revival only while observer-proven
  usable, and fails unless exactly one Revival and one Stormglass choice event are recorded. Ordinary builds and every
  other journey remain closed to both fixture paths.
- The preceding checkpoint `5a4cc2c3b` is fully remote-green: focused aggregate `30493006862` and exact two-Chromium
  fresh-wave2 journey `30493011238`. Local policy-safe evidence for this next checkpoint is 43/43 Mystery/browser
  contracts, 11/11 workflow contracts, 107/107 Authority V2 source contracts, and no local engine/browser execution.

## 2026-07-29 - Mystery convergence follows the ordered interaction frontier, not the transport role

- Artifact `30491678972` was not a gameplay desync: both clients had mechanically reached wave 4 and ultimately
  published the same wave-4 Mystery address, digest, owner, options, and encounter type. The failure occurred because
  the interaction owner installed wave 4 while the runtime host still retained wave 3; the harness canonized the
  runtime host's retired address and waited forever for the faster browser to travel backwards.
- Paired Mystery convergence now selects the greatest wave/turn address within the same epoch, using runtime host only
  as the deterministic tie-breaker once both observations describe that exact address. A failure-first contract uses
  the artifact's real wave-3/wave-4 ordering.
- The same artifact also contains a separate real presentation defect under a 12-second asset timeout: three guarded
  `pkmn__741` animation failures followed by a fatal stale BBCodeText `drawImage` callback. This is not being excused as
  harness noise; it remains the next production presentation-lifecycle investigation after the registered journey is
  sealed and remotely qualified.

## 2026-07-30 - Retired encounter actors reject late asset presentation callbacks

- The wave-4 Oricorio artifact's three animation errors and fatal BBCodeText `drawImage` shared one lifecycle: the
  bounded 12-second encounter join allowed mechanics to continue, the Mystery transition destroyed that temporary
  Pokemon and its info panel, then the late atlas promise still called `playAnim()` and `updateInfo()` on those dead
  Phaser objects.
- Asset cache/animation construction still finishes globally, but per-instance rendering now stops when the Pokemon is
  inactive. `playAnim()` rejects absent/inactive sprites without manufacturing a missing-asset error, and
  `updateInfo()` resolves inertly once either the Pokemon or retained battle-info panel has been destroyed.
- A remote-only real-engine regression destroys an Oricorio after battle construction, then requires both late callback
  paths to be silent and non-throwing. This closes the browser-observed exception without extending any authority wait
  or weakening fatal-console evidence.
- Dedicated run `30495741492` stopped before build/Chromium because the new conditional wave-count YAML replaced the
  Wide Lens lane's intentionally literal 20-wave source contract. The workflow again retains `20` in its environment
  and overrides to one only inside the registered-interactions process; this preserves both independent oracles.

## 2026-07-30 - Registered interaction fixture obeys the real five-point starter cap

- Exact two-Chromium run `30496100685` paired successfully and reached both ordinary starter screens, then the host
  correctly refused the fixture's third mon: Magikarp costs four points and Seel costs one, so the requested Rattata
  would exceed the real per-seat five-point budget. The screenshot and semantic trace agreed on the accepted pair;
  the harness alone waited for the impossible third species.
- The owner fixture now fields the exact Magikarp/Seel pair required for Healing Wish -> replacement -> Revival
  Blessing. A source contract reads the production starter-cost table and fails if that pair ever exceeds the real
  budget, and the public driver waits for exactly the legal roster. No game rule, authority path, or player-facing
  behavior was weakened.

## 2026-07-30 - Stormglass states its exact post-result command frontier

- Exact registered-interactions run `30497847906` proved both clients installed and settled the same Stormglass
  result at Authority V2 revision 12, replayed the same weather/ability presentation, and then failed closed when
  the host attempted the wave-2/turn-1 command control. Revival had already completed mechanically in the same
  real two-browser run; pairing, launch, replacement, and the Stormglass owner/watcher picker all converged.
- The Stormglass result used the ordinary broad interaction wait. That rule correctly permits a surviving battle's
  command control at turn N+1, but Stormglass is a pre-command battle interaction whose result and command frontier
  are both at N. Its successor now names only the exact same-wave/same-turn `command-open` control address. Generic
  successor admission remains unchanged and wrong-turn or wrong-material controls stay fail-closed.
- A node-pure failure-first contract asserts both the permitted exact command edge and the rejected turn/material
  alternatives. The preceding exact checkpoint remains independently green in focused gate `30497823364` and the
  ordinary two-browser fresh-wave journey `30497823286`; only the registered deterministic path exposed this
  interaction-specific successor seam.

## 2026-07-30 - Interaction-origin victories retain the EXP settlement action

- Exact registered-interactions run `30500034006` proved the Stormglass successor repair no longer triggered its
  prior fail-closed command fault. It instead reached the earlier deterministic Revival boundary: both clients
  installed the same prompt/result through revision 5, replayed the revive HP/message, completed the rest of turn 2,
  and entered the legitimate wild-victory settlement. The authority then parked at an actionable `ExpPhase` while
  the replica remained in its ordered replay watcher; there was no transport loss, checksum mismatch, or state drift.
- Revival's terminal result superseded the turn entry and therefore owned the ordered wait to `WAVE_ADVANCE`. The
  wait's closed presentation lease covered trainer rewards and generic messages but omitted the wild victory's
  `ExpPhase`, so the default-deny UI gate blocked the exact ACTION callback required to make the promised successor
  authorable. `ExpPhase` is now part of that closed action-only settlement class. It grants no party/choice input,
  applies only at the wait's exact wave and N/N+1 settlement turn, and still requires an explicit `WAVE_ADVANCE` edge.
- The node-pure control contract now exercises EXP alongside the existing trainer settlement phases while retaining
  its wrong-address, non-actionable-handler, no-wave-successor, and choice-phase rejection cases. Ordinary exact
  two-browser run `30500006056` and focused gate `30500006039` are independently green at the parent checkpoint.

## 2026-07-30 - EXP settlement retains its reachable level-up action chain

- Source tracing found the immediate successor hidden behind the newly admitted `ExpPhase`: a level gain unshifts
  `LevelUpPhase`, whose public flow can arm the level-up line plus two stat-panel ACTION callbacks before it can open
  a registered learn-move/evolution surface or let `BattleEndPhase` author `WAVE_ADVANCE`.
- The same exact-address settlement lease now names `LevelUpPhase`. It remains restricted to a material-applied
  `AWAIT_SUCCESSOR` that explicitly permits `WAVE_ADVANCE`, the same epoch/wave, turn N or N+1, and a live actionable
  MESSAGE handler. `ShowPartyExpBarPhase` is intentionally excluded because its progress is promise/timer-driven and
  exposes no human input. Party, learn-move, evolution, and other choice handlers remain outside this lease and must
  obtain their own registered Authority V2 control.
- The node-pure contract includes LevelUp in the closed settlement set while retaining the existing rejection proofs.
  Local policy-safe checks: scoped Biome is error-free (four pre-existing complexity infos), `git diff --check` is
  clean, and TypeScript remains at the 215-diagnostic repository baseline with zero diagnostics in the changed files.
  The parent checkpoint `47db3304e` focused gate `30501227491` is fully green; its exact ordinary and registered
  two-browser journeys remain in progress and are deliberately not cancelled or replaced.

## 2026-07-30 - Post-level evolution presentation cannot be frozen behind WAVE_ADVANCE

- Continuing the reachable queue audit exposed a separate handler domain after `LevelUpPhase`: a deterministic co-op
  `EvolutionPhase` finishes through an armed ACTION callback under `UiMode.EVOLUTION_SCENE`, and an evolution-taught
  `LearnMovePhase` can introduce its registered picker through that same message-derived handler. The existing gate
  recognized only `UiMode.MESSAGE`, so the first evolving party member could strand the authority before the next
  interaction or wave commit even though mechanics remained single-owner.
- Runtime proof now distinguishes active MESSAGE and EVOLUTION_SCENE handlers. The ordered settlement lease admits
  only an exact `EvolutionPhase` under the latter; the shared learn-move pre-picker bridge admits only its already
  addressed `LEARN_MOVE` control and exact `LearnMovePhase`. Co-op already disables evolution cancellation and chooses
  the first valid branch deterministically, so neither lease exposes a mechanical choice. All other evolution-mode
  phases remain denied.
- Static source contracts now require both runtime proof wiring and the closed evolution edge. The full 107-test
  Authority V2 source contract is green locally, scoped Biome at error severity and `git diff --check` are clean.
  Node-pure behavioral contracts remain reserved for the external focused runner per AGENTS.md.

## 2026-07-30 - Each V2 replacement checkpoint belongs to its exact player summon

- The completed parent campaign `30500538258` is materially stronger than its aggregate red: the dirty three-wave
  lane and the full animations-on two-wave lane both passed. The Mystery lane reached wave 7 turn 2 before exposing
  the tester-reported simultaneous-switch failure: the guest-owned player faint and both enemy faints produced one
  player `REPLACEMENT` control, the real guest PARTY picker selected slot 3, and the authority received that proposal.
- Production then ran `SwitchSummonPhase`/`PostSummonPhase` for an enemy Caterpie before the player replacement
  checkpoint. The checkpoint captured a field where player field 1 was still fainted and enemy field 2 already held
  Caterpie, so the staged player transaction correctly failed closed for lacking its player presentation seat. This
  was not transport loss or checksum drift; the old sibling checkpoint used ambient summon order and an enemy
  trainer switch consumed a player-owned authoritative boundary.
- A V2 player summon now carries an immutable operation/owner/field/party-slot/Pokemon/species binding and queues its
  own checkpoint only after its `PostSummonPhase` subtree drains. Enemy and legacy summons cannot own that checkpoint,
  and enemy switches no longer suppress their ordinary presentation merely because an unrelated player replacement
  is pending. The checkpoint proves the exact runtime Pokemon is on the bound player field before it may commit.
- Host-owned replacement proposals now stage the selected species instead of the former baton-only payload. The
  cutover also compares the staged party-slot/species selection with the summon binding, preserving fail-closed
  behavior if any wrong phase or party member reaches the carrier.
- The deterministic two-engine trainer regression reproduces the same ordering with both enemy leads fainted and
  the guest-owned player lead at one HP. It requires an enemy summon to start before the bound player summon, exactly
  one `REPLACEMENT_COMMIT`, the chosen player mon plus both trainer reserves on field, and zero forced resyncs. Per
  workstation policy it is authored for the external focused shard and was not executed locally.
- Parent focused gate `30501227491` and exact ordinary two-browser run `30501227488` are green. Exact registered run
  `30501237914` independently reached its deterministic Revival path and failed waiting for the guest's input-inert
  revival watcher; that separate surface failure remains next after this replacement closure. Local policy-safe
  evidence is 107/107 static contracts, scoped Biome clean, zero TypeScript diagnostics (including repository-wide),
  and `git diff --check` clean. No local engine or Chromium execution was used.

## 2026-07-30 - Historical Revival UI cannot be re-driven after its successor opens

- Exact registered-interactions artifact `30501237914` disproves its headline as a production failure. Both browsers
  published `revival:party` at epoch `1828218966946640`, wave 1 turn 2, digest `b5fd989ce342087b`; exactly seat 1 was
  actionable, seat 0 was input-inert, and the campaign recorded its paired semantic convergence before selecting the
  fainted Magikarp. The result committed, both clients reached turn 3, won the wave, and opened the same reward shop.
- The later timeout came from a second harness dispatcher with a wave-wide cursor. Its readiness scanner already
  required semantic-only UI to remain the browser's current public surface, but direct owner resolution omitted that
  guard. It immediately reused the historical Revival owner event, then waited for an impossible old-digest watcher
  after the real watcher had applied the revive. Final screenshots showed the healthy Ability Capsule reward flow.
- Direct dispatch now applies the same current-surface invariant: a semantic-only Revival, Stormglass, reward target,
  or Mystery sub-surface is driveable only while that exact event remains current in its owner browser. A node-pure
  failure-first contract reproduces completed Revival followed by reward-shop and requires owner resolution to return
  null. Focused local evidence is 52/52 campaign contracts, scoped Biome clean, and `git diff --check` clean; no local
  engine or Chromium execution was used.
- Focused run `30503496683` executed no tests: its planner correctly rejected the integration manifest's stale
  `baseSha` before shard selection. The next checkpoint advances that manifest to exact previous tip `356283262`,
  and deliberately retains the simultaneous-switch engine test in the pushed delta so the replacement shard is not
  skipped merely because the first planner stopped before qualification.

## 2026-07-30 - Sequential command frontiers use current semantic addresses

- Parent campaign `30500538258` depth did not expose a product desync at wave 3 turn 4. The host browser visibly
  showed the current partner-wait message at turn 4 while the guest browser opened the real turn-4 command menu;
  both engines were healthy. The browser driver nevertheless compared their last historical legacy command markers
  (host turn 1, guest turn 3) and threw `battle prompt advancement requires one shared public command address`.
- Battle prompt advancement now derives address authority from each browser's current semantic surface, with the
  legacy command mirror used only before a semantic surface exists. A sequential one-browser-ahead frontier is an
  ordinary provisional state: the driver sends no key and keeps polling until both current semantic addresses
  converge, then freezes that exact address for the helper's lifetime. Null never means "any live address".
- A node-pure failure-first contract recreates the exact stale-legacy/current-semantic split. It proves construction
  and the first poll neither throw nor spend input, then advances the second semantic mirror to turn 4 and permits
  exactly one Space on the live turn-4 narration. The campaign and faint-replacement pure suites are 61/61 green;
  both public boundary checks, the 25-test presentation source suite, scoped Biome error diagnostics, and diff checks
  are green locally.
- Focused parent run `30503943750` selected B11 and kept branch static green. Its source lane failed only because an
  old regex required the replacement checkpoint constructor to have exactly one argument after the exact summon
  binding added a second; the contract now asserts the typed default without freezing constructor arity. B11 ran
  95/96 green and stopped the new simultaneous-switch regression before mechanics because random trainer generation
  produced a three-mon party. The fixture now pins the missing fourth enemy before `buildDuo` mirrors both engines,
  guaranteeing two real reserves for the two simultaneous enemy faints without mocking switch scheduling.

## 2026-07-30 - The replacement regression now recreates enemy-first summon order

- Focused run `30504605855` kept the source/node contracts and branch static gate green, then ran B11 95/96 green.
  The replacement regression reached all of its mechanical assertions: one exact bound player summon, no ambient
  unbound player summon, one `REPLACEMENT_COMMIT`, both trainer reserves plus the selected Charizard on field, and
  zero forced resyncs. Its sole failure was the test's reproduction precondition: the player summon ran at index 0
  and the first enemy summon at index 1, so the fixture did not exercise the historical enemy-first phase order.
- The earlier Earthquake setup fainted the player partner before its enemy targets, naturally scheduling the player
  replacement first. The fixture now uses a real enemy-only Dazzling Gleam to faint both trainer leads and a real
  end-of-turn burn to faint the guest-owned player afterward. Enemy moves are pinned to Splash. This produces the
  production phase ordering without mocking or rearranging `PhaseManager`: the enemy summon must precede the later
  player picker, while the same exact summon-binding and zero-resync assertions remain intact.
- Local policy-safe evidence is scoped Biome plus `git diff --check`; the engine regression remains remote-only per
  `AGENTS.md`. The ownership manifest advances to exact parent `b379e805e` so the next focused B11 run cannot be
  mistaken for evidence from the earlier fixture.

## 2026-07-30 - Double-trainer replacement fixtures reserve each trainer slot

- Focused run `30505309974` proved the corrected enemy-first reproduction: the enemy summon preceded the bound
  player summon, the player transaction committed exactly once, the selected Charizard occupied the guest-owned
  field, and no forced resync occurred. Its final assertion exposed a separate fixture defect: a four-mon partnered
  trainer party did not guarantee a legal reserve for both trainer slots, so only one enemy slot could refill.
- The fixture now requires one off-field reserve per simultaneously-fainting lead within each exact `trainerSlot`,
  adding a Shuckle only behind a deficient slot. This matches `FaintPhase`'s production legality rule for partnered
  doubles; checking total party length alone could silently put the extra reserve behind the already-covered trainer.
- No product path changed. The next focused B11 run must prove the full enemy-first + exact player binding + both
  legal enemy replacements + zero-resync chain on parent `7f5e6c985`.

## 2026-07-30 - Enemy KO injection occurs after trainer commands are locked

- Focused run `30505754322` again proved enemy-first summon order, the exact bound player replacement, one V2 commit,
  selected Charizard placement, and zero forced resyncs. Both enemy `SwitchSummonPhase` instances also ran. The final
  identity assertion failed because the fixture set foes to one HP before the real AI chose commands: it voluntarily
  switched one low-HP original lead, then later selected that still-healthy original as a legal faint replacement.
- The host trace made this visible as a `SwitchSummonPhase` during `TurnStartPhase`, before Dazzling Gleam, followed by
  the two post-faint enemy summons. The fixture now lets both real enemy commands lock while the leads are healthy,
  stops immediately before `TurnStartPhase`, and only then sets the two live foe images to one HP on host and guest.
  No production phase, command, switch, or authority API is mocked.
- The next remote B11 pass on parent `ed0b58239` must therefore prove the intended live topology: two current leads
  faint first, two genuine bench actors summon, the guest-owned burned actor faints at turn end, and its exact bound
  replacement commits without being consumed by either earlier enemy summon.

## 2026-07-30 - Exact replacement and registered-interaction closure

- Focused run `30506254760` is fully green at exact SHA `a08b1f0ac85c1756815dec2d7fcf05416f242a48`.
  The deterministic two-engine regression now proves the intended enemy-first ordering, two legal trainer-slot
  replacements, one exact bound player replacement commit, Charizard in the guest-owned field slot, and zero forced
  resyncs. The source/node contracts, planner, ownership gate, and static/type lane are green in the same run.
- Exact two-browser registered-interactions run `30506589457` is green at the same SHA. Its compact artifact records
  one real faint replacement, a host-owned Revival choice at wave 1 turn 2, a host-owned Stormglass choice at the
  wave-2 turn-1 command frontier, wave 1 cleared, both browsers advanced to wave 2, graceful cleanup, and no terminal
  error. This closes the historical Revival-owner reuse false failure with current-surface evidence.
- Exact fresh-wave2 two-browser run `30504605880` is also green on the same product code; the later commits through
  `a08b1f0a` changed only engine fixtures, the ownership manifest, and this progress record.

## 2026-07-30 - B7 switch-mirror fixture follows the real Pokemon lifecycle

- Full aggregate run `30507407743` reached 38 green jobs before Lane B 7/13 reported red. All 11 files and all 77
  assertions in B7 passed; the only failure was a Vitest unhandled rejection after the switch-mirror test completed.
  Its directly constructed Pikachu bench member had skipped `Pokemon.init()`, so the later real
  `setFieldPosition()` call found no `battleInfo` panel. Production trainer parties are initialized before they can
  be seated, and the exact browser journeys do not reproduce this error.
- The fixture now calls `bench.init()` before adding the member to the enemy party, preserving the distinct-species
  switch setup while matching the production object lifecycle. No production behavior is weakened or changed. The
  aggregate red is classified as a harness-fixture failure, but the noisy signal is still repaired rather than
  waived.
- Focused run `30507854271` is fully green at test-only tip `729b21524`, including B7, all source/node contracts,
  static/type, and its required aggregate. This independently closes the aggregate run's only substantive red job.

## 2026-07-30 - Mystery grid navigation explores each observed cursor state

- Exact mystery-gauntlet run `30506589586` kept both browsers synchronized through five consecutive Mystery surfaces,
  one real replacement, and wave 6. At Fight Club both clients showed epoch `1828225473892116`, wave 6 turn 1,
  Mystery type 85, digest `42080feb9dae5374`, and owner seat 1; the owner remained explicitly actionable. The red was
  the browser driver timing out while trying to select the visible third choice, not a production softlock.
- Trace evidence shows the former global `Right, Down, Left, Up` fallback repeatedly traversed
  `option 1 -> option 0 -> View Party` and never tried `Down` while option 0 was selected. The public UI and keyboard
  input remained healthy throughout. `selectOptionById` now advances its direction index per exact observed selection
  plus option set, so a grid cycle cannot pin one cursor state to one ineffective direction forever.
- A node-pure failure-first regression recreates a four-cell Mystery grid whose global modulo sequence cycles while
  the target is reachable from a direction never attempted at that state. It requires the public-key driver to reach
  and submit the target without any DOM or game-state mutation shortcut. Production co-op code is unchanged.

## 2026-07-30 - Rejected voluntary switches remain owned until a relay command exists

- Exact tip `1d5be4cfc177c81d604ee677ff3df17ea7831bfd` has a fully green 45-job aggregate gate in run
  `30508656241`; focused source/node/static qualification is green in `30508485575`. The Mystery-only campaign
  `30508566981` proved the preceding grid-navigation repair by selecting Fight Club option 2, then exposed a new
  harness frontier at wave 2 turn 3 while both browsers retained the same address and digest.
- The critically injured host selected a healthy host-owned reserve through Command -> Pokemon -> Send Out. The
  production input handler accepted every key but emitted no `[coop:relay] broadcastLocalCommand SEND`; instead it
  presented one actionable CommandPhase message and reopened the same exact host command frontier. The generic
  sequential driver had already retired the host as if a command existed, so it incorrectly waited for a guest
  frontier that remained gated behind the missing host proposal.
- Voluntary campaign switches now count only after post-input relay evidence. If CommandPhase narrates a rejection,
  the owner dismisses that exact-address prompt once, proves the same actionable command frontier reopened, and
  continues through Fight without surrendering ownership. A node-pure public-key regression recreates the complete
  UI -> rejected Send Out -> prompt -> same command -> relayed attack chain; no DOM or game-state mutation is used.
- The change is harness-only. The already-qualified Authority V2 product runtime is unchanged; the next remote proof
  is the Mystery profile alone at the new exact SHA, not a redundant rerun of the three already-green profiles.

## 2026-07-30 - Depleted move sets switch through the public command UI

- Exact harness tip `b21f4d796e49fc4aaba3bc3cedcac849a969f0d4` is fully green in focused run
  `30510424625`: planner/ownership, all source and node-pure contracts, static/type, P2, C5, and the required
  aggregate passed. Automatic two-browser fresh-wave2 run `30510424441` is also green. The exact 10-wave Mystery
  run `30510438462` proved the rejected-switch repair by progressing far beyond the old wave-2 owner timeout.
- That run cleared six consecutive Mystery surfaces to the shared wave-7 command frontier, including alternating
  interaction owners, a guest-owned Mystery party sub-prompt, one real faint replacement, rewards, and a four-turn
  Mystery battle. It stopped cleanly with both browsers at epoch `1828230599614993`, wave 7 turn 1, digest
  `842da5aa7c08bddd`: the guest's only visible move was correctly projected as `usable:false`, and the harness had no
  human-equivalent all-PP-depleted policy. This was neither a desync nor a softlock.
- The campaign driver now treats a complete observer-proven unusable move set as a command decision, not an error.
  It presses Backspace to leave Fight, proves the same exact owned command reopened, orders healthy owned reserves
  deterministically, and tries Send Out until a real post-input relay command exists. A rejected reserve remains on
  the same owner and advances to the next reserve; the sequential round is never retired on keypress alone.
- A node-pure failure-first regression recreates the exact public chain: actionable command -> Fight -> one unusable
  move -> Backspace -> exact command -> Pokemon -> owned reserve -> Send Out -> relay proof. It forbids an attack
  record and uses no DOM/game-state mutation. The next exact proof remains Mystery-only because runtime product code
  and the already-green aggregate are unchanged.

## 2026-07-30 - Deterministic reward move learning retains an action-only V2 lease

- Exact Mystery run `30512187831` reached a synchronized wave-1 reward continuation and applied Horn Attack to both
  Seel copies. Both final screenshots visibly showed `Seel learned Horn Attack!` with the ACTION arrow, at the same
  epoch/wave/turn and state digest, but both semantic observers reported `inputBlocked:true`. This was a production
  softlock: `Ui.processInputCoopAware` rejected the Space a real player had to press while the reward terminal's
  ordered successor wait remained current.
- This empty-slot auto-learn path is deterministic and exposes only an action-only MESSAGE before WAVE_ADVANCE can be
  authored. `LearnMovePhase` now belongs to the closed wave-settlement presentation set, so that exact active MESSAGE
  handler can drain. CONFIRM and SUMMARY remain excluded by construction and still require the typed LEARN_MOVE
  shared control; wrong address and waits without WAVE_ADVANCE stay frozen.
- Failure-first Authority V2 control coverage now includes the positive deterministic learn narration and its
  no-wave-successor denial. The browser source contract also requires the phase to remain in the closed settlement
  set. No Showdown, tournament, triples, deployment, or legacy correctness path changed.

## 2026-07-30 - Exhaustive Mystery registry proof avoids per-case matcher noise

- Full aggregate run `30514422658` timed out after 20 seconds in the single exhaustive seeded-gauntlet registry test.
  All other Lane A files passed, and the same exact product SHA passed the same A1 assignment minutes earlier in
  focused run `30513387665`. This is a wall-clock test implementation failure, not a product or registry mismatch.
- The proof still evaluates every Mystery-designated wave for all 512 deterministic seeds. It now performs the hot
  loop with plain comparisons, counts every checked pair, and reports the first 16 invalid selections plus the total
  if any exist. Only the final coverage assertion uses a Vitest matcher, removing tens of thousands of matcher calls
  without reducing one seed, wave, or production invariant.
- Existing exact-SHA two-browser campaigns and aggregate evidence remain untouched. This change is test-only; no
  runtime, Showdown, tournament, triples, or deployment behavior changes.

## 2026-07-30 - Mystery campaign recognizes the input-frozen mirrored Bargain screen

- Exact Mystery run `30513537000` cleared seven waves and six consecutive ordinary Mystery surfaces, then reached
  the wave-9 Bargain with both browsers on the same address and `b6cecff493129300` state digest. Both final screenshots
  visibly show the same Giratina offer. The owner observation was actionable for seat 0; the watcher observation
  retained `seatsWithInput:[0]` and `inputBlocked:true`.
- Production intentionally replaced the old watcher-only text with the complete immutable Bargain offer while
  freezing its controls. The browser campaign was stale: it still waited for `mystery-encounter:message`, so it timed
  out on a stronger correct presentation. The oracle now requires an actionable exact owner and an explicitly
  input-frozen mirrored `bargain` watcher at the same address, digest, encounter metadata, and option image.
- Failure-first node-pure coverage rejects a watcher whose input is unblocked or whose digest diverges. This is a
  harness-only correction; Authority V2 runtime, Showdown, tournament, triples, and deployment behavior are unchanged.

## 2026-07-30 - Mystery campaign drains the Bargain owner's terminal narration

- Exact follow-up run `30515740250` proved the mirrored Bargain checkpoint at wave 9, then failed later with the owner
  visibly on Giratina's actionable `Leaving?` MESSAGE while the watcher correctly retained the input-frozen offer.
  Both remained at Authority V2 address `1828237916126050/9/1` and digest `f1163e66233d2af0`; this was neither a
  mechanical divergence nor a production softlock.
- A human owner must press ACTION once to dismiss this final `TheBargainPhase` narration before the immutable Bargain
  result can release the watcher. The campaign's closed Mystery-narration allowlist covered ordinary encounters,
  quizzes, and replay phases but omitted Bargain, so the public-key driver left a genuinely actionable prompt idle.
- `TheBargainPhase` is now admitted by that same readiness/owner/address-gated narration driver. Node-pure coverage
  proves the exact owner prompt is pressed once and never consumed twice. Runtime, Showdown, tournament, triples, and
  deployment behavior remain unchanged.

## 2026-07-30 - Integrate current feat and close two browser-observed presentation failures

- The latest `feat/elite-redux-port` tip `11e79cca9` is merged into the Authority V2 integration line. The three
  textual conflicts preserve the already-qualified atomic co-op/Showdown lobby boundary, retain the stronger room
  constructor contract, and accept feat's current Ghost Trainer fixture while keeping co-op triples disabled.
- Fresh two-browser run `30517753247` was mechanically green through the exact wave-2 command frontier, but visual
  inspection found the guest still displaying the preceding ability flyout over command input. The host records
  `showAbility` but previously treated `HideAbilityPhase` as renderer-local. `hideAbility` is now a closed wire event,
  replayed in order through a receipt-owned `CoopHideAbilityReplayPhase`; a runtime watchdog forces the safe hidden
  terminal state if the cosmetic tween stalls.
- Mystery run `30517825943` cleared four consecutive Mystery encounters and remained transport/state synchronized at
  wave 6. Its only fatal browser event was a host `displayHeight` dereference in Dancing Lessons: at the deliberately
  throttled render rate, the intro `EncounterBattleAnim` was still draining after the encounter retired/rebuilt the
  Oricorio field actor. `BattleAnim` now captures geometry from the exact starting sprites and terminates/cleans up
  immediately when either render surface is retired or replaced, instead of crashing a tween callback and stranding
  progression.
- Node-pure contracts cover both lifecycle boundaries. Remote focused/static, aggregate, fresh, surface-animation,
  and Mystery qualification remain required on the resulting exact SHA; no staging or production deploy is part of
  this checkpoint.
- Aggregate run `30520664562` correctly failed its early static/contract sentinels before the engine matrix settled:
  the new watchdog test's Phaser spy returned `void`, and the headless replay pump's closed phase inventory omitted
  `CoopHideAbilityReplayPhase`. The spy now preserves `TweenManager`'s return type and the actual two-engine replay
  drain starts/ends the teardown phase before declaring the authoritative turn complete. The failure-first source
  contract is green locally; the rest of that exact run remains intact for independent merge/product evidence.
- Artifact triage of representative B1, C1, and P1 failures from that aggregate proved the broad engine red set had
  the same single cause: each test reached a queued `CoopHideAbilityReplayPhase` and the shared headless driver failed
  closed before finalize. The current-tip focused gate then passed source/static/A/P but exposed one second test-local
  phase inventory in `coop-battle-events.test.ts`; its bespoke replay driver stopped before the checkpoint, leaving HP
  at 32 instead of the streamed 9. That fixture now also drains the exact hide phase. This is test-driver wiring only,
  while the old aggregate and all browser runs remain undisturbed as required.

## 2026-07-30 - A wiped remote owner proves its exact no-surface replacement control

- Mystery run `30520664321` reproduced a real asymmetric replacement deadlock at wave 4 turn 7. The authority browser
  waited on `Waiting for your partner to choose their next Pokemon...`, while the replica remained on `Seel fainted!`.
  Both retained the same mechanical state; this was not a checksum divergence or a campaign-driver timeout.
- Revision 30 correctly opened the guest-owned replacement before the remaining host replacement. The replica proved
  that its owner half had no legal reserve and had already relayed the addressed `NONE` choice, but its exact
  `CoopGuestFaintSwitchPhase` could not install `controlInstalled`: the typed automatic-replacement proof was wired
  only to the authority's `SwitchPhase`. The authority therefore retained the `NONE` proposal without permission to
  consume it, and both peers waited forever.
- The no-choice branch now installs the same address-exact, non-actionable automatic-replacement ledger proof from
  either owning engine phase. It rechecks local ownership, phase identity, operation id, faint address, and absence of
  a legal same-owner reserve; it opens no PARTY handler and grants no human input. Ordinary projection recognizes that
  stronger proof before requiring a public PARTY surface, allowing the existing `NONE` proposal to become the exact
  immutable `REPLACEMENT_COMMIT` and advance to the next typed control.
- Failure-first source coverage requires the replica proof before the no-choice result parks and forbids weakening the
  public-handler contract. The complete source contract is locally green at 108/108; remote focused, aggregate, and
  exact two-browser Mystery requalification remain pending on the resulting commit.

## 2026-07-30 - Embedded Mystery battles retire the replica selector before presentation

- Independent exact-tip Mystery run `30522043292` cleared four consecutive registered encounters, then exposed a
  different product deadlock at the wave-5 Mysterious Challengers trainer battle. The authority reached CommandPhase
  and authored CONTROL_COMMIT revision 23; the replica remained in `MysteryEncounterBattlePhase`, so the authority's
  `cmd:5:1` rendezvous waited indefinitely for the absent replica command consumer.
- The replica screenshot and semantic trace showed the exact cause: `CoopReplayMePhase` ended synchronously while its
  retired `MYSTERY_ENCOUNTER` selector handler was still current. The renderer-only battle phase inherited that
  handler, painted the trainer intro over the old option grid, and could neither complete the presentation prefix nor
  install the ordered command control. This is a production presentation/progression defect, not harness noise.
- The committed handoff now queues the immutable battle destination, crosses a bounded asynchronous MESSAGE-mode
  transition, and ends the replay phase only if the exact runtime, Mystery pin, and phase generation are still live.
  The replica therefore starts `MysteryEncounterBattlePhase` on the normal battle message surface; stale UI callbacks
  cannot advance a replacement session. A source contract forbids restoring the synchronous selector-inheriting edge.

## 2026-07-30 - Bargain terminals and rejected switches retain their captured control boundary

- Broad exact-tip campaign run `30526765498` reached the wave-9 Bargain, applied and receipted its presentation on
  both browsers, then rejected the owner's complete terminal before it could enter the mechanical V2 log. The owner
  had ended its phase first, so ambient `currentBattle` described wave 10 while the immutable result still described
  wave 9; the envelope/state validator correctly failed closed rather than consuming a mixed-coordinate revision.
- Both owner and guest-proposal Bargain commits now derive wave/turn from the captured authoritative outcome. Local
  or watcher progression can no longer relabel an immutable result after `end()`; a source contract covers both
  commit edges and rejects the ambient-coordinate regression.
- The same run's depth lane submitted a visible guest-owned reserve switch, but a tag/Fairy-Lock rejection kept the
  PARTY handler current, emitted no relay command, and never restored the command frontier. This was a production
  control/UI defect, not a driver timeout.
- Trapped voluntary switches now retire PARTY through MESSAGE, narrate switch semantics, and restore the exact
  field's COMMAND handler after dismissal. The source contract and simulated public-driver fallback are green;
  the complete local node-pure contract set passes 157/157 before remote causal requalification.

## 2026-07-30 - Bargain coordinates become intrinsic and Mystery targets ignore stale owners

- Focused exact-SHA run `30537052257` passed every selected source/engine shard and its real two-browser public
  journey, but its static lane caught four TypeScript diagnostics in the Bargain coordinate fix. The phase was
  reading complete-state fields through broader transport unions even though the operation boundary is the component
  that validates the immutable result.
- Bargain result commits now accept no caller-supplied wave or turn. The operation boundary validates the complete
  `meResync` image first and derives both coordinates from `authoritativeState` internally for host-owned and
  guest-owned results. This closes the ambient-coordinate API seam as well as the compile failure.
- Exact Mystery artifact `30526577924` showed a separate harness-only stall: during a chained wave-6 reward target,
  the host's superseded wave-1 self-owner was found before the guest's current actionable owner. Semantic-only owner
  resolution now discards superseded per-client candidates before selecting a seat, so a historical asymmetric
  surface cannot hide the partner's live control.
- Failure-first owner-resolution coverage reproduces the cross-seat history exactly. Bargain/source/campaign
  contracts pass 165/165 locally; full `tsc` reports only the repository's existing non-co-op baseline and no
  diagnostics in the changed co-op files. Remote exact-SHA static and causal Mystery requalification remain required.

## 2026-07-30 - Bargain owns its signed next-wave scheduler bridge

- Exact Mystery run `30537141109` proved the earlier coordinate fix, cleared the first six scripted Mystery
  encounters plus the wave-7 trainer and wave-8 boss, then exposed a distinct Authority V2 scheduler deadlock after
  the host-owned wave-9 Bargain. The host correctly committed global revision 47 and advanced to the wave-10 Lake
  Spirit encounter; the replica applied and acknowledged the same immutable result but fell into wave-9
  `CoopReplayTurnPhase`. The host then waited in `NextEncounterPhase` for the replica's wave-10 destination consumer.
- The Bargain presentation projector intentionally destroys the replica's speculative phase tree. Its result had
  stated `AWAIT_SUCCESSOR` with `allowNextWaveStart:false`, so no authority-owned `NewBattlePhase` survived to replace
  that discarded tree. This was a production progression seam, not campaign noise or a checksum divergence.
- A complete Bargain result now explicitly authorizes N+1. Every projected owner/watcher phase binds that immutable
  wait, replaces any guessed NewBattle tail with the signed bridge, and closes through
  `shiftPhaseThroughCoopAuthorityCommit`; neither peer can start an ambient `TurnInitPhase` nor advance to the next
  wave before the result is retained and its exact phase terminal is proved. Host-owned and guest-owned outcomes use
  the same atomic edge.
- Failure-first source contracts cover the N+1 successor, exact runtime/scene binding, signed bridge installation,
  and atomic phase close. The combined Authority V2, campaign, and Bargain source suite passes 166/166; Biome and
  changed-file TypeScript diagnostics are clean. Exact two-browser Mystery requalification remains required.

## 2026-07-30 - Depth campaign stops weakening successful attacks by turn ordinal

- Exact depth run `30537161760` was mechanically synchronized through wave 2 and reached a normal shared GameOver,
  but wiped after only one clear. Its public evidence showed the driver selecting progressively weaker moves solely
  because the turn number increased: the decisive second wave-2 round used visible power 60 + 25 even though each
  actor had a healthy visible 80 + 40 option and no immunity or failed-command evidence existed.
- Ordinary campaign rounds now omit the alternate-move index and therefore keep choosing the strongest visible,
  usable damaging move. The explicit cycling primitive remains available for a caller that has actual evidence a
  move must change; a successful prior turn is no longer treated as such evidence.
- Node-pure and browser-build boundary contracts forbid restoring `cycleIndex: turn - 1`. This changes only
  human-equivalent browser policy, not production battle state, Authority V2, Showdown, tournament, triples, or
  deployment behavior.

## 2026-07-30 - Semantic-only Bargain ownership retires with the owner's picker

- Pre-scheduler-fix Mystery run `30539104150` reached wave 9 with an actionable host-owned Bargain and a converged,
  input-frozen watcher replica. After the owner publicly declined, it correctly advanced to the terminal narration
  while the watcher retained the offer; the campaign then combined that current watcher with the owner's historical
  Bargain event and falsely threw `campaign-owner-evidence` before the narration driver could act.
- The strict malformed-owner check now applies the same current-only rule already used by semantic-only owner
  selection and registered-surface discovery. One current watcher plus a superseded owner picker is provisional
  ordered progress, not a malformed two-sided control and never permission to spend a second Bargain key.
- A node-pure regression recreates the exact owner-advanced/watcher-retained surface history and proves it returns no
  pending Bargain owner without throwing. Production Authority V2 behavior is unchanged.

## 2026-07-30 - Manual co-op qualification stays inside its runner allocation

- A full aggregate previously expanded to 37 matrix jobs before its mutation/browser/static sentinels, which could
  consume the complete 40-runner account while an independent workstream still owned reserved capacity. The manual
  workflow now defaults to the two-player co-op lanes A/B/C/P and keeps unchanged Showdown and triples out of this
  qualification, matching the active product scope.
- The matrix planner accepts an explicit, fail-closed lane subset and proves complete weighted coverage of every file
  in each selected lane. Duplicate, unknown, empty, and quarantined lane selections are rejected; feat push
  qualification retains the all-surface A/B/C/P/S/T inventory.
- The heavyweight matrix is capped at 24 concurrent jobs so its four mutation shards and browser/static/source
  sentinels remain inside the 32-runner co-op allocation. The co-op-only plan is exactly 21 shards
  (A=1, B=13, C=5, P=2); its source contract passes 15/15 and changed-file formatting is clean.

## 2026-07-30 - Depth campaigns avoid optional press-your-luck Mystery battles

- Exact depth run `30542111085` cleared three waves with matching state and presentation evidence, then both peers
  entered the same Authority V2 terminal after the driver chose Dancing Lessons option zero and lost its optional
  enraged two-bar boss fight. Revision 29 reached `controlInstalled` on both browsers; this was a synchronized
  Game Over, not a desync, softlock, or terminal-authority defect.
- The long-running depth profile now chooses the last enabled Mystery option, matching the already-qualified Mystery
  gauntlet's lower-risk public-key policy. The animation-surface profile deliberately retains option zero so embedded
  Mystery battles remain covered rather than disappearing from the browser matrix.
- Profile contracts prove the split explicitly. Production code, Authority V2, Showdown, tournament, triples, and
  deployment behavior are unchanged.

## 2026-07-30 - Final-boss same-form promotion enters the presentation stream

- The Hell finale changes its phase-two boss into a Black Shiny without changing form. That path directly reloaded
  assets, refreshed the nameplate, tinted the sprite, and sparkled only on the authority; the mechanical checkpoint
  carried the resulting state but supplied no ordered presentation instruction to the replica.
- A closed `appearance` event now carries exact actor, species, form, shiny variant, and Black-Shiny identity. Its
  renderer installs only that immutable visual preimage, re-enters the captured runtime after asset/info promises,
  and is bounded by the same hard presentation watchdog as form/Transform replays. The existing exact-actor sparkle
  event follows it, so the replica cannot sparkle a stale atlas or omit the cue.
- The strict validator rejects incoherent Black-Shiny material, the renderer switch remains compile-time exhaustive,
  and the production renderer gate plus headless drain inventory include the new phase. The source contract is green
  at 26/26, full TypeScript is clean, and changed-file formatting is clean; remote engine qualification remains due.

## 2026-07-30 - Appearance schema follow-up restores exact qualification boundaries

- The first final-boss push failed before executing tests because its locked `coop-transport.ts` change lacked the
  integration manifest's exact declaration. The declaration-only follow-up then also failed before tests because a
  push train must declare the immediately preceding remote tip, not an older two-commit base. Neither result is
  product evidence.
- The earlier automatic browser bundle independently found one real test-migration omission: the canonical receipt
  parser already accepted `appearance`, but its exhaustive expected-kind inventory did not list it. The inventory now
  includes the event; this changes no Showdown or tournament runtime behavior.
- The ownership manifest now advances to the exact preceding tip and clears the single-use locked-schema declaration.
  A focused source/static run must qualify this follow-up, and the capped full A/B/C/P aggregate must provide the
  complete engine proof for the final-boss appearance implementation.

## 2026-07-30 - Browser campaigns close account-local Bargain and IV-scanner input seams

- Exact Mystery run `30542668305` cleared six consecutive Mystery encounters plus the wave-7 trainer, then the
  guest watcher terminated on `Bargain presentation 8 was not executable`. The immutable offer was
  `[lust, greed, gluttony]`; Lust availability reads account-local candy, which is deliberately absent from the
  adopted shared state. The authority had validated and retained the offer, but the replica incorrectly re-derived
  it from its own account. Replica Bargain phases now trust the strict immutable offer; only the mechanical authority
  may reject an offer against its source state.
- Exact depth run `30545514114` reached matching `ScanIvsPhase` prompts on both browsers at the same V2 address and
  digest. The phase is renderer-only, but the global interaction freeze reported both real CONFIRM handlers as
  blocked, while the campaign had no driver. A cycle-free local-presentation-input registry now feeds renderer
  admission, production UI dispatch, and the sealed browser observer. Each browser owns its own IV-scanner prompt;
  the campaign visibly selects `no` through verified keys and suppresses only that client's exact appearance.
- Local source evidence is green: Mystery/public driver contracts 51/51, Bargain ordering contracts 3/3,
  presentation contracts 26/26, changed-file Biome clean, and `git diff --check` clean. The preceding remote static
  run correctly caught the appearance event's validated numeric variant being assigned to the narrower `Variant`
  field; replay now crosses that boundary with an explicit type-only cast. A repeated local full compile became a
  3.3 GB survivor and was terminated under the workstation-contention rule, so the next remote static shard is the
  authoritative compile proof. Exact Mystery/depth browser requalification also remains required; no deployment is
  authorized.

## 2026-07-30 - Retained party EXP receipts the flyout instead of a second field tween

- Exact Mystery run `30552115976` mechanically cleared six waves (including the wave-4 embedded battle) and exact
  depth run `30552115449` cleared all four requested waves with two replacement controls. Both peers reached matching
  later command surfaces, but each campaign correctly failed its strict presentation ledger when the replica's
  level-crossing party EXP cue exceeded the 15-second renderer watchdog.
- The authority's `ShowPartyExpBarPhase` starts the field-info refresh without awaiting it and owns progression through
  the small party EXP flyout. The replica instead awaited a second non-instant `PlayerBattleInfo` EXP tween before it
  showed that flyout. At the remote browser's deliberately constrained frame rate, the recursive level-boundary tween
  exceeded the receipt deadline even though mechanics, state, and the later public screen remained synchronized.
- Replica party EXP now installs the immutable level/EXP preimage through `updateInfo(true)` and still renders and hides
  the exact retained party flyout before emitting `renderer-completed`. A source contract fixes that lifecycle order;
  the next exact-SHA qualification must prove both campaigns have zero failed presentation receipts.
- Follow-up inspection found that `PlayerBattleInfo.updateInfo(true)` honored the instant contract for HP/status but
  hard-coded its EXP sub-update back to animated and retained the half-second level-boundary delay. The instant flag now
  reaches the complete recursive EXP update, including a synchronous level-boundary continuation and no duplicate
  level-up sound. This makes the replay fix real instead of merely changing its call-site spelling.
- A Phaser tween with duration zero still waits for a render tick, so the instant branch now writes the exact EXP-mask
  endpoint directly and bypasses TweenManager altogether. Multi-level immutable updates therefore complete in
  microtasks rather than one low-FPS frame per crossed level.

## 2026-07-30 - Reward-target rejections become public, recoverable campaign states

- Exact SHA `73c0639ff` is qualified by focused gate `30557525600`, the complete capped A/B/C/P aggregate
  `30558170443`, normal two-browser wave-2 journey `30557525012`, and four-wave depth campaign `30557704292`.
  The aggregate used 31 or fewer co-op runners, below the user-owned ceiling of 32. The depth campaign crossed the
  formerly failing wave-4 party EXP frontier and reached wave 5 with no desync, softlock, or presentation failure.
- Mystery campaign `30557701282` also crossed that EXP frontier and cleared six consecutive Mystery surfaces plus its
  wave-7 trainer. It then selected `BASE_STAT_BOOSTER` on slot zero, received the visible and recoverable
  `Seel can't take this item!` prompt, and stayed there until the harness deadline. Both screenshots and exact-address
  semantic evidence remained synchronized; this was a public-driver coverage gap, not an Authority V2 failure.
- PARTY inherited a callback-backed message prompt but the CI semantic observer deliberately flattened every PARTY
  `awaitingActionInput` value to null. A read-only accessor now exposes only the real callback-backed prompt state;
  normal cursor surfaces remain null/actionable, while an inoperable-item message reports true. The campaign dismisses
  that prompt with Action, tries each legal visible target in acting-seat-first order, and, if all targets reject,
  cancels back to the same reward shop and chooses an untried reward. It never reads localized text or private
  modifier state and still drives exclusively through public keys.
- Local node-pure campaign/semantic contracts are green, changed-file Biome is clean, and `git diff --check` is clean.
  The next remote step is a focused source/static gate followed by the exact ten-wave Mystery profile; the full
  aggregate does not need repeating unless remote compile evidence exposes a production-impacting change.
- The first exact-SHA push proved remote TypeScript, formatting, workflow/source contracts, and the selected A1 shard,
  then the ordinary journey's preflight caught its own stale source assertion: it still required the one-target helper
  call that the retry loop deliberately replaced. The boundary now seals the stronger candidate-exhaustion, prompt
  observation, and alternate-reward recovery contract. No browser gameplay ran under that stale preflight result.

## 2026-07-30 - A projected World Map cannot mistake a refused pre-start UI open for success

- Exact Mystery run `30563290512` cleared the prior inoperable-reward frontier, six consecutive Mystery surfaces,
  the wave-7 trainer, the wave-8 boss, the wave-9 Bargain, and both wave-10 Mystery terminals. It then exposed a real
  replica control failure at global revision 51: the authority opened the actionable World Map, while the replica's
  projected `SelectBiomePhase` retained the preceding callback-backed MESSAGE handler. The replica remained at
  material frontier 51 / control frontier 50 until its bounded recovery correctly failed the shared session closed.
- The exact trace showed why the map never appeared. Authority projection starts a replacement phase inside the
  phase-manager's atomic install; its UI fence is briefly false until that phase becomes current. `setModeInternal`
  correctly made no mutation, but `setModeBoundedWhen` translated the resolved no-op into `"completed"`. The biome
  watcher therefore believed ER_MAP was installed and waited for a public surface that could never exist.
- `setModeBoundedWhen` now reports an initially false caller fence as `"superseded"` before creating a transition or
  timeout. The existing address-exact biome recovery then retries after the projected phase is current and can install
  the real read-only World Map. A failure-first UI seam test proves the refused pre-start attempt mutates no handler,
  increments no transition generation, leaves no timer, and cannot report completion. This is a generic bounded-UI
  contract repair; no Showdown, tournament, triples, deployment, or legacy authority behavior is changed.

## 2026-07-30 - Live soak progress and continuous navigation qualification

- Long-running two-browser campaigns now print every structured progress boundary immediately as
  `[coop-soak:progress]` and emit a read-only `[coop-soak:heartbeat]` once per minute with elapsed time, current/target
  wave, and each Chromium client's latest phase, surface, address, readiness, and evidence count. The timer samples
  only already-captured evidence, sends no browser input, and is cleared during campaign flush. The single-process
  engine soaks likewise print machine-readable `wave-start` and `wave-complete` records, so a stalled run exposes its
  exact last wave and both engine phase names before end-of-run artifacts exist.
- A new exact-build-and-URL-gated `navigation-depth-30` journey drives one continuous two-Chromium session for 30
  waves. Both seats visibly choose three point-legal starters that are assigned level 100 only while the initial shared
  save is constructed; there is no runtime healing hook. Its closed acceptance contract requires the wave 10/20/30
  markets, both interaction-owner seats, Crossroads Stay and Leave, World Map completion, a second biome, the ordered
  reward -> market -> Crossroads -> map chain, the wave-20 trainer boss, paired arena/weather/terrain parity, and
  trainer-presentation cleanup at wave 21. The job has a 240-minute ceiling and consumes one campaign runner.
- The prior exact-SHA matrix isolated two additional frontiers. The Mystery lane exhausted every visible move with no
  legal reserve, so the public driver now selects the visible depleted slot and lets production convert it to Struggle.
  The registered-interaction lane proved Stormglass can legitimately hand off to same-address `ME_PRESENT` on Mystery
  difficulty; its V2 successor now admits exactly that interaction or the existing same-address command, while wrong
  kinds/turns remain denied.
- Local public-source qualification is 193/193 green, campaign/public boundary checks are green, changed-file Biome is
  clean, and `git diff --check` is clean. TypeScript, Authority V2 Vitest, and real Chromium execution remain remote-only;
  the next exact-SHA roll must prove the focused gate, Mystery, registered interactions, and the new navigation journey.

## 2026-07-31 - Retained evolution presentation follows immutable state

- The exact two-browser evolution journey proved a real presentation race: later authoritative turn state had already
  reconciled the guest party to the evolved species before the retained wave-progression cutscene replayed. The old
  renderer required the live party member to remain in its pre-evolution form, skipped the evolution cue, and continued
  mechanically without desyncing.
- Evolution progression events now retain complete immutable pre- and post-evolution PokemonData images. Admission
  validates both images against the same Pokemon id and their stated species/form identities. Replay still rejects a
  live party identity that matches neither committed side, but renders the cutscene from detached reconstructed images,
  so later mechanical snapshots cannot erase or alter the ordered visual result. Both temporary Pokemon are asset-loaded,
  never inserted into the party, and destroyed after success, cancellation, or reconstruction failure.
- Failure-first static coverage went red on the missing pre-image, then the complete 395-test public-browser source suite
  and public boundary check passed. Authority V2 Vitest and the exact two-browser evolution journey remain remote-only.

## 2026-07-31 - Evolution liveness is measured by renderer progress

- Exact two-browser evolution run `30623035493` at `e67928670` proved the immutable pre/post repair reached the intended
  path: the replica accepted an already-evolved live party member, reconstructed both committed images, and entered its
  real `EVOLUTION_SCENE`. It then failed exactly 45 seconds later because the product watchdog treated the complete
  cutscene as one blind wall-clock step. On the same roughly three-FPS runner, the authority's ordinary native evolution
  took about 110 seconds while continuing to advance, so the old deadline was a false presentation failure.
- The evolution renderer now renews its existing 45-second liveness lease only after concrete completed stages: asset
  load, UI-mode installation, scene construction, each text/delay/tween boundary, the recursive transformation cycle,
  reveal, and final text. Every renewal is logged with its exact stage. A genuinely stuck stage still aborts, joins all
  owned timers/tweens/callbacks, restores MESSAGE, and releases no wave DATA early; a slow but advancing browser is no
  longer killed merely because the whole cinematic exceeds 45 seconds.
- The failure-first source contract went red before implementation and the focused presentation contract is green after
  it. Full local source/boundary/format qualification and the exact two-browser evolution rerun are the next proofs;
  TypeScript and co-op Vitest remain remote-only.

## 2026-07-31 - Evolution morph recursion reports real progress

- Exact-SHA exhaustive co-op gate `30625544724` at `e47f3a6e6` is fully green across type/static/contracts and every
  selected A/B/C/P shard. The focused push gate skipped its shards only because the ownership manifest still named the
  older train base; this change advances that base to `e47f3a6e6` so the next push validates its actual diff.
- Exact evolution journey `30624937639` proved the rolling watchdog is healthy through `assets-loaded`, `mode-ready`,
  scene setup, every pre-morph delay/tween, and `arc-delay`. The renderer then spent roughly 48 seconds actively
  completing the 29 recursive `doCycle` tweens on the approximately three-FPS runner, so the 45-second lease expired
  before the coarse `cycle-complete` heartbeat. The animation now reports each completed recursive cycle to the same
  watchdog. A frozen tween still expires after 45 seconds; an advancing morph no longer looks dead merely because the
  whole recursive sequence is slow.
- Fresh-wave2 journey `30624924809` reached wave 2 with both browsers mechanically and visually synchronized on the
  same guest-owned Guessing Booth Mystery Encounter. Its driver then falsely required a command frontier even though
  the authoritative next-wave control was a valid interaction. That harness-only red is retained for a separate,
  deterministic wave-2 battle-fixture cycle; the Mystery campaign remains responsible for real encounter coverage.
- Failure-first source coverage now requires the public animation callback, propagation through every recursive call,
  and the retained renderer heartbeat at every real morph completion. Local source/static qualification follows before
  the exact evolution journey is dispatched again; co-op Vitest and Chromium execution remain remote-only.

## 2026-07-31 - Retained evolution text follows the native input contract

- Exact-SHA focused gate `30627091328` at `3cd92e591` is fully green, including remote TypeScript, source contracts,
  and the selected P/A/B engine shards. Push journey `30627091315` also passed the complete fresh-wave2 two-browser
  path. This proves the morph-cycle callback and its retirement guard without weakening ordinary launch or battle.
- Dedicated evolution run `30627156388` reached the reconstructed guest cutscene but exposed a distinct input-parity
  defect before the morph began. The retained renderer made the introductory “is evolving” line an actionable prompt;
  the native authority renderer types that line and automatically continues after its callback delay. The evidence
  showed `scene-ready`, then an actionable `battle:evolution` surface, no public input at the old submitted-turn
  address, and a watchdog at `scene-ready`. The harness correctly refused to guess across the address boundary.
- Retained evolution now mirrors native text semantics exactly: the intro automatically advances after its one-second
  callback delay, while the completion line alone publishes a human prompt after the native four-second prompt delay.
  The cancellable wrapper carries callback delay, prompt flag, and prompt delay separately, so presentation parity no
  longer depends on a harness pressing an input the authority never required.
- Failure-first coverage went red on the invented intro prompt and now seals all six UI arguments plus both call-site
  contracts. The next exact browser rerun must reach per-cycle heartbeats and visibly advance the final completion
  prompt before the progression ledger can pass.

## 2026-07-31 - The browser driver admits the exact retained evolution successor

- Exact-SHA focused gate `30628641675` at `53bb9f015` is fully green across remote TypeScript, static/source contracts,
  and the selected P/A/B engine shards. Push journey `30628641998` also passed fresh-wave2 end to end, so the product
  prompt-parity repair did not regress ordinary launch, command, progression, or the wave-2 interaction frontier.
- Exact evolution journey `30628643225` then proved the production cutscene progressed through every morph cycle,
  reveal, and evolved cry. The guest exposed its real final `battle:evolution` prompt with `awaitingActionInput=true`
  at V2 turn 2 after `BattleEndPhase`; the submitted command address frozen by the driver was turn 1. The harness sent
  no input after the prompt appeared and the product watchdog correctly expired at `evolved-cry`. Both clients still
  converged mechanically at the same reward shop, confirming an observer/driver admission defect rather than a desync.
- Successor-address admission now accepts `battle:evolution` only at the exact N+1 address, only in `EvolutionPhase` or
  `CoopWaveProgressionReplayPhase`, and only after that browser has observed `BattleEndPhase` within the current scan
  window. FaintPhase alone remains insufficient, arbitrary future turns remain denied, and ordinary settlement-message
  rules are unchanged. The realistic driver test went failure-first at the retained prompt and now passes 57/57.

## 2026-07-31 - Evolution readiness and staggered replacement are driven from public evidence

- Exact evolution run `30630465252` at `4991e3219` crossed the prior guest-prompt frontier and proved both renderers
  completed the retained evolution plus the wave-progression ledger. Its final oracle nevertheless rejected the host's
  actionable `EvolutionPhase` because the always-live handler correctly reported optional `inputBlocked=null`, while
  the duplicate assertion demanded literal `false`. The oracle now uses the same shared semantic readiness predicate
  as the keyboard driver, so observation and action cannot disagree about an optional field.
- The same trace exposed a real harness-caused product fallback: the guest replacement picker opened 16 seconds after
  the host picker closed, outside the five-second concurrent-faint window. The slow post-replacement checkpoint then
  moved the guest evidence floor past that unconsumed picker, sent no key, and left the authority to its 60-second
  safety auto-pick. `driveReplacement` now returns the exact seats it actually drove; the faint tail advances a seat's
  floor past a picker only when that seat was in that set. A staggered second picker remains visible to the next
  sequential human-input scan.
- Both mechanisms have failure-first Node coverage. The focused browser source suites pass 56/56; full source/static
  qualification and an exact evolution rerun follow before any product-authority change is mixed into this cycle.

## 2026-07-31 - Native evolution teardown is not a human-input surface

- Exact evolution run `30633649844` at `aa8ea27b0` completed both real evolution prompts, proved the six-entry
  progression ledger, and converged both clients at the same wave-2 command frontier. Its only fatal evidence was a
  six-millisecond `EndEvolutionPhase` sample whose still-active `EVOLUTION_SCENE` handler was labeled `unclassified`;
  `ExpPhase` followed immediately. This was an observer false red, not a product failure.
- The read-only semantic observer now explicitly suppresses that native non-interactive teardown and clears its prior
  canonical observation so the next real surface still emits. It does not excuse unknown phases generally and does not
  press input. Source coverage binds the suppression to `EndEvolutionPhase` and the close-before-return behavior.
- Exact `aa8ea27b0` qualification otherwise closed green: focused gate `30633595723` and fresh-wave2 journey
  `30633595876` passed. The observer repair will qualify remotely with the next Authority V2 exact-SHA batch; no local
  test or build is used.

## 2026-07-31 - A passive replica receipts the exact command source before retirement

- Exact depth campaign `30621198797` exposed the remaining zero-input authority hole. On the guest replica after its
  half of the field wiped, replacement revision 16 was admitted, marked `materialApplied`, marked `controlInstalled`,
  and retired in the same millisecond. No `CoopFinalizeEntryPresentationPhase` existed for that source operation.
  Revisions 17 and 18 then arrived; the wave successor superseded the speculative turn, but remained admitted forever.
- Command projection now treats the complete retained source entry—not only `CONTROL_COMMIT`—as its re-presentation
  identity. An ordinary co-op replica with zero locally owned command targets defers `controlInstalled` until an
  address-exact passive watcher records the source operation's presentation receipt. TurnInit and its direct
  CommandPhase bypass both recognize that requirement. Showdown/tournament versus sessions are explicitly excluded.
- A late watcher recovers the immutable, materially applied state only from validated TURN, REPLACEMENT, or INTERACTION
  source material, verifies exact wave/turn/tick, restores that image through the ordinary presentation finalizer, and
  records an empty cosmetic prefix because the source renderer already owns its cues. The finalizer immediately retries
  the ordered ledger after recording the receipt, so the deferred source can retire without a transport timer.
- Source contracts cover the zero-target receipt gate, non-CONTROL state reconstruction, both UI admission call chains,
  and the receipt-to-ledger retry edge. TypeScript, formatting, source contracts, engine shards, and the exact four-wave
  depth campaign will all run remotely on GitHub; no local tests are used.

## 2026-07-31 - Passive-watcher qualification isolates a formatter-only red

- Exact-SHA focused run `30636335692` at `5a3e5fd25` passed every selected production shard (P2, S4, B12, C3, T2,
  and A1), every co-op source contract, and every node-pure contract. Remote type analysis reported no diagnostic in
  any changed file. Its sole red was Biome's one-line layout for the retained TURN state reconstruction.
- Push journey `30636335686` stopped at the same owned-file formatter gate before building Chromium, so it is not
  gameplay evidence. The exact four-wave depth campaign `30636361412` independently built the production bundle and
  remains sealed to `5a3e5fd25`; its workflow does not cancel on a newer branch push.
- The runtime line now matches the remote formatter output exactly. The ownership train advances to `5a3e5fd25`; this
  metadata/format checkpoint changes no behavior and will be committed without local hooks. All requalification remains
  on GitHub-hosted runners.

## 2026-07-31 - Public-browser half-wipe closes the passive-receipt coverage gap

- Exact `54d1969b3` focused qualification `30638326182` is fully green. Its push `fresh-wave2` journey
  `30638326217`, registered-interactions journey `30638371285`, and evolution journey `30638363377` are also green.
  The navigation-depth-30, ten-wave Mystery, and corrected four-wave depth runs remain active on that immutable SHA and
  are deliberately not cancelled.
- The successful four-wave run at the preceding production patch SHA proved replacement and multi-wave progression, but
  its fainted replica still had a legal reserve. It therefore never exercised the exact zero-local-command branch added
  for a completely wiped player. Static and headless coverage alone are not an adequate oracle for that UI-to-relay path.
- A new build-and-URL-gated `half-wipe` journey visibly selects a lone Memento Crobat for the non-requesting replica and a
  lone Tackle Dondozo for the authority. After ordinary keyboard commands, it requires the empty replacement close, an
  exact next-address partition with one authority owner and the replica omitted, matching passive-watcher deferral and
  presentation-receipt operation IDs, and a subsequent structural command or reward outcome. No runtime state mutation,
  healing, relay injection, or staging/production fixture exposure is introduced.
- The workflow owns an explicit failure-first source-contract step for this scenario. All formatting, type analysis,
  contracts, engine shards, and the two-Chromium journey will execute remotely; no local test, build, or browser run is
  used.

## 2026-07-31 - Ability results retain their predecessor battle address

- The exact `54d1969b3` ten-wave Mystery campaign `30638375084` crossed five consecutive Mystery encounters and cleared
  the wave-7 trainer battle before exposing a real production terminal: `Ability result 6 could not enter durable
  authority`. The authority had correctly retained revision 38 as `ABILITY_PRESENT` at wave 7 turn 3 and explicitly
  authorized the matching `ABILITY_PICK` operation ID.
- The Ability Capsule owner ended its picker before retaining the result. That synchronous `end()` launched the next
  battle, after which `relayEnd()` reread `globalScene.currentBattle` and mislabeled the wave-7 result with the successor
  battle coordinate. Authority V2 correctly rejected that right-ID/wrong-address result instead of corrupting the log.
- All four registered ability workflows (Capsule, Greater Capsule, Greater Randomizer, and Dex Nav) now capture wave and
  turn once at phase construction and reuse that immutable address for presentation, owner result, watcher adoption, and
  complete-state retention. A source contract rejects any future ambient `currentBattle` reread at these commit sites.
- Exact `db437b759` half-wipe source contracts and all selected engine shards passed in focused run `30640492858`; its
  only red was the fixture roster's TypeScript inference after adding the conditional Jolly nature. The fixture now keeps
  the original homogeneous roster shape and chooses nature in the contextually typed `Starter` projection. Remote
  qualification and the real Mystery reproduction remain the sole executable validation.

## 2026-07-31 - Ability-address checkpoint has a formatter-only focused red

- Exact `0f81e27cd` focused run `30641543340` passed every completed co-op source/node contract and selected engine
  shard. Remote TypeScript again reported no changed-file diagnostic; its only finished red is Biome's requested layout
  for the new half-wipe source contract.
- The contract now matches that exact remote formatter output. The already-running fresh-wave, half-wipe, Mystery, and
  navigation journeys remain sealed to their immutable SHAs and are deliberately not cancelled. This checkpoint changes
  no production behavior and all executable revalidation remains on GitHub-hosted runners.

## 2026-07-31 - The wave-10 market red was an asymmetric-observer harness gap

- Exact `54d1969b3` navigation run `30638367645` completed nine continuous waves and opened the natural wave-10 market.
  The guest owner exposed an actionable `biome-market` with 15 options at Authority V2 revision 51; the host watcher
  retained the same addressed catalog in its read-only `browser-market` apply ledger, and both sides control-installed
  the revision. The campaign nevertheless timed out in `SelectModifierPhase` because its post-turn classifier required
  the owner-only semantic grid on both browsers.
- Post-turn classification now recognizes the paired detailed market projections, then leaves address, interaction-pin,
  catalog, and single-owner validation to the existing fail-closed market proof before any key is sent. The dispatcher
  also bypasses the generic symmetric semantic checkpoint for this intentionally asymmetric UI. Both target-purchase
  and ordinary-leave policies now use the same paired projection and public confirmation path.
- Failure-first Node coverage models an actionable owner plus read-only watcher and rejects a pair with no open owner;
  a source contract binds the market route ahead of the symmetric checkpoint. No local test, build, or browser run is
  used; the exact checkpoint will qualify on GitHub-hosted runners before the 30-wave journey is repeated.
- The journey and campaign build gates now request only unlimited error-level Biome diagnostics. Their previous default
  diagnostic cap printed hundreds of legacy lint infos while hiding the single blocking error, turning a fast static
  failure into an opaque red. This changes reporting only: the same files and the same `biome check` exit status remain.

## 2026-07-31 - Broad browser builders now expose exact static blockers

- Exact `4a7a1682c` source and node-pure contracts passed in focused run `30643254348`; its remaining selected shards
  continue remotely. The push journey `30643254369` and Mystery campaign `30643308686` stopped before bundle creation,
  so neither is gameplay evidence.
- With error-only unlimited diagnostics enabled, the formerly opaque builders identified only two mechanical Biome
  layouts: the new market test import and the pre-existing half-wipe fixture's nested roster expression. Both now match
  the exact remote formatter output. No behavior changed.
- Navigation-depth-30 run `30643301581` and half-wipe run `30643304926` remain immutable attempts on `4a7a1682c`; they
  may independently reach Chromium if their build workers had not yet evaluated the old layout. All replacement
  qualification remains on GitHub-hosted runners, with no local executable validation.

## 2026-07-31 - Market classification remains compatible with focused outcome fixtures

- Exact `5283e3abf` focused qualification `30643671783` is fully green, and its journey bundle built successfully.
  Fresh-wave2 `30643671353` and half-wipe `30643717683` reached their real Chromium jobs.
- Mystery campaign builder `30643720907` exposed a focused-contract regression before bundle creation: older bounded
  outcome fixtures intentionally implement only the evidence channels they exercise, so the new market classifier's
  unconditional `findLastMarket` call threw instead of simply reporting “not a market.”
- Market routing now treats a missing optional detailed-market reader as no market evidence. Production browser sinks
  still provide the method, and `readMarketPair` remains mandatory before any market input. This restores fixture
  compatibility without weakening the real owner/watcher/address proof.

## 2026-07-31 - Async interactions retain their predecessor battle coordinate

- The ability failure exposed a broader architectural invariant: a retained runtime binding does not preserve the
  battle address. Stormglass, Bargain, and Learn Move still read `currentBattle` after UI callbacks or relay awaits;
  recovery or a fast successor could therefore assign otherwise-valid material to the wrong wave/turn.
- Stormglass and Bargain now retain their source wave/turn with the phase generation. Learn Move captures both when it
  binds its authoritative runtime, before opening or awaiting any public picker. Presentation, result, proposal resend,
  watcher adoption, and signed-successor validation use those immutable coordinates.
- World Map already retained both coordinates, but its recovery lease still keyed itself to the ambient turn. It now
  uses the retained source turn as well. A browser source contract rejects ambient address reads at these V2 material
  sites. Type, format, contracts, and affected engine shards will run only on GitHub-hosted runners.

## 2026-07-31 - Legacy outcome fixtures keep their explicit market model

- Campaign builder `30644154826` passed every corrected bounded-outcome contract except its purpose-built biome-market
  fixture. That older double intentionally lacks the detailed market reader and represents both sides through paired
  semantic surfaces, so treating “method unavailable” as “not a market” erased its expected boundary.
- The classifier now uses the paired semantic model only when the entire client double lacks detailed market evidence.
  Real browser sinks all implement the detailed reader and therefore still require an actionable owner plus watcher
  projection before routing. No production browser can fall back merely because detailed evidence has not arrived yet.

## 2026-07-31 - Stormglass joins the declared V2 integration ownership set

- Focused planner run `30644395283` stopped before validation because the integration manifest did not yet list
  `er-stormglass-picker-phase.ts`. The source-address hardening intentionally brings that registered interaction into
  scope, so the manifest now names it explicitly. This metadata checkpoint changes no runtime behavior.

## 2026-07-31 - Half-wipe fixture targets the actual replica seat

- Exact `5283e3abf` half-wipe run `30643717683` built and paired two real browsers, then reached a synchronized wave-1
  command frontier. It stopped before battle input because the workflow rewrote the requested `guest-seat` faint owner
  to `host-seat`, assuming the invitation requester changes Authority V2 roles. The public artifact proved the opposite:
  `host-seat` remained role host and `guest-seat` remained role guest.
- The workflow now honors the explicit `faint_owner_seat` input (default `guest-seat`) independently of invitation
  direction. A source contract rejects reintroducing requester-based half-wipe inversion. This is harness-only; the
  failed run contains no product desync or half-wipe execution evidence.

## 2026-07-31 - Detailed-market compatibility matches the remote formatter

- The two `a4e5878d4` journey builders stopped on the same two line-wrap diagnostics in `market-journey.mjs`; TypeScript
  was clean and neither run reached Chromium. The helper now matches the exact remote Biome layout. This checkpoint is
  formatting-only and all executable revalidation remains remote.

## 2026-07-31 - Catch-full and batch learn retain their source address

- The closed interaction registry audit found three more callback-owned coordinate reads: the guest catch-full picker,
  the authority batch learn panel, and its projected replica panel. Each already retained its exact runtime/operation
  domain, but a late human choice or fallback still derived wave/turn from the ambient scene.
- Each phase generation now captures source wave/turn at construction. Catch-full proposal resend, batch presentation,
  immutable result, fallback successor, and legacy resend all reuse that address. Focused source contracts enforce that
  construction is the only scene battle-coordinate read for both batch panels and that catch-full never rereads inside
  its public callback. The guest catch-full phase is now explicitly owned by this integration train.

## 2026-07-31 - Half-wipe browser red was a stale close observer

- Exact `470cb7ae3` half-wipe run `30645234686` executed Memento, replayed the faint on the replica, proved that its
  entire owned half had no legal bench, and opened the survivor's turn-2 command surface. No replacement input was owed.
- The harness still waited only for the older host `half wiped` and committed-authority `party[-1]` messages. The live
  renderer used its equivalent pre-picker close, `own-faint picker gate ... no legal bench -> skip`, so the journey
  timed out after the correct product continuation had already happened.
- The close observer now accepts all three production no-pick proofs. This is harness-only; no Authority V2 or battle
  behavior changed. Exact executable validation remains on GitHub-hosted runners.

## 2026-07-31 - Registered-interactions red reached both target interactions

- Exact `470cb7ae3` registered-interactions run `30645239422` drove one real Revival owner choice, cleared wave 1,
  converged the wave-2 Stormglass owner/watcher surfaces, and committed the exact Stormglass choice.
- Its fixture then genuinely lost at the start of wave 2, so campaign bookkeeping reported zero cleared waves even
  though both target UI-to-relay-to-authority chains were complete. This is provisionally classified as harness-profile
  survivability/bookkeeping, not a co-op desync; the exact `b6eb9a8f3` rerun will confirm it before its rule is changed.

## 2026-07-31 - Navigation market red was an obsolete semantic ID in the browser driver

- Exact `5283e3abf` navigation-depth-30 run `30643714786` cleared nine continuous waves, defeated the natural wave-10
  boss, and opened the guest-owned Biome Market at the matching Authority V2 address. The guest selected Wide Lens and
  production opened an actionable `party:reward-target` surface with all six party slots and `selectedOptionId` equal
  to `party-slot:0`.
- The market journey still parsed the retired `cursor:0` spelling, despite the general campaign and sealed semantic
  observer already using `party-slot:*`. It therefore threw two seconds after the correct picker appeared. The driver
  now consumes the public PARTY semantic identity and its focused contract explicitly rejects the obsolete spelling.
- This red is classified as harness-only. No market, interaction, or Authority V2 production code changed. The same
  exact navigation journey will be rerun on GitHub-hosted Chromium after the focused remote contract is green.

## 2026-07-31 - Half-wiped passive watcher exposed a source/target turn-domain deadlock

- Exact `4b44ebbe3` half-wipe run `30647720506` crossed the empty replacement close and opened the survivor's
  turn-2 command. The wiped replica rendered all 18 turn-1 events and applied the exact turn-1 state, but its
  entry-only turn-2 watcher could never receipt `TURN/e1828368476812334/w1/t1`; V2 remained at frontier `2/2/1`
  while redeliveries correctly repeated the same `controlDeferred` result.
- The release validator required the immutable source image's turn to equal both its signed material turn and the
  successor command turn. That is impossible for the ordinary `TURN N -> COMMAND N+1` edge. The retained-state
  reader repeated the same false equality, so neither immediate release nor recovery could close the watcher.
- Non-control command successors now accept only the exact source tick at the same wave and either the same turn or
  its immediate next command turn. A focused two-engine regression proves `N -> N+1` and rejects an unstated `N ->
  N+2` jump. This is classified as a product authority defect; the exact half-wipe journey must requalify remotely.

## 2026-07-31 - Registered-interaction fixture is not survivable enough to reach its own second surface

- Exact `b6eb9a8f3` registered-interactions run `30646864860` repeated the profile failure without a network or V2
  wait: both browsers made six synchronized turns, completed one Revival choice, then naturally wiped on wave 1.
  Stormglass is installed at the later wave start, so this fixture cannot satisfy its declared coverage contract.
- This red is classified as harness-profile survivability, not product. The build-and-URL-gated fixture now starts
  its visible, point-legal roster at level 100 and pauses incidental evolution, while retaining ordinary keyboard
  combat and the exact Healing Wish, Revival Blessing, and Stormglass UI paths. No campaign success rule excuses an
  early terminal; the exact journey must still prove both registered surfaces and its declared wave boundary.

## 2026-07-31 - Registered interaction proof reached its boundary but the capped fixture tripped the EXP assertion

- Exact `d48b57500` registered-interactions run `30649936595` completed Revival, one synchronized faint replacement,
  the reward boundary, and Stormglass owner/watcher presentation plus commit, then reached the shared wave-2 command
  frontier. Authority revision 11 retired after the replica's `controlInstalled` receipt; no product wait or desync
  caused the red.
- The driver correctly counted one cleared wave but its generic progression assertion still required an EXP entry.
  The exact registered fixture now starts at level 100, where no EXP presentation is valid. This is classified as a
  harness assertion defect. The mandatory EXP cue is now omitted only for the three explicitly level-100 campaign
  profiles (navigation, Mystery gauntlet, and registered interactions); ledger equality and every registered-surface
  success requirement remain mandatory.

## 2026-07-31 - Next-turn passive watcher release requalified in two real browsers

- Exact `d48b57500` half-wipe run `30649931982` is green. The replica rendered the wiped seat's turn-1 sequence,
  accepted the retained settled-turn state, crossed the bounded passive-watcher deferral, and observed the survivor's
  turn-2 command and continuation. The journey passed in 10m13s with no terminal error.
- This closes the product defect from `30647720506`: a signed `TURN N` image may authorize only `COMMAND N` or
  `COMMAND N+1`, while the regression continues to reject an unstated `N+2` jump. Focused gate `30649903313` is also
  fully green on the same SHA.

## 2026-07-31 - New-biome replica retained the old visible wave after mechanical convergence

- Exact `49faf5449` navigation-depth-30 run `30648456991` cleared waves 1-10, completed a host-owned Biome Market
  purchase and party application, committed the guest-owned World Map choice, entered biome 1, and reached the wave-11
  command frontier on both browsers. Their arena and state digest matched exactly, but the authoritative renderer's
  HUD displayed wave 11 while the replica still displayed wave 10.
- This red is classified as a product presentation defect. `NewBiomeEncounterPhase` deliberately gives the replica a
  presentation-only path and therefore bypasses `EncounterPhase.runEncounter() -> initSession()`, the host path that
  refreshes the visible biome/wave label. After the signed destination carrier is applied and before presentation
  starts, the replica now refreshes that cosmetic label from the already-authoritative Battle and arena. No mechanical
  state, progression, or local successor is derived by the repair.
- Focused run `30652743153` stopped in the ownership planner before any executable test because this integration
  manifest did not yet declare the newly modified `new-biome-encounter-phase.ts`. This is classified as CI metadata,
  not a product or test failure; the sorted exact path is now owned and the focused qualification is redispatched by
  the metadata push.

## 2026-07-31 - Navigation wave-25 red was a one-move immunity trap

- Exact `a20428d60` navigation run `30652762674` proved the previous HUD repair, both alternating-owner Biome
  Markets, Wide Lens application, Crossroads Stay and Leave, both World Maps, two new-biome command frontiers, the
  wave-20 trainer boss, and two Mystery encounters before stopping on wave 25 after twelve rounds.
- This was not a sync stall. Both browsers completed every ordered command and presentation receipt through
  `TURN/e1828373232871355/w25/t12`, applied identical revision 405, and opened the shared turn-13 command frontier.
  The trace instead showed both level-100 fixtures using their only move, Water Gun, into a Water-immune Tympole on
  every round (`It doesn't affect Foe Tympole!`) while the opponent remained at full HP.
- This red is classified as a harness-fixture defect. The exact-build navigation roster now carries four ordinary
  level-up attacks per species with multiple damage types, and only the navigation profile cycles those visible
  usable moves by battle turn. Production Authority V2, battle mechanics, and other campaign policies are unchanged.
- The push-triggered exact-SHA fresh-wave2 run `30660334843` is green on `41d28ffbe`: the sealed bundle passed its
  remote owned-file type/format and browser boundary checks, then two real browsers cleared the ordinary wave-2
  journey. Focused run `30660334822` did not execute tests because the integration manifest still named the prior
  train base; that red is classified as CI metadata, and the manifest now advances to the exact `41d28ffbe` tip.
# 2026-07-31 — navigation wave-13 Mystery deadline classified as harness false red

- Exact-SHA journey `30661550622` on `b70c3271f31188770762b9d01df50da7d63e46ce` reached the wave-10 market, bought Wide Lens, crossed the World Map into biome 1, and continued through authoritative wave 12 without a desync.
- The driver then crossed a wave-13 Mystery encounter through presentation, party, subprompt, reward, and post-Mystery narration, but its navigation-only fixed between-wave deadline expired while both real browsers were still advancing. The post-failure trace proves the host continued from wave-14 `NextEncounterPhase` into `SummonPhase` with digest `5123359742e0cda9`; this is a harness deadline defect, not a product stall.
- Scope the existing observer-proven, immutable-ceiling registered-surface budget to the navigation profile as well as the Mystery gauntlet. Keep ordinary short profiles on their fixed deadline and keep keepalives/phase names/time alone ineligible to refresh it.
- Focused run `30665967002` classified red as CI metadata only: its planner correctly rejected the manifest's previous `41d28ffbe` base against push base `b70c3271f`. Advance the integration train manifest to the exact qualified `b70c3271f` tip before re-running focused qualification; do not weaken the guard.
- Push-triggered journey `30665966940` stopped before browser launch on Biome formatting of the new ternary only; TypeScript was clean apart from the unchanged repository baseline. Apply the formatter's exact indentation before requalification.
- Focused run `30666465115` is a second CI-metadata-only red: because the formatter correction was pushed as the next train commit, its exact push base is `4699d8242`, not the earlier `b70c3271f`. Advance the manifest one commit at a time as required by the guard; keep the active fresh-browser run `30666465060` untouched before pushing again.
- Journey run `30666465060` stopped in its pre-browser navigation source contract because the formatter legitimately split the new assignment across lines while two source-regex assertions still required a literal space. Make those contracts whitespace-tolerant, and declare the exact preceding remote tip `0ed6a18a0` for the next focused push.
- Exact `657f29306` focused run `30666717716` is green (planner, static, all source/node-pure contracts, affected shard). The push journey `30666717704` found one additional stale assertion in the animations-on test that still named `mysteryProgressBudget`; update it to the renamed `registeredSurfaceProgressBudget`. This is a test-contract red before browser build, not a product or harness runtime failure.

## 2026-08-01 - Live Ability Capsule freeze and page-reload presence collision

- Staging log `2026-08-01T20-47-03-692Z` stayed on `SelectModifierPhase` / `MODIFIER_SELECT` after the
  owner accepted an Ability Capsule. UI-mirror ordinals remained monotonic, no authoritative reward
  operation was emitted, and no JavaScript exception occurred. The action latch had been consumed while
  the nested PARTY fade never installed its handler: a production UI-transition liveness defect, not the
  prior reward-mirror ordering bug.
- Every reward-owned PARTY child (capsules, TMs, held-item transfer, fusion, PP/move items, Check Team)
  now uses a bounded without-clear transition. A lost Phaser callback force-installs the target in two
  seconds without clearing the underlying reward handler; phase/generation fencing prevents a late fade
  from overwriting a successor. A focused failure-first regression covers this exact lost-fade shape.
- Reload logs from both accounts showed the server correctly rejecting a second presence while their
  paired run remained live. Classic co-op now stores only `{run code, account id}` in tab-scoped
  `sessionStorage`, mints a fresh identity ticket on re-entry, and invokes the Worker's existing atomic
  membership-authorized rejoin before announcing. No bearer is persisted. Ended/wrong-account handoffs
  fail closed, clear, and fall back to normal announce; Showdown/tournament remain on their unchanged
  lockstep lifecycle.
- The retained-reward browser proof now accepts the production `skippedObsolete=0` diagnostic field; the
  previous exact-SHA red was a stale evidence regex, not a product failure. All executable qualification
  remains remote per `AGENTS.md`; the focused and two-browser reload/capsule journeys are pending dispatch.
- Aggregate run `30719578822` exposed one deliberate harness coupling: the TM-case duo driver intercepted
  only the retired unbounded `setModeWithoutClear` method, so it declared that PARTY never opened when the
  product invoked the new bounded seam. The helper now intercepts both signatures and calls the nested
  target callback at the new argument position. This is a harness-wiring correction; the run's other
  multiwave tests and the exact product UI transition contract passed.

## 2026-08-01 - Aggregate B11/C3 reds classified as stale test contracts

- Aggregate B11 used a second one-off TM market driver that also intercepted only the retired
  `setModeWithoutClear` seam. The production phase therefore correctly requested the new bounded PARTY
  surface, but the synthetic test never answered it and falsely reported that no pinned market continuation
  was queued. The test now observes both signatures and resolves the exact same public party callback.
- Aggregate C3 drove all 17 requested waves, exactly one Mystery Encounter, and two complete post-Mystery
  waves with zero digest findings or checksum assertions. Its only failure hard-coded wave 15 as host-owned.
  Authority ownership is selected by accumulated interaction-counter parity, not wave number; optional
  reward and biome-market continuations can legitimately alter that counter. Soak evidence now records the
  exact `interactionStart`, and the continuation assertion verifies the observed path against its parity.
  The separate focused cases still require one host-owned and one guest-owned Mystery path explicitly.
- Focused run `30720160001` stopped in the ownership planner before setup because the integration manifest
  omitted the two existing test paths changed by this correction. This is CI metadata only; both exact paths
  are now declared and the train base advances to the rejected commit for a clean remote qualification.
## 2026-08-01 — reward PARTY summary transition closure

- Latest submitted staging logs still identify the pre-fix `8ccf994dd` bundle. Their reload errors contain
  no `reload-rejoin` attempt and therefore predate the qualified `c63c63468` handoff/rejoin fix now live on
  staging.
- The Ability Capsule freeze report exposed a narrower surviving production seam: the reward picker now
  opens PARTY through the bounded no-clear transition, but PARTY's own Summary action still used the old
  unbounded no-clear fade. `PartyUiHandler.processSummaryOption` now preserves solo behavior and uses the
  phase-fenced bounded no-clear transition in co-op, so a lost fade force-installs Summary without retiring
  the underlying reward selector.
- Next proof: exact-build two-browser Ability Capsule journey must inspect Summary, return to the same
  addressed PARTY target, apply the capsule, finish its registered ability picker, and reach the ordered
  successor. A separate same-tab reload journey must prove `/coop/v3/rejoin` and forbid a second announce.

## 2026-08-01 — exact wave-13 generation rejection mechanism

- The newest `c63c63468` staging logs are not a checksum divergence. At wave 13 the replica emits genuine
  `controlInstalled` receipts with connection generation 2, while the authority rejects the entire retained
  log as `connection-generation-mismatch`; the unreleased tail then ends at command-control installation.
- Root cause: the first browser to call the Worker rejoin endpoint can receive `{local: 2, peer: 1}` before
  the partner rejoins. The replacement channel later carries the partner at generation 2, but the P33
  controller never completed that peer axis, so Authority V2 froze generation 1 into every lease.
- Protocol 62 now carries sender-local generation on the authenticated P33 hello. After the immutable
  account/pairing/role axes pass, that replacement-channel hello monotonically completes the peer generation
  before the binding-ready callback rebinds or constructs Authority V2. Regressions still fail closed.
- The P33 controller tests now reproduce the asymmetric provisional view (`local=1, peer=0`) and require
  the partner's generation-1 hello to appear in the accepted membership snapshot.

## 2026-08-01 — player-log closure: nested reward Summary and hot-rejoin generation

- Player evidence showed two separate blind spots: Ability Capsule could consume the PARTY action latch before
  SUMMARY became actionable, and same-tab reload/rejoin retained a provisional peer generation from the first
  `/coop/v3/rejoin` response. The latter rejected every genuine generation-2 replica receipt and eventually
  failed command-control installation at wave 13.
- Production fixes now use the bounded nested UI transition and carry the authenticated sender generation in
  P33 hello so the peer axis advances monotonically before Authority V2 leases are rebound.
- Added an exact-build `ability-capsule` two-browser campaign: both players visibly confirm Garchomp, wave 1
  deterministically offers Ability Capsule, the reward owner opens `PARTY -> SUMMARY`, backs out to the exact
  same addressed PARTY selector, applies the capsule, completes the real ability choice, and reaches wave 2.
- The pre-existing `fresh-resume` journey was not representative of browser reload: it destroys sessionStorage,
  waits the cold-rejoin grace, and creates a new lobby. A same-tab `/coop/v3/rejoin` journey remains the next
  closure item after the focused Ability Capsule proof.
- Added that missing `same-tab-rejoin` journey: it hashes and attests the tab handoff, reloads both existing tabs,
  forbids a fallback lobby announce, requires two successful `/coop/v3/rejoin` calls and generation-2 bindings,
  observes the authenticated hello complete the provisional peer-generation axis, resumes wave 2, and completes
  another battle while rejecting every `connection-generation-mismatch` receipt.

## 2026-08-02 - protocol-62 focused-gate test migration

- Exact-SHA focused run `30722179433` completed every selected shard except source contracts and lane A.
  Both reds were stale tests that hard-coded `er-coop-61`; lane A's artifact identified the sole failure at
  `coop-session-controller.test.ts:77`, while the production controller/rejoin coverage around it passed.
- The assertions now track `er-coop-62`, and the source contract additionally requires the authenticated
  `connectionGeneration` hello field. This changes no product code and does not invalidate the already-running
  exact-SHA Ability Capsule or same-tab rejoin browser proofs.

## 2026-08-02 - Ability Capsule Summary authority proof

- Exact-SHA journey `30722189191` reproduced the player's freeze through real keyboard input. The bounded
  PARTY -> Summary transition completed and `SUMMARY` became the active handler, but the read-only observer
  reported `inputBlocked=true` indefinitely while transport and both engines stayed healthy.
- The live claim was `op:reward` / `REWARD_PRESENT`. Its V2 proof admitted MODIFIER_SELECT, CONFIRM, and PARTY,
  but not PARTY's nested informational SUMMARY child, so the global physical-input gate rejected every key.
- Reward and shop proof contracts now admit SUMMARY only under their existing exact owner, address, and phase
  lease. LearnMove Summary remains a separate `op:learnMove` proof; no global Summary bypass was added.
- The two-browser Ability Capsule journey remains the production-path regression. Default headless soaks keep
  the new Summary -> reward edge explicitly classified rather than pretending they drive that nested screen.

## 2026-08-02 - Same-tab reload ordering and authenticated observer axes

- Exact-SHA journey `30722191260` reached `/coop/v3/rejoin` with HTTP 200 on both seats, opened generation-2
  WebRTC, and completed the authenticated hello/fingerprint exchange. It then waited in the title launch UI:
  host "Checking for a co-op save", guest "Waiting for host". This was a harness ordering defect, not a failed
  carrier rejoin: the journey demanded a gameplay binding before driving the ordinary Resume transaction that
  creates and acknowledges that binding on a newly constructed page runtime.
- The browser binding observer also mislabeled the runtime's provisional V1 active/generation-zero membership
  as an authenticated stable-seat binding. P33 observations now fail closed until `p33FrameContext()` and the
  authenticated membership snapshot are both actionable, then expose the Worker's real local generation.
- The journey now proves the rejoin HTTP/hello boundary first, drives Resume through ordinary public keys, and
  only then asserts generation >= 2 on both accepted gameplay bindings before completing a post-reload battle.
- Pairing and launch are deliberately distinct proofs: provisional P33 role/seat discovery can keep the
  self-healing lobby moving, and the exact Title/MESSAGE save decision remains keyboard-actionable on either
  role before a gameplay binding exists. All battle/interaction observers still require the accepted P33 frame
  axes, and `findBinding()` filters out provisional pairing-role observations.

## 2026-08-02 - Ability result successor and reward-cursor oracle

- Exact-SHA Ability Capsule run `30723962028` proved the nested Summary fix and completed the capsule choice,
  then exposed a real product failure at the next command frontier. Revision 7 installed `ABILITY_PICK` with an
  `AWAIT_SUCCESSOR` carrying `nextWave:0`; when the host reached wave 2 turn 1, Authority V2 correctly rejected
  its `CONTROL_COMMIT` as unauthorized and terminated both clients.
- `ABILITY_PICK` now carries a mandatory immutable `allowNextWaveStart` result bit. Consuming an ordinary reward
  states `true`; cancel and explicit reward/Mystery return edges state `false`. The closed registry, materializer,
  and successor adapter reject missing or contradictory payloads, so no local phase guesses this exit.
- The player-reported reward cursor gap was also absent from the browser oracle: the previous Ability fixture
  offered only one card, and paired convergence was checked only before navigation. The fixture now presents
  Poke Balls plus Ability Capsule; the driver moves through real public keys and requires the watcher to expose
  the same selection, option list, address, digest, and sole owner before it may submit the capsule.
- The next Ability run must qualify both the new cursor proof and the corrected wave-2 successor on one sealed
  build. Same-tab rejoin run `30723963985` is classified separately below.

## 2026-08-02 - Same-tab rejoin harness role restoration

- Exact-SHA run `30723963985` proved both browsers through wave 2, reloaded the existing tabs, completed the
  real `/coop/v3/rejoin` path and authenticated fingerprint exchange, then failed inside the driver with
  `resumeRun requires a paired public host`. This is a harness-context red: `reloadInPlace()` correctly clears
  page-owned public roles, but the journey never restored its already-proven account/role map before Resume.
- The harness now snapshots the exact host/seat-0 and guest/seat-1 clients before reload, requires the new
  provisional P33 host observation to match that mapping, and restores only those same-context identities.
  It still does not promote the provisional event to a gameplay binding; the ordinary public Resume decision
  must create and acknowledge generation-2 bindings before the journey accepts them.

## 2026-08-02 - committed Ability modal consumes its projected reward shell

- Exact-SHA Ability journey `30725240535` passed the paired reward cursor, PARTY/Summary return, Ability
  selection, and immutable `ABILITY_PICK` application. It then reproduced the player's real softlock: the
  replica accepted revision 7 but stayed on wave 1 in `ErAbilityCapsulePhase`/`SelectModifierPhase`, while the
  authority reached wave 2 and retained command revision 8 until the control-install watchdog terminated it.
- Authority V2 projects nested Ability surfaces as modals. Their old reward phase is parked in
  `PhaseManager.standbyPhase`; `tryRemovePhase("SelectModifierPhase")` can only remove queued phases, and normal
  `end()` restores the parked predecessor without starting it. The replica therefore resurrected the consumed
  reward shell instead of reaching its signed next-wave wait.
- `PhaseManager.shiftCoopAuthoritativeModalThroughAuthorityCommit` now closes this exact scheduler edge:
  committed Ability results retire both the result modal and its parked predecessor, select the already-queued
  successor, record/retain the address-exact terminal result, and only then start that successor. Cancellation
  still restores the reward shell. All four registered Ability workflows use the same seam, and focused
  coverage proves the predecessor cannot be resurrected or shifted again.

## 2026-08-02 - retired reward wait lease and per-seat rejoin generation proof

- Exact-SHA Ability journey `30726790868` proved the capsule result and signed wave-2 successor both applied,
  but the consumed reward continuation retained an old `interactionChoice seq=0` wait after its modal replaced
  it. The stall watchdog later mistook that obsolete wait for a mutual softlock while ordinary wave-2
  presentation was still progressing. `SelectModifierPhase.retire()` now aborts every phase-owned reward/action
  wait through one non-sticky lease; relay coverage proves the same sequence remains replayable afterward.
- Exact-SHA fresh-wave2 journey `30726784457` is green and provides the timing control: the same wave-2
  presentation normally needs about 32 seconds on the hosted renderer, while the stale Ability wait fired the
  watchdog at that boundary. The production fix is committed as `0a81120c9`; its focused push red
  `30727905904` is CI metadata only because the train manifest still named the previous base. Exact Ability
  proof `30727965146` is running.
- Exact same-tab run `30726792139` did not expose a game softlock. Both real browsers visibly reached the same
  wave-2 command screen with digest `c760f589548029d1`, zero relay waits, and generations host-local 1 / guest-
  local 2. The harness incorrectly required those per-seat generations to be one equal scalar. Browser evidence
  now emits the complete canonical generation vector, every parser checks its local element, and shared-
  frontier proofs require both clients to report the same vector. This preserves strict authentication while
  admitting the Worker's legitimate sequential hot-rejoin counters and generalizes naturally beyond two seats.

## 2026-08-02 - TM Case terminal successor and party-mutating reward matrix

- Player host/guest logs at dev-log tip `7261510f1feab3bf4dd5401593dfa107df87ff0d` prove the wave-5 TM Case
  mutation itself converged. The host targeted guest-owned party slot 1, the guest selected forget slot 1, and
  both advanced mechanically to wave 6. The host then rejected wave-6 `CONTROL_COMMIT` because the nested
  `LEARN_MOVE` result hard-coded `allowNextWaveStart=false` after replacing the terminal reward as the V2 head.
- `LEARN_MOVE` decisions now carry and validate a mandatory immutable `allowNextWaveStart` bit. Ordinary
  terminal-reward teaching derives true from its captured nested return plan; Mystery/nested reward returns and
  non-nested level-up teaching remain false. Contradictory `nextInteraction + allowNextWaveStart` material and
  incomplete learn payloads fail closed before successor construction.
- Shared-terminal reception now logs the authenticated peer reason, so the replica's Send Logs report identifies
  the same causal failure instead of only showing a generic shared-terminal frame and closed data channel.
- The matrix inventory exposed a second real synchronization gap before dispatch: concrete ordinary-TM and Mint
  variants did not implement `getPregenArgs()`. Their watcher reconstruction could therefore re-roll and consume
  replica RNG despite the reward stream claiming an immutable variant. Both now serialize their move/nature id,
  with a failure-first round-trip test that reconstructs from an empty/different watcher party without rolling.
- Added a build-and-URL-gated `party-mutating-rewards` public journey matrix. Twelve isolated remote jobs reuse one
  sealed build and drive TM Case, Learner's Shroom, Memory Mushroom, an ordinary TM, all three custom Ability
  workflows, Ability Randomizer, Move Slot Expander, PP Up, Ether, and Mint through two visible Chromium clients.
  Every entry targets the guest-owned combined party slot through public keys, requires exact cross-browser
  material parity at a wave-2 command frontier, and checks the configured mutation actually changed the target.
- The fixture uses four-move Garchomp starters, so all teaching entries traverse the player-reported full-moveset
  forget picker instead of the old empty-slot auto-learn shortcut. The CI observer remains read-only and now
  exposes the party mutation fields needed for exact assertions (moves/PP/PP Up, move cap, nature, tera, and
  ability identities); it never mutates the game or bypasses UI/relay/Authority V2.
- Next: qualify the full remote gate after the formatter-only red is folded in, then dispatch the 12-way browser
  matrix without exceeding the 32-runner co-op ceiling. Tera shards, fusion, evolution/form items, restoratives,
  and status/revive preconditions need dedicated deterministic fixtures before claiming complete consumable
  coverage; the first matrix covers every already-driveable nested picker and the exact live failure family.

## 2026-08-02 - full-moveset TM browser driver correction

- Live matrix `30750278739` exposed `TM_GREAT` as a harness-path red, not a completed product mutation: the
  Summary picker defaults to its fifth "new move/cancel" row, while the driver mistook Summary's page cursor
  (`cursor:3`) for a real move row and confirmed cancellation. The resulting return to the reward screen made
  its cursor oracle time out before any TM result was committed.
- The CI-only semantic observer now publishes the real learn-move row identity (`move:<id>:slot:<n>` versus
  `learn-move:cancel`). The public driver must visibly navigate to an existing move row before confirming, and
  records that exact selection. This prevents every full-moveset TM/Shroom case from earning a false green by
  clicking the cancel row.
- No local co-op or browser tests were run. Keep matrix `30750278739` alive for independent item evidence; run
  the corrected exact-SHA matrix remotely after its remaining jobs are classified.

## 2026-08-02 - party-fixture and post-reward oracle corrections

- Matrix `30750278739` proved the restorative/revival fixture rendered two visible starters per seat but then
  rejected each seat's Caterpie from its mirrored roster envelope: Garchomp cost four plus Caterpie cost two
  exceeded the ordinary five-point budget. The shared party therefore had only three members, `party[3]` was
  absent, and the deterministic damaged/status/fainted reserve precondition never existed. The exact build- and
  URL-gated party-reward fixture now makes only that envelope metadata free, matching the already-authorized
  visible fixture while leaving production roster validation unchanged.
- A successfully applied Ability Capsule reached wave 2 on both browsers, but Mystery difficulty opened the
  wave-2 Mystery Encounter before any CommandPhase. The final oracle incorrectly required a wave-2 command and
  reported the completed mutation as unfinished. Party material proof now accepts the newest classified,
  exact-address semantic frontier, prefers Command when available, and requires both clients to expose the same
  Authority V2 address and byte-equivalent mutation projection.
- No local co-op or browser tests were run; these harness corrections will be qualified in the next exact-SHA
  remote item matrix after the still-active diagnostic matrix finishes.

## 2026-08-02 - Dex Nav retained projection and form-change UI coverage

- The Dex Nav artifact proved a production continuation omission. Its reward commit correctly declared
  `AWAIT_SUCCESSOR -> ABILITY_PRESENT`, but the guest reward projector's concrete modifier switch omitted
  `ErDexNavModifierType`. It therefore returned `continuation=false`, advanced into ordinary `NewBattlePhase`,
  and began a 120-second wave-2 enemy wait while the host still owned the two-pick Dex Nav surface. Dex Nav is
  now retained before the ordinary Pokemon-target guard (its payload intentionally carries slot `-1`) by the
  same projection path as every other ability workflow, so the V2 presentation overrides a live reward
  continuation instead of racing a stale next-wave renderer.
- The ordinary form-change item applied successfully and opened the real `FormChangePhase`, but the CI observer
  emitted `unclassified` for its actionable `EVOLUTION_SCENE` handler. The driver consequently supplied no
  player-equivalent Space and timed out while the replica was already parked at the ordered next-wave wait.
  Form change now has an explicit semantic battle-presentation surface and uses the same readiness/address/
  phase-instance fences as evolution prompts.
- These changes were derived from the live two-browser artifacts, not inferred from the matrix conclusion.
  Verification remains remote-only after the diagnostic matrix completes.

## 2026-08-02 - form-change presentation lease and evolution fixture floors

- Matrix `30752299479` supplied stronger failure evidence after the semantic form surface landed. The authority
  visibly reached the terminal "changed form" prompt with `awaitingActionInput=true`, but the observer reported
  `inputBlocked=true`: Authority V2's single local-presentation registry admitted ordinary evolution and its
  replay, but omitted both rich form-change phase identities. Production therefore rejected the same Space the
  browser driver correctly refused to send, leaving the authority in `FormChangePhase` while its peer waited in
  `NewBattlePhase`. Both `FormChangePhase` and `CoopFormChangeCutsceneReplayPhase` now lease only their exact
  `EVOLUTION_SCENE` prompt; mechanically shared overlays in either phase remain frozen.
- The read-only browser observer and battle-prompt driver now classify both the ordinary and mechanics-free
  form-change cutscene phases under one `battle:form-change` surface. This makes the remote journey prove each
  local terminal prompt is genuinely actionable rather than papering over the production input gate.
- The same matrix proved ordinary Water Stone evolution was rejected solely because the isolated Staryu
  fixture started at level 5 below every configured level floor. Only the exact `EVOLUTION_ITEM` fixture now
  starts at level 30; the rare Scroll fixture remains level 70 and normal progression/evolution journeys retain
  their existing levels.
- No local co-op, Vitest, or browser execution was performed. These changes are queued for one new exact-SHA
  remote 36-variant item matrix after static contracts pass.

## 2026-08-03 - terminal evolution authority/replica bridge split

- Exact animations-on run `30772488229` completed its ordinary `EVOLUTION_ITEM` cutscene and committed the
  immutable reward result, then the authority client failed closed with `A signed next-wave wait opened outside
  the authoritative renderer.` The retained trace shows the authority replacing its ordinary `NewBattlePhase`
  with the signed structural bridge immediately before starting it; this is a production role-boundary defect,
  not a campaign timeout or input-driver failure.
- `EvolutionPhase` now queues that signed bridge only when the local Authority V2 role is `replica`. The
  authority keeps its normal locally-owned successor, while both roles still settle the exact terminal
  interaction result. A focused unit contract covers authority, replica, non-wave successor, and absent-session
  cases, and the browser source contract prevents this role guard from being silently removed.
- The same run's `RARE_EVOLUTION_ITEM` red is deliberately not folded into this change: its evidence reaches the
  guest-owned Learn Move commit but lets the replica begin `NextEncounterPhase` before retained presentation
  settlement can retry the buffered successor. That separate scheduler-ordering mechanism will be fixed and
  qualified only after the ordinary evolution role split is measured on its own exact SHA.
- No local co-op, Vitest, Chromium, or compilation run was performed. Verification remains remote-only.

## 2026-08-03 - retained evolution closes before its nested successor starts

- The `RARE_EVOLUTION_ITEM` artifact from run `30772488229` proves a second production defect. On the replica,
  the retained evolution reported completion at `23:59:10.399`; ordinary `NewBattlePhase` started three
  milliseconds later and `NextEncounterPhase` another three milliseconds after that. Only then did the replay
  completion callback retry reward revision 5. The replica was already on wave 2, so it correctly rejected the
  wave-1 reward image as cross-wave; the guest-owned Learn Move revision 6 consequently remained a permanent
  `frontier=5/4/4` gap.
- Retained progression completion now uses the existing atomic authority-commit scheduler seam: it selects but
  does not start the queued local successor, invokes the exact V2 completion callback, and starts that local
  successor only if the callback neither projected a replacement nor left an ordered same-wave wait pending.
  This also handles a genuinely delayed revision 6: the unsigned local tail remains selected but unstarted
  until the network-delivered interaction replaces it, rather than relying on revision 6 already being buffered.
- The scheduler now detects a modal installed and started by its callback, preventing a second `start()` call.
  Behavioral tests cover both the projected-modal and delayed-entry branches; source contracts bind retained
  progression and reward-evolution settlement to the atomic path and the explicit `allowNextWaveStart` fence.
- Focused ordinary Evolution Item run `30774089940` crossed the previously failing bridge, completed the
  animations-on evolution, converged both parties on Raichu, reached wave 2, and exposed the shared command
  frontier. That isolates this scheduler change to the separate nested rare-evolution mechanism. No local
  co-op, Vitest, Chromium, or compilation run was performed.

## 2026-08-03 - reward-owned evolution authority ledger evidence

- The only red after ordinary run `30774089940` had completed gameplay was the final presentation oracle:
  `authority=[]` versus one replica `renderer-completed` evolution. Both final screenshots and semantic
  observations show wave 2, equivalent parties, and the same state digest, so this is a harness-evidence red,
  not a product desync or softlock.
- The authority did retain the complete evolution inside revision-5 `INTERACTION_COMMIT`; the read-only
  authority observer was simply attached only to the earlier `WAVE_ADVANCE` capture, which is already closed
  when a reward-owned evolution finishes. `commitRewardAuthoritativeResult` now emits the authority receipt
  only after that exact immutable reward result successfully enters the negotiated log. The equality oracle
  remains strict; it is no longer relaxed to accept renderer-only evidence.
- A remote source contract binds the reward observer to the post-retention seam. The next focused
  animations-on measurements are ordinary `EVOLUTION_ITEM` and nested `RARE_EVOLUTION_ITEM` on the combined
  scheduler/evidence tip.

## 2026-08-03 - projected Learn Move resumes its retained unstarted successor

- Combined exact-SHA run `30775674276` proved the preceding retained-evolution scheduler change: both variants
  retained their reward revision, both evolution presentations completed on authority and replica, and the rare
  branch admitted and installed its guest-owned Learn Move revisions through `frontier=7/7/7`.
- The ordinary variant reached the shared wave-2 command and failed only because its isolated level-30 fixture
  was incorrectly subject to the normal-level mandatory-EXP cue. Party-mutating reward journeys now preserve
  strict authority/renderer ledger equality while excluding that impossible EXP requirement.
- The rare variant exposed one further production scheduler seam. Its projected `CoopReplayLearnMovePhase`
  closed through ordinary `super.end()`, which restored the parked `NewBattlePhase` but—correctly for an
  ordinary already-running modal predecessor—did not start it. The host reached wave 2 while the replica stayed
  on that unstarted wave-1 successor. PhaseManager now records exact started phase objects and its atomic
  Authority V2 close starts a restored successor only when that object had deliberately never started; ordinary
  temporary modals still resume their running predecessor without a duplicate start.
- The browser's Backspace had already submitted the projected decline and revision 7 was applied. The driver
  nevertheless waited for a second stop-teaching confirmation that this replay path does not open, masking the
  real successor stall behind a harness timeout. It now accepts either a fresh actionable confirmation or a
  fresh non-Learn-Move successor surface at the same or a later ordered address. Focused behavioral contracts cover both
  scheduler branches; verification remains one combined remote animations-on reward journey.

## 2026-08-03 - V2 Learn Move has one projector and role-owned evolution evidence

- Combined exact-SHA run `30778145880` proved the ordinary reward path mechanically complete: the evolution
  rendered, both parties converged, and both clients reached the shared wave-2 command frontier. Its final red
  was evidence-only. WebRTC assigned the host authority role to the page labeled `guest-seat`, while the legacy
  depth assertion scraped host/guest prose from fixed harness labels. The strict `browser-progression-event`
  records already contained the exact `authority-recorded` and `renderer-completed` pair. Evolution breadth now
  compares those typed lifecycle records by embedded role and stage across both pages, retaining exact identity
  equality and the mandatory depth-evolution requirement.
- The rare variant exposed the remaining product mechanism. Revision 6's typed SHARED_INTERACTION projector
  opened the correct `CoopReplayLearnMovePhase`, but its live materializer also emitted the legacy
  `learnMoveForward` carrier and queued a second replay copy. After revision 7 closed the exact projected modal
  and started `NewBattlePhase`, that obsolete copy reopened at the wave-2 address and permanently deferred the
  replica's command commit. Under V2, single and batch prompt material is now acknowledged without invoking the
  legacy presentation carrier; the central projector is the sole phase creator. Legacy sessions retain the
  forward path unchanged.
- The rare trace also recorded one CI-only fatal observation during the pre-picker `EVOLUTION_SCENE`: the visible
  wave parser returned `undefined`, so JSON serialization omitted the schema-required `displayedWave` field.
  Both active and passive semantic observers now emit explicit `null` until the HUD has painted. This does not
  weaken the visible-wave contract; a later actionable gameplay surface must still carry its positive parsed
  wave.
- Focused source/behavior contracts cover the single-projector cutover, batch parity, role-label reversal, and
  explicit-null transitional observation. No local co-op, Vitest, Chromium, or compilation run was performed;
  the next measurement is the same two-variant animations-on journey on one frozen exact SHA.

## 2026-08-03 - rare evolution is mechanically complete; chained-presentation ceiling corrected

- Exact-SHA run `30779783513` is the first combined proof after the single-projector cutover. Ordinary
  `EVOLUTION_ITEM` passed fully. `RARE_EVOLUTION_ITEM` opened exactly one `CoopReplayLearnMovePhase`, installed
  its exact actionable picker at revision 6, applied the decline once at revision 7, closed that picker, and
  advanced both real browsers to wave 2. There is no duplicate Learn Move phase, revision gap, desync, or
  stationary wait in this artifact.
- The rare lane's red is harness-only. The immutable animations-on between-wave ceiling expired at
  `03:03:45.891` while both traces were still recording causal ordered phase/stream progress. At that instant
  one client had entered wave-2 `CoopReplayTurnPhase`; the other was rendering the same wave's encounter-entry
  ability sequence. Final screenshots visibly show both clients in wave 2. The guest admitted revision 8's
  exact command frontier seconds later, but diagnostics began before the renderer could finish the finite
  pre-command presentation.
- The old outer bound allowed only one dense turn for the entire chained boundary. Animations-on between-wave
  waits now receive the ordinary fixed between-wave window plus one measured dense-presentation ceiling.
  Their sliding deadline still refreshes only from causal phase/authority/renderer evidence and remains clipped
  by that immutable sum; a stationary softlock retains the ordinary no-progress deadline, and every
  animations-skipped profile is unchanged.
- The source contract now pins this composition so later timeout cleanup cannot reintroduce the false red.
  No production code changed for this classification, and no local co-op, Vitest, Chromium, or compilation
  execution was performed.
- Exact-SHA rerun `30781406128` passed in two real Chromium clients with animations enabled. The replica
  started exactly one `CoopReplayLearnMovePhase`; the authority started exactly one native `LearnMovePhase`;
  revision 7 converged at `frontier=7/7/7`; and revision 8 installed the wave-2 command at
  `frontier=8/8/8`. Both final screenshots show the same evolved party and actionable wave-2 command UI.

## 2026-08-03 - merged-tip gate red classification

- The first full gate on the clean feat integration merge (`45549616c`, run `30782657795`) completed all 33
  jobs. Browser-native WebRTC and every shard except B1/B11 passed. The aggregate red consists of three stale
  assertions plus one newly merged feat type-contract regression; it did not expose a new co-op product
  desync, softlock, or recovery failure.
- The presentation source contract still required Evolution to pass an inline object literal. Production now
  creates one typed immutable `presentation` value and gives that same value to both the retained progression
  recorder and reward settlement. The contract now verifies this stronger single-result invariant.
- B1 still expected the projected single-Learn-Move terminal to retire through `setModeBoundedWhen()` and its
  ambient asynchronous callback. The V2 terminal deliberately closes through the exact phase projector, so
  the failure-first check is inverted: invoking that legacy async tail is now a failure.
- B11 still expected V2 to populate the legacy learn-move forward-in-flight registry. The exact projected phase
  and public panel were demonstrably parked until their immutable commit; the legacy registry must remain
  empty after the single-projector cutover. The assertion now binds that intended architecture.
- The nine `ab-attrs.ts` override diagnostics share one cause: merged feat added optional `useMode` without the
  explicit `| undefined` required by the repository's exact-optional parameter contract. The other two merged
  diagnostics are a missing non-null guard around the Superego WeakMap value. Both production typing repairs
  are narrowly scoped and preserve runtime behavior.
- Local Biome inspection itself hit the known Windows worker stack-overflow before producing a verdict. No
  local co-op, Vitest, Chromium, or compilation run was performed. The repaired exact SHA will be verified by
  the remote full gate.
- Remote gate `30783417776` verified the merged type repair, B1, B11, every other A/B/C/P shard, all four P33
  mutation shards, the sealed production bundle, and browser-native WebRTC: 31 substantive jobs passed. Its
  sole underlying red was the source-contract file reaching one later obsolete assertion that still demanded
  `this.end(); onComplete()` after an earlier assertion in the same test already required the atomic
  `shiftPhaseThroughCoopAuthorityCommit()` scheduler. That final legacy assertion now rejects the unsafe old
  ordering instead. The aggregate red is consequential only.
- Exact-SHA gate `30783864052` again passed all 31 substantive production/type/shard/mutation/WebRTC jobs.
  Its fast source lane advanced beyond the progression contract and found one dependent meta-contract still
  matching the old B1 assertion's English prose. The contract now names the actual invariant: a projected
  single-Learn-Move terminal must not delegate retirement to an ambient async UI callback. B13's apparent
  delay was GitHub infrastructure (checkout consumed 8m42s); the isolated test shard itself completed green.
- Gate `30784448306` passed the complete fast source/public-UI/node-pure contract lane and all 31 substantive
  jobs. Its only underlying red was Biome requesting a one-line layout for the updated meta-contract; no type,
  behavioral, mutation, bundle, or WebRTC check failed. The formatter's exact output is applied verbatim.

## 2026-08-03 - exact merged-tip gate and reward-matrix startup classification

- Final gate `30785138089` is fully green at exact SHA `cba587c2b93d9a2872923bd8a65df41c465c6631`: all
  33 jobs passed, including static/type/format, every A/B/C/P shard, all mutation-assurance shards, the sealed
  bundle, and browser-native WebRTC.
- Exact-SHA two-browser reward matrix `30785547999` is intentionally left running. Its first five reds
  (`SUPER_POTION`, `MAX_REVIVE`, `TM_ULTRA`, `TM_CASE`, and `REVIVE`) are one repeated CI startup mechanism,
  not five reward defects: no lane registered accounts or reached gameplay; both browsers fetched roughly
  2,900 immutable upstream assets (about 32 MiB) under the 28-job fan-out, and `LoginPhase` first appeared at
  307-311 seconds, just after the five-minute boot wait expired. Final screenshots visibly show the login
  surface and traces contain zero key presses.
- The same still-running matrix has already produced green real-browser reward evidence for `MAX_POTION`,
  `POTION`, `RARER_CANDY`, and `ETHER`. Inspected artifacts prove the named reward was visibly selected through
  the public UI, party material converged on both clients at the exact Authority V2 address, and both browsers
  reached the actionable wave-2 command frontier. `MAX_POTION`, for example, proves slot 3 changed from 4/19
  HP to 19/19 HP on both replicas; paired final screenshots show the synchronized wave-2 double battle.
- Do not mutate production for the five startup reds. Finish and classify every matrix lane, then correct the
  remote asset-loading/fan-out contract and rerun only the lanes that never crossed setup.

## 2026-08-03 - reward matrix exposed the native Learn Move projector collision

- `TM_GREAT`, `TM_COMMON`, `ER_LEARNERS_SHROOM`, and `MEMORY_MUSHROOM` all reached real gameplay and exposed
  one identical product softlock. The reward continuation started a native `LearnMovePhase` on the replica,
  but the ordinary Authority V2 projector always installed a second `CoopReplayLearnMovePhase` over it.
  Revision 7 closed the replay and advanced the authority; the replica then uncovered the stale native phase,
  which kept resending the already-committed choice while revision 8's wave-2 command remained at frontier
  `8/7/7`. This is the exact user-visible frozen learn-move/party-item class the matrix was built to catch.
- The central ordinary projector now first binds the immutable Learn Move operation address to a matching
  running native phase. It also stages that address on an exact queued reward continuation before falling back
  to replay materialization. Staging is owner-exact for either seat; a guest-owned picker stays interactive,
  while only a host-owned mirror enters watcher mode. Level-up learns, which have no native replica phase,
  retain the replay fallback.
- The legacy forward adapter uses the same generalized current/queued binding contract. Failure-first source
  coverage pins both the live-phase reuse and queued-phase staging ahead of replay construction, preventing a
  future refactor from restoring two simultaneously authoritative picker objects.
- `RARE_EVOLUTION_ITEM` is a separate CI-load classification in this 28-way run: at roughly three frames per
  second its finite animations-disabled evolution presentation was still emitting ordered stage heartbeats
  when the lane deadline expired. `HYPER_POTION` visibly mirrored the requested cursor in the final screenshot;
  its harness observer timed out after the watcher applied the cursor event and therefore is not evidence of a
  reward cursor product failure. Both remain candidates for reduced-fanout remeasurement after the product fix.

## 2026-08-03 - post-fix gate fixture migration

- Exact-SHA gate `30787474307` passed 30 substantive jobs and exposed only two Lane-A crashes in
  `coop-learn-move-inline-park.test.ts`. Both stopped before their behavioral assertions because the minimal
  fake PhaseManager lacked the real `hasPhaseOfType()` query newly used by the native-continuation preflight.
  Production PhaseManager has this API; this is a stale fixture surface, not a runtime failure.
- The fixture now faithfully reports that it contains no queued native `LearnMovePhase`, allowing the two
  tests to continue covering their owned fallback cases: inline replay over a parked renderer and queued replay
  when the renderer is drainable. No production behavior changed for this gate repair.

## 2026-08-03 - reward cursor readiness race retained instead of dropped

- The `HYPER_POTION` lane in run `30785547999` was not merely an observer miss. The owner became actionable,
  moved to Hyper Potion, and sent mirror FIFO entry `n=0` while the slower watcher was still completing its
  reward animation. `CoopUiMirror` logged an apply and consumed the entry even though the watcher's real
  `ModifierSelectUiHandler.processInput()` returned false. Two minutes later its semantic cursor remained on
  Poke Ball. Mechanical Authority V2 state was unaffected, but presentation was genuinely stale.
- The mirror engine now returns the real handler readiness verdict. A false result retains the exact FIFO entry
  and retries it at a short cadence only while the same session and UI mode remain live. Success advances the
  high-water mark once; a mode mismatch still drops cosmetic stale input, and a renderer exception remains
  fail-soft without poisoning later entries.
- A failure-first loopback test reproduces the owner-ready/watcher-rendering race with no game engine and proves
  the retained input applies exactly once after readiness. This closes the prior coverage gap: the mirror tests
  had modeled every watcher handler as synchronously ready, unlike two real browsers under asymmetric load.

## 2026-08-03 - learn-move exact-SHA remeasurement and finite prompt driver

- Exact-SHA browser run `30787688209` proves the native-phase reuse production fix in three independent item
  workflows: `TM_COMMON`, `ER_LEARNERS_SHROOM`, and `MEMORY_MUSHROOM` all passed through the real two-browser
  UI and reached the converged wave-2 command frontier. Their former stale native picker softlock is gone.
- `TM_GREAT` reached and bound the exact revision-6 learn-move operation to the existing native phase on the
  replica, so it did not reproduce the product collision. Its red was a harness call-chain gap: after accepting
  the Yes/No confirmation, native `LearnMovePhase` presents one actionable “Which move should be forgotten?”
  MESSAGE before opening Summary. The driver waited for Summary without pressing that finite prompt, leaving
  the authority visibly and safely awaiting human input while the replica already showed the read-only list.
- The accept driver now recognizes only same-address, actionable `LearnMovePhase` narration, advances each
  unique prompt generation once through the public keyboard path, and then requires the exact actionable
  Summary picker. A pure contract test distinguishes that prompt from wrong-address/stale material and from the
  completed picker. No production change was made for the `TM_GREAT` classification.
- The full 36-item matrix keeps its 28-runner throughput but now receives a measured seven-minute first-load
  budget. This is scoped only to `party-mutating-rewards`: run `30785547999` proved five setup-only reds whose
  browsers first reached LoginPhase at 307-311 seconds under CDN fan-out, just beyond the old five-minute bound.
  Ordinary journeys retain the five-minute boot contract, and the matrix's 20-minute total setup ceiling is
  unchanged.

## 2026-08-03 - focused reward and exact gate classification

- Exact-SHA two-browser run `30788976362` passed both focused cases on candidate
  `e32712bb37617e2b039e7136574ef78423d11914`.
- `HYPER_POTION` mirrored the named reward cursor to the watcher, selected the exact guest-owned party target,
  converged that target from 4/19 HP to 19/19 HP on both clients, and installed the identical wave-2 command
  frontier and state digest. The former stale Poke Ball watcher cursor did not recur.
- `TM_GREAT` traversed the finite native Learn Move narration, opened the exact Summary picker, committed one
  replacement (move 323 -> move 14), closed the exact queued picker, and installed the identical wave-2 command
  frontier on both clients. The trace contains no duplicate `CoopReplayLearnMovePhase` and no `8/7/7` stall.
- `ER_LEARNERS_SHROOM` and `MEMORY_MUSHROOM` had already passed the same exact native-phase reuse path in run
  `30787688209`; the final broad reward matrix will requalify them together with `TM_CASE`.
- Full gate `30794206320` passed static/type/format, the fast Authority V2/public-UI contracts, every A/B/C/P
  behavioral shard, all four mutation shards, the immutable bundle, and tier-1 native WebRTC. Its sole
  underlying red was CI-only: the browser job spent 11m46s cloning the immutable assets submodule, leaving only
  2m16s of its 15-minute job ceiling for a sealed-production checkpoint whose known-green runtime is about
  4m31s. GitHub cancelled the step and the aggregate correctly mirrored that cancellation; no product assertion
  failed.
- The browser job now retains all strict transport-internal no-progress bounds but has a measured 25-minute
  wall-clock ceiling so transient checkout latency cannot manufacture the same cancellation. A source contract
  prevents the job budget from dropping below the measured checkout-plus-checkpoint requirement.

## 2026-08-03 - live Mystery trainer tail split isolated

- Paired staging logs from build `4693e5c26` proved a product control split after a wave-9 embedded Mystery
  trainer battle: both clients had the same mechanical digest, but the host entered `TrainerVictoryPhase`
  while the guest remained held in `BattleEndPhase` awaiting the later reward-prepared `battle-settled` entry.
- The candidate now runs automatic Mystery reward preparation in a non-interactive phase immediately after
  host BattleEnd. Its retained complete state releases both clients into the same TrainerVictory/Money tail;
  a later phase opens the already-prepared reward surfaces without repeating automatic effects.
- `TrainerVictoryPhase` now establishes an explicit co-op enemy-trainer hidden postcondition before ending.
  The sealed browser observer carries exact enemy-trainer visible/alpha state on every semantic surface.
- The public prompt driver no longer advances a one-sided TrainerVictory prompt: both real browsers must
  expose the same actionable address first. The evidence sink fails if the first surface after TrainerVictory
  still presents the defeated trainer.
- TODO: commit/push the candidate and use remote GitHub runners for source/unit/type checks plus a real
  Mystery trainer browser reproduction. Do not qualify this production fix through local gameplay tests.

## 2026-08-03 - ordered normal trainer-victory control and exact consumer lease

- The first V2 normal-trainer candidate proved that `TrainerVictoryPhase` needed its own typed
  `trainer-victory-open` CONTROL_COMMIT between the settled TURN and WAVE entries. The commit carries the
  complete authoritative state, immutable trainer identity, and a mandatory ordered successor wait; the
  projector installs the exact replica presentation and the phase establishes enemy-trainer-hidden before
  completion.
- Gate evidence then exposed two real ordering races. First, the won-wave predecessor wait did not admit the
  new control address; it now names only the exact trainer-victory coordinate (plus the existing exact
  replacement address where applicable). Second, a following WAVE entry could replace `latestControl` before
  the trainer phase started; an address-exact pending runtime lease now survives that admission and is cleared
  only by the real phase completion or hard epoch reset.
- Exact-SHA gate `30817216159` exposed the final race: a legacy guest tail could briefly construct an
  unsanctioned `TrainerVictoryPhase`, the renderer gate neutralized it, and the V2 projector's phase-tree query
  then mistook that object for its authorized consumer and queued nothing. Tip `07465e273` makes the first
  exact lease installation always queue one ordered consumer; the lease itself is the only duplicate guard.
- Final remote qualification is running at exact SHA `07465e273`: full gate `30817902430` and 10-wave
  two-real-browser Mystery campaign `30817905195`. The older gate and Mystery run remain untouched as
  failure-first evidence. No local gameplay, Vitest, Chromium, or compilation process was run.
- Gate `30817902430` proved that first-lease construction was still neutralized by the older strict-tail
  renderer gate: CONTROL_COMMIT authority was exact, but that gate recognized only WAVE sanctions. The
  follow-up wraps construction in a synchronous consumed-once control permit. The ambient phase remains
  blocked before and after the call; only the phase object created inside the ordered projector is admitted.
- Exact-SHA gate `30818711037` on production candidate `8695cfa89` turned the formerly failing trainer-tail
  shards P1, B11, C3, and C5 green. The remaining C1 red occurred only because the one-process soak stopped
  authority immediately before `MysteryEncounterPhase.start()` could emit `ME_PRESENT`, then incorrectly
  demanded that the guest abandon its valid signed `NewBattlePhase` wait and infer a local predecessor.
- The soak now preserves that exact signed wait when the host has already installed the destination Mystery
  battle; the ordinary ME projector will replace it once `processMeWave` starts the real surface. This is a
  harness-only correction with a pinned source contract. The only other gate red was import ordering, fixed
  without changing runtime behavior. Real two-browser Mystery run `30818713774` remains active and untouched.
- Focused closure run `30820751128` passed static, all source/node contracts, and all six selected shards,
  including the exact C1 45-wave journey that previously rejected the signed Mystery destination wait.
- Two-browser Mystery run `30818713774` proved both clients installed the ordered normal trainer-victory
  control at revision 35. Its red was driver-only: both local prompts were actionable, but the helper pressed
  the host and returned; once the host entered rewards, its reciprocal-readiness check permanently refused
  the guest's still-actionable prompt, so only the host arrived at `shop:7:6`.
- The prompt driver now consumes an exact paired TrainerVictory generation atomically through ordinary Space
  input on both browsers. Its focused contract now requires one call to press both seats exactly once. No
  production code changed for this classification; the guest's visible trainer was still the active victory
  presentation, not a stale sprite after completion.

## 2026-08-03 - live repeated-trainer presentation overtake

- Paired staging logs from exact build `e7857b72b` show wave 5's normal trainer control reached
  `controlInstalled`, then the session continued through shops and later battles. At wave 8 the guest applied
  authoritative state tick 139 but rejected the new Rival `trainer-victory-open` revision 48 before projection.
  The generic material error hid which invariant failed.
- Root architectural gap: a `trainer-victory-open` entry used `AWAIT_SUCCESSOR` as its successor, and the
  ordinary projector signed that wait as installed as soon as immutable material/phase construction existed.
  It did not wait for the replica's finite TrainerVictory prompt to complete. A following WAVE entry could
  therefore overtake the prompt and leave its exact pending presentation lease alive until a later trainer
  battle conflicted with it.
- Candidate change holds the replica's final control proof until the exact real `TrainerVictoryPhase` finish
  records completion, then retries the retained V2 entry on the existing address-exact microtask path. The
  projector does not queue the presentation again after completion. Every trainer material/cursor/successor/
  lease/ledger rejection now emits a specific diagnostic. A Rival regression covers both
  `SUPER_EXP_CHARM` and `EXP_SHARE` material instead of only one Voucher reward.
- TODO: commit/push without local execution, run remote static plus the owned trainer boundary/runtime shards,
  then run a two-browser journey that crosses at least two trainer victories before deploying the corrected
  exact SHA to staging. Preserve active runs `30822228534` and `30824237635` for artifact classification.

## 2026-08-03 - trainer-victory completion fence and human-skew qualification

- Paired live staging logs at exact build `e7857b72b` proved a repeated-trainer overtake: the guest signed
  `trainer-victory-open` as installed before its finite prompt completed, a later WAVE entry advanced, and
  wave 8 rejected the next trainer lease against the stale wave-5 presentation.
- Production commit `6d67e02a7` now withholds the replica's `controlInstalled` proof until the exact real
  TrainerVictory phase records completion, then retries the retained V2 entry through the existing
  address-exact projector. Completed retained redelivery cannot queue the presentation again. Exact rejection
  diagnostics and a Rival multi-reward regression were added.
- Staging deploy `30826469191` is green at build marker `github:6674542b37d3cbb6f3e885af11645ec58f436e3d:run-30826469191.1`.
  No production deployment was made.
- Depth run `30825927786` at the first fenced product reached wave 5 TrainerVictory on both browsers with
  identical state digest. It exposed a second product defect: the guest remained at frontier `24/24/23`, but
  its exact real prompt reported `awaitingActionInput=true,inputBlocked=true`. The projector returned deferred
  before installing the immutable successor wait locally, so the physical-input gate still saw the prior TURN
  control and made the completion proof circularly impossible.
- Final production commit `bd87ac311` deliberately leaves the successor claim uninstalled (so even an early
  authenticated successor remains fail-closed) and grants a narrow pre-install input lease only when the
  replica role, source operation, `trainer-victory-open` material, retained operation ID, wave, turn, current
  phase, and actionable MESSAGE handler all match. The authority cannot overtake the prompt, but the renderer
  can dismiss it. A source-order contract and the real two-browser staggered driver pin both sides.
- The public browser driver now deliberately presses the authority's paired TrainerVictory prompt first,
  delays, proves the replica's exact prompt remains actionable, then presses the replica. This reproduces
  human timing instead of atomically pressing both clients. Remote pure-driver coverage pins the call chain.
- Mystery run `30824237635` was another harness red: synchronized command authority progressed through turn
  13 on wave 6, but the generic 12-turn cap mislabeled it as a softlock. Only Mystery receives a 30-turn
  ceiling and cycles observer-proven damaging moves; the independent campaign wall clock remains fail-closed.
- Runs `30829379718` and `30829450654` are preserved evidence for the superseded early-install draft and must
  not qualify the final product. Exact `bd87ac311` run `30829771979` passed remote owned type/format, every
  public source/driver contract, the focused trainer-victory Vitest, sealed build, and artifact publication;
  its fresh two-browser leg is queued/running. Ten-wave depth `30829775259` and ten-wave Mystery
  `30829978557` are the exact long-form qualifications.
- Staging deploy `30829928856` succeeded with public marker
  `github:bd87ac3113a60ae27db99c24a14dba37f4091620:run-30829928856.1`. Production remains untouched.
- Exact short journey `30829771979` is fully green: remote type/format/contracts/Vitest/build plus two real
  Chromium clients completing fresh registration, public lobby pairing, and the wave-2 frontier in 743s.
  Its compact artifact reports `status=passed,error=null` and contains no desync, softlock, material rejection,
  or unexpected control-deferred line.
- Do not run gameplay/Vitest/TypeScript locally; use GitHub-hosted workflows and preserve the 32-runner
  ceiling.

## 2026-08-03 - trainer driver correction and Mystery transition presentation retention

- Exact depth artifact `30829775259` did not reproduce a product input block at wave 5. Both real browsers
  exposed the same actionable `TrainerVictoryPhase`, but the driver required a replica-local `BattleEndPhase`
  marker that an authoritative renderer can never produce. Harness commit `b69d2c381` proves the causal
  BattleEnd successor on the host, then requires both immutable trainer-victory addresses and advances both
  public prompts with human skew. The regression fixture now models the real direct CONTROL projection.
- Exact Mystery artifact `30829978557` exposed a separate production presentation loss. The authority recorded
  one wave-6 arena-cleanup message (`The pointed stones disappeared...`), the guest received only its
  best-effort live packet at a non-battle address with no replay consumer, and opening wave 7 discarded the
  still-unsealed recorder. Mechanics stayed converged, but the ordered presentation ledger correctly failed
  67 authority events versus 66 renderer receipts.
- Production commit `86f977e59` opens `newBattle()` cleanup in a deferred transition recorder. Only an
  unpublished, unsealed turn-one prefix from the same session and exactly adjacent wave may carry across a
  non-battle Mystery surface; published battle material, wrong sessions, non-adjacent waves, and ordinary stale
  recordings remain fail-closed. The next real battle releases the prefix and its CONTROL commit retains it.
  Node and source contracts cover the exact carry plus every rejection fence.
- Full co-op-only gate `30833666863` is green on `86f977e59`: static/type/format, public and Authority V2
  contracts, every A/B/C/P shard, all mutation shards, immutable browser bundle, and native WebRTC/rejoin.
- Formatter-only harness commits produced final exact staging tip `fefa52ee2`. Staging deploy `30834358397`
  succeeded and public `version.json` verifies marker
  `github:fefa52ee2d78c032e102a4936e78d13c64a87081:run-30834358397.1`. Production was not touched.
- Ten-wave Mystery `30834049605` and normal-depth `30834244287` are the active exact-tip two-browser
  qualifications. Preserve both runs and classify their artifacts before any further product change.
- The player's new Send Logs upload had still not reached the dev-log branch after repeated pulls (2,096 total,
  zero new), so no claim about that specific report may be made until the upload appears.

## 2026-08-03 - final-tip browser qualification and scaled manual-depth budget

- Exact final-production-tip Mystery journey `30834049605` passed on `fefa52ee2`: two real browsers cleared ten
  target waves and arrived at wave 11, crossed six-plus Mystery surfaces, alternated reward ownership, crossed
  the real wave-7 trainer-victory prompt with parity and trainer-presentation cleanup proof, and reported no
  desync, softlock, or authoritative material rejection.
- Exact animations-enabled surface journey `30835172528` passed on the same production tip. Both real browsers
  rendered the complete wave-1 and wave-2 battle presentation, exercised both reward-owner directions, replayed
  the wave-3 ability presentation, and converged at the wave-3 command frontier with no product error.
- Ten-wave normal-depth run `30834244287` was a harness-budget red, not a product assertion: it cleared seven
  complete waves, including a real normal trainer victory at wave 5, and was entering the wave-8 trainer
  presentation with parity true and revision 43 installed when the fixed 45-minute campaign lifecycle timer
  killed the process. No desync, softlock, session failure, or material rejection preceded the timeout.
- Harness-only commit `e22f070b5` preserves the calibrated 45-minute budget for the ordinary four-wave depth
  profile but grants manually requested depth journeys above four waves an 80-minute campaign lifecycle and
  matching 83/90-minute step/job ceilings. Product code is unchanged.
- Exact pushed-tip smoke `30838327971` is fully green at `e22f070b5`: workflow selection, sealed bundle,
  format/boundary/contracts, solo navigation, and the one-wave two-real-browser campaign all completed. The
  paired clients issued a synchronized command, crossed rewards, and converged at the wave-2 frontier.
- Staging remains the already-qualified production bundle
  `github:fefa52ee2d78c032e102a4936e78d13c64a87081:run-30834358397.1`; the harness-only commit was not deployed
  and production was not touched.
- The newly reported human desync is deliberately unresolved rather than guessed. Repeated pulls still show
  zero new files and 2,096 total reports; remote `dev-logs` remains at `1379dbd2b52eb1fa89f6e2fb3a1a7ae7752321ce`.
  Ask the player to press Send Logs again on both clients or attach the downloaded reports directly. Do not
  integrate this candidate into `feat/elite-redux-port` until that capture is available and classified, unless
  the maintainer explicitly accepts the unresolved report.

## 2026-08-03 - live wave-9 presentation watchdog false positive

- The paired reports finally arrived at dev-log tip `e2702eb770a62cb42b0a2cd2563e9ae2b3c2251b`:
  guest `2026-08-03T18-28-54-673Z__no-scenario__desync.log` and host
  `2026-08-03T18-28-58-460Z__no-scenario__anon.log`. Both are exact staging build `fefa52ee2`, session epoch
  `1828639826663409`.
- This was not a mechanical divergence. Wave 9 turn 1 converged at state tick 44 and digest
  `06da3761b28ca4c5` on both clients. A guest `CoopStatStageReplayPhase` legitimately took about ten seconds
  before the next presentation phase started. The old five-second observation failed after one following
  no-frame interval, permanently recorded `stat-watchdog-expired`, and the exact final presentation proof then
  requested the shared terminal even though authoritative state had already converged.
- Production commit `0877ade2f` replaces that assumed frame-rate ceiling with a 30-second rolling no-frame
  window while retaining the independent 120-second hard wall for advancing animations whose completion
  callback never arrives. Ten seconds of renderer starvation is tolerated; a real 30-second freeze and the
  hard wall still fail closed.
- The same capture exposed an independent learn-move retry leak: a committed guest decision included
  authority-authored successor metadata absent from the original proposal, so JSON-stringifying the complete
  payload produced different cancellation keys. Retry identity now uses only the stable human decision fields
  plus wave/turn; the retained decision cancels its one-second resend after commit.
- Test commit `cb4339055` updates every manual watchdog fixture to advance the runtime-owned authority clock
  through the rolling stall window instead of treating the first callback as expiry. Exact focused run
  `30845805626` is fully green: static/type/format, source/node contracts, B13, and aggregate. The production
  P1 presentation lane passed in `30844705682`, and exact production candidate journey `30844705840` passed
  fresh registration, public lobby pairing, two real Chromium clients, rewards, and the wave-2 frontier.
- Staging deploy `30846035981` is green and public `version.json` verifies
  `github:cb433905559a2f20ea95cb83a67a996d06ddecc5:run-30846035981.1`. Production was not touched.

## 2026-08-03 - live reward pause/settings input-lease softlock

- Dev-log tip `60bfc61052f77bdd126b2961be218cfb77e3e4c8` contains the exact host/guest pair from staging build
  `cb4339055` (run `922a05bd-2f99-46b6-8c04-776963161286`, epoch `1828644884076428`). Both engines
  converged through wave 13 turn 2 at digest/checksum `a430b83de3719365`, then installed the same guest-owned
  reward operation at global V2 revision 34. The host remained connected and waited for interaction choice
  seq 13 for more than ten minutes; the guest remained in `SelectModifierPhase` with no machine wait.
- The live softlock is an input-lease seam, not a mechanics divergence. Escape opens `UiMode.MENU` directly
  from `UiInputs.buttonMenu`, bypassing `UI.processInput`. Once MENU/SETTINGS replaces MODIFIER_SELECT,
  `isCoopV2InteractionHumanInputFrozen` correctly sees that the exact reward handler is no longer installed,
  but previously rejected every local overlay key as if it could advance shared authority. Sprites continued
  animating while cursor, Cancel, and Settings input were dead; the peer could never receive the reward choice.
- The production fix adds `coopLocalOverlayInputAllowed`: MENU itself is local, while nested Settings/generic
  chrome is admitted only with a real MENU ancestor and an all-`local-only` registry path. Any mirrored
  descendant fails closed, so generic CONFIRM/OPTION_SELECT cannot acquire a mechanical bypass. Escape now
  exits Settings through its normal CANCEL cleanup path. No overlay input is mirrored or releases the shared
  reward lease; closing both overlays returns to the same address, digest, selection, and owner.
- The CI observer now uses the identical production predicate and publishes actionable `pause-menu` and
  `pause-settings` surfaces. The new `reward-pause-settings` journey uses two real Chromium clients and only
  public keys to open Settings during a live reward, move its cursor, capture the screen, Escape twice, prove
  the exact reward is restored, leave rewards, and converge at the wave-2 command frontier. This closes the
  coverage hole: prior Settings walks happened only before pairing, so they never intersected the V2 freeze.

## 2026-08-03 - live double-trainer double-KO replacement frontier

- Paired dev logs at `heraklines/dev-logs` tip `38999871e3dcda2300a9a9b8748a9e570657845f`
  reproduce the report `double battle ko then not switch in` on staging build `cb4339055`. The host and guest
  were mechanically identical after wave 14 turn 1 except for `saveDataDigest`: the host's temporary generic
  trainer shell selected a COMMON-pool class while the renderer selected RARE, leaving their module-scoped
  `erLastGenericTrainerType` cursors different. Both authoritative enemy switch events reached the guest, but
  the unresolved preceding TURN_COMMIT held them behind the V2 revision gap until the authority deadline.
- Production commit `19d2310ad` adds the generic-trainer no-repeat cursor to ordinary authoritative material
  and full snapshots, restores it before save-data checksum verification, and registers it in the replication
  contract. The direct save-data regression proves a divergent renderer cursor is detected, adopted, and
  converged.
- The first exact gate `30853730581` was 31/32 substantive jobs green. Its sole red was a failure-first test
  fixture error: a random double ACE_TRAINER legally generated only three total enemies, while the new test
  required two leads plus two per-trainer-slot reserves. This was not a product failure; browser-native WebRTC
  and every other gate job passed.
- Harness-only commit `296b89e01` pins only the missing reserve for each real trainer slot before the live
  battle is mirrored; all command, faint, switch, replay, and presentation code remains production. Exact B8
  evidence in run `30854723189` is green: 46/46 tests, `erLastGenericTrainerType host=35 -> restored`, two real
  `SwitchSummonPhase` starts, `continuationReady`, and final checksum matches.
- Exact final-SHA full co-op gate `30854723189` is fully green: all 33 jobs passed on
  `296b89e01aa25e61b049c92ef88fba98bb85735b`, including every A/B/C/P shard, mutation assurance,
  static/type/format, immutable browser bundle, and browser-native production WebRTC/rejoin.
- Staging deploy `30855403585` succeeded and public `/version.json` verifies
  `github:296b89e01aa25e61b049c92ef88fba98bb85735b:run-30855403585.1`. Production was not touched.
- Continuous two-real-browser 30-wave journey `30854725171` remains active and must not be cancelled. Its live
  heartbeats show successful fresh-account onboarding, settings-attested 10x speed, public lobby pairing,
  level-100 three-mon fixtures on both seats, and both clients at the shared wave-1 command frontier. Continue
  monitoring it through the first trainer replacement and eventual wave-30 terminal.

## 2026-08-03 - double-KO closure and browser input pacing

- The continuous run `30854725171` exposed a harness-only trainer-cleanup mismatch: it compared Phaser's raw
  `visible` bit even though both trainer sprites had alpha zero and the public rendered-presentation contract
  correctly reported them absent. Harness commit `8521d2dcb` now compares canonical rendered trainer
  presentation and carries a regression for transparent-but-visible sprite shells. Production code is unchanged.
- Its successor run `30857009580` reached the wave-5 trainer victory but redlined at reward rendezvous
  `shop:5:4`. Artifact traces prove the authority and replica had both completed the trainer battle; the replica
  was still on the actionable voucher `MESSAGE` immediately before the shop. The public-key driver issued the
  next Space in the same Phaser frame as the previous prompt transition, treated the voucher as consumed, and
  never retried it. The rendezvous correctly failed closed because one browser had been left behind; this was
  not a product or Authority V2 defect.
- Harness commit `689d9e86f` adds an event-driven input receipt: every public DOM key waits until a strictly later
  Phaser frame observes the key released before another key may be sent. The exact remote build job proves
  format, both public-driver boundaries, the wait/rendering contract suite, and the sealed browser bundle.
- Exact focused two-real-browser run `30860049050` is fully green at `689d9e86f`. It cleared six continuous
  waves with ordinary public keyboard/DOM control, including the exact wave-5 trainer victory, host-owned
  reward, and `shop:5:4` handoff; both clients then converged at the wave-6 command frontier and ultimately the
  addressed wave-7 mystery frontier. The artifact summary reports `status: passed`, `finalWave: 7`, no error,
  graceful cleanup, zero fallback turns, and no recovery. The compact evidence is retained under
  `.artifacts-doubleko-depth-30860049050-compact/`.
- The production double-KO fix remains the already deployed staging bundle
  `github:296b89e01aa25e61b049c92ef88fba98bb85735b:run-30855403585.1`. Commits `8521d2dcb` and `689d9e86f`
  are test/observer-only, so no additional staging deploy is required. Production remains untouched.

## 2026-08-04 - Stormglass successor closure and retained trainer-reward driver

- Exact registered-interactions run `30863183864` exposed a real Authority V2 successor-address defect:
  after the host chose Stormglass on a wave-2 Mystery battle, it authored `ME_PRESENT` in the protocol's
  pre-turn domain `w2:t0`, while the predecessor admitted only the ambient battle shell's `w2:t1` address.
  Production commit `a75912d9b` authorizes only the exact same-wave `ME_PRESENT:t0` alternative alongside
  the ordinary command frontier. Focused rerun `30864499291` is green, but its random Ace-mode wave 2
  selected the command alternative and therefore did not itself prove the Mystery branch.
- Continuous navigation run `30862517427` failed at wave-5 shop rendezvous even though product authority,
  state, and retained wave progression had converged. The replica was left on a real actionable Voucher
  `ModifierRewardPhase` because the driver required a local `BattleEndPhase` marker that Authority V2
  replicas intentionally never execute. Harness commits `39142a700`/`f4362888a` accept only the exact
  ordered `projected trainer victory rev=N wave=W turn=T` proof and retain wrong-wave/no-proof negative
  coverage. Exact remote build/type/format/contracts are green in run `30865215640`; its 30-wave browser
  job remains active and must not be cancelled.
- The registered-interactions journey is being strengthened instead of adding a production shortcut. It
  now selects the real Mystery difficulty through the public UI, targets wave 2 so same-wave embedded
  battles cannot end the test early, receives only bounded extensions from proven public surface actions,
  and must observe the replica's exact Stormglass `ME_PRESENT:w2:t0` successor plus a completed paired
  Mystery terminal at a later wave. Remote-only qualification is still required.
- Staging deployment `30865970812` completed at exact SHA `f4362888a`; public `version.json` verifies
  `github:f4362888a35ee483439b57c3dfa6ffb7cc9ad00a:run-30865970812.1`. Testers can exercise the
  product fixes while closure continues. Production remains untouched.

## 2026-08-04 - final-candidate remote qualification in flight

- Harness-only commit `de729b901` makes `registered-interactions` publicly select Mystery difficulty,
  continue through wave 2, and fail closed unless the replica records the exact Stormglass successor
  `ME_PRESENT:w2:t0` followed by a completed paired Mystery terminal on a later wave.
- Full co-op gate `30866276318` is running on exact SHA `de729b901`; 30 of 32 jobs were already green with
  no reds at the latest inspection, leaving only B11 and browser-native WebRTC active.
- Strengthened two-browser journey `30866144196` is running on the same exact SHA. Live heartbeats prove
  fresh-account onboarding, public Settings selection of 10x speed, public lobby pairing, and entry into
  the real Mystery-difficulty setup; it has not yet reached the asserted Stormglass successor.
- Continuous navigation journey `30865215640` remains active on product SHA `f4362888a` and must not be
  cancelled. Live heartbeats show four completed waves and entry into the real wave-5 trainer battle after
  alternating reward ownership; no park, desync, or product error has appeared.
- Exact-candidate animations-enabled surface campaign `30866783630` was dispatched on `de729b901` so final
  presentation qualification runs in parallel without exceeding the 32-runner co-op ceiling.
- TODO: preserve all three browser runs; inspect compact/full artifacts rather than classifying from the
  workflow badge alone; repair only a demonstrated mechanism; then freeze, fast-forward the feature branch,
  and deploy the qualified exact tip to staging only. Production remains forbidden without explicit approval.
- Registered run `30866144196` failed before gameplay with
  `target not in options [youngster,ace,elite,hell]`: the journey requested the staging-only Mystery
  difficulty but its sealed bundle omitted `VITE_DEV_TOOLS=1`. This is a harness build-parity defect, not a
  product or Authority V2 failure. The scoped correction enables that flag only for `registered-interactions`
  and adds a source contract preventing either omission or broad enablement.
- Harness-parity fix `30e962786` is pushed. Replacement exact-SHA registered-interactions run
  `30866998703` is active; preserve it and require its compact artifact to prove the real `mystery` picker,
  Stormglass `ME_PRESENT:w2:t0`, and a later completed Mystery terminal before calling this surface green.
- Full exact-SHA browser matrix `30867124011` is active on `30e962786`: animations-enabled surface, normal
  depth, ten-wave Mystery, and dirty-account profiles. This is the final broad browser qualification candidate;
  do not substitute the older `93ec1f5de` matrix for its verdict.
- Live staging logs `2026-08-04T00-59-15-360Z` (guest) and `00-59-27-025Z` (host), epoch
  `1828663779855824`, proved a product defect in Fun and Games at wave 16: both clients adopted the same
  `ME_PRESENT`/state, but the inline Wobbuffet minigame bypassed `initBattleWithEnemyConfig`, emitted no
  mechanical `ME_TERMINAL("battle")`, and the first `command-open` was correctly rejected behind the stale
  `SHARED_INTERACTION` predecessor. The fix now gives every battle terminal a typed `boot`, commits this
  exceptional surface as `direct-turn`, states the third turn's exact `AWAIT_SUCCESSOR(ME_TERMINAL)`, and
  admits its step-1 `reward-settled` result only from the parked finalizer. ME_PICK remains non-mechanical.
- The same report's guest-only blank battlers maps to an independent presentation readiness gap: ordinary
  NewBiome and Mystery renderer paths could initialize sprite nodes after their earlier asset join and then
  release control while the real atlas was still loading. Those continuations now await
  `settleCoopFieldPresentationReady`; ordinary trainer adoption also conceals premature enemy info panels and
  cannot end its intro until every adopted enemy seat is visually actionable.
- The existing exact-build `registered-interactions` two-browser journey now deterministically forces Fun and
  Games at wave 2 and supplies its paid option through initial-save fixture money. Its terminal assertion
  requires Mystery type 27 to reach wave 3, so the same public keyboard/DOM lane proves party selection, all
  three direct Wobbuffet turns, retained reward settlement, and the successor without adding another runner.
- Focused run `30871406758` never launched Chromium: all owned type/format checks passed, but the new
  release-cutover source contract expected `turnsRemaining` text after the `FUN_AND_GAMES` predicate even
  though the implementation deliberately captured that engine value before constructing the predicate. The
  contract now anchors the actual `mysteryTerminalAfterTurn` declaration and its `turnsRemaining <= 0`
  condition. This is a harness-only correction; the qualified product material remains unchanged.
- Surface artifact `30867124011` proves a separate product ordering bug after a host-owned faint: V2
  replacement revision 3 was already admitted at `materialDeferred`, but the guest drained its live Sticky
  Web/stat prefix before the compatibility checkpoint installed Chikorita, so the stat renderer failed with
  `stat-actor-not-displayed`. The renderer now consults the address-exact pending V2 replacement ledger and
  holds both buffered and newly arriving live hints behind that immutable checkpoint. A failure-first stream
  regression preserves the latency hints and proves only the checkpoint can win their parked race.
- Ordinary guest wild intros had another presentation-only ordering seam: `showInfo()` exposed the bars before
  the adopted object's atlas/sprite readiness was proven. The wild branch now uses the same bounded,
  address-lifetime-fenced `materializeCoopAdoptedEnemyFieldReady` gate as trainers, then reveals the sprite,
  cry, info, and encounter message. This is cosmetic projection only and executes no field setup or mechanics.
- Candidate run `30872650241` stopped before Chromium on exactly two formatter-only diffs in the new runtime
  query/call site. Its owned TypeScript slice was clean (repository baseline 206 unrelated diagnostics). The
  formatter output was applied verbatim; no production behavior or test expectation changed.
- The focused browser build had silently omitted `shadow.ts`, `coop-battle-stream.ts`, `encounter-phase.ts`,
  and the stream regression from its owned static slice. The type diagnostic fence now owns every co-op data
  module plus these encounter/test seams, Biome checks the four exact files, and faint-replacement builds run
  the real battle-stream Vitest regression remotely before Chromium. Future changes to this call chain can no
  longer reach the expensive browser job without first proving the exact race contract.
- Exact staged registered-interactions run `30871894932` reached the real Revival Blessing interaction before
  the forced Wobbuffet event and exposed a different product scheduler race. The guest admitted and projected
  the exact `REVIVAL` commit at global revision 4 from `CoopMoveAnimReplayPhase`; the PARTY watcher visibly
  opened, but the move animation's later completion shifted the newly installed modal out and restored the
  completed replay beneath it. The result was a real PARTY UI with no phase/control owner and a permanent
  `controlDeferred` wait. This is not an ambient address defect: the exact address, payload, and projector all
  succeeded before phase ownership was clobbered.
- The scheduler now identifies the phase requesting a shift. A suspended predecessor's asynchronous terminal
  is recorded without displacing the authoritative modal; when that modal closes, the completed predecessor
  is retired instead of resurrected and the ordered queue advances. Co-op replay phases that previously called
  the manager directly now carry their identity through the same seam. The focused registered-interactions
  build owns the scheduler/replay files and runs the failure-first modal regression remotely before Chromium.
- Navigation-depth run `30865215640` finished red on the older `f4362888a` build after 2h34m. Its already
  preserved predecessor artifact had shown the driver exhausting one party-mutating reward, returning to the
  reward row, then suppressing the new nested target because the second item reused the same V2 address and
  phase identity. The retry path now clears only both reward-related handled appearances (`reward:*` and
  `reward-target:*`), retaining unrelated Mystery/navigation ledgers; a focused node regression guards it.
- Faint-replacement animations-on run `30872915830` remains active on exact SHA `9a1bfd9df` and must not be
  cancelled. It independently qualifies the replacement/live-event ordering and ordinary wild atomic reveal
  fixes while the combined modal/reward-retry candidate is prepared. Production remains untouched.
- Protected navigation run `30865215640` ultimately completed waves 1-29 in one real two-browser session,
  including wave-10/wave-20 Wide Lens purchases under opposite owners, three Crossroads choices, two World
  Maps and new-biome entries, three Mystery encounters, three replacement picks, and the wave-30 boss command
  frontier with identical digest `234058c9cc4713bb`. Its final red is harness-only: four members of the
  opposite seat's party were depleted, leaving both active battlers owned by one surviving seat; the public
  game correctly opened two consecutive CommandPhases for that browser, while the driver permanently removed
  a browser after its first command and waited for an impossible command from the depleted peer.
- The sequential public driver now consumes distinct same-address command surfaces rather than assuming one
  command per browser. It can drive two battlers from one surviving seat, still rejects replaying an append-only
  surface, and requires the ordinary authenticated collection-close proof before marking the depleted browser
  omitted. A failure-first node regression reproduces the exact wave-30 owner partition. No product code was
  changed for this red.
- Combined build `30874099531` passed its owned TypeScript/format slice and stopped before Chromium on one
  source-contract literal: the replacement test still searched for `shiftPhase()` after the production seam
  was deliberately strengthened to `shiftPhase(this)`. The assertion now names the identity-bearing call while
  preserving its original materialize-before-yield ordering check; this is test maintenance, not a new product
  behavior change.
- Exact registered-interactions run `30874955240` proved the modal fix: Revival Blessing completed, replacement
  applied, Stormglass completed, and both clients entered Fun and Games with identical wave-2 state. It then
  exposed a separate single-controller command seam. The host-owned Seel was the only active player battler;
  the guest replayed the full Wobbuffet presentation and installed `COMMAND_FRONTIER`, but its renderer-only
  partner-slot auto-resolve skipped the reciprocal `cmd:2:1` arrival. The host therefore exhausted seven
  retries despite a healthy transport. The scoped fix announces readiness from that replica path only when
  every expected field slot is materialized and none belongs to the local role; an incomplete double field
  remains closed for replacement. Engine-free and source-order regressions cover both sides of that distinction.
- The first spectator predicate in `e549fbcf0` assumed the Wobbuffet minigame changed the battle arrangement to
  capacity one. The captured surface proves the opposite: Fun & Games deliberately retains the two-slot co-op
  arrangement while materializing only its selected host-owned battler. Exact rerun `30877261872` never reached
  gameplay (cold asset proxy exhausted the public LoginPhase wait), so it neither proved nor disproved the
  product change. The predicate now admits exactly one known non-local active owner only when the live Mystery
  explicitly declares the direct-turn `NO_BATTLE` geometry; an ordinary capacity-two field with one missing
  slot still fails closed. The pure regression covers both identical shapes with the declaration toggled.
- Full exact gate `30878504470` exposed one stale source contract in the fast-contract job: it still required
  the old zero-argument `shiftPhase()` signature after the scheduler fix made the completing phase identity
  explicit. The production implementation is correct and the focused scheduler regression is green; the
  exhaustive assertion now proves the stronger invariant that a stale predecessor completion returns before
  it can settle or shift the currently installed authoritative modal.
- The same gate's B/C/P failures all collapsed to one test-harness migration gap before any co-op runtime was
  constructed: every failing test stopped in `TitlePhase`. The shared helpers created a detached
  `SelectStarterPhase` and historically relied on its eventual `end()` to shift whichever phase happened to be
  current. Identity-safe `shiftPhase(this)` correctly rejects that unrelated completion. All detached test/dev
  launchers now use an explicit entrypoint that captures the current phase before asynchronous party/asset
  construction and may advance only that exact phase. Normal SelectStarterPhase execution remains unchanged.
- The migration covers the shared classic/challenge/GameManager launchers, developer scenarios, replay tools,
  the ER player regression, and all detached Showdown test fixtures. The Showdown/tournament production modes
  were not changed. A fast source contract pins the captured-phase entrypoint so future fixtures cannot silently
  restore the old unrelated-phase advancement dependency. The entrypoint captures the owning phase manager as
  well as its current phase before asynchronous construction, so a later global-scene swap cannot redirect the
  completion into another browser/test scene.
- Corrected exact-SHA full co-op gate `30879903358` is running on `de84fa69e`. The superseded gate
  `30878504470` finished with every runtime red rooted before co-op construction in the detached-launcher
  TitlePhase stall, plus the already-corrected import format and stale scheduler source assertion. Preserve the
  focused registered-interactions browser run `30878110322` on gameplay SHA `087be79c2`; it remains the direct
  product proof for the Wobbuffet single-controller rendezvous and must not be cancelled or replaced by the
  headless gate.
- Gate `30879903358`'s fast-contract job found one additional stale test spelling: the learn-move scheduler
  assertion still searched for `successorWasStarted(selectedSuccessor)` after the modal-race fix deliberately
  made `selectedAfterClose` the post-commit identity. The assertion now pins that actual stronger identity;
  running runtime shards remain untouched and continue to qualify the launcher migration.
- The corrected B13 shard then reached its first real replay test and exposed one remaining detached fixture:
  the host-KO presentation test called `CoopReplayTurnPhase.start()` while live `CommandPhase` remained current,
  so identity-safe `end()` correctly refused to shift it and the test observed no faint at all. The test now uses
  its file's existing production-equivalent `replaceWithCoopAuthoritativePhase` replay driver. This is harness
  repair only; captured logs showed production replay queued move/HP/faint/finalize in the correct order.
- Live staging report `2026-08-04T05-24-16-325Z` on `087be79c2` proves the forced Fun and Games battle now
  enters and resolves all three turns, including Wobbuffet faint, Victory/EXP, TURN_COMMIT rev 6, and the
  post-BattleEnd `ME_TERMINAL battle-settled` at rev 7. Both peers ACKed that terminal through
  `controlInstalled`; the authority nevertheless remained in `MysteryEncounterRewardsPhase` with the guest
  waiting for its final terminal. Root cause is the V2 physical-input freeze: the KO callback opens one
  action-only loss narration after the battle handoff, while the existing host-engine narration carve-out
  categorically rejected every handoff-era MESSAGE. The lease now reopens only after the retained active ME
  control is `battle-settled` or `reward-settled`, and the same post-battle text is streamed cosmetically to
  the renderer. Live battle narration still cannot borrow this lease.
- Registered-interactions run `30878110322` independently proves the Wobbuffet spectator rendezvous itself is
  fixed: host and guest converged at `cmd:2:1`, the guest installed its real watcher, and the host exposed an
  actionable `command:fight`. The browser driver then mislabeled that skip-to-fight command as passive because
  its shared-frontier matcher accepted only the root `command:command` surface. The command admission/frontier
  and depleted-seat partition now treat readiness-proven `command:fight` as the same exact addressed command
  owner, allowing the outer campaign loop to drive all three direct turns and reach the newly fixed KO tail.
- Exact-SHA journey `30881554604` caught one browser-entry integration omission before staging: its diagnostic
  lease mirror still called `coopHostEngineDialogueMessageAdvanceAllowed` with the pre-KO signature. The entry
  now imports and supplies the same `coopMePostBattleContinuationActive()` proof as production UI/runtime, so
  the observer cannot disagree with the input gate about the retained Wobbuffet continuation. This is observer
  wiring only; the journey stopped at remote typecheck before building or exercising gameplay.
- Follow-up exact-SHA journey `30882089205` proved the complete owned TypeScript slice clean (206 unrelated
  baseline diagnostics) and stopped only on two deterministic Biome formatting deltas in the new predicate and
  skip-to-fight frontier expression. The source now matches the remote formatter's printed output exactly; no
  gameplay or test mechanism changed in this follow-up.
- Exact-SHA journey `30882318510` again proved the owned TypeScript slice clean and reduced the style-only red
  to Biome relocating the long Wobbuffet authority comment through the boolean chain. The same predicate is now
  expressed as a named `hasNarrationLease` boolean with the authority explanation above it, eliminating the
  formatter ambiguity without changing the admitted states.
- Exact build `1a60ad618` passed the complete journey build/seal static and contract stage, then deployed green
  to staging in run `30882709713`; the canonical staging `version.json` reports that exact SHA. Production was
  not touched. Its registered-interactions two-browser proof is run `30882551464` and remains protected while
  the Wobbuffet KO/loss-narration continuation is exercised through the public UI.
- The old full gate `30879903358` did not reveal another product-authority defect in its between-wave reds. Its
  guest traces show Authority V2 reconstructing the correct wave/field, followed by the HEADLESS-only atlas
  model leaving every newly constructed battler on `pkmn__sub` with no cache or animation entry. The unchanged
  production presentation wall then correctly failed closed. The model previously scanned only Pokemon that
  existed at a phase boundary; an authoritative state transaction can construct and call `loadAssets()` inside
  one continuation, before another scan is possible. The harness now hooks both BattleScene Pokemon-creation
  chokepoints synchronously and refreshes direct abbreviated re-mirrors, while still running the real loader
  before modeling only Phaser's missing HEADLESS cache/live-key effects. A regression creates and loads a fresh
  post-install enemy and requires the exact texture, animation, and live sprite key.
- Exact public-UI run `30882551464` is green on staging SHA `1a60ad618`: Mystery type 27 was driven by its
  assigned guest owner through the embedded battle and retained post-KO narration, the reward surface opened,
  and both Chromium clients reached the next Mystery frontier on wave 3. This is the human-equivalent proof
  that the live Wobbuffet KO continuation no longer parks either client after `battle-settled`.
- Gate `30883819101` qualified every runtime shard except B9 after the HEADLESS creation-hook repair; prior B5,
  C1, C3, B10, and P1 Title/atlas failures are green. B9 is a test clock bug: it started the asynchronous
  authoritative Mystery presentation and immediately asserted field seating, before the production atlas wall
  could resolve. The regression now waits for the actual `TurnInitPhase` actionability boundary and retains all
  field/container/sprite/info-bar assertions. The other red was the already-corrected static import/unused-arg
  pair; neither red demonstrates a production defect.
- Corrected gate `30884814489` is green on exact SHA `1d1ec0adb`: all 33 jobs passed, including every
  deterministic Authority V2 shard, mutation assurance, browser-native WebRTC/rejoin, and static contracts.
- The final animations-enabled registered-interactions run `30885322016` reached the wave-2 Fun and Games
  battle with both sprites present and both engines progressing through turn 2, but the browser driver waited
  for an impossible second turn-1 command owner. The authority's one `CommandPhase` emitted `command:command`
  and then `command:fight` with the same exact address and `phaseInstance=53`; the append-only scanner counted
  those two views of one menu as two battler commands. The driver now identities a decision by browser, exact
  address, and runtime phase instance, retires same-instance submenu aliases, and preserves two real same-seat
  battler commands because their phase instances differ. A failure-first pure regression reproduces the exact
  animation-on ordering and requires the alias to be retired before the final-owner presentation proof.
- Corrected animations-enabled run `30888258354` proves the command alias repair: both browsers completed the
  animated wave-1 turns, faint replacement, Revival, and reward. At the wave-2 Fun and Games encounter both
  clients had aborted their boot request for `biome-bgm-loop-points.json`; the host later changed music and
  dereferenced the still-uninitialized `town` entry, throwing from encounter presentation. The enclosing host
  transaction then reset only that browser to Title while its guest remained in `NewBattlePhase`. Biome music
  metadata is now initialized to an empty map, resolved through a finite zero fallback, and its optional fetch
  rejection is contained. The same transaction catch now uses the retained shared terminal for authoritative
  sessions instead of ever abandoning a peer through a host-only reset. Focused data and wiring regressions pin
  both halves; the exact SHA still requires remote gate and animations-enabled browser requalification.
- Full exact-SHA gate `30913821192` is green on `2bbe3c3b1` across all 32 jobs. Its animations-enabled
  registered-interactions requalification `30913823828` was cancelled externally at 14:05 while both clients
  were healthy in the wave-2 Wobbuffet battle (heartbeats 200, wave 1 already complete). Its build/static stage
  was green and both diagnostic artifacts are preserved under `.artifacts-registered-30913823828-cancelled`;
  the cancellation is infrastructure/process evidence, not a product verdict.
- Paired staging logs `2026-08-04T13-38-57-460Z` / `13-38-59-075Z` show Greater Ability Randomizer itself
  committed identically and advanced both parties. The reported blank player side followed a Check Team
  `REORDER [2,0]`: the owner removed the old lead before the promoted battler's atlas completed, while the
  watcher changed only its party array and never reconciled the field. The shared presentation projector now
  loads every promoted active battler behind the still-visible old field, then atomically hides stale objects
  and exposes the exact party-front field on both clients without replaying summon mechanics.
- The same nested return exposed a broader cursor weakness: relative `uiInput` replay cannot converge accounts
  with different `shopCursorTarget` preferences and cannot repair a watcher left on the top reward screen while
  the owner visits Check Team. The cosmetic FIFO now carries an absolute ModifierSelect cursor checkpoint after
  every real handler (re)install, retrying until both owner capture and watcher application are actionable. It
  remains presentation-only; authoritative choices and mutations still use retained interaction commits.
- The Greater Ability Randomizer two-browser profile now must drive the exact public path through ordinary keys:
  reward action row -> Check Team -> Move slot 0 -> swap with slot 2 -> prove identical party order and fully
  visible active sprites/info bars on both clients -> return -> prove the watcher received the owner's absolute
  reward cursor. The previous journey selected only the reward and therefore could not catch either live defect.
- Exact-SHA co-op gate `30920221918` is green across all 32 jobs at `46242a915`. The first animations-on
  Greater Randomizer journey `30921224449` never launched Chromium: its stricter owned-file check found format
  drift plus Biome's static cycle detector retaining the deferred UI -> field-projector edge. The behavior gate
  had already proven the deferred import was runtime-safe, but the dependency graph is now structurally clean as
  well: a type-only one-way party-reorder presentation registry separates UI callers from Pokemon presentation
  classes, and the ordinary field-presentation module installs the concrete projector before reward handling.
- Parallel exact-SHA requalification at `f9e0c697d` (`30921736586` gate, `30921739860` journey) proved the cycle
  diagnostics were gone. Both static jobs stopped only on Biome's safe import-order assist in the two registry
  callers; Chromium again did not launch. The imports are now canonically ordered. The already-running gate
  shards remain valid behavioral evidence because this final correction changes import order only.
- Exact-SHA animations-on run `30922386512` reached the newly representative Greater Randomizer Check Team
  reorder and failed on the original blank-field symptom rather than passing a party-array proxy. Both clients
  mechanically adopted `[bench, guest lead, old lead, bench]`, but the watcher carrier marked only the unchanged
  guest lead as presented. The owner had started the asynchronous promoted-atlas settle and immediately
  published the V2 CHECK result; capture therefore observed the promoted lead as not yet on field. The watcher
  correctly applied that immutable presentation bit, skipped mechanical replay in projection-only mode, and
  retained one visible battler indefinitely. The owner now blocks further PARTY input and defers publishing the
  CHECK result until the promoted field is actually ready under the phase-owned runtime. The watcher also runs
  the same readiness projector after DATA application and withholds `controlInstalled` until the exact active
  sprites and info bars exist. A failure-first projection-only regression models DATA-first party permutation,
  delayed atlas completion, old-field retention, and final exact field replacement.
- The first exact rerun at `eb1718da0` stopped before Chromium on one unused local caught by the owned-file
  formatter. Corrected SHA `ba30d35f6` passed the full bundle/static and focused reorder preflight; real-browser
  run `30926493613` is the authoritative animations-on Check Team proof and must not be replaced by the earlier
  matrix-dispatch failure `30925644568`, whose build was green but whose journey job was never created.
- Paired browser artifacts and the latest staging logs expose a separate guest-only trainer asymmetry: the host
  executes `ReturnPhase -> ShowTrainerPhase -> NextEncounterPhase`, while the signed V2 renderer went directly
  to `NextEncounterPhase` and the guest branch of `ShowTrainerPhase` explicitly hid the trainer. The signed
  destination tail now queues a presentation-authorized trainer phase before trainer/ME/new-biome encounters.
  That phase hides only Pokemon sprite/info layers (mechanical field membership and checksum stay intact),
  renders the normal trainer tween, and leaves the authoritative encounter projector to reveal the destination
  field. Unsigned/stale guest trainer phases remain fail-closed. New CI-only positive evidence requires this cue
  plus enemy-trainer intro and victory presentation on both real browsers; final-hidden cleanup alone no longer
  qualifies the lifecycle.

2026-08-09 - Fun Mode staging checkpoint

- Added a standalone Fun Mode configuration screen with independent Pokemon, type, ability, and level-up move randomizers. Runs use Youngster cadence, skip difficulty selection, and grant no Favor, candy multipliers, or vouchers.
- Randomized per-Pokemon state is deterministic from Pokemon identity so saves and battle reconstruction retain the same types, abilities, innates, and learnset. Random encounters use the full starter-safe species/form pool and bypass the BST clamp only when the Pokemon randomizer is enabled.
- Implemented Klutz item suppression and adjacent-ally Symbiosis transfer. Removed stale `(N)` markers from Klutz, Symbiosis, Overzealous, Sunstrike, and Tempest Storm, and aligned their displayed descriptions with runtime behavior.
- Verification: Fun Mode suite 11/11, Klutz/Symbiosis focused integration scenarios green, ability-overhaul suite 25/25, targeted TypeScript diagnostics clear, full Vite build green, and staging deploy `31290756176` green at `a578bf5f7`.
- Visual harness: desktop and 390x844 mobile layouts are non-overlapping; toggles, START, direct starter-select flow, and return-to-config behavior work; no browser console errors were emitted. Production remains untouched.

2026-08-09 - Fun Mega Mode staging checkpoint (UI revision pending approval)

- Added Mega Mode and Stat Shuffle toggles plus a one-time pre-wave-1 party ability review/reroll screen.
- Mega Stone metadata now derives each stone's stat delta from its real source and target Mega forms. Species with real Megas use only their compatible form; species without one receive a saved, temporary pseudo-Mega record that preserves their sprite and abilities while applying the stone delta.
- Stat Shuffle applies to every Pokemon whenever selected and preserves that Pokemon's BST. When a Pokemon is real- or pseudo-Mega'd, the shuffle runs after the Mega statline is established, so it redistributes the full effective Mega BST rather than the pre-Mega stats.
- Pseudo-Megas expose `isMega()`, save/load through `CustomPokemonData`, and show a compact gold `M` marker beside their name in battle info, party, and summary UI.
- Mega Mode starts with a Mega Bracelet, puts all available Mega Stones in the Ultra reward generator, suppresses the Rogue stone generator, increases stone frequency, and ramps generated enemy Megas from 8% on wave 1 to 100% from wave 50.
- Every Mega Stone reward/item description previews its source-to-Mega transition and all six stat deltas. The pseudo-Mega applies that delta only after the stone is assigned; Stat Shuffle then redistributes the already-effective Mega statline without changing its BST.
- Verification after the Stat Shuffle correction: focused Fun Mode suite 17/17, no targeted TypeScript diagnostics, Biome has informational complexity notices only, and the full Vite production build is green. The repository-wide typecheck still has unrelated baseline failures outside the touched files.
- UI approval gate: three selector/reroll directions are saved under `C:\Users\Hafida\Desktop\Fun Mode UI Options`. Do not treat the compact reroll layout as approved or deploy its revision until one option is selected. Production remains forbidden.
- UI process rule: for new player-facing screens, prepare multiple labeled visual options on the Desktop for owner approval before locking in or deploying the layout; continue non-visual implementation and testing in parallel.
- Exact staging artifact: `5a92e90a76586fb7c122ce23748abe7566606256`, deploy run `31333105827`. Topic branch only; production and `feat/elite-redux-port` remain untouched.

2026-08-09 - Fun Mode UI continuation

- Fun Mode's modifier selector now follows the Challenge Mode presentation and controls: 60/40 list/detail split, matching boolean arrows, orange description text, matching START bar/cursor, and a header `Last Setup` button.
- Last Setup is saved per account when a Fun Mode run starts. It restores all six modifier choices and deliberately resets the ability-reroll seed instead of silently restoring a previous randomized party result.
- The ability review no longer hides descriptions behind Pokemon selection. Its two-column/six-card layout renders every party member's active ability, three innates, and all 24 short descriptions at once; only `REROLL ALL` and `START RUN` receive input focus.
- Alternative all-description layouts are saved under `C:\Users\Hafida\Desktop\Fun Mode UI Options v2`. The implemented baseline is the refined two-column Option A requested by the owner; visual iteration can continue without reverting the persistence or input work.
- Verification: focused Fun Mode suite 18/18, touched-file TypeScript diagnostics clear, Biome clean except one pre-existing informational notice in `src/utils/data.ts`, and the full Vite production build is green. Staging canvas verification remains required before promotion; production remains forbidden.

2026-08-09 - Fun Mode refined ability review

- Replaced the interim card layout with the selected refined Option C: no title/header band, six compact full-width Pokemon rows, four always-visible ability columns per row, and smaller `REROLL ALL` / `START` controls.
- Each Pokemon now receives six distinct deterministic randomized abilities. Slots 0-2 are three independently randomized choice abilities and slots 3-5 are three independently randomized innates; `REROLL ALL` regenerates the complete six-slot set.
- A selected Pokemon shows a compact `R A1/3` indicator. `R` cycles that Pokemon's active choice ability, while every current ability name and description remains visible for the full party.
- Long descriptions are word-safe paginated and rotate automatically every 2.8 seconds with dynamic text sizing, preventing them from overflowing their ability column.
- Verification: focused Fun Mode suite 18/18, including six-slot uniqueness and reroll stability; touched-file TypeScript diagnostics clear; `git diff --check` clean; full Vite production build green. Production remains forbidden.
- Exact staging artifact: `a4361d4422865fd5ade18a2a05fb9d432434cbf1`, deploy run `31336966322`. Live Phaser verification covered the Challenge-style selector, three-Pokemon ability review, `R` choice cycling, timed long-description paging, complete reroll, and continuation into the run without layout overlap or Fun Mode UI exceptions. The static A/B/C comparison images remain under `C:\Users\Hafida\Desktop\Fun Mode UI Options v2`; the live staging pass was inspected directly in the browser harness. The shared feature branch and production remain untouched.

2026-08-10 - Fun Mode modifier continuation (ability UI approval still blocked)

- The live Option C at staging artifact `a4361d4422865fd5ade18a2a05fb9d432434cbf1` was explicitly rejected: its source text rendered unreadably small and the three-Pokemon case left most of the screen unused. It is not approved. No replacement ability-review layout has been added to the game diff or deployed.
- Added four independent, composable Fun Mode modifiers: Evolution Shuffle, Item Chaos, Weather Roulette, and Move Scrambler. Last Setup accepts legacy six-toggle saves and initializes every newer toggle to off.
- Evolution Shuffle preserves each original evolution trigger and timing, but deterministically replaces the result with a starter-safe random species/form. Generated enemies use the same shuffled evolution result once their normal evolution threshold succeeds.
- Item Chaos gives every eligible reward tier and item equal weight, suppresses luck-based tier upgrades, applies the same equal weighting to enemy held-item pools, and guarantees at least one random held item per generated enemy. Explicit scripted/guaranteed rewards remain explicit.
- Weather Roulette rerolls clear or a supported normal/Elite Redux weather at every encounter. Move Scrambler replaces the successfully used move slot after resolution for player and enemy Pokemon, excludes unavailable moves and duplicates, resets PP state, and does not fire on charge setup or virtual follow-up uses.
- Updated the Challenge-style Fun Mode selector to scroll ten independent toggles while retaining the Last Setup and Start controls. The ability-review UI remains untouched pending visual approval.
- New three- and six-starter layout mockups are saved under `C:\Users\Hafida\Desktop\Fun Mode UI Options v3`. They are review images only. C1 adapts from three spacious rows to six compact full-width rows; C2 demonstrates the smaller two-column tradeoff.
- Verification: focused Fun Mode suite 22/22; no touched-file TypeScript diagnostics (repository-wide typecheck still has unrelated baseline failures); `git diff --check` clean; full Vite development build green. No staging or production deployment was made from this continuation, and `feat/elite-redux-port` remains untouched.

2026-08-10 - Fun Mode adaptive ability review and Mega presentation

- Replaced the rejected fixed six-row ability review with the approved C1 adaptive layout. One to three starters use three spacious rows; four, five, and six starters progressively use 40-, 32-, and 27-pixel rows. Icon scale, name width, typography, wrapping, description page length, dividers, and cursor bounds change as one density so every ability and description remains visible without shrinking to unreadable text.
- Mega Mode's Ultra reward generator now includes every registered Mega Stone. Stones matching a real Mega in the current party receive four entries in the weighted pool while every other stone retains one entry, so compatible stones are preferred without excluding unusual pseudo-Mega templates.
- An unmatched stone may now grant a stat-only pseudo-Mega to any non-Mega Pokemon, including a species that has a different real Mega. A matching stone still selects the actual Mega form. The saved pseudo-Mega record, effective-Mega Stat Shuffle order, and single-stone-per-Pokemon rule are unchanged.
- Replaced the placeholder gold `M` with a transparent gold Mega emblem in battle info, party slots, and summary. The emblem lives in `Heraklines/er-assets` commit `2e3a97169` so staging can pin it without changing production's current immutable asset SHA.
- Added one shared six-stat delta panel for Mega Stone rewards and summary item hover. It names the source and target form, displays exact signed deltas, and draws positive/negative bars around a common baseline. Ordinary runs retain their existing item-description behavior.
- Verification: focused Fun Mode suite 22/22 and standalone Cloudflare payload build green. Repository-wide typecheck remains red only on unrelated baseline terrain/vendor/test errors and reports no touched-file error. Production remains forbidden.

2026-08-10 - Ability Avalanche and final Mega presentation correction

- Ability Avalanche preserves the normal active ability plus all three base innate slots. Its first randomized extra is explicitly `Ability 5` at wave 60, followed by Ability 6/7/etc. every 20 waves; extras are deterministic, duplicate-free, and apply to player, wild, and trainer Pokemon.
- Summary and in-battle Info now use the same focus contract: Confirm enters the ability list, Up/Down scroll only while focused, and Cancel exits list focus. Outside list focus, Up/Down retain their existing Pokemon-switching behavior. A second Confirm in Summary opens the selected ability's long description.
- Both screens reserve a separate control strip with scroll arrows/ranges, so the controls never overlap ability descriptions. The initial Summary frame visibly contains the active ability, all three base innates, and Ability 5; scrolled frames visibly reach Ability 6 and later slots.
- Battle Info always keeps its graphics fallback beneath streamed ROM art, preventing partial/blank panels when a player opens or scrolls the list while assets are still settling.
- Corrected the prior Mega note: the final transparent Mega Evolution emblem is in `Heraklines/er-assets` feature commit `31c2642a4`. The rejected separate stat panel was removed; reward, summary-item, and battle-item Mega deltas extend the native item description instead.
- Verification: Fun Mode/Avalanche logic 24/24; focused Biome error gate and `git diff --check` green; final nine-recipe Fun Mega/Avalanche visual regression batch green, including initial/focused Summary and Battle Info states. Fresh screenshots are under `C:\Users\Hafida\Desktop\Fun Mode UI Preview`. No staging or production deployment was made, and `feat/elite-redux-port` remains untouched.

2026-08-10 - Fun Mode selector parity and Weather Chaos correction

- Corrected the selector's premature seven-row scroll limit to the same nine-row budget as Challenge Mode, eliminating the unused lower-left space. Small pixel arrows now independently indicate whether earlier or later modifiers remain off-screen.
- Added Challenge Mode's saved-setup behavior to the START region: LEFT/RIGHT switches between START and Reuse Last Setup, Confirm applies the selected action, and Cancel returns from the header/START focus to the modifier list. The existing header Last Setup shortcut remains account-specific.
- Renamed Weather Roulette to Weather Chaos and changed its player-facing description to `Every encounter begins with random weather/terrain, including clear weather.` The behavior now independently rolls every supported weather (including clear) and terrain (including no terrain) at biome entry and between encounters in the same biome.
- Production remains forbidden. Deploy only the isolated Fun Mode branch to staging, with the co-op signaling Worker disabled.

2026-08-11 - Moody Mode implementation and visual closure

- Normal staging and production remain forbidden. No deployment was made. The only allowed publication target remains a separate isolated Moody preview with co-op signaling disabled.
- The catalog contains 100 boons and 30 curses. All 30 curses and 99 boons are executable through production-reachable adapters with deterministic event, choice, lifecycle, combat, progression, and save/load coverage.
- Set Collector is the sole deliberate exception: its source specification explicitly blocks release until the item-and-vitamin catalogue is audited and sensible sets are authored. It remains fail-closed and cannot be drafted; a regression pins that boundary so invented generic sets cannot silently ship.
- Recruiter's Eye generates durable encounter-scoped ability, egg-move, and nature traits; capture odds and post-capture ownership commit through AttemptCapturePhase. Bounty contracts, Recycler, Warranty, Contraband, Blood Market alternatives, formation/field timed effects, Feedback Loop accounting, Apex segments, and coordinator choices are wired through their live producers and consumers.
- Moody UI now covers boon lifecycle choice, dense Ledger, party/summary attachments, enemy ability overflow, battle HUD progress, contextual choice/target queues, biome reports, Borrowed Future, Bounty, Recycler, Legacy, Blood Market, Pressure, item stacks, and run recap. Desktop and mobile captures cover all 17 surfaces.
- Synthetic Kimi K3 visual review identified three blocking layout defects. Boon description pagination now reserves a whole-line pager gutter, Ledger title/tabs/footer no longer collide, and the party state summary no longer overlaps Cancel. All three were recaptured and verified on desktop and mobile.
- Final deterministic evidence: core suite 15/15 files and 489/489 tests; field suite 3/3 files and 192/192 tests; Phaser/UI suite 8/8 files and 50/50 tests. The final Vite development bundle built 3,583 modules and minified 14,365 JSON files successfully.
- Repository-wide TypeScript remains red only on unrelated baseline files and produced no Moody/touched-file diagnostic. Scoped formatting and `git diff --check` are required to remain green before committing or publishing the isolated preview.
- Isolated preview publication completed at `https://elite-redux-moody.pages.dev/`. It is a new Cloudflare Pages project, uses staging save/telemetry endpoints, has Showdown/tournaments disabled, and points co-op at a non-routable origin. Neither normal staging nor production was deployed.
- The preview bundle is pinned to immutable `er-assets` SHA `478de96ef00e8edd2955003c66bbef4b02d63d1e`. A fresh deployed-browser smoke pass reached the Phaser canvas at desktop size with zero failed or HTTP 4xx/5xx asset requests; direct checks for the pseudo-Mega emblem and new arena art returned 200.

2026-08-11 - Moody cadence and native UI correction

- Corrected the run cadence: the opening presents three boons first and attaches one deterministic Dread I curse only after the chosen boon commits. Every later ten-wave boon draft attaches one new non-repeating random curse, with Dread II/III weight increasing by wave.
- Both the opening draft and recurring draft now share an exactly-once completion path. A successful selection or a rejected UI transition commits the curse and advances the run/phase once, removing the former curse-first black-screen route.
- Removed the permanent battle overlay. Battle now defaults to a compact left-edge `MOOD` tab that expands on left navigation or touch; the complete inspection surface remains the Summary `MOOD` page and Ledger.
- Party effects use the native active/benched slot silhouette as a one-pixel rarity-colored outline plus compact color pips. The outline follows each sprite's chamfered corners; pip text was removed after visual testing proved pixel-font glyphs could obscure the card.
- Battler-specific Moody state is marked beside the native name icons. Barrier is rendered as a white terminal segment inside the existing HP bar instead of a separate panel. Automatic biome reports and Final Draft choices use compact contextual surfaces.
- Desktop and 390x844 captures were reviewed twice with Synthetic Kimi K3. The final pass found no blocker in the native party outline/pips, Summary detail view, expanded battle panel, or collapsed battle default.
- Verification: focused cadence/UI suite 27/27; complete Moody suite 25 files and 572/572 tests; Frostbound's state-only runtime regression 18/18; touched-file TypeScript diagnostics clear; direct scoped Biome check and `git diff --check` green. Normal staging and production remain forbidden; publication is limited to the isolated Moody preview.
- Isolated preview deployment `2707aecc` is live at `https://elite-redux-moody.pages.dev/`, built from game commit `1b1694cb0` with the immutable assets pin, staging save/telemetry endpoints, disabled co-op origin, and Showdown/tournaments disabled. The canonical domain serves the exact built entry bundle and a deployed-browser smoke reached the 1920x1080 Phaser canvas with no failed requests.
- Removed the oversized party-card overflow text and the redundant selected Pokemon name from the Moody detail box. The box now lists four exact boon/curse/runtime labels plus a compact remaining count; desktop/mobile harness captures verify the native card markers and single-line detail layout. Barrier geometry is explicitly tested as a terminal HP-bar segment sized by `barrier / maxHp` and clamped to current HP; its final pale-cyan base, diagonal cyan shield hatch, and solid leading cap visually separate it from both green HP and the empty white track.

2026-08-11 - Moody progression clarity and trainer parity

- Rank-up cards now show the current and next ranks as a compact arrow plus only the exact upgrade delta. They no longer repeat the full previous-rank description.
- Mithridatism now exposes exact cure progress and thresholds in player-facing UI. Resistance I activates after three cures at 50% prevention; Resistance II activates after six cures at 75%, and Weaponized displays its exact +25% damage and 20% damage-reduction effects while afflicted.
- Fixed the live Mithridatism formation adapter to apply the documented 50%/75% prevention tiers. Internal serialized tracker keys are filtered from every player-facing progress list.
- Trainer boon generation now spends the same number of boon acquisition points as the player and cannot waste a point by rolling an already max-rank boon. Trainers remain curse-free. Their actual boon loadout, rank, target, description, and accumulated power are available from a mirrored right-side battle drawer.
- The player and trainer battle drawers use shared keyboard, controller, and pointer input, include scrolling indicators, and reposition between the opposing health stacks in triple battles. The post-draft curse report displays the exact curse and requires confirmation before play resumes.
- Party layout and its selected-effect panel now adapt to the actual party size and visible progress volume. Counter-based boons, including Mithridatism, show their current counts and next threshold.
- Verification: focused Moody logic/UI suite 5 files and 264/264 tests; scoped formatting and `git diff --check` green; standalone Cloudflare payload build green with 1,735 files. Synthetic Kimi K3 visual review was completed; the final pass corrected the curse dialog's fixed-height dead space, widened battle-drawer wrapping to the actual panel bounds, and strengthened its scroll indicator. Normal staging and production remain forbidden; publication is limited to the isolated Moody preview.
- Isolated preview deployment `e8043048` is live at `https://elite-redux-moody.pages.dev/` from game commit `a962c5ded`. Canonical and deployment URLs serve the final bundle, and the deployed asset redirects were directly verified against immutable `er-assets` SHA `478de96ef00e8edd2955003c66bbef4b02d63d1e`.

2026-08-11 - Moody draft transition regression

- Root cause of the post-boon black screen: both opening and recurring boon drafts were destructively opened with `setMode`, while the picker closes through `revertMode`. That left no prior UI mode in the chain, so the mandatory curse receipt restored a dead/full-screen draft owner instead of the battle or starter surface.
- Both draft entry points now use `setOverlayMode`, matching the picker and curse report close contract. Focused Moody surface tests pass 14/14. No site was deployed.

2026-08-11 - Moody trainer-effect flyouts and pre-battle guard

- Boon and curse activations now reuse the native ability-bar lane with a violet trainer-owned treatment: a compact `TRAINER BOON`/`TRAINER CURSE` label, exact effect name, accent line, and a cropped upper-trainer portrait contained inside the bar. Long names scale and truncate within the existing bar width; no new persistent battle overlay was added.
- Every one of the 100 boons and 30 curses has an explicit `flyout` or `drawer-only` policy. Runtime and formation adapters emit structured player/enemy cues, while passive/economy effects remain in the Ledger/drawers. Display Settings exposes `Boon & Curse Trigger Banners`, defaulting to On.
- An occupied ability bar is hidden before the trainer effect is retried, preserving the shared presentation lane without overlapping or looping banners. Dedicated boon and curse dev scenarios cover the visual treatment.
- Fixed a second opening-run black-screen source: pre-battle stat queries could dereference `currentBattle` before EncounterPhase created it. The runtime battle key now returns a deterministic `prebattle` sentinel, with a regression proving speed lookup is neutral before a battle exists.
- Live Phaser verification reached combat from the Fun selector and displayed the violet Mithridatism trainer banner after the opening switch prompt and move commitment. The complete focused gate passed 5 files and 226/226 tests; the local production build compiled 3,584 modules and minified 14,365 JSON files successfully.
- No normal staging, isolated preview, Cloudflare Worker, asset host, or production deployment was performed for this work.

2026-08-11 - Moody inspection, persistence, lead enforcement, and trainer banner closure

- Replaced the battle drawer's debug-oriented output with a names-first accordion: player boons precede curses, the enemy drawer lists boons only, Confirm expands exactly one selected entry, and internal progress IDs plus recent-trigger history are no longer player-facing. Expanded entries retain human-readable counters, thresholds, stacks, and effect values.
- Restless Lead now validates the selected lead against the previous battle's persistent lead, records valid selections immediately, and automatically moves the first conscious reserve into lead when the repeated lead is invalid. The replacement is recorded through the same event path, preventing the curse from becoming a no-op on the next battle.
- Underdog Dividend now uses the live party-average level in both its description and runtime calculation. Its UI states the exact five-level threshold, +2% per-level five-stat scaling, caps, XP multipliers, and unevolved multiplier.
- Borrowed Future is trainer-battle-only, shows each active opposing lead and its committed move in a compact top strip, and delegates lead changes to the native party reorder screen. Only active lead slots can initiate replacement, the forecast is hidden while reordering, and the player can begin or leave the reorder screen without becoming trapped.
- Confirmed save/reload persistence for committed boon ranks/evolutions/targets, curse state, counters/flags/values, dormancy, formation state, and persistent field values such as Restless Lead's previous lead. The round-trip regression compares the complete serialized Moody payload after restore.
- Trainer-owned boon/curse cues reuse the native ability flyout with the approved violet treatment and no redundant TRAINER BOON/CURSE text. The player portrait path remains unchanged. Enemy portraits scan the original untrimmed atlas dimensions, preserve the full horizontal sprite, display the actual upper half, clear inherited tint/flip state, sit after the title, and align their cut edge to the visible banner boundary.
- Runtime ownership remains complete for all 30 curses and 99 releasable boons. Set Collector is still the sole fail-closed exception and remains excluded from drafting until its curated set catalogue is authored.
- Verification: engine-neutral Moody gate 15/15 files and 514/514 tests; field gate 3/3 files and 198/198 tests; Phaser/UI gate 9/9 files and 56/56 tests. Repository-wide TypeScript still exits on unrelated baseline failures and reports no diagnostic in any touched file. Normal staging and production remain forbidden; publication is limited to the isolated Moody preview.

2026-08-11 - Full Mix, trigger noise, and telemetry controls

- Added Full Mix as the second Mega Mode variant. Pseudo-Mega stones can now apply their stat delta alone or additionally contribute one non-duplicate Mega type and replace innate slots one and three with the selected Mega template's corresponding innates. Proper Mega evolutions retain their authored forms.
- Summary Stats Confirm now cycles through calculated stats, IVs, and the effective six-stat base spread. The base-spread view deliberately reuses the native stat rows without an oversized BST heading.
- Continuous Moody effects are drawer-only. Trigger flyouts are restricted to discrete combat events, and Type Tax no longer emits a false trigger when the acting Pokemon has no duplicated type.
- Added a general `build:standalone:no-telemetry` target. Staging and production deploy workflows now expose a default-on `collect_player_training_data` switch; disabling it sets only `VITE_TELEMETRY=off` and leaves save, tournament, Showdown, and matchmaking endpoints intact.
- Moody remains unpromoted until integration verification completes. No normal staging or production deployment was performed.

2026-08-12 - Player-training telemetry removal and Moody performance follow-up

- Removed every runtime integration for the recently added player-training telemetry: startup initialization, command snapshots, joint-action capture, turn/battle/run outcomes, capture/run events, session teardown, and raw UI input/surface/choice emitters. The telemetry implementation files remain dormant for reversibility, while tournament, matchmaking, save, and existing Showdown control-plane behavior remain intact.
- Reduced Rest Cycle to 5% HP and 1 PP at base and 10% at rank II, with matching player-facing descriptions.
- Corrected boon draft composition: before the 12-boon cap, upgrades now occupy about 30% of offer slots, no draft can become three upgrades, and one draft cannot repeat the same boon. At the cap, distinct rank-up offers fill the draft.
- Made Moody trigger banners use fixed wall-clock entrance and hold times, so high game speed no longer makes them disappear immediately.
- Decoupled Shiny Lab battle refresh cadence from game speed and reduced CPU refresh frequency as active battler count grows. This is a separate older performance improvement, not the identified recent telemetry regression.
- Verification: targeted Moody/Shiny tests 201/201 green; final standalone no-telemetry build and Cloudflare payload validation green; scoped Biome exits clean with baseline warnings only; `git diff --check` green. No staging or production deployment was performed.

2026-08-12 - Moody/Fun integration release gate

- Fixed Overflow Ward at full HP. Healing phases now preserve the requested overheal event only when an applicable Overflow Ward, Overflow Doctrine, or Shared Cup effect is active, allowing shield conversion without changing ordinary full-HP healing behavior.
- Fixed Bastion Seat's first-entry detection. It now uses a battle-scoped per-Pokemon entry mark rather than move history retained from previous battles, so the opening barrier is granted exactly once even when the battler has already acted in an earlier encounter.
- Fixed the Fun Mode return-to-title input lock. Leaving the selector now performs a one-way TitlePhase handoff and returns immediately instead of refreshing the retired full-screen handler after the title menu owns input.
- The complete integrated Moody/Fun/Shiny gate passes 25/25 files and 597/597 tests. The standalone no-player-training-telemetry build passes with 3,574 transformed modules and a validated 1,731-file Cloudflare Pages payload; scoped Biome formatting and `git diff --check` are green.
- Set Collector remains the sole deliberate Moody content exception and stays excluded from drafting until curated item/vitamin sets are authored. Production remains forbidden; this checkpoint is eligible only for normal staging verification.

2026-08-12 - Triple-battle command profiling

- Confirmed the current staging build has player-training telemetry disabled, so no network or IndexedDB telemetry work runs during turns.
- A real staging log showed the two enemy decisions in a double battle consuming roughly 1.1s and 1.5s on desktop Firefox before move animation. Triples repeat the same KO, switch-matchup, threat, target, and damage simulations for three enemy slots against up to three opponents.
- Wrapped each complete enemy AI decision in the existing synchronous active-ability-source cache. This preserves AI scoring and damage behavior while reusing immutable ability/innate/suppression resolution across the many simulations in that command.
- Removed unconditional move-pool, score-array, sorted-pool, and chosen-move console dumps from the same hot path. They ran for every enemy slot and were multiplied in triples, with additional overhead whenever a browser or the in-game log collector retained console output.
- Remaining secondary rendering risk: multiple animated Shiny Lab battlers still perform CPU texture refreshes, although their cadence was already reduced for multi battles. This was not identified as the recent regression and was left unchanged.
- Verification: the enemy-command behavior suite passes 2/2, 12 current triple regression scenarios pass, scoped Biome and `git diff --check` are clean, and the 3,575-module standalone no-player-training-telemetry build plus 1,731-file Cloudflare payload check passes. Seven old triple fixtures now fail only because they still assume the intentionally forbidden wave-1 wild triple; no assertion reaches the optimized command behavior in those cases.

2026-08-12 - Ability Randomizer review readability and flyout control

- Reworked the startup Ability Randomizer review itself, keeping all six Pokemon and their four current ability slots visible while substantially increasing name, ability, and description text sizes. Long descriptions now page every eight seconds instead of rapidly alternating every 2.8 seconds.
- Added a Display Settings option named `Ability Trigger Banners`, defaulting to On. Turning it Off suppresses native ability flyouts, including Ability Avalanche's large activation sequences, while preserving ability reveals, battle state, and co-op presentation events.
- The authoritative co-op replay path treats a disabled ability banner as an intentional visual skip, reveals the exact ability slot, and settles the event without waiting on a flyout watchdog.
- Captured and visually inspected the real six-Pokemon startup review through the existing game scenario harness at `output/ability-review-final-candidate.png`. No temporary capture route remains in production source.
- Verification: focused ability-flyout behavior passes 2/2, disabled host/guest co-op regressions pass 2/2, scoped Biome and `git diff --check` are clean, and the standalone no-player-training-telemetry build plus Cloudflare payload validation passes.
- Keyboard and gamepad inputs already share the same immediate UI dispatch and repeat interval. No separate controller-delay branch was found; the earlier main-thread triple AI work may improve the reported symptom, but controller latency has not been independently reproduced or signed off with physical gamepad input.
- Nothing was deployed. The UI remains local pending visual approval.
- Follow-up visual pass fixed the startup-review icon geometry: icons now use actual object scaling instead of scale values as origin parameters, are centered slightly right of the screen edge, remain fully visible, and retain a fixed gap before every name. The stable six-Pokemon harness capture verifies the final layout; no deployment was performed.

2026-08-15 - Universal early-wave move-power ramp

- All ordinary damaging moves now use 40% of their fully resolved battle power on wave 1 and scale linearly to 100%. Normal pacing reaches full power on wave 30; Sprint reaches full power on wave 15.
- The multiplier is applied once in the shared move-power calculation, so player attacks, opponent attacks, AI damage forecasts, variable-power moves, ability boosts, and all battle formats use the same deterministic value. Status moves, fixed-damage moves, and one-hit-KO moves retain their existing special paths.
- Pre-battle callers fall back to full power when no current battle exists, avoiding menu/setup regressions.
- Verification: pacing suite 12/12 green; focused headless battle symmetry scenario green for both attack directions at waves 1 and 30; production build green with 3,576 transformed modules and 14,365 minified JSON files; scoped formatting and `git diff --check` green. Repository-wide TypeScript continues to fail on pre-existing unrelated ER diagnostics and reports none in the touched files. Nothing was deployed.

2026-08-15 - Hell and Ghost Trainers snapshot inventory

- In Hell pacing, ordinary trainer encounters after wave 100 in Normal or wave 50 in Sprint deterministically become ghost trainers at an approximately 50% rate. The Ghost Trainers challenge continues to make every eligible trainer encounter a ghost.
- Every ghost source now uses the same inventory rules: held items and relics from the saved ghost snapshot are restored onto the enemy party, then normal encounter additions such as ward stones, resist berries, boss bars, and other generated modifiers remain layered on top.
- Combat-relevant relic behavior is side-aware, so enemy ghost relics affect their owner without granting player relic progression or achievements. Run-economy relic effects remain player-only because a one-battle ghost has no persistent shop, map, egg, or run economy.
- Ghost-held items cannot enter the player's inventory through Thief-style transfer, Trick/Switcheroo, Mini Black Hole, or the shared held-item transfer path. A valid theft instead removes the item from the ghost.
- Added GitHub-runner coverage for Hell Normal/Sprint thresholds and distribution, deterministic selection, additive snapshot inventory and relic restoration, Ghost Trainers challenge coverage, and theft destruction. No deployment was performed.

2026-08-17 - Postgame Endless continuation

- Completing the final boss in any supported run now offers a continuation into Endless without resetting the party, inventory, relics, boons, curses, pacing, difficulty, or run identity. Declining preserves the normal completed-run flow.
- Endless loops the 200-equivalent-wave world cadence while retaining permanent progression. Rift pressure starts immediately, pulses every five Normal waves or three Sprint waves, overlaps at the specified depth cadence, and uses the established curse UI when a Rift is acquired.
- Ordinary trainer encounters are victorious cross-player ghosts with their complete saved held-item and relic snapshots. Normal generated encounter modifiers still layer on top, ghost items cannot be stolen, and attempted theft removes the item instead.
- Ghosts are normalized against the current player party: player-top level parity with the short Youngster/Ace opening offset, plus role-matched vitamin totals redistributed according to each ghost member's own statline.
- Added 50-equivalent-wave raids and the 200-equivalent-wave Primal Cascoon finale, including boss segments, two active minions, reserve entry every second segment break, cleanses, seven-move finale support, and the Endless Avalanche curve.
- Added anonymized, idempotent ghost performance reporting and exact danger weighting. A save-persistent hidden Nemesis relationship can promote dangerous returning ghosts with equipment, boon, donor, replacement, and segment upgrades without exposing account data or adding a player-facing Nemesis label.
- Endless state, active Rifts, battle overlays, routes, Nemesis progression, and encounter accounting serialize with the run. Focused state regressions are delegated to GitHub Actions; no local test execution or deployment was performed.
- Returning Nemeses now scale their saved relic stacks separately from ordinary ghosts: unchanged on the first return, 1.5x on the second and third, and 1.75x from the fourth onward, always bounded by each relic's normal stack cap.
- Removed internal implementation wording from the player-facing Endless Move Scrambler Rift description.

2026-08-17 - Reward-rate panel visibility correction

- Made the compact Shiny/Candy/Voucher multiplier panel an explicit reward-shop opt-in. Ordinary battle and any future non-shop Luck display now force the panel hidden.
- The post-battle modifier selection handler is the only runtime caller that opts into the panel.
- The headless game UI harness rendered both `modifier-select-reward-rates` and `battle-command`: the panel is present in the reward shop and absent from the battle command screen. Both captures passed.
- Nothing was deployed to staging or production.

2026-08-17 - Endless Avalanche visibility, Rift Ledger, and triple presentation hot paths

- Endless keeps its asymmetric guaranteed Ability Avalanche curve: enemies begin with one extra ability immediately after continuation starts while players begin at zero, then each side follows its existing independent depth curve. Battle Info and Summary now classify the actual runtime-added Avalanche ability IDs, so Moody extras, transforms, and black-shiny gifts cannot shift or hide the rows; the existing focus-and-scroll controls expose abilities beyond the four base slots.
- Added a read-only Rift Ledger to the Endless pause menu. It lists every active pressure/mutation Rift, pulses remaining, acquisition depth, hostility, and the full effect description with list scrolling and paged details. The view reads the already-serialized Endless state and is classified local-only for co-op.
- The submitted Endless triple log shows AI decisions completing in roughly 20 ms, but repeated Avalanche pool reconstruction plus 119 missing cry/animation-frame warnings during spread presentation. Endless Avalanche selection is now bounded-cached and returns defensive copies; missing cry and animation frames are skipped before Phaser warning/render work. Battle calculations and AI choices are unchanged.
- Added remote-runner coverage for the opening enemy/player Avalanche asymmetry, cached deterministic selections, Rift display metadata, and a real Rift Ledger render recipe. Local repository tests remain intentionally unrun per maintainer instruction. Browser smoke boot completed; full interaction and visual signoff, GitHub runners, integration, and staging deploy remain pending. Production remains untouched.

2026-08-20 - New Pokemon roster scenario launch repair

- Rebased the five roster showcase scenarios on the proven Endless dev-scenario launch contract: explicit pending starter levels, deterministic Youngster/Normal run settings, and encounter persistence bypass for disposable fixtures.
- Added a focused headless scenario harness that launches each entry through the same `__erLaunchDevScenarioByLabel` hook used by the in-game dev menu and requires the real flow to reach `CommandPhase` with all six level-100 player Pokemon and a live opponent.
- Verification: all five roster scenarios pass the harness. No browser automation was used. Production and co-op remain untouched.

2026-08-21 - N-type player battle-info alignment

- Player battle-info compact/expanded transitions now move pooled type tabs 4+ together with the three fixed tabs. Quadruple, sextuple, and later N-type displays therefore retain the existing paired-column overlap instead of leaving extra tabs eight pixels below the health panel.
- `git diff --check` passes. Staging verification is pending; production remains untouched.

2026-08-21 - Female Mega Alolan Raichu mini icon

- Regenerated the female Mega Alolan Raichu mini icon from its corrected female front-facing source. Its importer entry now explicitly refreshes that derived icon so future source regeneration cannot retain the old male-back-derived frame.
- Asset commit `34275e40` contains only the corrected icon. Production remains untouched.

2026-08-21 - Automatic ER Editor catalog refresh

- Restored the complete form-aware editor catalog/search work and extended the runtime dump to include every registered fakemon-pitch species with stable sprite slugs.
- Added a fail-closed catalog validator covering starter/all-species inclusion, forms, learnsets, TM pools, evolutions, and move/ability references.
- Added an automatic `feat/elite-redux-port` workflow that regenerates all editor catalogs on GitHub runners and deploys only the standalone `er-editor` Cloudflare Pages project with cache revalidation. Game staging and production deployments are not part of this workflow.
