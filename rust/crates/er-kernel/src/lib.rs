//! Deterministic input/menu kernel for PokéRogue Redux.

pub mod input_router;
pub mod kernel;
pub mod ui_reducer;

pub use input_router::{InputRouteError, InputRouter};
pub use kernel::{
    GameKernel, KernelConfig, KernelEffect, KernelError, KernelInput, KernelSnapshot,
    LiveResourceSnapshot,
};
pub use ui_reducer::UiReducer;
