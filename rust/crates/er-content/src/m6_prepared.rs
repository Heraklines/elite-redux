//! M6 prepared battle content: one-time pack validation and deterministic
//! indexes.
//!
//! [`prepare_content`] consumes a [`BattleContentPackV3`] exactly once,
//! validates it, preserves its [`BattleContentPackHashV3`] identity, and
//! derives vector- and sorted-slice indexes over every identity class:
//! moves, abilities, held items, statuses, weather, terrain, tags, species,
//! forms, mechanics programs, hooks, and queries.
//!
//! Runtime execution receives prepared content only. Lookups are either direct
//! vector indexing by numeric ID or binary search over stable sorted slices;
//! no lookup rescans the catalog, iterates a hash map, recompiles content, or
//! reparses source text.
//!
//! Prepared content is derived runtime state. It is deliberately **not**
//! serializable: identity travels as the frozen content hash of the validated
//! pack it was prepared from, and every replica rebuilds its own indexes from
//! identical canonical pack bytes.

use er_mechanics::{HookBindingV2, MechanicHookV2, MechanicQueryV2, MechanicsProgramV2};
use er_types::battle_ids::{AbilityId, MoveId, SpeciesId};
use er_types::mechanics::MechanicsProgramId;
use er_types::{
    BattleContentPackHashV3, BehaviorSourceId, CatalogHash, FormId, OracleSha, SafeU53,
};
use thiserror::Error;

use crate::m6_pack::{
    AbilityDefinitionV3, BattleContentPackV3, FormDefinitionV1, HeldItemDefinitionV3,
    M6PackLoadError, MoveDefinitionV3, SpeciesDefinitionV3, StatusDefinitionV2,
    TagDefinitionV2, TerrainDefinitionV2, WeatherDefinitionV2,
};

/// One binding site participating in a hook or query invocation.
///
/// The reference resolves through direct program-ID indexing; `program_slot`
/// indexes the pack program vector and `binding` indexes that program's
/// bindings. Sources appear in ascending program order, and within one program
/// in frozen binding order (hook stage, authored priority, behavior unit,
/// binding ordinal).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HookBindingRef {
    /// Program ID owning the binding.
    pub program: MechanicsProgramId,
    /// Slot of the program inside the pack's program vector.
    pub program_slot: u32,
    /// Index of the binding inside the program's bindings vector.
    pub binding: u32,
}

/// Closed hook slots for the deterministic hook index. A new
/// [`MechanicHookV2`] variant fails compilation in [`hook_slot`], forcing this
/// count to be updated alongside it.
const HOOK_SOURCE_SLOTS: usize = 39;

/// Closed query slots for the deterministic query index. A new
/// [`MechanicQueryV2`] variant fails compilation in [`query_slot`], forcing
/// this count to be updated alongside it.
const QUERY_SOURCE_SLOTS: usize = 17;

/// Maps every closed hook variant onto its dense index slot.
const fn hook_slot(hook: MechanicHookV2) -> usize {
    match hook {
        MechanicHookV2::BattleLoad => 0,
        MechanicHookV2::BattleStart => 1,
        MechanicHookV2::BeforeSummon => 2,
        MechanicHookV2::AfterSummon => 3,
        MechanicHookV2::BeforeActionOrder => 4,
        MechanicHookV2::BeforeAction => 5,
        MechanicHookV2::BeforeMove => 6,
        MechanicHookV2::MoveTargetQuery => 7,
        MechanicHookV2::PriorityQuery => 8,
        MechanicHookV2::EffectiveSpeedQuery => 9,
        MechanicHookV2::AccuracyQuery => 10,
        MechanicHookV2::CriticalQuery => 11,
        MechanicHookV2::MovePowerQuery => 12,
        MechanicHookV2::OffensiveStatQuery => 13,
        MechanicHookV2::DefensiveStatQuery => 14,
        MechanicHookV2::TypeEffectivenessQuery => 15,
        MechanicHookV2::DamageQuery => 16,
        MechanicHookV2::HitCountQuery => 17,
        MechanicHookV2::StatusEligibilityQuery => 18,
        MechanicHookV2::VolatileEligibilityQuery => 19,
        MechanicHookV2::SwitchEligibilityQuery => 20,
        MechanicHookV2::ItemEligibilityQuery => 21,
        MechanicHookV2::BeforeHit => 22,
        MechanicHookV2::AfterHit => 23,
        MechanicHookV2::AfterMove => 24,
        MechanicHookV2::AfterDamage => 25,
        MechanicHookV2::BeforeStatus => 26,
        MechanicHookV2::AfterStatus => 27,
        MechanicHookV2::BeforeSwitchOut => 28,
        MechanicHookV2::AfterSwitchOut => 29,
        MechanicHookV2::BeforeSwitchIn => 30,
        MechanicHookV2::WeatherChanged => 31,
        MechanicHookV2::WeatherLapse => 32,
        MechanicHookV2::TerrainChanged => 33,
        MechanicHookV2::TurnEnd => 34,
        MechanicHookV2::ScheduledEvent => 35,
        MechanicHookV2::BeforeFaint => 36,
        MechanicHookV2::AfterFaint => 37,
        MechanicHookV2::Victory => 38,
    }
}

/// Maps every closed query accumulator onto its dense index slot.
const fn query_slot(query: MechanicQueryV2) -> usize {
    match query {
        MechanicQueryV2::MoveType => 0,
        MechanicQueryV2::MoveCategory => 1,
        MechanicQueryV2::MoveTargetShape => 2,
        MechanicQueryV2::ActionPriority => 3,
        MechanicQueryV2::EffectiveSpeed => 4,
        MechanicQueryV2::Accuracy => 5,
        MechanicQueryV2::CriticalRate => 6,
        MechanicQueryV2::MovePower => 7,
        MechanicQueryV2::OffensiveStat => 8,
        MechanicQueryV2::DefensiveStat => 9,
        MechanicQueryV2::TypeEffectiveness => 10,
        MechanicQueryV2::Damage => 11,
        MechanicQueryV2::HitCount => 12,
        MechanicQueryV2::StatusEligibility => 13,
        MechanicQueryV2::VolatileEligibility => 14,
        MechanicQueryV2::SwitchEligibility => 15,
        MechanicQueryV2::ItemEligibility => 16,
    }
}

/// Validates a battle content pack once and prepares its deterministic
/// execution indexes.
///
/// Invalid packs fail before any index escapes: duplicate identities, missing
/// references, unclassified behavior units, dangling program/bespoke/RNG-site
/// references, and broken ordering are rejected through the frozen pack
/// validation before construction succeeds.
pub fn prepare_content(
    pack: BattleContentPackV3,
) -> Result<PreparedBattleContentV3, ContentError> {
    // One total validation pass proves identity closure, reference closure,
    // classification closure, RNG ownership, and the embedded content hash.
    pack.validate().map_err(ContentError::Pack)?;

    let mut hooks: [Vec<HookBindingRef>; HOOK_SOURCE_SLOTS] =
        std::array::from_fn(|_| Vec::new());
    let mut queries: [Vec<HookBindingRef>; QUERY_SOURCE_SLOTS] =
        std::array::from_fn(|_| Vec::new());

    for (slot_index, program) in pack.programs.iter().enumerate() {
        let Some(program) = program else {
            continue;
        };
        // Pack validation already proved program.id equals its slot; the slot
        // conversion only guards the platform index width.
        let program_slot = u32::try_from(slot_index)
            .map_err(|_| ContentError::IndexOverflow { value: slot_index as u64 })?;
        for (binding_index, binding) in program.bindings.iter().enumerate() {
            let binding_index = u32::try_from(binding_index).map_err(|_| {
                ContentError::IndexOverflow { value: binding_index as u64 }
            })?;
            let reference = HookBindingRef {
                program: program.id,
                program_slot,
                binding: binding_index,
            };
            hooks[hook_slot(binding.hook)].push(reference);
            if let Ok(query) = binding.hook.query() {
                queries[query_slot(query)].push(reference);
            }
        }
    }

    Ok(PreparedBattleContentV3 {
        schema_version: pack.schema_version,
        oracle_sha: pack.oracle_sha.clone(),
        raw_catalog_hash: pack.raw_catalog_hash.clone(),
        semantic_catalog_hash: pack.semantic_catalog_hash.clone(),
        content_hash: pack.content_hash.clone(),
        hooks,
        queries,
        pack,
    })
}

/// Immutable, non-serializable prepared view over one validated
/// [`BattleContentPackV3`].
///
/// Numeric identities resolve by direct vector indexing, registry-keyed
/// identities by binary search over the validated sorted slices, programs by
/// direct ID indexing, and hook/query participants through precomputed source
/// lists that preserve program/binding order.
#[derive(Clone, Debug)]
pub struct PreparedBattleContentV3 {
    schema_version: u32,
    oracle_sha: OracleSha,
    raw_catalog_hash: CatalogHash,
    semantic_catalog_hash: CatalogHash,
    content_hash: BattleContentPackHashV3,
    hooks: [Vec<HookBindingRef>; HOOK_SOURCE_SLOTS],
    queries: [Vec<HookBindingRef>; QUERY_SOURCE_SLOTS],
    pack: BattleContentPackV3,
}

impl PreparedBattleContentV3 {
    /// Frozen battle content pack schema version of the validated source.
    pub const fn schema_version(&self) -> u32 {
        self.schema_version
    }

    /// Oracle identity of the validated source pack.
    pub const fn oracle_sha(&self) -> &OracleSha {
        &self.oracle_sha
    }

    /// Raw source catalog hash of the validated source pack.
    pub const fn raw_catalog_hash(&self) -> &CatalogHash {
        &self.raw_catalog_hash
    }

    /// Semantic catalog hash of the validated source pack.
    pub const fn semantic_catalog_hash(&self) -> &CatalogHash {
        &self.semantic_catalog_hash
    }

    /// Frozen canonical content hash; the exact pack identity carried into
    /// materials and replicas.
    pub const fn content_hash(&self) -> &BattleContentPackHashV3 {
        &self.content_hash
    }

    /// The validated source pack itself. Ownership stays internal; callers
    /// borrow immutable slices only.
    pub const fn pack(&self) -> &BattleContentPackV3 {
        &self.pack
    }

    /// Resolves one species definition by direct numeric-ID indexing.
    pub fn species(&self, id: SpeciesId) -> Result<&SpeciesDefinitionV3, ContentError> {
        numeric_definition("species", &self.pack.species, id.get())
    }

    /// Resolves one move definition by direct numeric-ID indexing.
    pub fn move_definition(&self, id: MoveId) -> Result<&MoveDefinitionV3, ContentError> {
        numeric_definition("moves", &self.pack.moves, id.get())
    }

    /// Resolves one ability definition by direct numeric-ID indexing.
    pub fn ability_definition(
        &self,
        id: AbilityId,
    ) -> Result<&AbilityDefinitionV3, ContentError> {
        numeric_definition("abilities", &self.pack.abilities, id.get())
    }

    /// Resolves one major status definition by direct numeric-ID indexing.
    pub fn status(&self, id: SafeU53) -> Result<&StatusDefinitionV2, ContentError> {
        numeric_definition("statuses", &self.pack.field_content.statuses, id.get())
    }

    /// Resolves one weather definition by direct numeric-ID indexing.
    pub fn weather(&self, id: SafeU53) -> Result<&WeatherDefinitionV2, ContentError> {
        numeric_definition("weather", &self.pack.field_content.weather, id.get())
    }

    /// Resolves one terrain definition by direct numeric-ID indexing.
    pub fn terrain(&self, id: SafeU53) -> Result<&TerrainDefinitionV2, ContentError> {
        numeric_definition("terrain", &self.pack.field_content.terrain, id.get())
    }

    /// Resolves one held item by binary search over the registry-keyed slice.
    pub fn held_item(&self, key: &str) -> Result<&HeldItemDefinitionV3, ContentError> {
        registry_definition("held_items", &self.pack.held_items, key, |entry| {
            entry.registry_key.as_str()
        })
    }

    /// Resolves one side condition by binary search over its sorted slice.
    pub fn side_condition(&self, key: &str) -> Result<&TagDefinitionV2, ContentError> {
        registry_definition(
            "side_conditions",
            &self.pack.field_content.side_conditions,
            key,
            |entry| entry.registry_key.as_str(),
        )
    }

    /// Resolves one battler tag by binary search over its sorted slice.
    pub fn battler_tag(&self, key: &str) -> Result<&TagDefinitionV2, ContentError> {
        registry_definition(
            "battler_tags",
            &self.pack.field_content.battler_tags,
            key,
            |entry| entry.registry_key.as_str(),
        )
    }

    /// Resolves one arena tag by binary search over its sorted slice.
    pub fn arena_tag(&self, key: &str) -> Result<&TagDefinitionV2, ContentError> {
        registry_definition(
            "arena_tags",
            &self.pack.field_content.arena_tags,
            key,
            |entry| entry.registry_key.as_str(),
        )
    }

    /// Resolves one positional tag by binary search over its sorted slice.
    pub fn positional_tag(&self, key: &str) -> Result<&TagDefinitionV2, ContentError> {
        registry_definition(
            "positional_tags",
            &self.pack.field_content.positional_tags,
            key,
            |entry| entry.registry_key.as_str(),
        )
    }

    /// Resolves one form definition by binary search over the form-ID-ordered
    /// slice.
    pub fn form(&self, id: &FormId) -> Result<&FormDefinitionV1, ContentError> {
        match self.pack.forms.binary_search_by(|entry| entry.id.cmp(id)) {
            Ok(index) => Ok(&self.pack.forms[index]),
            Err(_) => Err(ContentError::UnknownRegistryKey {
                kind: "forms",
                key: id.as_str().to_owned(),
            }),
        }
    }

    /// Resolves one mechanics program by direct program-ID indexing. Pack
    /// validation proved program IDs equal their vector slots, so the lookup
    /// is a single bounds-checked read.
    pub fn program(&self, id: MechanicsProgramId) -> Result<&MechanicsProgramV2, ContentError> {
        let slot = platform_index(id.get().get())?;
        self.pack
            .programs
            .get(slot)
            .and_then(Option::as_ref)
            .ok_or(ContentError::UnknownProgram { program: id })
    }

    /// Ordered bindings participating in one hook, preserving program order
    /// and each program's frozen binding order.
    pub fn hook_sources(&self, hook: MechanicHookV2) -> &[HookBindingRef] {
        &self.hooks[hook_slot(hook)]
    }

    /// Ordered bindings folding into one query accumulator, preserving
    /// program order and each program's frozen binding order.
    pub fn query_sources(&self, query: MechanicQueryV2) -> &[HookBindingRef] {
        &self.queries[query_slot(query)]
    }

    /// Resolves a binding reference to its program and binding without
    /// scanning.
    pub fn resolve_binding(
        &self,
        reference: HookBindingRef,
    ) -> Result<(&MechanicsProgramV2, &HookBindingV2), ContentError> {
        let slot = platform_index(u64::from(reference.program_slot))?;
        let program = self
            .pack
            .programs
            .get(slot)
            .and_then(Option::as_ref)
            .ok_or(ContentError::DanglingBindingRef)?;
        if program.id != reference.program {
            return Err(ContentError::DanglingBindingRef);
        }
        let binding_index = platform_index(u64::from(reference.binding))?;
        let binding = program
            .bindings
            .get(binding_index)
            .ok_or(ContentError::DanglingBindingRef)?;
        Ok((program, binding))
    }

    /// Ordered mechanic programs owning one behavior source, resolved through
    /// the same numeric or binary-search indexes as the definitions
    /// themselves. Bespoke sources carry no compiled programs and stay an
    /// explicit typed error.
    pub fn source_programs(
        &self,
        source: &BehaviorSourceId,
    ) -> Result<&[MechanicsProgramId], ContentError> {
        match source {
            BehaviorSourceId::Move { numeric_id } => {
                Ok(self.move_definition(MoveId::new(*numeric_id))?.mechanic_programs.as_slice())
            }
            BehaviorSourceId::ActiveAbility { numeric_id }
            | BehaviorSourceId::PassiveAbility { numeric_id } => Ok(self
                .ability_definition(AbilityId::new(*numeric_id))?
                .mechanic_programs
                .as_slice()),
            BehaviorSourceId::HeldItem { registry_key } => {
                Ok(self.held_item(registry_key)?.mechanic_programs.as_slice())
            }
            BehaviorSourceId::MajorStatus { numeric_id } => {
                Ok(self.status(*numeric_id)?.mechanic_programs.as_slice())
            }
            BehaviorSourceId::VolatileStatus { registry_key }
            | BehaviorSourceId::BattlerTag { registry_key } => {
                Ok(self.battler_tag(registry_key)?.mechanic_programs.as_slice())
            }
            BehaviorSourceId::Weather { numeric_id } => {
                Ok(self.weather(*numeric_id)?.mechanic_programs.as_slice())
            }
            BehaviorSourceId::Terrain { numeric_id } => {
                Ok(self.terrain(*numeric_id)?.mechanic_programs.as_slice())
            }
            BehaviorSourceId::SideCondition { registry_key } => {
                Ok(self.side_condition(registry_key)?.mechanic_programs.as_slice())
            }
            BehaviorSourceId::ArenaTag { registry_key } => {
                Ok(self.arena_tag(registry_key)?.mechanic_programs.as_slice())
            }
            BehaviorSourceId::PositionalTag { registry_key } => {
                Ok(self.positional_tag(registry_key)?.mechanic_programs.as_slice())
            }
            BehaviorSourceId::Species { numeric_id } => {
                Ok(self.species(SpeciesId::new(*numeric_id))?.mechanic_programs.as_slice())
            }
            BehaviorSourceId::Form { registry_key } => {
                let form_id =
                    FormId::parse(registry_key).map_err(|_| ContentError::UnknownRegistryKey {
                        kind: "forms",
                        key: registry_key.clone(),
                    })?;
                Ok(self.form(&form_id)?.mechanic_programs.as_slice())
            }
            BehaviorSourceId::Bespoke { registry_key } => {
                Err(ContentError::BespokeSourceHasNoPrograms {
                    registry_key: registry_key.clone(),
                })
            }
        }
    }
}

/// Direct O(1) numeric lookup over a validated indexed-definition vector.
fn numeric_definition<'a, T>(
    kind: &'static str,
    entries: &'a [Option<T>],
    value: u64,
) -> Result<&'a T, ContentError> {
    let slot = platform_index(value)?;
    entries
        .get(slot)
        .and_then(Option::as_ref)
        .ok_or(ContentError::UnknownNumericId { kind, id: value })
}

/// Binary-search lookup over a validated strictly-sorted registry slice.
fn registry_definition<'a, T>(
    kind: &'static str,
    entries: &'a [T],
    key: &str,
    registry_key: impl Fn(&T) -> &str,
) -> Result<&'a T, ContentError> {
    match entries.binary_search_by(|entry| registry_key(entry).cmp(key)) {
        Ok(index) => Ok(&entries[index]),
        Err(_) => Err(ContentError::UnknownRegistryKey {
            kind,
            key: key.to_owned(),
        }),
    }
}

/// Rejects values that exceed the platform index width instead of truncating.
fn platform_index(value: u64) -> Result<usize, ContentError> {
    usize::try_from(value).map_err(|_| ContentError::IndexOverflow { value })
}

/// Typed failures raised while preparing or reading prepared battle content.
#[derive(Debug, Error)]
pub enum ContentError {
    /// The source pack failed its one-time frozen validation.
    #[error("battle content pack failed validation: {0}")]
    Pack(#[from] M6PackLoadError),
    /// No definition of `{kind}` carries the requested numeric ID.
    #[error("no {kind} definition carries ID {id}")]
    UnknownNumericId { kind: &'static str, id: u64 },
    /// No definition of `{kind}` carries the requested registry key.
    #[error("no {kind} definition carries registry key {key:?}")]
    UnknownRegistryKey { kind: &'static str, key: String },
    /// No compiled mechanics program carries the requested program ID.
    #[error("no mechanics program carries ID {program}")]
    UnknownProgram { program: MechanicsProgramId },
    /// A binding reference points outside the prepared program tables.
    #[error("binding reference does not resolve inside prepared content")]
    DanglingBindingRef,
    /// A bespoke behavior source owns no compiled mechanics programs; its
    /// implementations live in the bespoke manifest, never a program list.
    #[error("bespoke behavior source {registry_key:?} carries no mechanics programs")]
    BespokeSourceHasNoPrograms { registry_key: String },
    /// A value exceeds the platform index width and was rejected rather than
    /// truncated.
    #[error("value {value} exceeds the platform index width")]
    IndexOverflow { value: u64 },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::m6_pack::{
        AbilitySlotDefinitionV1, BehaviorClassificationEntryV2,
        BehaviorClassificationManifestV2, BespokeManifestV2, FieldContentV1,
    };
    use crate::pack::selected_type_chart;
    use crate::species::SpeciesBaseStats;
    use er_mechanics::condition_v2::{ConditionArenaV2, ValueArenaV2};
    use er_mechanics::m6::ProgramBudgetV2;
    use er_mechanics::selector_operation_v2::{MechanicOperationV2, SelectorArenaV2};
    use er_mechanics::ProgramRange;
    use er_types::battle_model::{
        EffectChance, MoveAccuracy, MoveCategory, MovePower, MoveTarget, PokemonType,
        PokemonTyping,
    };
    use er_types::{
        BehaviorClassificationKindV2, BehaviorUnitId, BehaviorUnitKind, BehaviorUnitOrdinal,
        M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION, M6_MECHANICS_PROGRAM_VERSION, ProvenanceHash,
    };

    fn safe(value: u64) -> SafeU53 {
        SafeU53::new(value).expect("fixture must be valid")
    }

    fn unit(move_id: u64) -> BehaviorUnitId {
        BehaviorUnitId {
            source: BehaviorSourceId::Move {
                numeric_id: safe(move_id),
            },
            unit_kind: BehaviorUnitKind::IntrinsicMoveRule,
            ordinal: BehaviorUnitOrdinal::ZERO,
            provenance_hash: ProvenanceHash::parse("0".repeat(64))
                .expect("fixture must be valid"),
        }
    }

    fn binding(hook: MechanicHookV2, owner: BehaviorUnitId, start: u32) -> HookBindingV2 {
        HookBindingV2 {
            hook,
            authored_priority: 0,
            binding_ordinal: 0,
            behavior_unit: owner,
            condition_root: None,
            selector_root: None,
            operations: ProgramRange { start, length: 1 },
        }
    }

    fn program(id: u64, unit: BehaviorUnitId, bindings: Vec<HookBindingV2>) -> MechanicsProgramV2 {
        let operations = bindings.len();
        MechanicsProgramV2 {
            schema_version: M6_MECHANICS_PROGRAM_VERSION,
            id: MechanicsProgramId::try_from_u64(id).expect("fixture must be valid"),
            source: unit.source.clone(),
            behavior_units: vec![unit],
            conditions: ConditionArenaV2::default(),
            selectors: SelectorArenaV2::default(),
            values: ValueArenaV2::default(),
            operations: vec![MechanicOperationV2::StatusApply; operations],
            scheduled_events: Vec::new(),
            rng_sites: Vec::new(),
            budget: ProgramBudgetV2 {
                hook_bindings: u16::try_from(operations).unwrap_or(u16::MAX),
                condition_nodes: 0,
                selector_nodes: 0,
                value_nodes: 0,
                operations: u16::try_from(operations).unwrap_or(u16::MAX),
                scheduled_events: 0,
                rng_draws: 0,
                spawned_instances: 0,
                presentation_cues: 0,
                selected_targets: 0,
            },
            bindings,
        }
    }

    fn move_fixture(id: u64) -> MoveDefinitionV3 {
        MoveDefinitionV3 {
            id: MoveId::try_from_u64(id).expect("fixture must be valid"),
            category: MoveCategory::Physical,
            move_type: PokemonType::Normal,
            power: MovePower::Value(80),
            accuracy: MoveAccuracy::Percent(100),
            base_pp: 40,
            effect_chance: EffectChance::None,
            priority: 0,
            target: MoveTarget::NearOther,
            flags: Vec::new(),
            mechanic_programs: Vec::new(),
        }
    }

    fn pack() -> BattleContentPackV3 {
        let unit_one = unit(1);
        let unit_three = unit(3);
        let mut pack = BattleContentPackV3 {
            schema_version: M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION,
            oracle_sha: OracleSha::parse("3bb6d49c924293ef79e3ab2f11e10cf4f5b9c6c7")
                .expect("fixture must be valid"),
            raw_catalog_hash: CatalogHash::parse("1".repeat(64)).expect("fixture must be valid"),
            semantic_catalog_hash: CatalogHash::parse("2".repeat(64))
                .expect("fixture must be valid"),
            content_hash: BattleContentPackHashV3::parse(format!(
                "{}{}",
                BattleContentPackHashV3::PREFIX,
                "0".repeat(64)
            ))
            .expect("fixture must be valid"),
            species: vec![
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(SpeciesDefinitionV3 {
                    id: SpeciesId::try_from_u64(20).expect("fixture must be valid"),
                    canonical_form: FormId::parse("species:20:base")
                        .expect("fixture must be valid"),
                    base_stats: SpeciesBaseStats {
                        hp: 45,
                        attack: 49,
                        defense: 49,
                        special_attack: 65,
                        special_defense: 65,
                        speed: 45,
                    },
                    typing: PokemonTyping {
                        primary: PokemonType::Grass,
                        secondary: Some(PokemonType::Poison),
                    },
                    weight: 69,
                    ability_slots: AbilitySlotDefinitionV1 {
                        active: AbilityId::try_from_u64(9).expect("fixture must be valid"),
                        passives: [None, None, None],
                    },
                    form_ids: vec![FormId::parse("species:20:base").expect("fixture must be valid")],
                    mechanic_programs: Vec::new(),
                }),
            ],
            forms: vec![FormDefinitionV1 {
                id: FormId::parse("species:20:base").expect("fixture must be valid"),
                species: SpeciesId::try_from_u64(20).expect("fixture must be valid"),
                stat_override: None,
                typing_override: None,
                weight_override: None,
                ability_override: None,
                mechanic_programs: Vec::new(),
                transformation_policy:
                    crate::m6_pack::FormTransformationPolicyV1::Static,
            }],
            moves: vec![
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(move_fixture(7)),
            ],
            abilities: vec![
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(AbilityDefinitionV3 {
                    id: AbilityId::try_from_u64(9).expect("fixture must be valid"),
                    mechanic_programs: Vec::new(),
                }),
            ],
            held_items: vec![HeldItemDefinitionV3 {
                registry_key: "alpha-item".to_owned(),
                mechanic_programs: Vec::new(),
            }],
            field_content: FieldContentV1 {
                statuses: vec![
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    Some(StatusDefinitionV2 {
                        id: safe(11),
                        mechanic_programs: Vec::new(),
                    }),
                ],
                weather: vec![
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    Some(WeatherDefinitionV2 {
                        id: safe(13),
                        mechanic_programs: Vec::new(),
                    }),
                ],
                terrain: vec![
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    Some(TerrainDefinitionV2 {
                        id: safe(15),
                        mechanic_programs: Vec::new(),
                    }),
                ],
                side_conditions: vec![TagDefinitionV2 {
                    registry_key: "beta-side".to_owned(),
                    mechanic_programs: Vec::new(),
                }],
                battler_tags: vec![TagDefinitionV2 {
                    registry_key: "zeta-tag".to_owned(),
                    mechanic_programs: Vec::new(),
                }],
                arena_tags: Vec::new(),
                positional_tags: Vec::new(),
            },
            programs: vec![
                None,
                // Program 1: one trigger binding.
                Some(program(1, unit_one, vec![binding(MechanicHookV2::BeforeMove, unit(1), 0)])),
                None,
                // Program 3: accuracy query stage sorts before BeforeMove.
                Some(program(
                    3,
                    unit_three,
                    vec![
                        binding(MechanicHookV2::AccuracyQuery, unit(3), 0),
                        binding(MechanicHookV2::BeforeMove, unit(3), 1),
                    ],
                )),
            ],
            classifications: BehaviorClassificationManifestV2(vec![
                BehaviorClassificationEntryV2 {
                    behavior_unit: unit_one,
                    kind: BehaviorClassificationKindV2::Compiled,
                    programs: vec![MechanicsProgramId::try_from_u64(1)
                        .expect("fixture must be valid")],
                    bespoke: None,
                    unsupported_reason: None,
                },
                BehaviorClassificationEntryV2 {
                    behavior_unit: unit_three,
                    kind: BehaviorClassificationKindV2::Compiled,
                    programs: vec![MechanicsProgramId::try_from_u64(3)
                        .expect("fixture must be valid")],
                    bespoke: None,
                    unsupported_reason: None,
                },
            ]),
            bespoke: BespokeManifestV2::default(),
            rng_sites: Vec::new(),
            type_chart: selected_type_chart(),
        };
        pack.content_hash = pack.compute_content_hash().expect("fixture must be valid");
        pack
    }

    #[test]
    fn prepare_preserves_pack_identity() {
        let fixture = pack();
        let expected_hash = fixture.content_hash.clone();
        let prepared = prepare_content(fixture).expect("fixture must be valid");
        assert_eq!(prepared.schema_version(), M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION);
        assert_eq!(prepared.content_hash(), &expected_hash);
        assert_eq!(prepared.pack(), &pack());
    }

    #[test]
    fn invalid_pack_fails_before_indexes_escape() {
        let mut fixture = pack();
        fixture.content_hash = BattleContentPackHashV3::parse(format!(
            "{}{}",
            BattleContentPackHashV3::PREFIX,
            "f".repeat(64)
        ))
        .expect("fixture must be valid");
        assert!(matches!(
            prepare_content(fixture),
            Err(ContentError::Pack(M6PackLoadError::ContentHashMismatch { .. }))
        ));
    }

    #[test]
    fn hook_and_query_sources_preserve_program_and_binding_order() {
        let prepared = prepare_content(pack()).expect("fixture must be valid");

        assert_eq!(
            prepared.hook_sources(MechanicHookV2::BeforeMove),
            &[
                HookBindingRef { program: MechanicsProgramId::try_from_u64(1).expect("valid"), program_slot: 1, binding: 0 },
                HookBindingRef { program: MechanicsProgramId::try_from_u64(3).expect("valid"), program_slot: 3, binding: 1 },
            ]
        );
        assert_eq!(
            prepared.query_sources(MechanicQueryV2::Accuracy),
            &[HookBindingRef {
                program: MechanicsProgramId::try_from_u64(3).expect("valid"),
                program_slot: 3,
                binding: 0,
            }]
        );
        assert!(prepared.query_sources(MechanicQueryV2::CriticalRate).is_empty());

        let (program, binding) = prepared
            .resolve_binding(prepared.hook_sources(MechanicHookV2::BeforeMove)[1])
            .expect("reference must resolve");
        assert_eq!(program.id.get().get(), 3);
        assert_eq!(binding.hook, MechanicHookV2::BeforeMove);

        // Every binding ref in every table resolves back to its own program.
        for sources in prepared.hooks.iter().chain(prepared.queries.iter()) {
            for reference in sources.iter() {
                let (program, _) = prepared
                    .resolve_binding(*reference)
                    .expect("every staged reference must resolve");
                assert_eq!(program.id, reference.program);
            }
        }
    }

    #[test]
    fn numeric_lookups_resolve_directly_and_fail_typed() {
        let prepared = prepare_content(pack()).expect("fixture must be valid");

        assert_eq!(prepared.species(SpeciesId::try_from_u64(20).expect("valid")).expect("present").id.get().get(), 20);
        assert_eq!(prepared.move_definition(MoveId::try_from_u64(7).expect("valid")).expect("present").base_pp, 40);
        assert_eq!(prepared.status(safe(11)).expect("present").id.get(), 11);
        assert_eq!(prepared.weather(safe(13)).expect("present").id.get(), 13);
        assert_eq!(prepared.terrain(safe(15)).expect("present").id.get(), 15);

        assert!(matches!(
            prepared.species(SpeciesId::try_from_u64(21).expect("valid")),
            Err(ContentError::UnknownNumericId { kind: "species", id: 21 })
        ));
        assert!(matches!(
            prepared.move_definition(MoveId::try_from_u64(6).expect("valid")),
            Err(ContentError::UnknownNumericId { kind: "moves", .. })
        ));
    }

    #[test]
    fn registry_lookups_binary_search_sorted_slices() {
        let prepared = prepare_content(pack()).expect("fixture must be valid");

        assert_eq!(
            prepared.held_item("alpha-item").expect("present").registry_key,
            "alpha-item"
        );
        assert_eq!(
            prepared.side_condition("beta-side").expect("present").registry_key,
            "beta-side"
        );
        assert_eq!(
            prepared.battler_tag("zeta-tag").expect("present").registry_key,
            "zeta-tag"
        );
        let form = prepared
            .form(&FormId::parse("species:20:base").expect("fixture must be valid"))
            .expect("present");
        assert_eq!(form.species.get().get(), 20);

        assert!(matches!(
            prepared.held_item("absent-item"),
            Err(ContentError::UnknownRegistryKey { kind: "held_items", .. })
        ));
        assert!(matches!(
            prepared.battler_tag("absent-tag"),
            Err(ContentError::UnknownRegistryKey { kind: "battler_tags", .. })
        ));
        assert!(matches!(
            prepared.form(&FormId::parse("species:20:other").expect("fixture must be valid")),
            Err(ContentError::UnknownRegistryKey { kind: "forms", .. })
        ));
    }

    #[test]
    fn program_lookup_indexes_directly_by_id() {
        let prepared = prepare_content(pack()).expect("fixture must be valid");

        let one = MechanicsProgramId::try_from_u64(1).expect("valid");
        let three = MechanicsProgramId::try_from_u64(3).expect("valid");
        assert_eq!(prepared.program(one).expect("present").id, one);
        assert_eq!(prepared.program(three).expect("present").bindings.len(), 2);
        // Slot 2 is intentionally empty.
        assert!(matches!(
            prepared.program(MechanicsProgramId::try_from_u64(2).expect("valid")),
            Err(ContentError::UnknownProgram { .. })
        ));
    }

    #[test]
    fn source_programs_resolve_through_the_same_indexes() {
        let prepared = prepare_content(pack()).expect("fixture must be valid");

        let move_source = BehaviorSourceId::Move { numeric_id: safe(7) };
        assert!(prepared.source_programs(&move_source).expect("present").is_empty());

        let program_source = BehaviorSourceId::Species { numeric_id: safe(20) };
        assert!(prepared.source_programs(&program_source).expect("present").is_empty());

        let unknown = BehaviorSourceId::HeldItem {
            registry_key: "absent-item".to_owned(),
        };
        assert!(matches!(
            prepared.source_programs(&unknown),
            Err(ContentError::UnknownRegistryKey { kind: "held_items", .. })
        ));

        let bespoke = BehaviorSourceId::Bespoke {
            registry_key: "custom-dispatch".to_owned(),
        };
        assert!(matches!(
            prepared.source_programs(&bespoke),
            Err(ContentError::BespokeSourceHasNoPrograms { .. })
        ));
    }
}
