// Точки интереса на Земле: космодромы, управление и связь, прочее. Рисуются значками на поверхности (вращаются вместе
// с Землёй), у горизонта плавно гаснут; по нажатию — карточка. Тексты — короткие, только проверенные факты.
import { RS_GLSL, setRS } from './rshutter.js?v=0.25';

export const PLACE_CATS = {
  launch: { label: 'Космодром', color: '#ff8a3d' },
  control: { label: 'Управление и связь', color: '#4fd3ff' },
  other: { label: 'Другое', color: '#d59bff' },
};

// sats — названия известных спутников сцены, связанных с точкой (кнопки в карточке)
export const PLACES = [
  { id: 'baikonur', cat: 'launch', name: 'Байконур', country: 'Казахстан (арендует Россия)', lat: 45.96, lon: 63.31, since: 'пуски с 1957 года',
    text: ['Первый и самый известный космодром мира. Отсюда 4 октября 1957 года ушёл первый искусственный спутник Земли, а 12 апреля 1961 года — Юрий Гагарин.',
      'Сейчас отсюда стартуют пилотируемые «Союзы» к МКС; отсюда же выводили российские модули станции «Заря» и «Звезда».'],
    sats: ['МКС'] },
  { id: 'plesetsk', cat: 'launch', name: 'Плесецк', country: 'Россия', lat: 62.93, lon: 40.58, since: 'пуски с 1957 года (космические — с 1966)',
    text: ['Самый северный действующий космодром и рекордсмен по числу космических пусков за всю историю.',
      'Северное расположение удобно для полярных орбит, где летают спутники наблюдения Земли и связи для высоких широт.'] },
  { id: 'vostochny', cat: 'launch', name: 'Восточный', country: 'Россия', lat: 51.88, lon: 128.33, since: 'первый пуск — 2016 год',
    text: ['Новый российский гражданский космодром на Дальнем Востоке. Отсюда летают «Союз-2» и тяжёлая «Ангара-А5».'] },
  { id: 'canaveral', cat: 'launch', name: 'Мыс Канаверал и Центр Кеннеди', country: 'США', lat: 28.57, lon: -80.62, since: 'пуски с 1950 года',
    text: ['Главные ворота США в космос: отсюда стартовали «Меркурии», «Аполлоны» к Луне и все полёты шаттлов.',
      'Сейчас здесь самый плотный график пусков в мире — ракеты Falcon 9 и Falcon Heavy, а также лунная SLS. Хаббл ушёл на орбиту отсюда на шаттле «Дискавери» в 1990 году, GOES-19 — на Falcon Heavy в 2024-м.'],
    sats: ['Хаббл', 'GOES'] },
  { id: 'vandenberg', cat: 'launch', name: 'Ванденберг', country: 'США', lat: 34.74, lon: -120.57,
    text: ['База на побережье Калифорнии: ракеты уходят на юг над океаном, поэтому отсюда удобно выводить спутники на полярные орбиты.',
      'Отсюда запущены спутники наблюдения Земли Terra (1999) и Aqua (2002) и метеоспутник NOAA-21 (2022).'],
    sats: ['Terra', 'Aqua', 'NOAA'] },
  { id: 'starbase', cat: 'launch', name: 'Старбейс (Бока-Чика)', country: 'США', lat: 26.0, lon: -97.16, since: 'первый полёт Starship — 2023 год',
    text: ['Испытательная площадка SpaceX на юге Техаса. Здесь строят и запускают Starship — самую большую ракету в истории.'] },
  { id: 'kourou', cat: 'launch', name: 'Куру', country: 'Французская Гвиана (Франция, ЕС)', lat: 5.24, lon: -52.77, since: 'пуски с 1968 года',
    text: ['Космодром Европы почти на экваторе: вращение Земли здесь даёт ракете больше всего «бесплатной» скорости.',
      'Ракета Ariane 5 вывела отсюда телескоп «Джеймс Уэбб» (2021) и метеоспутник Meteosat-12 (2022); сейчас летает Ariane 6.'],
    sats: ['Meteosat'] },
  { id: 'jiuquan', cat: 'launch', name: 'Цзюцюань', country: 'Китай', lat: 40.96, lon: 100.29, since: 'пуски с 1958 года',
    text: ['Старейший китайский космодром в пустыне Гоби. Отсюда стартуют пилотируемые корабли «Шэньчжоу» — экипажи летят на станцию Тяньгун.'],
    sats: ['Тяньгун'] },
  { id: 'wenchang', cat: 'launch', name: 'Вэньчан', country: 'Китай (о. Хайнань)', lat: 19.61, lon: 110.95, since: 'первый пуск — 2016 год',
    text: ['Самый южный китайский космодром, на берегу моря — сюда можно возить большие ступени по воде.',
      'Отсюда тяжёлые ракеты «Чанчжэн-5» вывели модули станции Тяньгун и лунный аппарат «Чанъэ-5», доставивший на Землю лунный грунт.'],
    sats: ['Тяньгун'] },
  { id: 'taiyuan', cat: 'launch', name: 'Тайюань', country: 'Китай', lat: 38.85, lon: 111.61,
    text: ['Космодром для полярных и солнечно-синхронных орбит. Отсюда запускали китайские метеоспутники серии «Фэнъюнь-3».'] },
  { id: 'tanegashima', cat: 'launch', name: 'Танэгасима', country: 'Япония', lat: 30.40, lon: 130.97, since: 'пуски с 1969 года',
    text: ['Главный японский космодром на южном острове — его называют одним из самых красивых в мире.',
      'Отсюда ракеты H-IIA и H3 выводят японские спутники, в том числе метеоспутник Химавари-9 (2016).'],
    sats: ['Химавари'] },
  { id: 'sriharikota', cat: 'launch', name: 'Шрихарикота', country: 'Индия', lat: 13.72, lon: 80.23, since: 'пуски с 1971 года',
    text: ['Космодром Индии на острове в Бенгальском заливе. Отсюда стартовали лунные миссии «Чандраян», в том числе «Чандраян-3», севший у южного полюса Луны в 2023 году.',
      'В 2017 году ракета PSLV вывела отсюда за один пуск 104 спутника — рекорд на тот момент.'] },
  { id: 'mahia', cat: 'launch', name: 'Махиа', country: 'Новая Зеландия', lat: -39.26, lon: 177.86, since: 'первый пуск — 2017 год',
    text: ['Частный космодром компании Rocket Lab. Лёгкие ракеты Electron выводят отсюда малые спутники, в том числе много кубсатов.'] },
  { id: 'andoya', cat: 'launch', name: 'Андёйя', country: 'Норвегия', lat: 69.29, lon: 16.02, since: 'исследовательские ракеты — с 1962 года',
    text: ['Арктический ракетный полигон. 5 сентября 2026 года немецкая ракета Spectrum (Isar Aerospace) вывела отсюда спутники на орбиту — первый успешный орбитальный пуск с европейского материка.'] },
  { id: 'esrange', cat: 'launch', name: 'Эсрейндж (Кируна)', country: 'Швеция', lat: 67.89, lon: 21.10, since: 'исследовательские ракеты — с 1966 года',
    text: ['Полигон за полярным кругом: отсюда запускают исследовательские ракеты и стратосферные аэростаты.',
      'В 2023 году здесь открыли комплекс для орбитальных пусков — первый в континентальной части ЕС; первый орбитальный пуск планируют позже.'] },
  { id: 'hammaguir', cat: 'launch', name: 'Хаммагир', country: 'Алжир', lat: 30.88, lon: -3.03, since: 'спутник — 1965 год',
    text: ['Бывший французский ракетный полигон в Сахаре. В 1965 году ракета «Диамант» вывела отсюда первый французский спутник «Астерикс», и Франция стала третьей страной, запустившей спутник своей ракетой.'] },
  { id: 'sanmarco', cat: 'launch', name: 'Сан-Марко (Малинди)', country: 'Кения', lat: -2.94, lon: 40.21, since: 'орбитальные пуски — 1967–1988 годы',
    text: ['Итальянская стартовая платформа в океане у берега Кении, почти на экваторе. В 1970 году отсюда вывели «Ухуру» — первый спутник для наблюдения неба в рентгеновских лучах.',
      'Сейчас здесь работает итальянская станция связи со спутниками.'] },
  { id: 'woomera', cat: 'launch', name: 'Вумера', country: 'Австралия', lat: -30.96, lon: 136.50, since: 'полигон с 1947 года',
    text: ['Огромный ракетный полигон в пустыне. В 1967 году отсюда запустили WRESAT — первый австралийский спутник.',
      'В 1971 году отсюда же британская ракета «Блэк Эрроу» вывела спутник «Просперо» — единственный, запущенный британской ракетой.'] },

  { id: 'tsup', cat: 'control', name: 'ЦУП, Королёв', country: 'Россия', lat: 55.91, lon: 37.81,
    text: ['Центр управления полётами Роскосмоса. Отсюда управляют российским сегментом МКС и другими российскими космическими аппаратами.'],
    sats: ['МКС'] },
  { id: 'jsc', cat: 'control', name: 'Центр Джонсона, Хьюстон', country: 'США', lat: 29.56, lon: -95.09,
    text: ['Центр управления пилотируемыми полётами NASA и место подготовки астронавтов.',
      'Отсюда вели «Аполлоны» — знаменитое «Хьюстон, у нас проблема» было сказано на связи с этим центром, — а сейчас управляют МКС.'],
    sats: ['МКС'] },
  { id: 'bacc', cat: 'control', name: 'Пекинский ЦУП', country: 'Китай', lat: 40.07, lon: 116.26,
    text: ['Центр управления китайскими пилотируемыми полётами: кораблями «Шэньчжоу» и станцией Тяньгун.'],
    sats: ['Тяньгун'] },
  { id: 'darmstadt', cat: 'control', name: 'Дармштадт (ESOC и EUMETSAT)', country: 'Германия', lat: 49.87, lon: 8.62,
    text: ['Здесь находятся центр управления полётами Европейского космического агентства (ESOC) и штаб EUMETSAT — европейской организации метеоспутников.',
      'Из Дармштадта управляют спутниками Meteosat.'],
    sats: ['Meteosat'] },
  { id: 'oberpfaffenhofen', cat: 'control', name: 'Оберпфаффенхофен', country: 'Германия', lat: 48.08, lon: 11.28,
    text: ['Центр Немецкого аэрокосмического центра (DLR). Отсюда управляют европейским лабораторным модулем МКС Columbus.'],
    sats: ['МКС'] },
  { id: 'tsukuba', cat: 'control', name: 'Космический центр Цукуба', country: 'Япония', lat: 36.07, lon: 140.13,
    text: ['Крупнейший центр японского космического агентства JAXA. Отсюда управляют японским модулем МКС «Кибо».'],
    sats: ['МКС'] },
  { id: 'goldstone', cat: 'control', name: 'Голдстоун', country: 'США', lat: 35.43, lon: -116.89,
    text: ['Одна из трёх станций сети дальней космической связи NASA (вместе с Мадридом и Канберрой). Три станции стоят примерно через треть оборота Земли, чтобы далёкие аппараты всегда были на связи с одной из них.'] },
  { id: 'madrid', cat: 'control', name: 'Робледо (Мадрид)', country: 'Испания', lat: 40.43, lon: -4.25,
    text: ['Станция сети дальней космической связи NASA под Мадридом: огромные антенны держат связь с аппаратами у других планет и за пределами Солнечной системы.'] },
  { id: 'canberra', cat: 'control', name: 'Тидбинбилла (Канберра)', country: 'Австралия', lat: -35.40, lon: 148.98,
    text: ['Станция сети дальней космической связи NASA в Австралии — одна из трёх таких в мире. Отсюда, например, держат связь с «Вояджерами».'] },
  { id: 'parkes', cat: 'control', name: 'Паркс («Тарелка»)', country: 'Австралия', lat: -33.00, lon: 148.26, since: 'с 1961 года',
    text: ['64-метровый радиотелескоп. В июле 1969 года через него шла большая часть телевизионной трансляции первых шагов человека на Луне.'] },

  { id: 'starcity', cat: 'other', name: 'Звёздный городок', country: 'Россия', lat: 55.88, lon: 38.11,
    text: ['Центр подготовки космонавтов имени Гагарина: тренажёры кораблей и станции, центрифуга, бассейн для тренировок выхода в открытый космос.'],
    sats: ['МКС'] },
  { id: 'soyuzland', cat: 'other', name: 'Посадка «Союзов»', country: 'Казахстан', lat: 47.3, lon: 69.4,
    text: ['В степи юго-восточнее Джезказгана садятся спускаемые аппараты «Союзов» с экипажами, возвращающимися с МКС.'],
    sats: ['МКС'] },
  { id: 'nemo', cat: 'other', name: 'Точка Немо', country: 'Тихий океан', lat: -48.88, lon: -123.39,
    text: ['Место в океане дальше всего от суши — до ближайшего берега больше 2600 км. Сюда сводят отслужившие корабли и станции, чтобы обломки упали вдали от людей.',
      'В этом районе затоплена станция «Мир» (2001); сюда же планируют свести МКС в конце её работы.'],
    sats: ['МКС'] },
];

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
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
// единичный вектор точки в осях Земли (x — нулевой меридиан, z — север)
export const ecef = (lat, lon) => { const a = lat * Math.PI / 180, b = lon * Math.PI / 180; return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)]; };

export function createPlaces(gl, o = {}) {
  const opt = { minPx: 4, maxPx: 16, ...o };
  const pr = prog(gl, VS, FS), n = PLACES.length;
  const data = new Float32Array(n * 7);
  PLACES.forEach((q, i) => data.set([...ecef(q.lat, q.lon), ...hex(PLACE_CATS[q.cat].color), i], i * 7));
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  let sel = -1, visible = true;
  // P, MV (оси Земли без вращения → камера), spin — звёздное время (рад), camE — камера в осях Земли (радиусы)
  function draw(P, MV, spin, camE, dpr, rs, F) {
    if (!visible) return;
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
    return PLACES.map((q) => {
      const e = ecef(q.lat, q.lon), p = [e[0] * cs - e[1] * sn, e[0] * sn + e[1] * cs, e[2]];
      const v = [camE[0] - p[0], camE[1] - p[1], camE[2] - p[2]], l = Math.hypot(...v);
      const dd = (p[0] * v[0] + p[1] * v[1] + p[2] * v[2]) / l, vis = Math.min(1, Math.max(0, (dd - 0.02) / 0.2));
      return { p: p.map((x) => x * 1.02), vis };
    });
  }
  return { draw, positions, select(i) { sel = i; }, get selected() { return sel; }, n, get visible() { return visible; }, set visible(v) { visible = !!v; } };
}
