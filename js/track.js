// Слежение за листом по известному рисунку: края клеток всех меток ищутся в полном разрешении вдоль нормали
// около предсказанного положения, по ним уточняется гомография «лист → пиксели» (8 чисел, через 4 угла листа).
// Проверка: по найденной гомографии читаются клетки меток; лист принят, если коды совпали.
import { buildEdges, tagCorners, cellOf, NTAG, CELL } from './board.js?v=0.25';
import { applyH, solveSPD } from './geom.js?v=0.25';

const SHEET = [[0, 0], [1, 0], [1, 1], [0, 1]];

// гомография по 4 точкам: углы листа (0,0),(1,0),(1,1),(0,1) → c[0..7]
export function hFrom4(c) {
  // квадрат → четырёхугольник (Хекберт)
  const x0 = c[0], y0 = c[1], x1 = c[2], y1 = c[3], x2 = c[4], y2 = c[5], x3 = c[6], y3 = c[7];
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let g, h;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) { g = 0; h = 0; }
  else {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-12) return null;
    g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den;
  }
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}
export const cornersOf = (H) => { const o = []; for (const [x, y] of SHEET) o.push(...applyH(H, x, y)); return o; };

export function createTracker(o = {}) {
  // stable — опыт 0.3 (?edge=stable): вес края плавно зависит от размера клетки вдоль нормали (вместо жёсткого
  // порога), масштаб невязок сглаживается между кадрами. Цель — чтобы набор краёв не скакал от кадра к кадру.
  const opt = { tukey: 4.685, minSigma: 0.35, stable: false, innerWin: 0.8, maxPasses: 5, outerFirst: 5, relax: 0.5, fitIters: 3, stopMove: 0.15, ...o };
  let sigPrev = 0;
  const E = buildEdges();
  const N = E.length;
  // рабочие массивы
  const mu = new Float64Array(N), mv = new Float64Array(N), nu = new Float64Array(N), nv = new Float64Array(N);
  const ok = new Uint8Array(N), str = new Float64Array(N), res = new Float64Array(N), wt = new Float64Array(N), gwt = new Float64Array(N).fill(1);
  const st = { n: 0, used: 0, rms: 0, tagsOk: 0, tagsVis: 0, cellPx: 0, contrast: 0, passes: 0, why: '' };

  let G = null, GW = 0, GH = 0, OX = 0, OY = 0;   // серый участок кадра и его место в кадре
  const pix = (u, v) => {                           // билинейно, координаты кадра
    const x = u - OX, y = v - OY;
    if (x < 0 || y < 0 || x >= GW - 1 || y >= GH - 1) return -1;
    const ix = x | 0, iy = y | 0, fx = x - ix, fy = y - iy, i = iy * GW + ix;
    return (G[i] * (1 - fx) + G[i + 1] * fx) * (1 - fy) + (G[i + GW] * (1 - fx) + G[i + GW + 1] * fx) * fy;
  };

  // поиск края для всех точек; R — полуширина поиска (px), inner — и внутренние края клеток
  const prof = new Float64Array(64);
  const rej = new Int32Array(6);
  const why = new Int8Array(N);      // для отладки: −1 не искали, 0 взят, 1…6 — причина отказа       // почему край не взят: мелко, вне кадра, слабый, на краю окна, два края, слабее других
  function search(H, R, inner) {
    let cnt = 0;
    const strs = [];
    rej.fill(0); why.fill(-1);
    for (let i = 0; i < N; i++) {
      ok[i] = 0;
      const e = E[i];
      if (!inner && !e.outer) continue;
      const p = applyH(H, e.bx, e.by), q = applyH(H, e.bx + e.nx * CELL, e.by + e.ny * CELL);
      let dx = q[0] - p[0], dy = q[1] - p[1];
      const cell = Math.hypot(dx, dy);                 // клетка в пикселях вдоль нормали
      if (opt.stable) {
        // вес по размеру клетки: наружные края — от 2 до 3,5 px, внутренние — от 3,5 до 5,5 px
        gwt[i] = e.outer ? Math.min(1, Math.max(0, (cell - 2) / 1.5)) : Math.min(1, Math.max(0, (cell - 3.5) / 2));
        if (!(gwt[i] > 0)) { rej[0]++; why[i] = 1; continue; }
      } else if (!(cell > (e.outer ? 1.6 : 2.6))) { rej[0]++; why[i] = 1; continue; }  // слишком мелко
      dx /= cell; dy /= cell;
      // окно: для наружных краёв — R; для внутренних — около половины клетки, но не меньше ±2 px
      // (одноимённый соседний край не ближе двух клеток, а при ±1 px край на границе окна терял долю пикселя)
      // Наружный край: внутри метки одноимённый край (тёмная клетка → белая) не ближе 2 клеток, снаружи — 2,7 клетки;
      // поэтому окно не шире 1,5 клетки ВДОЛЬ НОРМАЛИ этого края (под наклоном клетка вдоль сжатия — всего 3 px).
      // Внутренний край: одноимённый соседний край не ближе 2 клеток, а края обратного перепада отсекает знак —
      // поэтому окно до 0,8 клетки (узкое окно не вытягивало ошибку дальнего края листа под наклоном).
      const r = e.outer ? Math.max(2, Math.min(R | 0, Math.round(1.5 * cell))) : Math.max(2, Math.min(R, Math.round(opt.innerWin * cell)));
      // профиль яркости вдоль нормали: от −r−1 до r+1
      let bad = false;
      for (let s = -r - 1, k = 0; s <= r + 1; s++, k++) { const v = pix(p[0] + s * dx, p[1] + s * dy); if (v < 0) { bad = true; break; } prof[k] = v; }
      if (bad) { rej[1]++; why[i] = 2; continue; }
      // производная (от тёмного к светлому — положительная), максимум
      let best = -1e9, bs = 0, second = -1e9;
      for (let s = -r, k = 1; s <= r; s++, k++) {
        const d = (prof[k + 1] - prof[k - 1]) * 0.5;
        if (d > best) { if (Math.abs(s - bs) > 2) second = Math.max(second, best); best = d; bs = s; } else if (Math.abs(s - bs) > 2 && d > second) second = d;
      }
      if (!(best > 3)) { rej[2]++; why[i] = 3; continue; }
      if (bs === -r || bs === r) { rej[3]++; why[i] = 4; continue; }   // максимум на краю окна — настоящий край может быть дальше
      if (second > 0.75 * best) { rej[4]++; why[i] = 5; continue; }   // два похожих края — не знаем, какой наш
      // доля пикселя: парабола по соседям
      const k = bs + r + 1;
      let off = 0;
      {
        const a = (prof[k] - prof[k - 2]) * 0.5, c = (prof[k + 2] - prof[k]) * 0.5;
        const den = a - 2 * best + c;
        if (den < 0) off = Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den));
      }
      const s = bs + off;
      mu[i] = p[0] + s * dx; mv[i] = p[1] + s * dy; nu[i] = dx; nv[i] = dy; str[i] = best; ok[i] = 1; why[i] = 0;
      strs.push(best); cnt++;
    }
    // слабые края (меньше трети типичного) — не края, а шум
    if (cnt > 8) {
      strs.sort((a, b) => a - b);
      const thr = strs[strs.length >> 1] * 0.33;
      for (let i = 0; i < N; i++) if (ok[i] && str[i] < thr) { ok[i] = 0; cnt--; rej[5]++; why[i] = 6; }
    }
    return cnt;
  }

  // Поиск края при смазе (только наружные края меток). Смазанный край — не ступенька, а склон шириной со смаз;
  // его середина — положение края на середине выдержки. Берём «горб» производной вокруг максимума (выше 0,3 от
  // максимума) и его центр тяжести. Второй такой же горб в окне — край неоднозначен, точку не берём.
  const dsm = new Float64Array(64);
  function searchBlur(H, R) {
    let cnt = 0;
    const strs = [];
    for (let i = 0; i < N; i++) {
      ok[i] = 0;
      const e = E[i];
      if (!e.outer) continue;
      const p = applyH(H, e.bx, e.by), q = applyH(H, e.bx + e.nx * CELL, e.by + e.ny * CELL);
      let dx = q[0] - p[0], dy = q[1] - p[1];
      const cell = Math.hypot(dx, dy);
      if (!(cell > 1.6)) continue;
      dx /= cell; dy /= cell;
      const r = Math.min(29, R) | 0;
      let bad = false;
      for (let s = -r - 2, k = 0; s <= r + 2; s++, k++) { const v = pix(p[0] + s * dx, p[1] + s * dy); if (v < 0) { bad = true; break; } prof[k] = v; }
      if (bad) continue;
      // производная, сглаженная [1 2 1]/4; индекс k ↔ сдвиг s = k − r
      const n = 2 * r + 1;
      let best = -1e9, bk = 0;
      for (let k = 0; k < n; k++) {
        const j = k + 2;
        const d0 = (prof[j] - prof[j - 2]) * 0.5, dm = (prof[j - 1] - prof[j - 2 < 0 ? 0 : j - 2]) , dp = (prof[j + 1] - prof[j]);
        dsm[k] = 0.5 * d0 + 0.25 * (dm + dp);
        if (dsm[k] > best) { best = dsm[k]; bk = k; }
      }
      if (!(best > 2)) continue;
      const th = 0.3 * best;
      let a = bk, b = bk;
      while (a > 0 && dsm[a - 1] > th) a--;
      while (b < n - 1 && dsm[b + 1] > th) b++;
      if (a === 0 || b === n - 1) continue;                 // горб упирается в край окна — не весь виден
      let second = -1e9;
      for (let k = 0; k < n; k++) if ((k < a - 1 || k > b + 1) && dsm[k] > second) second = dsm[k];
      if (second > 0.6 * best) continue;
      let sw = 0, sx = 0, area = 0;
      for (let k = a; k <= b; k++) { const w = dsm[k] - th; sw += w; sx += w * k; area += dsm[k]; }
      const sPos = sx / sw - r;
      mu[i] = p[0] + sPos * dx; mv[i] = p[1] + sPos * dy; nu[i] = dx; nv[i] = dy; str[i] = area; ok[i] = 1;
      strs.push(area); cnt++;
    }
    if (cnt > 8) {
      strs.sort((x, y) => x - y);
      const thr = strs[strs.length >> 1] * 0.33;
      for (let i = 0; i < N; i++) if (ok[i] && str[i] < thr) { ok[i] = 0; cnt--; }
    }
    return cnt;
  }

  // невязки «точка — прямая края» для гомографии H
  function resid(H, out) {
    for (let i = 0; i < N; i++) {
      if (!ok[i]) continue;
      const e = E[i], z = H[6] * e.bx + H[7] * e.by + H[8];
      out[i] = ((H[0] * e.bx + H[1] * e.by + H[2]) / z - mu[i]) * nu[i] + ((H[3] * e.bx + H[4] * e.by + H[5]) / z - mv[i]) * nv[i];
    }
  }
  // уточнение: устойчивый МНК (веса Тьюки) по 8 элементам гомографии в нормированных координатах кадра.
  // Шаг — по Левенбергу — Марквардту: принимается, только если устойчивая ошибка уменьшилась, иначе шаг короче.
  // (Простой шаг Гаусса — Ньютона под наклоном раскачивался: дальний край листа перескакивал верное положение.)
  const absr = new Float64Array(N), r1 = new Float64Array(N);
  function fit(H0, iters) {
    const c = applyH(H0, 0.5, 0.5), S = 100, cx = c[0], cy = c[1];
    let h = [(H0[0] - cx * H0[6]) / S, (H0[1] - cx * H0[7]) / S, (H0[2] - cx * H0[8]) / S, (H0[3] - cy * H0[6]) / S, (H0[4] - cy * H0[7]) / S, (H0[5] - cy * H0[8]) / S, H0[6], H0[7], H0[8]];
    h = h.map((v) => v / h[8]);
    const toPx = (h) => { const H = [S * h[0] + cx * h[6], S * h[1] + cx * h[7], S * h[2] + cx * h[8], S * h[3] + cy * h[6], S * h[4] + cy * h[7], S * h[5] + cy * h[8], h[6], h[7], h[8]]; return H.map((v) => v / H[8]); };
    const residAll = (h, out) => {
      for (let i = 0; i < N; i++) {
        if (!ok[i]) continue;
        const e = E[i], w = h[6] * e.bx + h[7] * e.by + 1;
        out[i] = (S * (h[0] * e.bx + h[1] * e.by + h[2]) / w + cx - mu[i]) * nu[i] + (S * (h[3] * e.bx + h[4] * e.by + h[5]) / w + cy - mv[i]) * nv[i];
      }
    };
    // масштаб невязок — один раз, от начального положения (MAD)
    residAll(h, res);
    let k = 0;
    for (let i = 0; i < N; i++) if (ok[i]) absr[k++] = Math.abs(res[i]);
    if (k < 8) return null;
    const a0 = absr.subarray(0, k).sort();
    let sigma = Math.max(opt.minSigma, 1.4826 * a0[k >> 1]);
    if (opt.stable && opt.sigSmooth && sigPrev > 0) sigma = Math.max(opt.minSigma, 0.7 * sigPrev + 0.3 * sigma);
    const cT = opt.tukey * sigma, c2 = cT * cT / 6;
    const cost = (r) => { let s = 0; for (let i = 0; i < N; i++) { if (!ok[i]) continue; const q = r[i] / cT; s += Math.abs(q) < 1 ? c2 * (1 - (1 - q * q) ** 3) : c2; } return s; };
    let E0 = cost(res), lam = 1e-3;
    const A = new Float64Array(64), b = new Float64Array(8), j = new Float64Array(8), M = new Float64Array(64), bb = new Float64Array(8);
    const h2 = new Array(9);
    for (let it = 0; it < iters; it++) {
      A.fill(0); b.fill(0);
      let used = 0;
      for (let i = 0; i < N; i++) {
        if (!ok[i]) continue;
        const q = res[i] / cT; if (Math.abs(q) >= 1) continue;
        const wt = (1 - q * q) ** 2 * (opt.stable ? gwt[i] : 1); used++;
        const e = E[i], x = e.bx, y = e.by, w = h[6] * x + h[7] * y + 1;
        const u = (h[0] * x + h[1] * y + h[2]) / w, v = (h[3] * x + h[4] * y + h[5]) / w;
        const aa = S * nu[i] / w, cc = S * nv[i] / w;
        j[0] = aa * x; j[1] = aa * y; j[2] = aa; j[3] = cc * x; j[4] = cc * y; j[5] = cc; j[6] = -(aa * u + cc * v) * x; j[7] = -(aa * u + cc * v) * y;
        const ri = res[i];
        for (let p = 0; p < 8; p++) { const jp = j[p] * wt; b[p] -= jp * ri; for (let qq = 0; qq <= p; qq++) A[p * 8 + qq] += jp * j[qq]; }
      }
      if (used < 8) return null;
      for (let p = 0; p < 8; p++) for (let qq = p + 1; qq < 8; qq++) A[p * 8 + qq] = A[qq * 8 + p];
      let accepted = false, mx = 0;
      for (let tries = 0; tries < 6 && !accepted; tries++) {
        M.set(A); bb.set(b);
        for (let p = 0; p < 8; p++) M[p * 8 + p] = A[p * 8 + p] * (1 + lam) + 1e-9;
        const d = solveSPD(M, bb, 8);
        if (!d) { lam *= 10; continue; }
        for (let p = 0; p < 8; p++) h2[p] = h[p] + d[p];
        h2[8] = 1;
        residAll(h2, r1);
        const E1 = cost(r1);
        if (E1 <= E0) {
          accepted = true;
          // сдвиг углов листа (px) — для остановки
          for (const [x, y] of SHEET) {
            const w0 = h[6] * x + h[7] * y + 1, w1 = h2[6] * x + h2[7] * y + 1;
            const du = (h2[0] * x + h2[1] * y + h2[2]) / w1 - (h[0] * x + h[1] * y + h[2]) / w0;
            const dv = (h2[3] * x + h2[4] * y + h2[5]) / w1 - (h[3] * x + h[4] * y + h[5]) / w0;
            mx = Math.max(mx, S * Math.hypot(du, dv));
          }
          for (let p = 0; p < 9; p++) h[p] = h2[p];
          for (let i = 0; i < N; i++) if (ok[i]) res[i] = r1[i];
          E0 = E1; lam = Math.max(1e-6, lam * 0.3);
        } else lam *= 10;
      }
      if (!accepted || mx < 0.02) break;
    }
    if (opt.stable) sigPrev = sigma;
    const H = toPx(h);
    resid(H, res);
    let used = 0, s2 = 0;
    for (let i = 0; i < N; i++) if (ok[i] && Math.abs(res[i]) < cT) { used++; s2 += res[i] * res[i]; }
    return { H, used, rms: Math.sqrt(s2 / Math.max(1, used)), sigma };
  }

  // проверка: чтение клеток меток по гомографии
  function verify(H) {
    let tagsOk = 0, vis = 0, cs = 0;
    const okTags = [];
    for (let id = 0; id < NTAG; id++) {
      const cr = tagCorners(id);
      let inside = true;
      for (const [x, y] of cr) { const p = applyH(H, x, y); if (pix(p[0], p[1]) < 0) { inside = false; break; } }
      if (!inside) continue;
      vis++;
      const [x0, y0] = cr[0];
      const val = new Float64Array(36);
      let sb = 0, nb = 0, sw = 0, nw = 0;
      for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) {
        const p = applyH(H, x0 + (i + 0.5) * CELL, y0 + (j + 0.5) * CELL);
        const v = pix(p[0], p[1]); val[j * 6 + i] = v;
        if (cellOf(id, i, j)) { sw += v; nw++; } else { sb += v; nb++; }
      }
      // белое снаружи метки (полоса бумаги) — тоже должно быть светлым
      for (const [i, j] of [[-0.6, 2.5], [6.6, 2.5], [2.5, -0.6], [2.5, 6.6]]) {
        const p = applyH(H, x0 + i * CELL, y0 + j * CELL); const v = pix(p[0], p[1]); if (v >= 0) { sw += v; nw++; }
      }
      const mb = sb / nb, mw = sw / nw, thr = (mb + mw) / 2, con = mw - mb;
      let bad = 0;
      for (let k = 0; k < 36; k++) if ((val[k] > thr ? 1 : 0) !== cellOf(id, k % 6, (k / 6) | 0)) bad++;
      if (con > 12 && bad <= 1) { tagsOk++; okTags.push(id); cs += con; }
    }
    return { tagsOk, vis, okTags, contrast: tagsOk ? cs / tagsOk : 0 };
  }

  // Главное: уточнить гомографию H0 на сером участке g (gw×gh, левый верхний угол — ox, oy в кадре).
  // R0 — насколько далеко может быть край от предсказания (px). Возвращает результат или null.
  function refine(g, gw, gh, ox, oy, H0, R0 = 6) {
    G = g; GW = gw; GH = gh; OX = ox; OY = oy;
    st.why = ''; st.passes = 0;
    // размер клетки в пикселях (для выбора полос поиска)
    const c0 = applyH(H0, 0.5, 0.5), c1 = applyH(H0, 0.5 + CELL, 0.5), c2 = applyH(H0, 0.5, 0.5 + CELL);
    const cellPx = Math.sqrt(Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) * Math.hypot(c2[0] - c0[0], c2[1] - c0[1]));
    st.cellPx = cellPx;
    if (!(cellPx > 1.5)) { st.why = 'мелко'; return null; }
    let H = H0, fr = null;
    st.trace = [];
    // 1) только наружные края меток, шире — когда лист мог сильно сдвинуться (R0 большой).
    //    Если ждём его почти там же, сразу все края: по одним наружным наклон дальнего края определяется слабо,
    //    и под наклоном этот проход уводил верное начало на несколько пикселей.
    let cnt = 0;
    if (R0 > opt.outerFirst) {
      const R1 = Math.max(3, Math.min(R0, 1.6 * cellPx + 1)) | 0;
      cnt = search(H, R1, false); st.passes++;
      if (cnt < 12) { st.why = 'краёв ' + cnt; return null; }
      fr = fit(H, 6); if (!fr) { st.why = 'не сошлось'; return null; }
      H = fr.H; st.trace.push({ pass: 'наружн', found: cnt, used: fr.used, c: cornersOf(H) });
    }
    // 2) все края; повторять, пока сходится заметно больше краёв или углы ещё двигаются
    //    (под наклоном первое решение бывает неверным на дальнем краю листа и само выходит к верному за 2–3 повтора)
    let prevUsed = 0, prevDlt = null;
    for (let pass = 0; pass < opt.maxPasses; pass++) {
      cnt = search(H, Math.max(3, Math.round(cellPx)), true); st.passes++;
      if (cnt < 12) break;
      const f2 = fit(H, opt.fitIters); if (!f2) break;
      const a = cornersOf(H), b = cornersOf(f2.H); let mv = 0; for (let k = 0; k < 8; k++) mv = Math.max(mv, Math.abs(a[k] - b[k]));
      fr = f2;
      // полушаг между проходами: под наклоном проходы качались туда-обратно вокруг верного решения
      // (края тонких клеток цепляются за соседние такие же), а среднее двух соседних проходов — почти верное
      // (полушаг — только если сдвиг сменил направление на обратное, то есть проходы действительно качаются)
      const dlt = b.map((v, k) => v - a[k]);
      let dot = 0; if (prevDlt) for (let k = 0; k < 8; k++) dot += dlt[k] * prevDlt[k];
      if (opt.relax < 1 && prevDlt && dot < 0 && mv > 0.15) { const c = a.map((v, k) => v + dlt[k] * opt.relax); H = hFrom4(c) || f2.H; prevDlt = dlt.map((v) => v * opt.relax); }
      else { H = f2.H; prevDlt = dlt; }
      st.trace.push({ pass: 'все', found: cnt, used: f2.used, c: cornersOf(H) });
      if (mv < opt.stopMove && f2.used <= prevUsed * 1.02) break;
      prevUsed = f2.used;
    }
    if (!fr) { st.why = 'краёв ' + cnt; return null; }
    const vr = verify(H);
    Object.assign(st, { n: cnt, used: fr.used, rms: fr.rms, tagsOk: vr.tagsOk, tagsVis: vr.vis, contrast: vr.contrast, rej: Array.from(rej) });
    // меньше половины видимых целиком меток подтвердилось — скорее неверное решение (сдвиг на клетку, перекос),
    // чем правда: на записи 0.5 такие кадры (2–3 из 9 меток, половина краёв) давали скачок наклона на 6–9°
    if (vr.tagsOk < 2 || vr.tagsOk * 2 < vr.vis) { st.why = `коды ${vr.tagsOk}/${vr.vis}`; return null; }
    return { H, used: fr.used, rms: fr.rms, tagsOk: vr.tagsOk, okTags: vr.okTags, tagsVis: vr.vis, cellPx, contrast: vr.contrast };
  }
  // Слежение при смазе: только наружные края меток, окно шире, коды не проверяются (их не прочесть).
  // Вместо кодов — опора: у метки, видной целиком, большинство точек её наружных краёв должно лечь на найденные края.
  function refineBlur(g, gw, gh, ox, oy, H0, R0) {
    G = g; GW = gw; GH = gh; OX = ox; OY = oy;
    st.why = '';
    const c0 = applyH(H0, 0.5, 0.5), c1 = applyH(H0, 0.5 + CELL, 0.5), c2 = applyH(H0, 0.5, 0.5 + CELL);
    const cellPx = Math.sqrt(Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) * Math.hypot(c2[0] - c0[0], c2[1] - c0[1]));
    if (!(cellPx > 2)) { st.why = 'мелко'; return null; }
    const pitch = cellPx * (0.36 / CELL);                // шаг меток в пикселях
    const Rmax = Math.min(28, 0.4 * pitch);               // дальше — можно спутать с соседней меткой
    let H = H0, fr = null;
    for (const R of [Math.min(R0, Rmax), Math.min(0.6 * R0, Rmax, 14)]) {
      const cnt = searchBlur(H, Math.max(4, R));
      if (cnt < 16) { st.why = 'смаз: краёв ' + cnt; return null; }
      const f2 = fit(H, 6); if (!f2) { st.why = 'смаз: не сошлось'; return null; }
      fr = f2; H = f2.H;
    }
    // опора по меткам: точки наружных краёв меток, видных целиком, должны лечь на края
    searchBlur(H, Math.max(4, Math.min(0.6 * R0, Rmax, 14)));
    resid(H, res);
    const cT = Math.max(1.2, opt.tukey * fr.sigma);
    const tot = new Int32Array(NTAG), hit = new Int32Array(NTAG);
    const vis = new Uint8Array(NTAG);
    for (let id = 0; id < NTAG; id++) vis[id] = tagCorners(id).every(([x, y]) => { const p = applyH(H, x, y); return pix(p[0], p[1]) >= 0; }) ? 1 : 0;
    for (let i = 0; i < N; i++) { const e = E[i]; if (!e.outer || !vis[e.tag]) continue; tot[e.tag]++; if (ok[i] && Math.abs(res[i]) < cT) hit[e.tag]++; }
    let sup = 0, nv = 0, T = 0, Hh = 0;
    const okTags = [];
    for (let id = 0; id < NTAG; id++) { if (!vis[id]) continue; nv++; T += tot[id]; Hh += hit[id]; if (hit[id] >= 0.5 * tot[id]) { sup++; okTags.push(id); } }
    st.tagsVis = nv;
    if (sup < 3 || Hh < 0.45 * T) { st.why = `смаз: опора ${sup}/${nv}, ${Math.round(100 * Hh / Math.max(1, T))}%`; return null; }
    return { H, used: fr.used, rms: fr.rms, tagsOk: sup, okTags, tagsVis: nv, cellPx, contrast: 0, blur: true };
  }

  return { refine, refineBlur, st, opt, nEdges: N, debug: { E, why, str, mu, mv, nu, nv, ok } };
}
