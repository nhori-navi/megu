// michi.js：MichiMiru の歩いた記録を、そのまま読んで判定する（MeguMiru 版9。版11：乗った区間の拾い直し segOnly）
// 版16：MichiMiru 版21 から、記録は大きな置き場（IndexedDB 'michimiru' → 'kv' → 'tracks'）に移った。両方を読んで合わせる。
//   保存のたびに localStorage 'walk_trk_rev' に時刻が書かれるので、それで「変わった」と分かる
//   記録に ts（各点の時刻：始まりからの秒）があればそれを使う。ses（歩行の始まり）が歩いている途中の歩行と同じなら終わってから読む
// ・MichiMiru は同じアドレス（nhori-navi.github.io）の端末内の置き場 'walk_tracks' に記録を保存している。それを読むだけで、MichiMiru 側は何も変えない
// ・記録の形：{k:'walk'|'veh', t0:始めた時刻, t1:終えた時刻, pts:[[経度,緯度],…], mode:'train'|'car'（手で直したとき）, src:GPX のファイル名}
//   点ごとの時刻はないので、始めと終わりの時刻を距離で割り振る
// ・歩き：駅のまわり（地下駅は300m）を通ったら「降車」、市区町村は「訪問」
//   乗り物：駅は「通過」、市区町村は「通過」。「車」と直したものは駅を記録しない
//   道の駅・史跡はアプリと同じ距離の決まり。ミュージアムは「散歩の終わりと次の散歩の始まりが同じミュージアムの近くで、間が20分以上」なら訪問
// ・散歩と散歩の間や、乗り物の記録の途切れは、路線で通った駅を推定（地下鉄など）
// ・どこまで読んだか（記録ごとの点の数）を覚えて、増えた分だけ読む。歩いている途中の記録は終わってから読む

let michiOn = getLS('michion', true);
let michiBusy = false;
let michiSig = '';          // 前に読んだときの記録の大きさ（変わっていなければ読み直さない）

const michiKey = t => `${t.t0}|${t.k || 'walk'}|${t.pts[0]}`;

// 変わったかどうかの目印（大きな置き場の保存の時刻＋小さな置き場の大きさと末尾）
function michiSigNow() {
  let rev = '', raw = '';
  try { rev = localStorage.getItem('walk_trk_rev') || ''; raw = localStorage.getItem('walk_tracks') || ''; } catch (e) { /* なし */ }
  return rev + '|' + raw.length + '|' + raw.slice(-64);
}
// 大きな置き場の記録（ないときは空。MeguMiru からは作らない）
function michiReadDb() {
  return new Promise(res => {
    let r;
    try { r = indexedDB.open('michimiru'); } catch (e) { res([]); return; }
    r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) { /* なし */ } };   // まだない：作らずにやめる
    r.onerror = () => res([]);
    r.onblocked = () => res([]);
    r.onsuccess = () => {
      const db = r.result;
      try {
        if (!db.objectStoreNames.contains('kv')) { db.close(); res([]); return; }
        const q = db.transaction('kv', 'readonly').objectStore('kv').get('tracks');
        q.onsuccess = () => { db.close(); res(Array.isArray(q.result) ? q.result : []); };
        q.onerror = () => { db.close(); res([]); };
      } catch (e) { db.close(); res([]); }
    };
  });
}
async function michiRead() {
  let ls = [];
  try {
    const raw = localStorage.getItem('walk_tracks');
    if (raw) { const tr = JSON.parse(raw); if (Array.isArray(tr)) ls = tr; }
  } catch (e) { /* なし */ }
  const db = await michiReadDb();
  // 同じ記録は1つに（点の多い方）
  const map = new Map();
  for (const t of db.concat(ls)) {
    if (!t || !Array.isArray(t.pts) || !t.pts.length) continue;
    const k = michiKey(t), o = map.get(k);
    if (!o || t.pts.length > o.pts.length) map.set(k, t);
  }
  return { tracks: [...map.values()] };
}

function michiOngoing() {
  try {
    const s = JSON.parse(localStorage.getItem('walk_session') || 'null');
    if (s && Date.now() - s.saved <= 30 * 60000) return s.t0;   // 30分以内に保存された＝歩いている途中
  } catch (e) { /* なし */ }
  return null;
}

// 点に時刻を付ける（始めと終わりの時刻を距離で割り振る。終わりの時刻がない古い記録は分速80m）
function michiTimed(t) {
  const pts = t.pts, cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  const total = cum[cum.length - 1];
  const end = (typeof t.t1 === 'number' && t.t1 > t.t0) ? t.t1 : t.t0 + total / (80 / 60) * 1000;
  // 版16：各点の時刻があればそれを使う（止まっていた時間も分かる）
  if (Array.isArray(t.ts) && t.ts.length === pts.length) return pts.map((p, i) => ({ x: p[0], y: p[1], t: t.t0 + t.ts[i] * 1000 }));
  return pts.map((p, i) => ({ x: p[0], y: p[1], t: Math.round(t.t0 + (total > 0 ? (end - t.t0) * cum[i] / total : 0)) }));
}

function michiKind(t) {
  if (t.k !== 'veh') return 'walk';
  return t.mode === 'car' ? 'car' : 'veh';
}

// 1つの点の判定
function michiPoint(kind, p, ctx) {
  const o = { ctx };
  for (const [s, d] of spotsNear(p.x, p.y, Math.max(RULE.stU, RULE.castle))) {
    if (ctx.segOnly && s.sh !== 'st') continue;
    if (s.sh === 'st') {
      if (kind === 'car' || d > (s.u ? RULE.stU : RULE.st)) continue;
      mark(s.id, kind === 'walk' ? 2 : 1, spotSnap(s), p.t, o);
      if (kind === 'veh' && (!o.near || d < o.near[1])) o.near = [s.id, d];   // 版11：乗った区間（乗り物の記録だけ）
    } else if (s.sh === 'mi') {
      // 版11：歩きの記録は「訪問」、乗り物の記録は「通過」
      if (d <= RULE.mi) mark(s.id, kind === 'walk' ? 2 : 1, spotSnap(s), p.t, o);
    } else if (s.sh === 'mu') {
      if (d <= RULE.mu) mark(s.id, 1, spotSnap(s), p.t, o);   // 前を通った（とどまったかは散歩の間で見る）
    } else if (s.sh === 'hi') {
      if (d <= (s.sub === '古墳' ? RULE.kofun : RULE.castle)) mark(s.id, kind === 'walk' ? 2 : 1, spotSnap(s), p.t, o);
    }
  }
  if (o.near) segObserve(o.near[0], p.t, ctx, true);
  if (ctx.segOnly) return;
  const c = cityAt(p.x, p.y);
  if (c) mark('c' + c.c, kind === 'walk' ? 2 : 1, { n: c.n, sh: 'city', sub: '市区町村', x: Math.round(p.x * 1e3) / 1e3, y: Math.round(p.y * 1e3) / 1e3, p: c.c.slice(0, 2) }, p.t, o);
}

// 散歩と散歩の間に、同じミュージアムの近くで20分以上（8時間まで）止まっていたら訪問
function michiMuseumGap(a, b, ctx) {
  const dt = b.t - a.t;
  if (dt < RULE.muStay * 1000 || dt > 8 * 3600000) return;
  const near = new Set(spotsNear(b.x, b.y, RULE.mu).filter(([s]) => s.sh === 'mu').map(([s]) => s.id));
  for (const [s] of spotsNear(a.x, a.y, RULE.mu)) {
    if (s.sh === 'mu' && near.has(s.id)) mark(s.id, 2, spotSnap(s), a.t, { ctx });
  }
}

// opt.segOnly：これまでの記録を全部読み直して、乗った区間だけを拾う（版11を入れたときに1回）
async function michiSync(onStatus, opt) {
  const segOnly = !!(opt && opt.segOnly);
  if (!michiOn || michiBusy) return null;
  const sig = michiSigNow();
  if (!segOnly && sig === michiSig) return null;          // 前に読んだときから変わっていない
  michiBusy = true;
  const res = { tracks: 0, points: 0, count: { new: 0, up: 0, again: 0, est: 0 }, from: null, to: null };
  try {
    const { tracks } = await michiRead();
    const done = (await DB.get('michidone')) || {};
    const ongoing = michiOngoing();
    const list = tracks.filter(t => t && Array.isArray(t.pts) && t.pts.length && Number.isFinite(t.t0)).sort((a, b) => a.t0 - b.t0);
    const unread = segOnly ? list : list.filter(t => (done[michiKey(t)] || 0) < t.pts.length);
    // 歩いている途中の記録（版16：乗り物の区間も、その歩行のもの〔ses〕は）は終わってから読む
    const todo = unread.filter(t => !(ongoing != null && ((t.k !== 'veh' && t.t0 === ongoing) || t.ses === ongoing)));
    const waiting = todo.length < unread.length;           // 歩いている途中の記録がある（終わってから読む）
    if (!todo.length) { if (!waiting && !segOnly) michiSig = sig; return res; }

    // 通った都県のデータと路線を用意する
    const pcs = new Set();
    for (const t of todo) for (let i = 0; i < t.pts.length; i += 20) {
      const p = prefOfPoint(t.pts[i][0], t.pts[i][1]);
      if (p) pcs.add(p);
    }
    await ensurePrefs([...pcs], pc => onStatus && onStatus(`${PREF_NAME[pc]}のデータを読み込んでいます…`));
    if (!LINES.length) await loadLines();

    const ctx = newJudgeCtx({ quiet: true, count: res.count, segOnly });
    const todoSet = new Set(todo);
    let prev = null, prevT = null;
    for (const t of list) {
      const pts = michiTimed(t), kind = michiKind(t);
      if (todoSet.has(t)) {
        const from = segOnly ? 0 : Math.max(0, (done[michiKey(t)] || 0) - 1);
        const step = kind === 'walk' ? 12 : 30;     // 長い記録でも重くならないよう、近すぎる点は飛ばして判定する
        let lastJ = null;
        for (let i = from; i < pts.length; i++) {
          const q = pts[i];
          if (!lastJ || i === pts.length - 1 || dist(lastJ.x, lastJ.y, q.x, q.y) >= step) { michiPoint(kind, q, ctx); lastJ = q; }
          if (i > from && kind !== 'car') inferRide(pts[i - 1], q, ctx);   // 乗り物の記録の途切れ（地下など）
          if (res.points % 3000 === 2999) await new Promise(r => setTimeout(r, 0));
          res.points++;
          if (res.from == null || pts[i].t < res.from) res.from = pts[i].t;
          if (res.to == null || pts[i].t > res.to) res.to = pts[i].t;
        }
        if (!segOnly) done[michiKey(t)] = t.pts.length;
        res.tracks++;
      }
      // 記録と記録の間（どちらかが今回読んだ記録のとき）
      if (prev && (todoSet.has(t) || todoSet.has(prevT))) {
        const a = prev, b = pts[0];
        if (michiKind(prevT) !== 'car' && kind !== 'car') inferRide(a, b, ctx);
        michiMuseumGap(a, b, ctx);
      }
      prev = pts[pts.length - 1]; prevT = t;
      if (res.tracks % 20 === 0) await new Promise(r => setTimeout(r, 0));
    }
    LOG.sort((a, b) => a.t - b.t);
    saveRec();
    if (segOnly) return res;
    // 消えた記録の分は覚えておかない
    const keys = new Set(list.map(michiKey));
    for (const k of Object.keys(done)) if (!keys.has(k)) delete done[k];
    await DB.set('michidone', done);
    setLS('michilast', Date.now());
    setLS('michin', Object.keys(done).length);
    if (!waiting) michiSig = sig;
    return res;
  } finally {
    michiBusy = false;
  }
}
