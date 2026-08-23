use er_mechanics::{
    BindingKind, HookBinding, MechanicOperation, MechanicsProgramV1, PresentationCueKind,
    ProgramBudget, ProgramRange, SelectorArena, SelectorNode, StageOperationKind, ValueNode,
};
use er_types::SafeU53;
use er_types::mechanics::{
    HookOrdinal, MechanicHook, MechanicSourceId, MechanicSourceKind, MechanicsProgramId,
};
use serde::Deserialize;

use crate::pack::m5_pack::{
    BATTLE_CONTENT_PACK_SCHEMA_VERSION_V2, BattleContentPackV2, BespokeEntryV1,
    ClassificationEntryV1, ClassificationManifestV1,
};
use crate::pack::selected_m4_content_pack;

pub const M5_ORACLE_SHA: &str = "328824692f95b1aa1b38af85b54a6b72d9259eb4";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ClassificationWire {
    schema_version: u32,
    oracle_sha: String,
    source_catalog_sha256: String,
    entries: Vec<ClassificationEntryV1>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BespokeWire {
    schema_version: u32,
    oracle_sha: String,
    entries: Vec<BespokeEntryV1>,
}

pub fn selected_m5_bootstrap_pack() -> Result<BattleContentPackV2, M5BootstrapError> {
    let classification: ClassificationWire = serde_json::from_str(include_str!(
        "../../../fixtures/m5/classification-manifest-v1.json"
    ))?;
    let bespoke: BespokeWire = serde_json::from_str(include_str!(
        "../../../fixtures/m5/bespoke-manifest-v1.json"
    ))?;
    if classification.schema_version != 1
        || bespoke.schema_version != 1
        || classification.oracle_sha != M5_ORACLE_SHA
        || bespoke.oracle_sha != M5_ORACLE_SHA
    {
        return Err(M5BootstrapError::ManifestIdentity);
    }
    let legacy = selected_m4_content_pack()?;
    let active = intimidate_program(MechanicSourceKind::ActiveAbility, 1)?;
    let passive = intimidate_program(MechanicSourceKind::PassiveAbility, 2)?;
    let mut pack = BattleContentPackV2 {
        schema_version: BATTLE_CONTENT_PACK_SCHEMA_VERSION_V2,
        oracle_sha: M5_ORACLE_SHA.to_owned(),
        source_catalog_digest: format!("sha256:{}", classification.source_catalog_sha256),
        content_hash: String::new(),
        species: legacy.species.into_iter().map(Some).collect(),
        moves: legacy.moves.into_iter().map(Some).collect(),
        abilities: legacy.abilities.into_iter().map(Some).collect(),
        held_items: Vec::new(),
        programs: vec![None, Some(active), Some(passive)],
        classifications: ClassificationManifestV1(classification.entries),
        bespoke: bespoke.entries,
        type_chart: legacy.type_chart,
    };
    pack.content_hash = pack.compute_content_hash()?;
    pack.validate()?;
    Ok(pack)
}

fn intimidate_program(
    kind: MechanicSourceKind,
    program_id: u64,
) -> Result<MechanicsProgramV1, M5BootstrapError> {
    let source = MechanicSourceId::numeric(kind, safe(22)?);
    let program_id = MechanicsProgramId::new(safe(program_id)?);
    let program = MechanicsProgramV1 {
        schema_version: er_types::mechanics::MECHANICS_PROGRAM_VERSION,
        id: program_id,
        source,
        bindings: vec![HookBinding {
            binding: BindingKind::Trigger {
                hook: MechanicHook::AfterSummon,
            },
            hook_ordinal: HookOrdinal::ZERO,
            condition_root: None,
            selector_root: None,
            operations: ProgramRange {
                start: 0,
                length: 2,
            },
        }],
        conditions: Default::default(),
        selectors: SelectorArena(vec![SelectorNode::Opponents]),
        values: vec![ValueNode::Signed { value: -1 }],
        operations: vec![
            MechanicOperation::StatStage {
                operation: StageOperationKind::Add,
                targets: er_mechanics::SelectorNodeId::ZERO,
                stat_id: 0,
                stages: er_mechanics::ValueNodeId::ZERO,
            },
            MechanicOperation::Presentation {
                cue: PresentationCueKind::Ability,
                subjects: er_mechanics::SelectorNodeId::ZERO,
                detail_id: Some(safe(22)?),
            },
        ],
        budget: ProgramBudget::ceiling(),
    };
    er_mechanics::validate_family_program(
        er_mechanics::MechanicFamily::StatPrioritySpeedAccuracy,
        &program,
    )?;
    Ok(program)
}

fn safe(value: u64) -> Result<SafeU53, M5BootstrapError> {
    SafeU53::new(value).map_err(|_| M5BootstrapError::UnsafeId { value })
}

#[derive(Debug, thiserror::Error)]
pub enum M5BootstrapError {
    #[error("classification manifest JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("classification manifest identity is invalid")]
    ManifestIdentity,
    #[error("M4 content pack is invalid: {0}")]
    Legacy(#[from] crate::pack::ContentPackError),
    #[error("M5 content pack is invalid: {0}")]
    Pack(#[from] crate::pack::m5_pack::BattlePackLoadError),
    #[error("mechanic family program is invalid: {0}")]
    Family(#[from] er_mechanics::FamilyValidationError),
    #[error("ID {value} exceeds the safe range")]
    UnsafeId { value: u64 },
}
