import gzip
import json
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path

from convert_metamon_transfer import convert


class ConvertMetamonTransferTest(unittest.TestCase):
    def test_converts_legal_candidates_with_canonical_tokens_and_presence_masks(self) -> None:
        feature_names = [
            "format_0",
            "actor_hp_ratio",
            "actor_type_9",
            "action_move",
            "action_switch",
            "move_power_ratio",
            "move_type_9",
            "move_tera",
            "switch_hp_ratio",
            "move_damage_known",
        ]
        dictionary = {
            "features": {"schemaVersion": 2, "names": feature_names},
            "speciesForms": {
                "6:0": {"name": "Charizard", "formKey": ""},
                "9:0": {"name": "Blastoise", "formKey": ""},
                "25:0": {"name": "Pikachu", "formKey": ""},
            },
            "moves": {"53": {"name": "Flamethrower"}},
            "abilities": {"66": {"name": "Blaze"}},
            "items": {"LEFTOVERS": {"name": "Leftovers"}},
        }
        pokemon = {
            "name": "Charizard",
            "hp_pct": 0.75,
            "types": "fire flying",
            "item": "Leftovers",
            "ability": "Blaze",
            "lvl": 100,
            "status": "nostatus",
            "effect": "noeffect",
            "moves": [{
                "name": "Flamethrower",
                "move_type": "fire",
                "category": "special",
                "base_power": 90,
                "accuracy": 1.0,
                "priority": 0,
                "current_pp": 12,
                "max_pp": 15,
            }],
        }
        opponent = {**pokemon, "name": "Blastoise", "types": "water", "ability": "Torrent", "item": "noitem"}
        switch = {**pokemon, "name": "Pikachu", "types": "electric", "hp_pct": 0.5}
        state = {
            "format": "gen9ou",
            "player_active_pokemon": pokemon,
            "opponent_active_pokemon": opponent,
            "available_switches": [switch],
            "opponents_remaining": 6,
            "player_conditions": "noconditions",
            "opponent_conditions": "noconditions",
            "weather": "noweather",
            "battle_field": "nofield",
            "forced_switch": False,
            "battle_won": False,
            "battle_lost": False,
            "can_tera": True,
        }
        terminal = {**state, "battle_won": True}
        replay = {"states": [state, terminal], "actions": [0, -1]}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dictionary_path = root / "dictionary.json"
            replay_path = root / "gen9ou-1_1800_player_vs_opponent_01-01-2026_WIN.json"
            output_path = root / "transfer.jsonl.gz"
            dictionary_path.write_text(json.dumps(dictionary), encoding="utf-8")
            replay_path.write_text(json.dumps(replay), encoding="utf-8")
            manifest = convert(
                Namespace(input=replay_path, dictionary=dictionary_path, output=output_path, limit=None, decision_limit=None)
            )
            with gzip.open(output_path, "rt", encoding="utf-8") as handle:
                rows = [json.loads(line) for line in handle]
        self.assertEqual(manifest["decisions"], 1)
        self.assertEqual(rows[0]["policySource"], "metamon-showdown-replay-v1")
        self.assertIs(rows[0]["policyTarget"], True)
        self.assertEqual(len(rows[0]["candidates"]), 3)
        self.assertEqual(rows[0]["chosenCandidateId"], "showdown:move:0:tera:false")
        move_tokens = rows[0]["candidateTokenGroups"][0]["groups"]
        self.assertIn("species:6:0", move_tokens["actor"])
        self.assertIn("ability:66", move_tokens["actor"])
        self.assertIn("item:LEFTOVERS", move_tokens["actor"])
        self.assertIn("move:53", move_tokens["action"])
        move_features = rows[0]["candidateFeatures"][0]
        transfer_feature_names = rows[0]["featureNames"]
        self.assertLess(len(transfer_feature_names), len(feature_names))
        self.assertTrue(move_features["presence"][transfer_feature_names.index("move_power_ratio")])
        self.assertNotIn("move_damage_known", transfer_feature_names)
        self.assertEqual(manifest["transferFeatureCount"], len(transfer_feature_names))


if __name__ == "__main__":
    unittest.main()
