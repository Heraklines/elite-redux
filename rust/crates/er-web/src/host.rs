//! G39 compileable browser host boundary; runtime execution is implemented in M8A.

use er_types::SafeU53;
use thiserror::Error;
use wasm_bindgen::prelude::*;

use crate::contracts::{
    BROWSER_WORKER_PROTOCOL_VERSION_V1, BrowserKernelFaultV1, BrowserRequestEnvelopeV1,
    BrowserResponseEnvelopeV1, BrowserResponseV1,
};

const MAX_G39_STUB_BYTES: usize = 1_048_576;

#[derive(Debug, Error)]
pub enum BrowserWebErrorV1 {
    #[error("browser host message is empty, oversized, malformed, or versioned incorrectly")]
    InvalidMessage,
    #[error("browser request sequence is stale or non-monotonic")]
    Sequence,
    #[error("browser host is disposed")]
    Disposed,
    #[error("browser host runtime is not initialized before M8A")]
    NotInitialized,
}

#[wasm_bindgen]
#[derive(Debug)]
pub struct BrowserKernelHostV1 {
    accepted_sequence: SafeU53,
    disposed: bool,
}

#[wasm_bindgen]
impl BrowserKernelHostV1 {
    pub fn create(content_bytes: &[u8], init_bytes: &[u8]) -> Result<BrowserKernelHostV1, JsValue> {
        validate_json_bytes(content_bytes).map_err(js_error)?;
        validate_json_bytes(init_bytes).map_err(js_error)?;
        Ok(Self {
            accepted_sequence: SafeU53::ZERO,
            disposed: false,
        })
    }

    pub fn dispatch_batch(&mut self, request_bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
        if self.disposed {
            return Err(js_error(BrowserWebErrorV1::Disposed));
        }
        if request_bytes.is_empty() || request_bytes.len() > MAX_G39_STUB_BYTES {
            return Err(js_error(BrowserWebErrorV1::InvalidMessage));
        }
        let requests: Vec<BrowserRequestEnvelopeV1> = serde_json::from_slice(request_bytes)
            .map_err(|_| js_error(BrowserWebErrorV1::InvalidMessage))?;
        if requests.is_empty() || requests.len() > 256 {
            return Err(js_error(BrowserWebErrorV1::InvalidMessage));
        }
        let mut expected = self
            .accepted_sequence
            .get()
            .checked_add(1)
            .and_then(|value| SafeU53::new(value).ok())
            .ok_or_else(|| js_error(BrowserWebErrorV1::Sequence))?;
        let mut accepted_sequence = self.accepted_sequence;
        let mut responses = Vec::with_capacity(requests.len());
        for request in requests {
            if request.version != BROWSER_WORKER_PROTOCOL_VERSION_V1 || request.sequence != expected
            {
                return Err(js_error(BrowserWebErrorV1::Sequence));
            }
            accepted_sequence = request.sequence;
            expected = expected
                .get()
                .checked_add(1)
                .and_then(|value| SafeU53::new(value).ok())
                .unwrap_or(SafeU53::MAX);
            responses.push(BrowserResponseEnvelopeV1 {
                version: BROWSER_WORKER_PROTOCOL_VERSION_V1,
                request_id: request.request_id,
                accepted_sequence: request.sequence,
                after_mechanical_digest: "uninitialized-g39".to_owned(),
                response: BrowserResponseV1::Fault(BrowserKernelFaultV1 {
                    code: "HOST_NOT_INITIALIZED_G39_STUB".to_owned(),
                    message: BrowserWebErrorV1::NotInitialized.to_string(),
                    normalized_panic: None,
                    repro_reference: None,
                }),
            });
        }
        let encoded = serde_json::to_vec(&responses)
            .map_err(|_| js_error(BrowserWebErrorV1::InvalidMessage))?;
        self.accepted_sequence = accepted_sequence;
        Ok(encoded)
    }

    pub fn snapshot(&self) -> Result<Vec<u8>, JsValue> {
        Err(js_error(if self.disposed {
            BrowserWebErrorV1::Disposed
        } else {
            BrowserWebErrorV1::NotInitialized
        }))
    }

    pub fn export_repro(&self) -> Result<Vec<u8>, JsValue> {
        self.snapshot()
    }

    pub fn dispose(&mut self) {
        self.disposed = true;
    }
}

fn validate_json_bytes(bytes: &[u8]) -> Result<(), BrowserWebErrorV1> {
    if bytes.is_empty() || bytes.len() > MAX_G39_STUB_BYTES {
        return Err(BrowserWebErrorV1::InvalidMessage);
    }
    let _: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| BrowserWebErrorV1::InvalidMessage)?;
    Ok(())
}

fn js_error(error: BrowserWebErrorV1) -> JsValue {
    JsValue::from_str(&error.to_string())
}
