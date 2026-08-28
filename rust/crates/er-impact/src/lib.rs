//! Conservative source-to-test impact graph contracts.

use serde::{Deserialize, Serialize};

pub const IMPACT_GRAPH_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AffectedTestReportV1 {
    pub mandatory_commands: Vec<String>,
    pub focused_commands: Vec<String>,
    pub broader_commands: Vec<String>,
    pub affected_behaviors: Vec<String>,
    pub affected_capsules: Vec<String>,
    pub affected_benchmarks: Vec<String>,
}
