//! Mystery/scenario-node stable frontier construction.

use er_game::m7_content::PreparedGameContentV1;

use super::{CanonicalConstructionResultV1, ScenarioDomainFactoryV1};
use crate::scenario::ScenarioNodeScenarioV1;

pub fn build<F: ScenarioDomainFactoryV1>(
    factory: &F,
    specification: &ScenarioNodeScenarioV1,
    content: &PreparedGameContentV1,
) -> Result<CanonicalConstructionResultV1, String> {
    let result = factory.scenario_node(specification, content)?;
    if !result.validation.state_valid
        || !result.validation.control_valid
        || !result.validation.stable_boundary
    {
        return Err("scenario-node constructor failed frontier validation".to_owned());
    }
    Ok(result)
}
