// Repositories counted in the GitHub activity tile. Shared by the Worker and the browser app, so it has no Worker types.
// The list comes from the GITHUB_REPOS setting: comma-separated owner/name pairs, for example
// "octocat/hello-world,my-org/website". List each repository once; counting a fork and its parent counts commits twice.
export interface Repo {owner:string; name:string}
const NAME=/^[A-Za-z0-9_.-]{1,100}$/;
/** Parses GITHUB_REPOS. Invalid or duplicate entries are rejected so a typo fails loudly instead of reading as zero. */
export function parseRepos(value?:string):Repo[]{
 const repos:Repo[]=[];
 for(const raw of (value??'').split(',').map(s=>s.trim()).filter(Boolean)){
  const [owner,name,...rest]=raw.split('/');
  if(rest.length||!owner||!name||!NAME.test(owner)||!NAME.test(name))throw Error('GITHUB_REPOS entries must look like owner/name.');
  if(repos.some(r=>repoSlug(r.name)===repoSlug(name)))throw Error('GITHUB_REPOS lists two repositories with the same name.');
  repos.push({owner,name});
 }
 return repos;
}
/** Metric names allow only a-z, 0-9 and underscores, so repository names are reduced to a slug. */
export const repoSlug=(name:string)=>name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
export const repoMetric=(repo:Repo,kind:'commits'|'pull_requests')=>'repo_'+repoSlug(repo.name)+'_'+kind;
/** Reads a per-repository metric name back into a display name and kind. The slug loses punctuation, so the name
    uses hyphens: "repo_hello_world_commits" reads as hello-world. */
export function parseRepoMetric(metric:string){
 const m=/^repo_([a-z0-9_]+)_(commits|pull_requests)$/.exec(metric);if(!m)return undefined;
 return {name:m[1].replaceAll('_','-'),kind:m[2] as 'commits'|'pull_requests'};
}
