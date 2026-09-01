//! Deterministic offline semantic compiler for the PokéRogue Redux battle kernel.
//!
//! The crate is an offline tool: production crates never link it and never
//! read TypeScript. The library target exposes the typed M6 semantic compile
//! surface so the offline binary and integration proofs share one
//! implementation.
//!
//! Production TypeScript stays read-only; nothing in this crate parses,
//! embeds, or executes script content.

pub mod m6;
pub mod m7;
pub mod m7_world;
pub mod m9;
pub mod m9e_ai;
pub mod m9e_bundle;
pub mod m9e_full_content;
pub mod m9e_presentation;
pub mod m9e_progression;
pub mod m9e_scenario;
