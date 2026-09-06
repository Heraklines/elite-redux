//! Bounded current-only proposal identity and independently bound material receipts.
//! No historical lease, timer, reply cache or platform-effect ownership lives here.

use er_canonical::{canonical_bytes, content_digest, fixture_digest};
use er_game::m9e_content_v2::PreparedGameContentV2;
use er_game::m9e_material_v6::{GameMaterialV6, game_state_digest};
use er_protocol::{EndpointRole, ProtocolRuntimeSnapshotV2};
use er_types::battle_ids::MenuInstanceId;
use er_types::{
    FrameContext, GameContentIdentityV2, GameRunId, OperationId, SafeU53, SeatId, TransportState,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::game_kernel_v7::GameProposalEnvelopeV2;
use crate::snapshot::KernelSchedulerSnapshotV2;
use crate::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7};

pub const MAX_CURRENT_PROPOSAL_BYTES_V1: usize = 16_384;
pub const MAX_CURRENT_RECEIPT_MATERIAL_BYTES_V1: usize = 458_752;
pub const MAX_CURRENT_RECEIPT_BYTES_V1: usize = 1_048_576;
pub const MAX_RETAINED_CURRENT_PROPOSAL_BYTES_V1: usize = 49_152;
pub const MAX_CURRENT_PROPOSAL_OWNER_BYTES_V1: usize = 65_536;

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("current proposal identity, receipt, bound or ownership is invalid")]
pub struct CurrentProposalErrorV1;

type Result<T> = std::result::Result<T, CurrentProposalErrorV1>;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetainedCurrentProposalV1 {
    pub schema_version: u32,
    pub proposal_hex: String,
    pub proposal_digest: String,
    #[serde(deserialize_with = "deserialize_current_frame_context")]
    pub publication_context: FrameContext,
    #[serde(deserialize_with = "deserialize_current_frame_context")]
    pub authority_peer_context: FrameContext,
    pub publication_content_identity: GameContentIdentityV2,
    pub publication_game_run_id: GameRunId,
    pub publication_before_digest: String,
    pub publication_next_authority_revision: SafeU53,
    pub publication_menu_highwater: MenuInstanceId,
    pub publication_replay_sequence: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TerminalAbandonedCurrentProposalV1 {
    pub retained: RetainedCurrentProposalV1,
    pub terminal_id: String,
    pub terminal_reason: String,
    pub terminal_operation_id: OperationId,
    pub terminal_material_fingerprint: String,
    pub terminal_authority_revision: SafeU53,
    pub terminal_after_digest: String,
    pub abandonment_replay_sequence: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", deny_unknown_fields)]
pub enum CurrentProposalOwnerSnapshotV1 {
    Pending {
        retained: Box<RetainedCurrentProposalV1>,
    },
    TerminalAbandoned {
        audit: Box<TerminalAbandonedCurrentProposalV1>,
    },
}

impl CurrentProposalOwnerSnapshotV1 {
    pub fn retained(&self) -> &RetainedCurrentProposalV1 {
        match self {
            Self::Pending { retained } => retained,
            Self::TerminalAbandoned { audit } => &audit.retained,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CurrentReceiptKindV1 {
    CurrentProposalMaterialReceipt,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentProposalMaterialReceiptV1 {
    pub kind: CurrentReceiptKindV1,
    pub schema_version: u32,
    pub proposal_hex: String,
    pub proposal_digest: String,
    #[serde(deserialize_with = "deserialize_current_frame_context")]
    pub authority_context: FrameContext,
    pub material_hex: String,
    pub material_digest: String,
    pub material_fingerprint: String,
}

fn deserialize_current_frame_context<'de, D>(
    deserializer: D,
) -> std::result::Result<FrameContext, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct StrictContext {
        session_id: er_types::SessionId,
        run_id: er_types::RunId,
        session_epoch: SafeU53,
        seat_map_id: String,
        membership_revision: er_types::MembershipRevision,
        sender_seat_id: SeatId,
        authority_seat_id: SeatId,
        connection_generation: er_types::ConnectionGeneration,
    }
    let value = StrictContext::deserialize(deserializer)?;
    Ok(FrameContext {
        session_id: value.session_id,
        run_id: value.run_id,
        session_epoch: value.session_epoch,
        seat_map_id: value.seat_map_id,
        membership_revision: value.membership_revision,
        sender_seat_id: value.sender_seat_id,
        authority_seat_id: value.authority_seat_id,
        connection_generation: value.connection_generation,
    })
}
pub struct DecodedCurrentReceiptV1 {
    pub proposal: GameProposalEnvelopeV2,
    pub proposal_bytes: Vec<u8>,
    pub material: GameMaterialV6,
    pub material_bytes: Vec<u8>,
}

pub fn json_bytes_sha256_v1(bytes: &[u8]) -> Result<String> {
    fixture_digest(&bytes)
        .map(|digest| format!("sha256-json-bytes-v1:{digest}"))
        .map_err(|_| CurrentProposalErrorV1)
}

pub fn current_material_fingerprint_v1(bytes: &[u8]) -> Result<String> {
    content_digest(&bytes)
        .map(|digest| format!("blake3-v1:{digest}"))
        .map_err(|_| CurrentProposalErrorV1)
}

pub fn current_bytes_hex_v1(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 15)]));
    }
    encoded
}

pub fn decode_current_hex_v1(value: &str, maximum: usize) -> Result<Vec<u8>> {
    if value.is_empty() || value.len() > maximum * 2 || !value.len().is_multiple_of(2) {
        return Err(CurrentProposalErrorV1);
    }
    fn nibble(value: u8) -> Result<u8> {
        match value {
            b'0'..=b'9' => Ok(value - b'0'),
            b'a'..=b'f' => Ok(value - b'a' + 10),
            _ => Err(CurrentProposalErrorV1),
        }
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| Ok(nibble(pair[0])? * 16 + nibble(pair[1])?))
        .collect()
}

pub fn decode_current_proposal_v1(bytes: &[u8]) -> Result<GameProposalEnvelopeV2> {
    if bytes.is_empty() || bytes.len() > MAX_CURRENT_PROPOSAL_BYTES_V1 {
        return Err(CurrentProposalErrorV1);
    }
    let proposal: GameProposalEnvelopeV2 =
        serde_json::from_slice(bytes).map_err(|_| CurrentProposalErrorV1)?;
    if proposal.schema_version != 2
        || canonical_bytes(&proposal).map_err(|_| CurrentProposalErrorV1)? != bytes
    {
        return Err(CurrentProposalErrorV1);
    }
    proposal
        .proposal
        .validate()
        .map_err(|_| CurrentProposalErrorV1)?;
    Ok(proposal)
}

impl CurrentProposalMaterialReceiptV1 {
    pub fn from_admission(
        proposal_bytes: &[u8],
        material_bytes: &[u8],
        authority_context: FrameContext,
    ) -> Result<Self> {
        if proposal_bytes.len() > MAX_CURRENT_PROPOSAL_BYTES_V1
            || material_bytes.len() > MAX_CURRENT_RECEIPT_MATERIAL_BYTES_V1
        {
            return Err(CurrentProposalErrorV1);
        }
        let receipt = Self {
            kind: CurrentReceiptKindV1::CurrentProposalMaterialReceipt,
            schema_version: 1,
            proposal_hex: current_bytes_hex_v1(proposal_bytes),
            proposal_digest: json_bytes_sha256_v1(proposal_bytes)?,
            authority_context,
            material_hex: current_bytes_hex_v1(material_bytes),
            material_digest: json_bytes_sha256_v1(material_bytes)?,
            material_fingerprint: current_material_fingerprint_v1(material_bytes)?,
        };
        receipt.evidence()?;
        receipt.canonical_bytes()?;
        Ok(receipt)
    }

    pub fn canonical_bytes(&self) -> Result<Vec<u8>> {
        let bytes = canonical_bytes(self).map_err(|_| CurrentProposalErrorV1)?;
        if bytes.len() > MAX_CURRENT_RECEIPT_BYTES_V1 {
            return Err(CurrentProposalErrorV1);
        }
        Ok(bytes)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self> {
        if bytes.is_empty() || bytes.len() > MAX_CURRENT_RECEIPT_BYTES_V1 {
            return Err(CurrentProposalErrorV1);
        }
        let receipt: Self = serde_json::from_slice(bytes).map_err(|_| CurrentProposalErrorV1)?;
        // Canonical equality rejects unknown nested historical FrameContext keys too.
        if receipt.canonical_bytes()? != bytes {
            return Err(CurrentProposalErrorV1);
        }
        receipt.evidence()?;
        Ok(receipt)
    }

    pub fn evidence(&self) -> Result<DecodedCurrentReceiptV1> {
        let proposal_bytes =
            decode_current_hex_v1(&self.proposal_hex, MAX_CURRENT_PROPOSAL_BYTES_V1)?;
        let material_bytes =
            decode_current_hex_v1(&self.material_hex, MAX_CURRENT_RECEIPT_MATERIAL_BYTES_V1)?;
        let proposal = decode_current_proposal_v1(&proposal_bytes)?;
        let material =
            GameMaterialV6::decode(&material_bytes).map_err(|_| CurrentProposalErrorV1)?;
        let transition = material.transition();
        let context = &proposal.proposal.context;
        if self.schema_version != 1
            || self.proposal_digest != json_bytes_sha256_v1(&proposal_bytes)?
            || self.material_digest != json_bytes_sha256_v1(&material_bytes)?
            || self.material_fingerprint != current_material_fingerprint_v1(&material_bytes)?
            || transition.operation_id != context.operation_id
            || transition.authority_seat != context.authority_seat
            || transition.authority_revision != context.authority_revision
            || transition.accepted_action.as_ref() != Some(&proposal.proposal.action)
            || self.authority_context.sender_seat_id != context.authority_seat
            || self.authority_context.authority_seat_id != context.authority_seat
            || self.authority_context.connection_generation != proposal.connection_generation
            || proposal.connection_generation.get()
                != SafeU53::new(1).map_err(|_| CurrentProposalErrorV1)?
            || proposal.sender_seat == context.authority_seat
        {
            return Err(CurrentProposalErrorV1);
        }
        Ok(DecodedCurrentReceiptV1 {
            proposal,
            proposal_bytes,
            material,
            material_bytes,
        })
    }
}

/// Stable identity only. Disconnected/Connecting and unrelated scheduler pauses
/// must not invalidate a retained owner or its snapshot.
pub fn validate_current_pair_v1(
    protocol: &ProtocolRuntimeSnapshotV2,
    local_seat: SeatId,
    role: EndpointRole,
    require_connected: bool,
) -> Result<()> {
    protocol.validate().map_err(|_| CurrentProposalErrorV1)?;
    let local = &protocol.frame_context.context;
    let peer = protocol
        .peer_identity
        .peer
        .as_ref()
        .ok_or(CurrentProposalErrorV1)?;
    let [connection] = protocol.connections.as_slice() else {
        return Err(CurrentProposalErrorV1);
    };
    let one = SafeU53::new(1).map_err(|_| CurrentProposalErrorV1)?;
    let mut expected_peer = local.clone();
    expected_peer.sender_seat_id = peer.sender_seat_id;
    if protocol.disposed
        || protocol.role != role
        || local != &protocol.peer_identity.local
        || local.sender_seat_id != local_seat
        || peer != &expected_peer
        || peer.sender_seat_id == local_seat
        || connection.peer_seat != peer.sender_seat_id
        || local.connection_generation.get() != one
        || connection.generation.get() != one
        || !protocol.staged_rebinds.is_empty()
        || protocol.authority_rebind_pending
        || (require_connected && connection.state != TransportState::Connected)
        || match role {
            EndpointRole::Authority => local.authority_seat_id != local_seat,
            EndpointRole::Replica => local.authority_seat_id != peer.sender_seat_id,
        }
    {
        return Err(CurrentProposalErrorV1);
    }
    Ok(())
}

pub fn validate_current_proposal_quiescence_v1(
    protocol: Option<&ProtocolRuntimeSnapshotV2>,
    scheduler: &KernelSchedulerSnapshotV2,
) -> Result<()> {
    if let Some(leases) = protocol.and_then(|value| value.proposal_leases.as_ref())
        && (leases.disposed
            || !leases.leases.is_empty()
            || !leases.timer_targets.is_empty()
            || scheduler.timers.iter().any(|timer| {
                timer
                    .registration
                    .owner
                    .owner_id
                    .starts_with(&leases.config.owner_prefix)
            }))
    {
        return Err(CurrentProposalErrorV1);
    }
    if scheduler.timers.iter().any(|timer| {
        matches!(
            timer.registration.owner.reason.as_str(),
            "v2 proposal retry" | "v2 proposal absolute ceiling"
        )
    }) {
        return Err(CurrentProposalErrorV1);
    }
    Ok(())
}

fn valid_state_digest(value: &str) -> bool {
    value.strip_prefix("blake3-v1:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

pub fn validate_current_owner_snapshot_v1(
    snapshot: &CoreGameKernelSnapshotV7,
    content: &PreparedGameContentV2,
) -> Result<()> {
    let Some(owner) = &snapshot.current_proposal else {
        return Ok(());
    };
    if canonical_bytes(owner)
        .map_err(|_| CurrentProposalErrorV1)?
        .len()
        > MAX_CURRENT_PROPOSAL_OWNER_BYTES_V1
    {
        return Err(CurrentProposalErrorV1);
    }
    let retained = owner.retained();
    let protocol = snapshot.protocol.as_ref().ok_or(CurrentProposalErrorV1)?;
    validate_current_pair_v1(
        protocol,
        retained.publication_context.sender_seat_id,
        EndpointRole::Replica,
        false,
    )?;
    validate_current_proposal_quiescence_v1(Some(protocol), &snapshot.scheduler)?;
    let bytes = decode_current_hex_v1(&retained.proposal_hex, MAX_CURRENT_PROPOSAL_BYTES_V1)?;
    let envelope = decode_current_proposal_v1(&bytes)?;
    let state = match (&snapshot.lifecycle, owner) {
        (
            GameKernelLifecycleSnapshotV7::Active(state),
            CurrentProposalOwnerSnapshotV1::Pending { .. },
        ) => state,
        (
            GameKernelLifecycleSnapshotV7::Terminal {
                state, terminal, ..
            },
            CurrentProposalOwnerSnapshotV1::TerminalAbandoned { audit },
        ) => {
            if audit.terminal_id != terminal.terminal_id
                || audit.terminal_reason != terminal.reason
                || audit.abandonment_replay_sequence < retained.publication_replay_sequence
                || audit.abandonment_replay_sequence > snapshot.replay_sequence
                || !snapshot
                    .material_ledger
                    .records
                    .last()
                    .is_some_and(|record| {
                        record.operation_id == audit.terminal_operation_id
                            && record.material_fingerprint == audit.terminal_material_fingerprint
                            && record.authority_revision == audit.terminal_authority_revision
                            && record.after_digest == audit.terminal_after_digest
                            && record.authority_revision.get().checked_add(1)
                                == Some(snapshot.material_ledger.next_authority_revision.get())
                            && game_state_digest(state)
                                .is_ok_and(|digest| digest == record.after_digest)
                    })
            {
                return Err(CurrentProposalErrorV1);
            }
            state
        }
        _ => return Err(CurrentProposalErrorV1),
    };
    let run = state.active_run.as_ref().ok_or(CurrentProposalErrorV1)?;
    if retained.schema_version != 1
        || canonical_bytes(retained)
            .map_err(|_| CurrentProposalErrorV1)?
            .len()
            > MAX_RETAINED_CURRENT_PROPOSAL_BYTES_V1
        || retained.proposal_digest != json_bytes_sha256_v1(&bytes)?
        || retained.publication_context != protocol.frame_context.context
        || Some(&retained.authority_peer_context) != protocol.peer_identity.peer.as_ref()
        || envelope.sender_seat != retained.publication_context.sender_seat_id
        || envelope.connection_generation != retained.publication_context.connection_generation
        || envelope.proposal.context.authority_seat
            != retained.authority_peer_context.sender_seat_id
        || &retained.publication_content_identity != content.identity()
        || retained.publication_game_run_id != run.run_id
        || !valid_state_digest(&retained.publication_before_digest)
        || envelope.proposal.context.menu_instance >= retained.publication_menu_highwater
        || retained.publication_menu_highwater > snapshot.next_menu_instance_id
        || retained.publication_replay_sequence == SafeU53::ZERO
        || retained.publication_replay_sequence > snapshot.replay_sequence
        || retained.publication_next_authority_revision
            != envelope.proposal.context.authority_revision
        || retained.publication_next_authority_revision
            > snapshot.material_ledger.next_authority_revision
        || protocol.proposal_leases.as_ref().is_some_and(|leases| {
            leases
                .committed_tombstones
                .contains(&envelope.proposal.context.operation_id)
        })
    {
        return Err(CurrentProposalErrorV1);
    }
    if retained.publication_next_authority_revision
        == snapshot.material_ledger.next_authority_revision
    {
        let mut canonical_state = state.clone();
        if let Some(private) = &snapshot.private_battle_control {
            canonical_state
                .active_run
                .as_mut()
                .ok_or(CurrentProposalErrorV1)?
                .control = private.canonical_control.clone();
        }
        if game_state_digest(&canonical_state).map_err(|_| CurrentProposalErrorV1)?
            != retained.publication_before_digest
        {
            return Err(CurrentProposalErrorV1);
        }
    } else if let Some(anchor) = snapshot.material_ledger.records.iter().find(|record| {
        record.authority_revision.get().checked_add(1)
            == Some(retained.publication_next_authority_revision.get())
    }) && anchor.after_digest != retained.publication_before_digest
    {
        return Err(CurrentProposalErrorV1);
    }
    Ok(())
}
