//! M4 run-owned strong identifiers and validated scalar values.
//!
//! These wrappers deliberately mirror the M3 `SafeU53` and numeric-ID
//! constructors. A run identifier is never represented as an untyped integer
//! in an M4 state or material graph.

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

use crate::ids::{SafeU53, SafeU53Error};

macro_rules! safe_u53_id {
    ($name:ident) => {
        #[derive(
            Clone,
            Copy,
            Debug,
            Default,
            Eq,
            Hash,
            Ord,
            PartialEq,
            PartialOrd,
            Serialize,
            Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(SafeU53);

        impl $name {
            pub const ZERO: Self = Self(SafeU53::ZERO);

            pub const fn new(value: SafeU53) -> Self {
                Self(value)
            }

            pub const fn get(self) -> SafeU53 {
                self.0
            }

            pub const fn into_inner(self) -> SafeU53 {
                self.0
            }

            pub fn try_from_u64(value: u64) -> Result<Self, SafeU53Error> {
                SafeU53::new(value).map(Self::new)
            }
        }

        impl From<SafeU53> for $name {
            fn from(value: SafeU53) -> Self {
                Self::new(value)
            }
        }

        impl From<$name> for SafeU53 {
            fn from(value: $name) -> Self {
                value.get()
            }
        }

        impl From<$name> for u64 {
            fn from(value: $name) -> Self {
                value.get().get()
            }
        }

        impl TryFrom<u64> for $name {
            type Error = SafeU53Error;

            fn try_from(value: u64) -> Result<Self, Self::Error> {
                Self::try_from_u64(value)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }
    };
}

macro_rules! u8_value {
    ($name:ident) => {
        #[derive(
            Clone,
            Copy,
            Debug,
            Default,
            Eq,
            Hash,
            Ord,
            PartialEq,
            PartialOrd,
            Serialize,
            Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(u8);

        impl $name {
            pub const ZERO: Self = Self(0);

            pub const fn new(value: u8) -> Self {
                Self(value)
            }

            pub const fn get(self) -> u8 {
                self.0
            }

            pub const fn into_inner(self) -> u8 {
                self.0
            }
        }

        impl From<u8> for $name {
            fn from(value: u8) -> Self {
                Self::new(value)
            }
        }

        impl From<$name> for u8 {
            fn from(value: $name) -> Self {
                value.get()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }
    };
}

safe_u53_id!(GameRunId);
safe_u53_id!(RunInteractionSequence);
safe_u53_id!(RunTaskId);
safe_u53_id!(RunSurfaceId);
safe_u53_id!(RunOfferId);
safe_u53_id!(RunStockId);
safe_u53_id!(RouteNodeId);
safe_u53_id!(EncounterId);
safe_u53_id!(ModifierId);
safe_u53_id!(BiomeId);
safe_u53_id!(Experience);
safe_u53_id!(Money);

u8_value!(GrowthRateId);
u8_value!(NatureId);

const BLAKE3_V1_PREFIX: &str = "blake3-v1:";
const BLAKE3_V1_HEX_LENGTH: usize = 64;

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum RunContentPackHashError {
    #[error("run-content hash must start with blake3-v1:")]
    InvalidPrefix,
    #[error("run-content hash must contain exactly 64 lowercase hexadecimal digits")]
    InvalidHex,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SurfaceDigestError {
    #[error("surface digest must start with blake3-v1:")]
    InvalidPrefix,
    #[error("surface digest must contain exactly 64 lowercase hexadecimal digits")]
    InvalidHex,
}

macro_rules! digest_string {
    ($name:ident, $error:ident) => {
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            pub const PREFIX: &'static str = BLAKE3_V1_PREFIX;

            pub fn new(value: impl Into<String>) -> Result<Self, $error> {
                let value = value.into();
                let Some(hex) = value.strip_prefix(Self::PREFIX) else {
                    return Err($error::InvalidPrefix);
                };
                if hex.len() != BLAKE3_V1_HEX_LENGTH
                    || !hex
                        .bytes()
                        .all(|digit| matches!(digit, b'0'..=b'9' | b'a'..=b'f'))
                {
                    return Err($error::InvalidHex);
                }
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }

            pub fn into_inner(self) -> String {
                self.0
            }
        }

        impl TryFrom<String> for $name {
            type Error = $error;

            fn try_from(value: String) -> Result<Self, Self::Error> {
                Self::new(value)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                let value = String::deserialize(deserializer)?;
                Self::new(value).map_err(serde::de::Error::custom)
            }
        }
    };
}

digest_string!(RunContentPackHash, RunContentPackHashError);
digest_string!(SurfaceDigest, SurfaceDigestError);
