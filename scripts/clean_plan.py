#!/usr/bin/env python3
"""공개용 미니맵: 원본 평면도(남의 도면·워터마크) 대신 scene.json으로 다시 그린 평면도를 plan.png로 쓴다.
  python3 clean_plan.py <사이트 폴더>
좌표계(plan.ppm·origin·size)는 그대로라 미니맵 계산은 바뀌지 않는다.
"""
import sys as _sys  # Windows 콘솔·파이프에서도 한글 출력이 깨지거나 멈추지 않게
for _st in (_sys.stdout, _sys.stderr):
    if hasattr(_st, 'reconfigure'): _st.reconfigure(encoding='utf-8', errors='replace')
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

site = Path(sys.argv[1]).resolve()
S = json.loads((site / 'scene.json').read_text(encoding='utf-8'))
pp = S['plan']; k = pp['ppm']; ox, oy = pp['origin']
W, H = pp['size']
im = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(im)
px = lambda x, z: (ox + x * k, oy + z * k)
FILL = {'living': '#F6E7D6', 'kitchen': '#F6EDD8', 'bedroom': '#E7EEF6', 'bath': '#E3F1F1', 'entry': '#EEE9E2', 'balcony': '#EAF2E3', 'dress': '#F0E8F3', 'office': '#EDF0E4'}
for r in S['rooms']:
    for x0, z0, x1, z1 in r['rects']: d.rectangle([*px(x0, z0), *px(x1, z1)], fill=FILL.get(r['type'], '#F3F3F1'))
for w in S['walls']:
    t = w['t'] / 2
    if w['o'] == 'h': d.rectangle([*px(min(w['a'][0], w['b'][0]), w['a'][1] - t), *px(max(w['a'][0], w['b'][0]), w['a'][1] + t)], fill='#2B2926')
    else: d.rectangle([*px(w['a'][0] - t, min(w['a'][1], w['b'][1])), *px(w['a'][0] + t, max(w['a'][1], w['b'][1]))], fill='#2B2926')
for o in S['openings']:
    if o['type'] in ('window', 'slide'):
        (ax, az), (bx, bz) = o['a'], o['b']; d.line([px(ax, az), px(bx, bz)], fill='#7FB3D5', width=max(2, int(o['t'] * k * 0.5)))
sys.path.insert(0, str(Path(__file__).resolve().parent)); from plan import font  # Mac·Windows·Linux 한글 글꼴
f = font(max(12, int(0.32 * k)))
for r in S['rooms']:
    if r.get('auto'): continue
    cx, cz = px(*r['center']); d.text((cx, cz), r['name'], fill='#5A554E', font=f, anchor='mm')
im.save(site / 'plan.png', optimize=True)
print('미니맵 평면도를 장면 데이터로 다시 그림:', site / 'plan.png')
