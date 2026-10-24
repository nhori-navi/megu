// gpx.js：OpenTracks などの記録（GPX）を読み込んで、その時刻に行ったことにする（MeguMiru 版7）
// ・アプリで記録したときと同じ決まりで判定（駅の通過・降車、ミュージアム20分、市区町村の塗りなど）
// ・止まっている間は点が少ないので、同じ場所で点のあいだが空いていたら、そこにいたと数える（2時間まで）
// ・地下などで途切れた間は、路線から通った駅を推定（B）
// ・同じファイルは二度読まない（最初と最後の時刻と点の数で見分ける）

function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('GPX ファイルとして読めませんでした');
  const segs = [];
  const trksegs = doc.getElementsByTagName('trkseg');
  const lists = trksegs.length ? [...trksegs].map(s => s.getElementsByTagName('trkpt')) : [doc.getElementsByTagName('trkpt')];
  for (const pts of lists) {
    const seg = [];
    for (const p of pts) {
      const y = parseFloat(p.getAttribute('lat')), x = parseFloat(p.getAttribute('lon'));
      const te = p.getElementsByTagName('time')[0];
      const t = te ? Date.parse(te.textContent.trim()) : NaN;
      if (isNaN(x) || isNaN(y) || isNaN(t)) continue;      // 時刻のない点は判定に使えない
      seg.push({ x, y, t });
    }
    seg.sort((a, b) => a.t - b.t);
    if (seg.length) segs.push(seg);
  }
  return segs;
}

let gpxBusy = false;

async function importGpxFiles(files, onStatus) {
  if (gpxBusy) return null;
  gpxBusy = true;
  const res = { files: 0, skipped: 0, bad: 0, points: 0, count: { new: 0, up: 0, again: 0, est: 0 }, from: null, to: null };
  try {
    const done = new Set((await DB.get('gpxdone')) || []);
    // 1. 読む
    const tracks = [];
    for (const f of files) {
      try {
        const segs = parseGpx(await f.text());
        const pts = segs.flat();
        if (!pts.length) { res.bad++; continue; }
        const key = pts[0].t + '-' + pts[pts.length - 1].t + '-' + pts.length;
        if (done.has(key)) { res.skipped++; continue; }
        tracks.push({ segs, key, t0: pts[0].t });
      } catch (e) { res.bad++; }
    }
    tracks.sort((a, b) => a.t0 - b.t0);
    if (!tracks.length) return res;

    // 2. 通った都県のデータと路線を用意する
    const pcs = new Set();
    for (const tr of tracks) for (const seg of tr.segs) for (let i = 0; i < seg.length; i += 20) {
      const p = prefOfPoint(seg[i].x, seg[i].y);
      if (p) pcs.add(p);
    }
    if (onStatus) onStatus('通った都県のデータを用意しています…');
    await ensurePrefs([...pcs], pc => onStatus && onStatus(`${PREF_NAME[pc]}のデータを読み込んでいます…`));
    if (!LINES.length) await loadLines();

    // 3. 判定（知らせは出さず、最後にまとめる）
    for (const tr of tracks) {
      const ctx = newJudgeCtx({ quiet: true, gpx: true, count: res.count });
      let prev = null;
      for (const seg of tr.segs) {
        prev = null;                                    // 区切りの最初は速さが分からない
        for (const p of seg) {
          let spd = null;
          if (prev) { const dt = (p.t - prev.t) / 1000; if (dt >= 1 && dt <= RULE.gapMin) spd = dist(prev.x, prev.y, p.x, p.y) / dt; }   // 長く途切れたあとは速さが分からない
          judge(p.x, p.y, 20, spd, p.t, ctx);
          if (ctx.good) inferRide(ctx.good, p, ctx);    // 区切りをまたいでも推定する（トンネルで区切られることがある）
          ctx.good = { x: p.x, y: p.y, t: p.t };
          prev = p;
          res.points++;
          if (res.from == null || p.t < res.from) res.from = p.t;
          if (res.to == null || p.t > res.to) res.to = p.t;
        }
      }
      done.add(tr.key);
      res.files++;
      if (onStatus) onStatus(`読み込み中…（${res.files}／${tracks.length}）`);
      await new Promise(r => setTimeout(r, 0));
    }
    LOG.sort((a, b) => a.t - b.t);
    saveRec();
    await DB.set('gpxdone', [...done].slice(-2000));
    const n = getLS('gpxcount', 0) + res.files;
    setLS('gpxcount', n);
    return res;
  } finally {
    gpxBusy = false;
  }
}
