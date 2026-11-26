// Бегущий затвор (rolling shutter). Дешёвая камера читает кадр не разом, а полосами: на «дурном» — по столбцам
// за ~20–30 мс. При быстром движении лист на кадре растянут или сжат, и это читается как лишний наклон —
// Земля «качается» относительно листа («желе»). Поправка: каждую точку листа сдвигаем назад на
//   скорость точки × время её считывания относительно центра листа,
// где время = kx·(x − x центра)/ширина кадра + ky·(y − y центра)/высота кадра (мс). Центр листа не двигается.
// Скорость точки — по гомографиям этого и прошлого распознавания (только прошлое: поза нужна сразу).
//
// kx, ky (время считывания всего кадра со знаком направления) у каждой камеры свои, поэтому они оцениваются
// по ходу работы: в движении сравнивается «горб» формы листа (насколько кадр выбился из прямой между соседями)
// с перекосом, который дал бы затвор, — регрессия по накопленным данным. Пока данных мало, k тянется к нулю.
import { applyH, fitH } from './geom.js?v=0.17';

const GRID = []; for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) GRID.push([a / 4, b / 4]);

export function createRollingShutter(o = {}) {
  const opt = {
    fixed: null,     // [kx, ky] мс — задать вручную (без оценки); null — оценивать
    off: false,      // совсем без поправки
    maxK: 40,        // мс, предел
    ridge: 0.05,     // «вес нуля» в регрессии: пока доказательств мало, k ≈ 0
    init: null,      // { k: [kx, ky], ev } — выученное в прошлый раз (страница хранит у себя), ev — его вес
    maxV: 2,         // px/мс: быстрее — скорее сбой распознавания, чем движение; не учим и не поправляем
    maxShift: 10,    // px: поправка точки не больше этого
    extrap: 0,       // доля поправки скорости на ускорение (по двум прошлым распознаваниям)
    decay: 0.9995,   // забывание на каждый учтённый кадр (сменилась камера — подстроится)
    velGap: 90,      // мс: скорость для поправки — только по соседнему распознаванию не дальше этого
    learnGap: 110,   // мс: учёт — только если соседи по обе стороны вместе не дальше этого
    minTags: 6,      // учёт — только по уверенным кадрам
    clipPx: 6,       // px: «горб» больше этого — не затвор, а сбой, обрезаем
    ...o,
  };
  let W = 480, H = 640;
  const hist = [];   // последние сырые распознавания { tf, H, tags }
  const A = { a11: 0, a12: 0, a22: 0, b1: 0, b2: 0, n: 0 };
  let k = opt.fixed ? opt.fixed.slice() : [0, 0];
  if (!opt.fixed && opt.init && opt.init.k && opt.init.ev > 0) {     // прошлое знание — как ev «наблюдений» с этим k
    const e = Math.min(opt.init.ev, 1); A.a11 = A.a22 = e; A.b1 = opt.init.k[0] * e; A.b2 = opt.init.k[1] * e; solveK();
  }
  function solveK() {
    const l = opt.ridge, a11 = A.a11 + l, a22 = A.a22 + l, det = a11 * a22 - A.a12 * A.a12;
    if (det > 0) k = [(A.b1 * a22 - A.b2 * A.a12) / det, (a11 * A.b2 - A.a12 * A.b1) / det].map((v) => Math.max(-opt.maxK, Math.min(opt.maxK, v)));
  }

  function setCamera(w, h) { W = w; H = h; hist.length = 0; }
  const vel = (a, c, p) => { const pa = applyH(a.H, p[0], p[1]), pc = applyH(c.H, p[0], p[1]), dt = c.tf - a.tf; return [(pc[0] - pa[0]) / dt, (pc[1] - pa[1]) / dt]; };
  // перекос затвора для точки листа p в распознавании j (скорость — центральная разность), по осям x и y
  function skew(j, p) {
    const a = hist[j - 1], d = hist[j], c = hist[j + 1];
    if (!a || !c || c.tf - a.tf > 150) return null;
    const q = applyH(d.H, p[0], p[1]), ctr = applyH(d.H, 0.5, 0.5), v = vel(a, c, p);
    if (Math.hypot(v[0], v[1]) > opt.maxV) return null;
    const sx = (q[0] - ctr[0]) / W, sy = (q[1] - ctr[1]) / H;
    return [v[0] * sx, v[1] * sx, v[0] * sy, v[1] * sy];
  }
  // учесть средний из последних пяти (нужны его соседи и их соседи)
  function learn() {
    if (opt.fixed || opt.off || hist.length < 5) return;
    const i = hist.length - 3, a = hist[i - 1], d = hist[i], c = hist[i + 1];
    if (c.tf - a.tf > opt.learnGap || d.tags < opt.minTags || a.tags < opt.minTags || c.tags < opt.minTags) return;
    const w = (d.tf - a.tf) / (c.tf - a.tf);
    const R = [], B = [];
    for (const p of GRID) {
      const pd = applyH(d.H, p[0], p[1]), pa = applyH(a.H, p[0], p[1]), pc = applyH(c.H, p[0], p[1]);
      const gd = skew(i, p), ga = skew(i - 1, p), gc = skew(i + 1, p);
      if (!gd || !ga || !gc) return;
      R.push([pd[0] - (pa[0] * (1 - w) + pc[0] * w), pd[1] - (pa[1] * (1 - w) + pc[1] * w)]);
      B.push(gd.map((g, m) => g - (ga[m] * (1 - w) + gc[m] * w)));   // [x-ось: dx, dy, y-ось: dx, dy]
    }
    // сдвиг целиком — настоящее ускорение, не затвор: убираем средние
    const n = R.length, mr = [0, 0], mb = [0, 0, 0, 0];
    for (let j = 0; j < n; j++) { mr[0] += R[j][0] / n; mr[1] += R[j][1] / n; for (let m = 0; m < 4; m++) mb[m] += B[j][m] / n; }
    A.a11 *= opt.decay; A.a12 *= opt.decay; A.a22 *= opt.decay; A.b1 *= opt.decay; A.b2 *= opt.decay;
    for (let j = 0; j < n; j++) for (let q = 0; q < 2; q++) {
      const r = Math.max(-opt.clipPx, Math.min(opt.clipPx, R[j][q] - mr[q])), x = B[j][q] - mb[q], y = B[j][2 + q] - mb[2 + q];
      A.a11 += x * x; A.a12 += x * y; A.a22 += y * y; A.b1 += x * r; A.b2 += y * r;
    }
    A.n++;
    solveK();
  }
  // поправить распознавание (сырое остаётся для учёта); возвращает новое { ...d, H, pts } или то же d
  function correct(d) {
    if (opt.off || !d.H) return d;
    const a = hist.length ? hist[hist.length - 1] : null;
    if (!a || a.tf >= d.tf || d.tf - a.tf > opt.velGap || (!k[0] && !k[1])) return d;
    const ctr = applyH(d.H, 0.5, 0.5), n = GRID.length, src = new Float64Array(2 * n), dst = new Float64Array(2 * n);
    const dt = d.tf - a.tf;
    const z = opt.extrap && hist.length > 1 ? hist[hist.length - 2] : null, dt0 = z ? a.tf - z.tf : 0;
    const ex = z && dt0 > 0 && dt0 <= opt.velGap ? opt.extrap * dt / (dt0 + dt) : 0;
    for (let j = 0; j < n; j++) {
      const p = GRID[j], q = applyH(d.H, p[0], p[1]), qa = applyH(a.H, p[0], p[1]);
      let vx = (q[0] - qa[0]) / dt, vy = (q[1] - qa[1]) / dt;
      if (ex) { const qz = applyH(z.H, p[0], p[1]), ux = (qa[0] - qz[0]) / dt0, uy = (qa[1] - qz[1]) / dt0; vx += ex * (vx - ux); vy += ex * (vy - uy); }
      const sp = Math.hypot(vx, vy); if (sp > opt.maxV) return d;               // скачок распознавания — не трогаем
      const s = k[0] * (q[0] - ctr[0]) / W + k[1] * (q[1] - ctr[1]) / H;
      let dx = vx * s, dy = vy * s; const m = Math.hypot(dx, dy); if (m > opt.maxShift) { dx *= opt.maxShift / m; dy *= opt.maxShift / m; }
      src[2 * j] = p[0]; src[2 * j + 1] = p[1]; dst[2 * j] = q[0] - dx; dst[2 * j + 1] = q[1] - dy;
    }
    const Hc = fitH(src, dst, n);
    if (!Hc) return d;
    let pts = d.pts;
    if (pts) { pts = Float64Array.from(pts); for (let j = 0; j < pts.length; j += 4) { const q = applyH(Hc, pts[j], pts[j + 1]); pts[j + 2] = q[0]; pts[j + 3] = q[1]; } }
    return { ...d, H: Hc, pts };
  }
  // запомнить сырое распознавание (или потерю: тогда цепочка рвётся)
  function push(d) {
    if (!d.H) { hist.length = 0; return; }
    if (hist.length && d.tf <= hist[hist.length - 1].tf) return;
    hist.push({ tf: d.tf, H: d.H, tags: d.tags || 0 }); if (hist.length > 5) hist.shift();
    learn();
  }
  return { setCamera, correct, push, get k() { return k; }, get evidence() { return Math.max(A.a11, A.a22); }, get n() { return A.n; }, opt };
}

// Тот же затвор при рисовании: сцена искажается так же, как кадр, — тогда и лист, и Земля совпадают с картинкой
// (поза уже исправлена — она «истинная»; без этого края листа на кадре разъезжались бы с рамкой на несколько px).
// rsQ — переход «клип сейчас → клип на dt раньше» (движение камеры), rsK — (kx/dt, ky/dt в долях NDC, центр листа в NDC).
export const RS_GLSL = `
uniform mat4 rsQ; uniform vec4 rsK;
vec4 rsW(vec4 c) {
  if (rsK.x == 0.0 && rsK.y == 0.0) return c;
  vec4 c0 = rsQ * c;
  if (c.w <= 0.0 || c0.w <= 0.0) return c;
  vec2 n1 = c.xy / c.w, n0 = c0.xy / c0.w;
  float s = rsK.x * (n1.x - rsK.z) + rsK.y * (n1.y - rsK.w);
  return vec4((n1 + (n1 - n0) * s) * c.w, c.z, c.w);
}`;
const ZERO4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function setRS(gl, pr, rs) {
  const q = gl.getUniformLocation(pr, 'rsQ'), k = gl.getUniformLocation(pr, 'rsK');
  if (q) gl.uniformMatrix4fv(q, false, rs ? rs.Q : ZERO4);
  if (k) gl.uniform4fv(k, rs ? rs.K : [0, 0, 0, 0]);
}

const mul4 = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
// обратная 4×4 (по столбцам), общая формула через миноры
export function inv4(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const d = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!d) return null; const id = 1 / d;
  return [(a11 * b11 - a12 * b10 + a13 * b09) * id, (a02 * b10 - a01 * b11 - a03 * b09) * id, (a31 * b05 - a32 * b04 + a33 * b03) * id, (a22 * b04 - a21 * b05 - a23 * b03) * id,
    (a12 * b08 - a10 * b11 - a13 * b07) * id, (a00 * b11 - a02 * b08 + a03 * b07) * id, (a32 * b02 - a30 * b05 - a33 * b01) * id, (a20 * b05 - a22 * b02 + a23 * b01) * id,
    (a10 * b10 - a11 * b08 + a13 * b06) * id, (a01 * b08 - a00 * b10 - a03 * b06) * id, (a30 * b04 - a31 * b02 + a33 * b00) * id, (a21 * b02 - a20 * b04 - a23 * b00) * id,
    (a11 * b07 - a10 * b09 - a12 * b06) * id, (a00 * b09 - a01 * b07 + a02 * b06) * id, (a31 * b01 - a30 * b03 - a32 * b00) * id, (a20 * b03 - a21 * b01 + a22 * b00) * id];
}
// uniforms затвора: P — проекция, M — поза сейчас, M0 — поза на dt мс раньше (по столбцам), k — [kx, ky] мс,
// sx, sy — «доля NDC на пиксель кадра камеры» / 2 по осям (см. render.js: cw / (2·s·vw), ch / (2·s·vh))
export function rsUniforms(P, M, M0, k, dt, sx, sy) {
  const Mi = inv4(M), Pi = inv4(P);
  if (!Mi || !Pi) return null;
  const Q = mul4(mul4(P, mul4(M0, Mi)), Pi), c = mul4(P, M).slice(12, 16);
  return { Q, K: [k[0] / dt * sx, -k[1] / dt * sy, c[0] / c[3], c[1] / c[3]] };
}
