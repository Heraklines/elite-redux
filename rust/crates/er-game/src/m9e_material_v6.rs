use std::collections::BTreeSet;

use er_canonical::{canonical_bytes, content_digest};
use er_rng::audit::RngDraw;
use er_state::m9e_state_v6::GameStateV6;
use er_types::battle_ui::{PresentationBlockingPolicy, PresentationSkipPolicy};
use er_types::{
    GameActionV1, GameContentIdentityV2, GameControlPlanV2, OperationId, PlatformRequestId,
    PresentationEventId, SafeU53, SeatId,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::m9e_content_v2::{
    PreparedGameContentV2, PresentationAssetIdentityV1, PresentationAudioCueV1,
    PresentationSemanticIdV1,
};

pub const GAME_MATERIAL_SCHEMA_VERSION_V6: u32 = 6;
pub const APPLIED_MATERIAL_LEDGER_SCHEMA_VERSION_V1: u32 = 1;
pub const MAX_GAME_MATERIAL_BYTES_V6: usize = 32 * 1024 * 1024;
pub const MAX_GAME_STATE_BYTES_V6: usize = 16 * 1024 * 1024;
pub const MAX_GAME_MUTATIONS_V6: usize = 4_096;
pub const MAX_GAME_RNG_DRAWS_V6: usize = 4_096;
pub const MAX_GAME_PRESENTATIONS_V6: usize = 4_096;
pub const MAX_GAME_PLATFORM_EFFECTS_V6: usize = 256;
pub const MAX_PLATFORM_PAYLOAD_BYTES_V6: usize = 8 * 1024 * 1024;
pub const MAX_APPLIED_MATERIAL_RECORDS_V1: usize = 4_096;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GameActionDomainV2 {
    NewRun,
    BattleTurn,
    BattleReplacement,
    RunProgram,
    Capture,
    Party,
    Progression,
    MoveLearning,
    Evolution,
    Fusion,
    Inventory,
    Reward,
    World,
    Scenario,
    SaveControl,
    Terminal,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GameIdentityDomainV1 {
    Run,
    Pokemon,
    Battle,
    StorageSlot,
    ModifierInstance,
    ScenarioInstance,
    PlatformRequest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum GameMutationKindV2 {
    StateChanged,
    IdentityAllocated {
        domain: GameIdentityDomainV1,
        identity: SafeU53,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameMutationEvidenceV2 {
    pub ordinal: u32,
    pub domain: GameActionDomainV2,
    pub kind: GameMutationKindV2,
    pub before_digest: String,
    pub after_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GamePresentationEffectV2 {
    pub event_id: PresentationEventId,
    pub semantic: PresentationSemanticIdV1,
    pub blocking: PresentationBlockingPolicy,
    pub skip: PresentationSkipPolicy,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GameTelemetryEventV2 {
    RunStarted,
    ActionApplied,
    SaveCompleted,
    TerminalReached,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum GamePlatformEffectV2 {
    StorageRead {
        request: PlatformRequestId,
        slot: String,
    },
    StorageWrite {
        request: PlatformRequestId,
        slot: String,
        generation: SafeU53,
        bytes: Vec<u8>,
    },
    StorageDelete {
        request: PlatformRequestId,
        slot: String,
    },
    StorageList {
        request: PlatformRequestId,
    },
    AssetRequest {
        request: PlatformRequestId,
        asset: PresentationAssetIdentityV1,
    },
    AudioCue {
        request: PlatformRequestId,
        cue: PresentationAudioCueV1,
    },
    Telemetry {
        request: PlatformRequestId,
        event: GameTelemetryEventV2,
    },
    ReproReady {
        request: PlatformRequestId,
        kernel_digest: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameTransitionMaterialV6 {
    pub schema_version: u32,
    pub domain: GameActionDomainV2,
    pub operation_id: OperationId,
    pub authority_seat: SeatId,
    pub authority_revision: SafeU53,
    pub content_identity: GameContentIdentityV2,
    pub accepted_action: Option<GameActionV1>,
    pub before_digest: String,
    pub after_digest: String,
    pub mutations: Vec<GameMutationEvidenceV2>,
    pub rng_audit: Vec<RngDraw>,
    pub after_state: GameStateV6,
    pub next_control: GameControlPlanV2,
    pub presentation: Vec<GamePresentationEffectV2>,
    pub platform_effects: Vec<GamePlatformEffectV2>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GameMaterialV6 {
    NewRun(GameTransitionMaterialV6),
    BattleTurn(GameTransitionMaterialV6),
    BattleReplacement(GameTransitionMaterialV6),
    GameAction(GameTransitionMaterialV6),
    Terminal(GameTransitionMaterialV6),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppliedGameMaterialRecordV1 {
    pub operation_id: OperationId,
    pub material_fingerprint: String,
    pub authority_revision: SafeU53,
    pub after_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppliedGameMaterialLedgerV1 {
    pub schema_version: u32,
    pub next_authority_revision: SafeU53,
    pub records: Vec<AppliedGameMaterialRecordV1>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GameMaterialApplyOutcomeV6 {
    Applied,
    DuplicateApplied,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GameMaterialV6Error {
    #[error("material V6 is invalid")]
    Invalid,
    #[error("material V6 canonical encoding failed: {0}")]
    Canonical(String),
    #[error("material V6 frontier differs")]
    Frontier,
    #[error("material V6 authority revision differs")]
    Revision,
    #[error("material V6 duplicates an operation with different bytes")]
    ConflictingDuplicate,
    #[error("material V6 applied-material ledger is full or invalid")]
    Ledger,
}

impl GameMaterialV6 {
    pub fn transition(&self) -> &GameTransitionMaterialV6 {
        match self {
            Self::NewRun(value)
            | Self::BattleTurn(value)
            | Self::BattleReplacement(value)
            | Self::GameAction(value)
            | Self::Terminal(value) => value,
        }
    }

    pub fn canonical_bytes(&self) -> Result<Vec<u8>, GameMaterialV6Error> {
        self.validate()?;
        let bytes = canonical_bytes(self)
            .map_err(|error| GameMaterialV6Error::Canonical(error.to_string()))?;
        if bytes.len() > MAX_GAME_MATERIAL_BYTES_V6 {
            return Err(GameMaterialV6Error::Invalid);
        }
        Ok(bytes)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, GameMaterialV6Error> {
        if bytes.len() > MAX_GAME_MATERIAL_BYTES_V6 {
            return Err(GameMaterialV6Error::Invalid);
        }
        let value: Self =
            serde_json::from_slice(bytes).map_err(|_| GameMaterialV6Error::Invalid)?;
        if value.canonical_bytes()? != bytes {
            return Err(GameMaterialV6Error::Invalid);
        }
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), GameMaterialV6Error> {
        let transition = self.transition();
        if transition.schema_version != GAME_MATERIAL_SCHEMA_VERSION_V6
            || transition.operation_id.as_str().is_empty()
            || transition.authority_revision == SafeU53::ZERO
            || transition.after_state.content_identity != transition.content_identity
            || transition.next_control.revision != transition.authority_revision
            || game_state_digest(&transition.after_state)? != transition.after_digest
            || !valid_digest(&transition.before_digest)
            || !valid_digest(&transition.after_digest)
            || transition.mutations.len() > MAX_GAME_MUTATIONS_V6
            || transition.rng_audit.len() > MAX_GAME_RNG_DRAWS_V6
            || transition.presentation.len() > MAX_GAME_PRESENTATIONS_V6
            || transition.platform_effects.len() > MAX_GAME_PLATFORM_EFFECTS_V6
            || canonical_bytes(&transition.after_state)
                .map_err(|error| GameMaterialV6Error::Canonical(error.to_string()))?
                .len()
                > MAX_GAME_STATE_BYTES_V6
            || !variant_matches_transition(self, transition)
            || !action_matches_domain(transition.accepted_action.as_ref(), transition.domain)
            || invalid_mutations(&transition.mutations)
            || invalid_rng(&transition.rng_audit)
            || invalid_presentations(&transition.presentation)
            || invalid_platform_effects(
                &transition.platform_effects,
                &transition.mutations,
                transition.after_state.identities.next_platform_request_id,
            )
        {
            return Err(GameMaterialV6Error::Invalid);
        }
        transition
            .next_control
            .validate()
            .map_err(|_| GameMaterialV6Error::Invalid)?;
        transition
            .after_state
            .validate()
            .map_err(|_| GameMaterialV6Error::Invalid)
    }
}

impl AppliedGameMaterialLedgerV1 {
    pub fn new(next_authority_revision: SafeU53) -> Result<Self, GameMaterialV6Error> {
        let value = Self {
            schema_version: APPLIED_MATERIAL_LEDGER_SCHEMA_VERSION_V1,
            next_authority_revision,
            records: Vec::new(),
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), GameMaterialV6Error> {
        if self.schema_version != APPLIED_MATERIAL_LEDGER_SCHEMA_VERSION_V1
            || self.next_authority_revision == SafeU53::ZERO
            || self.records.len() > MAX_APPLIED_MATERIAL_RECORDS_V1
            || self
                .records
                .windows(2)
                .any(|pair| pair[0].authority_revision >= pair[1].authority_revision)
            || self.records.iter().any(|record| {
                !valid_digest(&record.material_fingerprint) || !valid_digest(&record.after_digest)
            })
        {
            return Err(GameMaterialV6Error::Ledger);
        }
        let mut operations = BTreeSet::new();
        if self
            .records
            .iter()
            .any(|record| !operations.insert(record.operation_id.clone()))
        {
            return Err(GameMaterialV6Error::Ledger);
        }
        if let Some(last) = self.records.last() {
            let expected = next_revision(last.authority_revision)?;
            if self.next_authority_revision != expected {
                return Err(GameMaterialV6Error::Ledger);
            }
        }
        Ok(())
    }

    pub fn record(&self, operation_id: &OperationId) -> Option<&AppliedGameMaterialRecordV1> {
        self.records
            .iter()
            .find(|record| &record.operation_id == operation_id)
    }
}

pub fn apply_game_material_v6(
    live: &mut Option<GameStateV6>,
    ledger: &mut AppliedGameMaterialLedgerV1,
    content: &PreparedGameContentV2,
    bytes: &[u8],
) -> Result<GameMaterialApplyOutcomeV6, GameMaterialV6Error> {
    ledger.validate()?;
    let material = GameMaterialV6::decode(bytes)?;
    let transition = material.transition();
    let fingerprint = material_fingerprint(bytes)?;
    if let Some(record) = ledger.record(&transition.operation_id) {
        return if record.material_fingerprint == fingerprint
            && record.authority_revision == transition.authority_revision
            && record.after_digest == transition.after_digest
        {
            Ok(GameMaterialApplyOutcomeV6::DuplicateApplied)
        } else {
            Err(GameMaterialV6Error::ConflictingDuplicate)
        };
    }
    if ledger.records.len() == MAX_APPLIED_MATERIAL_RECORDS_V1 {
        return Err(GameMaterialV6Error::Ledger);
    }
    if transition.authority_revision != ledger.next_authority_revision {
        return Err(GameMaterialV6Error::Revision);
    }
    if &transition.content_identity != content.identity() {
        return Err(GameMaterialV6Error::Invalid);
    }
    transition
        .after_state
        .validate_with(content)
        .map_err(|_| GameMaterialV6Error::Invalid)?;
    let before_digest = match live.as_ref() {
        Some(state) => game_state_digest(state)?,
        None => empty_game_state_digest()?,
    };
    if before_digest != transition.before_digest
        || (matches!(material, GameMaterialV6::NewRun(_)) != live.is_none())
    {
        return Err(GameMaterialV6Error::Frontier);
    }
    let record = AppliedGameMaterialRecordV1 {
        operation_id: transition.operation_id.clone(),
        material_fingerprint: fingerprint,
        authority_revision: transition.authority_revision,
        after_digest: transition.after_digest.clone(),
    };
    *live = Some(transition.after_state.clone());
    ledger.records.push(record);
    ledger.next_authority_revision = next_revision(transition.authority_revision)?;
    ledger.validate()?;
    Ok(GameMaterialApplyOutcomeV6::Applied)
}

pub fn game_state_digest(state: &GameStateV6) -> Result<String, GameMaterialV6Error> {
    digest(state)
}

pub fn empty_game_state_digest() -> Result<String, GameMaterialV6Error> {
    digest(&Option::<GameStateV6>::None)
}

fn variant_matches_transition(
    material: &GameMaterialV6,
    transition: &GameTransitionMaterialV6,
) -> bool {
    match material {
        GameMaterialV6::NewRun(_) => transition.domain == GameActionDomainV2::NewRun,
        GameMaterialV6::BattleTurn(_) => transition.domain == GameActionDomainV2::BattleTurn,
        GameMaterialV6::BattleReplacement(_) => {
            transition.domain == GameActionDomainV2::BattleReplacement
        }
        GameMaterialV6::Terminal(_) => transition.domain == GameActionDomainV2::Terminal,
        GameMaterialV6::GameAction(_) => !matches!(
            transition.domain,
            GameActionDomainV2::NewRun
                | GameActionDomainV2::BattleTurn
                | GameActionDomainV2::BattleReplacement
                | GameActionDomainV2::Terminal
        ),
    }
}

fn action_matches_domain(action: Option<&GameActionV1>, domain: GameActionDomainV2) -> bool {
    match (action, domain) {
        (None, GameActionDomainV2::NewRun) => true,
        (Some(GameActionV1::ExecuteRunProgram { .. }), GameActionDomainV2::RunProgram)
        | (Some(GameActionV1::Battle { .. }), GameActionDomainV2::BattleTurn)
        | (Some(GameActionV1::Battle { .. }), GameActionDomainV2::BattleReplacement)
        | (Some(GameActionV1::Capture { .. }), GameActionDomainV2::Capture)
        | (Some(GameActionV1::Party { .. }), GameActionDomainV2::Party)
        | (Some(GameActionV1::Progression { .. }), GameActionDomainV2::Progression)
        | (Some(GameActionV1::MoveLearning { .. }), GameActionDomainV2::MoveLearning)
        | (Some(GameActionV1::Evolution { .. }), GameActionDomainV2::Evolution)
        | (Some(GameActionV1::Fusion { .. }), GameActionDomainV2::Fusion)
        | (Some(GameActionV1::Inventory { .. }), GameActionDomainV2::Inventory)
        | (Some(GameActionV1::Reward { .. }), GameActionDomainV2::Reward)
        | (Some(GameActionV1::World { .. }), GameActionDomainV2::World)
        | (Some(GameActionV1::Scenario { .. }), GameActionDomainV2::Scenario)
        | (Some(GameActionV1::Save { .. }), GameActionDomainV2::SaveControl)
        | (Some(GameActionV1::Terminal { .. }), GameActionDomainV2::Terminal) => true,
        _ => false,
    }
}

fn invalid_mutations(mutations: &[GameMutationEvidenceV2]) -> bool {
    mutations.iter().enumerate().any(|(index, mutation)| {
        mutation.ordinal as usize != index
            || !valid_digest(&mutation.before_digest)
            || !valid_digest(&mutation.after_digest)
            || matches!(
                mutation.kind,
                GameMutationKindV2::IdentityAllocated {
                    identity: SafeU53::ZERO,
                    ..
                }
            )
    })
}

fn invalid_rng(draws: &[RngDraw]) -> bool {
    draws.iter().any(|draw| draw.validate().is_err())
        || draws
            .windows(2)
            .any(|pair| pair[0].sequence >= pair[1].sequence)
}

fn invalid_presentations(presentation: &[GamePresentationEffectV2]) -> bool {
    let mut ids = BTreeSet::new();
    presentation
        .iter()
        .any(|effect| effect.event_id == PresentationEventId::ZERO || !ids.insert(effect.event_id))
}

fn invalid_platform_effects(
    effects: &[GamePlatformEffectV2],
    mutations: &[GameMutationEvidenceV2],
    next_platform_request_id: SafeU53,
) -> bool {
    let allocated = mutations
        .iter()
        .filter_map(|mutation| match mutation.kind {
            GameMutationKindV2::IdentityAllocated {
                domain: GameIdentityDomainV1::PlatformRequest,
                identity,
            } => Some(identity),
            _ => None,
        })
        .collect::<BTreeSet<_>>();
    let mut ids = BTreeSet::new();
    effects.iter().any(|effect| {
        let (request, invalid) = match effect {
            GamePlatformEffectV2::StorageRead { request, slot }
            | GamePlatformEffectV2::StorageDelete { request, slot } => (*request, slot.is_empty()),
            GamePlatformEffectV2::StorageWrite {
                request,
                slot,
                generation,
                bytes,
            } => (
                *request,
                slot.is_empty()
                    || *generation == SafeU53::ZERO
                    || bytes.len() > MAX_PLATFORM_PAYLOAD_BYTES_V6,
            ),
            GamePlatformEffectV2::StorageList { request }
            | GamePlatformEffectV2::AssetRequest { request, .. }
            | GamePlatformEffectV2::AudioCue { request, .. }
            | GamePlatformEffectV2::Telemetry { request, .. } => (*request, false),
            GamePlatformEffectV2::ReproReady {
                request,
                kernel_digest,
            } => (*request, !valid_digest(kernel_digest)),
        };
        let raw = request.get();
        request == PlatformRequestId::ZERO
            || raw >= next_platform_request_id
            || !allocated.contains(&raw)
            || !ids.insert(request)
            || invalid
    })
}

fn material_fingerprint(bytes: &[u8]) -> Result<String, GameMaterialV6Error> {
    digest(&bytes)
}

fn digest<T: Serialize>(value: &T) -> Result<String, GameMaterialV6Error> {
    content_digest(value)
        .map(|value| format!("blake3-v1:{value}"))
        .map_err(|error| GameMaterialV6Error::Canonical(error.to_string()))
}

fn valid_digest(value: &str) -> bool {
    value.strip_prefix("blake3-v1:").is_some_and(|body| {
        body.len() == 64
            && body
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn next_revision(value: SafeU53) -> Result<SafeU53, GameMaterialV6Error> {
    let next = value
        .get()
        .checked_add(1)
        .ok_or(GameMaterialV6Error::Revision)?;
    SafeU53::new(next).map_err(|_| GameMaterialV6Error::Revision)
}
