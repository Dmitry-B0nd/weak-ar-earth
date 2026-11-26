// Модели известных спутников — собраны в коде из простых тел (ни одного файла загружать не надо).
// Оси модели: X — по направлению полёта, Z — вниз, к Земле (надир), Y = Z × X. Единица — метр, потом модель
// масштабируется под сцену. Две части: корпус (неподвижен) и крылья солнечных батарей — они поворачиваются вокруг
// оси Y модели (через начало координат), чтобы смотреть на Солнце, как настоящие.
//
// Вершина (12 чисел): положение (3), нормаль (3), цвет (3), блеск (1), материал (2):
//   g.x ≥ 0 — солнечные ячейки (g — номер ячейки по двум осям, шейдер рисует сетку);
//   g.x = −2 — золотая/серебряная плёнка-теплоизоляция (шейдер морщит её шумом); −1 — обычная поверхность.

const C = {
  gold: [0.85, 0.63, 0.24], silver: [0.8, 0.81, 0.84], white: [0.9, 0.9, 0.88], dark: [0.2, 0.2, 0.22],
  cell: [0.07, 0.12, 0.33], grey: [0.52, 0.53, 0.55], black: [0.06, 0.06, 0.07], back: [0.46, 0.38, 0.3],
  rad: [0.94, 0.94, 0.92], copper: [0.75, 0.45, 0.25], blue: [0.25, 0.35, 0.6],
};
const FOIL = [-2, -2], PLAIN = [-1, -1];

function mesh() {
  const v = [], idx = [];
  const vert = (p, n, c, sh, g) => { v.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], sh, g[0], g[1]); return v.length / 12 - 1; };
  const quad = (a, b, c, d, n, col, sh, ga = PLAIN, gb = ga, gc = ga, gd = ga) => {
    const i = vert(a, n, col, sh, ga); vert(b, n, col, sh, gb); vert(c, n, col, sh, gc); vert(d, n, col, sh, gd);
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  const T = (m) => (m === 'foil' ? FOIL : PLAIN);
  // коробка: центр c, размеры s, цвет; mat: 'foil' — плёнка
  function box(c, s, col, sh = 0.1, mat = null) {
    const [x, y, z] = c, [a, b, h] = [s[0] / 2, s[1] / 2, s[2] / 2], g = T(mat);
    const P = (i, j, k) => [x + i * a, y + j * b, z + k * h];
    quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), [0, 0, 1], col, sh, g);
    quad(P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1), P(-1, -1, -1), [0, 0, -1], col, sh, g);
    quad(P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1), [1, 0, 0], col, sh, g);
    quad(P(-1, 1, -1), P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), [-1, 0, 0], col, sh, g);
    quad(P(1, 1, -1), P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), [0, 1, 0], col, sh, g);
    quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), [0, -1, 0], col, sh, g);
  }
  // тело вращения вдоль оси ax: профиль — пары [t (вдоль оси), r]; центр c
  function lathe(ax, c, prof, col, sh = 0.3, seg = 20, mat = null, caps = true) {
    const map = (u, w, t) => (ax === 'x' ? [t, u, w] : ax === 'y' ? [w, t, u] : [u, w, t]);
    const add = (p) => [p[0] + c[0], p[1] + c[1], p[2] + c[2]], g = T(mat);
    for (let j = 0; j + 1 < prof.length; j++) {
      const [t0, r0] = prof[j], [t1, r1] = prof[j + 1], dl = Math.hypot(t1 - t0, r1 - r0) || 1, nt = -(r1 - r0) / dl, nr = (t1 - t0) / dl;
      for (let k = 0; k < seg; k++) {
        const a0 = k / seg * 2 * Math.PI, a1 = (k + 1) / seg * 2 * Math.PI, u0 = Math.cos(a0), w0 = Math.sin(a0), u1 = Math.cos(a1), w1 = Math.sin(a1);
        const i = vert(add(map(r0 * u0, r0 * w0, t0)), map(nr * u0, nr * w0, nt), col, sh, g);
        vert(add(map(r0 * u1, r0 * w1, t0)), map(nr * u1, nr * w1, nt), col, sh, g);
        vert(add(map(r1 * u1, r1 * w1, t1)), map(nr * u1, nr * w1, nt), col, sh, g);
        vert(add(map(r1 * u0, r1 * w0, t1)), map(nr * u0, nr * w0, nt), col, sh, g);
        idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
      }
    }
    if (caps) for (const [j, s] of [[0, -1], [prof.length - 1, 1]]) {
      const [t, r] = prof[j]; if (r <= 0) continue;
      for (let k = 0; k < seg; k++) {
        const a0 = k / seg * 2 * Math.PI, a1 = (k + 1) / seg * 2 * Math.PI;
        const i = vert(add(map(0, 0, t)), map(0, 0, s), col, sh, g);
        vert(add(map(r * Math.cos(a0), r * Math.sin(a0), t)), map(0, 0, s), col, sh, g);
        vert(add(map(r * Math.cos(a1), r * Math.sin(a1), t)), map(0, 0, s), col, sh, g);
        idx.push(...(s > 0 ? [i, i + 1, i + 2] : [i, i + 2, i + 1]));
      }
    }
  }
  const cyl = (ax, c, r, l, col, sh = 0.3, seg = 20, mat = null) => lathe(ax, c, [[-l / 2, r], [l / 2, r]], col, sh, seg, mat);
  // модуль станции: цилиндр с поясами-рёбрами и скруглёнными торцами
  function module(ax, c, r, l, col = C.white, rings = 3) {
    const prof = [[-l / 2, r * 0.55], [-l / 2 + r * 0.25, r * 0.92], [-l / 2 + r * 0.45, r]];
    for (let k = 1; k <= rings; k++) { const t = -l / 2 + r * 0.45 + (l - r * 0.9) * k / (rings + 1); prof.push([t - 0.15, r], [t - 0.1, r * 1.04], [t + 0.1, r * 1.04], [t + 0.15, r]); }
    prof.push([l / 2 - r * 0.45, r], [l / 2 - r * 0.25, r * 0.92], [l / 2, r * 0.55]);
    lathe(ax, c, prof, col, 0.35, 20);
  }
  function sphere(c, r, col, sh = 0.4, seg = 14) {
    for (let j = 0; j < seg / 2; j++) for (let k = 0; k < seg; k++) {
      const P = (jj, kk) => { const th = jj / (seg / 2) * Math.PI, ph = kk / seg * 2 * Math.PI; return [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]; };
      const q = [P(j, k), P(j, k + 1), P(j + 1, k + 1), P(j + 1, k)];
      const i = vert(q[0].map((v, m) => c[m] + v * r), q[0], col, sh, PLAIN);
      for (let m = 1; m < 4; m++) vert(q[m].map((v, mm) => c[mm] + v * r), q[m], col, sh, PLAIN);
      idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
    }
  }
  // тарелка антенны (раскрыв по dir: ±x, ±y, ±z), с облучателем на ножке
  function dish(c, r, dir, col = C.white, seg = 18) {
    const s = Math.sign(dir[0] + dir[1] + dir[2]), ax = dir[0] ? 'x' : dir[1] ? 'y' : 'z';
    lathe(ax, c, [[-s * r * 0.35, 0.001], [-s * r * 0.25, r * 0.55], [-s * r * 0.1, r * 0.85], [0, r]], col, 0.4, seg, null, false);
    lathe(ax, c, [[0, r], [-s * r * 0.1, r * 0.85], [-s * r * 0.25, r * 0.55], [-s * r * 0.35, 0.001]], C.grey, 0.2, seg, null, false);   // обратная сторона
    const off = (t) => (ax === 'x' ? [c[0] + t, c[1], c[2]] : ax === 'y' ? [c[0], c[1] + t, c[2]] : [c[0], c[1], c[2] + t]);
    cyl(ax, off(s * r * 0.3), r * 0.03, r * 0.6, C.grey, 0.2, 6);
    cyl(ax, off(s * r * 0.62), r * 0.09, r * 0.12, C.dark, 0.2, 8);
  }
  // солнечная батарея в плоскости XY: лицевая сторона (+Z; крылья поворачиваются так, что +Z смотрит на Солнце) — ячейки с сеткой, обратная — светлая, рамка
  function panel(c, sx, sy, cells) {
    const [x, y, z] = c, a = sx / 2, b = sy / 2, h = 0.06;
    const [gx, gy] = sx >= sy ? cells : [cells[1], cells[0]];
    quad([x - a, y - b, z + h], [x + a, y - b, z + h], [x + a, y + b, z + h], [x - a, y + b, z + h], [0, 0, 1], C.cell, 0.7, [0, 0], [gx, 0], [gx, gy], [0, gy]);
    quad([x - a, y + b, z - h], [x + a, y + b, z - h], [x + a, y - b, z - h], [x - a, y - b, z - h], [0, 0, -1], C.back, 0.25, [0, gy], [gx, gy], [gx, 0], [0, 0]);   // изнанка — плёнка-основа
    // рамка
    const f = Math.min(sx, sy) * 0.03 + 0.05;
    box([x, y - b, z], [sx + f, f, h * 3], C.grey, 0.3); box([x, y + b, z], [sx + f, f, h * 3], C.grey, 0.3);
    box([x - a, y, z], [f, sy, h * 3], C.grey, 0.3); box([x + a, y, z], [f, sy, h * 3], C.grey, 0.3);
  }
  // крыло из нескольких панелей вдоль ±Y (sgn) от точки y0, с ярмом-штангой
  function wing(sgn, y0, n, px, py, cells, gap = 0.25, z = 0) {
    box([0, sgn * (y0 + 0.6), z], [0.25, 1.2, 0.25], C.grey, 0.3);
    for (let k = 0; k < n; k++) panel([0, sgn * (y0 + 1.2 + py / 2 + k * (py + gap)), z], px, py, cells);
  }
  // ферма-решётка вдоль Y длиной L, сечение w×w
  function truss(c, L, w, col = C.grey) {
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box([c[0] + i * w / 2, c[1], c[2] + j * w / 2], [0.25, L, 0.25], col, 0.3);
    const n = Math.round(L / w);
    for (let k = 0; k <= n; k++) {
      const y = c[1] - L / 2 + k * L / n;
      box([c[0], y, c[2] - w / 2], [w, 0.18, 0.18], col, 0.3); box([c[0], y, c[2] + w / 2], [w, 0.18, 0.18], col, 0.3);
      box([c[0] - w / 2, y, c[2]], [0.18, 0.18, w], col, 0.3); box([c[0] + w / 2, y, c[2]], [0.18, 0.18, w], col, 0.3);
    }
  }
  // радиатор: белая пластина с рёбрами
  function radiator(c, sx, sz, ribs = 6) {
    box(c, [sx, 0.12, sz], C.rad, 0.15);
    for (let k = 1; k < ribs; k++) box([c[0] - sx / 2 + sx * k / ribs, c[1], c[2]], [0.08, 0.2, sz], C.grey, 0.2);
  }
  return { v, idx, box, cyl, lathe, module, sphere, dish, panel, wing, truss, radiator };
}

// ---------- модели ----------
function iss(B, W) {
  // ферма поперёк полёта — на оси поворота крыльев (Y через начало координат); модули ниже, к Земле
  B.truss([0, 0, 0], 98, 3);
  B.box([0, 0, 0], [2.2, 98, 2.2], C.dark, 0.2);
  const z = 3.8;
  B.module('x', [-24, 0, z], 2.1, 13, C.white, 3);                    // «Звезда»
  B.module('x', [-11.5, 0, z], 2.05, 12.6, C.white, 3);               // «Заря»
  B.module('x', [-3, 0, z], 2.25, 5.5, C.white, 1);                   // Unity
  B.module('x', [5.5, 0, z], 2.2, 8.5, C.white, 2);                   // Destiny
  B.module('x', [13.5, 0, z], 2.2, 7, C.white, 1);                    // Harmony
  B.module('y', [13.5, 6.2, z], 2.2, 7, C.white, 2);                  // Columbus
  B.module('y', [13.5, -8, z], 2.2, 11, C.white, 3);                  // Kibo
  B.box([13.5, -16, z], [5, 5, 1.2], C.grey, 0.2);                    // открытая платформа Kibo
  B.module('z', [-3, 0, z + 4.4], 2.2, 6.7, C.white, 1);              // Tranquility к Земле
  B.sphere([-3, 0, z + 8], 1.4, C.silver);                            // Cupola
  B.module('z', [-24, 0, z + 4.2], 1.3, 4, C.white, 1);               // «Союз»
  B.module('x', [-33, 0, z], 1.3, 5.5, C.white, 1);                   // «Прогресс» сзади
  for (const sg of [-1, 1]) B.panel([-24, sg * 9, z], 3, 10.5, [3, 10]);   // крылья «Звезды» (неподвижные)
  for (const sg of [-1, 1]) B.panel([-11.5, sg * 8, z], 3, 8, [3, 8]);     // крылья «Зари»
  for (const sg of [-1, 1]) for (const y of [14.5, 18.5, 22.5]) B.radiator([0, sg * y, -6.8], 3, 12, 6);   // радиаторы вверх
  for (const sg of [-1, 1]) B.radiator([4, sg * 3, -3.8], 2.5, 6, 4);
  // 8 крыльев: у каждого мачта по середине и два полотна
  for (const y of [-42, -30, 30, 42]) {
    W.box([0, y, 0], [3.6, 3.6, 3.6], C.grey, 0.3);                  // поворотный узел
    for (const sg of [-1, 1]) {
      W.box([sg * 18.5, y, 0], [33, 0.35, 0.35], C.grey, 0.3);        // мачта
      for (const d of [-1, 1]) W.panel([sg * 19, y + d * 2.9, 0], 32, 4.6, [24, 4]);
    }
  }
}
function css(B, W) {
  B.sphere([0, 0, 0], 1.6, C.white);                                  // узловой отсек — на оси поворота крыльев
  B.module('x', [-7, 0, 0], 2.1, 10, C.white, 3);                     // «Тяньхэ»
  B.lathe('x', [-14, 0, 0], [[-1.5, 1.4], [1.5, 2.1]], C.white, 0.3);
  B.module('x', [5.5, 0, 0], 1.3, 6, C.white, 1);                     // «Шэньчжоу»
  for (const sg of [-1, 1]) B.module('y', [0, sg * 10.5, 0], 2.1, 17, C.white, 4);   // «Вэньтянь», «Мэнтянь»
  for (const sg of [-1, 1]) B.radiator([0, sg * 12, -3], 6, 3, 5);
  for (const sg of [-1, 1]) B.panel([-9, sg * 6, 0], 3, 7, [3, 7]);   // малые у базового блока
  for (const sg of [-1, 1]) {                                         // большие крылья на торцах лабораторий
    W.box([0, sg * 19.5, 0], [1.2, 1.2, 1.2], C.grey, 0.3);
    for (const d of [-1, 1]) { W.box([d * 14, sg * 19.5, 0], [27, 0.3, 0.3], C.grey, 0.3); W.panel([d * 14.5, sg * 19.5 + 2.2, 0], 26, 3.6, [24, 3]); W.panel([d * 14.5, sg * 19.5 - 2.2, 0], 26, 3.6, [24, 3]); }
  }
}
function hubble(B, W) {
  B.lathe('x', [0, 0, 0], [[-6.5, 2.2], [-2, 2.2], [-1.9, 2.1], [6, 2.1], [6.6, 2.15], [7.1, 2.1]], C.silver, 0.7, 28, 'foil');
  B.cyl('x', [7.15, 0, 0], 1.6, 0.1, C.black, 0.1, 24);               // зрачок трубы
  B.box([7.3, 0, 2.6], [0.25, 3.8, 2.8], C.silver, 0.6, 'foil');      // крышка-заслонка (открыта)
  for (let k = 0; k < 6; k++) B.box([-4 + k * 1.6, 0, 0], [0.12, 4.5, 4.5], C.grey, 0.3);   // пояса-поручни
  for (const s of [-1, 1]) {
    B.box([-1, s * 2.4, 0], [0.4, 0.6, 0.4], C.grey, 0.3);
    B.box([-1, s * 2.4, s * 2.4], [0.15, 0.15, 4], C.grey, 0.3);      // штанги антенн
    B.dish([-1, s * 2.4, s * 4.4], 0.65, [0, 0, s]);
  }
  for (const s of [-1, 1]) { W.box([0, s * 3, 0], [0.3, 2, 0.3], C.grey, 0.3); W.panel([0, s * 9.6, 0], 2.5, 12, [4, 20]); }
}
// геостационарный метеоспутник
function geo(B, W, o) {
  const [bx, by, bz] = o.bus;
  B.box([0, 0, 0], o.bus, C.gold, 0.6, 'foil');
  for (const s of [-1, 1]) B.radiator([0, s * (by / 2 + 0.07), 0], bx * 0.8, bz * 0.8, 6);   // радиаторы на бортах
  // главный прибор к Земле с бленд
  B.box([bx * 0.15, 0, bz / 2 + 0.6], [bx * 0.55, by * 0.55, 1.2], C.white, 0.2);
  B.lathe('z', [bx * 0.15, 0, bz / 2 + 1.2], [[0, 0.55], [0.8, 0.75]], C.black, 0.1, 16, null, false);
  B.box([-bx * 0.3, by * 0.25, bz / 2 + 0.35], [0.7, 0.7, 0.7], C.silver, 0.5, 'foil');
  if (o.dish) B.dish([-bx * 0.25, -by * 0.2, bz / 2 + 0.15], o.dish, [0, 0, 1]);
  for (const s of [-1, 1]) B.lathe('x', [-bx / 2 - 0.1, s * by * 0.3, -bz * 0.3], [[0, 0.12], [0.4, 0.25]], C.dark, 0.3, 8);   // двигатели
  B.box([bx * 0.3, -by * 0.3, -bz / 2 - 0.25], [0.4, 0.4, 0.5], C.dark, 0.2);   // звёздные датчики
  for (const s of o.wings) W.wing(s, by / 2, o.panels, o.px, o.py, [6, 4]);
  if (o.boom) { B.box([-bx / 2 - o.boom / 2, 0, -bz / 2], [o.boom, 0.12, 0.12], C.grey, 0.3); B.box([-bx / 2 - o.boom, 0, -bz / 2], [0.4, 0.3, 0.3], C.white, 0.2); }
  if (o.shield) B.box([bx * 0.15, by / 2 + 0.5, bz / 2 + 0.6], [bx * 1.1, 0.08, 2.4], C.silver, 0.6, 'foil');
  if (o.yokeInst) W.box([0, -(by / 2 + 1.1), -0.6], [1, 1, 0.8], C.white, 0.2);   // приборы Солнца на ярме (GOES)
}
// низкоорбитальный: вытянутый корпус, одно крыло, приборы к Земле
function leo(B, W, o) {
  const [bx, by, bz] = o.bus;
  B.box([0, 0, 0], o.bus, C.gold, 0.6, 'foil');
  B.box([0, 0, -bz / 2 - 0.05], [bx * 0.9, by * 0.9, 0.1], C.rad, 0.15);              // радиатор к космосу
  for (const [i, inst] of o.inst.entries()) {
    const [kind, x, y, s] = inst;
    if (kind === 'box') B.box([x * bx, y * by, bz / 2 + s[2] / 2], s, i % 2 ? C.white : C.silver, 0.3, i % 2 ? null : 'foil');
    if (kind === 'drum') { B.cyl('y', [x * bx, y * by, bz / 2 + s], s, s * 1.2, C.silver, 0.4, 16, 'foil'); }
    if (kind === 'scan') { B.box([x * bx, y * by, bz / 2 + 0.45], [1.4, 1.1, 0.9], C.white, 0.2); B.cyl('y', [x * bx, y * by, bz / 2 + 1], 0.45, 1.1, C.dark, 0.3, 14); }
    if (kind === 'dish') B.dish([x * bx, y * by, bz / 2 + 0.2], s, [0, 0, 1]);
  }
  for (const s of [-1, 1]) B.box([bx / 2 + 0.2, s * by * 0.3, 0], [0.4, 0.3, 0.3], C.dark, 0.2);   // датчики
  B.box([-bx / 2 - 0.4, 0, 0.2], [0.8, 0.12, 0.12], C.grey, 0.3); B.dish([-bx / 2 - 0.9, 0, 0.2], 0.45, [0, 0, 1]);
  W.box([0, -(by / 2 + 0.9), 0], [0.25, 1.8, 0.25], C.grey, 0.3);                     // штанга крыла
  const [L, Wd, n] = o.wing;
  for (let k = 0; k < n; k++) W.panel([0, -(by / 2 + 1.9 + (L / n) / 2 + k * (L / n + 0.15)), 0], Wd, L / n, [Math.round(Wd * 3), Math.round(L / n * 3)]);
}
const KINDS = {
  iss: [/(^|[^a-z])iss([^a-z]|$)|мкс|zarya/i, iss],
  css: [/(^|[^a-z])css([^a-z]|$)|тяньгун|tiangong|tianhe/i, css],
  hubble: [/(hubble|хаббл|hst)/i, hubble],
  goes: [/goes/i, (B, W) => geo(B, W, { bus: [3.6, 3, 4.4], wings: [-1], panels: 5, px: 3.6, py: 2.4, boom: 8, dish: 0.7, yokeInst: true })],
  elektro: [/(электро|elektro)/i, (B, W) => geo(B, W, { bus: [2.8, 2.8, 3.6], wings: [-1, 1], panels: 3, px: 2.6, py: 2.2, dish: 1.1 })],
  meteosat: [/meteosat/i, (B, W) => geo(B, W, { bus: [3, 3, 4.2], wings: [-1], panels: 4, px: 3, py: 2.5, shield: true, dish: 0.6 })],
  himawari: [/(химавари|himawari)/i, (B, W) => geo(B, W, { bus: [2.6, 2.6, 3.2], wings: [-1], panels: 4, px: 2.6, py: 2.2, dish: 0.8 })],
  noaa: [/(noaa|jpss)/i, (B, W) => leo(B, W, { bus: [4.4, 1.9, 1.9], wing: [8, 1.9, 4], inst: [['scan', 0.25, 0, 0], ['drum', -0.15, 0.25, 0.45], ['box', -0.2, -0.25, [1, 0.7, 0.8]], ['dish', -0.42, 0.3, 0.35]] })],
  fengyun3: [/(фэнъюнь|fengyun|fy-3)/i, (B, W) => leo(B, W, { bus: [4.4, 2, 2], wing: [9, 2.4, 4], inst: [['scan', 0.2, 0.1, 0], ['box', -0.2, 0.2, [1.2, 0.7, 0.7]], ['drum', -0.1, -0.25, 0.4], ['dish', -0.4, -0.2, 0.4]] })],
  terra: [/terra/i, (B, W) => leo(B, W, { bus: [6.8, 3.5, 3.5], wing: [9, 5, 3], inst: [['box', 0.3, 0.25, [1.6, 1.2, 1.2]], ['scan', 0.05, -0.2, 0], ['box', -0.2, 0.2, [1.4, 1.4, 1.5]], ['box', -0.35, -0.25, [1, 1, 0.8]], ['dish', 0.4, -0.3, 0.6]] })],
  aqua: [/aqua/i, (B, W) => leo(B, W, { bus: [4.8, 2.7, 2.7], wing: [12, 3.5, 4], inst: [['dish', 0.25, 0, 0.8], ['scan', -0.1, 0.2, 0], ['drum', -0.25, -0.25, 0.45], ['box', 0.0, -0.3, [0.9, 0.8, 0.7]]] })],
};
export function modelKind(key, name) {
  for (const [k, [re]] of Object.entries(KINDS)) if (key === k || re.test(key || '') || re.test(name || '')) return k;
  return 'generic';
}
// построить модель; возвращает { body, wing, ext } — массивы вершин/индексов и наибольший размер (м)
export function buildModel(kind) {
  const B = mesh(), W = mesh();
  if (KINDS[kind]) KINDS[kind][1](B, W);
  else { B.box([0, 0, 0], [2, 2, 2], C.gold, 0.6, 'foil'); for (const s of [-1, 1]) W.wing(s, 1, 2, 1.8, 2, [3, 4]); }
  let ext = 0;
  for (const m of [B, W]) for (let i = 0; i < m.v.length; i += 12) ext = Math.max(ext, Math.hypot(m.v[i], m.v[i + 1], m.v[i + 2]));
  if (B.v.length / 12 > 65535 || W.v.length / 12 > 65535) throw new Error(`модель ${kind}: слишком много вершин`);
  return { body: { v: new Float32Array(B.v), idx: new Uint16Array(B.idx) }, wing: { v: new Float32Array(W.v), idx: new Uint16Array(W.idx) }, ext };
}
