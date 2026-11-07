"""Detecta los círculos blancos de las cartas y los guarda en el campo 'circles' ([x%, y%, diámetro%]):
- data/seeds.json: círculos de riego (mitad izquierda), de ABAJO a ARRIBA.
- data/farm-upgrades.json: círculos de los animales (franja superior), de IZQUIERDA a DERECHA."""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

def detect(path, area='left'):
    im = np.asarray(Image.open(path).convert('RGB')).astype(int)
    h, w, _ = im.shape
    white = (im[..., 0] > 235) & (im[..., 1] > 235) & (im[..., 2] > 235)
    if area == 'left':
        white[:, int(w * 0.5):] = False
    else:
        white[int(h * 0.3):, :] = False
    lab, n = ndimage.label(white)
    found = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        ys, xs = sl
        bw, bh = xs.stop - xs.start, ys.stop - ys.start
        if bw < w * 0.06 or not (0.8 < bw / bh < 1.25):
            continue
        # rellena huecos (números dentro del círculo) y mide lo "redondo" que es
        filled = ndimage.binary_fill_holes(lab[sl] == i)
        if filled.sum() / (bw * bh) < 0.65:
            continue
        found.append([(xs.start + bw / 2) / w * 100, (ys.start + bh / 2) / h * 100, bw / w * 100])
    if area == 'left':
        found.sort(key=lambda c: -c[1])  # de abajo a arriba
    else:
        found.sort(key=lambda c: c[0])  # de izquierda a derecha
    return [[round(v, 2) for v in c] for c in found]

data = json.load(open('data/seeds.json'))
bad = []
for card in data['cards']:
    c = detect(card['image'])
    expected = len(card['waterRewards']) + 1
    if len(c) != expected:
        bad.append((card['id'], len(c), expected))
    card['circles'] = c
if bad:
    print('Revisar:', bad)
    sys.exit(1)

farm = json.load(open('data/farm-upgrades.json'))
for card in farm['cards']:
    if card['type'] != 'animal':
        continue
    c = detect(card['image'], 'top')
    if len(c) != len(card['values']):
        bad.append((card['id'], len(c), len(card['values'])))
    card['circles'] = c
if bad:
    print('Revisar:', bad)
    sys.exit(1)

# Reescribe los JSON con una carta por línea
def write(path, d):
    lines = ',\n'.join('    ' + json.dumps(c, ensure_ascii=False) for c in d['cards'])
    with open(path, 'w') as f:
        f.write('{\n  "_doc": ' + json.dumps(d['_doc'], ensure_ascii=False) + ',\n  "cards": [\n' + lines + '\n  ]\n}\n')
write('data/seeds.json', data)
write('data/farm-upgrades.json', farm)
print('OK')
