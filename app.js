/**
 * 瞬間英作文 PWA (CSV取込 + SRS + 英語TTS + 3秒タイマー)
 * - データは端末内(localStorage)保存
 * - JP→EN / EN→JP 切替
 * - SRS: ON のとき「今日(due<=today)」だけ出す
 * - Again/Good/Easy で復習日を更新
 * - 英語音声: 答え表示時に自動読み上げ（JP→ENのみ）
 * - 3秒タイマー: 0で自動で答え表示（JP→ENのみ読み上げ）
 *
 * 必要なHTML要素ID（存在しなくても落ちないように ?.- で防御してる）：
 * frontText, backText, hintText, indexBadge,
 * modeBtn, shuffleBtn, flipBtn, nextBtn, prevBtn,
 * favBtn, onlyFavBtn, resetBtn,
 * srsToggleBtn,
 * againBtn, goodBtn, easyBtn,
 * timerText, timerToggleBtn,
 * ttsBtn,
 * csvArea, toggleCsvBtn, csvHeader, csvInput, importBtn, exportBtn, importMsg
 */

const APP_STORAGE_KEY = "shunkan_app_state_v4";
const DATA_STORAGE_KEY = "shunkan_phrases_v4";
const PROG_STORAGE_KEY = "shunkan_progress_v4";

/* ----------------- JSON storage helpers ----------------- */
function loadJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/* ----------------- misc helpers ----------------- */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ----------------- date helper (LOCAL day) ----------------- */
function todayDay() {
  const now = new Date();
  const localMs = now.getTime() - now.getTimezoneOffset() * 60000;
  return Math.floor(localMs / 86400000);
}

/* ----------------- CSV helpers ----------------- */
function splitCSVLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      result.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }
  result.push(cur);
  return result;
}

function parseCSV(text) {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const first = lines[0].toLowerCase();
  const hasHeader = first.includes("jp") && first.includes("en");
  const start = hasHeader ? 1 : 0;

  const out = [];
  for (let i = start; i < lines.length; i++) {
    const row = splitCSVLine(lines[i]);
    if (row.length < 2) continue;
    const jp = row[0].trim();
    const en = row[1].trim();
    if (!jp || !en) continue;
    out.push({ jp, en });
  }
  return out;
}

function toCSV(rows) {
  const escape = (s) => {
    const needs = /[",\n]/.test(s);
    const v = s.replace(/"/g, '""');
    return needs ? `"${v}"` : v;
  };
  const lines = ["JP,EN"];
  for (const r of rows) {
    lines.push(`${escape(r.jp)},${escape(r.en)}`);
  }
  return lines.join("\n");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ----------------- Phrase ID (stable) ----------------- */
function phraseId(p) {
  return `${p.jp}||${p.en}`;
}

/* ----------------- Default data ----------------- */
const defaultPhrases = [
  { jp: "私は今忙しい。", en: "I'm busy right now." },
  { jp: "それは後でやる。", en: "I'll do it later." },
  { jp: "ちょっと待って。", en: "Hold on a second." },
  { jp: "もう一回言って。", en: "Say that again." },
  { jp: "それで大丈夫。", en: "That's fine." },
];

let phrases = loadJSON(DATA_STORAGE_KEY) || defaultPhrases;

/**
 * progress: { [id]: { interval:number, due:number } }
 * - interval: 日数（0以上）
 * - due: dayInt（todayDay基準）
 */
let progress = loadJSON(PROG_STORAGE_KEY) || {};

function ensureProgressForAll() {
  const t = todayDay();
  for (const p of phrases) {
    const id = phraseId(p);
    if (!progress[id]) {
      progress[id] = { interval: 0, due: t }; // 初期：今日出す
    }
  }
  // もう存在しない文の進捗を削除
  const valid = new Set(phrases.map(phraseId));
  for (const k of Object.keys(progress)) {
    if (!valid.has(k)) delete progress[k];
  }
  saveJSON(PROG_STORAGE_KEY, progress);
}
ensureProgressForAll();

/* ----------------- State ----------------- */
const defaultState = {
  mode: "JP_EN", // or EN_JP
  order: [], // indices
  pos: 0,
  revealed: false,
  favOnly: false,
  favorites: {}, // id: true
  srsOn: true,
  timerOn: true,
};

const state = Object.assign({}, defaultState, loadJSON(APP_STORAGE_KEY) || {});

function saveState() {
  saveJSON(APP_STORAGE_KEY, state);
}
function savePhrases() {
  saveJSON(DATA_STORAGE_KEY, phrases);
}
function saveProgress() {
  saveJSON(PROG_STORAGE_KEY, progress);
}

/* ----------------- Order / visibility ----------------- */
function rebuildOrder() {
  state.order = phrases.map((_, i) => i);
  if (state.pos >= state.order.length) state.pos = 0;
}

function getVisibleIndices() {
  let indices = state.order.slice();

  // fav filter (ID base)
  if (state.favOnly) {
    indices = indices.filter((i) => !!state.favorites[phraseId(phrases[i])]);
  }

  // SRS filter
  if (state.srsOn) {
    const t = todayDay();
    indices = indices.filter((i) => {
      const id = phraseId(phrases[i]);
      const pr = progress[id];
      return pr && pr.due <= t;
    });
  }

  return indices;
}

function currentIndex() {
  const visible = getVisibleIndices();
  if (visible.length === 0) return null;
  if (state.pos >= visible.length) state.pos = 0;
  return visible[state.pos];
}

// Againを押したカードを、全体順(order)の末尾へ（セッション内で再登場させる）
function moveCurrentToEnd() {
  const idx = currentIndex();
  if (idx === null) return;
  const where = state.order.indexOf(idx);
  if (where >= 0) {
    state.order.splice(where, 1);
    state.order.push(idx);
  }
}

/* ----------------- TTS (English) ----------------- */
function speakEnglish(text) {
  if (!("speechSynthesis" in window)) return;

  // iOS/Safariは連続で呼ぶと詰まることがあるので一旦cancel
  window.speechSynthesis.cancel();

  const uttr = new SpeechSynthesisUtterance(text);
  uttr.lang = "en-US"; // "en-GB" でもOK
  uttr.rate = 1.0; // 0.8〜1.1
  uttr.pitch = 1.0;
  uttr.volume = 1.0;

  window.speechSynthesis.speak(uttr);
}

/* ----------------- 3-sec Timer ----------------- */
let timerId = null;
let timerCount = 3;

function stopTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  const timerEl = document.getElementById("timerText");
  if (timerEl) timerEl.textContent = "";
}

function startTimer() {
  stopTimer();
  if (!state.timerOn) return;

  // すでに答え表示なら不要
  if (state.revealed) return;

  timerCount = 3;
  const timerEl = document.getElementById("timerText");
  if (timerEl) timerEl.textContent = `⏱ ${timerCount}`;

  timerId = setInterval(() => {
    timerCount--;
    if (timerEl) timerEl.textContent = timerCount > 0 ? `⏱ ${timerCount}` : "";

    if (timerCount <= 0) {
      stopTimer();

      // 自動で答え表示
      if (!state.revealed) {
        state.revealed = true;
        render();

        // JP→EN のときだけ英語読み上げ
        const idx = currentIndex();
        if (idx !== null && state.mode === "JP_EN") {
          speakEnglish(phrases[idx].en);
        }
      }
    }
  }, 1000);
}

/* ----------------- Render ----------------- */
function render() {
  if (!Array.isArray(state.order) || state.order.length !== phrases.length) {
    rebuildOrder();
  }

  const frontEl = document.getElementById("frontText");
  const backEl = document.getElementById("backText");
  const hintEl = document.getElementById("hintText");
  const badgeEl = document.getElementById("indexBadge");

  const modeBtn = document.getElementById("modeBtn");
  const flipBtn = document.getElementById("flipBtn");
  const favBtn = document.getElementById("favBtn");
  const onlyFavBtn = document.getElementById("onlyFavBtn");
  const srsToggleBtn = document.getElementById("srsToggleBtn");
  const timerToggleBtn = document.getElementById("timerToggleBtn");

  const visible = getVisibleIndices();
  if (badgeEl) badgeEl.textContent = visible.length ? `${state.pos + 1} / ${visible.length}` : `0 / 0`;

  if (modeBtn) modeBtn.textContent = state.mode === "JP_EN" ? "JP→EN" : "EN→JP";
  if (onlyFavBtn) onlyFavBtn.textContent = `お気に入りのみ: ${state.favOnly ? "ON" : "OFF"}`;
  if (srsToggleBtn) srsToggleBtn.textContent = `SRS: ${state.srsOn ? "ON" : "OFF"}`;
  if (timerToggleBtn) timerToggleBtn.textContent = `⏱ 3秒: ${state.timerOn ? "ON" : "OFF"}`;

  const idx = currentIndex();

  if (idx === null) {
    // 何も出ないとき
    const t = todayDay();
    const anyDue = phrases.some((p) => (progress[phraseId(p)]?.due ?? t) <= t);

    if (frontEl && backEl && hintEl) {
      if (state.srsOn && !anyDue) {
        frontEl.textContent = "今日の復習は完了！";
        backEl.textContent = "SRSをOFFにすると全件から練習できます。";
        hintEl.textContent = "SRS: OFF にして練習するのもアリ";
      } else {
        frontEl.textContent = "表示できるカードがありません。";
        backEl.textContent = "フィルタ（お気に入り / SRS）を確認してね。";
        hintEl.textContent = "SRSやお気に入りを切り替えてみて";
      }
      backEl.classList.remove("hidden");
    }

    if (flipBtn) flipBtn.disabled = true;
    if (favBtn) favBtn.disabled = true;

    stopTimer();
    saveState();
    return;
  }

  const item = phrases[idx];
  const id = phraseId(item);

  const frontText = state.mode === "JP_EN" ? item.jp : item.en;
  const backText = state.mode === "JP_EN" ? item.en : item.jp;

  if (frontEl) frontEl.textContent = frontText;
  if (backEl) backEl.textContent = backText;

  if (favBtn) {
    const isFav = !!state.favorites[id];
    favBtn.textContent = isFav ? "★ お気に入り" : "☆ お気に入り";
    favBtn.disabled = false;
  }
  if (flipBtn) flipBtn.disabled = false;

  if (state.revealed) {
    if (backEl) backEl.classList.remove("hidden");
    if (hintEl) hintEl.textContent = "もう一度タップで隠す";
    if (flipBtn) flipBtn.textContent = "隠す";
    stopTimer();
  } else {
    if (backEl) backEl.classList.add("hidden");
    if (hintEl) hintEl.textContent = "タップで答え";
    if (flipBtn) flipBtn.textContent = "答え";
    startTimer();
  }

  saveState();
}

/* ----------------- Actions ----------------- */
function flip() {
  stopTimer();
  state.revealed = !state.revealed;
  render();

  // 表示されたら英語を自動再生（JP→ENのみ）
  if (state.revealed && state.mode === "JP_EN") {
    const idx = currentIndex();
    if (idx !== null) {
      speakEnglish(phrases[idx].en);
    }
  }
}

function next() {
  stopTimer();
  state.revealed = false;
  const visible = getVisibleIndices();
  if (visible.length === 0) return render();
  state.pos = (state.pos + 1) % visible.length;
  render();
}

function prev() {
  stopTimer();
  state.revealed = false;
  const visible = getVisibleIndices();
  if (visible.length === 0) return render();
  state.pos = (state.pos - 1 + visible.length) % visible.length;
  render();
}

function toggleMode() {
  stopTimer();
  state.revealed = false;
  state.mode = state.mode === "JP_EN" ? "EN_JP" : "JP_EN";
  render();
}

function doShuffle() {
  stopTimer();
  state.revealed = false;
  shuffleArray(state.order);
  state.pos = 0;
  render();
}

function toggleFavorite() {
  const idx = currentIndex();
  if (idx === null) return;
  const id = phraseId(phrases[idx]);
  if (state.favorites[id]) delete state.favorites[id];
  else state.favorites[id] = true;
  render();
}

function toggleFavOnly() {
  stopTimer();
  state.revealed = false;
  state.favOnly = !state.favOnly;
  state.pos = 0;
  render();
}

function toggleSrs() {
  stopTimer();
  state.revealed = false;
  state.srsOn = !state.srsOn;
  state.pos = 0;
  render();
}

function toggleTimer() {
  state.timerOn = !state.timerOn;

  const btn = document.getElementById("timerToggleBtn");
  if (btn) {
    btn.textContent = `⏱ 3秒: ${state.timerOn ? "ON" : "OFF"}`;
  }

  stopTimer();
  render();
}

function resetAll() {
  localStorage.removeItem(APP_STORAGE_KEY);
  localStorage.removeItem(DATA_STORAGE_KEY);
  localStorage.removeItem(PROG_STORAGE_KEY);

  phrases = defaultPhrases.slice();
  progress = {};
  ensureProgressForAll();

  Object.assign(state, JSON.parse(JSON.stringify(defaultState)));
  rebuildOrder();
  render();
}

/* ----------------- SRS grading -----------------
 * Again: due=today, interval=0, and move to end so it reappears this session
 * Good:  interval = (0 ? 1 : interval*2), due=today+interval
 * Easy:  interval = (0 ? 3 : interval*3), due=today+interval
 */
function grade(gradeType) {
  const idx = currentIndex();
  if (idx === null) return;

  const p = phrases[idx];
  const id = phraseId(p);
  const t = todayDay();
  const pr = progress[id] || { interval: 0, due: t };

  if (gradeType === "AGAIN") {
    pr.interval = 0;
    pr.due = t;
    progress[id] = pr;
    saveProgress();

    state.revealed = false;

    // セッション内で再登場
    moveCurrentToEnd();
    next();
    return;
  }

  if (gradeType === "GOOD") {
    pr.interval = pr.interval <= 0 ? 1 : Math.min(365, pr.interval * 2);
    pr.due = t + pr.interval;
  }

  if (gradeType === "EASY") {
    pr.interval = pr.interval <= 0 ? 3 : Math.min(365, pr.interval * 3);
    pr.due = t + pr.interval;
  }

  progress[id] = pr;
  saveProgress();

  state.revealed = false;
  next();
}

/* ----------------- CSV UI ----------------- */
const csvArea = document.getElementById("csvArea");
const toggleCsvBtn = document.getElementById("toggleCsvBtn");
const csvHeader = document.getElementById("csvHeader");
const csvInput = document.getElementById("csvInput");
const importBtn = document.getElementById("importBtn");
const exportBtn = document.getElementById("exportBtn");
const importMsg = document.getElementById("importMsg");

// ボタンで開閉（index.htmlに toggleCsvBtn がある場合）
toggleCsvBtn?.addEventListener("click", () => {
  if (!csvArea) return;
  const isHidden = csvArea.classList.contains("hidden");
  csvArea.classList.toggle("hidden", !isHidden);
  toggleCsvBtn.textContent = isHidden ? "閉じる" : "開く";
});

// ヘッダー押したら開閉（csvHeaderを採用してる場合）
csvHeader?.addEventListener("click", () => {
  if (!csvArea) return;
  csvArea.classList.toggle("hidden");
});

importBtn?.addEventListener("click", () => {
  const text = (csvInput?.value || "").trim();
  const rows = parseCSV(text);

  if (rows.length === 0) {
    if (importMsg) importMsg.textContent = "取り込み失敗：JP,EN の2列があるCSVを貼ってね。";
    return;
  }

  // 進捗引き継ぎ（同一JP||ENなら残す）
  const oldProgress = progress;

  phrases = rows;

  progress = {};
  const t = todayDay();
  for (const p of phrases) {
    const id = phraseId(p);
    progress[id] = oldProgress[id] || { interval: 0, due: t };
  }

  // favorites の整合性
  const valid = new Set(phrases.map(phraseId));
  for (const k of Object.keys(state.favorites)) {
    if (!valid.has(k)) delete state.favorites[k];
  }

  state.favOnly = false;
  state.pos = 0;
  state.revealed = false;

  rebuildOrder();
  savePhrases();
  saveProgress();
  render();

  if (importMsg) importMsg.textContent = `取り込み成功：${phrases.length}件 登録しました。`;
});

exportBtn?.addEventListener("click", () => {
  const csv = toCSV(phrases);
  downloadText("phrases.csv", csv);
  if (importMsg) importMsg.textContent = "エクスポートしました（ダウンロードが始まります）。";
});

/* ----------------- Wire UI buttons ----------------- */
document.getElementById("flipBtn")?.addEventListener("click", flip);
document.getElementById("nextBtn")?.addEventListener("click", next);
document.getElementById("prevBtn")?.addEventListener("click", prev);
document.getElementById("modeBtn")?.addEventListener("click", toggleMode);
document.getElementById("shuffleBtn")?.addEventListener("click", doShuffle);

document.getElementById("favBtn")?.addEventListener("click", toggleFavorite);
document.getElementById("onlyFavBtn")?.addEventListener("click", toggleFavOnly);
document.getElementById("resetBtn")?.addEventListener("click", resetAll);

document.getElementById("srsToggleBtn")?.addEventListener("click", toggleSrs);
document.getElementById("timerToggleBtn")?.addEventListener("click", toggleTimer);

// SRS評価
document.getElementById("againBtn")?.addEventListener("click", () => grade("AGAIN"));
document.getElementById("goodBtn")?.addEventListener("click", () => grade("GOOD"));
document.getElementById("easyBtn")?.addEventListener("click", () => grade("EASY"));

// カードタップで裏返し
document.getElementById("card")?.addEventListener("click", flip);

// 🔊 再生ボタン（JP→ENの時だけ）
document.getElementById("ttsBtn")?.addEventListener("click", () => {
  const idx = currentIndex();
  if (idx === null) return;
  if (state.mode !== "JP_EN") return;
  speakEnglish(phrases[idx].en);
});

// キーボード（PCでも使いやすく）
window.addEventListener("keydown", (e) => {
  if (e.key === " " || e.key === "Enter") flip();
  if (e.key === "ArrowRight") next();
  if (e.key === "ArrowLeft") prev();
  if (e.key.toLowerCase() === "a") grade("AGAIN");
  if (e.key.toLowerCase() === "g") grade("GOOD");
  if (e.key.toLowerCase() === "e") grade("EASY");
});

/* ----------------- Init ----------------- */
rebuildOrder();
render();
