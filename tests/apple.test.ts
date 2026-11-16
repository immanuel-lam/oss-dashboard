import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSales} from '../src/apple.ts';
test('Apple report separates acquisitions, redownloads and updates and filters other apps',()=>{
 const report='Apple Identifier\tProduct Type Identifier\tUnits\n123\t1F\t12\n123\t3F\t3\n123\t7F\t9\n456\t1F\t100\n123\tIA1\t5';
 const rows=parseSales(report,'123','2026-10-01');assert.deepEqual(rows.map(r=>[r.metric,r.value]),[['sales_first_downloads',12],['sales_redownloads',3],['sales_updates',9]]);assert.ok(rows.every(r=>r.timezone==='America/Los_Angeles'));
});
test('Apple rejects unexpected report schema',()=>assert.throws(()=>parseSales('wrong\tcolumns','123','2026-10-01')));

test('Sales history refreshes two recent days, then walks back through unstored days',async()=>{const {salesDays}=await import('../src/apple.ts');const today=new Date('2026-10-31T12:00:00Z');
 assert.deepEqual(salesDays(today,new Set(['2026-10-27','2026-10-26']),4),['2026-10-29','2026-10-28','2026-10-25','2026-10-24']);
 assert.equal(salesDays(today,new Set(),20).length,20);});
test('stored Apple messages name the failing step without provider bodies',async()=>{const {SafeError,safeMessage}=await import('../src/safe-error.ts');
 assert.equal(safeMessage(new SafeError('Apple API request failed (HTTP 403).')),'Apple API request failed (HTTP 403).');assert.equal(safeMessage(new Error('{"secret":"x"}')),'unexpected error (Error).');assert.match(safeMessage(new Error('Too many subrequests.')),/subrequests/);});
test('chart rank is the 1-based position and missing apps are unavailable',async()=>{const {rankIn,rankInPage}=await import('../src/charts.ts');
 const feed={feed:{results:['1','2','1234567890'].map(id=>({id}))}};assert.equal(rankIn(feed,'1234567890'),3);assert.equal(rankIn(feed,'999'),null);assert.throws(()=>rankIn({},'1'));
 const page=Array.from({length:20},(_,i)=>'<a href="https://apps.apple.com/au/app/x/id'+(1000000+i)+'">x</a><a href="/au/app/x/id'+(1000000+i)+'">again</a>').join('').replace('id1000013','id1234567890').replace('id1000013','id1234567890');
 assert.equal(rankInPage(page,'1234567890'),14);assert.equal(rankInPage(page,'42'),null);assert.throws(()=>rankInPage('<html></html>','1'));});
test('Instagram daily insights keep reported zeros, drop unknown metrics and use Pacific days',async()=>{const {dailyRows,insightDays,pacificMidnight}=await import('../src/instagram.ts');
 const rows=dailyRows({data:[{name:'views',total_value:{value:120}},{name:'reach',total_value:{value:0}},{name:'mystery',total_value:{value:5}},{name:'likes'}]},'2026-10-30');
 assert.deepEqual(rows.map(r=>[r.metric,r.value]),[['views',120],['reach',0]]);assert.ok(rows.every(r=>r.timezone==='America/Los_Angeles'));
 assert.throws(()=>dailyRows({},'2026-10-30'));
 assert.equal(pacificMidnight('2026-10-30'),Date.parse('2026-10-30T07:00:00Z')/1000);assert.equal(pacificMidnight('2026-12-01'),Date.parse('2026-12-01T08:00:00Z')/1000);
 assert.deepEqual(insightDays('2026-10-31',new Set(['2026-10-30','2026-10-28']),4),['2026-10-30','2026-10-29','2026-10-27','2026-10-26']);});

test('Facebook Page insights map to daily metrics on the Pacific day before end_time',async()=>{const {pageRows}=await import('../src/facebook-page.ts');
 const rows=pageRows({data:[{name:'page_media_view',values:[{end_time:'2026-10-31T07:00:00+0000',value:716},{end_time:'2026-11-01T07:00:00+0000',value:0}]},{name:'page_unknown',values:[{end_time:'2026-10-31T07:00:00+0000',value:9}]},{name:'page_daily_follows_unique',values:[{end_time:'bad',value:1}]}]});
 assert.deepEqual(rows.map(r=>[r.date,r.metric,r.value]),[['2026-10-30','views',716],['2026-10-31','views',0]]);assert.throws(()=>pageRows({}));});

test('a rate-limited chart is skipped without failing the run',async()=>{const {syncCharts}=await import('../src/charts.ts');const runs:string[]=[];let saved=0;
 const db:any={prepare:(sql:string)=>({bind:()=>({run:async()=>{runs.push(sql);}})}),batch:async(st:any[])=>{saved+=st.length;}};
 const original=globalThis.fetch;let call=0;globalThis.fetch=(async()=>{call++;if(call===1)return new Response('',{status:429});return new Response(call===2?Array.from({length:12},(_,i)=>'<a href="/au/app/x/id'+(1000000+i)+'">x</a>').join('').replace('id1000002','id1234567890'):JSON.stringify({feed:{results:[]}}),{status:200});}) as any;
 try{const r=await syncCharts({DB:db,APPLE_APP_ID:'1234567890',APP_STORE_GENRES:'navigation:6010,travel:6003'});assert.equal(r.limited,1);assert.equal(r.rows,1);assert.equal(runs.length,0);}finally{globalThis.fetch=original;}});

test('chart list follows the configured storefront and genres',async()=>{const {chartsFor}=await import('../src/charts.ts');
 assert.deepEqual(chartsFor({}).map(c=>c.url),['https://rss.marketingtools.apple.com/api/v2/us/apps/top-free/100/apps.json']);
 const charts=chartsFor({APP_STORE_COUNTRY:'GB',APP_STORE_GENRES:'navigation:6010'});
 assert.deepEqual(charts.map(c=>c.metric),['rank_navigation_snapshot','rank_overall_snapshot']);assert.equal(charts[0].url,'https://apps.apple.com/gb/charts/iphone/navigation-apps/6010?chart=top-free');
 assert.throws(()=>chartsFor({APP_STORE_COUNTRY:'usa'}));assert.throws(()=>chartsFor({APP_STORE_GENRES:'navigation'}));
});
