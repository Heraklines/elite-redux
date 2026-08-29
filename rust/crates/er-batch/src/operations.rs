//! Ordered raw-input, virtual-time, reset, and snapshot batch operations.

use er_devplane::{PairEndpoint, SessionMachineV1};
use er_types::{RawInputEvent, SafeU53};

use crate::{BatchEnvironmentIdV1, BatchEnvironmentV1, BatchErrorV1, BatchSnapshotV1};

#[derive(Clone, Debug, PartialEq)]
pub enum BatchOperationV1 {
    RawInput {
        environment: BatchEnvironmentIdV1,
        endpoint: Option<PairEndpoint>,
        input: RawInputEvent,
    },
    AdvanceTime {
        environment: BatchEnvironmentIdV1,
        milliseconds: SafeU53,
    },
    Snapshot {
        environment: BatchEnvironmentIdV1,
    },
    Reset {
        environment: BatchEnvironmentIdV1,
        snapshot: Box<BatchSnapshotV1>,
    },
}

impl BatchOperationV1 {
    fn environment(&self) -> BatchEnvironmentIdV1 {
        match self {
            Self::RawInput { environment, .. }
            | Self::AdvanceTime { environment, .. }
            | Self::Snapshot { environment }
            | Self::Reset { environment, .. } => *environment,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct BatchOperationResultV1 {
    pub ordinal: usize,
    pub environment: BatchEnvironmentIdV1,
    pub result: Result<Option<BatchSnapshotV1>, String>,
}

impl BatchEnvironmentV1 {
    pub fn snapshot_one(&self, id: BatchEnvironmentIdV1) -> Result<BatchSnapshotV1, BatchErrorV1> {
        let session = self.entries.get(&id).ok_or(BatchErrorV1::Missing)?;
        match &session.machine {
            SessionMachineV1::Solo(machine) => machine
                .snapshot()
                .map(|snapshot| BatchSnapshotV1::Solo(Box::new(snapshot)))
                .map_err(|error| BatchErrorV1::Environment(error.to_string())),
            SessionMachineV1::Pair(machine) => machine
                .snapshot()
                .map(|snapshot| BatchSnapshotV1::Pair(Box::new(snapshot)))
                .map_err(|error| BatchErrorV1::Environment(error.to_string())),
        }
    }

    pub fn reset_one(
        &mut self,
        id: BatchEnvironmentIdV1,
        snapshot: BatchSnapshotV1,
    ) -> Result<(), BatchErrorV1> {
        let session = self.entries.get_mut(&id).ok_or(BatchErrorV1::Missing)?;
        match (&mut session.machine, snapshot) {
            (SessionMachineV1::Solo(machine), BatchSnapshotV1::Solo(snapshot)) => machine
                .restore(*snapshot)
                .map_err(|error| BatchErrorV1::Environment(error.to_string())),
            (SessionMachineV1::Pair(machine), BatchSnapshotV1::Pair(snapshot)) => machine
                .restore(*snapshot)
                .map_err(|error| BatchErrorV1::Environment(error.to_string())),
            _ => Err(BatchErrorV1::Invalid),
        }
    }

    pub fn execute_schedule(
        &mut self,
        operations: Vec<BatchOperationV1>,
    ) -> Vec<BatchOperationResultV1> {
        let mut indexed = operations.into_iter().enumerate().collect::<Vec<_>>();
        indexed.sort_by_key(|(ordinal, operation)| (operation.environment(), *ordinal));
        indexed
            .into_iter()
            .map(|(ordinal, operation)| {
                let environment = operation.environment();
                let result = match operation {
                    BatchOperationV1::RawInput {
                        endpoint, input, ..
                    } => self
                        .entries
                        .get_mut(&environment)
                        .ok_or(BatchErrorV1::Missing)
                        .and_then(|session| match (&mut session.machine, endpoint) {
                            (SessionMachineV1::Solo(machine), None) => machine
                                .raw_input(input)
                                .map(|_| None)
                                .map_err(|error| BatchErrorV1::Environment(error.to_string())),
                            (SessionMachineV1::Pair(machine), Some(endpoint)) => machine
                                .raw_input(endpoint, input)
                                .map(|_| None)
                                .map_err(|error| BatchErrorV1::Environment(error.to_string())),
                            _ => Err(BatchErrorV1::Invalid),
                        }),
                    BatchOperationV1::AdvanceTime { milliseconds, .. } => self
                        .entries
                        .get_mut(&environment)
                        .ok_or(BatchErrorV1::Missing)
                        .and_then(|session| match &mut session.machine {
                            SessionMachineV1::Solo(machine) => machine
                                .advance_time(milliseconds)
                                .map(|_| None)
                                .map_err(|error| BatchErrorV1::Environment(error.to_string())),
                            SessionMachineV1::Pair(machine) => machine
                                .advance_time(milliseconds)
                                .map(|_| None)
                                .map_err(|error| BatchErrorV1::Environment(error.to_string())),
                        }),
                    BatchOperationV1::Snapshot { .. } => self.snapshot_one(environment).map(Some),
                    BatchOperationV1::Reset { snapshot, .. } => {
                        self.reset_one(environment, *snapshot).map(|()| None)
                    }
                };
                BatchOperationResultV1 {
                    ordinal,
                    environment,
                    result: result.map_err(|error| error.to_string()),
                }
            })
            .collect()
    }
}
