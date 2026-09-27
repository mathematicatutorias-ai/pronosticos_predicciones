import {getItem,putItem} from "./db.js?v=0.4.0";

const GAMMA="https://gamma-api.polymarket.com";
const CLOB="https://clob.polymarket.com";

const SEARCH_TTL=10*60*1000;
const EVENT_TTL=60*60*1000;
const HISTORY_TTL=7*24*60*60*1000;
const HISTORY_FRESH=15*60*1000;

async function fetchJSON(url, opts={}){
  const ctrl=new AbortController();
  const timeout=setTimeout(()=>ctrl.abort(), opts.timeout||25000);
  try{
    const r=await fetch(url,{signal:ctrl.signal,headers:{Accept:"application/json"}});
    if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } finally { clearTimeout(timeout); }
}
function arr(v){
  if(Array.isArray(v)) return v;
  if(typeof v==="string"){ try{const x=JSON.parse(v);return Array.isArray(x)?x:[]}catch{return []} }
  return [];
}
function num(v,def=0){const n=Number(v);return Number.isFinite(n)?n:def}

export function marketView(m){
  const outcomes=arr(m.outcomes), prices=arr(m.outcomePrices), ids=arr(m.clobTokenIds);
  let yesIndex=outcomes.findIndex(x=>String(x).toLowerCase()==="yes");
  if(yesIndex<0) yesIndex=0;
  return {
    raw:m,
    id:String(m.id??m.conditionId??m.slug??crypto.randomUUID()),
    conditionId:m.conditionId||"",
    slug:m.slug||"",
    title:m.groupItemTitle||m.question||m.title||"Mercado",
    question:m.question||m.title||"",
    image:m.image||m.icon||m.imageOptimized?.url||m.iconOptimized?.url||"",
    yesToken:ids[yesIndex]||ids[0]||"",
    yesPrice:num(prices[yesIndex]??prices[0],0)*100,
    volume:num(m.volumeNum??m.volume,0),
    active:m.active!==false && !m.closed,
    closed:!!m.closed,
    endDate:m.endDate||m.end_date||null,
    outcomes,prices,ids
  };
}

export function eventView(e){
  const markets=(e.markets||[]).map(marketView);
  return {
    raw:e,
    id:String(e.id??e.slug??crypto.randomUUID()),
    slug:e.slug||"",
    title:e.title||e.question||"Evento",
    image:e.image||e.icon||e.imageOptimized?.url||e.iconOptimized?.url||markets[0]?.image||"",
    active:e.active!==false && !e.closed,
    closed:!!e.closed,
    volume:num(e.volumeNum??e.volume, markets.reduce((a,m)=>a+m.volume,0)),
    liquidity:num(e.liquidityNum??e.liquidity,0),
    endDate:e.endDate||e.end_date||null,
    tags:e.tags||[],
    markets
  };
}

function normalizeSearch(data){
  const out=[];
  const pushEvent=e=>{
    if(!e) return;
    const v=eventView(e);
    out.push({kind:"event",id:v.id,slug:v.slug,title:v.title,image:v.image,sub:`Evento · ${v.markets.length||"—"} mercados`,raw:e});
  };
  const pushMarket=m=>{
    if(!m) return;
    const ev=(m.events&&m.events[0])||null;
    if(ev?.id||ev?.slug){
      const v=eventView({...ev,markets:ev.markets||[]});
      out.push({kind:"event",id:v.id,slug:v.slug,title:v.title,image:v.image||m.image||m.icon,sub:"Evento",raw:ev});
    } else {
      const v=marketView(m);
      out.push({kind:"market",id:v.id,slug:v.slug,title:v.question||v.title,image:v.image,sub:"Mercado",raw:m});
    }
  };

  if(Array.isArray(data)){ data.forEach(x=>x.markets?pushEvent(x):pushMarket(x)); }
  else{
    (data.events||data.eventResults||[]).forEach(pushEvent);
    (data.markets||data.marketResults||[]).forEach(pushMarket);
    if(Array.isArray(data.results)) data.results.forEach(x=>x.type==="event"?pushEvent(x):pushMarket(x));
  }

  const seen=new Set();
  return out.filter(x=>{
    const k=`${x.kind}:${x.id||x.slug||x.title}`;
    if(seen.has(k)) return false;
    seen.add(k);return true;
  }).slice(0,18);
}

export function previewSearchItem(item){
  if(!item) return null;
  if(item.kind==="event" && item.raw){
    const ev=eventView(item.raw);
    if(ev.title) return ev;
  }
  if(item.kind==="market" && item.raw){
    const m=item.raw;
    const nested=(m.events&&m.events[0])||null;
    if(nested){
      const ev=eventView({...nested,markets:nested.markets||[]});
      if(ev.markets.length) return ev;
    }
    const mv=marketView(m);
    return {id:`market-${mv.id}`,slug:mv.slug,title:mv.question||mv.title,image:mv.image,active:mv.active,closed:mv.closed,volume:mv.volume,liquidity:0,endDate:mv.endDate,tags:[],markets:[mv],raw:m};
  }
  return null;
}

export async function searchPolymarket(query){
  const q=query.trim();
  if(q.length<2) return [];
  const key=q.toLowerCase();
  const cached=await getItem("search",key);
  if(cached) return cached.value;

  const urls=[
    `${GAMMA}/public-search?q=${encodeURIComponent(q)}&limit_per_type=10&keep_closed_markets=0`,
    `${GAMMA}/search?q=${encodeURIComponent(q)}&limit_per_type=10&keep_closed_markets=0`
  ];

  let lastErr=null;
  for(const u of urls){
    try{
      const data=await fetchJSON(u);
      const items=normalizeSearch(data);
      if(items.length){
        await putItem("search",key,items,{ttlMs:SEARCH_TTL});
        return items;
      }
    }catch(e){lastErr=e}
  }

  try{
    const data=await fetchJSON(`${GAMMA}/markets?q=${encodeURIComponent(q)}&active=true&closed=false&limit=20`);
    const items=normalizeSearch({markets:data});
    await putItem("search",key,items,{ttlMs:SEARCH_TTL});
    return items;
  }catch(e){lastErr=e}

  throw new Error(`No fue posible consultar Gamma desde este navegador. ${lastErr?.message||""}`.trim());
}

export async function loadSearchItem(item){
  const preview=previewSearchItem(item);

  // public-search often already returns the complete event with its markets.
  // If it has usable token IDs, do NOT block the click with a second request.
  if(preview?.markets?.length && preview.markets.some(m=>m.yesToken)){
    const key=`event:${preview.id||preview.slug}`;
    await putItem("events",key,preview,{ttlMs:EVENT_TTL});
    return preview;
  }

  if(item.kind==="event"){
    const key=`event:${item.id||item.slug}`;
    const cached=await getItem("events",key);
    if(cached) return cached.value;

    const urls=[];
    if(item.id){
      urls.push(`${GAMMA}/events/${encodeURIComponent(item.id)}`);
      urls.push(`${GAMMA}/events?id=${encodeURIComponent(item.id)}&limit=1`);
    }
    if(item.slug) urls.push(`${GAMMA}/events?slug=${encodeURIComponent(item.slug)}&limit=1`);

    let lastErr=null;
    for(const u of urls){
      try{
        let data=await fetchJSON(u);
        if(Array.isArray(data)) data=data[0];
        if(data){
          const ev=eventView(data);
          if(ev.markets.length){
            await putItem("events",key,ev,{ttlMs:EVENT_TTL});
            return ev;
          }
        }
      }catch(e){lastErr=e}
    }
    if(preview?.markets?.length) return preview;
    throw lastErr||new Error("No pude obtener los mercados del evento.");
  }

  if(preview) return preview;
  throw new Error("No pude interpretar este resultado.");
}

function mergeHistory(a,b){
  const map=new Map();
  for(const p of [...(a||[]),...(b||[])]) if(Number.isFinite(+p.t)&&Number.isFinite(+p.p)) map.set(+p.t,{t:+p.t,p:+p.p});
  return [...map.values()].sort((x,y)=>x.t-y.t);
}

export function resample6h(points){
  if(!points?.length) return [];
  const bucket=21600;
  const map=new Map();
  for(const p of points){
    const b=Math.floor(+p.t/bucket)*bucket;
    map.set(b,{t:b,p:+p.p});
  }
  const sorted=[...map.values()].sort((a,b)=>a.t-b.t);
  if(!sorted.length) return [];
  const out=[];
  let last=sorted[0].p, j=0;
  for(let t=sorted[0].t;t<=sorted[sorted.length-1].t;t+=bucket){
    while(j<sorted.length && sorted[j].t<=t){last=sorted[j].p;j++}
    out.push({t,p:last});
  }
  return out;
}

export async function getTokenHistory(tokenId,{force=false}={}){
  if(!tokenId) throw new Error("Este mercado no expone token YES.");
  const key=String(tokenId);
  const cached=await getItem("history",key);
  if(cached && !force && Date.now()-cached.updatedAt < HISTORY_FRESH) return cached.value;

  let existing=cached?.value?.raw||[];
  let fresh=[];
  const now=Math.floor(Date.now()/1000);

  if(existing.length){
    const maxTs=Math.max(...existing.map(x=>+x.t));
    const start=Math.max(0,maxTs-12*3600);
    try{
      const d=await fetchJSON(`${CLOB}/prices-history?market=${encodeURIComponent(tokenId)}&startTs=${start}&endTs=${now}&fidelity=60`,{timeout:35000});
      fresh=d.history||[];
    }catch{
      const d=await fetchJSON(`${CLOB}/prices-history?market=${encodeURIComponent(tokenId)}&interval=max&fidelity=60`,{timeout:35000});
      fresh=d.history||[];
      existing=[];
    }
  }else{
    const d=await fetchJSON(`${CLOB}/prices-history?market=${encodeURIComponent(tokenId)}&interval=max&fidelity=60`,{timeout:35000});
    fresh=d.history||[];
  }

  const raw=mergeHistory(existing,fresh);
  const six=resample6h(raw);
  const value={raw,six};
  await putItem("history",key,value,{ttlMs:HISTORY_TTL});
  return value;
}

export {GAMMA,CLOB};
