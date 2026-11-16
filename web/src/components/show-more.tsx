import {ChevronDown} from 'lucide-react';
import {cn} from '@/lib/utils';

/** Expands a truncated list. Hidden when everything already fits. */
export function ShowMore({total,shown,expanded,onToggle,className}:{total:number;shown:number;expanded:boolean;onToggle:()=>void;className?:string}){
 if(total<=shown&&!expanded)return null;
 return <button type="button" onClick={onToggle} aria-expanded={expanded} className={cn('inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground',className)}>
  {expanded?'Show less':'Show all '+total.toLocaleString()}<ChevronDown className={cn('size-3.5 transition-transform',expanded&&'rotate-180')}/>
 </button>;
}
