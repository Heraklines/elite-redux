//! Deterministic M6 release-profile benchmark workloads.
//!
//! Every workload drives real production seams only: the frozen M6 semantic
//! catalog through [`compile_semantics`]/routine mapping and
//! [`prepare_content`], the prepared and direct-reference Mechanics IR V2
//! executors, the closed bespoke handler routing, and the production
//! [`GameKernel`] raw physical-input battle path over published oracle
//! fixtures (solo singles plus two-endpoint co-op doubles).
//!
//! Design contract:
//! - Setup is separated from execution. Fixture parsing, content pack
//!   loading, kernel construction, and battle start happen before each timed
//!   region; the timed region measures execution only.
//! - Workloads are deterministic. Each run folds every observable output
//!   (state digests, RNG draw audits, presentation kinds, executor results,
//!   serialized snapshot bytes) into an ordered SHA-256 checksum, so a run
//!   that skips work or fabricates results cannot reproduce it.
//! - Debug-profile callers must not assert on timing. Release ceilings live
//!   in [`RELEASE_QUALIFICATION_CEILINGS_V1`] and are compared through typed
//!   [`QualificationReport`] values for the hosted workflow.
//!
//! This module is compiled both inside `er-sim` and directly into the
//! `er-testkit` M6 performance integration test through `#[path]`, so it may
//! depend only on crates shared by both dependency sets and must never name
//! its parent crate.
// Compiled both as an `er-sim` library module and directly into the
// `er-testkit` M6 performance integration test; helpers that are public API
// in the former can read as unused in the latter.
#![allow(dead_code)]

use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use er_battle::m6::bespoke::handlers_for;
use er_battle::m6::{
    MechanicsContextV2, QueryValueV2, execute_hook_v2, execute_hook_v2_direct_reference,
    execute_query_v2, execute_query_v2_direct_reference,
};
use er_content::m6_catalog::SemanticCatalogV1;
use er_content::pack::m6_pack::{
    BattleContentPackV3, BehaviorClassificationEntryV2, BehaviorClassificationManifestV2,
    BespokeManifestV2, FieldContentV1,
};
use er_content::pack::m6_prepared::{PreparedBattleContentV3, prepare_content};
use er_content::pack::{ContentPack, selected_content_pack, selected_type_chart};
use er_content_compiler::m6::{
    BespokeAssignment, CompilerOptions, IntrinsicRule, SemanticCatalogInput,
    SemanticCompileRequest, ValidatedSemanticCatalog, compile_semantics, map_routine_catalog,
};
use er_kernel::{
    BattleGameConfig, BattleProtocolConfig, BattleProtocolRoleConfig, BattleStartV1, GameKernel,
    KernelEffect, KernelInput,
};
use er_mechanics::condition_v2::ExactRatioV2;
use er_mechanics::program_v2::MechanicsProgramV2;
use er_mechanics::v2::{MechanicHookV2, MechanicQueryV2};
use er_protocol::{
    AuthorityLogConfig, AuthorityReplicaConfig, BackoffPolicy, PeerBinding, ProposalLeaseConfig,
    RecoveryTransactionConfig,
};
use er_state::snapshot::GameState;
use er_testkit::m3_fixture::sha256_hex;
use er_types::battle_command::{
    BattleCommand, BattleTargetSelection, ScriptedEnemyBattleCommandV1, ScriptedEnemyPolicyV1,
    scripted_enemy_command_operation_id,
};
use er_types::battle_control::BattleControl;
use er_types::battle_ids::{
    BattleId, BattlePresentationEventId, BattleSide, FieldSlot, MoveSlotIndex, PartyIndex,
    TurnIndex, WaveIndex,
};
use er_types::battle_ui::{
    BattlePresentationEvent, BattlePresentationKind, PresentationSettlementOutcome,
};
use er_types::mechanics::MechanicsProgramId;
use er_types::{
    AuthorityEntryBody, AuthorityEntryKind, BattleContentPackHashV3, BehaviorClassificationKindV2,
    BehaviorSourceId, BespokeMechanicId, CatalogHash, ConnectionGeneration, FrameContext,
    FrameType, InputFocus, M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION, MembershipRevision, OracleSha,
    PhysicalKey, ProposalMessage, RawFrame, RawInputEvent, RunId, SafeU53, SeatId, SessionId,
    TimeClass, TransportState,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error as ThisError;

/// Wire schema version of the benchmark manifest family reserved by the M6
/// contract freeze (`benchmark manifest V1`).
pub const M6_BENCHMARK_MANIFEST_VERSION: u32 = 1;

/// Environment variable that switches the hosted workflow from recording to
/// enforcing release qualification ceilings.
pub const HOSTED_ENFORCEMENT_ENV: &str = "ER_M6_PERFORMANCE_ENFORCE";

const LEGACY_ORACLE_CONTENT_DIGEST: &str =
    "3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";
const LEGACY_ORACLE_CONTENT_HASH: &str =
    "blake3-v1:3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";

const SEMANTIC_CATALOG_FIXTURE: &str = "rust/fixtures/m6/semantic-catalog-v1.json";
const BESPOKE_CLUSTERS_FIXTURE: &str = "rust/fixtures/m6/bespoke-clusters-v1.json";

/// Singles scenarios executed by the multi-battle solo campaign, in fixed
/// order. Every entry is a published 1v1 oracle fixture with a one-member
/// player party, so any faint resolves to a terminal control reachable
/// through raw physical input alone.
pub const SOLO_CAMPAIGN_SCENARIOS: [&str; 8] = [
    "physical-hit",
    "critical-hit",
    "special-hit-priority",
    "always-hit",
    "miss",
    "pp-consumption",
    "poison-application",
    "burn-residual",
];

/// Scenario driven once before snapshot capture so restoration exercises a
/// mid-battle frontier with consumed RNG, PP, and presentation history.
const SNAPSHOT_SCENARIO: &str = "physical-hit";

/// Repository-relative fixture backing the co-op doubles campaign.
const COOP_SCENARIO_FIXTURE: &str = "rust/fixtures/m3/oracle/battle-cases/forced-replacement.json";
/// Repository-relative published legacy content artifact for co-op kernels.
const CONTENT_PACK_FIXTURE: &str = "rust/fixtures/m3/oracle/content-pack-v1.json";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, ThisError)]
pub enum BenchmarkError {
    #[error("benchmark fixture is unavailable: {0}")]
    Fixture(String),
    #[error("scenario {scenario:?} rejected: {reason}")]
    Scenario {
        scenario: &'static str,
        reason: String,
    },
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("kernel rejected a step: {0}")]
    Kernel(String),
    #[error("co-op pump exceeded its deterministic bound: {0}")]
    PumpBound(String),
    #[error("raw-key walk stalled in {control} after {presses} presses")]
    StalledWalk { control: String, presses: u64 },
    #[error("prepared and direct executors diverged on {surface:?}: {left} != {right}")]
    DispatchDivergence {
        surface: &'static str,
        left: String,
        right: String,
    },
    #[error("production pipeline rejected the workload: {0}")]
    Pipeline(String),
    #[error("workload {workload_id} has no release ceiling")]
    UnknownCeiling { workload_id: &'static str },
    #[error("workload measurements disagree between independent runs for {workload_id}: {detail}")]
    Nondeterministic {
        workload_id: &'static str,
        detail: String,
    },
}

impl BenchmarkError {
    fn scenario(scenario: &'static str, reason: impl Into<String>) -> Self {
        Self::Scenario {
            scenario,
            reason: reason.into(),
        }
    }

    fn fixture_message(message: impl Into<String>) -> Self {
        Self::Fixture(message.into())
    }
}

impl From<er_content::m6_catalog::CatalogLoadError> for BenchmarkError {
    fn from(error: er_content::m6_catalog::CatalogLoadError) -> Self {
        Self::Pipeline(error.to_string())
    }
}

impl From<er_content_compiler::m6::CatalogValidationError> for BenchmarkError {
    fn from(error: er_content_compiler::m6::CatalogValidationError) -> Self {
        Self::Pipeline(error.to_string())
    }
}

impl From<er_content_compiler::m6::SemanticCompileError> for BenchmarkError {
    fn from(error: er_content_compiler::m6::SemanticCompileError) -> Self {
        Self::Pipeline(error.to_string())
    }
}

impl From<er_content_compiler::m6::RoutineCompileError> for BenchmarkError {
    fn from(error: er_content_compiler::m6::RoutineCompileError) -> Self {
        Self::Pipeline(error.to_string())
    }
}

impl From<er_content::pack::m6_prepared::ContentError> for BenchmarkError {
    fn from(error: er_content::pack::m6_prepared::ContentError) -> Self {
        Self::Pipeline(error.to_string())
    }
}

// ---------------------------------------------------------------------------
// Profiles, measurements, checksums
// ---------------------------------------------------------------------------

/// Iteration profile for every workload. Selected from the build profile;
/// hosted release qualification runs the release numbers.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BenchmarkProfile {
    Debug,
    Release,
}

impl BenchmarkProfile {
    pub const fn current() -> Self {
        if cfg!(debug_assertions) {
            Self::Debug
        } else {
            Self::Release
        }
    }

    pub const fn name(self) -> &'static str {
        match self {
            Self::Debug => "debug",
            Self::Release => "release",
        }
    }

    /// Full frozen-catalog content preparations per measurement.

    pub const fn content_iterations(self) -> u32 {
        match self {
            Self::Debug => 2,
            Self::Release => 8,
        }
    }

    /// Full query+hook dispatch sweeps per measurement.
    pub const fn dispatch_sweeps(self) -> u32 {
        match self {
            Self::Debug => 4,
            Self::Release => 400,
        }
    }

    /// Fresh battles driven by the turn-execution workload.
    pub const fn turn_rounds(self) -> u32 {
        match self {
            Self::Debug => 1,
            Self::Release => 4,
        }
    }

    /// Resolution cap applied to every solo battle.
    pub const fn resolutions_per_battle(self) -> u32 {
        match self {
            Self::Debug => 2,
            Self::Release => 4,
        }
    }

    /// Solo battles in the multi-battle campaign (prefix of
    /// [`SOLO_CAMPAIGN_SCENARIOS`]).
    pub const fn solo_campaign_battles(self) -> usize {
        match self {
            Self::Debug => 2,
            Self::Release => SOLO_CAMPAIGN_SCENARIOS.len(),
        }
    }

    /// Co-op doubles battles in the campaign.
    pub const fn coop_battles(self) -> u32 {
        match self {
            Self::Debug => 1,
            Self::Release => 3,
        }
    }

    /// Mid-battle snapshot restorations.
    pub const fn snapshot_restores(self) -> u32 {
        match self {
            Self::Debug => 2,
            Self::Release => 8,
        }
    }
}

/// One machine-readable workload result. `elapsed_micros` covers the timed
/// execution region only; setup is excluded by construction.
#[derive(Clone, Debug, Serialize)]
pub struct WorkloadMeasurement {
    pub manifest_version: u32,
    pub workload_id: &'static str,
    pub profile: &'static str,
    pub iterations: u32,
    pub elapsed_micros: u64,
    /// SHA-256 over the ordered stream of observable outputs produced during
    /// execution. Equal across independent deterministic runs.
    pub checksum: String,
    /// Named execution counters (events, units, draws) including peak
    /// owned-resource proxy maxima. Equal across independent runs.
    pub counters: BTreeMap<String, u64>,
}

impl WorkloadMeasurement {
    pub fn elapsed(&self) -> Duration {
        Duration::from_micros(self.elapsed_micros)
    }
}

/// Ordered checksum accumulator over observable outputs. Every fold is
/// length-prefixed so adjacent fields cannot alias.
#[derive(Default)]
struct Checksum {
    parts: Vec<u8>,
}

impl Checksum {
    fn fold_text(&mut self, text: &str) {
        self.parts.extend_from_slice(text.as_bytes());
        self.parts.push(0x1f);
    }

    fn fold_debug(&mut self, value: &impl std::fmt::Debug) {
        self.fold_text(&format!("{value:?}"));
    }

    fn fold_bytes(&mut self, bytes: &[u8]) {
        self.parts
            .extend_from_slice(&(bytes.len() as u64).to_le_bytes());
        self.parts.extend_from_slice(bytes);
    }

    fn finish(self) -> String {
        sha256_hex(&self.parts)
    }
}

fn counter_map(entries: impl IntoIterator<Item = (&'static str, u64)>) -> BTreeMap<String, u64> {
    entries
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value))
        .collect()
}

/// Compares two independent runs of the same workload. Timing is explicitly
/// excluded; checksums and counters are not, because a run that skips work
/// or fabricates outputs cannot reproduce them.
pub fn assert_measurements_deterministic(
    left: &WorkloadMeasurement,
    right: &WorkloadMeasurement,
) -> Result<(), BenchmarkError> {
    let workload_id = left.workload_id;
    if left.workload_id != right.workload_id
        || left.profile != right.profile
        || left.iterations != right.iterations
    {
        return Err(BenchmarkError::Nondeterministic {
            workload_id,
            detail: "workload identity or iteration count changed".to_owned(),
        });
    }
    if left.checksum != right.checksum {
        return Err(BenchmarkError::Nondeterministic {
            workload_id,
            detail: format!("checksum {} != {}", left.checksum, right.checksum),
        });
    }
    if left.counters != right.counters {
        let mut detail = String::new();
        let keys: Vec<&String> = left.counters.keys().chain(right.counters.keys()).collect();
        for key in keys {
            let l = left.counters.get(key);
            let r = right.counters.get(key);
            if l != r {
                detail.push_str(&format!("{key}: {l:?} != {r:?}; "));
            }
        }
        return Err(BenchmarkError::Nondeterministic {
            workload_id,
            detail,
        });
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Frozen-fixture resolution (CARGO_MANIFEST_DIR ancestor walk)
// ---------------------------------------------------------------------------

fn repository_root() -> Result<PathBuf, BenchmarkError> {
    let mut candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    loop {
        if candidate.join(SEMANTIC_CATALOG_FIXTURE).is_file() {
            return Ok(candidate);
        }
        if !candidate.pop() {
            return Err(BenchmarkError::fixture_message(
                "no ancestor of CARGO_MANIFEST_DIR contains rust/fixtures/m6",
            ));
        }
    }
}

/// Loads one frozen repository fixture through `CARGO_MANIFEST_DIR` ancestor
/// resolution. `relative` starts at the repository root (`rust/fixtures/...`).
pub fn fixture_bytes(relative: &str) -> Result<Vec<u8>, BenchmarkError> {
    let path = repository_root()?.join(relative);
    std::fs::read(&path)
        .map_err(|error| BenchmarkError::fixture_message(format!("{}: {error}", path.display())))
}

fn fixture_value(relative: &str) -> Result<Value, BenchmarkError> {
    let bytes = fixture_bytes(relative)?;
    Ok(serde_json::from_slice(&bytes)?)
}

// ---------------------------------------------------------------------------
// Shared content preparation pipeline
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ClusterManifest {
    schema_version: u32,
    oracle_sha: String,
    clusters: Vec<ClusterEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ClusterEntry {
    cluster: BespokeMechanicId,
    behavior_units: Vec<er_types::BehaviorUnitId>,
}

struct ContentInputs {
    catalog_bytes: Vec<u8>,
    clusters: Vec<ClusterEntry>,
    cluster_oracle_sha: String,
}

fn load_content_inputs() -> Result<ContentInputs, BenchmarkError> {
    let catalog_bytes = fixture_bytes(SEMANTIC_CATALOG_FIXTURE)?;
    let manifest: ClusterManifest =
        serde_json::from_slice(&fixture_bytes(BESPOKE_CLUSTERS_FIXTURE)?)?;
    if manifest.schema_version != 1 {
        return Err(BenchmarkError::fixture_message(
            "bespoke cluster manifest schema version must be 1",
        ));
    }
    Ok(ContentInputs {
        catalog_bytes,
        clusters: manifest.clusters,
        cluster_oracle_sha: manifest.oracle_sha,
    })
}

fn validated_catalog(bytes: &[u8]) -> Result<ValidatedSemanticCatalog, BenchmarkError> {
    let catalog = SemanticCatalogV1::from_bytes(bytes)?;
    let raw_hash = CatalogHash::parse(catalog.raw_catalog_hash.clone())
        .map_err(|error| BenchmarkError::fixture_message(error.to_string()))?;
    Ok(ValidatedSemanticCatalog::new(SemanticCatalogInput::new(
        catalog, raw_hash,
    ))?)
}

/// Identity summary of one prepared content unit; folded into the workload
/// checksum so a skipped preparation cannot fake its counts.
#[derive(Debug)]
struct CompileSummary {
    routine_programs: usize,
    classification_entries: usize,
    content_hash: String,
    semantic_hash: String,
    oracle_sha: String,
}

struct PreparedUnit {
    prepared: PreparedBattleContentV3,
    direct_programs: Vec<MechanicsProgramV2>,
    summary: CompileSummary,
}

/// Parses, validates, maps, packs, hashes, and prepares one full frozen
/// semantic-catalog unit through the production M6 preparation pipeline.
fn prepare_one_content_unit(inputs: &ContentInputs) -> Result<PreparedUnit, BenchmarkError> {
    let validated = validated_catalog(&inputs.catalog_bytes)?;
    if validated.oracle_sha().to_owned() != inputs.cluster_oracle_sha {
        return Err(BenchmarkError::fixture_message(
            "bespoke cluster manifest oracle SHA disagrees with the semantic catalog",
        ));
    }

    // Full compile evidence request over the frozen intrinsic/bespoke split.
    // The compile result is folded into the summary so the timed workload
    // exercises the complete compiler, not just routine mapping.
    let mut intrinsic_rules = Vec::new();
    for unit in validated.behavior_units().iter() {
        if unit.semantic.resolution == er_content::m6_catalog::CatalogResolution::ResolvedIntrinsic
        {
            intrinsic_rules.push(IntrinsicRule {
                behavior_unit: unit.id.clone(),
            });
        }
    }
    let bespoke_assignments = inputs
        .clusters
        .iter()
        .map(|cluster| BespokeAssignment {
            mechanic: cluster.cluster.clone(),
            behavior_units: cluster.behavior_units.clone(),
        })
        .collect::<Vec<_>>();
    let compiled = compile_semantics(SemanticCompileRequest {
        catalog: &validated,
        intrinsic_rules: &intrinsic_rules,
        bespoke_assignments: &bespoke_assignments,
        options: CompilerOptions::default(),
    })?;

    let mapped = map_routine_catalog(validated.behavior_units())?;
    let mut direct_programs = Vec::with_capacity(mapped.mapped.len());
    let mut programs = vec![None];
    let mut classifications = Vec::with_capacity(mapped.mapped.len());
    for (index, spec) in mapped.mapped.into_iter().enumerate() {
        let id = MechanicsProgramId::try_from_u64(index as u64 + 1)
            .map_err(|error| BenchmarkError::fixture_message(error.to_string()))?;
        classifications.push(BehaviorClassificationEntryV2 {
            behavior_unit: spec.behavior_unit.clone(),
            kind: BehaviorClassificationKindV2::Compiled,
            programs: vec![id],
            bespoke: None,
            unsupported_reason: None,
        });
        let program = spec.build(id)?;
        direct_programs.push(program.clone());
        programs.push(Some(program));
    }

    let mut pack = BattleContentPackV3 {
        schema_version: M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION,
        oracle_sha: OracleSha::parse(validated.oracle_sha().to_owned())
            .map_err(|error| BenchmarkError::fixture_message(error.to_string()))?,
        raw_catalog_hash: CatalogHash::parse(validated.raw_catalog_hash().to_owned())
            .map_err(|error| BenchmarkError::fixture_message(error.to_string()))?,
        semantic_catalog_hash: validated.semantic_catalog_hash().clone(),
        content_hash: BattleContentPackHashV3::parse(format!(
            "{}{}",
            BattleContentPackHashV3::PREFIX,
            "0".repeat(64)
        ))
        .map_err(|error| BenchmarkError::fixture_message(error.to_string()))?,
        species: Vec::new(),
        forms: Vec::new(),
        moves: Vec::new(),
        abilities: Vec::new(),
        held_items: Vec::new(),
        field_content: FieldContentV1::default(),
        programs,
        classifications: BehaviorClassificationManifestV2(classifications),
        bespoke: BespokeManifestV2::default(),
        rng_sites: Vec::new(),
        type_chart: selected_type_chart(),
    };
    pack.content_hash = pack
        .compute_content_hash()
        .map_err(|error| BenchmarkError::fixture_message(error.to_string()))?;
    let prepared = prepare_content(pack)?;
    let summary = CompileSummary {
        routine_programs: direct_programs.len(),
        classification_entries: prepared.pack().classifications.0.len(),
        content_hash: prepared.content_hash().as_str().to_owned(),
        semantic_hash: prepared.semantic_catalog_hash().as_str().to_owned(),
        oracle_sha: compiled.report_source_identity(&validated),
    };
    Ok(PreparedUnit {
        prepared,
        direct_programs,
        summary,
    })
}

trait ReportIdentity {
    fn report_source_identity(&self, validated: &ValidatedSemanticCatalog) -> String;
}

impl ReportIdentity for er_content_compiler::m6::SemanticCompileOutput {
    fn report_source_identity(&self, validated: &ValidatedSemanticCatalog) -> String {
        format!(
            "units={}/compiled={}/bespoke={}/unsupported={} oracle={}",
            self.report.source_count,
            self.report.compiled_unit_count,
            self.report.bespoke_unit_count,
            self.report.unsupported_unit_count,
            validated.oracle_sha(),
        )
    }
}

// ---------------------------------------------------------------------------
// Workload 1: m6.content_preparation
// ---------------------------------------------------------------------------

pub fn run_content_preparation(
    profile: BenchmarkProfile,
) -> Result<WorkloadMeasurement, BenchmarkError> {
    let inputs = load_content_inputs()?;
    let iterations = profile.content_iterations();
    let started = Instant::now();
    let mut checksum = Checksum::default();
    let mut routine_total = 0u64;
    let mut classification_total = 0u64;
    for _ in 0..iterations {
        let unit = prepare_one_content_unit(&inputs)?;
        checksum.fold_text(&unit.summary.content_hash);
        checksum.fold_text(&unit.summary.semantic_hash);
        checksum.fold_text(&unit.summary.oracle_sha);
        checksum.fold_text(&inputs.cluster_oracle_sha);
        checksum.fold_debug(&unit.prepared.content_hash());
        routine_total += unit.summary.routine_programs as u64;
        classification_total += unit.summary.classification_entries as u64;
        std::hint::black_box(&unit.prepared);
    }
    let elapsed = started.elapsed();
    Ok(WorkloadMeasurement {
        manifest_version: M6_BENCHMARK_MANIFEST_VERSION,
        workload_id: "m6.content_preparation",
        profile: profile.name(),
        iterations,
        elapsed_micros: elapsed.as_micros() as u64,
        checksum: checksum.finish(),
        counters: counter_map([
            ("content_units", iterations as u64),
            ("routine_programs", routine_total),
            ("classification_entries", classification_total),
        ]),
    })
}

// ---------------------------------------------------------------------------
// Workload 2: m6.routine_dispatch
// ---------------------------------------------------------------------------

const DISPATCH_QUERIES: [MechanicQueryV2; 17] = [
    MechanicQueryV2::MoveType,
    MechanicQueryV2::MoveCategory,
    MechanicQueryV2::MoveTargetShape,
    MechanicQueryV2::ActionPriority,
    MechanicQueryV2::EffectiveSpeed,
    MechanicQueryV2::Accuracy,
    MechanicQueryV2::CriticalRate,
    MechanicQueryV2::MovePower,
    MechanicQueryV2::OffensiveStat,
    MechanicQueryV2::DefensiveStat,
    MechanicQueryV2::TypeEffectiveness,
    MechanicQueryV2::Damage,
    MechanicQueryV2::HitCount,
    MechanicQueryV2::StatusEligibility,
    MechanicQueryV2::VolatileEligibility,
    MechanicQueryV2::SwitchEligibility,
    MechanicQueryV2::ItemEligibility,
];

const DISPATCH_HOOKS: [MechanicHookV2; 24] = [
    MechanicHookV2::BattleLoad,
    MechanicHookV2::BattleStart,
    MechanicHookV2::BeforeSummon,
    MechanicHookV2::AfterSummon,
    MechanicHookV2::BeforeActionOrder,
    MechanicHookV2::BeforeAction,
    MechanicHookV2::BeforeMove,
    MechanicHookV2::BeforeHit,
    MechanicHookV2::AfterHit,
    MechanicHookV2::AfterMove,
    MechanicHookV2::AfterDamage,
    MechanicHookV2::BeforeStatus,
    MechanicHookV2::AfterStatus,
    MechanicHookV2::BeforeSwitchOut,
    MechanicHookV2::AfterSwitchOut,
    MechanicHookV2::BeforeSwitchIn,
    MechanicHookV2::WeatherChanged,
    MechanicHookV2::WeatherLapse,
    MechanicHookV2::TerrainChanged,
    MechanicHookV2::TurnEnd,
    MechanicHookV2::ScheduledEvent,
    MechanicHookV2::BeforeFaint,
    MechanicHookV2::AfterFaint,
    MechanicHookV2::Victory,
];

struct RoutineDispatchSetup {
    prepared: PreparedBattleContentV3,
    direct: Vec<MechanicsProgramV2>,
    active_sources: Vec<BehaviorSourceId>,
}

fn build_routine_dispatch_setup(
    inputs: &ContentInputs,
) -> Result<RoutineDispatchSetup, BenchmarkError> {
    let unit = prepare_one_content_unit(inputs)?;
    let mut active_sources: Vec<_> = unit
        .direct_programs
        .iter()
        .map(|program| program.source.clone())
        .collect();
    active_sources.sort();
    active_sources.dedup();
    Ok(RoutineDispatchSetup {
        prepared: unit.prepared,
        direct: unit.direct_programs,
        active_sources,
    })
}

fn query_initial(query: MechanicQueryV2) -> QueryValueV2 {
    match query {
        MechanicQueryV2::MoveType => QueryValueV2::TypeId(1),
        MechanicQueryV2::MoveCategory => QueryValueV2::CategoryId(1),
        MechanicQueryV2::MoveTargetShape => QueryValueV2::TargetId(1),
        MechanicQueryV2::TypeEffectiveness => QueryValueV2::Ratio(ExactRatioV2 {
            numerator: 1,
            denominator: 1,
        }),
        MechanicQueryV2::StatusEligibility
        | MechanicQueryV2::VolatileEligibility
        | MechanicQueryV2::SwitchEligibility
        | MechanicQueryV2::ItemEligibility => QueryValueV2::Boolean(true),
        _ => QueryValueV2::Signed(7),
    }
}

/// Deterministic per-sweep mechanics context variation. Pure integer mixing;
/// no clocks, no randomness.
fn sweep_context(seed: u64, active: &[BehaviorSourceId]) -> MechanicsContextV2<'_> {
    let mix = |round: u64| -> i64 {
        let mut x = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15).wrapping_add(round);
        x ^= x >> 12;
        x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
        x ^= x >> 15;
        (x % 199) as i64
    };
    MechanicsContextV2 {
        active_sources: active,
        suppressed_sources: &[],
        instance_counter: mix(1),
        hp_current: mix(2).max(1),
        hp_max: mix(2).max(1) + 100,
        turn_index: mix(3),
        wave_index: mix(4),
        level: mix(5).max(1),
    }
}

fn press_physical_key(
    kernel: &mut GameKernel,
    code: PhysicalKey,
) -> Result<Vec<KernelEffect>, BenchmarkError> {
    let mut effects = kernel
        .step(KernelInput::RawInput {
            seat: seat(1),
            event: RawInputEvent::KeyDown {
                code: code.clone(),
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            },
        })
        .map_err(|error| BenchmarkError::Kernel(error.to_string()))?;
    effects.extend(
        kernel
            .step(KernelInput::RawInput {
                seat: seat(1),
                event: RawInputEvent::KeyUp { code },
            })
            .map_err(|error| BenchmarkError::Kernel(error.to_string()))?,
    );
    Ok(effects)
}

pub fn run_routine_dispatch(
    profile: BenchmarkProfile,
) -> Result<WorkloadMeasurement, BenchmarkError> {
    let inputs = load_content_inputs()?;
    let setup = build_routine_dispatch_setup(&inputs)?;
    let sweeps = profile.dispatch_sweeps();
    let started = Instant::now();
    let mut checksum = Checksum::default();
    let mut executions = 0u64;
    for sweep in 0..sweeps {
        let context = sweep_context(sweep as u64, &setup.active_sources);
        for query in DISPATCH_QUERIES {
            let initial = query_initial(query);
            let direct =
                execute_query_v2_direct_reference(&setup.direct, &context, query, initial.clone())
                    .map_err(|error| BenchmarkError::Kernel(error.to_string()))?;
            let indexed = execute_query_v2(&setup.prepared, &context, query, initial)
                .map_err(|error| BenchmarkError::Kernel(error.to_string()))?;
            if indexed != direct {
                return Err(BenchmarkError::DispatchDivergence {
                    surface: "query",
                    left: format!("{direct:?}"),
                    right: format!("{indexed:?}"),
                });
            }
            checksum.fold_debug(&indexed);
            executions += 1;
        }
        for hook in DISPATCH_HOOKS {
            let direct = execute_hook_v2_direct_reference(&setup.direct, &context, hook)
                .map_err(|error| BenchmarkError::Kernel(error.to_string()))?;
            let indexed = execute_hook_v2(&setup.prepared, &context, hook)
                .map_err(|error| BenchmarkError::Kernel(error.to_string()))?;
            if indexed != direct {
                return Err(BenchmarkError::DispatchDivergence {
                    surface: "hook",
                    left: format!("{direct:?}"),
                    right: format!("{indexed:?}"),
                });
            }
            checksum.fold_debug(&indexed);
            executions += 1;
        }
    }
    let elapsed = started.elapsed();
    Ok(WorkloadMeasurement {
        manifest_version: M6_BENCHMARK_MANIFEST_VERSION,
        workload_id: "m6.routine_dispatch",
        profile: profile.name(),
        iterations: sweeps,
        elapsed_micros: elapsed.as_micros() as u64,
        checksum: checksum.finish(),
        counters: counter_map([
            ("dispatch_sweeps", sweeps as u64),
            ("executor_calls", executions),
            ("routine_programs", setup.direct.len() as u64),
            ("active_sources", setup.active_sources.len() as u64),
        ]),
    })
}

// ---------------------------------------------------------------------------
// Workload 3: m6.bespoke_dispatch
// ---------------------------------------------------------------------------

pub fn run_bespoke_dispatch(
    profile: BenchmarkProfile,
) -> Result<WorkloadMeasurement, BenchmarkError> {
    let inputs = load_content_inputs()?;
    // Setup: pin the cluster manifest to the frozen catalog oracle identity.
    let validated = validated_catalog(&inputs.catalog_bytes)?;
    if validated.oracle_sha().to_owned() != inputs.cluster_oracle_sha {
        return Err(BenchmarkError::fixture_message(
            "bespoke cluster manifest oracle SHA disagrees with the semantic catalog",
        ));
    }
    let cluster_count = inputs.clusters.len() as u64;
    let behavior_unit_count = inputs
        .clusters
        .iter()
        .map(|cluster| cluster.behavior_units.len() as u64)
        .sum::<u64>();

    let iterations = profile.dispatch_sweeps();
    let started = Instant::now();
    let mut checksum = Checksum::default();
    let mut route_executions = 0u64;
    for _ in 0..iterations {
        for cluster in &inputs.clusters {
            let routes = handlers_for(cluster.cluster);
            for route in routes {
                checksum.fold_debug(route);
                route_executions += 1;
            }
            checksum.fold_text(BESPOKE_CLUSTER_SENTINEL);
        }
    }
    let elapsed = started.elapsed();
    Ok(WorkloadMeasurement {
        manifest_version: M6_BENCHMARK_MANIFEST_VERSION,
        workload_id: "m6.bespoke_dispatch",
        profile: profile.name(),
        iterations,
        elapsed_micros: elapsed.as_micros() as u64,
        checksum: checksum.finish(),
        counters: counter_map([
            ("dispatch_sweeps", iterations as u64),
            ("bespoke_clusters", cluster_count),
            ("behavior_units", behavior_unit_count),
            ("handler_routes", route_executions),
        ]),
    })
}

const BESPOKE_CLUSTER_SENTINEL: &str = "cluster-boundary";

// ---------------------------------------------------------------------------
// Production battle harness (published oracle fixtures, raw keys only)
// ---------------------------------------------------------------------------

fn invalid(message: impl Into<String>) -> BenchmarkError {
    BenchmarkError::fixture_message(message)
}

fn field<'a>(object: &'a Value, key: &str) -> Result<&'a Value, BenchmarkError> {
    object
        .get(key)
        .ok_or_else(|| invalid(format!("fixture is missing field {key:?}")))
}

fn field_mut<'a>(object: &'a mut Value, key: &str) -> Result<&'a mut Value, BenchmarkError> {
    object
        .get_mut(key)
        .ok_or_else(|| invalid(format!("fixture is missing mutable field {key:?}")))
}

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).unwrap_or(SafeU53::ZERO)
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn selected_content() -> Result<Arc<ContentPack>, BenchmarkError> {
    let content = selected_content_pack()
        .map_err(|error| invalid(format!("selected content pack failed to load: {error}")))?;
    Ok(Arc::new(content))
}

fn is_status_kind_tag(tag: &str) -> bool {
    matches!(
        tag,
        "NONE" | "POISON" | "TOXIC" | "PARALYSIS" | "SLEEP" | "BURN"
    )
}

fn normalize_legacy_status_kind(path: &str, status: &mut Value) -> Result<(), BenchmarkError> {
    let status_object = status
        .as_object_mut()
        .ok_or_else(|| invalid(format!("{path} is not an object")))?;
    let kind = status_object
        .get("kind")
        .cloned()
        .ok_or_else(|| invalid(format!("{path}.kind is missing")))?;
    let normalized = match kind {
        Value::String(tag) if is_status_kind_tag(&tag) => Value::String(tag),
        Value::String(tag) => {
            return Err(invalid(format!(
                "{path}.kind has unsupported value {tag:?}"
            )));
        }
        Value::Object(wrapper) => {
            if wrapper.len() != 1 || !wrapper.contains_key("kind") {
                return Err(invalid(format!(
                    "{path}.kind has an unsupported nested wrapper shape"
                )));
            }
            let tag = wrapper
                .get("kind")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid(format!("{path}.kind.kind is not a string")))?;
            if !is_status_kind_tag(tag) {
                return Err(invalid(format!(
                    "{path}.kind.kind has unsupported value {tag:?}"
                )));
            }
            Value::String(tag.to_owned())
        }
        other => {
            return Err(invalid(format!(
                "{path}.kind has unsupported value {other}"
            )));
        }
    };
    status_object.insert("kind".to_owned(), normalized);
    Ok(())
}

fn normalize_legacy_adjacent_kind(path: &str, kind: Value) -> Result<Value, BenchmarkError> {
    match kind {
        Value::String(tag) if tag == "NONE" => Ok(json!({ "kind": tag })),
        Value::String(tag) => Err(invalid(format!(
            "{path} has unsupported legacy value {tag:?}"
        ))),
        Value::Object(wrapper) => {
            let tag = wrapper
                .get("kind")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid(format!("{path}.kind is not a string")))?;
            let valid_shape = match tag {
                "NONE" => wrapper.len() == 1,
                "UNSUPPORTED_ORACLE_CODE" => {
                    wrapper.len() == 2
                        && wrapper
                            .get("value")
                            .and_then(Value::as_u64)
                            .is_some_and(|value| u16::try_from(value).is_ok())
                }
                _ => false,
            };
            if !valid_shape {
                return Err(invalid(format!(
                    "{path} has an invalid adjacent kind object"
                )));
            }
            Ok(Value::Object(wrapper))
        }
        other => Err(invalid(format!("{path} has unsupported value {other}"))),
    }
}

fn normalize_legacy_adjacent_field(
    path: &str,
    object: &mut Value,
    field_name: &str,
) -> Result<(), BenchmarkError> {
    let object = object
        .as_object_mut()
        .ok_or_else(|| invalid(format!("{path} is not an object")))?;
    let kind = object
        .get(field_name)
        .cloned()
        .ok_or_else(|| invalid(format!("{path}.{field_name} is missing")))?;
    let normalized = normalize_legacy_adjacent_kind(&format!("{path}.{field_name}"), kind)?;
    object.insert(field_name.to_owned(), normalized);
    Ok(())
}

/// Adapts the published legacy canonical state to current production types:
/// drops the mirrored `format.slots`, normalizes party status kinds, and
/// normalizes weather/terrain adjacent kinds.
fn normalize_legacy_canonical_state(canonical: &mut Value) -> Result<(), BenchmarkError> {
    let battle = canonical
        .get_mut("battle")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| invalid("canonical battle value is invalid"))?;

    let format_slots = battle
        .get("format")
        .and_then(Value::as_object)
        .and_then(|format| format.get("slots"))
        .cloned()
        .ok_or_else(|| invalid("canonical battle format slots are missing"))?;
    let field_slots = battle
        .get("field")
        .and_then(Value::as_object)
        .and_then(|slot_field| slot_field.get("slots"))
        .cloned()
        .ok_or_else(|| invalid("canonical battle field slots are missing"))?;
    if format_slots.is_array() != true
        || field_slots.is_array() != true
        || format_slots != field_slots
    {
        return Err(invalid(
            "canonical format.slots does not mirror field.slots as arrays",
        ));
    }
    battle
        .get_mut("format")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| invalid("canonical battle format is invalid"))?
        .remove("slots");

    for party_name in ["player_party", "enemy_party"] {
        let party = battle
            .get_mut(party_name)
            .and_then(Value::as_array_mut)
            .ok_or_else(|| invalid(format!("canonical battle {party_name} is invalid")))?;
        for (index, pokemon) in party.iter_mut().enumerate() {
            let status = pokemon.get_mut("status").ok_or_else(|| {
                invalid(format!(
                    "canonical battle {party_name}[{index}] status is missing"
                ))
            })?;
            normalize_legacy_status_kind(
                &format!("canonical battle {party_name}[{index}] status"),
                status,
            )?;
        }
    }
    for condition_name in ["weather", "terrain"] {
        let condition = battle
            .get_mut(condition_name)
            .ok_or_else(|| invalid(format!("canonical battle {condition_name} is missing")))?;
        normalize_legacy_adjacent_field(
            &format!("canonical battle {condition_name}"),
            condition,
            "kind",
        )?;
    }
    Ok(())
}

/// Rebinds the published legacy content identity onto the currently selected
/// content pack, failing closed on any other identity pair.
fn normalize_legacy_state_content_identity(
    document: &Value,
    state: &mut Value,
    selected: &ContentPack,
) -> Result<(), BenchmarkError> {
    let canonical = state
        .get_mut("canonical")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| invalid("initial_state.canonical is not an object"))?;
    let fixture_hash = canonical
        .get("content_hash")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("initial_state.canonical.content_hash is missing"))?
        .to_owned();
    let expected_hash = document
        .get("expected_final_state")
        .and_then(|value| value.get("canonical"))
        .and_then(|value| value.get("content_hash"))
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("expected_final_state.canonical.content_hash is missing"))?;
    if expected_hash != fixture_hash {
        return Err(invalid(
            "published state content hashes disagree between initial and expected final state",
        ));
    }
    let provenance = document
        .get("provenance")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("published fixture provenance is missing"))?;
    let provenance_hash = provenance
        .get("content_pack_hash")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("published fixture provenance hash is missing"))?;
    let provenance_oracle_sha = provenance
        .get("oracle_game_sha")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("published fixture provenance oracle SHA is missing"))?;
    if provenance_oracle_sha != selected.oracle_game_sha {
        return Err(invalid(
            "published fixture provenance oracle SHA disagrees with selected content",
        ));
    }

    let selected_hash = selected.hash.to_string();
    let selected_digest = selected_hash
        .strip_prefix("blake3-v1:")
        .ok_or_else(|| invalid("selected content hash has no blake3-v1 prefix"))?;
    if fixture_hash == selected_hash {
        if provenance_hash != selected_digest {
            return Err(invalid(
                "selected content hash disagrees with provenance digest",
            ));
        }
        return Ok(());
    }
    if fixture_hash != LEGACY_ORACLE_CONTENT_HASH || provenance_hash != LEGACY_ORACLE_CONTENT_DIGEST
    {
        return Err(invalid(
            "fixture content identity is neither the current selected pair nor the exact published legacy pair",
        ));
    }
    canonical.insert("content_hash".to_owned(), Value::String(selected_hash));
    Ok(())
}

fn scenario_document(scenario: &'static str) -> Result<(Value, &'static str), BenchmarkError> {
    let relative = format!("rust/fixtures/m3/oracle/battle-cases/{scenario}.json");
    let bytes = fixture_bytes(&relative)?;
    let document: Value = serde_json::from_slice(&bytes)?;
    Ok((document, scenario))
}

/// Builds the production singles [`BattleGameConfig`] for one scenario with a
/// scripted enemy fight command for every campaign cursor.
fn singles_battle_config(
    document: &Value,
    scenario: &'static str,
    enemy_turns: u32,
) -> Result<BattleGameConfig, BenchmarkError> {
    let selected = selected_content_pack()
        .map_err(|error| invalid(format!("selected content pack failed to load: {error}")))?;

    let mut initial_state = field(document, "initial_state")?.clone();
    normalize_legacy_canonical_state(
        initial_state
            .as_object_mut()
            .ok_or_else(|| invalid("initial_state is not an object"))?
            .get_mut("canonical")
            .ok_or_else(|| invalid("initial_state.canonical is missing"))?,
    )?;
    normalize_legacy_state_content_identity(document, &mut initial_state, &selected)?;

    let canonical = field(&initial_state, "canonical")?.clone();
    let battle = field(&canonical, "battle")?.clone();

    let mut format = field(&battle, "format")?.clone();
    format
        .as_object_mut()
        .ok_or_else(|| invalid("battle format is not an object"))?
        .remove("slots");
    let player_capacity = field(&format, "player_capacity")?
        .as_u64()
        .ok_or_else(|| invalid("player capacity is not unsigned"))?;
    let enemy_capacity = field(&format, "enemy_capacity")?
        .as_u64()
        .ok_or_else(|| invalid("enemy capacity is not unsigned"))?;
    if player_capacity != 1 || enemy_capacity != 1 {
        return Err(BenchmarkError::scenario(
            scenario,
            format!("campaign requires singles, got {player_capacity}v{enemy_capacity}"),
        ));
    }

    let actor: er_types::battle_ids::PokemonId = {
        let slots = field(field(&battle, "field")?, "slots")?
            .as_array()
            .ok_or_else(|| invalid("battle field slots are not an array"))?;
        let found = slots.iter().find_map(|entry| {
            let slot = entry.get("slot")?;
            (slot.get("side")?.as_str() == Some("ENEMY")
                && slot.get("position")?.as_u64() == Some(0))
            .then(|| entry.get("occupant")?.as_u64())
            .flatten()
        });
        let raw = found.ok_or_else(|| BenchmarkError::scenario(scenario, "no enemy lead"))?;
        er_types::battle_ids::PokemonId::new(
            SafeU53::new(raw)
                .map_err(|error| BenchmarkError::scenario(scenario, error.to_string()))?,
        )
    };

    let battle_id: BattleId = serde_json::from_value(field(&battle, "battle_id")?.clone())?;
    let turn_number = field(&battle, "turn")?
        .as_u64()
        .ok_or_else(|| invalid("battle turn is not unsigned"))?;
    let wave: WaveIndex = serde_json::from_value(field(&battle, "wave")?.clone())?;
    let enemy_slot = FieldSlot {
        side: BattleSide::Enemy,
        position: 0,
    };
    let mut commands = Vec::new();
    for cursor_number in 0..=u64::from(enemy_turns) {
        let cursor = safe(cursor_number);
        let turn = TurnIndex::new(safe(turn_number + cursor_number))
            .map_err(|error| BenchmarkError::scenario(scenario, error.to_string()))?;
        let operation_id =
            scripted_enemy_command_operation_id(battle_id, wave, turn, enemy_slot, cursor)
                .map_err(|error| BenchmarkError::scenario(scenario, error.to_string()))?;
        let command = BattleCommand::fight(
            actor,
            MoveSlotIndex::ZERO,
            BattleTargetSelection::implicit(),
        )
        .map_err(|error| BenchmarkError::scenario(scenario, error.to_string()))?;
        commands.push(
            ScriptedEnemyBattleCommandV1::new(
                operation_id,
                battle_id,
                wave,
                turn,
                cursor,
                actor,
                enemy_slot,
                command,
            )
            .map_err(|error| BenchmarkError::scenario(scenario, error.to_string()))?,
        );
    }

    let mut run_state = canonical.clone();
    let run_state_object = run_state
        .as_object_mut()
        .ok_or_else(|| invalid("canonical game state is not an object"))?;
    run_state_object.insert("battle".to_owned(), Value::Null);
    run_state_object.insert(
        "next_battle_id".to_owned(),
        field(&battle, "battle_id")?.clone(),
    );
    run_state_object.insert(
        "run_rng".to_owned(),
        field(field(document, "initial_rng")?, "run")?.clone(),
    );

    Ok(BattleGameConfig {
        run_state: serde_json::from_value(run_state)?,
        start: BattleStartV1 {
            schema_version: 1,
            format: serde_json::from_value(format)?,
            player_party: serde_json::from_value(field(&battle, "player_party")?.clone())?,
            enemy_party: serde_json::from_value(field(&battle, "enemy_party")?.clone())?,
            player_leads: serde_json::from_value(json!([0]))?,
            enemy_leads: serde_json::from_value(json!([0]))?,
        },
        local_seat: seat(1),
        wave_seed: field(&battle, "wave_seed")?
            .as_str()
            .ok_or_else(|| invalid("battle wave seed is not a string"))?
            .to_owned(),
        scripted_enemy_policy: ScriptedEnemyPolicyV1::new(SafeU53::ZERO, commands)
            .map_err(|error| BenchmarkError::scenario(scenario, error.to_string()))?,
    })
}

fn local_authority_protocol(local_seat: SeatId) -> Result<BattleProtocolConfig, BenchmarkError> {
    let context = FrameContext {
        session_id: SessionId::new("m6-bench-solo-session")
            .map_err(|error| invalid(error.to_string()))?,
        run_id: RunId::new("m6-bench-solo-run").map_err(|error| invalid(error.to_string()))?,
        session_epoch: safe(1),
        seat_map_id: "m6-bench-solo-seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id: local_seat,
        authority_seat_id: local_seat,
        connection_generation: ConnectionGeneration::ZERO,
    };
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Authority {
            log: AuthorityLogConfig {
                local_context: context,
                peer_bindings: Vec::new(),
                owner_id: "m6-bench-solo-authority".to_owned(),
                retain_capacity: safe(64),
                delivery_backoff: BackoffPolicy {
                    initial_ms: safe(250),
                    maximum_ms: safe(5_000),
                    factor_numerator: safe(2),
                    factor_denominator: safe(1),
                },
                delivery_time_class: TimeClass::Connected,
                max_delivery_attempts: None,
            },
            proposal_capacity: safe(64),
        },
    })
}

fn new_solo_kernel(
    document: &Value,
    scenario: &'static str,
    enemy_turns: u32,
    content: &Arc<ContentPack>,
) -> Result<GameKernel, BenchmarkError> {
    let config = singles_battle_config(document, scenario, enemy_turns)?;
    GameKernel::new_battle(
        config,
        local_authority_protocol(seat(1))?,
        Arc::clone(content),
    )
    .map_err(|error| BenchmarkError::scenario(scenario, error.to_string()))
}

// --- generic raw-key driver ------------------------------------------------

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ControlKind {
    CommandRoot,
    MoveSelect,
    TargetSelect,
    PartySelect,
    PartyOptionSelect,
    ReplacementSelect,
    Waiting,
    Complete,
}

struct ControlView {
    kind: ControlKind,
    actionable: bool,
}

fn control_view(kernel: &GameKernel) -> Result<ControlView, BenchmarkError> {
    let projection = kernel
        .battle_ui_projection()
        .ok_or_else(|| invalid("kernel did not expose a Battle UI projection"))?;
    let kind = match &projection.seat_control.control {
        BattleControl::CommandRoot(_) => ControlKind::CommandRoot,
        BattleControl::MoveSelect(_) => ControlKind::MoveSelect,
        BattleControl::TargetSelect(_) => ControlKind::TargetSelect,
        BattleControl::PartySelect(_) => ControlKind::PartySelect,
        BattleControl::PartyOptionSelect(_) => ControlKind::PartyOptionSelect,
        BattleControl::ReplacementSelect(_) => ControlKind::ReplacementSelect,
        BattleControl::Waiting(_) => ControlKind::Waiting,
        BattleControl::Complete(_) => ControlKind::Complete,
    };
    Ok(ControlView {
        kind,
        actionable: projection.actionable,
    })
}

fn raw_press(kernel: &mut GameKernel) -> Result<Vec<KernelEffect>, BenchmarkError> {
    let down = kernel.step(KernelInput::RawInput {
        seat: seat(1),
        event: RawInputEvent::KeyDown {
            code: PhysicalKey::Enter,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
    });
    let mut effects = down.map_err(|error| BenchmarkError::Kernel(error.to_string()))?;
    let up = kernel.step(KernelInput::RawInput {
        seat: seat(1),
        event: RawInputEvent::KeyUp {
            code: PhysicalKey::Enter,
        },
    });
    effects.extend(up.map_err(|error| BenchmarkError::Kernel(error.to_string()))?);
    Ok(effects)
}

fn presentation_events(effects: &[KernelEffect]) -> Vec<BattlePresentationEvent> {
    effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::PresentBattle { event, .. } => Some(event.clone()),
            _ => None,
        })
        .collect()
}

fn settle_presentations(
    kernel: &mut GameKernel,
    events: &[BattlePresentationEvent],
) -> Result<u64, BenchmarkError> {
    let mut settled = 0u64;
    for event in events {
        kernel
            .step(KernelInput::BattlePresentationOutcome {
                endpoint: seat(1),
                event_id: event.event_id.clone(),
                outcome: PresentationSettlementOutcome::Settled,
            })
            .map_err(|error| BenchmarkError::Kernel(error.to_string()))?;
        settled += 1;
    }
    Ok(settled)
}

/// Per-battle execution statistics folded into workloads.
#[derive(Default)]
struct BattleStats {
    actions_resolved: u64,
    move_actions: u64,
    key_presses: u64,
    presentations: u64,
    rng_draws: u64,
    peak_in_flight: u64,
    reached_terminal: u64,
}

impl BattleStats {
    fn observe_effects(&mut self, effects: &[KernelEffect]) {
        let in_flight = presentation_events(effects).len() as u64;
        self.presentations += in_flight;
        if in_flight > self.peak_in_flight {
            self.peak_in_flight = in_flight;
        }
    }
}

/// Drives one solo battle purely through physical Enter presses until the
/// terminal control or the resolution cap. Every observable output is folded
/// into `checksum`.
fn drive_solo_battle(
    kernel: &mut GameKernel,
    scenario: &'static str,
    resolution_cap: u32,
    stats: &mut BattleStats,
    checksum: &mut Checksum,
) -> Result<(), BenchmarkError> {
    let mut resolutions = 0u32;
    loop {
        let view = control_view(kernel)?;
        if view.kind == ControlKind::Complete {
            stats.reached_terminal += 1;
            checksum.fold_text(scenario);
            checksum.fold_text("terminal");
            checksum.fold_text(&kernel.state_digest());
            return Ok(());
        }
        if resolutions >= resolution_cap {
            checksum.fold_text(scenario);
            checksum.fold_text("cap");
            checksum.fold_text(&kernel.state_digest());
            return Ok(());
        }
        if !view.actionable {
            return Err(BenchmarkError::StalledWalk {
                control: format!("{:?}", view.kind),
                presses: stats.key_presses,
            });
        }

        // Walk menus with Enter until the submitted action resolves into a
        // presentation plan or reaches the terminal control.
        let mut pending: Vec<BattlePresentationEvent> = Vec::new();
        let mut presses_this_resolution = 0u64;
        while pending.is_empty() {
            let view = control_view(kernel)?;
            if view.kind == ControlKind::Complete {
                break;
            }
            if !view.actionable {
                return Err(BenchmarkError::StalledWalk {
                    control: format!("{:?}", view.kind),
                    presses: stats.key_presses,
                });
            }
            let effects = raw_press(kernel)?;
            stats.key_presses += 1;
            presses_this_resolution += 1;
            stats.rng_draws += kernel.m3_trace_audit().0.len() as u64;
            stats.observe_effects(&effects);
            pending.extend(presentation_events(&effects));
            if presses_this_resolution > 16 {
                return Err(BenchmarkError::StalledWalk {
                    control: format!("{:?}", view.kind),
                    presses: stats.key_presses,
                });
            }
        }

        settle_presentations(kernel, &pending)?;
        stats.rng_draws += kernel.m3_trace_audit().0.len() as u64;
        for event in &pending {
            checksum.fold_debug(&event.kind);
        }
        if !pending.is_empty() {
            resolutions += 1;
            stats.actions_resolved += 1;
            if pending
                .iter()
                .any(|event| matches!(event.kind, BattlePresentationKind::MoveUsed { .. }))
            {
                stats.move_actions += 1;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Workload 4: m6.turn_execution
// ---------------------------------------------------------------------------

pub fn run_turn_execution(
    profile: BenchmarkProfile,
) -> Result<WorkloadMeasurement, BenchmarkError> {
    let content = selected_content()?;
    let rounds = profile.turn_rounds();
    let cap = profile.resolutions_per_battle();
    let started = Instant::now();
    let mut checksum = Checksum::default();
    let mut total = BattleStats::default();
    for round in 0..rounds {
        let (document, scenario) = scenario_document(SNAPSHOT_SCENARIO)?;
        let mut kernel = new_solo_kernel(&document, scenario, cap + 1, &content)?;
        checksum.fold_text(&kernel.state_digest());
        let before = total.rng_draws;
        drive_solo_battle(&mut kernel, scenario, cap, &mut total, &mut checksum)?;
        checksum.fold_text(&kernel.state_digest());
        checksum.fold_debug(&(round, total.rng_draws - before));
        kernel.dispose("m6 benchmark turn round complete");
    }
    let elapsed = started.elapsed();
    let mut counters = counter_map([
        ("battles", rounds as u64),
        ("actions_resolved", total.actions_resolved),
        ("move_actions", total.move_actions),
        ("turn_cap", cap as u64),
        ("key_presses", total.key_presses),
        ("presentations", total.presentations),
        ("rng_draws", total.rng_draws),
        ("terminal_battles", total.reached_terminal),
        ("peak_in_flight_presentations", total.peak_in_flight),
    ]);
    counters.insert("peak_live_kernels".to_owned(), 1);
    Ok(WorkloadMeasurement {
        manifest_version: M6_BENCHMARK_MANIFEST_VERSION,
        workload_id: "m6.turn_execution",
        profile: profile.name(),
        iterations: rounds,
        elapsed_micros: elapsed.as_micros() as u64,
        checksum: checksum.finish(),
        counters,
    })
}

// ---------------------------------------------------------------------------
// Workload 5: m6.solo_campaign
// ---------------------------------------------------------------------------

pub fn run_solo_campaign(profile: BenchmarkProfile) -> Result<WorkloadMeasurement, BenchmarkError> {
    let content = selected_content()?;
    let battles = SOLO_CAMPAIGN_SCENARIOS
        .len()
        .min(profile.solo_campaign_battles());
    let cap = profile.resolutions_per_battle();
    let started = Instant::now();
    let mut checksum = Checksum::default();
    let mut total = BattleStats::default();
    for scenario in SOLO_CAMPAIGN_SCENARIOS[..battles].iter() {
        let (document, scenario_static) = scenario_document(scenario)?;
        let mut kernel = new_solo_kernel(&document, scenario_static, cap + 1, &content)?;
        drive_solo_battle(&mut kernel, scenario_static, cap, &mut total, &mut checksum)?;
        kernel.dispose("m6 benchmark solo campaign battle complete");
    }
    let elapsed = started.elapsed();
    Ok(WorkloadMeasurement {
        manifest_version: M6_BENCHMARK_MANIFEST_VERSION,
        workload_id: "m6.solo_campaign",
        profile: profile.name(),
        iterations: battles as u32,
        elapsed_micros: elapsed.as_micros() as u64,
        checksum: checksum.finish(),
        counters: counter_map([
            ("battles", battles as u64),
            ("actions_resolved", total.actions_resolved),
            ("move_actions", total.move_actions),
            ("resolution_cap", cap as u64),
            ("key_presses", total.key_presses),
            ("presentations", total.presentations),
            ("rng_draws", total.rng_draws),
            ("terminal_battles", total.reached_terminal),
            ("peak_in_flight_presentations", total.peak_in_flight),
        ]),
    })
}

// ---------------------------------------------------------------------------
// Co-op doubles pump (two production kernels + transport-only forwarding)
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Endpoint {
    Host,
    Guest,
}

impl Endpoint {
    fn seat(self) -> SeatId {
        match self {
            Self::Host => seat(1),
            Self::Guest => seat(2),
        }
    }

    fn peer(self) -> Self {
        match self {
            Self::Host => Self::Guest,
            Self::Guest => Self::Host,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Host => "HOST",
            Self::Guest => "GUEST",
        }
    }
}

#[derive(Clone, Debug)]
enum Packet {
    Frame {
        to: Endpoint,
        raw: RawFrame,
    },
    Proposal {
        to: Endpoint,
        proposal: ProposalMessage,
    },
}

/// Transport-only two-kernel pump. It performs no semantic work: emitted
/// transport effects are queued and delivered to the peer verbatim.
struct CoopPair {
    host: GameKernel,
    guest: GameKernel,
    generation: ConnectionGeneration,
    packets: VecDeque<Packet>,
    authority_entries: Vec<(Endpoint, AuthorityEntryKind)>,
    presentations: Vec<(Endpoint, BattlePresentationEventId)>,
    settled_presentations: Vec<(Endpoint, BattlePresentationEventId)>,
    stats: BattleStats,
    delivered_packets: u64,
    queued_packets: u64,
    peak_queued_packets: u64,
}

impl CoopPair {
    fn new(
        config: &BattleGameConfig,
        generation: ConnectionGeneration,
        content: &Arc<ContentPack>,
    ) -> Result<Self, BenchmarkError> {
        let host = Endpoint::Host.seat();
        let guest = Endpoint::Guest.seat();
        let mut host_config = config.clone();
        host_config.local_seat = host;
        let mut guest_config = config.clone();
        guest_config.local_seat = guest;

        let host_kernel = GameKernel::new_battle(
            host_config,
            coop_authority_protocol(host, guest, generation)?,
            Arc::clone(content),
        )
        .map_err(|error| BenchmarkError::Kernel(error.to_string()))?;
        let guest_kernel = GameKernel::new_battle(
            guest_config,
            coop_replica_protocol(host, guest, generation)?,
            Arc::clone(content),
        )
        .map_err(|error| BenchmarkError::Kernel(error.to_string()))?;
        Ok(Self {
            host: host_kernel,
            guest: guest_kernel,
            generation,
            packets: VecDeque::new(),
            authority_entries: Vec::new(),
            presentations: Vec::new(),
            settled_presentations: Vec::new(),
            stats: BattleStats::default(),
            delivered_packets: 0,
            queued_packets: 0,
            peak_queued_packets: 0,
        })
    }

    fn kernel_mut(&mut self, endpoint: Endpoint) -> &mut GameKernel {
        match endpoint {
            Endpoint::Host => &mut self.host,
            Endpoint::Guest => &mut self.guest,
        }
    }

    fn step(
        &mut self,
        endpoint: Endpoint,
        input: KernelInput,
    ) -> Result<Vec<KernelEffect>, BenchmarkError> {
        let effects = self
            .kernel_mut(endpoint)
            .step(input)
            .map_err(|error| BenchmarkError::Kernel(error.to_string()))?;
        for effect in &effects {
            self.observe_effect(endpoint, effect)?;
        }
        self.stats.observe_effects(&effects);
        Ok(effects)
    }

    fn observe_effect(
        &mut self,
        source: Endpoint,
        effect: &KernelEffect,
    ) -> Result<(), BenchmarkError> {
        match effect {
            KernelEffect::SendFrame { frame, .. } => {
                if frame.frame_type == FrameType::AuthorityEntry {
                    let body: AuthorityEntryBody = serde_json::from_value(frame.body.clone())?;
                    self.authority_entries.push((source, body.kind));
                }
                let raw = RawFrame::JsonValue(serde_json::to_value(frame)?);
                self.packets.push_back(Packet::Frame {
                    to: source.peer(),
                    raw,
                });
                self.track_queue();
            }
            KernelEffect::SendProposal { proposal } => {
                let to = if proposal.to == Endpoint::Host.seat() {
                    Endpoint::Host
                } else if proposal.to == Endpoint::Guest.seat() {
                    Endpoint::Guest
                } else {
                    return Err(invalid("SendProposal targeted an unknown seat"));
                };
                self.packets.push_back(Packet::Proposal {
                    to,
                    proposal: proposal.clone(),
                });
                self.track_queue();
            }
            KernelEffect::PresentBattle { event, .. } => {
                self.presentations.push((source, event.event_id.clone()));
            }
            _ => {}
        }
        Ok(())
    }

    fn track_queue(&mut self) {
        self.queued_packets += 1;
        let depth = self.packets.len() as u64;
        if depth > self.peak_queued_packets {
            self.peak_queued_packets = depth;
        }
    }

    fn connect(&mut self) -> Result<(), BenchmarkError> {
        self.step(
            Endpoint::Host,
            KernelInput::TransportChanged {
                endpoint: Endpoint::Guest.seat(),
                state: TransportState::Connected,
                generation: self.generation,
            },
        )?;
        self.step(
            Endpoint::Guest,
            KernelInput::TransportChanged {
                endpoint: Endpoint::Host.seat(),
                state: TransportState::Connected,
                generation: self.generation,
            },
        )?;
        self.deliver_all()
    }

    fn raw_press(&mut self, endpoint: Endpoint, code: PhysicalKey) -> Result<(), BenchmarkError> {
        self.step(
            endpoint,
            KernelInput::RawInput {
                seat: endpoint.seat(),
                event: RawInputEvent::KeyDown {
                    code: code.clone(),
                    printable: false,
                    browser_repeat: false,
                    focus: InputFocus::Game,
                },
            },
        )?;
        self.stats.key_presses += 1;
        self.step(
            endpoint,
            KernelInput::RawInput {
                seat: endpoint.seat(),
                event: RawInputEvent::KeyUp { code },
            },
        )?;
        self.stats.rng_draws += self.kernel_mut(endpoint).m3_trace_audit().0.len() as u64;
        Ok(())
    }

    fn deliver_front(&mut self) -> Result<(), BenchmarkError> {
        let packet = self
            .packets
            .pop_front()
            .ok_or_else(|| BenchmarkError::PumpBound("no packet to deliver".to_owned()))?;
        match packet {
            Packet::Frame { to, raw, .. } => {
                self.step(
                    to,
                    KernelInput::RawNetworkFrame {
                        endpoint: to.seat(),
                        frame: raw,
                    },
                )?;
            }
            Packet::Proposal { to, proposal } => {
                self.step(
                    to,
                    KernelInput::ProposalReceived {
                        endpoint: to.seat(),
                        proposal,
                    },
                )?;
            }
        }
        self.delivered_packets += 1;
        Ok(())
    }

    fn deliver_all(&mut self) -> Result<(), BenchmarkError> {
        for _ in 0..256 {
            if self.packets.is_empty() {
                return Ok(());
            }
            self.deliver_front()?;
        }
        Err(BenchmarkError::PumpBound(
            "deterministic pair pump exceeded its packet bound".to_owned(),
        ))
    }

    fn mechanical_control(&self, endpoint: Endpoint) -> Result<(Value, Value), BenchmarkError> {
        let state = self.kernel_mut_snapshot(endpoint);
        let game = state
            .get("game")
            .cloned()
            .ok_or_else(|| invalid("battle snapshot has no game state"))?;
        let control = state
            .get("control")
            .cloned()
            .ok_or_else(|| invalid("battle snapshot has no control plan"))?;
        Ok((game, control))
    }

    fn kernel_mut_snapshot(&self, endpoint: Endpoint) -> Value {
        match endpoint {
            Endpoint::Host => self.host.snapshot().state,
            Endpoint::Guest => self.guest.snapshot().state,
        }
    }

    fn settle_all_presentations(&mut self) -> Result<u64, BenchmarkError> {
        let pending = self
            .presentations
            .iter()
            .filter(|event| !self.settled_presentations.contains(event))
            .cloned()
            .collect::<Vec<_>>();
        for (endpoint, event_id) in &pending {
            let before = self.mechanical_control(*endpoint)?;
            self.step(
                *endpoint,
                KernelInput::BattlePresentationOutcome {
                    endpoint: endpoint.seat(),
                    event_id: event_id.clone(),
                    outcome: PresentationSettlementOutcome::Settled,
                },
            )?;
            let after = self.mechanical_control(*endpoint)?;
            if before != after {
                return Err(invalid(format!(
                    "presentation settlement changed mechanics at {:?}",
                    endpoint
                )));
            }
            self.settled_presentations
                .push((*endpoint, event_id.clone()));
            self.stats.presentations += 1;
        }
        self.deliver_all()?;
        Ok(pending.len() as u64)
    }

    fn digest(&self, endpoint: Endpoint) -> String {
        match endpoint {
            Endpoint::Host => self.host.state_digest(),
            Endpoint::Guest => self.guest.state_digest(),
        }
    }
}

fn coop_frame_context(
    sender_seat_id: SeatId,
    authority_seat_id: SeatId,
    connection_generation: ConnectionGeneration,
) -> Result<FrameContext, BenchmarkError> {
    Ok(FrameContext {
        session_id: SessionId::new("m6-bench-coop-session")
            .map_err(|error| invalid(error.to_string()))?,
        run_id: RunId::new("m6-bench-coop-run").map_err(|error| invalid(error.to_string()))?,
        session_epoch: safe(1),
        seat_map_id: "m6-bench-coop-seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id,
        authority_seat_id,
        connection_generation,
    })
}

fn coop_authority_protocol(
    host: SeatId,
    guest: SeatId,
    connection_generation: ConnectionGeneration,
) -> Result<BattleProtocolConfig, BenchmarkError> {
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Authority {
            log: AuthorityLogConfig {
                local_context: coop_frame_context(host, host, connection_generation)?,
                peer_bindings: vec![PeerBinding {
                    seat_id: guest,
                    connection_generation,
                }],
                owner_id: "m6-bench-coop:authority".to_owned(),
                retain_capacity: safe(32),
                delivery_backoff: BackoffPolicy {
                    initial_ms: safe(1),
                    maximum_ms: safe(64),
                    factor_numerator: safe(2),
                    factor_denominator: safe(1),
                },
                delivery_time_class: TimeClass::Connected,
                max_delivery_attempts: Some(safe(8)),
            },
            proposal_capacity: safe(64),
        },
    })
}

fn coop_replica_protocol(
    host: SeatId,
    guest: SeatId,
    connection_generation: ConnectionGeneration,
) -> Result<BattleProtocolConfig, BenchmarkError> {
    let guest_context = coop_frame_context(guest, host, connection_generation)?;
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Replica {
            replica: AuthorityReplicaConfig {
                receipt_context: guest_context.clone(),
                authority_seat_id: host,
                authority_connection_generation: connection_generation,
            },
            proposal_leases: ProposalLeaseConfig {
                owner_prefix: "m6-bench-coop:proposal:".to_owned(),
                retry_initial_ms: safe(1),
                retry_maximum_ms: safe(64),
                absolute_ceiling_ms: safe(1_200_000),
            },
            recovery: RecoveryTransactionConfig {
                local_context: guest_context,
                request_timeout_ms: safe(300_000),
                control_timeout_ms: safe(30_000),
                pacing_ms: safe(16),
                timer_owner_id: "m6-bench-coop:recovery".to_owned(),
            },
        },
    })
}

/// Builds the production doubles [`BattleGameConfig`] from the published
/// forced-replacement fixture, with two scripted turns of enemy commands.
fn coop_doubles_config(document: &Value) -> Result<BattleGameConfig, BenchmarkError> {
    let selected = selected_content_pack()
        .map_err(|error| invalid(format!("selected content pack failed to load: {error}")))?;

    let mut initial_state = field(document, "initial_state")?.clone();
    {
        let canonical_mut = initial_state
            .as_object_mut()
            .ok_or_else(|| invalid("initial_state is not an object"))?
            .get_mut("canonical")
            .ok_or_else(|| invalid("initial_state.canonical is missing"))?;
        normalize_legacy_canonical_state(canonical_mut)?;
    }
    normalize_legacy_state_content_identity(document, &mut initial_state, &selected)?;

    let canonical: GameState = serde_json::from_value(field(&initial_state, "canonical")?.clone())?;
    let battle = canonical
        .battle
        .clone()
        .ok_or_else(|| invalid("forced-replacement fixture has no active battle"))?;
    if battle.format.player_capacity != 2 || battle.format.enemy_capacity != 2 {
        return Err(invalid(
            "forced-replacement fixture is not the required two-seat doubles topology",
        ));
    }

    let mut run_state = canonical.clone();
    run_state.battle = None;
    run_state.next_battle_id = battle.battle_id;

    let player_leads = (0..battle.format.player_capacity)
        .map(|position| -> Result<PartyIndex, BenchmarkError> {
            let slot = FieldSlot::new(BattleSide::Player, position)
                .map_err(|error| invalid(error.to_string()))?;
            let pokemon_id = battle
                .field
                .occupant(&battle.format, slot)
                .map_err(|error| invalid(error.to_string()))?
                .ok_or_else(|| invalid(format!("player lead slot {position} is empty")))?;
            let party_index = battle
                .player_party
                .iter()
                .position(|pokemon| pokemon.id == pokemon_id)
                .ok_or_else(|| invalid(format!("player lead {pokemon_id} is not in the party")))?;
            PartyIndex::try_from(party_index as u64).map_err(|error| invalid(error.to_string()))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let enemy_leads = (0..battle.format.enemy_capacity)
        .map(|position| -> Result<PartyIndex, BenchmarkError> {
            let slot = FieldSlot::new(BattleSide::Enemy, position)
                .map_err(|error| invalid(error.to_string()))?;
            let pokemon_id = battle
                .field
                .occupant(&battle.format, slot)
                .map_err(|error| invalid(error.to_string()))?
                .ok_or_else(|| invalid(format!("enemy lead slot {position} is empty")))?;
            let party_index = battle
                .enemy_party
                .iter()
                .position(|pokemon| pokemon.id == pokemon_id)
                .ok_or_else(|| invalid(format!("enemy lead {pokemon_id} is not in the party")))?;
            PartyIndex::try_from(party_index as u64).map_err(|error| invalid(error.to_string()))
        })
        .collect::<Result<Vec<_>, _>>()?;

    let next_turn_value = battle
        .turn
        .get()
        .get()
        .checked_add(1)
        .ok_or_else(|| invalid("forced-replacement next turn overflowed"))?;
    let next_turn =
        TurnIndex::new(safe(next_turn_value)).map_err(|error| invalid(error.to_string()))?;
    let mut scripted_commands = Vec::new();
    for (turn_offset, turn) in [battle.turn, next_turn].into_iter().enumerate() {
        for position in 0..battle.format.enemy_capacity {
            let field_slot = FieldSlot::new(BattleSide::Enemy, position)
                .map_err(|error| invalid(error.to_string()))?;
            let actor = battle
                .field
                .occupant(&battle.format, field_slot)
                .map_err(|error| invalid(error.to_string()))?
                .ok_or_else(|| invalid(format!("enemy actor slot {position} is empty")))?;
            let target_position = position.min(battle.format.player_capacity.saturating_sub(1));
            let target = FieldSlot::new(BattleSide::Player, target_position)
                .map_err(|error| invalid(error.to_string()))?;
            let command = BattleCommand::fight(
                actor,
                MoveSlotIndex::ZERO,
                BattleTargetSelection::selected(vec![target])
                    .map_err(|error| invalid(error.to_string()))?,
            )
            .map_err(|error| invalid(error.to_string()))?;
            let script_cursor = safe(
                turn_offset as u64 * u64::from(battle.format.enemy_capacity) + u64::from(position),
            );
            let operation_id = scripted_enemy_command_operation_id(
                battle.battle_id,
                battle.wave,
                turn,
                field_slot,
                script_cursor,
            )
            .map_err(|error| invalid(error.to_string()))?;
            scripted_commands.push(
                ScriptedEnemyBattleCommandV1::new(
                    operation_id,
                    battle.battle_id,
                    battle.wave,
                    turn,
                    script_cursor,
                    actor,
                    field_slot,
                    command,
                )
                .map_err(|error| invalid(error.to_string()))?,
            );
        }
    }

    Ok(BattleGameConfig {
        run_state,
        start: BattleStartV1 {
            schema_version: 1,
            format: battle.format.clone(),
            player_party: battle.player_party.clone(),
            enemy_party: battle.enemy_party.clone(),
            player_leads,
            enemy_leads,
        },
        local_seat: seat(1),
        wave_seed: battle.wave_seed.clone(),
        scripted_enemy_policy: ScriptedEnemyPolicyV1::new(SafeU53::ZERO, scripted_commands)
            .map_err(|error| invalid(error.to_string()))?,
    })
}

/// Legacy content-pack artifact adaptation: rebinds the published pack onto
/// the currently selected content identity after normalizing its legacy
/// type chart and condition kinds.
fn adapt_legacy_content_artifact(
    artifact: &mut Value,
    selected: &ContentPack,
) -> Result<ContentPack, BenchmarkError> {
    let provenance = field(artifact, "provenance")?
        .as_object()
        .ok_or_else(|| invalid("published content artifact provenance is not an object"))?;
    let provenance_hash = provenance
        .get("content_pack_hash")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("published content provenance hash is missing"))?;
    let provenance_oracle_sha = provenance
        .get("oracle_game_sha")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("published content provenance oracle SHA is missing"))?;
    let pack = field(artifact, "content_pack")?
        .as_object()
        .ok_or_else(|| invalid("published content artifact content_pack is missing"))?;
    let pack_hash = pack
        .get("hash")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("published content pack hash is missing"))?;
    let pack_oracle_sha = pack
        .get("oracle_game_sha")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("published content pack oracle SHA is missing"))?;
    if pack_hash != LEGACY_ORACLE_CONTENT_HASH
        || provenance_hash != LEGACY_ORACLE_CONTENT_DIGEST
        || pack_oracle_sha != selected.oracle_game_sha
        || provenance_oracle_sha != selected.oracle_game_sha
    {
        return Err(invalid(
            "published content artifact is not the exact supported legacy identity",
        ));
    }

    let expected_entries = serde_json::to_value(&selected.type_chart.entries)?
        .as_array()
        .cloned()
        .ok_or_else(|| invalid("selected type chart entries are not an array"))?;
    let pack_mut = field_mut(artifact, "content_pack")?;
    let type_chart = field_mut(pack_mut, "type_chart")?;
    let entries = field_mut(type_chart, "entries")?
        .as_array_mut()
        .ok_or_else(|| invalid("published type chart entries are not an array"))?;
    let legacy_entries = entries.clone();
    if legacy_entries.len() != expected_entries.len() {
        return Err(invalid(
            "published type chart entry count differs from selected content",
        ));
    }
    for (index, expected) in expected_entries.iter().enumerate() {
        if legacy_entries
            .iter()
            .filter(|entry| *entry == expected)
            .count()
            != 1
        {
            return Err(invalid(format!(
                "published type chart does not contain selected entry at index {index}"
            )));
        }
    }
    *entries = expected_entries;

    let pack_mut = field_mut(artifact, "content_pack")?;
    let manifest = field_mut(pack_mut, "capability_manifest")?;
    let capability_entries = field_mut(manifest, "entries")?
        .as_array_mut()
        .ok_or_else(|| invalid("content_pack.capability_manifest.entries is not an array"))?;
    for (index, entry) in capability_entries.iter_mut().enumerate() {
        let subject = field_mut(entry, "subject")?;
        let subject_object = subject
            .as_object()
            .ok_or_else(|| invalid("capability entry subject is not an object"))?;
        if subject_object.len() != 2
            || !subject_object.contains_key("kind")
            || !subject_object.contains_key("value")
        {
            return Err(invalid(
                "capability entry subject must contain exactly kind and value",
            ));
        }
        let subject_kind = subject_object
            .get("kind")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("capability entry subject.kind is not a string"))?
            .to_owned();
        if matches!(subject_kind.as_str(), "WEATHER" | "TERRAIN") {
            normalize_legacy_adjacent_field(
                &format!("capability_manifest.entries[{index}].subject"),
                subject,
                "value",
            )?;
        }
    }

    let pack_object = field_mut(artifact, "content_pack")?
        .as_object_mut()
        .ok_or_else(|| invalid("published content pack is not an object"))?;
    pack_object.insert("hash".to_owned(), Value::String(selected.hash.to_string()));
    let content: ContentPack = serde_json::from_value(field(artifact, "content_pack")?.clone())?;
    if content != *selected {
        return Err(invalid(
            "published legacy content pack did not normalize to the current selected content",
        ));
    }
    Ok(content)
}

// ---------------------------------------------------------------------------
// Workload 6: m6.coop_campaign
// ---------------------------------------------------------------------------

/// Drives one full co-op doubles battle: connect, both seats submit by
/// physical keys, transport delivery, turn settlement, replacement flow,
/// replacement settlement, and final host/guest agreement.
fn run_one_coop_battle(
    config: &BattleGameConfig,
    content: &Arc<ContentPack>,
    checksum: &mut Checksum,
) -> Result<(BattleStats, u64, u64), BenchmarkError> {
    let generation = ConnectionGeneration::new(safe(1));
    let mut pair = CoopPair::new(config, generation, content)?;

    pair.connect()?;
    checksum.fold_text("connected");
    checksum.fold_text(&pair.digest(Endpoint::Host));

    let initial_host = pair.mechanical_control(Endpoint::Host)?;
    let initial_guest = pair.mechanical_control(Endpoint::Guest)?;
    if initial_host != initial_guest {
        return Err(invalid("co-op endpoints disagreed at battle start"));
    }

    for _ in 0..3 {
        pair.raw_press(Endpoint::Host, PhysicalKey::Enter)?;
    }
    for _ in 0..3 {
        pair.raw_press(Endpoint::Guest, PhysicalKey::Enter)?;
    }
    pair.deliver_all()?;
    let settled_turn = pair.settle_all_presentations()?;
    if settled_turn == 0 {
        return Err(invalid("the committed turn produced no presentation plan"));
    }
    checksum.fold_text(&format!("turn-presentations:{settled_turn}"));
    checksum.fold_text(&pair.digest(Endpoint::Host));
    checksum.fold_text(&pair.digest(Endpoint::Guest));

    // Replacement flow follows the committed turn's faint resolution.
    for _ in 0..2 {
        pair.raw_press(Endpoint::Host, PhysicalKey::Enter)?;
    }
    pair.deliver_all()?;
    let settled_replacement = pair.settle_all_presentations()?;
    if settled_replacement == 0 {
        return Err(invalid("the replacement produced no presentation plan"));
    }
    checksum.fold_text(&format!("replacement-presentations:{settled_replacement}"));

    // Convergence proof mirrors the production M3C-10 campaign: the complete
    // mechanical game and control plans must agree byte-for-byte once every
    // commit frame is delivered and every presentation settled.
    let final_host = pair.mechanical_control(Endpoint::Host)?;
    let final_guest = pair.mechanical_control(Endpoint::Guest)?;
    if final_host != final_guest {
        return Err(invalid(
            "co-op endpoints disagreed after the replacement flow",
        ));
    }
    checksum.fold_text("endpoints-agreed");
    if pair.authority_entries.is_empty() {
        return Err(invalid("the authority emitted no commit entries"));
    }

    Ok((
        BattleStats {
            key_presses: pair.stats.key_presses,
            presentations: pair.stats.presentations,
            rng_draws: pair.stats.rng_draws,
            peak_in_flight: pair.stats.peak_in_flight,
            ..BattleStats::default()
        },
        pair.peak_queued_packets,
        pair.authority_entries.len() as u64,
    ))
}

pub fn run_coop_campaign(profile: BenchmarkProfile) -> Result<WorkloadMeasurement, BenchmarkError> {
    // Setup: shared content, adapted legacy artifact, doubles config.
    let selected = selected_content()?;
    let mut artifact = fixture_value(CONTENT_PACK_FIXTURE)?;
    let content = Arc::new(adapt_legacy_content_artifact(
        &mut artifact,
        selected.as_ref(),
    )?);
    let document = fixture_value(COOP_SCENARIO_FIXTURE)?;
    let config = coop_doubles_config(&document)?;
    let battles = profile.coop_battles();

    let started = Instant::now();
    let mut checksum = Checksum::default();
    let mut totals = BattleStats::default();
    let mut peak_queued = 0u64;
    let mut total_authority_entries = 0u64;
    for battle_index in 0..battles {
        let (stats, peak_queued_packets, authority_entries) =
            run_one_coop_battle(&config, &content, &mut checksum)?;
        totals.key_presses += stats.key_presses;
        totals.presentations += stats.presentations;
        totals.rng_draws += stats.rng_draws;
        totals.peak_in_flight = totals.peak_in_flight.max(stats.peak_in_flight);
        peak_queued = peak_queued.max(peak_queued_packets);
        total_authority_entries += authority_entries;
        checksum.fold_debug(&battle_index);
    }
    let elapsed = started.elapsed();
    Ok(WorkloadMeasurement {
        manifest_version: M6_BENCHMARK_MANIFEST_VERSION,
        workload_id: "m6.coop_campaign",
        profile: profile.name(),
        iterations: battles,
        elapsed_micros: elapsed.as_micros() as u64,
        checksum: checksum.finish(),
        counters: counter_map([
            ("battles", battles as u64),
            ("key_presses", totals.key_presses),
            ("presentations_settled", totals.presentations),
            ("rng_draws", totals.rng_draws),
            ("authority_entries", total_authority_entries),
            ("peak_in_flight_presentations", totals.peak_in_flight),
            ("peak_queued_packets", peak_queued),
        ]),
    })
}

// ---------------------------------------------------------------------------
// Workload 7: m6.snapshot_restoration
// ---------------------------------------------------------------------------

/// Continuation key script replayed identically on original and restored
/// kernels after restoration: open and close the root menu.
const CONTINUATION_SCRIPT: [PhysicalKey; 2] = [PhysicalKey::Enter, PhysicalKey::Backspace];

pub fn run_snapshot_restoration(
    profile: BenchmarkProfile,
) -> Result<WorkloadMeasurement, BenchmarkError> {
    use er_kernel::snapshot::RestorableKernelSnapshotV2;

    let content = selected_content()?;
    let restores = profile.snapshot_restores();
    let cap = profile.resolutions_per_battle();

    // Setup: reach a quiescent mid-battle frontier once; every restore then
    // replays capture/serialize/restore/continue against fresh kernels built
    // from the same configuration.
    let (document, scenario) = scenario_document(SNAPSHOT_SCENARIO)?;
    let make_mid_battle_kernel = || -> Result<GameKernel, BenchmarkError> {
        let mut kernel = new_solo_kernel(&document, scenario, cap + 1, &content)?;
        let mut stats = BattleStats::default();
        let mut sink = Checksum::default();
        // Resolve exactly one action so the frontier carries consumed RNG,
        // PP, and settled presentation history.
        drive_solo_battle(&mut kernel, scenario, 1, &mut stats, &mut sink)?;
        Ok(kernel)
    };

    let started = Instant::now();
    let mut checksum = Checksum::default();
    let mut peak_snapshot_bytes = 0u64;
    let mut total_continuation_matches = 0u64;

    for _ in 0..restores {
        let mut kernel = make_mid_battle_kernel()?;
        checksum.fold_text(&kernel.state_digest());

        // Timed region: capture, serialize, deserialize, restore, continue.
        let snapshot = kernel
            .snapshot_v2()
            .map_err(|error| BenchmarkError::Kernel(error.to_string()))?;
        let bytes = serde_json::to_vec(&snapshot)?;
        peak_snapshot_bytes = peak_snapshot_bytes.max(bytes.len() as u64);
        checksum.fold_bytes(&bytes);
        let parsed: RestorableKernelSnapshotV2 = serde_json::from_slice(&bytes)?;
        let mut restored = GameKernel::from_snapshot_v2(parsed, Arc::clone(&content))
            .map_err(|error| BenchmarkError::Kernel(error.to_string()))?;

        if restored.state_digest() != kernel.state_digest() {
            return Err(invalid(
                "restored kernel digest differs from its source frontier",
            ));
        }
        // Continue both kernels through the identical physical-key script and
        // require the same resulting frontier.
        for key in CONTINUATION_SCRIPT {
            press_physical_key(&mut restored, key.clone())?;
            press_physical_key(&mut kernel, key)?;
        }
        if restored.state_digest() != kernel.state_digest() {
            return Err(invalid(
                "restored and original kernels diverged after the continuation script",
            ));
        }
        total_continuation_matches += 1;
        checksum.fold_text("continuation-checked");
    }

    let elapsed = started.elapsed();
    Ok(WorkloadMeasurement {
        manifest_version: M6_BENCHMARK_MANIFEST_VERSION,
        workload_id: "m6.snapshot_restoration",
        profile: profile.name(),
        iterations: restores,
        elapsed_micros: elapsed.as_micros() as u64,
        checksum: checksum.finish(),
        counters: counter_map([
            ("restores", restores as u64),
            ("continuation_matches", total_continuation_matches),
            ("peak_snapshot_bytes", peak_snapshot_bytes),
        ]),
    })
}

// ---------------------------------------------------------------------------
// Release qualification ceilings and typed regression comparison
// ---------------------------------------------------------------------------

/// One hosted-workflow release ceiling for a workload's measured execution
/// time at the release profile. Correctness gates are never weakened to meet
/// a ceiling; regressions above 25% require an explicit benchmark-contract
/// revision per the M6 performance plan.
#[derive(Clone, Copy, Debug, Serialize)]
pub struct WorkloadCeiling {
    pub workload_id: &'static str,
    pub ceiling_micros: u64,
}

impl WorkloadCeiling {
    pub const fn ceiling(self) -> Duration {
        Duration::from_micros(self.ceiling_micros)
    }
}

/// Release-profile qualification ceilings (V1). Values are deliberately
/// generous single-machine budgets; the hosted workflow tightens them only
/// through a benchmark-contract revision.
pub const RELEASE_QUALIFICATION_CEILINGS_V1: &[WorkloadCeiling] = &[
    WorkloadCeiling {
        workload_id: "m6.content_preparation",
        ceiling_micros: 45_000_000,
    },
    WorkloadCeiling {
        workload_id: "m6.routine_dispatch",
        ceiling_micros: 10_000_000,
    },
    WorkloadCeiling {
        workload_id: "m6.bespoke_dispatch",
        ceiling_micros: 10_000_000,
    },
    WorkloadCeiling {
        workload_id: "m6.turn_execution",
        ceiling_micros: 20_000_000,
    },
    WorkloadCeiling {
        workload_id: "m6.solo_campaign",
        ceiling_micros: 30_000_000,
    },
    WorkloadCeiling {
        workload_id: "m6.coop_campaign",
        ceiling_micros: 40_000_000,
    },
    WorkloadCeiling {
        workload_id: "m6.snapshot_restoration",
        ceiling_micros: 15_000_000,
    },
];

/// Typed comparison of one measurement against its release ceiling.
#[derive(Clone, Debug, Serialize)]
pub struct CeilingComparison {
    pub workload_id: &'static str,
    pub ceiling_micros: u64,
    pub observed_micros: Option<u64>,
    /// `observed * 1e6 / ceiling`, so 1_000_000 is exactly at the ceiling.
    /// `None` when the workload was not measured.
    pub ratio_micro: Option<u64>,
    pub within_ceiling: bool,
}

/// Machine-readable qualification result over the full ceiling table.
#[derive(Clone, Debug, Serialize)]
pub struct QualificationReport {
    pub manifest_version: u32,
    pub profile: &'static str,
    pub comparisons: Vec<CeilingComparison>,
    /// True only when every ceiling has a measurement and every measurement
    /// is within its ceiling.
    pub passed: bool,
}

/// Builds the typed regression comparison for the given measurements against
/// [`RELEASE_QUALIFICATION_CEILINGS_V1`]. Fails closed on measurements with
/// no declared ceiling; missing measurements mark that ceiling uncovered and
/// fail the report.
pub fn qualification_report(
    profile: BenchmarkProfile,
    measurements: &[WorkloadMeasurement],
) -> Result<QualificationReport, BenchmarkError> {
    let mut by_id: BTreeMap<&str, &WorkloadMeasurement> = BTreeMap::new();
    for measurement in measurements {
        if by_id.insert(measurement.workload_id, measurement).is_some() {
            return Err(BenchmarkError::Nondeterministic {
                workload_id: measurement.workload_id,
                detail: "duplicate measurement for one workload".to_owned(),
            });
        }
        if !RELEASE_QUALIFICATION_CEILINGS_V1
            .iter()
            .any(|ceiling| ceiling.workload_id == measurement.workload_id)
        {
            return Err(BenchmarkError::UnknownCeiling {
                workload_id: measurement.workload_id,
            });
        }
    }

    let mut comparisons = Vec::new();
    let mut passed = true;
    for ceiling in RELEASE_QUALIFICATION_CEILINGS_V1 {
        let comparison = match by_id.get(ceiling.workload_id) {
            Some(measurement) => {
                let ratio_micro = (measurement.elapsed_micros.saturating_mul(1_000_000))
                    / ceiling.ceiling_micros.max(1);
                let within_ceiling = measurement.elapsed_micros <= ceiling.ceiling_micros;
                if !within_ceiling {
                    passed = false;
                }
                CeilingComparison {
                    workload_id: ceiling.workload_id,
                    ceiling_micros: ceiling.ceiling_micros,
                    observed_micros: Some(measurement.elapsed_micros),
                    ratio_micro: Some(ratio_micro),
                    within_ceiling,
                }
            }
            None => {
                passed = false;
                CeilingComparison {
                    workload_id: ceiling.workload_id,
                    ceiling_micros: ceiling.ceiling_micros,
                    observed_micros: None,
                    ratio_micro: None,
                    within_ceiling: false,
                }
            }
        };
        comparisons.push(comparison);
    }
    Ok(QualificationReport {
        manifest_version: M6_BENCHMARK_MANIFEST_VERSION,
        profile: profile.name(),
        comparisons,
        passed,
    })
}

/// True when the hosted workflow requested ceiling enforcement.
pub fn hosted_enforcement_requested() -> bool {
    std::env::var(HOSTED_ENFORCEMENT_ENV).as_deref() == Ok("1")
}

/// Serializes measurements into machine-readable JSON for the hosted
/// workflow.
pub fn render_measurements_json(
    measurements: &[WorkloadMeasurement],
) -> Result<String, BenchmarkError> {
    Ok(serde_json::to_string_pretty(measurements)?)
}

/// Serializes a qualification report into machine-readable JSON.
pub fn render_qualification_json(report: &QualificationReport) -> Result<String, BenchmarkError> {
    Ok(serde_json::to_string_pretty(report)?)
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/// Runs every M6 benchmark workload in fixed manifest order.
pub fn run_all_workloads(
    profile: BenchmarkProfile,
) -> Result<Vec<WorkloadMeasurement>, BenchmarkError> {
    Ok(vec![
        run_content_preparation(profile)?,
        run_routine_dispatch(profile)?,
        run_bespoke_dispatch(profile)?,
        run_turn_execution(profile)?,
        run_solo_campaign(profile)?,
        run_coop_campaign(profile)?,
        run_snapshot_restoration(profile)?,
    ])
}
