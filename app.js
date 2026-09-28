import {searchPolymarket,loadSearchItem,getTokenHistory,previewSearchItem,getLandingEvents} from "./api.js?v=0.6.0";
import {clearAllData,clearEverything,pruneExpired,storageEstimate,countStore,getItem,putItem,deleteItem,listItems} from "./db.js?v=0.6.0";
import {runChronosBatch,runTimesFMBatch,clearModelCaches} from "./model-bridge.js?v=0.6.0";
import {toSpanish,queryToEnglish} from "./i18n.js?v=0.6.0";

const $=id=>document.getElementById(id);
const COLORS=["#155eef","#f04438","#f5b700","#12b76a","#7a5af8","#ee46bc","#6172f3","#f79009","#0ba5ec","#667085"];
const CATEGORY_NAMES={"":"Destacados","politics":"Política","sports":"Deportes","crypto":"Cripto","finance":"Finanzas","geopolitics":"Geopolítica","tech":"Tecnología","culture":"Cultura","weather":"Clima"};
const HIGHLIGHT_CATEGORIES=["politics","sports","crypto","finance","geopolitics","tech","culture","weather"];
const CONTEXT_N=128,FORECAST_N=64,DAY_MS=86400000;
const RESOLUTION_CANDIDATES_MIN=[10,15,30,60,120,180,240,360,480,720,1440];
const state={event:null,selected:null,histories:new Map(),analyses:new Map(),running:new Set(),baseVisible:new Set(),horizonDays:7,chartView:"forecast",searchTimer:null,marketFilter:"",compareOpen:false,landingCategory:"",landingEvents:[]};

function showLanding(){$("landing").hidden=false;$("workspace").hidden=true;window.scrollTo({top:0,behavior:"instant"});renderLocalSummary();renderRecentSaved()}
function showWorkspace(){$("landing").hidden=true;$("workspace").hidden=false;window.scrollTo({top:0,behavior:"instant"})}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function fmtPct(x){if(!Number.isFinite(+x))return"—";if(+x<1&&+x>0)return"<1%";return`${(+x).toFixed(+x>=10?1:2)}%`}
function fmtPP(x){if(!Number.isFinite(+x))return"—";return`${x>=0?"+":""}${(+x).toFixed(Math.abs(x)<1?2:1)} pp`}
function fmtUSD(x){const n=Number(x);if(!Number.isFinite(n))return"—";return new Intl.NumberFormat("es-EC",{style:"currency",currency:"USD",notation:n>=1e6?"compact":"standard",maximumFractionDigits:n>=1e6?2:0}).format(n)}
function fmtDate(x){if(!x)return"—";const d=new Date(x);return Number.isNaN(d.getTime())?"—":d.toLocaleDateString("es-EC",{year:"numeric",month:"short",day:"numeric"})}
function fmtDateTime(x){if(!x)return"—";const d=new Date(x);return Number.isNaN(d.getTime())?"—":d.toLocaleString("es-EC",{dateStyle:"medium",timeStyle:"short"})}
function fmtCents(x){return Number.isFinite(+x)?`${(+x*100).toFixed(1)}¢`:"—"}
function fmtDuration(ms){
  if(!Number.isFinite(ms)||ms<=0)return"—";
  const min=ms/60000;if(min<60)return`${min.toFixed(min<20?1:0)} min`;
  const h=min/60;if(h<48)return`${h.toFixed(h<10?1:0)} h`;
  const d=h/24;return`${d.toFixed(d<10?1:0)} días`;
}
function toast(msg,ms=2800){const el=$("toast");el.textContent=msg;el.hidden=false;clearTimeout(el._t);el._t=setTimeout(()=>el.hidden=true,ms)}
function globalStatus(msg,type=""){const el=$("openStatus");if(!msg){el.hidden=true;return}el.textContent=msg;el.hidden=false;el.className=`open-status ${type}`.trim()}
function chartStatus(msg,type=""){const el=$("chartStatus");if(!msg){el.hidden=true;return}el.textContent=msg;el.hidden=false;el.className=`chart-status ${type}`.trim()}
function setStatus(text,type="running"){const el=$("forecastStatus");if(!text){el.hidden=true;return}el.hidden=false;el.className=`panel status-panel ${type}`;el.textContent=text}
function imgFallback(img){img.onerror=()=>{img.onerror=null;img.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='100%' height='100%' fill='#f2f4f7'/><path d='M25 72 L60 34 L95 72' fill='none' stroke='#98a2b3' stroke-width='7'/></svg>`)}}
function titleOf(x){return x?.displayTitle||x?.title||x?.question||"—"}
function marketColor(m){const i=Math.max(0,state.event?.markets?.findIndex(x=>x.id===m.id)??0);return COLORS[i%COLORS.length]}
function analysisKey(m){return`${state.event?.id||state.event?.slug||"event"}:${m.yesToken||m.id}:v6`}
function rawPointsFor(m){return(state.histories.get(m.yesToken)?.raw||[]).map(p=>({t:+p.t,p:+p.p})).filter(p=>Number.isFinite(p.t)&&Number.isFinite(p.p)).sort((a,b)=>a.t-b.t)}
function latestT(m){const p=rawPointsFor(m);return p.length?p.at(-1).t:null}
function eventUrl(e){return e?.slug?`https://polymarket.com/es/event/${encodeURIComponent(e.slug)}`:"https://polymarket.com/es"}
function marketUrl(e,m){return e?.slug&&m?.slug?`${eventUrl(e)}/${encodeURIComponent(m.slug)}`:eventUrl(e)}
function modelIcon(kind){if(kind==="chronos")return`<span class="model-glyph"><svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3M9 12h6M12 9v6"/></svg></span>`;return`<span class="model-glyph"><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 7h8M7 8l4 8M17 8l-4 8"/></svg></span>`}
function eventItem(ev){return{kind:"event",id:ev.id,slug:ev.slug,title:ev.title,image:ev.image,raw:ev.raw||null}}

function median(xs){
  const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return NaN;
  const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function chooseResolutionMs(raw){
  if(raw.length<2)return 60*60*1000;
  const duration=(raw.at(-1).t-raw[0].t)*1000;
  const ideal=Math.min(DAY_MS,duration/(CONTEXT_N+FORECAST_N-1));
  const candidates=RESOLUTION_CANDIDATES_MIN.map(x=>x*60000);
  let chosen=candidates[0];
  for(const c of candidates){if(c<=ideal)chosen=c;else break}
  return Math.min(DAY_MS,chosen);
}
function regularizeMedian(raw,dtMs){
  if(!raw.length)return[];
  const buckets=new Map(),lastBucket=Math.floor(raw.at(-1).t*1000/dtMs)*dtMs;
  for(const p of raw){
    const b=Math.floor(p.t*1000/dtMs)*dtMs;
    if(!buckets.has(b))buckets.set(b,[]);
    buckets.get(b).push(p.p*100);
  }
  const firstBucket=Math.floor(raw[0].t*1000/dtMs)*dtMs,out=[];
  let last=raw[0].p*100;
  for(let t=firstBucket;t<=lastBucket;t+=dtMs){
    const vals=buckets.get(t);
    if(vals?.length){
      last=t===lastBucket?vals.at(-1):median(vals);
    }
    out.push({t:t/1000,p:last,observed:!!vals?.length});
  }
  return out;
}
function buildDesign(m){
  const raw=rawPointsFor(m);if(raw.length<2)throw new Error("No hay suficiente historia para formar una serie temporal.");
  const dtMs=chooseResolutionMs(raw),series=regularizeMedian(raw,dtMs),n=series.length;
  const finalContext=series.slice(Math.max(0,n-CONTEXT_N));
  let backContext=[],test=[],backtestKind="sin prueba",testN=0;
  if(n>CONTEXT_N){
    testN=Math.min(FORECAST_N,n-CONTEXT_N);
    const start=n-(CONTEXT_N+testN);
    backContext=series.slice(start,start+CONTEXT_N);
    test=series.slice(start+CONTEXT_N,start+CONTEXT_N+testN);
    backtestKind=testN===FORECAST_N?"completa":"parcial";
  }
  const maxForecastMs=FORECAST_N*dtMs;
  return{raw,series,dtMs,n,finalContext,backContext,test,testN,backtestKind,maxForecastMs,
    historyMs:(raw.at(-1).t-raw[0].t)*1000,
    finalContextStartT:finalContext[0]?.t??raw[0].t,
    observedEndT:series.at(-1)?.t??raw.at(-1).t,
    backContextStartT:backContext[0]?.t??null,
    testStartT:test[0]?.t??null,
    testEndT:test.at(-1)?.t??null
  };
}
function metrics(actual,pred,q10,q90){
  const n=Math.min(actual.length,pred.length,q10.length,q90.length);if(!n)return{mae:NaN,rmse:NaN,coverage:NaN,width:NaN,n:0};
  let ae=0,se=0,inside=0,width=0;
  for(let i=0;i<n;i++){const d=pred[i]-actual[i];ae+=Math.abs(d);se+=d*d;if(actual[i]>=q10[i]&&actual[i]<=q90[i])inside++;width+=q90[i]-q10[i]}
  return{mae:ae/n,rmse:Math.sqrt(se/n),coverage:100*inside/n,width:width/n,n};
}
function stepsForAnalysis(a,requestedDays=state.horizonDays){
  const maxDays=a.design.maxForecastMs/DAY_MS;
  if(maxDays<7)return FORECAST_N;
  const wanted=Math.ceil(requestedDays*DAY_MS/a.design.dtMs);
  return Math.min(FORECAST_N,wanted);
}
function displayedHorizonDays(a){
  const steps=stepsForAnalysis(a),days=steps*a.design.dtMs/DAY_MS;
  return days;
}
function forecastDates(a,n){
  let ms=a.design.observedEndT*1000;
  return Array.from({length:n},()=>new Date(ms+=a.design.dtMs));
}
function backtestDates(a){return a.design.test.map(x=>new Date(x.t*1000))}
function isStale(m,a){const t=latestT(m);return!!(a&&t&&a.historyLastT&&t>a.historyLastT)}

async function maybeTranslateEntity(entity){if(!entity?.title)return;try{const tr=await toSpanish(entity.title);if(tr&&tr!==entity.title){entity.displayTitle=tr;renderAll()}}catch{}}
async function translateEventInBackground(){
  const e=state.event;if(!e)return;try{const tr=await toSpanish(e.title);if(tr&&tr!==e.title){e.displayTitle=tr;renderAll()}}catch{}
  for(const m of e.markets.slice(0,40)){try{const tr=await toSpanish(m.title);if(tr&&tr!==m.title){m.displayTitle=tr;renderMarketRows();renderSelected();renderVisibleSeries()}}catch{}}
}
async function doSearch(q){
  const box=$("searchResults");if(q.trim().length<2){box.hidden=true;return}
  box.hidden=false;box.innerHTML=`<div class="search-empty">Buscando…</div>`;
  try{
    let alt=q;try{alt=await queryToEnglish(q)}catch{}
    const items=await searchPolymarket(q,{alternateQueries:alt&&alt!==q?[alt]:[]});
    if(!items.length){box.innerHTML=`<div class="search-empty">Sin resultados.</div>`;return}
    box.innerHTML=items.map((x,i)=>`<div class="search-result" data-i="${i}" role="button" tabindex="0"><img src="${x.image||""}" alt=""><div><b data-title>${escapeHtml(x.title)}</b><small>${escapeHtml([x.category,x.volume24hr?`${fmtUSD(x.volume24hr)} en 24 h`:"",x.marketCount?`${x.marketCount} mercados`:""].filter(Boolean).join(" · "))}</small></div><div class="result-meta"><span class="result-kind">${x.kind==="event"?"evento":"mercado"}</span><br>${x.endDate?`cierra ${fmtDate(x.endDate)}`:""}</div></div>`).join("");
    [...box.querySelectorAll(".search-result")].forEach(el=>{imgFallback(el.querySelector("img"));const activate=()=>openItem(items[+el.dataset.i]);el.onclick=activate;el.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();activate()}}});
    items.forEach(async(x,i)=>{try{const tr=await toSpanish(x.title);if(tr!==x.title){const el=box.querySelector(`[data-i="${i}"] [data-title]`);if(el)el.textContent=tr}}catch{}})
  }catch(e){box.innerHTML=`<div class="search-empty">Error de API: ${escapeHtml(e.message)}</div>`}
}

async function loadHighlights(){
  $("feedTitle").textContent="Destacados por categoría";$("feedSubtitle").textContent="El evento activo con mayor volumen 24 h de cada categoría.";$("feedStatus").hidden=false;$("feedStatus").textContent="Cargando categorías…";$("eventCards").innerHTML="";
  const rows=await Promise.all(HIGHLIGHT_CATEGORIES.map(async slug=>{
    try{const e=(await getLandingEvents({categorySlug:slug,limit:1}))[0];return e?{...e,_categorySlug:slug,_categoryName:CATEGORY_NAMES[slug]}:null}catch{return null}
  }));
  state.landingEvents=rows.filter(Boolean);renderLandingEvents();$("feedStatus").hidden=true;
  state.landingEvents.forEach(maybeTranslateEntity);
}
async function loadLandingFeed(category=state.landingCategory){
  state.landingCategory=category;
  document.querySelectorAll("#categoryNav [data-category]").forEach(b=>b.classList.toggle("active",b.dataset.category===category));
  if(!category){await loadHighlights();return}
  $("feedTitle").textContent=CATEGORY_NAMES[category];$("feedSubtitle").textContent=`Eventos activos de ${CATEGORY_NAMES[category].toLowerCase()}, ordenados por volumen 24 h.`;$("feedStatus").hidden=false;$("feedStatus").textContent="Cargando mercados…";$("eventCards").innerHTML="";
  try{state.landingEvents=await getLandingEvents({categorySlug:category,limit:12});state.landingEvents.forEach(e=>{e._categorySlug=category;e._categoryName=CATEGORY_NAMES[category]});renderLandingEvents();$("feedStatus").hidden=true;state.landingEvents.forEach(maybeTranslateEntity)}
  catch(e){$("feedStatus").textContent=`No pude cargar esta categoría: ${e.message}`}
}
function renderLandingEvents(){
  $("eventCards").innerHTML=state.landingEvents.map((e,i)=>{
    const top=[...e.markets].sort((a,b)=>b.yesPrice-a.yesPrice).slice(0,3);
    const cat=e._categoryName||(e.tags||[]).find(t=>t?.label||t?.name||t?.slug)?.label||"Mercado";
    return`<article class="event-card" data-i="${i}" tabindex="0"><div class="event-card-image"><img src="${e.image||""}" alt=""><span class="category-badge">${escapeHtml(cat)}</span><span class="status-chip">Activo</span>${e.endDate?`<span class="end-chip">Cierra ${fmtDate(e.endDate)}</span>`:""}</div><div class="event-card-body"><div class="event-category">${escapeHtml(cat)}</div><h3>${escapeHtml(titleOf(e))}</h3><div class="event-stats"><b>${fmtUSD(e.volume24hr)}</b><span>Volumen 24 h</span><span>·</span><span>${e.markets.length} mercados</span></div><div class="top-outcomes">${top.map((m,j)=>`<div class="top-outcome"><i style="background:${COLORS[j%COLORS.length]}"></i><span>${escapeHtml(titleOf(m))}</span><b>${fmtPct(m.yesPrice)}</b></div>`).join("")}</div></div></article>`
  }).join("");
  [...$("eventCards").querySelectorAll(".event-card")].forEach(el=>{const e=state.landingEvents[+el.dataset.i];imgFallback(el.querySelector("img"));const open=()=>openItem(eventItem(e));el.onclick=open;el.onkeydown=x=>{if(x.key==="Enter")open()}})
}
async function renderLocalSummary(){$("homeHistoryCount").textContent=await countStore("history");$("homeAnalysisCount").textContent=await countStore("analysis");try{const c=await caches.open("forecast-local-models-v1"),keys=await c.keys();$("homeModelCount").textContent=keys.length}catch{$("homeModelCount").textContent="—"}const est=await storageEstimate();$("homeStorageUsage").textContent=est?`${(est.usage/1024/1024).toFixed(0)} MB`:"—"}
async function renderRecentSaved(){const[saved,recent]=await Promise.all([listItems("bookmarks",{limit:5}),listItems("recent",{limit:8})]);const map=new Map();for(const r of[...saved,...recent]){const v=r.value;if(v?.id&&!map.has(v.id))map.set(v.id,{...v,saved:saved.some(s=>s.value?.id===v.id)})}const rows=[...map.values()].slice(0,5);$("recentCards").innerHTML=rows.length?rows.map((v,i)=>`<article class="recent-card" data-i="${i}"><img src="${v.image||""}" alt=""><div><b>${escapeHtml(v.displayTitle||v.title)}</b><small>${v.saved?"Guardado":"Visto recientemente"}</small></div><span class="star">${v.saved?"★":"›"}</span></article>`).join(""):`<div class="recent-empty">Todavía no hay mercados guardados o recientes en este navegador.</div>`;[...$("recentCards").querySelectorAll(".recent-card")].forEach(el=>{const v=rows[+el.dataset.i];imgFallback(el.querySelector("img"));el.onclick=()=>openItem({kind:"event",id:v.id,slug:v.slug,title:v.title,image:v.image,raw:null})})}

async function loadPersistedAnalyses(){state.analyses.clear();if(!state.event)return;await Promise.all(state.event.markets.map(async m=>{try{const row=await getItem("analysis",analysisKey(m));if(row?.value)state.analyses.set(m.yesToken,row.value)}catch{}}))}
async function persistAnalysis(m,a){state.analyses.set(m.yesToken,a);await putItem("analysis",analysisKey(m),a)}
async function rememberEvent(){if(state.event)await putItem("recent",state.event.id,{id:state.event.id,slug:state.event.slug,title:state.event.title,displayTitle:state.event.displayTitle||"",image:state.event.image})}
async function bookmarkState(){return state.event?!!(await getItem("bookmarks",state.event.id)):false}
async function toggleBookmark(){if(!state.event)return;const old=await getItem("bookmarks",state.event.id);if(old){await deleteItem("bookmarks",state.event.id);toast("Quitado de guardados.")}else{await putItem("bookmarks",state.event.id,{id:state.event.id,slug:state.event.slug,title:state.event.title,displayTitle:state.event.displayTitle||"",image:state.event.image});toast("Guardado en este navegador.")}renderBookmark();renderRecentSaved()}
async function renderBookmark(){if(!state.event)return;const saved=await bookmarkState();$("bookmarkEvent").classList.toggle("saved",saved);$("bookmarkEvent").textContent=saved?"★":"☆"}

async function openItem(item){
  $("searchResults").hidden=true;$("searchInput").blur();globalStatus("Abriendo mercado…");
  state.histories.clear();state.analyses.clear();state.running.clear();state.baseVisible.clear();state.compareOpen=false;state.chartView="forecast";
  const preview=previewSearchItem(item);
  if(preview){state.event=preview;state.event.markets=[...(preview.markets||[])].sort((a,b)=>b.yesPrice-a.yesPrice);state.selected=state.event.markets[0]||null;state.event.markets.slice(0,4).forEach(m=>state.baseVisible.add(m.yesToken));showWorkspace();renderAll();chartStatus("Cargando metadata e históricos…")}
  try{
    const ev=await loadSearchItem(item);state.event=ev;state.event.markets=[...(ev.markets||[])].sort((a,b)=>b.yesPrice-a.yesPrice);state.selected=state.event.markets.find(m=>m.id===state.selected?.id)||state.event.markets[0]||null;if(!state.baseVisible.size)state.event.markets.slice(0,4).forEach(m=>state.baseVisible.add(m.yesToken));
    await loadPersistedAnalyses();showWorkspace();renderAll();rememberEvent();renderBookmark();translateEventInBackground();
    const wanted=new Map();[state.selected,...state.event.markets.slice(0,4)].filter(Boolean).forEach(m=>wanted.set(m.yesToken,m));for(const m of state.event.markets){const a=state.analyses.get(m.yesToken);if(a?.visible)wanted.set(m.yesToken,m)}
    let done=0;const list=[...wanted.values()].filter(m=>m.yesToken);chartStatus(`Descargando históricos 0/${list.length}…`);
    await Promise.allSettled(list.map(async m=>{try{state.histories.set(m.yesToken,await getTokenHistory(m.yesToken))}finally{done++;chartStatus(`Descargando históricos ${done}/${list.length}…`);renderAll()}}));
    renderAll();chartStatus("");globalStatus("Mercado cargado","ok");setTimeout(()=>globalStatus(""),1200);await refreshStorage()
  }catch(e){console.error(e);globalStatus(`Error: ${e.message}`,"error");chartStatus(`No pude completar la carga: ${e.message}`,"error");toast(e.message,5000)}
}
async function ensureHistory(m){if(!state.histories.has(m.yesToken))state.histories.set(m.yesToken,await getTokenHistory(m.yesToken));return state.histories.get(m.yesToken)}
async function analyzeMarket(m){
  if(!m||state.running.has(m.yesToken))return;state.selected=m;state.running.add(m.yesToken);renderAll();switchTab("forecast");const old=state.analyses.get(m.yesToken),oldVisible=old?.visible!==false;
  try{
    setStatus(`Preparando ${titleOf(m)}…`,"running");await ensureHistory(m);const d=buildDesign(m),contexts=[],hasBack=d.backContext.length===CONTEXT_N&&d.testN>0;if(hasBack)contexts.push(d.backContext.map(x=>x.p));contexts.push(d.finalContext.map(x=>x.p));const persist=$("persistModels").checked;
    setStatus(`Resolución ${fmtDuration(d.dtMs)} · Chronos-2…`,"running");let chronos=null,timesfm=null,chronosErr=null,timesfmErr=null;try{chronos=await runChronosBatch(contexts,{persist})}catch(e){chronosErr=e}
    setStatus(`Resolución ${fmtDuration(d.dtMs)} · TimesFM-3…`,"running");try{timesfm=await runTimesFMBatch(contexts,{persist})}catch(e){timesfmErr=e}
    if(!chronos&&!timesfm)throw new Error(`No se pudo ejecutar ningún modelo. Chronos: ${chronosErr?.message||"—"}. TimesFM: ${timesfmErr?.message||"—"}.`);
    const actual=d.test.map(x=>x.p);
    const makeModel=r=>{
      if(!r)return null;const back=hasBack?r.results[0]:null,final=r.results[hasBack?1:0];
      return{future:{q10:final.q10,q50:final.q50,q90:final.q90},backtest:back?{q10:back.q10.slice(0,d.testN),q50:back.q50.slice(0,d.testN),q90:back.q90.slice(0,d.testN)}:null,
        metrics:back?metrics(actual,back.q50.slice(0,d.testN),back.q10.slice(0,d.testN),back.q90.slice(0,d.testN)):null,backend:r.backend,loadMs:r.loadMs,inferMs:r.inferMs};
    };
    const analysis={version:6,marketId:m.id,tokenId:m.yesToken,visible:old?oldVisible:true,analyzedAt:Date.now(),historyLastT:+d.raw.at(-1).t,
      design:{dtMs:d.dtMs,n:d.n,testN:d.testN,backtestKind:d.backtestKind,maxForecastMs:d.maxForecastMs,historyMs:d.historyMs,finalContextStartT:d.finalContextStartT,observedEndT:d.observedEndT,backContextStartT:d.backContextStartT,testStartT:d.testStartT,testEndT:d.testEndT,
        finalContextN:d.finalContext.length,backContextN:d.backContext.length,test:d.test},
      chronos:makeModel(chronos),timesfm:makeModel(timesfm),errors:{chronos:chronosErr?.message||null,timesfm:timesfmErr?.message||null}};
    await persistAnalysis(m,analysis);setStatus(`Análisis listo · contexto ${d.finalContext.length}/128 · prueba ${d.testN}/64.`,"ok");renderAll();await refreshStorage()
  }catch(e){setStatus(e.message,"error");toast(e.message,5000)}finally{state.running.delete(m.yesToken);renderAll()}
}
async function toggleAnalysis(m){state.selected=m;const a=state.analyses.get(m.yesToken);if(!a||isStale(m,a)){await analyzeMarket(m);return}a.visible=!a.visible;await persistAnalysis(m,a);renderAll()}

function renderAll(){renderEvent();renderSelected();renderForecastPanel();renderVisibleSeries();renderChart()}
function renderEvent(){
  const e=state.event;if(!e)return;$("eventTitle").textContent=titleOf(e);$("eventTitle").title=e.title;$("eventMeta").textContent=[`Evento · ${e.markets.length} mercados`,e.volume24hr?`${fmtUSD(e.volume24hr)} en 24 h`:"",e.endDate?`Cierre: ${fmtDate(e.endDate)}`:"",e.active?"activo":e.closed?"cerrado":""].filter(Boolean).join(" · ");$("eventImage").src=e.image||"";imgFallback($("eventImage"));$("eventTitleLink").href=eventUrl(e);$("eventImageLink").href=eventUrl(e);$("marketCount").textContent=`Mercados del evento (${e.markets.length})`;$("volumeTotal").textContent=`Volumen total ${fmtUSD(e.volume)} · 24 h ${fmtUSD(e.volume24hr)}`;$("lastUpdated").textContent=`Última actualización ${new Date().toLocaleString("es-EC",{dateStyle:"medium",timeStyle:"short"})}`;renderHorizonControls();renderMarketRows()
}
function renderHorizonControls(){
  const a=state.selected?state.analyses.get(state.selected.yesToken):null;let maxDays=a?a.design.maxForecastMs/DAY_MS:null;
  if(a&&maxDays<7)state.horizonDays=7;if(a&&state.horizonDays===16&&maxDays<16)state.horizonDays=7;
  document.querySelectorAll("[data-horizon]").forEach(b=>{const d=+b.dataset.horizon;b.classList.toggle("active",d===state.horizonDays);b.disabled=!!a&&maxDays<d});
  $("horizonText").textContent=a?(maxDays>=7?`${state.horizonDays} días · máximo ${maxDays.toFixed(maxDays<10?1:0)} días`:`máximo disponible ${fmtDuration(a.design.maxForecastMs)}`):`${state.horizonDays} días`;
}
function renderMarketRows(){
  if(!state.event)return;const q=state.marketFilter.trim().toLowerCase(),markets=state.event.markets.filter(m=>!q||`${titleOf(m)} ${m.title} ${m.question}`.toLowerCase().includes(q));
  $("marketRows").innerHTML=markets.map(m=>{const a=state.analyses.get(m.yesToken),running=state.running.has(m.yesToken),stale=isStale(m,a);let stateText="Sin analizar",stateClass="",action="Analizar",actionClass="primary";if(running){stateText="Analizando…";stateClass="running";action="Analizando…"}else if(a&&stale){stateText="Actualizar";stateClass="stale";action="Actualizar";actionClass="primary"}else if(a?.visible){stateText="✓ Visible";stateClass="visible";action="Ocultar";actionClass=""}else if(a){stateText="Analizado";action="Mostrar";actionClass="show"}const ch=m.oneDayPriceChange*100;return`<div class="market-row" data-id="${escapeHtml(m.id)}"><div class="market-main" role="button" tabindex="0"><img src="${m.image||state.event.image||""}" alt=""><i class="market-dot" style="background:${marketColor(m)}"></i><div class="market-title-wrap"><div class="market-title">${escapeHtml(titleOf(m))}</div><div class="market-sub">${escapeHtml(m.question||state.event.title)}</div></div></div><div class="market-price">${fmtPct(m.yesPrice)}</div><div class="market-change ${Number.isFinite(ch)?(ch>=0?"pos":"neg"):""}">${Number.isFinite(ch)?fmtPP(ch):"—"}</div><div class="market-vol24">${fmtUSD(m.volume24hr)}</div><div><span class="state-pill ${stateClass}">${stateText}</span></div><button class="action-btn ${actionClass}" ${running?"disabled":""}>${action}</button></div>`}).join("");
  [...$("marketRows").querySelectorAll(".market-row")].forEach(row=>{const m=state.event.markets.find(x=>x.id===row.dataset.id);if(!m)return;imgFallback(row.querySelector("img"));const select=async()=>{state.selected=m;if(!state.histories.has(m.yesToken)&&m.yesToken){try{state.histories.set(m.yesToken,await getTokenHistory(m.yesToken))}catch{}}renderAll()};row.querySelector(".market-main").onclick=select;row.querySelector(".market-main").onkeydown=e=>{if(e.key==="Enter")select()};row.querySelector(".action-btn").onclick=()=>toggleAnalysis(m)})
}
function renderSelected(){
  const m=state.selected;if(!m)return;$("selectedImage").src=m.image||state.event.image||"";imgFallback($("selectedImage"));$("selectedName").textContent=titleOf(m);$("selectedName").title=m.title;$("selectedSub").textContent=titleOf(state.event);$("selectedPrice").textContent=fmtPct(m.yesPrice);$("mCurrent").textContent=fmtPct(m.yesPrice);$("mChange24").textContent=Number.isFinite(m.oneDayPriceChange)?fmtPP(m.oneDayPriceChange*100):"—";$("mVolume24").textContent=fmtUSD(m.volume24hr);$("mVolume").textContent=fmtUSD(m.volume);$("mLiquidity").textContent=fmtUSD(m.liquidity);$("mBidAsk").textContent=`${fmtCents(m.bestBid)} / ${fmtCents(m.bestAsk)}`;$("mSpread").textContent=Number.isFinite(m.spread)?fmtCents(m.spread):"—";$("mStatus").textContent=m.active?"Activo":m.closed?"Cerrado":"—";$("mEnd").textContent=fmtDate(m.endDate||state.event.endDate);$("sourceLink").href=marketUrl(state.event,m);const rules=[m.description||state.event.description,m.resolutionSource||state.event.resolutionSource?`Fuente de resolución: ${m.resolutionSource||state.event.resolutionSource}`:""].filter(Boolean).join("\n\n");$("rulesText").textContent=rules||"Polymarket no devolvió reglas adicionales en esta respuesta. Usa “Abrir en Polymarket” para consultar los criterios oficiales."
}
function endForecast(model,steps,current){if(!model?.future?.q50?.length)return null;const i=Math.min(steps,model.future.q50.length)-1;if(i<0)return null;return{q10:model.future.q10[i],q50:model.future.q50[i],q90:model.future.q90[i],delta:model.future.q50[i]-current}}
function renderForecastPanel(){
  const m=state.selected;if(!m)return;const a=state.analyses.get(m.yesToken),running=state.running.has(m.yesToken);$("forecastEmpty").hidden=!!a||running;$("forecastResults").hidden=!a;if(!a)return;
  const maxDays=a.design.maxForecastMs/DAY_MS,steps=stepsForAnalysis(a),shownDays=steps*a.design.dtMs/DAY_MS;$("forecastHorizonLabel").textContent=`PRONÓSTICO MOSTRADO: ${shownDays<1?fmtDuration(shownDays*DAY_MS):shownDays.toFixed(shownDays<10?1:0)+" DÍAS"}`;$("resolutionInfo").textContent=fmtDuration(a.design.dtMs);$("contextInfo").textContent=`${a.design.finalContextN}/128 puntos · ${fmtDuration((a.design.finalContextN-1)*a.design.dtMs)}`;$("backtestInfo").textContent=a.design.testN?`${a.design.backtestKind} · 128 → ${a.design.testN}/64`:"sin prueba suficiente";$("maxHorizonInfo").textContent=fmtDuration(a.design.maxForecastMs);$("historyInfo").textContent=fmtDuration(a.design.historyMs);$("analysisUpdated").textContent=fmtDateTime(a.analyzedAt);
  const models=[["chronos","Chronos-2"],["timesfm","TimesFM-3"]];$("modelForecastRows").innerHTML=models.map(([key,label])=>{const model=a[key],end=endForecast(model,steps,m.yesPrice);if(!model||!end)return`<div class="model-result">${modelIcon(key)}<div><b>${label}</b><small>No disponible</small></div><div class="model-value">—</div></div>`;return`<div class="model-result">${modelIcon(key)}<div><b>${label}</b><small>${fmtPP(end.delta)} al final del horizonte</small></div><div class="model-value"><strong>${fmtPct(end.q50)}</strong><small>[${fmtPct(end.q10)}, ${fmtPct(end.q90)}]</small></div></div>`}).join("");
  $("comparePanel").hidden=!state.compareOpen;const rows=models.filter(([k])=>a[k]?.metrics).map(([k,label])=>{const z=a[k].metrics;return`<tr><td>${label}</td><td>${z.mae.toFixed(2)} pp</td><td>${z.rmse.toFixed(2)} pp</td><td>${z.coverage.toFixed(0)}%</td><td>${z.width.toFixed(2)} pp</td></tr>`}).join("");$("compareTable").innerHTML=`<table class="compare-table"><thead><tr><th>Modelo</th><th>MAE ↓</th><th>RMSE ↓</th><th>Cobertura</th><th>Amplitud</th></tr></thead><tbody>${rows||"<tr><td colspan='5'>No hay prueba retrospectiva suficiente.</td></tr>"}</tbody></table>`;
  if(isStale(m,a))setStatus("Hay datos nuevos desde este análisis. Pulsa Actualizar para recalcular.","running");else if(!running&&$("forecastStatus").classList.contains("running"))setStatus("")
}
function renderVisibleSeries(){
  if(!state.event)return;const visible=state.event.markets.filter(m=>state.analyses.get(m.yesToken)?.visible);$("visibleSeries").innerHTML=visible.length?visible.map(m=>`<div class="visible-series-row"><i style="background:${marketColor(m)}"></i><span>${escapeHtml(titleOf(m))}</span><button data-token="${escapeHtml(m.yesToken)}">Ocultar</button></div>`).join(""):`<div class="muted micro">Ninguna serie analizada visible.</div>`;[...$("visibleSeries").querySelectorAll("button")].forEach(b=>b.onclick=async()=>{const m=state.event.markets.find(x=>x.yesToken===b.dataset.token),a=state.analyses.get(b.dataset.token);if(m&&a){a.visible=false;await persistAnalysis(m,a);renderAll()}});$("clearVisible").disabled=!visible.length;$("chartSeriesLegend").innerHTML=visible.map(m=>`<span class="series-chip"><i style="background:${marketColor(m)}"></i>${escapeHtml(titleOf(m))}</span>`).join("")
}
function chartVisibility(m,i){const a=state.analyses.get(m.yesToken);if(a)return a.visible;return state.baseVisible.has(m.yesToken)&&i<8}
function hexAlpha(hex,a){const h=hex.replace("#","");return`rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${a})`}
function niceUpper(maxY){if(!Number.isFinite(maxY)||maxY<=0)return1;const padded=maxY*1.08;let step=.1;if(maxY<=1)step=.1;else if(maxY<=5)step=.5;else if(maxY<=10)step=1;else if(maxY<=25)step=2.5;else if(maxY<=60)step=5;else step=10;return Math.min(100,Math.max(step,Math.ceil(padded/step)*step))}
function selectedAnalysis(){const m=state.selected,a=m?state.analyses.get(m.yesToken):null;return a?{m,a}:null}
function renderChart(){
  if(!state.event)return;const traces=[],allY=[];
  state.event.markets.forEach((m,i)=>{
    if(!chartVisibility(m,i))return;const raw=rawPointsFor(m);if(!raw.length)return;const c=marketColor(m),x=raw.map(p=>new Date(p.t*1000)),y=raw.map(p=>p.p*100);allY.push(...y);traces.push({x,y,type:"scatter",mode:"lines",name:`${titleOf(m)} · observado`,line:{width:state.analyses.get(m.yesToken)?.visible?2.1:1.3,color:c},opacity:state.analyses.get(m.yesToken)?1:.55,hovertemplate:`${escapeHtml(titleOf(m))} · observado: %{y:.2f}%<extra></extra>`});
    const a=state.analyses.get(m.yesToken);if(!a?.visible||state.chartView!=="forecast")return;const steps=stepsForAnalysis(a),fx=forecastDates(a,steps);
    for(const[key,label,dash,alpha]of[["chronos","Chronos-2","dash",.08],["timesfm","TimesFM-3","dot",.045]]){const model=a[key];if(!model)continue;const q10=model.future.q10.slice(0,steps),q50=model.future.q50.slice(0,steps),q90=model.future.q90.slice(0,steps);allY.push(...q10,...q50,...q90);traces.push({x:fx,y:q90,type:"scatter",mode:"lines",line:{width:0,color:c},hoverinfo:"skip",showlegend:false});traces.push({x:fx,y:q10,type:"scatter",mode:"lines",line:{width:0,color:c},fill:"tonexty",fillcolor:hexAlpha(c,alpha),hoverinfo:"skip",showlegend:false});traces.push({x:fx,y:q50,type:"scatter",mode:"lines",name:`${titleOf(m)} · ${label}`,line:{width:2,dash,color:c},hovertemplate:`${escapeHtml(titleOf(m))} · ${label}: %{y:.2f}%<extra></extra>`})}
  });
  const sel=selectedAnalysis();
  if(sel&&state.chartView==="backtest"&&sel.a.design.testN){
    const a=sel.a,m=sel.m,c=marketColor(m),tx=backtestDates(a);for(const[key,label,dash,alpha]of[["chronos","Chronos-2","dash",.08],["timesfm","TimesFM-3","dot",.045]]){const model=a[key];if(!model?.backtest)continue;const b=model.backtest;allY.push(...b.q10,...b.q50,...b.q90);traces.push({x:tx,y:b.q90,type:"scatter",mode:"lines",line:{width:0,color:c},hoverinfo:"skip",showlegend:false});traces.push({x:tx,y:b.q10,type:"scatter",mode:"lines",line:{width:0,color:c},fill:"tonexty",fillcolor:hexAlpha(c,alpha),hoverinfo:"skip",showlegend:false});traces.push({x:tx,y:b.q50,type:"scatter",mode:"lines",name:`${titleOf(m)} · prueba ${label}`,line:{width:2.2,dash,color:c},hovertemplate:`${label} prueba: %{y:.2f}%<extra></extra>`})}
  }
  const shapes=[],annotations=[];
  if(sel){
    const a=sel.a,d=a.design;
    const rect=(x0,x1,color)=>{if(x0&&x1)shapes.push({type:"rect",xref:"x",yref:"paper",x0:new Date(x0*1000),x1:new Date(x1*1000),y0:0,y1:1,fillcolor:color,line:{width:0},layer:"below"})};
    const ann=(x,text)=>annotations.push({xref:"x",yref:"paper",x:new Date(x),y:.985,text:`<b>${text}</b>`,showarrow:false,font:{size:10,color:"#344054"},yanchor:"top"});
    if(state.chartView==="forecast"){
      rect(d.finalContextStartT,d.observedEndT,"rgba(47,107,255,.06)");const steps=stepsForAnalysis(a),end=d.observedEndT*1000+steps*d.dtMs;shapes.push({type:"rect",xref:"x",yref:"paper",x0:new Date(d.observedEndT*1000),x1:new Date(end),y0:0,y1:1,fillcolor:"rgba(245,183,0,.13)",line:{width:0},layer:"below"});ann((d.finalContextStartT+d.observedEndT)*500,"CONTEXTO · hasta 128 puntos");ann((d.observedEndT*1000+end)/2,"PRONÓSTICO");shapes.push({type:"line",xref:"x",yref:"paper",x0:new Date(d.observedEndT*1000),x1:new Date(d.observedEndT*1000),y0:0,y1:1,line:{color:"#667085",width:1,dash:"dash"}})
    }else if(d.testN){
      rect(d.backContextStartT,d.testStartT,"rgba(47,107,255,.06)");rect(d.testStartT,d.testEndT,"rgba(240,68,56,.09)");ann((d.backContextStartT+d.testStartT)*500,"CONTEXTO · 128 puntos");ann((d.testStartT+d.testEndT)*500,`PRUEBA · ${d.testN}/64`)
    }
  }
  const finite=allY.filter(Number.isFinite),ymax=niceUpper(finite.length?Math.max(...finite):1);
  Plotly.react("chart",traces,{template:"plotly_white",margin:{l:55,r:55,t:8,b:52},hovermode:"x unified",showlegend:false,shapes,annotations,
    xaxis:{showgrid:true,gridcolor:"#eef1f5",zeroline:false,automargin:true,tickformatstops:[{dtickrange:[null,86400000],value:"%H:%M<br>%d %b"},{dtickrange:[86400000,604800000],value:"%d %b<br>%Y"},{dtickrange:[604800000,2678400000],value:"%d %b<br>%Y"},{dtickrange:[2678400000,7776000000],value:"%b<br>%Y"},{dtickrange:[7776000000,null],value:"%b %Y"}]},
    yaxis:{range:[0,ymax],ticksuffix:"%",showgrid:true,gridcolor:"#eef1f5",zeroline:false,automargin:true,title:null},
    yaxis2:{range:[0,ymax],ticksuffix:"%",overlaying:"y",side:"right",showgrid:false,zeroline:false,automargin:true,title:null,matches:"y"}
  },{responsive:true,displaylogo:false,locale:"es",scrollZoom:true,modeBarButtonsToRemove:["lasso2d","select2d"]})
}
function switchTab(name){document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===name));document.querySelectorAll(".tab-panel").forEach(x=>x.classList.remove("active"));$(`tab-${name}`).classList.add("active");if(name==="local")refreshStorage()}
async function refreshStorage(){const est=await storageEstimate();if(est)$("storageUsage").textContent=`${(est.usage/1024/1024).toFixed(1)} MB / ${(est.quota/1024/1024/1024).toFixed(1)} GB`;$("dataCacheStatus").textContent=`${await countStore("history")} series`;$("analysisCacheStatus").textContent=`${await countStore("analysis")} análisis`;try{const c=await caches.open("forecast-local-models-v1"),keys=await c.keys();$("modelCacheStatus").textContent=`${keys.length} archivos`}catch{}renderLocalSummary()}
function showInfo(kind){const about=`<h2>Acerca de Forecast Local</h2><p>Forecast Local es una herramienta independiente para explorar y analizar localmente mercados predictivos. No está afiliada, asociada ni respaldada por Polymarket.</p><p>Utiliza datos públicos obtenidos desde las APIs públicas de Polymarket. Chronos-2 y TimesFM-3 generan estimaciones experimentales de la trayectoria futura del precio/probabilidad implícita del mercado. Pueden ser inexactas, incompletas o quedar desactualizadas y no constituyen asesoría financiera, legal o de inversión.</p><p>Las reglas oficiales, criterios de resolución, precios y estado final son los publicados por Polymarket. <a href="https://docs.polymarket.com/" target="_blank">Documentación de Polymarket ↗</a></p>`;const privacy=`<h2>Privacidad y almacenamiento local</h2><p>Los históricos, búsquedas, traducciones, favoritos y análisis pueden guardarse en IndexedDB de este navegador. Los modelos ONNX pueden guardarse en Cache Storage si eliges conservarlos.</p><p>La inferencia ocurre en tu dispositivo. Puedes borrar los datos y modelos desde la pestaña <b>Local</b>.</p>`;$("dialogBody").innerHTML=kind==="privacy"?privacy:about;$("infoDialog").showModal()}

$("brandHome").onclick=e=>{e.preventDefault();showLanding();loadLandingFeed(state.landingCategory)};
$("searchInput").addEventListener("input",e=>{const q=e.target.value;$("searchClear").hidden=!q;clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>doSearch(q),350)});
$("searchInput").addEventListener("keydown",e=>{if(e.key==="Enter"){clearTimeout(state.searchTimer);doSearch(e.target.value)}});
$("searchClear").onclick=()=>{$("searchInput").value="";$("searchResults").hidden=true;$("searchClear").hidden=true};
document.addEventListener("click",e=>{if(!e.target.closest(".search-wrap"))$("searchResults").hidden=true});
$("marketFilter").addEventListener("input",e=>{state.marketFilter=e.target.value;renderMarketRows()});
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
document.querySelectorAll("[data-horizon]").forEach(b=>b.onclick=()=>{if(!b.disabled){state.horizonDays=+b.dataset.horizon;renderAll()}});
document.querySelectorAll("[data-chart-view]").forEach(b=>b.onclick=()=>{state.chartView=b.dataset.chartView;document.querySelectorAll("[data-chart-view]").forEach(x=>x.classList.toggle("active",x.dataset.chartView===state.chartView));renderChart()});
$("analyzeSelected").onclick=()=>analyzeMarket(state.selected);
$("compareModels").onclick=()=>{state.compareOpen=!state.compareOpen;state.chartView=state.compareOpen?"backtest":"forecast";document.querySelectorAll("[data-chart-view]").forEach(x=>x.classList.toggle("active",x.dataset.chartView===state.chartView));renderForecastPanel();renderChart()};
$("clearVisible").onclick=async()=>{for(const m of state.event?.markets||[]){const a=state.analyses.get(m.yesToken);if(a?.visible){a.visible=false;await persistAnalysis(m,a)}}renderAll()};
$("clearData").onclick=async()=>{await clearAllData();state.histories.clear();state.analyses.clear();toast("Datos y análisis locales borrados.");renderAll();refreshStorage();renderRecentSaved()};
$("clearModels").onclick=async()=>{await clearModelCaches();toast("Caché de modelos borrada.");refreshStorage()};
$("clearAll").onclick=async()=>{await clearEverything();await clearModelCaches();state.histories.clear();state.analyses.clear();toast("Almacenamiento local borrado.");renderAll();refreshStorage();renderRecentSaved()};
$("bookmarkEvent").onclick=toggleBookmark;
document.querySelectorAll("#categoryNav [data-category],#topicCards [data-category]").forEach(b=>b.onclick=()=>{showLanding();loadLandingFeed(b.dataset.category)});
$("refreshFeed").onclick=()=>loadLandingFeed(state.landingCategory);
$("aboutOpen").onclick=()=>showInfo("about");$("privacyOpen").onclick=()=>showInfo("privacy");$("dialogClose").onclick=()=>$("infoDialog").close();$("infoDialog").addEventListener("click",e=>{if(e.target===$("infoDialog"))$("infoDialog").close()});

showLanding();await pruneExpired();await refreshStorage();await renderRecentSaved();await loadLandingFeed("");
