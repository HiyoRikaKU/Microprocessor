"""Render the supplied JS grid scene into a README-compatible GIF. Requires Pillow."""
import argparse
import json
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--font', required=True, help='Path to a monospace TTF/TTC font with box/block characters')
args = parser.parse_args()
data = json.loads(subprocess.check_output(['node', str(HERE / 'render.mjs')]))
cols, rows = data['cols'], data['rows']
cw, ch = 12, 20
font = ImageFont.truetype(args.font, 18)
bg = '#0a0d18'
cache = {}
def glyph(char, key):
    pair = (char, key)
    if pair in cache:
        return cache[pair]
    color = data['palette'][key]
    tile = Image.new('RGB', (cw, ch), color if key == 'j' else bg)
    draw = ImageDraw.Draw(tile)
    if char == '█':
        draw.rectangle((0, 0, cw, ch), fill=color)
    elif char == '▀':
        draw.rectangle((0, 0, cw, ch // 2 - 1), fill=color)
    elif char == '▄':
        draw.rectangle((0, ch // 2, cw, ch), fill=color)
    elif char != ' ':
        draw.text((cw / 2, ch / 2), char, font=font, fill=color, anchor='mm')
    cache[pair] = tile
    return tile

# A shared palette prevents flicker between frames and keeps the GIF compact.
colors = []
for color in [bg] + list(data['palette'].values()):
    rgb = tuple(bytes.fromhex(color.lstrip('#')))
    if rgb not in colors:
        colors.append(rgb)
# Include antialiased font edges in the palette.
for key in data['palette']:
    glyph('M', key)
for tile in cache.values():
    for color in (tile.get_flattened_data() if hasattr(tile, "get_flattened_data") else tile.getdata()):
        if color not in colors and len(colors) < 256:
            colors.append(color)
pal = Image.new('P', (1, 1))
flat = [channel for color in colors for channel in color]
pal.putpalette(flat + [0] * (768 - len(flat)))
frames = []
for index, cells in enumerate(data['frames']):
    im = Image.new('RGB', (cols * cw, rows * ch), bg)
    for cell, (char, key) in enumerate(cells):
        if char != ' ' or key == 'j':
            im.paste(glyph(char, key), ((cell % cols) * cw, (cell // cols) * ch))
    frames.append(im.quantize(palette=pal, dither=Image.Dither.NONE))
output = HERE.parent / 'assets' / 'subtitle-captions.gif'
output.parent.mkdir(exist_ok=True)
frames[0].save(output, save_all=True, append_images=frames[1:], duration=data['durationMs'], loop=0, optimize=True, disposal=1)
with Image.open(output) as gif:
    assert gif.n_frames > 1
    total = sum(gif.seek(i) or gif.info.get('duration', 0) for i in range(gif.n_frames))
    assert total == 26400, total
    print(f'{output}: {gif.size}, {gif.n_frames} frames, {total} ms, {output.stat().st_size:,} bytes')
