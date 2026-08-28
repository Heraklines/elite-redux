//! Offline fail-closed compiler for the M7 game-system catalog.

use std::collections::{BTreeMap, BTreeSet};

use er_game::m7_content::{
    GameBehaviorClassificationV1, META_CONTENT_PACK_SCHEMA_VERSION_V1, MetaContentPackV1,
    RunContentPackV3,
};
use er_types::{
    BattleContentPackHashV3, CatalogHash, GameBehaviorStatus, GameBehaviorUnitId, OracleSha,
    RunProgramV1,
};
use serde::Deserialize;
use thiserror::Error;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameSystemCatalogDocumentV1 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub oracle_tree_sha: String,
    pub source_file_count: usize,
    pub behavior_count: usize,
    pub domain_counts: BTreeMap<String, usize>,
    pub behaviors: Vec<GameSystemBehaviorV1>,
    pub presentation_boundaries: Vec<GameSystemBehaviorV1>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameSystemBehaviorV1 {
    pub id: GameBehaviorUnitId,
    pub source: SourceLocationV1,
    pub declaration_kind: String,
    pub owner: Option<String>,
    pub symbol: String,
    pub domain: String,
    pub implementation_status: SourceImplementationStatusV1,
    pub r#async: bool,
    pub parameter_count: usize,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceLocationV1 {
    pub path: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceImplementationStatusV1 {
    M6Implemented,
    PlatformEffect,
    PresentationOnly,
    RequiresM7,
}

#[derive(Clone, Debug)]
pub struct GameSystemCompileRequestV1 {
    pub catalog: GameSystemCatalogDocumentV1,
    pub battle_content_hash: BattleContentPackHashV3,
    pub meta_content_hash: CatalogHash,
    pub programs: Vec<RunProgramV1>,
    pub bespoke_behaviors: BTreeSet<GameBehaviorUnitId>,
    pub inert_behaviors: BTreeSet<GameBehaviorUnitId>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompiledGameSystemV1 {
    pub run: RunContentPackV3,
    pub meta: MetaContentPackV1,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GameSystemCompileError {
    #[error("game-system catalog schema version must be 1")]
    SchemaVersion,
    #[error("game-system behavior count does not match its vector")]
    BehaviorCount,
    #[error("game-system behavior identities must be sorted and unique")]
    BehaviorOrder,
    #[error("run programs must be sorted, unique, valid, and catalog-owned")]
    ProgramClosure,
    #[error("behavior {0} has no final implementation disposition")]
    Unclassified(GameBehaviorUnitId),
    #[error("behavior {0} has conflicting implementation dispositions")]
    ConflictingDisposition(GameBehaviorUnitId),
    #[error("platform or presentation behavior was assigned executable mechanics")]
    BoundaryExecution,
    #[error("compiled output failed validation: {0}")]
    Output(String),
}

pub fn compile_game_system_v1(
    request: GameSystemCompileRequestV1,
) -> Result<CompiledGameSystemV1, GameSystemCompileError> {
    let GameSystemCompileRequestV1 {
        catalog,
        battle_content_hash,
        meta_content_hash,
        programs,
        bespoke_behaviors,
        inert_behaviors,
    } = request;
    if catalog.schema_version != 1 {
        return Err(GameSystemCompileError::SchemaVersion);
    }
    if catalog.behavior_count != catalog.behaviors.len() {
        return Err(GameSystemCompileError::BehaviorCount);
    }
    if catalog
        .behaviors
        .windows(2)
        .any(|pair| pair[0].id >= pair[1].id)
    {
        return Err(GameSystemCompileError::BehaviorOrder);
    }
    let known: BTreeSet<_> = catalog
        .behaviors
        .iter()
        .map(|behavior| behavior.id.clone())
        .collect();
    let program_sources = validate_programs(&programs, &known)?;
    for id in bespoke_behaviors.iter().chain(&inert_behaviors) {
        if !known.contains(id) {
            return Err(GameSystemCompileError::ProgramClosure);
        }
    }
    let mut classifications = Vec::with_capacity(catalog.behaviors.len());
    for behavior in &catalog.behaviors {
        let compiled = program_sources.contains(&behavior.id)
            || behavior.implementation_status == SourceImplementationStatusV1::M6Implemented;
        let bespoke = bespoke_behaviors.contains(&behavior.id);
        let inert = inert_behaviors.contains(&behavior.id);
        if usize::from(compiled) + usize::from(bespoke) + usize::from(inert) > 1 {
            return Err(GameSystemCompileError::ConflictingDisposition(
                behavior.id.clone(),
            ));
        }
        let status = match behavior.implementation_status {
            SourceImplementationStatusV1::PlatformEffect => {
                if compiled || bespoke || inert {
                    return Err(GameSystemCompileError::BoundaryExecution);
                }
                GameBehaviorStatus::PlatformEffect
            }
            SourceImplementationStatusV1::PresentationOnly => {
                if compiled || bespoke || inert {
                    return Err(GameSystemCompileError::BoundaryExecution);
                }
                GameBehaviorStatus::PresentationOnly
            }
            SourceImplementationStatusV1::M6Implemented => GameBehaviorStatus::Compiled,
            SourceImplementationStatusV1::RequiresM7 if compiled => GameBehaviorStatus::Compiled,
            SourceImplementationStatusV1::RequiresM7 if bespoke => {
                GameBehaviorStatus::BespokeImplemented
            }
            SourceImplementationStatusV1::RequiresM7 if inert => {
                GameBehaviorStatus::SemanticallyInert
            }
            SourceImplementationStatusV1::RequiresM7 => {
                return Err(GameSystemCompileError::Unclassified(behavior.id.clone()));
            }
        };
        classifications.push(GameBehaviorClassificationV1 {
            behavior: behavior.id.clone(),
            status,
        });
    }
    let run = RunContentPackV3::new(catalog.oracle_sha.clone(), battle_content_hash, programs)
        .map_err(|error| GameSystemCompileError::Output(error.to_string()))?;
    let meta = MetaContentPackV1 {
        schema_version: META_CONTENT_PACK_SCHEMA_VERSION_V1,
        oracle_sha: catalog.oracle_sha,
        content_hash: meta_content_hash,
        classifications,
    };
    meta.validate()
        .map_err(|error| GameSystemCompileError::Output(error.to_string()))?;
    Ok(CompiledGameSystemV1 { run, meta })
}

fn validate_programs(
    programs: &[RunProgramV1],
    known: &BTreeSet<GameBehaviorUnitId>,
) -> Result<BTreeSet<GameBehaviorUnitId>, GameSystemCompileError> {
    if programs.is_empty()
        || programs.windows(2).any(|pair| pair[0].id >= pair[1].id)
        || programs
            .iter()
            .any(|program| program.validate().is_err() || !known.contains(&program.source))
    {
        return Err(GameSystemCompileError::ProgramClosure);
    }
    let sources: BTreeSet<_> = programs
        .iter()
        .map(|program| program.source.clone())
        .collect();
    if sources.len() != programs.len() {
        return Err(GameSystemCompileError::ProgramClosure);
    }
    Ok(sources)
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use er_types::{
        BattleContentPackHashV3, BiomeId, CatalogHash, GameBehaviorUnitId, OracleSha, RunCondition,
        RunConditionId, RunFlagId, RunHook, RunHookBinding, RunOperation, RunProgramBudget,
        RunProgramId, RunProgramV1, SafeU53,
    };

    use super::{
        GameSystemBehaviorV1, GameSystemCatalogDocumentV1, GameSystemCompileError,
        GameSystemCompileRequestV1, SourceImplementationStatusV1, SourceLocationV1,
        compile_game_system_v1,
    };

    fn behavior(fill: char) -> GameBehaviorUnitId {
        GameBehaviorUnitId::parse(fill.to_string().repeat(64)).expect("behavior ID")
    }

    fn program(source: GameBehaviorUnitId) -> RunProgramV1 {
        RunProgramV1 {
            schema_version: 1,
            id: RunProgramId::new(SafeU53::new(1).expect("program ID")),
            source,
            hooks: vec![RunHookBinding {
                hook: RunHook::RunStarted,
                condition: RunConditionId(0),
                first_operation: 0,
                operation_count: 1,
            }],
            conditions: vec![RunCondition::Always],
            selectors: Vec::new(),
            values: Vec::new(),
            operations: vec![RunOperation::SetRunFlag {
                flag: RunFlagId::new(SafeU53::new(1).expect("flag ID")),
                value: true,
            }],
            budget: RunProgramBudget {
                condition_nodes: 1,
                selector_nodes: 0,
                value_nodes: 0,
                operations: 1,
                emitted_presentations: 0,
            },
        }
    }

    fn source(id: GameBehaviorUnitId) -> GameSystemBehaviorV1 {
        GameSystemBehaviorV1 {
            id,
            source: SourceLocationV1 {
                path: "src/run.ts".to_owned(),
                line: 1,
                column: 1,
            },
            declaration_kind: "FUNCTION".to_owned(),
            owner: None,
            symbol: "runBehavior".to_owned(),
            domain: "RUN_META".to_owned(),
            implementation_status: SourceImplementationStatusV1::RequiresM7,
            r#async: false,
            parameter_count: 0,
        }
    }

    fn request(behaviors: Vec<GameSystemBehaviorV1>) -> GameSystemCompileRequestV1 {
        let oracle = OracleSha::parse("399d5d368f0b5642ebf8f45bd8a5e73350fa4de7").expect("oracle");
        let first = behaviors[0].id.clone();
        GameSystemCompileRequestV1 {
            catalog: GameSystemCatalogDocumentV1 {
                schema_version: 1,
                oracle_sha: oracle,
                oracle_tree_sha: "5".repeat(40),
                source_file_count: 1,
                behavior_count: behaviors.len(),
                domain_counts: BTreeMap::from([("RUN_META".to_owned(), behaviors.len())]),
                behaviors,
                presentation_boundaries: Vec::new(),
            },
            battle_content_hash: BattleContentPackHashV3::parse(format!(
                "blake3-v3:{}",
                "b".repeat(64)
            ))
            .expect("battle hash"),

            meta_content_hash: CatalogHash::parse("d".repeat(64)).expect("meta hash"),
            programs: vec![program(first)],
            bespoke_behaviors: BTreeSet::new(),
            inert_behaviors: BTreeSet::new(),
        }
    }

    #[test]
    fn compiled_program_closes_required_behavior() {
        let compiled =
            compile_game_system_v1(request(vec![source(behavior('a'))])).expect("compiled catalog");
        assert_eq!(compiled.run.programs.len(), 1);
        assert_eq!(compiled.meta.classifications.len(), 1);
    }

    #[test]
    fn unimplemented_behavior_fails_closed() {
        let missing = behavior('b');
        let error = compile_game_system_v1(request(vec![
            source(behavior('a')),
            source(missing.clone()),
        ]));
        assert_eq!(error, Err(GameSystemCompileError::Unclassified(missing)));
    }

    #[test]
    fn unsupported_operation_is_rejected_during_preparation() {
        let mut input = request(vec![source(behavior('a'))]);
        input.programs[0].operations = vec![RunOperation::GenerateEncounter {
            encounter: er_types::EncounterId::new(SafeU53::new(1).expect("encounter")),
        }];
        assert!(matches!(
            compile_game_system_v1(input),
            Err(GameSystemCompileError::Output(_))
        ));
    }
}
