//! Retained first-unlock requests; no inferred historical account completion.
use crate::current_experience_settlement::CurrentLevelUpV1;
use er_types::{PlatformRequestId, SafeU53};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
pub enum CurrentAchievementKeyV1 {
    #[serde(rename = "LV_100")]
    Level100,
    #[serde(rename = "LV_250")]
    Level250,
    #[serde(rename = "LV_1000")]
    Level1000,
    #[serde(rename = "REALISTIC_FLASH_IS_BORING")]
    RealisticFlash,
}

impl CurrentAchievementKeyV1 {
    pub fn level_keys(level: u16) -> Vec<Self> {
        [
            (100, Self::Level100),
            (250, Self::Level250),
            (1000, Self::Level1000),
        ]
        .into_iter()
        .filter_map(|(threshold, key)| (level >= threshold).then_some(key))
        .collect()
    }

    pub fn level_candy(self) -> Option<u8> {
        match self {
            Self::Level100 => Some(10),
            Self::Level250 => Some(20),
            Self::Level1000 => Some(30),
            Self::RealisticFlash => None, // Egg must execute before Flash's candy.
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentAchievementUnlockV1 {
    pub achievement: CurrentAchievementKeyV1,
    /// Presence, including zero, implements Object.hasOwn(achvUnlocks, key).
    pub utc_milliseconds: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentAchievementClockRequestV1 {
    pub request: PlatformRequestId,
    pub pending: SafeU53,
    pub achievement: CurrentAchievementKeyV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentLevelAchievementExecutionV1 {
    pub level_up: CurrentLevelUpV1,
    /// Full reached LevelAchv set in source declaration order.
    pub achievements: Vec<CurrentAchievementKeyV1>,
    pub next: u8,
    pub clock: Option<CurrentAchievementClockRequestV1>,
}

impl CurrentLevelAchievementExecutionV1 {
    pub fn valid(&self, pending: SafeU53) -> bool {
        self.level_up.award.phase.pending_id == pending
            && self.achievements == CurrentAchievementKeyV1::level_keys(self.level_up.new_level)
            && usize::from(self.next) <= self.achievements.len()
            && self.clock.is_none_or(|clock| {
                clock.request.get() != SafeU53::ZERO
                    && clock.pending == pending
                    && self.achievements.get(usize::from(self.next)) == Some(&clock.achievement)
            })
            && (usize::from(self.next) == self.achievements.len() || self.clock.is_some())
    }
}

/// External IEEE-754 bits preserve the actual Math.random Number without
/// assuming a platform's PRNG algorithm or substituting the battle RNG.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentUnseededUnitV1 {
    /// Canonical sixteen lowercase hexadecimal digits, most significant first.
    pub ieee754_bits: String,
}

impl CurrentUnseededUnitV1 {
    pub fn value(&self) -> Option<f64> {
        if self.ieee754_bits.len() != 16
            || !self
                .ieee754_bits
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return None;
        }
        let value = f64::from_bits(u64::from_str_radix(&self.ieee754_bits, 16).ok()?);
        (value.is_finite() && (0.0..1.0).contains(&value)).then_some(value)
    }
}

/// Source constructor order: randomString(24), solo randInt ID, then Date.now.
/// This is an input request contract, not an accepted or manufactured Egg.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentFlashEggInputsV1 {
    pub request: PlatformRequestId,
    pub pending: SafeU53,
    pub seed_draws: [CurrentUnseededUnitV1; 24],
    pub id_draw: CurrentUnseededUnitV1,
    pub egg_utc_milliseconds: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentFlashEggRequestV1 {
    pub request: PlatformRequestId,
    pub pending: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentFlashAchievementExecutionV1 {
    pub clock: Option<CurrentAchievementClockRequestV1>,
    pub egg_request: Option<CurrentFlashEggRequestV1>,
    pub unlocked_at: Option<i64>,
    pub completed_input: Option<CurrentFlashEggInputsV1>,
}

impl CurrentFlashAchievementExecutionV1 {
    pub fn valid(&self, pending: SafeU53) -> bool {
        match (
            &self.clock,
            &self.egg_request,
            self.unlocked_at,
            &self.completed_input,
        ) {
            (Some(clock), None, None, None) => {
                clock.pending == pending
                    && clock.request.get() != SafeU53::ZERO
                    && clock.achievement == CurrentAchievementKeyV1::RealisticFlash
            }
            (None, Some(request), Some(utc), None) => {
                request.pending == pending
                    && request.request.get() != SafeU53::ZERO
                    && (-8_640_000_000_000_000..=8_640_000_000_000_000).contains(&utc)
            }
            (None, None, Some(utc), Some(input)) => {
                input.pending == pending
                    && input.valid()
                    && (-8_640_000_000_000_000..=8_640_000_000_000_000).contains(&utc)
            }
            _ => false,
        }
    }
}

impl CurrentFlashEggInputsV1 {
    pub fn valid(&self) -> bool {
        self.request.get() != SafeU53::ZERO
            && self.pending != SafeU53::ZERO
            && self.seed_draws.iter().all(|draw| draw.value().is_some())
            && self.id_draw.value().is_some()
            && (-8_640_000_000_000_000..=8_640_000_000_000_000).contains(&self.egg_utc_milliseconds)
    }
}

/// A present empty value is the observed fresh achvUnlocks object. The optional
/// containing profile field must remain absent for historical unknown accounts.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentAchievementUnlocksV1 {
    pub rows: Vec<CurrentAchievementUnlockV1>,
}

impl CurrentAchievementUnlocksV1 {
    pub fn fresh() -> Self {
        Self { rows: Vec::new() }
    }

    pub fn valid(&self) -> bool {
        self.rows.len() <= 4
            && self.rows.iter().all(|row| {
                (-8_640_000_000_000_000..=8_640_000_000_000_000).contains(&row.utc_milliseconds)
            })
            && self
                .rows
                .windows(2)
                .all(|pair| pair[0].achievement < pair[1].achievement)
    }

    pub fn contains(&self, key: CurrentAchievementKeyV1) -> bool {
        self.rows.iter().any(|row| row.achievement == key)
    }

    /// Called only after the request's owned preimage was independently checked.
    /// Reject duplicates including timestamp zero; do not consume another clock.
    pub fn insert(&mut self, key: CurrentAchievementKeyV1, utc: i64) -> bool {
        if !self.valid() || !(-8_640_000_000_000_000..=8_640_000_000_000_000).contains(&utc) {
            return false;
        }
        let Err(index) = self.rows.binary_search_by_key(&key, |row| row.achievement) else {
            return false;
        };
        self.rows.insert(
            index,
            CurrentAchievementUnlockV1 {
                achievement: key,
                utc_milliseconds: utc,
            },
        );
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_achievement_thresholds_keep_source_declaration_order() {
        use CurrentAchievementKeyV1::{Level100, Level250, Level1000};
        assert!(CurrentAchievementKeyV1::level_keys(99).is_empty());
        assert_eq!(CurrentAchievementKeyV1::level_keys(100), [Level100]);
        assert_eq!(CurrentAchievementKeyV1::level_keys(249), [Level100]);
        assert_eq!(
            CurrentAchievementKeyV1::level_keys(250),
            [Level100, Level250]
        );
        assert_eq!(
            CurrentAchievementKeyV1::level_keys(999),
            [Level100, Level250]
        );
        assert_eq!(
            CurrentAchievementKeyV1::level_keys(1000),
            [Level100, Level250, Level1000]
        );
    }

    #[test]
    fn level_zero_unlock_and_invalid_date_preserve_account_atomically() {
        use CurrentAchievementKeyV1::{Level100, Level250};
        let mut unlocks = CurrentAchievementUnlocksV1::fresh();
        assert!(unlocks.insert(Level100, 0));
        assert!(unlocks.contains(Level100));
        let retained = unlocks.clone();
        assert!(!unlocks.insert(Level100, 123));
        assert_eq!(unlocks, retained);
        assert!(!unlocks.insert(Level250, 8_640_000_000_000_001));
        assert_eq!(unlocks, retained);
        assert!(unlocks.insert(Level250, -8_640_000_000_000_000));
        assert!(unlocks.valid());
        let bytes = serde_json::to_vec(&unlocks).expect("serialize typed unlock rows");
        let restored: CurrentAchievementUnlocksV1 =
            serde_json::from_slice(&bytes).expect("restore exact unlock rows");
        assert_eq!(restored, unlocks);
    }

    #[test]
    fn level_cursor_rejects_wrong_pending_key_and_missing_clock() {
        use crate::current_experience_settlement::{
            CurrentExperienceAwardV1, CurrentExperiencePhaseV1,
        };
        let id = SafeU53::new(1).expect("valid identity");
        let phase = CurrentExperiencePhaseV1 {
            pending_id: id,
            pokemon: er_types::battle_ids::PokemonId::new(id),
            party_index: 0,
            on_field: true,
            phase_argument: er_types::run_ids::Experience::new(id),
        };
        let level_up = CurrentLevelUpV1 {
            award: CurrentExperienceAwardV1 {
                phase,
                experience: er_types::run_ids::Experience::new(id),
                last_level: 99,
                last_experience: er_types::run_ids::Experience::new(id),
            },
            previous_level: 99,
            new_level: 100,
            previous_stats: er_types::battle_model::BattleStats {
                hp: 1,
                attack: 1,
                defense: 1,
                special_attack: 1,
                special_defense: 1,
                speed: 1,
            },
        };
        let mut cursor = CurrentLevelAchievementExecutionV1 {
            level_up,
            achievements: CurrentAchievementKeyV1::level_keys(100),
            next: 0,
            clock: Some(CurrentAchievementClockRequestV1 {
                request: PlatformRequestId::new(id),
                pending: id,
                achievement: CurrentAchievementKeyV1::Level100,
            }),
        };
        assert!(cursor.valid(id));
        assert!(!cursor.valid(SafeU53::new(2).expect("other identity")));
        cursor.clock.as_mut().expect("owned clock").achievement = CurrentAchievementKeyV1::Level250;
        assert!(!cursor.valid(id));
        cursor.clock = None;
        assert!(!cursor.valid(id));
        cursor.next = 1;
        assert!(cursor.valid(id));
    }
}
