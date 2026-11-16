#!/usr/bin/env node
// Runs the dashboard on your own machine or server, without a Cloudflare account.
//
// It uses workerd (the open-source Workers runtime, via `wrangler dev`) with a local SQLite-backed D1 database,
// and a small built-in scheduler that fires the same cron jobs Cloudflare would.
//
//   npm run selfhost                 http://localhost:8787, data in ./data
//   PORT=9000 DATA_DIR=/srv/dash HOST=0.0.0.0 npm run selfhost
//
// Settings come from .dev.vars, or from environment variables with the names in .env.example (Docker uses this).
// A missing TOKEN_ENCRYPTION_KEY is generated once and saved in DATA_DIR, so it survives restarts.
import {existsSync,mkdirSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {knownSettings,parseEnvFile,newEncryptionKey,toEnvFile} from './env.mjs';

const PORT=Number(process.env.PORT||8787);
const HOST=process.env.HOST||'127.0.0.1';
const DATA=resolve(process.env.DATA_DIR||'data');
const CONFIG='wrangler.local.json';
mkdirSync(DATA,{recursive:true});

// 1. Settings: .dev.vars wins, then the process environment. Write the merged result back for workerd.
const fromFile=parseEnvFile('.dev.vars');
const fromEnv=Object.fromEntries(knownSettings().filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const settings={...fromEnv,...fromFile};
const keyFile=join(DATA,'token-encryption-key');
if(!settings.TOKEN_ENCRYPTION_KEY){
 if(!existsSync(keyFile)){writeFileSync(keyFile,newEncryptionKey()+'\n',{mode:0o600});console.log('Generated TOKEN_ENCRYPTION_KEY in '+keyFile+'. Back it up with your data.');}
 settings.TOKEN_ENCRYPTION_KEY=readFileSync(keyFile,'utf8').trim();
}
const varsFile=join(DATA,'.dev.vars');
writeFileSync(varsFile,toEnvFile(settings),{mode:0o600});chmodSync(varsFile,0o600);

// 2. Web build and database migrations.
const run=(cmd,args)=>execFileSync(cmd,args,{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
if(!existsSync('public/app/index.html'))run('npx',['vite','build']);
run('npx',['wrangler','d1','migrations','apply','oss-dashboard-local','--local','--config',CONFIG,'--persist-to',DATA]);

// 3. The Worker.
const worker=spawn('npx',['wrangler','dev','--config',CONFIG,'--ip',HOST,'--port',String(PORT),'--persist-to',DATA,'--env-file',varsFile,'--test-scheduled','--show-interactive-dev-session=false'],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
const stop=()=>{worker.kill('SIGTERM');process.exit(0);};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
worker.on('exit',code=>process.exit(code??1));

// 4. Scheduler: the same triggers as wrangler.jsonc, fired through workerd's local /__scheduled endpoint.
const crons=JSON.parse(readFileSync(CONFIG,'utf8')).triggers.crons;
const due=(cron,d)=>{
 const [min,hour]=cron.split(' ');
 const match=(field,value)=>field==='*'||(field.startsWith('*/')?value%Number(field.slice(2))===0:Number(field)===value);
 return match(min,d.getUTCMinutes())&&match(hour,d.getUTCHours());
};
let last='';
setInterval(async()=>{
 const now=new Date();const minute=now.toISOString().slice(0,16);if(minute===last)return;last=minute;
 for(const cron of crons)if(due(cron,now)){
  try{const r=await fetch('http://127.0.0.1:'+PORT+'/__scheduled?cron='+encodeURIComponent(cron));console.log('[scheduler] '+minute+' '+cron+' → '+r.status);}
  catch(e){console.error('[scheduler] '+cron+' failed: '+e.message);}
 }
},15000);
console.log('\nDashboard: http://'+(HOST==='0.0.0.0'?'localhost':HOST)+':'+PORT+'  (no built-in sign-in; keep it on a private network or behind an authenticating proxy)\n');
