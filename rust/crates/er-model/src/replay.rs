//! Backend-independent recording and replay of mechanically active model responses.

use er_canonical::canonical_bytes;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    ModelBoundaryErrorV1, ModelHashV1, ModelRequestEnvelopeV1, ModelRequestIdV1,
    ModelResponseEnvelopeV1,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelReplayRecordV1 {
    pub request: ModelRequestEnvelopeV1,
    pub response: ModelResponseEnvelopeV1,
    pub mechanical_response_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordedModelReplayV1 {
    pub schema_version: u32,
    pub maximum_records: usize,
    pub records: Vec<ModelReplayRecordV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ModelReplayErrorV1 {
    #[error("model replay bound is zero or exceeded")]
    Bounds,
    #[error("model replay record is invalid: {0}")]
    Boundary(String),
    #[error("model replay request identity is missing or conflicting")]
    Identity,
    #[error("active model hash is incompatible with the recorded response")]
    ModelHash,
    #[error("model replay digest failed: {0}")]
    Canonical(String),
}

impl RecordedModelReplayV1 {
    pub fn new(maximum_records: usize) -> Result<Self, ModelReplayErrorV1> {
        if maximum_records == 0 {
            return Err(ModelReplayErrorV1::Bounds);
        }
        Ok(Self {
            schema_version: 1,
            maximum_records,
            records: Vec::new(),
        })
    }

    pub fn record(
        &mut self,
        request: ModelRequestEnvelopeV1,
        response: ModelResponseEnvelopeV1,
    ) -> Result<bool, ModelReplayErrorV1> {
        if self.schema_version != 1 || self.maximum_records == 0 {
            return Err(ModelReplayErrorV1::Bounds);
        }
        request.validate(true).map_err(map_boundary_error)?;
        request
            .validate_response(&response)
            .map_err(map_boundary_error)?;
        let digest = mechanical_response_digest_v1(&response)?;
        let record = ModelReplayRecordV1 {
            request,
            response,
            mechanical_response_digest: digest,
        };
        match self.records.binary_search_by(|existing| {
            existing.request.request_id.cmp(&record.request.request_id)
        }) {
            Ok(index) if self.records.get(index) == Some(&record) => Ok(false),
            Ok(_) => Err(ModelReplayErrorV1::Identity),
            Err(index) => {
                if self.records.len() == self.maximum_records {
                    return Err(ModelReplayErrorV1::Bounds);
                }
                self.records.insert(index, record);
                Ok(true)
            }
        }
    }

    pub fn replay(
        &self,
        request_id: &ModelRequestIdV1,
        active_model_hash: &ModelHashV1,
    ) -> Result<&ModelResponseEnvelopeV1, ModelReplayErrorV1> {
        let index = self
            .records
            .binary_search_by(|record| record.request.request_id.cmp(request_id))
            .map_err(|_| ModelReplayErrorV1::Identity)?;
        let record = self
            .records
            .get(index)
            .ok_or(ModelReplayErrorV1::Identity)?;
        if &record.request.model_hash != active_model_hash
            || &record.response.model_hash != active_model_hash
        {
            return Err(ModelReplayErrorV1::ModelHash);
        }
        if mechanical_response_digest_v1(&record.response)? != record.mechanical_response_digest {
            return Err(ModelReplayErrorV1::Identity);
        }
        Ok(&record.response)
    }

    pub fn validate(&self) -> Result<(), ModelReplayErrorV1> {
        if self.schema_version != 1
            || self.maximum_records == 0
            || self.records.len() > self.maximum_records
            || self
                .records
                .windows(2)
                .any(|pair| pair[0].request.request_id >= pair[1].request.request_id)
        {
            return Err(ModelReplayErrorV1::Bounds);
        }
        for record in &self.records {
            record.request.validate(true).map_err(map_boundary_error)?;
            record
                .request
                .validate_response(&record.response)
                .map_err(map_boundary_error)?;
            if mechanical_response_digest_v1(&record.response)? != record.mechanical_response_digest
            {
                return Err(ModelReplayErrorV1::Identity);
            }
        }
        Ok(())
    }
}

pub fn mechanical_response_digest_v1(
    response: &ModelResponseEnvelopeV1,
) -> Result<String, ModelReplayErrorV1> {
    let bytes = canonical_bytes(&(
        "elite-redux/m71/model-response/v1",
        &response.request_id,
        &response.model_hash,
        &response.output,
    ))
    .map_err(|error| ModelReplayErrorV1::Canonical(error.to_string()))?;
    Ok(format!("blake3-v1:{}", blake3::hash(&bytes).to_hex()))
}

fn map_boundary_error(error: ModelBoundaryErrorV1) -> ModelReplayErrorV1 {
    ModelReplayErrorV1::Boundary(error.to_string())
}
