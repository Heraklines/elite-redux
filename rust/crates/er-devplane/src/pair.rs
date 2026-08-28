//! Pair developer session over the production SimulatedPair environment.

use std::sync::Arc;

use er_content::pack::ContentPack;
use er_sim::snapshot::RestorablePairSnapshotV2;
use er_sim::{PairEndpoint, PairOperation, PairStep, SimulatedPair, SimulatedPairError};
use er_types::{RawInputEvent, SafeU53};
use thiserror::Error;

#[derive(Debug)]
pub struct PairSessionMachineV1 {
    pair: Option<SimulatedPair>,
    content: Arc<ContentPack>,
    external_sequence: SafeU53,
    virtual_time_ms: SafeU53,
}

#[derive(Debug, Error)]
pub enum PairSessionErrorV1 {
    #[error("pair developer session is closed")]
    Closed,
    #[error("pair developer session sequence/time overflowed")]
    Overflow,
    #[error("production pair failed: {0}")]
    Pair(String),
    #[error("pair snapshot failed: {0}")]
    Snapshot(String),
}

impl PairSessionMachineV1 {
    pub fn new(pair: SimulatedPair, content: Arc<ContentPack>) -> Self {
        Self {
            pair: Some(pair),
            content,
            external_sequence: SafeU53::ZERO,
            virtual_time_ms: SafeU53::ZERO,
        }
    }

    pub fn from_snapshot(
        snapshot: RestorablePairSnapshotV2,
        content: Arc<ContentPack>,
    ) -> Result<Self, PairSessionErrorV1> {
        let pair = SimulatedPair::from_snapshot_v2(snapshot, content.clone())
            .map_err(|error| PairSessionErrorV1::Snapshot(error.to_string()))?;
        Ok(Self::new(pair, content))
    }

    pub fn raw_input(
        &mut self,
        endpoint: PairEndpoint,
        event: RawInputEvent,
    ) -> Result<PairStep, PairSessionErrorV1> {
        let step = self
            .pair_mut()?
            .apply(PairOperation::RawInput { endpoint, event })
            .map_err(map_pair)?;
        self.advance_sequence()?;
        Ok(step)
    }

    pub fn advance_time(&mut self, delta_ms: SafeU53) -> Result<PairStep, PairSessionErrorV1> {
        let next = self
            .virtual_time_ms
            .get()
            .checked_add(delta_ms.get())
            .and_then(|value| SafeU53::new(value).ok())
            .ok_or(PairSessionErrorV1::Overflow)?;
        let step = self.pair_mut()?.advance_time(delta_ms).map_err(map_pair)?;
        self.virtual_time_ms = next;
        self.advance_sequence()?;
        Ok(step)
    }

    pub fn apply_external(
        &mut self,
        operation: PairOperation,
    ) -> Result<PairStep, PairSessionErrorV1> {
        let step = self.pair_mut()?.apply(operation).map_err(map_pair)?;
        self.advance_sequence()?;
        Ok(step)
    }

    pub fn snapshot(&self) -> Result<RestorablePairSnapshotV2, PairSessionErrorV1> {
        self.pair()?
            .snapshot_v2()
            .map_err(|error| PairSessionErrorV1::Snapshot(error.to_string()))
    }

    pub fn restore(
        &mut self,
        snapshot: RestorablePairSnapshotV2,
    ) -> Result<(), PairSessionErrorV1> {
        let restored = SimulatedPair::from_snapshot_v2(snapshot, self.content.clone())
            .map_err(|error| PairSessionErrorV1::Snapshot(error.to_string()))?;
        self.pair = Some(restored);
        self.advance_sequence()
    }

    pub fn try_fork(&self) -> Result<Self, PairSessionErrorV1> {
        let fork = self.pair()?.try_fork().map_err(map_pair)?;
        Ok(Self {
            pair: Some(fork),
            content: self.content.clone(),
            external_sequence: self.external_sequence,
            virtual_time_ms: self.virtual_time_ms,
        })
    }

    pub fn close(&mut self, reason: &str) -> Result<(), PairSessionErrorV1> {
        if let Some(pair) = self.pair.as_mut() {
            pair.teardown(reason).map_err(map_pair)?;
        }
        self.pair = None;
        Ok(())
    }

    pub fn external_sequence(&self) -> SafeU53 {
        self.external_sequence
    }

    pub fn virtual_time_ms(&self) -> SafeU53 {
        self.virtual_time_ms
    }

    fn pair(&self) -> Result<&SimulatedPair, PairSessionErrorV1> {
        self.pair.as_ref().ok_or(PairSessionErrorV1::Closed)
    }

    fn pair_mut(&mut self) -> Result<&mut SimulatedPair, PairSessionErrorV1> {
        self.pair.as_mut().ok_or(PairSessionErrorV1::Closed)
    }

    fn advance_sequence(&mut self) -> Result<(), PairSessionErrorV1> {
        self.external_sequence = SafeU53::new(
            self.external_sequence
                .get()
                .checked_add(1)
                .ok_or(PairSessionErrorV1::Overflow)?,
        )
        .map_err(|_| PairSessionErrorV1::Overflow)?;
        Ok(())
    }
}

fn map_pair(error: SimulatedPairError) -> PairSessionErrorV1 {
    PairSessionErrorV1::Pair(error.to_string())
}
