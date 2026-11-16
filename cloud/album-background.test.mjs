import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Run the editor handlers with controlled uploads and saves, never real user data.
function harness() {
  const source = readFileSync(new URL('../editor.js',import.meta.url),'utf8');
  const start = source.indexOf('  let albumUploadPromise = null');
  const end = source.indexOf('  let albumPhotoIndex',start);
  const saveStart = source.indexOf("  albums.addEventListener('submit'");
  const saveEnd = source.indexOf("  projects.addEventListener('submit'",saveStart);
  assert.ok(start >= 0 && end > start && saveStart >= 0 && saveEnd > saveStart);
  function node() { return {hidden:false,disabled:false,textContent:'',children:[],listeners:{},addEventListener(name,fn){this.listeners[name]=fn},replaceChildren(){this.children=[]},append(child){this.children.push(child)}}; }
  const ids={}; for (const id of ['album-retry-failed','album-discard-failed','album-cancel-pending','album-image-file','album-upload-progress','delete-album','moment-service-warning']) ids[id]=node();
  ids['moment-service-warning'].hidden=true;
  const events=[], saves=[], pending=[]; const albums={elements:{selection:{value:'0'},title:{value:'测试相册'},description:{value:'说明'},private:{checked:false}},listeners:{},addEventListener(name,fn){this.listeners[name]=fn},querySelectorAll(){return [ids['album-retry-failed'],ids['album-discard-failed'],ids['delete-album']]}};
  const submit={form:albums,disabled:false}; const parent={postMessage(data){events.push(data)}}; const window={parent,addEventListener(){}};
  const context={window,location:{origin:'https://test.example'},navigator:{deviceMemory:4,userAgent:'desktop'},document:{createElement:node,querySelectorAll:()=>[submit]},byId:id=>ids[id],albums,moments:{},albumImages:['/old.png'],loadedAlbumSnapshot:{title:'测试相册',images:['/old.png']},uploading:false,prepareAlbumPhoto:async f=>f,upload:file=>new Promise((resolve,reject)=>pending.push({file,resolve,reject})),imagePreviews(){},message(){},save:async payload=>{saves.push(structuredClone(payload)); if(context.rejectSave) throw Error('内容已在其他设备更新，请刷新后重试'); if(context.reloadFails) { const error=Error('内容已保存，但读取最新数据失败'); error.saveSucceeded=true; throw error; }},loadAlbum(){},console};
  vm.createContext(context); vm.runInContext(source.slice(start,end)+'\n'+source.slice(saveStart,saveEnd),context);
  return {context,albums,ids,events,saves,pending,submit};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('saving during upload waits for every image before reporting success',async()=>{
  const h=harness(); h.ids['album-image-file'].files=[{name:'one',size:10},{name:'two',size:10}];
  h.ids['album-image-file'].listeners.change({target:h.ids['album-image-file']}); await flush();
  assert.equal(h.submit.disabled,false); assert.equal(h.pending.length,2);
  const saving=h.albums.listeners.submit({preventDefault(){}}); await flush();
  assert.equal(h.saves.length,0); assert.equal(h.submit.disabled,true); assert.ok(h.events.some(e=>e.state==='saving'));
  h.pending[1].resolve('/two.png'); await flush(); assert.equal(h.saves.length,0);
  h.pending[0].resolve('/one.png'); await saving;
  assert.deepEqual(h.saves[0].images,['/old.png','/one.png','/two.png']);
  assert.equal(h.events.at(-1).state,'saved'); assert.equal(h.context.window.blogAlbumUnsaved,false);
});

test('failed upload prevents partial save and can be retried',async()=>{
  const h=harness(); h.ids['album-image-file'].files=[{name:'one',size:10},{name:'bad',size:10}];
  h.ids['album-image-file'].listeners.change({target:h.ids['album-image-file']}); await flush();
  const saving=h.albums.listeners.submit({preventDefault(){}}); h.pending[0].resolve('/one.png'); h.pending[1].reject(Error('断网')); await saving;
  assert.equal(h.saves.length,0); assert.equal(h.events.at(-1).state,'failed'); assert.equal(h.ids['album-retry-failed'].hidden,false);
  h.ids['album-retry-failed'].listeners.click(); await flush(); assert.equal(h.pending.length,3); h.pending[2].resolve('/two.png'); await flush();
  await h.albums.listeners.submit({preventDefault(){}}); assert.deepEqual(h.saves[0].images,['/old.png','/one.png','/two.png']); assert.equal(h.events.at(-1).state,'saved');
});

test('save conflict remains failed and keeps the pending editor',async()=>{
  const h=harness(); h.context.rejectSave=true;
  await h.albums.listeners.submit({preventDefault(){}});
  assert.equal(h.events.at(-1).state,'failed'); assert.equal(h.context.window.blogAlbumUnsaved,true);
});

test('a successful save followed by reload failure is not reported as an unsaved album',async()=>{
  const h=harness(); h.context.reloadFails=true;
  await h.albums.listeners.submit({preventDefault(){}});
  assert.equal(h.saves.length,1); assert.equal(h.events.at(-1).state,'saved');
  assert.equal(h.context.window.blogAlbumUnsaved,false);
});
