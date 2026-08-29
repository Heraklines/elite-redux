//! M7 single-engine raw-physical-key campaign.

#[path = "m7_system_proof.rs"]
mod foundation;

#[test]
fn raw_key_solo_campaign_reaches_cross_domain_state() -> foundation::TestResult {
    foundation::continuous_foundation_raw_key_journey_crosses_world_save_party_and_progression()
}
