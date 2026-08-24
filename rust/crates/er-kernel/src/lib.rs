//! Deterministic input/menu kernel for PokéRogue Redux.

mod battle_authority;
mod battle_kernel;
mod battle_presentation;
mod battle_replica;
mod battle_ui;
pub mod input_router;
pub mod kernel;
pub mod snapshot;
pub mod snapshot_v3;
pub mod snapshot_v4;
pub mod snapshot_v5;
pub mod ui_reducer;

pub use battle_kernel::BattleInitializationError;
pub use er_game::runtime::{BattleGameConfig, BattleStartV1};
pub use input_router::{InputRouteError, InputRouter};
pub use kernel::{
    AuthorityResolutionPlan, BattleProtocolConfig, BattleProtocolRoleConfig, ControlMenuPlan,
    GameKernel, KernelConfig, KernelEffect, KernelError, KernelInput, KernelSnapshot,
    LiveResourceSnapshot, MenuProposalPlan, ProtocolKernelConfig, ProtocolRoleConfig,
    RunKernelRole,
};
pub use ui_reducer::UiReducer;
