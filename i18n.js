import {getItem,putItem} from "./db.js?v=0.6.0";

const translators=new Map();
const TTL=90*24*60*60*1000;

function keyFor(source,target,text){return `${source}:${target}:${text}`;}
function likelyEnglish(text){
  return /\b(will|who|what|when|where|president|presidential|election|win|winner|above|below|before|after|rate|decision|next|market|mayor|senate|house|bitcoin|fed|approval|price|war|end|prime minister)\b/i.test(text||"");
}
function likelySpanish(text){
  return /\b(elecci[oó]n|elecciones|presidente|presidencial|ganar[aá]|ganador|tasas|mercado|guerra|termina|clima|deportes|pol[ií]tica|finanzas|tecnolog[ií]a|alcalde|senado|c[aá]mara)\b/i.test(text||"");
}
async function getTranslator(source,target){
  if(!("Translator" in self))return null;
  const k=`${source}:${target}`;
  if(translators.has(k))return translators.get(k);
  try{
    if(Translator.availability){
      const a=await Translator.availability({sourceLanguage:source,targetLanguage:target});
      if(a==="unavailable")return null;
    }
    const tr=await Translator.create({sourceLanguage:source,targetLanguage:target});
    translators.set(k,tr);return tr;
  }catch(e){console.debug("Translator unavailable",source,target,e);return null;}
}
export async function translateLocal(text,source,target){
  const clean=String(text||"").trim();if(!clean)return clean;
  const key=keyFor(source,target,clean);
  const cached=await getItem("translations",key);
  if(cached)return cached.value;
  const tr=await getTranslator(source,target);
  if(!tr)return clean;
  try{
    const out=await tr.translate(clean);
    if(out&&out.trim()&&out.trim()!==clean){
      await putItem("translations",key,out.trim(),{ttlMs:TTL});
      return out.trim();
    }
  }catch(e){console.debug("translation failed",e);}
  return clean;
}
export async function toSpanish(text){
  if(!text)return text;
  if(!likelyEnglish(text))return text;
  return translateLocal(text,"en","es");
}
export async function queryToEnglish(text){
  if(!text)return text;
  if(!likelySpanish(text))return text;
  return translateLocal(text,"es","en");
}
export function translatorSupported(){return "Translator" in self;}
