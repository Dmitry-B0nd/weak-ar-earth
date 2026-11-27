// Выбор спутника нажатием и карточка снизу (обычный HTML поверх сцены — текст чёткий, видеокарте ничего не стоит).
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
body.carded #bar { display: none; }
`;

export function createCard({ R, canvas, clock, log, rec, speed }) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const el = document.createElement('div'); el.id = 'card'; document.body.appendChild(el);
  let list = [], extra = SMALL, sel = -1, more = false, sat = null, timer = 0, near = [];

  function setData(l, ex) {
    list = l; if (ex && ex.smallSat) extra = ex.smallSat;
    // прогрев: карточка собирается один раз невидимой (вёрстка, шрифты), SGP4 считается один раз — первое нажатие без фриза
    const k = list.findIndex((q) => q.group !== 'context');
    if (k >= 0) setTimeout(() => { if (sel >= 0) return; sel = k; render(); live().then(() => { if (sel === k) { sel = -1; sat = null; el.innerHTML = ''; } }); }, 1500);
  }

  // --- нажатие ---
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return; const d = down; down = null;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 14 || performance.now() - d.t > 700) return;   // это не нажатие
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const t0 = performance.now(), hits = R.pick(x, y, 36), ms = performance.now() - t0;
    if (rec) rec.push([Math.round(t0), Math.round(x), Math.round(y), hits.length ? hits[0].k : -1, hits.length ? +hits[0].d.toFixed(1) : -1, hits.length, +ms.toFixed(2)]);
    if (!hits.length) { select(-1); return; }
    // известные — первыми, если палец рядом с ними (их и ищут чаще); повторное нажатие в то же место — следующий
    const ctx = hits.filter((h) => list[h.k] && list[h.k].group === 'context' && h.d < 28);
    let order = ctx.concat(hits.filter((h) => !ctx.includes(h))).map((h) => h.k);
    const again = last && Math.hypot(x - last.x, y - last.y) < 24 && performance.now() - last.t < 8000 && order.includes(sel);
    if (again) { const i = order.indexOf(sel); order = order.slice(i + 1).concat(order.slice(0, i + 1)); }
    last = { x, y, t: performance.now() };
    near = order.slice(1, 5);
    select(order[0]);
  });
  let last = null;

  // --- карточка ---
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function select(k) {
    sel = k; more = false; sat = null;
    if (R.sats) R.sats.select(k, near);
    clearInterval(timer);
    if (k < 0) { el.classList.remove('on'); document.body.classList.remove('carded'); return; }
    render(); el.classList.add('on'); document.body.classList.add('carded'); el.scrollTop = 0;
    live(); timer = setInterval(live, 333);
    log('выбран:', list[k] ? list[k].name : k, near.length ? `(рядом ещё ${near.length})` : '');
  }
  function render() {
    const s = list[sel] || {}, info = s.info || {}, ctx = s.group === 'context';
    const year = (info.launched || '').slice(0, 4);
    const kind = ctx ? info.kind || 'Спутник' : s.cube ? 'Кубсат' : 'Малый спутник';
    const desc = ctx ? info.description || '' : (s.cube ? extra.cubeDescription : extra.otherDescription).replace('{year}', year ? `, запущенный в ${year} году` : '');
    const details = ctx ? info.details || [] : extra.details || [];
    const meta = [];
    if (info.operator) meta.push(['Оператор', esc(info.operator)]);
    if (info.launched) meta.push(['Запуск', esc(info.launched.split('-').reverse().join('.'))]);
    if (info.website) meta.push(['Сайт', `<a href="${esc(info.website)}" target="_blank" rel="noopener">${esc(info.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>`]);
    if (info.id || (s.omm && s.omm.NORAD_CAT_ID)) meta.push(['Номер NORAD', esc(info.id || s.omm.NORAD_CAT_ID)]);
    el.innerHTML = `<button class="x" aria-label="Закрыть">✕</button>
      <h2>${esc(s.name || '—')}</h2>
      <div class="sub">${esc(kind)}${info.country ? ' · ' + esc(countryName(info.country)) : ''}</div>
      ${desc ? `<p>${esc(desc)}</p>` : ''}
      <table class="live"></table>
      <div class="note">сведения — по времени сцены${speed > 1 ? ` (идёт в ${speed} раз быстрее)` : ''}</div>
      ${details.length || meta.length ? `<button class="more">${more ? 'Свернуть' : 'Подробнее'}</button>` : ''}
      ${more ? details.map((p) => `<p>${esc(p)}</p>`).join('') + (meta.length ? `<table>${meta.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>` : '') : ''}
      ${near.length ? `<div class="chips"><span class="note" style="align-self:center;width:100%">рядом:</span>${near.map((k) => `<button data-k="${k}">${esc(list[k] ? list[k].name : k)}</button>`).join('')}</div>` : ''}`;
    el.querySelector('.x').onclick = () => select(-1);
    const mb = el.querySelector('.more'); if (mb) mb.onclick = () => { more = !more; render(); live(); };
    el.querySelectorAll('.chips button').forEach((b) => { b.onclick = () => { const k = +b.dataset.k; near = near.filter((q) => q !== k).concat(sel >= 0 ? [sel] : []); select(k); }; });
    if (near.length) el.querySelector('.chips .note').textContent = 'рядом (тусклые кольца; ещё нажатие туда же — следующий):';
  }
  // живые сведения: SGP4 одного спутника (satellite.js грузится один раз при первом выборе)
  let lib = null;
  async function live() {
    if (sel < 0) return;
    const k = sel, tb = el.querySelector('.live'); if (!tb) return;
    try {
      if (!lib) lib = await import('../vendor/satellite.mjs?v=0.21');
      if (k !== sel) return;
      const s = list[k]; if (!sat && s && s.omm) sat = lib.json2satrec(s.omm);
      if (!sat) { tb.innerHTML = ''; return; }
      const date = new Date(clock().t), pv = lib.propagate(sat, date);
      if (!pv || !pv.position) { tb.innerHTML = '<tr><td>Положение</td><td>не считается (сошёл с орбиты?)</td></tr>'; return; }
      const p = pv.position, v = pv.velocity, g = lib.eciToGeodetic(p, lib.gstime(date));
      const lat = g.latitude * 180 / Math.PI, lon = ((g.longitude * 180 / Math.PI + 540) % 360) - 180;
      const deg = (x, a, b) => Math.abs(x).toFixed(1).replace('.', ',') + '° ' + (x >= 0 ? a : b);
      const per = 2 * Math.PI / sat.no;   // минут
      const rows = [
        ['Высота', Math.round(g.height).toLocaleString('ru-RU') + ' км'],
        ['Скорость', Math.hypot(v.x, v.y, v.z).toFixed(2).replace('.', ',') + ' км/с'],
        ['Виток', per < 120 ? Math.round(per) + ' мин' : (per / 60).toFixed(1).replace('.', ',') + ' ч'],
        ['Наклонение орбиты', (sat.inclo * 180 / Math.PI).toFixed(1).replace('.', ',') + '°'],
        ['Сейчас над точкой', deg(lat, 'с. ш.', 'ю. ш.') + ', ' + deg(lon, 'в. д.', 'з. д.')],
      ];
      tb.innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
    } catch (e) { tb.innerHTML = `<tr><td>Сведения</td><td>ошибка: ${esc(e.message)}</td></tr>`; }
  }
  return { setData, select, get selected() { return sel; } };
}
