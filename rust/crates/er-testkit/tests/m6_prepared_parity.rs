use std::error::Error;

use er_battle::m6::{
    MechanicsContextV2, QueryValueV2, execute_hook_v2, execute_hook_v2_direct_reference,
    execute_query_v2, execute_query_v2_direct_reference,
};
use er_content::m6_catalog::SemanticCatalogV1;
use er_content::pack::m6_pack::{
    BattleContentPackV3, BehaviorClassificationEntryV2, BehaviorClassificationManifestV2,
    BespokeManifestV2, FieldContentV1,
};
use er_content::pack::m6_prepared::prepare_content;
use er_content_compiler::m6::{
    SemanticCatalogInput, ValidatedSemanticCatalog, map_routine_catalog,
};
use er_mechanics::condition_v2::ExactRatioV2;
use er_mechanics::program_v2::MechanicsProgramV2;
use er_mechanics::v2::{MechanicHookV2, MechanicQueryV2};
use er_types::mechanics::MechanicsProgramId;
use er_types::{
    BattleContentPackHashV3, BehaviorClassificationKindV2, BehaviorSourceId, CatalogHash,
    M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION, OracleSha,
};

const QUERIES: [MechanicQueryV2; 17] = [
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

const TRIGGER_HOOKS: [MechanicHookV2; 24] = [
    MechanicHookV2::BattleLoad,
    MechanicHookV2::BattleStart,
    MechanicHookV2::BeforeSummon,
    MechanicHookV2::AfterSummon,
    MechanicHookV2::BeforeActionOrder,
    MechanicHookV2::BeforeAction,
    MechanicHookV2::BeforeMove,
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

fn catalog() -> Result<ValidatedSemanticCatalog, Box<dyn Error>> {
    let catalog = SemanticCatalogV1::from_bytes(include_bytes!(
        "../../../fixtures/m6/semantic-catalog-v1.json"
    ))?;
    let raw_hash = CatalogHash::parse(catalog.raw_catalog_hash.clone())?;
    Ok(ValidatedSemanticCatalog::new(SemanticCatalogInput::new(
        catalog, raw_hash,
    ))?)
}

fn build_programs_and_content() -> Result<
    (
        Vec<MechanicsProgramV2>,
        er_content::pack::m6_prepared::PreparedBattleContentV3,
    ),
    Box<dyn Error>,
> {
    let catalog = catalog()?;
    let mapped = map_routine_catalog(catalog.behavior_units())?;
    assert_eq!(mapped.mapped.len(), 46);

    let mut direct = Vec::with_capacity(mapped.mapped.len());
    let mut programs = vec![None];
    let mut classifications = Vec::with_capacity(mapped.mapped.len());
    for (index, spec) in mapped.mapped.into_iter().enumerate() {
        let id = MechanicsProgramId::try_from_u64(u64::try_from(index)? + 1)?;
        classifications.push(BehaviorClassificationEntryV2 {
            behavior_unit: spec.behavior_unit.clone(),
            kind: BehaviorClassificationKindV2::Compiled,
            programs: vec![id],
            bespoke: None,
            unsupported_reason: None,
        });
        let program = spec.build(id)?;
        direct.push(program.clone());
        programs.push(Some(program));
    }

    let mut pack = BattleContentPackV3 {
        schema_version: M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION,
        oracle_sha: OracleSha::parse(catalog.oracle_sha().to_owned())?,
        raw_catalog_hash: CatalogHash::parse(catalog.raw_catalog_hash().to_owned())?,
        semantic_catalog_hash: catalog.semantic_catalog_hash().clone(),
        content_hash: BattleContentPackHashV3::parse(format!(
            "{}{}",
            BattleContentPackHashV3::PREFIX,
            "0".repeat(64)
        ))?,
        species: Vec::new(),
        forms: Vec::new(),
        moves: Vec::new(),
        abilities: Vec::new(),
        held_items: Vec::new(),
        field_content: FieldContentV1::default(),
        programs,
        classifications: BehaviorClassificationManifestV2(classifications),
        bespoke: BespokeManifestV2::default(),
        rng_sites: Vec::new(),
        type_chart: er_content::pack::selected_type_chart(),
    };
    pack.content_hash = pack.compute_content_hash()?;
    Ok((direct, prepare_content(pack)?))
}

fn query_initial(query: MechanicQueryV2) -> QueryValueV2 {
    match query {
        MechanicQueryV2::MoveType => QueryValueV2::TypeId(1),
        MechanicQueryV2::MoveCategory => QueryValueV2::CategoryId(1),
        MechanicQueryV2::MoveTargetShape => QueryValueV2::TargetId(1),
        MechanicQueryV2::TypeEffectiveness => QueryValueV2::Ratio(ExactRatioV2 {
            numerator: 1,
            denominator: 1,
        }),
        MechanicQueryV2::StatusEligibility
        | MechanicQueryV2::VolatileEligibility
        | MechanicQueryV2::SwitchEligibility
        | MechanicQueryV2::ItemEligibility => QueryValueV2::Boolean(true),
        _ => QueryValueV2::Signed(7),
    }
}

fn active_sources(programs: &[MechanicsProgramV2]) -> Vec<BehaviorSourceId> {
    let mut sources: Vec<_> = programs
        .iter()
        .map(|program| program.source.clone())
        .collect();
    sources.sort();
    sources.dedup();
    sources
}

#[test]
fn prepared_and_direct_routine_executors_are_identical() -> Result<(), Box<dyn Error>> {
    let (programs, prepared) = build_programs_and_content()?;
    let active = active_sources(&programs);

    for suppressed in [&[][..], active.as_slice()] {
        let context = MechanicsContextV2 {
            active_sources: &active,
            suppressed_sources: suppressed,
            instance_counter: 3,
            hp_current: 47,
            hp_max: 101,
            turn_index: 9,
            wave_index: 12,
            level: 31,
        };

        for query in QUERIES {
            let initial = query_initial(query);
            let direct =
                execute_query_v2_direct_reference(&programs, &context, query, initial.clone())?;
            let indexed = execute_query_v2(&prepared, &context, query, initial)?;
            assert_eq!(indexed, direct, "prepared query diverged for {query:?}");
        }

        for hook in TRIGGER_HOOKS {
            let direct = execute_hook_v2_direct_reference(&programs, &context, hook)?;
            let indexed = execute_hook_v2(&prepared, &context, hook)?;
            assert_eq!(indexed, direct, "prepared hook diverged for {hook:?}");
        }
    }
    Ok(())
}
