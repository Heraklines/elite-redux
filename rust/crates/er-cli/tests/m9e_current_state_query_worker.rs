//! One complete current query journey, assigned to its own existing native lane.
#[path = "support/m9e_current_state_query.rs"]
mod fixture;

#[test]
fn worker_state_queries_bind_exact_current_snapshots_and_preserve_rejections()
-> Result<(), Box<dyn std::error::Error>> {
    fixture::exercise_queries(true)
}
