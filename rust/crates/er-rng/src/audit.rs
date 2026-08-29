//! Closed, first-divergence random-draw audit records.

use er_types::SafeU53;
use serde::{Deserialize, Deserializer, Serialize};

use crate::battle::BattleRngState;
use crate::phaser::{PhaserRdgState, RngError};

const ORACLE_SHA: &str = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";

const BATTLE_SEED_CHARACTER_ID: &str =
    "3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/utils/common.ts:25";
const SPEED_TIE_ID: &str = "3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/utils/common.ts:151";
const PARALYSIS_ACTIVATION_ID: &str =
    "3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/move-phase.ts:546";
const ACCURACY_ID: &str =
    "3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/move-effect-phase.ts:563";
const CRITICAL_HIT_ID: &str = "3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/field/pokemon.ts:5880";
const DAMAGE_VARIANCE_ID: &str =
    "3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/field/pokemon.ts:5550";
const SECONDARY_STATUS_ID: &str =
    "3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/moves/move.ts:3502";
const SECONDARY_STATUS_BYPASS_ID: &str =
    "3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/moves/move.ts:3533";
const SECONDARY_STAGE_ID: &str =
    "3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/moves/move.ts:4934";
const MULTI_HIT_COUNT_ID: &str =
    "3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/data/moves/move.ts:3375";
const M5_ABILITY_CHANCE_ID: &str =
    "328824692f95b1aa1b38af85b54a6b72d9259eb4:rust/mechanics:ability-chance";
const M5_ITEM_CHANCE_ID: &str =
    "328824692f95b1aa1b38af85b54a6b72d9259eb4:rust/mechanics:item-chance";
const M5_STATUS_DURATION_ID: &str =
    "328824692f95b1aa1b38af85b54a6b72d9259eb4:rust/mechanics:status-duration";
const M5_VOLATILE_DURATION_ID: &str =
    "328824692f95b1aa1b38af85b54a6b72d9259eb4:rust/mechanics:volatile-duration";
const M5_RANDOM_TARGET_ID: &str =
    "328824692f95b1aa1b38af85b54a6b72d9259eb4:rust/mechanics:random-target";
const M5_RANDOM_MOVE_ID: &str =
    "328824692f95b1aa1b38af85b54a6b72d9259eb4:rust/mechanics:random-move";
const M5_RANDOM_ITEM_ID: &str =
    "328824692f95b1aa1b38af85b54a6b72d9259eb4:rust/mechanics:random-item";
const M5_RANDOM_STAT_ID: &str =
    "328824692f95b1aa1b38af85b54a6b72d9259eb4:rust/mechanics:random-stat";
const M5_RANDOM_SELECTOR_ID: &str =
    "328824692f95b1aa1b38af85b54a6b72d9259eb4:rust/mechanics:random-selector";

/// Semantically distinct M3 random streams.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
pub enum RngStream {
    Run,
    Battle,
    SeedOffset,
}

/// Public RNG seam represented by one logical audit entry.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
pub enum RngPublicApi {
    RandSeedInt,
    IntegerInRange,
    Pick,
    FisherYatesSwap,
}

/// Frozen, closed reasons for selected-slice random choices.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
pub enum RngReason {
    BattleSeedCharacter,
    SpeedTie,
    ParalysisActivation,
    Accuracy,
    CriticalHit,
    DamageVariance,
    SecondaryEffect,
    MultiHitCount,
    AbilityChance,
    ItemChance,
    StatusDuration,
    VolatileDuration,
    RandomTarget,
    RandomMove,
    RandomItem,
    RandomStat,
    RandomSelector,
}

/// Closed source identity at the pinned TypeScript oracle commit.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct RngCallsiteId(String);

impl RngCallsiteId {
    /// Accepts only identities in the frozen selected-slice callsite map.
    pub fn new(value: impl Into<String>) -> Result<Self, RngError> {
        let value = value.into();
        if callsite_spec(&value).is_none() {
            return Err(RngError::UnknownCallsite { value });
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn battle_seed_character() -> Self {
        Self(BATTLE_SEED_CHARACTER_ID.to_owned())
    }

    pub fn speed_tie() -> Self {
        Self(SPEED_TIE_ID.to_owned())
    }

    pub fn paralysis_activation() -> Self {
        Self(PARALYSIS_ACTIVATION_ID.to_owned())
    }

    pub fn accuracy() -> Self {
        Self(ACCURACY_ID.to_owned())
    }

    pub fn critical_hit() -> Self {
        Self(CRITICAL_HIT_ID.to_owned())
    }

    pub fn damage_variance() -> Self {
        Self(DAMAGE_VARIANCE_ID.to_owned())
    }

    pub fn secondary_status() -> Self {
        Self(SECONDARY_STATUS_ID.to_owned())
    }

    pub fn secondary_status_bypass() -> Self {
        Self(SECONDARY_STATUS_BYPASS_ID.to_owned())
    }

    pub fn secondary_stage() -> Self {
        Self(SECONDARY_STAGE_ID.to_owned())
    }

    pub fn multi_hit_count() -> Self {
        Self(MULTI_HIT_COUNT_ID.to_owned())
    }

    pub fn mechanics(reason: RngReason) -> Self {
        let value = match reason {
            RngReason::AbilityChance => M5_ABILITY_CHANCE_ID,
            RngReason::ItemChance => M5_ITEM_CHANCE_ID,
            RngReason::StatusDuration => M5_STATUS_DURATION_ID,
            RngReason::VolatileDuration => M5_VOLATILE_DURATION_ID,
            RngReason::RandomTarget => M5_RANDOM_TARGET_ID,
            RngReason::RandomMove => M5_RANDOM_MOVE_ID,
            RngReason::RandomItem => M5_RANDOM_ITEM_ID,
            RngReason::RandomStat => M5_RANDOM_STAT_ID,
            RngReason::RandomSelector => M5_RANDOM_SELECTOR_ID,
            RngReason::SpeedTie => SPEED_TIE_ID,
            RngReason::ParalysisActivation => PARALYSIS_ACTIVATION_ID,
            RngReason::Accuracy => ACCURACY_ID,
            RngReason::CriticalHit => CRITICAL_HIT_ID,
            RngReason::DamageVariance => DAMAGE_VARIANCE_ID,
            RngReason::SecondaryEffect => SECONDARY_STATUS_ID,
            RngReason::MultiHitCount => MULTI_HIT_COUNT_ID,
            RngReason::BattleSeedCharacter => BATTLE_SEED_CHARACTER_ID,
        };
        Self(value.to_owned())
    }

    /// Returns the pinned oracle commit embedded in every accepted identity.
    pub const fn oracle_sha() -> &'static str {
        ORACLE_SHA
    }

    pub(crate) fn validate_for(
        &self,
        reason: RngReason,
        stream: RngStream,
    ) -> Result<(), RngError> {
        let Some((mapped_reason, stream_mask)) = callsite_spec(&self.0) else {
            return Err(RngError::UnknownCallsite {
                value: self.0.clone(),
            });
        };
        if mapped_reason != reason {
            return Err(RngError::CallsiteReasonMismatch {
                callsite: self.0.clone(),
                reason: format!("{reason:?}"),
            });
        }
        if stream_mask & stream_bit(stream) == 0 {
            return Err(RngError::ReasonStreamMismatch {
                reason: format!("{reason:?}"),
                stream: format!("{stream:?}"),
            });
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for RngCallsiteId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

/// Active seed-offset identity carried by every offset-stream audit snapshot.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SeedOffsetContext {
    pub wave_seed: String,
    pub offset: SafeU53,
}

/// Complete exact-bit stream snapshot before or after one logical draw.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RngAuditState {
    pub run: PhaserRdgState,
    pub battle: Option<BattleRngState>,
    pub seed_offset: Option<SeedOffsetContext>,
}

impl RngAuditState {
    pub fn validate(&self) -> Result<(), RngError> {
        self.run.validate()?;
        if let Some(battle) = &self.battle {
            battle.validate()?;
        }
        Ok(())
    }
}

/// One closed logical random choice and its exact first-divergence evidence.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct RngDraw {
    pub sequence: SafeU53,
    pub stream: RngStream,
    pub reason: RngReason,
    pub public_api: RngPublicApi,
    pub callsite_id: RngCallsiteId,
    pub minimum: SafeU53,
    pub cardinality: SafeU53,
    pub result: SafeU53,
    pub consumed: bool,
    pub primitive_draw_count: u8,
    pub before_state: RngAuditState,
    pub after_state: RngAuditState,
    pub before_fingerprint: String,
    pub after_fingerprint: String,
}

impl RngDraw {
    /// Recomputes all closed invariants and exact state fingerprints.
    pub fn validate(&self) -> Result<(), RngError> {
        self.callsite_id.validate_for(self.reason, self.stream)?;
        validate_stream_state(self.stream, &self.before_state)?;
        validate_stream_state(self.stream, &self.after_state)?;
        validate_api_shape(self)?;

        if !self.consumed && self.before_state != self.after_state {
            return Err(RngError::InvalidAudit {
                detail: "non-consuming draw changed stream state",
            });
        }
        if self.before_fingerprint != rng_state_fingerprint(&self.before_state)? {
            return Err(RngError::InvalidAudit {
                detail: "before fingerprint does not match before state",
            });
        }
        if self.after_fingerprint != rng_state_fingerprint(&self.after_state)? {
            return Err(RngError::InvalidAudit {
                detail: "after fingerprint does not match after state",
            });
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for RngDraw {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct RawDraw {
            sequence: SafeU53,
            stream: RngStream,
            reason: RngReason,
            public_api: RngPublicApi,
            callsite_id: RngCallsiteId,
            minimum: SafeU53,
            cardinality: SafeU53,
            result: SafeU53,
            consumed: bool,
            primitive_draw_count: u8,
            before_state: RngAuditState,
            after_state: RngAuditState,
            before_fingerprint: String,
            after_fingerprint: String,
        }

        let raw = RawDraw::deserialize(deserializer)?;
        let draw = Self {
            sequence: raw.sequence,
            stream: raw.stream,
            reason: raw.reason,
            public_api: raw.public_api,
            callsite_id: raw.callsite_id,
            minimum: raw.minimum,
            cardinality: raw.cardinality,
            result: raw.result,
            consumed: raw.consumed,
            primitive_draw_count: raw.primitive_draw_count,
            before_state: raw.before_state,
            after_state: raw.after_state,
            before_fingerprint: raw.before_fingerprint,
            after_fingerprint: raw.after_fingerprint,
        };
        draw.validate().map_err(serde::de::Error::custom)?;
        Ok(draw)
    }
}

/// Monotonic audit owner shared by run, battle, and seed-offset streams.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RngAuditLog {
    next_sequence: Option<SafeU53>,
    entries: Vec<RngDraw>,
}

impl Default for RngAuditLog {
    fn default() -> Self {
        Self::new()
    }
}

impl RngAuditLog {
    pub fn new() -> Self {
        Self {
            next_sequence: Some(SafeU53::ZERO),
            entries: Vec::new(),
        }
    }

    pub fn with_next_sequence(next_sequence: SafeU53) -> Self {
        Self {
            next_sequence: Some(next_sequence),
            entries: Vec::new(),
        }
    }

    pub fn entries(&self) -> &[RngDraw] {
        &self.entries
    }

    pub fn next_sequence(&self) -> Option<SafeU53> {
        self.next_sequence
    }

    pub fn into_entries(self) -> Vec<RngDraw> {
        self.entries
    }

    pub(crate) fn record(&mut self, input: RngDrawInput) -> Result<(), RngError> {
        let sequence = self.next_sequence.ok_or(RngError::AuditSequenceExhausted)?;
        let before_fingerprint = rng_state_fingerprint(&input.before_state)?;
        let after_fingerprint = rng_state_fingerprint(&input.after_state)?;
        let draw = RngDraw {
            sequence,
            stream: input.stream,
            reason: input.reason,
            public_api: input.public_api,
            callsite_id: input.callsite_id,
            minimum: input.minimum,
            cardinality: input.cardinality,
            result: input.result,
            consumed: input.consumed,
            primitive_draw_count: if input.consumed { 2 } else { 0 },
            before_state: input.before_state,
            after_state: input.after_state,
            before_fingerprint,
            after_fingerprint,
        };
        draw.validate()?;

        self.next_sequence = if sequence == SafeU53::MAX {
            None
        } else {
            Some(SafeU53::new(sequence.get() + 1).map_err(|_| RngError::AuditSequenceExhausted)?)
        };
        self.entries.push(draw);
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub(crate) struct RngDrawInput {
    pub stream: RngStream,
    pub reason: RngReason,
    pub public_api: RngPublicApi,
    pub callsite_id: RngCallsiteId,
    pub minimum: SafeU53,
    pub cardinality: SafeU53,
    pub result: SafeU53,
    pub consumed: bool,
    pub before_state: RngAuditState,
    pub after_state: RngAuditState,
}

/// Computes the canonical compact exact-state comparison used by first divergence.
pub fn rng_state_fingerprint(state: &RngAuditState) -> Result<String, RngError> {
    state.validate()?;
    Ok(er_canonical::content_digest(state)?)
}

fn validate_api_shape(draw: &RngDraw) -> Result<(), RngError> {
    let cardinality = draw.cardinality.get();
    let expected_consumed = match draw.public_api {
        RngPublicApi::RandSeedInt => cardinality > 1,
        RngPublicApi::IntegerInRange => {
            if cardinality == 0 {
                return Err(RngError::InvalidAudit {
                    detail: "integerInRange requires nonzero cardinality",
                });
            }
            true
        }
        RngPublicApi::Pick => {
            if cardinality == 0 || draw.minimum != SafeU53::ZERO {
                return Err(RngError::InvalidAudit {
                    detail: "pick requires zero minimum and nonzero cardinality",
                });
            }
            cardinality > 1
        }
        RngPublicApi::FisherYatesSwap => {
            if cardinality <= 1 || draw.minimum != SafeU53::ZERO {
                return Err(RngError::InvalidAudit {
                    detail: "Fisher-Yates swap requires zero minimum and cardinality above one",
                });
            }
            true
        }
    };
    if draw.consumed != expected_consumed
        || draw.primitive_draw_count != if expected_consumed { 2 } else { 0 }
    {
        return Err(RngError::InvalidAudit {
            detail: "consumption metadata does not match public API semantics",
        });
    }

    if cardinality <= 1 {
        if draw.result != draw.minimum {
            return Err(RngError::InvalidAudit {
                detail: "fast-path result must equal minimum",
            });
        }
        return Ok(());
    }
    let upper = draw
        .minimum
        .get()
        .checked_add(cardinality - 1)
        .ok_or(RngError::InvalidAudit {
            detail: "range upper bound overflowed",
        })?;
    if upper > SafeU53::MAX.get() || !(draw.minimum.get()..=upper).contains(&draw.result.get()) {
        return Err(RngError::InvalidAudit {
            detail: "result lies outside the audited range",
        });
    }
    Ok(())
}

fn validate_stream_state(stream: RngStream, state: &RngAuditState) -> Result<(), RngError> {
    match stream {
        RngStream::Run if state.seed_offset.is_some() => Err(RngError::InvalidAudit {
            detail: "run-stream state carries an offset context",
        }),
        RngStream::Battle if state.battle.is_none() || state.seed_offset.is_some() => {
            Err(RngError::InvalidAudit {
                detail: "battle-stream state lacks battle identity or carries an offset context",
            })
        }
        RngStream::SeedOffset if state.seed_offset.is_none() => Err(RngError::InvalidAudit {
            detail: "offset-stream state lacks offset context",
        }),
        _ => Ok(()),
    }
}

fn callsite_spec(value: &str) -> Option<(RngReason, u8)> {
    match value {
        BATTLE_SEED_CHARACTER_ID => Some((
            RngReason::BattleSeedCharacter,
            stream_bit(RngStream::Run) | stream_bit(RngStream::SeedOffset),
        )),
        SPEED_TIE_ID => Some((RngReason::SpeedTie, stream_bit(RngStream::SeedOffset))),
        PARALYSIS_ACTIVATION_ID => Some((
            RngReason::ParalysisActivation,
            stream_bit(RngStream::Battle),
        )),
        ACCURACY_ID => Some((RngReason::Accuracy, stream_bit(RngStream::Battle))),
        CRITICAL_HIT_ID => Some((RngReason::CriticalHit, stream_bit(RngStream::Battle))),
        DAMAGE_VARIANCE_ID => Some((RngReason::DamageVariance, stream_bit(RngStream::Battle))),
        SECONDARY_STATUS_ID | SECONDARY_STATUS_BYPASS_ID | SECONDARY_STAGE_ID => {
            Some((RngReason::SecondaryEffect, stream_bit(RngStream::Battle)))
        }
        MULTI_HIT_COUNT_ID => Some((RngReason::MultiHitCount, stream_bit(RngStream::Battle))),
        M5_ABILITY_CHANCE_ID => Some((
            RngReason::AbilityChance,
            stream_bit(RngStream::Battle) | stream_bit(RngStream::Run),
        )),
        M5_ITEM_CHANCE_ID => Some((
            RngReason::ItemChance,
            stream_bit(RngStream::Battle) | stream_bit(RngStream::Run),
        )),
        M5_STATUS_DURATION_ID => Some((RngReason::StatusDuration, stream_bit(RngStream::Battle))),
        M5_VOLATILE_DURATION_ID => {
            Some((RngReason::VolatileDuration, stream_bit(RngStream::Battle)))
        }
        M5_RANDOM_TARGET_ID => Some((RngReason::RandomTarget, stream_bit(RngStream::Battle))),
        M5_RANDOM_MOVE_ID => Some((
            RngReason::RandomMove,
            stream_bit(RngStream::Battle) | stream_bit(RngStream::Run),
        )),
        M5_RANDOM_ITEM_ID => Some((
            RngReason::RandomItem,
            stream_bit(RngStream::Battle) | stream_bit(RngStream::Run),
        )),
        M5_RANDOM_STAT_ID => Some((RngReason::RandomStat, stream_bit(RngStream::Battle))),
        M5_RANDOM_SELECTOR_ID => Some((
            RngReason::RandomSelector,
            stream_bit(RngStream::Battle) | stream_bit(RngStream::Run),
        )),
        _ => None,
    }
}

const fn stream_bit(stream: RngStream) -> u8 {
    match stream {
        RngStream::Run => 1,
        RngStream::Battle => 2,
        RngStream::SeedOffset => 4,
    }
}
