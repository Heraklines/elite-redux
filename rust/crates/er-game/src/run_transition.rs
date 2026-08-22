//! Authority preparation for retained M4 run-surface actions.

use er_run::modifier::{ModifierApplication, apply_modifier};
use er_run::reward::pay_for_offer;
use er_run::run_material::{
    AuthorityRunMaterial, RUN_INTERACTION_MATERIAL_VERSION, RUN_MATERIAL_M3_PARITY_ORACLE_SHA,
    RunInteractionMaterialV1, RunMaterialHeader,
};
use er_run::transition::{GameContentBundle, RunMutation, RunPresentationEvent};
use er_state::digest_v2::MechanicalStateDigestV2;
use er_state::game_v2::GameStateV2;
use er_state::run_v2::{
    BiomeSelectSurfaceState, RUN_SURFACE_STATE_SCHEMA_VERSION, RouteNode, RunModifierInstance,
    RunSurfaceState, SurfaceHeader,
};
use er_state::surface_digest::compute_surface_digest_v1;
use er_types::SafeU53;
use er_types::battle_ids::MenuInstanceId;
use er_types::run_control::{
    BiomeSelectControl, GameControl, GameControlPlan, RewardShopControl, SeatControlPlan,
    SurfaceControl,
};
use er_types::run_ids::{RouteNodeId, RunSurfaceId, SurfaceDigest};
use er_types::run_model::{CrossroadsAction, RewardAction, RunSurfaceAction, RunSurfaceKind};
use er_types::ui::CancelPolicy;
use er_types::ui_menu::{LogicalMenu, LogicalMenuOption, MenuNavigationEdge, NavigationDirection};
use er_types::{MenuOptionId, OperationId};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum RunTransitionPreparationError {
    #[error("run action is not supported by this transition builder")]
    UnsupportedAction,
    #[error("active run surface is not the expected Crossroads surface")]
    WrongSurface,
    #[error("current biome is absent from the selected content pack")]
    MissingBiome,
    #[error("selected biome has no route options")]
    MissingRoutes,
    #[error("selected reward offer or modifier is absent")]
    MissingReward,
    #[error("selected modifier application is unsupported at this surface")]
    UnsupportedModifier,
    #[error("run transition allocator overflowed")]
    AllocatorOverflow,
    #[error("run transition identity or menu is invalid: {0}")]
    InvalidIdentity(String),
    #[error("run transition digest failed: {0}")]
    Digest(String),
    #[error("run transition candidate state is invalid: {0}")]
    InvalidState(String),
}

pub fn can_prepare_action(action: &RunSurfaceAction) -> bool {
    matches!(
        action,
        RunSurfaceAction::Crossroads(CrossroadsAction::MoveOn)
            | RunSurfaceAction::Reward(RewardAction::SelectFree { .. })
    )
}

/// Prepares the selected Crossroads `MoveOn` transition. The result opens a
/// canonical BiomeSelect surface from immutable biome definitions and carries
/// the complete before/after state plus exact next control.
pub fn prepare_crossroads_transition(
    before: &GameStateV2,
    content: &GameContentBundle,
    action: &RunSurfaceAction,
    current_control: &GameControlPlan,
) -> Result<AuthorityRunMaterial, RunTransitionPreparationError> {
    if action != &RunSurfaceAction::Crossroads(CrossroadsAction::MoveOn) {
        return Err(RunTransitionPreparationError::UnsupportedAction);
    }
    let Some(RunSurfaceState::Crossroads(crossroads)) = before.run.active_surface.as_ref() else {
        return Err(RunTransitionPreparationError::WrongSurface);
    };
    if current_control.owner_seat() != crossroads.header.owner_seat {
        return Err(RunTransitionPreparationError::WrongSurface);
    }
    let biome_index = usize::try_from(before.run.biome.biome.get().get())
        .map_err(|_| RunTransitionPreparationError::MissingBiome)?;
    let biome = content
        .run
        .biomes
        .get(biome_index)
        .and_then(Option::as_ref)
        .ok_or(RunTransitionPreparationError::MissingBiome)?;
    if biome.base_routes.is_empty() {
        return Err(RunTransitionPreparationError::MissingRoutes);
    }

    let surface_id = before.run.counters.next_surface_id;
    let next_surface_value = surface_id
        .get()
        .get()
        .checked_add(1)
        .ok_or(RunTransitionPreparationError::AllocatorOverflow)?;
    let next_surface_id = RunSurfaceId::new(
        SafeU53::new(next_surface_value)
            .map_err(|_| RunTransitionPreparationError::AllocatorOverflow)?,
    );
    let menu_instance = current_control.next_menu_instance_id;
    let next_menu_value = menu_instance
        .get()
        .get()
        .checked_add(1)
        .ok_or(RunTransitionPreparationError::AllocatorOverflow)?;
    let next_menu_instance = MenuInstanceId::new(
        SafeU53::new(next_menu_value)
            .map_err(|_| RunTransitionPreparationError::AllocatorOverflow)?,
    );

    let mut routes = Vec::with_capacity(biome.base_routes.len());
    let mut options = Vec::with_capacity(biome.base_routes.len());
    let mut option_ids = Vec::with_capacity(biome.base_routes.len());
    for (index, destination) in biome.base_routes.iter().copied().enumerate() {
        let node_value = u64::try_from(index + 1)
            .map_err(|_| RunTransitionPreparationError::AllocatorOverflow)?;
        let route_node_id = RouteNodeId::new(
            SafeU53::new(node_value)
                .map_err(|_| RunTransitionPreparationError::AllocatorOverflow)?,
        );
        routes.push(RouteNode {
            route_node_id,
            biome: destination,
        });
        let option_id = MenuOptionId::new(format!("biome/{route_node_id}/{destination}"))
            .map_err(|error| RunTransitionPreparationError::InvalidIdentity(error.to_string()))?;
        options.push(
            LogicalMenuOption::new(option_id.clone(), true, None).map_err(|error| {
                RunTransitionPreparationError::InvalidIdentity(error.to_string())
            })?,
        );
        option_ids.push(option_id);
    }
    let mut navigation = Vec::new();
    for pair in option_ids.windows(2) {
        navigation.push(MenuNavigationEdge::new(
            pair[0].clone(),
            NavigationDirection::Right,
            pair[1].clone(),
        ));
        navigation.push(MenuNavigationEdge::new(
            pair[1].clone(),
            NavigationDirection::Left,
            pair[0].clone(),
        ));
    }
    let control_id = current_control.next_control_id.clone();
    let menu = LogicalMenu::new(
        menu_instance,
        crossroads.header.owner_seat,
        control_id.clone(),
        option_ids[0].clone(),
        options,
        navigation,
        CancelPolicy::Disabled,
    )
    .map_err(|error| RunTransitionPreparationError::InvalidIdentity(error.to_string()))?;

    let old_operation = crossroads.header.operation_id.as_str();
    let epoch = old_operation
        .split(':')
        .next()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            RunTransitionPreparationError::InvalidIdentity(
                "Crossroads operation has no epoch".to_owned(),
            )
        })?;
    let address = 9_700_000_u64
        .checked_add(crossroads.header.interaction_sequence.get().get())
        .ok_or(RunTransitionPreparationError::AllocatorOverflow)?;
    let operation_id = OperationId::new(format!(
        "{epoch}:{}:BIOME_PICK:{address}",
        crossroads.header.owner_seat.get().get()
    ))
    .map_err(|error| RunTransitionPreparationError::InvalidIdentity(error.to_string()))?;
    let zero_digest = SurfaceDigest::new(format!("blake3-v1:{}", "0".repeat(64)))
        .map_err(|error| RunTransitionPreparationError::Digest(error.to_string()))?;
    let mut next_surface = RunSurfaceState::BiomeSelect(BiomeSelectSurfaceState {
        header: SurfaceHeader {
            schema_version: RUN_SURFACE_STATE_SCHEMA_VERSION,
            surface_id,
            kind: RunSurfaceKind::BiomeSelect,
            owner_seat: crossroads.header.owner_seat,
            interaction_sequence: crossroads.header.interaction_sequence,
            action_ordinal: 0,
            operation_id,
            menu: menu.clone(),
            surface_digest: zero_digest,
        },
        routes,
        inherited_crossroads_sequence: Some(crossroads.header.interaction_sequence),
    });
    let surface_digest = compute_surface_digest_v1(&next_surface)
        .map_err(|error| RunTransitionPreparationError::Digest(error.to_string()))?;
    next_surface.header_mut().surface_digest = surface_digest.clone();

    let surface_control = SurfaceControl::BiomeSelect(BiomeSelectControl::new(
        surface_id,
        crossroads.header.interaction_sequence,
        menu,
    ));
    let seats = current_control
        .seats
        .iter()
        .map(|seat| SeatControlPlan {
            seat: seat.seat,
            owner: seat.owner,
            control_id: control_id.clone(),
            menu_instance_id: menu_instance,
            actionable_after: seat.actionable_after,
            control: GameControl::Surface(surface_control.clone()),
        })
        .collect();
    let next_control =
        GameControlPlan::new(seats, format!("{control_id}/next"), next_menu_instance)
            .map_err(|error| RunTransitionPreparationError::InvalidIdentity(error.to_string()))?;

    let mut after = before.clone();
    after.run.biome.leave_biome_now = true;
    after.run.counters.next_surface_id = next_surface_id;
    after.run.active_surface = Some(next_surface);
    after
        .validate()
        .map_err(|error| RunTransitionPreparationError::InvalidState(error.to_string()))?;
    let before_digest = MechanicalStateDigestV2::compute(before)
        .map_err(|error| RunTransitionPreparationError::Digest(error.to_string()))?;
    let after_digest = MechanicalStateDigestV2::compute(&after)
        .map_err(|error| RunTransitionPreparationError::Digest(error.to_string()))?;

    Ok(AuthorityRunMaterial::Interaction(
        RunInteractionMaterialV1 {
            schema_version: RUN_INTERACTION_MATERIAL_VERSION,
            header: RunMaterialHeader {
                m4_oracle_sha: content.run.m4_oracle_sha.clone(),
                m3_parity_oracle_sha: RUN_MATERIAL_M3_PARITY_ORACLE_SHA.to_owned(),
                battle_content_hash: before.battle_content_hash.clone(),
                run_content_hash: before.run_content_hash.clone(),
                operation_id: crossroads.header.operation_id.clone(),
                run_id: before.run.run_id,
                wave: before.run.wave,
                before_digest,
                after_digest,
                before_state: before.clone(),
                after_state: after,
                next_control,
            },
            surface_kind: RunSurfaceKind::Crossroads,
            surface_id: crossroads.header.surface_id,
            owner_seat: crossroads.header.owner_seat,
            interaction_sequence: crossroads.header.interaction_sequence,
            action_ordinal: crossroads.header.action_ordinal,
            action: action.clone(),
            mutations: vec![
                RunMutation::SurfaceClosed,
                RunMutation::SurfaceOpened {
                    kind: RunSurfaceKind::BiomeSelect,
                    surface_id,
                },
            ],
            presentation: vec![
                RunPresentationEvent::SurfaceClosed,
                RunPresentationEvent::SurfacePresented {
                    kind: RunSurfaceKind::BiomeSelect,
                    surface_id,
                },
            ],
            rng_audit: Vec::new(),
            surface_after_digest: Some(surface_digest),
        },
    ))
}

/// Prepares a free persistent reward acquisition while retaining the reward
/// surface. Immediate or targeted modifiers remain closed until their exact
/// successor/target overlays are implemented.
pub fn prepare_reward_transition(
    before: &GameStateV2,
    content: &GameContentBundle,
    action: &RunSurfaceAction,
    current_control: &GameControlPlan,
) -> Result<AuthorityRunMaterial, RunTransitionPreparationError> {
    let RunSurfaceAction::Reward(RewardAction::SelectFree { offer, target }) = action else {
        return Err(RunTransitionPreparationError::UnsupportedAction);
    };
    let Some(RunSurfaceState::RewardShop(reward)) = before.run.active_surface.as_ref() else {
        return Err(RunTransitionPreparationError::WrongSurface);
    };
    if current_control.owner_seat() != reward.header.owner_seat {
        return Err(RunTransitionPreparationError::WrongSurface);
    }
    let selected = reward
        .offers
        .iter()
        .find(|entry| entry.offer_id == *offer && !entry.sold)
        .ok_or(RunTransitionPreparationError::MissingReward)?;
    pay_for_offer(
        before.run.money,
        &[er_run::reward::RewardOfferView {
            offer_id: selected.offer_id,
            modifier_id: selected.modifier_id,
            tier: selected.tier,
            price: selected.price,
            sold: selected.sold,
        }],
        *offer,
        None,
    )
    .map_err(|_| RunTransitionPreparationError::MissingReward)?;
    let modifier_index = usize::try_from(selected.modifier_id.get().get())
        .map_err(|_| RunTransitionPreparationError::MissingReward)?;
    let modifier = content
        .run
        .modifiers
        .get(modifier_index)
        .and_then(Option::as_ref)
        .ok_or(RunTransitionPreparationError::MissingReward)?;
    let application = apply_modifier(modifier, *target, None, 0)
        .map_err(|_| RunTransitionPreparationError::UnsupportedModifier)?;
    if application != ModifierApplication::Persistent {
        return Err(RunTransitionPreparationError::UnsupportedModifier);
    }

    let menu_instance = current_control.next_menu_instance_id;
    let next_menu_value = menu_instance
        .get()
        .get()
        .checked_add(1)
        .ok_or(RunTransitionPreparationError::AllocatorOverflow)?;
    let next_menu_instance = MenuInstanceId::new(
        SafeU53::new(next_menu_value)
            .map_err(|_| RunTransitionPreparationError::AllocatorOverflow)?,
    );
    let control_id = current_control.next_control_id.clone();
    let selected_option = format!("reward/free/{}/{}", selected.offer_id, selected.modifier_id);

    let mut after = before.clone();
    let Some(RunSurfaceState::RewardShop(after_reward)) = after.run.active_surface.as_mut() else {
        return Err(RunTransitionPreparationError::WrongSurface);
    };
    let after_offer = after_reward
        .offers
        .iter_mut()
        .find(|entry| entry.offer_id == *offer)
        .ok_or(RunTransitionPreparationError::MissingReward)?;
    after_offer.sold = true;
    let next_ordinal = after_reward
        .header
        .action_ordinal
        .checked_add(1)
        .ok_or(RunTransitionPreparationError::AllocatorOverflow)?;
    after_reward.header.action_ordinal = next_ordinal;
    after_reward.header.menu.instance_id = menu_instance;
    after_reward.header.menu.control_id = control_id.clone();
    let option = after_reward
        .header
        .menu
        .options
        .iter_mut()
        .find(|option| option.option_id.as_str() == selected_option)
        .ok_or(RunTransitionPreparationError::MissingReward)?;
    option.enabled = false;

    if let Some(existing) = after
        .run
        .modifiers
        .iter_mut()
        .find(|entry| entry.modifier_id == selected.modifier_id)
    {
        existing.stacks = existing
            .stacks
            .checked_add(1)
            .filter(|stacks| *stacks <= modifier.maximum_stack)
            .ok_or(RunTransitionPreparationError::UnsupportedModifier)?;
    } else {
        after.run.modifiers.push(RunModifierInstance {
            modifier_id: selected.modifier_id,
            stacks: 1,
        });
        after
            .run
            .modifiers
            .sort_unstable_by_key(|entry| entry.modifier_id);
    }

    let surface_snapshot = after
        .run
        .active_surface
        .as_ref()
        .cloned()
        .ok_or(RunTransitionPreparationError::WrongSurface)?;
    let surface_digest = compute_surface_digest_v1(&surface_snapshot)
        .map_err(|error| RunTransitionPreparationError::Digest(error.to_string()))?;
    after
        .run
        .active_surface
        .as_mut()
        .expect("surface checked above")
        .header_mut()
        .surface_digest = surface_digest.clone();
    after
        .validate()
        .map_err(|error| RunTransitionPreparationError::InvalidState(error.to_string()))?;

    let after_menu = after
        .run
        .active_surface
        .as_ref()
        .expect("surface retained")
        .header()
        .menu
        .clone();
    let surface_control = SurfaceControl::RewardShop(RewardShopControl::new(
        reward.header.surface_id,
        reward.header.interaction_sequence,
        after_menu,
    ));
    let seats = current_control
        .seats
        .iter()
        .map(|seat| SeatControlPlan {
            seat: seat.seat,
            owner: seat.owner,
            control_id: control_id.clone(),
            menu_instance_id: menu_instance,
            actionable_after: seat.actionable_after,
            control: GameControl::Surface(surface_control.clone()),
        })
        .collect();
    let next_control =
        GameControlPlan::new(seats, format!("{control_id}/next"), next_menu_instance)
            .map_err(|error| RunTransitionPreparationError::InvalidIdentity(error.to_string()))?;
    let before_digest = MechanicalStateDigestV2::compute(before)
        .map_err(|error| RunTransitionPreparationError::Digest(error.to_string()))?;
    let after_digest = MechanicalStateDigestV2::compute(&after)
        .map_err(|error| RunTransitionPreparationError::Digest(error.to_string()))?;

    Ok(AuthorityRunMaterial::Interaction(
        RunInteractionMaterialV1 {
            schema_version: RUN_INTERACTION_MATERIAL_VERSION,
            header: RunMaterialHeader {
                m4_oracle_sha: content.run.m4_oracle_sha.clone(),
                m3_parity_oracle_sha: RUN_MATERIAL_M3_PARITY_ORACLE_SHA.to_owned(),
                battle_content_hash: before.battle_content_hash.clone(),
                run_content_hash: before.run_content_hash.clone(),
                operation_id: reward.header.operation_id.clone(),
                run_id: before.run.run_id,
                wave: before.run.wave,
                before_digest,
                after_digest,
                before_state: before.clone(),
                after_state: after,
                next_control,
            },
            surface_kind: RunSurfaceKind::RewardShop,
            surface_id: reward.header.surface_id,
            owner_seat: reward.header.owner_seat,
            interaction_sequence: reward.header.interaction_sequence,
            action_ordinal: reward.header.action_ordinal,
            action: action.clone(),
            mutations: vec![
                RunMutation::RewardOfferSold { offer: *offer },
                RunMutation::ModifierApplied {
                    modifier_id: selected.modifier_id,
                    stacks: 1,
                    target: *target,
                },
            ],
            presentation: vec![RunPresentationEvent::ModifierAcquired {
                modifier_id: selected.modifier_id,
                target: *target,
            }],
            rng_audit: Vec::new(),
            surface_after_digest: Some(surface_digest),
        },
    ))
}
