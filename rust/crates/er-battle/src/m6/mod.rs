//! M6B move-routine battle adapters.
//!
//! Direct execution adapters over prepared, validated move-routine program
//! specs. No alternate mechanics path lives here: programs outside the
//! closed move-routine surface are rejected at preparation time.

pub mod move_executor;

pub use move_executor::{
    prepare_move_routine, MoveRoutineAdapterError, MoveRoutineStep, PreparedMoveRoutine,
};
