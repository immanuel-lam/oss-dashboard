import {boundedBytes} from './limits.ts';
import {importPKCS8,SignJWT} from 'jose';
import {save,validateImport,type Metric} from './data.ts';
import type {AppleEnv} from './apple';
import {SafeError,safeMessage} from './safe-error.ts';

// Report names returned by the Analytics Reports API (checked 31 October 2026). Only the Standard report is
// read: Detailed repeats the same downloads with more dimensions, so reading both would double-count.
export const DOWNLOAD_REPORTS=['App Downloads Standard','App Downloads'];
// Values from Apple's App Downloads field reference; compared case-insensitively ("First-time Download").
const downloadTypes:Record<string,string>={'first-time download':'first_downloads','redownload':'redownloads','auto-update':'automatic_updates','manual update':'manual_updates','restore':'restores'};
// Per run: the newest two instances are always refreshed, plus older instances whose dates are not stored yet.
// Each instance costs about two subrequests, which keeps a run well inside Worker limits.
export const MAX_INSTANCES_PER_RUN=8;

export function parseDownloads(text:string):Metric[]{
 const lines=text.trim().split(/\r?\n/);const h=lines.shift()?.replace(/^﻿/,'').split('\t')??[];
 const indexes=['Date','Download Type','Counts'].map(k=>h.indexOf(k));if(indexes.some(i=>i<0))throw new SafeError('Unexpected downloads columns: '+h.slice(0,20).join(', ').slice(0,160)+'.');
 const totals=new Map<string,Metric>();
 for(const line of lines){
  const r=line.split('\t');const [date,type,count]=indexes.map(i=>r[i]);
  const metric=downloadTypes[String(type).trim().toLowerCase()];if(!metric)throw new SafeError('Unknown download type "'+String(type).slice(0,40)+'"; report requires review.');
  const value=Number(count);if(!count||!Number.isFinite(value)||value<0)throw new SafeError('Invalid report count.');
  const key=date+'/'+metric;const prev=totals.get(key);
  if(prev)prev.value+=value;else totals.set(key,{source:'app-store',date,metric,value,unit:'count',timezone:'UTC',provenance:'App Store Analytics Reports: App Downloads (Standard)'});
 }
 return totals.size?validateImport([...totals.values()]):[];
}

/** Chooses which daily instances to download: the newest two, then the newest instances for dates not yet stored. */
export function pickInstances<T extends {attributes:{processingDate:string}}>(instances:T[],stored:Set<string>,max=MAX_INSTANCES_PER_RUN):T[]{
 const sorted=[...instances].sort((a,b)=>b.attributes.processingDate.localeCompare(a.attributes.processingDate));
 const picked=sorted.slice(0,2);
 for(const i of sorted.slice(2)){if(picked.length>=max)break;if(!stored.has(i.attributes.processingDate))picked.push(i);}
 return picked;
}

export async function syncAppleAnalytics(env:AppleEnv){
 if(!env.APPLE_PRIVATE_KEY||!env.APPLE_KEY_ID||!env.APPLE_ISSUER_ID||!env.APPLE_APP_ID)throw new SafeError('Apple configuration incomplete.');
 const token=await new SignJWT({}).setProtectedHeader({alg:'ES256',kid:env.APPLE_KEY_ID,typ:'JWT'}).setIssuer(env.APPLE_ISSUER_ID).setAudience('appstoreconnect-v1').setIssuedAt().setExpirationTime('15m').sign(await importPKCS8(env.APPLE_PRIVATE_KEY,'ES256'));
 const api=async(path:string)=>{const u=new URL(path,'https://api.appstoreconnect.apple.com');if(u.origin!=='https://api.appstoreconnect.apple.com')throw new SafeError('Invalid API pagination URL.');const r=await fetch(u,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(25000)});if(!r.ok)throw new SafeError('Apple API request failed (HTTP '+r.status+').');return r.json() as Promise<any>;};
 const list=async(path:string)=>{let next:string|undefined=path;const rows:any[]=[];for(let i=0;next&&i<50;i++){const page=await api(next);rows.push(...page.data);next=page.links?.next;}if(next)throw new SafeError('Report pagination limit reached.');return rows;};
 const id=crypto.randomUUID();
 await env.DB.prepare('INSERT INTO sync_runs(id,source,started_at,status) VALUES(?,?,?,?)').bind(id,'app-store',new Date().toISOString(),'running').run();
 const finish=(status:string,message:string)=>env.DB.prepare('UPDATE sync_runs SET finished_at=?,status=?,message=? WHERE id=?').bind(new Date().toISOString(),status,message,id).run();
 let step='listing report requests';
 try{
  const storedRows=await env.DB.prepare("SELECT DISTINCT date FROM metrics WHERE source='app-store'").all<{date:string}>();
  const stored=new Set((storedRows.results??[]).map(r=>r.date));
  const requests=(await list('/v1/apps/'+encodeURIComponent(env.APPLE_APP_ID)+'/analyticsReportRequests')).filter(r=>r.attributes.accessType==='ONGOING'&&!r.attributes.stoppedDueToInactivity);
  let stored_=0,instancesSeen=0,reportFound=false;
  for(const request of requests){
   step='listing reports';
   const reports=(await list('/v1/analyticsReportRequests/'+request.id+'/reports')).filter(r=>DOWNLOAD_REPORTS.includes(r.attributes.name));
   const report=reports.sort((a,b)=>DOWNLOAD_REPORTS.indexOf(a.attributes.name)-DOWNLOAD_REPORTS.indexOf(b.attributes.name))[0];
   if(!report)continue;reportFound=true;
   step='listing daily instances';
   const instances=await list('/v1/analyticsReports/'+report.id+'/instances?filter[granularity]=DAILY');
   for(const instance of pickInstances(instances,stored)){
    step='listing segments for '+instance.attributes.processingDate;
    const segments=await list('/v1/analyticsReportInstances/'+instance.id+'/segments');const combined=new Map<string,Metric>();
    for(const segment of segments){
     step='downloading the '+instance.attributes.processingDate+' report';
     const u=new URL(segment.attributes.url);if(u.protocol!=='https:')throw new SafeError('Unsafe report URL.');
     const response=await fetch(u,{redirect:'follow',signal:AbortSignal.timeout(25000)});if(!response.url.startsWith('https://'))throw new SafeError('Report redirected to a non-HTTPS URL.');if(!response.ok)throw new SafeError('Report download failed (HTTP '+response.status+').');
     let stream=response.body;if(!stream)throw new SafeError('Empty report.');const bytes=await boundedBytes(stream,20000000);if(bytes.length>20000000)throw new SafeError('Report too large.');
     stream=bytes[0]===31&&bytes[1]===139?new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')):new Blob([bytes]).stream();
     const text=new TextDecoder().decode(await boundedBytes(stream,40000000));if(!text.trim())continue;
     for(const row of parseDownloads(text)){const key=row.date+'/'+row.metric;const prev=combined.get(key);if(prev)prev.value+=row.value;else combined.set(key,row);}
    }
    if(combined.size){await save(env.DB,[...combined.values()]);stored_+=combined.size;}
    instancesSeen++;
   }
   break; // one ongoing request is enough; a second would only repeat the same days
  }
  if(instancesSeen)await finish('success',`${stored_} values stored from ${instancesSeen} report instances.`);
  else await finish('waiting',reportFound?'Apple has not generated daily App Downloads instances yet. Generation may take 24–48 hours.':'No App Downloads report found under the ongoing report request yet.');
  return {rows:stored_,waiting:!instancesSeen};
 }catch(e){await finish('error','Analytics sync failed while '+step+': '+safeMessage(e));throw e;}
}
