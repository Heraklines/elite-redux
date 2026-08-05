//! Deterministic input/menu kernel for PokéRogue Redux.

pub mod input_router;
pub mod kernel;
pub mod ui_reducer;

pub use input_router::{InputRouteError, InputRouter};
pub use kernel::{
    AuthorityResolutionPlan, ControlMenuPlan, GameKernel, KernelConfig, KernelEffect, KernelError,
    KernelInput, KernelSnapshot, LiveResourceSnapshot, MenuProposalPlan, ProtocolKernelConfig,
    ProtocolRoleConfig,
};
pub use ui_reducer::UiReducer;
