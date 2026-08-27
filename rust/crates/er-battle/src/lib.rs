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
pub mod m6;
pub mod m7_resolver;
pub mod mechanics;
pub mod mechanics_condition;
pub mod mechanics_executor;
pub mod mechanics_mutation;
pub mod mechanics_query;
pub mod mechanics_selector;
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
    PRESENTATION_PLAN_DIGEST_DOMAIN, PresentationPlanDigestComputationError,
    compute_presentation_plan_digest, validate_battle_mutation_evidence,
};
pub use turn::{
    resolve_replacement, resolve_replacement_trusted, resolve_turn, resolve_turn_trusted,
    resolve_turn_trusted_with_finalizer,
};
