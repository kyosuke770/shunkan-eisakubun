const APP_STORAGE_KEY = "shunkan_app_state_v3";
const DATA_STORAGE_KEY = "shunkan_phrases_v3";
const PROG_STORAGE_KEY = "shunkan_progress_v3";

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

function shuffleArray(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---- Date helpers (day integer) ----
function todayDay(){
  return Math.floor(Date.now() / 86400000);
}

// ---- CSV helpers ----
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
    const jp = row[0].trim();
    const en = row[1].trim();
    if(!jp || !en) continue;
    out.push({ jp, en });
  }
  return out;
}

function toCSV(rows){
  const escape = (s) => {
    const needs = /[",\n]/.test(s);
    const v = s.replace(/"/g,'""');
    return needs ? `"${v}"` : v;
  };
  const lines = ["JP,EN"];
  for(const r of rows){
    lines.push(`${escape(r.jp)},${escape(r.en)}`);
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

// ---- Phrase id (stable) ----
function phraseId(p){
  // JP/ENが同じなら同じID（CSV再取込しても進捗が残る）
  return `${p.jp}||${p.en}`;
}

// ---- Defaults ----
const defaultPhrases = [
  { jp: "私は今忙しい。", en: "I'm busy right now." },
  { jp: "それは後でやる。", en: "I'll do it later." },
  { jp: "ちょっと待って。", en: "Hold on a second." },
  { jp: "もう一回言って。", en: "Say that again." },
  { jp: "それで大丈夫。", en: "That's fine." }
];

let phrases = loadJSON(DATA_STORAGE_KEY) || defaultPhrases;

// progress: { [id]: { interval:number, due:number } }
let progress = loadJSON(PROG_STORAGE_KEY) || {};

function ensureProgressForAll(){
  const t = todayDay();
  for(const p of phrases){
    const id = phraseId(p);
    if(!progress[id]){
      // 初期：今日出す
      progress[id] = { interval: 0, due: t };
    }
  }
  // もう存在しないフレーズの進捗は削除
  const valid = new Set(phrases.map(phraseId));
  for(const k of Object.keys(progress)){
    if(!valid.has(k)) delete progress[k];
  }
  saveJSON(PROG_STORAGE_KEY, progress);
}
ensureProgressForAll();

// ---- App state ----
const defaultState = {
  mode: "JP_EN",   // or EN_JP
  order: [],       // indices for navigation/shuffle
  pos: 0,
  revealed: false,
  favOnly: false,
  favorites: {},   // id: true（indexじゃなくIDで保持）
  srsOn: true
};

const state = Object.assign({}, defaultState, loadJSON(APP_STORAGE_KEY) || {});

function saveState(){
  saveJSON(APP_STORAGE_KEY, state);
}
function savePhrases(){
  saveJSON(DATA_STORAGE_KEY, phrases);
}
function saveProgress(){
  saveJSON(PROG_STORAGE_KEY, progress);
}

function rebuildOrder(){
  state.order = phrases.map((_, i) => i);
  if(state.pos >= state.order.length) state.pos = 0;
}

function getVisibleIndices(){
  let indices = state.order.slice();

  // お気に入りフィルタ（IDベース）
  if(state.favOnly){
    indices = indices.filter(i => !!state.favorites[phraseId(phrases[i])]);
  }

  // SRSフィルタ：今日がdueのものだけ
  if(state.srsOn){
    const t = todayDay();
    indices = indices.filter(i => {
      const id = phraseId(phrases[i]);
      const pr = progress[id];
      return pr && pr.due <= t;
    });
  }

  return indices;
}

function currentIndex(){
  const visible = getVisibleIndices();
  if(visible.length === 0) return null;
  if(state.pos >= visible.length) state.pos = 0;
  return visible[state.pos];
}

// Again押したカードを「見えるリストの最後」に回す（すぐ再登場）
function moveCurrentToEnd(){
  const visible = getVisibleIndices();
  const idx = currentIndex();
  if(idx === null) return;
  // visible上での現在posの要素（= idx）を末尾に移動させるために、
  // state.order（全体順）を少し調整する：idxをorderの末尾へ
  const where = state.order.indexOf(idx);
  if(where >= 0){
    state.order.splice(where, 1);
    state.order.push(idx);
  }
}

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

  const visible = getVisibleIndices();
  badgeEl.textContent = visible.length ? `${state.pos+1} / ${visible.length}` : `0 / 0`;

  modeBtn.textContent = state.mode === "JP_EN" ? "JP→EN" : "EN→JP";
  onlyFavBtn.textContent = `お気に入りのみ: ${state.favOnly ? "ON" : "OFF"}`;

  if(srsToggleBtn){
    srsToggleBtn.textContent = `SRS: ${state.srsOn ? "ON" : "OFF"}`;
  }

  const idx = currentIndex();
  if(idx === null){
    // 何も出ないときのガイド
    const t = todayDay();
    const anyDue = phrases.some(p => (progress[phraseId(p)]?.due ?? t) <= t);
    if(state.srsOn && !anyDue){
      frontEl.textContent = "今日の復習は完了！";
      backEl.textContent = "SRSをOFFにすると全件から練習できます。";
      hintEl.textContent = "SRS: OFF にして練習するのもアリ";
    }else{
      frontEl.textContent = "表示できるカードがありません。";
      backEl.textContent = "フィルタ（お気に入り / SRS）を確認してね。";
      hintEl.textContent = "SRSやお気に入りを切り替えてみて";
    }
    backEl.classList.remove("hidden");
    flipBtn.disabled = true;
    if(favBtn) favBtn.disabled = true;
    saveState();
    return;
  }

  const item = phrases[idx];
  const id = phraseId(item);

  const frontText = state.mode === "JP_EN" ? item.jp : item.en;
  const backText  = state.mode === "JP_EN" ? item.en : item.jp;

  frontEl.textContent = frontText;
  backEl.textContent = backText;

  const isFav = !!state.favorites[id];
  if(favBtn){
    favBtn.textContent = isFav ? "★ お気に入り" : "☆ お気に入り";
    favBtn.disabled = false;
  }
  flipBtn.disabled = false;

  if(state.revealed){
    backEl.classList.remove("hidden");
    hintEl.textContent = "もう一度タップで隠す";
    flipBtn.textContent = "隠す";
  }else{
    backEl.classList.add("hidden");
    hintEl.textContent = "タップで答え";
    flipBtn.textContent = "答え";
  }

  saveState();
}

function flip(){
  state.revealed = !state.revealed;
  render();

  // 表示されたら英語を自動再生
  if(state.revealed){
    const idx = currentIndex();
    if(idx !== null){
      const item = phrases[idx];
      const enText = state.mode === "JP_EN" ? item.en : item.jp;
      // JP→ENモードのときだけ英語を読む
      if(state.mode === "JP_EN"){
        speakEnglish(enText);
      }
    }
  }
}

function next(){
  state.revealed = false;
  const visible = getVisibleIndices();
  if(visible.length === 0) return render();
  state.pos = (state.pos + 1) % visible.length;
  render();
}

function prev(){
  state.revealed = false;
  const visible = getVisibleIndices();
  if(visible.length === 0) return render();
  state.pos = (state.pos - 1 + visible.length) % visible.length;
  render();
}

function toggleMode(){
  state.revealed = false;
  state.mode = state.mode === "JP_EN" ? "EN_JP" : "JP_EN";
  render();
}

function doShuffle(){
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
  state.revealed = false;
  state.favOnly = !state.favOnly;
  state.pos = 0;
  render();
}

function toggleSrs(){
  state.revealed = false;
  state.srsOn = !state.srsOn;
  state.pos = 0;
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

// ---- SRS grading ----
// interval rules (minimal):
// Again: due=today, interval=0, and move to end so it reappears this session
// Good: interval = (0 ? 1 : interval*2), due=today+interval
// Easy: interval = (0 ? 3 : interval*3), due=today+interval
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

    // セッション内で再登場させる
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

// ---- CSV UI wiring (if present) ----
const csvArea = document.getElementById("csvArea");
const toggleCsvBtn = document.getElementById("toggleCsvBtn");
const csvHeader = document.getElementById("csvHeader");
const csvInput = document.getElementById("csvInput");
const importBtn = document.getElementById("importBtn");
const exportBtn = document.getElementById("exportBtn");
const importMsg = document.getElementById("importMsg");

if(csvArea && toggleCsvBtn){
  toggleCsvBtn.addEventListener("click", () => {
    const isHidden = csvArea.classList.contains("hidden");
    csvArea.classList.toggle("hidden", !isHidden);
    toggleCsvBtn.textContent = isHidden ? "閉じる" : "開く";
  });
}

// もし「ヘッダータップで開閉」UIにしてるなら対応
if(csvArea && csvHeader){
  csvHeader.addEventListener("click", () => {
    csvArea.classList.toggle("hidden");
  });
}

if(importBtn){
  importBtn.addEventListener("click", () => {
    const text = (csvInput?.value || "").trim();
    const rows = parseCSV(text);
    if(rows.length === 0){
      if(importMsg) importMsg.textContent = "取り込み失敗：JP,EN の2列があるCSVを貼ってね。";
      return;
    }

    // 取込：置き換え（ただし同じJP||ENは進捗を引き継ぐ）
    const oldProgress = progress;
    phrases = rows;

    // progress再構築（同一IDは残す）
    progress = {};
    const t = todayDay();
    for(const p of phrases){
      const id = phraseId(p);
      progress[id] = oldProgress[id] || { interval: 0, due: t };
    }

    // favoritesはIDが変わらない限り残る（ただし存在しないIDは削る）
    const valid = new Set(phrases.map(phraseId));
    for(const k of Object.keys(state.favorites)){
      if(!valid.has(k)) delete state.favorites[k];
    }

    state.favOnly = false;
    state.pos = 0;
    state.revealed = false;

    rebuildOrder();
    savePhrases();
    saveProgress();
    render();

    if(importMsg) importMsg.textContent = `取り込み成功：${phrases.length}件 登録しました。`;
  });
}

if(exportBtn){
  exportBtn.addEventListener("click", () => {
    const csv = toCSV(phrases);
    downloadText("phrases.csv", csv);
    if(importMsg) importMsg.textContent = "エクスポートしました（ダウンロードが始まります）。";
  });
}

// ---- Wire buttons ----
document.getElementById("flipBtn")?.addEventListener("click", flip);
document.getElementById("nextBtn")?.addEventListener("click", next);
document.getElementById("prevBtn")?.addEventListener("click", prev);
document.getElementById("modeBtn")?.addEventListener("click", toggleMode);
document.getElementById("shuffleBtn")?.addEventListener("click", doShuffle);
document.getElementById("favBtn")?.addEventListener("click", toggleFavorite);
document.getElementById("onlyFavBtn")?.addEventListener("click", toggleFavOnly);
document.getElementById("resetBtn")?.addEventListener("click", resetAll);
document.getElementById("srsToggleBtn")?.addEventListener("click", toggleSrs);

// カード本体タップでも裏返し
document.getElementById("card")?.addEventListener("click", flip);

// SRS評価ボタン
document.getElementById("againBtn")?.addEventListener("click", () => grade("AGAIN"));
document.getElementById("goodBtn")?.addEventListener("click", () => grade("GOOD"));
document.getElementById("easyBtn")?.addEventListener("click", () => grade("EASY"));

window.addEventListener("keydown", (e) => {
  if(e.key === " " || e.key === "Enter") flip();
  if(e.key === "ArrowRight") next();
  if(e.key === "ArrowLeft") prev();
  if(e.key.toLowerCase() === "a") grade("AGAIN");
  if(e.key.toLowerCase() === "g") grade("GOOD");
  if(e.key.toLowerCase() === "e") grade("EASY");
});
function speakEnglish(text){
  if(!("speechSynthesis" in window)) return;

  // 連続再生防止
  window.speechSynthesis.cancel();

  const uttr = new SpeechSynthesisUtterance(text);
  uttr.lang = "en-US";     // en-GB に変えてもOK
  uttr.rate = 1.0;         // 0.8〜1.1で調整可
  uttr.pitch = 1.0;
  uttr.volume = 1.0;

  window.speechSynthesis.speak(uttr);
}
document.getElementById("ttsBtn")?.addEventListener("click", () => {
  const idx = currentIndex();
  if(idx === null) return;
  const item = phrases[idx];
  const enText = state.mode === "JP_EN" ? item.en : item.jp;
  if(state.mode === "JP_EN"){
    speakEnglish(enText);
  }
});
// Init
rebuildOrder();
render();
