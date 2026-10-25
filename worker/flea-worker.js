// flea-worker.js：MeguMiru のフリマの取り次ぎ役（Cloudflare Workers に貼るプログラム。版13.1）
// 版13.1：会場のページが Shift_JIS などでも読めるように。住所が取れない・位置が分からないときは、会場名で OpenStreetMap（Nominatim）に聞く
// ・アプリから頼まれたら、リサイクル運動市民の会（本部・埼玉本部）の開催予定を読みに行き、日付・会場・元のページへのリンクに整えて返す
// ・合言葉（Cloudflare の「KEY」という秘密の設定）を知っているアプリにだけ答える。集めた予定を公開しないため
// ・元のサイトへの負担を小さくするため、読んだページは Cloudflare に覚えてもらう（日程は12時間、中止の一覧は2時間、会場の住所は30日）
//   アプリの側でも、1日1回くらいしか頼まない
//
// 使い方（アプリから）
//   GET https://（このプログラムのアドレス）/?k=合言葉            → 開催予定 {v, t, ev:[…], err:[…]}
//   GET https://（このプログラムのアドレス）/venue?c=rc-013&n=会場名&k=合言葉 → 会場の住所と位置 {c, n, addr, x, y, why}

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
      if (url.pathname === '/venue') return json(await venue(url.searchParams.get('c') || '', url.searchParams.get('n') || ''), 200, cors);
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
  return decode(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type') || '');
}
// 文字の決まり（UTF-8・Shift_JIS・EUC-JP）を見て読む。分からなければ UTF-8 で読み、だめなら Shift_JIS
function decode(buf, ctype) {
  const head = new TextDecoder('utf-8').decode(buf.slice(0, 3000));
  let cs = (/charset=["']?([\w-]+)/i.exec(ctype) || /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) || [])[1] || '';
  cs = cs.toLowerCase();
  if (/s(hift)?[-_]?jis|windows-31j|cp932|ms932/.test(cs)) cs = 'shift_jis';
  else if (/euc[-_]?jp/.test(cs)) cs = 'euc-jp';
  else if (cs !== 'utf-8' && cs !== 'utf8') cs = '';
  const tryDec = (enc, fatal) => { try { return new TextDecoder(enc, { fatal }).decode(buf); } catch (e) { return null; } };
  if (cs === 'shift_jis' || cs === 'euc-jp') return tryDec(cs, false) ?? tryDec('utf-8', false);
  return tryDec('utf-8', true) ?? tryDec('shift_jis', false) ?? tryDec('utf-8', false);
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
const inArea = (x, y) => x > 137.2 && x < 141.2 && y > 34.8 && y < 38.7;   // 関東甲信越のあたり
async function gsi(q) {
  const res = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q), { headers: { 'User-Agent': UA }, cf: { cacheTtl: 2592000, cacheEverything: true } });
  if (!res.ok) return null;
  const js = await res.json().catch(() => null);
  if (!Array.isArray(js) || !js[0] || !js[0].geometry) return null;
  const [x, y] = js[0].geometry.coordinates;
  return inArea(x, y) ? [x, y] : null;
}
async function osm(q) {
  const res = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=jp&limit=3&accept-language=ja&q=' + encodeURIComponent(q), { headers: { 'User-Agent': UA }, cf: { cacheTtl: 2592000, cacheEverything: true } });
  if (!res.ok) return null;
  const js = await res.json().catch(() => null);
  for (const r of (Array.isArray(js) ? js : [])) { const x = +r.lon, y = +r.lat; if (inArea(x, y)) return [x, y]; }
  return null;
}
// 会場名を、場所の名前らしく整える（「＜錦糸公園＞すみだライブフェス」→「錦糸公園」、「イオンモール与野 立体駐車場5F」→「イオンモール与野」）
function placeName(n) {
  n = String(n || '').trim();
  const br = /[＜<]([^＞>]+)[＞>]/.exec(n);
  if (br) return br[1].trim();
  n = n.replace(/[（(][^）)]*[）)]/g, '').replace(/[〜~].*$/, '').replace(/[『「].*$/, '').trim();
  return n.split(/[\s　]+/)[0] || n;
}

// 会場の住所と位置：会場のページの住所 → 国土地理院の住所検索。だめなら会場名で OpenStreetMap
async function venue(c, hint) {
  let page, name = '';
  if (/^rc-\d{2,3}$/.test(c)) page = `${RC}hall_detail.php?eventkbncode=${c.slice(3)}`;
  else if (/^fs-[\w-]+$/.test(c)) page = `${FS}kaijouannai/${c.slice(3)}.htm`;
  else throw new Error('会場の番号がちがいます');
  const why = [];
  let html = '';
  try { html = await get(page, 2592000); } catch (e) { why.push('会場のページを読めませんでした'); }
  const h = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/i.exec(html) || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (h) name = strip(h[1]).replace(/[-|｜].*$/, '').replace(/会場案内詳細|リサイクル運動市民の会/g, '').trim();
  const text = strip(html);
  let addr = '';
  const am = new RegExp(`(${PREFS.join('|')})[^\\s　、。（(：:]{2,40}`).exec(text);
  if (am) addr = am[0];
  else {
    const lm = /(?:住所|所在地)\s*[：:]?\s*([^\s　、。]{4,40})/.exec(text);
    if (lm) addr = lm[1];
  }
  let p = null;
  if (addr) { p = await gsi(addr); if (!p) why.push('住所から位置が分かりませんでした'); } else why.push('住所が見つかりませんでした');
  if (!p) for (const q of [...new Set([placeName(hint), placeName(name)].filter(v => v && v.length >= 2))]) {
    p = await osm(q);
    if (p) { why.push(`会場名「${q}」で探しました`); break; }
  }
  return { c, n: name, addr, x: p ? p[0] : null, y: p ? p[1] : null, url: page, why };
}