//! Deterministic command legality and battle mechanics for PokéRogue Redux.

pub mod ability;
pub mod ability_pipeline;
pub mod accuracy;
pub mod action_order;
pub mod command;
pub mod critical;
pub mod damage;
pub mod error;
pub mod js_math;
pub mod legality;
pub mod resolver;
pub mod stat_stage;
pub mod status;
pub mod switch;
pub mod type_effectiveness;

pub use resolver::{
    BattleMutation, BattleNextDecision, BattleReplacementTransition, BattleTransition,
};
