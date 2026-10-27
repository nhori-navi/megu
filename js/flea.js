// flea.js：催し（フリマ・お祭り・花火・音楽・スポーツなど）の予定（MeguMiru 版17：スポーツの混みそうを絞った。版15：ウォーカープラスのいろいろなジャンル・混みそうな印・今日のタブの混雑の目安。版13：フリマ。版13.3：ウォーカープラスも（都県ごとに頼む）・何日も続く催し。版13.2：「取り直す」で会場も聞き直す。版13.1：会場名も送って位置を探してもらう、分からなかった会場は1日ごとに聞き直す）
// ・Cloudflare Workers に置いた「取り次ぎ役」（worker/flea-worker.js）に頼んで、リサイクル運動市民の会（本部・埼玉本部）の開催予定を受け取る
// ・取り次ぎ役のアドレスと合言葉は設定で入れる（このスマホの中だけに置く）
// ・頼むのは12時間に1回まで（「取り直す」を押したときは別）。会場の位置は会場ごとに1回だけ聞いて覚える
// ・★を付けると、その会場・日付で行き先ピンが立つ（★を外すとピンも消える）
// ・地図には、2週間以内に開かれる会場を出す（中止は出さない）

let FLEA = null;                 // {ft:受け取った時刻, t, ev:[{id, d, d2:終わりの日, vc, n, url, src:'rc'|'fs'|'wp', st, pn:都県名, loc:場所}], err}
let FLEA_V = {};                 // 会場の番号 → {n, addr, x, y, ft, url}
let fleaUrl = getLS('fleaurl', '');
let fleaKey = getLS('fleakey', '');
let planView = getLS('planview', 'pins');     // pins＝行き先ピン / flea＝フリマ
let fleaPref = getLS('fleapref', '');
let fleaSort = getLS('fleasort', 'date');     // date＝日付順 / near＝近い順
let fleaBusy = false, fleaErr = '';
let onFleaChanged = () => {};
const FLEA_MAP_DAYS = 14;
// 版15：催しのジャンル（ウォーカープラスのジャンル名をこの名前で振り分ける。上にあるものが先）
const EV_G = [
  { k: 'fl', n: 'フリマ', icon: '🛍', color: '#d9822b', re: /フリー?マーケット|フリマ/ },
  { k: 'hb', n: '花火', icon: '🎆', color: '#c2416b', re: /花火/ },
  { k: 'sp', n: 'スポーツ', icon: '⚽', color: '#2f8f5b', re: /スポーツ|観戦/ },
  { k: 'ms', n: '音楽', icon: '🎵', color: '#3b6fb6', re: /音楽|ライブ|コンサート|フェス/ },
  { k: 'mt', n: 'お祭り', icon: '🏮', color: '#b8373d', re: /祭/ },
  { k: 'fd', n: 'グルメ・物産', icon: '🍡', color: '#8b5e3c', re: /物産|グルメ|フード|食/ }
];
const EV_GBY = Object.fromEntries(EV_G.map(g => [g.k, g]));
let FLEA_G = getLS('fleagenres', null);       // {ft, map:{egNNNN: ジャンルの記号}}
let fleaGenre = getLS('fleagenre', '');
// 混みそうな会場（大きな会場の名前）
const BIG_VENUE = /スタジアム|ドーム|アリーナ|競技場|球場|武道館|ビッグサイト|幕張メッセ|国技館|サーキット|競馬場|フェス/;
// 版17：スポーツは体験・参加型も多いので、大きな会場か、試合・大会らしい言葉があるものだけ「混みそう」
const SPORT_BIG = /試合|リーグ|マラソン|駅伝|選手権|杯|カップ|トーナメント|vs|VS|ＶＳ/;
const evCrowd = e => {
  const s = `${e.n} ${e.loc || ''} ${(FLEA_V[e.vc] || {}).n || ''}`;
  if (e.gk === 'hb' || BIG_VENUE.test(s)) return true;
  return e.gk === 'sp' && SPORT_BIG.test(e.n || '');
};

async function loadFleaCache() {
  try { FLEA = (await DB.get('flea')) || null; FLEA_V = (await DB.get('fleavenue')) || {}; } catch (e) { FLEA = null; FLEA_V = {}; }
}
const fleaReady = () => !!(fleaUrl && fleaKey);
function fleaApi(path, params) {
  const u = new URL(fleaUrl.replace(/\/+$/, '') + path);
  u.searchParams.set('k', fleaKey);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
  return u.toString();
}

// 予定を受け取る（12時間たっていなければ、覚えている分を使う）
async function fleaFetch(force) {
  if (!fleaReady() || fleaBusy) return;
  if (!force && FLEA && Date.now() - FLEA.ft < 12 * 3600000) { await fleaVenues(); return; }
  fleaBusy = true; fleaErr = ''; onFleaChanged();
  try {
    const res = await fetch(fleaApi('/'), { cache: 'no-store' });
    const js = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(js.ev)) throw new Error(js.error || `取り次ぎ役が答えませんでした（${res.status}）`);
    const ev = js.ev, err = js.err || [];
    for (const e of ev) e.gk = 'fl';
    // 版15：ウォーカープラスのジャンルの一覧（7日に1回）。取り次ぎ役が版15でなければフリマだけ
    if ((js.wp || []).length && (!FLEA_G || Date.now() - FLEA_G.ft > 7 * 86400000)) {
      try {
        const rg = await fetch(fleaApi('/wpg', { a: 'ar0313' }), { cache: 'no-store' });
        const jg = await rg.json().catch(() => ({}));
        if (rg.ok && Array.isArray(jg.list)) {
          const map = {};
          for (const { g, n } of jg.list) { const hit = EV_G.find(x => x.re.test(n)); if (hit && !Object.values(map).includes(hit.k)) map[g] = hit.k; }
          if (!Object.keys(map).length) map.eg0115 = 'fl';
          FLEA_G = { ft: Date.now(), map }; setLS('fleagenres', FLEA_G);
        }
      } catch (e) { /* フリマだけ */ }
    }
    const gmap = (FLEA_G && FLEA_G.map) || { eg0115: 'fl' };
    const codes = Object.keys(gmap).sort((a, b) => EV_G.findIndex(x => x.k === gmap[a]) - EV_G.findIndex(x => x.k === gmap[b]));
    // ウォーカープラスは、都県ごと・ジャンルごとに頼む（3つずつ同時に）
    const jobs = [];
    for (const ar of (js.wp || [])) for (const g of codes) jobs.push([ar, g]);
    const got = {};
    let ji = 0;
    const worker = async () => {
      while (ji < jobs.length) {
        const [ar, g] = jobs[ji++];
        try {
          const r2 = await fetch(fleaApi('/wp', { a: ar, g }), { cache: 'no-store' });
          const j2 = await r2.json().catch(() => ({}));
          if (!r2.ok || !Array.isArray(j2.ev)) throw new Error(j2.error || `ウォーカープラス（${ar}・${g}）：${r2.status}`);
          got[ar + g] = j2.ev.map(e => Object.assign(e, { gk: gmap[e.eg || g] || 'fl' }));
          err.push(...(j2.err || []));
        } catch (e) { err.push(String(e.message || e)); }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const seen = new Set(ev.map(e => e.id));
    for (const [ar, g] of jobs) for (const e of (got[ar + g] || [])) {
      if (seen.has(e.id)) continue;            // 2つのジャンルに出ている催しは、上のジャンルの方だけ
      // 同じ日に、リサイクル運動市民の会の会場名が名前や場所に入っていれば同じ催し
      if (ev.some(o => o.src !== 'wp' && o.d === e.d && o.n && o.n.length >= 3 && (e.n.includes(o.n) || (e.loc || '').includes(o.n)))) continue;
      seen.add(e.id); ev.push(e);
    }
    ev.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.n < b.n ? -1 : 1);
    FLEA = { ft: Date.now(), t: js.t, ev, err };
    try { await DB.set('flea', FLEA); } catch (e) { /* 覚えられなくても使う */ }
  } catch (e) {
    fleaErr = /Failed to fetch|NetworkError|Load failed/.test(String(e.message)) ? '取り次ぎ役につながりませんでした（アドレスを確かめてください）' : String(e.message || e);
  } finally { fleaBusy = false; }
  onFleaChanged();
  await fleaVenues(force);
}

// 位置の分からない会場を聞く（1回に12会場まで。分からなかった会場は1日後にもう一度。聞き方を変えた版13.1では、前に分からなかった会場もすぐ聞き直す）
const FLEA_VREV = 2;
async function fleaVenues(force) {   // force：「取り直す」を押したときは、分からなかった会場もすぐ聞き直す
  if (!FLEA || !fleaReady()) return;
  const nameOf = {}, evOf = {};
  for (const e of FLEA.ev) if (!nameOf[e.vc]) { nameOf[e.vc] = e.n; evOf[e.vc] = e; }
  // 版15：ウォーカープラスの催しは、2週間以内か混みそうなものだけ会場まで詳しく調べる（ほかは市区町村のおおよその位置）。
  //   おおよその位置の催しが2週間以内になったら、もう一度詳しく調べる
  const soon = ymd(Date.now() + FLEA_MAP_DAYS * 86400000);
  const want = vc => { const e = evOf[vc]; return e.src !== 'wp' || e.d <= soon || evCrowd(e); };
  const need = Object.keys(nameOf)
    .filter(vc => {
      const v = FLEA_V[vc];
      if (!v) return true;
      if (v.x == null) return force || (v.rev || 1) < FLEA_VREV || Date.now() - v.ft > 86400000;
      return v.rough && !v.detail && want(vc);
    }).slice(0, 80);
  let ni = 0;
  const one = async () => {
    while (ni < need.length) {
      const vc = need[ni++];
      try {
        const e = evOf[vc], detail = want(vc);
        const res = await fetch(fleaApi('/venue', Object.assign({ c: vc, n: nameOf[vc] }, e.loc ? { a: e.loc } : {}, e.pn ? { p: e.pn } : {}, e.src === 'wp' ? { x: detail ? '1' : '0' } : {})), { cache: 'no-store' });
        const js = await res.json();
        if (!res.ok) throw new Error(js.error);
        const rough = js.rough || (js.why || []).some(w => w.includes('市区町村の場所'));
        FLEA_V[vc] = { n: js.n || '', addr: js.addr || '', x: js.x, y: js.y, url: js.url || '', why: js.why || [], ft: Date.now(), rev: FLEA_VREV, rough: rough ? 1 : 0, detail: detail ? 1 : 0 };
      } catch (e) { if (!FLEA_V[vc] || FLEA_V[vc].x == null) FLEA_V[vc] = { x: null, y: null, ft: Date.now(), rev: FLEA_VREV }; }
      if (ni % 10 === 0) onFleaChanged();
    }
  };
  await Promise.all([one(), one(), one()]);
  if (need.length) { try { await DB.set('fleavenue', FLEA_V); } catch (e) { /* なし */ } onFleaChanged(); }
}

// 今日からの予定（会場の位置・都県を付けて）
function fleaEvents() {
  if (!FLEA) return [];
  const today = ymd(Date.now());
  const evs = FLEA.ev.filter(e => (e.d2 || e.d) >= today).map(e => {
    const v = FLEA_V[e.vc] || {};
    const p = (v.x != null && prefOfPoint(v.x, v.y)) || (PREFS.find(([, n]) => (v.addr || '').startsWith(n)) || PREFS.find(([, n]) => n === e.pn) || [''])[0];
    // 何日も続く催しは、今日より前に始まっていても今日の分として並べる
    const dd = e.d < today ? today : e.d;
    const o = Object.assign({}, e, { x: v.x, y: v.y, p, addr: v.addr || '', dd, gk: e.gk || 'fl', rough: v.rough || (v.why || []).some(w => w.includes('市区町村の場所')) });
    o.crowd = evCrowd(o);
    return o;
  });
  // 位置が分かってから：同じ日の、800m以内の別の情報源の催しは1つに（ウォーカープラスの方を外す）
  const keep = evs.filter(e => !(e.src === 'wp' && e.x != null && evs.some(o => o.src !== 'wp' && o.d === e.d && o.x != null && dist(o.x, o.y, e.x, e.y) < 800)));
  return keep.sort((a, b) => a.dd < b.dd ? -1 : a.dd > b.dd ? 1 : a.n < b.n ? -1 : 1);
}
function fleaRange(e) {
  if (!e.d2) return fleaDateLabel(e.d);
  const f = d => { const t = new Date(d + 'T12:00:00'); return `${t.getMonth() + 1}/${t.getDate()}`; };
  return `${f(e.d)}〜${f(e.d2)}`;
}
const fleaPlan = id => PLANS.find(p => p.fl === id);

function fleaDateLabel(d) {
  const t = new Date(d + 'T12:00:00'), today = ymd(Date.now());
  const s = `${t.getMonth() + 1}/${t.getDate()}（${'日月火水木金土'[t.getDay()]}）`;
  return d === today ? '今日 ' + s : s;
}

// ★：行き先ピンを立てる・消す
function fleaStar(id) {
  const e = fleaEvents().find(x => x.id === id);
  const pl = fleaPlan(id);
  if (pl) {
    PLANS = PLANS.filter(p => p !== pl);
    if (planFocus === pl.id) planFocus = null;
    savePlans();
    toast('★を外しました（行き先ピンも消しました）');
    return;
  }
  if (!e) return;
  if (e.x == null) { toast('会場の場所がまだ分かりません。少し待ってからもう一度押してください'); fleaVenues(); return; }
  PLANS.push({ id: 'p' + Date.now().toString(36), n: (e.gk === 'fl' ? 'フリマ：' : (EV_GBY[e.gk] || EV_G[0]).icon + ' ') + e.n, x: e.x, y: e.y, d: e.dd || e.d, m: e.d2 ? `開催：${fleaRange(e)}` : '', u: e.url, fl: e.id, t: Date.now() });
  savePlans();
  toast('★ 行き先ピンを立てました（計画の「行き先ピン」にあります）');
}

// ---------- 計画タブの「催し」 ----------
function renderFlea(box) {
  if (!fleaReady()) {
    box.innerHTML = '<div class="card"><p class="big">催しの予定を受け取る準備がまだです</p><p class="note">設定の「催し」に、Cloudflare に置いた取り次ぎ役のアドレスと合言葉を入れてください。</p><div class="btnRow"><button class="btn primary" id="flGoSet">設定を開く</button></div></div>';
    $('flGoSet').onclick = () => showTab('set');
    return;
  }
  if (!FLEA && !fleaBusy && !fleaErr) fleaFetch();
  const here = lastFix ? [lastFix.x, lastFix.y] : lastPos;
  let evs = fleaEvents();
  if (fleaPref) evs = evs.filter(e => e.p === fleaPref);
  const gcount = {};
  for (const e of evs) gcount[e.gk] = (gcount[e.gk] || 0) + 1;
  const crowdN = evs.filter(e => e.crowd).length;
  if (fleaGenre === 'crowd') evs = evs.filter(e => e.crowd);
  else if (fleaGenre) evs = evs.filter(e => e.gk === fleaGenre);
  const dOf = e => (here && e.x != null) ? dist(here[0], here[1], e.x, e.y) : Infinity;
  if (fleaSort === 'near') evs.sort((a, b) => dOf(a) - dOf(b) || (a.d < b.d ? -1 : 1));
  const row = (e, showDate) => {
    const st = !!fleaPlan(e.id);
    const d = dOf(e);
    return `<li class="row flRow${e.st ? ' cancel' : ''}" data-vc="${esc(e.vc)}">`
      + `<button class="star${st ? ' on' : ''}" data-id="${esc(e.id)}" aria-label="★">${st ? '★' : '☆'}</button>`
      + `<span class="nm">${showDate ? `<b class="flD">${esc(e.d2 ? fleaRange(e) : fleaDateLabel(e.d))}</b> ` : ''}<span class="gIc">${(EV_GBY[e.gk] || EV_G[0]).icon}</span>${esc(e.n)}${e.crowd ? '<span class="crowd">👥 混みそう</span>' : ''}`
      + `<small>${!showDate && e.d2 ? `<b class="flD">${esc(fleaRange(e))}</b>・` : ''}${esc(PREF_NAME[e.p] || (e.x == null ? (FLEA_V[e.vc] && FLEA_V[e.vc].rev === FLEA_VREV ? '場所が分かりませんでした' : '場所を調べています') : ''))}${e.loc && e.src === 'wp' ? '・' + esc(e.loc) : ''}${isFinite(d) ? '・ここから ' + (e.rough ? '約' : '') + fmtDist(d) : ''}${e.src === 'fs' ? '・埼玉本部' : e.src === 'wp' ? '・ウォーカープラス' : ''}</small></span>`
      + `<span class="st">${e.st ? `<span class="badge flSt">${esc(e.st)}</span>` : ''}<a class="flLink" href="${esc(e.url)}" target="_blank" rel="noopener">案内</a></span></li>`;
  };
  let list = '';
  if (fleaSort === 'date') {
    let cur = '', open = false;
    for (const e of evs) {
      if (e.dd !== cur) { if (open) list += '</ul>'; list += `<h3 class="flH">${esc(fleaDateLabel(e.dd))}</h3><ul class="list">`; cur = e.dd; open = true; }
      list += row(e, false);
    }
    if (open) list += '</ul>';
  } else list = evs.length ? `<ul class="list">${evs.map(e => row(e, true)).join('')}</ul>` : '';
  const got = FLEA ? `${fmtDate(FLEA.ft)} ${fmtTime(FLEA.ft)}に受け取り` : '';
  const gopts = `<option value="">すべての催し（${Object.values(gcount).reduce((a, b) => a + b, 0)}）</option>` + EV_G.filter(g => gcount[g.k]).map(g => `<option value="${g.k}"${g.k === fleaGenre ? ' selected' : ''}>${g.icon} ${g.n}（${gcount[g.k]}）</option>`).join('')
    + (crowdN ? `<option value="crowd"${fleaGenre === 'crowd' ? ' selected' : ''}>👥 混みそうなものだけ（${crowdN}）</option>` : '');
  box.innerHTML = `<div class="zkCtl"><select id="flGenre">${gopts}</select></div><div class="zkCtl"><select id="flPref"><option value="">すべての都県</option>${PREFS.map(([c, n]) => `<option value="${c}"${c === fleaPref ? ' selected' : ''}>${n}</option>`).join('')}</select>`
    + `<select id="flSort"><option value="date"${fleaSort === 'date' ? ' selected' : ''}>日付順</option><option value="near"${fleaSort === 'near' ? ' selected' : ''}>近い順</option></select></div>`
    + `<p class="note flStat">${fleaBusy ? '受け取っています…' : esc(fleaErr) || `${evs.length}件　${got}`}　<button class="linkBtn" id="flReload">取り直す</button></p>`
    + (FLEA && FLEA.err && FLEA.err.length ? `<p class="note">一部のページを読めませんでした（${FLEA.err.length}件）</p>` : '')
    + (list || (FLEA ? '<p class="note">該当する催しはありません。</p>' : ''))
    + '<p class="note">☆を押すと、その会場と日付で行き先ピンが立ちます。「👥 混みそう」は、花火・スポーツや大きな会場の催しに付けた目安です。出典：リサイクル運動市民の会・ウォーカープラス（私的利用の範囲で表示しています）。日時や中止は、必ず元の案内で確かめてください。</p>';
  $('flGenre').onchange = e => { fleaGenre = e.target.value; setLS('fleagenre', fleaGenre); renderPlan(); };
  $('flPref').onchange = e => { fleaPref = e.target.value; setLS('fleapref', fleaPref); renderPlan(); };
  $('flSort').onchange = e => { fleaSort = e.target.value; setLS('fleasort', fleaSort); renderPlan(); };
  $('flReload').onclick = () => fleaFetch(true);
  box.querySelectorAll('.star').forEach(b => b.onclick = ev => { ev.stopPropagation(); fleaStar(b.dataset.id); });
  box.querySelectorAll('.flLink').forEach(a => a.onclick = ev => ev.stopPropagation());
  box.querySelectorAll('.flRow').forEach(li => li.onclick = () => showFleaVenue(li.dataset.vc));
}

// 会場の画面：これからの予定と★
function showFleaVenue(vc) {
  const evs = fleaEvents().filter(e => e.vc === vc);
  const v = FLEA_V[vc] || {};
  const name = (evs[0] && evs[0].n) || v.n || '会場';
  const g = EV_GBY[(evs[0] && evs[0].gk) || 'fl'] || EV_G[0];
  $('sheetBody').innerHTML = `<div class="shHead" style="--sc:${g.color}"><span class="shIcon">${g.icon}</span><div><h3>${esc(name)}</h3><p class="sub">${g.k === 'fl' ? 'フリーマーケット' : esc(g.n)}${v.addr ? '・' + esc(v.addr) : ''}${v.rough ? '（場所はおおよそ）' : ''}</p></div></div>`
    + (evs[0] && evs[0].crowd ? '<p class="crowdL">👥 混みそうな催しです（花火・スポーツや大きな会場の催しの目安）</p>' : '')
    + (evs.length ? `<ul class="list">${evs.map(e => {
      const st = !!fleaPlan(e.id);
      return `<li class="row"><button class="star${st ? ' on' : ''}" data-id="${esc(e.id)}">${st ? '★' : '☆'}</button><span class="nm">${esc(e.d2 ? fleaRange(e) : fleaDateLabel(e.d))}</span><span class="st">${e.st ? `<span class="badge flSt">${esc(e.st)}</span>` : ''}<a class="flLink" href="${esc(e.url)}" target="_blank" rel="noopener">案内</a></span></li>`;
    }).join('')}</ul>` : '<p class="note">これからの予定はありません</p>')
    + '<p class="hint">☆を押すと、その日の行き先ピンが立ち、まわり5kmのまだ行っていない場所も見られます</p>'
    + `<div class="btnRow">${v.x != null ? '<button class="btn primary" id="flFly">地図で見る</button>' : ''}${v.x != null ? `<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${v.y},${v.x}">Googleマップ</a>` : ''}</div>`;
  $('sheet').hidden = false;
  $('sheetBody').querySelectorAll('.star').forEach(b => b.onclick = () => { fleaStar(b.dataset.id); showFleaVenue(vc); });
  const fly = $('flFly');
  if (fly) fly.onclick = () => { closeSheet(); showTab('map'); flyToSpot(v.x, v.y); };
}

// 地図：2週間以内に開かれる会場（中止は除く）
function fleaGeo() {
  const lim = ymd(Date.now() + FLEA_MAP_DAYS * 86400000);
  const by = new Map();
  for (const e of fleaEvents()) {
    if (e.st === '中止' || e.x == null || e.dd > lim) continue;
    if (!by.has(e.vc)) by.set(e.vc, e);
  }
  return { type: 'FeatureCollection', features: [...by.values()].map(e => ({ type: 'Feature', properties: { vc: e.vc, gk: e.gk || 'fl', n: `${e.n} ${(e.d2 ? fleaRange(e) : fleaDateLabel(e.d)).replace('今日 ', '今日')}` }, geometry: { type: 'Point', coordinates: [e.x, e.y] } })) };
}

// ---------- 設定 ----------
function renderFleaSettings() {
  if (!$('setFleaUrl')) return;
  $('setFleaUrl').value = fleaUrl;
  $('setFleaKey').value = fleaKey;
  $('fleaStatus').textContent = !fleaReady() ? 'まだ入っていません' : fleaBusy ? '受け取っています…' : fleaErr ? fleaErr
    : FLEA ? `つながっています（${FLEA.ev.length}件・${fmtDate(FLEA.ft)} ${fmtTime(FLEA.ft)}）` : '入っています';
}
function wireFleaSettings() {
  if (!$('btnFleaSave')) return;
  $('btnFleaSave').onclick = async () => {
    const u = $('setFleaUrl').value.trim(), k = $('setFleaKey').value.trim();
    if (u && !/^https:\/\/[^/\s]+/.test(u)) { toast('アドレスは https:// で始まるものを入れてください'); return; }
    fleaUrl = u; fleaKey = k; setLS('fleaurl', u); setLS('fleakey', k);
    FLEA = null; fleaErr = '';
    renderFleaSettings();
    if (fleaReady()) { await fleaFetch(true); renderFleaSettings(); toast(fleaErr ? fleaErr : '催しの予定を受け取りました'); }
  };
}

// ---------- 版15：「今日」のタブ：混雑の目安と、今日やっている近くの催し ----------
// よく乗る路線：乗った区間の多い路線（上から5つ）。乗った区間がなければ、駅のそばならどの路線でも
function oftenLines() {
  const cnt = new Map();
  for (const k of Object.keys(SEG)) for (const gi of (LINE_EDGE.get(k) || [])) cnt.set(gi, (cnt.get(gi) || 0) + 1);
  return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([gi]) => gi);
}
function eventsTodayHtml() {
  if (!FLEA) return '';
  const today = ymd(Date.now()), tmr = ymd(Date.now() + 86400000);
  const evs = fleaEvents().filter(e => e.st !== '中止' && e.x != null);
  const lines = oftenLines();
  const stSet = new Map();
  for (const gi of lines) for (const id of LINE_GROUPS[gi].ss) if (!stSet.has(id)) stSet.set(id, gi);
  const crowd = [];
  for (const e of evs) {
    if (!e.crowd || e.rough || (e.dd !== today && e.dd !== tmr)) continue;
    let best = null;
    for (const [id, d] of lineStationsNear(e.x, e.y, 1000)) {
      if (lines.length && !stSet.has(id)) continue;
      const gi = lines.length ? stSet.get(id) : (LINE_STG.get(id) || [])[0];
      if (gi == null) continue;
      best = { id, d, gi }; break;
    }
    if (best) crowd.push([e, best]);
  }
  const here = lastFix ? [lastFix.x, lastFix.y] : lastPos;
  const shown = new Set(crowd.map(([e]) => e.id));
  const near = here ? evs.filter(e => e.dd === today && !shown.has(e.id) && dist(here[0], here[1], e.x, e.y) <= 10000)
    .sort((a, b) => dist(here[0], here[1], a.x, a.y) - dist(here[0], here[1], b.x, b.y)).slice(0, 3) : [];
  if (!crowd.length && !near.length) return '';
  let h = '';
  if (crowd.length) {
    h += '<div class="evBox crowdBox"><p class="evT">👥 今日・あしたの混雑の目安</p><ul>'
      + crowd.map(([e, b]) => `<li data-vc="${esc(e.vc)}"><b>${e.dd === today ? '今日' : 'あした'}</b> ${esc(LINE_GROUPS[b.gi].n)} ${esc((LINE_ST[b.id] || [''])[0])}のそば：${(EV_GBY[e.gk] || EV_G[0]).icon} ${esc(e.n)}</li>`).join('')
      + '</ul></div>';
  }
  if (near.length) {
    h += '<div class="evBox"><p class="evT">🎪 今日やっている近くの催し</p><ul>'
      + near.map(e => `<li data-vc="${esc(e.vc)}">${(EV_GBY[e.gk] || EV_G[0]).icon} ${esc(e.n)}<small>ここから ${e.rough ? '約' : ''}${fmtDist(dist(here[0], here[1], e.x, e.y))}</small></li>`).join('')
      + '</ul></div>';
  }
  return h;
}
