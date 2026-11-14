// 가구: 생성 3D 모델(assets/furniture/*.glb) + 상자로 짜는 가구(주방·붙박이장·가전). 앞면 = 지역 +z.
import * as THREE from 'three';
import { addProps, fabric, setFabricTex } from './props.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { texMat, meterUV, TILE, TEX } from './look.js';

// 모델 파일과 모델의 앞 방향 보정(라디안). 모델 앞이 +z가 아니면 여기서 돌린다.
const GLB = {
  sofa: { file: 'sofa', turn: 0 }, armchair: { file: 'armchair', turn: 0 }, tv: { file: 'tv', turn: 0 },
  bed: { file: 'bed', turn: 0 }, 'bed-single': { file: 'bed', turn: 0 },
  toilet: { file: 'toilet', turn: 0 }, vanity: { file: 'vanity', turn: 0 }, bathtub: { file: 'bathtub', turn: 0 },
  'dressing-table': { file: 'dressing-table', turn: 0 }, // 서랍 3단 + 선반 + 아치 거울 화장대(1200 × 400 × 1360)
  chair: { file: 'chair', turn: 0 }, table: { file: 'table', turn: 0 }, plant: { file: 'plant', turn: 0 }, lamp: { file: 'lamp', turn: 0 },
  // 인테리어 교체(플레이풀 미니멀): f.color가 있으면 흰 모델에 색을 입힌다(셸 의자 초록·노랑)
  'side-lamp': { file: 'side-lamp', turn: 0 }, 'shell-chair': { file: 'shell-chair', turn: 0 }, 'office-chair': { file: 'office-chair', turn: 0 },
  lounge: { file: 'lounge', turn: 0 }, stool: { file: 'stool', turn: 0 },
};

export class Furniture {
  constructor(scene, S) {
    this.scene = scene; this.S = S; this.group = new THREE.Group(); scene.add(this.group);
    this.cache = new Map();
    this.M = {
      oak: texMat('oak', { roughness: 0.55, bump: 0.2 }),
      oakDark: texMat('oak', { roughness: 0.55, bump: 0.2, color: 0xC9B08E }),
      white: new THREE.MeshStandardMaterial({ color: 0xF4F2EE, roughness: 0.45 }),
      greige: new THREE.MeshStandardMaterial({ color: 0xDCD6CC, roughness: 0.6 }),
      stone: texMat('limestone', { roughness: 0.25, bump: 0.1, color: 0xF2EFEA }),
      steel: new THREE.MeshStandardMaterial({ color: 0xC9CCCF, roughness: 0.3, metalness: 0.8 }),
      black: new THREE.MeshStandardMaterial({ color: 0x1E1F21, roughness: 0.2, metalness: 0.3 }),
      seam: new THREE.MeshStandardMaterial({ color: 0x8C8378, roughness: 0.8 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0xEAF2F2, roughness: 0.05, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
      rug: new THREE.MeshStandardMaterial({ color: 0xD9D0C1, roughness: 1 }),
      lacquer: new THREE.MeshStandardMaterial({ color: 0xE0DCD5, roughness: 0.38 }), // 흰 래커(둥근 식탁·물결 책장)
    };
    this.footprints = []; // 가구 자리(카메라 가림 판정용)
  }
  async load(names) {
    const loader = new GLTFLoader();
    await Promise.all([...new Set(names)].map(async n => {
      try { const g = await loader.loadAsync(`assets/furniture/${n}.glb`); g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) o.material.envMapIntensity = 0.8; } }); this.cache.set(n, g.scene); }
      catch { /* 없으면 상자 가구로 */ }
    }));
  }
  async build() {
    const items = this.S.furniture;
    const need = items.some(f => f.props) ? ['plant'] : [];
    need.push(...items.filter(f => f.model).map(f => f.model)); // f.model = 이 가구만 다른 3D 파일(assets/furniture/<이름>.glb)
    need.push(...items.flatMap(f => f.type === 'dining' ? ['table', 'chair'] : f.type === 'nightstand' ? ['lamp'] : GLB[f.type] ? [GLB[f.type].file] : []));
    await this.load(need);
    setFabricTex(this.S.style?.tex?.fabric); // style.tex.fabric: 쿠션·담요·코드 소파 직물 사진
    for (const f of items) {
      const obj = this.make(f);
      if (!obj) continue;
      addProps(f, obj, this.fit.bind(this)); // 책·그릇·쿠션 같은 생활 소품(plan.json "props")
      obj.position.set(f.x, 0, f.z); obj.rotation.y = (f.rot ?? 0) * Math.PI / 180;
      obj.traverse(o => { if (o.isMesh) { o.castShadow = o.castShadow !== false; o.receiveShadow = true; } });
      obj.userData.furniture = f.type; obj.userData.h = f.type === 'counter' && f.upper ? 2.2 : (f.h ?? 0);
      this.group.add(obj);
    }
    return this;
  }
  // 3D 모델 마감: 직물 가구는 무광(번들거리면 플라스틱처럼 보였다), 셸 의자는 몸판 단색 + 검은 다리(텍스처 갈라짐 없이), 사무 의자는 단색
  finish(f, o) {
    const FABRIC = { sofa: 1, lounge: 1, stool: 1, bed: 1, 'bed-single': 1, armchair: 1 };
    o.updateMatrixWorld(true);
    o.traverse(m => {
      if (!m.isMesh || !m.material) return;
      m.material = m.material.clone();
      if (FABRIC[f.type]) { m.material.roughness = 1; m.material.metalness = 0; m.material.envMapIntensity = 0.3; if (f.type === 'lounge' || f.type === 'stool') m.material.color.set(0xEDE7DC); }
      if (f.type === 'office-chair') { m.material.map = null; m.material.color.set(0xC9CCCF); m.material.roughness = 0.75; }
      if (f.type === 'shell-chair' && f.color) { // 높이 0.4m 아래(다리)는 검정, 위는 f.color
        const geo = m.geometry = m.geometry.clone(), pos = geo.attributes.position, col = new Float32Array(pos.count * 3), v = new THREE.Vector3(), cc = new THREE.Color(f.color), dark = new THREE.Color(0x1E1F21);
        for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); const c = v.y < 0.4 ? dark : cc; col.set([c.r, c.g, c.b], i * 3); }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        Object.assign(m.material, { map: null, vertexColors: true, roughness: 0.42, metalness: 0 }); m.material.color.set(0xFFFFFF);
      } else if (f.color && f.color !== 'white' && f.type !== 'office-chair') m.material.color.multiply(new THREE.Color(f.color));
      m.material.needsUpdate = true;
    });
  }
  // 러그 윗면: 바탕색 + 올 무늬(잔 얼룩) + 테두리·줄·격자(f.pattern, f.accent). 윗면 한 장에 러그 전체가 들어간다
  rugMat(f, w, d) {
    const base = f.color ?? '#E9E4DA', acc = f.accent ?? '#D9A63A', N = 1024, cv = document.createElement('canvas'); cv.width = cv.height = N; const g = cv.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, N, N);
    let sd = 3; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 9000; i++) { g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(80,60,40,0.05)'; g.fillRect(rnd() * N, rnd() * N, 2 + rnd() * 3, 1 + rnd() * 2); }
    g.strokeStyle = acc; g.fillStyle = acc;
    if (f.pattern === 'border') { g.lineWidth = N * 0.022; if (f.variant === 'round') { g.beginPath(); g.arc(N / 2, N / 2, N * 0.42, 0, Math.PI * 2); g.stroke(); } else g.strokeRect(N * 0.07, N * 0.07, N * 0.86, N * 0.86); }
    if (f.pattern === 'stripe') { const n = 7; for (let i = 0; i < n; i++) if (i % 2) g.fillRect(0, i * N / n, N, N / n * 0.35); }
    if (f.pattern === 'check') { const n = 8; g.globalAlpha = 0.55; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if ((i + j) % 2) g.fillRect(i * N / n, j * N / n, N / n, N / n); g.globalAlpha = 1; }
    const rt = this.S.style?.tex?.rug, img = rt && TEX[rt]?.map?.image; // style.tex.rug: 울 직조 사진을 무늬 위에 겹친다(색은 러그 색 유지)
    if (img) { const per = N / Math.max(1, Math.max(w, d) / (TILE[rt] ?? 0.5)), sc = document.createElement('canvas'); sc.width = sc.height = Math.max(16, Math.round(per)); sc.getContext('2d').drawImage(img, 0, 0, sc.width, sc.height); g.globalCompositeOperation = 'soft-light'; g.globalAlpha = 0.9; g.fillStyle = g.createPattern(sc, 'repeat'); g.fillRect(0, 0, N, N); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return { top: new THREE.MeshStandardMaterial({ map: t, roughness: 1 }), side: new THREE.MeshStandardMaterial({ color: new THREE.Color(base), roughness: 1 }) };
  }
  // 모델을 상자(w × h × d)에 맞춘다. 바닥 = y 0, 가운데 = 원점
  fit(name, w, d, h, turn = 0) {
    const src = this.cache.get(name); if (!src) return null;
    const obj = src.clone(true);
    obj.rotation.y = turn;
    const wrap = new THREE.Group(); wrap.add(obj); wrap.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrap), s = box.getSize(new THREE.Vector3());
    const kx = w / s.x, kz = d / s.z;
    const ky = h ? h / s.y : (kx + kz) / 2;
    const kyy = Math.min(ky, (kx + kz) / 2 * 1.25);
    if (Math.abs(Math.sin(turn)) > 0.7) obj.scale.set(kz, kyy, kx); else obj.scale.set(kx, kyy, kz); // 90° 돌린 모델은 폭·깊이 축이 바뀐다
    wrap.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(wrap), c = b2.getCenter(new THREE.Vector3());
    obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= b2.min.y;
    const out = new THREE.Group(); out.add(wrap); return out;
  }
  make(f) {
    const { w, d, h } = f, M = this.M;
    const g = new THREE.Group();
    const box = (bw, bh, bd, mat, x = 0, y = 0, z = 0, uv = TILE.oak) => { const geo = new THREE.BoxGeometry(bw, bh, bd); if (mat.map) meterUV(geo, uv, [x, y, z]); const m = new THREE.Mesh(geo, mat); m.position.set(x, y + bh / 2, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    const glb = GLB[f.type];
    if (f.model && f.type !== 'pendant' && this.cache.has(f.model)) return this.glbItem(f, g, w, d, h); // scene.json f.model = 3D 모델 파일로 바꾼 가구(파일이 없으면 아래 코드 가구)
    switch (f.type) {
      case 'dining': {
        const t = this.fit('table', w, d, 0.75) ?? (() => { box(w, 0.04, d, M.oak, 0, 0.71, 0); return null; })();
        if (t) g.add(t);
        // 의자 자리: scene.json chairsLocal(plan.py가 벽·문·가구와 겹치지 않게 정한 자리)을 그대로 쓴다. 없으면 긴 변 양쪽에 고르게 놓는다
        const n = f.chairs ?? (w > 1.5 ? 6 : 4), perSide = Math.ceil(n / 2), spots = f.chairsLocal ?? [];
        if (!f.chairsLocal) for (let s = 0; s < 2; s++) for (let i = 0; i < perSide && s * perSide + i < n; i++) spots.push([((i + 0.5) / perSide - 0.5) * w * 0.85, (s ? 1 : -1) * (d / 2 + 0.12), s]);
        for (const [lx, lz, s] of spots) {
          const c = this.fit('chair', 0.48, 0.5, 0.86); if (!c) continue;
          c.position.set(lx, 0, lz); c.rotation.y = s ? Math.PI : 0;
          g.add(c);
        }
        return g;
      }
      case 'counter': case 'island': {
        const top = 0.04, baseH = (h ?? 0.9) - top;
        box(w, 0.1, d - 0.06, M.seam, 0, 0, -0.03);                  // 걸레받이
        box(w, baseH - 0.1, d - 0.02, M.white, 0, 0.1, -0.01);         // 하부장
        for (let i = 1; i < Math.round(w / 0.6); i++) box(0.006, baseH - 0.14, 0.005, M.seam, -w / 2 + i * (w / Math.round(w / 0.6)), 0.12, d / 2 - 0.01);
        box(w + 0.02, top, d + 0.01, M.stone, 0, baseH, 0.005, TILE.limestone); // 상판(뒤는 벽 면에 딱 맞춤 — 벽 속까지 들어가면 같은 높이 창턱 윗면과 겹쳐 지지직거렸다)
        if (f.sink) { const sx = w > 1.4 ? w * 0.15 : 0, s = box(0.7, 0.012, 0.42, M.steel, sx, baseH + top - 0.008, 0.02); s.castShadow = false; // 싱크 + 구스넥 수전(곧은 막대는 기둥처럼 보였다)
          const ty = baseH + top, tz = -d / 2 + 0.09, col = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.3, 20), M.steel); col.position.set(sx, ty + 0.15, tz); g.add(col);
          const arc = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 12, 24, Math.PI), M.steel); arc.rotation.y = Math.PI / 2; arc.position.set(sx, ty + 0.3, tz + 0.075); g.add(arc);
          const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 16), M.steel); sp.position.set(sx, ty + 0.27, tz + 0.15); g.add(sp); }
        if (f.cooktop) { const c = box(0.6, 0.006, 0.5, M.black, w > 1.2 ? -w * 0.18 : 0, baseH + top, 0.02); c.castShadow = false; }
        if (f.upper && f.type === 'counter') {
          box(w, 0.72, 0.34, M.white, 0, 1.48, -d / 2 + 0.17);
          for (let i = 1; i < Math.round(w / 0.6); i++) box(0.006, 0.7, 0.005, M.seam, -w / 2 + i * (w / Math.round(w / 0.6)), 1.49, -d / 2 + 0.345);
          const bs = this.S.style?.tex?.backsplash; if (bs && TEX[bs]) box(w, 0.58, 0.012, (this._bs ??= texMat(bs, { roughness: 0.16, bump: 0.6 })), 0, baseH + top, -d / 2 + 0.006, TILE[bs] ?? 0.6); // style.tex.backsplash: 수제 유약 타일
          else box(w, 0.58, 0.012, M.stone, 0, baseH + top, -d / 2 + 0.006, TILE.limestone); // 벽 타일(상판~상부장 사이)
        }
        return g;
      }
      case 'wardrobe': case 'shoe': {
        const H2 = h ?? 2.2, mat = f.type === 'shoe' ? M.white : (f.color === 'white' ? M.white : M.oak);
        box(w, H2, d, mat);
        const n = Math.max(1, Math.round(w / 0.5));
        for (let i = 1; i < n; i++) box(0.006, H2 - 0.06, 0.006, M.seam, -w / 2 + i * w / n, 0.03, d / 2 + 0.001);
        for (let i = 0; i < n; i++) box(0.02, 0.3, 0.025, M.steel, -w / 2 + (i + (i % 2 ? 0.12 : 0.88)) * w / n, H2 * 0.45, d / 2 + 0.012);
        return g;
      }
      case 'dresser': case 'nightstand': {
        const H2 = h ?? (f.type === 'dresser' ? 0.8 : 0.5);
        box(w, H2, d, M.oak);
        const rows = f.type === 'dresser' ? 3 : 2;
        for (let i = 1; i < rows; i++) box(w - 0.04, 0.006, 0.006, M.seam, 0, H2 * i / rows, d / 2 + 0.001);
        if (f.type === 'nightstand') { const l = this.fit('lamp', 0.26, 0.26, 0.42); if (l) { l.position.y = H2; g.add(l); } }
        return g;
      }
      case 'desk': {
        const dm = f.color === 'white' ? M.lacquer : M.oak;
        box(w, 0.035, d, dm, 0, 0.72, 0);
        box(0.03, 0.72, d - 0.04, dm, -w / 2 + 0.03, 0, 0); box(0.03, 0.72, d - 0.04, dm, w / 2 - 0.03, 0, 0);
        box(w - 0.08, 0.3, 0.02, dm, 0, 0.4, -d / 2 + 0.03);
        return g;
      }
      case 'fridge': {
        const H2 = h ?? 1.85;
        box(w, H2, d, M.steel);
        box(0.008, H2 - 0.05, 0.006, M.seam, 0, 0.02, d / 2 + 0.002);
        for (const s of [-1, 1]) box(0.02, 0.5, 0.03, M.white, s * 0.04, H2 * 0.5, d / 2 + 0.015);
        return g;
      }
      case 'washer': {
        box(w, h ?? 0.85, d, M.white);
        const door = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 40).rotateX(Math.PI / 2), M.black);
        door.position.set(0, 0.42, d / 2 + 0.01); g.add(door);
        box(w - 0.06, 0.08, 0.01, M.greige, 0, 0.72, d / 2 + 0.002);
        return g;
      }
      case 'shower': { // 샤워부스: 흰 바닥 트레이 + 앞면 유리(검은 테) + 뒷벽 세로 관·둥근 레인 샤워기·수전
        box(w, 0.04, d, M.white);
        const gl = new THREE.Mesh(new THREE.BoxGeometry(w * 0.62, 1.95, 0.01), M.glass); gl.position.set(-w * 0.19, 1.02, d / 2); gl.castShadow = false; g.add(gl);
        for (const [bw, bh, x, y] of [[0.02, 1.95, -w / 2 + 0.01, 0.04], [0.02, 1.95, w * 0.12, 0.04], [w * 0.62, 0.02, -w * 0.19, 1.97]]) box(bw, bh, 0.02, M.black, x, y, d / 2);
        const sx = w * 0.25; box(0.022, 1.25, 0.022, M.black, sx, 0.9, -d / 2 + 0.04); box(0.022, 0.022, 0.26, M.black, sx, 2.13, -d / 2 + 0.16);
        const head = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 40), M.black); head.position.set(sx, 2.11, -d / 2 + 0.28); g.add(head);
        box(0.12, 0.05, 0.05, M.black, sx, 1.05, -d / 2 + 0.03);
        return g;
      }
      case 'round-table': { // 받침 하나짜리 둥근 흰 식탁
        const R = w / 2, mk = (geo, y) => { const m = new THREE.Mesh(geo, M.lacquer); m.position.y = y; m.castShadow = true; m.receiveShadow = true; g.add(m); };
        const H2 = h ?? 0.74, bR = Math.min(0.25, R * 0.55);
        mk(new THREE.CylinderGeometry(R, R - 0.005, 0.028, 72), H2 - 0.014);
        mk(new THREE.CylinderGeometry(0.035, 0.045, H2 - 0.04, 32), (H2 - 0.04) / 2 + 0.02);
        mk(new THREE.CylinderGeometry(bR - 0.01, bR, 0.022, 64), 0.011);
        return g;
      }
      case 'shelf': case 'wave-shelf': { // 흰 칸 책장(wave-shelf = 칸막이가 물결): 위·아래 판 + 선반 2단 + 세로 칸막이(앞 = +z)
        const H2 = h ?? 1.1, th = 0.02, n = Math.max(2, Math.round(w / 0.36)), wavy = f.type === 'wave-shelf';
        g.userData.levels = [0.08, H2 * 0.38 + th, H2 * 0.7 + th]; g.userData.top = H2;
        g.userData.cells = Array.from({ length: n }, (_, i) => [-w / 2 + i * w / n + th, -w / 2 + (i + 1) * w / n - th]);
        box(w, 0.06, d - 0.03, M.lacquer, 0, 0, -0.015); box(w, th, d, M.lacquer, 0, H2 - th, 0); box(w, th, d, M.lacquer, 0, 0.06, 0);
        for (const yy of [H2 * 0.38, H2 * 0.7]) box(w - 0.02, th, d - 0.02, M.lacquer, 0, yy, 0);
        for (const s of [-1, 1]) box(th, H2 - 0.06, d, M.lacquer, s * (w / 2 - th / 2), 0.06, 0);
        for (let i = 1; i < n; i++) {
          if (!wavy) { box(th, H2 - 0.08 - th, d - 0.01, M.lacquer, -w / 2 + i * w / n, 0.08, 0); continue; }
          const sh = new THREE.Shape(), A = 0.055, pts = 24;
          for (let k = 0; k <= pts; k++) { const zz = -d / 2 + 0.01 + (d - 0.02) * k / pts; sh[k ? 'lineTo' : 'moveTo'](A * Math.sin(k / pts * Math.PI * 2) - th / 2, zz); }
          for (let k = pts; k >= 0; k--) { const zz = -d / 2 + 0.01 + (d - 0.02) * k / pts; sh.lineTo(A * Math.sin(k / pts * Math.PI * 2) + th / 2, zz); }
          const geo = new THREE.ExtrudeGeometry(sh, { depth: H2 - 0.08 - th, bevelEnabled: false }).rotateX(-Math.PI / 2);
          const m = new THREE.Mesh(geo, M.lacquer); m.position.set(-w / 2 + i * w / n, 0.08, 0); m.castShadow = true; m.receiveShadow = true; g.add(m);
        }
        return g;
      }
      case 'poster': { // 벽에 건 그림(f.image, 앞 = +z). 바닥에서 f.y0(기본 1.05m) 위
        const y0 = f.y0 ?? 1.05, tex = new THREE.TextureLoader().load(f.image ?? 'assets/art/calendar.jpg'); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
        const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
        p.position.set(0, y0 + h / 2, d / 2 - 0.004); p.castShadow = false; p.receiveShadow = true; g.add(p);
        const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.006), M.white); back.position.set(0, y0 + h / 2, d / 2 - 0.008); back.receiveShadow = true; g.add(back);
        return g;
      }
      case 'wall-arch': { // 벽에 칠한 아치 모양 색 면(앞 = +z, 바닥부터). f.color
        const r = w / 2, sh = new THREE.Shape(); sh.moveTo(-r, 0); sh.lineTo(r, 0); if (f.variant === 'rect') { sh.lineTo(r, h); sh.lineTo(-r, h); } else { sh.lineTo(r, h - r); sh.absarc(0, h - r, r, 0, Math.PI, false); } sh.lineTo(-r, 0); // variant 'rect' = 벽 아래쪽만 칠한 면
        const am = new THREE.MeshStandardMaterial({ color: new THREE.Color(f.color ?? '#EFD9A0'), roughness: 0.92 }), wt = this.S.style?.tex?.wall;
        if (wt && TEX[wt]) { const k = 1 / (TILE[wt] ?? 2.4); am.map = TEX[wt].map.clone(); am.map.repeat.set(k, k); if (TEX[wt].normal) { am.normalMap = TEX[wt].normal.clone(); am.normalMap.repeat.set(k, k); am.normalScale = new THREE.Vector2(0.55, 0.55); } } // 칠한 면도 벽과 같은 도장 결
        const m = new THREE.Mesh(new THREE.ShapeGeometry(sh, 48), am);
        m.position.set(0, 0.002, d / 2 - 0.003); m.receiveShadow = true; g.add(m); return g;
      }
      case 'pendant': { // 천장에 매단 둥근 조명(줄 + 유광 갓 + 따뜻한 빛). f.h = 갓 아래 높이(m), f.color = 갓 색
        const Hc = this.S.wallHeight ?? 2.3, y = f.y0 ?? 1.6, r = w / 2;
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, Hc - y - r * 0.7, 8), M.black); cord.position.y = (Hc + y + r * 0.7) / 2; g.add(cord);
        const sm = f.model && this.fit(f.model, w, w, h, f.modelTurn ?? 0); // 3D 모델 갓: 갓 아래끝 = y - r * 0.05
        if (sm) { sm.position.y = y - r * 0.05; g.add(sm); }
        else { const shade = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: new THREE.Color(f.color ?? '#C8302C'), roughness: 0.25, side: THREE.DoubleSide }));
          shade.position.y = y; shade.castShadow = true; g.add(shade); }
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 12), new THREE.MeshStandardMaterial({ color: 0xFFF4E0, emissive: 0xFFE2B0, emissiveIntensity: 0.9 })); bulb.position.y = y - 0.02; bulb.castShadow = false; g.add(bulb);
        const light = new THREE.PointLight(0xFFD9A8, 0.7, 3.0, 1.6); light.position.y = y - 0.08; g.add(light);
        return g;
      }
      case 'vanity': { if (f.variant !== 'box') return this.glbItem(f, g, w, d, h); // 세면대(코드): 오크 하부장 + 흰 상판 + 둥근 볼 + 수전(앞 = +z)
        const H2 = h ?? 0.85; box(w, H2 - 0.2, d - 0.02, M.oak, 0, 0.2, -0.01); box(w - 0.04, 0.006, 0.006, M.seam, 0, H2 * 0.55, d / 2 - 0.01);
        box(w + 0.02, 0.03, d, M.white, 0, H2 - 0.03, 0);
        const bowlG = new THREE.LatheGeometry([[0, 0], [0.13, 0], [0.16, 0.02], [0.17, 0.11], [0.16, 0.11], [0.15, 0.03], [0.12, 0.012], [0, 0.012]].map(([r, y]) => new THREE.Vector2(r * Math.min(1, w / 0.5), y)), 48);
        const b = new THREE.Mesh(bowlG, new THREE.MeshStandardMaterial({ color: 0xF6F5F2, roughness: 0.2 })); b.position.set(0, H2, 0.02); b.castShadow = true; g.add(b);
        const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.2, 16), M.steel); tap.position.set(0, H2 + 0.1, -d / 2 + 0.06); g.add(tap);
        const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.11, 12).rotateX(Math.PI / 2), M.steel); sp.position.set(0, H2 + 0.19, -d / 2 + 0.1); g.add(sp);
        return g;
      }
      case 'sofa': { if (f.variant !== 'soft') return this.glbItem(f, g, w, d, h); // 코드로 짓는 직물 소파(앞 = +z): 오크 다리·받침·팔걸이·등받이 + 볼록한 방석·등쿠션
        const fb = fabric(f.color ?? '#CFC8BC'), H2 = h ?? 0.8, legH = 0.09, n = w > 1.7 ? 2 : 1, armW = 0.17, inner = w - 2 * armW;
        const soft = (bw, bh, bd, r, x, y, z, rx = 0, puff = 0) => { const geo = new RoundedBoxGeometry(bw, bh, bd, 6, r); if (puff) { const ps = geo.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < ps.count; i++) { v.fromBufferAttribute(ps, i); const k = (1 - (2 * v.x / bw) ** 2) * (1 - (2 * v.z / bd) ** 2); if (v.y > 0) v.y += puff * Math.max(0, k); ps.setXYZ(i, v.x, v.y, v.z); } geo.computeVertexNormals(); } const m = new THREE.Mesh(geo, fb); m.position.set(x, y + bh / 2, z); m.rotation.x = rx; m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.016, legH, 16), M.oak); lg.position.set(sx * (w / 2 - 0.08), legH / 2, sz * (d / 2 - 0.08)); lg.castShadow = true; g.add(lg); }
        soft(w, 0.16, d, 0.03, 0, legH, 0);                                            // 받침
        for (const sx of [-1, 1]) soft(armW, 0.46, d, 0.07, sx * (w - armW) / 2, legH, 0); // 팔걸이
        soft(inner + 0.02, 0.44, 0.2, 0.06, 0, legH + 0.12, -d / 2 + 0.1);            // 등받이 판
        const cw = inner / n;
        for (let i = 0; i < n; i++) {
          const cx = -inner / 2 + cw * (i + 0.5);
          soft(cw - 0.012, 0.13, d - 0.24, 0.05, cx, legH + 0.16, 0.1, 0, 0.025);        // 방석
          soft(cw - 0.03, 0.42, 0.17, 0.07, cx, legH + 0.3, -d / 2 + 0.24, -0.16);       // 등쿠션
        }
        return g;
      }
      case 'rug': {
        const rm = this.rugMat(f, w, d);
        if (f.variant === 'round') { const r = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.012, 160), [rm.side, rm.top, rm.side]); r.position.y = 0.006; r.receiveShadow = true; g.add(r); return g; }
        if (f.pattern) { const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), [rm.side, rm.side, rm.top, rm.side, rm.side, rm.side]); r.position.y = 0.006; r.receiveShadow = true; g.add(r); return g; } const r = box(w, 0.012, d, M.rug); r.castShadow = false; return g; }
      default: return this.glbItem(f, g, w, d, h);
    }
  }
  glbItem(f, g, w, d, h) {
    const glb = f.model ? { file: f.model, turn: f.modelTurn ?? 0 } : GLB[f.type], M = this.M;
    {
      {
        if (!glb) return null;
        const o = this.fit(glb.file, w, d, f.type === 'bed' || f.type === 'bed-single' ? null : h, glb.turn);
        if (o) this.finish(f, o);
        if (o && f.type === 'side-lamp') { const l = new THREE.PointLight(0xFFCF9A, 0.22, 1.4, 2); l.position.set(0, (h ?? 0.92) - 0.14, 0.12); g.add(l); } // 버섯 조명 불빛
        if (o) { g.add(o); return g; }
        const bx = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.greige); bx.position.y = h / 2; g.add(bx); return g; // 모델이 없으면 상자
      }
    }
  }
}
