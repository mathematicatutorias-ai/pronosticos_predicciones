import {getItem,putItem} from "./db.js?v=0.6.0";

const GAMMA="https://gamma-api.polymarket.com";
const CLOB="https://clob.polymarket.com";
const SEARCH_TTL=10*60*1000,EVENT_TTL=60*60*1000,HISTORY_TTL=7*24*60*60*1000,HISTORY_FRESH=15*60*1000,FEED_TTL=5*60*1000,TAG_TTL=7*24*60*60*1000;

async function fetchJSON(url,opts={}){
  const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),opts.timeout||25000);
  try{
    const r=await fetch(url,{signal:ctrl.signal,headers:{Accept:"application/json"}});
    if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  }finally{clearTimeout(timeout);}
}
function arr(v){
  if(Array.isArray(v))return v;
  if(typeof v==="string"){try{const x=JSON.parse(v);return Array.isArray(x)?x:[]}catch{return []}}
  return [];
}
function num(v,def=0){const n=Number(v);return Number.isFinite(n)?n:def}
function first(...xs){return xs.find(x=>x!==undefined&&x!==null&&x!=="")}

export function marketView(m){
  const outcomes=arr(m.outcomes),prices=arr(m.outcomePrices),ids=arr(m.clobTokenIds);
  let yesIndex=outcomes.findIndex(x=>String(x).toLowerCase()==="yes");if(yesIndex<0)yesIndex=0;
  const priceRaw=first(prices[yesIndex],prices[0],m.lastTradePrice,m.prices?.lastTradePrice,0);
  return {
    raw:m,id:String(first(m.id,m.conditionId,m.slug,crypto.randomUUID())),conditionId:m.conditionId||"",slug:m.slug||"",
    title:first(m.groupItemTitle,m.question,m.title,"Mercado"),question:first(m.question,m.title,""),
    image:first(m.image,m.icon,m.imageOptimized?.url,m.iconOptimized?.url,""),
    yesToken:first(ids[yesIndex],ids[0],""),
    yesPrice:num(priceRaw,0)*100,
    volume:num(first(m.volumeNum,m.volume,0),0),
    volume24hr:num(first(m.volume24hr,m.volume24Hr,m.metrics?.volume24hr,0),0),
    liquidity:num(first(m.liquidityNum,m.liquidity,m.metrics?.liquidity,0),0),
    bestBid:num(first(m.bestBid,m.prices?.bestBid,NaN),NaN),
    bestAsk:num(first(m.bestAsk,m.prices?.bestAsk,NaN),NaN),
    spread:num(first(m.spread,m.prices?.spread,NaN),NaN),
    lastTradePrice:num(first(m.lastTradePrice,m.prices?.lastTradePrice,NaN),NaN),
    oneDayPriceChange:num(first(m.oneDayPriceChange,m.prices?.oneDayPriceChange,NaN),NaN),
    active:m.active!==false&&!m.closed,closed:!!m.closed,endDate:first(m.endDate,m.end_date,m.endDateIso,null),
    startDate:first(m.startDate,m.start_date,m.startDateIso,null),
    description:first(m.description,m.rules,""),resolutionSource:first(m.resolutionSource,m.resolution_source,""),
    outcomes,prices,ids
  };
}
export function eventView(e){
  const markets=(e.markets||[]).map(marketView);
  const vol24=num(first(e.volume24hr,e.volume24Hr,0),0)||markets.reduce((a,m)=>a+m.volume24hr,0);
  return {
    raw:e,id:String(first(e.id,e.slug,crypto.randomUUID())),slug:e.slug||"",title:first(e.title,e.question,"Evento"),
    image:first(e.image,e.icon,e.imageOptimized?.url,e.iconOptimized?.url,markets[0]?.image,""),
    active:e.active!==false&&!e.closed,closed:!!e.closed,
    volume:num(first(e.volumeNum,e.volume,markets.reduce((a,m)=>a+m.volume,0)),0),
    volume24hr:vol24,liquidity:num(first(e.liquidityNum,e.liquidity,markets.reduce((a,m)=>a+m.liquidity,0)),0),
    endDate:first(e.endDate,e.end_date,null),startDate:first(e.startDate,e.start_date,null),tags:e.tags||[],
    description:first(e.description,""),resolutionSource:first(e.resolutionSource,e.resolution_source,""),markets
  };
}
function eventCategory(v){
  const tag=(v.tags||[]).find(t=>t?.label||t?.name||t?.slug);
  return tag?.label||tag?.name||tag?.slug||"";
}
function normalizeSearch(data){
  const out=[];
  const pushEvent=e=>{
    if(!e)return;const v=eventView(e);
    out.push({kind:"event",id:v.id,slug:v.slug,title:v.title,image:v.image,category:eventCategory(v),marketCount:v.markets.length,volume24hr:v.volume24hr,volume:v.volume,endDate:v.endDate,raw:e});
  };
  const pushMarket=m=>{
    if(!m)return;const ev=(m.events&&m.events[0])||null;
    if(ev?.id||ev?.slug){pushEvent({...ev,markets:ev.markets||[]});return;}
    const v=marketView(m);out.push({kind:"market",id:v.id,slug:v.slug,title:v.question||v.title,image:v.image,category:"",marketCount:1,volume24hr:v.volume24hr,volume:v.volume,endDate:v.endDate,raw:m});
  };
  if(Array.isArray(data))data.forEach(x=>x.markets?pushEvent(x):pushMarket(x));
  else{
    (data.events||data.eventResults||[]).forEach(pushEvent);
    (data.markets||data.marketResults||[]).forEach(pushMarket);
    if(Array.isArray(data.results))data.results.forEach(x=>x.type==="event"?pushEvent(x):pushMarket(x));
  }
  const seen=new Set();
  return out.filter(x=>{const k=`${x.kind}:${x.id||x.slug||x.title}`;if(seen.has(k))return false;seen.add(k);return true;});
}
function normalizeText(s){return String(s||"").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,"");}
function relevance(item,queries){
  const hay=normalizeText(`${item.title} ${item.category}`);
  let bucket=0;
  for(const q of queries){
    const n=normalizeText(q);if(!n)continue;
    if(hay===n)bucket=Math.max(bucket,4);
    else if(hay.startsWith(n))bucket=Math.max(bucket,3);
    else if(hay.includes(n))bucket=Math.max(bucket,2);
    else bucket=Math.max(bucket,1);
  }
  return bucket;
}
export function previewSearchItem(item){
  if(!item)return null;
  if(item.kind==="event"&&item.raw){const ev=eventView(item.raw);if(ev.title)return ev;}
  if(item.kind==="market"&&item.raw){
    const m=item.raw,nested=(m.events&&m.events[0])||null;
    if(nested){const ev=eventView({...nested,markets:nested.markets||[]});if(ev.markets.length)return ev;}
    const mv=marketView(m);
    return {id:`market-${mv.id}`,slug:mv.slug,title:mv.question||mv.title,image:mv.image,active:mv.active,closed:mv.closed,volume:mv.volume,volume24hr:mv.volume24hr,liquidity:mv.liquidity,endDate:mv.endDate,tags:[],markets:[mv],raw:m};
  }
  return null;
}
async function searchOne(q){
  let lastErr=null;
  for(const u of [
    `${GAMMA}/public-search?q=${encodeURIComponent(q)}&limit_per_type=20&keep_closed_markets=0`,
    `${GAMMA}/search?q=${encodeURIComponent(q)}&limit_per_type=20&keep_closed_markets=0`
  ]){
    try{const items=normalizeSearch(await fetchJSON(u));if(items.length)return items;}catch(e){lastErr=e}
  }
  try{return normalizeSearch({markets:await fetchJSON(`${GAMMA}/markets?q=${encodeURIComponent(q)}&active=true&closed=false&limit=40`)})}
  catch(e){throw lastErr||e}
}
export async function searchPolymarket(query,{alternateQueries=[]}={}){
  const q=query.trim();if(q.length<2)return [];
  const queries=[q,...alternateQueries.filter(x=>x&&normalizeText(x)!==normalizeText(q))].slice(0,3);
  const key=queries.map(normalizeText).sort().join("|"),cached=await getItem("search",key);if(cached)return cached.value;
  const results=(await Promise.allSettled(queries.map(searchOne))).flatMap(r=>r.status==="fulfilled"?r.value:[]);
  const byKey=new Map();
  for(const item of results){
    const k=`${item.kind}:${item.id||item.slug||item.title}`,old=byKey.get(k);
    if(!old||item.volume24hr>old.volume24hr)byKey.set(k,item);
  }
  const items=[...byKey.values()].sort((a,b)=>{
    const ra=relevance(a,queries),rb=relevance(b,queries);
    if(rb!==ra)return rb-ra;
    if((b.volume24hr||0)!==(a.volume24hr||0))return (b.volume24hr||0)-(a.volume24hr||0);
    return (b.volume||0)-(a.volume||0);
  }).slice(0,30);
  await putItem("search",key,items,{ttlMs:SEARCH_TTL});return items;
}
export async function loadSearchItem(item){
  const preview=previewSearchItem(item);
  if(preview?.markets?.length&&preview.markets.some(m=>m.yesToken)){
    await putItem("events",`event:${preview.id||preview.slug}`,preview,{ttlMs:EVENT_TTL});return preview;
  }
  if(item.kind==="event"){
    const key=`event:${item.id||item.slug}`,cached=await getItem("events",key);if(cached)return cached.value;
    const urls=[];
    if(item.id){urls.push(`${GAMMA}/events/${encodeURIComponent(item.id)}`);urls.push(`${GAMMA}/events?id=${encodeURIComponent(item.id)}&limit=1`);}
    if(item.slug){urls.push(`${GAMMA}/events/slug/${encodeURIComponent(item.slug)}`);urls.push(`${GAMMA}/events?slug=${encodeURIComponent(item.slug)}&limit=1`);}
    let lastErr=null;
    for(const u of urls){
      try{
        let data=await fetchJSON(u);if(Array.isArray(data))data=data[0];
        if(data){const ev=eventView(data);if(ev.markets.length){await putItem("events",key,ev,{ttlMs:EVENT_TTL});return ev;}}
      }catch(e){lastErr=e}
    }
    if(preview?.markets?.length)return preview;
    throw lastErr||new Error("No pude obtener los mercados del evento.");
  }
  if(preview)return preview;
  throw new Error("No pude interpretar este resultado.");
}
export async function getTagBySlug(slug){
  if(!slug)return null;const key=slug.toLowerCase(),cached=await getItem("tags",key);if(cached)return cached.value;
  try{
    const tag=await fetchJSON(`${GAMMA}/tags/slug/${encodeURIComponent(slug)}`);
    await putItem("tags",key,tag,{ttlMs:TAG_TTL});return tag;
  }catch{return null}
}
function unwrapEvents(data){
  if(Array.isArray(data))return data;
  return data?.events||data?.items||[];
}
export async function getLandingEvents({categorySlug="",limit=12}={}){
  const cacheKey=`feed:${categorySlug||"all"}`,cached=await getItem("events",cacheKey);
  if(cached)return cached.value;
  let tag=null;if(categorySlug)tag=await getTagBySlug(categorySlug);
  const tagPart=tag?.id?`&tag_id=${encodeURIComponent(tag.id)}`:"";
  const urls=[
    `${GAMMA}/events?active=true&closed=false&limit=80&order=volume24hr&ascending=false${tagPart}`,
    `${GAMMA}/events/keyset?closed=false&limit=80${tagPart}`
  ];
  let events=[],lastErr=null;
  for(const u of urls){
    try{
      events=unwrapEvents(await fetchJSON(u));if(events.length)break;
    }catch(e){lastErr=e}
  }
  if(!events.length&&lastErr)throw lastErr;
  const views=events.map(eventView).filter(e=>e.markets.length&&e.active!==false)
    .sort((a,b)=>(b.volume24hr||0)-(a.volume24hr||0)||(b.volume||0)-(a.volume||0)).slice(0,limit);
  await putItem("events",cacheKey,views,{ttlMs:FEED_TTL});return views;
}
function mergeHistory(a,b){
  const map=new Map();for(const p of [...(a||[]),...(b||[])])if(Number.isFinite(+p.t)&&Number.isFinite(+p.p))map.set(+p.t,{t:+p.t,p:+p.p});
  return [...map.values()].sort((x,y)=>x.t-y.t);
}
export function resample6h(points){
  if(!points?.length)return [];const bucket=21600,map=new Map();
  for(const p of points){const b=Math.floor(+p.t/bucket)*bucket;map.set(b,{t:b,p:+p.p});}
  const sorted=[...map.values()].sort((a,b)=>a.t-b.t);if(!sorted.length)return [];
  const out=[];let last=sorted[0].p,j=0;
  for(let t=sorted[0].t;t<=sorted.at(-1).t;t+=bucket){while(j<sorted.length&&sorted[j].t<=t){last=sorted[j].p;j++;}out.push({t,p:last});}
  return out;
}
async function fetchHistoryWindow(tokenId,{fidelity=60,startTs=null,endTs=null}={}){
  const qs=new URLSearchParams({market:String(tokenId),fidelity:String(fidelity)});
  if(startTs!=null&&endTs!=null){qs.set("startTs",String(startTs));qs.set("endTs",String(endTs));}
  else qs.set("interval","max");
  const d=await fetchJSON(`${CLOB}/prices-history?${qs.toString()}`,{timeout:45000});
  return d.history||[];
}
function historyDurationDays(raw){
  if(!raw?.length)return 0;
  const xs=raw.map(x=>+x.t).filter(Number.isFinite);
  if(xs.length<2)return 0;
  return (Math.max(...xs)-Math.min(...xs))/86400;
}
export async function getTokenHistory(tokenId,{force=false}={}){
  if(!tokenId)throw new Error("Este mercado no expone token YES.");
  const key=String(tokenId),cached=await getItem("history",key);
  if(cached&&!force&&Date.now()-cached.updatedAt<HISTORY_FRESH)return cached.value;

  let existing=cached?.value?.raw||[],fresh=[],fidelity=cached?.value?.fidelity||60;
  const now=Math.floor(Date.now()/1000);

  if(existing.length&&!force){
    const maxTs=Math.max(...existing.map(x=>+x.t)),start=Math.max(0,maxTs-12*3600);
    try{fresh=await fetchHistoryWindow(tokenId,{fidelity,startTs:start,endTs:now});}
    catch{fresh=await fetchHistoryWindow(tokenId,{fidelity:60});existing=[];fidelity=60;}
  }else{
    fresh=await fetchHistoryWindow(tokenId,{fidelity:60});existing=[];fidelity=60;
  }

  let raw=mergeHistory(existing,fresh);

  // Mercados jóvenes: pedimos una historia más densa para que el método adaptativo
  // pueda construir hasta 128 + 64 observaciones sin inventar una frecuencia fija.
  // Polymarket expresa fidelity en minutos; 10 min es el modo denso que usamos aquí.
  const days=historyDurationDays(raw);
  if(days>0&&days<14){
    try{
      const dense=await fetchHistoryWindow(tokenId,{fidelity:10});
      if(dense.length>raw.length){raw=mergeHistory([],dense);fidelity=10;}
    }catch(e){console.debug("Dense history unavailable; using hourly history.",e);}
  }

  const value={raw,six:resample6h(raw),fidelity};
  await putItem("history",key,value,{ttlMs:HISTORY_TTL});
  return value;
}
export {GAMMA,CLOB};
