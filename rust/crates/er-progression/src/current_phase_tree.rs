//! The canonical state crate owns the source phase queue and its snapshot.
//! Preserve the progression API for existing callers and source witnesses.
pub use er_state::current_phase_tree::{
    CurrentPhaseTree, CurrentPhaseTreeError, CurrentPhaseTreeSnapshot, MAX_CURRENT_PHASE_LEVELS,
    MAX_CURRENT_QUEUED_PHASES,
};
