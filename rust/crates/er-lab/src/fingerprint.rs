//! Canonical failure fingerprints for deterministic clustering.

use er_dev_types::{CausalSourceV1, StatePathV1};
use er_types::GameBehaviorUnitId;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::scenario::ContentIdentityV1;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FailureClassV1 {
    Invariant,
    DigestDivergence,
    Terminal,
    Panic,
    ResourceLeak,
    Performance,
    Assertion,
    Build,
    Incompatible,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FailureFingerprintV1 {
    pub class: FailureClassV1,
    pub first_divergent_path: Option<StatePathV1>,
    pub causal_source: Option<CausalSourceV1>,
    pub terminal_reason: Option<String>,
    pub normalized_panic: Option<String>,
    pub behaviors: Vec<GameBehaviorUnitId>,
    pub content: Vec<ContentIdentityV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum FingerprintErrorV1 {
    #[error("failure fingerprint is empty, unsorted, or class-inconsistent")]
    Invalid,
    #[error("failure fingerprint encoding failed: {0}")]
    Canonical(String),
}

impl FailureFingerprintV1 {
    pub fn normalize(mut self) -> Result<Self, FingerprintErrorV1> {
        self.behaviors.sort();
        self.behaviors.dedup();
        self.content.sort();
        self.content.dedup();
        if let Some(panic) = self.normalized_panic.take() {
            self.normalized_panic = Some(normalize_panic_v1(&panic));
        }
        self.validate()?;
        Ok(self)
    }

    pub fn validate(&self) -> Result<(), FingerprintErrorV1> {
        if self.behaviors.windows(2).any(|pair| pair[0] >= pair[1])
            || self.content.windows(2).any(|pair| pair[0] >= pair[1])
            || self.behaviors.iter().any(|value| value.as_str().is_empty())
            || self.content.iter().any(|value| value.0.is_empty())
            || self.terminal_reason.as_ref().is_some_and(String::is_empty)
            || self.normalized_panic.as_ref().is_some_and(String::is_empty)
            || (self.class == FailureClassV1::Panic && self.normalized_panic.is_none())
            || (self.class == FailureClassV1::Terminal && self.terminal_reason.is_none())
            || (self.class == FailureClassV1::DigestDivergence
                && self.first_divergent_path.is_none())
        {
            return Err(FingerprintErrorV1::Invalid);
        }
        Ok(())
    }

    pub fn digest(&self) -> Result<String, FingerprintErrorV1> {
        self.validate()?;
        let bytes =
            er_canonical::canonical_bytes(&("elite-redux/m72/failure-fingerprint/v1", self))
                .map_err(|error| FingerprintErrorV1::Canonical(error.to_string()))?;
        Ok(format!("blake3-v1:{}", blake3::hash(&bytes).to_hex()))
    }
}

pub fn normalize_panic_v1(value: &str) -> String {
    value
        .split_whitespace()
        .map(|token| {
            if token.starts_with("0x") && token[2..].bytes().all(|byte| byte.is_ascii_hexdigit()) {
                "<addr>".to_owned()
            } else if token.chars().all(|character| character.is_ascii_digit()) {
                "<n>".to_owned()
            } else {
                token.replace('\\', "/")
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
