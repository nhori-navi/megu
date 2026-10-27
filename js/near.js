// near.js：近づいたら知らせる（MeguMiru 版9。版19：MichiMiru アプリの中で見えていないときは MichiMiru の通知に任せる）
// 歩く速さ（自転車くらいまで）で動いているとき、400m以内のまだ行っていないミュージアム・史跡・道の駅を、地図の下の帯で知らせる
// 駅は数が多くてうるさいので知らせない。同じ場所は12時間に1回まで

let nearOn = getLS('nearon', true);
let nearSeen = getLS('nearseen', {});      // 場所の番号 → 知らせた時刻
let nearTimer = null;
let nearCur = null;

const DIR8 = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
function bearing8(x1, y1, x2, y2) {
  const toR = Math.PI / 180;
  const dx = (x2 - x1) * Math.cos(y1 * toR), dy = y2 - y1;
  const deg = (Math.atan2(dx, dy) / toR + 360) % 360;
  return DIR8[Math.round(deg / 45) % 8];
}

function nearCheck(fix) {
  if (!nearOn || !recOn || !fix || fix.acc > RULE.nearAcc) return;
  // 版19：MichiMiru アプリ（版27〜）の中で、MeguMiru が見えていないときは MichiMiru がスマホの通知で知らせる（ここでは知らせず、「知らせた」の印も付けない）
  try { if (IN_MICHI && typeof window.parent.miruOvCur === 'function' && window.parent.miruOvCur() !== 'megu') return; } catch (e) { /* 古い MichiMiru */ }
  if (fix.spd != null && fix.spd > RULE.nearSpd) return;          // 乗り物では知らせない
  const now = Date.now();
  const cands = spotsNear(fix.x, fix.y, RULE.nearR)
    .filter(([s]) => s.sh !== 'st' && lvOf(s.id) < 2 && !(nearSeen[s.id] && now - nearSeen[s.id] < RULE.nearAgain * 3600000))
    .sort((a, b) => a[1] - b[1]);
  if (!cands.length) return;
  const [s, d] = cands[0];
  nearSeen[s.id] = now;
  // 古い記録は消す
  for (const [k, t] of Object.entries(nearSeen)) if (now - t > RULE.nearAgain * 3600000) delete nearSeen[k];
  setLS('nearseen', nearSeen);
  showNear(s, d, bearing8(fix.x, fix.y, s.x, s.y), cands.length - 1);
}

function showNear(s, d, dir, more) {
  const sh = SHELVES[s.sh];
  nearCur = s.id;
  $('nearBar').style.setProperty('--sc', sh.color);
  $('nearIcon').textContent = sh.icon;
  $('nearText').innerHTML = `<b>${esc(s.n)}</b><small>${esc(s.sub)}・${dir}へ約${fmtDist(Math.round(d / 10) * 10)}${more ? `（ほかに${more}か所）` : ''}</small>`;
  $('nearBar').hidden = false;
  if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) { /* 振動できない端末 */ }
  clearTimeout(nearTimer);
  nearTimer = setTimeout(hideNear, 25000);
}

function hideNear() {
  clearTimeout(nearTimer);
  $('nearBar').hidden = true;
  nearCur = null;
}

function wireNear() {
  $('nearText').onclick = () => { if (nearCur) { const id = nearCur; hideNear(); showSpot(id); } };
  $('nearIcon').onclick = $('nearText').onclick;
  $('nearClose').onclick = hideNear;
}
