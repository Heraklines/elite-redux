use std::error::Error;

use er_content_compiler::m9e_scenario::build_m9_engineering_scenario_v2;
use er_scenario::content_v2::ScenarioProgramHandlerV2;
use er_scenario::runtime_v2::{ScenarioControlV2, ScenarioDomainFactoryV2, ScenarioInputV2};
use er_types::ScenarioId;

const SCENARIOS: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/engineering/complete-scenario-definitions-v2.json"
));
const CATALOG: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m7/scenario-catalog-v1.json"
));
const IMPLEMENTATIONS: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m7/m7-behavior-implementation-v2.json"
));
const PACK: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/engineering/scenario-content-pack-v2.json"
));

#[test]
fn complete_scenario_catalog_is_classified_prepared_and_byte_stable() -> Result<(), Box<dyn Error>>
{
    let first = build_m9_engineering_scenario_v2(SCENARIOS, CATALOG, IMPLEMENTATIONS)?;
    let second = build_m9_engineering_scenario_v2(SCENARIOS, CATALOG, IMPLEMENTATIONS)?;
    assert_eq!(first, second);
    assert_eq!(serde_json::to_vec(&first)?, PACK);
    assert_eq!(first.scenarios.len(), 91);
    assert_eq!(first.behavior_bindings.len(), 841);
    assert_eq!(
        first
            .scenarios
            .iter()
            .map(|scenario| scenario.options.len())
            .sum::<usize>(),
        219
    );
    assert!(
        first
            .scenarios
            .iter()
            .all(|scenario| !scenario.nodes.is_empty())
    );
    let prepared = first.clone().prepare()?;
    assert_eq!(
        first
            .scenarios
            .iter()
            .flat_map(|scenario| {
                scenario.options.iter().filter(|option| {
                    prepared
                        .option_program(scenario.id, option.option_index)
                        .is_some()
                })
            })
            .count(),
        219
    );
    Ok(())
}

#[test]
fn scenario_factory_executes_and_restores_the_typed_graph() -> Result<(), Box<dyn Error>> {
    let pack = build_m9_engineering_scenario_v2(SCENARIOS, CATALOG, IMPLEMENTATIONS)?;
    let factory = ScenarioDomainFactoryV2::new(pack.prepare()?);
    let mut runtime = factory.start(ScenarioId::ZERO)?;
    assert!(matches!(
        factory.control(&runtime)?,
        ScenarioControlV2::Message { .. }
    ));

    factory.apply(&mut runtime, ScenarioInputV2::AcknowledgeMessage)?;
    let restored = factory.restore(runtime.clone())?;
    assert_eq!(restored, runtime);
    assert!(matches!(
        factory.control(&runtime)?,
        ScenarioControlV2::Choice { .. }
    ));

    factory.apply(&mut runtime, ScenarioInputV2::Choose(0))?;
    assert!(matches!(
        factory.control(&runtime)?,
        ScenarioControlV2::ExecuteOption { .. }
    ));
    let program = factory.program(&runtime)?;
    assert_eq!(program.handler, ScenarioProgramHandlerV2::GroupA);
    assert_eq!(program.scenario, ScenarioId::ZERO);
    assert_eq!(program.option_index, 0);
    assert_eq!(
        program.apply_callback_sha256,
        "e7b8bf2f9be861c06540559d2607cb2794f83d3a2bbd17befca84f214ffbdde7"
    );
    factory.apply(&mut runtime, ScenarioInputV2::OptionApplied)?;
    assert!(matches!(
        factory.control(&runtime)?,
        ScenarioControlV2::Complete { .. }
    ));
    assert!(runtime.completed_outcome.is_some());
    Ok(())
}

#[test]
fn cleansing_font_options_bind_source_callbacks_to_closed_handlers() -> Result<(), Box<dyn Error>> {
    let pack = build_m9_engineering_scenario_v2(SCENARIOS, CATALOG, IMPLEMENTATIONS)?;
    let factory = ScenarioDomainFactoryV2::new(pack.prepare()?);
    let mut runtime = factory.start(ScenarioId::try_from_u64(73)?)?;
    factory.apply(&mut runtime, ScenarioInputV2::AcknowledgeMessage)?;
    factory.apply(&mut runtime, ScenarioInputV2::Choose(0))?;
    let program = factory.program(&runtime)?;
    assert_eq!(program.handler, ScenarioProgramHandlerV2::GroupG);
    assert_eq!(
        program.apply_callback_sha256,
        "36655e9af0ef2718fc59812babf5584af44146d289918d3c5037e4f59eb36a8d"
    );
    Ok(())
}
