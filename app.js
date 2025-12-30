/**
 * app.js v8（見やすさ改善 ①②③ + CSV4列）
 * CSV: JP,EN,SLOTS,NOTE
 * - SLOTS: en:jp|en:jp|...（保険で en|en|... もOK -> jp=en）
 * - Lv1: slotsがあっても先頭固定
 * - Lv2: slotsがあればランダム（カード切替ごとに選び直し）
 * - Timer: 3s -> 5s -> OFF -> 3s...
 * - SRS: Again/Hard/Good/Easy（時間表示は無し）
 * - 裏面：答えを太字、候補/NOTEは折りたたみ（details）
 * - SRSボタンは答え表示のときだけ出す
 * - カードはmax-heightで伸びすぎない
 */

const APP_STORAGE_KEY = "shunkan_app_state_v8";
const DATA_STORAGE_KEY = "shunkan_phrases_v8";
const PROG_STORAGE_KEY = "shunkan_progress_v8";

/* -------- storage helpers -------- */
function loadJSON(key){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch{ return null; }
}
function saveJSON(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

/* -------- misc -------- */
function shuffleArray(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* -------- time helper (LOCAL day float) -------- */
function todayDay(){
  const now = new Date();
  const localMs = now.getTime() - now.getTimezoneOffset() * 60000;
  return localMs / 86400000;
}

/* -------- safe HTML (because we use innerHTML) -------- */
function escapeHTML(str){
  return (str ?? "").toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}
function nl2brSafe(str){
  return escapeHTML(str).replace(/\n/g, "<br>");
}

/* -------- CSV helpers -------- */
function splitCSVLine(line){
  const result = [];
  let cur = "";
  let inQuotes = false;

  for(let i=0;i<line.length;i++){
    const ch = line[i];

    if(ch === '"'){
      if(inQuotes && line[i+1] === '"'){
        cur += '"';
        i++;
      }else{
        inQuotes = !inQuotes;
      }
      continue;
    }

    if(ch === "," && !inQuotes){
      result.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  result.push(cur);
  return result;
}

function parseSlots(slotsRaw){
  const raw = (slotsRaw || "").trim();
  if(!raw) return [];

  const parts = raw.split("|").map(s => s.trim()).filter(Boolean);
  const out = [];

  for(const p of parts){
    const idx = p.indexOf(":");
    if(idx === -1){
      const v = p.trim();
      if(!v) continue;
      out.push({ en: v, jp: v }); // 保険
      continue;
    }
    const en = p.slice(0, idx).trim();
    const jp = p.slice(idx+1).trim();
    if(!en || !jp) continue;
    out.push({ en, jp });
  }
  return out;
}

function parseCSV(text){
  const lines = text
    .replace(/\r\n/g,"\n")
    .replace(/\r/g,"\n")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if(lines.length === 0) return [];

  const first = lines[0].toLowerCase();
  const hasHeader = first.includes("jp") && first.includes("en");
  const start = hasHeader ? 1 : 0;

  const out = [];
  for(let i=start;i<lines.length;i++){
    const row = splitCSVLine(lines[i]);
    if(row.length < 2) continue;

    const jp = (row[0] || "").trim();
    const en = (row[1] || "").trim();
    if(!jp || !en) continue;

    const slotsRaw = (row[2] || "").trim();
    const note = (row[3] || "").trim();
    const slots = parseSlots(slotsRaw);

    out.push({ jp, en, slotsRaw, slots, note });
  }
  return out;
}

function toCSV(rows){
  const escape = (s) => {
    const needs = /[",\n]/.test(s);
    const v = (s ?? "").toString().replace(/"/g,'""');
    return needs ? `"${v}"` : v;
  };

  const lines = ["JP,EN,SLOTS,NOTE"];
  for(const r of rows){
    lines.push(`${escape(r.jp)},${escape(r.en)},${escape(r.slotsRaw || "")},${escape(r.note || "")}`);
  }
  return lines.join("\n");
}

function downloadText(filename, text){
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

/* -------- stable phrase id -------- */
function phraseId(p){
  // NOTEも含めてIDにする（NOTE変更で別カード扱い）
  return `${p.jp}||${p.en}||${p.slotsRaw || ""}||${p.note || ""}`;
}

/* -------- template fill -------- */
function fillJP(templateJP, slot){
  if(!templateJP) return "";
  if(!templateJP.includes("{x}")) return templateJP;
  if(!slot) return templateJP.replaceAll("{x}", "___");
  return templateJP.replaceAll("{x}", slot.jp);
}
function fillEN(templateEN, slot){
  if(!templateEN) return "";
  if(!templateEN.includes("{x}")) return templateEN;
  if(!slot) return templateEN.replaceAll("{x}", "___");
  return templateEN.replaceAll("{x}", slot.en);
}

/* -------- defaults -------- */
const defaultPhrases = [
  {
    jp: "今{x}。",
    en: "I'm {x} right now.",
    slotsRaw: "busy:忙しい|tired:疲れている|free:暇だ",
    slots: [],
    note: "right now は「まさに今」。状況説明でよく使う。"
  },
  { jp: "それは後でやる。", en: "I'll do it later.", slotsRaw: "", slots: [], note: "" },
  { jp: "ちょっと待って。", en: "Hold on a second.", slotsRaw: "", slots: [], note: "" }
];

let phrases = loadJSON(DATA_STORAGE_KEY) || defaultPhrases;

// slots/note 保証（旧データ互換）
for(const p of phrases){
  if(typeof p.slotsRaw !== "string") p.slotsRaw = "";
  if(!Array.isArray(p.slots) || p.slots.length === 0){
    p.slots = parseSlots(p.slotsRaw);
  }
  if(typeof p.note !== "string") p.note = "";
}

/**
 * progress: { [id]: { interval:number, due:number } }
 * - interval: 日数（小数OK）
 * - due: todayDay基準の dayFloat
 */
let progress = loadJSON(PROG_STORAGE_KEY) || {};

function ensureProgressForAll(){
  const t = todayDay();
  const valid = new Set();

  for(const p of phrases){
    const id = phraseId(p);
    valid.add(id);
    if(!progress[id]){
      progress[id] = { interval: 0, due: t };
    }
  }
  for(const k of Object.keys(progress)){
    if(!valid.has(k)) delete progress[k];
  }
  saveJSON(PROG_STORAGE_KEY, progress);
}
ensureProgressForAll();

/* -------- state -------- */
const defaultState = {
  mode: "JP_EN",            // JP_EN / EN_JP
  level: 1,                 // 1 / 2
  order: [],
  pos: 0,
  revealed: false,
  favOnly: false,
  favorites: {},            // id: true
  srsOn: true,
  timerOn: true,
  timerSeconds: 3,          // 3 or 5
  slotPickIndex: {}         // { [id]: number }
};

const state = Object.assign({}, defaultState, loadJSON(APP_STORAGE_KEY) || {});

function saveState(){ saveJSON(APP_STORAGE_KEY, state); }
function savePhrases(){ saveJSON(DATA_STORAGE_KEY, phrases); }
function saveProgress(){ saveJSON(PROG_STORAGE_KEY, progress); }

function rebuildOrder(){
  state.order = phrases.map((_, i) => i);
  if(state.pos >= state.order.length) state.pos = 0;
}

function getVisibleIndices(){
  let indices = state.order.slice();

  if(state.favOnly){
    indices = indices.filter(i => !!state.favorites[phraseId(phrases[i])]);
  }

  if(state.srsOn){
    const t = todayDay();
    indices = indices.filter(i => (progress[phraseId(phrases[i])] || {due:t}).due <= t);
  }

  return indices;
}

function currentIndex(){
  const visible = getVisibleIndices();
  if(visible.length === 0) return null;
  if(state.pos >= visible.length) state.pos = 0;
  return visible[state.pos];
}

/* -------- slot pick -------- */
function pickSlotForPhrase(p){
  if(!p.slots || p.slots.length === 0) return null;

  const id = phraseId(p);

  if(state.level === 1){
    state.slotPickIndex[id] = 0;
    return p.slots[0];
  }

  const existing = state.slotPickIndex[id];
  if(typeof existing === "number" && p.slots[existing]) return p.slots[existing];

  const idx = Math.floor(Math.random() * p.slots.length);
  state.slotPickIndex[id] = idx;
  return p.slots[idx];
}

function clearSlotPickForCurrent(){
  const idx = currentIndex();
  if(idx === null) return;
  delete state.slotPickIndex[phraseId(phrases[idx])];
}

/* -------- TTS -------- */
function speakEnglish(text){
  if(!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const uttr = new SpeechSynthesisUtterance(text);
  uttr.lang = "en-US";
  uttr.rate = 1.0;
  window.speechSynthesis.speak(uttr);
}

/* -------- timer -------- */
let timerId = null;
let timerCount = 3;

function stopTimer(){
  if(timerId){
    clearInterval(timerId);
    timerId = null;
  }
  const el = document.getElementById("timerText");
  if(el) el.textContent = "";
}

function startTimer(){
  stopTimer();
  if(!state.timerOn) return;
  if(state.revealed) return;

  timerCount = state.timerSeconds;
  const el = document.getElementById("timerText");
  if(el) el.textContent = `⏱ ${timerCount}`;

  timerId = setInterval(() => {
    timerCount--;
    if(el) el.textContent = timerCount > 0 ? `⏱ ${timerCount}` : "";

    if(timerCount <= 0){
      stopTimer();
      if(!state.revealed){
        state.revealed = true;
        render();

        // JP→ENの答え表示時のみ読む
        if(state.mode === "JP_EN"){
          const idx = currentIndex();
          if(idx !== null){
            const p = phrases[idx];
            const slot = pickSlotForPhrase(p);
            speakEnglish(fillEN(p.en, slot));
          }
        }
      }
    }
  }, 1000);
}

/* -------- render -------- */
function render(){
  if(!Array.isArray(state.order) || state.order.length !== phrases.length){
    rebuildOrder();
  }

  const frontEl = document.getElementById("frontText");
  const backEl  = document.getElementById("backText");
  const hintEl  = document.getElementById("hintText");
  const badgeEl = document.getElementById("indexBadge");

  const modeBtn = document.getElementById("modeBtn");
  const flipBtn = document.getElementById("flipBtn");
  const favBtn = document.getElementById("favBtn");
  const onlyFavBtn = document.getElementById("onlyFavBtn");
  const srsToggleBtn = document.getElementById("srsToggleBtn");
  const timerToggleBtn = document.getElementById("timerToggleBtn");
  const levelToggleBtn = document.getElementById("levelToggleBtn");
  const srsArea = document.getElementById("srsArea");

  const visible = getVisibleIndices();
  if(badgeEl) badgeEl.textContent = visible.length ? `${state.pos+1} / ${visible.length}` : `0 / 0`;

  if(modeBtn) modeBtn.textContent = state.mode === "JP_EN" ? "JP→EN" : "EN→JP";
  if(onlyFavBtn) onlyFavBtn.textContent = `お気に入りのみ: ${state.favOnly ? "ON" : "OFF"}`;
  if(srsToggleBtn) srsToggleBtn.textContent = `SRS: ${state.srsOn ? "ON" : "OFF"}`;
  if(timerToggleBtn){
    const label = state.timerOn ? `${state.timerSeconds}s` : "OFF";
    timerToggleBtn.textContent = `⏱ ${label}`;
  }
  if(levelToggleBtn) levelToggleBtn.textContent = `Lv: ${state.level}`;

  // ②：SRSは答え表示のときだけ
  if(srsArea){
    srsArea.classList.toggle("show", state.revealed);
  }

  const idx = currentIndex();
  if(idx === null){
    const t = todayDay();
    const anyDue = phrases.some(p => (progress[phraseId(p)]?.due ?? t) <= t);

    if(frontEl && backEl && hintEl){
      if(state.srsOn && !anyDue){
        frontEl.textContent = "今日の復習は完了！";
        backEl.innerHTML = `<div class="answer">Nice.</div><div class="detailsWrap"><div class="extraBody">SRSをOFFにすると全件練習できます。</div></div>`;
        hintEl.textContent = "SRSを切り替えてみて";
      }else{
        frontEl.textContent = "表示できるカードがありません。";
        backEl.innerHTML = `<div class="answer">No cards.</div><div class="detailsWrap"><div class="extraBody">フィルタ（お気に入り / SRS）を確認してね。</div></div>`;
        hintEl.textContent = "設定を切り替えてみて";
      }
      backEl.classList.remove("hidden");
    }
    if(flipBtn) flipBtn.disabled = true;
    if(favBtn) favBtn.disabled = true;
    stopTimer();
    saveState();
    return;
  }

  const p = phrases[idx];
  // slots/note 保証
  if(typeof p.slotsRaw !== "string") p.slotsRaw = "";
  if(!Array.isArray(p.slots) || p.slots.length === 0){
    p.slots = parseSlots(p.slotsRaw);
  }
  if(typeof p.note !== "string") p.note = "";

  const id = phraseId(p);
  const slot = pickSlotForPhrase(p);

  const jpFilled = fillJP(p.jp, slot);
  const enFilled = fillEN(p.en, slot);

  const frontText = (state.mode === "JP_EN") ? jpFilled : enFilled;
  if(frontEl) frontEl.textContent = frontText;

  // ①：裏は「答え」＋ details（候補/NOTE）
  const answerText = (state.mode === "JP_EN") ? enFilled : jpFilled;

  const hasOptions = (p.slots && p.slots.length > 0);
  const hasNote = !!(p.note && p.note.trim());

  const optionsHTML = hasOptions
    ? `
      <details class="extra">
        <summary>他の候補</summary>
        <div class="extraBody">${escapeHTML(p.slots.map(s => s.en).join(" / "))}</div>
      </details>
    `
    : "";

  const noteHTML = hasNote
    ? `
      <details class="extra">
        <summary>解説・ニュアンス</summary>
        <div class="extraBody">${nl2brSafe(p.note.trim())}</div>
      </details>
    `
    : "";

  const wrapHTML = (hasOptions || hasNote)
    ? `<div class="detailsWrap">${optionsHTML}${noteHTML}</div>`
    : "";

  if(backEl){
    backEl.innerHTML = `<div class="answer">${escapeHTML(answerText)}</div>${wrapHTML}`;
  }

  if(favBtn){
    const isFav = !!state.favorites[id];
    favBtn.textContent = isFav ? "★ お気に入り" : "☆ お気に入り";
    favBtn.disabled = false;
  }
  if(flipBtn) flipBtn.disabled = false;

  if(state.revealed){
    if(backEl) backEl.classList.remove("hidden");
    if(hintEl) hintEl.textContent = "もう一度タップで隠す";
    if(flipBtn) flipBtn.textContent = "隠す";
    stopTimer();
  }else{
    if(backEl) backEl.classList.add("hidden");
    if(hintEl) hintEl.textContent = "タップで答え";
    if(flipBtn) flipBtn.textContent = "答え";
    startTimer();
  }

  saveState();
}

/* -------- actions -------- */
function flip(){
  stopTimer();
  state.revealed = !state.revealed;
  render();

  // JP→ENの答え表示時のみ読む
  if(state.revealed && state.mode === "JP_EN"){
    const idx = currentIndex();
    if(idx !== null){
      const p = phrases[idx];
      const slot = pickSlotForPhrase(p);
      speakEnglish(fillEN(p.en, slot));
    }
  }
}

function next(){
  stopTimer();
  clearSlotPickForCurrent();
  state.revealed = false;

  const visible = getVisibleIndices();
  if(visible.length === 0) return render();

  state.pos = (state.pos + 1) % visible.length;
  render();
}

function prev(){
  stopTimer();
  clearSlotPickForCurrent();
  state.revealed = false;

  const visible = getVisibleIndices();
  if(visible.length === 0) return render();

  state.pos = (state.pos - 1 + visible.length) % visible.length;
  render();
}

function toggleMode(){
  stopTimer();
  state.revealed = false;
  state.mode = state.mode === "JP_EN" ? "EN_JP" : "JP_EN";
  render();
}

function doShuffle(){
  stopTimer();
  clearSlotPickForCurrent();
  state.revealed = false;
  shuffleArray(state.order);
  state.pos = 0;
  render();
}

function toggleFavorite(){
  const idx = currentIndex();
  if(idx === null) return;
  const id = phraseId(phrases[idx]);
  if(state.favorites[id]) delete state.favorites[id];
  else state.favorites[id] = true;
  render();
}

function toggleFavOnly(){
  stopTimer();
  state.revealed = false;
  state.favOnly = !state.favOnly;
  state.pos = 0;
  render();
}

function toggleSrs(){
  stopTimer();
  state.revealed = false;
  state.srsOn = !state.srsOn;
  state.pos = 0;
  render();
}

function toggleTimer(){
  // 3s -> 5s -> OFF -> 3s...
  if(state.timerOn && state.timerSeconds === 3){
    state.timerSeconds = 5;
  }else if(state.timerOn && state.timerSeconds === 5){
    state.timerOn = false;
  }else{
    state.timerOn = true;
    state.timerSeconds = 3;
  }
  stopTimer();
  render();
}

function toggleLevel(){
  stopTimer();
  clearSlotPickForCurrent();
  state.revealed = false;
  state.level = (state.level === 1) ? 2 : 1;
  render();
}

function resetAll(){
  localStorage.removeItem(APP_STORAGE_KEY);
  localStorage.removeItem(DATA_STORAGE_KEY);
  localStorage.removeItem(PROG_STORAGE_KEY);

  phrases = defaultPhrases.slice().map(p => ({
    ...p,
    slots: parseSlots(p.slotsRaw),
    note: p.note || ""
  }));

  progress = {};
  ensureProgressForAll();

  Object.assign(state, JSON.parse(JSON.stringify(defaultState)));
  rebuildOrder();
  render();
}

/* -------- SRS grading (no time labels) --------
 * Again: due=now
 * Hard:  0->0.25d(6h), else *1.5
 * Good:  0->1d, else *2
 * Easy:  0->3d, else *3
 */
function moveCurrentToEnd(){
  const idx = currentIndex();
  if(idx === null) return;
  const where = state.order.indexOf(idx);
  if(where >= 0){
    state.order.splice(where, 1);
    state.order.push(idx);
  }
}

function applyGrade(kind){
  const idx = currentIndex();
  if(idx === null) return;

  const p = phrases[idx];
  const id = phraseId(p);
  const t = todayDay();
  const pr = progress[id] || { interval: 0, due: t };

  if(kind === "AGAIN"){
    pr.interval = 0;
    pr.due = t;
    progress[id] = pr;
    saveProgress();

    state.revealed = false;
    moveCurrentToEnd();
    next();
    return;
  }

  if(kind === "HARD"){
    const nextInterval = pr.interval <= 0 ? 0.25 : Math.min(365, Math.max(0.25, pr.interval * 1.5));
    progress[id] = { interval: nextInterval, due: t + nextInterval };
  }

  if(kind === "GOOD"){
    const nextInterval = pr.interval <= 0 ? 1 : Math.min(365, pr.interval * 2);
    progress[id] = { interval: nextInterval, due: t + nextInterval };
  }

  if(kind === "EASY"){
    const nextInterval = pr.interval <= 0 ? 3 : Math.min(365, pr.interval * 3);
    progress[id] = { interval: nextInterval, due: t + nextInterval };
  }

  saveProgress();
  state.revealed = false;
  next();
}

/* -------- CSV UI -------- */
const csvArea = document.getElementById("csvArea");
const csvHeader = document.getElementById("csvHeader");
const csvInput = document.getElementById("csvInput");
const importBtn = document.getElementById("importBtn");
const exportBtn = document.getElementById("exportBtn");
const importMsg = document.getElementById("importMsg");

csvHeader?.addEventListener("click", () => {
  if(!csvArea) return;
  csvArea.classList.toggle("hidden");
});

importBtn?.addEventListener("click", () => {
  const text = (csvInput?.value || "").trim();
  const rows = parseCSV(text);
  if(rows.length === 0){
    if(importMsg) importMsg.textContent = "取り込み失敗：JP,EN,SLOTS,NOTE のCSVを貼ってね";
    return;
  }

  const oldProgress = progress;

  phrases = rows;
  for(const p of phrases){
    if(typeof p.slotsRaw !== "string") p.slotsRaw = "";
    if(!Array.isArray(p.slots) || p.slots.length === 0){
      p.slots = parseSlots(p.slotsRaw);
    }
    if(typeof p.note !== "string") p.note = "";
  }

  progress = {};
  const t = todayDay();
  for(const p of phrases){
    const id = phraseId(p);
    progress[id] = oldProgress[id] || { interval: 0, due: t };
  }

  // favorites整合性
  const valid = new Set(phrases.map(phraseId));
  for(const k of Object.keys(state.favorites)){
    if(!valid.has(k)) delete state.favorites[k];
  }

  state.slotPickIndex = {};
  state.favOnly = false;
  state.pos = 0;
  state.revealed = false;

  rebuildOrder();
  savePhrases();
  saveProgress();
  render();

  if(importMsg) importMsg.textContent = `取り込み成功：${phrases.length}件`;
});

exportBtn?.addEventListener("click", () => {
  const csv = toCSV(phrases);
  downloadText("phrases.csv", csv);
  if(importMsg) importMsg.textContent = "エクスポートしました";
});

/* -------- wiring -------- */
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
document.getElementById("levelToggleBtn")?.addEventListener("click", toggleLevel);

// SRS評価
document.getElementById("againBtn")?.addEventListener("click", () => applyGrade("AGAIN"));
document.getElementById("hardBtn")?.addEventListener("click", () => applyGrade("HARD"));
document.getElementById("goodBtn")?.addEventListener("click", () => applyGrade("GOOD"));
document.getElementById("easyBtn")?.addEventListener("click", () => applyGrade("EASY"));

document.getElementById("card")?.addEventListener("click", flip);

// 🔊：現在カードの英語（スロット反映後）を読む
document.getElementById("ttsBtn")?.addEventListener("click", () => {
  const idx = currentIndex();
  if(idx === null) return;
  const p = phrases[idx];
  const slot = pickSlotForPhrase(p);
  speakEnglish(fillEN(p.en, slot));
});

window.addEventListener("keydown", (e) => {
  if(e.key === " " || e.key === "Enter") flip();
  if(e.key === "ArrowRight") next();
  if(e.key === "ArrowLeft") prev();
  if(e.key.toLowerCase() === "a") applyGrade("AGAIN");
  if(e.key.toLowerCase() === "h") applyGrade("HARD");
  if(e.key.toLowerCase() === "g") applyGrade("GOOD");
  if(e.key.toLowerCase() === "e") applyGrade("EASY");
});

/* -------- init -------- */
rebuildOrder();
render();
