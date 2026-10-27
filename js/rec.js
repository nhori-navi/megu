// rec.js：位置の記録と「訪れた」の判定（MeguMiru 版11：道の駅・ミュージアム・史跡も「通過」、乗った区間。版17：アプリの中では MichiMiru の位置をもらう。版18：MichiMiru の控えから読み込む）
// 版7：地下の駅は判定をゆるめる（A）／位置が途切れた間に通った駅を路線から推定する（B）／「いまここ」で記録（C）／GPX の読み込みにも使う

let REC = {};      // 場所の番号 → {lv, f, l, n, d, ds, s, e, h}
                   //   lv=段階, f=初めて, l=最後, n=行った日数, d=最後の日, ds=行った日の一覧（yyyymmdd）, s=場所の控え
                   //   e=1 推定（路線から）, h=1 「いまここ」で記録
let LOG = [];      // [{t, id, lv, k}]  k: new=初めて / up=段階が上がった / again=別の日にまた
let SEG = {};      // 版11：乗った区間「駅の番号|駅の番号」（番号の小さい方が先）→ {f:初めて, l:最後, e:1 推定}
let onSegChanged = () => {};
let recOn = getLS('recon', true);
let watchId = null;
let lastFix = null;          // {x, y, acc, t, spd}
let lastPos = getLS('lastpos', null);  // [経度, 緯度]
let onRecChanged = () => {};
let onFix = () => {};
let wakeLock = null;

// 判定の途中の状態（アプリで記録しているときの分。GPX の読み込みは別に作る）
function newJudgeCtx(opt) {
  return Object.assign({ stay: {}, good: null, quiet: false, gpx: false, lastSt: null, segOnly: false, count: { new: 0, up: 0, again: 0, est: 0, seg: 0 } }, opt || {});
}
const liveCtx = newJudgeCtx();

async function loadRec() {
  try {
    REC = (await DB.get('rec')) || {};
    LOG = (await DB.get('log')) || [];
    SEG = (await DB.get('seg')) || {};
  } catch (e) { REC = {}; LOG = []; SEG = {}; }
}

let saveTimer = null;
function saveRec() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await DB.set('rec', REC);
      await DB.set('log', LOG);
      await DB.set('seg', SEG);
    } catch (e) { toast('記録を保存できませんでした'); }
  }, 800);
}

function spotSnap(s) {
  return { n: s.n, sh: s.sh, sub: s.sub, x: s.x, y: s.y, p: s.p };
}

const dayNum = t => +ymd(t).replace(/-/g, '');

// 記録する。返り値は「新しい出来事」（なければ null）
// opt：est＝路線から推定、here＝「いまここ」、ctx＝判定の状態（quiet なら知らせない）
function mark(id, lv, snap, now, opt) {
  opt = opt || {};
  const ctx = opt.ctx || liveCtx;
  if (ctx.segOnly) return null;                  // 乗った区間だけを拾い直しているとき
  const day = dayNum(now);
  const r = REC[id];
  let ev = null;
  if (!r) {
    REC[id] = { lv, f: now, l: now, n: 1, d: ymd(now), ds: [day], s: snap };
    if (opt.est) REC[id].e = 1;
    if (opt.here) REC[id].h = 1;
    ev = 'new';
  } else {
    if (opt.est) return null;                    // 推定は、まだ記録のない所だけ
    if (!r.ds) r.ds = r.d ? [dayNum(new Date(r.d + 'T12:00:00').getTime())] : [];
    r.s = snap;
    if (lv > r.lv || (lv === r.lv && r.e)) { r.lv = Math.max(lv, r.lv); ev = 'up'; }
    if (r.e) delete r.e;                         // 本当に通ったら推定ではなくなる
    if (opt.here) r.h = 1;
    if (!r.ds.includes(day)) {
      r.ds.push(day);
      if (r.ds.length > 400) r.ds = r.ds.slice(-400);
      r.n = Math.max(r.n + 1, r.ds.length);
      if (!ev) ev = 'again';
    }
    if (now < r.f) r.f = now;                    // 前の日の記録（GPX）を読み込んだとき
    if (now >= r.l) { r.l = now; r.d = ymd(now); }
  }
  if (ev) {
    LOG.push({ t: now, id, lv: REC[id].lv, k: ev });
    if (LOG.length > 5000) LOG = LOG.slice(-4000);
    if (ctx.count) { ctx.count[ev]++; if (opt.est && ev === 'new') ctx.count.est++; }
    saveRec();
    if (!ctx.quiet) {
      onRecChanged(id, ev);
      announce(id, ev);
    }
  }
  return ev;
}

function announce(id, ev) {
  const r = REC[id];
  const sh = SHELVES[r.s.sh];
  const lvName = LV_NAME[r.s.sh][r.lv] + (r.e ? '・推定' : '');
  if (ev === 'new') toast(sh.icon + ' はじめて：' + r.s.n + (lvName && (r.s.sh !== 'mi' && r.s.sh !== 'mu' && r.s.sh !== 'hi' || r.lv === 1) ? '（' + lvName + '）' : ''), 4000);
  else if (ev === 'up') toast(sh.icon + ' ' + r.s.n + '：' + lvName + 'になりました', 3500);
  else if (ev === 'again') toast(sh.icon + ' また来ました：' + r.s.n, 3000);
}

// とどまった時間を足す。アプリでは間があいても1分まで、GPX は止まっている間に点が少ないので2時間まで数える
function stayAdd(ctx, id, now) {
  const st = ctx.stay[id] || (ctx.stay[id] = { ms: 0, t: now });
  const cap = ctx.gpx ? 2 * 3600000 : 60000;
  const dt = Math.min(now - st.t, cap);
  if (dt > 0) st.ms += dt;
  st.t = now;
  return st.ms / 1000;
}

const slowOf = spd => spd != null && spd <= RULE.walkSpd;

// ---------- 版11：乗った区間 ----------
function segRide(k, t, est, ctx) {
  const r = SEG[k];
  if (!r) {
    SEG[k] = { f: t, l: t };
    if (est) SEG[k].e = 1;
    if (ctx && ctx.count) ctx.count.seg = (ctx.count.seg || 0) + 1;
  } else {
    if (est && !r.e) { if (t < r.f) r.f = t; return; }
    if (!est && r.e) delete r.e;               // 本当に通ったら推定ではなくなる
    if (t < r.f) r.f = t;
    if (t > r.l) r.l = t;
  }
  saveRec();
  if (!ctx || !ctx.quiet) onSegChanged(k);
}
// いちばん近い駅のまわりにいたことを伝える。前の駅から15分以内に次の駅へ、その間の速さが乗り物なら、区間を「乗った」にする
//   速さ：前の駅を最後に見てからの位置の速さのいちばん大きいもの（速さが分からなければ駅と駅の距離÷時間）
//   ride：MichiMiru の記録のように、乗り物かどうかが分かっているとき（true＝乗り物）
//   同じ駅のまわりで止まっているか歩いている間は、速さを数え直す（電車で着いて、歩いて隣の駅へ行ったときに数えないため）
function segObserve(id, t, ctx, ride, spd) {
  if (!LINE_EDGE.size || !LINE_ST[id]) return;
  const last = ctx.lastSt, vmax = ctx.segMax;
  const keep = spd != null && spd > RULE.walkSpd ? spd : null;
  ctx.lastSt = { id, t };
  if (last && last.id === id) { if (keep == null) ctx.segMax = null; return; }
  ctx.segMax = keep;
  if (!last) return;
  const dt = (t - last.t) / 1000;
  if (dt <= 0 || dt > RULE.segMin * 60) return;
  const a = LINE_ST[last.id], b = LINE_ST[id];
  const fast = ride != null ? ride : vmax != null ? vmax >= RULE.stPassSpeed : dist(a[1], a[2], b[1], b[2]) / dt >= RULE.stPassSpeed;
  if (!fast) return;                              // 歩いて隣の駅へ、などは数えない
  const k = ekey(last.id, id);
  if (LINE_EDGE.has(k)) { segRide(k, t, false, ctx); return; }
  // 隣ではない（途中の駅で位置が取れなかった）：路線で結べれば、その間は推定
  const p = linePath(last.id, id);
  if (p && p.length <= 8) segPath(p, last.t, t, ctx);
}
function segPath(p, t0, t1, ctx) {
  for (let i = 1; i < p.length; i++) {
    const k = ekey(p[i - 1], p[i]);
    if (LINE_EDGE.has(k)) segRide(k, Math.round(t0 + (t1 - t0) * i / (p.length - 1)), true, ctx);
  }
}
function segCount() { return Object.keys(SEG).length; }

// 1回の位置ごとの判定
function judge(x, y, acc, spd, now, ctx) {
  ctx = ctx || liveCtx;
  if (acc > RULE.maxAccU) return;
  const roughOnly = acc > RULE.maxAcc;     // 位置が粗いときは地下の駅だけ見る（A）
  const inside = new Set();
  if (spd != null) ctx.segMax = Math.max(ctx.segMax || 0, spd);
  let nearSt = null, nearD = Infinity;
  for (const [s, d] of spotsNear(x, y, Math.max(RULE.stU, 250))) {
    if (roughOnly && !(s.sh === 'st' && s.u)) continue;
    const o = { ctx };
    if (s.sh === 'st') {
      if (d > (s.u ? RULE.stU : RULE.st)) continue;
      inside.add(s.id);
      if (d < nearD) { nearD = d; nearSt = s.id; }
      if (spd != null && spd >= RULE.stPassSpeed) mark(s.id, 1, spotSnap(s), now, o);
      else if (spd == null || spd <= RULE.stSlowSpeed) {
        if (stayAdd(ctx, s.id, now) >= RULE.stStay) mark(s.id, 2, spotSnap(s), now, o);
      } else if (ctx.stay[s.id]) ctx.stay[s.id].t = now;   // 中くらいの速さの間は数えない
    } else if (s.sh === 'mi') {
      // 版11：乗り物の速さ（速さが分からないときも）は「通過」、止まっているか歩く速さなら「訪問」
      if (d <= RULE.mi) mark(s.id, slowOf(spd) ? 2 : 1, spotSnap(s), now, o);
    } else if (s.sh === 'mu') {
      if (d > RULE.mu) continue;
      mark(s.id, 1, spotSnap(s), now, o);           // 前を通っただけでも「通過」
      if (spd != null && spd > RULE.walkSpd) continue;   // 乗り物の速さの間は数えない（速さが分からない間は数える：GPX で止まっている間は点が少ない）
      inside.add(s.id);
      if (stayAdd(ctx, s.id, now) >= RULE.muStay) mark(s.id, 2, spotSnap(s), now, o);
    } else if (s.sh === 'hi') {
      const r = s.sub === '古墳' ? RULE.kofun : RULE.castle;
      if (d <= r) mark(s.id, slowOf(spd) ? 2 : 1, spotSnap(s), now, o);
    }
  }
  if (nearSt) segObserve(nearSt, now, ctx, undefined, spd);       // 版11：乗った区間
  // 範囲から出たら、とどまった時間は数え直し
  for (const id of Object.keys(ctx.stay)) if (!inside.has(id)) delete ctx.stay[id];
  if (roughOnly) return;

  // 速さが分からない最初の1回は市区町村を記録しない（電車の中で開いたときに「訪問」にしないため）
  const c = spd == null ? null : cityAt(x, y);
  if (c) {
    const lv = spd >= RULE.cityPassSpeed ? 1 : 2;
    mark('c' + c.c, lv, { n: c.n, sh: 'city', sub: '市区町村', x: Math.round(x * 1e3) / 1e3, y: Math.round(y * 1e3) / 1e3, p: c.c.slice(0, 2) }, now, { ctx });
  }
}

// （B）位置が途切れて離れた所で戻ったら、乗った駅と降りた駅のあいだの駅を「通過（推定）」にする
function inferRide(a, b, ctx) {
  if (!LINES.length) return;
  const dt = (b.t - a.t) / 1000;
  if (dt < RULE.gapMin || dt > 3 * 3600) return;
  const d = dist(a.x, a.y, b.x, b.y);
  if (d < RULE.gapDist) return;
  const v = d / dt;
  if (v < RULE.gapSpdMin || v > RULE.gapSpdMax) return;
  const As = lineStationsNear(a.x, a.y, RULE.gapNear).slice(0, 3);
  const Bs = lineStationsNear(b.x, b.y, RULE.gapNear).slice(0, 3);
  // 両端にいちばん近い駅の組から順に試す（乗った駅・降りた駅を落とさないように）
  const pairs = [];
  for (const [A, dA] of As) for (const [B, dB] of Bs) pairs.push([A, B, dA + dB]);
  pairs.sort((p, q) => p[2] - q[2]);
  let best = null;
  for (const [A, B] of pairs) { best = linePath(A, B); if (best) break; }
  if (!best || best.length > 40) return;
  best.forEach((id, i) => {
    const v = LINE_ST[id];
    if (!v) return;
    const t = Math.round(a.t + (b.t - a.t) * (best.length > 1 ? i / (best.length - 1) : 0));
    mark(id, 1, { n: v[0], sh: 'st', sub: '駅', x: v[1], y: v[2], p: v[3] }, t, { est: true, ctx });
  });
  segPath(best, a.t, b.t, ctx);                   // 版11：その間の区間も推定で
  ctx.lastSt = { id: best[best.length - 1], t: b.t };
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
  if (recOn) {
    // いる都県のデータがまだなら読み込む
    const c = cityAt(x, y);
    if (c) needPref(c.c.slice(0, 2));
    judge(x, y, acc, spd, now, liveCtx);
    if (acc <= RULE.maxAccU) {
      if (liveCtx.good) inferRide(liveCtx.good, lastFix, liveCtx);
      liveCtx.good = lastFix;
    }
  }
  onFix(lastFix);
}

function onPosErr(e) {
  const msg = e.code === 1 ? '位置情報が許可されていません（ブラウザの設定で許可してください）'
    : e.code === 3 ? '位置がなかなか分かりません' : '位置が分かりません';
  toast(msg, 4000);
  onFix(null, msg);
}

function startWatch() {
  if (watchId != null) return;
  // 版17：MichiMiru アプリ（版23〜）の中では、自分で GPS を見張らず、MichiMiru が受け取った位置をもらう。
  // GPS を二重に使わないので電池が減りにくく、MichiMiru が画面を消している間に受け取った位置も届く
  if (IN_MICHI) { try { if (typeof window.parent.miruPosOn === 'function') { window.parent.miruPosOn(onPos); watchId = 'michi'; return; } } catch (e) { /* 古い MichiMiru */ } }
  if (!('geolocation' in navigator)) { toast('この端末では位置情報が使えません'); return; }
  watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
}

function setRecOn(v) {
  recOn = !!v;
  setLS('recon', recOn);
  if (!recOn) { for (const id of Object.keys(liveCtx.stay)) delete liveCtx.stay[id]; liveCtx.good = null; }
  updWake();
}

// （C）「いまここ」：最後の位置（10分以内・精度500m以内）から500m以内で、まだ「降車・訪問」になっていない場所
function hereCandidates() {
  if (!recOn || !lastFix || lastFix.acc > RULE.hereAcc || Date.now() - lastFix.t > RULE.hereMin * 60000) return [];
  return spotsNear(lastFix.x, lastFix.y, RULE.hereR)
    .filter(([s]) => lvOf(s.id) < 2 || (REC[s.id] && REC[s.id].e))
    .sort((a, b) => a[1] - b[1])
    .slice(0, 8);
}
function markHere(id) {
  const s = SPOTS.get(id);
  if (!s || !hereCandidates().some(([c]) => c.id === id)) { toast('いまはこの場所の近くにいないようです'); return false; }
  mark(id, 2, spotSnap(s), Date.now(), { here: true });
  return true;
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

// 版11：記録を消す（まちがって付いた記録のため。手で付け足すことはできない）
function deleteRec(id) {
  if (!REC[id]) return false;
  delete REC[id];
  LOG = LOG.filter(e => e.id !== id);
  saveRec();
  onRecChanged(id, 'del');
  return true;
}

// ---------- 版18：MichiMiru の「4つのアプリの控え」から読み込んだ分 ----------
// MichiMiru（版24〜）が控えを読み込むと、MeguMiru の分を入れ物 megu／kv の 'pending_import' に置く。
// MeguMiru は開いたとき（と、MichiMiru から頼まれたとき）に、いつもの読み込み（足し合わせ）で入れて消す
async function meguPending() {
  let p = null;
  try { p = await DB.get('pending_import'); } catch (e) { return 0; }
  if (!p) return 0;
  let add = 0;
  try {
    add = mergeBackup(p);
    if (typeof afterRecChanged === 'function') afterRecChanged();
    toast(`MichiMiru の控えから読み込みました（新しく ${add}か所）`, 4500);
  } catch (e) { toast('控えを読み込めませんでした：' + jaErr(e), 4500); }
  try { await DB.set('pending_import', null); } catch (e) { /* なし */ }
  return add;
}
window.meguPending = meguPending;

// ---------- バックアップ ----------
function backupData() {
  return { app: 'MeguMiru', kind: 'all', v: 1, t: Date.now(), rec: REC, log: LOG, seg: SEG, plans: typeof PLANS !== 'undefined' ? PLANS : [] };
}

function mergeBackup(js) {
  if (!js || js.app !== 'MeguMiru' || !js.rec) throw new Error('MeguMiru の書き出しファイルではありません');
  let add = 0;
  for (const [id, r] of Object.entries(js.rec)) {
    if (!r || !r.s || !r.f) continue;
    const m = REC[id];
    if (!m) { REC[id] = r; add++; continue; }
    if ((r.lv || 0) > m.lv || (!r.e && m.e && (r.lv || 0) >= m.lv)) { m.lv = Math.max(m.lv, r.lv || 0); if (!r.e) delete m.e; }
    m.f = Math.min(m.f, r.f);
    if (r.l > m.l) { m.l = r.l; m.d = r.d; m.s = r.s; }
    if (r.ds || m.ds) {
      const ds = [...new Set([...(m.ds || []), ...(r.ds || [])])].sort();
      m.ds = ds.slice(-400);
    }
    m.n = Math.max(m.n, r.n || 1, m.ds ? m.ds.length : 0);
    if (r.h) m.h = 1;
  }
  const seen = new Set(LOG.map(e => e.t + '|' + e.id));
  for (const e of (js.log || [])) if (e && !seen.has(e.t + '|' + e.id)) LOG.push(e);
  if (js.plans && typeof mergePlans === 'function') mergePlans(js.plans);   // 版12：行き先ピン
  for (const [k, r] of Object.entries(js.seg || {})) {
    if (!r || !r.f) continue;
    const m = SEG[k];
    if (!m) { SEG[k] = r; continue; }
    m.f = Math.min(m.f, r.f); m.l = Math.max(m.l, r.l || r.f);
    if (!r.e) delete m.e;
  }
  LOG.sort((a, b) => a.t - b.t);
  saveRec();
  return add;
}
