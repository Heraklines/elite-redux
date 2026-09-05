//! M6D deterministic randomized solo multi-battle campaigns.
//!
//! A solo campaign plans a seeded sequence of complete battles over prepared
//! full content and drives every command, move, target, switch, and
//! replacement decision through raw physical key events only.  The driver has
//! no semantic surface: it observes the visible battle menu options exactly
//! like a player reading the screen, presses physical keys, settles battle
//! presentations through the virtual settlement callback, and records an
//! ordered trace whose canonical byte encoding must replay identically for an
//! identical seed.
//!
//! The production kernel boundary stays outside this crate (the kernel depends
//! on `er-game`, so the dependency edge cannot be reversed): hosts implement
//! [`SoloCampaignHost`] over their own kernel instance.  The trait exposes no
//! semantic command path, which structurally forbids fixture plans and
//! semantic input inside representative campaigns.
//!
//! Every campaign fails closed: input/settlement budgets, turn horizons,
//! terminal-outcome verification, zero-live-resource teardown, and
//! first-divergence replay evidence are all enforced here rather than trusted
//! from the host.

use std::collections::VecDeque;
use std::fmt;

use er_canonical::{CanonicalError, canonical_bytes, content_digest};
use er_rng::phaser::PhaserRdg;
use er_types::{
    InputFocus, LiveResourceSnapshot, PhysicalKey, RawInputEvent, SafeU53,
    battle_ids::BattlePresentationEventId, battle_model::BattleOutcome,
    battle_ui::BattlePresentationEvent,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Frozen schema version of the solo campaign configuration, plan, and trace.
pub const SOLO_CAMPAIGN_SCHEMA_VERSION: u32 = 1;

/// Upper bound on battles in one campaign; planning rejects larger runs.
pub const SOLO_CAMPAIGN_MAX_BATTLES: u32 = 64;

/// Scripted-enemy commands planned per battle.  Battles always terminate long
/// before this horizon; surplus entries are simply never consumed.
pub const SOLO_SCRIPTED_TURN_HORIZON: u32 = 512;

/// Seeded player party size is one; forced replacement coverage belongs to
/// the dedicated recovery and co-op campaign matrices.
const PARTY_SIZE_CARDINALITY: usize = 1;

/// Maximum ArrowDown presses spent walking one menu before failing closed.
const MAX_NAVIGATION_PRESSES: usize = 16;

/// Idle observation iterations tolerated while waiting for actionable control
/// before the campaign fails closed instead of spinning forever.
const MAX_IDLE_OBSERVATIONS: u32 = 64;

/// Physical keys used by the campaign driver.  No other key is ever sent.
const KEY_NAVIGATE_DOWN: PhysicalKey = PhysicalKey::ArrowDown;
const KEY_CONFIRM: PhysicalKey = PhysicalKey::Enter;

/// Frozen content identity the campaigns run over.
///
/// The host compiles/prepares its content once, then hands the closed index
/// tables to [`plan_solo_campaign`]; every battle plan and every trace header
/// binds this identity so a replay cannot silently run over other content.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SoloContentTable {
    /// Canonical digest of the prepared full content the host will execute.
    pub content_identity: String,
    /// Number of species definitions available to combatant planning.
    pub species_count: u32,
    /// Content move indexes usable as a combatant's sole damaging move
    /// (offensive category, non-zero power); campaigns never rely on
    /// status-move stalls to terminate.
    pub offensive_moves: Vec<u32>,
}

impl SoloContentTable {
    /// Validates the closed content index table, failing closed.
    #[expect(
        clippy::result_large_err,
        reason = "Preserve the historical by-value SoloCampaignError teardown diagnostic"
    )]
    pub fn validate(&self) -> Result<(), SoloCampaignError> {
        if self.content_identity.is_empty() {
            return Err(SoloCampaignError::Content(
                "content identity digest is empty".to_owned(),
            ));
        }
        if self.species_count == 0 {
            return Err(SoloCampaignError::Content(
                "content exposes no species".to_owned(),
            ));
        }
        if self.offensive_moves.is_empty() {
            return Err(SoloCampaignError::Content(
                "content exposes no offensive move for deterministic termination".to_owned(),
            ));
        }
        Ok(())
    }
}

/// Seeded campaign configuration.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SoloCampaignConfig {
    pub schema_version: u32,
    pub seed: String,
    pub battles: u32,
    pub max_inputs_per_battle: u32,
    pub max_settlements_per_battle: u32,
}

impl SoloCampaignConfig {
    /// Constructs a validated configuration with generous default budgets.
    #[expect(
        clippy::result_large_err,
        reason = "Preserve the historical by-value SoloCampaignError teardown diagnostic"
    )]
    pub fn new(seed: impl Into<String>, battles: u32) -> Result<Self, SoloCampaignError> {
        let config = Self {
            schema_version: SOLO_CAMPAIGN_SCHEMA_VERSION,
            seed: seed.into(),
            battles,
            max_inputs_per_battle: 4_096,
            max_settlements_per_battle: 4_096,
        };
        config.validate()?;
        Ok(config)
    }

    /// Validates every budget and identity field.
    #[expect(
        clippy::result_large_err,
        reason = "Preserve the historical by-value SoloCampaignError teardown diagnostic"
    )]
    pub fn validate(&self) -> Result<(), SoloCampaignError> {
        if self.schema_version != SOLO_CAMPAIGN_SCHEMA_VERSION {
            return Err(SoloCampaignError::Config(format!(
                "unsupported schema version {}",
                self.schema_version
            )));
        }
        if self.seed.is_empty() {
            return Err(SoloCampaignError::Config(
                "campaign seed is empty".to_owned(),
            ));
        }
        if self.battles == 0 || self.battles > SOLO_CAMPAIGN_MAX_BATTLES {
            return Err(SoloCampaignError::Config(format!(
                "battle count {} is outside 1..={SOLO_CAMPAIGN_MAX_BATTLES}",
                self.battles
            )));
        }
        if self.max_inputs_per_battle == 0 || self.max_settlements_per_battle == 0 {
            return Err(SoloCampaignError::Config(
                "per-battle budgets must be positive".to_owned(),
            ));
        }
        Ok(())
    }
}

/// Stat and vitality profile derived from the favored-side draw.
///
/// The favored side always attacks first and removes an opposing combatant
/// within a handful of turns, so every battle terminates without any
/// semantic orchestration while still exercising multi-turn menus, voluntary
/// switches, faint replacements, and both terminal outcomes across seeds.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SoloCombatantProfile {
    pub level: u16,
    pub hp: u32,
    pub attack: u32,
    pub defense: u32,
    pub special_attack: u32,
    pub special_defense: u32,
    pub speed: u32,
}

/// One planned combatant inside one battle.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SoloCombatantPlan {
    /// Unique Pokémon number inside the owning battle.
    pub pokemon_number: u64,
    /// Species slot picked from the frozen content table.
    pub species_slot: u32,
    /// Content move index of the combatant's single offensive move slot.
    pub move_slot: u32,
    pub profile: SoloCombatantProfile,
}

/// One planned battle of the campaign.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SoloBattlePlan {
    pub battle_index: u32,
    /// One-based wave number installed into the run state.
    pub wave_number: u64,
    pub wave_seed: String,
    pub run_seed: String,
    pub scripted_turns: u32,
    pub player_party: Vec<SoloCombatantPlan>,
    pub enemy: SoloCombatantPlan,
}

/// Complete deterministic campaign plan.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SoloCampaignPlan {
    pub content_identity: String,
    pub battles: Vec<SoloBattlePlan>,
}

impl SoloCampaignPlan {
    /// Canonical blake3 digest binding the plan (and thereby the content
    /// identity) into every trace.
    #[expect(
        clippy::result_large_err,
        reason = "Preserve the historical by-value SoloCampaignError teardown diagnostic"
    )]
    pub fn digest(&self) -> Result<String, SoloCampaignError> {
        Ok(format!("blake3-v1:{}", content_digest(self)?))
    }
}

/// Plans the whole campaign from `(seed, "m6-solo-campaign-plan")` sowing.
///
/// Draw order is fixed: party size, favored side, then per-combatant species,
/// move, and level draws.  Planning is pure, so identical configurations
/// produce identical plans.
#[expect(
    clippy::result_large_err,
    reason = "Preserve the historical by-value SoloCampaignError teardown diagnostic"
)]
pub fn plan_solo_campaign(
    config: &SoloCampaignConfig,
    table: &SoloContentTable,
) -> Result<SoloCampaignPlan, SoloCampaignError> {
    config.validate()?;
    table.validate()?;
    let mut rng = PhaserRdg::from_seeds(&[config.seed.as_str(), "m6-solo-campaign-plan"]);
    let mut battles = Vec::with_capacity(usize::try_from(config.battles).unwrap_or(0));
    for battle_index in 0..config.battles {
        let party_size = rng.pick_index(PARTY_SIZE_CARDINALITY)? + 1;
        let player_favored = rng.pick_index(2)? == 0;
        let mut player_party = Vec::with_capacity(party_size);
        for ordinal in 0..party_size {
            player_party.push(combatant_plan(
                &mut rng,
                table,
                u64::try_from(ordinal).unwrap_or(0) + 1,
                player_favored,
            )?);
        }
        let enemy = combatant_plan(
            &mut rng,
            table,
            u64::try_from(party_size).unwrap_or(0) + 1,
            !player_favored,
        )?;
        battles.push(SoloBattlePlan {
            battle_index,
            wave_number: u64::from(battle_index) + 1,
            wave_seed: format!("{}|battle/{battle_index}|wave", config.seed),
            run_seed: format!("{}|battle/{battle_index}|run", config.seed),
            scripted_turns: SOLO_SCRIPTED_TURN_HORIZON,
            player_party,
            enemy,
        });
    }
    Ok(SoloCampaignPlan {
        content_identity: table.content_identity.clone(),
        battles,
    })
}

#[expect(
    clippy::result_large_err,
    reason = "Propagate the historical by-value SoloCampaignError without changing its payload"
)]
fn combatant_plan(
    rng: &mut PhaserRdg,
    table: &SoloContentTable,
    pokemon_number: u64,
    favored: bool,
) -> Result<SoloCombatantPlan, SoloCampaignError> {
    let species_slot =
        u32::try_from(rng.pick_index(usize::try_from(table.species_count).unwrap_or(1))?)
            .unwrap_or(0);
    let move_choice = rng.pick_index(table.offensive_moves.len())?;
    let move_slot = table.offensive_moves[move_choice];
    let level = rng
        .integer_in_range(
            SafeU53::new(30).map_err(|error| SoloCampaignError::Planning(error.to_string()))?,
            SafeU53::new(80).map_err(|error| SoloCampaignError::Planning(error.to_string()))?,
        )
        .map_err(SoloCampaignError::from)?;
    Ok(SoloCombatantPlan {
        pokemon_number,
        species_slot,
        move_slot,
        profile: combatant_profile(u16::try_from(level.get()).unwrap_or(u16::MAX), favored),
    })
}

/// Favored combatants hit roughly ten times harder and faster with a wide
/// vitality margin; underdogs still deal guaranteed chip damage so both
/// directions of terminal outcome remain reachable across seeds.
fn combatant_profile(level: u16, favored: bool) -> SoloCombatantProfile {
    if favored {
        SoloCombatantProfile {
            level,
            hp: 400,
            attack: 400,
            defense: 120,
            special_attack: 400,
            special_defense: 120,
            speed: 300,
        }
    } else {
        SoloCombatantProfile {
            level,
            hp: 45,
            attack: 60,
            defense: 40,
            special_attack: 60,
            special_defense: 40,
            speed: 20,
        }
    }
}

/// Visible control kinds observed through the host projection.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SoloControlKind {
    CommandRoot,
    MoveSelect,
    TargetSelect,
    PartySelect,
    PartyOptionSelect,
    ReplacementSelect,
    Waiting,
    Complete,
}

/// What the driver may "see" of the current battle screen.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SoloObservation {
    pub control: SoloControlKind,
    /// Visible option ids in menu order.
    pub options: Vec<String>,
    /// Currently selected option id.
    pub selected: String,
    /// One-based battle turn from the projection.
    pub turn: u64,
    pub actionable: bool,
    /// Terminal outcome once the control reaches `Complete`.
    pub outcome: Option<BattleOutcome>,
}

/// Host seam implemented over the production battle kernel by the test layer.
///
/// The trait deliberately exposes only physical inputs, presentation
/// settlement, observations, frontier digests, live-resource snapshots, and
/// disposal.  There is no semantic command, proposal, or material path.
pub trait SoloCampaignHost {
    type Error: fmt::Display;

    /// Opens the planned battle and returns the initial observation plus any
    /// presentations emitted during construction.
    fn open_battle(
        &mut self,
        plan: &SoloBattlePlan,
    ) -> Result<(SoloObservation, Vec<BattlePresentationEvent>), Self::Error>;

    /// Delivers one raw physical input event to the local seat.
    fn deliver_raw_input(
        &mut self,
        event: RawInputEvent,
    ) -> Result<Vec<BattlePresentationEvent>, Self::Error>;

    /// Settles one battle presentation through the virtual renderer callback.
    fn settle_presentation(
        &mut self,
        event_id: &BattlePresentationEventId,
    ) -> Result<Vec<BattlePresentationEvent>, Self::Error>;

    /// Re-reads the current screen observation.
    fn observe(&self) -> Result<SoloObservation, Self::Error>;

    /// Canonical blake3 digest over the complete serialized mechanical
    /// frontier (state, RNG, audit, next control).
    fn frontier_digest(&self) -> Result<String, Self::Error>;

    /// Typed live-resource projection used for teardown verification.
    fn live_resources(&self) -> Result<LiveResourceSnapshot, Self::Error>;

    /// Disposes the current battle kernel; must be idempotent.
    fn close_battle(&mut self) -> Result<(), Self::Error>;
}

/// Ordered campaign evidence recorded while driving.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum SoloTraceEntry {
    CampaignPlanned {
        plan_digest: String,
        content_identity: String,
        battles: u32,
    },
    BattleOpened {
        index: u32,
        wave_seed: String,
        frontier_digest: String,
    },
    /// One raw physical event exactly as delivered to the kernel.
    RawInput {
        battle_index: u32,
        event: RawInputEvent,
    },
    PresentationEmitted {
        event: BattlePresentationEvent,
    },
    PresentationSettled {
        battle_index: u32,
        event_id: BattlePresentationEventId,
    },
    /// Mechanical frontier digest captured whenever control returns to an
    /// actionable boundary or reaches completion.
    FrontierDigest {
        battle_index: u32,
        digest: String,
    },
    BattleTerminal {
        index: u32,
        outcome: BattleOutcome,
        inputs: u32,
        settlements: u32,
    },
    BattleClosed {
        index: u32,
        resources_zero: bool,
    },
    CampaignCompleted {
        battles: u32,
        total_inputs: u32,
    },
}

/// Per-battle summary of a completed campaign run.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SoloBattleRecord {
    pub index: u32,
    pub outcome: BattleOutcome,
    pub inputs: u32,
    pub settlements: u32,
    /// Final mechanical frontier digest of the disposed battle.
    pub final_frontier_digest: String,
}

/// Everything one campaign execution produced.
#[derive(Clone, Debug)]
pub struct SoloCampaignRun {
    pub report: SoloCampaignReport,
    pub trace: Vec<SoloTraceEntry>,
    /// Canonical byte encoding of `trace`; replays must match byte-for-byte.
    pub trace_bytes: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SoloCampaignReport {
    pub config: SoloCampaignConfig,
    pub content_identity: String,
    pub plan_digest: String,
    pub battles: Vec<SoloBattleRecord>,
}

/// First divergence between two traces, with both serialized entries.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SoloFirstDivergence {
    pub entry_index: usize,
    pub expected: serde_json::Value,
    pub actual: serde_json::Value,
}

/// Locates the first differing entry between two campaign runs.
///
/// Returns `None` when the traces are entry-identical; callers separately
/// compare `trace_bytes` for the byte-identical guarantee.
pub fn first_trace_divergence(
    expected: &SoloCampaignRun,
    actual: &SoloCampaignRun,
) -> Option<SoloFirstDivergence> {
    let shared = expected.trace.len().min(actual.trace.len());
    for index in 0..shared {
        if expected.trace[index] != actual.trace[index] {
            return Some(SoloFirstDivergence {
                entry_index: index,
                expected: serde_json::to_value(&expected.trace[index]).ok()?,
                actual: serde_json::to_value(&actual.trace[index]).ok()?,
            });
        }
    }
    if expected.trace.len() != actual.trace.len() {
        let longer_is_expected = expected.trace.len() > actual.trace.len();
        return Some(SoloFirstDivergence {
            entry_index: shared,
            expected: longer_is_expected
                .then(|| serde_json::to_value(&expected.trace[shared]).ok())
                .flatten()
                .unwrap_or(serde_json::Value::Null),
            actual: (!longer_is_expected)
                .then(|| serde_json::to_value(&actual.trace[shared]).ok())
                .flatten()
                .unwrap_or(serde_json::Value::Null),
        });
    }
    None
}

#[derive(Debug, Error)]
#[expect(
    clippy::large_enum_variant,
    reason = "Preserve the public by-value LiveResourceSnapshot in the historical TeardownLeak variant"
)]
pub enum SoloCampaignError {
    #[error("invalid solo campaign configuration: {0}")]
    Config(String),
    #[error("invalid solo content table: {0}")]
    Content(String),
    #[error("planning failed: {0}")]
    Planning(String),
    #[error("host rejected {step}: {message}")]
    Host { step: &'static str, message: String },
    #[error("battle {battle_index} exhausted its {budget}-input budget without terminating")]
    InputBudgetExhausted { battle_index: u32, budget: u32 },
    #[error("battle {battle_index} exhausted its {budget}-settlement budget")]
    SettlementBudgetExhausted { battle_index: u32, budget: u32 },
    #[error("battle {battle_index} exceeded the {horizon}-turn scripted horizon at turn {turn}")]
    TurnHorizonExceeded {
        battle_index: u32,
        horizon: u32,
        turn: u64,
    },
    #[error("battle {battle_index} stalled without an actionable control")]
    IdleStall { battle_index: u32 },
    #[error("navigation to option {option:?} failed in battle {battle_index}")]
    NavigationFailed { battle_index: u32, option: String },
    #[error("battle {battle_index} reached Complete without a terminal outcome")]
    NotTerminal { battle_index: u32 },
    #[error("battle {battle_index} closed with live resources: {resources:?}")]
    TeardownLeak {
        battle_index: u32,
        resources: LiveResourceSnapshot,
    },
    #[error("canonical serialization failed: {0}")]
    Canonical(#[from] CanonicalError),
    #[error("campaign RNG failed: {0}")]
    Rng(#[from] er_rng::phaser::RngError),
}

struct BattleCounters {
    inputs: u32,
    settlements: u32,
    idle_observations: u32,
}

impl BattleCounters {
    fn new() -> Self {
        Self {
            inputs: 0,
            settlements: 0,
            idle_observations: 0,
        }
    }
}

/// Runs the complete campaign against `host`, enforcing budgets, terminal
/// outcomes, and zero-resource teardown after every battle.
#[expect(
    clippy::result_large_err,
    reason = "Preserve the historical by-value SoloCampaignError teardown diagnostic"
)]
pub fn run_solo_campaign<H: SoloCampaignHost>(
    host: &mut H,
    config: &SoloCampaignConfig,
    table: &SoloContentTable,
) -> Result<SoloCampaignRun, SoloCampaignError> {
    let plan = plan_solo_campaign(config, table)?;
    let plan_digest = plan.digest()?;
    let mut trace = vec![SoloTraceEntry::CampaignPlanned {
        plan_digest: plan_digest.clone(),
        content_identity: plan.content_identity.clone(),
        battles: config.battles,
    }];

    let mut records = Vec::with_capacity(plan.battles.len());
    let mut total_inputs = 0_u32;
    for battle_plan in &plan.battles {
        let record = run_single_battle(host, config, battle_plan, &mut trace)?;
        total_inputs += record.inputs;
        records.push(record);
    }

    trace.push(SoloTraceEntry::CampaignCompleted {
        battles: config.battles,
        total_inputs,
    });
    let trace_bytes = canonical_bytes(&trace)?;
    Ok(SoloCampaignRun {
        report: SoloCampaignReport {
            config: config.clone(),
            content_identity: plan.content_identity,
            plan_digest,
            battles: records,
        },
        trace,
        trace_bytes,
    })
}

#[expect(
    clippy::result_large_err,
    reason = "Propagate the historical by-value SoloCampaignError without changing its payload"
)]
fn run_single_battle<H: SoloCampaignHost>(
    host: &mut H,
    config: &SoloCampaignConfig,
    plan: &SoloBattlePlan,
    trace: &mut Vec<SoloTraceEntry>,
) -> Result<SoloBattleRecord, SoloCampaignError> {
    let battle_index = plan.battle_index;
    let mut counters = BattleCounters::new();
    let (_opening_observation, opening_events) = host
        .open_battle(plan)
        .map_err(|error| host_error("open_battle", error))?;
    let frontier_digest = host
        .frontier_digest()
        .map_err(|error| host_error("frontier_digest", error))?;
    trace.push(SoloTraceEntry::BattleOpened {
        index: battle_index,
        wave_seed: plan.wave_seed.clone(),
        frontier_digest,
    });

    // Deterministic driving RNG, independent from planning and battle RNG.
    let drive_seed = format!("drive/{}", battle_index);
    let mut drive_rng = PhaserRdg::from_seeds(&[config.seed.as_str(), drive_seed.as_str()]);

    let mut pending: VecDeque<BattlePresentationEvent> = opening_events.into_iter().collect();
    drain_presentations(
        host,
        trace,
        battle_index,
        config,
        &mut counters,
        &mut pending,
    )?;

    let outcome = loop {
        let observation = host
            .observe()
            .map_err(|error| host_error("observe", error))?;
        match observation.control {
            SoloControlKind::Complete => {
                break observation
                    .outcome
                    .ok_or(SoloCampaignError::NotTerminal { battle_index })?;
            }
            SoloControlKind::Waiting => {
                counters.idle_observations += 1;
                if counters.idle_observations > MAX_IDLE_OBSERVATIONS {
                    return Err(SoloCampaignError::IdleStall { battle_index });
                }
                continue;
            }
            SoloControlKind::CommandRoot => {
                counters.idle_observations = 0;
                verify_turn_horizon(battle_index, plan, observation.turn)?;
                press_command_root(
                    host,
                    config,
                    trace,
                    plan,
                    battle_index,
                    &mut counters,
                    &mut drive_rng,
                    &observation,
                    &mut pending,
                )?;
            }
            SoloControlKind::MoveSelect => {
                counters.idle_observations = 0;
                verify_turn_horizon(battle_index, plan, observation.turn)?;
                let target = first_option(&observation, battle_index)?;
                select_and_confirm(
                    host,
                    trace,
                    battle_index,
                    config,
                    &mut counters,
                    &target,
                    &mut pending,
                )?;
            }
            SoloControlKind::PartyOptionSelect => {
                counters.idle_observations = 0;
                let target = observation
                    .options
                    .iter()
                    .find(|option| option.contains("switch"))
                    .cloned()
                    .unwrap_or(first_option(&observation, battle_index)?);
                select_and_confirm(
                    host,
                    trace,
                    battle_index,
                    config,
                    &mut counters,
                    &target,
                    &mut pending,
                )?;
            }
            SoloControlKind::TargetSelect
            | SoloControlKind::PartySelect
            | SoloControlKind::ReplacementSelect => {
                counters.idle_observations = 0;
                let target = first_option(&observation, battle_index)?;
                select_and_confirm(
                    host,
                    trace,
                    battle_index,
                    config,
                    &mut counters,
                    &target,
                    &mut pending,
                )?;
            }
        }

        // Presentations emitted by the last action settle before any further
        // decision, mirroring virtual renderer callback ordering.
        drain_presentations(
            host,
            trace,
            battle_index,
            config,
            &mut counters,
            &mut pending,
        )?;

        let settled_observation = host
            .observe()
            .map_err(|error| host_error("observe", error))?;
        match settled_observation.control {
            SoloControlKind::CommandRoot | SoloControlKind::Complete => {
                let digest = host
                    .frontier_digest()
                    .map_err(|error| host_error("frontier_digest", error))?;
                trace.push(SoloTraceEntry::FrontierDigest {
                    battle_index,
                    digest,
                });
            }
            _ => {
                counters.idle_observations += 1;
                if counters.idle_observations > MAX_IDLE_OBSERVATIONS {
                    return Err(SoloCampaignError::IdleStall { battle_index });
                }
            }
        }
    };

    if !matches!(outcome, BattleOutcome::Victory | BattleOutcome::Defeat) {
        return Err(SoloCampaignError::NotTerminal { battle_index });
    }
    drain_presentations(
        host,
        trace,
        battle_index,
        config,
        &mut counters,
        &mut pending,
    )?;
    let final_frontier_digest = host
        .frontier_digest()
        .map_err(|error| host_error("frontier_digest", error))?;

    let resources = host
        .live_resources()
        .map_err(|error| host_error("live_resources", error))?;
    if resources != LiveResourceSnapshot::default() {
        return Err(SoloCampaignError::TeardownLeak {
            battle_index,
            resources,
        });
    }
    trace.push(SoloTraceEntry::BattleTerminal {
        index: battle_index,
        outcome,
        inputs: counters.inputs,
        settlements: counters.settlements,
    });

    host.close_battle()
        .map_err(|error| host_error("close_battle", error))?;
    // Closing twice must be idempotent; the second close verifies that.
    host.close_battle()
        .map_err(|error| host_error("close_battle_idempotent", error))?;
    trace.push(SoloTraceEntry::BattleClosed {
        index: battle_index,
        resources_zero: true,
    });

    Ok(SoloBattleRecord {
        index: battle_index,
        outcome,
        inputs: counters.inputs,
        settlements: counters.settlements,
        final_frontier_digest,
    })
}

#[allow(clippy::too_many_arguments)]
#[expect(
    clippy::result_large_err,
    reason = "Propagate the historical by-value SoloCampaignError without changing its payload"
)]
fn press_command_root<H: SoloCampaignHost>(
    host: &mut H,
    config: &SoloCampaignConfig,
    trace: &mut Vec<SoloTraceEntry>,
    _plan: &SoloBattlePlan,
    battle_index: u32,
    counters: &mut BattleCounters,
    _drive_rng: &mut PhaserRdg,
    observation: &SoloObservation,
    pending: &mut VecDeque<BattlePresentationEvent>,
) -> Result<(), SoloCampaignError> {
    let fight_target = observation
        .options
        .iter()
        .find(|option| option.as_str() == "command/fight")
        .cloned()
        .unwrap_or_else(|| observation.selected.clone());
    select_and_confirm(
        host,
        trace,
        battle_index,
        config,
        counters,
        &fight_target,
        pending,
    )
}

#[expect(
    clippy::result_large_err,
    reason = "Propagate the historical by-value SoloCampaignError without changing its payload"
)]
fn first_option(
    observation: &SoloObservation,
    battle_index: u32,
) -> Result<String, SoloCampaignError> {
    observation
        .options
        .first()
        .cloned()
        .ok_or_else(|| SoloCampaignError::NavigationFailed {
            battle_index,
            option: "<empty-menu>".to_owned(),
        })
}

#[expect(
    clippy::result_large_err,
    reason = "Propagate the historical by-value SoloCampaignError without changing its payload"
)]
fn select_and_confirm<H: SoloCampaignHost>(
    host: &mut H,
    trace: &mut Vec<SoloTraceEntry>,
    battle_index: u32,
    config: &SoloCampaignConfig,
    counters: &mut BattleCounters,
    target: &str,
    pending: &mut VecDeque<BattlePresentationEvent>,
) -> Result<(), SoloCampaignError> {
    // Walk the selection onto the target using only ArrowDown, re-reading the
    // screen after every press like a physical player would.
    for _ in 0..=MAX_NAVIGATION_PRESSES {
        let observation = host
            .observe()
            .map_err(|error| host_error("observe", error))?;
        if observation.selected == target {
            break;
        }
        press_key(
            host,
            trace,
            battle_index,
            config,
            counters,
            KEY_NAVIGATE_DOWN,
            pending,
        )?;
    }
    let observation = host
        .observe()
        .map_err(|error| host_error("observe", error))?;
    if observation.selected != target {
        return Err(SoloCampaignError::NavigationFailed {
            battle_index,
            option: target.to_owned(),
        });
    }
    press_key(
        host,
        trace,
        battle_index,
        config,
        counters,
        KEY_CONFIRM,
        pending,
    )
}

/// Delivers one physical press (down followed by up), recording both events.
#[expect(
    clippy::result_large_err,
    reason = "Propagate the historical by-value SoloCampaignError without changing its payload"
)]
fn press_key<H: SoloCampaignHost>(
    host: &mut H,
    trace: &mut Vec<SoloTraceEntry>,
    battle_index: u32,
    config: &SoloCampaignConfig,
    counters: &mut BattleCounters,
    code: PhysicalKey,
    pending: &mut VecDeque<BattlePresentationEvent>,
) -> Result<(), SoloCampaignError> {
    let down = RawInputEvent::KeyDown {
        code: code.clone(),
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    };
    let up = RawInputEvent::KeyUp { code };
    for event in [down, up] {
        if counters.inputs >= config.max_inputs_per_battle {
            return Err(SoloCampaignError::InputBudgetExhausted {
                battle_index,
                budget: config.max_inputs_per_battle,
            });
        }
        counters.inputs += 1;
        trace.push(SoloTraceEntry::RawInput {
            battle_index,
            event: event.clone(),
        });
        let emitted = host
            .deliver_raw_input(event)
            .map_err(|error| host_error("deliver_raw_input", error))?;
        pending.extend(emitted);
    }
    Ok(())
}

#[expect(
    clippy::result_large_err,
    reason = "Propagate the historical by-value SoloCampaignError without changing its payload"
)]
fn drain_presentations<H: SoloCampaignHost>(
    host: &mut H,
    trace: &mut Vec<SoloTraceEntry>,
    battle_index: u32,
    config: &SoloCampaignConfig,
    counters: &mut BattleCounters,
    queue: &mut VecDeque<BattlePresentationEvent>,
) -> Result<(), SoloCampaignError> {
    while let Some(event) = queue.pop_front() {
        if counters.settlements >= config.max_settlements_per_battle {
            return Err(SoloCampaignError::SettlementBudgetExhausted {
                battle_index,
                budget: config.max_settlements_per_battle,
            });
        }
        counters.settlements += 1;
        trace.push(SoloTraceEntry::PresentationEmitted {
            event: event.clone(),
        });
        trace.push(SoloTraceEntry::PresentationSettled {
            battle_index,
            event_id: event.event_id.clone(),
        });
        let emitted = host
            .settle_presentation(&event.event_id)
            .map_err(|error| host_error("settle_presentation", error))?;
        queue.extend(emitted);
    }
    Ok(())
}

#[expect(
    clippy::result_large_err,
    reason = "Propagate the historical by-value SoloCampaignError without changing its payload"
)]
fn verify_turn_horizon(
    battle_index: u32,
    plan: &SoloBattlePlan,
    turn: u64,
) -> Result<(), SoloCampaignError> {
    if turn > u64::from(plan.scripted_turns) {
        return Err(SoloCampaignError::TurnHorizonExceeded {
            battle_index,
            horizon: plan.scripted_turns,
            turn,
        });
    }
    Ok(())
}

fn host_error<E: fmt::Display>(step: &'static str, error: E) -> SoloCampaignError {
    SoloCampaignError::Host {
        step,
        message: error.to_string(),
    }
}
