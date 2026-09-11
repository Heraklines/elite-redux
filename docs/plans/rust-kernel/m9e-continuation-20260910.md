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

## Current drain implementation

`AwaitingInterlude` now drives the retained source-ordered descendant chain
through owned phases instead of refusing:

| `GameOwnedPhaseV1` | Source-ordered step |
|---|---|
| `FriendshipBegin` / `FriendshipClock` | friendship recipients + UTC platform request (pre-existing) |
| `VictoryBegin` | plan retained `phases` for the pending (`plan_current_victory_experience`) |
| `AwardBegin` | emit blocking `Progression` XP prompt → `AwardPresentation{award,event_id}` |
| `AwardApply` | apply retained award → `LevelUpStart` or descendant advance |
| `LevelUpApply` | `apply_current_level_up` → stat recalc + blocking prompt → `LevelUpPresentation{end,event_id}` |
| `LevelUpChildren` | `plan_current_level_up_children` → `LevelUpChildren{children}` |
| `VictoryDescendant` | begin learn batch (+`MoveLearn` control) or `Evolution{children}` (+`Evolution` control) or advance the phase cursor |
| `PendingResolve` | all pendings `Complete` → resume turn (`ReadyForMove`) or clear the finished turn and run the battle tail |

External edges stay external: the kernel pump (`next_intermission_phase`)
returns no phase while a friendship clock request is outstanding, while the
retained `event_id` still sits in `pending_presentations`, or while an
actionable learn/evolution control belongs to the human owner.
`GameActionV1::CurrentLearnMoveBatch` is dispatched to
`apply_current_learn_move_batch`, writes the retained batch back into the
descendant, and stamps `current_achievement_tracker` in the same material.
`GameActionV1::Evolution` routes to the owned executor when a pending
descendant is `Evolution{children}` and advances the phase cursor on
Complete/Cancel. `has_pending_experience` now means "any unresolved pending",
so resolved entries no longer block turns while `observe_next` still bounds
the retained list to the battle's enemy faints.

## Honest limits of this increment

- A second *separate* interlude inside one battle is still `Unsupported`:
  `CurrentExperienceOwnerV1::observe_next` refuses while `pending` is
  non-empty, and retained pendings persist as `Complete` rows. One faint batch
  per battle drains fully; sequential KO + new faint in the same battle does
  not.
- Prompt acknowledgement ordering is pump-level (kernel
  `pending_presentations`), not state-level: the material applier recomputes
  owned-phase transitions deterministically from `before` + retained
  descendant; the retained `event_id` records that the prompt was emitted
  before the award applied.
- The victory tail reuses `install_progression_or_reward_control`; the legacy
  `prepare_post_battle_progression` `GrantExperience` catch-up tasks are not
  emitted on the owned path (XP was already paid out by the drain).

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
