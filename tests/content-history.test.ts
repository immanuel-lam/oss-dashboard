import {test} from 'node:test';import assert from 'node:assert/strict';import {loadTikTokHistory} from '../src/content-history.ts';
test('history reads bounded TikTok observations and reports truncation without aggregation',async()=>{
 const observations=Array.from({length:5001},(_,index)=>({content_id:'video',observed_date:'2026-01-01',title:'Fixture',views:index}));
 const db={prepare:(sql:string)=>{assert.match(sql,/WHERE source='tiktok'/);assert.match(sql,/LIMIT 5001/);return {all:async()=>({results:observations})};}} as unknown as D1Database;
 const result=await loadTikTokHistory(db);assert.equal(result.videoHistory.length,5000);assert.equal(result.videoHistoryTruncated,true);assert.equal(result.videoHistory[0].views,0);
});
test('content grouping requests accept known items and safe group ids only',async()=>{const {validateGroupChange}=await import('../src/content-history.ts');
 assert.deepEqual(validateGroupChange({items:[{source:'tiktok',content_id:'7301'}],group_id:'g_0123abcd-ef'}).group,'g_0123abcd-ef');
 assert.equal(validateGroupChange({items:[{source:'youtube',content_id:'abc_DEF-123'}],group_id:null}).group,null);
 for(const bad of [{items:[],group_id:null},{items:[{source:'website',content_id:'1'}],group_id:null},{items:[{source:'tiktok',content_id:"1'; DROP"}],group_id:null},{items:[{source:'tiktok',content_id:'1'}],group_id:'anything'}])assert.throws(()=>validateGroupChange(bad));});
