//! Deterministic run-state content, validation, and pure M4 mechanics.

pub mod biome;
pub mod capability;
pub mod capture;
pub mod content;
pub mod economy_surface;
pub mod encounter;
pub mod encounter_plan;
pub mod error;
pub mod experience;
pub mod modifier;
pub mod money;
pub mod move_learning;
pub mod progression;
pub mod reward;
pub mod rng_audit;
pub mod run_material;
pub mod settlement;
pub mod stats;
pub mod transition;

pub use biome::*;
pub use capability::*;
pub use capture::*;
pub use content::*;
pub use economy_surface::*;
pub use encounter_plan::*;
pub use error::*;
pub use experience::*;
pub use modifier::*;
pub use money::*;
pub use move_learning::*;
pub use progression::*;
pub use reward::*;
pub use rng_audit::*;
pub use run_material::*;
pub use settlement::*;
pub use stats::*;
pub use transition::*;

// `encounter` is module-scoped only: its names (`prepare_encounter_plan`,
// `EncounterBuildError`) are re-exported explicitly to avoid colliding with
// the glob of `encounter_plan`.
pub use encounter::{EncounterBuildError, prepare_encounter_plan};
