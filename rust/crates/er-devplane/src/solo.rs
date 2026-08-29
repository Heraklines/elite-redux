//! Solo developer session over the production GameEnvironment.

use er_env::{EnvironmentError, GameEffect, GameEnvironment, GameObservation};
use er_kernel::snapshot_v6::RestorableKernelSnapshotV6;
use er_types::{RawInputEvent, SafeU53};
use thiserror::Error;

#[derive(Debug)]
pub struct SoloSessionMachineV1 {
    environment: Option<GameEnvironment>,
    external_sequence: SafeU53,
    virtual_time_ms: SafeU53,
}

#[derive(Debug, Error)]
pub enum SoloSessionErrorV1 {
    #[error("developer session is closed")]
    Closed,
    #[error("developer session sequence/time overflowed")]
    Overflow,
    #[error("production environment failed: {0}")]
    Environment(String),
}

impl SoloSessionMachineV1 {
    pub fn new(environment: GameEnvironment) -> Self {
        Self {
            environment: Some(environment),
            external_sequence: SafeU53::ZERO,
            virtual_time_ms: SafeU53::ZERO,
        }
    }

    pub fn observe(&self) -> Result<GameObservation, SoloSessionErrorV1> {
        self.environment()?.observe().map_err(map_environment)
    }

    pub fn raw_input(
        &mut self,
        input: RawInputEvent,
    ) -> Result<Vec<GameEffect>, SoloSessionErrorV1> {
        let effects = self
            .environment_mut()?
            .raw_input(input)
            .map_err(map_environment)?;
        self.advance_sequence()?;
        Ok(effects)
    }

    pub fn advance_time(
        &mut self,
        milliseconds: SafeU53,
    ) -> Result<Vec<GameEffect>, SoloSessionErrorV1> {
        let next_time = self
            .virtual_time_ms
            .get()
            .checked_add(milliseconds.get())
            .and_then(|value| SafeU53::new(value).ok())
            .ok_or(SoloSessionErrorV1::Overflow)?;
        let effects = self
            .environment_mut()?
            .advance_time(milliseconds)
            .map_err(map_environment)?;
        self.virtual_time_ms = next_time;
        self.advance_sequence()?;
        Ok(effects)
    }

    pub fn snapshot(&self) -> Result<RestorableKernelSnapshotV6, SoloSessionErrorV1> {
        Ok(self.environment()?.snapshot())
    }

    pub fn restore(
        &mut self,
        snapshot: RestorableKernelSnapshotV6,
    ) -> Result<(), SoloSessionErrorV1> {
        self.environment_mut()?
            .reset(snapshot)
            .map_err(map_environment)?;
        self.advance_sequence()
    }

    pub fn external_sequence(&self) -> SafeU53 {
        self.external_sequence
    }

    pub fn virtual_time_ms(&self) -> SafeU53 {
        self.virtual_time_ms
    }

    pub fn close(&mut self) {
        self.environment = None;
    }

    pub fn is_closed(&self) -> bool {
        self.environment.is_none()
    }

    fn environment(&self) -> Result<&GameEnvironment, SoloSessionErrorV1> {
        self.environment.as_ref().ok_or(SoloSessionErrorV1::Closed)
    }

    fn environment_mut(&mut self) -> Result<&mut GameEnvironment, SoloSessionErrorV1> {
        self.environment.as_mut().ok_or(SoloSessionErrorV1::Closed)
    }

    fn advance_sequence(&mut self) -> Result<(), SoloSessionErrorV1> {
        self.external_sequence = SafeU53::new(
            self.external_sequence
                .get()
                .checked_add(1)
                .ok_or(SoloSessionErrorV1::Overflow)?,
        )
        .map_err(|_| SoloSessionErrorV1::Overflow)?;
        Ok(())
    }
}

fn map_environment(error: EnvironmentError) -> SoloSessionErrorV1 {
    SoloSessionErrorV1::Environment(error.to_string())
}
