//! M3A-02 closed leaf enums and serializable battle value DTOs.

use serde::{Deserialize, Deserializer, Serialize};

use crate::OperationId;
pub use crate::battle_ids::ContentPackHash;
use crate::battle_ids::{
    AbilityId, ArenaConditionId, AuthorityEpoch, BattleSide, FaintOccurrenceId, FieldSlot, MoveId,
    PartyIndex, PokemonId, TurnIndex, WaveIndex,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum CapabilityStatus {
    Supported,
    Unsupported { reason_code: UnsupportedReasonCode },
}

impl<'de> Deserialize<'de> for CapabilityStatus {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
        enum CapabilityStatusWire {
            Supported {},
            Unsupported { reason_code: UnsupportedReasonCode },
        }

        match CapabilityStatusWire::deserialize(deserializer)? {
            CapabilityStatusWire::Supported {} => Ok(Self::Supported),
            CapabilityStatusWire::Unsupported { reason_code } => {
                Ok(Self::Unsupported { reason_code })
            }
        }
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CapabilitySubject {
    Move(crate::battle_ids::MoveId),
    Ability(crate::battle_ids::AbilityId),
    Status(StatusKind),
    Weather(WeatherKind),
    Terrain(TerrainKind),
    ArenaCondition(ArenaConditionId),
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UnsupportedReasonCode {
    OutsideSelectedContent,
    EffectVocabularyUnsupported,
    CallbackOrScriptRequired,
    DynamicSuppressionUnsupported,
    FieldConditionMechanicsUnsupported,
    StatusMechanicsUnsupported,
    TargetingUnsupported,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MovePower {
    None,
    Value(u16),
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MoveAccuracy {
    AlwaysHits,
    Percent(u8),
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EffectChance {
    None,
    Percent(u8),
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WeatherKind {
    None,
    UnsupportedOracleCode(u16),
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TerrainKind {
    None,
    UnsupportedOracleCode(u16),
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AbilitySuppressionSource {
    ArenaIgnoreAbilities,
    FieldAbility(AbilityId),
    TimedSource(PokemonId),
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PokemonType {
    Normal,
    Fire,
    Water,
    Electric,
    Grass,
    Ice,
    Fighting,
    Poison,
    Ground,
    Flying,
    Psychic,
    Bug,
    Rock,
    Ghost,
    Dragon,
    Dark,
    Steel,
    Fairy,
    Stellar,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MoveCategory {
    Physical,
    Special,
    Status,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MoveTarget {
    NearOther,
    AllNearEnemies,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MoveFlag {
    Contact,
    ThawsUserFreeze,
    Powder,
    Biting,
    Reflectable,
    IgnoreSubstitute,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MoveEffectDefinition {
    Damage,
    ApplyStatus(StatusKind),
    ChangeStatStage { stat: BattleStat, delta: i8 },
    Flinch,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AbilityEffectDefinition {
    None,
    PostSummonAdjacentOpponentAttackMinusOne,
    NonSuperEffectiveAttackImmunity,
    MentalEffectImmunity,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SingleTypeMultiplier {
    Zero,
    Half,
    One,
    Two,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StatusKind {
    None,
    Poison,
    Toxic,
    Paralysis,
    Sleep,
    Burn,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BattleStat {
    Attack,
    Defense,
    SpecialAttack,
    SpecialDefense,
    Speed,
    Accuracy,
    Evasion,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PokemonTyping {
    pub primary: PokemonType,
    pub secondary: Option<PokemonType>,
}

/// Explicit battle typing: either a concrete one/two-type pairing, or the
/// production typeless presentation.
///
/// Production (`src/field/pokemon.ts::getTypes`) exports a missing secondary
/// type as `PokemonType.UNKNOWN`, and fully typeless identities (the frozen
/// oracle's form `493:18:unknown`) carry `UNKNOWN` as their primary. The
/// closed [`PokemonType`] enum deliberately has no such variant, so the
/// typeless presentation is its own variant here: it can never enter
/// ordinary type-chart lookup disguised as an entry (production itself
/// short-circuits `UNKNOWN` to a neutral multiplier before consulting the
/// chart, `src/data/type.ts::getTypeChartMultiplier`). Effectiveness against
/// a typeless battler is neutral by construction, never an `UNKNOWN`
/// effectiveness row.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BattleTyping {
    Typed(PokemonTyping),
    Typeless,
}

impl BattleTyping {
    /// The concrete pairing, or `None` for the typeless presentation.
    /// Type-effectiveness consumers must go through here so typeless
    /// identities stay outside the chart.
    pub fn typed(self) -> Option<PokemonTyping> {
        match self {
            BattleTyping::Typed(typing) => Some(typing),
            BattleTyping::Typeless => None,
        }
    }

    /// Whether this identity presents as typeless.
    pub fn is_typeless(self) -> bool {
        matches!(self, BattleTyping::Typeless)
    }
}

impl From<PokemonTyping> for BattleTyping {
    fn from(typing: PokemonTyping) -> Self {
        BattleTyping::Typed(typing)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleStats {
    pub hp: u32,
    pub attack: u32,
    pub defense: u32,
    pub special_attack: u32,
    pub special_defense: u32,
    pub speed: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoveSlotState {
    pub move_id: MoveId,
    pub pp_used: u16,
    pub pp_ups: u8,
    pub max_pp_override: Option<u16>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AbilityLoadout {
    pub active: AbilityId,
    pub passives: [Option<AbilityId>; 3],
    pub active_suppressed: bool,
    pub passive_suppressed: [bool; 3],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatusState {
    pub kind: StatusKind,
    pub toxic_turn_count: u16,
    pub sleep_turns_remaining: Option<u16>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatStages {
    pub attack: i8,
    pub defense: i8,
    pub special_attack: i8,
    pub special_defense: i8,
    pub speed: i8,
    pub accuracy: i8,
    pub evasion: i8,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WeatherState {
    pub kind: WeatherKind,
    pub remaining_turns: u16,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TerrainState {
    pub kind: TerrainKind,
    pub remaining_turns: u16,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ArenaConditionScope {
    Both,
    Side(BattleSide),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArenaConditionState {
    pub condition: ArenaConditionId,
    pub scope: ArenaConditionScope,
    pub turn_count: u16,
    pub layers: u8,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GlobalAbilitySuppressionState {
    pub ignore_abilities: bool,
    pub source: Option<AbilitySuppressionSource>,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BattleOutcome {
    Ongoing,
    Victory,
    Defeat,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReplacementProgress {
    NotRequired,
    Pending,
    Selected {
        party_slot: PartyIndex,
        pokemon: PokemonId,
    },
    NoLegalReplacement,
    Applied,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FaintSource {
    pub epoch: AuthorityEpoch,
    pub wave: WaveIndex,
    pub resolved_turn: TurnIndex,
    pub turn_occurrence: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FaintOccurrence {
    pub id: FaintOccurrenceId,
    pub source: FaintSource,
    pub slot: FieldSlot,
    pub pokemon: PokemonId,
    pub owner_seat: Option<crate::SeatId>,
    pub replacement: ReplacementProgress,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResolvedActionKind {
    Switch,
    Move,
    ResidualStatus,
    Faint,
    Replacement,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ActionDisposition {
    Executed,
    SkippedActorInactive,
    SkippedTargetInactive,
    CancelledByParalysis,
    CancelledByFlinch,
    Missed,
    NoEffect,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResolvedAction {
    pub sequence: crate::SafeU53,
    pub kind: ResolvedActionKind,
    pub actor: PokemonId,
    pub source_slot: FieldSlot,
    pub command_operation_id: Option<OperationId>,
    pub effective_speed: u32,
    pub timing_modifier: i8,
    pub move_priority: i8,
    pub bracket_modifier: i8,
    pub tie_order: crate::SafeU53,
    pub disposition: ActionDisposition,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaf_enums_use_closed_screaming_snake_case_wire_values() {
        let encoded = serde_json::to_string(&PokemonType::Electric);
        assert_eq!(encoded.ok(), Some("\"ELECTRIC\"".to_owned()));
        assert!(serde_json::from_str::<PokemonType>("\"ELECTRICITY\"").is_err());

        let encoded = serde_json::to_string(&MoveEffectDefinition::ApplyStatus(StatusKind::Burn));
        assert_eq!(
            encoded.ok(),
            Some(r#"{"kind":"APPLY_STATUS","value":"BURN"}"#.to_owned())
        );
        assert!(
            serde_json::from_str::<MoveEffectDefinition>(r#"{"kind":"NOT_A_REAL_EFFECT"}"#,)
                .is_err()
        );

        let encoded = serde_json::to_string(&CapabilityStatus::Supported);
        assert_eq!(encoded.ok(), Some(r#"{"kind":"SUPPORTED"}"#.to_owned()));
        let encoded = serde_json::to_string(&CapabilityStatus::Unsupported {
            reason_code: UnsupportedReasonCode::TargetingUnsupported,
        });
        assert_eq!(
            encoded.ok(),
            Some(r#"{"kind":"UNSUPPORTED","reason_code":"TARGETING_UNSUPPORTED"}"#.to_owned())
        );
        assert!(
            serde_json::from_str::<CapabilityStatus>(r#"{"kind":"SUPPORTED","extra":true}"#,)
                .is_err()
        );
        assert!(
            serde_json::from_str::<CapabilityStatus>(
                r#"{"kind":"UNSUPPORTED","reason_code":"TARGETING_UNSUPPORTED","extra":true}"#,
            )
            .is_err()
        );
    }

    #[test]
    fn leaf_value_dtos_round_trip_and_reject_unknown_fields() {
        let typing = PokemonTyping {
            primary: PokemonType::Grass,
            secondary: Some(PokemonType::Poison),
        };
        let encoded = serde_json::to_string(&typing);
        assert!(encoded.is_ok());
        if let Ok(encoded) = encoded {
            let decoded = serde_json::from_str::<PokemonTyping>(&encoded);
            assert_eq!(decoded.ok(), Some(typing));
        }
        assert!(
            serde_json::from_str::<PokemonTyping>(
                r#"{"primary":"GRASS","secondary":null,"extra":true}"#,
            )
            .is_err()
        );

        let stats = BattleStats {
            hp: 100,
            attack: 50,
            defense: 40,
            special_attack: 60,
            special_defense: 45,
            speed: 70,
        };
        let encoded = serde_json::to_string(&stats);
        assert!(encoded.is_ok());
        if let Ok(encoded) = encoded {
            assert_eq!(
                serde_json::from_str::<BattleStats>(&encoded).ok(),
                Some(stats)
            );
        }
    }

    #[test]
    fn frozen_state_enums_preserve_unsupported_representable_values() {
        let weather = WeatherKind::UnsupportedOracleCode(7);
        let encoded = serde_json::to_string(&weather);
        assert_eq!(
            encoded.ok(),
            Some(r#"{"kind":"UNSUPPORTED_ORACLE_CODE","value":7}"#.to_owned())
        );
        assert_eq!(
            serde_json::from_str::<WeatherKind>(r#"{"kind":"UNSUPPORTED_ORACLE_CODE","value":7}"#,)
                .ok(),
            Some(weather)
        );

        let status = StatusState {
            kind: StatusKind::Toxic,
            toxic_turn_count: 2,
            sleep_turns_remaining: None,
        };
        let encoded = serde_json::to_string(&status);
        assert!(encoded.is_ok());
        if let Ok(encoded) = encoded {
            assert_eq!(
                serde_json::from_str::<StatusState>(&encoded).ok(),
                Some(status)
            );
        }
    }
}
