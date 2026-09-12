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
