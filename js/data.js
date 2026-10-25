// data.js：市区町村の境界と、都県ごとの場所データ（MeguMiru 版10）

// Overpass（OpenStreetMap のデータを取り出す窓口）。上から順に頼む
const OVP_SERVERS = [
  ['本家', 'https://overpass-api.de/api/interpreter'],
  ['coffee', 'https://overpass.private.coffee/api/interpreter'],
  ['kumi', 'https://overpass.kumi.systems/api/interpreter']
];
const OVP_LIMIT = 70000;       // 1か所あたりの待ち時間（ミリ秒）
const PREF_DAYS = 30;          // 都県のデータを取り直すまでの日数（用意したファイルは毎月作り直す）
const PREF_DV = 2;             // 保存データの形の番号（版1で保存した分は取り直す）
const DATA_REV = 5;            // 振り分け方の番号（版6で 3：城跡から御所・宮邸などを外し、遺跡の城跡を拾う／版7で 4：地下駅の印 u／版10で 5：遺構と城跡公園も城跡に）。古いファイルは1日おきに取り直しを試す
const PREF_RETRY_MIN = 3;      // 失敗したら、自動で頼み直すまでの分

let CITY = [];                 // [{c, p, n, g, bb}]  c=コード, p=都県名, n=名前, g=境界, bb=囲む四角
const CITY_BY = new Map();     // コード → 市区町村
const PREF_BB = {};            // 都県コード → [西, 南, 東, 北]
const SPOTS = new Map();       // 場所の番号 → {id, sh, sub, n, x, y, p, w}
const PREF_META = {};          // 都県コード → {t: 取得時刻, n: 件数}
const PREF_FAIL = {};          // 都県コード → 最後に失敗した時刻
const GRID = new Map();        // 0.01°のマス → 場所の番号の配列
const GSZ = 0.01;

// ---------- 市区町村 ----------
async function loadCity() {
  const res = await fetch('data/city.json?v=1');
  if (!res.ok) throw new Error('市区町村のデータを読めませんでした');
  initCity(await res.json());
}

function initCity(js) {
  CITY = js.list;
  for (const c of CITY) {
    let w = 999, s = 999, e = -999, n = -999;
    for (const poly of c.g) for (const [x, y] of poly[0]) {
      if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
    }
    c.bb = [w, s, e, n];
    CITY_BY.set(c.c, c);
    const pc = c.c.slice(0, 2);
    const b = PREF_BB[pc] || (PREF_BB[pc] = [999, 999, -999, -999]);
    b[0] = Math.min(b[0], w); b[1] = Math.min(b[1], s); b[2] = Math.max(b[2], e); b[3] = Math.max(b[3], n);
  }
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPoly(x, y, poly) {
  if (!inRing(x, y, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) if (inRing(x, y, poly[i])) return false;
  return true;
}

let lastCity = null;
function cityAt(x, y) {
  // 直前の市区町村から調べる（たいていは同じなので速い）
  if (lastCity && x >= lastCity.bb[0] && x <= lastCity.bb[2] && y >= lastCity.bb[1] && y <= lastCity.bb[3]
      && lastCity.g.some(p => inPoly(x, y, p))) return lastCity;
  for (const c of CITY) {
    if (x < c.bb[0] || x > c.bb[2] || y < c.bb[1] || y > c.bb[3]) continue;
    if (c.g.some(p => inPoly(x, y, p))) { lastCity = c; return c; }
  }
  return null;
}

function cityGeo() {
  return {
    type: 'FeatureCollection',
    features: CITY.map(c => ({
      type: 'Feature',
      properties: { c: c.c, n: c.n },
      geometry: { type: 'MultiPolygon', coordinates: c.g }
    }))
  };
}

// ---------- 場所の種類分け ----------
function museumSub(name, tags) {
  if (/美術館|アート|ギャラリー/.test(name) || tags.museum === 'art') return '美術館';
  if (/科学館|科学博物館|サイエンス|プラネタリウム/.test(name) || tags.museum === 'science' || tags.museum === 'technology') return '科学館';
  if (/資料館|記念館|郷土館|文書館/.test(name)) return '資料館';
  return '博物館';
}

function classify(tags) {
  const name = tags.name;
  if (!name) return null;
  if (tags.disused || tags.abandoned || tags['disused:railway'] || tags['abandoned:railway']) return null;
  if (tags.railway === 'station' || tags.railway === 'halt') return ['st', '駅'];
  if (/^道の駅/.test(name) || ((tags.highway === 'rest_area' || tags.highway === 'services') && /道の駅/.test(name))) {
    const bad = ['parking', 'toilets', 'restaurant', 'fast_food', 'cafe', 'vending_machine', 'fuel', 'ice_cream'];
    if (tags.shop || bad.includes(tags.amenity) || tags.tourism === 'information' || tags.building === 'yes' && tags.amenity) return null;
    return ['mi', '道の駅'];
  }
  if (tags.tourism === 'museum') return ['mu', museumSub(name, tags)];
  const tum = tags.site_type === 'tumulus' || tags.archaeological_site === 'tumulus' || tags.tomb === 'tumulus'
    || (tags.historic && /古墳|号墳/.test(name));
  if (tum) return ['hi', '古墳'];
  if (tags.historic === 'castle') {
    // 皇居・御所・宮邸・迎賓館などは「城」として登録されていても外す
    if (['palace', 'manor', 'stately'].includes(tags.castle_type) || NOT_CASTLE.test(name)) return null;
    return ['hi', '城跡'];
  }
  // 版10：遺構（historic=ruins）で名前に「城」があるもの、名前が「〇〇城跡（城址）公園」などの公園
  if (tags.historic === 'ruins' && /城|砦|陣屋/.test(name)) return ['hi', '城跡'];
  if (tags.leisure === 'park' && /城(跡|址)/.test(name)) return ['hi', '城跡'];
  // 遺跡として登録されている城跡（例：滝山城跡）
  if (tags.historic === 'archaeological_site'
      && (tags.site_type === 'fortification' || tags.archaeological_site === 'fortification' || /城(跡|址)$|城$|砦(跡|址)?$|陣屋(跡|址)?$/.test(name))
      && /城|砦|陣屋|館/.test(name)) return ['hi', '城跡'];
  return null;
}
const NOT_CASTLE = /宮邸|宮東邸|親王邸|御所|御用邸|御用地|迎賓館|皇居|宮殿|游心亭|皇族邸|花蔭亭/;

// 古い振り分け方のファイルに残っている御所・宮邸などを、読み込むときにも外す
function cleanList(list) {
  return list.filter(s => !(s.sh === 'hi' && s.sub === '城跡' && NOT_CASTLE.test(s.n)));
}

function stationName(n) { return /駅$/.test(n) ? n : n + '駅'; }

// 版7：地下の駅か（地下鉄の駅、地下にあると登録された駅）
function isUnder(tags) {
  const neg = v => v != null && v !== '' && !isNaN(parseFloat(v)) && parseFloat(v) < 0;
  return tags.station === 'subway' || tags.subway === 'yes' || tags.location === 'underground'
    || tags.underground === 'yes' || neg(tags.level) || neg(tags.layer);
}

// Overpass の結果を場所の一覧にする。同じ名前で近いものは1つにまとめる
function parseOsm(js, pc) {
  const out = [];
  const byName = new Map();
  const weak = new Set();
  for (const el of (js.elements || [])) {
    const tags = el.tags || {};
    const k = classify(tags);
    if (!k) continue;
    const x = el.lon != null ? el.lon : el.center && el.center.lon;
    const y = el.lat != null ? el.lat : el.center && el.center.lat;
    if (x == null || y == null) continue;
    const [sh, sub] = k;
    const p = pc || prefOfPoint(x, y);
    if (!p) continue;                 // 10都県の外
    const n = sh === 'st' ? stationName(tags.name) : tags.name;
    const mergeM = sh === 'st' ? 400 : 300;
    const key = sh + '|' + n;
    const same = (byName.get(key) || []).find(s => dist(s.x, s.y, x, y) < mergeM);
    const under = sh === 'st' && isUnder(tags);
    if (same) {
      if (!same.w && tags.wikipedia) same.w = tags.wikipedia;
      if (under) same.u = 1;            // まとめた駅のどれかが地下なら地下駅
      continue;
    }
    const s = {
      id: el.type[0] + el.id, sh, sub, n,
      x: Math.round(x * 1e5) / 1e5, y: Math.round(y * 1e5) / 1e5, p
    };
    if (tags.wikipedia) s.w = tags.wikipedia;
    if (under) s.u = 1;
    if (sh === 'hi' && tags.historic !== 'castle' && !(tags.historic === 'archaeological_site' && tags.site_type === 'fortification')
      && (tags.historic === 'ruins' || tags.leisure === 'park')) weak.add(s);
    out.push(s);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(s);
  }
  // 版10：遺構・城跡公園から拾った城跡は、近く（600m以内）にほかの城跡があれば重ねない
  if (!weak.size) return out;
  const strong = out.filter(s => s.sh === 'hi' && s.sub === '城跡' && !weak.has(s));
  const kept = [];
  return out.filter(s => {
    if (!weak.has(s)) return true;
    if (strong.some(o => dist(o.x, o.y, s.x, s.y) < 600) || kept.some(o => dist(o.x, o.y, s.x, s.y) < 600)) return false;
    kept.push(s);
    return true;
  });
}

// 版4：都県の境界（area）で絞ると重すぎる（東京都は小笠原まで含む）ので、約50km四方のマスごとに問い合わせる
// どの都県のものかは、手元の市区町村の境界で決める。名前の文字で探すのは種類で絞ったあとだけ
const TILE = 0.5;
function ovpTileQuery(t, timeout) {
  const [s, w, n, e] = t;
  return `[out:json][timeout:${timeout || 50}][bbox:${s},${w},${n},${e}];
(
  node["railway"="station"]["name"];
  node["railway"="halt"]["name"];
  nwr["highway"="rest_area"]["name"~"道の駅"];
  nwr["highway"="services"]["name"~"道の駅"];
  nwr["tourism"="museum"]["name"];
  nwr["historic"="castle"]["name"];
  nwr["historic"="archaeological_site"]["name"~"古墳|号墳"];
  nwr["historic"="archaeological_site"]["site_type"="tumulus"]["name"];
  nwr["historic"="tomb"]["name"~"古墳|号墳"];
  nwr["historic"="tomb"]["tomb"="tumulus"]["name"];
);
out center;`;
}

// 位置からその都県（10都県の外なら null）。境界は簡素化してあるので、海沿いで外れたら約500m まわりも見る
function prefOfPoint(x, y) {
  let c = cityAt(x, y);
  if (!c) {
    const d = 0.005;
    for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, d], [d, -d], [-d, -d]]) {
      c = cityAt(x + dx, y + dy);
      if (c) break;
    }
  }
  return c ? c.c.slice(0, 2) : null;
}

// その都県にかかるマスの一覧 [南, 西, 北, 東]
function prefTiles(pcs) {
  const want = new Set(pcs);
  const cities = CITY.filter(c => want.has(c.c.slice(0, 2)));
  const keys = new Set();
  const key = (x, y) => Math.floor(x / TILE) + ',' + Math.floor(y / TILE);
  // 境界の頂点があるマス
  for (const c of cities) for (const poly of c.g) for (const [x, y] of poly[0]) keys.add(key(x, y));
  // 頂点がなくても中に入っているマス（マスの中を5×5点で調べる）
  let w = 999, s = 999, e = -999, n = -999;
  for (const c of cities) { w = Math.min(w, c.bb[0]); s = Math.min(s, c.bb[1]); e = Math.max(e, c.bb[2]); n = Math.max(n, c.bb[3]); }
  for (let ix = Math.floor(w / TILE); ix <= Math.floor(e / TILE); ix++) for (let iy = Math.floor(s / TILE); iy <= Math.floor(n / TILE); iy++) {
    const k = ix + ',' + iy;
    if (keys.has(k)) continue;
    outer: for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) {
      const x = (ix + (a + 0.5) / 5) * TILE, y = (iy + (b + 0.5) / 5) * TILE;
      for (const c of cities) {
        if (x < c.bb[0] || x > c.bb[2] || y < c.bb[1] || y > c.bb[3]) continue;
        if (c.g.some(p => inPoly(x, y, p))) { keys.add(k); break outer; }
      }
    }
  }
  return [...keys].map(k => { const [ix, iy] = k.split(',').map(Number); return [iy * TILE, ix * TILE, (iy + 1) * TILE, (ix + 1) * TILE]; })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// 何回かに分けて受け取った答えを1つにまとめる（同じものは1つに）
function mergeElements(parts) {
  const seen = new Set(), els = [];
  for (const js of parts) for (const el of (js.elements || [])) {
    const k = el.type + el.id;
    if (seen.has(k)) continue;
    seen.add(k); els.push(el);
  }
  return { elements: els };
}

async function ovpFetch(q, onStep) {
  const errs = [];
  for (const [label, url] of OVP_SERVERS) {
    if (onStep) onStep(label);
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), OVP_LIMIT);
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: ctl.signal
      });
      clearTimeout(tm);
      if (!res.ok) { errs.push(label + '：混雑（' + res.status + '）'); continue; }
      const js = await res.json();
      // 途中で打ち切られた答えは、一部だけが入っていても使わない
      if (js.remark && /runtime error|timed out|out of memory/i.test(js.remark)) { errs.push(label + '：時間切れ'); continue; }
      return js;
    } catch (e) {
      clearTimeout(tm);
      errs.push(label + '：' + (e && e.name === 'AbortError' ? '時間切れ' : jaErr(e)));
    }
  }
  throw new Error(errs.join('、') || '取得できませんでした');
}

// ---------- 場所の索引（近くを速く探すため） ----------
function gkey(ix, iy) { return ix + ',' + iy; }
function gridAdd(s) {
  const k = gkey(Math.floor(s.x / GSZ), Math.floor(s.y / GSZ));
  if (!GRID.has(k)) GRID.set(k, []);
  GRID.get(k).push(s.id);
}
function gridRebuild() {
  GRID.clear();
  for (const s of SPOTS.values()) gridAdd(s);
}
function spotsNear(x, y, r) {
  const res = [];
  const dy = r / 111000, dx = r / (111000 * Math.cos(y * Math.PI / 180));
  const x0 = Math.floor((x - dx) / GSZ), x1 = Math.floor((x + dx) / GSZ);
  const y0 = Math.floor((y - dy) / GSZ), y1 = Math.floor((y + dy) / GSZ);
  for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
    const ids = GRID.get(gkey(ix, iy));
    if (!ids) continue;
    for (const id of ids) {
      const s = SPOTS.get(id);
      if (!s) continue;
      const d = dist(x, y, s.x, s.y);
      if (d <= r) res.push([s, d]);
    }
  }
  return res;
}

function setPrefSpots(pc, list) {
  for (const [id, s] of SPOTS) if (s.p === pc) SPOTS.delete(id);
  for (const s of list) SPOTS.set(s.id, s);
  applyMeijo(false);        // 版10：名城の札
  gridRebuild();
}

// ---------- 都県ごとの読み込み ----------
const prefQueue = [];
let prefBusy = null;
let onSpotsChanged = () => {};
let onPrefStatus = () => {};

async function restorePrefs() {
  for (const [pc] of PREFS) {
    try {
      const v = await DB.get('pref:' + pc);
      if (v && v.list && v.v !== PREF_DV) { await DB.del('pref:' + pc); continue; }  // 古い形は消して取り直す
      if (v && v.list) {
        const list = cleanList(v.list);
        // 古い振り分け方のデータは使いながら、次に必要になったときに取り直す
        const ft = (v.fr || 1) < DATA_REV ? 0 : (v.ft || v.t);
        PREF_META[pc] = { t: v.t, ft, n: list.length, src: v.src || 'live', fr: v.fr || 1 };
        for (const s of list) SPOTS.set(s.id, s);
      }
    } catch (e) { /* 読めなければ取り直す */ }
  }
  applyMeijo(false);
  gridRebuild();
}

// 版3：GitHub の側で前もって作ったファイル（data/spots-都県コード.json）を先に探す
// 同じサイト（GitHub Pages）→ GitHub の生ファイル（raw）の順。Pages の更新が遅れても raw で最新が取れる
const DATA_SRC = ['data/', 'https://raw.githubusercontent.com/nhori-navi/megu/main/data/'];
async function fetchStatic(pc) {
  const day = ymd(Date.now()).replace(/-/g, '');
  for (const base of DATA_SRC) {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 20000);
    try {
      const res = await fetch(base + 'spots-' + pc + '.json?d=' + day, { signal: ctl.signal, cache: 'no-cache' });
      clearTimeout(tm);
      if (!res.ok) continue;
      const js = await res.json();
      if (js && js.v === PREF_DV && Array.isArray(js.list) && js.list.length) return js;
    } catch (e) { clearTimeout(tm); }
  }
  return null;
}

function prefIsFresh(pc) {
  const m = PREF_META[pc];
  return m && Date.now() - (m.ft || m.t) < PREF_DAYS * 86400000;
}

function needPref(pc, force) {
  if (!PREF_NAME[pc]) return;
  if (prefBusy === pc || prefQueue.includes(pc)) return;
  if (!force && PREF_META[pc] && prefIsFresh(pc)) return;
  if (!force && PREF_FAIL[pc] && Date.now() - PREF_FAIL[pc] < PREF_RETRY_MIN * 60000) return; // 失敗したら少しの間は自動で頼まない
  prefQueue.push(pc);
  runPrefQueue();
}

async function runPrefQueue() {
  if (prefBusy || !prefQueue.length) return;
  const pc = prefQueue.shift();
  prefBusy = pc;
  onPrefStatus(pc, 'loading', '用意したデータを確認中');
  try {
    let list, t, src, fr = DATA_REV;
    const st = await fetchStatic(pc);
    if (st) {
      list = cleanList(st.list.map(s => Object.assign({}, s, { p: pc })));
      t = st.t; src = 'file'; fr = st.r || 1;
    } else {
      // 用意したファイルがないときだけ、その場で問い合わせる
      const tiles = prefTiles([pc]), parts = [];
      for (let i = 0; i < tiles.length; i++) {
        parts.push(await ovpFetch(ovpTileQuery(tiles[i]), label => onPrefStatus(pc, 'loading', `${label}に問い合わせ中（${i + 1}／${tiles.length}）`)));
      }
      list = parseOsm(mergeElements(parts), null).filter(s => s.p === pc);
      t = Date.now(); src = 'live';
    }
    // ファイルがまだ古い振り分け方なら、1日たったらもう一度取りに行く
    const ft = fr < DATA_REV ? Date.now() - (PREF_DAYS - 1) * 86400000 : Date.now();
    await DB.set('pref:' + pc, { v: PREF_DV, t, ft, src, fr, list });
    PREF_META[pc] = { t, ft, n: list.length, src, fr };
    delete PREF_FAIL[pc];
    setPrefSpots(pc, list);
    onPrefStatus(pc, 'done');
    onSpotsChanged();
  } catch (e) {
    PREF_FAIL[pc] = Date.now();
    onPrefStatus(pc, 'fail', jaErr(e));
  }
  prefBusy = null;
  runPrefQueue();
}

// 画面に入っている都県
// （東京都は島まで含むので、都県全体の四角ではなく市区町村ごとの四角で調べる）
function prefsInBounds(w, s, e, n) {
  const res = new Set();
  for (const c of CITY) {
    const b = c.bb;
    if (!(e < b[0] || w > b[2] || n < b[1] || s > b[3])) res.add(c.c.slice(0, 2));
  }
  return [...res];
}


// ---------- 版7：路線（地下鉄などで位置が途切れた間の駅を推定するため） ----------
// data/lines.json = {v, r, t, st:{駅の番号:[名前, 経度, 緯度, 都県]}, lines:[{n:路線名, s:[駅の番号…]}]}
let LINES = [];
const LINE_AT = new Map();     // 駅の番号 → [[路線の番号, 並びの位置], …]
let LINE_ST = {};
let LINE_META = null;
const LINE_GRID = new Map();   // 0.01°のマス → 駅の番号（路線にある駅だけ）

function setLines(js) {
  LINES = js.lines || [];
  LINE_ST = js.st || {};
  LINE_AT.clear(); LINE_GRID.clear();
  LINES.forEach((ln, li) => ln.s.forEach((id, i) => {
    if (!LINE_AT.has(id)) LINE_AT.set(id, []);
    LINE_AT.get(id).push([li, i]);
  }));
  for (const [id, v] of Object.entries(LINE_ST)) {
    const k = gkey(Math.floor(v[1] / GSZ), Math.floor(v[2] / GSZ));
    if (!LINE_GRID.has(k)) LINE_GRID.set(k, []);
    LINE_GRID.get(k).push(id);
  }
}

async function loadLines() {
  try {
    const c = await DB.get('lines');
    if (c && c.js) {
      setLines(c.js);
      LINE_META = { ft: c.ft, r: c.js.r || 1 };
      if (Date.now() - c.ft < PREF_DAYS * 86400000 && (c.js.r || 1) >= DATA_REV) return;
    }
  } catch (e) { /* 取り直す */ }
  const day = ymd(Date.now()).replace(/-/g, '');
  for (const base of DATA_SRC) {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 20000);
    try {
      const res = await fetch(base + 'lines.json?d=' + day, { signal: ctl.signal, cache: 'no-cache' });
      clearTimeout(tm);
      if (!res.ok) continue;
      const js = await res.json();
      if (!js || !Array.isArray(js.lines)) continue;
      setLines(js);
      // 古い振り分け方なら1日後にもう一度取りに行く
      const ft = (js.r || 1) < DATA_REV ? Date.now() - (PREF_DAYS - 1) * 86400000 : Date.now();
      LINE_META = { ft, r: js.r || 1 };
      try { await DB.set('lines', { ft, js }); } catch (e) { /* 保存できなくても使う */ }
      return;
    } catch (e) { clearTimeout(tm); }
  }
}

// その場所から r m 以内の、路線にある駅（近い順）
function lineStationsNear(x, y, r) {
  const res = [];
  const dy = r / 111000, dx = r / (111000 * Math.cos(y * Math.PI / 180));
  for (let ix = Math.floor((x - dx) / GSZ); ix <= Math.floor((x + dx) / GSZ); ix++)
    for (let iy = Math.floor((y - dy) / GSZ); iy <= Math.floor((y + dy) / GSZ); iy++)
      for (const id of (LINE_GRID.get(gkey(ix, iy)) || [])) {
        const v = LINE_ST[id];
        const d = dist(x, y, v[1], v[2]);
        if (d <= r) res.push([id, d]);
      }
  return res.sort((a, b) => a[1] - b[1]);
}

// 駅 A から駅 B までの、路線の上の駅の並び（同じ路線か、1回の乗り換え）
// 版7.1：急行だけの並び（渋谷→池袋のように途中の駅がない）を選ばないよう、道のりがいちばん短いものから15%以内の中で、駅のいちばん多いものを選ぶ
function pathLen(p) {
  let d = 0;
  for (let i = 1; i < p.length; i++) { const a = LINE_ST[p[i - 1]], b = LINE_ST[p[i]]; if (a && b) d += dist(a[1], a[2], b[1], b[2]); }
  return d;
}
function pickPath(cands) {
  if (!cands.length) return null;
  const withLen = cands.map(p => [p, pathLen(p)]);
  const min = Math.min(...withLen.map(c => c[1]));
  return withLen.filter(c => c[1] <= min * 1.15 + 1).sort((a, b) => b[0].length - a[0].length || a[1] - b[1])[0][0];
}
function linePath(A, B) {
  if (A === B) return null;
  const at = id => LINE_AT.get(id) || [];
  const seg = (li, i, j) => { const s = LINES[li].s; return i <= j ? s.slice(i, j + 1) : s.slice(j, i + 1).reverse(); };
  const same = [];
  for (const [la, ia] of at(A)) for (const [lb, ib] of at(B)) if (la === lb) same.push(seg(la, ia, ib));
  // 1回の乗り換え：A の路線と B の路線の両方にある駅 T（同じ路線で行けるときも、乗り換えのほうがずっと近いことがあるので比べる）
  const via = [];
  for (const [la, ia] of at(A)) {
    const sa = LINES[la].s;
    for (const [lb, ib] of at(B)) {
      if (la === lb) continue;
      const sb = LINES[lb].s;
      for (let it = 0; it < sa.length; it++) {
        const jt = sb.indexOf(sa[it]);
        if (jt < 0 || sa[it] === A || sa[it] === B) continue;
        via.push(seg(la, ia, it).concat(seg(lb, jt, ib).slice(1)));
      }
    }
  }
  const s1 = pickPath(same), s2 = pickPath(via);
  if (s1 && s2) return pathLen(s2) < pathLen(s1) * 0.7 ? s2 : s1;   // 乗り換えのほうが3割以上近いときだけ乗り換え
  return s1 || s2;
}

// 都県のデータを読み終えるまで待つ（GPX の読み込みで使う）
async function ensurePrefs(pcs, onWait) {
  for (const pc of pcs) {
    if (PREF_META[pc]) continue;
    needPref(pc, true);
    const t0 = Date.now();
    while (!PREF_META[pc] && Date.now() - t0 < 180000) {
      if (PREF_FAIL[pc] && PREF_FAIL[pc] >= t0) break;
      if (onWait) onWait(pc);
      await new Promise(r => setTimeout(r, 300));
    }
  }
}


// ---------- 版10：名城（日本100名城・続日本100名城のうち関東甲信越の41城） ----------
// data/meijo.json = {v, t, list:[{no, n, p, x, y, id}]}  id＝合わせた場所データの番号（なければ null。そのときはこのアプリで場所を補う）
let MEIJO = [];
const MEIJO_BY = new Map();     // 場所の番号 → 名城
function setMeijo(js) {
  MEIJO = (js && js.list) || [];
}
async function loadMeijo() {
  try {
    const c = await DB.get('meijo');
    if (c && c.js) { setMeijo(c.js); if (Date.now() - c.ft < PREF_DAYS * 86400000) return; }
  } catch (e) { /* 取り直す */ }
  const day = ymd(Date.now()).replace(/-/g, '');
  for (const base of DATA_SRC) {
    try {
      const res = await fetch(base + 'meijo.json?d=' + day, { cache: 'no-cache' });
      if (!res.ok) continue;
      const js = await res.json();
      if (!js || !Array.isArray(js.list) || !js.list.length) continue;
      setMeijo(js);
      try { await DB.set('meijo', { ft: Date.now(), js }); } catch (e) { /* 保存できなくても使う */ }
      return;
    } catch (e) { /* 次へ */ }
  }
}
// 読み込み済みの都県について、名城の札を付ける。場所データにない名城は、その都県を読み込んだあとで補う（番号 jm＋番号）
function applyMeijo(rebuild = true) {
  MEIJO_BY.clear();
  let changed = false;
  for (const m of MEIJO) {
    const sid = 'jm' + m.no;
    const s = m.id && SPOTS.get(m.id);
    if (s) {
      s.mj = m.no; MEIJO_BY.set(s.id, m);
      if (SPOTS.has(sid)) { SPOTS.delete(sid); changed = true; }
    } else if (PREF_META[m.p] && m.x != null) {
      if (!SPOTS.has(sid)) { SPOTS.set(sid, { id: sid, sh: 'hi', sub: '城跡', n: m.n, x: m.x, y: m.y, p: m.p, mj: m.no }); changed = true; }
      MEIJO_BY.set(sid, m);
    }
  }
  if (changed && rebuild) gridRebuild();
  return changed;
}
function meijoLabel(no) { return no >= 101 ? `続100名城 No.${no}` : `100名城 No.${no}`; }
// 名城の記録は、場所データの番号か補った番号（jm）のどちらかに付く
function meijoIds(m) { return m.id ? [m.id, 'jm' + m.no] : ['jm' + m.no]; }
function meijoOf(id) {
  if (MEIJO_BY.has(id)) return MEIJO_BY.get(id);
  return MEIJO.find(m => m.id === id || 'jm' + m.no === id) || null;
}
function meijoMainId(m) {
  const ids = meijoIds(m);
  return ids.find(id => REC[id]) || ids.find(id => SPOTS.has(id)) || ids[0];
}
function meijoLv(m) { return Math.max(...meijoIds(m).map(id => (REC[id] ? REC[id].lv : 0))); }
