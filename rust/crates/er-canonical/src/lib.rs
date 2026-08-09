//! Canonical JSON and digest primitives shared by native and Wasm kernels.

use serde::Serialize;
use serde::Serializer;
use serde::ser::SerializeMap;
use serde::ser::SerializeSeq;
use serde::ser::SerializeStruct;
use serde::ser::SerializeStructVariant;
use serde::ser::SerializeTuple;
use serde::ser::SerializeTupleStruct;
use serde::ser::SerializeTupleVariant;
use serde_json::Value;
use std::cmp::Ordering;
use std::fmt;
use thiserror::Error;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub const FIXTURE_DIGEST_KIND: &str = "fixture-content-sha256-v1";
pub const CONTENT_DIGEST_KIND: &str = "blake3-v1";

#[derive(Debug, Error)]
pub enum CanonicalError {
    #[error("JSON serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("canonical JSON does not permit floats, NaN, or infinity")]
    UnsupportedNumber,
    #[error("integer {value} exceeds JavaScript's maximum safe integer")]
    UnsafeInteger { value: u64 },
    #[error("digest mismatch: expected {expected}, actual {actual}")]
    DigestMismatch { expected: String, actual: String },
}

pub fn canonicalize<T: Serialize>(value: &T) -> Result<String, CanonicalError> {
    let value = validated_value(value)?;
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
    Ok(encode_lowercase_hex(&sha256_digest(&bytes)))
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
    // Unlike the strict kernel canonicalizer, this compatibility path preserves
    // the exporter's finite fractional and negative JSON numbers.
    let value = serde_json::to_value(value)?;
    let mut output = String::new();
    write_value(&value, &mut output, true)?;
    Ok(output.into_bytes())
}

const SHA256_INITIAL_STATE: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const SHA256_ROUND_CONSTANTS: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

fn sha256_digest(bytes: &[u8]) -> [u8; 32] {
    let mut state = SHA256_INITIAL_STATE;
    let mut block = [0_u8; 64];
    let mut chunks = bytes.chunks_exact(64);

    for chunk in &mut chunks {
        block.copy_from_slice(chunk);
        sha256_compress(&mut state, &block);
    }

    let remainder = chunks.remainder();
    block = [0_u8; 64];
    block[..remainder.len()].copy_from_slice(remainder);
    block[remainder.len()] = 0x80;

    let bit_length = (bytes.len() as u64).wrapping_mul(8);
    if remainder.len() > 55 {
        sha256_compress(&mut state, &block);
        block = [0_u8; 64];
    }
    block[56..64].copy_from_slice(&bit_length.to_be_bytes());
    sha256_compress(&mut state, &block);

    let mut digest = [0_u8; 32];
    for (index, word) in state.iter().enumerate() {
        digest[index * 4..index * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    digest
}

fn sha256_compress(state: &mut [u32; 8], block: &[u8; 64]) {
    let mut schedule = [0_u32; 64];
    for (index, word) in schedule[..16].iter_mut().enumerate() {
        let offset = index * 4;
        *word = u32::from_be_bytes([
            block[offset],
            block[offset + 1],
            block[offset + 2],
            block[offset + 3],
        ]);
    }

    for index in 16..64 {
        let s0 = schedule[index - 15].rotate_right(7)
            ^ schedule[index - 15].rotate_right(18)
            ^ (schedule[index - 15] >> 3);
        let s1 = schedule[index - 2].rotate_right(17)
            ^ schedule[index - 2].rotate_right(19)
            ^ (schedule[index - 2] >> 10);
        schedule[index] = schedule[index - 16]
            .wrapping_add(s0)
            .wrapping_add(schedule[index - 7])
            .wrapping_add(s1);
    }

    let mut working = *state;
    for (constant, word) in SHA256_ROUND_CONSTANTS.iter().zip(schedule) {
        let s1 =
            working[4].rotate_right(6) ^ working[4].rotate_right(11) ^ working[4].rotate_right(25);
        let choice = (working[4] & working[5]) ^ ((!working[4]) & working[6]);
        let temporary1 = working[7]
            .wrapping_add(s1)
            .wrapping_add(choice)
            .wrapping_add(*constant)
            .wrapping_add(word);
        let s0 =
            working[0].rotate_right(2) ^ working[0].rotate_right(13) ^ working[0].rotate_right(22);
        let majority =
            (working[0] & working[1]) ^ (working[0] & working[2]) ^ (working[1] & working[2]);
        let temporary2 = s0.wrapping_add(majority);

        working[7] = working[6];
        working[6] = working[5];
        working[5] = working[4];
        working[4] = working[3].wrapping_add(temporary1);
        working[3] = working[2];
        working[2] = working[1];
        working[1] = working[0];
        working[0] = temporary1.wrapping_add(temporary2);
    }

    for (state_word, working_word) in state.iter_mut().zip(working) {
        *state_word = state_word.wrapping_add(working_word);
    }
}

fn encode_lowercase_hex(bytes: &[u8; 32]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(64);
    for &byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

fn validated_value<T: Serialize>(value: &T) -> Result<Value, CanonicalError> {
    match value.serialize(NumberValidationSerializer) {
        Ok(()) => Ok(serde_json::to_value(value)?),
        Err(NumberValidationError::UnsupportedNumber) => Err(CanonicalError::UnsupportedNumber),
        Err(NumberValidationError::Custom(message)) => Err(CanonicalError::Serialization(
            <serde_json::Error as serde::ser::Error>::custom(message),
        )),
    }
}

#[derive(Debug)]
enum NumberValidationError {
    UnsupportedNumber,
    Custom(String),
}

impl fmt::Display for NumberValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedNumber => formatter.write_str("floating-point values are unsupported"),
            Self::Custom(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for NumberValidationError {}

impl serde::ser::Error for NumberValidationError {
    fn custom<T: fmt::Display>(message: T) -> Self {
        Self::Custom(message.to_string())
    }
}

#[derive(Clone, Copy)]
struct NumberValidationSerializer;

impl Serializer for NumberValidationSerializer {
    type Ok = ();
    type Error = NumberValidationError;
    type SerializeSeq = NumberValidationCompound;
    type SerializeTuple = NumberValidationCompound;
    type SerializeTupleStruct = NumberValidationCompound;
    type SerializeTupleVariant = NumberValidationCompound;
    type SerializeMap = NumberValidationCompound;
    type SerializeStruct = NumberValidationCompound;
    type SerializeStructVariant = NumberValidationCompound;

    fn serialize_bool(self, _value: bool) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }

    fn serialize_i8(self, _value: i8) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }

    fn serialize_i16(self, _value: i16) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }

    fn serialize_i32(self, _value: i32) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }

    fn serialize_i64(self, _value: i64) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }

    fn serialize_i128(self, _value: i128) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }

    fn serialize_u8(self, _value: u8) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }

    fn serialize_u16(self, _value: u16) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }

    fn serialize_u32(self, _value: u32) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }

    fn serialize_u64(self, _value: u64) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }

    fn serialize_u128(self, _value: u128) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }

    fn serialize_f32(self, _value: f32) -> Result<Self::Ok, Self::Error> {
        Err(NumberValidationError::UnsupportedNumber)
    }

    fn serialize_f64(self, _value: f64) -> Result<Self::Ok, Self::Error> {
        Err(NumberValidationError::UnsupportedNumber)
    }

    fn serialize_char(self, _value: char) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }

    fn serialize_str(self, _value: &str) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }

    fn serialize_bytes(self, _value: &[u8]) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }

    fn serialize_none(self) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }

    fn serialize_some<T: Serialize + ?Sized>(self, value: &T) -> Result<Self::Ok, Self::Error> {
        value.serialize(self)
    }

    fn serialize_unit(self) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }

    fn serialize_unit_struct(self, _name: &'static str) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }

    fn serialize_unit_variant(
        self,
        _name: &'static str,
        _variant_index: u32,
        _variant: &'static str,
    ) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }

    fn serialize_newtype_struct<T: Serialize + ?Sized>(
        self,
        _name: &'static str,
        value: &T,
    ) -> Result<Self::Ok, Self::Error> {
        value.serialize(self)
    }

    fn serialize_newtype_variant<T: Serialize + ?Sized>(
        self,
        _name: &'static str,
        _variant_index: u32,
        _variant: &'static str,
        value: &T,
    ) -> Result<Self::Ok, Self::Error> {
        value.serialize(self)
    }

    fn serialize_seq(self, _length: Option<usize>) -> Result<Self::SerializeSeq, Self::Error> {
        Ok(NumberValidationCompound)
    }

    fn serialize_tuple(self, _length: usize) -> Result<Self::SerializeTuple, Self::Error> {
        Ok(NumberValidationCompound)
    }

    fn serialize_tuple_struct(
        self,
        _name: &'static str,
        _length: usize,
    ) -> Result<Self::SerializeTupleStruct, Self::Error> {
        Ok(NumberValidationCompound)
    }

    fn serialize_tuple_variant(
        self,
        _name: &'static str,
        _variant_index: u32,
        _variant: &'static str,
        _length: usize,
    ) -> Result<Self::SerializeTupleVariant, Self::Error> {
        Ok(NumberValidationCompound)
    }

    fn serialize_map(self, _length: Option<usize>) -> Result<Self::SerializeMap, Self::Error> {
        Ok(NumberValidationCompound)
    }

    fn serialize_struct(
        self,
        _name: &'static str,
        _length: usize,
    ) -> Result<Self::SerializeStruct, Self::Error> {
        Ok(NumberValidationCompound)
    }

    fn serialize_struct_variant(
        self,
        _name: &'static str,
        _variant_index: u32,
        _variant: &'static str,
        _length: usize,
    ) -> Result<Self::SerializeStructVariant, Self::Error> {
        Ok(NumberValidationCompound)
    }
}

struct NumberValidationCompound;

impl SerializeSeq for NumberValidationCompound {
    type Ok = ();
    type Error = NumberValidationError;

    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Self::Error> {
        value.serialize(NumberValidationSerializer)
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }
}

impl SerializeTuple for NumberValidationCompound {
    type Ok = ();
    type Error = NumberValidationError;

    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Self::Error> {
        value.serialize(NumberValidationSerializer)
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }
}

impl SerializeTupleStruct for NumberValidationCompound {
    type Ok = ();
    type Error = NumberValidationError;

    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Self::Error> {
        value.serialize(NumberValidationSerializer)
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }
}

impl SerializeTupleVariant for NumberValidationCompound {
    type Ok = ();
    type Error = NumberValidationError;

    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Self::Error> {
        value.serialize(NumberValidationSerializer)
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }
}

impl SerializeMap for NumberValidationCompound {
    type Ok = ();
    type Error = NumberValidationError;

    fn serialize_key<T: Serialize + ?Sized>(&mut self, key: &T) -> Result<(), Self::Error> {
        key.serialize(NumberValidationSerializer)
    }

    fn serialize_value<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Self::Error> {
        value.serialize(NumberValidationSerializer)
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }
}

impl SerializeStruct for NumberValidationCompound {
    type Ok = ();
    type Error = NumberValidationError;

    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        _key: &'static str,
        value: &T,
    ) -> Result<(), Self::Error> {
        value.serialize(NumberValidationSerializer)
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }
}

impl SerializeStructVariant for NumberValidationCompound {
    type Ok = ();
    type Error = NumberValidationError;

    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        _key: &'static str,
        value: &T,
    ) -> Result<(), Self::Error> {
        value.serialize(NumberValidationSerializer)
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        Ok(())
    }
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
            if fixture_order {
                if let Some(value) = number.as_i64() {
                    output.push_str(&value.to_string());
                } else if let Some(value) = number.as_u64() {
                    output.push_str(&value.to_string());
                } else if let Some(value) = number.as_f64() {
                    if value == 0.0 {
                        output.push('0');
                    } else {
                        output.push_str(&value.to_string());
                    }
                } else {
                    return Err(CanonicalError::UnsupportedNumber);
                }
                return Ok(());
            }
            if number.is_f64() {
                return Err(CanonicalError::UnsupportedNumber);
            }
            if let Some(integer) = number.as_i64() {
                let magnitude = integer.unsigned_abs();
                if magnitude > MAX_SAFE_INTEGER {
                    return Err(CanonicalError::UnsafeInteger { value: magnitude });
                }
                output.push_str(&integer.to_string());
            } else if let Some(integer) = number.as_u64() {
                if integer > MAX_SAFE_INTEGER {
                    return Err(CanonicalError::UnsafeInteger { value: integer });
                }
                output.push_str(&integer.to_string());
            } else {
                return Err(CanonicalError::UnsupportedNumber);
            }
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
    use serde::Serialize;
    use serde_json::{Map, Value};
    use std::error::Error;

    #[derive(Serialize)]
    struct NestedSignedContent {
        delta: i8,
    }

    #[derive(Serialize)]
    struct SignedContent {
        top_level: i64,
        nested: NestedSignedContent,
    }

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
    fn accepts_signed_safe_integers_and_rejects_signed_overflow() -> Result<(), Box<dyn Error>> {
        for source in ["-9007199254740991", "-1", "0", "1", "9007199254740991"] {
            let value: Value = serde_json::from_str(source)?;
            assert_eq!(canonicalize_value(&value)?, source);
        }

        for value in [-9_007_199_254_740_991_i64, 9_007_199_254_740_991_i64] {
            assert_eq!(canonicalize(&value)?, value.to_string());
        }

        for source in ["-9007199254740992", "9007199254740992"] {
            let value: Value = serde_json::from_str(source)?;
            assert!(matches!(
                canonicalize_value(&value),
                Err(CanonicalError::UnsafeInteger {
                    value: 9_007_199_254_740_992
                })
            ));
        }

        let max_unsigned = Value::Number(serde_json::Number::from(u64::MAX));
        assert!(matches!(
            canonicalize_value(&max_unsigned),
            Err(CanonicalError::UnsafeInteger { value: u64::MAX })
        ));

        for value in [-9_007_199_254_740_992_i64, 9_007_199_254_740_992_i64] {
            assert!(matches!(
                canonicalize(&value),
                Err(CanonicalError::UnsafeInteger {
                    value: 9_007_199_254_740_992
                })
            ));
        }
        Ok(())
    }

    #[test]
    fn canonicalizes_nested_typed_signed_content_and_content_bytes() -> Result<(), Box<dyn Error>> {
        let content = SignedContent {
            top_level: -1,
            nested: NestedSignedContent { delta: -1 },
        };
        let expected = r#"{"nested":{"delta":-1},"top_level":-1}"#;

        assert_eq!(canonicalize(&-1_i64)?, "-1");
        assert_eq!(canonicalize(&content)?, expected);
        assert_eq!(canonical_bytes(&content)?.as_slice(), expected.as_bytes());
        assert_eq!(
            content_digest(&content)?,
            blake3::hash(expected.as_bytes()).to_hex().to_string()
        );
        Ok(())
    }

    #[test]
    fn rejects_float_forms_at_any_depth() -> Result<(), Box<dyn Error>> {
        for source in ["1.0", "1e0", "1E+0", "1e-1", "-0.0"] {
            let value: Value = serde_json::from_str(source)?;
            assert!(matches!(
                canonicalize_value(&value),
                Err(CanonicalError::UnsupportedNumber)
            ));
        }

        for value in [1.0_f64, 1.5_f64, -0.0_f64, f64::INFINITY, f64::NAN] {
            assert!(matches!(
                canonicalize(&value),
                Err(CanonicalError::UnsupportedNumber)
            ));
        }

        for value in [1.0_f32, 1.5_f32, -0.0_f32, f32::INFINITY, f32::NAN] {
            assert!(matches!(
                canonicalize(&value),
                Err(CanonicalError::UnsupportedNumber)
            ));
        }

        let nested_float = vec![Some(1.0_f64)];
        assert!(matches!(
            canonicalize(&nested_float),
            Err(CanonicalError::UnsupportedNumber)
        ));

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
        assert_eq!(
            blake3,
            "dfd61de4c8a028cefa26e6000ce1bb5f890602c325e919052179eea79c300796"
        );
        assert_ne!(sha256, blake3);
        Ok(())
    }

    #[test]
    fn fixture_digest_preserves_legacy_signed_and_fractional_json_numbers()
    -> Result<(), Box<dyn Error>> {
        let value: Value =
            serde_json::from_str(r#"{"wholeFloat":1.0,"negative":-1,"fraction":0.4}"#)?;
        assert_eq!(
            fixture_digest(&value)?,
            "136b7fcc9fb4bb777cf127b35dc6b929d88451b2a0c01c7ab27cdfd4d79c27e0"
        );
        assert!(canonicalize_value(&value).is_err());
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
