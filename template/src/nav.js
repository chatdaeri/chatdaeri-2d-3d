// 걷기 격자(scene.nav: 0.1m 칸, '1' = 걸을 수 있음) + A* 길찾기 + 직선으로 줄이기 + 문은 가운데로 곧게 지나가기
export class Nav {
  // doors: scene.openings 중 문(과 1.2m 미만 트임) — 길이 이 틈을 지나면 문 앞 0.45m → 가운데 → 문 뒤 0.45m를 거친다(문틀·문짝에 몸이 묻히지 않게)
  constructor(n, doors = []) {
    this.c = n.cell; this.w = n.w; this.h = n.h;
    this.g = new Uint8Array(this.w * this.h);
    n.rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) this.g[j * this.w + i] = row.charCodeAt(i) === 49 ? 1 : 0; });
    this.doors = doors.map(o => {
      const dx = o.b[0] - o.a[0], dz = o.b[1] - o.a[1], L = Math.hypot(dx, dz) || 1;
      return { a: o.a, b: o.b, c: [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2], n: [-dz / L, dx / L] };
    });
  }
  cellOf(x, z) { return [Math.floor(x / this.c), Math.floor(z / this.c)]; }
  ok(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h && this.g[j * this.w + i] === 1; }
  walkable(x, z) { const [i, j] = this.cellOf(x, z); return this.ok(i, j); }
  nearest(x, z, maxR = 40) {
    const [i0, j0] = this.cellOf(x, z);
    if (this.ok(i0, j0)) return [x, z];
    for (let r = 1; r <= maxR; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (this.ok(i0 + di, j0 + dj)) return [(i0 + di + 0.5) * this.c, (j0 + dj + 0.5) * this.c];
    }
    return null;
  }
  find(ax, az, bx, bz) {
    const pts = this.astar(ax, az, bx, bz);
    return pts && this.viaDoors(pts);
  }
  astar(ax, az, bx, bz) {
    const s = this.nearest(ax, az), e = this.nearest(bx, bz);
    if (!s || !e) return null;
    const [si, sj] = this.cellOf(...s), [ei, ej] = this.cellOf(...e);
    const W = this.w, N = W * this.h, gS = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const h = (i, j) => { const dx = Math.abs(i - ei), dy = Math.abs(j - ej); return dx + dy - 0.586 * Math.min(dx, dy); };
    const open = [[h(si, sj), si, sj]]; gS[sj * W + si] = 0;
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let found = false;
    while (open.length) {
      let bi = 0; for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
      const [, i, j] = open.splice(bi, 1)[0], id = j * W + i;
      if (closed[id]) continue; closed[id] = 1;
      if (i === ei && j === ej) { found = true; break; }
      for (const [di, dj, cost] of D) {
        const ni = i + di, nj = j + dj; if (!this.ok(ni, nj)) continue;
        if (di && dj && (!this.ok(i + di, j) || !this.ok(i, j + dj))) continue; // 모서리 깎지 않기
        const nid = nj * W + ni, ng = gS[id] + cost;
        if (ng < gS[nid]) { gS[nid] = ng; from[nid] = id; open.push([ng + h(ni, nj), ni, nj]); }
      }
    }
    if (!found) return null;
    const cells = []; for (let id = ej * W + ei; id !== -1; id = from[id]) cells.push([(id % W + 0.5) * this.c, (Math.floor(id / W) + 0.5) * this.c]);
    cells.reverse();
    // 첫 점은 칸 가운데가 아니라 지금 서 있는 자리: 직선 검사를 실제로 걸을 선으로 한다(칸 경계 위에서 제자리걸음 방지)
    cells[0] = s; cells[cells.length - 1] = e;
    // 보이는 곳까지 건너뛰기
    const pts = [cells[0]];
    let k = 0;
    while (k < cells.length - 1) {
      let far = k + 1;
      for (let m = cells.length - 1; m > k + 1; m--) if (this.clear(cells[k], cells[m])) { far = m; break; }
      pts.push(cells[far]); k = far;
    }
    return pts;
  }
  // p → q가 지나는 첫 문(선분 교차)
  crossing(p, q) {
    let best = null, bt = 2;
    for (const d of this.doors) {
      const r = [q[0] - p[0], q[1] - p[1]], s = [d.b[0] - d.a[0], d.b[1] - d.a[1]];
      const den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-9) continue;
      const w = [d.a[0] - p[0], d.a[1] - p[1]];
      const t = (w[0] * s[1] - w[1] * s[0]) / den, u = (w[0] * r[1] - w[1] * r[0]) / den;
      if (t > 0 && t < 1 && u >= -0.05 && u <= 1.05 && t < bt) { bt = t; best = d; }
    }
    return best;
  }
  viaDoors(pts) {
    const out = [pts[0]];
    const reach = w => { // out 끝 → w: 막혀 있으면 그 사이만 다시 찾는다
      const last = out[out.length - 1];
      if (!this.clear(last, w)) { const sub = this.astar(last[0], last[1], w[0], w[1]); if (sub) out.push(...sub.slice(1, -1)); }
      out.push(w);
    };
    for (let i = 1; i < pts.length; i++) {
      const p = out[out.length - 1], q = pts[i], d = this.crossing(p, q);
      if (d) {
        const sg = Math.sign((q[0] - p[0]) * d.n[0] + (q[1] - p[1]) * d.n[1]) || 1;
        const at = o => this.nearest(d.c[0] + d.n[0] * sg * o, d.c[1] + d.n[1] * sg * o, 3);
        const ahead = a => ((a[0] - d.c[0]) * d.n[0] + (a[1] - d.c[1]) * d.n[1]) * sg; // 문을 지나는 방향으로 문 가운데에서 얼마나(m)
        const w1 = at(-0.45), cc = at(0), w2 = at(0.45);
        if (w1 && cc && w2 && this.clear(w1, cc) && this.clear(cc, w2)) {
          if (ahead(p) < -0.5) reach(w1); // 이미 문 바로 앞이면 앞 점은 건너뛴다
          reach(cc);
          if (ahead(q) > 0.5) reach(w2);
          reach(q);
          continue;
        }
      }
      reach(q);
    }
    return out;
  }
  clear(a, b) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / (this.c * 0.5));
    for (let s = 1; s < n; s++) { const t = s / n; if (!this.walkable(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false; }
    return true;
  }
}
