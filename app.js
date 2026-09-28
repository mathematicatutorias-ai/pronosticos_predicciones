import {searchPolymarket,loadSearchItem,getTokenHistory,previewSearchItem,getLandingEvents} from "./api.js?v=0.5.0";
import {clearAllData,clearEverything,pruneExpired,storageEstimate,countStore,getItem,putItem,deleteItem,listItems} from "./db.js?v=0.5.0";
import {runChronosBatch,runTimesFMBatch,clearModelCaches} from "./model-bridge.js?v=0.5.0";
import {toSpanish,queryToEnglish,translatorSupported} from "./i18n.js?v=0.5.0";

const $=id=>document.getElementById(id);
const COLORS=["#155eef","#f04438","#f5b700","#12b76a","#7a5af8","#ee46bc","#6172f3","#f79009","#0ba5ec","#667085"];
const CATEGORY_NAMES={"":"Más activos","politics":"Política","sports":"Deportes","crypto":"Cripto","finance":"Finanzas","geopolitics":"Geopolítica","tech":"Tecnología","culture":"Cultura","weather":"Clima"};
const STEP_HOURS=6,STEP_MS=STEP_HOURS*3600*1000,WEEK_STEPS=28,LONG_SERIES_MIN=112,MAX_FORECAST_STEPS=64;
const state={event:null,selected:null,histories:new Map(),analyses:new Map(),running:new Set(),baseVisible:new Set(),horizonDays:7,searchTimer:null,marketFilter:"",compareOpen:false,landingCategory:"",landingEvents:[]};

function showLanding(){ $("landing").hidden=false;$("workspace").hidden=true;window.scrollTo({top:0,behavior:"instant"});renderLocalSummary();renderRecentSaved(); }
function showWorkspace(){ $("landing").hidden=true;$("workspace").hidden=false;window.scrollTo({top:0,behavior:"instant"}); }
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function fmtPct(x){if(!Number.isFinite(+x))return "—";if(+x<1&&+x>0)return "<1%";return `${(+x).toFixed(+x>=10?1:2)}%`;}
function fmtPP(x){if(!Number.isFinite(+x))return "—";return `${x>=0?"+":""}${(+x).toFixed(Math.abs(x)<1?2:1)} pp`;}
function fmtUSD(x){const n=Number(x);if(!Number.isFinite(n))return "—";return new Intl.NumberFormat("es-EC",{style:"currency",currency:"USD",notation:n>=1e6?"compact":"standard",maximumFractionDigits:n>=1e6?2:0}).format(n);}
function fmtDate(x){if(!x)return "—";const d=new Date(x);return Number.isNaN(d.getTime())?"—":d.toLocaleDateString("es-EC",{year:"numeric",month:"short",day:"numeric"});}
function fmtDateTime(x){if(!x)return "—";const d=new Date(x);return Number.isNaN(d.getTime())?"—":d.toLocaleString("es-EC",{dateStyle:"medium",timeStyle:"short"});}
function fmtCents(x){return Number.isFinite(+x)?`${(+x*100).toFixed(1)}¢`:"—";}
function toast(msg,ms=2800){const el=$("toast");el.textContent=msg;el.hidden=false;clearTimeout(el._t);el._t=setTimeout(()=>el.hidden=true,ms);}
function globalStatus(msg,type=""){const el=$("openStatus");if(!msg){el.hidden=true;return}el.textContent=msg;el.hidden=false;el.className=`open-status ${type}`.trim();}
function chartStatus(msg,type=""){const el=$("chartStatus");if(!msg){el.hidden=true;return}el.textContent=msg;el.hidden=false;el.className=`chart-status ${type}`.trim();}
function setStatus(text,type="running"){const el=$("forecastStatus");if(!text){el.hidden=true;return}el.hidden=false;el.className=`panel status-panel ${type}`;el.textContent=text;}
function imgFallback(img){img.onerror=()=>{img.onerror=null;img.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='100%' height='100%' fill='#f2f4f7'/><path d='M25 72 L60 34 L95 72' fill='none' stroke='#98a2b3' stroke-width='7'/></svg>`);};}
function titleOf(x){return x?.displayTitle||x?.title||x?.question||"—";}
function marketColor(m){const i=Math.max(0,state.event?.markets?.findIndex(x=>x.id===m.id)??0);return COLORS[i%COLORS.length];}
function analysisKey(m){return `${state.event?.id||state.event?.slug||"event"}:${m.yesToken||m.id}`;}
function valuesFor(m){return (state.histories.get(m.yesToken)?.six||[]).map(x=>x.p*100);}
function pointsFor(m){return state.histories.get(m.yesToken)?.six||[];}
function latestT(m){const p=pointsFor(m);return p.length?+p.at(-1).t:null;}
function horizonSteps(){return Math.min(MAX_FORECAST_STEPS,state.horizonDays*4);}
function futureDates(anchorT,n){let ms=Number(anchorT)*1000;return Array.from({length:n},()=>new Date(ms+=STEP_MS));}
function eventUrl(e){return e?.slug?`https://polymarket.com/es/event/${encodeURIComponent(e.slug)}`:"https://polymarket.com/es";}
function marketUrl(e,m){return e?.slug&&m?.slug?`${eventUrl(e)}/${encodeURIComponent(m.slug)}`:eventUrl(e);}
function modelIcon(kind){
  if(kind==="chronos")return `<span class="model-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3M9 12h6M12 9v6"/></svg></span>`;
  return `<span class="model-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 7h8M7 8l4 8M17 8l-4 8"/></svg></span>`;
}
function eventItem(ev){return {kind:"event",id:ev.id,slug:ev.slug,title:ev.title,image:ev.image,raw:ev.raw||null};}

async function maybeTranslateEntity(entity){
  if(!entity?.title)return;
  try{const tr=await toSpanish(entity.title);if(tr&&tr!==entity.title){entity.displayTitle=tr;renderAll();}}catch{}
}
async function translateEventInBackground(){
  const e=state.event;if(!e)return;
  try{const tr=await toSpanish(e.title);if(tr&&tr!==e.title){e.displayTitle=tr;renderAll();}}catch{}
  for(const m of e.markets.slice(0,40)){
    try{const tr=await toSpanish(m.title);if(tr&&tr!==m.title){m.displayTitle=tr;renderMarketRows();renderSelected();renderVisibleSeries();}}catch{}
  }
}

async function doSearch(q){
  const box=$("searchResults");if(q.trim().length<2){box.hidden=true;return}
  box.hidden=false;box.innerHTML=`<div class="search-empty">Buscando…</div>`;
  try{
    let alt=q;try{alt=await queryToEnglish(q)}catch{}
    const items=await searchPolymarket(q,{alternateQueries:alt&&alt!==q?[alt]:[]});
    if(!items.length){box.innerHTML=`<div class="search-empty">Sin resultados.</div>`;return}
    box.innerHTML=items.map((x,i)=>`<div class="search-result" data-i="${i}" role="button" tabindex="0">
      <img src="${x.image||""}" alt=""><div><b data-title>${escapeHtml(x.title)}</b><small>${escapeHtml([x.category,x.volume24hr?`${fmtUSD(x.volume24hr)} en 24 h`:"",x.marketCount?`${x.marketCount} mercados`:""].filter(Boolean).join(" · "))}</small></div>
      <div class="result-meta"><span class="result-kind">${x.kind==="event"?"evento":"mercado"}</span><br>${x.endDate?`cierra ${fmtDate(x.endDate)}`:""}</div></div>`).join("");
    [...box.querySelectorAll(".search-result")].forEach(el=>{imgFallback(el.querySelector("img"));const activate=()=>openItem(items[+el.dataset.i]);el.onclick=activate;el.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();activate()}}});
    items.forEach(async(x,i)=>{try{const tr=await toSpanish(x.title);if(tr!==x.title){const el=box.querySelector(`[data-i="${i}"] [data-title]`);if(el)el.textContent=tr;}}catch{}});
  }catch(e){box.innerHTML=`<div class="search-empty">Error de API: ${escapeHtml(e.message)}</div>`}
}

async function loadLandingFeed(category=state.landingCategory,{force=false}={}){
  state.landingCategory=category;
  document.querySelectorAll("[data-category]").forEach(b=>b.classList.toggle("active",b.closest(".category-nav")&&b.dataset.category===category));
  $("feedTitle").textContent=category?CATEGORY_NAMES[category]:"Más activos en 24 h";
  $("feedSubtitle").textContent=category?`Eventos activos de ${CATEGORY_NAMES[category].toLowerCase()}, ordenados por volumen reciente.`:"Eventos activos ordenados por actividad reciente.";
  $("feedStatus").hidden=false;$("feedStatus").textContent="Cargando mercados…";$("eventCards").innerHTML="";
  try{
    if(force){ /* cache expires quickly; changing category naturally uses a distinct key */ }
    const events=await getLandingEvents({categorySlug:category,limit:12});state.landingEvents=events;
    renderLandingEvents();$("feedStatus").hidden=true;
    for(const e of events){maybeTranslateEntity(e)}
  }catch(e){$("feedStatus").textContent=`No pude cargar esta portada: ${e.message}. El buscador superior sigue disponible.`}
}
function renderLandingEvents(){
  const events=state.landingEvents;
  $("eventCards").innerHTML=events.map((e,i)=>{
    const top=[...e.markets].sort((a,b)=>b.yesPrice-a.yesPrice).slice(0,3);
    const cat=(e.tags||[]).find(t=>t?.label||t?.name||t?.slug);
    return `<article class="event-card" data-i="${i}" tabindex="0">
      <div class="event-card-image"><img src="${e.image||""}" alt=""><span class="status-chip">Activo</span>${e.endDate?`<span class="end-chip">Cierra ${fmtDate(e.endDate)}</span>`:""}</div>
      <div class="event-card-body"><div class="event-category">${escapeHtml(cat?.label||cat?.name||cat?.slug||CATEGORY_NAMES[state.landingCategory]||"Mercado")}</div>
      <h3>${escapeHtml(titleOf(e))}</h3>
      <div class="event-stats"><b>${fmtUSD(e.volume24hr)}</b><span>Volumen 24 h</span><span>·</span><span>${e.markets.length} mercados</span></div>
      <div class="top-outcomes">${top.map((m,j)=>`<div class="top-outcome"><i style="background:${COLORS[j%COLORS.length]}"></i><span>${escapeHtml(titleOf(m))}</span><b>${fmtPct(m.yesPrice)}</b></div>`).join("")}</div></div></article>`;
  }).join("");
  [...$("eventCards").querySelectorAll(".event-card")].forEach(el=>{
    const e=events[+el.dataset.i];imgFallback(el.querySelector("img"));const open=()=>openItem(eventItem(e));el.onclick=open;el.onkeydown=x=>{if(x.key==="Enter")open()};
  });
}
async function renderLocalSummary(){
  $("homeHistoryCount").textContent=await countStore("history");$("homeAnalysisCount").textContent=await countStore("analysis");
  try{const c=await caches.open("forecast-local-models-v1"),keys=await c.keys();$("homeModelCount").textContent=keys.length}catch{$("homeModelCount").textContent="—"}
  const est=await storageEstimate();$("homeStorageUsage").textContent=est?`${(est.usage/1024/1024).toFixed(0)} MB`:"—";
}
async function renderRecentSaved(){
  const [saved,recent]=await Promise.all([listItems("bookmarks",{limit:5}),listItems("recent",{limit:8})]);
  const map=new Map();for(const r of [...saved,...recent]){const v=r.value;if(v?.id&&!map.has(v.id))map.set(v.id,{...v,saved:saved.some(s=>s.value?.id===v.id),seenAt:r.updatedAt})}
  const rows=[...map.values()].slice(0,5);
  $("recentCards").innerHTML=rows.length?rows.map((v,i)=>`<article class="recent-card" data-i="${i}"><img src="${v.image||""}" alt=""><div><b>${escapeHtml(v.displayTitle||v.title)}</b><small>${v.saved?"Guardado":"Visto recientemente"}</small></div><span class="star">${v.saved?"★":"›"}</span></article>`).join(""):`<div class="recent-empty">Todavía no hay mercados guardados o recientes en este navegador.</div>`;
  [...$("recentCards").querySelectorAll(".recent-card")].forEach(el=>{const v=rows[+el.dataset.i];imgFallback(el.querySelector("img"));el.onclick=()=>openItem({kind:"event",id:v.id,slug:v.slug,title:v.title,image:v.image,raw:null})});
}

async function loadPersistedAnalyses(){
  state.analyses.clear();if(!state.event)return;
  await Promise.all(state.event.markets.map(async m=>{try{const row=await getItem("analysis",analysisKey(m));if(row?.value)state.analyses.set(m.yesToken,row.value)}catch{}}));
}
async function persistAnalysis(m,a){state.analyses.set(m.yesToken,a);await putItem("analysis",analysisKey(m),a)}
async function rememberEvent(){
  if(!state.event)return;
  await putItem("recent",state.event.id,{id:state.event.id,slug:state.event.slug,title:state.event.title,displayTitle:state.event.displayTitle||"",image:state.event.image});
}
async function bookmarkState(){
  if(!state.event)return false;return !!(await getItem("bookmarks",state.event.id));
}
async function toggleBookmark(){
  if(!state.event)return;const old=await getItem("bookmarks",state.event.id);
  if(old){await deleteItem("bookmarks",state.event.id);toast("Quitado de guardados.")}
  else{await putItem("bookmarks",state.event.id,{id:state.event.id,slug:state.event.slug,title:state.event.title,displayTitle:state.event.displayTitle||"",image:state.event.image});toast("Guardado en este navegador.")}
  renderBookmark();renderRecentSaved();
}
async function renderBookmark(){if(!state.event)return;const saved=await bookmarkState();$("bookmarkEvent").classList.toggle("saved",saved);$("bookmarkEvent").textContent=saved?"★":"☆"}

async function openItem(item){
  $("searchResults").hidden=true;$("searchInput").blur();globalStatus("Abriendo mercado…");
  state.histories.clear();state.analyses.clear();state.running.clear();state.baseVisible.clear();state.compareOpen=false;
  const preview=previewSearchItem(item);
  if(preview){state.event=preview;state.event.markets=[...(preview.markets||[])].sort((a,b)=>b.yesPrice-a.yesPrice);state.selected=state.event.markets[0]||null;state.event.markets.slice(0,4).forEach(m=>state.baseVisible.add(m.yesToken));showWorkspace();renderAll();chartStatus("Cargando metadata e históricos…")}
  try{
    const ev=await loadSearchItem(item);state.event=ev;state.event.markets=[...(ev.markets||[])].sort((a,b)=>b.yesPrice-a.yesPrice);state.selected=state.event.markets.find(m=>m.id===state.selected?.id)||state.event.markets[0]||null;
    if(!state.baseVisible.size)state.event.markets.slice(0,4).forEach(m=>state.baseVisible.add(m.yesToken));
    await loadPersistedAnalyses();showWorkspace();renderAll();rememberEvent();renderBookmark();translateEventInBackground();
    if(!state.event.markets.length)throw new Error("El evento no devolvió mercados analizables.");
    const wanted=new Map();[state.selected,...state.event.markets.slice(0,4)].filter(Boolean).forEach(m=>wanted.set(m.yesToken,m));for(const m of state.event.markets){const a=state.analyses.get(m.yesToken);if(a?.visible)wanted.set(m.yesToken,m)}
    let done=0;const list=[...wanted.values()].filter(m=>m.yesToken);chartStatus(`Descargando históricos 0/${list.length}…`);
    await Promise.allSettled(list.map(async m=>{try{state.histories.set(m.yesToken,await getTokenHistory(m.yesToken))}finally{done++;chartStatus(`Descargando históricos ${done}/${list.length}…`);renderAll()}}));
    renderAll();chartStatus("");globalStatus("Mercado cargado","ok");setTimeout(()=>globalStatus(""),1200);await refreshStorage();
  }catch(e){console.error(e);globalStatus(`Error: ${e.message}`,"error");chartStatus(`No pude completar la carga: ${e.message}`,"error");toast(e.message,5000)}
}

function splitFor(values,pts){
  const n=values.length;if(n<40)throw new Error("Se necesitan al menos 40 puntos de 6 horas para analizar esta serie.");
  let trainEnd,valEnd,validN,testN,mode;
  if(n>=LONG_SERIES_MIN){validN=WEEK_STEPS;testN=WEEK_STEPS;trainEnd=n-validN-testN;valEnd=n-testN;mode="7d / 7d"}
  else{trainEnd=Math.max(20,Math.floor(n*.70));validN=Math.max(1,Math.floor(n*.15));valEnd=Math.min(n-1,trainEnd+validN);testN=n-valEnd;validN=valEnd-trainEnd;mode="70 / 15 / 15"}
  return {mode,n,trainEnd,valEnd,validN,testN,firstT:+pts[0].t,validStartT:+pts[trainEnd].t,testStartT:+pts[valEnd].t,observedEndT:+pts[n-1].t,labels:n>=LONG_SERIES_MIN?{train:"ENTRENAMIENTO",valid:"VALIDACIÓN · 7 días",test:"PRUEBA · 7 días"}:{train:"ENTRENAMIENTO · 70%",valid:"VALIDACIÓN · 15%",test:"PRUEBA · 15%"}};
}
function metrics(actual,pred,previous){
  const n=Math.min(actual.length,pred.length);if(!n)return{mae:NaN,rmse:NaN,direction:NaN,n:0};let ae=0,se=0,correct=0,den=0;
  for(let i=0;i<n;i++){const d=pred[i]-actual[i];ae+=Math.abs(d);se+=d*d;const aPrev=i===0?previous:actual[i-1],pPrev=i===0?previous:pred[i-1],ad=Math.sign(actual[i]-aPrev),pd=Math.sign(pred[i]-pPrev);if(ad!==0){den++;if(ad===pd)correct++}}
  return{mae:ae/n,rmse:Math.sqrt(se/n),direction:den?100*correct/den:NaN,n};
}
async function ensureHistory(m){if(!state.histories.has(m.yesToken))state.histories.set(m.yesToken,await getTokenHistory(m.yesToken));const values=valuesFor(m);if(values.length<40)throw new Error("La serie histórica es demasiado corta para el análisis.");return values}

async function analyzeMarket(m){
  if(!m||state.running.has(m.yesToken))return;state.selected=m;state.running.add(m.yesToken);renderAll();switchTab("forecast");
  const old=state.analyses.get(m.yesToken),oldVisible=old?.visible!==false;
  try{
    setStatus(`Preparando ${titleOf(m)}…`,"running");const values=await ensureHistory(m),pts=pointsFor(m),split=splitFor(values,pts),contexts=[values.slice(0,split.trainEnd),values.slice(0,split.valEnd),values],actualVal=values.slice(split.trainEnd,split.valEnd),actualTest=values.slice(split.valEnd),persist=$("persistModels").checked;
    let chronos=null,timesfm=null,chronosErr=null,timesfmErr=null;
    setStatus("Chronos-2 · VALID, TEST y FORECAST…","running");try{chronos=await runChronosBatch(contexts,{persist})}catch(e){chronosErr=e}
    setStatus("TimesFM-3 · VALID, TEST y FORECAST…","running");try{timesfm=await runTimesFMBatch(contexts,{persist})}catch(e){timesfmErr=e}
    if(!chronos&&!timesfm)throw new Error(`No se pudo ejecutar ningún modelo. Chronos: ${chronosErr?.message||"—"}. TimesFM: ${timesfmErr?.message||"—"}.`);
    const makeModel=r=>{if(!r)return null;const[v,t,f]=r.results;return{future:{q10:f.q10,q50:f.q50,q90:f.q90},metrics:{validation:metrics(actualVal,v.q50.slice(0,split.validN),values[split.trainEnd-1]),test:metrics(actualTest,t.q50.slice(0,split.testN),values[split.valEnd-1])},backend:r.backend,loadMs:r.loadMs,inferMs:r.inferMs}};
    const analysis={version:5,marketId:m.id,tokenId:m.yesToken,visible:old?oldVisible:true,analyzedAt:Date.now(),historyLastT:+pts.at(-1).t,split,chronos:makeModel(chronos),timesfm:makeModel(timesfm),errors:{chronos:chronosErr?.message||null,timesfm:timesfmErr?.message||null}};
    await persistAnalysis(m,analysis);setStatus("Análisis listo. Esta serie permanece junto con las otras series visibles.","ok");renderAll();await refreshStorage();
  }catch(e){setStatus(e.message,"error");toast(e.message,5000)}finally{state.running.delete(m.yesToken);renderAll()}
}
async function toggleAnalysis(m){state.selected=m;const a=state.analyses.get(m.yesToken);if(!a||isStale(m,a)){await analyzeMarket(m);return}a.visible=!a.visible;await persistAnalysis(m,a);renderAll()}
function isStale(m,a){const t=latestT(m);return !!(a&&t&&a.historyLastT&&t>a.historyLastT)}

function renderAll(){renderEvent();renderSelected();renderForecastPanel();renderVisibleSeries();renderChart()}
function renderEvent(){
  const e=state.event;if(!e)return;
  $("eventTitle").textContent=titleOf(e);$("eventTitle").title=e.title;
  $("eventMeta").textContent=[`Evento · ${e.markets.length} mercados`,e.volume24hr?`${fmtUSD(e.volume24hr)} en 24 h`:"",e.endDate?`Cierre: ${fmtDate(e.endDate)}`:"",e.active?"activo":e.closed?"cerrado":""].filter(Boolean).join(" · ");
  $("eventImage").src=e.image||"";imgFallback($("eventImage"));$("eventTitleLink").href=eventUrl(e);$("eventImageLink").href=eventUrl(e);
  $("marketCount").textContent=`Mercados del evento (${e.markets.length})`;$("volumeTotal").textContent=`Volumen total ${fmtUSD(e.volume)} · 24 h ${fmtUSD(e.volume24hr)}`;$("lastUpdated").textContent=`Última actualización ${new Date().toLocaleString("es-EC",{dateStyle:"medium",timeStyle:"short"})}`;
  $("horizonText").textContent=`${state.horizonDays} días (${horizonSteps()} pasos de 6 horas)`;document.querySelectorAll("[data-horizon]").forEach(b=>b.classList.toggle("active",+b.dataset.horizon===state.horizonDays));renderMarketRows();
}
function renderMarketRows(){
  if(!state.event)return;const q=state.marketFilter.trim().toLowerCase(),markets=state.event.markets.filter(m=>!q||`${titleOf(m)} ${m.title} ${m.question}`.toLowerCase().includes(q));
  $("marketRows").innerHTML=markets.map(m=>{
    const a=state.analyses.get(m.yesToken),running=state.running.has(m.yesToken),stale=isStale(m,a);let stateText="Sin analizar",stateClass="",action="Analizar",actionClass="primary";
    if(running){stateText="Analizando…";stateClass="running";action="Analizando…";actionClass=""}
    else if(a&&stale){stateText="Actualizar";stateClass="stale";action="Actualizar";actionClass="primary"}
    else if(a?.visible){stateText="✓ Visible";stateClass="visible";action="Ocultar";actionClass=""}
    else if(a){stateText="Analizado";action="Mostrar";actionClass="show"}
    const ch=m.oneDayPriceChange*100;
    return `<div class="market-row" data-id="${escapeHtml(m.id)}"><div class="market-main" role="button" tabindex="0"><img src="${m.image||state.event.image||""}" alt=""><i class="market-dot" style="background:${marketColor(m)}"></i><div class="market-title-wrap"><div class="market-title">${escapeHtml(titleOf(m))}</div><div class="market-sub">${escapeHtml(m.question||state.event.title)}</div></div></div>
      <div class="market-price">${fmtPct(m.yesPrice)}</div><div class="market-change ${Number.isFinite(ch)?(ch>=0?"pos":"neg"):""}">${Number.isFinite(ch)?fmtPP(ch):"—"}</div><div class="market-vol24">${fmtUSD(m.volume24hr)}</div><div><span class="state-pill ${stateClass}">${stateText}</span></div><button class="action-btn ${actionClass}" ${running?"disabled":""}>${action}</button></div>`;
  }).join("");
  [...$("marketRows").querySelectorAll(".market-row")].forEach(row=>{
    const m=state.event.markets.find(x=>x.id===row.dataset.id);if(!m)return;imgFallback(row.querySelector("img"));
    const select=async()=>{state.selected=m;if(!state.histories.has(m.yesToken)&&m.yesToken){try{state.histories.set(m.yesToken,await getTokenHistory(m.yesToken))}catch{}}renderAll()};
    row.querySelector(".market-main").onclick=select;row.querySelector(".market-main").onkeydown=e=>{if(e.key==="Enter")select()};row.querySelector(".action-btn").onclick=()=>toggleAnalysis(m);
  });
}
function renderSelected(){
  const m=state.selected;if(!m)return;
  $("selectedImage").src=m.image||state.event.image||"";imgFallback($("selectedImage"));$("selectedName").textContent=titleOf(m);$("selectedName").title=m.title;$("selectedSub").textContent=titleOf(state.event);$("selectedPrice").textContent=fmtPct(m.yesPrice);
  $("mCurrent").textContent=fmtPct(m.yesPrice);$("mChange24").textContent=Number.isFinite(m.oneDayPriceChange)?fmtPP(m.oneDayPriceChange*100):"—";$("mVolume24").textContent=fmtUSD(m.volume24hr);$("mVolume").textContent=fmtUSD(m.volume);$("mLiquidity").textContent=fmtUSD(m.liquidity);$("mBidAsk").textContent=`${fmtCents(m.bestBid)} / ${fmtCents(m.bestAsk)}`;$("mSpread").textContent=Number.isFinite(m.spread)?fmtCents(m.spread):"—";$("mStatus").textContent=m.active?"Activo":m.closed?"Cerrado":"—";$("mEnd").textContent=fmtDate(m.endDate||state.event.endDate);
  $("sourceLink").href=marketUrl(state.event,m);
  const rules=[m.description||state.event.description,m.resolutionSource||state.event.resolutionSource?`Fuente de resolución: ${m.resolutionSource||state.event.resolutionSource}`:""].filter(Boolean).join("\n\n");$("rulesText").textContent=rules||"Polymarket no devolvió reglas adicionales en esta respuesta. Usa “Abrir en Polymarket” para consultar los criterios oficiales.";
}
function endForecast(model,steps,current){if(!model?.future?.q50?.length)return null;const i=Math.min(steps,model.future.q50.length)-1;if(i<0)return null;return{q10:model.future.q10[i],q50:model.future.q50[i],q90:model.future.q90[i],delta:model.future.q50[i]-current}}
function renderForecastPanel(){
  const m=state.selected;if(!m)return;const a=state.analyses.get(m.yesToken),running=state.running.has(m.yesToken);$("forecastEmpty").hidden=!!a||running;$("forecastResults").hidden=!a;$("forecastHorizonLabel").textContent=`HORIZONTE: ${state.horizonDays} DÍAS (${horizonSteps()} PASOS)`;
  if(!a)return;const models=[["chronos","Chronos-2"],["timesfm","TimesFM-3"]],steps=horizonSteps();
  $("modelForecastRows").innerHTML=models.map(([key,label])=>{const model=a[key],end=endForecast(model,steps,m.yesPrice);if(!model||!end)return `<div class="model-result">${modelIcon(key)}<div><b>${label}</b><small>No disponible</small></div><div class="model-value">—</div></div>`;return `<div class="model-result">${modelIcon(key)}<div><b>${label}</b><small>${fmtPP(end.delta)} al final del horizonte</small></div><div class="model-value"><strong>${fmtPct(end.q50)}</strong><small>[${fmtPct(end.q10)}, ${fmtPct(end.q90)}]</small></div></div>`}).join("");
  $("comparePanel").hidden=!state.compareOpen;const rows=models.filter(([k])=>a[k]?.metrics?.test).map(([k,label])=>{const z=a[k].metrics.test;return `<tr><td>${label}</td><td>${z.mae.toFixed(2)} pp</td><td>${z.rmse.toFixed(2)} pp</td><td>${Number.isFinite(z.direction)?z.direction.toFixed(0)+"%":"—"}</td></tr>`}).join("");
  $("compareTable").innerHTML=`<table class="compare-table"><thead><tr><th>Modelo</th><th>MAE ↓</th><th>RMSE ↓</th><th>Direc.</th></tr></thead><tbody>${rows||"<tr><td colspan='4'>Sin métricas.</td></tr>"}</tbody></table>`;$("splitMode").textContent=a.split.mode==="7d / 7d"?"VALID 7d · TEST 7d":a.split.mode;$("historyInfo").textContent=`${a.split.n} puntos · ${Math.round(a.split.n/4)} días`;$("analysisUpdated").textContent=fmtDateTime(a.analyzedAt);
  if(isStale(m,a))setStatus("Hay datos nuevos desde este análisis. Pulsa Actualizar para recalcular.","running");else if(!running&&$("forecastStatus").classList.contains("running"))setStatus("");
}
function renderVisibleSeries(){
  if(!state.event)return;const visible=state.event.markets.filter(m=>state.analyses.get(m.yesToken)?.visible);
  $("visibleSeries").innerHTML=visible.length?visible.map(m=>`<div class="visible-series-row"><i style="background:${marketColor(m)}"></i><span>${escapeHtml(titleOf(m))}</span><button data-token="${escapeHtml(m.yesToken)}">Ocultar</button></div>`).join(""):`<div class="muted micro">Ninguna serie analizada visible.</div>`;
  [...$("visibleSeries").querySelectorAll("button")].forEach(b=>b.onclick=async()=>{const m=state.event.markets.find(x=>x.yesToken===b.dataset.token),a=state.analyses.get(b.dataset.token);if(m&&a){a.visible=false;await persistAnalysis(m,a);renderAll()}});
  $("clearVisible").disabled=!visible.length;$("chartSeriesLegend").innerHTML=visible.map(m=>`<span class="series-chip"><i style="background:${marketColor(m)}"></i>${escapeHtml(titleOf(m))}</span>`).join("");
}
function analysisForZones(){if(state.selected){const a=state.analyses.get(state.selected.yesToken);if(a?.visible)return{m:state.selected,a}}for(const m of state.event?.markets||[]){const a=state.analyses.get(m.yesToken);if(a?.visible)return{m,a}}return null}
function chartVisibility(m,i){const a=state.analyses.get(m.yesToken);if(a)return a.visible;return state.baseVisible.has(m.yesToken)&&i<8}
function hexAlpha(hex,a){const h=hex.replace("#","");return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${a})`}
function niceUpper(maxY){
  if(!Number.isFinite(maxY)||maxY<=0)return 1;
  const padded=maxY*1.08;let step=.1;
  if(maxY<=1)step=.1;else if(maxY<=5)step=.5;else if(maxY<=10)step=1;else if(maxY<=25)step=2.5;else if(maxY<=60)step=5;else step=10;
  return Math.min(100,Math.max(step,Math.ceil(padded/step)*step));
}
function renderChart(){
  if(!state.event)return;const traces=[],allY=[];
  state.event.markets.forEach((m,i)=>{
    if(!chartVisibility(m,i))return;const pts=pointsFor(m);if(!pts.length)return;const c=marketColor(m),x=pts.map(p=>new Date(p.t*1000)),y=pts.map(p=>p.p*100);allY.push(...y);
    traces.push({x,y,type:"scatter",mode:"lines",name:`${titleOf(m)} · observado`,line:{width:state.analyses.get(m.yesToken)?.visible?2.2:1.4,color:c},opacity:state.analyses.get(m.yesToken)?1:.55,hovertemplate:`${escapeHtml(titleOf(m))} · observado: %{y:.2f}%<extra></extra>`});
    const a=state.analyses.get(m.yesToken);if(!a?.visible)return;const steps=horizonSteps(),fx=futureDates(a.historyLastT,steps);
    for(const[key,label,dash,alpha]of[["chronos","Chronos-2","dash",.08],["timesfm","TimesFM-3","dot",.045]]){const model=a[key];if(!model)continue;const q10=model.future.q10.slice(0,steps),q50=model.future.q50.slice(0,steps),q90=model.future.q90.slice(0,steps);allY.push(...q10,...q50,...q90);traces.push({x:fx,y:q90,type:"scatter",mode:"lines",line:{width:0,color:c},hoverinfo:"skip",showlegend:false});traces.push({x:fx,y:q10,type:"scatter",mode:"lines",line:{width:0,color:c},fill:"tonexty",fillcolor:hexAlpha(c,alpha),hoverinfo:"skip",showlegend:false});traces.push({x:fx,y:q50,type:"scatter",mode:"lines",name:`${titleOf(m)} · ${label}`,line:{width:2,dash,color:c},hovertemplate:`${escapeHtml(titleOf(m))} · ${label}: %{y:.2f}%<extra></extra>`})}
  });
  const shapes=[],annotations=[],zone=analysisForZones();
  if(zone){
    const s=zone.a.split,obs=new Date(s.observedEndT*1000),futureEnd=new Date(s.observedEndT*1000+horizonSteps()*STEP_MS),rect=(x0,x1,color)=>shapes.push({type:"rect",xref:"x",yref:"paper",x0:new Date(x0*1000),x1:new Date(x1*1000),y0:0,y1:1,fillcolor:color,line:{width:0},layer:"below"});
    rect(s.firstT,s.validStartT,"rgba(47,107,255,.055)");rect(s.validStartT,s.testStartT,"rgba(18,183,106,.09)");rect(s.testStartT,s.observedEndT,"rgba(240,68,56,.075)");shapes.push({type:"rect",xref:"x",yref:"paper",x0:obs,x1:futureEnd,y0:0,y1:1,fillcolor:"rgba(245,183,0,.12)",line:{width:0},layer:"below"});shapes.push({type:"line",xref:"x",yref:"paper",x0:obs,x1:obs,y0:0,y1:1,line:{color:"#667085",width:1,dash:"dash"}});
    const ann=(x,text)=>annotations.push({xref:"x",yref:"paper",x:new Date(x),y:.985,text:`<b>${text}</b>`,showarrow:false,font:{size:10,color:"#344054"},yanchor:"top"});ann((s.firstT+s.validStartT)*500,s.labels.train);ann((s.validStartT+s.testStartT)*500,s.labels.valid);ann((s.testStartT+s.observedEndT)*500,s.labels.test);ann((s.observedEndT*1000+futureEnd.getTime())/2,`PRONÓSTICO · ${state.horizonDays} días`);annotations.push({xref:"x",yref:"paper",x:obs,y:-.085,text:"<b>Ahora</b>",showarrow:false,font:{size:10,color:"#344054"}});
  }
  const ymax=niceUpper(allY.length?Math.max(...allY.filter(Number.isFinite)):1);
  Plotly.react("chart",traces,{template:"plotly_white",margin:{l:55,r:16,t:8,b:52},hovermode:"x unified",showlegend:false,shapes,annotations,
    xaxis:{showgrid:true,gridcolor:"#eef1f5",zeroline:false,automargin:true,tickformatstops:[{dtickrange:[null,86400000],value:"%H:%M<br>%d %b"},{dtickrange:[86400000,604800000],value:"%d %b<br>%Y"},{dtickrange:[604800000,2678400000],value:"%d %b<br>%Y"},{dtickrange:[2678400000,7776000000],value:"%b<br>%Y"},{dtickrange:[7776000000,null],value:"%b %Y"}]},
    yaxis:{range:[0,ymax],ticksuffix:"%",showgrid:true,gridcolor:"#eef1f5",zeroline:false,automargin:true,title:null}
  },{responsive:true,displaylogo:false,locale:"es",scrollZoom:true,modeBarButtonsToRemove:["lasso2d","select2d"]});
}
function switchTab(name){document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===name));document.querySelectorAll(".tab-panel").forEach(x=>x.classList.remove("active"));$(`tab-${name}`).classList.add("active");if(name==="local")refreshStorage()}
async function refreshStorage(){
  const est=await storageEstimate();if(est)$("storageUsage").textContent=`${(est.usage/1024/1024).toFixed(1)} MB / ${(est.quota/1024/1024/1024).toFixed(1)} GB`;
  $("dataCacheStatus").textContent=`${await countStore("history")} series`;$("analysisCacheStatus").textContent=`${await countStore("analysis")} análisis`;
  try{const c=await caches.open("forecast-local-models-v1"),keys=await c.keys();$("modelCacheStatus").textContent=`${keys.length} archivos`}catch{}
  renderLocalSummary();
}
function showInfo(kind){
  const about=`<h2>Acerca de Forecast Local</h2><p>Forecast Local es una herramienta independiente para explorar y analizar localmente mercados predictivos. No está afiliada, asociada ni respaldada por Polymarket.</p><p>Utiliza datos públicos obtenidos desde las APIs públicas de Polymarket. Chronos-2, TimesFM-3 y cualquier otro modelo mostrado generan estimaciones experimentales de la trayectoria futura del precio/probabilidad implícita del mercado. Pueden ser inexactas, incompletas o quedar desactualizadas y no constituyen asesoría financiera, legal o de inversión.</p><p>Las reglas oficiales, criterios de resolución, precios y estado final son los publicados por Polymarket. <a href="https://docs.polymarket.com/" target="_blank">Documentación de Polymarket ↗</a></p>`;
  const privacy=`<h2>Privacidad y almacenamiento local</h2><p>Los históricos, búsquedas, traducciones, favoritos y análisis pueden guardarse en IndexedDB de este navegador. Los modelos ONNX pueden guardarse en Cache Storage si eliges conservarlos.</p><p>La inferencia de Chronos-2 y TimesFM-3 ocurre en tu dispositivo. La traducción al español, cuando Chrome ofrece la Translator API, también ocurre localmente. Puedes borrar los datos y modelos desde la pestaña <b>Local</b>.</p>`;
  $("dialogBody").innerHTML=kind==="privacy"?privacy:about;$("infoDialog").showModal();
}

$("brandHome").onclick=e=>{e.preventDefault();showLanding();loadLandingFeed(state.landingCategory)};
$("searchInput").addEventListener("input",e=>{const q=e.target.value;$("searchClear").hidden=!q;clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>doSearch(q),350)});
$("searchInput").addEventListener("keydown",e=>{if(e.key==="Enter"){clearTimeout(state.searchTimer);doSearch(e.target.value)}});
$("searchClear").onclick=()=>{$("searchInput").value="";$("searchResults").hidden=true;$("searchClear").hidden=true};
document.addEventListener("click",e=>{if(!e.target.closest(".search-wrap"))$("searchResults").hidden=true});
$("marketFilter").addEventListener("input",e=>{state.marketFilter=e.target.value;renderMarketRows()});
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
document.querySelectorAll("[data-horizon]").forEach(b=>b.onclick=()=>{state.horizonDays=+b.dataset.horizon;renderAll()});
$("analyzeSelected").onclick=()=>analyzeMarket(state.selected);$("compareModels").onclick=()=>{state.compareOpen=!state.compareOpen;renderForecastPanel()};
$("clearVisible").onclick=async()=>{for(const m of state.event?.markets||[]){const a=state.analyses.get(m.yesToken);if(a?.visible){a.visible=false;await persistAnalysis(m,a)}}renderAll()};
$("clearData").onclick=async()=>{await clearAllData();state.histories.clear();state.analyses.clear();toast("Datos y análisis locales borrados.");renderAll();refreshStorage();renderRecentSaved()};
$("clearModels").onclick=async()=>{await clearModelCaches();toast("Caché de modelos borrada.");refreshStorage()};
$("clearAll").onclick=async()=>{await clearEverything();await clearModelCaches();state.histories.clear();state.analyses.clear();toast("Almacenamiento local borrado.");renderAll();refreshStorage();renderRecentSaved()};
$("bookmarkEvent").onclick=toggleBookmark;
document.querySelectorAll("#categoryNav [data-category],#topicCards [data-category]").forEach(b=>b.onclick=()=>{showLanding();loadLandingFeed(b.dataset.category)});
$("refreshFeed").onclick=()=>loadLandingFeed(state.landingCategory,{force:true});
$("aboutOpen").onclick=()=>showInfo("about");$("privacyOpen").onclick=()=>showInfo("privacy");$("dialogClose").onclick=()=>$("infoDialog").close();$("infoDialog").addEventListener("click",e=>{if(e.target===$("infoDialog"))$("infoDialog").close()});

showLanding();await pruneExpired();await refreshStorage();await renderRecentSaved();await loadLandingFeed("");
