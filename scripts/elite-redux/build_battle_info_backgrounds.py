#!/usr/bin/env python3
# Assemble the in-battle "Info" screen backgrounds EXACTLY as the Elite Redux ROM
# renders them: shared 8x8 tileset (tiles.png) arranged by each page's tilemap
# (titlemap_*.bin) and recoloured by that page's 16-colour palette
# (palette_{red,yellow,blue,green}.pal). Outputs 240x160 RGBA PNGs to
# public/images/elite-redux/battle-info/.
#
# Page -> (tilemap, palette) from ui_battle_menu.c tabColors / tabColorsField.
#
# Run: python scripts/elite-redux/build_battle_info_backgrounds.py
import os, struct
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GFX = os.path.join(ROOT, 'vendor/elite-redux/source/graphics/ui_menus/battle_menu')
OUT = os.path.join(ROOT, 'public/images/elite-redux/battle-info')
os.makedirs(OUT, exist_ok=True)

SCREEN_W, SCREEN_H = 240, 160

def parse_pal(path):
    lines = open(path).read().splitlines()[3:]
    pal = []
    for l in lines:
        p = l.split()
        if len(p) == 3:
            pal.append((int(p[0]), int(p[1]), int(p[2])))
    return pal

# tiles.png is indexed (P mode): pixel value = 4bpp index 0-15.
tiles = Image.open(os.path.join(GFX, 'tiles.png')).convert('P')
tw, th = tiles.size
tpx = tiles.load()
tiles_per_row = tw // 8

pals = {c: parse_pal(os.path.join(GFX, f'palette_{c}.pal')) for c in ('red', 'yellow', 'blue', 'green')}

PAGES = [
    ('side-player', 'titlemap_singles_field.bin', 'red'),
    ('side-enemy',  'titlemap_singles_field.bin', 'yellow'),
    ('field',       'titlemap_singles_field.bin', 'green'),
    ('stats',       'titlemap_singles_battler_status.bin', 'blue'),
    ('abilities',   'titlemap_singles_battler_abilities.bin', 'red'),
    ('moves',       'titlemap_singles_battler_abilities.bin', 'green'),
    ('speed',       'titlemap_singles_field_speed.bin', 'blue'),
]

for name, tmfile, palname in PAGES:
    tm = open(os.path.join(GFX, tmfile), 'rb').read()
    pal = pals[palname]
    out = Image.new('RGBA', (SCREEN_W, SCREEN_H), (0, 0, 0, 0))
    opx = out.load()
    for ty in range(SCREEN_H // 8):
        for tx in range(SCREEN_W // 8):
            entry = struct.unpack('<H', tm[(ty * 32 + tx) * 2:(ty * 32 + tx) * 2 + 2])[0]
            tile = entry & 0x3FF
            hflip = (entry >> 10) & 1
            vflip = (entry >> 11) & 1
            sx0 = (tile % tiles_per_row) * 8
            sy0 = (tile // tiles_per_row) * 8
            for py in range(8):
                for px in range(8):
                    sx = sx0 + (7 - px if hflip else px)
                    sy = sy0 + (7 - py if vflip else py)
                    ci = tpx[sx, sy]
                    dx, dy = tx * 8 + px, ty * 8 + py
                    if ci == 0:
                        opx[dx, dy] = (0, 0, 0, 0)
                    else:
                        r, g, b = pal[ci] if ci < len(pal) else (0, 0, 0)
                        opx[dx, dy] = (r, g, b, 255)
    out.save(os.path.join(OUT, f'{name}.png'))
    print('wrote', name + '.png')

# Small overlay sprites (indexed -> RGBA via a chosen palette; index 0 transparent).
def convert_indexed(src, dst, palname):
    im = Image.open(src).convert('P')
    w, h = im.size
    px = im.load()
    pal = pals[palname]
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    opx = out.load()
    for y in range(h):
        for x in range(w):
            ci = px[x, y]
            if ci == 0:
                opx[x, y] = (0, 0, 0, 0)
            else:
                r, g, b = pal[ci] if ci < len(pal) else (0, 0, 0)
                opx[x, y] = (r, g, b, 255)
    out.save(dst)
    print('wrote', os.path.basename(dst))

convert_indexed(os.path.join(GFX, 'selector.png'), os.path.join(OUT, 'selector.png'), 'red')
convert_indexed(os.path.join(GFX, 'stat_up_arrow.png'), os.path.join(OUT, 'stat_up_arrow.png'), 'green')
convert_indexed(os.path.join(GFX, 'stat_down_arrow.png'), os.path.join(OUT, 'stat_down_arrow.png'), 'red')
convert_indexed(os.path.join(GFX, 'check.png'), os.path.join(OUT, 'check.png'), 'blue')
convert_indexed(os.path.join(GFX, 'fields/forest.png'), os.path.join(OUT, 'field-forest.png'), 'green')
print('done')
