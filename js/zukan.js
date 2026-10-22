// zukan.js：図鑑と、場所の詳しい画面（MeguMiru 版1）
let zkShelf = getLS('zkshelf', 'st');
let zkPref = getLS('zkpref', '');
let zkState = getLS('zkstate', 'all');   // all / done / yet
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
  return null;
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

  const all = zkItems();
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
  $('zkStat').innerHTML = `行った ${doneN}${passTxt}<span class="sub"> ／ ${zkShelf === 'city' ? '全' : '読み込み済み'} ${all.filter(s => !zkPref || s.p === zkPref).length}</span>`;

  const rows = items.slice(0, zkLimit).map(s => {
    const lv = lvOf(s.id), r = REC[s.id];
    const st = lv ? `<span class="badge lv${lv}">${LV_NAME[s.sh][lv]}</span><span class="date">${fmtDate(r.l)}</span>`
      : (here && s.x != null ? `<span class="date">${fmtDist(dOf(s))}</span>` : '');
    const sub = s.sh === 'st' || s.sh === 'city' ? '' : s.sub + '・';
    return `<li class="row${lv ? '' : ' yet'}" data-id="${esc(s.id)}"><span class="dot" style="background:${SHELVES[s.sh].color}"></span>`
      + `<span class="nm">${esc(s.n)}<small>${esc(sub)}${esc(PREF_NAME[s.p] || '')}</small></span><span class="st">${st}</span></li>`;
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
}

// ---------- 場所の詳しい画面 ----------
function showSpot(id) {
  const s = itemInfo(id);
  if (!s) return;
  const r = REC[id];
  const sh = SHELVES[s.sh];
  let st;
  if (r) {
    st = `<p class="lvline"><span class="badge lv${r.lv}">${LV_NAME[s.sh][r.lv]}</span></p>`
      + `<p>はじめて：${fmtDate(r.f)} ${fmtTime(r.f)}</p>`
      + `<p>最後：${fmtDate(r.l)}　行った日数：${r.n}日</p>`;
    if (s.sh === 'st' && r.lv === 1) st += '<p class="hint">ゆっくり3分いると「降車」になります</p>';
    if (s.sh === 'city' && r.lv === 1) st += '<p class="hint">乗り物で通っただけなので薄く塗っています。歩いて入ると濃くなります</p>';
  } else {
    let how = '';
    if (s.sh === 'st') how = '駅のまわり150m以内を通ると「通過」、ゆっくり3分いると「降車」になります';
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
  $('sheetBody').innerHTML = `<div class="shHead" style="--sc:${sh.color}"><span class="shIcon">${sh.icon}</span><div><h3>${esc(s.n)}</h3><p class="sub">${esc(sub)}${esc(PREF_NAME[s.p] || '')}</p></div></div>`
    + st
    + `<div class="btnRow">${s.x != null ? '<button class="btn primary" id="shFly">地図で見る</button>' : ''}${gm}</div>`;
  $('sheet').hidden = false;
  const fly = $('shFly');
  if (fly) fly.onclick = () => { closeSheet(); showTab('map'); flyToSpot(s.x, s.y); };
}

function closeSheet() { $('sheet').hidden = true; }
