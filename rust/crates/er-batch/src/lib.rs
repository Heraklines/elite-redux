//! Single-thread deterministic batch execution over production DeveloperSession.

use std::collections::BTreeMap;

use er_devplane::{
    DeveloperSession, PairEndpoint, PairSnapshotV2, SessionMachineV1, SoloSnapshotV6,
};
use er_types::{RawInputEvent, SafeU53};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const BATCH_ENVIRONMENT_VERSION_V1: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct BatchEnvironmentIdV1(pub u64);

#[derive(Clone, Debug, PartialEq)]
pub enum BatchSnapshotV1 {
    Solo(SoloSnapshotV6),
    Pair(PairSnapshotV2),
}

#[derive(Debug, Error)]
pub enum BatchErrorV1 {
    #[error("batch capacity or environment identity is invalid")]
    Invalid,
    #[error("batch capacity is exhausted")]
    Capacity,
    #[error("batch environment does not exist")]
    Missing,
    #[error("batch environment operation failed: {0}")]
    Environment(String),
}

#[derive(Debug)]
pub struct BatchEnvironmentV1 {
    maximum_environments: usize,
    entries: BTreeMap<BatchEnvironmentIdV1, DeveloperSession>,
}

impl BatchEnvironmentV1 {
    pub fn new(maximum_environments: usize) -> Result<Self, BatchErrorV1> {
        if maximum_environments == 0 {
            return Err(BatchErrorV1::Invalid);
        }
        Ok(Self {
            maximum_environments,
            entries: BTreeMap::new(),
        })
    }

    pub fn insert(
        &mut self,
        id: BatchEnvironmentIdV1,
        session: DeveloperSession,
    ) -> Result<(), BatchErrorV1> {
        if self.entries.contains_key(&id) {
            return Err(BatchErrorV1::Invalid);
        }
        if self.entries.len() >= self.maximum_environments {
            return Err(BatchErrorV1::Capacity);
        }
        self.entries.insert(id, session);
        Ok(())
    }

    pub fn raw_input_batch(
        &mut self,
        operations: Vec<(BatchEnvironmentIdV1, Option<PairEndpoint>, RawInputEvent)>,
    ) -> Vec<(BatchEnvironmentIdV1, Result<(), String>)> {
        let mut operations = operations;
        operations.sort_by_key(|(id, _, _)| *id);
        operations
            .into_iter()
            .map(|(id, endpoint, input)| {
                let result = self
                    .entries
                    .get_mut(&id)
                    .ok_or_else(|| BatchErrorV1::Missing.to_string())
                    .and_then(|session| match (&mut session.machine, endpoint) {
                        (SessionMachineV1::Solo(machine), None) => machine
                            .raw_input(input)
                            .map(|_| ())
                            .map_err(|error| error.to_string()),
                        (SessionMachineV1::Pair(machine), Some(endpoint)) => machine
                            .raw_input(endpoint, input)
                            .map(|_| ())
                            .map_err(|error| error.to_string()),
                        _ => Err(BatchErrorV1::Invalid.to_string()),
                    });
                (id, result)
            })
            .collect()
    }

    pub fn advance_time_batch(
        &mut self,
        operations: Vec<(BatchEnvironmentIdV1, SafeU53)>,
    ) -> Vec<(BatchEnvironmentIdV1, Result<(), String>)> {
        let mut operations = operations;
        operations.sort_by_key(|(id, _)| *id);
        operations
            .into_iter()
            .map(|(id, delta)| {
                let result = self
                    .entries
                    .get_mut(&id)
                    .ok_or_else(|| BatchErrorV1::Missing.to_string())
                    .and_then(|session| match &mut session.machine {
                        SessionMachineV1::Solo(machine) => machine
                            .advance_time(delta)
                            .map(|_| ())
                            .map_err(|error| error.to_string()),
                        SessionMachineV1::Pair(machine) => machine
                            .advance_time(delta)
                            .map(|_| ())
                            .map_err(|error| error.to_string()),
                    });
                (id, result)
            })
            .collect()
    }

    pub fn snapshot_batch(&self) -> Vec<(BatchEnvironmentIdV1, Result<BatchSnapshotV1, String>)> {
        self.entries
            .iter()
            .map(|(id, session)| {
                let snapshot = match &session.machine {
                    SessionMachineV1::Solo(machine) => machine
                        .snapshot()
                        .map(BatchSnapshotV1::Solo)
                        .map_err(|error| error.to_string()),
                    SessionMachineV1::Pair(machine) => machine
                        .snapshot()
                        .map(BatchSnapshotV1::Pair)
                        .map_err(|error| error.to_string()),
                };
                (*id, snapshot)
            })
            .collect()
    }

    pub fn close(&mut self) -> Vec<(BatchEnvironmentIdV1, Result<(), String>)> {
        let mut results = Vec::with_capacity(self.entries.len());
        for (id, session) in &mut self.entries {
            results.push((
                *id,
                session
                    .close("batch-close")
                    .map_err(|error| error.to_string()),
            ));
        }
        self.entries.clear();
        results
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}
