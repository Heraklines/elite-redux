//! Hand-reviewed pinned399d arithmetic cases, not an executed TypeScript oracle.
//! Species keys1/4 name source Bulbasaur/Charmander; mapping/alias cases are
//! supplied resolution fixtures and do not qualify actual species/root lookup.
use er_progression::current_friendship::{
    CurrentFriendshipError, ExistingStarterAccount, FRIENDSHIP_ORACLE_SHA,
    FriendshipIntent, FriendshipSourceProvenance, PINNED_FRIENDSHIP_CAPS,
    ResolvedFriendshipMode, ResolvedFriendshipStarter, ResolvedPositiveFriendship,
    add_resolved_starter_candy, friendship_booster_step, plan_resolved_friendship,
    starter_friendship_cap,
};

type Result<T> = std::result::Result<T, CurrentFriendshipError>;

fn account(species_id: u32, friendship_progress: u64, candy_count: i64) -> ExistingStarterAccount {
    ExistingStarterAccount { species_id, friendship_progress, candy_count }
}

fn resolution() -> ResolvedPositiveFriendship {
    ResolvedPositiveFriendship {
        provenance: FriendshipSourceProvenance {
            oracle_sha: FRIENDSHIP_ORACLE_SHA.to_owned(),
            // An explicit fixture label, not a real content-resolution receipt.
            resolution_sha256: "1".repeat(64),
        },
        pokemon_species: 1,
        starter: ResolvedFriendshipStarter { source_root: 1, candy_account_root: 1, starter_cost: 3.0 },
        fusion_starter: None,
        boosted_amount: 3.0,
        capped: false,
        fun_debug: false,
        mode: ResolvedFriendshipMode::Classic { candy_multiplier: 3.0 },
        event_boosts_fusions: false,
        friendship_caps: PINNED_FRIENDSHIP_CAPS.to_vec(),
        total_candy_rate: 1,
    }
}

#[test]
fn negative_and_zero_friendship_short_circuit_without_resolution() -> Result<()> {
    let accounts = vec![account(0, u64::MAX, -1)];
    for (delta, expected) in [(-5.0, 0.0_f64), (0.0, 3.0), (-0.5, 2.5)] {
        let plan = plan_resolved_friendship(3.0, delta, &accounts, None)?;
        assert_eq!(plan.friendship.to_bits(), expected.to_bits());
        assert_eq!(plan.accounts, accounts);
        assert!(plan.intents.is_empty());
    }
    assert_eq!(plan_resolved_friendship(3.0, 1.0, &accounts, None), Err(CurrentFriendshipError::Input));
    let mut debug = resolution();
    debug.fun_debug = true;
    debug.boosted_amount = 6.0;
    debug.friendship_caps.clear();
    debug.provenance.oracle_sha.clear();
    let plan = plan_resolved_friendship(254.0, 6.0, &accounts, Some(&debug))?;
    assert_eq!(plan.friendship.to_bits(), 255.0_f64.to_bits());
    assert_eq!(plan.accounts, accounts);
    assert!(plan.intents.is_empty());
    Ok(())
}

#[test]
fn boosted_caps_and_max_friendship_preserve_full_candy_progress() -> Result<()> {
    // PokemonFriendshipBoosterModifier: floor(3 * (1 + .5)) =4, not4.5.
    let mut resolved = resolution();
    resolved.boosted_amount = friendship_booster_step(3.0, 1)?;
    assert_eq!(resolved.boosted_amount.to_bits(), 4.0_f64.to_bits());
    assert_eq!(friendship_booster_step(0.5, 0)?.to_bits(), 0.0_f64.to_bits());
    resolved.capped = true;
    for (before, expected) in [(199.0, 200.0_f64), (240.0, 240.0)] {
        let plan = plan_resolved_friendship(before, 3.0, &[account(1, 0, 0)], Some(&resolved))?;
        assert_eq!(plan.friendship.to_bits(), expected.to_bits());
        assert_eq!(plan.accounts, vec![account(1, 12, 0)]);
        assert!(plan.intents.is_empty());
    }
    resolved.capped = false;
    resolved.total_candy_rate = 2;
    for before in [254.0, 255.0] {
        let plan = plan_resolved_friendship(before, 3.0, &[account(1, 74, 20)], Some(&resolved))?;
        assert_eq!(plan.friendship.to_bits(), 255.0_f64.to_bits());
        assert_eq!(plan.accounts, vec![account(1, 11, 22)]);
        assert_eq!(plan.intents, vec![
            FriendshipIntent::ValidateMaxFriendshipAchievement,
            FriendshipIntent::AwardFriendshipRibbonToSpeciesLine { original_species: 1 },
            FriendshipIntent::ShowStarterCandy { root: 1, scaled_count: 2, before_candy: 20, after_candy: 22 },
        ]);
    }
    Ok(())
}

#[test]
fn binary64_fusion_and_starter_cap_order_match_source_cases() -> Result<()> {
    // floor(cost), clamp to1..10, then index. All twenty edge sides are explicit.
    for (cost, expected) in [(-2.0, 25), (0.99, 25), (1.0, 25), (1.99, 25),
        (2.0, 50), (2.99, 50), (3.0, 75), (3.99, 75), (4.0, 100), (4.99, 100),
        (5.0, 150), (5.99, 150), (6.0, 200), (6.99, 200), (7.0, 300), (7.99, 300),
        (8.0, 450), (8.99, 450), (9.0, 450), (9.99, 450), (10.0, 600), (100.0, 600)] {
        assert_eq!(starter_friendship_cap(cost, &PINNED_FRIENDSHIP_CAPS)?, expected);
    }
    for (amount, classic, boosted, expected) in [(0.6, true, true, 1),
        (0.6, true, false, 0), (1.5, true, true, 3), (1.5, true, false, 2),
        (1.5, false, true, 1), (1.5, false, false, 0)] {
        let mut resolved = resolution();
        resolved.boosted_amount = amount;
        resolved.mode = if classic { ResolvedFriendshipMode::Classic { candy_multiplier: 3.0 } }
            else { ResolvedFriendshipMode::NonClassic };
        resolved.event_boosts_fusions = boosted;
        resolved.fusion_starter = Some(ResolvedFriendshipStarter { source_root: 4, candy_account_root: 4, starter_cost: 3.0 });
        let plan = plan_resolved_friendship(50.0, amount, &[account(1, 0, 0), account(4, 0, 0)], Some(&resolved))?;
        assert_eq!(plan.accounts, vec![account(1, expected, 0), account(4, expected, 0)]);
        assert!(plan.intents.is_empty());
    }
    // floor(.6 * (3 /1.5)) =1; flooring .6*3 before the division yields0.
    // The actual event override4 also remains explicit, distinct from tuning3.
    let mut event = resolution();
    event.mode = ResolvedFriendshipMode::Classic { candy_multiplier: 4.0 };
    let plan = plan_resolved_friendship(50.0, 3.0, &[account(1, 0, 0)], Some(&event))?;
    assert_eq!(plan.accounts, vec![account(1, 12, 0)]);
    Ok(())
}

#[test]
fn candy_saturation_zero_rate_egg_and_negative_requests_match_source() -> Result<()> {
    for (before, count, egg, show, debug, rate, expected, returned, bar) in [
        (9_998, 2, false, true, false, 3, 9_999, true, Some(6)),
        (9_999, i64::MAX, false, true, false, 255, 9_999, false, None),
        (i64::MAX, i64::MAX, false, true, true, 255, i64::MAX, false, None),
        (7, 1, false, true, false, 0, 7, true, Some(0)),
        (7, 2, true, true, false, 255, 9, true, Some(2)),
        (2, -5, false, true, false, 255, -3, true, Some(-5)),
        (2, 0, false, true, false, 255, 2, true, Some(0)),
        (2, 3, false, false, false, 1, 5, true, None),
    ] {
        let actual = add_resolved_starter_candy(before, count, egg, show, debug, rate)?;
        assert_eq!((actual.candy_count, actual.returned_true, actual.candy_bar_count), (expected, returned, bar));
    }
    let mut resolved = resolution();
    resolved.total_candy_rate = 0;
    let plan = plan_resolved_friendship(50.0, 3.0, &[account(1, 74, 7)], Some(&resolved))?;
    assert_eq!(plan.accounts, vec![account(1, 8, 7)]);
    assert_eq!(plan.intents, vec![FriendshipIntent::ShowStarterCandy { root: 1, scaled_count: 0, before_candy: 7, after_candy: 7 }]);
    let capped = plan_resolved_friendship(50.0, 3.0, &[account(1, 74, 9_999)], Some(&resolved))?;
    assert_eq!(capped.accounts, vec![account(1, 74, 9_999)]);
    assert!(capped.intents.is_empty());
    Ok(())
}

#[test]
fn shared_fusion_progress_and_candy_roots_update_in_source_order() -> Result<()> {
    let mut resolved = resolution();
    resolved.boosted_amount = 13.0;
    resolved.fusion_starter = Some(resolved.starter.clone());
    // Both source references alias: gain19 each;60+19=>one candy/remainder4,
    // then4+19=>23. Independent per-reference before-state calculation is wrong.
    let plan = plan_resolved_friendship(50.0, 13.0, &[account(1, 60, 0)], Some(&resolved))?;
    assert_eq!(plan.accounts, vec![account(1, 23, 1)]);
    assert_eq!(plan.intents, vec![FriendshipIntent::ShowStarterCandy { root: 1, scaled_count: 1, before_candy: 0, after_candy: 1 }]);
    // Synthetic resolved mapping exercises distinct progress objects with one
    // account owner. It is not asserted to be Bulbasaur/Charmander's real map.
    resolved.boosted_amount = 1.0;
    resolved.fusion_starter = Some(ResolvedFriendshipStarter { source_root: 4, candy_account_root: 1, starter_cost: 3.0 });
    let plan = plan_resolved_friendship(50.0, 1.0, &[account(1, 74, 9_998), account(4, 74, 27)], Some(&resolved))?;
    assert_eq!(plan.accounts, vec![account(1, 0, 9_999), account(4, 74, 27)]);
    assert_eq!(plan.intents, vec![FriendshipIntent::ShowStarterCandy { root: 1, scaled_count: 1, before_candy: 9_998, after_candy: 9_999 }]);
    Ok(())
}

#[test]
fn invalid_resolution_and_late_arithmetic_leave_inputs_unchanged() {
    let original = resolution();
    let accounts = vec![account(1, 74, 0)];
    for mutation in 0..7 {
        let mut invalid = original.clone();
        match mutation {
            0 => invalid.provenance.oracle_sha.clear(),
            1 => invalid.provenance.resolution_sha256 = "A".repeat(64),
            2 => { invalid.friendship_caps.pop(); },
            3 => invalid.friendship_caps[0] = 0,
            4 => invalid.friendship_caps[0] = 100,
            5 => invalid.starter.candy_account_root = 4,
            _ => invalid.total_candy_rate = 51,
        }
        assert!(plan_resolved_friendship(50.0, 3.0, &accounts, Some(&invalid)).is_err());
        assert_eq!(accounts, vec![account(1, 74, 0)]);
    }
    assert!(starter_friendship_cap(f64::NAN, &PINNED_FRIENDSHIP_CAPS).is_err());
    assert!(friendship_booster_step(3.0, 4).is_err());
    assert!(add_resolved_starter_candy(0, i64::MAX, false, false, false, 1).is_err());
    assert!(add_resolved_starter_candy(0, 9_007_199_254_740_991, false, false, false, 2).is_err());
    assert!(plan_resolved_friendship(50.0, f64::INFINITY, &accounts, Some(&original)).is_err());
    let duplicates = vec![account(1, 0, 0), account(1, 0, 0)];
    assert_eq!(plan_resolved_friendship(50.0, 3.0, &duplicates, Some(&original)), Err(CurrentFriendshipError::Account));
    let mut late = original.clone();
    late.fusion_starter = Some(ResolvedFriendshipStarter { source_root: 4, candy_account_root: 4, starter_cost: 3.0 });
    let before = vec![account(1, 74, 0), account(4, 9_007_199_254_740_991, 0)];
    let copy = before.clone();
    // First iteration locally pays, second addition exceeds safe integer range.
    assert_eq!(plan_resolved_friendship(50.0, 3.0, &before, Some(&late)), Err(CurrentFriendshipError::Arithmetic));
    assert_eq!(before, copy);
    assert_eq!(original, resolution());
}
