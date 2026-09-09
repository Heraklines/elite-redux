use er_progression::current_phase_tree::{
    CurrentPhaseTree, CurrentPhaseTreeError, CurrentPhaseTreeSnapshot, MAX_CURRENT_QUEUED_PHASES,
};
use std::collections::VecDeque;

fn numbers(values: impl IntoIterator<Item = u32>) -> String {
    values
        .into_iter()
        .map(|n| n.to_string())
        .collect::<Vec<_>>()
        .join(",")
}

#[test]
fn whole_source_queries_match_results_predicate_visits_and_restored_state() {
    let path = std::env::var("M9E_PHASE_TREE_QUERIES_ORACLE").expect("actual remote source oracle");
    let text = std::fs::read_to_string(path).expect("complete retained source traces");
    assert_eq!(text.lines().count(), 64);
    for line in text.lines() {
        let fields = line.split('\t').collect::<Vec<_>>();
        assert_eq!(fields.len(), 3);
        let seed = fields[0].parse::<usize>().expect("case index");
        let steps = fields[2].split(';').collect::<Vec<_>>();
        assert_eq!(steps.len(), fields[1].len());
        let mut tree = CurrentPhaseTree::<u32>::new();
        for (index, op) in fields[1].chars().enumerate() {
            let id = u32::try_from(index + 1).expect("bounded phase identity");
            let kind = u32::try_from((seed + index) % 4).expect("bounded phase kind");
            let mut visits = Vec::<String>::new();
            let mut predicate = |phase: &u32| {
                visits.push(phase.to_string());
                if phase % 3 != kind {
                    return false;
                }
                if matches!(op, 'f' | 'g' | 'r' | 'e') && index % 2 == 1 {
                    visits.push(format!("f{phase}"));
                    return phase.is_multiple_of(2);
                }
                true
            };
            let mut result = "-".to_owned();
            match op {
                'a' | 'd' => tree.add_phase(id, op == 'd').expect("source child"),
                'p' => tree.push_phase(id).expect("source root"),
                'b' => tree.add_barrier(id).expect("source barrier"),
                'n' => {
                    result = tree
                        .next_phase()
                        .map_or_else(|| "-".to_owned(), |n| n.to_string())
                }
                'c' | 'k' => tree.clear(op == 'k'),
                'i' => tree
                    .add_after_where(id, &mut predicate)
                    .expect("source insert after"),
                'f' => {
                    result = tree
                        .find_where(&mut predicate)
                        .map_or_else(|| "-".to_owned(), |n| n.to_string())
                }
                'g' => {
                    result = numbers(tree.find_all_where(&mut predicate).into_iter().copied());
                    if result.is_empty() {
                        result = "_".to_owned();
                    }
                }
                'r' => {
                    result = if tree.remove_where(&mut predicate) {
                        "T"
                    } else {
                        "F"
                    }
                    .to_owned()
                }
                'e' => {
                    result = if tree.exists_where(&mut predicate) {
                        "T"
                    } else {
                        "F"
                    }
                    .to_owned()
                }
                'x' => tree.remove_all_where(&mut predicate),
                other => assert_eq!(other, 'a', "unknown source operation"),
            }
            let snapshot = tree.snapshot();
            let levels = snapshot
                .levels
                .iter()
                .map(|level| numbers(level.iter().copied()))
                .collect::<Vec<_>>()
                .join("/");
            let actual = format!(
                "{result}:{}:{}:{}:{levels}:{}",
                visits.join(","),
                snapshot.current_level,
                u8::from(snapshot.deferred_active),
                numbers(tree.queued())
            );
            assert_eq!(actual, steps[index], "case {seed}, step {index}");
            let bytes = serde_json::to_vec(&snapshot).expect("snapshot serialization");
            let restored: CurrentPhaseTreeSnapshot<u32> =
                serde_json::from_slice(&bytes).expect("snapshot deserialization");
            let next = CurrentPhaseTree::restore(restored).expect("validated restore");
            assert_eq!(next, tree);
            tree = next;
        }
    }
}

#[test]
fn find_and_exists_preserve_opposite_source_search_orders() {
    let mut tree = CurrentPhaseTree::new();
    tree.push_phase(1).expect("root");
    tree.add_phase(2, false).expect("child");
    let mut calls = Vec::new();
    assert_eq!(
        tree.find_where(|p| {
            calls.push(*p);
            true
        }),
        Some(&2)
    );
    assert_eq!(calls, [2]);
    calls.clear();
    assert!(tree.exists_where(|p| {
        calls.push(*p);
        true
    }));
    assert_eq!(calls, [1]);
    calls.clear();
    assert_eq!(
        tree.find_all_where(|p| {
            calls.push(*p);
            true
        }),
        [&2, &1]
    );
    assert_eq!(calls, [2, 1]);
    calls.clear();
    tree.remove_all_where(|p| {
        calls.push(*p);
        false
    });
    assert_eq!(calls, [1, 2]);
}

#[test]
fn insertion_and_removal_choose_first_deepest_match_and_source_fallback() {
    let mut tree = CurrentPhaseTree::new();
    tree.push_phase(1).expect("root");
    tree.add_phase(2, false).expect("child");
    tree.add_phase(3, false).expect("sibling");
    tree.add_after_where(4, |_| true)
        .expect("first deepest match");
    assert_eq!(tree.queued(), [2, 4, 3, 1]);
    assert!(tree.remove_where(|p| *p == 4));
    assert!(!tree.remove_where(|p| *p == 99));
    tree.add_after_where(5, |_| false)
        .expect("addPhase fallback");
    assert_eq!(tree.queued(), [2, 3, 5, 1]);
    tree.remove_all_where(|p| *p % 2 == 1);
    assert_eq!(tree.queued(), [2]);
}

#[test]
fn query_admission_bounds_and_unknown_snapshot_fields_fail_closed() {
    let snapshot = CurrentPhaseTreeSnapshot {
        levels: vec![VecDeque::from(vec![1_u32; MAX_CURRENT_QUEUED_PHASES])],
        current_level: 0,
        deferred_active: false,
    };
    let mut tree = CurrentPhaseTree::restore(snapshot).expect("bounded state");
    let before = tree.clone();
    assert_eq!(
        tree.add_after_where(2, |_| true),
        Err(CurrentPhaseTreeError::Capacity)
    );
    assert_eq!(tree, before);
    let bytes = br#"{"levels":[[]],"current_level":0,"deferred_active":false,"unknown":1}"#;
    assert!(serde_json::from_slice::<CurrentPhaseTreeSnapshot<u32>>(bytes).is_err());
}
