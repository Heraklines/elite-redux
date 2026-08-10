//! The production local-battle lifecycle adapter.
//!
//! Local play is an authority transaction with an internal command source. It
//! does not have a second battle engine, a compatibility-resolution path, or a
//! semantic campaign surface. The kernel owns the outer clone-and-swap and
//! FIFO; this module only translates the private game event into the typed
//! runtime/material stages that the authority already uses.
//!
//! The [`LocalBattleRuntime`] port is deliberately crate-private. The
//! integration-owned `GameRuntime` implements it by delegating to the common
//! command admission and authority-resolution adapters, then to the canonical
//! material codec and the common material applier. Keeping that port private
//! prevents callers from supplying an alternate resolver or material format.

use er_battle::resolver::BattleNextDecision;
use er_content::pack::{ContentPack, ContentPackError};
use er_state::digest::{
    MechanicalDigestError, MechanicalStateDigest, compute_mechanical_state_digest,
};
use er_state::format::{
    FormatTopologyError, human_seats, owner_seat_for, validate_m3_supported,
};
use er_state::snapshot::GameState;
use er_state::validation::StateValidationError;
use er_types::battle_command::{
    BattleCommandError, BattleCommandProposalV1, BattleReplacementProposalV1,
    ReplacementSelection, ScriptedEnemyPolicyV1,
};
use er_types::battle_control::{BattleControlPlan, BattleControlPlanError};
use er_types::battle_ids::{
    BattleFormat, BattleSide, FaintOccurrenceId, FieldSlot, PartyIndex,
};
use er_types::battle_model::BattleOutcome;
use er_types::battle_ui::{BattlePresentationEvent, PresentationPlanDigest};
use er_types::{OperationId, SeatId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// The frozen M3 battle-start schema version.
pub const BATTLE_START_SCHEMA_VERSION: u32 = 1;

/// Configuration supplied to the production `GameRuntime` for one local or
/// authority-owned battle.
///
/// The configuration intentionally omits battle ID, turn, outcome, command
/// collection, faint allocator, and arena state. Those values are allocated
/// and initialized by the runtime's `new_battle` path.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleGameConfig {
    pub run_state: GameState,
    pub start: BattleStartV1,
    pub local_seat: SeatId,
    pub scripted_enemy_policy: ScriptedEnemyPolicyV1,
}

impl BattleGameConfig {
    /// Validate the caller-owned configuration before it reaches runtime
    /// construction. Content membership and capability closure remain owned
    /// by the production runtime/content validator; this method checks the
    /// boundary shape and ownership facts which do not require a live battle.
    pub fn validate(&self, content: &ContentPack) -> Result<(), LocalBattleConfigError> {
        self.run_state
            .validate()
            .map_err(LocalBattleConfigError::RunState)?;
        if self.run_state.battle.is_some() {
            return Err(LocalBattleConfigError::RunStateAlreadyHasBattle);
        }
        if self.run_state.content_hash != content.hash {
            return Err(LocalBattleConfigError::ContentHashMismatch {
                state: self.run_state.content_hash.clone(),
                content: content.hash.clone(),
            });
        }
        content
            .validate()
            .map_err(LocalBattleConfigError::Content)?;
        self.start.validate()?;
        let seats = human_seats(&self.start.format).map_err(LocalBattleConfigError::Format)?;
        if !seats.contains(&self.local_seat) {
            return Err(LocalBattleConfigError::LocalSeatNotInFormat {
                seat: self.local_seat,
            });
        }
        self.scripted_enemy_policy
            .validate()
            .map_err(LocalBattleConfigError::ScriptedEnemyPolicy)
    }
}

/// Initial party/topology data for `GameRuntime::new_battle`.
///
/// A caller supplies only immutable party data and lead selection. The
/// runtime allocates the battle identity, public turn one, neutral conditions,
/// empty command/faint state, battle RNG, and ongoing outcome.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleStartV1 {
    pub schema_version: u32,
    pub format: BattleFormat,
    pub player_party: Vec<er_state::pokemon::PokemonState>,
    pub enemy_party: Vec<er_state::pokemon::PokemonState>,
    pub player_leads: Vec<PartyIndex>,
    pub enemy_leads: Vec<PartyIndex>,
}

impl BattleStartV1 {
    /// Validate topology, party ownership, and lead selection without
    /// constructing a partial `BattleState`.
    pub fn validate(&self) -> Result<(), LocalBattleConfigError> {
        if self.schema_version != BATTLE_START_SCHEMA_VERSION {
            return Err(LocalBattleConfigError::StartSchemaVersion {
                expected: BATTLE_START_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        validate_m3_supported(&self.format).map_err(LocalBattleConfigError::Format)?;

        if self.player_party.len() > 6 {
            return Err(LocalBattleConfigError::PartyTooLarge {
                side: BattleSide::Player,
                actual: self.player_party.len(),
            });
        }
        if self.enemy_party.len() > 6 {
            return Err(LocalBattleConfigError::PartyTooLarge {
                side: BattleSide::Enemy,
                actual: self.enemy_party.len(),
            });
        }

        let human_seats = human_seats(&self.format).map_err(LocalBattleConfigError::Format)?;
        for (index, pokemon) in self.player_party.iter().enumerate() {
            let Some(owner) = pokemon.owner_seat else {
                return Err(LocalBattleConfigError::PlayerMissingOwner { index });
            };
            if !human_seats.contains(&owner) {
                return Err(LocalBattleConfigError::PlayerOwnerNotInFormat { index, owner });
            }
        }
        for (index, pokemon) in self.enemy_party.iter().enumerate() {
            if let Some(owner) = pokemon.owner_seat {
                return Err(LocalBattleConfigError::EnemyHasOwner { index, owner });
            }
        }

        validate_leads(
            BattleSide::Player,
            &self.format,
            &self.player_party,
            &self.player_leads,
        )?;
        validate_leads(
            BattleSide::Enemy,
            &self.format,
            &self.enemy_party,
            &self.enemy_leads,
        )?;
        Ok(())
    }
}

fn validate_leads(
    side: BattleSide,
    format: &BattleFormat,
    party: &[er_state::pokemon::PokemonState],
    leads: &[PartyIndex],
) -> Result<(), LocalBattleConfigError> {
    let expected_count = match side {
        BattleSide::Player => usize::from(format.player_capacity),
        BattleSide::Enemy => usize::from(format.enemy_capacity),
    };
    if leads.len() != expected_count {
        return Err(LocalBattleConfigError::LeadCount {
            side,
            expected: expected_count,
            actual: leads.len(),
        });
    }

    let mut seen = std::collections::BTreeSet::new();
    for (position, party_slot) in leads.iter().copied().enumerate() {
        if !seen.insert(party_slot) {
            return Err(LocalBattleConfigError::DuplicateLead { side, party_slot });
        }
        let Some(pokemon) = party.get(usize::from(party_slot.get())) else {
            return Err(LocalBattleConfigError::LeadOutsideParty { side, party_slot });
        };
        if pokemon.fainted || pokemon.hp == 0 {
            return Err(LocalBattleConfigError::FaintedLead { side, party_slot });
        }

        let slot = FieldSlot {
            side,
            position: u8::try_from(position).map_err(|_| LocalBattleConfigError::LeadPositionOverflow {
                side,
                position,
            })?,
        };
        let expected_owner = owner_seat_for(format, slot)
            .map_err(LocalBattleConfigError::Format)?;
        if pokemon.owner_seat != expected_owner {
            return Err(LocalBattleConfigError::LeadOwnerMismatch {
                side,
                party_slot,
                expected: expected_owner,
                actual: pokemon.owner_seat,
            });
        }
    }
    Ok(())
}

/// Configuration validation failures owned by the local lifecycle boundary.
#[derive(Debug, Error)]
pub enum LocalBattleConfigError {
    #[error("run state is invalid: {0}")]
    RunState(#[source] StateValidationError),
    #[error("run state already contains an active battle")]
    RunStateAlreadyHasBattle,
    #[error("run-state content hash {state} does not match content-pack hash {content}")]
    ContentHashMismatch {
        state: er_types::battle_ids::ContentPackHash,
        content: er_types::battle_ids::ContentPackHash,
    },
    #[error("content pack is invalid: {0}")]
    Content(#[source] ContentPackError),
    #[error("battle start schema version must be {expected}, got {actual}")]
    StartSchemaVersion { expected: u32, actual: u32 },
    #[error("battle topology is invalid: {0}")]
    Format(#[source] FormatTopologyError),
    #[error("local seat {seat:?} is not a seat in the selected format")]
    LocalSeatNotInFormat { seat: SeatId },
    #[error("scripted enemy policy is invalid: {0}")]
    ScriptedEnemyPolicy(#[source] BattleCommandError),
    #[error("{side:?} party contains {actual} members; the maximum is six")]
    PartyTooLarge { side: BattleSide, actual: usize },
    #[error("player party member at index {index} has no owner seat")]
    PlayerMissingOwner { index: usize },
    #[error("player party member at index {index} has owner {owner:?} outside the selected format")]
    PlayerOwnerNotInFormat { index: usize, owner: SeatId },
    #[error("enemy party member at index {index} must not have owner seat {owner:?}")]
    EnemyHasOwner { index: usize, owner: SeatId },
    #[error("{side:?} lead count must be {expected}, got {actual}")]
    LeadCount {
        side: BattleSide,
        expected: usize,
        actual: usize,
    },
    #[error("{side:?} lead {party_slot:?} is selected more than once")]
    DuplicateLead { side: BattleSide, party_slot: PartyIndex },
    #[error("{side:?} lead {party_slot:?} is outside its party")]
    LeadOutsideParty { side: BattleSide, party_slot: PartyIndex },
    #[error("{side:?} lead {party_slot:?} is fainted")]
    FaintedLead { side: BattleSide, party_slot: PartyIndex },
    #[error("{side:?} lead position {position} cannot be represented")]
    LeadPositionOverflow { side: BattleSide, position: usize },
    #[error("{side:?} lead {party_slot:?} owner mismatch: expected {expected:?}, got {actual:?}")]
    LeadOwnerMismatch {
        side: BattleSide,
        party_slot: PartyIndex,
        expected: Option<SeatId>,
        actual: Option<SeatId>,
    },
}

/// The private phase visible to the local game reducer.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum LocalBattleFrontier {
    /// At least one human or scripted-enemy command is still missing.
    Command,
    /// The stored faint occurrence is the only valid replacement frontier.
    Replacement { occurrence: FaintOccurrenceId },
    /// No further battle command/replacement may be admitted.
    Complete(BattleOutcome),
}

/// Internal requests emitted by the private `Ui`/`Game` reducer.
///
/// `NoLegalReplacement` is intentionally absent from this enum. It is
/// created only by the runtime port after it has inspected the stored faint
/// occurrence and exact same-owner candidates.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum LocalBattleRequest {
    Command(BattleCommandProposalV1),
    Replacement(BattleReplacementProposalV1),
    InternalNoLegalReplacement { occurrence: FaintOccurrenceId },
}

/// Outcome of a local proposal admission.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum LocalAdmission {
    Admitted,
    FrontierIncomplete,
    /// A same-identity/same-fingerprint proposal already has a committed
    /// result. Returning it is idempotent and avoids a second resolver call.
    AlreadyCommitted(LocalBattleMaterialResult),
}

/// The material kind used by the common typed codec/applier path.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum LocalMaterialKind {
    Turn,
    Replacement,
}

/// Evidence returned by a runtime port after it has completed one staged
/// resolver -> typed canonical encode/decode -> common applier operation.
///
/// The candidate and applied halves are intentionally retained until this
/// adapter checks equality. The runtime may keep the value only in the
/// staged transaction; no field here is a mutable game handle.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct LocalBattleMaterialResult {
    pub kind: LocalMaterialKind,
    pub operation_id: OperationId,
    pub before_state: GameState,
    pub before_digest: MechanicalStateDigest,
    pub candidate_after_state: GameState,
    pub candidate_after_digest: MechanicalStateDigest,
    pub applied_after_state: GameState,
    pub applied_after_digest: MechanicalStateDigest,
    pub candidate_outcome: BattleOutcome,
    pub applied_outcome: BattleOutcome,
    pub candidate_next_decision: BattleNextDecision,
    pub applied_next_decision: BattleNextDecision,
    pub candidate_control: BattleControlPlan,
    pub applied_control: BattleControlPlan,
    pub candidate_presentation: Vec<BattlePresentationEvent>,
    pub applied_presentation: Vec<BattlePresentationEvent>,
    pub candidate_presentation_digest: PresentationPlanDigest,
    pub applied_presentation_digest: PresentationPlanDigest,
}

impl LocalBattleMaterialResult {
    /// Prove the required resolver-candidate == material-applied equality
    /// before the enclosing kernel transaction can publish any effect.
    pub(crate) fn validate(&self) -> Result<(), LocalMaterialValidationError> {
        self.before_state
            .validate()
            .map_err(LocalMaterialValidationError::BeforeState)?;
        self.candidate_after_state
            .validate()
            .map_err(LocalMaterialValidationError::CandidateAfterState)?;
        self.applied_after_state
            .validate()
            .map_err(LocalMaterialValidationError::AppliedAfterState)?;

        let before_digest = compute_mechanical_state_digest(&self.before_state)
            .map_err(LocalMaterialValidationError::BeforeDigest)?;
        if before_digest != self.before_digest {
            return Err(LocalMaterialValidationError::BeforeDigestMismatch);
        }

        if self.candidate_after_state != self.applied_after_state {
            return Err(LocalMaterialValidationError::CandidateAppliedStateMismatch);
        }
        if self.candidate_after_digest != self.applied_after_digest {
            return Err(LocalMaterialValidationError::CandidateAppliedDigestMismatch);
        }
        let after_digest = compute_mechanical_state_digest(&self.candidate_after_state)
            .map_err(LocalMaterialValidationError::CandidateAfterDigest)?;
        if after_digest != self.candidate_after_digest {
            return Err(LocalMaterialValidationError::AfterDigestMismatch);
        }

        if self.candidate_outcome != self.applied_outcome {
            return Err(LocalMaterialValidationError::OutcomeMismatch);
        }
        if self.candidate_next_decision != self.applied_next_decision {
            return Err(LocalMaterialValidationError::NextDecisionMismatch);
        }
        if self.candidate_control != self.applied_control {
            return Err(LocalMaterialValidationError::ControlProjectionMismatch);
        }
        self.candidate_control
            .validate()
            .map_err(LocalMaterialValidationError::ControlInvalid)?;
        if self.candidate_presentation != self.applied_presentation {
            return Err(LocalMaterialValidationError::PresentationMismatch);
        }
        if self.candidate_presentation_digest != self.applied_presentation_digest {
            return Err(LocalMaterialValidationError::PresentationDigestMismatch);
        }
        Ok(())
    }
}

/// Failures in the equality and state proof performed at the material
/// boundary. These are fatal to the staged transaction; no fallback is valid.
#[derive(Debug, Error)]
pub(crate) enum LocalMaterialValidationError {
    #[error("material before state is invalid: {0}")]
    BeforeState(#[source] StateValidationError),
    #[error("resolver candidate after state is invalid: {0}")]
    CandidateAfterState(#[source] StateValidationError),
    #[error("material-applied after state is invalid: {0}")]
    AppliedAfterState(#[source] StateValidationError),
    #[error("material before digest cannot be computed: {0}")]
    BeforeDigest(#[source] MechanicalDigestError),
    #[error("resolver candidate after digest cannot be computed: {0}")]
    CandidateAfterDigest(#[source] MechanicalDigestError),
    #[error("material before digest does not describe before_state")]
    BeforeDigestMismatch,
    #[error("resolver candidate after_state differs from material-applied after_state")]
    CandidateAppliedStateMismatch,
    #[error("resolver candidate after_digest differs from material-applied after_digest")]
    CandidateAppliedDigestMismatch,
    #[error("material after digest does not describe the common after_state")]
    AfterDigestMismatch,
    #[error("resolver and material-applied outcomes differ")]
    OutcomeMismatch,
    #[error("resolver and material-applied next decisions differ")]
    NextDecisionMismatch,
    #[error("resolver and material-applied control projections differ")]
    ControlProjectionMismatch,
    #[error("material-applied control projection is invalid: {0}")]
    ControlInvalid(#[source] BattleControlPlanError),
    #[error("resolver and material-applied presentation plans differ")]
    PresentationMismatch,
    #[error("resolver and material-applied presentation digests differ")]
    PresentationDigestMismatch,
}

/// Progress returned to the private game reducer after one local request.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum LocalBattleProgress {
    Waiting { frontier: LocalBattleFrontier },
    MaterialInstalled(LocalBattleMaterialResult),
}

/// A crate-private runtime seam for local battle work.
///
/// The integration-owned implementation must make the following guarantees:
///
/// * command admission uses the same ledger, fingerprints, offers, and
///   authority-relative sources as co-op authority admission;
/// * `command_frontier_complete` is true only after every living active
///   human and scripted-enemy actor has an admitted command;
/// * `prepare_*_material_commit` calls the production resolver with the exact
///   operation identity, constructs the typed TURN/REPLACEMENT material,
///   performs its canonical encode/decode round trip, applies the decoded
///   value through the one common material applier, and installs the exact
///   control/barrier on the enclosing staged runtime;
/// * failures leave the staged runtime unpublished so `GameKernel::step` can
///   discard it atomically.
pub(crate) trait LocalBattleRuntime {
    type Error: std::error::Error + 'static;

    fn local_frontier(&self) -> LocalBattleFrontier;

    fn command_frontier_complete(&self) -> bool;

    fn admit_local_command(
        &mut self,
        proposal: &BattleCommandProposalV1,
    ) -> Result<LocalAdmission, Self::Error>;

    fn admit_local_replacement(
        &mut self,
        proposal: &BattleReplacementProposalV1,
    ) -> Result<LocalAdmission, Self::Error>;

    /// Build `NoLegalReplacement` only from the stored occurrence and the
    /// runtime's validated party/frontier state.
    fn internal_no_legal_replacement(
        &mut self,
        occurrence: FaintOccurrenceId,
    ) -> Result<ReplacementSelection, Self::Error>;

    fn prepare_turn_material_commit(
        &mut self,
    ) -> Result<LocalBattleMaterialResult, Self::Error>;

    fn prepare_replacement_material_commit(
        &mut self,
        occurrence: FaintOccurrenceId,
        selection: ReplacementSelection,
    ) -> Result<LocalBattleMaterialResult, Self::Error>;
}

/// Failures raised while reducing one private local-battle request.
#[derive(Debug, Error)]
pub(crate) enum LocalBattleError<E>
where
    E: std::error::Error + 'static,
{
    #[error("local runtime rejected the request: {0}")]
    Runtime(#[source] E),
    #[error("a command request arrived outside the command frontier: {actual:?}")]
    CommandOutsideFrontier { actual: LocalBattleFrontier },
    #[error("a replacement request arrived outside its stored occurrence frontier: expected {expected:?}, actual {actual:?}")]
    ReplacementOutsideFrontier {
        expected: FaintOccurrenceId,
        actual: LocalBattleFrontier,
    },
    #[error("a replacement request names occurrence {requested:?}, but the stored frontier is {frontier:?}")]
    InternalReplacementOutsideFrontier {
        requested: FaintOccurrenceId,
        frontier: LocalBattleFrontier,
    },
    #[error("a human replacement request attempted to submit NO_LEGAL_REPLACEMENT")]
    ExternalNoLegalReplacement,
    #[error("runtime reported an incomplete command frontier after reporting it complete")]
    FrontierAdmissionContradiction,
    #[error("runtime returned an internal replacement selection other than NO_LEGAL_REPLACEMENT")]
    InternalReplacementSelectionContradiction,
    #[error("the local material proof failed: {0}")]
    Material(#[source] LocalMaterialValidationError),
}

/// Reduce one private local request on the already-staged `GameRuntime`.
///
/// This function is intentionally not a public campaign operation. The
/// kernel's FIFO invokes it only after raw input/UI reduction has produced the
/// typed proposal or the deterministic internal no-legal intent.
pub(crate) fn reduce_local_request<R: LocalBattleRuntime>(
    runtime: &mut R,
    request: LocalBattleRequest,
) -> Result<LocalBattleProgress, LocalBattleError<R::Error>> {
    match request {
        LocalBattleRequest::Command(proposal) => {
            if !matches!(runtime.local_frontier(), LocalBattleFrontier::Command) {
                return Err(LocalBattleError::CommandOutsideFrontier {
                    actual: runtime.local_frontier(),
                });
            }
            let admission = runtime
                .admit_local_command(&proposal)
                .map_err(LocalBattleError::Runtime)?;
            match admission {
                LocalAdmission::AlreadyCommitted(material) => {
                    return material
                        .validate()
                        .map(LocalBattleProgress::MaterialInstalled)
                        .map_err(LocalBattleError::Material);
                }
                LocalAdmission::FrontierIncomplete => {
                    if runtime.command_frontier_complete() {
                        return Err(LocalBattleError::FrontierAdmissionContradiction);
                    }
                    return Ok(LocalBattleProgress::Waiting {
                        frontier: runtime.local_frontier(),
                    });
                }
                LocalAdmission::Admitted => {}
            }
            if !runtime.command_frontier_complete() {
                return Ok(LocalBattleProgress::Waiting {
                    frontier: runtime.local_frontier(),
                });
            }
            let material = runtime
                .prepare_turn_material_commit()
                .map_err(LocalBattleError::Runtime)?;
            material
                .validate()
                .map(LocalBattleProgress::MaterialInstalled)
                .map_err(LocalBattleError::Material)
        }
        LocalBattleRequest::Replacement(proposal) => {
            if proposal.selection == ReplacementSelection::NoLegalReplacement {
                return Err(LocalBattleError::ExternalNoLegalReplacement);
            }
            let expected = proposal.occurrence;
            if !matches!(
                runtime.local_frontier(),
                LocalBattleFrontier::Replacement { occurrence } if occurrence == expected
            ) {
                return Err(LocalBattleError::ReplacementOutsideFrontier {
                    expected,
                    actual: runtime.local_frontier(),
                });
            }
            let admission = runtime
                .admit_local_replacement(&proposal)
                .map_err(LocalBattleError::Runtime)?;
            match admission {
                LocalAdmission::AlreadyCommitted(material) => {
                    return material
                        .validate()
                        .map(LocalBattleProgress::MaterialInstalled)
                        .map_err(LocalBattleError::Material);
                }
                LocalAdmission::FrontierIncomplete => {
                    return Err(LocalBattleError::FrontierAdmissionContradiction);
                }
                LocalAdmission::Admitted => {}
            }
            let material = runtime
                .prepare_replacement_material_commit(expected, proposal.selection)
                .map_err(LocalBattleError::Runtime)?;
            material
                .validate()
                .map(LocalBattleProgress::MaterialInstalled)
                .map_err(LocalBattleError::Material)
        }
        LocalBattleRequest::InternalNoLegalReplacement { occurrence } => {
            if !matches!(
                runtime.local_frontier(),
                LocalBattleFrontier::Replacement { occurrence: current } if current == occurrence
            ) {
                return Err(LocalBattleError::InternalReplacementOutsideFrontier {
                    requested: occurrence,
                    frontier: runtime.local_frontier(),
                });
            }
            let selection = runtime
                .internal_no_legal_replacement(occurrence)
                .map_err(LocalBattleError::Runtime)?;
            if selection != ReplacementSelection::NoLegalReplacement {
                return Err(LocalBattleError::InternalReplacementSelectionContradiction);
            }
            let material = runtime
                .prepare_replacement_material_commit(occurrence, selection)
                .map_err(LocalBattleError::Runtime)?;
            material
                .validate()
                .map(LocalBattleProgress::MaterialInstalled)
                .map_err(LocalBattleError::Material)
        }
    }
}
