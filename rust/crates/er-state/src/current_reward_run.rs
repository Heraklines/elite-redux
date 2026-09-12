//! Durable source399d reward inventory, separate from immutable battle/XP proof.
//! Attach only to positively established fresh ordinary source configuration.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentRewardRunV1 {
    /// PokeballType POKEBALL, GREAT, ULTRA, ROGUE, MASTER in source enum order.
    pub balls: [u8; 5],
    /// Source startup Map is real ownership despite the mechanical inventory's
    /// empty modifiers vector. Absence of this record is historical unknown.
    pub map_owned: bool,
    pub lures: Vec<CurrentRewardLureV1>,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentRewardLureV1 {
    pub duration: u8,
    pub remaining: u8,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CurrentRewardRunError {
    Invalid,
}
impl CurrentRewardRunV1 {
    /// BattleScene.reset initializes five ball counters then grants5 Pokeballs.
    /// Caller must have excluded source Overrides and established startup Map.
    pub fn fresh_ordinary_with_startup_map() -> Self {
        Self {
            balls: [5, 0, 0, 0, 0],
            map_owned: true,
            lures: Vec::new(),
        }
    }
    pub fn valid(&self) -> bool {
        self.balls.iter().all(|n| *n <= 99)
            && self.lures.len() <= 3
            && self.lures.iter().all(|l| {
                matches!(l.duration, 10 | 15 | 30) && l.remaining > 0 && l.remaining <= l.duration
            })
            && self.lures.iter().enumerate().all(|(i, l)| {
                self.lures[..i]
                    .iter()
                    .all(|earlier| earlier.duration != l.duration)
            })
    }
    /// Exact AddPokeballModifierType source counts and AddPokeballModifier cap.
    /// This returns source apply=true even when the counter is already capped.
    pub fn add_ball_reward(&mut self, ball_type: u8) -> Result<(), CurrentRewardRunError> {
        if !self.valid() || ball_type > 4 {
            return Err(CurrentRewardRunError::Invalid);
        }
        let count = if ball_type == 4 { 1 } else { 5 };
        let slot = &mut self.balls[usize::from(ball_type)];
        *slot = slot.saturating_add(count).min(99);
        Ok(())
    }
    /// LapsingPersistentModifier.add refreshes an existing matching duration,
    /// returns false if already fresh, and otherwise appends a new modifier.
    pub fn add_lure(&mut self, duration: u8) -> Result<bool, CurrentRewardRunError> {
        if !self.valid() || !matches!(duration, 10 | 15 | 30) {
            return Err(CurrentRewardRunError::Invalid);
        }
        if let Some(lure) = self.lures.iter_mut().find(|l| l.duration == duration) {
            if lure.remaining == lure.duration {
                return Ok(false);
            }
            lure.remaining = lure.duration;
        } else {
            self.lures.push(CurrentRewardLureV1 {
                duration,
                remaining: duration,
            });
        }
        Ok(true)
    }
    /// Invoke exactly at source BattleEnd's lapse operation, never when giving
    /// the current battle's reward. Next-wave double chance still needs source
    /// application and may remain outside the admitted one-versus-one boundary.
    pub fn lapse_lures(&mut self) -> Result<(), CurrentRewardRunError> {
        if !self.valid() {
            return Err(CurrentRewardRunError::Invalid);
        }
        for lure in &mut self.lures {
            lure.remaining -= 1;
        }
        self.lures.retain(|l| l.remaining > 0);
        Ok(())
    }
}
