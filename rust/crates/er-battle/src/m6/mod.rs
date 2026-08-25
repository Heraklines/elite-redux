//! M6B move-routine battle adapters.
//!
//! Direct execution adapters over prepared, validated move-routine program
//! specs. No alternate mechanics path lives here: programs outside the
//! closed move-routine surface are rejected at preparation time.

pub mod ability_executor;
pub mod bespoke;
pub mod item_executor;
pub mod move_executor;
pub mod routine_executor;
pub mod status_field_executor;
pub mod switch_target_executor;

pub use move_executor::{
    MoveRoutineAdapterError, MoveRoutineStep, PreparedMoveRoutine, prepare_move_routine,
};

pub use routine_executor::{
    MechanicsContextV2, MechanicsErrorV2, MechanicsOperationEvidenceV2, MechanicsTransitionV2,
    QueryEvidenceV2, QueryTransitionV2, QueryValueV2, execute_hook_v2,
    execute_hook_v2_direct_reference, execute_query_v2, execute_query_v2_direct_reference,
};
