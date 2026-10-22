// rec.js：位置の記録と「訪れた」の判定（MeguMiru 版1）

let REC = {};      // 場所の番号 → {lv, f, l, n, d, s}  lv=段階, f=初めて, l=最後, n=行った日数, d=最後の日, s=場所の控え
let LOG = [];      // [{t, id, lv, k}]  k: new=初めて / up=段階が上がった / again=別の日にまた
let recOn = getLS('recon', true);
let watchId = null;
let lastFix = null;          // {x, y, acc, t, spd}
let lastPos = getLS('lastpos', null);  // [経度, 緯度]
const stay = {};             // 場所の番号 → {ms: とどまった合計, t: 最後に数えた時刻}
let onRecChanged = () => {};
let onFix = () => {};
let wakeLock = null;

async function loadRec() {
  try {
    REC = (await DB.get('rec')) || {};
    LOG = (await DB.get('log')) || [];
  } catch (e) { REC = {}; LOG = []; }
}

let saveTimer = null;
function saveRec() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await DB.set('rec', REC);
      await DB.set('log', LOG);
    } catch (e) { toast('記録を保存できませんでした'); }
  }, 800);
}

function spotSnap(s) {
  return { n: s.n, sh: s.sh, sub: s.sub, x: s.x, y: s.y, p: s.p };
}

// 記録する。返り値は「新しい出来事」（なければ null）
function mark(id, lv, snap, now) {
  const today = ymd(now);
  const r = REC[id];
  let ev = null;
  if (!r) {
    REC[id] = { lv, f: now, l: now, n: 1, d: today, s: snap };
    ev = 'new';
  } else {
    r.s = snap;
    if (lv > r.lv) { r.lv = lv; ev = 'up'; }
    if (r.d !== today) { r.n++; r.d = today; if (!ev) ev = 'again'; }
    r.l = now;
  }
  if (ev) {
    LOG.push({ t: now, id, lv: REC[id].lv, k: ev });
    if (LOG.length > 5000) LOG = LOG.slice(-4000);
    saveRec();
    onRecChanged(id, ev);
    announce(id, ev);
  }
  return ev;
}

function announce(id, ev) {
  const r = REC[id];
  const sh = SHELVES[r.s.sh];
  const lvName = LV_NAME[r.s.sh][r.lv];
  if (ev === 'new') toast(sh.icon + ' はじめて：' + r.s.n + (lvName && r.s.sh !== 'mi' && r.s.sh !== 'mu' && r.s.sh !== 'hi' ? '（' + lvName + '）' : ''), 4000);
  else if (ev === 'up') toast(sh.icon + ' ' + r.s.n + '：' + lvName + 'になりました', 3500);
  else if (ev === 'again') toast(sh.icon + ' また来ました：' + r.s.n, 3000);
}

function stayAdd(id, now) {
  const st = stay[id] || (stay[id] = { ms: 0, t: now });
  const dt = Math.min(now - st.t, 60000);   // 間があいた分は最大1分まで数える
  if (dt > 0) st.ms += dt;
  st.t = now;
  return st.ms / 1000;
}

// 1回の位置ごとの判定
function judge(x, y, acc, spd, now) {
  if (acc > RULE.maxAcc) return;
  const inside = new Set();
  for (const [s, d] of spotsNear(x, y, 250)) {
    if (s.sh === 'st') {
      if (d > RULE.st) continue;
      inside.add(s.id);
      if (spd != null && spd >= RULE.stPassSpeed) mark(s.id, 1, spotSnap(s), now);
      else if (spd == null || spd <= RULE.stSlowSpeed) {
        if (stayAdd(s.id, now) >= RULE.stStay) mark(s.id, 2, spotSnap(s), now);
      } else if (stay[s.id]) stay[s.id].t = now;   // 中くらいの速さの間は数えない
    } else if (s.sh === 'mi') {
      if (d <= RULE.mi) mark(s.id, 2, spotSnap(s), now);
    } else if (s.sh === 'mu') {
      if (d > RULE.mu) continue;
      inside.add(s.id);
      if (stayAdd(s.id, now) >= RULE.muStay) mark(s.id, 2, spotSnap(s), now);
    } else if (s.sh === 'hi') {
      const r = s.sub === '古墳' ? RULE.kofun : RULE.castle;
      if (d <= r) mark(s.id, 2, spotSnap(s), now);
    }
  }
  // 範囲から出たら、とどまった時間は数え直し
  for (const id of Object.keys(stay)) if (!inside.has(id)) delete stay[id];

  // 速さが分からない最初の1回は市区町村を記録しない（電車の中で開いたときに「訪問」にしないため）
  const c = spd == null ? null : cityAt(x, y);
  if (c) {
    const lv = spd != null && spd >= RULE.cityPassSpeed ? 1 : 2;
    mark('c' + c.c, lv, { n: c.n, sh: 'city', sub: '市区町村', x: Math.round(x * 1e3) / 1e3, y: Math.round(y * 1e3) / 1e3, p: c.c.slice(0, 2) }, now);
  }
}

function onPos(p) {
  const x = p.coords.longitude, y = p.coords.latitude, acc = p.coords.accuracy || 9999;
  const now = p.timestamp || Date.now();
  let spd = p.coords.speed;
  if ((spd == null || isNaN(spd)) && lastFix) {
    const dt = (now - lastFix.t) / 1000;
    spd = dt >= 1 ? dist(lastFix.x, lastFix.y, x, y) / dt : (lastFix.spd != null ? lastFix.spd : null);
  }
  if (spd != null && isNaN(spd)) spd = null;
  lastFix = { x, y, acc, t: now, spd };
  if (acc <= 300) {
    const lp = [Math.round(x * 1e3) / 1e3, Math.round(y * 1e3) / 1e3];
    if (!lastPos || lastPos[0] !== lp[0] || lastPos[1] !== lp[1]) { lastPos = lp; setLS('lastpos', lp); }
  }
  onFix(lastFix);
  if (recOn) {
    // いる都県のデータがまだなら読み込む
    const c = cityAt(x, y);
    if (c) needPref(c.c.slice(0, 2));
    judge(x, y, acc, spd, now);
  }
}

function onPosErr(e) {
  const msg = e.code === 1 ? '位置情報が許可されていません（ブラウザの設定で許可してください）'
    : e.code === 3 ? '位置がなかなか分かりません' : '位置が分かりません';
  toast(msg, 4000);
  onFix(null, msg);
}

function startWatch() {
  if (!('geolocation' in navigator)) { toast('この端末では位置情報が使えません'); return; }
  if (watchId != null) return;
  watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
}

function setRecOn(v) {
  recOn = !!v;
  setLS('recon', recOn);
  if (!recOn) for (const id of Object.keys(stay)) delete stay[id];
  updWake();
}

// 画面を消さない（記録中のときだけ）
let wakeOn = getLS('wake', false);
async function updWake() {
  try {
    if (recOn && wakeOn && document.visibilityState === 'visible' && 'wakeLock' in navigator) {
      if (!wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    } else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; }
}
document.addEventListener('visibilitychange', updWake);

// 段階：0=まだ, 1=通過, 2=訪問・降車
function lvOf(id) { const r = REC[id]; return r ? r.lv : 0; }

// ---------- バックアップ ----------
function backupData() {
  return { app: 'MeguMiru', kind: 'all', v: 1, t: Date.now(), rec: REC, log: LOG };
}

function mergeBackup(js) {
  if (!js || js.app !== 'MeguMiru' || !js.rec) throw new Error('MeguMiru の書き出しファイルではありません');
  let add = 0;
  for (const [id, r] of Object.entries(js.rec)) {
    if (!r || !r.s || !r.f) continue;
    const m = REC[id];
    if (!m) { REC[id] = r; add++; continue; }
    m.lv = Math.max(m.lv, r.lv || 0);
    m.f = Math.min(m.f, r.f);
    if (r.l > m.l) { m.l = r.l; m.d = r.d; m.s = r.s; }
    m.n = Math.max(m.n, r.n || 1);
  }
  const seen = new Set(LOG.map(e => e.t + '|' + e.id));
  for (const e of (js.log || [])) if (e && !seen.has(e.t + '|' + e.id)) LOG.push(e);
  LOG.sort((a, b) => a.t - b.t);
  saveRec();
  return add;
}
