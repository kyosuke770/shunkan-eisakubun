const APP_STORAGE_KEY = "shunkan_app_state_v2";
const DATA_STORAGE_KEY = "shunkan_phrases_v2";

// ------------- helpers -------------
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

// CSVパース（カンマ区切り＋ダブルクォート対応の簡易版）
function parseCSV(text){
  const lines = text
    .replace(/\r\n/g,"\n")
    .replace(/\r/g,"\n")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if(lines.length === 0) return [];

  // ヘッダー判定（JP,EN など）
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

function splitCSVLine(line){
  const result = [];
  let cur = "";
  let inQuotes = false;

  for(let i=0;i<line.length;i++){
    const ch = line[i];

    if(ch === '"'){
      // "" -> "
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

// ------------- data -------------
const defaultPhrases = [
  { jp: "私は今忙しい。", en: "I'm busy right now." },
  { jp: "それは後でやる。", en: "I'll do it later." },
  { jp: "ちょっと待って。", en: "Hold on a second." },
  { jp: "もう一回言って。", en: "Say that again." },
  { jp: "それで大丈夫。", en: "That's fine." }
];

let phrases = loadJSON(DATA_STORAGE_KEY) || defaultPhrases;

// ------------- state -------------
const defaultState = {
  mode: "JP_EN", // or EN_JP
  order: [],     // indices
  pos: 0,
  revealed: false,
  favOnly: false,
  favorites: {}  // idx: true
};
const state = Object.assign({}, defaultState, loadJSON(APP_STORAGE_KEY) || {});

function saveState(){
  saveJSON(APP_STORAGE_KEY, state);
}
function savePhrases(){
  saveJSON(DATA_STORAGE_KEY, phrases);
}

function rebuildOrder(){
  state.order = phrases.map((_, i) => i);
  if(state.pos >= state.order.length) state.pos = 0;
}

function getVisibleIndices(){
  const all = state.order.slice();
  if(!state.favOnly) return all;
  return all.filter(i => !!state.favorites[i]);
}

function currentIndex(){
  const visible = getVisibleIndices();
  if(visible.length === 0) return null;
  if(state.pos >= visible.length) state.pos = 0;
  return visible[state.pos];
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

  const visible = getVisibleIndices();
  badgeEl.textContent = visible.length ? `${state.pos+1} / ${visible.length}` : `0 / 0`;

  modeBtn.textContent = state.mode === "JP_EN" ? "JP→EN" : "EN→JP";
  onlyFavBtn.textContent = `お気に入りのみ: ${state.favOnly ? "ON" : "OFF"}`;

  const idx = currentIndex();
  if(idx === null){
    frontEl.textContent = "お気に入りが空です。";
    backEl.textContent = "☆ を付けるとここに出ます。";
    hintEl.textContent = "お気に入りのみをOFFにするか、☆を付けてね";
    backEl.classList.add("hidden");
    flipBtn.disabled = true;
    favBtn.disabled = true;
    saveState();
    return;
  }

  const item = phrases[idx];
  const frontText = state.mode === "JP_EN" ? item.jp : item.en;
  const backText  = state.mode === "JP_EN" ? item.en : item.jp;

  frontEl.textContent = frontText;
  backEl.textContent = backText;

  const isFav = !!state.favorites[idx];
  favBtn.textContent = isFav ? "★ お気に入り" : "☆ お気に入り";
  favBtn.disabled = false;
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
  if(state.favorites[idx]) delete state.favorites[idx];
  else state.favorites[idx] = true;
  render();
}
function toggleFavOnly(){
  state.revealed = false;
  state.favOnly = !state.favOnly;
  state.pos = 0;
  render();
}
function resetAll(){
  localStorage.removeItem(APP_STORAGE_KEY);
  localStorage.removeItem(DATA_STORAGE_KEY);
  phrases = defaultPhrases.slice();
  Object.assign(state, JSON.parse(JSON.stringify(defaultState)));
  rebuildOrder();
  render();
}

// ------------- CSV UI -------------
const csvArea = document.getElementById("csvArea");
const toggleCsvBtn = document.getElementById("toggleCsvBtn");
const csvInput = document.getElementById("csvInput");
const importBtn = document.getElementById("importBtn");
const exportBtn = document.getElementById("exportBtn");
const importMsg = document.getElementById("importMsg");

toggleCsvBtn.addEventListener("click", () => {
  const isHidden = csvArea.classList.contains("hidden");
  csvArea.classList.toggle("hidden", !isHidden);
  toggleCsvBtn.textContent = isHidden ? "閉じる" : "開く";
});

importBtn.addEventListener("click", () => {
  const text = (csvInput.value || "").trim();
  const rows = parseCSV(text);
  if(rows.length === 0){
    importMsg.textContent = "取り込み失敗：JP,EN の形式で2列以上ある行を貼ってね。";
    return;
  }

  // 取り込み：置き換え
  phrases = rows;

  // favorites を全消し（インデックス変わるため）
  state.favorites = {};
  state.favOnly = false;
  state.pos = 0;
  state.revealed = false;

  rebuildOrder();
  savePhrases();
  render();

  importMsg.textContent = `取り込み成功：${phrases.length}件 登録しました。`;
});

exportBtn.addEventListener("click", () => {
  const csv = toCSV(phrases);
  downloadText("phrases.csv", csv);
  importMsg.textContent = "エクスポートしました（ダウンロードが始まります）。";
});

// ------------- wire buttons -------------
document.getElementById("flipBtn").addEventListener("click", flip);
document.getElementById("nextBtn").addEventListener("click", next);
document.getElementById("prevBtn").addEventListener("click", prev);
document.getElementById("modeBtn").addEventListener("click", toggleMode);
document.getElementById("shuffleBtn").addEventListener("click", doShuffle);
document.getElementById("favBtn").addEventListener("click", toggleFavorite);
document.getElementById("onlyFavBtn").addEventListener("click", toggleFavOnly);
document.getElementById("resetBtn").addEventListener("click", resetAll);
document.getElementById("card").addEventListener("click", flip);

window.addEventListener("keydown", (e) => {
  if(e.key === " " || e.key === "Enter") flip();
  if(e.key === "ArrowRight") next();
  if(e.key === "ArrowLeft") prev();
});

// 初期化
rebuildOrder();
render();
