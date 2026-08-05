//! Proposal admission identity and retained resend leases.

use std::collections::{BTreeMap, BTreeSet};

use er_types::{
    ConnectionGeneration, OperationId, ProposalMessage, SafeI53, SafeU53, SeatId, TimeClass,
    TimerId, TimerOwner,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use crate::SchedulerCommand;
use crate::scheduler::ScheduledTimer;

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
        serde_json::from_str::<Value>(&value).map_err(|error| {
            ProposalFingerprintError::InvalidJson {
                reason: error.to_string(),
            }
        })?;
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
    if label.is_empty() {
        return Err(ProposalFingerprintError::EmptyKind);
    }

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
        return value.to_owned();
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

#[derive(Debug)]
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
}

#[derive(Debug)]
struct ActiveProposalLease {
    proposal: RetainedProposal,
    retry_attempt: u32,
    retry_timer: Option<TimerId>,
    absolute_timer: Option<TimerId>,
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
}

#[derive(Debug)]
pub struct ProposalLeaseManager {
    config: ProposalLeaseConfig,
    leases: BTreeMap<OperationId, ActiveProposalLease>,
    committed_tombstones: BTreeSet<OperationId>,
    timer_targets: BTreeMap<TimerId, ProposalTimerTarget>,
    next_timer_id: SafeU53,
    disposed: bool,
}

impl ProposalLeaseManager {
    pub fn new(config: ProposalLeaseConfig) -> Result<Self, ProposalLeaseError> {
        if config.owner_prefix.is_empty()
            || config.owner_prefix.len() > 256
            || config
                .owner_prefix
                .bytes()
                .any(|byte| byte.is_ascii_control())
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
            next_timer_id: TimerId::ZERO.into_inner(),
            disposed: false,
        })
    }

    pub fn arm(&mut self, spec: ProposalLeaseSpec) -> ProposalLeaseOutcome {
        if self.disposed {
            return ProposalLeaseOutcome {
                result: ProposalLeaseStart::Disposed,
                actions: Vec::new(),
            };
        }
        if let Err(_reason) = Self::validate_spec(&spec) {
            return ProposalLeaseOutcome {
                result: ProposalLeaseStart::Invalid,
                actions: Vec::new(),
            };
        }
        let absolute_delay = match spec.absolute_ceiling_ms {
            Some(value) => value,
            None => self.config.absolute_ceiling_ms,
        };
        let proposal = spec.proposal;
        let operation_id = proposal.operation_id.clone();
        if self.committed_tombstones.contains(&operation_id) {
            return ProposalLeaseOutcome {
                result: ProposalLeaseStart::AlreadyCommitted,
                actions: Vec::new(),
            };
        }
        if let Some(existing) = self.leases.get_mut(&operation_id) {
            if existing.proposal.fingerprint != proposal.fingerprint {
                return ProposalLeaseOutcome {
                    result: ProposalLeaseStart::Conflict,
                    actions: Vec::new(),
                };
            }
            existing.proposal = proposal;
            return ProposalLeaseOutcome {
                result: ProposalLeaseStart::AlreadyRetained,
                actions: vec![ProposalLeaseAction::Send {
                    proposal: existing.proposal.clone(),
                }],
            };
        }

        let absolute_timer = match self.allocate_timer_id() {
            Ok(timer_id) => timer_id,
            Err(_) => {
                return ProposalLeaseOutcome {
                    result: ProposalLeaseStart::Invalid,
                    actions: Vec::new(),
                };
            }
        };
        let retry_timer = match self.allocate_timer_id() {
            Ok(timer_id) => timer_id,
            Err(_) => {
                return ProposalLeaseOutcome {
                    result: ProposalLeaseStart::Invalid,
                    actions: Vec::new(),
                };
            }
        };
        let absolute_action = match self.schedule_action(
            &proposal,
            absolute_timer,
            absolute_delay,
            TimeClass::Absolute,
            "v2 proposal absolute ceiling",
        ) {
            Ok(action) => action,
            Err(_) => {
                return ProposalLeaseOutcome {
                    result: ProposalLeaseStart::Invalid,
                    actions: Vec::new(),
                };
            }
        };
        let retry_action = match self.schedule_action(
            &proposal,
            retry_timer,
            self.retry_delay(0),
            TimeClass::Connected,
            "v2 proposal retry",
        ) {
            Ok(action) => action,
            Err(_) => {
                return ProposalLeaseOutcome {
                    result: ProposalLeaseStart::Invalid,
                    actions: Vec::new(),
                };
            }
        };
        let _ = self.timer_targets.insert(
            absolute_timer,
            ProposalTimerTarget {
                operation_id: operation_id.clone(),
                kind: ProposalTimerKind::Absolute,
            },
        );
        let _ = self.timer_targets.insert(
            retry_timer,
            ProposalTimerTarget {
                operation_id: operation_id.clone(),
                kind: ProposalTimerKind::Retry,
            },
        );
        let _ = self.leases.insert(
            operation_id,
            ActiveProposalLease {
                proposal: proposal.clone(),
                retry_attempt: 0,
                retry_timer: Some(retry_timer),
                absolute_timer: Some(absolute_timer),
            },
        );
        ProposalLeaseOutcome {
            result: ProposalLeaseStart::Retained,
            actions: vec![
                absolute_action,
                ProposalLeaseAction::Send { proposal },
                retry_action,
            ],
        }
    }

    pub fn observe_committed(
        &mut self,
        operation_id: &OperationId,
    ) -> (bool, Vec<ProposalLeaseAction>) {
        if self.disposed {
            return (false, Vec::new());
        }
        let _ = self.committed_tombstones.insert(operation_id.clone());
        let Some(lease) = self.leases.remove(operation_id) else {
            return (false, Vec::new());
        };
        let mut actions = Vec::new();
        self.cancel_lease_timers(&lease, &mut actions);
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
        timer_id: TimerId,
    ) -> Result<Vec<ProposalLeaseAction>, ProposalLeaseError> {
        if self.disposed {
            return Err(ProposalLeaseError::Disposed);
        }
        let target = match self.timer_targets.remove(&timer_id) {
            Some(target) => target,
            None => return Err(ProposalLeaseError::UnknownTimer { timer_id }),
        };
        match target.kind {
            ProposalTimerKind::Retry => {
                let (proposal, retry_attempt) = {
                    let Some(lease) = self.leases.get_mut(&target.operation_id) else {
                        return Ok(Vec::new());
                    };
                    if lease.retry_timer != Some(timer_id) {
                        return Ok(Vec::new());
                    }
                    lease.retry_timer = None;
                    lease.retry_attempt = lease.retry_attempt.saturating_add(1);
                    (lease.proposal.clone(), lease.retry_attempt)
                };
                let next_timer = self.allocate_timer_id()?;
                let retry_action = self.schedule_action(
                    &proposal,
                    next_timer,
                    self.retry_delay(retry_attempt),
                    TimeClass::Connected,
                    "v2 proposal retry",
                )?;
                if let Some(lease) = self.leases.get_mut(&target.operation_id) {
                    lease.retry_timer = Some(next_timer);
                }
                let _ = self.timer_targets.insert(
                    next_timer,
                    ProposalTimerTarget {
                        operation_id: target.operation_id,
                        kind: ProposalTimerKind::Retry,
                    },
                );
                Ok(vec![ProposalLeaseAction::Send { proposal }, retry_action])
            }
            ProposalTimerKind::Absolute => {
                let Some(lease_view) = self.leases.get(&target.operation_id) else {
                    return Ok(Vec::new());
                };
                if lease_view.absolute_timer != Some(timer_id) {
                    return Ok(Vec::new());
                }
                let Some(lease) = self.leases.remove(&target.operation_id) else {
                    return Ok(Vec::new());
                };
                let mut actions = Vec::new();
                if let Some(retry_timer) = lease.retry_timer {
                    let _ = self.timer_targets.remove(&retry_timer);
                    actions.push(cancel_action(lease.proposal.to, retry_timer));
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

    pub fn dispose(&mut self, _reason: &str) -> Vec<ProposalLeaseAction> {
        if self.disposed {
            return Vec::new();
        }
        self.disposed = true;
        let leases = std::mem::take(&mut self.leases);
        let mut actions = Vec::new();
        for (_, lease) in leases {
            self.cancel_lease_timers(&lease, &mut actions);
        }
        self.timer_targets.clear();
        self.committed_tombstones.clear();
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

    fn allocate_timer_id(&mut self) -> Result<TimerId, ProposalLeaseError> {
        if self.next_timer_id == SafeU53::MAX {
            return Err(ProposalLeaseError::InvalidProposal {
                reason: "proposal timer id space is exhausted".to_owned(),
            });
        }
        let timer_id = TimerId::new(self.next_timer_id);
        let next = match self.next_timer_id.get().checked_add(1) {
            Some(value) => value,
            None => {
                return Err(ProposalLeaseError::InvalidProposal {
                    reason: "proposal timer id space is exhausted".to_owned(),
                });
            }
        };
        self.next_timer_id = match SafeU53::new(next) {
            Ok(value) => value,
            Err(_) => {
                return Err(ProposalLeaseError::InvalidProposal {
                    reason: "proposal timer id space is exhausted".to_owned(),
                });
            }
        };
        Ok(timer_id)
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

    fn schedule_action(
        &self,
        proposal: &RetainedProposal,
        timer_id: TimerId,
        delay_ms: SafeU53,
        time_class: TimeClass,
        reason: &str,
    ) -> Result<ProposalLeaseAction, ProposalLeaseError> {
        let owner_id = format!("{}{}", self.config.owner_prefix, proposal.operation_id);
        let owner =
            TimerOwner::new(owner_id, proposal.operation_id.as_str(), reason).map_err(|error| {
                ProposalLeaseError::InvalidProposal {
                    reason: error.to_string(),
                }
            })?;
        Ok(ProposalLeaseAction::Scheduler {
            command: SchedulerCommand::Schedule {
                timer: ScheduledTimer {
                    endpoint: proposal.to,
                    timer_id,
                    owner,
                    delay_ms,
                    time_class,
                },
            },
        })
    }

    fn cancel_lease_timers(
        &mut self,
        lease: &ActiveProposalLease,
        actions: &mut Vec<ProposalLeaseAction>,
    ) {
        if let Some(retry_timer) = lease.retry_timer {
            let _ = self.timer_targets.remove(&retry_timer);
            actions.push(cancel_action(lease.proposal.to, retry_timer));
        }
        if let Some(absolute_timer) = lease.absolute_timer {
            let _ = self.timer_targets.remove(&absolute_timer);
            actions.push(cancel_action(lease.proposal.to, absolute_timer));
        }
    }
}

fn cancel_action(endpoint: SeatId, timer_id: TimerId) -> ProposalLeaseAction {
    ProposalLeaseAction::Scheduler {
        command: SchedulerCommand::Cancel { endpoint, timer_id },
    }
}
