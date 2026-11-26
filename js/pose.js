// Поза листа: (1) оценка по одному распознаванию — в фоновом потоке; (2) сглаживание поворота и показ
// кадров между распознаваниями — в главном потоке. Без датчиков, без прогнозов, без переключения режимов.
import { poseFromH, flipPose, refinePose, quatFromR, rFromQuat, slerp, quatAngle, angleBetween, project } from './geom.js?v=0.13';

// ---------- (1) оценка позы по распознаванию ----------
export function createPoseEstimator(o = {}) {
  const opt = {
    fewPts: 12,        // меньше точек (меньше трёх меток) — наклон определяется плохо
    priorW: 20,        // при малом числе точек — мягкая привязка поворота к прежнему (пикс. на радиан ≈ σ 3°)
    recent: 250,       // мс: «прежняя поза» годится как подсказка
    tie: 0.8,          // ошибки двух вариантов наклона «почти равны», если отношение больше этого
    jump: 0.15,        // при малом числе точек: скачок центра листа больше этой доли расстояния — не верим
    ...o,
  };
  let f = 500, cx = 240, cy = 320;
  let prev = null;     // { tf, R, t }
  const st = { alt: 0, rej: 0, err: 0, n: 0 };
  function setCamera(w, h, f0) { cx = (w - 1) / 2; cy = (h - 1) / 2; f = f0; prev = null; }

  // det: { tf, H, pts, n, tags }. Возвращает { R, t, err } или null.
  function estimate(det) {
    const d0 = poseFromH(det.H, f, cx, cy);
    if (!d0 || !(d0.t[2] > 0)) { st.rej++; return null; }
    const pts = det.pts, n = pts ? pts.length / 4 : 0, few = (det.n ?? n) < opt.fewPts;
    const recentPrev = prev && det.tf - prev.tf <= opt.recent && det.tf > prev.tf ? prev : null;
    if (few && !recentPrev && (det.tags || 0) < 2) { st.rej++; return null; }   // одну метку легко спутать с узором
    if (n < 4) { st.rej++; return null; }
    const prior = few && recentPrev ? { R: recentPrev.R, w: opt.priorW } : null;
    const cands = [d0, flipPose(d0.R, d0.t)];
    if (recentPrev) cands.push({ R: recentPrev.R, t: recentPrev.t });
    const out = cands.map((c) => refinePose(c.R, c.t, pts, n, f, cx, cy, prior));
    // лучший по ошибке; почти равные (двусмысленность наклона) — ближний к прежнему
    out.sort((a, b) => a.err - b.err);
    let pick = out[0];
    if (recentPrev) {
      const close = out.filter((c) => c.err * opt.tie <= pick.err + 1e-9);
      if (close.length > 1) pick = close.reduce((a, b) => (angleBetween(a.R, recentPrev.R) <= angleBetween(b.R, recentPrev.R) ? a : b));
    }
    // мало точек и большой скачок от прежней позы — скорее чужая метка или мусор, чем движение
    if (few && recentPrev) {
      const dt = recentPrev.t, jump = Math.hypot(pick.t[0] - dt[0], pick.t[1] - dt[1], pick.t[2] - dt[2]) / Math.hypot(...dt);
      if (jump > opt.jump) { st.rej++; return null; }
    }
    if (angleBetween(pick.R, d0.R) > 0.3) st.alt++;
    st.err = pick.err; st.n++;
    prev = { tf: det.tf, R: pick.R, t: pick.t };
    return { R: pick.R, t: pick.t, err: pick.err };
  }
  return { setCamera, estimate, st, opt, reset() { prev = null; } };
}

// ---------- (2) сглаживание и показ ----------
const alphaF = (fc, dt) => { const r = 2 * Math.PI * fc * dt; return r / (r + 1); };
export function createPoseTrack(o = {}) {
  const opt = {
    minRot: 4, betaRot: 0.2,   // фильтр 1€ только для поворота: Гц, Гц на (°/с)
    // Если переданы углы листа на картинке: срез фильтра = minImg + betaImg × (скорость углов листа, px/с, сглаженная).
    // Покой определяется по картинке (её углы измеряются точнее, чем поворот), и в покое поворот сглаживается сильно.
    minImg: 0, betaImg: 0.05, spdCut: 3,
    dcut: 1.0,
    // Сцена рисуется только по позе этого кадра или между двумя близкими позами. Старую позу не держим:
    // при рывке лист теряется, и удержанная поза стоит на экране, пока картинка уезжает («сцена едет с камерой»).
    hold: 0,                   // мс: сколько можно показывать последнюю позу после неё (без следующей)
    gap: 130,                  // мс: самый длинный промежуток между позами, через который делаем переход
    reset: 300,                // мс без поз — фильтр поворота начинает заново
    // при быстром движении (углы листа между двумя позами сдвинулись больше fastPx) переход — только через короткий
    // промежуток (fastGap мс): путь листа при рывке не прямой, и середина длинного перехода ложится мимо листа
    fastPx: 25, fastGapK: 2.2,      // fastGap = fastGapK × обычный промежуток между позами (≈ кадр камеры)
    ...o,
  };
  const list = [];             // [{ tf, q, t }]
  let flt = null;              // { tf, q, vr, px, vi }
  let dtAvg = 50;              // обычный промежуток между позами, мс
  function add(tf, R, t, px) {
    const q = quatFromR(R);
    if (!flt || tf - flt.tf > opt.reset || tf <= flt.tf) { flt = { tf, q, vr: 0, px, vi: 1e3 }; list.length = 0; }
    else {
      const dt = (tf - flt.tf) / 1000;
      if (dt * 1000 < 1.5 * dtAvg) dtAvg += (dt * 1000 - dtAvg) * 0.05;   // только соседние позы, без пропусков
      else dtAvg *= 1.002;                                               // медленно вверх, если камера стала реже
      const sr = quatAngle(q, flt.q) * 57.2958 / dt;
      flt.vr += (sr - flt.vr) * alphaF(opt.dcut, dt);
      let fc = opt.minRot + opt.betaRot * flt.vr;
      if (opt.minImg > 0 && px && flt.px) {
        let m = 0; for (let i = 0; i < 8; i += 2) m = Math.max(m, Math.hypot(px[i] - flt.px[i], px[i + 1] - flt.px[i + 1]));
        flt.vi += (m / dt - flt.vi) * alphaF(opt.spdCut, dt);
        fc = opt.minImg + opt.betaImg * flt.vi;
      }
      flt.q = slerp(flt.q, q, alphaF(fc, dt));
      flt.tf = tf; flt.px = px;
    }
    list.push({ tf, q: flt.q, t: t.slice(), px });
    if (list.length > 40) list.shift();
  }
  // поза для кадра tf: { R, t } или null (сцену не показывать)
  function poseAt(tf) {
    let a = null, b = null;
    for (let i = list.length - 1; i >= 0; i--) { if (list[i].tf > tf + 0.5) { b = list[i]; continue; } a = list[i]; break; }
    if (a && tf - a.tf <= 0.5) return { R: rFromQuat(a.q), t: a.t };          // поза этого самого кадра
    let fast = false;
    if (a && b && a.px && b.px) { let m = 0; for (let i = 0; i < 8; i += 2) m = Math.max(m, Math.hypot(b.px[i] - a.px[i], b.px[i + 1] - a.px[i + 1])); fast = m > opt.fastPx; }
    if (a && b && b.tf - a.tf <= (fast ? Math.min(opt.gap, opt.fastGapK * dtAvg) : opt.gap)) {
      const w = (tf - a.tf) / Math.max(1, b.tf - a.tf);
      return { R: rFromQuat(slerp(a.q, b.q, w)), t: [0, 1, 2].map((i) => a.t[i] + (b.t[i] - a.t[i]) * w) };
    }
    if (a && !b && tf - a.tf <= opt.hold) return { R: rFromQuat(a.q), t: a.t };
    return null;
  }
  const covered = (tf) => list.length > 0 && list[list.length - 1].tf >= tf - 0.5;
  return { add, poseAt, covered, opt, reset() { list.length = 0; flt = null; }, get last() { return list[list.length - 1] || null; } };
}

export { project };
