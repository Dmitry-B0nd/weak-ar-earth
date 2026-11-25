// Лист 3×3 меток AprilTag 16h5 (id 0–8). Координаты листа — доли ширины поля (0…1), y вниз.
// Поле 180 мм; метка 0,28 поля (6×6 клеток: чёрная рамка + 4×4 бита), промежуток 0,08.
export const BOARD = {
  cols: 3, rows: 3, s: 0.28, g: 0.08,
  // «1» — белая клетка; биты по строкам (как в reference/tools/apriltag16h5-codes.json)
  codes: ['0010001100011011', '0010111010100101', '0011010001101010', '0100010110111001', '0111100110100110',
    '0111111101101011', '1011001101011000', '1110011101000101', '1111111001011001'],
};
export const NTAG = 9;
export const CELL = BOARD.s / 6;

export function tagOrigin(id) { const c = id % 3, r = (id / 3) | 0; return [c * (BOARD.s + BOARD.g), r * (BOARD.s + BOARD.g)]; }
export function tagCorners(id) { const [x, y] = tagOrigin(id), s = BOARD.s; return [[x, y], [x + s, y], [x + s, y + s], [x, y + s]]; }

// цвет клетки (i, j) метки id: 0 — чёрная, 1 — белая; за пределами 6×6 — белая (бумага)
export function cellOf(id, i, j) {
  if (i < 0 || j < 0 || i > 5 || j > 5) return 1;
  if (i === 0 || j === 0 || i === 5 || j === 5) return 0;
  return BOARD.codes[id][(j - 1) * 4 + (i - 1)] === '1' ? 1 : 0;
}
// цвет точки листа: 0 — чёрное, 1 — белое (поле и бумага вокруг)
export function colorAt(bx, by) {
  const p = BOARD.s + BOARD.g;
  const c = Math.floor(bx / p), r = Math.floor(by / p);
  if (c < 0 || r < 0 || c > 2 || r > 2) return 1;
  const lx = bx - c * p, ly = by - r * p;
  if (lx >= BOARD.s || ly >= BOARD.s) return 1;
  return cellOf(r * 3 + c, Math.floor(lx / CELL), Math.floor(ly / CELL));
}

// Края листа для слежения: точки на границах «чёрное — белое» с нормалью от чёрного к белому.
// Каждая единичная граница клетки даёт две точки (на 0,3 и 0,7 длины — подальше от углов клеток).
// Поля точки: bx, by — на листе; nx, ny — нормаль (к белому); tag — метка; outer — край метки (рамка снаружи).
export function buildEdges() {
  const out = [];
  for (let id = 0; id < NTAG; id++) {
    const [x0, y0] = tagOrigin(id);
    for (let j = -1; j <= 5; j++) for (let i = -1; i <= 5; i++) {
      const a = cellOf(id, i, j);
      // граница справа от клетки (i, j): между (i, j) и (i + 1, j)
      if (j >= 0) {
        const b = cellOf(id, i + 1, j);
        if (a !== b) {
          const ex = x0 + (i + 1) * CELL, nx = a === 1 ? -1 : 1;      // нормаль к белому
          const outer = i === -1 || i === 5;
          for (const s of [0.3, 0.7]) out.push({ bx: ex, by: y0 + (j + s) * CELL, nx, ny: 0, tag: id, outer });
        }
      }
      // граница снизу от клетки (i, j): между (i, j) и (i, j + 1)
      if (i >= 0) {
        const b = cellOf(id, i, j + 1);
        if (a !== b) {
          const ey = y0 + (j + 1) * CELL, ny = a === 1 ? -1 : 1;
          const outer = j === -1 || j === 5;
          for (const s of [0.3, 0.7]) out.push({ bx: x0 + (i + s) * CELL, by: ey, nx: 0, ny, tag: id, outer });
        }
      }
    }
  }
  return out;
}
