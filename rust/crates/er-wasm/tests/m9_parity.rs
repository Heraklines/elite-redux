use std::error::Error;

use er_wasm::m9_parity::{
    M9VerticalParityResultV1, M9VerticalSessionV1, run_m9_vertical_slice_native,
};

const CONTENT: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/solo-entry/content-pack.json"
));
const STARTER: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/solo-entry/starter-oracle-v1.json"
));

#[test]
fn native_vertical_slice_is_byte_deterministic() -> Result<(), Box<dyn Error>> {
    let first = run_m9_vertical_slice_native(CONTENT, STARTER)?;
    let second = run_m9_vertical_slice_native(CONTENT, STARTER)?;
    assert_eq!(first, second);
    let result: M9VerticalParityResultV1 = serde_json::from_str(&first)?;
    assert_eq!(result.completed_battles, 1);
    assert_eq!(
        result
            .final_state
            .active_run
            .as_ref()
            .ok_or("run missing")?
            .wave
            .get()
            .get(),
        2
    );
    Ok(())
}

#[test]
fn browser_session_accepts_only_physical_key_boundaries() -> Result<(), Box<dyn Error>> {
    let mut session = M9VerticalSessionV1::new(CONTENT, STARTER)?;
    for key in [
        "Space",
        "Space",
        "Space",
        "ArrowDown",
        "Space",
        "Space",
        "Space",
        "Space",
    ] {
        press(&mut session, key)?;
    }
    assert_eq!(session.control(), "COMMAND_ROOT");
    for _ in 0..64 {
        press(&mut session, "Space")?;
        assert_eq!(session.control(), "MOVE_SELECT");
        press(&mut session, "Space")?;
        if session.control() == "REWARD" {
            break;
        }
        assert_eq!(session.control(), "COMMAND_ROOT");
    }
    assert_eq!(session.control(), "REWARD");
    press(&mut session, "Space")?;
    let result: M9VerticalParityResultV1 = serde_json::from_str(&session.result_json()?)?;
    assert_eq!(result.completed_battles, 1);
    assert_eq!(
        result.control,
        er_kernel::m9_vertical::M9VerticalControlV1::CommandRoot
    );
    assert!(!session.key_down("Escape", false)?);
    assert!(session.key_up("Escape")?);
    assert!(!session.key_down("KeyZ", false)?);
    assert!(session.key_up("KeyZ")?);
    Ok(())
}

fn press(session: &mut M9VerticalSessionV1, key: &str) -> Result<(), Box<dyn Error>> {
    session.key_down(key, false)?;
    session.key_up(key)?;
    Ok(())
}
