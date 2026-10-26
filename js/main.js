// main.js：起動（MeguMiru 版14：ホーム画面のアプリ）
async function boot() {
  wireUi();
  wireIntro();
  updRecPill();
  try {
    await loadCity();
  } catch (e) {
    toast(jaErr(e), 5000);
  }
  await loadRec();
  await restorePrefs();
  await loadPlans();                 // 版12：行き先ピン
  await loadFleaCache();             // 版13：フリマ
  // 路線（途切れた間の駅の推定・乗った区間に使う）と線路の形。待たずに裏で
  loadLines().then(() => { if (curTab === 'zukan') renderZukan(); }).then(loadRails).then(() => refreshRides());

  onSpotsChanged = () => {
    refreshSpots();
    if (curTab === 'zukan') renderZukan();
    if (curTab === 'plan') renderPlan();
    if (!$('sheet').hidden && planOpen && $('plFly')) showPlan(planOpen);   // 行き先ピンの画面を開いていたら描き直す
  };
  onPlansChanged = () => { refreshPlans(); if (curTab === 'plan') renderPlan(); };
  onFleaChanged = () => { refreshFlea(); if (curTab === 'plan') renderPlan(); if (curTab === 'set') renderFleaSettings(); if (curTab === 'today') renderToday(); };
  setTimeout(() => fleaFetch(), 2500);   // 12時間たっていれば受け取り直す
  onSegChanged = () => { refreshRides(); if (curTab === 'zukan' && zkShelf === 'ln') renderZukan(); };
  onRecChanged = (id) => {
    if (id[0] === 'c') refreshCity(); else refreshSpots();
    if (curTab === 'today') renderToday();
    if (curTab === 'zukan') renderZukan();
    updHere();
  };
  onPrefStatus = (pc, s, msg) => {
    const old = prefState[pc];
    prefState[pc] = { s, msg, since: s === 'loading' && old && old.s === 'loading' ? old.since : Date.now() };
    updLoadPill();
    if (s === 'done') toast(`${PREF_NAME[pc]}のデータを読み込みました（${PREF_META[pc].n}件）`);
    if (s === 'fail') toast(`${PREF_NAME[pc]}のデータを読み込めませんでした：${msg}`, 4500);
    if (curTab === 'set') renderSettings();
  };
  // 版10：名城の一覧（毎月作り直すファイル）。読めたら札を付け直す
  loadMeijo().then(() => { if (applyMeijo()) onSpotsChanged(); else if (curTab === 'zukan') renderZukan(); });
  onFix = (fix, err) => { updRecPill(err); mapOnFix(fix); updHere(); nearCheck(fix); };
  wireNear();

  initMap();
  showTab('map');
  showIntro(false);
  startWatch();
  updWake();
  // 版9：MichiMiru の記録を読む（開いたとき・画面に戻ったとき・別のタブで記録が変わったとき）
  runMichi(1500);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') runMichi(500); });
  window.addEventListener('storage', e => { if (e.key === 'walk_tracks') runMichi(1000); });
}

window.addEventListener('DOMContentLoaded', boot);

// ---------- 版14：ホーム画面のアプリ ----------
let installEv = null;
const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEv = e; if (typeof curTab !== 'undefined' && curTab === 'set') renderPwa(); });
window.addEventListener('appinstalled', () => { installEv = null; toast('ホーム画面に置きました'); renderPwa(); });
function renderPwa() {
  const st = $('pwaStatus'), b = $('btnInstall');
  if (!st) return;
  st.textContent = isStandalone() ? '📱 ホーム画面のアプリとして開いています' : installEv ? 'このスマホのホーム画面に置けます' : 'Chrome で開いています';
  b.hidden = !installEv || isStandalone();
  b.onclick = async () => { if (!installEv) return; installEv.prompt(); try { await installEv.userChoice; } catch (e) { /* なし */ } installEv = null; renderPwa(); };
}
if ('serviceWorker' in navigator && (location.protocol === 'https:' || /[?&]swtest/.test(location.search))) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* 使えなくてもアプリは動く */ }));
}
