// Геометрия без зависимостей: повороты, гомография, поза плоского листа.
// Оси листа: x вправо, y вниз, z «в лист» (от зрителя); центр листа — 0, ширина листа — 1.
// Оси камеры (как в OpenCV): x вправо, y вниз, z вперёд. Точка листа X → камера: R·X + t. Пиксель: (cx + f·x/z, cy + f·y/z).
// Матрицы 3×3 — массивы из 9 чисел по строкам.

export const mul3 = (a, b, o = new Array(9)) => {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
};
export const tr3 = (a) => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
export const mv3 = (a, v) => [a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2], a[6] * v[0] + a[7] * v[1] + a[8] * v[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);

// поворот по вектору (ось × угол)
export function rotVec(w) {
  const th = norm(w);
  if (th < 1e-12) return [1, -w[2], w[1], w[2], 1, -w[0], -w[1], w[0], 1];
  const x = w[0] / th, y = w[1] / th, z = w[2] / th, c = Math.cos(th), s = Math.sin(th), C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}
// вектор поворота матрицы
export function logRot(R) {
  const c = Math.max(-1, Math.min(1, (R[0] + R[4] + R[8] - 1) / 2)), th = Math.acos(c);
  if (th < 1e-9) return [(R[7] - R[5]) / 2, (R[2] - R[6]) / 2, (R[3] - R[1]) / 2];
  if (Math.PI - th < 1e-6) {   // около 180°
    const x = Math.sqrt(Math.max(0, (R[0] + 1) / 2)), y = Math.sqrt(Math.max(0, (R[4] + 1) / 2)) * (R[1] >= 0 ? 1 : -1), z = Math.sqrt(Math.max(0, (R[8] + 1) / 2)) * (R[2] >= 0 ? 1 : -1);
    return [x * th, y * th, z * th];
  }
  const k = th / (2 * Math.sin(th));
  return [(R[7] - R[5]) * k, (R[2] - R[6]) * k, (R[3] - R[1]) * k];
}
export const angleBetween = (A, B) => norm(logRot(mul3(A, tr3(B))));

// кватернионы [w, x, y, z]
export function quatFromR(R) {
  const t = R[0] + R[4] + R[8];
  let w, x, y, z;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (R[7] - R[5]) / s; y = (R[2] - R[6]) / s; z = (R[3] - R[1]) / s; }
  else if (R[0] > R[4] && R[0] > R[8]) { const s = Math.sqrt(1 + R[0] - R[4] - R[8]) * 2; w = (R[7] - R[5]) / s; x = s / 4; y = (R[1] + R[3]) / s; z = (R[2] + R[6]) / s; }
  else if (R[4] > R[8]) { const s = Math.sqrt(1 + R[4] - R[0] - R[8]) * 2; w = (R[2] - R[6]) / s; x = (R[1] + R[3]) / s; y = s / 4; z = (R[5] + R[7]) / s; }
  else { const s = Math.sqrt(1 + R[8] - R[0] - R[4]) * 2; w = (R[3] - R[1]) / s; x = (R[2] + R[6]) / s; y = (R[5] + R[7]) / s; z = s / 4; }
  const n = Math.hypot(w, x, y, z); return [w / n, x / n, y / n, z / n];
}
export function rFromQuat(q) {
  const [w, x, y, z] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
}
export function slerp(a, b, s) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], bb = b;
  if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
  let ka, kb;
  if (d > 0.9995) { ka = 1 - s; kb = s; } else { const th = Math.acos(d), sn = Math.sin(th); ka = Math.sin((1 - s) * th) / sn; kb = Math.sin(s * th) / sn; }
  const o = [a[0] * ka + bb[0] * kb, a[1] * ka + bb[1] * kb, a[2] * ka + bb[2] * kb, a[3] * ka + bb[3] * kb];
  const n = Math.hypot(...o); return o.map((v) => v / n);
}
export const quatAngle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));

// ---------- гомография ----------
export const applyH = (h, x, y) => { const z = h[6] * x + h[7] * y + h[8]; return [(h[0] * x + h[1] * y + h[2]) / z, (h[3] * x + h[4] * y + h[5]) / z]; };

// Решение симметричной положительно определённой системы (Холецкий), n×n по строкам. A и b портятся.
export function solveSPD(A, b, n) {
  for (let j = 0; j < n; j++) {
    let s = A[j * n + j];
    for (let k = 0; k < j; k++) s -= A[j * n + k] * A[j * n + k];
    if (!(s > 1e-18)) return null;
    const d = Math.sqrt(s); A[j * n + j] = d;
    for (let i = j + 1; i < n; i++) { let t = A[i * n + j]; for (let k = 0; k < j; k++) t -= A[i * n + k] * A[j * n + k]; A[i * n + j] = t / d; }
  }
  for (let i = 0; i < n; i++) { let t = b[i]; for (let k = 0; k < i; k++) t -= A[i * n + k] * b[k]; b[i] = t / A[i * n + i]; }
  for (let i = n - 1; i >= 0; i--) { let t = b[i]; for (let k = i + 1; k < n; k++) t -= A[k * n + i] * b[k]; b[i] = t / A[i * n + i]; }
  return b;
}

// Гомография по соответствиям (DLT с нормировкой, h8 = 1): src [x, y]…, dst [u, v]… (плоские массивы), w — веса (необяз.)
export function fitH(src, dst, n, w) {
  let mx = 0, my = 0, mu = 0, mv = 0, W = 0;
  for (let i = 0; i < n; i++) { const k = w ? w[i] : 1; mx += k * src[2 * i]; my += k * src[2 * i + 1]; mu += k * dst[2 * i]; mv += k * dst[2 * i + 1]; W += k; }
  mx /= W; my /= W; mu /= W; mv /= W;
  let sx = 0, su = 0;
  for (let i = 0; i < n; i++) { const k = w ? w[i] : 1; sx += k * Math.hypot(src[2 * i] - mx, src[2 * i + 1] - my); su += k * Math.hypot(dst[2 * i] - mu, dst[2 * i + 1] - mv); }
  sx = Math.SQRT2 * W / (sx || 1); su = Math.SQRT2 * W / (su || 1);
  const A = new Float64Array(64), b = new Float64Array(8), r = new Float64Array(8);
  for (let i = 0; i < n; i++) {
    const k = w ? w[i] : 1;
    const x = (src[2 * i] - mx) * sx, y = (src[2 * i + 1] - my) * sx, u = (dst[2 * i] - mu) * su, v = (dst[2 * i + 1] - mv) * su;
    for (let row = 0; row < 2; row++) {
      if (row === 0) { r[0] = x; r[1] = y; r[2] = 1; r[3] = 0; r[4] = 0; r[5] = 0; r[6] = -u * x; r[7] = -u * y; }
      else { r[0] = 0; r[1] = 0; r[2] = 0; r[3] = x; r[4] = y; r[5] = 1; r[6] = -v * x; r[7] = -v * y; }
      const rhs = row === 0 ? u : v;
      for (let a = 0; a < 8; a++) { b[a] += k * r[a] * rhs; for (let c = 0; c <= a; c++) A[a * 8 + c] += k * r[a] * r[c]; }
    }
  }
  for (let a = 0; a < 8; a++) for (let c = a + 1; c < 8; c++) A[a * 8 + c] = A[c * 8 + a];
  const h = solveSPD(A, b, 8);
  if (!h) return null;
  // снять нормировку: H = Tu⁻¹ · Hn · Tx
  const Hn = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  const Tx = [sx, 0, -sx * mx, 0, sx, -sx * my, 0, 0, 1], Tui = [1 / su, 0, mu, 0, 1 / su, mv, 0, 0, 1];
  const H = mul3(mul3(Tui, Hn), Tx);
  const s = H[8]; return H.map((v) => v / s);
}

// ---------- поза ----------
// Разложение гомографии «лист (bx, by ∈ 0…1) → пиксели» в позу (R, t) при известном фокусе.
export function poseFromH(h, f, cx, cy) {
  // к точкам листа с центром 0: (bx, by) = (X + 0.5, Y + 0.5)
  const c0 = [h[0], h[3], h[6]], c1 = [h[1], h[4], h[7]];
  const c2 = [0.5 * h[0] + 0.5 * h[1] + h[2], 0.5 * h[3] + 0.5 * h[4] + h[5], 0.5 * h[6] + 0.5 * h[7] + h[8]];
  const kinv = (c) => [(c[0] - cx * c[2]) / f, (c[1] - cy * c[2]) / f, c[2]];
  let r1 = kinv(c0), r2 = kinv(c1), t = kinv(c2);
  const n1 = norm(r1), n2 = norm(r2);
  if (!(n1 > 0 && n2 > 0)) return null;
  let lam = 2 / (n1 + n2);
  if (t[2] * lam < 0) lam = -lam;
  const sg = Math.sign(lam);
  r1 = r1.map((v) => v / n1 * sg); r2 = r2.map((v) => v / n2 * sg); t = t.map((v) => v * lam);
  const s = [r1[0] + r2[0], r1[1] + r2[1], r1[2] + r2[2]], q = [r1[0] - r2[0], r1[1] - r2[1], r1[2] - r2[2]];
  const ns = norm(s), nq = norm(q);
  if (!(ns > 0 && nq > 0)) return null;
  for (let i = 0; i < 3; i++) { const u = s[i] / ns, w = q[i] / nq; r1[i] = (u + w) / Math.SQRT2; r2[i] = (u - w) / Math.SQRT2; }
  const r3 = cross(r1, r2);
  return { R: [r1[0], r2[0], r3[0], r1[1], r2[1], r3[1], r1[2], r2[2], r3[2]], t };
}

// Второй вариант наклона плоского листа (зеркальный относительно луча зрения): издалека даёт почти ту же картинку.
export function flipPose(R, t) {
  const a = t.map((v) => v / norm(t));
  return { R: mul3(mul3(rotVec(a.map((v) => v * Math.PI)), R), [-1, 0, 0, 0, -1, 0, 0, 0, 1]), t: t.slice() };
}

// Уточнение позы по точкам (Левенберг — Марквардт, аналитические производные).
// pts: [bx, by, u, v] × n. prior (необяз.): { R, w } — мягкая привязка поворота к R с весом w (пикселей на радиан).
export function refinePose(R0, t0, pts, n, f, cx, cy, prior, iters = 8) {
  let R = R0.slice(), t = t0.slice();
  const res = (R, t) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const X = pts[i * 4] - 0.5, Y = pts[i * 4 + 1] - 0.5;
      const px = R[0] * X + R[1] * Y + t[0], py = R[3] * X + R[4] * Y + t[1], pz = R[6] * X + R[7] * Y + t[2];
      if (pz < 1e-3) return Infinity;
      const du = cx + f * px / pz - pts[i * 4 + 2], dv = cy + f * py / pz - pts[i * 4 + 3];
      s += du * du + dv * dv;
    }
    if (prior) { const e = logRot(mul3(R, tr3(prior.R))); s += prior.w * prior.w * (e[0] * e[0] + e[1] * e[1] + e[2] * e[2]); }
    return s;
  };
  let err = res(R, t), lam = 1e-3;
  const A = new Float64Array(36), b = new Float64Array(6), J = new Float64Array(12);
  for (let it = 0; it < iters; it++) {
    A.fill(0); b.fill(0);
    for (let i = 0; i < n; i++) {
      const X = pts[i * 4] - 0.5, Y = pts[i * 4 + 1] - 0.5;
      const qx = R[0] * X + R[1] * Y, qy = R[3] * X + R[4] * Y, qz = R[6] * X + R[7] * Y;
      const px = qx + t[0], py = qy + t[1], pz = qz + t[2], iz = 1 / pz;
      const ru = cx + f * px * iz - pts[i * 4 + 2], rv = cy + f * py * iz - pts[i * 4 + 3];
      // d(пиксель)/d(точка камеры)
      const a0 = f * iz, a2u = -f * px * iz * iz, a2v = -f * py * iz * iz;
      // точка камеры по повороту δω (слева): dP = δω × q = −[q]× δω ;  по сдвигу: единичная
      // du/dω = [a0, 0, a2u] · (−[q]×) ; −[q]× = [[0, qz, −qy], [−qz, 0, qx], [qy, −qx, 0]]
      J[0] = a2u * qy; J[1] = a0 * qz - a2u * qx; J[2] = -a0 * qy; J[3] = a0; J[4] = 0; J[5] = a2u;
      J[6] = -a0 * qz + a2v * qy; J[7] = -a2v * qx; J[8] = a0 * qx; J[9] = 0; J[10] = a0; J[11] = a2v;
      for (let a = 0; a < 6; a++) {
        b[a] -= J[a] * ru + J[6 + a] * rv;
        for (let c = 0; c <= a; c++) A[a * 6 + c] += J[a] * J[c] + J[6 + a] * J[6 + c];
      }
    }
    if (prior) {
      const e = logRot(mul3(R, tr3(prior.R))), w2 = prior.w * prior.w;
      for (let a = 0; a < 3; a++) { A[a * 6 + a] += w2; b[a] -= w2 * e[a]; }
    }
    for (let a = 0; a < 6; a++) for (let c = a + 1; c < 6; c++) A[a * 6 + c] = A[c * 6 + a];
    let ok = false;
    for (let tries = 0; tries < 5 && !ok; tries++) {
      const M = Float64Array.from(A); for (let a = 0; a < 6; a++) M[a * 6 + a] *= 1 + lam;
      const d = solveSPD(M, Float64Array.from(b), 6);
      if (!d) { lam *= 10; continue; }
      const R2 = mul3(rotVec([d[0], d[1], d[2]]), R), t2 = [t[0] + d[3], t[1] + d[4], t[2] + d[5]];
      const e2 = res(R2, t2);
      if (e2 < err) { R = R2; t = t2; ok = Math.abs(err - e2) > 1e-9 * err || true; const small = err - e2 < 1e-6 * err; err = e2; lam = Math.max(1e-7, lam * 0.3); if (small) it = iters; }
      else lam *= 10;
    }
    if (!ok) break;
  }
  return { R, t, err: Math.sqrt(err / Math.max(1, n)) };
}

export function project(R, t, X, f, cx, cy) {
  const p = mv3(R, X); const z = p[2] + t[2];
  if (z < 1e-3) return null;
  return [cx + f * (p[0] + t[0]) / z, cy + f * (p[1] + t[1]) / z];
}
