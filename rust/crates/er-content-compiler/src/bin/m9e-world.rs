use std::collections::BTreeSet;
use std::error::Error;
use std::fs::{read, write};

use er_content::pack::m6_pack::load_battle_content_pack_v3;
use er_content_compiler::m9e_full_content::build_m9_engineering_world_content_v2;

fn main() -> Result<(), Box<dyn Error>> {
    let args = std::env::args().collect::<Vec<_>>();
    let [_, definitions_path, battle_path, output_path] = args.as_slice() else {
        return Err("usage: m9e-world <complete-definitions> <battle-pack> <output>".into());
    };
    let battle = load_battle_content_pack_v3(&read(battle_path)?)?;
    let species = battle
        .species
        .iter()
        .flatten()
        .map(|definition| definition.id)
        .collect::<BTreeSet<_>>();
    let world = build_m9_engineering_world_content_v2(&read(definitions_path)?, &species)?;
    write(output_path, serde_json::to_vec(&world)?)?;
    Ok(())
}
