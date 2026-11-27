import { ecef } from './places.js?v=0.27';
import { gmst, sunECI } from './orbit.js?v=0.27';
// Выбор спутника или точки на Земле нажатием и карточка снизу (обычный HTML поверх сцены — текст чёткий, видеокарте ничего не стоит).
// Нажатие ищет спутник по тому кадру, что сейчас на экране (render.pick); живые сведения — SGP4 для одного спутника
// 3 раза в секунду по времени сцены.

const COUNTRY = {
  US: 'США', RU: 'Россия', CN: 'Китай', JP: 'Япония', DE: 'Германия', FR: 'Франция', GB: 'Великобритания', UK: 'Великобритания',
  IT: 'Италия', ES: 'Испания', IN: 'Индия', KR: 'Южная Корея', BR: 'Бразилия', CA: 'Канада', AU: 'Австралия', NL: 'Нидерланды',
  BE: 'Бельгия', CH: 'Швейцария', AT: 'Австрия', PL: 'Польша', CZ: 'Чехия', SK: 'Словакия', HU: 'Венгрия', FI: 'Финляндия',
  SE: 'Швеция', NO: 'Норвегия', DK: 'Дания', EE: 'Эстония', LT: 'Литва', LV: 'Латвия', UA: 'Украина', BY: 'Беларусь', KZ: 'Казахстан',
  TR: 'Турция', IL: 'Израиль', AE: 'ОАЭ', SA: 'Саудовская Аравия', EG: 'Египет', ZA: 'ЮАР', NG: 'Нигерия', KE: 'Кения',
  MX: 'Мексика', AR: 'Аргентина', CL: 'Чили', PE: 'Перу', CO: 'Колумбия', EC: 'Эквадор', UY: 'Уругвай', BO: 'Боливия',
  SG: 'Сингапур', MY: 'Малайзия', ID: 'Индонезия', TH: 'Таиланд', VN: 'Вьетнам', PH: 'Филиппины', TW: 'Тайвань', PK: 'Пакистан',
  BD: 'Бангладеш', NP: 'Непал', LK: 'Шри-Ланка', MN: 'Монголия', NZ: 'Новая Зеландия', PT: 'Португалия', GR: 'Греция', RO: 'Румыния',
  BG: 'Болгария', SI: 'Словения', HR: 'Хорватия', RS: 'Сербия', LU: 'Люксембург', IE: 'Ирландия', IS: 'Исландия', GT: 'Гватемала',
  CR: 'Коста-Рика', PY: 'Парагвай', JO: 'Иордания', QA: 'Катар', KW: 'Кувейт', BH: 'Бахрейн', TN: 'Тунис', MA: 'Марокко',
  GH: 'Гана', UG: 'Уганда', RW: 'Руанда', ZW: 'Зимбабве', AZ: 'Азербайджан', AM: 'Армения', GE: 'Грузия', UZ: 'Узбекистан', EU: 'Европа',
};
const countryName = (c) => String(c || '').split(/[,;/ ]+/).filter(Boolean).map((x) => COUNTRY[x.toUpperCase()] || x).join(', ');

const SMALL = {   // запасные тексты, если нет satellites-extra.json
  cubeDescription: 'Малый спутник формата CubeSat{year}.',
  otherDescription: 'Малый спутник{year}.',
  details: [],
};

const CSS = `
#card { position: fixed; left: 0; right: 0; bottom: 0; max-height: 46vh; overflow-y: auto; z-index: 5;
  background: rgba(14,16,22,.92); color: #eee; border-radius: 14px 14px 0 0; box-shadow: 0 -4px 18px rgba(0,0,0,.5);
  padding: 12px 14px; padding-bottom: max(12px, env(safe-area-inset-bottom)); font: 15px/1.4 system-ui, sans-serif;
  transform: translateY(105%); transition: transform .18s ease-out; touch-action: pan-y; }
#card.on { transform: none; }
#card h2 { margin: 0 34px 2px 0; font-size: 20px; line-height: 1.2; }
#card .sub { color: #aab; font-size: 13px; margin-bottom: 8px; }
#card .x { position: absolute; right: 8px; top: 6px; width: 34px; height: 34px; padding: 0; border-radius: 17px; font-size: 18px;
  background: rgba(255,255,255,.12); color: #ddd; }
#card table { border-collapse: collapse; margin: 8px 0; font-size: 14px; }
#card td { padding: 1px 10px 1px 0; vertical-align: top; } #card td:first-child { color: #99a; white-space: nowrap; }
#card .note { color: #778; font-size: 12px; }
#card .more { background: none; color: #8cf; padding: 4px 0; font-size: 14px; }
#card .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; } #card .chips button { font-size: 13px; padding: 6px 10px; background: rgba(255,255,255,.14); color: #eee; }
#card p { margin: 6px 0; } #card a { color: #8cf; }
`;

export function createCard({ R, canvas, clock, log, rec, speed: speedOf = () => 1 }) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const el = document.createElement('div'); el.id = 'card'; document.body.appendChild(el);
  // выбранное: { kind: 'sat' | 'place', k } или null; near — соседи по нажатию (такие же объекты)
  let list = [], extra = SMALL, cur = null, more = false, sat = null, timer = 0, near = [];
  const same = (a, b) => a && b && a.kind === b.kind && a.k === b.k;
  const place = (k) => R.places.points[k] || {};
  const nameOf = (h) => (h.kind === 'place' ? place(h.k).name : list[h.k] ? list[h.k].name : String(h.k));

  function setData(l, ex) {
    list = l; if (ex && ex.smallSat) extra = ex.smallSat;
    // прогрев: карточка собирается один раз невидимой (вёрстка, шрифты), SGP4 считается один раз — первое нажатие без фриза
    const k = list.findIndex((q) => q.group !== 'context');
    if (k >= 0) setTimeout(() => { if (cur) return; const w = { kind: 'sat', k }; cur = w; render(); live().then(() => { if (cur === w) { cur = null; sat = null; el.innerHTML = ''; } }); }, 1500);
  }

  // --- нажатие ---
  let down = null, last = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return; const d = down; down = null;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 14 || performance.now() - d.t > 700) return;   // это не нажатие
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const t0 = performance.now(), hits = R.pick(x, y, 36), ms = performance.now() - t0;
    if (rec) rec.push([Math.round(t0), Math.round(x), Math.round(y), hits.length ? (hits[0].kind === 'place' ? 'p' + hits[0].k : hits[0].k) : -1, hits.length ? +hits[0].d.toFixed(1) : -1, hits.length, +ms.toFixed(2)]);
    if (!hits.length) { select(null); return; }
    // ближе 28 px: сначала известные спутники, потом точки на Земле, потом остальные; повторное нажатие туда же — следующий
    const pri = (h) => (h.d < 28 ? (h.kind === 'sat' && list[h.k] && list[h.k].group === 'context' ? 0 : h.kind === 'place' ? 1 : 2) : 3);
    let order = hits.slice().sort((a, b) => pri(a) - pri(b) || a.d - b.d).map((h) => ({ kind: h.kind, k: h.k }));
    const again = last && Math.hypot(x - last.x, y - last.y) < 24 && performance.now() - last.t < 8000 && order.some((h) => same(h, cur));
    if (again) { const i = order.findIndex((h) => same(h, cur)); order = order.slice(i + 1).concat(order.slice(0, i + 1)); }
    last = { x, y, t: performance.now() };
    near = order.slice(1, 5);
    select(order[0]);
  });

  // --- карточка ---
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function select(h) {
    cur = h; more = false; sat = null;
    if (R.sats) R.sats.select(h && h.kind === 'sat' ? h.k : -1);
    if (R.places) R.places.select(h && h.kind === 'place' ? h.k : -1);
    clearInterval(timer);
    if (!h) { el.classList.remove('on'); document.body.classList.remove('card-open'); return; }
    render(); el.classList.add('on'); document.body.classList.add('card-open'); el.scrollTop = 0;
    live(); timer = setInterval(live, 333);
    log('выбран:', nameOf(h), near.length ? `(рядом ещё ${near.length})` : '');
  }
  // спутник сцены по короткому имени («GOES» → GOES-19)
  const findSat = (nm) => list.findIndex((q) => q.group === 'context' && (q.name === nm || q.name.startsWith(nm)));
  function render() {
    let title = '', sub = '', desc = '', details = [], meta = [], links = [];
    if (cur.kind === 'place') {
      const q = place(cur.k), ty = R.places.types[q.type] || {};
      title = q.name; sub = [ty.label, q.country].filter(Boolean).join(' · ');
      desc = q.description || ''; details = Array.isArray(q.details) ? q.details : [];
      for (const [a, b] of Object.entries(q.facts || {})) meta.push([esc(a), esc(b)]);
      const deg = (x, a, b) => Math.abs(x).toFixed(2).replace('.', ',') + '° ' + (x >= 0 ? a : b);
      meta.push(['Координаты', deg(q.lat, 'с. ш.', 'ю. ш.') + ', ' + deg(q.lon, 'в. д.', 'з. д.')]);
      links = (q.sats || []).map(findSat).filter((k) => k >= 0);
    } else {
      const s = list[cur.k] || {}, info = s.info || {}, ctx = s.group === 'context';
      const year = (info.launched || '').slice(0, 4);
      title = s.name || '—';
      sub = (ctx ? info.kind || 'Спутник' : s.cube ? 'Кубсат' : 'Малый спутник') + (info.country ? ' · ' + countryName(info.country) : '');
      desc = ctx ? info.description || '' : (s.cube ? extra.cubeDescription : extra.otherDescription).replace('{year}', year ? `, запущенный в ${year} году` : '');
      details = ctx ? info.details || [] : extra.details || [];
      if (info.operator) meta.push(['Оператор', esc(info.operator)]);
      if (info.launched) meta.push(['Запуск', esc(info.launched.split('-').reverse().join('.'))]);
      if (info.website) meta.push(['Сайт', `<a href="${esc(info.website)}" target="_blank" rel="noopener">${esc(info.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>`]);
      if (info.id || (s.omm && s.omm.NORAD_CAT_ID)) meta.push(['Номер NORAD', esc(info.id || s.omm.NORAD_CAT_ID)]);
    }
    const tbl = (rows) => `<table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
    el.innerHTML = `<button class="x" aria-label="Закрыть">✕</button>
      <h2>${esc(title)}</h2>
      <div class="sub">${esc(sub)}</div>
      ${desc ? `<p>${esc(desc)}</p>` : ''}
      <table class="live"></table>
      ${cur.kind === 'sat' ? `<div class="note">сведения — по времени сцены${speedOf() > 1 ? ` (идёт в ${speedOf()} раз быстрее)` : ''}</div>` : ''}
      ${links.length ? `<div class="chips links"><span class="note" style="align-self:center;width:100%">спутники сцены, связанные с этим местом:</span>${links.map((k) => `<button data-s="${k}">${esc(list[k].name)}</button>`).join('')}</div>` : ''}
      ${details.length || meta.length ? `<button class="more">${more ? 'Свернуть' : 'Подробнее'}</button>` : ''}
      ${more ? details.map((p) => `<p>${esc(p)}</p>`).join('') + (meta.length ? tbl(meta) : '') : ''}
      ${near.length ? `<div class="chips near"><span class="note" style="align-self:center;width:100%">рядом (ещё нажатие туда же — следующий):</span>${near.map((h, i) => `<button data-i="${i}">${esc(nameOf(h))}</button>`).join('')}</div>` : ''}`;
    el.querySelector('.x').onclick = () => select(null);
    const mb = el.querySelector('.more'); if (mb) mb.onclick = () => { more = !more; render(); live(); };
    el.querySelectorAll('.near button').forEach((b) => { b.onclick = () => { const h = near[+b.dataset.i]; near = near.filter((q) => q !== h).concat(cur ? [cur] : []); select(h); }; });
    el.querySelectorAll('.links button').forEach((b) => { b.onclick = () => { near = cur ? [cur] : []; select({ kind: 'sat', k: +b.dataset.s }); }; });
  }
  // живые сведения: у спутника — SGP4 (satellite.js грузится один раз), у точки — день или ночь там сейчас
  let lib = null;
  async function live() {
    if (!cur) return;
    const h = cur, tb = el.querySelector('.live'); if (!tb) return;
    const rowsHtml = (rows) => rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
    try {
      if (h.kind === 'place') {
        const q = place(h.k), t = clock().t, g = gmst(t), e = ecef(q.lat, q.lon);
        const p = [e[0] * Math.cos(g) - e[1] * Math.sin(g), e[0] * Math.sin(g) + e[1] * Math.cos(g), e[2]], su = sunECI(t);
        const elev = Math.asin(Math.max(-1, Math.min(1, p[0] * su[0] + p[1] * su[1] + p[2] * su[2]))) * 180 / Math.PI;
        const state = elev > 0 ? 'день' : elev > -6 ? 'сумерки' : 'ночь';
        tb.innerHTML = rowsHtml([['Сейчас там (по сцене)', `${state}, Солнце ${elev >= 0 ? 'на' : ''} ${Math.abs(Math.round(elev))}° ${elev >= 0 ? 'над горизонтом' : 'под горизонтом'}`]]);
        return;
      }
      if (!lib) lib = await import('../vendor/satellite.mjs?v=0.27');
      if (h !== cur) return;
      const s = list[h.k]; if (!sat && s && s.omm) sat = lib.json2satrec(s.omm);
      if (!sat) { tb.innerHTML = ''; return; }
      const date = new Date(clock().t), pv = lib.propagate(sat, date);
      if (!pv || !pv.position) { tb.innerHTML = rowsHtml([['Положение', 'не считается (сошёл с орбиты?)']]); return; }
      const p = pv.position, v = pv.velocity, g = lib.eciToGeodetic(p, lib.gstime(date));
      const lat = g.latitude * 180 / Math.PI, lon = ((g.longitude * 180 / Math.PI + 540) % 360) - 180;
      const deg = (x, a, b) => Math.abs(x).toFixed(1).replace('.', ',') + '° ' + (x >= 0 ? a : b);
      const per = 2 * Math.PI / sat.no;   // минут
      tb.innerHTML = rowsHtml([
        ['Высота', Math.round(g.height).toLocaleString('ru-RU') + ' км'],
        ['Скорость', Math.hypot(v.x, v.y, v.z).toFixed(2).replace('.', ',') + ' км/с'],
        ['Виток', per < 120 ? Math.round(per) + ' мин' : (per / 60).toFixed(1).replace('.', ',') + ' ч'],
        ['Наклонение орбиты', (sat.inclo * 180 / Math.PI).toFixed(1).replace('.', ',') + '°'],
        ['Сейчас над точкой', deg(lat, 'с. ш.', 'ю. ш.') + ', ' + deg(lon, 'в. д.', 'з. д.')],
      ]);
    } catch (e) { tb.innerHTML = rowsHtml([['Сведения', 'ошибка: ' + esc(e.message)]]); }
  }
  // после смены «Вида»: если выбранное скрыто — карточку закрыть
  function checkHidden() {
    if (!cur) return;
    if ((cur.kind === 'sat' && R.sats && !R.sats.shown(cur.k)) || (cur.kind === 'place' && R.places && !R.places.visible)) select(null);
  }
  return { setData, select, checkHidden, get selected() { return cur; } };
}
