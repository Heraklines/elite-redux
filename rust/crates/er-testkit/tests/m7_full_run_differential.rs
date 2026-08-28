//! M7 deterministic full-run differential campaign.

#[path = "m7_system_proof.rs"]
mod foundation;

#[test]
fn full_run_differential_reaches_same_terminal() -> foundation::TestResult {
    foundation::two_hundred_wave_run_is_deterministic_to_terminal()
}
