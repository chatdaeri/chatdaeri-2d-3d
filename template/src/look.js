// 실사 보기: 재질 사진 불러오기, 미터 단위 UV, 창밖 배경·하늘 조명, 후처리(MSAA·주변광 가림·빛 번짐)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// 재질 사진 한 장이 덮는 실제 크기(m)
export const TILE = { plaster: 2.0, oak: 1.0, oakfloor: 1.6, limestone: 1.2, travertine: 1.8 };
TILE.porcelain = 1.2;
// style.tex로 고르는 재질(사진 → make_tex.py: 조명 얼룩 제거·이음매·노멀맵). 쓰는 장면만 불러온다
Object.assign(TILE, { limewash: 2.4, oakwide: 1.5, porcelainstone: 1.2, zellige: 0.6, wool: 0.5, boucle: 0.3 });
const BASE = ['plaster', 'oak', 'oakfloor', 'limestone', 'travertine']; // 60×60 포세린 타일 2×2장(코드로 그린 질감, scene.style.floor === 'porcelain')
export const TEX = {};

export async function loadLook(renderer, view = 'forest') {
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = (url, srgb) => new Promise(res => loader.load(url, t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    res(t);
  }, undefined, () => res(null)));
  await Promise.all(BASE.map(async n => { // porcelain은 코드로 그리고, style.tex 재질은 loadExtraTex로
    const [map, normal] = await Promise.all([load(`assets/tex/${n}.jpg`, true), load(`assets/tex/${n}_n.jpg`, false)]);
    TEX[n] = { map, normal };
  }));
  TEX.porcelain = { map: porcelainMap(renderer), normal: null };
  TEX.view = await load(`assets/tex/${view}.jpg`, true) ?? await load('assets/tex/forest.jpg', true);
  if (TEX.view) TEX.view.wrapT = THREE.ClampToEdgeWrapping;
  return TEX;
}

// 60×60 라이트그레이 포세린 타일: 아주 옅은 얼룩 + 3mm 줄눈(사진 없이 코드로 그린다)
function porcelainMap(renderer) {
  const N = 1024, cv = document.createElement('canvas'); cv.width = cv.height = N; const g = cv.getContext('2d');
  g.fillStyle = '#DEDCD7'; g.fillRect(0, 0, N, N);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2600; i++) { const x = rnd() * N, y = rnd() * N, r = 6 + rnd() * 40, a = 0.012 + rnd() * 0.02; g.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(150,146,140,${a})`; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#BEBBB5'; const gw = 4; for (const k of [0, N / 2]) { g.fillRect(k - gw / 2, 0, gw, N); g.fillRect(0, k - gw / 2, N, gw); g.fillRect(N - gw / 2, 0, gw, N); g.fillRect(0, N - gw / 2, N, gw); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

export async function loadExtraTex(renderer, names) {
  const loader = new THREE.TextureLoader(), aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = (url, srgb) => new Promise(res => loader.load(url, t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, () => res(null)));
  await Promise.all([...new Set(names)].filter(n => n && !TEX[n]).map(async n => { const [map, normal] = await Promise.all([load(`assets/tex/${n}.jpg`, true), load(`assets/tex/${n}_n.jpg`, false)]); if (map) TEX[n] = { map, normal }; }));
}

export function texMat(name, opt = {}) {
  const t = TEX[name] ?? {};
  const { bump, ...rest } = opt;
  const m = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.85, metalness: 0, ...rest });
  if (t.map) m.map = t.map;
  if (t.normal) { m.normalMap = t.normal; m.normalScale = new THREE.Vector2(bump ?? 0.5, bump ?? 0.5); }
  return m;
}

// 형상의 지역 좌표로 UV를 다시 매긴다(면 방향에 따라 xz·zy·xy 투영, tile m마다 한 번)
export function meterUV(geo, tile, off = [0, 0, 0]) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  if (!p || !n || !uv) return geo;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + off[0], y = p.getY(i) + off[1], z = p.getZ(i) + off[2];
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, x / tile, -z / tile);
    else if (ax >= az) uv.setXY(i, (n.getX(i) > 0 ? -z : z) / tile, y / tile);
    else uv.setXY(i, (n.getZ(i) > 0 ? x : -x) / tile, y / tile);
  }
  uv.needsUpdate = true;
  return geo;
}

// 창밖 띠로 하늘 조명
export function viewEnvironment(renderer) {
  const W = 2048, H = 1024, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, H * 0.5);
  sky.addColorStop(0, '#F7F4EC'); sky.addColorStop(1, '#ECE8DC');
  g.fillStyle = sky; g.fillRect(0, 0, W, H * 0.5);
  g.fillStyle = '#8A8670'; g.fillRect(0, H * 0.5, W, H * 0.5);
  const img = TEX.view?.image;
  if (img) for (let k = 0; k < 2; k++) g.drawImage(img, k * W / 2, H * 0.32, W / 2, H * 0.22);
  const t = new THREE.CanvasTexture(cv); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(t).texture;
  t.dispose(); pmrem.dispose();
  return env;
}

// 집을 두르는 창밖 배경(원기둥 안쪽 면). floorY = 배경 사진 아래끝 높이(고층이면 바닥보다 아래)
export function viewBackdrop(center, R, floorY = -1.2, horizonY = null) {
  const tex = TEX.view;
  if (!tex) return new THREE.Group();
  const rep = tex.image.width / tex.image.height > 3.5 ? 2 : 3; // 좌우를 뒤집어 붙인 긴 사진은 이음매 없이 2번
  const Hc = (2 * Math.PI * R) / rep / (tex.image.width / tex.image.height);
  // 발코니 전면 유리로는 아래까지 보인다 → 숲 사진 밑에 땅(원판)을 깔아 빈 바탕이 보이지 않게(사진을 늘리면 세로 줄무늬가 생겼다)
  const extra = 0, Ht = Hc + extra;
  tex.repeat.set(rep, Ht / Hc); tex.offset.set(0, -extra / Hc);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, toneMapped: false, depthWrite: false });
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(R, R, Ht, 96, 1, true), mat);
  cyl.position.set(center.x, horizonY ?? floorY - extra + Ht / 2, center.z); // horizonY: 사진 가운데(지평선) 높이
  cyl.renderOrder = -10; cyl.userData.noAO = true;
  // 땅: 숲 사진 아랫단과 같은 높이, 색은 사진 맨 아랫줄 평균
  let ground = 0x3E3A2C;
  try { const c = document.createElement('canvas'); c.width = 64; c.height = 1; const g = c.getContext('2d'); g.drawImage(tex.image, 0, tex.image.height - 2, tex.image.width, 2, 0, 0, 64, 1); const d = g.getImageData(0, 0, 64, 1).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } const n = d.length / 4; ground = (Math.round(r / n) << 16) | (Math.round(gg / n) << 8) | Math.round(b / n); } catch (e) { /* 사진을 못 읽으면 기본색 */ }
  const cap = new THREE.Mesh(new THREE.CircleGeometry(R, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ground, fog: false, toneMapped: false, depthWrite: false, transparent: true }));
  cap.position.y = -Ht / 2 + 0.01; cap.renderOrder = -10; cap.userData.noAO = true;
  cyl.add(cap);
  return cyl;
}

export class Post {
  constructor(renderer, scene, camera) {
    const size = renderer.getSize(new THREE.Vector2());
    // MSAA 4배: 벽·가구 모서리 계단 현상을 줄인다
    const rt = new THREE.WebGLRenderTarget(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.ao = new GTAOPass(scene, camera, size.x, size.y);
    this.ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.0, scale: 1.0, samples: 12 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.ao.blendIntensity = 0.8;
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(size, 0.16, 0.5, 0.93);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.enabled = true;
  }
  setSize(w, h, dpr) { this.composer.setPixelRatio(dpr); this.composer.setSize(w, h); }
  render(dt) { this.composer.render(dt); }
}
