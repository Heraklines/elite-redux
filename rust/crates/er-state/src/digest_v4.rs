//! M6 mechanical-state digest over the sole canonical `GameStateV4` graph.

use std::fmt;

use er_canonical::content_digest;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::migration_v4::{GameStateV4, MigrationV4Error};

pub const MECHANICAL_DIGEST_DOMAIN_V4: &str = "pokerogue-redux/m6/mechanical/v4";
pub const MECHANICAL_DIGEST_PREFIX_V4: &str = "blake3-v1:";

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct MechanicalStateDigestV4(String);

impl MechanicalStateDigestV4 {
    pub fn new(value: impl Into<String>) -> Result<Self, MechanicalDigestErrorV4> {
        let value = value.into();
        let Some(hex) = value.strip_prefix(MECHANICAL_DIGEST_PREFIX_V4) else {
            return Err(MechanicalDigestErrorV4::InvalidPrefix);
        };
        if hex.len() != 64
            || !hex
                .bytes()
                .all(|digit| matches!(digit, b'0'..=b'9' | b'a'..=b'f'))
        {
            return Err(MechanicalDigestErrorV4::InvalidHex);
        }
        Ok(Self(value))
    }

    pub fn compute(state: &GameStateV4) -> Result<Self, MechanicalDigestErrorV4> {
        compute_mechanical_state_digest_v4(state)
    }

    pub fn verify(&self, state: &GameStateV4) -> Result<(), MechanicalDigestErrorV4> {
        let actual = Self::compute(state)?;
        if &actual == self {
            Ok(())
        } else {
            Err(MechanicalDigestErrorV4::Mismatch {
                expected: self.clone(),
                actual,
            })
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

impl fmt::Display for MechanicalStateDigestV4 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl TryFrom<String> for MechanicalStateDigestV4 {
    type Error = MechanicalDigestErrorV4;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl<'de> Deserialize<'de> for MechanicalStateDigestV4 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Error)]
pub enum MechanicalDigestErrorV4 {
    #[error("mechanical digest must start with blake3-v1:")]
    InvalidPrefix,
    #[error("mechanical digest must contain exactly 64 lowercase hexadecimal digits")]
    InvalidHex,
    #[error("mechanical state is invalid: {0}")]
    Validation(#[from] MigrationV4Error),
    #[error("mechanical digest canonicalization failed: {0}")]
    Canonical(#[from] er_canonical::CanonicalError),
    #[error("mechanical digest mismatch: expected {expected}, actual {actual}")]
    Mismatch {
        expected: MechanicalStateDigestV4,
        actual: MechanicalStateDigestV4,
    },
}

#[derive(Serialize)]
struct MechanicalDigestPreimageV4<'a> {
    domain: &'static str,
    state: &'a GameStateV4,
}

pub fn compute_mechanical_state_digest_v4(
    state: &GameStateV4,
) -> Result<MechanicalStateDigestV4, MechanicalDigestErrorV4> {
    state.validate()?;
    let raw = content_digest(&MechanicalDigestPreimageV4 {
        domain: MECHANICAL_DIGEST_DOMAIN_V4,
        state,
    })?;
    MechanicalStateDigestV4::new(format!("{MECHANICAL_DIGEST_PREFIX_V4}{raw}"))
}
