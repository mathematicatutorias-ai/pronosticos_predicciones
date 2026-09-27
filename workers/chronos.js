const MODEL="https://huggingface.co/TSFM-ai/chronos-2-onnx/resolve/main/model.onnx";
const CACHE="forecast-local-models-v1";

ort.env.wasm.wasmPaths={
  mjs:"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.mjs",
  wasm:"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.wasm"
};
ort.env.wasm.numThreads=1;

function reply(id,ok,result=null,error=null){
  parent.postMessage({channel:"forecast-local-model",id,ok,result,error},"*");
}
async function bytesFromCache(url,persist){
  if(!persist) return null;
  const cache=await caches.open(CACHE);
  let r=await cache.match(url);
  if(!r){
    r=await fetch(url);
    if(!r.ok) throw new Error(`Modelo ${r.status}`);
    try{await cache.put(url,r.clone())}catch(e){console.warn("Cache model failed",e)}
  }
  return await r.arrayBuffer();
}
function feeds(values){
  const a=values.slice(-512).map(Number), pad=512-a.length;
  const context=new Float32Array(512);context.fill(NaN);
  const mask=new Float32Array(512);
  for(let i=0;i<a.length;i++){context[pad+i]=a[i];mask[pad+i]=1}
  const fc=new Float32Array(64);fc.fill(NaN);
  return {
    context:new ort.Tensor("float32",context,[1,512]),
    group_ids:new ort.Tensor("int64",new BigInt64Array([0n]),[1]),
    attention_mask:new ort.Tensor("float32",mask,[1,512]),
    future_covariates:new ort.Tensor("float32",fc,[1,64]),
    num_output_patches:new ort.Tensor("int64",new BigInt64Array([4n]),[])
  };
}
function decode(t){
  const d=t.dims.map(Number), a=Array.from(t.data,Number), H=d[2], q10=[],q50=[],q90=[];
  if(d.length!==3||d[1]<21) throw new Error(`Salida Chronos inesperada [${d.join(",")}]`);
  for(let h=0;h<H;h++){q10.push(a[2*H+h]);q50.push(a[10*H+h]);q90.push(a[18*H+h])}
  return {q10,q50,q90,dims:d};
}
async function forecast(values,persist){
  const t0=performance.now(); let session=null;
  try{
    const buf=await bytesFromCache(MODEL,persist);
    session=await ort.InferenceSession.create(buf||MODEL,{executionProviders:["wasm"],graphOptimizationLevel:"all"});
    const loadMs=performance.now()-t0;
    const ti=performance.now();
    const out=await session.run(feeds(values));
    const inferMs=performance.now()-ti;
    const result=decode(out.quantile_preds??out[session.outputNames[0]]);
    return {...result,loadMs,inferMs,backend:"WASM / CPU"};
  } finally { if(session){try{await session.release()}catch{}} }
}
window.addEventListener("message",async ev=>{
  const d=ev.data;if(!d||d.channel!=="forecast-local-model")return;
  try{
    if(d.action==="forecast"){
      const r=await forecast(d.payload.values||[],d.payload.persist!==false);
      reply(d.id,true,r);
    }else if(d.action==="clear-cache"){
      await caches.delete(CACHE);reply(d.id,true,{cleared:true});
    }
  }catch(e){reply(d.id,false,null,String(e?.stack||e))}
});
