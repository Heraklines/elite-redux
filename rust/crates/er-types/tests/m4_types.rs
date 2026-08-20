use er_types::battle_ids::{MenuInstanceId, MoveId, PokemonId};
use er_types::ids::{JS_MAX_SAFE_INTEGER, MenuOptionId, SafeU53, SeatId};
use er_types::run_ids::{
    BiomeId, Experience, GameRunId, GrowthRateId, ModifierId, Money, NatureId, RunContentPackHash,
    RunInteractionSequence, RunOfferId, RunStockId, RunSurfaceId, RunTaskId, SurfaceDigest,
};
use er_types::run_model::{
    BiomeMarketAction, BiomeSelectAction, CrossroadsAction, LearnMoveDecision, ModifierTier,
    RewardAction, RunOutcome, RunStage, RunSurfaceAction, RunSurfaceKind,
};
use er_types::ui::CancelPolicy;
use er_types::ui_menu::{
    LogicalMenu, LogicalMenuError, LogicalMenuOption, LogicalMenuOptionError, MenuNavigationEdge,
    NavigationDirection,
};
use serde_json::json;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe integer")
}

fn option(value: &str, enabled: bool) -> LogicalMenuOption {
    LogicalMenuOption::new(MenuOptionId::new(value).expect("option id"), enabled, None)
        .expect("valid option")
}

fn menu(
    selected: &str,
    options: Vec<LogicalMenuOption>,
    navigation: Vec<MenuNavigationEdge>,
) -> Result<LogicalMenu, LogicalMenuError> {
    LogicalMenu::new(
        MenuInstanceId::new(safe(1)),
        SeatId::new(safe(0)),
        "run/surface/control",
        MenuOptionId::new(selected).expect("selected option id"),
        options,
        navigation,
        CancelPolicy::Disabled,
    )
}

#[test]
fn run_values_preserve_safe_u53_boundaries_and_reject_overflow() {
    let ids = [
        u64::from(GameRunId::new(SafeU53::ZERO)),
        u64::from(RunInteractionSequence::new(SafeU53::MAX)),
        u64::from(RunTaskId::new(safe(2))),
        u64::from(RunSurfaceId::new(safe(3))),
        u64::from(RunOfferId::new(safe(4))),
        u64::from(RunStockId::new(safe(5))),
        u64::from(BiomeId::new(safe(6))),
        u64::from(ModifierId::new(safe(7))),
        u64::from(Experience::new(safe(8))),
        u64::from(Money::new(safe(9))),
    ];
    assert_eq!(ids, [0, JS_MAX_SAFE_INTEGER, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert!(serde_json::from_str::<GameRunId>("9007199254740992").is_err());
    assert!(serde_json::from_str::<Money>("-1").is_err());
    assert_eq!(GrowthRateId::new(u8::MAX).get(), u8::MAX);
    assert_eq!(NatureId::new(0).get(), 0);
}

#[test]
fn run_hashes_are_strict_blake3_v1_values() {
    let value = format!("blake3-v1:{}", "a".repeat(64));
    let content = RunContentPackHash::new(value.clone()).expect("valid content hash");
    let digest = SurfaceDigest::new(value.clone()).expect("valid surface digest");
    assert_eq!(content.as_str(), value);
    assert_eq!(digest.as_str(), value);
    for invalid in [
        "",
        "blake3-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "blake3-v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "blake3-v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ] {
        assert!(RunContentPackHash::new(invalid).is_err());
        assert!(SurfaceDigest::new(invalid).is_err());
    }
}

#[test]
fn modifier_tier_and_closed_surface_enums_reject_unknown_wire_values() {
    assert_eq!(serde_json::to_string(&ModifierTier::Common).unwrap(), "0");
    assert_eq!(
        serde_json::from_str::<ModifierTier>("4").unwrap(),
        ModifierTier::Master
    );
    assert!(serde_json::from_str::<ModifierTier>("5").is_err());
    assert!(serde_json::from_str::<ModifierTier>("\"COMMON\"").is_err());

    assert_eq!(
        serde_json::to_value(RunSurfaceKind::RewardShop).unwrap(),
        json!("REWARD_SHOP")
    );
    assert!(serde_json::from_str::<RunStage>("\"UNKNOWN\"").is_err());
    assert!(serde_json::from_str::<RunOutcome>("\"UNKNOWN\"").is_err());
    let action = RunSurfaceAction::Reward(RewardAction::Reroll);
    assert_eq!(
        serde_json::to_value(action).unwrap(),
        json!({"kind":"REWARD","payload":{"kind":"REROLL"}})
    );
    assert!(
        serde_json::from_value::<RunSurfaceAction>(
            json!({"kind":"BIOME_MARKET","payload":{"kind":"REROLL"}})
        )
        .is_err()
    );
    let _ = (
        BiomeMarketAction::Leave,
        BiomeSelectAction {
            route_node: er_types::run_ids::RouteNodeId::new(safe(1)),
            biome: BiomeId::new(safe(2)),
        },
        CrossroadsAction::Stay,
        LearnMoveDecision::Candidate {
            move_id: MoveId::new(safe(229)),
        },
        PokemonId::new(safe(7)),
    );
}

#[test]
fn logical_menu_rejects_duplicate_options_duplicate_edges_and_bad_selection() {
    let duplicate_option = menu("a", vec![option("a", true), option("a", false)], Vec::new());
    assert_eq!(duplicate_option, Err(LogicalMenuError::DuplicateOption));

    let edge = MenuNavigationEdge::new(
        MenuOptionId::new("a").unwrap(),
        NavigationDirection::Right,
        MenuOptionId::new("b").unwrap(),
    );
    let duplicate_edge = menu(
        "a",
        vec![option("a", true), option("b", true)],
        vec![edge.clone(), edge],
    );
    assert_eq!(
        duplicate_edge,
        Err(LogicalMenuError::DuplicateNavigationEdge)
    );

    let missing_selection = menu("missing", vec![option("a", true)], Vec::new());
    assert_eq!(
        missing_selection,
        Err(LogicalMenuError::MissingSelectedOption)
    );

    let bad_layout = LogicalMenuOption::new(
        MenuOptionId::new("a").unwrap(),
        true,
        Some(er_types::ui_menu::MenuOptionLayout::new(
            MenuOptionId::new("b").unwrap(),
            0,
            0,
            0,
        )),
    );
    assert_eq!(
        bad_layout,
        Err(LogicalMenuOptionError::LayoutIdentityMismatch)
    );
}

#[test]
fn logical_menu_canonicalizes_option_and_edge_order_without_using_layout() {
    let right = MenuNavigationEdge::new(
        MenuOptionId::new("b").unwrap(),
        NavigationDirection::Right,
        MenuOptionId::new("a").unwrap(),
    );
    let up = MenuNavigationEdge::new(
        MenuOptionId::new("a").unwrap(),
        NavigationDirection::Up,
        MenuOptionId::new("b").unwrap(),
    );
    let value = menu(
        "a",
        vec![option("b", true), option("a", false)],
        vec![right, up],
    )
    .expect("menu canonicalization");
    assert_eq!(value.options[0].option_id.as_str(), "a");
    assert_eq!(value.navigation[0].from.as_str(), "a");
    assert!(!value.is_enabled(&MenuOptionId::new("a").unwrap()));
    assert!(value.is_enabled(&MenuOptionId::new("b").unwrap()));
}
