//! Progression, move-learning, evolution, and fusion frontier construction.

use er_game::m7_content::PreparedGameContentV1;

use super::{CanonicalConstructionResultV1, ScenarioDomainFactoryV1};
use crate::scenario::ProgressionScenarioV1;

pub fn build<F: ScenarioDomainFactoryV1>(
    factory: &F,
    specification: &ProgressionScenarioV1,
    content: &PreparedGameContentV1,
) -> Result<CanonicalConstructionResultV1, String> {
    let result = factory.progression(specification, content)?;
    if !result.validation.state_valid
        || !result.validation.control_valid
        || !result.validation.stable_boundary
    {
        return Err("progression constructor failed frontier validation".to_owned());
    }
    Ok(result)
}
