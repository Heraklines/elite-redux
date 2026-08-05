//! Canonical JSON and digest primitives shared by native and Wasm kernels.

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use thiserror::Error;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub const FIXTURE_DIGEST_KIND: &str = "sha256-stable-json-v1";
pub const CONTENT_DIGEST_KIND: &str = "blake3-v1";

#[derive(Debug, Error)]
pub enum CanonicalError {
    #[error("JSON serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("canonical JSON does not permit floats, negative integers, NaN, or infinity")]
    UnsupportedNumber,
    #[error("integer {value} exceeds JavaScript's maximum safe integer")]
    UnsafeInteger { value: u64 },
    #[error("digest mismatch: expected {expected}, actual {actual}")]
    DigestMismatch { expected: String, actual: String },
}

pub fn canonicalize<T: Serialize>(value: &T) -> Result<String, CanonicalError> {
    let value = serde_json::to_value(value)?;
    canonicalize_value(&value)
}

pub fn canonicalize_value(value: &Value) -> Result<String, CanonicalError> {
    let mut output = String::new();
    write_value(value, &mut output, false)?;
    Ok(output)
}

pub fn canonical_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, CanonicalError> {
    Ok(canonicalize(value)?.into_bytes())
}

pub fn fixture_digest<T: Serialize>(value: &T) -> Result<String, CanonicalError> {
    let bytes = fixture_bytes(value)?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

pub fn content_digest<T: Serialize>(value: &T) -> Result<String, CanonicalError> {
    let bytes = canonical_bytes(value)?;
    Ok(blake3::hash(&bytes).to_hex().to_string())
}

pub fn verify_fixture_digest<T: Serialize>(
    value: &T,
    expected: &str,
) -> Result<(), CanonicalError> {
    let actual = fixture_digest(value)?;
    if actual == expected {
        Ok(())
    } else {
        Err(CanonicalError::DigestMismatch {
            expected: expected.to_owned(),
            actual,
        })
    }
}

fn fixture_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, CanonicalError> {
    // The TypeScript fixture exporter materializes sorted keys before calling
    // JSON.stringify, whose own-property enumeration puts array-index keys first.
    let value = serde_json::to_value(value)?;
    let mut output = String::new();
    write_value(&value, &mut output, true)?;
    Ok(output.into_bytes())
}

fn write_value(
    value: &Value,
    output: &mut String,
    fixture_order: bool,
) -> Result<(), CanonicalError> {
    match value {
        Value::Null => output.push_str("null"),
        Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
        Value::String(value) => output.push_str(&serde_json::to_string(value)?),
        Value::Number(number) => {
            if number.is_f64() {
                return Err(CanonicalError::UnsupportedNumber);
            }
            let Some(integer) = number.as_u64() else {
                return Err(CanonicalError::UnsupportedNumber);
            };
            if integer > MAX_SAFE_INTEGER {
                return Err(CanonicalError::UnsafeInteger { value: integer });
            }
            output.push_str(&integer.to_string());
        }
        Value::Array(values) => {
            output.push('[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                write_value(value, output, fixture_order)?;
            }
            output.push(']');
        }
        Value::Object(object) => {
            let mut entries = object.iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| {
                if fixture_order {
                    fixture_key_cmp(left.0, right.0)
                } else {
                    utf16_key_cmp(left.0, right.0)
                }
            });
            output.push('{');
            for (index, (key, value)) in entries.into_iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                output.push_str(&serde_json::to_string(key)?);
                output.push(':');
                write_value(value, output, fixture_order)?;
            }
            output.push('}');
        }
    }
    Ok(())
}

fn utf16_key_cmp(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

fn fixture_key_cmp(left: &str, right: &str) -> Ordering {
    match (array_index_key(left), array_index_key(right)) {
        (Some(left), Some(right)) => left.cmp(&right),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => utf16_key_cmp(left, right),
    }
}

fn array_index_key(key: &str) -> Option<u32> {
    if key == "0" {
        return Some(0);
    }
    if key.is_empty() || key.starts_with('0') || !key.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let value = key.parse::<u64>().ok()?;
    if value >= 4_294_967_295 {
        return None;
    }
    Some(value as u32)
}

#[cfg(test)]
mod tests {
    use super::{
        CanonicalError, canonical_bytes, canonicalize, canonicalize_value, content_digest,
        fixture_digest, verify_fixture_digest,
    };
    use serde_json::{Map, Value};
    use std::error::Error;

    #[test]
    fn canonicalizes_nested_utf16_order_and_arrays() -> Result<(), Box<dyn Error>> {
        let astral = "\u{10000}";
        let bmp_middle = "\u{e000}";
        let bmp_high = "\u{ffff}";

        let mut utf16_keys = Map::new();
        utf16_keys.insert(bmp_high.to_owned(), Value::String("bmp-high".to_owned()));
        utf16_keys.insert(astral.to_owned(), Value::String("astral".to_owned()));
        utf16_keys.insert(
            bmp_middle.to_owned(),
            Value::String("bmp-middle".to_owned()),
        );

        let mut array_object = Map::new();
        array_object.insert("b".to_owned(), Value::from(2_u64));
        array_object.insert("a".to_owned(), Value::from(1_u64));

        let mut root = Map::new();
        root.insert(
            "z".to_owned(),
            Value::Array(vec![
                Value::Object(array_object),
                Value::String("second".to_owned()),
                Value::String("first".to_owned()),
            ]),
        );
        root.insert("nullable".to_owned(), Value::Null);
        root.insert("nested".to_owned(), Value::Object(utf16_keys));
        root.insert("a".to_owned(), Value::Bool(true));

        let canonical = canonicalize_value(&Value::Object(root))?;
        let astral_json = serde_json::to_string(astral)?;
        let bmp_middle_json = serde_json::to_string(bmp_middle)?;
        let bmp_high_json = serde_json::to_string(bmp_high)?;
        let expected = format!(
            "{{\"a\":true,\"nested\":{{{astral_json}:\"astral\",{bmp_middle_json}:\"bmp-middle\",{bmp_high_json}:\"bmp-high\"}},\"nullable\":null,\"z\":[{{\"a\":1,\"b\":2}},\"second\",\"first\"]}}"
        );

        assert_eq!(canonical, expected);
        assert!(!canonical.contains(' '));
        assert!(!canonical.contains('\n'));
        Ok(())
    }

    #[test]
    fn canonicalizes_compact_strings_and_null_absence() -> Result<(), Box<dyn Error>> {
        let with_null: Value =
            serde_json::from_str(r#"{"present":null,"text":"line\né","values":[3,1]}"#)?;
        let without_field: Value = serde_json::from_str(r#"{"text":"line\né","values":[3,1]}"#)?;

        let expected = r#"{"present":null,"text":"line\né","values":[3,1]}"#;
        assert_eq!(canonicalize_value(&with_null)?, expected);
        assert_eq!(canonical_bytes(&with_null)?.as_slice(), expected.as_bytes());
        assert_ne!(
            canonicalize_value(&with_null)?,
            canonicalize_value(&without_field)?
        );
        Ok(())
    }

    #[test]
    fn accepts_only_nonnegative_safe_integers() -> Result<(), Box<dyn Error>> {
        for source in ["0", "1", "9007199254740991"] {
            let value: Value = serde_json::from_str(source)?;
            assert_eq!(canonicalize_value(&value)?, source);
        }

        let over_safe: Value = serde_json::from_str("9007199254740992")?;
        assert!(matches!(
            canonicalize_value(&over_safe),
            Err(CanonicalError::UnsafeInteger {
                value: 9_007_199_254_740_992
            })
        ));

        let max_unsigned = Value::Number(serde_json::Number::from(u64::MAX));
        assert!(matches!(
            canonicalize_value(&max_unsigned),
            Err(CanonicalError::UnsafeInteger { value: u64::MAX })
        ));
        Ok(())
    }

    #[test]
    fn rejects_negative_and_float_forms_at_any_depth() -> Result<(), Box<dyn Error>> {
        for source in ["-1", "-9007199254740991"] {
            let value: Value = serde_json::from_str(source)?;
            assert!(matches!(
                canonicalize_value(&value),
                Err(CanonicalError::UnsupportedNumber)
            ));
        }

        for source in ["1.0", "1e0", "1E+0", "1e-1", "-0.0"] {
            let value: Value = serde_json::from_str(source)?;
            assert!(matches!(
                canonicalize_value(&value),
                Err(CanonicalError::UnsupportedNumber)
            ));
        }

        for value in [1.0_f64, 1.5_f64, -0.0_f64, f64::INFINITY, f64::NAN] {
            assert!(canonicalize(&value).is_err());
        }

        let nested: Value = serde_json::from_str(r#"{"outer":[{"bad":9007199254740992}]}"#)?;
        assert!(matches!(
            canonicalize_value(&nested),
            Err(CanonicalError::UnsafeInteger {
                value: 9_007_199_254_740_992
            })
        ));
        Ok(())
    }

    #[test]
    fn fixture_sha256_matches_payload_and_blake3_differs() -> Result<(), Box<dyn Error>> {
        let value: Value = serde_json::from_str(r#"{"b":[true,null],"a":"é"}"#)?;
        let canonical = r#"{"a":"é","b":[true,null]}"#;
        let sha256 = fixture_digest(&value)?;
        let blake3 = content_digest(&value)?;

        assert_eq!(canonicalize(&value)?, canonical);
        assert_eq!(
            sha256,
            "c5cc0d1b9005cced90abb4178e4d502f70ee99f99e158b1841f82ab812241f3f"
        );
        assert_eq!(sha256.len(), 64);
        assert_eq!(blake3.len(), 64);
        assert_ne!(sha256, blake3);
        Ok(())
    }

    #[test]
    fn fixture_sha256_matches_javascript_index_key_order() -> Result<(), Box<dyn Error>> {
        let value: Value = serde_json::from_str(r#"{"10":"ten","a":"a","2":"two"}"#)?;

        assert_eq!(
            canonicalize_value(&value)?,
            r#"{"10":"ten","2":"two","a":"a"}"#
        );
        assert_eq!(
            fixture_digest(&value)?,
            "d5143e7a1ffc201cc14e8624300eecc0b92c77b2c1b147788e8c2792ef464254"
        );
        Ok(())
    }

    #[test]
    fn reports_nested_fixture_digest_mismatch() -> Result<(), Box<dyn Error>> {
        let value: Value =
            serde_json::from_str(r#"{"outer":{"z":[2,1],"a":{"right":true,"left":null}}}"#)?;
        let expected = fixture_digest(&value)?;
        assert!(verify_fixture_digest(&value, &expected).is_ok());

        let mismatch = verify_fixture_digest(&value, "incorrect");
        match mismatch {
            Err(CanonicalError::DigestMismatch { expected, actual }) => {
                assert_eq!(expected, "incorrect");
                assert_eq!(actual, fixture_digest(&value)?);
            }
            other => assert!(matches!(other, Err(CanonicalError::DigestMismatch { .. }))),
        }
        Ok(())
    }
}
