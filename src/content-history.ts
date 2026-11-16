interface VideoObservation {content_id:string; observed_date:string; title:string; views:number|null}
/** Stored lifetime observations, not per-day view gains. Never request a provider sync here. */
export async function loadTikTokHistory(db:D1Database) {
 const result=await db.prepare("SELECT content_id,observed_date,title,views FROM content_snapshots WHERE source='tiktok' ORDER BY observed_date DESC,content_id LIMIT 5001").all<VideoObservation>();
 return {videoHistory:result.results.slice(0,5000),videoHistoryTruncated:result.results.length>5000};
}

const GROUPS_SQL="CREATE TABLE IF NOT EXISTS content_groups(source TEXT NOT NULL, content_id TEXT NOT NULL, group_id TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(source,content_id))";
/** Same statement as migrations/0004; run idempotently so the feature works before the migration is applied remotely. */
export const ensureContentGroups=(db:D1Database)=>db.prepare(GROUPS_SQL).run();

/** Lifetime views per item and observation date for every platform, for per-content history charts. */
export async function loadContentHistory(db:D1Database){
 const result=await db.prepare('SELECT source,content_id,observed_date,views FROM content_snapshots WHERE views IS NOT NULL ORDER BY observed_date DESC LIMIT 5001').all<{source:string;content_id:string;observed_date:string;views:number}>();
 await ensureContentGroups(db);
 const groups=await db.prepare('SELECT source,content_id,group_id FROM content_groups').all<{source:string;content_id:string;group_id:string}>();
 return {contentHistory:result.results.slice(0,5000),contentGroups:groups.results};
}

/** Owner-only manual grouping. group_id null removes the override and returns the item to automatic grouping. */
export function validateGroupChange(body:unknown){
 const b=body as Record<string,unknown>;
 if(!b||typeof b!=='object'||!Array.isArray(b.items)||!b.items.length||b.items.length>20)throw Error('Provide 1–20 items.');
 const items=b.items.map((i:any)=>{if(!['tiktok','instagram','youtube','facebook'].includes(i?.source)||typeof i?.content_id!=='string'||!/^[\w.:-]{1,80}$/.test(i.content_id))throw Error('Invalid content item.');return {source:i.source as string,content_id:i.content_id as string};});
 const group=b.group_id===null?null:typeof b.group_id==='string'&&/^(g_[a-f0-9-]{8,40}|solo:[a-z]+:[\w.:-]{1,80})$/.test(b.group_id)?b.group_id:undefined;
 if(group===undefined)throw Error('Invalid group.');
 return {items,group};
}
export async function saveGroupChange(db:D1Database,change:ReturnType<typeof validateGroupChange>){
 await ensureContentGroups(db);const now=new Date().toISOString();
 await db.batch(change.items.map(i=>change.group===null?db.prepare('DELETE FROM content_groups WHERE source=? AND content_id=?').bind(i.source,i.content_id):db.prepare('INSERT INTO content_groups(source,content_id,group_id,updated_at) VALUES(?,?,?,?) ON CONFLICT(source,content_id) DO UPDATE SET group_id=excluded.group_id,updated_at=excluded.updated_at').bind(i.source,i.content_id,change.group,now)));
}
