import {accessToken,type OAuthEnv} from './oauth';
import {save,validateImport,type Metric} from './data';
export interface ConnectorEnv { DB:D1Database; YOUTUBE_CLIENT_ID?:string; YOUTUBE_CLIENT_SECRET?:string; YOUTUBE_REFRESH_TOKEN?:string }

class ProviderError extends Error { constructor(readonly status:number){ super(`Provider returned HTTP ${status}.`); } }
async function json(url:string,init?:RequestInit):Promise<any> {
 const response=await fetch(url,{...init,signal:AbortSignal.timeout(25000)});
 if(!response.ok) throw new ProviderError(response.status);
 return response.json();
}

// Daily rows lag by up to ~3 days. The first sync backfills a year so the dashboard starts with history;
// later syncs refresh the last 90 days, which also picks up late revisions.
const RECENT_DAYS=90, BACKFILL_DAYS=365;
const names=['views','estimatedMinutesWatched','subscribersGained','subscribersLost','likes','comments','shares'];
const mapped=['views','watch_minutes','subscribers_gained','subscribers_lost','likes','comments','shares'];

/** Resolves the channel the grant belongs to. Returns null when the grant predates the youtube.readonly scope. */
async function channelId(token:string):Promise<{id:string;title:string}|null> {
 try {
  const body=await json('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true',{headers:{Authorization:'Bearer '+token}});
  const id=body?.items?.[0]?.id;
  if(typeof id!=='string'||!/^UC[\w-]{22}$/.test(id)) throw new NoChannel();
  // The public channel title is shown in sync history so the owner can see which channel the grant covers.
  const title=String(body.items[0].snippet?.title??'').replace(/[\u0000-\u001f]/g,'').slice(0,80);
  return {id,title};
 } catch(error) {
  if(error instanceof ProviderError&&(error.status===401||error.status===403)) return null;
  throw error;
 }
}
class NoChannel extends Error {}

/** Lifetime views, likes and comments for the latest uploads (YouTube Data API). Returns the number of videos stored. */
export async function syncYouTubeVideos(db:D1Database,token:string,channelId:string){
 const headers={Authorization:'Bearer '+token};
 const channel=await json('https://www.googleapis.com/youtube/v3/channels?part=contentDetails,statistics&id='+encodeURIComponent(channelId),{headers});
 // Channel totals are public counters that update within minutes (the same numbers Social Blade tracks). Stored as daily
 // snapshots: growth comes from comparing observations on different dates, never from adding them.
 const stats=channel?.items?.[0]?.statistics;const today=new Date().toISOString().slice(0,10);const count=(v:unknown)=>{const n=Number(v);return v!==undefined&&Number.isFinite(n)&&n>=0?n:null;};
 const totals:Metric[]=([['viewCount','channel_views_snapshot'],['subscriberCount','subscribers_snapshot'],['videoCount','video_count_snapshot']] as const).flatMap(([field,metric])=>{
  if(field==='subscriberCount'&&stats?.hiddenSubscriberCount)return [];const value=count(stats?.[field]);
  return value===null?[]:[{source:'youtube' as const,date:today,metric,value,unit:'count',timezone:'UTC',provenance:'YouTube Data API channel statistics; observed total, not daily gains'}];});
 if(totals.length)await save(db,validateImport(totals));
 const uploads=channel?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;if(typeof uploads!=='string')return 0;
 const list=await json('https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId='+encodeURIComponent(uploads),{headers});
 const ids=(list?.items??[]).map((i:any)=>i?.contentDetails?.videoId).filter((v:unknown)=>typeof v==='string'&&/^[\w-]{11}$/.test(v as string));if(!ids.length)return 0;
 const videos=await json('https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id='+ids.join(','),{headers});
 const observed=new Date().toISOString().slice(0,10);const num=(v:unknown)=>{const n=Number(v);return v!==undefined&&Number.isFinite(n)&&n>=0?n:null;};
 const statements=(videos?.items??[]).map((v:any)=>db.prepare('INSERT INTO content_snapshots(source,content_id,observed_date,title,url,published_at,views,likes,comments,shares) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,content_id,observed_date) DO UPDATE SET title=excluded.title,views=excluded.views,likes=excluded.likes,comments=excluded.comments')
  .bind('youtube',String(v.id),observed,String(v.snippet?.title??'YouTube video').slice(0,1000),'https://www.youtube.com/watch?v='+v.id,v.snippet?.publishedAt??null,num(v.statistics?.viewCount),num(v.statistics?.likeCount),num(v.statistics?.commentCount),null));
 if(statements.length)await db.batch(statements);
 return statements.length;
}

export async function syncYouTube(env:ConnectorEnv & OAuthEnv) {
 const id=crypto.randomUUID(); const start=new Date().toISOString();
 await env.DB.prepare('INSERT INTO sync_runs(id,source,started_at,status) VALUES(?,?,?,?)').bind(id,'youtube',start,'running').run();
 const finish=(status:string,message:string)=>env.DB.prepare('UPDATE sync_runs SET finished_at=?,status=?,message=? WHERE id=?').bind(new Date().toISOString(),status,message,id).run();
 try {
  const auth=await accessToken(env,'youtube');
  if(typeof auth.access_token!=='string') throw Error('Provider did not return an access token.');
  const channel=await channelId(auth.access_token);
  const stored=await env.DB.prepare("SELECT COUNT(*) AS n FROM metrics WHERE source='youtube'").first<{n:number}>();
  const end=new Date();end.setUTCDate(end.getUTCDate()-2);
  const begin=new Date(end);begin.setUTCDate(begin.getUTCDate()-((stored?.n??0)>0?RECENT_DAYS:BACKFILL_DAYS)+1);
  const query=new URLSearchParams({ids:channel?'channel=='+channel.id:'channel==MINE',startDate:begin.toISOString().slice(0,10),endDate:end.toISOString().slice(0,10),dimensions:'day',metrics:names.join(','),sort:'day'});
  const report=await json('https://youtubeanalytics.googleapis.com/v2/reports?'+query,{headers:{Authorization:'Bearer '+auth.access_token}});
  if(!Array.isArray(report.columnHeaders)||report.columnHeaders.map((h:any)=>h.name).join(',')!==['day',...names].join(',')) throw Error('Unexpected YouTube report schema.');
  const rows:Metric[]=[];
  for(const row of report.rows??[]) for(let i=0;i<names.length;i++) rows.push({source:'youtube',date:row[0],metric:mapped[i],value:row[i+1],unit:i===1?'minutes':'count',timezone:'America/Los_Angeles',provenance:'YouTube Analytics API'});
  // validateImport accepts at most 5,000 rows per call.
  for(let i=0;i<rows.length;i+=4900) await save(env.DB,validateImport(rows.slice(i,i+4900)));
  const named=channel?.title?' Channel: '+channel.title+'.':'';
  // Video totals arrive immediately, while Analytics reports lag two to three days.
  let videoNote='';if(channel){try{const n=await syncYouTubeVideos(env.DB,auth.access_token,channel.id);videoNote=n?' '+n+' videos updated.':'';}catch{videoNote=' Video totals unavailable.';}}
  // A full report of zeros usually means the grant covers a different channel from the one being measured.
  const allZero=rows.length>0&&rows.every(r=>r.value===0);
  if(!rows.length){
   // The API omits rows when the channel has no data in the range. Missing data stays missing, never zero.
   await finish('waiting',channel?'YouTube returned no daily rows for this channel yet. New activity can take up to three days to appear.'+named+videoNote:'YouTube returned no daily rows. Reconnect YouTube, choose the channel you own and approve channel access.');
   return {rows:0};
  }
  await finish(channel&&!allZero?'success':'partial',`${rows.length} daily metric values synced.`+named+videoNote+(allZero?' Daily reports are all zero so far; they lag two to three days behind new uploads.':'')+(channel?'':' Reconnect YouTube to approve channel access.'));
  return {rows:rows.length};
 } catch(error) {
  // Never store raw provider response bodies, tokens or account details.
  const message=error instanceof NoChannel?'The connected Google account has no YouTube channel. Reconnect and choose the channel you own.'
   :error instanceof ProviderError&&(error.status===401||error.status===403)?'YouTube refused access. Reconnect YouTube and approve analytics access.'
   :'Sync failed. Check credentials, permissions and provider availability.';
  await finish('error',message);
  throw error;
 }
}

/** Hourly: refresh lifetime video totals only. Analytics reports stay on the daily schedule. Failures are recorded; successes are not, to keep sync history short. */
export async function syncYouTubeVideosHourly(env:ConnectorEnv & OAuthEnv){
 try{const auth=await accessToken(env,'youtube');const channel=await channelId(auth.access_token);if(!channel)return {videos:0};return {videos:await syncYouTubeVideos(env.DB,auth.access_token,channel.id)};}
 catch(error){await env.DB.prepare('INSERT INTO sync_runs(id,source,started_at,finished_at,status,message) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),'youtube',new Date().toISOString(),new Date().toISOString(),'error','YouTube video totals failed: '+(error instanceof ProviderError?'HTTP '+error.status+'.':'check the YouTube connection.')).run();throw error;}
}
