//! Pinned standard-profile attack scoring for ordinary integer damage and HP.
//!
//! This pure numeric operation is separate from profile activation, move legality,
//! ability knowledge, target selection, and RNG. Callers must supply actual
//! simulated damage; base power is not a damage estimate for this function.

/// Mirrors `damageToScore` at oracle 399d5d368f0b5642ebf8f45bd8a5e73350fa4de7.
///
/// The operation order deliberately matches JavaScript binary64 arithmetic.
/// A nonpositive accuracy denotes always-hit, and accuracy above 100 is capped.
/// This function neither selects a move nor enables the enhanced AI profile.
pub fn standard_attack_score(damage: u32, max_hp: u32, hp: u32, accuracy: i16) -> f64 {
    if damage == 0 {
        return 0.0;
    }
    let accuracy_factor = f64::from(if accuracy <= 0 {
        100
    } else {
        accuracy.min(100)
    }) / 100.0;
    let fraction = f64::from(damage) / f64::from(max_hp.max(1));
    let mut score = fraction * 75.0 * accuracy_factor;
    if damage >= hp {
        score += 1000.0 * accuracy_factor;
    }
    score
}
