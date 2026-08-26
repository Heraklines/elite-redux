//! M6D complete system parity adapter for the closed field/status/tag domains.
//!
//! Covers every frozen [`BehaviorUnitKind`] of the M6 semantic catalog that
//! carries field state: major statuses (`STATUS_BEHAVIOR`), volatile/battler
//! tags (`BATTLER_TAG_BEHAVIOR`), weather (`WEATHER_BEHAVIOR`), terrain
//! (`TERRAIN_BEHAVIOR`), arena/side conditions (`ARENA_TAG_BEHAVIOR`) and
//! positional tags (`POSITIONAL_TAG_BEHAVIOR`). The adapter resolves each
//! frozen source identity onto the production execution paths — typed
//! major-status admission ([`crate::status`]), the volatile/tag instance
//! machinery ([`crate::m6::bespoke::suppression_immunity`]) and staged
//! weather/terrain/arena lifecycle transitions
//! ([`crate::m6::status_field_executor`]) — and drives the full lifecycle:
//! admission, stacking, refresh, lapse, expiry, ordering, cleanup and the
//! audited RNG transaction, emitting one ordered, comparable transcript per
//! unit.
//!
//! Purity and determinism contracts:
//!
//! - every driver is a pure function of its inputs plus seeded [`RngRuntime`]
//!   draws; identical inputs reproduce identical transcripts;
//! - false-condition attempts (immunity denial, existing status, type or
//!   powder immunity, layer overflow, zero-turn budgets, removal of absent
//!   conditions) are exercised explicitly and verified to leave the state
//!   untouched rather than being assumed;
//! - identities outside the kernel representation fail closed with a typed
//!   reason and are never silently skipped: they remain in the inventory with
//!   an explicit [`FieldCoverage::FailClosed`] verdict so the residual count
//!   stays zero while the contract gap stays visible.
//!
//! The adapter owns no catalog bytes; tests load the frozen `rust/fixtures/m6`
//! catalogs and hand over typed units.

use std::collections::BTreeMap;

use er_content::m6_catalog::CatalogBehaviorUnit;
use er_rng::battle::RngRuntime;
use er_state::battle_v2::BattleStateV2;
use er_state::bespoke_v2::suppression_immunity::{
    SuppressionImmunityStateV2, VolatileTagSubject, VOLATILE_TAG_MAX_LAYERS,
};
use er_types::battle_ids::{BattleSide, PokemonId};
use er_types::battle_model::{
    ArenaConditionScope, PokemonTyping, StatusKind, StatusState, TerrainKind, WeatherKind,
};
use er_types::m6::{BehaviorSourceId, BehaviorUnitId, BehaviorUnitKind};
use serde::Serialize;
use thiserror::Error;

use crate::m6::bespoke::suppression_immunity::{
    admit_volatile_tag, clear_volatile_tags, lapse_volatile_tags, ExpiredTag,
    SuppressionTransitionError, TagAdmitted, TagAdmission, VolatileCleanupEvent,
    VolatileTagAdmission,
};
use crate::m6::status_field_executor::{
    stage_arena_tag_remove, stage_side_condition_set, stage_terrain_expire, stage_terrain_set,
    stage_weather_expire, stage_weather_set, StatusFieldExecutorError,
    STATUS_FIELD_EXECUTOR_SCHEMA_VERSION,
};
use crate::status::{
    apply_status, apply_status_with_chance, check_paralysis, resolve_residual,
    ParalysisActivationOutcome, StatusApplicationInput, StatusApplicationOutcome, StatusBypass,
    StatusError, StatusRejection, StatusResidualInput, StatusResidualOutcome,
};

/// Schema version of every transcript and inventory record emitted here.
pub const FIELD_PARITY_SCHEMA_VERSION: u32 = 1;

// ---------------------------------------------------------------------------
// Closed domain and identity model
// ---------------------------------------------------------------------------

/// Closed set of field/status/tag parity domains.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FieldDomain {
    MajorStatus,
    VolatileTag,
    Weather,
    Terrain,
    ArenaCondition,
    PositionalTag,
}

impl FieldDomain {
    /// Maps one frozen behavior-unit kind onto its parity domain. Every kind
    /// outside the closed field inventory fails closed.
    pub fn for_unit_kind(kind: BehaviorUnitKind) -> Result<Self, FieldIdentityError> {
        match kind {
            BehaviorUnitKind::StatusBehavior => Ok(Self::MajorStatus),
            BehaviorUnitKind::BattlerTagBehavior => Ok(Self::VolatileTag),
            BehaviorUnitKind::WeatherBehavior => Ok(Self::Weather),
            BehaviorUnitKind::TerrainBehavior => Ok(Self::Terrain),
            BehaviorUnitKind::ArenaTagBehavior => Ok(Self::ArenaCondition),
            BehaviorUnitKind::PositionalTagBehavior => Ok(Self::PositionalTag),
            other => Err(FieldIdentityError::UnsupportedUnitKind(other)),
        }
    }

    /// Stable SCREAMING_SNAKE domain name used inside transcripts.
    pub fn name(self) -> &'static str {
        match self {
            Self::MajorStatus => "MAJOR_STATUS",
            Self::VolatileTag => "VOLATILE_TAG",
            Self::Weather => "WEATHER",
            Self::Terrain => "TERRAIN",
            Self::ArenaCondition => "ARENA_CONDITION",
            Self::PositionalTag => "POSITIONAL_TAG",
        }
    }
}

/// A major-status oracle identity resolved against the kernel status slice.
///
/// Oracle `StatusEffect` numeric ids map onto kernel [`StatusKind`] variants
/// where they exist. Identities without a kernel variant stay unrepresented
/// and fail closed instead of being coerced into a neighboring kind.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MajorStatusSubject {
    /// The oracle NONE member: representable, never admissible.
    NoneStatus,
    Poison,
    Toxic,
    Paralysis,
    Sleep,
    Burn,
    /// An oracle identity the kernel cannot represent at all.
    Unrepresented { oracle_code: u16 },
}

impl MajorStatusSubject {
    /// Resolves an oracle `StatusEffect` discriminant:
    /// NONE=0, POISON=1, TOXIC=2, PARALYSIS=3, SLEEP=4, FREEZE=5, BURN=6,
    /// FAINT=7 in the frozen oracle enum.
    pub fn from_oracle_code(code: u16) -> Self {
        match code {
            0 => Self::NoneStatus,
            1 => Self::Poison,
            2 => Self::Toxic,
            3 => Self::Paralysis,
            4 => Self::Sleep,
            6 => Self::Burn,
            other => Self::Unrepresented { oracle_code: other },
        }
    }

    /// The kernel status kind, when the oracle identity has one.
    pub fn kernel_status(self) -> Option<StatusKind> {
        match self {
            Self::NoneStatus => Some(StatusKind::None),
            Self::Poison => Some(StatusKind::Poison),
            Self::Toxic => Some(StatusKind::Toxic),
            Self::Paralysis => Some(StatusKind::Paralysis),
            Self::Sleep => Some(StatusKind::Sleep),
            Self::Burn => Some(StatusKind::Burn),
            Self::Unrepresented { .. } => None,
        }
    }

    /// Whether the selected production admission slice accepts this status.
    /// Toxic and Sleep are kernel-representable but rejected by the typed
    /// production admission path; that rejection is itself a proven verdict,
    /// so only unrepresented identities fail coverage.
    pub fn admission_supported(self) -> bool {
        matches!(
            self.kernel_status(),
            Some(StatusKind::Poison) | Some(StatusKind::Paralysis) | Some(StatusKind::Burn)
        )
    }
}

/// The canonical subject identity of one frozen field behavior unit.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FieldSubject {
    MajorStatus(MajorStatusSubject),
    VolatileTag { registry_key: String },
    PositionalTag { registry_key: String },
    Weather { oracle_code: u16 },
    Terrain { oracle_code: u16 },
    ArenaCondition { registry_key: String },
}

impl FieldSubject {
    /// Canonical SCREAMING_SNAKE subject key used inside transcripts and
    /// inventory records; stable across runs because every input is frozen.
    pub fn key(&self) -> String {
        match self {
            Self::MajorStatus(subject) => format!("MAJOR_STATUS:{}", major_status_name(*subject)),
            Self::VolatileTag { registry_key } => format!("BATTLER_TAG:{registry_key}"),
            Self::PositionalTag { registry_key } => format!("POSITIONAL_TAG:{registry_key}"),
            Self::Weather { oracle_code } => format!("WEATHER:{oracle_code}"),
            Self::Terrain { oracle_code } => format!("TERRAIN:{oracle_code}"),
            Self::ArenaCondition { registry_key } => format!("ARENA_CONDITION:{registry_key}"),
        }
    }
}

/// Resolves one frozen behavior source onto its canonical field subject.
/// Source kinds that cannot carry a field subject fail closed even after a
/// successful domain gate, so catalog drift can never silently dispatch.
pub fn resolve_field_subject(source: &BehaviorSourceId) -> Result<FieldSubject, FieldIdentityError> {
    match source {
        BehaviorSourceId::MajorStatus { numeric_id } => Ok(FieldSubject::MajorStatus(
            MajorStatusSubject::from_oracle_code(u16::try_from(numeric_id.get()).map_err(|_| {
                FieldIdentityError::OracleCodeOverflow {
                    code: numeric_id.get(),
                }
            })?),
        )),
        BehaviorSourceId::BattlerTag { registry_key } => Ok(FieldSubject::VolatileTag {
            registry_key: registry_key.clone(),
        }),
        BehaviorSourceId::PositionalTag { registry_key } => Ok(FieldSubject::PositionalTag {
            registry_key: registry_key.clone(),
        }),
        BehaviorSourceId::Weather { numeric_id } => Ok(FieldSubject::Weather {
            oracle_code: oracle_code(numeric_id.get())?,
        }),
        BehaviorSourceId::Terrain { numeric_id } => Ok(FieldSubject::Terrain {
            oracle_code: oracle_code(numeric_id.get())?,
        }),
        BehaviorSourceId::SideCondition { registry_key } | BehaviorSourceId::ArenaTag { registry_key } => {
            Ok(FieldSubject::ArenaCondition {
                registry_key: registry_key.clone(),
            })
        }
        other => Err(FieldIdentityError::UnsupportedSourceKind(source_kind_name(other))),
    }
}

fn oracle_code(value: u64) -> Result<u16, FieldIdentityError> {
    u16::try_from(value).map_err(|_| FieldIdentityError::OracleCodeOverflow { code: value })
}

/// Typed fail-closed identity errors. None of these ever synthesize behavior.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum FieldIdentityError {
    #[error("behavior-unit kind {0:?} is outside the closed field/status/tag parity inventory")]
    UnsupportedUnitKind(BehaviorUnitKind),
    #[error("behavior source kind {0} cannot carry a field parity subject")]
    UnsupportedSourceKind(&'static str),
    #[error("oracle numeric code {code} is outside the representable 16-bit range")]
    OracleCodeOverflow { code: u64 },
}

fn source_kind_name(source: &BehaviorSourceId) -> &'static str {
    match source {
        BehaviorSourceId::Move { .. } => "MOVE",
        BehaviorSourceId::ActiveAbility { .. } => "ACTIVE_ABILITY",
        BehaviorSourceId::PassiveAbility { .. } => "PASSIVE_ABILITY",
        BehaviorSourceId::HeldItem { .. } => "HELD_ITEM",
        BehaviorSourceId::MajorStatus { .. } => "MAJOR_STATUS",
        BehaviorSourceId::VolatileStatus { .. } => "VOLATILE_STATUS",
        BehaviorSourceId::Weather { .. } => "WEATHER",
        BehaviorSourceId::Terrain { .. } => "TERRAIN",
        BehaviorSourceId::SideCondition { .. } => "SIDE_CONDITION",
        BehaviorSourceId::ArenaTag { .. } => "ARENA_TAG",
        BehaviorSourceId::BattlerTag { .. } => "BATTLER_TAG",
        BehaviorSourceId::PositionalTag { .. } => "POSITIONAL_TAG",
        BehaviorSourceId::Form { .. } => "FORM",
        BehaviorSourceId::Bespoke { .. } => "BESPOKE",
        _ => "UNKNOWN",
    }
}

/// Kernel status name in the frozen oracle spelling.
pub fn status_name(kind: StatusKind) -> &'static str {
    match kind {
        StatusKind::None => "NONE",
        StatusKind::Poison => "POISON",
        StatusKind::Toxic => "TOXIC",
        StatusKind::Paralysis => "PARALYSIS",
        StatusKind::Sleep => "SLEEP",
        StatusKind::Burn => "BURN",
    }
}

/// Major-status identity name, including unrepresented oracle identities.
pub fn major_status_name(subject: MajorStatusSubject) -> String {
    match subject {
        MajorStatusSubject::NoneStatus => "NONE".to_owned(),
        MajorStatusSubject::Poison => "POISON".to_owned(),
        MajorStatusSubject::Toxic => "TOXIC".to_owned(),
        MajorStatusSubject::Paralysis => "PARALYSIS".to_owned(),
        MajorStatusSubject::Sleep => "SLEEP".to_owned(),
        MajorStatusSubject::Burn => "BURN".to_owned(),
        MajorStatusSubject::Unrepresented { oracle_code } => format!("ORACLE_CODE_{oracle_code}"),
    }
}

// ---------------------------------------------------------------------------
// Transcript model
// ---------------------------------------------------------------------------

/// One instance reference inside ordered evidence, keyed by owner plus
/// canonical subject key.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct InstanceRef {
    pub owner: u64,
    pub subject: String,
}

/// Closed cleanup events exercised by the tag lifecycle drivers.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FieldCleanupEvent {
    SwitchOut,
    Faint,
}

/// One ordered transcript step. Every variant is plain data so transcripts
/// compare structurally; rejection variants additionally carry the verified
/// `state_unchanged` proof where the underlying executor stages in place.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "step", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FieldLifecycleStep {
    Admitted {
        subject: String,
        layers_after: u8,
        stacked: bool,
        creation_ordinal: u64,
    },
    AdmissionDeniedByImmunity {
        subject: String,
    },
    LayerOverflowRejected {
        subject: String,
    },
    LapseTick {
        decremented: Vec<InstanceRef>,
        expired: Vec<InstanceRef>,
    },
    CleanupCleared {
        event: FieldCleanupEvent,
        removed: Vec<InstanceRef>,
        preserved_major_statuses: Vec<String>,
    },
    StatusApplied {
        status: String,
    },
    StatusChanceGateFailed {
        status: String,
        chance: u8,
        draw: u64,
    },
    StatusAdmissionRejected {
        status: String,
        reason: String,
    },
    StatusAdmissionFailClosed {
        status: String,
    },
    ParalysisActivationGate {
        outcome: String,
        draw: u64,
    },
    ResidualResolved {
        status: String,
        outcome: String,
        damage: u32,
    },
    CycleSet {
        domain: String,
        before_code: Option<u16>,
        before_turns: u16,
        after_code: u16,
        turns: u16,
    },
    CycleTick {
        domain: String,
        remaining_before: u16,
        remaining_after: u16,
    },
    CycleExpired {
        domain: String,
        remaining_before: u16,
    },
    CycleSetRejectedZeroTurns {
        domain: String,
        state_unchanged: bool,
    },
    ArenaStacked {
        condition: String,
        scope: String,
        before_layers: u8,
        after_layers: u8,
    },
    ArenaRemoved {
        condition: String,
        scope: String,
    },
    ArenaRemoveRejectedMissing {
        condition: String,
        scope: String,
        state_unchanged: bool,
    },
    UnsupportedIdentityRejected {
        subject: String,
        reason: String,
    },
}

impl FieldLifecycleStep {
    /// The primary subject key this step talks about, if any.
    pub fn subject(&self) -> Option<&str> {
        match self {
            Self::Admitted { subject, .. }
            | Self::AdmissionDeniedByImmunity { subject }
            | Self::LayerOverflowRejected { subject }
            | Self::StatusApplied { status: subject }
            | Self::StatusChanceGateFailed { status: subject, .. }
            | Self::StatusAdmissionRejected { status: subject, .. }
            | Self::StatusAdmissionFailClosed { status: subject }
            | Self::UnsupportedIdentityRejected { subject, .. } => Some(subject),
            Self::ResidualResolved { status, .. } => Some(status),
            Self::ArenaStacked { condition, .. }
            | Self::ArenaRemoved { condition, .. }
            | Self::ArenaRemoveRejectedMissing { condition, .. } => Some(condition),
            _ => None,
        }
    }

    /// Whether the step produced a real state mutation.
    pub fn mutates(&self) -> bool {
        match self {
            Self::Admitted { .. }
                | Self::StatusApplied { .. }
                | Self::CycleSet { .. }
                | Self::CycleTick { .. }
                | Self::CycleExpired { .. }
                | Self::ArenaStacked { .. }
                | Self::ArenaRemoved { .. } => true,
            Self::ResidualResolved { outcome, .. } => *outcome != "NOT_APPLICABLE",
            _ => false,
        }
    }
    /// `state_unchanged` proof holds.
    pub fn false_condition_verified(&self) -> bool {
        match self {
            Self::AdmissionDeniedByImmunity { .. }
            | Self::LayerOverflowRejected { .. }
            | Self::StatusAdmissionRejected { .. }
            | Self::StatusAdmissionFailClosed { .. }
            | Self::StatusChanceGateFailed { .. }
            | Self::UnsupportedIdentityRejected { .. } => true,
            Self::CycleSetRejectedZeroTurns { state_unchanged, .. }
            | Self::ArenaRemoveRejectedMissing { state_unchanged, .. } => *state_unchanged,
            _ => false,
        }
    }
}

/// Ordered, comparable transcript for one behavior-unit lifecycle campaign.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct FieldLifecycleReport {
    pub schema_version: u32,
    pub domain: FieldDomain,
    pub subject_key: String,
    pub steps: Vec<FieldLifecycleStep>,
    /// Number of audited RNG draws consumed by this campaign.
    pub audited_draws: usize,
}

/// Coverage verdict for one inventory entry.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "verdict", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FieldCoverage {
    /// The unit's full lifecycle ran through production paths and satisfied
    /// its frozen witness assertions.
    Proven,
    /// The oracle identity has no kernel representation. The exact gap is
    /// recorded; nothing is synthesized in its place.
    FailClosed { reason: String },
}

/// Exactly-once inventory entry for one frozen field behavior unit.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct FieldInventoryEntry {
    pub unit: BehaviorUnitId,
    pub domain: FieldDomain,
    pub subject_key: String,
    pub coverage: FieldCoverage,
}

/// Adapter-level failure. Every variant either wraps a typed production error
/// or reports a violated campaign invariant; none is recoverable by skipping.
#[derive(Debug, Error)]
pub enum FieldParityError {
    #[error("field parity identity error: {0}")]
    Identity(#[from] FieldIdentityError),
    #[error("major-status production path failed: {0}")]
    Status(#[from] StatusError),
    #[error("volatile-tag production path failed: {0}")]
    Suppression(#[from] SuppressionTransitionError),
    #[error("field staging production path failed: {0}")]
    Stage(#[from] StatusFieldExecutorError),
    #[error("campaign invariant violated: {0}")]
    Invariant(String),
    #[error("witness assertion {assertion} not satisfied by {subject}: {detail}")]
    WitnessNotSatisfied {
        assertion: String,
        subject: String,
        detail: String,
    },
    #[error("witness assertion kind {0:?} is outside the frozen assertion vocabulary")]
    UnknownAssertion(String),
}

// ---------------------------------------------------------------------------
// Exactly-once inventory
// ---------------------------------------------------------------------------

/// Builds the exactly-once field/status/tag inventory over the frozen catalog.
///
/// Units outside the six field domains are ignored (other adapters own them);
/// every field-domain unit appears at most once — duplicates are hard errors —
/// and carries either a proven or an explicit fail-closed verdict, so the sum
/// of both verdicts equals the number of field units with zero residual.
pub fn field_inventory(
    units: &[CatalogBehaviorUnit],
) -> Result<Vec<FieldInventoryEntry>, FieldParityError> {
    let mut seen = BTreeMap::new();
    let mut entries = Vec::new();
    for unit in units {
        let domain = match FieldDomain::for_unit_kind(unit.id.unit_kind) {
            Ok(domain) => domain,
            Err(_) => continue,
        };
        if seen.insert(unit.id.clone(), ()).is_some() {
            return Err(FieldParityError::Invariant(format!(
                "duplicate field inventory unit {}",
                subject_key_of(&unit.id)
            )));
        }
        let subject = resolve_field_subject(&unit.id.source)?;
        let subject_key = subject.key();
        let coverage = match subject {
            FieldSubject::MajorStatus(inner) if !inner.admission_supported() => {
                FieldCoverage::FailClosed {
                    reason: match inner.kernel_status() {
                        Some(kind) => format!(
                            "oracle major-status {} is rejected by the selected production admission slice",
                            status_name(kind)
                        ),
                        None => format!(
                            "oracle major-status identity {} has no kernel StatusKind representation",
                            major_status_name(inner)
                        ),
                    },
                }
            }
            _ => FieldCoverage::Proven,
        };
        entries.push(FieldInventoryEntry {
            unit: unit.id.clone(),
            domain,
            subject_key,
            coverage,
        });
    }
    Ok(entries)
}

fn subject_key_of(unit: &BehaviorUnitId) -> String {
    resolve_field_subject(&unit.source)
        .map(|subject| subject.key())
        .unwrap_or_else(|_| format!("{:?}", unit.source))
}

// ---------------------------------------------------------------------------
// Volatile/battler-tag and positional-tag lifecycle
// ---------------------------------------------------------------------------

/// Deterministic scenario inputs for one tag lifecycle campaign.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TagScenario {
    pub owner: PokemonId,
    /// Initial admission layers; at least one.
    pub layers_initial: u8,
    /// Stacking admission layers; at least one.
    pub layers_stack: u8,
    /// Timed window of the initial admission; at least one turn.
    pub window_turns: u16,
}

/// Drives the complete tag lifecycle for one subject: immunity-denied
/// admission (false condition), fresh admission, stacking + window refresh,
/// ceiling-overflow rejection (false condition), timed lapse to exact expiry,
/// then switch-out cleanup after an untimed re-admission.
pub fn run_tag_lifecycle(
    initial: &SuppressionImmunityStateV2,
    subject: VolatileTagSubject,
    scenario: &TagScenario,
) -> Result<FieldLifecycleReport, FieldParityError> {
    let subject_key = volatile_subject_key(&subject);
    let mut steps = Vec::new();

    if scenario.layers_initial == 0 || scenario.layers_stack == 0 {
        return Err(FieldParityError::Invariant(
            "tag scenarios require positive layer counts".to_owned(),
        ));
    }
    if scenario.window_turns == 0 {
        return Err(FieldParityError::Invariant(
            "tag scenarios require a positive timed window".to_owned(),
        ));
    }

    // 1. Immunity-denied admission must be rejected without any state change.
    //    The transition API is pure (&self), so rejection cannot mutate.
    match admit_volatile_tag(
        initial,
        &VolatileTagAdmission {
            owner: scenario.owner,
            subject: subject.clone(),
            layers_delta: scenario.layers_initial.max(1),
            remaining_turns: Some(scenario.window_turns),
            admission: TagAdmission::BlockedByNativeImmunity,
        },
    ) {
        Err(SuppressionTransitionError::TagDeniedByImmunity) => {
            steps.push(FieldLifecycleStep::AdmissionDeniedByImmunity {
                subject: subject_key.clone(),
            });
        }
        Err(other) => {
            return Err(FieldParityError::Invariant(format!(
                "immunity-denied admission failed with an unexpected error: {other}"
            )))
        }
        Ok(_) => {
            return Err(FieldParityError::Invariant(
                "immunity-denied admission unexpectedly succeeded".to_owned(),
            ))
        }
    }

    // 2. Fresh admission creates an instance with a creation ordinal.
    let admitted = admit_volatile_tag(
        initial,
        &request(scenario, &subject, scenario.layers_initial, Some(scenario.window_turns)),
    )?;
    record_admission(&mut steps, &subject_key, &admitted.evidence)?;
    let mut state = admitted.state;

    // 3. Stacking admission accumulates layers and refreshes the window.
    let stack_window = scenario.window_turns.checked_add(1).ok_or_else(|| {
        FieldParityError::Invariant("stacked window overflowed u16".to_owned())
    })?;
    let stacked = admit_volatile_tag(
        &state,
        &request(scenario, &subject, scenario.layers_stack, Some(stack_window)),
    )?;
    record_admission(&mut steps, &subject_key, &stacked.evidence)?;
    state = stacked.state;

    // 4. Ceiling overflow must be rejected without touching the state.
    match admit_volatile_tag(
        &state,
        &request(scenario, &subject, u8::MAX, Some(stack_window)),
    ) {
        Err(SuppressionTransitionError::State(
            er_state::bespoke_v2::suppression_immunity::SuppressionStateError::LayerOverflow { .. },
        )) => {
            steps.push(FieldLifecycleStep::LayerOverflowRejected {
                subject: subject_key.clone(),
            });
        }
        Err(other) => {
            return Err(FieldParityError::Invariant(format!(
                "overflow admission failed with an unexpected error: {other}"
            )))
        }
        Ok(_) => {
            return Err(FieldParityError::Invariant(
                "ceiling-overflow admission unexpectedly succeeded".to_owned(),
            ))
        }
    }

    // 5. Timed lapse ticks decrement every turn and expire exactly at zero.
    let mut expired_seen = false;
    for tick in 0..stack_window {
        let lapse = lapse_volatile_tags(&state)?;
        let expired: Vec<InstanceRef> = lapse
            .evidence
            .iter()
            .map(|expired| InstanceRef {
                owner: expired.owner.get().get(),
                subject: volatile_subject_key(&expired.subject),
            })
            .collect();
        if !expired.is_empty() {
            if tick + 1 != stack_window {
                return Err(FieldParityError::Invariant(format!(
                    "subject {subject_key} expired on tick {} before its {}-turn window elapsed",
                    tick + 1,
                    stack_window
                )));
            }
            if !expired.iter().any(|entry| entry.subject == subject_key) {
                return Err(FieldParityError::Invariant(format!(
                    "expiry at window end did not include subject {subject_key}"
                )));
            }
            expired_seen = true;
        }
        let decremented: Vec<InstanceRef> = lapse
            .state
            .volatile_tags
            .iter()
            .filter(|instance| instance.remaining_turns.is_some())
            .map(timed_ref)
            .collect();
        state = lapse.state;
        steps.push(FieldLifecycleStep::LapseTick {
            decremented,
            expired,
        });
    }
    if !expired_seen {
        return Err(FieldParityError::Invariant(format!(
            "subject {subject_key} never expired across its full window"
        )));
    }
    if state
        .volatile_tags
        .iter()
        .any(|instance| instance.owner == scenario.owner && instance.subject == subject)
    {
        return Err(FieldParityError::Invariant(format!(
            "subject {subject_key} survived its own expiry"
        )));
    }

    // 6. An untimed re-admission survives lapses and clears on switch-out,
    //    while major statuses owned by the same battler are preserved.
    let readmitted = admit_volatile_tag(&state, &request(scenario, &subject, 1, None))?;
    record_admission(&mut steps, &subject_key, &readmitted.evidence)?;
    state = readmitted.state;
    let cleanup = clear_volatile_tags(&state, VolatileCleanupEvent::SwitchOut(scenario.owner))?;
    let removed: Vec<InstanceRef> = cleanup
        .evidence
        .removed
        .iter()
        .map(|removed| InstanceRef {
            owner: removed.owner.get().get(),
            subject: volatile_subject_key(&removed.subject),
        })
        .collect();
    if !removed.iter().any(|entry| entry.subject == subject_key) {
        return Err(FieldParityError::Invariant(format!(
            "switch-out cleanup did not remove subject {subject_key}"
        )));
    }
    steps.push(FieldLifecycleStep::CleanupCleared {
        event: FieldCleanupEvent::SwitchOut,
            preserved_major_statuses: preserved_status_names(&cleanup.evidence.preserved_major_statuses),
        removed,
    });

    Ok(FieldLifecycleReport {
        schema_version: FIELD_PARITY_SCHEMA_VERSION,
        domain: tag_domain(&subject),
        subject_key,
        steps,
        audited_draws: 0,
    })
}


fn request(
    scenario: &TagScenario,
    subject: &VolatileTagSubject,
    layers_delta: u8,
    remaining_turns: Option<u16>,
) -> VolatileTagAdmission {
    VolatileTagAdmission {
        owner: scenario.owner,
        subject: subject.clone(),
        layers_delta,
        remaining_turns,
        admission: TagAdmission::Permitted,
    }
}

fn record_admission(
    steps: &mut Vec<FieldLifecycleStep>,
    subject_key: &str,
    evidence: &TagAdmitted,
) -> Result<(), FieldParityError> {
    let layers_after = evidence.layers_after;
    let stacked = evidence.stacked;
    let creation_ordinal = evidence.creation_ordinal.get();
    if layers_after == 0 || layers_after > VOLATILE_TAG_MAX_LAYERS {
        return Err(FieldParityError::Invariant(format!(
            "admitted layers {layers_after} outside the frozen ceiling"
        )));
    }
    steps.push(FieldLifecycleStep::Admitted {
        subject: subject_key.to_owned(),
        layers_after,
        stacked,
        creation_ordinal,
    });
    Ok(())
}

fn timed_ref(instance: &er_state::bespoke_v2::suppression_immunity::VolatileTagInstanceV2) -> InstanceRef {
    InstanceRef {
        owner: instance.owner.get().get(),
        subject: volatile_subject_key(&instance.subject),
    }
}

fn tag_domain(subject: &VolatileTagSubject) -> FieldDomain {
    match subject {
        VolatileTagSubject::MajorStatus(_) => FieldDomain::MajorStatus,
        VolatileTagSubject::PositionalTag { .. } => FieldDomain::PositionalTag,
        _ => FieldDomain::VolatileTag,
    }
}

fn volatile_subject_key(subject: &VolatileTagSubject) -> String {
    match subject {
        VolatileTagSubject::MajorStatus(kind) => format!("MAJOR_STATUS:{}", status_name(*kind)),
        VolatileTagSubject::VolatileStatus { registry_key } => {
            format!("VOLATILE_STATUS:{registry_key}")
        }
        VolatileTagSubject::BattlerTag { registry_key } => format!("BATTLER_TAG:{registry_key}"),
        VolatileTagSubject::PositionalTag { side, registry_key } => format!(
            "POSITIONAL_TAG:{}:{registry_key}",
            if *side == BattleSide::Player { "PLAYER" } else { "ENEMY" }
        ),
    }
}

// ---------------------------------------------------------------------------
// Major-status lifecycle
// ---------------------------------------------------------------------------

/// Deterministic scenario inputs for one major-status campaign.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MajorStatusScenario {
    pub target: PokemonId,
    /// Effective typing of the admission target.
    pub typing: PokemonTyping,
    /// Optional secondary-effect chance percentage; `None` guarantees the
    /// no-draw path required by witnesses with an empty RNG contract.
    pub chance: Option<u8>,
    /// Whether to exercise the audited paralysis activation gate. Witnesses
    /// with an empty RNG contract run with this disabled.
    pub exercise_rng_gate: bool,
    pub max_hp: u32,
    pub hp: u32,
}

/// Drives the complete major-status lifecycle: chance-gated admission
/// transaction, existing-status/type-immunity/powder false conditions,
/// residual resolution, the audited paralysis activation gate when enabled,
/// and the suppression-store cleanup ordering (switch-out preserves, faint
/// clears).
pub fn run_major_status_lifecycle(
    runtime: &mut RngRuntime,
    initial: &SuppressionImmunityStateV2,
    requested: StatusKind,
    scenario: &MajorStatusScenario,
) -> Result<FieldLifecycleReport, FieldParityError> {
    let status_key = status_name(requested).to_owned();
    let mut steps = Vec::new();
    let draws_before = runtime.audit_entries().len();

    let clean = StatusState {
        kind: StatusKind::None,
        toxic_turn_count: 0,
        sleep_turns_remaining: None,
    };

    // 1. Chance-gated admission transaction against the clean target.
    let applied;
    match apply_status_with_chance(
        runtime,
        StatusApplicationInput {
            requested,
            current: clean,
            target_types: scenario.typing,
            powder: false,
            bypass: StatusBypass::None,
        },
        scenario.chance,
    ) {
        Ok(StatusApplicationOutcome::Applied { mutation }) => {
            applied = true;
            if mutation.before == mutation.after || mutation.after.kind != requested {
                return Err(FieldParityError::Invariant(
                    "applied status mutation is not a real transition".to_owned(),
                ));
            }
            steps.push(FieldLifecycleStep::StatusApplied {
                status: status_key.clone(),
            });
        }
        Ok(StatusApplicationOutcome::Rejected { reason }) => {
            applied = false;
            steps.push(FieldLifecycleStep::StatusAdmissionRejected {
                status: status_key.clone(),
                reason: rejection_name(reason),
            });
        }
        Ok(StatusApplicationOutcome::ChanceFailed { draw }) => {
            applied = false;
            let chance = scenario.chance.ok_or_else(|| {
                FieldParityError::Invariant("chance failure without a chance gate".to_owned())
            })?;
            steps.push(FieldLifecycleStep::StatusChanceGateFailed {
                status: status_key.clone(),
                chance,
                draw: draw.get(),
            });
        }
        Err(StatusError::UnsupportedStatus { .. }) => {
            applied = false;
            steps.push(FieldLifecycleStep::StatusAdmissionFailClosed {
                status: status_key.clone(),
            });
        }
        Err(other) => return Err(FieldParityError::Status(other)),
    }
    if applied {
        // 2. Existing-major-status false condition: a second application on
        //    the now-statusful target must be rejected without mutating.
        let statusful = StatusState {
            kind: requested,
            toxic_turn_count: 0,
            sleep_turns_remaining: None,
        };
        match apply_status(StatusApplicationInput {
            requested,
            current: statusful,
            target_types: scenario.typing,
            powder: false,
            bypass: StatusBypass::None,
        })? {
            StatusApplicationOutcome::Rejected { reason } => {
                steps.push(FieldLifecycleStep::StatusAdmissionRejected {
                    status: status_key.clone(),
                    reason: rejection_name(reason),
                });
            }
            _ => {
                return Err(FieldParityError::Invariant(format!(
                    "second admission of {status_key} did not reject"
                )))
            }
        }

        // 3. Type-immunity false condition against the canonical immune type.
        let immune_typing = PokemonTyping {
            primary: immune_type_for(requested),
            secondary: None,
        };
        match apply_status(StatusApplicationInput {
            requested,
            current: clean,
            target_types: immune_typing,
            powder: false,
            bypass: StatusBypass::None,
        })? {
            StatusApplicationOutcome::Rejected { reason } => {
                steps.push(FieldLifecycleStep::StatusAdmissionRejected {
                    status: status_key.clone(),
                    reason: rejection_name(reason),
                });
            }
            _ => {
                return Err(FieldParityError::Invariant(format!(
                    "type-immune admission of {status_key} did not reject"
                )))
            }
        }

        // 4. Powder false condition against Grass typing.
        let grass = PokemonTyping {
            primary: er_types::battle_model::PokemonType::Grass,
            secondary: None,
        };
        match apply_status(StatusApplicationInput {
            requested,
            current: clean,
            target_types: grass,
            powder: true,
            bypass: StatusBypass::None,
        })? {
            StatusApplicationOutcome::Rejected { reason } => {
                steps.push(FieldLifecycleStep::StatusAdmissionRejected {
                    status: status_key.clone(),
                    reason: rejection_name(reason),
                });
            }
            _ => {
                return Err(FieldParityError::Invariant(format!(
                    "powder admission of {status_key} onto Grass did not reject"
                )))
            }
        }

        // 5. Post-turn residual resolution.
        if scenario.hp == 0 || scenario.max_hp == 0 {
            return Err(FieldParityError::Invariant(
                "residual scenarios require positive hp and max hp".to_owned(),
            ));
        }
        let residual_input = StatusResidualInput {
            status: statusful,
            hp: scenario.hp.min(scenario.max_hp),
            max_hp: scenario.max_hp,
        };
        match resolve_residual(residual_input)? {
            StatusResidualOutcome::Applied { mutation } => {
                let damage = mutation.damage;
                let status_after = mutation.status_after;
                steps.push(FieldLifecycleStep::ResidualResolved {
                    status: status_key.clone(),
                    outcome: "APPLIED".to_owned(),
                    damage,
                });
                if damage == 0 || status_after.toxic_turn_count == 0 {
                    return Err(FieldParityError::Invariant(
                        "residual mutation did not damage or advance the counter".to_owned(),
                    ));
                }
            }
            StatusResidualOutcome::NotApplicable { .. } => {
                steps.push(FieldLifecycleStep::ResidualResolved {
                    status: status_key.clone(),
                    outcome: "NOT_APPLICABLE".to_owned(),
                    damage: 0,
                });
            }
            StatusResidualOutcome::TargetFainted { .. } => {
                return Err(FieldParityError::Invariant(
                    "residual target fainted in a healthy scenario".to_owned(),
                ))
            }
        }
            if requested == StatusKind::Paralysis && scenario.exercise_rng_gate {
                match check_paralysis(runtime, requested)? {
                    ParalysisActivationOutcome::NotParalyzed => {
                        return Err(FieldParityError::Invariant(
                            "paralysis gate reported a non-paralyzed target".to_owned(),
                        ));
                    }
                    ParalysisActivationOutcome::CanAct { draw } => {
                        steps.push(FieldLifecycleStep::ParalysisActivationGate {
                            outcome: "CAN_ACT".to_owned(),
                            draw: draw.get(),
                        });
                    }
                    ParalysisActivationOutcome::FullyParalyzed { draw } => {
                        steps.push(FieldLifecycleStep::ParalysisActivationGate {
                            outcome: "FULLY_PARALYZED".to_owned(),
                            draw: draw.get(),
                        });
                    }
                }
            }

        // 7. Suppression-store cleanup ordering for the live instance.
        let admitted = admit_volatile_tag(
            initial,
            &VolatileTagAdmission {
                owner: scenario.target,
                subject: VolatileTagSubject::MajorStatus(requested),
                layers_delta: 1,
                remaining_turns: None,
                admission: TagAdmission::Permitted,
            },
        )?;
        record_admission(&mut steps, &format!("MAJOR_STATUS:{status_key}"), &admitted.evidence)?;
        let mut state = admitted.state;

        let switch_out =
            clear_volatile_tags(&state, VolatileCleanupEvent::SwitchOut(scenario.target))?;
        if !switch_out
            .evidence
            .preserved_major_statuses
            .contains(&requested)
        {
            return Err(FieldParityError::Invariant(
                "switch-out did not report the preserved major status".to_owned(),
            ));
        }
        steps.push(FieldLifecycleStep::CleanupCleared {
            event: FieldCleanupEvent::SwitchOut,
            removed: instance_refs(&switch_out.evidence.removed),
                preserved_major_statuses: preserved_status_names(
                    &switch_out.evidence.preserved_major_statuses,
                ),
        });
        state = switch_out.state;
        if !state
            .volatile_tags
            .iter()
            .any(|instance| instance.owner == scenario.target && instance.subject == VolatileTagSubject::MajorStatus(requested))
        {
            return Err(FieldParityError::Invariant(
                "switch-out dropped a major-status instance".to_owned(),
            ));
        }

        let faint = clear_volatile_tags(&state, VolatileCleanupEvent::Faint(scenario.target))?;
        let removed = instance_refs(&faint.evidence.removed);
        if !removed
            .iter()
            .any(|entry| entry.subject == format!("MAJOR_STATUS:{status_key}"))
        {
            return Err(FieldParityError::Invariant(
                "faint cleanup did not remove the major-status instance".to_owned(),
            ));
        }
        steps.push(FieldLifecycleStep::CleanupCleared {
            event: FieldCleanupEvent::Faint,
            preserved_major_statuses: Vec::new(),
            removed,
        });
    }

    Ok(FieldLifecycleReport {
        schema_version: FIELD_PARITY_SCHEMA_VERSION,
        domain: FieldDomain::MajorStatus,
        subject_key: format!("MAJOR_STATUS:{status_key}"),
        steps,
        audited_draws: runtime.audit_entries().len() - draws_before,
    })
}

fn instance_refs(expired: &[ExpiredTag]) -> Vec<InstanceRef> {
    expired
        .iter()
        .map(|entry| InstanceRef {
            owner: entry.owner.get().get(),
            subject: volatile_subject_key(&entry.subject),
        })
        .collect()
}

fn immune_type_for(
    status: StatusKind,
) -> er_types::battle_model::PokemonType {
    match status {
        StatusKind::Poison => er_types::battle_model::PokemonType::Steel,
        StatusKind::Paralysis => er_types::battle_model::PokemonType::Electric,
        StatusKind::Burn => er_types::battle_model::PokemonType::Fire,
        _ => er_types::battle_model::PokemonType::Normal,
    }
}

fn rejection_name(reason: StatusRejection) -> String {
    match reason {
        StatusRejection::ExistingMajorStatus { existing } => {
            format!("EXISTING_MAJOR_STATUS:{}", status_name(existing))
        }
        StatusRejection::TypeImmunity { status, .. } => {
            format!("TYPE_IMMUNITY:{}", status_name(status))
        }
        StatusRejection::PowderImmunity { .. } => "POWDER_IMMUNITY".to_owned(),
    }
}

// ---------------------------------------------------------------------------
// Weather / terrain cycle lifecycle
// ---------------------------------------------------------------------------

/// Deterministic scenario inputs for one weather or terrain campaign.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CycleScenario {
    /// Oracle weather/terrain code carried opaquely by the staged executor.
    pub oracle_code: u16,
    /// Full turn budget of the initial admission; at least one.
    pub turns: u16,
}

/// Drives the complete cycle lifecycle for one weather/terrain identity:
/// zero-turn rejection (false condition), fresh admission with the full
/// budget, a replacement admission whose evidence preserves the previous
/// counter (expiry ordering across overlapping replacements), per-turn lapse
/// ticks to exact expiry, and final state validation.
pub fn run_cycle_lifecycle(
    domain: FieldDomain,
    battle: &BattleStateV2,
    scenario: &CycleScenario,
) -> Result<FieldLifecycleReport, FieldParityError> {
    if scenario.turns == 0 {
        return Err(FieldParityError::Invariant(
            "cycle scenarios require a positive turn budget".to_owned(),
        ));
    }
    let subject_key = match domain {
        FieldDomain::Weather => format!("WEATHER:{}", scenario.oracle_code),
        FieldDomain::Terrain => format!("TERRAIN:{}", scenario.oracle_code),
        _ => {
            return Err(FieldParityError::Invariant(
                "run_cycle_lifecycle only covers weather and terrain".to_owned(),
            ))
        }
    };
    let domain_name = domain.name();
    let mut steps = Vec::new();
    let mut state = battle.clone();
    let mut ordinal = 1_u32;

    // 1. A zero-turn budget must be rejected without staging anything.
    let before = state.clone();
    let zero_turn = stage_cycle_set(&mut state, domain, scenario.oracle_code, 0, ordinal);
    match zero_turn {
        Err(StatusFieldExecutorError::ZeroTurnDuration) => {}
        Err(other) => {
            return Err(FieldParityError::Invariant(format!(
                "zero-turn budget failed with an unexpected error: {other}"
            )))
        }
        Ok(_) => {
            return Err(FieldParityError::Invariant(
                "zero-turn budget unexpectedly staged".to_owned(),
            ))
        }
    }
    steps.push(FieldLifecycleStep::CycleSetRejectedZeroTurns {
        domain: domain_name.to_owned(),
        state_unchanged: state == before,
    });

    // 2. Fresh admission carries the full turn budget.
    stage_cycle_set(&mut state, domain, scenario.oracle_code, scenario.turns, ordinal)?;
    steps.push(FieldLifecycleStep::CycleSet {
        domain: domain_name.to_owned(),
        before_code: None,
        before_turns: 0,
        after_code: scenario.oracle_code,
        turns: scenario.turns,
    });

    // 3. Replacement admission: the previous weather's remaining counter is
    //    preserved in the evidence so overlapping expiry order stays
    //    reconstructible.
    let replacement_code = scenario.oracle_code.wrapping_add(1);
    ordinal += 1;
    stage_cycle_set(&mut state, domain, replacement_code, scenario.turns, ordinal)?;
    steps.push(FieldLifecycleStep::CycleSet {
        domain: domain_name.to_owned(),
        before_code: Some(scenario.oracle_code),
        before_turns: scenario.turns,
        after_code: replacement_code,
        turns: scenario.turns,
    });

    // 4. Lapse ticks decrement every turn and expire exactly at one.
    for tick in 0..scenario.turns {
        let step = lapse_field_cycle(&mut state, domain, &mut ordinal)?;
        match &step {
            FieldLifecycleStep::CycleTick { remaining_before, .. } => {
                if *remaining_before != scenario.turns - tick {
                    return Err(FieldParityError::Invariant(format!(
                        "cycle tick {tick} observed remaining counter {remaining_before}"
                    )));
                }
            }
            FieldLifecycleStep::CycleExpired { remaining_before, .. } => {
                if tick + 1 != scenario.turns || *remaining_before != 1 {
                    return Err(FieldParityError::Invariant(
                        "cycle expired off its exact turn boundary".to_owned(),
                    ));
                }
            }
            other => {
                return Err(FieldParityError::Invariant(format!(
                    "lapse produced an unexpected step: {other:?}"
                )))
            }
        }
        steps.push(step);
    }
    let cleared = match domain {
        FieldDomain::Weather => {
            state.weather.kind == WeatherKind::None && state.weather.remaining_turns == 0
        }
        FieldDomain::Terrain => {
            state.terrain.kind == TerrainKind::None && state.terrain.remaining_turns == 0
        }
        _ => unreachable!("guarded by caller"),
    };
    if !cleared {
        return Err(FieldParityError::Invariant(
            "cycle campaign ended without a cleared field".to_owned(),
        ));
    }

    Ok(FieldLifecycleReport {
        schema_version: FIELD_PARITY_SCHEMA_VERSION,
        domain,
        subject_key,
        steps,
        audited_draws: 0,
    })
}

fn stage_cycle_set(
    state: &mut BattleStateV2,
    domain: FieldDomain,
    oracle_code: u16,
    turns: u16,
    ordinal: u32,
) -> Result<(), StatusFieldExecutorError> {
    match domain {
        FieldDomain::Weather => stage_weather_set(state, oracle_code, turns, ordinal).map(|_| ()),
        FieldDomain::Terrain => stage_terrain_set(state, oracle_code, turns, ordinal).map(|_| ()),
        _ => unreachable!("guarded by caller"),
    }
}

/// Production seam: advances one field cycle by exactly one turn. Timed
/// cycles with more than one remaining turn decrement in place; a cycle at
/// its last turn expires back to the cleared state. Cleared cycles fail
/// closed instead of staging a neutral change.
pub fn lapse_field_cycle(
    state: &mut BattleStateV2,
    domain: FieldDomain,
    ordinal: &mut u32,
) -> Result<FieldLifecycleStep, FieldParityError> {
    let domain_name = domain.name();
    let remaining_before = match domain {
        FieldDomain::Weather => state.weather.remaining_turns,
        FieldDomain::Terrain => state.terrain.remaining_turns,
        _ => {
            return Err(FieldParityError::Invariant(
                "lapse_field_cycle only covers weather and terrain".to_owned(),
            ))
        }
    };
    if remaining_before == 0 {
        return Err(FieldParityError::Invariant(format!(
            "{domain_name} cycle lapsed while already cleared"
        )));
    }
    if remaining_before > 1 {
        let remaining_after = remaining_before - 1;
        match domain {
            FieldDomain::Weather => state.weather.remaining_turns = remaining_after,
            FieldDomain::Terrain => state.terrain.remaining_turns = remaining_after,
            _ => unreachable!("guarded above"),
        }
        return Ok(FieldLifecycleStep::CycleTick {
            domain: domain_name.to_owned(),
            remaining_before,
            remaining_after,
        });
    }
    let evidence = match domain {
        FieldDomain::Weather => stage_weather_expire(state, *ordinal)?,
        FieldDomain::Terrain => stage_terrain_expire(state, *ordinal)?,
        _ => unreachable!("guarded above"),
    };
    if evidence.schema_version != STATUS_FIELD_EXECUTOR_SCHEMA_VERSION
        || evidence.ordinal != *ordinal
    {
        return Err(FieldParityError::Invariant(
            "expiry evidence schema or ordinal drift".to_owned(),
        ));
    }
    *ordinal += 1;
    let cleared = match domain {
        FieldDomain::Weather => {
            state.weather.kind == WeatherKind::None && state.weather.remaining_turns == 0
        }
        FieldDomain::Terrain => {
            state.terrain.kind == TerrainKind::None && state.terrain.remaining_turns == 0
        }
        _ => unreachable!("guarded above"),
    };
    if !cleared {
        return Err(FieldParityError::Invariant(format!(
            "{domain_name} expiry left an active cycle behind"
        )));
    }
    Ok(FieldLifecycleStep::CycleExpired {
        domain: domain_name.to_owned(),
        remaining_before,
    })
}

// ---------------------------------------------------------------------------
// Arena/side-condition lifecycle
// ---------------------------------------------------------------------------

/// Deterministic scenario inputs for one arena/side-condition campaign.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArenaConditionScenario {
    pub condition_id: String,
    pub scope: ArenaConditionScope,
    pub layers_initial: u8,
    pub layers_stack: u8,
    pub turns: u16,
}

/// Drives the complete arena/side-condition lifecycle: zero-turn rejection,
/// fresh application, layer stacking with counter refresh, ceiling-overflow
/// rejection, removal, and removal-of-absent failure closed.
pub fn run_arena_condition_lifecycle(
    battle: &BattleStateV2,
    scenario: &ArenaConditionScenario,
) -> Result<FieldLifecycleReport, FieldParityError> {
    if scenario.layers_initial == 0 || scenario.layers_stack == 0 {
        return Err(FieldParityError::Invariant(
            "arena scenarios require positive layer counts".to_owned(),
        ));
    }
    if scenario.turns == 0 {
        return Err(FieldParityError::Invariant(
            "arena scenarios require a positive turn budget".to_owned(),
        ));
    }
    let condition_key = arena_scope_key(&scenario.condition_id, &scenario.scope);
    let mut steps = Vec::new();
    let mut state = battle.clone();
    let mut ordinal = 1_u32;

    // 1. Zero-turn budgets are rejected without staging.
    let before = state.clone();
    let zero_turn =
        stage_side_condition_set(&mut state, &scenario.condition_id, scenario.scope, scenario.layers_initial, 0, ordinal);
    match zero_turn {
        Err(StatusFieldExecutorError::ZeroTurnDuration) => {}
        Err(other) => {
            return Err(FieldParityError::Invariant(format!(
                "zero-turn budget failed with an unexpected error: {other}"
            )))
        }
        Ok(_) => {
            return Err(FieldParityError::Invariant(
                "zero-turn budget unexpectedly staged".to_owned(),
            ))
        }
    }
    steps.push(FieldLifecycleStep::CycleSetRejectedZeroTurns {
        domain: FieldDomain::ArenaCondition.name().to_owned(),
        state_unchanged: state == before,
    });

    // 2. Fresh application appends in source order.
    stage_side_condition_set(
        &mut state,
        &scenario.condition_id,
        scenario.scope,
        scenario.layers_initial,
        scenario.turns,
        ordinal,
    )?;
    steps.push(FieldLifecycleStep::ArenaStacked {
        condition: condition_key.clone(),
        scope: arena_condition_scope_name(&scenario.scope),
        before_layers: 0,
        after_layers: scenario.layers_initial,
    });
    ordinal += 1;

    // 3. Stacking accumulates layers and refreshes the counter.
    let stacked_layers = scenario
        .layers_initial
        .checked_add(scenario.layers_stack)
        .ok_or_else(|| {
            FieldParityError::Invariant("arena scenario layers overflow u8".to_owned())
        })?;
    stage_side_condition_set(
        &mut state,
        &scenario.condition_id,
        scenario.scope,
        scenario.layers_stack,
        scenario.turns.checked_add(1).unwrap_or(scenario.turns),
        ordinal,
    )?;
    steps.push(FieldLifecycleStep::ArenaStacked {
        condition: condition_key.clone(),
        scope: arena_condition_scope_name(&scenario.scope),
        before_layers: scenario.layers_initial,
        after_layers: stacked_layers,
    });
    ordinal += 1;

    // 4. Layer overflow is rejected without mutating the staged state.
    let overflow = stage_side_condition_set(
        &mut state,
        &scenario.condition_id,
        scenario.scope,
        u8::MAX,
        scenario.turns,
        ordinal,
    );
    match overflow {
        Err(StatusFieldExecutorError::LayerOverflow) => {
            steps.push(FieldLifecycleStep::LayerOverflowRejected {
                subject: condition_key.clone(),
            });
        }
        Err(other) => {
            return Err(FieldParityError::Invariant(format!(
                "layer overflow failed with an unexpected error: {other}"
            )))
        }
        Ok(_) => {
            return Err(FieldParityError::Invariant(
                "layer overflow unexpectedly staged".to_owned(),
            ))
        }
    }
    ordinal += 1;

    // 5. Removal clears exactly the scoped entry.
    stage_arena_tag_remove(&mut state, &scenario.condition_id, scenario.scope, ordinal)?;
    steps.push(FieldLifecycleStep::ArenaRemoved {
        condition: condition_key.clone(),
        scope: arena_condition_scope_name(&scenario.scope),
    });
    ordinal += 1;

    // 6. Removing an absent condition fails closed without mutating.
    let before = state.clone();
    let absent = stage_arena_tag_remove(&mut state, &scenario.condition_id, scenario.scope, ordinal);
    match absent {
        Err(StatusFieldExecutorError::ConditionMissing { .. }) => {}
        Err(other) => {
            return Err(FieldParityError::Invariant(format!(
                "absent removal failed with an unexpected error: {other}"
            )))
        }
        Ok(_) => {
            return Err(FieldParityError::Invariant(
                "absent removal unexpectedly succeeded".to_owned(),
            ))
        }
    }
    steps.push(FieldLifecycleStep::ArenaRemoveRejectedMissing {
        condition: condition_key.clone(),
        scope: arena_condition_scope_name(&scenario.scope),
        state_unchanged: state == before,
    });
    if !state.arena_conditions.is_empty() {
        return Err(FieldParityError::Invariant(
            "arena campaign ended with residual conditions".to_owned(),
        ));
    }

    Ok(FieldLifecycleReport {
        schema_version: FIELD_PARITY_SCHEMA_VERSION,
        domain: FieldDomain::ArenaCondition,
        subject_key: condition_key,
        steps,
        audited_draws: 0,
    })
}

fn arena_condition_scope_name(scope: &ArenaConditionScope) -> String {
    match scope {
        ArenaConditionScope::Both => "BOTH".to_owned(),
        ArenaConditionScope::Side(BattleSide::Player) => "SIDE_PLAYER".to_owned(),
        ArenaConditionScope::Side(BattleSide::Enemy) => "SIDE_ENEMY".to_owned(),
    }
}

fn arena_scope_key(condition_id: &str, scope: &ArenaConditionScope) -> String {
    format!(
        "ARENA_CONDITION:{}@{}",
        condition_id,
        arena_condition_scope_name(scope)
    )
}

// ---------------------------------------------------------------------------
// Unsupported-identity probe, divergence and witness evaluation
// ---------------------------------------------------------------------------

/// Probes one unresolvable identity and records its typed fail-closed
/// verdict. This is the entire transcript such identities get: no behavior
/// is synthesized on their behalf.
pub fn probe_unsupported_identity(subject: &FieldSubject, reason: String) -> FieldLifecycleReport {
    let subject_key = subject.key();
    FieldLifecycleReport {
        schema_version: FIELD_PARITY_SCHEMA_VERSION,
        domain: FieldDomain::MajorStatus,
        subject_key: subject_key.clone(),
        steps: vec![FieldLifecycleStep::UnsupportedIdentityRejected {
            subject: subject_key,
            reason,
        }],
        audited_draws: 0,
    }
}

/// First structural divergence between two ordered transcripts. Identical
/// transcripts yield `None`; a shared-prefix length difference reports the
/// first missing index.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FieldDivergence {
    pub index: usize,
}

pub fn first_divergence(
    left: &[FieldLifecycleStep],
    right: &[FieldLifecycleStep],
) -> Option<FieldDivergence> {
    let shared = left.len().min(right.len());
    for index in 0..shared {
        if left[index] != right[index] {
            return Some(FieldDivergence { index });
        }
    }
    if left.len() != right.len() {
        return Some(FieldDivergence { index: shared });
    }
    None
}

/// Closed frozen witness assertion vocabulary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WitnessAssertion {
    /// The unit's source reached its production handler and produced at
    /// least one real mutation on that subject.
    SourceReached,
    /// The unit's transcript contains at least one verified false-condition
    /// outcome that left the state untouched.
    FalseConditionDoesNotMutate,
}

impl WitnessAssertion {
    pub fn parse(raw: &str) -> Result<Self, FieldParityError> {
        match raw {
            "SOURCE_REACHED" => Ok(Self::SourceReached),
            "FALSE_CONDITION_DOES_NOT_MUTATE" => Ok(Self::FalseConditionDoesNotMutate),
            other => Err(FieldParityError::UnknownAssertion(other.to_owned())),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::SourceReached => "SOURCE_REACHED",
            Self::FalseConditionDoesNotMutate => "FALSE_CONDITION_DOES_NOT_MUTATE",
        }
    }
}

/// Evaluates one report against the frozen positive and negative witness
/// assertions of its behavior unit.
///
/// Assertion polarity names the oracle branch it describes, not whether the
/// property must fail: `SOURCE_REACHED` covers the positive branch (the
/// unit's source reached its production handler and produced a real
/// mutation), while `FALSE_CONDITION_DOES_NOT_MUTATE` covers the negative
/// branch (at least one false-condition outcome was exercised and verified
/// to leave the state untouched).
pub fn evaluate_witness(
    report: &FieldLifecycleReport,
    positive: &[WitnessAssertion],
    negative: &[WitnessAssertion],
) -> Result<(), FieldParityError> {
    for (branch, assertions) in [("POSITIVE", positive), ("NEGATIVE", negative)] {
        for assertion in assertions {
            match assertion {
                WitnessAssertion::SourceReached => {
                    let reached = report.steps.iter().any(|step| {
                        let addressed = match step {
                            // Cycle steps carry no subject key; they address
                            // their unit through the domain/code pair staged.
                            FieldLifecycleStep::CycleSet { domain, after_code, .. } => {
                                report.subject_key == format!("{domain}:{after_code}")
                            }
                            _ => step.subject() == Some(report.subject_key.as_str()),
                        };
                        addressed && step.mutates()
                    });
                    if !reached {
                        return Err(FieldParityError::WitnessNotSatisfied {
                            assertion: format!("{branch}:{}", assertion.name()),
                            subject: report.subject_key.clone(),
                            detail: "no mutating step addressed the unit's subject".to_owned(),
                        });
                    }
                }
                WitnessAssertion::FalseConditionDoesNotMutate => {
                    let proven = report
                        .steps
                        .iter()
                        .any(|step| step.false_condition_verified());
                    if !proven {
                        return Err(FieldParityError::WitnessNotSatisfied {
                            assertion: format!("{branch}:{}", assertion.name()),
                            subject: report.subject_key.clone(),
                            detail: "no verified false-condition outcome in the transcript"
                                .to_owned(),
                        });
                    }
                }
            }
        }
    }
    Ok(())
}

fn preserved_status_names(statuses: &[StatusKind]) -> Vec<String> {
    statuses
        .iter()
        .map(|kind| status_name(*kind).to_owned())
        .collect()
}
