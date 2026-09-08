"""Remote, read-only inspection of selected published mechanics payloads."""
import hashlib
import json
import os
from pathlib import Path

root = Path(__file__).resolve().parents[2]
path = root / 'rust/fixtures/m9/engineering/game-content-bundle-v2.json'
raw = path.read_bytes()
expected = '9afce9fd3bc6e05e2159f19e8578ff64fc342b8a5974bec5f15648b0799d74d2'
assert len(raw) == 16325821 and hashlib.sha256(raw).hexdigest() == expected
battle = json.loads(raw)['battle']
selected = [38, 71, 165, 577]
semantic_path = Path(os.environ['RUNNER_TEMP']) / 'm9e-semantic/semantic-catalog-v1.json'
semantic_raw = semantic_path.read_bytes()
assert 0 < len(semantic_raw) <= 32 << 20
assert len(json.loads(semantic_raw)['behavior_units']) == 9411
semantic = json.loads(semantic_raw)
assert semantic['oracle_sha'] == battle['oracle_sha']
rows = []
for index in selected:
    move = battle['moves'][index]
    assert move['id'] == index
    programs = []
    for program_id in move['mechanic_programs']:
        assert type(program_id) is int
        programs.append(battle['programs'][program_id])
    classifications = [entry for entry in battle['classifications']
                       if entry['behavior_unit']['source'] == {'kind': 'MOVE', 'numeric_id': index}]
    source_units = [unit for unit in semantic['behavior_units']
                    if unit['id']['source'] == {'kind': 'MOVE', 'numeric_id': index}]
    assert [unit['id'] for unit in source_units] == [entry['behavior_unit'] for entry in classifications]
    rows.append({'move': move, 'programs': programs, 'classifications': classifications,
                 'source_units': [unit for unit in semantic['behavior_units'] if unit['id']['source'].get('kind') == 'MOVE' and str(unit['id']['source'].get('numeric_id')) == str(index)]})
phase_path = root / 'oracle/src/phases/move-effect-phase.ts'
phase_raw = phase_path.read_bytes()
assert 0 < len(phase_raw) <= 262144
assert hashlib.sha1(b'blob ' + str(len(phase_raw)).encode() + b'\0' + phase_raw).hexdigest() == '0655bdba9c9fcc8b868d345843ccd3eda5299b21'
phase_lines = phase_raw.decode().splitlines()
phase_hits = [index for index, line in enumerate(phase_lines) if 'singleHitDamageDealt' in line or 'totalDamageDealt' in line]
assert len(phase_hits) <= 12
phase_context = [{'line': index + 1, 'source': '\n'.join(phase_lines[max(0, index - 5):index + 7])} for index in phase_hits]
result = {
    'status': 'observed', 'scope': 'published payload inspection only; no behavior qualification',
    'source_sha': os.environ['GITHUB_SHA'], 'run_id': os.environ['GITHUB_RUN_ID'],
    'run_attempt': os.environ['GITHUB_RUN_ATTEMPT'], 'bundle_sha256': expected,
    'oracle_sha': battle['oracle_sha'],
    'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'semantic_sample_ids': [unit['id'] for unit in semantic['behavior_units'][:2]],
    'semantic_sha256': hashlib.sha256(semantic_raw).hexdigest(),
    'selected_ids': selected, 'rows': rows,
    'phase_source': {'bytes': len(phase_raw), 'sha256': hashlib.sha256(phase_raw).hexdigest(), 'contexts': phase_context},
    'drain_existing': [{'id': unit['id'], 'resolution': unit['semantic']['resolution'],
        'classification': next(row for row in battle['classifications'] if row['behavior_unit'] == unit['id']),
        'programs': [battle['programs'][identifier] for identifier in battle['moves'][unit['id']['source']['numeric_id']]['mechanic_programs']
                     if any(operation['kind'] == 'DRAIN_FRACTION' for operation in battle['programs'][identifier]['operations'])]}
        for unit in semantic['behavior_units'] if unit['semantic']['effect'].get('attribute') == 'HitHealAttr'],
    'drain_operands': [{'id': unit['id'], 'operands': unit['semantic']['operands']} for unit in semantic['behavior_units'] if unit['semantic']['effect'].get('attribute') == 'HitHealAttr'],
    'pack_counts': {
        'moves': sum(row is not None for row in battle['moves']),
        'programs': sum(row is not None for row in battle['programs']),
        'nonempty_programs': sum(bool(row and row['operations']) for row in battle['programs']),
        'classifications': len(battle['classifications']),
        'bespoke': len(battle['bespoke']['entries']),
    },
}
encoded = (json.dumps(result, separators=(',', ':')) + '\n').encode()
assert 0 < len(encoded) <= 32768
output = Path(os.environ['RUNNER_TEMP']) / 'm9e-mechanics-inspection'
output.mkdir(exist_ok=False)
(output / 'summary.json').write_bytes(encoded)
print(json.dumps({'status': result['status'], 'moves': len(rows), 'bytes': len(encoded)}))
