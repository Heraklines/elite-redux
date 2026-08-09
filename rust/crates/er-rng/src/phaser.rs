//! Exact Phaser 3.90.0 `RandomDataGenerator` state and transitions.

use std::fmt;

use er_canonical::CanonicalError;
use er_types::SafeU53;
use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

const TWO_POW_NEGATIVE_32: f64 = 2.328_306_436_538_696_3e-10;
const TWO_POW_31: f64 = 2_147_483_648.0;
const TWO_POW_32: f64 = 4_294_967_296.0;
const TWO_POW_NEGATIVE_53: f64 = 1.110_223_024_625_156_5e-16;
const PHASER_MULTIPLIER: f64 = 2_091_639.0;
const PHASER_FRAC_MULTIPLIER: f64 = 2_097_152.0;
const HASH_MULTIPLIER: f64 = 0.025_196_032_824_169_38;

/// Fail-closed errors raised by the M3 random-stream implementation.
#[derive(Debug, Error)]
pub enum RngError {
    #[error("F64Bits must contain exactly 16 lowercase hexadecimal digits")]
    InvalidF64Bits,
    #[error("generator component {component} must be finite and in [0, 1)")]
    InvalidStateComponent { component: &'static str },
    #[error("generator state string is not the canonical !rnd,c,s0,s1,s2 form")]
    InvalidStateString,
    #[error("generator state string and exact-bit fields disagree")]
    StateStringMismatch,
    #[error("range minimum {minimum} exceeds maximum {maximum}")]
    InvalidRange { minimum: u64, maximum: u64 },
    #[error("range arithmetic exceeds JavaScript's safe-integer domain")]
    RangeOverflow,
    #[error("slice length exceeds JavaScript's safe-integer domain")]
    SliceTooLong,
    #[error("pick requires at least one value")]
    EmptyPick,
    #[error("integer() result {bits:016x} is not exactly representable as u32")]
    IntegerNotExactU32 { bits: u64 },
    #[error("shifted UTF-16 code units contain an unpaired surrogate")]
    UnpairedShiftedSurrogate,
    #[error("seed offset arithmetic exceeds JavaScript's safe-integer domain")]
    UnsafeSeedOffset,
    #[error("battle RNG state is not installed")]
    MissingBattleState,
    #[error("battle RNG state is already installed")]
    BattleStateAlreadyInstalled,
    #[error("turn arithmetic exceeds the positive SafeU53 domain")]
    TurnOverflow,
    #[error("unknown closed RNG callsite ID: {value}")]
    UnknownCallsite { value: String },
    #[error("RNG callsite {callsite} is not mapped to reason {reason}")]
    CallsiteReasonMismatch { callsite: String, reason: String },
    #[error("RNG reason {reason} is not permitted on stream {stream}")]
    ReasonStreamMismatch { reason: String, stream: String },
    #[error("RNG audit sequence is exhausted")]
    AuditSequenceExhausted,
    #[error("RNG audit record is internally inconsistent: {detail}")]
    InvalidAudit { detail: &'static str },
    #[error(transparent)]
    Canonical(#[from] CanonicalError),
}

/// Exactly 16 lowercase hexadecimal digits containing IEEE-754 binary64 bits.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct F64Bits(String);

impl F64Bits {
    /// Encodes a binary64 bit pattern without interpreting it.
    pub fn from_bits(bits: u64) -> Self {
        Self(format!("{bits:016x}"))
    }

    /// Encodes the exact bit pattern of `value`.
    pub fn from_f64(value: f64) -> Self {
        Self::from_bits(value.to_bits())
    }

    /// Returns the canonical lowercase hexadecimal representation.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Returns the represented IEEE-754 bits.
    pub fn bits(&self) -> u64 {
        self.0.bytes().fold(0_u64, |bits, byte| {
            let nibble = match byte {
                b'0'..=b'9' => u64::from(byte - b'0'),
                b'a'..=b'f' => u64::from(byte - b'a' + 10),
                _ => 0,
            };
            (bits << 4) | nibble
        })
    }

    /// Returns the represented binary64 value.
    pub fn to_f64(&self) -> f64 {
        f64::from_bits(self.bits())
    }

    fn parse(value: String) -> Result<Self, RngError> {
        if value.len() != 16
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(RngError::InvalidF64Bits);
        }
        Ok(Self(value))
    }
}

impl fmt::Display for F64Bits {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl<'de> Deserialize<'de> for F64Bits {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(value).map_err(serde::de::Error::custom)
    }
}

/// Canonical, exact-bit form of Phaser's public `!rnd,c,s0,s1,s2` state.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct PhaserRdgState {
    pub state_string: String,
    pub s0_bits: F64Bits,
    pub s1_bits: F64Bits,
    pub s2_bits: F64Bits,
    pub carry: u32,
}

impl PhaserRdgState {
    /// Builds a canonical state from validated binary64 components.
    pub fn from_values(carry: u32, s0: f64, s1: f64, s2: f64) -> Result<Self, RngError> {
        validate_state_component("s0", s0)?;
        validate_state_component("s1", s1)?;
        validate_state_component("s2", s2)?;

        let state_string = format!(
            "!rnd,{carry},{},{},{}",
            js_number_to_string(s0),
            js_number_to_string(s1),
            js_number_to_string(s2)
        );
        let state = Self {
            state_string,
            s0_bits: F64Bits::from_f64(s0),
            s1_bits: F64Bits::from_f64(s1),
            s2_bits: F64Bits::from_f64(s2),
            carry,
        };
        state.validate()?;
        Ok(state)
    }

    /// Strictly parses a canonical Phaser public state string.
    pub fn from_state_string(state_string: &str) -> Result<Self, RngError> {
        let mut fields = state_string.split(',');
        if fields.next() != Some("!rnd") {
            return Err(RngError::InvalidStateString);
        }
        let carry = parse_canonical_u32(fields.next())?;
        let s0 = parse_f64_component(fields.next())?;
        let s1 = parse_f64_component(fields.next())?;
        let s2 = parse_f64_component(fields.next())?;
        if fields.next().is_some() {
            return Err(RngError::InvalidStateString);
        }

        let state = Self::from_values(carry, s0, s1, s2)?;
        if state.state_string != state_string {
            return Err(RngError::InvalidStateString);
        }
        Ok(state)
    }

    /// Revalidates exact bits and the canonical diagnostic string.
    pub fn validate(&self) -> Result<(), RngError> {
        let s0 = self.s0_bits.to_f64();
        let s1 = self.s1_bits.to_f64();
        let s2 = self.s2_bits.to_f64();
        validate_state_component("s0", s0)?;
        validate_state_component("s1", s1)?;
        validate_state_component("s2", s2)?;

        let expected = format!(
            "!rnd,{},{},{},{}",
            self.carry,
            js_number_to_string(s0),
            js_number_to_string(s1),
            js_number_to_string(s2)
        );
        if self.state_string != expected {
            return Err(RngError::StateStringMismatch);
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for PhaserRdgState {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct RawState {
            state_string: String,
            s0_bits: F64Bits,
            s1_bits: F64Bits,
            s2_bits: F64Bits,
            carry: u32,
        }

        let raw = RawState::deserialize(deserializer)?;
        let state = Self {
            state_string: raw.state_string,
            s0_bits: raw.s0_bits,
            s1_bits: raw.s1_bits,
            s2_bits: raw.s2_bits,
            carry: raw.carry,
        };
        state.validate().map_err(serde::de::Error::custom)?;
        Ok(state)
    }
}

/// Canonical run-owned random generator state.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunRngState {
    pub rdg: PhaserRdgState,
}

/// Phaser 3.90.0's seeded random data generator.
#[derive(Clone, Debug, PartialEq)]
pub struct PhaserRdg {
    carry: u32,
    s0: f64,
    s1: f64,
    s2: f64,
    // Phaser's sow/hash accumulator. It is deliberately not canonical state.
    n: f64,
}

impl PhaserRdg {
    /// Sows one M3 string seed exactly as Phaser's `sow([seed])` does.
    pub fn from_seed(seed: &str) -> Self {
        Self::from_seeds(&[seed])
    }

    /// Sows an ordered string-seed array exactly as Phaser does.
    pub fn from_seeds<S: AsRef<str>>(seeds: &[S]) -> Self {
        let mut generator = Self {
            carry: 1,
            s0: 0.0,
            s1: 0.0,
            s2: 0.0,
            n: 0.0,
        };
        generator.sow(seeds);
        generator
    }

    /// Restores the four canonical draw fields. Phaser's private `n` is excluded.
    pub fn from_state(state: &PhaserRdgState) -> Result<Self, RngError> {
        state.validate()?;
        Ok(Self {
            carry: state.carry,
            s0: state.s0_bits.to_f64(),
            s1: state.s1_bits.to_f64(),
            s2: state.s2_bits.to_f64(),
            n: 0.0,
        })
    }

    /// Returns the exact canonical state used at material and snapshot boundaries.
    pub fn state(&self) -> PhaserRdgState {
        PhaserRdgState {
            state_string: format!(
                "!rnd,{},{},{},{}",
                self.carry,
                js_number_to_string(self.s0),
                js_number_to_string(self.s1),
                js_number_to_string(self.s2)
            ),
            s0_bits: F64Bits::from_f64(self.s0),
            s1_bits: F64Bits::from_f64(self.s1),
            s2_bits: F64Bits::from_f64(self.s2),
            carry: self.carry,
        }
    }

    /// Installs canonical draw state while retaining Phaser's private hash accumulator.
    pub fn set_state(&mut self, state: &PhaserRdgState) -> Result<(), RngError> {
        state.validate()?;
        self.carry = state.carry;
        self.s0 = state.s0_bits.to_f64();
        self.s1 = state.s1_bits.to_f64();
        self.s2 = state.s2_bits.to_f64();
        Ok(())
    }

    /// Resets and hashes an ordered M3 string-seed array.
    pub fn sow<S: AsRef<str>>(&mut self, seeds: &[S]) {
        self.n = f64::from(0xefc8_249d_u32);
        self.s0 = self.hash(" ");
        self.s1 = self.hash(" ");
        self.s2 = self.hash(" ");
        self.carry = 1;

        for seed in seeds {
            let seed = seed.as_ref();
            let s0_hash = self.hash(seed);
            self.s0 -= s0_hash;
            if self.s0 < 0.0 {
                self.s0 += 1.0;
            }
            let s1_hash = self.hash(seed);
            self.s1 -= s1_hash;
            if self.s1 < 0.0 {
                self.s1 += 1.0;
            }
            let s2_hash = self.hash(seed);
            self.s2 -= s2_hash;
            if self.s2 < 0.0 {
                self.s2 += 1.0;
            }
        }
    }

    /// Executes one exact Phaser primitive transition.
    pub fn rnd(&mut self) -> f64 {
        let state_product = PHASER_MULTIPLIER * self.s0;
        let carry_product = f64::from(self.carry) * TWO_POW_NEGATIVE_32;
        let t = state_product + carry_product;
        let next_carry = js_to_int32(t);

        self.carry = next_carry as u32;
        self.s0 = self.s1;
        self.s1 = self.s2;
        self.s2 = t - f64::from(next_carry);
        self.s2
    }

    /// Returns Phaser's uncoerced binary64 `rnd() * 0x100000000` result.
    pub fn integer(&mut self) -> f64 {
        self.rnd() * TWO_POW_32
    }

    /// Converts `integer()` only after the contract's exact u32 checks.
    pub fn integer_u32_exact(&mut self) -> Result<u32, RngError> {
        let mut staged = self.clone();
        let value = staged.integer();
        if !value.is_finite()
            || value.fract() != 0.0
            || !(0.0..=f64::from(u32::MAX)).contains(&value)
        {
            return Err(RngError::IntegerNotExactU32 {
                bits: value.to_bits(),
            });
        }
        let integer = value as u32;
        if f64::from(integer).to_bits() != value.to_bits() {
            return Err(RngError::IntegerNotExactU32 {
                bits: value.to_bits(),
            });
        }
        *self = staged;
        Ok(integer)
    }

    /// Returns Phaser's exact 53-bit fraction expression using two primitive draws.
    pub fn frac(&mut self) -> f64 {
        let first = self.rnd();
        let second = self.rnd();
        let widened = second * PHASER_FRAC_MULTIPLIER;
        let coerced = js_to_int32(widened);
        let low_term = f64::from(coerced) * TWO_POW_NEGATIVE_53;
        first + low_term
    }

    /// Executes Phaser's literal `frac() * (max - min) + min` evaluation.
    pub fn real_in_range(&mut self, minimum: f64, maximum: f64) -> Result<f64, RngError> {
        if !minimum.is_finite() || !maximum.is_finite() || maximum < minimum {
            return Err(RngError::InvalidRange {
                minimum: 0,
                maximum: 0,
            });
        }
        let span = maximum - minimum;
        if !span.is_finite() {
            return Err(RngError::RangeOverflow);
        }
        let mut staged = self.clone();
        let scaled = staged.frac() * span;
        let result = scaled + minimum;
        if !result.is_finite() {
            return Err(RngError::RangeOverflow);
        }
        *self = staged;
        Ok(result)
    }

    /// Executes Phaser's inclusive two-primitive-call integer range operation.
    pub fn integer_in_range(
        &mut self,
        minimum: SafeU53,
        maximum: SafeU53,
    ) -> Result<SafeU53, RngError> {
        if minimum > maximum {
            return Err(RngError::InvalidRange {
                minimum: minimum.get(),
                maximum: maximum.get(),
            });
        }
        let inclusive_width = maximum
            .get()
            .checked_sub(minimum.get())
            .and_then(|difference| difference.checked_add(1))
            .ok_or(RngError::RangeOverflow)?;
        SafeU53::new(inclusive_width).map_err(|_| RngError::RangeOverflow)?;

        let mut staged = self.clone();
        let minimum_number = minimum.get() as f64;
        let maximum_number = maximum.get() as f64;
        let difference = maximum_number - minimum_number;
        let width = difference + 1.0;
        let ranged = staged.real_in_range(0.0, width)?;
        let shifted = ranged + minimum_number;
        let result = shifted.floor();
        if !result.is_finite()
            || result.fract() != 0.0
            || !(0.0..=SafeU53::MAX.get() as f64).contains(&result)
        {
            return Err(RngError::RangeOverflow);
        }
        let result = SafeU53::new(result as u64).map_err(|_| RngError::RangeOverflow)?;
        *self = staged;
        Ok(result)
    }

    /// Implements the oracle `randSeedInt(cardinality, minimum)` wrapper.
    pub fn rand_seed_int(
        &mut self,
        cardinality: SafeU53,
        minimum: SafeU53,
    ) -> Result<SafeU53, RngError> {
        if cardinality.get() <= 1 {
            return Ok(minimum);
        }
        let maximum = checked_range_max(minimum, cardinality)?;
        self.integer_in_range(minimum, maximum)
    }

    /// Returns a selected zero-based index, with the M3 length-one fast path.
    pub fn pick_index(&mut self, length: usize) -> Result<usize, RngError> {
        if length == 0 {
            return Err(RngError::EmptyPick);
        }
        if length == 1 {
            return Ok(0);
        }
        let maximum = safe_from_usize(length - 1)?;
        let index = self.integer_in_range(SafeU53::ZERO, maximum)?;
        usize::try_from(index.get()).map_err(|_| RngError::SliceTooLong)
    }

    /// Returns a selected value using the exact selected-slice pick semantics.
    pub fn pick<'a, T>(&mut self, values: &'a [T]) -> Result<&'a T, RngError> {
        let index = self.pick_index(values.len())?;
        values.get(index).ok_or(RngError::RangeOverflow)
    }

    /// Applies descending Fisher-Yates with one inclusive range draw per swap.
    pub fn shuffle<T: Clone>(&mut self, values: &mut [T]) -> Result<(), RngError> {
        if values.len() > 1 {
            safe_from_usize(values.len())?;
        }
        let mut staged_generator = self.clone();
        let mut staged_values = values.to_vec();
        for index in (1..staged_values.len()).rev() {
            let maximum = safe_from_usize(index)?;
            let selected = staged_generator.integer_in_range(SafeU53::ZERO, maximum)?;
            let selected = usize::try_from(selected.get()).map_err(|_| RngError::SliceTooLong)?;
            staged_values.swap(index, selected);
        }
        *self = staged_generator;
        values.clone_from_slice(&staged_values);
        Ok(())
    }

    fn hash(&mut self, data: &str) -> f64 {
        let mut n = self.n;
        for code_unit in data.encode_utf16() {
            n += f64::from(code_unit);
            let mut h = HASH_MULTIPLIER * n;
            n = f64::from(js_to_int32(h));
            h -= n;
            h *= n;
            n = f64::from(js_to_int32(h));
            h -= n;
            n += h * TWO_POW_32;
        }
        self.n = n;
        f64::from(js_to_int32(n)) * TWO_POW_NEGATIVE_32
    }
}

/// Applies JavaScript `String.fromCharCode(charCodeAt(i) + shift)` by UTF-16 unit.
pub fn shift_char_codes(value: &str, shift: i64) -> Result<String, RngError> {
    let shifted = value
        .encode_utf16()
        .map(|code_unit| {
            let sum = i128::from(code_unit) + i128::from(shift);
            sum.rem_euclid(65_536) as u16
        })
        .collect::<Vec<_>>();
    String::from_utf16(&shifted).map_err(|_| RngError::UnpairedShiftedSurrogate)
}

pub(crate) fn checked_range_max(
    minimum: SafeU53,
    cardinality: SafeU53,
) -> Result<SafeU53, RngError> {
    if cardinality.get() <= 1 {
        return Ok(minimum);
    }
    let maximum = minimum
        .get()
        .checked_add(cardinality.get() - 1)
        .ok_or(RngError::RangeOverflow)?;
    SafeU53::new(maximum).map_err(|_| RngError::RangeOverflow)
}

pub(crate) fn safe_from_usize(value: usize) -> Result<SafeU53, RngError> {
    let value = u64::try_from(value).map_err(|_| RngError::SliceTooLong)?;
    SafeU53::new(value).map_err(|_| RngError::SliceTooLong)
}

fn validate_state_component(component: &'static str, value: f64) -> Result<(), RngError> {
    if !value.is_finite()
        || !(0.0..1.0).contains(&value)
        || (value == 0.0 && value.is_sign_negative())
    {
        return Err(RngError::InvalidStateComponent { component });
    }
    Ok(())
}

fn parse_canonical_u32(value: Option<&str>) -> Result<u32, RngError> {
    let value = value.ok_or(RngError::InvalidStateString)?;
    let parsed = value
        .parse::<u32>()
        .map_err(|_| RngError::InvalidStateString)?;
    if parsed.to_string() != value {
        return Err(RngError::InvalidStateString);
    }
    Ok(parsed)
}

fn parse_f64_component(value: Option<&str>) -> Result<f64, RngError> {
    let value = value.ok_or(RngError::InvalidStateString)?;
    value
        .parse::<f64>()
        .map_err(|_| RngError::InvalidStateString)
}

fn js_to_int32(value: f64) -> i32 {
    if !value.is_finite() || value == 0.0 {
        return 0;
    }
    let mut modulo = value.trunc() % TWO_POW_32;
    if modulo < 0.0 {
        modulo += TWO_POW_32;
    }
    if modulo >= TWO_POW_31 {
        (modulo - TWO_POW_32) as i32
    } else {
        modulo as i32
    }
}

fn js_number_to_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value == f64::INFINITY {
        return "Infinity".to_owned();
    }
    if value == f64::NEG_INFINITY {
        return "-Infinity".to_owned();
    }
    if value == 0.0 {
        return "0".to_owned();
    }

    let negative = value.is_sign_negative();
    let source = value.abs().to_string();
    let (mantissa, explicit_exponent) = split_decimal_exponent(&source);
    let decimal_position = mantissa.find('.').unwrap_or(mantissa.len()) as i32;
    let mut digits = mantissa
        .bytes()
        .filter(|byte| *byte != b'.')
        .map(char::from)
        .collect::<String>();
    let leading_zeros = digits.bytes().take_while(|byte| *byte == b'0').count();
    if leading_zeros > 0 {
        digits.drain(..leading_zeros);
    }
    while digits.len() > 1 && digits.ends_with('0') {
        digits.pop();
    }

    let n = decimal_position - leading_zeros as i32 + explicit_exponent;
    let k = digits.len() as i32;
    let mut rendered = String::new();
    if k <= n && n <= 21 {
        rendered.push_str(&digits);
        for _ in 0..(n - k) {
            rendered.push('0');
        }
    } else if 0 < n && n <= 21 {
        let split = n as usize;
        rendered.push_str(&digits[..split]);
        rendered.push('.');
        rendered.push_str(&digits[split..]);
    } else if -6 < n && n <= 0 {
        rendered.push_str("0.");
        for _ in 0..-n {
            rendered.push('0');
        }
        rendered.push_str(&digits);
    } else {
        let exponent = n - 1;
        rendered.push(char::from(digits.as_bytes()[0]));
        if digits.len() > 1 {
            rendered.push('.');
            rendered.push_str(&digits[1..]);
        }
        rendered.push('e');
        if exponent >= 0 {
            rendered.push('+');
        }
        rendered.push_str(&exponent.to_string());
    }

    if negative {
        rendered.insert(0, '-');
    }
    rendered
}

fn split_decimal_exponent(source: &str) -> (&str, i32) {
    let Some(index) = source.find(['e', 'E']) else {
        return (source, 0);
    };
    let mantissa = &source[..index];
    let exponent = &source[index + 1..];
    let (negative, digits) = if let Some(digits) = exponent.strip_prefix('-') {
        (true, digits)
    } else if let Some(digits) = exponent.strip_prefix('+') {
        (false, digits)
    } else {
        (false, exponent)
    };
    let magnitude = digits.bytes().fold(0_i32, |value, byte| {
        if byte.is_ascii_digit() {
            value.saturating_mul(10) + i32::from(byte - b'0')
        } else {
            value
        }
    });
    (mantissa, if negative { -magnitude } else { magnitude })
}

#[cfg(test)]
mod tests {
    use super::{PhaserRdg, PhaserRdgState};

    #[test]
    fn hash_uses_signed_to_int32_for_final_and_intermediate_accumulators() {
        // Independent literal-ECMAScript vectors. The paired unsigned mutation
        // produces the hard-coded alternatives asserted below.
        let mut final_coercion = PhaserRdg::from_seed("unused");
        final_coercion.n = 4_022_871_197.0;
        let final_result = final_coercion.hash(" ");
        assert_eq!(final_result.to_bits(), 0xbfc1_7e70_1700_0000);
        assert_ne!(final_result.to_bits(), 0x3feb_a063_fa40_0000);
        assert_eq!(final_coercion.n.to_bits(), 0x41eb_a063_fa40_0000);

        let mut intermediate_coercions = PhaserRdg::from_seed("unused");
        intermediate_coercions.n = 100_000_000_000.0;
        let intermediate_result = intermediate_coercions.hash("A");
        assert_eq!(intermediate_result.to_bits(), 0x0000_0000_0000_0000);
        assert_eq!(intermediate_coercions.n.to_bits(), 0xc5da_7479_eb00_0000);
        assert_ne!(intermediate_result.to_bits(), 0x3fe2_8187_47a0_0000);
        assert_ne!(intermediate_coercions.n.to_bits(), 0x41e2_8187_47a0_0000);
    }

    #[test]
    fn rnd_never_mutates_the_private_seed_hash_accumulator() {
        let mut generator = PhaserRdg::from_seed("n-is-sow-only");
        let before = generator.n.to_bits();
        for _ in 0..32 {
            let _ = generator.rnd();
            assert_eq!(generator.n.to_bits(), before);
        }
    }

    #[test]
    fn sow_resets_the_private_hash_accumulator_before_reseeding() {
        let mut reused = PhaserRdg::from_seed("first-seed");
        reused.sow(&["second-seed"]);
        let fresh = PhaserRdg::from_seed("second-seed");
        assert_eq!(reused.state(), fresh.state());
        assert_eq!(reused.n.to_bits(), fresh.n.to_bits());
    }

    #[test]
    fn state_setter_preserves_private_seed_hash_accumulator() -> Result<(), super::RngError> {
        let mut generator = PhaserRdg::from_seed("preserve-n");
        let before = generator.n.to_bits();
        let state = PhaserRdgState::from_values(0, 0.25, 0.5, 0.75)?;
        generator.set_state(&state)?;
        assert_eq!(generator.n.to_bits(), before);
        Ok(())
    }
}
