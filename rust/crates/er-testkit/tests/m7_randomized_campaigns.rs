//! M7 replayable randomized-seed campaign matrix.

#[path = "m7_system_proof.rs"]
mod foundation;

#[test]
fn randomized_campaigns_replay_exactly() -> foundation::TestResult {
    foundation::randomized_campaign_profiles_replay_deterministically()
}
