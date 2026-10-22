// map.js：地図（MeguMiru 版1）
let map = null;
let mapReady = false;
let follow = true;
let filt = Object.assign({ st: true, city: true, mi: true, mu: true, hi: true }, getLS('filter', {}));
const LOAD_ZOOM = 9;   // これより近づいたら、画面に入った都県のデータを読み込む

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
}

function setupLayers() {
  if (map.getSource('city')) return;
  map.addSource('city', { type: 'geojson', data: cityGeo() });
  map.addSource('spots', { type: 'geojson', data: spotsGeo() });
  map.addSource('me', { type: 'geojson', data: meGeo() });
  map.addLayer({
    id: 'city-fill', type: 'fill', source: 'city', slot: 'middle',
    paint: { 'fill-color': cityColorExpr(), 'fill-emissive-strength': 1 }
  });
  map.addLayer({
    id: 'city-line', type: 'line', source: 'city', slot: 'middle', minzoom: 8,
    paint: { 'line-color': 'rgba(122,92,142,0.45)', 'line-width': 0.7, 'line-emissive-strength': 1 }
  });
  map.addLayer({
    id: 'spots', type: 'circle', source: 'spots', slot: 'top',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, ['match', ['get', 'v'], 0, 2, 3.5], 12, ['match', ['get', 'v'], 0, 4.5, 6.5], 16, ['match', ['get', 'v'], 0, 7, 10]],
      'circle-color': ['match', ['get', 'sh'], 'st', SHELVES.st.color, 'mi', SHELVES.mi.color, 'mu', SHELVES.mu.color, 'hi', SHELVES.hi.color, '#888'],
      'circle-opacity': ['match', ['get', 'v'], 0, 0.32, 1, 0.7, 1],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['match', ['get', 'v'], 0, 0, 1.6],
      'circle-emissive-strength': 1
    }
  });
  map.addLayer({
    id: 'spots-label', type: 'symbol', source: 'spots', slot: 'top', minzoom: 13,
    layout: { 'text-field': ['get', 'n'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
    paint: { 'text-color': '#333', 'text-halo-color': '#fff', 'text-halo-width': 1.2, 'text-opacity': ['match', ['get', 'v'], 0, 0.6, 1] }
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
    feats.push({ type: 'Feature', properties: { id: s.id, sh: s.sh, n: s.n, v: lvOf(s.id) }, geometry: { type: 'Point', coordinates: [s.x, s.y] } });
  }
  // 都県のデータを読み込んでいなくても、行った場所は出す
  for (const [id, r] of Object.entries(REC)) {
    if (seen.has(id) || r.s.sh === 'city') continue;
    feats.push({ type: 'Feature', properties: { id, sh: r.s.sh, n: r.s.n, v: r.lv }, geometry: { type: 'Point', coordinates: [r.s.x, r.s.y] } });
  }
  return { type: 'FeatureCollection', features: feats };
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
  map.setFilter('spots', f);
  map.setFilter('spots-label', f);
  const vis = filt.city ? 'visible' : 'none';
  map.setLayoutProperty('city-fill', 'visibility', vis);
  map.setLayoutProperty('city-line', 'visibility', vis);
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
  const hit = map.queryRenderedFeatures(e.point, { layers: ['spots'] });
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
