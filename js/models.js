// Модели известных спутников — собраны из простых тел в коде (ни одного файла загружать не надо).
// Оси модели: X — по направлению полёта, Z — вниз, к Земле (надир), Y = Z × X. Единица — метр, потом модель
// масштабируется под сцену. Две части: корпус (неподвижен) и крылья солнечных батарей — они поворачиваются вокруг
// оси Y модели (через начало координат), чтобы смотреть на Солнце, как настоящие.
//
// Вершина: положение (3), нормаль (3), цвет (3), блеск (1), сетка (2: номер ячейки по двум осям; < 0 — без сетки).

const C = {
  gold: [0.86, 0.66, 0.28], silver: [0.78, 0.79, 0.82], white: [0.9, 0.9, 0.88], dark: [0.22, 0.22, 0.24],
  cell: [0.1, 0.14, 0.34], grey: [0.55, 0.56, 0.58], black: [0.08, 0.08, 0.09],
};

function mesh() {
  const v = [], idx = [];
  const vert = (p, n, c, sh, g) => { v.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], sh, g[0], g[1]); return v.length / 12 - 1; };
  const quad = (a, b, c, d, n, col, sh, ga = [-1, -1], gb = ga, gc = ga, gd = ga) => {
    const i = vert(a, n, col, sh, ga); vert(b, n, col, sh, gb); vert(c, n, col, sh, gc); vert(d, n, col, sh, gd);
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  // коробка с центром c и размерами s; grid — [клеток по длинной стороне, по короткой] для больших граней (батареи)
  function box(c, s, col, sh = 0.1, grid = null) {
    const [x, y, z] = c, [a, b, h] = [s[0] / 2, s[1] / 2, s[2] / 2];
    const P = (i, j, k) => [x + i * a, y + j * b, z + k * h];
    const G = (u, w) => (grid ? [u, w] : [-1, -1]);
    // ±Z (большие грани у панелей): сетка по X и Y
    const gx = grid ? (s[0] >= s[1] ? grid[0] : grid[1]) : 0, gy = grid ? (s[0] >= s[1] ? grid[1] : grid[0]) : 0;
    quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), [0, 0, 1], col, sh, G(0, 0), G(gx, 0), G(gx, gy), G(0, gy));
    quad(P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1), P(-1, -1, -1), [0, 0, -1], col, sh, G(0, gy), G(gx, gy), G(gx, 0), G(0, 0));
    const ec = grid ? C.grey : col;   // торцы панелей — серые, без сетки
    quad(P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1), [1, 0, 0], ec, sh);
    quad(P(-1, 1, -1), P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), [-1, 0, 0], ec, sh);
    quad(P(1, 1, -1), P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), [0, 1, 0], ec, sh);
    quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), [0, -1, 0], ec, sh);
  }
  // цилиндр вдоль оси ax ('x'|'y'|'z'), центр c, радиус r, длина l
  function cyl(ax, c, r, l, col, sh = 0.3, seg = 16, caps = true) {
    const map = (u, w, t) => (ax === 'x' ? [t, u, w] : ax === 'y' ? [w, t, u] : [u, w, t]);
    const add = (p) => [p[0] + c[0], p[1] + c[1], p[2] + c[2]];
    for (let k = 0; k < seg; k++) {
      const a0 = k / seg * 2 * Math.PI, a1 = (k + 1) / seg * 2 * Math.PI;
      const u0 = Math.cos(a0), w0 = Math.sin(a0), u1 = Math.cos(a1), w1 = Math.sin(a1);
      const i = vert(add(map(r * u0, r * w0, -l / 2)), map(u0, w0, 0), col, sh, [-1, -1]);
      vert(add(map(r * u1, r * w1, -l / 2)), map(u1, w1, 0), col, sh, [-1, -1]);
      vert(add(map(r * u1, r * w1, l / 2)), map(u1, w1, 0), col, sh, [-1, -1]);
      vert(add(map(r * u0, r * w0, l / 2)), map(u0, w0, 0), col, sh, [-1, -1]);
      idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
      if (caps) for (const s of [-1, 1]) {
        const j = vert(add(map(0, 0, s * l / 2)), map(0, 0, s), col, sh, [-1, -1]);
        vert(add(map(r * u0, r * w0, s * l / 2)), map(0, 0, s), col, sh, [-1, -1]);
        vert(add(map(r * u1, r * w1, s * l / 2)), map(0, 0, s), col, sh, [-1, -1]);
        idx.push(j, j + 1, j + 2);
      }
    }
  }
  // тарелка антенны: неглубокий конус, раскрыв смотрит по dir (только ±Z или ±X), центр c, радиус r
  function dish(c, r, dir, col = C.white, seg = 16) {
    const depth = r * 0.35, s = Math.sign(dir[0] + dir[1] + dir[2]);
    const ax = dir[0] ? 'x' : dir[1] ? 'y' : 'z';
    const map = (u, w, t) => (ax === 'x' ? [t, u, w] : ax === 'y' ? [w, t, u] : [u, w, t]);
    const add = (p) => [p[0] + c[0], p[1] + c[1], p[2] + c[2]];
    const tip = add(map(0, 0, -s * depth));
    for (let k = 0; k < seg; k++) {
      const a0 = k / seg * 2 * Math.PI, a1 = (k + 1) / seg * 2 * Math.PI;
      for (const side of [1, -1]) {      // две стороны, чтобы было видно и изнутри
        const n0 = map(Math.cos(a0) * 0.35 * side, Math.sin(a0) * 0.35 * side, s * side), n1 = map(Math.cos(a1) * 0.35 * side, Math.sin(a1) * 0.35 * side, s * side);
        const i = vert(tip, map(0, 0, s * side), col, 0.4, [-1, -1]);
        vert(add(map(r * Math.cos(a0), r * Math.sin(a0), 0)), n0, col, 0.4, [-1, -1]);
        vert(add(map(r * Math.cos(a1), r * Math.sin(a1), 0)), n1, col, 0.4, [-1, -1]);
        idx.push(...(side > 0 ? [i, i + 1, i + 2] : [i, i + 2, i + 1]));
      }
    }
  }
  // солнечная батарея: тонкая пластина в плоскости XY с сеткой ячеек
  const panel = (c, sx, sy, cells) => box(c, [sx, sy, 0.12], C.cell, 0.6, cells);
  return { v, idx, box, cyl, dish, panel };
}

// --- модели ---
function iss(B, W) {
  B.box([0, 0, 0], [3, 100, 3], C.grey, 0.2);                      // ферма поперёк полёта
  B.cyl('x', [0, 0, 1.5], 2.1, 46, C.white, 0.3);                  // модули вдоль полёта
  B.cyl('y', [6, 0, 1.5], 2.2, 14, C.white, 0.3);                  // узел поперёк
  B.cyl('y', [-10, 0, 1.5], 2.0, 9, C.white, 0.3);
  B.cyl('z', [14, 0, 5], 1.6, 5, C.silver, 0.3);
  for (const y of [-16, 16]) B.box([0, y, -6], [11, 2, 12], C.white, 0.2);   // радиаторы вниз
  for (const y of [-42, -29.5, 29.5, 42]) for (const s of [-1, 1]) W.panel([s * 19.5, y, 0], 34, 11.5, [16, 5]);   // 8 крыльев
  for (const y of [-42, -29.5, 29.5, 42]) W.box([0, y, 0], [6, 1, 1], C.grey, 0.2);
}
function css(B, W) {
  B.cyl('x', [0, 0, 0], 2.1, 17, C.white, 0.3);                    // «Тяньхэ»
  B.cyl('x', [10, 0, 0], 1.4, 4, C.silver, 0.3);
  for (const s of [-1, 1]) B.cyl('y', [9, s * 10, 0], 2.1, 18, C.white, 0.3);   // «Вэньтянь», «Мэнтянь»
  for (const s of [-1, 1]) W.panel([9, s * 31, 0], 27, 4.2, [18, 3]);           // большие крылья на торцах лабораторий
  for (const s of [-1, 1]) W.panel([-6, s * 7, 0], 3, 10, [2, 6]);              // малые у базового блока
}
function hubble(B, W) {
  B.cyl('x', [0, 0, 0], 2.1, 13, C.silver, 0.6, 20);
  B.cyl('x', [7.2, 0, 0], 2.15, 1.4, C.black, 0.2, 20);            // открытая крышка трубы — тёмная
  B.box([8.2, 0, 2.4], [0.3, 4, 2.8], C.silver, 0.5);               // крышка-заслонка
  for (const s of [-1, 1]) W.panel([-1, s * 9, 0], 2.6, 12, [3, 12]);
  B.dish([-2, 0, -3.2], 0.8, [0, 0, -1]); B.dish([-2, 0, 3.2], 0.8, [0, 0, 1]);
}
function geoBox(B, W, o) {      // геостационарный метеоспутник: золотой корпус, крыло(я), приборы к Земле
  B.box([0, 0, 0], o.bus, C.gold, 0.5);
  B.box([0.5, 0, o.bus[2] / 2 + 0.6], [o.bus[0] * 0.6, o.bus[1] * 0.6, 1.2], C.white, 0.2);   // приборы
  if (o.dish) B.dish([-0.8, 0, o.bus[2] / 2 + 0.2], o.dish, [0, 0, 1]);
  const ny = o.panels, py = o.panelY || 2.6, px = o.panelX || 3;
  for (const s of o.wings) for (let k = 0; k < ny; k++) W.panel([0, s * (o.bus[1] / 2 + 1.2 + py / 2 + k * (py + 0.2)), 0], px, py, [4, 3]);
  for (const s of o.wings) W.box([0, s * (o.bus[1] / 2 + 0.6), 0], [0.3, 1.2, 0.3], C.grey, 0.2);
  if (o.boom) B.box([-o.bus[0] / 2 - o.boom / 2, 0, -1], [o.boom, 0.15, 0.15], C.grey, 0.2);
  if (o.shield) B.box([0, o.bus[1] / 2 + 0.05, 0], [o.bus[0] * 1.3, 0.1, o.bus[2] * 1.2], C.silver, 0.6);
}
function leoBox(B, W, o) {      // низкоорбитальный: вытянутый корпус, одно большое крыло, приборы к Земле
  B.box([0, 0, 0], o.bus, C.gold, 0.5);
  B.box([o.bus[0] * 0.2, 0, o.bus[2] / 2 + 0.4], [o.bus[0] * 0.5, o.bus[1] * 0.8, 0.8], C.white, 0.2);
  B.box([-o.bus[0] * 0.25, 0, o.bus[2] / 2 + 0.3], [o.bus[0] * 0.25, o.bus[1] * 0.5, 0.6], C.dark, 0.2);
  if (o.dish) B.dish([o.bus[0] / 2 - 0.6, o.bus[1] / 2 - 0.6, o.bus[2] / 2 + 0.1], o.dish, [0, 0, 1]);
  const w = o.wing;   // [длина, ширина]
  W.box([0, -(o.bus[1] / 2 + 0.6), 0], [0.3, 1.2, 0.3], C.grey, 0.2);
  W.panel([0, -(o.bus[1] / 2 + 1.2 + w[0] / 2), 0], w[1], w[0], [Math.round(w[1] * 1.5), Math.round(w[0] * 1.5)]);
}
const KINDS = {
  iss: [/(^|[^a-z])iss([^a-z]|$)|мкс|zarya/i, iss],
  css: [/(^|[^a-z])css([^a-z]|$)|тяньгун|tiangong|tianhe/i, css],
  hubble: [/(hubble|хаббл|hst)/i, hubble],
  goes: [/goes/i, (B, W) => geoBox(B, W, { bus: [3.4, 3, 4.4], wings: [-1], panels: 5, panelY: 2.4, panelX: 3.4, boom: 8, dish: 0.6 })],
  elektro: [/(электро|elektro)/i, (B, W) => geoBox(B, W, { bus: [2.8, 2.8, 3.6], wings: [-1, 1], panels: 3, panelY: 2.2, panelX: 2.4, dish: 1.0 })],
  meteosat: [/meteosat/i, (B, W) => geoBox(B, W, { bus: [3, 3, 4], wings: [-1], panels: 4, panelY: 2.5, panelX: 3, shield: true, dish: 0.5 })],
  himawari: [/(химавари|himawari)/i, (B, W) => geoBox(B, W, { bus: [2.6, 2.6, 3.2], wings: [-1], panels: 4, panelY: 2.2, panelX: 2.6, dish: 0.7 })],
  noaa: [/(noaa|jpss)/i, (B, W) => leoBox(B, W, { bus: [4.2, 1.8, 1.8], wing: [8, 1.8], dish: 0.5 })],
  fengyun3: [/(фэнъюнь|fengyun|fy-3)/i, (B, W) => leoBox(B, W, { bus: [4.4, 2, 2], wing: [9, 2.4], dish: 0.5 })],
  terra: [/terra/i, (B, W) => leoBox(B, W, { bus: [6.8, 3.5, 3.5], wing: [9, 5], dish: 0.8 })],
  aqua: [/aqua/i, (B, W) => leoBox(B, W, { bus: [4.8, 2.7, 2.7], wing: [12, 3.5], dish: 0.6 })],
};
export function modelKind(key, name) {
  for (const [k, [re]] of Object.entries(KINDS)) if (key === k || re.test(key || '') || re.test(name || '')) return k;
  return 'generic';
}
// построить модель; возвращает { body, wing, ext } — массивы вершин/индексов и наибольший размер (м)
export function buildModel(kind) {
  const B = mesh(), W = mesh();
  if (KINDS[kind]) KINDS[kind][1](B, W);
  else { B.box([0, 0, 0], [2, 2, 2], C.gold, 0.5); for (const s of [-1, 1]) W.panel([0, s * 3.2, 0], 1.8, 4, [3, 6]); }
  let ext = 0;
  for (const m of [B, W]) for (let i = 0; i < m.v.length; i += 12) ext = Math.max(ext, Math.hypot(m.v[i], m.v[i + 1], m.v[i + 2]));
  return { body: { v: new Float32Array(B.v), idx: new Uint16Array(B.idx) }, wing: { v: new Float32Array(W.v), idx: new Uint16Array(W.idx) }, ext };
}
