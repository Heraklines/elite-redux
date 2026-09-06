//! One complete current query journey, assigned to its own existing native lane.
#[path = "support/m9e_current_state_query.rs"]
mod fixture;

#[test]
fn current_state_queries_preserve_natural_and_controlled_terminal_snapshots_and_capture()
-> Result<(), Box<dyn std::error::Error>> {
    fixture::exercise_queries(false)
}
