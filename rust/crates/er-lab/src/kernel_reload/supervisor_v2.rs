//! Exact-preservation reload of current worker processes.
//!
//! Candidate effects are compared as data and never delivered to external adapters.
//! This module does not promise semantic-change acceptance or post-activation rollback.

use std::collections::VecDeque;
use std::sync::Arc;

use er_env::current::{CurrentExternalEvent, CurrentGameObservation};
use er_game::m9e_content_v2::GameContentBundleV2;
use er_kernel::game_kernel_v7::GameKernelRoleV7;
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_kernel_worker::{KernelGenerationIdentityV2, KernelWorkerHealthV2, KernelWorkerInitializationV2};
use er_types::SeatId;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::{ChildKernelGenerationV2, CurrentGenerationStepV2, KernelEndpointErrorV2, VerifiedKernelExecutableV2};

#[derive(Clone, Copy, Debug)]
pub struct CurrentTailLimitsV2 {
    pub maximum_events: usize,
    pub maximum_bytes: usize,
}

impl Default for CurrentTailLimitsV2 {
    fn default() -> Self {
        Self { maximum_events: 256, maximum_bytes: 16_777_216 }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum CurrentTraceRetentionV2 {
    Retained,
    /// The event was accepted, but its record could not fit or be serialized.
    /// Tickets preceding this position have expired.
    Gap,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentDispatchV2 {
    /// Logical external-event position, independent of worker IPC sequence.
    pub position: u64,
    pub evidence: CurrentGenerationStepV2,
    pub retention: CurrentTraceRetentionV2,
}

#[derive(Clone, Debug)]
pub struct CurrentReloadTicketV2 {
    owner: Arc<()>,
    identity: KernelGenerationIdentityV2,
    frontier: u64,
    snapshot: CoreGameKernelSnapshotV7,
    observation: CurrentGameObservation,
}

impl CurrentReloadTicketV2 {
    pub fn frontier(&self) -> u64 { self.frontier }
    pub fn identity(&self) -> &KernelGenerationIdentityV2 { &self.identity }
    pub fn snapshot(&self) -> &CoreGameKernelSnapshotV7 { &self.snapshot }
}

#[derive(Debug)]
pub struct PreparedCurrentReloadV2 {
    owner: Arc<()>,
    source_identity: KernelGenerationIdentityV2,
    frontier: u64,
    replayed_events: u64,
    candidate: ChildKernelGenerationV2,
}

impl PreparedCurrentReloadV2 {
    pub fn frontier(&self) -> u64 { self.frontier }
    pub fn replayed_events(&self) -> u64 { self.replayed_events }
    pub fn identity(&self) -> &KernelGenerationIdentityV2 { self.candidate.identity() }
    pub fn process_id(&self) -> u32 { self.candidate.process_id() }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentReloadAcceptedV2 {
    pub previous_identity: KernelGenerationIdentityV2,
    pub active_identity: KernelGenerationIdentityV2,
    pub frontier: u64,
    pub replayed_events: u64,
    /// Activation succeeded even if retiring the previous process had a problem.
    pub retirement_issue: Option<String>,
}

#[derive(Debug, Error)]
pub enum CurrentReloadErrorV2 {
    #[error(transparent)]
    Endpoint(#[from] KernelEndpointErrorV2),
    #[error("tail limits must be nonzero and at most 4096 events / 64 MiB")]
    InvalidLimits,
    #[error("active endpoint has no acknowledged session context")]
    ContextUnavailable,
    #[error("reload identity rejected: {0}")]
    Identity(&'static str),
    #[error("reload ticket does not belong to the current active generation")]
    StaleTicket,
    #[error("reload ticket at {ticket} predates retained frontier {oldest}")]
    TicketExpired { ticket: u64, oldest: u64 },
    #[error("active generation advanced after candidate preparation")]
    StalePrepared,
    #[error("exact-preservation mismatch at event position {position}: {kind}")]
    Divergence { position: u64, kind: &'static str },
    #[error("logical external-event position exhausted")]
    PositionExhausted,
    #[error("reload checkpoint serialization failed: {0}")]
    SnapshotSerialization(String),
}

#[derive(Debug)]
struct RetainedEventV2 {
    position: u64,
    event: CurrentExternalEvent,
    evidence: CurrentGenerationStepV2,
    encoded_bytes: usize,
}

#[derive(Debug)]
pub struct CurrentKernelSupervisorV2 {
    owner: Arc<()>,
    active: ChildKernelGenerationV2,
    local_seat: SeatId,
    role: GameKernelRoleV7,
    limits: CurrentTailLimitsV2,
    frontier: u64,
    oldest_frontier: u64,
    retained_bytes: usize,
    tail: VecDeque<RetainedEventV2>,
}

impl CurrentKernelSupervisorV2 {
    /// Adopts an initialized current endpoint and preserves its acknowledged
    /// seat and role across reloads, without accepting caller overrides.
    pub fn new(
        mut active: ChildKernelGenerationV2,
        limits: CurrentTailLimitsV2,
    ) -> Result<Self, CurrentReloadErrorV2> {
        if limits.maximum_events == 0 || limits.maximum_events > 4096
            || limits.maximum_bytes == 0 || limits.maximum_bytes > 67_108_864
        { return Err(CurrentReloadErrorV2::InvalidLimits); }
        let (local_seat, role) = active.session_context()
            .ok_or(CurrentReloadErrorV2::ContextUnavailable)?;
        active.observe()?;
        Ok(Self {
            owner: Arc::new(()), active, local_seat, role, limits,
            frontier: 0, oldest_frontier: 0, retained_bytes: 0, tail: VecDeque::new(),
        })
    }

    pub fn identity(&self) -> &KernelGenerationIdentityV2 { self.active.identity() }
    pub fn frontier(&self) -> u64 { self.frontier }
    pub fn oldest_retained_frontier(&self) -> u64 { self.oldest_frontier }
    pub fn retained_events(&self) -> usize { self.tail.len() }
    pub fn retained_bytes(&self) -> usize { self.retained_bytes }
    pub fn process_id(&self) -> u32 { self.active.process_id() }
    pub fn is_fenced(&self) -> bool { self.active.is_fenced() }
    pub fn session_context(&self) -> Option<(SeatId, GameKernelRoleV7)> { self.active.session_context() }
    pub fn maximum_success_response_bytes(&self) -> usize { self.active.maximum_success_response_bytes() }

    /// On an uncertain transport error the endpoint is fenced: callers must not
    /// interpret such an error as proof that the worker rejected the event.
    pub fn dispatch(&mut self, event: CurrentExternalEvent) -> Result<CurrentDispatchV2, CurrentReloadErrorV2> {
        let position = self.frontier.checked_add(1).ok_or(CurrentReloadErrorV2::PositionExhausted)?;
        let evidence = self.active.apply(event.clone())?;
        self.frontier = position;
        // Recording happens after worker commit. A retention failure is an
        // explicit gap attached to the accepted result, never a rejected event.
        let encoded_bytes = serde_json::to_vec(&(position, &event, &evidence)).ok().map(|bytes| bytes.len());
        let retention = match encoded_bytes {
            Some(encoded_bytes) if encoded_bytes <= self.limits.maximum_bytes => {
                while self.tail.len() >= self.limits.maximum_events
                    || self.retained_bytes + encoded_bytes > self.limits.maximum_bytes
                {
                    if let Some(evicted) = self.tail.pop_front() {
                        self.retained_bytes -= evicted.encoded_bytes;
                        self.oldest_frontier = evicted.position;
                    } else { break; }
                }
                self.retained_bytes += encoded_bytes;
                self.tail.push_back(RetainedEventV2 { position, event, evidence: evidence.clone(), encoded_bytes });
                CurrentTraceRetentionV2::Retained
            }
            _ => {
                self.clear_tail();
                CurrentTraceRetentionV2::Gap
            }
        };
        Ok(CurrentDispatchV2 { position, evidence, retention })
    }

    pub fn begin_reload(&mut self) -> Result<CurrentReloadTicketV2, CurrentReloadErrorV2> {
        // Capture the complete base before recording/replaying any later event.
        let snapshot = self.active.snapshot()?;
        let observation = self.active.observe()?;
        Ok(CurrentReloadTicketV2 {
            owner: Arc::clone(&self.owner), identity: self.identity().clone(),
            frontier: self.frontier, snapshot, observation,
        })
    }

    pub fn prepare_reload(
        &mut self,
        ticket: CurrentReloadTicketV2,
        artifact: &VerifiedKernelExecutableV2,
        content_bundle: GameContentBundleV2,
    ) -> Result<PreparedCurrentReloadV2, CurrentReloadErrorV2> {
        self.check_ticket(&ticket)?;
        self.check_candidate(artifact.identity())?;
        let snapshot_bytes = serde_json::to_vec(&ticket.snapshot)
            .map_err(|error| CurrentReloadErrorV2::SnapshotSerialization(error.to_string()))?;
        let mut candidate = ChildKernelGenerationV2::spawn_with_limits(
            artifact, self.active.deadlines(), self.active.maximum_success_response_bytes(),
        )?;
        let observation = candidate.initialize(content_bundle, KernelWorkerInitializationV2::Snapshot {
            snapshot_bytes, local_seat: self.local_seat, role: self.role,
        })?;
        if observation != ticket.observation || candidate.snapshot()? != ticket.snapshot {
            return Err(CurrentReloadErrorV2::Divergence { position: ticket.frontier, kind: "restored checkpoint" });
        }
        let mut replayed = 0_u64;
        let mut expected_position = ticket.frontier;
        for retained in self.tail.iter().filter(|record| record.position > ticket.frontier) {
            expected_position = expected_position.checked_add(1).ok_or(CurrentReloadErrorV2::PositionExhausted)?;
            if retained.position != expected_position {
                return Err(CurrentReloadErrorV2::TicketExpired { ticket: ticket.frontier, oldest: self.oldest_frontier });
            }
            // Quarantine: no candidate effect is exposed through the public API.
            if candidate.apply(retained.event.clone())? != retained.evidence {
                return Err(CurrentReloadErrorV2::Divergence { position: retained.position, kind: "ordered effects or observation" });
            }
            replayed += 1;
        }
        if expected_position != self.frontier {
            return Err(CurrentReloadErrorV2::TicketExpired { ticket: ticket.frontier, oldest: self.oldest_frontier });
        }
        if candidate.snapshot()? != self.active.snapshot()? || candidate.observe()? != self.active.observe()? {
            return Err(CurrentReloadErrorV2::Divergence { position: self.frontier, kind: "final snapshot or observation" });
        }
        Ok(PreparedCurrentReloadV2 {
            owner: Arc::clone(&self.owner), source_identity: self.identity().clone(),
            frontier: self.frontier, replayed_events: replayed, candidate,
        })
    }

    pub fn commit_reload(&mut self, prepared: PreparedCurrentReloadV2) -> Result<CurrentReloadAcceptedV2, CurrentReloadErrorV2> {
        if !Arc::ptr_eq(&prepared.owner, &self.owner)
            || prepared.source_identity != *self.identity() || prepared.frontier != self.frontier
            || self.active.is_fenced() || self.active.is_disposed()
        { return Err(CurrentReloadErrorV2::StalePrepared); }
        // Check the prepared process still responds before crossing activation.
        let mut candidate = prepared.candidate;
        candidate.health()?;
        let previous_identity = self.identity().clone();
        let active_identity = candidate.identity().clone();
        let mut previous = std::mem::replace(&mut self.active, candidate);
        self.clear_tail();
        // No fallible operation after the swap can turn acceptance into rejection.
        let retirement_issue = previous.dispose().err().map(|error| error.to_string());
        Ok(CurrentReloadAcceptedV2 {
            previous_identity, active_identity, frontier: self.frontier,
            replayed_events: prepared.replayed_events, retirement_issue,
        })
    }

    pub fn snapshot(&mut self) -> Result<CoreGameKernelSnapshotV7, CurrentReloadErrorV2> { Ok(self.active.snapshot()?) }
    pub fn observe(&mut self) -> Result<CurrentGameObservation, CurrentReloadErrorV2> { Ok(self.active.observe()?) }
    pub fn health(&mut self) -> Result<KernelWorkerHealthV2, CurrentReloadErrorV2> { Ok(self.active.health()?) }
    pub fn dispose(&mut self) -> Result<(), CurrentReloadErrorV2> { Ok(self.active.dispose()?) }

    fn clear_tail(&mut self) {
        self.tail.clear();
        self.retained_bytes = 0;
        self.oldest_frontier = self.frontier;
    }

    fn check_ticket(&self, ticket: &CurrentReloadTicketV2) -> Result<(), CurrentReloadErrorV2> {
        if !Arc::ptr_eq(&ticket.owner, &self.owner) || ticket.identity != *self.identity()
            || ticket.frontier > self.frontier
        { return Err(CurrentReloadErrorV2::StaleTicket); }
        if ticket.frontier < self.oldest_frontier {
            return Err(CurrentReloadErrorV2::TicketExpired { ticket: ticket.frontier, oldest: self.oldest_frontier });
        }
        Ok(())
    }

    fn check_candidate(&self, candidate: &KernelGenerationIdentityV2) -> Result<(), CurrentReloadErrorV2> {
        let active = self.identity();
        if candidate.session_id != active.session_id || candidate.generation.0 <= active.generation.0 {
            return Err(CurrentReloadErrorV2::Identity("session must match and generation must increase"));
        }
        if candidate.content_identity != active.content_identity || candidate.worker_abi_version != active.worker_abi_version
            || candidate.minimum_snapshot_schema != active.minimum_snapshot_schema
            || candidate.maximum_snapshot_schema != active.maximum_snapshot_schema
            || candidate.build_target != active.build_target || candidate.build_profile != active.build_profile
        { return Err(CurrentReloadErrorV2::Identity("content, ABI, snapshot range or build context differs")); }
        Ok(())
    }
}
