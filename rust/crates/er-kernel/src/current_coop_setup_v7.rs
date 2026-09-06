//! Opt-in, bounded ownership of natural two-seat startup on the current V7 path.
//! Transport authenticates the pair; every setup message also binds its full context.
use super::*;
use er_game::m72_bootstrap::RunBootstrapSelectionsV1;
use er_types::{FrameContext, GameContentIdentityV2, GameModeId};
use crate::current_proposal_v7::{decode_current_hex_v1, MAX_CURRENT_RECEIPT_MATERIAL_BYTES_V1};

const MAX_CHOICES_BYTES: usize = 16_384;
const MAX_OWNER_BYTES: usize = 1_048_576;
const OPERATION: &str = "bootstrap/new-run/1";

type Result<T> = std::result::Result<T, GameKernelV7Error>;

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentCoopChoicesV1 {
    pub context: FrameContext,
    pub content: GameContentIdentityV2,
    pub seed: String,
    pub mode: GameModeId,
    pub starters: Vec<StarterSelectionV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CurrentCoopFrameV1 {
    CurrentCoopChoices { choices: CurrentCoopChoicesV1 },
    CurrentCoopStarted {
        authority: FrameContext,
        choices: CurrentCoopChoicesV1,
        host: RunBootstrapSelectionsV1,
        material_hex: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentCoopSetupSnapshotV1 {
    pub schema_version: u32,
    pub local: FrameContext,
    pub peer: FrameContext,
    pub content: GameContentIdentityV2,
    pub seed: String,
    pub choices: Option<CurrentCoopChoicesV1>,
    // One bounded reply for the entire startup, never an append-only history.
    pub started: Option<CurrentCoopFrameV1>,
}

fn encode<T: serde::Serialize>(value: &T, maximum: usize) -> Result<Vec<u8>> {
    let bytes = canonical_bytes(value).map_err(|_| GameKernelV7Error::Invalid)?;
    if bytes.is_empty() || bytes.len() > maximum { return Err(GameKernelV7Error::Invalid); }
    Ok(bytes)
}

fn decode(bytes: &[u8]) -> Result<CurrentCoopFrameV1> {
    if bytes.is_empty() || bytes.len() > MAX_OWNER_BYTES { return Err(GameKernelV7Error::Invalid); }
    let frame: CurrentCoopFrameV1 = serde_json::from_slice(bytes).map_err(|_| GameKernelV7Error::Invalid)?;
    // This comparison also rejects ignored fields in nested legacy schemas.
    if encode(&frame, MAX_OWNER_BYTES)? != bytes { return Err(GameKernelV7Error::Invalid); }
    Ok(frame)
}

pub(super) fn is_setup_frame(bytes: &[u8]) -> bool {
    if bytes.len() > MAX_OWNER_BYTES { return false; }
    serde_json::from_slice::<serde_json::Value>(bytes).ok()
        .and_then(|value| value.get("kind").and_then(|kind| kind.as_str()).map(str::to_owned))
        .is_some_and(|kind| kind == "CURRENT_COOP_CHOICES" || kind == "CURRENT_COOP_STARTED")
}

fn validate_starters(content: &PreparedGameContentV2, seat: SeatId, starters: &[StarterSelectionV1]) -> Result<()> {
    er_game::m9e_new_run_v6::validate_cooperative_choices_v7(content, seat, starters)
        .map_err(|_| GameKernelV7Error::Invalid)
}

fn validate_choices(choices: &CurrentCoopChoicesV1, owner: &CurrentCoopSetupSnapshotV1,
                    content: &PreparedGameContentV2) -> Result<()> {
    let guest = if owner.local.sender_seat_id == owner.local.authority_seat_id { &owner.peer } else { &owner.local };
    if &choices.context != guest || choices.content != owner.content || choices.seed != owner.seed
        || !content.bundle().bootstrap.modes.iter().any(|mode| mode.mode == choices.mode && mode.cooperative && mode.supported)
    { return Err(GameKernelV7Error::Invalid); }
    encode(choices, MAX_CHOICES_BYTES)?;
    validate_starters(content, guest.sender_seat_id, &choices.starters)
}

fn validate_started(frame: &CurrentCoopFrameV1, owner: &CurrentCoopSetupSnapshotV1,
                    content: &PreparedGameContentV2) -> Result<Vec<u8>> {
    let CurrentCoopFrameV1::CurrentCoopStarted { authority, choices, host, material_hex } = frame else {
        return Err(GameKernelV7Error::Invalid);
    };
    let expected = if owner.local.sender_seat_id == owner.local.authority_seat_id { &owner.local } else { &owner.peer };
    validate_choices(choices, owner, content)?;
    if authority != expected || owner.choices.as_ref() != Some(choices) || host.mode != Some(choices.mode)
        || !host.difficulty.is_some_and(|difficulty| difficulty.production())
        || !host.save_slot.as_ref().is_some_and(|slot| !slot.is_empty() && slot.len() <= 128)
        || host.choices.iter().any(|(id, value)| !content.bundle().bootstrap.choices.iter().any(|entry| &entry.id == id && entry.values.contains(value)))
    { return Err(GameKernelV7Error::Invalid); }
    validate_starters(content, authority.sender_seat_id, &host.starters)?;
    let bytes = decode_current_hex_v1(material_hex, MAX_CURRENT_RECEIPT_MATERIAL_BYTES_V1).map_err(|_| GameKernelV7Error::Invalid)?;
    let material = GameMaterialV6::decode(&bytes).map_err(|_| GameKernelV7Error::Invalid)?;
    let GameMaterialV6::NewRun(transition) = &material else { return Err(GameKernelV7Error::Invalid); };
    let run = transition.after_state.active_run.as_ref().ok_or(GameKernelV7Error::Invalid)?;
    if transition.authority_seat != authority.sender_seat_id || transition.authority_revision != safe_one()
        || transition.operation_id.as_str() != OPERATION || transition.content_identity != owner.content
        || transition.accepted_action != Some(GameActionV1::Bootstrap { action: BootstrapActionV1::Confirm })
        || run.seed != owner.seed || run.mode != choices.mode || run.party.len() != host.starters.len() + choices.starters.len()
    { return Err(GameKernelV7Error::Invalid); }
    for (pokemon, chosen) in run.party.iter().zip(host.starters.iter().chain(&choices.starters)) {
        if pokemon.owner_seat != Some(chosen.owner_seat) || pokemon.species_id.get() != chosen.species_id || pokemon.form_index != chosen.form_index {
            return Err(GameKernelV7Error::Invalid);
        }
    }
    transition.after_state.validate_with(content).map_err(|_| GameKernelV7Error::Invalid)?;
    Ok(bytes)
}

pub(crate) fn validate_snapshot(snapshot: &CoreGameKernelSnapshotV7, content: &PreparedGameContentV2) -> Result<()> {
    let Some(owner) = &snapshot.current_coop_setup else { return Ok(()); };
    encode(owner, MAX_OWNER_BYTES)?;
    let protocol = snapshot.protocol.as_ref().ok_or(GameKernelV7Error::Invalid)?;
    validate_current_pair_v1(protocol, owner.local.sender_seat_id, protocol.role, false).map_err(|_| GameKernelV7Error::Invalid)?;
    if owner.schema_version != 1 || owner.content != *content.identity() || owner.seed.is_empty() || owner.seed.len() > 1024
        || owner.local != protocol.frame_context.context || Some(&owner.peer) != protocol.peer_identity.peer.as_ref()
    { return Err(GameKernelV7Error::Invalid); }
    if let Some(choices) = &owner.choices { validate_choices(choices, owner, content)?; }
    match (&snapshot.lifecycle, &owner.started) {
        (GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap), None) => {
            if bootstrap.seed != owner.seed || bootstrap.current_storage.is_some()
                || bootstrap.catalog.local_is_host != (protocol.role == EndpointRole::Authority)
                || snapshot.current_proposal.is_some() || !snapshot.pending_platform.is_empty()
                || !snapshot.pending_presentations.is_empty() || snapshot.scheduler.disposed
            { return Err(GameKernelV7Error::Invalid); }
            if protocol.role == EndpointRole::Replica {
                match (&owner.choices, bootstrap.stage) {
                    (Some(choices), RunBootstrapStageV1::WaitingForPartner)
                        if bootstrap.selections.mode == Some(choices.mode) && bootstrap.selections.starters == choices.starters => {}
                    (None, stage) if stage != RunBootstrapStageV1::WaitingForPartner && stage != RunBootstrapStageV1::Complete => {}
                    _ => return Err(GameKernelV7Error::Invalid),
                }
            } else if bootstrap.stage == RunBootstrapStageV1::Complete && owner.choices.is_some() {
                return Err(GameKernelV7Error::Invalid);
            }
        }
        (GameKernelLifecycleSnapshotV7::Active(state) | GameKernelLifecycleSnapshotV7::Terminal { state, .. }, Some(started)) => {
            validate_started(started, owner, content)?;
            // The run may progress and change its party. The frozen startup reply is
            // bound to its run identity rather than requiring the initial party forever.
            let initial = match started {
                CurrentCoopFrameV1::CurrentCoopStarted { material_hex, .. } => {
                    GameMaterialV6::decode(&decode_current_hex_v1(material_hex, MAX_CURRENT_RECEIPT_MATERIAL_BYTES_V1).map_err(|_| GameKernelV7Error::Invalid)?).map_err(|_| GameKernelV7Error::Invalid)?
                }
                _ => return Err(GameKernelV7Error::Invalid),
            };
            if state.active_run.as_ref().is_some_and(|run| initial.transition().after_state.active_run.as_ref().is_none_or(|first| first.run_id != run.run_id || first.seed != run.seed || first.mode != run.mode)) {
                return Err(GameKernelV7Error::Invalid);
            }
        }
        _ => return Err(GameKernelV7Error::Invalid),
    }
    Ok(())
}

impl GameKernelV7 {
    /// Enable only at the unobserved Title of an established current pair.
    pub fn enable_current_coop_setup(&mut self) -> Result<()> {
        let GameKernelLifecycleV7::Bootstrap(bootstrap) = &self.lifecycle else { return Err(GameKernelV7Error::Invalid); };
        let protocol = self.protocol.as_ref().ok_or(GameKernelV7Error::Invalid)?;
        self.validate_current_network_pair(protocol.frame_context.context.connection_generation)?;
        if self.current_coop_setup.is_some() || self.current_proposal.is_some() || bootstrap.current_storage.is_some()
            || bootstrap.stage != RunBootstrapStageV1::Title || self.replay_sequence != SafeU53::ZERO
            || !bootstrap.pressed_keys.is_empty() || bootstrap.catalog.local_is_host != (self.role == GameKernelRoleV7::Authority)
            || !self.scheduler.timers.is_empty() || !self.scheduler.pauses.is_empty() || self.scheduler.disposed
            || !self.pending_platform.is_empty() || !self.pending_presentations.is_empty()
        { return Err(GameKernelV7Error::Invalid); }
        let mut candidate = self.clone();
        candidate.current_coop_setup = Some(CurrentCoopSetupSnapshotV1 {
            schema_version: 1, local: protocol.frame_context.context.clone(),
            peer: protocol.peer_identity.peer.clone().ok_or(GameKernelV7Error::Invalid)?,
            content: self.content.identity().clone(), seed: bootstrap.seed.clone(), choices: None, started: None,
        });
        candidate.validate()?;
        *self = candidate;
        Ok(())
    }

    /// Repeat the retained publication; no state, RNG, presentation or storage is repeated.
    pub fn retry_current_coop_setup(&self) -> Result<GameKernelStepV7> {
        let owner = self.current_coop_setup.as_ref().ok_or(GameKernelV7Error::Invalid)?;
        self.validate_current_network_pair(owner.local.connection_generation)?;
        let effect = if self.role == GameKernelRoleV7::Authority {
            owner.started.as_ref().map(|frame| encode(frame, MAX_OWNER_BYTES)).transpose()?
                .map(|bytes| GameKernelEffectV7::AuthorityMaterial { operation_id: OperationId::new(OPERATION).expect("constant operation"), bytes })
        } else if owner.started.is_none() {
            owner.choices.as_ref().map(|choices| encode(&CurrentCoopFrameV1::CurrentCoopChoices { choices: choices.clone() }, MAX_CHOICES_BYTES)).transpose()?
                .map(|bytes| GameKernelEffectV7::ProposalReady { operation_id: OperationId::new(OPERATION).expect("constant operation"), bytes })
        } else { None };
        Ok(GameKernelStepV7 { effects: effect.into_iter().collect(), internal_events: Vec::new() })
    }

    pub(super) fn advance_coop_bootstrap(&mut self) -> Result<GameKernelStepV7> {
        let GameKernelLifecycleV7::Bootstrap(bootstrap) = &self.lifecycle else { return Err(GameKernelV7Error::Invalid); };
        let owner = self.current_coop_setup.as_mut().ok_or(GameKernelV7Error::Invalid)?;
        if self.role == GameKernelRoleV7::Replica && bootstrap.stage == RunBootstrapStageV1::WaitingForPartner && owner.choices.is_none() {
            let choices = CurrentCoopChoicesV1 { context: owner.local.clone(), content: owner.content.clone(), seed: owner.seed.clone(),
                mode: bootstrap.selections.mode.ok_or(GameKernelV7Error::Invalid)?, starters: bootstrap.selections.starters.clone() };
            validate_choices(&choices, owner, self.content.as_ref())?;
            owner.choices = Some(choices);
            return self.retry_current_coop_setup();
        }
        if self.role == GameKernelRoleV7::Authority && bootstrap.stage == RunBootstrapStageV1::Complete && owner.choices.is_some() {
            let bootstrap = bootstrap.clone();
            let host = bootstrap.selections.clone();
            let mut step = self.complete_bootstrap_run(bootstrap)?;
            let owner = self.current_coop_setup.as_mut().ok_or(GameKernelV7Error::Invalid)?;
            let mut count = 0;
            for effect in &mut step.effects {
                if let GameKernelEffectV7::AuthorityMaterial { operation_id, bytes } = effect {
                    if operation_id.as_str() != OPERATION { return Err(GameKernelV7Error::Invalid); }
                    let frame = CurrentCoopFrameV1::CurrentCoopStarted { authority: owner.local.clone(),
                        choices: owner.choices.clone().ok_or(GameKernelV7Error::Invalid)?, host: host.clone(), material_hex: current_bytes_hex_v1(bytes) };
                    validate_started(&frame, owner, self.content.as_ref())?;
                    *bytes = encode(&frame, MAX_OWNER_BYTES)?;
                    owner.started = Some(frame);
                    count += 1;
                }
            }
            if count != 1 { return Err(GameKernelV7Error::Invalid); }
            return Ok(step);
        }
        Ok(GameKernelStepV7 { effects: vec![GameKernelEffectV7::UiChanged(bootstrap.control.clone())], internal_events: Vec::new() })
    }

    pub(super) fn ingest_coop_setup(&mut self, generation: ConnectionGeneration, bytes: &[u8]) -> Result<GameKernelStepV7> {
        self.validate_current_network_pair(generation)?;
        let frame = decode(bytes)?;
        let mut candidate = self.clone();
        let owner = candidate.current_coop_setup.as_mut().ok_or(GameKernelV7Error::Invalid)?;
        let step = match (&self.role, &frame) {
            (GameKernelRoleV7::Authority, CurrentCoopFrameV1::CurrentCoopChoices { choices }) => {
                encode(&frame, MAX_CHOICES_BYTES)?;
                validate_choices(choices, owner, self.content.as_ref())?;
                if let Some(previous) = &owner.choices {
                    if previous != choices { return Err(GameKernelV7Error::Invalid); }
                    return self.retry_current_coop_setup();
                }
                owner.choices = Some(choices.clone());
                candidate.advance_replay_sequence()?;
                candidate.advance_coop_bootstrap()?
            }
            (GameKernelRoleV7::Replica, CurrentCoopFrameV1::CurrentCoopStarted { .. }) => {
                let material = validate_started(&frame, owner, self.content.as_ref())?;
                if let Some(previous) = &owner.started {
                    if previous != &frame { return Err(GameKernelV7Error::Invalid); }
                    return Ok(GameKernelStepV7::default());
                }
                if !matches!(&candidate.lifecycle, GameKernelLifecycleV7::Bootstrap(bootstrap) if bootstrap.stage == RunBootstrapStageV1::WaitingForPartner) {
                    return Err(GameKernelV7Error::Invalid);
                }
                owner.started = Some(frame.clone());
                candidate.lifecycle = GameKernelLifecycleV7::Active(GameRuntimeV6::new_with_retention(None, candidate.content.clone(), safe_one(), MATERIAL_RETENTION_V7).map_err(runtime_error)?);
                candidate.apply_authority_material(&material)?
            }
            _ => return Err(GameKernelV7Error::Invalid),
        };
        candidate.validate()?;
        *self = candidate;
        Ok(step)
    }
}
