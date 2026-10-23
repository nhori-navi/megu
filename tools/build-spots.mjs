// build-spots.mjs：GitHub の側で、10都県の場所データ（data/spots-都県コード.json）を作る
// 動かし方：GitHub の「Actions」→「場所データを作る」→「Run workflow」（毎月2日の朝にも自動で動く）
// アプリと同じ問い合わせ・同じ整え方を使うため、js/base.js と js/data.js をそのまま読み込む
import fs from 'node:fs';
import vm from 'node:vm';

const FAST = !!process.env.MEGU_FAST;           // 試験用（待ち時間を短くする）
const ONLY = (process.env.MEGU_PREFS || '').split(',').filter(Boolean);
const WAIT = ms => new Promise(r => setTimeout(r, FAST ? 5 : ms));

const ctx = vm.createContext({ console, fetch, AbortController, setTimeout, clearTimeout, encodeURIComponent });
for (const f of ['js/base.js', 'js/data.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
const { PREFS, PREF_DV, parseOsm, ovpQuery, OVP_SERVERS } = vm.runInContext('({ PREFS, PREF_DV, parseOsm, ovpQuery, OVP_SERVERS })', ctx);

async function ask(q) {
  // 3か所を順番に、最大6回。だめなら少しずつ長く待つ
  const errs = [];
  for (let i = 0; i < 6; i++) {
    const [label, url] = OVP_SERVERS[i % OVP_SERVERS.length];
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), FAST ? 3000 : 240000);
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
      console.log(`  ${label} だめでした（${errs[errs.length - 1]}）。${20 * (i + 1)}秒待って次へ`);
      await WAIT(20000 * (i + 1));
    }
  }
  throw new Error(errs.join(' / '));
}

fs.mkdirSync('data', { recursive: true });
let failed = 0;
for (const [pc, name] of PREFS) {
  if (ONLY.length && !ONLY.includes(pc)) continue;
  console.log(`${name}（${pc}）を取得中…`);
  try {
    const q = ovpQuery(pc).replace('[timeout:60]', '[timeout:200]');
    const js = await ask(q);
    const list = parseOsm(js, pc).map(s => { const o = Object.assign({}, s); delete o.p; return o; });
    if (!list.length) throw new Error('0件でした');
    const cnt = {};
    for (const s of list) cnt[s.sh] = (cnt[s.sh] || 0) + 1;
    const out = { v: PREF_DV, t: Date.now(), pc, n: list.length, src: 'OpenStreetMap contributors (ODbL)', list };
    fs.writeFileSync(`data/spots-${pc}.json`, JSON.stringify(out));
    console.log(`  → ${list.length}件（駅 ${cnt.st || 0}・道の駅 ${cnt.mi || 0}・ミュージアム ${cnt.mu || 0}・史跡 ${cnt.hi || 0}）`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} は取れませんでした（前のファイルがあればそのまま残します）：${e.message}`);
  }
  await WAIT(10000);   // 相手のサーバーを休ませる
}
if (failed) { console.log(`${failed}都県が取れませんでした。時間をおいてもう一度動かしてください`); process.exitCode = 1; }
else console.log('全部できました');
