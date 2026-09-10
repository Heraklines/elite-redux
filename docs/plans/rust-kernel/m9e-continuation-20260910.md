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
| `557598b` | pending | pending | First run of the wired interlude drain: pin check, oracle, rustfmt, `clippy --tests -D warnings`, focused targets. |
