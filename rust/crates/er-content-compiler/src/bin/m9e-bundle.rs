use std::error::Error;
use std::fs::{read, write};

use er_content_compiler::m9e_bundle::{M9_BUNDLE_ORACLE_SHA, build_m9_engineering_bundle_v2};

fn main() -> Result<(), Box<dyn Error>> {
    let args = std::env::args().collect::<Vec<_>>();
    let [
        _,
        battle,
        run,
        progression,
        world,
        scenarios,
        ai,
        bootstrap,
        presentation,
        catalog,
        implementations,
        bundle_path,
        manifest_path,
    ] = args.as_slice()
    else {
        return Err("usage: m9e-bundle <battle> <run> <progression> <world> <scenarios> <ai> <bootstrap> <presentation> <catalog> <implementations> <bundle> <manifest>".into());
    };
    let bundle = build_m9_engineering_bundle_v2(
        &read(battle)?,
        &read(run)?,
        &read(progression)?,
        &read(world)?,
        &read(scenarios)?,
        &read(ai)?,
        &read(bootstrap)?,
        &read(presentation)?,
        &read(catalog)?,
        &read(implementations)?,
    )?;
    let manifest = serde_json::json!({
        "schema_version": 2,
        "oracle_sha": M9_BUNDLE_ORACLE_SHA,
        "content_hash": bundle.content_hash.as_str(),
        "components": {
            "battle": bundle.battle.content_hash.as_str(),
            "run": bundle.run.content_hash.as_str(),
            "progression": bundle.progression.content_hash.as_str(),
            "world": bundle.world.content_hash.as_str(),
            "scenario": bundle.scenarios.content_hash.as_str(),
            "ai": bundle.ai.content_hash.as_str(),
            "meta": bundle.meta.content_hash.as_str(),
            "bootstrap": bundle.bootstrap.content_hash.as_str(),
            "presentation": bundle.presentation.content_hash.as_str()
        },
        "counts": {
            "battle_species": bundle.battle.species.iter().flatten().count(),
            "run_programs": bundle.run.programs.len(),
            "progression_species_forms": bundle.progression.species.len(),
            "world_biomes": bundle.world.biomes.len(),
            "scenarios": bundle.scenarios.scenarios.len(),
            "ai_behaviors": bundle.ai.behavior_bindings.len(),
            "meta_behaviors": bundle.meta.classifications.len(),
            "bootstrap_starters": bundle.bootstrap.starters.len(),
            "presentation_mappings": bundle.presentation.mappings.len()
        },
        "unresolved_cross_references": 0,
        "reachable_unsupported_behaviors": 0,
        "pending_bespoke_behaviors": 0,
        "v1_production_fallbacks": 0
    });
    write(bundle_path, serde_json::to_vec(&bundle)?)?;
    write(manifest_path, serde_json::to_vec(&manifest)?)?;
    Ok(())
}
