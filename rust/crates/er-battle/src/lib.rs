//! Deterministic command legality and battle mechanics for PokéRogue Redux.

pub mod accuracy;
pub mod action_order;
pub mod critical;
pub mod damage;
pub mod command;
pub mod error;
pub mod js_math;
pub mod legality;
pub mod resolver;
pub mod stat_stage;
pub mod status;
pub mod type_effectiveness;

pub use resolver::{
    BattleMutation, BattleNextDecision, BattleReplacementTransition, BattleTransition,
};
