//! Remote-only generator for explicitly controlled Active Save/Load checkpoints.
use std::error::Error;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use er_game::m7_progression_control::generic_vertical_control_v2;
use er_game::m9e_content_v2::{
    GameContentBundleV2, PreparedGameContentV2, PresentationCueFamilyV1, PresentationSemanticIdV1,
};
use er_game::m9e_material_v6::{AppliedGameMaterialLedgerV1, GamePlatformEffectV2, GamePresentationEffectV2};
use er_kernel::game_kernel_v7::{
    GameKernelEffectV7, GameKernelRoleV7, GameKernelV7, KernelStorageResultV2,
};
use er_kernel::snapshot::{InputRouterSnapshotV2, KernelSchedulerSnapshotV2};
use er_kernel::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7, StorageFrontierSnapshotV1};
use er_save::m9e_save_v2::GameSaveV2;
use er_state::m7_state::{DexState, ProfileStateV1, ProfileStatistics};
use er_types::battle_ids::{MenuInstanceId, WaveIndex};
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{GameActionV1, GameControlKindV2, GameMenuCancelV2, OperationId,
    PresentationEventId, SafeU53, SaveActionV1, SeatId};
use serde_json::{Value, json};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
fn safe(value: u64) -> Result<SafeU53> { Ok(SafeU53::new(value)?) }
fn scheduler() -> KernelSchedulerSnapshotV2 {
    KernelSchedulerSnapshotV2 { next_timer_id: Some(SafeU53::ZERO), timers: Vec::new(),
        pauses: Vec::new(), disposed: false }
}
fn input() -> InputRouterSnapshotV2 {
    InputRouterSnapshotV2 { focus: InputFocus::Game, pressed: Vec::new(),
        suppressed_printable_keys: Vec::new(), held_buttons: Vec::new(), locks: Vec::new(),
        repeats: Vec::new(), disposed: false }
}
fn press(kernel: &mut GameKernelV7, code: PhysicalKey) -> Result<()> {
    kernel.raw_input(RawInputEvent::KeyDown { code: code.clone(), printable: false,
        browser_repeat: false, focus: InputFocus::Game })?;
    kernel.raw_input(RawInputEvent::KeyUp { code })?;
    Ok(())
}
fn navigate(kernel: &mut GameKernelV7, target: &str) -> Result<()> {
    let bound = kernel.current_control().and_then(|control| control.menu.as_ref())
        .map(|menu| menu.options.len() + 1).ok_or("menu missing")?;
    for _ in 0..bound {
        if kernel.current_control().and_then(|control| control.menu.as_ref())
            .is_some_and(|menu| menu.selected_option_id.as_str() == target) { return Ok(()); }
        press(kernel, PhysicalKey::ArrowDown)?;
    }
    Err("natural starter confirmation was unreachable".into())
}
fn checked_snapshot(kernel: &GameKernelV7, content: Arc<PreparedGameContentV2>) -> Result<CoreGameKernelSnapshotV7> {
    let snapshot = kernel.snapshot()?;
    snapshot.validate(content.as_ref())?;
    let restored = GameKernelV7::from_snapshot(snapshot.clone(), SeatId::new(safe(1)?),
        GameKernelRoleV7::Authority, content)?;
    if restored.snapshot()? != snapshot { return Err("fixture snapshot round trip differs".into()); }
    Ok(snapshot)
}

fn controlled(natural: &GameKernelV7, action: SaveActionV1, name: &str,
    content: Arc<PreparedGameContentV2>) -> Result<GameKernelV7> {
    let reached = natural.snapshot()?;
    let mut state = natural.state().cloned().ok_or("natural active state missing")?;
    let seat = SeatId::new(safe(1)?);
    let revision = reached.material_ledger.next_authority_revision;
    let control = generic_vertical_control_v2(reached.next_menu_instance_id, revision,
        seat, OperationId::new(format!("m9e/storage/{name}"))?, GameControlKindV2::Save,
        &format!("m9e/storage/{name}"), &[(format!("storage/{name}"), GameActionV1::Save { action })],
        GameMenuCancelV2::Disabled)?;
    state.active_run.as_mut().ok_or("run missing")?.control = control;
    state.validate_with(content.as_ref())?;
    // This starts a NEW declared controlled boundary with an internally
    // consistent ledger. It does not mutate the natural snapshot's ledger.
    Ok(GameKernelV7::from_active(state, revision, seat, GameKernelRoleV7::Authority,
        content, input(), scheduler(), None)?)
}

fn normalized_read(pending: &CoreGameKernelSnapshotV7, save: &GameSaveV2) -> Result<CoreGameKernelSnapshotV7> {
    let GameKernelLifecycleSnapshotV7::Active(live) = &pending.lifecycle else { return Err("READ is not Active".into()); };
    let mut state = save.state.clone();
    state.identities.next_platform_request_id = state.identities.next_platform_request_id.max(live.identities.next_platform_request_id);
    let control = &mut state.active_run.as_mut().ok_or("saved run absent")?.control;
    let revision = pending.pending_presentations.iter().try_fold(
        pending.material_ledger.next_authority_revision.max(safe(control.revision.get() + 1)?),
        |floor, presentation| -> Result<SafeU53> { Ok(floor.max(safe(presentation.event_id.get().get() + 1)?)) })?;
    let menu = control.menu.as_mut().ok_or("saved menu absent")?;
    let instance = pending.next_menu_instance_id.max(MenuInstanceId::new(safe(menu.instance_id.get().get() + 1)?));
    menu.instance_id = instance;
    control.revision = revision;
    let context = control.action_context.as_mut().ok_or("saved action context absent")?;
    context.menu_instance = instance;
    context.authority_revision = revision;
    // Every saved action/selection/operation ID and unrelated gameplay field stays exact.
    let mut expected = pending.clone();
    expected.lifecycle = GameKernelLifecycleSnapshotV7::Active(state);
    expected.material_ledger = AppliedGameMaterialLedgerV1::new(revision)?;
    expected.next_menu_instance_id = MenuInstanceId::new(safe(instance.get().get() + 1)?);
    expected.private_battle_control = None;
    if !expected.input_router.repeats.is_empty() { return Err("controlled Space fixture unexpectedly owns repeats".into()); }
    expected.input_router.pressed.clear();
    expected.input_router.suppressed_printable_keys.clear();
    expected.input_router.held_buttons.clear();
    expected.input_router.locks.clear();
    expected.pending_platform.clear();
    expected.storage_frontiers = vec![StorageFrontierSnapshotV1 { slot: "controlled-slot".to_owned(), generation: save.generation }];
    expected.replay_sequence = safe(expected.replay_sequence.get() + 1)?;
    Ok(expected)
}

fn case(kernel: &mut GameKernelV7, save_bytes: Option<&[u8]>, expected_generation: u64, content: Arc<PreparedGameContentV2>) -> Result<(Value, Vec<u8>)> {
    let before = checked_snapshot(kernel, content.clone())?;
    let revision = before.material_ledger.next_authority_revision;
    let step = kernel.raw_input(RawInputEvent::KeyDown { code: PhysicalKey::Space,
        printable: false, browser_repeat: false, focus: InputFocus::Game })?;
    kernel.raw_input(RawInputEvent::KeyUp { code: PhysicalKey::Space })?;
    let pending = checked_snapshot(kernel, content.clone())?;
    let semantic = PresentationSemanticIdV1::Cue(PresentationCueFamilyV1::Save);
    let mapping = content.presentation(semantic).ok_or("Save mapping missing")?;
    let expected_presentation = GamePresentationEffectV2 { event_id: PresentationEventId::new(revision),
        semantic, blocking: mapping.blocking, skip: mapping.skip };
    let presentations: Vec<_> = step.effects.iter().filter_map(|effect| match effect {
        GameKernelEffectV7::Presentation(value) => Some(value.clone()), _ => None,
    }).collect();
    if presentations != vec![expected_presentation.clone()] || pending.pending_presentations.len() != 1 {
        return Err("controlled Save action did not produce the independently expected presentation".into());
    }
    let requests: Vec<_> = step.effects.iter().filter_map(|effect| match effect {
        GameKernelEffectV7::Platform(value) => Some(value.clone()), _ => None,
    }).collect();
    if requests.len() != 1 || pending.pending_platform.len() != 1 {
        return Err("controlled action did not produce exactly one pending platform owner".into());
    }
    let (id, bytes, result, wire) = match (&requests[0], save_bytes) {
        (GamePlatformEffectV2::StorageWrite { request, slot, generation, bytes }, None)
            if slot == "controlled-slot" && *generation == safe(expected_generation)? => {
            let save = GameSaveV2::decode(bytes)?;
            save.state.validate_with(content.as_ref())?;
            if save.content_identity != *content.identity() || bytes.len() > 4 * 1024 * 1024 {
                return Err("generated save content/size differs".into());
            }
            (*request, bytes.clone(), KernelStorageResultV2::Written,
                json!({"request_id": request, "kind": "WRITE", "slot": slot,
                    "generation": generation, "bytes": bytes}))
        }
        (GamePlatformEffectV2::StorageRead { request, slot }, Some(bytes)) if slot == "controlled-slot" => {
            (*request, bytes.to_vec(), KernelStorageResultV2::Read { bytes: Some(bytes.to_vec()) },
                json!({"request_id": request, "kind": "READ", "slot": slot, "generation": null, "bytes": []}))
        }
        _ => return Err("controlled fixture request kind differs".into()),
    };
    // Known rejected callbacks conserve every core field, including presentation.
    if kernel.apply_storage_result(id, KernelStorageResultV2::Deleted).is_ok()
        || kernel.snapshot()? != pending { return Err("wrong callback did not conserve the whole snapshot".into()); }
    kernel.apply_storage_result(id, result.clone())?;
    let callback = checked_snapshot(kernel, content.clone())?;
    if callback.pending_presentations != pending.pending_presentations
        || !callback.pending_platform.is_empty() || callback.storage_frontiers.len() != 1
        || callback.storage_frontiers[0].generation != safe(expected_generation)? {
        return Err("storage callback retired the wrong owner/frontier".into());
    }
    let expected = if let Some(bytes) = save_bytes { normalized_read(&pending, &GameSaveV2::decode(bytes)?)? }
        else {
            let mut expected = pending.clone();
            expected.pending_platform.clear();
            expected.storage_frontiers = vec![StorageFrontierSnapshotV1 { slot: "controlled-slot".to_owned(), generation: safe(expected_generation)? }];
            expected.replay_sequence = safe(expected.replay_sequence.get() + 1)?;
            expected
        };
    if callback != expected { return Err("callback changed fields outside exact owned normalization".into()); }
    if kernel.apply_storage_result(id, result).is_ok() || kernel.snapshot()? != callback {
        return Err("duplicate callback changed a completed owner".into());
    }
    kernel.settle_presentation(expected_presentation.event_id)?;
    let settled = checked_snapshot(kernel, content.clone())?;
    kernel.advance_time(safe(1)?)?;
    let continued = checked_snapshot(kernel, content)?;
    Ok((json!({"before": before, "pending": pending, "callback": callback,
        "settled": settled, "continued": continued, "request": wire,
        "presentation": expected_presentation}), bytes))
}

fn main() -> Result<()> {
    let out = std::env::args_os().nth(1).map(PathBuf::from).ok_or("output directory missing")?;
    fs::create_dir_all(&out)?;
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let bundle: GameContentBundleV2 = serde_json::from_slice(&fs::read(root.join("fixtures/m9/engineering/game-content-bundle-v2.json"))?)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
    let mut natural = GameKernelV7::natural_start(ProfileStateV1 { schema_version: 1,
        unlocks: Vec::new(), achievements: Vec::new(), challenges: Vec::new(), flags: Default::default(),
        dex: DexState::default(), statistics: ProfileStatistics { runs_started: SafeU53::ZERO,
            runs_won: SafeU53::ZERO, runs_lost: SafeU53::ZERO, battles_won: SafeU53::ZERO,
            pokemon_captured: SafeU53::ZERO, highest_wave: WaveIndex::new(safe(1)?)? } },
        "m9e-storage-controlled".to_owned(), SeatId::new(safe(1)?),
        vec!["controlled-slot".to_owned()], true, content.clone(), scheduler(), None)?;
    for _ in 0..3 { press(&mut natural, PhysicalKey::Space)?; }
    navigate(&mut natural, "bootstrap/starter/confirm")?;
    for _ in 0..4 { press(&mut natural, PhysicalKey::Space)?; }
    if natural.current_control().is_none_or(|control| control.kind != GameControlKindV2::BattleCommand) {
        return Err("natural setup did not reach BattleCommand".into());
    }
    for pending in natural.snapshot()?.pending_presentations {
        natural.settle_presentation(pending.event_id)?;
    }
    let natural_reached = checked_snapshot(&natural, content.clone())?;
    let mut write = controlled(&natural, SaveActionV1::Write { slot: "controlled-slot".to_owned() }, "write", content.clone())?;
    let mut load = controlled(&natural, SaveActionV1::Load { slot: "controlled-slot".to_owned() }, "load", content.clone())?;
    let (write_case, bytes) = case(&mut write, None, 1, content.clone())?;
    let (load_case, _) = case(&mut load, Some(&bytes), 1, content.clone())?;
    // Same live loaded core, with no synthetic control or allocator changes.
    let (rewrite_case, _) = case(&mut load, None, 2, content.clone())?;
    if rewrite_case["before"] != load_case["continued"]
        || rewrite_case["request"]["request_id"].as_u64() <= load_case["request"]["request_id"].as_u64()
        || rewrite_case["presentation"]["event_id"].as_u64() <= load_case["presentation"]["event_id"].as_u64() {
        return Err("post-load Write reused an old owner or lost exact continuation".into());
    }
    let fixture = json!({"schema_version": 2, "capability": "CURRENT_WORKER_CONTROLLED_SAVE",
        "fixture_kind": "CONTROLLED_SAVE_CHECKPOINT", "content_identity": content.identity(),
        "natural_reached": natural_reached, "write": write_case, "load": load_case, "rewrite": rewrite_case});
    let encoded = er_canonical::canonical_bytes(&fixture)?;
    if encoded.len() > 32 * 1024 * 1024 { return Err("storage fixture exceeds bound".into()); }
    fs::write(out.join("m9e-v7-storage-fixtures.json"), encoded)?;
    Ok(())
}
