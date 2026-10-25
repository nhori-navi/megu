// zukan.js：図鑑と、場所の詳しい画面
// 版10：名城の印・一言説明
// 版11：路線の棚（乗った区間）・記録を消す・道の駅などの「通過」
// 版12：まとまりごとの一覧（見出しを押すと、その下に中身が開く。都県を選ぶと、まとまりの数もその都県の分）
let zkShelf = getLS('zkshelf', 'st');
let zkPref = getLS('zkpref', '');
let zkState = getLS('zkstate', 'all');   // all / done / yet
let zkView = getLS('zkview', 'group');   // group＝まとまりごと / flat＝全部を並べる
let zkLimit = 200;

function itemInfo(id) {
  // 場所の情報（読み込み済みのデータ → 記録の控え → 市区町村のデータ の順に探す）
  if (id[0] === 'c') {
    const c = CITY_BY.get(id.slice(1));
    if (c) return { id, sh: 'city', sub: '市区町村', n: c.n, p: c.c.slice(0, 2), x: (c.bb[0] + c.bb[2]) / 2, y: (c.bb[1] + c.bb[3]) / 2 };
  }
  const s = SPOTS.get(id);
  if (s) return s;
  const r = REC[id];
  if (r) return Object.assign({ id }, r.s);
  const m = meijoOf(id);    // 名城は、その都県を読み込む前でも出せる
  if (m) return { id, sh: 'hi', sub: '城跡', n: m.on || m.n, x: m.x, y: m.y, p: m.p, mj: m.no };
  const v = LINE_ST[id];    // 路線にある駅も、読み込む前から出せる
  if (v) return { id, sh: 'st', sub: '駅', n: v[0], x: v[1], y: v[2], p: v[3] };
  return null;
}

// 名城かどうか（場所データの番号・補った番号・記録の控えのどれでも）
function meijoNo(s) { if (s.mj) return s.mj; const m = meijoOf(s.id); return m ? m.no : 0; }

function zkMeijoItems() {
  return MEIJO.map(m => {
    const id = meijoMainId(m);
    return Object.assign({}, itemInfo(id) || {}, { id, mj: m.no });
  });
}

function zkItems() {
  const list = [];
  if (zkShelf === 'city') {
    for (const c of CITY) list.push({ id: 'c' + c.c, sh: 'city', sub: '市区町村', n: c.n, p: c.c.slice(0, 2) });
  } else {
    const seen = new Set();
    for (const s of SPOTS.values()) if (s.sh === zkShelf) { list.push(s); seen.add(s.id); }
    for (const [id, r] of Object.entries(REC)) if (r.s.sh === zkShelf && !seen.has(id)) list.push(Object.assign({ id }, r.s));
  }
  return list;
}

// ---------- 版11：路線（まとめた路線ごとの乗った区間） ----------
function lineStat(g) {
  let done = 0, est = 0, last = 0;
  for (const k of g.k) { const r = SEG[k]; if (r) { if (r.e) est++; else done++; if (r.l > last) last = r.l; } }
  return { done: done + est, est, total: g.k.length, last };
}
function lineInPref(g, pc) { return g.ss.some(id => LINE_ST[id] && LINE_ST[id][3] === pc); }

// 棒（訪問＝濃い、通過＝薄い）
function barHtml(a, b, total) {
  const pa = total ? Math.round(a / total * 1000) / 10 : 0, pb = total ? Math.round(b / total * 1000) / 10 : 0;
  return `<span class="bar"><i style="width:${pa}%"></i><i class="p" style="left:${pa}%;width:${pb}%"></i></span>`;
}


// ---------- 版12：まとまりごとの一覧 ----------
// まとまり：駅＝路線、市区町村・道の駅・ミュージアム＝都県、史跡＝名城と都県、路線＝会社
// 都県を選んでいるときは、まとまりの数も中身もその都県の分だけで数える
function zkRowHtml(s, here) {
  const lv = lvOf(s.id), r = REC[s.id];
  const dOf = (here && s.x != null) ? dist(here[0], here[1], s.x, s.y) : null;
  const st = lv ? `<span class="badge lv${lv}${r.e ? ' est' : ''}">${LV_NAME[s.sh][lv]}${r.e ? '・推定' : ''}</span><span class="date">${fmtDate(r.l)}</span>`
    : (dOf != null ? `<span class="date">${fmtDist(dOf)}</span>` : '');
  const sub = s.sh === 'st' || s.sh === 'city' ? '' : s.sub + '・';
  const mj = s.sh === 'hi' ? meijoNo(s) : 0;
  const mjTag = mj ? `<span class="mj">🏯${mj >= 101 ? '続100名城' : '100名城'}</span>` : '';
  return `<li class="row${lv ? '' : ' yet'}" data-id="${esc(s.id)}"><span class="dot" style="background:${SHELVES[s.sh].color}"></span>`
    + `<span class="nm">${esc(s.n)}<small>${mjTag}${esc(sub)}${esc(PREF_NAME[s.p] || '')}</small></span><span class="st">${st}</span></li>`;
}
function zkLineRowHtml(o) {
  const pct = o.total ? Math.round(o.done / o.total * 100) : 0;
  return `<li class="row lnRow${o.done ? '' : ' yet'}" data-gi="${o.gi}"><span class="dot" style="background:${SHELVES.ln.color}"></span>`
    + `<span class="nm">${esc(o.g.n)}<small>${esc(o.g.co)}・${o.done}／${o.total}区間${o.est ? `（うち推定 ${o.est}）` : ''}</small>${barHtml(o.done - o.est, o.est, o.total)}</span>`
    + `<span class="st">${o.done ? `<span class="badge${pct === 100 ? '' : ' lv1'}">${pct === 100 ? '乗りつぶし' : pct + '%'}</span>` : ''}</span></li>`;
}
const zkSortSpots = (items, here) => {
  const dOf = s => (here && s.x != null) ? dist(here[0], here[1], s.x, s.y) : Infinity;
  return items.sort((a, b) => {
    const ra = REC[a.id], rb = REC[b.id];
    if (ra && rb) return rb.l - ra.l;
    if (ra) return -1;
    if (rb) return 1;
    if (a.sh === 'city') return a.id < b.id ? -1 : 1;
    return dOf(a) - dOf(b);
  });
};
const inPref = s => !zkPref || s.p === zkPref;

// 棚のまとまり：[{key, n, sub, items, total, v, p, unit, order(並びを保つ)}]
function zkGroups() {
  const out = [];
  const cnt = items => { let v = 0, p = 0; for (const s of items) { const l = lvOf(s.id); if (l >= 2) v++; else if (l === 1) p++; } return [v, p]; };
  const add = (key, n, sub, items, unit, order) => {
    if (!items.length) return;
    const [v, p] = cnt(items);
    out.push({ key, n, sub, items, total: items.length, v, p, unit, order });
  };
  if (zkShelf === 'st') {
    const onLine = new Set();
    LINE_GROUPS.forEach((g, gi) => {
      const seen = new Set(), items = [];
      for (const ch of g.c) for (const id of ch) {
        if (seen.has(id)) continue;
        seen.add(id); onLine.add(id);
        const s = itemInfo(id);
        if (s && inPref(s)) items.push(s);
      }
      const part = zkPref && items.length < g.ss.length ? `（${PREF_NAME[zkPref]}の分）` : '';
      add('L' + gi, g.n, g.co + part, items, '駅', true);
    });
    const other = zkItems().filter(s => !onLine.has(s.id) && inPref(s));
    add('L-', 'その他の駅', '路線のデータにない駅', other, '駅');
  } else if (zkShelf === 'ln') {
    const by = new Map();
    LINE_GROUPS.forEach((g, gi) => {
      if (zkPref && !lineInPref(g, zkPref)) return;
      if (!by.has(g.co)) by.set(g.co, []);
      by.get(g.co).push(Object.assign({ g, gi }, lineStat(g)));
    });
    for (const [co, ls] of by) {
      const segs = ls.reduce((a, o) => a + o.done, 0), est = ls.reduce((a, o) => a + o.est, 0), total = ls.reduce((a, o) => a + o.total, 0);
      const full = ls.filter(o => o.total && o.done === o.total).length;
      out.push({ key: 'C' + co, n: co, sub: `${ls.length}路線・乗りつぶし ${full}`, items: ls, total, v: segs - est, p: est, unit: '区間', lines: true });
    }
  } else {
    if (zkShelf === 'hi' && MEIJO.length) add('M', '🏯 名城', '100名城・続100名城', zkMeijoItems().filter(inPref), '城');
    const all = zkItems();
    for (const [pc, name] of PREFS) {
      if (zkPref && pc !== zkPref) continue;
      const items = all.filter(s => s.p === pc);
      add('P' + pc, name, zkShelf !== 'city' && !PREF_META[pc] ? '未読み込み（行った所だけ）' : '', items, '');
    }
  }
  return out;
}

let zkOpen = new Set(getLS('zkopen', []));
let zkShowYetGroups = false;
const zkGLimit = {};
function zkToggle(k) {
  const key = zkShelf + ':' + k;
  if (zkOpen.has(key)) zkOpen.delete(key); else zkOpen.add(key);
  setLS('zkopen', [...zkOpen].slice(-60));
  renderZukan();
}

function renderZukan() {
  const box = $('zkTabs');
  box.innerHTML = ZK_ORDER.map(k => `<button class="zkTab${k === zkShelf ? ' on' : ''}" data-sh="${k}" style="--sc:${SHELVES[k].color}">${SHELVES[k].icon}<span>${SHELVES[k].name}</span></button>`).join('');
  box.querySelectorAll('.zkTab').forEach(b => b.onclick = () => { zkShelf = b.dataset.sh; setLS('zkshelf', zkShelf); zkLimit = 200; zkShowYetGroups = false; renderZukan(); });
  const vb = $('zkView');
  if (vb) { vb.textContent = zkView === 'group' ? '☰ 全部を並べる' : '▤ まとまりで見る'; }
  $('zkList').style.setProperty('--sc', SHELVES[zkShelf].color);
  if (zkView === 'flat') { if (zkShelf === 'ln') renderLinesFlat(); else renderFlat(); return; }
  renderGrouped();
}

function renderGrouped() {
  const here = lastFix ? [lastFix.x, lastFix.y] : lastPos;
  const groups = zkGroups();
  if (zkShelf === 'ln' && !LINE_GROUPS.length) {
    $('zkStat').innerHTML = '';
    $('zkList').innerHTML = '<p class="note">路線のデータがまだありません（GitHub で「場所データを作る」を動かすと用意されます）。</p>';
    return;
  }
  // いちばん上：棚ぜんたい（選んだ都県の分）
  if (zkShelf === 'ln') {
    const segs = groups.reduce((a, g) => a + g.v + g.p, 0), total = groups.reduce((a, g) => a + g.total, 0);
    const lines = groups.flatMap(g => g.items), full = lines.filter(o => o.total && o.done === o.total).length;
    $('zkStat').innerHTML = `乗った区間 ${segs}<span class="sub"> ／ ${total}</span>　<span class="sub">乗りつぶし ${full}／${lines.length}路線${zkPref ? `（${esc(PREF_NAME[zkPref])}を通る路線）` : ''}</span>`;
  } else {
    const uniq = new Map();
    for (const g of groups) if (g.key !== 'M') for (const s of g.items) uniq.set(s.id, s);
    const all = [...uniq.values()];
    const done = all.filter(s => lvOf(s.id) > 0).length, pass = all.filter(s => lvOf(s.id) === 1).length;
    $('zkStat').innerHTML = `${zkPref ? esc(PREF_NAME[zkPref]) + '　' : ''}行った ${done}${pass ? `（うち通過 ${pass}）` : ''}<span class="sub"> ／ ${zkShelf === 'city' ? '全' : 'わかっている'} ${all.length}</span>`;
  }
  const ratio = g => g.total ? (g.v + g.p) / g.total : 0;
  const pinned = groups.filter(g => g.key === 'M');
  const started = groups.filter(g => g.key !== 'M' && g.v + g.p > 0).sort((a, b) => ratio(b) - ratio(a) || (b.v + b.p) - (a.v + a.p));
  const yet = groups.filter(g => g.key !== 'M' && !(g.v + g.p));
  const unitOf = g => g.unit;
  const head = (g, open) => `<div class="grpH" data-k="${esc(g.key)}"><span class="grpA">${open ? '▾' : '▸'}</span>`
    + `<span class="grpN">${esc(g.n)}${g.sub ? `<small>${esc(g.sub)}</small>` : ''}</span>`
    + `<span class="grpV">${g.v + g.p}<small>／${g.total}${unitOf(g)}</small></span>${barHtml(g.v, g.p, g.total)}</div>`;
  const body = g => {
    let items = g.items;
    if (g.lines) {
      if (zkState === 'done') items = items.filter(o => o.done);
      if (zkState === 'yet') items = items.filter(o => !o.done);
      items = items.slice().sort((a, b) => (b.done ? 1 : 0) - (a.done ? 1 : 0) || (b.done / (b.total || 1)) - (a.done / (a.total || 1)) || b.last - a.last || (a.g.n < b.g.n ? -1 : 1));
    } else {
      if (zkState === 'done') items = items.filter(s => lvOf(s.id) > 0);
      if (zkState === 'yet') items = items.filter(s => lvOf(s.id) === 0);
      if (!g.order) items = zkSortSpots(items.slice(), here);
    }
    const lim = zkGLimit[g.key] || 100;
    if (!items.length) return '<p class="note grpE">該当するものはありません</p>';
    return `<ul class="list grpL">${items.slice(0, lim).map(o => g.lines ? zkLineRowHtml(o) : zkRowHtml(o, here)).join('')}</ul>`
      + (items.length > lim ? `<button class="btn wide grpMore" data-k="${esc(g.key)}">さらに表示（残り ${items.length - lim}）</button>` : '');
  };
  const block = g => { const open = zkOpen.has(zkShelf + ':' + g.key); return `<div class="grp${open ? ' open' : ''}">${head(g, open)}${open ? body(g) : ''}</div>`; };
  let html = pinned.concat(started).map(block).join('');
  if (yet.length) {
    html += `<button class="grpYet" id="zkYet">${zkShowYetGroups ? '▾' : '▸'} まだのまとまり（${yet.length}）</button>`;
    if (zkShowYetGroups) html += yet.map(block).join('');
  }
  let note = '';
  if (zkShelf !== 'city' && zkShelf !== 'ln' && !Object.keys(PREF_META).length) note = '<p class="note">まだどの都県のデータも読み込んでいません。地図で近づくか、設定から読み込んでください。</p>';
  $('zkList').innerHTML = note + (html || '<p class="note">該当するものはありません。</p>')
    + '<p class="achL"><i></i>' + (zkShelf === 'st' ? '降車' : zkShelf === 'ln' ? '乗った' : '訪問') + '<i class="p"></i>' + (zkShelf === 'ln' ? '推定' : '通過') + '</p>';
  const L = $('zkList');
  L.querySelectorAll('.grpH').forEach(h => h.onclick = () => zkToggle(h.dataset.k));
  L.querySelectorAll('.row[data-id]').forEach(li => li.onclick = () => showSpot(li.dataset.id));
  L.querySelectorAll('.row[data-gi]').forEach(li => li.onclick = () => showLine(+li.dataset.gi));
  L.querySelectorAll('.grpMore').forEach(b => b.onclick = () => { zkGLimit[b.dataset.k] = (zkGLimit[b.dataset.k] || 100) + 300; renderZukan(); });
  const y = $('zkYet');
  if (y) y.onclick = () => { zkShowYetGroups = !zkShowYetGroups; renderZukan(); };
}

// 全部を並べる（近い順・新しい順）
function renderFlat() {
  const here = lastFix ? [lastFix.x, lastFix.y] : lastPos;
  const all = zkItems().filter(inPref);
  let items = all;
  const doneN = items.filter(s => lvOf(s.id) > 0).length, passN = items.filter(s => lvOf(s.id) === 1).length;
  if (zkState === 'done') items = items.filter(s => lvOf(s.id) > 0);
  if (zkState === 'yet') items = items.filter(s => lvOf(s.id) === 0);
  zkSortSpots(items, here);
  let note = '';
  if (zkShelf !== 'city' && !Object.keys(PREF_META).length) note = '<p class="note">まだどの都県のデータも読み込んでいません。地図で近づくか、設定から読み込んでください。</p>';
  $('zkStat').innerHTML = `${zkPref ? esc(PREF_NAME[zkPref]) + '　' : ''}行った ${doneN}${passN ? `（うち通過 ${passN}）` : ''}<span class="sub"> ／ ${zkShelf === 'city' ? '全' : '読み込み済み'} ${all.length}</span>`;
  const rows = items.slice(0, zkLimit).map(s => zkRowHtml(s, here)).join('');
  $('zkList').innerHTML = note + (rows ? `<ul class="list">${rows}</ul>` : (note ? '' : '<p class="note">該当するものはありません。</p>'))
    + (items.length > zkLimit ? `<button id="zkMore" class="btn wide">さらに表示（残り ${items.length - zkLimit}）</button>` : '');
  $('zkList').querySelectorAll('.row').forEach(li => li.onclick = () => showSpot(li.dataset.id));
  const more = $('zkMore');
  if (more) more.onclick = () => { zkLimit += 300; renderZukan(); };
}

function renderLinesFlat() {
  if (!LINE_GROUPS.length) { $('zkStat').innerHTML = ''; $('zkList').innerHTML = '<p class="note">路線のデータがまだありません。</p>'; return; }
  let gs = LINE_GROUPS.map((g, gi) => Object.assign({ g, gi }, lineStat(g)));
  if (zkPref) gs = gs.filter(o => lineInPref(o.g, zkPref));
  const segs = gs.reduce((a, o) => a + o.done, 0), total = gs.reduce((a, o) => a + o.total, 0);
  const full = gs.filter(o => o.total && o.done === o.total).length;
  $('zkStat').innerHTML = `乗った区間 ${segs}<span class="sub"> ／ ${total}</span>　<span class="sub">乗りつぶし ${full}／${gs.length}路線</span>`;
  if (zkState === 'done') gs = gs.filter(o => o.done);
  if (zkState === 'yet') gs = gs.filter(o => !o.done);
  gs.sort((a, b) => (b.done ? 1 : 0) - (a.done ? 1 : 0) || (b.done / (b.total || 1)) - (a.done / (a.total || 1)) || b.last - a.last || (a.g.n < b.g.n ? -1 : 1));
  $('zkList').innerHTML = (gs.length ? `<ul class="list">${gs.slice(0, zkLimit).map(zkLineRowHtml).join('')}</ul>` : '<p class="note">該当する路線はありません。</p>')
    + (gs.length > zkLimit ? `<button id="zkMore" class="btn wide">さらに表示（残り ${gs.length - zkLimit}）</button>` : '');
  $('zkList').querySelectorAll('.row').forEach(li => li.onclick = () => showLine(+li.dataset.gi));
  const more = $('zkMore');
  if (more) more.onclick = () => { zkLimit += 300; renderZukan(); };
}

// 路線の詳しい画面：駅を並べた略図。乗った区間に色
function showLine(gi) {
  const g = LINE_GROUPS[gi];
  if (!g) return;
  const st = lineStat(g);
  const segCls = (a, b) => { const r = SEG[ekey(a, b)]; return r ? (r.e ? 'est' : 'on') : ''; };
  const first = g.k.map(k => SEG[k]).filter(Boolean).reduce((m, r) => Math.min(m, r.f), Infinity);
  const chains = g.c.map((ch, ci) => `${g.c.length > 1 ? `<p class="ldgT">${ci ? '枝分かれ・別の並び' : '本線'}（${ch.length}駅）</p>` : ''}<ol class="ldg">`
    + ch.map((id, i) => {
      const v = LINE_ST[id] || ['?'];
      const lv = lvOf(id);
      return `<li class="${i ? 'seg ' + segCls(ch[i - 1], id) : ''}" data-id="${esc(id)}"><span class="ldot lv${lv}"></span><span class="lnm">${esc(v[0])}</span>${lv ? `<small>${LV_NAME.st[lv]}</small>` : ''}</li>`;
    }).join('') + '</ol>').join('');
  $('sheetBody').innerHTML = `<div class="shHead" style="--sc:${SHELVES.ln.color}"><span class="shIcon">${SHELVES.ln.icon}</span><div><h3>${esc(g.n)}</h3><p class="sub">${esc(g.co)}・${g.ss.length}駅・${st.total}区間</p></div></div>`
    + `<p class="lvline"><b>乗った ${st.done}／${st.total}区間</b>${st.est ? `（うち推定 ${st.est}）` : ''}${barHtml(st.done - st.est, st.est, st.total)}</p>`
    + (isFinite(first) ? `<p>はじめて乗った：${fmtDate(first)}　最後：${fmtDate(st.last)}</p>` : '<p class="yetline">まだ乗っていません</p>')
    + '<p class="hint">隣り合う駅を続けて乗り物の速さで通ると、その間が「乗った」になります。点線は地下などで位置が途切れた間の推定です。駅名を押すと駅の詳しい画面</p>'
    + chains
    + `<div class="btnRow"><button class="btn primary" id="shFly">地図で見る</button></div>`;
  $('sheet').hidden = false;
  $('sheetBody').querySelectorAll('.ldg li').forEach(li => li.onclick = () => showSpot(li.dataset.id));
  $('shFly').onclick = () => {
    closeSheet(); showTab('map');
    const pts = g.ss.map(id => LINE_ST[id]).filter(Boolean);
    if (!filt.ln) { filt.ln = true; applyFilter(); }
    fitPoints(pts.map(v => [v[1], v[2]]));
  };
}

function initZukanControls() {
  const ps = $('zkPref');
  ps.innerHTML = '<option value="">10都県すべて</option>' + PREFS.map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
  ps.value = zkPref;
  ps.onchange = () => { zkPref = ps.value; setLS('zkpref', zkPref); zkLimit = 200; renderZukan(); };
  const ss = $('zkState');
  ss.value = zkState;
  ss.onchange = () => { zkState = ss.value; setLS('zkstate', zkState); zkLimit = 200; renderZukan(); };
  const vb = $('zkView');
  if (vb) vb.onclick = () => { zkView = zkView === 'group' ? 'flat' : 'group'; setLS('zkview', zkView); zkLimit = 200; renderZukan(); };
}

// ---------- 場所の詳しい画面 ----------
function showSpot(id) {
  const s = itemInfo(id);
  if (!s) return;
  const r = REC[id];
  const sh = SHELVES[s.sh];
  let st;
  if (r) {
    st = `<p class="lvline"><span class="badge lv${r.lv}${r.e ? ' est' : ''}">${LV_NAME[s.sh][r.lv]}${r.e ? '・推定' : ''}</span>${r.h ? '<span class="tag">📍 いまここで記録</span>' : ''}</p>`
      + `<p>はじめて：${fmtDate(r.f)} ${fmtTime(r.f)}</p>`
      + `<p>最後：${fmtDate(r.l)}　行った日数：${r.n}日</p>`;
    if (r.e) st += '<p class="hint">地下などで位置が途切れた間に、乗った駅と降りた駅を路線で結んで推定しました。実際に通る（地上で位置が取れる）と推定ではなくなります</p>';
    else if (s.sh === 'st' && r.lv === 1) st += '<p class="hint">ゆっくり3分いると「降車」になります</p>';
    else if (s.sh === 'city' && r.lv === 1) st += '<p class="hint">乗り物で通っただけなので薄く塗っています。歩いて入ると濃くなります</p>';
    else if (s.sh === 'mu' && r.lv === 1) st += '<p class="hint">前を通っただけなので「通過」です。100m以内に20分とどまると「訪問」になります</p>';
    else if ((s.sh === 'mi' || s.sh === 'hi') && r.lv === 1) st += '<p class="hint">乗り物の速さで通っただけなので「通過」です。歩くか止まって近くに入ると「訪問」になります</p>';
  } else {
    let how = '';
    if (s.sh === 'st') how = s.u ? '地下の駅です。駅のまわり300m以内を通ると「通過」、ゆっくり3分いると「降車」になります'
      : '駅のまわり150m以内を通ると「通過」、ゆっくり3分いると「降車」になります';
    else if (s.sh === 'mi') how = '100m以内を乗り物の速さで通ると「通過」、止まるか歩く速さで入ると「訪問」になります';
    else if (s.sh === 'mu') how = '100m以内を通ると「通過」、20分とどまると「訪問」になります';
    else if (s.sh === 'hi') how = (s.sub === '古墳' ? '80m' : '200m') + '以内を乗り物の速さで通ると「通過」、歩く速さで入ると「訪問」になります';
    else how = '中に入ると塗られます';
    const here = lastFix ? [lastFix.x, lastFix.y] : lastPos;
    const d = here && s.x != null ? `<p>ここから約 ${fmtDist(dist(here[0], here[1], s.x, s.y))}</p>` : '';
    st = `<p class="yetline">まだ行っていません</p>${d}<p class="hint">${how}</p>`;
  }
  // 版11：この駅を通る路線
  let lines = '';
  if (s.sh === 'st' && LINE_STG.has(id)) {
    lines = '<p class="lnLinks">' + LINE_STG.get(id).map(gi => `<button class="lnLink" data-gi="${gi}">🚃 ${esc(LINE_GROUPS[gi].n)}</button>`).join('') + '</p>';
  }
  const sub = s.sh === 'st' || s.sh === 'city' ? '' : s.sub + '・';
  const gm = s.x != null && s.sh !== 'city'
    ? `<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${s.y},${s.x}">Googleマップ</a>` : '';
  const mj = s.sh === 'hi' ? meijoNo(s) : 0;
  const mjLine = mj ? `<p class="mjLine">🏯 ${meijoLabel(mj)}</p>` : '';
  $('sheetBody').innerHTML = `<div class="shHead" style="--sc:${sh.color}"><span class="shIcon">${sh.icon}</span><div><h3>${esc(s.n)}</h3><p class="sub">${esc(sub)}${esc(PREF_NAME[s.p] || '')}</p></div></div>`
    + mjLine
    + (wikiOn ? `<div class="wiki" id="shWiki" data-id="${esc(id)}"></div>` : '')
    + st
    + lines
    + `<div class="btnRow">${s.x != null ? '<button class="btn primary" id="shFly">地図で見る</button>' : ''}${gm}</div>`
    + (r ? '<p class="delRow"><button class="linkBtn" id="shDel">この記録を消す</button></p>' : '');
  $('sheet').hidden = false;
  const fly = $('shFly');
  if (fly) fly.onclick = () => { closeSheet(); showTab('map'); flyToSpot(s.x, s.y); };
  $('sheetBody').querySelectorAll('.lnLink').forEach(b => b.onclick = () => showLine(+b.dataset.gi));
  const del = $('shDel');
  if (del) del.onclick = () => {
    if (!confirm(`「${s.n}」の記録を消しますか？\nまちがって付いた記録を消すためのものです。消すと元に戻せません。`)) return;
    deleteRec(id);
    closeSheet();
    toast(`「${s.n}」の記録を消しました`);
  };
  wikiFill(id, $('shWiki'));
}

function closeSheet() { $('sheet').hidden = true; }
