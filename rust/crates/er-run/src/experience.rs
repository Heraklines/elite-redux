//! Exact ER level-experience curve, ported verbatim from `src/data/exp.ts`.
//!
//! Parity rules (`rust/contracts/m4-js-number-rng.md` arithmetic discipline):
//! - Levels below 100 read the frozen per-curve table at `curve[level - 1]`.
//!   Every non-`MEDIUM_FAST` curve blends against the `MEDIUM_FAST` table with
//!   JavaScript `Number` semantics and converts to an integer at the single
//!   oracle rounding point: `floor(table * 0.325 + medium_fast * 0.675)`.
//! - Levels at or above 100 use the closed polynomial for the curve, blended
//!   identically. No algebraic simplification, no `mul_add`, no fast-math.

use crate::content::GrowthRateKind;

/// TypeScript `GrowthRate` discriminants (`ERRATIC = 0`, ..., `FLUCTUATING = 5`).
mod curve {
    pub const ERRATIC: usize = 0;
    pub const FAST: usize = 1;
    pub const MEDIUM_FAST: usize = 2;
    pub const MEDIUM_SLOW: usize = 3;
    pub const SLOW: usize = 4;
    pub const FLUCTUATING: usize = 5;
}

/// Frozen table rows for levels 1..=99, indexed `[curve][level - 1]` exactly
/// as `src/data/exp.ts` declares them.
const EXP_LEVELS: [[u32; 100]; 6] = [
    // ERRATIC
    [
        0, 15, 52, 122, 237, 406, 637, 942, 1326, 1800, 2369, 3041, 3822, 4719, 5737, 6881, 8155,
        9564, 11111, 12800, 14632, 16610, 18737, 21012, 23437, 26012, 28737, 31610, 34632, 37800,
        41111, 44564, 48155, 51881, 55737, 59719, 63822, 68041, 72369, 76800, 81326, 85942, 90637,
        95406, 100237, 105122, 110052, 115015, 120001, 125000, 131324, 137795, 144410, 151165,
        158056, 165079, 172229, 179503, 186894, 194400, 202013, 209728, 217540, 225443, 233431,
        241496, 249633, 257834, 267406, 276458, 286328, 296358, 305767, 316074, 326531, 336255,
        346965, 357812, 367807, 378880, 390077, 400293, 411686, 423190, 433572, 445239, 457001,
        467489, 479378, 491346, 501878, 513934, 526049, 536557, 548720, 560922, 571333, 583539,
        591882, 600000,
    ],
    // FAST
    [
        0, 6, 21, 51, 100, 172, 274, 409, 583, 800, 1064, 1382, 1757, 2195, 2700, 3276, 3930, 4665,
        5487, 6400, 7408, 8518, 9733, 11059, 12500, 14060, 15746, 17561, 19511, 21600, 23832,
        26214, 28749, 31443, 34300, 37324, 40522, 43897, 47455, 51200, 55136, 59270, 63605, 68147,
        72900, 77868, 83058, 88473, 94119, 100000, 106120, 112486, 119101, 125971, 133100, 140492,
        148154, 156089, 164303, 172800, 181584, 190662, 200037, 209715, 219700, 229996, 240610,
        251545, 262807, 274400, 286328, 298598, 311213, 324179, 337500, 351180, 365226, 379641,
        394431, 409600, 425152, 441094, 457429, 474163, 491300, 508844, 526802, 545177, 563975,
        583200, 602856, 622950, 643485, 664467, 685900, 707788, 730138, 752953, 776239, 800000,
    ],
    // MEDIUM_FAST
    [
        0, 8, 27, 64, 125, 216, 343, 512, 729, 1000, 1331, 1728, 2197, 2744, 3375, 4096, 4913,
        5832, 6859, 8000, 9261, 10648, 12167, 13824, 15625, 17576, 19683, 21952, 24389, 27000,
        29791, 32768, 35937, 39304, 42875, 46656, 50653, 54872, 59319, 64000, 68921, 74088, 79507,
        85184, 91125, 97336, 103823, 110592, 117649, 125000, 132651, 140608, 148877, 157464,
        166375, 175616, 185193, 195112, 205379, 216000, 226981, 238328, 250047, 262144, 274625,
        287496, 300763, 314432, 328509, 343000, 357911, 373248, 389017, 405224, 421875, 438976,
        456533, 474552, 493039, 512000, 531441, 551368, 571787, 592704, 614125, 636056, 658503,
        681472, 704969, 729000, 753571, 778688, 804357, 830584, 857375, 884736, 912673, 941192,
        970299, 1000000,
    ],
    // MEDIUM_SLOW
    [
        0, 9, 57, 96, 135, 179, 236, 314, 419, 560, 742, 973, 1261, 1612, 2035, 2535, 3120, 3798,
        4575, 5460, 6458, 7577, 8825, 10208, 11735, 13411, 15244, 17242, 19411, 21760, 24294,
        27021, 29949, 33084, 36435, 40007, 43808, 47846, 52127, 56660, 61450, 66505, 71833, 77440,
        83335, 89523, 96012, 102810, 109923, 117360, 125126, 133229, 141677, 150476, 159635,
        169159, 179056, 189334, 199999, 211060, 222522, 234393, 246681, 259392, 272535, 286115,
        300140, 314618, 329555, 344960, 360838, 377197, 394045, 411388, 429235, 447591, 466464,
        485862, 505791, 526260, 547274, 568841, 590969, 613664, 636935, 660787, 685228, 710266,
        735907, 762160, 789030, 816525, 844653, 873420, 902835, 932903, 963632, 995030, 1027103,
        1059860,
    ],
    // SLOW
    [
        0, 10, 33, 80, 156, 270, 428, 640, 911, 1250, 1663, 2160, 2746, 3430, 4218, 5120, 6141,
        7290, 8573, 10000, 11576, 13310, 15208, 17280, 19531, 21970, 24603, 27440, 30486, 33750,
        37238, 40960, 44921, 49130, 53593, 58320, 63316, 68590, 74148, 80000, 86151, 92610, 99383,
        106480, 113906, 121670, 129778, 138240, 147061, 156250, 165813, 175760, 186096, 196830,
        207968, 219520, 231491, 243890, 256723, 270000, 283726, 297910, 312558, 327680, 343281,
        359370, 375953, 393040, 410636, 428750, 447388, 466560, 486271, 506530, 527343, 548720,
        570666, 593190, 616298, 640000, 664301, 689210, 714733, 740880, 767656, 795070, 823128,
        851840, 881211, 911250, 941963, 973360, 1005446, 1038230, 1071718, 1105920, 1140841,
        1176490, 1212873, 1250000,
    ],
    // FLUCTUATING
    [
        0, 4, 13, 32, 65, 112, 178, 276, 393, 540, 745, 967, 1230, 1591, 1957, 2457, 3046, 3732,
        4526, 5440, 6482, 7666, 9003, 10506, 12187, 14060, 16140, 18439, 20974, 23760, 26811,
        30146, 33780, 37731, 42017, 46656, 50653, 55969, 60505, 66560, 71677, 78533, 84277, 91998,
        98415, 107069, 114205, 123863, 131766, 142500, 151222, 163105, 172697, 185807, 196322,
        210739, 222231, 238036, 250562, 267840, 281456, 300293, 315059, 335544, 351520, 373744,
        390991, 415050, 433631, 459620, 479600, 507617, 529063, 559209, 582187, 614566, 639146,
        673863, 700115, 737280, 765275, 804997, 834809, 877201, 908905, 954084, 987754, 1035837,
        1071552, 1122660, 1160499, 1214753, 1254796, 1312322, 1354652, 1415577, 1460276, 1524731,
        1571884, 1640000,
    ],
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LevelExpError {
    LevelOutsideSupportedRange,
    UnsupportedCurve,
}

/// Total experience required to reach `level` under one of the six TypeScript
/// curves identified by its `GrowthRate` discriminant. `level` must be within
/// `1..=200`; the oracle tables cover `1..=99` and the closed polynomials
/// extend beyond. Returns the exact integer the pinned TypeScript produces.
pub(crate) fn total_exp_at_level(level: u16, curve: usize) -> Option<u64> {
    if !(1..=200).contains(&level) || curve > curve::FLUCTUATING {
        return None;
    }
    let level = u32::from(level);
    if level < 100 {
        let table = EXP_LEVELS[curve][(level - 1) as usize];
        if curve == curve::MEDIUM_FAST {
            return Some(u64::from(table));
        }
        let medium_fast = EXP_LEVELS[curve::MEDIUM_FAST][(level - 1) as usize];
        return Some(blend(u64::from(table), u64::from(medium_fast)));
    }
    let base = closed_form(level, curve)?;
    if curve == curve::MEDIUM_FAST {
        return Some(base);
    }
    let medium_fast = closed_form(level, curve::MEDIUM_FAST)?;
    Some(blend(base, medium_fast))
}

/// The single oracle rounding point shared by every non-`MEDIUM_FAST` curve.
fn blend(curve_value: u64, medium_fast_value: u64) -> u64 {
    let curve_f64 = f64::from(u32::try_from(curve_value).unwrap_or(u32::MAX));
    let medium_fast_f64 = f64::from(u32::try_from(medium_fast_value).unwrap_or(u32::MAX));
    (curve_f64 * 0.325 + medium_fast_f64 * 0.675).floor() as u64
}

/// Closed polynomials for levels at or above 100, mirroring the TypeScript
/// `switch` exactly (including the integer-valued `MEDIUM_FAST` case).
fn closed_form(level: u32, curve: usize) -> Option<u64> {
    let n = f64::from(level);
    let ret = match curve {
        curve::ERRATIC => (n.powi(4) + n.powi(3) * 2000.0) / 3500.0,
        curve::FAST => (n.powi(3) * 4.0) / 5.0,
        curve::MEDIUM_FAST => n.powi(3),
        curve::MEDIUM_SLOW => (n.powi(3) * 6.0) / 5.0 - 15.0 * n * n + 100.0 * n - 140.0,
        curve::SLOW => (n.powi(3) * 5.0) / 4.0,
        curve::FLUCTUATING => (n.powi(3) * (n / 2.0 + 8.0) * 4.0) / (100.0 + n),
        _ => return None,
    };
    Some(ret.floor() as u64)
}

/// The selected-slice entry point: map a content-declared growth rate onto its
/// TypeScript curve and produce the exact threshold for `level`.
pub fn level_total_exp(level: u16, growth_rate: &GrowthRateKind) -> Result<u64, LevelExpError> {
    match growth_rate {
        GrowthRateKind::MediumFast => total_exp_at_level(level, curve::MEDIUM_FAST)
            .ok_or(LevelExpError::LevelOutsideSupportedRange),
        GrowthRateKind::MediumSlow => total_exp_at_level(level, curve::MEDIUM_SLOW)
            .ok_or(LevelExpError::LevelOutsideSupportedRange),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parity_vector_matches_published_oracle_thresholds() {
        // Published fixture progression/nacli-medium-slow-level-17-v1.json:
        // the level-17 cap threshold is 4330 and the pre-award experience
        // 4329 sits exactly one point below it on the MEDIUM_SLOW curve.
        assert_eq!(total_exp_at_level(16, curve::MEDIUM_SLOW), Some(3588));
        assert_eq!(total_exp_at_level(17, curve::MEDIUM_SLOW), Some(4330));
        assert_eq!(level_total_exp(17, &GrowthRateKind::MediumSlow), Ok(4330));
    }

    #[test]
    fn medium_fast_is_never_blended() {
        assert_eq!(total_exp_at_level(50, curve::MEDIUM_FAST), Some(125_000));
        assert_eq!(total_exp_at_level(100, curve::MEDIUM_FAST), Some(1_000_000));
    }

    #[test]
    fn closed_polynomials_extend_past_the_tables() {
        let expected = ((100f64.powi(3) * 6.0 / 5.0 - 15.0 * 100.0 * 100.0 + 100.0 * 100.0 - 140.0)
            .floor()
            * 0.325
            + 1_000_000_f64 * 0.675)
            .floor() as u64;
        assert_eq!(total_exp_at_level(100, curve::MEDIUM_SLOW), Some(expected));
        assert_eq!(total_exp_at_level(0, curve::MEDIUM_SLOW), None);
        assert_eq!(total_exp_at_level(201, curve::MEDIUM_SLOW), None);
    }
}
