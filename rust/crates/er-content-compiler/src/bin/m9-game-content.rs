use std::error::Error;
use std::fs::{read, write};

use er_content_compiler::m9::build_m9_game_content_bundle;

fn main() -> Result<(), Box<dyn Error>> {
    let args = std::env::args().collect::<Vec<_>>();
    let [
        _,
        base_path,
        starter_path,
        semantic_path,
        bespoke_path,
        output_path,
    ] = args.as_slice()
    else {
        return Err("usage: m9-game-content <base-bundle> <starter-oracle> <semantic-catalog> <bespoke-clusters> <output>".into());
    };
    let bundle = build_m9_game_content_bundle(
        &read(base_path)?,
        &read(starter_path)?,
        &read(semantic_path)?,
        &read(bespoke_path)?,
    )?;
    write(output_path, serde_json::to_vec(&bundle)?)?;
    Ok(())
}
