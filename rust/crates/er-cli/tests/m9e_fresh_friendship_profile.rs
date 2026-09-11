//! In-process public current entry/save/replay witnesses; no CLI-process claim.
use er_env::current::{CurrentExternalEvent, CurrentGameSession};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_material_v6::GamePlatformEffectV2;
use er_kernel::game_kernel_v7::{
    FreshFriendshipStartV7, GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7, GameKernelV7,
    KernelPresentationOutcomeV2, KernelStorageResultV2,
};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7};
use er_repro::current::{
    CurrentCaptureStatusV1, CurrentReproCapsuleV1, CurrentReproLimitsV1, CurrentReproRecorderV1,
};
use er_save::m9e_save_v2::GameSaveV2;
use er_state::current_friendship_profile::CurrentFriendshipProfileV1;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{GameControlKindV2, SafeU53, SeatId};
use std::{error::Error, sync::Arc};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn one() -> Result<SafeU53> {
    Ok(SafeU53::new(1)?)
}
fn profile() -> Result<ProfileStateV1> {
    Ok(ProfileStateV1 {
        schema_version: PROFILE_STATE_SCHEMA_VERSION_V1,
        unlocks: vec![],
        achievements: vec![],
        challenges: vec![],
        flags: Default::default(),
        dex: DexState::default(),
        statistics: ProfileStatistics {
            runs_started: SafeU53::ZERO,
            runs_won: SafeU53::ZERO,
            runs_lost: SafeU53::ZERO,
            battles_won: SafeU53::ZERO,
            pokemon_captured: SafeU53::ZERO,
            highest_wave: WaveIndex::new(one()?)?,
        },
    })
}
fn content() -> Result<Arc<PreparedGameContentV2>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    Ok(Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?))
}
fn start(content: Arc<PreparedGameContentV2>) -> Result<FreshFriendshipStartV7> {
    Ok(FreshFriendshipStartV7 {
        profile: profile()?,
        seed: "m9e-fresh-friendship-v6".to_owned(),
        local_seat: SeatId::new(one()?),
        save_slots: vec!["fresh-profile".to_owned()],
        content,
        scheduler: KernelSchedulerSnapshotV2 {
            next_timer_id: Some(SafeU53::ZERO),
            timers: vec![],
            pauses: vec![],
            disposed: false,
        },
    })
}
fn session(
    snapshot: CoreGameKernelSnapshotV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<CurrentGameSession> {
    Ok(CurrentGameSession::from_snapshot(
        snapshot,
        SeatId::new(one()?),
        GameKernelRoleV7::Authority,
        content,
    )?)
}
fn owner(snapshot: &CoreGameKernelSnapshotV7) -> Result<&CurrentFriendshipProfileV1> {
    match &snapshot.lifecycle {
        GameKernelLifecycleSnapshotV7::Bootstrap(value) => {
            value.current_friendship_profile.as_ref()
        }
        GameKernelLifecycleSnapshotV7::Active(value)
        | GameKernelLifecycleSnapshotV7::Terminal { state: value, .. } => {
            value.current_friendship_profile.as_ref()
        }
    }
    .ok_or_else(|| "current profile owner absent".into())
}
fn down(key: PhysicalKey) -> CurrentExternalEvent {
    CurrentExternalEvent::RawInput {
        input: RawInputEvent::KeyDown {
            code: key,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
    }
}
fn press(session: &mut CurrentGameSession, key: PhysicalKey) -> Result<GameKernelStepV7> {
    let result = session.apply(down(key.clone()))?;
    session.apply(CurrentExternalEvent::RawInput {
        input: RawInputEvent::KeyUp { code: key },
    })?;
    Ok(result)
}
fn navigate(session: &mut CurrentGameSession, option: &str) -> Result<()> {
    let bound = session
        .kernel_ref()?
        .current_control()
        .and_then(|c| c.menu.as_ref())
        .ok_or("menu absent")?
        .options
        .len()
        + 1;
    for _ in 0..bound {
        if session
            .kernel_ref()?
            .current_control()
            .and_then(|c| c.menu.as_ref())
            .is_some_and(|m| m.selected_option_id.as_str() == option)
        {
            return Ok(());
        }
        press(session, PhysicalKey::ArrowDown)?;
    }
    Err(format!("natural option unreachable: {option}").into())
}
fn captured(
    session: &mut CurrentGameSession,
    event: CurrentExternalEvent,
    content: Arc<PreparedGameContentV2>,
) -> Result<GameKernelStepV7> {
    let before = session.snapshot()?;
    let mut recorder = CurrentReproRecorderV1::new(
        before.clone(),
        SeatId::new(one()?),
        GameKernelRoleV7::Authority,
        content.clone(),
        CurrentReproLimitsV1::default(),
    )?;
    let result = session.apply(event.clone());
    let after = session.snapshot()?;
    let observed = session.observe()?;
    assert_eq!(
        recorder.record(&before, event, result.as_ref(), &after, &observed),
        CurrentCaptureStatusV1::Available {
            base_position: 0,
            final_position: 1
        }
    );
    let capsule = recorder.export()?;
    let wire = serde_json::to_vec(&capsule)?;
    assert!(wire.len() <= CurrentReproLimitsV1::default().maximum_bytes);
    let decoded: CurrentReproCapsuleV1 = serde_json::from_slice(&wire)?;
    assert_eq!(decoded, capsule);
    let (restored_recorder, replayed) =
        CurrentReproRecorderV1::from_capsule(decoded, content, CurrentReproLimitsV1::default())?;
    assert_eq!(restored_recorder.export()?, capsule);
    assert_eq!(replayed.snapshot()?, after);
    assert_eq!(replayed.observe()?, observed);
    *session = replayed;
    Ok(result?)
}

// Isolated applier contract from an actual naturally produced state. These no-op
// envelopes are not represented as gameplay emitted by the natural journey.
fn material_owner_contract(
    state: &er_state::m9e_state_v6::GameStateV6,
    content: &PreparedGameContentV2,
) -> Result<()> {
    use er_game::m9e_material_v6::{
        AppliedGameMaterialLedgerV1, GameActionDomainV2, GameMaterialApplyOutcomeV6,
        GameMaterialV6, GameMaterialV6Error, GameTransitionMaterialV6, apply_game_material_v6,
        game_state_digest,
    };
    for known in [false, true] {
        let mut before = state.clone();
        // Isolate the profile conservation contract from the later optional
        // targeting owner, which itself requires a known profile.
        before.current_targeting = None;
        before.current_turn_execution = None;
        before.current_presentation = None;
        before.current_defender_dispatch = None;
        before.current_achievement_tracker = None;
        before.current_battle_participation = None;
        if !known {
            before.current_friendship_profile = None;
        }
        let control = before
            .active_run
            .as_ref()
            .ok_or("natural run absent")?
            .control
            .clone();
        let revision = SafeU53::new(
            control
                .revision
                .get()
                .checked_sub(1)
                .ok_or("revision underflow")?,
        )?;
        let transition = GameTransitionMaterialV6 {
            schema_version: 6,
            domain: GameActionDomainV2::SaveControl,
            operation_id: er_types::OperationId::new("fresh-profile/material-conservation")?,
            authority_seat: SeatId::new(one()?),
            authority_revision: revision,
            content_identity: content.identity().clone(),
            owned_phase: None,
            accepted_action: Some(er_types::GameActionV1::Save {
                action: er_types::SaveActionV1::Cancel,
            }),
            before_digest: game_state_digest(&before)?,
            after_digest: game_state_digest(&before)?,
            mutations: vec![],
            rng_audit: vec![],
            after_state: before.clone(),
            next_control: control,
            presentation: vec![],
            platform_effects: vec![],
        };
        let mut live = Some(before.clone());
        let ledger = AppliedGameMaterialLedgerV1::new(revision)?;
        let mut applied = ledger.clone();
        assert_eq!(
            apply_game_material_v6(
                &mut live,
                &mut applied,
                content,
                &GameMaterialV6::GameAction(transition.clone()).canonical_bytes()?
            )?,
            GameMaterialApplyOutcomeV6::Applied
        );
        assert_eq!(live, Some(before.clone()));
        let mut forged = transition;
        forged.after_state.current_friendship_profile = if known {
            None
        } else {
            state.current_friendship_profile.clone()
        };
        forged.after_digest = game_state_digest(&forged.after_state)?;
        let bytes = GameMaterialV6::GameAction(forged).canonical_bytes()?;
        let mut live = Some(before.clone());
        let mut rejected = ledger.clone();
        assert_eq!(
            apply_game_material_v6(&mut live, &mut rejected, content, &bytes),
            Err(GameMaterialV6Error::Invalid)
        );
        assert_eq!(live, Some(before));
        assert_eq!(rejected, ledger);
    }
    Ok(())
}

#[test]
fn fresh_title_accounts_survive_natural_state_save_and_captured_replay() -> Result<()> {
    let content = content()?;
    let fresh = CurrentGameSession::natural_start_with_fresh_friendship(start(content.clone())?)?;
    let title = fresh.snapshot()?;
    assert_eq!(
        fresh.kernel_ref()?.current_control().map(|c| c.kind),
        Some(GameControlKindV2::Title)
    );
    let expected = owner(&title)?.clone();
    assert_eq!(
        expected.accounts.len(),
        er_game::current_friendship_profile::seed_species(&content)?.len()
    );
    assert!(
        expected.accounts.len() > 570,
        "ER custom source closure is required"
    );
    let oracle_path = std::env::var("ER_M9E_FRESH_ACCOUNT_ORACLE")?;
    let oracle_bytes = std::fs::read(oracle_path)?;
    assert!(oracle_bytes.len() <= 65_536);
    let oracle: Vec<u64> = serde_json::from_slice(&oracle_bytes)?;
    assert_eq!(
        expected
            .accounts
            .iter()
            .map(|account| account.species.get().get())
            .collect::<Vec<_>>(),
        oracle
    );
    assert!(
        expected
            .accounts
            .iter()
            .all(|a| a.friendship_progress == SafeU53::ZERO
                && a.candy_count == SafeU53::ZERO
                && a.passive_attr == 0)
    );
    let mut current = session(
        serde_json::from_slice(&serde_json::to_vec(&title)?)?,
        content.clone(),
    )?;
    captured(&mut current, down(PhysicalKey::Space), content.clone())?;
    captured(
        &mut current,
        CurrentExternalEvent::RawInput {
            input: RawInputEvent::KeyUp {
                code: PhysicalKey::Space,
            },
        },
        content.clone(),
    )?;
    let entered = press(&mut current, PhysicalKey::Space)?;
    assert_eq!(
        current.kernel_ref()?.current_control().map(|c| c.kind),
        Some(GameControlKindV2::StarterSelect)
    );
    let request = entered
        .effects
        .iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::Platform(
                er_game::m9e_material_v6::GamePlatformEffectV2::StarterPokerusClock {
                    request, ..
                },
            ) => Some(*request),
            _ => None,
        })
        .ok_or("actual daily source clock request absent")?;
    captured(
        &mut current,
        CurrentExternalEvent::CurrentUtcClockResult {
            request_id: request,
            utc_milliseconds: 0,
        },
        content.clone(),
    )?;
    press(&mut current, PhysicalKey::Space)?;
    navigate(&mut current, "bootstrap/starter/confirm")?;
    let mut committed = false;
    for _ in 0..4 {
        committed |= press(&mut current, PhysicalKey::Space)?
            .effects
            .iter()
            .any(|e| matches!(e, GameKernelEffectV7::AuthorityMaterial { .. }));
    }
    assert!(committed, "natural bootstrap must commit actual material");
    assert!(
        current
            .kernel_ref()?
            .state()
            .and_then(|s| s.active_run.as_ref())
            .and_then(|r| r.battle.as_ref())
            .is_some()
    );
    for pending in current.snapshot()?.pending_presentations {
        captured(
            &mut current,
            CurrentExternalEvent::PresentationOutcome {
                event_id: pending.event_id,
                outcome: KernelPresentationOutcomeV2::Settled,
            },
            content.clone(),
        )?;
    }
    let active = current.snapshot()?;
    assert_eq!(owner(&active)?, &expected);
    let state = current
        .kernel_ref()?
        .state()
        .ok_or("natural active state absent")?
        .clone();
    material_owner_contract(&state, &content)?;
    // Use the actual save serializer on the untouched natural state; no Save menu is injected.
    let save = GameSaveV2::new(content.identity().clone(), one()?, state.clone())?;
    let bytes = save.encode()?;
    let decoded = GameSaveV2::decode(&bytes)?;
    assert_eq!(decoded.state, state);
    assert_eq!(decoded.encode()?, bytes);
    let old = start(content.clone())?;
    let mut reader = GameKernelV7::natural_start(
        old.profile,
        old.seed,
        old.local_seat,
        old.save_slots,
        true,
        old.content,
        old.scheduler,
        None,
    )?;
    reader.enable_current_title_storage()?;
    let mut reader = session(reader.snapshot()?, content.clone())?;
    navigate(&mut reader, "bootstrap/title/existing-saves")?;
    let list = press(&mut reader, PhysicalKey::Space)?
        .effects
        .into_iter()
        .find_map(|e| match e {
            GameKernelEffectV7::Platform(GamePlatformEffectV2::StorageList { request }) => {
                Some(request)
            }
            _ => None,
        })
        .ok_or("actual LIST absent")?;
    captured(
        &mut reader,
        CurrentExternalEvent::StorageResult {
            request_id: list,
            result: KernelStorageResultV2::Slots {
                slots: vec!["fresh-profile".to_owned()],
            },
        },
        content.clone(),
    )?;
    let request = press(&mut reader, PhysicalKey::Space)?
        .effects
        .into_iter()
        .find_map(|e| match e {
            GameKernelEffectV7::Platform(GamePlatformEffectV2::StorageRead { request, .. }) => {
                Some(request)
            }
            _ => None,
        })
        .ok_or("actual READ absent")?;
    captured(
        &mut reader,
        CurrentExternalEvent::StorageResult {
            request_id: request,
            result: KernelStorageResultV2::Read { bytes: Some(bytes) },
        },
        content,
    )?;
    assert_eq!(owner(&reader.snapshot()?)?, &expected);
    assert_eq!(
        reader
            .kernel_ref()?
            .state()
            .ok_or("loaded state absent")?
            .profile,
        state.profile
    );
    Ok(())
}

#[test]
fn fresh_catalog_requires_qualified_complete_progression_not_only_oracle_sha() -> Result<()> {
    for missing_metadata in [false, true] {
        let mut bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
        let progression = Arc::make_mut(&mut bundle.progression);
        let index = progression
            .species
            .iter()
            .position(|row| row.form == 0 && row.species.get().get() >= 10_000)
            .ok_or("actual custom base species absent")?;
        if missing_metadata {
            progression.species[index].experience = None;
        } else {
            progression.species.remove(index);
        }
        progression.content_hash = progression.recompute_hash()?;
        bundle.content_hash = bundle.recompute_hash()?;
        // An earlier prepared-content validation rejection also safely prevents
        // admission. If the changed pack is structurally valid, the source-complete
        // catalog identity guard must reject it independently.
        let prepared = PreparedGameContentV2::prepare(Arc::new(bundle));
        if missing_metadata {
            assert!(
                prepared.is_ok(),
                "optional historical metadata must still prepare; fresh admission is separate"
            );
        }
        if let Ok(content) = prepared {
            assert!(er_game::current_friendship_profile::seed_species(&content).is_err());
            assert!(
                GameKernelV7::natural_start_with_fresh_friendship(start(Arc::new(content))?)
                    .is_err()
            );
        }
    }
    Ok(())
}

#[test]
fn unknown_profile_restore_does_not_create_accounts_or_erase_legacy_bytes() -> Result<()> {
    let content = content()?;
    let mut input = start(content.clone())?;
    input.profile.statistics.runs_started = one()?;
    let kernel = GameKernelV7::natural_start(
        input.profile.clone(),
        input.seed.clone(),
        input.local_seat,
        input.save_slots.clone(),
        true,
        content.clone(),
        input.scheduler.clone(),
        None,
    )?;
    let before = kernel.snapshot()?;
    let wire = serde_json::to_vec(&before)?;
    assert!(!String::from_utf8(wire.clone())?.contains("current_friendship_profile"));
    let restored = session(serde_json::from_slice(&wire)?, content.clone())?;
    assert_eq!(restored.snapshot()?, before);
    assert!(owner(&before).is_err());
    assert!(GameKernelV7::natural_start_with_fresh_friendship(input).is_err());
    assert_eq!(kernel.snapshot()?, before);
    let fresh = GameKernelV7::natural_start_with_fresh_friendship(start(content)?)?.snapshot()?;
    assert!(owner(&fresh).is_ok());
    assert!(owner(&restored.snapshot()?).is_err());
    Ok(())
}

#[test]
fn fresh_owner_restore_rejects_catalog_and_schema_forgery_transactionally() -> Result<()> {
    let content = content()?;
    let snapshot =
        GameKernelV7::natural_start_with_fresh_friendship(start(content.clone())?)?.snapshot()?;
    let mut current = session(snapshot.clone(), content.clone())?;
    for case in 0..7 {
        let mut forged = snapshot.clone();
        let GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) = &mut forged.lifecycle else {
            return Err("fresh Title missing".into());
        };
        let accounts = bootstrap
            .current_friendship_profile
            .as_mut()
            .ok_or("owner absent")?;
        match case {
            0 => {
                accounts.accounts.pop();
            }
            1 => {
                accounts.accounts.push(accounts.accounts[0].clone());
            }
            2 => {
                accounts.accounts.swap(0, 1);
            }
            3 => {
                accounts.accounts[0].passive_attr = 64;
            }
            4 => {
                accounts.schema_version = 2;
            }
            5 => {
                accounts.owner_seat = SeatId::new(SafeU53::new(2)?);
            }
            _ => {
                accounts.content_identity.progression_hash =
                    er_types::CatalogHash::parse("a".repeat(64))?;
            }
        }
        assert!(current.restore(forged).is_err(), "forgery case {case}");
        assert_eq!(current.snapshot()?, snapshot);
    }
    let mut wire = serde_json::to_value(owner(&snapshot)?)?;
    wire.as_object_mut()
        .ok_or("owner wire object absent")?
        .insert(
            "assumed_legacy_zero".to_owned(),
            serde_json::Value::Bool(true),
        );
    assert!(serde_json::from_value::<CurrentFriendshipProfileV1>(wire).is_err());
    Ok(())
}
