/*************************************************
 * Storage Keys
 *************************************************/
const STATE_KEY = "state_v1";
const SRS_KEY = "srs_v1";
const BLOCK_KEY = "block_v1"; // cleared判定（簡易：no=>true）

/*************************************************
 * Data
 *************************************************/
const phrases = window.phrases || [];

/*************************************************
 * State
 *************************************************/
let state = loadState();     // {order,pos,revealed}
let progress = loadSrs();    // { no: {interval,due} }
let blockProgress = loadBlock(); // { no: true }

/*************************************************
 * Utils
 *************************************************/
function todayDay() {
  return Math.floor(Date.now() / 86400000);
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/*************************************************
 * Load / Save
 *************************************************/
function loadState() {
  return JSON.parse(localStorage.getItem(STATE_KEY)) || {
    order: [],
    pos: 0,
    revealed: false
  };
}
function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function loadSrs() {
  return JSON.parse(localStorage.getItem(SRS_KEY)) || {};
}
function saveSrs() {
  localStorage.setItem(SRS_KEY, JSON.stringify(progress));
}

function loadBlock() {
  return JSON.parse(localStorage.getItem(BLOCK_KEY)) || {};
}
function saveBlock() {
  localStorage.setItem(BLOCK_KEY, JSON.stringify(blockProgress));
}

/*************************************************
 * Navigation
 *************************************************/
function goHome() {
  document.getElementById("play").style.display = "none";
  document.getElementById("home").style.display = "block";
  renderHome();
}
function goPlay() {
  document.getElementById("home").style.display = "none";
  document.getElementById("play").style.display = "block";
}

/*************************************************
 * Block helpers (30問単位)
 *************************************************/
function getBlockIndex(no) {
  return Math.floor((no - 1) / 30) + 1;
}
function getBlockRange(blockIndex) {
  const start = (blockIndex - 1) * 30 + 1;
  const end = blockIndex * 30;
  return { start, end };
}
function blockLabelFromBlockIndex(blockIndex) {
  const { start, end } = getBlockRange(blockIndex);
  return `${start}-${end}`;
}
function isCleared(no) {
  return !!blockProgress[no];
}

// 「続きから」用：最初の未完ブロックを探す
function getCurrentBlockIndex() {
  if (!phrases.length) return 1;
  const maxNo = Math.max(...phrases.map(p => p.no));
  const totalBlocks = Math.ceil(maxNo / 30);

  for (let b = 1; b <= totalBlocks; b++) {
    const { start, end } = getBlockRange(b);
    const inBlock = phrases.filter(p => p.no >= start && p.no <= end);
    if (inBlock.length === 0) continue;

    const uncleared = inBlock.some(p => !isCleared(p.no));
    if (uncleared) return b; // 未クリアが残ってるブロック
  }
  // 全部終わってたら最後のブロック
  return totalBlocks;
}

function getClearedCountInBlock(blockIndex) {
  const { start, end } = getBlockRange(blockIndex);
  let n = 0;
  for (const p of phrases) {
    if (p.no >= start && p.no <= end && isCleared(p.no)) n++;
  }
  return n;
}

/*************************************************
 * Home render
 *************************************************/
function renderHome() {
  const currentBlock = getCurrentBlockIndex();
  const label = blockLabelFromBlockIndex(currentBlock);

  // おすすめ
  document.getElementById("recommendBlock").textContent = label;
  document.getElementById("recommendCount").textContent = "10";

  // 動画順
  document.getElementById("currentBlock").textContent = label;
  const cleared = getClearedCountInBlock(currentBlock);
  document.getElementById("clearedCount").textContent = String(cleared);
  document.getElementById("blockProgressBar").style.width =
    `${Math.max(0, Math.min(100, (cleared / 30) * 100))}%`;

  // 復習
  const due = getDueCount();
  document.getElementById("reviewCount").textContent = String(due);

  // プリセット（今は最小：例を表示）
  renderPresetChips();
}

function getDueCount() {
  const t = todayDay();
  let c = 0;
  for (const p of phrases) {
    const pr = progress[p.no];
    if (pr && pr.due <= t) c++;
  }
  return c;
}

/*************************************************
 * Start / Order
 *************************************************/
function startOrder(orderIdxList) {
  state.order = orderIdxList;
  state.pos = 0;
  state.revealed = false;
  saveState();
  goPlay();
  render();
}

/*************************************************
 * 今日のおすすめ（強化版）
 * - 現在ブロック
 * - 未クリア優先
 * - Lv1:5 / Lv2:5（足りなければ補完）
 * - 合計10
 *************************************************/
function startRecommend() {
  const blockIndex = getCurrentBlockIndex();
  const { start, end } = getBlockRange(blockIndex);

  const pool = phrases
    .map((p, i) => ({ p, i }))
    .filter(x => x.p.no >= start && x.p.no <= end);

  const uncleared = pool.filter(x => !isCleared(x.p.no));
  const cleared = pool.filter(x => isCleared(x.p.no));

  const uLv1 = uncleared.filter(x => x.p.lv === 1);
  const uLv2 = uncleared.filter(x => x.p.lv === 2);
  const cLv1 = cleared.filter(x => x.p.lv === 1);
  const cLv2 = cleared.filter(x => x.p.lv === 2);

  const targetLv1 = 5;
  const targetLv2 = 5;

  let picked = [];
  picked = picked
    .concat(shuffle(uLv1).slice(0, targetLv1))
    .concat(shuffle(uLv2).slice(0, targetLv2));

  // 未クリアだけで10に満たない場合：クリア済みから補完
  if (picked.length < 10) {
    const rest = 10 - picked.length;
    picked = picked.concat(shuffle(cLv1.concat(cLv2)).slice(0, rest));
  }

  // それでも足りない場合（lvが偏ってる/データ少ない）
  if (picked.length < 10) {
    const rest = 10 - picked.length;
    const already = new Set(picked.map(x => x.i));
    const fallback = shuffle(pool.filter(x => !already.has(x.i))).slice(0, rest);
    picked = picked.concat(fallback);
  }

  // 最終的に10問（順序はランダム）
  const order = shuffle(picked).slice(0, 10).map(x => x.i);
  startOrder(order);
}

/*************************************************
 * 動画順（続きから）
 * - 現在ブロック
 * - 未クリアのみを NO順（なければブロック全体）
 *************************************************/
function startLinear() {
  const blockIndex = getCurrentBlockIndex();
  const { start, end } = getBlockRange(blockIndex);

  const inBlock = phrases
    .map((p, i) => ({ p, i }))
    .filter(x => x.p.no >= start && x.p.no <= end)
    .sort((a, b) => a.p.no - b.p.no);

  const uncleared = inBlock.filter(x => !isCleared(x.p.no));
  const order = (uncleared.length ? uncleared : inBlock).map(x => x.i);

  startOrder(order);
}

/*************************************************
 * 復習
 *************************************************/
function startReview() {
  const t = todayDay();
  const idx = phrases
    .map((p, i) => ({ p, i }))
    .filter(x => (progress[x.p.no]?.due ?? 999999999) <= t)
    .map(x => x.i);

  if (!idx.length) {
    alert("復習はありません");
    return;
  }
  startOrder(shuffle(idx));
}

/*************************************************
 * Card render / flip
 *************************************************/
function render() {
  if (!state.order.length) {
    document.getElementById("jp").textContent = "";
    document.getElementById("en").textContent = "データがありません";
    return;
  }
  const idx = state.order[state.pos];
  const p = phrases[idx];

  document.getElementById("jp").textContent = p.jp;
  document.getElementById("en").textContent = state.revealed ? p.en : "タップして答え";
}

// カードタップで裏返す（重要）
document.getElementById("card")?.addEventListener("click", () => {
  state.revealed = !state.revealed;
  saveState();
  render();
});

/*************************************************
 * SRS grading
 *************************************************/
function grade(gradeKey) {
  const idx = state.order[state.pos];
  const p = phrases[idx];
  const now = todayDay();

  let s = progress[p.no] || { interval: 0, due: now };

  if (gradeKey === "AGAIN") s.interval = 0;
  if (gradeKey === "HARD") s.interval = 1;
  if (gradeKey === "GOOD") s.interval = Math.max(1, (s.interval || 0) * 2);
  if (gradeKey === "EASY") s.interval = Math.max(2, (s.interval || 0) * 3);

  s.due = now + s.interval;
  progress[p.no] = s;
  saveSrs();

  // クリア扱い（進捗）
  if (gradeKey === "GOOD" || gradeKey === "EASY") {
    blockProgress[p.no] = true;
    saveBlock();
  }

  // 次へ
  state.pos++;
  state.revealed = false;
  saveState();

  if (state.pos >= state.order.length) {
    goHome();
  } else {
    render();
  }
}

/*************************************************
 * Presets (最小：チップだけ)
 * ※管理・保存は後で追加可能
 *************************************************/
function renderPresetChips() {
  const wrap = document.getElementById("presetChips");
  if (!wrap) return;
  wrap.innerHTML = "";

  const defs = [
    { name: "全部（おすすめ）", action: startRecommend },
    { name: "動画順（続き）", action: startLinear },
    { name: "復習", action: startReview }
  ];

  for (const d of defs) {
    const el = document.createElement("div");
    el.className = "chip";
    el.textContent = d.name;
    el.addEventListener("click", d.action);
    wrap.appendChild(el);
  }
}

/*************************************************
 * Events wiring
 *************************************************/
document.getElementById("startRecommend")?.addEventListener("click", startRecommend);
document.getElementById("continueLinear")?.addEventListener("click", startLinear);
document.getElementById("startReview")?.addEventListener("click", startReview);

document.getElementById("gradeAgain")?.addEventListener("click", () => grade("AGAIN"));
document.getElementById("gradeHard")?.addEventListener("click", () => grade("HARD"));
document.getElementById("gradeGood")?.addEventListener("click", () => grade("GOOD"));
document.getElementById("gradeEasy")?.addEventListener("click", () => grade("EASY"));

/*************************************************
 * Init
 *************************************************/
(function init() {
  if (!phrases.length) {
    alert("phrases が空です（CSV読み込み or window.phrases を設定してね）");
  }
  goHome();
})();
