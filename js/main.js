// Лаборатория браузерного AR для слабых телефонов: главный поток.
// Камера → кадр в текстуру (для показа) и в фоновый поток (для зрения) → поза → показ кадра, для которого поза уже есть.
import { BUILD } from './build.js?v=0.5';
import { createRenderer } from './render.js?v=0.5';
import { createPoseTrack } from './pose.js?v=0.5';

const Q = new URLSearchParams(location.search);
// как отдавать кадр в поток: кадром камеры (MediaStreamTrackProcessor — Chrome на Android) или картинкой (остальные).
// Выбирается один раз при запуске; ?cap=bitmap / ?cap=vf — принудительно.
let CAP = Q.get('cap') || ('MediaStreamTrackProcessor' in window ? 'vf' : 'bitmap');
const CAMW = +Q.get('w') || 640, CAMH = +Q.get('h') || 480, CAMFPS = +Q.get('fps') || 30;
const FOV = +Q.get('fov') || 66;                          // угол обзора по длинной стороне (не измерен — принят)
const MAXDELAY = 160;                                     // мс: дольше кадр не ждёт своей позы
// Опыт (выбирается один раз адресом): ?edge=stable — устойчивый набор краёв (не помог, оставлен для сравнения).
const VOPT = { stableEdges: Q.get('edge') === 'stable' };
// Короткая выдержка (8 мс): если камера разрешает ручную выдержку — по умолчанию (меньше смаз при рывках, выше частота
// кадров). ?exp=0 — оставить автоматику камеры; ?exp=N — своя выдержка, N в единицах 100 мкс.
const EXPQ = Q.get('exp');
let EXP = EXPQ === null ? 80 : +EXPQ || 0;
let camReady = true;                                        // пока выдержка ставится — картинку не показываем

const $ = (id) => document.getElementById(id);
const panel = $('panel'), canvas = $('gl'), video = $('video');
const log = (...a) => { console.log(...a); LOGS.push(a.join(' ')); if (LOGS.length > 60) LOGS.shift(); };
const LOGS = [];

let R = null, worker = null, stream = null, track = null;
let vw = 0, vh = 0, f0 = 0;
const T = createPoseTrack();
const REC = { frames: [], det: [], show: [] }; const RECMAX = 40000;
const S = {                                               // счётчики для панели
  frames: 0, raf: 0, res: 0, track: 0, blur: 0, acq: 0, none: 0, coarseMs: 0, visMs: 0, grabMs: 0, acqMs: 0, poseMs: 0, mainGrab: 0, sent: 0,
  shown: 0, hidden: 0, delay: 0, draws: 0, lastRes: null, fmt: '', roi: '', camDt: [], maxGap: 0, lastShowT: 0, errs: 0,
};
let busy = false, busySince = 0, frameId = 0, roiNext = null, lastTf = 0, camDtAvg = 50;
const sent = new Map();

// ---------- камера ----------
async function openCamera() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: CAMW }, height: { ideal: CAMH }, frameRate: { ideal: CAMFPS } } });
  track = stream.getVideoTracks()[0];
  video.srcObject = stream; video.muted = true; video.playsInline = true;
  await video.play().catch(() => {});
  const t0 = performance.now();
  while (!video.videoWidth && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 30));
  setSize(video.videoWidth, video.videoHeight);
  // что умеет камера (выдержка, фокус, частота) — в журнал записи
  try {
    const c = track.getCapabilities ? track.getCapabilities() : {};
    const pick = (k) => (c[k] === undefined ? '' : `${k} ${JSON.stringify(c[k])}`);
    CAPS = c;
    log('камера умеет:', ['exposureMode', 'exposureTime', 'exposureCompensation', 'iso', 'focusMode', 'frameRate', 'torch'].map(pick).filter(Boolean).join('; ') || 'ничего не сообщает');
  } catch (e) { log('getCapabilities:', e.message); }
  const canExp = CAPS && CAPS.exposureTime && Array.isArray(CAPS.exposureMode) && CAPS.exposureMode.includes('manual');
  if (EXP && !canExp) { log('ручной выдержки камера не даёт — оставляю автоматику'); EXP = 0; }
  if (EXP) { camReady = false; setExposure(EXP).finally(() => setTimeout(() => { camReady = true; }, 250)); }   // в фоне: кадры уже идут
}
// Ручная выдержка (опыт ?exp=N, N в единицах 100 мкс: 80 = 8 мс). Чтобы картинка не потемнела, светочувствительность
// поднимается во столько же раз, во сколько укоротилась выдержка (в пределах того, что разрешает камера).
async function setExposure(E) {
  try {
    await new Promise((r) => setTimeout(r, 1200));          // дать автоматике выставить свет (картинка пока скрыта)
    const c = track.getCapabilities ? track.getCapabilities() : {}, st0 = track.getSettings();
    const e0 = st0.exposureTime, i0 = st0.iso;
    const adv = { exposureMode: 'manual', exposureTime: E };
    if (c.iso && e0 && i0) adv.iso = Math.round(Math.min(c.iso.max, Math.max(c.iso.min, i0 * e0 / E)));
    await track.applyConstraints({ advanced: [adv] });
    if (CAMFPS > 20) await track.applyConstraints({ frameRate: { ideal: CAMFPS } }).catch(() => {});
    const st = track.getSettings();
    log('выдержка: была', e0, 'iso', i0, '→ просили', E, 'iso', adv.iso, '→ стоит', st.exposureMode, st.exposureTime, 'iso', st.iso, 'к/с', st.frameRate);
  } catch (e) { log('выдержку задать не вышло:', e.message); }
}
let CAPS = null;
function setSize(w, h) {
  if (!w || !h || (w === vw && h === vh)) return;
  vw = w; vh = h; f0 = (Math.max(w, h) / 2) / Math.tan(FOV * Math.PI / 360);
  T.reset(); roiNext = null;
  worker.postMessage({ type: 'cfg', W: w, H: h, f: f0, opt: VOPT });
  log('кадр', w + '×' + h, 'фокус', f0.toFixed(0), 'px');
}

// ---------- кадры: режим «картинка» (video + requestVideoFrameCallback) ----------
function onVideoFrame(now, md) {
  const pn = performance.now();
  const okT = (v) => typeof v === 'number' && v > pn - 500 && v <= pn + 2;
  const tf = md && okT(md.captureTime) ? md.captureTime : md && okT(md.presentationTime) ? md.presentationTime : now;
  if (video.videoWidth !== vw || video.videoHeight !== vh) setSize(video.videoWidth, video.videoHeight);
  newFrame(tf, pn, video, vw, vh);
  video.requestVideoFrameCallback(onVideoFrame);
}
// ---------- кадры: режим «кадр камеры» (MediaStreamTrackProcessor, ?cap=vf) ----------
async function readFrames() {
  const proc = new MediaStreamTrackProcessor({ track, maxBufferSize: 2 });
  const reader = proc.readable.getReader();
  let first = true;
  for (;;) {
    const { value: fr, done } = await reader.read();
    if (done) break;
    const pn = performance.now();
    const w = fr.displayWidth, h = fr.displayHeight;
    if (first) {
      first = false;
      // кадр камеры должен совпадать по ориентации с видео; иначе (повёрнут) — один раз переходим на картинку
      const rot = fr.rotation || 0, vidPortrait = video.videoHeight > video.videoWidth, frPortrait = h > w;
      log('кадр камеры', fr.format, fr.codedWidth + '×' + fr.codedHeight, 'показ', w + '×' + h, 'поворот', rot);
      if (rot !== 0 || (video.videoWidth && vidPortrait !== frPortrait)) {
        log('кадр камеры повёрнут относительно видео — беру картинку'); fr.close(); reader.cancel(); startBitmap(); return;
      }
      video.pause();                                  // видео-элемент для показа не нужен: кадры рисуются сами
    }
    if (w !== vw || h !== vh) setSize(w, h);
    newFrame(fr.timestamp / 1000, pn, fr, w, h);
    fr.close();
  }
}

function startBitmap() {
  CAP = 'bitmap';
  video.play().catch(() => {});
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) video.requestVideoFrameCallback(onVideoFrame);
  else { log('requestVideoFrameCallback нет — кадры по таймеру'); let lt = -1; setInterval(() => { if (video.currentTime !== lt) { lt = video.currentTime; newFrame(performance.now(), performance.now(), video, vw, vh); } }, 15); }
}

function newFrame(tf, ta, src, w, h) {
  if (tf <= lastTf) tf = lastTf + 0.1;
  if (lastTf) { const d = tf - lastTf; camDtAvg += (Math.min(d, 300) - camDtAvg) * 0.1; S.camDt.push(d); if (S.camDt.length > 60) S.camDt.shift(); }
  lastTf = tf;
  S.frames++;
  if (REC.frames.length < RECMAX) REC.frames.push([+tf.toFixed(1), Math.round(ta)]);
  R.upload(src, w, h, tf, ta);
  if (busy && performance.now() - busySince > 2000) busy = false;   // поток завис — не ждём вечно
  if (busy || !vw) return;
  // участок для зрения: где ждём лист (подсказка потока) или весь кадр
  const r = roiNext && roiNext.x + roiNext.w <= w && roiNext.y + roiNext.h <= h ? roiNext : { x: 0, y: 0, w, h };
  const id = ++frameId, t0 = performance.now();
  const msg = { type: 'frame', id, tf, roi: r, dt: camDtAvg };
  busy = true; busySince = t0;
  sent.set(id, { ta, t0 });
  if (CAP === 'vf') {
    const c = src.clone(); msg.frame = c;
    worker.postMessage(msg, [c]);
    S.mainGrab += performance.now() - t0; S.sent++;
  } else {
    createImageBitmap(src, r.x, r.y, r.w, r.h).then((bmp) => { msg.bmp = bmp; worker.postMessage(msg, [bmp]); })
      .catch((e) => { busy = false; S.errs++; log('картинка кадра не получилась:', e.message); });
    S.mainGrab += performance.now() - t0; S.sent++;
  }
}

function onResult(m) {
  busy = false;
  if (m.type === 'err') { S.errs++; log('поток:', m.msg); return; }
  const now = performance.now(), s = sent.get(m.id); sent.delete(m.id);
  S.res++; S.visMs += m.visMs; S.grabMs += m.grabMs; S.acqMs += m.ms.acq; S.poseMs += m.ms.pose; S.fmt = m.fmt;
  S.roi = m.roi.w + '×' + m.roi.h;
  if (m.mode === 'след') S.track++; else if (m.mode === 'смаз') S.blur++; else if (m.mode === 'поиск') S.acq++; else S.none++;
  S.coarseMs += m.ms.coarse || 0;
  S.lastRes = m; roiNext = m.roiNext;
  if (REC.det.length < RECMAX) REC.det.push({
    tf: +m.tf.toFixed(1), t: Math.round(now), n: m.n, tags: m.tags, err: +(m.err || 0).toFixed(3), mode: m.mode,
    H: m.H ? m.H.map((v) => +v.toPrecision(7)) : null, pts: m.pts ? m.pts.map((v) => +v.toFixed(2)) : null,
    ms: { grab: +m.grabMs.toFixed(1), vis: +m.visMs.toFixed(1), acq: +m.ms.acq.toFixed(1), coarse: +(m.ms.coarse || 0).toFixed(1), q: s ? +(now - s.t0).toFixed(1) : 0 },
    roi: [m.roi.x, m.roi.y, m.roi.w, m.roi.h], cell: +(m.cellPx || 0).toFixed(2), used: m.used, found: m.tr && m.tr.edges, rej: m.tr && m.tr.rej, why: m.why || undefined,
  });
  if (m.R) T.add(m.tf, m.R, m.t);
}

// ---------- показ ----------
// Кадр показывается с постоянной задержкой D — столько, сколько обычно ждать его позы (поза кадра есть, когда
// пришёл результат зрения по нему или по более позднему кадру). Так видео идёт ровно, без пропусков кадров,
// а сцена приклеена к картинке. D подстраивается по последним кадрам и не больше MAXDELAY.
let shown = null, visible = false, D = 60;
function loop(now) {
  requestAnimationFrame(loop);
  S.raf++;
  for (const r of R.ring) if (r.n >= 0 && !r.cov && T.covered(r.tf)) {
    r.cov = now; const L = Math.min(MAXDELAY, now - r.ta + 6);
    D += (L - D) * (L > D ? 0.3 : 0.03);
  }
  // по порядку: самый старый ещё не показанный кадр старше D; если отстали больше чем на кадр — сразу к свежему готовому
  const ready = (r) => r.cov || now - r.ta >= MAXDELAY;
  let oldest = null, newestReady = null;
  for (const r of R.ring) {
    if (r.n < 0 || (shown && r.n <= shown.n) || now - r.ta < D) continue;
    if (!oldest || r.n < oldest.n) oldest = r;
    if (ready(r) && (!newestReady || r.n > newestReady.n)) newestReady = r;
  }
  if (!oldest) return;
  let pick = ready(oldest) ? oldest : null;
  if (newestReady && now - newestReady.ta > D + camDtAvg) pick = newestReady;
  if (!pick) return;                                             // поза ещё не готова — подождать
  if (shown) { const g = now - S.lastShowT; if (g > S.maxGap) S.maxGap = g; }
  S.lastShowT = now;
  shown = pick;
  const pose = T.poseAt(pick.tf);
  visible = !!pose;
  if (pose) S.shown++; else S.hidden++;
  S.delay += now - pick.ta; S.draws++;
  R.draw(pick, camReady ? pose : null, f0, !camReady);
  if (REC.show.length < RECMAX) REC.show.push([Math.round(now), +pick.tf.toFixed(1), pose ? 1 : 0]);
}

// ---------- панель ----------
let secT = performance.now();
const P0 = { ...S };
function panelTick() {
  const now = performance.now(), dt = (now - secT) / 1000; secT = now;
  const d = (k) => S[k] - (P0[k] || 0);
  const res = d('res') || 1, draws = d('draws') || 1;
  const dts = S.camDt.slice().sort((a, b) => a - b), med = dts.length ? dts[dts.length >> 1] : 0;
  const m = S.lastRes || {}, tr = m.tr || {};
  const sheetPx = m.H ? Math.hypot(...[0, 1].map((k) => { const h = m.H; const p = (x, y) => [(h[0] * x + h[1] * y + h[2]) / (h[6] * x + h[7] * y + h[8]), (h[3] * x + h[4] * y + h[5]) / (h[6] * x + h[7] * y + h[8])]; return p(1, 0.5)[k] - p(0, 0.5)[k]; })) : 0;
  const L = T.last, dist = L ? Math.hypot(...L.t) : 0;
  const set = track && track.getSettings ? track.getSettings() : {};
  panel.textContent = (camReady ? '' : 'настраиваю камеру…\n') +
    `сборка ${BUILD} · захват ${CAP === 'vf' ? 'кадр камеры' : 'картинка'} (${S.fmt || '…'})${VOPT.stableEdges ? ' · края: устойч.' : ''}${EXP ? ' · выдержка ' + ((track && track.getSettings && track.getSettings().exposureMode === 'manual') ? (track.getSettings().exposureTime / 10).toFixed(1) + ' мс, iso ' + track.getSettings().iso : 'не задана') : ''}\n` +
    `камера ${vw}×${vh}, заказ ${CAMFPS} к/с (${set.frameRate ? set.frameRate.toFixed(0) : '?'}), факт ${(d('frames') / dt).toFixed(1)} к/с, интервал ${med.toFixed(0)} мс\n` +
    `зрение ${(d('res') / dt).toFixed(1)}/с: след ${d('track')} смаз ${d('blur')} поиск ${d('acq')} нет ${d('none')} · участок ${S.roi}\n` +
    `  поток ${(d('visMs') / res).toFixed(1)} мс (захват ${(d('grabMs') / res).toFixed(1)}, грубо ${(d('coarseMs') / res).toFixed(1)}, поиск ${(d('acqMs') / res).toFixed(1)}, поза ${(d('poseMs') / res).toFixed(1)}), главный ${(d('mainGrab') / Math.max(1, d('sent'))).toFixed(1)} мс\n` +
    `метки ${m.tags || 0}/${tr.vis || 0} · лист ${sheetPx.toFixed(0)} px, клетка ${(m.cellPx || 0).toFixed(1)} px · края ${tr.used || 0}/${tr.edges || 0}, ошибка ${(m.err || 0).toFixed(2)} px\n` +
    `показ ${(draws / dt).toFixed(1)} к/с (rAF ${(d('raf') / dt).toFixed(0)}), задержка ${(d('delay') / draws).toFixed(0)} мс, сцена ${(100 * d('shown') / draws).toFixed(0)}%, пауза max ${S.maxGap.toFixed(0)} мс\n` +
    `расстояние ${dist.toFixed(1)} листа · запись ${REC.det.length} · ошибок ${S.errs}` + (m.why ? `\n${m.why}` : '');
  Object.assign(P0, S); S.maxGap = 0;
}

// ---------- запись ----------
function recordJSON() {
  const set = track && track.getSettings ? track.getSettings() : {};
  return JSON.stringify({ build: BUILD, engine: 'lab', cap: CAP, fmt: S.fmt, opt: { ...VOPT, exp: EXP }, caps: CAPS, camNow: track && track.getSettings ? track.getSettings() : null, ua: navigator.userAgent, at: new Date().toISOString(),
    cam: [vw, vh], f: f0, fov: FOV, camSettings: { w: set.width, h: set.height, fps: set.frameRate, req: [CAMW, CAMH, CAMFPS] },
    screen: [innerWidth, innerHeight, devicePixelRatio], cores: navigator.hardwareConcurrency, mem: navigator.deviceMemory, logs: LOGS,
    raw: { frames: REC.frames, det: REC.det, show: REC.show, o: [], m: [] } });
}
async function shareFile(name, blob, type) {
  const file = new File([blob], name, { type });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}
async function saveRecord() {
  const name = `lab-${BUILD}-${new Date().toISOString().slice(5, 19).replace(/[:T]/g, '-')}.json`;
  await shareFile(name, new Blob([recordJSON()], { type: 'application/json' }), 'application/json');
}
function clearRecord() { REC.frames.length = 0; REC.det.length = 0; REC.show.length = 0; log('запись очищена'); }
// видео с камеры (для разбора кадров у себя): 10 с
async function recordVideo(btn) {
  if (!window.MediaRecorder) { log('MediaRecorder недоступен'); return; }
  const types = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
  const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(new MediaStream([track]), { mimeType: mime, videoBitsPerSecond: 6e6 });
  const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const startT = performance.now(), mark = REC.frames.length;
  rec.start();
  btn.disabled = true; let left = 10;
  const iv = setInterval(() => { btn.textContent = `Видео… ${--left}`; }, 1000);
  await new Promise((r) => setTimeout(r, 10000));
  await new Promise((r) => { rec.onstop = r; rec.stop(); });
  clearInterval(iv); btn.disabled = false; btn.textContent = 'Видео 10 с';
  log('видео', mime, 'начато', startT.toFixed(0), 'кадр записи', mark);
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  await shareFile(`lab-${BUILD}-video.${ext}`, new Blob(chunks, { type: mime || 'video/webm' }), mime || 'video/webm');
}

// ---------- запуск ----------
async function start() {
  $('start').style.display = 'none';
  try {
    R = createRenderer(canvas, { maxDpr: +Q.get('dpr') || 1 });
    worker = new Worker(`js/worker.js?v=${BUILD}`, { type: 'module' });
    worker.onmessage = (e) => onResult(e.data);
    worker.onerror = (e) => { S.errs++; log('ошибка потока:', e.message || e); };
    await openCamera();
    if (CAP === 'vf' && !('MediaStreamTrackProcessor' in window)) { log('MediaStreamTrackProcessor нет — беру картинку'); CAP = 'bitmap'; }
    if (CAP === 'vf') { readFrames().catch((e) => { S.errs++; log('чтение кадров:', e.message); }); }
    else startBitmap();
    requestAnimationFrame(loop);
    setInterval(panelTick, 1000);
    try { await navigator.wakeLock?.request('screen'); } catch (e) { /* не страшно */ }
  } catch (e) {
    panel.textContent = `сборка ${BUILD}\nОшибка запуска: ${e.message}\n` + LOGS.join('\n');
    $('start').style.display = '';
  }
}
$('start').onclick = start;
$('save').onclick = saveRecord;
$('clear').onclick = clearRecord;
$('vid').onclick = () => recordVideo($('vid'));
$('hide').onclick = () => { panel.classList.toggle('off'); };
panel.textContent = `сборка ${BUILD}\nНажмите «Старт» и наведите камеру на лист с метками.`;
