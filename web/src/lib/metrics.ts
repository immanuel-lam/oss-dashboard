// Analytics rules for the dashboard UI. Pure functions only, so tests can run them without a browser.
// Unavailable data is never zero, snapshots are never summed across dates, and lifetime totals never get a period change.

import {parseRepoMetric} from '../../../src/github-repos';

export type Source='app-store'|'google-play'|'youtube'|'instagram'|'tiktok'|'facebook'|'website'|'github';
export interface MetricRow {source:Source; date:string; metric:string; value:number; unit:string; timezone:string; provenance?:string; updated_at?:string}
export interface ContentRow {source:Source; content_id:string; observed_date:string; title:string; url:string; published_at?:string|null; views:number|null; likes:number|null; comments:number|null; shares:number|null}
export interface VideoObservation {content_id:string; observed_date:string; title:string; views:number|null}
export interface SyncRun {source:Source; status:string; started_at:string; finished_at?:string|null; message?:string|null}
export interface Report {
 settings?:{name:string; profiles:Partial<Record<Source,string>>}; metrics:MetricRow[]; content?:ContentRow[]; contentHistory?:{source:Source;content_id:string;observed_date:string;views:number}[]; contentGroups?:{source:string;content_id:string;group_id:string}[]; videoHistory?:VideoObservation[]; videoHistoryTruncated?:boolean; truncated?:boolean;
 runs:SyncRun[]; accounts?:{provider:Source; updated_at:string}[]; oauth?:Partial<Record<Source,boolean>>;
 connectors:{github?:boolean; instagram?:boolean; facebook?:boolean; website?:boolean; websiteProvider?:'cloudflare'|'posthog'; apple?:boolean; youtube?:boolean};
}

export const DAY=86400000;
// Display order for tiles, collection status and connections.
export const labels:Record<Source,string>={'app-store':'App Store','google-play':'Google Play',website:'Website',tiktok:'TikTok',instagram:'Instagram',youtube:'YouTube',facebook:'Facebook',github:'GitHub'};
export const sources=Object.keys(labels) as Source[];
export const primary:Record<Source,string>={'app-store':'first_downloads','google-play':'installs',youtube:'channel_views_snapshot',instagram:'views',tiktok:'followers_snapshot',facebook:'views',website:'page_views',github:'commits'};
const metricNames:Record<string,string>={page_views:'Page views',visits:'Visits',views:'Views',watch_minutes:'Watch time',subscribers_gained:'Subscribers gained',subscribers_lost:'Subscribers lost',likes:'Likes',comments:'Comments',shares:'Shares',first_downloads:'First downloads',redownloads:'Redownloads',installs:'Installs',followers_snapshot:'Followers',following_count_snapshot:'Following',likes_count_snapshot:'Likes',video_count_snapshot:'Videos',media_count_snapshot:'Posts',page_likes_snapshot:'Page likes',automatic_updates:'Automatic updates',manual_updates:'Manual updates',restores:'Restores',sales_first_downloads:'First downloads (Sales)',reach:'Accounts reached',channel_views_snapshot:'Channel views',subscribers_snapshot:'Subscribers',viewers:'Viewers',page_visits:'Page visits',engagements:'Engagements',profile_views:'Profile visits',accounts_engaged:'Accounts engaged',interactions:'Interactions',saves:'Saves',new_followers:'New followers',rank_overall_snapshot:'Top free chart rank',sales_redownloads:'Redownloads (Sales)',sales_updates:'Updates (Sales)',commits:'Commits',pull_requests:'Pull requests',pull_requests_merged:'Pull requests merged'};
/** Genre chart ranks are named after the configured genre: rank_navigation_snapshot reads "Navigation". */
export const chartName=(metric:string)=>metric==='rank_overall_snapshot'?'All apps':metric.replace(/^rank_/,'').replace(/_snapshot$/,'').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
/** Per-repository GitHub metrics read as "Commits · hello-world". */
export const metricName=(metric:string)=>{const repo=parseRepoMetric(metric);if(repo)return metricNames[repo.kind]+' · '+repo.name;if(metricNames[metric])return metricNames[metric];if(/^rank_[a-z_]+_snapshot$/.test(metric))return chartName(metric)+' chart rank';return metric.replaceAll('_snapshot','').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());};
export const isSnapshot=(metric:string)=>metric.endsWith('_snapshot');
export const keyOf=(r:{source:string;metric:string;unit:string;timezone:string})=>[r.source,r.metric,r.unit,r.timezone].join('|');
export const addDays=(iso:string,n:number)=>new Date(Date.parse(iso)+n*DAY).toISOString().slice(0,10);

export type Period='7'|'28'|'90'|'custom';
export interface Range {start:string; end:string; custom:boolean}
/** Presets end at the start of today (UTC), exclusive; custom ranges use the chosen exclusive end. */
export function rangeFor(period:Period,custom:{start:string;end:string}|null,now=new Date()):Range{
 if(period==='custom'&&custom)return {start:custom.start,end:custom.end,custom:true};
 const end=new Date(now);end.setUTCHours(0,0,0,0);const start=new Date(end.getTime()-Number(period==='custom'?28:period)*DAY);
 return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10),custom:false};
}
export const rangeDays=(r:Range)=>Math.round((Date.parse(r.end)-Date.parse(r.start))/DAY);
/** Snapshot metrics include today's observation for presets; daily reports cover complete days only. */
export const inRange=(row:{date:string;metric:string},r:Range)=>row.date>=r.start&&(row.date<r.end||(row.date===r.end&&isSnapshot(row.metric)&&!r.custom));
export const visible=(report:Report,r:Range)=>report.metrics.filter(row=>inRange(row,r));

export interface Change {kind:'percent'|'absolute'|'rank'; value:number; title:string}
/** Chart positions: lower is better, shown as #n. */
export const isRank=(metric:string)=>metric.startsWith('rank_');
const fmtDate=(iso:string)=>new Date(iso+'T00:00:00Z').toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
/** Pairs each reported day with the day one period earlier and compares matched days only, so lag or gaps cannot fake a decline. */
export function dailyChange(metrics:MetricRow[],series:{source:string;metric:string;unit:string;timezone:string},r:Range):Change|null{
 const days=rangeDays(r);if(!(days>0))return null;const prevStart=addDays(r.start,-days);const key=keyOf(series);
 const prev=new Map(metrics.filter(m=>keyOf(m)===key&&m.date>=prevStart&&m.date<r.start).map(m=>[m.date,m.value]));
 let pairs=0,cur=0,before=0;
 for(const m of metrics){if(keyOf(m)!==key||m.date<r.start||m.date>=r.end)continue;const p=prev.get(addDays(m.date,-days));if(p===undefined)continue;pairs++;cur+=m.value;before+=p;}
 if(pairs<Math.max(2,Math.ceil(days/2))||!(before>0))return null;
 return {kind:'percent',value:(cur-before)/before*100,title:'Compared with '+fmtDate(prevStart)+' – '+fmtDate(addDays(r.start,-1))+' on '+pairs+' matching days'};
}
/** First and last observation inside the period. Needs two dates. */
export function snapshotChange(rows:{date:string;value:number}[],rank=false):Change|null{
 if(new Set(rows.map(r=>r.date)).size<2)return null;const sorted=[...rows].sort((a,b)=>a.date.localeCompare(b.date));
 return rank?{kind:'rank',value:sorted[0].value-sorted.at(-1)!.value,title:'Places moved since '+fmtDate(sorted[0].date)}:{kind:'absolute',value:sorted.at(-1)!.value-sorted[0].value,title:'Change since '+fmtDate(sorted[0].date)};
}

/** One latest lifetime observation per item, independent of the reporting period. */
export function latestContent(content:ContentRow[]=[],source?:Source){
 const latest=new Map<string,ContentRow>();
 for(const item of content){if((source&&item.source!==source)||!item.content_id)continue;const id=item.source+'|'+item.content_id;const p=latest.get(id);if(!p||item.observed_date>p.observed_date)latest.set(id,item);}
 return [...latest.values()];
}
const knownViews=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
export function contentViews(content:ContentRow[]|undefined,source:Source){
 const items=latestContent(content,source);const known=items.filter(i=>knownViews(i.views));
 const total=known.reduce((s,i)=>s+(i.views as number),0);
 return {value:known.length&&Number.isFinite(total)?total:null,known:known.length,loaded:items.length,dates:[...new Set(known.map(i=>i.observed_date))].sort()};
}

export interface ChartRank {value:number; name:string; change:Change|null; series:string}
export interface Tile {id:string; chart?:ChartRank; source:Source; label:string; value:number|null; metric:string; name:string; coverage:string; change:Change|null; series:string; spark:{date:string;value:number}[]; hasData:boolean; followers?:number|null; extra?:string; video?:ReturnType<typeof contentViews>; detail:string}
const latestFollowers=(rows:MetricRow[],source:Source)=>[...rows].filter(x=>x.source===source&&x.metric===(source==='youtube'?'subscribers_snapshot':'followers_snapshot')).sort((a,b)=>b.date.localeCompare(a.date))[0]?.value??null;
export function tiles(report:Report,r:Range):Tile[]{
 const rows=visible(report,r);const days=rangeDays(r);
 const list:Tile[]=sources.map(source=>{
  // App Store prefers Analytics downloads; Sales and Trends units fill in when Analytics has nothing in the period.
  const metric=source==='app-store'&&!rows.some(x=>x.source===source&&x.metric===primary[source])&&rows.some(x=>x.source===source&&x.metric==='sales_first_downloads')?'sales_first_downloads':primary[source];const own=rows.filter(x=>x.source===source&&x.metric===metric);
  const compatible=new Set(own.map(x=>x.unit+'|'+x.timezone)).size<=1;const latest=[...own].sort((a,b)=>b.date.localeCompare(a.date))[0];
  const snapshot=isSnapshot(metric);const video=source==='tiktok'?contentViews(report.content,source):undefined;
  const value=video?video.value:latest&&compatible?(snapshot?latest.value:own.reduce((s,x)=>s+x.value,0)):null;
  const change=video||!latest||!compatible?null:snapshot?snapshotChange(own):dailyChange(report.metrics,latest,r);
  const coverage=video?video.known+' of '+video.loaded+' loaded videos':latest&&!snapshot&&own.length<days?own.length+' of '+days+' days reported':'';
  const detail=video?(video.dates.length?'Observed '+video.dates.join(', ')+' UTC. ':'')+'Views are independent of reporting period and may exclude other videos.':latest?(compatible?latest.unit+' · '+latest.timezone:'Mixed units or time zones'):'No reports in this period.';
  // GitHub's tile leads with commits; pull requests opened in the same period sit beneath it.
  const opened=source==='github'?rows.filter(x=>x.source==='github'&&x.metric==='pull_requests'):[];const openedTotal=opened.reduce((s,x)=>s+x.value,0);const extra=opened.length?openedTotal.toLocaleString()+(openedTotal===1?' pull request':' pull requests'):undefined;
  return {id:source,source,label:labels[source],value,metric,name:video?'Lifetime video views':metricName(metric),coverage,extra,change,series:latest&&compatible?keyOf(latest):'',spark:compatible?[...own].sort((a,b)=>a.date.localeCompare(b.date)).map(x=>({date:x.date,value:x.value})):[],hasData:Boolean(latest||value!==null),followers:video?(latest&&compatible?latest.value:null):(source==='instagram'||source==='facebook'||source==='youtube')&&own.length?latestFollowers(rows,source):undefined,video,detail};
 });
 // Chart position rides on the App Store tile (latest snapshot in the period; lower is better).
 // Genre charts lead (alphabetically, for a stable choice); the overall chart is the fallback.
 const rankMetrics=[...new Set(rows.filter(x=>x.source==='app-store'&&isRank(x.metric)).map(x=>x.metric))].sort((a,b)=>Number(a==='rank_overall_snapshot')-Number(b==='rank_overall_snapshot')||a.localeCompare(b));
 const charts=rankMetrics.map(metric=>rows.filter(x=>x.source==='app-store'&&x.metric===metric)).find(list=>list.length);
 if(charts){const sorted=[...charts].sort((a,b)=>a.date.localeCompare(b.date));const latest=sorted.at(-1)!;const app=list.find(t=>t.source==='app-store')!;
  app.chart={value:latest.value,name:chartName(latest.metric),change:snapshotChange(sorted,true),series:keyOf(latest)};
  app.hasData=true;if(!app.series)app.series=app.chart.series;}
 return list;
}

export interface Series {key:string; label:string; detail:string; snapshot:boolean; video:boolean; points:{date:string;value:number}[]}
/** All chartable series in the period: daily reports, snapshots and per-video lifetime views (never summed across videos). */
export function chartSeries(report:Report,r:Range):Series[]{
 const history=(report.videoHistory??[]).filter(h=>knownViews(h.views)).map(h=>({source:'tiktok' as Source,metric:'video_'+encodeURIComponent(h.content_id)+'_views_snapshot',date:h.observed_date,value:h.views as number,unit:'count',timezone:'UTC',title:h.title}));
 const rows:(MetricRow&{title?:string})[]=[...visible(report,r),...history.filter(h=>inRange(h,r))];
 const groups=new Map<string,typeof rows>();for(const row of rows){const k=keyOf(row);groups.set(k,[...(groups.get(k)??[]),row]);}
 return [...groups.entries()].map(([key,list])=>{const [source,metric,unit,timezone]=key.split('|');const title=list.find(x=>x.title)?.title;
  return {key,label:title?'TikTok · '+title.slice(0,70)+' · lifetime views':labels[source as Source]+' · '+metricName(metric)+(unit!=='count'&&unit!=='rank'?' ('+unit+')':''),detail:unit+' · '+timezone+' reporting days',snapshot:isSnapshot(metric),video:metric.startsWith('video_'),points:list.map(x=>({date:x.date,value:x.value})).sort((a,b)=>a.date.localeCompare(b.date))};
 }).sort((a,b)=>a.key.localeCompare(b.key));
}
/** Prefers a daily report with several dates, then per-video history, then anything with more points. */
// Audience metrics open first; GitHub activity is one click away.
export function defaultSeries(list:Series[]){const audience=list.filter(s=>sourceOf(s.key)!=='github');const candidates=audience.length?audience:list;const score=(s:Series)=>(s.points.length>1?10000:0)+(s.video?1000:!s.snapshot?2000:0)+s.points.length;return [...candidates].sort((a,b)=>score(b)-score(a))[0]?.key;}
export function previousPoints(report:Report,key:string,r:Range){const days=rangeDays(r);if(isSnapshot(key.split('|')[1]??'')||!(days>0))return [];return report.metrics.filter(m=>keyOf(m)===key&&m.date>=addDays(r.start,-days)&&m.date<r.start).map(m=>({date:addDays(m.date,days),value:m.value}));}
export function seriesChange(report:Report,s:Series,r:Range){if(s.video)return null;if(s.snapshot)return snapshotChange(s.points,isRank(s.key.split('|')[1]));const [source,metric,unit,timezone]=s.key.split('|');return dailyChange(report.metrics,{source,metric,unit,timezone},r);}
/** Source of a series key. */
export const sourceOf=(key:string)=>key.split('|')[0] as Source;
/** Metric tabs for one source: its headline metric first, chart rank last, per-video history excluded (it has its own entry). */
export function sourceSeries(list:Series[],source:Source){
 const own=list.filter(s=>sourceOf(s.key)===source&&!s.video&&!parseRepoMetric(s.key.split('|')[1]));
 const order=(s:Series)=>{const m=s.key.split('|')[1];return m===primary[source]?0:isRank(m)?3:m.startsWith('sales_')?2:1;};
 return own.sort((a,b)=>order(a)-order(b)||a.key.split('|')[1].localeCompare(b.key.split('|')[1])||a.key.localeCompare(b.key)).slice(0,5);
}
/** Short tab label: the metric name without the source prefix. */
export const metricLabel=(s:Series)=>s.video?s.label:metricName(s.key.split('|')[1]).replace(' chart rank',' rank');
