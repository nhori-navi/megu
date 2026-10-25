// flea.js：フリマの予定（MeguMiru 版13。版13.1：会場名も送って位置を探してもらう、分からなかった会場は1日ごとに聞き直す）
// ・Cloudflare Workers に置いた「取り次ぎ役」（worker/flea-worker.js）に頼んで、リサイクル運動市民の会（本部・埼玉本部）の開催予定を受け取る
// ・取り次ぎ役のアドレスと合言葉は設定で入れる（このスマホの中だけに置く）
// ・頼むのは12時間に1回まで（「取り直す」を押したときは別）。会場の位置は会場ごとに1回だけ聞いて覚える
// ・★を付けると、その会場・日付で行き先ピンが立つ（★を外すとピンも消える）
// ・地図には、2週間以内に開かれる会場を出す（中止は出さない）

let FLEA = null;                 // {ft:受け取った時刻, t, ev:[{id, d, vc, n, url, src, st}], err}
let FLEA_V = {};                 // 会場の番号 → {n, addr, x, y, ft, url}
let fleaUrl = getLS('fleaurl', '');
let fleaKey = getLS('fleakey', '');
let planView = getLS('planview', 'pins');     // pins＝行き先ピン / flea＝フリマ
let fleaPref = getLS('fleapref', '');
let fleaSort = getLS('fleasort', 'date');     // date＝日付順 / near＝近い順
let fleaBusy = false, fleaErr = '';
let onFleaChanged = () => {};
const FLEA_MAP_DAYS = 14;

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
    FLEA = { ft: Date.now(), t: js.t, ev: js.ev, err: js.err || [] };
    try { await DB.set('flea', FLEA); } catch (e) { /* 覚えられなくても使う */ }
  } catch (e) {
    fleaErr = /Failed to fetch|NetworkError|Load failed/.test(String(e.message)) ? '取り次ぎ役につながりませんでした（アドレスを確かめてください）' : String(e.message || e);
  } finally { fleaBusy = false; }
  onFleaChanged();
  await fleaVenues();
}

// 位置の分からない会場を聞く（1回に12会場まで。分からなかった会場は1日後にもう一度。聞き方を変えた版13.1では、前に分からなかった会場もすぐ聞き直す）
const FLEA_VREV = 2;
async function fleaVenues() {
  if (!FLEA || !fleaReady()) return;
  const nameOf = {};
  for (const e of FLEA.ev) if (!nameOf[e.vc]) nameOf[e.vc] = e.n;
  const need = Object.keys(nameOf)
    .filter(vc => { const v = FLEA_V[vc]; return !v || (v.x == null && ((v.rev || 1) < FLEA_VREV || Date.now() - v.ft > 86400000)); }).slice(0, 12);
  for (const vc of need) {
    try {
      const res = await fetch(fleaApi('/venue', { c: vc, n: nameOf[vc] }), { cache: 'no-store' });
      const js = await res.json();
      if (!res.ok) throw new Error(js.error);
      FLEA_V[vc] = { n: js.n || '', addr: js.addr || '', x: js.x, y: js.y, url: js.url || '', why: js.why || [], ft: Date.now(), rev: FLEA_VREV };
    } catch (e) { FLEA_V[vc] = { x: null, y: null, ft: Date.now(), rev: FLEA_VREV }; }
    onFleaChanged();
  }
  if (need.length) { try { await DB.set('fleavenue', FLEA_V); } catch (e) { /* なし */ } onFleaChanged(); }
}

// 今日からの予定（会場の位置・都県を付けて）
function fleaEvents() {
  if (!FLEA) return [];
  const today = ymd(Date.now());
  return FLEA.ev.filter(e => e.d >= today).map(e => {
    const v = FLEA_V[e.vc] || {};
    const p = v.x != null ? prefOfPoint(v.x, v.y) : (PREFS.find(([, n]) => (v.addr || '').startsWith(n)) || [''])[0];
    return Object.assign({}, e, { x: v.x, y: v.y, p, addr: v.addr || '' });
  });
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
  PLANS.push({ id: 'p' + Date.now().toString(36), n: 'フリマ：' + e.n, x: e.x, y: e.y, d: e.d, m: '', u: e.url, fl: e.id, t: Date.now() });
  savePlans();
  toast('★ 行き先ピンを立てました（計画の「行き先ピン」にあります）');
}

// ---------- 計画タブの「フリマ」 ----------
function renderFlea(box) {
  if (!fleaReady()) {
    box.innerHTML = '<div class="card"><p class="big">フリマの予定を受け取る準備がまだです</p><p class="note">設定の「フリマ」に、Cloudflare に置いた取り次ぎ役のアドレスと合言葉を入れてください。</p><div class="btnRow"><button class="btn primary" id="flGoSet">設定を開く</button></div></div>';
    $('flGoSet').onclick = () => showTab('set');
    return;
  }
  if (!FLEA && !fleaBusy && !fleaErr) fleaFetch();
  const here = lastFix ? [lastFix.x, lastFix.y] : lastPos;
  let evs = fleaEvents();
  if (fleaPref) evs = evs.filter(e => e.p === fleaPref);
  const dOf = e => (here && e.x != null) ? dist(here[0], here[1], e.x, e.y) : Infinity;
  if (fleaSort === 'near') evs.sort((a, b) => dOf(a) - dOf(b) || (a.d < b.d ? -1 : 1));
  const row = (e, showDate) => {
    const st = !!fleaPlan(e.id);
    const d = dOf(e);
    return `<li class="row flRow${e.st ? ' cancel' : ''}" data-vc="${esc(e.vc)}">`
      + `<button class="star${st ? ' on' : ''}" data-id="${esc(e.id)}" aria-label="★">${st ? '★' : '☆'}</button>`
      + `<span class="nm">${showDate ? `<b class="flD">${esc(fleaDateLabel(e.d))}</b> ` : ''}${esc(e.n)}`
      + `<small>${esc(PREF_NAME[e.p] || (e.x == null ? (FLEA_V[e.vc] && FLEA_V[e.vc].rev === FLEA_VREV ? '場所が分かりませんでした' : '場所を調べています') : ''))}${isFinite(d) ? '・ここから ' + fmtDist(d) : ''}${e.src === 'fs' ? '・埼玉本部' : ''}</small></span>`
      + `<span class="st">${e.st ? `<span class="badge flSt">${esc(e.st)}</span>` : ''}<a class="flLink" href="${esc(e.url)}" target="_blank" rel="noopener">案内</a></span></li>`;
  };
  let list = '';
  if (fleaSort === 'date') {
    let cur = '', open = false;
    for (const e of evs) {
      if (e.d !== cur) { if (open) list += '</ul>'; list += `<h3 class="flH">${esc(fleaDateLabel(e.d))}</h3><ul class="list">`; cur = e.d; open = true; }
      list += row(e, false);
    }
    if (open) list += '</ul>';
  } else list = evs.length ? `<ul class="list">${evs.map(e => row(e, true)).join('')}</ul>` : '';
  const got = FLEA ? `${fmtDate(FLEA.ft)} ${fmtTime(FLEA.ft)}に受け取り` : '';
  box.innerHTML = `<div class="zkCtl"><select id="flPref"><option value="">すべての都県</option>${PREFS.map(([c, n]) => `<option value="${c}"${c === fleaPref ? ' selected' : ''}>${n}</option>`).join('')}</select>`
    + `<select id="flSort"><option value="date"${fleaSort === 'date' ? ' selected' : ''}>日付順</option><option value="near"${fleaSort === 'near' ? ' selected' : ''}>近い順</option></select></div>`
    + `<p class="note flStat">${fleaBusy ? '受け取っています…' : esc(fleaErr) || `${evs.length}件　${got}`}　<button class="linkBtn" id="flReload">取り直す</button></p>`
    + (FLEA && FLEA.err && FLEA.err.length ? `<p class="note">一部のページを読めませんでした（${FLEA.err.length}件）</p>` : '')
    + (list || (FLEA ? '<p class="note">該当するフリマはありません。</p>' : ''))
    + '<p class="note">☆を押すと、その会場と日付で行き先ピンが立ちます。出典：リサイクル運動市民の会。出店や中止は、必ず元の案内で確かめてください。</p>';
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
  $('sheetBody').innerHTML = `<div class="shHead" style="--sc:${SHELVES.fl.color}"><span class="shIcon">🛍</span><div><h3>${esc(name)}</h3><p class="sub">フリーマーケット${v.addr ? '・' + esc(v.addr) : ''}</p></div></div>`
    + (evs.length ? `<ul class="list">${evs.map(e => {
      const st = !!fleaPlan(e.id);
      return `<li class="row"><button class="star${st ? ' on' : ''}" data-id="${esc(e.id)}">${st ? '★' : '☆'}</button><span class="nm">${esc(fleaDateLabel(e.d))}</span><span class="st">${e.st ? `<span class="badge flSt">${esc(e.st)}</span>` : ''}<a class="flLink" href="${esc(e.url)}" target="_blank" rel="noopener">案内</a></span></li>`;
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
    if (e.st === '中止' || e.x == null || e.d > lim) continue;
    if (!by.has(e.vc)) by.set(e.vc, e);
  }
  return { type: 'FeatureCollection', features: [...by.values()].map(e => ({ type: 'Feature', properties: { vc: e.vc, n: `${e.n} ${fleaDateLabel(e.d).replace('今日 ', '今日')}` }, geometry: { type: 'Point', coordinates: [e.x, e.y] } })) };
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
    if (fleaReady()) { await fleaFetch(true); renderFleaSettings(); toast(fleaErr ? fleaErr : 'フリマの予定を受け取りました'); }
  };
}
