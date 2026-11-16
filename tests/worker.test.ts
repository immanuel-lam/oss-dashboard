import {test} from 'node:test';import assert from 'node:assert/strict';import worker from '../src/worker.ts';
const assets={fetch:async()=>new Response('<!doctype html>',{status:200})} as any;
test('missing database fails closed on the API with a clear message',async()=>{const r=await worker.fetch(new Request('https://dashboard.invalid/api/metrics'),{ASSETS:assets} as any);assert.equal(r.status,503);assert.equal(r.headers.get('Cache-Control'),'no-store');});
test('the page is served without sign-in and keeps the security headers',async()=>{const r=await worker.fetch(new Request('https://dashboard.invalid/'),{ASSETS:assets} as any);assert.equal(r.status,200);assert.match(r.headers.get('Content-Security-Policy')??'',/style-src 'self'/);assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');});
test('cross-origin and non-JSON writes are rejected before database access',async()=>{
 const env={ASSETS:assets,DB:{prepare:()=>{throw Error('database touched');}}} as any;
 for(const headers of [{Origin:'https://evil.invalid','Content-Type':'application/json'},{Origin:'https://dashboard.invalid','Content-Type':'text/plain'},{'Content-Type':'application/json'}]){
  const r=await worker.fetch(new Request('https://dashboard.invalid/api/sync/website',{method:'POST',headers,body:'{}'}),env);assert.equal(r.status,403);}
});
test('an OAuth callback without the starting browser cookie is refused',async()=>{
 const env={ASSETS:assets,TOKEN_ENCRYPTION_KEY:btoa('a'.repeat(32)),YOUTUBE_CLIENT_ID:'id',YOUTUBE_CLIENT_SECRET:'secret',DB:{prepare:()=>{throw Error('database touched');}}} as any;
 const r=await worker.fetch(new Request('https://dashboard.invalid/oauth/youtube/callback?code=x&state=y'),env);assert.equal(r.status,400);assert.match(r.headers.get('Set-Cookie')??'',/Max-Age=0/);
});
test('starting a connection sets a short-lived HttpOnly binding cookie that matches the stored state',async()=>{
 const bound:unknown[][]=[];const env={ASSETS:assets,TOKEN_ENCRYPTION_KEY:btoa('a'.repeat(32)),YOUTUBE_CLIENT_ID:'id',YOUTUBE_CLIENT_SECRET:'secret',DB:{prepare:()=>({bind:(...a:unknown[])=>{bound.push(a);return {run:async()=>({})};}})}} as any;
 const r=await worker.fetch(new Request('https://dashboard.invalid/api/connect/youtube',{method:'POST',headers:{Origin:'https://dashboard.invalid','Content-Type':'application/json'},body:'{}'}),env);
 assert.equal(r.status,200);const cookie=r.headers.get('Set-Cookie')??'';assert.match(cookie,/^oauth_binding=[0-9a-f-]{36}; Path=\/oauth\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
 const binding=/oauth_binding=([^;]+)/.exec(cookie)![1];assert.ok(bound.some(a=>a[1]==='youtube'&&a[2]===binding));
 assert.match(((await r.json()) as {url:string}).url,/^https:\/\/accounts\.google\.com\//);
});
test('settings expose a display name and only https profile links',async()=>{const {settings}=await import('../src/worker.ts');
 assert.deepEqual(settings({}),{name:'Dashboard',profiles:{}});
 assert.deepEqual(settings({DASHBOARD_NAME:' My stats ',PROFILE_URLS:'youtube=https://youtube.com/@me, tiktok=javascript:alert(1),github=http://x.invalid,bad'}),{name:'My stats',profiles:{youtube:'https://youtube.com/@me'}});
});

test('background schedules skip providers without connected accounts',async()=>{let queued=0;let reads=0;const env={DB:{prepare:(sql:string)=>{assert.equal(sql,'SELECT provider FROM connections');reads++;return {all:async()=>({results:[]})};}},TOKEN_ENCRYPTION_KEY:'configured',TIKTOK_CLIENT_ID:'configured',TIKTOK_CLIENT_SECRET:'configured',YOUTUBE_CLIENT_ID:'configured',YOUTUBE_CLIENT_SECRET:'configured'} as any;const ctx={waitUntil:()=>{queued++;}} as any;for(const [cron,minute] of [['*/15 * * * *',0],['*/15 * * * *',15],['*/15 * * * *',30],['*/15 * * * *',45],['30 5 * * *',30]] as const)await worker.scheduled({cron,scheduledTime:Date.UTC(2026,10,1,3,minute)} as any,env,ctx);assert.equal(reads,5);assert.equal(queued,0);});

test('a stale running sync is closed with a safe message',async()=>{const {staleRunsSql}=await import('../src/limits.ts');assert.match(staleRunsSql,/status='running' AND started_at<\?/);assert.match(staleRunsSql,/Sync stopped before it finished/);});
test('lock acquisition returns a release function or null when held',async()=>{const {acquireLock}=await import('../src/limits.ts');let held=false;const db:any={prepare:(sql:string)=>({bind:()=>({first:async()=>{if(held)return null;held=true;return {source:'x'};},run:async()=>{held=false;}})})};
 const release=await acquireLock(db,'x');assert.ok(release);assert.equal(await acquireLock(db,'x'),null);await release!();assert.ok(await acquireLock(db,'x'));});

test('hourly jobs run one after another in a single waitUntil chain',async()=>{let waits=0;let chain:Promise<unknown>|undefined;const order:string[]=[];
 const original=globalThis.fetch;globalThis.fetch=(async(u:any)=>{order.push(String(u).includes('apps.apple.com')||String(u).includes('marketingtools')?'chart':'other');return new Response('{}',{status:500});}) as any;
 const env={APPLE_APP_ID:'1',DB:{prepare:(sql:string)=>({all:async()=>({results:[]}),bind:()=>({first:async()=>({source:'x'}),run:async()=>({})})})}} as any;
 try{await worker.scheduled({cron:'*/15 * * * *',scheduledTime:Date.UTC(2026,10,1,3,0)} as any,env,{waitUntil:(p:Promise<unknown>)=>{waits++;chain=p;}} as any);assert.equal(waits,1);await chain;assert.ok(order.length>=1);assert.equal(order[0],'chart');}finally{globalThis.fetch=original;}});

test('two cron triggers cover four hourly job groups and the daily reports',async()=>{const {CRONS,slotFor}=await import('../src/worker.ts');const {readFileSync}=await import('node:fs');
 const crons=JSON.parse(readFileSync('wrangler.jsonc','utf8').replace(/\/\/.*$/gm,'')).triggers.crons;assert.deepEqual([...crons].sort(),[...CRONS].sort());
 const at=(m:number)=>slotFor('*/15 * * * *',Date.UTC(2026,10,1,3,m));assert.deepEqual([0,15,30,45].map(at),['charts-website','instagram','facebook-youtube','apple-sales']);assert.equal(at(16),'instagram');assert.equal(slotFor('30 5 * * *',0),'daily');});

test('GitHub history cannot displace audience rows at the report limit',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {REPORT_QUERIES}=await import('../src/worker.ts');
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE metrics(source TEXT,date TEXT,metric TEXT)');
  const insert=db.prepare('INSERT INTO metrics VALUES(?,?,?)');
  db.exec('BEGIN');
  for(let i=0;i<20000;i++)insert.run('website','2026-10-01','audience_'+i);
  for(let i=0;i<2610;i++)insert.run('github','2026-11-01','repo_'+i);
  db.exec('COMMIT');
  const audience=db.prepare(REPORT_QUERIES[0]).all(),github=db.prepare(REPORT_QUERIES[1]).all();
  assert.equal(audience.length,20000);assert.equal(github.length,2610);
  assert.ok(audience.every(r=>r.source==='website'));assert.ok(github.every(r=>r.source==='github'));
  db.exec("INSERT INTO metrics VALUES('website','2026-10-02','extra')");
  assert.equal(db.prepare(REPORT_QUERIES[0]).all().length,20001);
  db.exec("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<2500) INSERT INTO metrics SELECT 'github','2026-11-01','extra_'||x FROM n");
  assert.equal(db.prepare(REPORT_QUERIES[1]).all().length,5001);
 }finally{db.close();}
});
