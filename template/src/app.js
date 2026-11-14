// 평면도 투어 본체: scene.json → 집·붙박이 설비·가구, 눈높이 1인칭/위에서 보기 카메라, 바닥 클릭 이동, 자동 투어, 방 목록·미니맵
// 조작: 끌기 = 둘러보기, 방향키 = 걷기, 휠 = 화각
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadLook, loadExtraTex, viewEnvironment, viewBackdrop, Post } from './look.js';
import { House } from './house.js';
import { Furniture } from './furniture.js';
import { Nav } from './nav.js';
import { Exterior } from './exterior.js';

const $ = s => document.querySelector(s);
const gsap = window.gsap; // vendor/motion/gsap.min.js (index.html에서 먼저 불러옴)
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

// 전후 비교(make_compare.py가 만든 페이지 안에서): ?compare=lead → '후' 사이트(조작·UI·그리기, 캔버스 왼쪽을 잘라 아래 '전'이 보이게)
// ?compare=mirror → '전' 사이트(UI·조작 없음, '후'가 그릴 때마다 같은 카메라로 따라 그린다)
const COMPARE = new URLSearchParams(location.search).get('compare');
if (COMPARE) document.documentElement.classList.add(`compare-${COMPARE}`);

class Tour {
  async boot() {
    const bar = $('#load i'), txt = $('#load p');
    const step = (p, t) => { bar.style.width = `${Math.round(p * 100)}%`; if (t) txt.textContent = t; };
    step(0.05, '평면도를 읽는 중');
    const S = this.S = await (await fetch('scene.json')).json();
    document.title = `${S.name} · 3D 투어`;
    $('#title').textContent = S.name;
    const total = S.rooms.reduce((n, r) => n + (r.stated ?? r.area), 0);
    $('#sub').textContent = `${S.rooms.filter(r => r.type === 'bedroom').length}룸 · 실내 ${total.toFixed(1)}㎡`;
    // 렌더러
    const R = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    R.setPixelRatio(Math.min(2, devicePixelRatio)); R.outputColorSpace = THREE.SRGBColorSpace;
    R.toneMapping = THREE.ACESFilmicToneMapping; this.expo = S.style?.exposure ?? 1; R.toneMappingExposure = 1.08 * this.expo; // style.exposure: 흰 마감이 많은 집은 낮춘다
    R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
    $('#stage').append(R.domElement);
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0xECE8DE);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
    step(0.15, '재질을 불러오는 중');
    await loadLook(R, S.view);
    if (S.style?.tex) await loadExtraTex(R, Object.values(S.style.tex)); // style.tex: 벽·마루·타일·직물·러그·주방 벽 재질 사진
    this.scene.environment = viewEnvironment(R); this.scene.environmentIntensity = 1.0;
    const [W, D] = S.size, C = { x: W / 2, z: D / 2 };
    // 창밖: scene.exterior === '3d'면 3D 바깥(땅·나무·이웃 동·계단실, 집을 지은 뒤 만든다), 아니면 풍경 사진 원기둥
    if (S.exterior !== '3d') { this.backdrop = viewBackdrop(C, Math.max(W, D) / 2 + 16, -4, S.floorLevel ? 1.45 : null); this.scene.add(this.backdrop); } // 2층 같은 낮은 층: 사진 지평선 = 눈높이
    step(0.35, '벽을 세우는 중');
    this.house = new House(this.scene, S).build();
    if (S.exterior === '3d') { this.ext = await new Exterior(this.scene, S, this.house).build(); this.backdrop = this.ext; }
    this.lights(S);
    step(0.5, '가구를 들이는 중');
    this.furn = await new Furniture(this.scene, S).build();
    // 카메라가 멈출 것: 벽 + 열린 문짝 + 1m 넘는 가구(장·냉장고·TV·상부장 등)
    // 카메라를 당기는 것: 벽·키 큰 가구. 문짝은 당기지 않고 시야를 가리면 반투명하게 한다
    this.blockers = [...this.house.walls, ...this.furn.group.children.filter(o => o.userData.h >= 1.0)];
    this.leaves = this.house.doors.flatMap(d => d.children);
    for (const l of this.leaves) { l.material = l.material.clone(); l.userData.fade = 1; }
    // 문(과 1.2m 미만 트임)은 가운데로 곧게 지나간다
    this.nav = new Nav(S.nav, S.openings.filter(o => o.type === 'door' || ((o.type === 'open' || o.type === 'slide') && Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]) < 1.2)));
    step(0.75, '눈높이 카메라를 놓는 중');
    this.makeWalker();
    this.post = new Post(R, this.scene, this.camera);
    this.orbit = new OrbitControls(this.camera, $('#stage'));
    this.orbit.enabled = false; this.orbit.enableDamping = true; this.orbit.target.set(C.x, 0, C.z);
    this.orbit.minPolarAngle = 0.15; this.orbit.maxPolarAngle = 1.25; this.orbit.minDistance = 4; this.orbit.maxDistance = Math.max(W, D) * 2.2;
    this.cam = { yaw: Math.PI, dist: 3.0, manualT: -10, pitch: 0.06 }; // dist = 휠로 바꾸는 화각 값
    this.mode = 'follow'; this.frameNo = 0;
    this.ui(); this.input();
    const [sx, sz] = this.nav.nearest(...S.start) ?? S.start;
    this.walker.position.set(sx, 0, sz);
    // 처음 방향: 가장 넓은 방 쪽
    const big = [...S.rooms].sort((a, b) => b.area - a.area)[0];
    if (big) this.walker.heading = this.cam.yaw = Math.atan2(big.center[0] - sx, big.center[1] - sz);
    this.onResize(); addEventListener('resize', () => this.onResize());
    this.clock = new THREE.Timer(); this.clock.connect?.(document);
    if (COMPARE === 'mirror') { // 스스로 돌지 않고 '후' 사이트가 부를 때만 그린다
      this.setMode('dollhouse', { instant: true }); $('#load').hidden = true; window.tour = this;
      parent.postMessage({ compare: 'ready', side: 'before' }, '*'); return;
    }
    R.setAnimationLoop(() => this.loop());
    step(1, '준비됨');
    if (COMPARE === 'lead') parent.postMessage({ compare: 'ready', side: 'after' }, '*');
    // 불러오기 막이 걷히고 화면 요소가 차례로 들어온다
    gsap.to('#load', { autoAlpha: 0, duration: 0.7, delay: 0.15, ease: 'power2.out', onComplete: () => { $('#load').hidden = true; } });
    gsap.from(['#head', '#side', '#bar', '#help', '#hint'], { autoAlpha: 0, y: 14, duration: 0.7, delay: 0.35, stagger: 0.08, ease: 'power3.out', clearProps: 'transform' });
    // 첫 화면 = 집 전체(위에서 보기). 처음 조작하면 안내 한 줄은 사라진다
    this.setMode('dollhouse', { instant: true });
    const hideHint = () => { gsap.to('#hint', { autoAlpha: 0, duration: 0.4 }); removeEventListener('pointerdown', hideHint, true); removeEventListener('keydown', hideHint, true); };
    addEventListener('pointerdown', hideHint, true); addEventListener('keydown', hideHint, true);
    window.tour = this;
    // 검수용 캡처: ?shots=1 → 방마다 눈높이 장면 · ?shots=tour → 투어 중 실제 화면. window.__shots 에 두고 qa_run.py 로 보낸다
    if (new URLSearchParams(location.search).get('shots')) setTimeout(async () => {
      const Q = await import('./qa.js'); const shots = window.__shots = await (new URLSearchParams(location.search).get('shots') === 'tour' ? Q.takeTourShots(this) : Q.takeShots(this, 7, new URLSearchParams(location.search).get('shots') === 'angles'));
      for (const [i, sh] of shots.entries()) await fetch(`__shot?i=${i + 1}&name=${encodeURIComponent(sh.name)}`, { method: 'POST', body: sh.url }).catch(() => {});
      fetch('__qa_result', { method: 'POST', body: JSON.stringify({ 시나리오: 'shots', n: shots.length }) }).catch(() => {});
    }, 1500);
    // 자동 검사: ?qa=tour 또는 ?qa=corners → 끝나면 결과를 화면 왼쪽 위와 window.__qa 에 둔다
    const qa = new URLSearchParams(location.search).get('qa');
    if (qa) setTimeout(async () => {
      const { runQA } = await import('./qa.js'); const r = await runQA(this, qa); window.__qa = r;
      const box = document.createElement('pre'); box.id = 'qa-result';
      Object.assign(box.style, { position: 'fixed', left: '12px', top: '12px', zIndex: 50, maxWidth: '46vw', maxHeight: '80vh', overflow: 'auto', background: r.합격 ? 'rgba(230,248,236,.95)' : 'rgba(255,236,232,.95)', padding: '12px 14px', borderRadius: '10px', font: '12px/1.45 ui-monospace,monospace', whiteSpace: 'pre-wrap' });
      box.textContent = `${r.합격 ? '합격' : '불합격'} · ${qa}\n` + JSON.stringify(r, null, 1); document.body.append(box); console.log('QA', JSON.stringify(r));
      fetch('__qa_result', { method: 'POST', body: JSON.stringify(r) }).catch(() => {}); // qa_run.py(창 없는 검사)가 받는다. 보통 서버에서는 그냥 실패하고 끝
    }, 1500);
  }

  lights(S) {
    const [W, D] = S.size, C = new THREE.Vector3(W / 2, 0, D / 2);
    this.scene.add(new THREE.HemisphereLight(0xFFFFFF, 0xE6E0D4, 0.95 * (S.style?.ambient ?? 1))); // 흰 벽이 회색으로 가라앉지 않게 고른 하늘빛(style.ambient로 줄이면 그림자가 산다)
    // 해: 가장 넓은 바깥 유리(미닫이·창) 쪽에서 비스듬히
    let best = null;
    for (const o of S.openings) if (o.exterior && (o.type === 'slide' || o.type === 'window')) { const L = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]) * (o.type === 'slide' ? 2 : 1); if (!best || L > best.L) best = { o, L }; }
    let dir = new THREE.Vector3(0.35, 0.62, 0.7);
    if (best) { const m = [(best.o.a[0] + best.o.b[0]) / 2 - C.x, (best.o.a[1] + best.o.b[1]) / 2 - C.z]; const l = Math.hypot(...m) || 1; dir = new THREE.Vector3(m[0] / l * 0.75 + 0.25, 0.6, m[1] / l * 0.75 + 0.1); }
    dir.normalize();
    const sun = this.sun = new THREE.DirectionalLight(0xFFE8CC, 3.2);
    sun.position.copy(C).addScaledVector(dir, 30); sun.target.position.copy(C);
    sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.03; sun.shadow.radius = 4;
    const r = Math.max(W, D) * 0.8; Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 70 }); sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(0xFFF6EC, 0.35); fill.position.set(C.x - 3, 10, C.z - 4); fill.target.position.copy(C); this.scene.add(fill, fill.target);
  }

  // 걷는 자리: 화면에 그리지 않는 점 하나. 카메라(눈높이)·걷는 길·미니맵이 이 자리를 따른다
  makeWalker() {
    const root = new THREE.Group(); this.scene.add(root);
    this.walker = { root, get position() { return root.position; }, heading: 0, speed: 0, state: 'idle' };
  }

  // ---------- 입력 ----------
  input() {
    const el = this.renderer.domElement, stage = $('#stage'); // 누르기·휠은 #stage에서 받는다(전후 비교로 캔버스 일부를 잘라도 그 자리 조작이 된다)
    if (COMPARE === 'mirror') return;
    this.keys = new Set();
    addEventListener('keydown', e => { if (e.target.closest?.('input, textarea, select, [contenteditable]')) return; this.keys.add(e.code); if (/^(Arrow|Key[WASD])/.test(e.code)) { this.stopTour(); this.path = null; e.preventDefault(); } });
    addEventListener('keyup', e => this.keys.delete(e.code));
    let down = null;
    stage.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, yaw: this.cam.yaw, pitch: this.cam.pitch, moved: false }; });
    addEventListener('pointermove', e => {
      if (!down || this.mode !== 'follow') return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.hypot(dx, dy) > 4) down.moved = true;
      if (down.moved) { this.cam.yaw = down.yaw - dx * 0.006; this.cam.pitch = Math.max(-0.6, Math.min(0.75, down.pitch + dy * 0.004)); this.cam.manualT = this.t; }
    });
    addEventListener('pointerup', e => {
      if (down && !down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && (e.target === el || e.target === stage)) this.clickFloor(e);
      down = null;
    });
    stage.addEventListener('wheel', e => { if (this.mode === 'follow') { this.cam.dist = Math.max(1.2, Math.min(4.5, this.cam.dist + e.deltaY * 0.002)); e.preventDefault(); } }, { passive: false });
  }
  clickFloor(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects(this.house.floors, false)[0];
    if (!hit) return;
    this.stopTour();
    this.walkTo(hit.point.x, hit.point.z);
    this.marker(hit.point.x, hit.point.z);
  }
  walkTo(x, z, then) {
    const P = this.walker.position;
    const pts = this.nav.find(P.x, P.z, x, z);
    // 이미 그 자리면(점 1개) 빈 길이 남아 멈춰 버리지 않게 바로 끝낸다
    this.path = pts && pts.length > 1 ? pts.slice(1) : null; this.pathThen = this.path ? then ?? null : null; this.stuckT = 0; this.repath = 0;
    if (!this.path) then?.();
  }
  marker(x, z) {
    if (!this.mk) { this.mk = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xFF7E5F, transparent: true, opacity: 0.9, depthWrite: false })); this.mk.userData.noAO = true; this.scene.add(this.mk); }
    this.mk.position.set(x, 0.02, z); this.mk.material.opacity = 0.9;
    gsap.fromTo(this.mk.scale, { x: 0.4, y: 0.4, z: 0.4 }, { x: 1, y: 1, z: 1, duration: 0.45, ease: 'back.out(2.2)' });
  }

  // ---------- 자동 투어 ----------
  startTour() {
    gsap.to('#hint', { autoAlpha: 0, duration: 0.4 });
    this.touring = true; this.tourIdx = -1; $('#btn-tour').textContent = '투어 멈춤'; $('#btn-tour').classList.add('on');
    if (this.mode !== 'follow') this.setMode('follow');
    this.nextStop();
  }
  stopTour() { if (!this.touring) return; this.touring = false; clearTimeout(this.tourTimer); $('#btn-tour').textContent = '투어 시작'; $('#btn-tour').classList.remove('on'); }
  nextStop() {
    if (!this.touring) return;
    const names = this.S.tour.length ? this.S.tour : this.S.rooms.map(r => r.name);
    this.tourIdx++;
    if (this.tourIdx >= names.length) { this.stopTour(); this.caption('투어를 마쳤습니다', '방 목록에서 다시 골라 보세요'); return; }
    const room = this.S.rooms.find(r => r.name === names[this.tourIdx]);
    if (!room) { this.nextStop(); return; }
    const at = this.tourIdx;
    this.goRoom(room, () => {
      this.caption(room.name, `${(room.stated ?? room.area).toFixed(1)}㎡ · 투어 ${at + 1}/${names.length}`);
      this.tourTimer = setTimeout(() => this.nextStop(), 3200);
    });
  }
  // 방 둘러보기 자리: 넓은 방 = 가운데(문에서 들어온 방향으로 본다), 5㎡ 미만 작은 방 = 문 앞에서 안을 본다
  goRoom(room, then) {
    const P = this.walker.position, doors = room.doors ?? [];
    const door = [...doors].sort((a, b) => (a.type === 'door' ? 0 : 1) - (b.type === 'door' ? 0 : 1) || Math.hypot(a.at[0] - P.x, a.at[1] - P.z) - Math.hypot(b.at[0] - P.x, b.at[1] - P.z))[0];
    let tx = room.center[0], tz = room.center[1], yaw = null;
    this._doorShot = null;
    if (door) {
      if (room.area < 5) { // 작은 방: 문 앞 눈높이에서 방 안을 본다
        const ds = this.doorShot(room, door); tx = ds.stand[0]; tz = ds.stand[1]; yaw = Math.atan2(door.in[0], door.in[1]); this._doorShot = ds;
      } else yaw = Math.atan2(tx - door.at[0], tz - door.at[1]);
    }
    this.walkTo(tx, tz, () => {
      if (yaw != null) { this.walker.heading = yaw; this.turnTo = yaw; }
      this.startShot(room); then?.();
    });
  }

  // ---------- 매 프레임 ----------
  loop() {
    this.clock.update(); const dt = Math.min(0.05, this.clock.getDelta()); this.t = this.clock.getElapsed();
    const H = this.walker, P = H.position;
    let vx = 0, vz = 0, speed = 0;
    // 방향키(카메라 기준)
    let f = 0, s = 0;
    for (const k of this.keys) { if (k === 'KeyW' || k === 'ArrowUp') f++; if (k === 'KeyS' || k === 'ArrowDown') f--; if (k === 'KeyA' || k === 'ArrowLeft') s--; if (k === 'KeyD' || k === 'ArrowRight') s++; }
    const yaw = this.mode === 'follow' ? this.cam.yaw : Math.atan2(this.orbit.target.x - this.camera.position.x, this.orbit.target.z - this.camera.position.z);
    if (f || s) {
      const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      speed = run ? 2.2 : 1.15;
      vx = Math.sin(yaw) * f - Math.cos(yaw) * s; vz = Math.cos(yaw) * f + Math.sin(yaw) * s;
      const l = Math.hypot(vx, vz); vx /= l; vz /= l;
    } else if (this.path?.length) {
      const [tx, tz] = this.path[0], dx = tx - P.x, dz = tz - P.z, L = Math.hypot(dx, dz);
      if (L < 0.06) { this.path.shift(); if (!this.path.length) { this.path = null; const th = this.pathThen; this.pathThen = null; th?.(); } }
      else { speed = this.touring ? 1.0 : 1.15; vx = dx / L; vz = dz / L; }
    }
    if (speed) {
      const nx = P.x + vx * speed * dt, nz = P.z + vz * speed * dt, ox = P.x, oz = P.z;
      if (this.nav.walkable(nx, nz)) { P.x = nx; P.z = nz; }
      else if (this.nav.walkable(nx, P.z)) P.x = nx;
      else if (this.nav.walkable(P.x, nz)) P.z = nz;
      else speed = 0;
      // 길을 따라가는데 0.4초 넘게 거의 못 나가면(모서리·칸 경계에 걸림) 지금 자리에서 길을 다시 찾는다
      if (this.path?.length && !(f || s)) {
        this.stuckT = Math.hypot(P.x - ox, P.z - oz) < speed * dt * 0.3 ? (this.stuckT ?? 0) + dt : 0;
        if (this.stuckT > 0.4) {
          this.stuckT = 0; this.repath = (this.repath ?? 0) + 1;
          const [gx, gz] = this.path[this.path.length - 1], pts = this.repath <= 3 ? this.nav.find(P.x, P.z, gx, gz) : null;
          if (pts && pts.length > 1) this.path = pts.slice(1);
          else { this.path = null; this.repath = 0; const th = this.pathThen; this.pathThen = null; th?.(); }
        }
      }
      const want = Math.atan2(vx, vz); H.heading += angDiff(H.heading, want) * (1 - Math.exp(-10 * dt));
    }
    H.speed = damp(H.speed, speed, 10, dt);
    H.state = H.speed > 0.15 ? 'walk' : 'idle';
    // 방 바뀜 → 자막
    const room = this.house.roomAt(P.x, P.z);
    // 방 바뀜: 0.25초 이상 머물 때만(문턱에서 두 방을 오가며 자막이 깜빡이지 않게)
    if (room && room !== this.room) {
      if (this.pendRoom !== room) { this.pendRoom = room; this.pendT = this.t; }
      else if (this.t - this.pendT > 0.25 || !this.room) {
        this.room = room; this.pendRoom = null; this.markList(room);
        if (!room.auto && !this.touring) this.caption(room.name, `${(room.stated ?? room.area).toFixed(1)}㎡`); // 복도·수납칸은 자막 없음, 투어 중엔 도착할 때 띄움
      }
    } else this.pendRoom = null;
    this.updateCamera(dt, speed > 0);
    this.ext?.update(this.camera);
    this.onFrame?.(dt, H, this.camera); // 자동 검사(qa.js)가 매 프레임 기록하는 자리
    if (this.mk) { this.mk.material.opacity = Math.max(0, this.mk.material.opacity - dt * 0.8); this.mk.visible = this.mk.material.opacity > 0.01; }
    this.drawMini();
    if (!this.compareHidden) { if (this.post.enabled) this.post.render(dt); else this.renderer.render(this.scene, this.camera); }
    if (COMPARE === 'lead') parent.__compareSync?.(this, dt); // 같은 프레임에 '전'도 같은 자세로 그린다
    this.perf(dt);
  }
  // '전' 사이트(mirror): '후'(L)의 카메라·보기 모드·천장·문짝을 그대로 옮기고 그린다
  mirror(L, dt) {
    if (this.mode !== L.mode) { this.mode = L.mode === 'dollhouse' ? 'follow' : 'dollhouse'; this.setMode(L.mode, { instant: true }); this.killCam(); this.orbit.enabled = false; }
    const c = this.camera, lc = L.camera;
    c.position.copy(lc.position); c.quaternion.copy(lc.quaternion); c.fov = lc.fov; c.updateProjectionMatrix();
    this.renderer.toneMappingExposure = L.renderer.toneMappingExposure;
    if (this.post?.bloom && L.post?.bloom) this.post.bloom.enabled = L.post.bloom.enabled;
    const M = this.house.mats, LM = L.house.mats;
    M.ceiling.transparent = LM.ceiling.transparent; M.ceiling.opacity = LM.ceiling.opacity; this.house.ceilings.visible = L.house.ceilings.visible;
    if (this.backdrop && L.backdrop) { this.backdrop.visible = L.backdrop.visible; if (this.backdrop.material && L.backdrop.material) { this.backdrop.material.transparent = L.backdrop.material.transparent; this.backdrop.material.opacity = L.backdrop.material.opacity; } }
    L.leaves.forEach((ll, i) => { const fl = this.leaves[i]; if (!fl) return; fl.visible = ll.visible; fl.castShadow = ll.castShadow; fl.material.transparent = ll.material.transparent; fl.material.opacity = ll.material.opacity; });
    this.walker.position.copy(L.walker.position);
    this.ext?.update(this.camera);
    if (this.post.enabled) this.post.render(dt); else this.renderer.render(this.scene, this.camera);
  }
  // 작은 방(문 앞) 구도: 안쪽 문이면 문 밖 0.3m · 현관문이면 문 안 0.3m에서 방 안쪽을 본다. 걷는 자리(stand)는 그 곁의 걸을 수 있는 칸
  doorShot(room, door) {
    const ext = !!this.S.openings.find(o => o.id === door.id)?.exterior, n = door.in, sd = [n[1], -n[0]], k = ext ? 0.3 : -0.3;
    const cam = [door.at[0] + n[0] * k, door.at[1] + n[1] * k];
    const look = ext ? [door.at[0] + n[0] * 3, door.at[1] + n[1] * 3] : room.center; // 현관은 현관문에서 집 안쪽을 본다
    // 걷는 자리: 카메라 옆 → 안쪽 2m 앞 → 카메라 뒤 순서로, 걸을 수 있고 벽 너머가 아닌 칸을 고른다
    const dl = Math.hypot(look[0] - cam[0], look[1] - cam[1]) || 1, dir = [(look[0] - cam[0]) / dl, (look[1] - cam[1]) / dl];
    const okSpot = (x, z) => {
      const q = this.nav.nearest(x, z, 3); if (!q) return null;
      const vx = q[0] - cam[0], vz = q[1] - cam[1], d = Math.hypot(vx, vz); if (d < 0.3) return null;
      const ang = Math.acos(Math.max(-1, Math.min(1, (vx * dir[0] + vz * dir[1]) / d))) * 180 / Math.PI;
      if (!(ang > 65 || d > 1.8)) return null;
      // 카메라에서 벽 너머 자리면 안 된다(구도가 끝나고 돌아올 때 벽을 지나게 된다)
      const o = new THREE.Vector3(cam[0], 1.0, cam[1]), dv = new THREE.Vector3(vx, 0, vz).normalize();
      return new THREE.Raycaster(o, dv, 0.05, d - 0.2).intersectObjects(this.blockers, true).length ? null : q;
    };
    let stand = null;
    for (const [x, z] of [[cam[0] + sd[0] * 0.55, cam[1] + sd[1] * 0.55], [cam[0] - sd[0] * 0.55, cam[1] - sd[1] * 0.55], [cam[0] + dir[0] * 2, cam[1] + dir[1] * 2], [cam[0] - n[0] * 0.5, cam[1] - n[1] * 0.5]])
      if ((stand = okSpot(x, z))) break;
    if (!stand) stand = [cam[0] - n[0] * 0.5, cam[1] - n[1] * 0.5];
    return { cam, look, stand, id: door.id };
  }
  // 방 사진 구도: 방 모서리 중 걷는 자리에서 가장 먼 곳, 천장 가까이에서 방 가운데를 넓게 본다(부동산 사진처럼). 구석이 없거나 작은 방이면 문 앞 구도(doorShot).
  // 눈높이(1.55m)·수평 구도보다 높은 시점이 방이 넓게 읽히고 설비·가구가 덜 잘린다
  startShot(room) {
    if (this.mode !== 'follow' || !this.touring) return; // 직접 걸을 때·방 목록으로 갈 때는 눈높이 그대로
    const P = this.walker.position, H = this.house.H, [cx, cz] = room.center, EYE = H - 0.22;
    const inRoom = (x, z) => room.rects.some(([a, b, c, d]) => x >= a && x <= c && z >= b && z <= d);
    // 모서리 중 걷는 자리(1m 높이)가 벽·키 큰 가구에 가리지 않는 곳만
    const sees = (x, z) => { const o = new THREE.Vector3(x, EYE, z), d = new THREE.Vector3(P.x, 1.0, P.z).sub(o), L = d.length(); return !new THREE.Raycaster(o, d.normalize(), 0.05, L - 0.3).intersectObjects(this.blockers, true).length; };
    let best = null;
    if (!this._doorShot) for (const [a, b, c, d] of room.rects) for (const [x, z] of [[a, b], [c, b], [a, d], [c, d]]) {
      const l = Math.hypot(cx - x, cz - z) || 1, px = x + (cx - x) / l * 0.3, pz = z + (cz - z) / l * 0.3;
      if (!inRoom(px, pz) || !sees(px, pz)) continue;
      const score = Math.hypot(px - P.x, pz - P.z);
      if (!best || score > best.s) best = { s: score, x: px, z: pz };
    }
    let look, pos, shotLeaf = [];
    if (best && best.s >= 1.2) {
      look = new THREE.Vector3((P.x + cx) / 2, 0.85, (P.z + cz) / 2);
      pos = new THREE.Vector3(best.x, EYE, best.z);
    } else {
      const ds = this._doorShot; // 큰 방에서 구석을 못 찾으면 눈높이 그대로
      if (!ds) return;
      look = new THREE.Vector3(ds.look[0], 1.2, ds.look[1]); // 좁은 방은 가까워서 보는 점을 낮추면 바닥만 내려다본다
      pos = new THREE.Vector3(ds.cam[0], 1.5, ds.cam[1]);
      // 문 앞에 서면 그 문과 바로 옆 문의 열린 문짝이 화면 한쪽을 덮는다 → 이 구도 동안만 숨긴다(카메라 1.3m 안의 문짝)
      this.scene.updateMatrixWorld(true); const bb = new THREE.Box3(), c3 = new THREE.Vector3();
      shotLeaf = this.leaves.filter(l => l.parent?.userData.id === ds.id || bb.setFromObject(l).getCenter(c3).setY(1.5).distanceTo(pos) < 1.3);
    }
    if (!shotLeaf.length) { this.scene.updateMatrixWorld(true); const bb = new THREE.Box3(), c3 = new THREE.Vector3(); shotLeaf = this.leaves.filter(l => bb.setFromObject(l).distanceToPoint(pos) < 1.6); } // 큰 방 구석 구도도 카메라 곁 문짝은 숨긴다
    this._doorShot = null;
    this.clampCam(look, pos); this.unstick(pos, look); // 도착 자리는 처음에 한 번만 맞춘다(옮기는 중에 당기면 튄다)
    // 카메라를 공간 속으로 날리면 벽을 가로지르며 휙 돈다 → 화면을 잠깐 덮었다 걷히며 방 사진 자리로 바꾼다.
    // 방 사진 동안은 방 가운데 쪽으로 0.3m 천천히 다가간다
    const end = pos.clone().lerp(look, Math.min(0.3 / Math.max(0.3, pos.distanceTo(look)), 0.15));
    this.fadeCut(() => {
      this.killCam(); // 앞 구도는 화면이 덮인 뒤에 지운다(덮기 전에 지우면 눈높이 자리로 튄다)
      const shot = this.shot = { k: 0, pos, end, look, leaf: shotLeaf };
      shot.tw = gsap.to(shot, { k: 1, duration: 6, ease: 'sine.out' });
    });
  }
  updateCamera(dt, moving) {
    const P = this.walker.position, cam = this.camera;
    if (this.mode === 'dollhouse') { this.orbit.update(); return; }
    const c = this.cam;
    if (this.shot) {
      if (moving || this.t - c.manualT < 0.2) { if (!this.fading) this.fadeCut(() => { this.killCam(); c.distNow = null; c.clampNow = null; c.stickNow = null; }); }
      if (this.shot) {
        const s = this.shot;
        cam.position.lerpVectors(s.pos, s.end, s.k);
        this._look = s.look.clone();
        if (cam.fov !== 72) { cam.fov = 72; cam.updateProjectionMatrix(); }
        cam.lookAt(this._look); this.fadeLeaves(dt);
        return;
      }
    }
    this.firstPerson(P, moving, dt);
  }
  // 카메라가 벽·키 큰 가구(상부장·붙박이장·냉장고) 상자 안이나 12cm 안에 들어가면 보는 점 쪽으로 밀어낸다
  // (광선 검사는 조리대와 상부장 사이 빈틈으로 빠져나가 카메라가 장 속에 들어가 벽 너머를 비췄다)
  unstick(pos, look) {
    // 카메라 칸 지도(scene.camNav: 벽·키 큰 물체에서 0.15m 떨어진 건물 안 칸)가 있으면: 보는 점에서 카메라 쪽으로 5cm씩 나가며 칸 밖에 닿기 직전까지만
    const cn = this.S.camNav;
    const ok = cn && ((x, z) => { const i = Math.floor(x / cn.cell), j = Math.floor(z / cn.cell); return cn.rows[j]?.[i] === '1'; });
    if (cn && ok(look.x, look.z)) { // 보는 점이 칸 밖(아주 좁은 곳)이면 아래 상자 방식으로
      if (ok(pos.x, pos.z) && this.camClear(look, pos, ok)) return pos;
      const d = pos.clone().sub(look), L = d.length(); d.normalize(); let best = 0;
      for (let s = 0.05; s <= L; s += 0.05) { if (!ok(look.x + d.x * s, look.z + d.z * s)) break; best = s; }
      return pos.copy(look).addScaledVector(d, best);
    }
    if (!this._camBoxes) {
      this.scene.updateMatrixWorld(true);
      this._camBoxes = [...this.house.walls, ...this.furn.group.children.filter(o => o.userData.h >= 1.0)].map(o => new THREE.Box3().setFromObject(o).expandByScalar(0.12));
    }
    const boxes = this._camBoxes.filter(b => !b.containsPoint(look)); // 보는 점이 들어 있는 상자는 빼고(문틀 옆 등)
    for (let k = 0; k < 12 && boxes.some(b => b.containsPoint(pos)); k++) pos.lerp(look, 0.15);
    return pos;
  }
  camClear(look, pos, ok) { // 보는 점 → 카메라 사이가 모두 카메라 칸인가
    const d = pos.clone().sub(look), L = d.length(); d.normalize();
    for (let s = 0.05; s < L; s += 0.05) if (!ok(look.x + d.x * s, look.z + d.z * s)) return false;
    return true;
  }
  // 카메라 → 걷는 자리 사이에 문짝이 있으면 그 문짝을 반투명하게(방 사진 구도에서 화면을 가리지 않게)
  fadeLeaves(dt) {
    const cam = this.camera.position, P = this.walker.position, hit = new Set();
    for (const y of [1.45, 1.0, 0.5]) {
      const d = new THREE.Vector3(P.x, y, P.z).sub(cam), L = d.length(); if (L < 0.05) continue;
      for (const h of new THREE.Raycaster(cam, d.normalize(), 0, L).intersectObjects(this.leaves, false)) hit.add(h.object);
    }
    const hide = this.shot?.leaf ?? []; // 문 앞 구도에서 카메라 곁 문짝은 아예 숨긴다(반투명 판이 화면 한쪽에 남지 않게)
    for (const l of this.leaves) {
      const want = hide.includes(l) ? 0 : hit.has(l) ? 0.18 : 1;
      l.userData.fade = damp(l.userData.fade, want, want < 1 ? 30 : 8, dt); // 가릴 때는 빨리, 풀릴 때는 천천히
      const m = l.material, on = l.userData.fade < 0.99;
      if (m.transparent !== on) { m.transparent = on; m.depthWrite = !on; m.needsUpdate = true; }
      m.opacity = on ? l.userData.fade : 1;
      l.visible = l.userData.fade > 0.02; l.castShadow = l.userData.fade > 0.5; // 숨긴 문짝은 그림자도 끈다
    }
  }
  // 화면을 0.2초 덮고 → fn(카메라 자리 바꾸기) → 0.3초에 걷힌다
  fadeCut(fn) {
    if (!this.fadeEl) {
      const el = this.fadeEl = document.createElement('div');
      Object.assign(el.style, { position: 'absolute', inset: '0', background: '#F4F1EA', opacity: '0', pointerEvents: 'none' }); // #stage 안 → 방 이름·버튼은 그 위에 그대로
      this.renderer.domElement.after(el);
    }
    this.fading = true;
    gsap.timeline({ onComplete: () => { this.fading = false; } })
      .to(this.fadeEl, { opacity: 1, duration: 0.2, ease: 'power1.in' })
      .add(() => { fn(); this.fadeCovered = true; })
      .add(() => { this.fadeCovered = false; }, '+=0.05')
      .to(this.fadeEl, { opacity: 0, duration: 0.3, ease: 'power1.out' });
  }
  // 위에서 보기: 빛 번짐 끄고 노출을 낮춰 하얗게 날리지 않게
  dollLook(on) {
    const R = this.renderer;
    gsap.to(R, { toneMappingExposure: (on ? 0.92 : 0.96) * (this.expo ?? 1), duration: 0.8 }); // 흰 벽·침구가 한 톤으로 날리지 않게
    if (this.post?.bloom) this.post.bloom.enabled = on ? false : !this.perfOffBloom;
  }
  // 보는 점 → 카메라 사이에 벽·문짝·키 큰 가구가 있으면 그 앞으로 당긴다(전환 중에도 파묻히지 않게)
  clampCam(from, pos) {
    const d = pos.clone().sub(from), L = d.length(); if (L < 0.05) return;
    const hit = new THREE.Raycaster(from, d.normalize(), 0.02, L).intersectObjects(this.blockers, true)[0];
    if (hit) pos.copy(from).addScaledVector(d, Math.max(0.35, hit.distance - 0.18));
  }
  killCam() { this.shot?.tw?.kill(); this.shot = null; this.blend?.tw?.kill(); this.blend = null; this.flight?.kill(); this.flight = null; }
  // 1인칭 눈높이(1.55m): 걷는 자리에서 c.yaw 쪽을 본다. 휠 = 화각(넓게·좁게), 끌기 = 둘러보기
  firstPerson(P, moving, dt) {
    const c = this.cam, cam = this.camera, EYE = 1.55;
    // 길을 따라 걸을 때(투어·바닥 클릭·방 목록)는 걷는 쪽으로 천천히 돈다. 방향키로 걸을 때·손으로 돌린 직후는 그대로
    if (moving && this.path?.length && this.t - c.manualT > 1.5) { const dy = angDiff(c.yaw, this.walker.heading) * (1 - Math.exp(-3 * dt)), cap = 1.75 * dt; c.yaw += Math.max(-cap, Math.min(cap, dy)); }
    if (this.turnTo != null) { // 도착하면 방 쪽(goRoom이 정한 방향)으로 돌아선다
      if (moving || this.t - c.manualT < 0.2) this.turnTo = null;
      else { const dy = angDiff(c.yaw, this.turnTo); c.yaw += Math.max(-1.75 * dt, Math.min(1.75 * dt, dy * (1 - Math.exp(-3 * dt)))); if (Math.abs(dy) < 0.01) this.turnTo = null; }
    }
    const eye = new THREE.Vector3(P.x, EYE, P.z), dir = new THREE.Vector3(Math.sin(c.yaw), -Math.tan(c.pitch), Math.cos(c.yaw)).normalize(), pos = eye.clone();
    this._look = eye.clone().addScaledVector(dir, 2);
    const want = Math.max(45, Math.min(78, 50 + (c.dist - 1.2) * 7.5));
    if (Math.abs(cam.fov - want) > 0.1) { cam.fov = damp(cam.fov, want, 6, dt); cam.updateProjectionMatrix(); }
    if (this.blend) { const b = this.blend, k = b.k; pos.lerpVectors(b.from, eye, k); this._look.lerpVectors(b.look, this._look, k); this.clampCam(eye, pos); } // 위에서 보기 → 눈높이로 돌아오는 길에 벽을 뚫지 않게
    cam.position.copy(pos); cam.lookAt(this._look);
    this.fadeLeaves(dt);
  }
  // 지금 카메라 자리에서 눈높이 자리로 부드럽게 돌아오기
  startBlend(dur = 0.9) {
    const cam = this.camera;
    this.killCam();
    this.cam.distNow = null;
    const b = this.blend = { k: 0, from: cam.position.clone(), look: (this._look ?? this.orbit.target).clone() };
    b.tw = gsap.to(b, { k: 1, duration: dur, ease: 'power2.out', onComplete: () => { if (this.blend === b) this.blend = null; } });
  }
  setMode(m, { instant = false } = {}) {
    if (m === this.mode) return;
    this.mode = m;
    const doll = m === 'dollhouse', M = this.house.mats;
    $('#btn-view').textContent = doll ? '걸어 보기' : '위에서 보기';
    // 천장·창밖은 끄고 켜지 않고 서서히
    for (const mt of [M.ceiling, this.backdrop.material]) { mt.transparent = true; gsap.killTweensOf(mt); }
    if (doll) {
      this.killCam();
      const [W, D] = this.S.size, R = Math.max(W, D), cam = this.camera;
      const to = new THREE.Vector3(W / 2 - R * 0.15, R * 1.05, D / 2 + R * 0.75), target = new THREE.Vector3(W / 2, 0, D / 2);
      const from = cam.position.clone(), look0 = (this._look ?? target).clone(), fov0 = cam.fov, o = { k: 0 };
      this.orbit.enabled = false;
      this.dollLook(true);
      if (instant) {
        cam.position.copy(to); this.orbit.target.copy(target); cam.fov = 50; cam.updateProjectionMatrix();
        M.ceiling.opacity = 0; this.house.ceilings.visible = false; this.backdrop.material.opacity = 0; this.backdrop.visible = false;
        this.orbit.enabled = true; this.orbit.update(); return;
      }
      gsap.to(M.ceiling, { opacity: 0, duration: 0.5, onComplete: () => { this.house.ceilings.visible = false; } });
      gsap.to(this.backdrop.material, { opacity: 0, duration: 0.8, onComplete: () => { this.backdrop.visible = false; } });
      this.flight = gsap.to(o, { k: 1, duration: 1.4, ease: 'power3.inOut', onUpdate: () => {
        cam.position.lerpVectors(from, to, o.k); this.orbit.target.lerpVectors(look0, target, o.k);
        cam.fov = fov0 + (50 - fov0) * o.k; cam.updateProjectionMatrix(); cam.lookAt(this.orbit.target);
      }, onComplete: () => { this.flight = null; if (this.mode === 'dollhouse') { this.orbit.enabled = true; this.orbit.update(); } } });
    } else {
      this.orbit.enabled = false;
      this.dollLook(false);
      this._look = this.orbit.target.clone();
      this.house.ceilings.visible = true; this.backdrop.visible = true;
      gsap.to(M.ceiling, { opacity: 1, duration: 0.6, delay: 0.5, onComplete: () => { M.ceiling.transparent = false; } });
      gsap.to(this.backdrop.material, { opacity: 1, duration: 0.8, delay: 0.3 });
      this.startBlend(1.2);
    }
  }

  // ---------- 화면 글자 ----------
  ui() {
    const list = document.createElement('div'); list.className = 'rooms-inner'; $('#rooms').append(list);
    for (const r of this.S.rooms.filter(r => !r.auto)) {
      const b = document.createElement('button'); b.className = 'room';
      b.innerHTML = `<span>${r.name}</span><em>${(r.stated ?? r.area).toFixed(1)}㎡</em>`;
      b.onclick = () => { this.stopTour(); if (this.mode !== 'follow') this.setMode('follow'); this.goRoom(r); };
      b.dataset.name = r.name; list.append(b);
    }
    // 방 목록이 길면 Lenis로 부드럽게 굴린다(GSAP 시계 하나로 맞춘다)
    if (window.Lenis) {
      this.lenis = new window.Lenis({ wrapper: $('#rooms'), content: list, lerp: 0.12, wheelMultiplier: 0.9 });
      gsap.ticker.add(t => this.lenis.raf(t * 1000)); gsap.ticker.lagSmoothing(0);
    }
    $('#btn-tour').onclick = () => (this.touring ? this.stopTour() : this.startTour());
    $('#btn-view').onclick = () => this.setMode(this.mode === 'follow' ? 'dollhouse' : 'follow');
    // 미니맵 = 원래 평면도
    const img = new Image(); img.src = this.S.plan.image; img.onload = () => { this.planImg = img; };
    const mini = $('#mini');
    mini.addEventListener('click', e => {
      if (!this.planImg) return;
      const r = mini.getBoundingClientRect(), k = this.miniK;
      const px = (e.clientX - r.left) * devicePixelRatio / k.s + k.ox, py = (e.clientY - r.top) * devicePixelRatio / k.s + k.oy;
      const x = (px - this.S.plan.origin[0]) / this.S.plan.ppm, z = (py - this.S.plan.origin[1]) / this.S.plan.ppm;
      this.stopTour(); this.walkTo(x, z); this.marker(x, z);
    });
  }
  markList(room) {
    for (const b of document.querySelectorAll('.room')) {
      const on = !room.auto && b.dataset.name === room.name; b.classList.toggle('here', on);
      if (on) { gsap.fromTo(b, { scale: 0.96 }, { scale: 1, duration: 0.35, ease: 'back.out(2)' }); this.lenis?.scrollTo(b, { offset: -40, duration: 0.8 }); }
    }
  }
  caption(title, sub) {
    const el = $('#caption'); el.querySelector('b').textContent = title; el.querySelector('span').textContent = sub ?? '';
    this.capTl?.kill();
    this.capTl = gsap.timeline()
      .fromTo(el, { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power3.out' })
      .to(el, { autoAlpha: 0, y: -4, duration: 0.6, ease: 'power2.in' }, '+=1.9');
  }
  drawMini() {
    const cv = $('#mini'); if (!this.planImg) return;
    const dpr = devicePixelRatio, W = cv.clientWidth * dpr, Hh = cv.clientHeight * dpr;
    if (cv.width !== W) { cv.width = W; cv.height = Hh; }
    const g = cv.getContext('2d'), S = this.S, pp = S.plan;
    // 건물 범위만 잘라 보여 준다
    const bw = S.size[0] * pp.ppm, bh = S.size[1] * pp.ppm, pad = 0.04 * Math.max(bw, bh);
    const s = Math.min(W / (bw + pad * 2), Hh / (bh + pad * 2));
    const ox = pp.origin[0] - pad - (W / s - bw - pad * 2) / 2, oy = pp.origin[1] - pad - (Hh / s - bh - pad * 2) / 2;
    this.miniK = { s, ox, oy };
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, Hh);
    g.drawImage(this.planImg, ox, oy, W / s, Hh / s, 0, 0, W, Hh);
    const P = this.walker.position, x = (P.x * pp.ppm + pp.origin[0] - ox) * s, y = (P.z * pp.ppm + pp.origin[1] - oy) * s;
    const yaw = this.mode === 'follow' ? this.cam.yaw : this.walker.heading;
    g.fillStyle = 'rgba(255,126,95,0.28)'; g.beginPath(); g.moveTo(x, y); g.arc(x, y, 26 * dpr, Math.atan2(Math.cos(yaw), Math.sin(yaw)) - 0.6, Math.atan2(Math.cos(yaw), Math.sin(yaw)) + 0.6); g.closePath(); g.fill();
    g.fillStyle = '#FF7E5F'; g.beginPath(); g.arc(x, y, 5 * dpr, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 2 * dpr; g.stroke();
  }
  onResize() {
    const el = $('#stage'), w = el.clientWidth, h = el.clientHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix();
    this.post?.setSize(w, h, Math.min(1.5, this.renderer.getPixelRatio()));
  }
  perf() { // 2초 평균 40fps 아래면 주변광 가림 → 빛 번짐 순으로 끈다
    const p = this._pf ??= { t: 0, n: 0, last: performance.now() };
    const now = performance.now(), gap = (now - p.last) / 1000; p.last = now;
    if (gap > 0.2 || document.hidden) { p.t = 0; p.n = 0; return; }
    p.t += gap; p.n++;
    if (p.t >= 2) { if (p.n / p.t < 40) { if (this.post.ao.enabled) this.post.ao.enabled = false; else { this.post.bloom.enabled = false; this.perfOffBloom = true; } } p.t = 0; p.n = 0; }
  }
}

new Tour().boot().catch(e => { console.error(e); const p = document.querySelector('#load p'); if (p) p.textContent = `불러오지 못했습니다: ${e.message}`; });
