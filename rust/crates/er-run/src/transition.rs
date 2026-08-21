//! Shared M4 run-transition vocabulary frozen by `rust/contracts/m4-api.md`.
//!
//! These DTOs are the exact boundary between pure `er-run` mechanics, the
//! authority material layer, and the runtime. They contain no UI, protocol,
//! kernel, scheduler, network, filesystem, browser, thread, async, wall-clock,
//! or callback dependency.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use er_types::SeatId;
use er_types::battle_ids::{BattleId, MoveId, MoveSlotIndex, PokemonId, WaveIndex};
use er_state::digest_v2::MechanicalStateDigestV2;
use er_state::game_v2::GameStateV2;
use er_types::battle_ids::{BattleId, MoveId, MoveSlotIndex, PokemonId, WaveIndex};
use er_types::battle_model::BattleStats;
use er_types::ids::OperationId;
use er_types::run_control::GameControlPlan;
use er_types::run_ids::{
    BiomeId, EncounterId, Experience, ModifierId, Money, RunInteractionSequence, RunOfferId,
    RunStockId, RunSurfaceId, RunTaskId,
};
use er_types::run_model::{LearnMoveDecision, ModifierTier, RunOutcome, RunStage, RunSurfaceKind};

use crate::content::RunContentPack;
use crate::rng_audit::RunRngDraw;

/// Immutable pair of loaded content packs addressed by every pure run API.
#[derive(Clone, Debug)]
pub struct GameContentBundle {
    pub battle: Arc<ContentPack>,
    pub run: Arc<RunContentPack>,
}

impl GameContentBundle {
    pub fn new(battle: Arc<ContentPack>, run: Arc<RunContentPack>) -> Self {
        Self { battle, run }
    }
}

/// One closed mechanical change staged by a prepared run transition.
///
/// Every variant carries complete before/after evidence so a replica can
/// replay the mutation without recomputing mechanics.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunMutation {
    MoneyChanged {
        before: Money,
        after: Money,
    },
    ExperienceChanged {
        pokemon: PokemonId,
        before: Experience,
        after: Experience,
    },
    LevelChanged {
        pokemon: PokemonId,
        before: u16,
        after: u16,
    },
    StatsRecomputed {
        pokemon: PokemonId,
        before: BattleStats,
        after: BattleStats,
    },
    FriendshipChanged {
        pokemon: PokemonId,
        before: u16,
        after: u16,
    },
    MoveLearned {
        pokemon: PokemonId,
        slot: MoveSlotIndex,
        learned: MoveId,
        replaced: Option<MoveId>,
    },
    ModifierApplied {
        modifier_id: ModifierId,
        stacks: u16,
        target: Option<PokemonId>,
    },
    RewardOfferSold {
        offer: RunOfferId,
    },
    StockPurchased {
        stock: RunStockId,
        remaining_quantity: u16,
    },
    LockTiersChanged {
        tiers: Vec<ModifierTier>,
    },
    RerollCountChanged {
        count: u32,
        cost: Money,
    },
    SurfaceOpened {
        kind: RunSurfaceKind,
        surface_id: RunSurfaceId,
    },
    SurfaceClosed,
    StageChanged {
        before: RunStage,
        after: RunStage,
    },
    WaveAdvanced {
        before: WaveIndex,
        after: WaveIndex,
    },
    BiomeArrived {
        before: BiomeId,
        after: BiomeId,
    },
    OutcomeChanged {
        before: RunOutcome,
        after: RunOutcome,
    },
}

/// Ordered presentation evidence for one run transition.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunPresentationEvent {
    ExperienceGained {
        pokemon: PokemonId,
        amount: Experience,
    },
    LevelUp {
        pokemon: PokemonId,
        level: u16,
    },
    MoveLearned {
        pokemon: PokemonId,
        move_id: MoveId,
    },
    MoveReplaced {
        pokemon: PokemonId,
        slot: MoveSlotIndex,
        forgotten: MoveId,
        learned: MoveId,
    },
    ModifierAcquired {
        modifier_id: ModifierId,
        target: Option<PokemonId>,
    },
    MoneyChanged {
        before: Money,
        after: Money,
    },
    SurfacePresented {
        kind: RunSurfaceKind,
        surface_id: RunSurfaceId,
    },
    SurfaceClosed,
    BiomeArrived {
        biome: BiomeId,
    },
    WaveStarted {
        wave: WaveIndex,
    },
    RunCompleted {
        outcome: RunOutcome,
    },
}

/// Closed identity evidence binding a prepared transition to its operation.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunTransitionEvidence {
    pub operation_id: OperationId,
    pub owner_seat: SeatId,
    pub source_battle_id: Option<BattleId>,
    pub surface_id: Option<RunSurfaceId>,
    pub interaction_sequence: Option<RunInteractionSequence>,
    pub action_ordinal: Option<u32>,
    /// True when the transition consumed zero run-RNG draws.
    pub rng_unchanged: bool,
}

/// The complete atomic output of every pure `er-run` API.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreparedRunTransition {
    pub before_digest: MechanicalStateDigestV2,
    pub after_state: GameStateV2,
    pub after_digest: MechanicalStateDigestV2,
    pub mutations: Vec<RunMutation>,
    pub presentation: Vec<RunPresentationEvent>,
    pub rng_audit: Vec<RunRngDraw>,
    pub next_control: GameControlPlan,
    pub evidence: RunTransitionEvidence,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum TransitionShapeError {
    #[error("prepared run transition RNG audit sequences are not contiguous")]
    RngAuditOrder,
}

impl PreparedRunTransition {
    /// Validates structural self-consistency that holds without live content.
    pub fn validate_shape(&self) -> Result<(), TransitionShapeError> {
        let mut expected_sequence = None;
        for draw in &self.rng_audit {
            match expected_sequence {
                Some(expected) if draw.sequence.get() != expected => {
                    return Err(TransitionShapeError::RngAuditOrder);
                }
                _ => {}
            }
            expected_sequence = Some(
                draw.sequence
                    .get()
                    .checked_add(1)
                    .ok_or(TransitionShapeError::RngAuditOrder)?,
            );
        }
        Ok(())
    }
}

/// The typed decision resolving one active progression task.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProgressionDecision {
    pub task_id: RunTaskId,
    pub action: LearnMoveDecision,
}

/// Authority request to open the next retained run surface after settlement.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpenSurfaceRequest {
    pub source_wave: WaveIndex,
    pub kind: RunSurfaceKind,
    pub owner_seat: SeatId,
    pub interaction_sequence: RunInteractionSequence,
    pub operation_id: OperationId,
}

/// Authority request to prepare the next encounter plan from captured vectors.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EncounterRequest {
    pub encounter_id: EncounterId,
    pub owner_seat: SeatId,
    pub operation_id: OperationId,
}
