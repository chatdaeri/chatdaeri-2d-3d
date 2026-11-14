#!/usr/bin/env python3
"""평면도 이미지 → 3D 투어 장면(scene.json).

  1단계  python3 plan.py walls <평면도 이미지> --out <작업폴더> [--dark 100] [--thick 0]
         벽 자동 검출 → walls.json, 읽기용 격자 그림 walls.png, plan.json 뼈대
  2단계  python3 plan.py build <작업폴더>/plan.json
         축척·벽 고침·문/창 종류·방 이름·가구 → scene.json + check.png(검사 그림) + 방 면적 대조표

좌표는 모두 평면도 이미지 픽셀(x 오른쪽, y 아래). 결과 scene.json은 미터(x 오른쪽, z 아래, 원점 = 건물 왼쪽 위).
가구 rot = 앞면이 향하는 방향(도): 0 아래 · 90 오른쪽 · 180 위 · 270 왼쪽.
필요: numpy, scipy, Pillow (python3 -m pip install numpy scipy pillow)
"""
import sys as _sys  # Windows 콘솔·파이프에서도 한글 출력이 깨지거나 멈추지 않게
for _st in (_sys.stdout, _sys.stderr):
    if hasattr(_st, 'reconfigure'): _st.reconfigure(encoding='utf-8', errors='replace')
import argparse, json, math, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

FONT_PATHS = ['/System/Library/Fonts/AppleSDGothicNeo.ttc', '/System/Library/Fonts/Supplemental/AppleGothic.ttf',
              'C:/Windows/Fonts/malgun.ttf', 'C:/Windows/Fonts/gulim.ttc',  # Windows
              '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
              '/usr/share/fonts/truetype/nanum/NanumGothic.ttf', '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc']  # Linux


def font(size):
    for p in FONT_PATHS:
        try: return ImageFont.truetype(p, size)
        except Exception: pass
    return ImageFont.load_default()


# ---------------- 가구 기본 크기(m) [폭, 깊이, 높이] ----------------
FURN = {
    'sofa': [2.1, 0.9, 0.8], 'armchair': [0.85, 0.85, 0.8], 'tv': [1.8, 0.45, 1.25],
    'bed': [1.6, 2.1, 1.0], 'bed-single': [1.1, 2.0, 0.9], 'nightstand': [0.45, 0.4, 0.5],
    'wardrobe': [1.8, 0.6, 2.2], 'dresser': [1.2, 0.45, 0.8], 'desk': [1.2, 0.6, 0.75], 'chair': [0.5, 0.5, 0.86],
    'dining': [1.6, 0.9, 0.75], 'table': [1.2, 0.7, 0.75],
    'counter': [2.4, 0.6, 0.9], 'island': [1.8, 0.9, 0.9], 'fridge': [0.9, 0.75, 1.85],
    'washer': [0.6, 0.65, 0.85], 'shoe': [1.0, 0.4, 2.2],
    'toilet': [0.4, 0.68, 0.75], 'vanity': [0.8, 0.5, 0.85], 'bathtub': [1.6, 0.75, 0.6], 'shower': [0.9, 0.9, 2.0],
    'dressing-table': [1.2, 0.4, 1.36],
    'plant': [0.5, 0.5, 1.2], 'lamp': [0.35, 0.35, 1.5], 'rug': [2.0, 1.4, 0.01],
    # 인테리어 교체용(플레이풀 미니멀): 3D 모델 = 사이드테이블+버섯 조명·셸 의자·사무 의자·라운지 의자·스툴, 코드 = 둥근 식탁·물결 책장·벽 포스터
    'side-lamp': [0.42, 0.42, 0.92], 'shell-chair': [0.47, 0.54, 0.81], 'office-chair': [0.62, 0.62, 1.05], 'lounge': [0.8, 0.8, 0.72], 'stool': [0.5, 0.38, 0.45],
    'round-table': [0.9, 0.9, 0.74], 'wave-shelf': [1.4, 0.35, 1.1], 'shelf': [1.2, 0.35, 1.1], 'poster': [0.8, 0.03, 1.05],
    'wall-arch': [2.0, 0.02, 2.0], 'pendant': [0.42, 0.42, 0.3],  # 벽에 칠한 아치 색 면 · 천장 매단 조명
}
CHAIRS = {'chair', 'shell-chair', 'office-chair'}  # 책상·식탁 밑으로 들어가도 되는 의자
FLAT = {'rug', 'poster', 'wall-arch', 'pendant'}  # 자리 정리·부딪힘에서 빼는 것(바닥 깔개·벽에 건 그림)
WALL_HUG = {'poster', 'wave-shelf', 'shelf', 'wall-arch', 'dressing-table', 'tv', 'bed', 'bed-single', 'nightstand', 'wardrobe', 'dresser', 'desk', 'counter', 'fridge', 'washer', 'shoe', 'toilet', 'vanity', 'bathtub', 'sofa'}
ROOM_TYPES = {'living', 'kitchen', 'bedroom', 'bath', 'entry', 'balcony', 'dress', 'hall', 'office', 'utility', 'outdoor', 'closet'}
DEFAULT_TOUR_ORDER = ['entry', 'living', 'kitchen', 'bedroom', 'dress', 'bath', 'office', 'balcony', 'utility', 'hall']


# ---------------- 1단계: 벽 검출 ----------------
def load_gray(path):
    im = Image.open(path).convert('RGB')
    return im, np.asarray(im.convert('L'), np.float32)


def opened(mask, k):
    m = mask.astype(np.uint8)
    return ndi.maximum_filter(ndi.minimum_filter(m, size=(k, k)), size=(k, k)) > 0


def runlen(mask):
    """각 픽셀이 속한 가로 연속 구간 길이"""
    out = np.zeros(mask.shape, np.int32)
    pad = np.zeros((mask.shape[0], 1), np.int8)
    d = np.diff(np.concatenate([pad, mask.astype(np.int8), pad], axis=1), axis=1)
    for y in range(mask.shape[0]):
        s = np.where(d[y] == 1)[0]; e = np.where(d[y] == -1)[0]
        for a, b in zip(s, e): out[y, a:b] = b - a
    return out


def detect_walls(gray, dark=100, thick=0):
    dk = gray < dark
    if not thick:  # 두께 자동: 글자·가는 선이 사라진 뒤 벽 면적이 크게 줄기 직전 크기의 0.7배
        ks = list(range(6, 70, 2)); areas = [opened(dk, k).sum() for k in ks]
        base = areas[0] or 1
        kstar = ks[0]
        for k, a in zip(ks, areas):
            if a >= 0.85 * base: kstar = k
            else: break
        thick = max(7, int(round(kstar * 0.7)))
    W = opened(dk, thick)
    hl = runlen(W); vl = runlen(W.T).T
    segs = []
    for o, M in (('h', W & (hl >= vl)), ('v', W & (vl > hl))):
        lab, n = ndi.label(M)
        for i, sl in enumerate(ndi.find_objects(lab)):
            ys, xs = sl
            h, w = ys.stop - ys.start, xs.stop - xs.start
            if h * w < thick * thick * 0.8: continue
            if o == 'h':
                yc = (ys.start + ys.stop - 1) / 2
                segs.append({'o': 'h', 'a': [xs.start, yc], 'b': [xs.stop - 1, yc], 't': h})
            else:
                xc = (xs.start + xs.stop - 1) / 2
                segs.append({'o': 'v', 'a': [xc, ys.start], 'b': [xc, ys.stop - 1], 't': w})
    segs.sort(key=lambda s: (round(min(s['a'][1], s['b'][1]) / 20), min(s['a'][0], s['b'][0])))
    for i, s in enumerate(segs): s['id'] = i
    ys, xs = np.where(W)
    bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) else [0, 0, 0, 0]
    return W, segs, thick, bbox


def grid_overlay(im, draw_fn=None, step=100):
    base = Image.blend(im.convert('RGB'), Image.new('RGB', im.size, 'white'), 0.55)
    d = ImageDraw.Draw(base)
    f = font(max(14, im.width // 110))
    for x in range(0, im.width, step // 2):
        d.line([(x, 0), (x, im.height)], fill=(200, 215, 235) if x % step else (150, 175, 215), width=1)
    for y in range(0, im.height, step // 2):
        d.line([(0, y), (im.width, y)], fill=(200, 215, 235) if y % step else (150, 175, 215), width=1)
    for x in range(0, im.width, step): d.text((x + 2, 2), str(x), fill=(40, 70, 150), font=f)
    for y in range(step, im.height, step): d.text((2, y + 2), str(y), fill=(40, 70, 150), font=f)
    if draw_fn: draw_fn(d, f)
    return base


def find_image(work, *cands):
    """평면도 찾기: 작업폴더 기준 상대경로 → 적힌 절대경로 → 작업폴더 안 source.* 순. 폴더를 옮기거나 다른 컴퓨터로 넘겨도 열린다."""
    for c in cands:
        if not c: continue
        p = Path(c).expanduser()
        if not p.is_absolute(): p = work / p
        if p.exists(): return p
    for p in sorted(work.glob('source.*')): return p
    raise SystemExit(f'평면도 이미지를 찾지 못함: {cands[0] or cands[-1]} → 작업폴더에 source.png 로 넣거나 plan.json "image"를 고친다')

def cmd_walls(a):
    src = Path(a.image).expanduser().resolve(); out = Path(a.out).resolve(); out.mkdir(parents=True, exist_ok=True)
    import shutil
    img = out / f'source{src.suffix.lower()}'
    if src != img: shutil.copy2(src, img)  # 작업폴더만 있으면 어디서든 다시 만들 수 있게
    im, gray = load_gray(img)
    W, segs, thick, bbox = detect_walls(gray, a.dark, a.thick)
    (out / 'walls.json').write_text(json.dumps({'image': img.name, 'size': list(im.size), 'dark': a.dark, 'thick': thick, 'bbox': bbox, 'segments': segs}, ensure_ascii=False, indent=1), encoding='utf-8')

    def draw(d, f):
        for s in segs:
            col = (230, 90, 60) if s['o'] == 'h' else (40, 150, 90)
            d.line([tuple(s['a']), tuple(s['b'])], fill=col, width=max(3, int(s['t'] * 0.5)))
            mx, my = (s['a'][0] + s['b'][0]) / 2, (s['a'][1] + s['b'][1]) / 2
            d.text((mx + 4, my + 2), str(s['id']), fill=(20, 20, 20), font=f)
        d.rectangle(bbox, outline=(120, 60, 200), width=2)
    grid_overlay(im, draw).save(out / 'walls.png')
    pj = out / 'plan.json'
    if not pj.exists():
        pj.write_text(json.dumps({
            'name': out.name.removesuffix('.work') or src.stem, 'image': img.name,
            'scale': {'bboxWidthM': None, 'bboxHeightM': None, 'a': None, 'b': None, 'm': None},
            'wallHeight': 2.3, 'view': 'forest',
            'walls': {'remove': [], 'add': []},
            'openings': {}, 'openingsAdd': [],
            'rooms': [], 'furniture': [], 'start': None, 'tour': []
        }, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'벽 조각 {len(segs)}개 · 두께 기준 {thick}px · 건물 범위(px) {bbox} (폭 {bbox[2]-bbox[0]} · 높이 {bbox[3]-bbox[1]})')
    print(f'검사 그림: {out / "walls.png"}\n다음: {pj} 를 채우고 build')


# ---------------- 2단계: 장면 만들기 ----------------
def seg_rect(s):
    t = s['t'] / 2
    (x0, y0), (x1, y1) = s['a'], s['b']
    if s['o'] == 'h': return [min(x0, x1), y0 - t, max(x0, x1), y0 + t]
    return [x0 - t, min(y0, y1), x0 + t, max(y0, y1)]


def raster(rects, shape):
    m = np.zeros(shape, bool)
    for r in rects:
        x0, y0, x1, y1 = [int(round(v)) for v in r]
        m[max(0, y0):max(0, y1 + 1), max(0, x0):max(0, x1 + 1)] = True
    return m


def arc_geom(arc):
    """곡선 벽: 양 끝 a·b와 그 사이 호 위 한 점 via를 지나는 원 → (중심 x, y, 반지름, 시작각, 돈 각도). 각은 atan2(y, x)(이미지 좌표 = 장면 x·z와 같은 방향)"""
    (x1, y1), (x2, y2), (x3, y3) = arc['a'], arc['b'], arc['via']
    d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2))
    if abs(d) < 1e-6: sys.exit(f'곡선 벽 {arc} 의 세 점이 한 줄에 있습니다(via는 호의 가장 튀어나온 점)')
    s1, s2, s3 = x1 * x1 + y1 * y1, x2 * x2 + y2 * y2, x3 * x3 + y3 * y3
    ux = (s1 * (y2 - y3) + s2 * (y3 - y1) + s3 * (y1 - y2)) / d
    uy = (s1 * (x3 - x2) + s2 * (x1 - x3) + s3 * (x2 - x1)) / d
    r = math.hypot(x1 - ux, y1 - uy)
    a0, a1, av = (math.atan2(y - uy, x - ux) for x, y in ((x1, y1), (x2, y2), (x3, y3)))
    span = (a1 - a0) % (2 * math.pi)
    if (av - a0) % (2 * math.pi) > span: a0, span = a1, 2 * math.pi - span  # via를 지나는 쪽으로 돈다
    return ux, uy, r, a0, span


def arc_mask(arc, shape, t):
    ux, uy, r, a0, span = arc_geom(arc)
    y0, y1 = int(max(0, uy - r - t)), int(min(shape[0], uy + r + t + 2))
    x0, x1 = int(max(0, ux - r - t)), int(min(shape[1], ux + r + t + 2))
    m = np.zeros(shape, bool)
    if y1 <= y0 or x1 <= x0: return m
    yy, xx = np.mgrid[y0:y1, x0:x1]
    d = np.hypot(xx - ux, yy - uy); ang = (np.arctan2(yy - uy, xx - ux) - a0) % (2 * math.pi)
    m[y0:y1, x0:x1] = (np.abs(d - r) <= t / 2) & (ang <= span + 0.5 / max(r, 1))
    return m


def on_chord(g, arcs):
    """틈이 곡선 벽의 현(두 끝을 잇는 직선) 위에 있는가: 둥근 발코니처럼 벽이 바깥으로 휘면 직선 벽이 끊긴 자리가 틈으로 잡힌다 → 방을 가르지 않게 버린다"""
    mx, my = (g['a'][0] + g['b'][0]) / 2, (g['a'][1] + g['b'][1]) / 2
    for arc in arcs:
        (ax, ay), (bx, by) = arc['a'], arc['b']; L = math.dist(arc['a'], arc['b'])
        if L < 1: continue
        ux, uy = (bx - ax) / L, (by - ay) / L
        u = (mx - ax) * ux + (my - ay) * uy; off = abs(-(mx - ax) * uy + (my - ay) * ux)
        par = abs(ux) >= abs(uy) if g['o'] == 'h' else abs(uy) > abs(ux)
        if par and -2 <= u <= L + 2 and off <= max(g['t'], arc['_t']) * 1.2: return True
    return False


def find_gaps(segs, W, ppm, maxm=6.0, minm=0.45):
    H, Wd = W.shape
    gaps = []
    for s in segs:
        r = seg_rect(s)
        for end in (0, 1):
            if s['o'] == 'h':
                y = int(round(s['a'][1])); x = int(round(r[2] if end else r[0])); dx = 1 if end else -1
                L = 0; xx = x + dx
                while 0 <= xx < Wd and L < maxm * ppm and not W[y, xx]: xx += dx; L += 1
                if 0 <= xx < Wd and W[y, xx] and minm * ppm <= L:
                    a, b = sorted([x + dx, xx - dx])
                    gaps.append({'o': 'h', 'a': [a, s['a'][1]], 'b': [b, s['a'][1]], 't': s['t']})
            else:
                x = int(round(s['a'][0])); y = int(round(r[3] if end else r[1])); dy = 1 if end else -1
                L = 0; yy = y + dy
                while 0 <= yy < H and L < maxm * ppm and not W[yy, x]: yy += dy; L += 1
                if 0 <= yy < H and W[yy, x] and minm * ppm <= L:
                    a, b = sorted([y + dy, yy - dy])
                    gaps.append({'o': 'v', 'a': [s['a'][0], a], 'b': [s['a'][0], b], 't': s['t']})
    # 같은 틈 합치기(양쪽 끝에서 두 번 찾음)
    out = []
    for g in gaps:
        k = 0 if g['o'] == 'h' else 1
        dup = next((o for o in out if o['o'] == g['o'] and abs(o['a'][1 - k] - g['a'][1 - k]) < max(o['t'], g['t']) * 0.6
                    and min(o['b'][k], g['b'][k]) - max(o['a'][k], g['a'][k]) > -2), None)
        if dup:
            dup['a'][k] = min(dup['a'][k], g['a'][k]); dup['b'][k] = max(dup['b'][k], g['b'][k]); dup['t'] = max(dup['t'], g['t'])
        else: out.append(g)
    out.sort(key=lambda g: (round(g['a'][1] / 20), g['a'][0]))
    return out


def gap_rect(g, pad=0):
    t = g['t'] / 2 + pad
    if g['o'] == 'h': return [g['a'][0] - 1, g['a'][1] - t, g['b'][0] + 1, g['a'][1] + t]
    return [g['a'][0] - t, g['a'][1] - 1, g['a'][0] + t, g['b'][1] + 1]


def rects_from_mask(m):
    """칸 격자 → 겹치지 않는 사각형들(가로 구간을 세로로 이어 붙임)"""
    rects, open_ = [], {}
    for y in range(m.shape[0] + 1):
        runs = set()
        if y < m.shape[0]:
            row = np.concatenate([[0], m[y].astype(np.int8), [0]]); d = np.diff(row)
            runs = set(zip(np.where(d == 1)[0], np.where(d == -1)[0]))
        for key in list(open_):
            if key not in runs: x0, x1 = key; rects.append([x0, open_[key], x1, y]); del open_[key]
        for key in runs:
            if key not in open_: open_[key] = y
    return rects


def widen(g, target_px, segs, ppm):
    """문 틈을 target_px까지 넓힌다: 틈 양끝에 이어진 같은 줄 벽을 잘라 낸다(직각 벽 쪽은 못 넓힘). 실제로 넓힌 폭(px)을 돌려준다."""
    k = 0 if g['o'] == 'h' else 1          # 틈이 놓인 축
    q = 1 - k                               # 틈 가운데 줄 축
    need = target_px - (g['b'][k] - g['a'][k])
    if need <= 0: return 0
    stub = 0.1 * ppm                        # 남길 벽 토막
    def lo(sg): return min(sg['a'][k], sg['b'][k])
    def hi(sg): return max(sg['a'][k], sg['b'][k])
    same = [sg for sg in segs if sg['o'] == g['o'] and abs(sg['a'][q] - g['a'][q]) < max(sg['t'], g['t']) * 0.6]
    after = next((sg for sg in same if abs(lo(sg) - g['b'][k]) <= g['t']), None)   # b 끝 뒤 벽
    before = next((sg for sg in same if abs(hi(sg) - g['a'][k]) <= g['t']), None)  # a 끝 앞 벽
    room_a = max(0, hi(before) - lo(before) - stub) if before else 0
    room_b = max(0, hi(after) - lo(after) - stub) if after else 0
    if room_a + room_b <= 0: return 0
    take_b = min(room_b, need if room_a <= 0 else max(need / 2, need - room_a))
    take_a = min(room_a, need - take_b)
    if take_b > 0:
        g['b'][k] += take_b; v = lo(after) + take_b
        if after['a'][k] <= after['b'][k]: after['a'][k] = v
        else: after['b'][k] = v
    if take_a > 0:
        g['a'][k] -= take_a; v = hi(before) - take_a
        if before['b'][k] >= before['a'][k]: before['b'][k] = v
        else: before['a'][k] = v
    return take_a + take_b


def cmd_build(a):
    pj = Path(a.plan).resolve(); work = pj.parent
    P = json.loads(pj.read_text(encoding='utf-8'))
    furnished = (getattr(a, 'furnished', False) or P.get('furnished')) and not getattr(a, 'bare', False)
    P['bare'] = not furnished
    if P['bare']: # 기본값 = 구조만: 벽·문·창·바닥·바깥과 붙박이 설비만. 가구는 plan.json "furnished": true 또는 --furnished 일 때만 넣는다
        BUILTIN = {'counter', 'shoe', 'toilet', 'vanity', 'bathtub', 'shower'} # 집에 붙은 설비(주방 조리대·신발장·위생도기)는 구조로 남긴다 — 욕실이 타일 모서리만 보여 무슨 방인지 몰랐다
        drop = set(getattr(a, 'drop', '') .split(',')) - {''}  # 도면 검사에 걸린 설비 종류(tour.py가 다시 만들 때 넘긴다)
        kept = [{k: v for k, v in f.items() if k not in ('props', 'model', 'modelTurn')} for f in P.get('furniture', []) if f.get('type') in BUILTIN and f.get('type') not in drop]
        if drop: print(f'  문·벽과 부딪힌 설비 종류는 뺌: {", ".join(sorted(drop))}')
        st = P.setdefault('style', {}); st.setdefault('floors', {}).setdefault('kitchen', 'wood') # 거실과 이어진 주방을 비스듬히 나누면 마루·타일 경계가 계단 톱니가 됐다 → 주방도 마루
        P['furniture'] = kept; print(f'  구조만: 가구 없음(붙박이 설비 {len(kept)}개만) · 눈높이 1인칭')
    WJ = json.loads((work / 'walls.json').read_text(encoding='utf-8'))
    im = Image.open(find_image(work, P.get('image'), WJ.get('image'))).convert('RGB')
    shape = (im.height, im.width)
    bbox = WJ['bbox']
    # 벽: 자동 검출 - 뺄 것 + 더할 것(더할 벽 두께 tmm, 없으면 중간값)
    rm = set(P.get('walls', {}).get('remove', []))
    segs = [s for s in WJ['segments'] if s['id'] not in rm]
    tmed = float(np.median([s['t'] for s in segs])) if segs else 20
    for i, w in enumerate(P.get('walls', {}).get('add', [])):
        (x0, y0), (x1, y1) = w['a'], w['b']
        t = w.get('tpx', tmed)  # 더할 벽 두께(px), 없으면 검출한 벽 두께 중간값
        o = 'h' if abs(x1 - x0) >= abs(y1 - y0) else 'v'
        if o == 'h': segs.append({'o': 'h', 'a': [min(x0, x1), (y0 + y1) / 2], 'b': [max(x0, x1), (y0 + y1) / 2], 't': t, 'id': f'+{i}'})
        else: segs.append({'o': 'v', 'a': [(x0 + x1) / 2, min(y0, y1)], 'b': [(x0 + x1) / 2, max(y0, y1)], 't': t, 'id': f'+{i}'})
    # 곡선 벽(둥근 발코니 등): 직선 조각으로 잡으면 납작한 상자가 된다 → 세 점으로 원호를 그대로 짓는다
    ARCS = [dict(a) for a in P.get('walls', {}).get('arcs', [])]
    for arc in ARCS: arc['_t'] = arc.get('tpx', tmed)
    # 건물 범위 = 남은 벽(지운 것 빼고, 더한 것 넣고)과 곡선 벽의 바깥 끝
    rs = [seg_rect(s) for s in segs]
    for arc in ARCS:
        ux, uy, r, a0, span = arc_geom(arc); ro = r + arc['_t'] / 2
        pts = [(ux + ro * math.cos(a0 + span * k / 64), uy + ro * math.sin(a0 + span * k / 64)) for k in range(65)]
        rs.append([min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)])
    bbox = [int(min(r[0] for r in rs)), int(min(r[1] for r in rs)), int(max(r[2] for r in rs)), int(max(r[3] for r in rs))]
    rs = rs[:len(segs)]
    sc = P.get('scale') or {}
    if sc.get('a') and sc.get('b') and sc.get('m'): ppm = math.dist(sc['a'], sc['b']) / sc['m']
    elif sc.get('bboxWidthM'): ppm = (bbox[2] - bbox[0]) / sc['bboxWidthM']
    elif sc.get('bboxHeightM'): ppm = (bbox[3] - bbox[1]) / sc['bboxHeightM']
    else: sys.exit('plan.json scale 이 비었습니다: bboxWidthM(건물 바깥 폭 m) 또는 a·b·m(치수선 두 끝 px와 길이 m)을 적으세요')
    W = raster(rs, shape)
    for arc in ARCS: W |= arc_mask(arc, shape, arc['_t'])
    # 문 최소 폭: 벽 두께의 2.2배(0.3m 이상). 작은 도식 평면도는 문이 0.4m쯤으로 그려진다
    gaps = find_gaps(segs, W, ppm, minm=max(0.3, 2.2 * tmed / ppm))
    for i, g in enumerate(P.get('openingsAdd', [])):
        (x0, y0), (x1, y1) = g['a'], g['b']
        o = 'h' if abs(x1 - x0) >= abs(y1 - y0) else 'v'
        t = g.get('tmm', tmed / ppm * 1000) / 1000 * ppm
        gg = {'o': 'h', 'a': [min(x0, x1), (y0 + y1) / 2], 'b': [max(x0, x1), (y0 + y1) / 2], 't': t} if o == 'h' else {'o': 'v', 'a': [(x0 + x1) / 2, min(y0, y1)], 'b': [(x0 + x1) / 2, max(y0, y1)], 't': t}
        gg['type'] = g.get('type', 'window'); gg['manual'] = True
        gaps.append(gg)
    for i, g in enumerate(gaps): g['id'] = f'g{i + 1}'
    # 바깥: 틈을 모두 막고 테두리에서 채우기
    Wc = W | raster([gap_rect(g, 1) for g in gaps], shape)
    lab, n = ndi.label(~Wc)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    outside = np.isin(lab, list(border))
    # 틈 종류: 적힌 값 > 기본(바깥에 닿으면 창, 안쪽 1.3m 이하 문, 그보다 넓으면 트임)
    OPEN = P.get('openings', {})
    for g in gaps:
        L = (g['b'][0] - g['a'][0] if g['o'] == 'h' else g['b'][1] - g['a'][1]) / ppm
        g['len'] = L
        mx, my = (g['a'][0] + g['b'][0]) / 2, (g['a'][1] + g['b'][1]) / 2
        off = g['t'] / 2 + 3
        pts = [(mx, my - off), (mx, my + off)] if g['o'] == 'h' else [(mx - off, my), (mx + off, my)]
        ext = any(0 <= int(y) < shape[0] and 0 <= int(x) < shape[1] and outside[int(y), int(x)] for x, y in pts)
        g['exterior'] = bool(ext)
        dflt = 'none' if on_chord(g, ARCS) else 'window' if ext else ('door' if L <= 1.3 else 'open')
        g['type'] = OPEN.get(g['id'], g.get('type') if g.get('manual') else dflt)
    # 안쪽 틈이 2.2m보다 길면 문이 아니라 벽 끝에서 방을 가로지른 것 → 버림(직접 적은 것·종류를 정한 것은 둔다)
    keep = [g for g in gaps if g['type'] != 'none' and (g.get('manual') or g['id'] in OPEN or g['exterior'] or g['len'] <= 2.2)]
    # 문 폭 맞추기: 도식 도면은 문이 좁게(0.4m쯤) 그려진다 → 안쪽 문 0.8m · 바깥 문(현관) 0.9m로 넓힌다. widths로 문마다 바꿀 수 있다
    WID = P.get('widths', {})
    for g in keep:
        if g['type'] != 'door' and g['id'] not in WID: continue
        want = WID.get(g['id'], 0.9 if g['exterior'] else 0.8)
        if want and widen(g, want * ppm, segs, ppm) > 0: g['len'] = (g['b'][0] - g['a'][0] if g['o'] == 'h' else g['b'][1] - g['a'][1]) / ppm
    # 벽 두께를 실제 범위(0.10~0.30m)로: 굵게 칠한 선·글자 덩어리가 그대로 두꺼운 벽이 되지 않게
    thick_fixed = 0
    for sg in segs:
        t0 = sg['t']; sg['t'] = min(max(sg['t'], 0.10 * ppm), 0.30 * ppm)
        if abs(sg['t'] - t0) > 0.01 * ppm: thick_fixed += 1
    for arc in ARCS: arc['_t'] = min(max(arc['_t'], 0.10 * ppm), 0.30 * ppm)
    if thick_fixed: print(f'  벽 두께 정리: {thick_fixed}개를 0.10~0.30m 범위로 맞춤')
    W = raster([seg_rect(s) for s in segs], shape)
    for arc in ARCS: W |= arc_mask(arc, shape, arc['_t'])
    # 방 나누기: 남은 틈(문·창·트임)은 모두 방 경계로 막는다. 벽 없이 이어진 공간은 이름 점(seed)마다 가까운 쪽으로 나눈다
    Wr = W | raster([gap_rect(g, 1) for g in keep], shape)
    free = ~Wr & ~outside
    lab, n = ndi.label(free)
    areas = ndi.sum(np.ones(shape), lab, index=np.arange(1, n + 1)) / ppm ** 2
    rooms_in = P.get('rooms', [])
    roomlab = np.zeros(shape, np.int32)
    rooms = []
    comp_seeds = {}
    for ri, r in enumerate(rooms_in):
        x, y = [int(round(v)) for v in r['at']]
        c = lab[y, x] if 0 <= y < shape[0] and 0 <= x < shape[1] else 0
        if c == 0:  # 글자 위(벽 판정)면 가까운 빈칸
            dd, (iy, ix) = ndi.distance_transform_edt(lab == 0, return_indices=True)
            c = lab[iy[y, x], ix[y, x]]
        comp_seeds.setdefault(c, []).append(ri)
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    for c, sids in comp_seeds.items():
        if c == 0: continue
        cm = lab == c
        if len(sids) == 1:
            roomlab[cm] = sids[0] + 1
        else:
            # 이름 점들이 주로 펼쳐진 축의 거리로 나눈다(곧은 경계): 두 점을 잇는 직선 거리로 나누면 대각선 경계가 0.1m 칸 계단 톱니가 됐다
            sx = np.ptp([rooms_in[s]['at'][0] for s in sids]); sy = np.ptp([rooms_in[s]['at'][1] for s in sids])
            wx, wy = ((1.0, 0.05) if sx >= sy else (0.05, 1.0)) if len(sids) == 2 else (1.0, 1.0)  # 셋 이상이면 가까운 점(곧은 경계가 엉뚱한 띠를 가져갔다)
            ds = np.stack([(wx * (xx - rooms_in[s]['at'][0])) ** 2 + (wy * (yy - rooms_in[s]['at'][1])) ** 2 for s in sids])
            near = np.argmin(ds, axis=0)
            for k, s in enumerate(sids): roomlab[cm & (near == k)] = s + 1
    extra = 0
    for c in range(1, n + 1):
        if c in comp_seeds or areas[c - 1] < 0.05: continue
        base = '복도' if areas[c - 1] >= 0.6 else '수납'  # 0.6㎡ 미만 = 붙박이 수납칸(바닥·천장만 깐다)
        extra += 1
        nm = base; k2 = 1
        while any(r['name'] == nm for r in rooms_in): k2 += 1; nm = f'{base}{k2}'
        rooms_in.append({'name': nm, 'type': 'hall' if base == '복도' else 'closet', 'auto': True})
        roomlab[lab == c] = len(rooms_in)
    # 0.1m 칸 → 사각형
    cell = 0.1 * ppm
    gx0, gy0 = bbox[0], bbox[1]
    gw, gh = int(math.ceil((bbox[2] - bbox[0]) / cell)) + 1, int(math.ceil((bbox[3] - bbox[1]) / cell)) + 1

    # 칸 크기(px)가 정수가 아니면 칸마다 든 픽셀 수가 다르다(4.24px 칸 → 16·20·25개). 고정 개수로 자르면 방 가장자리가
    # 0.4m마다 한 칸씩 튀어나와 걸레받이·바닥이 톱니처럼 끊긴다 → 칸에 실제로 든 픽셀 수 대비 비율로 자른다
    def cell_count(ys_, xs_):
        sub = np.zeros((gh, gw), np.float32)
        if len(xs_):
            cx = ((xs_ - gx0) / cell).astype(int).clip(0, gw - 1); cy = ((ys_ - gy0) / cell).astype(int).clip(0, gh - 1)
            np.add.at(sub, (cy, cx), 1)
        return sub
    _ay, _ax = np.mgrid[0:shape[0], 0:shape[1]]
    cell_px = np.maximum(cell_count(_ay.ravel(), _ax.ravel()), 1)
    def to_cells(mask):
        return cell_count(*np.where(mask)) > cell_px * 0.45

    M = lambda px: [(px[0] - gx0) / ppm, (px[1] - gy0) / ppm]
    # 벽 중심선 나누기: 벽·틈 픽셀을 가장 가까운 방(또는 바깥)에 준다 → 벽마다 실제 두께의 가운데에서 갈린다(두꺼운 바깥벽도)
    _f = roomlab.copy(); _f[outside & (_f == 0)] = -1
    _, _ix = ndi.distance_transform_edt(_f == 0, return_indices=True)
    cfill = _f[_ix[0], _ix[1]]
    for ri, r in enumerate(rooms_in):
        mask = roomlab == ri + 1
        area = mask.sum() / ppm ** 2
        # 벽 중심선 면적: 도면 표기 면적은 벽 중심선 치수로 잰다(침실 4,200×3,600 = 15.12 = 표기 15.11) → 방을 벽 두께 절반만큼 벽·틈 쪽으로 넓혀 잰다
        carea = (cfill == ri + 1).sum() / ppm ** 2
        cg = to_cells(mask)
        rects = [[x0 * 0.1, y0 * 0.1, x1 * 0.1, y1 * 0.1] for x0, y0, x1, y1 in rects_from_mask(cg)]
        if not rects: continue
        rt = r.get('type') or 'hall'
        if rt not in ROOM_TYPES: print(f'  경고: 방 종류 {rt} 를 모름 → hall'); rt = 'hall'
        rooms.append({'name': r['name'], 'type': rt, 'area': round(float(area), 2), 'carea': round(float(carea), 2), 'stated': r.get('area'),
                      'center': None, 'rects': [[round(v, 2) for v in q] for q in rects],
                      'floor': r.get('floor'), 'auto': r.get('auto', False), '_mask': mask})
    # 면적 검사: 표기 면적이 있는 방마다 계산한 면적이 ±5% 안이어야 한다. 10%를 넘으면 설비·가구를 넣기 전에 멈춘다
    # 도면마다 표기 기준이 다르다: 포털 매물 도면 = 벽 중심선, 설계 도면 = 실내 치수 → 두 기준 중 중앙값이 표기에 더 가까운 쪽을 쓴다
    st_rooms = [r for r in rooms if r.get('stated')]
    if st_rooms:
        mn = float(np.median([r['area'] / r['stated'] for r in st_rooms])); mc = float(np.median([r['carea'] / r['stated'] for r in st_rooms]))
        basis = 'carea' if abs(mc - 1) <= abs(mn - 1) else 'area'
    else: basis = 'carea'
    for r in rooms: r['cmp'] = r[basis]
    print(f"  면적 기준: {'벽 중심선' if basis == 'carea' else '실내(벽 안쪽)'} — 표기와 더 가까운 쪽")
    # 벽 없이 이어진 방들(거실+주방 등, 같은 칸 묶음)은 경계를 도면 작성자가 어디 그었는지 알 수 없다 → 표기가 있는 방들의 합계로 비교
    comp_of = {}
    for c, sids in comp_seeds.items():
        for sidx in sids: comp_of[rooms_in[sidx]['name']] = c
    groups = {}
    for r in rooms:
        if r.get('stated'): groups.setdefault(comp_of.get(r['name'], r['name']), []).append(r)
    off = []
    for g in groups.values():
        if len(g) == 1: r = g[0]; off.append((r['name'], r['cmp'], r['stated'], r['cmp'] / r['stated'] - 1))
        else:
            ca = sum(r['cmp'] for r in g); st = sum(r['stated'] for r in g); nm = '+'.join(r['name'] for r in g) + '(이어진 공간 합계)'
            off.append((nm, ca, round(st, 2), ca / st - 1)); print(f'  {nm}: {ca:.2f}㎡ / 표기 합 {st:.2f} → {(ca / st - 1) * 100:+.1f}%')
    # 기준: 5% 이내 = 통과 · 5~10% = 진행하고 보고(확인 필요) · 10% 넘음 = 멈춤
    bad10 = [o for o in off if abs(o[3]) > 0.10]; warn = [o for o in off if 0.05 < abs(o[3]) <= 0.10]
    area_warn = [{'room': nm, 'area': round(ca, 2), 'stated': st, 'diff': round(d * 100, 1)} for nm, ca, st, d in warn + (bad10 if P.get('areaConfirmed') else [])]
    for nm, ca, st, d in warn: print(f'  면적 확인 필요(5~10%): {nm} {ca:.2f}㎡ / 표기 {st} → {d * 100:+.1f}%')
    if bad10 and not P.get('areaConfirmed'):
        print(f"멈춤: 표기 면적과 10% 넘게 다른 방({'벽 중심선' if basis == 'carea' else '실내'} 면적 기준)")
        for nm, ca, st, d in bad10: print(f'  - {nm}: {ca:.2f}㎡ / 표기 {st} → {d * 100:+.1f}%  (작으면: 방 경계가 안쪽에 잡힘·옆 칸이 따로 잡힘 / 크면: 옆 공간과 합쳐짐 — 빠진 벽·틈·이름 점을 고친다)')
        sys.exit('모두 비슷한 비율로 틀리면 축척(scale)을 고치고, 도면 그림 자체가 표기와 다를 때만 plan.json 에 "areaConfirmed": true(보고에 남는다)')
    rat = [r['cmp'] / r['stated'] for r in rooms if r.get('stated')]
    if len(rat) >= 3:
        med = float(np.median(rat))
        if abs(med - 1) > 0.12 and not (P.get('scaleConfirmed') or P.get('areaConfirmed')):
            sug = f"bboxWidthM {sc['bboxWidthM'] / math.sqrt(med):.2f}" if sc.get('bboxWidthM') else f"길이를 {1 / math.sqrt(med):.3f}배"
            sys.exit(f'멈춤: 방 면적이 표기와 평균 {(med - 1) * 100:+.0f}% 어긋납니다(길이 {math.sqrt(med):.3f}배). 축척을 {sug}로 고치거나, 도면이 원래 이렇다면 plan.json에 "scaleConfirmed": true 를 적고 다시 build 하세요.')
    # 가구 자리(벽에 붙는 가구는 뒤쪽 벽 면에 맞춘다)
    furn, boxes = [], []
    for f in P.get('furniture', []):
        t = f['type']
        if t not in FURN: print(f'  경고: 가구 종류 {t} 를 모름(건너뜀)'); continue
        w, d, h = FURN[t]
        if f.get('size'): w, d = f['size'][:2]
        rot = float(f.get('rot', 0)) % 360
        th = math.radians(rot); fx, fy = math.sin(th), math.cos(th)  # 앞 방향(이미지 좌표)
        cx, cy = f['at']
        if f.get('snap', t in WALL_HUG):  # 뒤쪽 벽에 붙이기: 가운데에서 뒤로 첫 벽을 찾아 뒷면을 그 벽 면에 맞춘다(박혔으면 앞으로, 떨어졌으면 뒤로)
            for step in range(int((d / 2 + 1.0) * ppm)):
                bx, by = cx - fx * step, cy - fy * step
                if 0 <= int(by) < shape[0] and 0 <= int(bx) < shape[1] and W[int(by), int(bx)]:
                    shift = step - d / 2 * ppm - 1
                    cx -= fx * shift; cy -= fy * shift
                    break
        item = {'type': t, 'x': round((cx - gx0) / ppm, 3), 'z': round((cy - gy0) / ppm, 3), 'rot': rot, 'w': w, 'd': d, 'h': f.get('h', h)}
        for k in ('variant', 'upper', 'sink', 'cooktop', 'chairs', 'color', 'y0', 'image', 'props'):
            if k in f: item[k] = f[k]
        furn.append(item); item['_px'] = [cx, cy, th]
    # ---- 1·2. 단단한 물체 목록 + 가구 자동 정리 ----
    # 가구마다 실제로 그려지는 부품(본체 · 식탁 의자 · 상부장)을 상자로 만들고, 벽 · 문 앞 · 건물 밖 · 다른 가구와 겹치지 않게
    # 0.05m 칸 지도에서 ±0.4m 안 가장 덜 움직이는 자리로 옮긴다. 그래도 겹치는 의자는 뺀다. 결과는 scene.solids(그리는 코드·걷기·카메라·검사가 같이 씀)
    G = 0.05 * ppm
    gh2, gw2 = int(math.ceil(shape[0] / G)), int(math.ceil(shape[1] / G))
    def pool(mask):
        pad = np.zeros((gh2 * int(math.ceil(G)) + 2, gw2 * int(math.ceil(G)) + 2), bool)
        ys_, xs_ = np.where(mask); out = np.zeros((gh2, gw2), bool); out[(ys_ / G).astype(int).clip(0, gh2 - 1), (xs_ / G).astype(int).clip(0, gw2 - 1)] = True; return out
    wallG, outG = pool(W), pool(outside & ~W)
    doorG = np.zeros((gh2, gw2), bool)
    for g in keep:
        if g['type'] in ('door', 'open', 'slide'):  # 문·미닫이 앞 0.45m, 문 없는 트임은 0.25m만 비워 둔다
            x0, y0, x1, y1 = gap_rect(g, (0.25 if g['type'] == 'open' else 0.45) * ppm); doorG[max(0, int(y0 / G)):int(y1 / G) + 1, max(0, int(x0 / G)):int(x1 / G) + 1] = True
    occG = np.zeros((gh2, gw2), bool); lowG = np.zeros((gh2, gw2), bool)  # lowG = 책상·식탁 칸(의자는 그 밑으로 들어가도 된다)
    def cells_of(cx, cy, th, w, d):  # 돌린 직사각형 안의 칸(정수 좌표)
        r = (math.hypot(w, d) / 2 * ppm) / G + 1; c0, r0 = cx / G, cy / G
        jj, ii = np.mgrid[int(r0 - r):int(r0 + r) + 1, int(c0 - r):int(c0 + r) + 1]
        px, py = (ii + 0.5) * G - cx, (jj + 0.5) * G - cy
        lx = px * math.cos(th) - py * math.sin(th); lz = px * math.sin(th) + py * math.cos(th)
        m = (np.abs(lx) <= w / 2 * ppm) & (np.abs(lz) <= d / 2 * ppm)
        return jj[m], ii[m]
    hit_under = [False]
    def hits(jj, ii, dj=0, di=0):
        j, i = jj + dj, ii + di; ok = (j >= 0) & (j < gh2) & (i >= 0) & (i < gw2)
        if not ok.all(): return 99, 0, 0, 0
        occ = occG[j, i] & ~lowG[j, i] if hit_under[0] else occG[j, i]
        return int(wallG[j, i].sum()), int(doorG[j, i].sum()), int(outG[j, i].sum()), int(occ.sum())
    def parts_of(it, cx, cy, th):  # [(종류, 상자 중심 px, w, d, y0, y1, 의자 번호)]
        w, d, t = it['w'], it['d'], it['type']
        L = lambda lx, lz: (cx + (lx * math.cos(th) + lz * math.sin(th)) * ppm, cy + (-lx * math.sin(th) + lz * math.cos(th)) * ppm)
        out = [('body', (cx, cy), w, d, 0.0, float(it.get('h') or 0.8), None)]
        if t == 'dining':
            n = it.get('chairs', 6 if w > 1.5 else 4); per = math.ceil(n / 2); k = 0
            for sd in (0, 1):
                for i in range(per):
                    if sd * per + i >= n: break
                    u = (i + 0.5) / per - 0.5; out.append(('chair', L(u * w * 0.85, (1 if sd else -1) * (d / 2 + 0.12)), 0.48, 0.5, 0.0, 0.86, (u * w * 0.85, (1 if sd else -1) * (d / 2 + 0.12), sd)))
        if t == 'counter' and it.get('upper'): out.append(('upper', L(0, -d / 2 + 0.17), w, 0.34, 1.48, 2.2, None))
        return out
    moved, dropped, still = [], [], []
    order = sorted([it for it in furn if it['type'] not in FLAT], key=lambda it: -it['w'] * it['d'])
    R8 = int(round(0.4 * ppm / G))
    UNDER = {(c, t) for c in CHAIRS for t in ('desk', 'dining', 'table', 'round-table')}  # 밑으로 들어가는 짝은 겹쳐도 된다
    for it in order:
      w_orig = it['w']
      for shrink in (1.0, 0.9, 0.8, 0.7):  # 옆으로 옮겨도 벽에 걸리면 폭을 10%씩(최대 30%) 줄여 다시 찾는다
        it['w'] = round(w_orig * shrink, 3)
        cx, cy, th = it['_px']
        ps = [p for p in parts_of(it, cx, cy, th) if p[0] != 'upper']
        cl = [cells_of(p[1][0], p[1][1], th, p[2] - 0.06, p[3] - 0.06) for p in ps]  # 벽에 붙인 가구가 경계 칸 때문에 밀려나지 않게 3cm씩 작게
        best = None
        hug = it['type'] in WALL_HUG; hit_under[0] = it['type'] in CHAIRS
        if hug:  # 벽에 붙는 가구: 벽을 따라 옆으로 ±0.4m, 앞으로는 0.1m까지만(벽에서 떨어지면 더 이상하다)
            cand = {(int(round((-u * math.sin(th) + v * math.cos(th)) * ppm / G)), int(round((u * math.cos(th) + v * math.sin(th)) * ppm / G))) for u in np.arange(-0.4, 0.401, 0.05) for v in (0, 0.05, 0.1)}
        else:
            cand = {(dj, di) for dj in range(-R8, R8 + 1) for di in range(-R8, R8 + 1)}
        for dj, di in sorted(cand):
            if True:
                cost = math.hypot(di, dj) * 0.05 * 4
                for (jj, ii), p in zip(cl, ps):
                    a, b, c, e = hits(jj, ii, dj, di); wgt = 1 if p[0] == 'body' else 0.6
                    cost += wgt * (100 * a + 20 * b + 40 * c + 30 * e)
                if best is None or cost < best[0]: best = (cost, dj, di)
        _, dj, di = best
        if dj or di: moved.append((it['type'], round(math.hypot(di, dj) * 0.05, 2)))
        cx, cy = cx + di * G, cy + dj * G; it['_px'] = [cx, cy, th]
        it['x'], it['z'] = round((cx - gx0) / ppm, 3), round((cy - gy0) / ppm, 3)
        keep_chairs, mark = [], []
        for p in parts_of(it, cx, cy, th):  # 먼저 모두 검사하고(의자는 식탁 밑으로 들어가 있으니 자기 식탁과는 겹쳐도 된다), 그다음 칸을 채운다
            jj, ii = cells_of(p[1][0], p[1][1], th, p[2] - 0.06, p[3] - 0.06)
            a, b, c, e = hits(jj, ii)
            if p[0] == 'chair':
                if a + c + e > 1 or b > 4: dropped.append(it['type']); continue  # 확실히 겹칠 때만 뺀다
                keep_chairs.append([round(p[6][0], 3), round(p[6][1], 3), p[6][2]])
            elif p[0] == 'body' and a + c > 0: still.append((it['type'], it['x'], it['z']))
            if p[0] != 'upper': mark.append((jj, ii))
        if still and still[-1][0] == it['type'] and shrink > 0.7 and it['type'] in WALL_HUG:
            still.pop(); it['_px'] = [cx - di * G, cy - dj * G, th]; moved and moved[-1][0] == it['type'] and moved.pop(); continue
        for jj, ii in mark: occG[jj.clip(0, gh2 - 1), ii.clip(0, gw2 - 1)] = True
        if it['type'] in ('desk', 'dining', 'table', 'round-table'):
            for jj, ii in mark: lowG[jj.clip(0, gh2 - 1), ii.clip(0, gw2 - 1)] = True
        if shrink < 1: moved.append((it['type'] + f' 폭 {int(shrink * 100)}%', 0))
        break
      if it['type'] == 'dining': it['chairsLocal'] = keep_chairs; it['chairs'] = len(keep_chairs)
    if moved: print(f"  가구 자리 정리: {len(moved)}개 옮김 — " + ', '.join(f'{t} {m}m' for t, m in moved))
    if dropped: print(f'  가구 자리 정리: 벽·문 앞·가구와 겹치는 식탁 의자 {len(dropped)}개를 뺌')
    if still: print('  경고: 옮겨도 벽에 겹치는 가구 → plan.json에서 자리·크기를 고치세요: ' + ', '.join(f'{t}({x},{z})' for t, x, z in still))
    solids = []; box_owner = []
    for fi, it in enumerate(furn):
        if it['type'] in FLAT: continue
        cx, cy, th = it['_px']
        for p in parts_of(it, cx, cy, th):
            if p[0] == 'chair' and [round(p[6][0], 3), round(p[6][1], 3), p[6][2]] not in it.get('chairsLocal', []): continue
            solids.append({'kind': p[0], 'of': fi, 'x': round((p[1][0] - gx0) / ppm, 3), 'z': round((p[1][1] - gy0) / ppm, 3), 'w': p[2], 'd': p[3], 'rot': it['rot'], 'y0': p[4], 'y1': p[5]})
        boxes.append((cx, cy, th, it['w'], it['d'])); box_owner.append(fi)
        for ch in it.get('chairsLocal', []):
            lx, lz = ch[0], ch[1]; box_owner.append(fi); boxes.append((cx + (lx * math.cos(th) + lz * math.sin(th)) * ppm, cy + (-lx * math.sin(th) + lz * math.cos(th)) * ppm, th, 0.48, 0.5))
    for it in furn: it.pop('_px', None)
    # 걷기 칸: 원래 벽(틈은 지나감) 밖 · 바깥 아님 · 몸 반폭만큼 떨어진 곳.
    # 사람 몸 폭만큼 떨어져 걷는다 → 벽 0.35m · 가구 0.3m.
    # 문·트임·미닫이 틈 둘레(틈 양옆 0.7m 안)는 0.25m로 줄여 0.8m 문을 지나갈 수 있게 둔다.
    # 열린 문짝(경첩 = 틈 a 끝, 걷기 칸이 많은 쪽으로 85°)도 벽처럼 피한다(house.js와 같은 자리).
    # 창(window) 틈은 걷는 길에서는 벽이다. 안쪽 창(침실–발코니 등)을 빼 두면 길이 창을 그대로 통과하고, 창 앞에서 몸이 창턱에 묻힌다
    Wn = W | raster([gap_rect(g) for g in keep if g['type'] == 'window'], shape)
    base = ~Wn & ~outside
    edt = ndi.distance_transform_edt(base)
    yy_, xx_ = np.mgrid[0:shape[0], 0:shape[1]]
    zone = np.zeros(shape, bool)
    for g in keep:
        if g['type'] not in ('door', 'open', 'slide'): continue
        x0, y0, x1, y1 = gap_rect(g, 0.7 * ppm)  # 틈을 따라 문 폭만큼 · 가로질러 양옆 0.7m
        zone[max(0, int(y0)):int(y1) + 1, max(0, int(x0)):int(x1) + 1] = True
    def seg_dist(x0, y0, x1, y1):
        dx, dy = x1 - x0, y1 - y0
        t = np.clip(((xx_ - x0) * dx + (yy_ - y0) * dy) / max(dx * dx + dy * dy, 1e-6), 0, 1)
        return np.hypot(xx_ - x0 - t * dx, yy_ - y0 - t * dy)

    def leaf_seg(g, side, hinge, open_=85):  # house.js와 같은 자리: 경첩 a(또는 b) 끝에서 side 쪽으로 open_° 열린 문짝
        horiz = g['o'] == 'h'; base = 0 if horiz else -math.pi / 2; L = (g['len'] - 0.1) * ppm; rad = math.radians(open_) * 1.48 / math.radians(85)
        if hinge == 'b':
            hx, hy = (g['b'][0] - 0.05 * ppm, g['b'][1]) if horiz else (g['b'][0], g['b'][1] - 0.05 * ppm); ang = base + math.pi - side * rad
        else:
            hx, hy = (g['a'][0] + 0.05 * ppm, g['a'][1]) if horiz else (g['a'][0], g['a'][1] + 0.05 * ppm); ang = base + side * rad
        if open_ > 120:  # 활짝 열면 경첩을 벽 면으로 옮겨 문짝이 벽에 붙는다
            nx, ny = ((0, -side) if horiz else (side, 0)); k = g['t'] / 2 + 0.025 * ppm
            hx, hy = hx + nx * k, hy + ny * k
        return hx, hy, hx + math.cos(ang) * L, hy - math.sin(ang) * L  # three.js rotation.y: 지역 +x → (cos, -sin)

    def on_wall(g, side, lf):  # 활짝 연 문짝 뒤가 벽인지(틈·모서리 밖으로 뜨지 않게)
        horiz = g['o'] == 'h'; nx, ny = ((0, -side) if horiz else (side, 0)); k = g['t'] / 2 + 0.03 * ppm
        pts = [(lf[0] + (lf[2] - lf[0]) * t - nx * k, lf[1] + (lf[3] - lf[1]) * t - ny * k) for t in np.linspace(0.1, 1, 10)]
        return sum(0 <= int(y) < shape[0] and 0 <= int(x) < shape[1] and W[int(y), int(x)] for x, y in pts) >= 9
    # 문 여는 쪽: plan.json swings/hinges > 현관문은 바깥으로 > 방문은 복도·현관·거실이 아닌 방 안으로 > 걷기 칸을 덜 막는 쪽.
    # 경첩은 문짝이 걷기 칸을 덜 막는 끝(벽 모서리 쪽)에 둔다.
    SW, HG = P.get('swings', {}), P.get('hinges', {})
    PASS = {'hall', 'entry', 'living'}
    strict0 = edt > 0.35 * ppm
    fmask = np.zeros(shape, bool)  # 가구 바닥 자리(문짝이 가구를 뚫지 않게)
    for cx, cy, th, w, d in boxes:
        lx = (xx_ - cx) * math.cos(th) - (yy_ - cy) * math.sin(th); lz = (xx_ - cx) * math.sin(th) + (yy_ - cy) * math.cos(th)
        fmask |= (np.abs(lx) <= w / 2 * ppm) & (np.abs(lz) <= d / 2 * ppm)
    door_zone = {}
    for g in keep:
        if g['type'] not in ('door', 'open', 'slide'): continue
        x0, y0, x1, y1 = gap_rect(g, 0.45 * ppm); zm = np.zeros(shape, bool)
        zm[max(0, int(y0)):int(y1) + 1, max(0, int(x0)):int(x1) + 1] = True; door_zone[g['id']] = zm
    leaves = []
    for g in keep:
        if g['type'] != 'door': continue
        horiz = g['o'] == 'h'
        mx, my = (g['a'][0] + g['b'][0]) / 2, (g['a'][1] + g['b'][1]) / 2
        off = g['t'] / 2 + 0.35 * ppm
        def side_info(sd):  # sd=+1: 가로 틈 -z 쪽 · 세로 틈 +x 쪽(house.js side 정의)
            px, py = (mx, my - sd * off) if horiz else (mx + sd * off, my)
            ins = 0 <= int(py) < shape[0] and 0 <= int(px) < shape[1]
            k = roomlab[int(py), int(px)] if ins else 0
            return (bool(outside[int(py), int(px)]) if ins else True), (rooms_in[k - 1].get('type') if k else None)
        sides = [1, -1]
        if g['id'] in SW: sides = [SW[g['id']]]
        elif g['exterior']: sides = [sd for sd in (1, -1) if side_info(sd)[0]] or sides
        else:
            rm = [sd for sd in (1, -1) if side_info(sd)[1] not in PASS and side_info(sd)[1] is not None]
            if len(rm) == 1: sides = rm
        hinges = [HG[g['id']]] if g['id'] in HG else ['a', 'b']
        opens = [P.get('doorOpen', {})[g['id']]] if g['id'] in P.get('doorOpen', {}) else ([175, 85] if g['exterior'] else [85, 175])  # 현관문은 계단실 벽에 붙게 활짝
        best = None
        for op in opens:
            if best and best[0] < 10 ** 6: break  # 85°로 문제없으면 그대로
            for sd in sides:
                for hg in hinges:
                    lf = leaf_seg(g, sd, hg, op)
                    if op > 120 and not on_wall(g, sd, lf): continue
                    sdist = seg_dist(*lf)
                    loss = int((strict0 & (sdist < 0.3 * ppm)).sum())
                    loss += 10 ** 7 * int((fmask & (sdist < 0.03 * ppm)).any())  # 가구를 뚫음
                    loss += 10 ** 6 * sum(int((zm & (sdist < 0.25 * ppm)).any()) for k, zm in door_zone.items() if k != g['id'])  # 다른 문 앞을 막음
                    if best is None or loss < best[0]: best = (loss, sd, hg, lf, op)
        if best is None:  # 활짝(>120°)만 허용됐는데 문짝 뒤가 벽인 자리가 없음 → 85°로 되돌린다
            print(f"  경고: {g['id']} 문을 {opens[0]}°로 벽에 붙일 자리가 없어 85°로 엽니다(plan.json doorOpen 확인)")
            for sd in sides:
                for hg in hinges:
                    lf = leaf_seg(g, sd, hg, 85); sdist = seg_dist(*lf)
                    loss = int((strict0 & (sdist < 0.3 * ppm)).sum())
                    loss += 10 ** 7 * int((fmask & (sdist < 0.03 * ppm)).any())
                    loss += 10 ** 6 * sum(int((zm & (sdist < 0.25 * ppm)).any()) for k, zm in door_zone.items() if k != g['id'])
                    if best is None or loss < best[0]: best = (loss, sd, hg, lf, 85)
        g['swing'], g['hinge'], g['open'] = best[1], best[2], best[4]
        leaves.append(best[3])
    for lf in leaves: solids.append({'kind': 'leaf', 'a': [round(v, 3) for v in M((lf[0], lf[1]))], 'b': [round(v, 3) for v in M((lf[2], lf[3]))], 'y0': 0.0, 'y1': 2.07})
    leaf_d = np.full(shape, 1e9, np.float32)
    for lf in leaves: leaf_d = np.minimum(leaf_d, seg_dist(*lf))

    def make_walk(cl):
        need = np.where(zone, cl['door'], cl['wall']) * ppm
        wk = (edt > need) & (leaf_d > cl['door'] * ppm)
        for cx, cy, th, w, d in boxes:  # 가구 자리 빼기(문 둘레에서는 문 여유만큼만)
            ys_, xs_ = np.mgrid[int(cy - 3 * ppm):int(cy + 3 * ppm), int(cx - 3 * ppm):int(cx + 3 * ppm)]
            ok = (ys_ >= 0) & (ys_ < shape[0]) & (xs_ >= 0) & (xs_ < shape[1])
            ys_, xs_ = ys_[ok], xs_[ok]
            lx = (xs_ - cx) * math.cos(th) - (ys_ - cy) * math.sin(th); lz = (xs_ - cx) * math.sin(th) + (ys_ - cy) * math.cos(th)
            fp = np.where(zone[ys_, xs_], cl['door'], cl['furniture']) * ppm
            inside = (np.abs(lx) <= w / 2 * ppm + fp) & (np.abs(lz) <= d / 2 * ppm + fp)
            wk[ys_[inside], xs_[inside]] = False
        return wk
    CL = {'wall': 0.35, 'door': 0.25, 'furniture': 0.3, **P.get('clearance', {})}
    LOOSE = [{'wall': 0.25, 'door': 0.2, 'furniture': 0.15}, {'wall': 0.18, 'door': 0.14, 'furniture': 0.1}]  # 좁은 욕실·문 앞을 가구가 막는 곳만
    def compute_walk():  # 지금 boxes 로 걷기 칸을 만든다(끊긴 방은 그 방과 문 둘레만 느슨한 여유로)
        walk = make_walk(CL); loosened = {}
        for lv, cl in enumerate(LOOSE):
            walk_l = make_walk(cl)
            for _ in range(4):
                lab4, _n = ndi.label(to_cells(walk))
                if not _n: break
                main = np.argmax(np.bincount(lab4.ravel())[1:]) + 1
                cut = [r for r in rooms if r['type'] != 'closet' and not (r['auto'] and r['area'] < 1.5) and not (to_cells(r['_mask']) & (lab4 == main)).any()]  # 수납칸·1.5㎡ 미만 자동 복도(막다른 틈)는 빼고
                if not cut: break
                for r in cut:
                    reg = ndi.binary_dilation(r['_mask'], iterations=int(0.8 * ppm))
                    walk |= walk_l & (reg | (zone & ndi.binary_dilation(r['_mask'], iterations=int(1.0 * ppm))))
                    loosened[r['name']] = cl
        return walk, loosened
    # ---- 돌아가는 길 없애기: 방 사이 길이 가구 없는 집보다 1.35배 + 1m 넘게 길면(예: 식탁이 통로를 막아 발코니로 돌아감)
    # 그 길을 가장 많이 줄여 주는 식탁·탁자를 뺀다. 식탁·탁자를 빼도 안 줄면 경고만 한다(조리대·붙박이장 등은 plan.json에서 옮긴다)
    import heapq
    def dist_maps(walkmask, pts):
        g = to_cells(walkmask); out = []
        for (ci, cj) in pts:
            # 가장 가까운 걷는 칸에서 시작
            if not g[cj, ci]:
                jj, ii = np.where(g); k = np.argmin((ii - ci) ** 2 + (jj - cj) ** 2) if len(ii) else None
                if k is None: out.append(None); continue
                ci, cj = int(ii[k]), int(jj[k])
            D = np.full(g.shape, np.inf); D[cj, ci] = 0; q = [(0.0, ci, cj)]
            while q:
                d0, i, j = heapq.heappop(q)
                if d0 > D[j, i]: continue
                for di, dj, w_ in ((1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1), (1, 1, 1.414), (1, -1, 1.414), (-1, 1, 1.414), (-1, -1, 1.414)):
                    ni, nj = i + di, j + dj
                    if not (0 <= ni < g.shape[1] and 0 <= nj < g.shape[0]) or not g[nj, ni]: continue
                    if di and dj and (not g[j, ni] or not g[nj, i]): continue
                    if d0 + w_ < D[nj, ni]: D[nj, ni] = d0 + w_; heapq.heappush(q, (d0 + w_, ni, nj))
            out.append((D, (ci, cj)))
        return g, out
    def legs_cost(walkmask, pts, pairs):  # 방 쌍마다 걷는 거리(m). 못 가면 inf
        g, maps = dist_maps(walkmask, pts); res = {}
        for a_, b_ in pairs:
            if maps[a_] is None or maps[b_] is None: res[(a_, b_)] = math.inf; continue
            D = maps[a_][0]; ti, tj = maps[b_][1]; res[(a_, b_)] = float(D[tj, ti]) * 0.1
        return res
    boxes_all, owner_all = list(boxes), list(box_owner)
    boxes = []; walk0, _ = compute_walk(); boxes = list(boxes_all)   # 가구 없는 집
    main_rooms = [r for r in rooms if r['type'] != 'closet' and not (r['auto'] and r['area'] < 1.5)]
    pts = []
    for r in main_rooms:  # 방 대표점 = 가구 없는 집에서 벽에서 가장 먼 곳
        m = r['_mask'] & walk0
        if m.sum() < 20: m = r['_mask']
        dd = ndi.distance_transform_edt(m); iy, ix = np.unravel_index(np.argmax(dd), dd.shape)
        pts.append((min(gw - 1, int((ix - gx0) / cell)), min(gh - 1, int((iy - gy0) / cell))))
    pairs = [(i, j) for i in range(len(main_rooms)) for j in range(i + 1, len(main_rooms))]
    base = legs_cost(walk0, pts, pairs)
    def excess(costs): return sum((1000 if math.isinf(c) else c - base[k]) for k, c in costs.items() if not math.isinf(base[k]) and (math.isinf(c) or c > base[k] * 1.35 + 1.0))
    walk, loosened = compute_walk()
    cur = legs_cost(walk, pts, pairs); removed_tables = []
    for _ in range(4):
        ex = excess(cur)
        if ex <= 0: break
        cands = [fi for fi, it in enumerate(furn) if it['type'] in ('dining', 'table') and fi in owner_all and fi not in removed_tables]
        best = None
        for fi in cands:
            boxes = [b for b, o in zip(boxes_all, owner_all) if o != fi and o not in removed_tables]
            w2, l2 = compute_walk(); c2 = legs_cost(w2, pts, pairs); e2 = excess(c2)
            if e2 < ex - 0.5 and (best is None or e2 < best[0]): best = (e2, fi, w2, l2, c2)
        if best is None: break
        _, fi, walk, loosened, cur = best; removed_tables.append(fi)
    boxes = [b for b, o in zip(boxes_all, owner_all) if o not in removed_tables]
    if removed_tables:
        print('  돌아가는 길 정리: 통로를 막아 방 사이를 돌아가게 하던 ' + ', '.join(f"{furn[fi]['type']}({furn[fi]['x']},{furn[fi]['z']})" for fi in removed_tables) + ' 를 뺌')
        keep_idx = [fi for fi in range(len(furn)) if fi not in removed_tables]; remap = {old: new for new, old in enumerate(keep_idx)}
        solids = [dict(so, of=remap[so['of']]) if 'of' in so else so for so in solids if so.get('of') not in removed_tables]  # 문짝(leaf)은 가구 번호가 없다
        furn = [furn[fi] for fi in keep_idx]
    left = [(main_rooms[a_]['name'], main_rooms[b_]['name'], round(c, 1), round(base[(a_, b_)], 1)) for (a_, b_), c in cur.items() if not math.isinf(base[(a_, b_)]) and (math.isinf(c) or c > base[(a_, b_)] * 1.35 + 1.0)]
    if left: print('  경고: 아직 돌아가는 길 → 통로를 막는 가구(조리대·장 등)를 plan.json에서 옮기세요: ' + ', '.join(f'{a_}↔{b_} {c}m(가구 없으면 {b0}m)' for a_, b_, c, b0 in left[:6]))
    for nm, cl in loosened.items(): print(f"  좁아서 여유를 줄인 곳: {nm} (벽 {cl['wall']}m · 가구 {cl['furniture']}m) → 화면에서 몸이 벽에 묻히지 않는지 본다")
    navc = to_cells(walk)
    # ---- 3. 카메라 칸: 벽·키 큰 물체(1.2m 넘게 올라오는 가구 본체·상부장·문짝)에서 0.15m 떨어진 건물 안 칸. 카메라는 이 칸 밖으로 못 나간다
    tall = np.zeros(shape, bool)
    for so in solids:
        if so['y1'] < 1.2: continue
        if so['kind'] == 'leaf':
            (ax, ay), (bx, by) = [(v[0] * ppm + gx0, v[1] * ppm + gy0) for v in (so['a'], so['b'])]; tall |= seg_dist(ax, ay, bx, by) < 0.03 * ppm; continue
        cx_, cy_ = so['x'] * ppm + gx0, so['z'] * ppm + gy0; th_ = math.radians(so['rot'])
        lx = (xx_ - cx_) * math.cos(th_) - (yy_ - cy_) * math.sin(th_); lz = (xx_ - cx_) * math.sin(th_) + (yy_ - cy_) * math.cos(th_)
        tall |= (np.abs(lx) <= so['w'] / 2 * ppm) & (np.abs(lz) <= so['d'] / 2 * ppm)
    camfree = (edt > 0.15 * ppm) & ~ndi.binary_dilation(tall, iterations=max(1, int(0.15 * ppm)))
    camc = to_cells(camfree)
    # 방마다 둘러보기 자리 = 걸을 수 있는 곳 중 벽·가구에서 가장 먼 점, 그리고 방에 붙은 문(문 앞에서 방 안을 보는 방향)
    for r in rooms:
        m = r['_mask'] & walk
        if m.sum() < 20: m = r['_mask']
        dist = ndi.distance_transform_edt(m)
        iy, ix = np.unravel_index(np.argmax(dist), dist.shape)
        r['center'] = [round(v, 2) for v in M((ix, iy))]
        r['doors'] = []
    for g in keep:
        if g['type'] not in ('door', 'open', 'slide'): continue
        mx, my = (g['a'][0] + g['b'][0]) / 2, (g['a'][1] + g['b'][1]) / 2
        nx, ny = (0, 1) if g['o'] == 'h' else (1, 0)
        off = g['t'] / 2 + 0.35 * ppm
        for sgn in (1, -1):
            px, py = int(mx + sgn * nx * off), int(my + sgn * ny * off)
            if not (0 <= py < shape[0] and 0 <= px < shape[1]): continue
            k = roomlab[py, px]
            if k and k - 1 < len(rooms_in):
                rr = next((r for r in rooms if r['name'] == rooms_in[k - 1]['name']), None)
                if rr is not None: rr['doors'].append({'at': [round(v, 2) for v in M((mx, my))], 'in': [sgn * nx, sgn * ny], 'type': g['type'], 'id': g['id']})
    # 출발점·순서
    start = P.get('start')
    if start: start = M(start)
    else:
        e = next((r for r in rooms if r['type'] == 'entry'), rooms[0] if rooms else None)
        start = e['center'] if e else [1, 1]
    tour = P.get('tour') or [r['name'] for r in sorted(rooms, key=lambda r: (DEFAULT_TOUR_ORDER.index(r['type']) if r['type'] in DEFAULT_TOUR_ORDER else 99, -r['area'])) if not r['auto'] and r['type'] not in ('hall', 'closet')]
    # 발코니와 방 사이 트임(open, 따로 적지 않은 것) = 유리 미닫이. 트임으로 두면 벽 없이 마루·발코니 타일이 비스듬히 만나 계단 톱니가 됐다
    for g in keep:
        if g['type'] != 'open' or g['id'] in P.get('openings', {}) or g.get('manual'): continue
        mx, my = (g['a'][0] + g['b'][0]) / 2, (g['a'][1] + g['b'][1]) / 2; n = (0, 1) if g['o'] == 'h' else (1, 0); d = g['t'] / 2 + 0.4 * ppm
        kinds = []
        for sg in (1, -1):
            px, py = int(mx + n[0] * sg * d), int(my + n[1] * sg * d)
            if 0 <= py < shape[0] and 0 <= px < shape[1]:
                k = roomlab[py, px]
                if k and k - 1 < len(rooms_in): kinds.append(rooms_in[k - 1].get('type'))
        if len(kinds) == 2 and kinds.count('balcony') == 1: g['type'] = 'slide'; print(f"  {g['id']}: 발코니와 방 사이 트임 → 미닫이")
    openings = []
    for g in keep:
        openings.append({'id': g['id'], 'type': g['type'], 'exterior': g['exterior'],
                         'a': [round(v, 3) for v in M(g['a'])], 'b': [round(v, 3) for v in M(g['b'])], 't': round(g['t'] / ppm, 3),
                         'sill': P.get('sills', {}).get(g['id']), 'arch': g['id'] in P.get('arches', []), 'swing': g.get('swing'), 'hinge': g.get('hinge'), 'open': g.get('open')})
    walls = []
    for s in segs:
        walls.append({'a': [round(v, 3) for v in M(s['a'])], 'b': [round(v, 3) for v in M(s['b'])], 't': round(s['t'] / ppm, 3), 'o': s['o']})
    # 바깥벽 표시(벽 한쪽이 바깥)
    for wl, s in zip(walls, segs):
        mx, my = (s['a'][0] + s['b'][0]) / 2, (s['a'][1] + s['b'][1]) / 2; off = s['t'] / 2 + 3
        pts = [(mx, my - off), (mx, my + off)] if s['o'] == 'h' else [(mx - off, my), (mx + off, my)]
        wl['ext'] = any(0 <= int(y) < shape[0] and 0 <= int(x) < shape[1] and outside[int(y), int(x)] for x, y in pts)
    # 곡선 벽: 안쪽 방(오목한 쪽 → 볼록한 쪽 순으로 처음 만나는 방)·바깥 여부·유리 여부(발코니 바깥면은 다른 벽처럼 전면 유리)
    arcs_out = []
    for arc in ARCS:
        ux, uy, r, a0, span = arc_geom(arc); t = arc['_t']; am = a0 + span / 2
        side = lambda dr: (int(uy + (r + dr) * math.sin(am)), int(ux + (r + dr) * math.cos(am)))
        room, ext = None, False
        for dr in (-(t / 2 + 0.3 * ppm), t / 2 + 0.3 * ppm):
            py, px = side(dr)
            if not (0 <= py < shape[0] and 0 <= px < shape[1]): ext = True; continue
            if outside[py, px]: ext = True
            k = roomlab[py, px]
            if k and room is None: room = rooms_in[k - 1]
        glass = arc.get('type', 'glass' if room and room.get('type') == 'balcony' else 'wall') == 'glass'
        arcs_out.append({'c': [round(v, 3) for v in M((ux, uy))], 'r': round(r / ppm, 3), 'a0': round(a0, 4), 'span': round(span, 4),
                         't': round(t / ppm, 3), 'glass': glass, 'ext': ext, 'room': room['name'] if room else None})
    # 전후 비교(인테리어 교체): navAnd = 다른 장면(같은 집의 '전')의 scene.json. 두 장면 모두에서 걸을 수 있는 칸만 남긴다
    # (비교 화면에서 '후' 쪽 걷는 자리가 '전' 가구를 뚫고 지나가지 않게)
    if P.get('navAnd'):
        other = json.loads((work / P['navAnd']).read_text(encoding='utf-8'))
        for key, arr in (('nav', navc), ('camNav', camc)):
            rows = other[key]['rows']
            if len(rows) == arr.shape[0] and len(rows[0]) == arr.shape[1]: arr &= np.array([[c == '1' for c in r] for r in rows])
            else: print(f'  경고: navAnd 장면의 {key} 크기가 달라 합치지 않음(같은 집인지 확인)')
    size = [round((bbox[2] - bbox[0]) / ppm, 2), round((bbox[3] - bbox[1]) / ppm, 2)]
    scene = {
        'version': 1, 'name': P.get('name') or pj.stem, 'wallHeight': P.get('wallHeight', 2.3), 'view': P.get('view', 'forest'), 'wallColor': P.get('wallColor'),
        'size': size, 'walls': walls, 'arcs': arcs_out, 'openings': openings,
        'rooms': [{k: v for k, v in r.items() if not k.startswith('_')} for r in rooms],
        'furniture': furn, 'start': [round(v, 2) for v in start], 'tour': tour,
        'nav': {'cell': 0.1, 'w': int(navc.shape[1]), 'h': int(navc.shape[0]), 'rows': [''.join('1' if v else '0' for v in row) for row in navc]},
        'camNav': {'cell': 0.1, 'w': int(camc.shape[1]), 'h': int(camc.shape[0]), 'rows': [''.join('1' if v else '0' for v in row) for row in camc]},
        'solids': solids, 'style': P.get('style') or {}, 'exterior': P.get('exterior', '3d'), 'floorLevel': P.get('floorLevel', 2),
        'bare': bool(P.get('bare')), 'areaWarn': area_warn, 'areaNote': P.get('areaNote'), 'corridor': P.get('corridor', True),  # corridor false = 단독주택(현관 밖 아파트 계단실 없음)
        'plan': {'image': 'plan.png', 'ppm': ppm, 'origin': [gx0, gy0], 'size': [im.width, im.height]},
    }
    (work / 'scene.json').write_text(json.dumps(scene, ensure_ascii=False), encoding='utf-8')
    # ---- 검사 그림 ----
    base = Image.blend(im, Image.new('RGB', im.size, 'white'), 0.6)
    ov = Image.new('RGBA', im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    f = font(max(15, im.width // 95)); fs = font(max(12, im.width // 140))
    PAL = {'living': (255, 180, 120), 'kitchen': (255, 220, 120), 'bedroom': (160, 200, 255), 'bath': (130, 220, 220), 'entry': (210, 190, 160),
           'balcony': (190, 230, 160), 'dress': (220, 180, 240), 'hall': (220, 220, 220), 'office': (200, 210, 160), 'utility': (200, 200, 200), 'outdoor': (170, 220, 170)}
    for r in rooms:
        c = PAL.get(r['type'], (200, 200, 200)); m = r['_mask']
        layer = np.zeros((*shape, 4), np.uint8); layer[m] = (*c, 110)
        ov = Image.alpha_composite(ov, Image.fromarray(layer))
    d = ImageDraw.Draw(ov)
    for s in segs: d.rectangle(seg_rect(s), fill=(60, 60, 60, 200))
    if ARCS:
        am_ = np.zeros(shape, bool)
        for arc in ARCS: am_ |= arc_mask(arc, shape, arc['_t'])
        layer = np.zeros((*shape, 4), np.uint8); layer[am_] = (60, 60, 60, 200)
        ov = Image.alpha_composite(ov, Image.fromarray(layer)); d = ImageDraw.Draw(ov)
    GC = {'door': (230, 80, 50), 'window': (40, 130, 230), 'slide': (20, 170, 200), 'open': (150, 150, 150), 'none': (0, 0, 0)}
    for g in keep:
        d.rectangle(gap_rect(g), fill=(*GC.get(g['type'], (255, 0, 255)), 220))
        mx, my = (g['a'][0] + g['b'][0]) / 2, (g['a'][1] + g['b'][1]) / 2
        d.text((mx + 5, my + 5), f"{g['id']} {g['type']}", fill=(*GC.get(g['type'], (0, 0, 0)), 255), font=fs)
    for it in furn:
        th = math.radians(it['rot']); cx = it['x'] * ppm + gx0; cy = it['z'] * ppm + gy0
        hw, hd = it['w'] / 2 * ppm, it['d'] / 2 * ppm
        pts = [(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)]
        poly = [(cx + px * math.cos(th) + pz * math.sin(th), cy - px * math.sin(th) + pz * math.cos(th)) for px, pz in pts]
        d.polygon(poly, outline=(120, 40, 160, 255), width=3)
        d.line([(cx, cy), (cx + math.sin(th) * hd * 1.3, cy + math.cos(th) * hd * 1.3)], fill=(120, 40, 160, 255), width=3)
        d.text((cx + 4, cy - 16), it['type'], fill=(90, 20, 130, 255), font=fs)
    sx, sy = start[0] * ppm + gx0, start[1] * ppm + gy0
    d.ellipse([sx - 12, sy - 12, sx + 12, sy + 12], fill=(255, 126, 95, 255))
    out = Image.alpha_composite(base.convert('RGBA'), ov)
    d = ImageDraw.Draw(out)
    for r in rooms:
        cx, cy = r['center'][0] * ppm + gx0, r['center'][1] * ppm + gy0
        txt = f"{r['name']} {r['area']:.1f}㎡" + (f" (표기 {r['stated']})" if r.get('stated') else '')
        d.text((cx - 60, cy - 10), txt, fill=(10, 10, 10), font=f)
    out.convert('RGB').save(work / 'check.png')
    # ---- 대조표 ----
    print(f'축척 {ppm:.1f}px/m · 건물 {size[0]}×{size[1]}m · 벽 {len(walls)} · 틈 {len(keep)} · 방 {len(rooms)} · 가구 {len(furn)}')
    ratios = []
    for r in rooms:
        s = r.get('stated'); diff = ''
        grp = [g for g in groups.values() if len(g) > 1 and r in g]
        if s and grp: diff = f"  표기 {s} (이어진 공간이라 합계로 비교)"
        elif s: ratios.append(r['cmp'] / s); dd = abs(r['cmp'] / s - 1); diff = f"  비교 {r['cmp']:.2f}㎡ · 표기 {s} → {(r['cmp'] / s - 1) * 100:+.1f}% {'✓' if dd <= 0.05 else '△ 확인 필요' if dd <= 0.10 else '✗'}"
        print(f"  방 {r['name']:<8} {r['type']:<8} {r['area']:6.2f}㎡{diff}")
    if ratios:
        med = float(np.median(ratios))
        print(f'  면적 비율 중앙값 {med:.2f}' + (f' → 축척이 맞지 않을 수 있음(길이 {math.sqrt(med):.3f}배 차이)' if abs(med - 1) > 0.12 else ' (정상 범위)'))
    print('  틈: ' + ', '.join(f"{g['id']}={g['type']}({g['len']:.2f}m{'·바깥' if g['exterior'] else ''})" for g in keep))
    leak = [r['name'] for r in rooms if r['_mask'].sum() == 0]
    if leak: print('  경고: 비어 있는 방(이름 점이 바깥에 있음?): ' + ', '.join(leak))
    print(f'장면: {work / "scene.json"}\n검사 그림: {work / "check.png"}')


def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest='cmd', required=True)
    w = sub.add_parser('walls'); w.add_argument('image'); w.add_argument('--out', required=True); w.add_argument('--dark', type=float, default=100); w.add_argument('--thick', type=int, default=0)
    b = sub.add_parser('build'); b.add_argument('plan'); b.add_argument('--bare', action='store_true', help='구조만(기본값 — 적지 않아도 같다)'); b.add_argument('--furnished', action='store_true', help='가구까지 넣는다'); b.add_argument('--drop', default='', help='구조만에서 뺄 설비 종류(쉼표)')
    a = ap.parse_args()
    {'walls': cmd_walls, 'build': cmd_build}[a.cmd](a)


if __name__ == '__main__':
    main()
