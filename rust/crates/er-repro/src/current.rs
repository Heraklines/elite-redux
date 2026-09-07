//! Bounded current-session causal suffixes. Replay never delivers external effects.
//!
//! Digests verify recorded state continuity, not the identity of an executable.
//! Adapter admission/response-budget failures require an explicit capture gap;
//! they are not kernel rejections and cannot be replayed as such here.

use std::io::{self, Write};
use std::sync::Arc;

use er_canonical::content_digest;
use er_env::current::{
    CurrentExternalEvent, CurrentGameObservation, CurrentGameSession, CurrentSessionError,
};
use er_game::m9e_content_v2::PreparedGameContentV2;
use er_kernel::game_kernel_v7::{GameKernelRoleV7, GameKernelStepV7};
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_types::{ConnectionGeneration, GameContentIdentityV2, SafeU53, SeatId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const CURRENT_REPRO_SCHEMA_VERSION_V1: u32 = 1;
pub const MAXIMUM_CURRENT_REPRO_EVENTS_V1: usize = 4096;
pub const MAXIMUM_CURRENT_REPRO_BYTES_V1: usize = 16 << 20;
pub const MAXIMUM_CURRENT_REPRO_POSITION_V1: u64 = 9_007_199_254_740_991;
const MAXIMUM_ORIGIN_BYTES: usize = 128;
const MAXIMUM_ERROR_BYTES: usize = 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CurrentReproLimitsV1 {
    pub maximum_events: usize,
    pub maximum_bytes: usize,
}

impl Default for CurrentReproLimitsV1 {
    fn default() -> Self {
        Self {
            maximum_events: 256,
            maximum_bytes: 2 << 20,
        }
    }
}

impl CurrentReproLimitsV1 {
    pub fn validate(self) -> Result<(), CurrentReproErrorV1> {
        if self.maximum_events == 0
            || self.maximum_events > MAXIMUM_CURRENT_REPRO_EVENTS_V1
            || self.maximum_bytes == 0
            || self.maximum_bytes > MAXIMUM_CURRENT_REPRO_BYTES_V1
        {
            return Err(invalid("limits"));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CurrentReproRejectionKindV1 {
    Disposed,
    Kernel,
    Digest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentReproRejectionV1 {
    pub kind: CurrentReproRejectionKindV1,
    /// UTF-8 prefix, bounded identically during recording and replay.
    pub message: String,
}

impl CurrentReproRejectionV1 {
    pub fn from_error(error: &CurrentSessionError) -> Self {
        let kind = match error {
            CurrentSessionError::Disposed => CurrentReproRejectionKindV1::Disposed,
            CurrentSessionError::Kernel(_) => CurrentReproRejectionKindV1::Kernel,
            CurrentSessionError::Digest(_) => CurrentReproRejectionKindV1::Digest,
        };
        Self {
            kind,
            message: bounded_text(&error.to_string(), MAXIMUM_ERROR_BYTES),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", deny_unknown_fields)]
pub enum CurrentReproOutcomeV1 {
    Applied {
        step: Box<GameKernelStepV7>,
        observation: Box<CurrentGameObservation>,
        snapshot_digest: String,
    },
    KernelRejected {
        error: CurrentReproRejectionV1,
        observation: Box<CurrentGameObservation>,
        snapshot_digest: String,
    },
}

impl CurrentReproOutcomeV1 {
    fn evidence(&self) -> (&CurrentGameObservation, &str) {
        match self {
            Self::Applied {
                observation,
                snapshot_digest,
                ..
            }
            | Self::KernelRejected {
                observation,
                snapshot_digest,
                ..
            } => (observation, snapshot_digest),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentReproAttemptV1 {
    pub position: u64,
    /// Unverified adapter provenance; never interpreted as execution semantics.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub browser_transport: Option<CurrentReproBrowserTransitionV1>,
    pub event: CurrentExternalEvent,
    pub outcome: CurrentReproOutcomeV1,
}

/// Browser admission state is separate from kernel protocol peer state.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentReproBrowserTransportV1 {
    pub base_generation: SafeU53,
    pub final_generation: SafeU53,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentReproBrowserTransitionV1 {
    pub before_generation: SafeU53,
    pub after_generation: SafeU53,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentReproCapsuleV1 {
    pub schema_version: u32,
    pub content_identity: GameContentIdentityV2,
    pub local_seat: SeatId,
    pub role: GameKernelRoleV7,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub browser_transport: Option<CurrentReproBrowserTransportV1>,
    /// Absolute attempt frontier represented by checkpoint, before the tail.
    pub base_position: u64,
    pub checkpoint: Box<CoreGameKernelSnapshotV7>,
    pub attempts: Vec<CurrentReproAttemptV1>,
    pub final_position: u64,
    pub final_snapshot_digest: String,
}

impl CurrentReproCapsuleV1 {
    pub fn validate(&self, limits: CurrentReproLimitsV1) -> Result<(), CurrentReproErrorV1> {
        limits.validate()?;
        if self.schema_version != CURRENT_REPRO_SCHEMA_VERSION_V1
            || self.checkpoint.schema_version != 7
        {
            return Err(invalid("schema_version"));
        }
        if self.base_position > MAXIMUM_CURRENT_REPRO_POSITION_V1
            || self.final_position > MAXIMUM_CURRENT_REPRO_POSITION_V1
        {
            return Err(invalid("unsafe attempt position"));
        }
        if self.attempts.len() > limits.maximum_events || !fits(self, limits.maximum_bytes) {
            return Err(invalid("capsule bounds"));
        }
        let mut position = self.base_position;
        let mut browser_generation = self
            .browser_transport
            .map(|context| context.base_generation);
        if browser_generation == Some(SafeU53::ZERO) {
            return Err(invalid("browser generation"));
        }
        for attempt in &self.attempts {
            position = position
                .checked_add(1)
                .ok_or_else(|| invalid("attempt position overflow"))?;
            if attempt.position != position {
                return Err(divergence(position, "position"));
            }
            if attempt
                .origin
                .as_ref()
                .is_some_and(|origin| origin.len() > MAXIMUM_ORIGIN_BYTES)
            {
                return Err(divergence(position, "origin bound"));
            }
            if let CurrentReproOutcomeV1::KernelRejected { error, .. } = &attempt.outcome
                && error.message.len() > MAXIMUM_ERROR_BYTES
            {
                return Err(divergence(position, "rejection bound"));
            }
            match (browser_generation, attempt.browser_transport) {
                (None, None) => {}
                (Some(generation), Some(transition))
                    if generation == transition.before_generation
                        && valid_browser_transition(
                            &attempt.event,
                            matches!(&attempt.outcome, CurrentReproOutcomeV1::Applied { .. }),
                            transition,
                        ) =>
                {
                    browser_generation = Some(transition.after_generation);
                }
                _ => return Err(divergence(position, "browser transport")),
            }
        }
        if position != self.final_position {
            return Err(divergence(position, "final_position"));
        }
        if browser_generation
            != self
                .browser_transport
                .map(|context| context.final_generation)
        {
            return Err(divergence(position, "final browser generation"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum CurrentCaptureStatusV1 {
    Available {
        base_position: u64,
        final_position: u64,
    },
    Unavailable {
        position: u64,
        reason: String,
    },
}

#[derive(Debug, Error)]
pub enum CurrentReproErrorV1 {
    #[error("invalid current capsule: {field}")]
    Invalid { field: String },
    #[error("current replay diverged at attempt {position}: {field}")]
    Divergence { position: u64, field: &'static str },
    #[error("current capture unavailable at attempt {position}: {reason}")]
    Unavailable { position: u64, reason: String },
}

#[derive(Clone, Debug)]
pub struct CurrentReproRecorderV1 {
    content: Arc<PreparedGameContentV2>,
    local_seat: SeatId,
    role: GameKernelRoleV7,
    limits: CurrentReproLimitsV1,
    position: u64,
    browser_context_required: bool,
    capsule: Option<CurrentReproCapsuleV1>,
    // Exact serde_json byte length. This cache is internal and never part of the
    // capsule schema; it exists iff the retained capsule exists.
    capsule_bytes: Option<usize>,
    unavailable_reason: String,
}

impl CurrentReproRecorderV1 {
    /// Validate/replay once, retaining imported positions and origins. Neither
    /// the recorder nor the isolated session escapes when replay diverges.
    pub fn from_capsule(
        capsule: CurrentReproCapsuleV1,
        content: Arc<PreparedGameContentV2>,
        limits: CurrentReproLimitsV1,
    ) -> Result<(Self, CurrentGameSession), CurrentReproErrorV1> {
        let session = replay_current_capsule_v1(&capsule, Arc::clone(&content), limits)?;
        let capsule_bytes = encoded_len(&capsule, limits.maximum_bytes)
            .ok_or_else(|| invalid("imported capsule byte bound"))?;
        let browser_context_required = capsule.browser_transport.is_some();
        let recorder = Self {
            content,
            local_seat: capsule.local_seat,
            role: capsule.role,
            limits,
            position: capsule.final_position,
            capsule: Some(capsule),
            capsule_bytes: Some(capsule_bytes),
            unavailable_reason: String::new(),
            browser_context_required,
        };
        Ok((recorder, session))
    }

    pub fn new(
        checkpoint: CoreGameKernelSnapshotV7,
        local_seat: SeatId,
        role: GameKernelRoleV7,
        content: Arc<PreparedGameContentV2>,
        limits: CurrentReproLimitsV1,
    ) -> Result<Self, CurrentReproErrorV1> {
        Self::new_at_position(checkpoint, local_seat, role, content, limits, 0)
    }

    /// Begin a declared native checkpoint suffix, with no browser transport context.
    /// The caller supplies a previously verified logical frontier, not new events.
    pub fn new_at_position(
        checkpoint: CoreGameKernelSnapshotV7,
        local_seat: SeatId,
        role: GameKernelRoleV7,
        content: Arc<PreparedGameContentV2>,
        limits: CurrentReproLimitsV1,
        position: u64,
    ) -> Result<Self, CurrentReproErrorV1> {
        if position > MAXIMUM_CURRENT_REPRO_POSITION_V1 {
            return Err(invalid("initial position"));
        }
        limits.validate()?;
        let mut recorder = Self {
            content,
            local_seat,
            role,
            limits,
            position,
            browser_context_required: false,
            capsule: None,
            capsule_bytes: None,
            unavailable_reason: "initial checkpoint exceeds capture bound".to_owned(),
        };
        if fits(&checkpoint, limits.maximum_bytes) {
            recorder.verified_observation(&checkpoint)?;
            let digest = snapshot_digest(&checkpoint)?;
            let capsule = recorder.empty_capsule(checkpoint, position, digest, None);
            if let Some(bytes) = encoded_len(&capsule, limits.maximum_bytes) {
                recorder.capsule = Some(capsule);
                recorder.capsule_bytes = Some(bytes);
            }
        }
        Ok(recorder)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn new_with_browser_transport(
        checkpoint: CoreGameKernelSnapshotV7,
        local_seat: SeatId,
        role: GameKernelRoleV7,
        content: Arc<PreparedGameContentV2>,
        limits: CurrentReproLimitsV1,
        generation: SafeU53,
    ) -> Result<Self, CurrentReproErrorV1> {
        if generation == SafeU53::ZERO {
            return Err(invalid("browser generation"));
        }
        let mut recorder = Self::new(checkpoint, local_seat, role, content, limits)?;
        recorder.browser_context_required = true;
        if let Some(capsule) = &mut recorder.capsule {
            capsule.browser_transport = Some(CurrentReproBrowserTransportV1 {
                base_generation: generation,
                final_generation: generation,
            });
            recorder.capsule_bytes = encoded_len(capsule, limits.maximum_bytes);
            if recorder.capsule_bytes.is_none() {
                let _ = recorder.gap("initial checkpoint exceeds capture bound");
            }
        }
        Ok(recorder)
    }

    pub fn record(
        &mut self,
        before: &CoreGameKernelSnapshotV7,
        event: CurrentExternalEvent,
        outcome: Result<&GameKernelStepV7, &CurrentSessionError>,
        after: &CoreGameKernelSnapshotV7,
        observation: &CurrentGameObservation,
    ) -> CurrentCaptureStatusV1 {
        self.record_with_origin(before, event, outcome, after, observation, None)
    }

    /// Recording cannot reject an already accepted game event. A subsequent
    /// verified before-state can recover capture as a new, explicitly positioned suffix.
    #[allow(clippy::too_many_arguments)]
    pub fn record_with_origin(
        &mut self,
        before: &CoreGameKernelSnapshotV7,
        event: CurrentExternalEvent,
        outcome: Result<&GameKernelStepV7, &CurrentSessionError>,
        after: &CoreGameKernelSnapshotV7,
        observation: &CurrentGameObservation,
        origin: Option<&str>,
    ) -> CurrentCaptureStatusV1 {
        self.record_attempt(before, event, outcome, after, observation, origin, None)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn record_with_browser_transport(
        &mut self,
        before: &CoreGameKernelSnapshotV7,
        event: CurrentExternalEvent,
        outcome: Result<&GameKernelStepV7, &CurrentSessionError>,
        after: &CoreGameKernelSnapshotV7,
        observation: &CurrentGameObservation,
        origin: Option<&str>,
        before_generation: SafeU53,
        after_generation: SafeU53,
    ) -> CurrentCaptureStatusV1 {
        self.record_attempt(
            before,
            event,
            outcome,
            after,
            observation,
            origin,
            Some(CurrentReproBrowserTransitionV1 {
                before_generation,
                after_generation,
            }),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn record_attempt(
        &mut self,
        before: &CoreGameKernelSnapshotV7,
        event: CurrentExternalEvent,
        outcome: Result<&GameKernelStepV7, &CurrentSessionError>,
        after: &CoreGameKernelSnapshotV7,
        observation: &CurrentGameObservation,
        origin: Option<&str>,
        browser_transport: Option<CurrentReproBrowserTransitionV1>,
    ) -> CurrentCaptureStatusV1 {
        let Some(position) = self
            .position
            .checked_add(1)
            .filter(|value| *value <= MAXIMUM_CURRENT_REPRO_POSITION_V1)
        else {
            return self.gap("attempt position exhausted");
        };
        self.position = position;
        match self.record_checked(
            before,
            event,
            outcome,
            after,
            observation,
            origin,
            browser_transport,
        ) {
            Ok((capsule, bytes)) => {
                self.capsule = Some(capsule);
                self.capsule_bytes = Some(bytes);
                self.status()
            }
            Err(error) => self.gap(&error.to_string()),
        }
    }

    /// Mark one unrecordable adapter attempt, including late response rejection.
    /// Its kernel/adapter outcome is deliberately not fabricated in the capsule.
    pub fn invalidate_attempt(&mut self, reason: &str) -> CurrentCaptureStatusV1 {
        let Some(position) = self
            .position
            .checked_add(1)
            .filter(|value| *value <= MAXIMUM_CURRENT_REPRO_POSITION_V1)
        else {
            return self.gap("attempt position exhausted");
        };
        self.position = position;
        self.gap(reason)
    }

    pub fn status(&self) -> CurrentCaptureStatusV1 {
        match &self.capsule {
            Some(capsule) => CurrentCaptureStatusV1::Available {
                base_position: capsule.base_position,
                final_position: capsule.final_position,
            },
            None => CurrentCaptureStatusV1::Unavailable {
                position: self.position,
                reason: self.unavailable_reason.clone(),
            },
        }
    }

    pub fn export(&self) -> Result<CurrentReproCapsuleV1, CurrentReproErrorV1> {
        self.capsule
            .clone()
            .ok_or_else(|| CurrentReproErrorV1::Unavailable {
                position: self.position,
                reason: self.unavailable_reason.clone(),
            })
    }

    #[allow(clippy::too_many_arguments)]
    fn record_checked(
        &mut self,
        before: &CoreGameKernelSnapshotV7,
        event: CurrentExternalEvent,
        outcome: Result<&GameKernelStepV7, &CurrentSessionError>,
        after: &CoreGameKernelSnapshotV7,
        observation: &CurrentGameObservation,
        origin: Option<&str>,
        browser_transport: Option<CurrentReproBrowserTransitionV1>,
    ) -> Result<(CurrentReproCapsuleV1, usize), CurrentReproErrorV1> {
        if self.browser_context_required != browser_transport.is_some() {
            return Err(invalid("browser transport context missing or unexpected"));
        }
        if let Some(transition) = browser_transport {
            if !valid_browser_transition(&event, outcome.is_ok(), transition) {
                return Err(invalid("browser transport admission or reduction"));
            }
            if self
                .capsule
                .as_ref()
                .and_then(|capsule| capsule.browser_transport)
                .is_some_and(|context| context.final_generation != transition.before_generation)
            {
                return Err(invalid("browser generation continuity"));
            }
        }
        if origin.is_some_and(|value| value.len() > MAXIMUM_ORIGIN_BYTES) {
            return Err(invalid("origin bound"));
        }
        if !fits(before, self.limits.maximum_bytes)
            || !fits(after, self.limits.maximum_bytes)
            || !fits(&event, self.limits.maximum_bytes)
            || outcome
                .as_ref()
                .is_ok_and(|step| !fits(step, self.limits.maximum_bytes))
        {
            return Err(invalid("single attempt capture bound"));
        }
        let before_observation = self.verified_observation(before)?;
        if self.verified_observation(after)? != *observation {
            return Err(invalid("after observation"));
        }
        let before_digest = snapshot_digest(before)?;
        if self
            .capsule
            .as_ref()
            .is_some_and(|capsule| capsule.final_snapshot_digest != before_digest)
        {
            return Err(invalid("before snapshot continuity"));
        }
        let after_digest = snapshot_digest(after)?;
        let outcome = match outcome {
            Ok(step) => CurrentReproOutcomeV1::Applied {
                step: Box::new(step.clone()),
                observation: Box::new(observation.clone()),
                snapshot_digest: after_digest.clone(),
            },
            Err(error) => {
                if before != after || before_observation != *observation {
                    return Err(invalid("rejection changed state"));
                }
                CurrentReproOutcomeV1::KernelRejected {
                    error: CurrentReproRejectionV1::from_error(error),
                    observation: Box::new(observation.clone()),
                    snapshot_digest: after_digest.clone(),
                }
            }
        };
        let attempt = CurrentReproAttemptV1 {
            position: self.position,
            origin: origin.map(str::to_owned),
            browser_transport,
            event,
            outcome,
        };
        let base_generation = browser_transport.map(|transition| transition.before_generation);
        // Encode the new attempt once; never traverse or clone retained history.
        let attempt_bytes = encoded_len(&attempt, self.limits.maximum_bytes)
            .ok_or_else(|| invalid("single attempt capture bound"))?;
        let (mut capsule, bytes) = match (self.capsule.take(), self.capsule_bytes.take()) {
            (Some(capsule), Some(bytes)) => (capsule, bytes),
            (None, None) => {
                let capsule = self.empty_capsule(
                    before.clone(),
                    self.position - 1,
                    before_digest.clone(),
                    base_generation,
                );
                let bytes = encoded_len(&capsule, self.limits.maximum_bytes)
                    .ok_or_else(|| invalid("single attempt capture bound"))?;
                (capsule, bytes)
            }
            _ => return Err(invalid("capsule byte cache continuity")),
        };
        let metadata = AppendMetadata {
            position: self.position,
            digest: &after_digest,
            browser_transport,
        };
        let mut next_bytes = append_size(
            &mut capsule,
            bytes,
            attempt_bytes,
            metadata,
            self.limits.maximum_bytes,
        )?;
        if capsule.attempts.len() >= self.limits.maximum_events
            || next_bytes > self.limits.maximum_bytes
        {
            // Only the replacement checkpoint and empty envelope are recounted;
            // the evicted tail is dropped without serialization.
            capsule = self.empty_capsule(
                before.clone(),
                self.position - 1,
                before_digest,
                base_generation,
            );
            let bytes = encoded_len(&capsule, self.limits.maximum_bytes)
                .ok_or_else(|| invalid("single attempt capture bound"))?;
            next_bytes = append_size(
                &mut capsule,
                bytes,
                attempt_bytes,
                metadata,
                self.limits.maximum_bytes,
            )?;
        }
        if next_bytes > self.limits.maximum_bytes {
            return Err(invalid("single attempt capture bound"));
        }
        capsule.attempts.push(attempt);
        Ok((capsule, next_bytes))
    }

    fn verified_observation(
        &self,
        snapshot: &CoreGameKernelSnapshotV7,
    ) -> Result<CurrentGameObservation, CurrentReproErrorV1> {
        restored(
            snapshot,
            self.local_seat,
            self.role,
            Arc::clone(&self.content),
        )?
        .observe()
        .map_err(|_| invalid("snapshot observation"))
    }

    fn empty_capsule(
        &self,
        checkpoint: CoreGameKernelSnapshotV7,
        position: u64,
        digest: String,
        generation: Option<SafeU53>,
    ) -> CurrentReproCapsuleV1 {
        CurrentReproCapsuleV1 {
            schema_version: CURRENT_REPRO_SCHEMA_VERSION_V1,
            content_identity: self.content.identity().clone(),
            local_seat: self.local_seat,
            role: self.role,
            browser_transport: generation.map(|generation| CurrentReproBrowserTransportV1 {
                base_generation: generation,
                final_generation: generation,
            }),
            base_position: position,
            checkpoint: Box::new(checkpoint),
            attempts: Vec::new(),
            final_position: position,
            final_snapshot_digest: digest,
        }
    }

    fn gap(&mut self, reason: &str) -> CurrentCaptureStatusV1 {
        self.capsule = None;
        self.capsule_bytes = None;
        self.unavailable_reason = bounded_text(reason, MAXIMUM_ERROR_BYTES);
        self.status()
    }
}

/// Replay in isolation. Ordered effects remain comparison data and are never
/// delivered to storage, transport, rendering, or any other platform adapter.
pub fn replay_current_capsule_v1(
    capsule: &CurrentReproCapsuleV1,
    content: Arc<PreparedGameContentV2>,
    limits: CurrentReproLimitsV1,
) -> Result<CurrentGameSession, CurrentReproErrorV1> {
    capsule.validate(limits)?;
    if capsule.content_identity != *content.identity() {
        return Err(invalid("content_identity"));
    }
    let mut session = restored(
        &capsule.checkpoint,
        capsule.local_seat,
        capsule.role,
        content,
    )?;
    for attempt in &capsule.attempts {
        let before = session
            .snapshot()
            .map_err(|_| divergence(attempt.position, "before snapshot"))?;
        let result = session.apply(attempt.event.clone());
        match (&attempt.outcome, result) {
            (CurrentReproOutcomeV1::Applied { step, .. }, Ok(actual)) => {
                if actual != **step {
                    return Err(divergence(attempt.position, "step"));
                }
            }
            (CurrentReproOutcomeV1::KernelRejected { error, .. }, Err(actual)) => {
                if CurrentReproRejectionV1::from_error(&actual) != *error {
                    return Err(divergence(attempt.position, "rejection"));
                }
                if session
                    .snapshot()
                    .map_err(|_| divergence(attempt.position, "rejected snapshot"))?
                    != before
                {
                    return Err(divergence(attempt.position, "rejection changed state"));
                }
            }
            _ => return Err(divergence(attempt.position, "outcome")),
        }
        let (expected_observation, expected_digest) = attempt.outcome.evidence();
        if session
            .observe()
            .map_err(|_| divergence(attempt.position, "observation"))?
            != *expected_observation
        {
            return Err(divergence(attempt.position, "observation"));
        }
        let snapshot = session
            .snapshot()
            .map_err(|_| divergence(attempt.position, "snapshot"))?;
        if snapshot_digest(&snapshot)? != expected_digest {
            return Err(divergence(attempt.position, "snapshot_digest"));
        }
    }
    let final_snapshot = session
        .snapshot()
        .map_err(|_| divergence(capsule.final_position, "final snapshot"))?;
    if snapshot_digest(&final_snapshot)? != capsule.final_snapshot_digest {
        return Err(divergence(capsule.final_position, "final_snapshot_digest"));
    }
    Ok(session)
}

fn restored(
    snapshot: &CoreGameKernelSnapshotV7,
    seat: SeatId,
    role: GameKernelRoleV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<CurrentGameSession, CurrentReproErrorV1> {
    CurrentGameSession::from_snapshot(snapshot.clone(), seat, role, content)
        .map_err(|_| invalid("checkpoint snapshot/context"))
}

fn snapshot_digest(snapshot: &CoreGameKernelSnapshotV7) -> Result<String, CurrentReproErrorV1> {
    content_digest(snapshot)
        .map(|digest| format!("blake3-v1:{digest}"))
        .map_err(|_| invalid("snapshot digest"))
}

fn invalid(field: &str) -> CurrentReproErrorV1 {
    CurrentReproErrorV1::Invalid {
        field: field.to_owned(),
    }
}
fn divergence(position: u64, field: &'static str) -> CurrentReproErrorV1 {
    CurrentReproErrorV1::Divergence { position, field }
}

fn bounded_text(value: &str, maximum: usize) -> String {
    let mut end = value.len().min(maximum);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_owned()
}

fn valid_browser_transition(
    event: &CurrentExternalEvent,
    applied: bool,
    transition: CurrentReproBrowserTransitionV1,
) -> bool {
    let before = transition.before_generation;
    let after = transition.after_generation;
    if before == SafeU53::ZERO || after == SafeU53::ZERO {
        return false;
    }
    match event {
        CurrentExternalEvent::NetworkFrame { generation, .. } => {
            *generation == ConnectionGeneration::new(before) && after == before
        }
        CurrentExternalEvent::TransportChanged { generation, .. } => {
            *generation >= ConnectionGeneration::new(before)
                && if applied {
                    *generation == ConnectionGeneration::new(after)
                } else {
                    after == before
                }
        }
        _ => after == before,
    }
}

/// Count serialized bytes without allocating an unbounded temporary output.
fn fits(value: &impl Serialize, maximum: usize) -> bool {
    encoded_len(value, maximum).is_some()
}

fn encoded_len(value: &impl Serialize, maximum: usize) -> Option<usize> {
    let mut counter = BoundedCounter { remaining: maximum };
    serde_json::to_writer(&mut counter, value).ok()?;
    Some(maximum - counter.remaining)
}

// These are exactly the fields changed by appending a retained attempt. Encoding
// both metadata views handles decimal-width changes, string escapes and optional
// browser context without guessing their serialized byte deltas.
#[derive(Serialize)]
struct MutableCapsuleMetadata<'a> {
    final_position: u64,
    final_snapshot_digest: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    browser_transport: Option<CurrentReproBrowserTransportV1>,
}

fn metadata_bytes(
    capsule: &CurrentReproCapsuleV1,
    maximum: usize,
) -> Result<usize, CurrentReproErrorV1> {
    encoded_len(
        &MutableCapsuleMetadata {
            final_position: capsule.final_position,
            final_snapshot_digest: &capsule.final_snapshot_digest,
            browser_transport: capsule.browser_transport,
        },
        maximum,
    )
    .ok_or_else(|| invalid("capsule metadata byte bound"))
}

#[derive(Clone, Copy)]
struct AppendMetadata<'a> {
    position: u64,
    digest: &'a str,
    browser_transport: Option<CurrentReproBrowserTransitionV1>,
}

fn append_size(
    capsule: &mut CurrentReproCapsuleV1,
    bytes: usize,
    attempt_bytes: usize,
    metadata: AppendMetadata<'_>,
    maximum: usize,
) -> Result<usize, CurrentReproErrorV1> {
    let previous_metadata = metadata_bytes(capsule, maximum)?;
    capsule.final_position = metadata.position;
    capsule.final_snapshot_digest = metadata.digest.to_owned();
    if let (Some(context), Some(transition)) =
        (&mut capsule.browser_transport, metadata.browser_transport)
    {
        context.final_generation = transition.after_generation;
    }
    let next_metadata = metadata_bytes(capsule, maximum)?;
    // Existing [] delimiters remain; every append after the first adds one comma.
    bytes
        .checked_sub(previous_metadata)
        .and_then(|size| size.checked_add(next_metadata))
        .and_then(|size| size.checked_add(attempt_bytes))
        .and_then(|size| size.checked_add(usize::from(!capsule.attempts.is_empty())))
        .ok_or_else(|| invalid("capsule byte count overflow"))
}

#[derive(Debug)]
struct BoundedCounter {
    remaining: usize,
}
impl Write for BoundedCounter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.remaining {
            return Err(io::Error::other("capture byte bound"));
        }
        self.remaining -= bytes.len();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
