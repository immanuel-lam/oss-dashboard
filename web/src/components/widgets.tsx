import {CircleAlert,CircleCheck,CircleDashed,CircleX,Clock3,LoaderCircle,Minus,TrendingDown,TrendingUp} from 'lucide-react';
import {Area,AreaChart,ResponsiveContainer,YAxis} from 'recharts';
import {useId} from 'react';
import type {Change} from '@/lib/metrics';
import {compact} from '@/lib/format';
import {cn} from '@/lib/utils';
import {Tooltip,TooltipContent,TooltipTrigger} from '@/components/ui/tooltip';

/** Signed period change. Direction is shown by icon and sign, never colour alone. */
export function ChangeBadge({change,className}:{change:Change|null;className?:string}){
 if(!change)return null;
 const v=change.value;const flat=Math.abs(v)<(change.kind==='percent'?.05:.5);const dir=flat?'flat':v>0?'up':'down';
 const text=change.kind==='rank'?Math.abs(v)+(Math.abs(v)===1?' place':' places'):change.kind==='percent'?(Math.abs(v)>=100?Math.round(Math.abs(v)):Math.abs(v).toFixed(1))+'%':compact(Math.abs(v));
 const Icon=dir==='up'?TrendingUp:dir==='down'?TrendingDown:Minus;
 return <Tooltip><TooltipTrigger asChild>
  <span className={cn('delta inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs font-semibold tabular',dir==='up'&&'text-up',dir==='down'&&'text-down',dir==='flat'&&'text-muted-foreground',className)} data-dir={dir}>
   <span className="sr-only">{(dir==='up'?'Up ':dir==='down'?'Down ':'No change ')+(flat?'':text)+'. '+change.title}</span>
   <span aria-hidden className="inline-flex items-center gap-1"><Icon className="size-3"/>{dir==='up'?'+':dir==='down'?'−':''}{flat?'0':text}</span>
  </span>
 </TooltipTrigger><TooltipContent>{change.title}</TooltipContent></Tooltip>;
}

const statuses:Record<string,[string,typeof CircleCheck,string]>={success:['Synced',CircleCheck,'text-up'],error:['Failed',CircleX,'text-down'],partial:['Partial',CircleAlert,'text-warn'],running:['Syncing',LoaderCircle,'text-primary'],waiting:['Waiting',Clock3,'text-warn']};
export function StatusBadge({status,iconOnly=false}:{status?:string;iconOnly?:boolean}){
 const [text,Icon,tone]=status?statuses[status]??[status,CircleAlert,'text-muted-foreground']:['Not synced',CircleDashed,'text-muted-foreground'];
 return <span className={cn('inline-flex items-center gap-1.5 text-xs',tone)}>
  <Icon className={cn('size-3.5',status==='running'&&'animate-spin')} aria-hidden/>
  <span className={iconOnly?'sr-only':undefined}>{text}</span>
 </span>;
}

/** Small area trend for a tile. Monotone curve through observed days; missing days are bridged, never zero. */
export function Sparkline({points,snapshot,invert=false}:{points:{date:string;value:number}[];snapshot:boolean;invert?:boolean}){
 const id=useId().replace(/:/g,'');
 if(new Set(points.map(p=>p.date)).size<2)return <div className="h-3"/>;
 return <div className="-mx-3.5 mt-auto h-12 pt-2 sm:-mx-5" aria-hidden>
  <ResponsiveContainer width="100%" height="100%">
   <AreaChart data={points} margin={{top:2,right:0,bottom:0,left:0}}>
    <defs><linearGradient id={'s'+id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--chart-1)" stopOpacity={.22}/><stop offset="1" stopColor="var(--chart-1)" stopOpacity={0}/></linearGradient></defs>
    <YAxis hide reversed={invert} domain={snapshot?['dataMin','dataMax']:[0,'dataMax']}/>
    <Area type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={1.6} fill={invert?'none':'url(#s'+id+')'} isAnimationActive animationDuration={900} connectNulls dot={false}/>
   </AreaChart>
  </ResponsiveContainer>
 </div>;
}
