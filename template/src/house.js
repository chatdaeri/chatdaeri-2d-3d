// 집 만들기: scene.json(미터, x 오른쪽 · z 아래 · 원점 = 건물 왼쪽 위) → 벽·문틀·창·바닥·천장·방별 벽 마감
import * as THREE from 'three';
import { texMat, meterUV, TILE, TEX } from './look.js';

const DOOR_H = 2.1, WIN_SILL = 0.9, WIN_HEAD = 2.2, SLIDE_HEAD = 2.25;
// 방 종류별 바닥·벽 마감
const FLOOR = { bath: 'tile', balcony: 'tile', utility: 'tile', entry: 'tile', outdoor: 'tile' };
const LINING = { bath: 'tile', balcony: 'paint', utility: 'paint' };

export class House {
  constructor(scene, S) {
    this.scene = scene; this.S = S;
    this.H = S.wallHeight ?? 2.3;
    this.group = new THREE.Group(); scene.add(this.group);
    this.walls = [];       // 벽 메쉬(카메라 가림·충돌)
    this.extWalls = [];    // 바깥벽(카메라가 집 밖으로 못 나가게)
    this.floors = [];      // 클릭 대상
    this.ceilings = new THREE.Group(); this.group.add(this.ceilings);
    this.doors = [];
    // 벽·천장은 흰 칠(넓어 보이게). 회반죽 사진은 크림색이라 색은 빼고 요철만 쓴다. scene.wallColor로 바꿀 수 있다
    const plasterN = TEX.plaster?.normal;
    const paintMat = (color, bump) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9 }); if (plasterN) { m.normalMap = plasterN; m.normalScale = new THREE.Vector2(bump, bump); } return m; };
    const M = this.mats = {
      paint: paintMat(new THREE.Color(S.wallColor ?? '#FAFAF7'), 0.18),
      cap: new THREE.MeshStandardMaterial({ color: 0x3A3836, roughness: 0.9 }),
      wood: texMat('oakfloor', { roughness: 0.48, bump: 0.3 }),
      porcelain: texMat('porcelain', { roughness: 0.32 }), // scene.style.floor === 'porcelain': 집 전체 큰 타일
      wallPorcelain: texMat('porcelain', { roughness: 0.28 }), // style.bathWall === 'porcelain': 욕실 벽도 같은 큰 타일
      tile: texMat('limestone', { roughness: 0.35, bump: 0.2, color: 0xEDE8E0 }),
      wallTile: texMat('limestone', { roughness: 0.32, bump: 0.15, color: 0xFFFFFF }), // 욕실 벽: 밝은 석회석 타일
      ceiling: paintMat(0xFFFFFF, 0.1),
      base: new THREE.MeshStandardMaterial({ color: 0xD8D0C4, roughness: 0.8 }),
      frame: new THREE.MeshStandardMaterial({ color: 0xE9E7E2, roughness: 0.45, metalness: 0.2 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0xF2F6F5, roughness: 0.04, transparent: true, opacity: 0.12, depthWrite: false, envMapIntensity: 0.22, specularIntensity: 0.35, side: THREE.DoubleSide }), // 반사가 세면 유리에 하늘빛 덩어리가 떠 보였다
      door: S.style?.doors === 'white' ? new THREE.MeshStandardMaterial({ color: 0xF6F5F2, roughness: 0.42 }) : texMat('oak', { roughness: 0.55, bump: 0.2, color: 0xF4ECE0 }), // style.doors 'white' = 흰 도장 문
      skirt: new THREE.MeshStandardMaterial({ color: 0xF2F1EE, roughness: 0.6 }),
    };
    M.ceiling.shadowSide = THREE.DoubleSide;
    // style.tex = { wall, wood, porcelain, ... }: 재질 사진으로 바꾼다(TILE도 그 사진 크기로). 없으면 지금 그대로
    const TX = S.style?.tex ?? {}, has = n => n && TEX[n]?.map;
    if (has(TX.wall)) { const t = TEX[TX.wall]; for (const k of ['paint', 'ceiling']) { const m = M[k]; m.map = t.map; if (t.normal) { m.normalMap = t.normal; m.normalScale = new THREE.Vector2(0.55, 0.55); } m.roughness = 0.93; m.needsUpdate = true; } TILE.plaster = TILE[TX.wall] ?? 2.4; }
    if (has(TX.wood)) { M.wood = texMat(TX.wood, { roughness: 0.5, bump: 0.6 }); TILE.oakfloor = TILE[TX.wood] ?? 1.5; }
    if (has(TX.porcelain)) { M.porcelain = texMat(TX.porcelain, { roughness: 0.34, bump: 0.5 }); M.wallPorcelain = texMat(TX.porcelain, { roughness: 0.3, bump: 0.5 }); TILE.porcelain = TILE[TX.porcelain] ?? 1.2; }
    if (S.style?.woodGrain) { M.wood.normalScale.set(0.75, 0.75); M.wood.roughness = 0.4; } // style.woodGrain: 마루 결을 더 살린다
  }

  build() {
    const S = this.S, H = this.H, M = this.mats;
    // 벽: 옆면 = 칠, 윗면 = 진한 단면(위에서 볼 때 벽선이 또렷하게)
    S.walls.forEach((w0, i) => {
      // 발코니 앞면과 겹치는 구간만 유리로 자르고, 나머지는 벽 그대로(벽 조각 하나가 발코니를 지나 옆방까지 이어지면 옆방 벽까지 유리가 됐다)
      const hz = w0.o === 'h', ax = hz ? 0 : 1, lo0 = Math.min(w0.a[ax], w0.b[ax]), hi0 = Math.max(w0.a[ax], w0.b[ax]), line = hz ? w0.a[1] : w0.a[0];
      const at = v => hz ? [v, line] : [line, v];
      const cuts = this.balconyFronts().filter(f => f.o === w0.o && Math.abs(line - f.line) <= 0.6).map(f => [Math.max(lo0, f.lo - 0.15), Math.min(hi0, f.hi + 0.15)]).filter(([a, b]) => b - a > 0.05).sort((p, q) => p[0] - q[0]);
      const parts = []; let cur = lo0;
      for (const [a, b] of cuts) { if (a > cur + 0.02) parts.push([cur, a, false]); parts.push([Math.max(a, cur), b, true]); cur = Math.max(cur, b); }
      if (hi0 > cur + 0.02) parts.push([cur, hi0, false]);
      for (const [a, b, glass] of parts) {
        const w = { ...w0, a: at(a), b: at(b) }, len = b - a + 0.01;
        if (glass) { this.glassWall(w, len); continue; }
        const tt = w.t + (i % 3) * 0.002; // 이어진 벽끼리 겹친 면이 같은 깊이면 카메라가 움직일 때 줄무늬로 떨린다
        const geo = hz ? new THREE.BoxGeometry(len, H + 0.06, tt) : new THREE.BoxGeometry(tt, H + 0.06, len);
        geo.translate(0, -0.03, 0); // 바닥 아래 6cm까지 내려 틈이 없게
        meterUV(geo, TILE.plaster, [(w.a[0] + w.b[0]) / 2, H / 2, (w.a[1] + w.b[1]) / 2]);
        const m = new THREE.Mesh(geo, [M.paint, M.paint, M.cap, M.paint, M.paint, M.paint].map(x => x === M.cap ? x : x.clone()));
        m.position.set((w.a[0] + w.b[0]) / 2, H / 2, (w.a[1] + w.b[1]) / 2);
        m.castShadow = true; m.receiveShadow = true; m.userData.wall = true; m.userData.ext = w.ext;
        this.group.add(m); this.walls.push(m); if (w.ext) this.extWalls.push(m);
      }
    });
    for (const A of S.arcs ?? []) this.arcWall(A);
    // 방 바닥 칸(0.1m)과 벽 면 사이 빈틈 → 방마다 12cm 넓힌 얇은 받침을 깐다(바깥 빈 곳에는 깔리지 않음)
    S.rooms.forEach((r, ri) => { for (const [x0, z0, x1, z1] of r.rects) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.24, 0.03, z1 - z0 + 0.24), M.base);
      b.position.set((x0 + x1) / 2, -0.035 - (ri % 4) * 0.002, (z0 + z1) / 2); b.receiveShadow = true; this.group.add(b); // 이웃 방 받침끼리 같은 높이로 겹치지 않게
    } });
    // 지붕판: 방 천장판(0.1m 칸)과 벽 사이 가는 틈으로 햇빛이 새어 벽에 사선 줄이 생겼다 → 집 전체 위를 덮어 빛만 막는다(천장과 함께 위에서 보기 때 숨김)
    // 아랫면은 천장과 같은 칠·거의 같은 높이(2mm 위): 천장판 사이 틈으로 보여도 같은 천장으로 보이게(어두운 판이 계단 무늬로 비쳤다)
    const roof = new THREE.Mesh(new THREE.BoxGeometry(S.size[0] + 0.6, 0.12, S.size[1] + 0.6), M.ceiling);
    roof.position.set(S.size[0] / 2, H + 0.002 + 0.06, S.size[1] / 2); roof.castShadow = true; roof.receiveShadow = false; this.ceilings.add(roof);
    for (const o of S.openings) this.opening(o);
    // 방: 바닥·천장·벽 마감
    for (const r of S.rooms) this.room(r);
    return this;
  }

  // 틈 하나: 문(인방 + 열린 문짝) · 창(창턱 + 인방 + 유리) · 미닫이창(인방 + 큰 유리) · 트임(인방만)
  opening(o) {
    const H = this.H, M = this.mats;
    const horiz = Math.abs(o.b[0] - o.a[0]) >= Math.abs(o.b[1] - o.a[1]);
    const L = horiz ? o.b[0] - o.a[0] : o.b[1] - o.a[1];
    const cx = (o.a[0] + o.b[0]) / 2, cz = (o.a[1] + o.b[1]) / 2, t = o.t;
    const piece = (y0, y1, mat, thick = t + 0.003, along = L + 0.02) => { // 벽보다 3mm 두껍고 양옆 1cm씩 벽에 묻힘: 얇으면 모서리 틈으로 햇빛이 새고, 같으면 겹친 면이 떨린다
      if (y1 - y0 < 0.01) return null;
      const geo = horiz ? new THREE.BoxGeometry(along, y1 - y0, thick) : new THREE.BoxGeometry(thick, y1 - y0, along);
      meterUV(geo, TILE.plaster, [cx, (y0 + y1) / 2, cz]);
      const m = new THREE.Mesh(geo, mat === M.paint ? [M.paint, M.paint, M.cap, M.paint, M.paint, M.paint].map(x => x === M.cap ? x : x.clone()) : mat);
      m.position.set(cx, (y0 + y1) / 2, cz); m.castShadow = true; m.receiveShadow = true;
      if (mat === M.paint) { m.userData.wall = true; m.userData.ext = o.exterior; this.walls.push(m); if (o.exterior) this.extWalls.push(m); }
      this.group.add(m); return m;
    };
    if (o.type === 'door' || o.type === 'open' || o.type === 'slide') { // 문턱 바닥(방 바닥 사이 빈칸)
      const g = horiz ? new THREE.BoxGeometry(L, 0.02, t + 0.02) : new THREE.BoxGeometry(t + 0.02, 0.02, L);
      const th = new THREE.Mesh(meterUV(g, TILE.oakfloor, [cx, 0, cz]), o.type === 'slide' ? M.frame : M.wood);
      th.position.set(cx, -0.012, cz); th.receiveShadow = true; this.group.add(th); this.floors.push(th);
    }
    if (o.type === 'door') {
      piece(DOOR_H, H, M.paint);
      // 문틀
      const jamb = 0.05;
      for (const s of [-1, 1]) {
        const g = horiz ? new THREE.BoxGeometry(jamb, DOOR_H, t + 0.02) : new THREE.BoxGeometry(t + 0.02, DOOR_H, jamb);
        const m = new THREE.Mesh(g, M.frame); m.position.set(cx + (horiz ? s * (L / 2 - jamb / 2) : 0), DOOR_H / 2, cz + (horiz ? 0 : s * (L / 2 - jamb / 2)));
        this.group.add(m);
      }
      // 문짝: 경첩 = o.hinge 끝(기본 a), o.swing 쪽(없으면 비어 있는 쪽)으로 85° 열림. plan.py가 걷기 칸에서 같은 자리를 뺀다
      const leafW = L - 0.1, leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, DOOR_H - 0.03, 0.04), M.door);
      leaf.castShadow = true; leaf.receiveShadow = true;
      const pivot = new THREE.Group(); pivot.add(leaf); leaf.position.set(leafW / 2, (DOOR_H - 0.03) / 2, 0);
      const atB = o.hinge === 'b';
      const hinge = atB ? (horiz ? [o.b[0] - 0.05, o.b[1]] : [o.b[0], o.b[1] - 0.05]) : (horiz ? [o.a[0] + 0.05, o.a[1]] : [o.a[0], o.a[1] + 0.05]);
      const baseRot = horiz ? 0 : -Math.PI / 2; // 닫힌 문 방향(문짝 +x가 a → b)
      const side = o.swing ?? this.freeSide(o, horiz);
      const open = (o.open ?? 85) / 85 * 1.48; // 175° = 벽에 붙도록 활짝(다른 문을 막을 때)
      if ((o.open ?? 85) > 120) { const k = t / 2 + 0.025; if (horiz) hinge[1] -= side * k; else hinge[0] += side * k; }
      pivot.position.set(hinge[0], 0, hinge[1]);
      pivot.rotation.y = atB ? baseRot + Math.PI - side * open : baseRot + side * open;
      pivot.userData.id = o.id; // 투어 문 앞 구도에서 이 문짝만 숨길 때 찾는다
      this.group.add(pivot); this.doors.push(pivot);
    } else if (o.type === 'window') {
      const full = this.isBalconyFront(horiz, cx, cz, L); // 발코니 앞면 창은 바닥부터 천장까지
      const sill = full ? 0.1 : o.sill ?? WIN_SILL, head = full ? H - 0.08 : WIN_HEAD;
      piece(0, sill, M.paint); piece(head, H, M.paint); // (조리대 상판이 벽 속으로 들어가지 않게 고쳐 창턱과 겹치지 않는다. 창턱을 낮추면 그 틈으로 햇빛이 새어 벽에 사선 줄이 생겼다)
      this.glass(cx, cz, horiz, L, sill, head, t, 2);
    } else if (o.type === 'slide') {
      piece(SLIDE_HEAD, H, M.paint);
      this.glass(cx, cz, horiz, L, 0.03, SLIDE_HEAD, t, 2);
    } else if (o.type === 'open') {
      if (o.arch) this.arch(o, horiz, L, cx, cz, t); else piece(SLIDE_HEAD, H, M.paint);
    }
  }
  // 아치 트임(plan.json arches): 반원 윗부분을 한 덩어리 곡면으로 짓는다(조각 상자로 쌓으면 곡선이 계단처럼 보인다).
  // 카메라·검사용 상자 판정은 보이지 않는 얇은 세로 조각 12개가 맡는다(곡면 하나의 상자는 아치 안쪽까지 막는다)
  arch(o, horiz, L, cx, cz, t) {
    const H = this.H, M = this.mats, r = L / 2, top = Math.min(SLIDE_HEAD, H - 0.06), ys = top - r;
    const sh = new THREE.Shape();
    sh.moveTo(-r - 0.01, ys); sh.lineTo(-r - 0.01, H + 0.03); sh.lineTo(r + 0.01, H + 0.03); sh.lineTo(r + 0.01, ys);
    sh.absarc(0, ys, r, 0, Math.PI, false); sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: t + 0.003, bevelEnabled: false, curveSegments: 48 }); geo.translate(0, 0, -(t + 0.003) / 2);
    if (!horiz) geo.rotateY(Math.PI / 2);
    meterUV(geo, TILE.plaster, [cx, 0, cz]);
    const m = new THREE.Mesh(geo, M.paint.clone()); m.position.set(cx, 0, cz); m.castShadow = true; m.receiveShadow = true; m.userData.wall = true; this.group.add(m);
    const n = 12;
    for (let i = 0; i < n; i++) {
      const u0 = -r + (i / n) * L, u1 = u0 + L / n, um = Math.min(Math.abs(u0), Math.abs(u1)) * (u0 * u1 < 0 ? 0 : 1);
      const y0 = ys + Math.sqrt(Math.max(0, r * r - um * um));
      const g = horiz ? new THREE.BoxGeometry(L / n, H - y0, t) : new THREE.BoxGeometry(t, H - y0, L / n);
      const col = new THREE.Mesh(g, M.paint); col.visible = false; col.userData.wall = true;
      col.position.set(cx + (horiz ? (u0 + u1) / 2 : 0), (y0 + H) / 2, cz + (horiz ? 0 : (u0 + u1) / 2)); this.group.add(col); this.walls.push(col);
    }
  }
  // 문짝이 열릴 쪽: 틈 양옆 중 걷기 칸이 많은 쪽(+1 = 틈 방향 기준 왼쪽 법선)
  freeSide(o, horiz) {
    const n = this.S.nav; if (!n) return 1;
    const walk = (x, z) => { const i = Math.floor(x / n.cell), j = Math.floor(z / n.cell); return n.rows[j]?.[i] === '1'; };
    const cx = (o.a[0] + o.b[0]) / 2, cz = (o.a[1] + o.b[1]) / 2;
    let a = 0, b = 0;
    for (let d = 0.3; d <= 0.9; d += 0.15) {
      if (horiz) { a += walk(cx, cz - d); b += walk(cx, cz + d); } else { a += walk(cx - d, cz); b += walk(cx + d, cz); }
    }
    // 가로 틈: 회전 +θ → 문짝이 -z 쪽으로, 세로 틈: +θ → +x 쪽으로 열린다
    return horiz ? (a >= b ? 1 : -1) : (a >= b ? -1 : 1);
  }
  // 발코니 앞면: 발코니마다 바깥(0.9m 밖이 어느 방도 아님)에 닿은 변 중 가장 긴 변. 그 줄 ±0.6m 안의 벽·창은 모두 유리
  // (바깥벽이 두 겹이거나 사이에 얇은 수납칸이 있어도 전부 유리가 된다)
  balconyFronts() {
    if (this._fronts) return this._fronts;
    this._fronts = [];
    for (const r of this.S.rooms) {
      if (r.type !== 'balcony') continue;
      const x0 = Math.min(...r.rects.map(q => q[0])), z0 = Math.min(...r.rects.map(q => q[1])), x1 = Math.max(...r.rects.map(q => q[2])), z1 = Math.max(...r.rects.map(q => q[3]));
      const sides = [{ o: 'h', line: z0, lo: x0, hi: x1, out: [0, -1] }, { o: 'h', line: z1, lo: x0, hi: x1, out: [0, 1] }, { o: 'v', line: x0, lo: z0, hi: z1, out: [-1, 0] }, { o: 'v', line: x1, lo: z0, hi: z1, out: [1, 0] }];
      const outside = s => [0.15, 0.35, 0.5, 0.65, 0.85].every(u => { const p = s.lo + (s.hi - s.lo) * u; const x = s.o === 'h' ? p : s.line + s.out[0] * 0.9, z = s.o === 'h' ? s.line + s.out[1] * 0.9 : p; return !this.roomAt(x, z) || this.roomAt(x, z).auto && this.roomAt(x, z).type === 'closet'; });
      const ext = sides.filter(outside).sort((a, b) => (b.hi - b.lo) - (a.hi - a.lo));
      if (ext[0]) this._fronts.push(ext[0]);
    }
    return this._fronts;
  }
  isBalconyFront(horiz, cx, cz, len) {
    const o = horiz ? 'h' : 'v', line = horiz ? cz : cx, a = (horiz ? cx : cz) - len / 2, b = (horiz ? cx : cz) + len / 2;
    const mid = (a + b) / 2; return this.balconyFronts().some(f => f.o === o && Math.abs(line - f.line) <= 0.6 && mid >= f.lo - 0.05 && mid <= f.hi + 0.05);
  }
  // 벽 양옆 0.2m 중 한쪽이 발코니인가
  balconySide(cx, cz, horiz, t) {
    for (const sg of [1, -1]) {
      const d = t / 2 + 0.2, r = this.roomAt(cx + (horiz ? 0 : sg * d), cz + (horiz ? sg * d : 0));
      if (r?.type === 'balcony') return true;
    }
    return false;
  }
  // 발코니 바깥벽 = 전면 유리(아래 10cm 턱 · 위 8cm 인방 · 1.1m마다 창살). 카메라는 보이지 않는 벽 상자에 막힌다
  glassWall(w, len) {
    const H = this.H, M = this.mats, horiz = w.o === 'h', t = w.t;
    const cx = (w.a[0] + w.b[0]) / 2, cz = (w.a[1] + w.b[1]) / 2;
    for (const [y0, y1] of [[-0.03, 0.1], [H - 0.08, H + 0.03]]) {
      const g = horiz ? new THREE.BoxGeometry(len, y1 - y0, t + 0.003) : new THREE.BoxGeometry(t + 0.003, y1 - y0, len);
      const m = new THREE.Mesh(g, M.paint); m.position.set(cx, (y0 + y1) / 2, cz); m.castShadow = true; m.receiveShadow = true; this.group.add(m);
    }
    this.glass(cx, cz, horiz, len, 0.1, H - 0.08, t, 2);
    const col = new THREE.Mesh(horiz ? new THREE.BoxGeometry(len, H, t) : new THREE.BoxGeometry(t, H, len), M.paint);
    col.position.set(cx, H / 2, cz); col.visible = false; col.userData.wall = true; col.userData.ext = true; col.userData.glass = true; // 그리지 않음(광선 검사만)
    this.group.add(col); this.walls.push(col); this.extWalls.push(col);
  }
  // 곡선 벽(scene.arcs: 중심 c · 반지름 r · 시작각 a0 · 돈 각 span, 각은 atan2(z, x)): 12cm 안팎의 곧은 조각을 원호를 따라 잇는다.
  // 조각마다 상자라서 카메라 가림·충돌·검사(상자 판정)가 직선 벽과 똑같이 맞는다. glass = 발코니 바깥면처럼 턱·인방 + 유리 + 창살
  arcWall(A) {
    const H = this.H, M = this.mats, n = Math.max(8, Math.ceil(A.span * A.r / 0.12)), da = A.span / n;
    const len = 2 * (A.r + A.t / 2) * Math.tan(da / 2) + 0.004; // 바깥면 기준 길이 + 4mm 겹침(조각 사이 틈 없게)
    const at = (th, rr = A.r) => [A.c[0] + rr * Math.cos(th), A.c[1] + rr * Math.sin(th)];
    const place = (m, th, y) => { const [x, z] = at(th); m.position.set(x, y, z); m.rotation.y = -th - Math.PI / 2; return m; }; // 상자 길이(x) = 호의 접선
    const capMats = () => [M.paint, M.paint, M.cap, M.paint, M.paint, M.paint].map(x => x === M.cap ? x : x.clone());
    const barEvery = Math.max(1, Math.round(1.1 / (A.r * da)));
    for (let i = 0; i < n; i++) {
      const th = A.a0 + (i + 0.5) * da, tt = A.t + (i % 3) * 0.002;
      if (!A.glass) {
        const geo = new THREE.BoxGeometry(len, H + 0.06, tt); geo.translate(0, -0.03, 0);
        const m = place(new THREE.Mesh(geo, capMats()), th, H / 2);
        m.castShadow = true; m.receiveShadow = true; m.userData.wall = true; m.userData.ext = A.ext;
        this.group.add(m); this.walls.push(m); if (A.ext) this.extWalls.push(m);
        continue;
      }
      for (const [y0, y1] of [[-0.03, 0.1], [H - 0.08, H + 0.03]]) {
        const m = place(new THREE.Mesh(new THREE.BoxGeometry(len, y1 - y0, tt + 0.003), capMats()), th, (y0 + y1) / 2);
        m.castShadow = true; m.receiveShadow = true; this.group.add(m);
      }
      const gy0 = 0.1, gy1 = H - 0.08, gh = gy1 - gy0;
      for (const yy of [gy0, gy1]) this.group.add(place(new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, Math.min(0.08, A.t)), M.frame), th, yy));
      if (i % barEvery === 0) { const b = place(new THREE.Mesh(new THREE.BoxGeometry(0.045, gh, Math.min(0.08, A.t)), M.frame), A.a0 + i * da, (gy0 + gy1) / 2); this.group.add(b); }
      const col = place(new THREE.Mesh(new THREE.BoxGeometry(len, H, tt), M.paint), th, H / 2);
      col.visible = false; col.userData.wall = true; col.userData.ext = true; col.userData.glass = true; // 그리지 않음(광선 검사만)
      this.group.add(col); this.walls.push(col); this.extWalls.push(col);
    }
    if (A.glass) {
      this.group.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.045, H - 0.18, Math.min(0.08, A.t)), M.frame), A.a0 + A.span, H / 2 - 0.01));
      // 유리는 곡면 한 장(조각 유리를 이어 붙이면 겹친 자리마다 진한 세로줄이 생겼다). 원기둥 θ = π/2 − 각
      const gy0 = 0.1, gy1 = H - 0.08, pane = new THREE.Mesh(new THREE.CylinderGeometry(A.r, A.r, gy1 - gy0, Math.max(24, n * 2), 1, true, Math.PI / 2 - A.a0 - A.span, A.span), M.glass);
      pane.position.set(A.c[0], (gy0 + gy1) / 2, A.c[1]); pane.userData.noAO = true; this.group.add(pane);
    }
  }
  // 곡선 벽 안쪽 활 모양(현 ~ 벽 안쪽 면): 0.1m 칸 바닥·천장이 곡선 앞에서 계단처럼 비는 곳을 메운다
  arcCap(A, floorMat, y) {
    const ri = A.r - A.t / 2 + 0.01, N = Math.max(12, Math.ceil(A.span * 20));
    const pts = Array.from({ length: N + 1 }, (_, k) => { const th = A.a0 + A.span * k / N; return [A.c[0] + ri * Math.cos(th), A.c[1] + ri * Math.sin(th)]; });
    const shape = s => new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, s * z)));
    const fg = new THREE.ShapeGeometry(shape(-1)).rotateX(-Math.PI / 2); // (x, -z) 평면 → 눕히면 (x, 0, z), 윗면이 위
    const f = new THREE.Mesh(meterUV(fg, floorMat === this.mats.porcelain ? TILE.porcelain : floorMat === this.mats.tile ? TILE.limestone : TILE.oakfloor), floorMat);
    f.position.y = y - 0.004; f.receiveShadow = true; f.userData.room = A.room; // 방 바닥 칸보다 살짝 아래: 칸이 빈 곳만 보인다 this.group.add(f); this.floors.push(f);
    const c = new THREE.Mesh(meterUV(new THREE.ShapeGeometry(shape(1)).rotateX(Math.PI / 2), TILE.plaster), this.mats.ceiling);
    c.position.y = this.H + 0.001; c.castShadow = true; this.ceilings.add(c); // 방 천장보다 살짝 위: 칸이 빈 곳만 보인다(같은 높이 아래면 둥근 매입등처럼 보였다)
  }
  glass(cx, cz, horiz, L, y0, y1, t, panels) {
    const M = this.mats, h = y1 - y0;
    const pane = new THREE.Mesh(horiz ? new THREE.PlaneGeometry(L, h) : new THREE.PlaneGeometry(L, h).rotateY(Math.PI / 2), M.glass);
    pane.position.set(cx, (y0 + y1) / 2, cz); pane.userData.noAO = true; this.group.add(pane);
    const bars = [];
    const n = Math.max(panels, Math.round(L / 1.1));
    for (let i = 0; i <= n; i++) bars.push([-L / 2 + (i / n) * L, 0, 0.045, h]);
    for (const yy of [-h / 2, h / 2]) bars.push([0, yy, L, 0.05]);
    for (const [u, v, bw, bh] of bars) {
      const g = horiz ? new THREE.BoxGeometry(bw, bh, Math.min(0.08, t)) : new THREE.BoxGeometry(Math.min(0.08, t), bh, bw);
      const m = new THREE.Mesh(g, M.frame);
      m.position.set(cx + (horiz ? u : 0), (y0 + y1) / 2 + v, cz + (horiz ? 0 : u)); this.group.add(m);
    }
  }

  room(r) {
    const H = this.H, M = this.mats;
    // style.floors = { 방 종류: 'wood' | 'porcelain' | 'tile' } 가 먼저, 없으면 style.floor === 'porcelain'(욕실 빼고 전부 타일)
    const want = this.S.style?.floors?.[r.type] ?? (this.S.style?.floor === 'porcelain' && r.type !== 'bath' ? 'porcelain' : null);
    const floorMat = want === 'porcelain' ? M.porcelain : want === 'wood' ? M.wood : want === 'tile' ? M.tile : (r.floor === 'wood' ? M.wood : r.floor === 'tile' ? M.tile : FLOOR[r.type] === 'tile' ? M.tile : M.wood);
    const y = floorMat === M.tile && r.type === 'entry' ? -0.03 : 0; // 현관은 한 단 낮게
    for (const [x0, z0, x1, z1] of r.rects) {
      const w = x1 - x0, d = z1 - z0;
      const g = meterUV(new THREE.BoxGeometry(w, 0.02, d), floorMat === M.porcelain ? TILE.porcelain : floorMat === M.tile ? TILE.limestone : TILE.oakfloor, [(x0 + x1) / 2, 0, (z0 + z1) / 2]);
      const f = new THREE.Mesh(g, floorMat); f.position.set((x0 + x1) / 2, y - 0.01, (z0 + z1) / 2); f.receiveShadow = true;
      f.userData.room = r.name; this.group.add(f); this.floors.push(f);
      const c = new THREE.Mesh(meterUV(new THREE.PlaneGeometry(w, d), TILE.plaster), M.ceiling);
      c.rotation.x = Math.PI / 2; c.position.set((x0 + x1) / 2, H, (z0 + z1) / 2); c.castShadow = true;
      this.ceilings.add(c);
    }
    for (const A of this.S.arcs ?? []) if (A.room === r.name) this.arcCap(A, floorMat, y);
    // 방 둘레 마감(벽에 닿은 가장자리만): 욕실 = 타일, 그 밖 = 걸레받이
    const lining = LINING[r.type];
    for (const e of this.roomEdges(r)) {
      const [ax, az, bx, bz, nx, nz] = e, len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const horiz = Math.abs(bx - ax) > Math.abs(bz - az);
      const mx = (ax + bx) / 2 + nx * 0.006, mz = (az + bz) / 2 + nz * 0.006;
      if (lining === 'tile') {
        const g = horiz ? new THREE.PlaneGeometry(len, H) : new THREE.PlaneGeometry(len, H).rotateY(Math.PI / 2);
        if (horiz && nz < 0) g.rotateY(Math.PI); if (!horiz && nx < 0) g.rotateY(Math.PI);
        const bw = this.S.style?.bathWall === 'porcelain';
        meterUV(g, bw ? TILE.porcelain : TILE.limestone, [mx, H / 2, mz]);
        const p = new THREE.Mesh(g, bw ? M.wallPorcelain : M.wallTile); p.position.set(mx, H / 2, mz); p.receiveShadow = true; this.group.add(p);
      } else {
        const g = horiz ? new THREE.BoxGeometry(len, 0.08, 0.012) : new THREE.BoxGeometry(0.012, 0.08, len);
        const p = new THREE.Mesh(g, M.skirt); p.position.set(mx, 0.04, mz); this.group.add(p);
      }
    }
  }
  // 방 칸(0.1m) 가장자리 중 바로 옆이 벽인 변들을 이어 붙인다 → [ax, az, bx, bz, 안쪽 법선 x, z]
  roomEdges(r) {
    const c = 0.1, S = this.S;
    if (!this._wallCells) { // 벽 칸 표시
      const w = Math.ceil(S.size[0] / c) + 2, h = Math.ceil(S.size[1] / c) + 2, m = new Uint8Array(w * h);
      const mark = (x0, z0, x1, z1) => { for (let j = Math.max(0, Math.floor(z0 / c)); j <= Math.min(h - 1, Math.floor(z1 / c)); j++) for (let i = Math.max(0, Math.floor(x0 / c)); i <= Math.min(w - 1, Math.floor(x1 / c)); i++) m[j * w + i] = 1; };
      for (const wl of S.walls) { const t = wl.t / 2; if (wl.o === 'h') mark(Math.min(wl.a[0], wl.b[0]), wl.a[1] - t, Math.max(wl.a[0], wl.b[0]), wl.a[1] + t); else mark(wl.a[0] - t, Math.min(wl.a[1], wl.b[1]), wl.a[0] + t, Math.max(wl.a[1], wl.b[1])); }
      this._wallCells = { w, h, m };
    }
    const { w, h, m } = this._wallCells;
    const inRoom = new Set();
    for (const [x0, z0, x1, z1] of r.rects) for (let j = Math.round(z0 / c); j < Math.round(z1 / c); j++) for (let i = Math.round(x0 / c); i < Math.round(x1 / c); i++) inRoom.add(j * 100000 + i);
    const isWall = (i, j) => i >= 0 && j >= 0 && i < w && j < h && m[j * w + i] === 1;
    const edges = [];
    const runs = { n: new Map(), s: new Map(), w: new Map(), e: new Map() };
    for (const k of inRoom) {
      const j = Math.floor(k / 100000), i = k % 100000;
      if (!inRoom.has((j - 1) * 100000 + i) && isWall(i, j - 1)) push(runs.n, j, i);
      if (!inRoom.has((j + 1) * 100000 + i) && isWall(i, j + 1)) push(runs.s, j + 1, i);
      if (!inRoom.has(j * 100000 + i - 1) && isWall(i - 1, j)) push(runs.w, i, j);
      if (!inRoom.has(j * 100000 + i + 1) && isWall(i + 1, j)) push(runs.e, i + 1, j);
    }
    function push(map, line, pos) { if (!map.has(line)) map.set(line, []); map.get(line).push(pos); }
    const merge = (map, fn) => { for (const [line, arr] of map) { arr.sort((p, q) => p - q); let s = arr[0], prev = arr[0]; for (const v of [...arr.slice(1), Infinity]) { if (v !== prev + 1) { fn(line, s, prev + 1); s = v; } prev = v; } } };
    // 칸 경계선 → 실제 벽 면으로 붙이기(칸은 0.1m라 벽 면과 최대 5cm 어긋난다)
    const face = (o, line, a, b, sgn) => {
      let best = line, bd = 0.16;
      for (const wl of S.walls) {
        if (wl.o !== o) continue;
        const lo = o === 'h' ? Math.min(wl.a[0], wl.b[0]) : Math.min(wl.a[1], wl.b[1]), hi = o === 'h' ? Math.max(wl.a[0], wl.b[0]) : Math.max(wl.a[1], wl.b[1]);
        if (hi < a + 0.02 || lo > b - 0.02) continue;
        const f = (o === 'h' ? wl.a[1] : wl.a[0]) + sgn * wl.t / 2, d = Math.abs(f - line);
        if (d < bd) { bd = d; best = f; }
      }
      return best;
    };
    merge(runs.n, (j, a, b) => { const z = face('h', j * c, a * c, b * c, 1); edges.push([a * c, z, b * c, z, 0, 1]); });
    merge(runs.s, (j, a, b) => { const z = face('h', j * c, a * c, b * c, -1); edges.push([a * c, z, b * c, z, 0, -1]); });
    merge(runs.w, (i, a, b) => { const x = face('v', i * c, a * c, b * c, 1); edges.push([x, a * c, x, b * c, 1, 0]); });
    merge(runs.e, (i, a, b) => { const x = face('v', i * c, a * c, b * c, -1); edges.push([x, a * c, x, b * c, -1, 0]); });
    return edges;
  }
  roomAt(x, z) {
    for (const r of this.S.rooms) for (const [x0, z0, x1, z1] of r.rects) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return r;
    return null;
  }
}
