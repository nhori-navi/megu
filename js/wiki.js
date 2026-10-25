// wiki.js：場所の一言説明（MeguMiru 版10）
// ・場所の名前（OpenStreetMap に Wikipedia の記事名が書いてあればそれ）を日本語版 Wikipedia に送り、記事の始めの1〜2文を受け取る
// ・送るのは場所の名前だけ。位置や記録は送らない
// ・名前が同じ別の場所の記事にならないよう、記事の位置がその場所から3km以内（市区町村は区域の近く）かを確かめる
//   記事に位置がないときは、記事の文に都県名（市区町村なら市区町村名）があるものだけ使う
// ・受け取った説明は端末に30日（見つからなかったものは7日）覚えておき、同じ場所では送らない
// ・出典：Wikipedia（CC BY-SA 4.0）。詳しい画面に記事へのリンクを付ける

let wikiOn = getLS('wikion', true);
const WIKI_MEM = new Map();          // 場所の番号 → 結果（この画面を開いている間）
const WIKI_WAIT = new Map();         // 問い合わせ中
const WIKI_API = 'https://ja.wikipedia.org';

function wikiCut(text) {
  let t = String(text || '').replace(/\s+/g, ' ').replace(/（[^（）]*）/g, '').replace(/\([^()]*\)/g, '').trim();
  if (!t) return '';
  const ss = t.split(/(?<=。)/);
  let out = ss[0];
  if (out.length < 40 && ss[1] && (out + ss[1]).length <= 140) out += ss[1];
  if (out.length > 140) out = out.slice(0, 139) + '…';
  return out;
}

async function wikiGet(path) {
  const res = await fetch(WIKI_API + path, { headers: { 'Api-User-Agent': 'MeguMiru (nhori-navi.github.io/megu)' } });
  if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
  return res.json();
}

// 記事の要約を受け取り、その場所の記事かを確かめる
async function wikiTry(title, s, trusted) {
  let js;
  try { js = await wikiGet('/api/rest_v1/page/summary/' + encodeURIComponent(title.replace(/ /g, '_'))); }
  catch (e) { if (e.status === 404) return null; throw e; }
  if (!js || js.type === 'disambiguation' || !js.extract) return null;
  const c = js.coordinates;
  if (c && s.x != null) {
    let lim = 3000;
    if (s.sh === 'city') {
      const cc = CITY_BY.get(s.id.slice(1));
      lim = cc ? Math.max(5000, dist(cc.bb[0], cc.bb[1], cc.bb[2], cc.bb[3])) : 15000;
    }
    if (dist(c.lon, c.lat, s.x, s.y) > lim) return null;
  } else if (!trusted) {
    const key = s.sh === 'city' ? s.n : (PREF_NAME[s.p] || '');
    if (!key || !js.extract.includes(key.replace(/[都県]$/, ''))) return null;
  }
  const text = wikiCut(js.extract);
  if (!text) return null;
  return { ok: true, title: js.title, text, url: (js.content_urls && js.content_urls.mobile && js.content_urls.mobile.page) || `${WIKI_API}/wiki/${encodeURIComponent(js.title)}` };
}

async function wikiLookup(s) {
  const tried = new Set();
  const go = async (t, trusted) => {
    if (!t || tried.has(t)) return null;
    tried.add(t);
    return wikiTry(t, s, trusted);
  };
  // 1) OpenStreetMap に書いてある記事名・名城の記事名
  const w = s.w && /^ja:/.test(s.w) ? s.w.slice(3) : null;
  let r = await go(w, true);
  if (r) return r;
  const m = s.sh === 'hi' ? meijoOf(s.id) : null;
  if (m && m.wt) { r = await go(m.wt, true); if (r) return r; }
  // 2) 名前そのまま（政令市の区などは「中央区 (東京都)」の形も）
  const name = String(s.n || '').replace(/\s*\(.*\)$/, '').trim();
  if (!name) return null;
  r = await go(name, false);
  if (r) return r;
  if (s.sh === 'city') {
    r = await go(`${name} (${PREF_NAME[s.p]})`, false);
    if (r) return r;
  }
  // 3) 名前と都県名で探して、上から3つまで
  const q = `${name} ${PREF_NAME[s.p] || ''}`.trim();
  const js = await wikiGet(`/w/api.php?action=query&list=search&srlimit=3&format=json&formatversion=2&origin=*&srsearch=${encodeURIComponent(q)}`);
  for (const h of ((js.query && js.query.search) || [])) {
    if (!h.title.includes(name.replace(/(駅|城|城跡|城址|跡)$/, ''))) continue;
    r = await go(h.title, false);
    if (r) return r;
  }
  return null;
}

// 説明を返す（なければ null）。覚えていればそれを使う
async function wikiFor(id) {
  if (!wikiOn) return null;
  if (WIKI_MEM.has(id)) return WIKI_MEM.get(id);
  if (WIKI_WAIT.has(id)) return WIKI_WAIT.get(id);
  const p = (async () => {
    try {
      const c = await DB.get('wiki:' + id);
      if (c && Date.now() - c.ft < (c.ok ? 30 : 7) * 86400000) { WIKI_MEM.set(id, c.ok ? c : null); return c.ok ? c : null; }
    } catch (e) { /* 取り直す */ }
    const s = itemInfo(id);
    if (!s) return null;
    try {
      const r = await wikiLookup(s);
      const v = r ? Object.assign({ ft: Date.now() }, r) : { ft: Date.now(), ok: false };
      try { await DB.set('wiki:' + id, v); } catch (e) { /* 覚えられなくても使う */ }
      WIKI_MEM.set(id, r ? v : null);
      return r ? v : null;
    } catch (e) {
      return null;   // つながらないときは覚えず、次にまた試す
    } finally { WIKI_WAIT.delete(id); }
  })();
  WIKI_WAIT.set(id, p);
  return p;
}

// 詳しい画面の説明の欄を埋める
async function wikiFill(id, box) {
  if (!box) return;
  if (!wikiOn) { box.hidden = true; return; }
  box.innerHTML = '<p class="wikiTxt wait">説明を探しています…</p>';
  const r = await wikiFor(id);
  if (!box.isConnected || box.dataset.id !== id) return;
  if (!r) { box.innerHTML = '<p class="wikiTxt none">説明は見つかりませんでした</p>'; return; }
  box.innerHTML = `<p class="wikiTxt">${esc(r.text)}</p><p class="wikiSrc"><a href="${esc(r.url)}" target="_blank" rel="noopener">Wikipedia「${esc(r.title)}」</a>より（CC BY-SA）</p>`;
}

// 「今日」の一覧の「はじめて」に1行ずつ付ける（多いときは上から20件まで、順番に）
let wikiRowsGen = 0;
async function wikiRows(container) {
  if (!wikiOn || !container) return;
  const gen = ++wikiRowsGen;
  const rows = [...container.querySelectorAll('.row[data-wiki]')].slice(0, 20);
  for (const li of rows) {
    if (gen !== wikiRowsGen) return;
    const id = li.dataset.id;
    const cached = WIKI_MEM.has(id);
    const r = await wikiFor(id);
    if (gen !== wikiRowsGen || !li.isConnected) return;
    if (r) {
      const nm = li.querySelector('.nm');
      if (nm && !nm.querySelector('.wk')) nm.insertAdjacentHTML('beforeend', `<span class="wk">${esc(r.text)}</span>`);
    }
    if (!cached) await new Promise(res => setTimeout(res, 150));   // Wikipedia に続けて送りすぎない
  }
}
