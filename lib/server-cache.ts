// Process-local, bounded metadata cache. Call only after authentication.
const cache = new Map<string,{expires:number;value?:unknown;pending?:Promise<unknown>}>();
export async function cachedValue<T>(key:string,ttl:number,load:()=>Promise<T>):Promise<T> {
 const current=cache.get(key);
 if(current?.pending)return current.pending as Promise<T>;
 if(current && current.expires>Date.now())return current.value as T;
 const pending=load().then(value=>{cache.set(key,{expires:Date.now()+ttl,value});return value;}).catch(error=>{cache.delete(key);throw error;});
 if(cache.size>=50)cache.delete(cache.keys().next().value!);
 cache.set(key,{expires:0,pending});return pending;
}
