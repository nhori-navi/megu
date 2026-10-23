// build-spots.mjs：GitHub の側で、10都県の場所データ（data/spots-都県コード.json）を作る（版4）
// 動かし方：GitHub の「Actions」→「場所データを作る」→「Run workflow」（毎月2日の朝にも自動で動く）
// アプリと同じ問い合わせ・同じ整え方を使うため、js/base.js と js/data.js をそのまま読み込む
// 版4：都県の境界で絞ると重すぎたので、約50km四方のマス（全部で約60）ごとに問い合わせ、市区町村の境界で都県に振り分ける
import fs from 'node:fs';
import vm from 'node:vm';

const FAST = !!process.env.MEGU_FAST;           // 試験用（待ち時間を短くする）
const ONLY = (process.env.MEGU_PREFS || '').split(',').filter(Boolean);
const WAIT = ms => new Promise(r => setTimeout(r, FAST ? 2 : ms));

const ctx = vm.createContext({ console, fetch, AbortController, setTimeout, clearTimeout, encodeURIComponent });
for (const f of ['js/base.js', 'js/data.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
ctx.__city = JSON.parse(fs.readFileSync('data/city.json', 'utf8'));
vm.runInContext('initCity(__city)', ctx);
const { PREFS, PREF_DV, parseOsm, ovpTileQuery, prefTiles, mergeElements, OVP_SERVERS } =
  vm.runInContext('({ PREFS, PREF_DV, parseOsm, ovpTileQuery, prefTiles, mergeElements, OVP_SERVERS })', ctx);

async function ask(q, tag) {
  // 3か所を順番に、最大6回。だめなら少しずつ長く待つ
  const errs = [];
  for (let i = 0; i < 6; i++) {
    const [label, url] = OVP_SERVERS[i % OVP_SERVERS.length];
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), FAST ? 3000 : 150000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'MeguMiru-data-builder (github.com/nhori-navi/megu)' },
        signal: ctl.signal
      });
      clearTimeout(tm);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const js = await res.json();
      if (js.remark && /runtime error|timed out|out of memory/i.test(js.remark)) throw new Error(js.remark.slice(0, 80));
      return js;
    } catch (e) {
      clearTimeout(tm);
      errs.push(`${label}: ${e.name === 'AbortError' ? '時間切れ' : e.message}`);
      console.log(`    ${tag} ${label} だめでした（${errs[errs.length - 1]}）。${15 * (i + 1)}秒待って次へ`);
      await WAIT(15000 * (i + 1));
    }
  }
  throw new Error(errs.join(' / '));
}

const targets = PREFS.filter(([pc]) => !ONLY.length || ONLY.includes(pc));
const tiles = prefTiles(targets.map(([pc]) => pc));
console.log(`${targets.map(p => p[1]).join('・')} を ${tiles.length}マスに分けて取得します`);

const parts = [];
const badTiles = [];
for (let i = 0; i < tiles.length; i++) {
  const t = tiles[i];
  const tag = `[${i + 1}/${tiles.length}] 北緯${t[0]}〜${t[2]}・東経${t[1]}〜${t[3]}`;
  try {
    const js = await ask(ovpTileQuery(t, 90), tag);
    parts.push(js);
    console.log(`  ${tag}：${(js.elements || []).length}件`);
  } catch (e) {
    badTiles.push(t);
    console.log(`  ✗ ${tag} は取れませんでした：${e.message}`);
  }
  await WAIT(3000);   // 相手のサーバーを休ませる
}

const all = parseOsm(mergeElements(parts), null);
fs.mkdirSync('data', { recursive: true });
let failed = 0;
for (const [pc, name] of targets) {
  // 取れなかったマスにかかる都県は、前のファイルをそのまま残す（半端なデータで上書きしない）
  const mine = prefTiles([pc]).map(String);
  if (badTiles.some(t => mine.includes(String(t)))) {
    failed++;
    console.log(`✗ ${name}：取れなかったマスがあるので、今回は保存しません`);
    continue;
  }
  const list = all.filter(s => s.p === pc).map(s => { const o = Object.assign({}, s); delete o.p; return o; });
  if (!list.length) { failed++; console.log(`✗ ${name}：0件でした`); continue; }
  const cnt = {};
  for (const s of list) cnt[s.sh] = (cnt[s.sh] || 0) + 1;
  fs.writeFileSync(`data/spots-${pc}.json`, JSON.stringify({ v: PREF_DV, t: Date.now(), pc, n: list.length, src: 'OpenStreetMap contributors (ODbL)', list }));
  console.log(`○ ${name}：${list.length}件（駅 ${cnt.st || 0}・道の駅 ${cnt.mi || 0}・ミュージアム ${cnt.mu || 0}・史跡 ${cnt.hi || 0}）`);
}
if (failed) { console.log(`${failed}都県が保存できませんでした。時間をおいてもう一度動かしてください`); process.exitCode = 1; }
else console.log('全部できました');
