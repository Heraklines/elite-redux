//! Deterministic semantic compile pipeline.
//!
//! [`compile_semantics`] walks a [`ValidatedSemanticCatalog`] in frozen
//! source/behavior-unit order and derives, without any hash-map iteration on
//! a canonical path:
//!
//! - one explicit [`BehaviorCompileOutcome`] per behavior unit;
//! - `RESOLVED_INTRINSIC` compilation strictly through caller-supplied
//!   closed [`IntrinsicRule`]s matched by exact behavior-unit identity;
//! - stable positive [`MechanicsProgramId`] allocation, one program per
//!   source identity that owns compiled units, IDs increasing in frozen
//!   source order from the configured base regardless of any map content;
//! - [`BehaviorClassificationManifestV2`] entries sorted by ascending
//!   behavior-unit identity (the catalog order), with deterministic
//!   unsupported reasons for unresolved intrinsic and operand outcomes;
//! - a [`BespokeManifestV2`] grouped by mechanic with sorted unique units;
//! - exact closure counts in [`SemanticCompileReport`].
//!
//! Unresolved outcomes are data, never conversions: an unmatched
//! `RESOLVED_INTRINSIC` unit becomes `INTRINSIC_RULE_MISSING`, a
//! `RESOLVED_OPERANDS` unit becomes `OPERAND_SCHEMA_MISSING` (no audited
//! per-attribute schema exists at G21), and a `BESPOKE_GAP` unit must carry
//! exactly one bespoke assignment or compilation fails with first-error
//! context in frozen order.

use std::collections::{BTreeMap, BTreeSet};

use er_content::m6_catalog::{
    CatalogBehaviorUnit, CatalogProvenance, CatalogResolution, CatalogRngBindingStatus,
};
use er_content::pack::m6_pack::{
    BESPOKE_MANIFEST_SCHEMA_VERSION_V2, BehaviorClassificationEntryV2,
    BehaviorClassificationManifestV2, BespokeManifestEntryV2, BespokeManifestV2,
};
use er_types::mechanics::MechanicsProgramId;
use er_types::{
    BehaviorClassificationKindV2, BehaviorSourceId, BehaviorUnitId, BespokeMechanicId, SafeU53,
};
use thiserror::Error;

use crate::m6::catalog::ValidatedSemanticCatalog;

/// Schema version of [`SemanticCompileReport`].
pub const SEMANTIC_COMPILE_REPORT_SCHEMA_VERSION: u32 = 1;

/// Deterministic unsupported reason for a `RESOLVED_INTRINSIC` unit that no
/// explicit intrinsic rule admits.
pub const INTRINSIC_RULE_MISSING_REASON: &str = "INTRINSIC_RULE_MISSING";

/// Deterministic unsupported reason for a `RESOLVED_OPERANDS` unit: its
/// descriptors fit the closed vocabulary, but no audited per-attribute
/// schema freezes hook, condition, operand types, selector, or operations.
pub const OPERAND_SCHEMA_MISSING_REASON: &str = "OPERAND_SCHEMA_MISSING";

/// Compile options. The only tunable is where positive program-ID
/// allocation starts; allocation order itself is frozen.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CompilerOptions {
    /// First allocated program ID. Must be a positive safe integer; IDs then
    /// increase by one per compiled source identity in frozen source order.
    pub first_program_id: u64,
}

impl CompilerOptions {
    /// Default options: program IDs start at 1.
    pub fn new() -> Self {
        Self {
            first_program_id: 1,
        }
    }
}

impl Default for CompilerOptions {
    fn default() -> Self {
        Self::new()
    }
}

/// Explicit closed admission of one `RESOLVED_INTRINSIC` behavior unit into
/// compiled status. Matching is by exact behavior-unit identity only; there
/// is deliberately no attribute-name, hook-text, or effect-kind dispatch.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntrinsicRule {
    pub behavior_unit: BehaviorUnitId,
}

/// Explicit routing of one closed bespoke cluster to its mechanic.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BespokeAssignment {
    pub mechanic: BespokeMechanicId,
    pub behavior_units: Vec<BehaviorUnitId>,
}

/// Typed compile request. Rules and assignments are validated before any
/// output is produced; nothing is emitted for a failing request.
#[derive(Clone, Copy, Debug)]
pub struct SemanticCompileRequest<'a> {
    pub catalog: &'a ValidatedSemanticCatalog,
    pub intrinsic_rules: &'a [IntrinsicRule],
    pub bespoke_assignments: &'a [BespokeAssignment],
    pub options: CompilerOptions,
}

#[derive(Debug, Error)]
pub enum SemanticCompileError {
    #[error("intrinsic rule {index} targets unknown behavior unit {unit:?}")]
    UnknownIntrinsicRuleUnit { index: usize, unit: BehaviorUnitId },
    #[error(
        "intrinsic rule {index} targets unit {unit:?} whose resolution is {resolution:?}, only RESOLVED_INTRINSIC units may compile"
    )]
    IntrinsicRuleResolution {
        index: usize,
        unit: BehaviorUnitId,
        resolution: CatalogResolution,
    },
    #[error("intrinsic rule {index} duplicates an earlier rule for unit {unit:?}")]
    DuplicateIntrinsicRule { index: usize, unit: BehaviorUnitId },
    #[error("bespoke assignment {index} targets unknown behavior unit {unit:?}")]
    UnknownBespokeUnit { index: usize, unit: BehaviorUnitId },
    #[error(
        "bespoke assignment {index} targets unit {unit:?} whose resolution is {resolution:?}, only BESPOKE_GAP units may be assigned"
    )]
    BespokeAssignmentResolution {
        index: usize,
        unit: BehaviorUnitId,
        resolution: CatalogResolution,
    },
    #[error("bespoke assignment {index} duplicates an earlier assignment for unit {unit:?}")]
    DuplicateBespokeAssignment { index: usize, unit: BehaviorUnitId },
    #[error("bespoke assignment {index} for mechanic {mechanic:?} carries no behavior units")]
    EmptyBespokeAssignment {
        index: usize,
        mechanic: BespokeMechanicId,
    },
    #[error("BESPOKE_GAP behavior unit has no bespoke assignment: {context:?}")]
    UnassignedBespokeGap { context: CompileFailureContext },
    #[error("first_program_id must be a positive safe integer, got {value}")]
    InvalidFirstProgramId { value: u64 },
    #[error("program id space exhausted after {allocated} allocations")]
    ProgramIdExhausted { allocated: u64 },
}

/// First failing behavior unit in frozen order, with provenance coordinates.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
pub struct CompileFailureContext {
    pub unit: BehaviorUnitId,
    pub provenance_path: String,
    pub provenance_line: u32,
    pub provenance_column: u32,
    pub resolution: CatalogResolution,
}

/// Explicit per-unit compile outcome.
#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BehaviorCompileOutcome {
    /// Compiled through an explicit intrinsic rule into the given program.
    Compiled { program: MechanicsProgramId },
    /// `RESOLVED_INTRINSIC` without an explicit intrinsic rule.
    IntrinsicRuleMissing,
    /// `RESOLVED_OPERANDS` without an audited per-attribute schema.
    OperandSchemaMissing,
    /// `BESPOKE_GAP` routed to its closed bespoke mechanic.
    BespokeCluster(BespokeMechanicId),
}

impl BehaviorCompileOutcome {
    fn classification_kind(&self) -> BehaviorClassificationKindV2 {
        match self {
            Self::Compiled { .. } => BehaviorClassificationKindV2::Compiled,
            Self::BespokeCluster(_) => BehaviorClassificationKindV2::Bespoke,
            Self::IntrinsicRuleMissing | Self::OperandSchemaMissing => {
                BehaviorClassificationKindV2::Unsupported
            }
        }
    }

    fn unsupported_reason(&self) -> Option<&'static str> {
        match self {
            Self::IntrinsicRuleMissing => Some(INTRINSIC_RULE_MISSING_REASON),
            Self::OperandSchemaMissing => Some(OPERAND_SCHEMA_MISSING_REASON),
            _ => None,
        }
    }
}

/// Frozen-order compile record for one behavior unit.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
pub struct BehaviorCompilation {
    pub unit: BehaviorUnitId,
    pub provenance: CatalogProvenance,
    pub resolution: CatalogResolution,
    pub outcome: BehaviorCompileOutcome,
}

/// One allocated program: stable positive ID, owning source, and its
/// compiled behavior units in frozen order.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
pub struct ProgramAllocation {
    pub id: MechanicsProgramId,
    pub source: BehaviorSourceId,
    pub behavior_units: Vec<BehaviorUnitId>,
}

/// Deterministic typed pack ingredients plus the exact closure report.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
pub struct SemanticCompileOutput {
    /// Sorted by ascending behavior-unit identity.
    pub classifications: BehaviorClassificationManifestV2,
    /// Entries sorted by mechanic, units sorted and unique.
    pub bespoke: BespokeManifestV2,
    /// Ascending stable positive program IDs.
    pub programs: Vec<ProgramAllocation>,
    /// Per-unit records in frozen catalog order.
    pub units: Vec<BehaviorCompilation>,
    pub report: SemanticCompileReport,
}

/// Exact closure counts over one completed compile. Counts are derived from
/// the same records that produced the classifications, so they close by
/// construction and are asserted below before emission.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
pub struct SemanticCompileReport {
    pub schema_version: u32,
    pub oracle_sha: String,
    pub raw_catalog_hash: String,
    pub semantic_catalog_hash: String,
    pub source_count: usize,
    pub behavior_unit_count: usize,
    pub resolved_intrinsic_count: usize,
    pub resolved_operand_count: usize,
    pub bespoke_gap_count: usize,
    pub compiled_unit_count: usize,
    pub bespoke_unit_count: usize,
    pub unsupported_unit_count: usize,
    pub program_count: usize,
    pub intrinsic_rule_count: usize,
    /// RNG sites in the catalog; all remain non-executable bespoke gaps at
    /// G21 because their range/stream/singleton semantics are unresolved.
    pub rng_site_count: usize,
    pub rng_site_unresolved_count: usize,
}

fn failure_context(unit: &CatalogBehaviorUnit) -> CompileFailureContext {
    CompileFailureContext {
        unit: unit.id.clone(),
        provenance_path: unit.provenance.path.clone(),
        provenance_line: unit.provenance.line,
        provenance_column: unit.provenance.column,
        resolution: unit.semantic.resolution,
    }
}

fn validate_intrinsic_rules(
    request: &SemanticCompileRequest<'_>,
    unit_index: &BTreeMap<BehaviorUnitId, usize>,
) -> Result<BTreeSet<BehaviorUnitId>, SemanticCompileError> {
    let units = request.catalog.behavior_units();
    let mut admitted = BTreeSet::new();
    for (index, rule) in request.intrinsic_rules.iter().enumerate() {
        let Some(&position) = unit_index.get(&rule.behavior_unit) else {
            return Err(SemanticCompileError::UnknownIntrinsicRuleUnit {
                index,
                unit: rule.behavior_unit.clone(),
            });
        };
        let resolution = units[position].semantic.resolution;
        if resolution != CatalogResolution::ResolvedIntrinsic {
            return Err(SemanticCompileError::IntrinsicRuleResolution {
                index,
                unit: rule.behavior_unit.clone(),
                resolution,
            });
        }
        if !admitted.insert(rule.behavior_unit.clone()) {
            return Err(SemanticCompileError::DuplicateIntrinsicRule {
                index,
                unit: rule.behavior_unit.clone(),
            });
        }
    }
    Ok(admitted)
}

fn validate_bespoke_assignments(
    request: &SemanticCompileRequest<'_>,
    unit_index: &BTreeMap<BehaviorUnitId, usize>,
) -> Result<BTreeMap<BehaviorUnitId, BespokeMechanicId>, SemanticCompileError> {
    let units = request.catalog.behavior_units();
    let mut routed = BTreeMap::new();
    for (index, assignment) in request.bespoke_assignments.iter().enumerate() {
        if assignment.behavior_units.is_empty() {
            return Err(SemanticCompileError::EmptyBespokeAssignment {
                index,
                mechanic: assignment.mechanic,
            });
        }
        for unit in &assignment.behavior_units {
            let Some(&position) = unit_index.get(unit) else {
                return Err(SemanticCompileError::UnknownBespokeUnit {
                    index,
                    unit: unit.clone(),
                });
            };
            let resolution = units[position].semantic.resolution;
            if resolution != CatalogResolution::BespokeGap {
                return Err(SemanticCompileError::BespokeAssignmentResolution {
                    index,
                    unit: unit.clone(),
                    resolution,
                });
            }
            if routed.insert(unit.clone(), assignment.mechanic).is_some() {
                return Err(SemanticCompileError::DuplicateBespokeAssignment {
                    index,
                    unit: unit.clone(),
                });
            }
        }
    }
    Ok(routed)
}

fn parse_first_program_id(options: CompilerOptions) -> Result<u64, SemanticCompileError> {
    if options.first_program_id == 0 || SafeU53::new(options.first_program_id).is_err() {
        return Err(SemanticCompileError::InvalidFirstProgramId {
            value: options.first_program_id,
        });
    }
    Ok(options.first_program_id)
}

/// Runs the deterministic semantic compile. Identical requests always
/// produce identical outputs; no environment, map iteration order, wall
/// clock, or host state participates.
pub fn compile_semantics(
    request: SemanticCompileRequest<'_>,
) -> Result<SemanticCompileOutput, SemanticCompileError> {
    let next_base = parse_first_program_id(request.options)?;
    let units = request.catalog.behavior_units();

    let mut unit_index = BTreeMap::new();
    for (position, unit) in units.iter().enumerate() {
        unit_index.insert(unit.id.clone(), position);
    }

    let admitted = validate_intrinsic_rules(&request, &unit_index)?;
    let routed = validate_bespoke_assignments(&request, &unit_index)?;

    let mut next_program_id = next_base;
    let mut programs: Vec<ProgramAllocation> = Vec::new();
    let mut compilations: Vec<BehaviorCompilation> = Vec::with_capacity(units.len());
    let mut classifications = Vec::with_capacity(units.len());
    let mut compiled_unit_count = 0_usize;
    let mut cursor = 0_usize;

    // Sources and units are both frozen-ordered and closure-proven, so the
    // declared counts slice `units` into consecutive per-source ranges.
    for entry in request.catalog.sources() {
        let source = entry.source.clone();
        let mut source_program: Option<MechanicsProgramId> = None;
        for _ in 0..entry.behavior_unit_count {
            let unit = &units[cursor];
            cursor += 1;

            let outcome = match unit.semantic.resolution {
                CatalogResolution::ResolvedIntrinsic => {
                    if admitted.contains(&unit.id) {
                        let program = match source_program {
                            Some(program) => program,
                            None => {
                                let id = MechanicsProgramId::try_from_u64(next_program_id)
                                    .map_err(|_| SemanticCompileError::ProgramIdExhausted {
                                        allocated: next_program_id - next_base,
                                    })?;
                                next_program_id += 1;
                                source_program = Some(id);
                                programs.push(ProgramAllocation {
                                    id,
                                    source: source.clone(),
                                    behavior_units: Vec::new(),
                                });
                                id
                            }
                        };
                        if let Some(allocation) = programs.last_mut() {
                            allocation.behavior_units.push(unit.id.clone());
                        }
                        compiled_unit_count += 1;
                        BehaviorCompileOutcome::Compiled { program }
                    } else {
                        BehaviorCompileOutcome::IntrinsicRuleMissing
                    }
                }
                CatalogResolution::ResolvedOperands => BehaviorCompileOutcome::OperandSchemaMissing,
                CatalogResolution::BespokeGap => match routed.get(&unit.id) {
                    Some(mechanic) => BehaviorCompileOutcome::BespokeCluster(*mechanic),
                    None => {
                        return Err(SemanticCompileError::UnassignedBespokeGap {
                            context: failure_context(unit),
                        });
                    }
                },
            };

            let kind = outcome.classification_kind();
            classifications.push(BehaviorClassificationEntryV2 {
                behavior_unit: unit.id.clone(),
                kind,
                programs: match outcome {
                    BehaviorCompileOutcome::Compiled { program } => vec![program],
                    _ => Vec::new(),
                },
                bespoke: match outcome {
                    BehaviorCompileOutcome::BespokeCluster(mechanic) => Some(mechanic),
                    _ => None,
                },
                unsupported_reason: outcome.unsupported_reason().map(str::to_owned),
            });
            compilations.push(BehaviorCompilation {
                unit: unit.id.clone(),
                provenance: unit.provenance.clone(),
                resolution: unit.semantic.resolution,
                outcome,
            });
        }
    }

    debug_assert_eq!(cursor, units.len());

    let mut bespoke_units: BTreeMap<BespokeMechanicId, Vec<BehaviorUnitId>> = BTreeMap::new();
    for compilation in &compilations {
        if let BehaviorCompileOutcome::BespokeCluster(mechanic) = compilation.outcome {
            bespoke_units
                .entry(mechanic)
                .or_default()
                .push(compilation.unit.clone());
        }
    }
    let bespoke_entries = bespoke_units
        .into_iter()
        .map(|(mechanic, mut behavior_units)| {
            behavior_units.sort();
            BespokeManifestEntryV2 {
                mechanic,
                behavior_units,
            }
        })
        .collect();

    let bespoke_unit_count = compilations
        .iter()
        .filter(|record| matches!(record.outcome, BehaviorCompileOutcome::BespokeCluster(_)))
        .count();
    let unsupported_unit_count = units.len() - compiled_unit_count - bespoke_unit_count;
    debug_assert_eq!(
        compiled_unit_count + bespoke_unit_count + unsupported_unit_count,
        units.len()
    );
    debug_assert_eq!(classifications.len(), units.len());

    let resolutions = count_resolutions(units);
    debug_assert_eq!(
        resolutions.resolved_intrinsic + resolutions.resolved_operands + resolutions.bespoke_gap,
        units.len()
    );

    let rng_site_unresolved_count = request
        .catalog
        .rng_sites()
        .iter()
        .filter(|site| site.binding_status == CatalogRngBindingStatus::BespokeGap)
        .count();
    let program_count = programs.len();

    Ok(SemanticCompileOutput {
        classifications: BehaviorClassificationManifestV2(classifications),
        bespoke: BespokeManifestV2 {
            schema_version: BESPOKE_MANIFEST_SCHEMA_VERSION_V2,
            entries: bespoke_entries,
        },
        programs,
        units: compilations,
        report: SemanticCompileReport {
            schema_version: SEMANTIC_COMPILE_REPORT_SCHEMA_VERSION,
            oracle_sha: request.catalog.oracle_sha().to_owned(),
            raw_catalog_hash: request.catalog.raw_catalog_hash().to_owned(),
            semantic_catalog_hash: request.catalog.semantic_catalog_hash().as_str().to_owned(),
            source_count: request.catalog.sources().len(),
            behavior_unit_count: units.len(),
            resolved_intrinsic_count: resolutions.resolved_intrinsic,
            resolved_operand_count: resolutions.resolved_operands,
            bespoke_gap_count: resolutions.bespoke_gap,
            compiled_unit_count,
            bespoke_unit_count,
            unsupported_unit_count,
            program_count,
            intrinsic_rule_count: request.intrinsic_rules.len(),
            rng_site_count: request.catalog.rng_sites().len(),
            rng_site_unresolved_count,
        },
    })
}

struct ResolutionCounts {
    resolved_intrinsic: usize,
    resolved_operands: usize,
    bespoke_gap: usize,
}

fn count_resolutions(units: &[CatalogBehaviorUnit]) -> ResolutionCounts {
    let mut counts = ResolutionCounts {
        resolved_intrinsic: 0,
        resolved_operands: 0,
        bespoke_gap: 0,
    };
    for unit in units {
        match unit.semantic.resolution {
            CatalogResolution::ResolvedIntrinsic => counts.resolved_intrinsic += 1,
            CatalogResolution::ResolvedOperands => counts.resolved_operands += 1,
            CatalogResolution::BespokeGap => counts.bespoke_gap += 1,
        }
    }
    counts
}
