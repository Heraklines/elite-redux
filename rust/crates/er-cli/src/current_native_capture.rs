//! Standalone native diagnostics. Capture failures never undo accepted gameplay.

use er_agent_protocol::{AgentDispatchErrorV1, AgentResponseContextV1};
use er_env::current::{CurrentExternalEvent, CurrentGameSession, CurrentSessionError};
use er_repro::current::{
    CurrentCaptureStatusV1, CurrentReproCapsuleV1, CurrentReproLimitsV1, CurrentReproRecorderV1,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::Arc;

use crate::current_agent::{backend, invalid};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CaptureLimits {
    pub maximum_events: usize,
    pub maximum_bytes: usize,
}

impl Default for CaptureLimits {
    fn default() -> Self {
        let limits = CurrentReproLimitsV1::default();
        Self {
            maximum_events: limits.maximum_events,
            maximum_bytes: limits.maximum_bytes,
        }
    }
}

impl CaptureLimits {
    pub(crate) fn checked(self) -> Result<CurrentReproLimitsV1, AgentDispatchErrorV1> {
        let limits = CurrentReproLimitsV1 {
            maximum_events: self.maximum_events,
            maximum_bytes: self.maximum_bytes,
        };
        limits.validate().map_err(backend)?;
        // Export is inline JSONL; retain at most the established native capture cap.
        if limits.maximum_bytes > CurrentReproLimitsV1::default().maximum_bytes {
            return Err(invalid("native capture maximum_bytes exceeds 2 MiB"));
        }
        Ok(limits)
    }
}

#[derive(Clone, Debug)]
pub(crate) struct NativeCapture {
    recorder: CurrentReproRecorderV1,
    limits: CaptureLimits,
}

enum ApplyError {
    Kernel(CurrentSessionError),
    Adapter(AgentDispatchErrorV1),
}
impl From<CurrentSessionError> for ApplyError {
    fn from(value: CurrentSessionError) -> Self {
        Self::Kernel(value)
    }
}

impl NativeCapture {
    pub(crate) fn checkpoint(
        session: &CurrentGameSession,
        limits: CaptureLimits,
        position: u64,
    ) -> Result<Self, AgentDispatchErrorV1> {
        let (seat, role) = session.session_context().map_err(backend)?;
        let recorder = CurrentReproRecorderV1::new_at_position(
            session.snapshot().map_err(backend)?,
            seat,
            role,
            Arc::clone(session.content()),
            limits.checked()?,
            position,
        )
        .map_err(backend)?;
        Ok(Self { recorder, limits })
    }

    pub(crate) fn imported(
        capsule: CurrentReproCapsuleV1,
        content: Arc<er_game::m9e_content_v2::PreparedGameContentV2>,
        limits: CaptureLimits,
    ) -> Result<(Self, CurrentGameSession), AgentDispatchErrorV1> {
        let browser_origin = capsule.browser_transport.is_some();
        let position = capsule.final_position;
        let (recorder, session) =
            CurrentReproRecorderV1::from_capsule(capsule, content, limits.checked()?)
                .map_err(backend)?;
        let capture = if browser_origin {
            Self::checkpoint(&session, limits, position)?
        } else {
            Self { recorder, limits }
        };
        Ok((capture, session))
    }

    pub(crate) fn status(&self) -> Value {
        json!({"supported": true, "scope": "STANDALONE_NATIVE", "status": self.recorder.status(), "limits": self.limits})
    }

    pub(crate) fn export(&self) -> Result<Value, AgentDispatchErrorV1> {
        Ok(json!({"capsule": self.recorder.export().map_err(backend)?}))
    }

    pub(crate) fn gap(&mut self, reason: &str) {
        let _ = self.recorder.invalidate_attempt(reason);
    }

    pub(crate) fn reset(&self, session: &CurrentGameSession) -> Result<Self, AgentDispatchErrorV1> {
        let position = match self.recorder.status() {
            CurrentCaptureStatusV1::Available { final_position, .. } => final_position,
            CurrentCaptureStatusV1::Unavailable { position, .. } => position,
        };
        let Some(position) = position
            .checked_add(1)
            .filter(|position| *position <= er_repro::current::MAXIMUM_CURRENT_REPRO_POSITION_V1)
        else {
            let mut unavailable = self.clone();
            unavailable.gap("native restore capture position exhausted");
            return Ok(unavailable);
        };
        Self::checkpoint(session, self.limits, position)
    }

    pub(crate) fn apply(
        &mut self,
        session: &mut CurrentGameSession,
        event: CurrentExternalEvent,
        origin: &str,
        context: AgentResponseContextV1<'_>,
    ) -> Result<Value, AgentDispatchErrorV1> {
        let before = match session.snapshot() {
            Ok(snapshot) => snapshot,
            Err(error) => {
                self.gap("native pre-event snapshot unavailable");
                return Err(backend(error));
            }
        };
        let result = session.apply_with(event.clone(), |candidate, step| {
            let observation = candidate
                .observe()
                .map_err(|error| ApplyError::Adapter(backend(error)))?;
            let after = candidate
                .snapshot()
                .map_err(|error| ApplyError::Adapter(backend(error)))?;
            let response = json!({"step": step, "observation": observation});
            context
                .admit_inline_success(&response)
                .map_err(ApplyError::Adapter)?;
            Ok((response, step, observation, after))
        });
        match result {
            Ok((response, step, observation, after)) => {
                let _ = self.recorder.record_with_origin(
                    &before,
                    event,
                    Ok(&step),
                    &after,
                    &observation,
                    Some(origin),
                );
                Ok(response)
            }
            Err(ApplyError::Kernel(error)) => {
                match session.observe() {
                    Ok(observation) => {
                        let _ = self.recorder.record_with_origin(
                            &before,
                            event,
                            Err(&error),
                            &before,
                            &observation,
                            Some(origin),
                        );
                    }
                    Err(_) => self.gap("native rejection observation unavailable"),
                }
                Err(backend(error))
            }
            Err(ApplyError::Adapter(error)) => {
                self.gap("native event response preparation rejected");
                Err(error)
            }
        }
    }
}
