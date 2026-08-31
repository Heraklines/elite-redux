use std::error::Error;
use std::fs::{read, write};

use er_content_compiler::m9::build_m9_vertical_slice_pack;

fn main() -> Result<(), Box<dyn Error>> {
    let args = std::env::args().collect::<Vec<_>>();
    let [_, starter_path, semantic_path, bespoke_path, output_path] = args.as_slice() else {
        return Err(
            "usage: m9-content <starter-oracle> <semantic-catalog> <bespoke-clusters> <output>"
                .into(),
        );
    };
    let pack = build_m9_vertical_slice_pack(
        &read(starter_path)?,
        &read(semantic_path)?,
        &read(bespoke_path)?,
    )?;
    write(output_path, serde_json::to_vec(&pack)?)?;
    Ok(())
}
