// help.js：はじめての紹介（MeguMiru 版1）
const INTRO = [
  { icon: '🗺', title: '出かけるだけで集まる', text: 'アプリを開いたまま出かけると、通った駅・入った市区町村・道の駅・ミュージアム・城跡や古墳が自動で記録されます。' },
  { icon: '✨', title: '「ここにこんなのがあったんだ」', text: 'まだ行っていない場所は地図に薄く出ています。行った場所ははっきりした色になり、市区町村は塗られていきます。' },
  { icon: '📖', title: '図鑑と今日の記録', text: '「今日」でその日に見つけたもの、「図鑑」で棚ごとの一覧が見られます。記録はこのスマホの中だけに保存されます。ときどき設定から書き出してください。' }
];
let introPage = 0;

function showIntro(force) {
  if (!force && getLS('introDone', false)) return;
  introPage = 0;
  drawIntro();
  $('intro').hidden = false;
}

function drawIntro() {
  const p = INTRO[introPage];
  $('introBody').innerHTML = `<div class="introIcon">${p.icon}</div><h3>${p.title}</h3><p>${p.text}</p>`
    + `<div class="dots">${INTRO.map((_, i) => `<span class="${i === introPage ? 'on' : ''}"></span>`).join('')}</div>`;
  $('introNext').textContent = introPage < INTRO.length - 1 ? '次へ' : 'はじめる';
}

function wireIntro() {
  $('introNext').onclick = () => {
    if (introPage < INTRO.length - 1) { introPage++; drawIntro(); return; }
    $('intro').hidden = true;
    setLS('introDone', true);
  };
  $('introSkip').onclick = () => { $('intro').hidden = true; setLS('introDone', true); };
}
