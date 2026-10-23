// ui.js：画面の切り替え・今日・設定（MeguMiru 版1）
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
function renderToday() {
  const today = ymd(Date.now());
  const ev = LOG.filter(e => ymd(e.t) === today);
  const cnt = {};
  for (const e of ev) {
    const r = REC[e.id]; if (!r) continue;
    if (e.k === 'new') cnt[r.s.sh] = (cnt[r.s.sh] || 0) + 1;
  }
  const sum = SHELF_ORDER.filter(k => cnt[k]).map(k => `${SHELVES[k].icon} ${SHELVES[k].name} ${cnt[k]}`).join('　');
  $('todaySum').innerHTML = ev.length
    ? `<p class="big">今日のはじめて：${Object.values(cnt).reduce((a, b) => a + b, 0)}</p><p>${sum || 'はじめての場所はまだありません'}</p>`
    : '<p class="big">今日の記録はまだありません</p><p class="note">アプリを開いたまま出かけると、通った駅や入った市区町村がここに並びます。</p>';
  const rows = ev.slice().reverse().map(e => {
    const r = REC[e.id]; if (!r) return '';
    const sh = SHELVES[r.s.sh];
    const k = e.k === 'new' ? 'はじめて' : e.k === 'up' ? LV_NAME[r.s.sh][e.lv] + 'に' : 'また来た';
    const lv = LV_NAME[r.s.sh][e.lv];
    return `<li class="row" data-id="${esc(e.id)}"><span class="time">${fmtTime(e.t)}</span><span class="dot" style="background:${sh.color}"></span>`
      + `<span class="nm">${esc(r.s.n)}<small>${r.s.sh === 'mu' || r.s.sh === 'hi' ? esc(r.s.sub) : sh.name}${lv && (r.s.sh === 'st' || r.s.sh === 'city') ? '・' + lv : ''}</small></span><span class="st"><span class="kind k-${e.k}">${k}</span></span></li>`;
  }).join('');
  $('todayList').innerHTML = rows ? `<ul class="list">${rows}</ul>` : '';
  $('todayList').querySelectorAll('.row').forEach(li => li.onclick = () => showSpot(li.dataset.id));
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

function afterRecChanged() {
  refreshSpots();
  refreshCity();
  if (curTab === 'today') renderToday();
  if (curTab === 'zukan') renderZukan();
}

// ---------- 画面の部品をつなぐ ----------
function wireUi() {
  document.querySelectorAll('#tabbar button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  $('chips').innerHTML = SHELF_ORDER.map(k => `<button class="chip" data-sh="${k}" style="--sc:${SHELVES[k].color}">${SHELVES[k].icon}<span>${SHELVES[k].name}</span></button>`).join('');
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
  $('btnHelp').onclick = () => showIntro(true);
  initZukanControls();
}
