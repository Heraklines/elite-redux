//! Shared deterministic DTOs for the PokéRogue Redux Rust kernel.

pub mod authority;
pub mod battle_command;
pub mod battle_control;
pub mod battle_ids;
pub mod battle_model;
pub mod battle_ui;
pub mod ids;
pub mod input;
pub mod protocol;
pub mod run_control;
pub mod run_ids;
pub mod run_model;
pub mod trace;
pub mod trace_v3;
pub mod ui;
pub mod ui_menu;

pub use authority::*;
pub use ids::*;
pub use input::*;
pub use protocol::*;
pub use run_control::{
    BiomeMarketControl, BiomeSelectControl, CrossroadsControl, GameControl, GameControlPlan,
    GameControlPlanError, MoveLearnControl, PresentationBarrier, RewardShopControl,
    SeatControlPlan, SurfaceControl,
};
pub use run_ids::{
    BiomeId, EncounterId, Experience, GameRunId, GrowthRateId, ModifierId, Money, NatureId,
    RouteNodeId, RunContentPackHash, RunContentPackHashError, RunInteractionSequence, RunOfferId,
    RunStockId, RunSurfaceId, RunTaskId, SurfaceDigest, SurfaceDigestError,
};
pub use run_model::{
    BiomeMarketAction, BiomeSelectAction, CrossroadsAction, LearnMoveDecision, ModifierTier,
    ModifierTierError, RewardAction, RunOutcome, RunStage, RunSurfaceAction, RunSurfaceKind,
};
pub use trace::*;
pub use trace_v3::*;
pub use ui::*;
pub use ui_menu::{
    LogicalMenu, LogicalMenuError, LogicalMenuOption, LogicalMenuOptionError, MenuNavigation,
    MenuNavigationEdge, MenuNavigationError, MenuOptionLayout, NavigationDirection,
};

#[cfg(test)]
mod tests {
    use crate::SafeU53;

    #[test]
    fn safe_integer_boundary_is_exclusive() {
        assert!(SafeU53::new(9_007_199_254_740_991).is_ok());
        assert!(SafeU53::new(9_007_199_254_740_992).is_err());
    }
}
