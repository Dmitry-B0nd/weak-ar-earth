// Точки интереса на Земле: космодромы, центры управления, станции дальней связи, другое. Рисуются значками на поверхности
// (вращаются вместе с Землёй), у горизонта плавно гаснут; по нажатию — карточка.
import { RS_GLSL, setRS } from './rshutter.js?v=0.27';

// Список точек и их виды — в data/poi.json (формат основного проекта: types + points; правится без кода, см.
// data/README.txt). Здесь — только рисование значков и положения для нажатия.
const VS = `#define LIFT 1.02
#define SIZE 0.09
attribute vec3 pe; attribute vec3 c; attribute float id;
uniform mat4 P; uniform mat4 MV; uniform vec2 rot; uniform vec3 camE; uniform float F; uniform vec2 pxr; uniform float sel;
varying vec3 col; varying float fade; varying float isSel;
${RS_GLSL}
void main(){
  vec3 p = vec3(pe.x * rot.x - pe.y * rot.y, pe.x * rot.y + pe.y * rot.x, pe.z);   // поворот Земли (звёздное время)
  fade = smoothstep(0.02, 0.22, dot(p, normalize(camE - p)));                    // у горизонта плавно гаснет
  isSel = abs(id - sel) < 0.5 ? 1.0 : 0.0;
  col = c;
  vec4 q = MV * vec4(p * LIFT, 1.0);                        // чуть над поверхностью
  gl_Position = fade <= 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : rsW(P * q);
  // размер — как у предмета на глобусе (SIZE радиуса Земли), в пределах pxr: с расстоянием меняется вместе с Землёй
  gl_PointSize = clamp(F * SIZE / q.z, pxr.x, pxr.y) * (isSel > 0.5 ? 2.2 : 1.0);
}`;
const FS = `precision mediump float; varying vec3 col; varying float fade; varying float isSel;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a; vec3 c;
  if (isSel > 0.5) {                                     // выбранная: значок + белое кольцо
    float ring = smoothstep(0.78, 0.84, r) * (1.0 - smoothstep(0.93, 1.0, r));
    float dot_ = 1.0 - smoothstep(0.36, 0.42, r);
    a = max(ring, dot_); c = ring > dot_ ? vec3(1.0) : (r > 0.3 ? vec3(0.05) : col);
  } else {
    a = 1.0 - smoothstep(0.86, 1.0, r); c = r > 0.62 ? vec3(0.05) : col;          // цветная середина, тёмная обводка
  }
  a *= fade; if (a < 0.01) discard;
  gl_FragColor = vec4(c * a, a);
}`;

function prog(gl, vs, fs) {
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p;
}
const hex = (h) => [1, 3, 5].map((i) => (parseInt(String(h).slice(i, i + 2), 16) || 255) / 255);
// единичный вектор точки в осях Земли (x — нулевой меридиан, z — север)
export const ecef = (lat, lon) => { const a = lat * Math.PI / 180, b = lon * Math.PI / 180; return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)]; };

export function createPlaces(gl, o = {}) {
  const opt = { minPx: 4, maxPx: 16, ...o };
  const pr = prog(gl, VS, FS), buf = gl.createBuffer();
  let points = [], types = {}, n = 0;
  // d — содержимое poi.json: { types: { вид: { label, color } }, points: [{ id, type, name, lat, lon, … }] }
  function setData(d) {
    types = (d && d.types) || {};
    points = ((d && d.points) || []).filter((q) => Number.isFinite(q.lat) && Number.isFinite(q.lon));
    n = points.length;
    const data = new Float32Array(n * 7);
    points.forEach((q, i) => data.set([...ecef(q.lat, q.lon), ...hex((types[q.type] || {}).color || '#ffffff'), i], i * 7));
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    sel = -1;
  }
  let sel = -1, visible = true;
  // P, MV (оси Земли без вращения → камера), spin — звёздное время (рад), camE — камера в осях Земли (радиусы)
  function draw(P, MV, spin, camE, dpr, rs, F) {
    if (!visible || !n) return;
    gl.useProgram(pr); setRS(gl, pr, rs);
    gl.uniformMatrix4fv(gl.getUniformLocation(pr, 'P'), false, P); gl.uniformMatrix4fv(gl.getUniformLocation(pr, 'MV'), false, MV);
    gl.uniform2f(gl.getUniformLocation(pr, 'rot'), Math.cos(spin), Math.sin(spin));
    gl.uniform3f(gl.getUniformLocation(pr, 'camE'), camE[0], camE[1], camE[2]);
    gl.uniform1f(gl.getUniformLocation(pr, 'F'), F * 0.45); gl.uniform2f(gl.getUniformLocation(pr, 'pxr'), opt.minPx * dpr, opt.maxPx * dpr);
    gl.uniform1f(gl.getUniformLocation(pr, 'sel'), sel);
    const a = gl.getAttribLocation(pr, 'pe'), c = gl.getAttribLocation(pr, 'c'), d = gl.getAttribLocation(pr, 'id');
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(c); gl.vertexAttribPointer(c, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(d); gl.vertexAttribPointer(d, 1, gl.FLOAT, false, 28, 24);
    // без проверки глубины: за горизонтом точки гаснут сами, а Земля не срезает значок у края диска
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
    [a, c, d].forEach((x) => gl.disableVertexAttribArray(x));
  }
  // положения в осях Земли без вращения (как у спутников) на звёздное время spin; vis — насколько видна (0…1)
  function positions(spin, camE) {
    const cs = Math.cos(spin), sn = Math.sin(spin);
    return points.map((q) => {
      const e = ecef(q.lat, q.lon), p = [e[0] * cs - e[1] * sn, e[0] * sn + e[1] * cs, e[2]];
      const v = [camE[0] - p[0], camE[1] - p[1], camE[2] - p[2]], l = Math.hypot(...v);
      const dd = (p[0] * v[0] + p[1] * v[1] + p[2] * v[2]) / l, vis = Math.min(1, Math.max(0, (dd - 0.02) / 0.2));
      return { p: p.map((x) => x * 1.02), vis };
    });
  }
  return { draw, positions, setData, select(i) { sel = i; }, get selected() { return sel; }, get n() { return n; }, get points() { return points; }, get types() { return types; }, get visible() { return visible; }, set visible(v) { visible = !!v; } };
}
