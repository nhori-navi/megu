// zukan.js：図鑑と、場所の詳しい画面（MeguMiru 版10：名城の印・名城だけ・一言説明）
let zkShelf = getLS('zkshelf', 'st');
let zkPref = getLS('zkpref', '');
let zkState = getLS('zkstate', 'all');   // all / done / yet
let zkLimit = 200;
let zkMeijo = getLS('zkmeijo', false);   // 史跡の棚で「名城だけ」

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

function renderZukan() {
  const box = $('zkTabs');
  box.innerHTML = SHELF_ORDER.map(k => `<button class="zkTab${k === zkShelf ? ' on' : ''}" data-sh="${k}" style="--sc:${SHELVES[k].color}">${SHELVES[k].icon}<span>${SHELVES[k].name}</span></button>`).join('');
  box.querySelectorAll('.zkTab').forEach(b => b.onclick = () => { zkShelf = b.dataset.sh; setLS('zkshelf', zkShelf); zkLimit = 200; renderZukan(); });

  const meijoMode = zkShelf === 'hi' && zkMeijo && MEIJO.length > 0;
  const mb = $('zkMeijo');
  if (mb) { mb.hidden = zkShelf !== 'hi' || !MEIJO.length; mb.classList.toggle('on', meijoMode); }
  const all = meijoMode ? zkMeijoItems() : zkItems();
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
  if (zkShelf !== 'city' && !loadedPrefs) note = '<p class="note">まだどの都県のデータも読み込んでいません。地図で近づくか、設定から読み込んでください。</p>';
  const passTxt = (zkShelf === 'st' || zkShelf === 'city') && passN ? `（うち通過 ${passN}）` : '';
  $('zkStat').innerHTML = meijoMode
    ? `🏯 ${zkPref ? esc(PREF_NAME[zkPref]) : '関東甲信越'}の名城　行った ${doneN}<span class="sub"> ／ ${all.filter(s => !zkPref || s.p === zkPref).length}</span>`
    : `行った ${doneN}${passTxt}<span class="sub"> ／ ${zkShelf === 'city' ? '全' : '読み込み済み'} ${all.filter(s => !zkPref || s.p === zkPref).length}</span>`;

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
    if (s.sh === 'city' && r.lv === 1) st += '<p class="hint">乗り物で通っただけなので薄く塗っています。歩いて入ると濃くなります</p>';
  } else {
    let how = '';
    if (s.sh === 'st') how = s.u ? '地下の駅です。駅のまわり300m以内を通ると「通過」、ゆっくり3分いると「降車」になります'
      : '駅のまわり150m以内を通ると「通過」、ゆっくり3分いると「降車」になります';
    else if (s.sh === 'mi') how = '100m以内に入ると記録されます';
    else if (s.sh === 'mu') how = '100m以内に20分とどまると記録されます';
    else if (s.sh === 'hi') how = (s.sub === '古墳' ? '80m' : '200m') + '以内に入ると記録されます';
    else how = '中に入ると塗られます';
    const here = lastFix ? [lastFix.x, lastFix.y] : lastPos;
    const d = here && s.x != null ? `<p>ここから約 ${fmtDist(dist(here[0], here[1], s.x, s.y))}</p>` : '';
    st = `<p class="yetline">まだ行っていません</p>${d}<p class="hint">${how}</p>`;
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
    + `<div class="btnRow">${s.x != null ? '<button class="btn primary" id="shFly">地図で見る</button>' : ''}${gm}</div>`;
  $('sheet').hidden = false;
  const fly = $('shFly');
  if (fly) fly.onclick = () => { closeSheet(); showTab('map'); flyToSpot(s.x, s.y); };
  wikiFill(id, $('shWiki'));
}

function closeSheet() { $('sheet').hidden = true; }
