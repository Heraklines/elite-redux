import unittest

from train_legacy_human_tree import LegacyFeatureEncoder, materialize_record, validate_record
from train_legacy_turn_outcomes import FEATURE_NAMES, turn_features, validate_imported_record


def dictionary() -> dict:
    names = [
        "wave_ratio",
        "turn_ratio",
        *(f"format_{index}" for index in range(3)),
        *(f"weather_{index}" for index in range(14)),
        *(f"terrain_{index}" for index in range(6)),
        "opponent_active_alive_ratio",
        "opponent_mean_hp_ratio",
        "actor_hp_ratio",
        "actor_statused",
        "actor_level_ratio",
        "actor_held_item_count_ratio",
        "actor_innate_count_ratio",
        "actor_active_ability_count_ratio",
        *(f"actor_stage_{index}" for index in range(7)),
        *(f"actor_type_{index}" for index in range(19)),
        *(f"actor_species_hash_{index}" for index in range(256)),
        *(f"actor_ability_hash_{index}" for index in range(256)),
        *(f"actor_item_hash_{index}" for index in range(128)),
        "action_move",
        "move_power_ratio",
        "move_accuracy_ratio",
        "move_priority_ratio",
        "move_pp_remaining_ratio",
        *(f"move_category_{index}" for index in range(3)),
        *(f"move_type_{index}" for index in range(19)),
        *(f"move_id_hash_{index}" for index in range(256)),
        "move_current_stab",
    ]
    return {
        "features": {"schemaVersion": 2, "names": names},
        "moves": {
            "10": {"id": 10, "types": [1], "power": 80, "accuracy": 100, "priority": 0, "split": 0},
            "11": {"id": 11, "types": [2], "power": 90, "accuracy": 90, "priority": 0, "split": 1},
        },
        "speciesForms": {"1:0": {"types": [1]}},
    }


def record(action: dict | None = None) -> dict:
    mon = {
        "species": 1,
        "form": 0,
        "level": 50,
        "hp": 100,
        "maxHp": 100,
        "status": None,
        "statStages": [0] * 7,
        "ability": 2,
        "innates": [3, None],
        "heldItems": ["LEFTOVERS"],
        "moves": [
            {"move": 10, "type": 1, "power": 80, "ppUsed": 0, "maxPp": 10},
            {"move": 11, "type": 2, "power": 90, "ppUsed": 0, "maxPp": 10},
        ],
        "active": True,
        "fainted": False,
    }
    return {
        "sourceEnvironment": "production",
        "sourcePartitionId": "account-a",
        "splitGroupId": "account-a",
        "sourceSplit": "train",
        "terminalOutcomeKnown": False,
        "terminalOutcome": "unknown",
        "policySource": "human-v1",
        "policyTarget": True,
        "decisionId": "decision-a",
        "event": {
            "kind": "battle_decision",
            "wave": 2,
            "slotFieldIndex": 0,
            "state": {
                "wave": 2,
                "turn": 1,
                "weather": None,
                "terrain": None,
                "player": [mon],
                "enemy": [{**mon, "species": 2, "moves": []}],
            },
            "action": action or {"kind": "move", "moveIndex": 1, "moveId": 11, "target": 1},
        },
    }


class LegacyHumanBaselineTest(unittest.TestCase):
    def test_move_decision_materializes_without_terminal_inference(self) -> None:
        source = record()
        validate_record(source, "production")
        decision, exclusion = materialize_record(source, LegacyFeatureEncoder(dictionary()))
        self.assertIsNone(exclusion)
        self.assertIsNotNone(decision)
        self.assertEqual(decision.chosen_index, 1)
        self.assertEqual(len(decision.candidate_features), 2)

    def test_non_move_actions_are_not_fabricated_as_candidates(self) -> None:
        decision, exclusion = materialize_record(
            record({"kind": "switch", "partyIndex": 2}), LegacyFeatureEncoder(dictionary())
        )
        self.assertIsNone(decision)
        self.assertEqual(exclusion, "switch")

    def test_terminal_claims_and_partition_mismatch_fail_closed(self) -> None:
        invalid = record()
        invalid["terminalOutcomeKnown"] = True
        invalid["terminalOutcome"] = "victory"
        with self.assertRaisesRegex(ValueError, "terminal-outcome-unknown"):
            validate_record(invalid, "production")
        invalid = record()
        invalid["splitGroupId"] = "session-a"
        with self.assertRaisesRegex(ValueError, "playerIdHash"):
            validate_record(invalid, "production")

    def test_turn_features_are_immediate_only(self) -> None:
        source = record()
        validate_imported_record(source, "production")
        event = source["event"]
        action = {**event["action"], "actorSlot": 0}
        features = turn_features(event["state"], [action], "hell")
        self.assertEqual(len(features), len(FEATURE_NAMES))
        self.assertGreater(features.sum(), 0)


if __name__ == "__main__":
    unittest.main()
