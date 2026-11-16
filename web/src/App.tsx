import {useCallback,useEffect,useState} from 'react';
import {AnimatePresence,motion} from 'motion/react';
import {ChartNoAxesCombined,CircleHelp,FileText,LayoutDashboard,Moon,Plug,RefreshCw,Sun,Upload} from 'lucide-react';
import {RangePicker} from '@/components/range-picker';
import {GlassTabBar} from '@/components/glass-tab-bar';
import {Overview} from '@/views/overview';
import {Connections,Import} from '@/views/other';
import {Content} from '@/views/content';
import {loadReport} from '@/lib/api';
import {rangeFor,type Period,type Report} from '@/lib/metrics';
import {shortDate} from '@/lib/format';
import {addDays} from '@/lib/metrics';
import {cn} from '@/lib/utils';

const tabs=[{id:'overview',label:'Overview',icon:LayoutDashboard},{id:'content',label:'Content',icon:FileText},{id:'connections',label:'Connections',icon:Plug},{id:'import',label:'Import',icon:Upload}] as const;
type Tab=typeof tabs[number]['id'];
const titles:Record<Tab,string>={overview:'Overview',content:'Content',connections:'Connections',import:'Import data'};
const ease=[.22,1,.36,1] as const;

export function App(){
 const [tab,setTab]=useState<Tab>('overview');
 const [report,setReport]=useState<Report>();
 const [notice,setNotice]=useState('');
 const [loading,setLoading]=useState(false);
 const [period,setPeriod]=useState<Period>('28');
 const [custom,setCustom]=useState<{start:string;end:string}|null>(null);
 const [light,setLight]=useState(()=>document.documentElement.classList.contains('light'));

 const load=useCallback(async()=>{setLoading(true);try{const r=await loadReport();setReport(r);document.title=r.settings?.name??'Dashboard';
  setNotice(!r.metrics.length?'No reports yet. Connect YouTube or import your first report.':r.truncated?'Metric history is limited to 20,000 audience values and 5,000 GitHub values. Export includes loaded records.':'');
  if(r.videoHistoryTruncated)setNotice(n=>(n+' Video history is limited to 5,000 observations.').trim());
 }catch(e){setNotice((e as Error).message);}finally{setLoading(false);}},[]);
 useEffect(()=>{load();const timer=setInterval(()=>{if(document.visibilityState==='visible')load();},120000);const onVisible=()=>{if(document.visibilityState==='visible')load();};document.addEventListener('visibilitychange',onVisible);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);};},[load]);

 const toggleTheme=()=>{const next=!light;const apply=()=>{document.documentElement.classList.toggle('light',next);setLight(next);};
  const doc=document as Document&{startViewTransition?:(f:()=>void)=>unknown};
  if(doc.startViewTransition&&!matchMedia('(prefers-reduced-motion: reduce)').matches)doc.startViewTransition(apply);else apply();
  try{localStorage.setItem('dashboard-theme',next?'light':'dark');}catch{}};
 const range=rangeFor(period,custom);
 const endShown=range.custom?addDays(range.end,-1):range.end;

 const nav=(mobile:boolean)=><nav aria-label="Dashboard views" className={mobile?'grid grid-cols-4':'mt-7 grid gap-0.5'}>
  {tabs.map(t=><button key={t.id} type="button" data-tab={t.id} aria-pressed={tab===t.id} onClick={()=>setTab(t.id)}
   className={cn('relative z-0 flex items-center rounded-lg text-muted-foreground transition-colors hover:text-foreground',mobile?'h-[52px] flex-col justify-center gap-1 text-[11px]':'h-9 gap-2.5 px-2.5 text-[14px] font-medium',tab===t.id&&'text-foreground')}>
   {tab===t.id&&<motion.span layoutId={mobile?'nav-thumb-m':'nav-thumb'} className="absolute inset-0 -z-10 rounded-lg border bg-sidebar-accent shadow-card" transition={{type:'spring',stiffness:500,damping:40}}/>}
   <t.icon className={cn('size-4',mobile&&'size-5',tab===t.id&&'text-primary')}/>{t.label}
  </button>)}
 </nav>;

 return <div className="min-h-dvh md:grid md:grid-cols-[232px_minmax(0,1fr)]">
  <aside className="sticky top-0 hidden h-dvh flex-col px-3 pt-5 pb-4 md:flex">
   <a href="/" className="flex items-center gap-2.5 px-2.5 font-display text-base font-bold tracking-[-0.04em]"><span aria-hidden className="grid size-7 place-items-center rounded-[7px] bg-primary text-primary-foreground"><ChartNoAxesCombined className="size-4"/></span>{report?.settings?.name??'Dashboard'}</a>
   {nav(false)}
  </aside>

  <div className="flex min-h-dvh min-w-0 flex-col bg-background md:my-2 md:mr-2 md:min-h-[calc(100dvh-16px)] md:rounded-2xl md:border md:shadow-card">
   <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b bg-background/80 px-4 pt-3 pb-2.5 backdrop-blur-xl backdrop-saturate-150 md:rounded-t-2xl md:px-7 md:py-3.5">
    <h1 className="mr-auto text-xl font-semibold md:text-[17px]">{titles[tab]}</h1>
    {tab==='overview'&&<div className="order-3 w-full sm:order-none sm:w-auto"><RangePicker period={period} custom={custom} onChange={(p,c)=>{setPeriod(p);if(c)setCustom(c);}}/></div>}
    <div className="flex gap-1.5">
     <button type="button" onClick={toggleTheme} aria-label={light?'Switch to dark theme':'Switch to light theme'} title="Switch theme" className="grid size-9 place-items-center rounded-lg border bg-card hover:bg-accent">
      <AnimatePresence mode="wait" initial={false}><motion.span key={String(light)} initial={{rotate:-90,opacity:0}} animate={{rotate:0,opacity:1}} exit={{rotate:90,opacity:0}} transition={{duration:.2}}>{light?<Moon className="size-4"/>:<Sun className="size-4"/>}</motion.span></AnimatePresence>
     </button>
     <button type="button" onClick={load} aria-label="Refresh reports" title="Refresh reports" className="grid size-9 place-items-center rounded-lg border bg-card hover:bg-accent"><RefreshCw className={cn('size-4',loading&&'animate-spin')}/></button>
    </div>
   </header>

   <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 pt-4 pb-32 md:px-7 md:pt-6 md:pb-10">
    <AnimatePresence>{notice&&<motion.p role="status" initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}} className="mb-4 overflow-hidden rounded-lg bg-primary/12 px-3.5 py-2.5 text-[13px] text-foreground/85">{notice}</motion.p>}</AnimatePresence>
    {tab==='overview'&&<p className="mb-3.5 text-[13px] text-muted-foreground tabular">{shortDate(range.start,range.start.slice(0,4)!==endShown.slice(0,4))} – {shortDate(endShown,true)}</p>}
    {!report?<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0,1,2,3].map(i=><div key={i} className="shimmer h-40 rounded-xl border"/>)}</div>
     :<AnimatePresence mode="wait"><motion.section key={tab} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-4}} transition={{duration:.22,ease}}>
      {tab==='overview'&&<Overview report={report} range={range} onTab={t=>setTab(t as Tab)}/>}
      {tab==='content'&&<Content report={report} reload={load}/>}
      {tab==='connections'&&<Connections report={report} reload={load} notify={setNotice}/>}
      {tab==='import'&&<Import reload={load}/>}
     </motion.section></AnimatePresence>}
    <details className="mt-8 text-[13px] text-muted-foreground"><summary className="inline-flex cursor-pointer items-center gap-1.5 hover:text-foreground"><CircleHelp className="size-4"/>Reporting help</summary>
     <div className="max-w-[78ch] space-y-2 pt-2 leading-relaxed">
      <p>Reports use provider dates and time zones. Missing values show a dash; charts draw a smooth curve through reported days and never plot a missing day as zero. Account snapshots are latest observed totals, not gains. Daily totals cover reported days only. Changes compare matching days in the equal period before, and only appear when at least half the days match; snapshot changes compare the first and last observation in the period.</p>
      <p>TikTok views are lifetime values for loaded videos, independent of the reporting period. Coverage may be incomplete. Select a TikTok video in the chart to see saved lifetime views over time; these are not views gained that day.</p>
      <p>Website and social accounts sync hourly; Apple and YouTube daily. Refresh reads stored reports. A successful sync can return no reports.</p>
     </div>
    </details>
   </main>
  </div>

  <GlassTabBar tabs={tabs} value={tab} onChange={id=>setTab(id as Tab)}/>
 </div>;
}
