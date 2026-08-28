//! Terminal adapter for the M7 headless environment.

use std::collections::BTreeMap;
use std::env;
use std::error::Error;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use er_env::{EnvironmentKernelComponentsV1, GameEnvironment};
use er_game::m7_content::{GameContentBundleV1, PreparedGameContentV1};
use er_kernel::snapshot::{InputRouterSnapshotV2, KernelSchedulerSnapshotV2};
use er_kernel::snapshot_v6::RestorableKernelSnapshotV6;
use er_save::{GameReplayV1, GameSaveV1};
use er_state::m7_state::GameStateV5;
use er_types::{InputFocus, PhysicalKey, RawInputEvent, SafeU53};

fn main() -> Result<(), Box<dyn Error>> {
    let mut arguments = env::args().skip(1);
    let command = arguments.next().ok_or("missing command")?;
    let options = parse_options(arguments)?;
    match command.as_str() {
        "new-run" => new_run(&options),
        "resume" => resume(&options),
        "replay" => validate_replay(&options),
        "validate-save" => validate_save(&options),
        "simulate" => simulate(&options),
        "inspect-content" => inspect_content(&options),
        _ => Err(format!("unknown er-cli command {command}").into()),
    }
}

fn parse_options(
    arguments: impl Iterator<Item = String>,
) -> Result<BTreeMap<String, String>, Box<dyn Error>> {
    let values: Vec<_> = arguments.collect();
    if values.len() % 2 != 0 {
        return Err("CLI options must be --name value pairs".into());
    }
    let mut options = BTreeMap::new();
    for pair in values.chunks_exact(2) {
        let key = pair[0]
            .strip_prefix("--")
            .ok_or("CLI option names must start with --")?;
        if options.insert(key.to_owned(), pair[1].clone()).is_some() {
            return Err(format!("duplicate CLI option --{key}").into());
        }
    }
    Ok(options)
}

fn new_run(options: &BTreeMap<String, String>) -> Result<(), Box<dyn Error>> {
    let content = load_content(options)?;
    let state_path = option_path(options, "state", "ER_M7_NEW_RUN_STATE")?;
    let state: GameStateV5 = decode_file(&state_path)?;
    if let Some(mode) = options.get("mode") {
        let actual = state
            .active_run
            .as_ref()
            .map(|run| run.mode.to_string())
            .ok_or("new-run state has no active run")?;
        if mode != "classic" && mode != &actual {
            return Err(format!("requested mode {mode} does not match state mode {actual}").into());
        }
    }
    if let Some(seed) = options.get("seed") {
        let actual = &state
            .active_run
            .as_ref()
            .ok_or("new-run state has no active run")?
            .seed;
        if actual != seed {
            return Err("requested seed does not match canonical new-run state".into());
        }
    }
    let environment = GameEnvironment::new_run(state, content, offline_components())?;
    play(environment)
}

fn resume(options: &BTreeMap<String, String>) -> Result<(), Box<dyn Error>> {
    let content = load_content(options)?;
    let snapshot_path = option_path(options, "snapshot", "ER_M7_SNAPSHOT")?;
    let snapshot: RestorableKernelSnapshotV6 = decode_file(&snapshot_path)?;
    let environment = GameEnvironment::from_snapshot(snapshot, content)?;
    play(environment)
}

fn validate_replay(options: &BTreeMap<String, String>) -> Result<(), Box<dyn Error>> {
    let content = load_content(options)?;
    let replay_path = option_path(options, "replay", "ER_M7_REPLAY")?;
    let replay: GameReplayV1 = decode_file(&replay_path)?;
    replay.validate(content.identity())?;
    write_line(&format!(
        "valid replay: {} events, content {}",
        replay.events.len(),
        replay.game_content_hash
    ))
}

fn validate_save(options: &BTreeMap<String, String>) -> Result<(), Box<dyn Error>> {
    let content = load_content(options)?;
    let save_path = option_path(options, "save", "ER_M7_SAVE")?;
    let bytes = fs::read(save_path)?;
    let save = GameSaveV1::decode_canonical(&bytes, content.identity())?;
    write_line(&format!(
        "valid save: active_run={}, checksum={}",
        save.run.is_some(),
        save.checksum
    ))
}

fn simulate(options: &BTreeMap<String, String>) -> Result<(), Box<dyn Error>> {
    let content = load_content(options)?;
    let snapshot_path = option_path(options, "snapshot", "ER_M7_SNAPSHOT")?;
    let steps: u64 = options
        .get("steps")
        .map_or(Ok(1_u64), |value| value.parse())?;
    let snapshot: RestorableKernelSnapshotV6 = decode_file(&snapshot_path)?;
    let mut environment = GameEnvironment::from_snapshot(snapshot, content)?;
    for _ in 0..steps {
        environment.advance_time(SafeU53::new(1)?)?;
    }
    let observation = environment.observe()?;
    write_line(&format!(
        "simulation complete: steps={steps}, digest={}",
        observation.mechanical_digest
    ))
}

fn inspect_content(options: &BTreeMap<String, String>) -> Result<(), Box<dyn Error>> {
    let content = load_content(options)?;
    let bundle = content.bundle();
    write_line(&format!(
        "content={} oracle={} species={} moves={} abilities={} run_programs={} scenarios={} modes={}",
        content.identity().content_hash,
        bundle.oracle_sha.as_str(),
        bundle.battle.species.iter().flatten().count(),
        bundle.battle.moves.iter().flatten().count(),
        bundle.battle.abilities.iter().flatten().count(),
        bundle.run.programs.len(),
        bundle.scenarios.graphs.len(),
        bundle.world.modes.len(),
    ))
}

fn load_content(
    options: &BTreeMap<String, String>,
) -> Result<Arc<PreparedGameContentV1>, Box<dyn Error>> {
    let path = option_path(options, "content", "ER_M7_CONTENT")?;
    let bundle: GameContentBundleV1 = decode_file(&path)?;
    Ok(Arc::new(PreparedGameContentV1::prepare(Arc::new(bundle))?))
}

fn option_path(
    options: &BTreeMap<String, String>,
    key: &str,
    environment: &str,
) -> Result<PathBuf, Box<dyn Error>> {
    options
        .get(key)
        .cloned()
        .or_else(|| env::var(environment).ok())
        .map(PathBuf::from)
        .ok_or_else(|| format!("missing --{key} and {environment}").into())
}

fn decode_file<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, Box<dyn Error>> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn offline_components() -> EnvironmentKernelComponentsV1 {
    EnvironmentKernelComponentsV1 {
        input_router: InputRouterSnapshotV2 {
            focus: InputFocus::Game,
            pressed: Vec::new(),
            suppressed_printable_keys: Vec::new(),
            held_buttons: Vec::new(),
            locks: Vec::new(),
            repeats: Vec::new(),
            disposed: false,
        },
        scheduler: KernelSchedulerSnapshotV2 {
            next_timer_id: None,
            timers: Vec::new(),
            pauses: Vec::new(),
            disposed: false,
        },
        protocol: None,
        replay_sequence: SafeU53::ZERO,
        terminal: None,
    }
}

fn play(mut environment: GameEnvironment) -> Result<(), Box<dyn Error>> {
    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    loop {
        let observation = environment.observe()?;
        let actions = environment
            .legal_actions()
            .into_iter()
            .map(|action| action.option.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        write_line(&format!(
            "control={:?} selected={:?} actions=[{}] digest={}",
            observation.control,
            observation.selected_option,
            actions,
            observation.mechanical_digest
        ))?;
        if observation.terminal {
            return Ok(());
        }
        let Some(line) = lines.next() else {
            return Ok(());
        };
        let line = line?;
        if line == "quit" || line == "q" {
            return Ok(());
        }
        let key = terminal_key(&line)?;
        for event in [
            RawInputEvent::KeyDown {
                code: key.clone(),
                printable: matches!(key, PhysicalKey::Space),
                browser_repeat: false,
                focus: InputFocus::Game,
            },
            RawInputEvent::KeyUp { code: key },
        ] {
            for effect in environment.raw_input(event)? {
                write_line(&format!("effect={effect:?}"))?;
            }
        }
    }
}

fn terminal_key(value: &str) -> Result<PhysicalKey, Box<dyn Error>> {
    match value {
        "up" | "w" => Ok(PhysicalKey::ArrowUp),
        "down" | "s" => Ok(PhysicalKey::ArrowDown),
        "left" | "a" => Ok(PhysicalKey::ArrowLeft),
        "right" | "d" => Ok(PhysicalKey::ArrowRight),
        "enter" | "e" => Ok(PhysicalKey::Enter),
        "space" | " " => Ok(PhysicalKey::Space),
        "back" | "escape" => Ok(PhysicalKey::Escape),
        _ => Err(format!("unknown terminal key {value}").into()),
    }
}

fn write_line(value: &str) -> Result<(), Box<dyn Error>> {
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "{value}")?;
    stdout.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_commands_map_only_to_physical_keys() {
        assert_eq!(terminal_key("w").expect("up"), PhysicalKey::ArrowUp);
        assert_eq!(terminal_key("s").expect("down"), PhysicalKey::ArrowDown);
        assert_eq!(terminal_key("a").expect("left"), PhysicalKey::ArrowLeft);
        assert_eq!(terminal_key("d").expect("right"), PhysicalKey::ArrowRight);
        assert_eq!(terminal_key("space").expect("space"), PhysicalKey::Space);
        assert_eq!(terminal_key("escape").expect("escape"), PhysicalKey::Escape);
        assert!(terminal_key("select-reward").is_err());
        assert!(terminal_key("resolve-turn").is_err());
    }

    #[test]
    fn cli_options_reject_duplicates_and_unpaired_values() {
        let options = parse_options(
            ["--content", "content.json", "--state", "state.json"]
                .into_iter()
                .map(str::to_owned),
        )
        .expect("options");
        assert_eq!(
            options.get("content").map(String::as_str),
            Some("content.json")
        );
        assert!(parse_options(["--content"].into_iter().map(str::to_owned)).is_err());
        assert!(
            parse_options(
                ["--content", "a", "--content", "b"]
                    .into_iter()
                    .map(str::to_owned),
            )
            .is_err()
        );
    }
}
