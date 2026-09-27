const pending=new Map();
let seq=0;

window.addEventListener("message",ev=>{
  const d=ev.data;
  if(!d||d.channel!=="forecast-local-model") return;
  const p=pending.get(d.id);if(!p)return;
  pending.delete(d.id);clearTimeout(p.timer);
  d.ok?p.resolve(d.result):p.reject(new Error(d.error||"Error del modelo"));
});

function callFrame(frameId,action,payload={},timeoutMs=420000){
  return new Promise((resolve,reject)=>{
    const frame=document.getElementById(frameId);
    if(!frame?.contentWindow){reject(new Error("Runtime no disponible."));return;}
    const id=`m${Date.now()}-${++seq}`;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error("Tiempo de espera agotado."));},timeoutMs);
    pending.set(id,{resolve,reject,timer});
    frame.contentWindow.postMessage({channel:"forecast-local-model",id,action,payload},"*");
  });
}

export function runChronosBatch(contexts,{persist=true}={}){
  return callFrame("chronosFrame","batch-forecast",{contexts,persist},420000);
}
export function runTimesFMBatch(contexts,{persist=true}={}){
  return callFrame("timesfmFrame","batch-forecast",{contexts,persist},600000);
}
export function clearModelCaches(){
  return Promise.allSettled([
    callFrame("chronosFrame","clear-cache",{},60000),
    callFrame("timesfmFrame","clear-cache",{},60000)
  ]);
}
