//! Deterministic battle-game runtime for PokéRogue Redux.

#[doc(hidden)]
pub mod authority_commands;
pub mod battle_start_v2;
pub mod command_menu;
pub mod internal_event;
// The local adapter remains production source while its kernel integration
// seam is staged; its contract tests include this source directly.
#[allow(dead_code)]
mod local_battle;
pub mod material;
pub mod move_menu;
pub mod party_menu;
pub mod party_option_menu;
pub mod replacement_menu;
pub mod run_menu;
pub mod run_runtime;
pub mod run_transition;
pub mod runtime;
pub mod snapshot;
pub mod target_menu;
pub mod transaction;
