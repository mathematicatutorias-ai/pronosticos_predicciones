const DB_NAME = "forecast-local-polymarket";
const DB_VERSION = 1;
const STORES = ["search", "events", "history"];

let dbPromise = null;

function openDB(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for(const name of STORES){
        if(!db.objectStoreNames.contains(name)){
          db.createObjectStore(name, {keyPath:"key"});
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function txStore(name, mode="readonly"){
  const db = await openDB();
  return db.transaction(name,mode).objectStore(name);
}
function reqP(req){
  return new Promise((resolve,reject)=>{
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

export async function getItem(store,key){
  const s = await txStore(store);
  const row = await reqP(s.get(key));
  if(!row) return null;
  if(row.expiresAt && Date.now() > row.expiresAt){
    await deleteItem(store,key);
    return null;
  }
  return row;
}

export async function putItem(store,key,value,{ttlMs=null,meta={}}={}){
  const s = await txStore(store,"readwrite");
  const now = Date.now();
  const row = {key,value,updatedAt:now,expiresAt:ttlMs?now+ttlMs:null,...meta};
  await reqP(s.put(row));
  return row;
}

export async function deleteItem(store,key){
  const s = await txStore(store,"readwrite");
  await reqP(s.delete(key));
}

export async function clearStore(store){
  const s = await txStore(store,"readwrite");
  await reqP(s.clear());
}

export async function clearAllData(){
  for(const s of STORES) await clearStore(s);
}

export async function pruneExpired(){
  const now=Date.now();
  for(const store of STORES){
    const s = await txStore(store,"readwrite");
    await new Promise((resolve,reject)=>{
      const req=s.openCursor();
      req.onsuccess=()=>{
        const c=req.result;
        if(!c){resolve();return;}
        if(c.value.expiresAt && now>c.value.expiresAt) c.delete();
        c.continue();
      };
      req.onerror=()=>reject(req.error);
    });
  }
}

export async function countStore(store){
  const s=await txStore(store);
  return reqP(s.count());
}

export async function storageEstimate(){
  if(!navigator.storage?.estimate) return null;
  return navigator.storage.estimate();
}
