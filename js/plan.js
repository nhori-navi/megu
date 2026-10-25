// plan.js：行き先ピンと「計画」タブ（MeguMiru 版12。版13：フリマとの切り替え、フリマの★から立てたピン）
// ・地図を長押し（パソコンは右クリック）すると、そこに行き先ピンを立てられる。名前・日付（なくてもよい）・メモ
// ・ピンのまわり5kmの、まだ行っていない場所（駅・道の駅・ミュージアム・史跡）と、まだ乗っていない区間を出す
// ・日付が過ぎたピンは、その日にこのまわりで集めたものも出す
// ・ピンはこのスマホの中だけ（IndexedDB 'plans'）。書き出し・読み込みにも入る

let PLANS = [];        // [{id, n, x, y, d:'YYYY-MM-DD'|'', m:メモ, t:作った時刻, u:案内のページ, fl:フリマの番号}]
let onPlansChanged = () => {};
const PLAN_R = 5000;

async function loadPlans() {
  try { PLANS = (await DB.get('plans')) || []; } catch (e) { PLANS = []; }
}
async function savePlans() {
  onPlansChanged();
  try { await DB.set('plans', PLANS); } catch (e) { toast('行き先ピンを保存できませんでした'); }
}
const planById = id => PLANS.find(p => p.id === id);

// 5kmの中の、まだの場所・まだ乗っていない区間
function planNear(p) {
  const spots = new Map();
  for (const [s, d] of spotsNear(p.x, p.y, PLAN_R)) spots.set(s.id, [s, d]);
  // 都県のデータを読み込む前でも、路線にある駅は出せる
  for (const [id, d] of lineStationsNear(p.x, p.y, PLAN_R)) if (!spots.has(id)) { const s = itemInfo(id); if (s) spots.set(id, [s, d]); }
  const by = { st: [], mi: [], mu: [], hi: [] };
  for (const [s, d] of spots.values()) if (by[s.sh] && lvOf(s.id) < 2) by[s.sh].push([s, d]);
  for (const k in by) by[k].sort((a, b) => a[1] - b[1]);
  // まだ乗っていない区間（両側の駅が5kmの中）
  const inR = new Set(lineStationsNear(p.x, p.y, PLAN_R).map(([id]) => id));
  const lines = new Map();
  let segs = 0;
  for (const [k, gis] of LINE_EDGE) {
    if (SEG[k]) continue;
    const [a, b] = k.split('|');
    if (!inR.has(a) || !inR.has(b)) continue;
    segs++;
    for (const gi of gis) lines.set(gi, (lines.get(gi) || 0) + 1);
  }
  // 足りない都県のデータ
  const pcs = new Set();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, dx = PLAN_R / (111320 * Math.cos(p.y * Math.PI / 180)), dy = PLAN_R / 110540;
    for (const f of [0, 1]) { const pc = prefOfPoint(p.x + dx * Math.cos(a) * f, p.y + dy * Math.sin(a) * f); if (pc) pcs.add(pc); }
  }
  const missing = [...pcs].filter(pc => !PREF_META[pc]);
  return { by, segs, lines: [...lines.entries()].sort((a, b) => b[1] - a[1]), missing };
}

// その日にこのまわりで集めたもの
function planDayFinds(p) {
  if (!p.d) return [];
  const out = new Map();
  for (const e of LOG) {
    if (ymd(e.t) !== p.d || out.has(e.id)) continue;
    const r = REC[e.id];
    if (!r) continue;
    const s = itemInfo(e.id) || Object.assign({ id: e.id }, r.s);
    if (s.x == null || dist(p.x, p.y, s.x, s.y) > PLAN_R) continue;
    out.set(e.id, [s, e]);
  }
  return [...out.values()];
}

function planSummary(near) {
  const parts = SHELF_ORDER.filter(k => near.by[k] && near.by[k].length).map(k => `${SHELVES[k].icon}${near.by[k].length}`);
  if (near.segs) parts.push(`🚃${near.segs}区間`);
  return parts.length ? 'まだ：' + parts.join('　') : 'まわり5kmに、まだの場所はありません';
}

function planWhen(p) {
  if (!p.d) return { cls: 'nodate', label: '日付なし' };
  const today = ymd(Date.now());
  const d = new Date(p.d + 'T12:00:00');
  const wd = '日月火水木金土'[d.getDay()];
  const label = `${d.getMonth() + 1}/${d.getDate()}（${wd}）`;
  if (p.d === today) return { cls: 'today', label: '今日 ' + label };
  return p.d > today ? { cls: 'future', label } : { cls: 'past', label: `${d.getFullYear()}/${label}` };
}

// ---------- 計画タブ ----------
function renderPlan() {
  const box = $('planList');
  if (!box) return;
  // 版13：行き先ピン／フリマの切り替え
  $('pvPins').classList.toggle('on', planView !== 'flea');
  $('pvFlea').classList.toggle('on', planView === 'flea');
  $('planHint').hidden = planView === 'flea';
  if (planView === 'flea') { renderFlea(box); return; }
  const today = ymd(Date.now());
  const fut = PLANS.filter(p => p.d && p.d >= today).sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.t - b.t);
  const nod = PLANS.filter(p => !p.d).sort((a, b) => b.t - a.t);
  const past = PLANS.filter(p => p.d && p.d < today).sort((a, b) => a.d > b.d ? -1 : 1);
  const here = lastFix ? [lastFix.x, lastFix.y] : lastPos;
  const card = p => {
    const w = planWhen(p), near = planNear(p);
    const finds = w.cls === 'past' ? planDayFinds(p) : [];
    return `<li class="plan ${w.cls}" data-id="${esc(p.id)}"><span class="pDate">${esc(w.label)}</span>`
      + `<span class="pName">${p.fl ? '🛍' : '🚩'} ${esc(p.n)}${here ? `<small>ここから ${fmtDist(dist(here[0], here[1], p.x, p.y))}</small>` : ''}</span>`
      + `<span class="pSum">${w.cls === 'past' ? (finds.length ? `この日に集めたもの ${finds.length}` : 'この日の記録はありません') + '　' : ''}${esc(planSummary(near))}</span>`
      + (p.m ? `<span class="pMemo">${esc(p.m)}</span>` : '') + '</li>';
  };
  const sec = (title, ps) => ps.length ? `<h3>${title}</h3><ul class="plans">${ps.map(card).join('')}</ul>` : '';
  box.innerHTML = PLANS.length
    ? sec('これから', fut) + sec('日付なし', nod) + sec('過ぎたもの', past)
    : '<div class="card"><p class="big">行き先ピンはまだありません</p><p class="note">地図を長押しする（パソコンは右クリック）と、そこに行き先ピンを立てられます。ピンのまわり5kmの、まだ行っていない場所や乗っていない区間がここに並びます。</p></div>';
  box.querySelectorAll('.plan').forEach(li => li.onclick = () => showPlan(li.dataset.id));
}

// ---------- ピンの詳しい画面 ----------
let planOpen = null;     // 開いているピン（データを読み込んだら描き直す）
function showPlan(id) {
  const p = planById(id);
  if (!p) return;
  planOpen = id;
  const w = planWhen(p), near = planNear(p);
  for (const pc of near.missing) needPref(pc);
  const list = (items, more) => `<ul class="list pl">${items.map(([s, d]) => {
    const lv = lvOf(s.id);
    return `<li class="row" data-id="${esc(s.id)}"><span class="dot" style="background:${SHELVES[s.sh].color}"></span><span class="nm">${esc(s.n)}<small>${s.sh === 'st' ? '' : esc(s.sub)}${lv === 1 ? '・通過だけ' : ''}</small></span><span class="st"><span class="date">${fmtDist(d)}</span></span></li>`;
  }).join('')}</ul>${more ? `<p class="note">ほか ${more}</p>` : ''}`;
  let sect = '';
  for (const k of ['mu', 'hi', 'mi', 'st']) {
    const a = near.by[k];
    if (!a.length) continue;
    sect += `<details class="pd"${k !== 'st' ? ' open' : ''}><summary>${SHELVES[k].icon} ${SHELVES[k].name}　まだ ${a.length}</summary>${list(a.slice(0, 30), Math.max(0, a.length - 30))}</details>`;
  }
  if (near.segs) {
    sect += `<details class="pd"><summary>🚃 まだ乗っていない区間　${near.segs}</summary><ul class="list pl">`
      + near.lines.slice(0, 20).map(([gi, n]) => `<li class="row" data-gi="${gi}"><span class="dot" style="background:${SHELVES.ln.color}"></span><span class="nm">${esc(LINE_GROUPS[gi].n)}<small>${esc(LINE_GROUPS[gi].co)}</small></span><span class="st"><span class="date">${n}区間</span></span></li>`).join('')
      + '</ul></details>';
  }
  let finds = '';
  if (w.cls === 'past' || w.cls === 'today') {
    const f = planDayFinds(p);
    if (f.length) finds = `<details class="pd" open><summary>✨ この日にこのまわりで集めたもの　${f.length}</summary><ul class="list pl">`
      + f.map(([s, e]) => `<li class="row" data-id="${esc(s.id)}"><span class="time">${fmtTime(e.t)}</span><span class="dot" style="background:${SHELVES[s.sh].color}"></span><span class="nm">${esc(s.n)}</span><span class="st"><span class="kind k-${e.k}">${e.k === 'new' ? 'はじめて' : e.k === 'up' ? '上がった' : 'また'}</span></span></li>`).join('') + '</ul></details>';
  }
  $('sheetBody').innerHTML = `<div class="shHead" style="--sc:#5b4a6b"><span class="shIcon">🚩</span><div><h3>${esc(p.n)}</h3><p class="sub">${esc(w.label)}・行き先ピン</p></div></div>`
    + (p.m ? `<p class="pMemoL">${esc(p.m)}</p>` : '')
    + (p.u ? `<p><a href="${esc(p.u)}" target="_blank" rel="noopener">${p.fl ? 'フリマの案内（元のページ）' : '案内のページ'}</a>${p.fl && FLEA ? (() => { const e = FLEA.ev.find(x => x.id === p.fl); return e && e.st ? `　<span class="badge flSt">${esc(e.st)}</span>` : ''; })() : ''}</p>` : '')
    + (near.missing.length ? `<p class="note">${near.missing.map(pc => PREF_NAME[pc]).join('・')}のデータを読み込んでいます…（読み込むと増えます）</p>` : '')
    + finds
    + `<p class="lvline"><b>まわり5km</b>　${esc(planSummary(near))}</p>`
    + (sect || '<p class="note">まわり5kmに、まだ行っていない場所はありません。</p>')
    + `<div class="btnRow"><button class="btn primary" id="plFly">地図で見る</button><button class="btn" id="plEdit">直す</button>`
    + `<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${p.y},${p.x}">Googleマップ</a></div>`
    + '<p class="delRow"><button class="linkBtn" id="plDel">このピンを消す</button></p>';
  $('sheet').hidden = false;
  const B = $('sheetBody');
  B.querySelectorAll('.row[data-id]').forEach(li => li.onclick = () => showSpot(li.dataset.id));
  B.querySelectorAll('.row[data-gi]').forEach(li => li.onclick = () => showLine(+li.dataset.gi));
  $('plFly').onclick = () => { closeSheet(); showTab('map'); focusPlan(p.id); };
  $('plEdit').onclick = () => editPlan(p.id);
  $('plDel').onclick = () => {
    if (!confirm(`行き先ピン「${p.n}」を消しますか？`)) return;
    PLANS = PLANS.filter(q => q.id !== p.id);
    if (planFocus === p.id) planFocus = null;
    savePlans(); closeSheet(); toast('行き先ピンを消しました');
  };
}

// ---------- ピンを立てる・直す ----------
function newPlanAt(x, y) {
  const c = cityAt(x, y);
  if (!c) { toast('関東甲信越の10都県の中に立ててください'); return; }
  editPlan(null, { x, y, n: c.n });
}
function editPlan(id, init) {
  const p = id ? planById(id) : Object.assign({ d: '', m: '' }, init);
  if (!p) return;
  const isNew = !id;
  $('sheetBody').innerHTML = `<div class="shHead" style="--sc:#5b4a6b"><span class="shIcon">🚩</span><div><h3>${isNew ? '行き先ピンを立てる' : '行き先ピンを直す'}</h3><p class="sub">${esc(PREF_NAME[(cityAt(p.x, p.y) || { c: '' }).c.slice(0, 2)] || '')}</p></div></div>`
    + `<label class="fld">名前<input id="plN" type="text" maxlength="40" value="${esc(p.n)}"></label>`
    + `<label class="fld">日付（なくてもかまいません）<input id="plD" type="date" value="${esc(p.d)}"></label>`
    + `<label class="fld">メモ<textarea id="plM" rows="2" maxlength="200">${esc(p.m)}</textarea></label>`
    + `<div class="btnRow"><button class="btn primary" id="plSave">${isNew ? '立てる' : '保存'}</button><button class="btn" id="plCancel">やめる</button></div>`;
  $('sheet').hidden = false;
  $('plCancel').onclick = () => { if (isNew) closeSheet(); else showPlan(id); };
  $('plSave').onclick = () => {
    const n = $('plN').value.trim() || p.n || '行き先';
    const d = $('plD').value || '';
    const m = $('plM').value.trim();
    if (isNew) {
      const np = { id: 'p' + Date.now().toString(36), n, x: Math.round(p.x * 1e5) / 1e5, y: Math.round(p.y * 1e5) / 1e5, d, m, t: Date.now() };
      PLANS.push(np);
      planFocus = np.id;
      savePlans();
      toast('🚩 行き先ピンを立てました');
      showPlan(np.id);
    } else {
      Object.assign(p, { n, d, m });
      savePlans();
      showPlan(id);
    }
  };
}

// ---------- 書き出し・読み込み ----------
function mergePlans(list) {
  let add = 0;
  for (const p of (list || [])) {
    if (!p || !p.id || p.x == null) continue;
    const q = planById(p.id);
    if (!q) { PLANS.push(p); add++; }
  }
  if (add) savePlans();
  return add;
}
