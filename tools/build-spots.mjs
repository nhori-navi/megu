// build-spots.mjs：GitHub の側で、10都県の場所データ（data/spots-都県コード.json）・路線（data/lines.json）・名城（data/meijo.json）を作る（版10）
// 動かし方：GitHub の「Actions」→「場所データを作る」→「Run workflow」（毎月2日の朝にも自動で動く）
// OpenStreetMap の地域まるごとのファイル（Geofabrik の関東・中部）を Actions でダウンロードし、
//   ・osmium で駅などだけを抜き出したもの（GeoJSON の1行1件、名前が .geojsonseq）
//   ・鉄道の路線（route のまとまり）を抜き出したもの（OPL という1行1件の文字の形、名前が .opl）
// を読む。使い方：node tools/build-spots.mjs a.geojsonseq b.geojsonseq a-routes.opl b-routes.opl
// アプリと同じ整え方を使うため、js/base.js と js/data.js をそのまま読み込む
import fs from 'node:fs';
import vm from 'node:vm';
import readline from 'node:readline';

const ctx = vm.createContext({ console, setTimeout, clearTimeout });
for (const f of ['js/base.js', 'js/data.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
ctx.__city = JSON.parse(fs.readFileSync('data/city.json', 'utf8'));
vm.runInContext('initCity(__city)', ctx);
const { PREFS, PREF_DV, DATA_REV, parseOsm, stationName, dist, prefOfPoint } =
  vm.runInContext('({ PREFS, PREF_DV, DATA_REV, parseOsm, stationName, dist, prefOfPoint })', ctx);

// GeoJSON の1件を、Overpass と同じ形（点は lat/lon、線や面は center）にする
function toElement(f) {
  const p = f.properties || {};
  const type = p['@type'], id = p['@id'];
  if (!type || id == null || !f.geometry) return null;
  const tags = {};
  for (const [k, v] of Object.entries(p)) if (k[0] !== '@') tags[k] = String(v);
  const g = f.geometry;
  if (g.type === 'Point') return { type, id, tags, lon: g.coordinates[0], lat: g.coordinates[1] };
  let w = 999, s = 999, e = -999, n = -999;
  const walk = a => {
    if (typeof a[0] === 'number') { w = Math.min(w, a[0]); e = Math.max(e, a[0]); s = Math.min(s, a[1]); n = Math.max(n, a[1]); }
    else for (const b of a) walk(b);
  };
  walk(g.coordinates);
  if (w > e) return null;
  return { type, id, tags, center: { lon: (w + e) / 2, lat: (s + n) / 2 } };
}

const args = process.argv.slice(2);
const spotFiles = args.filter(f => !f.endsWith('.opl'));
const routeFiles = args.filter(f => f.endsWith('.opl'));
if (!spotFiles.length) { console.log('抜き出したファイルを指定してください'); process.exit(1); }

// ---------- 場所 ----------
const seen = new Set(), elements = [];
for (const file of spotFiles) {
  let n = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.replace(/^\x1e/, '').trim();
    if (!t) continue;
    let f;
    try { f = JSON.parse(t); } catch (e) { continue; }
    const el = toElement(f);
    if (!el) continue;
    const k = el.type + el.id;
    if (seen.has(k)) continue;      // 同じもの（地域の重なりや、線と面の両方で出たもの）は1つに
    seen.add(k); elements.push(el); n++;
  }
  console.log(`${file}：${n}件を読みました`);
}

const all = parseOsm({ elements }, null);
fs.mkdirSync('data', { recursive: true });
let failed = 0;
for (const [pc, name] of PREFS) {
  const list = all.filter(s => s.p === pc).map(s => { const o = Object.assign({}, s); delete o.p; return o; });
  if (!list.length) { failed++; console.log(`✗ ${name}：0件でした（前のファイルがあればそのまま残します）`); continue; }
  const cnt = {};
  for (const s of list) cnt[s.sh] = (cnt[s.sh] || 0) + 1;
  const under = list.filter(s => s.u).length;
  fs.writeFileSync(`data/spots-${pc}.json`, JSON.stringify({ v: PREF_DV, r: DATA_REV, t: Date.now(), pc, n: list.length, src: 'OpenStreetMap contributors (ODbL)', list }));
  console.log(`○ ${name}：${list.length}件（駅 ${cnt.st || 0}〔うち地下 ${under}〕・道の駅 ${cnt.mi || 0}・ミュージアム ${cnt.mu || 0}・史跡 ${cnt.hi || 0}）`);
}

// ---------- 路線 ----------
// OPL の文字の決まり：%xxxx% は文字の番号（16進）
const unesc = s => s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
function parseTags(t) {
  const o = {};
  if (!t) return o;
  for (const kv of t.split(',')) {
    const i = kv.indexOf('=');
    if (i > 0) o[unesc(kv.slice(0, i))] = unesc(kv.slice(i + 1));
  }
  return o;
}
function oplFields(line) {
  const f = {};
  for (const part of line.split(' ')) if (part) f[part[0]] = part.slice(1);
  return f;
}

async function buildLines() {
  const nodes = new Map();   // 名前などの付いた点だけ覚える（線路の点は覚えない）
  const rels = [];
  for (const file of routeFiles) {
    const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
    let nr = 0;
    for await (const line of rl) {
      if (line[0] === 'n') {
        const f = oplFields(line);
        if (!f.T) continue;
        const tags = parseTags(f.T);
        if (!tags.name) continue;
        nodes.set(line.slice(1, line.indexOf(' ')), { x: +f.x, y: +f.y, name: tags.name });
      } else if (line[0] === 'r') {
        const f = oplFields(line);
        const tags = parseTags(f.T);
        if (tags.type !== 'route' || !['train', 'subway', 'light_rail', 'monorail', 'railway'].includes(tags.route)) continue;
        const mem = (f.M || '').split(',').filter(Boolean).map(m => {
          const at = m.indexOf('@');
          return { type: m[0], ref: m.slice(1, at), role: unesc(m.slice(at + 1)) };
        });
        rels.push({ id: line.slice(1, line.indexOf(' ')), name: tags.name || tags.ref || '', mem });
        nr++;
      }
    }
    console.log(`${file}：路線 ${nr}本を読みました`);
  }

  // 駅の索引（0.01°のマス）
  const stations = all.filter(s => s.sh === 'st');
  const grid = new Map();
  const key = (x, y) => Math.floor(x / 0.01) + ',' + Math.floor(y / 0.01);
  for (const s of stations) { const k = key(s.x, s.y); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(s); }
  const near = (x, y, r) => {
    const out = [];
    const ix = Math.floor(x / 0.01), iy = Math.floor(y / 0.01);
    for (let a = ix - 1; a <= ix + 1; a++) for (let b = iy - 1; b <= iy + 1; b++)
      for (const s of (grid.get(a + ',' + b) || [])) { const d = dist(x, y, s.x, s.y); if (d <= r) out.push([s, d]); }
    return out.sort((p, q) => p[1] - q[1]);
  };
  // 停車位置の点 → 手元の駅（同じ名前なら600m以内、違う名前なら250m以内の一番近い駅）
  const toStation = nd => {
    const cand = near(nd.x, nd.y, 600);
    const same = cand.find(([s]) => s.n === stationName(nd.name));
    if (same) return same[0];
    const c = cand.find(([, d]) => d <= 250);
    return c ? c[0] : null;
  };

  const lines = [], keys = new Set(), used = new Map();
  for (const r of rels) {
    const ids = [];
    for (const m of r.mem) {
      if (m.type !== 'n' || !/^(stop|station)/.test(m.role)) continue;
      const nd = nodes.get(m.ref);
      if (!nd) continue;
      const s = toStation(nd);
      if (!s) continue;
      if (ids[ids.length - 1] !== s.id) ids.push(s.id);
      used.set(s.id, s);
    }
    if (ids.length < 2) continue;
    const k1 = ids.join(','), k2 = ids.slice().reverse().join(',');
    if (keys.has(k1) || keys.has(k2)) continue;   // 上りと下りの同じ並びは1本に
    keys.add(k1);
    lines.push({ n: r.name, s: ids });
  }
  const st = {};
  for (const [id, s] of used) st[id] = [s.n, s.x, s.y, s.p];
  return { lines, st };
}

// ---------- 名城（版10） ----------
// 日本100名城・続日本100名城のうち関東甲信越の41城。[番号, 名前, 都県, Wikipedia の記事名の候補]
const MEIJO = [
  [14, '水戸城', '08', ['水戸城']], [15, '足利氏館', '09', ['足利氏館', '鑁阿寺']], [16, '箕輪城', '10', ['箕輪城']],
  [17, '金山城', '10', ['金山城 (上野国)', '金山城']], [18, '鉢形城', '11', ['鉢形城']], [19, '川越城', '11', ['川越城']],
  [20, '佐倉城', '12', ['佐倉城']], [21, '江戸城', '13', ['江戸城']], [22, '八王子城', '13', ['八王子城']],
  [23, '小田原城', '14', ['小田原城']], [24, '武田氏館', '19', ['躑躅ヶ崎館', '武田氏館']], [25, '甲府城', '19', ['甲府城']],
  [26, '松代城', '20', ['松代城']], [27, '上田城', '20', ['上田城']], [28, '小諸城', '20', ['小諸城']],
  [29, '松本城', '20', ['松本城']], [30, '高遠城', '20', ['高遠城']], [31, '新発田城', '15', ['新発田城']],
  [32, '春日山城', '15', ['春日山城']],
  [113, '笠間城', '08', ['笠間城']], [114, '土浦城', '08', ['土浦城']], [115, '唐沢山城', '09', ['唐沢山城']],
  [116, '名胡桃城', '10', ['名胡桃城']], [117, '沼田城', '10', ['沼田城']], [118, '岩櫃城', '10', ['岩櫃城']],
  [119, '忍城', '11', ['忍城']], [120, '杉山城', '11', ['杉山城 (武蔵国)', '杉山城']], [121, '菅谷館', '11', ['菅谷館']],
  [122, '本佐倉城', '12', ['本佐倉城']], [123, '大多喜城', '12', ['大多喜城']], [124, '滝山城', '13', ['滝山城 (武蔵国)', '滝山城']],
  [125, '品川台場', '13', ['品川台場']], [126, '小机城', '14', ['小机城']], [127, '石垣山城', '14', ['石垣山城']],
  [128, '新府城', '19', ['新府城']], [129, '要害山城', '19', ['要害山城 (甲斐国)', '要害山城']], [130, '龍岡城', '20', ['龍岡城']],
  [131, '高島城', '20', ['高島城 (信濃国)', '高島城']], [132, '村上城', '15', ['村上城']], [133, '高田城', '15', ['高田城 (越後国)', '高田城']],
  [134, '鮫ヶ尾城', '15', ['鮫ヶ尾城']]
];

// Wikipedia から位置を受け取る（記事名 → {lat, lon}）
async function wikiCoords(titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += 40) {
    const part = titles.slice(i, i + 40);
    const url = 'https://ja.wikipedia.org/w/api.php?action=query&prop=coordinates&redirects=1&format=json&formatversion=2&titles=' + encodeURIComponent(part.join('|'));
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'MeguMiru-data-builder (github.com/nhori-navi/megu)' } });
      if (!res.ok) { console.log(`  Wikipedia：HTTP ${res.status}`); continue; }
      const js = await res.json();
      const q = js.query || {};
      const map = {};
      for (const n of (q.normalized || [])) map[n.from] = n.to;
      for (const r of (q.redirects || [])) map[r.from] = r.to;
      const byTitle = {};
      for (const pg of (q.pages || [])) if (pg.coordinates && pg.coordinates[0]) byTitle[pg.title] = { lat: pg.coordinates[0].lat, lon: pg.coordinates[0].lon };
      for (const t of part) {
        let k = t, guard = 0;
        while (map[k] && guard++ < 5) k = map[k];
        if (byTitle[k]) out[t] = byTitle[k];
      }
    } catch (e) { console.log('  Wikipedia：' + e.message); }
  }
  return out;
}

async function buildMeijo() {
  const titles = [...new Set(MEIJO.flatMap(m => m[3]))];
  const wc = await wikiCoords(titles);
  const castles = all.filter(s => s.sh === 'hi' && s.sub === '城跡');
  const list = [];
  let fromOsm = 0, fromWiki = 0;
  for (const [no, n, pc, ts] of MEIJO) {
    // Wikipedia の位置：候補の記事名を順に試し、その都県にあるものを使う
    let ref = null, wt = null;
    for (const t of ts) { const c = wc[t]; if (c && prefOfPoint(c.lon, c.lat) === pc) { ref = c; wt = t; break; } }
    // 場所データの城跡と合わせる：名前（「城」「館」を除いた部分）を含み、Wikipedia の位置から3km以内（位置がなければ同じ都県で1つだけ）
    const base = n.replace(/(城|館)$/, '');
    let cand = castles.filter(s => s.p === pc && base.length >= 2 && s.n.includes(base));
    if (n === '忍城') cand = castles.filter(s => s.p === pc && /^忍城/.test(s.n));
    let hit = null;
    if (ref) {
      cand = cand.map(s => [s, dist(ref.lon, ref.lat, s.x, s.y)]).filter(([, d]) => d <= 3000).sort((a, b) => a[1] - b[1]);
      if (cand.length) hit = cand[0][0];
      else {   // 名前が違っても、Wikipedia の位置から400m以内の城跡（〇〇城址公園など）
        const near = castles.filter(s => s.p === pc).map(s => [s, dist(ref.lon, ref.lat, s.x, s.y)]).filter(([, d]) => d <= 400).sort((a, b) => a[1] - b[1]);
        if (near.length) hit = near[0][0];
      }
    } else {
      const exact = cand.filter(s => s.n.startsWith(n));
      if (cand.length === 1) hit = cand[0]; else if (exact.length === 1) hit = exact[0];
    }
    if (hit) fromOsm++; else if (ref) fromWiki++;
    if (!hit && !ref) { console.log(`  ✗ ${n}：場所が分かりませんでした`); continue; }
    list.push({ no, n, p: pc, x: hit ? hit.x : Math.round(ref.lon * 1e5) / 1e5, y: hit ? hit.y : Math.round(ref.lat * 1e5) / 1e5, id: hit ? hit.id : null, on: hit ? hit.n : null, wt });
  }
  return { list, fromOsm, fromWiki };
}

{
  const { list, fromOsm, fromWiki } = await buildMeijo();
  if (list.length) {
    fs.writeFileSync('data/meijo.json', JSON.stringify({ v: 1, t: Date.now(), src: 'OpenStreetMap contributors (ODbL) / Wikipedia', list }));
    console.log(`○ 名城：${list.length}／${MEIJO.length}城（場所データの城跡と合わせた ${fromOsm}・Wikipedia の位置で補った ${fromWiki}）`);
  } else console.log('✗ 名城：作れませんでした（前のファイルがあればそのまま残します）');
}

if (routeFiles.length) {
  const { lines, st } = await buildLines();
  if (lines.length) {
    fs.writeFileSync('data/lines.json', JSON.stringify({ v: 1, r: DATA_REV, t: Date.now(), src: 'OpenStreetMap contributors (ODbL)', st, lines }));
    console.log(`○ 路線：${lines.length}本（駅 ${Object.keys(st).length}）`);
  } else { failed++; console.log('✗ 路線：0本でした（前のファイルがあればそのまま残します）'); }
}

if (failed) { console.log(`${failed}件が保存できませんでした`); process.exitCode = 1; }
else console.log('全部できました');
