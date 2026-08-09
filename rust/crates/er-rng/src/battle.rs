//! Atomic run, battle-substream, and seed-offset transactions.

use er_types::SafeU53;
use er_types::battle_ids::{TurnIndex, WaveIndex};
use serde::{Deserialize, Serialize};

use crate::audit::{
    RngAuditLog, RngAuditState, RngCallsiteId, RngDraw, RngDrawInput, RngPublicApi, RngReason,
    RngStream, SeedOffsetContext,
};
use crate::phaser::{
    PhaserRdg, PhaserRdgState, RngError, RunRngState, checked_range_max, safe_from_usize,
    shift_char_codes,
};

const BATTLE_SEED_ALPHABET: &[u8; 62] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/// Persisted battle seed, one-based turn, and current per-turn cached substream.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BattleRngState {
    pub battle_seed: String,
    pub turn: TurnIndex,
    pub saved_substream: Option<PhaserRdgState>,
}

impl BattleRngState {
    pub fn new(battle_seed: impl Into<String>, turn: TurnIndex) -> Self {
        Self {
            battle_seed: battle_seed.into(),
            turn,
            saved_substream: None,
        }
    }

    pub fn validate(&self) -> Result<(), RngError> {
        if let Some(saved_substream) = &self.saved_substream {
            saved_substream.validate()?;
        }
        Ok(())
    }

    /// Increments the public turn first, then clears the cached substream.
    pub fn increment_turn(&mut self) -> Result<(), RngError> {
        let next = self
            .turn
            .get()
            .get()
            .checked_add(1)
            .ok_or(RngError::TurnOverflow)?;
        let next = SafeU53::new(next).map_err(|_| RngError::TurnOverflow)?;
        self.turn = TurnIndex::new(next).map_err(|_| RngError::TurnOverflow)?;
        self.saved_substream = None;
        Ok(())
    }
}

/// Runtime owner for all three random streams and their single audit sequence.
#[derive(Clone, Debug, PartialEq)]
pub struct RngRuntime {
    run: PhaserRdg,
    battle: Option<BattleRngState>,
    seed_offset: Option<SeedOffsetContext>,
    seed_override: Option<String>,
    audit: RngAuditLog,
}

impl RngRuntime {
    /// Creates a runtime at audit sequence zero from canonical persisted states.
    pub fn from_states(run: RunRngState, battle: Option<BattleRngState>) -> Result<Self, RngError> {
        Self::from_states_at_sequence(run, battle, SafeU53::ZERO)
    }

    /// Restores canonical states with an explicit monotonic audit frontier.
    pub fn from_states_at_sequence(
        run: RunRngState,
        battle: Option<BattleRngState>,
        next_sequence: SafeU53,
    ) -> Result<Self, RngError> {
        if let Some(battle) = &battle {
            battle.validate()?;
        }
        Ok(Self {
            run: PhaserRdg::from_state(&run.rdg)?,
            battle,
            seed_offset: None,
            seed_override: None,
            audit: RngAuditLog::with_next_sequence(next_sequence),
        })
    }

    /// Creates a run stream by sowing exactly one string seed.
    pub fn from_run_seed(seed: &str) -> Self {
        Self {
            run: PhaserRdg::from_seed(seed),
            battle: None,
            seed_offset: None,
            seed_override: None,
            audit: RngAuditLog::new(),
        }
    }

    pub fn run_state(&self) -> RunRngState {
        RunRngState {
            rdg: self.run.state(),
        }
    }

    pub fn battle_state(&self) -> Option<&BattleRngState> {
        self.battle.as_ref()
    }

    pub fn seed_offset_context(&self) -> Option<&SeedOffsetContext> {
        self.seed_offset.as_ref()
    }

    pub fn seed_override(&self) -> Option<&str> {
        self.seed_override.as_deref()
    }

    pub fn audit_entries(&self) -> &[RngDraw] {
        self.audit.entries()
    }

    pub fn next_audit_sequence(&self) -> Option<SafeU53> {
        self.audit.next_sequence()
    }

    /// Installs an already-constructed canonical battle stream.
    pub fn install_battle_state(&mut self, battle: BattleRngState) -> Result<(), RngError> {
        if self.battle.is_some() {
            return Err(RngError::BattleStateAlreadyInstalled);
        }
        battle.validate()?;
        self.battle = Some(battle);
        Ok(())
    }

    /// Removes battle identity without changing the run stream or audit frontier.
    pub fn clear_battle_state(&mut self) {
        self.battle = None;
    }

    /// Reproduces battle construction's wave-offset scope and 16 seeded characters.
    pub fn initialize_battle(
        &mut self,
        wave_seed: &str,
        wave: WaveIndex,
    ) -> Result<BattleRngState, RngError> {
        if self.battle.is_some() {
            return Err(RngError::BattleStateAlreadyInstalled);
        }

        let offset = js_shift_left(u64::from(wave), 3);
        let offset = u64::try_from(offset).map_err(|_| RngError::UnsafeSeedOffset)?;
        let offset = SafeU53::new(offset).map_err(|_| RngError::UnsafeSeedOffset)?;
        let shift = i64::try_from(offset.get()).map_err(|_| RngError::UnsafeSeedOffset)?;
        let shifted_seed = shift_char_codes(wave_seed, shift)?;

        let mut staged = self.clone();
        let saved_run = staged.run.clone();
        let saved_offset = staged.seed_offset.clone();
        let saved_override = staged.seed_override.clone();
        staged.run = PhaserRdg::from_seed(&shifted_seed);
        staged.seed_offset = Some(SeedOffsetContext {
            wave_seed: wave_seed.to_owned(),
            offset,
        });
        staged.seed_override = Some(wave_seed.to_owned());

        let cardinality = safe_from_usize(BATTLE_SEED_ALPHABET.len())?;
        let mut battle_seed = String::with_capacity(16);
        for _ in 0..16 {
            let index = staged.draw_active_run(
                RngStream::SeedOffset,
                cardinality,
                SafeU53::ZERO,
                RngReason::BattleSeedCharacter,
                RngPublicApi::RandSeedInt,
                RngCallsiteId::battle_seed_character(),
                true,
            )?;
            let index = usize::try_from(index.get()).map_err(|_| RngError::SliceTooLong)?;
            let byte = BATTLE_SEED_ALPHABET
                .get(index)
                .copied()
                .ok_or(RngError::RangeOverflow)?;
            battle_seed.push(char::from(byte));
        }

        staged.run = saved_run;
        staged.seed_offset = saved_offset;
        staged.seed_override = saved_override;
        let turn = TurnIndex::new(SafeU53::new(1).map_err(|_| RngError::TurnOverflow)?)
            .map_err(|_| RngError::TurnOverflow)?;
        let battle = BattleRngState::new(battle_seed, turn);
        staged.battle = Some(battle.clone());
        *self = staged;
        Ok(battle)
    }

    /// Executes the selected global seeded wrapper as one logical run audit.
    pub fn run_rand_seed_int(
        &mut self,
        cardinality: SafeU53,
        minimum: SafeU53,
        reason: RngReason,
        callsite_id: RngCallsiteId,
    ) -> Result<SafeU53, RngError> {
        let mut staged = self.clone();
        let consumed = cardinality.get() > 1;
        let result = staged.draw_active_run(
            RngStream::Run,
            cardinality,
            minimum,
            reason,
            RngPublicApi::RandSeedInt,
            callsite_id,
            consumed,
        )?;
        *self = staged;
        Ok(result)
    }

    /// Executes direct Phaser `integerInRange`, including its equal-bound draw.
    pub fn run_integer_in_range(
        &mut self,
        minimum: SafeU53,
        maximum: SafeU53,
        reason: RngReason,
        callsite_id: RngCallsiteId,
    ) -> Result<SafeU53, RngError> {
        let cardinality = inclusive_cardinality(minimum, maximum)?;
        let mut staged = self.clone();
        let result = staged.draw_active_run(
            RngStream::Run,
            cardinality,
            minimum,
            reason,
            RngPublicApi::IntegerInRange,
            callsite_id,
            true,
        )?;
        *self = staged;
        Ok(result)
    }

    /// Audits a selected run-stream pick once; the nested range is not re-audited.
    pub fn run_pick_index(
        &mut self,
        length: usize,
        reason: RngReason,
        callsite_id: RngCallsiteId,
    ) -> Result<usize, RngError> {
        let cardinality = pick_cardinality(length)?;
        let mut staged = self.clone();
        let result = staged.draw_active_run(
            RngStream::Run,
            cardinality,
            SafeU53::ZERO,
            reason,
            RngPublicApi::Pick,
            callsite_id,
            length > 1,
        )?;
        *self = staged;
        usize::try_from(result.get()).map_err(|_| RngError::SliceTooLong)
    }

    /// Executes the exact `Battle.randSeedInt` cache transaction atomically.
    pub fn battle_rand_seed_int(
        &mut self,
        cardinality: SafeU53,
        minimum: SafeU53,
        reason: RngReason,
        callsite_id: RngCallsiteId,
    ) -> Result<SafeU53, RngError> {
        let mut staged = self.clone();
        let result = staged.draw_battle(
            cardinality,
            minimum,
            reason,
            RngPublicApi::RandSeedInt,
            callsite_id,
            cardinality.get() > 1,
        )?;
        *self = staged;
        Ok(result)
    }

    /// Converts an inclusive battle range to the oracle wrapper cardinality once.
    pub fn battle_rand_seed_int_range(
        &mut self,
        minimum: SafeU53,
        maximum: SafeU53,
        reason: RngReason,
        callsite_id: RngCallsiteId,
    ) -> Result<SafeU53, RngError> {
        let cardinality = inclusive_cardinality(minimum, maximum)?;
        self.battle_rand_seed_int(cardinality, minimum, reason, callsite_id)
    }

    /// Executes direct battle `integerInRange`, including its equal-bound draw.
    pub fn battle_integer_in_range(
        &mut self,
        minimum: SafeU53,
        maximum: SafeU53,
        reason: RngReason,
        callsite_id: RngCallsiteId,
    ) -> Result<SafeU53, RngError> {
        let cardinality = inclusive_cardinality(minimum, maximum)?;
        let mut staged = self.clone();
        let result = staged.draw_battle(
            cardinality,
            minimum,
            reason,
            RngPublicApi::IntegerInRange,
            callsite_id,
            true,
        )?;
        *self = staged;
        Ok(result)
    }

    /// Audits one logical battle pick and returns its selected zero-based index.
    pub fn battle_pick_index(
        &mut self,
        length: usize,
        reason: RngReason,
        callsite_id: RngCallsiteId,
    ) -> Result<usize, RngError> {
        let cardinality = pick_cardinality(length)?;
        let mut staged = self.clone();
        let result = staged.draw_battle(
            cardinality,
            SafeU53::ZERO,
            reason,
            RngPublicApi::Pick,
            callsite_id,
            length > 1,
        )?;
        *self = staged;
        usize::try_from(result.get()).map_err(|_| RngError::SliceTooLong)
    }

    /// Returns a selected battle value while retaining index-valued audit evidence.
    pub fn battle_pick<'a, T>(
        &mut self,
        values: &'a [T],
        reason: RngReason,
        callsite_id: RngCallsiteId,
    ) -> Result<&'a T, RngError> {
        let index = self.battle_pick_index(values.len(), reason, callsite_id)?;
        values.get(index).ok_or(RngError::RangeOverflow)
    }

    /// Scene wrapper: delegates to the battle transaction without a second audit.
    pub fn scene_rand_battle_seed_int(
        &mut self,
        cardinality: SafeU53,
        minimum: SafeU53,
        reason: RngReason,
        callsite_id: RngCallsiteId,
    ) -> Result<SafeU53, RngError> {
        self.battle_rand_seed_int(cardinality, minimum, reason, callsite_id)
    }

    /// Pokémon wrapper: delegates through the scene seam without a second audit.
    pub fn pokemon_rand_battle_seed_int(
        &mut self,
        cardinality: SafeU53,
        minimum: SafeU53,
        reason: RngReason,
        callsite_id: RngCallsiteId,
    ) -> Result<SafeU53, RngError> {
        self.scene_rand_battle_seed_int(cardinality, minimum, reason, callsite_id)
    }

    /// Increments the battle turn and clears its saved substream atomically.
    pub fn increment_turn(&mut self) -> Result<(), RngError> {
        let mut staged = self.clone();
        staged
            .battle
            .as_mut()
            .ok_or(RngError::MissingBattleState)?
            .increment_turn()?;
        *self = staged;
        Ok(())
    }

    /// Executes the speed-order seed-offset Fisher-Yates transaction atomically.
    pub fn speed_order_shuffle<T: Clone>(
        &mut self,
        values: &mut [T],
        wave_seed: &str,
        turn: TurnIndex,
    ) -> Result<(), RngError> {
        let length = safe_from_usize(values.len())?;
        let offset = turn
            .get()
            .get()
            .checked_mul(1_000)
            .and_then(|value| value.checked_add(length.get()))
            .ok_or(RngError::UnsafeSeedOffset)?;
        let offset = SafeU53::new(offset).map_err(|_| RngError::UnsafeSeedOffset)?;
        let shift = i64::try_from(offset.get()).map_err(|_| RngError::UnsafeSeedOffset)?;
        let shifted_seed = shift_char_codes(wave_seed, shift)?;

        let mut staged = self.clone();
        let mut staged_values = values.to_vec();
        let saved_run = staged.run.clone();
        let saved_offset = staged.seed_offset.clone();
        let saved_override = staged.seed_override.clone();
        staged.run = PhaserRdg::from_seed(&shifted_seed);
        staged.seed_offset = Some(SeedOffsetContext {
            wave_seed: wave_seed.to_owned(),
            offset,
        });
        staged.seed_override = Some(wave_seed.to_owned());

        for index in (1..staged_values.len()).rev() {
            let cardinality = safe_from_usize(index + 1)?;
            let selected = staged.draw_active_run(
                RngStream::SeedOffset,
                cardinality,
                SafeU53::ZERO,
                RngReason::SpeedTie,
                RngPublicApi::FisherYatesSwap,
                RngCallsiteId::speed_tie(),
                true,
            )?;
            let selected = usize::try_from(selected.get()).map_err(|_| RngError::SliceTooLong)?;
            staged_values.swap(index, selected);
        }

        staged.run = saved_run;
        staged.seed_offset = saved_offset;
        staged.seed_override = saved_override;
        *self = staged;
        values.clone_from_slice(&staged_values);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_active_run(
        &mut self,
        stream: RngStream,
        cardinality: SafeU53,
        minimum: SafeU53,
        reason: RngReason,
        public_api: RngPublicApi,
        callsite_id: RngCallsiteId,
        consumed: bool,
    ) -> Result<SafeU53, RngError> {
        callsite_id.validate_for(reason, stream)?;
        let maximum = if consumed {
            checked_range_max(minimum, cardinality)?
        } else {
            minimum
        };
        let before_state = self.audit_state();
        let result = if consumed {
            self.run.integer_in_range(minimum, maximum)?
        } else {
            minimum
        };
        let after_state = self.audit_state();
        self.audit.record(RngDrawInput {
            stream,
            reason,
            public_api,
            callsite_id,
            minimum,
            cardinality,
            result,
            consumed,
            before_state,
            after_state,
        })?;
        Ok(result)
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_battle(
        &mut self,
        cardinality: SafeU53,
        minimum: SafeU53,
        reason: RngReason,
        public_api: RngPublicApi,
        callsite_id: RngCallsiteId,
        consumed: bool,
    ) -> Result<SafeU53, RngError> {
        callsite_id.validate_for(reason, RngStream::Battle)?;
        let battle = self
            .battle
            .as_ref()
            .ok_or(RngError::MissingBattleState)?
            .clone();
        let maximum = if consumed {
            checked_range_max(minimum, cardinality)?
        } else {
            minimum
        };
        let before_state = self.audit_state();

        let result = if consumed {
            let mut generator = if let Some(saved_substream) = &battle.saved_substream {
                PhaserRdg::from_state(saved_substream)?
            } else {
                let turn_shift = js_shift_left(u64::from(battle.turn), 6);
                let seed = shift_char_codes(&battle.battle_seed, i64::from(turn_shift))?;
                PhaserRdg::from_seed(&seed)
            };
            let saved_override = self.seed_override.clone();
            self.seed_override = Some(battle.battle_seed.clone());
            let result = generator.integer_in_range(minimum, maximum)?;
            self.battle
                .as_mut()
                .ok_or(RngError::MissingBattleState)?
                .saved_substream = Some(generator.state());
            self.seed_override = saved_override;
            result
        } else {
            minimum
        };

        let after_state = self.audit_state();
        self.audit.record(RngDrawInput {
            stream: RngStream::Battle,
            reason,
            public_api,
            callsite_id,
            minimum,
            cardinality,
            result,
            consumed,
            before_state,
            after_state,
        })?;
        Ok(result)
    }

    fn audit_state(&self) -> RngAuditState {
        RngAuditState {
            run: self.run.state(),
            battle: self.battle.clone(),
            seed_offset: self.seed_offset.clone(),
        }
    }
}

fn inclusive_cardinality(minimum: SafeU53, maximum: SafeU53) -> Result<SafeU53, RngError> {
    if minimum > maximum {
        return Err(RngError::InvalidRange {
            minimum: minimum.get(),
            maximum: maximum.get(),
        });
    }
    let cardinality = maximum
        .get()
        .checked_sub(minimum.get())
        .and_then(|value| value.checked_add(1))
        .ok_or(RngError::RangeOverflow)?;
    SafeU53::new(cardinality).map_err(|_| RngError::RangeOverflow)
}

fn pick_cardinality(length: usize) -> Result<SafeU53, RngError> {
    if length == 0 {
        return Err(RngError::EmptyPick);
    }
    safe_from_usize(length)
}

fn js_shift_left(value: u64, count: u32) -> i32 {
    let low_word = value as u32;
    (low_word as i32).wrapping_shl(count & 31)
}
