//! Capture and full-party stable frontier construction.

use er_game::m7_content::PreparedGameContentV1;

use super::{CanonicalConstructionResultV1, ScenarioDomainFactoryV1};
use crate::scenario::CaptureScenarioV1;

pub fn build<F: ScenarioDomainFactoryV1>(
    factory: &F,
    specification: &CaptureScenarioV1,
    content: &PreparedGameContentV1,
) -> Result<CanonicalConstructionResultV1, String> {
    let result = factory.capture(specification, content)?;
    if !result.validation.state_valid
        || !result.validation.control_valid
        || !result.validation.stable_boundary
    {
        return Err("capture constructor failed frontier validation".to_owned());
    }
    Ok(result)
}
