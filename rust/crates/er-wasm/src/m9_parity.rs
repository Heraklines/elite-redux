use std::collections::BTreeMap;
use std::sync::Arc;

use er_canonical::{canonicalize, content_digest};
use er_game::m7_content::{GameContentBundleV1, PreparedGameContentV1};
use er_game::m9_new_run::build_m9_bootstrap_machine;
use er_kernel::m9_vertical::{M9VerticalControlV1, M9VerticalSliceKernelV1};
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{SafeU53, SeatId};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M9VerticalParityResultV1 {
    pub completed_battles: u32,
    pub control: M9VerticalControlV1,
    pub final_state_digest: String,
    pub final_state: er_state::m7_state::GameStateV5,
}

#[derive(Debug)]
pub struct M9VerticalSessionV1 {
    kernel: M9VerticalSliceKernelV1,
}

impl M9VerticalSessionV1 {
    pub fn new(content_bytes: &[u8], starter_oracle_bytes: &[u8]) -> Result<Self, String> {
        Ok(Self {
            kernel: build_vertical_kernel(content_bytes, starter_oracle_bytes)?,
        })
    }

    pub fn key_down(&mut self, code: &str, browser_repeat: bool) -> Result<bool, String> {
        let code = physical_key(code);
        let printable = is_printable(&code);
        self.kernel
            .raw_input(RawInputEvent::KeyDown {
                code,
                printable,
                browser_repeat,
                focus: InputFocus::Game,
            })
            .map_err(|error| error.to_string())
    }

    pub fn key_up(&mut self, code: &str) -> Result<bool, String> {
        self.kernel
            .raw_input(RawInputEvent::KeyUp {
                code: physical_key(code),
            })
            .map_err(|error| error.to_string())
    }

    pub fn control(&self) -> &'static str {
        control_name(self.kernel.control())
    }

    pub fn result_json(&self) -> Result<String, String> {
        result_json(&self.kernel)
    }
}

pub fn run_m9_vertical_slice_native(
    content_bytes: &[u8],
    starter_oracle_bytes: &[u8],
) -> Result<String, String> {
    let mut session = M9VerticalSessionV1::new(content_bytes, starter_oracle_bytes)?;
    for key in [
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::ArrowDown,
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::Space,
    ] {
        press(&mut session.kernel, key)?;
    }
    for _ in 0..64 {
        press(&mut session.kernel, PhysicalKey::Space)?;
        if session.kernel.control() != M9VerticalControlV1::MoveSelect {
            return Err("M9 command root did not open move selection".to_owned());
        }
        press(&mut session.kernel, PhysicalKey::Space)?;
        if session.kernel.control() == M9VerticalControlV1::Reward {
            break;
        }
        if session.kernel.control() != M9VerticalControlV1::CommandRoot {
            return Err("M9 turn did not return to command root".to_owned());
        }
    }
    if session.kernel.control() != M9VerticalControlV1::Reward {
        return Err("M9 battle did not reach reward control".to_owned());
    }
    press(&mut session.kernel, PhysicalKey::Space)?;
    session.result_json()
}

#[wasm_bindgen]
pub fn run_m9_vertical_slice(
    content_json: &str,
    starter_oracle_json: &str,
) -> Result<String, JsValue> {
    run_m9_vertical_slice_native(content_json.as_bytes(), starter_oracle_json.as_bytes())
        .map_err(|error| JsValue::from_str(&error))
}

fn build_vertical_kernel(
    content_bytes: &[u8],
    starter_oracle_bytes: &[u8],
) -> Result<M9VerticalSliceKernelV1, String> {
    let bundle: GameContentBundleV1 =
        serde_json::from_slice(content_bytes).map_err(|error| error.to_string())?;
    let content = Arc::new(
        PreparedGameContentV1::prepare(Arc::new(bundle)).map_err(|error| error.to_string())?,
    );
    let bootstrap = build_m9_bootstrap_machine(
        empty_profile(),
        SeatId::new(safe(1)?),
        vec!["rust-slot-0".to_owned()],
        true,
        starter_oracle_bytes,
    )
    .map_err(|error| error.to_string())?;
    M9VerticalSliceKernelV1::new(bootstrap, content, starter_oracle_bytes.to_vec())
        .map_err(|error| error.to_string())
}

fn result_json(kernel: &M9VerticalSliceKernelV1) -> Result<String, String> {
    let final_state = kernel
        .state()
        .cloned()
        .ok_or_else(|| "M9 final state is missing".to_owned())?;
    let final_state_digest = content_digest(&final_state)
        .map(|digest| format!("blake3-v1:{digest}"))
        .map_err(|error| error.to_string())?;
    canonicalize(&M9VerticalParityResultV1 {
        completed_battles: kernel.completed_battles(),
        control: kernel.control(),
        final_state_digest,
        final_state,
    })
    .map_err(|error| error.to_string())
}

fn physical_key(code: &str) -> PhysicalKey {
    match code {
        "ArrowUp" => PhysicalKey::ArrowUp,
        "ArrowDown" => PhysicalKey::ArrowDown,
        "ArrowLeft" => PhysicalKey::ArrowLeft,
        "ArrowRight" => PhysicalKey::ArrowRight,
        "Enter" => PhysicalKey::Enter,
        "Space" => PhysicalKey::Space,
        "Escape" => PhysicalKey::Escape,
        "Backspace" => PhysicalKey::Backspace,
        "KeyA" => PhysicalKey::KeyA,
        "KeyB" => PhysicalKey::KeyB,
        "KeyC" => PhysicalKey::KeyC,
        "KeyD" => PhysicalKey::KeyD,
        "KeyE" => PhysicalKey::KeyE,
        "KeyF" => PhysicalKey::KeyF,
        "KeyN" => PhysicalKey::KeyN,
        "KeyR" => PhysicalKey::KeyR,
        "KeyT" => PhysicalKey::KeyT,
        _ => PhysicalKey::Unknown(code.to_owned()),
    }
}

const fn is_printable(code: &PhysicalKey) -> bool {
    matches!(
        code,
        PhysicalKey::KeyA
            | PhysicalKey::KeyB
            | PhysicalKey::KeyC
            | PhysicalKey::KeyD
            | PhysicalKey::KeyE
            | PhysicalKey::KeyF
            | PhysicalKey::KeyN
            | PhysicalKey::KeyR
            | PhysicalKey::KeyT
            | PhysicalKey::Space
    )
}

const fn control_name(control: M9VerticalControlV1) -> &'static str {
    match control {
        M9VerticalControlV1::Bootstrap => "BOOTSTRAP",
        M9VerticalControlV1::CommandRoot => "COMMAND_ROOT",
        M9VerticalControlV1::MoveSelect => "MOVE_SELECT",
        M9VerticalControlV1::Reward => "REWARD",
    }
}

fn press(kernel: &mut M9VerticalSliceKernelV1, key: PhysicalKey) -> Result<(), String> {
    kernel
        .raw_input(RawInputEvent::KeyDown {
            code: key.clone(),
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        })
        .map_err(|error| error.to_string())?;
    kernel
        .raw_input(RawInputEvent::KeyUp { code: key })
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn empty_profile() -> ProfileStateV1 {
    ProfileStateV1 {
        schema_version: PROFILE_STATE_SCHEMA_VERSION_V1,
        unlocks: Vec::new(),
        achievements: Vec::new(),
        challenges: Vec::new(),
        flags: BTreeMap::new(),
        statistics: ProfileStatistics {
            runs_started: SafeU53::ZERO,
            runs_won: SafeU53::ZERO,
            runs_lost: SafeU53::ZERO,
            battles_won: SafeU53::ZERO,
            pokemon_captured: SafeU53::ZERO,
            highest_wave: WaveIndex::new(SafeU53::new(1).expect("one is a positive wave"))
                .expect("one is a positive wave"),
        },
        dex: DexState::default(),
    }
}

fn safe(value: u64) -> Result<SafeU53, String> {
    SafeU53::new(value).map_err(|error| error.to_string())
}
