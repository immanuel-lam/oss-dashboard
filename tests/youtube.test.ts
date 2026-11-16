import {test} from 'node:test';import assert from 'node:assert/strict';import {syncYouTube} from '../src/connectors.ts';import {encrypt} from '../src/oauth.ts';
const key=btoa('a'.repeat(32));
async function harness(responses:Record<string,()=>Response>,storedRows=0){
 const runs:any[]=[];const saved:any[]=[];const urls:string[]=[];
 const env:any={TOKEN_ENCRYPTION_KEY:key,YOUTUBE_CLIENT_ID:'id',YOUTUBE_CLIENT_SECRET:'secret'};
 const cipher=await encrypt(env,'youtube',{access_token:'token',expires_at:Date.now()+3600e3});
 env.DB={
  prepare:(sql:string)=>({bind:(...args:any[])=>({run:async()=>{if(sql.startsWith('INSERT INTO sync_runs'))runs.push({status:args[3]});if(sql.startsWith('UPDATE sync_runs'))Object.assign(runs.at(-1),{status:args[1],message:args[2]});},first:async()=>sql.includes('connections')?{ciphertext:cipher}:{n:storedRows}}),first:async()=>({n:storedRows})}),
  batch:async(statements:any[])=>{saved.push(statements.length);}
 };
 const original=globalThis.fetch;
 globalThis.fetch=(async(input:any)=>{const url=String(input);urls.push(url);const match=Object.keys(responses).find(k=>url.includes(k));if(!match)throw Error('unexpected '+url);return responses[match]();}) as any;
 return {env,runs,saved,urls,restore:()=>{globalThis.fetch=original;}};
}
const ok=(body:unknown)=>()=>new Response(JSON.stringify(body),{status:200});
const headers=['day','views','estimatedMinutesWatched','subscribersGained','subscribersLost','likes','comments','shares'].map(name=>({name}));
const channel='UC'+'a'.repeat(22);
test('YouTube queries the resolved channel and backfills a year on first sync',async()=>{
 const h=await harness({'youtube/v3/channels':ok({items:[{id:channel,snippet:{title:'Example Channel'}}]}),'youtubeanalytics':ok({columnHeaders:headers,rows:[['2026-10-01',5,9,1,0,2,0,1]]})});
 try{assert.deepEqual(await syncYouTube(h.env),{rows:7});const report=new URL(h.urls[1]);assert.equal(report.searchParams.get('ids'),'channel=='+channel);const days=(Date.parse(report.searchParams.get('endDate')!)-Date.parse(report.searchParams.get('startDate')!))/86400000+1;assert.equal(days,365);assert.equal(h.runs[0].status,'success');assert.match(h.runs[0].message,/Channel: Example Channel/);assert.deepEqual(h.saved,[7]);}finally{h.restore();}
});
test('YouTube refreshes 90 days once history exists',async()=>{
 const h=await harness({'youtube/v3/channels':ok({items:[{id:channel,snippet:{title:'Example Channel'}}]}),'youtubeanalytics':ok({columnHeaders:headers,rows:[]})},40);
 try{await syncYouTube(h.env);const report=new URL(h.urls[1]);const days=(Date.parse(report.searchParams.get('endDate')!)-Date.parse(report.searchParams.get('startDate')!))/86400000+1;assert.equal(days,90);}finally{h.restore();}
});
test('an empty YouTube report is waiting, not a successful sync, and stores nothing',async()=>{
 const h=await harness({'youtube/v3/channels':ok({items:[{id:channel,snippet:{title:'Example Channel'}}]}),'youtubeanalytics':ok({columnHeaders:headers})});
 try{assert.deepEqual(await syncYouTube(h.env),{rows:0});assert.equal(h.runs[0].status,'waiting');assert.match(h.runs[0].message,/no daily rows/);assert.deepEqual(h.saved,[]);}finally{h.restore();}
});
test('a grant without channel access falls back to channel==MINE and asks for reconnection',async()=>{
 const h=await harness({'youtube/v3/channels':()=>new Response('{"error":"secret detail"}',{status:403}),'youtubeanalytics':ok({columnHeaders:headers,rows:[['2026-10-01',5,9,1,0,2,0,1]]})});
 try{await syncYouTube(h.env);assert.equal(new URL(h.urls[1]).searchParams.get('ids'),'channel==MINE');assert.equal(h.runs[0].status,'partial');assert.match(h.runs[0].message,/Reconnect YouTube/);}finally{h.restore();}
});
test('an account without a channel fails with a safe message',async()=>{
 const h=await harness({'youtube/v3/channels':ok({items:[]})});
 try{await assert.rejects(()=>syncYouTube(h.env));assert.equal(h.runs[0].status,'error');assert.match(h.runs[0].message,/no YouTube channel/);assert.doesNotMatch(h.runs[0].message,/secret/);}finally{h.restore();}
});
test('refused analytics access records a reconnect message without the provider body',async()=>{
 const h=await harness({'youtube/v3/channels':ok({items:[{id:channel,snippet:{title:'Example Channel'}}]}),'youtubeanalytics':()=>new Response('{"error":"secret detail"}',{status:403})});
 try{await assert.rejects(()=>syncYouTube(h.env));assert.match(h.runs[0].message,/Reconnect YouTube/);assert.doesNotMatch(h.runs[0].message,/secret/);}finally{h.restore();}
});

test('an all-zero year is partial and names the channel',async()=>{
 const h=await harness({'youtube/v3/channels':ok({items:[{id:channel,snippet:{title:'Personal'}}]}),'youtubeanalytics':ok({columnHeaders:headers,rows:[['2026-10-01',0,0,0,0,0,0,0],['2026-10-02',0,0,0,0,0,0,0]]})});
 try{await syncYouTube(h.env);assert.equal(h.runs[0].status,'partial');assert.match(h.runs[0].message,/Channel: Personal/);assert.match(h.runs[0].message,/all zero so far/);}finally{h.restore();}
});
