use std::error::Error;
use std::fs::{read, write};

use er_content::pack::m6_pack::load_battle_content_pack_v3;
use er_content_compiler::m9e_full_content::build_m9_engineering_bootstrap_content_v1;
use er_world::content_v2::WorldContentPackV2;

fn main() -> Result<(), Box<dyn Error>> {
    let args = std::env::args().collect::<Vec<_>>();
    let [_, definitions_path, battle_path, world_path, output_path] = args.as_slice() else {
        return Err(
            "usage: m9e-bootstrap <complete-definitions> <battle-pack> <world-pack-v2> <output>"
                .into(),
        );
    };
    let battle = load_battle_content_pack_v3(&read(battle_path)?)?;
    let world: WorldContentPackV2 = serde_json::from_slice(&read(world_path)?)?;
    let bootstrap =
        build_m9_engineering_bootstrap_content_v1(&read(definitions_path)?, &battle, &world)?;
    write(output_path, serde_json::to_vec(&bootstrap)?)?;
    Ok(())
}
