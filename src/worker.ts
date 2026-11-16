import {loadTikTokHistory,loadContentHistory,validateGroupChange,saveGroupChange} from './content-history';
import {syncWebsite,websiteReady,cloudflareReady,type WebsiteEnv} from './website';
import {syncFacebook} from './facebook';
import {withLock,acquireLock,staleRunsSql,LOCK_MS} from './limits';
import {providers,ready,begin,callback,OAuthFailure,type OAuthEnv,type Provider} from './oauth';
import {syncSocial} from './social';
import {syncAppleAnalytics} from './apple-analytics';
import {syncAppleSales} from './apple';
import {syncCharts,type ChartEnv} from './charts';
import {syncInstagram,instagramReady,type InstagramEnv} from './instagram';
import {syncFacebookPage,facebookPageReady,type FacebookPageEnv} from './facebook-page';
import {type AppleEnv} from './apple';
import {syncGithub,githubReady,RECENT_DAYS,FULL_DAYS,type GithubEnv} from './github';
import {validateImport,save} from './data';
import {syncYouTube,syncYouTubeVideosHourly,type ConnectorEnv} from './connectors';
/** Cron expressions (also in wrangler configs). Workers Free allows 5 cron triggers per account, shared with other
    Workers, so one quarter-hourly trigger rotates through four job groups by minute (a five-trigger setup was rejected). */
export const CRONS=['*/15 * * * *','30 5 * * *'] as const;
export const SLOTS:Record<number,string>={0:'charts-website',15:'instagram',30:'facebook-youtube',45:'apple-sales'};
export function slotFor(cron:string,scheduledTime:number){if(cron==='30 5 * * *')return 'daily';if(cron!=='*/15 * * * *')return undefined;const m=new Date(scheduledTime).getUTCMinutes();return SLOTS[m-m%15];}
interface Env extends ConnectorEnv,AppleEnv,ChartEnv,OAuthEnv,WebsiteEnv,InstagramEnv,FacebookPageEnv,GithubEnv { ASSETS:Fetcher; DASHBOARD_NAME?:string; PROFILE_URLS?:string }
// The cache key only has to be a stable URL; it never leaves this Worker.
const cacheKey=(origin:string)=>origin+'/__cache/metrics-v1';
// Short-lived cookie that ties an OAuth callback to the browser that started it (there are no user accounts).
const OAUTH_COOKIE='oauth_binding';
const cookie=(request:Request,name:string)=>(request.headers.get('Cookie')??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);
/** Settings the browser needs: a display name and public profile links (`source=url,source=url`). */
export function settings(env:{DASHBOARD_NAME?:string;PROFILE_URLS?:string}){
 const profiles:Record<string,string>={};
 for(const pair of (env.PROFILE_URLS??'').split(',')){const i=pair.indexOf('=');if(i<1)continue;const source=pair.slice(0,i).trim();const url=pair.slice(i+1).trim();try{if(/^[a-z-]+$/.test(source)&&new URL(url).protocol==='https:')profiles[source]=url;}catch{}}
 return {name:(env.DASHBOARD_NAME??'').trim().slice(0,60)||'Dashboard',profiles};
}
// Separate budgets keep GitHub history from displacing existing audience reports.
export const REPORT_QUERIES=[
 "SELECT * FROM metrics WHERE source<>'github' ORDER BY date DESC,source,metric LIMIT 20001",
 "SELECT * FROM metrics WHERE source='github' ORDER BY date DESC,source,metric LIMIT 5001",
] as const;
/** Everything the dashboard reads, in as few row scans as possible. */
async function buildReport(env:Env){
 await env.DB.prepare(staleRunsSql).bind(new Date().toISOString(),new Date(Date.now()-LOCK_MS).toISOString()).run();
 const [result,github,runs,content,accounts]=await env.DB.batch([
  ...REPORT_QUERIES.map(sql=>env.DB.prepare(sql)),
  env.DB.prepare('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 30'),
  // Latest snapshot per item via one grouped pass (a correlated subquery read every row once per row).
  env.DB.prepare('SELECT c.* FROM content_snapshots c JOIN (SELECT source,content_id,MAX(observed_date) AS d FROM content_snapshots GROUP BY source,content_id) m ON c.source=m.source AND c.content_id=m.content_id AND c.observed_date=m.d ORDER BY c.views DESC,c.published_at DESC LIMIT 500'),
  env.DB.prepare('SELECT provider,updated_at FROM connections'),
 ]) as D1Result<Record<string,unknown>>[];
 const videoHistory=await loadTikTokHistory(env.DB);
 const contentData=await loadContentHistory(env.DB);
 return {...videoHistory,...contentData,settings:settings(env),content:content.results,accounts:accounts.results,oauth:Object.fromEntries(providers.map(p=>[p,ready(env,p)])),truncated:result.results.length>20000||github.results.length>5000,metrics:[...result.results.slice(0,20000),...github.results.slice(0,5000)].sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(a.source).localeCompare(String(b.source))||String(a.metric).localeCompare(String(b.metric))),runs:runs.results,connectors:{github:githubReady(env),instagram:instagramReady(env),facebook:facebookPageReady(env),website:websiteReady(env),websiteProvider:cloudflareReady(env)?'cloudflare':'posthog',apple:!!(env.APPLE_PRIVATE_KEY&&env.APPLE_KEY_ID&&env.APPLE_ISSUER_ID&&env.APPLE_APP_ID),youtube:!!(env.YOUTUBE_CLIENT_ID&&env.YOUTUBE_CLIENT_SECRET&&(accounts.results as {provider:string}[]).some(a=>a.provider==='youtube'))}};
}
export default {
 async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'Strict-Transport-Security':'max-age=31536000', 'Permissions-Policy':'camera=(), microphone=(), geolocation=()', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" };
  // There is no built-in sign-in. Put the dashboard behind Cloudflare Access, a VPN or an authenticating
  // reverse proxy before you deploy it anywhere reachable (see README.md).
  const url=new URL(request.url);const path=url.pathname;
  const METRICS_CACHE_KEY=cacheKey(url.origin);
  const respond=(body:unknown,status=200,extra:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json',...extra}});
  const oauthMatch=/^\/oauth\/(youtube|instagram|tiktok|facebook)\/callback$/.exec(path);
  if(oauthMatch&&request.method==='GET'){
   const clear=OAUTH_COOKIE+'=; Path=/oauth/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';
   try{await callback(env,oauthMatch[1] as Provider,url,cookie(request,OAUTH_COOKIE)??'');return new Response(null,{status:303,headers:{...headers,Location:'/','Set-Cookie':clear}});}
   catch(error){return new Response(error instanceof OAuthFailure?error.message:'Connection could not be saved. Return to Connections and retry.',{status:400,headers:{...headers,'Set-Cookie':clear}});}
  }
  if(request.method==='POST'&&path.startsWith('/api/'))ctx?.waitUntil((caches as unknown as {default:Cache}).default.delete(METRICS_CACHE_KEY));
  if(request.method!=='GET') {
   if(request.method!=='POST' || request.headers.get('Origin')!==new URL(request.url).origin || request.headers.get('Content-Type')!=='application/json') return respond({error:'Invalid request origin or content type.'},403);
  }
  if(request.method==='GET' && /^\/fonts\/(manrope|hanken)\.woff2$/.test(path))return env.ASSETS.fetch(request);
  // The React UI is a static build in public/app.
  const asset=async(assetPath:string,cache:string)=>{const response=await env.ASSETS.fetch(new Request(new URL(assetPath,request.url)));if(!response.ok)return new Response('Not found.',{status:404,headers});const out=new Response(response.body,response);for(const [k,v] of Object.entries(headers))out.headers.set(k,v);out.headers.set('Cache-Control',cache);return out;};
  if(request.method==='GET'&&/^\/app\/assets\/[\w.-]+\.(js|css)$/.test(path))return asset(path,'private, max-age=31536000, immutable');
  if(path.startsWith('/api/')) {
   if(!env.DB) return respond({error:'Database is not configured.'},503);
   try {
    const connect=/^\/api\/(connect|disconnect)\/(youtube|instagram|tiktok|facebook)$/.exec(path);
    if(connect&&request.method==='POST'){const p=connect[2] as Provider;if(connect[1]==='connect'){const binding=crypto.randomUUID();return respond(await begin(env,p,url.origin,binding),200,{'Set-Cookie':OAUTH_COOKIE+'='+binding+'; Path=/oauth/; Max-Age=600; HttpOnly; Secure; SameSite=Lax'});}await env.DB.prepare('DELETE FROM connections WHERE provider=?').bind(p).run();return respond({disconnected:true});}
    if(path==='/api/metrics' && request.method==='GET') {
     // Workers Free allows 5 million D1 rows read per day. Every open dashboard polls this endpoint, so the stored
     // report is cached for two minutes (per Cloudflare location) and rebuilt only on a miss or after a write.
     const cache=(caches as unknown as {default:Cache}).default;
     const hit=await cache.match(METRICS_CACHE_KEY);
     if(hit)return respond(await hit.json());
     const report=await buildReport(env);
     await cache.put(METRICS_CACHE_KEY,new Response(JSON.stringify(report),{headers:{'Content-Type':'application/json','Cache-Control':'max-age=120'}}));
     return respond(report);
    }
    if(path==='/api/import' && request.method==='POST') {
     const reader=request.body?.getReader();if(!reader)return respond({error:'Empty request.'},400);
     let size=0;const chunks:Uint8Array[]=[];
     while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2000000){await reader.cancel();return respond({error:'Import exceeds 2 MB.'},413);}chunks.push(value);}
     const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
     let rows;try{rows=validateImport(JSON.parse(new TextDecoder().decode(body)));}catch(e){return respond({error:e instanceof Error?e.message:'Invalid import.'},400);}
     await save(env.DB,rows);return respond({imported:rows.length});
    }
    if(path==='/api/content/group'&&request.method==='POST'){let change;try{change=validateGroupChange(await request.json());}catch(e){return respond({error:e instanceof Error?e.message:'Invalid request.'},400);}await saveGroupChange(env.DB,change);return respond({saved:change.items.length});}
    // Syncs continue in waitUntil, so closing the tab or switching apps no longer kills them mid-run.
    const sync=/^\/api\/sync\/(website|app-store|facebook|instagram|tiktok|youtube|github)$/.exec(path);
    if(sync&&request.method==='POST'){
     const source=sync[1];const jobs:Record<string,()=>Promise<unknown>>={github:()=>syncGithub(env,FULL_DAYS),website:()=>syncWebsite(env),// Manual App Store sync must finish within 30 seconds of waitUntil; Sales history runs on its own slot at :45.
     'app-store':async()=>{await syncCharts(env).catch(()=>{});await syncAppleAnalytics(env);},facebook:()=>facebookPageReady(env)?syncFacebookPage(env):syncFacebook(env),instagram:()=>instagramReady(env)?syncInstagram(env):syncSocial(env,'instagram'),tiktok:()=>syncSocial(env,'tiktok'),youtube:()=>syncYouTube(env)};
     const release=await acquireLock(env.DB,source);if(!release)return respond({error:'Sync already running.'},409);
     const job=jobs[source]().catch(()=>{}).finally(()=>release());
     if(ctx){ctx.waitUntil(job);return respond({started:true},202);}
     await job;return respond({started:true});
    }
    return respond({error:'Not found.'},404);
   } catch(error){console.error('api error',path,error instanceof Error?error.message:String(error));return respond({error:'Operation failed. Check service configuration and sync history.'},502);}
  }
  if(request.method!=='GET')return respond({error:'Method not allowed.'},405);
  if(path !== '/') return new Response('Not found.', {status:404, headers});
  return asset('/app/','no-store');
 },
 async scheduled(event:ScheduledEvent,env:Env,ctx:ExecutionContext){
  if(!env.DB)return;
  const accounts=await env.DB.prepare('SELECT provider FROM connections').all<{provider:Provider}>();
  const connected=new Set(accounts.results.map(a=>a.provider));
  // Jobs run one after another. An invocation keeps at most six connections open, and requests that queued
  // behind other jobs ran out their timeouts while waiting (chart checks on 31 October 2026).
  let chain:Promise<unknown>=Promise.resolve();let jobs=0;
  const run=(source:string,fn:()=>Promise<unknown>)=>{jobs++;chain=chain.then(()=>withLock(env.DB,source,fn)).catch(()=>{});};
  // Workers Free allows 50 subrequests per invocation and 5 cron triggers per account, so hourly work is split
  // across four slots, each well under 50 requests (one run with everything exceeded the limit on 31 October 2026).
  const slot=slotFor(event.cron,event.scheduledTime);
  if(slot==='charts-website'){
   if(env.APPLE_APP_ID)run('app-store-charts',()=>syncCharts(env));
   if(websiteReady(env))run('website',()=>syncWebsite(env,new Date(event.scheduledTime).getUTCHours()===0));
   if(connected.has('tiktok')&&ready(env,'tiktok'))run('tiktok',()=>syncSocial(env,'tiktok'));
  }
  if(slot==='instagram'){
   // Workers Paid: scheduled runs may backfill all 90 days at once; manual syncs keep 12 days to fit the 30-second window.
   if(instagramReady(env))run('instagram',()=>syncInstagram(env,90));else if(connected.has('instagram')&&ready(env,'instagram'))run('instagram',()=>syncSocial(env,'instagram'));
  }
  if(slot==='facebook-youtube'){
   // Hourly runs refresh the last 14 days; the 05:00 UTC run re-reads all 90 so late-merged pull requests and gaps are corrected.
   if(githubReady(env))run('github',()=>syncGithub(env,new Date(event.scheduledTime).getUTCHours()===5?FULL_DAYS:RECENT_DAYS));
   if(facebookPageReady(env))run('facebook',()=>syncFacebookPage(env));else if(connected.has('facebook')&&ready(env,'facebook')&&env.FACEBOOK_PAGE_ID)run('facebook',()=>syncFacebook(env));
   if(connected.has('youtube')&&ready(env,'youtube'))run('youtube-videos',()=>syncYouTubeVideosHourly(env));
  }
  // Sales and Trends history fills about forty days per hourly run until a year is stored, then refreshes recent days.
  if(slot==='apple-sales'&&env.APPLE_VENDOR_NUMBER&&env.APPLE_PRIVATE_KEY&&env.APPLE_KEY_ID&&env.APPLE_ISSUER_ID&&env.APPLE_APP_ID)run('app-store-sales',()=>syncAppleSales(env,365));
  if(slot==='daily'){
   if(env.APPLE_PRIVATE_KEY&&env.APPLE_KEY_ID&&env.APPLE_ISSUER_ID&&env.APPLE_APP_ID)run('app-store',()=>syncAppleAnalytics(env));
   if(connected.has('youtube')&&ready(env,'youtube'))run('youtube',()=>syncYouTube(env));
  }
  if(jobs)ctx.waitUntil(chain);
 }
};
