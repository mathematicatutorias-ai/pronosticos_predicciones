const MODEL="https://huggingface.co/YangjieOu/timesfm-3.0-onnx/resolve/main/timesfm3-fp32-c128-h64.onnx";
const DATA="https://huggingface.co/YangjieOu/timesfm-3.0-onnx/resolve/main/timesfm3-fp32-c128-h64.onnx.data";
const EXT="timesfm3-fp32-c128-h64.onnx.data";
const CACHE="forecast-local-models-v1";

ort.env.wasm.wasmPaths="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
ort.env.wasm.numThreads=1;

function reply(id,ok,result=null,error=null){parent.postMessage({channel:"forecast-local-model",id,ok,result,error},"*")}
async function cachedResponse(url,persist){
  if(!persist) return null;
  const cache=await caches.open(CACHE);
  let r=await cache.match(url);
  if(!r){
    r=await fetch(url);
    if(!r.ok) throw new Error(`Modelo ${r.status}`);
    try{await cache.put(url,r.clone())}catch(e){console.warn("Cache model failed",e)}
  }
  return r;
}
function context128(values){
  const a=values.map(Number);
  return a.length>=128?a.slice(-128):new Array(128-a.length).fill(a[0]??0).concat(a);
}
function decode(t){
  const d=t.dims.map(Number),a=Array.from(t.data,Number);
  if(d.length!==4||d[3]<9)throw new Error(`Salida TimesFM inesperada [${d.join(",")}]`);
  const H=d[2],nq=d[3],q10=[],q50=[],q90=[];
  for(let h=0;h<H;h++){const o=h*nq;q10.push(a[o]);q50.push(a[o+4]);q90.push(a[o+8])}
  return {q10,q50,q90,dims:d};
}
async function forecast(values,persist){
  if(!navigator.gpu) throw new Error("WebGPU no está disponible.");
  const t0=performance.now();let session=null;
  try{
    if(persist){
      try{
        const [mr,dr]=await Promise.all([cachedResponse(MODEL,true),cachedResponse(DATA,true)]);
        const [mb,db]=await Promise.all([mr.arrayBuffer(),dr.arrayBuffer()]);
        session=await ort.InferenceSession.create(mb,{
          executionProviders:["webgpu"],graphOptimizationLevel:"all",
          externalData:[{path:EXT,data:new Uint8Array(db)}]
        });
      }catch(e){
        console.warn("Cached model path failed; using proven URL path.",e);
      }
    }
    if(!session){
      session=await ort.InferenceSession.create(MODEL,{
        executionProviders:["webgpu"],graphOptimizationLevel:"all",
        externalData:[{path:EXT,data:DATA}]
      });
    }
    const loadMs=performance.now()-t0;
    const c=context128(values);
    const target=new ort.Tensor("float32",Float32Array.from(c),[1,1,128]);
    const ti=performance.now();const out=await session.run({target});const inferMs=performance.now()-ti;
    const result=decode(out.forecast_quantiles??out[session.outputNames[0]]);
    return {...result,loadMs,inferMs,backend:"WebGPU"};
  }finally{if(session){try{await session.release()}catch{}}}
}
window.addEventListener("message",async ev=>{
  const d=ev.data;if(!d||d.channel!=="forecast-local-model")return;
  try{
    if(d.action==="forecast"){reply(d.id,true,await forecast(d.payload.values||[],d.payload.persist!==false))}
    else if(d.action==="clear-cache"){await caches.delete(CACHE);reply(d.id,true,{cleared:true})}
  }catch(e){reply(d.id,false,null,String(e?.stack||e))}
});
