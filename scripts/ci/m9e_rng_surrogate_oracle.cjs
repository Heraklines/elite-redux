const fs = require('node:fs');
const PhaserRdg = require(process.env.M9E_PHASER_REFERENCE);
const shifted = (seed, offset) => {
  let value = '';
  for (let i = 0; i < seed.length; i++) value += String.fromCharCode(seed.charCodeAt(i) + offset);
  return value;
};
const bits = value => { const b = Buffer.alloc(8); b.writeDoubleBE(value); return b.toString('hex'); };
const state = rng => ({state_string: rng.state(), carry: rng.c, s0_bits: bits(rng.s0), s1_bits: bits(rng.s1), s2_bits: bits(rng.s2)});
const seeds = ['A', 'm9e-surrogate', '😀'];
const result = {schema_version: 1, commit: 'a9965625f49cf366584f454556b039e06e8adad6', shuffle: [], battle: [], initialize: []};
for (const seed of seeds) {
  for (const turn of [1, 55, 56, 57, 58, 121, 122, 123, 124, 231]) {
    const values = Array.from({length: 8}, (_, i) => i);
    const rng = new PhaserRdg([shifted(seed, turn * 1000 + values.length)]);
    for (let i = values.length - 1; i > 0; i--) {
      const j = rng.integerInRange(0, i);
      [values[i], values[j]] = [values[j], values[i]];
    }
    result.shuffle.push({seed, turn, values});
  }
  for (const turn of [1, 863, 864, 880, 895, 896, 1888]) {
    const rng = new PhaserRdg([shifted(seed, turn << 6)]);
    const values = Array.from({length: 8}, () => rng.integerInRange(0, 99));
    result.battle.push({seed, turn, values, state: state(rng)});
  }
  for (const wave of [1, 6879, 6880, 7000, 7167, 7168]) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const rng = new PhaserRdg([shifted(seed, wave << 3)]);
    let battle_seed = '';
    for (let i = 0; i < 16; i++) battle_seed += alphabet[rng.integerInRange(0, alphabet.length - 1)];
    result.initialize.push({seed, wave, battle_seed});
  }
}
fs.writeFileSync(process.env.M9E_RNG_ORACLE_PATH, JSON.stringify(result) + '\n');
