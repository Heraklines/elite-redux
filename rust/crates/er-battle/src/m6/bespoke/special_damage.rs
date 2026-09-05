//! `SPECIAL_DAMAGE_COUNTER` bespoke family: stored-damage records and
//! counter-retaliation transitions.
//!
//! Implements the closed retaliation surface of the four catalog moves that
//! carry `CounterDamageAttr`/`CounterRedirectAttr`:
//!
//! | Move | Numeric ID | Multiplier | Category filter |
//! |------|------------|------------|-----------------|
//! | Counter | 68 | 2 (`SAFE_INTEGER`) | physical |
//! | Mirror Coat | 243 | 2 (`SAFE_INTEGER`) | special |
//! | Metal Burst | 368 | 1.5 (f64 bits `3ff8000000000000`) | both |
//! | Comeuppance | 894 | 1.5 (f64 bits `3ff8000000000000`) | both |
//!
//! Frozen oracle behavior (`src/data/moves/move.ts:2319-2413`,
//! `src/data/moves/move-utils.ts:249-263`, `src/utils/common.ts:403-405`,
//! `src/data/moves/move-condition.ts:243-270`):
//!
//! - Eligibility reads the received-attack window of the current turn and
//!   keeps the first record whose move category is damaging, matches the
//!   filter, and did not come from an ally.
//! - The retaliation amount is `toDmgValue(damage * multiplier)`:
//!   exact floor division with a frozen minimum of one. Multipliers are
//!   represented as [`ExactRatioV2`] so no floating point enters the kernel;
//!   `2` and `1.5` are exactly representable, so ratio form is bit-exact.
//! - The redirect target is the recorded attacker; in multi-battle formats a
//!   fainted attacker falls back to the first active battler on the same
//!   side, and only then does the transition fail.
//! - Without an eligible source the move fails before any damage is dealt
//!   and without consuming RNG. Every failure path returns the input state
//!   untouched.
//!
//! Ordinary damage formulas (type effectiveness, stats, rolls) stay outside
//! this family: it consumes already-recorded damage values only.

use er_mechanics::condition_v2::ExactRatioV2;
use er_mechanics::v2::{MechanicHookV2, MechanicQueryV2};
use er_state::bespoke_v2::special_damage::{
    SpecialDamageCategory, SpecialDamageStateError, SpecialDamageStateV2, StoredDamageRecordV2,
};
use er_types::{BehaviorSourceId, BehaviorUnitId, BehaviorUnitKind, SafeU53};
use thiserror::Error;

/// Counter â€” 2x physical retaliation.
pub const MOVE_COUNTER: u16 = 68;
/// Mirror Coat â€” 2x special retaliation.
pub const MOVE_MIRROR_COAT: u16 = 243;
/// Metal Burst â€” 1.5x retaliation against any category.
pub const MOVE_METAL_BURST: u16 = 368;
/// Comeuppance â€” 1.5x retaliation against any category.
pub const MOVE_COMEUPPANCE: u16 = 894;

/// Flat ally boundary of the frozen `BattlerIndex` layout
/// (`PLAYER = 0`, `PLAYER_2 = 1`, `ENEMY = 2`, `ENEMY_2 = 3`): indices below
/// the boundary share the player side, indices at or above it share the enemy
/// side (`src/utils/pokemon-utils.ts:165-174`). The TypeScript `ATTACKER`
/// sentinel never enters canonical state, so no sentinel branch exists here.
pub const BATTLER_INDEX_ENEMY_BOUNDARY: u8 = 2;

/// Frozen minimum of `toDmgValue(value, minValue = 1)`
/// (`src/utils/common.ts:403-405`).
const TO_DMG_VALUE_MINIMUM: i64 = 1;

/// JavaScript `Number.MAX_SAFE_INTEGER` (CR-0015 strict signed safe
/// integers): products beyond this bound lose integer precision in the
/// oracle's `Number` arithmetic.
const JS_MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// Received-attack filter of a retaliation profile.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SpecialDamageFilter {
    Physical,
    Special,
    Both,
}

impl SpecialDamageFilter {
    /// Whether a recorded category passes this filter.
    pub fn accepts(self, category: SpecialDamageCategory) -> bool {
        match self {
            Self::Physical => category == SpecialDamageCategory::Physical,
            Self::Special => category == SpecialDamageCategory::Special,
            Self::Both => true,
        }
    }
}

/// Closed retaliation profile resolved from the frozen move mapping.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RetaliationProfileV2 {
    pub move_id: u16,
    pub multiplier: ExactRatioV2,
    pub filter: SpecialDamageFilter,
}

/// Resolves the frozen per-move profile. Any other move id is a typed
/// rejection: there is no fallback mapping.
pub fn retaliation_profile(move_id: u16) -> Result<RetaliationProfileV2, SpecialDamageError> {
    let (multiplier, filter) = match move_id {
        MOVE_COUNTER => (
            ExactRatioV2 {
                numerator: 2,
                denominator: 1,
            },
            SpecialDamageFilter::Physical,
        ),
        MOVE_MIRROR_COAT => (
            ExactRatioV2 {
                numerator: 2,
                denominator: 1,
            },
            SpecialDamageFilter::Special,
        ),
        MOVE_METAL_BURST | MOVE_COMEUPPANCE => (
            ExactRatioV2 {
                numerator: 3,
                denominator: 2,
            },
            SpecialDamageFilter::Both,
        ),
        _ => return Err(SpecialDamageError::UnsupportedRetaliationMove(move_id)),
    };
    Ok(RetaliationProfileV2 {
        move_id,
        multiplier,
        filter,
    })
}

/// Typed view of the live field used for target selection. Sorted ascending,
/// unique, real battler indices only.
#[derive(Clone, Copy, Debug)]
pub struct CounterFieldView<'a> {
    /// Battler indices currently active on the field.
    pub active_indices: &'a [u8],
    /// Total battler count of the format (1 for singles, more otherwise).
    pub battler_count: usize,
}

impl<'a> CounterFieldView<'a> {
    fn validate(&self) -> Result<(), SpecialDamageError> {
        if self.battler_count == 0 {
            return Err(SpecialDamageError::InvalidField(
                "battler count must be positive",
            ));
        }
        let mut previous: Option<u8> = None;
        for index in self.active_indices {
            if previous.is_some_and(|prior| *index <= prior) {
                return Err(SpecialDamageError::InvalidField(
                    "active indices must be strictly ascending",
                ));
            }
            previous = Some(*index);
        }
        Ok(())
    }

    fn is_active(&self, index: u8) -> bool {
        self.active_indices.binary_search(&index).is_ok()
    }

    /// First active index on the same flat side as `index`, ascending order.
    fn first_active_on_same_side(&self, index: u8) -> Option<u8> {
        self.active_indices
            .iter()
            .copied()
            .find(|candidate| is_ally(*candidate, index))
    }
}

fn is_ally(left: u8, right: u8) -> bool {
    (left < BATTLER_INDEX_ENEMY_BOUNDARY) == (right < BATTLER_INDEX_ENEMY_BOUNDARY)
}

/// Target-selection evidence for one retaliation, in oracle order.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CounterTargetSelection {
    /// The recorded attacker is delivered directly.
    Direct(u8),
    /// The recorded attacker left the field and the first active battler on
    /// the attacker's side was delivered instead (multi-battle fallback).
    SideFallback {
        recorded_index: u8,
        delivered_index: u8,
    },
    /// The recorded attacker and every same-side battler are gone: the
    /// oracle's redirect falls back to the `BattlerIndex.ATTACKER` sentinel,
    /// which skips the redirect and fails the move downstream. Carried as
    /// ordered evidence instead of an early typed failure.
    AttackerSentinel { recorded_index: u8 },
}

impl CounterTargetSelection {
    pub fn delivered_index(&self) -> Option<u8> {
        match *self {
            Self::Direct(index)
            | Self::SideFallback {
                delivered_index: index,
                ..
            } => Some(index),
            Self::AttackerSentinel { .. } => None,
        }
    }

    pub fn recorded_index(&self) -> u8 {
        match *self {
            Self::Direct(index)
            | Self::SideFallback {
                recorded_index: index,
                ..
            }
            | Self::AttackerSentinel {
                recorded_index: index,
            } => index,
        }
    }
}

/// Final delivery outcome of one retaliation transition.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RetaliationOutcome {
    /// The redirect delivered; `damage` is the exact dealt amount.
    Delivered { damage: i64 },
    /// The oracle skipped the redirect onto its ATTACKER sentinel and the
    /// move failed: no damage is dealt and no RNG is consumed.
    FailedWithoutRedirect { recorded_index: u8 },
}

/// Selects the retaliation target from the stored record window.
///
/// Mirrors `getCounterAttackTarget` plus the redirect application in
/// `CounterRedirectAttr.apply`: eligibility is category/source/turn only,
/// activity matters exclusively in multi-battle formats.
pub fn select_counter_target(
    state: &SpecialDamageStateV2,
    owner_index: u8,
    profile: &RetaliationProfileV2,
    turn_index: i64,
    field: &CounterFieldView<'_>,
) -> Result<(StoredDamageRecordV2, CounterTargetSelection), SpecialDamageError> {
    state.validate()?;
    field.validate()?;
    let matching: Vec<&StoredDamageRecordV2> = state
        .records
        .iter()
        .filter(|record| {
            profile.filter.accepts(record.category) && !is_ally(record.attacker_index, owner_index)
        })
        .collect();
    if matching.is_empty() {
        return Err(SpecialDamageError::NoEligibleSource);
    }
    let current_turn: Vec<&StoredDamageRecordV2> = matching
        .iter()
        .copied()
        .filter(|record| record.turn_index == turn_index)
        .collect();
    if current_turn.is_empty() {
        // Matching attacks exist but none from the requested turn window:
        // stale evidence can never drive retaliation.
        return Err(SpecialDamageError::StaleRecordsOnly);
    }
    // Receipt order: the first current-turn match wins, exactly like the
    // oracle's `attacksReceived.find`.
    let record = *current_turn[0];
    if field.battler_count <= 1 || field.is_active(record.attacker_index) {
        return Ok((
            record,
            CounterTargetSelection::Direct(record.attacker_index),
        ));
    }
    match field.first_active_on_same_side(record.attacker_index) {
        Some(delivered_index) => Ok((
            record,
            CounterTargetSelection::SideFallback {
                recorded_index: record.attacker_index,
                delivered_index,
            },
        )),
        None => Ok((
            record,
            CounterTargetSelection::AttackerSentinel {
                recorded_index: record.attacker_index,
            },
        )),
    }
}

/// Computes `toDmgValue(damage * multiplier)` with exact integer arithmetic.
///
/// The multiplication is checked against the JavaScript safe-integer domain
/// (CR-0015): a product beyond `2^53 - 1` would lose integer precision in the
/// oracle's `Number` arithmetic and is a typed failure, never truncation. The
/// floor comes from exact division by the ratio denominator, and the frozen
/// `toDmgValue` minimum of one applies.
pub fn compute_retaliation_amount(
    recorded_damage: SafeU53,
    multiplier: ExactRatioV2,
) -> Result<i64, SpecialDamageError> {
    if multiplier.denominator == 0 {
        return Err(SpecialDamageError::InvalidRatio);
    }
    if multiplier.numerator < 0 {
        return Err(SpecialDamageError::InvalidRatio);
    }
    let damage =
        i64::try_from(recorded_damage.get()).map_err(|_| SpecialDamageError::ArithmeticOverflow)?;
    let scaled = damage
        .checked_mul(i64::from(multiplier.numerator))
        .ok_or(SpecialDamageError::ArithmeticOverflow)?;
    if scaled > JS_MAX_SAFE_INTEGER {
        return Err(SpecialDamageError::ArithmeticOverflow);
    }
    // Both operands are non-negative, so truncating division is floor.
    let floored = scaled / i64::from(multiplier.denominator);
    Ok(floored.max(TO_DMG_VALUE_MINIMUM))
}

/// Request for [`execute_retaliation`].
#[derive(Clone, Copy, Debug)]
pub struct RetaliationRequestV2<'a> {
    pub move_id: u16,
    /// Battler index of the retaliating Pokemon.
    pub owner_index: u8,
    /// Turn index of the retaliation; only records from this turn qualify.
    pub turn_index: i64,
    pub field: CounterFieldView<'a>,
}

/// Complete output of one successful retaliation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RetaliationTransitionV2 {
    pub move_id: u16,
    pub multiplier: ExactRatioV2,
    pub filter: SpecialDamageFilter,
    /// The record the retaliation consumed as its evidence.
    pub record: StoredDamageRecordV2,
    pub selection: CounterTargetSelection,
    /// Ordered delivery evidence.
    pub outcome: RetaliationOutcome,
    /// Exact retaliation amount after the frozen rounding rule. On
    /// [`RetaliationOutcome::FailedWithoutRedirect`] this amount is never
    /// dealt; it is retained as computation evidence only.
    pub retaliation_damage: i64,
}

/// Executes one counter-family retaliation over typed state.
///
/// Pure: validates inputs, computes the full evidence, and returns the
/// validated successor state together with the transition. The successor
/// equals the input because the oracle keeps `turnData.attacksReceived` until
/// the next turn boundary; clearing happens through
/// [`SpecialDamageStateV2::clear_record_window`] at that boundary. On any
/// failure the input state is returned untouched inside the error-free path â€”
/// no mutation is ever constructed.
pub fn execute_retaliation(
    state: &SpecialDamageStateV2,
    request: RetaliationRequestV2<'_>,
) -> Result<(SpecialDamageStateV2, RetaliationTransitionV2), SpecialDamageError> {
    let profile = retaliation_profile(request.move_id)?;
    let (record, selection) = select_counter_target(
        state,
        request.owner_index,
        &profile,
        request.turn_index,
        &request.field,
    )?;
    let retaliation_damage = compute_retaliation_amount(record.damage, profile.multiplier)?;
    let outcome = match selection {
        CounterTargetSelection::Direct(_) | CounterTargetSelection::SideFallback { .. } => {
            RetaliationOutcome::Delivered {
                damage: retaliation_damage,
            }
        }
        CounterTargetSelection::AttackerSentinel { recorded_index } => {
            RetaliationOutcome::FailedWithoutRedirect { recorded_index }
        }
    };
    let transition = RetaliationTransitionV2 {
        move_id: profile.move_id,
        multiplier: profile.multiplier,
        filter: profile.filter,
        record,
        selection,
        outcome,
        retaliation_damage,
    };
    let successor = state.clone();
    successor.validate()?;
    Ok((successor, transition))
}

/// Executes a Bide-style release through the battle surface: releases the
/// stored total from the accumulator and reports the doubled retaliation
/// amount using the same frozen rounding rule as the counter moves.
///
/// Bide itself is forbidden content in Elite Redux; this transition exists
/// for the stored-damage substrate the family owns and rejects any state
/// without an open accumulator.
pub fn execute_accumulated_release(
    state: &SpecialDamageStateV2,
    multiplier: ExactRatioV2,
) -> Result<(SpecialDamageStateV2, RetaliationTransitionV2), SpecialDamageError> {
    let (successor, released) = state.release_accumulation()?;
    let retaliation_damage = compute_retaliation_amount(released, multiplier)?;
    let transition = RetaliationTransitionV2 {
        move_id: 0,
        multiplier,
        filter: SpecialDamageFilter::Both,
        record: StoredDamageRecordV2 {
            attacker_index: 0,
            category: SpecialDamageCategory::Physical,
            damage: released,
            turn_index: 0,
        },
        selection: CounterTargetSelection::Direct(0),
        outcome: RetaliationOutcome::Delivered {
            damage: retaliation_damage,
        },
        retaliation_damage,
    };
    Ok((successor, transition))
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SpecialDamageError {
    #[error("move {0} carries no counter-retaliation profile in the frozen family mapping")]
    UnsupportedRetaliationMove(u16),
    #[error("no eligible received attack matches the category and source filters")]
    NoEligibleSource,
    #[error("matching received attacks exist only outside the requested turn window")]
    StaleRecordsOnly,
    #[error("behavior unit is not part of the frozen special-damage cluster registry")]
    UnregisteredBehaviorUnit,
    #[error("dispatch request does not match the classified behavior unit")]
    DispatchRequestMismatch,
    #[error("counter field view is invalid: {0}")]
    InvalidField(&'static str),
    #[error("retaliation multiplier must be positive")]
    InvalidRatio,
    #[error("retaliation arithmetic overflowed the safe-integer domain")]
    ArithmeticOverflow,
    #[error("special-damage state rejected the transition: {0}")]
    State(#[from] SpecialDamageStateError),
}

// ===== Frozen behavior-unit classification/dispatch registry =====
//
// The SPECIAL_DAMAGE_COUNTER cluster in `rust/fixtures/m6/bespoke-clusters-v1.json`
// contains exactly 153 behavior units. Every unit is classified below by its
// exact identity (ordinal + provenance hash + source + unit kind) and every
// class resolves through the closed dispatcher at the bottom of this section.
// Nothing is unclassified and no classification is a silent no-op: query
// modifiers name their production DAMAGE_QUERY fold, dispatch sites name the
// central loop surface that executes them, and the two SYNCHRONIZE
// encounter-nature units resolve through a closed audited-facts decision.

/// Behavior units covered by [`REGISTRY`].
pub const SPECIAL_DAMAGE_REGISTRY_LEN: usize = 153;

/// Received-damage admission gates of the `Block*` attribute family.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecordGateKind {
    NonDirectDamage,
    WeatherDamage,
    StatusDamage,
    RecoilDamage,
}

/// Origin of received damage considered for the record window.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DamageOrigin {
    DirectMove(SpecialDamageCategory),
    Weather,
    Status,
    Recoil,
}

/// Audited facts: which blocking effects are active on the defender.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RecordGateSet {
    pub non_direct_damage: bool,
    pub weather_damage: bool,
    pub status_damage: bool,
    pub recoil_damage: bool,
}

/// Admission decision for one received-damage fact.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecordAdmission {
    Admitted,
    DeniedBy(RecordGateKind),
}

impl RecordGateSet {
    /// Evaluates the frozen gate order against one damage origin.
    ///
    /// Mirrors `BlockNonDirectDamageAbAttr` (blocks everything that is not a
    /// direct move hit) and the specific weather/status/recoil blockers.
    pub fn admit(self, origin: DamageOrigin) -> RecordAdmission {
        match origin {
            DamageOrigin::DirectMove(_) => RecordAdmission::Admitted,
            DamageOrigin::Weather => {
                if self.non_direct_damage {
                    RecordAdmission::DeniedBy(RecordGateKind::NonDirectDamage)
                } else if self.weather_damage {
                    RecordAdmission::DeniedBy(RecordGateKind::WeatherDamage)
                } else {
                    RecordAdmission::Admitted
                }
            }
            DamageOrigin::Status => {
                if self.non_direct_damage {
                    RecordAdmission::DeniedBy(RecordGateKind::NonDirectDamage)
                } else if self.status_damage {
                    RecordAdmission::DeniedBy(RecordGateKind::StatusDamage)
                } else {
                    RecordAdmission::Admitted
                }
            }
            DamageOrigin::Recoil => {
                if self.non_direct_damage {
                    RecordAdmission::DeniedBy(RecordGateKind::NonDirectDamage)
                } else if self.recoil_damage {
                    RecordAdmission::DeniedBy(RecordGateKind::RecoilDamage)
                } else {
                    RecordAdmission::Admitted
                }
            }
        }
    }
}

/// Pure damage-formula query attributes routed to the production
/// `DAMAGE_QUERY` fold. Their arithmetic belongs to the ordinary damage
/// formula family and is deliberately not duplicated here; this family only
/// certifies the routing target.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DamageQueryAttribute {
    AlliedFieldDamageReductionAbAttr,
    BitterDrillDamageAbAttr,
    BypassBurnDamageReductionAbAttr,
    BypassBurnDamageReductionAttr,
    CritDamageMultiplierAbAttr,
    DamageReductionAbAttr,
    HitsTagForDoubleDamageAttr,
    MoveDamageBoostAbAttr,
    NeutralDamageAgainstFlyingTypeAttr,
    PostDefendContactDamageAbAttr,
    PostFaintContactDamageAbAttr,
    PostFaintHPDamageAbAttr,
    PostWeatherLapseDamageAbAttr,
    RandomLevelDamageAttr,
    ReceivedMoveDamageMultiplierAbAttr,
    ReceivedTypeDamageMultiplierAbAttr,
    ReduceBurnDamageAbAttr,
    SplashDamageAbAttr,
    SurviveDamageAttr,
    TurnDamagedDoublePowerAttr,
}

/// Central TypeScript dispatch-loop surfaces referenced by fixed-dispatch units.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DispatchSurface {
    ApplyAbAttrs,
    ApplyFilteredAbAttrs,
    ApplyMoveAttrs,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SourceKindTag {
    Move,
    ActiveAbility,
    PassiveAbility,
    BattlerTag,
    Bespoke,
}

/// Closed classification of one behavior unit of the frozen cluster.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SpecialDamageUnitClass {
    /// `CounterDamageAttr` DAMAGE_QUERY amount path (the four catalog moves).
    RetaliationAmount,
    /// `CounterRedirectAttr` target-selection path.
    RetaliationRedirect,
    /// Received-damage admission gate.
    RecordGate(RecordGateKind),
    /// ER counter-attack-on-hit post-defend archetype, including its audited
    /// draw site (`RNG:` provenance inside `counter-attack-on-hit.ts`).
    CounterOnHitArchetype,
    /// Pure damage-formula modifier executed by the DAMAGE_QUERY fold.
    DamageFormulaQuery(DamageQueryAttribute),
    /// Central dispatch-loop site; executes already-staged bindings by kind.
    CentralDispatchSite(DispatchSurface),
    /// Content-load intrinsic definition.
    ContentLoadIntrinsic,
    /// SYNCHRONIZE's wild-encounter nature sync (`SyncEncounterNatureAbAttr`,
    /// `src/data/abilities/ab-attrs.ts:6409-6416`: the generated enemy adopts
    /// the holder's nature via `target.setNature(pokemon.getNature())`,
    /// consulted per player-party member at encounter materialization in
    /// `src/phases/encounter-phase.ts:1129`, wired to SYNCHRONIZE in
    /// `init-abilities.ts:412-415`).
    EncounterNatureSync,
}

struct RegistryEntry {
    ordinal: u32,
    provenance_hash: &'static str,
    source_kind: SourceKindTag,
    numeric_id: u64,
    registry_key: &'static str,
    unit_kind: BehaviorUnitKind,
    class: SpecialDamageUnitClass,
}

static REGISTRY: &[RegistryEntry] = &[
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "0603d573a1ff5e28e9150dbaa22d027ad6d44c61a3124566462ca6fd3b6bbed2",
        source_kind: SourceKindTag::Move,
        numeric_id: 16,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::HitsTagForDoubleDamageAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "5150d59d268ff4575fb83e14c56371c21ec165bdd2fb626e09ca2ae88e76ed70",
        source_kind: SourceKindTag::Move,
        numeric_id: 23,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::HitsTagForDoubleDamageAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "3a38062ecea22b8f9c97cde6bda1f9164fb8cd9a0f9bb07872497fab930de7d0",
        source_kind: SourceKindTag::Move,
        numeric_id: 34,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::HitsTagForDoubleDamageAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "085f2eb79bca408ce23e723cafb1ec49ae6e92f70d1340d8632b0dae3079fe5f",
        source_kind: SourceKindTag::Move,
        numeric_id: 57,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::HitsTagForDoubleDamageAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "5c05dc43f69412ce8344ab9f03d6e29d7aacace1bd4e7571758e0c6f5cc40cf4",
        source_kind: SourceKindTag::Move,
        numeric_id: 68,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::RetaliationAmount,
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "2ee266f702653fc8c00b683cb188bf7280f63ede10944f22246d44f3322be906",
        source_kind: SourceKindTag::Move,
        numeric_id: 89,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::HitsTagForDoubleDamageAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "1d212f732ab5ed538bb09771138393c7fa282074e58a27eda364513eb745d7df",
        source_kind: SourceKindTag::Move,
        numeric_id: 149,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::RandomLevelDamageAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "f520aa9d923e7f97a0abd7f576a585f6b9800e7fbb2129a625742cb95364f826",
        source_kind: SourceKindTag::Move,
        numeric_id: 206,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(DamageQueryAttribute::SurviveDamageAttr),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "214c6f93290fabfe7e3170b6d927db189e0c3fbfc6d0dba0b067ce13871ff096",
        source_kind: SourceKindTag::Move,
        numeric_id: 222,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::HitsTagForDoubleDamageAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "dffe0aef43d32577cad1ff48ac9c5252fbf2f07009f5e8fbed3584915a2227b6",
        source_kind: SourceKindTag::Move,
        numeric_id: 239,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::HitsTagForDoubleDamageAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "2e316bc19623171b4916ff313336e9f2946e9d98c3c2699b2ef438a3f34d938c",
        source_kind: SourceKindTag::Move,
        numeric_id: 243,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::RetaliationAmount,
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "46e15cbd980d4e1d7fdc94ec51586cd738e2558831d5e486bf07b330a3b132cc",
        source_kind: SourceKindTag::Move,
        numeric_id: 250,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::HitsTagForDoubleDamageAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "79c7c5444197630ba5aa839b26ae32ec73ee793dace3e19acd9a2ac4017be053",
        source_kind: SourceKindTag::Move,
        numeric_id: 263,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::BypassBurnDamageReductionAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "86acb6734c4d7f1c7f0489f21a229d737f6a32bb11059293a3749dd4ebd400a0",
        source_kind: SourceKindTag::Move,
        numeric_id: 279,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::TurnDamagedDoublePowerAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "36ede1abea9bb51e988b26a4e5db09587c0fe9015d2473c3c4cd268de119e068",
        source_kind: SourceKindTag::Move,
        numeric_id: 368,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::RetaliationAmount,
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "b67a1ea557fb37fd4628b8e8af5c6ed646d1597ee9167ef23085c8410904620c",
        source_kind: SourceKindTag::Move,
        numeric_id: 407,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::HitsTagForDoubleDamageAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "7e0fdeb4e14d89e564fd7c12ede86871989f29b5af5b0147a59e42f50a8d06a6",
        source_kind: SourceKindTag::Move,
        numeric_id: 419,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::TurnDamagedDoublePowerAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "d724b3a12254b91ea63cbf9bfafbce27055a388c44442d4261aa71672d3ba31f",
        source_kind: SourceKindTag::Move,
        numeric_id: 484,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::HitsTagForDoubleDamageAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "3fd7cbb518e2d396bbf00e4bd3e4d1ebac8aab1e07df8837a179717d5bae123b",
        source_kind: SourceKindTag::Move,
        numeric_id: 535,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::HitsTagForDoubleDamageAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "3e4244b8e1ecc07a60bb65b428875ce48b22ed825c451642a5221c36cd3325d6",
        source_kind: SourceKindTag::Move,
        numeric_id: 537,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::HitsTagForDoubleDamageAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "a3fe2b9c878c49cca06b76a1abca4a694796f93728042cffc55bdd79684d3284",
        source_kind: SourceKindTag::Move,
        numeric_id: 560,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::HitsTagForDoubleDamageAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "f8aa2cad3c0bcd52f53ee9a2315dcbc600589ec5b8f78ade37c7ef2aadb5e9bf",
        source_kind: SourceKindTag::Move,
        numeric_id: 610,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(DamageQueryAttribute::SurviveDamageAttr),
    },
    RegistryEntry {
        ordinal: 5,
        provenance_hash: "b971227b771ed48be4a8c7cd0196d9d94e431f9769295ef6f1c89cb505d79b06",
        source_kind: SourceKindTag::Move,
        numeric_id: 614,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::NeutralDamageAgainstFlyingTypeAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "06c9da530ebf54c6316c136a5c508fb629be9a853c4ebfd7b287e3291205b22c",
        source_kind: SourceKindTag::Move,
        numeric_id: 696,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::HitsTagForDoubleDamageAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "fd55bfdcc8ad56a00c1414e351173615587c6f302cc1e8a059a00ab22cc07a41",
        source_kind: SourceKindTag::Move,
        numeric_id: 894,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::RetaliationAmount,
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "3c1f65941194d7d720d9b03e55d65fbb9bb91e5336dbbf99b82b464921e7d971",
        source_kind: SourceKindTag::Move,
        numeric_id: 916,
        registry_key: "",
        unit_kind: BehaviorUnitKind::MoveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::HitsTagForDoubleDamageAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "70aca669cd2619dafc0c07bbe72dd05bce9012659f844d57bc3f7d427ce76361",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 8,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::WeatherDamage),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "35e9cd63f11d9f62053f58ce0425ac671d9cd22308276fa63ab267718c89b153",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 24,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::PostDefendContactDamageAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "746a9d953897d35f447e63f481f60ab3ad3c7e5af0ff9f4ee1feab438f9250e8",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 28,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::EncounterNatureSync,
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "4cd355b72b12326ef1a5b4b1a903da99448b242e57287f70437401f3263ec543",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 47,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedTypeDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "4cd355b72b12326ef1a5b4b1a903da99448b242e57287f70437401f3263ec543",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 47,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedTypeDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "e85cc70018a0052cb2054a9f9ec5a34cadc06a6a670deb948cc4d8e0bcb8a688",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 62,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::BypassBurnDamageReductionAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "8bd4379d40220008d27a8f254c2abefe7b38213d5315728bb87c991ae7ec8098",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 69,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::RecoilDamage),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "5a8c47e56017cc514e205168e32e20aa54f0498bfe545b5039b0e742ceb6c86b",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 81,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::WeatherDamage),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "17dcd1290cd3b5a179dacf970a7af35fa602b4d45ed7f55b2ead613b74ba86c3",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 85,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReduceBurnDamageAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "4db5b834d1b9691e44ffe5a5bc22318fbbce46ae1426ea5de2ce43d9da789247",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 85,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedTypeDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "836c3d658c32af9f30f18e572c7f9178ed2e2e561334ebc9525287adc29997bc",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 87,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedTypeDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 4,
        provenance_hash: "ae1abde2a4e243ab445bb3bae543e5610784be0afacb72b7bbdabb960cbd23a6",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 87,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::PostWeatherLapseDamageAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "ef5038a3a931bee0db2c79e114f3fc9beffe5fab24271d15e8d8691a87613284",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 90,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::StatusDamage),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "b2dc371b0b891076c73f06512d3eee7596082ec53a55979f2f35a84356b45297",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 94,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::PostWeatherLapseDamageAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "a6c73641abadc70a0dfc375afee5181512aa385fd50fa64b9b044f989c6802b4",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 98,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::NonDirectDamage),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "38d9b57bef15fcbb73b894e2f684728681f048c4c9e073307829bfc44bcc9a2e",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 106,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::PostFaintContactDamageAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "aca0779b8334fca6b4e05607524ed3726ee415629dd30860cb9b9ea44014ccbb",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 110,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::MoveDamageBoostAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "38e011df8faf41d051c28971850e7b1d660535329206a229f3e3ba72cf810ba8",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 111,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "649eb7da11c431cb2b13ed8bdaf2b18a6b432f2cf893512066bea43f502bba8e",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 115,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::WeatherDamage),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "46995010473632ba573cb1b9c0656c9ec04f5fe7fefd80cde82024ca8b36c33b",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 116,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "1d7eeba58edff9f8b1adc8df1ce9940c9fefef5ebd1574c0c57c03a10a001d9b",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 132,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::AlliedFieldDamageReductionAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "25aa13c991f2903ea629b0d4c91f0e6e61810d30e2c4411cf362fe9dfa51f861",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 136,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "0664864f80eabdc069f16c81d50a93cbe59b916b928f44a33e2e4be77dbf63dc",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 142,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::WeatherDamage),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "dfbfe56bddc8000a008e5d2bcdfd47cb98840df1df45f1bb75c56e62fd92dd03",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 146,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::WeatherDamage),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "f8d8eadea4da4db8b7454f4e85ee2f9232d15c027ce6b8caea0ecce2eed931c6",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 159,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::WeatherDamage),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "29ce442edf19dc998cc8f47603d3fefc4159d4eff128884a8352f4b1905acc03",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 160,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::PostDefendContactDamageAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "212fa7b5ec24aa2693227b84e50923f609c3e7d28f91c4a5d91cc29ae06c93ef",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 169,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "663cc288af54877131f61531541dc3c38ef2a468383ad71fe0d8aae79d7cdd76",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 185,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::MoveDamageBoostAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 4,
        provenance_hash: "09f0152bf67d153792d4fe991c7720416539934e4a7bb5a097e1d235b755701b",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 199,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedTypeDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "bf153272a8edf1e9796d25d59eb53a18928c0d7157a85e7319ee56fbd3119302",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 215,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::PostFaintHPDamageAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "a2a929379a9374a8d74b77914fe45fa22b476c8b97cf55b2ba94d1279a661410",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 218,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "a2a929379a9374a8d74b77914fe45fa22b476c8b97cf55b2ba94d1279a661410",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 218,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "56093cbb1ad8bf683c7553a2059e92ca02403d86609e91b2604a8a139b548819",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 231,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "09567a6f4726f143acc9e68f08301d19cc5732e03e9d23704e418627356a01ac",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 232,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "2cd992eddcf7d6d9730fb952233bc731a71c41f5c9167aa88716f956469d4567",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 244,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "d8a516bb6efa6ceaeb72a0c03da2352dda1139bfdd007f94b079b00c592711d1",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 246,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "c7da671fe733eb27465733c1c5bdaa181ea09bb31063e718b023a01b5451f3d7",
        source_kind: SourceKindTag::ActiveAbility,
        numeric_id: 272,
        registry_key: "",
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedTypeDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "70aca669cd2619dafc0c07bbe72dd05bce9012659f844d57bc3f7d427ce76361",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 8,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::WeatherDamage),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "35e9cd63f11d9f62053f58ce0425ac671d9cd22308276fa63ab267718c89b153",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 24,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::PostDefendContactDamageAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "746a9d953897d35f447e63f481f60ab3ad3c7e5af0ff9f4ee1feab438f9250e8",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 28,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::EncounterNatureSync,
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "4cd355b72b12326ef1a5b4b1a903da99448b242e57287f70437401f3263ec543",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 47,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedTypeDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "4cd355b72b12326ef1a5b4b1a903da99448b242e57287f70437401f3263ec543",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 47,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedTypeDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "e85cc70018a0052cb2054a9f9ec5a34cadc06a6a670deb948cc4d8e0bcb8a688",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 62,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::BypassBurnDamageReductionAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "8bd4379d40220008d27a8f254c2abefe7b38213d5315728bb87c991ae7ec8098",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 69,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::RecoilDamage),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "5a8c47e56017cc514e205168e32e20aa54f0498bfe545b5039b0e742ceb6c86b",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 81,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::WeatherDamage),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "17dcd1290cd3b5a179dacf970a7af35fa602b4d45ed7f55b2ead613b74ba86c3",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 85,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReduceBurnDamageAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "4db5b834d1b9691e44ffe5a5bc22318fbbce46ae1426ea5de2ce43d9da789247",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 85,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedTypeDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "836c3d658c32af9f30f18e572c7f9178ed2e2e561334ebc9525287adc29997bc",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 87,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedTypeDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 4,
        provenance_hash: "ae1abde2a4e243ab445bb3bae543e5610784be0afacb72b7bbdabb960cbd23a6",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 87,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::PostWeatherLapseDamageAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "ef5038a3a931bee0db2c79e114f3fc9beffe5fab24271d15e8d8691a87613284",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 90,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::StatusDamage),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "b2dc371b0b891076c73f06512d3eee7596082ec53a55979f2f35a84356b45297",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 94,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::PostWeatherLapseDamageAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "a6c73641abadc70a0dfc375afee5181512aa385fd50fa64b9b044f989c6802b4",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 98,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::NonDirectDamage),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "38d9b57bef15fcbb73b894e2f684728681f048c4c9e073307829bfc44bcc9a2e",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 106,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::PostFaintContactDamageAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "aca0779b8334fca6b4e05607524ed3726ee415629dd30860cb9b9ea44014ccbb",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 110,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::MoveDamageBoostAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "38e011df8faf41d051c28971850e7b1d660535329206a229f3e3ba72cf810ba8",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 111,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "649eb7da11c431cb2b13ed8bdaf2b18a6b432f2cf893512066bea43f502bba8e",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 115,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::WeatherDamage),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "46995010473632ba573cb1b9c0656c9ec04f5fe7fefd80cde82024ca8b36c33b",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 116,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "1d7eeba58edff9f8b1adc8df1ce9940c9fefef5ebd1574c0c57c03a10a001d9b",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 132,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::AlliedFieldDamageReductionAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "25aa13c991f2903ea629b0d4c91f0e6e61810d30e2c4411cf362fe9dfa51f861",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 136,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "0664864f80eabdc069f16c81d50a93cbe59b916b928f44a33e2e4be77dbf63dc",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 142,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::WeatherDamage),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "dfbfe56bddc8000a008e5d2bcdfd47cb98840df1df45f1bb75c56e62fd92dd03",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 146,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::WeatherDamage),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "f8d8eadea4da4db8b7454f4e85ee2f9232d15c027ce6b8caea0ecce2eed931c6",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 159,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::WeatherDamage),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "29ce442edf19dc998cc8f47603d3fefc4159d4eff128884a8352f4b1905acc03",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 160,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::PostDefendContactDamageAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "212fa7b5ec24aa2693227b84e50923f609c3e7d28f91c4a5d91cc29ae06c93ef",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 169,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "663cc288af54877131f61531541dc3c38ef2a468383ad71fe0d8aae79d7cdd76",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 185,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::MoveDamageBoostAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 4,
        provenance_hash: "09f0152bf67d153792d4fe991c7720416539934e4a7bb5a097e1d235b755701b",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 199,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedTypeDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "bf153272a8edf1e9796d25d59eb53a18928c0d7157a85e7319ee56fbd3119302",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 215,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::PostFaintHPDamageAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "a2a929379a9374a8d74b77914fe45fa22b476c8b97cf55b2ba94d1279a661410",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 218,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 2,
        provenance_hash: "a2a929379a9374a8d74b77914fe45fa22b476c8b97cf55b2ba94d1279a661410",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 218,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "56093cbb1ad8bf683c7553a2059e92ca02403d86609e91b2604a8a139b548819",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 231,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "09567a6f4726f143acc9e68f08301d19cc5732e03e9d23704e418627356a01ac",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 232,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "2cd992eddcf7d6d9730fb952233bc731a71c41f5c9167aa88716f956469d4567",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 244,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "d8a516bb6efa6ceaeb72a0c03da2352dda1139bfdd007f94b079b00c592711d1",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 246,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 1,
        provenance_hash: "c7da671fe733eb27465733c1c5bdaa181ea09bb31063e718b023a01b5451f3d7",
        source_kind: SourceKindTag::PassiveAbility,
        numeric_id: 272,
        registry_key: "",
        unit_kind: BehaviorUnitKind::PassiveAttribute,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedTypeDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "8719c6b34b170466467af31520c1bce41ce50767b4d4fb1a9221cf8121c6f38f",
        source_kind: SourceKindTag::BattlerTag,
        numeric_id: 0,
        registry_key: "MYSTERY_ENCOUNTER_POST_SUMMON",
        unit_kind: BehaviorUnitKind::BattlerTagBehavior,
        class: SpecialDamageUnitClass::ContentLoadIntrinsic,
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "c15cc3b06664c2cf1eb361d4d6ef6a140b428ae0ebb7b1104052864079538fb3",
        source_kind: SourceKindTag::BattlerTag,
        numeric_id: 0,
        registry_key: "RECEIVE_DOUBLE_DAMAGE",
        unit_kind: BehaviorUnitKind::BattlerTagBehavior,
        class: SpecialDamageUnitClass::ContentLoadIntrinsic,
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "639fe3d81cbbdeb848f523ae78ee9b52c1c0d0f032d1059d1907029dc089e862",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "RNG:src/data/elite-redux/archetypes/counter-attack-on-hit.ts:152:20:pokemon.randBattleSeedInt",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CounterOnHitArchetype,
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "08fde441f7fdd4b8d119e4b64ae4f3bd95d962f47cdf2f9b85bd53e0b0e3fa74",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/abilities/ab-attrs.ts:5633:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "244b1fd317dbb963514040238ccacd9a2e30435840bf1be63c38616c631c1314",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/abilities/ab-attrs.ts:6205:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "7779e194712ee809080db4f071cd2f22bbbc5119a71ba1b8bc886bcf459666c8",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/abilities/ab-attrs.ts:6244:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "d582d27059bfcd5614208b48dfcdf63630dea08df95d43a15f8350baa1a169d8",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/abilities/ab-attrs.ts:758:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "1318a4f506ad1aa98053a44cb366b22ec0f18533e39d433b4d90d115abd6a7cc",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/arena-tag.ts:959:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "430cdbc61a390abc359daac7a4a00568a1a18e545082e2f04bc05b112b013ef9",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/battler-tags.ts:1372:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "3120c1a63f4f90b15e50b479a64ab771faa71dacb90c1d0574cd0ed540412e24",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/battler-tags.ts:1489:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "18c2b04319b24df59f32f82e5164355b0444a53c40fefa00a2cfc9de6a7ddca5",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/battler-tags.ts:1540:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "9d44ce9505c4fc2d2607c48ae4bde49879d8736f0e3835329f5d18d0453b4ae3",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/battler-tags.ts:1929:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "8d53fb1a1023a83e416c0d66f90586a1b4ecba5c95256b34e9767f7cef5c66be",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/battler-tags.ts:2290:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "e5ade11e736c99f53e29c20415be6d8b36d57bdfd5c92bcc423a6c35c293814a",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/battler-tags.ts:2981:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "14e7bb0940a2558a5db9a2eed78bfb103106cbe042232883ad0763df9c5c5cc9",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/battler-tags.ts:3030:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "e98c30f137e65f9c9071df7821bfcdcbff46af8f21ae49d60c2445ad283af54f",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/battler-tags.ts:3324:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "50e9a9d9eec9fbfc800c33149f0f91ec60ab546d2cb535920e52c0bf41c4db6a",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/battler-tags.ts:4274:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "840a9ca3d9520f731ccf7a2644800e4dc9e9ffefbef9409515bf9cd4467cc92a",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/battler-tags.ts:4320:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "86df5f6f5dca6f69ec94f51d0f1196c3d1fe56ab48b55c26eba9323f7480c8ff",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/battler-tags.ts:4485:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "3baab5187be9b6061ba5fbd9f8860a170931aa8261522be4990498685aa5f837",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/battler-tags.ts:4597:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "bfdc0f110d520defaa76e241ae9cfedf15a64868298e18879eb2bb09e95cf364",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/battler-tags.ts:4598:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "f03ecc49f184ada290c1c977b9ad4ff7df8b66d598f483cf5890b34729e6f285",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/elite-redux/abilities/fakemon-pitch-mechanics.ts:1018:7:attr:SplashDamageAbAttr",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::DamageFormulaQuery(DamageQueryAttribute::SplashDamageAbAttr),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "8d3dd495384296408b78d521c0d0bfa925828d2a7b2d3e0ea546091439e8ad1a",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/elite-redux/abilities/fakemon-pitch-mechanics.ts:1022:7:attr:ReceivedMoveDamageMultiplierAbAttr",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "e5163ec523786eb8b992ab1dee3ea453a23d72c6ec8d5f973f62a8a21ee2b641",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/elite-redux/abilities/fakemon-pitch-mechanics.ts:1080:7:attr:ReceivedMoveDamageMultiplierAbAttr",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "70dc885d43907bc803555c3ae85a4c3c50107194b536603d27d01d244010e21a",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/elite-redux/abilities/fakemon-pitch-mechanics.ts:1086:7:attr:ReceivedMoveDamageMultiplierAbAttr",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "e8108a45e7bdb932b10c753ff3ed16abfec8d1cd1e80e3f5468ac942d5a526a9",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/elite-redux/abilities/fakemon-pitch-mechanics.ts:1098:7:attr:ReceivedMoveDamageMultiplierAbAttr",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "8f1542315c8a3c06b8c45e84ea92ffc235a3c517e2ed9d752eb412a86c378014",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/elite-redux/abilities/fakemon-pitch-mechanics.ts:1117:7:attr:ReceivedMoveDamageMultiplierAbAttr",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "d5e742ec35ca7bbad5797c1ad736f9226daca040904265db08ca8e0a385bb970",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/elite-redux/abilities/fakemon-pitch-mechanics.ts:1127:7:attr:BitterDrillDamageAbAttr",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::BitterDrillDamageAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "a01bf39d2ac5074315b903b444b92770a6a022c34cbfcc93c34a0991e02dd467",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/elite-redux/abilities/fakemon-pitch-mechanics.ts:1133:7:attr:CritDamageMultiplierAbAttr",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::CritDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "885559ef272107a706f032a51fc45ccbb499c6ff255c56c506adedb63ccb76ae",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/elite-redux/abilities/fakemon-pitch-mechanics.ts:1143:7:attr:BlockStatusDamageAbAttr",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::RecordGate(RecordGateKind::StatusDamage),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "ebf253454cb9f94cb0db5b2faf7fca028029242d3f6aef8a789a901b1a1ec9c7",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/elite-redux/abilities/post-turn-hurt-non-typed.ts:207:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "f268ff919ceec0722297c77cf63d8d55c742be91a70f27e2b08cc853abd95a7b",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/elite-redux/archetypes/lifesteal.ts:107:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "ea7a375185b8f1920a4f04f9ac240c0afa424a3bf245f9fead4b79ad0c334579",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/elite-redux/archetypes/on-faint-effect.ts:387:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "3acd62a9e51792400a2e1fd68887c4cbfb5b538344a1b331e39b7c50d073e3a4",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/elite-redux/archetypes/type-damage-boost.ts:257:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "4c6c051151586392b9a8f0b6642bad75ea89a44bf566a7670d526d9887387036",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/elite-redux/archetypes/type-damage-boost.ts:258:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "559dff6df9ee3e67e0b1dc72ab60d38240a3b0f0f2c833550117ae2bf3f78551",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/elite-redux/init-elite-redux-custom-abilities.ts:1175:5:attr:PostDefendContactDamageAbAttr",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::PostDefendContactDamageAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "c26b9a764ad50fb3d4412af7a04d513033fbb35914860f00566b88ef00851a6a",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/elite-redux/init-elite-redux-custom-abilities.ts:1176:5:attr:DamageReductionAbAttr",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::DamageReductionAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "7c3d476f4136edb7a2b81b34f2c3994b144f08dc0a404f5575b6aec3b51eead4",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/elite-redux/init-elite-redux-custom-abilities.ts:933:5:attr:ReceivedMoveDamageMultiplierAbAttr",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::DamageFormulaQuery(
            DamageQueryAttribute::ReceivedMoveDamageMultiplierAbAttr,
        ),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "4c179a09bb19b6836092a167f7cf3456b8a9ad338d15cd9cfa6dfa3985275323",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/moves/move.ts:2542:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "c7b24dcc2fb7d01ca44372029f5c9905e630ad56e7649dcd5847f907b9d7b8d3",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/moves/move.ts:2543:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "d6199ee1896c934835169b495ebb00f8ddbaddd6764ec626ec3470bbb8619ada",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/moves/move.ts:2690:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "4001626a9f2eed1ddd5379402bbf46cb4c8737cf8fc8da1b7b5aca5d53cade56",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/moves/move.ts:3004:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "f99367cb80e90dfd915c70dbc215fec2debda52777a3dd178ff9c0a4f5531658",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/data/moves/move.ts:7674:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "d7d85af8a62fe1fb53270f4c05bcf913b5f61adae46c96400aafe16b566902df",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/field/pokemon.ts:5860:applyMoveAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyMoveAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "97ca6f92dd567d715b8d51ea9bb2ece35d738b00649998bbb20b9ec1679e099f",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/field/pokemon.ts:5885:applyFilteredAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyFilteredAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "42e38373518a8a826cbcbc5cf4310330c72edfdf6b47136aec334a27e5d0cd49",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/field/pokemon.ts:6001:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "abe2de88db4379843502320249ce6d02d5524a9337a108c566dd14b56599e847",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/field/pokemon.ts:6022:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "9a02137a86b892f02dd9d64f55ec18af26fe2b36c5e3639ff975d030c9f70bb4",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/field/pokemon.ts:6051:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "18d5c06adccb7550a787244f10683fe6abd15b844d66351b61b6d9f72dac6080",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/field/pokemon.ts:6189:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "252dcb297a35d72874cda9fbbb38658267d35d4d1c951218045a3aa3435e4314",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/field/pokemon.ts:6274:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "649726ccc7fa8ec99064a9dea9339789f6dfdedac8da7eb0ce01027dc6d7cea6",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/field/pokemon.ts:6282:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "8bd037a96884d49f966180689407bcd3e55d5e96c0a7f9d3738a89e5eeb3f38f",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/field/pokemon.ts:6289:applyMoveAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyMoveAttrs),
    },
    RegistryEntry {
        ordinal: 0,
        provenance_hash: "78245bf28d153043672bcdce2047d6dd62e0597b61a3535c466c904da05d9a4a",
        source_kind: SourceKindTag::Bespoke,
        numeric_id: 0,
        registry_key: "src/field/pokemon.ts:6594:applyAbAttrs",
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        class: SpecialDamageUnitClass::CentralDispatchSite(DispatchSurface::ApplyAbAttrs),
    },
];

fn source_matches(entry: &RegistryEntry, source: &BehaviorSourceId) -> bool {
    match (entry.source_kind, source) {
        (SourceKindTag::Move, BehaviorSourceId::Move { numeric_id })
        | (SourceKindTag::ActiveAbility, BehaviorSourceId::ActiveAbility { numeric_id })
        | (SourceKindTag::PassiveAbility, BehaviorSourceId::PassiveAbility { numeric_id }) => {
            numeric_id.get() == entry.numeric_id
        }
        (SourceKindTag::BattlerTag, BehaviorSourceId::BattlerTag { registry_key })
        | (SourceKindTag::Bespoke, BehaviorSourceId::Bespoke { registry_key }) => {
            registry_key == entry.registry_key
        }
        _ => false,
    }
}

/// Classifies one behavior unit against the frozen 153-entry cluster
/// registry. Identity must match exactly (ordinal, hash, source kind, unit
/// kind); anything else is an [`SpecialDamageError::UnregisteredBehaviorUnit`].
pub fn classify_special_damage_unit(
    unit: &BehaviorUnitId,
) -> Result<SpecialDamageUnitClass, SpecialDamageError> {
    let entry = REGISTRY
        .iter()
        .find(|entry| {
            entry.ordinal == unit.ordinal.get()
                && entry.provenance_hash == unit.provenance_hash.as_str()
                && source_matches(entry, &unit.source)
                && entry.unit_kind == unit.unit_kind
        })
        .ok_or(SpecialDamageError::UnregisteredBehaviorUnit)?;
    Ok(entry.class)
}

/// Audited facts supplied to the dispatcher alongside a classified unit.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SpecialDamageDispatchRequestV2 {
    /// Gate decision for one received-damage fact.
    RecordAdmission {
        origin: DamageOrigin,
        gates: RecordGateSet,
    },
    /// Whether the on-hit archetype defender was hit by a direct damaging move.
    OnHitCounterDirectHit(bool),
    /// Whether the consulted party member holds SYNCHRONIZE during encounter
    /// materialization.
    EncounterNatureSync { holder_has_synchronize: bool },
}

/// Closed dispatch outcome with exact downstream executor identity.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SpecialDamageDispatchOutcomeV2 {
    RetaliationAmountPath {
        move_id: u16,
        multiplier: ExactRatioV2,
        filter: SpecialDamageFilter,
    },
    RetaliationRedirectPath {
        move_id: u16,
    },
    RecordAdmission(RecordAdmission),
    OnHitCounterArmed,
    OnHitCounterDormant,
    /// SYNCHRONIZE applied: the generated enemy adopts the holder's nature.
    EncounterNatureSyncApplied,
    /// The consulted member lacks SYNCHRONIZE: the generated nature stands.
    EncounterNatureSyncUnchanged,
    DamageQueryFold {
        attribute: DamageQueryAttribute,
        hook: MechanicHookV2,
        query: MechanicQueryV2,
    },
    DispatchLoop {
        surface: DispatchSurface,
    },
    ContentLoadIntrinsic,
}

/// Exhaustive dispatcher over the frozen cluster registry. Every classified
/// unit resolves to exactly one executable outcome; nothing is rejected as
/// unsupported.
pub fn dispatch_special_damage_unit(
    unit: &BehaviorUnitId,
    request: &SpecialDamageDispatchRequestV2,
) -> Result<SpecialDamageDispatchOutcomeV2, SpecialDamageError> {
    let class = classify_special_damage_unit(unit)?;
    Ok(match class {
        SpecialDamageUnitClass::RetaliationAmount => {
            let move_id = move_id_of(unit)?;
            let profile = retaliation_profile(move_id)?;
            SpecialDamageDispatchOutcomeV2::RetaliationAmountPath {
                move_id: profile.move_id,
                multiplier: profile.multiplier,
                filter: profile.filter,
            }
        }
        SpecialDamageUnitClass::RetaliationRedirect => {
            SpecialDamageDispatchOutcomeV2::RetaliationRedirectPath {
                move_id: move_id_of(unit)?,
            }
        }
        SpecialDamageUnitClass::RecordGate(_) => match request {
            SpecialDamageDispatchRequestV2::RecordAdmission { origin, gates } => {
                SpecialDamageDispatchOutcomeV2::RecordAdmission(gates.admit(*origin))
            }
            _ => return Err(SpecialDamageError::DispatchRequestMismatch),
        },
        SpecialDamageUnitClass::CounterOnHitArchetype => match request {
            SpecialDamageDispatchRequestV2::OnHitCounterDirectHit(true) => {
                // The archetype counters after consuming its bound audited
                // RNG site; kernel execution must go through that binding.
                SpecialDamageDispatchOutcomeV2::OnHitCounterArmed
            }
            SpecialDamageDispatchRequestV2::OnHitCounterDirectHit(false) => {
                SpecialDamageDispatchOutcomeV2::OnHitCounterDormant
            }
            _ => return Err(SpecialDamageError::DispatchRequestMismatch),
        },
        SpecialDamageUnitClass::DamageFormulaQuery { .. } => {
            let attribute = match class {
                SpecialDamageUnitClass::DamageFormulaQuery(attribute) => attribute,
                _ => unreachable!("classified as damage-formula query above"),
            };
            SpecialDamageDispatchOutcomeV2::DamageQueryFold {
                attribute,
                hook: MechanicHookV2::DamageQuery,
                query: MechanicQueryV2::Damage,
            }
        }
        SpecialDamageUnitClass::CentralDispatchSite(surface) => {
            SpecialDamageDispatchOutcomeV2::DispatchLoop { surface }
        }
        SpecialDamageUnitClass::ContentLoadIntrinsic => {
            SpecialDamageDispatchOutcomeV2::ContentLoadIntrinsic
        }
        SpecialDamageUnitClass::EncounterNatureSync => match request {
            SpecialDamageDispatchRequestV2::EncounterNatureSync {
                holder_has_synchronize,
            } => {
                if *holder_has_synchronize {
                    // Oracle: target.setNature(pokemon.getNature()) — the
                    // encounter transition installs the holder's nature.
                    SpecialDamageDispatchOutcomeV2::EncounterNatureSyncApplied
                } else {
                    // No SYNCHRONIZE holder consulted: generated nature stands.
                    SpecialDamageDispatchOutcomeV2::EncounterNatureSyncUnchanged
                }
            }
            _ => return Err(SpecialDamageError::DispatchRequestMismatch),
        },
    })
}

fn move_id_of(unit: &BehaviorUnitId) -> Result<u16, SpecialDamageError> {
    match unit.source {
        BehaviorSourceId::Move { numeric_id } => u16::try_from(numeric_id.get())
            .map_err(|_| SpecialDamageError::UnregisteredBehaviorUnit),
        _ => Err(SpecialDamageError::UnregisteredBehaviorUnit),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_state::bespoke_v2::special_damage::StoredDamageRequestV2;

    const OWNER: u8 = 0;
    const ENEMY_A: u8 = 2;
    const ENEMY_B: u8 = 3;
    const TURN: i64 = 11;

    fn hit(
        attacker_index: u8,
        move_category: u8,
        damage: u64,
        turn_index: i64,
    ) -> StoredDamageRequestV2 {
        StoredDamageRequestV2 {
            attacker_index,
            move_category,
            damage,
            turn_index,
        }
    }

    fn doubles_field(active: &[u8]) -> CounterFieldView<'_> {
        CounterFieldView {
            active_indices: active,
            battler_count: 2,
        }
    }

    #[test]
    fn profiles_match_the_frozen_move_mapping() {
        let counter = retaliation_profile(MOVE_COUNTER)
            .expect("profiles_match_the_frozen_move_mapping: fixture operation succeeds");
        assert_eq!(counter.multiplier.numerator, 2);
        assert_eq!(counter.multiplier.denominator, 1);
        assert_eq!(counter.filter, SpecialDamageFilter::Physical);

        let mirror_coat = retaliation_profile(MOVE_MIRROR_COAT)
            .expect("profiles_match_the_frozen_move_mapping: fixture operation succeeds");
        assert_eq!(mirror_coat.filter, SpecialDamageFilter::Special);

        for move_id in [MOVE_METAL_BURST, MOVE_COMEUPPANCE] {
            let burst = retaliation_profile(move_id)
                .expect("profiles_match_the_frozen_move_mapping: fixture operation succeeds");
            assert_eq!(burst.multiplier.numerator, 3);
            assert_eq!(burst.multiplier.denominator, 2);
            assert_eq!(burst.filter, SpecialDamageFilter::Both);
        }

        assert_eq!(
            retaliation_profile(1),
            Err(SpecialDamageError::UnsupportedRetaliationMove(1)),
        );
    }

    #[test]
    fn counter_retaliates_at_double_recorded_damage_against_the_attacker() {
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(ENEMY_A, 0, 100, TURN))
            .expect("counter_retaliates_at_double_recorded_damage_against_the_attacker: fixture operation succeeds");
        let (successor, transition) = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_COUNTER,
                owner_index: OWNER,
                turn_index: TURN,
                field: doubles_field(&[OWNER, ENEMY_A]),
            },
        )
        .expect("counter_retaliates_at_double_recorded_damage_against_the_attacker: fixture operation succeeds");
        assert_eq!(transition.retaliation_damage, 200);
        assert_eq!(
            transition.selection,
            CounterTargetSelection::Direct(ENEMY_A),
        );
        assert_eq!(transition.record.damage.get(), 100);
        assert_eq!(successor, state);
    }

    #[test]
    fn mirror_coat_rejects_wrong_category_without_consuming_records_or_rng() {
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(ENEMY_A, 0, 100, TURN))
            .expect("mirror_coat_rejects_wrong_category_without_consuming_records_or_rng: fixture operation succeeds");
        let outcome = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_MIRROR_COAT,
                owner_index: OWNER,
                turn_index: TURN,
                field: doubles_field(&[OWNER, ENEMY_A]),
            },
        );
        assert_eq!(outcome.expect_err("mirror_coat_rejects_wrong_category_without_consuming_records_or_rng: expected rejection"), SpecialDamageError::NoEligibleSource);
        assert_eq!(state.records.len(), 1);
    }

    #[test]
    fn metal_burst_rounds_down_and_enforces_the_frozen_minimum() {
        assert_eq!(
            compute_retaliation_amount(
                SafeU53::new(5).expect("metal_burst_rounds_down_and_enforces_the_frozen_minimum: fixture operation succeeds"),
                ExactRatioV2 {
                    numerator: 3,
                    denominator: 2
                }
            )
            .expect("metal_burst_rounds_down_and_enforces_the_frozen_minimum: fixture operation succeeds"),
            7,
        );
        assert_eq!(
            compute_retaliation_amount(
                SafeU53::new(1).expect("metal_burst_rounds_down_and_enforces_the_frozen_minimum: fixture operation succeeds"),
                ExactRatioV2 {
                    numerator: 3,
                    denominator: 2
                }
            )
            .expect("metal_burst_rounds_down_and_enforces_the_frozen_minimum: fixture operation succeeds"),
            TO_DMG_VALUE_MINIMUM,
        );
        assert_eq!(
            compute_retaliation_amount(
                SafeU53::new(0).expect("metal_burst_rounds_down_and_enforces_the_frozen_minimum: fixture operation succeeds"),
                ExactRatioV2 {
                    numerator: 2,
                    denominator: 1
                }
            )
            .expect("metal_burst_rounds_down_and_enforces_the_frozen_minimum: fixture operation succeeds"),
            TO_DMG_VALUE_MINIMUM,
        );
    }

    #[test]
    fn first_current_turn_match_wins_in_receipt_order() {
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(ENEMY_A, 1, 40, TURN))
            .expect("first_current_turn_match_wins_in_receipt_order: fixture operation succeeds")
            .record_attack(hit(ENEMY_B, 0, 90, TURN))
            .expect("first_current_turn_match_wins_in_receipt_order: fixture operation succeeds");
        let (_, transition) = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_METAL_BURST,
                owner_index: OWNER,
                turn_index: TURN,
                field: doubles_field(&[OWNER, ENEMY_A, ENEMY_B]),
            },
        )
        .expect("first_current_turn_match_wins_in_receipt_order: fixture operation succeeds");
        assert_eq!(transition.record.attacker_index, ENEMY_A);
        assert_eq!(
            transition.selection,
            CounterTargetSelection::Direct(ENEMY_A)
        );
        assert_eq!(transition.retaliation_damage, 60);
    }

    #[test]
    fn stale_turn_evidence_is_rejected() {
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(ENEMY_A, 0, 100, TURN - 1))
            .expect("stale_turn_evidence_is_rejected: fixture operation succeeds");
        let outcome = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_COUNTER,
                owner_index: OWNER,
                turn_index: TURN,
                field: doubles_field(&[OWNER, ENEMY_A]),
            },
        );
        assert_eq!(
            outcome.expect_err("stale_turn_evidence_is_rejected: expected rejection"),
            SpecialDamageError::StaleRecordsOnly
        );
    }

    #[test]
    fn ally_sourced_damage_is_never_eligible() {
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(1, 0, 100, TURN))
            .expect("ally_sourced_damage_is_never_eligible: fixture operation succeeds");
        let outcome = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_COUNTER,
                owner_index: OWNER,
                turn_index: TURN,
                field: doubles_field(&[OWNER, 1]),
            },
        );
        assert_eq!(
            outcome.expect_err("ally_sourced_damage_is_never_eligible: expected rejection"),
            SpecialDamageError::NoEligibleSource
        );
    }

    #[test]
    fn disappeared_source_falls_back_to_alive_same_side_battler_in_doubles() {
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(ENEMY_A, 0, 100, TURN))
            .expect("disappeared_source_falls_back_to_alive_same_side_battler_in_doubles: fixture operation succeeds");
        let (_, transition) = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_COUNTER,
                owner_index: OWNER,
                turn_index: TURN,
                field: doubles_field(&[OWNER, ENEMY_B]),
            },
        )
        .expect("disappeared_source_falls_back_to_alive_same_side_battler_in_doubles: fixture operation succeeds");
        assert_eq!(
            transition.selection,
            CounterTargetSelection::SideFallback {
                recorded_index: ENEMY_A,
                delivered_index: ENEMY_B,
            },
        );
    }

    #[test]
    fn fully_disappeared_side_yields_attacker_sentinel_and_failed_move() {
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(ENEMY_A, 0, 100, TURN))
            .expect("fully_disappeared_side_yields_attacker_sentinel_and_failed_move: fixture operation succeeds");
        let (successor, transition) = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_COUNTER,
                owner_index: OWNER,
                turn_index: TURN,
                field: doubles_field(&[OWNER]),
            },
        )
        .expect("fully_disappeared_side_yields_attacker_sentinel_and_failed_move: fixture operation succeeds");
        assert_eq!(
            transition.selection,
            CounterTargetSelection::AttackerSentinel {
                recorded_index: ENEMY_A
            },
        );
        assert_eq!(transition.selection.delivered_index(), None);
        assert_eq!(
            transition.outcome,
            RetaliationOutcome::FailedWithoutRedirect {
                recorded_index: ENEMY_A
            },
        );
        // Computation evidence is retained but never delivered.
        assert_eq!(transition.retaliation_damage, 200);
        assert_eq!(successor, state);
    }

    #[test]
    fn singles_skip_the_activity_check_like_the_oracle() {
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(ENEMY_A, 0, 10, TURN))
            .expect("singles_skip_the_activity_check_like_the_oracle: fixture operation succeeds");
        let (_, transition) = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_COUNTER,
                owner_index: OWNER,
                turn_index: TURN,
                field: CounterFieldView {
                    active_indices: &[OWNER],
                    battler_count: 1,
                },
            },
        )
        .expect("singles_skip_the_activity_check_like_the_oracle: fixture operation succeeds");
        assert_eq!(
            transition.selection,
            CounterTargetSelection::Direct(ENEMY_A)
        );
    }

    #[test]
    fn overflow_is_a_typed_failure_that_preserves_input() {
        let huge = SafeU53::MAX;
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(ENEMY_A, 0, huge.get(), TURN))
            .expect("overflow_is_a_typed_failure_that_preserves_input: fixture operation succeeds");
        let outcome = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_COUNTER,
                owner_index: OWNER,
                turn_index: TURN,
                field: doubles_field(&[OWNER, ENEMY_A]),
            },
        );
        assert_eq!(
            outcome
                .expect_err("overflow_is_a_typed_failure_that_preserves_input: expected rejection"),
            SpecialDamageError::ArithmeticOverflow
        );
        assert_eq!(state.records.len(), 1);
    }

    #[test]
    fn accumulated_release_uses_the_same_frozen_rounding_rule() {
        let opened = SpecialDamageStateV2::default()
            .begin_accumulation(TURN)
            .expect("accumulated_release_uses_the_same_frozen_rounding_rule: fixture operation succeeds");
        let hit_one = opened.record_attack(hit(ENEMY_A, 0, 30, TURN)).expect(
            "accumulated_release_uses_the_same_frozen_rounding_rule: fixture operation succeeds",
        );
        let closed = hit_one.close_accumulation_turn().expect(
            "accumulated_release_uses_the_same_frozen_rounding_rule: fixture operation succeeds",
        );
        let reopened = closed.open_next_accumulation_turn(TURN + 1).expect(
            "accumulated_release_uses_the_same_frozen_rounding_rule: fixture operation succeeds",
        );
        let hit_two = reopened
            .record_attack(hit(ENEMY_B, 1, 25, TURN + 1))
            .expect("accumulated_release_uses_the_same_frozen_rounding_rule: fixture operation succeeds");
        let (successor, transition) = execute_accumulated_release(
            &hit_two,
            ExactRatioV2 {
                numerator: 2,
                denominator: 1,
            },
        )
        .expect(
            "accumulated_release_uses_the_same_frozen_rounding_rule: fixture operation succeeds",
        );
        assert_eq!(transition.retaliation_damage, 110);
        assert!(!successor.accumulating);
        assert_eq!(successor.accumulated_damage.get(), 0);
        assert_eq!(
            execute_accumulated_release(
                &successor,
                ExactRatioV2 {
                    numerator: 2,
                    denominator: 1
                }
            )
            .expect_err(
                "accumulated_release_uses_the_same_frozen_rounding_rule: expected rejection"
            ),
            SpecialDamageError::State(SpecialDamageStateError::NotAccumulating),
        );
    }

    #[test]
    fn reset_clears_every_family_state_surface() {
        let opened = SpecialDamageStateV2::default()
            .begin_accumulation(TURN)
            .expect("reset_clears_every_family_state_surface: fixture operation succeeds");
        let hit_one = opened
            .record_attack(hit(ENEMY_A, 0, 30, TURN))
            .expect("reset_clears_every_family_state_surface: fixture operation succeeds");
        let cleared = hit_one.clear_record_window();
        assert!(cleared.records.is_empty());
        assert_eq!(cleared.reset(), SpecialDamageStateV2::default());
    }
    // ===== Frozen registry, gate, and dispatch tests =====

    use er_types::m6::{BehaviorUnitOrdinal, ProvenanceHash};

    fn unit(move_id: u64, ordinal: u32, hash: &str) -> BehaviorUnitId {
        BehaviorUnitId {
            source: BehaviorSourceId::Move {
                numeric_id: SafeU53::new(move_id).expect("unit: fixture operation succeeds"),
            },
            unit_kind: BehaviorUnitKind::MoveAttribute,
            ordinal: BehaviorUnitOrdinal::new(ordinal),
            provenance_hash: ProvenanceHash::parse(hash).expect("unit: fixture operation succeeds"),
        }
    }

    #[test]
    fn registry_covers_exactly_153_unique_units() {
        assert_eq!(REGISTRY.len(), SPECIAL_DAMAGE_REGISTRY_LEN);
        let keys: Vec<(u32, &str)> = REGISTRY
            .iter()
            .map(|e| (e.ordinal, e.provenance_hash))
            .collect();
        let unique = keys
            .iter()
            .zip(keys.iter().skip(1))
            .all(|(a, b)| a.0 != b.0 || a.1 != b.1);
        assert!(unique);
        for entry in REGISTRY {
            assert_eq!(entry.provenance_hash.len(), 64);
            assert!(ProvenanceHash::parse(entry.provenance_hash).is_ok());
        }
    }

    #[test]
    fn classifies_known_units_from_every_closed_class() {
        // CounterDamageAttr amount path for MOVE 68 (Counter), ordinal 1.
        let counter_amount = unit(
            68,
            1,
            "5c05dc43f69412ce8344ab9f03d6e29d7aacace1bd4e7571758e0c6f5cc40cf4",
        );
        assert_eq!(
            classify_special_damage_unit(&counter_amount).expect(
                "classifies_known_units_from_every_closed_class: fixture operation succeeds"
            ),
            SpecialDamageUnitClass::RetaliationAmount,
        );
        // HitsTagForDoubleDamageAttr for MOVE 16, ordinal 0.
        let hits_tag = unit(
            16,
            0,
            "0603d573a1ff5e28e9150dbaa22d027ad6d44c61a3124566462ca6fd3b6bbed2",
        );
        assert_eq!(
            classify_special_damage_unit(&hits_tag).expect(
                "classifies_known_units_from_every_closed_class: fixture operation succeeds"
            ),
            SpecialDamageUnitClass::DamageFormulaQuery(
                DamageQueryAttribute::HitsTagForDoubleDamageAttr
            ),
        );
        // SYNCHRONIZE encounter-nature sync (ability 28; the active and
        // passive slots share one provenance hash, active is ordinal 2).
        let synchronize_active = BehaviorUnitId {
            source: BehaviorSourceId::ActiveAbility {
                numeric_id: SafeU53::new(28).expect(
                    "classifies_known_units_from_every_closed_class: fixture operation succeeds",
                ),
            },
            unit_kind: BehaviorUnitKind::AbilityAttribute,
            ordinal: BehaviorUnitOrdinal::new(2),
            provenance_hash: ProvenanceHash::parse(
                "746a9d953897d35f447e63f481f60ab3ad3c7e5af0ff9f4ee1feab438f9250e8",
            )
            .expect("classifies_known_units_from_every_closed_class: fixture operation succeeds"),
        };
        assert_eq!(
            classify_special_damage_unit(&synchronize_active).expect(
                "classifies_known_units_from_every_closed_class: fixture operation succeeds"
            ),
            SpecialDamageUnitClass::EncounterNatureSync,
        );
        let synchronize_passive = BehaviorUnitId {
            source: BehaviorSourceId::PassiveAbility {
                numeric_id: SafeU53::new(28).expect(
                    "classifies_known_units_from_every_closed_class: fixture operation succeeds",
                ),
            },
            unit_kind: BehaviorUnitKind::PassiveAttribute,
            ordinal: BehaviorUnitOrdinal::new(2),
            provenance_hash: ProvenanceHash::parse(
                "746a9d953897d35f447e63f481f60ab3ad3c7e5af0ff9f4ee1feab438f9250e8",
            )
            .expect("classifies_known_units_from_every_closed_class: fixture operation succeeds"),
        };
        assert_eq!(
            classify_special_damage_unit(&synchronize_passive).expect(
                "classifies_known_units_from_every_closed_class: fixture operation succeeds"
            ),
            SpecialDamageUnitClass::EncounterNatureSync,
        );
        // Unknown identity fails closed.
        let stranger = unit(
            68,
            9,
            "5c05dc43f69412ce8344ab9f03d6e29d7aacace1bd4e7571758e0c6f5cc40cf4",
        );
        assert_eq!(
            classify_special_damage_unit(&stranger),
            Err(SpecialDamageError::UnregisteredBehaviorUnit),
        );
    }

    #[test]
    fn dispatch_resolves_each_class_to_a_closed_outcome() -> Result<(), String> {
        let counter_amount = unit(
            68,
            1,
            "5c05dc43f69412ce8344ab9f03d6e29d7aacace1bd4e7571758e0c6f5cc40cf4",
        );
        let any_request = &SpecialDamageDispatchRequestV2::OnHitCounterDirectHit(false);
        match dispatch_special_damage_unit(&counter_amount, any_request)
            .expect("dispatch_resolves_each_class_to_a_closed_outcome: fixture operation succeeds")
        {
            SpecialDamageDispatchOutcomeV2::RetaliationAmountPath {
                move_id,
                multiplier,
                filter,
            } => {
                assert_eq!(move_id, MOVE_COUNTER);
                assert_eq!(multiplier.numerator, 2);
                assert_eq!(filter, SpecialDamageFilter::Physical);
            }
            other => return Err(format!("unexpected outcome: {other:?}")),
        }

        let hits_tag = unit(
            16,
            0,
            "0603d573a1ff5e28e9150dbaa22d027ad6d44c61a3124566462ca6fd3b6bbed2",
        );
        match dispatch_special_damage_unit(&hits_tag, any_request)
            .expect("dispatch_resolves_each_class_to_a_closed_outcome: fixture operation succeeds")
        {
            SpecialDamageDispatchOutcomeV2::DamageQueryFold {
                attribute,
                hook,
                query,
            } => {
                assert_eq!(attribute, DamageQueryAttribute::HitsTagForDoubleDamageAttr);
                assert_eq!(hook, MechanicHookV2::DamageQuery);
                assert_eq!(query, MechanicQueryV2::Damage);
            }
            other => return Err(format!("unexpected outcome: {other:?}")),
        }

        let on_hit_site = BehaviorUnitId {
            source: BehaviorSourceId::Bespoke {
                registry_key: "RNG:src/data/elite-redux/archetypes/counter-attack-on-hit.ts:152:20:pokemon.randBattleSeedInt".to_string(),
            },
            unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
            ordinal: BehaviorUnitOrdinal::new(0),
            provenance_hash: ProvenanceHash::parse(
                "639fe3d81cbbdeb848f523ae78ee9b52c1c0d0f032d1059d1907029dc089e862",
            )
            .expect("dispatch_resolves_each_class_to_a_closed_outcome: fixture operation succeeds"),
        };
        assert_eq!(
            dispatch_special_damage_unit(
                &on_hit_site,
                &SpecialDamageDispatchRequestV2::OnHitCounterDirectHit(true),
            )
            .expect("dispatch_resolves_each_class_to_a_closed_outcome: fixture operation succeeds"),
            SpecialDamageDispatchOutcomeV2::OnHitCounterArmed,
        );
        assert_eq!(
            dispatch_special_damage_unit(
                &on_hit_site,
                &SpecialDamageDispatchRequestV2::OnHitCounterDirectHit(false),
            )
            .expect("dispatch_resolves_each_class_to_a_closed_outcome: fixture operation succeeds"),
            SpecialDamageDispatchOutcomeV2::OnHitCounterDormant,
        );

        let synchronize_active = BehaviorUnitId {
            source: BehaviorSourceId::ActiveAbility {
                numeric_id: SafeU53::new(28).expect(
                    "dispatch_resolves_each_class_to_a_closed_outcome: fixture operation succeeds",
                ),
            },
            unit_kind: BehaviorUnitKind::AbilityAttribute,
            ordinal: BehaviorUnitOrdinal::new(2),
            provenance_hash: ProvenanceHash::parse(
                "746a9d953897d35f447e63f481f60ab3ad3c7e5af0ff9f4ee1feab438f9250e8",
            )
            .expect("dispatch_resolves_each_class_to_a_closed_outcome: fixture operation succeeds"),
        };
        let synchronize_holder = &SpecialDamageDispatchRequestV2::EncounterNatureSync {
            holder_has_synchronize: true,
        };
        assert_eq!(
            dispatch_special_damage_unit(&synchronize_active, synchronize_holder).expect(
                "dispatch_resolves_each_class_to_a_closed_outcome: fixture operation succeeds"
            ),
            SpecialDamageDispatchOutcomeV2::EncounterNatureSyncApplied,
        );
        assert_eq!(
            dispatch_special_damage_unit(
                &synchronize_active,
                &SpecialDamageDispatchRequestV2::EncounterNatureSync {
                    holder_has_synchronize: false,
                },
            )
            .expect("dispatch_resolves_each_class_to_a_closed_outcome: fixture operation succeeds"),
            SpecialDamageDispatchOutcomeV2::EncounterNatureSyncUnchanged,
        );

        // Gate units reject mismatched requests instead of guessing.
        let weather_gate_unit = REGISTRY
            .iter()
            .find(|e| e.class == SpecialDamageUnitClass::RecordGate(RecordGateKind::WeatherDamage))
            .expect("dispatch_resolves_each_class_to_a_closed_outcome: fixture operation succeeds");
        let weather_gate_id = registry_entry_to_id(weather_gate_unit);
        assert_eq!(
            dispatch_special_damage_unit(&weather_gate_id, any_request),
            Err(SpecialDamageError::DispatchRequestMismatch),
        );
        Ok(())
    }

    fn registry_entry_to_id(entry: &RegistryEntry) -> BehaviorUnitId {
        BehaviorUnitId {
            source: match entry.source_kind {
                SourceKindTag::Move => BehaviorSourceId::Move {
                    numeric_id: SafeU53::new(entry.numeric_id)
                        .expect("registry_entry_to_id: fixture operation succeeds"),
                },
                SourceKindTag::ActiveAbility => BehaviorSourceId::ActiveAbility {
                    numeric_id: SafeU53::new(entry.numeric_id)
                        .expect("registry_entry_to_id: fixture operation succeeds"),
                },
                SourceKindTag::PassiveAbility => BehaviorSourceId::PassiveAbility {
                    numeric_id: SafeU53::new(entry.numeric_id)
                        .expect("registry_entry_to_id: fixture operation succeeds"),
                },
                SourceKindTag::BattlerTag => BehaviorSourceId::BattlerTag {
                    registry_key: entry.registry_key.to_string(),
                },
                SourceKindTag::Bespoke => BehaviorSourceId::Bespoke {
                    registry_key: entry.registry_key.to_string(),
                },
            },
            unit_kind: entry.unit_kind,
            ordinal: BehaviorUnitOrdinal::new(entry.ordinal),
            provenance_hash: ProvenanceHash::parse(entry.provenance_hash)
                .expect("registry_entry_to_id: fixture operation succeeds"),
        }
    }

    #[test]
    fn record_gates_admit_direct_moves_and_block_audited_origins() {
        let open = RecordGateSet {
            non_direct_damage: false,
            weather_damage: false,
            status_damage: false,
            recoil_damage: false,
        };
        let all = RecordGateSet {
            non_direct_damage: true,
            weather_damage: true,
            status_damage: true,
            recoil_damage: true,
        };
        // Direct move damage is never gated.
        assert_eq!(
            open.admit(DamageOrigin::DirectMove(SpecialDamageCategory::Physical)),
            RecordAdmission::Admitted,
        );
        assert_eq!(
            all.admit(DamageOrigin::DirectMove(SpecialDamageCategory::Special)),
            RecordAdmission::Admitted,
        );
        // Non-direct blocker dominates the specific gates deterministically.
        assert_eq!(
            all.admit(DamageOrigin::Weather),
            RecordAdmission::DeniedBy(RecordGateKind::NonDirectDamage),
        );
        assert_eq!(
            RecordGateSet {
                non_direct_damage: false,
                ..all
            }
            .admit(DamageOrigin::Weather),
            RecordAdmission::DeniedBy(RecordGateKind::WeatherDamage),
        );
        assert_eq!(
            RecordGateSet {
                non_direct_damage: false,
                ..all
            }
            .admit(DamageOrigin::Status),
            RecordAdmission::DeniedBy(RecordGateKind::StatusDamage),
        );
        assert_eq!(
            RecordGateSet {
                non_direct_damage: false,
                ..all
            }
            .admit(DamageOrigin::Recoil),
            RecordAdmission::DeniedBy(RecordGateKind::RecoilDamage),
        );
        assert_eq!(open.admit(DamageOrigin::Weather), RecordAdmission::Admitted);
    }

    #[test]
    fn gated_admission_feeds_the_retaliation_pipeline_end_to_end() {
        let gates = RecordGateSet {
            non_direct_damage: false,
            weather_damage: false,
            status_damage: false,
            recoil_damage: false,
        };
        // A weather tick is admitted when no blocker is active and then
        // records like any other received damage.
        assert_eq!(
            gates.admit(DamageOrigin::Weather),
            RecordAdmission::Admitted,
        );
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(ENEMY_A, 0, 40, TURN))
            .expect("gated_admission_feeds_the_retaliation_pipeline_end_to_end: fixture operation succeeds");
        let (_, transition) = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_COUNTER,
                owner_index: OWNER,
                turn_index: TURN,
                field: doubles_field(&[OWNER, ENEMY_A]),
            },
        )
        .expect(
            "gated_admission_feeds_the_retaliation_pipeline_end_to_end: fixture operation succeeds",
        );
        assert_eq!(
            transition.outcome,
            RetaliationOutcome::Delivered { damage: 80 },
        );
    }
    #[test]
    fn every_registered_unit_dispatches_with_zero_residual() {
        let any_request = &SpecialDamageDispatchRequestV2::OnHitCounterDirectHit(false);
        let open_gates = RecordGateSet {
            non_direct_damage: false,
            weather_damage: false,
            status_damage: false,
            recoil_damage: false,
        };
        let mut retaliation = 0usize;
        let mut redirect = 0usize;
        let mut gates = [0usize; 4];
        let mut query = 0usize;
        let mut sites = [0usize; 3];
        let mut on_hit = 0usize;
        let mut intrinsics = 0usize;
        let mut nature_sync = 0usize;
        for entry in REGISTRY {
            let id = registry_entry_to_id(entry);
            let outcome = match entry.class {
                SpecialDamageUnitClass::RetaliationAmount => {
                    retaliation += 1;
                    dispatch_special_damage_unit(&id, any_request)
                }
                SpecialDamageUnitClass::RetaliationRedirect => {
                    redirect += 1;
                    dispatch_special_damage_unit(&id, any_request)
                }
                SpecialDamageUnitClass::RecordGate(kind) => {
                    gates[kind as usize] += 1;
                    dispatch_special_damage_unit(
                        &id,
                        &SpecialDamageDispatchRequestV2::RecordAdmission {
                            origin: DamageOrigin::Weather,
                            gates: open_gates,
                        },
                    )
                }
                SpecialDamageUnitClass::CounterOnHitArchetype => {
                    on_hit += 1;
                    dispatch_special_damage_unit(
                        &id,
                        &SpecialDamageDispatchRequestV2::OnHitCounterDirectHit(true),
                    )
                }
                SpecialDamageUnitClass::DamageFormulaQuery(_) => {
                    query += 1;
                    dispatch_special_damage_unit(&id, any_request)
                }
                SpecialDamageUnitClass::CentralDispatchSite(_) => {
                    sites[match entry.class {
                        SpecialDamageUnitClass::CentralDispatchSite(
                            DispatchSurface::ApplyAbAttrs,
                        ) => 0,
                        SpecialDamageUnitClass::CentralDispatchSite(
                            DispatchSurface::ApplyFilteredAbAttrs,
                        ) => 1,
                        _ => 2,
                    }] += 1;
                    dispatch_special_damage_unit(&id, any_request)
                }
                SpecialDamageUnitClass::ContentLoadIntrinsic => {
                    intrinsics += 1;
                    dispatch_special_damage_unit(&id, any_request)
                }
                SpecialDamageUnitClass::EncounterNatureSync => {
                    nature_sync += 1;
                    dispatch_special_damage_unit(
                        &id,
                        &SpecialDamageDispatchRequestV2::EncounterNatureSync {
                            holder_has_synchronize: true,
                        },
                    )
                }
            };
            assert!(
                outcome.is_ok(),
                "unit {} failed to dispatch: {:?}",
                entry.provenance_hash,
                outcome.err(),
            );
        }
        // Exact frozen lane counts derived from bespoke-clusters-v1.json.
        assert_eq!(REGISTRY.len(), SPECIAL_DAMAGE_REGISTRY_LEN);
        assert_eq!(SPECIAL_DAMAGE_REGISTRY_LEN, 153);
        assert_eq!(retaliation, 4);
        assert_eq!(redirect, 0);
        assert_eq!(
            gates,
            [2, 12, 3, 2],
            "gates must be [NonDirect, Weather, Status, Recoil]",
        );
        assert_eq!(query, 87);
        assert_eq!(
            sites,
            [35, 1, 2],
            "sites must be [AbAttrs, FilteredAbAttrs, MoveAttrs]"
        );
        assert_eq!(on_hit, 1);
        assert_eq!(intrinsics, 2);
        assert_eq!(nature_sync, 2);
        // The lanes sum to the exact frozen total: zero rejected, zero residual.
        let total = retaliation
            + redirect
            + gates[0]
            + gates[1]
            + gates[2]
            + gates[3]
            + query
            + sites[0]
            + sites[1]
            + sites[2]
            + on_hit
            + intrinsics
            + nature_sync;
        assert_eq!(total, SPECIAL_DAMAGE_REGISTRY_LEN);
    }
}
