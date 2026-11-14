// 생활 소품(코드로 만든다): 가구 plan.json에 "props": "<세트 이름>"을 적으면 그 가구 위에 놓는다.
// 가구 위 높이는 위에서 광선을 쏴 실제 윗면을 찾는다(3D 모델 소파·침대도 뜨거나 파묻히지 않게). 좌표는 가구 기준(앞 = +z, 폭 = x)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TEX } from './look.js';

let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];
const M = {};
const mat = (hex, rough = 0.7, metal = 0) => (M[hex + rough + metal] ??= new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: rough, metalness: metal }));
const BOOK = ['#E9E2D3', '#D9CBB0', '#8FA58A', '#C8553D', '#2F3A4A', '#E3B23C', '#F3F0E8', '#B9B4AA', '#1F1F1F', '#6E8FA6', '#D98C6A'];
const CERAMIC = ['#F2EFE8', '#E6DDCF', '#C9B79C', '#D46A4C', '#8FA58A'];
const PAGE = mat('#F4EFE4', 0.9);
// 직물 결(뜨개·린넨 같은 잔 요철): 쿠션·담요에 bumpMap으로 쓴다
let KNIT = null;
function knit() { if (KNIT) return KNIT; const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N; const g = cv.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, N, N);
  for (let y = 0; y < N; y += 4) for (let x = 0; x < N; x += 4) { const v = 110 + ((x / 4 + y / 4) % 2) * 40 + Math.random() * 40; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 3, 3); }
  KNIT = new THREE.CanvasTexture(cv); KNIT.wrapS = KNIT.wrapT = THREE.RepeatWrapping; KNIT.repeat.set(5, 5); return KNIT; }
let FAB = null; // style.tex.fabric 재질 사진(없으면 코드로 그린 뜨개 결)
export function setFabricTex(name) { FAB = name && TEX[name]?.map ? TEX[name] : null; }
export const fabric = (hex) => (M['f' + hex + (FAB ? 'T' : '')] ??= FAB
  ? (() => { const map = FAB.map.clone(); map.repeat.set(3, 3); const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 1, map }); if (FAB.normal) { m.normalMap = FAB.normal.clone(); m.normalMap.repeat.set(3, 3); m.normalScale = new THREE.Vector2(0.9, 0.9); } return m; })()
  : new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 1, bumpMap: knit(), bumpScale: 1.2 }));

function mesh(geo, m, x, y, z, parent) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; }
function lathe(profile, m, x, y, z, parent, seg = 48) { return mesh(new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), seg), m, x, y, z, parent); }

// 책 한 권(등 = 앞 +z, 윗면은 종이색)
function book(p, x, y, z, w, h, d, color, tilt = 0) {
  const c = mat(color, 0.75), geo = new THREE.BoxGeometry(w, h, d);
  const b = new THREE.Mesh(geo, [c, c, PAGE, c, c, c]); b.castShadow = true; b.receiveShadow = true;
  b.position.set(x, y + h / 2, z); b.rotation.z = tilt; p.add(b); return b;
}
// x0 ~ x1 사이를 세운 책으로 채운다(끝 한 권은 기대 세운다)
function bookRow(p, x0, x1, y, z, depth, hMax) {
  let x = x0;
  while (x < x1 - 0.03) {
    const w = 0.018 + rnd() * 0.03, h = Math.min(hMax, 0.17 + rnd() * 0.1), d = Math.min(depth, 0.13 + rnd() * 0.07);
    if (x + w > x1) break;
    book(p, x + w / 2, y, z - (depth - d) / 2 + 0.01, w, h, d, pick(BOOK)); x += w + 0.002;
  }
  if (x1 - x > 0.06) { const h = Math.min(hMax, 0.2), w = 0.025; book(p, x + Math.sin(0.25) * h / 2 + w / 2, y, z, w, h, Math.min(depth, 0.16), pick(BOOK), -0.25); }
}
function bookStack(p, x, y, z, n = 3) {
  let yy = y; for (let i = 0; i < n; i++) { const t = 0.022 + rnd() * 0.015, w = 0.16 + rnd() * 0.06, d = 0.22 + rnd() * 0.05; const b = book(p, x + (rnd() - 0.5) * 0.02, yy, z, w, t, d, pick(BOOK)); b.rotation.y = (rnd() - 0.5) * 0.3; yy += t; }
  return yy;
}
function vase(p, x, y, z, h = 0.22, color = pick(CERAMIC), stems = true) {
  const r = h * 0.28;
  lathe([[0, 0], [r * 0.7, 0], [r, h * 0.25], [r * 0.9, h * 0.6], [r * 0.42, h * 0.85], [r * 0.45, h], [r * 0.38, h], [r * 0.36, h * 0.86], [0, h * 0.86]], mat(color, 0.55), x, y, z, p);
  if (stems) for (let i = 0; i < 3; i++) { const s = mesh(new THREE.CylinderGeometry(0.003, 0.003, h * 1.4, 6), mat('#6F7D55', 0.8), x + (i - 1) * 0.02, y + h + h * 0.55, z, p); s.rotation.z = (i - 1) * 0.25; const lf = mesh(new THREE.SphereGeometry(0.022, 12, 8), mat(i === 1 ? '#C8553D' : '#7E8F5E', 0.8), x + (i - 1) * 0.02 - Math.sin((i - 1) * 0.25) * h * 0.7, y + h + h * 1.22, z, p); lf.scale.set(1, 0.7, 1); }
}
function bowl(p, x, y, z, r = 0.12, color = pick(CERAMIC), fruit = false) {
  const h = r * 0.5;
  lathe([[0, 0], [r * 0.45, 0], [r * 0.48, 0.006], [r * 0.9, h * 0.6], [r, h], [r * 0.95, h], [r * 0.86, h * 0.62], [r * 0.4, 0.012], [0, 0.012]], mat(color, 0.45), x, y, z, p);
  if (fruit) for (const [dx, dz, c, s] of [[-0.03, 0.01, '#E8892E', 0.04], [0.035, -0.01, '#E8892E', 0.038], [0.0, 0.035, '#A9B83F', 0.037], [0.01, -0.035, '#C8302C', 0.036]]) mesh(new THREE.SphereGeometry(s, 20, 14), mat(c, 0.5), x + dx, y + 0.02 + s, z + dz, p);
}
function mug(p, x, y, z, color = pick(CERAMIC)) {
  const m = mat(color, 0.4);
  lathe([[0, 0], [0.038, 0], [0.04, 0.09], [0.036, 0.09], [0.034, 0.008], [0, 0.008]], m, x, y, z, p);
  const hd = mesh(new THREE.TorusGeometry(0.022, 0.006, 8, 20, Math.PI), m, x + 0.04, y + 0.045, z, p); hd.rotation.z = -Math.PI / 2;
}
function plate(p, x, y, z, r = 0.11, color = '#F2EFE8') { lathe([[0, 0], [r * 0.6, 0], [r, 0.014], [r * 0.96, 0.016], [r * 0.6, 0.006], [0, 0.006]], mat(color, 0.35), x, y, z, p); }
function cushion(p, x, y, z, w, h, color, tilt = -0.28) { // 솜이 찬 베개 모양(둥근 상자를 가운데 볼록하게)
  const geo = new RoundedBoxGeometry(w, h, 0.16, 6, 0.075), pos = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); const k = (1 - (2 * v.x / w) ** 2) * (1 - (2 * v.y / h) ** 2); v.z *= 0.55 + 0.65 * Math.max(0, k); pos.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals(); const c = mesh(geo, fabric(color), x, y + h / 2, z, p); c.rotation.x = tilt; return c;
}
function throwBlanket(p, x, y, z, w, d, color, drape = 0) { // 접은 담요(얇고 모서리 둥글게). drape > 0이면 +z 끝에서 그만큼 아래로 늘어뜨린다
  const m = fabric(color); mesh(new RoundedBoxGeometry(w, 0.022, d, 4, 0.01), m, x, y + 0.011, z, p);
  if (drape) { const h = mesh(new RoundedBoxGeometry(w, drape, 0.022, 4, 0.01), m, x, y - drape / 2 + 0.012, z + d / 2 + 0.006, p); h.rotation.x = 0.06; }
}
function tray(p, x, y, z, w = 0.3, d = 0.2, color = '#B08A64') { mesh(new RoundedBoxGeometry(w, 0.02, d, 3, 0.008), mat(color, 0.6), x, y + 0.01, z, p); return y + 0.02; }
function candle(p, x, y, z) { mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.07, 24), mat('#F4EFE4', 0.6), x, y + 0.035, z, p); }
function kettle(p, x, y, z) {
  lathe([[0, 0], [0.08, 0], [0.09, 0.05], [0.085, 0.14], [0.05, 0.19], [0.02, 0.2], [0, 0.2]], mat('#F2EFE8', 0.3), x, y, z, p);
  const h = mesh(new THREE.TorusGeometry(0.06, 0.008, 8, 24, Math.PI), mat('#1F1F1F', 0.4), x, y + 0.17, z, p); h.rotation.y = Math.PI / 2;
  const s = mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.09, 10), mat('#F2EFE8', 0.3), x + 0.1, y + 0.12, z, p); s.rotation.z = -0.9;
}
function board(p, x, y, z) { mesh(new RoundedBoxGeometry(0.36, 0.022, 0.24, 3, 0.01), mat('#C49A6C', 0.6), x, y + 0.011, z, p); }
function jar(p, x, y, z) {
  lathe([[0, 0], [0.055, 0], [0.055, 0.15], [0.05, 0.15], [0.05, 0.006], [0, 0.006]], mat('#E6DDCF', 0.5), x, y, z, p);
  for (let i = 0; i < 4; i++) { const s = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.26, 6), mat(i % 2 ? '#C49A6C' : '#1F1F1F', 0.5), x + (i - 1.5) * 0.015, y + 0.18, z + (i % 2 - 0.5) * 0.015, p); s.rotation.z = (i - 1.5) * 0.08; }
}
function bottle(p, x, y, z, color = '#5B6B3A') { lathe([[0, 0], [0.032, 0], [0.033, 0.16], [0.012, 0.21], [0.012, 0.25], [0, 0.25]], new THREE.MeshPhysicalMaterial({ color, roughness: 0.1, transmission: 0.3, thickness: 0.02 }), x, y, z, p, 24); }
function monitor(p, x, y, z) {
  mesh(new THREE.BoxGeometry(0.2, 0.012, 0.16), mat('#D9D9D9', 0.35, 0.6), x, y + 0.006, z, p);
  mesh(new THREE.BoxGeometry(0.035, 0.26, 0.025), mat('#D9D9D9', 0.35, 0.6), x, y + 0.13, z - 0.04, p);
  mesh(new THREE.BoxGeometry(0.62, 0.38, 0.022), mat('#2A2A2C', 0.3), x, y + 0.42, z - 0.02, p);
  const scr = mesh(new THREE.PlaneGeometry(0.6, 0.36), new THREE.MeshStandardMaterial({ color: '#BFD3DA', roughness: 0.2, emissive: new THREE.Color('#6E8FA6'), emissiveIntensity: 0.35 }), x, y + 0.42, z - 0.008, p); scr.castShadow = false;
}
function laptop(p, x, y, z, rot = 0) { // 열린 노트북(화면 105°)
  const L = new THREE.Group(); L.position.set(x, y, z); L.rotation.y = rot; p.add(L);
  const al = mat('#C9CBCD', 0.35, 0.7);
  mesh(new RoundedBoxGeometry(0.32, 0.012, 0.22, 2, 0.005), al, 0, 0.006, 0, L);
  mesh(new THREE.BoxGeometry(0.27, 0.001, 0.09), mat('#2A2A2C', 0.6), 0, 0.0125, -0.02, L);
  const lid = new THREE.Group(); lid.position.set(0, 0.012, -0.11); lid.rotation.x = -0.26; L.add(lid);
  mesh(new RoundedBoxGeometry(0.32, 0.21, 0.008, 2, 0.004), al, 0, 0.105, 0, lid);
  const scr = mesh(new THREE.PlaneGeometry(0.29, 0.18), new THREE.MeshStandardMaterial({ color: '#DCE6EA', roughness: 0.25, emissive: new THREE.Color('#9FB7C4'), emissiveIntensity: 0.45 }), 0, 0.108, 0.0045, lid); scr.castShadow = false;
}
function notebook(p, x, y, z, rot = 0, color = '#C8553D') { // 펼친 노트 + 펜
  const N = new THREE.Group(); N.position.set(x, y, z); N.rotation.y = rot; p.add(N);
  for (const s of [-1, 1]) { const pg = mesh(new THREE.BoxGeometry(0.15, 0.008, 0.21), PAGE, s * 0.077, 0.004 + (s > 0 ? 0.001 : 0), 0, N); pg.rotation.z = -s * 0.03; }
  mesh(new THREE.BoxGeometry(0.31, 0.003, 0.215), mat(color, 0.8), 0, 0.0015, 0, N);
  for (let i = 0; i < 7; i++) mesh(new THREE.BoxGeometry(0.12, 0.0005, 0.002), mat('#B9C4CC', 0.9), 0.077, 0.0092, -0.08 + i * 0.026, N);
  const pen = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 10).rotateZ(Math.PI / 2), mat('#1F1F1F', 0.4), 0.11, 0.013, 0.02, N); pen.rotation.y = 0.5;
}
function keyboard(p, x, y, z) { mesh(new RoundedBoxGeometry(0.42, 0.012, 0.13, 2, 0.004), mat('#F2F2F2', 0.4), x, y + 0.006, z, p); mesh(new RoundedBoxGeometry(0.06, 0.02, 0.1, 3, 0.009), mat('#F2F2F2', 0.4), x + 0.3, y + 0.01, z, p); }
function deskLamp(p, x, y, z, color = '#C8302C') {
  const m = mat(color, 0.3);
  mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.02, 32), m, x, y + 0.01, z, p);
  const a = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.36, 10), m, x + 0.04, y + 0.19, z, p); a.rotation.z = -0.22;
  lathe([[0.003, 0], [0.09, 0], [0.085, 0.03], [0.05, 0.1], [0.012, 0.12], [0, 0.12]], m, x + 0.1, y + 0.3, z, p).rotation.z = Math.PI + 0.35;
}
function mirror(p, x, y, z, r = 0.3) {
  const fr = mesh(new THREE.TorusGeometry(r, 0.012, 12, 64), mat('#C9A86A', 0.3, 0.8), x, y, z, p);
  const g = mesh(new THREE.CircleGeometry(r, 64), new THREE.MeshStandardMaterial({ color: '#C9CFCF', roughness: 0.12, metalness: 0.55, envMapIntensity: 0.12 }), x, y, z - 0.004, p); // 창밖 사진을 비추면 그림처럼 보여서 반사는 옅게 g.castShadow = false; fr.castShadow = false;
}
function towel(p, x, y, z, color = '#EFE9DF') { mesh(new RoundedBoxGeometry(0.28, 0.06, 0.2, 3, 0.025), mat(color, 1), x, y + 0.03, z, p); mesh(new RoundedBoxGeometry(0.28, 0.05, 0.2, 3, 0.022), mat('#8FA58A', 1), x, y + 0.085, z, p); }
function soap(p, x, y, z) { lathe([[0, 0], [0.035, 0], [0.035, 0.12], [0.012, 0.13], [0.012, 0.17], [0, 0.17]], mat('#E6DDCF', 0.4), x, y, z, p, 24); }
function smallPlant(p, x, y, z, fit) { const pl = fit?.('plant', 0.22, 0.22, 0.34); if (pl) { pl.position.set(x, y, z); p.add(pl); } else vase(p, x, y, z, 0.16); }

// 가구 g(가구 기준 좌표, 아직 집 안에 놓기 전) 윗면 높이: (x, z) 위에서 아래로 쏜 광선이 처음 닿는 곳
function topAt(g, x, z, fallback) {
  g.updateMatrixWorld(true);
  const hit = new THREE.Raycaster(new THREE.Vector3(x, 3, z), new THREE.Vector3(0, -1, 0), 0, 3.2).intersectObject(g, true)[0];
  return hit ? hit.point.y : fallback;
}

// 세트: 가구 종류·크기(w, d, h)와 g.userData.levels(선반 높이)를 보고 놓는다
export function addProps(f, g, fit) {
  const set = f.props; if (!set) return;
  seed = 7 + Math.round((f.x ?? 0) * 100 + (f.z ?? 0) * 37);
  const { w, d } = f, P = new THREE.Group(); P.userData.props = true;
  const on = (x, z, fb) => topAt(g, x, z, fb);
  if (set === 'books') { // 선반: 칸마다 책 줄 + 화병·작은 화분·눕힌 책·그릇을 번갈아
    const L = g.userData.levels ?? [], cell = g.userData.cells ?? [[-w / 2 + 0.03, w / 2 - 0.03]], top = g.userData.top;
    L.forEach((y, i) => cell.forEach(([a, b], j) => {
      const k = (i + j) % 4, dz = 0, mid = (a + b) / 2, hMax = (L[i + 1] ?? top ?? y + 0.32) - y - 0.03;
      if (k === 0 || k === 2) bookRow(P, a + 0.01, b - (k === 2 ? 0.12 : 0.01), y, dz, d - 0.04, hMax);
      if (k === 2) vase(P, b - 0.06, y, dz, Math.min(0.16, hMax * 0.6), pick(CERAMIC), false);
      if (k === 1) { const yy = bookStack(P, mid - 0.04, y, dz, 3); if (hMax > 0.2) bowl(P, mid + 0.02, yy, dz, 0.06); }
      if (k === 3) smallPlant(P, mid, y, dz, fit);
    }));
    if (top != null) { vase(P, -w / 2 + 0.12, top, 0, 0.26, '#F2EFE8'); bookStack(P, w / 2 - 0.16, top, 0, 2); }
  }
  if (set === 'cushions') { // 소파: 등받이 앞 쿠션 3개 + 팔걸이에 담요
    const seatZ = 0.0, y = on(0, seatZ, 0.45);
    [['#E9E2D6', -w * 0.3], ['#D9A63A', w * 0.02], ['#EFEAE1', w * 0.3]].forEach(([c, x], i) => cushion(P, x, y - 0.02, -d * 0.02, i === 1 ? 0.4 : 0.44, i === 1 ? 0.36 : 0.4, c)); // 등쿠션 바로 앞
    throwBlanket(P, -w / 2 + 0.12, on(-w / 2 + 0.1, 0.05, 0.6), 0.05, 0.2, d * 0.6, '#C98B6B', 0.18);
  }
  if (set === 'bedding') { // 침대(머리 = -z): 베개 앞 포인트 쿠션 + 발치에 접은 담요
    const y = on(0, -d * 0.15, 0.55);
    cushion(P, -0.18, y - 0.03, -d * 0.24, 0.42, 0.3, '#D9A63A', -0.4); cushion(P, 0.2, y - 0.03, -d * 0.23, 0.38, 0.28, '#8FA58A', -0.35);

  }
  if (set === 'dining') { const y = on(0, 0, 0.74); bowl(P, 0, y, 0, 0.13, '#F2EFE8', true); mug(P, -0.22, y, 0.12, '#E3B23C'); mug(P, 0.2, y, -0.1, '#8FA58A'); plate(P, 0.18, y, 0.16); vase(P, -0.12, y, -0.2, 0.18, '#D46A4C'); }
  if (set === 'kitchen') { // 조리대(싱크 = 0.15w, 화구 = -0.18w): 화구 위 주전자, 오른쪽 끝 그릇·작은 화분
    const y = f.h ?? 0.9, bz = -d / 2 + 0.14;
    kettle(P, -w * 0.18 - 0.12, y, 0.02);
    bowl(P, w / 2 - 0.2, y, 0.02, 0.1, '#E6DDCF'); bowl(P, w / 2 - 0.2, y + 0.03, 0.02, 0.085, '#D46A4C'); smallPlant(P, w / 2 - 0.1, y, 0.12, fit);
  }
  if (set === 'pantry') { const y = f.h ?? 0.9; tray(P, -0.2, y, 0); bowl(P, -0.2, y + 0.02, 0, 0.1, '#F2EFE8', true); vase(P, 0.25, y, -0.05, 0.24, '#F2EFE8'); }
  if (set === 'office') { // 책상(앞 = +z 쪽에 앉는다)
    const y = on(0, 0, 0.75), bz = -d / 2 + 0.12;
    laptop(P, -0.1, y, 0.0, 0.08); deskLamp(P, -w / 2 + 0.14, y, bz + 0.02); mug(P, w / 2 - 0.12, y, -0.12, '#D9A63A'); bookStack(P, w / 2 - 0.2, y, bz + 0.02, 3); smallPlant(P, 0.2, y, bz + 0.02, fit);
  }
  if (set === 'bath') { // 세면대: 위 벽 둥근 거울, 칫솔컵
    const y = on(0, 0, 0.85);
    mirror(P, 0, 1.45, -d / 2 + 0.01, Math.min(0.23, w * 0.5)); mug(P, -w / 2 + 0.08, y, -d / 2 + 0.08, '#8FA58A');

  }
  if (set === 'towel') { const y = on(0, 0, 0.6); towel(P, 0, y, 0); }
  if (set === 'reading') { const y = on(0, 0, 0.45); bookStack(P, 0, y, 0, 2); }
  if (set === 'tray') { const y = on(0, 0, 0.45); const yy = tray(P, 0, y, 0); candle(P, -0.06, yy, 0); mug(P, 0.07, yy, 0.02, '#E3B23C'); }
  g.add(P);
}
