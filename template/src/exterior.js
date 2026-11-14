// 창밖·현관 밖 3D: 2층 아파트 기준 — 아래층 건물 몸통, 잔디 땅, 산책길, 실사 나무(사진을 오린 판을 3D 자리에 세워 늘 카메라를 보게), 이웃 동, 하늘.
// 현관문 밖에는 공용 계단실(층계참·내려가는 계단·엘리베이터·이웃집 문)을 짓는다.
import * as THREE from 'three';

const TREE_FILES = ['tree-zelkova', 'tree-cherry', 'tree-pine'];

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

async function loadTex(url, srgb = true) {
  return new Promise(res => new THREE.TextureLoader().load(url, t => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; res(t); }, undefined, () => res(null)));
}

export class Exterior {
  constructor(scene, S, house) {
    this.scene = scene; this.S = S; this.house = house;
    this.group = new THREE.Group(); scene.add(this.group);
    this.cards = [];
    this.material = { opacity: 1, transparent: false }; // app.js가 위에서 보기 전환 때 만지는 자리(배경 원기둥과 같은 모양)
    this.level = S.floorLevel ?? 2;
    this.groundY = this.level <= 1 ? -0.3 : -(this.level - 1) * 3.4; // 층고 약 3.4m(바닥판 포함). 1층(단독주택)은 기단 30cm: 땅이 바닥과 같은 높이면 잔디가 마루를 뚫고 올라왔다
  }
  get visible() { return this.group.visible; }
  set visible(v) { this.group.visible = v; }

  async build(base = 'assets/ext') {
    const S = this.S, [W, D] = S.size, gy = this.groundY, H = this.house.H, R = rng(7);
    const [grass, paver, ...trees] = await Promise.all([loadTex(`${base}/grass.jpg`), loadTex(`${base}/paver.jpg`), ...TREE_FILES.map(n => loadTex(`${base}/${n}.png`))]);
    const bld = await loadTex(`${base}/building.png`);
    // 하늘: 위는 맑은 하늘색, 지평선 쪽은 흐린 흰색
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x7FAFE0) }, mid: { value: new THREE.Color(0xE6EEF3) }, bot: { value: new THREE.Color(0xDDE3D8) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.55, h)) : mix(mid, bot, smoothstep(0.0, 0.2, -h)); gl_FragColor = vec4(c, 1.0); }',
    }));
    sky.renderOrder = -20; sky.userData.noAO = true; this.group.add(sky);
    // 땅(잔디) 300m, 2m마다 사진 한 장
    if (grass) { grass.wrapS = grass.wrapT = THREE.RepeatWrapping; grass.repeat.set(150, 150); }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: grass, color: grass ? 0xFFFFFF : 0x6E8F4E, roughness: 0.95 }));
    ground.position.set(W / 2, gy, D / 2); ground.receiveShadow = true; this.group.add(ground);
    // 아래층 건물 몸통(이 집 바닥 아래 ~ 땅) + 층 사이 띠
    const facade = new THREE.MeshStandardMaterial({ color: 0xE9E4DA, roughness: 0.85 });
    const podium = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, -gy - 0.06, D + 0.4), facade);
    podium.position.set(W / 2, gy + (-gy - 0.06) / 2, D / 2); podium.castShadow = podium.receiveShadow = true; this.group.add(podium);
    const band = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, 0.25, D + 0.5), new THREE.MeshStandardMaterial({ color: 0xCFC8BC, roughness: 0.8 }));
    band.position.set(W / 2, -0.18, D / 2); this.group.add(band);
    // 산책길: 건물 둘레 6m 밖으로 1.6m 폭 띠
    if (paver) { paver.wrapS = paver.wrapT = THREE.RepeatWrapping; }
    const pathMat = new THREE.MeshStandardMaterial({ map: paver, color: paver ? 0xFFFFFF : 0xB8AE9F, roughness: 0.9 });
    const off = 6, pw = 1.6;
    for (const [x0, z0, x1, z1] of [[-off - pw, -off - pw, W + off + pw, -off], [-off - pw, D + off, W + off + pw, D + off + pw], [-off - pw, -off, -off, D + off], [W + off, -off, W + off + pw, D + off]]) {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / 1.2, uv.getY(i) * (z1 - z0) / 1.2);
      const m = new THREE.Mesh(g, pathMat); m.position.set((x0 + x1) / 2, gy + 0.01, (z0 + z1) / 2); m.receiveShadow = true; this.group.add(m);
    }
    // 나무: 건물 둘레 3~22m, 길 위는 피한다. 키 7~11m(2층 눈높이에 가지가 걸리게)
    const blob = blobTexture();
    const near = (x, z) => x > -5 && x < W + 5 && z > -5 && z < D + 5;
    const onPath = (x, z) => { const ox = x < -off ? -off - x : x > W + off ? x - W - off : 0, oz = z < -off ? -off - z : z > D + off ? z - D - off : 0; const d = Math.max(ox, oz); return d > -0.6 && d < pw + 0.6 && (ox > 0 || oz > 0); };
    const avoid = this.avoidZones = [];
    let placed = 0;
    for (let k = 0; k < 400 && placed < 46; k++) {
      const x = -22 + R() * (W + 44), z = -22 + R() * (D + 44);
      if (near(x, z) || onPath(x, z) || avoid.some(([ax, az, r]) => Math.hypot(x - ax, z - az) < r)) continue;
      const dEdge = Math.max(-x, x - W, -z, z - D), pk = R(), ti = dEdge < 12 ? (pk < 0.55 ? 0 : 1) : pk < 0.45 ? 0 : pk < 0.85 ? 1 : 2, tex = trees[ti]; if (!tex) continue; // 창에서 가까운 나무는 활엽수만
      const h = 7 + R() * 4, w = h * tex.image.width / tex.image.height;
      this.addCard(tex, x, gy, z, w, h, 0.02); avoid.push([x, z, w * 0.45]);
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, w * 0.7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false }));
      sh.position.set(x, gy + 0.02, z); sh.renderOrder = 1; this.group.add(sh);
      placed++;
    }
    // 먼 나무 띠: 25~75m 둘레에 140그루(지평선이 비지 않게)
    for (let k = 0; k < 140; k++) {
      const a = R() * Math.PI * 2, rr = 25 + Math.pow(R(), 0.7) * 50, x = W / 2 + Math.cos(a) * rr, z = D / 2 + Math.sin(a) * rr;
      if (onPath(x, z)) continue;
      const pk = R(), tex = trees[pk < 0.45 ? 0 : pk < 0.85 ? 1 : 2]; if (!tex) continue;
      const h = 8 + R() * 6; this.addCard(tex, x, gy, z, h * tex.image.width / tex.image.height, h, 0.02);
    }
    // 이웃 동: 40~65m 밖 네 방향
    if (bld) for (const [x, z, w] of [[W / 2 - 10, -48, 34], [W + 52, D / 2 + 6, 30], [-50, D / 2 - 8, 32], [W / 2 + 14, D + 58, 36]]) this.addCard(bld, x, gy, z, w, w * bld.image.height / bld.image.width, 0);
    this.buildCorridor();
    return this;
  }
  // 사진 판: 세로축으로만 돌아 늘 카메라를 본다
  addCard(tex, x, y, z, w, h, sink) {
    // 같은 사진이 복제처럼 보이지 않게: 좌우 뒤집기 · 밝기·색 조금씩 · 멀수록 하늘색으로 흐리게(대기 원근)
    const R = this._r ??= rng(31), d = Math.hypot(x - this.S.size[0] / 2, z - this.S.size[1] / 2), k = Math.min(0.5, Math.max(0, (d - 12) / 110));
    const tint = new THREE.Color().setHSL(0.24 + (R() - 0.5) * 0.04, 0.35 + R() * 0.2, 0.5 + (R() - 0.5) * 0.12).lerp(new THREE.Color(1, 1, 1), 0.55);
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, metalness: 0, color: tint.multiplyScalar(1 - k), emissive: new THREE.Color(0xC9D6DE), emissiveIntensity: k * 0.45 }); // 너무 뿌옇게 하면 이웃 동이 흰 덩어리로 보였다
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h).translate(0, h / 2 - sink * h, 0), mat);
    if (R() < 0.5) m.scale.x = -1;
    m.position.set(x, y, z); m.userData.noAO = true; this.group.add(m); this.cards.push(m);
  }
  update(cam) { for (const c of this.cards) c.rotation.y = Math.atan2(cam.position.x - c.position.x, cam.position.z - c.position.z); }

  // 현관문 밖 공용 계단실
  buildCorridor() {
    const S = this.S, H = this.house.H;
    if (S.corridor === false) return; // 단독주택: 현관 밖은 마당 그대로
    const door = S.openings.find(o => o.type === 'door' && o.exterior); if (!door) return;
    const horiz = Math.abs(door.b[0] - door.a[0]) >= Math.abs(door.b[1] - door.a[1]);
    const c = [(door.a[0] + door.b[0]) / 2, (door.a[1] + door.b[1]) / 2];
    let n = horiz ? [0, 1] : [1, 0];
    { // 바깥 쪽: 문 위 다섯 점 × 깊이 세 곳에서 방에 닿는 수를 양쪽으로 세어 적은 쪽(문 가운데 한 점만 보면 문이 현관 칸보다 넓을 때 안팎을 거꾸로 잡았다)
      const hits = sg => { let k = 0; for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const dd of [0.3, 0.6, 1.0]) { const x = door.a[0] + (door.b[0] - door.a[0]) * f, z = door.a[1] + (door.b[1] - door.a[1]) * f; if (this.house.roomAt(x + n[0] * sg * dd, z + n[1] * sg * dd)) k++; } return k; };
      if (hits(1) > hits(-1)) n = [-n[0], -n[1]];
    }
    const u = [n[1], -n[0]], t0 = door.t / 2 + 0.01;
    const P = (uu, nn, y = 0) => new THREE.Vector3(c[0] + u[0] * uu + n[0] * (t0 + nn), y, c[1] + u[1] * uu + n[1] * (t0 + nn));
    const box = (uu0, uu1, nn0, nn1, y0, y1, mat) => {
      const a = P(uu0, nn0), b = P(uu1, nn1), sx = Math.abs(b.x - a.x), sz = Math.abs(b.z - a.z);
      const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(sx, 0.001), y1 - y0, Math.max(sz, 0.001)), mat);
      m.position.set((a.x + b.x) / 2, (y0 + y1) / 2, (a.z + b.z) / 2); m.castShadow = m.receiveShadow = true; this.group.add(m); return m;
    };
    const wall = new THREE.MeshStandardMaterial({ color: 0xD6D4CF, roughness: 0.9 });
    const floor = new THREE.MeshStandardMaterial({ color: 0x86827C, roughness: 0.55 }); // 공용부 콘크리트 타일(실내보다 어둡게)
    const metal = new THREE.MeshStandardMaterial({ color: 0x9A9D9F, roughness: 0.55, metalness: 0.6 }); // 매끈하면 천장등이 하얀 점으로 비쳤다
    const dark = new THREE.MeshStandardMaterial({ color: 0x5E5A55, roughness: 0.6 });
    // 계단실 크기는 문 앞의 "정말 빈 바깥"에 맞춘다: 어느 방에도 속하지 않고 벽에서 0.1m 넘게 떨어진 곳까지만 넓힌다
    // (현관이 건물의 움푹 들어간 곳에 있으면 고정 크기 상자가 옆방 안까지 뻗어 주방 한가운데 벽·천장 겹침이 생겼다)
    const segd = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L)); return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz); };
    const blocked = (uu, nn) => { const p = P(uu, nn); return !!this.house.roomAt(p.x, p.z) || S.walls.some(w => segd(p.x, p.z, w.a, w.b) < w.t / 2 + 0.1); };
    const free = (u0, u1, n0, n1) => { for (let uu = u0; uu <= u1 + 1e-6; uu += 0.1) for (let nn = n0; nn <= n1 + 1e-6; nn += 0.1) if (blocked(uu, nn)) return false; return true; };
    let ND = 0.3; while (ND < 2.6 && free(-0.5, 0.5, ND, ND + 0.1)) ND += 0.1;   // 문 앞으로 얼마나 비었나
    if (ND < 1.2) return; // 문 앞이 1.2m도 안 비면 계단실을 짓지 않는다
    let UL = -0.5, UR = 0.5;
    while (UL > -3.0 && free(UL - 0.1, UL - 0.1, 0.1, ND)) UL -= 0.1;
    while (UR < 2.4 && free(UR + 0.1, UR + 0.1, 0.1, ND)) UR += 0.1;
    const T = 0.18;
    box(UL, UR, 0, ND, -0.25, -0.02, floor);                     // 층계참 바닥
    box(UL, UR, ND - T, ND, -0.3, H, wall);                      // 맞은편 벽
    box(UR - T, UR, 0, ND - T, -0.3, H, wall);                   // 오른쪽 벽
    box(UL, UL + T, 0, ND - T, -1.8, H, wall);                   // 왼쪽 벽
    const ceil = box(UL, UR, 0, ND, H - 0.001 + 0.004, H + 0.12, wall); // 천장(집 천장보다 4mm 위: 같은 높이면 겹쳐 깜빡인다)
    const IN = ND - T; // 맞은편 벽 안쪽 면
    // 내려가는 계단: 왼쪽에 1.4m 넘게 남으면(문 왼쪽, 맞은편 벽 쪽으로 9단)
    const sL = UL + T, sR = Math.min(-0.65, sL + 1.5);
    if (sR - sL >= 1.0) {
      const run = Math.min(0.27, (IN - 0.4) / 9);
      for (let i = 0; i < 9; i++) box(sL, sR, i * run, (i + 1) * run, -0.25 - (i + 1) * 0.165, -0.02 - i * 0.165, floor);
      const rail = new THREE.MeshStandardMaterial({ color: 0x3C3A38, roughness: 0.4, metalness: 0.6 });
      box(sR - 0.03, sR + 0.03, 0, 9 * run, 0.85, 0.9, rail);
      for (let i = 0; i <= 6; i++) box(sR - 0.01, sR + 0.01, i * 9 * run / 6, i * 9 * run / 6 + 0.02, -0.02, 0.88, rail);
    }
    // 엘리베이터(문 정면) · 이웃집 문(오른쪽에 자리가 있으면)
    const eL = Math.max(UL + T + 0.1, -0.7), eR = Math.min(UR - T - 0.1, 0.7);
    if (eR - eL >= 1.1) {
      box(eL, eR, IN - 0.03, IN, 0, 2.15, dark);
      const m = (eL + eR) / 2; box(eL + 0.1, m - 0.01, IN - 0.05, IN - 0.03, 0.02, 2.08, metal); box(m + 0.01, eR - 0.1, IN - 0.05, IN - 0.03, 0.02, 2.08, metal);
    }
    if (UR - T - 0.1 - (eR + 0.25) >= 0.95) {
      const a0 = eR + 0.25; box(a0, a0 + 0.95, IN - 0.03, IN, 0, 2.1, new THREE.MeshStandardMaterial({ color: 0x5C564F, roughness: 0.45, metalness: 0.35 }));
      box(a0 + 0.1, a0 + 0.16, IN - 0.07, IN - 0.03, 0.95, 1.1, metal);
      box(a0 + 0.4, a0 + 0.6, IN - 0.035, IN - 0.03, 1.75, 1.85, new THREE.MeshStandardMaterial({ color: 0xE8E2D4, roughness: 0.6 }));
    }
    // 천장 등(빛나는 원판 + 약한 점광)
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.2, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xA9ACAD }));
    lamp.position.copy(P(0.3, ND / 2, H - 0.005)); this.group.add(lamp);
    const pl = new THREE.PointLight(0xEEF3F7, 0.55, 5, 2); // 공용부 형광등 느낌(실내보다 차갑게)
    pl.position.copy(P(0.3, ND / 2, H - 0.3)); this.group.add(pl);
    // 카메라가 계단실 벽을 뚫지 않게
    for (const m of [ceil]) this.house.walls.push(m);
    this.corridor = { c, n, u, UL, UR, ND, inside: (uu, nn) => { const p = P(uu, nn); return !!this.house.roomAt(p.x, p.z); } };
  }
}

function blobTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  gr.addColorStop(0, 'rgba(30,40,20,0.35)'); gr.addColorStop(1, 'rgba(30,40,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}
