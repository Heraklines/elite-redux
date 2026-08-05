//! JavaScript-safe integer and opaque identifier newtypes.

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

/// Largest integer represented exactly by JavaScript's `Number` type.
pub const JS_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// An unsigned integer guaranteed to cross a JavaScript JSON boundary exactly.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct SafeU53(u64);

impl SafeU53 {
    pub const ZERO: Self = Self(0);
    pub const MAX: Self = Self(JS_MAX_SAFE_INTEGER);

    pub const fn new(value: u64) -> Result<Self, SafeU53Error> {
        if value <= JS_MAX_SAFE_INTEGER {
            Ok(Self(value))
        } else {
            Err(SafeU53Error { value })
        }
    }

    pub const fn get(self) -> u64 {
        self.0
    }

    pub const fn into_inner(self) -> u64 {
        self.0
    }
}

impl fmt::Display for SafeU53 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl TryFrom<u64> for SafeU53 {
    type Error = SafeU53Error;

    fn try_from(value: u64) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl From<SafeU53> for u64 {
    fn from(value: SafeU53) -> Self {
        value.get()
    }
}

impl<'de> Deserialize<'de> for SafeU53 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = u64::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("{value} exceeds JavaScript's maximum safe integer")]
pub struct SafeU53Error {
    pub value: u64,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum StringIdError {
    #[error("identifier must not be empty")]
    Empty,
    #[error("identifier must not exceed 256 UTF-8 bytes")]
    TooLong,
    #[error("identifier must not contain ASCII control characters")]
    AsciiControl,
}

fn validate_string_id(value: &str) -> Result<(), StringIdError> {
    if value.is_empty() {
        return Err(StringIdError::Empty);
    }
    if value.len() > 256 {
        return Err(StringIdError::TooLong);
    }
    if value.chars().any(|character| character.is_ascii_control()) {
        return Err(StringIdError::AsciiControl);
    }
    Ok(())
}

macro_rules! numeric_id {
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

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }
    };
}

macro_rules! string_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self, StringIdError> {
                let value = value.into();
                validate_string_id(&value)?;
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }

            pub fn into_inner(self) -> String {
                self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }

        impl TryFrom<String> for $name {
            type Error = StringIdError;

            fn try_from(value: String) -> Result<Self, Self::Error> {
                Self::new(value)
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

numeric_id!(Revision);
numeric_id!(SeatId);
numeric_id!(MembershipRevision);
numeric_id!(ConnectionGeneration);
numeric_id!(TimerId);
numeric_id!(MenuGeneration);
numeric_id!(PresentationEventId);

string_id!(OperationId);
string_id!(SessionId);
string_id!(RunId);
string_id!(OwnerId);
string_id!(MenuOptionId);
