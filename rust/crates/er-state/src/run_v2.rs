//! Versioned M4 run state and closed progression/surface records.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use er_rng::phaser::RunRngState;
use er_types::SeatId;
use er_types::battle_ids::{BattleId, MoveId, PokemonId, SpeciesId, WaveIndex};
use er_types::battle_model::BattleOutcome;
use er_types::ids::OperationId;
use er_types::run_ids::Experience;
pub use er_types::run_model::{ModifierTier, RunOutcome, RunStage, RunSurfaceKind};

pub const RUN_STATE_SCHEMA_VERSION: u32 = 1;
pub const PROGRESSION_QUEUE_SCHEMA_VERSION: u32 = 1;
pub const PROGRESSION_TASK_SCHEMA_VERSION: u32 = 1;
pub const RUN_SURFACE_STATE_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunModifierInstance {
    pub modifier_id: ModifierId,
    pub stacks: u16,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProgressionQueue {
    pub schema_version: u32,
    pub tasks: Vec<ProgressionTaskEnvelope>,
    pub active_index: Option<u32>,
    pub next_task_id: RunTaskId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProgressionTaskEnvelope {
    pub schema_version: u32,
    pub task_id: RunTaskId,
    pub owner_seat: SeatId,
    pub source_battle_id: BattleId,
    pub task: ProgressionTask,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProgressionTask {
    GainExperience(GainExperienceTask),
    LevelChanged(LevelChangedTask),
    LearnMove(LearnMoveTask),
    UnsupportedEvolution(UnsupportedEvolutionTask),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GainExperienceTask {
    pub pokemon: PokemonId,
    pub experience: Experience,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LevelChangedTask {
    pub pokemon: PokemonId,
    pub old_level: u16,
    pub new_level: u16,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LearnMoveTask {
    pub pokemon: PokemonId,
    pub move_id: MoveId,
    pub source_battle_id: BattleId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnsupportedEvolutionTask {
    pub pokemon: PokemonId,
    pub species_id: SpeciesId,
    pub target_species_id: SpeciesId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunCounters {
    pub interaction: RunInteractionSequence,
    pub pending_remote_interaction: Option<RunInteractionSequence>,
    pub next_surface_id: RunSurfaceId,
    pub per_stream_action_ordinals: Vec<SurfaceActionOrdinal>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SurfaceActionOrdinal {
    pub surface_id: RunSurfaceId,
    pub ordinal: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BiomeRuntimeState {
    pub biome: BiomeId,
    pub source_wave: WaveIndex,
    pub route_node: Option<RouteNodeId>,
    /// The previous biome at this entry (route no-loopback exclusion input).
    pub previous_biome: Option<BiomeId>,
    /// The two most recently visited biomes before `previous_biome`.
    pub recent_biomes: [Option<BiomeId>; 2],
    /// The wave the current biome instance started on (its first battle).
    pub structure_start_wave: WaveIndex,
    /// The rolled length of the current biome instance; null = vanilla cadence.
    pub structure_length: Option<u16>,
    /// Set by the Crossroads "Move on" choice: the next wave ends the biome.
    pub leave_biome_now: bool,
    /// The wave the player deliberately chose to stay past the free window.
    pub overstay_anchor_wave: Option<WaveIndex>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RouteNode {
    pub route_node_id: RouteNodeId,
    pub biome: BiomeId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PendingModifierTarget {
    pub pokemon: PokemonId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RewardOffer {
    pub offer_id: RunOfferId,
    pub modifier_id: ModifierId,
    pub tier: ModifierTier,
    pub price: Money,
    pub sold: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MarketStockEntry {
    pub stock_id: RunStockId,
    pub modifier_id: ModifierId,
    pub tier: ModifierTier,
    pub price: Money,
    /// Initial offered quantity; never mutated after generation.
    pub initial_quantity: u16,
    /// Remaining purchasable quantity; sold state derives from zero.
    pub remaining_quantity: u16,
    pub sold: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SurfaceHeader {
    pub schema_version: u32,
    pub surface_id: RunSurfaceId,
    pub kind: RunSurfaceKind,
    pub owner_seat: SeatId,
    pub interaction_sequence: RunInteractionSequence,
    pub action_ordinal: u32,
    pub operation_id: OperationId,
    pub menu: LogicalMenu,
    pub surface_digest: SurfaceDigest,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoveLearnSurfaceState {
    pub header: SurfaceHeader,
    pub task: LearnMoveTask,
    pub pending_slot: Option<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RewardShopSurfaceState {
    pub header: SurfaceHeader,
    pub offers: Vec<RewardOffer>,
    pub lock_tiers: Vec<ModifierTier>,
    pub reroll_count: u32,
    pub reroll_cost: Money,
    pub pending_target: Option<PendingModifierTarget>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BiomeMarketSurfaceState {
    pub header: SurfaceHeader,
    pub stock: Vec<MarketStockEntry>,
    pub pending_target: Option<PendingModifierTarget>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CrossroadsSurfaceState {
    pub header: SurfaceHeader,
    pub source_wave: WaveIndex,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BiomeSelectSurfaceState {
    pub header: SurfaceHeader,
    pub routes: Vec<RouteNode>,
    pub inherited_crossroads_sequence: Option<RunInteractionSequence>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunSurfaceState {
    MoveLearn(MoveLearnSurfaceState),
    RewardShop(RewardShopSurfaceState),
    BiomeMarket(BiomeMarketSurfaceState),
    Crossroads(CrossroadsSurfaceState),
    BiomeSelect(BiomeSelectSurfaceState),
}

impl RunSurfaceState {
    pub fn header(&self) -> &SurfaceHeader {
        match self {
            Self::MoveLearn(value) => &value.header,
            Self::RewardShop(value) => &value.header,
            Self::BiomeMarket(value) => &value.header,
            Self::Crossroads(value) => &value.header,
            Self::BiomeSelect(value) => &value.header,
        }
    }

    pub fn header_mut(&mut self) -> &mut SurfaceHeader {
        match self {
            Self::MoveLearn(value) => &mut value.header,
            Self::RewardShop(value) => &mut value.header,
            Self::BiomeMarket(value) => &mut value.header,
            Self::Crossroads(value) => &mut value.header,
            Self::BiomeSelect(value) => &mut value.header,
        }
    }

    pub fn validate(&self) -> Result<(), RunStateValidationError> {
        let header = self.header();
        if header.schema_version != RUN_SURFACE_STATE_SCHEMA_VERSION {
            return Err(RunStateValidationError::SurfaceSchemaVersionMismatch {
                expected: RUN_SURFACE_STATE_SCHEMA_VERSION,
                actual: header.schema_version,
            });
        }
        header
            .menu
            .validate()
            .map_err(RunStateValidationError::Menu)?;
        if header.menu.owner_seat != header.owner_seat {
            return Err(RunStateValidationError::SurfaceOwnerMismatch);
        }
        let expected_kind = match self {
            Self::MoveLearn(_) => RunSurfaceKind::MoveLearn,
            Self::RewardShop(_) => RunSurfaceKind::RewardShop,
            Self::BiomeMarket(_) => RunSurfaceKind::BiomeMarket,
            Self::Crossroads(_) => RunSurfaceKind::Crossroads,
            Self::BiomeSelect(_) => RunSurfaceKind::BiomeSelect,
        };
        if header.kind != expected_kind {
            return Err(RunStateValidationError::SurfaceKindMismatch);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunStateV2 {
    pub schema_version: u32,
    pub run_id: GameRunId,
    pub seed: String,
    pub wave: WaveIndex,
    pub next_battle_id: BattleId,
    pub run_rng: RunRngState,
    pub stage: RunStage,
    pub outcome: RunOutcome,
    pub money: Money,
    pub modifiers: Vec<RunModifierInstance>,
    pub progression: ProgressionQueue,
    pub active_surface: Option<RunSurfaceState>,
    pub biome: BiomeRuntimeState,
    pub counters: RunCounters,
}

#[derive(Debug, Error)]
pub enum RunStateValidationError {
    #[error("RunStateV2 schema version must be {expected}, got {actual}")]
    SchemaVersionMismatch { expected: u32, actual: u32 },
    #[error("run battle allocator cannot be zero")]
    ZeroNextBattleId,
    #[error("run RNG state is invalid: {0}")]
    RunRng(#[source] er_rng::phaser::RngError),
    #[error("progression queue schema version must be {expected}, got {actual}")]
    ProgressionQueueSchemaVersionMismatch { expected: u32, actual: u32 },
    #[error("progression task envelope schema version must be {expected}, got {actual}")]
    ProgressionTaskSchemaVersionMismatch { expected: u32, actual: u32 },
    #[error("progression active index {index} is outside task queue length {length}")]
    ProgressionActiveIndexOutOfRange { index: u32, length: usize },
    #[error("surface logical menu is invalid: {0}")]
    Menu(#[source] er_types::ui_menu::LogicalMenuError),
    #[error("surface owner does not match logical menu owner")]
    SurfaceOwnerMismatch,
    #[error("progression task ID appears more than once")]
    DuplicateTaskId,
    #[error("progression task ID is not below its allocator")]
    TaskAllocatorMismatch,
    #[error("surface ID allocator cannot be zero")]
    ZeroSurfaceAllocator,
    #[error("surface schema version must be {expected}, got {actual}")]
    SurfaceSchemaVersionMismatch { expected: u32, actual: u32 },
    #[error("surface kind does not match its variant")]
    SurfaceKindMismatch,
    #[error("market stock entry {stock_id:?} has inconsistent quantity/sold state")]
    MarketStockQuantity { stock_id: RunStockId },
}

impl RunStateV2 {
    pub fn validate(&self) -> Result<(), RunStateValidationError> {
        if self.schema_version != RUN_STATE_SCHEMA_VERSION {
            return Err(RunStateValidationError::SchemaVersionMismatch {
                expected: RUN_STATE_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        if self.next_battle_id == BattleId::ZERO {
            return Err(RunStateValidationError::ZeroNextBattleId);
        }
        self.run_rng
            .rdg
            .validate()
            .map_err(RunStateValidationError::RunRng)?;
        if self.progression.schema_version != PROGRESSION_QUEUE_SCHEMA_VERSION {
            return Err(
                RunStateValidationError::ProgressionQueueSchemaVersionMismatch {
                    expected: PROGRESSION_QUEUE_SCHEMA_VERSION,
                    actual: self.progression.schema_version,
                },
            );
        }
        if let Some(index) = self.progression.active_index {
            if usize::try_from(index).map_or(true, |index| index >= self.progression.tasks.len()) {
                return Err(RunStateValidationError::ProgressionActiveIndexOutOfRange {
                    index,
                    length: self.progression.tasks.len(),
                });
            }
        }
        let mut task_ids = BTreeSet::new();
        for envelope in &self.progression.tasks {
            if envelope.schema_version != PROGRESSION_TASK_SCHEMA_VERSION {
                return Err(
                    RunStateValidationError::ProgressionTaskSchemaVersionMismatch {
                        expected: PROGRESSION_TASK_SCHEMA_VERSION,
                        actual: envelope.schema_version,
                    },
                );
            }
            if !task_ids.insert(envelope.task_id) {
                return Err(RunStateValidationError::DuplicateTaskId);
            }
            if envelope.task_id.get().get() >= self.progression.next_task_id.get().get() {
                return Err(RunStateValidationError::TaskAllocatorMismatch);
            }
        }
        if self.counters.next_surface_id == RunSurfaceId::ZERO {
            return Err(RunStateValidationError::ZeroSurfaceAllocator);
        }
        if let Some(surface) = &self.active_surface {
            surface.validate()?;
            if let RunSurfaceState::BiomeMarket(market) = surface {
                for entry in &market.stock {
                    let sold_derived = entry.remaining_quantity == 0;
                    if entry.remaining_quantity > entry.initial_quantity
                        || entry.initial_quantity == 0
                        || entry.sold != sold_derived
                    {
                        return Err(RunStateValidationError::MarketStockQuantity {
                            stock_id: entry.stock_id,
                        });
                    }
                }
            }
        }
        Ok(())
    }
}

pub fn battle_outcome_is_terminal(outcome: BattleOutcome) -> bool {
    !matches!(outcome, BattleOutcome::Ongoing)
}

// Re-export action leaves from the contract-owned type module. These names are
// intentionally not reconstructed in er-state.
pub use er_types::run_ids::{
    BiomeId, EncounterId, GameRunId, ModifierId, Money, RouteNodeId, RunContentPackHash,
    RunInteractionSequence, RunOfferId, RunStockId, RunSurfaceId, RunTaskId, SurfaceDigest,
};
pub use er_types::run_model::{
    BiomeMarketAction, CrossroadsAction, RewardAction, RunSurfaceAction,
};
pub use er_types::ui_menu::LogicalMenu;
