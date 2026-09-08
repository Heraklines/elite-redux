//! In-memory, caller-resolved composition for the qualified existing-account fixture.
//! No external source dispatch, profile persistence, account creation or UI execution.
//! Only successful MAX/SPLICE candyTeam dispatches in the observed Ace context are
//! admitted. Source fail-open exceptions and unknown external effects are unsupported.
use std::sync::Arc;

use thiserror::Error;

use crate::current_friendship::{
    CurrentFriendshipError, ExistingStarterAccount, FRIENDSHIP_ORACLE_SHA, FriendshipHead,
    FriendshipIntent, FriendshipSourceProvenance, ResolvedPositiveFriendship,
    add_resolved_starter_candy, continue_friendship_tail, prepare_friendship_head,
};

#[derive(Clone, Debug, PartialEq)]
pub struct FriendshipAccountState {
    pub friendship: f64,
    /// At most four existing accounts, including every reward and progress root.
    pub accounts: Vec<ExistingStarterAccount>,
    pub max_unlocked: bool,
    pub splice_unlocked: bool,
    /// Only the observed empty/bit11/bit39/bit40 closure is admitted, including
    /// its real category-index aliases. This is not an arbitrary profile bitset.
    pub cosmetic_bits: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ObservedAchievement {
    MaxFriendship,
    Splice,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedRewardRecipient {
    /// Identity-union result supplied by the source resolver, not a species ID.
    pub object_id: u64,
    pub species: u32,
    pub source_root: u32,
    pub candy_root: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedCosmeticEffect {
    pub id: String,
    pub index: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedCandyTeamReward {
    pub provenance: FriendshipSourceProvenance,
    pub difficulty: String,
    pub per_mon: u16,
    pub total_candy_rate: u8,
    pub fun_debug: bool,
    pub reunlock: bool,
    /// The complete admitted source team; at most the two observed objects.
    pub recipients: Vec<ResolvedRewardRecipient>,
    pub effects: Vec<ResolvedCosmeticEffect>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DirectCandyRequest {
    pub species: u32,
    pub candy_root: u32,
    pub count: i64,
    pub from_egg: bool,
    pub show_bar: bool,
    pub fun_debug: bool,
    pub total_candy_rate: u8,
    pub provenance: FriendshipSourceProvenance,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SemanticCandyCall {
    pub species: u32,
    pub candy_root: u32,
    pub count: i64,
    /// None preserves an omitted JavaScript argument rather than inventing one.
    pub from_egg: Option<bool>,
    pub show_bar: Option<bool>,
    pub before_candy: i64,
    pub after_candy: i64,
    pub returned: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum CompositionIntent {
    AchievementValidated {
        achievement: ObservedAchievement,
        unlocked_now: bool,
    },
    CandyBar(FriendshipIntent),
    CosmeticAvailability {
        effect: ResolvedCosmeticEffect,
        changed: bool,
    },
    /// The caller's ribbon owner still resolves and applies the actual line.
    RibbonLine {
        original_species: u32,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct CompositionReceipt {
    pub call_id: u64,
    pub state: FriendshipAccountState,
    pub semantic_calls: Vec<SemanticCandyCall>,
    pub intents: Vec<CompositionIntent>,
    pub direct_return: Option<bool>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct OwnedReceipt {
    /// False means a retained read. The cumulative receipt is never a dispatch list.
    pub newly_settled: bool,
    /// Only the newly settled suffix; always empty for an identical replay.
    pub new_intents: Vec<CompositionIntent>,
    pub new_semantic_calls: Vec<SemanticCandyCall>,
    pub receipt: CompositionReceipt,
}

impl OwnedReceipt {
    fn fresh(receipt: CompositionReceipt, prior_intents: usize, prior_calls: usize) -> Self {
        Self {
            newly_settled: true,
            new_intents: receipt
                .intents
                .iter()
                .skip(prior_intents)
                .cloned()
                .collect(),
            new_semantic_calls: receipt
                .semantic_calls
                .iter()
                .skip(prior_calls)
                .cloned()
                .collect(),
            receipt,
        }
    }

    fn replayed(receipt: CompositionReceipt) -> Self {
        Self {
            newly_settled: false,
            new_intents: Vec::new(),
            new_semantic_calls: Vec::new(),
            receipt,
        }
    }
}

#[derive(Clone, Debug)]
pub struct FriendshipCallToken {
    owner: Arc<()>,
    id: u64,
}

#[derive(Clone, Debug)]
enum Operation {
    Friendship(Box<PendingFriendship>),
    SpliceReward,
    DirectCandy(DirectCandyRequest),
}

#[derive(Clone, Debug)]
struct PendingFriendship {
    head: FriendshipHead,
    resolved: Option<ResolvedPositiveFriendship>,
}

struct CandyRequest {
    species: u32,
    root: u32,
    count: i64,
    from_egg: Option<bool>,
    show_bar: Option<bool>,
    fun_debug: bool,
    total_candy_rate: u8,
}

#[derive(Clone, Debug)]
struct Pending {
    id: u64,
    operation: Operation,
    achievement: Option<(ObservedAchievement, ResolvedCandyTeamReward)>,
    reward_receipt: Option<CompositionReceipt>,
    staged: CompositionReceipt,
}

#[derive(Clone, Debug)]
struct Completed {
    receipt: CompositionReceipt,
    reward_receipt: Option<CompositionReceipt>,
}

/// Deliberately not Clone/Serialize: tokens bind this owner by Arc identity.
/// The allocator, live account state and pending/completed results are private.
#[derive(Debug)]
pub struct FriendshipCompositionOwner {
    identity: Arc<()>,
    next_call: u64,
    state: FriendshipAccountState,
    pending: Option<Pending>,
    completed: Option<Completed>,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum CompositionError {
    #[error("unsupported existing-account source composition input")]
    Unsupported,
    #[error("an owned call is already pending")]
    Busy,
    #[error("foreign, stale or wrong-phase owned call")]
    Ownership,
    #[error("owned call allocator exhausted")]
    Overflow,
    #[error(transparent)]
    Arithmetic(#[from] CurrentFriendshipError),
}

fn provenance(value: &FriendshipSourceProvenance) -> Result<(), CompositionError> {
    if value.oracle_sha != FRIENDSHIP_ORACLE_SHA
        || value.resolution_sha256.len() != 64
        || !value
            .resolution_sha256
            .bytes()
            .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
    {
        return Err(CompositionError::Unsupported);
    }
    Ok(())
}

fn account_index(
    accounts: &[ExistingStarterAccount],
    root: u32,
) -> Result<usize, CompositionError> {
    accounts
        .iter()
        .position(|entry| entry.species_id == root)
        .ok_or(CompositionError::Unsupported)
}

fn validate_state(state: &FriendshipAccountState) -> Result<(), CompositionError> {
    if !state.friendship.is_finite()
        || !(0.0..=255.0).contains(&state.friendship)
        || state.accounts.len() > 4
        || state.cosmetic_bits.len() > 6
        || state.cosmetic_bits.last() == Some(&0)
    {
        return Err(CompositionError::Unsupported);
    }
    for (index, byte) in state.cosmetic_bits.iter().enumerate() {
        let allowed = match index {
            1 => 8,
            4 => 128,
            5 => 1,
            _ => 0,
        };
        if byte & !allowed != 0 {
            return Err(CompositionError::Unsupported);
        }
    }
    for (index, account) in state.accounts.iter().enumerate() {
        if account.species_id == 0
            || account.friendship_progress > 9_007_199_254_740_991
            || account.candy_count.unsigned_abs() > 9_007_199_254_740_991
            || state.accounts[..index]
                .iter()
                .any(|prior| prior.species_id == account.species_id)
        {
            return Err(CompositionError::Unsupported);
        }
    }
    Ok(())
}

fn project(
    state: &FriendshipAccountState,
    resolved: Option<&ResolvedPositiveFriendship>,
) -> Result<Vec<ExistingStarterAccount>, CompositionError> {
    let Some(resolved) = resolved else {
        return Ok(state.accounts.clone());
    };
    let roots: Vec<u32> = std::iter::once(&resolved.starter)
        .chain(resolved.fusion_starter.iter())
        .flat_map(|entry| [entry.source_root, entry.candy_account_root])
        .collect();
    for root in &roots {
        account_index(&state.accounts, *root)?;
    }
    Ok(state
        .accounts
        .iter()
        .filter(|entry| roots.contains(&entry.species_id))
        .cloned()
        .collect())
}

fn validate_reward(
    kind: ObservedAchievement,
    reward: &ResolvedCandyTeamReward,
    state: &FriendshipAccountState,
) -> Result<(), CompositionError> {
    provenance(&reward.provenance)?;
    if reward.difficulty != "ace"
        || reward.per_mon != 10
        || reward.total_candy_rate != 1
        || reward.fun_debug
        || reward.reunlock
        || reward.recipients.is_empty()
        || reward.recipients.len() > 2
    {
        return Err(CompositionError::Unsupported);
    }
    let expected = match kind {
        ObservedAchievement::MaxFriendship => vec![("sakura", 39), ("hearts", 40)],
        ObservedAchievement::Splice => vec![("dissolve", 11)],
    };
    if reward
        .effects
        .iter()
        .map(|effect| (effect.id.as_str(), effect.index))
        .collect::<Vec<_>>()
        != expected
    {
        return Err(CompositionError::Unsupported);
    }
    for (index, recipient) in reward.recipients.iter().enumerate() {
        if recipient.species == 0
            || recipient.source_root == 0
            || recipient.candy_root == 0
            || reward.recipients[..index]
                .iter()
                .any(|prior| prior.object_id == recipient.object_id)
        {
            return Err(CompositionError::Unsupported);
        }
        account_index(&state.accounts, recipient.candy_root)?;
    }
    Ok(())
}

impl FriendshipCompositionOwner {
    pub fn new(state: FriendshipAccountState, next_call: u64) -> Result<Self, CompositionError> {
        validate_state(&state)?;
        if next_call == 0 {
            return Err(CompositionError::Unsupported);
        }
        Ok(Self {
            identity: Arc::new(()),
            next_call,
            state,
            pending: None,
            completed: None,
        })
    }

    pub fn state(&self) -> &FriendshipAccountState {
        &self.state
    }
    pub fn next_call(&self) -> u64 {
        self.next_call
    }
    pub fn pending_state(&self) -> Option<&FriendshipAccountState> {
        self.pending.as_ref().map(|p| &p.staged.state)
    }

    fn stage(
        &mut self,
        operation: Operation,
        achievement: Option<(ObservedAchievement, ResolvedCandyTeamReward)>,
        friendship: f64,
    ) -> Result<FriendshipCallToken, CompositionError> {
        if self.pending.is_some() {
            return Err(CompositionError::Busy);
        }
        let next = self
            .next_call
            .checked_add(1)
            .ok_or(CompositionError::Overflow)?;
        let mut state = self.state.clone();
        state.friendship = friendship;
        let token = FriendshipCallToken {
            owner: Arc::clone(&self.identity),
            id: self.next_call,
        };
        self.pending = Some(Pending {
            id: token.id,
            operation,
            achievement,
            reward_receipt: None,
            staged: CompositionReceipt {
                call_id: token.id,
                state,
                semantic_calls: Vec::new(),
                intents: Vec::new(),
                direct_return: None,
            },
        });
        self.next_call = next;
        Ok(token)
    }

    pub fn begin_friendship(
        &mut self,
        original_delta: f64,
        resolved: Option<ResolvedPositiveFriendship>,
        reward: Option<ResolvedCandyTeamReward>,
    ) -> Result<FriendshipCallToken, CompositionError> {
        if self.pending.is_some() {
            return Err(CompositionError::Busy);
        }
        // Preserve the source's nonpositive and Fun-debug early-return scope.
        let needs_resolution =
            original_delta > 0.0 && !resolved.as_ref().is_some_and(|r| r.fun_debug);
        let accounts = project(
            &self.state,
            if needs_resolution {
                resolved.as_ref()
            } else {
                None
            },
        )?;
        let head = prepare_friendship_head(
            self.state.friendship,
            original_delta,
            &accounts,
            resolved.as_ref(),
        )?;
        let achievement = if head.has_tail && head.plan.friendship >= 255.0 {
            let reward = reward.ok_or(CompositionError::Unsupported)?;
            validate_reward(ObservedAchievement::MaxFriendship, &reward, &self.state)?;
            if resolved
                .as_ref()
                .is_none_or(|r| r.provenance != reward.provenance)
            {
                return Err(CompositionError::Unsupported);
            }
            Some((ObservedAchievement::MaxFriendship, reward))
        } else {
            if reward.is_some() {
                return Err(CompositionError::Unsupported);
            }
            None
        };
        let friendship = head.plan.friendship;
        self.stage(
            Operation::Friendship(Box::new(PendingFriendship { head, resolved })),
            achievement,
            friendship,
        )
    }

    /// Only the resolved reward action is composed; this does not implement fuse.
    pub fn begin_splice_reward(
        &mut self,
        reward: ResolvedCandyTeamReward,
    ) -> Result<FriendshipCallToken, CompositionError> {
        validate_reward(ObservedAchievement::Splice, &reward, &self.state)?;
        self.stage(
            Operation::SpliceReward,
            Some((ObservedAchievement::Splice, reward)),
            self.state.friendship,
        )
    }

    pub fn begin_direct_candy(
        &mut self,
        request: DirectCandyRequest,
    ) -> Result<FriendshipCallToken, CompositionError> {
        provenance(&request.provenance)?;
        if request.species == 0 {
            return Err(CompositionError::Unsupported);
        }
        account_index(&self.state.accounts, request.candy_root)?;
        self.stage(Operation::DirectCandy(request), None, self.state.friendship)
    }

    fn check_owner(&self, token: &FriendshipCallToken) -> Result<(), CompositionError> {
        if !Arc::ptr_eq(&token.owner, &self.identity) {
            return Err(CompositionError::Ownership);
        }
        Ok(())
    }

    pub fn settle_achievement(
        &mut self,
        token: &FriendshipCallToken,
    ) -> Result<OwnedReceipt, CompositionError> {
        self.check_owner(token)?;
        if let Some(completed) = &self.completed
            && completed.receipt.call_id == token.id
        {
            return completed
                .reward_receipt
                .clone()
                .map(OwnedReceipt::replayed)
                .ok_or(CompositionError::Ownership);
        }
        let mut pending = self
            .pending
            .as_ref()
            .filter(|p| p.id == token.id)
            .cloned()
            .ok_or(CompositionError::Ownership)?;
        if let Some(receipt) = &pending.reward_receipt {
            return Ok(OwnedReceipt::replayed(receipt.clone()));
        }
        let (kind, reward) = pending
            .achievement
            .as_ref()
            .ok_or(CompositionError::Ownership)?;
        let unlocked = match kind {
            ObservedAchievement::MaxFriendship => &mut pending.staged.state.max_unlocked,
            ObservedAchievement::Splice => &mut pending.staged.state.splice_unlocked,
        };
        let newly_unlocked = !*unlocked;
        pending
            .staged
            .intents
            .push(CompositionIntent::AchievementValidated {
                achievement: *kind,
                unlocked_now: newly_unlocked,
            });
        if newly_unlocked {
            *unlocked = true;
            // Pinned Ace candyTeam: Math.round(10 * 1.5). Resolved inputs above
            // admit this one exact successful source context, not a neutral rate.
            let amount = (f64::from(reward.per_mon) * 1.5_f64 + 0.5_f64).floor() as i64;
            for recipient in &reward.recipients {
                record_candy(
                    &mut pending.staged,
                    CandyRequest {
                        species: recipient.species,
                        root: recipient.candy_root,
                        count: amount,
                        from_egg: Some(true),
                        show_bar: None,
                        fun_debug: reward.fun_debug,
                        total_candy_rate: reward.total_candy_rate,
                    },
                )?;
            }
            for effect in &reward.effects {
                let index = usize::from(effect.index);
                let byte = index / 8;
                let mask = 1 << (index % 8);
                let bits = &mut pending.staged.state.cosmetic_bits;
                let changed = bits.get(byte).copied().unwrap_or(0) & mask == 0;
                while bits.len() <= byte {
                    bits.push(0);
                }
                bits[byte] |= mask;
                pending
                    .staged
                    .intents
                    .push(CompositionIntent::CosmeticAvailability {
                        effect: effect.clone(),
                        changed,
                    });
            }
        }
        validate_state(&pending.staged.state)?;
        let receipt = pending.staged.clone();
        pending.reward_receipt = Some(receipt.clone());
        self.pending = Some(pending);
        Ok(OwnedReceipt::fresh(receipt, 0, 0))
    }

    pub fn finish(
        &mut self,
        token: &FriendshipCallToken,
    ) -> Result<OwnedReceipt, CompositionError> {
        self.check_owner(token)?;
        if let Some(completed) = &self.completed
            && completed.receipt.call_id == token.id
        {
            return Ok(OwnedReceipt::replayed(completed.receipt.clone()));
        }
        let mut pending = self
            .pending
            .as_ref()
            .filter(|p| p.id == token.id)
            .cloned()
            .ok_or(CompositionError::Ownership)?;
        if pending.achievement.is_some() && pending.reward_receipt.is_none() {
            return Err(CompositionError::Ownership);
        }
        match &pending.operation {
            Operation::Friendship(friendship) => {
                let PendingFriendship { head, resolved } = friendship.as_ref();
                if head.has_tail {
                    let resolved = resolved.as_ref().ok_or(CompositionError::Ownership)?;
                    if head.plan.friendship >= 255.0 {
                        pending.staged.intents.push(CompositionIntent::RibbonLine {
                            original_species: resolved.pokemon_species,
                        });
                    }
                    let mut plan = head.plan.clone();
                    plan.accounts = project(&pending.staged.state, Some(resolved))?;
                    let mut calls = Vec::new();
                    let result = continue_friendship_tail(plan, resolved, Some(&mut calls))?;
                    // Exact checked projection/merge: unrelated accounts retain values/order.
                    for entry in result.accounts {
                        let index =
                            account_index(&pending.staged.state.accounts, entry.species_id)?;
                        pending.staged.state.accounts[index] = entry;
                    }
                    for call in calls {
                        pending.staged.semantic_calls.push(SemanticCandyCall {
                            species: call.species,
                            candy_root: call.root,
                            count: call.requested_count,
                            from_egg: None,
                            show_bar: None,
                            before_candy: call.before_candy,
                            after_candy: call.result.candy_count,
                            returned: call.result.returned_true,
                        });
                    }
                    pending
                        .staged
                        .intents
                        .extend(result.intents.into_iter().map(CompositionIntent::CandyBar));
                }
            }
            Operation::SpliceReward => {}
            Operation::DirectCandy(request) => {
                let returned = record_candy(
                    &mut pending.staged,
                    CandyRequest {
                        species: request.species,
                        root: request.candy_root,
                        count: request.count,
                        from_egg: Some(request.from_egg),
                        show_bar: Some(request.show_bar),
                        fun_debug: request.fun_debug,
                        total_candy_rate: request.total_candy_rate,
                    },
                )?;
                pending.staged.direct_return = Some(returned);
            }
        }
        validate_state(&pending.staged.state)?;
        let (prior_intents, prior_calls) =
            pending.reward_receipt.as_ref().map_or((0, 0), |receipt| {
                (receipt.intents.len(), receipt.semantic_calls.len())
            });
        let receipt = pending.staged;
        self.state = receipt.state.clone();
        self.pending = None;
        self.completed = Some(Completed {
            receipt: receipt.clone(),
            reward_receipt: pending.reward_receipt,
        });
        Ok(OwnedReceipt::fresh(receipt, prior_intents, prior_calls))
    }
}

fn record_candy(
    receipt: &mut CompositionReceipt,
    request: CandyRequest,
) -> Result<bool, CompositionError> {
    let CandyRequest {
        species,
        root,
        count,
        from_egg,
        show_bar,
        fun_debug,
        total_candy_rate,
    } = request;
    let index = account_index(&receipt.state.accounts, root)?;
    let before = receipt.state.accounts[index].candy_count;
    let result = add_resolved_starter_candy(
        before,
        count,
        from_egg.unwrap_or(false),
        show_bar.unwrap_or(true),
        fun_debug,
        total_candy_rate,
    )?;
    if let Some(scaled_count) = result.candy_bar_count {
        receipt.intents.push(CompositionIntent::CandyBar(
            FriendshipIntent::ShowStarterCandy {
                root,
                scaled_count,
                before_candy: before,
                after_candy: result.candy_count,
            },
        ));
    }
    receipt.state.accounts[index].candy_count = result.candy_count;
    receipt.semantic_calls.push(SemanticCandyCall {
        species,
        candy_root: root,
        count,
        from_egg,
        show_bar,
        before_candy: before,
        after_candy: result.candy_count,
        returned: result.returned_true,
    });
    Ok(result.returned_true)
}
