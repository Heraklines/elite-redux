//! Held-item/modifier catalog parity adapter for the M6 system proof.
//!
//! This module closes the held-item axis of the system proof over the
//! production surfaces only: the frozen semantic catalog's `HELD_ITEM` /
//! `MODIFIER_BEHAVIOR` units and their classification manifest produced by
//! the deterministic semantic compile, the bespoke item-lifecycle handler
//! family (`ITEM_BERRY_LIFECYCLE`), the V2 item-routine executor, the audited
//! battle RNG streams, and the prepared-vs-direct routine execution pair.
//! Everything here is pure and deterministic; no wall clock, host state, or
//! environment participates.
//!
//! The proof has five axes, each backed by typed evidence:
//!
//! 1. **Exactly-once inventory.** [`inventory_held_items`] walks every
//!    modifier behavior unit of the catalog and its classification manifest
//!    and proves each registry key is classified exactly once with a closed,
//!    non-unsupported outcome (`Compiled` programs or a routed bespoke
//!    cluster). Any gap, duplicate, or unsupported identity fails closed
//!    with a typed error naming the offending key.
//! 2. **Ordered source stack.** [`ordered_item_source_stack`] derives the
//!    sorted, deduplicated behavior-source stack implied by the live
//!    lifecycle state — the exact identity form consumed by the sorted-slice
//!    contract of [`MechanicsContextV2`].
//! 3. **Eligibility parity.** Every trigger-shaped campaign step compares
//!    the canonical bespoke [`trigger_eligibility`] gate against the
//!    executor's [`item_is_active`] gate over the mirrored per-holder
//!    extension slices; disagreement aborts the campaign instead of being
//!    absorbed.
//! 4. **Lifecycle campaigns with audited RNG.** [`run_item_campaign`]
//!    executes grant / eligibility / consume / restore / transfer /
//!    knock-off / swap / suppress / expire steps through both the canonical
//!    lifecycle state root and (where the closed V2 operation surface can
//!    express them) the extension-slice executor path. Turn parameters
//!    sourced from [`TurnSource::Draw`] are resolved through audited
//!    battle-stream draws whose complete ordered audit log ships with the
//!    run evidence.
//! 5. **Witness comparison.** Each step records an [`ItemStepWitness`];
//!    [`first_campaign_divergence`] reports the first observable difference
//!    between two runs at the exact step and field;
//!    [`compare_prepared_and_direct`] returns per-axis first-divergence
//!    reports for indexed-versus-scan routine execution under an
//!    item-derived source stack.
//!
//! Fail-closed rules mirror the production handlers: a lifecycle rejection
//! is a typed negative witness that provably leaves both roots unchanged,
//! an instance shape outside the shared single-counter V2 surface is
//! recorded as [`ExecutorMirror::UnmirroredShape`] rather than approximated,
//! and no step ever manufactures a passing result.

use std::collections::BTreeSet;

use er_canonical::content_digest;
use er_content::m6_catalog::CatalogBehaviorUnit;
use er_content::pack::m6_pack::{BehaviorClassificationEntryV2, BehaviorClassificationManifestV2};
use er_mechanics::program_v2::MechanicsProgramV2;
use er_mechanics::selector_operation_v2::MechanicOperationV2;
use er_mechanics::v2::{MechanicHookV2, MechanicQueryV2};
use er_rng::audit::{RngCallsiteId, RngDraw, RngReason};
use er_rng::battle::RngRuntime;
use er_state::bespoke_v2::item_lifecycle::ItemLifecycleStateV2;
use er_state::mechanic_state::{HeldItemStateV1, MechanicStateStoreV1};
use er_state::migration_v3::PokemonMechanicExtensionV3;
use er_types::battle_ids::{PokemonId, WaveIndex};
use er_types::mechanics::{MechanicsProgramId, SourceOrdinal};
use er_types::{
    BehaviorClassificationKindV2, BehaviorSourceId, BehaviorUnitId, BehaviorUnitKind,
    BespokeMechanicId, SafeU53,
};
use thiserror::Error;

use crate::m6::bespoke::item_lifecycle::{
    ConsumeEvidence, ConsumeOutcome, ConsumeRequest, ExpireEvidence, ExpireRequest, GrantEvidence,
    GrantRequest, ItemLifecycleError, ItemTriggerEligibility, KnockOffRequest, RestoreEvidence,
    RestoreRequest, SuppressEvidence, SuppressRequest, SwapEvidence, SwapRequest, TransferEvidence,
    TransferMode, TransferRequest, consume_item, expire_suppressions, grant_item, knock_off_item,
    restore_item, suppress_item, swap_items, transfer_item, trigger_eligibility,
};
use crate::m6::item_executor::{
    ItemExecutorError, ItemMutationEvidence, apply_item_routine, item_is_active,
};
use crate::m6::routine_executor::{
    MechanicsContextV2, MechanicsTransitionV2, QueryTransitionV2, QueryValueV2,
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Typed failures of the held-item parity adapter. Every variant names its
/// subject; nothing degrades into a silent pass.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ItemParityError {
    #[error("held-item unit {registry_key:?} appears more than once in the catalog")]
    DuplicateHeldItemUnit { registry_key: String },
    #[error("held-item unit {registry_key:?} has no classification entry")]
    UnclassifiedHeldItemUnit { registry_key: String },
    #[error("classification entry for unknown held-item unit {registry_key:?}")]
    UnknownHeldItemClassification { registry_key: String },
    #[error("held-item unit {registry_key:?} carries no closed outcome")]
    UnsupportedIdentity { registry_key: String },
    #[error("eligibility gates diverged at step {ordinal}: {detail}")]
    GateDivergence { ordinal: u32, detail: String },
    #[error("executor mirror diverged from the lifecycle root at step {ordinal}: {detail}")]
    MirrorDivergence { ordinal: u32, detail: String },
    #[error("campaign action at step {ordinal} references an unregistered holder")]
    UnregisteredHolder { ordinal: u32 },
    #[error("drawn turn range {minimum}..={maximum} is empty")]
    EmptyTurnRange { minimum: u32, maximum: u32 },
    #[error("routine execution failed: {0}")]
    Routine(String),
    #[error("audited rng failed: {0}")]
    Rng(String),
    #[error("canonical digest failed: {0}")]
    Digest(String),
    #[error("lifecycle transition failed: {0}")]
    Lifecycle(#[from] ItemLifecycleError),
    #[error("item executor failed: {0}")]
    Executor(#[from] ItemExecutorError),
}

fn digest<T: serde::Serialize>(value: &T) -> Result<String, ItemParityError> {
    content_digest(value).map_err(|error| ItemParityError::Digest(error.to_string()))
}

// ---------------------------------------------------------------------------
// Exactly-once inventory
// ---------------------------------------------------------------------------

/// One exactly-once inventory row for a held-item modifier unit.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HeldItemInventoryEntry {
    /// The held-item registry key (the source identity of the unit).
    pub registry_key: String,
    /// The catalog source identity this row was derived from.
    pub unit_source: BehaviorSourceId,
    /// The unit kind observed on the owning behavior unit.
    pub unit_kind: BehaviorUnitKind,
    /// Closed classification kind from the production classification manifest.
    pub kind: BehaviorClassificationKindV2,
    /// Routed bespoke mechanic for `Bespoke` rows.
    pub bespoke: Option<BespokeMechanicId>,
    /// Allocated mechanics programs for `Compiled` rows.
    pub programs: Vec<MechanicsProgramId>,
    /// Typed gap reason for `Unsupported` rows; never present on closed rows.
    pub unsupported_reason: Option<String>,
}

/// Complete exactly-once inventory over one catalog's held-item units.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HeldItemInventory {
    /// Rows sorted by ascending registry key; keys are unique.
    pub entries: Vec<HeldItemInventoryEntry>,
    /// Number of `MODIFIER_BEHAVIOR` + held-item units found in the catalog.
    pub catalog_units: usize,
}

impl HeldItemInventory {
    /// Registry keys in canonical sorted order.
    #[must_use]
    pub fn registry_keys(&self) -> Vec<&str> {
        self.entries
            .iter()
            .map(|entry| entry.registry_key.as_str())
            .collect()
    }
}

/// Builds the exactly-once held-item/modifier inventory from the frozen
/// catalog units and the production classification manifest.
///
/// Fails closed unless every modifier behavior unit is classified exactly
/// once with a closed outcome: `Compiled` rows must carry programs, `Bespoke`
/// rows a routed mechanic, and no row may remain `Unsupported`. Classification
/// entries pointing at held items outside the catalog are rejected as well,
/// so the manifest cannot quietly grow phantom identities.
pub fn inventory_held_items(
    catalog_units: &[CatalogBehaviorUnit],
    classifications: &BehaviorClassificationManifestV2,
) -> Result<HeldItemInventory, ItemParityError> {
    fn owns(unit: &CatalogBehaviorUnit) -> bool {
        unit.id.unit_kind == BehaviorUnitKind::ModifierBehavior
            && matches!(unit.id.source, BehaviorSourceId::HeldItem { .. })
    }

    let mut seen = BTreeSet::new();
    let mut entries = Vec::new();

    for unit in catalog_units.iter().filter(|unit| owns(unit)) {
        let BehaviorSourceId::HeldItem { registry_key } = &unit.id.source else {
            continue;
        };
        if !seen.insert(&unit.id) {
            return Err(ItemParityError::DuplicateHeldItemUnit {
                registry_key: registry_key.clone(),
            });
        }
        let mut matching = classifications
            .0
            .iter()
            .filter(|entry| entry.behavior_unit == unit.id);
        let entry = match (matching.next(), matching.next()) {
            (Some(entry), None) => entry,
            _ => {
                return Err(ItemParityError::UnclassifiedHeldItemUnit {
                    registry_key: registry_key.clone(),
                });
            }
        };
        // Zero unsupported: every identity closes as compiled or routed.
        if !classification_is_closed(entry) {
            return Err(ItemParityError::UnsupportedIdentity {
                registry_key: registry_key.clone(),
            });
        }
        entries.push(HeldItemInventoryEntry {
            registry_key: registry_key.clone(),
            unit_source: unit.id.source.clone(),
            unit_kind: unit.id.unit_kind,
            kind: entry.kind,
            bespoke: entry.bespoke,
            programs: entry.programs.clone(),
            unsupported_reason: entry.unsupported_reason.clone(),
        });
    }

    let catalog_held: BTreeSet<&BehaviorUnitId> = catalog_units
        .iter()
        .filter(|unit| owns(unit))
        .map(|unit| &unit.id)
        .collect();
    for entry in &classifications.0 {
        if !matches!(
            entry.behavior_unit.source,
            BehaviorSourceId::HeldItem { .. }
        ) {
            continue;
        }
        if !catalog_held.contains(&entry.behavior_unit) {
            let BehaviorSourceId::HeldItem { registry_key } = &entry.behavior_unit.source else {
                continue;
            };
            return Err(ItemParityError::UnknownHeldItemClassification {
                registry_key: registry_key.clone(),
            });
        }
    }

    entries.sort_by(|left, right| left.registry_key.cmp(&right.registry_key));
    debug_assert_eq!(
        entries.len(),
        seen.len(),
        "exactly-once inventory must not lose rows"
    );
    Ok(HeldItemInventory {
        entries,
        catalog_units: seen.len(),
    })
}

/// Closed-outcome shape required by pack validation itself: compiled rows
/// carry programs, bespoke rows a routed mechanic, and nothing stays
/// `Unsupported`.
fn classification_is_closed(entry: &BehaviorClassificationEntryV2) -> bool {
    match entry.kind {
        BehaviorClassificationKindV2::Compiled => !entry.programs.is_empty(),
        BehaviorClassificationKindV2::Bespoke => entry.bespoke.is_some(),
        BehaviorClassificationKindV2::Unsupported => false,
    }
}

// ---------------------------------------------------------------------------
// Ordered source stack
// ---------------------------------------------------------------------------

/// Derives the ordered behavior-source stack implied by the live lifecycle
/// state: one sorted, deduplicated `HeldItem` source per distinct live
/// registry key, in the canonical order `MechanicsContextV2` binary-searches.
#[must_use]
pub fn ordered_item_source_stack(state: &ItemLifecycleStateV2) -> Vec<BehaviorSourceId> {
    let mut sources: Vec<BehaviorSourceId> = state
        .instances
        .iter()
        .map(|instance| BehaviorSourceId::HeldItem {
            registry_key: instance.registry_key.clone(),
        })
        .collect();
    sources.sort();
    sources.dedup();
    sources
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

/// Where a step's turn parameter comes from. `Draw` sources are resolved via
/// one audited battle-stream draw per use, recorded in the step witness.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TurnSource {
    Fixed(u32),
    Draw { minimum: u32, maximum: u32 },
}

/// One deterministic campaign action over the item lifecycle.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ItemCampaignAction {
    Grant {
        owner: PokemonId,
        registry_key: String,
        stacks: u16,
        charges: Option<u16>,
        source_ordinal: u32,
        transferable: bool,
    },
    Eligibility {
        owner: PokemonId,
        registry_key: String,
        current_turn: TurnSource,
    },
    Consume {
        owner: PokemonId,
        registry_key: String,
        preserve: bool,
        current_turn: TurnSource,
    },
    Restore {
        owner: PokemonId,
    },
    Transfer {
        from: PokemonId,
        to: PokemonId,
        registry_key: String,
        mode: TransferMode,
    },
    KnockOff {
        target: PokemonId,
        registry_key: String,
    },
    Swap {
        left: PokemonId,
        left_registry_key: String,
        right: PokemonId,
        right_registry_key: String,
    },
    Suppress {
        holder: PokemonId,
        registry_key: String,
        expiry_turn: TurnSource,
    },
    Expire {
        current_turn: TurnSource,
    },
}

/// Typed positive evidence of one executed campaign step.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ItemStepEvidence {
    Grant(GrantEvidence),
    Eligibility(ItemTriggerEligibility),
    Consume(ConsumeEvidence),
    Restore(RestoreEvidence),
    Transfer(TransferEvidence),
    Swap(SwapEvidence),
    Suppress(SuppressEvidence),
    Expire(ExpireEvidence),
}

/// How the executor-side mirror observed one step.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ExecutorMirror {
    /// The step is lifecycle-root-only or seeds initial mirrored state; no
    /// executable operation slice applies (restore ledger re-seeding,
    /// ownership changes, suppression windows).
    NotMirrored,
    /// The instance shape falls outside the shared single-counter surface
    /// (stacks and charges would diverge). Recorded, never approximated.
    UnmirroredShape { registry_key: String },
    /// The mirrored operation slice executed with before/after evidence.
    Applied {
        evidence: Vec<ItemMutationEvidence>,
        charges_after: Option<u16>,
    },
}

/// Complete per-step witness: action, audited RNG usage, typed outcome, both
/// state-root fingerprints, the executor-mirror record, and the derived
/// ordered source stack after the step.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ItemStepWitness {
    pub ordinal: u32,
    pub action: ItemCampaignAction,
    pub rng_sequences: Vec<SafeU53>,
    pub outcome: Result<ItemStepEvidence, ItemLifecycleError>,
    /// Fingerprint of both roots after the step; for a rejected negative
    /// witness this equals the previous accepted fingerprint, proving the
    /// rejection mutated nothing.
    pub lifecycle_fingerprint_after: String,
    pub extensions_fingerprint_after: String,
    pub mirror: ExecutorMirror,
    pub source_stack_after: Vec<BehaviorSourceId>,
}

/// Deterministic run configuration: battle identity for the audited stream
/// plus the fixed holder roster the campaign acts upon.
#[derive(Clone, Debug)]
pub struct ItemCampaignConfig<'a> {
    pub wave_seed: &'a str,
    pub wave: WaveIndex,
    pub holders: &'a [PokemonId],
}

/// Full evidence of one campaign execution.
#[derive(Clone, Debug)]
pub struct ItemCampaignRun {
    pub wave_seed: String,
    pub wave: WaveIndex,
    pub steps: Vec<ItemStepWitness>,
    pub final_state: ItemLifecycleStateV2,
    pub final_extensions: Vec<PokemonMechanicExtensionV3>,
    pub audit_entries: Vec<RngDraw>,
}

/// Single-counter mirror rule: plain stack items mirror `charges := stacks`;
/// charged items mirror only when `stacks == charges`, because the bespoke
/// root decrements both counters per consumption while the V2 executor holds
/// a single charge counter. Any other shape returns `None`: a fail-closed
/// gap, never an approximation.
fn resolve_mirror_charges(stacks: u16, charges: Option<u16>) -> Option<u16> {
    match charges {
        None => Some(stacks),
        Some(charges) => (charges == stacks).then_some(charges),
    }
}

/// Operation slice mirroring one bespoke consume outcome onto the V2
/// executor surface. Destruction maps to burn-then-remove so both roots end
/// without the instance; survival maps to a single checked stack decrement;
/// preserved/suppressed/duplicate triggers map to the empty slice.
fn mirror_consume_operations(spent_out: bool) -> Vec<MechanicOperationV2> {
    if spent_out {
        vec![
            MechanicOperationV2::HeldItemConsume,
            MechanicOperationV2::HeldItemRemove,
        ]
    } else {
        vec![MechanicOperationV2::HeldItemStack { delta: -1 }]
    }
}

struct CampaignSession {
    state: ItemLifecycleStateV2,
    extensions: Vec<PokemonMechanicExtensionV3>,
    /// Slots whose grant was recorded as an unmirrored shape; later steps on
    /// these slots stay off the executor path instead of failing spuriously.
    unmirrored: BTreeSet<(PokemonId, String)>,
}

impl CampaignSession {
    fn new(holders: &[PokemonId]) -> Self {
        Self {
            state: ItemLifecycleStateV2::default(),
            extensions: holders
                .iter()
                .map(|holder| PokemonMechanicExtensionV3 {
                    pokemon_id: *holder,
                    held_items: Vec::new(),
                    mechanics: MechanicStateStoreV1::default(),
                })
                .collect(),
            unmirrored: BTreeSet::new(),
        }
    }

    fn extension_index(&self, owner: PokemonId) -> Option<usize> {
        self.extensions
            .iter()
            .position(|extension| extension.pokemon_id == owner)
    }

    fn mark_unmirrored(&mut self, owner: PokemonId, registry_key: &str) {
        self.unmirrored.insert((owner, registry_key.to_owned()));
    }

    fn is_unmirrored(&self, owner: PokemonId, registry_key: &str) -> bool {
        self.unmirrored.contains(&(owner, registry_key.to_owned()))
    }

    /// Mirrors one grant into the executor-side extension slice. Returns
    /// `Ok(None)` when the shape sits outside the shared surface.
    fn mirror_grant(
        &mut self,
        ordinal: u32,
        owner: PokemonId,
        registry_key: &str,
        final_stacks: u16,
        charges: Option<u16>,
    ) -> Result<Option<()>, ItemParityError> {
        let Some(charges_value) = resolve_mirror_charges(final_stacks, charges) else {
            self.mark_unmirrored(owner, registry_key);
            return Ok(None);
        };
        let Some(index) = self.extension_index(owner) else {
            return Err(ItemParityError::MirrorDivergence {
                ordinal,
                detail: format!("holder {owner:?} has no extension slice"),
            });
        };
        let held_items = &mut self.extensions[index].held_items;
        match held_items
            .iter_mut()
            .find(|item| item.registry_key == registry_key)
        {
            Some(item) => item.charges = charges_value,
            None => {
                let slot = u64::try_from(held_items.len()).map_err(|_| {
                    ItemParityError::MirrorDivergence {
                        ordinal,
                        detail: "too many distinct held items for one holder".to_owned(),
                    }
                })?;
                let item_id =
                    SafeU53::new(slot + 1).map_err(|_| ItemParityError::MirrorDivergence {
                        ordinal,
                        detail: "item id overflow".to_owned(),
                    })?;
                held_items.push(HeldItemStateV1 {
                    item_id,
                    registry_key: registry_key.to_owned(),
                    source_ordinal: SourceOrdinal::ZERO,
                    consumed: false,
                    charges: charges_value,
                });
                held_items.sort_by(|left, right| left.registry_key.cmp(&right.registry_key));
            }
        }
        Ok(Some(()))
    }

    fn execute_mirror(
        &mut self,
        ordinal: u32,
        owner: PokemonId,
        registry_key: &str,
        operations: &[MechanicOperationV2],
    ) -> Result<ExecutorMirror, ItemParityError> {
        let Some(index) = self.extension_index(owner) else {
            return Err(ItemParityError::MirrorDivergence {
                ordinal,
                detail: format!("holder {owner:?} has no extension slice"),
            });
        };
        let evidence = apply_item_routine(&mut self.extensions, owner, registry_key, operations)
            .map_err(ItemParityError::Executor)?;
        let charges_after = self.extensions[index]
            .held_items
            .iter()
            .find(|item| item.registry_key == registry_key)
            .map(|item| item.charges);
        Ok(ExecutorMirror::Applied {
            evidence,
            charges_after,
        })
    }

    /// Cross-path eligibility gate comparison. The bespoke gate and the
    /// executor activation gate must agree on the presence axis:
    /// `Eligible`/`Suppressed` imply an active unconsumed entry, and
    /// `Exhausted`/`Absent` imply no active entry.
    fn check_gate_parity(
        &self,
        ordinal: u32,
        owner: PokemonId,
        registry_key: &str,
        current_turn: u32,
    ) -> Result<(), ItemParityError> {
        let bespoke = trigger_eligibility(&self.state, owner, registry_key, current_turn)?;
        let executor_active = item_is_active(&self.extensions, owner, registry_key)
            .map_err(ItemParityError::Executor)?;
        let expect_active = matches!(
            bespoke,
            ItemTriggerEligibility::Eligible | ItemTriggerEligibility::Suppressed { .. }
        );
        if expect_active != executor_active {
            return Err(ItemParityError::GateDivergence {
                ordinal,
                detail: format!(
                    "bespoke eligibility {bespoke:?} but executor active flag is {executor_active}"
                ),
            });
        }
        Ok(())
    }
}

/// Executes one deterministic campaign. Steps run in order against fresh
/// roots; every draw-backed turn resolves through the audited battle stream;
/// every step appends a complete witness. A rejected (negative-witness) step
/// leaves both roots untouched and records the typed rejection.
pub fn run_item_campaign(
    config: &ItemCampaignConfig<'_>,
    actions: &[ItemCampaignAction],
) -> Result<ItemCampaignRun, ItemParityError> {
    let mut runtime = RngRuntime::from_run_seed(config.wave_seed);
    runtime
        .initialize_battle(config.wave_seed, config.wave)
        .map_err(|error| ItemParityError::Rng(error.to_string()))?;
    let mut session = CampaignSession::new(config.holders);
    let mut steps = Vec::with_capacity(actions.len());

    for (index, action) in actions.iter().enumerate() {
        let ordinal = u32::try_from(index)
            .map_err(|_| ItemParityError::Digest("campaign exceeds u32 step count".to_owned()))?;
        if !action_references_registered_holders(config.holders, action) {
            return Err(ItemParityError::UnregisteredHolder { ordinal });
        }

        // Resolve draw-backed turns first: they consume audited draws even
        // when the step ends up rejected, keeping RNG ordering a pure
        // function of the seed and action list.
        let mut rng_sequences = Vec::new();
        let turns = resolve_action_turns(&mut runtime, &mut rng_sequences, action)?;

        let fingerprint_before = digest(&session.state)?;
        let executions = execute_action(&mut session, ordinal, action, &turns)?;
        let lifecycle_fingerprint_after = digest(&session.state)?;
        let extensions_fingerprint_after = digest(&session.extensions)?;
        let source_stack_after = ordered_item_source_stack(&session.state);

        steps.push(ItemStepWitness {
            ordinal,
            action: action.clone(),
            rng_sequences,
            outcome: executions.evidence,
            lifecycle_fingerprint_after: if executions.rejected {
                fingerprint_before
            } else {
                lifecycle_fingerprint_after
            },
            extensions_fingerprint_after,
            mirror: executions.mirror,
            source_stack_after,
        });
    }

    Ok(ItemCampaignRun {
        wave_seed: config.wave_seed.to_owned(),
        wave: config.wave,
        steps,
        final_state: session.state,
        final_extensions: session.extensions,
        audit_entries: runtime.audit_entries().to_vec(),
    })
}

fn action_references_registered_holders(
    holders: &[PokemonId],
    action: &ItemCampaignAction,
) -> bool {
    let registered = |owner: &PokemonId| holders.contains(owner);
    match action {
        ItemCampaignAction::Grant { owner, .. }
        | ItemCampaignAction::Eligibility { owner, .. }
        | ItemCampaignAction::Consume { owner, .. }
        | ItemCampaignAction::Restore { owner }
        | ItemCampaignAction::KnockOff { target: owner, .. }
        | ItemCampaignAction::Suppress { holder: owner, .. } => registered(owner),
        ItemCampaignAction::Transfer { from, to, .. } => registered(from) && registered(to),
        ItemCampaignAction::Swap { left, right, .. } => registered(left) && registered(right),
        ItemCampaignAction::Expire { .. } => true,
    }
}

/// Resolves every `TurnSource::Draw` of the action through the audited
/// battle stream, recording each draw's audit sequence in order.
fn resolve_action_turns(
    runtime: &mut RngRuntime,
    sequences: &mut Vec<SafeU53>,
    action: &ItemCampaignAction,
) -> Result<[u32; 2], ItemParityError> {
    let turn_sources: [Option<TurnSource>; 2] = match action {
        ItemCampaignAction::Eligibility { current_turn, .. }
        | ItemCampaignAction::Consume { current_turn, .. } => [Some(*current_turn), None],
        ItemCampaignAction::Suppress { expiry_turn, .. } => [None, Some(*expiry_turn)],
        ItemCampaignAction::Expire { current_turn } => [Some(*current_turn), None],
        _ => [None, None],
    };
    let mut resolved = [0_u32; 2];
    for (slot, source) in turn_sources.into_iter().enumerate() {
        let Some(source) = source else { continue };
        resolved[slot] = match source {
            TurnSource::Fixed(value) => value,
            TurnSource::Draw { minimum, maximum } => {
                if minimum > maximum {
                    return Err(ItemParityError::EmptyTurnRange { minimum, maximum });
                }
                let minimum_id = SafeU53::new(u64::from(minimum))
                    .map_err(|_| ItemParityError::EmptyTurnRange { minimum, maximum })?;
                let maximum_id = SafeU53::new(u64::from(maximum))
                    .map_err(|_| ItemParityError::EmptyTurnRange { minimum, maximum })?;
                let sequence = runtime.next_audit_sequence().ok_or_else(|| {
                    ItemParityError::Rng("audit sequence exhausted before draw".to_owned())
                })?;
                let drawn = runtime
                    .battle_rand_seed_int_range(
                        minimum_id,
                        maximum_id,
                        RngReason::ItemChance,
                        RngCallsiteId::mechanics(RngReason::ItemChance),
                    )
                    .map_err(|error| ItemParityError::Rng(error.to_string()))?;
                sequences.push(sequence);
                u32::try_from(drawn.get()).map_err(|_| {
                    ItemParityError::Rng(format!(
                        "drawn value {} exceeds the u32 turn range",
                        drawn.get()
                    ))
                })?
            }
        };
    }
    Ok(resolved)
}

struct StepExecutions {
    evidence: Result<ItemStepEvidence, ItemLifecycleError>,
    mirror: ExecutorMirror,
    rejected: bool,
}

fn rejected_step(error: ItemLifecycleError) -> StepExecutions {
    StepExecutions {
        evidence: Err(error),
        mirror: ExecutorMirror::NotMirrored,
        rejected: true,
    }
}

fn execute_action(
    session: &mut CampaignSession,
    ordinal: u32,
    action: &ItemCampaignAction,
    turns: &[u32; 2],
) -> Result<StepExecutions, ItemParityError> {
    match action {
        ItemCampaignAction::Grant {
            owner,
            registry_key,
            stacks,
            charges,
            source_ordinal,
            transferable,
        } => {
            let request = GrantRequest {
                owner: *owner,
                registry_key: registry_key.clone(),
                stacks: *stacks,
                charges: *charges,
                source_ordinal: SourceOrdinal::new(*source_ordinal),
                transferable: *transferable,
            };
            let transition = match grant_item(&session.state, &request) {
                Ok(transition) => transition,
                Err(error) => return Ok(rejected_step(error)),
            };
            let evidence = transition.evidence;
            session.state = transition.state;
            // Initial grants seed both roots identically: the extension slice
            // is constructed from the same final (stacks, charges) facts.
            let mirrored = session.mirror_grant(
                ordinal,
                *owner,
                registry_key,
                evidence.stacks_after,
                *charges,
            )?;
            Ok(StepExecutions {
                evidence: Ok(ItemStepEvidence::Grant(evidence)),
                mirror: if mirrored.is_some() {
                    ExecutorMirror::NotMirrored
                } else {
                    ExecutorMirror::UnmirroredShape {
                        registry_key: registry_key.clone(),
                    }
                },
                rejected: false,
            })
        }
        ItemCampaignAction::Eligibility {
            owner,
            registry_key,
            ..
        } => {
            // Slots outside the shared single-counter surface have no
            // extension entry to compare against; the bespoke gate alone
            // answers there.
            if !session.is_unmirrored(*owner, registry_key) {
                session.check_gate_parity(ordinal, *owner, registry_key, turns[0])?;
            }
            let eligibility = trigger_eligibility(&session.state, *owner, registry_key, turns[0])?;
            Ok(StepExecutions {
                evidence: Ok(ItemStepEvidence::Eligibility(eligibility)),
                mirror: ExecutorMirror::NotMirrored,
                rejected: false,
            })
        }
        ItemCampaignAction::Consume {
            owner,
            registry_key,
            preserve,
            ..
        } => {
            if !session.is_unmirrored(*owner, registry_key) {
                session.check_gate_parity(ordinal, *owner, registry_key, turns[0])?;
            }
            let request = ConsumeRequest {
                owner: *owner,
                registry_key: registry_key.clone(),
                preserve: *preserve,
                current_turn: turns[0],
            };
            let transition = match consume_item(&session.state, &request) {
                Ok(transition) => transition,
                Err(error) => return Ok(rejected_step(error)),
            };
            let spent_out = matches!(
                &transition.evidence.outcome,
                ConsumeOutcome::Consumed { ledger_ordinal, .. } if ledger_ordinal.is_some()
            );
            let evidence = transition.evidence;
            session.state = transition.state;
            let mirror = match evidence.outcome {
                ConsumeOutcome::Consumed { .. } if session.is_unmirrored(*owner, registry_key) => {
                    ExecutorMirror::UnmirroredShape {
                        registry_key: registry_key.clone(),
                    }
                }
                ConsumeOutcome::Consumed { .. } => {
                    let operations = mirror_consume_operations(spent_out);
                    session.execute_mirror(ordinal, *owner, registry_key, &operations)?
                }
                _ => ExecutorMirror::NotMirrored,
            };
            Ok(StepExecutions {
                evidence: Ok(ItemStepEvidence::Consume(evidence)),
                mirror,
                rejected: false,
            })
        }
        ItemCampaignAction::Restore { owner } => {
            match restore_item(&session.state, &RestoreRequest { owner: *owner }) {
                Ok(transition) => {
                    let evidence = transition.evidence;
                    session.state = transition.state;
                    let shape = session
                        .state
                        .find_instance(*owner, &evidence.registry_key)
                        .map(|instance| (instance.stacks, instance.charges));
                    if let Some((stacks, charges)) = shape {
                        session.mirror_grant(
                            ordinal,
                            *owner,
                            &evidence.registry_key,
                            stacks,
                            charges,
                        )?;
                    }
                    Ok(StepExecutions {
                        evidence: Ok(ItemStepEvidence::Restore(evidence)),
                        mirror: ExecutorMirror::NotMirrored,
                        rejected: false,
                    })
                }
                Err(error) => Ok(rejected_step(error)),
            }
        }
        ItemCampaignAction::Transfer {
            from,
            to,
            registry_key,
            mode,
        } => {
            let request = TransferRequest {
                from: *from,
                registry_key: registry_key.clone(),
                to: *to,
                mode: *mode,
            };
            match transfer_item(&session.state, &request) {
                Ok(transition) => {
                    let evidence = transition.evidence;
                    session.state = transition.state;
                    Ok(StepExecutions {
                        evidence: Ok(ItemStepEvidence::Transfer(evidence)),
                        mirror: ExecutorMirror::NotMirrored,
                        rejected: false,
                    })
                }
                Err(error) => Ok(rejected_step(error)),
            }
        }
        ItemCampaignAction::KnockOff {
            target,
            registry_key,
        } => {
            let request = KnockOffRequest {
                target: *target,
                registry_key: registry_key.clone(),
            };
            match knock_off_item(&session.state, &request) {
                Ok(transition) => {
                    let evidence = transition.evidence;
                    session.state = transition.state;
                    let mirror = if session.is_unmirrored(*target, registry_key) {
                        ExecutorMirror::UnmirroredShape {
                            registry_key: registry_key.clone(),
                        }
                    } else {
                        // The V2 operation surface expresses destruction as a
                        // direct removal; ownership-change ops without
                        // selector targets stay bespoke-only.
                        session.execute_mirror(
                            ordinal,
                            *target,
                            registry_key,
                            &[MechanicOperationV2::HeldItemRemove],
                        )?
                    };
                    Ok(StepExecutions {
                        evidence: Ok(ItemStepEvidence::Consume(evidence)),
                        mirror,
                        rejected: false,
                    })
                }
                Err(error) => Ok(rejected_step(error)),
            }
        }
        ItemCampaignAction::Swap {
            left,
            left_registry_key,
            right,
            right_registry_key,
        } => {
            let request = SwapRequest {
                left: *left,
                left_registry_key: left_registry_key.clone(),
                right: *right,
                right_registry_key: right_registry_key.clone(),
            };
            match swap_items(&session.state, &request) {
                Ok(transition) => {
                    let evidence = transition.evidence;
                    session.state = transition.state;
                    Ok(StepExecutions {
                        evidence: Ok(ItemStepEvidence::Swap(evidence)),
                        mirror: ExecutorMirror::NotMirrored,
                        rejected: false,
                    })
                }
                Err(error) => Ok(rejected_step(error)),
            }
        }
        ItemCampaignAction::Suppress {
            holder,
            registry_key,
            ..
        } => {
            let request = SuppressRequest {
                holder: *holder,
                registry_key: registry_key.clone(),
                expiry_turn: turns[1],
            };
            let transition = suppress_item(&session.state, &request)?;
            let evidence = transition.evidence;
            session.state = transition.state;
            Ok(StepExecutions {
                evidence: Ok(ItemStepEvidence::Suppress(evidence)),
                mirror: ExecutorMirror::NotMirrored,
                rejected: false,
            })
        }
        ItemCampaignAction::Expire { .. } => {
            let request = ExpireRequest {
                current_turn: turns[0],
            };
            let transition = expire_suppressions(&session.state, &request)?;
            let evidence = transition.evidence;
            session.state = transition.state;
            Ok(StepExecutions {
                evidence: Ok(ItemStepEvidence::Expire(evidence)),
                mirror: ExecutorMirror::NotMirrored,
                rejected: false,
            })
        }
    }
}

// ---------------------------------------------------------------------------
// Witness comparison (first-divergence reports)
// ---------------------------------------------------------------------------

/// First divergence between two campaign runs, reported at the exact step
/// and field where the runs stopped agreeing.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
#[error("{detail}")]
pub struct ItemDivergence {
    /// Step ordinal when known.
    pub step: Option<u32>,
    pub detail: String,
}

/// Reports the first observable difference between two runs, or `None` when
/// the runs are indistinguishable across every recorded axis: configuration,
/// step witnesses (actions, RNG sequences, outcomes, fingerprints, mirrors,
/// source stacks), final state roots, and the complete ordered RNG audit log.
pub fn first_campaign_divergence(
    left: &ItemCampaignRun,
    right: &ItemCampaignRun,
) -> Option<ItemDivergence> {
    if left.wave_seed != right.wave_seed || left.wave != right.wave {
        return Some(ItemDivergence {
            step: None,
            detail: "campaign configurations differ".to_owned(),
        });
    }
    if left.steps.len() != right.steps.len() {
        return Some(ItemDivergence {
            step: None,
            detail: format!(
                "step counts differ: {} vs {}",
                left.steps.len(),
                right.steps.len()
            ),
        });
    }
    for (left_step, right_step) in left.steps.iter().zip(right.steps.iter()) {
        if left_step.action != right_step.action {
            return Some(divergence_at(left_step.ordinal, "action"));
        }
        if left_step.rng_sequences != right_step.rng_sequences {
            return Some(divergence_at(left_step.ordinal, "rng_sequences"));
        }
        if left_step.outcome != right_step.outcome {
            return Some(divergence_at(left_step.ordinal, "outcome"));
        }
        if left_step.lifecycle_fingerprint_after != right_step.lifecycle_fingerprint_after {
            return Some(divergence_at(left_step.ordinal, "lifecycle_fingerprint"));
        }
        if left_step.extensions_fingerprint_after != right_step.extensions_fingerprint_after {
            return Some(divergence_at(left_step.ordinal, "extensions_fingerprint"));
        }
        if left_step.mirror != right_step.mirror {
            return Some(divergence_at(left_step.ordinal, "executor_mirror"));
        }
        if left_step.source_stack_after != right_step.source_stack_after {
            return Some(divergence_at(left_step.ordinal, "source_stack"));
        }
    }
    if left.final_extensions != right.final_extensions {
        return Some(ItemDivergence {
            step: None,
            detail: "final extension slices differ".to_owned(),
        });
    }
    if left.final_state != right.final_state {
        return Some(ItemDivergence {
            step: None,
            detail: "final lifecycle states differ".to_owned(),
        });
    }
    if left.audit_entries.len() != right.audit_entries.len() {
        return Some(ItemDivergence {
            step: None,
            detail: format!(
                "rng audit lengths differ: {} vs {}",
                left.audit_entries.len(),
                right.audit_entries.len()
            ),
        });
    }
    for (index, (left_draw, right_draw)) in left
        .audit_entries
        .iter()
        .zip(right.audit_entries.iter())
        .enumerate()
    {
        if left_draw != right_draw {
            return Some(ItemDivergence {
                step: None,
                detail: format!("rng audit entry {index} differs"),
            });
        }
    }
    None
}

fn divergence_at(step: u32, field: &str) -> ItemDivergence {
    ItemDivergence {
        step: Some(step),
        detail: format!("first divergence at step {step}: {field}"),
    }
}

/// Reports the first field-level difference between two query folds, or
/// `None` when identical.
pub fn first_query_divergence(
    left: &QueryTransitionV2,
    right: &QueryTransitionV2,
) -> Option<String> {
    if left.before != right.before {
        return Some(format!("query initial values differ: {:?}", left.before));
    }
    if left.after != right.after {
        return Some(format!(
            "query results diverge: {:?} vs {:?}",
            left.after, right.after
        ));
    }
    if left.allowed != right.allowed {
        return Some(format!("query allow decisions differ: {:?}", left.allowed));
    }
    if left.cancelled != right.cancelled {
        return Some("query cancellation flags differ".to_owned());
    }
    if left.evidence.len() != right.evidence.len() {
        return Some(format!(
            "query evidence lengths differ: {} vs {}",
            left.evidence.len(),
            right.evidence.len()
        ));
    }
    for (index, (left_entry, right_entry)) in
        left.evidence.iter().zip(right.evidence.iter()).enumerate()
    {
        if left_entry != right_entry {
            return Some(format!(
                "query evidence entry {index} diverges: program {:?} vs {:?}",
                left_entry.program, right_entry.program
            ));
        }
    }
    None
}

/// Reports the first field-level difference between two trigger folds, or
/// `None` when identical.
#[must_use]
pub fn first_hook_divergence(
    left: &MechanicsTransitionV2,
    right: &MechanicsTransitionV2,
) -> Option<String> {
    if left.operations.len() != right.operations.len() {
        return Some(format!(
            "trigger operation counts differ: {} vs {}",
            left.operations.len(),
            right.operations.len()
        ));
    }
    for (index, (left_entry, right_entry)) in left
        .operations
        .iter()
        .zip(right.operations.iter())
        .enumerate()
    {
        if left_entry != right_entry {
            return Some(format!(
                "trigger operation {index} diverges: program {:?} vs {:?}",
                left_entry.program, right_entry.program
            ));
        }
    }
    None
}

/// Runs an item-derived context through both routine execution paths
/// (production prepared indexes and the direct reference scan) for the given
/// queries and hooks, returning one first-divergence report per disagreeing
/// axis. An empty report means the paths are indistinguishable.
///
/// This is the transition/witness comparison for contexts whose active and
/// suppressed source stacks come straight out of the lifecycle campaigns.
pub fn compare_prepared_and_direct(
    programs: &[MechanicsProgramV2],
    prepared: &er_content::pack::m6_prepared::PreparedBattleContentV3,
    context: &MechanicsContextV2<'_>,
    queries: &[(MechanicQueryV2, QueryValueV2)],
    hooks: &[MechanicHookV2],
) -> Result<Vec<String>, ItemParityError> {
    let mut reports = Vec::new();
    for (query, initial) in queries {
        let direct = crate::m6::routine_executor::execute_query_v2_direct_reference(
            programs,
            context,
            *query,
            initial.clone(),
        )
        .map_err(|error| ItemParityError::Routine(error.to_string()))?;
        let indexed = crate::m6::routine_executor::execute_query_v2(
            prepared,
            context,
            *query,
            initial.clone(),
        )
        .map_err(|error| ItemParityError::Routine(error.to_string()))?;
        if let Some(detail) = first_query_divergence(&direct, &indexed) {
            reports.push(format!("{query:?}: {detail}"));
        }
    }
    for hook in hooks {
        let direct =
            crate::m6::routine_executor::execute_hook_v2_direct_reference(programs, context, *hook)
                .map_err(|error| ItemParityError::Routine(error.to_string()))?;
        let indexed = crate::m6::routine_executor::execute_hook_v2(prepared, context, *hook)
            .map_err(|error| ItemParityError::Routine(error.to_string()))?;
        if let Some(detail) = first_hook_divergence(&direct, &indexed) {
            reports.push(format!("{hook:?}: {detail}"));
        }
    }
    Ok(reports)
}
