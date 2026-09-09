use std::collections::VecDeque;

use er_progression::current_phase_tree::{
    CurrentPhaseTree, CurrentPhaseTreeError, CurrentPhaseTreeSnapshot, MAX_CURRENT_QUEUED_PHASES,
};

fn numbers(values: impl IntoIterator<Item = u32>) -> String {
    values
        .into_iter()
        .map(|n| n.to_string())
        .collect::<Vec<_>>()
        .join(",")
}

#[test]
fn every_actual_source_trace_and_intermediate_snapshot_matches() {
    let path = std::env::var("M9E_PHASE_TREE_ORACLE").expect("actual remote source oracle");
    let text = std::fs::read_to_string(path).expect("retained actual source cases");
    assert_eq!(text.lines().count(), 64);
    for line in text.lines() {
        let parts = line.split('\t').collect::<Vec<_>>();
        assert_eq!(parts.len(), 3);
        let expected = parts[2].split(';').collect::<Vec<_>>();
        assert_eq!(parts[1].len(), expected.len());
        let mut tree = CurrentPhaseTree::<u32>::new();
        for (index, op) in parts[1].chars().enumerate() {
            let phase = u32::try_from(index + 1).expect("bounded case index");
            let mut popped = None;
            match op {
                'a' | 'd' => tree.add_phase(phase, op == 'd').expect("source child"),
                'p' => tree.push_phase(phase).expect("source root"),
                'b' => tree.add_barrier(phase).expect("source barrier"),
                'n' => popped = tree.next_phase(),
                'c' | 'k' => tree.clear(op == 'k'),
                other => assert_eq!(other, 'a', "unknown oracle operation"),
            }
            let snapshot = tree.snapshot();
            let levels = snapshot
                .levels
                .iter()
                .map(|level| numbers(level.iter().copied()))
                .collect::<Vec<_>>()
                .join("/");
            let actual = format!(
                "{}:{}:{}:{}:{}",
                popped.map_or_else(|| "-".to_owned(), |n| n.to_string()),
                snapshot.current_level,
                u8::from(snapshot.deferred_active),
                levels,
                numbers(tree.queued())
            );
            assert_eq!(actual, expected[index], "case {} step {index}", parts[0]);
            let restored = CurrentPhaseTree::restore(snapshot).expect("exact intermediate restore");
            assert_eq!(restored, tree);
            tree = restored;
        }
    }
}

#[test]
fn descendant_level_up_tasks_precede_barrier_and_recipient_siblings() {
    let mut tree = CurrentPhaseTree::new();
    tree.push_phase(90).expect("victory tail");
    tree.add_phase(1, false).expect("first recipient");
    tree.add_phase(2, false).expect("second recipient");
    assert_eq!(tree.next_phase(), Some(1));
    tree.add_barrier(8).expect("first recipient barrier");
    tree.add_phase(3, false).expect("level up");
    tree.add_phase(4, false).expect("hide bar");
    assert_eq!(tree.next_phase(), Some(3));
    tree.add_phase(5, false).expect("learn move");
    tree.add_phase(6, false).expect("evolution");
    let remaining = std::iter::from_fn(|| tree.next_phase()).collect::<Vec<_>>();
    assert_eq!(remaining, [5, 6, 4, 8, 2, 90]);
}

#[test]
fn source_clear_preserves_deferred_flag_and_retains_only_deepest_level() {
    let mut tree = CurrentPhaseTree::new();
    tree.push_phase(1).expect("root");
    tree.add_phase(2, true).expect("deferred source level");
    tree.add_phase(3, false).expect("later child");
    tree.clear(true);
    assert!(tree.snapshot().deferred_active);
    assert_eq!(tree.queued(), [3]);
    tree.add_phase(4, true).expect("source retained deferral");
    assert_eq!(tree.next_phase(), Some(3));
    assert_eq!(tree.next_phase(), Some(4));
    assert_eq!(tree.next_phase(), None);
    tree.clear(false);
    assert!(tree.snapshot().deferred_active);
}

#[test]
fn malformed_restore_and_excess_capacity_leave_queue_unchanged() {
    assert_eq!(
        CurrentPhaseTree::<u32>::restore(CurrentPhaseTreeSnapshot {
            levels: vec![],
            current_level: 0,
            deferred_active: false
        }),
        Err(CurrentPhaseTreeError::InvalidLevel)
    );
    let full = CurrentPhaseTreeSnapshot {
        levels: vec![VecDeque::from(vec![1_u32; MAX_CURRENT_QUEUED_PHASES])],
        current_level: 0,
        deferred_active: false,
    };
    let mut tree = CurrentPhaseTree::restore(full).expect("exact bounded queue");
    let before = tree.clone();
    assert_eq!(
        tree.add_phase(2, true),
        Err(CurrentPhaseTreeError::Capacity)
    );
    assert_eq!(tree, before);
    assert_eq!(tree.add_barrier(3), Err(CurrentPhaseTreeError::Capacity));
    assert_eq!(tree, before);
    assert_eq!(tree.push_phase(4), Err(CurrentPhaseTreeError::Capacity));
    assert_eq!(tree, before);
}
