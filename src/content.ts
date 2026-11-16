import {accessToken,type OAuthEnv} from './oauth';
export async function syncContent(env:OAuthEnv,source:'instagram'|'tiktok'){
 const token=await accessToken(env,source);const date=new Date().toISOString().slice(0,10);let cursor:number|undefined;let next:string|undefined;let count=0;
 for(let page=0;page<25;page++){
 let url:string;let init:RequestInit={headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(25000)};
 if(source==='tiktok'){url='https://open.tiktokapis.com/v2/video/list/?fields=id,title,share_url,create_time,view_count,like_count,comment_count,share_count';init={...init,method:'POST',headers:{...init.headers,'Content-Type':'application/json'},body:JSON.stringify({max_count:20,...(cursor?{cursor}:{})})};}
 else url=next??'https://graph.instagram.com/v25.0/me/media?fields=id,caption,permalink,timestamp,like_count,comments_count&limit=100';
 const parsed=new URL(url);if(source==='instagram'&&parsed.origin!=='https://graph.instagram.com')throw Error('Unexpected pagination URL.');
 const response=await fetch(url,init);if(!response.ok)throw Error('Content permission unavailable.');const body:any=await response.json();if(body.error?.code&&body.error.code!=='ok')throw Error('Content permission unavailable.');const items=source==='tiktok'?body.data?.videos:body.data;if(!Array.isArray(items))throw Error('Unexpected content schema.');
 for(const item of items){const title=String(source==='tiktok'?item.title??'Untitled video':item.caption??'Instagram post').slice(0,1000);const link=String(source==='tiktok'?item.share_url:item.permalink);const u=new URL(link);if(u.protocol!=='https:'||!(source==='tiktok'?['www.tiktok.com','tiktok.com']:['www.instagram.com','instagram.com']).includes(u.hostname))throw Error('Unexpected content URL.');const val=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
 await env.DB.prepare('INSERT INTO content_snapshots(source,content_id,observed_date,title,url,published_at,views,likes,comments,shares) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,content_id,observed_date) DO UPDATE SET title=excluded.title,url=excluded.url,views=excluded.views,likes=excluded.likes,comments=excluded.comments,shares=excluded.shares').bind(source,String(item.id),date,title,link,source==='tiktok'?new Date(item.create_time*1000).toISOString():String(item.timestamp??''),source==='tiktok'?val(item.view_count):null,val(source==='tiktok'?item.like_count:item.like_count),val(source==='tiktok'?item.comment_count:item.comments_count),source==='tiktok'?val(item.share_count):null).run();count++;}
 if(source==='tiktok'){if(!body.data.has_more)return count;cursor=body.data.cursor;}else{next=body.paging?.next;if(!next)return count;}
 }throw Error('Content pagination limit reached.');
}
