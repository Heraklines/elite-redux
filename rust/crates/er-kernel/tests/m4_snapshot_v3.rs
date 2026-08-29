use er_kernel::snapshot::{
    HeldLogicalButtonSnapshotV2, InputButtonLockSnapshotV2, InputRouterSnapshotV2,
    PhysicalInputSourceV2, PressedPhysicalInputSnapshotV2,
};
use er_state::run_v2::{CrossroadsSurfaceState, RunSurfaceState, SurfaceHeader};
use er_types::battle_ids::{MenuInstanceId, WaveIndex};
use er_types::battle_ui::PresentationPlanDigest;
use er_types::run_ids::{RunInteractionSequence, RunSurfaceId, SurfaceDigest};
use er_types::ui::CancelPolicy;
use er_types::ui_menu::{LogicalMenu, LogicalMenuOption};
use er_types::{GameButton, InputFocus, OperationId, PhysicalKey, SafeU53, SeatId};
use serde::Serialize;
use serde::de::DeserializeOwned;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test values are safe")
}

fn round_trip<T>(value: &T) -> T
where
    T: Serialize + DeserializeOwned,
{
    serde_json::from_slice(&serde_json::to_vec(value).expect("serialize")).expect("deserialize")
}

#[test]
fn held_input_is_retained_by_the_v3_input_owner_schema() {
    let seat = SeatId::new(safe(1));
    let menu_instance_id = MenuInstanceId::new(safe(7));
    let snapshot = InputRouterSnapshotV2 {
        focus: InputFocus::Game,
        pressed: vec![PressedPhysicalInputSnapshotV2 {
            seat,
            source: PhysicalInputSourceV2::Keyboard(PhysicalKey::KeyA),
            logical_button: Some(GameButton::Submit),
            printable: true,
            accepted: true,
            menu_instance_id: Some(menu_instance_id),
        }],
        suppressed_printable_keys: vec![PhysicalKey::KeyB],
        held_buttons: vec![HeldLogicalButtonSnapshotV2 {
            seat,
            button: GameButton::Submit,
            source: PhysicalInputSourceV2::Keyboard(PhysicalKey::KeyA),
            menu_instance_id,
        }],
        locks: vec![InputButtonLockSnapshotV2 {
            seat,
            button: GameButton::Submit,
            menu_instance_id,
        }],
        repeats: Vec::new(),
        disposed: false,
    };
    let restored = round_trip(&snapshot);
    assert_eq!(restored.held_buttons, snapshot.held_buttons);
    assert_eq!(restored.locks, snapshot.locks);
    assert_eq!(restored.pressed, snapshot.pressed);
}

#[test]
fn active_run_surface_retains_menu_identity_and_surface_digest() {
    let seat = SeatId::new(safe(1));
    let menu_instance_id = MenuInstanceId::new(safe(9));
    let option_id = er_types::MenuOptionId::new("stay".to_owned()).expect("option ID");
    let option = LogicalMenuOption::new(option_id.clone(), true, None).expect("menu option");
    let menu = LogicalMenu::new(
        menu_instance_id,
        seat,
        "crossroads-control",
        option_id,
        vec![option],
        Vec::new(),
        CancelPolicy::Disabled,
    )
    .expect("menu");
    let digest = SurfaceDigest::new(format!("blake3-v1:{}", "a".repeat(64))).expect("digest");
    let surface = RunSurfaceState::Crossroads(CrossroadsSurfaceState {
        header: SurfaceHeader {
            schema_version: 1,
            surface_id: RunSurfaceId::new(safe(11)),
            kind: er_types::RunSurfaceKind::Crossroads,
            owner_seat: seat,
            interaction_sequence: RunInteractionSequence::new(safe(3)),
            action_ordinal: 2,
            operation_id: OperationId::new("crossroads-op".to_owned()).expect("operation ID"),
            menu,
            surface_digest: digest.clone(),
        },
        source_wave: WaveIndex::new(safe(8)).expect("wave"),
    });
    let restored = round_trip(&surface);
    restored.validate().expect("surface validates");
    assert_eq!(restored.header().surface_digest, digest);
    assert_eq!(restored.header().surface_id, surface.header().surface_id);
    assert_eq!(restored.header().menu.instance_id, menu_instance_id);
}

#[test]
fn v3_digest_deserialization_remains_strict_about_unknown_fields() {
    let value = serde_json::json!({
        "schema_version": 3,
        "canonical_snapshot": "00",
        "unexpected": true,
    });
    let error = serde_json::from_value::<er_types::TraceSnapshotEnvelopeV3>(value)
        .expect_err("tagged V3 values reject unknown fields");
    assert!(error.to_string().contains("unknown field"));
    let _ = PresentationPlanDigest::new(format!("blake3-v1:{}", "b".repeat(64))).expect("digest");
}
