#!/usr/bin/env python3
"""Convert Metamon UniversalState replay files into masked ER transfer rows."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Iterable

TRANSFER_SCHEMA_VERSION = 1
TOKEN_GROUP_NAMES = ("actor", "targets", "destination", "field", "action")
TYPE_IDS = {
    name: index
    for index, name in enumerate(
        ("normal", "fighting", "flying", "poison", "ground", "rock", "bug", "ghost", "steel", "fire",
         "water", "grass", "electric", "psychic", "ice", "dragon", "dark", "fairy", "stellar")
    )
}
CATEGORY_IDS = {"physical": 0, "special": 1, "status": 2}
SHOWDOWN_TRANSFER_FEATURE_NAMES = (
    "format_0",
    "self_alive_ratio",
    "self_bench_alive_ratio",
    "opponent_active_alive_ratio",
    "opponent_roster_ratio",
    "actor_hp_ratio",
    "actor_statused",
    "actor_level_ratio",
    "actor_tera_available_known",
    "actor_tera_available",
    *(f"actor_type_{index}" for index in range(len(TYPE_IDS))),
    "action_move",
    "action_switch",
    "move_power_ratio",
    "move_accuracy_ratio",
    "move_priority_ratio",
    "move_pp_remaining_ratio",
    *(f"move_category_{index}" for index in range(len(CATEGORY_IDS))),
    *(f"move_type_{index}" for index in range(len(TYPE_IDS))),
    "move_current_stab",
    "move_tera",
    "target_present",
    "target_hp_ratio",
    "target_statused",
    "target_level_delta_ratio",
    *(f"target_type_{index}" for index in range(len(TYPE_IDS))),
    "switch_hp_ratio",
    "switch_statused",
    "switch_level_delta_ratio",
)


def normalized_name(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def replay_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    return sorted(
        candidate
        for candidate in path.rglob("*")
        if candidate.is_file() and (candidate.suffix == ".json" or candidate.name.endswith(".json.lz4"))
    )


def load_replay(path: Path) -> dict[str, Any]:
    if path.name.endswith(".json.lz4"):
        try:
            import lz4.frame
        except ModuleNotFoundError as error:
            raise RuntimeError("reading .json.lz4 Metamon files requires `pip install lz4`") from error
        with lz4.frame.open(path, "rb") as handle:
            return json.loads(handle.read().decode("utf-8"))
    return json.loads(path.read_text(encoding="utf-8"))


def dictionary_name_map(entries: dict[str, Any], *, base_forms_only: bool = False) -> dict[str, str]:
    result: dict[str, str] = {}
    for identity, entry in entries.items():
        if base_forms_only and entry.get("formKey"):
            continue
        name = normalized_name(entry.get("name"))
        if name and name not in result:
            result[name] = str(identity)
    return result


def token(prefix: str, value: Any, identities: dict[str, str] | None = None) -> str:
    name = normalized_name(value)
    identity = identities.get(name) if identities is not None else None
    return f"{prefix}:{identity}" if identity is not None else f"showdown-{prefix}-name:{name or 'unknown'}"


def pokemon_tokens(pokemon: dict[str, Any], identities: dict[str, dict[str, str]]) -> list[str]:
    result = [
        token("species", pokemon.get("name"), identities["species"]),
        token("ability", pokemon.get("ability"), identities["abilities"]),
        token("item", pokemon.get("item"), identities["items"]),
        f"status-name:{normalized_name(pokemon.get('status')) or 'none'}",
        f"effect-name:{normalized_name(pokemon.get('effect')) or 'none'}",
    ]
    result.extend(f"type:{TYPE_IDS[name]}" for name in str(pokemon.get("types", "")).split() if name in TYPE_IDS)
    for move in pokemon.get("moves", []):
        result.append(token("move", move.get("name"), identities["moves"]))
    return sorted(set(result))


def sorted_moves(state: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(state["player_active_pokemon"].get("moves", [])[:4], key=lambda move: normalized_name(move.get("name")))


def sorted_switches(state: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(state.get("available_switches", [])[:5], key=lambda pokemon: normalized_name(pokemon.get("name")))


def legal_actions(state: dict[str, Any]) -> list[int]:
    actions: list[int] = []
    if not state.get("forced_switch"):
        actions.extend(range(len(sorted_moves(state))))
        if state.get("can_tera"):
            actions.extend(range(9, 9 + len(sorted_moves(state))))
    actions.extend(range(4, 4 + len(sorted_switches(state))))
    return actions


def set_feature(
    values: list[float],
    presence: list[bool],
    feature_indices: dict[str, int],
    name: str,
    value: float,
) -> None:
    index = feature_indices.get(name)
    if index is not None:
        values[index] = float(value)
        presence[index] = True


def action_candidate(
    state: dict[str, Any],
    action_index: int,
    feature_names: list[str],
    identities: dict[str, dict[str, str]],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, list[str]]]:
    feature_indices = {name: index for index, name in enumerate(feature_names)}
    values = [0.0] * len(feature_names)
    presence = [False] * len(feature_names)
    actor = state["player_active_pokemon"]
    opponent = state["opponent_active_pokemon"]
    actor_types = {name for name in str(actor.get("types", "")).split() if name in TYPE_IDS}

    set_feature(values, presence, feature_indices, "format_0", 1)
    set_feature(values, presence, feature_indices, "self_alive_ratio", (1 + len(sorted_switches(state))) / 6)
    set_feature(values, presence, feature_indices, "self_bench_alive_ratio", len(sorted_switches(state)) / 6)
    set_feature(values, presence, feature_indices, "opponent_active_alive_ratio", +(float(opponent.get("hp_pct", 0)) > 0))
    set_feature(values, presence, feature_indices, "opponent_roster_ratio", float(state.get("opponents_remaining", 0)) / 6)
    set_feature(values, presence, feature_indices, "actor_hp_ratio", float(actor.get("hp_pct", 0)))
    set_feature(values, presence, feature_indices, "actor_statused", normalized_name(actor.get("status")) not in {"", "nostatus"})
    set_feature(values, presence, feature_indices, "actor_level_ratio", float(actor.get("lvl", 0)) / 200)
    set_feature(values, presence, feature_indices, "actor_tera_available_known", 1)
    set_feature(values, presence, feature_indices, "actor_tera_available", +bool(state.get("can_tera")))
    set_feature(values, presence, feature_indices, "target_present", 1)
    set_feature(values, presence, feature_indices, "target_hp_ratio", float(opponent.get("hp_pct", 0)))
    set_feature(values, presence, feature_indices, "target_statused", normalized_name(opponent.get("status")) not in {"", "nostatus"})
    set_feature(
        values,
        presence,
        feature_indices,
        "target_level_delta_ratio",
        (float(opponent.get("lvl", 0)) - float(actor.get("lvl", 0))) / 200,
    )
    for type_name in actor_types:
        set_feature(values, presence, feature_indices, f"actor_type_{TYPE_IDS[type_name]}", 1)
    for type_name in str(opponent.get("types", "")).split():
        if type_name in TYPE_IDS:
            set_feature(values, presence, feature_indices, f"target_type_{TYPE_IDS[type_name]}", 1)

    groups = {
        "actor": ["domain:showdown", *pokemon_tokens(actor, identities)],
        "targets": pokemon_tokens(opponent, identities),
        "destination": [],
        "field": [
            "domain:showdown",
            f"showdown-format:{normalized_name(state.get('format'))}",
            f"weather-name:{normalized_name(state.get('weather')) or 'none'}",
            f"field-name:{normalized_name(state.get('battle_field')) or 'none'}",
            f"self-condition-name:{normalized_name(state.get('player_conditions')) or 'none'}",
            f"opponent-condition-name:{normalized_name(state.get('opponent_conditions')) or 'none'}",
        ],
        "action": [],
    }
    if 4 <= action_index <= 8:
        destination = sorted_switches(state)[action_index - 4]
        candidate = {"id": f"showdown:switch:{action_index - 4}", "kind": "switch"}
        groups["destination"] = pokemon_tokens(destination, identities)
        groups["action"] = ["action:switch"]
        set_feature(values, presence, feature_indices, "action_switch", 1)
        set_feature(values, presence, feature_indices, "switch_hp_ratio", float(destination.get("hp_pct", 0)))
        set_feature(
            values,
            presence,
            feature_indices,
            "switch_statused",
            normalized_name(destination.get("status")) not in {"", "nostatus"},
        )
        set_feature(
            values,
            presence,
            feature_indices,
            "switch_level_delta_ratio",
            (float(destination.get("lvl", 0)) - float(actor.get("lvl", 0))) / 200,
        )
    else:
        tera = action_index >= 9
        move_index = action_index - 9 if tera else action_index
        move = sorted_moves(state)[move_index]
        candidate = {"id": f"showdown:move:{move_index}:tera:{str(tera).lower()}", "kind": "move"}
        move_name = normalized_name(move.get("name"))
        move_type = normalized_name(move.get("move_type"))
        category = normalized_name(move.get("category"))
        groups["action"] = [
            "action:move",
            token("move", move_name, identities["moves"]),
            f"move-type-name:{move_type or 'unknown'}",
            f"move-category-name:{category or 'unknown'}",
            f"move-tera:{str(tera).lower()}",
        ]
        set_feature(values, presence, feature_indices, "action_move", 1)
        set_feature(values, presence, feature_indices, "move_power_ratio", float(move.get("base_power", 0)) / 250)
        set_feature(values, presence, feature_indices, "move_accuracy_ratio", float(move.get("accuracy", 0)))
        set_feature(values, presence, feature_indices, "move_priority_ratio", float(move.get("priority", 0)) / 7)
        max_pp = float(move.get("max_pp", 0))
        set_feature(
            values,
            presence,
            feature_indices,
            "move_pp_remaining_ratio",
            float(move.get("current_pp", 0)) / max_pp if max_pp > 0 else 0,
        )
        if category in CATEGORY_IDS:
            set_feature(values, presence, feature_indices, f"move_category_{CATEGORY_IDS[category]}", 1)
        if move_type in TYPE_IDS:
            set_feature(values, presence, feature_indices, f"move_type_{TYPE_IDS[move_type]}", 1)
        set_feature(values, presence, feature_indices, "move_current_stab", +(move_type in actor_types))
        set_feature(values, presence, feature_indices, "move_tera", +tera)
    return candidate, {"candidateId": candidate["id"], "values": values, "presence": presence}, groups


def replay_outcome(path: Path, states: list[dict[str, Any]]) -> float:
    if states and states[-1].get("battle_won"):
        return 1.0
    if states and states[-1].get("battle_lost"):
        return 0.0
    upper = path.name.upper()
    if "_WIN" in upper:
        return 1.0
    if "_LOSS" in upper:
        return 0.0
    raise ValueError(f"cannot determine replay outcome for {path}")


def player_partition(path: Path) -> str:
    match = re.search(r"_\d+_(.+?)_vs_", path.name, flags=re.IGNORECASE)
    identity = match.group(1) if match else path.stem
    return f"showdown-player:{hashlib.sha256(identity.encode()).hexdigest()[:16]}"


def convert_replay(
    path: Path,
    feature_names: list[str],
    identities: dict[str, dict[str, str]],
) -> Iterable[dict[str, Any]]:
    replay = load_replay(path)
    states = replay.get("states")
    actions = replay.get("actions")
    if not isinstance(states, list) or len(states) < 2 or not isinstance(actions, list):
        raise ValueError(f"invalid Metamon replay structure: {path}")
    terminal_value = replay_outcome(path, states)
    episode_hash = hashlib.sha256(str(path).encode()).hexdigest()[:20]
    episode_id = f"showdown:{episode_hash}"
    source_partition = player_partition(path)
    for step, (state, chosen_index) in enumerate(zip(states[:-1], actions[:-1])):
        if not isinstance(chosen_index, int) or chosen_index < 0:
            continue
        legal = legal_actions(state)
        if chosen_index not in legal:
            continue
        candidates: list[dict[str, Any]] = []
        feature_rows: list[dict[str, Any]] = []
        token_rows: list[dict[str, Any]] = []
        chosen_candidate_id = ""
        for action_index in legal:
            candidate, feature_row, groups = action_candidate(state, action_index, feature_names, identities)
            candidates.append(candidate)
            feature_rows.append(feature_row)
            token_rows.append({"candidateId": candidate["id"], "groups": groups})
            if action_index == chosen_index:
                chosen_candidate_id = candidate["id"]
        yield {
            "schemaVersion": TRANSFER_SCHEMA_VERSION,
            "kind": "candidate_transfer_decision",
            "domain": "showdown",
            "policySource": "metamon-showdown-replay-v1",
            "policyTarget": True,
            "episodeId": episode_id,
            "decisionId": f"{episode_id}:{step}",
            "splitGroupId": episode_id,
            "sourcePartitionId": source_partition,
            "featureNames": feature_names,
            "candidates": candidates,
            "candidateFeatures": feature_rows,
            "candidateTokenGroups": token_rows,
            "chosenCandidateId": chosen_candidate_id,
            "terminalValue": terminal_value,
        }


def convert(args: argparse.Namespace) -> dict[str, Any]:
    dictionary = json.loads(args.dictionary.read_text(encoding="utf-8"))
    features = dictionary.get("features")
    if not isinstance(features, dict) or features.get("schemaVersion") != 2 or not isinstance(features.get("names"), list):
        raise ValueError("dictionary does not contain the ER feature-name contract")
    er_feature_names = features["names"]
    feature_names = [name for name in SHOWDOWN_TRANSFER_FEATURE_NAMES if name in set(er_feature_names)]
    if not feature_names:
        raise ValueError("ER dictionary has no features shared with the Showdown transfer adapter")
    identities = {
        "species": dictionary_name_map(dictionary.get("speciesForms", {}), base_forms_only=True),
        "moves": dictionary_name_map(dictionary.get("moves", {})),
        "abilities": dictionary_name_map(dictionary.get("abilities", {})),
        "items": dictionary_name_map(dictionary.get("items", {})),
    }
    files = replay_files(args.input)
    if args.limit is not None:
        files = files[: args.limit]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    decisions = 0
    episodes = 0
    outcomes = {"wins": 0, "losses": 0}
    output_handle = (
        gzip.open(args.output, "wt", encoding="utf-8", compresslevel=6)
        if args.output.name.endswith(".gz") or args.output.name.endswith(".gzpack")
        else args.output.open("w", encoding="utf-8")
    )
    with output_handle as handle:
        for path in files:
            rows = list(convert_replay(path, feature_names, identities))
            if not rows:
                continue
            if args.decision_limit is not None:
                rows = rows[: max(0, args.decision_limit - decisions)]
                if not rows:
                    break
            episodes += 1
            outcomes["wins" if rows[0]["terminalValue"] == 1 else "losses"] += 1
            for row in rows:
                handle.write(json.dumps(row, separators=(",", ":"), ensure_ascii=True) + "\n")
                decisions += 1
            if args.decision_limit is not None and decisions >= args.decision_limit:
                break
    if decisions == 0:
        raise ValueError("conversion produced no decisions")
    manifest = {
        "schemaVersion": TRANSFER_SCHEMA_VERSION,
        "domain": "showdown",
        "source": "Metamon UniversalState parsed replays",
        "sourceLicense": "CC-BY-NC-4.0",
        "inputFiles": len(files),
        "episodes": episodes,
        "decisions": decisions,
        "outcomes": outcomes,
        "transferFeatureCount": len(feature_names),
        "erFeatureCount": len(er_feature_names),
        "featureNames": feature_names,
        "outputSha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
    }
    manifest_path = args.output.with_suffix(args.output.suffix + ".manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--dictionary", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--decision-limit", type=int)
    return parser.parse_args()


if __name__ == "__main__":
    print(json.dumps(convert(parse_args()), separators=(",", ":")))
