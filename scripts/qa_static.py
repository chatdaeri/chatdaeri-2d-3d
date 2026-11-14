#!/usr/bin/env python3
"""scene.json 도면 검사(tour.py make 의 2/4 단계): 가구 부품(의자·상부장 포함)이 벽·다른 가구에 들어갔는지, 문 앞을 막는지,
벽 두께, 출발점에서 모든 방에 갈 수 있는지, 카메라 칸이 걷는 칸을 모두 덮는지.
  python3 -I qa_static.py <scene.json>   → 통과면 종료 코드 0, 실패면 1(무엇이 왜 안 되는지 목록)
"""
import sys as _sys  # Windows 콘솔·파이프에서도 한글 출력이 깨지거나 멈추지 않게
for _st in (_sys.stdout, _sys.stderr):
    if hasattr(_st, 'reconfigure'): _st.reconfigure(encoding='utf-8', errors='replace')
import json, math, sys
from collections import deque

S = json.load(open(sys.argv[1], encoding='utf-8'))
fails, warns = [], []


def rect_pts(s, step=0.02, shrink=0.03):  # 돌린 상자 안쪽 점들(가장자리 3cm 안쪽)
    r = math.radians(s['rot']); c, sn = math.cos(r), math.sin(r)
    w, d = s['w'] / 2 - shrink, s['d'] / 2 - shrink
    nx, nz = max(1, int(2 * w / step)), max(1, int(2 * d / step))
    for i in range(nx + 1):
        for j in range(nz + 1):
            lx, lz = -w + 2 * w * i / nx, -d + 2 * d * j / nz
            yield s['x'] + lx * c + lz * sn, s['z'] - lx * sn + lz * c


def in_rot(s, x, z, pad=0.0):
    r = math.radians(s['rot']); dx, dz = x - s['x'], z - s['z']
    lx = dx * math.cos(r) - dz * math.sin(r); lz = dx * math.sin(r) + dz * math.cos(r)
    return abs(lx) <= s['w'] / 2 + pad and abs(lz) <= s['d'] / 2 + pad


walls = []
for w in S['walls']:
    t = w['t'] / 2; xs = sorted([w['a'][0], w['b'][0]]); zs = sorted([w['a'][1], w['b'][1]])
    walls.append((xs[0] - (t if w['o'] == 'v' else 0), zs[0] - (t if w['o'] == 'h' else 0), xs[1] + (t if w['o'] == 'v' else 0), zs[1] + (t if w['o'] == 'h' else 0)))
    if not 0.095 <= w['t'] <= 0.305: fails.append(f"벽 두께 {w['t']:.2f}m (0.10~0.30 밖) {w['a']}→{w['b']}")
def in_arc(x, z):  # 곡선 벽(scene.arcs) 띠 안인가
    for A in S.get('arcs', []):
        d = math.hypot(x - A['c'][0], z - A['c'][1]); ang = (math.atan2(z - A['c'][1], x - A['c'][0]) - A['a0']) % (2 * math.pi)
        if abs(d - A['r']) < A['t'] / 2 and ang <= A['span']: return True
    return False
in_wall = lambda x, z: any(x0 < x < x1 and z0 < z < z1 for x0, z0, x1, z1 in walls) or in_arc(x, z)

solids = [s for s in S.get('solids', []) if s['kind'] != 'leaf']
if 'solids' not in S or (not solids and not S.get('bare')): fails.append('scene.solids 가 없음(plan.py build 로 만든 scene.json 인지 확인)')  # 구조만(bare)은 가구가 없어 문짝만 있다
F = S['furniture']
for k, s in enumerate(solids):
    name = f"{F[s['of']]['type']}·{s['kind']}"
    bad = sum(in_wall(x, z) for x, z in rect_pts(s, shrink=0.05))  # 벽 속 5cm까지는 벽에 가려 보이지 않으니 허용
    if bad > 3: fails.append(f"{name} ({s['x']:.2f},{s['z']:.2f})가 벽 속으로 들어감(점 {bad}개)")
    for s2 in solids[k + 1:]:
        if s2['of'] == s['of']: continue  # 같은 가구의 부품끼리(식탁과 의자)는 겹쳐도 된다
        ts = {F[s['of']]['type'], F[s2['of']]['type']}
        if ts & {'chair', 'shell-chair', 'office-chair'} and ts & {'desk', 'dining', 'table', 'round-table'}: continue  # 의자는 책상·식탁 밑으로 들어간다
        if s['y1'] <= s2['y0'] or s2['y1'] <= s['y0']: continue  # 높이가 안 겹치면(상부장 아래 의자 등) 괜찮다
        ov = sum(in_rot(s2, x, z) for x, z in rect_pts(s))
        if ov > 3: fails.append(f"{name}와 {F[s2['of']]['type']}·{s2['kind']}가 겹침 ({s['x']:.2f},{s['z']:.2f})")
# 문 앞(문짝 반대편 포함 0.35m)을 가구가 막는가
for o in S['openings']:
    if o['type'] not in ('door', 'slide'): continue
    cx, cz = (o['a'][0] + o['b'][0]) / 2, (o['a'][1] + o['b'][1]) / 2
    horiz = abs(o['a'][1] - o['b'][1]) < 1e-6
    for sg in (1, -1):
        px, pz = (cx, cz + sg * (o['t'] / 2 + 0.25)) if horiz else (cx + sg * (o['t'] / 2 + 0.25), cz)
        for s in solids:
            if s['y0'] < 1.0 and in_rot(s, px, pz): fails.append(f"{o['id']} 문 앞을 {F[s['of']]['type']}·{s['kind']}가 막음")
# 걷기: 출발점에서 모든 방(수납칸·작은 자동 복도 제외)에 닿는가
n = S['nav']; c = n['cell']; g = [[ch == '1' for ch in r] for r in n['rows']]
ok = lambda i, j: 0 <= i < n['w'] and 0 <= j < n['h'] and g[j][i]
def nearest(x, z):
    i0, j0 = int(x // c), int(z // c)
    for r in range(0, 40):
        for dj in range(-r, r + 1):
            for di in range(-r, r + 1):
                if max(abs(di), abs(dj)) == r and ok(i0 + di, j0 + dj): return i0 + di, j0 + dj
s0 = nearest(*S['start']); seen = {s0}; q = deque([s0])
while q:
    i, j = q.popleft()
    for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        if ok(i + di, j + dj) and (i + di, j + dj) not in seen: seen.add((i + di, j + dj)); q.append((i + di, j + dj))
for r in S['rooms']:
    if r['type'] == 'closet' or (r.get('auto') and r['area'] < 1.5): continue
    cells = [(i, j) for x0, z0, x1, z1 in r['rects'] for j in range(int(z0 / c), int(math.ceil(z1 / c))) for i in range(int(x0 / c), int(math.ceil(x1 / c)))]
    if not any(p in seen for p in cells): fails.append(f"{r['name']}에 갈 수 없음")
# 돌아가는 길: 투어 순서대로 걸을 때, 출발·도착이 아닌 발코니를 거쳐 가면 실패(식탁 등이 통로를 막은 것)
import heapq
def room_at(x, z):
    for r in S['rooms']:
        if any(x0 <= x <= x1 and z0 <= z <= z1 for x0, z0, x1, z1 in r['rects']): return r
def route(a, b):
    D = {a: 0}; Pv = {}; q = [(0, a)]
    while q:
        d, u = heapq.heappop(q)
        if u == b: break
        if d > D[u]: continue
        for di, dj, w_ in ((1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1), (1, 1, 1.414), (1, -1, 1.414), (-1, 1, 1.414), (-1, -1, 1.414)):
            v = (u[0] + di, u[1] + dj)
            if not ok(*v) or (di and dj and (not ok(u[0] + di, u[1]) or not ok(u[0], u[1] + dj))): continue
            if d + w_ < D.get(v, 1e9): D[v] = d + w_; Pv[v] = u; heapq.heappush(q, (d + w_, v))
    if b not in D: return []
    out = [b]
    while out[-1] != a: out.append(Pv[out[-1]])
    return out
byname = {r['name']: r for r in S['rooms']}; pos = tuple(S['start'])
for nm in S.get('tour', []):
    r = byname.get(nm)
    if not r: continue
    d0 = sorted(r.get('doors', []), key=lambda d: 0 if d['type'] == 'door' else 1)[:1]
    t = (d0[0]['at'][0] - d0[0]['in'][0] * 0.35, d0[0]['at'][1] - d0[0]['in'][1] * 0.35) if d0 and r['area'] < 5 else tuple(r['center'])
    a, b = nearest(*pos), nearest(*t)
    if a and b:
        via = {rr['name'] for i, j in route(a, b) for rr in [room_at((i + .5) * c, (j + .5) * c)] if rr and rr['type'] == 'balcony'}
        ends = {x['name'] for x in (room_at(*pos), room_at(*t), r) if x}
        if via - ends:
            msg = f"{nm}(으)로 갈 때 {', '.join(via - ends)}(으)로 돌아감 — 통로를 막는 가구를 옮기거나 빼야 함"
            if S.get('bare'): print('  경고(구조만): ' + msg.split(' — ')[0] + ' — 집 동선이 원래 그렇다(가구 없음)')  # 구조만은 가구가 없으니 돌아가는 길 = 도면 동선
            else: fails.append(msg)
    pos = t
# 카메라 칸: 걷는 칸 둘레 1.5m 안에 카메라 칸이 있는가(없으면 카메라가 설 곳이 없다)
cn = S.get('camNav')
# 톱니 가장자리: 방 바닥 조각 중 0.1m 한 칸짜리가 3개 넘으면 칸 변환이 어긋났을 수 있다(걸레받이·문턱이 덩어리로 끊겨 보인다).
# 경고만 한다: 기준 3개는 평면도 한 장으로 정한 값이고, 사선·곡선 벽은 원래 계단 모양이라 멀쩡해도 걸린다
for r in S.get('rooms', []):
    tiny = sum(1 for q in r.get('rects', []) if q[2] - q[0] <= 0.11 and q[3] - q[1] <= 0.11)
    if tiny > 3: warns.append(f"{r['name']} 가장자리가 톱니 모양일 수 있음(한 칸짜리 바닥 조각 {tiny}개) — 사선 벽이 아니면 plan.py to_cells 확인")
if not cn: fails.append('scene.camNav 가 없음')
else:
    cg = [[ch == '1' for ch in r] for r in cn['rows']]
    camok = lambda i, j: 0 <= i < cn['w'] and 0 <= j < cn['h'] and cg[j][i]
    lonely = sum(1 for (i, j) in seen if not any(camok(i + di, j + dj) for di in range(-15, 16, 3) for dj in range(-15, 16, 3)))
    if lonely: warns.append(f'카메라 칸이 1.5m 안에 없는 걷는 칸 {lonely}개')
print(f"{S['name']}: 부품 {len(solids)}개 · 벽 {len(walls)}개 · 걷는 칸 {len(seen)}개")
for m in warns: print('  주의:', m)
if fails:
    print(f'  실패 {len(fails)}건'); [print('  -', m) for m in fails[:30]]; sys.exit(1)
print('  통과: 겹침 0 · 문 앞 막힘 0 · 벽 두께 정상 · 모든 방에 갈 수 있음 · 발코니로 돌아가는 길 없음')
