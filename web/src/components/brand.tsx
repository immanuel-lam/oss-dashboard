import {Globe} from 'lucide-react';
import {brandIcons} from '../../../src/icons';
import type {Source} from '@/lib/metrics';
import {cn} from '@/lib/utils';

/** Source glyph in a small rounded tile. Brand paths are Simple Icons (CC0). */
export function SourceIcon({source,className}:{source:Source;className?:string}){
 const path=(brandIcons as Record<string,string>)[source];
 return <span aria-hidden className={cn('inline-grid size-6 shrink-0 place-items-center rounded-md border bg-accent text-foreground',className)}>
  {path?<svg viewBox="0 0 24 24" className="size-[55%]"><path fill="currentColor" d={path}/></svg>:<Globe className="size-[55%]"/>}
 </span>;
}
