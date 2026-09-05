//! Concrete warm JSONL laboratory for natural bootstrap and validated/restored sessions.

use std::collections::BTreeMap;
use std::io::{self, Write};
use std::sync::Arc;

use er_agent_protocol::{
    AgentDispatchErrorV1, AgentDispatcherV1, AgentErrorCodeV1, AgentJsonlServerV1,
    AgentProtocolLimitsV1,
};
use er_env::GameEnvironment;
use er_game::m7_content::PreparedGameContentV1;
use er_game::m72_bootstrap::{BootstrapCatalogV1, RunBootstrapMachineV1};
use er_kernel::snapshot_v6::RestorableKernelSnapshotV6;
use er_lab::{
    LabSearchIndexV1, ScenarioPresetIdV1, ScenarioReachabilityV1, SearchDocumentKindV1,
    SearchDocumentV1, SearchQueryV1, StateQueryV1, describe_control_v1, explain_control_option_v1,
    plan_navigation_v1, query_state_v1,
};
use er_types::{GameBehaviorUnitId, RawInputEvent, SeatId};
use serde::Deserialize;

use crate::m72::{BoundedLineStatusV1, read_bounded_jsonl_line_v1};

#[derive(Debug)]
enum WarmCliSessionV1 {
    Bootstrap(Box<RunBootstrapMachineV1>),
    Game(Box<GameEnvironment>),
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
enum WarmCliStartV1 {
    Natural {
        profile: er_state::m7_state::ProfileStateV1,
        seed: String,
        owner_seat: SeatId,
        catalog: BootstrapCatalogV1,
    },
    Snapshot {
        snapshot: RestorableKernelSnapshotV6,
    },
    Scenario {
        snapshot: RestorableKernelSnapshotV6,
        provenance: ScenarioReachabilityV1,
    },
    Preset {
        id: ScenarioPresetIdV1,
        snapshot: RestorableKernelSnapshotV6,
        provenance: ScenarioReachabilityV1,
    },
    Capsule {
        capsule_digest: String,
        snapshot: RestorableKernelSnapshotV6,
    },
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateParamsV1 {
    session: String,
    start: WarmCliStartV1,
}

#[derive(Debug)]
struct WarmCliDispatcherV1 {
    content: Arc<PreparedGameContentV1>,
    search: LabSearchIndexV1,
    maximum_sessions: usize,
    sessions: BTreeMap<String, WarmCliSessionV1>,
}

impl WarmCliDispatcherV1 {
    fn new(
        content: Arc<PreparedGameContentV1>,
        maximum_sessions: usize,
    ) -> Result<Self, AgentDispatchErrorV1> {
        let documents = content
            .bundle()
            .meta
            .classifications
            .iter()
            .map(|classification| SearchDocumentV1 {
                kind: SearchDocumentKindV1::Behavior,
                stable_id: classification.behavior.as_str().to_owned(),
                name: classification.behavior.as_str().to_owned(),
                description: format!("{:?}", classification.status),
                tags: vec![format!("{:?}", classification.status).to_ascii_lowercase()],
                detail: Vec::new(),
            })
            .collect();
        let search = LabSearchIndexV1::new(content.identity().clone(), documents, 100_000, 1_000)
            .map_err(backend_error)?;
        Ok(Self {
            content,
            search,
            maximum_sessions,
            sessions: BTreeMap::new(),
        })
    }

    fn session_id(params: &serde_json::Value) -> Result<&str, AgentDispatchErrorV1> {
        params
            .get("session")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| invalid_request("missing session"))
    }

    fn snapshot_state(
        &self,
        session: &str,
    ) -> Result<er_state::m7_state::GameStateV5, AgentDispatchErrorV1> {
        match self
            .sessions
            .get(session)
            .ok_or_else(|| backend_error("session missing"))?
        {
            WarmCliSessionV1::Bootstrap(machine) => Ok(er_state::m7_state::GameStateV5 {
                schema_version: er_state::m7_state::GAME_STATE_SCHEMA_VERSION_V5,
                content_identity: self.content.identity().clone(),
                profile: machine.profile.clone(),
                active_run: None,
            }),
            WarmCliSessionV1::Game(environment) => Ok(environment.snapshot().game_state),
        }
    }

    fn control(&self, session: &str) -> Result<er_types::GameControlPlanV2, AgentDispatchErrorV1> {
        match self
            .sessions
            .get(session)
            .ok_or_else(|| backend_error("session missing"))?
        {
            WarmCliSessionV1::Bootstrap(machine) => Ok(machine.control.clone()),
            WarmCliSessionV1::Game(environment) => environment
                .snapshot()
                .game_state
                .active_run
                .map(|run| run.control)
                .ok_or_else(|| backend_error("session has no active control")),
        }
    }
}

impl AgentDispatcherV1 for WarmCliDispatcherV1 {
    fn dispatch(
        &mut self,
        method: &str,
        params: &serde_json::Value,
    ) -> Result<serde_json::Value, AgentDispatchErrorV1> {
        match method {
            "protocol.hello" => Ok(serde_json::json!({
                "protocol_version": 1,
                "warm": true,
                "start_modes": ["NATURAL", "SCENARIO", "PRESET", "SNAPSHOT", "CAPSULE"],
                "input_boundary": "RAW_PHYSICAL_INPUT"
            })),
            "session.create" => {
                let request: CreateParamsV1 = serde_json::from_value(params.clone())
                    .map_err(|error| invalid_request(&error.to_string()))?;
                if request.session.is_empty()
                    || self.sessions.contains_key(&request.session)
                    || self.sessions.len() == self.maximum_sessions
                {
                    return Err(backend_error("session identity or capacity"));
                }
                let session = match request.start {
                    WarmCliStartV1::Natural {
                        profile,
                        seed,
                        owner_seat,
                        catalog,
                    } => WarmCliSessionV1::Bootstrap(Box::new(
                        RunBootstrapMachineV1::new(profile, seed, owner_seat, catalog)
                            .map_err(backend_error)?,
                    )),
                    WarmCliStartV1::Snapshot { snapshot } => WarmCliSessionV1::Game(Box::new(
                        GameEnvironment::from_snapshot(snapshot, Arc::clone(&self.content))
                            .map_err(backend_error)?,
                    )),
                    WarmCliStartV1::Scenario {
                        snapshot,
                        provenance,
                    } => {
                        if matches!(
                            provenance,
                            ScenarioReachabilityV1::InvalidNegativeTest { .. }
                        ) {
                            return Err(backend_error("invalid-negative scenario cannot start"));
                        }
                        WarmCliSessionV1::Game(Box::new(
                            GameEnvironment::from_snapshot(snapshot, Arc::clone(&self.content))
                                .map_err(backend_error)?,
                        ))
                    }
                    WarmCliStartV1::Preset {
                        id,
                        snapshot,
                        provenance,
                    } => {
                        if id.0.is_empty()
                            || matches!(
                                provenance,
                                ScenarioReachabilityV1::InvalidNegativeTest { .. }
                            )
                        {
                            return Err(backend_error("invalid preset"));
                        }
                        WarmCliSessionV1::Game(Box::new(
                            GameEnvironment::from_snapshot(snapshot, Arc::clone(&self.content))
                                .map_err(backend_error)?,
                        ))
                    }
                    WarmCliStartV1::Capsule {
                        capsule_digest,
                        snapshot,
                    } => {
                        if capsule_digest.is_empty() {
                            return Err(backend_error("invalid capsule identity"));
                        }
                        WarmCliSessionV1::Game(Box::new(
                            GameEnvironment::from_snapshot(snapshot, Arc::clone(&self.content))
                                .map_err(backend_error)?,
                        ))
                    }
                };
                self.sessions.insert(request.session.clone(), session);
                Ok(serde_json::json!({ "session": request.session }))
            }
            "session.raw_input" => {
                let session = Self::session_id(params)?.to_owned();
                let input: RawInputEvent = serde_json::from_value(
                    params
                        .get("input")
                        .cloned()
                        .ok_or_else(|| invalid_request("missing input"))?,
                )
                .map_err(|error| invalid_request(&error.to_string()))?;
                match self
                    .sessions
                    .get_mut(&session)
                    .ok_or_else(|| backend_error("session missing"))?
                {
                    WarmCliSessionV1::Bootstrap(machine) => {
                        machine.raw_input(input).map_err(backend_error)?;
                        serde_json::to_value(machine).map_err(backend_error)
                    }
                    WarmCliSessionV1::Game(environment) => {
                        let effects = environment.raw_input(input).map_err(backend_error)?;
                        Ok(serde_json::json!({
                            "effect_count": effects.len(),
                            "observation": environment.observe().map_err(backend_error)?
                        }))
                    }
                }
            }
            "session.advance_time" => {
                let session = Self::session_id(params)?.to_owned();
                let milliseconds = params
                    .get("milliseconds")
                    .and_then(serde_json::Value::as_u64)
                    .ok_or_else(|| invalid_request("missing milliseconds"))?;
                match self
                    .sessions
                    .get_mut(&session)
                    .ok_or_else(|| backend_error("session missing"))?
                {
                    WarmCliSessionV1::Bootstrap(_) => {
                        Err(backend_error("bootstrap has no virtual timers"))
                    }
                    WarmCliSessionV1::Game(environment) => {
                        let duration =
                            er_types::SafeU53::new(milliseconds).map_err(backend_error)?;
                        let effects = environment.advance_time(duration).map_err(backend_error)?;
                        Ok(serde_json::json!({
                            "effect_count": effects.len(),
                            "observation": environment.observe().map_err(backend_error)?
                        }))
                    }
                }
            }
            "session.observe" => {
                let session = Self::session_id(params)?;
                match self
                    .sessions
                    .get(session)
                    .ok_or_else(|| backend_error("session missing"))?
                {
                    WarmCliSessionV1::Bootstrap(machine) => {
                        serde_json::to_value(machine).map_err(backend_error)
                    }
                    WarmCliSessionV1::Game(environment) => {
                        serde_json::to_value(environment.observe().map_err(backend_error)?)
                            .map_err(backend_error)
                    }
                }
            }
            "session.snapshot" => {
                let session = Self::session_id(params)?;
                match self
                    .sessions
                    .get(session)
                    .ok_or_else(|| backend_error("session missing"))?
                {
                    WarmCliSessionV1::Bootstrap(machine) => {
                        serde_json::to_value(machine).map_err(backend_error)
                    }
                    WarmCliSessionV1::Game(environment) => {
                        serde_json::to_value(environment.snapshot()).map_err(backend_error)
                    }
                }
            }
            "session.close" => {
                let session = Self::session_id(params)?.to_owned();
                self.sessions
                    .remove(&session)
                    .ok_or_else(|| backend_error("session missing"))?;
                Ok(serde_json::json!({ "closed": session }))
            }
            "content.search" | "behavior.search" => {
                let query: SearchQueryV1 = serde_json::from_value(params.clone())
                    .map_err(|error| invalid_request(&error.to_string()))?;
                serde_json::to_value(self.search.search(query).map_err(backend_error)?)
                    .map_err(backend_error)
            }
            "state.query" | "state.inspect" | "state.delta" => {
                let session = Self::session_id(params)?;
                let query: StateQueryV1 = serde_json::from_value(
                    params
                        .get("query")
                        .cloned()
                        .unwrap_or_else(|| serde_json::json!({"kind":"RUN"})),
                )
                .map_err(|error| invalid_request(&error.to_string()))?;
                serde_json::to_value(
                    query_state_v1(&self.snapshot_state(session)?, query, 1 << 20)
                        .map_err(backend_error)?,
                )
                .map_err(backend_error)
            }
            "control.describe" => {
                let session = Self::session_id(params)?;
                serde_json::to_value(
                    describe_control_v1(&self.control(session)?).map_err(backend_error)?,
                )
                .map_err(backend_error)
            }
            "control.plan_navigation" => {
                let session = Self::session_id(params)?;
                let control = self.control(session)?;
                let menu = control
                    .menu
                    .ok_or_else(|| backend_error("control has no menu"))?;
                let target = er_types::MenuOptionId::new(
                    params
                        .get("target")
                        .and_then(serde_json::Value::as_str)
                        .ok_or_else(|| invalid_request("missing target"))?,
                )
                .map_err(backend_error)?;
                let logical = menu.logical_menu().map_err(backend_error)?;
                serde_json::to_value(
                    plan_navigation_v1(
                        &logical,
                        logical.instance_id,
                        target,
                        params
                            .get("submit")
                            .and_then(serde_json::Value::as_bool)
                            .unwrap_or(false),
                        4096,
                    )
                    .map_err(backend_error)?,
                )
                .map_err(backend_error)
            }
            "control.explain_option" | "control.explain" => {
                let session = Self::session_id(params)?;
                let control = self.control(session)?;
                let menu = control
                    .menu
                    .as_ref()
                    .ok_or_else(|| backend_error("control has no menu"))?;
                let option = er_types::MenuOptionId::new(
                    params
                        .get("option")
                        .and_then(serde_json::Value::as_str)
                        .ok_or_else(|| invalid_request("missing option"))?,
                )
                .map_err(backend_error)?;
                let evidence = explain_control_option_v1(
                    &control,
                    menu.instance_id.get().get(),
                    option,
                    BTreeMap::new(),
                    Vec::<GameBehaviorUnitId>::new(),
                )
                .map_err(backend_error)?;
                serde_json::to_value(evidence).map_err(backend_error)
            }
            "lab.health" | "lab.resources" => Ok(serde_json::json!({
                "sessions": self.sessions.len(),
                "maximum_sessions": self.maximum_sessions,
                "content_hash": self.content.identity().content_hash.as_str(),
                "search_documents": self.search.document_count()
            })),
            _ => Err(AgentDispatchErrorV1 {
                code: AgentErrorCodeV1::BackendError,
                message: format!("method {method} requires a configured experiment backend"),
            }),
        }
    }
}

pub fn run_warm_agent_v1(
    content: Arc<PreparedGameContentV1>,
    maximum_sessions: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    let dispatcher = WarmCliDispatcherV1::new(content, maximum_sessions)
        .map_err(|error| std::io::Error::other(error.message))?;
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
    server.close();
    Ok(())
}

fn invalid_request(message: &str) -> AgentDispatchErrorV1 {
    AgentDispatchErrorV1 {
        code: AgentErrorCodeV1::InvalidRequest,
        message: message.to_owned(),
    }
}

fn backend_error(error: impl ToString) -> AgentDispatchErrorV1 {
    AgentDispatchErrorV1 {
        code: AgentErrorCodeV1::BackendError,
        message: error.to_string(),
    }
}
