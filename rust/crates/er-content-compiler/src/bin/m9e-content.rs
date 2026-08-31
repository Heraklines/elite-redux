use std::error::Error;
use std::fs::{read, write};

use er_content_compiler::m9e_full_content::build_m9_engineering_battle_pack_v1;

fn main() -> Result<(), Box<dyn Error>> {
    let args = std::env::args().collect::<Vec<_>>();
    let [
        _,
        definitions_path,
        semantic_path,
        bespoke_path,
        output_path,
    ] = args.as_slice()
    else {
        return Err(
            "usage: m9e-content <complete-definitions> <semantic-catalog> <bespoke-clusters> <output>"
                .into(),
        );
    };
    let pack = build_m9_engineering_battle_pack_v1(
        &read(definitions_path)?,
        &read(semantic_path)?,
        &read(bespoke_path)?,
    )?;
    write(output_path, serde_json::to_vec(&pack)?)?;
    Ok(())
}
