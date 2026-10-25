// base.js：共通の定数と道具（MeguMiru 版11）
const APP_VER = 11;

// 5つの棚
const SHELVES = {
  st:   { name: '駅',         icon: '🚉', color: '#3b6fb6' },
  city: { name: '市区町村',   icon: '🗾', color: '#7a5c8e' },
  mi:   { name: '道の駅',     icon: '🛣️', color: '#2f8f5b' },
  mu:   { name: 'ミュージアム', icon: '🏛️', color: '#c0782f' },
  hi:   { name: '史跡',       icon: '🏯', color: '#8b5e3c' },
  ln:   { name: '路線',       icon: '🚃', color: '#c2416b' }      // 版11：路線の乗りつぶし（場所ではなく区間を集める）
};
const SHELF_ORDER = ['st', 'city', 'mi', 'mu', 'hi'];   // 場所の棚
const ZK_ORDER = ['st', 'city', 'mi', 'mu', 'hi', 'ln'];  // 図鑑と地図の切り替えに出す棚

// 対象の10都県（コードは都道府県番号）
const PREFS = [
  ['13', '東京都'], ['14', '神奈川県'], ['11', '埼玉県'], ['12', '千葉県'], ['08', '茨城県'],
  ['09', '栃木県'], ['10', '群馬県'], ['19', '山梨県'], ['20', '長野県'], ['15', '新潟県']
];
const PREF_NAME = Object.fromEntries(PREFS);

// 「訪れた」の判定の距離（m）と時間
const RULE = {
  st: 150,            // 駅のまわり
  stPassSpeed: 5,     // 秒速5m（時速18km）以上で駅のまわりを通ったら「通過」
  stSlowSpeed: 2.5,   // 秒速2.5m（時速9km）以下を「ゆっくり」とみなす
  stStay: 180,        // 駅のまわりに合計3分ゆっくりいたら「降車」
  mi: 100,            // 道の駅
  mu: 100,            // ミュージアム
  muStay: 20 * 60,    // ミュージアムは20分とどまったら
  castle: 200,        // 城跡
  kofun: 80,          // 古墳
  cityPassSpeed: 8,   // 秒速8m（時速約29km）以上で入ったら市区町村は「通過」
  maxAcc: 150,        // 位置の精度がこれより悪いときは判定しない（地下の駅は別）
  // 版7（A）地下の駅：まわり300m、位置の精度300mまで
  stU: 300,
  maxAccU: 300,
  // 版7（B）途切れた間の推定：1分以上・800m以上離れて、時速9〜150kmの動きなら、両端から500m以内の駅を路線で結ぶ
  gapMin: 60, gapDist: 800, gapSpdMin: 2.5, gapSpdMax: 42, gapNear: 500,
  // 版7（C）「いまここ」：最後の位置が10分以内・精度500m以内で、そこから500m以内
  hereMin: 10, hereAcc: 500, hereR: 500,
  // 版9 近づいたら知らせる：400m以内、秒速4m（時速約14km）まで、位置の精度100m以内、同じ場所は12時間に1回
  nearR: 400, nearSpd: 4, nearAcc: 100, nearAgain: 12,
  // 版11 道の駅・ミュージアム・史跡も「通過」：秒速4m（時速約14km）より速いと通過
  walkSpd: 4,
  // 版11 乗った区間：隣り合う駅を15分以内に続けて、平均の速さが秒速5m以上
  segMin: 15
};

// 記録の段階
const LV_NAME = { st: ['', '通過', '降車'], city: ['', '通過', '訪問'], mi: ['', '通過', '訪問'], mu: ['', '通過', '訪問'], hi: ['', '通過', '訪問'] };

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 2点間の距離（m）
function dist(x1, y1, x2, y2) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (y2 - y1) * toR, dLon = (x2 - x1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(y1 * toR) * Math.cos(y2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function pad2(n) { return String(n).padStart(2, '0'); }
function ymd(t) { const d = new Date(t); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function fmtDate(t) { const d = new Date(t); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); }
function fmtTime(t) { const d = new Date(t); return d.getHours() + ':' + pad2(d.getMinutes()); }
function fmtDist(m) { return m < 1000 ? Math.round(m) + 'm' : (m < 10000 ? (m / 1000).toFixed(1) : Math.round(m / 1000)) + 'km'; }

// 小さなお知らせ
let toastTimer = null;
function toast(msg, ms) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms || 2600);
}

// 小さな設定は localStorage（megu_ で始まる名前）
function getLS(k, def) {
  try { const v = localStorage.getItem('megu_' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
}
function setLS(k, v) {
  try { localStorage.setItem('megu_' + k, JSON.stringify(v)); } catch (e) { /* 容量不足などは無視 */ }
}

// 記録や地図データは IndexedDB（データベース megu、入れ物 kv）
const DB = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((ok, ng) => {
      let req;
      try { req = indexedDB.open('megu', 1); } catch (e) { ng(e); return; }
      req.onupgradeneeded = () => { req.result.createObjectStore('kv'); };
      req.onsuccess = () => { this._db = req.result; ok(this._db); };
      req.onerror = () => ng(req.error);
    });
  },
  async get(k) {
    const db = await this.open();
    return new Promise((ok, ng) => {
      const r = db.transaction('kv').objectStore('kv').get(k);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ng(r.error);
    });
  },
  async set(k, v) {
    const db = await this.open();
    return new Promise((ok, ng) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(v, k);
      tx.oncomplete = () => ok();
      tx.onerror = () => ng(tx.error);
    });
  },
  async del(k) {
    const db = await this.open();
    return new Promise((ok, ng) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(k);
      tx.oncomplete = () => ok();
      tx.onerror = () => ng(tx.error);
    });
  }
};

// 日本語のエラー表示
function jaErr(e) {
  const m = String((e && e.message) || e || '');
  if (/timeout|time out|aborted/i.test(m)) return '時間切れでした';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'インターネットにつながりませんでした';
  return m || 'うまくいきませんでした';
}
