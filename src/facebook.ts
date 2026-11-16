import {accessToken,type OAuthEnv} from './oauth';
import {save,validateImport} from './data';
export async function syncFacebook(env:OAuthEnv){
 if(!env.FACEBOOK_PAGE_ID||!/^\d+$/.test(env.FACEBOOK_PAGE_ID))throw Error('Configure the intended Facebook Page ID.');
 const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO sync_runs(id,source,started_at,status) VALUES(?,?,?,?)').bind(id,'facebook',new Date().toISOString(),'running').run();
 try{
 const token=await accessToken(env,'facebook');const get=async(url:string,access:string)=>{const parsed=new URL(url);if(parsed.origin!=='https://graph.facebook.com')throw Error('Unexpected Facebook pagination URL.');const r=await fetch(url,{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('Facebook permissions unavailable.');return r.json() as Promise<any>;};
 let next:string|undefined='https://graph.facebook.com/v25.0/me/accounts?fields=id,access_token&limit=100';let pageToken:string|undefined;
 for(let page=0;next&&page<20;page++){const result=await get(next,token.access_token);const found=result.data?.find((p:any)=>p.id===env.FACEBOOK_PAGE_ID);if(found){pageToken=found.access_token;break;}next=result.paging?.next;}
 if(!pageToken)throw Error('Configured Page was not authorised.');
 const stats=await get('https://graph.facebook.com/v25.0/'+env.FACEBOOK_PAGE_ID+'?fields=id,name,followers_count,fan_count',pageToken);
 const date=new Date().toISOString().slice(0,10);const rows=validateImport(['followers_count','fan_count'].map(field=>{if(typeof stats[field]!=='number')throw Error('Page statistics unavailable.');return {source:'facebook',date,metric:field==='followers_count'?'followers_snapshot':'page_likes_snapshot',value:stats[field],unit:'count',timezone:'UTC',provenance:'Facebook Page API total snapshot'};}));await save(env.DB,rows);
 await env.DB.prepare('UPDATE sync_runs SET finished_at=?,status=?,message=? WHERE id=?').bind(new Date().toISOString(),'success','Page follower and like totals saved. Daily growth requires multiple observations.',id).run();return {rows:rows.length};
 }catch(e){await env.DB.prepare('UPDATE sync_runs SET finished_at=?,status=?,message=? WHERE id=?').bind(new Date().toISOString(),'error','Facebook sync failed. Check Page ID, granted Page access and token expiry.',id).run();throw e;}
}
