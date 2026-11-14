#!/usr/bin/env python3
"""GLB 안의 텍스처를 줄인다(기본색은 최대 max_px, 나머지 맵은 그 절반). 메쉬·뼈·애니메이션은 그대로 둔다.
사용: python3 scripts/shrink-glb.py 입력.glb 출력.glb [max_px=2048] [jpeg_quality=86]
"""
import sys as _sys  # Windows 콘솔·파이프에서도 한글 출력이 깨지거나 멈추지 않게
for _st in (_sys.stdout, _sys.stderr):
    if hasattr(_st, 'reconfigure'): _st.reconfigure(encoding='utf-8', errors='replace')
import io, json, struct, sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
max_px = int(sys.argv[3]) if len(sys.argv) > 3 else 2048
quality = int(sys.argv[4]) if len(sys.argv) > 4 else 86

data = open(src, 'rb').read()
magic, version, length = struct.unpack('<III', data[:12])
assert magic == 0x46546C67, 'GLB가 아님'
off = 12
chunks = []
while off < len(data):
    clen, ctype = struct.unpack('<II', data[off:off + 8])
    chunks.append((ctype, data[off + 8: off + 8 + clen]))
    off += 8 + clen
gltf = json.loads(chunks[0][1])
binc = chunks[1][1] if len(chunks) > 1 else b''

# 어떤 이미지가 기본색인지
base_imgs = set()
for m in gltf.get('materials', []):
    t = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
    if t is not None:
        base_imgs.add(gltf['textures'][t['index']]['source'])

views = gltf['bufferViews']
img_view = {i['bufferView']: n for n, i in enumerate(gltf.get('images', [])) if 'bufferView' in i}
new_bin = bytearray()
for vi, v in enumerate(views):
    start = v.get('byteOffset', 0)
    blob = binc[start: start + v['byteLength']]
    if vi in img_view:
        n = img_view[vi]
        im = Image.open(io.BytesIO(blob))
        has_alpha = im.mode in ('RGBA', 'LA') and im.getextrema()[-1][0] < 255
        lim = max_px if n in base_imgs else max(512, max_px // 2)
        if max(im.size) > lim:
            k = lim / max(im.size)
            im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        out = io.BytesIO()
        if has_alpha:
            im.save(out, 'PNG', optimize=True); gltf['images'][n]['mimeType'] = 'image/png'
        else:
            im.convert('RGB').save(out, 'JPEG', quality=quality, optimize=True); gltf['images'][n]['mimeType'] = 'image/jpeg'
        blob = out.getvalue()
    while len(new_bin) % 4:
        new_bin.append(0)
    v['byteOffset'] = len(new_bin)
    v['byteLength'] = len(blob)
    new_bin += blob
while len(new_bin) % 4:
    new_bin.append(0)
gltf['buffers'][0]['byteLength'] = len(new_bin)
js = json.dumps(gltf, separators=(',', ':')).encode()
while len(js) % 4:
    js += b' '
total = 12 + 8 + len(js) + 8 + len(new_bin)
with open(dst, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, total))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(new_bin), 0x004E4942)); f.write(new_bin)
print(f'{src} {len(data)/1e6:.2f}MB → {dst} {total/1e6:.2f}MB')
