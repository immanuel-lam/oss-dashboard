import {test} from 'node:test';import assert from 'node:assert/strict';
import {chartSeries,contentViews,dailyChange,defaultSeries,rangeFor,snapshotChange,tiles,type MetricRow,type Report} from '../web/src/lib/metrics.ts';

const ago=(days:number)=>new Date(Date.now()-days*86400000).toISOString().slice(0,10);
const daily=(source:any,metric:string,from:number,to:number,value:number):MetricRow[]=>Array.from({length:to-from+1},(_,i)=>({source,metric,date:ago(from+i),value,unit:'count',timezone:'UTC'}));
const report=(metrics:MetricRow[],extra:Partial<Report>={}):Report=>({metrics,content:[],runs:[],accounts:[],connectors:{},oauth:{},...extra});
const r28=()=>rangeFor('28',null);
const tile=(rep:Report,source:string,range=r28())=>tiles(rep,range).find(t=>t.source===source)!;
const video=(id:string,views:number|null,date='2026-01-01',source:any='tiktok')=>({source,content_id:id,views,observed_date:date,title:'Fixture video',url:'https://www.tiktok.com/',likes:null,comments:null,shares:null});

test('daily reports compare matched days with the equal previous period',()=>{
 const t=tile(report([...daily('website','page_views',1,28,120),...daily('website','page_views',29,56,100)]),'website');
 assert.equal(t.value,3360);assert.equal(t.change?.kind,'percent');assert.equal(t.change?.value.toFixed(1),'20.0');
});
test('no change when the previous period is missing or too thin',()=>{
 for(const prev of [[],daily('website','page_views',29,38,100)])assert.equal(tile(report([...daily('website','page_views',1,28,120),...prev]),'website').change,null);
});
test('reporting lag does not show a false decline',()=>{
 const c=tile(report([...daily('youtube','views',3,28,100),...daily('youtube','views',29,56,100)]),'youtube').change;
 assert.ok(c===null||Math.abs(c.value)<.05);
});
test('snapshots show the latest value and an absolute change, never a sum',()=>{
 const rows=[0,5,10].map((d,i)=>({source:'instagram' as const,metric:'followers_snapshot',date:ago(d),value:120-i*10,unit:'count',timezone:'UTC'}));
 const c=snapshotChange(rows);assert.equal(c?.kind,'absolute');assert.equal(c?.value,20);
 assert.equal(tile(report([...rows,...daily('instagram','views',1,3,5)]),'instagram').followers,120);
 assert.equal(snapshotChange([{date:ago(0),value:9}]),null);
});
test('TikTok sums the latest loaded view per video, keeps zero and dash, and has no period change',()=>{
 const rep=report([{source:'tiktok',metric:'followers_snapshot',date:ago(0),value:40,unit:'count',timezone:'UTC'},{source:'tiktok',metric:'followers_snapshot',date:ago(3),value:30,unit:'count',timezone:'UTC'}],{content:[video('a',10),video('a',20,'2026-01-02'),video('b',30),video('c',null),video('a',999,'2026-01-03','instagram')] as any});
 const t=tile(rep,'tiktok');assert.equal(t.value,50);assert.equal(t.coverage,'2 of 3 loaded videos');assert.equal(t.followers,40);assert.equal(t.change,null);assert.match(t.detail,/independent of reporting period/);
 assert.equal(tile(rep,'tiktok',rangeFor('7',null)).value,50);
 assert.equal(contentViews([video('a',0)] as any,'tiktok').value,0);assert.equal(contentViews([video('a',null)] as any,'tiktok').value,null);assert.equal(contentViews([],'tiktok').value,null);
});
test('per-video history is charted separately and preferred by default',()=>{
 const rep=report([{source:'tiktok',metric:'followers_snapshot',date:ago(0),value:31,unit:'count',timezone:'UTC'}],{content:[video('a',30)] as any,videoHistory:[{content_id:'a',observed_date:ago(1),title:'Video A',views:30},{content_id:'a',observed_date:ago(2),title:'Video A',views:20},{content_id:'b',observed_date:ago(1),title:'Video B',views:500}]});
 const series=chartSeries(rep,r28());const chosen=series.find(s=>s.key===defaultSeries(series))!;
 assert.match(chosen.label,/Video A.*lifetime views/);assert.deepEqual(chosen.points.map(p=>p.value),[20,30]);
 assert.equal(tiles(rep,r28()).filter(t=>t.hasData).length,1);
});
test('series labels hide the time zone; units other than count stay visible',()=>{
 const rep=report([...daily('youtube','views',3,10,5),...daily('youtube','watch_minutes',3,10,9).map(r=>({...r,unit:'minutes',timezone:'America/Los_Angeles'}))]);
 const labels=chartSeries(rep,r28()).map(s=>s.label);assert.ok(labels.includes('YouTube · Views'));assert.ok(labels.includes('YouTube · Watch time (minutes)'));assert.ok(!labels.join().includes('America'));
});
test('presets end at the start of today and custom ranges keep their exclusive end',()=>{
 const now=new Date('2026-10-31T05:00:00Z');assert.deepEqual(rangeFor('7',null,now),{start:'2026-10-24',end:'2026-10-31',custom:false});
 assert.deepEqual(rangeFor('custom',{start:'2026-09-01',end:'2026-09-08'},now),{start:'2026-09-01',end:'2026-09-08',custom:true});
 assert.equal(dailyChange([],{source:'website',metric:'page_views',unit:'count',timezone:'UTC'},rangeFor('7',null,now)),null);
});

test('App Store falls back to Sales units only when Analytics has no downloads in the period',()=>{
 const sales=daily('app-store','sales_first_downloads',1,10,3).map(r=>({...r,timezone:'America/Los_Angeles'}));
 assert.equal(tile(report(sales),'app-store').name,'First downloads (Sales)');assert.equal(tile(report(sales),'app-store').value,30);
 assert.equal(tile(report([...sales,...daily('app-store','first_downloads',1,3,5)]),'app-store').value,15);
});

test('chart rank rides on the App Store tile and counts places gained as an improvement',()=>{
 const rows=[[6,20],[3,17],[0,14]].map(([d,v])=>({source:'app-store' as const,metric:'rank_navigation_snapshot',date:ago(d),value:v,unit:'rank',timezone:'UTC'}));
 const list=tiles(report(rows),r28());const app=list.find(x=>x.source==='app-store')!;
 assert.equal(list.filter(x=>x.source==='app-store').length,1);assert.ok(app.hasData);assert.equal(app.chart?.value,14);assert.equal(app.chart?.change?.kind,'rank');assert.equal(app.chart?.change?.value,6);assert.equal(app.chart?.name,'Navigation');
 assert.equal(chartSeries(report(rows),r28())[0].label,'App Store · Navigation chart rank');
});
test('metric tabs list one source with its headline first and rank last',async()=>{const {sourceSeries,metricLabel}=await import('../web/src/lib/metrics.ts');
 const rows=[...daily('app-store','first_downloads',1,5,3),...daily('app-store','redownloads',1,5,1),...[0,1].map(d=>({source:'app-store' as const,metric:'rank_navigation_snapshot',date:ago(d),value:14,unit:'rank',timezone:'UTC'})),...daily('website','page_views',1,5,9)];
 const tabs=sourceSeries(chartSeries(report(rows),r28()),'app-store');assert.deepEqual(tabs.map(metricLabel),['First downloads','Redownloads','Navigation rank']);
});

test('Instagram tile sums daily views and shows the latest follower count',()=>{
 const rows=[...daily('instagram','views',1,5,100),{source:'instagram' as const,metric:'followers_snapshot',date:ago(0),value:122,unit:'count',timezone:'UTC'},{source:'instagram' as const,metric:'followers_snapshot',date:ago(2),value:100,unit:'count',timezone:'UTC'}];
 const t=tile(report(rows),'instagram');assert.equal(t.value,500);assert.equal(t.name,'Views');assert.equal(t.followers,122);
});
test('the same video across platforms groups by date and caption, never two posts from one platform',async()=>{const {groupContent,sameVideo}=await import('../web/src/lib/content.ts');
 const item=(source:string,id:string,title:string,published:string,views:number)=>({source,content_id:id,observed_date:'2026-10-31',title,url:'https://x.invalid/'+id,published_at:published,views,likes:1,comments:0,shares:0}) as any;
 const items=[item('tiktok','t1','Lisbon at 8:12 pm. 1,197 vehicles. One moving network. Our app is now on the App Store. #lisbon','2026-10-29T10:00:00Z',78490),
  item('instagram','i1','Lisbon at 8:12 pm — 1,197 vehicles, one moving network 🚆','2026-10-29T11:00:00Z',9000),
  item('youtube','y1','Every bus, train, metro and ferry in Lisbon at 8:12 pm #shorts','2026-10-30T04:00:00Z',405),
  item('tiktok','t2','Pink buses out. Bankstown metro in. Here’s what changed.','2026-10-29T12:00:00Z',4530),
  item('instagram','i2','Ferries at golden hour','2026-10-20T00:00:00Z',300)];
 const groups=groupContent(items);const top=groups[0];
 assert.deepEqual(top.items.map((i:any)=>i.content_id).sort(),['i1','t1','y1']);assert.equal(top.views,87895);
 assert.ok(groups.every((g:any)=>new Set(g.items.map((i:any)=>i.source)).size===g.items.length));
 assert.equal(sameVideo(items[0],items[3]),false);
 const manual=groupContent(items,[{source:'youtube',content_id:'y1',group_id:'solo:youtube:y1'}]);assert.ok(manual.some((g:any)=>g.manual&&g.items.length===1&&g.items[0].content_id==='y1'));
});

test('tiles follow the owner order',()=>{assert.deepEqual(tiles(report([]),r28()).map(t=>t.source),['app-store','google-play','website','tiktok','instagram','youtube','facebook','github']);});
test('interaction totals add reported likes, comments and shares only',async()=>{const {interactionsOf}=await import('../web/src/lib/content.ts');
 assert.equal(interactionsOf({likes:3016,comments:35,shares:165}),3216);assert.equal(interactionsOf({likes:11,comments:0,shares:null}),11);assert.equal(interactionsOf({likes:null,comments:null,shares:null}),null);});

test('YouTube tile leads with the channel views snapshot and its change, with subscribers underneath',()=>{
 const snap=(d:number,metric:string,value:number)=>({source:'youtube' as const,metric,date:ago(d),value,unit:'count',timezone:'UTC'});
 const t=tile(report([snap(5,'channel_views_snapshot',1000),snap(0,'channel_views_snapshot',1405),snap(0,'subscribers_snapshot',2),...daily('youtube','views',3,10,0)]),'youtube');
 assert.equal(t.value,1405);assert.equal(t.name,'Channel views');assert.equal(t.change?.kind,'absolute');assert.equal(t.change?.value,405);assert.equal(t.followers,2);});
test('GitHub leads with commits, shows opened pull requests, and keeps per-repository series out of the tabs and the default chart',async()=>{
 const {sourceSeries,metricName}=await import('../web/src/lib/metrics.ts');
 const rep=report([...daily('github','commits',1,28,4),...daily('github','pull_requests',1,28,1),...daily('github','pull_requests_merged',1,28,1),...daily('github','repo_hello_world_commits',1,28,3),...daily('website','page_views',1,20,9)]);
 const t=tile(rep,'github');assert.equal(t.value,112);assert.equal(t.name,'Commits');assert.equal(t.extra,'28 pull requests');assert.equal(t.coverage,'');
 const series=chartSeries(rep,r28());
 assert.deepEqual(sourceSeries(series,'github').map(s=>s.key.split('|')[1]),['commits','pull_requests','pull_requests_merged']);
 assert.equal(series.find(s=>s.key.includes('repo_hello_world_commits'))!.label,'GitHub · Commits · hello-world');
 assert.equal(defaultSeries(series).split('|')[0],'website');assert.equal(metricName('repo_android_app_pull_requests'),'Pull requests · android-app');
});

test('one audience snapshot opens before multi-day GitHub activity; GitHub is a fallback',()=>{
 const rep=report([{source:'youtube',metric:'channel_views_snapshot',date:ago(0),value:10,unit:'count',timezone:'UTC'},...daily('github','commits',1,28,4)]);
 const series=chartSeries(rep,r28());
 assert.equal(defaultSeries(series)?.split('|')[0],'youtube');
 assert.equal(defaultSeries(series.filter(s=>s.key.startsWith('github|')))?.split('|')[0],'github');
 assert.equal(defaultSeries([]),undefined);
});
