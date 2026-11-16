import {useRef,useState} from 'react';
import {AnimatePresence,motion} from 'motion/react';
import {ExternalLink,FileJson,RefreshCw,Search,Upload} from 'lucide-react';
import {Card} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {SourceIcon} from '@/components/brand';
import {StatusBadge} from '@/components/widgets';
import {ShowMore} from '@/components/show-more';
import {labels,sources,type Report,type Source} from '@/lib/metrics';
import {ago,fmt} from '@/lib/format';
import {api,download} from '@/lib/api';
import {cn} from '@/lib/utils';

const ease=[.22,1,.36,1] as const;

const social=['youtube','instagram','tiktok','facebook'] as const;
const RUNS_SHOWN=5;

export function Connections({report,reload,notify}:{report:Report;reload:()=>Promise<void>;notify:(m:string)=>void}){
 const [busy,setBusy]=useState<string>();
 const [allRuns,setAllRuns]=useState(false);
 const runs=allRuns?report.runs:report.runs.slice(0,RUNS_SHOWN);
 // Syncs run in the background on the server; re-read stored reports a few times so the result appears without a manual refresh.
 const run=async(id:string,fn:()=>Promise<unknown>)=>{setBusy(id);try{await fn();await reload();if(id.endsWith(':sync'))for(const wait of [4000,10000,20000])setTimeout(()=>{reload();},wait);}catch(e){notify((e as Error).message);}finally{setBusy(undefined);}};
 return <div>
  <div className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">{sources.map((s,i)=>{
   const stored=report.metrics.filter(m=>m.source===s);const last=stored.map(m=>m.updated_at).filter(Boolean).sort().at(-1);
   const connected=(report.accounts??[]).some(a=>a.provider===s);const configured=(s==='youtube'&&report.connectors.youtube)||(s==='app-store'&&report.connectors.apple)||(s==='website'&&report.connectors.website)||(s==='instagram'&&report.connectors.instagram)||(s==='facebook'&&report.connectors.facebook)||(s==='github'&&report.connectors.github);
   const state=configured?'Configured':connected?'Connected':stored.length?'Imported reports':'Not connected';
   const about=s==='github'?'Commits and pull requests across the repositories in GITHUB_REPOS, by UTC day. Commits are those on each default branch, and pull requests count on the day they are opened or merged. Syncs hourly.':s==='youtube'?'Automatic daily report sync when credentials are configured.':s==='app-store'?'Daily Analytics Reports. First reports may take 24–48 hours.':s==='google-play'?'Beta placeholder. No automatic collection.':s==='facebook'&&report.connectors.facebook?'Meta system-user token with Insights access to your Facebook Page: followers, daily views, viewers, Page visits, engagements and new follows (Pacific-time days), and post views and reactions. Syncs hourly.':s==='instagram'&&report.connectors.instagram?'Meta system-user token for your Instagram account: followers, daily views, reach, profile visits and interactions (Pacific-time days), and post views. Syncs hourly.':s==='website'?(report.connectors.websiteProvider==='cloudflare'?'Cloudflare Web Analytics page views and visits. Complete UTC days; syncs hourly.':'PostHog public page views, opted-in visitors only. Complete UTC days; syncs hourly.'):'Connect your account to collect daily totals and post snapshots.';
   const isSocial=(social as readonly string[]).includes(s)&&!(s==='instagram'&&report.connectors.instagram)&&!(s==='facebook'&&report.connectors.facebook);const oauthReady=Boolean(report.oauth?.[s]);
   const syncable=(s==='instagram'&&report.connectors.instagram)||(s==='facebook'&&report.connectors.facebook)?true:s==='website'?report.connectors.website:s==='app-store'?report.connectors.apple:s==='youtube'?report.connectors.youtube:s==='github'?report.connectors.github:isSocial&&connected;
   return <motion.article key={s} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{duration:.45,delay:i*.04,ease}} className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-card">
    <div className="flex items-center gap-2.5"><SourceIcon source={s} className="size-8 rounded-lg"/><h2 className="text-[15px] font-semibold">{labels[s]}</h2>
     <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground"><i className={cn('size-1.5 rounded-full bg-muted-foreground',(configured||connected)&&'bg-up')}/>{state}</span></div>
    <span className="text-xs text-muted-foreground">{last?'Last stored '+ago(last):'No stored data'}</span>
    {report.settings?.profiles[s]&&<a href={report.settings.profiles[s]} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1 text-[13px] text-foreground/80 hover:text-primary">Open channel<ExternalLink className="size-3.5"/></a>}
    <details className="text-[12.5px] text-muted-foreground"><summary className="w-fit cursor-pointer hover:text-foreground">Collection details</summary><p className="mt-1">{about}</p></details>
    {isSocial&&!oauthReady&&<span className="text-xs text-muted-foreground">Provider application setup required.</span>}
    {<div className="mt-auto flex flex-wrap gap-1.5">
     {isSocial&&<Button size="sm" variant="outline" data-connect={s} disabled={!oauthReady||busy===s+':connect'} onClick={()=>run(s+':connect',async()=>{const r=await api<{url:string}>('connect/'+s,{});location.assign(r.url);})}>{connected?'Reconnect':'Connect account'}</Button>}
     {(syncable||!isSocial)&&s!=='google-play'&&<Button size="sm" variant="outline" disabled={!syncable||busy===s+':sync'} onClick={()=>run(s+':sync',()=>api('sync/'+s,{}))}><RefreshCw className={cn('size-3.5',busy===s+':sync'&&'animate-spin')}/>Sync</Button>}
     {isSocial&&connected&&<Button size="sm" variant="ghost" className="text-muted-foreground hover:text-down" onClick={()=>{if(confirm('Disconnect this account? Stored metrics will remain.'))run(s+':disconnect',()=>api('disconnect/'+s,{}));}}>Disconnect</Button>}
    </div>}
   </motion.article>;})}</div>
  <h2 className="mt-8 mb-3 text-base font-semibold">Sync history</h2>
  <ol className="ml-3 border-l">{runs.length?runs.map(r=><li key={r.source+r.started_at} className="relative pb-4 pl-6 text-[13px]">
   <span className="absolute top-0 -left-3 grid size-6 place-items-center rounded-full bg-background"><StatusBadge status={r.status} iconOnly/></span>
   <b className="font-semibold">{labels[r.source]??r.source}</b><span className="text-muted-foreground"> · </span><time dateTime={r.started_at} title={r.started_at} className="text-xs text-muted-foreground tabular">{ago(r.started_at)}</time>
   <p className="mt-0.5 text-[12.5px] text-muted-foreground">{r.message||'In progress'}</p>
  </li>):<li className="pl-6 text-[13px] text-muted-foreground">No sync attempts yet.</li>}</ol>
  <ShowMore total={report.runs.length} shown={RUNS_SHOWN} expanded={allRuns} onToggle={()=>setAllRuns(v=>!v)} className="ml-9"/>
 </div>;
}

export function Import({reload}:{reload:()=>Promise<void>}){
 const input=useRef<HTMLInputElement>(null);
 const [rows,setRows]=useState<unknown[]>();const [name,setName]=useState('');const [summary,setSummary]=useState('');const [dragging,setDragging]=useState(false);const [busy,setBusy]=useState(false);
 const choose=async(file?:File)=>{setRows(undefined);setSummary('');if(!file)return;setName(file.name);if(file.size>2000000){setSummary('File exceeds 2 MB.');return;}
  try{const parsed=JSON.parse(await file.text());if(!Array.isArray(parsed)||!parsed.length||parsed.length>5000)throw Error('Expected 1–5000 rows.');setRows(parsed);setSummary(parsed.length+' rows selected. Import will replace matching source/date/metric records. Server validation runs before any write.');}catch(e){setSummary((e as Error).message);}};
 const template=()=>download('platform-import-template.json',JSON.stringify([{source:'app-store',date:new Date(Date.now()-86400000).toISOString().slice(0,10),metric:'first_downloads',value:0,unit:'count',timezone:'America/Los_Angeles',provenance:'Replace with report name; replace example value before import'}],null,2),'application/json');
 return <div className="grid items-start gap-8 lg:grid-cols-2">
  <div>
   <h2 className="mb-3 text-base font-semibold">Import a report</h2>
   <p className="max-w-[60ch] text-[13.5px] text-muted-foreground">Daily metrics as JSON. Reimporting the same source, date and metric replaces its value. Use distinct names for first downloads, redownloads and installs.</p>
   <details className="my-4 text-[13px] text-muted-foreground"><summary className="w-fit cursor-pointer hover:text-foreground">Report format</summary><p className="mt-1">Each row needs source, date, metric, value, unit, IANA time zone and provenance. Maximum 5,000 rows or 2 MB.</p></details>
   <Button variant="outline" onClick={template}><FileJson className="size-4"/>Download template</Button>
  </div>
  <div className="space-y-3">
   <motion.button type="button" onClick={()=>input.current?.click()} animate={{scale:dragging?1.015:1}} transition={{type:'spring',stiffness:400,damping:30}}
    onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);choose(e.dataTransfer.files[0]);}}
    className={cn('grid w-full justify-items-center gap-2 rounded-xl border-[1.5px] border-dashed bg-card px-6 py-10 text-center text-muted-foreground transition-colors hover:border-primary hover:text-foreground',dragging&&'border-primary bg-primary/10 text-foreground')}>
    <motion.span animate={{y:dragging?-4:0}}><Upload className="size-7"/></motion.span>
    <AnimatePresence mode="wait"><motion.span key={name||'empty'} initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-4}} className="text-[13.5px]">{name||'Choose or drop a JSON report'}</motion.span></AnimatePresence>
   </motion.button>
   <input ref={input} id="file" type="file" accept="application/json,.json" className="sr-only" onChange={e=>choose(e.target.files?.[0])}/>
   {summary&&<p className="text-[13px] text-muted-foreground">{summary}</p>}
   <Button disabled={!rows||busy} onClick={async()=>{if(!rows)return;setBusy(true);try{const r=await api<{imported:number}>('import',rows);setSummary(r.imported+' metric values imported.');setRows(undefined);await reload();}catch(e){setSummary((e as Error).message);}finally{setBusy(false);}}}>Import report</Button>
  </div>
 </div>;
}
