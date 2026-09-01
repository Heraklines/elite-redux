use std::error::Error;

use er_game::m9e_content_v2::GameContentBundleV2;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{GameControlKindV2, SafeU53, SeatId};
use er_wasm::m9e_parity::{M9EParityRequestV1, replay_m9e_eventwise_native};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value is safe")
}

fn profile() -> ProfileStateV1 {
    ProfileStateV1 {
        schema_version: PROFILE_STATE_SCHEMA_VERSION_V1,
        unlocks: Vec::new(),
        achievements: Vec::new(),
        challenges: Vec::new(),
        flags: Default::default(),
        statistics: ProfileStatistics {
            runs_started: SafeU53::ZERO,
            runs_won: SafeU53::ZERO,
            runs_lost: SafeU53::ZERO,
            battles_won: SafeU53::ZERO,
            pokemon_captured: SafeU53::ZERO,
            highest_wave: WaveIndex::new(safe(1)).expect("wave is valid"),
        },
        dex: DexState::default(),
    }
}

fn push_press(events: &mut Vec<RawInputEvent>, code: PhysicalKey) {
    events.push(RawInputEvent::KeyDown {
        code: code.clone(),
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    });
    events.push(RawInputEvent::KeyUp { code });
}

fn request() -> Result<M9EParityRequestV1, Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let mut events = Vec::new();
    push_press(&mut events, PhysicalKey::Space);
    push_press(&mut events, PhysicalKey::Space);
    push_press(&mut events, PhysicalKey::Space);
    for _ in 0..bundle.bootstrap.starters.len() {
        push_press(&mut events, PhysicalKey::ArrowDown);
    }
    push_press(&mut events, PhysicalKey::Space);
    push_press(&mut events, PhysicalKey::Space);
    push_press(&mut events, PhysicalKey::Space);
    push_press(&mut events, PhysicalKey::Space);
    push_press(&mut events, PhysicalKey::Space);
    push_press(&mut events, PhysicalKey::Space);
    Ok(M9EParityRequestV1 {
        bundle,
        profile: profile(),
        seed: "m9e-native-wasm-eventwise".to_owned(),
        local_seat: SeatId::new(safe(1)),
        save_slots: vec!["m9e-parity-slot".to_owned()],
        local_is_host: true,
        events,
    })
}

fn assert_eventwise_parity_contract() -> Result<(), Box<dyn Error>> {
    let request = request()?;
    let event_count = request.events.len();
    assert!(request.events.iter().all(|event| matches!(
        event,
        RawInputEvent::KeyDown { .. } | RawInputEvent::KeyUp { .. }
    )));
    let first = replay_m9e_eventwise_native(request)?;
    assert_eq!(first.observations.len(), event_count);
    assert_eq!(
        first.observations.last().and_then(|item| item.control_kind),
        Some(GameControlKindV2::BattleCommand)
    );
    assert!(
        first
            .observations
            .iter()
            .any(|item| item.control_kind == Some(GameControlKindV2::BattleMove))
    );
    for (index, observation) in first.observations.iter().enumerate() {
        assert_eq!(observation.sequence.get(), (index + 1) as u64);
        assert!(!observation.input_digest.is_empty());
        assert!(!observation.effect_digest.is_empty());
        assert!(!observation.internal_event_digest.is_empty());
        assert!(!observation.mechanical_state_digest.is_empty());
        assert!(!observation.kernel_determinism_digest.is_empty());
    }
    let report_digest = er_canonical::content_digest(&first)?;
    assert_eq!(
        report_digest,
        "13aee334c66c6e0da239f0c4f56317ccc039af6362d340a7b56c753c92b7c1c3"
    );
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn native_replays_v7_raw_inputs_eventwise() -> Result<(), Box<dyn Error>> {
    assert_eventwise_parity_contract()
}
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen_test::wasm_bindgen_test]
fn wasm_replays_v7_raw_inputs_eventwise() -> Result<(), wasm_bindgen::JsValue> {
    assert_eventwise_parity_contract()
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))
}
