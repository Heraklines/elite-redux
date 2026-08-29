//! JavaScript-safe integer and opaque identifier newtypes.

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, de};
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
        deserializer.deserialize_any(SafeU53Visitor)
    }
}

struct SafeU53Visitor;

impl<'de> de::Visitor<'de> for SafeU53Visitor {
    type Value = SafeU53;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a non-negative JavaScript-safe integer")
    }

    fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        SafeU53::new(value).map_err(E::custom)
    }

    fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        let value = u64::try_from(value).map_err(E::custom)?;
        self.visit_u64(value)
    }

    fn visit_u128<E>(self, value: u128) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        let value = u64::try_from(value).map_err(E::custom)?;
        self.visit_u64(value)
    }

    fn visit_i128<E>(self, value: i128) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        let value = u64::try_from(value).map_err(E::custom)?;
        self.visit_u64(value)
    }

    fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        if !value.is_finite()
            || value.fract() != 0.0
            || !(0.0..=JS_MAX_SAFE_INTEGER as f64).contains(&value)
        {
            return Err(E::custom(format_args!(
                "{value} is not a non-negative JavaScript-safe integer"
            )));
        }
        self.visit_u64(value as u64)
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
}

fn validate_string_id(value: &str) -> Result<(), StringIdError> {
    if value.is_empty() {
        return Err(StringIdError::Empty);
    }
    Ok(())
}

/// JavaScript source bound for Authority V2 operation IDs and material digests.
pub const AUTHORITY_WIRE_STRING_MAX_UTF16_UNITS: usize = 256;

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum AuthorityWireStringError {
    #[error("authority wire string must not be empty")]
    Empty,
    #[error("authority wire string must not exceed 256 UTF-16 code units")]
    TooLong,
    #[error("authority operation ID must not contain C0 or DEL control characters")]
    AsciiControl,
}

pub fn validate_authority_operation_id(value: &str) -> Result<(), AuthorityWireStringError> {
    validate_authority_wire_length(value)?;
    if value
        .chars()
        .any(|character| character <= '\u{001f}' || character == '\u{007f}')
    {
        return Err(AuthorityWireStringError::AsciiControl);
    }
    Ok(())
}

pub fn validate_authority_material_digest(value: &str) -> Result<(), AuthorityWireStringError> {
    validate_authority_wire_length(value)
}

fn validate_authority_wire_length(value: &str) -> Result<(), AuthorityWireStringError> {
    if value.is_empty() {
        return Err(AuthorityWireStringError::Empty);
    }
    if value.encode_utf16().count() > AUTHORITY_WIRE_STRING_MAX_UTF16_UNITS {
        return Err(AuthorityWireStringError::TooLong);
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Serialize, de::DeserializeOwned};

    type StringIdConstructor<T> = fn(String) -> Result<T, StringIdError>;

    const OVERFLOW_JSON: [&str; 6] = [
        "-1",
        "9007199254740992",
        "18446744073709551615",
        "1.5",
        "\"1\"",
        "null",
    ];

    fn assert_numeric_id_serde<T>(zero: T, max: T) -> Result<(), serde_json::Error>
    where
        T: Copy + DeserializeOwned + Eq + std::fmt::Debug + Serialize,
    {
        for value in [zero, max] {
            let encoded = serde_json::to_string(&value)?;
            let decoded: T = serde_json::from_str(&encoded)?;
            assert_eq!(decoded, value);
        }

        for input in OVERFLOW_JSON {
            assert!(
                serde_json::from_str::<T>(input).is_err(),
                "accepted {input}"
            );
        }

        Ok(())
    }

    fn assert_string_id_construction<T>(constructors: &[StringIdConstructor<T>])
    where
        T: Eq + std::fmt::Debug,
    {
        for constructor in constructors {
            assert_eq!(constructor(String::new()), Err(StringIdError::Empty));
            assert!(constructor("a".repeat(4_096)).is_ok());

            for byte in 0_u8..=31 {
                let control = char::from(byte);
                let value = format!("a{control}b");
                assert!(constructor(value).is_ok());
            }

            let control = char::from(127_u8);
            let value = format!("a{control}b");
            assert!(constructor(value).is_ok());
        }
    }

    fn assert_string_id_serde<T>(value: T) -> Result<(), serde_json::Error>
    where
        T: DeserializeOwned + Eq + std::fmt::Debug + Serialize,
    {
        let encoded = serde_json::to_string(&value)?;
        let decoded: T = serde_json::from_str(&encoded)?;
        assert_eq!(decoded, value);

        let long_value = "\u{00e9}".repeat(4_096);
        let long_json = serde_json::to_string(&long_value)?;
        assert!(serde_json::from_str::<T>(&long_json).is_ok());

        let empty_json = serde_json::to_string("")?;
        assert!(serde_json::from_str::<T>(&empty_json).is_err());

        for byte in 0_u8..=31 {
            let control = char::from(byte);
            let raw = format!("a{control}b");
            let json = serde_json::to_string(&raw)?;
            assert!(serde_json::from_str::<T>(&json).is_ok());
        }

        let control = char::from(127_u8);
        let raw = format!("a{control}b");
        let json = serde_json::to_string(&raw)?;
        assert!(serde_json::from_str::<T>(&json).is_ok());

        Ok(())
    }

    #[test]
    fn safe_u53_accepts_inclusive_zero_and_maximum_boundaries() {
        assert_eq!(SafeU53::new(0), Ok(SafeU53::ZERO));
        assert_eq!(SafeU53::try_from(0), Ok(SafeU53::ZERO));
        assert_eq!(SafeU53::new(JS_MAX_SAFE_INTEGER), Ok(SafeU53::MAX));
        assert_eq!(SafeU53::try_from(JS_MAX_SAFE_INTEGER), Ok(SafeU53::MAX));
        assert_eq!(SafeU53::MAX.get(), JS_MAX_SAFE_INTEGER);
        assert_eq!(SafeU53::MAX.into_inner(), JS_MAX_SAFE_INTEGER);
        assert_eq!(u64::from(SafeU53::MAX), JS_MAX_SAFE_INTEGER);
        assert_eq!(SafeU53::MAX.to_string(), JS_MAX_SAFE_INTEGER.to_string());
    }

    #[test]
    fn safe_u53_rejects_every_value_above_the_safe_integer_boundary() {
        assert_eq!(
            SafeU53::new(JS_MAX_SAFE_INTEGER + 1),
            Err(SafeU53Error {
                value: JS_MAX_SAFE_INTEGER + 1,
            })
        );
        assert_eq!(
            SafeU53::try_from(JS_MAX_SAFE_INTEGER + 1),
            Err(SafeU53Error {
                value: JS_MAX_SAFE_INTEGER + 1,
            })
        );
        assert_eq!(
            SafeU53::new(u64::MAX),
            Err(SafeU53Error { value: u64::MAX })
        );
    }

    #[test]
    fn safe_u53_serde_checks_boundaries_and_types() -> Result<(), serde_json::Error> {
        for (input, expected) in [
            ("0", 0),
            ("-0", 0),
            ("0.0", 0),
            ("-0.0", 0),
            ("0e0", 0),
            ("1.0", 1),
            ("1e0", 1),
            ("1e-400", 0),
            ("-1e-400", 0),
            ("9007199254740990.5", JS_MAX_SAFE_INTEGER - 1),
            ("9007199254740991.1", JS_MAX_SAFE_INTEGER),
            ("9007199254740991", JS_MAX_SAFE_INTEGER),
            ("9007199254740991.0", JS_MAX_SAFE_INTEGER),
            ("9.007199254740991e15", JS_MAX_SAFE_INTEGER),
        ] {
            let decoded: SafeU53 = serde_json::from_str(input)?;
            assert_eq!(decoded.get(), expected, "input: {input}");
        }

        for input in OVERFLOW_JSON {
            assert!(
                serde_json::from_str::<SafeU53>(input).is_err(),
                "accepted {input}"
            );
        }

        for input in ["9007199254740991.5", "1e400", "true", "[]", "{}"] {
            assert!(
                serde_json::from_str::<SafeU53>(input).is_err(),
                "accepted {input}"
            );
        }

        Ok(())
    }

    #[test]
    fn authority_wire_helpers_use_javascript_utf16_layers() {
        let astral_at_limit = "\u{1f642}".repeat(AUTHORITY_WIRE_STRING_MAX_UTF16_UNITS / 2);
        let astral_over_limit = "\u{1f642}".repeat((AUTHORITY_WIRE_STRING_MAX_UTF16_UNITS / 2) + 1);
        assert_eq!(astral_at_limit.encode_utf16().count(), 256);
        assert_eq!(astral_over_limit.encode_utf16().count(), 258);

        assert_eq!(
            validate_authority_operation_id(""),
            Err(AuthorityWireStringError::Empty)
        );
        assert!(validate_authority_operation_id(&astral_at_limit).is_ok());
        assert_eq!(
            validate_authority_operation_id(&astral_over_limit),
            Err(AuthorityWireStringError::TooLong)
        );
        assert_eq!(
            validate_authority_operation_id("a\u{0000}b"),
            Err(AuthorityWireStringError::AsciiControl)
        );
        assert_eq!(
            validate_authority_operation_id("a\u{007f}b"),
            Err(AuthorityWireStringError::AsciiControl)
        );

        assert!(validate_authority_material_digest(&astral_at_limit).is_ok());
        assert!(validate_authority_material_digest("a\u{0000}b").is_ok());
        assert_eq!(
            validate_authority_material_digest(&astral_over_limit),
            Err(AuthorityWireStringError::TooLong)
        );
    }

    #[test]
    fn safe_u53_round_trips_through_json_without_changing_value() -> Result<(), serde_json::Error> {
        for value in [SafeU53::ZERO, SafeU53::MAX] {
            let encoded = serde_json::to_string(&value)?;
            let decoded: SafeU53 = serde_json::from_str(&encoded)?;
            assert_eq!(decoded, value);
        }

        assert_eq!(
            serde_json::to_string(&SafeU53::MAX)?,
            JS_MAX_SAFE_INTEGER.to_string()
        );
        Ok(())
    }

    #[test]
    fn numeric_ids_preserve_safe_u53_validation_and_round_trip() -> Result<(), serde_json::Error> {
        macro_rules! check_numeric_id {
            ($name:ty) => {{
                let zero = <$name>::new(SafeU53::ZERO);
                let max = <$name>::new(SafeU53::MAX);
                assert_eq!(zero, <$name>::ZERO);
                assert_eq!(<$name>::default(), zero);
                assert_eq!(zero.get(), SafeU53::ZERO);
                assert_eq!(max.into_inner(), SafeU53::MAX);
                let from_safe: $name = SafeU53::MAX.into();
                assert_eq!(from_safe, max);
                let back_to_safe: SafeU53 = from_safe.into();
                assert_eq!(back_to_safe, SafeU53::MAX);
                assert_numeric_id_serde(zero, max)?;
            }};
        }

        check_numeric_id!(Revision);
        check_numeric_id!(SeatId);
        check_numeric_id!(MembershipRevision);
        check_numeric_id!(ConnectionGeneration);
        check_numeric_id!(TimerId);
        check_numeric_id!(MenuGeneration);
        check_numeric_id!(PresentationEventId);
        Ok(())
    }

    #[test]
    fn opaque_string_ids_validate_all_paths() -> Result<(), serde_json::Error> {
        macro_rules! check_string_id {
            ($name:ty) => {{
                let constructors: &[fn(String) -> Result<$name, StringIdError>] = &[
                    |value| <$name>::new(value),
                    |value| <$name>::try_from(value),
                ];
                assert_string_id_construction(constructors);

                let valid = "opaque/é/🙂";
                let value = <$name>::new(valid);
                assert!(value.is_ok());
                if let Ok(value) = value {
                    assert_eq!(value.as_str(), valid);
                    assert_eq!(value.clone().into_inner(), valid);
                    assert_string_id_serde(value)?;
                }
            }};
        }

        check_string_id!(OperationId);
        check_string_id!(SessionId);
        check_string_id!(RunId);
        check_string_id!(OwnerId);
        check_string_id!(MenuOptionId);
        Ok(())
    }
}
