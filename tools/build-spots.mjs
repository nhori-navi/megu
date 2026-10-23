// build-spots.mjs：GitHub の側で、10都県の場所データ（data/spots-都県コード.json）を作る（版5）
// 動かし方：GitHub の「Actions」→「場所データを作る」→「Run workflow」（毎月2日の朝にも自動で動く）
// 版5：Overpass（問い合わせ窓口）が混んでいて取れないので、OpenStreetMap の地域まるごとのファイル（Geofabrik の関東・中部）を
//      ダウンロードし、osmium で駅などだけを抜き出したもの（GeoJSON の1行1件）を読む。
// 使い方：node tools/build-spots.mjs 抜き出したファイル1 抜き出したファイル2 …
// アプリと同じ整え方を使うため、js/base.js と js/data.js をそのまま読み込む
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ console, setTimeout, clearTimeout });
for (const f of ['js/base.js', 'js/data.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
ctx.__city = JSON.parse(fs.readFileSync('data/city.json', 'utf8'));
vm.runInContext('initCity(__city)', ctx);
const { PREFS, PREF_DV, parseOsm } = vm.runInContext('({ PREFS, PREF_DV, parseOsm })', ctx);

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

const files = process.argv.slice(2);
if (!files.length) { console.log('抜き出したファイルを指定してください'); process.exit(1); }
const seen = new Set(), elements = [];
for (const file of files) {
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
  fs.writeFileSync(`data/spots-${pc}.json`, JSON.stringify({ v: PREF_DV, t: Date.now(), pc, n: list.length, src: 'OpenStreetMap contributors (ODbL)', list }));
  console.log(`○ ${name}：${list.length}件（駅 ${cnt.st || 0}・道の駅 ${cnt.mi || 0}・ミュージアム ${cnt.mu || 0}・史跡 ${cnt.hi || 0}）`);
}
if (failed) { console.log(`${failed}都県が保存できませんでした`); process.exitCode = 1; }
else console.log('全部できました');
