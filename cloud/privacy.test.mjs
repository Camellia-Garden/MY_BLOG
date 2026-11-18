import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import {issueSession} from './admin-session.mjs';
import {initializeState, readState} from './d1-state.mjs';
import {createTestDatabase} from './test-db.mjs';
import {applyMutation} from './mutate-blog.mjs';
import schedule from '../schedule-core.cjs';

const origin='https://privacy.example', secret='privacy-test-secret-abcdefghijklmnopqrstuvwxyz-0123456789';
function req(path,opts){return new Request(origin+path,opts)}
async function setup() {
 const bucket=new Map(), db=createTestDatabase();
 const env={PUBLIC_ORIGIN:origin,ADMIN_GITHUB_ID:'123',SESSION_SECRET:secret,DB:db,ASSETS:{fetch:async()=>new Response('asset')},IMAGES:{async put(key,bytes,opts){bucket.set(key,{bytes,opts})},async get(key){const x=bucket.get(key);return x&&{body:x.bytes,writeHttpMetadata(h){h.set('Content-Type',x.opts.httpMetadata.contentType)}}}}};
 await initializeState(db,{posts:[],moments:[],albums:[],projects:[],activity:{},activityLog:[],settings:{},profile:{}});
 const cookie='__Host-camellia-session='+await issueSession(secret,'123');
 return {env,cookie,bucket};
}
async function save(env,cookie,payload) {
 const read=await worker.fetch(req('/api/data',{headers:{Cookie:cookie}}),env);
 return worker.fetch(req('/api/save',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-Blog-Editor':'1','Content-Type':'application/json','If-Match':read.headers.get('ETag')},body:JSON.stringify(payload)}),env);
}

test('private posts, albums, moments, projects and unpublished uploads stay unavailable to visitors',async()=>{
 const {env,cookie}=await setup(); const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0]);
 const upload=await worker.fetch(req('/api/image',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-Blog-Editor':'1','Content-Type':'image/png'},body:png}),env); const {url}=await upload.json();
 assert.match(url,/^\/private\/images\//); assert.equal((await worker.fetch(req(url),env)).status,404); assert.equal((await worker.fetch(req(url,{headers:{Cookie:cookie}}),env)).status,200);
 const fileResponse=await worker.fetch(req('/api/project-file',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-Blog-Editor':'1','X-File-Name':'secret.zip','Content-Type':'application/octet-stream'},body:'secret bytes'}),env); const file=await fileResponse.json(); assert.equal((await worker.fetch(req(file.url),env)).status,404);
 const items=[{kind:'post',slug:'secret',title:'secret-title',body:`secret-body ![](${url})`,category:'',tags:[],excerpt:'',cover:url,section:'posts',private:true},{kind:'moment',index:-1,text:'secret-moment',tags:[],images:[url],private:true},{kind:'album',index:-1,title:'secret-album',description:'',images:[url],private:true},{kind:'project',index:-1,title:'secret-project',description:'',category:'',url:'',details:'',instructions:'',files:[{name:'secret.zip',url:file.url}],private:true}];
 for (const item of items) assert.equal((await save(env,cookie,item)).status,200);
 const publicResponse=await worker.fetch(req('/blog-data.js'),env), publicText=await publicResponse.text();
 for(const text of ['secret-title','secret-body','secret-moment','secret-album','secret-project','secret.zip',url,file.url]) assert.ok(!publicText.includes(text),text);
 assert.match(publicResponse.headers.get('Cache-Control'),/no-store/); assert.match(publicResponse.headers.get('Vary'),/Cookie/);
 const adminText=await (await worker.fetch(req('/blog-data.js',{headers:{Cookie:cookie}}),env)).text(); assert.match(adminText,/secret-body/); assert.match(adminText,/secret-project/);
 assert.equal((await worker.fetch(req('/api/data'),env)).status,401);
 const state=await readState(env.DB); assert.equal(state.data.activityLog.length,0); assert.deepEqual(state.data.activity,{});
});

test('publishing and privatizing copies assets across access boundaries',async()=>{
 const {env,cookie}=await setup(); const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0]);
 const upload=await worker.fetch(req('/api/image',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-Blog-Editor':'1','Content-Type':'image/png'},body:png}),env); const {url:privateUrl}=await upload.json();
 const post={kind:'post',slug:'switch',title:'title',body:`body ![](${privateUrl})`,category:'',tags:[],excerpt:'',cover:privateUrl,section:'posts',private:false};
 assert.equal((await save(env,cookie,post)).status,200);
 let state=await readState(env.DB); const publicUrl=state.data.posts[0].cover; assert.match(publicUrl,/^\/public\/images\//); assert.equal((await worker.fetch(req(publicUrl),env)).status,200); assert.equal((await worker.fetch(req(privateUrl),env)).status,404);
 assert.equal((await save(env,cookie,{...post,cover:publicUrl,body:`body ![](${publicUrl})`,private:true})).status,200);
 state=await readState(env.DB); const next=state.data.posts[0]; assert.match(next.cover,/^\/private\/images\//); assert.ok(next.body.includes(next.cover)); assert.equal((await worker.fetch(req(next.cover),env)).status,404); assert.equal((await worker.fetch(req(next.cover,{headers:{Cookie:cookie}}),env)).status,200);
 assert.equal((await worker.fetch(req(publicUrl),env)).status,404);
 const visible=await (await worker.fetch(req('/blog-data.js'),env)).text(); assert.ok(!visible.includes('switch')); assert.ok(state.data.activityLog.every(e=>e.privacyHidden)); assert.ok(Object.values(state.data.activity).every(n=>n===0));
});

test('a public copy created before a failed save is not accessible to visitors',async()=>{
 const {env,cookie,bucket}=await setup(); const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0]);
 const upload=await worker.fetch(req('/api/image',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-Blog-Editor':'1','Content-Type':'image/png'},body:png}),env); const {url}=await upload.json();
 env.DB.batch=async()=>{throw Error('simulated conflicting write')};
 const post={kind:'post',slug:'failed-save',title:'title',body:'body',category:'',tags:[],excerpt:'',cover:url,section:'posts',private:false};
 assert.equal((await save(env,cookie,post)).status,400);
 const orphan=[...bucket.keys()].find(key=>key.startsWith('public/images/')); assert.ok(orphan);
 assert.equal((await worker.fetch(req('/'+orphan),env)).status,404);
});

test('refuses to privatize a public file still referenced by other public content',async()=>{
 const {env,cookie}=await setup(); const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0]);
 const upload=await worker.fetch(req('/api/image',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-Blog-Editor':'1','Content-Type':'image/png'},body:png}),env); const {url}=await upload.json();
 const first={kind:'post',slug:'one',title:'one',body:'body',category:'',tags:[],excerpt:'',cover:url,section:'posts',private:false};
 assert.equal((await save(env,cookie,first)).status,200);
 const existing=(await readState(env.DB)).data.posts[0].cover;
 const second={...first,slug:'two',title:'two',cover:existing}; assert.equal((await save(env,cookie,second)).status,200);
 const result=await save(env,cookie,{...first,cover:existing,private:true});
 assert.equal(result.status,400); assert.match((await result.json()).error,/其他公开内容使用/);
 assert.equal((await worker.fetch(req(existing),env)).status,200);
});

test('privatizing a legacy public asset blocks its old path without deleting it',async()=>{
 const {env,cookie,bucket}=await setup(); const path='/personal/uploads/11111111-1111-1111-1111-111111111111.png';
 await env.IMAGES.put(path.slice(1),Uint8Array.from([137,80,78,71,13,10,26,10]),{httpMetadata:{contentType:'image/png'}});
 const post={kind:'post',slug:'legacy',title:'legacy',body:'body',category:'',tags:[],excerpt:'',cover:path,section:'posts',private:false};
 assert.equal((await save(env,cookie,post)).status,200); assert.equal((await worker.fetch(req(path),env)).status,200);
 assert.equal((await save(env,cookie,{...post,private:true})).status,200);
 assert.equal((await worker.fetch(req(path),env)).status,404); assert.equal((await worker.fetch(req(path,{headers:{Cookie:cookie}}),env)).status,200);
 assert.ok(bucket.has(path.slice(1))); const visible=await (await worker.fetch(req('/blog-data.js'),env)).text(); assert.ok(!visible.includes(path));
});

test('old clients cannot silently publish private content, and private deletion leaves no public history',()=>{
 const base={posts:[],moments:[],albums:[],projects:[],activity:{},activityLog:[]}; const payload={kind:'post',slug:'hidden',title:'hidden',body:'body',category:'',tags:[],excerpt:'',cover:'',section:'posts',private:true};
 let data=applyMutation(base,payload); const {private:ignored,...oldPayload}=payload; data=applyMutation(data,oldPayload); assert.equal(data.posts[0].private,true); assert.deepEqual(data.activityLog,[]);
 data=applyMutation(data,{kind:'delete-post',slug:'hidden'}); assert.deepEqual(data.activityLog,[]);
});

test('hides matched historic contributions while private and restores them when public again',()=>{
 const base={posts:[],moments:[],albums:[],projects:[],activity:{},activityLog:[]};
 const post={kind:'post',slug:'history',title:'标题',body:'正文',category:'',tags:[],excerpt:'',cover:'',section:'posts',private:false};
 let data=applyMutation(base,post); const day=Object.keys(data.activity)[0]; assert.equal(data.activity[day],1);
 data=applyMutation(data,{...post,private:true}); assert.equal(data.activity[day],0); assert.equal(data.activityLog[0].privacyHidden,true);
 data=applyMutation(data,{...post,private:true,body:'私密修改'}); assert.equal(data.activity[day],0); assert.equal(data.activityLog.length,1);
 data=applyMutation(data,{...post,private:false}); assert.equal(data.activity[day],2); assert.equal(data.activityLog.length,2); assert.ok(data.activityLog.every(e=>!e.privacyHidden));
});

test('private legacy moments hide unidentified matching history',async()=>{
 const {env,cookie}=await setup();
 const initial={posts:[],albums:[],projects:[],settings:{},profile:{},moments:[{text:'旧私密动态',date:'2026-11-01',images:[],tags:[]}],activity:{'2026-11-01':1},activityLog:[{type:'moment',action:'create',title:'旧私密动态',at:'2026-11-01 12:00'}]};
 const db=createTestDatabase(); await initializeState(db,initial); env.DB=db;
 assert.equal((await save(env,cookie,{kind:'moment',index:0,text:'旧私密动态',tags:[],images:[],private:true})).status,200);
 const publicText=await (await worker.fetch(req('/blog-data.js'),env)).text(); assert.ok(!publicText.includes('旧私密动态'));
 const state=await readState(env.DB); assert.equal(state.data.activity['2026-11-01'],0); assert.equal(state.data.activityLog[0].privacyHidden,true);
});

 test('scheduled content and assets stay hidden until publication, including private content',async()=>{
 const {env,cookie}=await setup(); const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0]);
 const upload=await worker.fetch(req('/api/image',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-Blog-Editor':'1','Content-Type':'image/png'},body:png}),env); const {url}=await upload.json();
 const scheduledAt=new Date(Date.now()+2500).toISOString();
 const items=[{kind:'post',slug:'scheduled',title:'scheduled-post',body:'body',category:'',tags:[],excerpt:'',cover:url,section:'posts'}, {kind:'moment',index:-1,text:'scheduled-moment',tags:[],images:[]}, {kind:'album',index:-1,title:'scheduled-album',description:'',images:[]}, {kind:'project',index:-1,title:'scheduled-project',description:'',category:'',url:'',details:'',instructions:'',files:[]}, {kind:'post',slug:'scheduled-private',title:'scheduled-private',body:'body',category:'',tags:[],excerpt:'',cover:'',section:'posts',private:true}];
 for(const item of items) { const res=await save(env,cookie,{...item,scheduledAt}); assert.equal(res.status,200,JSON.stringify(await res.json())); }
 const state=await readState(env.DB), path=state.data.posts.find(p=>p.slug==='scheduled').cover;
 let text=await (await worker.fetch(req('/blog-data.js'),env)).text(); assert.doesNotMatch(text,/scheduled-post|scheduled-moment|scheduled-album|scheduled-project|scheduled-private/); assert.equal((await worker.fetch(req(path),env)).status,404);
 assert.deepEqual(state.data.activity,{}); assert.equal(state.data.activityLog.length,0);
 await new Promise(resolve=>setTimeout(resolve,2700));
 text=await (await worker.fetch(req('/blog-data.js'),env)).text(); for(const name of ['scheduled-post','scheduled-moment','scheduled-album','scheduled-project']) assert.ok(text.includes(name)); assert.ok(!text.includes('scheduled-private'));
 assert.equal((await worker.fetch(req(path),env)).status,200);
 const admin=await (await worker.fetch(req('/api/data',{headers:{Cookie:cookie}}),env)).json(); assert.equal(admin.activityLog.length,4); assert.equal(Object.values(admin.activity).reduce((a,b)=>a+b,0),4);
 assert.equal((await save(env,cookie,{kind:'home',title:'x',description:'y'})).status,200);
 const saved=await readState(env.DB); assert.equal(saved.data.activityLog.length,4); assert.equal(Object.values(saved.data.activity).reduce((a,b)=>a+b,0),4);
 });

test('schedule boundaries and already public content are validated on the server',()=>{
 const blank={posts:[],moments:[],albums:[],projects:[],activity:{},activityLog:[]}; const post={kind:'post',slug:'time-test',title:'title',body:'body',category:'',tags:[],excerpt:'',cover:'',section:'posts'};
 for (const t of [new Date(Date.now()-1000).toISOString(),new Date(Date.now()+8*86400000).toISOString(),'garbage']) assert.throws(()=>applyMutation(blank,{...post,scheduledAt:t}));
 const publicState=applyMutation(blank,post); assert.throws(()=>applyMutation(publicState,{...post,scheduledAt:new Date(Date.now()+60000).toISOString()}),/已发布/);
 const pending=applyMutation(blank,{...post,scheduledAt:new Date(Date.now()+60000).toISOString()}); const immediate=applyMutation(pending,{...post,scheduledAt:''}); assert.equal(immediate.activityLog.length,1); assert.equal(immediate.activityLog[0].action,'create');
});

 test('scheduled album and project history follows later privacy changes',()=>{
 const blank={posts:[],moments:[],albums:[],projects:[],activity:{},activityLog:[]}; const when=new Date(Date.now()+60000).toISOString();
 const album={kind:'album',index:-1,title:'album',description:'',images:[],scheduledAt:when}; const project={kind:'project',index:-1,title:'project',description:'',category:'',url:'',details:'',instructions:'',files:[],scheduledAt:when};
 let pending=applyMutation(blank,album); pending=applyMutation(pending,project);
 const {materializeDue}=schedule; const published=materializeDue(structuredClone(pending),Date.parse(when)); assert.equal(published.activityLog.length,2);
 let hidden=applyMutation(published,{...album,index:0,private:true,scheduledAt:''}); hidden=applyMutation(hidden,{...project,index:0,private:true,scheduledAt:''});
 assert.ok(hidden.activityLog.every(x=>x.privacyHidden)); assert.equal(Object.values(hidden.activity).reduce((a,b)=>a+b,0),0);
 });
