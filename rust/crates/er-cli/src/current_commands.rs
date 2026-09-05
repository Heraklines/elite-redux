//! Current-session terminal and virtual-time commands.
//!
//! Platform requests are emitted as typed effects. The terminal never pretends
//! that storage succeeded or that a presentation was delivered.

use std::collections::BTreeMap;
use std::error::Error;
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;
use std::sync::Arc;

use er_env::current::{CurrentExternalEvent, CurrentGameSession};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::GameKernelRoleV7;
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_state::m7_state::ProfileStateV1;
use er_types::{InputFocus, PhysicalKey, RawInputEvent, SafeU53, SeatId};
use serde::de::DeserializeOwned;
use serde_json::json;

use crate::m72::{BoundedLineStatusV1, read_bounded_jsonl_line_v1};

type Options = BTreeMap<String, String>;
const MAXIMUM_EVENT_BYTES: usize = 4 << 20;

pub(crate) fn read_json<T: DeserializeOwned>(
    path: &Path,
    maximum: usize,
) -> Result<T, Box<dyn Error>> {
    Ok(serde_json::from_slice(&read_bytes(path, maximum)?)?)
}

fn read_bytes(path: &Path, maximum: usize) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take((maximum + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > maximum {
        return Err("current command input exceeds its byte limit".into());
    }
    Ok(bytes)
}

/// Validate canonical save bytes and their state against the selected current content.
pub fn validate_save(options: &Options) -> Result<(), Box<dyn Error>> {
    let content = content(options)?;
    let path = crate::option_path(options, "save", "ER_M9_SAVE")?;
    let save = er_save::m9e_save_v2::GameSaveV2::decode(&read_bytes(&path, 8 << 20)?)?;
    if save.content_identity != *content.identity() {
        return Err("current save content identity differs from prepared content".into());
    }
    save.state.validate_with(content.as_ref())?;
    crate::write_line(&serde_json::to_string(&json!({
        "kernel_version": 7, "save_schema_version": save.schema_version,
        "validation": "CANONICAL_SAVE_AND_CURRENT_CONTENT_STATE",
        "valid": true, "content_identity": content.identity(),
        "generation": save.generation, "checksum": save.checksum,
        "active_run": save.state.active_run.is_some()
    }))?)
}

fn content(options: &Options) -> Result<Arc<PreparedGameContentV2>, Box<dyn Error>> {
    let path = crate::option_path(options, "content", "ER_M9_CONTENT")?;
    let bundle: GameContentBundleV2 = read_json(&path, 64 << 20)?;
    Ok(Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?))
}

fn seat(options: &Options) -> Result<SeatId, Box<dyn Error>> {
    let value = options
        .get("seat")
        .map_or(Ok(1), |value| value.parse::<u64>())?;
    Ok(SeatId::new(SafeU53::new(value)?))
}

fn restored(options: &Options) -> Result<CurrentGameSession, Box<dyn Error>> {
    let content = content(options)?;
    let path = crate::option_path(options, "snapshot", "ER_M9_SNAPSHOT")?;
    let snapshot: CoreGameKernelSnapshotV7 = read_json(&path, 8 << 20)?;
    let role = match options
        .get("role")
        .map(String::as_str)
        .unwrap_or("AUTHORITY")
    {
        "AUTHORITY" => GameKernelRoleV7::Authority,
        "REPLICA" => GameKernelRoleV7::Replica,
        _ => return Err("role must be AUTHORITY or REPLICA".into()),
    };
    Ok(CurrentGameSession::from_snapshot(
        snapshot,
        seat(options)?,
        role,
        content,
    )?)
}

pub fn new_run(options: &Options) -> Result<(), Box<dyn Error>> {
    if options.contains_key("state") || options.contains_key("mode") {
        return Err("current new-run starts at Title; choose the mode through raw input; historical state injection requires new-run-v6".into());
    }
    let content = content(options)?;
    let path = crate::option_path(options, "profile", "ER_M9_PROFILE")?;
    let profile: ProfileStateV1 = read_json(&path, 4 << 20)?;
    let seed = options
        .get("seed")
        .ok_or("new-run requires --seed")?
        .clone();
    let save_slot = options
        .get("save-slot")
        .filter(|slot| !slot.is_empty())
        .ok_or("new-run requires a nonempty --save-slot")?
        .clone();
    play(CurrentGameSession::natural_start(
        profile,
        seed,
        seat(options)?,
        vec![save_slot],
        true,
        content,
        None,
    )?)
}

pub fn resume(options: &Options) -> Result<(), Box<dyn Error>> {
    play(restored(options)?)
}

pub fn simulate(options: &Options) -> Result<(), Box<dyn Error>> {
    let mut session = restored(options)?;
    let steps = options
        .get("steps")
        .map_or(Ok(1), |value| value.parse::<u64>())?;
    if steps > 100_000 {
        return Err("simulate permits at most 100000 virtual-time steps per invocation".into());
    }
    let milliseconds = SafeU53::new(
        options
            .get("milliseconds")
            .map_or(Ok(1), |value| value.parse::<u64>())?,
    )?;
    for position in 1..=steps {
        let step = session.apply(CurrentExternalEvent::AdvanceTime { milliseconds })?;
        crate::write_line(&serde_json::to_string(
            &json!({"position": position, "step": step}),
        )?)?;
    }
    crate::write_line(&serde_json::to_string(&json!({
        "steps": steps, "observation": session.observe()?, "snapshot": session.snapshot()?
    }))?)
}

pub fn inspect_content(options: &Options) -> Result<(), Box<dyn Error>> {
    let content = content(options)?;
    let bundle = content.bundle();
    crate::write_line(&serde_json::to_string(&json!({
        "kernel_version": 7,
        "content_identity": content.identity(),
        "species": bundle.battle.species.iter().flatten().count(),
        "moves": bundle.battle.moves.iter().flatten().count(),
        "abilities": bundle.battle.abilities.iter().flatten().count(),
        "bootstrap_modes": bundle.bootstrap.modes.len()
    }))?)
}

fn play(mut session: CurrentGameSession) -> Result<(), Box<dyn Error>> {
    let stdin = io::stdin();
    let mut reader = stdin.lock();
    let mut bytes = Vec::new();
    loop {
        crate::write_line(&serde_json::to_string(
            &json!({"observation": session.observe()?}),
        )?)?;
        match read_bounded_jsonl_line_v1(&mut reader, &mut bytes, MAXIMUM_EVENT_BYTES)? {
            BoundedLineStatusV1::Eof => return Ok(()),
            BoundedLineStatusV1::Oversized => return Err("terminal input exceeds 4 MiB".into()),
            BoundedLineStatusV1::Line => {}
        }
        let line = std::str::from_utf8(&bytes)?;
        if line == "quit" || line == "q" {
            session.dispose();
            return Ok(());
        }
        if line == "snapshot" {
            crate::write_line(&serde_json::to_string(
                &json!({"snapshot": session.snapshot()?}),
            )?)?;
            continue;
        }
        let events = if line.trim_start().starts_with('{') {
            vec![serde_json::from_str::<CurrentExternalEvent>(line)?]
        } else {
            let key = crate::terminal_key(line)?;
            vec![
                CurrentExternalEvent::RawInput {
                    input: RawInputEvent::KeyDown {
                        printable: matches!(key, PhysicalKey::Space),
                        code: key.clone(),
                        browser_repeat: false,
                        focus: InputFocus::Game,
                    },
                },
                CurrentExternalEvent::RawInput {
                    input: RawInputEvent::KeyUp { code: key },
                },
            ]
        };
        for event in events {
            let step = session.apply(event)?;
            crate::write_line(&serde_json::to_string(&json!({"step": step}))?)?;
        }
    }
}

/// Replay the complete current event suffix with quarantined platform effects.
pub fn replay(options: &Options) -> Result<(), Box<dyn Error>> {
    replay_result(options, false)
}

/// Successful validation includes isolated replay, not just schema admission.
pub fn validate_capsule(options: &Options) -> Result<(), Box<dyn Error>> {
    replay_result(options, true)
}

fn replay_result(options: &Options, report_validation: bool) -> Result<(), Box<dyn Error>> {
    let content = content(options)?;
    let path = crate::option_path(options, "capsule", "ER_M9_REPRO")?;
    let capsule: er_repro::current::CurrentReproCapsuleV1 = read_json(&path, MAXIMUM_EVENT_BYTES)?;
    let session = er_repro::current::replay_current_capsule_v1(
        &capsule,
        content,
        er_repro::current::CurrentReproLimitsV1::default(),
    )?;
    let mut result = json!({
        "kernel_version": 7, "processed_attempts": capsule.attempts.len(),
        "base_position": capsule.base_position, "final_position": capsule.final_position,
        "snapshot_digest": capsule.final_snapshot_digest,
        "observation": session.observe()?, "snapshot": session.snapshot()?
    });
    if report_validation {
        result["validation"] = json!("ISOLATED_CURRENT_CAPSULE_REPLAY");
        result["schema_valid"] = json!(true);
        result["replay_valid"] = json!(true);
    }
    let result = serde_json::to_string(&result)?;
    if result.len() > MAXIMUM_EVENT_BYTES {
        return Err("current replay result exceeds 4 MiB".into());
    }
    crate::write_line(&result)
}
