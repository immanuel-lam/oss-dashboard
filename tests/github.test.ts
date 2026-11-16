import {test} from 'node:test';import assert from 'node:assert/strict';
import {MAX_PR_PAGES,activityMetrics,collectActivity,commitQuery,parseCommits,pullPageQuery,windowDays,type Post} from '../src/github.ts';
import {parseRepos,parseRepoMetric,repoMetric,repoSlug} from '../src/github-repos.ts';
const REPOS=parseRepos('octocat/hello-world,example-org/site.example.com,example-org/android-app');
import {validateImport} from '../src/data.ts';

const A={owner:'octocat',name:'hello-world'},B={owner:'example-org',name:'android-app'};
const NOW=new Date('2026-11-01T13:00:00Z');

test('the window is complete UTC days ending yesterday, oldest first',()=>{
 assert.deepEqual(windowDays(NOW,3),['2026-10-29','2026-10-30','2026-10-31']);
 assert.equal(windowDays(NOW,90).length,90);assert.equal(windowDays(NOW,90)[0],'2026-08-03');
});
test('repository metrics are valid metric names and read back to their repository',()=>{
 assert.equal(repoSlug('site.example.com'),'site_example_com');
 for(const repo of REPOS)for(const kind of ['commits','pull_requests'] as const){
  const metric=repoMetric(repo,kind);assert.match(metric,/^[a-z][a-z0-9_]{0,63}$/);assert.deepEqual(parseRepoMetric(metric),{name:repoSlug(repo.name).replaceAll('_','-'),kind});
 }
 assert.deepEqual(parseRepoMetric('repo_unknown_commits'),{name:'unknown',kind:'commits'});assert.equal(parseRepoMetric('repo__x'),undefined);assert.equal(parseRepoMetric('commits'),undefined);
 assert.equal(new Set(REPOS.map(r=>repoSlug(r.name))).size,REPOS.length);
});
test('commit queries ask for one count per repository and day',()=>{
 const q=commitQuery([A,B],['2026-10-30','2026-10-31']);
 assert.equal(q.match(/history\(/g)!.length,4);assert.match(q,/r1:repository\(owner:"example-org",name:"android-app"\)/);
 assert.match(q,/d20261031:history\(since:"2026-10-31T00:00:00Z",until:"2026-10-31T23:59:59Z"\)/);
 assert.match(pullPageQuery(A),/^query\(\$after:String!\)\{r:repository\(/);
});
test('commit counts are read per day; a repository without commits is a real zero',()=>{
 const days=['2026-10-30','2026-10-31'];
 assert.deepEqual(parseCommits({r0:{defaultBranchRef:{target:{d20261030:{totalCount:3},d20261031:{totalCount:0}}}}},A,0,days),[3,0]);
 assert.deepEqual(parseCommits({r0:{defaultBranchRef:null}},A,0,days),[0,0]);
});
test('a repository GitHub cannot read or an odd count rejects the report',()=>{
 const days=['2026-10-31'];
 assert.throws(()=>parseCommits({r0:null},A,0,days),/did not return hello-world/);
 assert.throws(()=>parseCommits({r0:{defaultBranchRef:{target:{d20261031:{totalCount:-1}}}}},A,0,days),/Unexpected GitHub commit count/);
 assert.throws(()=>parseCommits({r0:{defaultBranchRef:{target:{d20261031:{}}}}},A,0,days),/Unexpected GitHub commit count/);
});

const pr=(createdAt:string,mergedAt:string|null,updatedAt=mergedAt??createdAt)=>({createdAt,mergedAt,updatedAt});
const page=(nodes:ReturnType<typeof pr>[],more=false)=>({pullRequests:{nodes,pageInfo:{hasNextPage:more,endCursor:more?'c1':null}}});
const days=windowDays(NOW,3);
/** Fake GitHub: answers commit and pull request queries from fixtures, and records every request. */
function fake(opts:{pulls:Record<string,any>;commits?:Record<string,number[]>;more?:any[]}){
 const calls:{owner:string;query:string;variables?:any}[]=[];
 const post:Post=async(owner,query,variables)=>{calls.push({owner,query,variables});
  if(variables?.after)return {r:opts.more!.shift()};
  const asked=[...query.matchAll(/r(\d+):repository\(owner:"([^"]+)",name:"([^"]+)"\)/g)].map(m=>({alias:'r'+m[1],name:m[3]}));const out:any={};
  for(const {alias,name} of asked){
   if(query.includes('history(')){const counts=opts.commits?.[name]??days.map(()=>0);out[alias]={defaultBranchRef:{target:Object.fromEntries(days.map((d,j)=>['d'+d.replaceAll('-',''),{totalCount:counts[j]}]))}};}
   else out[alias]=opts.pulls[name]??page([]);
  }
  return out;};
 return {post,calls};
}
test('commits and pull requests are counted on the day they happen, per owner',async()=>{
 const {post,calls}=fake({commits:{'hello-world':[2,0,5],'android-app':[1,1,1]},pulls:{
  'hello-world':page([pr('2026-10-31T01:00:00Z','2026-10-31T23:00:00Z'),pr('2026-10-30T20:00:00Z',null),pr('2026-09-01T00:00:00Z','2026-10-29T10:00:00Z')]),
  'android-app':page([pr('2026-10-31T05:00:00Z',null)])}});
 const [be,android]=(await collectActivity(post,[A,B],days));
 assert.deepEqual(be.commits,[2,0,5]);assert.deepEqual(be.opened,[0,1,1]);assert.deepEqual(be.merged,[1,0,1]);assert.deepEqual(android.opened,[0,0,1]);
 assert.deepEqual([...new Set(calls.map(c=>c.owner))],['octocat','example-org']);
});
test('pull request pages continue while they still reach into the window',async()=>{
 const inWindow=page([pr('2026-10-30T00:00:00Z',null)],true),older=page([pr('2026-07-01T00:00:00Z','2026-07-02T00:00:00Z')]);
 const {post,calls}=fake({pulls:{'hello-world':inWindow},more:[older]});
 const [be]=await collectActivity(post,[A],days);
 assert.equal(calls.filter(c=>c.variables?.after==='c1').length,1);assert.deepEqual(be.opened,[0,1,0]);
 // A first page whose last pull request is already older than the window needs no second request.
 const stale=fake({pulls:{'hello-world':{pullRequests:{nodes:[pr('2026-07-01T00:00:00Z',null)],pageInfo:{hasNextPage:true,endCursor:'c1'}}}}});
 await collectActivity(stale.post,[A],days);assert.equal(stale.calls.filter(c=>c.variables?.after).length,0);
});
test('a sync that would need too many pull request pages is rejected, not stored partly',async()=>{
 const busy=()=>page([pr('2026-10-30T00:00:00Z',null)],true);
 const {post}=fake({pulls:{'hello-world':busy()},more:Array.from({length:MAX_PR_PAGES+1},busy)});
 await assert.rejects(()=>collectActivity(post,[A],days),/Too many pull request pages/);
 await assert.rejects(()=>collectActivity(async()=>({r0:null}),[A],days),/did not return/);
});
test('metrics hold daily totals plus each repository, with zero days kept',async()=>{
 const {post}=fake({commits:{'hello-world':[2,0,5],'android-app':[1,1,1]},pulls:{'hello-world':page([pr('2026-10-31T01:00:00Z',null)])}});
 const rows=validateImport(activityMetrics(await collectActivity(post,[A,B],days),days));
 const get=(date:string,metric:string)=>rows.find(r=>r.date===date&&r.metric===metric)!;
 assert.equal(get('2026-10-31','commits').value,6);assert.equal(get('2026-10-30','commits').value,1);assert.equal(get('2026-10-31','pull_requests').value,1);
 assert.equal(get('2026-10-30','repo_hello_world_commits').value,0);assert.equal(get('2026-10-31','repo_android_app_commits').value,1);
 assert.equal(rows.length,days.length*(3+2*2));
 for(const r of rows){assert.equal(r.source,'github');assert.equal(r.unit,'count');assert.equal(r.timezone,'UTC');}
 // The 90-day report stays inside the 5000-row import limit with every repository.
 assert.ok(90*(3+2*REPOS.length)<=5000);
});

test('a full GitHub window uses one transaction and reports a failed write',async()=>{
 const {syncGithub}=await import('../src/github.ts');
 const original=globalThis.fetch;const batches:number[]=[];const statuses:unknown[]=[];
 const db={prepare:(sql:string)=>({bind:(...args:unknown[])=>({run:async()=>{if(sql.startsWith('UPDATE sync_runs'))statuses.push(args[1]);return {};}})}),batch:async(statements:unknown[])=>{batches.push(statements.length);throw Error('Injected database failure');}};
 globalThis.fetch=(async(_url:unknown,init:RequestInit)=>{
  const query=JSON.parse(init.body as string).query;const data:Record<string,unknown>={};
  for(const m of query.matchAll(/(r\d+):repository/g)){
   data[m[1]]=query.includes('history(')?{defaultBranchRef:{target:Object.fromEntries([...query.matchAll(/(d\d{8}):history/g)].map((d:RegExpMatchArray)=>[d[1],{totalCount:0}]))}}:page([]);
  }
  return Response.json({data});
 }) as typeof fetch;
 try{await assert.rejects(()=>syncGithub({DB:db as any,GITHUB_TOKEN:'test-token',GITHUB_REPOS:'octocat/hello-world'},90),/Injected database failure/);
  assert.deepEqual(batches,[90*(3+2*1)]);assert.deepEqual(statuses,['error']);
 }finally{globalThis.fetch=original;}
});

test('GITHUB_REPOS parsing rejects malformed and duplicate entries',()=>{
 assert.deepEqual(parseRepos(''),[]);assert.deepEqual(parseRepos(' a/b , c/d '),[{owner:'a',name:'b'},{owner:'c',name:'d'}]);
 assert.throws(()=>parseRepos('justaname'),/owner\/name/);assert.throws(()=>parseRepos('a/b/c'),/owner\/name/);assert.throws(()=>parseRepos('a/b,c/B'),/same name/);
});
