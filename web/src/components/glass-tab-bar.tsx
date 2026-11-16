import {useEffect,useLayoutEffect,useRef,useState,type ComponentType} from 'react';
import {animate,motion,useMotionValue,useReducedMotion,useSpring,useTransform} from 'motion/react';
import {cn} from '@/lib/utils';

export interface GlassTab {id:string; label:string; icon:ComponentType<{className?:string}>}

/**
 * Phone tab bar in the spirit of iOS Liquid Glass: a floating translucent capsule whose selection lens can be dragged
 * across the tabs and springs to the nearest one on release. It shrinks while scrolling down and returns on scroll up.
 * Taps still work as plain buttons, and keyboard users get normal buttons with aria-pressed.
 */
export function GlassTabBar({tabs,value,onChange}:{tabs:readonly GlassTab[];value:string;onChange:(id:string)=>void}){
 const bar=useRef<HTMLDivElement>(null);const reduce=useReducedMotion();
 const [width,setWidth]=useState(0);const [dragging,setDragging]=useState(false);const [hover,setHover]=useState<number>();
 const [compact,setCompact]=useState(false);
 const index=Math.max(0,tabs.findIndex(t=>t.id===value));
 const PAD=6;const slot=width?(width-PAD*2)/tabs.length:0;
 const x=useMotionValue(0);
 const lift=useSpring(1,{stiffness:520,damping:30});
 const glare=useTransform(x,v=>`${slot?((v+slot/2)/(width||1))*100:50}%`);

 useLayoutEffect(()=>{const el=bar.current;if(!el)return;const ro=new ResizeObserver(()=>setWidth(el.clientWidth));ro.observe(el);setWidth(el.clientWidth);return()=>ro.disconnect();},[]);
 // Settle the lens on the selected tab whenever selection or size changes (and not mid-drag).
 useEffect(()=>{if(!slot||dragging)return;const target=PAD+index*slot;if(reduce)x.set(target);else animate(x,target,{type:'spring',stiffness:480,damping:36});},[index,slot,dragging,reduce,x]);
 // iOS 26 behaviour: minimise while reading down the page, restore on scroll up or near the top.
 useEffect(()=>{let last=window.scrollY;const onScroll=()=>{const y=window.scrollY;if(Math.abs(y-last)<8)return;setCompact(y>last&&y>120);last=y;};window.addEventListener('scroll',onScroll,{passive:true});return()=>window.removeEventListener('scroll',onScroll);},[]);

 const at=(clientX:number)=>{const r=bar.current!.getBoundingClientRect();return Math.min(tabs.length-1,Math.max(0,Math.floor((clientX-r.left-PAD)/slot)));};
 const start=useRef<{x:number;lens:number;moved:boolean}|undefined>(undefined);
 const onDown=(e:React.PointerEvent)=>{if(!slot)return;start.current={x:e.clientX,lens:x.get(),moved:false};(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);};
 const onMove=(e:React.PointerEvent)=>{const s=start.current;if(!s)return;const dx=e.clientX-s.x;if(!s.moved&&Math.abs(dx)<6)return;
  if(!s.moved){s.moved=true;setDragging(true);lift.set(1.12);}
  x.set(Math.min(PAD+(tabs.length-1)*slot,Math.max(PAD,s.lens+dx)));setHover(at(e.clientX));};
 const onUp=(e:React.PointerEvent)=>{const s=start.current;start.current=undefined;if(!s)return;lift.set(1);
  if(s.moved){const i=at(e.clientX);setDragging(false);setHover(undefined);if(tabs[i].id!==value)onChange(tabs[i].id);else animate(x,PAD+i*slot,{type:'spring',stiffness:480,damping:36});return;}
  const i=at(e.clientX);if(tabs[i]&&tabs[i].id!==value)onChange(tabs[i].id);};

 const active=dragging&&hover!==undefined?hover:index;
 return <motion.div className="fixed inset-x-3 z-40 md:hidden" style={{bottom:'calc(10px + env(safe-area-inset-bottom))'}}
  animate={{scale:compact?.86:1,y:compact?6:0}} transition={{type:'spring',stiffness:420,damping:34}}>
  <div ref={bar} role="toolbar" aria-label="Dashboard views" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
   className="glass-bar relative flex touch-none select-none rounded-[26px] p-1.5">
   {slot>0&&<motion.span aria-hidden className="glass-lens absolute top-1.5 bottom-1.5 rounded-[20px]" style={{x,width:slot,scale:lift,'--glare':glare} as never}/>}
   {tabs.map((t,i)=><button key={t.id} type="button" data-tab={t.id} aria-pressed={value===t.id} onClick={e=>e.preventDefault()}
    onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onChange(t.id);}}}
    className={cn('relative z-10 flex h-[52px] flex-1 flex-col items-center justify-center gap-1 rounded-[20px] text-[11px] font-medium text-muted-foreground transition-colors',i===active&&'text-foreground')}>
    <motion.span animate={{scale:dragging&&i===active?1.18:1,y:compact?3:0}} transition={{type:'spring',stiffness:500,damping:28}}><t.icon className={cn('size-5',i===active&&'text-primary')}/></motion.span>
    <motion.span animate={{opacity:compact?0:1,height:compact?0:'auto'}} className="overflow-hidden leading-none">{t.label}</motion.span>
   </button>)}
  </div>
 </motion.div>;
}
