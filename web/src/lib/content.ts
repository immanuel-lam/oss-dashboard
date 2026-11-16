import type {ContentRow,Source} from './metrics';
import {latestContent} from './metrics';

// One video is often posted to TikTok, Instagram, YouTube and Facebook with different captions. Items are grouped
// automatically when they come from different platforms, were published within two days of each other and share
// enough caption words; the owner's manual groupings (content_groups) always win.

export interface ContentGroup {id:string; title:string; items:ContentRow[]; published:string|null; views:number|null; likes:number|null; comments:number|null; shares:number|null; interactions:number|null; manual:boolean}
/** Likes, comments and shares that the platforms report; unreported counts are left out, not treated as zero. */
export const interactionsOf=(i:Pick<ContentRow,'likes'|'comments'|'shares'>)=>{const known=[i.likes,i.comments,i.shares].filter((v):v is number=>typeof v==='number');return known.length?known.reduce((s,v)=>s+v,0):null;};
export interface GroupOverride {source:string; content_id:string; group_id:string}

const STOP=new Set(['the','and','for','you','your','with','this','that','are','was','from','into','what','which','who','its','our','out','now','new','not','all','but','has','have','just','one','about','here','there','they','them','then','than','how','why','when','where','will','can','get','got','app','store','data','link','bio']);
export function words(text:string){
 const t=text.toLowerCase().replace(/https?:\/\/\S+/g,' ').replace(/[#@][\p{L}\p{N}_]+/gu,' ');
 // Times and counts such as "8:12" or "1,197" are distinctive across captions, so keep them whole.
 const numbers=t.match(/\d+[:,.]\d+/g)??[];
 return new Set([...numbers,...t.replace(/\d+[:,.]\d+/g,' ').replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(w=>w.length>=3&&!STOP.has(w))]);
}
export function similarity(a:string,b:string){
 const x=words(a),y=words(b);if(!x.size||!y.size)return {ratio:0,shared:0};let shared=0;for(const w of x)if(y.has(w))shared++;
 return {ratio:shared/Math.min(x.size,y.size),shared};
}
const time=(iso?:string|null)=>iso?Date.parse(iso):NaN;
/** Likely the same video: different platforms, published close together, and at least two distinctive caption words in common.
    The closer the dates, the less caption overlap is needed; undated items need a near match. */
export function sameVideo(a:ContentRow,b:ContentRow){
 if(a.source===b.source)return false;
 const ta=time(a.published_at),tb=time(b.published_at);const dated=Number.isFinite(ta)&&Number.isFinite(tb);const gap=dated?Math.abs(ta-tb):Infinity;
 if(dated&&gap>48*3600000)return false;
 const {ratio,shared}=similarity(a.title,b.title);if(shared<2)return false;
 return ratio>=(!dated?0.6:gap<=24*3600000?0.25:0.34);
}
const keyOf=(i:{source:string;content_id:string})=>i.source+'|'+i.content_id;
const sum=(items:ContentRow[],k:'views'|'likes'|'comments'|'shares')=>{const known=items.map(i=>i[k]).filter((v):v is number=>typeof v==='number');return known.length?known.reduce((s,v)=>s+v,0):null;};
const SOURCE_RANK:Partial<Record<Source,number>>={youtube:0,tiktok:1,instagram:2,facebook:3};
/** A readable name: the YouTube title when there is one, otherwise the first line of the earliest caption. */
function titleFor(items:ContentRow[]){
 const pick=[...items].sort((a,b)=>(SOURCE_RANK[a.source]??9)-(SOURCE_RANK[b.source]??9))[0];
 const line=(pick?.title??'').split('\n')[0].replace(/\s+#\S+/g,'').trim();
 return line.length>110?line.slice(0,107).trimEnd()+'…':line||'Untitled';
}

export function groupContent(content:ContentRow[]|undefined,overrides:GroupOverride[]=[]):ContentGroup[]{
 const items=latestContent(content);const manual=new Map(overrides.map(o=>[keyOf(o),o.group_id]));
 const groups=new Map<string,ContentRow[]>();const manualIds=new Set<string>();
 const free:ContentRow[]=[];
 for(const item of items){const g=manual.get(keyOf(item));if(g){groups.set(g,[...(groups.get(g)??[]),item]);manualIds.add(g);}else free.push(item);}
 // Union-find over free items; at most one item per platform in an automatic group.
 const parent=free.map((_,i)=>i);const find=(i:number):number=>parent[i]===i?i:(parent[i]=find(parent[i]));
 const sorted=free.map((item,i)=>({item,i})).sort((a,b)=>(time(a.item.published_at)||0)-(time(b.item.published_at)||0));
 for(let a=0;a<sorted.length;a++)for(let b=a+1;b<sorted.length;b++){
  const x=sorted[a],y=sorted[b];if(!sameVideo(x.item,y.item))continue;
  const rx=find(x.i),ry=find(y.i);if(rx===ry)continue;
  const sourcesX=new Set(free.filter((_,k)=>find(k)===rx).map(i=>i.source));
  if(free.some((it,k)=>find(k)===ry&&sourcesX.has(it.source)))continue;
  parent[ry]=rx;
 }
 free.forEach((item,i)=>{const id='auto:'+keyOf(free[find(i)]);groups.set(id,[...(groups.get(id)??[]),item]);});
 return [...groups.entries()].map(([id,list])=>{
  const published=list.map(i=>i.published_at).filter((v):v is string=>Boolean(v)).sort()[0]??null;
  const each=list.map(interactionsOf).filter((v):v is number=>v!==null);
  return {id,title:titleFor(list),items:list.sort((a,b)=>(SOURCE_RANK[a.source]??9)-(SOURCE_RANK[b.source]??9)),published,views:sum(list,'views'),likes:sum(list,'likes'),comments:sum(list,'comments'),shares:sum(list,'shares'),interactions:each.length?each.reduce((s,v)=>s+v,0):null,manual:manualIds.has(id)};
 }).sort((a,b)=>(b.views??-1)-(a.views??-1));
}
