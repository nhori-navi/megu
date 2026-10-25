// map.js：地図（MeguMiru 版12：行き先ピン（長押しで立てる・旗の印・5kmの円）。版11：乗った区間を線路の形で。版8.1：まだの所は薄い丸、行った所は塗りつぶしのピン、通過は白抜きのピン、推定の通過は点線の白抜き）
let map = null;
let mapReady = false;
let follow = true;
let filt = Object.assign({ st: true, city: true, mi: true, mu: true, hi: true, ln: true }, getLS('filter', {}));
const LOAD_ZOOM = 9;   // これより近づいたら、画面に入った都県のデータを読み込む

// ピンの絵を描いて地図に登録する
//   pin-棚-in   ：行った（降車・訪問）＝棚の色で塗りつぶし、白い丸に絵柄、影つき
//   pin-棚-pass ：通過＝白抜き（棚の色のふち）、絵柄
//   pin-st-passe：推定の通過＝白抜きでふちが点線
function addPinImages() {
  const R = 2;                       // 細かく描くための倍率
  const W = 34, H = 44;              // 見た目の大きさ（px）
  const kinds = [];
  for (const k of ['st', 'mi', 'mu', 'hi']) kinds.push([k, 'in'], [k, 'pass']);
  kinds.push(['st', 'passe']);
  for (const [k, kind] of kinds) {
    const id = 'pin-' + k + '-' + kind;
    if (map.hasImage && map.hasImage(id)) continue;
    const cv = document.createElement('canvas');
    cv.width = W * R; cv.height = H * R;
    const g = cv.getContext('2d');
    g.scale(R, R);
    const col = SHELVES[k].color;
    const solid = kind === 'in';
    // 版8.1：白抜き（通過）は、ふちの分だけ大きく見えるので、先の位置はそのままで8割の大きさに縮める
    if (!solid) { g.translate(W / 2, H - 3); g.scale(0.8, 0.8); g.translate(-W / 2, -(H - 3)); }
    g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = solid ? 3 : 2; g.shadowOffsetY = 1.2;
    // しずく形
    const cx = W / 2, cy = 15, r = 13;
    g.beginPath();
    g.moveTo(cx, H - 3);
    g.bezierCurveTo(cx - 3, H - 10, cx - r, cy + 9, cx - r, cy);
    g.arc(cx, cy, r, Math.PI, 0);
    g.bezierCurveTo(cx + r, cy + 9, cx + 3, H - 10, cx, H - 3);
    g.closePath();
    g.fillStyle = solid ? col : '#ffffff';
    g.fill();
    g.shadowColor = 'transparent';
    if (solid) { g.lineWidth = 2; g.strokeStyle = '#ffffff'; }
    else { g.lineWidth = 3; g.strokeStyle = col; if (kind === 'passe') g.setLineDash([3.2, 2.4]); }
    g.stroke();
    g.setLineDash([]);
    // 中の白い丸（行った所だけ）と絵柄
    if (solid) { g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill(); }
    g.font = '11px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(SHELVES[k].icon, cx, cy + 0.5);
    map.addImage(id, g.getImageData(0, 0, cv.width, cv.height), { pixelRatio: R });
  }
}

// 版12：行き先ピンの旗
function addPlanImage() {
  if (map.hasImage && map.hasImage('pin-plan')) return;
  const R = 2, W = 30, H = 38;
  const cv = document.createElement('canvas');
  cv.width = W * R; cv.height = H * R;
  const g = cv.getContext('2d');
  g.scale(R, R);
  g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 2; g.shadowOffsetY = 1;
  g.fillStyle = '#4a3b57'; g.fillRect(7, 4, 2.6, H - 6);               // さお
  g.beginPath(); g.moveTo(9.6, 5); g.lineTo(27, 11); g.lineTo(9.6, 18); g.closePath();
  g.fillStyle = '#e0484f'; g.fill();
  g.shadowColor = 'transparent'; g.lineWidth = 1.2; g.strokeStyle = '#ffffff'; g.stroke();
  g.beginPath(); g.arc(8.3, H - 2.5, 2.4, 0, Math.PI * 2); g.fillStyle = '#4a3b57'; g.fill();
  map.addImage('pin-plan', g.getImageData(0, 0, cv.width, cv.height), { pixelRatio: R });
}
let planFocus = null;
function plansGeo() {
  const today = ymd(Date.now());
  return { type: 'FeatureCollection', features: PLANS.map(p => ({ type: 'Feature', properties: { id: p.id, n: p.n, past: p.d && p.d < today ? 1 : 0 }, geometry: { type: 'Point', coordinates: [p.x, p.y] } })) };
}
function circlePoly(x, y, r) {
  const pts = [], kx = 111320 * Math.cos(y * Math.PI / 180), ky = 110540;
  for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2; pts.push([x + r * Math.cos(a) / kx, y + r * Math.sin(a) / ky]); }
  return pts;
}
function planCircleGeo() {
  const p = planFocus && planById(planFocus);
  if (!p) return { type: 'FeatureCollection', features: [] };
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circlePoly(p.x, p.y, PLAN_R)] } }] };
}
function refreshPlans() {
  if (!mapReady) return;
  map.getSource('plans').setData(plansGeo());
  map.getSource('plan-circle').setData(planCircleGeo());
}
function focusPlan(id) {
  planFocus = id;
  refreshPlans();
  const p = planById(id);
  if (p) fitPoints([[p.x, p.y]].concat(circlePoly(p.x, p.y, PLAN_R).filter((_, i) => i % 16 === 0)));
}
// 長押し（スマホ）・右クリック（パソコン）で行き先ピンを立てる
let lpTimer = null, lpAt = null, lpFired = 0;
function wireLongPress() {
  const cancel = () => { clearTimeout(lpTimer); lpTimer = null; };
  map.on('touchstart', e => {
    cancel();
    if (!e.originalEvent || e.originalEvent.touches.length !== 1) return;
    lpAt = e.point;
    const ll = e.lngLat;
    lpTimer = setTimeout(() => { lpTimer = null; lpFired = Date.now(); if (navigator.vibrate) try { navigator.vibrate(30); } catch (er) { /* なし */ } newPlanAt(ll.lng, ll.lat); }, 600);
  });
  map.on('touchmove', e => { if (lpAt && e.point && Math.hypot(e.point.x - lpAt.x, e.point.y - lpAt.y) > 10) cancel(); });
  for (const ev of ['touchend', 'touchcancel', 'dragstart', 'zoomstart', 'pitchstart', 'rotatestart']) map.on(ev, cancel);
  map.on('contextmenu', e => { if (Date.now() - lpFired < 1500) return; cancel(); newPlanAt(e.lngLat.lng, e.lngLat.lat); });
}

function initMap() {
  if (typeof mapboxgl === 'undefined') { $('mapMsg').textContent = '地図を読み込めませんでした（インターネットの接続を確かめてください）'; $('mapMsg').hidden = false; return; }
  if (!/^pk\./.test(MAPBOX_TOKEN)) { $('mapMsg').textContent = 'config.js に Mapbox のトークン（pk. で始まる）を入れてください'; $('mapMsg').hidden = false; return; }
  mapboxgl.accessToken = MAPBOX_TOKEN;
  const center = lastPos || [139.35, 35.85];
  map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/standard',
    center, zoom: lastPos ? 12 : 7,
    language: 'ja',
    config: { basemap: { showPointOfInterestLabels: false } },
    attributionControl: true
  });
  map.on('style.load', setupLayers);
  map.on('moveend', viewChanged);
  map.on('dragstart', () => setFollow(false));
  map.on('click', onMapClick);
  wireLongPress();
}

function setupLayers() {
  if (map.getSource('city')) return;
  map.addSource('city', { type: 'geojson', data: cityGeo() });
  map.addSource('spots', { type: 'geojson', data: spotsGeo() });
  map.addSource('me', { type: 'geojson', data: meGeo() });
  map.addSource('rides', { type: 'geojson', data: ridesGeo() });
  map.addSource('plans', { type: 'geojson', data: plansGeo() });
  map.addSource('plan-circle', { type: 'geojson', data: planCircleGeo() });
  map.addLayer({
    id: 'city-fill', type: 'fill', source: 'city', slot: 'middle',
    paint: { 'fill-color': cityColorExpr(), 'fill-emissive-strength': 1 }
  });
  map.addLayer({
    id: 'city-line', type: 'line', source: 'city', slot: 'middle', minzoom: 8,
    paint: { 'line-color': 'rgba(122,92,142,0.45)', 'line-width': 0.7, 'line-emissive-strength': 1 }
  });
  // 版11：乗った区間（線路の形が取れた所だけ）。推定は点線
  map.addLayer({
    id: 'rides', type: 'line', source: 'rides', slot: 'middle', filter: ['!=', ['get', 'e'], 1],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': SHELVES.ln.color, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.6, 12, 3.5, 16, 6], 'line-opacity': 0.85, 'line-emissive-strength': 1 }
  });
  map.addLayer({
    id: 'rides-est', type: 'line', source: 'rides', slot: 'middle', filter: ['==', ['get', 'e'], 1],
    layout: { 'line-join': 'round' },
    paint: { 'line-color': SHELVES.ln.color, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.4, 12, 3, 16, 5], 'line-opacity': 0.75, 'line-dasharray': [1.5, 1.2], 'line-emissive-strength': 1 }
  });
  addPinImages();
  // まだ行っていない所：薄い小さな丸（どの縮尺でも）
  map.addLayer({
    id: 'spots', type: 'circle', source: 'spots', slot: 'top',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 2, 12, 4, 16, 6],
      'circle-color': ['match', ['get', 'sh'], 'st', SHELVES.st.color, 'mi', SHELVES.mi.color, 'mu', SHELVES.mu.color, 'hi', SHELVES.hi.color, '#888'],
      'circle-opacity': 0.4,
      'circle-emissive-strength': 1
    }
  });
  // まだの所の名前は、かなり近づいたときだけ薄く
  map.addLayer({
    id: 'spots-label', type: 'symbol', source: 'spots', slot: 'top', minzoom: 15,
    layout: { 'text-field': ['get', 'n'], 'text-size': 10.5, 'text-anchor': 'top', 'text-offset': [0, 0.5], 'text-optional': true },
    paint: { 'text-color': '#555', 'text-halo-color': '#fff', 'text-halo-width': 1.2, 'text-opacity': 0.7, 'text-emissive-strength': 1 }
  });
  // 行った所・通過した所：ピン（行った所を手前に）
  map.addLayer({
    id: 'spots-pin', type: 'symbol', source: 'spots', slot: 'top',
    layout: {
      'icon-image': ['concat', 'pin-', ['get', 'sh'], '-', ['case', ['==', ['get', 'v'], 2], 'in', ['==', ['get', 'e'], 1], 'passe', 'pass']],
      'icon-anchor': 'bottom',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.5, 12, 0.8, 16, 1.1],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': ['get', 'v'],
      'symbol-z-order': 'source',
      'text-field': ['step', ['zoom'], '', 13, ['get', 'n']],
      'text-size': 11,
      'text-anchor': 'top',
      'text-offset': [0, 0.2],
      'text-optional': true
    },
    paint: {
      'icon-emissive-strength': 1,
      'text-color': '#333', 'text-halo-color': '#fff', 'text-halo-width': 1.2,
      'text-emissive-strength': 1
    }
  });
  // 版12：行き先ピン（5kmの円と旗）
  addPlanImage();
  map.addLayer({ id: 'plan-circle', type: 'fill', source: 'plan-circle', slot: 'middle', paint: { 'fill-color': '#e0484f', 'fill-opacity': 0.05, 'fill-emissive-strength': 1 } });
  map.addLayer({ id: 'plan-circle-line', type: 'line', source: 'plan-circle', slot: 'middle', paint: { 'line-color': '#e0484f', 'line-width': 1.6, 'line-dasharray': [2, 1.5], 'line-opacity': 0.7, 'line-emissive-strength': 1 } });
  map.addLayer({
    id: 'plans', type: 'symbol', source: 'plans', slot: 'top',
    layout: {
      'icon-image': 'pin-plan', 'icon-anchor': 'bottom-left', 'icon-offset': [-8, 0], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.7, 13, 1],
      'text-field': ['step', ['zoom'], '', 10, ['get', 'n']], 'text-size': 11.5, 'text-anchor': 'top-left', 'text-offset': [0.3, 0.2], 'text-optional': true
    },
    paint: { 'icon-opacity': ['case', ['==', ['get', 'past'], 1], 0.55, 1], 'icon-emissive-strength': 1, 'text-color': '#4a3b57', 'text-halo-color': '#fff', 'text-halo-width': 1.4, 'text-emissive-strength': 1 }
  });
  map.addLayer({
    id: 'me', type: 'circle', source: 'me', slot: 'top',
    paint: { 'circle-radius': 7, 'circle-color': '#2d7ff9', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5, 'circle-emissive-strength': 1 }
  });
  mapReady = true;
  applyFilter();
  viewChanged();
}

function spotsGeo() {
  const feats = [];
  const seen = new Set();
  for (const s of SPOTS.values()) {
    seen.add(s.id);
    const r = REC[s.id];
    feats.push({ type: 'Feature', properties: { id: s.id, sh: s.sh, n: s.n, v: lvOf(s.id), e: r && r.e ? 1 : 0 }, geometry: { type: 'Point', coordinates: [s.x, s.y] } });
  }
  // 都県のデータを読み込んでいなくても、行った場所は出す
  for (const [id, r] of Object.entries(REC)) {
    if (seen.has(id) || r.s.sh === 'city') continue;
    feats.push({ type: 'Feature', properties: { id, sh: r.s.sh, n: r.s.n, v: r.lv, e: r.e ? 1 : 0 }, geometry: { type: 'Point', coordinates: [r.s.x, r.s.y] } });
  }
  return { type: 'FeatureCollection', features: feats };
}

function ridesGeo() {
  const feats = [];
  for (const [k, r] of Object.entries(SEG)) {
    const c = railCoords(k);
    if (c) feats.push({ type: 'Feature', properties: { k, e: r.e ? 1 : 0 }, geometry: { type: 'LineString', coordinates: c } });
  }
  return { type: 'FeatureCollection', features: feats };
}
function refreshRides() {
  if (!mapReady) return;
  map.getSource('rides').setData(ridesGeo());
}
// 点がみんな入るように地図を動かす
function fitPoints(pts) {
  if (!mapReady || !pts.length) return;
  setFollow(false);
  let w = 180, s = 90, e = -180, n = -90;
  for (const [x, y] of pts) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  map.fitBounds([[w, s], [e, n]], { padding: 50, maxZoom: 14, duration: 900 });
}

function meGeo() {
  if (!lastFix) return { type: 'FeatureCollection', features: [] };
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lastFix.x, lastFix.y] } }] };
}

function cityColorExpr() {
  const v1 = [], v2 = [];
  for (const [id, r] of Object.entries(REC)) {
    if (r.s.sh !== 'city') continue;
    (r.lv >= 2 ? v2 : v1).push(id.slice(1));
  }
  const e = ['match', ['get', 'c']];
  if (v2.length) e.push(v2, 'rgba(122,92,142,0.38)');
  if (v1.length) e.push(v1, 'rgba(122,92,142,0.16)');
  if (e.length === 2) return 'rgba(0,0,0,0)';
  e.push('rgba(0,0,0,0)');
  return e;
}

function refreshSpots() {
  if (!mapReady) return;
  map.getSource('spots').setData(spotsGeo());
}
function refreshCity() {
  if (!mapReady) return;
  map.setPaintProperty('city-fill', 'fill-color', cityColorExpr());
}

function applyFilter() {
  setLS('filter', filt);
  document.querySelectorAll('#chips .chip').forEach(b => b.classList.toggle('on', !!filt[b.dataset.sh]));
  if (!mapReady) return;
  const on = ['st', 'mi', 'mu', 'hi'].filter(k => filt[k]);
  const f = ['in', ['get', 'sh'], ['literal', on]];
  const yet = ['==', ['get', 'v'], 0];
  map.setFilter('spots', ['all', f, yet]);
  map.setFilter('spots-label', ['all', f, yet]);
  map.setFilter('spots-pin', ['all', f, ['>', ['get', 'v'], 0]]);
  const vis = filt.city ? 'visible' : 'none';
  map.setLayoutProperty('city-fill', 'visibility', vis);
  map.setLayoutProperty('city-line', 'visibility', vis);
  const lv = filt.ln ? 'visible' : 'none';
  map.setLayoutProperty('rides', 'visibility', lv);
  map.setLayoutProperty('rides-est', 'visibility', lv);
}

function setFollow(v) {
  follow = v;
  $('mFollow').classList.toggle('on', follow);
}

function updMe(fix) {
  if (!mapReady || !fix) return;
  map.getSource('me').setData(meGeo());
  if (follow) map.easeTo({ center: [fix.x, fix.y], duration: 600 });
}

let firstFixDone = false;
function mapOnFix(fix) {
  if (!fix) return;
  updMe(fix);
  if (!firstFixDone && mapReady) {
    firstFixDone = true;
    if (map.getZoom() < 12) map.jumpTo({ center: [fix.x, fix.y], zoom: 13 });
  }
}

function viewChanged() {
  if (!mapReady) return;
  const z = map.getZoom();
  $('zoomHint').hidden = !(z < LOAD_ZOOM && SPOTS.size === 0);
  if (z < LOAD_ZOOM) return;
  const b = map.getBounds();
  for (const pc of prefsInBounds(b.getWest(), b.getSouth(), b.getEast(), b.getNorth())) needPref(pc);
}

function onMapClick(e) {
  // ピンは押しやすいように、押した所のまわり少し広めに探す
  const pad = 12;
  const box = [[e.point.x - pad, e.point.y - pad * 2], [e.point.x + pad, e.point.y + pad / 2]];
  const pf = (map.queryRenderedFeatures(box, { layers: ['plans'] }) || []).find(f => f.properties && planById(f.properties.id));
  if (pf) { const id = pf.properties.id; planFocus = id; refreshPlans(); showPlan(id); return; }
  const hit = map.queryRenderedFeatures(box, { layers: ['spots', 'spots-pin'] })
    .sort((a, b) => (b.properties.v || 0) - (a.properties.v || 0));
  if (hit && hit.length) { showSpot(hit[0].properties.id); return; }
  if (!filt.city) return;
  const c = cityAt(e.lngLat.lng, e.lngLat.lat);
  if (c) showSpot('c' + c.c);
}

function flyToSpot(x, y) {
  if (!mapReady) return;
  setFollow(false);
  map.flyTo({ center: [x, y], zoom: Math.max(map.getZoom(), 14), duration: 900 });
}
