# M9E continuation ledger — current phase runtime

## Source and resource boundary

- Continuation source: `codex/m9e-current-phase-focused-20260910`, not the old
  `arch/rust-kernel-m9-engineering` tip. The published recovery integration
  `wrk/m9e-recovery-20260904-source` (`9fbb9fa`) and current host/browser
  `wrk/m9e-task-current-hosts-browser-20260908` (`d28bdae`) remain input
  evidence, not the working base.
- Faint-score diagnostic `codex/m9e-faint-score-source-20260910` (`c7eb39d`)
  is a divergent sibling to reconcile, not to adopt solely because it is
  greener.
- All compile, test, format, Clippy, browser, Wasm, and simulation work runs
  remotely. This checkout is an editor/control terminal only.
- No production branch or the old published final tag is touched. A corrected
  final tag is created only after integrated acceptance.

## Current drain implementation — repaired source, remote validation pending

The September 12 review found that the prior drain hashed its state before
normalizing control, retained pre-award recipient equality after changing XP,
used absence of a pending presentation as acknowledgement, and bypassed actual
Faint execution. Those paths are being replaced with the previously reviewed,
source-owned phase implementation, reconciled against the green 58-test work.

- Actual Faint prelude binds its animation in the same material. Its exact
  acknowledged animation callback updates status/score and removes the enemy;
  the separately queued faint message completes before friendship and XP.
- The actual KO move is retained from MoveDamage, including explicit pre-action
  exhausted slots for Struggle. Last-PP lookup never uses post-action eligibility.
- Victory.start records pokemonDefeated before friendship; captured XP recipients
  retain their pre-award stats. Content-aware validation verifies actual XP,
  level, HP and stat arithmetic for every represented descendant.
- Typed private acknowledgements survive snapshot restore. Every retained prompt
  must be either pending or actually acknowledged, never missing from both.
- Current Faint/XP material digests are computed after the final control state.
- Doubles mechanics fixtures explicitly carry UnobservedMechanicalFixture history;
  they do not silently claim complete source action history or authorize rewards.

The impossible initial-level learning test is preserved as an uncompiled source
archive. Actual admitted starter learnsets first introduce new groups at level17;
initial cap10 cannot exercise that journey. The reviewed raw XP/restore test and
last-PP/Struggle knockout regressions replace that unsupported claim.

## Honest limits of this increment

The reconciled implementation is not yet qualified. Actual Victory completion,
turn-settlement cleanup, BattleEnd, rewards, next-encounter provenance and actual
save-load prompt reissue still require completion. Complete descendants remain
explicitly unresolved until these effects have owners; no later Move is resumed
merely because XP finished. Source queue cleanup cancels post-victory combat
commands/moves but preserves turn settlement, which must execute once.

The stack-overflow cause is being measured independently without changing stack
size, test concurrency or dropping assertions. Initial encounter-level generation
also remains a separately documented source-fidelity gap (Rust constructor uses
the starter level; source observation included a level2 enemy).

## Acceptance scoreboard

| Row | Meaning | State |
|---|---|---|
| A | Shared current runtime behind all entry points | PARTIAL — native owned-phase drain wired; replay/reload/browser parity pending remote proof |
| B | Natural solo gameplay on production content | IN_FLIGHT — this run is the first drain-capable candidate |
| C | Two-human co-op + long-session liveness | PENDING |
| D | Persistence, external events, exact causal replay | PARTIAL — UTC clock + presentation settlement retained; save/replay coverage pending |
| E | Hot reload + development tooling | PENDING |
| F | Rust-authoritative browser/semantic presentation | PARTIAL — `ExperienceGained`/`LevelUp` payloads added to the semantic catalog |

## Remote runs

| Candidate | Run | Result | Scope |
|---|---|---|---|
| `a8239e7` | `34537007544` | expected red | Stale `snapshot_v7` `after` pin survived into the push; superseded immediately. |
| `557598b` | `34537242979` | red | Pins green; remote rustfmt pages outstanding. |
| `d1c287c` | `34537570526` | red | Formatter pages applied; compile reached; seven ordinary Rust errors in the new owned-phase code. |
| `dd9bdeb` | `34537910951` | red | Compile errors repaired; one residual rustfmt page in `m9e_runtime_v6`. |
| `690ac9a` | `34538090497` | red | `er-repro` test stale: `reference_event` missing the train-added `CurrentUtcClockResult` arm. |
| `4cc683f` | `34538682781` | red | `m9e_current_defender_ability` fixture missing its `Ok(())` tail. |
| `592ab81` | `34538960006` | red | Pin bookkeeping only: `before` pin added for a train-added file absent at BASE. |
| `1d667ed` | `34539242864` | red | All targets compile; `proposal-clippy` fires on train-era code. |
| `23f6599` → `48a58f2` | `34539535673`, `34540028866` | red | `collapsible_if` in `er-state`, `er-battle`, `er-kernel`, `er-game` collapsed; `clone_on_copy` in two kernel witnesses dropped. |
| `ae96d97`, `6814965` | `34540403940`, `34540761967` | red | Same class sweep; clippy then went green. First test execution: both `m9e_current_defender_ability` witnesses fail at bootstrap. |
| `6f11f88` | `34542859467` | red | First reseed cleared the XP-source gate; second gate surfaced: `GameRuntimeV6Error::Action` via `current_source_progression`/`source_ability` whitelist — only species 276 and 915 admit all required abilities. |
| `341360f` | `34579067892` | red | Ledger doc itself is pinned in DELTAS; stale pin check fired. |
| `9aaa2da` | `34579557081` | red | Remote formatter wanted single-line `natural` signatures. |
| `7f26121` | `34580074905` | red | `actual_innate_absorb` green; poison-redirect witness hit `CurrentBattleParticipationError::Unsupported` — participation owner is 1v1-bounded, cannot exist on the (2,2) controlled checkpoint. Dropped to `None`. |
| `3afed27` | `34586258120` | red | `actual_innate_absorb` green; poison-redirect witness reached the turn-order assertion — priority-1 enemy Withdraw steps legitimately act before the player's priority-0 move. |
| `06f1539` | `34587095343` | red | Both `m9e_current_defender_ability` witnesses green; suite advanced to `m9e_current_starter_pokerus`: `picks_retain_their_source_day_through_reentry_and_natural_construction` failed at `construct_natural_run_v6` — seed `daily-owned-natural` draws wave-0 enemy 504 (Lillipup), whose abilities (active 50, passives 148/51/107) are outside the `source_ability` whitelist. Reseeded to `m9e-starter-pokerus-8` → enemy 915 under this file's two-starter draw sequence. |
| `8db8236` | `34589049080` | red | `m9e_current_starter_pokerus` green; suite advanced to `m9e_current_target_execution` (8/9 red). Three causes: `two_enemies` still rebuilt the 1v1-bounded participation owner (`Unsupported`); `natural_raw_turn` executed slot-0 move 61, whose MultiHitAttr has no source hit-count owner (`Internal` via `UnsupportedContent` at execution, not admission); `unsupported_selection`'s forged after-state stripped only `current_targeting`, leaving `participation.experience` present — `GameStateV6::validate` rejects (`Invalid`). Fixes: drop the owner in `two_enemies`, execute slot-1 Tackle, strip the dependent owners (turn/dispatch/tracker/experience) from the forged state and the live prior. |
| `0756988` | `34657294389` | red | Compile only: `active_run_mut` received the snapshot instead of the state in the new `source_spread` HP setup. |
| `05c3074` | `34657563526` | **green** | All 58 whole-target witnesses pass, including `m9e_current_target_execution` (9/9): participation-less (2,2) fixture drives real owned turns (spread, redirect, target-menu, retained-turn), `natural_raw_turn` executes slot-1 Tackle through the owned path, and the forged-material strip reaches `CurrentTargetOwnership` atomically. |
| `3e6e39d` | `34664395911` | red; historical selection | Original coverage extension: six whole targets promoted into the diagnostic — `m9e_coop_v7` (4: raw proposal convergence, all-human command wait, private-party restore, replica save presentation), `m9e_current_phase_execution` (2: knockout→XP-prompt→level-stats drain, learn-move batch retention; reseeded `m9e-target-execution-source-0`→`m9e-phase-execution-18` → wave-0 enemy 276), `m9e_natural_progression_v7` (1: legacy GrantExperience victory payout), `m9e_natural_campaign_v7` (1: policy playthrough to wave-200 terminal), `m9e_natural_coop_campaign_v7` (1: owned co-op campaign to wave-200 victory), `m9e_natural_campaign_replay` (1: every external input replayed, resume to wave 200). Plain `natural_start` paths carry no friendship profile → no presentation/participation/XP owners → wave-0 gates do not bind them; only the fresh-friendship path needed the reseed. Selector gains `-p er-repro`; counts 12→18 targets, 58→68 tests. |

## Wave-0 XP-source coverage limitation (latent train gap, surfaced 2026-09-10)

`construct_natural_run_v6_with_pending_experience` builds a
`CurrentExperienceSourceV1` per wave-0 enemy via
`experience_for_compiled_form(species, pokemon.form_index)`. Wild enemies are
always generated at `form_index = 0`, and the progression pack stores the
species-level XP row at compiled index 0 for species *with* source forms —
`experience_for_compiled_form` deliberately refuses that row
(`ExperienceUnsupported`; "a species row with source forms is ambiguous and
cannot stand for forms[0]"). `CurrentExperienceOwnerV1::validate` additionally
pins `source.compiled_form == pokemon.form_index` and
`source_form == compiled_form - 1`, so a form-0 pokemon of a multi-source-form
species can never be a valid XP source. Consequence: any natural bootstrap whose
seed draws a wave-0 enemy of such a species fails closed at bootstrap.

The tier-0 (time-of-day-agnostic) pool at the CLASSIC starting biome contains 12
species; 19/21/263 are multi-source-form (roughly a quarter of ordinary wave-0
outcomes, before tier fallbacks). This is a real content-coverage gap in the
train's XP model — genuine XP payout parity for those species remains open
(row-B work), and the model was NOT relaxed to hide it. The witnesses instead
use seed values whose deterministic wave-0 draw lands on a supported species.

Seed→species prediction: `er-rng`'s `PhaserRdg` was ported to a Python harness
(exact f64/JS semantics: `sow`, `hash_units`, `rnd`, `frac`,
`integer_in_range`, `pick_index`). The only run-stream draws before the wave-0
species pick are 6 IV draws + 1 nature pick per party starter
(`RngRuntime::from_run_seed` is constructed fresh inside `construct_natural_run_v6`),
then the 512-wide tier roll and the candidate pick. Verified against the two
observed failures (`…-source-0` and `…-source-2` both predicted species 21, a
multi-source-form species, and both failed).

Second bootstrap gate, surfaced by run `34542859467` (`GameRuntimeV6Error::Action`
wrapped as `NaturalRunV6Error::State`): `initialize_source_stats` calls
`current_source_progression`, which re-admits every pokemon's ability sources
through `CurrentTargetExecution::validate_run` + `ability_sources`. Both calls
run `source_ability` on the pokemon's **active** ability and **every** innate
`passives[]` entry — `source_ability` admits only the bounded observed set
{0,18,41,43,47,49,51,62,65,66,67,75,82,94,113,172,192,257,268,5006,5033,5082,5097,5115}.
Combined with the XP-source gate and the party `passive_attr` restriction
(starter species must be 1|4|7 = catalog indices 0/1/2, and
`pokemon.max_hp == pokemon.stats.hp`), the only wave-0 encounter species in the
CLASSIC starting biome that satisfy all three gates are **276 (Taillow)** and
**915 (Lechonk)** — i.e. natural bootstrap is currently proven for exactly two
of the 60+ pool species. This is the real bounded-qualification envelope of the
current train, not a test artifact; broadening it is row-B work.

Witness seeds now decouple the seed string from the starter index:
`natural(content, index, seed)`. Eligible draws:
`"m9e-defender-ability-27"` → 276, `"m9e-defender-ability-28"` → 915,
`"m9e-target-execution-v2-7"` → 915, `"m9e-fresh-friendship-v6"` → 915,
`"m9e-starter-pokerus-8"` → 915 (two-starter draw sequence).

Third bootstrap gate, surfaced by run `34580074905` (`Error: Unsupported` =
`CurrentBattleParticipationError::Unsupported`): `two_enemies`' controlled
doubles checkpoint rebuilt its participation/XP owner via
`CurrentBattleParticipationV1::fresh`, but `validate_at_boundary` structurally
bounds that owner to `player_capacity == 1 && enemy_capacity == 1` — no doubles
battle can ever carry it. The owner is now dropped
(`state.current_battle_participation = None`): participation is opt-in
("absent in the qualified observation-only path"), and the fixture's subject is
defender-ability dispatch, not XP. The dead `reseed_controlled_participation`
helper was removed.

That exposed the owned-path coupling fixed in this push: the battle-turn
dispatch routed to `begin_owned_turn` only when
`experience.execution_origin.is_some()`, and `turn_step_transition`
hard-required a participation owner for `observe_current_chunk`. Both were
relaxed — the owned turn machinery (presentation + targeting owners) is
format-agnostic and now admits participation-less states, while causal
evidence recording stays conditional on the owner's presence. Production
natural constructs always install all three owners together, so this changes
no production path; it only lets controlled owned-capable fixtures (the (2,2)
redirect/spread witnesses) run through the owned pipeline instead of silently
falling back to the one-shot resolver that never populates
`current_defender_dispatch`.

## September 12 repair evidence

| Candidate | Run | Result | Scope |
|---|---|---|---|
| `6e99504` | `34658587781` | green | Ledger-only successor; configured 58 witnesses. |
| `3e6e39d` | `34664395911` | red | 18 targets/68 planned; content4 passed, coop binary aborted with stack overflow. Other16 targets unexecuted. |
| `66ab982` | `34689525206` | red | Isolated stack probe; same18/68, direct stderr markers and type-size wrapper, no changed stack flags or removed assertions. Exact 302-byte log: `coop_waits_for_all_human_commands` overflowed; save probe entered natural bootstrap. Sizes: kernel 8480 B, snapshot 8648 B, state 4024 B. Both snapshot-heavy tests now split into smaller non-inlined helpers; remote proof pending. |

All builds/tests/formatting remain remote. Source reconciliation and test changes
in the working tree are not a green result. M9 Engineering is not complete.
## Reconciled candidate, 2026-09-12

Next diagnostic selects 19 whole targets / 81 tests, including the complete 12-test er-game library target and two additional KO source witnesses. The unreachable learning draft is archived as source text, excluded from execution and completion claims. Both large co-op tests preserve their existing test identities and assertions in smaller non-inlined helpers. This candidate has not yet passed remote compilation or execution. M9 remains incomplete.

Remote run 34690000546 on 791f755 stopped at formatting, with zero compiler/test results. Applied its exact 218773-byte formatter page (SHA256 6ca1abb4c2522d2a1125552b053f0b42d073e7acdfe19d08d8709dfff6e46202), verifying all 32 source before/after hashes. The formatter successor keeps all 19 targets / 81 tests; execution remains unproven.

Remote run 34690192210 on cfa46f8 passed formatting but failed the all-target consumer check before tests: HP mutation binding before shadowed the outer GameState preimage in retained KO source capture. Successor renames only the HP binding, adds Faint callback/receipt negative witnesses to the existing phase test, and keeps formatting failures RED while collecting compiler feedback from restored, hash-verified original committed bytes. No tests yet executed on the reconciled repair.

Remote run 34690319392 on 3003393 restored original pinned bytes after emitting formatting feedback and reached compilation. Sole reported failure: missing PresentationEventId import in the phase receipt helper; er-battle and er-game checked, kernel did not. Zero tests ran. Successor applies the exact raw-test formatter postimage and adds actual Title LIST/READ prompt reissue assertions at Faint animation, Faint message, XP and level-stat boundaries. The READ implementation reissues retained event/payload with no new receipt, phase execution or inferred acknowledgement. Remote validation remains required; M9 is incomplete.

Run 34690516838 on 3e69351 passed the entire workspace/all-target compile check. Clippy stopped on one collapsible conditional in the XP validator; all five rejection conditions are retained in the cleanup. Applied the three exact remote formatter postimages and replaced the co-op bootstrap tuple with a named result struct. No tests executed in that run; all 81 witnesses remain selected for the successor.

Run 34690762700 on f5bb364 passed formatting and workspace/all-target compilation. Clippy reported one nested storage guard in snapshot validation; the successor preserves every condition in a combined guard. Added an epoch-zero achievement regression after exact source review established Object.hasOwn deduplication: Some(0) is already unlocked, not absent. The new whole-phase target count is two tests, bringing the diagnostic to 19 whole targets / 82 tests. No tests ran in the preceding lint-blocked run.

Run 34690994401 on f0fddf8 passed workspace compilation; Clippy rejected two unnecessary Copy clones in the raw phase fixture. Applied the verified formatter output and removed only those calls. All 19 targets / 82 tests remain selected, with zero tests executed in that run. Separately published source probe e5fbf14 / 34691075973 failed on an incorrect party accessor before new observations; it provides no tail qualification.

## Initial post-victory source observations, 2026-09-12

Source-only run 34691284958 on observer commit 84913319 passed against pinned game source 399d5d368f0b5642ebf8f45bd8a5e73350fa4de7. Two fresh process observations were byte-identical (2521 bytes each, SHA256 5b2256b1d0327351f206c9629ed7128adb4a3c2b4a86530bcb1e7978de079357); all retained source-oracle contracts and 11 new rejection mutations passed.

The actual raw Bulbasaur has active ability 5006, passive slots [65,47,5082], and only active 5006 applicable while the innates are locked. All 24 observed PostBattle families are empty. Only 5082 has PostTurn PassiveRecoveryAbAttr; admission must inspect applicable sources, not reject locked slots or infer all registered abilities neutral. The initial MapModifier stack1 is not lapsing, the three actual charge calls leave it unchanged, Ace training-cache settlement returns no awards and retains the empty cache, and actual money capture changes multiplier1/capturedfalse to multiplier1/capturedtrue.

These are initialized registry and direct initial-context observations, not execution of the complete TurnEnd/BattleEnd phases. Their integration into the retained tail remains pending the runtime witness. They do not qualify rewards, subsequent encounter construction or aggregate M9 completion.
### eb7f1d3 remote result and defender fixture provenance

Run 34691242781 passed formatting, workspace check, Clippy, and compilation. Whole er-game library (12), content (4), and co-op (4) targets passed with default stack settings. Defender had one pass and one failure. Its manually substituted Withdraw/innate/HP fixture incorrectly retained FreshComplete source history. An unsupported player stat-stage observation was the initial failure hypothesis, but source tracing has not confirmed an actual stage mutation in this executor; the precise failing call remains unproven. Later targets remain unexecuted on this SHA.

The defender fixture now explicitly retains its valid 1v1 participation shell with UnobservedMechanicalFixture history and removes source XP authority. Existing immutable-query, innate-slot, HP, material, and restore assertions remain, with added tracker-conservation and absent-XP assertions. This does not implement or qualify the missing genuine source stat-stage achievement hook, which remains outstanding. This successor requires a fresh remote result.
### Initial Victory settlement implementation — remote qualification pending

The successor adds a retained initial Victory tail after the existing Faint/friendship entry, preserving supported XP prompts when a tail context is not yet supported. For the qualified first-turn neutral source context, completed XP now advances through explicit owned TurnEnd and BattleEnd material to EggLapse. The retained receipt binds the exact original action suffix, XP endpoint, turn increment, battle RNG substream reset, initial battle score/count, money multiplier capture and living-party streak. Restore validation uses separate original-frontier projections, never re-executes settlement, and rejects altered suffixes or endpoints.

A controlled raw level5 knockout witness is added to the whole phase target (19 whole targets /83 exact tests). It exercises actual callbacks/common material, once-only settlement, restore and a forged suffix negative. It does not claim natural unmodified campaign history or a nonempty cancelled suffix; that path still requires the Flash achievement reward. EggLapse, reward selection and NewBattle remain outstanding connected work. No local project workload was run.

The separate achievement source probe on 6755f275, run34691845872, stopped at the observer's incorrect strict-false assertion for an optional Classic mode flag. Actual source leaves isCoop/isFun undefined. Successor d4346098 asserts isClassic and applies the source boolean interpretation; its exporter pin was updated with the observer. This probe qualifies neither battle execution nor M9 completion.
Run34691829756 on34c6366 passed formatting/check/Clippy and the same20 whole-target tests. Defender remained1/2 with a new failure: raw acceptance took the compatibility whole-turn route, so no retained turn existed. The exact route required either source XP execution origin or an explicit doubles mechanical fixture. This successor extends that explicit mechanical route to single battles with a valid participation shell, no XP authority and UnobservedMechanicalFixture; it preserves the existing doubles rule and all source-authority guards. The initial eb7 failure cause remains unproven beyond the earlier source-history barrier.

The diagnostic now continues through independent whole-target binaries after a test nonzero exit, retaining per-target exit/count/log facts and finishing red for any failure. Exact inventories, zero ignored/filtered tests, default stack settings, source/artifact integrity, command/log/time bounds and cleanup reserve remain mandatory. Resource-limit and identity failures still stop execution. The first failed target supplies the compact failure excerpt. The run therefore exposes later failures without representing failed targets as passed.

Achievement source run34692088253 on d4346098 passed two byte-identical initialized observations and nine negative controls. Actual Flash inserts its Rare EVENT egg before team candy; the four observed clock calls and isolated seeded draws remain separate inputs, and battle RNG is conserved. The fresh egg/default-restock extension is running on1a615921 (34692247388). These are source diagnostics, not gameplay qualification.
Run34692309756 on e56c4d8 passed the full workspace check, then stopped at three collapsible-if lints in the new tail; no tests executed. This successor applies all12 remote formatter postimages (33836-byte page, every before/after digest verified) and the three equivalent let-chain corrections. Two EOF-without-newline records were malformed in the producer's unified diff; the evidence page remains unchanged, the corrected local patch reproduces every recorded postimage, and the producer now emits standard missing-newline markers for future pages.

Complete source-history action folding now rejects status/no-power moves whose current resolver records a hit without implementing the actual source effect. Explicit mechanical fixtures remain scoped mechanics witnesses. This closes silent false acceptance, not the remaining status-effect implementation gap.

Flash pool source run34692571320 on b9b2f9c passed two identical observations and independent weight/selection checks. Its17930-byte observation has165 initialized Rare EVENT pool rows, rare egg-move rate24, fresh unlock pity[0,0,0,0], and empty same-species counters; the full pool input order and weights reproduce the actual constructor's selected species. This is source data for the pending generic constructor, not a sampled-result lookup or gameplay qualification.
Run34692822694 on2ba3176 passed formatting and workspace check. Clippy then found one nested if-let in kernel tail dispatch; this successor joins those two guards without changing execution or acknowledgement handling. No tests executed on that run.
### Additional source qualifications and connected implementation, September 12

Achievement source run34692247388 on1a615921 passed the actual fresh Egg account/default-restock observations: no eggs, zero voucher balances, disabled restock, target50, gacha1, and the first three voucher classes enabled. The actual disabled planner made no purchases and conserved RNG. Run34692950209 on1687e5ca passed the full Rare EVENT pool observation and remotely generated the reviewed Rust pool source (4452 bytes, SHA256 62472785a94ccbd9328616ba991d98d65a538b4bdc5b54c92eb4094a358f4c67). These inputs support the pending integrated constructor; they are not whole gameplay acceptance.

Reward source run34693574294 on37f8025 passed two byte-identical initialized observations (10514 bytes each, SHA256 1fb05b670dc3bf44d59066edc6660b18660370c77fc5e1cd9726b20c52af5bd9). The actual 128-row catalog and generation emitted three common options and one free pick, with four regeneration and eleven option-generation integer draws. The observed TM_CASE/LURE/RARE_CANDY list is evidence, never an executable lookup or a guarantee for another input. Source retries compare generated names/groups and preserve generator arguments and draw order. Actual anonymous modifier classes required allowing an empty diagnostic constructor name; exact nonempty option identities remain mandatory.

The next source extension on17ad0f0/run34693822947 failed a verifier assumption that the requested test setup seed equaled the actual scene seed. The pinned GameManager utility initializes scene.seed to test. The successor distinguishes those two values and validates the actual captured constructor context; no source seed or enemy level was changed to satisfy the observer.

The integrated level/Flash work also found that the TypeScript browser effect router did not recognize the UTC request already represented by Rust. Its pending repair must include actual adapter callbacks and browser tests alongside native compilation. The main83-test candidate remains under remote validation; no new source-oracle result changes the six-row M9 acceptance state.

### Connected level, Flash and browser candidate

Run34693059158 on959fcd6 passed formatting, workspace compilation, Clippy and test builds. Thirteen complete targets contributed56 passing tests. Defender completed1/2, target execution8/11, and phase execution failed epoch-zero before a raw-XP stack overflow aborted its binary. The campaign replay consumed the unchanged shared deadline during starter navigation (active run absent); five later whole targets did not execute. These are failures, not partial acceptance.

The successor selects21 whole native targets /113 exact tests, adding complete er-state library and er-web host targets. A separate bounded JavaScript job runs three whole node targets /18 tests. Changes connect ordered level achievements, explicit Flash clock/random inputs, the initialized Rare EVENT Egg constructor, EggLapse and exact SAVE READ request reissue through Rust and browser adapters. Large phase test frames are split without changing stack limits or assertions. The initial enemy level/battle seed constructor follows pinned source draw order. Struggle, reward selection/application, later encounter ownership and campaign performance remain outstanding; no browser journey or M9 completion is claimed.

Reward source run34694155305 onb220ef9 passed two identical13392-byte observations (SHA2567a9fad1cbaf1f6bc7b20d03762d6690a169d8a47e46a8f251e7e3cbe4c43af7b). Run34694502130 ona1cdc06 passed two identical15152-byte observations (SHA2566a7b0011527ef729bb366918b980aa56668bc9de0517cfe6dc727a73eeb3dc24), retaining all12 regeneration calls and exact typed generator arguments. The actual fixture scene seed is test, wave seed uftu, battle seed jfJR8ChSJpD2mvUt, and initial enemy level2. Source observations qualify their captured contexts; connected runtime validation remains required.

Run34695760581 onbfd687f: separate JavaScript qualification GREEN18/18 across three whole files, with unchanged1651-file source inventory. Native check stopped before tests on missing AchievementClock/FlashEgg fallback match arms. Applied the qualified87994-byte formatter patch (SHA2560cf51616b4e436728c53c618d3f995e23841382451fec40b66bed5dbfcca9e4f), verifying28 exact postimages and preserving the independently reviewed ledger-proof change in the29th file. Added the two explicit unreachable dispatch arms.

The successor includes exact private ledger/checkpoint validation reuse to remove repeated work without reducing retention windows, events or public validation. It aligns retained-turn state admission with the existing explicit single-battle mechanical fixture route; a FreshComplete relabel remains rejected. Accepted-command Struggle now retains random targets, applies max-HP recoil for the exact qualified24-ability neutral cohort, and preserves typeless damage; raw command-admission ordering remains outstanding. Nine private source reward arithmetic files compile through three scoped tests, not production sampled offers. Diagnostic expands to22 whole native targets/116 tests; JavaScript remains18. M9 remains incomplete.

Run34696253817 on8608ff6 compiled all production crates, including the private ledger/replay proof reuse; test compilation stopped on two nonexistent helper names in the new Struggle type-invariance witness. Corrected both to the exported query_simulated_move_damage_v5. Applied all18 exact remote formatter postimages from the106490-byte page SHA25689766c2c8458ea93a4834070b8769347079bf83fba82465b72fa8e6ded732a00. Native tests did not execute; the separate JavaScript job passed again.

The successor avoids cloned string identities during logical menu binary searches and adds the complete existing five-test m4_types target (23 whole native targets/121 exact tests). Source review of the qualified initialized move registry found ER Growl45 is damaging and has StatStageChangeAttr; complete-history admission now also rejects that unresolved stat child instead of incorrectly treating a damaging category as proof of effect completion. Actual owned stat execution remains required. No M9 acceptance row is declared complete by these diagnostic changes.

Run34696715386 onbffed72 passed formatting and the full workspace/all-target compile check. Clippy stopped on one collapsible level-achievement validation conditional; no native tests executed. JavaScript passed again. Successor preserves that predicate in a let-chain and proactively corrects identical nested conditions in the Flash witness and private reward arithmetic.

Starter-menu validation now checks the same remaining logical identities by reference after the existing action/layout/visibility/cancel checks, instead of cloning a complete logical menu merely to validate it. Independent source review confirmed error order and unsorted/hidden-option behavior are preserved. The whole existing menu-validation target plus an error-precedence regression brings the diagnostic to24 whole native targets/127 exact tests. Replay is now explicitly included in Clippy for the changed recorder. Performance and gameplay results remain pending.

Source observer6793ae2/run34696971671 was published to check actual fresh ball counters and the initialized direct wave1-to2 newBattle call. It delegates source methods and records format/constructor/cleanup RNG and queued phases, with no claimed Victory, applied reward or executed next encounter. The separate first-reward binding extension remains under review.

Run34697112286 on56cfad5 passed the complete all-target compile check. Clippy stopped on the 624-byte Flash input enum variant; no native tests executed. The successor boxes that payload across owned phase, external event and browser request with the same serialized shape and validation. Applied the exact1294-byte remote formatter page SHA2560c07146c5fa8034464a10fa83242482f1569015b069cb33956997f0491ced2ba.

Source run34696971671 on6793ae2 passed two identical22276-byte observations SHA256b042df00f43fb025ea5c84c52cf4f976c0fea0ff22f2df41fa9ad6d3f1974c9b: fresh ball counters5/0/0/0/0, direct wave2 seed vguv, battle seed wlyeDByVgyoYo7Rp, enemy level2. The early ordinary single constructor arithmetic now preserves the source fractional Gaussian loop for waves1..4; the second-wave trace adds one exact unit witness (24 whole targets/128 tests). It is not connected next-encounter or reward acceptance. The observer serialized the adjacency method as an empty object, so no adjacency qualification is claimed; an explicit source-method projection is pending. M9 remains incomplete.

Run34697917140 on48535a2 passed the complete all-target compile check and JavaScript18/18. Native Clippy stopped on four replace-box assignments in the phase test; no native tests executed. This successor reuses those four existing allocations and applies the exact790-byte formatter page SHA25672945e5a7c10f4848e51549b8e6c259a9e68119f2a173d729128f5e5b67ca6e3.

Raw human Struggle now stages its canonical target draw before authority AI preparation, retains exact command/battle/wave/turn and RNG proof, and recomputes admission from the unchanged common-material preimage. Restored proofs bind the living preturn slot-to-Pokemon enumeration or the retained enemy command roster and queued selected target; missing, swapped-candidate and changed-selection proofs reject. Execution consumes the admitted target without another draw. The existing witness adds raw admission/restore/replay checks in split default-stack frames; inventory remains128/24. FreshComplete recoil achievement provenance and enemy fallback ordering remain guarded, so this is not natural full Struggle acceptance. No source counts, source XP mapping, participation bounds, stack flags or diagnostic time bounds were relaxed.

Run34698208537 on36f1cc3 passed all-target compilation, Clippy, both test builds and the complete14-test er-game library. The strict er-state list check then stopped: the diagnostic inventory had omitted35 existing bespoke_v2 unit tests. This successor requires all49 actual state-library IDs, adding the six corresponding source files to the whole-library inventory; total163 tests across the same24 whole targets. No test is filtered or removed. Applied all9 exact formatter postimages from42200-byte page SHA256d9a43f2a51eaccedc1a79db8da9f3b36b0ea8441efa7405e4b38092766b6e4b2.

After successful all-target compilation, a nonzero Clippy result is now retained as a mandatory failure while independent exact tests may execute within the same unchanged deadline. Final green still requires Clippy0 and every whole target/count/identity, and compact evidence retains the lint log independently. Compiler, resource and identity failures still stop. This improves failure coverage without relaxing qualification.

Reward source run34698195638 onecdaad757 passed two identical24349-byte observations SHA256b1fa77714b82d5a3deeb4623c10a7b153f849826a6580053d1c4759554a2131b and18 negative controls. The exact nullable evolution item and actual structured adjacency calls are now qualified. Live reward generation/application and queued next encounter remain ongoing; no M9 completion claim.
