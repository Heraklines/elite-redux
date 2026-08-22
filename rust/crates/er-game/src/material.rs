//! Typed TURN/REPLACEMENT material codecs and the single material applier.
//!
//! Material is authoritative evidence.  It is never a second mechanics
//! resolver: both endpoint roles decode the same bytes and enter these pure
//! appliers with the same immutable content pack.

use std::collections::{BTreeMap, BTreeSet};

use er_battle::command::NormalizedBattleCommand;
use er_battle::legality::{
    build_command_offer_trusted, build_scripted_enemy_offer_trusted, normalize_command_set_trusted,
    validate_replacement_selection_trusted, validate_state_content_trusted,
};
use er_battle::replacement::legal_replacement_candidates;
use er_battle::stat_stage::MIN_STAT_STAGE;
use er_battle::{
    BattleMutation, BattleNextDecision, compute_presentation_plan_digest,
    validate_battle_mutation_evidence,
};
use er_canonical::{CanonicalError, canonical_bytes};
use er_content::moves::find_move;
pub use er_content::pack::ContentPack;
use er_content::pack::{M4_ORACLE_GAME_SHA, ORACLE_GAME_SHA};
use er_rng::audit::{RngDraw, RngPublicApi, RngReason, RngStream};
use er_rng::battle::RngRuntime;
use er_state::battle::{BattleOutcome, BattleRngState, BattleState};
use er_state::digest::MechanicalStateDigest;
use er_state::format::{canonical_slots, human_seats, owner_seat_for, validate_slot};
use er_state::snapshot::GameState;
use er_types::battle_command::{
    AcceptedBattleCommand, CommandAdmissionSource, CommandCollectionState, CommandFrontierEntry,
    CommandFrontierStatus, CommandSet, ReplacementSelection, player_command_operation_id,
    replacement_operation_id, scripted_enemy_command_operation_id, turn_result_operation_id,
};
use er_types::battle_control::{
    BattleControl, BattleControlPlan, BattleControlPlanError, CommandRootControl,
    MoveSelectControl, PartyOptionSelectControl, PartySelectControl, ReplacementSelectControl,
    SeatMenuInstanceAllocator, TargetSelectControl, WaitingControl,
};
use er_types::battle_ids::ContentPackHash;
use er_types::battle_ids::{
    BattleId, BattleSide, FieldSlot, MenuInstanceId, MoveId, PokemonId, TurnIndex, WaveIndex,
};
use er_types::battle_model::{BattleStat, FaintOccurrence, ReplacementProgress, ResolvedAction};
use er_types::battle_ui::{
    BattlePresentationEvent, BattlePresentationKind, PresentationBlockingPolicy,
    PresentationPlanDigest, PresentationSkipPolicy,
};
use er_types::ids::SafeU53;
use er_types::{OperationId, SeatId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::authority_commands::PreparedAuthorityTurn;
use crate::internal_event::AuthorityLocalTurnProof;
use crate::runtime::project_battle_control_plan;

/// The schema version of both typed M3 material DTOs.
pub const BATTLE_MATERIAL_SCHEMA_VERSION: u32 = 1;
/// Compatibility aliases used by callers that name each material separately.
pub const BATTLE_TURN_MATERIAL_SCHEMA_VERSION: u32 = BATTLE_MATERIAL_SCHEMA_VERSION;
pub const BATTLE_REPLACEMENT_MATERIAL_SCHEMA_VERSION: u32 = BATTLE_MATERIAL_SCHEMA_VERSION;

/// The complete typed evidence committed for one resolved turn.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleTurnMaterialV1 {
    pub schema_version: u32,
    pub oracle_game_sha: String,
    pub content_hash: ContentPackHash,
    pub operation_id: OperationId,
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub resolved_turn: TurnIndex,
    pub before_digest: MechanicalStateDigest,
    pub after_digest: MechanicalStateDigest,
    pub commands: CommandSet,
    pub action_order: Vec<ResolvedAction>,
    pub mutations: Vec<BattleMutation>,
    pub presentation: Vec<BattlePresentationEvent>,
    pub presentation_digest: PresentationPlanDigest,
    pub rng_before: BattleRngState,
    pub rng_after: BattleRngState,
    pub rng_audit: Vec<RngDraw>,
    pub before_state: GameState,
    pub after_state: GameState,
    pub outcome: BattleOutcome,
    pub next_decision: BattleNextDecision,
    pub menu_allocators_before: Vec<SeatMenuInstanceAllocator>,
    pub next_control: BattleControlPlan,
}

/// The complete typed evidence committed for one replacement decision.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleReplacementMaterialV1 {
    pub schema_version: u32,
    pub oracle_game_sha: String,
    pub content_hash: ContentPackHash,
    pub operation_id: OperationId,
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub resolved_turn: TurnIndex,
    pub occurrence: FaintOccurrence,
    pub selection: ReplacementSelection,
    pub before_digest: MechanicalStateDigest,
    pub after_digest: MechanicalStateDigest,
    pub mutations: Vec<BattleMutation>,
    pub presentation: Vec<BattlePresentationEvent>,
    pub presentation_digest: PresentationPlanDigest,
    pub before_state: GameState,
    pub after_state: GameState,
    pub outcome: BattleOutcome,
    pub next_decision: BattleNextDecision,
    pub menu_allocators_before: Vec<SeatMenuInstanceAllocator>,
    pub next_control: BattleControlPlan,
}

/// Errors raised while encoding or decoding a canonical material payload.
#[derive(Debug, Error)]
pub enum BattleMaterialCodecError {
    #[error("material canonicalization failed: {0}")]
    Canonical(#[from] CanonicalError),
    #[error("material JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("material JSON is not the exact canonical encoding")]
    NonCanonicalEncoding,
}

/// Backwards-friendly short name for the frozen material codec boundary.
pub type MaterialCodecError = BattleMaterialCodecError;

/// Encode a TURN material as exact sorted-key canonical JSON bytes.
pub fn encode_turn_material(
    material: &BattleTurnMaterialV1,
) -> Result<Vec<u8>, BattleMaterialCodecError> {
    Ok(canonical_bytes(material)?)
}

/// Decode only exact sorted-key canonical JSON TURN material bytes.
pub fn decode_turn_material(
    bytes: &[u8],
) -> Result<BattleTurnMaterialV1, BattleMaterialCodecError> {
    decode_canonical(bytes)
}

/// Encode a REPLACEMENT material as exact sorted-key canonical JSON bytes.
pub fn encode_replacement_material(
    material: &BattleReplacementMaterialV1,
) -> Result<Vec<u8>, BattleMaterialCodecError> {
    Ok(canonical_bytes(material)?)
}

/// Decode only exact sorted-key canonical JSON REPLACEMENT material bytes.
pub fn decode_replacement_material(
    bytes: &[u8],
) -> Result<BattleReplacementMaterialV1, BattleMaterialCodecError> {
    decode_canonical(bytes)
}

/// Canonical TURN material digest used by the Authority adapter.
pub fn turn_material_digest(
    material: &BattleTurnMaterialV1,
) -> Result<String, BattleMaterialCodecError> {
    turn_material_digest_from_canonical_bytes(&canonical_bytes(material)?)
}

/// Canonical REPLACEMENT material digest used by the Authority adapter.
pub fn replacement_material_digest(
    material: &BattleReplacementMaterialV1,
) -> Result<String, BattleMaterialCodecError> {
    replacement_material_digest_from_canonical_bytes(&canonical_bytes(material)?)
}

fn turn_material_digest_from_canonical_bytes(
    bytes: &[u8],
) -> Result<String, BattleMaterialCodecError> {
    let canonical =
        std::str::from_utf8(bytes).map_err(|_| BattleMaterialCodecError::NonCanonicalEncoding)?;
    Ok(format!("{:016x}", fnv1a64_utf16(canonical)))
}

fn replacement_material_digest_from_canonical_bytes(
    bytes: &[u8],
) -> Result<String, BattleMaterialCodecError> {
    let canonical =
        std::str::from_utf8(bytes).map_err(|_| BattleMaterialCodecError::NonCanonicalEncoding)?;
    Ok(format!(
        "rc1-{}-{:08x}",
        canonical.encode_utf16().count(),
        fnv1a32_utf16(canonical)
    ))
}

impl BattleTurnMaterialV1 {
    pub fn canonical_bytes(&self) -> Result<Vec<u8>, BattleMaterialCodecError> {
        encode_turn_material(self)
    }

    pub fn canonical_digest(&self) -> Result<String, BattleMaterialCodecError> {
        turn_material_digest(self)
    }
}

impl BattleReplacementMaterialV1 {
    pub fn canonical_bytes(&self) -> Result<Vec<u8>, BattleMaterialCodecError> {
        encode_replacement_material(self)
    }

    pub fn canonical_digest(&self) -> Result<String, BattleMaterialCodecError> {
        replacement_material_digest(self)
    }
}

fn decode_canonical<T>(bytes: &[u8]) -> Result<T, BattleMaterialCodecError>
where
    T: for<'de> Deserialize<'de> + Serialize,
{
    let decoded = serde_json::from_slice::<T>(bytes)?;
    if canonical_bytes(&decoded)? != bytes {
        return Err(BattleMaterialCodecError::NonCanonicalEncoding);
    }
    Ok(decoded)
}

fn fnv1a64_utf16(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for code_unit in value.encode_utf16() {
        hash ^= u64::from(code_unit);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn fnv1a32_utf16(value: &str) -> u32 {
    let mut hash = 0x811c9dc5_u32;
    for code_unit in value.encode_utf16() {
        hash ^= u32::from(code_unit);
        hash = hash.wrapping_mul(0x01000193);
    }
    hash
}

/// Endpoint-local state and allocator context supplied to one pure applier.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BattleMaterialApplyContext {
    pub current_state: GameState,
    pub local_seat: SeatId,
    pub menu_allocators: Vec<SeatMenuInstanceAllocator>,
}

#[derive(Clone, Copy)]
enum ContentValidationMode {
    Full,
    Trusted,
}

#[derive(Clone, Copy)]
enum DigestValidationMode {
    Independent,
}

/// The closed common material-application failure categories.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Error)]
pub enum BattleMaterialApplyError {
    #[error("material identity is malformed or does not match its operation grammar")]
    MalformedIdentity,
    #[error("material schema version is not supported")]
    SchemaVersionMismatch,
    #[error("material oracle identity does not match the pinned game")]
    OracleIdentityMismatch,
    #[error("material content hash does not match the immutable content pack")]
    ContentHashMismatch,
    #[error("material before_state does not match its stated before_digest")]
    InvalidMaterialBeforeDigest,
    #[error("endpoint-local state or allocator frontier does not match the material boundary")]
    LocalBeforeStateMismatch,
    #[error("material mutation, command, RNG, or presentation evidence is invalid")]
    InvalidEvidence,
    #[error("material after_state or after_digest is invalid")]
    InvalidAfterState,
    #[error("material next decision/control projection is invalid")]
    InvalidControlProjection,
    #[error("material menu allocator evidence is internally inconsistent")]
    MenuAllocatorMismatch,
    #[error("material or endpoint violates a canonical invariant")]
    Invariant,
}

/// Fully validated material output ready for atomic game/control installation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MaterialApplyResult {
    pub after_state: GameState,
    pub after_digest: MechanicalStateDigest,
    pub presentation: Vec<BattlePresentationEvent>,
    pub presentation_digest: PresentationPlanDigest,
    pub outcome: BattleOutcome,
    pub next_decision: BattleNextDecision,
    pub next_control: BattleControlPlan,
    pub menu_allocators: Vec<SeatMenuInstanceAllocator>,
}

/// Apply one TURN material through the common role-neutral production path.
pub fn apply_turn_material(
    current: &BattleMaterialApplyContext,
    material: &BattleTurnMaterialV1,
    content: &ContentPack,
) -> Result<MaterialApplyResult, BattleMaterialApplyError> {
    apply_turn_material_inner(
        &current.current_state,
        current.local_seat,
        &current.menu_allocators,
        material,
        content,
        ContentValidationMode::Full,
        DigestValidationMode::Independent,
    )
}

/// Apply TURN material inside a kernel whose immutable content pack was
/// validated at construction or restore.
#[doc(hidden)]
pub fn apply_turn_material_trusted(
    current: &BattleMaterialApplyContext,
    material: &BattleTurnMaterialV1,
    content: &ContentPack,
) -> Result<MaterialApplyResult, BattleMaterialApplyError> {
    apply_turn_material_inner(
        &current.current_state,
        current.local_seat,
        &current.menu_allocators,
        material,
        content,
        ContentValidationMode::Trusted,
        DigestValidationMode::Independent,
    )
}

/// Apply reducer-issued TURN material inside the authority kernel transaction.
/// Canonical decoded material is first bound field-for-field to the finalized
/// resolver/control/allocator evidence.  Only that opaque authority-local
/// proof may reuse the resolver's already-validated result; public, replica,
/// recovery, and ordinary trusted paths remain on the strict applier below.
#[doc(hidden)]
pub fn apply_reducer_issued_turn_material_trusted(
    current_state: &GameState,
    local_seat: SeatId,
    menu_allocators: &[SeatMenuInstanceAllocator],
    material: &BattleTurnMaterialV1,
    content: &ContentPack,
    prepared: &PreparedAuthorityTurn,
) -> Result<MaterialApplyResult, BattleMaterialApplyError> {
    let proof = bind_reducer_issued_turn_material(
        current_state,
        local_seat,
        menu_allocators,
        material,
        content,
        prepared,
    )?;
    apply_bound_reducer_turn_material(material, proof)
}

/// Compare canonical decoded TURN material with every field proved by the
/// finalized authority-local resolver, then retain only the endpoint checks
/// that cannot be supplied by that resolver proof.  The returned capability
/// is borrowed from the prepared game evidence and has no wire or DTO shape.
fn bind_reducer_issued_turn_material<'a>(
    current_state: &GameState,
    local_seat: SeatId,
    menu_allocators: &'a [SeatMenuInstanceAllocator],
    material: &'a BattleTurnMaterialV1,
    content: &ContentPack,
    prepared: &'a PreparedAuthorityTurn,
) -> Result<AuthorityLocalTurnProof<'a>, BattleMaterialApplyError> {
    validate_material_header(
        material.schema_version,
        &material.oracle_game_sha,
        &material.content_hash,
        &material.before_state,
        &material.after_state,
        content,
        ContentValidationMode::Trusted,
    )?;
    validate_turn_identity(material)?;

    let transition = prepared.transition();
    let before_battle = transition
        .before_state
        .battle
        .as_ref()
        .ok_or(BattleMaterialApplyError::InvalidEvidence)?;
    let after_battle = transition
        .after_state
        .battle
        .as_ref()
        .ok_or(BattleMaterialApplyError::InvalidEvidence)?;
    let expected_operation = turn_result_operation_id(
        before_battle.battle_id,
        before_battle.wave,
        before_battle.turn,
    )
    .map_err(|_| BattleMaterialApplyError::MalformedIdentity)?;
    let expected_presentation_digest = compute_presentation_plan_digest(&transition.presentation)
        .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;

    // The resolver's finalized transition is the proof source.  Keep these
    // comparisons explicit so no material field can become a trusted output
    // merely because it survived canonical JSON decoding.
    if material.operation_id != expected_operation
        || material.battle_id != before_battle.battle_id
        || material.wave != before_battle.wave
        || material.resolved_turn != before_battle.turn
        || material.before_state != transition.before_state
        || material.before_digest != transition.before_digest
        || material.after_state != transition.after_state
        || material.after_digest != transition.after_digest
        || material.commands != transition.accepted_commands
        || material.action_order != transition.action_order
        || material.mutations != transition.mutations
        || material.presentation != transition.presentation
        || material.presentation_digest != expected_presentation_digest
        || material.rng_before != before_battle.battle_rng
        || material.rng_after != after_battle.battle_rng
        || material.rng_audit != transition.rng_audit
        || material.outcome != transition.outcome
        || material.next_decision != transition.next_decision
    {
        return Err(BattleMaterialApplyError::InvalidEvidence);
    }

    let prepared_allocators = prepared.admission().allocator_before();
    if material.menu_allocators_before.as_slice() != prepared_allocators
        || material.menu_allocators_before.as_slice() != menu_allocators
        || &material.next_control != prepared.control_plan()
    {
        return Err(BattleMaterialApplyError::InvalidEvidence);
    }

    // The authority adapter prepared this transition from the exact complete
    // runtime state, and the field-for-field checks above bound decoded
    // before_state to that transition.  Exact equality is therefore stricter
    // and substantially cheaper than replica frontier reconciliation.
    if current_state != &transition.before_state {
        return Err(BattleMaterialApplyError::LocalBeforeStateMismatch);
    }
    validate_endpoint_allocators(
        menu_allocators,
        local_seat,
        &material.menu_allocators_before,
        &material.after_state,
    )?;

    let proof = prepared.bind_authority_local_turn(menu_allocators, &material.operation_id);
    if proof.material_operation_id() != &expected_operation
        || proof.menu_allocators_before() != menu_allocators
    {
        return Err(BattleMaterialApplyError::InvalidEvidence);
    }
    Ok(proof)
}

/// Materialize the canonical decoded material without replaying its
/// mechanics, command legality, RNG, mutation, or presentation validators.
/// The resolver proof authorizes the allocator/control derivation and the
/// candidate-equality assertion, but never replaces the decoded install data.
fn apply_bound_reducer_turn_material(
    material: &BattleTurnMaterialV1,
    proof: AuthorityLocalTurnProof<'_>,
) -> Result<MaterialApplyResult, BattleMaterialApplyError> {
    let transition = proof.transition();
    if transition.after_state != material.after_state
        || transition.after_digest != material.after_digest
        || transition.presentation != material.presentation
        || transition.outcome != material.outcome
        || transition.next_decision != material.next_decision
        || proof.control_plan() != &material.next_control
        || proof.control_plan().menu_allocators.as_slice()
            != material.next_control.menu_allocators.as_slice()
    {
        return Err(BattleMaterialApplyError::InvalidEvidence);
    }
    Ok(MaterialApplyResult {
        after_state: material.after_state.clone(),
        after_digest: material.after_digest.clone(),
        presentation: material.presentation.clone(),
        presentation_digest: material.presentation_digest.clone(),
        outcome: material.outcome,
        next_decision: material.next_decision,
        next_control: material.next_control.clone(),
        menu_allocators: material.next_control.menu_allocators.clone(),
    })
}

fn apply_turn_material_inner(
    current_state: &GameState,
    local_seat: SeatId,
    current_menu_allocators: &[SeatMenuInstanceAllocator],
    material: &BattleTurnMaterialV1,
    content: &ContentPack,
    validation: ContentValidationMode,
    digest_validation: DigestValidationMode,
) -> Result<MaterialApplyResult, BattleMaterialApplyError> {
    if matches!(digest_validation, DigestValidationMode::Independent) {
        verify_material_before_digest(&material.before_state, &material.before_digest)?;
    }
    validate_material_header(
        material.schema_version,
        &material.oracle_game_sha,
        &material.content_hash,
        &material.before_state,
        &material.after_state,
        content,
        validation,
    )?;
    validate_state_content_trusted(&material.before_state, content)
        .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
    validate_turn_identity(material)?;
    validate_turn_commands(&material.before_state, &material.commands, content)?;
    validate_after_state_and_digest(
        &material.after_state,
        &material.after_digest,
        content,
        digest_validation,
    )?;
    validate_turn_rng(material)?;
    validate_outcome_and_decision(
        &material.after_state,
        material.outcome,
        material.next_decision,
    )?;
    validate_next_state_command_collection(&material.after_state, material.next_decision, content)?;
    validate_turn_evidence(material, content)?;
    let menu_allocators = validate_allocator_projection(
        &material.after_state,
        &material.menu_allocators_before,
        &material.next_control,
        material_command_menu_ids(&material.commands),
    )?;
    validate_control_projection(
        &material.after_state,
        material.next_decision,
        &material.menu_allocators_before,
        &material.next_control,
        content,
    )?;
    reconcile_turn_frontier(current_state, material, content)?;
    validate_endpoint_allocators(
        current_menu_allocators,
        local_seat,
        &material.menu_allocators_before,
        &material.after_state,
    )?;

    Ok(MaterialApplyResult {
        after_state: material.after_state.clone(),
        after_digest: material.after_digest.clone(),
        presentation: material.presentation.clone(),
        presentation_digest: material.presentation_digest.clone(),
        outcome: material.outcome,
        next_decision: material.next_decision,
        next_control: material.next_control.clone(),
        menu_allocators,
    })
}

/// Apply one REPLACEMENT material through the common role-neutral path.
pub fn apply_replacement_material(
    current: &BattleMaterialApplyContext,
    material: &BattleReplacementMaterialV1,
    content: &ContentPack,
) -> Result<MaterialApplyResult, BattleMaterialApplyError> {
    apply_replacement_material_inner(current, material, content, ContentValidationMode::Full)
}

/// Apply REPLACEMENT material inside a kernel whose immutable content pack
/// was validated at construction or restore.
#[doc(hidden)]
pub fn apply_replacement_material_trusted(
    current: &BattleMaterialApplyContext,
    material: &BattleReplacementMaterialV1,
    content: &ContentPack,
) -> Result<MaterialApplyResult, BattleMaterialApplyError> {
    apply_replacement_material_inner(current, material, content, ContentValidationMode::Trusted)
}

fn apply_replacement_material_inner(
    current: &BattleMaterialApplyContext,
    material: &BattleReplacementMaterialV1,
    content: &ContentPack,
    validation: ContentValidationMode,
) -> Result<MaterialApplyResult, BattleMaterialApplyError> {
    verify_material_before_digest(&material.before_state, &material.before_digest)?;
    validate_material_header(
        material.schema_version,
        &material.oracle_game_sha,
        &material.content_hash,
        &material.before_state,
        &material.after_state,
        content,
        validation,
    )?;
    validate_state_content_trusted(&material.before_state, content)
        .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
    validate_replacement_identity(material)?;
    validate_material_replacement_selection(
        &material.before_state,
        material.occurrence.id,
        &material.selection,
        content,
    )
    .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
    validate_after_state_and_digest(
        &material.after_state,
        &material.after_digest,
        content,
        DigestValidationMode::Independent,
    )?;
    validate_replacement_rng(material)?;
    validate_outcome_and_decision(
        &material.after_state,
        material.outcome,
        material.next_decision,
    )?;
    validate_next_state_command_collection(&material.after_state, material.next_decision, content)?;
    validate_replacement_evidence(material, content)?;
    let menu_allocators = validate_allocator_projection(
        &material.after_state,
        &material.menu_allocators_before,
        &material.next_control,
        BTreeMap::new(),
    )?;
    validate_control_projection(
        &material.after_state,
        material.next_decision,
        &material.menu_allocators_before,
        &material.next_control,
        content,
    )?;
    if current.current_state != material.before_state {
        return Err(BattleMaterialApplyError::LocalBeforeStateMismatch);
    }
    validate_endpoint_allocators(
        &current.menu_allocators,
        current.local_seat,
        &material.menu_allocators_before,
        &material.after_state,
    )?;

    Ok(MaterialApplyResult {
        after_state: material.after_state.clone(),
        after_digest: material.after_digest.clone(),
        presentation: material.presentation.clone(),
        presentation_digest: material.presentation_digest.clone(),
        outcome: material.outcome,
        next_decision: material.next_decision,
        next_control: material.next_control.clone(),
        menu_allocators,
    })
}

fn verify_material_before_digest(
    before_state: &GameState,
    stated: &MechanicalStateDigest,
) -> Result<(), BattleMaterialApplyError> {
    let computed = MechanicalStateDigest::compute(before_state)
        .map_err(|_| BattleMaterialApplyError::InvalidMaterialBeforeDigest)?;
    if &computed != stated {
        return Err(BattleMaterialApplyError::InvalidMaterialBeforeDigest);
    }
    Ok(())
}

fn validate_material_header(
    schema_version: u32,
    oracle_game_sha: &str,
    content_hash: &ContentPackHash,
    before_state: &GameState,
    after_state: &GameState,
    content: &ContentPack,
    validation: ContentValidationMode,
) -> Result<(), BattleMaterialApplyError> {
    if schema_version != BATTLE_MATERIAL_SCHEMA_VERSION {
        return Err(BattleMaterialApplyError::SchemaVersionMismatch);
    }
    if oracle_game_sha != content.oracle_game_sha
        || !matches!(oracle_game_sha, ORACLE_GAME_SHA | M4_ORACLE_GAME_SHA)
    {
        return Err(BattleMaterialApplyError::OracleIdentityMismatch);
    }
    if matches!(validation, ContentValidationMode::Full) && content.validate().is_err() {
        return Err(BattleMaterialApplyError::Invariant);
    }
    if content_hash != &content.hash
        || before_state.content_hash != content.hash
        || after_state.content_hash != content.hash
    {
        return Err(BattleMaterialApplyError::ContentHashMismatch);
    }
    Ok(())
}

fn validate_turn_identity(material: &BattleTurnMaterialV1) -> Result<(), BattleMaterialApplyError> {
    let before = material
        .before_state
        .battle
        .as_ref()
        .ok_or(BattleMaterialApplyError::MalformedIdentity)?;
    let after = material
        .after_state
        .battle
        .as_ref()
        .ok_or(BattleMaterialApplyError::MalformedIdentity)?;
    if before.battle_id != material.battle_id
        || after.battle_id != material.battle_id
        || before.wave != material.wave
        || after.wave != material.wave
        || before.turn != material.resolved_turn
        || before.authority_seat != after.authority_seat
    {
        return Err(BattleMaterialApplyError::MalformedIdentity);
    }
    let expected_turn = if material.outcome == BattleOutcome::Ongoing {
        increment_turn(material.resolved_turn)?
    } else {
        material.resolved_turn
    };
    if after.turn != expected_turn {
        return Err(BattleMaterialApplyError::MalformedIdentity);
    }
    let expected_operation =
        turn_result_operation_id(material.battle_id, material.wave, material.resolved_turn)
            .map_err(|_| BattleMaterialApplyError::MalformedIdentity)?;
    if material.operation_id != expected_operation {
        return Err(BattleMaterialApplyError::MalformedIdentity);
    }
    Ok(())
}

fn validate_replacement_identity(
    material: &BattleReplacementMaterialV1,
) -> Result<(), BattleMaterialApplyError> {
    let before = material
        .before_state
        .battle
        .as_ref()
        .ok_or(BattleMaterialApplyError::MalformedIdentity)?;
    let after = material
        .after_state
        .battle
        .as_ref()
        .ok_or(BattleMaterialApplyError::MalformedIdentity)?;
    let occurrence = material.occurrence;
    if before.battle_id != material.battle_id
        || after.battle_id != material.battle_id
        || before.wave != material.wave
        || after.wave != material.wave
        || before.turn != after.turn
        || occurrence.slot.side != BattleSide::Player
        || occurrence.owner_seat.is_none()
        || occurrence.source.wave != material.wave
        || occurrence.source.resolved_turn != material.resolved_turn
        || occurrence.replacement != ReplacementProgress::Applied
    {
        return Err(BattleMaterialApplyError::MalformedIdentity);
    }
    let expected_operation = replacement_operation_id(
        occurrence.source.epoch,
        material.battle_id,
        material.wave,
        material.resolved_turn,
        occurrence.source.turn_occurrence,
        occurrence.slot,
        occurrence
            .owner_seat
            .ok_or(BattleMaterialApplyError::MalformedIdentity)?,
    )
    .map_err(|_| BattleMaterialApplyError::MalformedIdentity)?;
    if material.operation_id != expected_operation {
        return Err(BattleMaterialApplyError::MalformedIdentity);
    }
    let before_occurrence = before
        .faint_queue
        .iter()
        .find(|candidate| candidate.id == occurrence.id)
        .ok_or(BattleMaterialApplyError::InvalidEvidence)?;
    if before_occurrence.source != occurrence.source
        || before_occurrence.slot != occurrence.slot
        || before_occurrence.pokemon != occurrence.pokemon
        || before_occurrence.owner_seat != occurrence.owner_seat
        || matches!(before_occurrence.replacement, ReplacementProgress::Applied)
    {
        return Err(BattleMaterialApplyError::InvalidEvidence);
    }
    let after_occurrence = after
        .faint_queue
        .iter()
        .find(|candidate| candidate.id == occurrence.id)
        .ok_or(BattleMaterialApplyError::InvalidAfterState)?;
    if after_occurrence != &occurrence {
        return Err(BattleMaterialApplyError::InvalidAfterState);
    }
    Ok(())
}

fn increment_turn(turn: TurnIndex) -> Result<TurnIndex, BattleMaterialApplyError> {
    let value = turn
        .get()
        .get()
        .checked_add(1)
        .ok_or(BattleMaterialApplyError::MalformedIdentity)?;
    let safe = SafeU53::new(value).map_err(|_| BattleMaterialApplyError::MalformedIdentity)?;
    TurnIndex::new(safe).map_err(|_| BattleMaterialApplyError::MalformedIdentity)
}

fn reconcile_turn_frontier(
    current_state: &GameState,
    material: &BattleTurnMaterialV1,
    content: &ContentPack,
) -> Result<(), BattleMaterialApplyError> {
    validate_state_content_trusted(current_state, content)
        .map_err(|_| BattleMaterialApplyError::Invariant)?;
    if current_state == &material.before_state {
        return Ok(());
    }
    if state_without_command_collection(current_state)
        != state_without_command_collection(&material.before_state)
    {
        return Err(BattleMaterialApplyError::LocalBeforeStateMismatch);
    }
    let current_battle = current_state
        .battle
        .as_ref()
        .ok_or(BattleMaterialApplyError::LocalBeforeStateMismatch)?;
    let material_battle = material
        .before_state
        .battle
        .as_ref()
        .ok_or(BattleMaterialApplyError::InvalidEvidence)?;
    if current_battle.command_state.frontier.len() != material_battle.command_state.frontier.len()
        || current_battle
            .command_state
            .frontier
            .iter()
            .zip(&material_battle.command_state.frontier)
            .any(|(local, remote)| !same_frontier_window(local, remote))
    {
        return Err(BattleMaterialApplyError::LocalBeforeStateMismatch);
    }
    for local in &current_battle.command_state.frontier {
        let Some(remote) = material_battle
            .command_state
            .frontier
            .iter()
            .find(|candidate| candidate.operation_id == local.operation_id)
        else {
            return Err(BattleMaterialApplyError::LocalBeforeStateMismatch);
        };
        if let Some(local_command) = retained_command(&local.status) {
            let Some(remote_command) = admitted_command(&remote.status) else {
                return Err(BattleMaterialApplyError::InvalidEvidence);
            };
            if local_command != remote_command {
                return Err(BattleMaterialApplyError::LocalBeforeStateMismatch);
            }
        }
    }

    // Rebuild the exact authority frontier on a private clone.  This keeps
    // the partial-frontier exception narrow: every non-command field came
    // from the endpoint, while the installed command collection is exactly
    // the material's canonical collection before its digest is recomputed.
    let mut staged = current_state.clone();
    {
        let staged_battle = staged
            .battle
            .as_mut()
            .ok_or(BattleMaterialApplyError::LocalBeforeStateMismatch)?;
        staged_battle.command_state = material_battle.command_state.clone();
    }
    validate_state_content_trusted(&staged, content)
        .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
    let staged_digest = MechanicalStateDigest::compute(&staged)
        .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
    if staged_digest != material.before_digest {
        return Err(BattleMaterialApplyError::InvalidEvidence);
    }
    Ok(())
}

fn state_without_command_collection(state: &GameState) -> GameState {
    let mut value = state.clone();
    if let Some(battle) = value.battle.as_mut() {
        battle.command_state = CommandCollectionState {
            frontier: Vec::new(),
            tombstones: Vec::new(),
        };
    }
    value
}

fn same_frontier_window(left: &CommandFrontierEntry, right: &CommandFrontierEntry) -> bool {
    left.operation_id == right.operation_id
        && left.owner_seat == right.owner_seat
        && left.actor == right.actor
        && left.field_slot == right.field_slot
        && left.offer == right.offer
}

fn retained_command(status: &CommandFrontierStatus) -> Option<&AcceptedBattleCommand> {
    match status {
        CommandFrontierStatus::Pending => None,
        CommandFrontierStatus::Retained { command, .. }
        | CommandFrontierStatus::Admitted { command, .. } => Some(command),
    }
}

fn admitted_command(status: &CommandFrontierStatus) -> Option<&AcceptedBattleCommand> {
    match status {
        CommandFrontierStatus::Admitted { command, .. } => Some(command),
        CommandFrontierStatus::Pending | CommandFrontierStatus::Retained { .. } => None,
    }
}

fn validate_turn_commands(
    before: &GameState,
    commands: &CommandSet,
    content: &ContentPack,
) -> Result<(), BattleMaterialApplyError> {
    commands
        .validate()
        .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
    normalize_command_set_trusted(before, commands, content)
        .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
    Ok(())
}

fn validate_material_replacement_selection(
    before: &GameState,
    occurrence: er_types::battle_ids::FaintOccurrenceId,
    selection: &ReplacementSelection,
    content: &ContentPack,
) -> Result<(), BattleMaterialApplyError> {
    let battle = before
        .battle
        .as_ref()
        .ok_or(BattleMaterialApplyError::InvalidEvidence)?;
    let stored = battle
        .faint_queue
        .iter()
        .find(|candidate| candidate.id == occurrence)
        .ok_or(BattleMaterialApplyError::InvalidEvidence)?;
    if *selection == ReplacementSelection::NoLegalReplacement
        && stored.replacement == ReplacementProgress::NoLegalReplacement
    {
        let candidates = legal_replacement_candidates(battle, occurrence)
            .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
        if candidates.is_empty() {
            return Ok(());
        }
        return Err(BattleMaterialApplyError::InvalidEvidence);
    }
    validate_replacement_selection_trusted(before, occurrence, selection, content)
        .map_err(|_| BattleMaterialApplyError::InvalidEvidence)
}

fn validate_turn_evidence(
    material: &BattleTurnMaterialV1,
    content: &ContentPack,
) -> Result<(), BattleMaterialApplyError> {
    validate_action_order(
        &material.before_state,
        &material.commands,
        &material.action_order,
        content,
    )?;
    validate_battle_mutation_evidence(
        &material.before_state,
        &material.after_state,
        &material.mutations,
    )
    .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
    validate_presentation(
        &material.presentation,
        &material.presentation_digest,
        &material.operation_id,
        material.outcome,
        PresentationValidationContext {
            mutations: &material.mutations,
            before_state: &material.before_state,
            after_state: &material.after_state,
            content,
        },
    )?;
    Ok(())
}

fn validate_replacement_evidence(
    material: &BattleReplacementMaterialV1,
    content: &ContentPack,
) -> Result<(), BattleMaterialApplyError> {
    validate_battle_mutation_evidence(
        &material.before_state,
        &material.after_state,
        &material.mutations,
    )
    .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
    validate_presentation(
        &material.presentation,
        &material.presentation_digest,
        &material.operation_id,
        material.outcome,
        PresentationValidationContext {
            mutations: &material.mutations,
            before_state: &material.before_state,
            after_state: &material.after_state,
            content,
        },
    )?;
    Ok(())
}

fn validate_action_order(
    before: &GameState,
    commands: &CommandSet,
    action_order: &[ResolvedAction],
    content: &ContentPack,
) -> Result<(), BattleMaterialApplyError> {
    let battle = before
        .battle
        .as_ref()
        .ok_or(BattleMaterialApplyError::InvalidEvidence)?;
    let operations = commands
        .entries
        .iter()
        .map(|command| command.operation_id().clone())
        .collect::<BTreeSet<_>>();
    for (index, action) in action_order.iter().enumerate() {
        let sequence = SafeU53::new(
            u64::try_from(index).map_err(|_| BattleMaterialApplyError::InvalidEvidence)?,
        )
        .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
        if action.sequence != sequence
            || validate_slot(&battle.format, action.source_slot).is_err()
            || !party_contains_on_side(battle, action.actor, action.source_slot.side)
            || action.effective_speed == 0
        {
            return Err(BattleMaterialApplyError::InvalidEvidence);
        }
        match action.command_operation_id.as_ref() {
            Some(operation) => {
                if !matches!(
                    action.kind,
                    er_types::battle_model::ResolvedActionKind::Move
                        | er_types::battle_model::ResolvedActionKind::Switch
                ) {
                    return Err(BattleMaterialApplyError::InvalidEvidence);
                }
                if !operations.contains(operation) {
                    return Err(BattleMaterialApplyError::InvalidEvidence);
                }
                let Some(command) = commands
                    .entries
                    .iter()
                    .find(|command| command.operation_id() == operation)
                else {
                    return Err(BattleMaterialApplyError::InvalidEvidence);
                };
                if command.actor() != action.actor || command.field_slot() != action.source_slot {
                    return Err(BattleMaterialApplyError::InvalidEvidence);
                }
                let command_kind_matches = match (action.kind, command) {
                    (
                        er_types::battle_model::ResolvedActionKind::Move,
                        AcceptedBattleCommand::Human { proposal, .. },
                    ) => matches!(
                        &proposal.command,
                        er_types::battle_command::BattleCommand::Fight { .. }
                    ),
                    (
                        er_types::battle_model::ResolvedActionKind::Move,
                        AcceptedBattleCommand::ScriptedEnemy { command, .. },
                    ) => matches!(
                        &command.command,
                        er_types::battle_command::BattleCommand::Fight { .. }
                    ),
                    (
                        er_types::battle_model::ResolvedActionKind::Switch,
                        AcceptedBattleCommand::Human { proposal, .. },
                    ) => matches!(
                        &proposal.command,
                        er_types::battle_command::BattleCommand::Switch { .. }
                    ),
                    (
                        er_types::battle_model::ResolvedActionKind::Switch,
                        AcceptedBattleCommand::ScriptedEnemy { command, .. },
                    ) => matches!(
                        &command.command,
                        er_types::battle_command::BattleCommand::Switch { .. }
                    ),
                    _ => false,
                };
                if !command_kind_matches {
                    return Err(BattleMaterialApplyError::InvalidEvidence);
                }
                match action.kind {
                    er_types::battle_model::ResolvedActionKind::Move => {
                        let move_slot = match command {
                            AcceptedBattleCommand::Human { proposal, .. } => {
                                let er_types::battle_command::BattleCommand::Fight {
                                    move_slot,
                                    ..
                                } = &proposal.command
                                else {
                                    return Err(BattleMaterialApplyError::InvalidEvidence);
                                };
                                *move_slot
                            }
                            AcceptedBattleCommand::ScriptedEnemy { command, .. } => {
                                let er_types::battle_command::BattleCommand::Fight {
                                    move_slot,
                                    ..
                                } = &command.command
                                else {
                                    return Err(BattleMaterialApplyError::InvalidEvidence);
                                };
                                *move_slot
                            }
                        };
                        let pokemon = find_pokemon(battle, action.actor)
                            .ok_or(BattleMaterialApplyError::InvalidEvidence)?;
                        let move_definition = pokemon
                            .moves
                            .get(usize::from(move_slot.get()))
                            .and_then(Option::as_ref)
                            .and_then(|slot| find_move(&content.moves, slot.move_id).ok())
                            .ok_or(BattleMaterialApplyError::InvalidEvidence)?;
                        if action.timing_modifier != 1
                            || action.bracket_modifier != 1
                            || action.move_priority != move_definition.priority
                        {
                            return Err(BattleMaterialApplyError::InvalidEvidence);
                        }
                    }
                    er_types::battle_model::ResolvedActionKind::Switch => {
                        if action.timing_modifier != 0
                            || action.move_priority != 0
                            || action.bracket_modifier != 0
                        {
                            return Err(BattleMaterialApplyError::InvalidEvidence);
                        }
                    }
                    _ => return Err(BattleMaterialApplyError::InvalidEvidence),
                }
                if action.kind == er_types::battle_model::ResolvedActionKind::Switch
                    && action.disposition != er_types::battle_model::ActionDisposition::Executed
                {
                    return Err(BattleMaterialApplyError::InvalidEvidence);
                }
            }
            None if matches!(
                action.kind,
                er_types::battle_model::ResolvedActionKind::Move
                    | er_types::battle_model::ResolvedActionKind::Switch
            ) =>
            {
                return Err(BattleMaterialApplyError::InvalidEvidence);
            }
            None => {
                if action.disposition != er_types::battle_model::ActionDisposition::Executed
                    || action.timing_modifier != 0
                    || action.move_priority != 0
                    || action.bracket_modifier != 0
                    || action.tie_order != SafeU53::ZERO
                {
                    return Err(BattleMaterialApplyError::InvalidEvidence);
                }
            }
        }
    }
    Ok(())
}

struct PresentationValidationContext<'a> {
    mutations: &'a [BattleMutation],
    before_state: &'a GameState,
    after_state: &'a GameState,
    content: &'a ContentPack,
}

fn validate_presentation(
    presentation: &[BattlePresentationEvent],
    stated_digest: &PresentationPlanDigest,
    operation_id: &OperationId,
    outcome: BattleOutcome,
    context: PresentationValidationContext<'_>,
) -> Result<(), BattleMaterialApplyError> {
    for (index, event) in presentation.iter().enumerate() {
        let sequence = SafeU53::new(
            u64::try_from(index).map_err(|_| BattleMaterialApplyError::InvalidEvidence)?,
        )
        .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
        if event.event_id.operation_id != *operation_id
            || event.event_id.sequence != sequence
            || event.policy != PresentationBlockingPolicy::BlocksHumanInput
            || event.skip_policy != PresentationSkipPolicy::Forbidden
        {
            return Err(BattleMaterialApplyError::InvalidEvidence);
        }
        validate_presentation_kind(
            &event.kind,
            context.mutations,
            context.before_state,
            context.after_state,
            context.content,
        )?;
    }
    let computed = compute_presentation_plan_digest(presentation)
        .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
    if &computed != stated_digest {
        return Err(BattleMaterialApplyError::InvalidEvidence);
    }
    let terminal_count = presentation
        .iter()
        .filter(|event| {
            matches!(
                &event.kind,
                BattlePresentationKind::BattleWon | BattlePresentationKind::BattleLost
            )
        })
        .count();
    let terminal_matches = match outcome {
        BattleOutcome::Ongoing => terminal_count == 0,
        BattleOutcome::Victory => {
            terminal_count == 1
                && matches!(
                    presentation.last().map(|event| &event.kind),
                    Some(kind) if matches!(kind, BattlePresentationKind::BattleWon)
                )
        }
        BattleOutcome::Defeat => {
            terminal_count == 1
                && matches!(
                    presentation.last().map(|event| &event.kind),
                    Some(kind) if matches!(kind, BattlePresentationKind::BattleLost)
                )
        }
    };
    if terminal_matches {
        Ok(())
    } else {
        Err(BattleMaterialApplyError::InvalidEvidence)
    }
}

fn validate_presentation_kind(
    kind: &BattlePresentationKind,
    mutations: &[BattleMutation],
    before_state: &GameState,
    after_state: &GameState,
    content: &ContentPack,
) -> Result<(), BattleMaterialApplyError> {
    match kind {
        BattlePresentationKind::MoveUsed {
            actor,
            move_id,
            targets,
        } => {
            if targets.windows(2).any(|pair| pair[0] >= pair[1])
                || !party_contains_state(before_state, *actor)
                || !party_contains_state(after_state, *actor)
                || !move_exists_in_command_or_content(
                    *move_id,
                    *actor,
                    targets,
                    before_state,
                    content,
                )
            {
                return Err(BattleMaterialApplyError::InvalidEvidence);
            }
        }
        BattlePresentationKind::AbilityActivated {
            pokemon,
            ability_id,
        } => {
            if !party_contains_state(before_state, *pokemon)
                || !party_contains_state(after_state, *pokemon)
                || *ability_id == er_types::battle_ids::AbilityId::ZERO
                || !content
                    .abilities
                    .iter()
                    .any(|ability| ability.id == *ability_id)
            {
                return Err(BattleMaterialApplyError::InvalidEvidence);
            }
        }
        BattlePresentationKind::HpChanged {
            pokemon,
            before,
            after,
        } => {
            if !mutations.iter().any(|mutation| {
                matches!(
                    mutation,
                    BattleMutation::HpChanged {
                        pokemon: candidate,
                        before: old,
                        after: new,
                    } if candidate == pokemon && old == before && new == after
                )
            }) {
                return Err(BattleMaterialApplyError::InvalidEvidence);
            }
        }
        BattlePresentationKind::StatusApplied {
            pokemon,
            before,
            after,
        } => {
            if !mutations.iter().any(|mutation| {
                matches!(
                    mutation,
                    BattleMutation::StatusChanged {
                        pokemon: candidate,
                        before: old,
                        after: new,
                    } if candidate == pokemon && old == before && new == after
                )
            }) {
                return Err(BattleMaterialApplyError::InvalidEvidence);
            }
        }
        BattlePresentationKind::StatStageChanged {
            pokemon,
            stat,
            before,
            after,
        } => {
            let matching_mutation = mutations.iter().any(|mutation| {
                matches!(
                    mutation,
                    BattleMutation::StatStageChanged {
                        pokemon: candidate,
                        stat: changed_stat,
                        before: old,
                        after: new,
                    } if candidate == pokemon
                        && changed_stat == stat
                        && old == before
                        && new == after
                )
            });
            let exact_floor_attempt = before == after
                && *before == MIN_STAT_STAGE
                && !mutations.iter().any(|mutation| {
                    matches!(
                        mutation,
                        BattleMutation::StatStageChanged {
                            pokemon: candidate,
                            stat: changed_stat,
                            ..
                        } if candidate == pokemon && changed_stat == stat
                    )
                })
                && stage_in_state(before_state, *pokemon, *stat) == Some(*before)
                && stage_in_state(after_state, *pokemon, *stat) == Some(*after);
            if !matching_mutation && !exact_floor_attempt {
                return Err(BattleMaterialApplyError::InvalidEvidence);
            }
        }
        BattlePresentationKind::Switched {
            slot,
            outgoing,
            incoming,
        } => {
            if !mutations.iter().any(|mutation| {
                matches!(
                    mutation,
                    BattleMutation::FieldChanged {
                        slot: changed_slot,
                        before: old,
                        after: Some(new),
                    } if changed_slot == slot && old == outgoing && new == incoming
                )
            }) {
                return Err(BattleMaterialApplyError::InvalidEvidence);
            }
        }
        BattlePresentationKind::Fainted {
            pokemon,
            occurrence,
        } => {
            if !mutations.iter().any(|mutation| {
                matches!(
                    mutation,
                    BattleMutation::FaintQueued { occurrence: queued }
                        if queued.id == *occurrence && queued.pokemon == *pokemon
                )
            }) {
                return Err(BattleMaterialApplyError::InvalidEvidence);
            }
        }
        BattlePresentationKind::BattleWon | BattlePresentationKind::BattleLost => {}
    }
    Ok(())
}

fn move_exists_in_command_or_content(
    move_id: MoveId,
    actor: PokemonId,
    targets: &[FieldSlot],
    state: &GameState,
    content: &ContentPack,
) -> bool {
    let Some(battle) = state.battle.as_ref() else {
        return false;
    };
    let Ok(commands) = battle.command_state.admitted_command_set() else {
        return false;
    };
    let Ok(normalized) = normalize_command_set_trusted(state, &commands, content) else {
        return false;
    };
    normalized.entries().iter().any(|command| {
        matches!(
            command,
            NormalizedBattleCommand::Fight {
                actor: candidate_actor,
                move_id: candidate_move,
                targets: candidate_targets,
                ..
            } if *candidate_actor == actor
                && *candidate_move == move_id
                && candidate_targets.as_slice() == targets
        )
    })
}

fn validate_turn_rng(material: &BattleTurnMaterialV1) -> Result<(), BattleMaterialApplyError> {
    let before_battle = material
        .before_state
        .battle
        .as_ref()
        .ok_or(BattleMaterialApplyError::InvalidEvidence)?;
    let after_battle = material
        .after_state
        .battle
        .as_ref()
        .ok_or(BattleMaterialApplyError::InvalidEvidence)?;
    if material.rng_before != before_battle.battle_rng
        || material.rng_after != after_battle.battle_rng
    {
        return Err(BattleMaterialApplyError::InvalidEvidence);
    }
    if material.before_state.run_rng != material.after_state.run_rng {
        return Err(BattleMaterialApplyError::InvalidEvidence);
    }

    let mut replay = RngRuntime::from_states(
        material.before_state.run_rng.clone(),
        Some(material.rng_before.clone()),
    )
    .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
    let mut index = 0;
    while let Some(draw) = material.rng_audit.get(index) {
        draw.validate()
            .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
        let expected_sequence = SafeU53::new(
            u64::try_from(index).map_err(|_| BattleMaterialApplyError::InvalidEvidence)?,
        )
        .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
        if draw.sequence != expected_sequence {
            return Err(BattleMaterialApplyError::InvalidEvidence);
        }

        if draw.stream == RngStream::SeedOffset {
            index = replay_speed_order_scope(material, &mut replay, index)?;
        } else {
            replay_ordinary_draw(&mut replay, draw)?;
            index += 1;
        }
    }

    if replay.run_state() != material.after_state.run_rng {
        return Err(BattleMaterialApplyError::InvalidEvidence);
    }
    if material.outcome == BattleOutcome::Ongoing {
        replay
            .increment_turn()
            .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
    }
    if replay.battle_state() != Some(&material.rng_after) {
        return Err(BattleMaterialApplyError::InvalidEvidence);
    }
    Ok(())
}

fn replay_speed_order_scope(
    material: &BattleTurnMaterialV1,
    replay: &mut RngRuntime,
    start: usize,
) -> Result<usize, BattleMaterialApplyError> {
    let first = material
        .rng_audit
        .get(start)
        .ok_or(BattleMaterialApplyError::InvalidEvidence)?;
    if first.stream != RngStream::SeedOffset
        || first.reason != RngReason::SpeedTie
        || first.public_api != RngPublicApi::FisherYatesSwap
        || first.minimum != SafeU53::ZERO
    {
        return Err(BattleMaterialApplyError::InvalidEvidence);
    }
    let length = usize::try_from(first.cardinality.get())
        .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
    if length < 2 || length > material.commands.entries.len() {
        return Err(BattleMaterialApplyError::InvalidEvidence);
    }
    let draw_count = length
        .checked_sub(1)
        .ok_or(BattleMaterialApplyError::InvalidEvidence)?;
    let end = start
        .checked_add(draw_count)
        .ok_or(BattleMaterialApplyError::InvalidEvidence)?;
    let stated = material
        .rng_audit
        .get(start..end)
        .ok_or(BattleMaterialApplyError::InvalidEvidence)?;
    let replay_start = replay.audit_entries().len();
    let mut positions = vec![(); length];
    replay
        .speed_order_shuffle(
            &mut positions,
            &material
                .before_state
                .battle
                .as_ref()
                .ok_or(BattleMaterialApplyError::InvalidEvidence)?
                .wave_seed,
            material.resolved_turn,
        )
        .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
    if replay.audit_entries().get(replay_start..) != Some(stated) {
        return Err(BattleMaterialApplyError::InvalidEvidence);
    }
    Ok(end)
}

fn replay_ordinary_draw(
    replay: &mut RngRuntime,
    stated: &RngDraw,
) -> Result<(), BattleMaterialApplyError> {
    let replay_start = replay.audit_entries().len();
    match (stated.stream, stated.public_api) {
        (RngStream::Run, RngPublicApi::RandSeedInt) => {
            replay
                .run_rand_seed_int(
                    stated.cardinality,
                    stated.minimum,
                    stated.reason,
                    stated.callsite_id.clone(),
                )
                .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
        }
        (RngStream::Run, RngPublicApi::IntegerInRange) => {
            let maximum = audited_range_maximum(stated)?;
            replay
                .run_integer_in_range(
                    stated.minimum,
                    maximum,
                    stated.reason,
                    stated.callsite_id.clone(),
                )
                .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
        }
        (RngStream::Run, RngPublicApi::Pick) => {
            let length = usize::try_from(stated.cardinality.get())
                .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
            replay
                .run_pick_index(length, stated.reason, stated.callsite_id.clone())
                .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
        }
        (RngStream::Battle, RngPublicApi::RandSeedInt) => {
            replay
                .battle_rand_seed_int(
                    stated.cardinality,
                    stated.minimum,
                    stated.reason,
                    stated.callsite_id.clone(),
                )
                .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
        }
        (RngStream::Battle, RngPublicApi::IntegerInRange) => {
            let maximum = audited_range_maximum(stated)?;
            replay
                .battle_integer_in_range(
                    stated.minimum,
                    maximum,
                    stated.reason,
                    stated.callsite_id.clone(),
                )
                .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
        }
        (RngStream::Battle, RngPublicApi::Pick) => {
            let length = usize::try_from(stated.cardinality.get())
                .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
            replay
                .battle_pick_index(length, stated.reason, stated.callsite_id.clone())
                .map_err(|_| BattleMaterialApplyError::InvalidEvidence)?;
        }
        (RngStream::SeedOffset, _) | (_, RngPublicApi::FisherYatesSwap) => {
            return Err(BattleMaterialApplyError::InvalidEvidence);
        }
    }
    if replay.audit_entries().get(replay_start) != Some(stated)
        || replay.audit_entries().len() != replay_start + 1
    {
        return Err(BattleMaterialApplyError::InvalidEvidence);
    }
    Ok(())
}

fn audited_range_maximum(stated: &RngDraw) -> Result<SafeU53, BattleMaterialApplyError> {
    stated
        .cardinality
        .get()
        .checked_sub(1)
        .and_then(|width| stated.minimum.get().checked_add(width))
        .and_then(|value| SafeU53::new(value).ok())
        .ok_or(BattleMaterialApplyError::InvalidEvidence)
}

fn validate_replacement_rng(
    material: &BattleReplacementMaterialV1,
) -> Result<(), BattleMaterialApplyError> {
    let before = material
        .before_state
        .battle
        .as_ref()
        .ok_or(BattleMaterialApplyError::InvalidEvidence)?;
    let after = material
        .after_state
        .battle
        .as_ref()
        .ok_or(BattleMaterialApplyError::InvalidEvidence)?;
    if before.battle_rng != after.battle_rng
        || material.before_state.run_rng != material.after_state.run_rng
    {
        return Err(BattleMaterialApplyError::InvalidEvidence);
    }
    Ok(())
}

fn validate_after_state_and_digest(
    after_state: &GameState,
    stated: &MechanicalStateDigest,
    content: &ContentPack,
    digest_validation: DigestValidationMode,
) -> Result<(), BattleMaterialApplyError> {
    validate_state_content_trusted(after_state, content)
        .map_err(|_| BattleMaterialApplyError::InvalidAfterState)?;
    if matches!(digest_validation, DigestValidationMode::Independent) {
        let computed = MechanicalStateDigest::compute(after_state)
            .map_err(|_| BattleMaterialApplyError::InvalidAfterState)?;
        if &computed != stated {
            return Err(BattleMaterialApplyError::InvalidAfterState);
        }
    }
    Ok(())
}

fn validate_outcome_and_decision(
    after_state: &GameState,
    outcome: BattleOutcome,
    next_decision: BattleNextDecision,
) -> Result<(), BattleMaterialApplyError> {
    let battle = after_state
        .battle
        .as_ref()
        .ok_or(BattleMaterialApplyError::InvalidControlProjection)?;
    if battle.outcome != outcome || derive_next_decision(battle) != next_decision {
        return Err(BattleMaterialApplyError::InvalidControlProjection);
    }
    Ok(())
}

fn derive_next_decision(battle: &BattleState) -> BattleNextDecision {
    if battle.outcome != BattleOutcome::Ongoing {
        return BattleNextDecision::Complete(battle.outcome);
    }
    battle
        .faint_queue
        .iter()
        .find(|occurrence| occurrence.replacement != ReplacementProgress::Applied)
        .map_or(BattleNextDecision::CommandFrontier, |occurrence| {
            BattleNextDecision::Replacement {
                occurrence: occurrence.id,
            }
        })
}

/// Validate the exact command collection that the game-owned candidate carried
/// after this material.  The applier never creates a frontier or chooses a
/// scripted command; it only checks and installs the typed candidate state.
fn validate_next_state_command_collection(
    after_state: &GameState,
    next_decision: BattleNextDecision,
    content: &ContentPack,
) -> Result<(), BattleMaterialApplyError> {
    let battle = after_state
        .battle
        .as_ref()
        .ok_or(BattleMaterialApplyError::InvalidAfterState)?;
    match next_decision {
        BattleNextDecision::CommandFrontier => {
            validate_fresh_command_frontier(after_state, battle, content)
        }
        BattleNextDecision::Replacement { .. } | BattleNextDecision::Complete(_) => {
            battle
                .command_state
                .validate()
                .map_err(|_| BattleMaterialApplyError::InvalidAfterState)?;
            if !battle.command_state.frontier.is_empty() {
                return Err(BattleMaterialApplyError::InvalidAfterState);
            }
            Ok(())
        }
    }
}

fn validate_fresh_command_frontier(
    after_state: &GameState,
    battle: &BattleState,
    content: &ContentPack,
) -> Result<(), BattleMaterialApplyError> {
    battle
        .command_state
        .validate()
        .map_err(|_| BattleMaterialApplyError::InvalidAfterState)?;
    let expected_slots =
        canonical_slots(&battle.format).map_err(|_| BattleMaterialApplyError::InvalidAfterState)?;
    let mut living_active = Vec::new();
    for slot in expected_slots {
        let actor = battle
            .field
            .occupant(&battle.format, slot)
            .map_err(|_| BattleMaterialApplyError::InvalidAfterState)?;
        let Some(actor) = actor else {
            continue;
        };
        let pokemon =
            find_pokemon(battle, actor).ok_or(BattleMaterialApplyError::InvalidAfterState)?;
        if !pokemon.fainted {
            living_active.push((slot, actor));
        }
    }
    if living_active.is_empty() || battle.command_state.frontier.len() != living_active.len() {
        return Err(BattleMaterialApplyError::InvalidAfterState);
    }

    for ((slot, actor), entry) in living_active
        .into_iter()
        .zip(&battle.command_state.frontier)
    {
        if entry.field_slot != slot || entry.actor != actor {
            return Err(BattleMaterialApplyError::InvalidAfterState);
        }
        match slot.side {
            BattleSide::Player => {
                let owner = owner_seat_for(&battle.format, slot)
                    .map_err(|_| BattleMaterialApplyError::InvalidAfterState)?
                    .ok_or(BattleMaterialApplyError::InvalidAfterState)?;
                let expected_operation = player_command_operation_id(
                    battle.battle_id,
                    battle.wave,
                    battle.turn,
                    slot,
                    owner,
                )
                .map_err(|_| BattleMaterialApplyError::InvalidAfterState)?;
                let expected_offer = build_command_offer_trusted(after_state, slot, content)
                    .map_err(|_| BattleMaterialApplyError::InvalidAfterState)?;
                if entry.owner_seat != Some(owner)
                    || entry.operation_id != expected_operation
                    || entry.offer != expected_offer
                    || !matches!(&entry.status, CommandFrontierStatus::Pending)
                {
                    return Err(BattleMaterialApplyError::InvalidAfterState);
                }
            }
            BattleSide::Enemy => {
                let scripted = match &entry.status {
                    CommandFrontierStatus::Admitted {
                        command: AcceptedBattleCommand::ScriptedEnemy { command, .. },
                        source: CommandAdmissionSource::ScriptedEnemy,
                    } => command,
                    _ => return Err(BattleMaterialApplyError::InvalidAfterState),
                };
                let expected_operation = scripted_enemy_command_operation_id(
                    battle.battle_id,
                    battle.wave,
                    battle.turn,
                    slot,
                    scripted.script_cursor,
                )
                .map_err(|_| BattleMaterialApplyError::InvalidAfterState)?;
                let expected_offer = build_scripted_enemy_offer_trusted(
                    after_state,
                    slot,
                    &scripted.command,
                    content,
                )
                .map_err(|_| BattleMaterialApplyError::InvalidAfterState)?;
                if entry.owner_seat.is_some()
                    || entry.operation_id != expected_operation
                    || scripted.operation_id != expected_operation
                    || scripted.battle_id != battle.battle_id
                    || scripted.wave != battle.wave
                    || scripted.turn != battle.turn
                    || scripted.field_slot != slot
                    || scripted.actor != actor
                    || entry.offer != expected_offer
                {
                    return Err(BattleMaterialApplyError::InvalidAfterState);
                }
            }
        }
    }
    Ok(())
}

fn material_command_menu_ids(commands: &CommandSet) -> BTreeMap<SeatId, Vec<MenuInstanceId>> {
    let mut ids = BTreeMap::new();
    for command in &commands.entries {
        if let AcceptedBattleCommand::Human { proposal, .. } = command {
            ids.entry(proposal.owner_seat)
                .or_insert_with(Vec::new)
                .push(proposal.menu_instance_id);
        }
    }
    ids
}

fn validate_allocator_projection(
    after_state: &GameState,
    before_allocators: &[SeatMenuInstanceAllocator],
    next_control: &BattleControlPlan,
    material_command_menu_ids: BTreeMap<SeatId, Vec<MenuInstanceId>>,
) -> Result<Vec<SeatMenuInstanceAllocator>, BattleMaterialApplyError> {
    let battle = after_state
        .battle
        .as_ref()
        .ok_or(BattleMaterialApplyError::MenuAllocatorMismatch)?;
    let seats =
        human_seats(&battle.format).map_err(|_| BattleMaterialApplyError::MenuAllocatorMismatch)?;
    validate_allocator_vector(before_allocators, &seats)?;
    validate_control_plan_allocator_shape(next_control, &seats)?;
    let before = allocator_map(before_allocators);
    for (seat, ids) in material_command_menu_ids {
        let high_water = before
            .get(&seat)
            .copied()
            .ok_or(BattleMaterialApplyError::MenuAllocatorMismatch)?;
        if ids.iter().any(|id| *id >= high_water) {
            return Err(BattleMaterialApplyError::MenuAllocatorMismatch);
        }
    }
    let next = allocator_map(&next_control.menu_allocators);
    let mut control_ids = Vec::new();
    for seat in &next_control.seats {
        collect_menu_ids(&seat.control, seat.seat, &mut control_ids);
    }
    let mut grouped = BTreeMap::<SeatId, Vec<MenuInstanceId>>::new();
    for (seat, menu_id) in control_ids {
        grouped.entry(seat).or_default().push(menu_id);
    }
    for seat in &seats {
        let before_id = before
            .get(seat)
            .copied()
            .ok_or(BattleMaterialApplyError::MenuAllocatorMismatch)?;
        let after_id = next
            .get(seat)
            .copied()
            .ok_or(BattleMaterialApplyError::MenuAllocatorMismatch)?;
        if after_id < before_id {
            return Err(BattleMaterialApplyError::MenuAllocatorMismatch);
        }
        let mut ids = grouped.remove(seat).unwrap_or_default();
        ids.sort_unstable();
        ids.dedup();
        if ids.iter().any(|id| *id < before_id || *id >= after_id) {
            return Err(BattleMaterialApplyError::MenuAllocatorMismatch);
        }
        let fresh = ids;
        for (offset, id) in fresh.iter().enumerate() {
            let expected = menu_id_add(before_id, offset)?;
            if *id != expected {
                return Err(BattleMaterialApplyError::MenuAllocatorMismatch);
            }
        }
        let expected_after = menu_id_add(before_id, fresh.len())?;
        if after_id != expected_after {
            return Err(BattleMaterialApplyError::MenuAllocatorMismatch);
        }
    }
    if !grouped.is_empty() {
        return Err(BattleMaterialApplyError::MenuAllocatorMismatch);
    }
    Ok(next_control.menu_allocators.clone())
}

fn validate_allocator_vector(
    allocators: &[SeatMenuInstanceAllocator],
    seats: &[SeatId],
) -> Result<(), BattleMaterialApplyError> {
    if allocators.len() != seats.len()
        || allocators
            .iter()
            .map(|allocator| allocator.seat)
            .collect::<Vec<_>>()
            != seats
    {
        return Err(BattleMaterialApplyError::MenuAllocatorMismatch);
    }
    for allocator in allocators {
        allocator
            .validate()
            .map_err(|_| BattleMaterialApplyError::MenuAllocatorMismatch)?;
    }
    Ok(())
}

fn validate_control_plan_allocator_shape(
    plan: &BattleControlPlan,
    seats: &[SeatId],
) -> Result<(), BattleMaterialApplyError> {
    if plan.menu_allocators.len() != seats.len()
        || plan
            .menu_allocators
            .iter()
            .map(|allocator| allocator.seat)
            .collect::<Vec<_>>()
            != seats
    {
        return Err(BattleMaterialApplyError::MenuAllocatorMismatch);
    }
    match plan.validate() {
        Ok(()) => Ok(()),
        Err(
            BattleControlPlanError::UnsortedAllocators
            | BattleControlPlanError::DuplicateAllocatorSeat
            | BattleControlPlanError::SeatAllocatorMismatch
            | BattleControlPlanError::MenuInstanceAtOrAboveAllocator
            | BattleControlPlanError::DuplicateMenuInstance
            | BattleControlPlanError::Allocator(_),
        ) => Err(BattleMaterialApplyError::MenuAllocatorMismatch),
        Err(_) => Err(BattleMaterialApplyError::InvalidControlProjection),
    }
}

fn allocator_map(allocators: &[SeatMenuInstanceAllocator]) -> BTreeMap<SeatId, MenuInstanceId> {
    allocators
        .iter()
        .map(|allocator| (allocator.seat, allocator.next_menu_instance_id))
        .collect()
}

fn menu_id_add(
    start: MenuInstanceId,
    offset: usize,
) -> Result<MenuInstanceId, BattleMaterialApplyError> {
    let offset =
        u64::try_from(offset).map_err(|_| BattleMaterialApplyError::MenuAllocatorMismatch)?;
    let value = start
        .get()
        .get()
        .checked_add(offset)
        .ok_or(BattleMaterialApplyError::MenuAllocatorMismatch)?;
    let safe = SafeU53::new(value).map_err(|_| BattleMaterialApplyError::MenuAllocatorMismatch)?;
    Ok(MenuInstanceId::new(safe))
}

fn collect_menu_ids(
    control: &BattleControl,
    owner: SeatId,
    output: &mut Vec<(SeatId, MenuInstanceId)>,
) {
    match control {
        BattleControl::CommandRoot(CommandRootControl { menu, .. }) => {
            output.push((owner, menu.instance_id));
        }
        BattleControl::MoveSelect(MoveSelectControl {
            menu, cancel_to, ..
        })
        | BattleControl::TargetSelect(TargetSelectControl {
            menu, cancel_to, ..
        })
        | BattleControl::PartySelect(PartySelectControl {
            menu, cancel_to, ..
        })
        | BattleControl::PartyOptionSelect(PartyOptionSelectControl {
            menu, cancel_to, ..
        }) => {
            output.push((owner, menu.instance_id));
            collect_menu_ids(cancel_to, owner, output);
        }
        BattleControl::ReplacementSelect(ReplacementSelectControl { menu, .. }) => {
            output.push((owner, menu.instance_id));
        }
        BattleControl::Waiting(WaitingControl { .. }) | BattleControl::Complete(_) => {}
    }
}

fn validate_endpoint_allocators(
    current: &[SeatMenuInstanceAllocator],
    local_seat: SeatId,
    material_before: &[SeatMenuInstanceAllocator],
    state: &GameState,
) -> Result<(), BattleMaterialApplyError> {
    let battle = state
        .battle
        .as_ref()
        .ok_or(BattleMaterialApplyError::LocalBeforeStateMismatch)?;
    let seats = human_seats(&battle.format)
        .map_err(|_| BattleMaterialApplyError::LocalBeforeStateMismatch)?;
    validate_endpoint_allocator_shape(current, &seats)?;
    if !seats.contains(&local_seat) {
        return Err(BattleMaterialApplyError::LocalBeforeStateMismatch);
    }
    let expected = allocator_map(material_before);
    let actual = allocator_map(current);
    for seat in seats {
        let expected_id = expected
            .get(&seat)
            .copied()
            .ok_or(BattleMaterialApplyError::LocalBeforeStateMismatch)?;
        let actual_id = actual
            .get(&seat)
            .copied()
            .ok_or(BattleMaterialApplyError::LocalBeforeStateMismatch)?;
        if (seat == local_seat && actual_id != expected_id)
            || (seat != local_seat && actual_id > expected_id)
        {
            return Err(BattleMaterialApplyError::LocalBeforeStateMismatch);
        }
    }
    Ok(())
}

fn validate_endpoint_allocator_shape(
    allocators: &[SeatMenuInstanceAllocator],
    seats: &[SeatId],
) -> Result<(), BattleMaterialApplyError> {
    if allocators.len() != seats.len()
        || allocators
            .iter()
            .map(|allocator| allocator.seat)
            .collect::<Vec<_>>()
            != seats
    {
        return Err(BattleMaterialApplyError::LocalBeforeStateMismatch);
    }
    for allocator in allocators {
        allocator
            .validate()
            .map_err(|_| BattleMaterialApplyError::LocalBeforeStateMismatch)?;
    }
    Ok(())
}

fn validate_control_projection(
    after_state: &GameState,
    next_decision: BattleNextDecision,
    allocator_before: &[SeatMenuInstanceAllocator],
    next_control: &BattleControlPlan,
    content: &ContentPack,
) -> Result<(), BattleMaterialApplyError> {
    let projected =
        project_battle_control_plan(after_state, next_decision, allocator_before, content)
            .map_err(|_| BattleMaterialApplyError::InvalidControlProjection)?;
    if &projected != next_control {
        return Err(BattleMaterialApplyError::InvalidControlProjection);
    }
    Ok(())
}

fn party_contains(battle: &BattleState, pokemon: PokemonId) -> bool {
    find_pokemon(battle, pokemon).is_some()
}

fn party_contains_on_side(battle: &BattleState, pokemon: PokemonId, side: BattleSide) -> bool {
    let mut party = match side {
        BattleSide::Player => battle.player_party.iter(),
        BattleSide::Enemy => battle.enemy_party.iter(),
    };
    party.any(|candidate| candidate.id == pokemon)
}

fn party_contains_state(state: &GameState, pokemon: PokemonId) -> bool {
    state
        .battle
        .as_ref()
        .is_some_and(|battle| party_contains(battle, pokemon))
}

fn stage_in_state(state: &GameState, pokemon: PokemonId, stat: BattleStat) -> Option<i8> {
    let battle = state.battle.as_ref()?;
    let stages = &find_pokemon(battle, pokemon)?.stat_stages;
    Some(match stat {
        BattleStat::Attack => stages.attack,
        BattleStat::Defense => stages.defense,
        BattleStat::SpecialAttack => stages.special_attack,
        BattleStat::SpecialDefense => stages.special_defense,
        BattleStat::Speed => stages.speed,
        BattleStat::Accuracy => stages.accuracy,
        BattleStat::Evasion => stages.evasion,
    })
}

fn find_pokemon(
    battle: &BattleState,
    pokemon: PokemonId,
) -> Option<&er_state::pokemon::PokemonState> {
    battle
        .player_party
        .iter()
        .chain(&battle.enemy_party)
        .find(|candidate| candidate.id == pokemon)
}
