// Интерфейс в виде основного проекта: стартовый экран со строкой загрузки и ошибками, плашка «Ищу метку / Метка
// найдена», подсказка с листом, легенда, кнопки «Заморозить» и «Вид», панель «Вид» (запоминается в браузере),
// «камера не отвечает». Только HTML и CSS поверх холста — сцене и зрению ничего не стоит.
const $ = (id) => document.getElementById(id);

export function createUI({ onView }) {
  const overlay = $('overlay'), msg = $('msg'), progress = $('progress'), startBtn = $('startBtn'), btn3d = $('btn3d');
  const status = $('status'), hint = $('hint'), legend = $('legend'), freezeBtn = $('freezeBtn'), viewBtn = $('viewBtn'), viewPanel = $('viewPanel'), stall = $('stall');

  // --- строка загрузки: «Загрузка…» → «Загружено N из M» → «Всё загружено» ---
  let total = 0, done = 0;
  const showProgress = () => { progress.textContent = !total || done === 0 ? 'Загрузка…' : done < total ? `Загружено ${done} из ${total}` : 'Всё загружено'; };
  function expect(n) { total += n; showProgress(); }
  function loaded() { done++; showProgress(); }

  function showError(html, retry = true) {
    msg.innerHTML = html;
    overlay.style.display = 'flex';
    startBtn.textContent = 'Попробовать снова'; startBtn.disabled = false; btn3d.disabled = false;
    if (retry) startBtn.onclick = () => location.reload();
    status.style.display = 'none';
  }
  function starting() { startBtn.disabled = true; btn3d.disabled = true; startBtn.textContent = 'Загрузка…'; }
  function started() {
    overlay.style.display = 'none';
    status.style.display = 'block'; legend.style.display = 'flex'; freezeBtn.style.display = 'block'; viewBtn.style.display = 'block';
    document.body.classList.add('running'); hiddenSince = performance.now();
  }

  // --- плашка и подсказка: по тому, есть ли сцена на показанном кадре ---
  let found = false, lastSeen = 0, hiddenSince = performance.now();
  function tick(now, visible, active) {
    if (visible) { lastSeen = now; hiddenSince = 0; } else if (!hiddenSince) hiddenSince = now;
    const f = visible || now - lastSeen < 400;                         // короткие провалы плашку не дёргают
    if (f !== found) { found = f; status.textContent = f ? 'Метка найдена' : 'Ищу метку…'; status.classList.toggle('found', f); }
    hint.style.display = active && !visible && hiddenSince && now - hiddenSince > 1500 ? 'flex' : 'none';
  }
  function setStall(on) { stall.style.display = on ? 'flex' : 'none'; }

  // --- легенда: цвета точек на Земле и групп спутников ---
  function setLegend(items) {
    legend.innerHTML = items.map(([label, color]) => `<div><i style="background:${color}"></i>${label.replace(/[<&]/g, '')}</div>`).join('');
  }

  // --- «Заморозить» ---
  let frozen = false, canFreeze = () => true, onFreeze = () => {};
  freezeBtn.onclick = () => {
    if (!frozen && !canFreeze()) return;                              // нечего замораживать, пока метки нет
    frozen = !frozen; freezeBtn.classList.toggle('on', frozen); freezeBtn.textContent = frozen ? 'Продолжить' : 'Заморозить';
    onFreeze(frozen);
  };

  // --- панель «Вид» ---
  const KEY = 'ar-earth-view';
  const view = { speed: 120, small: 'all', context: true, poi: true };
  try { Object.assign(view, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* нет — по умолчанию */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(view)); } catch (e) { /* не страшно */ } };
  let counts = { small: 0, cube: 0 };
  function seg(key, opts) {
    return `<div class="seg" data-key="${key}">${opts.map(([v, label]) => `<button data-v="${v}" class="${String(view[key]) === String(v) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  }
  function renderPanel() {
    viewPanel.innerHTML = `
      <div class="row"><div class="lbl">Скорость времени</div>${seg('speed', [[1, '×1'], [30, '×30'], [120, '×120'], [600, '×600']])}</div>
      <div class="row"><div class="lbl">Малые спутники</div>${seg('small', [['all', `Все${counts.small ? ` (${counts.small})` : ''}`], ['cube', `Кубсаты${counts.cube ? ` (${counts.cube})` : ''}`], ['none', 'Скрыть']])}</div>
      <div class="row"><div class="lbl">Станции и метеоспутники</div>${seg('context', [[true, 'Показать'], [false, 'Скрыть']])}</div>
      <div class="row"><div class="lbl">Точки на Земле</div>${seg('poi', [[true, 'Показать'], [false, 'Скрыть']])}</div>
      <div class="row"><button class="now">Вернуть текущее время</button></div>`;
    viewPanel.querySelectorAll('.seg button').forEach((b) => {
      b.onclick = () => {
        const key = b.parentNode.dataset.key, raw = b.dataset.v;
        view[key] = key === 'speed' ? +raw : raw === 'true' ? true : raw === 'false' ? false : raw;
        save(); renderPanel(); onView(view, key);
      };
    });
    viewPanel.querySelector('.now').onclick = () => onView(view, 'now');
  }
  viewBtn.onclick = (e) => { e.stopPropagation(); const on = viewPanel.style.display !== 'block'; if (on) renderPanel(); viewPanel.style.display = on ? 'block' : 'none'; };
  // нажатие мимо панели — закрыть её
  window.addEventListener('pointerdown', (e) => { if (viewPanel.style.display === 'block' && !viewPanel.contains(e.target) && e.target !== viewBtn) viewPanel.style.display = 'none'; }, true);
  function setCounts(c) { counts = c; if (viewPanel.style.display === 'block') renderPanel(); }

  return {
    expect, loaded, showError, starting, started, tick, setStall, setLegend, setCounts, view,
    get frozen() { return frozen; },
    set onFreeze(f) { onFreeze = f; }, set canFreeze(f) { canFreeze = f; },
    startBtn, btn3d,
  };
}
