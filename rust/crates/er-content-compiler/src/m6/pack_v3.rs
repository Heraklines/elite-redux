//! Deterministic assembly of a runtime `BattleContentPackV3`.

use std::collections::BTreeMap;

use er_content::pack::TypeChart;
use er_content::pack::m6_pack::{
    AbilityDefinitionV3, BattleContentPackV3, FieldContentV1, FormDefinitionV1,
    HeldItemDefinitionV3, M6PackLoadError, MoveDefinitionV3, SpeciesDefinitionV3,
};
use er_mechanics::MechanicsProgramV2;
use er_mechanics::condition_v2::{ConditionArenaV2, ValueArenaV2};
use er_mechanics::m6::ProgramBudgetV2;
use er_mechanics::selector_operation_v2::SelectorArenaV2;
use er_types::mechanics::MechanicsProgramId;
use er_types::{
    BattleContentPackHashV3, M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION, M6_MECHANICS_PROGRAM_VERSION,
    RngSiteDefinitionV1,
};
use thiserror::Error;

use super::pipeline::SemanticCompileOutput;

#[derive(Clone, Debug)]
pub struct BattleContentDefinitionsV3 {
    pub species: Vec<Option<SpeciesDefinitionV3>>,
    pub forms: Vec<FormDefinitionV1>,
    pub moves: Vec<Option<MoveDefinitionV3>>,
    pub abilities: Vec<Option<AbilityDefinitionV3>>,
    pub held_items: Vec<HeldItemDefinitionV3>,
    pub field_content: FieldContentV1,
    pub rng_sites: Vec<RngSiteDefinitionV1>,
    pub type_chart: TypeChart,
}

pub fn assemble_battle_content_pack_v3(
    semantic: SemanticCompileOutput,
    definitions: BattleContentDefinitionsV3,
) -> Result<BattleContentPackV3, PackAssemblyErrorV3> {
    if semantic.report.unsupported_unit_count != 0 || semantic.report.rng_site_unresolved_count != 0
    {
        return Err(PackAssemblyErrorV3::UnresolvedSemanticClosure {
            unsupported: semantic.report.unsupported_unit_count,
            unresolved_rng: semantic.report.rng_site_unresolved_count,
        });
    }

    let routine_by_id: BTreeMap<MechanicsProgramId, MechanicsProgramV2> = semantic
        .routine_programs
        .into_iter()
        .map(|program| (program.id, program))
        .collect();
    let max_id = semantic
        .programs
        .last()
        .map_or(0, |allocation| allocation.id.get().get());
    let slots = usize::try_from(max_id)
        .map_err(|_| PackAssemblyErrorV3::ProgramIndexOverflow)?
        .checked_add(1)
        .ok_or(PackAssemblyErrorV3::ProgramIndexOverflow)?;
    let mut programs = vec![None; slots];

    for allocation in semantic.programs {
        let id = allocation.id;
        let program = routine_by_id
            .get(&id)
            .cloned()
            .unwrap_or_else(|| MechanicsProgramV2 {
                schema_version: M6_MECHANICS_PROGRAM_VERSION,
                id,
                source: allocation.source,
                behavior_units: allocation.behavior_units,
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
            });
        program
            .validate()
            .map_err(|error| PackAssemblyErrorV3::Program(error.to_string()))?;
        let index = usize::try_from(id.get().get())
            .map_err(|_| PackAssemblyErrorV3::ProgramIndexOverflow)?;
        if programs[index].replace(program).is_some() {
            return Err(PackAssemblyErrorV3::DuplicateProgram { id });
        }
    }

    let mut pack = BattleContentPackV3 {
        schema_version: M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION,
        oracle_sha: er_types::OracleSha::parse(semantic.report.oracle_sha)
            .map_err(|error| PackAssemblyErrorV3::Identity(error.to_string()))?,
        raw_catalog_hash: er_types::CatalogHash::parse(semantic.report.raw_catalog_hash)
            .map_err(|error| PackAssemblyErrorV3::Identity(error.to_string()))?,
        semantic_catalog_hash: er_types::CatalogHash::parse(semantic.report.semantic_catalog_hash)
            .map_err(|error| PackAssemblyErrorV3::Identity(error.to_string()))?,
        content_hash: BattleContentPackHashV3::parse(format!(
            "{}{}",
            BattleContentPackHashV3::PREFIX,
            "0".repeat(64)
        ))
        .map_err(|error| PackAssemblyErrorV3::Identity(error.to_string()))?,
        species: definitions.species,
        forms: definitions.forms,
        moves: definitions.moves,
        abilities: definitions.abilities,
        held_items: definitions.held_items,
        field_content: definitions.field_content,
        programs,
        classifications: semantic.classifications,
        bespoke: semantic.bespoke,
        rng_sites: definitions.rng_sites,
        type_chart: definitions.type_chart,
    };
    pack.content_hash = pack.compute_content_hash()?;
    pack.validate()?;
    Ok(pack)
}

#[derive(Debug, Error)]
pub enum PackAssemblyErrorV3 {
    #[error(
        "semantic closure is unresolved: unsupported={unsupported}, unresolved_rng={unresolved_rng}"
    )]
    UnresolvedSemanticClosure {
        unsupported: usize,
        unresolved_rng: usize,
    },
    #[error("program id does not fit the platform index")]
    ProgramIndexOverflow,
    #[error("duplicate mechanics program {id:?}")]
    DuplicateProgram { id: MechanicsProgramId },
    #[error("compiled program is invalid: {0}")]
    Program(String),
    #[error("pack identity is invalid: {0}")]
    Identity(String),
    #[error("pack validation failed: {0}")]
    Pack(#[from] M6PackLoadError),
}
