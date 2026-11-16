import {useState} from 'react';
import {motion} from 'motion/react';
import {CalendarDays} from 'lucide-react';
import type {DateRange} from 'react-day-picker';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
import {Calendar} from '@/components/ui/calendar';
import {addDays,type Period} from '@/lib/metrics';
import {shortDate} from '@/lib/format';
import {cn} from '@/lib/utils';

const iso=(d:Date)=>new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())).toISOString().slice(0,10);
const local=(s:string)=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d);};

/** Segmented presets with a sliding thumb, plus a calendar range. Custom ends are stored exclusive (the day after the last chosen day). */
export function RangePicker({period,custom,onChange}:{period:Period;custom:{start:string;end:string}|null;onChange:(p:Period,c?:{start:string;end:string})=>void}){
 const [open,setOpen]=useState(false);
 const [draft,setDraft]=useState<DateRange|undefined>(custom?{from:local(custom.start),to:local(addDays(custom.end,-1))}:undefined);
 const item=(value:Period,label:React.ReactNode,extra?:object)=>(
  <button key={value} type="button" aria-pressed={period===value} onClick={()=>value!=='custom'&&onChange(value)} {...extra}
   className={cn('relative z-0 inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium tabular text-muted-foreground transition-colors hover:text-foreground sm:flex-none',period===value&&'text-foreground')}>
   {period===value&&<motion.span layoutId="range-thumb" className="absolute inset-0 -z-10 rounded-md border bg-popover shadow-card" transition={{type:'spring',stiffness:500,damping:38}}/>}
   {label}
  </button>);
 return <div role="group" aria-label="Reporting period" className="flex w-full rounded-lg border bg-card p-0.5 sm:w-auto">
  {item('7','7D')}{item('28','28D')}{item('90','90D')}
  <Popover open={open} onOpenChange={setOpen}>
   <PopoverTrigger asChild>{item('custom',<><CalendarDays className="size-4"/>{period==='custom'&&custom?shortDate(custom.start)+' – '+shortDate(addDays(custom.end,-1)):'Custom'}</>,{onClick:()=>setOpen(true)})}</PopoverTrigger>
   <PopoverContent align="end" className="w-auto p-0">
    <Calendar mode="range" numberOfMonths={1} selected={draft} onSelect={setDraft} disabled={{after:new Date()}} defaultMonth={draft?.from}/>
    <div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
     <span className="tabular">{draft?.from?shortDate(iso(draft.from),true)+(draft.to?' – '+shortDate(iso(draft.to),true):''):'Choose a start day'}</span>
     <button type="button" disabled={!draft?.from||!draft?.to} onClick={()=>{if(draft?.from&&draft.to){onChange('custom',{start:iso(draft.from),end:addDays(iso(draft.to),1)});setOpen(false);}}}
      className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-40">Apply</button>
    </div>
   </PopoverContent>
  </Popover>
 </div>;
}
