// main.js：起動（MeguMiru 版9）
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
  loadLines();                       // 路線（途切れた間の駅の推定に使う）。待たずに裏で

  onSpotsChanged = () => { refreshSpots(); if (curTab === 'zukan') renderZukan(); };
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
