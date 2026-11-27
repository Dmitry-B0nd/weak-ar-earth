// Рисование на WebGL 1 без библиотек: кадр камеры во весь экран (с обрезкой как object-fit: cover)
// и сцена на листе: «Земля» (сфера с сеткой параллелей и меридианов) и рамка по краю листа.
// Оси листа: x вправо, y вниз, z в лист; Земля — радиус 0,45, центр на 0,55 над центром листа.

const VS_BG = `attribute vec2 p; uniform vec4 uv; varying vec2 t;
void main(){ t = uv.xy + (p * 0.5 + 0.5) * uv.zw; t.y = 1.0 - t.y; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS_BG = `precision mediump float; varying vec2 t; uniform sampler2D tex; void main(){ gl_FragColor = texture2D(tex, t); }`;
const VS_M = `attribute vec3 p; attribute vec3 n; uniform mat4 P; uniform mat4 M; varying vec3 vn; varying vec3 on;
${RS_GLSL}
void main(){ vn = mat3(M) * n; on = n; gl_Position = rsW(P * M * vec4(p, 1.0)); }`;
const FS_M = `precision mediump float; varying vec3 vn; varying vec3 on; uniform vec4 col; uniform float grid;
void main(){
  vec3 N = normalize(vn);
  float l = 0.35 + 0.65 * max(0.0, dot(N, normalize(vec3(-0.3, -0.6, -1.0))));
  vec3 c = col.rgb;
  if (grid > 0.5) {
    vec3 o = normalize(on);
    float lat = asin(clamp(-o.z, -1.0, 1.0)), lon = atan(o.y, o.x);
    float a = abs(fract(lat / 0.5236 + 0.5) - 0.5), b = abs(fract(lon / 0.5236 + 0.5) - 0.5);
    float w = 0.06;
    if (a < w || b < w * max(0.2, cos(lat))) c = vec3(0.95, 0.95, 0.85);
    if (o.z < -0.55) c = mix(c, vec3(1.0), 0.6);
  }
  gl_FragColor = vec4(c * l, col.a);
}`;

// Земля с текстурами: день (Blue Marble), ночные огни, облака и маска воды (упакованы в одну текстуру), солнце,
// блик на воде, атмосфера по краю. Координаты вершины — единичная сфера Земли (z — к северу), uv — карта.
const VS_E = `attribute vec3 p; attribute vec2 uv; uniform mat4 P; uniform mat4 MV; varying highp vec2 vuv; varying vec3 vn; varying vec3 vp;
${RS_GLSL}
void main(){ vuv = uv; vec4 q = MV * vec4(p, 1.0); vp = q.xyz; vn = mat3(MV) * p; gl_Position = rsW(P * q); }`;
// Координаты карты — highp: в mediump (16 бит, так считают Mali) шаг по u в правой половине карты 1/2048 —
// целая точка текстуры 2048 и две точки текстуры 4096, карта выходит ступеньками и мылом. UVQ — подделка mediump для проверки.
const FS_E = `precision mediump float;
#ifdef GL_FRAGMENT_PRECISION_HIGH
#define HP highp
#else
#define HP mediump
#endif
varying HP vec2 vuv; uniform HP float cloudU;
varying vec3 vn; varying vec3 vp;
uniform sampler2D tDay; uniform sampler2D tMix; uniform sampler2D tNight; uniform vec3 sun; uniform float lightK;
#ifdef UVQ
HP vec2 q16(HP vec2 x){ HP vec2 e = exp2(floor(log2(max(abs(x), 1e-6))) - 10.0); return floor(x / e + 0.5) * e; }
#define UV(x) q16(x)
#else
#define UV(x) (x)
#endif
void main(){
  vec3 n = normalize(vn), v = normalize(-vp);
  HP vec2 uv0 = UV(vuv); HP vec2 uvc = UV(vec2(vuv.x + cloudU, vuv.y));
  float ndl = dot(n, sun);
  float dayF = smoothstep(-0.12, 0.22, ndl);
  vec3 day = texture2D(tDay, uv0).rgb;
  vec4 mx = texture2D(tMix, uv0);
  float cl = texture2D(tMix, uvc).g;
  float dif = max(ndl, 0.0);
  vec3 col = day * (0.06 + 1.05 * dif);
  vec3 h = normalize(sun + v);
  col += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, h), 0.0), 48.0) * mx.b * 0.55 * dayF * (1.0 - cl);
  col = mix(col, vec3(1.0) * (0.05 + 0.95 * dif), cl * 0.85);
  // огни: в текстуре большинство светящихся точек тусклые (медиана 0,06), поэтому подъём тёмных (степень 0,75) и усиление;
  // ниже ~0,03 — шум сжатия, он плавно гасится (полностью видно с 0,08)
  float nl = texture2D(tNight, uv0).r;
  float lights = pow(max(nl - 0.02, 0.0) / 0.98, 0.75) * lightK * smoothstep(0.03, 0.08, nl);
  col += vec3(1.0, 0.78, 0.45) * lights * (1.0 - dayF) * (1.0 - cl * 0.8);
  float fr = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += vec3(0.30, 0.55, 1.0) * fr * (0.15 + 0.85 * smoothstep(-0.3, 0.5, ndl));
  gl_FragColor = vec4(col, 1.0);
}`;
// ореол атмосферы: сфера чуть больше Земли, видны её задние грани, свечение тает к внешнему краю
const FS_H = `precision mediump float;
varying vec3 vn; varying vec3 vp; uniform vec3 sun; uniform float edge;
void main(){
  vec3 n = normalize(vn), v = normalize(-vp);
  float k = smoothstep(0.0, edge, -dot(n, v));
  float lit = 0.25 + 0.75 * smoothstep(-0.4, 0.6, dot(-n, sun));
  gl_FragColor = vec4(vec3(0.30, 0.55, 1.0) * k * k * 0.55 * lit, 1.0);
}`;

function prog(gl, vs, fs) {
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

function sphere(r, cz, nLat = 18, nLon = 28) {
  const pos = [], nor = [], idx = [];
  for (let i = 0; i <= nLat; i++) {
    const th = Math.PI * i / nLat;
    for (let j = 0; j <= nLon; j++) {
      const ph = 2 * Math.PI * j / nLon, nx = Math.sin(th) * Math.cos(ph), ny = Math.sin(th) * Math.sin(ph), nz = Math.cos(th);
      pos.push(r * nx, r * ny, cz + r * nz); nor.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) { const a = i * (nLon + 1) + j, b = a + nLon + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  return { pos, nor, idx };
}
// единичная сфера Земли с координатами карты: z — к северу; u — долгота от −180°, v — от северного полюса
function earthSphere(nLat = 32, nLon = 64) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nLat; i++) {
    const lat = Math.PI / 2 - Math.PI * i / nLat;
    for (let j = 0; j <= nLon; j++) {
      const lon = -Math.PI + 2 * Math.PI * j / nLon;
      pos.push(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)); uv.push(j / nLon, i / nLat);
    }
  }
  for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) { const a = i * (nLon + 1) + j, b = a + nLon + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  return { pos, uv, idx };
}
// рамка по краю листа (толщина w, в плоскости листа, чуть над ним) и стойка от центра листа к Земле
function frameMesh(w) {
  const pos = [], nor = [], idx = [];
  const quad = (a, b, c, d) => { const k = pos.length / 3; for (const p of [a, b, c, d]) { pos.push(...p); nor.push(0, 0, -1); } idx.push(k, k + 1, k + 2, k, k + 2, k + 3); };
  const z = -0.002, o = 0.5, i = 0.5 - w;
  quad([-o, -o, z], [o, -o, z], [o, -i, z], [-o, -i, z]);
  quad([-o, i, z], [o, i, z], [o, o, z], [-o, o, z]);
  quad([-o, -i, z], [-i, -i, z], [-i, i, z], [-o, i, z]);
  quad([i, -i, z], [o, -i, z], [o, i, z], [i, i, z]);
  // стойка (крест из двух полосок)
  const s = 0.012;
  quad([-s, 0, z], [s, 0, z], [s, 0, -0.1], [-s, 0, -0.1]);
  quad([0, -s, z], [0, s, z], [0, s, -0.1], [0, -s, -0.1]);
  return { pos, nor, idx };
}

const mul4 = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const norm3 = (v) => { const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n]; };

import { createSats } from './sats.js?v=0.25';
import { gmst, sunECI } from './orbit.js?v=0.25';
import { RS_GLSL, setRS, rsUniforms, inv4 } from './rshutter.js?v=0.25';
import { createPlaces } from './places.js?v=0.25';

export function createRenderer(canvas, o = {}) {
  const opt = { sun: [-0.6, -0.5, -0.65], tilt: 23.4, dayLen: 60, cloudLen: 400, halo: true, frame: true, clock: null, lights: 1.3, ...o };   // солнце — в осях листа
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, depth: true, powerPreference: 'low-power', preserveDrawingBuffer: false, desynchronized: false });
  if (!gl) throw new Error('WebGL недоступен');
  const pBg = prog(gl, VS_BG, FS_BG), pM = prog(gl, VS_M, FS_M);
  const quadBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const mesh = (m) => {
    const b = { p: gl.createBuffer(), n: gl.createBuffer(), i: gl.createBuffer(), count: m.idx.length };
    gl.bindBuffer(gl.ARRAY_BUFFER, b.p); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(m.pos), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.n); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(m.nor), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.i); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(m.idx), gl.STATIC_DRAW);
    return b;
  };
  const earth = mesh(sphere(0.45, -0.55)), frame = mesh(frameMesh(0.02));
  // спутники: задаются позже (данные грузятся), положения считает видеокарта
  let sats = null;
  function setSats(list, groups, so) { sats = createSats(gl, list, groups, so); return sats; }
  // Земля с текстурами
  const pE = prog(gl, VS_E, (o.uvq ? '#define UVQ\n' : '') + FS_E), pH = prog(gl, VS_E, FS_H);
  const es = earthSphere();
  const eb = { p: gl.createBuffer(), uv: gl.createBuffer(), i: gl.createBuffer(), count: es.idx.length };
  gl.bindBuffer(gl.ARRAY_BUFFER, eb.p); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(es.pos), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, eb.uv); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(es.uv), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eb.i); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(es.idx), gl.STATIC_DRAW);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
  const tex = { day: null, mix: null, night: null, info: '', ms: 0, up: 0, kb: 0, maxSize: gl.getParameter(gl.MAX_TEXTURE_SIZE), hp: !!(gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT) || {}).precision };
  // текстура из файла: сначала запрос (чтобы видеть код ответа — 404 значит «файла нет на сайте»), потом картинка
  async function loadTex(url, gray) {
    const t0 = performance.now();
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    const blob = await r.blob();
    if (!/^image\//.test(blob.type)) throw new Error(`${url}: пришло не изображение (${blob.type || 'тип не указан'}, ${blob.size} байт)`);
    const img = new Image(), src = URL.createObjectURL(blob); img.src = src;
    try { await img.decode(); } catch (e) { URL.revokeObjectURL(src); throw new Error(`${url}: не раскодировалось (${blob.size} байт)`); }
    URL.revokeObjectURL(src);
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));   // по одной текстуре между кадрами — пауз несколько коротких, а не одна длинная
    const tu = performance.now();
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const fmt = gray ? gl.LUMINANCE : gl.RGB;                // серая — байт на точку в памяти видеокарты
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, fmt, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    const up = performance.now() - tu;                       // время главного потока на передачу (без ожидания видеокарты) tex.up = Math.max(tex.up, up);
    tex.ms += performance.now() - t0;
    return { t, w: img.width, h: img.height, bytes: blob.size };
  }
  // запасная текстура 1×1 (если огни или облака не загрузились — Земля всё равно с картой)
  function tex1(rgb, gray) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    const fmt = gray ? gl.LUMINANCE : gl.RGB;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, 1, 1, 0, fmt, gl.UNSIGNED_BYTE, new Uint8Array(gray ? [rgb[0]] : rgb));
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }
  // загрузить текстуры Земли (размер дневной — 2048 или 1024). Каждая отдельно: без дневной Земля остаётся простой,
  // без огней или облаков — с картой, но без них; что не загрузилось и почему — в журнал.
  // ver — добавка к адресу (?v=сборка): файлы текстур меняются под тем же именем, а браузер держит их в кэше
  async function loadEarth(base, size, log = () => {}, ver = '', onEach = () => {}) {   // onEach — после каждого файла (строка загрузки)
    if (size > tex.maxSize) { log(`текстура ${size} больше предела видеокарты (${tex.maxSize}) — беру 2048`); size = 2048; }
    const mixSize = size >= 2048 ? 1024 : 512;
    const q = ver ? `?v=${ver}` : '';
    const each = (p) => p.finally(onEach);
    const res = await Promise.allSettled([each(loadTex(`${base}earth-day-${size}.jpg${q}`)), each(loadTex(`${base}earth-night-${size}.jpg${q}`, true)), each(loadTex(`${base}earth-mix-${mixSize}.jpg${q}`))]);
    const fails = res.filter((r) => r.status === 'rejected').map((r) => r.reason && r.reason.message || String(r.reason));
    fails.forEach((m) => log('текстура не загрузилась —', m));
    if (res[0].status !== 'fulfilled') throw new Error(fails[0] || 'дневная текстура');
    const d = res[0].value, nt = res[1].status === 'fulfilled' ? res[1].value : null, m = res[2].status === 'fulfilled' ? res[2].value : null;
    tex.night = nt ? nt.t : tex1([0], true); tex.mix = m ? m.t : tex1([0, 0, 0]); tex.day = d.t;
    tex.info = `${d.w}×${d.h}${nt ? ` + огни ${nt.w}×${nt.h}` : ' (без огней)'}${m ? ` + ${m.w}×${m.h}` : ' (без облаков)'}`;
    tex.kb = Math.round(res.reduce((a, r) => a + (r.status === 'fulfilled' ? r.value.bytes : 0), 0) / 1024);
  }
  // кольцо текстур с кадрами камеры
  const ring = [];
  for (let i = 0; i < (o.ring || 6); i++) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    ring.push({ tex: t, tf: -1, ta: 0, n: -1, w: 0, h: 0 });
  }
  let ri = 0, seq = 0;
  // загрузить кадр (video или VideoFrame) в следующую текстуру кольца
  function upload(src, w, h, tf, ta) {
    ri = (ri + 1) % ring.length;
    const r = ring[ri];
    gl.bindTexture(gl.TEXTURE_2D, r.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    Object.assign(r, { tf, ta, n: ++seq, w, h, cov: 0 });
    return r;
  }
  let dpr = Math.min(window.devicePixelRatio || 1, o.maxDpr || 1.5);
  function resize() {
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  // выбор нажатием: спутники в радиусе rCss (css px холста) от точки (x, y), не закрытые Землёй, ближние — первыми
  let lastView = null;
  const places = o.places === false ? null : createPlaces(gl);
  function pick(x, y, rCss) {
    if (!lastView) return [];
    const { P, MV, cw, ch, dpr, F, t } = lastView, pos = sats ? sats.positions(t) : [], out = [];
    const tr = (p, w) => [0, 1, 2].map((i) => MV[i] * p[0] + MV[4 + i] * p[1] + MV[8 + i] * p[2] + MV[12 + i] * w);
    const C = tr([0, 0, 0], 1), Re = Math.hypot(...tr([1, 0, 0], 0));   // Земля в осях камеры
    for (let k = 0; k < pos.length; k++) {
      if (!pos[k]) continue;
      const q = tr(pos[k].p, 1), len = Math.hypot(...q); if (q[2] <= 0.01) continue;
      const d = q.map((v) => v / len), tc = C[0] * d[0] + C[1] * d[1] + C[2] * d[2], h2 = C[0] ** 2 + C[1] ** 2 + C[2] ** 2 - tc * tc;
      if (h2 < Re * Re) { const t0 = tc - Math.sqrt(Re * Re - h2); if (t0 > 0 && t0 < len) continue; }   // за Землёй
      const cx = P[0] * q[0] + P[8] * q[2], cy = P[5] * q[1] + P[9] * q[2], w = q[2];
      const sx = (cx / w + 1) / 2 * cw / dpr, sy = (1 - cy / w) / 2 * ch / dpr;
      const rm = pos[k].r ? F / dpr * Math.hypot(...tr([pos[k].r, 0, 0], 0)) / q[2] : 0;   // модель: можно попасть в любую её часть
      const dist = Math.hypot(sx - x, sy - y);
      if (dist <= Math.max(rCss, rm)) out.push({ kind: 'sat', k, d: dist, z: q[2], sx, sy });
    }
    if (places && places.visible) places.positions(lastView.spin, lastView.camE).forEach((pp, k) => {
      if (pp.vis < 0.35) return;                                       // у горизонта и за ним — не выбирается
      const q = tr(pp.p, 1); if (q[2] <= 0.01) return;
      const sx = ((P[0] * q[0] + P[8] * q[2]) / q[2] + 1) / 2 * cw / dpr, sy = (1 - (P[5] * q[1] + P[9] * q[2]) / q[2]) / 2 * ch / dpr;
      const dist = Math.hypot(sx - x, sy - y);
      if (dist <= rCss) out.push({ kind: 'place', k, d: dist, z: q[2], sx, sy });
    });
    return out.sort((a, b) => a.d - b.d);
  }
  // кадр + сцена. slot — запись кольца; pose — { R, t } или null; f — фокус кадра в пикселях
  function draw(slot, pose, f, blank) {
    resize();
    const cw = canvas.width, ch = canvas.height;
    gl.viewport(0, 0, cw, ch);
    gl.disable(gl.DEPTH_TEST);
    if (!slot || slot.n < 0 || blank) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    const vw = slot.w, vh = slot.h, s = Math.max(cw / vw, ch / vh);
    const fw = cw / s / vw, fh = ch / s / vh;                 // видимая доля кадра
    gl.useProgram(pBg);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    const ap = gl.getAttribLocation(pBg, 'p'); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);
    // uv: начало и размер видимой части; t.y переворачивается в шейдере (строки текстуры — сверху вниз)
    gl.uniform4f(gl.getUniformLocation(pBg, 'uv'), (1 - fw) / 2, (1 - fh) / 2, fw, fh);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, slot.tex);
    gl.uniform1i(gl.getUniformLocation(pBg, 'tex'), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(ap);
    if (!pose) return;
    // проекция: точка камеры (x, y, z), ось y вниз → клип
    const a = 2 * s * f / cw, b = 2 * s * f / ch, n = 0.05, F = 50;
    const P = [a, 0, 0, 0, 0, -b, 0, 0, 0, 0, (F + n) / (F - n), 1, 0, 0, -2 * F * n / (F - n), 0];   // по столбцам
    const R = pose.R, t = pose.t;
    const M = [R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, t[0], t[1], t[2], 1];
    // бегущий затвор при рисовании: pose.prev — поза на pose.rs.dt мс раньше, pose.rs.k — время считывания (мс)
    let rs = null;
    if (pose.prev && pose.rs && (pose.rs.k[0] || pose.rs.k[1])) {
      const R0 = pose.prev.R, t0 = pose.prev.t;
      const M0 = [R0[0], R0[3], R0[6], 0, R0[1], R0[4], R0[7], 0, R0[2], R0[5], R0[8], 0, t0[0], t0[1], t0[2], 1];
      rs = rsUniforms(P, M, M0, pose.rs.k, pose.rs.dt, cw / (2 * s * vw), ch / (2 * s * vh));
    }
    gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(pM); setRS(gl, pM, rs);
    gl.uniformMatrix4fv(gl.getUniformLocation(pM, 'P'), false, P);
    gl.uniformMatrix4fv(gl.getUniformLocation(pM, 'M'), false, M);
    const lp = gl.getAttribLocation(pM, 'p'), ln = gl.getAttribLocation(pM, 'n');
    const drawMesh = (m, col, grid) => {
      gl.uniform4f(gl.getUniformLocation(pM, 'col'), ...col); gl.uniform1f(gl.getUniformLocation(pM, 'grid'), grid);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.p); gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.n); gl.enableVertexAttribArray(ln); gl.vertexAttribPointer(ln, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.i); gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
    };
    if (opt.frame) drawMesh(frame, [1.0, 0.8, 0.1, 1], 0);
    gl.disableVertexAttribArray(lp); gl.disableVertexAttribArray(ln);
    // время: модельные часы (opt.clock) — Земля по звёздному времени, Солнце по дате; без часов — как раньше
    const wall = performance.now(), ck = opt.clock ? opt.clock() : null;
    const spinNow = ck ? gmst(ck.t) : wall / 1000 * 2 * Math.PI / opt.dayLen;
    const E0 = earthModel(0);
    const ax = (k) => norm3([E0[k], E0[k + 1], E0[k + 2]]);
    const EX = ax(0), EY = ax(4), EZ = ax(8);
    const sunE = ck ? sunECI(ck.t) : null;                    // Солнце в осях Земли (ECI)
    const sunB0 = sunE ? [0, 1, 2].map((i) => EX[i] * sunE[0] + EY[i] * sunE[1] + EZ[i] * sunE[2]) : norm3(opt.sun);
    const MVe = mul4(M, E0), Mi = inv4(MVe), camE = Mi ? [Mi[12] / Mi[15], Mi[13] / Mi[15], Mi[14] / Mi[15]] : [0, 0, 10];
    const drawSats = () => {
      if (places) places.draw(P, MVe, spinNow, camE, dpr, rs, s * f);       // точки на Земле — после Земли, до спутников
      lastView = { P, MV: MVe, cw, ch, dpr, F: s * f, t: ck ? ck.t : 0, spin: spinNow, camE };   // для выбора нажатием — то, что показано
      if (!sats || !ck) return;
      sats.draw(ck.t, wall, ck.speed, P, MVe, sunE, s * f, [cw, ch], dpr, rs);
    };
    if (!tex.day) {
      gl.useProgram(pM); setRS(gl, pM, rs); gl.enableVertexAttribArray(lp); gl.enableVertexAttribArray(ln);
      drawMesh(earth, [0.15, 0.4, 0.8, 1], 1);
      gl.disableVertexAttribArray(lp); gl.disableVertexAttribArray(ln);
      drawSats();
      return;
    }
    // модель Земли: центр на 0,55 над листом, радиус 0,45; ось наклонена на 23,4°, суточное вращение
    const tsec = wall / 1000;
    const E = earthModel(spinNow);
    const MV = mul4(M, E), MVh = mul4(M, earthModel(spinNow, 1.06));
    const sunB = sunB0, sunC = [R[0] * sunB[0] + R[1] * sunB[1] + R[2] * sunB[2], R[3] * sunB[0] + R[4] * sunB[1] + R[5] * sunB[2], R[6] * sunB[0] + R[7] * sunB[1] + R[8] * sunB[2]];
    const bindE = (pr) => {
      gl.useProgram(pr); setRS(gl, pr, rs);
      gl.uniformMatrix4fv(gl.getUniformLocation(pr, 'P'), false, P);
      gl.uniform3f(gl.getUniformLocation(pr, 'sun'), ...sunC);
      const ap = gl.getAttribLocation(pr, 'p'), au = gl.getAttribLocation(pr, 'uv');
      gl.bindBuffer(gl.ARRAY_BUFFER, eb.p); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0);
      if (au >= 0) { gl.bindBuffer(gl.ARRAY_BUFFER, eb.uv); gl.enableVertexAttribArray(au); gl.vertexAttribPointer(au, 2, gl.FLOAT, false, 0, 0); }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eb.i);
      return () => { gl.disableVertexAttribArray(ap); if (au >= 0) gl.disableVertexAttribArray(au); };
    };
    let off = bindE(pE);
    gl.uniformMatrix4fv(gl.getUniformLocation(pE, 'MV'), false, MV);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.day); gl.uniform1i(gl.getUniformLocation(pE, 'tDay'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex.mix); gl.uniform1i(gl.getUniformLocation(pE, 'tMix'), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tex.night); gl.uniform1i(gl.getUniformLocation(pE, 'tNight'), 2);
      gl.uniform1f(gl.getUniformLocation(pE, 'lightK'), opt.lights);
    gl.uniform1f(gl.getUniformLocation(pE, 'cloudU'), (tsec / opt.cloudLen) % 1);
    gl.drawElements(gl.TRIANGLES, eb.count, gl.UNSIGNED_SHORT, 0);
    gl.activeTexture(gl.TEXTURE0);
    off();
    drawSats();
    // ореол: задние грани сферы побольше, складывается со светом, глубину не пишет
    if (opt.halo) {
      off = bindE(pH);
      gl.uniformMatrix4fv(gl.getUniformLocation(pH, 'MV'), false, MVh);
      gl.uniform1f(gl.getUniformLocation(pH, 'edge'), Math.sqrt(1 - 1 / (1.06 * 1.06)));
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT); gl.frontFace(gl.CCW);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
      gl.drawElements(gl.TRIANGLES, eb.count, gl.UNSIGNED_SHORT, 0);
      gl.disable(gl.BLEND); gl.depthMask(true); gl.disable(gl.CULL_FACE);
      off();
    }
  }
  // матрица Земли в осях листа (по столбцам): перенос к центру, наклон оси, вращение, масштаб (k — для ореола)
  function earthModel(spin, k = 1) {
    const r = 0.45 * k, c = Math.cos(spin), s = Math.sin(spin), tl = opt.tilt * Math.PI / 180, ct = Math.cos(tl), st = Math.sin(tl);
    // местные оси Земли → оси листа: север (z) → «вверх» над листом (−z листа), наклонённый на tl к +x
    const Z = [st, 0, -ct], X0 = [ct, 0, st], Y0 = [0, -1, 0];       // правая тройка: X0 × Y0 = Z
    const X = X0.map((v, i) => v * c + Y0[i] * s), Y = Y0.map((v, i) => -X0[i] * s + v * c);
    return [X[0] * r, X[1] * r, X[2] * r, 0, Y[0] * r, Y[1] * r, Y[2] * r, 0, Z[0] * r, Z[1] * r, Z[2] * r, 0, 0, 0, -0.55, 1];
  }
  return { gl, upload, draw, ring, setDpr(d) { dpr = d; }, loadEarth, tex, opt, setSats, get sats() { return sats; }, get places() { return places; }, pick };
}
