import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0";

const $ = id => document.getElementById(id);
const CHRONOS_MODEL = "kashif/chronos-2-onnx";
const DEFAULT_TIMESFM_ONNX = "https://huggingface.co/YangjieOu/timesfm-3.0-onnx/resolve/main/timesfm3-fp32-c128-h64.onnx";
const DEFAULT_TIMESFM_DATA = "https://huggingface.co/YangjieOu/timesfm-3.0-onnx/resolve/main/timesfm3-fp32-c128-h64.onnx.data";
const DEFAULT_TIMESFM_EXTERNAL_PATH = "timesfm3-fp32-c128-h64.onnx.data";
let plotState = { chronos:null, timesfm:null };

$("timesfmModelUrl").value = DEFAULT_TIMESFM_ONNX;
$("timesfmDataUrl").value = DEFAULT_TIMESFM_DATA;
$("timesfmExternalPath").value = DEFAULT_TIMESFM_EXTERNAL_PATH;

if (window.ort?.env?.wasm) {
  window.ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
  window.ort.env.wasm.numThreads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1));
}

const nowMs = () => performance.now();
const fmtMs = v => !Number.isFinite(v) ? "—" : (v >= 1000 ? `${(v/1000).toFixed(2)} s` : `${v.toFixed(1)} ms`);
const mean = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : NaN;
function setState(prefix,state,text){const el=$(`${prefix}State`);el.textContent=text;el.classList.remove("ok","fail","running");if(state)el.classList.add(state)}
function log(prefix,message,append=true){const el=$(`${prefix}Log`);if(append)el.textContent+=(el.textContent?"\n":"")+message;else el.textContent=message;el.scrollTop=el.scrollHeight}
function errorText(err){return err instanceof Error ? `${err.name}: ${err.message}\n${err.stack||""}` : String(err)}

function parseNumbers(text){
  const t=text.trim(); if(!t) throw new Error("La serie está vacía.");
  try{const p=JSON.parse(t);const v=Array.isArray(p)?p:p.values;if(Array.isArray(v)){const out=v.map(Number).filter(Number.isFinite);if(out.length)return out}}catch(_){ }
  const out=t.replace(/[;\t]/g,",").split(/[\s,]+/).map(Number).filter(Number.isFinite);
  if(!out.length) throw new Error("No pude extraer números de la entrada."); return out;
}
function currentSeries(){const v=parseNumbers($("seriesInput").value);$("seriesCount").textContent=`${v.length} puntos`;return v}
function context128(v){if(v.length>=128)return v.slice(-128);return new Array(128-v.length).fill(v[0]).concat(v)}

function normalizeChronosOutput(output){
  if(!output) throw new Error("Chronos devolvió una salida vacía.");
  let f=output.forecast ?? output;
  if(Array.isArray(f)&&f.length===1&&Array.isArray(f[0])&&Array.isArray(f[0][0]))f=f[0];
  if(!Array.isArray(f)||!f.length) throw new Error(`Formato Chronos no reconocido: ${JSON.stringify(output).slice(0,500)}`);
  const q10=[],q50=[],q90=[];
  for(const row of f){if(!Array.isArray(row))continue;if(row.length>=3){q10.push(Number(row[0]));q50.push(Number(row[1]));q90.push(Number(row[2]))}else if(row.length===1){const x=Number(row[0]);q10.push(x);q50.push(x);q90.push(x)}}
  if(!q50.length) throw new Error("No pude extraer cuantiles de Chronos.");
  return {q10,q50,q90,raw:output};
}

function decodeTimesfmOutput(tensor){
  if(!tensor) throw new Error("TimesFM no devolvió forecast_quantiles.");
  const dims=tensor.dims.map(Number), data=Array.from(tensor.data,Number);
  if(dims.length!==4||dims[0]<1||dims[1]<1||dims[2]<1) throw new Error(`Forma TimesFM inesperada: [${dims.join(", ")}]`);
  const horizon=dims[2],nq=dims[3]; if(nq<9) throw new Error(`Esperaba 9 cuantiles; salida tiene ${nq}.`);
  const q10=[],q50=[],q90=[];
  for(let h=0;h<horizon;h++){const off=h*nq;q10.push(data[off]);q50.push(data[off+4]);q90.push(data[off+8])}
  return {q10,q50,q90,dims};
}

async function detectWebGPU(){
  $("browserStatus").textContent=navigator.userAgent.match(/Edg\//)?"Edge":navigator.userAgent.match(/Chrome\//)?"Chrome":"Otro";
  if(!navigator.gpu){$("gpuStatus").textContent="NO DISPONIBLE";$("gpuInfo").textContent="navigator.gpu no existe";$("webgpuBadge").textContent="WebGPU no disponible";$("webgpuBadge").classList.add("fail");return}
  try{
    const adapter=await navigator.gpu.requestAdapter({powerPreference:"high-performance"}); if(!adapter) throw new Error("requestAdapter() devolvió null.");
    let label="GPU detectada"; try{const info=adapter.info;const parts=[info?.vendor,info?.architecture,info?.device,info?.description].filter(Boolean);if(parts.length)label=parts.join(" · ")}catch(_){ }
    $("gpuStatus").textContent="DISPONIBLE";$("gpuInfo").textContent=label;$("webgpuBadge").textContent="WebGPU listo";$("webgpuBadge").classList.add("ok");
  }catch(err){$("gpuStatus").textContent="ERROR";$("gpuInfo").textContent=errorText(err).split("\n")[0];$("webgpuBadge").textContent="WebGPU con error";$("webgpuBadge").classList.add("fail")}
}

function updatePlot(){
  const values=currentSeries(); const traces=[{x:Array.from({length:values.length},(_,i)=>i-values.length+1),y:values,type:"scatter",mode:"lines",name:"Observado",line:{width:3},hovertemplate:"t=%{x}<br>Observado: %{y:.4f}<extra></extra>"}];
  const add=(label,r)=>{if(!r?.q50?.length)return;const x=Array.from({length:r.q50.length},(_,i)=>i+1);traces.push({x,y:r.q90,type:"scatter",mode:"lines",line:{width:0},hoverinfo:"skip",showlegend:false},{x,y:r.q10,type:"scatter",mode:"lines",line:{width:0},fill:"tonexty",opacity:.10,hoverinfo:"skip",showlegend:false},{x,y:r.q50,type:"scatter",mode:"lines",name:`${label} q50`,line:{width:2.5,dash:label.startsWith("Chronos")?"dash":"dot"},hovertemplate:`${label}: %{y:.4f}<extra></extra>`})};
  add("Chronos-2",plotState.chronos);add("TimesFM-3",plotState.timesfm);
  Plotly.react("chart",traces,{template:"plotly_white",height:500,margin:{l:55,r:20,t:25,b:45},hovermode:"x unified",xaxis:{title:"Pasos relativos · forecast > 0",zeroline:true,zerolinewidth:1.5},yaxis:{title:"Valor"},legend:{orientation:"h",y:1.08}},{responsive:true,displaylogo:false});
}

async function runChronos(){
  const btn=$("runChronosBtn");btn.disabled=true;setState("chronos","running","EJECUTANDO");log("chronos","",false);let forecaster=null;
  try{
    const values=currentSeries(),backend=$("backend").value,dtype=$("chronosDtype").value,benchRuns=Number($("benchRuns").value);$("chronosBackend").textContent=`${backend} · ${dtype}`;
    if(backend==="webgpu"&&!navigator.gpu)throw new Error("WebGPU no está disponible.");
    log("chronos",`Modelo: ${CHRONOS_MODEL}`);log("chronos",`Backend: ${backend}`);log("chronos",`dtype: ${dtype}`);log("chronos",`Contexto: ${values.length} puntos`);log("chronos","Descargando/cargando modelo…");
    const t0=nowMs();
    forecaster=await pipeline("time-series-forecasting",CHRONOS_MODEL,{device:backend,dtype,progress_callback:info=>{if(info?.status==="progress"){const p=Number(info.progress);if(Number.isFinite(p))$("chronosState").textContent=`CARGA ${p.toFixed(0)}%`}}});
    const loadMs=nowMs()-t0;$("chronosLoad").textContent=fmtMs(loadMs);log("chronos",`Sesión creada en ${fmtMs(loadMs)}`);
    const times=[];let decoded=null;
    for(let i=0;i<benchRuns;i++){const ti=nowMs();const output=await forecaster(values,{prediction_length:16,quantile_levels:[.1,.5,.9]});const elapsed=nowMs()-ti;times.push(elapsed);decoded=normalizeChronosOutput(output);log("chronos",`Inferencia ${i+1}/${benchRuns}: ${fmtMs(elapsed)}`)}
    $("chronosInfer").textContent=fmtMs(times[0]);$("chronosMean").textContent=fmtMs(mean(times));plotState.chronos=decoded;updatePlot();log("chronos",`Salida: ${decoded.q50.length} pasos`);log("chronos",`q50 primeros 5: ${decoded.q50.slice(0,5).map(v=>Number(v).toFixed(5)).join(", ")}`);setState("chronos","ok","PASS");
  }catch(err){setState("chronos","fail","FAIL");log("chronos","\nERROR\n"+errorText(err));console.error(err)}finally{if(forecaster){try{await forecaster.dispose()}catch(_){ }}btn.disabled=false}
}

async function runTimesfm(){
  const btn=$("runTimesfmBtn");btn.disabled=true;setState("timesfm","running","EJECUTANDO");log("timesfm","",false);let session=null;
  try{
    if(!window.ort)throw new Error("ONNX Runtime Web no se cargó desde CDN.");
    const context=context128(currentSeries()),backend=$("backend").value,benchRuns=Number($("benchRuns").value);if(backend==="webgpu"&&!navigator.gpu)throw new Error("WebGPU no está disponible.");
    const modelUrl=$("timesfmModelUrl").value.trim(),dataUrl=$("timesfmDataUrl").value.trim(),externalPath=$("timesfmExternalPath").value.trim();$("timesfmBackend").textContent=backend;
    log("timesfm",`Backend: ${backend}`);log("timesfm",`Contexto: ${context.length} puntos`);log("timesfm",`ONNX: ${modelUrl}`);log("timesfm",`External data: ${dataUrl}`);log("timesfm","IMPORTANTE: el FP32 descarga ~1.3 GB de pesos.");log("timesfm","Descargando/cargando modelo…");
    const t0=nowMs();
    session=await ort.InferenceSession.create(modelUrl,{executionProviders:[backend],graphOptimizationLevel:"all",externalData:[{path:externalPath,data:dataUrl}]});
    const loadMs=nowMs()-t0;$("timesfmLoad").textContent=fmtMs(loadMs);log("timesfm",`Sesión creada en ${fmtMs(loadMs)}`);log("timesfm",`Inputs: ${session.inputNames.join(", ")}`);log("timesfm",`Outputs: ${session.outputNames.join(", ")}`);
    const target=new ort.Tensor("float32",Float32Array.from(context),[1,1,128]);const times=[];let decoded=null;
    for(let i=0;i<benchRuns;i++){const ti=nowMs();const outputs=await session.run({target});const elapsed=nowMs()-ti;times.push(elapsed);const tensor=outputs.forecast_quantiles??outputs[session.outputNames[0]];decoded=decodeTimesfmOutput(tensor);log("timesfm",`Inferencia ${i+1}/${benchRuns}: ${fmtMs(elapsed)}`)}
    $("timesfmInfer").textContent=fmtMs(times[0]);$("timesfmMean").textContent=fmtMs(mean(times));plotState.timesfm=decoded;updatePlot();log("timesfm",`Forma salida: [${decoded.dims.join(", ")}]`);log("timesfm",`q50 primeros 5: ${decoded.q50.slice(0,5).map(v=>Number(v).toFixed(5)).join(", ")}`);setState("timesfm","ok","PASS");
  }catch(err){setState("timesfm","fail","FAIL");log("timesfm","\nERROR\n"+errorText(err));console.error(err)}finally{if(session){try{await session.release()}catch(_){ }}btn.disabled=false}
}

async function loadDemo(){const res=await fetch("./data/demo_series.json");if(!res.ok)throw new Error(`No pude abrir demo_series.json (${res.status}).`);const obj=await res.json();$("seriesInput").value=JSON.stringify(obj.values.map(Number));$("seriesCount").textContent=`${obj.values.length} puntos`;plotState={chronos:null,timesfm:null};updatePlot()}
async function loadFile(file){const values=parseNumbers(await file.text());$("seriesInput").value=JSON.stringify(values);$("seriesCount").textContent=`${values.length} puntos`;plotState={chronos:null,timesfm:null};updatePlot()}

$("runChronosBtn").addEventListener("click",runChronos);$("runTimesfmBtn").addEventListener("click",runTimesfm);$("loadDemoBtn").addEventListener("click",loadDemo);$("clearBtn").addEventListener("click",()=>{plotState={chronos:null,timesfm:null};updatePlot()});
$("seriesFile").addEventListener("change",async e=>{const file=e.target.files?.[0];if(!file)return;try{await loadFile(file)}catch(err){alert(errorText(err))}});$("seriesInput").addEventListener("change",()=>{try{updatePlot()}catch(_){ }});
await detectWebGPU();try{await loadDemo()}catch(err){console.error(err);$("seriesInput").value="50,50.2,50.4,50.1"}
