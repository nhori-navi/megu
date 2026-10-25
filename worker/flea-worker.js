// flea-worker.js：MeguMiru のフリマの取り次ぎ役（Cloudflare Workers に貼るプログラム。版13）
// ・アプリから頼まれたら、リサイクル運動市民の会（本部・埼玉本部）の開催予定を読みに行き、日付・会場・元のページへのリンクに整えて返す
// ・合言葉（Cloudflare の「KEY」という秘密の設定）を知っているアプリにだけ答える。集めた予定を公開しないため
// ・元のサイトへの負担を小さくするため、読んだページは Cloudflare に覚えてもらう（日程は12時間、中止の一覧は2時間、会場の住所は30日）
//   アプリの側でも、1日1回くらいしか頼まない
//
// 使い方（アプリから）
//   GET https://（このプログラムのアドレス）/?k=合言葉            → 開催予定 {v, t, ev:[…], err:[…]}
//   GET https://（このプログラムのアドレス）/venue?c=rc-013&k=合言葉 → 会場の住所と位置 {c, n, addr, x, y}

const RC = 'https://www2.recycler.jp/';      // リサイクル運動市民の会（東京・神奈川・千葉）
const FS = 'https://furima-s.com/';          // 同 埼玉本部
const UA = 'MeguMiru-flea (personal use; github.com/nhori-navi/megu)';
const PREFS = ['東京都', '神奈川県', '埼玉県', '千葉県', '茨城県', '栃木県', '群馬県', '山梨県', '長野県', '新潟県'];

export default {
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
    if (req.method === 'OPTIONS') return new Response('', { headers: cors });
    const url = new URL(req.url);
    if (!env.KEY) return json({ error: '合言葉（KEY）が Cloudflare に設定されていません' }, 500, cors);
    if (url.searchParams.get('k') !== env.KEY) return json({ error: '合言葉がちがいます' }, 403, cors);
    try {
      if (url.pathname === '/venue') return json(await venue(url.searchParams.get('c') || ''), 200, cors);
      return json(await events(), 200, cors);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 502, cors);
    }
  }
};

function json(o, status, headers) { return new Response(JSON.stringify(o), { status, headers }); }

// ページを読む（Cloudflare に ttl 秒覚えてもらう）
async function get(u, ttl) {
  const res = await fetch(u, { headers: { 'User-Agent': UA }, cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!res.ok) throw new Error(`${u}：HTTP ${res.status}`);
  return res.text();
}
const strip = s => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/[\s　]+/g, ' ').trim();
const pad = n => String(n).padStart(2, '0');
// 「中止」の字：雨天中止・中止案内・中止会場一覧などの決まりごとの言い回しは除く
const CANCEL = /(?<!雨天|小雨|荒天)中止(?!案内|会場|の場合|となる場合|する場合|が決まり)/;

// 日本時間の今日と、そこから n か月先の「YYYY-MM」
function jstNow() { return new Date(Date.now() + 9 * 3600000); }
function monthsAhead(n) {
  const d = jstNow(), out = [];
  for (let i = 0; i < n; i++) { const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1)); out.push(`${m.getUTCFullYear()}-${pad(m.getUTCMonth() + 1)}`); }
  return out;
}

// ---------- 本部（www2.recycler.jp） ----------
// 予定は hall_detail.php?eventautonum=会場コード＋年2桁＋月日4桁 のリンクで並んでいる
function parseRc(html, out, cancel) {
  const rows = html.split(/<tr[\s>]/i);
  for (const row of rows) {
    const re = /href="[^"]*hall_detail\.php\?eventautonum=(\d{7,})"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    const ids = new Map();
    while ((m = re.exec(row))) {
      const num = m[1], text = strip(m[2]);
      if (!ids.has(num)) ids.set(num, '');
      if (text && !/^\d{1,2}月\d{1,2}日/.test(text) && !ids.get(num)) ids.set(num, text);
    }
    for (const [num, name] of ids) {
      const code = num.slice(0, -6), yy = num.slice(-6, -4), mm = num.slice(-4, -2), dd = num.slice(-2);
      const id = 'rc-' + num;
      const rt = strip(row);
      const st = cancel || CANCEL.test(rt) ? '中止' : /延期/.test(rt) ? '延期' : '';
      const ev = out.get(id) || { id, d: `20${yy}-${mm}-${dd}`, vc: 'rc-' + code, n: '', url: RC + 'hall_detail.php?eventautonum=' + num, src: 'rc', st: '' };
      if (name && !ev.n) ev.n = name;
      if (st) ev.st = st;
      out.set(id, ev);
    }
  }
}

// ---------- 埼玉本部（furima-s.com） ----------
// 日程表の行：日付「10/24(土)」と、会場のページ kaijouannai/〇〇.htm へのリンク
function parseFs(html, out) {
  const now = jstNow(), y0 = now.getUTCFullYear(), m0 = now.getUTCMonth() + 1;
  for (const row of html.split(/<tr[\s>]/i)) {
    const t = strip(row);
    const dm = /(\d{1,2})\s*\/\s*(\d{1,2})\s*[（(]/.exec(t);
    const vm = /href="(?:\.\/)?(kaijouannai\/([\w-]+)\.html?)"[^>]*>([\s\S]*?)<\/a>/i.exec(row);
    if (!dm || !vm) continue;
    const mo = +dm[1], da = +dm[2];
    if (mo < 1 || mo > 12 || da < 1 || da > 31) continue;
    const y = mo < m0 - 2 ? y0 + 1 : y0;          // 年の書いていない日付：今より前の月なら来年
    const d = `${y}-${pad(mo)}-${pad(da)}`;
    const vc = 'fs-' + vm[2];
    const id = `${vc}-${d}`;
    out.set(id, { id, d, vc, n: strip(vm[3]).replace(/※.*$/, '').trim(), url: FS + 'link02.php', vurl: FS + vm[1], src: 'fs', st: CANCEL.test(t) ? '中止' : '' });
  }
}

async function events() {
  const out = new Map(), err = [];
  const months = monthsAhead(4);
  for (const mo of months) {
    try { parseRc(await get(`${RC}schedule.php?month=${mo}`, 43200), out, false); } catch (e) { err.push(String(e.message || e)); }
  }
  for (const mo of months.slice(0, 2)) {
    try { parseRc(await get(`${RC}cancel_list.php?month=${mo}`, 7200), out, true); } catch (e) { err.push(String(e.message || e)); }
  }
  try { parseFs(await get(`${FS}link02.php`, 43200), out); } catch (e) { err.push(String(e.message || e)); }
  const today = jstNow().toISOString().slice(0, 10);
  const ev = [...out.values()].filter(e => e.d >= today).sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.n < b.n ? -1 : 1);
  for (const e of ev) if (!e.n) e.n = '（会場名なし）';
  return { v: 1, t: Date.now(), src: ['リサイクル運動市民の会', 'リサイクル運動市民の会・埼玉本部'], ev, err };
}

// ---------- 会場の住所と位置 ----------
// 会場のページから住所（都県名で始まるもの）を取り出し、国土地理院の住所検索で位置を求める
async function venue(c) {
  let page, name = '';
  if (/^rc-\d{2,3}$/.test(c)) page = `${RC}hall_detail.php?eventkbncode=${c.slice(3)}`;
  else if (/^fs-[\w-]+$/.test(c)) page = `${FS}kaijouannai/${c.slice(3)}.htm`;
  else throw new Error('会場の番号がちがいます');
  const html = await get(page, 2592000);
  const h = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/i.exec(html);
  if (h) name = strip(h[1]);
  const text = strip(html);
  const am = new RegExp(`(${PREFS.join('|')})[^\\s　、。（(：:]{2,40}`).exec(text);
  const addr = am ? am[0] : '';
  let x = null, y = null;
  if (addr) {
    const res = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(addr), { headers: { 'User-Agent': UA }, cf: { cacheTtl: 2592000, cacheEverything: true } });
    if (res.ok) {
      const js = await res.json();
      if (Array.isArray(js) && js[0] && js[0].geometry) [x, y] = js[0].geometry.coordinates;
    }
  }
  return { c, n: name, addr, x, y, url: page };
}
