//! M6 deterministic semantic compiler foundation.
//!
//! The foundation consumes a validated [`er_content::m6_catalog::SemanticCatalogV1`]
//! and emits deterministic typed pack ingredients:
//!
//! - exact identity validation against the frozen oracle SHA and the expected
//!   raw-catalog hash;
//! - frozen-order iteration over sources and behavior units;
//! - `RESOLVED_INTRINSIC` units compile only through explicit closed
//!   intrinsic rules; there is no attribute-name or hook-text matching and no
//!   default rule;
//! - `RESOLVED_OPERANDS` and `BESPOKE_GAP` stay explicit unresolved outcomes
//!   and never silently become compiled programs;
//! - stable positive program IDs allocated in frozen source order,
//!   independent of hash-map iteration;
//! - behavior classifications, the bespoke manifest, and exact closure
//!   counts with first-error context in frozen order.
//!
//! The foundation fabricates no semantics: RNG sites remain non-executable
//! bespoke gaps (every catalog site carries an unresolved range gap), so no
//! pack `RngSiteDefinitionV1` ingredient is emitted until audited schemas
//! freeze their ranges. Per-attribute program bodies arrive in M6B modules.

pub mod catalog;
pub mod pipeline;
pub mod routine;

pub use catalog::{
    CatalogValidationError, M6_ORACLE_SHA, SemanticCatalogInput, ValidatedSemanticCatalog,
};
pub use pipeline::{
    BehaviorCompilation, BehaviorCompileOutcome, BespokeAssignment, CompileFailureContext,
    CompilerOptions, INTRINSIC_RULE_MISSING_REASON, IntrinsicRule, OPERAND_SCHEMA_MISSING_REASON,
    ProgramAllocation, SEMANTIC_COMPILE_REPORT_SCHEMA_VERSION, SemanticCompileError,
    SemanticCompileOutput, SemanticCompileReport, SemanticCompileRequest, compile_semantics,
};
pub use routine::{
    MappingFamily, MappingRuleId, RoutineCompileError, RoutineProgramSpec, boolean_operand,
    implementation_name, operand, safe_integer_operand, string_operand,
};
