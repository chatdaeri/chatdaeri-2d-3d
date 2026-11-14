// 대신 걸어 보는 자동 검사(tour.py make 의 4/4 단계): 주소 ?qa=tour(투어 한 바퀴) · ?qa=corners(방마다 네 구석 걷기)
// 시간을 1/60초씩 직접 넘기며 loop()를 돌리고 매 프레임 (1) 걷는 자리(사람 몸 반지름 0.22m)가 벽·문짝·가구에 묻히는지 (2) 카메라가 벽·장 속에 들어가는지
// (3) 카메라가 튀는지 (4) 길에서 멈추는지 센다. 끝나면 합격/불합격과 근거를 돌려준다.
// 검사 뒤 페이지는 시뮬레이션 상태라 다시 보려면 새로 고친다.
import * as THREE from 'three';
const LIMITS = { tour: { 몸묻힘비율: 0, 카메라벽속: 0, 화면가림프레임: 30, 막힘: 0 }, corners: { 몸묻힘비율: 0.5, 카메라벽속: 30, 화면가림프레임: 120, 막힘: 0 } };
export async function runQA(T, scenario = 'tour', maxSec = 900, onFrame = null) {
  const gs = window.gsap, V = THREE.Vector3;
  const blk = [...T.house.walls, ...T.house.doors.flatMap(d => d.children), ...T.furn.group.children.filter(o => (o.userData.h ?? 1) >= 0.3)];
  const ray = new THREE.Raycaster();
  const M = { frames: 0, clipFrames: 0, clipWorst: 0, clipAt: [], camJump: 0, camJumpShot: 0, camJumpFollow: 0, posJump: 0, maxAng: 0, maxPos: 0, reversals: 0, stuck: 0, jumps: [], closeCam: 0, blocked: 0 };
  const occInside = [...T.house.walls.filter(w => !w.userData.glass), ...T.furn.group.children.filter(o => (o.userData.h ?? 1) >= 1.0)];
  const occ = [...T.house.walls, ...T.furn.group.children.filter(o => (o.userData.h ?? 1) >= 1.0)];
  const oc = T.clampCam.bind(T); T.clampCam = (from, pos) => { const b = pos.clone(); oc(from, pos); if (b.distanceTo(pos) > 0.05) T.__clamped = true; };
  let prevF = null, prevP = null, prevRate = 0, lastRevT = -9;
  // --- 시간 조종 ---
  const step = 1 / 60; let simT = 0, gsT = gs.ticker.time;
  T.renderer.setAnimationLoop(null);
  T.scene.updateMatrixWorld(true); // 그리지 않으면 벽·문짝 위치 행렬이 갱신되지 않아 광선 검사가 틀린다(실제 앱은 매 프레임 그리며 갱신)
  T.renderer.render = () => {}; T.post.render = () => {}; T.perf = () => {}; T.drawMini = () => {};
  T.clock.update = () => {}; T.clock.getDelta = () => step; T.clock.getElapsed = () => simT;
  gs.ticker.remove(gs.updateRoot);
  const timers = [], realST = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms = 0) => { const id = { fn, at: simT + ms / 1000 }; timers.push(id); return id; };
  window.clearTimeout = id => { const i = timers.indexOf(id); if (i >= 0) timers.splice(i, 1); };
  // --- 매 프레임 기록 ---
  T.onFrame = (dt, H, cam) => {
    if (T.mode !== 'follow' || simT < 2.5 || T.fadeCovered || (T.fadeEl && +T.fadeEl.style.opacity > 0.97)) { prevF = null; return; }
    M.frames++;
    { // 걷는 자리 둘레 0.22m(사람 몸)가 벽·문짝·가구에 3cm 넘게 들어갔는가
      const p = T.walker.position; let worst = 0, what = '';
      for (const y of [0.45, 1.0, 1.35]) for (let a = 0; a < 8; a++) { const dir = new V(Math.cos(a * Math.PI / 4), 0, Math.sin(a * Math.PI / 4)); ray.set(new V(p.x, y, p.z), dir); ray.far = 0.22; const h = ray.intersectObjects(blk, true)[0]; if (h && 0.22 - h.distance > worst) { worst = 0.22 - h.distance; what = T.house.walls.includes(h.object) ? 'wall' : (T.leaves || []).includes(h.object) ? 'leaf' : 'furn'; } }
      if (worst > 0.03) { M.clipFrames++; M.clipWorst = Math.max(M.clipWorst, worst); if (M.clipAt.length < 300) M.clipAt.push([+simT.toFixed(1), +p.x.toFixed(2), +p.z.toFixed(2), +worst.toFixed(2), what, T.room?.name]); }
    }
    if (T._look && cam.position.distanceTo(T._look) < 0.3) M.closeCam++;
    { // 카메라가 벽(유리 제외) 상자나, 카메라 높이까지 올라오는 단단한 부품(scene.solids) 안에 있는가 — 그리는 코드·카메라 칸과 같은 목록으로 판정
      const cp = cam.position; let inside = null; const bb = new THREE.Box3();
      for (const o of occInside) { if (!T.house.walls.includes(o)) continue; bb.setFromObject(o); bb.expandByScalar(-0.005); if (bb.containsPoint(cp)) { inside = 'wall'; break; } }
      if (!inside) for (const so of T.S.solids ?? []) {
        if (so.kind === 'leaf' || cp.y < so.y0 || cp.y > so.y1) continue;
        const r = so.rot * Math.PI / 180, dx = cp.x - so.x, dz = cp.z - so.z, lx = dx * Math.cos(r) - dz * Math.sin(r), lz = dx * Math.sin(r) + dz * Math.cos(r);
        if (Math.abs(lx) < so.w / 2 && Math.abs(lz) < so.d / 2) { inside = (T.S.furniture[so.of]?.type ?? '?') + '·' + so.kind; break; }
      }
      if (inside) { M.camIn = (M.camIn || 0) + 1; if ((M.camInAt ||= []).length < 60) M.camInAt.push([+simT.toFixed(1), cp.toArray().map(v => +v.toFixed(2)), inside, T.room?.name]); }
    }
    const f = new V(); cam.getWorldDirection(f);
    if (prevF) {
      const ang = Math.acos(Math.max(-1, Math.min(1, f.dot(prevF)))) * 180 / Math.PI / dt;
      const yawRate = Math.atan2(prevF.x * f.z - prevF.z * f.x, prevF.x * f.x + prevF.z * f.z) * 180 / Math.PI / dt;
      const pos = cam.position.distanceTo(prevP) / dt;
      M.maxAng = Math.max(M.maxAng, ang); M.maxPos = Math.max(M.maxPos, pos);
      if (ang > 90) { M.camJump++; if (T.shot || T.blend) M.camJumpShot++; else M.camJumpFollow++; }
      const why = T.shot ? 'shot' : T.blend ? 'blend' : 'follow';
      if (pos > 3.5) { M.posJump++; if (M.jumps.length < 400) M.jumps.push([+simT.toFixed(2), +pos.toFixed(1), Math.round(ang), why, !!T.__clamped]); }
      if (Math.abs(yawRate) > 30) { if (prevRate && Math.sign(yawRate) !== Math.sign(prevRate) && simT - lastRevT < 1.5) M.reversals++; prevRate = yawRate; lastRevT = simT; }
    }
    prevF = f.clone(); prevP = cam.position.clone(); T.__clamped = false;
  };
  // --- 시나리오 ---
  let queue = null, legT = 0;
  if (scenario === 'tour') T.startTour();
  else if (scenario === 'none') { T.stopTour(); T.setMode('follow', { instant: true }); }
  else {
    T.stopTour(); T.setMode('follow', { instant: true });
    queue = [];
    for (const r of T.S.rooms.filter(r => !r.auto)) for (const [a, b, c, d] of r.rects) for (const [x, z] of [[a, b], [c, b], [c, d], [a, d]]) queue.push([x, z]);
  }
  const done = () => scenario === 'none' ? false : scenario === 'tour' ? !T.touring : (!queue.length && !T.path);
  for (let k = 0; k < maxSec * 60; k++) {
    simT += step; gsT += step; gs.updateRoot(gsT);
    for (const t of timers.filter(t => t.at <= simT)) { timers.splice(timers.indexOf(t), 1); t.fn(); }
    if (queue && (!T.path || simT - legT > 20)) {
      if (T.path && simT - legT > 20) M.stuck++;
      if (queue.length) { const [x, z] = queue.shift(); T.walkTo(x, z); legT = simT; }
    }
    T.loop(); T.scene.updateMatrixWorld();
    if (onFrame) onFrame(simT);
    if (k % 300 === 0) await new Promise(r => realST(r, 0));
    if (k > 60 && done()) break;
  }
  const r = { 시나리오: scenario, 시뮬초: +simT.toFixed(1), 프레임: M.frames, 몸묻힘프레임: M.clipFrames, 몸묻힘비율: +(100 * M.clipFrames / Math.max(1, M.frames)).toFixed(1) + '%', 최대묻힘m: +M.clipWorst.toFixed(2), 카메라급회전프레임: M.camJump, 그중방사진전환: M.camJumpShot, 그중따라가기: M.camJumpFollow, 카메라위치튐: M.posJump, 최대회전도s: Math.round(M.maxAng), 최대이동ms: +M.maxPos.toFixed(1), 되돌아옴: M.reversals, 막힘: M.stuck, 카메라머리붙음: M.closeCam, 카메라벽속: M.camIn || 0, 카메라벽속예: (M.camInAt || []).filter((_, i) => i % 5 === 0).slice(0, 8), 화면가림프레임: M.blocked, 튐원인: M.jumps.reduce((o, j) => { const k = j[3] + (j[4] ? '+벽당김' : ''); o[k] = (o[k] || 0) + 1; return o; }, {}), 큰튐: M.jumps.slice().sort((a, b) => b[1] - a[1]).slice(0, 6), 묻힘예: M.clipAt.filter((_, i) => i % 6 === 0).slice(0, 14) };
  // 계단실이 집 안(어느 방)으로 들어갔는가
  const co = T.ext?.corridor; let corIn = 0;
  if (co) for (let uu = co.UL; uu <= co.UR; uu += 0.1) for (let nn = 0.05; nn <= co.ND; nn += 0.1) if (co.inside(uu, nn)) corIn++;
  r.계단실집안침범 = corIn;
  const lim = LIMITS[scenario] ?? LIMITS.tour, over = [];
  if (corIn) over.push(`계단실집안침범 ${corIn} > 0`);
  for (const [k, v] of Object.entries(lim)) { const got = parseFloat(r[k]); if (got > v) over.push(`${k} ${r[k]} > ${v}`); }
  r.합격 = over.length === 0; r.불합격이유 = over;
  return r;
}

// 화면 검수용 캡처: 주소 ?shots=1 → 방마다 눈높이(1.5m)에서 방 가운데를 보는 장면 + 현관에서 현관문 밖을 보는 장면
// UI를 숨기고 그려서 [{ name, url(JPEG data URL) }]로 돌려준다. 카메라 자리는 카메라 칸(camNav) 안 · 방 가운데가 보이는 모서리 중 가장 먼 곳
// angles = true(?shots=angles): 방마다 서로 1.5m 넘게 떨어진 두 자리에서 찍는다 — '어느 각도에서 봐도' 검수용
export async function takeShots(T, max = 7, angles = false) {
  if (angles) max = 16;
  const S = T.S, M = T.house.mats, cn = S.camNav, cam = T.camera, out = [];
  const okCam = (x, z) => { const i = Math.floor(x / cn.cell), j = Math.floor(z / cn.cell); return cn.rows[j]?.[i] === '1'; };
  T.renderer.setAnimationLoop(null); T.setMode('follow', { instant: true });
  M.ceiling.opacity = 1; M.ceiling.transparent = false; M.ceiling.needsUpdate = true; T.house.ceilings.visible = true; if (T.ext) T.ext.visible = true;
  const st = document.createElement('style'); st.textContent = '#head,#side,#caption,#bar,#hint,#help,#qa-result{display:none!important}'; document.head.append(st);
  const snap = (name, p, l, fov = 64) => {
    cam.fov = fov; cam.updateProjectionMatrix(); cam.position.set(...p); cam.lookAt(...l);
    T.ext?.update(cam); T.fadeLeaves?.(1); T.scene.updateMatrixWorld(true);
    { const bb = new THREE.Box3(), c3 = new THREE.Vector3(), cp = new THREE.Vector3(...p); for (const l of T.leaves || []) l.visible = l.userData.fade > 0.02 && bb.setFromObject(l).distanceToPoint(cp) >= 1.6; } // 카메라 곁 문짝은 숨긴다(투어 구도와 같게)
    T.post.render(1 / 60); T.post.render(1 / 60);
    out.push({ name, url: T.renderer.domElement.toDataURL('image/jpeg', 0.88) });
  };
  const ray = new THREE.Raycaster(), blockers = T.blockers;
  const sees = (a, b) => { const d = b.clone().sub(a), L = d.length(); ray.set(a, d.normalize()); ray.far = L - 0.2; return !ray.intersectObjects(blockers, true).length; };
  T.scene.updateMatrixWorld(true);
  const order = ['living', 'kitchen', 'bedroom', 'balcony', 'bath', 'dress', 'office'];
  const rooms = S.rooms.filter(r => !r.auto && order.includes(r.type)).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || b.area - a.area);
  const used = new Set();
  // 볼 곳 = 방 넓이 중심과 그 방 가구 중심의 중간(가구가 있는 쪽이 화면에 들어온다. 주방처럼 긴 방은 '걷기 좋은 가운데'가 통로 끝이라 조리대가 안 보였다)
  // 카메라 자리 = 방 안 카메라 칸을 0.2m 간격으로 모두 살펴, 볼 곳이 보이고 · 멀수록 좋고 · 바로 앞(1.1m 안, 시선 ±50°)에 가구가 있으면 감점(화면 아래를 가구가 덮지 않게)
  const bodies = (S.solids || []).filter(s => s.x != null && s.kind !== 'leaf');
  const nearBlock = [...blockers, ...(T.leaves || [])];
  const leafC = (T.leaves || []).map(l => new THREE.Box3().setFromObject(l).getCenter(new THREE.Vector3())); // 열린 문짝 가운데
  const winC = (S.openings || []).filter(o => o.type === 'window' || o.type === 'slide').map(o => new THREE.Vector3((o.a[0] + o.b[0]) / 2, 1.3, (o.a[1] + o.b[1]) / 2));
  for (const r of rooms) {
    if (out.length >= max - 1 || (used.has(r.type) && r.type !== 'bedroom')) continue;
    let ax = 0, az = 0, aw = 0; for (const [a, b, c, d] of r.rects) { const w = (c - a) * (d - b); ax += (a + c) / 2 * w; az += (b + d) / 2 * w; aw += w; }
    ax /= aw || 1; az /= aw || 1;
    const mine = bodies.filter(s => s.kind === 'body' && T.house.roomAt(s.x, s.z) === r);
    let tx = ax, tz = az; if (mine.length) { tx = (ax + mine.reduce((q, s) => q + s.x, 0) / mine.length) / 2; tz = (az + mine.reduce((q, s) => q + s.z, 0) / mine.length) / 2; }
    const pick = (tx, tz) => {
      const t3 = new THREE.Vector3(tx, 0.9, tz); let best = null; const all = [];
      for (const [a, b, c, d] of r.rects) for (let x = a + 0.1; x < c; x += 0.2) for (let z = b + 0.1; z < d; z += 0.2) {
        if (!okCam(x, z)) continue;
        const dist = Math.hypot(tx - x, tz - z); if (dist < 0.8) continue;
        if (!sees(new THREE.Vector3(x, 1.5, z), t3)) continue;
        const ux = (tx - x) / dist, uz = (tz - z) / dist; let near = 0;
        for (const s of bodies) { const dx = s.x - x, dz = s.z - z, L = Math.hypot(dx, dz) || 1; if (L < 1.1 + Math.max(s.w, s.d) / 2 && (dx * ux + dz * uz) / L > 0.64) near++; }
        // 시선 좌우 ±12°·±24°·±36° 안 1.2m 앞에 벽·열린 문짝·키 큰 가구가 있으면 화면을 세로로 가린다 → 크게 감점
        let wallNear = 0; const o3 = new THREE.Vector3(x, 1.5, z);
        for (const ang of [-0.62, -0.42, -0.2, 0.2, 0.42, 0.62]) { const ca = Math.cos(ang), sa = Math.sin(ang); ray.set(o3, new THREE.Vector3(ux * ca - uz * sa, 0, ux * sa + uz * ca)); ray.far = 1.2; if (ray.intersectObjects(nearBlock, true).length) wallNear++; }
        // 그 방 가구가 몇 개나 보이는가(가구 가운데 쪽으로 쏜 광선이 가구 앞까지 안 막힘)
        let seen = 0; for (const s of mine) { const f3 = new THREE.Vector3(s.x, Math.min(1.2, (s.y1 ?? 0.8) * 0.7), s.z), dd = f3.clone().sub(o3), L = dd.length(); ray.set(o3, dd.normalize()); ray.far = Math.max(0.1, L - Math.max(s.w, s.d) / 2 - 0.25); if (!ray.intersectObjects(blockers, true).length) seen++; }
        // 열린 문짝이 시야 ±35° · 2.8m 안이면 화면 옆을 판자처럼 덮는다 → 감점. 이 방 바깥 창이 시야 ±30° 안에 보이면 가산(창 없는 벽만 찍히지 않게)
        let leafIn = 0; for (const c of leafC) { const dx = c.x - x, dz = c.z - z, L = Math.hypot(dx, dz) || 1; if (L < 2.8 && (dx * ux + dz * uz) / L > 0.82) leafIn++; }
        let winSeen = 0; for (const c of winC) { const dx = c.x - x, dz = c.z - z, L = Math.hypot(dx, dz) || 1; if (L < 7 && (dx * ux + dz * uz) / L > 0.87 && T.house.roomAt(c.x - (c.x - x) / L * 0.4, c.z - (c.z - z) / L * 0.4) === r && sees(o3, c)) { winSeen = 1; break; } }
        let along = 0; { const xs2 = r.rects.flatMap(q => [q[0], q[2]]), zs2 = r.rects.flatMap(q => [q[1], q[3]]), lx = Math.max(...xs2) - Math.min(...xs2), lz = Math.max(...zs2) - Math.min(...zs2); if (Math.max(lx, lz) > 1.8 * Math.min(lx, lz)) along = Math.abs(lx > lz ? ux : uz); } // 좁고 긴 방(통로형 주방): 긴 방향을 따라 보면 가산(가로로 보면 벽만 찍혔다)
        let cover = 0; for (let k = 0; k < 11; k++) { const ang = (k / 10 - 0.5) * 1.12, ca = Math.cos(ang), sa = Math.sin(ang); ray.set(o3, new THREE.Vector3(ux * ca - uz * sa, -0.05, ux * sa + uz * ca).normalize()); ray.far = 1.6; if (ray.intersectObjects(nearBlock, true).length) cover++; } // 화면 가로 시야에서 1.6m 안 벽·문짝이 덮는 비율
        let tight = 0; for (let k = 0; k < 8; k++) { const ang = k * Math.PI / 4; if (!okCam(x + Math.cos(ang) * 0.6, z + Math.sin(ang) * 0.6)) tight++; } // 사방 0.6m 안 벽·키 큰 물체 수(벽에 붙은 카메라는 화면 한쪽이 벽으로 막혔다)
        const sc = Math.min(dist, 4.5) + (mine.length ? 2 * seen / mine.length : 0) - 1.2 * near - 2 * wallNear - 2.2 * leafIn + 1.5 * winSeen - 0.9 * tight - (cover / 11 > 0.3 ? 30 : 0) + 2.5 * along; // 30% 넘게 덮이면 사실상 고르지 않는다
        all.push({ s: sc, p: [x, 1.5, z] }); if (!best || sc > best.s) best = { s: sc, p: [x, 1.5, z] };
      }
      if (best) best.all = all;
      return best;
    };
    let best = pick(tx, tz); if (!best) { [tx, tz] = r.center; best = pick(tx, tz); }
    if (!best) continue;
    { const hp = T.nav.nearest(tx, tz, 8); if (hp) T.walker.position.set(hp[0], 0, hp[1]); } // 걷는 자리를 볼 곳 근처로(카메라와 사이의 문짝을 반투명하게 하는 기준)
    snap(r.name, best.p, [tx, 1.05, tz], 68); used.add(r.type);
    if (angles) { // 두 번째 자리: 첫 자리에서 1.5m 넘게 떨어진 곳 중 점수가 가장 높은 곳, 방 반대쪽을 본다
      const far = best.all.filter(c => Math.hypot(c.p[0] - best.p[0], c.p[2] - best.p[2]) > 1.5).sort((a, b) => b.s - a.s)[0];
      if (far) { snap(r.name + ' 반대편', far.p, [tx, 1.0, tz], 68); }
    }
  }
  const d = S.openings.find(o => o.type === 'door' && o.exterior);
  if (d) { // 현관 안 1.4m에서 문 밖(계단실)을 본다
    const dc = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2], hz = Math.abs(d.b[0] - d.a[0]) > Math.abs(d.b[1] - d.a[1]); let n = hz ? [0, 1] : [1, 0];
    // 집 안쪽 고르기: 한 점만 보면 방과 방 사이 틈(트임 띠)에 걸려 바깥을 안으로 착각한다 → 문 폭 3곳 × 깊이 3곳으로 다수결
    let vin = 0, vout = 0;
    for (const k of [0.3, 0.6, 0.9]) for (const u of [0.25, 0.5, 0.75]) { const qx = d.a[0] + (d.b[0] - d.a[0]) * u, qz = d.a[1] + (d.b[1] - d.a[1]) * u; if (T.house.roomAt(qx + n[0] * k, qz + n[1] * k)) vin++; if (T.house.roomAt(qx - n[0] * k, qz - n[1] * k)) vout++; }
    if (vout > vin) n = [-n[0], -n[1]];
    let k = 1.4; while (k > 0.5 && !okCam(dc[0] + n[0] * k, dc[1] + n[1] * k)) k -= 0.1;
    snap('현관에서 본 복도', [dc[0] + n[0] * k, 1.5, dc[1] + n[1] * k], [dc[0] - n[0] * 2, 1.05, dc[1] - n[1] * 2], 68);
  }
  return out;
}

// 투어 실제 화면 캡처: 주소 ?shots=tour → 투어를 한 바퀴 돌며(runQA와 같은 시간 조종) 방에 도착해 자막이 뜬 뒤 wait초가 지난 순간을 찍는다.
// 검수용 캡처(takeShots)는 따로 고른 카메라 자리라 사용자가 투어에서 보는 화면과 다르다 → 눈 검수 점수는 이 캡처로 매긴다.
export async function takeTourShots(T, wait = 2.4) {
  const rr = T.renderer.render.bind(T.renderer), pr = T.post.render.bind(T.post), out = [];
  const st = document.createElement('style'); st.textContent = '#head,#side,#caption,#bar,#hint,#help,#qa-result{display:none!important}'; document.head.append(st);
  const oc = T.caption.bind(T); let pend = null;
  T.caption = (title, sub) => { oc(title, sub); if (T.touring && /투어 \d+\//.test(sub || '')) pend = { name: title, at: null }; };
  await runQA(T, 'tour', 900, simT => {
    if (!pend) return;
    if (pend.at == null) pend.at = simT + wait;
    if (simT < pend.at) return;
    T.renderer.render = rr; T.post.render = pr; // runQA는 그리기를 꺼 둔다 → 찍는 순간만 켠다
    T.ext?.update(T.camera); T.scene.updateMatrixWorld(true); pr(1 / 60); pr(1 / 60);
    out.push({ name: pend.name, url: T.renderer.domElement.toDataURL('image/jpeg', 0.88) });
    T.renderer.render = () => {}; T.post.render = () => {}; pend = null;
  });
  return out;
}
