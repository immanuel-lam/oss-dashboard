import {importPKCS8,SignJWT} from 'jose';
import {save,validateImport,type Metric} from './data.ts';
import {SafeError,safeMessage} from './safe-error.ts';
export interface AppleEnv {DB:D1Database; APPLE_PRIVATE_KEY?:string; APPLE_KEY_ID?:string; APPLE_ISSUER_ID?:string; APPLE_VENDOR_NUMBER?:string; APPLE_APP_ID?:string}

// Sales and Trends units are kept under their own metric names: they are App Store Connect "Units" in Pacific
// time, which is not the same measure as the Analytics Reports downloads, so the two are never merged.
export const SALES_METRICS={first:'sales_first_downloads',redownload:'sales_redownloads',update:'sales_updates'} as const;
// Apple keeps daily Sales reports for about a year and publishes a day after it closes (Pacific time).
export const SALES_LOOKBACK_DAYS=365,SALES_FIRST_DAY_BACK=2,SALES_MAX_DAYS_PER_RUN=20;
const provenance='App Store Connect Sales and Trends daily summary: units, Pacific time';

export function parseSales(text:string,appId:string,date:string):Metric[]{
 const lines=text.trim().split(/\r?\n/);const header=lines.shift()?.replace(/^﻿/,'').split('\t')??[];
 const col=(name:string)=>{const i=header.indexOf(name);if(i<0)throw new SafeError('Unexpected Sales report columns.');return i;};
 const app=col('Apple Identifier'),type=col('Product Type Identifier'),units=col('Units');
 const totals={[SALES_METRICS.first]:0,[SALES_METRICS.redownload]:0,[SALES_METRICS.update]:0};
 for(const line of lines){const r=line.split('\t');if(r[app]!==appId)continue;const n=Number(r[units]);if(!Number.isFinite(n)||n<0)throw new SafeError('Unexpected Sales units.');
  const code=r[type];if(['1','1F','1T'].includes(code))totals[SALES_METRICS.first]+=n;else if(['3','3F'].includes(code))totals[SALES_METRICS.redownload]+=n;else if(['7','7F','7T'].includes(code))totals[SALES_METRICS.update]+=n;
 }
 return Object.entries(totals).map(([metric,value])=>({source:'app-store',date,metric,value,unit:'count',timezone:'America/Los_Angeles',provenance}));
}

/** Newest days first: the two most recent publishable days always, then the newest days that are not stored yet. */
export function salesDays(today:Date,stored:Set<string>,max=SALES_MAX_DAYS_PER_RUN){
 const days:string[]=[];
 for(let back=SALES_FIRST_DAY_BACK;back<=SALES_LOOKBACK_DAYS&&days.length<max;back++){const d=new Date(today.getTime()-back*86400000).toISOString().slice(0,10);if(back<SALES_FIRST_DAY_BACK+2||!stored.has(d))days.push(d);}
 return days;
}

/** Fills App Store history from Sales and Trends, about twenty days per run, walking back from the newest missing day. */
export async function syncAppleSales(env:AppleEnv,maxDays=SALES_MAX_DAYS_PER_RUN){
 if(!env.APPLE_PRIVATE_KEY||!env.APPLE_KEY_ID||!env.APPLE_ISSUER_ID||!env.APPLE_VENDOR_NUMBER||!env.APPLE_APP_ID)throw Error('Apple Sales configuration is incomplete.');
 const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO sync_runs(id,source,started_at,status) VALUES(?,?,?,?)').bind(id,'app-store',new Date().toISOString(),'running').run();
 const finish=(status:string,message:string)=>env.DB.prepare('UPDATE sync_runs SET finished_at=?,status=?,message=? WHERE id=?').bind(new Date().toISOString(),status,message,id).run();
 try{
  const key=await importPKCS8(env.APPLE_PRIVATE_KEY,'ES256');const token=await new SignJWT({}).setProtectedHeader({alg:'ES256',kid:env.APPLE_KEY_ID,typ:'JWT'}).setIssuer(env.APPLE_ISSUER_ID).setAudience('appstoreconnect-v1').setIssuedAt().setExpirationTime('10m').sign(key);
  const storedRows=await env.DB.prepare('SELECT DISTINCT date FROM metrics WHERE source=? AND metric=?').bind('app-store',SALES_METRICS.first).all<{date:string}>();
  const days=salesDays(new Date(),new Set((storedRows.results??[]).map(r=>r.date)),maxDays);
  let count=0,empty=0,pending=0;
  for(const date of days){
   const params=new URLSearchParams({'filter[frequency]':'DAILY','filter[reportType]':'SALES','filter[reportSubType]':'SUMMARY','filter[version]':'1_0','filter[vendorNumber]':env.APPLE_VENDOR_NUMBER,'filter[reportDate]':date});
   const response=await fetch('https://api.appstoreconnect.apple.com/v1/salesReports?'+params,{headers:{Authorization:'Bearer '+token,Accept:'application/a-gzip'},signal:AbortSignal.timeout(25000)});
   if(response.status===404){
    // Apple answers 404 both for "no sales that day" and for days not published yet. Only older days are a true zero.
    if(Date.now()-Date.parse(date)>4*86400000){await save(env.DB,validateImport(parseSales('Apple Identifier\tProduct Type Identifier\tUnits',env.APPLE_APP_ID,date)));empty++;}else pending++;
    continue;
   }
   if(!response.ok)throw new SafeError('Apple Sales request failed (HTTP '+response.status+').');
   const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>10000000)throw new SafeError('Apple Sales report exceeds limit.');
   const text=bytes[0]===31&&bytes[1]===139?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(bytes);
   if(text.length>20000000)throw new SafeError('Decoded Sales report exceeds limit.');
   const rows=validateImport(parseSales(text,env.APPLE_APP_ID,date));await save(env.DB,rows);count+=rows.length;
  }
  await finish('success',`Sales and Trends: ${days.length} days checked, ${count} values stored`+(empty?`, ${empty} days with no units`:'')+(pending?`, ${pending} not published yet`:'')+'.');
  return {rows:count};
 }catch(e){await finish('error','Sales and Trends sync failed: '+safeMessage(e));throw e;}
}
