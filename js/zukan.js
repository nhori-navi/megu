// zukan.js：図鑑と、場所の詳しい画面
// 版10：名城の印・名城だけ・一言説明
// 版11：路線の棚（乗った区間）・達成状況（棚ごとのまとまりの棒）・記録を消す・道の駅などの「通過」
let zkShelf = getLS('zkshelf', 'st');
let zkPref = getLS('zkpref', '');
let zkState = getLS('zkstate', 'all');   // all / done / yet
let zkLimit = 200;
let zkMeijo = getLS('zkmeijo', false);   // 史跡の棚で「名城だけ」
let zkGroup = '';                        // 達成状況の棒で絞り込み中（駅の棚：'L'＋路線の番号、路線の棚：'C'＋会社の名前）
let zkAchOpen = getLS('zkachopen', false);

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

// ---------- 版11：達成状況（棚ごとのまとまり） ----------
function achRows() {
  const rows = [];
  const cnt = ids => { let v = 0, p = 0; for (const id of ids) { const l = lvOf(id); if (l >= 2) v++; else if (l === 1) p++; } return [v, p]; };
  if (zkShelf === 'st') {
    LINE_GROUPS.forEach((g, gi) => {
      const [v, p] = cnt(g.ss);
      if (v + p) rows.push({ key: 'L' + gi, n: g.n, sub: g.co, v, p, total: g.ss.length, unit: '駅' });
    });
  } else if (zkShelf === 'city') {
    for (const [pc, name] of PREFS) {
      const ids = CITY.filter(c => c.c.slice(0, 2) === pc).map(c => 'c' + c.c);
      const [v, p] = cnt(ids);
      rows.push({ key: 'P' + pc, n: name, v, p, total: ids.length, unit: '' });
    }
  } else if (zkShelf === 'ln') {
    const by = new Map();
    LINE_GROUPS.forEach(g => {
      const st = lineStat(g);
      if (!by.has(g.co)) by.set(g.co, { lines: 0, full: 0, segs: 0, total: 0, est: 0 });
      const o = by.get(g.co);
      o.lines++; o.segs += st.done; o.total += st.total; o.est += st.est;
      if (st.total && st.done === st.total) o.full++;
    });
    for (const [co, o] of by) if (o.segs) rows.push({ key: 'C' + co, n: co, v: o.segs - o.est, p: o.est, total: o.total, unit: '区間', extra: `乗りつぶし ${o.full}／${o.lines}路線` });
  } else {
    if (zkShelf === 'hi' && MEIJO.length) {
      let v = 0, p = 0;
      for (const m of MEIJO) { const l = meijoLv(m); if (l >= 2) v++; else if (l === 1) p++; }
      rows.push({ key: 'M', n: '🏯 名城（100名城・続100名城）', v, p, total: MEIJO.length, unit: '城' });
    }
    const all = zkItems();
    for (const [pc, name] of PREFS) {
      const ids = all.filter(s => s.p === pc).map(s => s.id);
      if (!PREF_META[pc] && !ids.length) continue;
      const [v, p] = cnt(ids);
      rows.push({ key: 'P' + pc, n: name, v, p, total: ids.length, unit: '', sub: PREF_META[pc] ? '' : '未読み込み' });
    }
  }
  const ratio = r => r.total ? (r.v + r.p) / r.total : 0;
  if (zkShelf === 'st' || zkShelf === 'ln') rows.sort((a, b) => ratio(b) - ratio(a) || (b.v + b.p) - (a.v + a.p));
  return rows;
}

function renderAch() {
  const box = $('zkAch');
  if (!box) return;
  const rows = achRows();
  const isOn = r => (r.key === 'M' && zkMeijo && zkShelf === 'hi') || (r.key[0] === 'P' && zkPref === r.key.slice(1)) || (zkGroup && zkGroup === r.key);
  if (!rows.length) {
    box.innerHTML = zkShelf === 'st' && !LINE_GROUPS.length ? '' : `<div class="ach"><p class="achT">達成状況</p><p class="note">${zkShelf === 'ln' ? 'まだ乗った区間はありません。電車に乗ると、駅と駅の間が記録されます' : 'まだ記録がありません'}</p></div>`;
    return;
  }
  const show = zkAchOpen ? rows : rows.slice(0, 4);
  box.innerHTML = `<div class="ach" style="--sc:${SHELVES[zkShelf].color}"><p class="achT">達成状況${zkShelf === 'st' ? '（路線ごとの駅）' : zkShelf === 'ln' ? '（会社ごと）' : '（都県ごと）'}</p><ul>`
    + show.map(r => `<li class="achR${isOn(r) ? ' on' : ''}" data-k="${esc(r.key)}"><span class="achN">${esc(r.n)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span>`
      + `<span class="achV">${r.v + r.p}<small>／${r.total}${r.unit}</small></span>${barHtml(r.v, r.p, r.total)}`
      + (r.extra ? `<small class="achX">${esc(r.extra)}</small>` : '') + '</li>').join('')
    + '</ul>' + (rows.length > 4 ? `<button class="achMore" id="achMore">${zkAchOpen ? '閉じる ▴' : `すべて見る（${rows.length}） ▾`}</button>` : '')
    + '<p class="achL"><i></i>' + (zkShelf === 'st' ? '降車' : zkShelf === 'ln' ? '乗った' : '訪問') + '<i class="p"></i>' + (zkShelf === 'ln' ? '推定' : '通過') + '</p></div>';
  box.querySelectorAll('.achR').forEach(li => li.onclick = () => {
    const k = li.dataset.k;
    if (k === 'M') { zkMeijo = !zkMeijo; setLS('zkmeijo', zkMeijo); }
    else if (k[0] === 'P') { zkPref = zkPref === k.slice(1) ? '' : k.slice(1); setLS('zkpref', zkPref); $('zkPref').value = zkPref; }
    else zkGroup = zkGroup === k ? '' : k;
    zkLimit = 200; renderZukan();
  });
  const more = $('achMore');
  if (more) more.onclick = () => { zkAchOpen = !zkAchOpen; setLS('zkachopen', zkAchOpen); renderAch(); };
}

function renderZukan() {
  const box = $('zkTabs');
  box.innerHTML = ZK_ORDER.map(k => `<button class="zkTab${k === zkShelf ? ' on' : ''}" data-sh="${k}" style="--sc:${SHELVES[k].color}">${SHELVES[k].icon}<span>${SHELVES[k].name}</span></button>`).join('');
  box.querySelectorAll('.zkTab').forEach(b => b.onclick = () => { zkShelf = b.dataset.sh; setLS('zkshelf', zkShelf); zkLimit = 200; zkGroup = ''; renderZukan(); });
  if (zkGroup && zkGroup[0] !== (zkShelf === 'st' ? 'L' : zkShelf === 'ln' ? 'C' : '-')) zkGroup = '';

  const mb = $('zkMeijo');
  if (mb) { mb.hidden = zkShelf !== 'hi' || !MEIJO.length; mb.classList.toggle('on', zkShelf === 'hi' && zkMeijo); }
  renderAch();
  // 絞り込み中の印
  let gname = '';
  if (zkGroup[0] === 'L') { const g = LINE_GROUPS[+zkGroup.slice(1)]; gname = g ? g.n : ''; }
  if (zkGroup[0] === 'C') gname = zkGroup.slice(1);
  $('zkFilt').innerHTML = gname ? `<button class="chip on" id="zkFiltX">${esc(gname)} だけ ×</button>` : '';
  if (gname) $('zkFiltX').onclick = () => { zkGroup = ''; renderZukan(); };

  if (zkShelf === 'ln') { renderLines(); return; }

  const meijoMode = zkShelf === 'hi' && zkMeijo && MEIJO.length > 0;
  let all;
  if (meijoMode) all = zkMeijoItems();
  else if (zkGroup[0] === 'L' && LINE_GROUPS[+zkGroup.slice(1)]) all = LINE_GROUPS[+zkGroup.slice(1)].ss.map(id => itemInfo(id)).filter(Boolean);
  else all = zkItems();
  let items = all.filter(s => !zkPref || s.p === zkPref);
  const doneN = items.filter(s => lvOf(s.id) > 0).length;
  const passN = items.filter(s => lvOf(s.id) === 1).length;
  if (zkState === 'done') items = items.filter(s => lvOf(s.id) > 0);
  if (zkState === 'yet') items = items.filter(s => lvOf(s.id) === 0);

  const here = lastFix ? [lastFix.x, lastFix.y] : lastPos;
  const dOf = s => (here && s.x != null) ? dist(here[0], here[1], s.x, s.y) : Infinity;
  items.sort((a, b) => {
    const ra = REC[a.id], rb = REC[b.id];
    if (ra && rb) return rb.l - ra.l;
    if (ra) return -1;
    if (rb) return 1;
    if (zkShelf === 'city') return a.id < b.id ? -1 : 1;
    return dOf(a) - dOf(b);
  });

  const loadedPrefs = Object.keys(PREF_META).length;
  let note = '';
  if (zkShelf !== 'city' && !loadedPrefs && !zkGroup && !meijoMode) note = '<p class="note">まだどの都県のデータも読み込んでいません。地図で近づくか、設定から読み込んでください。</p>';
  const passTxt = passN ? `（うち通過 ${passN}）` : '';
  const totalN = all.filter(s => !zkPref || s.p === zkPref).length;
  $('zkStat').innerHTML = meijoMode
    ? `🏯 ${zkPref ? esc(PREF_NAME[zkPref]) : '関東甲信越'}の名城　行った ${doneN}${passTxt}<span class="sub"> ／ ${totalN}</span>`
    : `行った ${doneN}${passTxt}<span class="sub"> ／ ${zkShelf === 'city' || zkGroup ? '全' : '読み込み済み'} ${totalN}</span>`;

  const rows = items.slice(0, zkLimit).map(s => {
    const lv = lvOf(s.id), r = REC[s.id];
    const st = lv ? `<span class="badge lv${lv}${r.e ? ' est' : ''}">${LV_NAME[s.sh][lv]}${r.e ? '・推定' : ''}</span><span class="date">${fmtDate(r.l)}</span>`
      : (here && s.x != null ? `<span class="date">${fmtDist(dOf(s))}</span>` : '');
    const sub = s.sh === 'st' || s.sh === 'city' ? '' : s.sub + '・';
    const mj = s.sh === 'hi' ? meijoNo(s) : 0;
    const mjTag = mj ? `<span class="mj">🏯${mj >= 101 ? '続100名城' : '100名城'}</span>` : '';
    return `<li class="row${lv ? '' : ' yet'}" data-id="${esc(s.id)}"><span class="dot" style="background:${SHELVES[s.sh].color}"></span>`
      + `<span class="nm">${esc(s.n)}<small>${mjTag}${esc(sub)}${esc(PREF_NAME[s.p] || '')}</small></span><span class="st">${st}</span></li>`;
  }).join('');
  $('zkList').innerHTML = note + (rows ? `<ul class="list">${rows}</ul>` : (note ? '' : '<p class="note">該当するものはありません。</p>'))
    + (items.length > zkLimit ? `<button id="zkMore" class="btn wide">さらに表示（残り ${items.length - zkLimit}）</button>` : '');
  $('zkList').querySelectorAll('.row').forEach(li => li.onclick = () => showSpot(li.dataset.id));
  const more = $('zkMore');
  if (more) more.onclick = () => { zkLimit += 300; renderZukan(); };
}

// 路線の棚の一覧
function renderLines() {
  if (!LINE_GROUPS.length) {
    $('zkStat').innerHTML = '';
    $('zkList').innerHTML = '<p class="note">路線のデータがまだありません（GitHub で「場所データを作る」を動かすと用意されます）。</p>';
    return;
  }
  let gs = LINE_GROUPS.map((g, gi) => Object.assign({ g, gi }, lineStat(g)));
  if (zkGroup[0] === 'C') gs = gs.filter(o => o.g.co === zkGroup.slice(1));
  if (zkPref) gs = gs.filter(o => lineInPref(o.g, zkPref));
  const segs = gs.reduce((a, o) => a + o.done, 0), total = gs.reduce((a, o) => a + o.total, 0);
  const full = gs.filter(o => o.total && o.done === o.total).length, some = gs.filter(o => o.done).length;
  $('zkStat').innerHTML = `乗った区間 ${segs}<span class="sub"> ／ ${total}</span>　<span class="sub">乗った路線 ${some}・乗りつぶし ${full}／${gs.length}路線</span>`;
  if (zkState === 'done') gs = gs.filter(o => o.done);
  if (zkState === 'yet') gs = gs.filter(o => !o.done);
  gs.sort((a, b) => (b.done ? 1 : 0) - (a.done ? 1 : 0) || (b.done / (b.total || 1)) - (a.done / (a.total || 1)) || b.last - a.last || (a.g.n < b.g.n ? -1 : 1));
  const rows = gs.slice(0, zkLimit).map(o => {
    const pct = o.total ? Math.round(o.done / o.total * 100) : 0;
    return `<li class="row lnRow${o.done ? '' : ' yet'}" data-gi="${o.gi}"><span class="dot" style="background:${SHELVES.ln.color}"></span>`
      + `<span class="nm">${esc(o.g.n)}<small>${esc(o.g.co)}・${o.done}／${o.total}区間${o.est ? `（うち推定 ${o.est}）` : ''}</small>${barHtml(o.done - o.est, o.est, o.total)}</span>`
      + `<span class="st">${o.done ? `<span class="badge${pct === 100 ? '' : ' lv1'}" style="--c:${SHELVES.ln.color}">${pct === 100 ? '乗りつぶし' : pct + '%'}</span>` : ''}</span></li>`;
  }).join('');
  $('zkList').innerHTML = (rows ? `<ul class="list">${rows}</ul>` : '<p class="note">該当する路線はありません。</p>')
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
  const mb = $('zkMeijo');
  if (mb) mb.onclick = () => { zkMeijo = !zkMeijo; setLS('zkmeijo', zkMeijo); zkLimit = 200; renderZukan(); };
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
