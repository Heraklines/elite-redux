//! M4 per-seat run-control vocabulary frozen by `rust/contracts/m4-game-control.md`.
//!
//! Only the authoritative owner control is actionable; watchers receive the
//! same logical surface as a non-actionable projection. Control identity is
//! authority material, not renderer state.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::battle_control::{BattleControl, WaitingControl};
use crate::battle_ids::{MenuInstanceId, RunSurfaceId};
use crate::run_ids::RunInteractionSequence;
use crate::run_model::RunOutcome;
use crate::SeatId;

pub const GAME_CONTROL_PLAN_SCHEMA_VERSION: u32 = 1;

/// Presentation barrier policy installed with a logical control.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresentationBarrier {
    NonBlocking,
    BlocksHumanInput,
}

/// One run-surface logical control. Every variant carries its stable surface
/// identity and the exact frozen menu graph for that surface.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SurfaceControl {
    MoveLearn(MoveLearnControl),
    RewardShop(RewardShopControl),
    BiomeMarket(BiomeMarketControl),
    Crossroads(CrossroadsControl),
    BiomeSelect(BiomeSelectControl),
}

macro_rules! surface_controls {
    ($($variant:ident => $control:ident),+ $(,)?) => {
        $(
            #[doc = concat!("The ", stringify!($variant), " surface control projection.")]
            #[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
            #[serde(deny_unknown_fields)]
            pub struct $control {
                pub surface_id: RunSurfaceId,
                pub interaction_sequence: RunInteractionSequence,
                pub menu: LogicalMenu,
            }

            impl $control {
                pub fn new(
                    surface_id: RunSurfaceId,
                    interaction_sequence: RunInteractionSequence,
                    menu: LogicalMenu,
                ) -> Self {
                    Self {
                        surface_id,
                        interaction_sequence,
                        menu,
                    }
                }
            }

            impl From<$control> for SurfaceControl {
                fn from(value: $control) -> Self {
                    Self::$variant(value)
                }
            }
        )+
    };
}

surface_controls! {
    MoveLearn => MoveLearnControl,
    RewardShop => RewardShopControl,
    BiomeMarket => BiomeMarketControl,
    Crossroads => CrossroadsControl,
    BiomeSelect => BiomeSelectControl,
}

impl SurfaceControl {
    pub fn surface_id(&self) -> RunSurfaceId {
        match self {
            Self::MoveLearn(control) => control.surface_id,
            Self::RewardShop(control) => control.surface_id,
            Self::BiomeMarket(control) => control.surface_id,
            Self::Crossroads(control) => control.surface_id,
            Self::BiomeSelect(control) => control.surface_id,
        }
    }

    pub fn interaction_sequence(&self) -> RunInteractionSequence {
        match self {
            Self::MoveLearn(control) => control.interaction_sequence,
            Self::RewardShop(control) => control.interaction_sequence,
            Self::BiomeMarket(control) => control.interaction_sequence,
            Self::Crossroads(control) => control.interaction_sequence,
            Self::BiomeSelect(control) => control.interaction_sequence,
        }
    }

    pub fn menu(&self) -> &LogicalMenu {
        match self {
            Self::MoveLearn(control) => &control.menu,
            Self::RewardShop(control) => &control.menu,
            Self::BiomeMarket(control) => &control.menu,
            Self::Crossroads(control) => &control.menu,
            Self::BiomeSelect(control) => &control.menu,
        }
    }
}

/// The complete closed run-control vocabulary.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GameControl {
    Battle(BattleControl),
    Surface(SurfaceControl),
    Waiting(WaitingControl),
    Complete(RunOutcome),
}

impl From<SurfaceControl> for GameControl {
    fn from(value: SurfaceControl) -> Self {
        Self::Surface(value)
    }
}

/// One seat's projected control and presentation barrier.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SeatControlPlan {
    pub seat: SeatId,
    pub owner: bool,
    /// Control identity string; matches the projected menu's `control_id`.
    pub control_id: String,
    pub menu_instance_id: MenuInstanceId,
    pub actionable_after: PresentationBarrier,
    pub control: GameControl,
}

/// The authority-stated next control for every human seat.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameControlPlan {
    pub schema_version: u32,
    pub seats: Vec<SeatControlPlan>,
    pub next_control_id: String,
    pub next_menu_instance_id: MenuInstanceId,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum GameControlPlanError {
    #[error("unsupported GameControlPlan schema version {actual}; expected {expected}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("GameControlPlan must contain at least one seat")]
    EmptySeats,
    #[error("GameControlPlan seat appears more than once")]
    DuplicateSeat,
    #[error("GameControlPlan must designate exactly one authoritative owner")]
    OwnerCount { owners: usize },
    #[error("GameControlPlan allocator identity cannot be zero")]
    ZeroAllocator,
    #[error("GameControlPlan control identity must not be empty")]
    EmptyControlId,
}

impl GameControlPlan {
    pub fn new(
        seats: Vec<SeatControlPlan>,
        next_control_id: String,
        next_menu_instance_id: MenuInstanceId,
    ) -> Result<Self, GameControlPlanError> {
        let plan = Self {
            schema_version: GAME_CONTROL_PLAN_SCHEMA_VERSION,
            seats,
            next_control_id,
            next_menu_instance_id,
        };
        plan.validate()?;
        Ok(plan)
    }

    pub fn validate(&self) -> Result<(), GameControlPlanError> {
        if self.schema_version != GAME_CONTROL_PLAN_SCHEMA_VERSION {
            return Err(GameControlPlanError::SchemaVersion {
                expected: GAME_CONTROL_PLAN_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        if self.seats.is_empty() {
            return Err(GameControlPlanError::EmptySeats);
        }
        let mut seen = std::collections::BTreeSet::new();
        for seat in &self.seats {
            if !seen.insert(seat.seat) {
                return Err(GameControlPlanError::DuplicateSeat);
            }
        }
        let owners = self.seats.iter().filter(|seat| seat.owner).count();
        if owners != 1 {
            return Err(GameControlPlanError::OwnerCount { owners });
        }
        if self.next_control_id.is_empty()
            || self.seats.iter().any(|seat| seat.control_id.is_empty())
        {
            return Err(GameControlPlanError::EmptyControlId);
        }
        if self.next_menu_instance_id == MenuInstanceId::ZERO {
            return Err(GameControlPlanError::ZeroAllocator);
        }
        Ok(())
    }

    /// The authoritative owner seat, validated to exist exactly once.
    pub fn owner_seat(&self) -> SeatId {
        self.seats
            .iter()
            .find(|seat| seat.owner)
            .map(|seat| seat.seat)
            .expect("validated plan has exactly one owner")
    }
}
