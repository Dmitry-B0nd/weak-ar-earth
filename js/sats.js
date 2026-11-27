// Спутники по данным основного проекта (data/satellites.json: элементы CelesTrak в формате OMM).
// Процессор раз в полсекунды пересчитывает элементы всех спутников на текущий момент (Кеплер + J2 + торможение,
// js/orbit.js; расхождение с SGP4 — доли пикселя), видеокарта между пересчётами ведёт каждый спутник сама.
// Как в основном проекте: «художественная» шкала высот, точки (известные — 0,06 R, малые — 0,032 R, 3–40 px),
// подписи и орбиты только у известных (group «context»). Оси — инерциальные (ECI), единица — радиус Земли.
import { fromOMM, at, posFrom, artR, fromRV, RE, MU } from './orbit.js?v=0.23';
import { RS_GLSL, setRS, inv4 } from './rshutter.js?v=0.23';
import { buildModel, modelKind } from './models.js?v=0.23';

const KEPLER = `
vec3 satPos(vec4 e0, vec4 e1, float dt) {           // e0: a (R), e, i, узел; e1: перицентр, M, n (рад/с), размер
  if (e0.x <= 0.0) return vec3(1e4);                  // спутника нет (SGP4 не считает — сошёл с орбиты)
  float M = e1.y + e1.z * dt, e = e0.y, E = M;
  E = M + e * sin(E); E = M + e * sin(E); E = M + e * sin(E);
  float x = e0.x * (cos(E) - e), y = e0.x * sqrt(1.0 - e * e) * sin(E);
  float cw = cos(e1.x), sw = sin(e1.x), ci = cos(e0.z), si = sin(e0.z), co = cos(e0.w), so = sin(e0.w);
  float xp = x * cw - y * sw, yp = x * sw + y * cw;
  vec3 p = vec3(xp * co - yp * ci * so, xp * so + yp * ci * co, yp * si);
  float r = length(p);
  return p / r * (1.0 + 0.69 * pow(max(r - 1.0, 0.0), 0.324));   // «художественная» высота
}
// уход за Землю: 1 — виден, 0 — закрыт; у края диска плавно (а не обрезается краем Земли)
uniform vec3 camE;
float limbFade(vec3 p) {
  vec3 d = p - camE; float L = length(d); d /= L;
  float tc = -dot(camE, d);
  if (tc <= 0.0 || tc >= L) return 1.0;                 // ближайшая к центру точка луча — за спутником: он перед Землёй
  return smoothstep(1.0, 1.07, length(camE + d * tc));
}`;
const VS = `attribute vec4 e0; attribute vec4 e1; attribute vec3 c;
uniform mat4 P; uniform mat4 MV; uniform float dt; uniform vec3 sunE; uniform float F; uniform vec2 pxr;
varying vec3 col; varying float fade;
${KEPLER}
${RS_GLSL}
void main(){
  if (e1.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; col = c; fade = 0.0; return; }   // вместо точки — модель
  vec3 p = satPos(e0, e1, dt);
  col = c; fade = limbFade(p);                                    // одним цветом; за Землю уходит плавно
  if (fade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; return; }
  vec4 q = MV * vec4(p, 1.0);
  gl_Position = rsW(P * q);
  gl_PointSize = clamp(F * e1.w / q.z, pxr.x, pxr.y);
}`;
const FS = `precision mediump float; varying vec3 col; varying float fade;
void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; float a = (1.0 - smoothstep(0.82, 1.0, r)) * fade; if (a < 0.01) discard; gl_FragColor = vec4(col * a, a); }`;
// кольцо выбранного спутника: точка постоянного размера (px) вокруг его положения
const VS_R = `attribute vec4 e0; attribute vec4 e1;
uniform mat4 P; uniform mat4 MV; uniform float dt; uniform float px; varying float fade;
${KEPLER}
${RS_GLSL}
void main(){ vec3 p = satPos(e0, e1, dt); fade = limbFade(p); vec4 q = MV * vec4(p, 1.0); gl_Position = rsW(P * q); gl_PointSize = px; }`;
const FS_R = `precision mediump float; uniform float pf; uniform float ca; varying float fade;   // pf — тот же размер (точность в шейдерах разная); ca — яркость
void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * pf, R = pf * 0.5;
  float a = smoothstep(R - 4.0, R - 2.5, r) * (1.0 - smoothstep(R - 1.5, R, r)) * ca * fade; if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(a), a); }`;
// подписи: прямоугольник постоянного экранного размера справа сверху от точки
const VS_T = `attribute vec4 e0; attribute vec4 e1; attribute vec4 q;   // q: угол (px), uv
uniform mat4 P; uniform mat4 MV; uniform float dt; uniform vec2 vp;
varying vec2 uv; varying float fade;
${KEPLER}
${RS_GLSL}
void main(){
  vec3 p = satPos(e0, e1, dt); fade = limbFade(p);
  vec4 c = rsW(P * (MV * vec4(p, 1.0)));
  c.xy += q.xy * 2.0 / vp * c.w;
  gl_Position = c; uv = q.zw;
}`;
const FS_T = `precision mediump float; varying vec2 uv; varying float fade; uniform sampler2D t; void main(){ vec4 c = texture2D(t, uv) * fade; if (c.a < 0.02) discard; gl_FragColor = c; }`;
const VS_L = `attribute vec3 p; uniform mat4 P; uniform mat4 MV;
${RS_GLSL}
void main(){ gl_Position = rsW(P * MV * vec4(p, 1.0)); }`;
const FS_L = `precision mediump float; uniform vec4 c; void main(){ gl_FragColor = c; }`;

// модели известных спутников: свет от Солнца (в тени Земли — только рассеянный), блеск, сетка ячеек на батареях
const VS_M = `attribute vec3 p; attribute vec3 n; attribute vec4 c; attribute vec2 g;
uniform mat4 P; uniform mat4 MV; uniform mat4 Mm;
varying vec3 vn; varying vec3 vv; varying vec4 vc; varying vec2 vg; varying highp vec3 mp;
${RS_GLSL}
void main(){ vec4 q = MV * (Mm * vec4(p, 1.0)); vv = q.xyz; vn = mat3(MV) * (mat3(Mm) * n); vc = c; vg = g; mp = p; gl_Position = rsW(P * q); }`;
const FS_M = (deriv) => `${deriv ? '#extension GL_OES_standard_derivatives : enable\n' : ''}precision mediump float;
#ifdef GL_FRAGMENT_PRECISION_HIGH
#define HP highp
#else
#define HP mediump
#endif
varying vec3 vn; varying vec3 vv; varying vec4 vc; varying vec2 vg; varying HP vec3 mp;
uniform vec3 sunV; uniform float lit;
void main(){
  vec3 N = normalize(vn), V = normalize(-vv);
  if (dot(N, V) < 0.0) N = -N;                                   // тонкие панели видны с обеих сторон
  float foil = 0.0;
  if (vg.x < -1.5) {                                              // плёнка-теплоизоляция: мятая, с бликами
    HP vec3 q = mp * 2.6;
    vec3 w = vec3(sin(q.x * 1.7 + q.y * 2.3) + sin(q.y * 3.1 - q.z * 1.3), sin(q.y * 1.9 + q.z * 2.9) + sin(q.z * 2.3 - q.x * 1.1),
                  sin(q.z * 1.5 + q.x * 2.7) + sin(q.x * 3.3 - q.y * 1.7));
    N = normalize(N + 0.22 * w); foil = 1.0;
  }
  float d = max(dot(N, sunV), 0.0);
  float sp = pow(max(dot(N, normalize(sunV + V)), 0.0), foil > 0.5 ? 12.0 : 24.0) * vc.a;
  vec3 base = vc.rgb;
  if (vg.x >= 0.0) {                                              // сетка ячеек солнечной батареи
    vec2 f = abs(fract(vg) - 0.5);
    ${deriv ? 'vec2 w = fwidth(vg); float line = max(smoothstep(0.47 - w.x, 0.47, f.x), smoothstep(0.45 - w.y, 0.45, f.y)); line = mix(line, 0.12, smoothstep(0.25, 0.6, max(w.x, w.y)));' : 'float line = max(step(0.47, f.x), step(0.45, f.y));'}
    base = mix(base, vec3(0.5, 0.52, 0.58), line * 0.6);
  }
  vec3 col = base * (0.4 + 0.9 * d * lit) + vec3(sp * lit * 0.8);
  gl_FragColor = vec4(col, 1.0);
}`;

function prog(gl, vs, fs) {
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
const hex = (h) => { const v = parseInt((h || '#ffffff').slice(1), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };

// Нагрузочный набор (?sats=N): условные элементы с эпохой «сейчас», в том же виде, что из OMM
export function syntheticList(n, now, seed = 7) {
  let s = seed; const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const out = [], shells = [[550, 53], [540, 53.2], [570, 70], [560, 97.6], [1200, 87.9], [20200, 55], [35786, 0.05]];
  for (let k = 0; k < n; k++) {
    const [alt, inc] = shells[k % 50 === 0 ? 6 : k % 23 === 0 ? 5 : k % 5], a = RE + alt + (r() - 0.5) * 20;
    out.push({ name: '', group: 'cubesat', el: { epoch: now, n: Math.sqrt(MU / a ** 3), a, e: 0.0005, i: inc * Math.PI / 180, raan0: Math.floor(r() * 72) / 72 * 6.2832, argp0: r() * 6.2832, m0: r() * 6.2832, raanDot: 0, argpDot: 0, mdd: 0 } });
  }
  return out;
}

// list: [{ name, group, cube, el (fromOMM) }]; groups: { имя: { color } }
export function createSats(gl, list, groups, o = {}) {
  const opt = { ctxSize: 0.06, smallSize: 0.032, minPx: 3, maxPx: 40, orbitSeg: 160, rebase: 500,
    models: true, modelSize: 0.22, modelScale: 1, modelMinPx: 14, ...o };   // modelSize — наибольший размер модели в радиусах Земли;
  // modelMinPx — меньше этого (css px) модель на экране не бывает: издалека её всё равно видно
  const pS = prog(gl, VS, FS), pT = prog(gl, VS_T, FS_T), pL = prog(gl, VS_L, FS_L), pR = prog(gl, VS_R, FS_R);
  const n = list.length;
  const ctx = list.map((s, k) => (s.group === 'context' ? k : -1)).filter((k) => k >= 0);
  // точки: e0, e1 (обновляются при пересчёте), цвет
  const el = new Float32Array(n * 8), colr = new Float32Array(n * 3);
  list.forEach((s, k) => colr.set(hex((groups[s.group] || {}).color), k * 3));
  const bE = gl.createBuffer(), bC = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bC); gl.bufferData(gl.ARRAY_BUFFER, colr, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, bE); gl.bufferData(gl.ARRAY_BUFFER, el.byteLength, gl.DYNAMIC_DRAW);
  // подписи известных: атлас текста
  const L = ctx.map((k) => ({ k, text: list[k].name || '', color: (groups[list[k].group] || {}).color || '#fff' }));
  const fontPx = 30, pad = 6, atlasW = 512;
  const cv = document.createElement('canvas'); const cx = cv.getContext('2d');
  cx.font = `600 ${fontPx}px system-ui, sans-serif`;
  let xx = 0, yy = 0, rowH = fontPx + 2 * pad;
  for (const l of L) { l.w = Math.ceil(cx.measureText(l.text).width) + 2 * pad; if (xx + l.w > atlasW) { xx = 0; yy += rowH; } l.x = xx; l.y = yy; xx += l.w; }
  cv.width = atlasW; cv.height = Math.max(64, 2 ** Math.ceil(Math.log2(yy + rowH)));
  cx.font = `600 ${fontPx}px system-ui, sans-serif`; cx.textBaseline = 'middle'; cx.lineJoin = 'round';
  for (const l of L) { cx.lineWidth = 6; cx.strokeStyle = 'rgba(0,0,0,0.85)'; cx.strokeText(l.text, l.x + pad, l.y + rowH / 2); cx.fillStyle = l.color; cx.fillText(l.text, l.x + pad, l.y + rowH / 2); }
  const tT = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tT);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const tq = new Float32Array(L.length * 4 * 12);           // на вершину: e0 (4), e1 (4), q (4)
  const tIdx = new Uint16Array(L.length * 6);
  L.forEach((l, j) => { const b = j * 4; tIdx.set([b, b + 1, b + 2, b, b + 2, b + 3], j * 6); });
  const bT = gl.createBuffer(), bTi = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bTi); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tIdx, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, bT); gl.bufferData(gl.ARRAY_BUFFER, tq.byteLength, gl.DYNAMIC_DRAW);
  // орбиты известных
  const bO = gl.createBuffer(), seg = opt.orbitSeg, orb = new Float32Array(ctx.length * (seg + 1) * 3);
  // модели известных
  const deriv = !!gl.getExtension('OES_standard_derivatives');
  const pM = opt.models ? prog(gl, VS_M, FS_M(deriv)) : null;
  const SIZE = { iss: 1.45, css: 1.25, hubble: 0.9, cube3: 0.4, micro: 0.45 };   // станции крупнее, Хаббл мельче; малые — «под лупой»
  const geo = {};                                                     // kind → { body, wing } на видеокарте
  const up = (m) => { const vb = gl.createBuffer(), ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, m.v, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW); return { vb, ib, n: m.idx.length }; };
  // модели строятся в фоновом потоке и появляются по готовности; пока модели нет — видна точка
  const M = pM ? ctx.map((k) => ({ k, kind: modelKind(list[k].key, list[k].name), g: null, scale: 0 })) : [];
  const ready = new Set(); let tris = 0;
  const t0 = performance.now();
  const scaleOf = (kind) => opt.modelSize * opt.modelScale * (SIZE[kind] || 1) / geo[kind].ext;
  function attach(b) {
    geo[b.kind] = { body: up(b.body), wing: up(b.wing), ext: b.ext, tris: (b.body.idx.length + b.wing.idx.length) / 3 };
    for (const m of M) if (m.kind === b.kind) { m.g = geo[b.kind]; m.scale = scaleOf(m.kind); ready.add(m.k); tris += m.g.tris; }
    if (selM && selM.kind === b.kind && !selM.g) { selM.g = geo[b.kind]; selM.scale = scaleOf(b.kind); }
    tRef = 0;                                                         // пересчитать: точку этого спутника — убрать
    if (kinds.every((k) => geo[k]) && opt.onModels) opt.onModels(tris, performance.now() - t0);
  }
  // модели малых спутников — заранее, чтобы при выборе ничего не строить
  const kinds = [...new Set(M.map((m) => m.kind))].concat(pM ? ['cube3', 'micro'] : []);
  const onMain = () => kinds.forEach((kind, j) => setTimeout(() => attach({ kind, ...buildModel(kind) }), 30 * (j + 1)));   // запасной путь: по модели за раз
  if (kinds.length) {
    try {
      const w = new Worker(new URL('./modelworker.js?v=0.23', import.meta.url), { type: 'module' });
      let got = 0; w.onmessage = (e) => { attach(e.data); if (++got === kinds.length) w.terminate(); };
      w.onerror = (e) => { e.preventDefault && e.preventDefault(); w.terminate(); if (!got) onMain(); };
      w.postMessage(kinds);
    } catch (e) { onMain(); }
  }

  let tRef = 0, wallRef = 0, lastOrbit = -1e9;
  // выбранный спутник: кольцо, его орбита, у малых — модель вместо точки
  let sel = -1, selM = null, selOrbitT = -1e18, warm = 0, lastCam = [0, 0, 10];
  const bOs = gl.createBuffer(), orbS = new Float32Array((seg + 1) * 3);
  const isCtx = (k) => list[k].group === 'context';
  // пересчёт элементов на момент t (мс модельного времени)
  // спутники, которые ведутся по SGP4 (у них простой расчёт разошёлся с SGP4): k → satrec
  const sgp = new Map(); let propagate = null;
  function rebase(t, wall) {
    tRef = t; wallRef = wall;
    const date = sgp.size ? new Date(t) : null;
    for (let k = 0; k < n; k++) {
      const size = list[k].group === 'context' ? (ready.has(k) ? 0 : opt.ctxSize) : (k === sel && selM && selM.g ? 0 : opt.smallSize);
      const rec = sgp.get(k);
      if (rec) {
        let pv = null; try { pv = propagate(rec, date); } catch (e) { pv = null; }
        if (pv && pv.position && pv.velocity) {
          const q = fromRV([pv.position.x, pv.position.y, pv.position.z], [pv.velocity.x, pv.velocity.y, pv.velocity.z]);
          el.set([q.a / RE, q.e, q.i, q.raan, q.argp, q.M, q.n, size], k * 8);
        } else el.set([0, 0, 0, 0, 0, 0, 0, size], k * 8);
        continue;
      }
      const s = list[k].el, a = at(s, t);
      el.set([s.a / RE, s.e, s.i, a.raan, a.argp, a.M, a.nNow, size], k * 8);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, bE); gl.bufferSubData(gl.ARRAY_BUFFER, 0, el);
    L.forEach((l, j) => {
      const e = el.subarray(l.k * 8, l.k * 8 + 8), w = l.w, h = rowH, ox = 10, oy = 6;
      const u0 = l.x / atlasW, u1 = (l.x + w) / atlasW, v0 = l.y / cv.height, v1 = (l.y + h) / cv.height;
      const corners = [[ox, oy + h, u0, v0], [ox + w, oy + h, u1, v0], [ox + w, oy, u1, v1], [ox, oy, u0, v1]];
      corners.forEach((c, m) => { const at = (j * 4 + m) * 12; tq.set(e, at); tq.set(c, at + 8); });
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, bT); gl.bufferSubData(gl.ARRAY_BUFFER, 0, tq);
  }
  // орбиты известных: эллипс в «художественной» шкале (узел и перицентр медленно поворачиваются — перестраиваем)
  function orbitInto(k, t, out, off) {
    const s = list[k].el, a = at(s, t);
    for (let m = 0; m <= seg; m++) {
      const p = posFrom(s.a, s.e, s.i, a.raan, a.argp, m / seg * 2 * Math.PI), r = Math.hypot(p[0], p[1], p[2]), R = artR(r);
      out.set([p[0] / r * R, p[1] / r * R, p[2] / r * R], off + m * 3);
    }
  }
  function buildOrbits(t) {
    ctx.forEach((k, j) => orbitInto(k, t, orb, j * (seg + 1) * 3));
    gl.bindBuffer(gl.ARRAY_BUFFER, bO); gl.bufferData(gl.ARRAY_BUFFER, orb, gl.DYNAMIC_DRAW);
  }

  // положение спутника k в сцене (ECI, радиусы Земли, «художественная» высота) — как в шейдере, но в двойной точности
  function scenePos(k, dt) {
    const e = el.subarray(k * 8, k * 8 + 8); if (e[0] <= 0) return null;
    const p = posFrom(e[0], e[1], e[2], e[3], e[4], e[5] + e[6] * dt), r = Math.hypot(p[0], p[1], p[2]);
    const R = 1 + 0.69 * Math.pow(Math.max(r - 1, 0), 0.324);
    return [p[0] / r * R, p[1] / r * R, p[2] / r * R];
  }
  const Mm = new Float32Array(16), Mw = new Float32Array(16);
  function drawModels(P, MV, sunE, dt, rs, F, dpr) {
    gl.useProgram(pM); setRS(gl, pM, rs);
    gl.uniformMatrix4fv(gl.getUniformLocation(pM, 'P'), false, P); gl.uniformMatrix4fv(gl.getUniformLocation(pM, 'MV'), false, MV);
    // Солнце в осях камеры
    const sv = [MV[0] * sunE[0] + MV[4] * sunE[1] + MV[8] * sunE[2], MV[1] * sunE[0] + MV[5] * sunE[1] + MV[9] * sunE[2], MV[2] * sunE[0] + MV[6] * sunE[1] + MV[10] * sunE[2]];
    const sl = Math.hypot(...sv); gl.uniform3f(gl.getUniformLocation(pM, 'sunV'), sv[0] / sl, sv[1] / sl, sv[2] / sl);
    const uM = gl.getUniformLocation(pM, 'Mm'), uL = gl.getUniformLocation(pM, 'lit');
    const ap = gl.getAttribLocation(pM, 'p'), an = gl.getAttribLocation(pM, 'n'), ac = gl.getAttribLocation(pM, 'c'), ag = gl.getAttribLocation(pM, 'g');
    [ap, an, ac, ag].forEach((a) => gl.enableVertexAttribArray(a));
    const bind = (part) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, part.vb); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.ib);
      gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 48, 0); gl.vertexAttribPointer(an, 3, gl.FLOAT, false, 48, 12);
      gl.vertexAttribPointer(ac, 4, gl.FLOAT, false, 48, 24); gl.vertexAttribPointer(ag, 2, gl.FLOAT, false, 48, 40);
    };
    for (const m of (selM ? M.concat([selM]) : M)) {
      if (!m.g) continue;
      const p = scenePos(m.k, dt), p1 = scenePos(m.k, dt + 1); if (!p || !p1) continue;
      // оси модели: Z — к Земле, X — по полёту (без составляющей вдоль Z), Y = Z × X
      const r = Math.hypot(...p), z = [-p[0] / r, -p[1] / r, -p[2] / r];
      let x = [p1[0] - p[0], p1[1] - p[1], p1[2] - p[2]]; const xz = x[0] * z[0] + x[1] * z[1] + x[2] * z[2];
      x = [x[0] - xz * z[0], x[1] - xz * z[1], x[2] - xz * z[2]]; const xl = Math.hypot(...x) || 1; x = x.map((v) => v / xl);
      const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
      // не меньше modelMinPx на экране (F·0,45 — пикселей на радиус Земли на расстоянии 1 листа)
      const zc = MV[2] * p[0] + MV[6] * p[1] + MV[10] * p[2] + MV[14], px = F * 0.45 * m.g.ext * m.scale / Math.max(zc, 1e-3);
      const minPx = (m === selM ? 32 : opt.modelMinPx) * dpr;          // выбранный малый — крупнее, чтобы разглядеть
      const s = m.scale * Math.max(1, minPx / px); m.px = Math.max(px, minPx);
      Mm.set([x[0] * s, x[1] * s, x[2] * s, 0, y[0] * s, y[1] * s, y[2] * s, 0, z[0] * s, z[1] * s, z[2] * s, 0, p[0], p[1], p[2], 1]);
      // тень Земли (цилиндр по направлению от Солнца)
      const along = p[0] * sunE[0] + p[1] * sunE[1] + p[2] * sunE[2];
      const side = Math.hypot(p[0] - along * sunE[0], p[1] - along * sunE[1], p[2] - along * sunE[2]);
      gl.uniform1f(uL, along < 0 && side < 1 ? 0 : 1);
      gl.uniformMatrix4fv(uM, false, Mm); bind(m.g.body); gl.drawElements(gl.TRIANGLES, m.g.body.n, gl.UNSIGNED_SHORT, 0);
      // крылья: поворот вокруг Y модели лицом к Солнцу
      const sx = sunE[0] * x[0] + sunE[1] * x[1] + sunE[2] * x[2], sz = sunE[0] * z[0] + sunE[1] * z[1] + sunE[2] * z[2];
      const th = Math.atan2(sx, sz), c = Math.cos(th), sn = Math.sin(th);
      // Mw = Mm · Ry(θ): новые оси X' = X·c − Z·sn, Z' = X·sn + Z·c
      for (let q = 0; q < 3; q++) { Mw[q] = Mm[q] * c - Mm[8 + q] * sn; Mw[4 + q] = Mm[4 + q]; Mw[8 + q] = Mm[q] * sn + Mm[8 + q] * c; }
      Mw[3] = Mw[7] = Mw[11] = 0; Mw[12] = p[0]; Mw[13] = p[1]; Mw[14] = p[2]; Mw[15] = 1;
      if (m.g.wing.n) { gl.uniformMatrix4fv(uM, false, Mw); bind(m.g.wing); gl.drawElements(gl.TRIANGLES, m.g.wing.n, gl.UNSIGNED_SHORT, 0); }
    }
    [ap, an, ac, ag].forEach((a) => gl.disableVertexAttribArray(a));
  }

  // t — модельное время (мс), wall — время страницы (мс), speed — ускорение; P, MV (оси Земли без суточного
  // вращения → камера); sunE — Солнце в осях Земли; F — фокус (px холста); vp — размер холста; dpr
  function draw(t, wall, speed, P, MV, sunE, F, vp, dpr, rs = null) {
    if (!tRef || wall - wallRef > opt.rebase || t < tRef) rebase(t, wall);
    if (ctx.length && Math.abs(t - lastOrbit) > 3600e3) { buildOrbits(t); lastOrbit = t; }
    const dt = (t - tRef) / 1000;
    const Mi = inv4(MV), camE = Mi ? [Mi[12] / Mi[15], Mi[13] / Mi[15], Mi[14] / Mi[15]] : [0, 0, 10];   // камера в осях Земли
    lastCam = camE;
    // орбиты
    if (ctx.length) {
      gl.useProgram(pL); setRS(gl, pL, rs);
      gl.uniformMatrix4fv(gl.getUniformLocation(pL, 'P'), false, P); gl.uniformMatrix4fv(gl.getUniformLocation(pL, 'MV'), false, MV);
      const ap = gl.getAttribLocation(pL, 'p');
      gl.bindBuffer(gl.ARRAY_BUFFER, bO); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      ctx.forEach((k, j) => { const c = colr.subarray(k * 3, k * 3 + 3); gl.uniform4f(gl.getUniformLocation(pL, 'c'), c[0], c[1], c[2], 0.35); gl.drawArrays(gl.LINE_STRIP, j * (seg + 1), seg + 1); });
      gl.disable(gl.BLEND); gl.depthMask(true); gl.disableVertexAttribArray(ap);
    }
    // орбита выбранного (поверх своей, ярче)
    if (sel >= 0) {
      if (Math.abs(t - selOrbitT) > 3600e3) { orbitInto(sel, t, orbS, 0); gl.bindBuffer(gl.ARRAY_BUFFER, bOs); gl.bufferData(gl.ARRAY_BUFFER, orbS, gl.DYNAMIC_DRAW); selOrbitT = t; }
      gl.useProgram(pL); setRS(gl, pL, rs);
      gl.uniformMatrix4fv(gl.getUniformLocation(pL, 'P'), false, P); gl.uniformMatrix4fv(gl.getUniformLocation(pL, 'MV'), false, MV);
      const ap = gl.getAttribLocation(pL, 'p');
      gl.bindBuffer(gl.ARRAY_BUFFER, bOs); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.uniform4f(gl.getUniformLocation(pL, 'c'), 1, 1, 1, 0.7); gl.drawArrays(gl.LINE_STRIP, 0, seg + 1);
      gl.disable(gl.BLEND); gl.depthMask(true); gl.disableVertexAttribArray(ap);
    }
    // точки
    gl.useProgram(pS); setRS(gl, pS, rs);
    gl.uniformMatrix4fv(gl.getUniformLocation(pS, 'P'), false, P); gl.uniformMatrix4fv(gl.getUniformLocation(pS, 'MV'), false, MV);
    gl.uniform1f(gl.getUniformLocation(pS, 'dt'), dt);
    gl.uniform3f(gl.getUniformLocation(pS, 'sunE'), ...sunE); gl.uniform3f(gl.getUniformLocation(pS, 'camE'), ...camE);
    gl.uniform1f(gl.getUniformLocation(pS, 'F'), F * 0.45);           // размер в радиусах Земли → ширины листа
    gl.uniform2f(gl.getUniformLocation(pS, 'pxr'), opt.minPx * dpr, opt.maxPx * dpr);
    const a0 = gl.getAttribLocation(pS, 'e0'), a1 = gl.getAttribLocation(pS, 'e1'), ac = gl.getAttribLocation(pS, 'c');
    gl.bindBuffer(gl.ARRAY_BUFFER, bE);
    gl.enableVertexAttribArray(a0); gl.vertexAttribPointer(a0, 4, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(a1); gl.vertexAttribPointer(a1, 4, gl.FLOAT, false, 32, 16);
    gl.bindBuffer(gl.ARRAY_BUFFER, bC); gl.enableVertexAttribArray(ac); gl.vertexAttribPointer(ac, 3, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(a0); gl.disableVertexAttribArray(a1); gl.disableVertexAttribArray(ac);
    if (M.length || selM) drawModels(P, MV, sunE, dt, rs, F, dpr);
    // прогрев (один кадр, когда модели готовы): модели малых и кольцо рисуются в 1 пиксель — драйвер готовит всё
    // заранее, и первое нажатие не даёт фриза
    if (warm === 0 && pM && geo.cube3 && geo.micro && n) {
      warm = 1; const keep = selM; gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, 1, 1);
      for (const kind of ['cube3', 'micro']) { selM = { k: 0, kind, g: geo[kind], scale: scaleOf(kind) }; drawModels(P, MV, sunE, dt, rs, F, dpr); }
      selM = keep;
    } else if (warm === 1) warm = 2;
    // кольцо выбранного
    const rings = [];
    if (sel >= 0 && el[sel * 8] > 0) {
      const m = M.find((q) => q.k === sel) || selM;
      let rpx = 22 * dpr;                                               // радиус кольца — по размеру модели на экране, не меньше 22 css px
      if (m && m.g && m.px) rpx = Math.max(rpx, m.px * 0.75 + 6 * dpr);
      rings.push([sel, Math.min(2 * rpx, 250 * dpr), 1]);
    }
    if (warm === 1 && n) rings.push([0, 4, 0]);                         // прогрев: шейдер кольца — до первого нажатия
    if (rings.length) {
      gl.useProgram(pR); setRS(gl, pR, rs);
      gl.uniformMatrix4fv(gl.getUniformLocation(pR, 'P'), false, P); gl.uniformMatrix4fv(gl.getUniformLocation(pR, 'MV'), false, MV);
      gl.uniform1f(gl.getUniformLocation(pR, 'dt'), dt); gl.uniform3f(gl.getUniformLocation(pR, 'camE'), ...camE);
      const a0 = gl.getAttribLocation(pR, 'e0'), a1 = gl.getAttribLocation(pR, 'e1');
      gl.bindBuffer(gl.ARRAY_BUFFER, bE);
      gl.enableVertexAttribArray(a0); gl.vertexAttribPointer(a0, 4, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(a1); gl.vertexAttribPointer(a1, 4, gl.FLOAT, false, 32, 16);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      for (const [k, ps, ca] of rings) {
        gl.uniform1f(gl.getUniformLocation(pR, 'px'), ps); gl.uniform1f(gl.getUniformLocation(pR, 'pf'), ps); gl.uniform1f(gl.getUniformLocation(pR, 'ca'), ca);
        gl.drawArrays(gl.POINTS, k, 1);
      }
      gl.disable(gl.BLEND); gl.depthMask(true); gl.disableVertexAttribArray(a0); gl.disableVertexAttribArray(a1);
    }
    if (warm === 1) gl.disable(gl.SCISSOR_TEST);
    // подписи
    if (L.length) {
      gl.useProgram(pT); setRS(gl, pT, rs);
      gl.uniformMatrix4fv(gl.getUniformLocation(pT, 'P'), false, P); gl.uniformMatrix4fv(gl.getUniformLocation(pT, 'MV'), false, MV);
      gl.uniform1f(gl.getUniformLocation(pT, 'dt'), dt); gl.uniform3f(gl.getUniformLocation(pT, 'camE'), ...camE);
      gl.uniform2f(gl.getUniformLocation(pT, 'vp'), vp[0] / (dpr * 0.42), vp[1] / (dpr * 0.42));   // буквы подписи ≈ 13 css px
      const b0 = gl.getAttribLocation(pT, 'e0'), b1 = gl.getAttribLocation(pT, 'e1'), bq = gl.getAttribLocation(pT, 'q');
      gl.bindBuffer(gl.ARRAY_BUFFER, bT);
      gl.enableVertexAttribArray(b0); gl.vertexAttribPointer(b0, 4, gl.FLOAT, false, 48, 0);
      gl.enableVertexAttribArray(b1); gl.vertexAttribPointer(b1, 4, gl.FLOAT, false, 48, 16);
      gl.enableVertexAttribArray(bq); gl.vertexAttribPointer(bq, 4, gl.FLOAT, false, 48, 32);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tT); gl.uniform1i(gl.getUniformLocation(pT, 't'), 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bTi); gl.drawElements(gl.TRIANGLES, L.length * 6, gl.UNSIGNED_SHORT, 0);
      gl.disable(gl.BLEND); gl.depthMask(true);
      gl.disableVertexAttribArray(b0); gl.disableVertexAttribArray(b1); gl.disableVertexAttribArray(bq);
    }
  }
  // выбрать спутник k (−1 — снять выбор). У малых — модель «под лупой» вместо точки
  function select(k) {
    sel = k >= 0 && k < n ? k : -1; selM = null; selOrbitT = -1e18;
    if (sel >= 0 && !isCtx(sel) && pM) {
      const kind = list[sel].cube ? 'cube3' : 'micro';
      selM = { k: sel, kind, g: geo[kind] || null, scale: geo[kind] ? scaleOf(kind) : 0 };
    }
    tRef = 0;
  }
  // положения всех спутников в сцене на модельное время t (для выбора нажатием): [x, y, z] или null; r — радиус модели (R)
  function positions(t) {
    const dt = (t - tRef) / 1000, out = new Array(n);
    for (let k = 0; k < n; k++) {
      const p = scenePos(k, dt); if (!p) { out[k] = null; continue; }
      const m = M.find((q) => q.k === k) || (selM && selM.k === k ? selM : null);
      out[k] = { p, r: m && m.g ? m.g.ext * m.scale * 0.6 : 0 };
    }
    return out;
  }
  // перевести спутники (индексы в list) на SGP4: recs — satrec для каждого, prop — satellite.js propagate
  function useSGP(idx, recs, prop) { propagate = prop; idx.forEach((k, j) => sgp.set(k, recs[j])); tRef = 0; }
  return { draw, n, nCtx: ctx.length, opt, useSGP, get nSGP() { return sgp.size; }, models: M.map((m) => m.kind), get tris() { return tris; }, select, positions, get selected() { return sel; } };
}
