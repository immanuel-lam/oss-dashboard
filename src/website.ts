import {save,validateImport,type Metric} from './data';
export interface WebsiteEnv {DB:D1Database;POSTHOG_PROJECT_ID?:string;POSTHOG_API_KEY?:string;POSTHOG_HOST?:string;CLOUDFLARE_ANALYTICS_TOKEN?:string;CLOUDFLARE_ANALYTICS_ACCOUNT?:string;CLOUDFLARE_ANALYTICS_SITE?:string;SITE_HOSTNAMES?:string}
export function cloudflareReady(env:WebsiteEnv){return !!(env.CLOUDFLARE_ANALYTICS_TOKEN&&env.CLOUDFLARE_ANALYTICS_ACCOUNT&&/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ANALYTICS_ACCOUNT)&&env.CLOUDFLARE_ANALYTICS_SITE&&/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ANALYTICS_SITE));}
export function websiteReady(env:WebsiteEnv){return cloudflareReady(env)||!!(env.POSTHOG_API_KEY&&env.POSTHOG_PROJECT_ID&&/^\d+$/.test(env.POSTHOG_PROJECT_ID));}
/** SITE_HOSTNAMES limits website reports to your own hosts, for example "example.com,www.example.com". Empty counts every host. */
export function hostnames(value?:string){
 const hosts=(value??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
 for(const h of hosts)if(!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h))throw Error('SITE_HOSTNAMES must be plain host names.');
 return hosts;
}
export function pageViewQuery(hosts:string[]=[]){
 const filter=hosts.length?" AND properties.$host IN ("+hosts.map(h=>"'"+h+"'").join(', ')+")":'';
 return "SELECT toString(toDate(toTimeZone(timestamp, 'UTC'))) AS day, count() AS views FROM events WHERE event = '$pageview' AND timestamp >= toStartOfDay(now('UTC')) - INTERVAL 90 DAY AND timestamp < toStartOfDay(now('UTC'))"+filter+" GROUP BY day ORDER BY day LIMIT 90";
}
export function pageViewMetrics(results:unknown):Metric[]{
 if(!Array.isArray(results)||results.length>90)throw Error('Unexpected website report.');
 if(!results.length)return [];
 return validateImport(results.map(row=>{if(!Array.isArray(row)||row.length!==2||typeof row[0]!=='string'||typeof row[1]!=='number'||!Number.isSafeInteger(row[1]))throw Error('Unexpected website report.');return {source:'website',date:row[0],metric:'page_views',value:row[1],unit:'count',timezone:'UTC',provenance:'PostHog: opted-in public website page views; not unique visitors'};}));
}
export const cloudflareQuery=(hosts:string[]=[])=>'query($account:String!,$site:String!,$start:Time!,$end:Time!'+(hosts.length?',$hosts:[String!]':'')+'){viewer{accounts(filter:{accountTag:$account}){rumPageloadEventsAdaptiveGroups(limit:100,filter:{datetime_geq:$start,datetime_lt:$end,siteTag:$site'+(hosts.length?',requestHost_in:$hosts':'')+'},orderBy:[date_ASC]){count sum{visits} dimensions{date}}}}}';
export function cloudflareMetrics(report:any,maxDays=30):Metric[]{
 if(report.errors?.length||!Array.isArray(report.data?.viewer?.accounts)||report.data.viewer.accounts.length!==1)throw Error('Cloudflare analytics unavailable.');
 const groups=report.data.viewer.accounts[0].rumPageloadEventsAdaptiveGroups;
 if(!Array.isArray(groups)||groups.length>maxDays)throw Error('Incomplete Cloudflare report.');
 if(!groups.length)return [];
 return validateImport(groups.flatMap((row:any)=>{if(typeof row.count!=='number'||typeof row.sum?.visits!=='number'||!Number.isSafeInteger(row.count)||!Number.isSafeInteger(row.sum.visits))throw Error('Unexpected Cloudflare counts.');return [{source:'website',date:row.dimensions?.date,metric:'page_views',value:row.count,unit:'count',timezone:'UTC',provenance:'Cloudflare Web Analytics: browser page loads; may be sampled; not unique people'},{source:'website',date:row.dimensions?.date,metric:'visits',value:row.sum.visits,unit:'count',timezone:'UTC',provenance:'Cloudflare Web Analytics: visits, not unique people; may be sampled'}];}));
}
const DAY=86400000;
// Cloudflare keeps Web Analytics for 184 days and allows 93 days per query, but adaptive sampling grows with the
// window: on 31 October 2026 a 30-day query returned 1-in-100 samples with most days missing, while 7-day queries
// returned exact recent counts (sampleInterval 1). Query in 7-day chunks. Hourly runs refresh the last 14 days;
// the daily run (and a manual sync) re-reads the full 180 days so earlier coarse values are replaced.
export const CHUNK_DAYS=7,RECENT_DAYS=14,RETENTION_DAYS=180;
export function chunks(today:Date,full:boolean):[Date,Date][]{
 const end=new Date(today);end.setUTCHours(0,0,0,0);const out:[Date,Date][]=[];
 const span=full?RETENTION_DAYS:RECENT_DAYS;
 for(let back=0;back<span;back+=CHUNK_DAYS){const e=new Date(end.getTime()-back*DAY);const st=new Date(e.getTime()-Math.min(CHUNK_DAYS,span-back)*DAY);out.push([st,e]);}
 return out;
}
async function cloudflareReport(env:WebsiteEnv,start:Date,end:Date){const days=Math.round((end.getTime()-start.getTime())/DAY);const response=await fetch('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{Authorization:'Bearer '+env.CLOUDFLARE_ANALYTICS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query:cloudflareQuery(hostnames(env.SITE_HOSTNAMES)),variables:{account:env.CLOUDFLARE_ANALYTICS_ACCOUNT,site:env.CLOUDFLARE_ANALYTICS_SITE,start:start.toISOString(),end:end.toISOString(),...(hostnames(env.SITE_HOSTNAMES).length?{hosts:hostnames(env.SITE_HOSTNAMES)}:{})}}),signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error('Cloudflare query failed.');return cloudflareMetrics(await response.json(),days);}
export async function syncWebsite(env:WebsiteEnv,full=true){
 if(!websiteReady(env))throw Error('Website analytics is not configured.');
 const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO sync_runs(id,source,started_at,status) VALUES(?,?,?,?)').bind(id,'website',new Date().toISOString(),'running').run();
 try{
  let rows:Metric[];if(cloudflareReady(env)){
  rows=[];for(const [start,end] of chunks(new Date(),full))rows.push(...await cloudflareReport(env,start,end));
 }else{
  const response=await fetch((env.POSTHOG_HOST||'https://us.posthog.com').replace(/\/$/,'')+'/api/projects/'+env.POSTHOG_PROJECT_ID+'/query/',{method:'POST',headers:{Authorization:'Bearer '+env.POSTHOG_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({query:{kind:'HogQLQuery',query:pageViewQuery(hostnames(env.SITE_HOSTNAMES))},refresh:'blocking'}),signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw Error('Website query failed.');
  const report:any=await response.json();if(report.error||report.hasMore===true||report.has_more===true)throw Error('Incomplete website report.');
  rows=pageViewMetrics(report.results);}
  if(rows.length)await save(env.DB,rows);
  await env.DB.prepare('UPDATE sync_runs SET finished_at=?,status=?,message=? WHERE id=?').bind(new Date().toISOString(),'success',rows.length+' daily website metric values synced from '+(cloudflareReady(env)?'Cloudflare Web Analytics.':'PostHog (opted-in visits only).')+' Days without returned events remain unavailable.',id).run();return {rows:rows.length};
 }catch(error){await env.DB.prepare('UPDATE sync_runs SET finished_at=?,status=?,message=? WHERE id=?').bind(new Date().toISOString(),'error','Website sync failed. Check analytics credentials, read permissions and service availability.',id).run();throw error;}
}
