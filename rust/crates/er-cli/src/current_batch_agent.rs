//! Native current batches share prepared content and publish only bounded results.
//! Worker generations currently own one session; that backend is rejected by the
//! dispatcher rather than silently creating one child process per environment.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use er_agent_protocol::{AgentDispatchErrorV1, AgentResponseContextV1};
use er_batch::current::{
    CurrentBatch, CurrentBatchEnvironmentId, CurrentBatchError, CurrentBatchEvent,
    CurrentBatchLimits,
};
use er_env::current::CurrentExternalEvent;
use er_game::m9e_content_v2::PreparedGameContentV2;
use er_repro::current::{CurrentReproCapsuleV1, CurrentReproLimitsV1, replay_current_capsule_v1};
use er_types::{RawInputEvent, SafeU53};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::current_agent::{CurrentStart, MAXIMUM_MESSAGE_BYTES, backend, bounded, invalid};

#[derive(Debug, Deserialize)]
enum CapsuleTag {
    #[serde(rename = "CAPSULE")]
    Capsule,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CapsuleStart {
    kind: CapsuleTag,
    capsule: Box<CurrentReproCapsuleV1>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum BatchStart {
    Current(CurrentStart),
    Capsule(CapsuleStart),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EnvironmentStart {
    environment: CurrentBatchEnvironmentId,
    start: BatchStart,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateRequest {
    batch: String,
    environments: Vec<EnvironmentStart>,
    #[serde(default)]
    limits: CurrentBatchLimits,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResetRequest {
    batch: String,
    environments: Vec<EnvironmentStart>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BatchRequest {
    batch: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadRequest {
    batch: String,
    environments: Vec<CurrentBatchEnvironmentId>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EventsRequest {
    batch: String,
    events: Vec<CurrentBatchEvent>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawInput {
    environment: CurrentBatchEnvironmentId,
    input: RawInputEvent,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRequest {
    batch: String,
    inputs: Vec<RawInput>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Advance {
    environment: CurrentBatchEnvironmentId,
    milliseconds: SafeU53,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AdvanceRequest {
    batch: String,
    advances: Vec<Advance>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ForkRequest {
    batch: String,
    source_environment: CurrentBatchEnvironmentId,
    target_environment: CurrentBatchEnvironmentId,
}

fn parse<T: serde::de::DeserializeOwned>(params: &Value) -> Result<T, AgentDispatchErrorV1> {
    serde_json::from_value(params.clone()).map_err(|error| invalid(&error.to_string()))
}

fn admit(context: AgentResponseContextV1<'_>, value: Value) -> Result<Value, AgentDispatchErrorV1> {
    let value = bounded(value)?;
    context.admit_inline_success(&value)?;
    Ok(value)
}

struct BatchCompletionError(AgentDispatchErrorV1);
impl From<CurrentBatchError> for BatchCompletionError {
    fn from(error: CurrentBatchError) -> Self {
        Self(backend(error))
    }
}

#[derive(Debug)]
pub(crate) struct CurrentBatches {
    content: Arc<PreparedGameContentV2>,
    entries: BTreeMap<String, CurrentBatch>,
}

impl CurrentBatches {
    pub(crate) fn new(content: Arc<PreparedGameContentV2>) -> Self {
        Self {
            content,
            entries: BTreeMap::new(),
        }
    }
    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }
    pub(crate) fn environment_count(&self) -> usize {
        self.entries.values().map(CurrentBatch::len).sum()
    }

    fn batch(&self, id: &str) -> Result<&CurrentBatch, AgentDispatchErrorV1> {
        self.entries
            .get(id)
            .ok_or_else(|| backend("current batch missing or closed"))
    }
    fn batch_mut(&mut self, id: &str) -> Result<&mut CurrentBatch, AgentDispatchErrorV1> {
        self.entries
            .get_mut(id)
            .ok_or_else(|| backend("current batch missing or closed"))
    }
    fn capacity(
        &self,
        standalone: usize,
        removed: usize,
        added: usize,
        maximum: usize,
    ) -> Result<(), AgentDispatchErrorV1> {
        let retained = self
            .environment_count()
            .checked_sub(removed)
            .and_then(|count| count.checked_add(standalone))
            .and_then(|count| count.checked_add(added));
        if retained.is_none_or(|count| count > maximum) {
            return Err(backend("current session capacity reached"));
        }
        Ok(())
    }
    fn prepare(
        &self,
        starts: Vec<EnvironmentStart>,
        limits: CurrentBatchLimits,
    ) -> Result<CurrentBatch, AgentDispatchErrorV1> {
        let mut batch = CurrentBatch::new(Arc::clone(&self.content), limits).map_err(backend)?;
        if starts.len() > limits.maximum_environments {
            return Err(backend("current batch environment capacity reached"));
        }
        let mut ids = BTreeSet::new();
        if starts.iter().any(|entry| !ids.insert(entry.environment)) {
            return Err(invalid("duplicate batch environment identity"));
        }
        for entry in starts {
            let session = match entry.start {
                BatchStart::Current(start) => start.into_session(Arc::clone(&self.content))?,
                BatchStart::Capsule(CapsuleStart {
                    kind: CapsuleTag::Capsule,
                    capsule,
                }) => {
                    // Validate and replay privately. Recorded effects are evidence,
                    // never output during environment construction.
                    replay_current_capsule_v1(
                        &capsule,
                        Arc::clone(&self.content),
                        CurrentReproLimitsV1::default(),
                    )
                    .map_err(backend)?
                }
            };
            batch.insert(entry.environment, session).map_err(backend)?;
        }
        Ok(batch)
    }
    fn execute(
        &mut self,
        id: &str,
        events: Vec<CurrentBatchEvent>,
        context: AgentResponseContextV1<'_>,
    ) -> Result<Value, AgentDispatchErrorV1> {
        self.batch_mut(id)?
            .execute_with(events, |_, results| {
                // Count the aggregate wrapper, escaped request ID and JSONL framing
                // before any staged environment or its effects are published.
                admit(
                    context,
                    json!({"batch": id, "kernel_version": 7, "results": results}),
                )
                .map_err(BatchCompletionError)
            })
            .map_err(|error: BatchCompletionError| error.0)
    }

    pub(crate) fn dispatch(
        &mut self,
        method: &str,
        params: &Value,
        standalone: usize,
        maximum: usize,
        context: AgentResponseContextV1<'_>,
    ) -> Result<Value, AgentDispatchErrorV1> {
        match method {
            "batch.create" => {
                let request: CreateRequest = parse(params)?;
                if request.batch.is_empty()
                    || request.batch.len() > 128
                    || self.entries.contains_key(&request.batch)
                {
                    return Err(invalid(
                        "batch identity is empty, too long, or already exists",
                    ));
                }
                if self.entries.len() >= maximum {
                    return Err(backend("current batch handle capacity reached"));
                }
                self.capacity(standalone, 0, request.environments.len(), maximum)?;
                let candidate = self.prepare(request.environments, request.limits)?;
                let response = admit(
                    context,
                    json!({"batch": request.batch, "kernel_version": 7,
                    "environments": candidate.environment_ids()}),
                )?;
                let _ = self.entries.insert(request.batch, candidate);
                Ok(response)
            }
            "batch.reset" => {
                let request: ResetRequest = parse(params)?;
                let original = self.batch(&request.batch)?;
                let limits = original.limits();
                self.capacity(
                    standalone,
                    original.len(),
                    request.environments.len(),
                    maximum,
                )?;
                let candidate = self.prepare(request.environments, limits)?;
                let response = admit(
                    context,
                    json!({"batch": request.batch, "kernel_version": 7,
                    "environments": candidate.environment_ids()}),
                )?;
                if let Some(mut previous) = self.entries.insert(request.batch, candidate) {
                    previous.dispose();
                }
                Ok(response)
            }
            "batch.events" => {
                let request: EventsRequest = parse(params)?;
                self.execute(&request.batch, request.events, context)
            }
            "batch.raw_input" => {
                let request: RawRequest = parse(params)?;
                self.execute(
                    &request.batch,
                    request
                        .inputs
                        .into_iter()
                        .map(|item| CurrentBatchEvent {
                            environment: item.environment,
                            event: CurrentExternalEvent::RawInput { input: item.input },
                        })
                        .collect(),
                    context,
                )
            }
            "batch.advance_time" => {
                let request: AdvanceRequest = parse(params)?;
                self.execute(
                    &request.batch,
                    request
                        .advances
                        .into_iter()
                        .map(|item| CurrentBatchEvent {
                            environment: item.environment,
                            event: CurrentExternalEvent::AdvanceTime {
                                milliseconds: item.milliseconds,
                            },
                        })
                        .collect(),
                    context,
                )
            }
            "batch.observe" | "batch.snapshot" => {
                let request: ReadRequest = parse(params)?;
                let batch = self.batch(&request.batch)?;
                if request.environments.len() > batch.limits().maximum_events {
                    return Err(backend("current batch read exceeds per-call capacity"));
                }
                let mut results = Vec::with_capacity(request.environments.len());
                let mut response_bytes = serde_json::to_vec(&json!({"batch": request.batch,
                    "kernel_version": 7, "results": []}))
                .map_err(backend)?
                .len();
                for environment in request.environments {
                    let value = if method == "batch.observe" {
                        json!({"environment": environment, "observation": batch.observe(environment).map_err(backend)?})
                    } else {
                        json!({"environment": environment, "snapshot": batch.snapshot(environment).map_err(backend)?})
                    };
                    response_bytes = response_bytes.saturating_add(
                        serde_json::to_vec(&value).map_err(backend)?.len()
                            + usize::from(!results.is_empty()),
                    );
                    if response_bytes > MAXIMUM_MESSAGE_BYTES {
                        return Err(backend(
                            "current batch read exceeds inline response capacity",
                        ));
                    }
                    results.push(value);
                }
                admit(
                    context,
                    json!({"batch": request.batch, "kernel_version": 7, "results": results}),
                )
            }
            "batch.fork" => {
                let request: ForkRequest = parse(params)?;
                self.batch(&request.batch)?;
                self.capacity(standalone, 0, 1, maximum)?;
                let response = admit(
                    context,
                    json!({"batch": request.batch, "kernel_version": 7,
                    "environment": request.target_environment}),
                )?;
                self.batch_mut(&request.batch)?
                    .fork(request.source_environment, request.target_environment)
                    .map_err(backend)?;
                Ok(response)
            }
            "batch.close" => {
                let request: BatchRequest = parse(params)?;
                self.batch(&request.batch)?;
                let response = admit(context, json!({"closed_batch": request.batch}))?;
                if let Some(mut batch) = self.entries.remove(&request.batch) {
                    batch.dispose();
                }
                Ok(response)
            }
            _ => Err(invalid("unsupported current batch method")),
        }
    }
}

impl Drop for CurrentBatches {
    fn drop(&mut self) {
        for batch in self.entries.values_mut() {
            batch.dispose();
        }
    }
}
