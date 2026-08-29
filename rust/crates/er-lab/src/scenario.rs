//! Typed M7.2 scenario families, stable-boundary policy, and reachability evidence.

use std::sync::Arc;

use er_game::m7_content::PreparedGameContentV1;
use er_sim::snapshot::RestorablePairSnapshotV2;
use er_state::m7_state::{GameStateV5, PokemonStateV5, ProfileStateV1};
use er_types::battle_ids::{BattleFormat, GameModeId, PokemonId, WaveIndex};
use er_types::battle_model::{TerrainKind, WeatherKind};
use er_types::run_ids::BiomeId;
use er_types::{EvolutionId, GameControlKindV2, Money, ScenarioId, ScenarioNodeId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const SCENARIO_SPECIFICATION_VERSION_V1: u32 = 1;

macro_rules! string_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub String);
    };
}

string_id!(ReproCapsuleIdV1);
string_id!(ContentIdentityV1);
string_id!(GameBehaviorUnitIdV1);
string_id!(ScenarioAssumptionV1);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreRunScenarioV1 {
    pub profile: ProfileStateV1,
    pub seed: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleScenarioV1 {
    pub seed: String,
    pub mode: GameModeId,
    pub wave: WaveIndex,
    pub format: BattleFormat,
    pub player_party: Vec<PokemonStateV5>,
    pub enemy_party: Vec<PokemonStateV5>,
    pub player_field: Vec<PokemonId>,
    pub enemy_field: Vec<PokemonId>,
    pub weather: Option<WeatherKind>,
    pub terrain: Option<TerrainKind>,
    pub desired_control: GameControlKindV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum RunSurfaceScenarioV1 {
    Reward {
        party: Vec<PokemonStateV5>,
        money: Money,
        option_ids: Vec<String>,
    },
    Market {
        party: Vec<PokemonStateV5>,
        money: Money,
        stock_ids: Vec<String>,
    },
    MoveLearning {
        pokemon: Box<PokemonStateV5>,
        move_id: er_types::battle_ids::MoveId,
    },
    Evolution {
        pokemon: Box<PokemonStateV5>,
        evolution: EvolutionId,
    },
    Fusion {
        primary: Box<PokemonStateV5>,
        partner: Box<PokemonStateV5>,
    },
    BiomeSelection {
        current: BiomeId,
        options: Vec<BiomeId>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProgressionScenarioV1 {
    pub seed: String,
    pub party: Vec<PokemonStateV5>,
    pub desired_control: GameControlKindV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureScenarioV1 {
    pub seed: String,
    pub party: Vec<PokemonStateV5>,
    pub target: PokemonStateV5,
    pub force_full_party: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorldScenarioV1 {
    pub seed: String,
    pub current_biome: BiomeId,
    pub options: Vec<BiomeId>,
    pub desired_control: GameControlKindV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioNodeScenarioV1 {
    pub seed: String,
    pub scenario: ScenarioId,
    pub node: ScenarioNodeId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SoloRecoveryScenarioV1 {
    pub capsule: ReproCapsuleIdV1,
    pub target_sequence: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairRecoveryScenarioV1 {
    pub capsule: ReproCapsuleIdV1,
    pub target_sequence: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TerminalScenarioV1 {
    pub seed: String,
    pub state: Box<GameStateV5>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum ScenarioSpecificationV1 {
    PreRun(Box<PreRunScenarioV1>),
    Battle(Box<BattleScenarioV1>),
    RunSurface(Box<RunSurfaceScenarioV1>),
    Progression(Box<ProgressionScenarioV1>),
    Capture(Box<CaptureScenarioV1>),
    World(Box<WorldScenarioV1>),
    ScenarioNode(Box<ScenarioNodeScenarioV1>),
    SoloRecovery(Box<SoloRecoveryScenarioV1>),
    PairRecovery(Box<PairRecoveryScenarioV1>),
    Terminal(Box<TerminalScenarioV1>),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConstructorWitnessV1 {
    pub constructor: String,
    pub input_digest: String,
    pub output_digest: String,
    pub validators: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum ScenarioReachabilityV1 {
    RecordedNatural { capsule: ReproCapsuleIdV1 },
    CanonicallyGenerated { witness: ConstructorWitnessV1 },
    SyntheticValid { limitations: Vec<String> },
    InvalidNegativeTest { expected_error: String },
}

#[derive(Clone, Debug, PartialEq)]
pub enum ScenarioSnapshotV1 {
    SoloState(Box<GameStateV5>),
    Pair(Box<RestorablePairSnapshotV2>),
    ReplayRequired {
        capsule: ReproCapsuleIdV1,
        target_sequence: u64,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioValidationReportV1 {
    pub state_valid: bool,
    pub content_valid: bool,
    pub control_valid: bool,
    pub scheduler_valid: bool,
    pub protocol_valid: bool,
    pub stable_boundary: bool,
    pub checks: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BuiltScenarioV1 {
    pub snapshot: ScenarioSnapshotV1,
    pub provenance: ScenarioReachabilityV1,
    pub content_dependencies: Vec<ContentIdentityV1>,
    pub behavior_dependencies: Vec<GameBehaviorUnitIdV1>,
    pub assumptions: Vec<ScenarioAssumptionV1>,
    pub validation: ScenarioValidationReportV1,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScenarioClaimV1 {
    FocusedMechanic,
    ProductionReproducer,
    FullProgressionParity,
    FullCampaignParity,
    NegativeRejection,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ScenarioErrorV1 {
    #[error("scenario specification is malformed or exceeds a bound")]
    InvalidSpecification,
    #[error("scenario requires snapshot or capsule replay")]
    ReplayRequired,
    #[error("scenario constructor failed: {0}")]
    Constructor(String),
    #[error("scenario snapshot or provenance is invalid")]
    Validation,
    #[error("scenario reachability cannot support the requested claim")]
    Claim,
}

pub trait CanonicalScenarioConstructorV1: std::fmt::Debug {
    fn construct(
        &self,
        specification: &ScenarioSpecificationV1,
        content: &PreparedGameContentV1,
    ) -> Result<BuiltScenarioV1, ScenarioErrorV1>;
}

#[derive(Debug)]
pub struct ScenarioFoundryV1<C> {
    content: Arc<PreparedGameContentV1>,
    constructor: C,
    maximum_party: usize,
    maximum_options: usize,
}

impl<C: CanonicalScenarioConstructorV1> ScenarioFoundryV1<C> {
    pub fn new(
        content: Arc<PreparedGameContentV1>,
        constructor: C,
        maximum_party: usize,
        maximum_options: usize,
    ) -> Result<Self, ScenarioErrorV1> {
        if maximum_party == 0 || maximum_options == 0 {
            return Err(ScenarioErrorV1::InvalidSpecification);
        }
        Ok(Self {
            content,
            constructor,
            maximum_party,
            maximum_options,
        })
    }

    pub fn build(
        &self,
        specification: &ScenarioSpecificationV1,
    ) -> Result<BuiltScenarioV1, ScenarioErrorV1> {
        validate_specification(specification, self.maximum_party, self.maximum_options)?;
        if let ScenarioSpecificationV1::SoloRecovery(value) = specification {
            return Ok(replay_scenario(
                value.capsule.clone(),
                value.target_sequence,
            ));
        }
        if let ScenarioSpecificationV1::PairRecovery(value) = specification {
            return Ok(replay_scenario(
                value.capsule.clone(),
                value.target_sequence,
            ));
        }
        let mut built = self.constructor.construct(specification, &self.content)?;
        normalize_dependencies(&mut built)?;
        built.validate(&self.content)?;
        Ok(built)
    }
}

impl BuiltScenarioV1 {
    pub fn validate(&self, content: &PreparedGameContentV1) -> Result<(), ScenarioErrorV1> {
        validate_reachability(&self.provenance)?;
        if self
            .content_dependencies
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
            || self
                .behavior_dependencies
                .windows(2)
                .any(|pair| pair[0] >= pair[1])
            || self.assumptions.windows(2).any(|pair| pair[0] >= pair[1])
            || self
                .content_dependencies
                .iter()
                .any(|value| value.0.is_empty())
            || self
                .behavior_dependencies
                .iter()
                .any(|value| value.0.is_empty())
            || self.assumptions.iter().any(|value| value.0.is_empty())
            || !self.validation.stable_boundary
        {
            return Err(ScenarioErrorV1::Validation);
        }
        match &self.snapshot {
            ScenarioSnapshotV1::SoloState(state) => {
                state.validate().map_err(|_| ScenarioErrorV1::Validation)?;
                if state.content_identity != *content.identity()
                    || state
                        .active_run
                        .as_ref()
                        .is_some_and(|run| run.control.validate().is_err())
                {
                    return Err(ScenarioErrorV1::Validation);
                }
            }
            ScenarioSnapshotV1::Pair(_) => {
                if !self.validation.scheduler_valid || !self.validation.protocol_valid {
                    return Err(ScenarioErrorV1::Validation);
                }
            }
            ScenarioSnapshotV1::ReplayRequired { capsule, .. } if capsule.0.is_empty() => {
                return Err(ScenarioErrorV1::Validation);
            }
            ScenarioSnapshotV1::ReplayRequired { .. } => {}
        }
        Ok(())
    }

    pub fn allows_claim(&self, claim: ScenarioClaimV1) -> bool {
        matches!(
            (&self.provenance, claim),
            (ScenarioReachabilityV1::RecordedNatural { .. }, _)
                | (
                    ScenarioReachabilityV1::CanonicallyGenerated { .. },
                    ScenarioClaimV1::FocusedMechanic
                )
                | (
                    ScenarioReachabilityV1::SyntheticValid { .. },
                    ScenarioClaimV1::FocusedMechanic
                )
                | (
                    ScenarioReachabilityV1::InvalidNegativeTest { .. },
                    ScenarioClaimV1::NegativeRejection
                )
        )
    }
}

fn validate_specification(
    specification: &ScenarioSpecificationV1,
    maximum_party: usize,
    maximum_options: usize,
) -> Result<(), ScenarioErrorV1> {
    let party_valid = |party: &[PokemonStateV5]| {
        !party.is_empty()
            && party.len() <= maximum_party
            && party.iter().all(|pokemon| pokemon.validate().is_ok())
    };
    let valid = match specification {
        ScenarioSpecificationV1::PreRun(value) => !value.seed.is_empty(),
        ScenarioSpecificationV1::Battle(value) => {
            !value.seed.is_empty()
                && party_valid(&value.player_party)
                && party_valid(&value.enemy_party)
                && value.player_field.len() <= 3
                && value.enemy_field.len() <= 3
                && matches!(
                    value.desired_control,
                    GameControlKindV2::BattleCommand | GameControlKindV2::BattleReplacement
                )
        }
        ScenarioSpecificationV1::RunSurface(value) => match &**value {
            RunSurfaceScenarioV1::Reward {
                party, option_ids, ..
            } => {
                party_valid(party) && !option_ids.is_empty() && option_ids.len() <= maximum_options
            }
            RunSurfaceScenarioV1::Market {
                party, stock_ids, ..
            } => party_valid(party) && !stock_ids.is_empty() && stock_ids.len() <= maximum_options,
            RunSurfaceScenarioV1::MoveLearning { pokemon, .. }
            | RunSurfaceScenarioV1::Evolution { pokemon, .. } => pokemon.validate().is_ok(),
            RunSurfaceScenarioV1::Fusion { primary, partner } => {
                primary.validate().is_ok() && partner.validate().is_ok() && primary.id != partner.id
            }
            RunSurfaceScenarioV1::BiomeSelection { options, .. } => {
                !options.is_empty() && options.len() <= maximum_options
            }
        },
        ScenarioSpecificationV1::Progression(value) => {
            !value.seed.is_empty() && party_valid(&value.party)
        }
        ScenarioSpecificationV1::Capture(value) => {
            !value.seed.is_empty() && party_valid(&value.party) && value.target.validate().is_ok()
        }
        ScenarioSpecificationV1::World(value) => {
            !value.seed.is_empty()
                && !value.options.is_empty()
                && value.options.len() <= maximum_options
        }
        ScenarioSpecificationV1::ScenarioNode(value) => !value.seed.is_empty(),
        ScenarioSpecificationV1::SoloRecovery(value) => !value.capsule.0.is_empty(),
        ScenarioSpecificationV1::PairRecovery(value) => !value.capsule.0.is_empty(),
        ScenarioSpecificationV1::Terminal(value) => {
            !value.seed.is_empty() && value.state.validate().is_ok()
        }
    };
    if valid {
        Ok(())
    } else {
        Err(ScenarioErrorV1::InvalidSpecification)
    }
}

fn validate_reachability(value: &ScenarioReachabilityV1) -> Result<(), ScenarioErrorV1> {
    let valid = match value {
        ScenarioReachabilityV1::RecordedNatural { capsule } => !capsule.0.is_empty(),
        ScenarioReachabilityV1::CanonicallyGenerated { witness } => {
            !witness.constructor.is_empty()
                && !witness.input_digest.is_empty()
                && !witness.output_digest.is_empty()
                && !witness.validators.is_empty()
                && witness.validators.iter().all(|value| !value.is_empty())
        }
        ScenarioReachabilityV1::SyntheticValid { limitations } => {
            !limitations.is_empty() && limitations.iter().all(|value| !value.is_empty())
        }
        ScenarioReachabilityV1::InvalidNegativeTest { expected_error } => {
            !expected_error.is_empty()
        }
    };
    if valid {
        Ok(())
    } else {
        Err(ScenarioErrorV1::Validation)
    }
}

fn normalize_dependencies(value: &mut BuiltScenarioV1) -> Result<(), ScenarioErrorV1> {
    value.content_dependencies.sort();
    value.content_dependencies.dedup();
    value.behavior_dependencies.sort();
    value.behavior_dependencies.dedup();
    value.assumptions.sort();
    value.assumptions.dedup();
    if value.validation.checks.iter().any(String::is_empty) {
        return Err(ScenarioErrorV1::Validation);
    }
    value.validation.checks.sort();
    value.validation.checks.dedup();
    Ok(())
}

fn replay_scenario(capsule: ReproCapsuleIdV1, target_sequence: u64) -> BuiltScenarioV1 {
    BuiltScenarioV1 {
        snapshot: ScenarioSnapshotV1::ReplayRequired {
            capsule: capsule.clone(),
            target_sequence,
        },
        provenance: ScenarioReachabilityV1::RecordedNatural { capsule },
        content_dependencies: Vec::new(),
        behavior_dependencies: Vec::new(),
        assumptions: Vec::new(),
        validation: ScenarioValidationReportV1 {
            state_valid: true,
            content_valid: true,
            control_valid: true,
            scheduler_valid: true,
            protocol_valid: true,
            stable_boundary: true,
            checks: vec!["snapshot-or-capsule-replay".to_owned()],
        },
    }
}
