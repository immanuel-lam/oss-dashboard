import {save,validateImport,type Metric} from './data.ts';
import {SafeError,safeMessage} from './safe-error.ts';

// Facebook Page via a Meta business system user (token never expires, Page task ANALYZE only). The system-user token
// lists the Page and returns a Page token, which is required for Page insights and posts (checked 1 November 2026).
export interface FacebookPageEnv {DB:D1Database; FACEBOOK_ACCESS_TOKEN?:string; FACEBOOK_PAGE_ID?:string}
export const facebookPageReady=(env:FacebookPageEnv)=>Boolean(env.FACEBOOK_ACCESS_TOKEN&&env.FACEBOOK_PAGE_ID&&/^\d{6,25}$/.test(env.FACEBOOK_PAGE_ID));

const API='https://graph.facebook.com/v25.0';
export const TIMEZONE='America/Los_Angeles';
// Page insights metrics that exist in Graph API v25 (older page_impressions_* and page_fan_adds_* were removed).
export const PAGE_METRICS={page_media_view:'views',page_total_media_view_unique:'viewers',page_views_total:'page_visits',page_post_engagements:'engagements',page_daily_follows_unique:'new_followers'} as const;
export const DAYS=90,POSTS=25;

/** Daily values arrive with the end of each Pacific day as end_time; the reported day is the day before. */
export function pageRows(body:any):Metric[]{
 if(!Array.isArray(body?.data))throw new SafeError('Unexpected Facebook insights response.');
 const rows:Metric[]=[];
 for(const series of body.data){const metric=PAGE_METRICS[series?.name as keyof typeof PAGE_METRICS];if(!metric||!Array.isArray(series.values))continue;
  for(const v of series.values){const end=String(v?.end_time??'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(end)||typeof v.value!=='number'||!Number.isFinite(v.value)||v.value<0)continue;
   const date=new Date(Date.parse(end)-86400000).toISOString().slice(0,10);
   rows.push({source:'facebook',date,metric,value:v.value,unit:'count',timezone:TIMEZONE,provenance:'Facebook Page insights (daily)'});}}
 return rows;
}

export async function syncFacebookPage(env:FacebookPageEnv){
 if(!facebookPageReady(env))throw Error('Facebook Page is not configured.');
 const id=crypto.randomUUID();
 await env.DB.prepare('INSERT INTO sync_runs(id,source,started_at,status) VALUES(?,?,?,?)').bind(id,'facebook',new Date().toISOString(),'running').run();
 const finish=(status:string,message:string)=>env.DB.prepare('UPDATE sync_runs SET finished_at=?,status=?,message=? WHERE id=?').bind(new Date().toISOString(),status,message,id).run();
 let step='getting the Page token';
 const get=async(path:string,params:Record<string,string>,token:string)=>{
  const u=new URL(API+path);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
  const r=await fetch(u,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
  if(!r.ok){let code='';try{code=String((await r.json() as any)?.error?.code??'');}catch{}throw new SafeError('Facebook request failed (HTTP '+r.status+(code?', code '+code:'')+').');}
  return r.json() as Promise<any>;
 };
 try{
  const page=env.FACEBOOK_PAGE_ID!;
  const accounts=await get('/me/accounts',{fields:'id,access_token'},env.FACEBOOK_ACCESS_TOKEN!);
  const pageToken=(accounts.data??[]).find((p:any)=>p?.id===page)?.access_token;
  if(typeof pageToken!=='string')throw new SafeError('The system user has no access to the Page. Assign the Page with Insights access.');

  step='reading the Page';
  const info=await get('/'+page,{fields:'followers_count'},pageToken);const observed=new Date().toISOString().slice(0,10);
  const snapshots:Metric[]=typeof info.followers_count==='number'&&info.followers_count>=0?[{source:'facebook',date:observed,metric:'followers_snapshot',value:info.followers_count,unit:'count',timezone:'UTC',provenance:'Facebook Page followers; observed total, not daily gains'}]:[];
  if(snapshots.length)await save(env.DB,validateImport(snapshots));

  step='reading Page insights';
  const until=Math.floor(Date.now()/1000);
  const insights=await get('/'+page+'/insights',{metric:Object.keys(PAGE_METRICS).join(','),period:'day',since:String(until-DAYS*86400),until:String(until)},pageToken);
  const daily=pageRows(insights);
  for(let i=0;i<daily.length;i+=4900)await save(env.DB,validateImport(daily.slice(i,i+4900)));

  step='reading posts';
  const posts=await get('/'+page+'/posts',{fields:'id,message,created_time,permalink_url,shares',limit:String(POSTS)},pageToken);
  if(!Array.isArray(posts.data))throw new SafeError('Unexpected Facebook posts response.');
  const val=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
  const statements=[];
  for(const post of posts.data){
   const link=new URL(String(post.permalink_url));if(link.protocol!=='https:'||!/(^|\.)facebook\.com$/.test(link.hostname))throw new SafeError('Unexpected Facebook post URL.');
   let views:number|null=null,reactions:number|null=null;
   try{const r=await get('/'+post.id+'/insights',{metric:'post_media_view,post_reactions_by_type_total'},pageToken);
    for(const m of r.data??[]){const v=m.values?.[0]?.value;if(m.name==='post_media_view')views=val(v);if(m.name==='post_reactions_by_type_total')reactions=v&&typeof v==='object'?Object.values(v).reduce((s:number,n)=>s+(val(n)??0),0):0;}}catch{/* keep unavailable */}
   const title=String(post.message??'Facebook post').split('\n')[0].slice(0,1000)||'Facebook post';
   statements.push(env.DB.prepare('INSERT INTO content_snapshots(source,content_id,observed_date,title,url,published_at,views,likes,comments,shares) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,content_id,observed_date) DO UPDATE SET title=excluded.title,url=excluded.url,views=excluded.views,likes=excluded.likes,shares=excluded.shares')
    .bind('facebook',String(post.id),observed,title,link.toString(),post.created_time??null,views,reactions,null,val(post.shares?.count)??0));
  }
  if(statements.length)await env.DB.batch(statements);const stored=statements.length;
  await finish('success',`${snapshots.length} follower value, ${daily.length} daily insight values and ${stored} posts synced.`);
  return {rows:snapshots.length+daily.length,posts:stored};
 }catch(e){await finish('error','Facebook sync failed while '+step+': '+safeMessage(e));throw e;}
}
