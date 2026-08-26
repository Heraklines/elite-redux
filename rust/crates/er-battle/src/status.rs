//! Selected M3 Burn, Poison, and Paralysis mechanics.
//!
//! This module deliberately keeps status admission, RNG gates, and residual
//! mutation as typed pure/runtime seams.  Toxic, Sleep, and status-bypass
//! hooks are representable in the M3A state model but fail closed here.

use er_rng::audit::{RngCallsiteId, RngReason};
use er_rng::battle::RngRuntime;
use er_rng::phaser::RngError;
use er_types::battle_model::{MoveCategory, PokemonType, PokemonTyping, StatusKind, StatusState};
use er_types::{SafeU53, SafeU53Error};
use thiserror::Error;

/// A status admission input from the selected move-effect boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StatusApplicationInput {
    /// The requested major status.
    pub requested: StatusKind,
    /// The target's current status state.
    pub current: StatusState,
    /// The target's effective battle typing.
    pub target_types: PokemonTyping,
    /// Whether the selected move carries the POWDER flag.
    pub powder: bool,
    /// Any requested bypass hook.  Every non-`None` value fails closed.
    pub bypass: StatusBypass,
}

/// Explicit status-bypass requests.  The selected M3 slice has no bypass
/// capability; retaining these values makes accidental bypasses observable.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StatusBypass {
    /// Ordinary admission checks.
    None,
    /// A request to bypass a type immunity.
    TypeImmunity,
    /// A request to bypass the Grass powder immunity.
    PowderImmunity,
    /// A request to overwrite an existing major status.
    ExistingStatus,
    /// A request to bypass the Burn physical-damage reduction.
    BurnDamageReduction,
}

/// Typed evidence for a successful status mutation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StatusMutation {
    /// Status state before application.
    pub before: StatusState,
    /// Status state after application.
    pub after: StatusState,
}

/// Compatibility name for the mutation input consumed by later M3 lanes.
pub type StatusMutationInput = StatusMutation;

/// Reasons an otherwise successful status attempt is rejected.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StatusRejection {
    /// A target may carry only one major status.
    ExistingMajorStatus { existing: StatusKind },
    /// The target's type rejects this status.
    TypeImmunity {
        status: StatusKind,
        immune_type: PokemonType,
    },
    /// Grass rejects a powder move in the selected slice.
    PowderImmunity { immune_type: PokemonType },
    /// Oracle `StatusEffect.NONE` is the intrinsic cleared sentinel: it is
    /// never admitted as a condition; cures write it (`trySetStatus` returns
    /// false for the falsy effect).
    IntrinsicSentinel,
    /// Oracle `StatusEffect.SLEEP` admission requires its rolled window;
    /// admitting without one is a typed no-mutation rejection.
    SleepWindowRequired,
    /// Oracle `StatusEffect.FREEZE` never lands as a major status: every
    /// freeze source reroutes to the ER_FROSTBITE battler tag.
    ReroutedToFrostbiteTag,
    /// Oracle `StatusEffect.FAINT` routes to the faint substate (the fainted
    /// flag and faint cleanup ordering), never through status admission.
    RoutedToFaintSubstate,
}

/// Result of one status admission/chance attempt.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StatusApplicationOutcome {
    /// The status was applied and carries the exact state mutation.
    Applied { mutation: StatusMutation },
    /// Admission rejected the status without mutating the target.
    Rejected { reason: StatusRejection },
    /// The chance gate failed before admission was attempted.
    ChanceFailed { draw: SafeU53 },
}

/// Typed errors for unsupported status capabilities and failed status
/// arithmetic/RNG transactions.
#[derive(Debug, Error)]
pub enum StatusError {
    /// Toxic and Sleep are outside the selected M3 mechanics slice.
    #[error("status {status:?} is outside the selected M3 status slice")]
    UnsupportedStatus { status: StatusKind },
    /// A non-selected bypass hook was requested.
    #[error("status bypass {bypass:?} is outside the selected M3 status slice")]
    UnsupportedBypass { bypass: StatusBypass },
    /// A state companion field violates the selected canonical status shape.
    #[error("status state for {status:?} has unsupported companion fields")]
    InvalidStatusState { status: StatusKind },
    /// Canonical residual input requires a positive maximum HP.
    #[error("maximum HP must be positive for residual status damage")]
    InvalidMaxHp,
    /// Canonical HP cannot exceed maximum HP.
    #[error("current HP exceeds maximum HP for residual status damage")]
    InvalidHp,
    /// Status chance values are percentages in the closed [0, 100] range.
    #[error("status chance {chance} is outside the closed [0, 100] range")]
    InvalidChance { chance: u8 },
    /// The status turn counter cannot be advanced further.
    #[error("status turn count overflowed its canonical u16 range")]
    TurnCountOverflow,
    /// The fixed RNG range could not be represented by the JS-safe integer
    /// boundary.
    #[error(transparent)]
    SafeInteger(#[from] SafeU53Error),
    /// The staged RNG transaction failed and therefore must not be applied.
    #[error(transparent)]
    Rng(#[from] RngError),
}

/// Input for one post-turn Burn/Poison residual resolution.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StatusResidualInput {
    /// The target status before the residual phase.
    pub status: StatusState,
    /// Current HP before residual damage.
    pub hp: u32,
    /// Maximum HP used by the oracle formula.
    pub max_hp: u32,
}

/// Typed evidence for one post-turn status mutation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StatusResidualMutation {
    /// Status state before incrementing the post-turn counter.
    pub status_before: StatusState,
    /// Status state after incrementing the post-turn counter.
    pub status_after: StatusState,
    /// HP before residual damage.
    pub hp_before: u32,
    /// HP after applying the capped residual damage.
    pub hp_after: u32,
    /// The computed minimum-one residual amount before the HP cap.
    pub residual_amount: u32,
    /// The actual HP mutation after capping at current HP.
    pub damage: u32,
}

/// Compatibility name for the mutation input consumed by the residual lane.
pub type StatusResidualMutationInput = StatusResidualMutation;

/// Result of one post-turn residual check.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StatusResidualOutcome {
    /// Burn or ordinary Poison produced a status/HP mutation.
    Applied { mutation: StatusResidualMutation },
    /// None or Paralysis has no selected post-turn residual.
    NotApplicable { status: StatusKind },
    /// A fainted target does not receive a residual mutation.
    TargetFainted { status: StatusState, hp: u32 },
}

/// Result of the selected paralysis activation gate.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ParalysisActivationOutcome {
    /// No selected paralysis status was active, so no draw occurred.
    NotParalyzed,
    /// The paralyzed actor may continue after a nonzero draw.
    CanAct { draw: SafeU53 },
    /// The zero draw cancels the actor's move.
    FullyParalyzed { draw: SafeU53 },
}

/// Result of a secondary status chance gate.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StatusChanceOutcome {
    /// None or 100% chance follows the source no-draw guaranteed path.
    Guaranteed,
    /// A consuming draw passed the strict `< chance` comparison.
    Passed { draw: SafeU53 },
    /// A consuming draw failed the strict `< chance` comparison.
    Failed { draw: SafeU53 },
}

/// Apply the selected status admission rules without consuming RNG.
pub fn apply_status(
    input: StatusApplicationInput,
) -> Result<StatusApplicationOutcome, StatusError> {
    validate_supported_status(input.requested)?;
    validate_status_state(input.current)?;
    if input.bypass != StatusBypass::None {
        return Err(StatusError::UnsupportedBypass {
            bypass: input.bypass,
        });
    }
    if input.current.kind != StatusKind::None {
        return Ok(StatusApplicationOutcome::Rejected {
            reason: StatusRejection::ExistingMajorStatus {
                existing: input.current.kind,
            },
        });
    }
    if input.powder && powder_immunity(input.target_types) {
        return Ok(StatusApplicationOutcome::Rejected {
            reason: StatusRejection::PowderImmunity {
                immune_type: PokemonType::Grass,
            },
        });
    }
    if let Some(immune_type) = status_type_immunity(input.requested, input.target_types)? {
        return Ok(StatusApplicationOutcome::Rejected {
            reason: StatusRejection::TypeImmunity {
                status: input.requested,
                immune_type,
            },
        });
    }

    let after = StatusState {
        kind: input.requested,
        toxic_turn_count: 0,
        sleep_turns_remaining: None,
    };
    Ok(StatusApplicationOutcome::Applied {
        mutation: StatusMutation {
            before: input.current,
            after,
        },
    })
}

/// Apply a secondary chance gate and then run status admission in source order.
pub fn apply_status_with_chance(
    runtime: &mut RngRuntime,
    input: StatusApplicationInput,
    chance: Option<u8>,
) -> Result<StatusApplicationOutcome, StatusError> {
    // Keep the chance draw and the later materialization as one transaction:
    // a normal admission rejection commits the consumed chance draw, while a
    // typed unsupported/materialization error restores the caller's runtime.
    let mut staged = runtime.clone();
    let chance_outcome = roll_status_chance(&mut staged, chance)?;
    let outcome = if let StatusChanceOutcome::Failed { draw } = chance_outcome {
        StatusApplicationOutcome::ChanceFailed { draw }
    } else {
        apply_status(input)?
    };
    *runtime = staged;
    Ok(outcome)
}

/// Resolve a selected status chance with the exact battle-stream reason and
/// closed callsite for the ordinary secondary-effect path.
pub fn roll_status_chance(
    runtime: &mut RngRuntime,
    chance: Option<u8>,
) -> Result<StatusChanceOutcome, StatusError> {
    let Some(chance) = chance else {
        return Ok(StatusChanceOutcome::Guaranteed);
    };
    if chance > 100 {
        return Err(StatusError::InvalidChance { chance });
    }
    if chance == 100 {
        return Ok(StatusChanceOutcome::Guaranteed);
    }
    let cardinality = SafeU53::new(100)?;
    let draw = runtime.pokemon_rand_battle_seed_int(
        cardinality,
        SafeU53::ZERO,
        RngReason::SecondaryEffect,
        RngCallsiteId::secondary_status(),
    )?;
    if draw.get() < u64::from(chance) {
        Ok(StatusChanceOutcome::Passed { draw })
    } else {
        Ok(StatusChanceOutcome::Failed { draw })
    }
}

/// Resolve the pre-move paralysis gate.  A non-paralyzed selected status does
/// not draw; an active paralysis draws exactly one integer in [0, 3].
pub fn check_paralysis(
    runtime: &mut RngRuntime,
    status: StatusKind,
) -> Result<ParalysisActivationOutcome, StatusError> {
    match status {
        StatusKind::None | StatusKind::Burn | StatusKind::Poison => {
            Ok(ParalysisActivationOutcome::NotParalyzed)
        }
        StatusKind::Toxic | StatusKind::Sleep => Err(StatusError::UnsupportedStatus { status }),
        StatusKind::Paralysis => {
            let draw = runtime.pokemon_rand_battle_seed_int(
                SafeU53::new(4)?,
                SafeU53::ZERO,
                RngReason::ParalysisActivation,
                RngCallsiteId::paralysis_activation(),
            )?;
            if draw == SafeU53::ZERO {
                Ok(ParalysisActivationOutcome::FullyParalyzed { draw })
            } else {
                Ok(ParalysisActivationOutcome::CanAct { draw })
            }
        }
    }
}

/// Return the selected Burn damage multiplier for a resolved move category.
///
/// Physical Burn reduction belongs after type effectiveness in the damage
/// chain.  The helper exposes only the selected neutral/half outcomes; any
/// bypass request is rejected instead of becoming an implicit no-op.
pub fn burn_damage_multiplier(
    status: StatusKind,
    category: MoveCategory,
    bypass: StatusBypass,
) -> Result<f64, StatusError> {
    validate_supported_status_or_none(status)?;
    if bypass != StatusBypass::None {
        return Err(StatusError::UnsupportedBypass { bypass });
    }
    if status == StatusKind::Burn && category == MoveCategory::Physical {
        Ok(0.5)
    } else {
        Ok(1.0)
    }
}

/// Resolve one ordinary Poison or Burn post-turn residual.
pub fn resolve_residual(input: StatusResidualInput) -> Result<StatusResidualOutcome, StatusError> {
    validate_status_state(input.status)?;
    if input.max_hp == 0 {
        return Err(StatusError::InvalidMaxHp);
    }
    if input.hp > input.max_hp {
        return Err(StatusError::InvalidHp);
    }
    if input.hp == 0 {
        return Ok(StatusResidualOutcome::TargetFainted {
            status: input.status,
            hp: input.hp,
        });
    }

    let divisor = match input.status.kind {
        StatusKind::Poison => 8,
        StatusKind::Burn => 16,
        StatusKind::None | StatusKind::Paralysis => {
            return Ok(StatusResidualOutcome::NotApplicable {
                status: input.status.kind,
            });
        }
        StatusKind::Toxic | StatusKind::Sleep => {
            return Err(StatusError::UnsupportedStatus {
                status: input.status.kind,
            });
        }
    };
    let residual_amount = (input.max_hp / divisor).max(1);
    let damage = residual_amount.min(input.hp);
    let next_turn_count = input
        .status
        .toxic_turn_count
        .checked_add(1)
        .ok_or(StatusError::TurnCountOverflow)?;
    let status_after = StatusState {
        kind: input.status.kind,
        toxic_turn_count: next_turn_count,
        sleep_turns_remaining: None,
    };
    Ok(StatusResidualOutcome::Applied {
        mutation: StatusResidualMutation {
            status_before: input.status,
            status_after,
            hp_before: input.hp,
            hp_after: input.hp - damage,
            residual_amount,
            damage,
        },
    })
}

/// Return the selected type immunity, checking primary typing before
/// secondary typing to keep the rejection evidence deterministic. Unsupported
/// status kinds return an error instead of silently becoming non-immune.
pub fn status_type_immunity(
    status: StatusKind,
    target_types: PokemonTyping,
) -> Result<Option<PokemonType>, StatusError> {
    validate_supported_status(status)?;
    if type_blocks_status(status, target_types.primary) {
        return Ok(Some(target_types.primary));
    }
    Ok(target_types
        .secondary
        .filter(|secondary| type_blocks_status(status, *secondary)))
}

/// Return whether the target's typing blocks a powder move.
pub fn powder_immunity(target_types: PokemonTyping) -> bool {
    target_types.primary == PokemonType::Grass || target_types.secondary == Some(PokemonType::Grass)
}

const fn type_blocks_status(status: StatusKind, pokemon_type: PokemonType) -> bool {
    matches!(
        (status, pokemon_type),
        (StatusKind::Poison, PokemonType::Poison)
            | (StatusKind::Poison, PokemonType::Steel)
            | (StatusKind::Paralysis, PokemonType::Electric)
            | (StatusKind::Burn, PokemonType::Fire)
    )
}

fn validate_supported_status(status: StatusKind) -> Result<(), StatusError> {
    match status {
        StatusKind::Burn | StatusKind::Poison | StatusKind::Paralysis => Ok(()),
        StatusKind::None | StatusKind::Toxic | StatusKind::Sleep => {
            Err(StatusError::UnsupportedStatus { status })
        }
    }
}

fn validate_supported_status_or_none(status: StatusKind) -> Result<(), StatusError> {
    match status {
        StatusKind::None | StatusKind::Burn | StatusKind::Poison | StatusKind::Paralysis => Ok(()),
        StatusKind::Toxic | StatusKind::Sleep => Err(StatusError::UnsupportedStatus { status }),
    }
}

fn validate_status_state(status: StatusState) -> Result<(), StatusError> {
    match status.kind {
        StatusKind::None | StatusKind::Paralysis
            if status.toxic_turn_count != 0 || status.sleep_turns_remaining.is_some() =>
        {
            Err(StatusError::InvalidStatusState {
                status: status.kind,
            })
        }
        StatusKind::Burn | StatusKind::Poison if status.sleep_turns_remaining.is_some() => {
            Err(StatusError::InvalidStatusState {
                status: status.kind,
            })
        }
        StatusKind::Toxic | StatusKind::Sleep => Err(StatusError::UnsupportedStatus {
            status: status.kind,
        }),
        StatusKind::None | StatusKind::Burn | StatusKind::Poison | StatusKind::Paralysis => Ok(()),
    }
}

// ---------------------------------------------------------------------------
// M6 expanded major-status lane — full oracle `StatusEffect` closure
// ---------------------------------------------------------------------------
//
// The M3 slice above stays exactly as pinned by its tests; the expanded lane
// adds the remaining frozen identities with their exact oracle semantics:
//
// - TOXIC shares the poison type-immunity table (Poison and Steel targets)
//   and ramps post-turn damage to `maxHp * toxicTurnCount / 16` after the
//   per-turn counter increment (`PostTurnStatusEffectPhase`).
// - SLEEP rolls its window `randBattleSeedIntRange(2, 4)` inclusive at
//   admission; each move attempt decrements the window first and wakes at
//   zero (`MovePhase.checkSleep`). It has no post-turn residual.
// - FREEZE never lands as a status: `trySetStatus` reroutes every freeze
//   source to the ER_FROSTBITE battler tag, which chips `maxHp/16` per turn
//   end, persists until cured, and blocks Ice-type targets.
// - NONE is the intrinsic cleared sentinel written by cures; it is never
//   admitted as a condition.
// - FAINT routes to the faint substate (the fainted flag plus faint cleanup),
//   never through status admission.

/// Expanded type-immunity resolution over the admissible identity closure.
/// Toxic shares the poison immunities; sleep has none.
pub fn expanded_status_type_immunity(
    status: StatusKind,
    target_types: PokemonTyping,
) -> Result<Option<PokemonType>, StatusError> {
    let blocked = |primary: PokemonType, secondary: Option<PokemonType>, gate: PokemonType| {
        if primary == gate {
            return Ok(Some(primary));
        }
        Ok(secondary.filter(|secondary| *secondary == gate))
    };
    match status {
        StatusKind::None | StatusKind::Sleep => Ok(None),
        StatusKind::Poison | StatusKind::Toxic => {
            if target_types.primary == PokemonType::Poison
                || target_types.primary == PokemonType::Steel
            {
                return Ok(Some(target_types.primary));
            }
            Ok(target_types.secondary.filter(|secondary| {
                *secondary == PokemonType::Poison || *secondary == PokemonType::Steel
            }))
        }
        StatusKind::Paralysis => blocked(
            target_types.primary,
            target_types.secondary,
            PokemonType::Electric,
        ),
        StatusKind::Burn => blocked(
            target_types.primary,
            target_types.secondary,
            PokemonType::Fire,
        ),
    }
}

/// Canonical companion-field shape for one live major status in the expanded
/// lane: toxic carries only its ramp counter, sleep only its window, every
/// other kind neither.
fn canonical_companions(kind: StatusKind, current: StatusState) -> Result<(), StatusError> {
    match kind {
        StatusKind::None | StatusKind::Paralysis | StatusKind::Burn | StatusKind::Poison => {
            if current.toxic_turn_count != 0 || current.sleep_turns_remaining.is_some() {
                return Err(StatusError::InvalidStatusState { status: kind });
            }
        }
        StatusKind::Toxic => {
            if current.sleep_turns_remaining.is_some() {
                return Err(StatusError::InvalidStatusState { status: kind });
            }
        }
        StatusKind::Sleep => {
            if current.toxic_turn_count != 0 {
                return Err(StatusError::InvalidStatusState { status: kind });
            }
        }
    }
    Ok(())
}

/// Expanded admission for one major status over a clean-or-statusful target:
/// poison, toxic, paralysis and burn admit through this lane; sleep requires
/// its rolled window via [`apply_sleep_window`]; NONE is rejected as the
/// intrinsic sentinel, FREEZE is rejected as rerouted to the frostbite tag
/// lane, both without mutating anything.
pub fn apply_major_status(
    input: StatusApplicationInput,
) -> Result<StatusApplicationOutcome, StatusError> {
    if input.bypass != StatusBypass::None {
        return Err(StatusError::UnsupportedBypass { bypass: input.bypass });
    }
    match input.requested {
        StatusKind::None => {
            return Ok(StatusApplicationOutcome::Rejected {
                reason: StatusRejection::IntrinsicSentinel,
            })
        }
        StatusKind::Sleep => {
            return Ok(StatusApplicationOutcome::Rejected {
                reason: StatusRejection::SleepWindowRequired,
            })
        }
        StatusKind::Burn | StatusKind::Paralysis | StatusKind::Poison | StatusKind::Toxic => {}
    }
    canonical_companions(input.current.kind, input.current)?;
    if input.current.kind != StatusKind::None {
        return Ok(StatusApplicationOutcome::Rejected {
            reason: StatusRejection::ExistingMajorStatus {
                existing: input.current.kind,
            },
        });
    }
    if input.powder && powder_immunity(input.target_types) {
        return Ok(StatusApplicationOutcome::Rejected {
            reason: StatusRejection::PowderImmunity {
                immune_type: PokemonType::Grass,
            },
        });
    }
    if let Some(immune_type) = expanded_status_type_immunity(input.requested, input.target_types)? {
        return Ok(StatusApplicationOutcome::Rejected {
            reason: StatusRejection::TypeImmunity {
                status: input.requested,
                immune_type,
            },
        });
    }
    let after = StatusState {
        kind: input.requested,
        toxic_turn_count: 0,
        sleep_turns_remaining: None,
    };
    Ok(StatusApplicationOutcome::Applied {
        mutation: StatusMutation {
            before: input.current,
            after,
        },
    })
}

/// Rolls the oracle sleep window `randBattleSeedIntRange(2, 4)` inclusive on
/// the battle stream under the frozen status-duration callsite identity.
pub fn roll_sleep_window(runtime: &mut RngRuntime) -> Result<u16, StatusError> {
    let draw = runtime.battle_integer_in_range(
        SafeU53::new(2)?,
        SafeU53::new(4)?,
        RngReason::StatusDuration,
        RngCallsiteId::mechanics(RngReason::StatusDuration),
    )?;
    // The inclusive [2, 4] window always fits u16 by construction.
    let window = u16::try_from(draw.get())
        .expect("status-duration range draw stays within [2, 4]");
    Ok(window)
}

/// Admits sleep with an explicit pre-rolled window (oracle default
/// `[2, 4]`). A zero window is not a canonical sleep state.
pub fn apply_sleep_window(
    current: StatusState,
    target_types: PokemonTyping,
    powder: bool,
    window: u16,
) -> Result<StatusApplicationOutcome, StatusError> {
    canonical_companions(current.kind, current)?;
    if current.kind != StatusKind::None {
        return Ok(StatusApplicationOutcome::Rejected {
            reason: StatusRejection::ExistingMajorStatus {
                existing: current.kind,
            },
        });
    }
    if powder && powder_immunity(target_types) {
        return Ok(StatusApplicationOutcome::Rejected {
            reason: StatusRejection::PowderImmunity {
                immune_type: PokemonType::Grass,
            },
        });
    }
    if window == 0 {
        return Err(StatusError::InvalidStatusState {
            status: StatusKind::Sleep,
        });
    }
    let after = StatusState {
        kind: StatusKind::Sleep,
        toxic_turn_count: 0,
        sleep_turns_remaining: Some(window),
    };
    Ok(StatusApplicationOutcome::Applied {
        mutation: StatusMutation {
            before: current,
            after,
        },
    })
}

/// Outcome of one move attempt against a sleeping battler
/// (`MovePhase.checkSleep`).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SleepGateOutcome {
    /// The target is not asleep; no state changed.
    NotAsleep,
    /// The decremented window reached zero and the target woke into the
    /// cleared sentinel.
    Woke,
    /// The target stays asleep with the remaining window.
    StillAsleep { remaining: u16 },
}

/// Advances one move attempt against sleep: the window decrements first and
/// the target wakes when it reaches zero.
pub fn advance_sleep(status: &mut StatusState) -> SleepGateOutcome {
    if status.kind != StatusKind::Sleep {
        return SleepGateOutcome::NotAsleep;
    }
    let remaining = status.sleep_turns_remaining.unwrap_or(0);
    if remaining <= 1 {
        *status = StatusState {
            kind: StatusKind::None,
            toxic_turn_count: 0,
            sleep_turns_remaining: None,
        };
        return SleepGateOutcome::Woke;
    }
    status.sleep_turns_remaining = Some(remaining - 1);
    SleepGateOutcome::StillAsleep {
        remaining: remaining - 1,
    }
}

/// Oracle toxic residual: the ramp counter increments first, then damage is
/// `toDmgValue(maxHp * count / 16)` with the minimum-one floor shared by the
/// whole residual family.
pub fn resolve_toxic_residual(
    input: StatusResidualInput,
) -> Result<StatusResidualOutcome, StatusError> {
    if input.max_hp == 0 {
        return Err(StatusError::InvalidMaxHp);
    }
    if input.hp > input.max_hp {
        return Err(StatusError::InvalidHp);
    }
    if input.hp == 0 {
        return Ok(StatusResidualOutcome::TargetFainted {
            status: input.status,
            hp: input.hp,
        });
    }
    let next_count = input
        .status
        .toxic_turn_count
        .checked_add(1)
        .ok_or(StatusError::TurnCountOverflow)?;
    let raw_amount = u64::from(input.max_hp) * u64::from(next_count) / 16;
    let residual_amount = u32::try_from(raw_amount).unwrap_or(u32::MAX);
    let damage = residual_amount.max(1).min(input.hp);
    let status_after = StatusState {
        kind: StatusKind::Toxic,
        toxic_turn_count: next_count,
        sleep_turns_remaining: None,
    };
    Ok(StatusResidualOutcome::Applied {
        mutation: StatusResidualMutation {
            status_before: input.status,
            status_after,
            hp_before: input.hp,
            hp_after: input.hp - damage,
            residual_amount,
            damage,
        },
    })
}

/// Outcome of one ER_FROSTBITE turn-end chip.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FrostbiteChipOutcome {
    /// The chip landed with the capped damage.
    Chipped { damage: u32 },
    /// A fainted carrier takes no chip.
    TargetFainted,
}

/// ER_FROSTBITE turn-end chip: `toDmgValue(maxHp / 16)` with the shared
/// minimum-one floor, capped at current HP.
pub fn resolve_frostbite_chip(hp: u32, max_hp: u32) -> Result<FrostbiteChipOutcome, StatusError> {
    if max_hp == 0 {
        return Err(StatusError::InvalidMaxHp);
    }
    if hp > max_hp {
        return Err(StatusError::InvalidHp);
    }
    if hp == 0 {
        return Ok(FrostbiteChipOutcome::TargetFainted);
    }
    let amount = (max_hp / 16).max(1);
    Ok(FrostbiteChipOutcome::Chipped {
        damage: amount.min(hp),
    })
}

/// Production cure write (`Pokemon.cureStatus`): replaces any live major
/// status with the cleared sentinel. Curing an already-cleared target is the
/// oracle no-op, surfaced as a rejection instead of a fake mutation.
pub fn cure_major_status(current: StatusState) -> Result<StatusApplicationOutcome, StatusError> {
    canonical_companions(current.kind, current)?;
    if current.kind == StatusKind::None {
        return Ok(StatusApplicationOutcome::Rejected {
            reason: StatusRejection::IntrinsicSentinel,
        });
    }
    let after = StatusState {
        kind: StatusKind::None,
        toxic_turn_count: 0,
        sleep_turns_remaining: None,
    };
    Ok(StatusApplicationOutcome::Applied {
        mutation: StatusMutation {
            before: current,
            after,
        },
    })
}
