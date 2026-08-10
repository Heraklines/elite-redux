//! Small JavaScript `Number` math primitives used by the battle oracle.
//!
//! These functions intentionally keep the JavaScript edge cases that matter
//! at a canonical boundary.  In particular, Rust's `round` is not the
//! ECMAScript `Math.round`, and signed zero is observable through the M3
//! number contract.

use er_types::JS_MAX_SAFE_INTEGER;
use thiserror::Error;

/// A value that could not cross the selected JavaScript-safe integer boundary.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum JsMathError {
    #[error("JavaScript integer conversion requires a finite Number")]
    NonFinite,
    #[error("JavaScript integer conversion requires an integral Number")]
    NonIntegral,
    #[error("JavaScript integer conversion exceeds the safe integer range")]
    OutsideSafeIntegerRange,
}

/// JavaScript `Math.floor`, including its identity behavior for NaN,
/// infinities, and signed zero.
pub fn js_floor(value: f64) -> f64 {
    if value.is_nan() || value.is_infinite() || value == 0.0 {
        value
    } else {
        value.floor()
    }
}

/// JavaScript `Math.ceil`, including its identity behavior for NaN,
/// infinities, and signed zero.
pub fn js_ceil(value: f64) -> f64 {
    if value.is_nan() || value.is_infinite() || value == 0.0 {
        value
    } else {
        value.ceil()
    }
}

/// JavaScript `Math.trunc`, including its identity behavior for NaN,
/// infinities, and signed zero.
pub fn js_trunc(value: f64) -> f64 {
    if value.is_nan() || value.is_infinite() || value == 0.0 {
        value
    } else {
        value.trunc()
    }
}

/// JavaScript `Math.round`.
///
/// ECMAScript rounds a half toward positive infinity.  Values in `[-0.5, 0)`
/// therefore produce negative zero, unlike Rust's half-away-from-zero
/// `f64::round`.
pub fn js_round(value: f64) -> f64 {
    if value.is_nan() || value.is_infinite() || value == 0.0 {
        return value;
    }
    if (-0.5..0.0).contains(&value) {
        return -0.0;
    }
    js_floor(value + 0.5)
}

/// JavaScript `Math.min` for two arguments.
pub fn js_min(left: f64, right: f64) -> f64 {
    if left.is_nan() {
        return left;
    }
    if right.is_nan() {
        return right;
    }
    if left < right {
        return left;
    }
    if right < left {
        return right;
    }
    if left == 0.0 {
        if left.is_sign_negative() || right.is_sign_negative() {
            return -0.0;
        }
        return 0.0;
    }
    left
}

/// JavaScript `Math.max` for two arguments.
pub fn js_max(left: f64, right: f64) -> f64 {
    if left.is_nan() {
        return left;
    }
    if right.is_nan() {
        return right;
    }
    if left > right {
        return left;
    }
    if right > left {
        return right;
    }
    if left == 0.0 {
        if left.is_sign_positive() || right.is_sign_positive() {
            return 0.0;
        }
        return -0.0;
    }
    left
}

/// Clamps a value with the ordinary JavaScript `min(max(value, lower), upper)`
/// operation order.
pub fn js_clamp(value: f64, lower: f64, upper: f64) -> f64 {
    js_min(js_max(value, lower), upper)
}

/// Converts an integral JavaScript `Number` to a signed safe integer.
///
/// The signed return is intentional: the helper is also used for Number
/// boundaries where negative values are valid.  Negative zero becomes integer
/// zero through the ordinary exact conversion.
pub fn safe_integer_from_f64(value: f64) -> Result<i64, JsMathError> {
    if !value.is_finite() {
        return Err(JsMathError::NonFinite);
    }
    if value.fract() != 0.0 {
        return Err(JsMathError::NonIntegral);
    }

    let limit = JS_MAX_SAFE_INTEGER as f64;
    if !(-limit..=limit).contains(&value) {
        return Err(JsMathError::OutsideSafeIntegerRange);
    }

    let integer = value as i64;
    if integer as f64 != value {
        return Err(JsMathError::OutsideSafeIntegerRange);
    }
    Ok(integer)
}
