export const sources = ['app-store','google-play','youtube','instagram','tiktok','facebook','website','github'] as const;
export type Source = typeof sources[number];
export interface Metric {source:Source; date:string; metric:string; value:number; unit:string; timezone:string; provenance:string}
export function validateImport(input:unknown):Metric[] {
 if(!Array.isArray(input) || input.length===0 || input.length>5000) throw Error('Provide between 1 and 5000 rows.');
 const seen=new Set<string>();
 return input.map((v:unknown)=>{
  if(!v || typeof v!=='object') throw Error('Each row must be an object.');
  const r=v as Record<string,unknown>;
  if(!sources.includes(r.source as Source)) throw Error('Unknown source.');
  if(typeof r.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(Date.parse(r.date))||new Date(r.date).toISOString().slice(0,10)!==r.date) throw Error('Invalid date.');
  if(typeof r.metric!=='string'|| !/^[a-z][a-z0-9_]{0,63}$/.test(r.metric)) throw Error('Invalid metric name.');
  if(typeof r.value!=='number'||!Number.isFinite(r.value)||r.value<0) throw Error('Values must be finite and non-negative.');
  for(const key of ['unit','timezone','provenance']) if(typeof r[key]!=='string'||!(r[key] as string).trim()||(r[key] as string).length>200) throw Error('Unit, timezone and provenance are required (maximum 200 characters).');
  try { new Intl.DateTimeFormat('en',{timeZone:r.timezone as string}); } catch { throw Error('Invalid timezone.'); }
  const key=[r.source,r.date,r.metric].join('/'); if(seen.has(key)) throw Error('Duplicate metric in import.'); seen.add(key);
  return {source:r.source,date:r.date,metric:r.metric,value:r.value,unit:r.unit,timezone:r.timezone,provenance:r.provenance} as Metric;
 });
}
export async function save(db:D1Database,rows:Metric[]) {
 const now=new Date().toISOString();
 // D1 batch is transactional; the full validated import succeeds or fails together.
 await db.batch(rows.map(r=>db.prepare('INSERT INTO metrics(source,date,metric,value,unit,timezone,provenance,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source,date,metric) DO UPDATE SET value=excluded.value,unit=excluded.unit,timezone=excluded.timezone,provenance=excluded.provenance,updated_at=excluded.updated_at').bind(r.source,r.date,r.metric,r.value,r.unit,r.timezone,r.provenance,now)));
}
