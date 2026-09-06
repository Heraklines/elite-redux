//! Opt-in Title core witnesses. No browser storage adapter or cancellation-drain claim.
use er_game::m7_progression_control::generic_vertical_control_v2;
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_material_v6::{AppliedGameMaterialLedgerV1, GamePlatformEffectV2};
use er_game::m72_bootstrap::{BootstrapStorageKindV1, RunBootstrapMachineV1, RunBootstrapStageV1};
use er_kernel::game_kernel_v7::{
    GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7, GameKernelV7, KernelStorageResultV2,
};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::{
    CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7, StorageFrontierSnapshotV1,
};
use er_save::m9e_save_v2::GameSaveV2;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::{MenuInstanceId, WaveIndex};
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{
    BootstrapActionV1, GameActionV1, GameControlKindV2, GameMenuCancelV2, OperationId,
    PlatformRequestId, SafeU53, SaveActionV1, SeatId,
};
use std::error::Error;
use std::sync::Arc;
const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value is safe")
}

fn profile() -> Result<ProfileStateV1, Box<dyn Error>> {
    Ok(ProfileStateV1 {
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
            highest_wave: WaveIndex::new(safe(1))?,
        },
        dex: DexState::default(),
    })
}

fn content() -> Result<Arc<PreparedGameContentV2>, Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    Ok(Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?))
}

fn scheduler() -> KernelSchedulerSnapshotV2 {
    KernelSchedulerSnapshotV2 {
        next_timer_id: Some(SafeU53::ZERO),
        timers: Vec::new(),
        pauses: Vec::new(),
        disposed: false,
    }
}

fn kernel(content: Arc<PreparedGameContentV2>) -> Result<GameKernelV7, Box<dyn Error>> {
    Ok(GameKernelV7::natural_start(
        profile()?,
        "kernel-v7-natural".to_owned(),
        SeatId::new(safe(1)),
        vec!["preview-slot".to_owned()],
        true,
        content,
        scheduler(),
        None,
    )?)
}

fn key_down(key: PhysicalKey) -> RawInputEvent {
    RawInputEvent::KeyDown {
        code: key,
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    }
}

fn press(kernel: &mut GameKernelV7, key: PhysicalKey) -> Result<GameKernelStepV7, Box<dyn Error>> {
    let step = kernel.raw_input(key_down(key.clone()))?;
    kernel.raw_input(RawInputEvent::KeyUp { code: key })?;
    Ok(step)
}

fn navigate_down_to(kernel: &mut GameKernelV7, option: &str) -> Result<(), Box<dyn Error>> {
    let bound = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .map(|menu| menu.options.len() + 1)
        .ok_or("current control has no menu")?;
    for _ in 0..bound {
        let selected = kernel
            .current_control()
            .and_then(|control| control.menu.as_ref())
            .map(|menu| menu.selected_option_id.as_str() == option)
            .unwrap_or(false);
        if selected {
            return Ok(());
        }
        press(kernel, PhysicalKey::ArrowDown)?;
    }
    Err(format!("option {option} was not reachable by Down").into())
}

fn complete_natural_start(kernel: &mut GameKernelV7) -> Result<(), Box<dyn Error>> {
    press(kernel, PhysicalKey::Space)?;
    press(kernel, PhysicalKey::Space)?;
    press(kernel, PhysicalKey::Space)?;
    navigate_down_to(kernel, "bootstrap/starter/confirm")?;
    press(kernel, PhysicalKey::Space)?;
    press(kernel, PhysicalKey::Space)?;
    press(kernel, PhysicalKey::Space)?;
    press(kernel, PhysicalKey::Space)?;
    Ok(())
}

fn controlled_read_save_menu(
    natural: &CoreGameKernelSnapshotV7,
    content: Arc<PreparedGameContentV2>,
    action: SaveActionV1,
    menu: u64,
    revision: u64,
    platform: u64,
) -> Result<GameKernelV7, Box<dyn Error>> {
    let GameKernelLifecycleSnapshotV7::Active(mut state) = natural.lifecycle.clone() else {
        return Err("natural source is not active".into());
    };
    state.identities.next_platform_request_id = state
        .identities
        .next_platform_request_id
        .max(safe(platform));
    state
        .active_run
        .as_mut()
        .ok_or("natural run absent")?
        .control = generic_vertical_control_v2(
        MenuInstanceId::new(safe(menu)),
        safe(revision),
        SeatId::new(safe(1)),
        OperationId::new(format!("read-rebind/controlled/{menu}"))?,
        GameControlKindV2::Save,
        "read-rebind/controlled-save",
        &[
            ("save/action".to_owned(), GameActionV1::Save { action }),
            (
                "save/cancel".to_owned(),
                GameActionV1::Save {
                    action: SaveActionV1::Cancel,
                },
            ),
        ],
        GameMenuCancelV2::Back {
            action: Box::new(GameActionV1::Save {
                action: SaveActionV1::Cancel,
            }),
        },
    )?;
    // Fresh, explicitly controlled Save boundary; never rewrite the natural ledger.
    Ok(GameKernelV7::from_active(
        state,
        safe(revision),
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content,
        natural.input_router.clone(),
        natural.scheduler.clone(),
        None,
    )?)
}

fn title(content: Arc<PreparedGameContentV2>) -> Result<GameKernelV7, Box<dyn Error>> {
    let mut kernel = kernel(content)?;
    kernel.enable_current_title_storage()?;
    Ok(kernel)
}
fn restore(
    snapshot: CoreGameKernelSnapshotV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<GameKernelV7, Box<dyn Error>> {
    Ok(GameKernelV7::from_snapshot(
        serde_json::from_slice(&serde_json::to_vec(&snapshot)?)?,
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content,
    )?)
}
fn bootstrap(
    snapshot: &CoreGameKernelSnapshotV7,
) -> Result<&RunBootstrapMachineV1, Box<dyn Error>> {
    let GameKernelLifecycleSnapshotV7::Bootstrap(value) = &snapshot.lifecycle else {
        return Err("expected Bootstrap".into());
    };
    Ok(value)
}
fn bootstrap_mut(
    snapshot: &mut CoreGameKernelSnapshotV7,
) -> Result<&mut RunBootstrapMachineV1, Box<dyn Error>> {
    let GameKernelLifecycleSnapshotV7::Bootstrap(value) = &mut snapshot.lifecycle else {
        return Err("expected Bootstrap".into());
    };
    Ok(value)
}
fn list(kernel: &mut GameKernelV7) -> Result<PlatformRequestId, Box<dyn Error>> {
    navigate_down_to(kernel, "bootstrap/title/existing-saves")?;
    let step = press(kernel, PhysicalKey::Space)?;
    assert_eq!(step.effects.len(), 2);
    let GameKernelEffectV7::Platform(GamePlatformEffectV2::StorageList { request }) =
        step.effects[1]
    else {
        return Err("Title did not emit actual LIST".into());
    };
    Ok(request)
}
fn read(kernel: &mut GameKernelV7, slot: &str) -> Result<PlatformRequestId, Box<dyn Error>> {
    let step = kernel.raw_input(key_down(PhysicalKey::Space))?;
    let GameKernelEffectV7::Platform(GamePlatformEffectV2::StorageRead {
        request,
        slot: actual,
    }) = &step.effects[1]
    else {
        return Err("inventory did not emit actual READ".into());
    };
    assert_eq!(actual, slot);
    Ok(*request)
}
fn saved_write(content: Arc<PreparedGameContentV2>) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut natural = kernel(content.clone())?;
    complete_natural_start(&mut natural)?;
    for pending in natural.snapshot()?.pending_presentations {
        natural.settle_presentation(pending.event_id)?;
    }
    // Only this writer is a controlled Save checkpoint, after actual natural bootstrap.
    // The reader always starts at real Title; this does not claim natural Save reachability.
    let mut writer = controlled_read_save_menu(
        &natural.snapshot()?,
        content,
        SaveActionV1::Write {
            slot: "actual-slot".to_owned(),
        },
        30,
        10,
        40,
    )?;
    press(&mut writer, PhysicalKey::Space)?
        .effects
        .into_iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::Platform(GamePlatformEffectV2::StorageWrite {
                bytes,
                generation,
                ..
            }) => {
                assert_eq!(generation, safe(1));
                Some(bytes)
            }
            _ => None,
        })
        .ok_or_else(|| "controlled actual Write absent".into())
}

#[test]
fn title_list_read_normalizes_exact_saved_state_and_raw_write_generation_two()
-> Result<(), Box<dyn Error>> {
    let content = content()?;
    let bytes = saved_write(content.clone())?;
    let saved = GameSaveV2::decode(&bytes)?;
    for floor in [1, 90] {
        let mut initial = title(content.clone())?.snapshot()?;
        bootstrap_mut(&mut initial)?
            .current_storage
            .as_mut()
            .ok_or("owner absent")?
            .next_platform_request_id = safe(floor);
        let mut reader = restore(initial, content.clone())?;
        let list_request = list(&mut reader)?;
        let listing = reader.snapshot()?;
        let mut clone = restore(listing, content.clone())?;
        let outcome = KernelStorageResultV2::Slots {
            slots: vec!["actual-slot".to_owned()],
        };
        assert_eq!(
            reader.apply_storage_result(list_request, outcome.clone())?,
            clone.apply_storage_result(list_request, outcome)?
        );
        assert_eq!(reader.snapshot()?, clone.snapshot()?);
        let request = read(&mut reader, "actual-slot")?;
        let before = reader.snapshot()?;
        let mut clone = restore(before.clone(), content.clone())?;
        let outcome = KernelStorageResultV2::Read {
            bytes: Some(bytes.clone()),
        };
        assert_eq!(
            reader.apply_storage_result(request, outcome.clone())?,
            clone.apply_storage_result(request, outcome)?
        );
        let loaded = reader.snapshot()?;
        assert_eq!(loaded, clone.snapshot()?);
        let storage = bootstrap(&before)?
            .current_storage
            .as_ref()
            .ok_or("owner absent")?;
        if floor == 1 {
            assert!(
                saved.state.identities.next_platform_request_id > storage.next_platform_request_id
            );
        } else {
            assert!(
                saved.state.identities.next_platform_request_id < storage.next_platform_request_id
            );
        }
        let mut state = saved.state.clone();
        state.identities.next_platform_request_id = state
            .identities
            .next_platform_request_id
            .max(storage.next_platform_request_id);
        let control = &mut state.active_run.as_mut().ok_or("saved run absent")?.control;
        let revision = safe(
            bootstrap(&before)?
                .control
                .revision
                .get()
                .max(control.revision.get())
                + 1,
        );
        let instance = before.next_menu_instance_id.max(MenuInstanceId::new(safe(
            control
                .menu
                .as_ref()
                .ok_or("saved menu absent")?
                .instance_id
                .get()
                .get()
                + 1,
        )));
        control.revision = revision;
        control
            .menu
            .as_mut()
            .ok_or("saved menu absent")?
            .instance_id = instance;
        let context = control.action_context.as_mut().ok_or("context absent")?;
        context.authority_revision = revision;
        context.menu_instance = instance;
        let mut expected = before.clone();
        expected.lifecycle = GameKernelLifecycleSnapshotV7::Active(state);
        expected.next_menu_instance_id = MenuInstanceId::new(safe(instance.get().get() + 1));
        expected.material_ledger = AppliedGameMaterialLedgerV1::new(revision)?;
        expected.pending_platform.clear();
        expected.storage_frontiers = vec![StorageFrontierSnapshotV1 {
            slot: "actual-slot".to_owned(),
            generation: safe(1),
        }];
        expected.replay_sequence = safe(before.replay_sequence.get() + 1);
        assert_eq!(
            loaded, expected,
            "all saved gameplay and unrelated owners stay exact"
        );
        reader.raw_input(RawInputEvent::KeyUp {
            code: PhysicalKey::Space,
        })?;
        clone.raw_input(RawInputEvent::KeyUp {
            code: PhysicalKey::Space,
        })?;
        assert_eq!(
            reader.snapshot()?,
            loaded,
            "held Title submit cannot bleed into loaded control"
        );
        let step = press(&mut reader, PhysicalKey::Space)?;
        assert_eq!(step, press(&mut clone, PhysicalKey::Space)?);
        assert_eq!(reader.snapshot()?, clone.snapshot()?);
        let (next, bytes) = step
            .effects
            .iter()
            .find_map(|effect| match effect {
                GameKernelEffectV7::Platform(GamePlatformEffectV2::StorageWrite {
                    request,
                    slot,
                    generation,
                    bytes,
                }) => {
                    assert_eq!(slot, "actual-slot");
                    assert_eq!(*generation, safe(2));
                    Some((*request, bytes))
                }
                _ => None,
            })
            .ok_or("real post-load Write absent")?;
        assert!(next > request);
        let written = GameSaveV2::decode(bytes)?;
        let mut expected_write = saved.state.clone();
        let GameKernelLifecycleSnapshotV7::Active(loaded_state) = &loaded.lifecycle else {
            return Err("not active".into());
        };
        expected_write
            .active_run
            .as_mut()
            .ok_or("run absent")?
            .control = loaded_state
            .active_run
            .as_ref()
            .ok_or("run absent")?
            .control
            .clone();
        expected_write.identities.next_platform_request_id = safe(next.get().get() + 1);
        assert_eq!(written.state, expected_write);
        assert_eq!(written.generation, safe(2));
        assert_eq!(
            reader.apply_storage_result(next, KernelStorageResultV2::Written)?,
            clone.apply_storage_result(next, KernelStorageResultV2::Written)?
        );
        assert_eq!(reader.snapshot()?, clone.snapshot()?);
        assert_eq!(reader.snapshot()?.storage_frontiers[0].generation, safe(2));
        let settled = reader.snapshot()?;
        assert!(
            reader
                .apply_storage_result(
                    request,
                    KernelStorageResultV2::Read {
                        bytes: Some(bytes.clone())
                    }
                )
                .is_err()
        );
        assert_eq!(reader.snapshot()?, settled);
    }
    Ok(())
}

#[test]
fn title_inventory_is_bounded_actual_and_missing_read_returns_selection()
-> Result<(), Box<dyn Error>> {
    let content = content()?;
    let mut reader = title(content.clone())?;
    let request = list(&mut reader)?;
    let pending = reader.snapshot()?;
    let invalid = [
        vec![String::new()],
        vec!["b".to_owned(), "a".to_owned()],
        vec!["a".to_owned(), "a".to_owned()],
        vec!["é".repeat(129)],
        (0..65).map(|index| format!("{index:04}")).collect(),
    ];
    for slots in invalid {
        assert!(
            reader
                .apply_storage_result(request, KernelStorageResultV2::Slots { slots })
                .is_err()
        );
        assert_eq!(reader.snapshot()?, pending);
    }
    assert!(
        reader
            .apply_storage_result(request, KernelStorageResultV2::Read { bytes: None })
            .is_err()
    );
    assert_eq!(reader.snapshot()?, pending);
    assert!(reader.settle_platform_request(request).is_err());
    assert_eq!(reader.snapshot()?, pending);
    reader.apply_storage_result(
        request,
        KernelStorageResultV2::Slots {
            slots: vec!["actual-slot".to_owned(), "é".repeat(128)],
        },
    )?;
    let selected = reader.snapshot()?;
    assert_eq!(
        bootstrap(&selected)?.catalog.save_slots,
        vec!["preview-slot"]
    );
    assert!(
        !bootstrap(&selected)?
            .current_storage
            .as_ref()
            .ok_or("owner absent")?
            .slots
            .contains(&"preview-slot".to_owned())
    );
    let request = read(&mut reader, "actual-slot")?;
    reader.apply_storage_result(request, KernelStorageResultV2::Read { bytes: None })?;
    let missing = reader.snapshot()?;
    assert_eq!(
        bootstrap(&missing)?.stage,
        RunBootstrapStageV1::ExistingSaveSelect
    );
    let owner = bootstrap(&missing)?
        .current_storage
        .as_ref()
        .ok_or("owner absent")?;
    assert_eq!(owner.slots, vec!["é".repeat(128)]);
    assert_eq!(owner.missing_slot.as_deref(), Some("actual-slot"));
    assert!(missing.pending_platform.is_empty());
    assert_eq!(restore(missing.clone(), content)?.snapshot()?, missing);
    reader.raw_input(RawInputEvent::KeyUp {
        code: PhysicalKey::Space,
    })?;
    press(&mut reader, PhysicalKey::Escape)?;
    let request = list(&mut reader)?;
    reader.apply_storage_result(request, KernelStorageResultV2::Slots { slots: vec![] })?;
    let empty = reader.snapshot()?;
    let menu = bootstrap(&empty)?
        .control
        .menu
        .as_ref()
        .ok_or("empty inventory menu absent")?;
    assert_eq!(menu.options.len(), 1);
    assert_eq!(
        menu.selected_action(),
        Some(&GameActionV1::Bootstrap {
            action: BootstrapActionV1::Cancel
        })
    );
    press(&mut reader, PhysicalKey::Space)?;
    assert_eq!(
        bootstrap(&reader.snapshot()?)?.stage,
        RunBootstrapStageV1::Title
    );
    Ok(())
}

#[test]
fn title_cancel_retires_core_owner_without_reusing_ids_and_new_game_carries_floor()
-> Result<(), Box<dyn Error>> {
    let content = content()?;
    let mut reader = title(content.clone())?;
    let mut retired = Vec::new();
    for index in 0..20 {
        let request = list(&mut reader)?;
        retired.push(request);
        if index % 2 == 0 {
            reader.apply_storage_result(
                request,
                KernelStorageResultV2::Slots {
                    slots: vec!["actual-slot".to_owned()],
                },
            )?;
            retired.push(read(&mut reader, "actual-slot")?);
            reader.raw_input(RawInputEvent::KeyUp {
                code: PhysicalKey::Space,
            })?;
        }
        press(&mut reader, PhysicalKey::Escape)?;
        let cancelled = reader.snapshot()?;
        assert_eq!(bootstrap(&cancelled)?.stage, RunBootstrapStageV1::Title);
        assert!(cancelled.pending_platform.is_empty());
        for request in &retired {
            for result in [
                KernelStorageResultV2::Slots { slots: vec![] },
                KernelStorageResultV2::Read { bytes: None },
            ] {
                assert!(reader.apply_storage_result(*request, result).is_err());
                assert_eq!(reader.snapshot()?, cancelled);
            }
        }
        reader = restore(cancelled, content.clone())?;
    }
    assert!(retired.windows(2).all(|pair| pair[0] < pair[1]));
    let before = reader.snapshot()?;
    let floor = bootstrap(&before)?
        .current_storage
        .as_ref()
        .ok_or("owner absent")?
        .next_platform_request_id;
    complete_natural_start(&mut reader)?;
    let after = reader.snapshot()?;
    let state = reader.state().ok_or("NewGame inactive")?;
    assert!(state.identities.next_platform_request_id >= floor);
    assert!(
        !after.material_ledger.records.is_empty(),
        "real bootstrap material owns the carried floor"
    );
    assert_eq!(restore(after.clone(), content)?.snapshot()?, after);
    Ok(())
}

#[test]
fn title_default_bytes_strict_extension_and_overflow_are_atomic() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let old = kernel(content.clone())?.snapshot()?;
    let value = serde_json::to_value(&old)?;
    assert!(value["lifecycle"]["value"].get("current_storage").is_none());
    let mut old_bootstrap = bootstrap(&old)?.clone();
    assert!(
        old_bootstrap
            .apply_game_action(GameActionV1::Bootstrap {
                action: BootstrapActionV1::OpenExistingSaves
            })
            .is_err()
    );
    assert_eq!(old_bootstrap, *bootstrap(&old)?);
    let mut reader = title(content.clone())?;
    let initial = reader.snapshot()?;
    assert!(reader.enable_current_title_storage().is_err());
    assert_eq!(reader.snapshot()?, initial);
    let mut unknown = serde_json::to_value(&initial)?;
    unknown["lifecycle"]["value"]["current_storage"]["unrecognized"] = serde_json::json!(true);
    assert!(serde_json::from_value::<CoreGameKernelSnapshotV7>(unknown).is_err());
    let mut forged = initial.clone();
    let new_game = bootstrap_mut(&mut forged)?
        .control
        .menu
        .as_mut()
        .ok_or("menu absent")?
        .options
        .iter_mut()
        .find(|option| option.option_id.as_str() == "bootstrap/title/new-game")
        .ok_or("New Game option absent")?;
    assert_eq!(
        new_game.action,
        GameActionV1::Bootstrap {
            action: BootstrapActionV1::OpenNewGame,
        }
    );
    new_game.action = GameActionV1::Bootstrap {
        action: BootstrapActionV1::OpenExistingSaves,
    };
    assert_ne!(
        forged, initial,
        "negative witness must change the actual snapshot"
    );
    assert!(restore(forged, content.clone()).is_err());
    navigate_down_to(&mut reader, "bootstrap/title/existing-saves")?;
    for field in ["platform", "replay"] {
        let mut boundary = reader.snapshot()?;
        if field == "platform" {
            bootstrap_mut(&mut boundary)?
                .current_storage
                .as_mut()
                .ok_or("owner absent")?
                .next_platform_request_id = safe(9_007_199_254_740_991);
        } else {
            boundary.replay_sequence = safe(9_007_199_254_740_991);
        }
        let mut exhausted = restore(boundary.clone(), content.clone())?;
        assert!(exhausted.raw_input(key_down(PhysicalKey::Space)).is_err());
        assert_eq!(exhausted.snapshot()?, boundary);
    }
    let request = list(&mut reader)?;
    let pending = reader.snapshot()?;
    let mut forged = pending.clone();
    bootstrap_mut(&mut forged)?
        .current_storage
        .as_mut()
        .ok_or("owner absent")?
        .pending
        .as_mut()
        .ok_or("pending absent")?
        .kind = BootstrapStorageKindV1::Read {
        slot: "preview-slot".to_owned(),
    };
    assert!(restore(forged, content.clone()).is_err());
    for field in [
        "stage", "owner", "platform", "ledger", "frontier", "unpaired",
    ] {
        let mut forged = pending.clone();
        match field {
            "stage" => bootstrap_mut(&mut forged)?.stage = RunBootstrapStageV1::ExistingSaveSelect,
            "owner" => {
                bootstrap_mut(&mut forged)?
                    .current_storage
                    .as_mut()
                    .ok_or("owner absent")?
                    .owner_seat = SeatId::new(safe(2))
            }
            "platform" => {
                forged.pending_platform[0].effect = GamePlatformEffectV2::StorageRead {
                    request,
                    slot: "actual-slot".to_owned(),
                }
            }
            "ledger" => forged.material_ledger = AppliedGameMaterialLedgerV1::new(safe(2))?,
            "frontier" => forged.storage_frontiers.push(StorageFrontierSnapshotV1 {
                slot: "foreign".to_owned(),
                generation: safe(1),
            }),
            _ => forged.pending_platform.clear(),
        }
        assert!(restore(forged, content.clone()).is_err(), "forged {field}");
    }
    let mut exhausted = pending;
    exhausted.replay_sequence = safe(9_007_199_254_740_991);
    let mut reader = restore(exhausted.clone(), content)?;
    assert!(
        reader
            .apply_storage_result(request, KernelStorageResultV2::Slots { slots: vec![] })
            .is_err()
    );
    assert_eq!(reader.snapshot()?, exhausted);
    assert!(reader.raw_input(key_down(PhysicalKey::Escape)).is_err());
    assert_eq!(reader.snapshot()?, exhausted);
    Ok(())
}
#[test]
fn title_read_rejects_corrupt_nonlocal_private_and_inactive_saves_atomically()
-> Result<(), Box<dyn Error>> {
    let content = content()?;
    let bytes = saved_write(content.clone())?;
    let saved = GameSaveV2::decode(&bytes)?;
    let mut reader = title(content.clone())?;
    let request = list(&mut reader)?;
    reader.apply_storage_result(
        request,
        KernelStorageResultV2::Slots {
            slots: vec!["actual-slot".to_owned()],
        },
    )?;
    let request = read(&mut reader, "actual-slot")?;
    let before = reader.snapshot()?;
    let mut inactive = saved.state.clone();
    inactive.active_run = None;
    let mut nonlocal = saved.state.clone();
    let control = &mut nonlocal.active_run.as_mut().ok_or("run absent")?.control;
    control.owner_seat = Some(SeatId::new(safe(2)));
    control.menu.as_mut().ok_or("menu absent")?.owner_seat = SeatId::new(safe(2));
    control
        .action_context
        .as_mut()
        .ok_or("context absent")?
        .authority_seat = SeatId::new(safe(2));
    let mut cooperative = saved.state.clone();
    cooperative.active_run.as_mut().ok_or("run absent")?.mode =
        bootstrap(&title(content.clone())?.snapshot()?)?
            .catalog
            .modes
            .iter()
            .find(|mode| mode.cooperative)
            .ok_or("cooperative policy absent")?
            .mode;
    let mut wrong_content = saved.state.clone();
    wrong_content.content_identity.oracle_sha =
        er_types::OracleSha::parse("0000000000000000000000000000000000000000")?;
    let mut invalid = vec![vec![], b"{}".to_vec(), serde_json::to_vec_pretty(&saved)?];
    for state in [inactive, nonlocal, cooperative, wrong_content] {
        invalid.push(GameSaveV2::new(state.content_identity.clone(), safe(1), state)?.encode()?);
    }
    let mut natural = kernel(content.clone())?;
    complete_natural_start(&mut natural)?;
    for pending in natural.snapshot()?.pending_presentations {
        natural.settle_presentation(pending.event_id)?;
    }
    let canonical = natural.state().ok_or("run absent")?.clone();
    press(&mut natural, PhysicalKey::Space)?;
    assert_eq!(
        natural.current_control().ok_or("control absent")?.kind,
        GameControlKindV2::BattleMove
    );
    let private = natural.state().ok_or("private state absent")?.clone();
    invalid.push(GameSaveV2::new(private.content_identity.clone(), safe(1), private)?.encode()?);
    for bytes in invalid {
        assert!(
            reader
                .apply_storage_result(request, KernelStorageResultV2::Read { bytes: Some(bytes) })
                .is_err()
        );
        assert_eq!(reader.snapshot()?, before);
    }
    for result in [
        KernelStorageResultV2::Written,
        KernelStorageResultV2::Slots { slots: vec![] },
        KernelStorageResultV2::Failed {
            reason: "provider unavailable".to_owned(),
        },
        KernelStorageResultV2::Uncertain {
            reason: "no terminal evidence".to_owned(),
        },
    ] {
        assert!(reader.apply_storage_result(request, result).is_err());
        assert_eq!(reader.snapshot()?, before);
    }
    // This save is encoded from an untouched actual natural BattleCommand state.
    // It makes no claim that natural bootstrap reached a Save menu.
    let bytes =
        GameSaveV2::new(canonical.content_identity.clone(), safe(7), canonical)?.encode()?;
    reader.apply_storage_result(request, KernelStorageResultV2::Read { bytes: Some(bytes) })?;
    let loaded = reader.snapshot()?;
    let mut clone = restore(loaded, content)?;
    let step = press(&mut reader, PhysicalKey::Space)?;
    assert_eq!(step, press(&mut clone, PhysicalKey::Space)?);
    assert_eq!(reader.snapshot()?, clone.snapshot()?);
    assert_eq!(
        reader.current_control().ok_or("control absent")?.kind,
        GameControlKindV2::BattleMove
    );
    Ok(())
}

#[test]
fn title_menu_revision_and_read_allocator_overflow_preserve_full_snapshot()
-> Result<(), Box<dyn Error>> {
    let content = content()?;
    let mut reader = title(content.clone())?;
    navigate_down_to(&mut reader, "bootstrap/title/existing-saves")?;
    for field in ["menu", "revision"] {
        let mut boundary = reader.snapshot()?;
        if field == "menu" {
            let instance = MenuInstanceId::new(safe(9_007_199_254_740_990));
            let bootstrap = bootstrap_mut(&mut boundary)?;
            bootstrap.menu_instance_high_water = instance;
            bootstrap
                .control
                .menu
                .as_mut()
                .ok_or("menu absent")?
                .instance_id = instance;
            bootstrap
                .control
                .action_context
                .as_mut()
                .ok_or("context absent")?
                .menu_instance = instance;
            boundary.next_menu_instance_id = MenuInstanceId::new(safe(9_007_199_254_740_991));
        } else {
            let bootstrap = bootstrap_mut(&mut boundary)?;
            bootstrap.control.revision = safe(9_007_199_254_740_991);
            let id = "bootstrap/title/9007199254740991";
            bootstrap
                .control
                .menu
                .as_mut()
                .ok_or("menu absent")?
                .control_id = id.to_owned();
            let context = bootstrap
                .control
                .action_context
                .as_mut()
                .ok_or("context absent")?;
            context.authority_revision = safe(9_007_199_254_740_991);
            context.operation_id = OperationId::new(id)?;
        }
        let mut exhausted = restore(boundary.clone(), content.clone())?;
        assert!(exhausted.raw_input(key_down(PhysicalKey::Space)).is_err());
        assert_eq!(exhausted.snapshot()?, boundary);
    }
    let request = list(&mut reader)?;
    reader.apply_storage_result(
        request,
        KernelStorageResultV2::Slots {
            slots: vec!["actual-slot".to_owned()],
        },
    )?;
    let request = read(&mut reader, "actual-slot")?;
    let before = reader.snapshot()?;
    let valid_bytes = saved_write(content.clone())?;
    let mut boundary = before.clone();
    boundary.replay_sequence = safe(9_007_199_254_740_991);
    let mut exhausted = restore(boundary.clone(), content.clone())?;
    assert!(
        exhausted
            .apply_storage_result(
                request,
                KernelStorageResultV2::Read {
                    bytes: Some(valid_bytes.clone())
                }
            )
            .is_err()
    );
    assert_eq!(
        exhausted.snapshot()?,
        boundary,
        "accepted READ normalization also rolls back on replay exhaustion"
    );
    let saved = GameSaveV2::decode(&valid_bytes)?;
    for field in ["menu", "revision"] {
        let mut state = saved.state.clone();
        let control = &mut state.active_run.as_mut().ok_or("run absent")?.control;
        if field == "menu" {
            control.menu.as_mut().ok_or("menu absent")?.instance_id =
                MenuInstanceId::new(safe(9_007_199_254_740_991));
            control
                .action_context
                .as_mut()
                .ok_or("context absent")?
                .menu_instance = MenuInstanceId::new(safe(9_007_199_254_740_991));
        } else {
            control.revision = safe(9_007_199_254_740_991);
            control
                .action_context
                .as_mut()
                .ok_or("context absent")?
                .authority_revision = safe(9_007_199_254_740_991);
        }
        let bytes = GameSaveV2::new(state.content_identity.clone(), safe(1), state)?.encode()?;
        assert!(
            reader
                .apply_storage_result(request, KernelStorageResultV2::Read { bytes: Some(bytes) })
                .is_err()
        );
        assert_eq!(reader.snapshot()?, before);
    }
    Ok(())
}
