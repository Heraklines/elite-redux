//! Reward, market, move-learning, evolution, fusion, and biome scenario construction.

use er_game::m7_content::PreparedGameContentV1;

use super::{CanonicalConstructionResultV1, ScenarioDomainFactoryV1};
use crate::scenario::RunSurfaceScenarioV1;

pub fn build<F: ScenarioDomainFactoryV1>(
    factory: &F,
    specification: &RunSurfaceScenarioV1,
    content: &PreparedGameContentV1,
) -> Result<CanonicalConstructionResultV1, String> {
    let result = factory.run_surface(specification, content)?;
    if !result.validation.state_valid
        || !result.validation.control_valid
        || !result.validation.stable_boundary
    {
        return Err(
            "run-surface constructor did not produce an actionable stable frontier".to_owned(),
        );
    }
    Ok(result)
}
