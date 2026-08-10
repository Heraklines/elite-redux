//! Deterministic command legality and battle mechanics for PokéRogue Redux.

pub mod ability;
pub mod ability_pipeline;
pub mod accuracy;
pub mod action_order;
pub mod command;
pub mod critical;
pub mod damage;
pub mod error;
pub mod faint;
pub mod js_math;
pub mod legality;
pub mod move_effect;
pub mod move_pipeline;
pub mod outcome;
pub mod presentation;
pub mod replacement;
pub mod resolver;
pub mod stat_stage;
pub mod status;
pub mod switch;
pub mod turn;
pub mod type_effectiveness;

pub use outcome::derive_battle_outcome;
pub use resolver::{
    BattleMutation, BattleNextDecision, BattleReplacementTransition, BattleTransition,
};
pub use turn::{resolve_replacement, resolve_turn};
