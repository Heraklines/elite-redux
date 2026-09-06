//! Remote-only Title retirement reference. Only the producer is a controlled Save checkpoint.
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

fn natural(content: Arc<PreparedGameContentV2>) -> Result<GameKernelV7> {
    Ok(GameKernelV7::natural_start(ProfileStateV1 { schema_version: 1,
        unlocks: Vec::new(), achievements: Vec::new(), challenges: Vec::new(), flags: Default::default(),
        dex: DexState::default(), statistics: ProfileStatistics { runs_started: SafeU53::ZERO,
            runs_won: SafeU53::ZERO, runs_lost: SafeU53::ZERO, battles_won: SafeU53::ZERO,
            pokemon_captured: SafeU53::ZERO, highest_wave: WaveIndex::new(safe(1)?)? } },
        "m9e-title-storage-retirement".to_owned(), SeatId::new(safe(1)?),
        vec!["new-run-destination".to_owned()], true, content, scheduler(), None)?)
}
fn title_owner(snapshot: &CoreGameKernelSnapshotV7) -> Result<&er_game::m72_bootstrap::RunBootstrapMachineV1> {
    let GameKernelLifecycleSnapshotV7::Bootstrap(owner) = &snapshot.lifecycle else { return Err("Title Bootstrap absent".into()); };
    Ok(owner)
}
fn list_case(reader: &mut GameKernelV7, content: Arc<PreparedGameContentV2>) -> Result<(Value, er_types::PlatformRequestId)> {
    let before = checked_snapshot(reader, content.clone())?;
    navigate(reader, "bootstrap/title/existing-saves")?;
    let selected = checked_snapshot(reader, content.clone())?;
    let step = reader.raw_input(RawInputEvent::KeyDown { code: PhysicalKey::Space,
        printable: false, browser_repeat: false, focus: InputFocus::Game })?;
    reader.raw_input(RawInputEvent::KeyUp { code: PhysicalKey::Space })?;
    let pending = checked_snapshot(reader, content)?;
    let [GameKernelEffectV7::UiChanged(_), GameKernelEffectV7::Platform(GamePlatformEffectV2::StorageList { request })] = step.effects.as_slice() else {
        return Err("Title did not emit exactly UI and actual LIST".into());
    };
    Ok((json!({"before": before, "selected": selected, "pending": pending, "request_id": request}), *request))
}
fn cancelled(reader: &mut GameKernelV7, request: er_types::PlatformRequestId,
    content: Arc<PreparedGameContentV2>) -> Result<CoreGameKernelSnapshotV7> {
    let pending = checked_snapshot(reader, content.clone())?;
    reader.raw_input(RawInputEvent::KeyDown { code: PhysicalKey::Escape,
        printable: false, browser_repeat: false, focus: InputFocus::Game })?;
    let held = checked_snapshot(reader, content.clone())?;
    reader.raw_input(RawInputEvent::KeyUp { code: PhysicalKey::Escape })?;
    let after = checked_snapshot(reader, content)?;
    // The owned Cancel rail ends after KeyDown. Its later KeyUp is another
    // accepted core change, which may retire only the physical pressed key.
    let mut released = held.clone();
    let GameKernelLifecycleSnapshotV7::Bootstrap(released_owner) = &mut released.lifecycle else {
        return Err("Cancel release lost its Title bootstrap".into());
    };
    if released_owner.pressed_keys.len() != 1 || !released_owner.pressed_keys.contains(&PhysicalKey::Escape) {
        return Err("accepted Cancel did not retain its physical Escape key".into());
    }
    released_owner.pressed_keys.clear();
    released.replay_sequence = safe(held.replay_sequence.get() + 1)?;
    if held.replay_sequence != safe(pending.replay_sequence.get() + 1)? || after != released {
        return Err("Cancel key release changed unrelated state or lost a causal replay step".into());
    }
    let before_owner = title_owner(&pending)?;
    let after_owner = title_owner(&after)?;
    let storage = before_owner.current_storage.as_ref().ok_or("pending Title extension absent")?;
    let next = after_owner.current_storage.as_ref().ok_or("cancelled Title extension absent")?;
    if after_owner.stage != er_game::m72_bootstrap::RunBootstrapStageV1::Title
        || next.pending.is_some() || !next.slots.is_empty() || next.missing_slot.is_some()
        || next.next_platform_request_id != storage.next_platform_request_id
        || after_owner.control.revision != safe(before_owner.control.revision.get() + 1)?
        || after_owner.menu_instance_high_water.get().get() != before_owner.menu_instance_high_water.get().get() + 1
        || after.replay_sequence != safe(pending.replay_sequence.get() + 2)? || !after.pending_platform.is_empty() {
        return Err("Cancel did not conserve highwater and retire only its owner".into());
    }
    let mut unrelated = pending.clone();
    unrelated.lifecycle = after.lifecycle.clone();
    unrelated.next_menu_instance_id = after.next_menu_instance_id;
    unrelated.pending_platform.clear();
    unrelated.replay_sequence = after.replay_sequence;
    if after != unrelated { return Err("Title Cancel changed unrelated core fields".into()); }
    for result in [KernelStorageResultV2::Slots { slots: vec!["controlled-slot".to_owned()] },
        KernelStorageResultV2::Read { bytes: None }] {
        if reader.apply_storage_result(request, result).is_ok() || reader.snapshot()? != after {
            return Err("late cancelled callback changed whole snapshot".into());
        }
    }
    Ok(after)
}
fn accept_list(reader: &mut GameKernelV7, request: er_types::PlatformRequestId,
    content: Arc<PreparedGameContentV2>) -> Result<CoreGameKernelSnapshotV7> {
    reader.apply_storage_result(request, KernelStorageResultV2::Slots { slots: vec!["controlled-slot".to_owned()] })?;
    let selected = checked_snapshot(reader, content)?;
    let owner = title_owner(&selected)?;
    if owner.current_storage.as_ref().ok_or("inventory owner absent")?.slots != vec!["controlled-slot"]
        || owner.catalog.save_slots != vec!["new-run-destination"] {
        return Err("actual inventory mixed with new-run destinations".into());
    }
    Ok(selected)
}
fn read_case(reader: &mut GameKernelV7, content: Arc<PreparedGameContentV2>) -> Result<(CoreGameKernelSnapshotV7, er_types::PlatformRequestId)> {
    let step = reader.raw_input(RawInputEvent::KeyDown { code: PhysicalKey::Space,
        printable: false, browser_repeat: false, focus: InputFocus::Game })?;
    reader.raw_input(RawInputEvent::KeyUp { code: PhysicalKey::Space })?;
    let [GameKernelEffectV7::UiChanged(_), GameKernelEffectV7::Platform(GamePlatformEffectV2::StorageRead { request, slot })] = step.effects.as_slice() else {
        return Err("actual selected slot did not emit exactly UI and READ".into());
    };
    if slot != "controlled-slot" { return Err("READ selected a destination absent from inventory".into()); }
    Ok((checked_snapshot(reader, content)?, *request))
}
fn normalized_title_read(pending: &CoreGameKernelSnapshotV7, save: &GameSaveV2) -> Result<CoreGameKernelSnapshotV7> {
    let owner = title_owner(pending)?;
    let mut state = save.state.clone();
    state.identities.next_platform_request_id = state.identities.next_platform_request_id.max(
        owner.current_storage.as_ref().ok_or("Title extension absent")?.next_platform_request_id);
    let control = &mut state.active_run.as_mut().ok_or("saved run absent")?.control;
    let revision = safe(owner.control.revision.get().max(control.revision.get()) + 1)?;
    let menu = control.menu.as_mut().ok_or("saved public menu absent")?;
    let instance = pending.next_menu_instance_id.max(MenuInstanceId::new(safe(menu.instance_id.get().get() + 1)?));
    menu.instance_id = instance;
    control.revision = revision;
    let context = control.action_context.as_mut().ok_or("saved context absent")?;
    context.authority_revision = revision;
    context.menu_instance = instance;
    let mut expected = pending.clone();
    expected.lifecycle = GameKernelLifecycleSnapshotV7::Active(state);
    expected.material_ledger = AppliedGameMaterialLedgerV1::new(revision)?;
    expected.next_menu_instance_id = MenuInstanceId::new(safe(instance.get().get() + 1)?);
    expected.pending_platform.clear();
    expected.storage_frontiers = vec![StorageFrontierSnapshotV1 { slot: "controlled-slot".to_owned(), generation: save.generation }];
    expected.replay_sequence = safe(pending.replay_sequence.get() + 1)?;
    Ok(expected)
}
fn main() -> Result<()> {
    let out = std::env::args_os().nth(1).map(PathBuf::from).ok_or("output directory missing")?;
    fs::create_dir_all(&out)?;
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let bundle: GameContentBundleV2 = serde_json::from_slice(&fs::read(root.join("fixtures/m9/engineering/game-content-bundle-v2.json"))?)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
    let mut reached = natural(content.clone())?;
    for _ in 0..3 { press(&mut reached, PhysicalKey::Space)?; }
    navigate(&mut reached, "bootstrap/starter/confirm")?;
    for _ in 0..4 { press(&mut reached, PhysicalKey::Space)?; }
    if reached.current_control().is_none_or(|control| control.kind != GameControlKindV2::BattleCommand) {
        return Err("natural producer did not reach BattleCommand".into());
    }
    for pending in reached.snapshot()?.pending_presentations { reached.settle_presentation(pending.event_id)?; }
    let natural_reached = checked_snapshot(&reached, content.clone())?;
    let mut writer = controlled(&reached, SaveActionV1::Write { slot: "controlled-slot".to_owned() }, "write", content.clone())?;
    let (write, bytes) = case(&mut writer, None, 1, content.clone())?;
    let saved = GameSaveV2::decode(&bytes)?;
    let mut reader = natural(content.clone())?;
    reader.enable_current_title_storage()?;
    let initial = checked_snapshot(&reader, content.clone())?;
    let mut cycles = Vec::new();
    for index in 0..21 {
        let (mut reference, request) = list_case(&mut reader, content.clone())?;
        reference["mode"] = json!(if index == 1 { "QUEUED_NOT_STARTED" } else { "ACTIVE_TRANSACTION" });
        reference["cancelled"] = serde_json::to_value(cancelled(&mut reader, request, content.clone())?)?;
        cycles.push(reference);
    }
    let mut read_cancels = Vec::new();
    for mode in ["ACTIVE_TRANSACTION", "CALLBACK_READY"] {
        let (listing, list_request) = list_case(&mut reader, content.clone())?;
        let selected = accept_list(&mut reader, list_request, content.clone())?;
        let (pending, request) = read_case(&mut reader, content.clone())?;
        let cancelled = cancelled(&mut reader, request, content.clone())?;
        read_cancels.push(json!({"mode": mode, "listing": listing, "selected": selected,
            "pending": pending, "request_id": request, "cancelled": cancelled}));
    }
    let (listing, list_request) = list_case(&mut reader, content.clone())?;
    let selected = accept_list(&mut reader, list_request, content.clone())?;
    let (pending, request) = read_case(&mut reader, content.clone())?;
    if saved.state.identities.next_platform_request_id >= title_owner(&pending)?.current_storage.as_ref()
        .ok_or("Title owner absent")?.next_platform_request_id {
        return Err("cancel sequence did not demonstrate live platform highwater beyond saved state".into());
    }
    let expected = normalized_title_read(&pending, &saved)?;
    reader.apply_storage_result(request, KernelStorageResultV2::Read { bytes: Some(bytes.clone()) })?;
    let loaded = checked_snapshot(&reader, content.clone())?;
    if loaded != expected { return Err("Title READ changed fields outside exact saved-state normalization".into()); }
    if reader.apply_storage_result(request, KernelStorageResultV2::Read { bytes: Some(bytes) }).is_ok()
        || reader.snapshot()? != loaded { return Err("duplicate Title READ changed full snapshot".into()); }
    let (rewrite, _) = case(&mut reader, None, 2, content)?;
    if rewrite["before"] != serde_json::to_value(&loaded)?
        || rewrite["request"]["request_id"].as_u64() <= Some(request.get().get()) {
        return Err("raw post-Title Write did not continue same core above READ highwater".into());
    }
    let fixture = json!({"schema_version": 1, "capability": "CURRENT_WORKER_TITLE_STORAGE_RETIREMENT",
        "fixture_kind": "NATURAL_TITLE_CONTROLLED_SAVE_PRODUCER", "content_identity": saved.content_identity,
        "natural_reached": natural_reached, "write": write, "initial": initial,
        "cycles": cycles, "read_cancels": read_cancels, "load": {"listing": listing, "selected": selected,
            "pending": pending, "request_id": request, "loaded": loaded}, "rewrite": rewrite});
    let encoded = er_canonical::canonical_bytes(&fixture)?;
    if encoded.len() > 32 * 1024 * 1024 { return Err("Title reference exceeds existing fixture bound".into()); }
    fs::write(out.join("m9e-v7-title-storage-fixtures.json"), encoded)?;
    Ok(())
}
