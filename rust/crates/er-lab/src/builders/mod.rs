//! Scenario builder dispatch through production-owned canonical constructors.

pub mod battle;
pub mod capture;
pub mod pair;
pub mod progression;
pub mod run_surface;
pub mod scenario_node;
pub mod world;

use er_game::m7_content::PreparedGameContentV1;

use crate::scenario::{
    BattleScenarioV1, BuiltScenarioV1, CanonicalScenarioConstructorV1, CaptureScenarioV1,
    ConstructorWitnessV1, ContentIdentityV1, GameBehaviorUnitIdV1, PreRunScenarioV1,
    ProgressionScenarioV1, RunSurfaceScenarioV1, ScenarioAssumptionV1, ScenarioErrorV1,
    ScenarioNodeScenarioV1, ScenarioReachabilityV1, ScenarioSnapshotV1, ScenarioSpecificationV1,
    ScenarioValidationReportV1, TerminalScenarioV1, WorldScenarioV1,
};

#[derive(Clone, Debug, PartialEq)]
pub struct CanonicalConstructionResultV1 {
    pub snapshot: ScenarioSnapshotV1,
    pub witness: ConstructorWitnessV1,
    pub content_dependencies: Vec<ContentIdentityV1>,
    pub behavior_dependencies: Vec<GameBehaviorUnitIdV1>,
    pub assumptions: Vec<ScenarioAssumptionV1>,
    pub validation: ScenarioValidationReportV1,
}

pub trait ScenarioDomainFactoryV1: std::fmt::Debug {
    fn pre_run(
        &self,
        specification: &PreRunScenarioV1,
        content: &PreparedGameContentV1,
    ) -> Result<CanonicalConstructionResultV1, String>;
    fn battle(
        &self,
        specification: &BattleScenarioV1,
        content: &PreparedGameContentV1,
    ) -> Result<CanonicalConstructionResultV1, String>;
    fn run_surface(
        &self,
        specification: &RunSurfaceScenarioV1,
        content: &PreparedGameContentV1,
    ) -> Result<CanonicalConstructionResultV1, String>;
    fn progression(
        &self,
        specification: &ProgressionScenarioV1,
        content: &PreparedGameContentV1,
    ) -> Result<CanonicalConstructionResultV1, String>;
    fn capture(
        &self,
        specification: &CaptureScenarioV1,
        content: &PreparedGameContentV1,
    ) -> Result<CanonicalConstructionResultV1, String>;
    fn world(
        &self,
        specification: &WorldScenarioV1,
        content: &PreparedGameContentV1,
    ) -> Result<CanonicalConstructionResultV1, String>;
    fn scenario_node(
        &self,
        specification: &ScenarioNodeScenarioV1,
        content: &PreparedGameContentV1,
    ) -> Result<CanonicalConstructionResultV1, String>;
    fn terminal(
        &self,
        specification: &TerminalScenarioV1,
        content: &PreparedGameContentV1,
    ) -> Result<CanonicalConstructionResultV1, String>;
}

#[derive(Clone, Debug)]
pub struct CompositeScenarioConstructorV1<F> {
    pub factory: F,
}

impl<F: ScenarioDomainFactoryV1> CanonicalScenarioConstructorV1
    for CompositeScenarioConstructorV1<F>
{
    fn construct(
        &self,
        specification: &ScenarioSpecificationV1,
        content: &PreparedGameContentV1,
    ) -> Result<BuiltScenarioV1, ScenarioErrorV1> {
        let result = match specification {
            ScenarioSpecificationV1::PreRun(value) => self.factory.pre_run(value, content),
            ScenarioSpecificationV1::Battle(value) => battle::build(&self.factory, value, content),
            ScenarioSpecificationV1::RunSurface(value) => {
                run_surface::build(&self.factory, value, content)
            }
            ScenarioSpecificationV1::Progression(value) => {
                progression::build(&self.factory, value, content)
            }
            ScenarioSpecificationV1::Capture(value) => {
                capture::build(&self.factory, value, content)
            }
            ScenarioSpecificationV1::World(value) => world::build(&self.factory, value, content),
            ScenarioSpecificationV1::ScenarioNode(value) => {
                scenario_node::build(&self.factory, value, content)
            }
            ScenarioSpecificationV1::Terminal(value) => self.factory.terminal(value, content),
            ScenarioSpecificationV1::SoloRecovery(_) | ScenarioSpecificationV1::PairRecovery(_) => {
                return Err(ScenarioErrorV1::ReplayRequired);
            }
        }
        .map_err(ScenarioErrorV1::Constructor)?;
        Ok(BuiltScenarioV1 {
            snapshot: result.snapshot,
            provenance: ScenarioReachabilityV1::CanonicallyGenerated {
                witness: result.witness,
            },
            content_dependencies: result.content_dependencies,
            behavior_dependencies: result.behavior_dependencies,
            assumptions: result.assumptions,
            validation: result.validation,
        })
    }
}
