// Грубый поиск сдвига листа целиком (для рывков и смаза): на уменьшенной картинке ищем, где кадр больше всего похож
// на ожидаемый вид листа (нормированная корреляция). Лист 3×3 целиком не периодичен, поэтому сдвиг «на одну метку»
// здесь не проходит, в отличие от поиска краёв. Смаз почти не мешает: на 1/8 разрешения он и так размыт.
import { colorAt } from './board.js?v=0.12';
import { applyH } from './geom.js?v=0.12';

const MARGIN = 0.05;   // белая бумага вокруг поля (доля ширины): и на печати А4, и на 3D-пластине — не меньше 9 мм

function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
function sceneAt(bx, by) {
  if (bx < -MARGIN || by < -MARGIN || bx > 1 + MARGIN || by > 1 + MARGIN) return -1;   // дальше — неизвестно (стол)
  return colorAt(bx, by);
}

export function createCoarse() {
  let L4 = null, L8 = null, w4 = 0, h4 = 0, w8 = 0, h8 = 0, o4x = 0, o4y = 0;
  // уменьшить серый участок (gw×gh, левый верхний угол ox, oy) в 4 и в 8 раз; координаты — от начала кадра
  function prepare(g, gw, gh, ox, oy) {
    o4x = Math.ceil(ox / 4); o4y = Math.ceil(oy / 4);
    const sx = o4x * 4 - ox, sy = o4y * 4 - oy;
    w4 = ((gw - sx) / 4) | 0; h4 = ((gh - sy) / 4) | 0;
    if (!L4 || L4.length < w4 * h4) L4 = new Float32Array(w4 * h4);
    for (let y = 0; y < h4; y++) for (let x = 0; x < w4; x++) {
      let s = 0; const r = (sy + y * 4) * gw + sx + x * 4;
      for (let j = 0; j < 4; j++) { const q = r + j * gw; s += g[q] + g[q + 1] + g[q + 2] + g[q + 3]; }
      L4[y * w4 + x] = s / 16;
    }
    w8 = w4 >> 1; h8 = h4 >> 1;
    if (!L8 || L8.length < w8 * h8) L8 = new Float32Array(w8 * h8);
    for (let y = 0; y < h8; y++) for (let x = 0; x < w8; x++) { const q = 2 * y * w4 + 2 * x; L8[y * w8 + x] = (L4[q] + L4[q + 1] + L4[q + w4] + L4[q + w4 + 1]) / 4; }
  }
  // шаблон листа при гомографии H на сетке с шагом k (4 или 8) в координатах кадра: точки [x, y, значение]
  function template(H, k) {
    const Hi = inv3(H), pts = [];
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [bx, by] of [[-MARGIN, -MARGIN], [1 + MARGIN, -MARGIN], [1 + MARGIN, 1 + MARGIN], [-MARGIN, 1 + MARGIN]]) {
      const p = applyH(H, bx, by); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    const X0 = Math.floor(x0 / k), X1 = Math.ceil(x1 / k), Y0 = Math.floor(y0 / k), Y1 = Math.ceil(y1 / k);
    if ((X1 - X0) * (Y1 - Y0) > 20000) return null;
    const sub = 4;
    for (let Y = Y0; Y <= Y1; Y++) for (let X = X0; X <= X1; X++) {
      let s = 0, n = 0, out = false;
      for (let j = 0; j < sub && !out; j++) for (let i = 0; i < sub; i++) {
        const u = X * k + (i + 0.5) * k / sub - 0.5, v = Y * k + (j + 0.5) * k / sub - 0.5;
        const z = Hi[6] * u + Hi[7] * v + Hi[8];
        const c = sceneAt((Hi[0] * u + Hi[1] * v + Hi[2]) / z, (Hi[3] * u + Hi[4] * v + Hi[5]) / z);
        if (c < 0) { out = true; break; }
        s += c; n++;
      }
      if (!out) pts.push(X, Y, s / n);
    }
    return pts;
  }
  // нормированная корреляция шаблона со сдвигом (dX, dY) в клетках сетки уровня (L — картинка уровня)
  function zncc(pts, L, w, h, ox, oy, dX, dY) {
    let n = 0, st = 0, si = 0, stt = 0, sii = 0, sti = 0;
    for (let k = 0; k < pts.length; k += 3) {
      const x = pts[k] + dX - ox, y = pts[k + 1] + dY - oy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const t = pts[k + 2], v = L[y * w + x];
      n++; st += t; si += v; stt += t * t; sii += v * v; sti += t * v;
    }
    if (n < pts.length / 3 * 0.6 || n < 12) return -1;
    const ct = stt - st * st / n, ci = sii - si * si / n;
    if (ct <= 1e-6 || ci <= 1e-6) return -1;
    return (sti - st * si / n) / Math.sqrt(ct * ci);
  }
  // Найти сдвиг: H — ожидаемое положение листа, S — сколько пикселей кадра искать в каждую сторону.
  // Возвращает { dx, dy, score } (сдвиг в пикселях кадра) или null.
  function find(H, S) {
    const t8 = template(H, 8); if (!t8 || t8.length < 36) return null;
    const ox8 = o4x >> 1, oy8 = o4y >> 1, s8 = Math.ceil(S / 8);
    let best = -2, bx = 0, by = 0;
    for (let dY = -s8; dY <= s8; dY++) for (let dX = -s8; dX <= s8; dX++) {
      const z = zncc(t8, L8, w8, h8, ox8, oy8, dX, dY);
      if (z > best) { best = z; bx = dX; by = dY; }
    }
    if (best < 0) return null;
    const t4 = template(H, 4); if (!t4) return null;
    let b4 = -2, cx = 2 * bx, cy = 2 * by, fx = cx, fy = cy;
    for (let dY = cy - 2; dY <= cy + 2; dY++) for (let dX = cx - 2; dX <= cx + 2; dX++) {
      const z = zncc(t4, L4, w4, h4, o4x, o4y, dX, dY);
      if (z > b4) { b4 = z; fx = dX; fy = dY; }
    }
    return { dx: fx * 4, dy: fy * 4, score: b4 };
  }
  // насколько кадр похож на лист при гомографии H (уровень 1/4) — для проверки результата
  function score(H) { const t4 = template(H, 4); return t4 ? zncc(t4, L4, w4, h4, o4x, o4y, 0, 0) : -1; }
  return { prepare, find, score };
}
