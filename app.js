/*************************************************
 * Constants & Storage Keys
 *************************************************/
const STATE_KEY = "state_v1";
const SRS_KEY = "srs_v1";
const BLOCK_PROGRESS_KEY = "blockProgress_v1";
const PRESETS_KEY = "presets_v1";

/*************************************************
 * Global State
 *************************************************/
let phrases = window.phrases || []; // CSVから入ってくる想定
let state = loadState();
let progress = loadSrs();
let blockProgress = loadBlockProgress();
let presets = loadPresets();

/*************************************************
 * Utilities
 *************************************************/
function todayDay(){
  return Math.floor(Date.now() / 86400000);
}
function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

/*************************************************
 * Phrase / Block helpers
 *************************************************/
function phraseId(p){
  return String(p.no);
}
function getBlockIndex(no){
  return Math.floor((no - 1) / 30) + 1;
}
function blockLabel(no){
  const b = getBlockIndex(no);
  const s = (b-1)*30+1;
  const e = b*30;
  return `${s}-${e}`;
}
function safeGetBlockObj(b){
  if(!blockProgress[b]){
    blockProgress[b] = { clearedSet: [], completed:false, lastPlayedAt:null };
  }
  return blockProgress[b];
}
function isPhraseCleared(no){
  const b = getBlockIndex(no);
  return safeGetBlockObj(b).clearedSet.includes(no);
}

/*************************************************
 * Load / Save
 *************************************************/
function loadState(){
  return JSON.parse(localStorage.getItem(STATE_KEY)) || {
    order: [],
    pos: 0,
    revealed: false,
    filters: null
  };
}
function saveState(){
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function loadSrs(){
  return JSON.parse(localStorage.getItem(SRS_KEY)) || {};
}
function saveSrs(){
  localStorage.setItem(SRS_KEY, JSON.stringify(progress));
}

function loadBlockProgress(){
  return JSON.parse(localStorage.getItem(BLOCK_PROGRESS_KEY)) || {};
}
function saveBlockProgress(){
  localStorage.setItem(BLOCK_PROGRESS_KEY, JSON.stringify(blockProgress));
}

function loadPresets(){
  return JSON.parse(localStorage.getItem(PRESETS_KEY)) || [];
}
function savePresets(){
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

/*************************************************
 * SRS
 *************************************************/
function updateSrs(grade, p){
  const id = phraseId(p);
  const now = todayDay();
  let it = progress[id] || { interval: 0, due: now };

  if(grade === "AGAIN"){ it.interval = 0; }
  if(grade === "HARD"){ it.interval = 1; }
  if(grade === "GOOD"){ it.interval = Math.max(1, it.interval * 2 || 1); }
  if(grade === "EASY"){ it.interval = Math.max(2, it.interval * 3 || 2); }

  it.due = now + it.interval;
  progress[id] = it;
  saveSrs();

  if(grade === "GOOD" || grade === "EASY"){
    markCleared(p.no);
  }
}

function markCleared(no){
  const b = getBlockIndex(no);
  const obj = safeGetBlockObj(b);
  if(!obj.clearedSet.includes(no)){
    obj.clearedSet.push(no);
  }
  if(obj.clearedSet.length >= 30){
    obj.completed = true;
  }
  obj.lastPlayedAt = Date.now();
  saveBlockProgress();
}

/*************************************************
 * Home helpers
 *************************************************/
function getCurrentBlockIndex(){
  const keys = Object.keys(blockProgress).map(Number);
  if(keys.length === 0) return 1;
  const maxB = Math.max(...keys, 1);
  for(let b=1;b<=maxB;b++){
    if(!blockProgress[b] || !blockProgress[b].completed) return b;
  }
  return maxB + 1;
}

function getDueCount(){
  const t = todayDay();
  return phrases.filter(p=>{
    const pr = progress[phraseId(p)];
    return pr && pr.due <= t;
  }).length;
}

/*************************************************
 * Rendering
 *************************************************/
function showHome(){
  document.getElementById("home").style.display="block";
  document.getElementById("play").style.display="none";
}
function showPlay(){
  document.getElementById("home").style.display="none";
  document.getElementById("play").style.display="block";
}

function renderHome(){
  const b = getCurrentBlockIndex();
  const cleared = safeGetBlockObj(b).clearedSet.length;

  document.getElementById("recommendBlock").textContent = blockLabel((b-1)*30+1);
  document.getElementById("recommendCount").textContent = "10";
  document.getElementById("currentBlock").textContent = blockLabel((b-1)*30+1);
  document.getElementById("clearedCount").textContent = cleared;
  document.getElementById("blockProgressBar").style.width = `${(cleared/30)*100}%`;
  document.getElementById("reviewCount").textContent = getDueCount();

  renderPresetChips();
}

/*************************************************
 * Play logic
 *************************************************/
function startTodayRecommend(){
  const b = getCurrentBlockIndex();
  const uncleared = phrases.filter(p=>getBlockIndex(p.no)===b && !isPhraseCleared(p.no));
  const base = uncleared.length ? uncleared : phrases.filter(p=>getBlockIndex(p.no)===b);
  state.order = shuffle(base).slice(0,10).map(p=>phrases.indexOf(p));
  state.pos = 0;
  state.revealed = false;
  saveState();
  showPlay();
  render();
}

function startLinearFromBlock(b){
  const uncleared = phrases
    .filter(p=>getBlockIndex(p.no)===b && !isPhraseCleared(p.no))
    .sort((a,b)=>a.no-b.no);

  const list = uncleared.length ? uncleared :
    phrases.filter(p=>getBlockIndex(p.no)===b).sort((a,b)=>a.no-b.no);

  state.order = list.map(p=>phrases.indexOf(p));
  state.pos = 0;
  state.revealed = false;
  saveState();
  showPlay();
  render();
}

function startReview(){
  const t = todayDay();
  const due = phrases.filter(p=>{
    const pr = progress[phraseId(p)];
    return pr && pr.due <= t;
  });
  if(!due.length){
    alert("復習はありません");
    return;
  }
  state.order = shuffle(due).map(p=>phrases.indexOf(p));
  state.pos = 0;
  state.revealed = false;
  saveState();
  showPlay();
  render();
}

/*************************************************
 * Presets
 *************************************************/
function startWithFilters(filters){
  const matches = phrases.filter(p=>matchFilters(p,filters));
  if(!matches.length){
    alert("条件に合う問題がありません");
    return;
  }

  const uncleared = [];
  const cleared = [];
  matches.forEach(p=>{
    (isPhraseCleared(p.no)?cleared:uncleared).push(p);
  });

  state.order = shuffle(uncleared).concat(shuffle(cleared))
    .map(p=>phrases.indexOf(p));
  state.pos = 0;
  state.revealed = false;
  saveState();
  showPlay();
  render();
}

function matchFilters(p,f){
  if(f.lv?.length && !f.lv.includes(p.lv)) return false;
  if(f.scene?.length && !f.scene.includes(p.scene)) return false;
  if(f.func?.length && !f.func.includes(p.func)) return false;
  if(f.block?.length && !f.block.includes(blockLabel(p.no))) return false;
  return true;
}

function renderPresetChips(){
  const wrap = document.getElementById("presetChips");
  if(!wrap) return;
  wrap.innerHTML="";
  presets.slice(0,6).forEach(p=>{
    const d=document.createElement("div");
    d.className="chip";
    d.textContent=p.name;
    d.onclick=()=>startWithFilters(p.filters);
    wrap.appendChild(d);
  });
}

/*************************************************
 * Card Rendering（超簡易）
 *************************************************/
function render(){
  const idx = state.order[state.pos];
  const p = phrases[idx];
  document.getElementById("jp").textContent = p.jp;
  document.getElementById("en").textContent = state.revealed ? p.en : "タップして答え";
}

/*************************************************
 * Events
 *************************************************/
document.getElementById("startRecommend")?.addEventListener("click", startTodayRecommend);
document.getElementById("continueLinear")?.addEventListener("click", ()=>startLinearFromBlock(getCurrentBlockIndex()));
document.getElementById("startReview")?.addEventListener("click", startReview);

document.getElementById("gradeAgain")?.addEventListener("click", ()=>grade("AGAIN"));
document.getElementById("gradeHard")?.addEventListener("click", ()=>grade("HARD"));
document.getElementById("gradeGood")?.addEventListener("click", ()=>grade("GOOD"));
document.getElementById("gradeEasy")?.addEventListener("click", ()=>grade("EASY"));

function grade(g){
  const p = phrases[state.order[state.pos]];
  updateSrs(g,p);
  state.pos++;
  state.revealed=false;
  saveState();
  if(state.pos>=state.order.length){
    showHome();
    renderHome();
  }else{
    render();
  }
}

/*************************************************
 * Init
 *************************************************/
showHome();
renderHome();
