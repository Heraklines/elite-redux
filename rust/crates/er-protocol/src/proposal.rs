//! Proposal admission identity and retained resend leases.

use std::collections::{BTreeMap, BTreeSet};

use er_types::{
    ConnectionGeneration, OperationId, ProposalMessage, SafeI53, SafeU53, SeatId, TimeClass,
    TimerId, TimerOwner,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::scheduler::{ScheduledTimer, TimerSpec};
use crate::{KernelScheduler, SchedulerCommand, SchedulerError};

pub const DEFAULT_PROPOSAL_CAPACITY: u64 = 8_192;
pub const DEFAULT_PROPOSAL_RETRY_INITIAL_MS: u64 = 250;
pub const DEFAULT_PROPOSAL_RETRY_MAX_MS: u64 = 5_000;
pub const DEFAULT_PROPOSAL_ABSOLUTE_CEILING_MS: u64 = 1_200_000;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProposalJson(String);

impl ProposalJson {
    pub fn new(value: impl Into<String>) -> Result<Self, ProposalFingerprintError> {
        let value = value.into();
        JsonParser::parse(&value)
            .map_err(|reason| ProposalFingerprintError::InvalidJson { reason })?;
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProposalFingerprintInput {
    Ordinary {
        sequence: SafeU53,
        label: String,
        choice: SafeI53,
        wire: Option<ProposalJson>,
        reward_surface: Option<ProposalJson>,
    },
    Bargain {
        sequence: SafeU53,
        outcome: ProposalJson,
    },
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ProposalFingerprintError {
    #[error("proposal kind must not be empty")]
    EmptyKind,
    #[error("proposal JSON is invalid: {reason}")]
    InvalidJson { reason: String },
    #[error("proposal sequence offset exceeds SafeU53")]
    SequenceOverflow,
}

pub fn proposal_fingerprint(
    input: &ProposalFingerprintInput,
) -> Result<String, ProposalFingerprintError> {
    match input {
        ProposalFingerprintInput::Ordinary {
            sequence,
            label,
            choice,
            wire,
            reward_surface,
        } => fingerprint_reward(
            *sequence,
            label,
            *choice,
            wire.as_ref(),
            reward_surface.as_ref(),
        ),
        ProposalFingerprintInput::Bargain { sequence, outcome } => {
            fingerprint_bargain(*sequence, outcome)
        }
    }
}

pub fn fingerprint_reward(
    sequence: SafeU53,
    label: &str,
    choice: SafeI53,
    wire: Option<&ProposalJson>,
    reward_surface: Option<&ProposalJson>,
) -> Result<String, ProposalFingerprintError> {
    let wire = wire.map(stringify_proposal_json).transpose()?;
    let reward_surface = reward_surface.map(stringify_proposal_json).transpose()?;
    let mut fingerprint = String::from("[");
    fingerprint.push_str(&sequence.get().to_string());
    fingerprint.push(',');
    JsString::from_str(label).write_json(&mut fingerprint);
    fingerprint.push(',');
    fingerprint.push_str(&choice.get().to_string());
    fingerprint.push(',');
    match wire.as_deref() {
        Some(wire) => fingerprint.push_str(wire),
        None => fingerprint.push_str("null"),
    }
    fingerprint.push(',');
    match reward_surface.as_deref() {
        Some(reward_surface) => fingerprint.push_str(reward_surface),
        None => fingerprint.push_str("null"),
    }
    fingerprint.push(']');
    Ok(fingerprint)
}

pub fn fingerprint_biome_shop_leave(
    pinned_sequence: SafeU53,
) -> Result<String, ProposalFingerprintError> {
    let sequence = offset_sequence(pinned_sequence, 7_000_000)?;
    let choice = match SafeI53::new(-1) {
        Ok(choice) => choice,
        Err(error) => {
            return Err(ProposalFingerprintError::InvalidJson {
                reason: error.to_string(),
            });
        }
    };
    fingerprint_reward(sequence, "biomeShop", choice, None, None)
}

pub fn fingerprint_biome_shop_buy(
    pinned_sequence: SafeU53,
    bought_slot: SafeI53,
    proposal_data: [SafeI53; 4],
) -> Result<String, ProposalFingerprintError> {
    let sequence = offset_sequence(pinned_sequence, 7_000_000)?;
    let mut proposal_data_json = String::from("[");
    for (index, value) in proposal_data.iter().enumerate() {
        if index != 0 {
            proposal_data_json.push(',');
        }
        proposal_data_json.push_str(&value.get().to_string());
    }
    proposal_data_json.push(']');
    let proposal_data_json = ProposalJson::new(proposal_data_json)?;
    fingerprint_reward(
        sequence,
        "biomeShop",
        bought_slot,
        Some(&proposal_data_json),
        None,
    )
}

pub fn fingerprint_bargain(
    sequence: SafeU53,
    outcome: &ProposalJson,
) -> Result<String, ProposalFingerprintError> {
    let sequence = offset_sequence(sequence, 7_500_000)?;
    let outcome = stringify_proposal_json(outcome)?;
    let mut fingerprint = String::from("[");
    fingerprint.push_str(&sequence.get().to_string());
    fingerprint.push_str(",\"bargain\",");
    fingerprint.push_str(&outcome);
    fingerprint.push(']');
    Ok(fingerprint)
}

fn offset_sequence(sequence: SafeU53, offset: u64) -> Result<SafeU53, ProposalFingerprintError> {
    let Some(value) = sequence.get().checked_add(offset) else {
        return Err(ProposalFingerprintError::SequenceOverflow);
    };
    match SafeU53::new(value) {
        Ok(sequence) => Ok(sequence),
        Err(_) => Err(ProposalFingerprintError::SequenceOverflow),
    }
}

fn stringify_proposal_json(value: &ProposalJson) -> Result<String, ProposalFingerprintError> {
    let parsed = JsonParser::parse(value.as_str())
        .map_err(|reason| ProposalFingerprintError::InvalidJson { reason })?;
    let mut output = String::new();
    parsed.write_json(&mut output);
    Ok(output)
}

#[derive(Clone, Debug)]
enum OrderedJson {
    Null,
    Bool(bool),
    Number(String),
    String(JsString),
    Array(Vec<Self>),
    Object(Vec<(JsString, Self)>),
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct JsString(Vec<u16>);

impl JsString {
    fn from_str(value: &str) -> Self {
        Self(value.encode_utf16().collect())
    }

    fn write_json(&self, output: &mut String) {
        output.push('"');
        let mut index = 0;
        while index < self.0.len() {
            let unit = self.0[index];
            match unit {
                0x08 => output.push_str("\\b"),
                0x09 => output.push_str("\\t"),
                0x0a => output.push_str("\\n"),
                0x0c => output.push_str("\\f"),
                0x0d => output.push_str("\\r"),
                0x00..=0x1f => push_unicode_escape(output, unit),
                0x22 => output.push_str("\\\""),
                0x5c => output.push_str("\\\\"),
                0xd800..=0xdbff => {
                    let Some(&next) = self.0.get(index + 1) else {
                        push_unicode_escape(output, unit);
                        index += 1;
                        continue;
                    };
                    if (0xdc00..=0xdfff).contains(&next) {
                        let code_point =
                            0x1_0000 + (((unit as u32) - 0xd800) << 10) + ((next as u32) - 0xdc00);
                        if let Some(character) = char::from_u32(code_point) {
                            output.push(character);
                            index += 2;
                            continue;
                        }
                    }
                    push_unicode_escape(output, unit);
                }
                0xdc00..=0xdfff => push_unicode_escape(output, unit),
                _ => {
                    if let Some(character) = char::from_u32(unit as u32) {
                        output.push(character);
                    } else {
                        push_unicode_escape(output, unit);
                    }
                }
            }
            index += 1;
        }
        output.push('"');
    }

    fn array_index(&self) -> Option<u32> {
        if self.0.is_empty() || (self.0.len() > 1 && self.0[0] == b'0' as u16) {
            return None;
        }
        let mut value = 0_u64;
        for unit in &self.0 {
            if !(b'0' as u16..=b'9' as u16).contains(unit) {
                return None;
            }
            value = value
                .checked_mul(10)?
                .checked_add((*unit - b'0' as u16) as u64)?;
        }
        if value <= 4_294_967_294 {
            Some(value as u32)
        } else {
            None
        }
    }
}

fn push_unicode_escape(output: &mut String, value: u16) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    output.push_str("\\u");
    output.push(HEX[((value >> 12) & 0x0f) as usize] as char);
    output.push(HEX[((value >> 8) & 0x0f) as usize] as char);
    output.push(HEX[((value >> 4) & 0x0f) as usize] as char);
    output.push(HEX[(value & 0x0f) as usize] as char);
}

impl OrderedJson {
    fn write_json(&self, output: &mut String) {
        match self {
            Self::Null => output.push_str("null"),
            Self::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
            Self::Number(value) => output.push_str(&normalize_json_number(value)),
            Self::String(value) => value.write_json(output),
            Self::Array(values) => {
                output.push('[');
                for (index, value) in values.iter().enumerate() {
                    if index != 0 {
                        output.push(',');
                    }
                    value.write_json(output);
                }
                output.push(']');
            }
            Self::Object(values) => {
                output.push('{');
                let ordered_indices = ordered_object_indices(values);
                for (index, entry_index) in ordered_indices.iter().enumerate() {
                    if index != 0 {
                        output.push(',');
                    }
                    values[*entry_index].0.write_json(output);
                    output.push(':');
                    values[*entry_index].1.write_json(output);
                }
                output.push('}');
            }
        }
    }
}

fn ordered_object_indices(values: &[(JsString, OrderedJson)]) -> Vec<usize> {
    let mut unique: Vec<usize> = Vec::new();
    for index in 0..values.len() {
        if let Some(existing) = unique
            .iter()
            .position(|candidate| values[*candidate].0 == values[index].0)
        {
            unique[existing] = index;
        } else {
            unique.push(index);
        }
    }

    let mut indexed = Vec::new();
    let mut non_indexed = Vec::new();
    for index in unique {
        if let Some(key) = values[index].0.array_index() {
            indexed.push((key, index));
        } else {
            non_indexed.push(index);
        }
    }
    indexed.sort_by_key(|(key, _)| *key);
    let mut ordered = Vec::with_capacity(indexed.len() + non_indexed.len());
    ordered.extend(indexed.into_iter().map(|(_, index)| index));
    ordered.extend(non_indexed);
    ordered
}

fn normalize_json_number(value: &str) -> String {
    let Ok(number) = value.parse::<f64>() else {
        // The parser has already proved that this is a JSON number. A native
        // Number conversion can therefore only fail here because the value is
        // outside the finite IEEE-754 range; JSON.stringify renders that
        // resulting non-finite value as null.
        return "null".to_owned();
    };
    if !number.is_finite() {
        return "null".to_owned();
    }
    if number == 0.0 {
        return "0".to_owned();
    }
    normalize_rendered_number(&number.to_string())
}

fn normalize_rendered_number(rendered: &str) -> String {
    let (negative, unsigned) = match rendered.strip_prefix('-') {
        Some(value) => (true, value),
        None => (false, rendered),
    };
    let (coefficient, exponent) = match unsigned.find(['e', 'E']) {
        Some(position) => {
            let Ok(exponent) = unsigned[position + 1..].parse::<i32>() else {
                return rendered.to_owned();
            };
            (&unsigned[..position], exponent)
        }
        None => (unsigned, 0),
    };
    let decimal_position_in_coefficient = coefficient.find('.');
    let digits_before_decimal = (match decimal_position_in_coefficient {
        Some(position) => position,
        None => coefficient.len(),
    }) as i32;
    let fraction_present = decimal_position_in_coefficient.is_some();
    let mut digits = coefficient.replace('.', "");
    if fraction_present {
        while digits.len() > 1 && digits.ends_with('0') {
            digits.pop();
        }
    }
    let leading_zeroes = digits.bytes().take_while(|byte| *byte == b'0').count();
    if leading_zeroes == digits.len() {
        return "0".to_owned();
    }
    digits = digits[leading_zeroes..].to_owned();
    while digits.len() > 1 && digits.ends_with('0') {
        digits.pop();
    }
    let decimal_position = digits_before_decimal + exponent - leading_zeroes as i32;
    let scientific_exponent = decimal_position - 1;
    let use_plain = (-6..=20).contains(&scientific_exponent);
    let mut output = String::new();
    if negative {
        output.push('-');
    }
    if use_plain {
        if decimal_position <= 0 {
            output.push_str("0.");
            for _ in 0..(-decimal_position) {
                output.push('0');
            }
            output.push_str(&digits);
        } else if decimal_position as usize >= digits.len() {
            output.push_str(&digits);
            for _ in 0..(decimal_position as usize - digits.len()) {
                output.push('0');
            }
        } else {
            let split = decimal_position as usize;
            output.push_str(&digits[..split]);
            output.push('.');
            output.push_str(&digits[split..]);
        }
    } else {
        output.push(digits.as_bytes()[0] as char);
        if digits.len() > 1 {
            output.push('.');
            output.push_str(&digits[1..]);
        }
        output.push('e');
        if scientific_exponent >= 0 {
            output.push('+');
            output.push_str(&scientific_exponent.to_string());
        } else {
            output.push_str(&scientific_exponent.to_string());
        }
    }
    output
}

struct JsonParser<'a> {
    bytes: &'a [u8],
    index: usize,
}

impl<'a> JsonParser<'a> {
    fn parse(source: &'a str) -> Result<OrderedJson, String> {
        let mut parser = Self {
            bytes: source.as_bytes(),
            index: 0,
        };
        parser.skip_whitespace();
        let value = parser.parse_value()?;
        parser.skip_whitespace();
        if parser.index == parser.bytes.len() {
            Ok(value)
        } else {
            Err("trailing characters after JSON value".to_owned())
        }
    }

    fn parse_value(&mut self) -> Result<OrderedJson, String> {
        match self.bytes.get(self.index).copied() {
            Some(b'n') => {
                self.parse_literal(b"null")?;
                Ok(OrderedJson::Null)
            }
            Some(b't') => {
                self.parse_literal(b"true")?;
                Ok(OrderedJson::Bool(true))
            }
            Some(b'f') => {
                self.parse_literal(b"false")?;
                Ok(OrderedJson::Bool(false))
            }
            Some(b'"') => Ok(OrderedJson::String(self.parse_string()?)),
            Some(b'[') => self.parse_array(),
            Some(b'{') => self.parse_object(),
            Some(b'-' | b'0'..=b'9') => Ok(OrderedJson::Number(self.parse_number()?)),
            Some(_) => Err(format!("unexpected JSON byte at {}", self.index)),
            None => Err("JSON value is empty".to_owned()),
        }
    }

    fn parse_literal(&mut self, literal: &[u8]) -> Result<(), String> {
        let end = self.index.saturating_add(literal.len());
        if self.bytes.get(self.index..end) == Some(literal) {
            self.index = end;
            Ok(())
        } else {
            Err(format!("invalid JSON literal at {}", self.index))
        }
    }

    fn parse_array(&mut self) -> Result<OrderedJson, String> {
        self.index += 1;
        self.skip_whitespace();
        let mut values = Vec::new();
        if self.consume(b']') {
            return Ok(OrderedJson::Array(values));
        }
        loop {
            values.push(self.parse_value()?);
            self.skip_whitespace();
            if self.consume(b']') {
                return Ok(OrderedJson::Array(values));
            }
            if !self.consume(b',') {
                return Err(format!("expected array separator at {}", self.index));
            }
            self.skip_whitespace();
        }
    }

    fn parse_object(&mut self) -> Result<OrderedJson, String> {
        self.index += 1;
        self.skip_whitespace();
        let mut values = Vec::new();
        if self.consume(b'}') {
            return Ok(OrderedJson::Object(values));
        }
        loop {
            if self.bytes.get(self.index) != Some(&b'"') {
                return Err(format!("expected object key at {}", self.index));
            }
            let key = self.parse_string()?;
            self.skip_whitespace();
            if !self.consume(b':') {
                return Err(format!("expected object colon at {}", self.index));
            }
            self.skip_whitespace();
            values.push((key, self.parse_value()?));
            self.skip_whitespace();
            if self.consume(b'}') {
                return Ok(OrderedJson::Object(values));
            }
            if !self.consume(b',') {
                return Err(format!("expected object separator at {}", self.index));
            }
            self.skip_whitespace();
        }
    }

    fn parse_string(&mut self) -> Result<JsString, String> {
        if !self.consume(b'"') {
            return Err(format!("expected string at {}", self.index));
        }
        let mut units = Vec::new();
        loop {
            let Some(byte) = self.bytes.get(self.index).copied() else {
                return Err("unterminated JSON string".to_owned());
            };
            match byte {
                b'"' => {
                    self.index += 1;
                    return Ok(JsString(units));
                }
                b'\\' => {
                    self.index += 1;
                    self.parse_escape(&mut units)?;
                }
                0x00..=0x1f => {
                    return Err(format!("unescaped control character at {}", self.index));
                }
                _ => {
                    let Some(remainder) = self.bytes.get(self.index..) else {
                        return Err("invalid UTF-8 string tail".to_owned());
                    };
                    let remainder = std::str::from_utf8(remainder)
                        .map_err(|_| "invalid UTF-8 in JSON string".to_owned())?;
                    let Some(character) = remainder.chars().next() else {
                        return Err("invalid UTF-8 string character".to_owned());
                    };
                    let mut encoded = [0_u16; 2];
                    units.extend_from_slice(character.encode_utf16(&mut encoded));
                    self.index += character.len_utf8();
                }
            }
        }
    }

    fn parse_escape(&mut self, units: &mut Vec<u16>) -> Result<(), String> {
        let Some(escape) = self.bytes.get(self.index).copied() else {
            return Err("unterminated JSON escape".to_owned());
        };
        self.index += 1;
        match escape {
            b'"' | b'\\' | b'/' => units.push(escape as u16),
            b'b' => units.push(0x08),
            b'f' => units.push(0x0c),
            b'n' => units.push(0x0a),
            b'r' => units.push(0x0d),
            b't' => units.push(0x09),
            b'u' => {
                let high = self.parse_hex_u16()?;
                if (0xd800..=0xdbff).contains(&high)
                    && self.bytes.get(self.index) == Some(&b'\\')
                    && self.bytes.get(self.index + 1) == Some(&b'u')
                {
                    let second_escape = self.index;
                    self.index += 2;
                    match self.parse_hex_u16() {
                        Ok(low) if (0xdc00..=0xdfff).contains(&low) => {
                            let code_point = 0x1_0000
                                + (((high as u32) - 0xd800) << 10)
                                + ((low as u32) - 0xdc00);
                            if let Some(character) = char::from_u32(code_point) {
                                let mut encoded = [0_u16; 2];
                                units.extend_from_slice(character.encode_utf16(&mut encoded));
                            } else {
                                units.push(high);
                                units.push(low);
                            }
                        }
                        Ok(_) => {
                            self.index = second_escape;
                            units.push(high);
                        }
                        Err(_) => {
                            self.index = second_escape;
                            units.push(high);
                        }
                    }
                } else {
                    units.push(high);
                }
            }
            _ => return Err(format!("invalid JSON escape at {}", self.index - 1)),
        }
        Ok(())
    }

    fn parse_hex_u16(&mut self) -> Result<u16, String> {
        let mut value = 0_u16;
        for _ in 0..4 {
            let Some(byte) = self.bytes.get(self.index).copied() else {
                return Err("short JSON unicode escape".to_owned());
            };
            let Some(digit) = hex_digit(byte) else {
                return Err(format!("invalid JSON unicode escape at {}", self.index));
            };
            value = (value << 4) | digit as u16;
            self.index += 1;
        }
        Ok(value)
    }

    fn parse_number(&mut self) -> Result<String, String> {
        let start = self.index;
        self.consume(b'-');
        match self.bytes.get(self.index).copied() {
            Some(b'0') => {
                self.index += 1;
                if self
                    .bytes
                    .get(self.index)
                    .is_some_and(|byte| byte.is_ascii_digit())
                {
                    return Err(format!("leading zero in JSON number at {}", self.index));
                }
            }
            Some(b'1'..=b'9') => {
                self.index += 1;
                while self
                    .bytes
                    .get(self.index)
                    .is_some_and(|byte| byte.is_ascii_digit())
                {
                    self.index += 1;
                }
            }
            _ => return Err(format!("invalid JSON number at {}", start)),
        }
        if self.consume(b'.') {
            let fraction_start = self.index;
            while self
                .bytes
                .get(self.index)
                .is_some_and(|byte| byte.is_ascii_digit())
            {
                self.index += 1;
            }
            if self.index == fraction_start {
                return Err(format!("JSON number fraction is empty at {}", self.index));
            }
        }
        if self
            .bytes
            .get(self.index)
            .is_some_and(|byte| *byte == b'e' || *byte == b'E')
        {
            self.index += 1;
            if self
                .bytes
                .get(self.index)
                .is_some_and(|byte| *byte == b'+' || *byte == b'-')
            {
                self.index += 1;
            }
            let exponent_start = self.index;
            while self
                .bytes
                .get(self.index)
                .is_some_and(|byte| byte.is_ascii_digit())
            {
                self.index += 1;
            }
            if self.index == exponent_start {
                return Err(format!("JSON number exponent is empty at {}", self.index));
            }
        }
        let Some(number) = self.bytes.get(start..self.index) else {
            return Err("invalid JSON number range".to_owned());
        };
        String::from_utf8(number.to_vec()).map_err(|_| "invalid UTF-8 in JSON number".to_owned())
    }

    fn skip_whitespace(&mut self) {
        while self
            .bytes
            .get(self.index)
            .is_some_and(|byte| matches!(byte, b' ' | b'\n' | b'\r' | b'\t'))
        {
            self.index += 1;
        }
    }

    fn consume(&mut self, expected: u8) -> bool {
        if self.bytes.get(self.index) == Some(&expected) {
            self.index += 1;
            true
        } else {
            false
        }
    }
}

fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalIdentity {
    pub operation_id: OperationId,
    pub fingerprint: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProposalAdmission {
    Admitted,
    Duplicate,
    Conflict,
    Invalid,
    CapacityExhausted,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalAdmissionDiagnostics {
    pub capacity: SafeU53,
    pub fingerprints: BTreeMap<OperationId, String>,
    pub disposed: bool,
}

#[derive(Clone, Debug)]
pub struct ProposalAdmissionLedger {
    capacity: SafeU53,
    fingerprints: BTreeMap<OperationId, String>,
    disposed: bool,
}

impl ProposalAdmissionLedger {
    pub fn new(capacity: SafeU53) -> Result<Self, ProposalAdmissionError> {
        if capacity == SafeU53::ZERO {
            return Err(ProposalAdmissionError::InvalidCapacity);
        }
        Ok(Self {
            capacity,
            fingerprints: BTreeMap::new(),
            disposed: false,
        })
    }

    pub fn admit(&mut self, proposal: &ProposalIdentity) -> ProposalAdmission {
        if self.disposed || proposal.fingerprint.is_empty() {
            return ProposalAdmission::Invalid;
        }
        if let Some(existing) = self.fingerprints.get(&proposal.operation_id) {
            return if existing == &proposal.fingerprint {
                ProposalAdmission::Duplicate
            } else {
                ProposalAdmission::Conflict
            };
        }
        if self.fingerprints.len() as u64 >= self.capacity.get() {
            return ProposalAdmission::CapacityExhausted;
        }
        let _ = self
            .fingerprints
            .insert(proposal.operation_id.clone(), proposal.fingerprint.clone());
        ProposalAdmission::Admitted
    }

    pub fn fingerprint(&self, operation_id: &OperationId) -> Option<&str> {
        self.fingerprints.get(operation_id).map(String::as_str)
    }

    pub fn reset(&mut self) {
        if !self.disposed {
            self.fingerprints.clear();
        }
    }

    pub fn len(&self) -> SafeU53 {
        safe_count(self.fingerprints.len())
    }

    pub fn is_empty(&self) -> bool {
        self.fingerprints.is_empty()
    }

    pub fn diagnostics(&self) -> ProposalAdmissionDiagnostics {
        ProposalAdmissionDiagnostics {
            capacity: self.capacity,
            fingerprints: self.fingerprints.clone(),
            disposed: self.disposed,
        }
    }

    pub fn dispose(&mut self) {
        if self.disposed {
            return;
        }
        self.disposed = true;
        self.fingerprints.clear();
    }
}

fn safe_count(value: usize) -> SafeU53 {
    match SafeU53::new(value as u64) {
        Ok(value) => value,
        Err(_) => SafeU53::MAX,
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ProposalAdmissionError {
    #[error("proposal admission capacity must be positive")]
    InvalidCapacity,
}

/// The lease retains the exact opaque transport proposal; it does not define a
/// second proposal envelope or an Authority V2 frame type.
pub type RetainedProposal = ProposalMessage;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalLeaseConfig {
    pub owner_prefix: String,
    pub retry_initial_ms: SafeU53,
    pub retry_maximum_ms: SafeU53,
    pub absolute_ceiling_ms: SafeU53,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalLeaseSpec {
    pub proposal: RetainedProposal,
    pub absolute_ceiling_ms: Option<SafeU53>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProposalLeaseAction {
    Send {
        proposal: RetainedProposal,
    },
    Scheduler {
        command: SchedulerCommand,
    },
    Terminalize {
        operation_id: OperationId,
        reason: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProposalLeaseStart {
    Retained,
    AlreadyRetained,
    AlreadyCommitted,
    Conflict,
    Invalid,
    Disposed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalLeaseOutcome {
    pub result: ProposalLeaseStart,
    pub actions: Vec<ProposalLeaseAction>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalLeaseDiagnostics {
    pub live_operation_ids: BTreeSet<OperationId>,
    pub committed_tombstones: BTreeSet<OperationId>,
    pub timer_ids: BTreeSet<TimerId>,
    pub disposed: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ProposalLeaseError {
    #[error("proposal lease manager is disposed")]
    Disposed,
    #[error("proposal operation identity conflicts with a retained lease")]
    Conflict,
    #[error("proposal timer {timer_id} is unknown")]
    UnknownTimer { timer_id: TimerId },
    #[error("proposal lease is invalid: {reason}")]
    InvalidProposal { reason: String },
    #[error(transparent)]
    Scheduler(#[from] SchedulerError),
}

#[derive(Clone, Debug)]
struct ActiveProposalLease {
    proposal: RetainedProposal,
    retry_attempt: u32,
    retry_timer: Option<TimerId>,
    absolute_timer: Option<TimerId>,
    timer_endpoint: SeatId,
    absolute_delay_ms: SafeU53,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProposalTimerKind {
    Retry,
    Absolute,
}

#[derive(Clone, Debug)]
struct ProposalTimerTarget {
    operation_id: OperationId,
    kind: ProposalTimerKind,
    endpoint: SeatId,
    owner: TimerOwner,
    delay_ms: SafeU53,
    time_class: TimeClass,
}

#[derive(Clone, Debug)]
pub struct ProposalLeaseManager {
    config: ProposalLeaseConfig,
    leases: BTreeMap<OperationId, ActiveProposalLease>,
    committed_tombstones: BTreeSet<OperationId>,
    timer_targets: BTreeMap<TimerId, ProposalTimerTarget>,
    disposed: bool,
}

impl ProposalLeaseManager {
    pub fn new(config: ProposalLeaseConfig) -> Result<Self, ProposalLeaseError> {
        if config.owner_prefix.is_empty()
            || config.owner_prefix.encode_utf16().count() > 256
            || config
                .owner_prefix
                .chars()
                .any(|character| character <= '\u{001f}' || character == '\u{007f}')
        {
            return Err(ProposalLeaseError::InvalidProposal {
                reason: "proposal lease owner prefix is invalid".to_owned(),
            });
        }
        if config.retry_initial_ms == SafeU53::ZERO
            || config.retry_maximum_ms == SafeU53::ZERO
            || config.retry_initial_ms.get() > config.retry_maximum_ms.get()
            || config.absolute_ceiling_ms == SafeU53::ZERO
        {
            return Err(ProposalLeaseError::InvalidProposal {
                reason: "proposal lease timing configuration is invalid".to_owned(),
            });
        }
        Ok(Self {
            config,
            leases: BTreeMap::new(),
            committed_tombstones: BTreeSet::new(),
            timer_targets: BTreeMap::new(),
            disposed: false,
        })
    }

    pub fn arm(
        &mut self,
        spec: ProposalLeaseSpec,
        scheduler: &mut KernelScheduler,
    ) -> Result<ProposalLeaseOutcome, ProposalLeaseError> {
        if self.disposed {
            return Ok(ProposalLeaseOutcome {
                result: ProposalLeaseStart::Disposed,
                actions: Vec::new(),
            });
        }
        if let Err(_reason) = Self::validate_spec(&spec) {
            return Ok(ProposalLeaseOutcome {
                result: ProposalLeaseStart::Invalid,
                actions: Vec::new(),
            });
        }

        let absolute_delay = spec
            .absolute_ceiling_ms
            .unwrap_or(self.config.absolute_ceiling_ms);
        let proposal = spec.proposal;
        let operation_id = proposal.operation_id.clone();

        if self.committed_tombstones.contains(&operation_id) {
            return Ok(ProposalLeaseOutcome {
                result: ProposalLeaseStart::AlreadyCommitted,
                actions: Vec::new(),
            });
        }
        if let Some(existing) = self.leases.get_mut(&operation_id) {
            if existing.proposal.fingerprint != proposal.fingerprint {
                return Ok(ProposalLeaseOutcome {
                    result: ProposalLeaseStart::Conflict,
                    actions: Vec::new(),
                });
            }
            if proposal.connection_generation < existing.proposal.connection_generation {
                return Ok(ProposalLeaseOutcome {
                    result: ProposalLeaseStart::Invalid,
                    actions: Vec::new(),
                });
            }
            if proposal.from != existing.proposal.from {
                return Ok(ProposalLeaseOutcome {
                    result: ProposalLeaseStart::Invalid,
                    actions: Vec::new(),
                });
            }
            existing.proposal = proposal;
            return Ok(ProposalLeaseOutcome {
                result: ProposalLeaseStart::AlreadyRetained,
                actions: vec![ProposalLeaseAction::Send {
                    proposal: existing.proposal.clone(),
                }],
            });
        }

        let timer_endpoint = proposal.from;
        let retry_delay = self.retry_delay(0);
        let absolute_owner = self.timer_owner(&proposal, "v2 proposal absolute ceiling")?;
        let retry_owner = self.timer_owner(&proposal, "v2 proposal retry")?;
        let specs = vec![
            TimerSpec {
                endpoint: timer_endpoint,
                owner: absolute_owner.clone(),
                delay_ms: absolute_delay,
                time_class: TimeClass::Absolute,
            },
            TimerSpec {
                endpoint: timer_endpoint,
                owner: retry_owner.clone(),
                delay_ms: retry_delay,
                time_class: TimeClass::Connected,
            },
        ];
        let commands = scheduler.schedule_batch(specs)?;
        let (absolute_timer, retry_timer) = match commands.as_slice() {
            [
                SchedulerCommand::Schedule {
                    timer: absolute_timer,
                },
                SchedulerCommand::Schedule { timer: retry_timer },
            ] => (absolute_timer.clone(), retry_timer.clone()),
            _ => {
                rollback_scheduled_commands(scheduler, &commands);
                return Err(invalid_registration(
                    "scheduler returned a non-schedule proposal registration",
                ));
            }
        };
        if absolute_timer.timer_id == retry_timer.timer_id
            || self.timer_targets.contains_key(&absolute_timer.timer_id)
            || self.timer_targets.contains_key(&retry_timer.timer_id)
            || !timer_matches(
                &absolute_timer,
                timer_endpoint,
                &absolute_owner,
                absolute_delay,
                TimeClass::Absolute,
            )
            || !timer_matches(
                &retry_timer,
                timer_endpoint,
                &retry_owner,
                retry_delay,
                TimeClass::Connected,
            )
        {
            rollback_scheduled_commands(scheduler, &commands);
            return Err(invalid_registration(
                "scheduler returned proposal timer metadata that does not match the request",
            ));
        }

        let _ = self.timer_targets.insert(
            absolute_timer.timer_id,
            ProposalTimerTarget {
                operation_id: operation_id.clone(),
                kind: ProposalTimerKind::Absolute,
                endpoint: timer_endpoint,
                owner: absolute_owner,
                delay_ms: absolute_delay,
                time_class: TimeClass::Absolute,
            },
        );
        let _ = self.timer_targets.insert(
            retry_timer.timer_id,
            ProposalTimerTarget {
                operation_id: operation_id.clone(),
                kind: ProposalTimerKind::Retry,
                endpoint: timer_endpoint,
                owner: retry_owner,
                delay_ms: retry_delay,
                time_class: TimeClass::Connected,
            },
        );
        let _ = self.leases.insert(
            operation_id,
            ActiveProposalLease {
                proposal: proposal.clone(),
                retry_attempt: 0,
                retry_timer: Some(retry_timer.timer_id),
                absolute_timer: Some(absolute_timer.timer_id),
                timer_endpoint,
                absolute_delay_ms: absolute_delay,
            },
        );

        let mut actions = commands
            .into_iter()
            .map(|command| ProposalLeaseAction::Scheduler { command })
            .collect::<Vec<_>>();
        actions.push(ProposalLeaseAction::Send { proposal });
        Ok(ProposalLeaseOutcome {
            result: ProposalLeaseStart::Retained,
            actions,
        })
    }

    pub fn observe_committed(
        &mut self,
        operation_id: &OperationId,
        scheduler: &mut KernelScheduler,
    ) -> (bool, Vec<ProposalLeaseAction>) {
        if self.disposed {
            return (false, Vec::new());
        }

        let _ = self.committed_tombstones.insert(operation_id.clone());
        let Some(lease) = self.leases.get(operation_id).cloned() else {
            return (false, Vec::new());
        };

        let mut actions = Vec::new();
        self.cancel_lease_timers(&lease, scheduler, &mut actions);
        let _ = self.leases.remove(operation_id);
        (true, actions)
    }

    pub fn resend_retained(&mut self) -> (SafeU53, Vec<ProposalLeaseAction>) {
        if self.disposed {
            return (SafeU53::ZERO, Vec::new());
        }
        let mut actions = Vec::with_capacity(self.leases.len());
        for lease in self.leases.values() {
            actions.push(ProposalLeaseAction::Send {
                proposal: lease.proposal.clone(),
            });
        }
        (safe_count(self.leases.len()), actions)
    }

    pub fn rebind(
        &mut self,
        endpoint: SeatId,
        generation: ConnectionGeneration,
    ) -> Result<(SafeU53, Vec<ProposalLeaseAction>), ProposalLeaseError> {
        if self.disposed {
            return Err(ProposalLeaseError::Disposed);
        }
        let mut proposals = Vec::new();
        for lease in self.leases.values_mut() {
            if lease.proposal.to == endpoint && lease.proposal.connection_generation < generation {
                lease.proposal.connection_generation = generation;
                proposals.push(lease.proposal.clone());
            }
        }
        let count = safe_count(proposals.len());
        let actions = proposals
            .into_iter()
            .map(|proposal| ProposalLeaseAction::Send { proposal })
            .collect();
        Ok((count, actions))
    }

    pub fn timer_fired(
        &mut self,
        fired: ScheduledTimer,
        scheduler: &mut KernelScheduler,
    ) -> Result<Vec<ProposalLeaseAction>, ProposalLeaseError> {
        if self.disposed {
            return Err(ProposalLeaseError::Disposed);
        }

        let timer_id = fired.timer_id;
        if scheduler.timer(timer_id).is_some() {
            return Err(invalid_registration(
                "fired proposal timer is still registered with the scheduler",
            ));
        }
        let target = self
            .timer_targets
            .get(&timer_id)
            .cloned()
            .ok_or(ProposalLeaseError::UnknownTimer { timer_id })?;
        self.validate_fired_timer(timer_id, &fired, &target)?;

        let Some(lease_view) = self.leases.get(&target.operation_id).cloned() else {
            return Ok(Vec::new());
        };
        self.validate_target_against_lease(&target, &lease_view)?;

        let expected_timer = match target.kind {
            ProposalTimerKind::Retry => lease_view.retry_timer,
            ProposalTimerKind::Absolute => lease_view.absolute_timer,
        };
        if expected_timer != Some(timer_id) {
            return Ok(Vec::new());
        }

        match target.kind {
            ProposalTimerKind::Retry => {
                let next_attempt = lease_view.retry_attempt.saturating_add(1);
                let next_delay = self.retry_delay(next_attempt);
                let next_owner = self.timer_owner(&lease_view.proposal, "v2 proposal retry")?;
                let command = scheduler.schedule(
                    lease_view.timer_endpoint,
                    next_owner.clone(),
                    next_delay,
                    TimeClass::Connected,
                )?;
                let Some(next_timer) = scheduled_timer_from_command(&command).cloned() else {
                    rollback_scheduled_commands(scheduler, std::slice::from_ref(&command));
                    return Err(invalid_registration(
                        "scheduler returned a non-schedule proposal retry",
                    ));
                };
                if next_timer.timer_id == timer_id
                    || self.timer_targets.contains_key(&next_timer.timer_id)
                    || !timer_matches(
                        &next_timer,
                        lease_view.timer_endpoint,
                        &next_owner,
                        next_delay,
                        TimeClass::Connected,
                    )
                {
                    let _ = scheduler.cancel(next_timer.timer_id);
                    return Err(invalid_registration(
                        "scheduler returned proposal retry metadata that does not match the request",
                    ));
                }

                let Some(current) = self.leases.get(&target.operation_id) else {
                    let _ = scheduler.cancel(next_timer.timer_id);
                    return Ok(Vec::new());
                };
                if current.retry_timer != Some(timer_id) {
                    let _ = scheduler.cancel(next_timer.timer_id);
                    return Ok(Vec::new());
                }

                let _ = self.timer_targets.remove(&timer_id);
                let _ = self.timer_targets.insert(
                    next_timer.timer_id,
                    ProposalTimerTarget {
                        operation_id: target.operation_id.clone(),
                        kind: ProposalTimerKind::Retry,
                        endpoint: lease_view.timer_endpoint,
                        owner: next_owner,
                        delay_ms: next_delay,
                        time_class: TimeClass::Connected,
                    },
                );
                if let Some(lease) = self.leases.get_mut(&target.operation_id) {
                    lease.retry_attempt = next_attempt;
                    lease.retry_timer = Some(next_timer.timer_id);
                }
                Ok(vec![
                    ProposalLeaseAction::Scheduler { command },
                    ProposalLeaseAction::Send {
                        proposal: lease_view.proposal,
                    },
                ])
            }
            ProposalTimerKind::Absolute => {
                let retry_id = lease_view.retry_timer;
                let retry_cancel = if let Some(retry_id) = retry_id {
                    if retry_id == timer_id {
                        return Err(invalid_registration(
                            "proposal absolute and retry timer identities overlap",
                        ));
                    }
                    let retry_target =
                        self.timer_targets.get(&retry_id).cloned().ok_or_else(|| {
                            invalid_registration(
                                "proposal retry timer target is missing at absolute expiry",
                            )
                        })?;
                    if retry_target.operation_id != target.operation_id
                        || retry_target.kind != ProposalTimerKind::Retry
                    {
                        return Err(invalid_registration(
                            "proposal retry timer target identity is invalid",
                        ));
                    }
                    self.validate_target_against_lease(&retry_target, &lease_view)?;
                    let retry_timer = ScheduledTimer {
                        endpoint: retry_target.endpoint,
                        timer_id: retry_id,
                        owner: retry_target.owner.clone(),
                        delay_ms: retry_target.delay_ms,
                        time_class: retry_target.time_class,
                    };
                    if let Some(live_retry) = scheduler.timer(retry_id)
                        && live_retry != &retry_timer
                    {
                        return Err(invalid_registration(
                            "scheduler retry timer metadata does not match proposal state",
                        ));
                    }
                    scheduler.cancel(retry_id)
                } else {
                    None
                };

                let _ = self.timer_targets.remove(&timer_id);
                if let Some(retry_id) = retry_id {
                    let _ = self.timer_targets.remove(&retry_id);
                }
                let _ = self.leases.remove(&target.operation_id);

                let mut actions = Vec::new();
                if let Some(command) = retry_cancel {
                    actions.push(ProposalLeaseAction::Scheduler { command });
                }
                actions.push(ProposalLeaseAction::Terminalize {
                    operation_id: target.operation_id,
                    reason: "v2 proposal absolute ceiling".to_owned(),
                });
                Ok(actions)
            }
        }
    }

    pub fn diagnostics(&self) -> ProposalLeaseDiagnostics {
        ProposalLeaseDiagnostics {
            live_operation_ids: self.leases.keys().cloned().collect(),
            committed_tombstones: self.committed_tombstones.clone(),
            timer_ids: self.timer_targets.keys().copied().collect(),
            disposed: self.disposed,
        }
    }

    pub fn retained_count(&self) -> SafeU53 {
        safe_count(self.leases.len())
    }

    pub fn dispose(
        &mut self,
        _reason: &str,
        scheduler: &mut KernelScheduler,
    ) -> Vec<ProposalLeaseAction> {
        if self.disposed {
            return Vec::new();
        }

        let mut timer_ids = self.timer_targets.keys().copied().collect::<BTreeSet<_>>();
        for lease in self.leases.values() {
            if let Some(timer_id) = lease.retry_timer {
                let _ = timer_ids.insert(timer_id);
            }
            if let Some(timer_id) = lease.absolute_timer {
                let _ = timer_ids.insert(timer_id);
            }
        }

        let mut actions = Vec::new();
        for timer_id in timer_ids {
            let _ = self.timer_targets.remove(&timer_id);
            if let Some(command) = scheduler.cancel(timer_id) {
                actions.push(ProposalLeaseAction::Scheduler { command });
            }
        }

        self.leases.clear();
        self.timer_targets.clear();
        self.committed_tombstones.clear();
        self.disposed = true;
        actions
    }

    fn validate_spec(spec: &ProposalLeaseSpec) -> Result<(), String> {
        if spec.proposal.fingerprint.is_empty() {
            return Err("proposal fingerprint must not be empty".to_owned());
        }
        if spec
            .absolute_ceiling_ms
            .is_some_and(|value| value == SafeU53::ZERO)
        {
            return Err("proposal absolute ceiling must be positive".to_owned());
        }
        Ok(())
    }

    fn retry_delay(&self, retry_attempt: u32) -> SafeU53 {
        let maximum = self.config.retry_maximum_ms.get();
        let mut delay = self.config.retry_initial_ms.get();
        let mut remaining = retry_attempt.min(63);
        while remaining > 0 && delay < maximum {
            delay = delay.saturating_mul(2).min(maximum);
            remaining -= 1;
        }
        match SafeU53::new(delay) {
            Ok(delay) => delay,
            Err(_) => self.config.retry_maximum_ms,
        }
    }

    fn timer_owner(
        &self,
        proposal: &RetainedProposal,
        reason: &str,
    ) -> Result<TimerOwner, ProposalLeaseError> {
        let owner_id = format!("{}{}", self.config.owner_prefix, proposal.operation_id);
        TimerOwner::new(owner_id, proposal.operation_id.as_str(), reason).map_err(|error| {
            ProposalLeaseError::InvalidProposal {
                reason: error.to_string(),
            }
        })
    }

    fn validate_fired_timer(
        &self,
        timer_id: TimerId,
        fired: &ScheduledTimer,
        target: &ProposalTimerTarget,
    ) -> Result<(), ProposalLeaseError> {
        if fired.timer_id != timer_id
            || fired.endpoint != target.endpoint
            || fired.owner != target.owner.clone()
            || fired.delay_ms != target.delay_ms
            || fired.time_class != target.time_class
        {
            return Err(invalid_registration(
                "fired proposal timer metadata does not match its registered identity",
            ));
        }
        Ok(())
    }

    fn validate_target_against_lease(
        &self,
        target: &ProposalTimerTarget,
        lease: &ActiveProposalLease,
    ) -> Result<(), ProposalLeaseError> {
        let expected_kind = match target.kind {
            ProposalTimerKind::Retry => {
                if lease.retry_timer.is_none() {
                    return Err(invalid_registration(
                        "proposal retry timer is absent from the retained lease",
                    ));
                }
                TimeClass::Connected
            }
            ProposalTimerKind::Absolute => {
                if lease.absolute_timer.is_none() {
                    return Err(invalid_registration(
                        "proposal absolute timer is absent from the retained lease",
                    ));
                }
                TimeClass::Absolute
            }
        };
        let expected_delay = match target.kind {
            ProposalTimerKind::Retry => self.retry_delay(lease.retry_attempt),
            ProposalTimerKind::Absolute => lease.absolute_delay_ms,
        };
        let expected_owner = self.timer_owner(
            &lease.proposal,
            match target.kind {
                ProposalTimerKind::Retry => "v2 proposal retry",
                ProposalTimerKind::Absolute => "v2 proposal absolute ceiling",
            },
        )?;
        if target.operation_id != lease.proposal.operation_id
            || target.endpoint != lease.timer_endpoint
            || target.owner != expected_owner
            || target.delay_ms != expected_delay
            || target.time_class != expected_kind
        {
            return Err(invalid_registration(
                "proposal timer target does not match retained lease state",
            ));
        }
        Ok(())
    }

    fn cancel_lease_timers(
        &mut self,
        lease: &ActiveProposalLease,
        scheduler: &mut KernelScheduler,
        actions: &mut Vec<ProposalLeaseAction>,
    ) {
        let mut timer_ids = BTreeSet::new();
        if let Some(timer_id) = lease.retry_timer {
            let _ = timer_ids.insert(timer_id);
        }
        if let Some(timer_id) = lease.absolute_timer {
            let _ = timer_ids.insert(timer_id);
        }
        for timer_id in timer_ids {
            let _ = self.timer_targets.remove(&timer_id);
            if let Some(command) = scheduler.cancel(timer_id) {
                actions.push(ProposalLeaseAction::Scheduler { command });
            }
        }
    }
}

fn timer_matches(
    timer: &ScheduledTimer,
    endpoint: SeatId,
    owner: &TimerOwner,
    delay_ms: SafeU53,
    time_class: TimeClass,
) -> bool {
    timer.endpoint == endpoint
        && timer.owner == owner.clone()
        && timer.delay_ms == delay_ms
        && timer.time_class == time_class
}

fn scheduled_timer_from_command(command: &SchedulerCommand) -> Option<&ScheduledTimer> {
    match command {
        SchedulerCommand::Schedule { timer } => Some(timer),
        _ => None,
    }
}

fn rollback_scheduled_commands(scheduler: &mut KernelScheduler, commands: &[SchedulerCommand]) {
    for command in commands {
        if let Some(timer) = scheduled_timer_from_command(command) {
            let _ = scheduler.cancel(timer.timer_id);
        }
    }
}

fn invalid_registration(reason: &str) -> ProposalLeaseError {
    ProposalLeaseError::InvalidProposal {
        reason: reason.to_owned(),
    }
}

impl crate::snapshot::ProposalAdmissionSnapshotBridge for ProposalAdmissionLedger {
    fn snapshot_v2(
        &self,
    ) -> Result<crate::snapshot::ProposalAdmissionSnapshotV2, crate::snapshot::SnapshotError> {
        let snapshot = crate::snapshot::ProposalAdmissionSnapshotV2 {
            capacity: self.capacity,
            fingerprints: self
                .fingerprints
                .iter()
                .map(
                    |(operation_id, fingerprint)| crate::snapshot::ProposalFingerprintSnapshotV2 {
                        operation_id: operation_id.clone(),
                        fingerprint: fingerprint.clone(),
                    },
                )
                .collect(),
            disposed: self.disposed,
        };
        snapshot.validate()?;
        Ok(snapshot)
    }

    fn from_snapshot_v2(
        snapshot: crate::snapshot::ProposalAdmissionSnapshotV2,
    ) -> Result<Self, crate::snapshot::SnapshotError> {
        snapshot.validate()?;
        let mut fingerprints = BTreeMap::new();
        for entry in &snapshot.fingerprints {
            if fingerprints
                .insert(entry.operation_id.clone(), entry.fingerprint.clone())
                .is_some()
            {
                return Err(proposal_snapshot_invalid(
                    "proposal_admission.fingerprints",
                    "duplicate proposal operation identity",
                ));
            }
        }
        Ok(Self {
            capacity: snapshot.capacity,
            fingerprints,
            disposed: snapshot.disposed,
        })
    }
}

impl crate::snapshot::ProposalLeaseSnapshotBridge for ProposalLeaseManager {
    fn snapshot_v2(
        &self,
    ) -> Result<crate::snapshot::ProposalLeaseSnapshotV2, crate::snapshot::SnapshotError> {
        let leases = self
            .leases
            .iter()
            .map(|(operation_id, lease)| {
                if operation_id != &lease.proposal.operation_id {
                    return Err(proposal_snapshot_invalid(
                        "proposal_leases.leases",
                        "lease map key differs from proposal operation identity",
                    ));
                }
                Ok(crate::snapshot::ActiveProposalLeaseSnapshotV2 {
                    operation_id: operation_id.clone(),
                    proposal: opaque_proposal_snapshot(
                        &lease.proposal,
                        "proposal_leases.leases.proposal",
                    )?,
                    retry_attempt: lease.retry_attempt,
                    retry_timer: lease.retry_timer,
                    absolute_timer: lease.absolute_timer,
                    timer_endpoint: lease.timer_endpoint,
                    absolute_delay_ms: lease.absolute_delay_ms,
                })
            })
            .collect::<Result<Vec<_>, crate::snapshot::SnapshotError>>()?;
        let timer_targets = self
            .timer_targets
            .iter()
            .map(
                |(timer_id, target)| crate::snapshot::ProposalTimerTargetSnapshotV2 {
                    timer_id: *timer_id,
                    operation_id: target.operation_id.clone(),
                    kind: match target.kind {
                        ProposalTimerKind::Retry => crate::snapshot::ProposalTimerKindV2::Retry,
                        ProposalTimerKind::Absolute => {
                            crate::snapshot::ProposalTimerKindV2::Absolute
                        }
                    },
                    endpoint: target.endpoint,
                    owner: target.owner.clone(),
                    delay_ms: target.delay_ms,
                    time_class: target.time_class,
                },
            )
            .collect();
        let snapshot = crate::snapshot::ProposalLeaseSnapshotV2 {
            config: self.config.clone(),
            leases,
            committed_tombstones: self.committed_tombstones.iter().cloned().collect(),
            timer_targets,
            disposed: self.disposed,
        };
        snapshot.validate()?;
        Ok(snapshot)
    }

    fn from_snapshot_v2(
        snapshot: crate::snapshot::ProposalLeaseSnapshotV2,
        scheduler: &mut KernelScheduler,
    ) -> Result<Self, crate::snapshot::SnapshotError> {
        snapshot.validate()?;
        validate_proposal_lease_config(&snapshot.config)?;

        let mut leases = BTreeMap::new();
        for retained in &snapshot.leases {
            let proposal = decode_proposal_message(
                &retained.proposal.canonical_envelope_bytes,
                "proposal_leases.leases.proposal.canonical_envelope_bytes",
            )?;
            if proposal.operation_id != retained.operation_id
                || proposal.fingerprint.is_empty()
                || proposal.from != retained.timer_endpoint
            {
                return Err(proposal_snapshot_invalid(
                    "proposal_leases.leases",
                    "retained proposal identity, fingerprint, or timer endpoint is contradictory",
                ));
            }
            if retained.absolute_delay_ms == SafeU53::ZERO
                || retained.absolute_delay_ms > snapshot.config.absolute_ceiling_ms
            {
                return Err(proposal_snapshot_invalid(
                    "proposal_leases.leases.absolute_delay_ms",
                    "absolute lease delay is outside the configured ceiling",
                ));
            }
            if leases
                .insert(
                    retained.operation_id.clone(),
                    ActiveProposalLease {
                        proposal,
                        retry_attempt: retained.retry_attempt,
                        retry_timer: retained.retry_timer,
                        absolute_timer: retained.absolute_timer,
                        timer_endpoint: retained.timer_endpoint,
                        absolute_delay_ms: retained.absolute_delay_ms,
                    },
                )
                .is_some()
            {
                return Err(proposal_snapshot_invalid(
                    "proposal_leases.leases",
                    "duplicate retained proposal operation identity",
                ));
            }
        }

        let committed_tombstones = snapshot
            .committed_tombstones
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        let mut timer_targets = BTreeMap::new();
        for target in &snapshot.timer_targets {
            let kind = match target.kind {
                crate::snapshot::ProposalTimerKindV2::Retry => ProposalTimerKind::Retry,
                crate::snapshot::ProposalTimerKindV2::Absolute => ProposalTimerKind::Absolute,
            };
            let Some(lease) = leases.get(&target.operation_id) else {
                return Err(proposal_snapshot_invalid(
                    "proposal_leases.timer_targets",
                    "timer target has no retained proposal lease",
                ));
            };
            let expected_timer = match kind {
                ProposalTimerKind::Retry => lease.retry_timer,
                ProposalTimerKind::Absolute => lease.absolute_timer,
            };
            if expected_timer != Some(target.timer_id)
                || target.endpoint != lease.timer_endpoint
                || target.time_class
                    != match kind {
                        ProposalTimerKind::Retry => TimeClass::Connected,
                        ProposalTimerKind::Absolute => TimeClass::Absolute,
                    }
            {
                return Err(proposal_snapshot_invalid(
                    "proposal_leases.timer_targets",
                    "timer target does not identify the lease's exact timer",
                ));
            }
            let expected_owner = proposal_timer_owner(
                &snapshot.config,
                &lease.proposal,
                match kind {
                    ProposalTimerKind::Retry => "v2 proposal retry",
                    ProposalTimerKind::Absolute => "v2 proposal absolute ceiling",
                },
            )?;
            let expected_delay = match kind {
                ProposalTimerKind::Retry => {
                    proposal_retry_delay(&snapshot.config, lease.retry_attempt)
                }
                ProposalTimerKind::Absolute => lease.absolute_delay_ms,
            };
            if target.owner != expected_owner || target.delay_ms != expected_delay {
                return Err(proposal_snapshot_invalid(
                    "proposal_leases.timer_targets",
                    "timer target owner or delay differs from the retained lease",
                ));
            }
            let expected_registration = ScheduledTimer {
                endpoint: target.endpoint,
                timer_id: target.timer_id,
                owner: target.owner.clone(),
                delay_ms: target.delay_ms,
                time_class: target.time_class,
            };
            if scheduler.is_disposed()
                || scheduler.timer(target.timer_id) != Some(&expected_registration)
            {
                return Err(proposal_snapshot_invalid(
                    "proposal_leases.timer_targets",
                    "retained proposal timer is not the exact registration in the restored scheduler",
                ));
            }
            if timer_targets
                .insert(
                    target.timer_id,
                    ProposalTimerTarget {
                        operation_id: target.operation_id.clone(),
                        kind,
                        endpoint: target.endpoint,
                        owner: target.owner.clone(),
                        delay_ms: target.delay_ms,
                        time_class: target.time_class,
                    },
                )
                .is_some()
            {
                return Err(proposal_snapshot_invalid(
                    "proposal_leases.timer_targets",
                    "duplicate proposal timer identity",
                ));
            }
        }

        for (operation_id, lease) in &leases {
            if committed_tombstones.contains(operation_id) {
                return Err(proposal_snapshot_invalid(
                    "proposal_leases",
                    "a committed proposal cannot retain an active lease",
                ));
            }
            if lease.retry_timer.is_some()
                && lease.absolute_timer.is_some()
                && lease.retry_timer == lease.absolute_timer
            {
                return Err(proposal_snapshot_invalid(
                    "proposal_leases.leases",
                    "proposal retry and absolute timers cannot share an identity",
                ));
            }
            if lease
                .retry_timer
                .is_some_and(|timer_id| !timer_targets.contains_key(&timer_id))
                || lease
                    .absolute_timer
                    .is_some_and(|timer_id| !timer_targets.contains_key(&timer_id))
            {
                return Err(proposal_snapshot_invalid(
                    "proposal_leases.leases",
                    "active lease timer is missing its retained target",
                ));
            }
        }

        cross_check_proposal_timers(&snapshot.config, &timer_targets, scheduler)?;

        Ok(Self {
            config: snapshot.config,
            leases,
            committed_tombstones,
            timer_targets,
            disposed: snapshot.disposed,
        })
    }
}

fn validate_proposal_lease_config(
    config: &ProposalLeaseConfig,
) -> Result<(), crate::snapshot::SnapshotError> {
    if config.owner_prefix.is_empty()
        || config.owner_prefix.encode_utf16().count() > 256
        || config
            .owner_prefix
            .chars()
            .any(|character| character <= '\u{001f}' || character == '\u{007f}')
        || config.retry_initial_ms == SafeU53::ZERO
        || config.retry_maximum_ms == SafeU53::ZERO
        || config.retry_initial_ms > config.retry_maximum_ms
        || config.absolute_ceiling_ms == SafeU53::ZERO
    {
        return Err(proposal_snapshot_invalid(
            "proposal_leases.config",
            "proposal lease owner and timing configuration are invalid",
        ));
    }
    Ok(())
}

fn proposal_retry_delay(config: &ProposalLeaseConfig, retry_attempt: u32) -> SafeU53 {
    let maximum = config.retry_maximum_ms.get();
    let mut delay = config.retry_initial_ms.get();
    let mut remaining = retry_attempt.min(63);
    while remaining > 0 && delay < maximum {
        delay = delay.saturating_mul(2).min(maximum);
        remaining -= 1;
    }
    SafeU53::new(delay).unwrap_or(config.retry_maximum_ms)
}

fn proposal_timer_owner(
    config: &ProposalLeaseConfig,
    proposal: &RetainedProposal,
    reason: &str,
) -> Result<TimerOwner, crate::snapshot::SnapshotError> {
    TimerOwner::new(
        format!("{}{}", config.owner_prefix, proposal.operation_id),
        proposal.operation_id.as_str(),
        reason,
    )
    .map_err(|error| {
        proposal_snapshot_invalid("proposal_leases.timer_targets.owner", error.to_string())
    })
}

fn cross_check_proposal_timers(
    config: &ProposalLeaseConfig,
    timer_targets: &BTreeMap<TimerId, ProposalTimerTarget>,
    scheduler: &KernelScheduler,
) -> Result<(), crate::snapshot::SnapshotError> {
    let mut expected_timer_ids = BTreeMap::<TimerOwner, BTreeSet<TimerId>>::new();
    for (timer_id, target) in timer_targets {
        expected_timer_ids
            .entry(target.owner.clone())
            .or_default()
            .insert(*timer_id);
    }

    // A scheduler containing unrelated owners remains usable by other
    // subsystems.  Timers in this proposal owner's namespace, however, must
    // be represented by one exact retained target in the restored manager.
    for timer in scheduler.live_timers() {
        if !timer.owner.owner_id.starts_with(&config.owner_prefix) {
            continue;
        }
        let Some(expected_ids) = expected_timer_ids.get(&timer.owner) else {
            return Err(proposal_snapshot_invalid(
                "scheduler.timers",
                format!("orphaned proposal timer {}", timer.timer_id),
            ));
        };
        if !expected_ids.contains(&timer.timer_id) {
            return Err(proposal_snapshot_invalid(
                "scheduler.timers",
                "proposal timer owner is bound to the wrong timer ID",
            ));
        }
    }
    Ok(())
}

fn opaque_proposal_snapshot(
    proposal: &RetainedProposal,
    path: &str,
) -> Result<crate::snapshot::OpaqueProposalEnvelopeSnapshotV2, crate::snapshot::SnapshotError> {
    let canonical_envelope_bytes = er_canonical::canonical_bytes(proposal)
        .map_err(|error| proposal_snapshot_canonical(path, error.to_string()))?;
    Ok(crate::snapshot::OpaqueProposalEnvelopeSnapshotV2 {
        operation_id: proposal.operation_id.clone(),
        canonical_envelope_bytes: er_types::battle_ids::CanonicalHexBytes::from_bytes(
            &canonical_envelope_bytes,
        ),
    })
}

fn decode_proposal_message(
    bytes: &er_types::battle_ids::CanonicalHexBytes,
    path: &str,
) -> Result<ProposalMessage, crate::snapshot::SnapshotError> {
    let raw = decode_proposal_hex(bytes, path)?;
    let proposal = serde_json::from_slice::<ProposalMessage>(&raw)
        .map_err(|error| proposal_snapshot_canonical(path, error.to_string()))?;
    let canonical = er_canonical::canonical_bytes(&proposal)
        .map_err(|error| proposal_snapshot_canonical(path, error.to_string()))?;
    if canonical != raw {
        return Err(proposal_snapshot_canonical(
            path,
            "payload is not the exact canonical JSON encoding",
        ));
    }
    Ok(proposal)
}

fn decode_proposal_hex(
    bytes: &er_types::battle_ids::CanonicalHexBytes,
    path: &str,
) -> Result<Vec<u8>, crate::snapshot::SnapshotError> {
    let raw = bytes.as_str().as_bytes();
    if !raw.len().is_multiple_of(2) {
        return Err(proposal_snapshot_canonical(
            path,
            "canonical payload has odd hex length",
        ));
    }
    let mut decoded = Vec::with_capacity(raw.len() / 2);
    for pair in raw.chunks_exact(2) {
        let Some(high) = proposal_hex_digit(pair[0]) else {
            return Err(proposal_snapshot_canonical(path, "invalid hex"));
        };
        let Some(low) = proposal_hex_digit(pair[1]) else {
            return Err(proposal_snapshot_canonical(path, "invalid hex"));
        };
        decoded.push((high << 4) | low);
    }
    if decoded.is_empty() {
        return Err(proposal_snapshot_canonical(
            path,
            "canonical payload must not be empty",
        ));
    }
    Ok(decoded)
}

fn proposal_hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        _ => None,
    }
}

fn proposal_snapshot_invalid(
    path: impl Into<String>,
    reason: impl Into<String>,
) -> crate::snapshot::SnapshotError {
    crate::snapshot::SnapshotError::Invalid {
        path: path.into(),
        reason: reason.into(),
    }
}

fn proposal_snapshot_canonical(
    path: impl Into<String>,
    reason: impl Into<String>,
) -> crate::snapshot::SnapshotError {
    crate::snapshot::SnapshotError::Canonical {
        path: path.into(),
        reason: reason.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::{ProposalLeaseConfig, ProposalLeaseError, ProposalLeaseManager, ProposalLeaseSpec};
    use crate::scheduler::{KernelScheduler, SchedulerCommand, SchedulerError};
    use er_types::{
        ConnectionGeneration, OperationId, ProposalMessage, SafeU53, SeatId, TimeClass, TimerId,
        TimerOwner,
    };
    use serde_json::Value;

    fn safe_u(value: u64) -> SafeU53 {
        SafeU53::new(value).expect("test value must fit SafeU53")
    }

    fn test_config() -> ProposalLeaseConfig {
        ProposalLeaseConfig {
            owner_prefix: "authority-v2:proposal:".to_owned(),
            retry_initial_ms: safe_u(250),
            retry_maximum_ms: safe_u(5_000),
            absolute_ceiling_ms: safe_u(1_200_000),
        }
    }

    fn test_proposal() -> ProposalMessage {
        ProposalMessage {
            operation_id: OperationId::new("OP/allocator-boundary")
                .expect("test operation ID must be valid"),
            fingerprint: "intent-a".to_owned(),
            from: SeatId::new(safe_u(1)),
            to: SeatId::new(safe_u(2)),
            connection_generation: ConnectionGeneration::new(safe_u(1)),
            payload: Value::String("opaque-payload".to_owned()),
        }
    }

    #[test]
    fn two_timer_id_exhaustion_rolls_back_proposal_and_preserves_allocator_cursor()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut scheduler = KernelScheduler::new();
        scheduler.set_next_timer_id_for_test(SafeU53::MAX);
        assert!(scheduler.live_timers().is_empty());

        let mut manager = ProposalLeaseManager::new(test_config())?;
        let before_diagnostics = manager.diagnostics();
        let before_timers = scheduler.live_timers();
        let result = manager.arm(
            ProposalLeaseSpec {
                proposal: test_proposal(),
                absolute_ceiling_ms: None,
            },
            &mut scheduler,
        );
        assert_eq!(
            result,
            Err(ProposalLeaseError::Scheduler(
                SchedulerError::TimerIdExhausted,
            ))
        );
        assert_eq!(manager.diagnostics(), before_diagnostics);
        assert_eq!(manager.retained_count(), SafeU53::ZERO);
        assert_eq!(scheduler.live_timers(), before_timers);
        let (retained_count, resend_actions) = manager.resend_retained();
        assert_eq!(retained_count, SafeU53::ZERO);
        assert!(resend_actions.is_empty());

        let max_command = scheduler.schedule(
            SeatId::new(safe_u(1)),
            TimerOwner {
                owner_id: "allocator-boundary-test".to_owned(),
                address: "OP/allocator-boundary".to_owned(),
                reason: "probe".to_owned(),
            },
            safe_u(250),
            TimeClass::Connected,
        )?;
        let max_timer = match max_command {
            SchedulerCommand::Schedule { timer } => timer,
            other => {
                return Err(std::io::Error::other(format!(
                    "expected MAX timer allocation, got {other:?}"
                ))
                .into());
            }
        };
        assert_eq!(max_timer.timer_id, TimerId::new(SafeU53::MAX));
        assert_eq!(scheduler.live_timers(), vec![max_timer.clone()]);
        assert!(scheduler.cancel(max_timer.timer_id).is_some());
        assert!(scheduler.live_timers().is_empty());
        assert_eq!(
            scheduler.schedule(
                max_timer.endpoint,
                max_timer.owner,
                max_timer.delay_ms,
                max_timer.time_class,
            ),
            Err(SchedulerError::TimerIdExhausted),
        );
        Ok(())
    }
}
