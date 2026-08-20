//! Correlated retained-tail proof state shared by every Authority V2 kernel.
//!
//! This owner is deliberately clock-free. The authority freezes successful
//! responses behind a per-peer sequence fence, while the replica parks one
//! exact boundary candidate until a manifest, its listed source entries, and
//! the matching completion frame have all arrived.

use std::collections::{BTreeMap, BTreeSet};

use er_canonical::canonicalize_value;
use er_types::battle_ids::CanonicalHexBytes;
use er_types::{
    AuthorityEntry, AuthorityEntryKind, ConnectionGeneration, FrameContext, Material, NextControl,
    OperationId, Revision, SafeU53, SeatId, TAIL_PROOF_MAX_SOURCE_REVISIONS, TailProofBody,
    TailProofPhase, TailRequestBody, validate_authority_operation_id,
};
use serde_json::Value;

use crate::snapshot::{
    AuthorityEntryIdentitySnapshotV2, OpaqueAuthorityEntrySnapshotV2, SnapshotError,
    TailProofAuthorityResponseSnapshotV2, TailProofAuthoritySnapshotV2,
    TailProofPeerHighWaterSnapshotV2, TailProofReplicaCaptureSnapshotV2,
    TailProofReplicaSnapshotV2,
};
use crate::{control_id_of, frame_contexts_compatible};

const FNV1A32_OFFSET: u32 = 0x811c_9dc5;
const FNV1A32_PRIME: u32 = 0x0100_0193;

#[derive(Clone, Debug, PartialEq)]
pub enum TailProofAuthorityEmission {
    Proof {
        context: FrameContext,
        body: TailProofBody,
    },
    Source {
        entry: AuthorityEntry,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TailProofEntryCapture {
    Inactive,
    Parked {
        missing_from: Revision,
        redrive_request: Option<TailRequestBody>,
    },
    Rejected {
        reason: String,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub enum TailProofFrameDisposition {
    Ignored { reason: String },
    Pending,
    Ready { candidate: Box<AuthorityEntry> },
    Rejected { reason: String },
}

#[derive(Clone, Debug, PartialEq)]
struct FrozenAuthorityResponse {
    requester_seat: SeatId,
    sequence: SafeU53,
    request_context: FrameContext,
    authority_context: FrameContext,
    manifest: TailProofBody,
    sources: Vec<AuthorityEntry>,
    complete: TailProofBody,
}

impl FrozenAuthorityResponse {
    fn emissions(&self) -> Vec<TailProofAuthorityEmission> {
        let mut emissions = Vec::with_capacity(self.sources.len().saturating_add(2));
        emissions.push(TailProofAuthorityEmission::Proof {
            context: self.authority_context.clone(),
            body: self.manifest.clone(),
        });
        emissions.extend(
            self.sources
                .iter()
                .cloned()
                .map(|entry| TailProofAuthorityEmission::Source { entry }),
        );
        emissions.push(TailProofAuthorityEmission::Proof {
            context: self.authority_context.clone(),
            body: self.complete.clone(),
        });
        emissions
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct TailProofAuthorityState {
    retired_sources: BTreeMap<Revision, AuthorityEntry>,
    responses: BTreeMap<(SeatId, OperationId), FrozenAuthorityResponse>,
    request_high_water: BTreeMap<SeatId, SafeU53>,
}

pub(crate) struct TailProofRequestContext<'a> {
    pub(crate) request_context: &'a FrameContext,
    pub(crate) authority_context: &'a FrameContext,
    pub(crate) request: &'a TailRequestBody,
    pub(crate) candidate: Option<&'a AuthorityEntry>,
    pub(crate) live_sources: &'a [AuthorityEntry],
    pub(crate) head_revision: Revision,
    pub(crate) capacity: SafeU53,
}

impl TailProofAuthorityState {
    pub(crate) fn handle_request(
        &mut self,
        context: TailProofRequestContext<'_>,
    ) -> Vec<TailProofAuthorityEmission> {
        let TailProofRequestContext {
            request_context,
            authority_context,
            request,
            candidate,
            live_sources,
            head_revision,
            capacity,
        } = context;
        let (Some(request_id), Some(candidate_revision), Some(candidate_operation_id)) = (
            request.request_id.as_ref(),
            request.candidate_revision,
            request.candidate_operation_id.as_ref(),
        ) else {
            return Vec::new();
        };
        if candidate_revision <= request.from_revision {
            return Vec::new();
        }
        let Some(candidate) = candidate else {
            return Vec::new();
        };
        if candidate.revision != candidate_revision
            || candidate.operation_id != *candidate_operation_id
            || candidate.context != *authority_context
            || canonical_tail_proof_floor(candidate) != Some(request.from_revision)
        {
            return Vec::new();
        }
        let Some(sequence) = parse_request_sequence(request_context, request_id) else {
            return Vec::new();
        };
        let key = (request_context.sender_seat_id, request_id.clone());
        if let Some(cached) = self.responses.get(&key) {
            let exact = cached.request_context == *request_context
                && cached.authority_context == *authority_context
                && cached.manifest.from_revision == request.from_revision
                && cached.manifest.candidate_revision == candidate_revision
                && cached.manifest.candidate_operation_id == *candidate_operation_id;
            return if exact {
                cached.emissions()
            } else {
                Vec::new()
            };
        }

        let Some(sources) = self.capture_sources(
            request.from_revision,
            candidate_revision,
            authority_context,
            live_sources,
            capacity,
        ) else {
            return Vec::new();
        };
        let Some(predecessor_revision) = previous_revision(candidate_revision) else {
            return Vec::new();
        };
        let Some(predecessor) = sources
            .iter()
            .find(|entry| entry.revision == predecessor_revision)
        else {
            return Vec::new();
        };
        let source_revisions = sources
            .iter()
            .map(|entry| entry.revision)
            .collect::<Vec<_>>();
        if !boundary_supersession_allows(predecessor, candidate, &sources) {
            return Vec::new();
        }

        let high_water = self
            .request_high_water
            .get(&request_context.sender_seat_id)
            .copied()
            .unwrap_or(SafeU53::ZERO);
        let Some(expected_sequence) = next_safe(high_water) else {
            return Vec::new();
        };
        let response_capacity = usize::try_from(capacity.get()).unwrap_or(usize::MAX);
        if sequence != expected_sequence || self.responses.len() >= response_capacity {
            return Vec::new();
        }

        let proof_base = TailProofBody {
            phase: TailProofPhase::Manifest,
            request_id: request_id.clone(),
            from_revision: request.from_revision,
            candidate_revision,
            candidate_operation_id: candidate_operation_id.clone(),
            head_revision,
            source_revisions,
        };
        let mut complete = proof_base.clone();
        complete.phase = TailProofPhase::Complete;
        let response = FrozenAuthorityResponse {
            requester_seat: request_context.sender_seat_id,
            sequence,
            request_context: request_context.clone(),
            authority_context: authority_context.clone(),
            manifest: proof_base,
            sources,
            complete,
        };
        let emissions = response.emissions();
        self.responses.insert(key, response);
        self.request_high_water
            .insert(request_context.sender_seat_id, sequence);
        emissions
    }

    pub(crate) fn archive_retired(&mut self, entry: &AuthorityEntry, capacity: SafeU53) -> bool {
        if let Some(prior) = self.retired_sources.get(&entry.revision) {
            return prior == entry;
        }
        let capacity = usize::try_from(capacity.get())
            .unwrap_or(usize::MAX)
            .min(TAIL_PROOF_MAX_SOURCE_REVISIONS);
        while self.retired_sources.len() >= capacity {
            let Some(oldest) = self.retired_sources.keys().next().copied() else {
                break;
            };
            self.retired_sources.remove(&oldest);
        }
        if capacity > 0 {
            self.retired_sources.insert(entry.revision, entry.clone());
        }
        true
    }

    pub(crate) fn release_candidate(&mut self, candidate_revision: Revision) {
        self.release_responses_for_candidate(candidate_revision);
    }

    pub(crate) fn rebind(&mut self, authority_context: &FrameContext) {
        for entry in self.retired_sources.values_mut() {
            entry.context = authority_context.clone();
        }
        self.responses.clear();
        self.request_high_water.clear();
    }

    pub(crate) fn clear(&mut self) {
        self.retired_sources.clear();
        self.responses.clear();
        self.request_high_water.clear();
    }

    pub(crate) fn retired_source_count(&self) -> usize {
        self.retired_sources.len()
    }

    pub(crate) fn response_count(&self) -> usize {
        self.responses.len()
    }

    pub(crate) fn snapshot_v2(&self) -> Result<TailProofAuthoritySnapshotV2, SnapshotError> {
        let retired_sources = self
            .retired_sources
            .values()
            .map(|entry| opaque_entry_snapshot(entry, "authority_log.tail_proof.retired_sources"))
            .collect::<Result<Vec<_>, _>>()?;
        let responses = self
            .responses
            .values()
            .map(|response| {
                Ok(TailProofAuthorityResponseSnapshotV2 {
                    requester_seat: response.requester_seat,
                    sequence: response.sequence,
                    request_context: response.request_context.clone(),
                    authority_context: response.authority_context.clone(),
                    manifest: response.manifest.clone(),
                    sources: response
                        .sources
                        .iter()
                        .map(|entry| {
                            opaque_entry_snapshot(
                                entry,
                                "authority_log.tail_proof.responses.sources",
                            )
                        })
                        .collect::<Result<Vec<_>, _>>()?,
                    complete: response.complete.clone(),
                })
            })
            .collect::<Result<Vec<_>, SnapshotError>>()?;
        let request_high_water = self
            .request_high_water
            .iter()
            .map(|(seat, sequence)| TailProofPeerHighWaterSnapshotV2 {
                seat: *seat,
                sequence: *sequence,
            })
            .collect();
        Ok(TailProofAuthoritySnapshotV2 {
            retired_sources,
            responses,
            request_high_water,
        })
    }

    pub(crate) fn from_snapshot_v2(
        snapshot: &TailProofAuthoritySnapshotV2,
        authority_context: &FrameContext,
        peer_bindings: &BTreeMap<SeatId, ConnectionGeneration>,
        capacity: SafeU53,
        head_revision: Revision,
        live_entries: &BTreeMap<Revision, AuthorityEntry>,
    ) -> Result<Self, SnapshotError> {
        let capacity_usize = usize::try_from(capacity.get()).unwrap_or(usize::MAX);
        if snapshot.retired_sources.len() > capacity_usize
            || snapshot.responses.len() > capacity_usize
            || snapshot.retired_sources.len() > TAIL_PROOF_MAX_SOURCE_REVISIONS
        {
            return Err(snapshot_invalid(
                "authority_log.tail_proof",
                "retired source or response count exceeds the configured capacity",
            ));
        }

        let mut retired_sources = BTreeMap::new();
        for source in &snapshot.retired_sources {
            let entry = decode_entry_snapshot(source, "authority_log.tail_proof.retired_sources")?;
            if entry.context != *authority_context
                || retired_sources.insert(entry.revision, entry).is_some()
            {
                return Err(snapshot_invalid(
                    "authority_log.tail_proof.retired_sources",
                    "retired sources must be unique and use the current authority context",
                ));
            }
        }

        let mut request_high_water = BTreeMap::new();
        for high_water in &snapshot.request_high_water {
            if high_water.sequence == SafeU53::ZERO
                || !peer_bindings.contains_key(&high_water.seat)
                || request_high_water
                    .insert(high_water.seat, high_water.sequence)
                    .is_some()
            {
                return Err(snapshot_invalid(
                    "authority_log.tail_proof.request_high_water",
                    "request high-water entries must be positive, unique, and peer-bound",
                ));
            }
        }

        let mut responses = BTreeMap::new();
        for response in &snapshot.responses {
            let Some(binding_generation) = peer_bindings.get(&response.requester_seat) else {
                return Err(snapshot_invalid(
                    "authority_log.tail_proof.responses.requester_seat",
                    "response requester is not an authenticated peer",
                ));
            };
            if !authenticated_request_context(
                &response.request_context,
                authority_context,
                response.requester_seat,
                *binding_generation,
            ) || response.authority_context != *authority_context
                || response.manifest.phase != TailProofPhase::Manifest
                || response.complete.phase != TailProofPhase::Complete
                || !same_proof_metadata(&response.manifest, &response.complete)
                || !valid_tail_proof_body(&response.manifest, capacity)
                || parse_request_sequence(&response.request_context, &response.manifest.request_id)
                    != Some(response.sequence)
                || request_high_water
                    .get(&response.requester_seat)
                    .is_none_or(|high_water| response.sequence > *high_water)
            {
                return Err(snapshot_invalid(
                    "authority_log.tail_proof.responses",
                    "response metadata, context, or sequence is invalid",
                ));
            }
            let sources = response
                .sources
                .iter()
                .map(|source| {
                    decode_entry_snapshot(source, "authority_log.tail_proof.responses.sources")
                })
                .collect::<Result<Vec<_>, _>>()?;
            if sources
                .iter()
                .any(|entry| entry.context != *authority_context)
                || sources
                    .iter()
                    .map(|entry| entry.revision)
                    .collect::<Vec<_>>()
                    != response.manifest.source_revisions
            {
                return Err(snapshot_invalid(
                    "authority_log.tail_proof.responses.sources",
                    "frozen response sources differ from their manifest",
                ));
            }
            let Some(candidate) = live_entries.get(&response.manifest.candidate_revision) else {
                return Err(snapshot_invalid(
                    "authority_log.tail_proof.responses.candidate_revision",
                    "frozen response candidate is no longer live",
                ));
            };
            let predecessor = previous_revision(candidate.revision)
                .and_then(|revision| sources.iter().find(|entry| entry.revision == revision));
            if candidate.operation_id != response.manifest.candidate_operation_id
                || candidate.context != *authority_context
                || canonical_tail_proof_floor(candidate) != Some(response.manifest.from_revision)
                || response.manifest.head_revision > head_revision
                || predecessor.is_none_or(|predecessor| {
                    !boundary_supersession_allows(predecessor, candidate, &sources)
                })
            {
                return Err(snapshot_invalid(
                    "authority_log.tail_proof.responses.candidate_operation_id",
                    "frozen response conflicts with its live candidate or exact source proof",
                ));
            }
            let key = (
                response.requester_seat,
                response.manifest.request_id.clone(),
            );
            if responses
                .insert(
                    key,
                    FrozenAuthorityResponse {
                        requester_seat: response.requester_seat,
                        sequence: response.sequence,
                        request_context: response.request_context.clone(),
                        authority_context: response.authority_context.clone(),
                        manifest: response.manifest.clone(),
                        sources,
                        complete: response.complete.clone(),
                    },
                )
                .is_some()
            {
                return Err(snapshot_invalid(
                    "authority_log.tail_proof.responses",
                    "response keys must be unique",
                ));
            }
        }

        Ok(Self {
            retired_sources,
            responses,
            request_high_water,
        })
    }

    fn capture_sources(
        &self,
        from_revision: Revision,
        candidate_revision: Revision,
        authority_context: &FrameContext,
        live_sources: &[AuthorityEntry],
        capacity: SafeU53,
    ) -> Option<Vec<AuthorityEntry>> {
        let mut sources = BTreeMap::new();
        for entry in self.retired_sources.values().chain(live_sources) {
            if entry.revision < from_revision || entry.revision >= candidate_revision {
                continue;
            }
            if entry.context != *authority_context {
                return None;
            }
            if let Some(prior) = sources.get(&entry.revision) {
                if prior != entry {
                    return None;
                }
                continue;
            }
            sources.insert(entry.revision, entry.clone());
        }
        let local_capacity = usize::try_from(capacity.get()).ok()?;
        if sources.len() > local_capacity || sources.len() > TAIL_PROOF_MAX_SOURCE_REVISIONS {
            return None;
        }
        Some(sources.into_values().collect())
    }

    fn release_responses_for_candidate(&mut self, candidate_revision: Revision) {
        self.responses
            .retain(|_, response| response.manifest.candidate_revision != candidate_revision);
    }
}

#[derive(Clone, Debug)]
struct ReplicaCapture {
    candidate: AuthorityEntry,
    predecessor_identity: AuthorityEntryIdentitySnapshotV2,
    from_revision: Revision,
    request_id: OperationId,
    request_context: FrameContext,
    authority_context: FrameContext,
    manifest: Option<TailProofBody>,
    sources: BTreeMap<Revision, AuthorityEntry>,
}

impl ReplicaCapture {
    fn request(&self) -> TailRequestBody {
        TailRequestBody {
            from_revision: self.from_revision,
            request_id: Some(self.request_id.clone()),
            candidate_revision: Some(self.candidate.revision),
            candidate_operation_id: Some(self.candidate.operation_id.clone()),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct TailProofReplicaState {
    request_sequence: SafeU53,
    capture: Option<ReplicaCapture>,
    admission_candidate: Option<AuthorityEntry>,
}

impl TailProofReplicaState {
    pub(crate) fn begin(
        &mut self,
        candidate: &AuthorityEntry,
        predecessor: &AuthorityEntry,
        request_context: &FrameContext,
    ) -> Option<TailRequestBody> {
        if next_revision(predecessor.revision) != Some(candidate.revision)
            || !is_boundary_supersession_candidate(predecessor, candidate)
        {
            return None;
        }
        let from_revision = canonical_tail_proof_floor(candidate)?;
        let sequence = next_safe(self.request_sequence)?;
        let request_id = canonical_request_id(request_context, sequence)?;
        self.request_sequence = sequence;
        self.admission_candidate = None;
        self.capture = Some(ReplicaCapture {
            candidate: candidate.clone(),
            predecessor_identity: identity_snapshot(predecessor),
            from_revision,
            request_id,
            request_context: request_context.clone(),
            authority_context: candidate.context.clone(),
            manifest: None,
            sources: BTreeMap::new(),
        });
        self.capture.as_ref().map(ReplicaCapture::request)
    }

    pub(crate) fn capture_entry(
        &mut self,
        entry: &AuthorityEntry,
        capacity: SafeU53,
    ) -> TailProofEntryCapture {
        let Some(capture) = self.capture.as_mut() else {
            return TailProofEntryCapture::Inactive;
        };
        let missing_from = capture.from_revision;
        if entry.context != capture.authority_context {
            self.fail();
            return TailProofEntryCapture::Rejected {
                reason: "tail proof source context mismatch".to_owned(),
            };
        }
        if entry.revision == capture.candidate.revision {
            if entry != &capture.candidate {
                self.fail();
                return TailProofEntryCapture::Rejected {
                    reason: "tail proof candidate identity conflict".to_owned(),
                };
            }
            return TailProofEntryCapture::Parked {
                missing_from,
                redrive_request: Some(capture.request()),
            };
        }
        let Some(manifest) = capture.manifest.as_ref() else {
            self.fail();
            return TailProofEntryCapture::Rejected {
                reason: "tail proof source arrived before its manifest".to_owned(),
            };
        };
        let Some(source_index) = manifest
            .source_revisions
            .iter()
            .position(|revision| *revision == entry.revision)
        else {
            self.fail();
            return TailProofEntryCapture::Rejected {
                reason: "tail proof source is not listed by the active manifest".to_owned(),
            };
        };
        if let Some(prior) = capture.sources.get(&entry.revision) {
            if prior == entry {
                return TailProofEntryCapture::Parked {
                    missing_from,
                    redrive_request: None,
                };
            }
            self.fail();
            return TailProofEntryCapture::Rejected {
                reason: "tail proof duplicate source identity conflict".to_owned(),
            };
        }
        let local_capacity = usize::try_from(capacity.get()).unwrap_or(usize::MAX);
        if capture.sources.len() >= local_capacity
            || capture.sources.len() >= TAIL_PROOF_MAX_SOURCE_REVISIONS
        {
            self.fail();
            return TailProofEntryCapture::Rejected {
                reason: "tail proof source capacity exceeded".to_owned(),
            };
        }
        if source_index != capture.sources.len() {
            self.fail();
            return TailProofEntryCapture::Rejected {
                reason: "tail proof sources arrived out of manifest order".to_owned(),
            };
        }
        capture.sources.insert(entry.revision, entry.clone());
        TailProofEntryCapture::Parked {
            missing_from,
            redrive_request: None,
        }
    }

    pub(crate) fn accept_frame(
        &mut self,
        request_context: &FrameContext,
        authority_context: &FrameContext,
        body: &TailProofBody,
        capacity: SafeU53,
    ) -> TailProofFrameDisposition {
        let Some(capture) = self.capture.as_mut() else {
            return TailProofFrameDisposition::Ignored {
                reason: "no active tail proof request".to_owned(),
            };
        };
        if capture.request_context != *request_context
            || *authority_context != capture.authority_context
            || body.request_id != capture.request_id
            || body.from_revision != capture.from_revision
            || body.candidate_revision != capture.candidate.revision
            || body.candidate_operation_id != capture.candidate.operation_id
            || !valid_tail_proof_body(body, capacity)
        {
            self.fail();
            return TailProofFrameDisposition::Rejected {
                reason: "tail proof request, context, or body metadata mismatch".to_owned(),
            };
        }
        if body.phase == TailProofPhase::Manifest {
            if let Some(manifest) = capture.manifest.as_ref() {
                if !same_proof_metadata(manifest, body) {
                    self.fail();
                    return TailProofFrameDisposition::Rejected {
                        reason: "tail proof manifest metadata conflict".to_owned(),
                    };
                }
                return TailProofFrameDisposition::Pending;
            }
            capture.manifest = Some(body.clone());
            return TailProofFrameDisposition::Pending;
        }

        let Some(manifest) = capture.manifest.as_ref() else {
            self.fail();
            return TailProofFrameDisposition::Rejected {
                reason: "tail proof completed before its manifest".to_owned(),
            };
        };
        if !same_proof_metadata(manifest, body)
            || capture.sources.len() != manifest.source_revisions.len()
            || manifest
                .source_revisions
                .iter()
                .any(|revision| !capture.sources.contains_key(revision))
        {
            self.fail();
            return TailProofFrameDisposition::Rejected {
                reason: "tail proof completion metadata or source snapshot is incomplete"
                    .to_owned(),
            };
        }
        let predecessor_revision = capture.predecessor_identity.revision;
        let Some(predecessor) = capture.sources.get(&predecessor_revision) else {
            self.fail();
            return TailProofFrameDisposition::Rejected {
                reason: "tail proof predecessor is absent".to_owned(),
            };
        };
        if !entry_matches_identity(predecessor, &capture.predecessor_identity)
            || !manifest.source_revisions.contains(&predecessor_revision)
            || capture
                .candidate
                .subsumes
                .iter()
                .any(|revision| !manifest.source_revisions.contains(revision))
        {
            self.fail();
            return TailProofFrameDisposition::Rejected {
                reason: "tail proof omitted or conflicted with a required predecessor/source"
                    .to_owned(),
            };
        }
        let sources = capture.sources.values().cloned().collect::<Vec<_>>();
        if !sources
            .iter()
            .all(|entry| entry.context == capture.authority_context)
            || !boundary_supersession_allows(predecessor, &capture.candidate, &sources)
        {
            self.fail();
            return TailProofFrameDisposition::Rejected {
                reason: "tail proof exact boundary predicate rejected the snapshot".to_owned(),
            };
        }
        let candidate = capture.candidate.clone();
        self.capture = None;
        self.admission_candidate = Some(candidate.clone());
        TailProofFrameDisposition::Ready {
            candidate: Box::new(candidate),
        }
    }

    pub(crate) fn consume_admission(&mut self, candidate: &AuthorityEntry) -> bool {
        let Some(proven) = self.admission_candidate.as_ref() else {
            return false;
        };
        if proven == candidate {
            self.admission_candidate = None;
            true
        } else {
            if proven.revision == candidate.revision {
                self.admission_candidate = None;
            }
            false
        }
    }

    pub(crate) fn fail(&mut self) {
        self.capture = None;
        self.admission_candidate = None;
    }

    pub(crate) fn rebind(&mut self) {
        self.request_sequence = SafeU53::ZERO;
        self.fail();
    }

    pub(crate) fn clear(&mut self) {
        self.rebind();
    }

    pub(crate) fn snapshot_v2(&self) -> Result<TailProofReplicaSnapshotV2, SnapshotError> {
        let capture = self
            .capture
            .as_ref()
            .map(|capture| {
                Ok(TailProofReplicaCaptureSnapshotV2 {
                    candidate: opaque_entry_snapshot(
                        &capture.candidate,
                        "authority_replica.tail_proof.capture.candidate",
                    )?,
                    predecessor_identity: capture.predecessor_identity.clone(),
                    from_revision: capture.from_revision,
                    request_id: capture.request_id.clone(),
                    request_context: capture.request_context.clone(),
                    authority_context: capture.authority_context.clone(),
                    manifest: capture.manifest.clone(),
                    sources: capture
                        .sources
                        .values()
                        .map(|entry| {
                            opaque_entry_snapshot(
                                entry,
                                "authority_replica.tail_proof.capture.sources",
                            )
                        })
                        .collect::<Result<Vec<_>, _>>()?,
                })
            })
            .transpose()?;
        let admission_candidate = self
            .admission_candidate
            .as_ref()
            .map(|candidate| {
                opaque_entry_snapshot(
                    candidate,
                    "authority_replica.tail_proof.admission_candidate",
                )
            })
            .transpose()?;
        Ok(TailProofReplicaSnapshotV2 {
            request_sequence: self.request_sequence,
            capture,
            admission_candidate,
        })
    }

    pub(crate) fn from_snapshot_v2(
        snapshot: &TailProofReplicaSnapshotV2,
        request_context: &FrameContext,
        authority_context: &FrameContext,
        capacity: SafeU53,
    ) -> Result<Self, SnapshotError> {
        if snapshot.capture.is_some() && snapshot.admission_candidate.is_some() {
            return Err(snapshot_invalid(
                "authority_replica.tail_proof",
                "capture and one-shot admission cannot coexist",
            ));
        }
        let capture = snapshot
            .capture
            .as_ref()
            .map(|capture| {
                let candidate = decode_entry_snapshot(
                    &capture.candidate,
                    "authority_replica.tail_proof.capture.candidate",
                )?;
                capture.predecessor_identity.validate()?;
                if capture.request_context != *request_context
                    || capture.authority_context != *authority_context
                    || candidate.context != *authority_context
                    || capture.predecessor_identity.context != *authority_context
                    || capture
                        .request_sequence(snapshot.request_sequence)
                        .is_none()
                    || canonical_tail_proof_floor(&candidate) != Some(capture.from_revision)
                    || next_revision(capture.predecessor_identity.revision)
                        != Some(candidate.revision)
                    || !structurally_valid_boundary(&candidate)
                    || !candidate
                        .subsumes
                        .contains(&capture.predecessor_identity.revision)
                {
                    return Err(snapshot_invalid(
                        "authority_replica.tail_proof.capture",
                        "capture identity, request sequence, or proof floor is invalid",
                    ));
                }
                let mut sources = BTreeMap::new();
                for source in &capture.sources {
                    let entry = decode_entry_snapshot(
                        source,
                        "authority_replica.tail_proof.capture.sources",
                    )?;
                    if entry.context != *authority_context
                        || sources.insert(entry.revision, entry).is_some()
                    {
                        return Err(snapshot_invalid(
                            "authority_replica.tail_proof.capture.sources",
                            "captured sources must be unique and authority-bound",
                        ));
                    }
                }
                let local_capacity = usize::try_from(capacity.get()).unwrap_or(usize::MAX);
                let manifest_prefix_conflicts = capture.manifest.as_ref().is_some_and(|manifest| {
                    sources.len() > manifest.source_revisions.len()
                        || sources.keys().copied().collect::<Vec<_>>()
                            != manifest.source_revisions[..sources.len()]
                });
                if sources.len() > local_capacity
                    || sources.len() > TAIL_PROOF_MAX_SOURCE_REVISIONS
                    || capture.manifest.as_ref().is_some_and(|manifest| {
                        !valid_tail_proof_body(manifest, capacity)
                            || manifest.phase != TailProofPhase::Manifest
                            || manifest.request_id != capture.request_id
                            || manifest.from_revision != capture.from_revision
                            || manifest.candidate_revision != candidate.revision
                            || manifest.candidate_operation_id != candidate.operation_id
                    })
                    || manifest_prefix_conflicts
                    || capture.manifest.is_none() && !sources.is_empty()
                {
                    return Err(snapshot_invalid(
                        "authority_replica.tail_proof.capture.sources",
                        "captured source prefix or manifest is invalid",
                    ));
                }
                Ok(ReplicaCapture {
                    candidate,
                    predecessor_identity: capture.predecessor_identity.clone(),
                    from_revision: capture.from_revision,
                    request_id: capture.request_id.clone(),
                    request_context: capture.request_context.clone(),
                    authority_context: capture.authority_context.clone(),
                    manifest: capture.manifest.clone(),
                    sources,
                })
            })
            .transpose()?;
        let admission_candidate = snapshot
            .admission_candidate
            .as_ref()
            .map(|candidate| {
                let entry = decode_entry_snapshot(
                    candidate,
                    "authority_replica.tail_proof.admission_candidate",
                )?;
                if entry.context != *authority_context {
                    return Err(snapshot_invalid(
                        "authority_replica.tail_proof.admission_candidate",
                        "one-shot candidate is not authority-bound",
                    ));
                }
                Ok(entry)
            })
            .transpose()?;
        Ok(Self {
            request_sequence: snapshot.request_sequence,
            capture,
            admission_candidate,
        })
    }
}

impl TailProofReplicaCaptureSnapshotV2 {
    fn request_sequence(&self, high_water: SafeU53) -> Option<SafeU53> {
        let sequence = parse_request_sequence(&self.request_context, &self.request_id)?;
        (sequence == high_water).then_some(sequence)
    }
}

pub fn is_boundary_supersession_candidate(
    predecessor: &AuthorityEntry,
    candidate: &AuthorityEntry,
) -> bool {
    if matches!(predecessor.next_control, NextControl::Terminal(_))
        || !matches!(
            candidate.kind,
            AuthorityEntryKind::WaveAdvance | AuthorityEntryKind::TerminalCommit
        )
        || predecessor.operation_id == candidate.operation_id
        || !candidate.subsumes.contains(&predecessor.revision)
    {
        return false;
    }
    let mut unique = BTreeSet::new();
    if candidate
        .subsumes
        .iter()
        .any(|revision| *revision == Revision::ZERO || !unique.insert(*revision))
    {
        return false;
    }
    let Some((predecessor_epoch, predecessor_wave, predecessor_turn)) =
        control_coordinate(&predecessor.next_control)
    else {
        return false;
    };
    let Some((candidate_wave, candidate_turn)) = boundary_material_coordinate(candidate) else {
        return false;
    };
    if predecessor_epoch != candidate.context.session_epoch
        || !structurally_valid_boundary(candidate)
    {
        return false;
    }
    candidate_wave > predecessor_wave
        || (candidate_wave == predecessor_wave && candidate_turn >= predecessor_turn)
}

pub fn boundary_supersession_allows(
    predecessor: &AuthorityEntry,
    candidate: &AuthorityEntry,
    sources: &[AuthorityEntry],
) -> bool {
    if !is_boundary_supersession_candidate(predecessor, candidate)
        || sources
            .iter()
            .any(|source| source.context != candidate.context)
        || !sources.iter().any(|source| source == predecessor)
    {
        return false;
    }
    let expected = match candidate.kind {
        AuthorityEntryKind::WaveAdvance => {
            let Some((resolved_wave, _)) = boundary_material_coordinate(candidate) else {
                return false;
            };
            sources
                .iter()
                .filter(|source| {
                    matches!(
                        source.kind,
                        AuthorityEntryKind::TurnCommit | AuthorityEntryKind::ReplacementCommit
                    ) && control_coordinate(&source.next_control)
                        .is_some_and(|(_, wave, _)| wave == resolved_wave)
                })
                .map(|source| source.revision)
                .collect::<Vec<_>>()
        }
        AuthorityEntryKind::TerminalCommit => sources
            .iter()
            .filter(|source| source.kind != AuthorityEntryKind::TerminalCommit)
            .map(|source| source.revision)
            .collect::<Vec<_>>(),
        _ => return false,
    };
    !expected.is_empty()
        && expected == candidate.subsumes
        && expected.contains(&predecessor.revision)
}

fn structurally_valid_boundary(entry: &AuthorityEntry) -> bool {
    let Some(payload) = entry.material.payload.as_object() else {
        return false;
    };
    if boundary_digest(&entry.material).as_deref() != Some(entry.material.digest.as_str()) {
        return false;
    }
    match entry.kind {
        AuthorityEntryKind::WaveAdvance => {
            let Some(wave) = safe_json_integer(payload.get("wave")) else {
                return false;
            };
            let Some(turn) = safe_json_integer(payload.get("turn")) else {
                return false;
            };
            let Some(next_wave) = safe_json_integer(payload.get("nextWave")) else {
                return false;
            };
            let valid_material = payload.get("kind").and_then(Value::as_str)
                == Some("wave-advance")
                && next_wave > wave
                && payload
                    .get("biomeChange")
                    .and_then(Value::as_bool)
                    .is_some()
                && payload.get("eggLapse").and_then(Value::as_bool).is_some()
                && matches!(
                    payload.get("outcome").and_then(Value::as_str),
                    Some("win" | "capture" | "flee")
                )
                && matches!(
                    payload.get("meBoundary").and_then(Value::as_str),
                    Some("none" | "battle-victory")
                )
                && valid_victory_kind(payload)
                && valid_optional_carrier(payload.get("authorityCarrier"));
            if !valid_material {
                return false;
            }
            match &entry.next_control {
                NextControl::CommandFrontier(control) => {
                    control.epoch == entry.context.session_epoch
                        && control.wave == next_wave
                        && control.turn == safe_one()
                }
                NextControl::AwaitSuccessor(control) => {
                    control.after_operation_id == entry.operation_id
                        && control.epoch == entry.context.session_epoch
                        && control.wave == wave
                        && control.turn == turn
                }
                _ => false,
            }
        }
        AuthorityEntryKind::TerminalCommit => {
            let terminal_id = payload.get("terminalId").and_then(Value::as_str);
            let valid_material = payload.get("kind").and_then(Value::as_str) == Some("terminal")
                && terminal_id.is_some_and(|value| !value.is_empty())
                && safe_json_integer(payload.get("wave")).is_some()
                && safe_json_integer(payload.get("turn")).is_some()
                && matches!(
                    payload.get("reason").and_then(Value::as_str),
                    Some("game-over" | "final-flee" | "final-boss-credits" | "shared-fault")
                )
                && valid_optional_carrier(payload.get("authorityCarrier"));
            valid_material
                && matches!(
                    &entry.next_control,
                    NextControl::Terminal(control)
                        if terminal_id == Some(control.terminal_id.as_str())
                )
        }
        _ => false,
    }
}

fn boundary_material_coordinate(entry: &AuthorityEntry) -> Option<(SafeU53, SafeU53)> {
    if !matches!(
        entry.kind,
        AuthorityEntryKind::WaveAdvance | AuthorityEntryKind::TerminalCommit
    ) {
        return None;
    }
    let payload = entry.material.payload.as_object()?;
    Some((
        safe_json_integer(payload.get("wave"))?,
        safe_json_integer(payload.get("turn"))?,
    ))
}

fn control_coordinate(control: &NextControl) -> Option<(SafeU53, SafeU53, SafeU53)> {
    match control {
        NextControl::CommandFrontier(control) => Some((control.epoch, control.wave, control.turn)),
        NextControl::Replacement(control) => Some((control.epoch, control.wave, control.turn)),
        NextControl::SharedInteraction(control) => {
            Some((control.epoch, control.wave, control.turn))
        }
        NextControl::AwaitSuccessor(control) => Some((control.epoch, control.wave, control.turn)),
        NextControl::Terminal(_) => None,
    }
}

fn boundary_digest(material: &Material) -> Option<String> {
    let kind = material.payload.get("kind")?.as_str()?;
    if !matches!(kind, "wave-advance" | "terminal") {
        return None;
    }
    let canonical = canonicalize_value(&material.payload).ok()?;
    Some(format!("{kind}:{:08x}", fnv1a32_utf16(&canonical)))
}

fn valid_victory_kind(payload: &serde_json::Map<String, Value>) -> bool {
    match payload.get("outcome").and_then(Value::as_str) {
        Some("flee") => !payload.contains_key("victoryKind"),
        Some("win" | "capture") => matches!(
            payload.get("victoryKind").and_then(Value::as_str),
            Some("wild" | "trainer")
        ),
        _ => false,
    }
}

fn valid_optional_carrier(value: Option<&Value>) -> bool {
    let Some(value) = value else {
        return true;
    };
    let Some(carrier) = value.as_object() else {
        return false;
    };
    carrier
        .get("authoritativeState")
        .is_some_and(Value::is_object)
        && carrier.get("transition").is_some_and(Value::is_object)
}

fn safe_json_integer(value: Option<&Value>) -> Option<SafeU53> {
    SafeU53::new(value?.as_u64()?).ok()
}

fn valid_tail_proof_body(body: &TailProofBody, capacity: SafeU53) -> bool {
    if validate_authority_operation_id(body.request_id.as_str()).is_err()
        || validate_authority_operation_id(body.candidate_operation_id.as_str()).is_err()
        || body.candidate_revision <= body.from_revision
        || body.head_revision < body.candidate_revision
    {
        return false;
    }
    let capacity = usize::try_from(capacity.get()).unwrap_or(usize::MAX);
    if body.source_revisions.len() > capacity
        || body.source_revisions.len() > TAIL_PROOF_MAX_SOURCE_REVISIONS
    {
        return false;
    }
    let mut prior = None;
    for revision in &body.source_revisions {
        if *revision == Revision::ZERO
            || *revision < body.from_revision
            || *revision >= body.candidate_revision
            || prior.is_some_and(|prior| *revision <= prior)
        {
            return false;
        }
        prior = Some(*revision);
    }
    true
}

fn same_proof_metadata(left: &TailProofBody, right: &TailProofBody) -> bool {
    left.request_id == right.request_id
        && left.from_revision == right.from_revision
        && left.candidate_revision == right.candidate_revision
        && left.candidate_operation_id == right.candidate_operation_id
        && left.head_revision == right.head_revision
        && left.source_revisions == right.source_revisions
}

fn authenticated_request_context(
    request: &FrameContext,
    authority: &FrameContext,
    requester: SeatId,
    generation: ConnectionGeneration,
) -> bool {
    request.sender_seat_id == requester
        && request.sender_seat_id != authority.sender_seat_id
        && request.sender_seat_id != request.authority_seat_id
        && request.authority_seat_id == authority.authority_seat_id
        && request.connection_generation == generation
        && frame_contexts_compatible(request, authority)
}

fn canonical_request_id(context: &FrameContext, sequence: SafeU53) -> Option<OperationId> {
    let value = format!(
        "authority-v2:{}:seat{}:boundary-proof:{}",
        context.session_id, context.sender_seat_id, sequence
    );
    if validate_authority_operation_id(&value).is_err() {
        return None;
    }
    OperationId::new(value).ok()
}

fn parse_request_sequence(context: &FrameContext, request_id: &OperationId) -> Option<SafeU53> {
    if validate_authority_operation_id(request_id.as_str()).is_err() {
        return None;
    }
    let prefix = format!(
        "authority-v2:{}:seat{}:boundary-proof:",
        context.session_id, context.sender_seat_id
    );
    let encoded = request_id.as_str().strip_prefix(&prefix)?;
    if encoded.is_empty()
        || encoded.starts_with('0')
        || !encoded.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let value = encoded.parse::<u64>().ok()?;
    let sequence = SafeU53::new(value).ok()?;
    (sequence != SafeU53::ZERO && sequence.to_string() == encoded).then_some(sequence)
}

fn next_safe(value: SafeU53) -> Option<SafeU53> {
    SafeU53::new(value.get().checked_add(1)?).ok()
}

fn next_revision(value: Revision) -> Option<Revision> {
    next_safe(value.get()).map(Revision::new)
}

fn previous_revision(value: Revision) -> Option<Revision> {
    let value = value.get().get();
    (value > 0)
        .then(|| SafeU53::new(value - 1).ok().map(Revision::new))
        .flatten()
}

fn canonical_tail_proof_floor(candidate: &AuthorityEntry) -> Option<Revision> {
    let predecessor = previous_revision(candidate.revision)?;
    Some(
        candidate
            .subsumes
            .iter()
            .copied()
            .fold(predecessor, std::cmp::min),
    )
}

fn safe_one() -> SafeU53 {
    SafeU53::new(1).unwrap_or(SafeU53::MAX)
}

fn fnv1a32_utf16(value: &str) -> u32 {
    let mut hash = FNV1A32_OFFSET;
    for unit in value.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(FNV1A32_PRIME);
    }
    hash
}

fn identity_snapshot(entry: &AuthorityEntry) -> AuthorityEntryIdentitySnapshotV2 {
    AuthorityEntryIdentitySnapshotV2 {
        revision: entry.revision,
        context: entry.context.clone(),
        operation_id: entry.operation_id.clone(),
        kind: entry.kind,
        material_digest: entry.material.digest.clone(),
        next_control_id: control_id_of(&entry.next_control),
        subsumes: entry.subsumes.clone(),
    }
}

fn opaque_entry_snapshot(
    entry: &AuthorityEntry,
    path: &str,
) -> Result<OpaqueAuthorityEntrySnapshotV2, SnapshotError> {
    let bytes = er_canonical::canonical_bytes(entry)
        .map_err(|error| snapshot_canonical(path, error.to_string()))?;
    Ok(OpaqueAuthorityEntrySnapshotV2 {
        identity: identity_snapshot(entry),
        canonical_entry_bytes: CanonicalHexBytes::from_bytes(&bytes),
    })
}

fn decode_entry_snapshot(
    snapshot: &OpaqueAuthorityEntrySnapshotV2,
    path: &str,
) -> Result<AuthorityEntry, SnapshotError> {
    snapshot.validate()?;
    let bytes = decode_hex(&snapshot.canonical_entry_bytes, path)?;
    let entry = serde_json::from_slice::<AuthorityEntry>(&bytes)
        .map_err(|error| snapshot_canonical(path, error.to_string()))?;
    let canonical = er_canonical::canonical_bytes(&entry)
        .map_err(|error| snapshot_canonical(path, error.to_string()))?;
    if canonical != bytes {
        return Err(snapshot_canonical(
            path,
            "authority entry is not canonically encoded",
        ));
    }
    Ok(entry)
}

fn entry_matches_identity(
    entry: &AuthorityEntry,
    identity: &AuthorityEntryIdentitySnapshotV2,
) -> bool {
    entry.revision == identity.revision
        && entry.context == identity.context
        && entry.operation_id == identity.operation_id
        && entry.kind == identity.kind
        && entry.material.digest == identity.material_digest
        && control_id_of(&entry.next_control) == identity.next_control_id
        && entry.subsumes == identity.subsumes
}

fn decode_hex(bytes: &CanonicalHexBytes, path: &str) -> Result<Vec<u8>, SnapshotError> {
    let raw = bytes.as_str().as_bytes();
    if !raw.len().is_multiple_of(2) {
        return Err(snapshot_canonical(
            path,
            "canonical payload has odd hex length",
        ));
    }
    let mut decoded = Vec::with_capacity(raw.len() / 2);
    for pair in raw.chunks_exact(2) {
        let Some(high) = hex_digit(pair[0]) else {
            return Err(snapshot_canonical(
                path,
                "canonical payload contains invalid hex",
            ));
        };
        let Some(low) = hex_digit(pair[1]) else {
            return Err(snapshot_canonical(
                path,
                "canonical payload contains invalid hex",
            ));
        };
        decoded.push((high << 4) | low);
    }
    Ok(decoded)
}

fn hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        _ => None,
    }
}

fn snapshot_invalid(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Invalid {
        path: path.into(),
        reason: reason.into(),
    }
}

fn snapshot_canonical(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Canonical {
        path: path.into(),
        reason: reason.into(),
    }
}
