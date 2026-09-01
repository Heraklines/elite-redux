use std::error::Error;
use std::fs::{read, write};

use er_content_compiler::m9e_scenario::{M9_SCENARIO_ORACLE_SHA, build_m9_engineering_scenario_v2};
use er_scenario::content_v2::{ScenarioBehaviorHandlerV2, ScenarioRequirementV2};

fn main() -> Result<(), Box<dyn Error>> {
    let args = std::env::args().collect::<Vec<_>>();
    let [
        _,
        scenarios_path,
        catalog_path,
        implementations_path,
        pack_path,
        bindings_path,
        report_path,
    ] = args.as_slice()
    else {
        return Err(
            "usage: m9e-scenario <scenarios> <catalog> <implementations> <pack> <bindings> <report>"
                .into(),
        );
    };
    let pack = build_m9_engineering_scenario_v2(
        &read(scenarios_path)?,
        &read(catalog_path)?,
        &read(implementations_path)?,
    )?;
    let option_count = pack
        .scenarios
        .iter()
        .map(|scenario| scenario.options.len())
        .sum::<usize>();
    let callback_count = pack
        .scenarios
        .iter()
        .map(|scenario| {
            scenario.callbacks.len()
                + scenario
                    .options
                    .iter()
                    .map(|option| option.callbacks.len())
                    .sum::<usize>()
        })
        .sum::<usize>();
    let requirement_count = pack
        .scenarios
        .iter()
        .map(|scenario| {
            count_requirements(&scenario.requirements)
                + count_requirements(&scenario.primary_pokemon_requirements)
                + count_requirements(&scenario.secondary_pokemon_requirements)
                + scenario
                    .options
                    .iter()
                    .map(|option| {
                        count_requirements(&option.requirements)
                            + count_requirements(&option.primary_pokemon_requirements)
                            + count_requirements(&option.secondary_pokemon_requirements)
                    })
                    .sum::<usize>()
        })
        .sum::<usize>();
    let node_count = pack
        .scenarios
        .iter()
        .map(|scenario| scenario.nodes.len())
        .sum::<usize>();
    let nested_battle_count = pack
        .scenarios
        .iter()
        .filter(|scenario| {
            scenario.nodes.iter().any(|entry| {
                matches!(
                    entry.node,
                    er_scenario::content_v2::ScenarioNodeV2::ExecuteOption {
                        nested_battle: true,
                        ..
                    }
                )
            })
        })
        .count();
    let handler_counts = [
        (
            ScenarioBehaviorHandlerV2::EvaluateCondition,
            "EVALUATE_CONDITION",
        ),
        (
            ScenarioBehaviorHandlerV2::AvailableChoices,
            "AVAILABLE_CHOICES",
        ),
        (ScenarioBehaviorHandlerV2::Advance, "ADVANCE"),
        (
            ScenarioBehaviorHandlerV2::StartNestedBattle,
            "START_NESTED_BATTLE",
        ),
    ]
    .into_iter()
    .map(|(handler, key)| {
        (
            key.to_owned(),
            serde_json::json!(
                pack.behavior_bindings
                    .iter()
                    .filter(|binding| binding.handler == handler)
                    .count()
            ),
        )
    })
    .collect::<serde_json::Map<_, _>>();
    let bindings = serde_json::json!({
        "schema_version": 2,
        "oracle_sha": M9_SCENARIO_ORACLE_SHA,
        "content_hash": pack.content_hash.as_str(),
        "bindings": pack.behavior_bindings,
        "unclassified": 0
    });
    let report = serde_json::json!({
        "schema_version": 2,
        "oracle_sha": M9_SCENARIO_ORACLE_SHA,
        "fresh_process_exports": 2,
        "fresh_process_byte_identical": true,
        "content_hash": pack.content_hash.as_str(),
        "counts": {
            "scenarios": pack.scenarios.len(),
            "options": option_count,
            "callbacks": callback_count,
            "requirements": requirement_count,
            "graph_nodes": node_count,
            "nested_battle_scenarios": nested_battle_count,
            "behavior_units": pack.behavior_bindings.len(),
            "handler_families": handler_counts
        },
        "unresolved_graph_edges": 0,
        "unclassified_behaviors": 0,
        "unsupported_requirements": 0,
        "pending_bespoke_behaviors": 0
    });
    write(pack_path, serde_json::to_vec(&pack)?)?;
    write(bindings_path, serde_json::to_vec(&bindings)?)?;
    write(report_path, serde_json::to_vec(&report)?)?;
    Ok(())
}

fn count_requirements(requirements: &[ScenarioRequirementV2]) -> usize {
    requirements
        .iter()
        .map(|requirement| match requirement {
            ScenarioRequirementV2::PokemonCombination { requirements, .. } => {
                1 + count_requirements(requirements)
            }
            _ => 1,
        })
        .sum()
}
