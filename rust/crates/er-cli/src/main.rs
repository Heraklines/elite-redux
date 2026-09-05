//! Current V7 terminal and agent entries, with explicit historical compatibility.

mod current_agent;
mod current_batch_agent;
mod current_commands;
mod current_worker_agent;
mod m72;
mod m72_lab;

use std::collections::BTreeMap;
use std::env;
use std::error::Error;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use er_agent_protocol::{
    AgentDispatchErrorV1, AgentDispatcherV1, AgentErrorCodeV1, AgentJsonlServerV1,
    AgentProtocolLimitsV1,
};
use er_env::{EnvironmentKernelComponentsV1, GameEnvironment};
use er_game::m7_content::{GameContentBundleV1, PreparedGameContentV1};
use er_kernel::snapshot::{InputRouterSnapshotV2, KernelSchedulerSnapshotV2};
use er_kernel::snapshot_v6::RestorableKernelSnapshotV6;
use er_repro::{CapsuleLimitsV1, ReproCapsuleV1};
use er_save::{GameReplayV1, GameSaveV1};
use er_state::m7_state::GameStateV5;
use er_types::{InputFocus, PhysicalKey, RawInputEvent, SafeU53};
use m72::{BoundedLineStatusV1, read_bounded_file_v1, read_bounded_jsonl_line_v1};

fn main() -> Result<(), Box<dyn Error>> {
    let mut arguments = env::args().skip(1);
    let command = arguments.next().ok_or("missing command")?;
    let options = parse_options(arguments)?;
    match command.as_str() {
        "new-run" => current_commands::new_run(&options),
        "new-run-v6" => new_run(&options),
        "resume" => current_commands::resume(&options),
        "resume-v6" => resume(&options),
        "replay" => current_commands::replay(&options),
        "replay-v6" => validate_replay(&options),
        "validate-save" => validate_save(&options),
        "simulate" => current_commands::simulate(&options),
        "simulate-v6" => simulate(&options),
        "inspect-content" => current_commands::inspect_content(&options),
        "inspect-content-v6" => inspect_content(&options),
        "agent" => current_agent::run(&options),
        "agent-v6" => agent_jsonl(&options),
        "capsule-validate" => validate_capsule(&options),
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

fn agent_jsonl(options: &BTreeMap<String, String>) -> Result<(), Box<dyn Error>> {
    if options.get("protocol").map(String::as_str) != Some("jsonl") {
        return Err("agent requires --protocol jsonl".into());
    }
    let content = load_content(options)?;
    if options.get("warm").map(String::as_str) == Some("true") {
        let maximum_sessions = options
            .get("maximum-sessions")
            .map_or(Ok(256_usize), |value| value.parse())?;
        return m72_lab::run_warm_agent_v1(content, maximum_sessions);
    }
    let snapshot_path = option_path(options, "snapshot", "ER_M7_SNAPSHOT")?;
    let snapshot: RestorableKernelSnapshotV6 = decode_file(&snapshot_path)?;
    let environment = GameEnvironment::from_snapshot(snapshot, Arc::clone(&content))?;
    let dispatcher = CliAgentDispatcher {
        environment: Some(environment),
        content,
    };
    let mut server = AgentJsonlServerV1::new(
        dispatcher,
        AgentProtocolLimitsV1 {
            maximum_line_bytes: 1 << 20,
            maximum_inline_result_bytes: 64 << 10,
            maximum_artifact_bytes: 64 << 20,
            maximum_artifacts: 256,
            maximum_completed_request_ids: 16_384,
        },
    )?;
    let stdin = io::stdin();
    let mut reader = stdin.lock();
    let stdout = io::stdout();
    let mut writer = stdout.lock();
    let mut line = Vec::new();
    loop {
        let response = match read_bounded_jsonl_line_v1(&mut reader, &mut line, 1 << 20)? {
            BoundedLineStatusV1::Eof => break,
            BoundedLineStatusV1::Oversized => server.process_oversized_line()?,
            BoundedLineStatusV1::Line => server.process_line(&line)?,
        };
        writer.write_all(&response)?;
        writer.flush()?;
    }
    Ok(())
}

fn validate_capsule(options: &BTreeMap<String, String>) -> Result<(), Box<dyn Error>> {
    let root = option_path(options, "artifact-root", "ER_M72_ARTIFACT_ROOT")?;
    let relative = option_path(options, "capsule", "ER_M71_CAPSULE")?;
    let bytes = read_bounded_file_v1(&root, &relative, 261 << 20)?;
    let capsule = ReproCapsuleV1::decode(&bytes, cli_capsule_limits())?;
    write_line(&format!(
        "valid capsule: mode={:?}, blobs={}, oracle={:?}",
        capsule.manifest.mode,
        capsule.blobs.len(),
        capsule.manifest.failure_oracle
    ))
}

fn cli_capsule_limits() -> CapsuleLimitsV1 {
    CapsuleLimitsV1 {
        maximum_manifest_bytes: 4 << 20,
        maximum_blob_count: 4_096,
        maximum_blob_bytes: 64 << 20,
        maximum_total_stored_bytes: 256 << 20,
        maximum_total_decompressed_bytes: 512 << 20,
    }
}

#[derive(Debug)]
struct CliAgentDispatcher {
    environment: Option<GameEnvironment>,
    content: Arc<PreparedGameContentV1>,
}

impl CliAgentDispatcher {
    fn environment(&self) -> Result<&GameEnvironment, AgentDispatchErrorV1> {
        self.environment
            .as_ref()
            .ok_or_else(|| AgentDispatchErrorV1 {
                code: AgentErrorCodeV1::BackendError,
                message: "session is closed".to_owned(),
            })
    }

    fn environment_mut(&mut self) -> Result<&mut GameEnvironment, AgentDispatchErrorV1> {
        self.environment
            .as_mut()
            .ok_or_else(|| AgentDispatchErrorV1 {
                code: AgentErrorCodeV1::BackendError,
                message: "session is closed".to_owned(),
            })
    }
}

impl AgentDispatcherV1 for CliAgentDispatcher {
    fn dispatch(
        &mut self,
        method: &str,
        params: &serde_json::Value,
    ) -> Result<serde_json::Value, AgentDispatchErrorV1> {
        match method {
            "protocol.hello" => Ok(serde_json::json!({
                "protocol_version": 1,
                "topologies": ["SOLO"],
                "input_boundary": "RAW_PHYSICAL_INPUT"
            })),
            "session.create" => Ok(serde_json::json!({ "topology": "SOLO" })),
            "session.observe" | "session.state_delta" | "session.invariants" => {
                let observation = self.environment()?.observe().map_err(cli_backend_error)?;
                serde_json::to_value(observation).map_err(cli_backend_error)
            }
            "session.raw_input" => {
                let input = decode_param::<RawInputEvent>(params, "input")?;
                let effects = self
                    .environment_mut()?
                    .raw_input(input)
                    .map_err(cli_backend_error)?;
                let observation = self.environment()?.observe().map_err(cli_backend_error)?;
                Ok(serde_json::json!({
                    "effect_count": effects.len(),
                    "observation": observation
                }))
            }
            "session.advance_time" => {
                let milliseconds = decode_param::<u64>(params, "milliseconds")?;
                let duration = SafeU53::new(milliseconds).map_err(cli_backend_error)?;
                let effects = self
                    .environment_mut()?
                    .advance_time(duration)
                    .map_err(cli_backend_error)?;
                let observation = self.environment()?.observe().map_err(cli_backend_error)?;
                Ok(serde_json::json!({
                    "effect_count": effects.len(),
                    "observation": observation
                }))
            }
            "session.snapshot" | "session.checkpoint" => {
                serde_json::to_value(self.environment()?.snapshot()).map_err(cli_backend_error)
            }
            "session.restore" | "session.from_snapshot" => {
                let snapshot = decode_param::<RestorableKernelSnapshotV6>(params, "snapshot")?;
                let replacement =
                    GameEnvironment::from_snapshot(snapshot, Arc::clone(&self.content))
                        .map_err(cli_backend_error)?;
                self.environment = Some(replacement);
                Ok(serde_json::json!({ "restored": true }))
            }
            "session.close" => {
                self.environment = None;
                Ok(serde_json::json!({ "closed": true }))
            }
            _ => Err(AgentDispatchErrorV1 {
                code: AgentErrorCodeV1::BackendError,
                message: format!("method {method} requires a configured developer-plane backend"),
            }),
        }
    }
}

fn decode_param<T: serde::de::DeserializeOwned>(
    params: &serde_json::Value,
    name: &str,
) -> Result<T, AgentDispatchErrorV1> {
    let value = params
        .get(name)
        .cloned()
        .ok_or_else(|| AgentDispatchErrorV1 {
            code: AgentErrorCodeV1::InvalidRequest,
            message: format!("missing parameter {name}"),
        })?;
    serde_json::from_value(value).map_err(|error| AgentDispatchErrorV1 {
        code: AgentErrorCodeV1::InvalidRequest,
        message: error.to_string(),
    })
}

fn cli_backend_error(error: impl ToString) -> AgentDispatchErrorV1 {
    AgentDispatchErrorV1 {
        code: AgentErrorCodeV1::BackendError,
        message: error.to_string(),
    }
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
