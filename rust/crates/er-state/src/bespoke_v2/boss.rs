//! Canonical typed state for the closed `BOSS_CUSTOM_ER` bespoke family.
//!
//! The family owns ER boss-only fixed-dispatch behavior: boss-bar segments,
//! phase/threshold planning, shield grants, scripted-action unlocks, the
//! one-time trigger ledger, and the admission ledger for externally supplied
//! audited draws at the single frozen RNG site
//! `RNG:src/data/elite-redux/er-trainer-runtime-hook.ts:938:17:boss.randBattleSeedInt`.
//! Identities here mirror the pinned M6 fixtures
//! (`rust/fixtures/m6/bespoke-clusters-v1.json`, `rng-site-manifest-v1.json`,
//! and `oracle-witness-plan-v1.json`). Mechanics and pure transitions live in
//! `er-battle/src/m6/bespoke/boss.rs`.

use std::collections::BTreeSet;

use er_types::mechanics::MechanicScope;
use er_types::{
    BehaviorSourceId, BehaviorUnitId, BehaviorUnitKind, BehaviorUnitOrdinal, ProvenanceHash,
    RngSiteId, RngSiteOrdinal, SafeU53,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Schema version of this bespoke family's canonical state.
pub const BOSS_STATE_SCHEMA_VERSION: u32 = 1;

/// Frozen provenance hash of the `BOSS_CUSTOM_ER` behavior unit
/// (bespoke-clusters-v1.json, ordinal 0).
pub const BOSS_OWNER_PROVENANCE_HASH: &str =
    "b0fe628993091a058fd71026b19ee1981ae457afe37823435c9cbb3c9b5e2787";

/// Frozen registry key of the single boss RNG call site
/// (`boss.randBattleSeedInt(6)` at `er-trainer-runtime-hook.ts:938:17`).
pub const BOSS_FROZEN_RNG_REGISTRY_KEY: &str =
    "RNG:src/data/elite-redux/er-trainer-runtime-hook.ts:938:17:boss.randBattleSeedInt";

/// Frozen provenance hash of that site's manifest identity
/// (rng-site-manifest-v1.json, execution ordinal 2).
pub const BOSS_FROZEN_RNG_SITE_PROVENANCE_HASH: &str =
    "8b45ad4919d6e3b96286ddf9560b7ac4dc41fef80883fed673a31b84a475090b";

/// Manifest ordinal of the frozen boss RNG site.
pub const BOSS_FROZEN_RNG_SITE_ORDINAL: u32 = 2;

/// Closed cardinality of the frozen boss draw (`randBattleSeedInt(6)`).
pub const BOSS_FROZEN_RNG_CARDINALITY: u64 = 6;

/// Maximum supported boss-bar segment count (2-bar and 3-bar bosses).
pub const BOSS_MAX_SEGMENTS: u8 = 3;

/// Maximum shield charges grantable by a single phase transition.
pub const BOSS_MAX_SHIELD_CHARGES: u8 = 3;

/// Returns the frozen `BOSS_CUSTOM_ER` owner identity.
///
/// # Panics
/// Never: the pinned hash is validated at fixture-freeze time.
pub fn boss_owner_unit() -> BehaviorUnitId {
    BehaviorUnitId {
        source: BehaviorSourceId::Bespoke {
            registry_key: BOSS_FROZEN_RNG_REGISTRY_KEY.to_owned(),
        },
        unit_kind: BehaviorUnitKind::FixedDispatchBehavior,
        ordinal: BehaviorUnitOrdinal::new(0),
        provenance_hash: ProvenanceHash::parse(BOSS_OWNER_PROVENANCE_HASH)
            .expect("pinned boss owner provenance hash"),
    }
}

/// Returns the frozen boss RNG site identity.
pub fn frozen_rng_site_id() -> RngSiteId {
    RngSiteId {
        ordinal: RngSiteOrdinal::new(BOSS_FROZEN_RNG_SITE_ORDINAL),
        provenance_hash: ProvenanceHash::parse(BOSS_FROZEN_RNG_SITE_PROVENANCE_HASH)
            .expect("pinned boss RNG-site provenance hash"),
    }
}

/// One HP-fraction phase boundary in canonical crossing order.
///
/// Boundaries are stored strictly descending by HP fraction: the first entry
/// is the first boundary lost as damage accumulates. Crossing a boundary is a
/// one-time event keyed by `trigger_id`.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BossPhaseBoundaryV1 {
    /// Stable one-time trigger identity; positive and unique within a plan.
    pub trigger_id: u32,
    /// Boundary as an exact HP fraction `numerator / denominator` of max HP.
    /// Both are positive and the fraction is strictly below full HP.
    pub hp_fraction_numerator: u32,
    pub hp_fraction_denominator: u32,
    /// Phase entered when this boundary fires; strictly increasing along the
    /// crossing order and at least 1.
    pub phase_index: u8,
    /// Shield charges granted deterministically on entry.
    pub shield_charges: u8,
    /// Scripted action slot unlocked on entry.
    pub scripted_action_slot: Option<u8>,
}

impl BossPhaseBoundaryV1 {
    /// Exact comparison `self.fraction > other.fraction` without division.
    fn fraction_greater_than(&self, other: &Self) -> bool {
        (u64::from(self.hp_fraction_numerator) * u64::from(other.hp_fraction_denominator))
            > (u64::from(other.hp_fraction_numerator) * u64::from(self.hp_fraction_denominator))
    }

    pub fn validate(&self) -> Result<(), BossStateErrorV1> {
        if self.trigger_id == 0 {
            return Err(BossStateErrorV1::ZeroTriggerId);
        }
        if self.hp_fraction_denominator == 0 || self.hp_fraction_numerator == 0 {
            return Err(BossStateErrorV1::DegenerateBoundaryFraction);
        }
        if self.hp_fraction_numerator >= self.hp_fraction_denominator {
            return Err(BossStateErrorV1::BoundaryAtOrAboveFullHp);
        }
        if self.phase_index == 0 {
            return Err(BossStateErrorV1::ZeroPhaseIndex);
        }
        if self.shield_charges > BOSS_MAX_SHIELD_CHARGES {
            return Err(BossStateErrorV1::ShieldChargesAboveCeiling {
                max: BOSS_MAX_SHIELD_CHARGES,
            });
        }
        Ok(())
    }
}

/// Canonical boss state for one boss battler.
///
/// All mutation happens through pure transitions in the owning battle crate;
/// every transition validates, clones, applies, re-validates, and returns.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BossCustomErStateV1 {
    pub schema_version: u32,
    /// Battler scope carrying the boss surface; must be a Pokemon scope.
    pub subject: MechanicScope,
    pub owner: BehaviorUnitId,
    /// Total boss bars; between 1 and [`BOSS_MAX_SEGMENTS`].
    pub segments_total: u8,
    pub segments_remaining: u8,
    /// Current phase; 0 until the first boundary fires.
    pub current_phase: u8,
    pub shield_active: bool,
    pub shield_charges: u8,
    /// Phase plan in canonical crossing order (strictly descending fraction).
    pub boundaries: Vec<BossPhaseBoundaryV1>,
    /// One-time trigger ledger in firing order; IDs unique.
    pub fired_triggers: Vec<u32>,
    /// Admitted draws at the frozen site, in admission order.
    pub rng_admissions: u32,
    /// Audit sequence of the most recently admitted draw.
    pub last_rng_sequence: Option<SafeU53>,
    /// Result (< [`BOSS_FROZEN_RNG_CARDINALITY`]) of that draw.
    pub last_rng_result: Option<SafeU53>,
    /// Set once by terminal cleanup; retired states reject every transition.
    pub terminal: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BossStateErrorV1 {
    #[error(
        "boss state schema version must be {expected}, got {actual}"
    )]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("boss subject scope must address exactly one Pokemon")]
    SubjectNotPokemon,
    #[error("boss owner must be the frozen BOSS_CUSTOM_ER behavior unit")]
    OwnerNotFrozenUnit,
    #[error("boss segment total must be between 1 and {max}")]
    SegmentTotalOutOfRange { max: u8 },
    #[error("remaining boss segments cannot exceed the segment total")]
    RemainingSegmentsAboveTotal,
    #[error("boss boundary trigger ID must be positive")]
    ZeroTriggerId,
    #[error("boss boundary HP fraction is degenerate: numerator and denominator must both be positive")]
    DegenerateBoundaryFraction,
    #[error("boss boundary HP fraction must be strictly below full HP")]
    BoundaryAtOrAboveFullHp,
    #[error("boss boundary phase index must be positive")]
    ZeroPhaseIndex,
    #[error("boss shield charges exceed the ceiling of {max}")]
    ShieldChargesAboveCeiling { max: u8 },
    #[error("boss boundaries must be strictly ordered by descending HP fraction")]
    BoundariesOutOfOrder,
    #[error("boss boundary phase indices must strictly increase along crossing order")]
    PhaseIndicesOutOfOrder,
    #[error("boss boundary trigger IDs must be unique within the plan")]
    DuplicateBoundaryTriggerId,
    #[error("fired boss trigger IDs must be positive and unique")]
    LedgerInvalid,
    #[error("shield charges require an active shield")]
    ShieldChargesWithoutActiveShield,
    #[error("an active shield requires at least one charge")]
    ActiveShieldWithoutCharges,
    #[error("current phase cannot exceed the highest planned phase")]
    PhaseBeyondPlan,
    #[error("RNG admission counters disagree with the admitted-draw ledger")]
    RngLedgerInconsistent,
}

impl BossCustomErStateV1 {
    /// Creates a fresh pre-battle state with `segments_total` boss bars and
    /// the given phase plan.
    pub fn new(
        subject: MechanicScope,
        segments_total: u8,
        boundaries: Vec<BossPhaseBoundaryV1>,
    ) -> Self {
        Self {
            schema_version: BOSS_STATE_SCHEMA_VERSION,
            subject,
            owner: boss_owner_unit(),
            segments_total,
            segments_remaining: segments_total,
            current_phase: 0,
            shield_active: false,
            shield_charges: 0,
            boundaries,
            fired_triggers: Vec::new(),
            rng_admissions: 0,
            last_rng_sequence: None,
            last_rng_result: None,
            terminal: false,
        }
    }

    pub fn validate(&self) -> Result<(), BossStateErrorV1> {
        if self.schema_version != BOSS_STATE_SCHEMA_VERSION {
            return Err(BossStateErrorV1::SchemaVersion {
                expected: BOSS_STATE_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        if !matches!(self.subject, MechanicScope::Pokemon { .. }) {
            return Err(BossStateErrorV1::SubjectNotPokemon);
        }
        if self.owner != boss_owner_unit() {
            return Err(BossStateErrorV1::OwnerNotFrozenUnit);
        }
        if self.segments_total == 0 || self.segments_total > BOSS_MAX_SEGMENTS {
            return Err(BossStateErrorV1::SegmentTotalOutOfRange {
                max: BOSS_MAX_SEGMENTS,
            });
        }
        if self.segments_remaining > self.segments_total {
            return Err(BossStateErrorV1::RemainingSegmentsAboveTotal);
        }
        let mut previous_boundary: Option<&BossPhaseBoundaryV1> = None;
        let mut seen_triggers = BTreeSet::new();
        let mut highest_phase: u8 = 0;
        for boundary in &self.boundaries {
            boundary.validate()?;
            if let Some(previous) = previous_boundary {
                if !previous.fraction_greater_than(boundary) {
                    return Err(BossStateErrorV1::BoundariesOutOfOrder);
                }
                if previous.phase_index >= boundary.phase_index {
                    return Err(BossStateErrorV1::PhaseIndicesOutOfOrder);
                }
            }
            if !seen_triggers.insert(boundary.trigger_id) {
                return Err(BossStateErrorV1::DuplicateBoundaryTriggerId);
            }
            highest_phase = highest_phase.max(boundary.phase_index);
            previous_boundary = Some(boundary);
        }
        let mut previous_trigger: Option<u32> = None;
        for trigger_id in &self.fired_triggers {
            if *trigger_id == 0 {
                return Err(BossStateErrorV1::LedgerInvalid);
            }
            if previous_trigger.is_some_and(|previous| *trigger_id <= previous) {
                // Firing order is append-only; duplicates and reorderings are
                // indistinguishable failures of the one-time contract.
                return Err(BossStateErrorV1::LedgerInvalid);
            }
            previous_trigger = Some(*trigger_id);
        }
        if self.shield_charges > BOSS_MAX_SHIELD_CHARGES {
            return Err(BossStateErrorV1::ShieldChargesAboveCeiling {
                max: BOSS_MAX_SHIELD_CHARGES,
            });
        }
        if self.shield_active != (self.shield_charges > 0) {
            return Err(if self.shield_active {
                BossStateErrorV1::ActiveShieldWithoutCharges
            } else {
                BossStateErrorV1::ShieldChargesWithoutActiveShield
            });
        }
        if self.current_phase > highest_phase {
            return Err(BossStateErrorV1::PhaseBeyondPlan);
        }
        let admitted_any = self.rng_admissions > 0;
        if admitted_any != self.last_rng_sequence.is_some()
            || admitted_any != self.last_rng_result.is_some()
        {
            return Err(BossStateErrorV1::RngLedgerInconsistent);
        }
        Ok(())
    }

    /// Scripted slots unlocked by the current phase: every planned slot whose
    /// boundary phase is at most `current_phase`, in plan order.
    pub fn unlocked_scripted_slots(&self) -> Vec<u8> {
        self.boundaries
            .iter()
            .filter(|boundary| boundary.phase_index <= self.current_phase)
            .filter_map(|boundary| boundary.scripted_action_slot)
            .collect()
    }
}

/// Schema version of the central fixed-dispatch registry.
pub const CUSTOM_DISPATCH_REGISTRY_SCHEMA_VERSION: u32 = 1;

/// Gross count of `BESPOKE` behavior units in the `CUSTOM_DISPATCH` cluster
/// (bespoke-clusters-v1.json). Registry validity enforces count conservation
/// internally; this pinned total is asserted against the fixture corpus at
/// integration time.
pub const CUSTOM_DISPATCH_GROSS_BESPOKE_UNIT_COUNT: u32 = 515;

/// Closed handler kinds for the central fixed-dispatch registry.
///
/// Classification is a pure function of the frozen registry key shape; no
/// handler kind is derived from runtime state, and there is no open-ended or
/// fallback kind.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FixedDispatchHandlerKindV1 {
    /// `randBattleSeedInt` receivers (battle-substream integer draws).
    BattleSeedDraw,
    /// Global seeded `randSeedInt` draws outside the battle substream.
    RunSeedDraw,
    /// Global seeded Fisher-Yates shuffles (`randSeedShuffle`).
    SeedShuffle,
    /// Local deterministic range draws (`localRng.integerInRange`).
    LocalRangeDraw,
    /// Direct `Math.random` sites: closed rejection surface. They are
    /// classified but never executed; integration rejects any attempt to run
    /// them until oracle witnesses replace each site with closed semantics.
    NondeterministicSourceRejected,
    /// One ability attribute registration (`attr:<name>AbAttr`).
    AbilityAttributeRegistration,
    /// One move attribute registration (`attr:<name>Attr`, non-ability).
    MoveAttributeRegistration,
    /// An `applyAbAttrs` / `applyFilteredAbAttrs` dispatch callsite.
    AbilityAttributeDispatch,
    /// An `applyMoveAttrs` dispatch callsite.
    MoveAttributeDispatch,
    /// A `globalScene.applyModifier` / `applyModifiers` dispatch callsite.
    ModifierDispatch,
}

impl FixedDispatchHandlerKindV1 {
    /// Rejected kinds classify units but never receive executable routes.
    pub fn is_reject_kind(self) -> bool {
        self == Self::NondeterministicSourceRejected
    }
}

/// One executable route: a classified unit and its closed handler kind.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DispatchRouteEntryV1 {
    pub provenance_hash: ProvenanceHash,
    pub registry_key: String,
    pub handler: FixedDispatchHandlerKindV1,
}

/// Canonical central registry over the `CUSTOM_DISPATCH` BESPOKE surface.
///
/// Count conservation is the zero-residual contract: `gross_unit_count ==
/// sibling_exclusions.len() + rejected_nondeterministic.len() +
/// routes.len()` for every valid registry. The pinned fixture corpus pins
/// the expected gross total of 515 at integration time.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CustomDispatchRegistryV1 {
    pub schema_version: u32,
    pub gross_unit_count: u32,
    /// Exact provenance hashes claimed by sibling bespoke families; sorted
    /// strictly ascending and unique. Excluded units carry no route here.
    pub sibling_exclusions: Vec<ProvenanceHash>,
    /// Classified `Math.random` sites awaiting witness replacement; sorted
    /// strictly ascending and unique. They are never executable.
    pub rejected_nondeterministic: Vec<ProvenanceHash>,
    /// Executable routes; sorted strictly ascending by provenance hash.
    pub routes: Vec<DispatchRouteEntryV1>,
}

/// Closed invariant failures for a built central registry.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CustomDispatchRegistryErrorV1 {
    #[error(
        "dispatch registry schema version must be {expected}, got {actual}"
    )]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("sibling exclusions must be sorted strictly ascending and unique")]
    ExclusionsOutOfOrder,
    #[error("rejected nondeterministic units must be sorted strictly ascending and unique")]
    RejectionsOutOfOrder,
    #[error("routes must be sorted strictly ascending by provenance hash and unique")]
    RoutesOutOfOrder,
    #[error("count conservation failed: exclusions + rejections + routes must equal the gross count")]
    ResidualUnitsRemain,
    #[error("route entries must never use a rejected handler kind")]
    RouteUsesRejectKind,
}

impl CustomDispatchRegistryV1 {
    pub fn validate(&self) -> Result<(), CustomDispatchRegistryErrorV1> {
        if self.schema_version != CUSTOM_DISPATCH_REGISTRY_SCHEMA_VERSION {
            return Err(CustomDispatchRegistryErrorV1::SchemaVersion {
                expected: CUSTOM_DISPATCH_REGISTRY_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        if !strictly_ascending(&self.sibling_exclusions) {
            return Err(CustomDispatchRegistryErrorV1::ExclusionsOutOfOrder);
        }
        if !strictly_ascending(&self.rejected_nondeterministic) {
            return Err(CustomDispatchRegistryErrorV1::RejectionsOutOfOrder);
        }
        let mut previous_hash: Option<&ProvenanceHash> = None;
        for route in &self.routes {
            if route.handler.is_reject_kind() {
                return Err(CustomDispatchRegistryErrorV1::RouteUsesRejectKind);
            }
            if previous_hash.is_some_and(|previous| previous.as_str() >= route.provenance_hash.as_str())
            {
                return Err(CustomDispatchRegistryErrorV1::RoutesOutOfOrder);
            }
            previous_hash = Some(&route.provenance_hash);
        }
        let accounted = u32::try_from(
            self.sibling_exclusions.len()
                + self.rejected_nondeterministic.len()
                + self.routes.len(),
        )
        .unwrap_or(u32::MAX);
        if accounted != self.gross_unit_count {
            return Err(CustomDispatchRegistryErrorV1::ResidualUnitsRemain);
        }
        Ok(())
    }
}

fn strictly_ascending(values: &[ProvenanceHash]) -> bool {
    values
        .windows(2)
        .all(|window| window[0].as_str() < window[1].as_str())
}
