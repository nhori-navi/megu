// build-spots.mjs：GitHub の側で、10都県の場所データ（data/spots-都県コード.json）・路線（data/lines.json）・名城（data/meijo.json）を作る（版11：路線のまとまりと線路の形 data/rails.json も）
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

const RAIL_ROUTES = ['train', 'subway', 'light_rail', 'monorail', 'railway', 'tram'];

// 路線名から向き（「: 本八幡→新宿」「（下り）」など）を外して、同じ路線をまとめる名前にする
// 新幹線の列車の名前 → 路線の名前
const SHINKANSEN = {};
for (const [line, names] of [['東北新幹線', 'はやぶさ やまびこ なすの はやて こまち つばさ'], ['上越新幹線', 'とき たにがわ'],
  ['北陸新幹線', 'あさま かがやき はくたか Hakutaka'], ['東海道新幹線', 'こだま ひかり のぞみ']]) for (const n of names.split(' ')) SHINKANSEN[n] = line;
function cleanLineName(n) {
  const t = cleanName0(n);
  const base = t.replace(/\s*[（(][^（）()]*[）)]$/, '').replace(/(列車|号)$/, '').trim();
  return SHINKANSEN[base] || t;
}
function cleanName0(n) {
  let t = String(n || '').trim();
  t = t.replace(/\s*[（(](古い|旧)[）)]\s*/g, '');
  t = t.replace(/\s*[:：]\s*.*$/, '');
  t = t.replace(/\s*[（(][^（）()]*(→|->|=>|⇒|－|〜|~|上り|下り|方面|行き|方向|内回り|外回り)[^（）()]*[）)]\s*/g, '');
  t = t.replace(/\s*[（(](上り|下り|内回り|外回り)[）)]\s*$/, '');
  t = t.replace(/\s+(上り|下り|内回り|外回り)$/, '');
  t = t.replace(/\s+[^\s]+\s*(→|->|=>|⇒)\s*[^\s]+$/, '');
  t = t.replace(/\s+各駅停車$/, '');
  t = t.replace(/\s*\((inbound|outbound|outbond|northbound|southbound|eastbound|westbound)\)/ig, '');
  t = t.replace(/線(上り|下り)$/, '線');
  return t.trim() || String(n || '').trim();
}

// 会社の名前（OSM の operator を、ふだんの呼び方に）
const OPERATOR = [
  [/東日本旅客鉄道|JR東日本/, 'JR東日本'], [/東海旅客鉄道|JR東海/, 'JR東海'], [/東京地下鉄|東京メトロ/, '東京メトロ'],
  [/東京都交通局|都営/, '都営'], [/東急/, '東急'], [/京王/, '京王'], [/小田急/, '小田急'], [/西武/, '西武'], [/東武/, '東武'],
  [/京成/, '京成'], [/京浜急行|京急/, '京急'], [/相模鉄道|相鉄/, '相鉄'], [/横浜市交通局|横浜市営/, '横浜市営地下鉄'],
  [/首都圏新都市鉄道|つくばエクスプレス/, 'つくばエクスプレス'], [/ゆりかもめ/, 'ゆりかもめ'], [/東京臨海高速鉄道|りんかい/, 'りんかい線'],
  [/東京モノレール/, '東京モノレール'], [/多摩都市モノレール/, '多摩モノレール'], [/横浜高速鉄道/, '横浜高速鉄道'],
  [/埼玉高速鉄道/, '埼玉高速鉄道'], [/北総/, '北総鉄道'], [/新京成/, '新京成'], [/江ノ島電鉄|江ノ電/, '江ノ電'],
  [/富士山麓電気鉄道|富士急/, '富士急'], [/しなの鉄道/, 'しなの鉄道'], [/えちごトキめき/, 'えちごトキめき鉄道']
];
function companyOf(tags, name) {
  for (const v of [tags.operator, tags.network, name]) {
    if (!v) continue;
    for (const [re, n] of OPERATOR) if (re.test(v)) return n;
  }
  if (/^JR/.test(name)) return 'JR東日本';
  return tags.operator ? String(tags.operator).split(/[;；]/)[0] : 'その他';
}

const ekey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

// 線路の形を、1mくらいの細かさを残して点を減らす（ダグラス・ポーカー法、m の単位で）
function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const y0 = pts[0][1] * Math.PI / 180, kx = 111320 * Math.cos(y0), ky = 110540;
  const P = pts.map(([x, y]) => [x * kx, y * ky]);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [i, j] = st.pop();
    const [ax, ay] = P[i], [bx, by] = P[j];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let md = -1, mk = -1;
    for (let k = i + 1; k < j; k++) {
      const [px, py] = P[k];
      let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey;
      if (d > md) { md = d; mk = k; }
    }
    if (mk > 0 && md > tol * tol) { keep[mk] = 1; st.push([i, mk], [mk, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// 列車の名前・急行・直通運転などのまとまりか（路線そのものではないもの）
const LINE_WORD = /線|ライン|鉄道|電鉄|モノレール|ゆりかもめ|エクスプレス|ケーブル|シーサイド/;
const SERVICE_WORD = /列車|特急|(?<!京浜|富士)急行|快速|快特|直通|stopping|service|通勤|準急|普通|s-train|号$|はくたか|hakutaka|エクスプレス$|(?<!舎人)ライナー/i;
function isService(n) { return SERVICE_WORD.test(n) || !LINE_WORD.test(n); }

// 2) 同じ名前の路線をまとめ、隣り合う駅の間（区間）を集める（routes：[{ids, gname, co, …}]）
function groupLines(routes) {
  //    急行などで途中の駅を飛ばした区間は、同じまとまりに途中の駅のある並びがあれば区間にしない
  const groups = new Map();
  for (const rt of routes) {
    if (!groups.has(rt.gname)) groups.set(rt.gname, { n: rt.gname, cos: {}, routes: [] });
    const g = groups.get(rt.gname);
    g.routes.push(rt); g.cos[rt.co] = (g.cos[rt.co] || 0) + rt.ids.length;
  }
  const posIn = ids => { const m = new Map(); ids.forEach((id, i) => { if (!m.has(id)) m.set(id, []); m.get(id).push(i); }); return m; };
  const gapOf = (pm, a, b) => {
    const pa = pm.get(a), pb = pm.get(b);
    if (!pa || !pb) return null;
    let md = Infinity;
    for (const i of pa) for (const j of pb) md = Math.min(md, Math.abs(i - j));
    return md;
  };
  for (const g of groups.values()) {
    const pms = g.routes.map(rt => posIn(rt.ids));
    g.edges = new Map();     // 区間 → [a, b, 使う並び]
    g.routes.forEach((rt, ri) => {
      for (let i = 1; i < rt.ids.length; i++) {
        const a = rt.ids[i - 1], b = rt.ids[i], k = ekey(a, b);
        if (g.edges.has(k)) continue;
        if (pms.some(pm => { const d = gapOf(pm, a, b); return d != null && d > 1; })) continue;   // 飛ばした区間
        g.edges.set(k, [a, b, ri]);
      }
    });
  }
  // 3) 列車の名前（踊り子・はやて など）のように、ほかの路線の区間だけでできているまとまりは外す（小さい方から）
  const pmAll = [...groups.values()].map(g => ({ g, pms: g.routes.map(rt => posIn(rt.ids)) }));
  const alive = new Set(groups.values());
  const covered = (g, a, b, linesOnly) => {
    for (const o of pmAll) {
      if (o.g === g || !alive.has(o.g) || (linesOnly && isService(o.g.n))) continue;
      if (o.g.edges.has(ekey(a, b))) return true;
      // 路線どうしは同じ区間があるときだけ（新幹線と在来線のように、駅を共有して別の線路を走るものがあるため）
      if (!linesOnly && o.pms.some(pm => { const d = gapOf(pm, a, b); return d != null && d > 1; })) return true;
    }
    return false;
  };
  //    先に列車の名前・急行・直通などのまとまり（ほかのどれかで足りていれば外す）、次に路線（ほかの路線で足りていれば外す）
  const svc = g => isService(g.n);
  const order = [...groups.values()].sort((p, q) => (svc(q) - svc(p)) || (p.edges.size - q.edges.size));
  for (const g of order) {
    // 飛ばした区間しかない（急行だけの並び）まとまりは、もとの並びの区間で調べる
    const pairs = g.edges.size ? [...g.edges.values()] : g.routes.flatMap(rt => rt.ids.slice(1).map((b, i) => [rt.ids[i], b]));
    const left = pairs.filter(([a, b]) => !covered(g, a, b, !svc(g))).length;
    // 列車の名前などは、ほかの路線と重なっていて、ほかにない区間が2つ以下（乗り入れのつなぎの線路など）なら外す
    if (!g.edges.size || left === 0 || (svc(g) && left <= 2 && left < pairs.length)) alive.delete(g);
  }

  return { groups, alive };
}

async function buildLines() {
  const nodes = new Map();   // 名前などの付いた点だけ覚える（線路の点は覚えない）
  const ways = new Map();    // 線路：番号 → {n:[点の番号], x:[], y:[]}
  const rels = [], masters = [];
  let nway = 0;
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
      } else if (line[0] === 'w') {
        const f = oplFields(line);
        if (!f.N) continue;
        const ns = [], xs = [], ys = [];
        for (const r of f.N.split(',')) {
          const m = /^n(\d+)(?:x([-\d.]+)y([-\d.]+))?$/.exec(r);
          if (!m || m[2] == null) continue;     // 位置のない点（地域の外）は飛ばす
          ns.push(m[1]); xs.push(+m[2]); ys.push(+m[3]);
        }
        if (ns.length >= 2) { ways.set(line.slice(1, line.indexOf(' ')), { n: ns, x: xs, y: ys }); nway++; }
      } else if (line[0] === 'r') {
        const f = oplFields(line);
        const tags = parseTags(f.T);
        const mem = (f.M || '').split(',').filter(Boolean).map(m => {
          const at = m.indexOf('@');
          return { type: m[0], ref: m.slice(1, at), role: unesc(m.slice(at + 1)) };
        });
        const id = line.slice(1, line.indexOf(' '));
        if (tags.type === 'route_master' && RAIL_ROUTES.includes(tags.route_master)) masters.push({ id, tags, mem });
        if (tags.type !== 'route' || !RAIL_ROUTES.includes(tags.route)) continue;
        rels.push({ id, name: tags.name || tags.ref || '', tags, mem });
        nr++;
      }
    }
    console.log(`${file}：路線 ${nr}本を読みました`);
  }
  console.log(`  線路の形：${nway}本`);

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
    const same = cand.find(([s]) => s.n === stationName(nd.name) || s.n === stationName(nd.name, '停留場'));
    if (same) return same[0];
    const c = cand.find(([, d]) => d <= 250);
    return c ? c[0] : null;
  };

  // 1) 路線ごとの駅の並び（停車位置の点も覚える：線路の形を切り出すのに使う）
  const masterOf = new Map();
  for (const m of masters) for (const x of m.mem) if (x.type === 'r') masterOf.set(x.ref, m);
  const routes = [];
  const lines = [], keys = new Set(), used = new Map();
  for (const r of rels) {
    const ids = [], stops = [];
    for (const m of r.mem) {
      if (m.type !== 'n' || !/^(stop|station)/.test(m.role)) continue;
      const nd = nodes.get(m.ref);
      if (!nd) continue;
      const s = toStation(nd);
      if (!s) continue;
      if (ids[ids.length - 1] === s.id) continue;
      ids.push(s.id); stops.push(m.ref);
      used.set(s.id, s);
    }
    if (ids.length < 2) continue;
    const ms = masterOf.get(r.id);
    const gname = cleanLineName(ms && ms.tags.name ? ms.tags.name : r.name);
    routes.push({ r, ids, stops, gname, co: companyOf(Object.assign({}, ms ? ms.tags : {}, r.tags), gname) });
    const k1 = ids.join(','), k2 = ids.slice().reverse().join(',');
    if (keys.has(k1) || keys.has(k2)) continue;   // 上りと下りの同じ並びは1本に（途切れた間の推定に使う並び）
    keys.add(k1);
    lines.push({ n: r.name, s: ids });
  }

  const { groups, alive } = groupLines(routes);

  // 4) 区間をつないで、駅の並び（枝分かれや環状もあるので、いくつかの並び）にする
  const chainsOf = edges => {
    const adj = new Map();
    for (const [a, b] of edges.values()) {
      if (!adj.has(a)) adj.set(a, new Set()); if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b); adj.get(b).add(a);
    }
    const done = new Set(), chains = [];
    const walk = (s, n) => {
      const ch = [s, n]; done.add(ekey(s, n));
      let prev = s, cur = n;
      while (adj.get(cur).size === 2) {
        const nx = [...adj.get(cur)].find(v => v !== prev);
        if (done.has(ekey(cur, nx))) break;
        done.add(ekey(cur, nx)); ch.push(nx); prev = cur; cur = nx;
      }
      return ch;
    };
    const starts = [...adj.keys()].filter(v => adj.get(v).size !== 2);
    for (const s of starts) for (const n of adj.get(s)) if (!done.has(ekey(s, n))) chains.push(walk(s, n));
    for (const s of adj.keys()) for (const n of adj.get(s)) if (!done.has(ekey(s, n))) chains.push(walk(s, n));   // 環状
    return chains.sort((p, q) => q.length - p.length);
  };

  // 5) 線路の形：その並びの線路をつないだ網の上で、駅から駅への最短の道
  const rails = {};
  let railOk = 0, railNg = 0;
  const graphOf = new Map();
  const buildGraph = rt => {
    if (graphOf.has(rt)) return graphOf.get(rt);
    const V = new Map();   // 点の番号 → {x, y, nb:[[点の番号, 距離]]}
    for (const m of rt.r.mem) {
      if (m.type !== 'w' || /platform|stop/.test(m.role)) continue;
      const w = ways.get(m.ref);
      if (!w) continue;
      for (let i = 0; i < w.n.length; i++) {
        if (!V.has(w.n[i])) V.set(w.n[i], { x: w.x[i], y: w.y[i], nb: [] });
        if (i) {
          const d = dist(w.x[i - 1], w.y[i - 1], w.x[i], w.y[i]);
          V.get(w.n[i - 1]).nb.push([w.n[i], d]); V.get(w.n[i]).nb.push([w.n[i - 1], d]);
        }
      }
    }
    graphOf.set(rt, V);
    return V;
  };
  const nearestV = (V, x, y) => {
    let best = null, bd = Infinity;
    for (const [id, v] of V) { const d = dist(x, y, v.x, v.y); if (d < bd) { bd = d; best = id; } }
    return bd <= 400 ? best : null;
  };
  const shortest = (V, s, t, lim) => {
    const D = new Map([[s, 0]]), prev = new Map(), heap = [[0, s]];
    const push = e => { heap.push(e); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) {
      const [d, u] = pop();
      if (u === t) break;
      if (d > (D.get(u) ?? Infinity) || d > lim) continue;
      for (const [v, w] of V.get(u).nb) {
        const nd = d + w;
        if (nd < (D.get(v) ?? Infinity)) { D.set(v, nd); prev.set(v, u); push([nd, v]); }
      }
    }
    if (!D.has(t)) return null;
    const path = [t];
    while (path[path.length - 1] !== s) path.push(prev.get(path[path.length - 1]));
    return path.reverse();
  };
  const groupsOut = [];
  for (const g of alive) {
    for (const [k, [a, b, ri]] of g.edges) {
      if (rails[k]) continue;
      const rt = g.routes[ri];
      const V = buildGraph(rt);
      if (!V.size) { railNg++; continue; }
      const ia = rt.ids.indexOf(a), ib = rt.ids.indexOf(b);
      const pick = (i, sid) => {
        const sn = rt.stops[i];
        if (V.has(sn)) return sn;
        const nd = nodes.get(sn) || { x: used.get(sid).x, y: used.get(sid).y };
        return nearestV(V, nd.x, nd.y);
      };
      const va = pick(ia, a), vb = pick(ib, b);
      const sa = used.get(a), sb = used.get(b);
      const straight = dist(sa.x, sa.y, sb.x, sb.y);
      const lim = Math.max(straight * 2.5, straight + 3000);
      const path = va && vb ? shortest(V, va, vb, lim) : null;
      if (!path || path.length < 2) { railNg++; continue; }
      let len = 0;
      for (let i = 1; i < path.length; i++) len += dist(V.get(path[i - 1]).x, V.get(path[i - 1]).y, V.get(path[i]).x, V.get(path[i]).y);
      if (len > lim) { railNg++; continue; }
      let pts = simplify(path.map(id => [V.get(id).x, V.get(id).y]), 6);
      if (a > b) pts = pts.reverse();            // いつも番号の小さい駅から
      const enc = [];
      let px = 0, py = 0;
      for (const [x, y] of pts) { const X = Math.round(x * 1e5), Y = Math.round(y * 1e5); enc.push(X - px, Y - py); px = X; py = Y; }
      rails[k] = enc; railOk++;
    }
    const co = Object.entries(g.cos).sort((p, q) => q[1] - p[1])[0][0];
    groupsOut.push({ n: g.n, co, c: chainsOf(g.edges) });
  }
  groupsOut.sort((p, q) => (p.co < q.co ? -1 : p.co > q.co ? 1 : p.n < q.n ? -1 : 1));
  const st = {};
  for (const [id, s] of used) st[id] = [s.n, s.x, s.y, s.p];
  console.log(`  路線のまとまり：${groupsOut.length}（外した列車の名前など ${groups.size - alive.size}）・線路の形 ${railOk}区間（取れなかった ${railNg}）`);
  return { lines, st, groups: groupsOut, rails };
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
    const url = 'https://ja.wikipedia.org/w/api.php?action=query&prop=coordinates&colimit=max&redirects=1&format=json&formatversion=2&titles=' + encodeURIComponent(part.join('|'));
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
  const { lines, st, groups, rails } = await buildLines();
  if (lines.length) {
    fs.writeFileSync('data/lines.json', JSON.stringify({ v: 2, r: DATA_REV, t: Date.now(), src: 'OpenStreetMap contributors (ODbL)', st, lines, g: groups }));
    console.log(`○ 路線：${lines.length}本（駅 ${Object.keys(st).length}・まとめた路線 ${groups.length}）`);
    if (Object.keys(rails).length) {
      fs.writeFileSync('data/rails.json', JSON.stringify({ v: 1, r: DATA_REV, t: Date.now(), src: 'OpenStreetMap contributors (ODbL)', k: rails }));
      console.log(`○ 線路の形：${Object.keys(rails).length}区間（${Math.round(fs.statSync('data/rails.json').size / 1024)}KB）`);
    } else console.log('✗ 線路の形：取れませんでした（前のファイルがあればそのまま残します）');
  } else { failed++; console.log('✗ 路線：0本でした（前のファイルがあればそのまま残します）'); }
}

if (failed) { console.log(`${failed}件が保存できませんでした`); process.exitCode = 1; }
else console.log('全部できました');
