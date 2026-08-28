//! Backend-free M7.1 model request and recorded-response boundary.

use serde::{Deserialize, Serialize};

pub const MODEL_BOUNDARY_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum ModelRequestV1 {
    BattlePolicy(Vec<u8>),
    RunPolicy(Vec<u8>),
    DifficultyEstimate(Vec<u8>),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelResponseEnvelopeV1 {
    pub request_id: String,
    pub model_hash: String,
    pub backend: String,
    pub output: Vec<i64>,
    pub latency_micros: u64,
}
