import {searchPolymarket,loadSearchItem,getTokenHistory} from "./api.js?v=0.1.0";
import {clearAllData,pruneExpired,storageEstimate,countStore} from "./db.js?v=0.1.0";
import {runChronos,runTimesFM,clearModelCaches} from "./model-bridge.js?v=0.1.0";

const $=id=>document.getElementById(id);
const COLORS=["#2f6bff","#67a8ff","#f5b400","#ff7a00","#12b76a","#7a4cff","#e83e8c","#475467"];
const state={event:null,selected:null,histories:new Map(),forecasts:{},rangeDays:0,searchTimer:null};

function fmtPct(x){
  if(!Number.isFinite(+x))return "—";
  if(+x<1 && +x>0)return "<1%";
  return `${(+x).toFixed(+x>=10?1:2)}%`;
}
function fmtUSD(x){
  const n=Number(x);if(!Number.isFinite(n))return "—";
  return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:n>=1e6?"compact":"standard",maximumFractionDigits:n>=1e6?2:0}).format(n);
}
function fmtDate(x){
  if(!x)return "—";
  const d=new Date(x);return Number.isNaN(d.getTime())?"—":d.toLocaleDateString("es-EC",{year:"numeric",month:"short",day:"numeric"});
}
function toast(msg,ms=2800){
  const el=$("toast");el.textContent=msg;el.hidden=false;clearTimeout(el._t);el._t=setTimeout(()=>el.hidden=true,ms);
}
function imgFallback(img){
  img.onerror=()=>{img.onerror=null;img.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100%' height='100%' fill='#f2f4f7'/><path d='M25 60 L50 32 L75 60' fill='none' stroke='#98a2b3' stroke-width='7'/></svg>`)};
}
function setStatus(text,type="running"){
  const el=$("forecastStatus");el.hidden=false;el.className=`panel status-panel ${type}`;el.textContent=text;
}
function valuesFor(market){
  const h=state.histories.get(market.yesToken)?.six||[];
  return h.map(x=>x.p*100);
}
function timeFor(market){
  const h=state.histories.get(market.yesToken)?.six||[];
  return h.map(x=>new Date(x.t*1000));
}
function futureDates(market,n){
  const xs=timeFor(market);if(!xs.length)return [];
  let t=xs[xs.length-1].getTime();
  return Array.from({length:n},()=>new Date(t+=6*3600*1000));
}

async function doSearch(q){
  const box=$("searchResults");
  if(q.trim().length<2){box.hidden=true;return}
  box.hidden=false;box.innerHTML=`<div class="search-empty">Buscando…</div>`;
  try{
    const items=await searchPolymarket(q);
    if(!items.length){box.innerHTML=`<div class="search-empty">Sin resultados.</div>`;return}
    box.innerHTML=items.map((x,i)=>`
      <div class="search-result" data-i="${i}">
        <img src="${x.image||""}" alt="">
        <div><b>${escapeHtml(x.title)}</b><small>${escapeHtml(x.sub||"")}</small></div>
        <span class="result-kind">${x.kind==="event"?"evento":"mercado"}</span>
      </div>`).join("");
    [...box.querySelectorAll(".search-result")].forEach((el)=>{
      imgFallback(el.querySelector("img"));
      el.onclick=()=>openItem(items[+el.dataset.i]);
    });
  }catch(e){box.innerHTML=`<div class="search-empty">Error de API: ${escapeHtml(e.message)}</div>`}
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

async function openItem(item){
  $("searchResults").hidden=true;
  setStatus("Abriendo evento y descargando históricos…","running");
  try{
    const ev=await loadSearchItem(item);
    state.event=ev;
    const markets=[...ev.markets].sort((a,b)=>b.yesPrice-a.yesPrice);
    state.event.markets=markets;
    state.selected=markets[0]||null;
    state.forecasts={};
    $("landing").hidden=true;$("workspace").hidden=false;
    renderEvent();

    const initial=markets.slice(0,Math.min(4,markets.length));
    for(const m of initial){
      try{state.histories.set(m.yesToken,await getTokenHistory(m.yesToken))}catch(e){console.warn("history",m.title,e)}
      renderChart();
    }
    if(state.selected && !state.histories.has(state.selected.yesToken)){
      state.histories.set(state.selected.yesToken,await getTokenHistory(state.selected.yesToken));
    }
    renderChart();renderSelected();
    $("forecastStatus").hidden=true;
    await refreshStorage();
  }catch(e){
    setStatus(`No pude abrir el mercado: ${e.message}`,"error");
    toast(e.message,5000);
  }
}

function renderEvent(){
  const e=state.event;if(!e)return;
  $("eventTitle").textContent=e.title;
  $("eventMeta").textContent=[e.tags?.[0]?.label||e.tags?.[0]?.name||"",e.active?"mercado activo":e.closed?"cerrado":""].filter(Boolean).join(" · ");
  $("eventImage").src=e.image||"";imgFallback($("eventImage"));
  $("volumeTotal").textContent=`Volumen total ${fmtUSD(e.volume)}`;
  $("lastUpdated").textContent=`Última actualización ${new Date().toLocaleString("es-EC",{dateStyle:"medium",timeStyle:"short"})}`;

  $("outcomeLegend").innerHTML=e.markets.slice(0,6).map((m,i)=>`
    <span class="legend-item"><i style="background:${COLORS[i%COLORS.length]}"></i>${escapeHtml(m.title)} <b>${fmtPct(m.yesPrice)}</b></span>`).join("");

  $("marketRows").innerHTML=e.markets.map((m,i)=>`
    <div class="market-row" data-id="${escapeHtml(m.id)}">
      <div class="market-main">
        <img src="${m.image||e.image||""}" alt="">
        <i class="market-dot" style="background:${COLORS[i%COLORS.length]}"></i>
        <div class="market-title">${escapeHtml(m.title)}</div>
      </div>
      <div class="market-price">${fmtPct(m.yesPrice)}</div>
      <div class="market-volume">${fmtUSD(m.volume)}</div>
      <button class="analyze-btn ${state.selected?.id===m.id?"active":""}">Analizar</button>
    </div>`).join("");
  [...$("marketRows").querySelectorAll(".market-row")].forEach((row,i)=>{
    imgFallback(row.querySelector("img"));
    row.querySelector("button").onclick=()=>selectMarket(e.markets[i]);
  });
  renderSelected();
}

async function selectMarket(m){
  state.selected=m;state.forecasts={};
  renderEvent();renderChart();
  if(!state.histories.has(m.yesToken)){
    setStatus(`Descargando histórico de ${m.title}…`,"running");
    try{state.histories.set(m.yesToken,await getTokenHistory(m.yesToken));$("forecastStatus").hidden=true}
    catch(e){setStatus(`Histórico no disponible: ${e.message}`,"error")}
  }
  renderChart();renderSelected();await refreshStorage();
}

function renderSelected(){
  const m=state.selected;if(!m)return;
  $("selectedImage").src=m.image||state.event.image||"";imgFallback($("selectedImage"));
  $("selectedName").textContent=m.title;$("selectedPrice").textContent=fmtPct(m.yesPrice);
  $("selectedSub").textContent=state.event.title;
  $("mCurrent").textContent=fmtPct(m.yesPrice);$("mVolume").textContent=fmtUSD(m.volume);
  $("mStatus").textContent=m.active?"Activo":m.closed?"Cerrado":"—";$("mEnd").textContent=fmtDate(m.endDate);
}

function renderChart(){
  if(!state.event)return;
  const traces=[];
  const all=state.event.markets;
  const selected=state.selected;
  const maxObserved=[];
  all.slice(0,8).forEach((m,i)=>{
    const h=state.histories.get(m.yesToken)?.six||[];
    if(!h.length)return;
    let pts=h;
    if(state.rangeDays){
      const cutoff=Date.now()-state.rangeDays*86400*1000;
      pts=h.filter(x=>x.t*1000>=cutoff);
    }
    const x=pts.map(p=>new Date(p.t*1000)),y=pts.map(p=>p.p*100);
    if(x.length)maxObserved.push(x[x.length-1]);
    traces.push({
      x,y,type:"scatter",mode:"lines",name:m.title,
      line:{width:selected?.id===m.id?2.6:1.7,color:COLORS[i%COLORS.length]},
      opacity:selected?.id===m.id?1:.68,
      hovertemplate:`${escapeHtml(m.title)}: %{y:.2f}%<extra></extra>`
    });
  });

  if(selected){
    const idx=Math.max(0,all.findIndex(x=>x.id===selected.id));
    const color=COLORS[idx%COLORS.length];
    for(const [key,label,dash] of [["chronos","Chronos-2","dash"],["timesfm","TimesFM-3","dot"]]){
      const f=state.forecasts[key];if(!f)continue;
      const n=f.q50.length,x=futureDates(selected,n);
      traces.push({x,y:f.q90,type:"scatter",mode:"lines",line:{width:0,color},hoverinfo:"skip",showlegend:false});
      traces.push({x,y:f.q10,type:"scatter",mode:"lines",line:{width:0,color},fill:"tonexty",fillcolor:hexAlpha(color,.10),hoverinfo:"skip",showlegend:false});
      traces.push({x,y:f.q50,type:"scatter",mode:"lines",name:label,line:{width:2.3,dash,color},hovertemplate:`${label}: %{y:.2f}%<extra></extra>`});
    }
  }

  const shapes=[];
  if(selected){
    const xs=timeFor(selected);if(xs.length && (state.forecasts.chronos||state.forecasts.timesfm)){
      shapes.push({type:"line",x0:xs.at(-1),x1:xs.at(-1),y0:0,y1:1,yref:"paper",line:{color:"#98a2b3",dash:"dot",width:1}});
    }
  }
  Plotly.react("chart",traces,{
    template:"plotly_white",margin:{l:48,r:20,t:10,b:38},hovermode:"x unified",
    xaxis:{showgrid:true,gridcolor:"#f0f2f5",zeroline:false},
    yaxis:{range:[0,100],ticksuffix:"%",showgrid:true,gridcolor:"#eef1f4",zeroline:false},
    showlegend:false,shapes
  },{responsive:true,displaylogo:false,modeBarButtonsToRemove:["lasso2d","select2d"]});
}

function hexAlpha(hex,a){
  const h=hex.replace("#","");const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

async function ensureSelectedHistory(){
  const m=state.selected;if(!m)throw new Error("Selecciona un mercado.");
  if(!state.histories.has(m.yesToken))state.histories.set(m.yesToken,await getTokenHistory(m.yesToken));
  const values=valuesFor(m);if(values.length<20)throw new Error("La serie histórica es demasiado corta.");
  return values;
}
function horizonFor(values){return Math.max(1,Math.min(64,Math.round(values.length*.20)))}

async function runOne(model){
  try{
    const values=await ensureSelectedHistory();
    const persist=$("persistModels").checked;
    setStatus(`Ejecutando ${model==="chronos"?"Chronos-2":"TimesFM-3"} localmente…`,"running");
    const r=model==="chronos"?await runChronos(values,{persist}):await runTimesFM(values,{persist});
    const h=horizonFor(values);
    state.forecasts[model]={q10:r.q10.slice(0,h),q50:r.q50.slice(0,h),q90:r.q90.slice(0,h)};
    renderChart();
    setStatus(`${model==="chronos"?"Chronos-2":"TimesFM-3"} listo · ${r.backend} · carga ${(r.loadMs/1000).toFixed(1)} s · inferencia ${r.inferMs.toFixed(0)} ms`,"ok");
    await refreshStorage();
  }catch(e){setStatus(e.message,"error")}
}

function metrics(actual,pred){
  const n=Math.min(actual.length,pred.length);if(!n)return {mae:NaN,rmse:NaN};
  let ae=0,se=0;for(let i=0;i<n;i++){const d=pred[i]-actual[i];ae+=Math.abs(d);se+=d*d}
  return {mae:ae/n,rmse:Math.sqrt(se/n),n};
}
async function compare(){
  try{
    const values=await ensureSelectedHistory();
    const n=values.length,testN=Math.max(1,Math.round(n*.15)),cut=n-testN,context=values.slice(0,cut),actual=values.slice(cut);
    const persist=$("persistModels").checked;
    $("comparePanel").hidden=false;$("compareTable").innerHTML="<div class='muted small'>Ejecutando Chronos…</div>";
    const c=await runChronos(context,{persist});
    $("compareTable").innerHTML="<div class='muted small'>Ejecutando TimesFM…</div>";
    const t=await runTimesFM(context,{persist});
    const cm=metrics(actual,c.q50.slice(0,testN)),tm=metrics(actual,t.q50.slice(0,testN));
    $("compareTable").innerHTML=`
      <table class="compare-table">
        <thead><tr><th>Modelo</th><th>MAE</th><th>RMSE</th></tr></thead>
        <tbody>
          <tr><td>Chronos-2</td><td>${cm.mae.toFixed(3)}</td><td>${cm.rmse.toFixed(3)}</td></tr>
          <tr><td>TimesFM-3</td><td>${tm.mae.toFixed(3)}</td><td>${tm.rmse.toFixed(3)}</td></tr>
        </tbody>
      </table>`;
    setStatus(`Comparación terminada sobre ${testN} puntos TEST.`,"ok");
    await refreshStorage();
  }catch(e){$("comparePanel").hidden=false;$("compareTable").innerHTML=`<div class="muted small">${escapeHtml(e.message)}</div>`;setStatus(e.message,"error")}
}

async function refreshStorage(){
  const est=await storageEstimate();
  if(est){$("storageUsage").textContent=`${(est.usage/1024/1024).toFixed(1)} MB / ${(est.quota/1024/1024/1024).toFixed(1)} GB`}
  const h=await countStore("history");$("dataCacheStatus").textContent=`${h} series`;
  try{const c=await caches.open("forecast-local-models-v1");const keys=await c.keys();$("modelCacheStatus").textContent=`${keys.length} archivos`}catch{}
}

$("searchInput").addEventListener("input",e=>{
  const q=e.target.value;$("searchClear").hidden=!q;clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>doSearch(q),350);
});
$("searchInput").addEventListener("keydown",e=>{if(e.key==="Enter"){clearTimeout(state.searchTimer);doSearch(e.target.value)}});
$("searchClear").onclick=()=>{$("searchInput").value="";$("searchResults").hidden=true;$("searchClear").hidden=true};
document.addEventListener("click",e=>{if(!e.target.closest(".search-wrap"))$("searchResults").hidden=true});

[...document.querySelectorAll(".tab")].forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");$(`tab-${b.dataset.tab}`).classList.add("active");
  if(b.dataset.tab==="local")refreshStorage();
});
[...document.querySelectorAll(".range-pills button")].forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".range-pills button").forEach(x=>x.classList.remove("active"));b.classList.add("active");
  state.rangeDays=+b.dataset.range;renderChart();
});

$("runChronos").onclick=()=>runOne("chronos");
$("runTimesfm").onclick=()=>runOne("timesfm");
$("compareModels").onclick=compare;

$("clearData").onclick=async()=>{await clearAllData();state.histories.clear();toast("Datos locales borrados.");renderChart();refreshStorage()};
$("clearModels").onclick=async()=>{await clearModelCaches();toast("Caché de modelos borrada.");refreshStorage()};
$("clearAll").onclick=async()=>{await clearAllData();await clearModelCaches();state.histories.clear();state.forecasts={};toast("Almacenamiento local borrado.");renderChart();refreshStorage()};

await pruneExpired();
await refreshStorage();
