//! Deterministic battle-game runtime for PokéRogue Redux.

#[doc(hidden)]
pub mod authority_commands;
pub mod battle_adapter_v2;
pub mod battle_start_v2;
pub mod command_menu;
pub mod internal_event;
pub mod m6;
pub mod m72_bootstrap;
pub mod m72_new_run_material;
pub mod m7_content;
pub mod m7_internal_event;
pub mod m7_material;
pub mod m7_progression_control;
pub mod m7_run_executor;
pub mod m7_runtime;
pub mod m9_new_run;
pub mod m9e_content_v2;
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
