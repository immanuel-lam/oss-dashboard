export const fmt=(n:number)=>new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(n);
export const compact=(n:number)=>Math.abs(n)>=10000?new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(n):fmt(n);
export const shortDate=(iso:string,year=false)=>new Date(iso+'T00:00:00Z').toLocaleDateString(undefined,{day:'numeric',month:'short',year:year?'numeric':undefined,timeZone:'UTC'});
export const longDate=(iso:string)=>new Date(iso+'T00:00:00Z').toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
export function ago(iso:string){const s=(Date.now()-Date.parse(iso))/1000;if(!Number.isFinite(s))return '';const rtf=new Intl.RelativeTimeFormat(undefined,{numeric:'auto',style:'narrow'});if(s<60)return 'just now';if(s<3600)return rtf.format(-Math.round(s/60),'minute');if(s<86400)return rtf.format(-Math.round(s/3600),'hour');return rtf.format(-Math.round(s/86400),'day');}
