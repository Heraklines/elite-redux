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
semantic_path = root / 'rust/fixtures/m9/solo-entry/semantic/semantic-catalog-v1.json'
semantic_raw = semantic_path.read_bytes()
assert 0 < len(semantic_raw) <= 32 << 20
assert hashlib.sha1(b'blob ' + str(len(semantic_raw)).encode() + b'\0' + semantic_raw).hexdigest() == '40e1bb67265ea4f870962f20bca6ba7cf10add6d'
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
    rows.append({'move': move, 'programs': programs, 'classifications': classifications,
                 'source_units': [unit for unit in semantic['behavior_units'] if unit['id']['source'] == {'kind': 'MOVE', 'numeric_id': index}]})
result = {
    'status': 'observed', 'scope': 'published payload inspection only; no behavior qualification',
    'source_sha': os.environ['GITHUB_SHA'], 'run_id': os.environ['GITHUB_RUN_ID'],
    'run_attempt': os.environ['GITHUB_RUN_ATTEMPT'], 'bundle_sha256': expected,
    'oracle_sha': battle['oracle_sha'],
    'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'semantic_sha256': hashlib.sha256(semantic_raw).hexdigest(),
    'selected_ids': selected, 'rows': rows,
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
