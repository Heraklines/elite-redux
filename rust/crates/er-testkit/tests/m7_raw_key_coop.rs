//! M7 two-state raw-key/material convergence campaign.

#[path = "m7_system_proof.rs"]
mod foundation;

#[test]
fn raw_key_coop_campaign_applies_identical_material() -> foundation::TestResult {
    foundation::raw_key_replica_emits_proposal_without_local_mutation()?;
    foundation::run_program_material_save_and_control_paths_agree()
}
