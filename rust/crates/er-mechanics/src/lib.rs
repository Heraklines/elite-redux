//! Closed, versioned M5 mechanics intermediate representation.
//!
//! This crate owns immutable DTOs and validation only. Execution belongs to
//! `er-battle`; source extraction and compilation belong to offline tooling.

pub mod condition;
pub mod condition_v2;
pub mod families;
pub mod ids;
pub mod m6;
pub mod operation;
pub mod program;
pub mod selector;
pub mod v2;
pub mod value;

pub use condition::*;
pub use families::*;
pub use ids::*;
pub use m6::*;
pub use operation::*;
pub use program::*;
pub use selector::*;
pub use value::*;
pub use v2::{
    compare_ordered_sources, AbilitySourceRank, MechanicHookV2, MechanicQueryV2,
    OrderedMechanicSource, OrderedSourceClass, OrderedSourceError,
};
