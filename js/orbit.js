// Орбиты по элементам CelesTrak (OMM): Кеплер + вековые поправки J2 (поворот узла и перицентра) + торможение
// (MEAN_MOTION_DOT). Для показа этого хватает: на «художественной» шкале 1 px ≈ 50–100 км.
// Оси — инерциальные (ECI, «звёзды неподвижны»): z — к северу, x — на точку весны. Единицы — км, мс.
export const MU = 398600.4418, RE = 6378.137, J2 = 1.08262668e-3;
const D2R = Math.PI / 180, TAU = 2 * Math.PI;

// элементы из OMM: n — рад/с, a — км, углы — рад, epoch — мс (UTC)
export function fromOMM(o) {
  const n = o.MEAN_MOTION * TAU / 86400, e = +o.ECCENTRICITY, i = o.INCLINATION * D2R;
  const a = Math.cbrt(MU / (n * n));
  const p = a * (1 - e * e), k = 1.5 * J2 * (RE / p) ** 2 * n;
  const ep = o.EPOCH.endsWith('Z') ? o.EPOCH : o.EPOCH + 'Z';
  return {
    epoch: Date.parse(ep), n, a, e, i,
    raan0: o.RA_OF_ASC_NODE * D2R, argp0: o.ARG_OF_PERICENTER * D2R, m0: o.MEAN_ANOMALY * D2R,
    raanDot: -k * Math.cos(i),                                   // рад/с
    argpDot: 0.5 * k * (5 * Math.cos(i) ** 2 - 1),
    mdd: (+o.MEAN_MOTION_DOT || 0) * TAU / (86400 * 86400),      // MEAN_MOTION_DOT = n'/2, об/сут² → рад/с²
  };
}

// элементы на момент t (мс): узел, перицентр, средняя аномалия (в двойной точности — для видеокарты потом малые dt)
export function at(el, t) {
  const dt = (t - el.epoch) / 1000;
  return { raan: el.raan0 + el.raanDot * dt, argp: el.argp0 + el.argpDot * dt, M: (el.m0 + el.n * dt + el.mdd * dt * dt) % TAU, nNow: el.n + 2 * el.mdd * dt };
}

// положение (км, ECI) на момент t
export function posECI(el, t) {
  const { raan, argp, M } = at(el, t);
  return posFrom(el.a, el.e, el.i, raan, argp, M);
}
export function posFrom(a, e, i, raan, argp, M) {
  let E = M;
  for (let k = 0; k < 6; k++) E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const x = a * (Math.cos(E) - e), y = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(argp), sw = Math.sin(argp), co = Math.cos(raan), so = Math.sin(raan), ci = Math.cos(i), si = Math.sin(i);
  const xp = x * cw - y * sw, yp = x * sw + y * cw;
  return [xp * co - yp * ci * so, xp * so + yp * ci * co, yp * si];
}

// звёздное время Гринвича (рад) — как в satellite.js (gstime)
export function gmst(t) {
  const jd = t / 86400000 + 2440587.5, tut1 = (jd - 2451545.0) / 36525;
  let g = -6.2e-6 * tut1 ** 3 + 0.093104 * tut1 ** 2 + (876600 * 3600 + 8640184.812866) * tut1 + 67310.54841;
  g = ((g * D2R) / 240) % TAU;
  return g < 0 ? g + TAU : g;
}

// направление на Солнце (ECI, единичный вектор), точность ~1° — для освещения хватает
export function sunECI(t) {
  const d = t / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.46 + 0.9856474 * d) * D2R, g = (357.528 + 0.9856003 * d) * D2R;
  const lam = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R, eps = (23.439 - 4e-7 * d) * D2R;
  return [Math.cos(lam), Math.cos(eps) * Math.sin(lam), Math.sin(eps) * Math.sin(lam)];
}

// «художественная» шкала основного проекта: радиус в сцене (в радиусах Земли) по расстоянию от центра (км)
export const artR = (rkm) => 1 + 0.69 * Math.pow(Math.max(rkm - RE, 0) / RE, 0.324);

// Элементы орбиты по положению и скорости (км, км/с) — для спутников, которые ведутся по SGP4:
// точное состояние раз в полсекунды → элементы → видеокарта продолжает по Кеплеру.
export function fromRV(r, v) {
  const rr = Math.hypot(r[0], r[1], r[2]), vv2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2], rv = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
  const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]], hh = Math.hypot(h[0], h[1], h[2]);
  const a = 1 / (2 / rr - vv2 / MU);
  const ev = [0, 1, 2].map((k) => ((vv2 - MU / rr) * r[k] - rv * v[k]) / MU), e = Math.hypot(ev[0], ev[1], ev[2]);
  const i = Math.acos(Math.max(-1, Math.min(1, h[2] / hh)));
  // направление на узел (у экваториальных — ось x)
  let N = [-h[1], h[0], 0], nn = Math.hypot(N[0], N[1]);
  const raan = nn > 1e-8 * hh ? Math.atan2(N[1], N[0]) : 0;
  if (!(nn > 1e-8 * hh)) { N = [1, 0, 0]; nn = 1; }
  const Nh = [N[0] / nn, N[1] / nn, 0], hu = [h[0] / hh, h[1] / hh, h[2] / hh];
  const W = [hu[1] * Nh[2] - hu[2] * Nh[1], hu[2] * Nh[0] - hu[0] * Nh[2], hu[0] * Nh[1] - hu[1] * Nh[0]];   // в плоскости, 90° от узла
  const ang = (x) => Math.atan2(x[0] * W[0] + x[1] * W[1] + x[2] * W[2], x[0] * Nh[0] + x[1] * Nh[1] + x[2] * Nh[2]);
  const u = ang(r);                                         // аргумент широты
  let argp = 0, nu = u;
  if (e > 1e-7) { argp = ang(ev); nu = u - argp; }
  const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
  return { a, e, i, raan, argp, M: E - e * Math.sin(E), n: Math.sqrt(MU / (a * a * a)) };
}
