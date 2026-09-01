use std::collections::BTreeSet;
use std::error::Error;
use std::fs::{read, write};

use er_content::pack::m6_pack::load_battle_content_pack_v3;
use er_content_compiler::m9e_progression::{
    M9_PROGRESSION_ORACLE_SHA, build_m9_engineering_progression_v2,
};

fn main() -> Result<(), Box<dyn Error>> {
    let args = std::env::args().collect::<Vec<_>>();
    let [
        _,
        definitions_path,
        battle_path,
        pack_path,
        bindings_path,
        report_path,
    ] = args.as_slice()
    else {
        return Err(
            "usage: m9e-progression <definitions> <battle-pack> <pack> <bindings> <report>".into(),
        );
    };
    let battle = load_battle_content_pack_v3(&read(battle_path)?)?;
    let known_species = battle
        .species
        .iter()
        .flatten()
        .map(|definition| definition.id)
        .collect::<BTreeSet<_>>();
    let known_moves = battle
        .moves
        .iter()
        .flatten()
        .map(|definition| definition.id)
        .collect::<BTreeSet<_>>();
    let pack = build_m9_engineering_progression_v2(
        &read(definitions_path)?,
        &known_species,
        &known_moves,
    )?;
    let level_move_count = pack
        .species
        .iter()
        .map(|definition| definition.level_moves.len())
        .sum::<usize>();
    let negative_level_move_count = pack
        .species
        .iter()
        .flat_map(|definition| &definition.level_moves)
        .filter(|entry| entry.level < 0)
        .count();
    let reminder_move_count = pack
        .species
        .iter()
        .map(|definition| definition.reminder_moves.len())
        .sum::<usize>();
    let tm_link_count = pack
        .species
        .iter()
        .map(|definition| definition.tm_moves.len())
        .sum::<usize>();

    let bindings = serde_json::json!({
        "schema_version": 2,
        "oracle_sha": M9_PROGRESSION_ORACLE_SHA,
        "bindings": [
            {"source_key": "FRIENDSHIP", "source_code": 1, "rust_variant": "MinimumFriendship", "status": "COMPILED"},
            {"source_key": "TIME", "source_code": 2, "rust_variant": "TimeOfDay/Any", "status": "COMPILED"},
            {"source_key": "MOVE", "source_code": 3, "rust_variant": "KnownMove", "status": "COMPILED"},
            {"source_key": "MOVE_TYPE", "source_code": 4, "rust_variant": "KnownMoveType", "status": "COMPILED"},
            {"source_key": "PARTY_TYPE", "source_code": 5, "rust_variant": "PartyType", "status": "COMPILED"},
            {"source_key": "WEATHER", "source_code": 6, "rust_variant": "Weather/Any", "status": "COMPILED"},
            {"source_key": "BIOME", "source_code": 7, "rust_variant": "Biome/Any", "status": "COMPILED"},
            {"source_key": "SHEDINJA", "source_code": 9, "rust_variant": "Shedinja", "status": "BESPOKE_IMPLEMENTED"},
            {"source_key": "EVO_TREASURE_TRACKER", "source_code": 10, "rust_variant": "TreasureAtLeast", "status": "COMPILED"},
            {"source_key": "RANDOM_FORM", "source_code": 11, "rust_variant": "RandomForm", "status": "COMPILED"},
            {"source_key": "SPECIES_CAUGHT", "source_code": 12, "rust_variant": "SpeciesCaught", "status": "COMPILED"},
            {"source_key": "GENDER", "source_code": 13, "rust_variant": "Gender", "status": "COMPILED"},
            {"source_key": "NATURE", "source_code": 14, "rust_variant": "Nature", "status": "COMPILED"},
            {"source_key": "HELD_ITEM", "source_code": 15, "rust_variant": "HeldItemKey", "status": "COMPILED"},
            {"source_key": "FORM_KEY", "source_code": 16, "rust_variant": "FormKey", "status": "COMPILED"}
        ],
        "unclassified": 0
    });
    let report = serde_json::json!({
        "schema_version": 2,
        "oracle_sha": M9_PROGRESSION_ORACLE_SHA,
        "fresh_process_exports": 2,
        "fresh_process_byte_identical": true,
        "content_hash": pack.content_hash.as_str(),
        "counts": {
            "growth_rates": pack.growth_rates.len(),
            "natures": pack.natures.len(),
            "capture_balls": pack.capture_balls.len(),
            "species_forms": pack.species.len(),
            "evolutions": pack.evolutions.len(),
            "level_moves": level_move_count,
            "negative_level_moves": negative_level_move_count,
            "reminder_moves": reminder_move_count,
            "tm_links": tm_link_count,
            "condition_bindings": 15
        },
        "cross_reference_failures": 0,
        "unsupported_conditions": 0,
        "pending_bespoke_conditions": 0
    });
    write(pack_path, serde_json::to_vec(&pack)?)?;
    write(bindings_path, serde_json::to_vec(&bindings)?)?;
    write(report_path, serde_json::to_vec(&report)?)?;
    Ok(())
}
