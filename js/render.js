// Рисование на WebGL 1 без библиотек: кадр камеры во весь экран (с обрезкой как object-fit: cover)
// и сцена на листе: «Земля» (сфера с сеткой параллелей и меридианов) и рамка по краю листа.
// Оси листа: x вправо, y вниз, z в лист; Земля — радиус 0,45, центр на 0,55 над центром листа.

const VS_BG = `attribute vec2 p; uniform vec4 uv; varying vec2 t;
void main(){ t = uv.xy + (p * 0.5 + 0.5) * uv.zw; t.y = 1.0 - t.y; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS_BG = `precision mediump float; varying vec2 t; uniform sampler2D tex; void main(){ gl_FragColor = texture2D(tex, t); }`;
const VS_M = `attribute vec3 p; attribute vec3 n; uniform mat4 P; uniform mat4 M; varying vec3 vn; varying vec3 on;
void main(){ vn = mat3(M) * n; on = n; gl_Position = P * M * vec4(p, 1.0); }`;
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

export function createRenderer(canvas, o = {}) {
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
    gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(pM);
    gl.uniformMatrix4fv(gl.getUniformLocation(pM, 'P'), false, P);
    gl.uniformMatrix4fv(gl.getUniformLocation(pM, 'M'), false, M);
    const lp = gl.getAttribLocation(pM, 'p'), ln = gl.getAttribLocation(pM, 'n');
    const drawMesh = (m, col, grid) => {
      gl.uniform4f(gl.getUniformLocation(pM, 'col'), ...col); gl.uniform1f(gl.getUniformLocation(pM, 'grid'), grid);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.p); gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.n); gl.enableVertexAttribArray(ln); gl.vertexAttribPointer(ln, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.i); gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
    };
    drawMesh(frame, [1.0, 0.8, 0.1, 1], 0);
    drawMesh(earth, [0.15, 0.4, 0.8, 1], 1);
    gl.disableVertexAttribArray(lp); gl.disableVertexAttribArray(ln);
  }
  return { gl, upload, draw, ring, setDpr(d) { dpr = d; } };
}
