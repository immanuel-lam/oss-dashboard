import {test} from 'node:test';import assert from 'node:assert/strict';import {pageViewMetrics,pageViewQuery} from '../src/website';
test('website totals retain daily counts and consent provenance',()=>{const rows=pageViewMetrics([['2026-10-29',12]]);assert.equal(rows[0].value,12);assert.equal(rows[0].metric,'page_views');assert.equal(rows[0].timezone,'UTC');assert.match(rows[0].provenance,/opted-in/);assert.doesNotMatch(pageViewQuery(),/\$host/);assert.match(pageViewQuery(['example.com','www.example.com']),/properties\.\$host IN \('example\.com', 'www\.example\.com'\)/);assert.deepEqual(pageViewMetrics([]),[]);});
test('website rejects malformed or duplicate aggregate rows',()=>{for(const rows of [[['2026-10-29','12']],[['2026-10-29',-1]],[['2026-02-30',2]],[['2026-10-29',1],['2026-10-29',2]],undefined])assert.throws(()=>pageViewMetrics(rows));});

test('Cloudflare maps page views and visits separately and rejects partial reports',async()=>{const {cloudflareMetrics}=await import('../src/website');const report={data:{viewer:{accounts:[{rumPageloadEventsAdaptiveGroups:[{count:28,sum:{visits:9},dimensions:{date:'2026-10-27'}}]}]}}};const rows=cloudflareMetrics(report);assert.equal(rows.find(r=>r.metric==='page_views')?.value,28);assert.equal(rows.find(r=>r.metric==='visits')?.value,9);assert.match(rows[0].provenance,/Cloudflare/);assert.throws(()=>cloudflareMetrics({...report,errors:[{message:'partial failure'}]}));assert.throws(()=>cloudflareMetrics({data:{viewer:{accounts:[]}}}));});

test('Cloudflare is read in 7-day chunks: 14 days hourly, 180 days on the full run',async()=>{const {chunks}=await import('../src/website');const today=new Date('2026-10-31T13:00:00Z');const day=(d:Date)=>d.toISOString().slice(0,10);
 const recent=chunks(today,false);assert.deepEqual(recent.map(c=>c.map(day)),[['2026-10-24','2026-10-31'],['2026-10-17','2026-10-24']]);
 const full=chunks(today,true);assert.equal(full.length,26);assert.equal(day(full.at(-1)![0]),'2026-05-04');for(const [a,b] of full)assert.ok((b.getTime()-a.getTime())/86400000<=7);
 const {cloudflareMetrics}=await import('../src/website');const groups=Array.from({length:8},(_,i)=>({count:1,sum:{visits:1},dimensions:{date:'2026-08-0'+(i+1)}}));const report={data:{viewer:{accounts:[{rumPageloadEventsAdaptiveGroups:groups}]}}};assert.throws(()=>cloudflareMetrics(report,7));assert.equal(cloudflareMetrics(report,8).length,16);});

test('SITE_HOSTNAMES accepts plain host names only',async()=>{const {hostnames,cloudflareQuery}=await import('../src/website');
 assert.deepEqual(hostnames(' Example.com,www.example.com '),['example.com','www.example.com']);assert.deepEqual(hostnames(''),[]);
 for(const bad of ["x.com') OR 1=1 --",'localhost','https://example.com'])assert.throws(()=>hostnames(bad),/plain host names/);
 assert.doesNotMatch(cloudflareQuery([]),/requestHost_in/);assert.match(cloudflareQuery(['example.com']),/requestHost_in:\$hosts/);
});
