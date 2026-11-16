/** Errors whose message is written by this codebase and is safe to store in sync history (no provider bodies or secrets). */
export class SafeError extends Error {}
const platform=[/^Too many subrequests/i,/^Worker exceeded/i,/^The operation was aborted due to timeout/i,/^Network connection lost/i];
export function safeMessage(e:unknown){
 if(e instanceof SafeError)return e.message.slice(0,240);
 if(e instanceof Error&&platform.some(p=>p.test(e.message)))return e.message.slice(0,120);
 if(e instanceof Error&&e.name==='TimeoutError')return 'A provider request timed out.';
 return 'unexpected error ('+(e instanceof Error?e.name:'unknown')+').';
}
