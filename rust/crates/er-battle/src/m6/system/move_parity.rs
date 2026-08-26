//! Complete MOVE behavior-unit parity sharding over the frozen M6 catalog.
//!
//! This adapter closes the MOVE domain of the system proof: every MOVE
//! source in `rust/fixtures/m6/semantic-catalog-v1.json` and every owned
//! behavior unit enters exactly one deterministic shard exactly once, and
//! every unit executes through prepared production dispatch with oracle
//! witness inputs.
//!
//! Domain closure over the frozen catalog:
//!
//! - `INTRINSIC_MOVE_RULE` units are identity admissions. They compile into
//!   an operation-free admission program owning exactly those units, are
//!   reachable only through the prepared-content source index, and can never
//!   stage a mutation or fold a query through dispatch.
//! - `RESOLVED_OPERANDS` attribute units compile through the audited Moves
//!   routine family (`map_moves_unit`, executed by the caller because this
//!   crate sits below the offline compiler). Every compiled program runs
//!   through both the production prepared executor and the temporary direct
//!   reference with identical ordered evidence.
//! - `BESPOKE_GAP` attribute units route through their frozen cluster
//!   mechanic. Each routed unit resolves a non-empty production handler set
//!   and never appears in compiled dispatch evidence.
//!
//! Anything else fails closed: an unclassified kind/resolution combination,
//! an unmapped operand unit, an unrouted bespoke gap, or an unknown identity
//! is a typed error, never a silent residual.
//!
//! Evidence comparison covers ordered query/hook evidence, staged mutations,
//! accumulator control flags (`allowed`/`cancelled`), and RNG draws. The
//! frozen catalog admits zero MOVE-owned RNG sites, so every execution
//! records an empty ordered draw list; a future catalog that binds draws
//! into move programs fails preparation here until this adapter owns them.
//!
//! Positive witnesses run with the unit's source active; false-condition
//! witnesses run with the source absent from the active set and must leave
//! accumulator state untouched and stage nothing. Invalid witnesses feed a
//! deliberately mismatched accumulator kind and require both execution paths
//! to agree on the typed outcome. Any disagreement surfaces as a
//! [`MoveParityDivergence`] naming the first differing location.

use std::collections::{BTreeMap, BTreeSet};
use std::num::NonZeroU32;

use er_canonical::{CanonicalError, canonicalize, content_digest};
use er_content::m6_catalog::{CatalogBehaviorUnit, CatalogResolution};
use er_content::pack::m6_pack::{
    BESPOKE_MANIFEST_SCHEMA_VERSION_V2, BattleContentPackV3, BehaviorClassificationEntryV2,
    BehaviorClassificationManifestV2, BespokeManifestEntryV2, BespokeManifestV2, FieldContentV1,
    MoveDefinitionV3,
};
use er_content::pack::m6_prepared::{
    ContentError, PreparedBattleContentV3, prepare_content,
};
use er_content::pack::selected_type_chart;
use er_mechanics::condition_v2::{ConditionArenaV2, ValueArenaV2};
use er_mechanics::m6::ProgramBudgetV2;
use er_mechanics::program_v2::MechanicsProgramV2;
use er_mechanics::selector_operation_v2::{
    QueryModifierStageV2, SelectorArenaV2,
};
use er_mechanics::v2::{MechanicHookV2, MechanicQueryV2};
use er_types::battle_ids::MoveId;
use er_types::battle_model::{
    EffectChance, MoveAccuracy, MoveCategory, MoveFlag, MovePower, MoveTarget, PokemonType,
};
use er_types::mechanics::MechanicsProgramId;
use er_types::{
    BehaviorClassificationKindV2, BehaviorSourceId, BehaviorUnitId, BehaviorUnitKind,
    BespokeMechanicId, CatalogHash, M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION,
    M6_MECHANICS_PROGRAM_VERSION, M6StringIdentityError, OracleSha,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::m6::{
    MechanicsContextV2, MechanicsErrorV2, QueryTransitionV2, QueryValueV2, execute_hook_v2,
    execute_hook_v2_direct_reference, execute_query_v2, execute_query_v2_direct_reference,
};

/// Witness assertion kinds carried by the frozen oracle witness plan.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WitnessAssertion {
    /// The unit's source must be reached by positive-witness dispatch.
    SourceReached,
    /// The false-condition witness must leave state untouched.
    FalseConditionDoesNotMutate,
}

/// One oracle RNG site reference attached to a witness plan row.
#[derive(Clone, Debug, Eq, PartialEq, Deserialize)]
pub struct OracleRngSiteRef {
    pub ordinal: u32,
    pub provenance_hash: String,
}

/// One oracle witness plan row for a MOVE-source behavior unit.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct OracleWitness {
    pub behavior_unit: BehaviorUnitId,
    /// Extracted hook evidence. Provenance, not a closed dispatch key.
    pub expected_hook: String,
    pub expected_source: BehaviorSourceId,
    #[serde(default)]
    pub positive_assertions: Vec<WitnessAssertion>,
    #[serde(default)]
    pub negative_assertions: Vec<WitnessAssertion>,
    #[serde(default)]
    pub rng_contract: Vec<OracleRngSiteRef>,
}

/// Frozen bespoke cluster route: one closed mechanic plus its member units.
///
/// The test harness deserializes `rust/fixtures/m6/bespoke-clusters-v1.json`
/// rows into these routes verbatim; nothing here re-derives membership.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct BespokeClusterRoute {
    pub mechanic: BespokeMechanicId,
    pub behavior_units: Vec<BehaviorUnitId>,
}

/// Closed classification of one MOVE-source behavior unit inside this proof.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub enum MoveUnitClass {
    /// Identity admission compiled into the source's admission program.
    IntrinsicIdentity,
    /// Attribute unit compiled through the audited Moves routine family.
    CompiledRoutine,
    /// Attribute unit routed to its closed bespoke mechanic.
    Bespoke(BespokeMechanicId),
}

/// Exactly-once inventory of one MOVE source's behavior units.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MoveSourceInventory {
    pub source: BehaviorSourceId,
    /// All units in frozen catalog order with their closed classification.
    pub units: Vec<(BehaviorUnitId, MoveUnitClass)>,
}

impl MoveSourceInventory {
    /// The source's identity-admission units, in frozen order.
    pub fn intrinsic_units(&self) -> impl Iterator<Item = &BehaviorUnitId> + '_ {
        self.units.iter().filter_map(|(unit, class)| {
            matches!(class, MoveUnitClass::IntrinsicIdentity).then_some(unit)
        })
    }

    /// The source's classified attribute units, in frozen order.
    pub fn attribute_units(&self) -> impl Iterator<Item = (&BehaviorUnitId, MoveUnitClass)> + '_ {
        self.units.iter().filter_map(|(unit, class)| match class {
            MoveUnitClass::IntrinsicIdentity => None,
            other => Some((unit, *other)),
        })
    }
}

/// Exact counts closing the MOVE domain inventory.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct MoveDomainCounts {
    pub source_count: usize,
    pub intrinsic_unit_count: usize,
    pub compiled_unit_count: usize,
    pub bespoke_unit_count: usize,
    /// Always zero: construction fails closed on any residual unit.
    pub unsupported_unit_count: usize,
}

/// Exactly-once inventory over every MOVE source in the frozen catalog.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MoveDomainInventory {
    sources: Vec<MoveSourceInventory>,
    counts: MoveDomainCounts,
}

impl MoveDomainInventory {
    /// Every inventoried source in frozen catalog order.
    pub fn sources(&self) -> &[MoveSourceInventory] {
        &self.sources
    }

    /// The source inventory carrying one numeric move ID, if present.
    pub fn source_by_numeric_id(&self, numeric_id: u64) -> Option<&MoveSourceInventory> {
        self.sources.iter().find(|entry| {
            matches!(&entry.source, BehaviorSourceId::Move { numeric_id: id } if id.get() == numeric_id)
        })
    }

    /// Exact closure counts recorded during construction.
    pub const fn counts(&self) -> &MoveDomainCounts {
        &self.counts
    }

    /// Every unit identity across all sources, in frozen order.
    pub fn all_units(&self) -> impl Iterator<Item = (&BehaviorUnitId, MoveUnitClass)> + '_ {
        self.sources
            .iter()
            .flat_map(|source| source.units.iter())
            .map(|(unit, class)| (unit, *class))
    }

    /// Deterministically assigns every source to exactly one of `shard_count`
    /// shards. Assignment hashes the canonical source identity (BLAKE3 over
    /// canonical JSON), so identical inputs always produce identical shards
    /// and the shard union always equals the full inventory.
    pub fn assign_shards(
        &self,
        shard_count: NonZeroU32,
    ) -> Result<Vec<MoveShard>, MoveParityError> {
        let mut shards: Vec<MoveShard> = (0..shard_count.get())
            .map(|index| MoveShard {
                index,
                sources: Vec::new(),
            })
            .collect();
        let count = u64::from(shard_count.get());
        for source in &self.sources {
            let index = (canonical_identity_digest(&source.source)? % count) as u32;
            shards[index as usize].sources.push(source.source.clone());
        }
        debug_assert_eq!(
            shards.iter().map(|shard| shard.sources.len()).sum::<usize>(),
            self.sources.len()
        );
        Ok(shards)
    }
}

/// One deterministic shard of MOVE sources, preserving frozen order.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MoveShard {
    pub index: u32,
    pub sources: Vec<BehaviorSourceId>,
}

/// Catalog identity strings required to stamp the derived content pack.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MoveDomainHashes {
    pub oracle_sha: String,
    pub raw_catalog_hash: String,
    pub semantic_catalog_hash: String,
}

/// Program-ID allocation for one source: its admission program plus each
/// compiled routine program, in allocation order.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceProgramAllocation {
    pub source: BehaviorSourceId,
    pub identity_program: Option<MechanicsProgramId>,
    pub routine_programs: Vec<MechanicsProgramId>,
}

/// A fully prepared MOVE-domain battle content pack plus its direct
/// reference programs.
#[derive(Debug)]
pub struct PreparedMoveDomain {
    prepared: PreparedBattleContentV3,
    direct_programs: Vec<MechanicsProgramV2>,
    allocations: BTreeMap<BehaviorSourceId, SourceProgramAllocation>,
    inventory: MoveDomainInventory,
    program_of_unit: BTreeMap<BehaviorUnitId, MechanicsProgramId>,
}

/// Builds the exactly-once MOVE-domain inventory from the frozen semantic
/// catalog, the compiled Moves-family routine programs, and the frozen
/// bespoke cluster routes.
///
/// Fails closed on any unsupported identity: an unexpected unit kind or
/// resolution on a MOVE source, an operand unit without a routine program,
/// a bespoke gap without a route, an unconsumed or duplicated routine
/// program, or a duplicate unit identity.
pub fn build_move_domain_inventory(
    units: &[CatalogBehaviorUnit],
    routine_programs: &[MechanicsProgramV2],
    routes: &[BespokeClusterRoute],
) -> Result<MoveDomainInventory, MoveParityError> {
    let mut routine_of_unit: BTreeSet<BehaviorUnitId> = BTreeSet::new();
    for program in routine_programs {
        if !matches!(program.source, BehaviorSourceId::Move { .. }) {
            return Err(MoveParityError::RoutineProgramForeignSource {
                program: program.id,
            });
        }
        let [owning_unit] = &program.behavior_units[..] else {
            return Err(MoveParityError::RoutineProgramOwnershipShape {
                program: program.id,
            });
        };
        if !routine_of_unit.insert(owning_unit.clone()) {
            return Err(MoveParityError::DuplicateRoutineProgram {
                unit: owning_unit.clone(),
            });
        }
    }

    let mut route_of_unit: BTreeMap<BehaviorUnitId, BespokeMechanicId> = BTreeMap::new();
    for route in routes {
        for unit in &route.behavior_units {
            if route_of_unit.insert(unit.clone(), route.mechanic).is_some() {
                return Err(MoveParityError::DuplicateBespokeRoute { unit: unit.clone() });
            }
        }
    }

    let mut sources: Vec<MoveSourceInventory> = Vec::new();
    let mut seen_units: BTreeSet<BehaviorUnitId> = BTreeSet::new();
    let mut counts = MoveDomainCounts {
        source_count: 0,
        intrinsic_unit_count: 0,
        compiled_unit_count: 0,
        bespoke_unit_count: 0,
        unsupported_unit_count: 0,
    };

    for unit in units {
        let BehaviorSourceId::Move { .. } = &unit.id.source else {
            continue;
        };
        let class = match (&unit.id.unit_kind, unit.semantic.resolution) {
            (BehaviorUnitKind::IntrinsicMoveRule, CatalogResolution::ResolvedIntrinsic) => {
                MoveUnitClass::IntrinsicIdentity
            }
            (kind @ (BehaviorUnitKind::IntrinsicMoveRule | BehaviorUnitKind::MoveAttribute), resolution)
                if kind == &BehaviorUnitKind::MoveAttribute
                    && resolution == CatalogResolution::ResolvedOperands =>
            {
                MoveUnitClass::CompiledRoutine
            }
            (BehaviorUnitKind::MoveAttribute, CatalogResolution::BespokeGap) => {
                let mechanic = route_of_unit.get(&unit.id).copied().ok_or_else(|| {
                    MoveParityError::UnassignedBespokeGap {
                        unit: unit.id.clone(),
                    }
                })?;
                MoveUnitClass::Bespoke(mechanic)
            }
            (kind, resolution) => {
                return Err(MoveParityError::UnsupportedResolution {
                    unit: unit.id.clone(),
                    kind: *kind,
                    resolution,
                });
            }
        };
        // Compiled routine units consume their program immediately so an
        // unconsumed program surfaces as a residual below.
        if class == MoveUnitClass::CompiledRoutine && !routine_of_unit.remove(&unit.id) {
            return Err(MoveParityError::ResidualOperandUnit {
                unit: unit.id.clone(),
            });
        }

        let last_source_is_this = matches!(
            sources.last(),
            Some(entry) if entry.source == unit.id.source
        );
        if !last_source_is_this {
            // Frozen catalog order groups units per source contiguously; a
            // re-appearing source would break exactly-once grouping.
            if sources.iter().any(|entry| entry.source == unit.id.source) {
                return Err(MoveParityError::NonContiguousSourceUnits {
                    source_id: unit.id.source.clone(),
                });
            }
            sources.push(MoveSourceInventory {
                source: unit.id.source.clone(),
                units: Vec::new(),
            });
            counts.source_count += 1;
        }
        let entry = sources.last_mut().expect("source just pushed");
        if !seen_units.insert(unit.id.clone()) {
            return Err(MoveParityError::DuplicateUnit {
                unit: unit.id.clone(),
            });
        }
        match class {
            MoveUnitClass::IntrinsicIdentity => counts.intrinsic_unit_count += 1,
            MoveUnitClass::CompiledRoutine => counts.compiled_unit_count += 1,
            MoveUnitClass::Bespoke(_) => counts.bespoke_unit_count += 1,
        }
        entry.units.push((unit.id.clone(), class));
    }

    if let Some(unit) = routine_of_unit.iter().next() {
        return Err(MoveParityError::UnownedRoutineProgram {
            unit: unit.clone(),
        });
    }

    Ok(MoveDomainInventory { sources, counts })
}

/// Allocates program IDs, builds admission and routine programs, stamps the
/// validated pack, and prepares production content for the MOVE domain.
///
/// Program IDs increase along the frozen catalog walk exactly like the
/// central pipeline: the first intrinsic unit of a source allocates that
/// source's admission program, then each operand unit allocates its own
/// routine program when reached. Admission programs are pushed as
/// placeholders at their allocation point and completed once the source's
/// full intrinsic-unit set is known, preserving exact allocation order.
pub fn prepare_move_domain(
    inventory: MoveDomainInventory,
    routine_programs: &[MechanicsProgramV2],
    hashes: MoveDomainHashes,
) -> Result<PreparedMoveDomain, MoveParityError> {
    let mut program_of_routine: BTreeMap<&BehaviorUnitId, &MechanicsProgramV2> = BTreeMap::new();
    for program in routine_programs {
        let [owning_unit] = &program.behavior_units[..] else {
            return Err(MoveParityError::RoutineProgramOwnershipShape {
                program: program.id,
            });
        };
        if program_of_routine.insert(owning_unit, program).is_some() {
            return Err(MoveParityError::DuplicateRoutineProgram {
                unit: owning_unit.clone(),
            });
        }
    }

    let mut next_program_id: u64 = 1;
    // Pack validation pins every program ID to its vector slot, so the
    // positive ID space starts at slot 1 and slot 0 stays empty.
    let mut allocated_programs: Vec<Option<MechanicsProgramV2>> = vec![None];
    let mut direct_programs: Vec<MechanicsProgramV2> = Vec::new();
    let mut allocations: BTreeMap<BehaviorSourceId, SourceProgramAllocation> = BTreeMap::new();
    let mut classifications: Vec<BehaviorClassificationEntryV2> = Vec::new();
    let mut program_of_unit: BTreeMap<BehaviorUnitId, MechanicsProgramId> = BTreeMap::new();
    let mut definitions: BTreeMap<u64, MoveDefinitionV3> = BTreeMap::new();

    for source_entry in inventory.sources() {
        let mut allocation = SourceProgramAllocation {
            source: source_entry.source.clone(),
            identity_program: None,
            routine_programs: Vec::new(),
        };
        let mut intrinsic_units: Vec<BehaviorUnitId> = Vec::new();

        for (unit, class) in &source_entry.units {
            let mut routine_program_id = None;
            match class {
                MoveUnitClass::IntrinsicIdentity => {
                    intrinsic_units.push(unit.clone());
                    if allocation.identity_program.is_none() {
                        let id = allocate_id(&mut next_program_id)?;
                        allocation.identity_program = Some(id);
                        push_program(
                            &mut allocated_programs,
                            id,
                            identity_admission_program(id, &source_entry.source, &[]),
                        )?;
                    }
                }
                MoveUnitClass::CompiledRoutine => {
                    let spec = program_of_routine
                        .get(unit)
                        .ok_or_else(|| MoveParityError::ResidualOperandUnit {
                            unit: unit.clone(),
                        })?;
                    let id = allocate_id(&mut next_program_id)?;
                    let mut program = (*spec).clone();
                    program.id = id;
                    program.validate().map_err(MoveParityError::Program)?;
                    direct_programs.push(program.clone());
                    push_program(&mut allocated_programs, id, program)?;
                    allocation.routine_programs.push(id);
                    routine_program_id = Some(id);
                }
                MoveUnitClass::Bespoke(_) => {}
            };
            if let Some(program_id) = routine_program_id {
                program_of_unit.insert(unit.clone(), program_id);
            }
            let (kind, programs, bespoke) = match class {
                MoveUnitClass::IntrinsicIdentity => (
                    BehaviorClassificationKindV2::Compiled,
                    vec![allocation.identity_program.expect("admission program allocated")],
                    None,
                ),
                MoveUnitClass::CompiledRoutine => (
                    BehaviorClassificationKindV2::Compiled,
                    vec![routine_program_id.expect("routine program allocated")],
                    None,
                ),
                MoveUnitClass::Bespoke(mechanic) => (
                    BehaviorClassificationKindV2::Bespoke,
                    Vec::new(),
                    Some(*mechanic),
                )
            };
            classifications.push(BehaviorClassificationEntryV2 {
                behavior_unit: unit.clone(),
                kind,
                programs,
                bespoke,
                unsupported_reason: None,
            });
        }

        // Complete the admission program placeholder with the source's full
        // intrinsic-unit ownership now that the walk has seen all of them.
        if !intrinsic_units.is_empty() {
            let id = allocation.identity_program.expect("allocated above");
            let admission =
                identity_admission_program(id, &source_entry.source, &intrinsic_units);
            let slot = usize::try_from(u64::from(id.get())).map_err(|_| {
                MoveParityError::IndexOverflow {
                    value: u64::from(id.get()),
                }
            })?;
            allocated_programs[slot] = Some(admission);
        }

        if let BehaviorSourceId::Move { numeric_id } = &source_entry.source {
            let mut mechanic_programs = Vec::with_capacity(
                usize::from(allocation.identity_program.is_some())
                    + allocation.routine_programs.len(),
            );
            if let Some(identity) = allocation.identity_program {
                mechanic_programs.push(identity);
            }
            mechanic_programs.extend(allocation.routine_programs.iter().copied());
            definitions.insert(
                numeric_id.get(),
                scaffold_move_definition(numeric_id.get(), mechanic_programs)?,
            );
        }
        allocations.insert(source_entry.source.clone(), allocation);
    }

    // Classifications follow frozen catalog order, which the central
    // pipeline proves is ascending behavior-unit identity.
    for window in classifications.windows(2) {
        if window[0].behavior_unit >= window[1].behavior_unit {
            return Err(MoveParityError::ClassificationsNotSorted {
                unit: window[1].behavior_unit.clone(),
            });
        }
    }

    let mut bespoke_units: BTreeMap<BespokeMechanicId, Vec<BehaviorUnitId>> = BTreeMap::new();
    for (unit, class) in inventory.all_units() {
        if let MoveUnitClass::Bespoke(mechanic) = class {
            bespoke_units.entry(mechanic).or_default().push(unit.clone());
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

    let max_definition_id = definitions.keys().next_back().copied().unwrap_or(0);
    let mut moves: Vec<Option<MoveDefinitionV3>> = vec![None; max_definition_id as usize + 1];
    for (id, definition) in definitions {
        moves[id as usize] = Some(definition);
    }

    let mut pack = BattleContentPackV3 {
        schema_version: M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION,
        oracle_sha: OracleSha::parse(hashes.oracle_sha).map_err(MoveParityError::StringIdentity)?,
        raw_catalog_hash: CatalogHash::parse(hashes.raw_catalog_hash)
            .map_err(MoveParityError::StringIdentity)?,
        semantic_catalog_hash: CatalogHash::parse(hashes.semantic_catalog_hash)
            .map_err(MoveParityError::StringIdentity)?,
        content_hash: battle_content_pack_v3_hash_placeholder()?,
        species: Vec::new(),
        forms: Vec::new(),
        moves,
        abilities: Vec::new(),
        held_items: Vec::new(),
        field_content: FieldContentV1::default(),
        programs: allocated_programs,
        classifications: BehaviorClassificationManifestV2(classifications),
        bespoke: BespokeManifestV2 {
            schema_version: BESPOKE_MANIFEST_SCHEMA_VERSION_V2,
            entries: bespoke_entries,
        },
        rng_sites: Vec::new(),
        type_chart: selected_type_chart(),
    };
    pack.content_hash = pack.compute_content_hash()?;
    let prepared = prepare_content(pack)?;

    let domain = PreparedMoveDomain {
        prepared,
        direct_programs,
        allocations,
        inventory,
        program_of_unit,
    };
    domain.verify_move_rng_closure()?;
    Ok(domain)
}

fn allocate_id(next: &mut u64) -> Result<MechanicsProgramId, MoveParityError> {
    let id = MechanicsProgramId::try_from_u64(*next)
        .map_err(|_| MoveParityError::ProgramIdExhausted { allocated: *next })?;
    *next += 1;
    Ok(id)
}

fn push_program(
    programs: &mut Vec<Option<MechanicsProgramV2>>,
    id: MechanicsProgramId,
    program: MechanicsProgramV2,
) -> Result<(), MoveParityError> {
    let slot =
        usize::try_from(u64::from(id.get())).map_err(|_| MoveParityError::IndexOverflow {
            value: u64::from(id.get()),
        })?;
    if slot != programs.len() {
        return Err(MoveParityError::ProgramSlotMismatch {
            expected: programs.len(),
            actual: slot,
        });
    }
    programs.push(Some(program));
    Ok(())
}

/// Builds the operation-free identity admission program owning exactly the
/// given intrinsic units of one MOVE source.
fn identity_admission_program(
    id: MechanicsProgramId,
    source: &BehaviorSourceId,
    intrinsic_units: &[BehaviorUnitId],
) -> MechanicsProgramV2 {
    MechanicsProgramV2 {
        schema_version: M6_MECHANICS_PROGRAM_VERSION,
        id,
        source: source.clone(),
        behavior_units: intrinsic_units.to_vec(),
        bindings: Vec::new(),
        conditions: ConditionArenaV2::default(),
        selectors: SelectorArenaV2::default(),
        values: ValueArenaV2::default(),
        operations: Vec::new(),
        scheduled_events: Vec::new(),
        rng_sites: Vec::new(),
        budget: ProgramBudgetV2 {
            hook_bindings: 0,
            condition_nodes: 0,
            selector_nodes: 0,
            value_nodes: 0,
            operations: 0,
            scheduled_events: 0,
            rng_draws: 0,
            spawned_instances: 0,
            presentation_cues: 0,
            selected_targets: 0,
        },
    }
}

/// Deterministic harness definition resolving one move identity through the
/// prepared source index. These fields carry no parity semantics: every
/// compared value in this proof comes from compiled programs and executor
/// evidence, never from definition scaffolding.
fn scaffold_move_definition(
    numeric_id: u64,
    mechanic_programs: Vec<MechanicsProgramId>,
) -> Result<MoveDefinitionV3, MoveParityError> {
    Ok(MoveDefinitionV3 {
        id: MoveId::try_from_u64(numeric_id).map_err(|_| MoveParityError::InvalidMoveId {
            numeric_id,
        })?,
        category: MoveCategory::Status,
        move_type: PokemonType::Normal,
        power: MovePower::None,
        accuracy: MoveAccuracy::AlwaysHits,
        base_pp: 1,
        effect_chance: EffectChance::None,
        priority: 0,
        target: MoveTarget::NearOther,
        flags: Vec::<MoveFlag>::new(),
        mechanic_programs,
    })
}

/// Zero digest placeholder required before the real content hash computes.
fn battle_content_pack_v3_hash_placeholder()
    -> Result<er_types::BattleContentPackHashV3, MoveParityError>
{
    use er_types::BattleContentPackHashV3;
    BattleContentPackHashV3::parse(format!(
        "{}{}",
        BattleContentPackHashV3::PREFIX,
        "0".repeat(64)
    ))
    .map_err(MoveParityError::StringIdentity)
}

impl PreparedMoveDomain {
    /// The prepared production content for the MOVE domain.
    pub const fn prepared(&self) -> &PreparedBattleContentV3 {
        &self.prepared
    }

    /// Direct-reference programs mirroring the compiled routine surface, in
    /// frozen allocation order.
    pub fn direct_programs(&self) -> &[MechanicsProgramV2] {
        &self.direct_programs
    }

    /// The exactly-once inventory backing this domain.
    pub const fn inventory(&self) -> &MoveDomainInventory {
        &self.inventory
    }

    /// Program allocation facts for one source.
    pub fn allocation(&self, source: &BehaviorSourceId) -> Option<&SourceProgramAllocation> {
        self.allocations.get(source)
    }

    /// The compiled program owning one unit, for typed identity checks.
    pub fn program_of_unit(&self, unit: &BehaviorUnitId) -> Option<MechanicsProgramId> {
        self.program_of_unit.get(unit).copied()
    }

    /// Fails closed unless the unit belongs to the compiled routine surface.
    pub fn require_compiled_unit(
        &self,
        unit: &BehaviorUnitId,
    ) -> Result<MechanicsProgramId, MoveParityError> {
        self.program_of_unit
            .get(unit)
            .copied()
            .ok_or_else(|| MoveParityError::NotACompiledMoveUnit {
                unit: unit.clone(),
            })
    }

    /// The frozen catalog admits zero MOVE-owned RNG sites and the compiled
    /// move surface therefore carries zero RNG bindings. A future catalog
    /// that changes this must extend this adapter; today it fails closed.
    fn verify_move_rng_closure(&self) -> Result<(), MoveParityError> {
        for program in &self.direct_programs {
            if !program.rng_sites.is_empty() {
                return Err(MoveParityError::MoveRngSitePresent {
                    program: program.id,
                    sites: program.rng_sites.len(),
                });
            }
        }
        Ok(())
    }

    /// Ordered dispatch closure sweep across the whole domain: every closed
    /// hook and query executes once with every MOVE source active, through
    /// both the prepared indexes and the direct reference. Both paths must
    /// produce identical ordered evidence, and no evidence element may name
    /// a unit outside the compiled routine surface (identity admissions own
    /// zero bindings; bespoke units own none either).
    pub fn verify_domain_dispatch_closure(&self) -> Result<ClosureSweepSummary, MoveParityError> {
        self.verify_domain_dispatch_closure_against(self.direct_programs())
    }

    /// [`Self::verify_domain_dispatch_closure`] against an explicit
    /// direct-reference slice, so diagnostics can prove the sweep detects
    /// altered ordering or results.
    pub fn verify_domain_dispatch_closure_against(
        &self,
        direct_reference: &[MechanicsProgramV2],
    ) -> Result<ClosureSweepSummary, MoveParityError> {
        let active_sources = self.sorted_active_sources_all();
        let context = witness_context(&active_sources);
        let compiled_units: BTreeSet<&BehaviorUnitId> = self.program_of_unit.keys().collect();

        let mut sweep = ClosureSweepSummary::default();
        for hook in ALL_HOOKS {
            if hook.is_query() {
                continue;
            }
            let prepared = execute_hook_v2(self.prepared(), &context, hook)?;
            let direct =
                execute_hook_v2_direct_reference(direct_reference, &context, hook)?;
            require_equal_transition(&prepared, &direct, hook.surface_name(), None)?;
            sweep.staged_mutations += prepared.operations.len();
            for operation in &prepared.operations {
                if !compiled_units.contains(&operation.behavior_unit) {
                    return Err(MoveParityError::DispatchLeakedUnclassifiedUnit {
                        unit: operation.behavior_unit.clone(),
                        surface: hook.surface_name(),
                    });
                }
            }
        }
        for query in ALL_QUERIES {
            let initial = witness_initial(query);
            let prepared = execute_query_v2(self.prepared(), &context, query, initial.clone())?;
            let direct = execute_query_v2_direct_reference(
                direct_reference,
                &context,
                query,
                initial,
            )?;
            require_equal_query(&prepared, &direct, query.surface_name(), None)?;
            sweep.query_evidence += prepared.evidence.len();
            for evidence in &prepared.evidence {
                if !compiled_units.contains(&evidence.behavior_unit) {
                    return Err(MoveParityError::DispatchLeakedUnclassifiedUnit {
                        unit: evidence.behavior_unit.clone(),
                        surface: query.surface_name(),
                    });
                }
            }
        }
        Ok(sweep)
    }

    fn sorted_active_sources_all(&self) -> Vec<BehaviorSourceId> {
        let mut active: Vec<_> = self
            .inventory
            .sources()
            .iter()
            .map(|entry| entry.source.clone())
            .collect();
        active.sort();
        active
    }

    /// Runs one shard: every source in the shard executes its complete
    /// positive, false-condition, and invalid witness matrix, enforcing the
    /// oracle witness plan row for every unit.
    pub fn run_shard(
        &self,
        shard: &MoveShard,
        witnesses: &BTreeMap<BehaviorUnitId, OracleWitness>,
    ) -> Result<MoveShardRunReport, MoveParityError> {
        self.run_shard_against(shard, witnesses, &self.direct_programs)
    }

    /// [`Self::run_shard`] against an explicit direct-reference slice. The
    /// production path always passes the domain's own programs; the
    /// diagnostics path accepts a tampered slice to prove the comparison
    /// fires on altered ordering, values, or results.
    pub fn run_shard_against(
        &self,
        shard: &MoveShard,
        witnesses: &BTreeMap<BehaviorUnitId, OracleWitness>,
        direct_reference: &[MechanicsProgramV2],
    ) -> Result<MoveShardRunReport, MoveParityError> {
        let mut records = Vec::new();
        for source_id in &shard.sources {
            let source_entry = self
                .inventory
                .sources()
                .iter()
                .find(|entry| &entry.source == source_id)
                .ok_or_else(|| MoveParityError::SourceNotInDomain {
                    source_id: source_id.clone(),
                })?;
            let active = vec![source_id.clone()];
            let positive_context = witness_context(&active);
            let negative_context = witness_context(&[]);

            for (unit, class) in &source_entry.units {
                let witness = witnesses
                    .get(unit)
                    .ok_or_else(|| MoveParityError::WitnessMissing {
                        unit: unit.clone(),
                    })?;
                self.check_witness_identity(unit, witness)?;
                let record = match class {
                    MoveUnitClass::IntrinsicIdentity => {
                        self.run_identity_admission(source_entry, unit, witness)?
                    }
                    MoveUnitClass::CompiledRoutine => self.run_compiled_routine(
                        unit,
                        witness,
                        &positive_context,
                        &negative_context,
                        direct_reference,
                    )?,
                    MoveUnitClass::Bespoke(_) => self.run_bespoke_routing(unit, witness)?,
                };
                records.push(record);
            }
        }
        let digest = content_digest(&records)?;
        Ok(MoveShardRunReport {
            shard_index: shard.index,
            unit_records: records,
            digest,
        })
    }

    fn check_witness_identity(
        &self,
        unit: &BehaviorUnitId,
        witness: &OracleWitness,
    ) -> Result<(), MoveParityError> {
        if &witness.behavior_unit != unit || witness.expected_source != unit.source {
            return Err(MoveParityError::WitnessIdentityMismatch {
                unit: unit.clone(),
                expected_source: Box::new(witness.expected_source.clone()),
                actual_source: Box::new(unit.source.clone()),
            });
        }
        if !witness.rng_contract.is_empty() {
            return Err(MoveParityError::WitnessRngContractNotEmpty {
                unit: unit.clone(),
                sites: witness.rng_contract.len(),
            });
        }
        Ok(())
    }

    /// Identity admissions prove reachability through the prepared source
    /// index and prove they can never stage a mutation: their admission
    /// program owns zero bindings, so no hook/query sweep ever attributes
    /// evidence to them.
    fn run_identity_admission(
        &self,
        source_entry: &MoveSourceInventory,
        unit: &BehaviorUnitId,
        witness: &OracleWitness,
    ) -> Result<MoveUnitParityRecord, MoveParityError> {
        let allocation =
            self.allocation(&source_entry.source)
                .ok_or_else(|| MoveParityError::MissingAllocation {
                    source_id: source_entry.source.clone(),
                })?;
        let identity_program = allocation
            .identity_program
            .ok_or_else(|| MoveParityError::MissingAdmissionProgram {
                unit: unit.clone(),
            })?;
        let program = self.prepared.program(identity_program)?;
        if !program.bindings.is_empty() || !program.behavior_units.contains(unit) {
            return Err(MoveParityError::AdmissionNotReachable {
                unit: unit.clone(),
            });
        }

        // Negative sweep: even with the source active, no dispatch surface
        // may attribute anything to an admission-only program.
        let active = vec![source_entry.source.clone()];
        let context = witness_context(&active);
        let mut attributed = 0usize;
        for hook in ALL_HOOKS {
            if hook.is_query() {
                continue;
            }
            attributed += execute_hook_v2(self.prepared(), &context, hook)?
                .operations
                .iter()
                .filter(|operation| &operation.behavior_unit == unit)
                .count();
        }
        for query in ALL_QUERIES {
            attributed += execute_query_v2(self.prepared(), &context, query, witness_initial(query))?
                .evidence
                .iter()
                .filter(|evidence| &evidence.behavior_unit == unit)
                .count();
        }
        if attributed != 0 {
            return Err(MoveParityError::AdmissionStagedEvidence {
                unit: unit.clone(),
                evidence: attributed,
            });
        }

        enforce_positive_witness(witness, true)?;
        enforce_negative_witness(witness, true)?;
        Ok(MoveUnitParityRecord {
            unit: unit.clone(),
            class: MoveUnitClass::IntrinsicIdentity,
            program: Some(identity_program),
            query_witness: None,
            mutation_staged: false,
            rng_draws: 0,
        })
    }

    /// Compiled routine units run the full witness matrix through both
    /// production executors.
    fn run_compiled_routine(
        &self,
        unit: &BehaviorUnitId,
        witness: &OracleWitness,
        positive_context: &MechanicsContextV2<'_>,
        negative_context: &MechanicsContextV2<'_>,
        direct_reference: &[MechanicsProgramV2],
    ) -> Result<MoveUnitParityRecord, MoveParityError> {
        let program_id = self.require_compiled_unit(unit)?;
        let program = self.prepared.program(program_id)?;
        if program.source != unit.source || program.bindings.is_empty() {
            return Err(MoveParityError::RoutineProgramDegenerate {
                unit: unit.clone(),
            });
        }
        check_expected_hooks(unit, program, witness)?;
        let mut summary = None;
        for binding in &program.bindings {
            let Some(query) = binding.hook.query().ok() else {
                // The audited Moves family compiles query routines only; a
                // trigger binding would need selector-aware delivery that no
                // compiled move unit carries today. Fail closed instead of
                // silently skipping evidence.
                return Err(MoveParityError::RoutineTriggerBindingUnsupported {
                    unit: unit.clone(),
                });
            };
            let initial = witness_initial(query);

            // Positive witness: prepared vs direct, full ordered equality.
            let prepared_positive =
                execute_query_v2(self.prepared(), positive_context, query, initial.clone())?;
            let direct_positive = execute_query_v2_direct_reference(
                direct_reference,
                positive_context,
                query,
                initial.clone(),
            )?;
            require_equal_query(&prepared_positive, &direct_positive, query.surface_name(), Some(unit))?;
            enforce_positive_witness(witness, !prepared_positive.evidence.is_empty())?;
            if !prepared_positive
                .evidence
                .iter()
                .any(|entry| &entry.behavior_unit == unit)
            {
                return Err(MoveParityError::PositiveWitnessMissedSource {
                    unit: unit.clone(),
                });
            }

            // False-condition witness: inactive source stages nothing and
            // leaves the accumulator untouched on both paths.
            let prepared_negative =
                execute_query_v2(self.prepared(), negative_context, query, initial.clone())?;
            let direct_negative = execute_query_v2_direct_reference(
                direct_reference,
                negative_context,
                query,
                initial.clone(),
            )?;
            require_equal_query(&prepared_negative, &direct_negative, query.surface_name(), Some(unit))?;
            let false_condition_clean = prepared_negative.evidence.is_empty()
                && prepared_negative.after == prepared_negative.before
                && prepared_negative.allowed.is_none()
                && !prepared_negative.cancelled;
            enforce_negative_witness(witness, false_condition_clean)?;

            // Invalid witness: a deliberately mismatched accumulator kind
            // must resolve identically on both paths (typed rejection or a
            // defined closed-semantics application).
            let prepared_invalid = execute_query_v2(
                self.prepared(),
                positive_context,
                query,
                QueryValueV2::Boolean(true),
            );
            let direct_invalid = execute_query_v2_direct_reference(
                direct_reference,
                positive_context,
                query,
                QueryValueV2::Boolean(true),
            );
            require_compatible_invalid_outcome(&prepared_invalid, &direct_invalid, unit)?;

            summary = Some(QueryWitnessSummary {
                query: query.surface_name(),
                evidence_len: prepared_positive.evidence.len(),
                ordered_stages: prepared_positive
                    .evidence
                    .iter()
                    .map(|entry| EvidenceStage {
                        binding_ordinal: entry.binding_ordinal,
                        operation_ordinal: entry.operation_ordinal,
                        stage: entry.stage.surface_name(),
                        condition_matched: entry.condition_matched,
                        before: summarize_value(&entry.before),
                        after: summarize_value(&entry.after),
                    })
                    .collect(),
                final_value: summarize_value(&prepared_positive.after),
                allowed: prepared_positive.allowed,
                cancelled: prepared_positive.cancelled,
            });
        }

        Ok(MoveUnitParityRecord {
            unit: unit.clone(),
            class: MoveUnitClass::CompiledRoutine,
            program: Some(program_id),
            query_witness: summary,
            mutation_staged: false,
            rng_draws: 0,
        })
    }

    /// Bespoke units prove routing closure: the classification manifest and
    /// the bespoke manifest own them under one mechanic whose closed
    /// production handler set is non-empty. They never appear in compiled
    /// dispatch evidence (proven globally by the closure sweep).
    fn run_bespoke_routing(
        &self,
        unit: &BehaviorUnitId,
        witness: &OracleWitness,
    ) -> Result<MoveUnitParityRecord, MoveParityError> {
        let pack = self.prepared.pack();
        let classification = pack
            .classifications
            .0
            .binary_search_by(|entry| entry.behavior_unit.cmp(unit))
            .ok()
            .and_then(|index| pack.classifications.0.get(index))
            .ok_or_else(|| MoveParityError::BespokeUnitUnclassified {
                unit: unit.clone(),
            })?;
        let Some(mechanic) = classification.bespoke else {
            return Err(MoveParityError::BespokeUnitUnclassified {
                unit: unit.clone(),
            });
        };
        let handlers = crate::m6::bespoke::handlers_for(mechanic);
        if handlers.is_empty() {
            return Err(MoveParityError::BespokeMechanicWithoutHandler { mechanic });
        }
        let manifest_owns = pack
            .bespoke
            .entries
            .binary_search_by(|entry| entry.mechanic.cmp(&mechanic))
            .ok()
            .and_then(|index| pack.bespoke.entries.get(index))
            .is_some_and(|entry| entry.behavior_units.binary_search(unit).is_ok());
        if !manifest_owns {
            return Err(MoveParityError::BespokeManifestMismatch {
                unit: unit.clone(),
                mechanic,
            });
        }
        if self.program_of_unit.contains_key(unit) {
            return Err(MoveParityError::BespokeUnitCompiled {
                unit: unit.clone(),
            });
        }

        enforce_positive_witness(witness, true)?;
        enforce_negative_witness(witness, true)?;
        Ok(MoveUnitParityRecord {
            unit: unit.clone(),
            class: MoveUnitClass::Bespoke(mechanic),
            program: None,
            query_witness: None,
            mutation_staged: false,
            rng_draws: 0,
        })
    }
}

/// Aggregate result of the whole-domain closure sweep.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
pub struct ClosureSweepSummary {
    pub staged_mutations: usize,
    pub query_evidence: usize,
}

/// Serializable summary of one shard's ordered parity evidence.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct MoveShardRunReport {
    pub shard_index: u32,
    pub unit_records: Vec<MoveUnitParityRecord>,
    /// BLAKE3 content digest over the ordered records; equal across
    /// identical runs regardless of how sources were sharded.
    pub digest: String,
}

/// Serializable parity evidence for exactly one behavior unit.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct MoveUnitParityRecord {
    pub unit: BehaviorUnitId,
    pub class: MoveUnitClass,
    pub program: Option<MechanicsProgramId>,
    pub query_witness: Option<QueryWitnessSummary>,
    pub mutation_staged: bool,
    /// Ordered RNG draw count for this unit's execution; the frozen move
    /// surface admits zero.
    pub rng_draws: u32,
}

/// Compact ordered-evidence summary for one compiled query witness.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct QueryWitnessSummary {
    pub query: &'static str,
    pub evidence_len: usize,
    /// Every observed operation in deterministic execution order.
    pub ordered_stages: Vec<EvidenceStage>,
    pub final_value: QueryValueSummary,
    pub allowed: Option<bool>,
    pub cancelled: bool,
}

/// One observed query operation projected into serializable evidence.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct EvidenceStage {
    pub binding_ordinal: u16,
    pub operation_ordinal: u16,
    pub stage: &'static str,
    pub condition_matched: bool,
    pub before: QueryValueSummary,
    pub after: QueryValueSummary,
}

/// Serializable projection of [`QueryValueV2`].
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QueryValueSummary {
    Boolean {
        value: bool,
    },
    Signed {
        value: i64,
    },
    Unsigned {
        value: u64,
    },
    Ratio {
        numerator: i32,
        denominator: u32,
    },
    TypeId {
        value: u8,
    },
    CategoryId {
        value: u8,
    },
    TargetId {
        value: u8,
    },
}

fn summarize_value(value: &QueryValueV2) -> QueryValueSummary {
    match value {
        QueryValueV2::Boolean(value) => QueryValueSummary::Boolean { value: *value },
        QueryValueV2::Signed(value) => QueryValueSummary::Signed { value: *value },
        QueryValueV2::Unsigned(value) => QueryValueSummary::Unsigned { value: *value },
        QueryValueV2::Ratio(ratio) => QueryValueSummary::Ratio {
            numerator: ratio.numerator,
            denominator: ratio.denominator,
        },
        QueryValueV2::TypeId(value) => QueryValueSummary::TypeId { value: *value },
        QueryValueV2::CategoryId(value) => QueryValueSummary::CategoryId { value: *value },
        QueryValueV2::TargetId(value) => QueryValueSummary::TargetId { value: *value },
    }
}

/// First-divergence diagnostic: names the exact comparison site, the unit
/// under proof, and both observed values.
#[derive(Clone, Debug, PartialEq)]
pub struct MoveParityDivergence {
    pub stage: &'static str,
    pub unit: Option<BehaviorUnitId>,
    pub detail: String,
}

/// Typed failures for the MOVE-domain parity proof. Everything unsupported
/// fails closed; nothing degrades to empty acceptance.
#[derive(Debug, Error)]
pub enum MoveParityError {
    #[error("move unit {unit:?} carries unsupported kind/resolution pair ({kind:?}, {resolution:?})")]
    UnsupportedResolution {
        unit: BehaviorUnitId,
        kind: BehaviorUnitKind,
        resolution: CatalogResolution,
    },
    #[error("RESOLVED_OPERANDS move unit {unit:?} has no compiled routine program")]
    ResidualOperandUnit {
        unit: BehaviorUnitId,
    },
    #[error("BESPOKE_GAP move unit {unit:?} has no bespoke mechanic route")]
    UnassignedBespokeGap {
        unit: BehaviorUnitId,
    },
    #[error("duplicate routine program for unit {unit:?}")]
    DuplicateRoutineProgram {
        unit: BehaviorUnitId,
    },
    #[error("routine program {program:?} does not own exactly one behavior unit")]
    RoutineProgramOwnershipShape {
        program: MechanicsProgramId,
    },
    #[error("routine program {program:?} does not belong to a MOVE source")]
    RoutineProgramForeignSource {
        program: MechanicsProgramId,
    },
    #[error("compiled routine program for unit {unit:?} was never claimed by the inventory")]
    UnownedRoutineProgram {
        unit: BehaviorUnitId,
    },
    #[error("duplicate bespoke route for unit {unit:?}")]
    DuplicateBespokeRoute {
        unit: BehaviorUnitId,
    },
    #[error("duplicate behavior-unit identity {unit:?} in the frozen catalog walk")]
    DuplicateUnit {
        unit: BehaviorUnitId,
    },
    #[error("units of source {source_id:?} are not contiguous in frozen catalog order")]
    NonContiguousSourceUnits {
        source_id: BehaviorSourceId,
    },
    #[error("classifications are not ascending at unit {unit:?}")]
    ClassificationsNotSorted {
        unit: BehaviorUnitId,
    },
    #[error("program ID space exhausted after {allocated} allocations")]
    ProgramIdExhausted {
        allocated: u64,
    },
    #[error("program slot mismatch: expected {expected}, actual {actual}")]
    ProgramSlotMismatch {
        expected: usize,
        actual: usize,
    },
    #[error("platform index overflow: {value}")]
    IndexOverflow {
        value: u64,
    },
    #[error("invalid numeric move id {numeric_id}")]
    InvalidMoveId {
        numeric_id: u64,
    },
    #[error("invalid catalog identity string: {0}")]
    StringIdentity(#[source] M6StringIdentityError),
    #[error("invalid mechanics program: {0}")]
    Program(#[source] er_mechanics::MechanicsProgramV2Error),
    #[error("content pack failed to load: {0}")]
    Pack(#[from] er_content::pack::m6_pack::M6PackLoadError),
    #[error("content preparation failed: {0}")]
    Content(#[from] ContentError),
    #[error("canonical encoding failed: {0}")]
    Canonical(#[from] CanonicalError),
    #[error("executor failure: {0}")]
    Executor(#[from] MechanicsErrorV2),
    #[error("source {source_id:?} is not part of this domain")]
    SourceNotInDomain {
        source_id: BehaviorSourceId,
    },
    #[error("missing allocation for source {source_id:?}")]
    MissingAllocation {
        source_id: BehaviorSourceId,
    },
    #[error("identity admission program missing for unit {unit:?}")]
    MissingAdmissionProgram {
        unit: BehaviorUnitId,
    },
    #[error("identity admission for unit {unit:?} is not reachable through prepared indexes")]
    AdmissionNotReachable {
        unit: BehaviorUnitId,
    },
    #[error("identity admission unit {unit:?} was attributed {evidence} evidence elements")]
    AdmissionStagedEvidence {
        unit: BehaviorUnitId,
        evidence: usize,
    },
    #[error("compiled routine program for unit {unit:?} is degenerate")]
    RoutineProgramDegenerate {
        unit: BehaviorUnitId,
    },
    #[error("unit {unit:?} carries a trigger binding; the compiled move surface is query-only")]
    RoutineTriggerBindingUnsupported {
        unit: BehaviorUnitId,
    },
    #[error("witness missing for unit {unit:?}")]
    WitnessMissing {
        unit: BehaviorUnitId,
    },
    #[error("witness for unit {unit:?} targets source {expected_source:?}, unit lives on {actual_source:?}")]
    WitnessIdentityMismatch {
        unit: BehaviorUnitId,
        expected_source: Box<BehaviorSourceId>,
        actual_source: Box<BehaviorSourceId>,
    },
    #[error("witness for unit {unit:?} declares {sites} RNG sites; the move surface admits none")]
    WitnessRngContractNotEmpty {
        unit: BehaviorUnitId,
        sites: usize,
    },
    #[error("positive witness assertion failed for unit {unit:?}")]
    PositiveWitnessAssertionFailed {
        unit: Box<BehaviorUnitId>,
    },
    #[error("false-condition witness assertion failed for unit {unit:?}")]
    FalseConditionAssertionFailed {
        unit: Box<BehaviorUnitId>,
    },
    #[error("positive witness ran but never reached the unit's source: {unit:?}")]
    PositiveWitnessMissedSource {
        unit: BehaviorUnitId,
    },
    #[error("hook evidence mismatch for unit {unit:?}: witness says {expected}, program binds {actual}")]
    HookEvidenceMismatch {
        unit: BehaviorUnitId,
        expected: String,
        actual: String,
    },
    #[error("unit {unit:?} is not a compiled move unit")]
    NotACompiledMoveUnit {
        unit: BehaviorUnitId,
    },
    #[error("bespoke unit {unit:?} has no Bespoke classification")]
    BespokeUnitUnclassified {
        unit: BehaviorUnitId,
    },
    #[error("bespoke mechanic {mechanic:?} has no production handler set")]
    BespokeMechanicWithoutHandler {
        mechanic: BespokeMechanicId,
    },
    #[error("bespoke manifest does not own unit {unit:?} under {mechanic:?}")]
    BespokeManifestMismatch {
        unit: BehaviorUnitId,
        mechanic: BespokeMechanicId,
    },
    #[error("bespoke unit {unit:?} unexpectedly carries a compiled program")]
    BespokeUnitCompiled {
        unit: BehaviorUnitId,
    },
    #[error("catalog binds {sites} RNG sites into compiled move program {program:?}; this adapter admits none")]
    MoveRngSitePresent {
        program: MechanicsProgramId,
        sites: usize,
    },
    #[error("dispatch evidence leaked unit {unit:?} onto closed surface {surface}")]
    DispatchLeakedUnclassifiedUnit {
        unit: BehaviorUnitId,
        surface: &'static str,
    },
    #[error("first divergence: {0:?}")]
    Divergence(Box<MoveParityDivergence>),
}

/// Every closed trigger hook, in prepared-index slot order.
pub const ALL_HOOKS: [MechanicHookV2; 39] = [
    MechanicHookV2::BattleLoad,
    MechanicHookV2::BattleStart,
    MechanicHookV2::BeforeSummon,
    MechanicHookV2::AfterSummon,
    MechanicHookV2::BeforeActionOrder,
    MechanicHookV2::BeforeAction,
    MechanicHookV2::BeforeMove,
    MechanicHookV2::MoveTargetQuery,
    MechanicHookV2::PriorityQuery,
    MechanicHookV2::EffectiveSpeedQuery,
    MechanicHookV2::AccuracyQuery,
    MechanicHookV2::CriticalQuery,
    MechanicHookV2::MovePowerQuery,
    MechanicHookV2::OffensiveStatQuery,
    MechanicHookV2::DefensiveStatQuery,
    MechanicHookV2::TypeEffectivenessQuery,
    MechanicHookV2::DamageQuery,
    MechanicHookV2::HitCountQuery,
    MechanicHookV2::StatusEligibilityQuery,
    MechanicHookV2::VolatileEligibilityQuery,
    MechanicHookV2::SwitchEligibilityQuery,
    MechanicHookV2::ItemEligibilityQuery,
    MechanicHookV2::BeforeHit,
    MechanicHookV2::AfterHit,
    MechanicHookV2::AfterMove,
    MechanicHookV2::AfterDamage,
    MechanicHookV2::BeforeStatus,
    MechanicHookV2::AfterStatus,
    MechanicHookV2::BeforeSwitchOut,
    MechanicHookV2::AfterSwitchOut,
    MechanicHookV2::BeforeSwitchIn,
    MechanicHookV2::WeatherChanged,
    MechanicHookV2::WeatherLapse,
    MechanicHookV2::TerrainChanged,
    MechanicHookV2::TurnEnd,
    MechanicHookV2::ScheduledEvent,
    MechanicHookV2::BeforeFaint,
    MechanicHookV2::AfterFaint,
    MechanicHookV2::Victory,
];

/// Every closed query accumulator, in prepared-index slot order.
pub const ALL_QUERIES: [MechanicQueryV2; 17] = [
    MechanicQueryV2::MoveType,
    MechanicQueryV2::MoveCategory,
    MechanicQueryV2::MoveTargetShape,
    MechanicQueryV2::ActionPriority,
    MechanicQueryV2::EffectiveSpeed,
    MechanicQueryV2::Accuracy,
    MechanicQueryV2::CriticalRate,
    MechanicQueryV2::MovePower,
    MechanicQueryV2::OffensiveStat,
    MechanicQueryV2::DefensiveStat,
    MechanicQueryV2::TypeEffectiveness,
    MechanicQueryV2::Damage,
    MechanicQueryV2::HitCount,
    MechanicQueryV2::StatusEligibility,
    MechanicQueryV2::VolatileEligibility,
    MechanicQueryV2::SwitchEligibility,
    MechanicQueryV2::ItemEligibility,
];

/// Fixed oracle runtime facts for witness execution.
fn witness_context(active_sources: &[BehaviorSourceId]) -> MechanicsContextV2<'_> {
    MechanicsContextV2 {
        active_sources,
        suppressed_sources: &[],
        instance_counter: 3,
        hp_current: 47,
        hp_max: 101,
        turn_index: 9,
        wave_index: 12,
        level: 31,
    }
}

/// Closed witness initial accumulator per query.
pub fn witness_initial(query: MechanicQueryV2) -> QueryValueV2 {
    match query {
        MechanicQueryV2::CriticalRate => QueryValueV2::Signed(0),
        MechanicQueryV2::Damage => QueryValueV2::Signed(60),
        MechanicQueryV2::HitCount => QueryValueV2::Signed(1),
        MechanicQueryV2::Accuracy => QueryValueV2::Signed(100),
        _ => QueryValueV2::Signed(7),
    }
}

fn enforce_positive_witness(
    witness: &OracleWitness,
    source_reached: bool,
) -> Result<(), MoveParityError> {
    if witness
        .positive_assertions
        .contains(&WitnessAssertion::SourceReached)
        && !source_reached
    {
        return Err(MoveParityError::PositiveWitnessAssertionFailed {
            unit: Box::new(witness.behavior_unit.clone()),
        });
    }
    Ok(())
}

fn enforce_negative_witness(
    witness: &OracleWitness,
    clean: bool,
) -> Result<(), MoveParityError> {
    if witness
        .negative_assertions
        .contains(&WitnessAssertion::FalseConditionDoesNotMutate)
        && !clean
    {
        return Err(MoveParityError::FalseConditionAssertionFailed {
            unit: Box::new(witness.behavior_unit.clone()),
        });
    }
    Ok(())
}

/// Cross-checks extracted hook evidence against the closed binding hooks.
/// `UNRESOLVED_HOOK` names no closed hook and is accepted verbatim.
fn check_expected_hooks(
    unit: &BehaviorUnitId,
    program: &MechanicsProgramV2,
    witness: &OracleWitness,
) -> Result<(), MoveParityError> {
    if witness.expected_hook == "UNRESOLVED_HOOK" {
        return Ok(());
    }
    for binding in &program.bindings {
        let actual = hook_evidence_name(binding.hook);
        if actual != witness.expected_hook {
            return Err(MoveParityError::HookEvidenceMismatch {
                unit: unit.clone(),
                expected: witness.expected_hook.clone(),
                actual: actual.to_owned(),
            });
        }
    }
    Ok(())
}

/// Closed hook onto its extracted-evidence label for the Moves family.
fn hook_evidence_name(hook: MechanicHookV2) -> &'static str {
    match hook {
        MechanicHookV2::CriticalQuery => "CRITICAL_QUERY",
        MechanicHookV2::DamageQuery => "DAMAGE_QUERY",
        MechanicHookV2::HitCountQuery => "HIT_COUNT_QUERY",
        _ => "UNRESOLVED_HOOK",
    }
}

/// Stable diagnostic name for any closed surface value.
trait SurfaceName {
    fn surface_name(self) -> &'static str;
}

impl SurfaceName for MechanicQueryV2 {
    fn surface_name(self) -> &'static str {
        match self {
            MechanicQueryV2::MoveType => "MOVE_TYPE",
            MechanicQueryV2::MoveCategory => "MOVE_CATEGORY",
            MechanicQueryV2::MoveTargetShape => "MOVE_TARGET_SHAPE",
            MechanicQueryV2::ActionPriority => "ACTION_PRIORITY",
            MechanicQueryV2::EffectiveSpeed => "EFFECTIVE_SPEED",
            MechanicQueryV2::Accuracy => "ACCURACY",
            MechanicQueryV2::CriticalRate => "CRITICAL_RATE",
            MechanicQueryV2::MovePower => "MOVE_POWER",
            MechanicQueryV2::OffensiveStat => "OFFENSIVE_STAT",
            MechanicQueryV2::DefensiveStat => "DEFENSIVE_STAT",
            MechanicQueryV2::TypeEffectiveness => "TYPE_EFFECTIVENESS",
            MechanicQueryV2::Damage => "DAMAGE",
            MechanicQueryV2::HitCount => "HIT_COUNT",
            MechanicQueryV2::StatusEligibility => "STATUS_ELIGIBILITY",
            MechanicQueryV2::VolatileEligibility => "VOLATILE_ELIGIBILITY",
            MechanicQueryV2::SwitchEligibility => "SWITCH_ELIGIBILITY",
            MechanicQueryV2::ItemEligibility => "ITEM_ELIGIBILITY",
        }
    }
}

impl SurfaceName for MechanicHookV2 {
    fn surface_name(self) -> &'static str {
        match self {
            MechanicHookV2::CriticalQuery => "CRITICAL_QUERY",
            MechanicHookV2::DamageQuery => "DAMAGE_QUERY",
            MechanicHookV2::HitCountQuery => "HIT_COUNT_QUERY",
            _ => "TRIGGER_HOOK",
        }
    }
}

impl SurfaceName for QueryModifierStageV2 {
    fn surface_name(self) -> &'static str {
        match self {
            QueryModifierStageV2::BaseOverride => "BASE_OVERRIDE",
            QueryModifierStageV2::EarlyAdd => "EARLY_ADD",
            QueryModifierStageV2::EarlyMultiply => "EARLY_MULTIPLY",
            QueryModifierStageV2::MidOverride => "MID_OVERRIDE",
            QueryModifierStageV2::LateAdd => "LATE_ADD",
            QueryModifierStageV2::LateMultiply => "LATE_MULTIPLY",
            QueryModifierStageV2::Clamp | QueryModifierStageV2::Cancel => "CONTROL_STAGE",
            QueryModifierStageV2::FinalOverride => "FINAL_OVERRIDE",
        }
    }
}

fn require_equal_query(
    prepared: &QueryTransitionV2,
    direct: &QueryTransitionV2,
    surface: &'static str,
    unit: Option<&BehaviorUnitId>,
) -> Result<(), MoveParityError> {
    if prepared == direct {
        return Ok(());
    }
    let detail = if prepared.evidence.len() != direct.evidence.len() {
        format!(
            "evidence length diverged: prepared {} vs direct {}",
            prepared.evidence.len(),
            direct.evidence.len()
        )
    } else {
        match prepared
            .evidence
            .iter()
            .zip(direct.evidence.iter())
            .enumerate()
            .find(|(_, (left, right))| left != right)
        {
            Some((ordinal, (left, right))) => format!(
                "first differing evidence element at ordinal {ordinal}: prepared {left:?} vs direct {right:?}"
            ),
            None => format!(
                "accumulator result diverged: prepared after {:?} allowed {:?} cancelled {} vs direct after {:?} allowed {:?} cancelled {}",
                prepared.after, prepared.allowed, prepared.cancelled,
                direct.after, direct.allowed, direct.cancelled,
            ),
        }
    };
    Err(MoveParityError::Divergence(Box::new(MoveParityDivergence {
        stage: surface,
        unit: unit.cloned(),
        detail,
    })))
}

fn require_equal_transition(
    prepared: &crate::m6::MechanicsTransitionV2,
    direct: &crate::m6::MechanicsTransitionV2,
    surface: &'static str,
    unit: Option<&BehaviorUnitId>,
) -> Result<(), MoveParityError> {
    if prepared == direct {
        return Ok(());
    }
    let detail = if prepared.operations.len() != direct.operations.len() {
        format!(
            "staged operation count diverged: prepared {} vs direct {}",
            prepared.operations.len(),
            direct.operations.len()
        )
    } else {
        match prepared
            .operations
            .iter()
            .zip(direct.operations.iter())
            .enumerate()
            .find(|(_, (left, right))| left != right)
        {
            Some((ordinal, (left, right))) => format!(
                "first differing staged operation at ordinal {ordinal}: prepared {left:?} vs direct {right:?}"
            ),
            None => "staged operation payloads diverged".to_owned(),
        }
    };
    Err(MoveParityError::Divergence(Box::new(MoveParityDivergence {
        stage: surface,
        unit: unit.cloned(),
        detail,
    })))
}

/// Invalid witnesses must resolve identically on both paths: either both
/// reject through the same typed variant or both apply the same closed
/// modifier semantics. Anything asymmetric diverges.
fn require_compatible_invalid_outcome(
    prepared: &Result<QueryTransitionV2, MechanicsErrorV2>,
    direct: &Result<QueryTransitionV2, MechanicsErrorV2>,
    unit: &BehaviorUnitId,
) -> Result<(), MoveParityError> {
    match (prepared, direct) {
        (Ok(left), Ok(right)) => require_equal_query(left, right, "INVALID_WITNESS", Some(unit)),
        (Err(left), Err(right)) => {
            if format!("{left:?}") != format!("{right:?}") {
                return Err(MoveParityError::Divergence(Box::new(MoveParityDivergence {
                    stage: "INVALID_WITNESS",
                    unit: Some(unit.clone()),
                    detail: format!(
                        "typed rejection diverged: prepared {left:?} vs direct {right:?}"
                    ),
                })));
            }
            Ok(())
        }
        (Ok(_), Err(error)) | (Err(error), Ok(_)) => {
            Err(MoveParityError::Divergence(Box::new(MoveParityDivergence {
                stage: "INVALID_WITNESS",
                unit: Some(unit.clone()),
                detail: format!("one path rejected while the other applied: {error:?}"),
            })))
        }
    }
}

/// BLAKE3 digest prefix over the canonical JSON encoding of one identity.
fn canonical_identity_digest(identity: &BehaviorSourceId) -> Result<u64, MoveParityError> {
    let canonical = canonicalize(identity)?;
    let digest = content_digest(&canonical)?;
    let Some(prefix) = digest
        .get(..16)
        .and_then(|prefix| u64::from_str_radix(prefix, 16).ok())
    else {
        return Err(MoveParityError::IndexOverflow { value: u64::MAX });
    };
    Ok(prefix)
}
