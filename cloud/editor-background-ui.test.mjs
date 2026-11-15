import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('closing the editor keeps an in-flight upload and allows reopening it', async () => {
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const start=source.indexOf('  let activeEditor = null;'), end=source.indexOf('  let homeScrolling',start);
  assert.ok(start>=0 && end>start);
  const created=[], listeners={};
  function element(tag) {
    const el={tag,hidden:false,open:false,removed:false,children:[],events:{},contentWindow:tag==='iframe'?{}:undefined,
      addEventListener(name,fn){this.events[name]=fn},setAttribute(){},append(...items){this.children.push(...items)},remove(){this.removed=true},
      showModal(){this.open=true},close(){this.open=false;this.events.close?.()}};
    created.push(el); return el;
  }
  const window={scrollY:0,addEventListener(name,fn){listeners[name]=fn},removeEventListener(name){delete listeners[name]},scrollTo(){}};
  const app={prepend(button){this.button=button}};
  const context={window,app,location:{origin:'http://127.0.0.1:4173',hostname:'127.0.0.1',port:'4173'},document:{createElement:element,body:{append(){}},querySelector(){return {}}},data:{},config:{},fetch:async()=>({ok:true,json:async()=>({})}),render(){},safeUrl(){return ''},setTimeout(){},console};
  vm.createContext(context); vm.runInContext(source.slice(start,end)+'\naddEditButton("albums","albums");',context);
  app.button.events.click();
  const dialog=created.find(el=>el.tag==='dialog'), frame=created.find(el=>el.tag==='iframe'), status=created.find(el=>el.className==='album-background-status');
  assert.ok(dialog.open); frame.contentWindow.blogAlbumUnsaved=true; dialog.close();
  assert.equal(dialog.removed,false); assert.equal(status.hidden,false);
  status.events.click(); assert.ok(dialog.open); dialog.close();
  listeners.message({origin:'http://127.0.0.1:4173',source:frame.contentWindow,data:{type:'blog-album-background',state:'failed',text:'上传失败'}});
  assert.equal(status.textContent,'上传失败'); assert.equal(dialog.removed,false);
  listeners.message({origin:'http://127.0.0.1:4173',source:frame.contentWindow,data:{type:'blog-editor-saved'}});
  frame.contentWindow.blogAlbumUnsaved=false;
  listeners.message({origin:'http://127.0.0.1:4173',source:frame.contentWindow,data:{type:'blog-album-background',state:'saved',text:'相册保存完成'}});
  assert.equal(dialog.removed,true); assert.equal(status.textContent,'相册保存完成');
});
