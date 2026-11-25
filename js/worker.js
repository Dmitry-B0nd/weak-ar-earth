// Фоновый поток: кадр → серый участок → зрение (слежение / поиск) → поза. Главный поток им не занят.
// Кадр приходит либо картинкой (ImageBitmap, участок кадра), либо кадром камеры (VideoFrame, режим ?cap=vf).
const V = self.location.search;                 // номер сборки — в адресе (?v=…), чтобы не взять старые файлы из кэша
let vision = null, cv = null, ctx = null, gray = null, grayLen = 0;
const ready = import('./vision.js' + V).then((m) => m);
let fmt = '';                                    // как читается кадр: «картинка», NV12, I420, RGBA…

function toGray(rgba, n, out) { for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = (rgba[j] * 77 + rgba[j + 1] * 151 + rgba[j + 2] * 28) >> 8; }
function need(n) { if (grayLen < n) { gray = new Uint8Array(n); grayLen = n; } return gray; }
function canvasGray(src, sx, sy, w, h) {
  if (!cv || cv.width !== w || cv.height !== h) { cv = new OffscreenCanvas(w, h); ctx = cv.getContext('2d', { willReadFrequently: true }); }
  if (sx === null) ctx.drawImage(src, 0, 0); else ctx.drawImage(src, sx, sy, w, h, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data, g = need(w * h); toGray(d, w * h, g); return g;
}
let vfBuf = null;
async function frameGray(frame, r) {
  const f = frame.format;
  if (f === 'NV12' || f === 'I420' || f === 'I420A' || f === 'NV21') {
    const rect = { x: r.x, y: r.y, width: r.w, height: r.h };
    const size = frame.allocationSize({ rect });
    if (!vfBuf || vfBuf.length < size) vfBuf = new Uint8Array(size);
    const layout = await frame.copyTo(vfBuf, { rect });
    const { offset, stride } = layout[0];         // плоскость Y — готовый серый
    const g = need(r.w * r.h);
    if (stride === r.w) g.set(vfBuf.subarray(offset, offset + r.w * r.h));
    else for (let y = 0; y < r.h; y++) g.set(vfBuf.subarray(offset + y * stride, offset + y * stride + r.w), y * r.w);
    fmt = f; return g;
  }
  if (f === 'RGBA' || f === 'RGBX' || f === 'BGRA' || f === 'BGRX') {
    const rect = { x: r.x, y: r.y, width: r.w, height: r.h };
    const size = frame.allocationSize({ rect });
    if (!vfBuf || vfBuf.length < size) vfBuf = new Uint8Array(size);
    const layout = await frame.copyTo(vfBuf, { rect });
    const { offset, stride } = layout[0], g = need(r.w * r.h), bgr = f[0] === 'B';
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const j = offset + y * stride + x * 4;
      g[y * r.w + x] = ((bgr ? vfBuf[j + 2] : vfBuf[j]) * 77 + vfBuf[j + 1] * 151 + (bgr ? vfBuf[j] : vfBuf[j + 2]) * 28) >> 8;
    }
    fmt = f; return g;
  }
  fmt = 'холст(' + f + ')';
  return canvasGray(frame, r.x, r.y, r.w, r.h);
}

self.onmessage = async (ev) => {
  const m = ev.data;
  const mod = await ready;
  if (m.type === 'cfg') { vision = mod.createVision(); vision.setCamera(m.W, m.H, m.f); return; }
  if (m.type !== 'frame' || !vision) { if (m.bmp) m.bmp.close(); if (m.frame) m.frame.close(); return; }
  const t0 = performance.now();
  let g, r = m.roi;
  try {
    if (m.bmp) { g = canvasGray(m.bmp, null, null, r.w, r.h); m.bmp.close(); fmt = 'картинка'; }
    else { g = await frameGray(m.frame, r); m.frame.close(); }
  } catch (e) {
    if (m.bmp) m.bmp.close(); if (m.frame) m.frame.close();
    self.postMessage({ type: 'err', id: m.id, msg: String(e && e.message || e) });
    return;
  }
  const t1 = performance.now();
  const res = vision.process(g, r.w, r.h, r.x, r.y, m.tf);
  const t2 = performance.now();
  // участок для следующего кадра
  res.roiNext = vision.roiFor(m.tf + (m.dt || 50));
  res.type = 'res'; res.id = m.id; res.grabMs = t1 - t0; res.visMs = t2 - t1; res.fmt = fmt; res.roi = r;
  res.tr = { why: res.why, used: res.used, edges: vision.tracker.st.n, rms: vision.tracker.st.rms, vis: vision.tracker.st.tagsVis };
  if (res.pts) res.pts = Array.from(res.pts);
  self.postMessage(res);
};
