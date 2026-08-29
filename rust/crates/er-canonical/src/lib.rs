//! Canonical JSON and digest primitives shared by native and Wasm kernels.

use serde::Serialize;
use serde::Serializer;
use serde::ser::Impossible;
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

impl serde::ser::Error for CanonicalError {
    fn custom<T: fmt::Display>(message: T) -> Self {
        serialization_error(message)
    }
}

pub fn canonicalize<T: Serialize>(value: &T) -> Result<String, CanonicalError> {
    let mut output = String::new();
    serialize_canonical(value, &mut output)?;
    Ok(output)
}

pub fn canonicalize_value(value: &Value) -> Result<String, CanonicalError> {
    let mut output = String::new();
    write_value(value, &mut output, false)?;
    Ok(output)
}

pub fn canonical_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, CanonicalError> {
    let mut output = String::new();
    serialize_canonical(value, &mut output)?;
    Ok(output.into_bytes())
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

#[derive(Clone, Copy)]
enum DeferredNumericError {
    UnsupportedNumber,
    UnsafeInteger { value: u64 },
}

impl DeferredNumericError {
    fn into_canonical_error(self) -> CanonicalError {
        match self {
            Self::UnsupportedNumber => CanonicalError::UnsupportedNumber,
            Self::UnsafeInteger { value } => CanonicalError::UnsafeInteger { value },
        }
    }
}

fn serialize_canonical<T: Serialize + ?Sized>(
    value: &T,
    output: &mut String,
) -> Result<(), CanonicalError> {
    validate_numbers(value)?;

    // Unsafe integers and finite floats were rejected only after the legacy
    // validation and JSON conversion passes. Keep that write-pass ordering
    // without materializing Value or recursively walking it.
    let mut deferred_numeric_error = None;
    serialize_canonical_into(value, output, &mut deferred_numeric_error)?;
    match deferred_numeric_error {
        Some(error) => Err(error.into_canonical_error()),
        None => Ok(()),
    }
}

fn validate_numbers<T: Serialize + ?Sized>(value: &T) -> Result<(), CanonicalError> {
    match value.serialize(NumberValidationSerializer) {
        Ok(()) => Ok(()),
        Err(NumberValidationError::UnsupportedNumber) => Err(CanonicalError::UnsupportedNumber),
        Err(NumberValidationError::Custom(message)) => Err(CanonicalError::Serialization(
            <serde_json::Error as serde::ser::Error>::custom(message),
        )),
    }
}

fn serialize_canonical_into<T: Serialize + ?Sized>(
    value: &T,
    output: &mut String,
    deferred_numeric_error: &mut Option<DeferredNumericError>,
) -> Result<(), CanonicalError> {
    value.serialize(CanonicalSerializer {
        output,
        deferred_numeric_error,
    })
}

fn serialize_fragment<T: Serialize + ?Sized>(
    value: &T,
) -> Result<CanonicalFragment, CanonicalError> {
    // Object values keep their own deferred error until sorting and duplicate
    // replacement reproduce the legacy materialized-object traversal order.
    let mut output = String::new();
    let mut deferred_numeric_error = None;
    serialize_canonical_into(value, &mut output, &mut deferred_numeric_error)?;
    Ok(CanonicalFragment {
        output,
        deferred_numeric_error,
    })
}

fn serialization_error<T: fmt::Display>(message: T) -> CanonicalError {
    CanonicalError::Serialization(<serde_json::Error as serde::ser::Error>::custom(message))
}

fn defer_numeric_error(
    deferred_numeric_error: &mut Option<DeferredNumericError>,
    error: DeferredNumericError,
) {
    if deferred_numeric_error.is_none() {
        *deferred_numeric_error = Some(error);
    }
}

fn write_signed_integer(
    output: &mut String,
    deferred_numeric_error: &mut Option<DeferredNumericError>,
    value: i64,
) {
    let magnitude = value.unsigned_abs();
    if magnitude > MAX_SAFE_INTEGER {
        defer_numeric_error(
            deferred_numeric_error,
            DeferredNumericError::UnsafeInteger { value: magnitude },
        );
    }
    output.push_str(&value.to_string());
}

fn write_unsigned_integer(
    output: &mut String,
    deferred_numeric_error: &mut Option<DeferredNumericError>,
    value: u64,
) {
    if value > MAX_SAFE_INTEGER {
        defer_numeric_error(
            deferred_numeric_error,
            DeferredNumericError::UnsafeInteger { value },
        );
    }
    output.push_str(&value.to_string());
}

struct CanonicalFragment {
    output: String,
    deferred_numeric_error: Option<DeferredNumericError>,
}

struct CanonicalSerializer<'output, 'deferred> {
    output: &'output mut String,
    deferred_numeric_error: &'deferred mut Option<DeferredNumericError>,
}

impl<'output, 'deferred> Serializer for CanonicalSerializer<'output, 'deferred> {
    type Ok = ();
    type Error = CanonicalError;
    type SerializeSeq = CanonicalSequence<'output, 'deferred>;
    type SerializeTuple = CanonicalSequence<'output, 'deferred>;
    type SerializeTupleStruct = CanonicalSequence<'output, 'deferred>;
    type SerializeTupleVariant = CanonicalTupleVariant<'output, 'deferred>;
    type SerializeMap = CanonicalMap<'output, 'deferred>;
    type SerializeStruct = CanonicalStruct<'output, 'deferred>;
    type SerializeStructVariant = CanonicalStructVariant<'output, 'deferred>;

    fn serialize_bool(self, value: bool) -> Result<Self::Ok, Self::Error> {
        self.output.push_str(if value { "true" } else { "false" });
        Ok(())
    }

    fn serialize_i8(self, value: i8) -> Result<Self::Ok, Self::Error> {
        self.serialize_i64(value as i64)
    }

    fn serialize_i16(self, value: i16) -> Result<Self::Ok, Self::Error> {
        self.serialize_i64(value as i64)
    }

    fn serialize_i32(self, value: i32) -> Result<Self::Ok, Self::Error> {
        self.serialize_i64(value as i64)
    }

    fn serialize_i64(self, value: i64) -> Result<Self::Ok, Self::Error> {
        write_signed_integer(self.output, self.deferred_numeric_error, value);
        Ok(())
    }

    fn serialize_i128(self, value: i128) -> Result<Self::Ok, Self::Error> {
        if value < 0 {
            let value =
                i64::try_from(value).map_err(|_| serialization_error("number out of range"))?;
            self.serialize_i64(value)
        } else {
            let value =
                u64::try_from(value).map_err(|_| serialization_error("number out of range"))?;
            self.serialize_u64(value)
        }
    }

    fn serialize_u8(self, value: u8) -> Result<Self::Ok, Self::Error> {
        self.serialize_u64(value as u64)
    }

    fn serialize_u16(self, value: u16) -> Result<Self::Ok, Self::Error> {
        self.serialize_u64(value as u64)
    }

    fn serialize_u32(self, value: u32) -> Result<Self::Ok, Self::Error> {
        self.serialize_u64(value as u64)
    }

    fn serialize_u64(self, value: u64) -> Result<Self::Ok, Self::Error> {
        write_unsigned_integer(self.output, self.deferred_numeric_error, value);
        Ok(())
    }

    fn serialize_u128(self, value: u128) -> Result<Self::Ok, Self::Error> {
        let value = u64::try_from(value).map_err(|_| serialization_error("number out of range"))?;
        self.serialize_u64(value)
    }

    fn serialize_f32(self, value: f32) -> Result<Self::Ok, Self::Error> {
        if value.is_finite() {
            defer_numeric_error(
                self.deferred_numeric_error,
                DeferredNumericError::UnsupportedNumber,
            );
            self.output.push_str(&serde_json::to_string(&value)?);
        } else {
            self.output.push_str("null");
        }
        Ok(())
    }

    fn serialize_f64(self, value: f64) -> Result<Self::Ok, Self::Error> {
        if value.is_finite() {
            defer_numeric_error(
                self.deferred_numeric_error,
                DeferredNumericError::UnsupportedNumber,
            );
            self.output.push_str(&serde_json::to_string(&value)?);
        } else {
            self.output.push_str("null");
        }
        Ok(())
    }

    fn serialize_char(self, value: char) -> Result<Self::Ok, Self::Error> {
        self.output.push_str(&serde_json::to_string(&value)?);
        Ok(())
    }

    fn serialize_str(self, value: &str) -> Result<Self::Ok, Self::Error> {
        self.output.push_str(&serde_json::to_string(value)?);
        Ok(())
    }

    fn serialize_bytes(self, value: &[u8]) -> Result<Self::Ok, Self::Error> {
        self.output.push('[');
        for (index, byte) in value.iter().enumerate() {
            if index > 0 {
                self.output.push(',');
            }
            self.output.push_str(&byte.to_string());
        }
        self.output.push(']');
        Ok(())
    }

    fn serialize_none(self) -> Result<Self::Ok, Self::Error> {
        self.output.push_str("null");
        Ok(())
    }

    fn serialize_some<T: Serialize + ?Sized>(self, value: &T) -> Result<Self::Ok, Self::Error> {
        value.serialize(self)
    }

    fn serialize_unit(self) -> Result<Self::Ok, Self::Error> {
        self.output.push_str("null");
        Ok(())
    }

    fn serialize_unit_struct(self, _name: &'static str) -> Result<Self::Ok, Self::Error> {
        self.serialize_unit()
    }

    fn serialize_unit_variant(
        self,
        _name: &'static str,
        _variant_index: u32,
        variant: &'static str,
    ) -> Result<Self::Ok, Self::Error> {
        self.serialize_str(variant)
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
        variant: &'static str,
        value: &T,
    ) -> Result<Self::Ok, Self::Error> {
        let value = serialize_fragment(value)?;
        finish_object(
            self.output,
            vec![CanonicalObjectEntry {
                key: variant.to_owned(),
                value: value.output,
                deferred_numeric_error: value.deferred_numeric_error,
                index: 0,
            }],
            self.deferred_numeric_error,
        )
    }

    fn serialize_seq(self, length: Option<usize>) -> Result<Self::SerializeSeq, Self::Error> {
        self.output.push('[');
        Ok(CanonicalSequence {
            output: self.output,
            deferred_numeric_error: self.deferred_numeric_error,
            first: true,
            _length: length,
        })
    }

    fn serialize_tuple(self, length: usize) -> Result<Self::SerializeTuple, Self::Error> {
        self.serialize_seq(Some(length))
    }

    fn serialize_tuple_struct(
        self,
        _name: &'static str,
        length: usize,
    ) -> Result<Self::SerializeTupleStruct, Self::Error> {
        self.serialize_seq(Some(length))
    }

    fn serialize_tuple_variant(
        self,
        _name: &'static str,
        _variant_index: u32,
        variant: &'static str,
        length: usize,
    ) -> Result<Self::SerializeTupleVariant, Self::Error> {
        Ok(CanonicalTupleVariant {
            output: self.output,
            deferred_numeric_error: self.deferred_numeric_error,
            variant,
            fields: Vec::with_capacity(length),
        })
    }

    fn serialize_map(self, length: Option<usize>) -> Result<Self::SerializeMap, Self::Error> {
        Ok(CanonicalMap {
            output: self.output,
            deferred_numeric_error: self.deferred_numeric_error,
            entries: Vec::with_capacity(length.unwrap_or(0)),
            pending_key: None,
        })
    }

    fn serialize_struct(
        self,
        _name: &'static str,
        length: usize,
    ) -> Result<Self::SerializeStruct, Self::Error> {
        Ok(CanonicalStruct {
            output: self.output,
            deferred_numeric_error: self.deferred_numeric_error,
            entries: Vec::with_capacity(length),
        })
    }

    fn serialize_struct_variant(
        self,
        _name: &'static str,
        _variant_index: u32,
        variant: &'static str,
        length: usize,
    ) -> Result<Self::SerializeStructVariant, Self::Error> {
        Ok(CanonicalStructVariant {
            output: self.output,
            deferred_numeric_error: self.deferred_numeric_error,
            variant,
            entries: Vec::with_capacity(length),
        })
    }
}

struct CanonicalSequence<'output, 'deferred> {
    output: &'output mut String,
    deferred_numeric_error: &'deferred mut Option<DeferredNumericError>,
    first: bool,
    _length: Option<usize>,
}

impl CanonicalSequence<'_, '_> {
    fn serialize_element<T: Serialize + ?Sized>(
        &mut self,
        value: &T,
    ) -> Result<(), CanonicalError> {
        if self.first {
            self.first = false;
        } else {
            self.output.push(',');
        }
        serialize_canonical_into(value, self.output, self.deferred_numeric_error)
    }

    fn end(self) -> Result<(), CanonicalError> {
        self.output.push(']');
        Ok(())
    }
}

impl SerializeSeq for CanonicalSequence<'_, '_> {
    type Ok = ();
    type Error = CanonicalError;

    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Self::Error> {
        CanonicalSequence::serialize_element(self, value)
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        CanonicalSequence::end(self)
    }
}

impl SerializeTuple for CanonicalSequence<'_, '_> {
    type Ok = ();
    type Error = CanonicalError;

    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Self::Error> {
        CanonicalSequence::serialize_element(self, value)
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        CanonicalSequence::end(self)
    }
}

impl SerializeTupleStruct for CanonicalSequence<'_, '_> {
    type Ok = ();
    type Error = CanonicalError;

    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Self::Error> {
        CanonicalSequence::serialize_element(self, value)
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        CanonicalSequence::end(self)
    }
}

struct CanonicalObjectEntry {
    key: String,
    value: String,
    deferred_numeric_error: Option<DeferredNumericError>,
    index: usize,
}

fn finish_object(
    output: &mut String,
    mut entries: Vec<CanonicalObjectEntry>,
    deferred_numeric_error: &mut Option<DeferredNumericError>,
) -> Result<(), CanonicalError> {
    entries.sort_unstable_by(|left, right| {
        utf16_key_cmp(&left.key, &right.key).then_with(|| left.index.cmp(&right.index))
    });

    let mut unique: Vec<CanonicalObjectEntry> = Vec::with_capacity(entries.len());
    for entry in entries {
        if let Some(previous) = unique.last_mut()
            && previous.key == entry.key
        {
            *previous = entry;
            continue;
        }
        unique.push(entry);
    }

    output.push('{');
    for (index, entry) in unique.into_iter().enumerate() {
        if index > 0 {
            output.push(',');
        }
        output.push_str(&serde_json::to_string(&entry.key)?);
        output.push(':');
        output.push_str(&entry.value);
        if deferred_numeric_error.is_none() {
            *deferred_numeric_error = entry.deferred_numeric_error;
        }
    }
    output.push('}');
    Ok(())
}

struct CanonicalMap<'output, 'deferred> {
    output: &'output mut String,
    deferred_numeric_error: &'deferred mut Option<DeferredNumericError>,
    entries: Vec<CanonicalObjectEntry>,
    pending_key: Option<String>,
}

impl SerializeMap for CanonicalMap<'_, '_> {
    type Ok = ();
    type Error = CanonicalError;

    fn serialize_key<T: Serialize + ?Sized>(&mut self, key: &T) -> Result<(), Self::Error> {
        if self.pending_key.is_some() {
            return Err(serialization_error(
                "serialize_key called before serializing the previous value",
            ));
        }
        self.pending_key = Some(key.serialize(CanonicalMapKeySerializer)?);
        Ok(())
    }

    fn serialize_value<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Self::Error> {
        let key = self
            .pending_key
            .take()
            .ok_or_else(|| serialization_error("serialize_value called before serialize_key"))?;
        let value = serialize_fragment(value)?;
        let index = self.entries.len();
        self.entries.push(CanonicalObjectEntry {
            key,
            value: value.output,
            deferred_numeric_error: value.deferred_numeric_error,
            index,
        });
        Ok(())
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        if self.pending_key.is_some() {
            return Err(serialization_error(
                "serialize_map ended before serializing a value",
            ));
        }
        finish_object(self.output, self.entries, self.deferred_numeric_error)
    }
}

struct CanonicalStruct<'output, 'deferred> {
    output: &'output mut String,
    deferred_numeric_error: &'deferred mut Option<DeferredNumericError>,
    entries: Vec<CanonicalObjectEntry>,
}

impl SerializeStruct for CanonicalStruct<'_, '_> {
    type Ok = ();
    type Error = CanonicalError;

    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), Self::Error> {
        let value = serialize_fragment(value)?;
        let index = self.entries.len();
        self.entries.push(CanonicalObjectEntry {
            key: key.to_owned(),
            value: value.output,
            deferred_numeric_error: value.deferred_numeric_error,
            index,
        });
        Ok(())
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        finish_object(self.output, self.entries, self.deferred_numeric_error)
    }
}

struct CanonicalTupleVariant<'output, 'deferred> {
    output: &'output mut String,
    deferred_numeric_error: &'deferred mut Option<DeferredNumericError>,
    variant: &'static str,
    fields: Vec<CanonicalFragment>,
}

impl SerializeTupleVariant for CanonicalTupleVariant<'_, '_> {
    type Ok = ();
    type Error = CanonicalError;

    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Self::Error> {
        self.fields.push(serialize_fragment(value)?);
        Ok(())
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        let mut value = String::new();
        let mut variant_deferred_numeric_error = None;
        value.push('[');
        for (index, field) in self.fields.into_iter().enumerate() {
            if index > 0 {
                value.push(',');
            }
            value.push_str(&field.output);
            if variant_deferred_numeric_error.is_none() {
                variant_deferred_numeric_error = field.deferred_numeric_error;
            }
        }
        value.push(']');
        finish_object(
            self.output,
            vec![CanonicalObjectEntry {
                key: self.variant.to_owned(),
                value,
                deferred_numeric_error: variant_deferred_numeric_error,
                index: 0,
            }],
            self.deferred_numeric_error,
        )
    }
}

struct CanonicalStructVariant<'output, 'deferred> {
    output: &'output mut String,
    deferred_numeric_error: &'deferred mut Option<DeferredNumericError>,
    variant: &'static str,
    entries: Vec<CanonicalObjectEntry>,
}

impl SerializeStructVariant for CanonicalStructVariant<'_, '_> {
    type Ok = ();
    type Error = CanonicalError;

    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), Self::Error> {
        let value = serialize_fragment(value)?;
        let index = self.entries.len();
        self.entries.push(CanonicalObjectEntry {
            key: key.to_owned(),
            value: value.output,
            deferred_numeric_error: value.deferred_numeric_error,
            index,
        });
        Ok(())
    }

    fn end(self) -> Result<Self::Ok, Self::Error> {
        let mut value = String::new();
        let mut variant_deferred_numeric_error = None;
        finish_object(
            &mut value,
            self.entries,
            &mut variant_deferred_numeric_error,
        )?;
        finish_object(
            self.output,
            vec![CanonicalObjectEntry {
                key: self.variant.to_owned(),
                value,
                deferred_numeric_error: variant_deferred_numeric_error,
                index: 0,
            }],
            self.deferred_numeric_error,
        )
    }
}

#[derive(Clone, Copy)]
struct CanonicalMapKeySerializer;

impl Serializer for CanonicalMapKeySerializer {
    type Ok = String;
    type Error = CanonicalError;
    type SerializeSeq = Impossible<Self::Ok, Self::Error>;
    type SerializeTuple = Impossible<Self::Ok, Self::Error>;
    type SerializeTupleStruct = Impossible<Self::Ok, Self::Error>;
    type SerializeTupleVariant = Impossible<Self::Ok, Self::Error>;
    type SerializeMap = Impossible<Self::Ok, Self::Error>;
    type SerializeStruct = Impossible<Self::Ok, Self::Error>;
    type SerializeStructVariant = Impossible<Self::Ok, Self::Error>;

    fn serialize_bool(self, value: bool) -> Result<Self::Ok, Self::Error> {
        Ok(if value { "true" } else { "false" }.to_owned())
    }

    fn serialize_i8(self, value: i8) -> Result<Self::Ok, Self::Error> {
        Ok(value.to_string())
    }

    fn serialize_i16(self, value: i16) -> Result<Self::Ok, Self::Error> {
        Ok(value.to_string())
    }

    fn serialize_i32(self, value: i32) -> Result<Self::Ok, Self::Error> {
        Ok(value.to_string())
    }

    fn serialize_i64(self, value: i64) -> Result<Self::Ok, Self::Error> {
        Ok(value.to_string())
    }

    fn serialize_i128(self, value: i128) -> Result<Self::Ok, Self::Error> {
        Ok(value.to_string())
    }

    fn serialize_u8(self, value: u8) -> Result<Self::Ok, Self::Error> {
        Ok(value.to_string())
    }

    fn serialize_u16(self, value: u16) -> Result<Self::Ok, Self::Error> {
        Ok(value.to_string())
    }

    fn serialize_u32(self, value: u32) -> Result<Self::Ok, Self::Error> {
        Ok(value.to_string())
    }

    fn serialize_u64(self, value: u64) -> Result<Self::Ok, Self::Error> {
        Ok(value.to_string())
    }

    fn serialize_u128(self, value: u128) -> Result<Self::Ok, Self::Error> {
        Ok(value.to_string())
    }

    fn serialize_f32(self, value: f32) -> Result<Self::Ok, Self::Error> {
        if value.is_finite() {
            serde_json::to_string(&value).map_err(CanonicalError::from)
        } else {
            Err(serialization_error(
                "float key must be finite (got NaN or +/-inf)",
            ))
        }
    }

    fn serialize_f64(self, value: f64) -> Result<Self::Ok, Self::Error> {
        if value.is_finite() {
            serde_json::to_string(&value).map_err(CanonicalError::from)
        } else {
            Err(serialization_error(
                "float key must be finite (got NaN or +/-inf)",
            ))
        }
    }

    fn serialize_char(self, value: char) -> Result<Self::Ok, Self::Error> {
        Ok(value.to_string())
    }

    fn serialize_str(self, value: &str) -> Result<Self::Ok, Self::Error> {
        Ok(value.to_owned())
    }

    fn serialize_bytes(self, _value: &[u8]) -> Result<Self::Ok, Self::Error> {
        Err(serialization_error("key must be a string"))
    }

    fn serialize_none(self) -> Result<Self::Ok, Self::Error> {
        Err(serialization_error("key must be a string"))
    }

    fn serialize_some<T: Serialize + ?Sized>(self, value: &T) -> Result<Self::Ok, Self::Error> {
        value.serialize(self)
    }

    fn serialize_unit(self) -> Result<Self::Ok, Self::Error> {
        Err(serialization_error("key must be a string"))
    }

    fn serialize_unit_struct(self, _name: &'static str) -> Result<Self::Ok, Self::Error> {
        Err(serialization_error("key must be a string"))
    }

    fn serialize_unit_variant(
        self,
        _name: &'static str,
        _variant_index: u32,
        variant: &'static str,
    ) -> Result<Self::Ok, Self::Error> {
        Ok(variant.to_owned())
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
        _value: &T,
    ) -> Result<Self::Ok, Self::Error> {
        Err(serialization_error("key must be a string"))
    }

    fn serialize_seq(self, _length: Option<usize>) -> Result<Self::SerializeSeq, Self::Error> {
        Err(serialization_error("key must be a string"))
    }

    fn serialize_tuple(self, _length: usize) -> Result<Self::SerializeTuple, Self::Error> {
        Err(serialization_error("key must be a string"))
    }

    fn serialize_tuple_struct(
        self,
        _name: &'static str,
        _length: usize,
    ) -> Result<Self::SerializeTupleStruct, Self::Error> {
        Err(serialization_error("key must be a string"))
    }

    fn serialize_tuple_variant(
        self,
        _name: &'static str,
        _variant_index: u32,
        _variant: &'static str,
        _length: usize,
    ) -> Result<Self::SerializeTupleVariant, Self::Error> {
        Err(serialization_error("key must be a string"))
    }

    fn serialize_map(self, _length: Option<usize>) -> Result<Self::SerializeMap, Self::Error> {
        Err(serialization_error("key must be a string"))
    }

    fn serialize_struct(
        self,
        _name: &'static str,
        _length: usize,
    ) -> Result<Self::SerializeStruct, Self::Error> {
        Err(serialization_error("key must be a string"))
    }

    fn serialize_struct_variant(
        self,
        _name: &'static str,
        _variant_index: u32,
        _variant: &'static str,
        _length: usize,
    ) -> Result<Self::SerializeStructVariant, Self::Error> {
        Err(serialization_error("key must be a string"))
    }
}

#[cfg(test)]
fn legacy_canonical_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, CanonicalError> {
    let value = validated_value(value)?;
    let mut output = String::new();
    write_value(&value, &mut output, false)?;
    Ok(output.into_bytes())
}

#[cfg(test)]
fn validated_value<T: Serialize>(value: &T) -> Result<Value, CanonicalError> {
    validate_numbers(value)?;
    Ok(serde_json::to_value(value)?)
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
        fixture_digest, legacy_canonical_bytes, verify_fixture_digest,
    };
    use serde::Serialize;
    use serde::Serializer;
    use serde::ser::SerializeMap;
    use serde::ser::SerializeSeq;
    use serde_json::{Map, Value};
    use std::cell::Cell;
    use std::collections::BTreeMap;
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

    #[derive(Serialize)]
    enum NestedEnum {
        Unit,
        Newtype(Option<i64>),
        Tuple(bool, Vec<Option<String>>),
        Struct {
            map: BTreeMap<String, i64>,
            unit: (),
        },
    }

    #[derive(Serialize)]
    struct DirectShape {
        nested: BTreeMap<i32, Option<NestedEnum>>,
        escaped: String,
        values: Vec<Value>,
    }

    struct DuplicateSerializedKeys;

    impl Serialize for DuplicateSerializedKeys {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            let mut map = serializer.serialize_map(Some(3))?;
            map.serialize_entry(&1_i32, "first")?;
            map.serialize_entry("1", "second")?;
            map.serialize_entry(&true, "bool")?;
            map.end()
        }
    }

    struct FloatMapKey;

    impl Serialize for FloatMapKey {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            let mut map = serializer.serialize_map(Some(1))?;
            map.serialize_entry(&1.5_f64, "float-key")?;
            map.end()
        }
    }

    const UNSAFE_INTEGER: u64 = 9_007_199_254_740_992;
    const CUSTOM_ERROR_MESSAGE: &str = "mixed-invalid custom serialization error";

    #[derive(Serialize)]
    enum MixedInvalidEnum {
        UnsafeThenFloat(u64, f64),
        FloatThenUnsafe(f64, u64),
        StructUnsafeThenFloat { unsafe_integer: u64, float: f64 },
        StructFloatThenUnsafe { float: f64, unsafe_integer: u64 },
    }

    #[derive(Serialize)]
    struct NestedUnsafeThenFloat {
        unsafe_integer: u64,
        nested: MixedInvalidEnum,
    }

    #[derive(Serialize)]
    struct NestedFloatThenUnsafe {
        nested: MixedInvalidEnum,
        unsafe_integer: u64,
    }

    struct CustomSerializationError;

    impl Serialize for CustomSerializationError {
        fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            Err(<S::Error as serde::ser::Error>::custom(
                CUSTOM_ERROR_MESSAGE,
            ))
        }
    }

    #[derive(Serialize)]
    enum WideMixedInvalidEnum {
        I128ThenNestedFloat(i128, Option<Vec<f64>>),
        NestedFloatThenU128 {
            nested: Vec<Option<f64>>,
            wide: u128,
        },
        U128ThenNestedCustom(u128, Option<CustomSerializationError>),
        NestedCustomThenI128 {
            nested: Vec<CustomSerializationError>,
            wide: i128,
        },
    }

    enum InvalidStructuralMapCase {
        InvalidThenFloat,
        FloatThenInvalid,
        InvalidThenCustom,
        CustomThenInvalid,
        InvalidOnly,
        InvalidThenI128,
        I128ThenInvalid,
        InvalidThenU128,
        U128ThenInvalid,
    }

    impl Serialize for InvalidStructuralMapCase {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            let invalid_key = (1_u8, 2_u8);
            let mut map = serializer.serialize_map(None)?;
            match self {
                Self::InvalidThenFloat => {
                    map.serialize_entry(&invalid_key, &0_u8)?;
                    map.serialize_entry("later", &1.0_f64)?;
                }
                Self::FloatThenInvalid => {
                    map.serialize_entry("first", &1.0_f64)?;
                    map.serialize_entry(&invalid_key, &0_u8)?;
                }
                Self::InvalidThenCustom => {
                    map.serialize_entry(&invalid_key, &0_u8)?;
                    map.serialize_entry("later", &CustomSerializationError)?;
                }
                Self::CustomThenInvalid => {
                    map.serialize_entry("first", &CustomSerializationError)?;
                    map.serialize_entry(&invalid_key, &0_u8)?;
                }
                Self::InvalidOnly => {
                    map.serialize_entry(&invalid_key, &0_u8)?;
                }
                Self::InvalidThenI128 => {
                    map.serialize_entry(&invalid_key, &0_u8)?;
                    map.serialize_entry("later", &i128::MAX)?;
                }
                Self::I128ThenInvalid => {
                    map.serialize_entry("first", &i128::MAX)?;
                    map.serialize_entry(&invalid_key, &0_u8)?;
                }
                Self::InvalidThenU128 => {
                    map.serialize_entry(&invalid_key, &0_u8)?;
                    map.serialize_entry("later", &u128::MAX)?;
                }
                Self::U128ThenInvalid => {
                    map.serialize_entry("first", &u128::MAX)?;
                    map.serialize_entry(&invalid_key, &0_u8)?;
                }
            }
            map.end()
        }
    }

    struct FloatSequenceMapKey;

    impl Serialize for FloatSequenceMapKey {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            let mut sequence = serializer.serialize_seq(Some(2))?;
            sequence.serialize_element(&0_u8)?;
            sequence.serialize_element(&1.0_f64)?;
            sequence.end()
        }
    }

    struct CustomSequenceMapKey;

    impl Serialize for CustomSequenceMapKey {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            let mut sequence = serializer.serialize_seq(Some(2))?;
            sequence.serialize_element(&0_u8)?;
            sequence.serialize_element(&CustomSerializationError)?;
            sequence.end()
        }
    }

    enum CompoundMapKeyCase {
        FloatThenLaterValues,
        CustomThenLaterValues,
    }

    impl Serialize for CompoundMapKeyCase {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            let mut map = serializer.serialize_map(None)?;
            match self {
                Self::FloatThenLaterValues => {
                    map.serialize_entry(&FloatSequenceMapKey, &0_u8)?;
                    map.serialize_entry("later-unsafe", &i128::MAX)?;
                    map.serialize_entry("later-custom", &CustomSerializationError)?;
                }
                Self::CustomThenLaterValues => {
                    map.serialize_entry(&CustomSequenceMapKey, &0_u8)?;
                    map.serialize_entry("later-float", &1.0_f64)?;
                    map.serialize_entry("later-wide", &u128::MAX)?;
                }
            }
            map.end()
        }
    }

    const STATEFUL_ERROR_MESSAGE: &str = "stateful second invocation error";
    const STATEFUL_FIRST_ERROR_MESSAGE: &str = "stateful first invocation error";

    struct StatefulDifferentBytes<'calls> {
        calls: &'calls Cell<usize>,
    }

    impl Serialize for StatefulDifferentBytes<'_> {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            let invocation = self.calls.get();
            self.calls.set(invocation + 1);
            if invocation == 0 {
                serializer.serialize_str("first invocation")
            } else {
                serializer.serialize_str("second invocation")
            }
        }
    }

    struct StatefulSecondInvocationError<'calls> {
        calls: &'calls Cell<usize>,
    }

    impl Serialize for StatefulSecondInvocationError<'_> {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            let invocation = self.calls.get();
            self.calls.set(invocation + 1);
            if invocation == 0 {
                serializer.serialize_str("first invocation succeeds")
            } else {
                Err(<S::Error as serde::ser::Error>::custom(
                    STATEFUL_ERROR_MESSAGE,
                ))
            }
        }
    }

    struct StatefulFirstInvocationError<'calls> {
        calls: &'calls Cell<usize>,
    }

    impl Serialize for StatefulFirstInvocationError<'_> {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            let invocation = self.calls.get();
            self.calls.set(invocation + 1);
            if invocation == 0 {
                Err(<S::Error as serde::ser::Error>::custom(
                    STATEFUL_FIRST_ERROR_MESSAGE,
                ))
            } else {
                serializer.serialize_str("second invocation must not occur")
            }
        }
    }

    #[derive(Clone, Copy)]
    enum StatefulFloatCase {
        FiniteF32,
        NanF32,
        PositiveInfinityF32,
        NegativeInfinityF32,
        FiniteF64,
        NanF64,
        PositiveInfinityF64,
        NegativeInfinityF64,
    }

    impl StatefulFloatCase {
        fn is_finite(self) -> bool {
            matches!(self, Self::FiniteF32 | Self::FiniteF64)
        }
    }

    struct StatefulSecondPassFloatValue<'calls> {
        calls: &'calls Cell<usize>,
        value: StatefulFloatCase,
    }

    impl Serialize for StatefulSecondPassFloatValue<'_> {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            let invocation = self.calls.get();
            self.calls.set(invocation + 1);
            if invocation == 0 {
                serializer.serialize_str("validation pass")
            } else {
                match self.value {
                    StatefulFloatCase::FiniteF32 => serializer.serialize_f32(1.5_f32),
                    StatefulFloatCase::NanF32 => serializer.serialize_f32(f32::NAN),
                    StatefulFloatCase::PositiveInfinityF32 => {
                        serializer.serialize_f32(f32::INFINITY)
                    }
                    StatefulFloatCase::NegativeInfinityF32 => {
                        serializer.serialize_f32(f32::NEG_INFINITY)
                    }
                    StatefulFloatCase::FiniteF64 => serializer.serialize_f64(1.5_f64),
                    StatefulFloatCase::NanF64 => serializer.serialize_f64(f64::NAN),
                    StatefulFloatCase::PositiveInfinityF64 => {
                        serializer.serialize_f64(f64::INFINITY)
                    }
                    StatefulFloatCase::NegativeInfinityF64 => {
                        serializer.serialize_f64(f64::NEG_INFINITY)
                    }
                }
            }
        }
    }

    #[derive(Clone, Copy)]
    enum StatefulFloatMapKeyValue {
        F32(f32),
        F64(f64),
    }

    impl StatefulFloatMapKeyValue {
        fn is_finite(self) -> bool {
            match self {
                Self::F32(value) => value.is_finite(),
                Self::F64(value) => value.is_finite(),
            }
        }
    }

    fn serialize_float_map_entry<M, V>(
        map: &mut M,
        key: StatefulFloatMapKeyValue,
        value: &V,
    ) -> Result<(), M::Error>
    where
        M: SerializeMap,
        V: Serialize + ?Sized,
    {
        match key {
            StatefulFloatMapKeyValue::F32(key) => map.serialize_entry(&key, value),
            StatefulFloatMapKeyValue::F64(key) => map.serialize_entry(&key, value),
        }
    }

    struct StatefulSecondPassFloatMapKey<'calls> {
        calls: &'calls Cell<usize>,
        value: StatefulFloatMapKeyValue,
    }

    impl Serialize for StatefulSecondPassFloatMapKey<'_> {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            let invocation = self.calls.get();
            self.calls.set(invocation + 1);
            if invocation == 0 {
                serializer.serialize_u8(0)
            } else {
                let mut map = serializer.serialize_map(Some(1))?;
                serialize_float_map_entry(&mut map, self.value, "value")?;
                map.end()
            }
        }
    }

    #[derive(Clone, Copy)]
    enum StatefulFloatMapCase {
        FloatThenString(StatefulFloatMapKeyValue),
        StringThenFloat(StatefulFloatMapKeyValue),
        FloatInvalidThenStringValid(StatefulFloatMapKeyValue),
        StringValidThenFloatInvalid(StatefulFloatMapKeyValue),
        NonfiniteAfterUnsafe(StatefulFloatMapKeyValue),
    }

    struct StatefulSecondPassFloatMap<'calls> {
        calls: &'calls Cell<usize>,
        case: StatefulFloatMapCase,
    }

    impl Serialize for StatefulSecondPassFloatMap<'_> {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            let invocation = self.calls.get();
            self.calls.set(invocation + 1);
            if invocation == 0 {
                serializer.serialize_str("validation pass")
            } else {
                let mut map = serializer.serialize_map(Some(2))?;
                match self.case {
                    StatefulFloatMapCase::FloatThenString(key) => {
                        serialize_float_map_entry(&mut map, key, "float")?;
                        map.serialize_entry("1.0", "string")?;
                    }
                    StatefulFloatMapCase::StringThenFloat(key) => {
                        map.serialize_entry("1.0", "string")?;
                        serialize_float_map_entry(&mut map, key, "float")?;
                    }
                    StatefulFloatMapCase::FloatInvalidThenStringValid(key) => {
                        serialize_float_map_entry(&mut map, key, &UNSAFE_INTEGER)?;
                        map.serialize_entry("1.0", &1_u64)?;
                    }
                    StatefulFloatMapCase::StringValidThenFloatInvalid(key) => {
                        map.serialize_entry("1.0", &1_u64)?;
                        serialize_float_map_entry(&mut map, key, &UNSAFE_INTEGER)?;
                    }
                    StatefulFloatMapCase::NonfiniteAfterUnsafe(key) => {
                        map.serialize_entry("before", &UNSAFE_INTEGER)?;
                        serialize_float_map_entry(&mut map, key, "value")?;
                    }
                }
                map.end()
            }
        }
    }

    #[derive(Clone, Copy)]
    enum StatefulOrderingCase {
        FloatThenCustom,
        CustomThenFloat,
        FloatThenI128,
        I128ThenFloat,
        FloatThenU128,
        U128ThenFloat,
        FloatThenUnsafe,
        UnsafeThenFloat,
        FloatOverwrittenByValid,
        ValidOverwrittenByFloat,
        NestedFloatBeforeUnsafe,
        NestedUnsafeBeforeFloat,
    }

    impl Serialize for StatefulOrderingCase {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            match self {
                Self::FloatThenCustom => {
                    let mut sequence = serializer.serialize_seq(Some(2))?;
                    sequence.serialize_element(&1.5_f64)?;
                    sequence.serialize_element(&CustomSerializationError)?;
                    sequence.end()
                }
                Self::CustomThenFloat => {
                    let mut sequence = serializer.serialize_seq(Some(2))?;
                    sequence.serialize_element(&CustomSerializationError)?;
                    sequence.serialize_element(&1.5_f64)?;
                    sequence.end()
                }
                Self::FloatThenI128 => {
                    let mut sequence = serializer.serialize_seq(Some(2))?;
                    sequence.serialize_element(&1.5_f64)?;
                    sequence.serialize_element(&i128::MAX)?;
                    sequence.end()
                }
                Self::I128ThenFloat => {
                    let mut sequence = serializer.serialize_seq(Some(2))?;
                    sequence.serialize_element(&i128::MAX)?;
                    sequence.serialize_element(&1.5_f64)?;
                    sequence.end()
                }
                Self::FloatThenU128 => {
                    let mut sequence = serializer.serialize_seq(Some(2))?;
                    sequence.serialize_element(&1.5_f64)?;
                    sequence.serialize_element(&u128::MAX)?;
                    sequence.end()
                }
                Self::U128ThenFloat => {
                    let mut sequence = serializer.serialize_seq(Some(2))?;
                    sequence.serialize_element(&u128::MAX)?;
                    sequence.serialize_element(&1.5_f64)?;
                    sequence.end()
                }
                Self::FloatThenUnsafe => {
                    let mut sequence = serializer.serialize_seq(Some(2))?;
                    sequence.serialize_element(&1.5_f64)?;
                    sequence.serialize_element(&UNSAFE_INTEGER)?;
                    sequence.end()
                }
                Self::UnsafeThenFloat => {
                    let mut sequence = serializer.serialize_seq(Some(2))?;
                    sequence.serialize_element(&UNSAFE_INTEGER)?;
                    sequence.serialize_element(&1.5_f64)?;
                    sequence.end()
                }
                Self::FloatOverwrittenByValid => {
                    let mut map = serializer.serialize_map(Some(2))?;
                    map.serialize_entry("same", &1.5_f64)?;
                    map.serialize_entry("same", &1_u8)?;
                    map.end()
                }
                Self::ValidOverwrittenByFloat => {
                    let mut map = serializer.serialize_map(Some(2))?;
                    map.serialize_entry("same", &1_u8)?;
                    map.serialize_entry("same", &1.5_f64)?;
                    map.end()
                }
                Self::NestedFloatBeforeUnsafe => {
                    let mut map = serializer.serialize_map(Some(1))?;
                    map.serialize_entry(
                        "nested",
                        &NestedUtf16NumericErrors {
                            float_at_astral_key: true,
                        },
                    )?;
                    map.end()
                }
                Self::NestedUnsafeBeforeFloat => {
                    let mut map = serializer.serialize_map(Some(1))?;
                    map.serialize_entry(
                        "nested",
                        &NestedUtf16NumericErrors {
                            float_at_astral_key: false,
                        },
                    )?;
                    map.end()
                }
            }
        }
    }

    struct NestedUtf16NumericErrors {
        float_at_astral_key: bool,
    }

    impl Serialize for NestedUtf16NumericErrors {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            let mut map = serializer.serialize_map(Some(2))?;
            if self.float_at_astral_key {
                map.serialize_entry("\u{e000}", &UNSAFE_INTEGER)?;
                map.serialize_entry("\u{10000}", &1.5_f64)?;
            } else {
                map.serialize_entry("\u{e000}", &1.5_f64)?;
                map.serialize_entry("\u{10000}", &UNSAFE_INTEGER)?;
            }
            map.end()
        }
    }

    struct StatefulSecondPassOrdering<'calls> {
        calls: &'calls Cell<usize>,
        case: StatefulOrderingCase,
    }

    impl Serialize for StatefulSecondPassOrdering<'_> {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            let invocation = self.calls.get();
            self.calls.set(invocation + 1);
            if invocation == 0 {
                serializer.serialize_str("validation pass")
            } else {
                self.case.serialize(serializer)
            }
        }
    }

    struct CustomErrorAfterUnsafe;

    impl Serialize for CustomErrorAfterUnsafe {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            let mut map = serializer.serialize_map(Some(1))?;
            map.serialize_entry("unsafe", &UNSAFE_INTEGER)?;
            Err(<S::Error as serde::ser::Error>::custom(
                CUSTOM_ERROR_MESSAGE,
            ))
        }
    }

    struct OverwrittenUnsafeInteger;

    impl Serialize for OverwrittenUnsafeInteger {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: Serializer,
        {
            let mut map = serializer.serialize_map(Some(2))?;
            map.serialize_entry("same", &UNSAFE_INTEGER)?;
            map.serialize_entry("same", &1_u64)?;
            map.end()
        }
    }

    fn canonical_error_identity(error: CanonicalError) -> (&'static str, String) {
        let display = error.to_string();
        match error {
            CanonicalError::Serialization(source) => {
                ("Serialization", format!("{display}|{source}"))
            }
            CanonicalError::UnsupportedNumber => ("UnsupportedNumber", display),
            CanonicalError::UnsafeInteger { value } => {
                ("UnsafeInteger", format!("{display}|{value}"))
            }
            CanonicalError::DigestMismatch { expected, actual } => {
                ("DigestMismatch", format!("{display}|{expected}|{actual}"))
            }
        }
    }

    fn direct_matches_legacy<T: Serialize>(value: &T) {
        let direct = canonical_result_identity(canonical_bytes(value));
        let legacy = canonical_result_identity(legacy_canonical_bytes(value));
        assert_eq!(direct, legacy);
    }

    type CanonicalResultIdentity = Result<Vec<u8>, (&'static str, String)>;

    fn canonical_result_identity(
        result: Result<Vec<u8>, CanonicalError>,
    ) -> CanonicalResultIdentity {
        result.map_err(canonical_error_identity)
    }

    fn expected_unsupported_number() -> CanonicalResultIdentity {
        Err((
            "UnsupportedNumber",
            "canonical JSON does not permit floats, NaN, or infinity".to_owned(),
        ))
    }

    fn expected_serialization(message: &str) -> CanonicalResultIdentity {
        Err((
            "Serialization",
            format!("JSON serialization failed: {message}|{message}"),
        ))
    }

    fn expected_unsafe_integer(value: u64) -> CanonicalResultIdentity {
        Err((
            "UnsafeInteger",
            format!("integer {value} exceeds JavaScript's maximum safe integer|{value}"),
        ))
    }

    fn stateful_ordering_matches_legacy(
        case: StatefulOrderingCase,
        expected: CanonicalResultIdentity,
    ) {
        let direct_calls = Cell::new(0);
        let legacy_calls = Cell::new(0);
        let direct = canonical_result_identity(canonical_bytes(&StatefulSecondPassOrdering {
            calls: &direct_calls,
            case,
        }));
        let legacy =
            canonical_result_identity(legacy_canonical_bytes(&StatefulSecondPassOrdering {
                calls: &legacy_calls,
                case,
            }));

        assert_eq!(direct, legacy);
        assert_eq!(direct, expected);
        assert_eq!(direct_calls.get(), 2);
        assert_eq!(legacy_calls.get(), 2);
    }

    fn stateful_float_map_matches_legacy(
        case: StatefulFloatMapCase,
        expected: CanonicalResultIdentity,
    ) {
        let direct_calls = Cell::new(0);
        let legacy_calls = Cell::new(0);
        let direct = canonical_result_identity(canonical_bytes(&StatefulSecondPassFloatMap {
            calls: &direct_calls,
            case,
        }));
        let legacy =
            canonical_result_identity(legacy_canonical_bytes(&StatefulSecondPassFloatMap {
                calls: &legacy_calls,
                case,
            }));

        assert_eq!(direct, legacy);
        assert_eq!(direct, expected);
        assert_eq!(direct_calls.get(), 2);
        assert_eq!(legacy_calls.get(), 2);
    }

    #[test]
    fn direct_serializer_matches_legacy_across_nested_shapes() -> Result<(), Box<dyn Error>> {
        let mut nested_map = BTreeMap::new();
        nested_map.insert(10, Some(NestedEnum::Unit));
        nested_map.insert(2, Some(NestedEnum::Newtype(Some(-1))));

        let mut enum_map = BTreeMap::new();
        enum_map.insert("z".to_owned(), 2_i64);
        enum_map.insert("a".to_owned(), -1_i64);

        let shape = DirectShape {
            nested: nested_map,
            escaped: "quote\" slash\\ newline\n tab\t control\u{0008}".to_owned(),
            values: vec![
                Value::Null,
                Value::Bool(true),
                Value::Array(vec![Value::from(3_u64), Value::from(-1_i64)]),
                Value::Object({
                    let mut object = Map::new();
                    object.insert("\u{10000}".to_owned(), Value::String("astral".to_owned()));
                    object.insert("\u{e000}".to_owned(), Value::String("bmp".to_owned()));
                    object
                }),
            ],
        };

        direct_matches_legacy(&shape);
        direct_matches_legacy(&NestedEnum::Tuple(
            false,
            vec![Some("first".to_owned()), None],
        ));
        direct_matches_legacy(&NestedEnum::Struct {
            map: enum_map,
            unit: (),
        });
        direct_matches_legacy(&NestedEnum::Newtype(None));
        direct_matches_legacy(&NestedEnum::Unit);
        Ok(())
    }

    #[test]
    fn direct_serializer_preserves_map_keys_and_last_duplicate() -> Result<(), Box<dyn Error>> {
        let mut keys = BTreeMap::new();
        keys.insert(-2_i32, "negative");
        keys.insert(10_i32, "ten");
        direct_matches_legacy(&keys);
        assert_eq!(canonicalize(&keys)?, r#"{"-2":"negative","10":"ten"}"#);

        direct_matches_legacy(&DuplicateSerializedKeys);
        assert_eq!(
            canonicalize(&DuplicateSerializedKeys)?,
            r#"{"1":"second","true":"bool"}"#
        );
        direct_matches_legacy(&FloatMapKey);
        assert_eq!(
            canonical_result_identity(canonical_bytes(&FloatMapKey)),
            expected_unsupported_number()
        );
        Ok(())
    }

    #[test]
    fn direct_serializer_preserves_number_error_equivalence() -> Result<(), Box<dyn Error>> {
        for source in [
            "-9007199254740992",
            "9007199254740992",
            "1.0",
            "1e0",
            "-0.0",
        ] {
            let value: Value = serde_json::from_str(source)?;
            direct_matches_legacy(&value);
        }

        for value in [-9_007_199_254_740_992_i64, 9_007_199_254_740_992_i64] {
            direct_matches_legacy(&value);
        }
        direct_matches_legacy(&i128::MAX);
        direct_matches_legacy(&u128::MAX);
        for value in [f64::NAN, f64::INFINITY, -0.0_f64] {
            direct_matches_legacy(&value);
        }
        Ok(())
    }

    #[test]
    fn direct_serializer_preserves_mixed_invalid_float_precedence() -> Result<(), Box<dyn Error>> {
        direct_matches_legacy(&(UNSAFE_INTEGER, 1.0_f64));
        direct_matches_legacy(&(1.0_f64, UNSAFE_INTEGER));
        direct_matches_legacy(&MixedInvalidEnum::UnsafeThenFloat(UNSAFE_INTEGER, f64::NAN));
        direct_matches_legacy(&MixedInvalidEnum::FloatThenUnsafe(
            f64::INFINITY,
            UNSAFE_INTEGER,
        ));
        direct_matches_legacy(&MixedInvalidEnum::StructUnsafeThenFloat {
            unsafe_integer: UNSAFE_INTEGER,
            float: 1.0,
        });
        direct_matches_legacy(&MixedInvalidEnum::StructFloatThenUnsafe {
            float: -0.0,
            unsafe_integer: UNSAFE_INTEGER,
        });
        direct_matches_legacy(&NestedUnsafeThenFloat {
            unsafe_integer: UNSAFE_INTEGER,
            nested: MixedInvalidEnum::FloatThenUnsafe(1.5, UNSAFE_INTEGER),
        });
        direct_matches_legacy(&NestedFloatThenUnsafe {
            nested: MixedInvalidEnum::UnsafeThenFloat(UNSAFE_INTEGER, 1.5),
            unsafe_integer: UNSAFE_INTEGER,
        });

        for source in [
            r#"{"a":9007199254740992,"z":1.0}"#,
            r#"{"a":1.0,"z":9007199254740992}"#,
            r#"{"outer":{"a":9007199254740992,"z":[null,1.0]}}"#,
            r#"{"outer":{"a":[1.0],"z":9007199254740992}}"#,
        ] {
            let value: Value = serde_json::from_str(source)?;
            direct_matches_legacy(&value);
        }
        Ok(())
    }

    #[test]
    fn direct_serializer_preserves_mixed_invalid_custom_error_precedence()
    -> Result<(), Box<dyn Error>> {
        direct_matches_legacy(&(UNSAFE_INTEGER, CustomSerializationError));
        direct_matches_legacy(&(CustomSerializationError, UNSAFE_INTEGER));
        direct_matches_legacy(&CustomErrorAfterUnsafe);
        direct_matches_legacy(&Some((UNSAFE_INTEGER, CustomErrorAfterUnsafe)));

        assert_eq!(
            canonical_bytes(&(UNSAFE_INTEGER, CustomSerializationError))
                .map_err(canonical_error_identity),
            Err((
                "Serialization",
                format!("JSON serialization failed: {CUSTOM_ERROR_MESSAGE}|{CUSTOM_ERROR_MESSAGE}"),
            ))
        );
        Ok(())
    }

    #[test]
    fn validation_prepass_preserves_wide_integer_error_precedence() {
        direct_matches_legacy(&(i128::MAX, 1.0_f64));
        direct_matches_legacy(&(1.0_f64, i128::MAX));
        direct_matches_legacy(&(u128::MAX, 1.0_f64));
        direct_matches_legacy(&(1.0_f64, u128::MAX));
        direct_matches_legacy(&(i128::MAX, CustomSerializationError));
        direct_matches_legacy(&(CustomSerializationError, i128::MAX));
        direct_matches_legacy(&(u128::MAX, CustomSerializationError));
        direct_matches_legacy(&(CustomSerializationError, u128::MAX));

        direct_matches_legacy(&WideMixedInvalidEnum::I128ThenNestedFloat(
            i128::MAX,
            Some(vec![1.0]),
        ));
        direct_matches_legacy(&WideMixedInvalidEnum::NestedFloatThenU128 {
            nested: vec![None, Some(f64::NAN)],
            wide: u128::MAX,
        });
        direct_matches_legacy(&WideMixedInvalidEnum::U128ThenNestedCustom(
            u128::MAX,
            Some(CustomSerializationError),
        ));
        direct_matches_legacy(&WideMixedInvalidEnum::NestedCustomThenI128 {
            nested: vec![CustomSerializationError],
            wide: i128::MAX,
        });

        direct_matches_legacy(&(i128::MAX, 0_u8));
        direct_matches_legacy(&(u128::MAX, 0_u8));
    }

    #[test]
    fn validation_prepass_preserves_structural_map_key_error_precedence() {
        for value in [
            InvalidStructuralMapCase::InvalidThenFloat,
            InvalidStructuralMapCase::FloatThenInvalid,
            InvalidStructuralMapCase::InvalidThenCustom,
            InvalidStructuralMapCase::CustomThenInvalid,
            InvalidStructuralMapCase::InvalidOnly,
            InvalidStructuralMapCase::InvalidThenI128,
            InvalidStructuralMapCase::I128ThenInvalid,
            InvalidStructuralMapCase::InvalidThenU128,
            InvalidStructuralMapCase::U128ThenInvalid,
        ] {
            direct_matches_legacy(&value);
        }

        direct_matches_legacy(&Some(vec![
            InvalidStructuralMapCase::InvalidThenFloat,
            InvalidStructuralMapCase::InvalidThenCustom,
        ]));
    }

    #[test]
    fn validation_prepass_traverses_compound_map_keys_before_later_values() {
        direct_matches_legacy(&CompoundMapKeyCase::FloatThenLaterValues);
        direct_matches_legacy(&CompoundMapKeyCase::CustomThenLaterValues);

        assert_eq!(
            canonical_result_identity(canonical_bytes(&CompoundMapKeyCase::FloatThenLaterValues,)),
            Err((
                "UnsupportedNumber",
                "canonical JSON does not permit floats, NaN, or infinity".to_owned(),
            ))
        );
        assert_eq!(
            canonical_result_identity(canonical_bytes(&CompoundMapKeyCase::CustomThenLaterValues,)),
            Err((
                "Serialization",
                format!("JSON serialization failed: {CUSTOM_ERROR_MESSAGE}|{CUSTOM_ERROR_MESSAGE}"),
            ))
        );
    }

    #[test]
    fn validation_prepass_preserves_stateful_double_invocation() {
        let direct_calls = Cell::new(0);
        let legacy_calls = Cell::new(0);
        let direct = canonical_result_identity(canonical_bytes(&StatefulDifferentBytes {
            calls: &direct_calls,
        }));
        let legacy = canonical_result_identity(legacy_canonical_bytes(&StatefulDifferentBytes {
            calls: &legacy_calls,
        }));
        assert_eq!(direct, legacy);
        assert_eq!(direct, Ok(br#""second invocation""#.to_vec()));
        assert_eq!(direct_calls.get(), 2);
        assert_eq!(legacy_calls.get(), 2);

        let direct_calls = Cell::new(0);
        let legacy_calls = Cell::new(0);
        let direct = canonical_result_identity(canonical_bytes(&StatefulSecondInvocationError {
            calls: &direct_calls,
        }));
        let legacy =
            canonical_result_identity(legacy_canonical_bytes(&StatefulSecondInvocationError {
                calls: &legacy_calls,
            }));
        assert_eq!(direct, legacy);
        assert_eq!(
            direct,
            Err((
                "Serialization",
                format!(
                    "JSON serialization failed: {STATEFUL_ERROR_MESSAGE}|{STATEFUL_ERROR_MESSAGE}"
                ),
            ))
        );
        assert_eq!(direct_calls.get(), 2);
        assert_eq!(legacy_calls.get(), 2);

        let direct_calls = Cell::new(0);
        let legacy_calls = Cell::new(0);
        let direct = canonical_result_identity(canonical_bytes(&StatefulFirstInvocationError {
            calls: &direct_calls,
        }));
        let legacy =
            canonical_result_identity(legacy_canonical_bytes(&StatefulFirstInvocationError {
                calls: &legacy_calls,
            }));
        assert_eq!(direct, legacy);
        assert_eq!(
            direct,
            Err((
                "Serialization",
                format!(
                    "JSON serialization failed: {STATEFUL_FIRST_ERROR_MESSAGE}|{STATEFUL_FIRST_ERROR_MESSAGE}"
                ),
            ))
        );
        assert_eq!(direct_calls.get(), 1);
        assert_eq!(legacy_calls.get(), 1);
    }

    #[test]
    fn stateful_second_pass_float_values_match_legacy() {
        for value in [
            StatefulFloatCase::FiniteF32,
            StatefulFloatCase::NanF32,
            StatefulFloatCase::PositiveInfinityF32,
            StatefulFloatCase::NegativeInfinityF32,
            StatefulFloatCase::FiniteF64,
            StatefulFloatCase::NanF64,
            StatefulFloatCase::PositiveInfinityF64,
            StatefulFloatCase::NegativeInfinityF64,
        ] {
            let direct_calls = Cell::new(0);
            let legacy_calls = Cell::new(0);
            let direct =
                canonical_result_identity(canonical_bytes(&StatefulSecondPassFloatValue {
                    calls: &direct_calls,
                    value,
                }));
            let legacy =
                canonical_result_identity(legacy_canonical_bytes(&StatefulSecondPassFloatValue {
                    calls: &legacy_calls,
                    value,
                }));

            assert_eq!(direct, legacy);
            if value.is_finite() {
                assert_eq!(
                    direct,
                    Err((
                        "UnsupportedNumber",
                        "canonical JSON does not permit floats, NaN, or infinity".to_owned(),
                    ))
                );
            } else {
                assert_eq!(direct, Ok(b"null".to_vec()));
            }
            assert_eq!(direct_calls.get(), 2);
            assert_eq!(legacy_calls.get(), 2);
        }
    }

    #[test]
    fn stateful_second_pass_float_map_keys_match_legacy() {
        for value in [
            StatefulFloatMapKeyValue::F32(1.5),
            StatefulFloatMapKeyValue::F32(f32::NAN),
            StatefulFloatMapKeyValue::F32(f32::INFINITY),
            StatefulFloatMapKeyValue::F32(f32::NEG_INFINITY),
            StatefulFloatMapKeyValue::F64(1.5),
            StatefulFloatMapKeyValue::F64(f64::NAN),
            StatefulFloatMapKeyValue::F64(f64::INFINITY),
            StatefulFloatMapKeyValue::F64(f64::NEG_INFINITY),
        ] {
            let direct_calls = Cell::new(0);
            let legacy_calls = Cell::new(0);
            let direct =
                canonical_result_identity(canonical_bytes(&StatefulSecondPassFloatMapKey {
                    calls: &direct_calls,
                    value,
                }));
            let legacy =
                canonical_result_identity(legacy_canonical_bytes(&StatefulSecondPassFloatMapKey {
                    calls: &legacy_calls,
                    value,
                }));

            assert_eq!(direct, legacy);
            if value.is_finite() {
                assert_eq!(direct, Ok(br#"{"1.5":"value"}"#.to_vec()));
            } else {
                assert_eq!(
                    direct,
                    Err((
                        "Serialization",
                        "JSON serialization failed: float key must be finite (got NaN or +/-inf)|float key must be finite (got NaN or +/-inf)"
                            .to_owned(),
                    ))
                );
            }
            assert_eq!(direct_calls.get(), 2);
            assert_eq!(legacy_calls.get(), 2);
        }
    }

    #[test]
    fn finite_float_map_keys_match_legacy_exact_json_spelling() {
        for (key, expected) in [
            (StatefulFloatMapKeyValue::F32(1.0), r#"{"1.0":"value"}"#),
            (StatefulFloatMapKeyValue::F32(-0.0), r#"{"-0.0":"value"}"#),
            (StatefulFloatMapKeyValue::F64(1.0), r#"{"1.0":"value"}"#),
            (StatefulFloatMapKeyValue::F64(-0.0), r#"{"-0.0":"value"}"#),
        ] {
            let direct_calls = Cell::new(0);
            let legacy_calls = Cell::new(0);
            let direct =
                canonical_result_identity(canonical_bytes(&StatefulSecondPassFloatMapKey {
                    calls: &direct_calls,
                    value: key,
                }));
            let legacy =
                canonical_result_identity(legacy_canonical_bytes(&StatefulSecondPassFloatMapKey {
                    calls: &legacy_calls,
                    value: key,
                }));

            assert_eq!(direct, legacy);
            assert_eq!(direct, Ok(expected.as_bytes().to_vec()));
            assert_eq!(direct_calls.get(), 2);
            assert_eq!(legacy_calls.get(), 2);
        }
    }

    #[test]
    fn finite_float_and_string_map_keys_keep_last_write_in_both_orders() {
        for key in [
            StatefulFloatMapKeyValue::F32(1.0),
            StatefulFloatMapKeyValue::F64(1.0),
        ] {
            stateful_float_map_matches_legacy(
                StatefulFloatMapCase::FloatThenString(key),
                Ok(br#"{"1.0":"string"}"#.to_vec()),
            );
            stateful_float_map_matches_legacy(
                StatefulFloatMapCase::StringThenFloat(key),
                Ok(br#"{"1.0":"float"}"#.to_vec()),
            );
        }
    }

    #[test]
    fn deferred_invalid_map_values_follow_duplicate_replacement() {
        for key in [
            StatefulFloatMapKeyValue::F32(1.0),
            StatefulFloatMapKeyValue::F64(1.0),
        ] {
            stateful_float_map_matches_legacy(
                StatefulFloatMapCase::FloatInvalidThenStringValid(key),
                Ok(br#"{"1.0":1}"#.to_vec()),
            );
            stateful_float_map_matches_legacy(
                StatefulFloatMapCase::StringValidThenFloatInvalid(key),
                expected_unsafe_integer(UNSAFE_INTEGER),
            );
        }
    }

    #[test]
    fn immediate_nonfinite_map_key_error_preempts_deferred_values() {
        for key in [
            StatefulFloatMapKeyValue::F32(f32::NAN),
            StatefulFloatMapKeyValue::F64(f64::INFINITY),
        ] {
            stateful_float_map_matches_legacy(
                StatefulFloatMapCase::NonfiniteAfterUnsafe(key),
                expected_serialization("float key must be finite (got NaN or +/-inf)"),
            );
        }
    }

    #[test]
    fn stateful_second_pass_custom_errors_preempt_deferred_float() {
        stateful_ordering_matches_legacy(
            StatefulOrderingCase::FloatThenCustom,
            expected_serialization(CUSTOM_ERROR_MESSAGE),
        );
        stateful_ordering_matches_legacy(
            StatefulOrderingCase::CustomThenFloat,
            expected_serialization(CUSTOM_ERROR_MESSAGE),
        );
    }

    #[test]
    fn stateful_second_pass_wide_conversion_errors_preempt_deferred_float() {
        for case in [
            StatefulOrderingCase::FloatThenI128,
            StatefulOrderingCase::I128ThenFloat,
            StatefulOrderingCase::FloatThenU128,
            StatefulOrderingCase::U128ThenFloat,
        ] {
            stateful_ordering_matches_legacy(case, expected_serialization("number out of range"));
        }
    }

    #[test]
    fn stateful_second_pass_sequences_choose_first_numeric_error() {
        stateful_ordering_matches_legacy(
            StatefulOrderingCase::FloatThenUnsafe,
            expected_unsupported_number(),
        );
        stateful_ordering_matches_legacy(
            StatefulOrderingCase::UnsafeThenFloat,
            expected_unsafe_integer(UNSAFE_INTEGER),
        );
    }

    #[test]
    fn stateful_second_pass_duplicate_keys_keep_last_numeric_error() {
        stateful_ordering_matches_legacy(
            StatefulOrderingCase::FloatOverwrittenByValid,
            Ok(br#"{"same":1}"#.to_vec()),
        );
        stateful_ordering_matches_legacy(
            StatefulOrderingCase::ValidOverwrittenByFloat,
            expected_unsupported_number(),
        );
    }

    #[test]
    fn stateful_second_pass_nested_utf16_order_chooses_first_numeric_error() {
        stateful_ordering_matches_legacy(
            StatefulOrderingCase::NestedFloatBeforeUnsafe,
            expected_unsupported_number(),
        );
        stateful_ordering_matches_legacy(
            StatefulOrderingCase::NestedUnsafeBeforeFloat,
            expected_unsafe_integer(UNSAFE_INTEGER),
        );
    }

    #[test]
    fn deferred_unsafe_errors_follow_materialized_object_order_and_duplicates()
    -> Result<(), Box<dyn Error>> {
        direct_matches_legacy(&OverwrittenUnsafeInteger);
        assert_eq!(canonicalize(&OverwrittenUnsafeInteger)?, r#"{"same":1}"#);

        let value: Value = serde_json::from_str(r#"{"z":9007199254740992,"a":9007199254740993}"#)?;
        direct_matches_legacy(&value);
        assert!(matches!(
            canonical_bytes(&value),
            Err(CanonicalError::UnsafeInteger {
                value: 9_007_199_254_740_993
            })
        ));
        Ok(())
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
