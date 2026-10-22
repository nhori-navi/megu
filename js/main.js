// main.js：起動（MeguMiru 版1）
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

  onSpotsChanged = () => { refreshSpots(); if (curTab === 'zukan') renderZukan(); };
  onRecChanged = (id) => {
    if (id[0] === 'c') refreshCity(); else refreshSpots();
    if (curTab === 'today') renderToday();
    if (curTab === 'zukan') renderZukan();
  };
  onPrefStatus = (pc, s, msg) => {
    prefState[pc] = { s, msg };
    updLoadPill();
    if (s === 'done') toast(`${PREF_NAME[pc]}のデータを読み込みました（${PREF_META[pc].n}件）`);
    if (s === 'fail') toast(`${PREF_NAME[pc]}のデータを読み込めませんでした：${msg}`, 4500);
    if (curTab === 'set') renderSettings();
  };
  onFix = (fix, err) => { updRecPill(err); mapOnFix(fix); };

  initMap();
  showTab('map');
  showIntro(false);
  startWatch();
  updWake();
}

window.addEventListener('DOMContentLoaded', boot);
