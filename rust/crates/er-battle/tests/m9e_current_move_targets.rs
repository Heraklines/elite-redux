use er_battle::current_move_targets::{TargetContext, TargetKind, TargetSet, resolve_move_targets};
use serde::Deserialize;

fn context() -> TargetContext {
    TargetContext {
        capacities: [3, 3],
        allowed: [true; 6],
        active: [true; 6],
        user: 0,
        target: TargetKind::NearEnemy,
        replacement: None,
        variable: vec![None; 3],
        spread_flag: false,
        multi_hit: false,
        ghost: false,
        fog: false,
        fog_suppressed: false,
        flying: false,
        pulse: false,
        arrangement: true,
        random_index: None,
    }
}

#[test]
fn whole_source_targeting_matches_all_twenty_categories_and_owner_call_order() {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Case {
        input: TargetContext,
        expected: TargetSet,
    }
    let path =
        std::env::var("M9E_CURRENT_MOVE_TARGETS_ORACLE").expect("actual source observations");
    let raw = std::fs::read_to_string(path).expect("source observations readable");
    assert!(raw.len() <= 262_144);
    let cases = raw
        .lines()
        .map(|line| serde_json::from_str::<Case>(line).expect("valid source case"))
        .collect::<Vec<_>>();
    assert_eq!(cases.len(), 200);
    for (index, case) in cases.into_iter().enumerate() {
        assert_eq!(
            resolved(&case.input),
            case.expected,
            "case {index}"
        );
    }
}

#[test]
fn source_spread_promotion_keeps_adjacency_and_multihit_exception() {
    let mut input = context();
    input.spread_flag = true;
    let spread = resolved(&input);
    assert!(spread.multiple);
    assert_eq!(spread.targets, [4, 5]);
    input.multi_hit = true;
    assert!(!resolved(&input).multiple);
    input.multi_hit = false;
    input.flying = true;
    assert_eq!(resolved(&input).targets, [3, 4, 5]);
}

#[test]
fn source_random_draw_precedes_alive_filter_and_other_never_falls_back_to_ally() {
    let mut input = context();
    input.target = TargetKind::RandomNearEnemy;
    input.random_index = Some(0);
    input.active[3] = false;
    let result = resolved(&input);
    assert!(result.targets.is_empty());
    assert_eq!(result.random_bounds, [3]);
    input.target = TargetKind::NearOther;
    input.random_index = None;
    input.active[3] = true;
    input.active[4] = false;
    input.active[5] = false;
    // The sole active foe recenters, making it reachable even from this wing.
    assert_eq!(resolved(&input).targets, [3, 1]);
    input.active[3] = false;
    assert!(resolved(&input).targets.is_empty());
}

#[test]
fn invalid_owner_context_fails_without_inventing_rng_or_callback_results() {
    let mut input = context();
    input.variable.pop();
    assert!(resolve_move_targets(&input).is_err());
    input = context();
    input.capacities[0] = 0;
    assert!(resolve_move_targets(&input).is_err());
    input = context();
    input.target = TargetKind::RandomNearEnemy;
    assert!(resolve_move_targets(&input).is_err());
    input.random_index = Some(3);
    assert!(resolve_move_targets(&input).is_err());
    input = context();
    input.random_index = Some(0);
    assert!(resolve_move_targets(&input).is_err());
    input = context();
    input.capacities[0] = 2;
    assert!(resolve_move_targets(&input).is_err());
}
