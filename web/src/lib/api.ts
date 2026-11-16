import type {Report} from './metrics';

/** Reads retry a network failure once; writes never retry, because a provider sync may already have run. */
export async function api<T=unknown>(path:string,body?:unknown):Promise<T>{
 let res:Response;
 try{res=await fetch('/api/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
 catch{
  if(body!==undefined)throw Error('The sync request was interrupted. Reload the page and check sync history before retrying.');
  try{res=await fetch('/api/'+path);}catch{throw Error('Could not load reports. Reload the page to retry. Previously stored data is retained.');}
 }
 if(res.redirected||res.status===401)throw Error('Your sign-in session needs to be renewed. Reload the page to sign in.');
 const value=await res.json();
 if(!res.ok)throw Error(value.error||'Request failed.');
 return value as T;
}
export const loadReport=()=>api<Report>('metrics');

export function download(name:string,text:string,type:string){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
