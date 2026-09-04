//! Typed results for the current ABI2 process endpoint.

use std::time::Duration;

use er_env::current::CurrentGameObservation;
use er_kernel::game_kernel_v7::GameKernelStepV7;
use er_kernel_worker::KernelWorkerFaultV2;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentGenerationStepV2 {
    pub step: GameKernelStepV7,
    pub observation: CurrentGameObservation,
}

#[derive(Clone, Copy, Debug)]
pub struct KernelWorkerDeadlinesV2 {
    /// Includes both writing the request and reading its response.
    pub request_timeout: Duration,
    /// Bounds process-exit and pipe-thread cleanup waits.
    pub shutdown_timeout: Duration,
}

impl Default for KernelWorkerDeadlinesV2 {
    fn default() -> Self {
        Self {
            request_timeout: Duration::from_secs(10),
            shutdown_timeout: Duration::from_secs(2),
        }
    }
}

#[derive(Debug, Error)]
pub enum KernelEndpointErrorV2 {
    #[error("current worker artifact rejected: {0}")]
    Artifact(String),
    #[error("current worker process failed: {0}")]
    Process(String),
    #[error("current worker protocol rejected: {0}")]
    Protocol(String),
    #[error("current worker rejected the request: {0:?}")]
    Fault(KernelWorkerFaultV2),
    #[error("current worker deadline exceeded: {0}")]
    Deadline(&'static str),
    #[error("current worker endpoint is closed or fenced")]
    Closed,
    #[error("current worker endpoint request counter exhausted")]
    ResourceExhausted,
}
