import {save,validateImport,type Metric} from './data';
import {SafeError,safeMessage} from './safe-error';
import {parseRepos,repoMetric,type Repo} from './github-repos';

// Commits and pull requests per UTC day across the repositories listed in GITHUB_REPOS, read through the GitHub GraphQL API.
// Both are dated events, so daily counts add up across days and repositories (unlike account snapshots).
// Commits are the ones on each repository's default branch, merge commits included. Pull requests are counted on the day
// they are opened and, separately, on the day they are merged. A repository GitHub cannot read fails the whole sync:
// unavailable data is not zero.
export interface GithubEnv {DB:D1Database; GITHUB_TOKEN?:string; GITHUB_REPOS?:string}
/** One read-only token must be able to read every listed repository. */
export const githubReady=(env:GithubEnv)=>Boolean(env.GITHUB_TOKEN&&env.GITHUB_REPOS?.trim());

export const TIMEZONE='UTC';
export const RECENT_DAYS=14,FULL_DAYS=90;
/** Day aliases per commit request, and pull request pages beyond the first per sync, kept inside the 50 subrequest limit. */
export const MAX_ALIASES=400,MAX_PR_PAGES=10;
const DAY=86400000;
const API='https://api.github.com/graphql';

/** Complete UTC days, oldest first, ending yesterday. Today is incomplete. */
export function windowDays(now:Date,days:number){
 const today=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
 return Array.from({length:days},(_,i)=>new Date(today-(days-i)*DAY).toISOString().slice(0,10));
}
const alias=(day:string)=>'d'+day.replaceAll('-','');
const repoField=(repo:Repo,i:number,body:string)=>`r${i}:repository(owner:${JSON.stringify(repo.owner)},name:${JSON.stringify(repo.name)}){${body}}`;

/** One commit count per day per repository: a totalCount alias for each day of the window. */
export function commitQuery(repos:readonly Repo[],days:string[]){
 const counts=days.map(d=>`${alias(d)}:history(since:"${d}T00:00:00Z",until:"${d}T23:59:59Z"){totalCount}`).join(' ');
 return 'query{'+repos.map((r,i)=>repoField(r,i,`defaultBranchRef{target{...on Commit{${counts}}}}`)).join(' ')+'}';
}
export function parseCommits(data:any,repo:Repo,i:number,days:string[]){
 const found=data?.['r'+i];
 if(!found)throw new SafeError('GitHub did not return '+repo.name+'. Check that the token can read it.');
 // A repository with no commits has no default branch; every day is a real zero.
 if(!found.defaultBranchRef)return days.map(()=>0);
 const target=found.defaultBranchRef.target;if(!target)throw new SafeError('Unexpected GitHub commit response.');
 return days.map(d=>{const n=target[alias(d)]?.totalCount;if(!Number.isSafeInteger(n)||n<0)throw new SafeError('Unexpected GitHub commit count.');return n as number;});
}

const pullFields='pageInfo{hasNextPage endCursor} nodes{createdAt mergedAt updatedAt}';
const pulls=(after?:string)=>`pullRequests(first:100,${after?'after:$after,':''}orderBy:{field:UPDATED_AT,direction:DESC}){${pullFields}}`;
export const pullQuery=(repos:readonly Repo[])=>'query{'+repos.map((r,i)=>repoField(r,i,pulls())).join(' ')+'}';
export const pullPageQuery=(repo:Repo)=>'query($after:String!){'+repoField(repo,0,pulls('$after')).replace(/^r0:/,'r:')+'}';
export interface Pull {createdAt:string; mergedAt:string|null; updatedAt:string}
const isoDate=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
/** Pull requests are listed newest-updated first, so a repository needs another page only while the last one is inside the window. */
export function parsePullPage(found:any,repo:Repo){
 const page=found?.pullRequests;
 if(!page||!Array.isArray(page.nodes)||typeof page.pageInfo?.hasNextPage!=='boolean')throw new SafeError('GitHub did not return pull requests for '+repo.name+'.');
 for(const n of page.nodes)if(!isoDate(n?.createdAt)||!isoDate(n?.updatedAt)||(n.mergedAt!==null&&!isoDate(n.mergedAt)))throw new SafeError('Unexpected GitHub pull request.');
 if(page.pageInfo.hasNextPage&&typeof page.pageInfo.endCursor!=='string')throw new SafeError('Unexpected GitHub pagination.');
 return {nodes:page.nodes as Pull[],more:page.pageInfo.hasNextPage as boolean,cursor:page.pageInfo.endCursor as string|null,last:(page.nodes.at(-1)?.updatedAt??'') as string};
}

export interface RepoActivity {repo:Repo; commits:number[]; opened:number[]; merged:number[]}
export type Post=(owner:string,query:string,variables?:Record<string,string>)=>Promise<any>;
/** Counts per repository and day. `post` sends one GraphQL request as the owner (each owner can use its own token). */
export async function collectActivity(post:Post,repos:readonly Repo[],days:string[]):Promise<RepoActivity[]>{
 const since=days[0]+'T00:00:00Z';const index=new Map(days.map((d,i)=>[d,i]));
 const result=new Map<Repo,RepoActivity>();let extra=0;
 for(const owner of new Set(repos.map(r=>r.owner))){
  const own=repos.filter(r=>r.owner===owner);const perRequest=Math.max(1,Math.floor(MAX_ALIASES/days.length));
  const commits=new Map<Repo,number[]>();
  for(let i=0;i<own.length;i+=perRequest){const chunk=own.slice(i,i+perRequest);const data=await post(owner,commitQuery(chunk,days));chunk.forEach((r,j)=>commits.set(r,parseCommits(data,r,j,days)));}
  const first=await post(owner,pullQuery(own));
  for(const [i,repo] of own.entries()){
   let page=parsePullPage(first?.['r'+i],repo);const all=[...page.nodes];
   while(page.more&&page.last>=since){
    if(++extra>MAX_PR_PAGES)throw new SafeError('Too many pull request pages for one sync.');
    page=parsePullPage((await post(owner,pullPageQuery(repo),{after:page.cursor!}))?.r,repo);all.push(...page.nodes);
   }
   const opened=days.map(()=>0),merged=days.map(()=>0);
   for(const p of all){const o=index.get(p.createdAt.slice(0,10));if(o!==undefined)opened[o]++;const m=p.mergedAt?index.get(p.mergedAt.slice(0,10)):undefined;if(m!==undefined)merged[m]++;}
   result.set(repo,{repo,commits:commits.get(repo)!,opened,merged});
  }
 }
 return repos.map(r=>result.get(r)!);
}

/** Daily totals across all repositories, then each repository's commits and opened pull requests. */
export function activityMetrics(activity:RepoActivity[],days:string[]):Metric[]{
 const row=(date:string,metric:string,value:number,provenance:string):Metric=>({source:'github',date,metric,value,unit:'count',timezone:TIMEZONE,provenance});
 const all='GitHub GraphQL API, '+activity.length+' repositories: default-branch commits and pull requests by UTC day';
 const sum=(pick:(a:RepoActivity)=>number[],i:number)=>activity.reduce((s,a)=>s+pick(a)[i],0);
 return days.flatMap((date,i)=>[
  row(date,'commits',sum(a=>a.commits,i),all),
  row(date,'pull_requests',sum(a=>a.opened,i),all),
  row(date,'pull_requests_merged',sum(a=>a.merged,i),all),
  ...activity.flatMap(a=>{const where='GitHub GraphQL API, '+a.repo.owner+'/'+a.repo.name+' by UTC day';return [row(date,repoMetric(a.repo,'commits'),a.commits[i],where),row(date,repoMetric(a.repo,'pull_requests'),a.opened[i],where)];}),
 ]);
}

async function graphql(token:string,query:string,variables?:Record<string,string>){
 const response=await fetch(API,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','User-Agent':'oss-dashboard'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw new SafeError('GitHub request failed (HTTP '+response.status+').');
 const body=await response.json() as any;
 if(body?.errors?.length||!body?.data)throw new SafeError('GitHub returned an error. Check the token and its access to each repository.');
 return body.data;
}

export async function syncGithub(env:GithubEnv,days=RECENT_DAYS){
 if(!githubReady(env))throw Error('GitHub is not configured.');
 const id=crypto.randomUUID();
 await env.DB.prepare('INSERT INTO sync_runs(id,source,started_at,status) VALUES(?,?,?,?)').bind(id,'github',new Date().toISOString(),'running').run();
 const finish=(status:string,message:string)=>env.DB.prepare('UPDATE sync_runs SET finished_at=?,status=?,message=? WHERE id=?').bind(new Date().toISOString(),status,message,id).run();
 try{
  const window=windowDays(new Date(),days);const repos=parseRepos(env.GITHUB_REPOS);
  const activity=await collectActivity((_owner,query,variables)=>graphql(env.GITHUB_TOKEN!,query,variables),repos,window);
  // D1 executes one batch transaction, so a failed statement rolls back the whole window.
  const rows=validateImport(activityMetrics(activity,window));
  await save(env.DB,rows);
  await finish('success',rows.length+' daily values for '+repos.length+' repositories over '+days+' days synced.');
  return {rows:rows.length};
 }catch(e){await finish('error','GitHub sync failed: '+safeMessage(e));throw e;}
}
