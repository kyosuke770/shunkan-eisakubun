/*************************************************
 * Storage Keys
 *************************************************/
const STATE_KEY = "state_v1";
const SRS_KEY   = "srs_v1";
const BLOCK_KEY = "block_v1";

/*************************************************
 * Data
 *************************************************/
const phrases = window.phrases || [];

/*************************************************
 * State
 *************************************************/
let state = loadState();     // { order, pos, revealed }
let progress = loadSrs();   // { no: { interval, due } }
let blockProgress = loadBlock();

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
 * Block helpers
 *************************************************/
function getBlockRange(blockIndex) {
  return { start: (blockIndex - 1) * 30 + 1, end: blockIndex * 30 };
}
function blockLabel(blockIndex) {
  const r = getBlockRange(blockIndex);
  return `${r.start}-${r.end}`;
}
function isCleared(no) {
  return !!blockProgress[no];
}
function getCurrentBlockIndex() {
  if (!phrases.length) return 1;

  const nos = phrases.map(p => Number(p.no)).filter(n => !isNaN(n));
  if (!nos.length) return 1;

  const totalBlocks = Math.ceil(Math.max(...nos) / 30);

  for (let b = 1; b <= totalBlocks; b++) {
    const r = getBlockRange(b);
    const inBlock = phrases.filter(p => {
      const no = Number(p.no);
      return no >= r.start && no <= r.end;
    });
    if (inBlock.some(p => !isCleared(p.no))) return b;
  }
  return totalBlocks;
}
function getClearedCount(blockIndex) {
  const r = getBlockRange(blockIndex);
  return phrases.filter(
    p => p.no >= r.start && p.no <= r.end && isCleared(p.no)
  ).length;
}

/*************************************************
 * Home render
 *************************************************/
function renderHome() {
  const b = getCurrentBlockIndex();
  document.getElementById("recommendBlock").textContent = blockLabel(b);
  document.getElementById("recommendCount").textContent = "10";
  document.getElementById("currentBlock").textContent = blockLabel(b);

  const cleared = getClearedCount(b);
  document.getElementById("clearedCount").textContent = cleared;
  document.getElementById("blockProgressBar").style.width =
    `${Math.min(100, (cleared / 30) * 100)}%`;

  document.getElementById("reviewCount").textContent = getDueCount();
  renderPresetChips();
}
function getDueCount() {
  const t = todayDay();
  return phrases.filter(p => progress[p.no] && progress[p.no].due <= t).length;
}

/*************************************************
 * Phrase resolver（JP/ENペアSLOTS）
 *************************************************/
function resolvePhrase(p) {
  if (p.lv === 2 && p.slots) {
    const pairs = p.slots.split("|").map(s => {
      const [jp, en] = s.split("=");
      return { jp, en };
    });
    const choice = pairs[Math.floor(Math.random() * pairs.length)];
    return {
      jpFull: p.jp.replace("{x}", choice.jp),
      enHole: p.en.replace("{x}", "___"),
      enAnswer: p.en.replace("{x}", choice.en)
    };
  }
  return {
    jpFull: p.jp,
    enHole: p.en,
    enAnswer: p.en
  };
}

/*************************************************
 * Start / Order
 *************************************************/
function startOrder(orderIdx) {
  state.order = Array.isArray(orderIdx) ? orderIdx : [];
  state.pos = 0;
  state.revealed = false;
  saveState();

  goPlay();

  if (!state.order.length) {
    document.getElementById("jp").textContent = "出題できる問題がありません";
    document.getElementById("en").textContent = "";
    return;
  }
  render();
}

/*************************************************
 * 今日のおすすめ
 *************************************************/
function startRecommend() {
  if (!phrases.length) return;

  const b = getCurrentBlockIndex();
  const r = getBlockRange(b);

  const pool = phrases
    .map((p, i) => ({ p, i }))
    .filter(x => {
      const no = Number(x.p.no);
      return !isNaN(no) && no >= r.start && no <= r.end;
    });

  const uncleared = pool.filter(x => !isCleared(x.p.no));
  const cleared   = pool.filter(x => isCleared(x.p.no));

  const u1 = uncleared.filter(x => Number(x.p.lv) === 1);
  const u2 = uncleared.filter(x => Number(x.p.lv) === 2);
  const c1 = cleared.filter(x => Number(x.p.lv) === 1);
  const c2 = cleared.filter(x => Number(x.p.lv) === 2);

  let picked = []
    .concat(shuffle(u1).slice(0, 5))
    .concat(shuffle(u2).slice(0, 5));

  if (picked.length < 10) {
    picked = picked.concat(
      shuffle(c1.concat(c2)).slice(0, 10 - picked.length)
    );
  }

  startOrder(shuffle(picked).map(x => x.i));
}

/*************************************************
 * 動画順 / 復習
 *************************************************/
function startLinear() {
  const b = getCurrentBlockIndex();
  const r = getBlockRange(b);
  const inBlock = phrases
    .map((p, i) => ({ p, i }))
    .filter(x => x.p.no >= r.start && x.p.no <= r.end)
    .sort((a, b) => a.p.no - b.p.no);

  const list = inBlock.filter(x => !isCleared(x.p.no));
  startOrder((list.length ? list : inBlock).map(x => x.i));
}
function startReview() {
  const t = todayDay();
  const idx = phrases
    .map((p, i) => ({ p, i }))
    .filter(x => (progress[x.p.no]?.due ?? Infinity) <= t)
    .map(x => x.i);

  if (!idx.length) {
    alert("復習はありません");
    return;
  }
  startOrder(shuffle(idx));
}

/*************************************************
 * Render（表示専用）
 *************************************************/
function render() {
  const jpEl = document.getElementById("jp");
  const enEl = document.getElementById("en");
  const card = document.getElementById("card");

  const idx = state.order[state.pos];
  const raw = phrases[idx];
  const p = resolvePhrase(raw);

  jpEl.textContent = p.jpFull;
  enEl.textContent = state.revealed ? p.enHole : "タップして答え";

  card.dataset.answer = p.enAnswer;
}

/*************************************************
 * SRS grading
 *************************************************/
function grade(key) {
  const idx = state.order[state.pos];
  const p = phrases[idx];
  const now = todayDay();

  let s = progress[p.no] || { interval: 0, due: now };
  if (key === "AGAIN") s.interval = 0;
  if (key === "HARD")  s.interval = 1;
  if (key === "GOOD")  s.interval = Math.max(1, s.interval * 2);
  if (key === "EASY")  s.interval = Math.max(2, s.interval * 3);

  s.due = now + s.interval;
  progress[p.no] = s;
  saveSrs();

  if (key === "GOOD" || key === "EASY") {
    blockProgress[p.no] = true;
    saveBlock();
  }

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
 * Presets
 *************************************************/
function renderPresetChips() {
  const wrap = document.getElementById("presetChips");
  if (!wrap) return;
  wrap.innerHTML = "";

  [
    { name: "今日のおすすめ", action: startRecommend },
    { name: "動画順", action: startLinear },
    { name: "復習", action: startReview }
  ].forEach(d => {
    const el = document.createElement("div");
    el.className = "chip";
    el.textContent = d.name;
    el.onclick = d.action;
    wrap.appendChild(el);
  });
}

/*************************************************
 * DOM Ready（★タップはここで直接制御）
 *************************************************/
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("startRecommend")?.addEventListener("click", startRecommend);
  document.getElementById("continueLinear")?.addEventListener("click", startLinear);
  document.getElementById("startReview")?.addEventListener("click", startReview);
  document.getElementById("goHomeBtn")?.addEventListener("click", goHome);

  document.getElementById("gradeAgain")?.onclick = () => grade("AGAIN");
  document.getElementById("gradeHard")?.onclick  = () => grade("HARD");
  document.getElementById("gradeGood")?.onclick  = () => grade("GOOD");
  document.getElementById("gradeEasy")?.onclick  = () => grade("EASY");

  // ★ iOS対策：タップ時に必ず表示を切り替える
  document.getElementById("card")?.addEventListener("click", () => {
    state.revealed = !state.revealed;
    saveState();

    const enEl = document.getElementById("en");
    if (!state.revealed) {
      enEl.textContent = "タップして答え";
    } else {
      enEl.textContent =
        document.getElementById("card").dataset.answer || "";
    }
  });

  goHome();
});
