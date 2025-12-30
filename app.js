/**
 * Shunkan EISAKUBUN
 * CSV: JP,EN,SLOTS
 * - SLOTS format: en:jp|en:jp|...
 * - Lv1: slots present -> always use first slot (fixed)
 * - Lv2: slots present -> random slot each time card appears
 * - JP/EN both can contain {x} (or not)
 */

const APP_STORAGE_KEY = "shunkan_app_state_v5";
const DATA_STORAGE_KEY = "shunkan_phrases_v5";
const PROG_STORAGE_KEY = "shunkan_progress_v5";

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

/* -------- day helper (LOCAL day int) -------- */
function todayDay(){
  const now = new Date();
  const localMs = now.getTime() - now.getTimezoneOffset() * 60000;
  return Math.floor(localMs / 86400000);
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
  // slotsRaw: "busy:忙しい|tired:疲れている"
  const raw = (slotsRaw || "").trim();
  if(!raw) return [];

  const parts = raw.split("|").map(s => s.trim()).filter(Boolean);
  const out = [];
  for(const p of parts){
    const idx = p.indexOf(":");
    if(idx === -1) continue; // invalid
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
    const slots = parseSlots(slotsRaw);

    out.push({ jp, en, slotsRaw, slots });
  }
  return out;
}

function toCSV(rows){
  const escape = (s) => {
    const needs = /[",\n]/.test(s);
    const v = (s ?? "").toString().replace(/"/g,'""');
    return needs ? `"${v}"` : v;
  };

  const lines = ["JP,EN,SLOTS"];
  for(const r of rows){
    lines.push(`${escape(r.jp)},${escape(r.en)},${escape(r.slotsRaw || "")}`);
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
  // templates + slotsRaw で安定（slotがランダムでもIDは固定）
  return `${p.jp}||${p.en}||${p.slotsRaw || ""}`;
}

/* -------- slot fill helpers -------- */
function fillTemplate(template, slot){
  // slot: {en, jp}
  if(!template) return "";
  if(!slot) return template.replaceAll("{x}", "___");
  // template内の {x} を「文脈に応じて」入れるが、
  // JP/EN側で呼ぶ側が slot.en / slot.jp を選ぶので、ここでは値を渡す版も使う
  return template;
}
function fillJP(templateJP, slot){
  if(!templateJP) return "";
  if(!slot) return templateJP.replaceAll("{x}", "___");
  return templateJP.replaceAll("{x}", slot.jp);
}
function fillEN(templateEN, slot){
  if(!templateEN) return "";
  if(!slot) return templateEN.replaceAll("{x}", "___");
  return templateEN.replaceAll("{x}", slot.en);
}

/* -------- pick slot based on level -------- */
function pickSlotForPhrase(p){
  if(!p.slots || p.slots.length === 0) return null;

  const id = phraseId(p);
  // Lv1: 常に先頭（固定）
  if(state.level === 1){
    state.slotPickIndex[id] = 0;
    return p.slots[0];
  }

  // Lv2: 表示ごとにランダム（カードが切り替わったら選び直す）
  const existing = state.slotPickIndex[id];
  if(typeof existing === "number" && p.slots[existing]){
    return p.slots[existing];
  }
  const idx = Math.floor(Math.random() * p.slots.length);
  state.slotPickIndex[id] = idx;
  return p.slots[idx];
}

function clearSlotPickForCurrent(){
  const idx = currentIndex();
  if(idx === null) return;
  const id = phraseId(phrases[idx]);
  delete state.slotPickIndex[id];
}

/* -------- defaults -------- */
const defaultPhrases = [
  {
    jp: "今{x}。",
    en: "I'm {x} right now.",
    slotsRaw: "busy:忙しい|tired:疲れている|free:暇だ",
    slots: [{en:"busy",jp:"忙しい"},{en:"tired",jp:"疲れている"},{en:"free",jp:"暇だ"}]
  },
  {
    jp: "それは後でやる。",
    en: "I'll do it later.",
    slotsRaw: "",
    slots: []
  },
  {
    jp: "ちょっと待って。",
    en: "Hold on a second.",
    slotsRaw: "",
    slots: []
  }
];

let phrases = loadJSON(DATA_STORAGE_KEY) || defaultPhrases;

// progress: { [id]: { interval:number, due:number } }
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

/* -------- TTS -------- */
function speakEnglish(text){
  if(!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const uttr = new SpeechSynthesisUtterance(text);
  uttr.lang = "en-US";
  uttr.rate = 1.0;
  uttr.pitch = 1.0;
  uttr.volume = 1.0;
  window.speechSynthesis.speak(uttr);
}

/* -------- 3-sec timer -------- */
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

  timerCount = 3;
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

        // JP→EN の答え表示時だけ英語を読む（答え=EN）
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
  const backEl = document.getElementById("backText");
  const hintEl = document.getElementById("hintText");
  const badgeEl = document.getElementById("indexBadge");

  const modeBtn = document.getElementById("modeBtn");
  const flipBtn = document.getElementById("flipBtn");
  const favBtn = document.getElementById("favBtn");
  const onlyFavBtn = document.getElementById("onlyFavBtn");
  const srsToggleBtn = document.getElementById("srsToggleBtn");
  const timerToggleBtn = document.getElementById("timerToggleBtn");
  const levelToggleBtn = document.getElementById("levelToggleBtn");

  const visible = getVisibleIndices();
  if(badgeEl) badgeEl.textContent = visible.length ? `${state.pos+1} / ${visible.length}` : `0 / 0`;

  if(modeBtn) modeBtn.textContent = state.mode === "JP_EN" ? "JP→EN" : "EN→JP";
  if(onlyFavBtn) onlyFavBtn.textContent = `お気に入りのみ: ${state.favOnly ? "ON" : "OFF"}`;
  if(srsToggleBtn) srsToggleBtn.textContent = `SRS: ${state.srsOn ? "ON" : "OFF"}`;
  if(timerToggleBtn) timerToggleBtn.textContent = `⏱ 3秒: ${state.timerOn ? "ON" : "OFF"}`;
  if(levelToggleBtn) levelToggleBtn.textContent = `Lv: ${state.level}`;

  const idx = currentIndex();
  if(idx === null){
    const t = todayDay();
    const anyDue = phrases.some(p => (progress[phraseId(p)]?.due ?? t) <= t);

    if(frontEl && backEl && hintEl){
      if(state.srsOn && !anyDue){
        frontEl.textContent = "今日の復習は完了！";
        backEl.textContent = "SRSをOFFにすると全件練習できます。";
        hintEl.textContent = "SRSを切り替えてみて";
      }else{
        frontEl.textContent = "表示できるカードがありません。";
        backEl.textContent = "フィルタ（お気に入り / SRS）を確認してね。";
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
  const id = phraseId(p);
  const slot = pickSlotForPhrase(p);

  const jpFilled = fillJP(p.jp, slot);
  const enFilled = fillEN(p.en, slot);

  const frontText = (state.mode === "JP_EN") ? jpFilled : enFilled;
  const backText  = (state.mode === "JP_EN") ? enFilled : jpFilled;

  if(frontEl) frontEl.textContent = frontText;
  if(backEl) backEl.textContent = backText;

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

  // JP→EN の答え表示時だけ英語を読む
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
  state.timerOn = !state.timerOn;
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

  phrases = defaultPhrases.slice();
  progress = {};
  ensureProgressForAll();

  Object.assign(state, JSON.parse(JSON.stringify(defaultState)));
  rebuildOrder();
  render();
}

/* -------- SRS grading --------
 * Again: due=today, interval=0, and move to end (reappear in session)
 * Good:  interval = (0?1:interval*2), due=today+interval
 * Easy:  interval = (0?3:interval*3), due=today+interval
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

function grade(gradeType){
  const idx = currentIndex();
  if(idx === null) return;

  const p = phrases[idx];
  const id = phraseId(p);
  const t = todayDay();
  const pr = progress[id] || { interval: 0, due: t };

  if(gradeType === "AGAIN"){
    pr.interval = 0;
    pr.due = t;
    progress[id] = pr;
    saveProgress();

    state.revealed = false;

    // セッション内再登場
    moveCurrentToEnd();
    next();
    return;
  }

  if(gradeType === "GOOD"){
    pr.interval = pr.interval <= 0 ? 1 : Math.min(365, pr.interval * 2);
    pr.due = t + pr.interval;
  }

  if(gradeType === "EASY"){
    pr.interval = pr.interval <= 0 ? 3 : Math.min(365, pr.interval * 3);
    pr.due = t + pr.interval;
  }

  progress[id] = pr;
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
    if(importMsg) importMsg.textContent = "取り込み失敗：JP,EN,SLOTS のCSVを貼ってね（SLOTSは空でもOK）";
    return;
  }

  // 進捗引き継ぎ（同一IDは残す）
  const oldProgress = progress;
  phrases = rows;

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

  // slotPickリセット
  state.slotPickIndex = {};

  state.favOnly = false;
  state.pos = 0;
  state.revealed = false;

  rebuildOrder();
  savePhrases();
  saveProgress();
  render();

  if(importMsg) importMsg.textContent = `取り込み成功：${phrases.length}件 登録しました。`;
});

exportBtn?.addEventListener("click", () => {
  const csv = toCSV(phrases);
  downloadText("phrases.csv", csv);
  if(importMsg) importMsg.textContent = "エクスポートしました（ダウンロードが始まります）。";
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

document.getElementById("againBtn")?.addEventListener("click", () => grade("AGAIN"));
document.getElementById("goodBtn")?.addEventListener("click", () => grade("GOOD"));
document.getElementById("easyBtn")?.addEventListener("click", () => grade("EASY"));

document.getElementById("card")?.addEventListener("click", flip);

// 🔊 は「現在カードの英語（スロット反映後）」を読む
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
  if(e.key.toLowerCase() === "a") grade("AGAIN");
  if(e.key.toLowerCase() === "g") grade("GOOD");
  if(e.key.toLowerCase() === "e") grade("EASY");
});

/* -------- init -------- */
rebuildOrder();
render();
