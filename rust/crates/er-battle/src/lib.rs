//! Deterministic command legality and battle mechanics for PokéRogue Redux.

pub mod command;
pub mod error;
pub mod legality;
pub mod resolver;

pub use resolver::{
    BattleMutation, BattleNextDecision, BattleReplacementTransition, BattleTransition,
};
