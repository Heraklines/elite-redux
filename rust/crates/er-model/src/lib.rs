//! Backend-free M7.1 model request and recorded-response boundary.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const MODEL_BOUNDARY_VERSION_V1: u32 = 1;

macro_rules! string_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub String);
    };
}

string_id!(ModelRequestIdV1);
string_id!(ModelSlotIdV1);
string_id!(ModelHashV1);
string_id!(InferenceBackendIdV1);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattlePolicyObservationV1 {
    pub observation_bytes: Vec<u8>,
    pub legal_action_ids: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunPolicyObservationV1 {
    pub observation_bytes: Vec<u8>,
    pub legal_action_ids: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DifficultyObservationV1 {
    pub observation_bytes: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum ModelRequestV1 {
    BattlePolicy(BattlePolicyObservationV1),
    RunPolicy(RunPolicyObservationV1),
    DifficultyEstimate(DifficultyObservationV1),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelRequestEnvelopeV1 {
    pub request_id: ModelRequestIdV1,
    pub model_slot: ModelSlotIdV1,
    pub model_hash: ModelHashV1,
    pub authority_only: bool,
    pub request: ModelRequestV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum ModelOutputV1 {
    LegalAction(String),
    QuantizedScores(Vec<(String, i64)>),
    DifficultyBasisPoints(i64),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelResponseEnvelopeV1 {
    pub request_id: ModelRequestIdV1,
    pub model_hash: ModelHashV1,
    pub backend: InferenceBackendIdV1,
    pub output: ModelOutputV1,
    pub latency_micros: u64,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ModelBoundaryErrorV1 {
    #[error("replica cannot issue a canonical model request")]
    ReplicaRequest,
    #[error("model identity or observation is empty")]
    Invalid,
    #[error("model response does not match its request")]
    ResponseMismatch,
    #[error("model output is outside the legal-action set")]
    IllegalOutput,
    #[error("recorded model response conflicts with prior evidence")]
    Conflict,
}

impl ModelRequestEnvelopeV1 {
    pub fn validate(&self, caller_is_authority: bool) -> Result<(), ModelBoundaryErrorV1> {
        if self.authority_only && !caller_is_authority {
            return Err(ModelBoundaryErrorV1::ReplicaRequest);
        }
        if self.request_id.0.is_empty()
            || self.model_slot.0.is_empty()
            || self.model_hash.0.is_empty()
        {
            return Err(ModelBoundaryErrorV1::Invalid);
        }
        let legal = legal_actions(&self.request);
        if legal.iter().any(String::is_empty)
            || legal.len() != legal.iter().collect::<BTreeSet<_>>().len()
        {
            return Err(ModelBoundaryErrorV1::Invalid);
        }
        Ok(())
    }

    pub fn validate_response(
        &self,
        response: &ModelResponseEnvelopeV1,
    ) -> Result<(), ModelBoundaryErrorV1> {
        if response.request_id != self.request_id
            || response.model_hash != self.model_hash
            || response.backend.0.is_empty()
        {
            return Err(ModelBoundaryErrorV1::ResponseMismatch);
        }
        let legal = legal_actions(&self.request);
        match &response.output {
            ModelOutputV1::LegalAction(action) if !legal.contains(action) => {
                Err(ModelBoundaryErrorV1::IllegalOutput)
            }
            ModelOutputV1::QuantizedScores(scores)
                if scores.is_empty()
                    || scores.iter().any(|(action, _)| !legal.contains(action))
                    || scores.len()
                        != scores
                            .iter()
                            .map(|(action, _)| action)
                            .collect::<BTreeSet<_>>()
                            .len() =>
            {
                Err(ModelBoundaryErrorV1::IllegalOutput)
            }
            ModelOutputV1::DifficultyBasisPoints(_)
                if !matches!(self.request, ModelRequestV1::DifficultyEstimate(_)) =>
            {
                Err(ModelBoundaryErrorV1::IllegalOutput)
            }
            _ => Ok(()),
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RecordedModelResponseLedgerV1 {
    responses: BTreeMap<ModelRequestIdV1, ModelResponseEnvelopeV1>,
}

impl RecordedModelResponseLedgerV1 {
    pub fn record(
        &mut self,
        request: &ModelRequestEnvelopeV1,
        response: ModelResponseEnvelopeV1,
    ) -> Result<bool, ModelBoundaryErrorV1> {
        request.validate_response(&response)?;
        if let Some(existing) = self.responses.get(&response.request_id) {
            return if existing == &response {
                Ok(false)
            } else {
                Err(ModelBoundaryErrorV1::Conflict)
            };
        }
        self.responses.insert(response.request_id.clone(), response);
        Ok(true)
    }

    pub fn replay(&self, request_id: &ModelRequestIdV1) -> Option<&ModelResponseEnvelopeV1> {
        self.responses.get(request_id)
    }
}

fn legal_actions(request: &ModelRequestV1) -> &Vec<String> {
    match request {
        ModelRequestV1::BattlePolicy(observation) => &observation.legal_action_ids,
        ModelRequestV1::RunPolicy(observation) => &observation.legal_action_ids,
        ModelRequestV1::DifficultyEstimate(_) => {
            static EMPTY: std::sync::LazyLock<Vec<String>> = std::sync::LazyLock::new(Vec::new);
            &EMPTY
        }
    }
}
