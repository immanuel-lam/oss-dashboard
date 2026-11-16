// Shared helpers for the setup and self-host scripts. Plain Node, no dependencies.
import {readFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';

/** Setting names the Worker understands, read from .env.example so there is one list to maintain. */
export function knownSettings(){
 return readFileSync(new URL('../.env.example',import.meta.url),'utf8').split('\n').map(l=>/^([A-Z][A-Z0-9_]*)=/.exec(l)?.[1]).filter(Boolean);
}
/** Minimal dotenv parser: KEY=value, optional quotes, # comments. Multi-line values must use \n escapes in quotes. */
export function parseEnvFile(path){
 if(!existsSync(path))return {};
 const out={};
 for(const line of readFileSync(path,'utf8').split('\n')){
  const m=/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);if(!m)continue;
  let v=m[2];
  if(/^".*"$/.test(v))v=JSON.parse(v);else if(/^'.*'$/.test(v))v=v.slice(1,-1);else v=v.replace(/\s+#.*$/,'');
  if(v!=='')out[m[1]]=v;
 }
 return out;
}
export const newEncryptionKey=()=>randomBytes(32).toString('base64');
/** Serialises settings for .dev.vars, quoting values so newlines in private keys survive. */
export const toEnvFile=(values)=>Object.entries(values).map(([k,v])=>k+'='+JSON.stringify(String(v))).join('\n')+'\n';
