import {useEffect,useMemo,useState} from 'react';
import {motion} from 'motion/react';
import {ArrowDown,ArrowRight,ArrowUp,ArrowUpRight,ChevronsUpDown,Download,History,Trophy} from 'lucide-react';
import {Card} from '@/components/ui/card';
import {Select,SelectContent,SelectGroup,SelectItem,SelectLabel,SelectTrigger} from '@/components/ui/select';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {NumberAnimation} from '@/components/number-animation';
import {ChangeBadge,Sparkline,StatusBadge} from '@/components/widgets';
import {ShowMore} from '@/components/show-more';
import {TrendChart} from '@/components/trend-chart';
import {SourceIcon} from '@/components/brand';
import {groupContent} from '@/lib/content';
import {isRank,metricLabel,sourceOf,sourceSeries,type ChartRank,type Series,chartSeries,defaultSeries,labels,latestContent,metricName,previousPoints,rangeDays,seriesChange,sources,tiles,visible,type Range,type Report,type Tile} from '@/lib/metrics';
import {ago,compact,fmt} from '@/lib/format';
import {download} from '@/lib/api';
import {cn} from '@/lib/utils';

const ease=[.22,1,.36,1] as const;
const format=(v:number)=>fmt(Math.round(v*10)/10);
const LEDGER_SHOWN=8;

function RankLine({chart,onSelect,active}:{chart:ChartRank;onSelect:()=>void;active:boolean}){
 const moved=chart.change?.value??0;
 return <button type="button" onClick={e=>{e.stopPropagation();onSelect();}} title={'App Store top free · '+chart.name+(chart.change?'. '+chart.change.title:'')}
  className={cn('-ml-1.5 mt-1.5 inline-flex w-fit items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',active&&'bg-accent text-foreground')}>
  <Trophy className="size-3.5 text-primary"/><span className="font-semibold text-foreground tabular">#{chart.value}</span><span>{chart.name}</span>
  {moved!==0&&<span className={cn('inline-flex items-center tabular',moved>0?'text-up':'text-down')}>{moved>0?<ArrowUp className="size-3"/>:<ArrowDown className="size-3"/>}{Math.abs(moved)}</span>}
 </button>;
}

function KpiCard({tile,profile,index,selected,activeKey,onSelect,onSeries,onVideos,onHistory}:{tile:Tile;profile?:string;index:number;selected:boolean;activeKey?:string;onSelect:()=>void;onSeries:(k:string)=>void;onVideos:()=>void;onHistory:()=>void}){
 const spark=useMemo(()=>tile.spark,[JSON.stringify(tile.spark)]);
 return <motion.article data-source={tile.source} role="button" tabIndex={0} aria-pressed={selected} aria-label={'Chart '+tile.label}
  initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{duration:.5,delay:index*.05,ease}}
  onClick={e=>{if(!(e.target as HTMLElement).closest('button,a,summary,details'))onSelect();}}
  onKeyDown={e=>{if((e.key==='Enter'||e.key===' ')&&e.target===e.currentTarget){e.preventDefault();onSelect();}}}
  onPointerMove={e=>{const r=e.currentTarget.getBoundingClientRect();e.currentTarget.style.setProperty('--mx',e.clientX-r.left+'px');e.currentTarget.style.setProperty('--my',e.clientY-r.top+'px');}}
  className={cn('kpi spotlight group/tile relative flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border bg-card px-3.5 pt-3.5 shadow-card outline-none transition-colors hover:border-input focus-visible:ring-2 focus-visible:ring-ring sm:px-5 sm:pt-4',selected&&'border-primary/50')}>
  {selected&&<motion.span layoutId="tile-active" className="absolute inset-x-0 top-0 h-[2px] bg-primary" transition={{type:'spring',stiffness:500,damping:40}}/>}
  <div className="flex items-center gap-2 text-[13px] font-medium text-foreground/80"><SourceIcon source={tile.source}/><span className="min-w-0 truncate">{tile.label}</span><ChangeBadge change={tile.change} className="ml-auto hidden shrink-0 sm:inline-flex"/>
   {profile&&<a href={profile} target="_blank" rel="noopener noreferrer" aria-label={'Open '+tile.label} title={'Open '+tile.label}
    className={cn('-mr-1.5 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground',!tile.change&&'ml-auto',tile.change&&'max-sm:ml-auto')}><ArrowUpRight className="size-3.5"/></a>}</div>
  <div className="mt-3 font-display text-[24px] leading-tight font-semibold tracking-[-0.045em] tabular sm:text-[32px]">
   {tile.value===null?'—':<NumberAnimation value={tile.value} format={format}/>}
  </div>
  <div className="flex items-center gap-2 text-[13px] text-muted-foreground">{tile.name}<ChangeBadge change={tile.change} className="px-1.5 text-[11px] sm:hidden"/></div>
  {(tile.coverage||tile.extra||tile.followers!==undefined)&&<div className="mt-0.5 flex flex-wrap gap-x-3 text-[12.5px] text-muted-foreground">{tile.extra&&<span>{tile.extra}</span>}{tile.coverage&&<span>{tile.coverage}</span>}{tile.followers!==undefined&&<span>{tile.source==='youtube'?'Subscribers':'Followers'}: {tile.followers===null?'—':fmt(tile.followers)}</span>}</div>}
  {tile.chart&&<RankLine chart={tile.chart} active={activeKey===tile.chart.series} onSelect={()=>onSeries(tile.chart!.series)}/>}
  {tile.video?<>
   <details className="mt-2 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer hover:text-foreground">Details</summary><p className="mt-1">{tile.detail}</p></details>
   <div className="-ml-1.5 mt-2 mb-3 flex flex-wrap gap-1">
    <button type="button" onClick={onHistory} className="view-history inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] text-muted-foreground hover:bg-accent hover:text-foreground"><History className="size-3.5"/>View history</button>
    <button type="button" onClick={onVideos} className="view-content inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] text-muted-foreground hover:bg-accent hover:text-foreground"><ArrowRight className="size-3.5"/>View videos</button>
   </div>
  </>:<Sparkline points={spark} snapshot={tile.metric.endsWith('_snapshot')}/>}
 </motion.article>;
}

/** Metric tabs for the selected source, with a sliding thumb. */
function MetricTabs({list,value,onChange}:{list:Series[];value?:string;onChange:(k:string)=>void}){
 if(list.length<2)return null;
 return <div role="tablist" aria-label="Metric" className="-mx-1 flex max-w-full gap-0.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
  {list.map(s=><button key={s.key} type="button" role="tab" aria-selected={s.key===value} title={s.detail} onClick={()=>onChange(s.key)}
   className={cn('relative z-0 shrink-0 rounded-md px-2.5 py-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground',s.key===value&&'text-foreground')}>
   {s.key===value&&<motion.span layoutId="metric-thumb" className="absolute inset-0 -z-10 rounded-md bg-accent" transition={{type:'spring',stiffness:500,damping:40}}/>}
   {metricLabel(s)}
  </button>)}
 </div>;
}

export function Overview({report,range,onTab}:{report:Report;range:Range;onTab:(t:string)=>void}){
 const all=useMemo(()=>tiles(report,range),[report,range]);
 const withData=all.filter(t=>t.hasData),without=all.filter(t=>!t.hasData);
 const series=useMemo(()=>chartSeries(report,range),[report,range]);
 const [key,setKey]=useState<string>();
 useEffect(()=>{if(!key||!series.some(s=>s.key===key))setKey(defaultSeries(series));},[series,key]);
 const current=series.find(s=>s.key===key);
 const currentSource=current?sourceOf(current.key):undefined;
 const tabs=currentSource?sourceSeries(series,currentSource):[];
 // Remember the last metric per source, so going back to a tile restores it.
 const [lastBySource,setLastBySource]=useState<Record<string,string>>({});
 const choose=(k:string,scroll=false)=>{setKey(k);setLastBySource(m=>({...m,[sourceOf(k)]:k}));if(scroll&&window.innerWidth<1024)setTimeout(()=>document.getElementById('trend')?.scrollIntoView({behavior:'smooth',block:'start'}),60);};
 const pickTile=(t:Tile)=>{const remembered=lastBySource[t.source];const k=remembered&&series.some(s=>s.key===remembered)?remembered:t.series;if(k&&series.some(s=>s.key===k))choose(k,true);};
 const groups=sources.map(src=>({src,items:series.filter(s=>sourceOf(s.key)===src)})).filter(g=>g.items.length);
 const previous=useMemo(()=>current?previousPoints(report,current.key,range):[],[report,current?.key,range]);
 // Same grouping and ranking as the Content tab: one row per video across platforms, ranked by interactions.
 const top=useMemo(()=>groupContent(report.content,report.contentGroups).filter(g=>g.interactions!==null).sort((a,b)=>(b.interactions??0)-(a.interactions??0)).slice(0,6),[report.content,report.contentGroups]);
 const maxScore=Math.max(1,...top.map(g=>g.interactions??0));
 const rows=visible(report,range);
 const [allRows,setAllRows]=useState(false);
 const ledger=rows.slice(0,allRows?500:LEDGER_SHOWN);
 const pickHistory=()=>{const best=series.filter(s=>s.video).sort((a,b)=>b.points.length-a.points.length)[0];if(best){choose(best.key);document.getElementById('trend')?.scrollIntoView({behavior:'smooth',block:'center'});}};
 const exportCsv=()=>{const fields=['source','date','metric','value','unit','timezone','provenance'] as const;const cell=(v:unknown)=>'"'+String(v??'').replaceAll('"','""').replace(/^[=+@-]/,"'$&")+'"';download('platform-metrics.csv',[fields.join(','),...rows.map(r=>fields.map(f=>cell(r[f])).join(','))].join('\r\n'),'text/csv');};

 return <div className="space-y-3">
  {withData.length>0&&<div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
   {withData.map((t,i)=><KpiCard key={t.id} tile={t} profile={report.settings?.profiles[t.source]} index={i} selected={currentSource===t.source} activeKey={key} onSelect={()=>pickTile(t)} onSeries={k=>choose(k,true)} onVideos={()=>onTab('content')} onHistory={pickHistory}/>)}
  </div>}

  <Card id="trend" className="scroll-mt-40 gap-0 overflow-hidden py-0 shadow-card md:scroll-mt-24">
   <div className="space-y-2.5 px-5 pt-4">
    <div className="flex items-center gap-2">
     {currentSource&&<><SourceIcon source={currentSource} className="size-5"/><span className="min-w-0 truncate text-[13px] font-medium text-foreground/80">{current?.video?current.label:labels[currentSource]}</span></>}
     {series.length>0&&<Select value={key} onValueChange={k=>choose(k)}>
      <SelectTrigger aria-label="All metrics" className="ml-auto h-7 w-auto gap-1.5 border-0 bg-transparent px-2 text-[12.5px] text-muted-foreground shadow-none hover:bg-accent hover:text-foreground focus-visible:ring-0 dark:bg-transparent dark:hover:bg-accent [&>svg:last-child]:hidden">
       <span className="hidden sm:inline">All metrics</span><ChevronsUpDown className="size-3.5"/>
      </SelectTrigger>
      <SelectContent align="end" className="max-h-96">{groups.map(g=><SelectGroup key={g.src}><SelectLabel className="flex items-center gap-2"><SourceIcon source={g.src} className="size-4"/>{labels[g.src]}</SelectLabel>
       {g.items.map(s=><SelectItem key={s.key} value={s.key} title={s.detail}>{metricLabel(s)}</SelectItem>)}</SelectGroup>)}</SelectContent>
     </Select>}
    </div>
    <MetricTabs list={tabs} value={key} onChange={k=>choose(k)}/>
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
     {current&&current.points.length>0&&<div className="flex items-center gap-2.5">
      <span className="font-display text-[30px] leading-tight font-semibold tracking-[-0.045em] tabular"><NumberAnimation value={current.snapshot?current.points.at(-1)!.value:current.points.reduce((s,p)=>s+p.value,0)} format={isRank(current.key.split('|')[1])?v=>'#'+Math.round(v):format}/></span>
      <ChangeBadge change={seriesChange(report,current,range)}/>
     </div>}
     {previous.length>1&&<div className="flex gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><i className="h-0.5 w-3 rounded bg-chart-1"/>This period</span><span className="flex items-center gap-1.5"><i className="h-0.5 w-3 rounded bg-chart-2/70"/>Previous period</span></div>}
    </div>
   </div>
   <div className="px-2 pt-2 pb-1">
    {!current||current.points.length<2
     ?<p className="grid min-h-44 place-items-center text-center text-[13px] text-muted-foreground">{current?.points.length?'One observation. More dates are needed for a trend.':'No reports in this period.'}</p>
     :<TrendChart key={current.key+range.start+range.end} points={current.points} previous={previous} start={range.start} end={range.end} snapshot={current.snapshot} rank={isRank(current.key.split('|')[1])} days={rangeDays(range)} label={current.label}/>}
   </div>
   {current&&current.points.length>0&&<details className="px-5 pb-4 text-[12.5px] text-muted-foreground"><summary className="w-fit cursor-pointer hover:text-foreground">Chart values</summary>
    <div className="mt-2 max-h-60 overflow-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
     <TableBody>{current.points.map(p=><TableRow key={p.date}><TableCell className="tabular">{p.date}</TableCell><TableCell className="text-right tabular">{fmt(p.value)}</TableCell></TableRow>)}</TableBody></Table></div>
   </details>}
  </Card>

  <div className={cn('grid gap-3',top.length?'lg:grid-cols-[1.6fr_1fr]':'')}>
   {top.length>0&&<Card className="gap-0 py-0 shadow-card">
    <div className="flex items-center justify-between border-b px-5 py-3.5"><h2 className="text-sm font-semibold">Top content <span className="ml-1 text-xs font-normal text-muted-foreground">by interactions</span></h2><button type="button" onClick={()=>onTab('content')} className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">All videos<ArrowRight className="size-3.5"/></button></div>
    <ol className="py-1.5">{top.map((g,i)=><li key={g.id}><button type="button" onClick={()=>onTab('content')} className="grid w-full grid-cols-[20px_1fr_auto] items-center gap-x-3 px-5 py-2 text-left text-[13px] hover:bg-accent/60">
     <span className="text-xs text-muted-foreground tabular">{i+1}</span>
     <span className="min-w-0"><span className="block truncate">{g.title}</span><span className="mt-0.5 flex items-center gap-1">{g.items.map(it=><SourceIcon key={it.source+it.content_id} source={it.source} className="size-4 rounded"/>)}</span></span>
     <span className="text-right"><span className="block font-semibold tabular">{compact(g.interactions??0)}</span><span className="block text-[11px] text-muted-foreground">{compact(g.views??0)} views</span></span>
     <span className="col-start-2 col-span-2 mt-1.5 h-1 overflow-hidden rounded-full bg-border"><motion.i className="block h-full origin-left rounded-full bg-primary" style={{width:((g.interactions??0)/maxScore*100).toFixed(1)+'%'}} initial={{scaleX:0}} animate={{scaleX:1}} transition={{duration:.9,delay:i*.06,ease}}/></span>
    </button></li>)}</ol>
   </Card>}
   <Card className="gap-0 py-0 shadow-card">
    <div className="border-b px-5 py-3.5"><h2 className="text-sm font-semibold">Collection</h2></div>
    <div className="py-1.5">{sources.map(s=>{const run=report.runs.find(r=>r.source===s);return <div key={s} className="flex items-center gap-2.5 px-5 py-2 text-[13px]">
     <SourceIcon source={s}/><span>{labels[s]}</span><span className="ml-auto text-xs text-muted-foreground tabular">{run?ago(run.started_at):''}</span><StatusBadge status={run?.status}/>
    </div>;})}</div>
   </Card>
  </div>

  {without.length>0&&<details className="text-[13px] text-muted-foreground"><summary className="w-fit cursor-pointer hover:text-foreground">{without.length} sources without reports</summary>
   <div className="mt-2.5 flex flex-wrap gap-2">{without.map(t=><span key={t.source} className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-foreground/80"><SourceIcon source={t.source} className="size-5"/>{t.label}</span>)}</div>
  </details>}

  <Card className="gap-0 overflow-hidden py-0 shadow-card">
   <div className="flex items-center justify-between border-b px-5 py-3"><h2 className="text-sm font-semibold">Metric ledger</h2><button type="button" onClick={exportCsv} className="inline-flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-[13px] hover:bg-accent"><Download className="size-4"/>Export CSV</button></div>
   <div className={cn('overflow-auto',allRows&&'max-h-[520px]')}><Table><TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead>Date</TableHead><TableHead>Source</TableHead><TableHead>Metric</TableHead><TableHead className="text-right">Value</TableHead><TableHead>Unit / time zone</TableHead><TableHead>Provenance</TableHead></TableRow></TableHeader>
    <TableBody>{ledger.length?ledger.map(r=><TableRow key={r.source+r.date+r.metric}><TableCell className="tabular">{r.date}</TableCell><TableCell>{labels[r.source]??r.source}</TableCell><TableCell>{metricName(r.metric)}</TableCell><TableCell className="text-right tabular">{fmt(r.value)}</TableCell><TableCell className="text-muted-foreground">{r.unit} / {r.timezone}</TableCell><TableCell className="text-muted-foreground">{r.provenance}</TableCell></TableRow>)
     :<TableRow><TableCell colSpan={6} className="text-muted-foreground">No reports for this period.</TableCell></TableRow>}</TableBody></Table></div>
   {rows.length>LEDGER_SHOWN&&<div className="border-t px-5 py-2.5"><ShowMore total={Math.min(rows.length,500)} shown={LEDGER_SHOWN} expanded={allRows} onToggle={()=>setAllRows(v=>!v)}/></div>}
  </Card>
 </div>;
}
