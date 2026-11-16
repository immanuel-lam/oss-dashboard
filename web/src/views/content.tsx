import {useMemo,useState} from 'react';
import {AnimatePresence,motion} from 'motion/react';
import {ChevronDown,ExternalLink,Link2,Search,Undo2,Unlink} from 'lucide-react';
import {CartesianGrid,Line,LineChart,XAxis,YAxis} from 'recharts';
import {Card} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {ChartContainer,ChartTooltip,type ChartConfig} from '@/components/ui/chart';
import {SourceIcon} from '@/components/brand';
import {groupContent,interactionsOf,type ContentGroup} from '@/lib/content';
import {labels,latestContent,type ContentRow,type Report,type Source} from '@/lib/metrics';
import {compact,fmt,shortDate} from '@/lib/format';
import {api} from '@/lib/api';
import {cn} from '@/lib/utils';

const ease=[.22,1,.36,1] as const;
// Platform series colours for per-video history; identity is also carried by the legend and tooltip labels.
const PLATFORM_COLOUR:Partial<Record<Source,string>>={tiktok:'var(--chart-1)',instagram:'#c084fc',youtube:'#f2b441',facebook:'#60a5fa'};
const n=(v:number|null)=>v===null?'—':fmt(v);
const keyOf=(i:{source:string;content_id:string})=>i.source+'|'+i.content_id;
type Rank='interactions'|'views';
const metricOf=(i:ContentRow,rank:Rank)=>rank==='views'?i.views:interactionsOf(i);
/** Platforms within a video, highest first for the chosen ranking; unreported values go last. */
const byMetric=(items:ContentRow[],rank:Rank)=>[...items].sort((a,b)=>(metricOf(b,rank)??-1)-(metricOf(a,rank)??-1));

function History({group,report}:{group:ContentGroup;report:Report}){
 const series=group.items.map(i=>({item:i,points:(report.contentHistory??[]).filter(h=>h.source===i.source&&h.content_id===i.content_id)}));
 const dates=[...new Set(series.flatMap(s=>s.points.map(p=>p.observed_date)))].sort();
 if(dates.length<2)return <p className="grid h-40 place-items-center text-center text-[13px] text-muted-foreground">History appears after a second day of observations.</p>;
 const data=dates.map(date=>Object.fromEntries([['date',date],...series.map(s=>[s.item.source,s.points.find(p=>p.observed_date===date)?.views])]));
 const config=Object.fromEntries(series.map(s=>[s.item.source,{label:labels[s.item.source],color:PLATFORM_COLOUR[s.item.source]??'var(--chart-2)'}])) satisfies ChartConfig;
 return <ChartContainer config={config} className="aspect-auto h-44 w-full" role="img" aria-label="Lifetime views by observation date for each platform">
  <LineChart data={data} margin={{top:8,right:8,left:0,bottom:0}}>
   <CartesianGrid vertical={false} stroke="var(--border)"/>
   <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={40} tickFormatter={d=>shortDate(d)} className="tabular"/>
   <YAxis width={40} tickLine={false} axisLine={false} tickFormatter={v=>compact(v)} className="tabular"/>
   <ChartTooltip content={({active,payload,label})=>active&&payload?.length?<div className="min-w-40 rounded-lg border bg-popover px-3 py-2 text-xs shadow-xl"><div className="mb-1.5 text-muted-foreground">{shortDate(String(label),true)}</div>
    {payload.map(p=><div key={String(p.dataKey)} className="flex items-center justify-between gap-6"><span className="flex items-center gap-1.5"><i className="h-0.5 w-3 rounded" style={{background:p.color}}/>{labels[p.dataKey as Source]}</span><b className="tabular">{fmt(Number(p.value))}</b></div>)}</div>:null}/>
   {series.map(s=><Line key={s.item.source} dataKey={s.item.source} type="monotone" stroke={PLATFORM_COLOUR[s.item.source]??'var(--chart-2)'} strokeWidth={2} dot={false} connectNulls isAnimationActive animationDuration={800}/>)}
  </LineChart>
 </ChartContainer>;
}

function GroupDetail({group,report,others,onChange,rank}:{group:ContentGroup;report:Report;others:ContentRow[];rank:Rank;onChange:(items:{source:string;content_id:string}[],groupId:string|null)=>Promise<void>}){
 const items=byMetric(group.items,rank);const max=Math.max(1,...items.map(i=>metricOf(i,rank)??0));
 const [adding,setAdding]=useState<string>();
 const merge=async(k:string)=>{const extra=others.find(o=>keyOf(o)===k);if(!extra)return;const id=group.manual?group.id:'g_'+crypto.randomUUID();await onChange([...group.items,extra],id);setAdding(undefined);};
 return <motion.div initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}} transition={{duration:.3,ease}} className="overflow-hidden">
  <div className="grid gap-5 border-t bg-background/40 px-5 py-4 lg:grid-cols-[1.1fr_1fr]">
   <div className="space-y-2.5">
    {items.map(i=><motion.div layout key={keyOf(i)} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1">
     <SourceIcon source={i.source} className="size-7 rounded-lg"/>
     <div className="min-w-0"><div className="flex items-center gap-2 text-[13px]"><span className="font-medium">{labels[i.source]}</span><a href={i.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary">Open<ExternalLink className="size-3"/></a>
      {group.items.length>1&&<button type="button" title="Separate this post" onClick={()=>onChange([i],'solo:'+i.source+':'+i.content_id)} className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Unlink className="size-3"/>Separate</button>}</div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border"><motion.i className="block h-full origin-left rounded-full" style={{width:((metricOf(i,rank)??0)/max*100).toFixed(1)+'%',background:PLATFORM_COLOUR[i.source]??'var(--chart-2)'}} initial={{scaleX:0}} animate={{scaleX:1}} transition={{duration:.7,ease}}/></div></div>
     <div className="text-right text-[13px] font-semibold tabular">{n(metricOf(i,rank))}<span className="ml-1 text-[11.5px] font-normal text-muted-foreground">{rank==='views'?'views':'interactions'}</span><div className="text-[11.5px] font-normal text-muted-foreground">{([[rank==='views'?'':'views',rank==='views'?null:i.views],['likes',i.likes],['comments',i.comments],['shares',i.shares]] as const).filter(([k,v])=>k&&v!==null).map(([k,v])=>fmt(v as number)+' '+k).join(' · ')}</div></div>
    </motion.div>)}
    {<div className="flex flex-wrap items-center gap-2 pt-1">
     {others.length>0&&<Select value={adding} onValueChange={merge}>
      <SelectTrigger className="h-8 w-auto gap-1.5 text-[12.5px]"><Link2 className="size-3.5"/><SelectValue placeholder="Add a post from another platform"/></SelectTrigger>
      <SelectContent className="max-h-72">{others.map(o=><SelectItem key={keyOf(o)} value={keyOf(o)}><span className="flex items-center gap-2"><SourceIcon source={o.source} className="size-4"/>{o.title.split('\n')[0].slice(0,60)}</span></SelectItem>)}</SelectContent>
     </Select>}
     {group.manual&&<Button size="sm" variant="ghost" className="h-8 text-[12.5px] text-muted-foreground" onClick={()=>onChange(group.items,null)}><Undo2 className="size-3.5"/>Use automatic grouping</Button>}
    </div>}
   </div>
   <div><div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="mr-auto">Lifetime views over time</span>{group.items.length>1&&group.items.map(i=><span key={keyOf(i)} className="inline-flex items-center gap-1.5"><i className="h-0.5 w-3 rounded" style={{background:PLATFORM_COLOUR[i.source]??'var(--chart-2)'}}/>{labels[i.source]}</span>)}</div><History group={group} report={report}/></div>
  </div>
 </motion.div>;
}

export function Content({report,reload}:{report:Report;reload:()=>Promise<void>}){
 const [query,setQuery]=useState('');const [mode,setMode]=useState<'grouped'|'posts'>('grouped');const [rank,setRank]=useState<'interactions'|'views'>('interactions');const [open,setOpen]=useState<string>();const [error,setError]=useState('');
 const groups=useMemo(()=>groupContent(report.content,report.contentGroups),[report.content,report.contentGroups]);
 const q=query.trim().toLowerCase();
 const score=(g:{views:number|null;interactions:number|null})=>(rank==='views'?g.views:g.interactions)??-1;
 const shown=groups.filter(g=>!q||g.title.toLowerCase().includes(q)||g.items.some(i=>i.title.toLowerCase().includes(q))).sort((a,b)=>score(b)-score(a));
 const maxViews=Math.max(1,...groups.map(g=>Math.max(0,score(g))));
 const change=async(items:{source:string;content_id:string}[],groupId:string|null)=>{setError('');try{await api('content/group',{items:items.map(i=>({source:i.source,content_id:i.content_id})),group_id:groupId});await reload();}catch(e){setError((e as Error).message);}};
 const postScore=(r:ContentRow)=>(rank==='views'?r.views:interactionsOf(r))??-1;const posts=latestContent(report.content).filter(r=>!q||r.title.toLowerCase().includes(q)).sort((a,b)=>postScore(b)-postScore(a));const maxPost=Math.max(1,...posts.map(p=>p.views??0));
 return <div className="space-y-3">
  <div className="flex flex-wrap items-center gap-3">
   <label className="relative flex max-w-sm flex-1 items-center"><Search className="absolute left-2.5 size-4 text-muted-foreground"/><span className="sr-only">Search content</span><Input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search" className="pl-8"/></label>
   <Select value={rank} onValueChange={v=>setRank(v as 'interactions'|'views')}>
    <SelectTrigger aria-label="Rank by" className="ml-auto h-9 w-auto gap-1.5 text-[13px]"><span className="text-muted-foreground">Rank by</span><SelectValue/></SelectTrigger>
    <SelectContent align="end"><SelectItem value="interactions">Interactions</SelectItem><SelectItem value="views">Views</SelectItem></SelectContent>
   </Select>
   <div role="tablist" aria-label="Content view" className="flex rounded-lg border bg-card p-0.5">
    {(['grouped','posts'] as const).map(m=><button key={m} type="button" role="tab" aria-selected={mode===m} onClick={()=>setMode(m)} className={cn('relative z-0 rounded-md px-3 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground',mode===m&&'text-foreground')}>
     {mode===m&&<motion.span layoutId="content-mode" className="absolute inset-0 -z-10 rounded-md border bg-popover shadow-card" transition={{type:'spring',stiffness:500,damping:38}}/>}{m==='grouped'?'Videos':'All posts'}
    </button>)}
   </div>
  </div>
  {error&&<p role="status" className="rounded-lg bg-primary/12 px-3.5 py-2.5 text-[13px]">{error}</p>}
  {mode==='grouped'?<Card className="gap-0 overflow-hidden py-0 shadow-card">
   {shown.length?shown.map((g,idx)=>{const expanded=open===g.id;const others=latestContent(report.content).filter(o=>!g.items.some(i=>i.source===o.source));
    return <div key={g.id} className={cn(idx&&'border-t')}>
     <button type="button" aria-expanded={expanded} onClick={()=>setOpen(expanded?undefined:g.id)} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-5 py-3 text-left transition-colors hover:bg-accent/50 sm:grid-cols-[1fr_auto_auto]">
      <div className="min-w-0"><div className="truncate text-[13.5px] font-medium">{g.title}</div>
       <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">{byMetric(g.items,rank).map(i=><span key={keyOf(i)} className="inline-flex items-center gap-1.5"><SourceIcon source={i.source} className="size-4 rounded"/><span className="tabular">{(()=>{const v=rank==='views'?i.views:interactionsOf(i);return v===null?'—':compact(v);})()}</span></span>)}{g.published&&<span>{shortDate(g.published.slice(0,10),true)}</span>}</div></div>
      <div className="hidden w-32 sm:block"><div className="h-1 overflow-hidden rounded-full bg-border"><motion.i className="block h-full origin-left rounded-full bg-primary" style={{width:(Math.max(0,score(g))/maxViews*100).toFixed(1)+'%'}} initial={{scaleX:0}} animate={{scaleX:1}} transition={{duration:.8,delay:idx*.04,ease}}/></div></div>
      <div className="flex items-center gap-2"><div className="text-right"><div className="font-display text-[17px] font-semibold tracking-tight tabular">{score(g)<0?'—':fmt(score(g))}</div><div className="text-[11px] text-muted-foreground">{(rank==='views'?'views':'interactions')+(g.items.length>1?' on '+g.items.length+' platforms':'')}</div></div><ChevronDown className={cn('size-4 text-muted-foreground transition-transform',expanded&&'rotate-180')}/></div>
     </button>
     <AnimatePresence initial={false}>{expanded&&<GroupDetail group={g} report={report} others={others} onChange={change} rank={rank}/>}</AnimatePresence>
    </div>;}):<p className="px-5 py-4 text-[13px] text-muted-foreground">{groups.length?'No matching content.':'No content snapshots yet.'}</p>}
  </Card>
  :<Card className="gap-0 overflow-hidden py-0 shadow-card"><div className="overflow-auto"><Table>
   <TableHeader><TableRow><TableHead>Post</TableHead><TableHead className="text-right">Views</TableHead><TableHead className="text-right">Likes</TableHead><TableHead className="text-right">Comments</TableHead><TableHead className="text-right">Shares</TableHead></TableRow></TableHeader>
   <TableBody>{posts.length?posts.map(r=><TableRow key={keyOf(r)}>
    <TableCell className="max-w-[min(460px,60vw)]"><a href={r.url} target="_blank" rel="noopener noreferrer" className="block truncate hover:text-primary">{r.title.split('\n')[0].slice(0,100)||'Untitled'}</a><span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground"><SourceIcon source={r.source} className="size-4.5"/>{labels[r.source]}{r.published_at?' · '+shortDate(r.published_at.slice(0,10),true):''}</span></TableCell>
    <TableCell className="text-right"><span className="inline-flex items-center gap-2.5 tabular">{r.views!==null&&<span className="hidden h-1 w-16 overflow-hidden rounded-full bg-border sm:block"><i className="block h-full rounded-full bg-primary" style={{width:(r.views/maxPost*100).toFixed(1)+'%'}}/></span>}{n(r.views)}</span></TableCell>
    {(['likes','comments','shares'] as const).map(k=><TableCell key={k} className="text-right tabular">{n(r[k])}</TableCell>)}
   </TableRow>):<TableRow><TableCell colSpan={5} className="text-muted-foreground">No content snapshots yet.</TableCell></TableRow>}</TableBody>
  </Table></div></Card>}
 </div>;
}
