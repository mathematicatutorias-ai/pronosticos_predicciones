const BUILD = "v4.0.0";
const $ = (id) => document.getElementById(id);

const DEFAULT_CHRONOS_ONNX =
  "https://huggingface.co/TSFM-ai/chronos-2-onnx/resolve/main/model.onnx";
const DEFAULT_TIMESFM_ONNX =
  "https://huggingface.co/YangjieOu/timesfm-3.0-onnx/resolve/main/timesfm3-fp32-c128-h64.onnx";
const DEFAULT_TIMESFM_DATA =
  "https://huggingface.co/YangjieOu/timesfm-3.0-onnx/resolve/main/timesfm3-fp32-c128-h64.onnx.data";
const DEFAULT_TIMESFM_EXTERNAL_PATH =
  "timesfm3-fp32-c128-h64.onnx.data";

let plotState = { chronos: null, timesfm: null };

if (window.ort?.env?.wasm) {
  window.ort.env.wasm.wasmPaths =
    "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
  const threads = crossOriginIsolated
    ? Math.max(1, Math.min(8, navigator.hardwareConcurrency || 1))
    : 1;
  window.ort.env.wasm.numThreads = threads;
  $("wasmInfo").textContent =
    `hilos: ${threads} · crossOriginIsolated=${crossOriginIsolated}`;
}

$("chronosModelUrl").value = DEFAULT_CHRONOS_ONNX;
$("timesfmModelUrl").value = DEFAULT_TIMESFM_ONNX;
$("timesfmDataUrl").value = DEFAULT_TIMESFM_DATA;
$("timesfmExternalPath").value = DEFAULT_TIMESFM_EXTERNAL_PATH;

function nowMs(){return performance.now();}
function fmtMs(v){if(!Number.isFinite(v))return "—";return v>=1000?`${(v/1000).toFixed(2)} s`:`${v.toFixed(1)} ms`;}
function mean(xs){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:NaN;}
function setState(prefix,state,text){const el=$(`${prefix}State`);el.textContent=text;el.classList.remove("ok","fail","running");if(state)el.classList.add(state);}
function log(prefix,message,append=true){const el=$(`${prefix}Log`);el.textContent=append?el.textContent+(el.textContent?"\n":"")+message:message;el.scrollTop=el.scrollHeight;}
function errorText(e){return e instanceof Error?`${e.name}: ${e.message}\n${e.stack||""}`:String(e);}

function parseNumbers(text){
  const s=text.trim(); if(!s) throw new Error("La serie está vacía.");
  try{
    const p=JSON.parse(s); const vals=Array.isArray(p)?p:p.values;
    if(Array.isArray(vals)){const out=vals.map(Number).filter(Number.isFinite);if(out.length)return out;}
  }catch(_){}
  const out=s.replace(/[;\t]/g,",").split(/[\s,]+/).map(Number).filter(Number.isFinite);
  if(!out.length) throw new Error("No pude extraer números.");
  return out;
}
function currentSeries(){const v=parseNumbers($("seriesInput").value);$("seriesCount").textContent=`${v.length} puntos`;return v;}
function context128(values){return values.length>=128?values.slice(-128):new Array(128-values.length).fill(values[0]).concat(values);}

function makeChronosFeeds(values){
  const actual=values.slice(-512);
  const pad=512-actual.length;
  const context=new Float32Array(512); context.fill(NaN);
  const mask=new Float32Array(512); mask.fill(0);
  for(let i=0;i<actual.length;i++){context[pad+i]=Number(actual[i]);mask[pad+i]=1.0;}
  const futureCovariates=new Float32Array(64); futureCovariates.fill(NaN);
  return {
    context:new ort.Tensor("float32",context,[1,512]),
    group_ids:new ort.Tensor("int64",new BigInt64Array([0n]),[1]),
    attention_mask:new ort.Tensor("float32",mask,[1,512]),
    future_covariates:new ort.Tensor("float32",futureCovariates,[1,64]),
    num_output_patches:new ort.Tensor("int64",new BigInt64Array([4n]),[])
  };
}

function decodeChronosOutput(tensor){
  if(!tensor) throw new Error("Chronos no devolvió quantile_preds.");
  const dims=tensor.dims.map(Number), data=Array.from(tensor.data,Number);
  if(dims.length!==3||dims[1]<21) throw new Error(`Forma Chronos inesperada: [${dims.join(", ")}]`);
  const H=dims[2], q10=[], q50=[], q90=[];
  const at=(q,h)=>data[q*H+h];
  for(let h=0;h<H;h++){q10.push(at(2,h));q50.push(at(10,h));q90.push(at(18,h));}
  return {q10,q50,q90,dims};
}

function decodeTimesfmOutput(tensor){
  if(!tensor) throw new Error("TimesFM no devolvió forecast_quantiles.");
  const dims=tensor.dims.map(Number),data=Array.from(tensor.data,Number);
  if(dims.length!==4||dims[3]<9)throw new Error(`Forma TimesFM inesperada: [${dims.join(", ")}]`);
  const H=dims[2], nq=dims[3], q10=[], q50=[], q90=[];
  for(let h=0;h<H;h++){const o=h*nq;q10.push(data[o]);q50.push(data[o+4]);q90.push(data[o+8]);}
  return {q10,q50,q90,dims};
}

async function detectWebGPU(){
  if(!navigator.gpu){$("gpuStatus").textContent="NO DISPONIBLE";$("gpuInfo").textContent="navigator.gpu no existe";$("webgpuBadge").textContent="WebGPU no disponible";$("webgpuBadge").classList.add("fail");return;}
  try{
    const adapter=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});
    if(!adapter)throw new Error("requestAdapter() devolvió null.");
    let label="GPU detectada";
    try{const info=adapter.info;const parts=[info?.vendor,info?.architecture,info?.device,info?.description].filter(Boolean);if(parts.length)label=parts.join(" · ");}catch(_){}
    $("gpuStatus").textContent="DISPONIBLE";$("gpuInfo").textContent=label;$("webgpuBadge").textContent="WebGPU listo";$("webgpuBadge").classList.add("ok");
  }catch(e){$("gpuStatus").textContent="ERROR";$("gpuInfo").textContent=errorText(e).split("\n")[0];$("webgpuBadge").textContent="WebGPU con error";$("webgpuBadge").classList.add("fail");}
}

function updatePlot(){
  const values=currentSeries(), Hshow=Number($("displayHorizon").value);
  const xObs=Array.from({length:values.length},(_,i)=>i-values.length+1);
  const traces=[{x:xObs,y:values,type:"scatter",mode:"lines",name:"Observado",line:{width:3}}];
  function add(label,result,dash){
    if(!result?.q50?.length)return;
    const n=Math.min(Hshow,result.q50.length),x=Array.from({length:n},(_,i)=>i+1);
    traces.push({x,y:result.q90.slice(0,n),type:"scatter",mode:"lines",line:{width:0},hoverinfo:"skip",showlegend:false});
    traces.push({x,y:result.q10.slice(0,n),type:"scatter",mode:"lines",line:{width:0},fill:"tonexty",opacity:.1,hoverinfo:"skip",showlegend:false});
    traces.push({x,y:result.q50.slice(0,n),type:"scatter",mode:"lines",name:label,line:{width:2.5,dash}});
  }
  add("Chronos-2 · CPU",plotState.chronos,"dash");
  add("TimesFM-3 · GPU",plotState.timesfm,"dot");
  Plotly.react("chart",traces,{template:"plotly_white",height:500,margin:{l:55,r:20,t:25,b:45},hovermode:"x unified",xaxis:{title:"Pasos relativos · forecast > 0",zeroline:true},yaxis:{title:"Valor"},legend:{orientation:"h",y:1.08}},{responsive:true,displaylogo:false});
}

async function runChronos(){
  const btn=$("runChronosBtn");btn.disabled=true;setState("chronos","running","EJECUTANDO CPU");log("chronos","",false);
  let session=null;
  try{
    const values=currentSeries(),benchRuns=Number($("benchRuns").value),modelUrl=$("chronosModelUrl").value.trim();
    log("chronos",`BUILD: ${BUILD}`);
    log("chronos","Backend: wasm / cpu");
    log("chronos",`WASM threads: ${ort.env.wasm.numThreads}`);
    log("chronos",`Contexto recibido: ${values.length}`);
    log("chronos",`ONNX: ${modelUrl}`);
    log("chronos","NO se intentará WebGPU para Chronos.");
    log("chronos","Descargando/cargando ~456 MB…");
    const t0=nowMs();
    session=await ort.InferenceSession.create(modelUrl,{executionProviders:["wasm"],graphOptimizationLevel:"all"});
    const loadMs=nowMs()-t0;$("chronosLoad").textContent=fmtMs(loadMs);
    log("chronos",`✓ Sesión CPU creada en ${fmtMs(loadMs)}`);
    log("chronos",`Inputs: ${session.inputNames.join(", ")}`);
    log("chronos",`Outputs: ${session.outputNames.join(", ")}`);
    const feeds=makeChronosFeeds(values),times=[];let decoded=null;
    for(let i=0;i<benchRuns;i++){const ti=nowMs();const outputs=await session.run(feeds);const elapsed=nowMs()-ti;times.push(elapsed);decoded=decodeChronosOutput(outputs.quantile_preds??outputs[session.outputNames[0]]);log("chronos",`Inferencia ${i+1}/${benchRuns}: ${fmtMs(elapsed)}`);}
    $("chronosInfer").textContent=fmtMs(times[0]);$("chronosWarm").textContent=fmtMs(mean(times.length>1?times.slice(1):times));plotState.chronos=decoded;updatePlot();
    log("chronos",`Forma salida: [${decoded.dims.join(", ")}]`);
    log("chronos",`q50 primeros 5: ${decoded.q50.slice(0,5).map(v=>Number(v).toFixed(5)).join(", ")}`);
    setState("chronos","ok","PASS CPU");
  }catch(e){setState("chronos","fail","FAIL CPU");log("chronos","\nERROR\n"+errorText(e));console.error(e);}
  finally{if(session){try{await session.release();}catch(_){}}btn.disabled=false;}
}

async function runTimesfm(){
  const btn=$("runTimesfmBtn");btn.disabled=true;setState("timesfm","running","EJECUTANDO");log("timesfm","",false);let session=null;
  try{
    const values=currentSeries(),context=context128(values),backend=$("timesfmBackendChoice").value,benchRuns=Number($("benchRuns").value);
    const modelUrl=$("timesfmModelUrl").value.trim(),dataUrl=$("timesfmDataUrl").value.trim(),externalPath=$("timesfmExternalPath").value.trim();
    $("timesfmBackend").textContent=backend;
    log("timesfm",`BUILD: ${BUILD}`);log("timesfm",`Backend: ${backend}`);log("timesfm",`Contexto: ${context.length}`);log("timesfm",`ONNX: ${modelUrl}`);log("timesfm",`External data: ${dataUrl}`);log("timesfm","FP32 ~1.3 GB");
    const t0=nowMs();
    session=await ort.InferenceSession.create(modelUrl,{executionProviders:[backend],graphOptimizationLevel:"all",externalData:[{path:externalPath,data:dataUrl}]});
    const loadMs=nowMs()-t0;$("timesfmLoad").textContent=fmtMs(loadMs);
    log("timesfm",`Sesión creada en ${fmtMs(loadMs)}`);
    log("timesfm",`Inputs: ${session.inputNames.join(", ")}`);log("timesfm",`Outputs: ${session.outputNames.join(", ")}`);
    const target=new ort.Tensor("float32",Float32Array.from(context),[1,1,128]),times=[];let decoded=null;
    for(let i=0;i<benchRuns;i++){const ti=nowMs();const outputs=await session.run({target});const elapsed=nowMs()-ti;times.push(elapsed);decoded=decodeTimesfmOutput(outputs.forecast_quantiles??outputs[session.outputNames[0]]);log("timesfm",`Inferencia ${i+1}/${benchRuns}: ${fmtMs(elapsed)}`);}
    $("timesfmInfer").textContent=fmtMs(times[0]);$("timesfmWarm").textContent=fmtMs(mean(times.length>1?times.slice(1):times));plotState.timesfm=decoded;updatePlot();
    log("timesfm",`Forma salida: [${decoded.dims.join(", ")}]`);
    log("timesfm",`q50 primeros 5: ${decoded.q50.slice(0,5).map(v=>Number(v).toFixed(5)).join(", ")}`);
    setState("timesfm","ok","PASS");
  }catch(e){setState("timesfm","fail","FAIL");log("timesfm","\nERROR\n"+errorText(e));console.error(e);}
  finally{if(session){try{await session.release();}catch(_){}}btn.disabled=false;}
}

async function loadDemo(){
  const r=await fetch("./data/demo_series.json?v=4.0.0");
  if(!r.ok)throw new Error(`No pude abrir demo_series.json (${r.status}).`);
  const data=await r.json(),values=data.values.map(Number);
  $("seriesInput").value=JSON.stringify(values);$("seriesCount").textContent=`${values.length} puntos`;plotState={chronos:null,timesfm:null};updatePlot();
}
async function loadFile(file){
  const values=parseNumbers(await file.text());
  $("seriesInput").value=JSON.stringify(values);$("seriesCount").textContent=`${values.length} puntos`;plotState={chronos:null,timesfm:null};updatePlot();
}

$("runChronosBtn").addEventListener("click",runChronos);
$("runTimesfmBtn").addEventListener("click",runTimesfm);
$("loadDemoBtn").addEventListener("click",loadDemo);
$("clearBtn").addEventListener("click",()=>{plotState={chronos:null,timesfm:null};updatePlot();});
$("seriesFile").addEventListener("change",async e=>{const f=e.target.files?.[0];if(f){try{await loadFile(f);}catch(err){alert(errorText(err));}}});
$("seriesInput").addEventListener("change",()=>{try{updatePlot();}catch(_){}});
$("displayHorizon").addEventListener("change",updatePlot);

await detectWebGPU();
try{await loadDemo();}catch(e){console.error(e);$("seriesInput").value="55,55.2,55.4,55.1";}
