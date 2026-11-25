// Зрение (работает в фоновом потоке; без DOM — проверяется и в Node):
//   слежение — края меток около предсказанного положения листа, полное разрешение;
//   поиск (только когда лист потерян) — js-aruco2 на уменьшенной вдвое картинке, затем то же уточнение краями.
// На выходе — гомография «лист → пиксели кадра», углы подтверждённых меток и поза листа.
import { AR, CV } from '../vendor/aruco.mjs?v=0.8';
import { createTracker, hFrom4, cornersOf } from './track.js?v=0.8';
import { createPoseEstimator } from './pose.js?v=0.8';
import { createCoarse } from './coarse.js?v=0.8';
import { tagCorners } from './board.js?v=0.8';
import { applyH, fitH } from './geom.js?v=0.8';

const now = () => performance.now();

export function createVision(o = {}) {
  const opt = { predict: 0.8, acqScale: 2, blurMax: 8, minScore: 0.5, oneHeavy: false, ...o };
  const T = createTracker({ stable: !!o.stableEdges });
  const C = createCoarse();
  const P = createPoseEstimator();
  const det = new AR.Detector({ dictionaryName: 'APRILTAG_16h5', maxHammingDistance: 1 });
  let W = 0, Hh = 0, f = 0;
  const hist = [];                 // [{ tf, c: углы листа (8 чисел) }]
  const st = { mode: '', track: 0, acq: 0, lost: 0, why: '' };
  let half = null, halfImg = null, halfW = 0, halfH = 0;

  function setCamera(w, h, f0) { W = w; Hh = h; f = f0; P.setCamera(w, h, f0); hist.length = 0; }

  // где ждать лист на кадре tf (углы листа) — по двум последним результатам
  function predict(tf) {
    if (!hist.length) return null;
    const b = hist[hist.length - 1];
    if (tf - b.tf > 250) return null;
    if (hist.length < 2) return { c: b.c.slice(), move: 0 };
    const a = hist[hist.length - 2], dt = b.tf - a.tf;
    if (dt <= 0 || dt > 200) return { c: b.c.slice(), move: 0 };
    const k = opt.predict * (tf - b.tf) / dt;
    const c = b.c.map((v, i) => v + (v - a.c[i]) * k);
    let move = 0; for (let i = 0; i < 8; i += 2) move = Math.max(move, Math.hypot(c[i] - b.c[i], c[i + 1] - b.c[i + 1]));
    return { c, move };
  }
  // участок кадра для следующего захвата (x, y, w, h) или null — весь кадр
  let failed = false, blurRun = 0;                   // на прошлом кадре лист не найден → следующий кадр смотрим целиком
  function roiFor(tf, margin = 0.35) {
    if (failed) return null;
    const p = predict(tf); if (!p) return null;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < 8; i += 2) { x0 = Math.min(x0, p.c[i]); x1 = Math.max(x1, p.c[i]); y0 = Math.min(y0, p.c[i + 1]); y1 = Math.max(y1, p.c[i + 1]); }
    const m = margin * Math.max(x1 - x0, y1 - y0) + 16 + p.move;
    x0 = Math.max(0, Math.floor(x0 - m)) & ~1; y0 = Math.max(0, Math.floor(y0 - m)) & ~1;
    x1 = Math.min(W, Math.ceil(x1 + m)); y1 = Math.min(Hh, Math.ceil(y1 + m));
    if (x1 - x0 < 32 || y1 - y0 < 32) return null;
    return { x: x0, y: y0, w: (x1 - x0) & ~1, h: (y1 - y0) & ~1 };
  }

  // поиск меток js-aruco2 на уменьшенной вдвое картинке → гомография по согласным меткам
  function acquire(g, gw, gh, ox, oy) {
    const s = opt.acqScale, w = (gw / s) | 0, h = (gh / s) | 0;
    if (w !== halfW || h !== halfH) { halfW = w; halfH = h; half = new Uint8ClampedArray(w * h); halfImg = new CV.Image(w, h, half); }
    for (let y = 0; y < h; y++) {
      const r0 = y * s * gw;
      for (let x = 0; x < w; x++) { let a = 0; for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) a += g[r0 + j * gw + x * s + i]; half[y * w + x] = a / (s * s); }
    }
    det.grey = halfImg;
    CV.adaptiveThreshold(halfImg, det.thres, 2, 7);
    det.contours = CV.findContours(det.thres, det.binary);
    let cand = det.findCandidates(det.contours, w * 0.01, 0.05, 6);
    cand = det.clockwiseCorners(cand); cand = det.notTooNear(cand, 6);
    const ms = det.findMarkers(halfImg, cand, 36);
    const tags = [], seen = new Set();
    for (const m of ms) {
      if (m.id < 0 || m.id > 8 || seen.has(m.id)) continue;
      seen.add(m.id);
      tags.push({ id: m.id, px: m.corners.map((c) => [ox + (c.x + 0.5) * s - 0.5, oy + (c.y + 0.5) * s - 0.5]) });
    }
    if (!tags.length) return null;
    // гипотеза по каждой метке; лучшая — с которой согласны остальные
    let best = null;
    for (const tg of tags) {
      const src = [], dst = [];
      tagCorners(tg.id).forEach((b, i) => { src.push(...b); dst.push(...tg.px[i]); });
      const Hc = fitH(src, dst, 4); if (!Hc) continue;
      const side = Math.hypot(tg.px[1][0] - tg.px[0][0], tg.px[1][1] - tg.px[0][1]);
      const inl = tags.filter((o) => tagCorners(o.id).every((b, i) => { const p = applyH(Hc, b[0], b[1]); return Math.hypot(p[0] - o.px[i][0], p[1] - o.px[i][1]) < 0.35 * side + 2; }));
      if (!best || inl.length > best.inl.length) best = { inl };
    }
    if (!best) return null;
    const src = [], dst = [];
    for (const o of best.inl) tagCorners(o.id).forEach((b, i) => { src.push(...b); dst.push(...o.px[i]); });
    const H = fitH(src, dst, src.length / 2);
    return H ? { H, tags: best.inl.length, found: tags.length } : null;
  }

  // Обработать кадр: серый участок g (gw×gh) с левым верхним углом (ox, oy) в кадре W×H, время съёмки tf.
  function process(g, gw, gh, ox, oy, tf) {
    const t0 = now();
    let r = null, mode = '', acqMs = 0, why = '', coarseMs = 0;
    const p = predict(tf);
    if (p) {
      const Hp = hFrom4(p.c);
      if (Hp) r = T.refine(g, gw, gh, ox, oy, Hp, Math.min(14, 4 + p.move * 0.5));
      if (r) mode = 'след'; else why = 'след: ' + T.st.why;
    }
    // Рывок или смаз: лист был только что, но края у прогноза не нашлись. Грубо ищем сдвиг листа целиком на
    // уменьшенной картинке, затем уточняем краями: сначала обычно (с кодами), затем без кодов — по наружным краям.
    // Без кодов — не дольше blurMax кадров подряд и только если кадр похож на лист (корреляция ≥ minScore).
    let cs = null;
    if (!r && p && hist.length && tf - hist[hist.length - 1].tf <= 160) {
      const tc = now();
      C.prepare(g, gw, gh, ox, oy);
      const Hp = hFrom4(p.c);
      const c = Hp && C.find(Hp, Math.min(112, 32 + 2 * p.move));
      coarseMs = now() - tc;
      if (c && c.score >= opt.minScore) {
        cs = c.score;
        const H2 = Hp.slice(); for (let k = 0; k < 3; k++) { H2[k] += c.dx * Hp[6 + k]; H2[3 + k] += c.dy * Hp[6 + k]; }
        r = T.refine(g, gw, gh, ox, oy, H2, 8);
        if (r) mode = 'след';
        else if (blurRun < opt.blurMax) {
          r = T.refineBlur(g, gw, gh, ox, oy, H2, 10);
          if (r) {
            const sc = C.score(r.H);
            if (sc < opt.minScore || r.tagsOk < Math.max(3, r.tagsVis - 1)) { why += `; смаз: опора ${r.tagsOk}/${r.tagsVis}, сходство ${sc.toFixed(2)}`; r = null; }
            else { mode = 'смаз'; cs = sc; }
          } else why += '; ' + T.st.why;
        }
      } else why += `; грубо: ${c ? 'сходство ' + c.score.toFixed(2) : 'нет'}`;
    }
    // Поиск меток с нуля — только если в этом кадре не было грубого поиска: иначе один кадр стоил 50–120 мс
    // (при 30 к/с это пропуск кадров и заметный фриз показа). Тогда поиск — на следующем кадре, по всему кадру.
    if (!r && coarseMs > 0 && opt.oneHeavy) { failed = true; }
    else if (!r) {
      const ta = now();
      const a = acquire(g, gw, gh, ox, oy);
      if (a && a.tags >= 1) {
        r = T.refine(g, gw, gh, ox, oy, a.H, 4);
        if (r) mode = 'поиск'; else why += (why ? '; ' : '') + 'поиск: ' + T.st.why;
      } else why += (why ? '; ' : '') + 'поиск: меток ' + (a ? a.found : 0);
      acqMs = now() - ta;
    }
    const t1 = now();
    const out = { tf, mode: mode || 'нет', why, ms: { all: 0, acq: acqMs, pose: 0, coarse: coarseMs }, n: 0, tags: 0, H: null, pts: null, err: 0, cellPx: T.st.cellPx, used: 0 };
    failed = !r;
    if (!r) blurRun = 0;
    if (!r) { st.lost++; out.ms.all = t1 - t0; if (hist.length && tf - hist[hist.length - 1].tf > 250) hist.length = 0; return out; }
    if (mode === 'след') st.track++; else st.acq++;
    blurRun = mode === 'смаз' ? blurRun + 1 : 0;
    const pts = new Float64Array(r.okTags.length * 16);
    let k = 0;
    for (const id of r.okTags) for (const [bx, by] of tagCorners(id)) { const q = applyH(r.H, bx, by); pts[k++] = bx; pts[k++] = by; pts[k++] = q[0]; pts[k++] = q[1]; }
    Object.assign(out, { H: r.H, pts, n: r.okTags.length * 4, tags: r.tagsOk, err: r.rms, used: r.used, cellPx: r.cellPx, contrast: r.contrast });
    const pose = P.estimate(out);
    const t2 = now();
    out.ms.pose = t2 - t1; out.ms.all = t2 - t0;
    if (pose) { out.R = pose.R; out.t = pose.t; out.poseErr = pose.err; }
    hist.push({ tf, c: cornersOf(r.H) }); if (hist.length > 3) hist.shift();
    return out;
  }
  return { setCamera, process, roiFor, predict, st, tracker: T, poseEst: P };
}
