#!/usr/bin/env node
// One-command Cloudflare deployment.
//
//   npm run setup:cloudflare                         first deploy on <name>.<account>.workers.dev
//   npm run setup:cloudflare -- --domain dash.example.com
//   npm run setup:cloudflare -- --secrets .env.production
//   npm run deploy                                   later deploys (verifies, then reuses wrangler.production.json)
//
// It is safe to re-run: it reuses the D1 database, never replaces TOKEN_ENCRYPTION_KEY and only uploads the
// secrets you pass. It prints secret names, never values.
import {readFileSync,writeFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {knownSettings,parseEnvFile,newEncryptionKey} from './env.mjs';

const args=process.argv.slice(2);
const flag=(name)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const deployOnly=args.includes('--deploy-only');
const domain=flag('--domain')??process.env.DASHBOARD_DOMAIN;
const secretsFile=flag('--secrets');
const PROD='wrangler.production.json';

const wrangler=(cmdArgs,opts={})=>execFileSync('npx',['wrangler',...cmdArgs],{encoding:'utf8',stdio:opts.input!==undefined?['pipe','pipe','inherit']:opts.inherit?'inherit':['ignore','pipe','inherit'],input:opts.input,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
const step=(m)=>console.log('\n▸ '+m);

if(deployOnly){
 if(!existsSync(PROD)){console.error(PROD+' is missing. Run `npm run setup:cloudflare` first.');process.exit(1);}
 step('Deploying');wrangler(['deploy','--config',PROD],{inherit:true});
 step('Applying database migrations');wrangler(['d1','migrations','apply','oss-dashboard','--remote','--config',PROD],{inherit:true});
 process.exit(0);
}

step('Checking Cloudflare login');
try{wrangler(['whoami']);}catch{console.error('Not logged in. Run `npx wrangler login`, then re-run this command.');process.exit(1);}

const base=JSON.parse(readFileSync('wrangler.jsonc','utf8').replace(/^\s*\/\/.*$/gm,''));
const dbName=base.d1_databases[0].database_name;

step('Finding or creating the D1 database "'+dbName+'"');
const find=()=>JSON.parse(wrangler(['d1','list','--json'])).find(d=>d.name===dbName);
let db=find();
if(!db){wrangler(['d1','create',dbName],{inherit:true});db=find();}
if(!db?.uuid){console.error('Could not read the database ID. Check `npx wrangler d1 list`.');process.exit(1);}

const config={...base,d1_databases:[{...base.d1_databases[0],database_id:db.uuid}]};
if(domain){
 if(!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)){console.error('--domain must be a host name such as dash.example.com');process.exit(1);}
 config.routes=[{pattern:domain,custom_domain:true}];config.workers_dev=false;config.preview_urls=false;
}else{config.workers_dev=true;config.preview_urls=false;}
writeFileSync(PROD,JSON.stringify(config,null,2)+'\n');
console.log('Wrote '+PROD+' (git-ignored).');

step('Building the web app');execFileSync('npx',['vite','build'],{stdio:'inherit'});
step('Applying database migrations');wrangler(['d1','migrations','apply',dbName,'--remote','--config',PROD],{inherit:true});
step('Deploying the Worker');wrangler(['deploy','--config',PROD],{inherit:true});

step('Checking secrets');
let existing=new Set();
try{existing=new Set(JSON.parse(wrangler(['secret','list','--config',PROD])).map(s=>s.name));}catch{console.error('Could not list Worker secrets.');process.exit(1);}
const upload={};
if(secretsFile){
 const known=new Set(knownSettings());const values=parseEnvFile(secretsFile);
 for(const [k,v] of Object.entries(values)){if(!known.has(k)){console.warn('Skipping unknown setting '+k);continue;}upload[k]=v;}
 if(existing.has('TOKEN_ENCRYPTION_KEY')&&upload.TOKEN_ENCRYPTION_KEY){console.warn('TOKEN_ENCRYPTION_KEY already exists; keeping the current key so connected accounts keep working.');delete upload.TOKEN_ENCRYPTION_KEY;}
}
if(!existing.has('TOKEN_ENCRYPTION_KEY')&&!upload.TOKEN_ENCRYPTION_KEY)upload.TOKEN_ENCRYPTION_KEY=newEncryptionKey();
if(Object.keys(upload).length){
 const dir=mkdtempSync(join(tmpdir(),'oss-dashboard-'));const file=join(dir,'secrets.json');
 try{writeFileSync(file,JSON.stringify(upload),{mode:0o600});wrangler(['secret','bulk',file,'--config',PROD],{inherit:true});}
 finally{rmSync(dir,{recursive:true,force:true});}
 console.log('Uploaded: '+Object.keys(upload).join(', '));
}else console.log('No secret changes.');

const where=domain?'https://'+domain:'your workers.dev URL (printed by the deploy step above)';
console.log(`
Done. Open ${where}.

⚠  This dashboard has NO built-in sign-in. Anyone with the URL can read your analytics, import data and
   connect or disconnect accounts. Put Cloudflare Access in front of it now (free for up to 50 users):

   • workers.dev: Workers & Pages → oss-dashboard → Settings → Domains & Routes → workers.dev → Enable Cloudflare Access
   • Custom domain: Zero Trust → Access → Applications → Add → Self-hosted → ${domain??'your domain'}
     Policy: Allow → Emails → your address. Login method: One-time PIN or Google.

   See README.md → "Protect it".`);
