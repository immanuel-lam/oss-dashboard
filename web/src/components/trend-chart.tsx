import {useMemo} from 'react';
import {Area,AreaChart,CartesianGrid,Line,XAxis,YAxis} from 'recharts';
import {ChartContainer,ChartTooltip,type ChartConfig} from '@/components/ui/chart';
import {addDays,DAY} from '@/lib/metrics';
import {compact,fmt,longDate,shortDate} from '@/lib/format';

interface Props {rank?:boolean; points:{date:string;value:number}[]; previous:{date:string;value:number}[]; start:string; end:string; snapshot:boolean; days:number; label:string}

const config={current:{label:'This period',color:'var(--chart-1)'},previous:{label:'Previous period',color:'var(--chart-2)'}} satisfies ChartConfig;

/** Whole-number ticks for small counts; otherwise 1/1.2/1.5/2/2.5/3/4/5/6/8 steps so the top tick sits close to the data. */
function niceTop(max:number,whole:boolean){if(!(max>0))return whole?4:1;if(whole&&max<=4)return 4;const raw=max/4;const mag=10**Math.floor(Math.log10(raw));const step=[1,1.2,1.5,2,2.5,3,4,5,6,8,10].map(m=>m*mag).find(s=>s*4>=max)!;return step*4;}

export function TrendChart({points,previous,start,end,snapshot,days,label,rank=false}:Props){
 // One row per observed date. The previous period is shifted onto the same dates; missing dates are bridged by the curve.
 const data=useMemo(()=>{const map=new Map<string,{date:string;current?:number;previous?:number}>();
  for(const p of points)map.set(p.date,{date:p.date,current:p.value});
  for(const p of previous){if(p.date>points.at(-1)!.date)continue;map.set(p.date,{...(map.get(p.date)??{date:p.date}),previous:p.value});}
  return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(r=>({...r,t:Date.parse(r.date)}));
 },[points,previous]);
 const values=[...points,...previous].map(p=>p.value);const whole=values.every(Number.isInteger);
 const lo=snapshot?Math.min(...values):0;const top=snapshot?lo+niceTop(Math.max(...values)-lo,whole):niceTop(Math.max(...values),whole);
 const domainEnd=Math.max(Date.parse(end)-(snapshot?0:DAY),...points.map(p=>Date.parse(p.date)));
 const hasPrevious=previous.length>1;
 return <ChartContainer config={config} className="aspect-auto h-[260px] w-full sm:h-[300px]" role="img" aria-label={label+' trend. Exact values appear in Chart values.'}>
  <AreaChart data={data} margin={{top:12,right:8,left:0,bottom:0}}>
   <defs><linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--color-current)" stopOpacity={.24}/><stop offset="1" stopColor="var(--color-current)" stopOpacity={0}/></linearGradient></defs>
   <CartesianGrid vertical={false} stroke="var(--border)"/>
   <XAxis dataKey="t" type="number" scale="time" domain={[Date.parse(start),domainEnd]} tickLine={false} axisLine={false} tickMargin={10} minTickGap={56} interval="preserveStartEnd" tickFormatter={t=>shortDate(new Date(t).toISOString().slice(0,10))} className="tabular"/>
   <YAxis width={44} tickLine={false} axisLine={false} reversed={rank} domain={rank?[Math.max(1,Math.min(...values)-5),Math.max(...values)+3]:[snapshot?lo:0,top]} tickCount={5} allowDecimals={!whole&&!rank} tickFormatter={v=>rank?'#'+v:compact(v)} className="tabular"/>
   <ChartTooltip cursor={{stroke:'var(--input)',strokeWidth:1}} content={({active,payload})=>{
    if(!active||!payload?.length)return null;const row=payload[0].payload as {date:string;current?:number;previous?:number};
    return <div className="min-w-40 rounded-lg border bg-popover px-3 py-2 text-xs shadow-xl">
     <div className="mb-1.5 text-muted-foreground">{longDate(row.date)}</div>
     {row.current!==undefined&&<div className="flex items-center justify-between gap-6"><span className="flex items-center gap-1.5"><i className="h-0.5 w-3 rounded bg-(--color-current)"/>{hasPrevious?'This period':'Value'}</span><b className="tabular">{rank?'#'+row.current:fmt(row.current)}</b></div>}
     {row.previous!==undefined&&<div className="mt-1 flex items-center justify-between gap-6"><span className="flex items-center gap-1.5 text-muted-foreground"><i className="h-0.5 w-3 rounded bg-(--color-previous)"/>{shortDate(addDays(row.date,-days))}</span><b className="tabular">{fmt(row.previous)}</b></div>}
    </div>;
   }}/>
   {hasPrevious&&<Line dataKey="previous" type="monotone" stroke="var(--color-previous)" strokeOpacity={.6} strokeWidth={1.5} dot={false} activeDot={false} connectNulls isAnimationActive animationDuration={700}/>}
   <Area dataKey="current" type="monotone" stroke="var(--color-current)" strokeWidth={2} fill={rank?"none":"url(#trend-fill)"} connectNulls dot={data.length<=14?{r:3,fill:'var(--color-current)',strokeWidth:0}:false} activeDot={{r:5,strokeWidth:3,stroke:'var(--card)'}} isAnimationActive animationDuration={900} animationEasing="ease-out"/>
  </AreaChart>
 </ChartContainer>;
}
