//! Actual CurrentDispatcher with both independently published content bundles.
//! Runner supplies verified files; no generated content is embedded in this test.
use std::error::Error;
use std::io::Write;
use std::path::PathBuf;
use std::time::Instant;

use er_game::m9e_material_v6::GameMaterialV6;
use er_kernel::game_kernel_v7::{GameKernelEffectV7, GameKernelStepV7};
use er_kernel::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7};
use er_repro::current::{CurrentReproCapsuleV1, CurrentReproOutcomeV1};
use er_save::m9e_save_v2::GameSaveV2;
use er_types::{
    BattleUiActionV1, GameActionV1, GameControlPlanV2, InputFocus, PhysicalKey, RawInputEvent,
    SafeU53,
};
use serde_json::{Value, json};

#[path = "support/m9e_generated_content_compat.rs"]
mod support;
use support::Cli;

type TestResult<T = ()> = Result<T, Box<dyn Error>>;
const OLD_HASH: &str = "blake3-v1:9de581e0d922874eaf17b8a9c355e4d154b051b34935fad60d5779c70de68429";
const NEW_HASH: &str = "blake3-v1:dc4ab1ede5c52152e40f1dc5579d93841898126903b3047bf66b60efd7646493";

fn digest(value: &Value) -> TestResult<String> {
    Ok(format!(
        "blake3-v1:{}",
        er_canonical::content_digest(value)?
    ))
}

fn same(actual: &Value, expected: &Value) -> TestResult {
    // Compare complete values without dumping large snapshots into failure logs.
    assert_eq!(digest(actual)?, digest(expected)?);
    Ok(())
}

fn progress(label: &str, phase: &str, began: Instant, detail: &str) -> TestResult {
    // A small fixed number of phase rows survives an assertion/timeout. Never
    // emit a whole snapshot, capsule, save or prepared content body.
    let detail = detail.chars().take(256).collect::<String>();
    writeln!(
        std::io::stderr().lock(),
        "M9E_COMPAT endpoint={label} phase={phase} elapsed_ms={} detail={detail:?}",
        began.elapsed().as_millis()
    )?;
    Ok(())
}

fn lifecycle_detail(snapshot: &CoreGameKernelSnapshotV7) -> String {
    match &snapshot.lifecycle {
        GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) => {
            format!("Bootstrap stage={:?}", bootstrap.stage)
        }
        GameKernelLifecycleSnapshotV7::Active(state) => format!(
            "Active control={:?}",
            state.active_run.as_ref().map(|run| run.control.kind)
        ),
        GameKernelLifecycleSnapshotV7::Terminal { terminal, .. } => {
            let reason = terminal.reason.chars().take(160).collect::<String>();
            format!("Terminal reason={reason:?}")
        }
    }
}

fn start(existing_saves: bool) -> Value {
    json!({"kind":"NATURAL", "seed":"m9e-native-capture", "owner_seat":1,
        "save_slots":["preview-slot"], "local_is_host":true, "existing_saves":existing_saves,
        "profile":{"schema_version":1,"unlocks":[],"achievements":[],"challenges":[],"flags":[],
            "statistics":{"runs_started":0,"runs_won":0,"runs_lost":0,"battles_won":0,
                "pokemon_captured":0,"highest_wave":1},"dex":{"entries":[]}}})
}

fn checkpoint(cli: &mut Cli, id: &str) -> TestResult<Value> {
    cli.result("session.checkpoint", json!({"session":id}))
}

fn capsule(cli: &mut Cli, id: &str) -> TestResult<Value> {
    let mut result = cli.result("session.capsule.export", json!({"session":id}))?;
    Ok(result.get_mut("capsule").ok_or("capsule missing")?.take())
}

fn observation(cli: &mut Cli, id: &str) -> TestResult<Value> {
    cli.result("session.observe", json!({"session":id}))
}

fn press(cli: &mut Cli, id: &str, code: PhysicalKey) -> TestResult {
    for input in [
        RawInputEvent::KeyDown {
            code: code.clone(),
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
        RawInputEvent::KeyUp { code },
    ] {
        cli.result("session.raw_input", json!({"session":id,"input":input}))?;
    }
    Ok(())
}

fn select(cli: &mut Cli, id: &str, target: &str) -> TestResult {
    let description = cli.result("control.describe", json!({"session":id}))?;
    let plan = cli.result(
        "control.plan_navigation",
        json!({"session":id,"expected_menu_instance":description["description"]["menu_instance"],
            "expected_control_digest":description["control_digest"],"target":target,
            "submit":false,"maximum_events":4096}),
    )?;
    let events: Vec<RawInputEvent> = serde_json::from_value(plan["plan"]["events"].clone())?;
    assert!(events.len() <= 4096);
    writeln!(
        std::io::stderr().lock(),
        "M9E_COMPAT navigation session={id} target={target} events={}",
        events.len()
    )?;
    // The existing public query only plans. Execute every planned raw event
    // through the real dispatcher, then verify the actual public selection.
    for input in events {
        cli.result("session.raw_input", json!({"session":id,"input":input}))?;
    }
    assert_eq!(
        observation(cli, id)?["control"]["menu"]["selected_option_id"],
        target
    );
    Ok(())
}

fn settle(cli: &mut Cli, id: &str) -> TestResult<usize> {
    let mut count = 0;
    // Finite existing callbacks only; no invented presentation IDs or state.
    for _ in 0..16 {
        let snapshot: CoreGameKernelSnapshotV7 = serde_json::from_value(checkpoint(cli, id)?)?;
        if snapshot.pending_presentations.is_empty() {
            return Ok(count);
        }
        for pending in snapshot.pending_presentations {
            cli.result(
                "session.presentation_settled",
                json!({"session":id,"event_id":pending.event_id}),
            )?;
            count += 1;
        }
    }
    Err("presentation settlement exceeded 16 batches".into())
}

struct Artifacts {
    snapshot: Value,
    capsule: Value,
    save: Vec<u8>,
    facts: Value,
}

fn produce(cli: &mut Cli, hash: &str, label: &str, began: Instant) -> TestResult<Artifacts> {
    progress(label, "natural-create", began, hash)?;
    let hello = cli.result("protocol.hello", json!({}))?;
    assert_eq!(hello["backend"], "IN_PROCESS_V7");
    assert_eq!(hello["content_identity"]["bundle_hash"], hash);
    cli.result(
        "session.create",
        json!({"session":"source","start":start(false)}),
    )?;
    assert_eq!(observation(cli, "source")?["control"]["kind"], "TITLE");
    for _ in 0..2 {
        press(cli, "source", PhysicalKey::Space)?;
    }
    let setup: CoreGameKernelSnapshotV7 = serde_json::from_value(checkpoint(cli, "source")?)?;
    let GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) = setup.lifecycle else {
        return Err(format!("{label}: natural starter setup missing").into());
    };
    assert!(bootstrap.selections.starters.is_empty());
    // Same actual catalog/budget policy as m9e_checkpoint_healing_v7. A single
    // default starter may naturally lose the first turn; select six legal
    // starters through raw controls instead of imposing a battle outcome.
    let mut remaining = bootstrap.catalog.maximum_starter_cost;
    let mut starters = Vec::new();
    let mut choices = bootstrap.catalog.starters.iter().collect::<Vec<_>>();
    choices.sort_by_key(|starter| (starter.cost, starter.pokemon_id));
    for starter in choices {
        if starter.cost <= remaining {
            remaining -= starter.cost;
            starters.push(starter.pokemon_id);
            if starters.len() == 6.min(bootstrap.catalog.maximum_starters) {
                break;
            }
        }
    }
    assert_eq!(starters.len(), 6, "natural six-starter policy unavailable");
    for starter in &starters {
        progress(label, "select-starter", began, &starter.get().to_string())?;
        select(cli, "source", &format!("bootstrap/starter/{}", starter.get()))?;
        press(cli, "source", PhysicalKey::Space)?;
        progress(label, "starter-selected", began, &starter.get().to_string())?;
    }
    let selected: CoreGameKernelSnapshotV7 = serde_json::from_value(checkpoint(cli, "source")?)?;
    let GameKernelLifecycleSnapshotV7::Bootstrap(selected) = selected.lifecycle else {
        return Err(format!("{label}: selected starter setup missing").into());
    };
    assert_eq!(selected.selections.starters.len(), 6);
    let mut selected_ids = selected
        .selections
        .starters
        .iter()
        .map(|starter| starter.pokemon_id)
        .collect::<Vec<_>>();
    selected_ids.sort();
    starters.sort();
    assert_eq!(selected_ids, starters);
    select(cli, "source", "bootstrap/starter/confirm")?;
    for _ in 0..4 {
        press(cli, "source", PhysicalKey::Space)?;
    }
    settle(cli, "source")?;
    assert_eq!(
        observation(cli, "source")?["control"]["kind"],
        "BATTLE_COMMAND"
    );
    let before_action = checkpoint(cli, "source")?;
    progress(
        label,
        "battle-command",
        began,
        "six selected starters; actual first battle",
    )?;
    // Query the actual legal move leaf; submit its existing public option via
    // raw input. No action, target, winner, RNG or state is injected.
    select(cli, "source", "battle/command/fight")?;
    press(cli, "source", PhysicalKey::Space)?;
    assert_eq!(
        observation(cli, "source")?["control"]["kind"],
        "BATTLE_MOVE"
    );
    let action = checkpoint(cli, "source")?;
    assert_ne!(digest(&before_action)?, digest(&action)?);
    let control: GameControlPlanV2 =
        serde_json::from_value(observation(cli, "source")?["control"].clone())?;
    let menu = control.menu.ok_or("legal move menu")?;
    let option = menu
        .options
        .iter()
        .find(|option| {
            matches!(
                &option.action,
                GameActionV1::Battle {
                    action: BattleUiActionV1::SelectMove { .. }
                }
            )
        })
        .ok_or("public legal SelectMove option")?;
    select(cli, "source", option.option_id.as_str())?;
    progress(label, "submit-move", began, option.option_id.as_str())?;
    let response = cli.result(
        "session.raw_input",
        json!({"session":"source","input":RawInputEvent::KeyDown {
        code:PhysicalKey::Space,printable:false,browser_repeat:false,focus:InputFocus::Game}}),
    )?;
    let step: GameKernelStepV7 = serde_json::from_value(response["step"].clone())?;
    let mut resolved_turns = 0;
    for effect in &step.effects {
        if let GameKernelEffectV7::AuthorityMaterial { bytes, .. } = effect
            && matches!(
                serde_json::from_slice::<GameMaterialV6>(bytes)?,
                GameMaterialV6::BattleTurn(_)
            )
        {
            resolved_turns += 1;
        }
    }
    assert_eq!(
        resolved_turns, 1,
        "one real authority battle-turn material required"
    );
    cli.result(
        "session.raw_input",
        json!({"session":"source","input":RawInputEvent::KeyUp {code:PhysicalKey::Space}}),
    )?;
    let settled = settle(cli, "source")?;
    assert!(
        settled > 0,
        "actual owned battle presentation acknowledgments required"
    );
    let snapshot = checkpoint(cli, "source")?;
    same(
        &snapshot,
        &cli.result("session.snapshot", json!({"session":"source"}))?,
    )?;
    let typed: CoreGameKernelSnapshotV7 = serde_json::from_value(snapshot.clone())?;
    let lifecycle = lifecycle_detail(&typed);
    progress(label, "settled-turn-checkpoint", began, &lifecycle)?;
    assert!(typed.pending_platform.is_empty());
    assert!(typed.pending_presentations.is_empty());
    assert!(typed.private_battle_control.is_none());
    assert!(typed.input_router.pressed.is_empty());
    assert!(typed.input_router.held_buttons.is_empty());
    assert!(typed.input_router.repeats.is_empty());
    assert!(typed.scheduler.timers.is_empty());
    let GameKernelLifecycleSnapshotV7::Active(state) = typed.lifecycle else {
        return Err(format!("{label}: natural checkpoint was not Active: {lifecycle}").into());
    };
    assert_eq!(
        serde_json::to_value(&state.content_identity)?["bundle_hash"],
        hash
    );
    let before_typed: CoreGameKernelSnapshotV7 = serde_json::from_value(before_action)?;
    let GameKernelLifecycleSnapshotV7::Active(before_state) = before_typed.lifecycle else {
        return Err("natural pre-turn checkpoint was not Active".into());
    };
    let before_battle = before_state
        .active_run
        .as_ref()
        .and_then(|run| run.battle.as_ref())
        .ok_or("pre-turn battle")?;
    let after_battle = state
        .active_run
        .as_ref()
        .and_then(|run| run.battle.as_ref())
        .ok_or("post-turn battle")?;
    assert_eq!(after_battle.battle_id, before_battle.battle_id);
    assert_eq!(
        after_battle.turn.get().get(),
        before_battle.turn.get().get() + 1
    );
    assert_ne!(after_battle.battle_rng, before_battle.battle_rng);
    let turn_before = before_battle.turn;
    let turn_after = after_battle.turn;
    // Dispatcher has no save-export endpoint. Encode the exact returned Active
    // state via the production save API; this is not a natural Save-menu claim.
    let save =
        GameSaveV2::new(state.content_identity.clone(), SafeU53::new(1)?, state)?.encode()?;
    let exported = capsule(cli, "source")?;
    let typed_capsule: CurrentReproCapsuleV1 = serde_json::from_value(exported.clone())?;
    assert!(!typed_capsule.attempts.is_empty());
    assert!(typed_capsule.browser_transport.is_none());
    assert!(
        typed_capsule
            .attempts
            .iter()
            .any(|attempt| attempt.origin.as_deref() == Some("session.raw_input"))
    );
    assert!(
        typed_capsule
            .attempts
            .iter()
            .any(|attempt| matches!(&attempt.outcome,
        CurrentReproOutcomeV1::Applied { step: retained, .. } if retained.as_ref() == &step)),
        "actual BattleTurn step must remain in the replay capsule"
    );
    let facts = json!({"bundle_hash":hash,"snapshot_digest":digest(&snapshot)?,
        "action_snapshot_digest":digest(&action)?,"capsule_digest":digest(&exported)?,
        "snapshot_bytes":serde_json::to_vec(&snapshot)?.len(),"save_bytes":save.len(),
        "save_digest":format!("blake3-v1:{}",er_canonical::content_digest(&GameSaveV2::decode(&save)?)?),
        "capsule_bytes":serde_json::to_vec(&exported)?.len(),
        "base_position":typed_capsule.base_position,"final_position":typed_capsule.final_position,
        "attempts":typed_capsule.attempts.len(),"resolved_turns":resolved_turns,
        "presentation_acknowledgments":settled,"selected_move_option":option.option_id,
        "turn_before":turn_before,"turn_after":turn_after});
    Ok(Artifacts {
        snapshot,
        capsule: exported,
        save,
        facts,
    })
}

fn continue_identically(cli: &mut Cli, ids: &[&str]) -> TestResult {
    let before = checkpoint(cli, ids[0])?;
    for id in ids {
        press(cli, id, PhysicalKey::ArrowDown)?;
    }
    let after = checkpoint(cli, ids[0])?;
    assert_ne!(digest(&before)?, digest(&after)?);
    for id in &ids[1..] {
        same(&checkpoint(cli, id)?, &after)?;
    }
    Ok(())
}

fn compatible(cli: &mut Cli, own: &Artifacts) -> TestResult {
    cli.result(
        "session.from_snapshot",
        json!({"session":"snapshot","snapshot":own.snapshot,"owner_seat":1,"role":"AUTHORITY"}),
    )?;
    cli.result(
        "session.from_capsule",
        json!({"session":"replay","capsule":own.capsule}),
    )?;
    for id in ["snapshot", "replay"] {
        same(&checkpoint(cli, id)?, &own.snapshot)?;
    }
    continue_identically(cli, &["source", "snapshot", "replay"])?;
    cli.result(
        "session.restore",
        json!({"session":"source","snapshot":own.snapshot}),
    )?;
    same(&checkpoint(cli, "source")?, &own.snapshot)?;
    for id in ["snapshot", "replay"] {
        cli.result("session.close", json!({"session":id}))?;
    }
    Ok(())
}

fn incompatible(cli: &mut Cli, own: &Artifacts, foreign: &Artifacts) -> TestResult {
    cli.result(
        "session.fork",
        json!({"session":"source","target_session":"unrelated"}),
    )?;
    let unrelated = capsule(cli, "unrelated")?;
    cli.rejects(
        "session.restore",
        json!({"session":"source","snapshot":foreign.snapshot}),
        "snapshot V7 is invalid",
    )?;
    same(&checkpoint(cli, "source")?, &own.snapshot)?;
    // Failed non-event ingress intentionally invalidates only its capture.
    assert_eq!(
        cli.result("session.capsule.status", json!({"session":"source"}))?["status"]["kind"],
        "UNAVAILABLE"
    );
    same(&capsule(cli, "unrelated")?, &unrelated)?;
    cli.rejects(
        "session.from_snapshot",
        json!({"session":"import","snapshot":foreign.snapshot,"owner_seat":1,"role":"AUTHORITY"}),
        "snapshot V7 is invalid",
    )?;
    cli.rejects(
        "session.from_capsule",
        json!({"session":"import","capsule":foreign.capsule}),
        "content_identity",
    )?;
    cli.rejects(
        "session.snapshot",
        json!({"session":"import"}),
        "missing or closed",
    )?;
    // Both failed constructors leave the ID available for the genuine capsule.
    cli.result(
        "session.from_capsule",
        json!({"session":"import","capsule":own.capsule}),
    )?;
    same(&checkpoint(cli, "import")?, &own.snapshot)?;
    same(&checkpoint(cli, "source")?, &own.snapshot)?;
    same(&checkpoint(cli, "unrelated")?, &own.snapshot)?;
    same(&capsule(cli, "unrelated")?, &unrelated)?;
    continue_identically(cli, &["source", "import", "unrelated"])?;
    for id in ["source", "import", "unrelated"] {
        cli.result("session.close", json!({"session":id}))?;
    }
    Ok(())
}

fn save_ingress(cli: &mut Cli, own: &Artifacts, foreign: &Artifacts) -> TestResult {
    cli.result(
        "session.create",
        json!({"session":"load","start":start(true)}),
    )?;
    press(cli, "load", PhysicalKey::ArrowDown)?;
    press(cli, "load", PhysicalKey::Space)?;
    let listed: CoreGameKernelSnapshotV7 = serde_json::from_value(checkpoint(cli, "load")?)?;
    assert_eq!(listed.pending_platform.len(), 1);
    cli.result(
        "session.storage_result",
        json!({"session":"load","request_id":listed.pending_platform[0].request_id,
        "result":{"kind":"SLOTS","slots":["stored-actual"]}}),
    )?;
    press(cli, "load", PhysicalKey::Space)?;
    let before = checkpoint(cli, "load")?;
    let pending: CoreGameKernelSnapshotV7 = serde_json::from_value(before.clone())?;
    assert_eq!(pending.pending_platform.len(), 1);
    let request_id = pending.pending_platform[0].request_id;
    let capture_before: CurrentReproCapsuleV1 = serde_json::from_value(capsule(cli, "load")?)?;
    cli.rejects(
        "session.storage_result",
        json!({"session":"load","request_id":request_id,
        "result":{"kind":"READ","bytes":foreign.save}}),
        "loaded save content identity differs",
    )?;
    same(&checkpoint(cli, "load")?, &before)?;
    let capture_after: CurrentReproCapsuleV1 = serde_json::from_value(capsule(cli, "load")?)?;
    assert_eq!(
        capture_after.final_position,
        capture_before.final_position + 1
    );
    assert!(matches!(
        capture_after
            .attempts
            .last()
            .ok_or("rejected read attempt")?
            .outcome,
        CurrentReproOutcomeV1::KernelRejected { .. }
    ));
    // The identical request ID remains live; compatible bytes consume it.
    cli.result(
        "session.storage_result",
        json!({"session":"load","request_id":request_id,
        "result":{"kind":"READ","bytes":own.save}}),
    )?;
    let loaded: CoreGameKernelSnapshotV7 = serde_json::from_value(checkpoint(cli, "load")?)?;
    assert!(loaded.pending_platform.is_empty());
    let GameKernelLifecycleSnapshotV7::Active(state) = loaded.lifecycle else {
        return Err("compatible save did not load Active state".into());
    };
    let saved = GameSaveV2::decode(&own.save)?;
    assert_eq!(state.content_identity, saved.content_identity);
    assert_eq!(state.profile, saved.state.profile);
    let actual_state = serde_json::to_value(&state)?;
    let saved_state = serde_json::to_value(&saved.state)?;
    let state_fields = saved_state.as_object().ok_or("saved state object")?;
    assert_eq!(
        actual_state.as_object().ok_or("loaded state object")?.len(),
        state_fields.len()
    );
    for (name, value) in state_fields {
        if name != "identities" && name != "active_run" {
            same(
                actual_state.get(name).ok_or("lost top-level state field")?,
                value,
            )?;
        }
    }
    let identity_fields = saved_state["identities"]
        .as_object()
        .ok_or("saved identities")?;
    assert_eq!(
        actual_state["identities"]
            .as_object()
            .ok_or("loaded identities")?
            .len(),
        identity_fields.len()
    );
    for (name, value) in identity_fields {
        if name != "next_platform_request_id" {
            same(
                actual_state["identities"]
                    .get(name)
                    .ok_or("lost allocator")?,
                value,
            )?;
        }
    }
    assert!(
        state.identities.next_platform_request_id
            >= saved.state.identities.next_platform_request_id
    );
    assert!(state.identities.next_platform_request_id > request_id.get());
    let run = state.active_run.as_ref().ok_or("loaded run")?;
    let source_run = saved.state.active_run.as_ref().ok_or("saved run")?;
    // READ deliberately rebinds control ownership. Compare EVERY other run
    // field (including RNG, party, battle, seed, progress and queues) unchanged,
    // without rewriting either artifact or its content identity.
    let loaded_run = serde_json::to_value(run)?;
    let saved_run = serde_json::to_value(source_run)?;
    let fields = saved_run.as_object().ok_or("saved run object")?;
    assert_eq!(
        loaded_run.as_object().ok_or("loaded run object")?.len(),
        fields.len()
    );
    for (name, value) in fields {
        if name != "control" {
            same(loaded_run.get(name).ok_or("lost run field")?, value)?;
        }
    }
    assert_eq!(run.control.kind, source_run.control.kind);
    assert!(run.control.revision >= source_run.control.revision);
    assert_ne!(
        run.control.menu.as_ref().ok_or("loaded menu")?.instance_id,
        source_run
            .control
            .menu
            .as_ref()
            .ok_or("saved menu")?
            .instance_id
    );
    let before_continuation = checkpoint(cli, "load")?;
    press(cli, "load", PhysicalKey::ArrowDown)?;
    assert_ne!(
        digest(&checkpoint(cli, "load")?)?,
        digest(&before_continuation)?
    );
    cli.result("session.invariants", json!({"session":"load"}))?;
    cli.result("session.close", json!({"session":"load"}))?;
    Ok(())
}

#[test]
fn actual_old_and_regenerated_bundles_preserve_own_artifacts_and_reject_each_other_transactionally()
-> TestResult {
    let began = Instant::now();
    let executable = PathBuf::from(std::env::var("ER_M9E_COMPAT_CLI")?);
    assert!(executable.is_absolute());
    assert_eq!(
        executable.canonicalize()?,
        PathBuf::from(env!("CARGO_BIN_EXE_er-cli")).canonicalize()?
    );
    let old = PathBuf::from(std::env::var("ER_M9E_COMPAT_OLD_BUNDLE")?);
    let new = PathBuf::from(std::env::var("ER_M9E_COMPAT_NEW_BUNDLE")?);
    assert!(old.is_absolute() && new.is_absolute());
    assert_ne!(old.canonicalize()?, new.canonicalize()?);
    assert_eq!(std::fs::metadata(&old)?.len(), 15_810_979);
    assert_eq!(std::fs::metadata(&new)?.len(), 16_325_821);
    let mut old_cli = Cli::new(&old, 4)?;
    let mut new_cli = Cli::new(&new, 4)?;
    let old_artifacts = produce(&mut old_cli, OLD_HASH, "old", began)
        .map_err(|error| format!("old produce: {error}"))?;
    let new_artifacts = produce(&mut new_cli, NEW_HASH, "new", began)
        .map_err(|error| format!("new produce: {error}"))?;
    assert_ne!(
        digest(&old_artifacts.snapshot)?,
        digest(&new_artifacts.snapshot)?
    );
    for (label, cli, own, foreign) in [
        ("old", &mut old_cli, &old_artifacts, &new_artifacts),
        ("new", &mut new_cli, &new_artifacts, &old_artifacts),
    ] {
        progress(label, "same-content-restore-replay", began, "begin")?;
        compatible(cli, own).map_err(|error| format!("{label} compatible: {error}"))?;
        progress(label, "foreign-checkpoint-capsule", began, "begin")?;
        incompatible(cli, own, foreign)
            .map_err(|error| format!("{label} incompatible: {error}"))?;
        progress(label, "actual-title-save-ingress", began, "begin")?;
        save_ingress(cli, own, foreign)
            .map_err(|error| format!("{label} save_ingress: {error}"))?;
        progress(label, "compatibility-complete", began, "all assertions passed")?;
    }
    old_cli.finish()?;
    new_cli.finish()?;
    let evidence = json!({"schema_version":1,"scope":"ACTUAL_NATIVE_CURRENT_DISPATCHER_TWO_BUNDLE_COMPATIBILITY",
        "old":old_artifacts.facts,"new":new_artifacts.facts,"directions":2,
        "same_content_snapshot_restore_and_replay_continued":true,
        "foreign_checkpoint_and_capsule_rejected":true,"foreign_save_read_preserved_pending_request":true,
        "save_source":"GameSaveV2::new of exact public Active checkpoint; no natural Save-menu claim"});
    let bytes = serde_json::to_vec(&evidence)?;
    assert!(bytes.len() <= 16 << 10);
    let output = PathBuf::from(std::env::var("ER_M9E_COMPAT_EVIDENCE")?);
    assert!(output.is_absolute());
    std::fs::write(output, bytes)?;
    Ok(())
}
