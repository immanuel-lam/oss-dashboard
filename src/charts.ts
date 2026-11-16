import {save,validateImport,type Metric} from './data.ts';
import {SafeError,safeMessage} from './safe-error.ts';

// Apple blocks its legacy itunes.apple.com RSS feeds from Cloudflare (HTTP 403, checked 31 October 2026), so genre
// charts come from the public App Store charts page (top 50, ordered) and the overall chart from Apple's marketing
// tools feed (top 100).
//   APP_STORE_COUNTRY  two-letter storefront, default "us".
//   APP_STORE_GENRES   optional genre charts as slug:genreId pairs, e.g. "navigation:6010,travel:6003". The slug must
//                      match the path Apple uses for that genre's chart page (apps.apple.com/<cc>/charts/iphone/<slug>-apps/<id>).
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
export interface Chart {metric:string; kind:'page'|'feed'; url:string; label:string}
export interface ChartEnv {APP_STORE_COUNTRY?:string; APP_STORE_GENRES?:string}
export function chartsFor(env:ChartEnv):Chart[]{
 const cc=(env.APP_STORE_COUNTRY||'us').trim().toLowerCase();
 if(!/^[a-z]{2}$/.test(cc))throw new SafeError('APP_STORE_COUNTRY must be a two-letter storefront code.');
 const genres=(env.APP_STORE_GENRES??'').split(',').map(s=>s.trim()).filter(Boolean).map(pair=>{
  const m=/^([a-z][a-z-]{0,40}):(\d{4,6})$/.exec(pair);if(!m)throw new SafeError('APP_STORE_GENRES entries must look like slug:genreId.');
  return {metric:'rank_'+m[1].replaceAll('-','_')+'_snapshot',kind:'page' as const,url:'https://apps.apple.com/'+cc+'/charts/iphone/'+m[1]+'-apps/'+m[2]+'?chart=top-free',label:m[1]};
 });
 return [...genres,{metric:'rank_overall_snapshot',kind:'feed',url:'https://rss.marketingtools.apple.com/api/v2/'+cc+'/apps/top-free/100/apps.json',label:'all apps'}];
}

/** Position (1-based) in a marketing tools feed, or null when the app is not listed. Not listed is unavailable, never zero. */
export function rankIn(feed:any,appId:string):number|null{
 const results=feed?.feed?.results;if(!Array.isArray(results))throw new SafeError('Unexpected App Store chart feed.');
 const i=results.findIndex((r:any)=>String(r?.id)===appId);return i<0?null:i+1;
}
/** Position in a charts page: app links appear in chart order, so the first occurrence of each app ID gives its rank. */
export function rankInPage(html:string,appId:string):number|null{
 const ids=[...new Set([...html.matchAll(/\/id(\d{6,12})/g)].map(m=>m[1]))];
 if(ids.length<10)throw new SafeError('Unexpected App Store charts page.');
 const i=ids.indexOf(appId);return i<0?null:i+1;
}

/** Hourly snapshot of chart positions. Only failures are written to sync history, so hourly runs do not hide App Store sync results. */
export async function syncCharts(env:{DB:D1Database;APPLE_APP_ID?:string}&ChartEnv){
 if(!env.APPLE_APP_ID)return {rows:0};
 const date=new Date().toISOString().slice(0,10);const rows:Metric[]=[];let limited=0;
 try{
  for(const chart of chartsFor(env)){
   const r=await fetch(chart.url,{headers:{'User-Agent':UA},signal:AbortSignal.timeout(30000)});
   // Apple rate-limits busy periods (HTTP 429). Skip that chart this run; the next run fills it in.
   if(r.status===429||r.status===503){limited++;continue;}
   if(!r.ok)throw new SafeError('Chart request failed for '+chart.metric.replace('_snapshot','')+' (HTTP '+r.status+').');
   const rank=chart.kind==='page'?rankInPage(await r.text(),env.APPLE_APP_ID):rankIn(await r.json(),env.APPLE_APP_ID);
   if(rank!==null)rows.push({source:'app-store',date,metric:chart.metric,value:rank,unit:'rank',timezone:'UTC',provenance:chart.kind==='page'?'App Store top free '+chart.label+' chart page, storefront '+(env.APP_STORE_COUNTRY||'us').toUpperCase()+'; position in the top 50, lower is better':'Apple marketing tools top free feed, storefront '+(env.APP_STORE_COUNTRY||'us').toUpperCase()+'; position in the top 100, lower is better'});
  }
  if(rows.length)await save(env.DB,validateImport(rows));
  return {rows:rows.length,limited};
 }catch(e){
  await env.DB.prepare('INSERT INTO sync_runs(id,source,started_at,finished_at,status,message) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),'app-store',new Date().toISOString(),new Date().toISOString(),'error','Chart rank check failed: '+safeMessage(e)).run();
  throw e;
 }
}
