import {save,validateImport,type Metric} from './data.ts';
import {SafeError,safeMessage} from './safe-error.ts';

// Instagram via Meta's Unified login: a system-user token (never expires) for one professional account, read through
// graph.facebook.com. The older Instagram-login path is not available to new Meta apps (checked 31 October 2026).
export interface InstagramEnv {DB:D1Database; INSTAGRAM_ACCESS_TOKEN?:string; INSTAGRAM_USER_ID?:string}
export const instagramReady=(env:InstagramEnv)=>Boolean(env.INSTAGRAM_ACCESS_TOKEN&&env.INSTAGRAM_USER_ID&&/^\d{6,25}$/.test(env.INSTAGRAM_USER_ID));

const API='https://graph.facebook.com/v25.0';
// Instagram reports account insights by Pacific-time day.
export const TIMEZONE='America/Los_Angeles';
// Daily totals, one request per day. `views`, `reach` and the rest only support total_value for a window.
export const DAILY_METRICS={views:'views',reach:'reach',profile_views:'profile_views',accounts_engaged:'accounts_engaged',total_interactions:'interactions',likes:'likes',comments:'comments',shares:'shares',saves:'saves'} as const;
// Instagram keeps account insights for about two years but limits each window to 30 days; history fills gradually.
export const LOOKBACK_DAYS=90,DAYS_PER_RUN=12,MEDIA_LIMIT=25;
/** Runs tasks a few at a time; manual syncs must finish inside the Worker's post-response window. */
export async function inBatches<T,R>(items:T[],size:number,fn:(item:T)=>Promise<R>){const out:R[]=[];for(let i=0;i<items.length;i+=size)out.push(...await Promise.all(items.slice(i,i+size).map(fn)));return out;}

/** Start of a Pacific-time day as a Unix timestamp, handling daylight saving. */
export function pacificMidnight(date:string){
 const guess=Date.parse(date+'T08:00:00Z');
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:TIMEZONE,hour:'numeric',hourCycle:'h23'}).formatToParts(new Date(guess));
 const hour=Number(parts.find(p=>p.type==='hour')?.value??0);
 return Math.round((guess-hour*3600000)/1000);
}
export const pacificToday=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:TIMEZONE}).format(now);
const back=(date:string,n:number)=>new Date(Date.parse(date)-n*86400000).toISOString().slice(0,10);

/** Days to request: yesterday and the day before always (late revisions), then the newest unstored days. Today is incomplete. */
export function insightDays(today:string,stored:Set<string>,max=DAYS_PER_RUN){
 const days:string[]=[];
 for(let n=1;n<=LOOKBACK_DAYS&&days.length<max;n++){const d=back(today,n);if(n<=2||!stored.has(d))days.push(d);}
 return days;
}

/** Maps one total_value insights response to daily metrics. Missing metrics stay missing; a reported zero stays zero. */
export function dailyRows(body:any,date:string):Metric[]{
 if(!Array.isArray(body?.data))throw new SafeError('Unexpected Instagram insights response.');
 const rows:Metric[]=[];
 for(const item of body.data){const metric=DAILY_METRICS[item?.name as keyof typeof DAILY_METRICS];const value=item?.total_value?.value;
  if(metric&&typeof value==='number'&&Number.isFinite(value)&&value>=0)rows.push({source:'instagram',date,metric,value,unit:'count',timezone:TIMEZONE,provenance:'Instagram Graph API account insights (daily total)'});}
 return rows;
}

export async function syncInstagram(env:InstagramEnv,daysPerRun=DAYS_PER_RUN){
 if(!instagramReady(env))throw Error('Instagram is not configured.');
 const id=crypto.randomUUID();
 await env.DB.prepare('INSERT INTO sync_runs(id,source,started_at,status) VALUES(?,?,?,?)').bind(id,'instagram',new Date().toISOString(),'running').run();
 const finish=(status:string,message:string)=>env.DB.prepare('UPDATE sync_runs SET finished_at=?,status=?,message=? WHERE id=?').bind(new Date().toISOString(),status,message,id).run();
 let step='reading the account';
 const get=async(path:string,params:Record<string,string>)=>{
  const u=new URL(API+path);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
  const r=await fetch(u,{headers:{Authorization:'Bearer '+env.INSTAGRAM_ACCESS_TOKEN},signal:AbortSignal.timeout(20000)});
  if(!r.ok){let code='';try{code=String((await r.json() as any)?.error?.code??'');}catch{}throw new SafeError('Instagram request failed (HTTP '+r.status+(code?', code '+code:'')+').');}
  return r.json() as Promise<any>;
 };
 try{
  const user=env.INSTAGRAM_USER_ID!;const today=pacificToday();const observed=new Date().toISOString().slice(0,10);
  const account=await get('/'+user,{fields:'followers_count,follows_count,media_count'});
  const snapshots:Metric[]=[['followers_count','followers_snapshot'],['follows_count','following_count_snapshot'],['media_count','media_count_snapshot']].flatMap(([field,metric])=>typeof account[field]==='number'&&account[field]>=0?[{source:'instagram' as const,date:observed,metric,value:account[field],unit:'count',timezone:'UTC',provenance:'Instagram Graph API account snapshot; observed total, not daily gains'}]:[]);
  if(!snapshots.length)throw new SafeError('Instagram account fields are missing.');
  await save(env.DB,validateImport(snapshots));

  step='reading daily insights';
  const stored=await env.DB.prepare("SELECT DISTINCT date FROM metrics WHERE source='instagram' AND metric='views'").all<{date:string}>();
  const days=insightDays(today,new Set((stored.results??[]).map(r=>r.date)),daysPerRun);let daily=0;
  const perDay=await inBatches(days,4,date=>get('/'+user+'/insights',{metric:Object.keys(DAILY_METRICS).join(','),period:'day',metric_type:'total_value',since:String(pacificMidnight(date)),until:String(pacificMidnight(back(date,-1)))}).then(body=>dailyRows(body,date)));
  const dailyAll=perDay.flat();if(dailyAll.length){await save(env.DB,validateImport(dailyAll));daily=dailyAll.length;}
  // New followers per day come as a time series for the last 30 days.
  const followers=await get('/'+user+'/insights',{metric:'follower_count',period:'day',since:String(pacificMidnight(back(today,29))),until:String(pacificMidnight(today))});
  const gains:Metric[]=(followers.data?.[0]?.values??[]).flatMap((v:any)=>{const date=back(String(v?.end_time??'').slice(0,10),1);return typeof v?.value==='number'&&v.value>=0&&/^\d{4}-\d{2}-\d{2}$/.test(date)?[{source:'instagram' as const,date,metric:'new_followers',value:v.value,unit:'count',timezone:TIMEZONE,provenance:'Instagram Graph API follower_count (new followers per day)'}]:[];});
  if(gains.length)await save(env.DB,validateImport(gains));

  step='reading posts';
  const media=await get('/'+user+'/media',{fields:'id,caption,permalink,timestamp,like_count,comments_count,media_product_type',limit:String(MEDIA_LIMIT)});
  if(!Array.isArray(media.data))throw new SafeError('Unexpected Instagram media response.');
  const val=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;let posts=0;
  const insights=await inBatches(media.data as any[],4,async item=>{let views:number|null=null,shares:number|null=null;
   try{const insight=await get('/'+item.id+'/insights',{metric:'views,shares'});for(const m of insight.data??[]){if(m.name==='views')views=val(m.values?.[0]?.value);if(m.name==='shares')shares=val(m.values?.[0]?.value);}}catch{/* some post types have no insights; keep them unavailable */}
   return {views,shares};});
  const statements=media.data.map((item:any,i:number)=>{
   const link=new URL(String(item.permalink));if(link.protocol!=='https:'||!['www.instagram.com','instagram.com'].includes(link.hostname))throw new SafeError('Unexpected Instagram post URL.');
   return env.DB.prepare('INSERT INTO content_snapshots(source,content_id,observed_date,title,url,published_at,views,likes,comments,shares) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,content_id,observed_date) DO UPDATE SET title=excluded.title,url=excluded.url,views=excluded.views,likes=excluded.likes,comments=excluded.comments,shares=excluded.shares')
    .bind('instagram',String(item.id),observed,String(item.caption??'Instagram post').slice(0,1000),link.toString(),item.timestamp??null,insights[i].views,val(item.like_count),val(item.comments_count),insights[i].shares);});
  if(statements.length)await env.DB.batch(statements);posts=statements.length;
  await finish('success',`${snapshots.length} account values, ${daily} daily insight values for ${days.length} days, ${gains.length} follower days and ${posts} posts synced.`);
  return {rows:snapshots.length+daily+gains.length,posts};
 }catch(e){await finish('error','Instagram sync failed while '+step+': '+safeMessage(e));throw e;}
}
