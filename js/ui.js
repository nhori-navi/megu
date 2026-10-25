// ui.js：画面の切り替え・今日・設定（MeguMiru 版11：路線の棚・乗った区間。版10：一言説明。版9：月のふりかえり・MichiMiru の記録・近づいたら知らせる）
let curTab = 'map';

function showTab(t) {
  curTab = t;
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.panel').forEach(p => p.hidden = p.id !== 'p-' + t);
  $('mapWrap').classList.toggle('under', t !== 'map');
  if (t === 'map' && map) setTimeout(() => map.resize(), 30);
  if (t === 'today') renderToday();
  if (t === 'zukan') renderZukan();
  if (t === 'set') renderSettings();
}

// ---------- 記録中の表示 ----------
function updRecPill(msg) {
  const el = $('recPill');
  el.classList.toggle('off', !recOn);
  if (!recOn) { el.textContent = '⏸ 記録を止めています'; return; }
  if (msg) { el.textContent = '⚠️ ' + msg; return; }
  if (!lastFix) { el.textContent = '● 位置を探しています…'; return; }
  const acc = Math.round(lastFix.acc);
  el.textContent = acc > RULE.maxAcc ? `● 記録中（位置が粗い：±${acc}m）` : `● 記録中（±${acc}m）`;
}

// 都県の読み込み状況
const prefState = {};
let pillTimer = null;
function updLoadPill() {
  const busy = Object.entries(prefState).filter(([, v]) => v.s === 'loading');
  const el = $('loadPill');
  if (busy.length) {
    const now = Date.now();
    el.textContent = '⏳ ' + busy.map(([k, v]) => `${PREF_NAME[k]}：${v.msg || '読み込み中'}…${Math.round((now - v.since) / 1000)}秒`).join('／')
      + (prefQueue.length ? `（あと${prefQueue.length}都県）` : '');
    el.hidden = false;
    if (!pillTimer) pillTimer = setInterval(updLoadPill, 1000);
  } else {
    el.hidden = true;
    clearInterval(pillTimer); pillTimer = null;
  }
}

// ---------- 今日 ----------
// 版7：GPX でさかのぼった日も見られるように、日付を前後に動かせる
let todayDay = null;      // null＝今日、それ以外は 'YYYY-MM-DD'
function logDays() { return [...new Set(LOG.map(e => ymd(e.t)))].sort(); }
function moveDay(step) {
  const days = logDays(), today = ymd(Date.now());
  if (!days.includes(today)) days.push(today);
  days.sort();
  const cur = todayDay || today;
  let i = days.indexOf(cur);
  if (i < 0) { days.push(cur); days.sort(); i = days.indexOf(cur); }
  const j = Math.max(0, Math.min(days.length - 1, i + step));
  todayDay = days[j] === today ? null : days[j];
  renderToday();
}
// 版9：日ごと／月ごとの切り替え
let todayMode = 'day';
let monthCur = null;      // 'YYYY-MM'
function setTodayMode(m) {
  todayMode = m;
  renderToday();
}
function monthShift(step) {
  const [y, m] = (monthCur || ymd(Date.now()).slice(0, 7)).split('-').map(Number);
  const d = new Date(y, m - 1 + step, 1);
  monthCur = d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  renderToday();
}
function renderMonth() {
  const nowM = ymd(Date.now()).slice(0, 7);
  const mon = monthCur || nowM;
  const [y, m] = mon.split('-').map(Number);
  $('monthLabel').textContent = `${y}年${m}月`;
  const months = [...new Set(LOG.map(e => ymd(e.t).slice(0, 7)))].sort();
  $('monPrev').disabled = !months.some(x => x < mon);
  $('monNext').disabled = mon >= nowM;
  const ev = LOG.filter(e => ymd(e.t).slice(0, 7) === mon);
  const firstBy = {}, perDay = {}, firsts = [];
  for (const e of ev) {
    const r = REC[e.id]; if (!r) continue;
    const d = ymd(e.t);
    perDay[d] = perDay[d] || { all: 0, n: 0 };
    perDay[d].all++;
    if (e.k === 'new') { firstBy[r.s.sh] = (firstBy[r.s.sh] || 0) + 1; perDay[d].n++; firsts.push([e, r]); }
  }
  const total = Object.values(firstBy).reduce((a, b) => a + b, 0);
  const days = Object.keys(perDay).length;
  const sum = SHELF_ORDER.filter(k => firstBy[k]).map(k => `${SHELVES[k].icon} ${SHELVES[k].name} ${firstBy[k]}`).join('　');
  // 駅と市区町村以外（数が少ないもの）は名前も出す
  const rare = firsts.filter(([, r]) => r.s.sh !== 'st' && r.s.sh !== 'city').map(([, r]) => esc(r.s.n));
  $('todaySum').innerHTML = ev.length
    ? `<p class="big">この月のはじめて：${total}</p><p>${sum || 'はじめての場所はありません'}</p><p class="note">記録のあった日：${days}日</p>`
      + (rare.length ? `<p class="note">${rare.slice(0, 12).join('、')}${rare.length > 12 ? ` ほか${rare.length - 12}か所` : ''}</p>` : '')
    : '<p class="big">この月の記録はありません</p>';
  // カレンダー（日曜はじまり）
  const first = new Date(y, m - 1, 1), last = new Date(y, m, 0).getDate();
  let cells = '日月火水木金土'.split('').map(w => `<div class="calW">${w}</div>`).join('');
  for (let i = 0; i < first.getDay(); i++) cells += '<div></div>';
  const today = ymd(Date.now());
  for (let d = 1; d <= last; d++) {
    const key = `${mon}-${pad2(d)}`, pd = perDay[key];
    const cls = ['calD', pd ? 'has' : '', key === today ? 'today' : ''].join(' ');
    cells += `<button class="${cls}" type="button" data-day="${key}" ${pd ? '' : 'disabled'}><span>${d}</span>${pd ? `<small>${pd.n ? '+' + pd.n : '・'}</small>` : ''}</button>`;
  }
  $('todayList').innerHTML = `<div class="cal">${cells}</div><p class="note">数字はその日のはじめての数。押すとその日の記録を見られます</p>`;
  $('todayList').querySelectorAll('.calD.has').forEach(b => b.onclick = () => {
    todayDay = b.dataset.day === today ? null : b.dataset.day;
    setTodayMode('day');
  });
}
function renderToday() {
  $('modeDay').classList.toggle('on', todayMode === 'day');
  $('modeMonth').classList.toggle('on', todayMode === 'month');
  $('dayNavBox').hidden = todayMode !== 'day';
  $('monNavBox').hidden = todayMode !== 'month';
  if (todayMode === 'month') { renderMonth(); return; }
  const today = ymd(Date.now());
  const day = todayDay || today;
  const isToday = day === today;
  const days = logDays();
  const wd = '日月火水木金土'[new Date(day + 'T12:00:00').getDay()];
  $('dayLabel').textContent = isToday ? `今日（${+day.slice(5, 7)}/${+day.slice(8)}・${wd}）` : `${day.slice(0, 4)}/${+day.slice(5, 7)}/${+day.slice(8)}（${wd}）`;
  $('dayPrev').disabled = !days.some(d => d < day);
  $('dayNext').disabled = isToday;
  const label = isToday ? '今日' : 'この日';
  const ev = LOG.filter(e => ymd(e.t) === day);
  const cnt = {};
  for (const e of ev) {
    const r = REC[e.id]; if (!r) continue;
    if (e.k === 'new') cnt[r.s.sh] = (cnt[r.s.sh] || 0) + 1;
  }
  const segN = Object.values(SEG).filter(r => ymd(r.f) === day).length;     // 版11：はじめて乗った区間
  if (segN) cnt.ln = segN;
  const sum = ZK_ORDER.filter(k => cnt[k]).map(k => `${SHELVES[k].icon} ${SHELVES[k].name} ${cnt[k]}${k === 'ln' ? '区間' : ''}`).join('　');
  $('todaySum').innerHTML = ev.length || segN
    ? `<p class="big">${label}のはじめて：${Object.entries(cnt).filter(([k]) => k !== 'ln').reduce((a, [, b]) => a + b, 0)}</p><p>${sum || 'はじめての場所はありません'}</p>`
    : (isToday ? '<p class="big">今日の記録はまだありません</p><p class="note">アプリを開いたまま出かけると、通った駅や入った市区町村がここに並びます。閉じていた間の分は、設定から GPX を読み込めます。</p>'
      : '<p class="big">この日の記録はありません</p>');
  const rows = ev.slice().reverse().map(e => {
    const r = REC[e.id]; if (!r) return '';
    const sh = SHELVES[r.s.sh];
    const k = e.k === 'new' ? 'はじめて' : e.k === 'up' ? LV_NAME[r.s.sh][e.lv] + 'に' : 'また来た';
    const lv = LV_NAME[r.s.sh][e.lv] + (r.e && e.lv === r.lv ? '・推定' : '');
    return `<li class="row" data-id="${esc(e.id)}"${e.k === 'new' && r.s.sh !== 'city' ? ' data-wiki="1"' : ''}><span class="time">${fmtTime(e.t)}</span><span class="dot" style="background:${sh.color}"></span>`
      + `<span class="nm">${esc(r.s.n)}<small>${r.s.sh === 'mu' || r.s.sh === 'hi' ? esc(r.s.sub) : sh.name}${lv && (r.s.sh === 'st' || r.s.sh === 'city') ? '・' + lv : ''}</small></span><span class="st"><span class="kind k-${e.k}">${k}</span></span></li>`;
  }).join('');
  $('todayList').innerHTML = rows ? `<ul class="list">${rows}</ul>` : '';
  $('todayList').querySelectorAll('.row').forEach(li => li.onclick = () => showSpot(li.dataset.id));
  wikiRows($('todayList'));      // 版10：はじめての場所に一言説明
}

// ---------- 設定 ----------
function renderSettings() {
  $('setRec').checked = recOn;
  $('setWake').checked = wakeOn;
  $('setWakeRow').hidden = !('wakeLock' in navigator);
  const rows = PREFS.map(([pc, name]) => {
    const m = PREF_META[pc], st = prefState[pc];
    let s = m ? `${m.n}件・${fmtDate(m.t)}時点${m.src === 'file' ? '' : '（その場で取得）'}` : '未読み込み';
    if (st && st.s === 'loading') s = esc(st.msg || '読み込み中') + '…';
    else if (st && st.s === 'fail') s = '失敗：' + esc(st.msg || '') + (m ? `（前の${m.n}件を使用中）` : '');
    const busy = st && st.s === 'loading';
    return `<li class="row"><span class="nm">${name}<small>${s}</small></span><span class="st"><button class="btn sm" data-pc="${pc}" ${busy ? 'disabled' : ''}>${m ? '取り直す' : '読み込む'}</button></span></li>`;
  }).join('');
  $('prefList').innerHTML = `<ul class="list">${rows}</ul>`;
  $('prefList').querySelectorAll('button[data-pc]').forEach(b => b.onclick = () => { needPref(b.dataset.pc, true); renderSettings(); });
  const n = Object.keys(REC).length;
  $('recCount').textContent = `記録：${n}か所`;
  $('setMichi').checked = michiOn;
  $('setNear').checked = nearOn;
  $('setWiki').checked = wikiOn;
  const ml = getLS('michilast', 0), mn = getLS('michin', 0);
  $('michiStatus').textContent = !michiOn ? '使っていません' : ml ? `${mn}件の記録を読んでいます（最後に読んだ：${fmtDate(ml)} ${fmtTime(ml)}）` : 'まだ MichiMiru の記録はありません';
  const gn = getLS('gpxcount', 0);
  $('gpxCount').textContent = gn ? `これまでに読み込んだ GPX：${gn}件` : '';
  $('verLine').textContent = `MeguMiru 版${APP_VER}`;
  const top = $('seriesTop');
  if (SERIES_TOP_URL) { top.href = SERIES_TOP_URL; top.hidden = false; } else top.hidden = true;
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(backupData())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'megumiru-kiroku-' + ymd(Date.now()).replace(/-/g, '') + '.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  setLS('bklast', Date.now());
  toast('書き出しました');
}

function importBackup(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const add = mergeBackup(JSON.parse(rd.result));
      afterRecChanged();
      renderSettings();
      toast(`読み込みました（新しく ${add}か所）`, 3500);
    } catch (e) { toast('読み込めませんでした：' + jaErr(e), 4000); }
  };
  rd.readAsText(file);
}

async function clearAll() {
  if (!confirm('行った場所の記録を全部消します。元に戻せません。よろしいですか？')) return;
  if (!confirm('本当に消しますか？（先に「書き出す」でバックアップを取ることをおすすめします）')) return;
  REC = {}; LOG = [];
  await DB.set('rec', REC); await DB.set('log', LOG);
  afterRecChanged();
  renderSettings();
  toast('記録を消しました');
}

// ---------- いまここ（C） ----------
function updHere() {
  const c = hereCandidates();
  const b = $('mHere');
  b.hidden = !c.length;
  $('mHereN').textContent = c.length > 1 ? c.length : '';
}

function showHere() {
  const c = hereCandidates();
  if (!c.length) { toast('近くに、まだ記録していない場所はありません'); return; }
  const rows = c.map(([s, d]) => {
    const sh = SHELVES[s.sh];
    const lv = lvOf(s.id), r = REC[s.id];
    const now = lv ? `<small>いまは「${LV_NAME[s.sh][lv]}${r && r.e ? '・推定' : ''}」</small>` : '';
    return `<li class="row"><span class="dot" style="background:${sh.color}"></span><span class="nm">${esc(s.n)}<small>${esc(s.sh === 'st' ? '駅' : s.sub)}・約${fmtDist(d)}</small>${now}</span>`
      + `<span class="st"><button class="btn sm primary" data-id="${esc(s.id)}">ここにいる</button></span></li>`;
  }).join('');
  $('sheetBody').innerHTML = `<div class="shHead" style="--sc:var(--c)"><span class="shIcon">📍</span><div><h3>いまここ</h3><p class="sub">地下などで自動で記録されないときに、その場で記録できます</p></div></div>`
    + `<ul class="list">${rows}</ul><p class="hint">近く（500m以内）にいる間だけ押せます。駅は「降車」、ほかは「訪問」になります</p>`;
  $('sheet').hidden = false;
  $('sheetBody').querySelectorAll('button[data-id]').forEach(btn => btn.onclick = () => {
    if (markHere(btn.dataset.id)) { closeSheet(); updHere(); }
  });
}

// ---------- MichiMiru の記録（版9） ----------
let michiTimer = null;
function runMichi(delay) {
  clearTimeout(michiTimer);
  michiTimer = setTimeout(async () => {
    const r = await michiSync();
    await segPassOnce();
    if (!r || !r.tracks) return;
    afterRecChanged();
    if (curTab === 'set') renderSettings();
    const c = r.count;
    if (c.new || c.up) toast(`🚶 MichiMiru の記録から：はじめて ${c.new}` + (c.est ? `（うち推定 ${c.est}）` : '') + (c.up ? `・段階が上がった ${c.up}` : ''), 5000);
  }, delay || 0);
}

// 版11：これまでの MichiMiru の記録から、乗った区間を1回だけ拾い直す（まとめた路線のデータがあるときだけ）
async function segPassOnce() {
  if (getLS('segpass', false) || !michiOn) return;
  if (!LINES.length) await loadLines();
  if (!LINE_GROUPS.length) return;
  const r = await michiSync(null, { segOnly: true });
  if (!r) return;
  setLS('segpass', true);
  if (r.count.seg) {
    refreshRides();
    if (curTab === 'zukan') renderZukan();
    toast(`🚃 MichiMiru の記録から、乗った区間 ${r.count.seg}`, 5000);
  }
}

// ---------- GPX（OpenTracks など） ----------
async function onGpxFiles(files) {
  if (!files.length) return;
  const st = $('gpxStatus');
  st.textContent = '読み込んでいます…';
  $('btnGpx').disabled = true;
  try {
    const r = await importGpxFiles([...files], m => { st.textContent = m; });
    if (!r) { st.textContent = ''; return; }
    afterRecChanged();
    renderSettings();
    const c = r.count;
    let msg;
    if (!r.files) msg = r.skipped ? `読み込み済みのファイルでした（${r.skipped}件）` : '読める記録がありませんでした（時刻のある GPX が必要です）';
    else {
      msg = `${r.files}件を読み込みました（${fmtDate(r.from)}〜${fmtDate(r.to)}）。はじめて ${c.new}`
        + (c.est ? `（うち推定 ${c.est}）` : '') + `・段階が上がった ${c.up}・別の日にまた ${c.again}`;
      if (r.skipped) msg += `。読み込み済み ${r.skipped}件は飛ばしました`;
    }
    if (r.bad) msg += `。読めなかったファイル ${r.bad}件`;
    st.textContent = msg;
    toast(msg, 5000);
    if (r.files && r.to) todayDay = ymd(r.to) === ymd(Date.now()) ? null : ymd(r.to);   // 「今日」の画面で、読み込んだ最後の日を見せる
  } catch (e) {
    st.textContent = '読み込めませんでした：' + jaErr(e);
  } finally {
    $('btnGpx').disabled = false;
  }
}

function afterRecChanged() {
  refreshSpots();
  refreshRides();
  refreshCity();
  updHere();
  if (curTab === 'today') renderToday();
  if (curTab === 'zukan') renderZukan();
}

// ---------- 画面の部品をつなぐ ----------
function wireUi() {
  document.querySelectorAll('#tabbar button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  $('chips').innerHTML = ZK_ORDER.map(k => `<button class="chip" data-sh="${k}" style="--sc:${SHELVES[k].color}">${SHELVES[k].icon}<span>${SHELVES[k].name}</span></button>`).join('');
  document.querySelectorAll('#chips .chip').forEach(b => b.onclick = () => { filt[b.dataset.sh] = !filt[b.dataset.sh]; applyFilter(); });
  applyFilter();
  $('mFollow').onclick = () => {
    setFollow(true);
    if (lastFix && mapReady) map.easeTo({ center: [lastFix.x, lastFix.y], zoom: Math.max(map.getZoom(), 14) });
  };
  setFollow(true);
  $('recPill').onclick = () => showTab('set');
  $('sheet').onclick = e => { if (e.target.id === 'sheet') closeSheet(); };
  $('sheetClose').onclick = closeSheet;
  $('setRec').onchange = e => { setRecOn(e.target.checked); updRecPill(); };
  $('setWake').onchange = e => { wakeOn = e.target.checked; setLS('wake', wakeOn); updWake(); };
  $('btnExport').onclick = exportBackup;
  $('btnImport').onclick = () => $('fileImport').click();
  $('fileImport').onchange = e => { const f = e.target.files[0]; if (f) importBackup(f); e.target.value = ''; };
  $('btnClear').onclick = clearAll;
  $('btnGpx').onclick = () => $('fileGpx').click();
  $('fileGpx').onchange = e => { const f = e.target.files; if (f && f.length) onGpxFiles(f); e.target.value = ''; };
  $('mHere').onclick = showHere;
  $('dayPrev').onclick = () => moveDay(-1);
  $('modeDay').onclick = () => setTodayMode('day');
  $('modeMonth').onclick = () => { monthCur = (todayDay || ymd(Date.now())).slice(0, 7); setTodayMode('month'); };
  $('monPrev').onclick = () => monthShift(-1);
  $('monNext').onclick = () => monthShift(1);
  $('setMichi').onchange = e => { michiOn = e.target.checked; setLS('michion', michiOn); if (michiOn) { michiSig = ''; runMichi(); } renderSettings(); };
  $('setWiki').onchange = e => { wikiOn = e.target.checked; setLS('wikion', wikiOn); };
  $('setNear').onchange = e => { nearOn = e.target.checked; setLS('nearon', nearOn); if (!nearOn) hideNear(); };
  $('dayNext').onclick = () => moveDay(1);
  $('btnHelp').onclick = () => showIntro(true);
  initZukanControls();
}
