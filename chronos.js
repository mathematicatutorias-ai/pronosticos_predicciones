const $=id=>document.getElementById(id);
const MODEL="https://huggingface.co/TSFM-ai/chronos-2-onnx/resolve/main/model.onnx";
const VER=window.CHRONOS_ORT_VERSION||"1.30.0";
const LABEL=window.CHRONOS_RUNTIME_LABEL||"ORT";
const CDN=`https://cdn.jsdelivr.net/npm/onnxruntime-web@${VER}/dist/`;

// Force the standard WASM artifacts. No JSEP artifacts are referenced here.
ort.env.wasm.wasmPaths={mjs:`${CDN}ort-wasm-simd-threaded.mjs`,wasm:`${CDN}ort-wasm-simd-threaded.wasm`};
ort.env.wasm.numThreads=1;
$("modelUrl").value=MODEL;

const now=()=>performance.now();
const fmt=v=>v>=1000?`${(v/1000).toFixed(2)} s`:`${v.toFixed(1)} ms`;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:NaN;
function log(m,a=true){const e=$("log");e.textContent=a?e.textContent+(e.textContent?"\n":"")+m:m;e.scrollTop=e.scrollHeight}
function state(k,t){const e=$("state");e.textContent=t;e.classList.remove("ok","fail","running");if(k)e.classList.add(k)}
function err(e){return e instanceof Error?`${e.name}: ${e.message}\n${e.stack||""}`:String(e)}
function parse(t){const s=t.trim();try{const p=JSON.parse(s),a=Array.isArray(p)?p:p.values;if(Array.isArray(a)){const o=a.map(Number).filter(Number.isFinite);if(o.length)return o}}catch(_){}const o=s.split(/[\s,;]+/).map(Number).filter(Number.isFinite);if(!o.length)throw new Error("Serie inválida");return o}
function feeds(values){
  const actual=values.slice(-512),pad=512-actual.length;
  const context=new Float32Array(512);context.fill(NaN);
  const mask=new Float32Array(512);mask.fill(0);
  for(let i=0;i<actual.length;i++){context[pad+i]=Number(actual[i]);mask[pad+i]=1}
  const fc=new Float32Array(64);fc.fill(NaN);
  return{
    context:new ort.Tensor("float32",context,[1,512]),
    group_ids:new ort.Tensor("int64",new BigInt64Array([0n]),[1]),
    attention_mask:new ort.Tensor("float32",mask,[1,512]),
    future_covariates:new ort.Tensor("float32",fc,[1,64]),
    num_output_patches:new ort.Tensor("int64",new BigInt64Array([4n]),[])
  };
}
function decode(t){const d=t.dims.map(Number),a=Array.from(t.data,Number);if(d.length!==3||d[1]<21)throw new Error(`Salida inesperada [${d.join(", ")}]`);const H=d[2],q10=[],q50=[],q90=[],at=(q,h)=>a[q*H+h];for(let h=0;h<H;h++){q10.push(at(2,h));q50.push(at(10,h));q90.push(at(18,h))}return{dims:d,q10,q50,q90}}
function plot(values,r){const xo=Array.from({length:values.length},(_,i)=>i-values.length+1),n=Math.min(25,r.q50.length),x=Array.from({length:n},(_,i)=>i+1);Plotly.react("chart",[{x:xo,y:values,type:"scatter",mode:"lines",name:"Observado",line:{width:3}},{x,y:r.q90.slice(0,n),type:"scatter",mode:"lines",line:{width:0},showlegend:false,hoverinfo:"skip"},{x,y:r.q10.slice(0,n),type:"scatter",mode:"lines",line:{width:0},fill:"tonexty",opacity:.1,showlegend:false,hoverinfo:"skip"},{x,y:r.q50.slice(0,n),type:"scatter",mode:"lines",name:"Chronos q50",line:{width:2.5,dash:"dash"}}],{template:"plotly_white",height:470,margin:{l:55,r:20,t:25,b:45},hovermode:"x unified",xaxis:{title:"Pasos relativos · forecast > 0"},yaxis:{title:"Valor"}},{responsive:true,displaylogo:false})}
async function demo(){const r=await fetch("./data/demo_series.json?v=5.0.0"),j=await r.json();$("series").value=JSON.stringify(j.values)}
async function run(){
  const b=$("runBtn");b.disabled=true;state("running","EJECUTANDO");log("",false);let s=null;
  try{
    const values=parse($("series").value),runs=Number($("runs").value),model=$("modelUrl").value.trim();
    log("BUILD: v5.0.0");log(`Runtime: ${LABEL}`);log(`ORT Web: ${VER}`);log("JS bundle: ort.min.js");log("Execution provider: wasm");log("JSEP/WebGPU: NO");
    log(`WASM mjs: ${CDN}ort-wasm-simd-threaded.mjs`);log(`WASM bin: ${CDN}ort-wasm-simd-threaded.wasm`);log(`Model: ${model}`);log("Creating session…");
    const t0=now();s=await ort.InferenceSession.create(model,{executionProviders:["wasm"],graphOptimizationLevel:"all"});const lm=now()-t0;$("loadTime").textContent=fmt(lm);
    log(`✓ Session created in ${fmt(lm)}`);log(`Inputs: ${s.inputNames.join(", ")}`);log(`Outputs: ${s.outputNames.join(", ")}`);
    const f=feeds(values),times=[];let r=null;
    for(let i=0;i<runs;i++){const ti=now(),o=await s.run(f),dt=now()-ti;times.push(dt);r=decode(o.quantile_preds??o[s.outputNames[0]]);log(`Inference ${i+1}/${runs}: ${fmt(dt)}`)}
    $("firstTime").textContent=fmt(times[0]);$("warmTime").textContent=fmt(mean(times.length>1?times.slice(1):times));log(`Output shape: [${r.dims.join(", ")}]`);log(`q50 first 5: ${r.q50.slice(0,5).map(v=>v.toFixed(5)).join(", ")}`);plot(values,r);state("ok","PASS WASM");
  }catch(e){state("fail","FAIL WASM");log("\nERROR\n"+err(e));console.error(e)}
  finally{if(s){try{await s.release()}catch(_){}}b.disabled=false}
}
$("runBtn").addEventListener("click",run);$("copyBtn").addEventListener("click",async()=>navigator.clipboard.writeText($("log").textContent));await demo();