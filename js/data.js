// data.js：市区町村の境界と、都県ごとの場所データ（MeguMiru 版1）

// Overpass（OpenStreetMap のデータを取り出す窓口）。上から順に頼む
const OVP_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
const OVP_LIMIT = 120000;      // 1か所あたりの待ち時間（ミリ秒）
const PREF_DAYS = 90;          // 都県のデータを取り直すまでの日数

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
  const js = await res.json();
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
  if (/^道の駅/.test(name)) {
    const bad = ['parking', 'toilets', 'restaurant', 'fast_food', 'cafe', 'vending_machine', 'fuel', 'ice_cream'];
    if (tags.shop || bad.includes(tags.amenity) || tags.tourism === 'information' || tags.building === 'yes' && tags.amenity) return null;
    return ['mi', '道の駅'];
  }
  if (tags.tourism === 'museum') return ['mu', museumSub(name, tags)];
  const tum = tags.site_type === 'tumulus' || tags.archaeological_site === 'tumulus' || tags.tomb === 'tumulus'
    || (tags.historic && /古墳|号墳/.test(name));
  if (tum) return ['hi', '古墳'];
  if (tags.historic === 'castle') return ['hi', '城跡'];
  return null;
}

function stationName(n) { return /駅$/.test(n) ? n : n + '駅'; }

// Overpass の結果を場所の一覧にする。同じ名前で近いものは1つにまとめる
function parseOsm(js, pc) {
  const out = [];
  const byName = new Map();
  for (const el of (js.elements || [])) {
    const tags = el.tags || {};
    const k = classify(tags);
    if (!k) continue;
    const x = el.lon != null ? el.lon : el.center && el.center.lon;
    const y = el.lat != null ? el.lat : el.center && el.center.lat;
    if (x == null || y == null) continue;
    const [sh, sub] = k;
    const n = sh === 'st' ? stationName(tags.name) : tags.name;
    const mergeM = sh === 'st' ? 400 : 300;
    const key = sh + '|' + n;
    const same = (byName.get(key) || []).find(s => dist(s.x, s.y, x, y) < mergeM);
    if (same) { if (!same.w && tags.wikipedia) same.w = tags.wikipedia; continue; }
    const s = {
      id: el.type[0] + el.id, sh, sub, n,
      x: Math.round(x * 1e5) / 1e5, y: Math.round(y * 1e5) / 1e5, p: pc
    };
    if (tags.wikipedia) s.w = tags.wikipedia;
    out.push(s);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(s);
  }
  return out;
}

function ovpQuery(pc) {
  return `[out:json][timeout:110];
area["ISO3166-2"="JP-${pc}"]["admin_level"="4"]->.a;
(
  node["railway"~"^(station|halt)$"]["name"](area.a);
  nwr["name"~"^道の駅"](area.a);
  nwr["tourism"="museum"]["name"](area.a);
  nwr["historic"="castle"]["name"](area.a);
  nwr["historic"="archaeological_site"]["site_type"="tumulus"]["name"](area.a);
  nwr["historic"="archaeological_site"]["archaeological_site"="tumulus"]["name"](area.a);
  nwr["historic"="tomb"]["tomb"="tumulus"]["name"](area.a);
  nwr["historic"]["name"~"古墳|号墳"](area.a);
);
out tags center;`;
}

async function ovpFetch(q) {
  let lastErr = null;
  for (const url of OVP_SERVERS) {
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
      if (!res.ok) { lastErr = new Error('混み合っています（' + res.status + '）'); continue; }
      const js = await res.json();
      if (js.remark && /runtime error|timed out/i.test(js.remark) && !(js.elements || []).length) {
        lastErr = new Error('時間切れでした'); continue;
      }
      return js;
    } catch (e) {
      clearTimeout(tm);
      lastErr = e;
    }
  }
  throw lastErr || new Error('取得できませんでした');
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
      if (v && v.list) {
        PREF_META[pc] = { t: v.t, n: v.list.length };
        for (const s of v.list) SPOTS.set(s.id, s);
      }
    } catch (e) { /* 読めなければ取り直す */ }
  }
  gridRebuild();
}

function prefIsFresh(pc) {
  const m = PREF_META[pc];
  return m && Date.now() - m.t < PREF_DAYS * 86400000;
}

function needPref(pc, force) {
  if (!PREF_NAME[pc]) return;
  if (!force && (PREF_META[pc] || prefBusy === pc || prefQueue.includes(pc))) return;
  if (!force && PREF_FAIL[pc] && Date.now() - PREF_FAIL[pc] < 10 * 60000) return; // 失敗したら10分は自動で頼まない
  if (prefBusy === pc || prefQueue.includes(pc)) return;
  prefQueue.push(pc);
  runPrefQueue();
}

async function runPrefQueue() {
  if (prefBusy || !prefQueue.length) return;
  const pc = prefQueue.shift();
  prefBusy = pc;
  onPrefStatus(pc, 'loading');
  try {
    const js = await ovpFetch(ovpQuery(pc));
    const list = parseOsm(js, pc);
    const t = Date.now();
    await DB.set('pref:' + pc, { t, list });
    PREF_META[pc] = { t, n: list.length };
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
